// The route to the store for a signed URL: which origin is trusted, which path, which address, and when a
// tunnel to the Pod of the storage is opened. The URL comes from an object of the cluster: its origin is
// checked against what its storage location gives, its path against the key of the artifact that was
// asked, and its host is either a Service of the cluster, reached through a port-forward the extension
// opens with the identity of the kubeconfig, or a name this machine resolves, whose addresses are checked
// before any is connected to. What the operator has not allowed is said, with what may be allowed, and
// never assumed.

import { lookup as resolve } from "node:dns/promises";
import { type AllowanceKind, locationOf } from "../common/allowances";
import { canonicalAddress, classifyAddress, isMetadataName } from "../common/artifact-address";
import { checkOrigin, hostForm, isArtifactPath, type StoreOfLocation } from "../common/artifact-origin";
import { CredentialPluginError } from "./context-identity.ts";
import { type ArtifactRoute, DiagnosticError } from "./diagnostic-transport.ts";
import { openPodTunnel, type PortForwardRefusal } from "./diagnostic-tunnel.ts";

import type { DownloadVerdict } from "../common/diagnostic-text";
import type { DiagnosticKubernetes, DiagnosticObject } from "./diagnostic-kubernetes.ts";
import type { DiagnosticInput } from "./diagnostic-service";

type Api = Pick<DiagnosticKubernetes, "read" | "list" | "assertCurrent" | "authenticatedConfiguration">;

export interface RouteDependencies {
  api: Api;
  // Whether the operator allowed that for the cluster of the adapter: an origin for a storage location, a
  // private address or a connection that is not encrypted for an origin.
  allowed(what: AllowanceKind, origin: string, location: string): boolean;
  // The addresses a name resolves to on this machine, in the order its resolver gives them.
  lookup?(host: string): Promise<string[]>;
  tunnel?: typeof openPodTunnel;
}

export interface ResolvedRoute {
  route: ArtifactRoute;
  close(): void | Promise<void>;
  // Whether the cluster refused the port-forward of a route through it, and how.
  refused?(): PortForwardRefusal;
}

// A destination that is denied, by the rule that denies it.
function denied(rule: DownloadVerdict, stage = "route"): DiagnosticError {
  return new DiagnosticError("destination-denied", stage, rule);
}

// A read of the cluster the route needs, at its own step: what it ends with says which read it was.
async function at<Value>(stage: string, read: () => Promise<Value>): Promise<Value> {
  try {
    return await read();
  } catch (error) {
    // What was raised is not written on: the adapter gives one error to every request that waited for the
    // same plugin. The plugin of the context keeps its command and its reason.
    if (error instanceof CredentialPluginError && error.stage === undefined)
      throw new CredentialPluginError(error.command, error.reason, stage);
    if (error instanceof DiagnosticError && error.stage === undefined)
      throw new DiagnosticError(error.code, stage, error.verdict, error.needs);
    throw error;
  }
}

function lookupOnThisMachine(host: string): Promise<string[]> {
  return resolve(host, { all: true, verbatim: true }).then((found) => found.map((entry) => entry.address));
}

interface ServicePort {
  name?: string;
  port?: number;
  protocol?: string;
  targetPort?: number | string;
}

interface ContainerPort {
  name?: string;
  containerPort?: number;
  protocol?: string;
}

// The route through the cluster to a Service: the port of the URL matched to one of the ports of the
// Service; the endpoint slices of the Service read for an endpoint that is ready and is a Pod; the Pod read
// and checked, as the one of the endpoint, as ready and as one the Service selects; the port of the Service
// followed to its target port in that Pod, by number or by name; and a port-forward to it. The listener is
// on the loopback of this machine, for one connection. A slice says which Pod answers, and nothing else is
// taken from it: whoever may write one in the namespace could otherwise send the request to another Pod, or
// to another port.
async function throughTheCluster(
  service: DiagnosticObject,
  port: number,
  origin: string,
  pathname: string,
  signal: AbortSignal,
  dependencies: RouteDependencies,
): Promise<ResolvedRoute> {
  const { api } = dependencies;
  const namespace = service.metadata.namespace ?? "";
  const ports = (Array.isArray(service.spec?.ports) ? service.spec.ports : []) as ServicePort[];
  const asked = ports.find((entry) => entry?.port === port && (entry.protocol ?? "TCP") === "TCP");
  const selector = Object.entries((service.spec?.selector ?? {}) as Record<string, unknown>);

  if (!asked) throw denied("port", "service");
  // A Service without a selector has its endpoints written by something else: its Pods are not known.
  if (!selector.length) throw denied("endpoint", "service");
  const slices = await at("endpoints", () => api.list("EndpointSlice", namespace, service.metadata.name, signal));
  let chosen: { pod: string; uid: string } | undefined;

  for (const slice of slices as (DiagnosticObject & { ports?: ServicePort[]; endpoints?: unknown[] })[]) {
    // The endpoints of a slice answer the ports the slice names, by the names the Service gives them.
    if (
      !(Array.isArray(slice.ports) ? slice.ports : []).some(
        (entry) => (entry?.name ?? "") === (asked.name ?? "") && (entry.protocol ?? "TCP") === "TCP",
      )
    )
      continue;
    for (const endpoint of (Array.isArray(slice.endpoints) ? slice.endpoints : []) as {
      conditions?: { ready?: boolean; terminating?: boolean };
      targetRef?: { kind?: string; name?: string; namespace?: string; uid?: string };
    }[]) {
      const pod = endpoint?.targetRef;

      // An endpoint that does not say that it is ready is taken as ready, as the API reads it.
      if (
        endpoint?.conditions?.ready === false ||
        endpoint?.conditions?.terminating === true ||
        pod?.kind !== "Pod" ||
        typeof pod.name !== "string" ||
        typeof pod.uid !== "string" ||
        (pod.namespace !== undefined && pod.namespace !== namespace)
      )
        continue;
      chosen = { pod: pod.name, uid: pod.uid };
      break;
    }
    if (chosen) break;
  }
  if (!chosen) throw denied("endpoint", "endpoints");
  const target = chosen;
  const pod = await at("pod", () => api.read("Pod", namespace, target.pod, signal));
  const conditions = pod.status?.conditions as { type?: string; status?: string }[] | undefined;
  const containers = (pod.spec?.containers ?? []) as { ports?: ContainerPort[] }[];
  const labels = pod.metadata.labels ?? {};

  // The Pod of the endpoint, and no other of its name: one made again since the slice was written is not it.
  if (pod.metadata.uid !== target.uid) throw new DiagnosticError("target-changed", "pod");
  // One of the Pods the Service selects, whatever a slice says, and ready.
  if (
    selector.some(([key, value]) => labels[key] !== value) ||
    !conditions?.some((condition) => condition?.type === "Ready" && condition.status === "True")
  )
    throw denied("endpoint", "pod");
  // The target port of the Service in that Pod: the number it names, the port of the container it names,
  // or its own port when it names none. The Pod declares it.
  const named = asked.targetPort ?? asked.port;
  const declared = containers
    .flatMap((container) => (Array.isArray(container?.ports) ? container.ports : []))
    .find(
      (entry) =>
        (entry?.protocol ?? "TCP") === "TCP" &&
        (typeof named === "number" ? entry?.containerPort === named : entry?.name === named),
    )?.containerPort;

  if (typeof declared !== "number") throw denied("port", "pod");
  // The client of the port-forward is given the credential the adapter holds, and no plugin to run.
  const configuration = await at("forward", () => api.authenticatedConfiguration(signal));
  const tunnel = await at("forward", () =>
    (dependencies.tunnel ?? openPodTunnel)(
      { configuration, read: api.read.bind(api), assertCurrent: api.assertCurrent.bind(api) },
      { namespace, name: target.pod, uid: target.uid, port: declared },
      signal,
    ),
  );

  return {
    // Plain HTTP through the tunnel needs no allowance: the bytes travel inside the connection to the API
    // server, and inside the cluster.
    route: { origin, pathname, address: tunnel.address, port: tunnel.port, mode: "tunnel", allowHttp: true },
    close: tunnel.close,
    refused: tunnel.refused,
  };
}

export async function resolveRoute(
  url: string,
  input: Readonly<DiagnosticInput>,
  storage: DiagnosticObject,
  signal: AbortSignal,
  dependencies: RouteDependencies,
): Promise<ResolvedRoute> {
  const { api, allowed } = dependencies;
  const lookup = dependencies.lookup ?? lookupOnThisMachine;
  const objectStorage = storage.spec?.objectStorage as { bucket?: unknown; prefix?: unknown } | undefined;
  const location: StoreOfLocation = {
    provider: storage.spec?.provider,
    bucket: objectStorage?.bucket,
    prefix: objectStorage?.prefix,
    config: storage.spec?.config as Record<string, unknown> | undefined,
  };
  const checked = checkOrigin(url, location);
  // The location as an allowance names it: by its namespace and its name.
  const place = locationOf(storage.metadata.namespace ?? input.namespace, storage.metadata.name);

  if (checked.verdict === "refused") throw denied(checked.rule === "public-url" ? "public-url" : "url");
  const origin = checked.origin;
  // What the operator may allow, said with what it is for and never assumed.
  const needs = (what: AllowanceKind) =>
    new DiagnosticError("destination-denied", "route", "allowance", {
      what,
      origin,
      ...(what === "origin" ? { location: place } : {}),
    });

  if (checked.verdict === "allowance" && !allowed("origin", origin, place)) throw needs("origin");
  const parsed = new URL(url);

  // The log of a backup is asked, and nothing else is fetched with its URL.
  if (
    !isArtifactPath(
      parsed.pathname,
      input.target,
      input.name,
      location,
      checked.verdict === "known" ? checked.bucket : "either",
    )
  )
    throw denied("path");
  const secure = parsed.protocol === "https:";
  const port = parsed.port ? Number(parsed.port) : secure ? 443 : 80;
  const host = parsed.hostname;

  if (isMetadataName(host)) throw denied("address");
  // What the host names is read without the bucket, when the bucket is its first label: the store is what
  // comes after it, and a Service addressed that way is a Service all the same.
  const form = hostForm(
    checked.verdict === "known" && checked.bucket === "host" ? host.slice(host.indexOf(".") + 1) : host,
  );
  let resolved: string[] | undefined;

  if (form.form === "service" || form.form === "candidate") {
    // A name of the form of a Service is one, and is never resolved on this machine. A bare name, or a
    // name with a namespace, is a Service when one of that name is there, in that namespace or in the
    // one of the installation.
    const namespace = form.namespace ?? input.namespace;
    let service: DiagnosticObject | undefined;

    try {
      service = await at("service", () => api.read("Service", namespace, form.name, signal));
    } catch (error) {
      // A name that only may be a Service, and is not one, is a name of this machine. When the cluster
      // refuses to say, the refusal says that the name only may be one.
      if (form.form === "candidate" && error instanceof DiagnosticError && error.code === "forbidden")
        throw new DiagnosticError("forbidden", "service", "candidate");
      if (form.form === "service" || !(error instanceof DiagnosticError) || error.code !== "not-found") throw error;
    }
    if (form.form === "candidate") {
      // A name of this machine reached without encryption is asked of the operator before it is resolved.
      if (!service && !secure && !allowed("http", origin, place)) throw needs("http");
      resolved = await lookup(host).catch(() => []);
      if (signal.aborted) throw new DiagnosticError("cancelled", "route");
      // A name that is both is not known to be either.
      if (service && resolved.length) throw denied("ambiguous");
    }
    if (service) return throughTheCluster(service, port, origin, parsed.pathname, signal, dependencies);
  }
  // Directly from this machine. Plain HTTP is not encrypted, and is made only after it was allowed.
  if (!secure && !allowed("http", origin, place)) throw needs("http");
  const addresses =
    form.form === "address"
      ? [host.replace(/^\[|\]$/g, "")]
      : (resolved ??
        (await lookup(host).catch(() => {
          throw new DiagnosticError("transport-unreachable", "route");
        })));

  if (signal.aborted) throw new DiagnosticError("cancelled", "route");
  if (!addresses.length) throw new DiagnosticError("transport-unreachable", "route");
  let needsPrivate = false;

  // The connection is made to the first address that is allowed, with the host and the server name of the
  // URL. The loopback is never reached outside a tunnel, and what is refused is refused with any allowance.
  for (const address of addresses) {
    // An IPv4 address written inside an IPv6 one is not an address a socket is given: it is refused here,
    // before the operator is asked to allow what could not be connected to.
    const kind = canonicalAddress(address)?.startsWith("::ffff:") ? "refused" : classifyAddress(address);

    if (kind === "public" || (kind === "private" && allowed("private", origin, place)))
      return {
        route: {
          origin,
          pathname: parsed.pathname,
          address,
          port,
          mode: "direct",
          allowHttp: !secure,
          allowPrivate: kind === "private",
        },
        close: () => undefined,
      };
    if (kind === "private") needsPrivate = true;
  }
  throw needsPrivate ? needs("private") : denied("address");
}
