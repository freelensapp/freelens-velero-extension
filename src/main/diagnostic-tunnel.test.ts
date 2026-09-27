import { once } from "node:events";
import { createServer, type Server } from "node:https";
import { createRequire } from "node:module";
import { connect } from "node:net";
import { KubeConfig } from "@kubernetes/client-node";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { WebSocketServer } from "ws";
import { createTlsFixture } from "../../test/tls-fixture";
import { openPodTunnel } from "./diagnostic-tunnel";

let certificates: Awaited<ReturnType<typeof createTlsFixture>>;
let server: Server;
let websocketServer: WebSocketServer;
let configuration: KubeConfig;

beforeAll(async () => {
  certificates = await createTlsFixture();
  server = createServer(certificates);
  websocketServer = new WebSocketServer({ server });
  websocketServer.on("connection", (socket) => {
    socket.send(Buffer.from([0, 141, 32]));
    socket.send(Buffer.from([1, 141, 32]));
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
  const api = () => ({
    configuration,
    assertCurrent: () => {},
    read: async () => ({
      metadata: { namespace: "fixture", name: "storage", uid: "pod-uid" },
      spec: { containers: [{ ports: [{ containerPort: 8333 }] }] },
      status: { conditions: [{ type: "Ready", status: "True" }] },
    }),
  });

  it.each([
    "source",
    "compiled",
  ])("forwards through the %s implementation and releases sockets/listener", async (mode) => {
    let open = openPodTunnel;

    if (mode === "compiled") {
      const globals = globalThis as typeof globalThis & { LensExtensions?: unknown };
      const previous = globals.LensExtensions;

      globals.LensExtensions = { Main: { LensExtension: class {} }, Common: {}, Renderer: {} };
      try {
        open = (createRequire(import.meta.url)("../../out/main/index.js") as { openPodTunnel: typeof openPodTunnel })
          .openPodTunnel;
      } finally {
        if (previous === undefined) delete globals.LensExtensions;
        else globals.LensExtensions = previous;
      }
    }
    const tunnel = await open(api(), target, new AbortController().signal);
    const socket = connect(tunnel.port, tunnel.address);

    try {
      await once(socket, "connect");
      const response = once(socket, "data");
      socket.write("synthetic-port-forward");
      expect((await response)[0].toString()).toBe("synthetic-port-forward");
    } finally {
      socket.destroy();
      await tunnel.close();
    }
    const refused = connect(tunnel.port, tunnel.address);

    await expect(once(refused, "connect")).rejects.toMatchObject({ code: "ECONNREFUSED" });
  });

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
      const closed = once(handshake, "close");

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
