// The procedures as the extension registers them, with the adapter they make for a cluster: every request
// through the client of the host for the cluster of the request, the store inside the cluster reached
// through the kubectl of the host, which no end of the operation leaves running, and the gate following the
// catalog of the host as it changes.

import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { answered, fakeHostClient, type HostReply, type HostRequest, statusOf } from "../../test/host-client";
import { CLUSTER_WORDS } from "../common/diagnostic-text";
import { CHANNELS } from "../common/ipc";
import { DiagnosticError } from "./diagnostic-transport";
import { registerHandlers } from "./ipc";
import type { ChildProcess } from "node:child_process";

import type { CatalogEntry } from "./catalog";
import type { ArtifactRoute } from "./diagnostic-transport";
import type { TunnelHost } from "./diagnostic-tunnel";
import type { IpcEvent, Registrar } from "./ipc";

const FRAME: IpcEvent = {
  senderFrame: { url: "https://cluster-a.renderer.freelens.app:1234/" },
  processId: 1,
  frameId: 4,
};
const NAMESPACE = "velero";
const API = `/apis/velero.io/v1/namespaces/${NAMESPACE}`;
const TARGET = { kind: "Backup" as const, name: "nightly", uid: "backup-uid" };
const SIGNED = `http://seaweedfs.velero.svc:8333/bucket/backups/nightly/nightly-logs.gz?X-Amz-Signature=PRIVATE-SENTINEL`;
const LOG = 'time="2026-09-30T10:00:00Z" level=info msg="Backup completed"';
const KUBECTL = "/synthetic/freelens/binaries/kubectl";
const ENVIRONMENT = { KUBECONFIG: "/synthetic/freelens/kubeconfigs/cluster-a" };

// A kubectl that says it forwards a port once it starts, and ends when it is told to.
class FakeKubectl extends EventEmitter {
  readonly stdout = new EventEmitter();
  readonly stderr = new EventEmitter();
  readonly pid = 4242;
  readonly signals: string[] = [];
  exited = false;

  kill(signal: NodeJS.Signals = "SIGTERM"): boolean {
    this.signals.push(signal);
    if (!this.exited) {
      this.exited = true;
      this.emit("exit", null, signal);
      this.emit("close", null, signal);
    }
    return true;
  }
}

function objectOf(kind: string, name: string, uid: string, more: Record<string, unknown> = {}) {
  return { apiVersion: "v1", kind, metadata: { name, namespace: NAMESPACE, uid }, ...more };
}

// The API server of the test: the backup, its storage location inside the cluster, the request it creates,
// which it signs at its second read, and the Service, the endpoint slices and the Pod of the store.
function server(requests: Map<string, Record<string, unknown>>) {
  return (request: HostRequest): HostReply => {
    const { path } = request;

    if (request.method === "POST" && path === `${API}/downloadrequests`) {
      const body = request.body as { metadata: { name: string } };
      const object = { ...body, metadata: { ...body.metadata, uid: `uid-of-${body.metadata.name}` }, reads: 0 };

      requests.set(body.metadata.name, object);
      return answered(201, object);
    }
    if (path === `${API}/backups/nightly`)
      return answered(200, objectOf("Backup", "nightly", "backup-uid", { spec: { storageLocation: "default" } }));
    if (path === `${API}/backupstoragelocations/default`)
      return answered(
        200,
        objectOf("BackupStorageLocation", "default", "location-uid", {
          spec: {
            provider: "aws",
            objectStorage: { bucket: "bucket" },
            config: { s3Url: "http://seaweedfs.velero.svc:8333", s3ForcePathStyle: "true" },
          },
        }),
      );
    if (path.startsWith(`${API}/downloadrequests/`)) {
      const kept = requests.get(path.split("/").pop() ?? "") as { reads: number } | undefined;

      if (!kept) return answered(404, statusOf(404, "NotFound"));
      kept.reads += 1;
      return answered(200, kept.reads > 1 ? { ...kept, status: { phase: "Processed", downloadURL: SIGNED } } : kept);
    }
    if (path === `/api/v1/namespaces/${NAMESPACE}/services/seaweedfs`)
      return answered(
        200,
        objectOf("Service", "seaweedfs", "service-uid", {
          spec: {
            selector: { app: "seaweedfs" },
            ports: [{ name: "s3", port: 8333, targetPort: "s3", protocol: "TCP" }],
          },
        }),
      );
    if (path === `/apis/discovery.k8s.io/v1/namespaces/${NAMESPACE}/endpointslices`)
      return answered(200, {
        kind: "EndpointSliceList",
        metadata: { resourceVersion: "7" },
        items: [
          {
            metadata: {
              name: "seaweedfs-abcde",
              namespace: NAMESPACE,
              uid: "slice-uid",
              labels: { "kubernetes.io/service-name": "seaweedfs" },
            },
            ports: [{ name: "s3", port: 9333, protocol: "TCP" }],
            endpoints: [
              { conditions: { ready: true }, targetRef: { kind: "Pod", name: "seaweedfs-0", uid: "pod-uid" } },
            ],
          },
        ],
      });
    if (path === `/api/v1/namespaces/${NAMESPACE}/pods/seaweedfs-0`)
      return answered(
        200,
        objectOf("Pod", "seaweedfs-0", "pod-uid", {
          metadata: { name: "seaweedfs-0", namespace: NAMESPACE, uid: "pod-uid", labels: { app: "seaweedfs" } },
          spec: { containers: [{ ports: [{ name: "s3", containerPort: 9333 }] }] },
          status: { conditions: [{ type: "Ready", status: "True" }] },
        }),
      );
    return answered(404, statusOf(404, "NotFound"));
  };
}

function fixture(options: { hang?: boolean } = {}) {
  const catalog: CatalogEntry[] = [
    { id: "cluster-a", name: "demo", kubeConfigPath: "/synthetic/a", contextName: "kind-a", status: "connected" },
    { id: "cluster-b", name: "other", kubeConfigPath: "/synthetic/b", contextName: "kind-b", status: "connected" },
  ];
  const handlers = new Map<string, (event: IpcEvent, payload: unknown) => Promise<unknown>>();
  const broadcasts: unknown[] = [];
  const registrar: Registrar = {
    handle: (channel, handler) => handlers.set(channel, handler),
    broadcast: (channel, ...args) => broadcasts.push([channel, ...args]),
  };
  const host = fakeHostClient(server(new Map()));
  const children: { args: string[]; child: FakeKubectl }[] = [];
  const spawn = vi.fn((_command: string, args: string[]) => {
    const child = new FakeKubectl();

    children.push({ args, child });
    queueMicrotask(() => child.stdout.emit("data", Buffer.from("Forwarding from 127.0.0.1:41821 -> 9333\n")));
    return child as unknown as ChildProcess;
  });
  const statusWatchers = new Set<() => void>();
  const tunnel: TunnelHost = {
    kubectl: vi.fn(async () => KUBECTL),
    environment: vi.fn(async () => ENVIRONMENT),
    entry: (clusterId) => catalog.find((entry) => entry.id === clusterId),
    watchStatus: (clusterId, listener) => {
      const watch = () => listener(catalog.find((entry) => entry.id === clusterId)?.status);

      statusWatchers.add(watch);
      watch();
      return () => statusWatchers.delete(watch);
    },
    cwd: () => "/synthetic/extensions/velero",
  };
  const catalogWatchers = new Set<() => void>();
  const watchCatalog = vi.fn((listener: () => void) => {
    catalogWatchers.add(listener);
    return () => catalogWatchers.delete(listener);
  });
  const routes: ArtifactRoute[] = [];
  const download = vi.fn(async (_url: string, route: ArtifactRoute, signal: AbortSignal) => {
    routes.push(route);
    if (options.hang)
      await new Promise((_resolve, reject) =>
        signal.addEventListener("abort", () => reject(new DiagnosticError("cancelled")), { once: true }),
      );
    return Buffer.from(LOG);
  });
  const dispose = registerHandlers(registrar, {
    catalog: () => catalog,
    client: host.forCluster,
    tunnel,
    spawn,
    watchCatalog,
    download: { download, pollMs: 5 },
  });
  const call = (channel: string, payload: unknown) => {
    const handler = handlers.get(channel);

    if (!handler) throw new Error(`no handler for ${channel}`);
    return handler(FRAME, payload) as Promise<{ ok: boolean; value?: unknown; code?: string; stage?: string }>;
  };
  const enable = () =>
    call(CHANNELS.gateEnable, {
      cluster: "cluster-a",
      namespace: NAMESPACE,
      confirmation: { context: "kind-a", namespace: NAMESPACE },
    });
  const run = async (request = randomUUID()) => {
    const confirmed = await call(CHANNELS.writeConfirm, {
      cluster: "cluster-a",
      namespace: NAMESPACE,
      kind: "DownloadRequest",
      target: TARGET,
      artifact: "BackupLog",
    });

    return call(CHANNELS.writeRun, {
      cluster: "cluster-a",
      namespace: NAMESPACE,
      kind: "DownloadRequest",
      target: TARGET,
      artifact: "BackupLog",
      token: (confirmed.value as { token: string }).token,
      request,
    });
  };
  // A change of the state of a cluster, as the host makes it: the entry changes, and the reactions on the
  // catalog run.
  const status = (clusterId: string, next: string) => {
    const index = catalog.findIndex((entry) => entry.id === clusterId);

    catalog[index] = { ...catalog[index], status: next };
    for (const watcher of [...catalogWatchers]) watcher();
    for (const watcher of [...statusWatchers]) watcher();
  };

  return {
    catalog,
    host,
    children,
    spawn,
    tunnel,
    watchCatalog,
    catalogWatchers,
    routes,
    broadcasts,
    call,
    enable,
    run,
    status,
    dispose,
  };
}

describe("the way of a download through the host", () => {
  it("asks the cluster of the request through the client of the host and nothing else, and reaches the store through the kubectl of the host", async () => {
    const value = fixture();

    await value.enable();
    const answer = await value.run();

    expect(answer).toMatchObject({ ok: true, value: { route: { mode: "tunnel", encrypted: false } } });
    expect(value.host.requests.map((request) => [request.cluster, request.call, request.method, request.path])).toEqual(
      [
        `${API}/backups/nightly`,
        `${API}/backupstoragelocations/default`,
        `${API}/backups/nightly`,
        `${API}/downloadrequests`,
        "read",
        "read",
        `/api/v1/namespaces/${NAMESPACE}/services/seaweedfs`,
        `/apis/discovery.k8s.io/v1/namespaces/${NAMESPACE}/endpointslices`,
        `/api/v1/namespaces/${NAMESPACE}/pods/seaweedfs-0`,
        `${API}/backups/nightly`,
      ].map((path, index) => [
        "cluster-a",
        "getResponse",
        index === 3 ? "POST" : "GET",
        path === "read" ? expect.stringMatching(new RegExp(`^${API}/downloadrequests/nightly-`)) : path,
      ]),
    );
    // One kubectl, the one of the host for the cluster, to the port of the Pod; the transport went to the
    // port kubectl gave, and kubectl was killed when the download ended.
    expect(value.tunnel.kubectl).toHaveBeenCalledWith("cluster-a");
    expect(value.children.map((run) => run.args)).toEqual([
      ["port-forward", "--address", "127.0.0.1", "--namespace", NAMESPACE, "pod/seaweedfs-0", ":9333"],
    ]);
    expect(value.routes).toEqual([
      expect.objectContaining({
        address: "127.0.0.1",
        port: 41821,
        mode: "tunnel",
        origin: "http://seaweedfs.velero.svc:8333",
      }),
    ]);
    expect(value.children[0].child.signals).toEqual(["SIGTERM"]);
    value.dispose();
  });

  it("kills kubectl when the operator cancels the download it was opened for", async () => {
    const value = fixture({ hang: true });

    await value.enable();
    const request = randomUUID();
    const running = value.run(request);

    await vi.waitFor(() => expect(value.routes).toHaveLength(1));
    expect(value.children[0].child.signals).toEqual([]);
    expect(await value.call(CHANNELS.writeCancel, { cluster: "cluster-a", request })).toEqual({
      ok: true,
      value: null,
    });
    expect(await running).toMatchObject({ ok: false, code: "cancelled", stage: "download" });
    expect(value.children[0].child.signals).toEqual(["SIGTERM"]);
    value.dispose();
  });

  it("kills kubectl when the extension is deactivated while a download runs, and leaves no hook on the process", async () => {
    const hooks = process.listenerCount("exit");
    const value = fixture({ hang: true });

    await value.enable();
    const running = value.run();

    await vi.waitFor(() => expect(value.routes).toHaveLength(1));
    // The hook that kills kubectl when the process exits is there while kubectl runs.
    expect(process.listenerCount("exit")).toBe(hooks + 1);
    value.dispose();
    expect(value.children[0].child.signals[0]).toBe("SIGTERM");
    expect(await running).toMatchObject({ ok: false, code: "cancelled" });
    // A deactivation leaves nothing of the extension on the process.
    expect(process.listenerCount("exit")).toBe(hooks);
  });

  it("kills kubectl, turns writes off and tells the frame when the cluster leaves the connected state", async () => {
    const value = fixture({ hang: true });

    await value.enable();
    const running = value.run();

    await vi.waitFor(() => expect(value.routes).toHaveLength(1));
    value.status("cluster-a", "disconnecting");
    expect(value.children[0].child.signals[0]).toBe("SIGTERM");
    expect(value.broadcasts).toContainEqual([CHANNELS.gateChanged, { cluster: "cluster-a" }]);
    expect(await running).toMatchObject({ ok: false });
    // The frame that asks again is told that its cluster is not connected, and nothing more is asked of the
    // cluster: it stays disconnected.
    const asked = value.host.requests.length;
    const refused = {
      ok: false,
      code: "target-changed",
      stage: "catalog",
      retry: false,
      text: CLUSTER_WORDS.disconnected,
    };

    expect(await value.call(CHANNELS.gateState, { cluster: "cluster-a" })).toEqual(refused);
    expect(await value.enable()).toEqual(refused);
    expect(value.host.requests).toHaveLength(asked);
    // Connected again, the cluster has writes off until they are turned on.
    value.status("cluster-a", "connected");
    expect(await value.call(CHANNELS.gateState, { cluster: "cluster-a" })).toMatchObject({
      ok: true,
      value: { writes: { on: false } },
    });
    value.dispose();
  });
});

describe("the gate following the catalog of the host", () => {
  it("watches the catalog once writes are on and not before, at once and not at the next poll, and lets it go when released", async () => {
    const value = fixture();

    expect(value.watchCatalog).not.toHaveBeenCalled();
    await value.enable();
    await value.enable();
    expect(value.watchCatalog).toHaveBeenCalledTimes(1);
    // A change of the catalog turns writes off at once, and tells the frames.
    value.catalog[0] = { ...value.catalog[0], contextName: "kind-renamed" };
    for (const watcher of [...value.catalogWatchers]) watcher();
    expect(value.broadcasts).toEqual([[CHANNELS.gateChanged, { cluster: "cluster-a" }]]);
    expect(await value.call(CHANNELS.gateState, { cluster: "cluster-a" })).toMatchObject({
      ok: true,
      value: { writes: { on: false } },
    });
    value.dispose();
    expect(value.catalogWatchers.size).toBe(0);
    // Nothing of a cluster was asked for any of it.
    expect(value.host.requests).toEqual([]);
  });
});
