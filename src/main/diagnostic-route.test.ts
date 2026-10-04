// The route to the store for a signed URL: the origin, the path, the host and the address, each checked
// before a connection is made, on a cluster of the test and a resolver of the test.

import { describe, expect, it, vi } from "vitest";
import { CredentialPluginError } from "./context-identity";
import { type RouteDependencies, resolveRoute } from "./diagnostic-route";
import { DiagnosticError } from "./diagnostic-transport";

import type { DiagnosticObject } from "./diagnostic-kubernetes";
import type { DiagnosticInput } from "./diagnostic-service";

const QUERY = "?X-Amz-Signature=PRIVATE-SENTINEL";
const input: DiagnosticInput = {
  requestId: "0e7c5b7a-1111-4111-8111-000000000001",
  namespace: "velero",
  target: "BackupLog",
  name: "nightly",
  uid: "backup-uid",
};
const KEY = "backups/nightly/nightly-logs.gz";

// A storage location of the plugin of AWS, with the configuration a test gives it.
function location(config: Record<string, unknown>, more: Record<string, unknown> = {}): DiagnosticObject {
  return {
    metadata: { name: "default", namespace: "velero", uid: "location-uid" },
    spec: { provider: "aws", objectStorage: { bucket: "bucket" }, config, ...more },
  };
}

// A cluster of the test: a Service of the storage with its endpoint slice and its Pod, and what a test
// changes of them.
function fixture(options: { lookups?: Record<string, string[]>; allowed?: string[] } = {}) {
  const state = {
    service: {
      metadata: { name: "seaweedfs", namespace: "storage", uid: "service-uid" },
      spec: {
        selector: { app: "seaweedfs" },
        ports: [{ name: "s3", port: 8333, targetPort: "s3-port", protocol: "TCP" }],
      },
    } as DiagnosticObject | undefined,
    slices: [
      {
        metadata: { name: "seaweedfs-abcde", namespace: "storage", uid: "slice-uid" },
        ports: [{ name: "s3", port: 9333, protocol: "TCP" }],
        endpoints: [{ conditions: { ready: true }, targetRef: { kind: "Pod", name: "seaweedfs-0", uid: "pod-uid" } }],
      },
    ] as unknown[],
    pod: {
      metadata: {
        name: "seaweedfs-0",
        namespace: "storage",
        uid: "pod-uid",
        labels: { app: "seaweedfs", tier: "data" },
      },
      spec: { containers: [{ ports: [{ name: "s3-port", containerPort: 9333 }] }] },
      status: { conditions: [{ type: "Ready", status: "True" }] },
    } as DiagnosticObject,
    refuse: undefined as string | undefined,
  };
  const asked: string[] = [];
  const api = {
    assertCurrent: vi.fn(),
    read: vi.fn(async (kind: string, namespace: string, name: string): Promise<DiagnosticObject> => {
      asked.push(`read ${kind} ${namespace}/${name}`);
      if (state.refuse === kind) throw new DiagnosticError("forbidden");
      if (kind === "Service" && state.service?.metadata.name === name && state.service.metadata.namespace === namespace)
        return state.service;
      if (kind === "Pod" && state.pod.metadata.name === name && namespace === "storage") return state.pod;
      throw new DiagnosticError("not-found");
    }),
    list: vi.fn(async (kind: string, namespace: string, service: string): Promise<DiagnosticObject[]> => {
      asked.push(`list ${kind} ${namespace}/${service}`);
      if (state.refuse === kind) throw new DiagnosticError("forbidden");
      return state.slices as DiagnosticObject[];
    }),
    authenticatedConfiguration: vi.fn(async () => ({ synthetic: "configuration" }) as never),
  };
  const close = vi.fn();
  const tunnel = vi.fn(async (_api: unknown, _pod: unknown, _signal: AbortSignal) => ({
    address: "127.0.0.1",
    port: 40_123,
    close,
  }));
  const lookup = vi.fn(async (host: string) => {
    const found = options.lookups?.[host];

    if (!found) throw new Error(`getaddrinfo ENOTFOUND ${host}`);
    return found;
  });
  const allowances = new Set(options.allowed ?? []);
  const dependencies: RouteDependencies = {
    api: api as never,
    allowed: (what, origin, place) => allowances.has(`${what} ${origin}${what === "origin" ? ` ${place}` : ""}`),
    lookup,
    tunnel: tunnel as never,
  };
  const resolve = (url: string, storage: DiagnosticObject, signal = new AbortController().signal) =>
    resolveRoute(url, input, storage, signal, dependencies);
  // How a route was refused: its code, its step, its rule and what the operator may allow.
  const refused = async (url: string, storage: DiagnosticObject) => {
    try {
      await resolve(url, storage);
    } catch (error) {
      if (!(error instanceof DiagnosticError)) throw error;
      return {
        code: error.code,
        stage: error.stage,
        ...(error.verdict ? { verdict: error.verdict } : {}),
        ...(error.needs ? { needs: error.needs } : {}),
      };
    }
    throw new Error("The route was not refused");
  };

  return { state, asked, api, close, tunnel, lookup, allowances, resolve, refused };
}

const inCluster = location({ s3Url: "http://seaweedfs.storage.svc:8333", s3ForcePathStyle: "true" });
const SERVICE_URL = `http://seaweedfs.storage.svc:8333/bucket/${KEY}${QUERY}`;

describe("the route to a store that is a Service of the cluster", () => {
  it("reads the Service, its endpoint slices and its Pod, and opens a tunnel to the target port of the Service in that Pod", async () => {
    const value = fixture();
    const resolved = await value.resolve(SERVICE_URL, inCluster);

    expect(resolved.route).toEqual({
      origin: "http://seaweedfs.storage.svc:8333",
      pathname: `/bucket/${KEY}`,
      address: "127.0.0.1",
      port: 40_123,
      mode: "tunnel",
      // Plain HTTP through the tunnel needs no allowance.
      allowHttp: true,
    });
    expect(value.asked).toEqual([
      "read Service storage/seaweedfs",
      "list EndpointSlice storage/seaweedfs",
      "read Pod storage/seaweedfs-0",
    ]);
    // The port of the URL is the one of the Service; the tunnel goes to the port of the Pod it names.
    expect(value.tunnel.mock.calls[0][1]).toEqual({
      namespace: "storage",
      name: "seaweedfs-0",
      uid: "pod-uid",
      port: 9333,
    });
    // The client of the port-forward is given the configuration the adapter authenticated, and its reads.
    expect(value.api.authenticatedConfiguration).toHaveBeenCalledTimes(1);
    expect(value.tunnel.mock.calls[0][0]).toMatchObject({ configuration: { synthetic: "configuration" } });
    // A name of that form is never resolved on this machine.
    expect(value.lookup).not.toHaveBeenCalled();
    expect(value.close).not.toHaveBeenCalled();
    await resolved.close();
    expect(value.close).toHaveBeenCalledTimes(1);
  });

  it("takes the name with the domain of the cluster after it as the same Service", async () => {
    const value = fixture();
    const storage = location({ s3Url: "http://seaweedfs.storage.svc.cluster.local:8333", s3ForcePathStyle: "true" });

    await value.resolve(`http://seaweedfs.storage.svc.cluster.local:8333/bucket/${KEY}${QUERY}`, storage);
    expect(value.asked[0]).toBe("read Service storage/seaweedfs");
    expect(value.lookup).not.toHaveBeenCalled();
  });

  it("denies a port that is not one of the Service, and a Service that has no ready endpoint that is a Pod", async () => {
    const value = fixture();
    const other = location({ s3Url: "http://seaweedfs.storage.svc:9999", s3ForcePathStyle: "true" });

    expect(await value.refused(`http://seaweedfs.storage.svc:9999/bucket/${KEY}${QUERY}`, other)).toEqual({
      code: "destination-denied",
      stage: "service",
      verdict: "port",
    });
    // A port of UDP of that number is not the one a download connects to.
    const [servicePort] = ((value.state.service as DiagnosticObject).spec as { ports: { protocol: string }[] }).ports;

    servicePort.protocol = "UDP";
    expect(await value.refused(SERVICE_URL, inCluster)).toMatchObject({ stage: "service", verdict: "port" });
    servicePort.protocol = "TCP";
    for (const endpoints of [
      [],
      [{ conditions: { ready: false }, targetRef: { kind: "Pod", name: "seaweedfs-0", uid: "pod-uid" } }],
      [
        {
          conditions: { ready: true, terminating: true },
          targetRef: { kind: "Pod", name: "seaweedfs-0", uid: "pod-uid" },
        },
      ],
      [{ conditions: { ready: true }, targetRef: { kind: "Node", name: "node-1", uid: "node-uid" } }],
      [{ conditions: { ready: true } }],
      [{ conditions: { ready: true }, targetRef: { kind: "Pod", name: "seaweedfs-0" } }],
      [
        {
          conditions: { ready: true },
          targetRef: { kind: "Pod", name: "seaweedfs-0", uid: "pod-uid", namespace: "another" },
        },
      ],
    ]) {
      value.state.slices = [{ ...(value.state.slices[0] as object), endpoints }];
      expect([endpoints, await value.refused(SERVICE_URL, inCluster)]).toEqual([
        endpoints,
        { code: "destination-denied", stage: "endpoints", verdict: "endpoint" },
      ]);
    }
    // No slice at all, and a slice that names no port for that port of the Service.
    value.state.slices = [];
    expect(await value.refused(SERVICE_URL, inCluster)).toMatchObject({ stage: "endpoints", verdict: "endpoint" });
    expect(value.tunnel).not.toHaveBeenCalled();
  });

  it("takes the first endpoint that is ready, of the first slice that has the port, and one that does not say it is not", async () => {
    const value = fixture();

    value.state.slices = [
      {
        metadata: { name: "other-port" },
        ports: [{ name: "admin", port: 23_646 }],
        endpoints: [{ targetRef: { kind: "Pod", name: "admin-0", uid: "admin-uid" } }],
      },
      {
        metadata: { name: "seaweedfs-abcde" },
        ports: [{ name: "s3", port: 9333 }],
        endpoints: [
          { conditions: { ready: false }, targetRef: { kind: "Pod", name: "seaweedfs-1", uid: "other-uid" } },
          // An endpoint that says nothing of its readiness is ready, as the API reads it.
          { targetRef: { kind: "Pod", name: "seaweedfs-0", uid: "pod-uid" } },
          { conditions: { ready: true }, targetRef: { kind: "Pod", name: "seaweedfs-2", uid: "third-uid" } },
        ],
      },
    ];
    await value.resolve(SERVICE_URL, inCluster);
    expect(value.tunnel.mock.calls[0][1]).toMatchObject({ name: "seaweedfs-0", uid: "pod-uid", port: 9333 });
  });

  it("denies a Pod that is not ready or does not listen on the port, and one made again since the slice was written", async () => {
    const value = fixture();

    value.state.pod = { ...value.state.pod, status: { conditions: [{ type: "Ready", status: "False" }] } };
    expect(await value.refused(SERVICE_URL, inCluster)).toEqual({
      code: "destination-denied",
      stage: "pod",
      verdict: "endpoint",
    });
    // A Pod that does not declare the port the Service names: by another name, by another number, of
    // another protocol, or none at all.
    for (const ports of [
      [{ name: "admin", containerPort: 9333 }],
      [{ containerPort: 9333 }],
      [{ name: "s3-port", containerPort: 9333, protocol: "UDP" }],
      [{ name: "s3-port" }],
      [],
      undefined,
    ]) {
      value.state.pod = {
        ...value.state.pod,
        status: { conditions: [{ type: "Ready", status: "True" }] },
        spec: { containers: [{ ports }] },
      };
      expect([ports, await value.refused(SERVICE_URL, inCluster)]).toEqual([
        ports,
        { code: "destination-denied", stage: "pod", verdict: "port" },
      ]);
    }
    value.state.pod = { ...value.state.pod, metadata: { ...value.state.pod.metadata, uid: "recreated-uid" } };
    expect(await value.refused(SERVICE_URL, inCluster)).toEqual({ code: "target-changed", stage: "pod" });
    expect(value.tunnel).not.toHaveBeenCalled();
  });

  it("follows the port of the Service to its target port in the Pod, by number, by name and by itself, whatever a slice says", async () => {
    const service = (targetPort: number | string | undefined) => {
      const value = fixture();
      const ports = ((value.state.service as DiagnosticObject).spec as { ports: Record<string, unknown>[] }).ports;

      ports[0] = { name: "s3", port: 8333, protocol: "TCP", ...(targetPort === undefined ? {} : { targetPort }) };
      // The slice says another number for that port: nothing is taken from it but which Pod answers.
      value.state.slices = [{ ...(value.state.slices[0] as object), ports: [{ name: "s3", port: 23_646 }] }];
      value.state.pod = {
        ...value.state.pod,
        spec: {
          containers: [
            { ports: [{ name: "metrics", containerPort: 9327 }] },
            {
              ports: [
                { name: "s3-port", containerPort: 9333 },
                { name: "plain", containerPort: 8333 },
                { containerPort: 8080 },
              ],
            },
          ],
        },
      };
      return value;
    };

    for (const [targetPort, port] of [
      ["s3-port", 9333],
      [8080, 8080],
      // A port without a target is its own.
      [undefined, 8333],
    ] as const) {
      const value = service(targetPort);

      await value.resolve(SERVICE_URL, inCluster);
      expect([targetPort, value.tunnel.mock.calls[0][1]]).toEqual([
        targetPort,
        { namespace: "storage", name: "seaweedfs-0", uid: "pod-uid", port },
      ]);
    }
    // A target the Pod does not declare, by number or by name, and the number a slice gives in its place.
    for (const targetPort of [9999, "another", 23_646])
      expect([targetPort, await service(targetPort).refused(SERVICE_URL, inCluster)]).toEqual([
        targetPort,
        { code: "destination-denied", stage: "pod", verdict: "port" },
      ]);
  });

  it("takes for the Pod of a Service only one the Service selects, whatever a slice names", async () => {
    const value = fixture();

    // The slice of the Service names a Pod of the namespace the Service does not select.
    for (const labels of [{ app: "another" }, { tier: "data" }, {}, undefined] as (
      | Record<string, string>
      | undefined
    )[]) {
      value.state.pod = { ...value.state.pod, metadata: { ...value.state.pod.metadata, labels } };
      expect([labels, await value.refused(SERVICE_URL, inCluster)]).toEqual([
        labels,
        { code: "destination-denied", stage: "pod", verdict: "endpoint" },
      ]);
    }
    expect(value.tunnel).not.toHaveBeenCalled();
    // Every label of the selector is asked of the Pod.
    const two = fixture();

    ((two.state.service as DiagnosticObject).spec as { selector: Record<string, string> }).selector = {
      app: "seaweedfs",
      tier: "cache",
    };
    expect(await two.refused(SERVICE_URL, inCluster)).toMatchObject({ stage: "pod", verdict: "endpoint" });
    // A Service without a selector has its endpoints written by something else: none of them is followed,
    // and nothing is read after the Service.
    for (const selector of [undefined, {}]) {
      const none = fixture();

      ((none.state.service as DiagnosticObject).spec as { selector?: Record<string, string> }).selector = selector;
      expect([selector, await none.refused(SERVICE_URL, inCluster)]).toEqual([
        selector,
        { code: "destination-denied", stage: "service", verdict: "endpoint" },
      ]);
      expect(none.asked).toEqual(["read Service storage/seaweedfs"]);
    }
  });

  it("takes a store addressed with its bucket before the name of a Service for that Service, and resolves nothing", async () => {
    const value = fixture();
    // The location does not force the bucket into the path: the URL has it as the first label of its host.
    const hosted = location({ s3Url: "http://seaweedfs.storage.svc:8333" });
    const resolved = await value.resolve(`http://bucket.seaweedfs.storage.svc:8333/${KEY}${QUERY}`, hosted);

    // The host and the path of the URL are kept: only where the socket goes is of the Service.
    expect(resolved.route).toMatchObject({
      origin: "http://bucket.seaweedfs.storage.svc:8333",
      pathname: `/${KEY}`,
      mode: "tunnel",
      address: "127.0.0.1",
    });
    expect(value.asked[0]).toBe("read Service storage/seaweedfs");
    expect(value.lookup).not.toHaveBeenCalled();
  });

  it("says at which read the cluster refused, for each of the reads the route needs", async () => {
    const value = fixture();

    for (const [kind, stage] of [
      ["Service", "service"],
      ["EndpointSlice", "endpoints"],
      ["Pod", "pod"],
    ]) {
      value.state.refuse = kind;
      expect([kind, await value.refused(SERVICE_URL, inCluster)]).toEqual([kind, { code: "forbidden", stage }]);
    }
    value.state.refuse = undefined;
    // The port-forward itself, and the plugin of the context that gives no credential for it.
    value.tunnel.mockRejectedValueOnce(new DiagnosticError("forbidden"));
    expect(await value.refused(SERVICE_URL, inCluster)).toEqual({ code: "forbidden", stage: "forward" });
    const shared = new CredentialPluginError("/usr/local/bin/kubelogin", "deadline");

    value.api.authenticatedConfiguration.mockRejectedValueOnce(shared);
    const raised = await value.resolve(SERVICE_URL, inCluster).catch((error: unknown) => error);

    expect(raised).toBeInstanceOf(CredentialPluginError);
    expect(raised).toMatchObject({ command: "kubelogin", reason: "deadline", stage: "forward" });
    // What was raised is not written on.
    expect(shared.stage).toBeUndefined();
    // A Service of that form that is not there is said so, and nothing is resolved in its place.
    value.state.service = undefined;
    expect(await value.refused(SERVICE_URL, inCluster)).toEqual({ code: "not-found", stage: "service" });
    expect(value.lookup).not.toHaveBeenCalled();
  });
});

describe("the route to a store whose host may be a Service", () => {
  const bare = location({ s3Url: "http://seaweedfs:8333", s3ForcePathStyle: "true" });
  const BARE_URL = `http://seaweedfs:8333/bucket/${KEY}${QUERY}`;

  it("takes a bare name for the Service of that name in the namespace of the installation", async () => {
    const value = fixture();

    value.state.service = {
      ...(value.state.service as DiagnosticObject),
      metadata: { name: "seaweedfs", namespace: "velero", uid: "service-uid" },
    };
    value.state.slices = [
      { ...(value.state.slices[0] as object), metadata: { name: "seaweedfs-abcde", namespace: "velero" } },
    ];
    // The Pod of the fixture is in the namespace of the storage: the one of the installation has none.
    expect(await value.refused(BARE_URL, bare)).toEqual({ code: "not-found", stage: "pod" });
    expect(value.asked.slice(0, 2)).toEqual(["read Service velero/seaweedfs", "list EndpointSlice velero/seaweedfs"]);
    // It was looked for on this machine as well, to know that it is not both.
    expect(value.lookup).toHaveBeenCalledWith("seaweedfs");
  });

  it("asks the allowance of a connection that is not encrypted before it resolves a name that is no Service", async () => {
    const value = fixture({ lookups: { minio: ["203.0.113.7"] } });
    const plain = location({ s3Url: "http://minio:9000", s3ForcePathStyle: "true" });
    const url = `http://minio:9000/bucket/${KEY}${QUERY}`;

    expect(await value.refused(url, plain)).toEqual({
      code: "destination-denied",
      stage: "route",
      verdict: "allowance",
      needs: { what: "http", origin: "http://minio:9000" },
    });
    // The cluster was asked whether it is a Service, and nothing was resolved on this machine.
    expect(value.asked).toEqual(["read Service velero/minio"]);
    expect(value.lookup).not.toHaveBeenCalled();
    // Once allowed, it is resolved and connected to.
    value.allowances.add("http http://minio:9000");
    expect((await value.resolve(url, plain)).route).toMatchObject({ address: "203.0.113.7", mode: "direct" });
    expect(value.lookup).toHaveBeenCalledTimes(1);
  });

  it("takes a name with a namespace for the Service of that name in that namespace", async () => {
    const value = fixture();
    const pair = location({ s3Url: "http://seaweedfs.storage:8333", s3ForcePathStyle: "true" });
    const resolved = await value.resolve(`http://seaweedfs.storage:8333/bucket/${KEY}${QUERY}`, pair);

    expect(resolved.route).toMatchObject({ mode: "tunnel", address: "127.0.0.1" });
    expect(value.asked[0]).toBe("read Service storage/seaweedfs");
  });

  it("refuses as ambiguous a name that is a Service and resolves on this machine as well", async () => {
    const value = fixture({ lookups: { "seaweedfs.storage": ["203.0.113.7"] } });
    const pair = location({ s3Url: "http://seaweedfs.storage:8333", s3ForcePathStyle: "true" });

    expect(await value.refused(`http://seaweedfs.storage:8333/bucket/${KEY}${QUERY}`, pair)).toEqual({
      code: "destination-denied",
      stage: "route",
      verdict: "ambiguous",
    });
    expect(value.tunnel).not.toHaveBeenCalled();
  });

  it("takes a name that is no Service for a name of this machine, and says which read was refused when it cannot know", async () => {
    const value = fixture({ lookups: { "example.com": ["93.184.216.34"] } });
    const outside = location({ s3Url: "https://example.com", s3ForcePathStyle: "true" });
    const resolved = await value.resolve(`https://example.com/bucket/${KEY}${QUERY}`, outside);

    expect(resolved.route).toEqual({
      origin: "https://example.com",
      pathname: `/bucket/${KEY}`,
      address: "93.184.216.34",
      port: 443,
      mode: "direct",
      allowHttp: false,
      allowPrivate: false,
    });
    expect(value.asked).toEqual(["read Service com/example"]);
    // An identity that may not read Services cannot tell: the route says that the name only may be one,
    // and connects to nothing.
    value.state.refuse = "Service";
    expect(await value.refused(`https://example.com/bucket/${KEY}${QUERY}`, outside)).toEqual({
      code: "forbidden",
      stage: "service",
      verdict: "candidate",
    });
    expect(value.lookup).toHaveBeenCalledTimes(1);
  });
});

describe("the route to a store this machine resolves", () => {
  const outside = location({ s3Url: "https://s3.storage.example:9000", s3ForcePathStyle: "true" });
  const URL_OUTSIDE = `https://s3.storage.example:9000/bucket/${KEY}${QUERY}`;

  it("resolves the name once, connects to the first address that is allowed, and asks the cluster nothing", async () => {
    const value = fixture({
      lookups: { "s3.storage.example": ["169.254.169.254", "::1", "203.0.113.7", "203.0.113.8"] },
    });
    const resolved = await value.resolve(URL_OUTSIDE, outside);

    expect(resolved.route).toEqual({
      origin: "https://s3.storage.example:9000",
      pathname: `/bucket/${KEY}`,
      address: "203.0.113.7",
      port: 9000,
      mode: "direct",
      allowHttp: false,
      allowPrivate: false,
    });
    expect(value.lookup).toHaveBeenCalledTimes(1);
    expect(value.asked).toEqual([]);
    expect(value.tunnel).not.toHaveBeenCalled();
    await resolved.close();
  });

  it("denies a name that gives only addresses that are never connected to, whatever was allowed", async () => {
    for (const addresses of [
      ["169.254.169.254"],
      ["127.0.0.1", "::1"],
      ["fd00:ec2::254"],
      ["0.0.0.0"],
      ["ff02::1"],
      ["not an address"],
    ]) {
      const value = fixture({
        lookups: { "s3.storage.example": addresses },
        allowed: ["private https://s3.storage.example:9000", "http https://s3.storage.example:9000"],
      });

      expect([addresses, await value.refused(URL_OUTSIDE, outside)]).toEqual([
        addresses,
        { code: "destination-denied", stage: "route", verdict: "address" },
      ]);
    }
    // The name of a metadata service is refused before it is resolved.
    const value = fixture({ lookups: { "metadata.google.internal": ["203.0.113.7"] } });
    const metadata = location({ s3Url: "http://metadata.google.internal", s3ForcePathStyle: "true" });

    expect(await value.refused(`http://metadata.google.internal/bucket/${KEY}${QUERY}`, metadata)).toMatchObject({
      verdict: "address",
    });
    expect(value.lookup).not.toHaveBeenCalled();
  });

  it("asks the allowance of a private address, and connects to it once it was given for that origin", async () => {
    const lookups = { "s3.storage.example": ["10.1.2.3"] };

    expect(await fixture({ lookups }).refused(URL_OUTSIDE, outside)).toEqual({
      code: "destination-denied",
      stage: "route",
      verdict: "allowance",
      needs: { what: "private", origin: "https://s3.storage.example:9000" },
    });
    // Allowed for another origin, it is not allowed for this one.
    expect(
      await fixture({ lookups, allowed: ["private https://other.example"] }).refused(URL_OUTSIDE, outside),
    ).toMatchObject({ verdict: "allowance" });
    const allowed = fixture({ lookups, allowed: ["private https://s3.storage.example:9000"] });

    expect((await allowed.resolve(URL_OUTSIDE, outside)).route).toMatchObject({
      address: "10.1.2.3",
      mode: "direct",
      allowPrivate: true,
    });
    // A public address after a private one that is not allowed is the one that is taken.
    const mixed = fixture({ lookups: { "s3.storage.example": ["10.1.2.3", "203.0.113.7"] } });

    expect((await mixed.resolve(URL_OUTSIDE, outside)).route).toMatchObject({
      address: "203.0.113.7",
      allowPrivate: false,
    });
  });

  it("asks the allowance of a connection that is not encrypted, made directly, before it resolves anything", async () => {
    const plain = location({ s3Url: "http://s3.storage.example:9000", s3ForcePathStyle: "true" });
    const url = `http://s3.storage.example:9000/bucket/${KEY}${QUERY}`;
    const lookups = { "s3.storage.example": ["203.0.113.7"] };
    const value = fixture({ lookups });

    expect(await value.refused(url, plain)).toEqual({
      code: "destination-denied",
      stage: "route",
      verdict: "allowance",
      needs: { what: "http", origin: "http://s3.storage.example:9000" },
    });
    expect(value.lookup).not.toHaveBeenCalled();
    const allowed = fixture({ lookups, allowed: ["http http://s3.storage.example:9000"] });

    expect((await allowed.resolve(url, plain)).route).toMatchObject({ address: "203.0.113.7", allowHttp: true });
  });

  it("says that the store was not reached when its name does not resolve", async () => {
    const value = fixture();

    expect(await value.refused(URL_OUTSIDE, outside)).toEqual({ code: "transport-unreachable", stage: "route" });
    // Nothing of what the resolver raised is in what is said.
    const raised = await value.resolve(URL_OUTSIDE, outside).catch((error: unknown) => error);

    expect(JSON.stringify([raised, (raised as Error).message])).not.toMatch(/ENOTFOUND|storage\.example/);
  });

  it("takes an address that is the host of the URL as it is, by what it is", async () => {
    const value = fixture({ allowed: ["private https://10.1.2.3:9000"] });
    const literal = location({ s3Url: "https://10.1.2.3:9000", s3ForcePathStyle: "true" });

    expect((await value.resolve(`https://10.1.2.3:9000/bucket/${KEY}${QUERY}`, literal)).route).toMatchObject({
      address: "10.1.2.3",
      allowPrivate: true,
    });
    expect(value.lookup).not.toHaveBeenCalled();
    const loopback = location({ s3Url: "https://[::1]:9000", s3ForcePathStyle: "true" });

    expect(await value.refused(`https://[::1]:9000/bucket/${KEY}${QUERY}`, loopback)).toMatchObject({
      verdict: "address",
    });
    // An IPv4 address written inside an IPv6 one is not an address a socket is given: it is denied as
    // such, and the operator is not asked to allow what could not be connected to.
    for (const host of ["[::ffff:10.0.0.1]", "[::ffff:8.8.8.8]", "[::ffff:a00:1]"]) {
      const mapped = location({ s3Url: `https://${host}:9000`, s3ForcePathStyle: "true" });

      expect([host, await value.refused(`https://${host}:9000/bucket/${KEY}${QUERY}`, mapped)]).toEqual([
        host,
        { code: "destination-denied", stage: "route", verdict: "address" },
      ]);
    }
    // The same for a name that resolves to one, beside an address that is allowed.
    const named = fixture({ lookups: { "s3.storage.example": ["::ffff:10.0.0.1", "203.0.113.7"] } });
    const outside = location({ s3Url: "https://s3.storage.example:9000", s3ForcePathStyle: "true" });

    expect((await named.resolve(`https://s3.storage.example:9000/bucket/${KEY}${QUERY}`, outside)).route).toMatchObject(
      {
        address: "203.0.113.7",
      },
    );
  });
});

describe("the origin and the path of the URL, before any route", () => {
  it("asks the allowance of an origin the storage location does not give, for that location, and resolves nothing before", async () => {
    const value = fixture({ lookups: { "elsewhere.example": ["203.0.113.7"] } });
    const url = `https://elsewhere.example/bucket/${KEY}${QUERY}`;

    expect(await value.refused(url, inCluster)).toEqual({
      code: "destination-denied",
      stage: "route",
      verdict: "allowance",
      needs: { what: "origin", origin: "https://elsewhere.example", location: "velero/default" },
    });
    expect(value.lookup).not.toHaveBeenCalled();
    expect(value.asked).toEqual([]);
    // Allowed for another location, it is not allowed for this one.
    expect(
      await fixture({ allowed: ["origin https://elsewhere.example velero/secondary"] }).refused(url, inCluster),
    ).toMatchObject({ verdict: "allowance" });
    const allowed = fixture({
      lookups: { "elsewhere.example": ["203.0.113.7"] },
      allowed: ["origin https://elsewhere.example velero/default"],
    });

    // Where the bucket is in such a URL is not known: the key is taken with it or without it.
    expect((await allowed.resolve(url, inCluster)).route).toMatchObject({ address: "203.0.113.7", mode: "direct" });
    expect((await allowed.resolve(`https://elsewhere.example/${KEY}${QUERY}`, inCluster)).route).toMatchObject({
      pathname: `/${KEY}`,
    });
  });

  it("denies a URL that is not of the file that was asked, on an origin the location gives and on one that was allowed", async () => {
    const value = fixture({ allowed: ["origin https://elsewhere.example velero/default"] });

    for (const url of [
      `http://seaweedfs.storage.svc:8333/bucket/backups/nightly/nightly.tar.gz${QUERY}`,
      `http://seaweedfs.storage.svc:8333/bucket/backups/other/other-logs.gz${QUERY}`,
      `http://seaweedfs.storage.svc:8333/another/${KEY}${QUERY}`,
      `http://seaweedfs.storage.svc:8333/${KEY}${QUERY}`,
      `https://elsewhere.example/bucket/backups/nightly/velero-backup.json${QUERY}`,
    ])
      expect([url, await value.refused(url, inCluster)]).toEqual([
        url,
        { code: "destination-denied", stage: "route", verdict: "path" },
      ]);
    expect(value.asked).toEqual([]);
    expect(value.lookup).not.toHaveBeenCalled();
  });

  it("refuses what is not a URL the extension takes, and the URL of the store of a location that has a public one", async () => {
    const value = fixture();

    for (const url of [
      `ftp://seaweedfs.storage.svc:8333/bucket/${KEY}`,
      `http://user@seaweedfs.storage.svc:8333/bucket/${KEY}`,
      `http://seaweedfs.storage.svc:8333/bucket/${KEY}#x`,
      "not a url",
    ])
      expect([url, await value.refused(url, inCluster)]).toEqual([
        url,
        { code: "destination-denied", stage: "route", verdict: "url" },
      ]);
    const published = location({
      s3Url: "http://seaweedfs.storage.svc:8333",
      publicUrl: "https://storage.example",
      s3ForcePathStyle: "true",
    });

    expect(await value.refused(SERVICE_URL, published)).toEqual({
      code: "destination-denied",
      stage: "route",
      verdict: "public-url",
    });
    expect(value.asked).toEqual([]);
  });

  it("carries the signed URL in nothing it raises", async () => {
    const value = fixture();
    const raised: unknown[] = [];

    for (const url of [
      `https://elsewhere.example/bucket/${KEY}${QUERY}`,
      `http://seaweedfs.storage.svc:8333/bucket/other${QUERY}`,
      `http://seaweedfs.storage.svc:9999/bucket/${KEY}${QUERY}`,
    ])
      raised.push(await value.resolve(url, inCluster).catch((error: unknown) => error));
    for (const error of raised) {
      expect(error).toBeInstanceOf(DiagnosticError);
      expect(JSON.stringify([error, (error as Error).message, (error as Error).stack])).not.toMatch(
        /PRIVATE-SENTINEL|X-Amz|nightly-logs/,
      );
    }
  });

  it("stops when the operation was stopped while a name was resolved", async () => {
    const controller = new AbortController();
    const value = fixture();

    value.lookup.mockImplementationOnce(async () => {
      controller.abort();
      return ["203.0.113.7"];
    });
    await expect(
      value.resolve(
        `https://s3.storage.example:9000/bucket/${KEY}${QUERY}`,
        location({ s3Url: "https://s3.storage.example:9000", s3ForcePathStyle: "true" }),
        controller.signal,
      ),
    ).rejects.toMatchObject({ code: "cancelled", stage: "route" });
  });
});
