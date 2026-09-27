import { once } from "node:events";
import { createServer, type Socket } from "node:net";
import { Writable } from "node:stream";
import { PortForward } from "@kubernetes/client-node";
import { WebSocketHandler } from "@kubernetes/client-node/dist/web-socket-handler.js";
import WebSocket from "ws";
import type { DiagnosticKubernetes } from "./diagnostic-kubernetes.ts";
import { DiagnosticError } from "./diagnostic-transport.ts";

export interface PodTarget {
  namespace: string;
  name: string;
  uid: string;
  port: number;
}

export async function openPodTunnel(
  api: Pick<DiagnosticKubernetes, "configuration" | "read" | "assertCurrent">,
  pod: PodTarget,
  signal: AbortSignal,
): Promise<{ address: string; port: number; close(): Promise<void> }> {
  api.assertCurrent();
  if (signal.aborted) throw new DiagnosticError("cancelled");
  if (!Number.isInteger(pod.port) || pod.port < 1 || pod.port > 65535) throw new DiagnosticError("validation");
  const selected = await api.read("Pod", pod.namespace, pod.name, signal);
  if (signal.aborted) throw new DiagnosticError("cancelled");
  const containers = selected.spec?.containers as { ports?: { containerPort: number }[] }[] | undefined;
  const conditions = selected.status?.conditions as { type: string; status: string }[] | undefined;

  if (
    selected.metadata.uid !== pod.uid ||
    selected.metadata.name !== pod.name ||
    selected.metadata.namespace !== pod.namespace ||
    !conditions?.some((condition) => condition.type === "Ready" && condition.status === "True") ||
    !containers?.some((container) => container.ports?.some((port) => port.containerPort === pod.port))
  )
    throw new DiagnosticError("target-changed");
  const sockets = new Set<Socket>();
  const websockets = new Set<WebSocket>();
  let used = false;
  let closing: Promise<void> | undefined;
  const server = createServer((socket) => {
    if (used || signal.aborted) {
      socket.destroy();
      return;
    }
    used = true;
    sockets.add(socket);
    socket.pause();
    socket.on("error", () => socket.destroy());
    let websocket: WebSocket | undefined;
    const output = new Writable({
      write(chunk: Buffer, _encoding, callback) {
        if (!socket.write(chunk, callback)) websocket?.pause();
      },
    });
    const errors = new Writable({
      write(chunk: Buffer, _encoding, callback) {
        if (chunk.length) {
          socket.destroy();
          websocket?.terminate();
        }
        callback();
      },
    });
    const handler = new WebSocketHandler(api.configuration, (uri, protocols, options) => {
      api.assertCurrent();
      if (signal.aborted || socket.destroyed) throw new DiagnosticError("cancelled");
      websocket = new WebSocket(uri, protocols, {
        ...options,
        rejectUnauthorized: true,
        handshakeTimeout: 10_000,
        maxPayload: 16 * 1024 ** 2,
        perMessageDeflate: false,
      });
      websockets.add(websocket);
      websocket.on("error", () => socket.destroy());
      websocket.once("close", () => {
        if (websocket) websockets.delete(websocket);
        socket.destroy();
      });
      return websocket;
    });

    output.on("error", () => {
      socket.destroy();
      websocket?.terminate();
    });
    socket.on("drain", () => websocket?.resume());
    socket.once("close", () => {
      sockets.delete(socket);
      output.destroy();
      errors.destroy();
      websocket?.terminate();
    });
    new PortForward(api.configuration, true, handler)
      .portForward(pod.namespace, pod.name, [pod.port], output, errors, socket, 0)
      .then(() => {
        if (signal.aborted || socket.destroyed) websocket?.terminate();
        else socket.resume();
      })
      .catch(() => {
        socket.destroy();
        websocket?.terminate();
      });
  });
  const close = () => {
    if (closing) return closing;
    signal.removeEventListener("abort", abort);
    for (const socket of sockets) socket.destroy();
    for (const socket of websockets) socket.terminate();
    closing = new Promise<void>((resolve) => server.close(() => resolve()));
    return closing;
  };
  const abort = () => {
    void close();
  };

  signal.addEventListener("abort", abort, { once: true });
  server.listen(0, "127.0.0.1");
  try {
    await once(server, "listening", { signal });
    api.assertCurrent();
    if (signal.aborted) throw new DiagnosticError("cancelled");
    const address = server.address();

    if (!address || typeof address === "string") throw new DiagnosticError("transport-unreachable");
    return { address: "127.0.0.1", port: address.port, close };
  } catch (error) {
    await close();
    if (signal.aborted) throw new DiagnosticError("cancelled");
    throw error instanceof DiagnosticError ? error : new DiagnosticError("transport-unreachable");
  }
}
