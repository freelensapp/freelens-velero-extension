// The version of the server and its plugins, asked of the server itself through a ServerStatusRequest:
// created with a generated name, read every 250 milliseconds until it is Processed, for ten seconds at
// most. A request the server does not process in that time is left where it is, and said so: the
// extension deletes no request.

import { setTimeout as delay } from "node:timers/promises";
import { type Failure, failure, REQUEST_PREFIX, REQUEST_STAGES, type ServerStatusValue } from "../common/ipc";
import { CredentialPluginError, PLUGIN_TIMEOUT } from "./context-identity.ts";
import { DiagnosticError } from "./diagnostic-transport.ts";

import type { DiagnosticObject } from "./diagnostic-kubernetes";

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

// A request the server processed without saying its version or when: the answer would have empty words,
// which the view does not take.
export class IncompleteServerStatusError extends DiagnosticError {
  constructor() {
    super("request-failed");
    this.name = "IncompleteServerStatusError";
  }
}

// A text the view takes: not empty, and within its bound.
function text(value: unknown, bound: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= bound;
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
  // The plugin of the context gave no credential: the cluster was not asked, so it refused nothing. Asking
  // again is safe; it runs the plugin again. When the request was created before, it is the wait that
  // ended, and the request is there.
  if (error instanceof CredentialPluginError) {
    const plugin = `The credential plugin ${error.command} of the context`;

    return failure(
      "request-failed",
      requestName ? REQUEST_STAGES.wait : REQUEST_STAGES.credential,
      true,
      error.reason === "deadline"
        ? `${plugin} did not give a credential in ${PLUGIN_TIMEOUT / 1000} seconds. Run it in a terminal to see what it waits for, then ask again.`
        : error.reason === "unreadable"
          ? `${plugin} ended, but what it printed is not a credential the extension can read.`
          : `${plugin} did not give a credential: it failed, or it is not installed. Run it in a terminal, for example to sign in again, then ask again.`,
    );
  }
  if (error instanceof IncompleteServerStatusError)
    return failure(
      "request-failed",
      REQUEST_STAGES.wait,
      false,
      `The server processed the request but did not say its version, or when it processed it. The request stays: it is a ServerStatusRequest whose name begins with ${REQUEST_PREFIX}.`,
    );
  const code = error instanceof DiagnosticError ? error.code : "request-failed";
  const stage = requestName ? REQUEST_STAGES.wait : REQUEST_STAGES.creation;

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
        requestName
          ? "The wait was cancelled. The request stays until the server processes it."
          : "The request was cancelled before the cluster answered its creation: it may have been created.",
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
        REQUEST_STAGES.creation,
        false,
        `The creation of the request may have happened: the answer of the cluster was lost. Look for a ServerStatusRequest whose name begins with ${REQUEST_PREFIX} before asking again.`,
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
  const created = await api.createGenerated("ServerStatusRequest", namespace, REQUEST_PREFIX, signal);
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
            .filter((plugin) => text(plugin?.name, 256) && text(plugin?.kind, 256))
            .map((plugin) => ({ name: String(plugin.name), kind: String(plugin.kind) }))
        : [];

      if (!text(status.serverVersion, 256) || !text(status.processedTimestamp, 64))
        throw new IncompleteServerStatusError();
      return {
        version: status.serverVersion,
        processed: status.processedTimestamp,
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
