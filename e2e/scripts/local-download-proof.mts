import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { FIXTURE_LABEL, fixtureArtifactPath, fixtureNames } from "./local-fixtures.mts";
import { DEMO_CONTEXT, DEMO_NAMESPACE, OWNER_LABEL, requireCondition, SUBNETS, subnetsOverlap } from "./local-kind.mts";
import { type KubeResource, STORAGE_ENDPOINT } from "./local-manifests.mts";

import type { AllowanceFor, Allowances } from "../../src/common/allowances.ts";
import type { Answer, ArtifactPage, ArtifactValue, WriteConfirmAnswer } from "../../src/common/ipc.ts";
import type { DiagnosticKind } from "../../src/main/diagnostic-kubernetes.ts";
import type { HandlersDependencies } from "../../src/main/ipc.ts";

export { DIRECT_PROOF_IMAGE } from "./local-manifests.mts";

// The origin the direct proof gives the store, as the public URL of its storage location: a name no
// resolver knows, which the proof answers for with the address of the Pod of the storage.
export const DIRECT_PROOF_ORIGIN = "https://storage.proof.invalid:8443";

export interface DownloadProofContext {
  owner: string;
  run: string;
  kubeconfig: string;
  pod: { name: string; uid: string };
  origin?: string;
  port?: number;
  direct?: boolean;
  // The operations the server refused, when the proof asks for their artifacts as well: a backup and a
  // restore that failed their validation, and a restore without a backup.
  refused?: Record<"backup" | "restore" | "orphan", { name: string; uid: string }>;
  assertCurrent(): void;
  record(kind: DiagnosticKind, identity: { name: string; uid: string }): void;
}

// The compiled main process, loaded where there is no host. It is given what it asks of the host when it
// loads, as names and nothing under them: the proofs run its diagnostic code, which uses none of it, and
// need no package installed.
export function compiledDiagnostics(): typeof import("../../src/main/index.ts") {
  const globals = globalThis as typeof globalThis & { LensExtensions?: unknown; Mobx?: unknown };
  const previous = { sdk: globals.LensExtensions, state: globals.Mobx };

  globals.LensExtensions = {
    Main: { LensExtension: class {}, Ipc: class {} },
    Common: { Store: { ExtensionStore: class {} } },
    Renderer: {},
  };
  globals.Mobx = {};
  try {
    return createRequire(import.meta.url)(
      fileURLToPath(new URL("../../out/main/index.js", import.meta.url)),
    ) as typeof import("../../src/main/index.ts");
  } finally {
    if (previous.sdk === undefined) delete globals.LensExtensions;
    else globals.LensExtensions = previous.sdk;
    if (previous.state === undefined) delete globals.Mobx;
    else globals.Mobx = previous.state;
  }
}

export function tlsProofResources(
  owner: string,
  run: string,
  originals: KubeResource[],
  certificate: { ca: string; cert: string; key: string },
): KubeResource[] {
  const [deployment, service, location] = structuredClone(originals);

  requireCondition(
    deployment.kind === "Deployment" && service.kind === "Service" && location.kind === "BackupStorageLocation",
    "Unexpected TLS proof baseline",
  );
  const tlsName = `proof-tls-${run}`;
  const caName = `proof-ca-${run}`;
  const metadata = (name: string) => ({
    name,
    namespace: DEMO_NAMESPACE,
    labels: { [OWNER_LABEL]: owner, [FIXTURE_LABEL]: run },
  });
  const workload = deployment.spec as {
    template: {
      spec: {
        containers: {
          name: string;
          args: string[];
          ports: { name: string; containerPort: number }[];
          volumeMounts: { name: string; mountPath: string; readOnly?: boolean }[];
        }[];
        volumes: unknown[];
      };
    };
  };
  const container = workload.template.spec.containers.find((value) => value.name === "seaweedfs");

  requireCondition(container, "Owned storage container is missing");
  container.args.push(
    "-s3.port.https=8443",
    "-s3.cert.file=/etc/proof-tls/tls.crt",
    "-s3.key.file=/etc/proof-tls/tls.key",
  );
  container.ports.push({ name: "s3-https", containerPort: 8443 });
  container.volumeMounts.push({ name: "proof-tls", mountPath: "/etc/proof-tls", readOnly: true });
  workload.template.spec.volumes.push({ name: "proof-tls", secret: { secretName: tlsName, defaultMode: 0o440 } });
  (service.spec as { ports: unknown[] }).ports.push({ name: "s3-https", port: 8443, targetPort: "s3-https" });
  const spec = location.spec as { config: Record<string, string>; objectStorage: Record<string, unknown> };

  spec.config.s3Url = STORAGE_ENDPOINT.replace("http:", "https:").replace(":8333", ":8443");
  spec.objectStorage.caCert = Buffer.from(certificate.ca).toString("base64");
  delete spec.objectStorage.caCertRef;
  return [
    {
      apiVersion: "v1",
      kind: "Secret",
      metadata: metadata(tlsName),
      type: "kubernetes.io/tls",
      stringData: { "tls.crt": certificate.cert, "tls.key": certificate.key },
    },
    {
      apiVersion: "v1",
      kind: "Secret",
      metadata: metadata(caName),
      type: "Opaque",
      stringData: { "ca.crt": certificate.ca },
    },
    deployment,
    service,
    location,
  ];
}

type Main = ReturnType<typeof compiledDiagnostics>;

// The procedures of the main process, as the extension registers them with the host: a proof calls them as
// a frame of the cluster does, with the gate, its confirmations and its tokens. The cluster is the one
// entry of a catalog of the proof, over the kubeconfig it is given, and the requests carry the labels of
// the environment beside the ones of the extension, so that the environment knows them as its own. The
// route to the store is the one the main process finds by itself.
function proofProcedures(
  main: Main,
  context: Pick<DownloadProofContext, "owner" | "run" | "assertCurrent">,
  kubeconfig: string,
  dependencies: Partial<HandlersDependencies>,
) {
  const cluster = "velero-proof";
  const catalog = [{ id: cluster, name: "proof", kubeConfigPath: kubeconfig, contextName: DEMO_CONTEXT }];
  const gate = new main.WriteGate({
    catalog: () => catalog,
    adapter: (entry, isCurrent) =>
      new main.DiagnosticKubernetes(
        { clusterId: entry.id, context: entry.contextName, kubeconfigPath: entry.kubeConfigPath },
        () => {
          context.assertCurrent();
          return isCurrent();
        },
        {
          "app.kubernetes.io/managed-by": "freelens-velero-extension",
          [OWNER_LABEL]: context.owner,
          [FIXTURE_LABEL]: context.run,
        },
      ),
  });
  const handlers = new Map<string, (event: unknown, payload: unknown) => Promise<unknown>>();
  const frame = { senderFrame: { url: `https://${cluster}.renderer.freelens.app:1/` }, processId: 1, frameId: 1 };
  const release = main.registerHandlers(
    {
      handle: (channel, handler) =>
        handlers.set(channel, handler as (event: unknown, payload: unknown) => Promise<unknown>),
      broadcast: () => undefined,
    },
    { catalog: () => catalog, gate, ...dependencies },
  );
  // A call of a procedure, from the frame of the cluster of the proof. A failure says its code and its
  // step, which name nothing of the environment; its words are not printed.
  const call = async <Value,>(channel: string, payload: unknown): Promise<Value> => {
    const handler = handlers.get(channel);

    requireCondition(handler, "A procedure of the main process is not registered");
    const answer = (await handler(frame, payload)) as Answer<Value>;

    if (!answer.ok) throw new Error(`The procedure ${channel} failed: ${answer.code} at ${answer.stage}`);
    return answer.value;
  };
  // The answer of a run that is expected not to end with its text: its code, its step and what it says
  // the operator may allow. Nothing of a URL is in it: the origin an allowance is for, which its words
  // show, is the only thing of one it may carry.
  const refusal = async (
    target: { kind: "Backup" | "Restore"; name: string; uid: string },
    artifact: "BackupLog" | "RestoreLog",
    request: string,
    shown?: string,
  ): Promise<{ code: string; stage: string; needs?: AllowanceFor }> => {
    const { token } = await call<WriteConfirmAnswer>("write.confirm", {
      cluster,
      namespace: DEMO_NAMESPACE,
      kind: "DownloadRequest",
      target,
      artifact,
    });
    const handler = handlers.get("write.run");

    requireCondition(handler, "A procedure of the main process is not registered");
    const answer = (await handler(frame, {
      cluster,
      namespace: DEMO_NAMESPACE,
      kind: "DownloadRequest",
      target,
      artifact,
      token,
      request,
    })) as Answer<ArtifactValue>;

    requireCondition(!answer.ok, "An artifact the proof expected to be refused was downloaded");
    const said = JSON.stringify(answer);

    requireCondition(
      !/X-Amz|downloadURL|[?]|https?:/.test(shown ? said.split(shown).join("") : said),
      "A failure of the proof carries a URL",
    );
    return { code: answer.code, stage: answer.stage, ...(answer.needs ? { needs: answer.needs } : {}) };
  };
  const enable = () =>
    call("gate.enable", {
      cluster,
      namespace: DEMO_NAMESPACE,
      confirmation: { context: DEMO_CONTEXT, namespace: DEMO_NAMESPACE },
    });

  return { cluster, call, refusal, enable, release };
}

export async function runDownloadProof(context: DownloadProofContext): Promise<{
  downloads: number;
  generatedNames: boolean;
  conflictRefused: boolean;
  invalidSignature: boolean;
  invalidHost: boolean;
  untrustedCa: boolean;
  missingArtifacts: number;
  refusedBeforeCreation: boolean;
  allowanceAsked: boolean;
}> {
  const main = compiledDiagnostics();
  const api = new main.DiagnosticKubernetes(
    { clusterId: context.owner, context: DEMO_CONTEXT, kubeconfigPath: context.kubeconfig },
    () => {
      context.assertCurrent();
      return true;
    },
    { [OWNER_LABEL]: context.owner, [FIXTURE_LABEL]: context.run },
  );
  const names = fixtureNames(context.run);
  // The path of an artifact of an operation of this run: the four the proof asks for, and no other.
  const pathOf = (target: string, name: string) => {
    requireCondition(
      target === "BackupLog" || target === "BackupResults" || target === "RestoreLog" || target === "RestoreResults",
      "Unexpected fixture artifact",
    );
    return fixtureArtifactPath(context.run, target, name);
  };
  const controller = new AbortController();
  const origin = context.origin ?? STORAGE_ENDPOINT;
  const port = context.port ?? 8333;
  let invalidSignature = false;
  let invalidHost = false;
  let untrustedCa = false;
  // The address of the Pod of the storage, which the direct proof connects to: the one of the Pod of this
  // run, in the network of the Pods of the environment.
  const podAddress = async (signal: AbortSignal): Promise<string> => {
    const pod = await api.read("Pod", DEMO_NAMESPACE, context.pod.name, signal);
    const address = pod.status?.podIP;

    requireCondition(
      pod.metadata.uid === context.pod.uid &&
        pod.metadata.namespace === DEMO_NAMESPACE &&
        pod.metadata.labels?.[OWNER_LABEL] === context.owner &&
        typeof address === "string" &&
        subnetsOverlap(SUBNETS.pods, address),
      "Direct proof pod identity or address changed",
    );
    return address;
  };
  // A connection of the proof itself, for what it asks the store beside the downloads of the main process.
  const newConnection = async (signal: AbortSignal) =>
    context.direct
      ? { address: await podAddress(signal), port, close: async () => {} }
      : main.openPodTunnel(api, { ...context.pod, namespace: DEMO_NAMESPACE, port }, signal);
  // The paths the proof asks the store for: the artifacts of the real backup and of the real restore, and
  // the logs of the operations that failed their validation.
  const paths = new Set([
    pathOf("BackupLog", names.backup),
    pathOf("BackupResults", names.backup),
    pathOf("RestoreLog", names.restore),
    pathOf("RestoreResults", names.restore),
    ...(context.refused
      ? [pathOf("BackupLog", context.refused.backup.name), pathOf("RestoreLog", context.refused.restore.name)]
      : []),
  ]);
  // What the operator allowed, as the proof keeps it for the procedures that give it and take it back.
  let allowed: Allowances = {};
  const { cluster, call, refusal, enable, release } = proofProcedures(main, context, context.kubeconfig, {
    allowances: {
      read: () => allowed,
      write: (next) => {
        allowed = next;
      },
    },
    // The name of the direct proof is in no resolver: the proof answers for the one of this machine, with
    // the address of the Pod of the storage.
    ...(context.direct
      ? {
          lookup: async (host: string) =>
            host === new URL(origin).hostname ? [await podAddress(controller.signal)] : [],
        }
      : {}),
    download: {
      download: async (url, route, signal) => {
        // The route is the one the main process found by itself, from the URL the server signed and from
        // the objects of the cluster: the origin and the path of the fixtures, through a tunnel to the
        // loopback of this machine, or directly to the address of the Pod once that was allowed.
        requireCondition(
          route.origin === origin &&
            route.pathname === new URL(url).pathname &&
            paths.has(route.pathname) &&
            (context.direct
              ? route.mode === "direct" &&
                route.address === (await podAddress(signal)) &&
                route.port === port &&
                route.allowPrivate === true &&
                !route.allowHttp
              : route.mode === "tunnel" && route.address === "127.0.0.1" && !route.allowPrivate),
          "The main process found another route than the one of the fixtures",
        );
        const content = await main.downloadArtifact(url, route, signal);

        if (!invalidSignature) {
          const altered = new URL(url);

          requireCondition(altered.searchParams.has("X-Amz-Signature"), "Expected a server-signed fixture URL");
          altered.searchParams.set("X-Amz-Signature", "0".repeat(64));
          const tunnel = await newConnection(signal);

          try {
            await main.downloadArtifact(altered.href, { ...route, port: tunnel.port }, signal);
          } catch (error) {
            invalidSignature = error instanceof main.DiagnosticError && error.code === "request-failed";
          } finally {
            await tunnel.close();
          }
          requireCondition(invalidSignature, "Storage did not reject an altered signature");
          const second = await newConnection(signal);

          try {
            if (origin.startsWith("https:")) {
              try {
                await main.downloadArtifact(url, { ...route, port: second.port, ca: undefined }, signal);
              } catch (error) {
                untrustedCa = error instanceof main.DiagnosticError && error.code === "tls-invalid";
              }
              requireCondition(untrustedCa, "The TLS proof succeeded without its private CA");
            } else {
              const wrongHost = new URL(url);

              wrongHost.hostname = "wrong-host.example.invalid";
              try {
                await main.downloadArtifact(
                  wrongHost.href,
                  { ...route, origin: wrongHost.origin, port: second.port },
                  signal,
                );
              } catch (error) {
                invalidHost = error instanceof main.DiagnosticError && error.code === "request-failed";
              }
              requireCondition(invalidHost, "Storage did not reject a changed signed Host");
            }
          } finally {
            await second.close();
          }
        }
        return content;
      },
    },
  });
  // Whether a request of that name is in the cluster, and its identity when it is.
  const requestOf = (name: string) =>
    api.read("DownloadRequest", DEMO_NAMESPACE, name, controller.signal).then(
      (found) => ({ name, uid: found.metadata.uid }),
      (error: unknown) => {
        requireCondition(
          error instanceof main.DiagnosticError && error.code === "not-found",
          "A request of the proof could not be looked for",
        );
        return undefined;
      },
    );
  let downloads = 0;
  let missingArtifacts = 0;
  let refusedBeforeCreation = false;
  let allowanceAsked = false;

  try {
    await enable();
    if (context.direct) {
      // The address of the store is a private one, and nothing was allowed: the run says that the
      // operator may allow it, and for which origin. Its request is in the cluster, since the route is
      // looked for once the URL is signed. The allowance is given through the procedure, as a frame
      // gives it, and the downloads below go by it.
      const object = await api.read("Backup", DEMO_NAMESPACE, names.backup, controller.signal);
      const request = randomUUID();
      const ended = await refusal(
        { kind: "Backup", name: names.backup, uid: object.metadata.uid },
        "BackupLog",
        request,
        origin,
      );
      const created = await requestOf(`${names.backup}-${request}`);

      requireCondition(created, "No request was created before the route was looked for");
      context.record("DownloadRequest", created);
      requireCondition(
        ended.code === "destination-denied" &&
          ended.stage === "route" &&
          ended.needs?.what === "private" &&
          ended.needs.origin === origin &&
          Object.keys(allowed).length === 0,
        `A private address that was not allowed ended as ${ended.code} at ${ended.stage}`,
      );
      await call<null>("allowance.grant", { cluster, what: "private", origin });
      requireCondition(
        allowed[cluster]?.length === 1 &&
          allowed[cluster][0].what === "private" &&
          allowed[cluster][0].origin === origin,
        "The allowance of the proof was not kept",
      );
      allowanceAsked = true;
    }
    for (const artifact of ["BackupLog", "BackupResults", "RestoreLog", "RestoreResults"] as const) {
      const kind = artifact.startsWith("Backup") ? "Backup" : "Restore";
      const objectName = kind === "Backup" ? names.backup : names.restore;
      const object = await api.read(kind, DEMO_NAMESPACE, objectName, controller.signal);
      const target = { kind, name: objectName, uid: object.metadata.uid };
      const { token } = await call<WriteConfirmAnswer>("write.confirm", {
        cluster,
        namespace: DEMO_NAMESPACE,
        kind: "DownloadRequest",
        target,
        artifact,
      });
      const request = randomUUID();
      const run = { cluster, namespace: DEMO_NAMESPACE, kind: "DownloadRequest", target, artifact, token, request };
      // The same request sent again while it runs joins it: one object is created for the two.
      const [result, joined] = await Promise.all([
        call<ArtifactValue>("write.run", run),
        call<ArtifactValue>("write.run", run),
      ]);

      requireCondition(result === joined, "Live request ID did not rejoin the operation");
      context.record("DownloadRequest", result.request);
      requireCondition(
        result.request.name === `${objectName}-${request}` &&
          result.size > 0 &&
          result.pages > 0 &&
          result.route.origin === origin &&
          result.route.mode === (context.direct ? "direct" : "tunnel") &&
          result.route.encrypted === origin.startsWith("https:") &&
          !/X-Amz|downloadURL|[?]/.test(JSON.stringify(result)),
        "Live artifact result is invalid",
      );
      // The text is held by the main process and given in pages, to the frame that asked for it.
      let content = "";

      for (let page = 0; page < result.pages; page += 1)
        content += (await call<ArtifactPage>("artifact.page", { cluster, request, page })).text;
      requireCondition(Buffer.byteLength(content) === result.size, "Live artifact pages do not hold the whole text");
      if (artifact.endsWith("Results")) JSON.parse(content);
      await call<null>("artifact.release", { cluster, request });
      requireCondition(
        await call<ArtifactPage>("artifact.page", { cluster, request, page: 0 }).then(
          () => false,
          () => true,
        ),
        "A text that was let go is still given",
      );
      downloads += 1;
    }
    // What the server and the store answer when there is nothing to download.
    if (context.refused) {
      // An operation that failed its validation wrote nothing into the store, and its backup and its
      // storage location are valid: the server signs a URL, and the store says that it has no such file.
      for (const [target, artifact] of [
        [{ kind: "Backup", ...context.refused.backup }, "BackupLog"],
        [{ kind: "Restore", ...context.refused.restore }, "RestoreLog"],
      ] as const) {
        const request = randomUUID();
        const ended = await refusal(target, artifact, request);
        const created = await requestOf(`${target.name}-${request}`);

        // The request was created for it, and stays: the proof removes it with the others.
        requireCondition(created, "No request was created for an artifact the store was asked for");
        context.record("DownloadRequest", created);
        requireCondition(
          ended.code === "artifact-missing" && ended.stage === "download",
          `A file the store does not have ended as ${ended.code} at ${ended.stage}`,
        );
        missingArtifacts += 1;
      }
      // A restore that names no backup: the server would sign no URL, and no request is created for it.
      const request = randomUUID();
      const ended = await refusal({ kind: "Restore", ...context.refused.orphan }, "RestoreLog", request);

      requireCondition(
        ended.code === "not-found" && ended.stage === "backup",
        `A restore without a backup ended as ${ended.code} at ${ended.stage}`,
      );
      requireCondition(
        !(await requestOf(`${context.refused.orphan.name}-${request}`)),
        "A request was created for a restore without a backup",
      );
      refusedBeforeCreation = true;
    }
    const collisionName = `${names.backup}-${randomUUID()}`;
    const requestId = randomUUID();
    const created = await api.createDownload(
      DEMO_NAMESPACE,
      "BackupLog",
      names.backup,
      collisionName,
      requestId,
      controller.signal,
    );

    context.record("DownloadRequest", created.metadata);
    let conflict = false;

    try {
      await api.createDownload(DEMO_NAMESPACE, "BackupLog", names.backup, collisionName, requestId, controller.signal);
    } catch (error) {
      conflict = error instanceof main.DiagnosticError && error.code === "conflict";
    }
    requireCondition(
      conflict &&
        (await api.read("DownloadRequest", DEMO_NAMESPACE, collisionName, controller.signal)).metadata.uid ===
          created.metadata.uid,
      "Collision did not preserve the original request",
    );
    const generated = await api.createGenerated(
      "ServerStatusRequest",
      DEMO_NAMESPACE,
      `proof-${context.run}-`,
      controller.signal,
    );

    context.record("ServerStatusRequest", generated.metadata);
    requireCondition(
      generated.metadata.name.startsWith(`proof-${context.run}-`) && !!generated.metadata.uid,
      "API-generated request name missing",
    );
    const deadline = Date.now() + 10_000;
    let status = generated;

    while (status.status?.phase !== "Processed") {
      requireCondition(Date.now() < deadline, "Local server-status request timed out");
      await delay(250);
      status = await api.read("ServerStatusRequest", DEMO_NAMESPACE, generated.metadata.name, controller.signal);
    }
    requireCondition(typeof status.status?.serverVersion === "string", "Local server-status response missing version");
    return {
      downloads,
      generatedNames: true,
      conflictRefused: true,
      invalidSignature,
      invalidHost,
      untrustedCa,
      missingArtifacts,
      refusedBeforeCreation,
      allowanceAsked,
    };
  } finally {
    controller.abort();
    release();
    api.dispose();
  }
}

export interface IdentityProofContext {
  owner: string;
  run: string;
  // The kubeconfig of the identity, and the one of the environment, with which the proof looks at what
  // the identity left in the cluster.
  kubeconfig: string;
  environment: string;
  // The step of a download the identity may not do; none for the identity that may do them all.
  stage?: "creation" | "certificate" | "service" | "forward";
  assertCurrent(): void;
  record(kind: DiagnosticKind, identity: { name: string; uid: string }): void;
}

// The steps that come after the creation of the request: an identity refused at one of them left its
// request in the cluster.
const AFTER_THE_CREATION = ["service", "forward"];

// What an identity that may not do one step of a download is told: that the cluster forbids it, at that
// step, with nothing of a URL. Its request is in the cluster only when the step comes after the creation.
// The identity that has what the documentation lists downloads the log through the cluster.
export async function runIdentityProof(context: IdentityProofContext): Promise<{ stage: string; created: boolean }> {
  const main = compiledDiagnostics();
  const names = fixtureNames(context.run);
  const controller = new AbortController();
  const environment = new main.DiagnosticKubernetes(
    { clusterId: context.owner, context: DEMO_CONTEXT, kubeconfigPath: context.environment },
    () => {
      context.assertCurrent();
      return true;
    },
  );
  const { cluster, call, refusal, enable, release } = proofProcedures(main, context, context.kubeconfig, {});

  try {
    await enable();
    const object = await environment.read("Backup", DEMO_NAMESPACE, names.backup, controller.signal);
    const request = randomUUID();
    const target = { kind: "Backup" as const, name: names.backup, uid: object.metadata.uid };

    if (!context.stage) {
      const asked = { cluster, namespace: DEMO_NAMESPACE, kind: "DownloadRequest", target, artifact: "BackupLog" };
      const { token } = await call<WriteConfirmAnswer>("write.confirm", asked);
      const result = await call<ArtifactValue>("write.run", { ...asked, token, request });

      context.record("DownloadRequest", result.request);
      requireCondition(
        result.size > 0 && result.route.mode === "tunnel" && !/X-Amz|downloadURL|[?]/.test(JSON.stringify(result)),
        "The identity with the documented permissions did not download through the cluster",
      );
      await call<null>("artifact.release", { cluster, request });
      return { stage: "none", created: true };
    }
    const ended = await refusal(target, "BackupLog", request);
    const created = await environment
      .read("DownloadRequest", DEMO_NAMESPACE, `${names.backup}-${request}`, controller.signal)
      .then(
        (found) => ({ name: found.metadata.name, uid: found.metadata.uid }),
        (error: unknown) => {
          requireCondition(
            error instanceof main.DiagnosticError && error.code === "not-found",
            "A request of the proof could not be looked for",
          );
          return undefined;
        },
      );

    // What it left is recorded before its answer is judged, so that the proof removes it either way.
    if (created) context.record("DownloadRequest", created);
    requireCondition(
      ended.code === "forbidden" && ended.stage === context.stage,
      `An identity that may not do the step ${context.stage} ended as ${ended.code} at ${ended.stage}`,
    );
    requireCondition(
      Boolean(created) === AFTER_THE_CREATION.includes(context.stage),
      created
        ? "A request was created for an identity refused before the creation"
        : "No request was created for an identity refused after the creation",
    );
    return { stage: ended.stage, created: Boolean(created) };
  } finally {
    controller.abort();
    release();
    environment.dispose();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    requireCondition(
      process.argv.length === 3 && process.argv[2] === "--direct",
      "Only the explicit direct proof worker is supported",
    );
    const input = JSON.parse(readFileSync("/proof-state/input.json", "utf8")) as Omit<
      DownloadProofContext,
      "record" | "assertCurrent" | "kubeconfig"
    > & { kubeconfigHash: string };
    const config = "/proof-state/kubeconfig";
    const result = await runDownloadProof({
      ...input,
      direct: true,
      kubeconfig: config,
      assertCurrent: () => {
        requireCondition(
          createHash("sha256").update(readFileSync(config)).digest("hex") === input.kubeconfigHash,
          "Direct proof kubeconfig changed",
        );
      },
      record: (kind, identity) => {
        console.log(JSON.stringify({ created: { kind, ...identity } }));
      },
    });

    console.log(JSON.stringify({ result, nodeVersion: process.version }));
  } catch {
    console.error("Direct compiled diagnostic proof failed; URL and credentials withheld.");
    process.exitCode = 1;
  }
}
