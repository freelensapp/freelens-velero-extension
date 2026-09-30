// The version of the server and its plugins, asked of the server itself through a ServerStatusRequest:
// created with a generated name, read every 250 milliseconds until it is Processed, for ten seconds at
// most. A request the server does not process in that time is left where it is, and said so: the
// extension deletes no request.

import { setTimeout as delay } from "node:timers/promises";
import { type Failure, failure, type ServerStatusValue } from "../common/ipc";
import { DiagnosticError } from "./diagnostic-transport.ts";

import type { DiagnosticObject } from "./diagnostic-kubernetes";

export const SERVER_STATUS_PREFIX = "freelens-velero-";
export const SERVER_STATUS_WAIT = 10_000;
export const SERVER_STATUS_INTERVAL = 250;

export interface ServerStatusApi {
  assertCurrent(): void;
  read(kind: "ServerStatusRequest", namespace: string, name: string, signal: AbortSignal): Promise<DiagnosticObject>;
  createGenerated(
    kind: "ServerStatusRequest",
    namespace: string,
    prefix: string,
    signal: AbortSignal,
  ): Promise<DiagnosticObject>;
}

export interface ServerStatusOptions {
  signal: AbortSignal;
  onStep?(step: string, count?: number): void;
  waitMs?: number;
  intervalMs?: number;
  now?(): number;
}

// The words of each way it can end, safe to show.
export function serverStatusFailure(error: unknown, requestName?: string): Failure {
  const code = error instanceof DiagnosticError ? error.code : "request-failed";
  const stage = requestName ? "wait" : "creation";

  switch (code) {
    case "forbidden":
      return failure(
        "forbidden",
        stage,
        false,
        requestName
          ? "The cluster refused to read the request that was created."
          : "The cluster refused the creation of a ServerStatusRequest: the identity needs the verb create on serverstatusrequests of the namespace.",
      );
    case "cancelled":
      return failure(
        "cancelled",
        stage,
        true,
        "The wait was cancelled. The request stays until the server processes it.",
      );
    case "deadline":
      return failure(
        "deadline",
        stage,
        true,
        "The server did not answer in ten seconds: it may be stopped, or busy. The request stays until the server processes it.",
      );
    case "submission-unknown":
      return failure(
        "submission-unknown",
        "creation",
        false,
        "The creation of the request may have happened: the answer of the cluster was lost. Look for a ServerStatusRequest whose name begins with freelens-velero- before asking again.",
      );
    case "target-changed":
      return failure(
        "target-changed",
        stage,
        false,
        "The cluster or the installation changed while the request was made.",
      );
    case "transport-unreachable":
      return failure("transport-unreachable", stage, true, "The API server of the cluster could not be reached.");
    case "tls-invalid":
      return failure("tls-invalid", stage, false, "The certificate of the API server of the cluster is not trusted.");
    default:
      return failure(code, stage, false, "The request could not be made, for a reason the extension does not name.");
  }
}

export async function readServerStatus(
  api: ServerStatusApi,
  namespace: string,
  options: ServerStatusOptions,
): Promise<ServerStatusValue> {
  const now = options.now ?? Date.now;
  const wait = options.waitMs ?? SERVER_STATUS_WAIT;
  const interval = options.intervalMs ?? SERVER_STATUS_INTERVAL;
  const { signal } = options;

  options.onStep?.("creating");
  api.assertCurrent();
  const created = await api.createGenerated("ServerStatusRequest", namespace, SERVER_STATUS_PREFIX, signal);
  const identity = { name: created.metadata.name, uid: created.metadata.uid };
  const deadline = now() + wait;

  options.onStep?.("waiting", 0);
  for (;;) {
    if (signal.aborted) throw new DiagnosticError("cancelled");
    api.assertCurrent();
    const request = await api.read("ServerStatusRequest", namespace, identity.name, signal);

    if (request.metadata.uid !== identity.uid || request.metadata.namespace !== namespace)
      throw new DiagnosticError("target-changed");
    const status = request.status as
      | { phase?: unknown; serverVersion?: unknown; processedTimestamp?: unknown; plugins?: unknown }
      | undefined;

    if (status?.phase === "Processed") {
      const plugins = Array.isArray(status.plugins)
        ? (status.plugins as { name?: unknown; kind?: unknown }[])
            .filter((plugin) => typeof plugin?.name === "string" && typeof plugin?.kind === "string")
            .map((plugin) => ({ name: String(plugin.name), kind: String(plugin.kind) }))
        : [];

      return {
        version: typeof status.serverVersion === "string" ? status.serverVersion : "",
        processed: typeof status.processedTimestamp === "string" ? status.processedTimestamp : "",
        plugins,
        request: identity,
      };
    }
    options.onStep?.("waiting", Math.round((wait - (deadline - now())) / 1000));
    if (now() >= deadline) throw new DiagnosticError("deadline");
    await delay(Math.min(interval, Math.max(1, deadline - now())), undefined, { signal }).catch(() => {
      throw new DiagnosticError("cancelled");
    });
  }
}
