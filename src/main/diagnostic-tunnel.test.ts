import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { createServer, type Server } from "node:https";
import { createRequire } from "node:module";
import { connect } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { KubeConfig } from "@kubernetes/client-node/dist/config.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type WebSocket, WebSocketServer } from "ws";
import { createTlsFixture } from "../../test/tls-fixture";
import { openPodTunnel } from "./diagnostic-tunnel";

let certificates: Awaited<ReturnType<typeof createTlsFixture>>;
let server: Server;
let websocketServer: WebSocketServer;
let configuration: KubeConfig;
let requests: { url?: string; authorization?: string }[] = [];
let stream = Buffer.alloc(0);
let streaming: WebSocket | undefined;

const FRAME = 32 * 1024;
const pending = () => streaming?.bufferedAmount ?? 0;

beforeAll(async () => {
  certificates = await createTlsFixture();
  server = createServer(certificates);
  websocketServer = new WebSocketServer({ server });
  websocketServer.on("connection", (socket, request) => {
    requests.push({ url: request.url, authorization: request.headers.authorization });
    socket.send(Buffer.from([0, 141, 32]));
    socket.send(Buffer.from([1, 141, 32]));
    if (request.url?.includes("/pods/stream/")) {
      // The pod answers with the whole payload and closes at once.
      streaming = socket;
      for (let offset = 0; offset < stream.length; offset += FRAME)
        socket.send(Buffer.concat([Buffer.from([0]), stream.subarray(offset, offset + FRAME)]));
      socket.close();
      return;
    }
    socket.on("message", (message) => socket.send(message));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();

  if (!address || typeof address === "string") throw new Error("Missing local websocket listener");
  configuration = new KubeConfig();
  configuration.loadFromString(
    JSON.stringify({
      apiVersion: "v1",
      kind: "Config",
      "current-context": "test",
      contexts: [{ name: "test", context: { cluster: "test", user: "test" } }],
      clusters: [
        {
          name: "test",
          cluster: {
            server: `https://127.0.0.1:${address.port}`,
            "certificate-authority-data": Buffer.from(certificates.ca).toString("base64"),
          },
        },
      ],
      users: [{ name: "test", user: { token: "synthetic" } }],
    }),
  );
});
afterAll(async () => {
  for (const client of websocketServer?.clients ?? []) client.terminate();
  websocketServer?.close();
  server?.closeAllConnections();
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  await certificates?.dispose();
});

describe("owned Kubernetes pod tunnel", () => {
  const target = { namespace: "fixture", name: "storage", uid: "pod-uid", port: 8333 };
  const api = (name = "storage") => ({
    configuration,
    assertCurrent: () => {},
    read: async () => ({
      metadata: { namespace: "fixture", name, uid: "pod-uid" },
      spec: { containers: [{ ports: [{ containerPort: 8333 }] }] },
      status: { conditions: [{ type: "Ready", status: "True" }] },
    }),
  });
  const compiled = () => {
    const globals = globalThis as typeof globalThis & { LensExtensions?: unknown };
    const previous = globals.LensExtensions;

    globals.LensExtensions = { Main: { LensExtension: class {} }, Common: {}, Renderer: {} };
    try {
      return (createRequire(import.meta.url)("../../out/main/index.js") as { openPodTunnel: typeof openPodTunnel })
        .openPodTunnel;
    } finally {
      if (previous === undefined) delete globals.LensExtensions;
      else globals.LensExtensions = previous;
    }
  };

  it.each([
    "source",
    "compiled",
  ])("forwards through the %s implementation and releases sockets/listener", async (mode) => {
    const open = mode === "compiled" ? compiled() : openPodTunnel;

    requests = [];
    const tunnel = await open(api(), target, new AbortController().signal);
    const socket = connect(tunnel.port, tunnel.address);

    try {
      await once(socket, "connect");
      const response = once(socket, "data");
      socket.write("synthetic-port-forward");
      expect((await response)[0].toString()).toBe("synthetic-port-forward");
      expect(requests).toEqual([
        { url: "/api/v1/namespaces/fixture/pods/storage/portforward?ports=8333", authorization: "Bearer synthetic" },
      ]);
    } finally {
      socket.destroy();
      await tunnel.close();
    }
    const refused = connect(tunnel.port, tunnel.address);

    await expect(once(refused, "connect")).rejects.toMatchObject({ code: "ECONNREFUSED" });
  });

  it.each([
    "source",
    "compiled",
  ])("delivers the whole stream through the %s implementation when the pod side closes first", async (mode) => {
    const open = mode === "compiled" ? compiled() : openPodTunnel;

    stream = randomBytes(8 * 1024 ** 2);
    const tunnel = await open(api("stream"), { ...target, name: "stream" }, new AbortController().signal);
    const socket = connect(tunnel.port, tunnel.address);
    const received: Buffer[] = [];
    const failures: unknown[] = [];

    try {
      socket.on("error", (error) => failures.push(error));
      // A consumer slower than the pod: it stops after every chunk.
      socket.on("data", (chunk: Buffer) => {
        received.push(chunk);
        socket.pause();
        setTimeout(() => socket.resume(), 1);
      });
      await once(socket, "close");
      expect(failures).toEqual([]);
      expect(Buffer.concat(received).equals(stream)).toBe(true);
    } finally {
      socket.destroy();
      await tunnel.close();
    }
  }, 60_000);

  it("holds the pod side back while the consumer does not read", async () => {
    stream = randomBytes(48 * 1024 ** 2);
    streaming = undefined;
    const tunnel = await openPodTunnel(api("stream"), { ...target, name: "stream" }, new AbortController().signal);
    const socket = connect(tunnel.port, tunnel.address);
    let received = 0;

    try {
      socket.pause();
      await once(socket, "connect");
      await delay(500);
      // Nothing can take 48 MiB while the consumer is still: what is left waits on the side of the pod.
      expect(pending()).toBeGreaterThan(16 * 1024 ** 2);
      socket.on("data", (chunk: Buffer) => {
        received += chunk.length;
      });
      socket.resume();
      await once(socket, "close");
      expect(received).toBe(stream.length);
    } finally {
      socket.destroy();
      await tunnel.close();
    }
  }, 60_000);

  it("refuses changed pod identities and undeclared ports before opening a listener", async () => {
    await expect(
      openPodTunnel(api(), { ...target, uid: "recreated" }, new AbortController().signal),
    ).rejects.toMatchObject({ code: "target-changed" });
    await expect(openPodTunnel(api(), { ...target, port: 1234 }, new AbortController().signal)).rejects.toMatchObject({
      code: "target-changed",
    });
  });

  it("closes an unused listener on abort", async () => {
    const controller = new AbortController();
    const tunnel = await openPodTunnel(api(), target, controller.signal);

    controller.abort();
    await tunnel.close();
    const refused = connect(tunnel.port, tunnel.address);

    await expect(once(refused, "connect")).rejects.toMatchObject({ code: "ECONNREFUSED" });
  });

  it("cancels an in-flight WebSocket handshake and closes both ends", async () => {
    const stalled = createServer(certificates);
    const incoming = once(stalled, "upgrade");

    stalled.listen(0, "127.0.0.1");
    await once(stalled, "listening");
    const address = stalled.address();

    if (!address || typeof address === "string") throw new Error("Missing stalled listener");
    const selected = new KubeConfig();

    const exported = JSON.parse(configuration.exportConfig()) as { clusters: { cluster: { server: string } }[] };

    exported.clusters[0].cluster.server = `https://127.0.0.1:${address.port}`;
    selected.loadFromString(JSON.stringify(exported));
    const controller = new AbortController();
    const tunnel = await openPodTunnel({ ...api(), configuration: selected }, target, controller.signal);
    const socket = connect(tunnel.port, tunnel.address);

    try {
      const [, handshake] = await incoming;
      // The peer may observe the cancellation as a reset before the close.
      handshake.on("error", () => {});
      const closed = new Promise<void>((resolve) => handshake.once("close", () => resolve()));

      controller.abort();
      await tunnel.close();
      await closed;
    } finally {
      socket.destroy();
      await tunnel.close();
      stalled.closeAllConnections();
      await new Promise<void>((resolve) => stalled.close(() => resolve()));
    }
  });

  it("cancels while the local listener is still opening", async () => {
    const controller = new AbortController();
    const operation = openPodTunnel(api(), target, controller.signal);
    const cancelled = expect(operation).rejects.toMatchObject({ code: "cancelled" });

    queueMicrotask(() => controller.abort());
    await cancelled;
  }, 1000);

  it("does not create a listener after cancellation during pod lookup", async () => {
    const controller = new AbortController();
    const base = api();

    await expect(
      openPodTunnel(
        {
          ...base,
          read: async () => {
            controller.abort();
            return base.read();
          },
        },
        target,
        controller.signal,
      ),
    ).rejects.toMatchObject({ code: "cancelled" });
  });
});
