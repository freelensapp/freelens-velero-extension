// What the views show of a request before it is created is what the cluster is sent: the whole way, from
// the client of the views through the IPC of the host, the gate and the adapter of the main process, to
// an API server of the test that keeps every request it receives.

import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:https";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { hostCatalog, resetIpc } from "../../test/freelens-extensions";
import { createTlsFixture } from "../../test/tls-fixture";
import { REQUEST_LABELS, REQUEST_PREFIX } from "../common/ipc";
import { VeleroIpcRenderer } from "../renderer/api/ipc";
import { catalogEntries, VeleroIpc } from "./ipc";

const CLUSTER = "synthetic-cluster";
const CONTEXT = "kind-synthetic";
const NAMESPACE = "velero";
const REQUESTS = `/apis/velero.io/v1/namespaces/${NAMESPACE}/serverstatusrequests`;
const PROCESSED = {
  phase: "Processed",
  serverVersion: "v1.18.2",
  processedTimestamp: "2026-09-30T10:00:00Z",
  plugins: [
    { name: "velero.io/pod", kind: "BackupItemAction" },
    { name: "velero.io/aws", kind: "ObjectStore" },
  ],
};

let certificates: Awaited<ReturnType<typeof createTlsFixture>>;
let server: Server;
let kubeconfig: string;
let main: VeleroIpc;
let renderer: VeleroIpcRenderer;
// What the API server of the test was sent, and what it does with a creation.
const received: { method?: string; path?: string; body?: unknown }[] = [];
let refuseCreation = false;
let reads = 0;

beforeAll(async () => {
  certificates = await createTlsFixture();
  server = createServer(certificates, async (request, response) => {
    const chunks: Buffer[] = [];

    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : undefined;

    received.push({ method: request.method, path: request.url, ...(body === undefined ? {} : { body }) });
    if (request.headers.authorization !== "Bearer synthetic-token") {
      response.writeHead(401).end();
      return;
    }
    const object = {
      apiVersion: "velero.io/v1",
      kind: "ServerStatusRequest",
      metadata: { name: `${REQUEST_PREFIX}abcde`, namespace: NAMESPACE, uid: "request-uid" },
      spec: {},
    };

    if (request.method === "POST" && request.url === REQUESTS) {
      if (refuseCreation) response.writeHead(403).end();
      else response.writeHead(201).end(JSON.stringify(object));
      return;
    }
    if (request.method === "GET" && request.url === `${REQUESTS}/${object.metadata.name}`) {
      reads += 1;
      // The server has not looked at the request the first time it is read.
      response.end(JSON.stringify(reads > 1 ? { ...object, status: PROCESSED } : object));
      return;
    }
    response.writeHead(404).end();
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();

  if (!address || typeof address === "string") throw new Error("Missing API fixture listener");
  kubeconfig = join(certificates.directory, "kubeconfig.json");
  await writeFile(
    kubeconfig,
    JSON.stringify({
      apiVersion: "v1",
      kind: "Config",
      contexts: [{ name: CONTEXT, context: { cluster: "synthetic", user: "synthetic" } }],
      clusters: [
        {
          name: "synthetic",
          cluster: {
            server: `https://127.0.0.1:${address.port}`,
            "certificate-authority-data": Buffer.from(certificates.ca).toString("base64"),
          },
        },
      ],
      users: [{ name: "synthetic", user: { token: "synthetic-token" } }],
    }),
    { mode: 0o600 },
  );
});

beforeEach(() => {
  received.length = 0;
  refuseCreation = false;
  reads = 0;
  resetIpc();
  hostCatalog.clusters = [{ id: CLUSTER, name: "synthetic", kubeConfigPath: kubeconfig, contextName: CONTEXT }];
  main = VeleroIpc.createInstance({} as never);
  main.register(catalogEntries);
  renderer = VeleroIpcRenderer.createInstance({} as never);
});

afterEach(() => {
  main.release();
  hostCatalog.clusters = undefined;
  resetIpc();
});

afterAll(async () => {
  server?.closeAllConnections();
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  await certificates?.dispose();
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
    expect(received).toEqual([]);
    const answer = await renderer.runServerStatus(CLUSTER, NAMESPACE, token, randomUUID());

    expect(received[0]).toEqual({
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
        version: "v1.18.2",
        processed: "2026-09-30T10:00:00Z",
        plugins: PROCESSED.plugins,
        request: { name: `${REQUEST_PREFIX}abcde`, uid: "request-uid" },
      },
    });
    // One creation, then the reads of the request by the name the API gave it; nothing is deleted or changed.
    expect(received.map((request) => `${request.method} ${request.path}`)).toEqual([
      `POST ${REQUESTS}`,
      `GET ${REQUESTS}/${REQUEST_PREFIX}abcde`,
      `GET ${REQUESTS}/${REQUEST_PREFIX}abcde`,
    ]);
  });

  it("runs once for a confirmation: the token of a write that ran creates nothing more", async () => {
    const token = await confirmed();

    await renderer.runServerStatus(CLUSTER, NAMESPACE, token, randomUUID());
    const posted = received.filter((request) => request.method === "POST").length;
    const again = await renderer.runServerStatus(CLUSTER, NAMESPACE, token, randomUUID());

    expect(again).toMatchObject({ ok: false, code: "forbidden", stage: "confirmation" });
    expect(received.filter((request) => request.method === "POST")).toHaveLength(posted);
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
    expect(received.map((request) => request.method)).toEqual(["POST"]);
    expect(await renderer.state(CLUSTER)).toMatchObject({
      ok: true,
      value: { writes: { on: true, namespace: NAMESPACE } },
    });
  });
});
