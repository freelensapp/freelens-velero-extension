// What the views show of a request before it is created is what the cluster is sent: the whole way, from
// the client of the views through the IPC of the host, the gate and the adapter of the main process, and
// the client of the host for the cluster, to an API server of the test that keeps every request it
// receives.

import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { anExtension, hostCatalog, hostCluster, resetIpc } from "../../test/freelens-extensions";
import { answered, fakeHostClient, type HostRequest, statusOf } from "../../test/host-client";
import { REQUEST_LABELS, REQUEST_PREFIX } from "../common/ipc";
import { VeleroIpcRenderer } from "../renderer/api/ipc";
import { catalogEntries, hostDependencies } from "./host";
import { VeleroIpc } from "./ipc";

const CLUSTER = "synthetic-cluster";
const CONTEXT = "kind-synthetic";
const NAMESPACE = "velero";
const REQUESTS = `/apis/velero.io/v1/namespaces/${NAMESPACE}/serverstatusrequests`;
const PROCESSED = {
  phase: "Processed",
  serverVersion: "v1.18.4",
  processedTimestamp: "2026-09-30T10:00:00Z",
  plugins: [
    { name: "velero.io/pod", kind: "BackupItemAction" },
    { name: "velero.io/aws", kind: "ObjectStore" },
  ],
};

let main: VeleroIpc;
let renderer: VeleroIpcRenderer;
let refuseCreation = false;
let reads = 0;

// The API server of the test, behind the client of the host: a creation, and the reads of the request it
// created, which the server processes at the second.
function server(request: HostRequest) {
  const object = {
    apiVersion: "velero.io/v1",
    kind: "ServerStatusRequest",
    metadata: { name: `${REQUEST_PREFIX}abcde`, namespace: NAMESPACE, uid: "request-uid" },
    spec: {},
  };

  if (request.method === "POST" && request.path === REQUESTS)
    return refuseCreation ? answered(403, statusOf(403, "Forbidden")) : answered(201, object);
  if (request.method === "GET" && request.path === `${REQUESTS}/${object.metadata.name}`) {
    reads += 1;
    // The server has not looked at the request the first time it is read.
    return answered(200, reads > 1 ? { ...object, status: PROCESSED } : object);
  }
  return answered(404, statusOf(404, "NotFound"));
}

let host = fakeHostClient(server);
// What the API server of the test was sent.
const received = () =>
  host.requests.map((request) => ({
    method: request.method,
    path: request.path,
    ...(request.body === undefined ? {} : { body: request.body }),
  }));

beforeEach(() => {
  refuseCreation = false;
  reads = 0;
  host = fakeHostClient(server);
  resetIpc();
  // No file is behind the path of the catalog: the extension reads no kubeconfig.
  hostCatalog.clusters = [
    {
      id: CLUSTER,
      name: "synthetic",
      kubeConfigPath: "/synthetic/kubeconfig",
      contextName: CONTEXT,
      status: "connected",
    },
  ];
  hostCluster.forCluster = host.forCluster;
  main = VeleroIpc.createInstance(anExtension("main") as never);
  // The procedures as the extension registers them, with what it takes of the host.
  main.register(
    catalogEntries,
    hostDependencies(() => "/synthetic/extensions/velero/package.json"),
  );
  renderer = VeleroIpcRenderer.createInstance(anExtension("renderer") as never);
});

afterEach(() => {
  main.release();
  hostCatalog.clusters = undefined;
  hostCluster.forCluster = undefined;
  resetIpc();
});

// Turns writes on and confirms one ServerStatusRequest, as the band of the server does with its two gestures.
async function confirmed(): Promise<string> {
  const enabled = await renderer.enable(CLUSTER, NAMESPACE, { context: CONTEXT, namespace: NAMESPACE });
  const confirmation = await renderer.confirm(CLUSTER, NAMESPACE, "ServerStatusRequest");

  if (!enabled.ok || !confirmation.ok) throw new Error("The gate of the test did not open");
  return confirmation.value.token;
}

describe("the object of a request, as the cluster is sent it", () => {
  it("names what the specs name: the prefix of the generated name and the label of the extension", () => {
    expect(REQUEST_PREFIX).toBe("freelens-velero-");
    expect(REQUEST_LABELS).toEqual({ "app.kubernetes.io/managed-by": "freelens-velero-extension" });
  });

  it("is the one the confirmation of the views shows, and nothing is sent before the write is run", async () => {
    const token = await confirmed();

    // Turning writes on and confirming a write ask the cluster nothing.
    expect(received()).toEqual([]);
    const answer = await renderer.runServerStatus(CLUSTER, NAMESPACE, token, randomUUID());

    expect(received()[0]).toEqual({
      method: "POST",
      path: REQUESTS,
      body: {
        apiVersion: "velero.io/v1",
        kind: "ServerStatusRequest",
        metadata: { namespace: NAMESPACE, generateName: REQUEST_PREFIX, labels: REQUEST_LABELS },
        // An empty spec and no phase, which the release reads as a new request.
        spec: {},
      },
    });
    expect(answer).toEqual({
      ok: true,
      value: {
        version: "v1.18.4",
        processed: "2026-09-30T10:00:00Z",
        plugins: PROCESSED.plugins,
        request: { name: `${REQUEST_PREFIX}abcde`, uid: "request-uid" },
      },
    });
    // One creation, then the reads of the request by the name the API gave it; nothing is deleted or changed.
    expect(received().map((request) => `${request.method} ${request.path}`)).toEqual([
      `POST ${REQUESTS}`,
      `GET ${REQUESTS}/${REQUEST_PREFIX}abcde`,
      `GET ${REQUESTS}/${REQUEST_PREFIX}abcde`,
    ]);
    // Every request went through the client of the host for the cluster of the request, and nothing else.
    expect(host.requests.map((request) => [request.cluster, request.call])).toEqual([
      [CLUSTER, "getResponse"],
      [CLUSTER, "getResponse"],
      [CLUSTER, "getResponse"],
    ]);
  });

  it("sends nothing to a cluster that left the connected state, and says so", async () => {
    const token = await confirmed();

    hostCatalog.clusters = hostCatalog.clusters?.map((cluster) => ({ ...cluster, status: "disconnecting" }));
    const answer = await renderer.runServerStatus(CLUSTER, NAMESPACE, token, randomUUID());

    expect(answer).toMatchObject({ ok: false, code: "target-changed", stage: "catalog" });
    expect(received()).toEqual([]);
  });

  it("runs once for a confirmation: the token of a write that ran creates nothing more", async () => {
    const token = await confirmed();

    await renderer.runServerStatus(CLUSTER, NAMESPACE, token, randomUUID());
    const posted = received().filter((request) => request.method === "POST").length;
    const again = await renderer.runServerStatus(CLUSTER, NAMESPACE, token, randomUUID());

    expect(again).toMatchObject({ ok: false, code: "forbidden", stage: "confirmation" });
    expect(received().filter((request) => request.method === "POST")).toHaveLength(posted);
  });

  it("says that the cluster refused the creation, with the kind and the verb it needs, and leaves writes on", async () => {
    const token = await confirmed();

    refuseCreation = true;
    const answer = await renderer.runServerStatus(CLUSTER, NAMESPACE, token, randomUUID());

    expect(answer).toEqual({
      ok: false,
      code: "forbidden",
      stage: "creation",
      retry: false,
      text: "The cluster refused the creation of a ServerStatusRequest: the identity needs the verb create on serverstatusrequests of the namespace.",
    });
    expect(received().map((request) => request.method)).toEqual(["POST"]);
    expect(await renderer.state(CLUSTER)).toMatchObject({
      ok: true,
      value: { writes: { on: true, namespace: NAMESPACE } },
    });
  });
});
