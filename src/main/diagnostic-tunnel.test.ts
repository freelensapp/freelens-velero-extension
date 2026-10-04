import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { createServer, type Server } from "node:https";
import { createRequire } from "node:module";
import { connect, Server as Listener } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { KubeConfig } from "@kubernetes/client-node/dist/config.js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { type WebSocket, WebSocketServer } from "ws";
import { createTlsFixture } from "../../test/tls-fixture";
import { downloadArtifact } from "./diagnostic-transport";
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
    // A pod that takes what it is sent and answers nothing.
    if (request.url?.includes("/pods/silent/")) return;
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
    const globals = globalThis as typeof globalThis & { LensExtensions?: unknown; Mobx?: unknown };
    const previous = { sdk: globals.LensExtensions, state: globals.Mobx };
    const load = createRequire(import.meta.url);

    // What the bundle asks of the host when it loads: its SDK, with the IPC of the main process, and its
    // state library.
    globals.LensExtensions = {
      Main: { LensExtension: class {}, Ipc: class {} },
      Common: { Store: { ExtensionStore: class {} } },
      Renderer: {},
    };
    globals.Mobx = load("mobx");
    try {
      return (load("../../out/main/index.js") as { openPodTunnel: typeof openPodTunnel }).openPodTunnel;
    } finally {
      if (previous.sdk === undefined) delete globals.LensExtensions;
      else globals.LensExtensions = previous.sdk;
      if (previous.state === undefined) delete globals.Mobx;
      else globals.Mobx = previous.state;
    }
  };

  it.each(["source", "compiled"])(
    "forwards through the %s implementation and releases sockets/listener",
    async (mode) => {
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
    },
  );

  it.each(["source", "compiled"])(
    "delivers the whole stream through the %s implementation when the pod side closes first",
    async (mode) => {
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
    },
    60_000,
  );

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

  // The listener of a tunnel, which the tunnel keeps to itself: the one that was told to listen last.
  const withListener = async (open: typeof openPodTunnel, name = "storage") => {
    const listen = vi.spyOn(Listener.prototype, "listen");

    try {
      const tunnel = await open(api(name), { ...target, name }, new AbortController().signal);

      return { tunnel, listener: listen.mock.contexts.at(-1) as Listener };
    } finally {
      listen.mockRestore();
    }
  };
  // What a listener raises when the process has no descriptor left for the connection it is given.
  const exhausted = () => Object.assign(new Error("accept EMFILE"), { code: "EMFILE", syscall: "accept" });

  it.each(["source", "compiled"])(
    "ends the tunnel of the %s implementation when its listener fails, and raises nothing",
    async (mode) => {
      const arrived = once(websocketServer, "connection");
      const { tunnel, listener } = await withListener(mode === "compiled" ? compiled() : openPodTunnel);
      const socket = connect(tunnel.port, tunnel.address);

      try {
        await once(socket, "connect");
        const response = once(socket, "data");

        socket.write("synthetic-port-forward");
        expect((await response)[0].toString()).toBe("synthetic-port-forward");
        const [pod] = (await arrived) as [WebSocket];
        const gone = Promise.all([once(socket, "close"), once(pod, "close")]);

        // Nobody but the tunnel hears its listener: an error nobody hears is raised to the whole process.
        expect(() => listener.emit("error", exhausted())).not.toThrow();
        // The local socket and the connection to the pod are closed, and the listener with them.
        await gone;
        await tunnel.close();
        expect(listener.listening).toBe(false);
      } finally {
        socket.destroy();
        await tunnel.close();
      }
      const refused = connect(tunnel.port, tunnel.address);

      await expect(once(refused, "connect")).rejects.toMatchObject({ code: "ECONNREFUSED" });
    },
  );

  it.each(["http", "https"])(
    "ends a download over %s through it as transport-unreachable when its listener fails",
    async (scheme) => {
      const arrived = once(websocketServer, "connection");
      const { tunnel, listener } = await withListener(openPodTunnel, "silent");
      const origin = `${scheme}://storage.example.invalid:8333`;
      const pending = downloadArtifact(
        `${origin}/artifact?signature=synthetic`,
        {
          origin,
          pathname: "/artifact",
          address: tunnel.address,
          port: tunnel.port,
          mode: "tunnel",
          allowHttp: true,
          ca: certificates.ca,
        },
        new AbortController().signal,
      ).catch((error: unknown) => error);

      try {
        // The request, or the first message of its handshake, is on its way to a pod that answers nothing.
        await arrived;
        expect(() => listener.emit("error", exhausted())).not.toThrow();
        expect(await pending).toMatchObject({ code: "transport-unreachable" });
      } finally {
        await tunnel.close();
      }
    },
  );

  it("ends as transport-unreachable when its listener cannot listen, and leaves nothing open", async () => {
    // A listener that fails where it would have begun to listen. The wait for it ends with that error
    // whether or not anything else hears the listener: what proves that its errors are heard is the
    // listener that fails after it listens, above.
    const listen = vi.spyOn(Listener.prototype, "listen").mockImplementation(function (this: Listener) {
      process.nextTick(() =>
        this.emit("error", Object.assign(new Error("listen EADDRNOTAVAIL"), { code: "EADDRNOTAVAIL" })),
      );
      return this;
    });

    try {
      await expect(openPodTunnel(api(), target, new AbortController().signal)).rejects.toMatchObject({
        code: "transport-unreachable",
      });
      expect((listen.mock.contexts.at(-1) as Listener).listening).toBe(false);
    } finally {
      listen.mockRestore();
    }
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
