import { once } from "node:events";
import { createServer, type Socket } from "node:net";
import { Writable } from "node:stream";
import { WebSocketHandler } from "@kubernetes/client-node/dist/web-socket-handler.js";
import WebSocket from "ws";
import { DiagnosticError } from "./diagnostic-transport.ts";

import type { DiagnosticKubernetes } from "./diagnostic-kubernetes.ts";

// Bytes of the pod that may wait for the local socket before the WebSocket is paused.
const PENDING_BYTES = 256 * 1024;

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
    const fail = () => {
      socket.destroy();
      websocket?.terminate();
    };
    // One chunk at a time reaches the socket; the rest waits here, up to the bound above.
    const output = new Writable({
      highWaterMark: PENDING_BYTES,
      write(chunk: Buffer, _encoding, callback) {
        socket.write(chunk, callback);
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
        // The pod side is done: deliver what still waits, then close.
        output.end();
      });
      return websocket;
    });

    output.once("finish", () => socket.end());
    output.on("error", fail);
    output.on("drain", () => websocket?.resume());
    socket.once("close", () => {
      sockets.delete(socket);
      output.destroy();
      websocket?.terminate();
    });
    // Channel 0 carries the data of the only port and channel 1 its errors; each opens with the port number.
    const opening = [true, true];

    handler
      .connect(
        `/api/v1/namespaces/${encodeURIComponent(pod.namespace)}/pods/${encodeURIComponent(pod.name)}/portforward?ports=${pod.port}`,
        null,
        (channel, content) => {
          if (channel > 1) return false;
          const data = opening[channel] ? content.subarray(2) : content;

          opening[channel] = false;
          if (channel === 1) {
            if (data.length) fail();
          } else if (data.length && !output.write(data)) websocket?.pause();
          return true;
        },
      )
      .then((connected) => {
        if (signal.aborted || socket.destroyed) {
          websocket?.terminate();
          return;
        }
        WebSocketHandler.handleStandardInput(connected, socket, 0);
        socket.resume();
      })
      .catch(fail);
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
  // Nobody else hears the listener, and an error nobody hears is an exception of the whole process, which
  // is the one of the host. An error it raises after it listens, as when no descriptor is left for the
  // connection it is given, ends the tunnel: what went through it ends as a store that was not reached.
  server.on("error", abort);
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
