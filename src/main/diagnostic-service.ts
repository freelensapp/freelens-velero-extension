// The way of a DownloadRequest in the main process, once the gate let it through: the target read again by
// its name and its UID, its backup when it is a restore, the storage location of the backup, its
// certificate, the creation of the request, the wait for its URL, the route to the store, the download,
// and the release of what was opened. The gate decides who may ask and for what; this decides nothing of
// that, and is given the adapter of the cluster the gate holds.
//
// The signed URL is read, used and dropped here: it is in no result and in no error. No request is ever
// deleted: the controller of Velero removes the ones it processed.

import { readsAsTrue } from "../common/go-boolean";
import {
  type ArtifactTarget,
  artifactKind,
  DIAGNOSTIC_REQUEST_LABEL,
  type DownloadStage,
  downloadRequestName,
  isArtifactTarget,
} from "../common/ipc";
import { CredentialPluginError } from "./context-identity.ts";
import { type ArtifactRoute, DiagnosticError, downloadArtifact } from "./diagnostic-transport.ts";

import type { DiagnosticKubernetes, DiagnosticObject } from "./diagnostic-kubernetes.ts";

export interface DiagnosticInput {
  // The identifier of the request of the views: the name of the DownloadRequest ends with it.
  requestId: string;
  namespace: string;
  target: ArtifactTarget;
  // The backup or the restore the artifact is of, by its name and its UID.
  name: string;
  uid: string;
}

export interface DiagnosticResult {
  content: Buffer;
  request: { name: string; uid: string };
  // The route the bytes came by: through a tunnel or directly, encrypted or not, and the origin of the
  // store, which is the URL without its path and its query.
  route: { mode: ArtifactRoute["mode"]; encrypted: boolean; origin: string };
}

type Api = Pick<DiagnosticKubernetes, "assertCurrent" | "read" | "createDownload" | "certificate">;

export interface DiagnosticOptions {
  // The route to the store for a signed URL: where to connect, and what closes what was opened for it.
  route(
    url: string,
    input: Readonly<DiagnosticInput>,
    storage: DiagnosticObject,
    signal: AbortSignal,
  ): Promise<{
    route: ArtifactRoute;
    close(): void | Promise<void>;
    // Whether the cluster refused the port-forward of a route through it: known once a connection needed it.
    refused?(): false | "permission" | "credential";
  }>;
  // Told each step before it is taken, and the seconds waited while the URL is waited for.
  onStep?(stage: DownloadStage, count?: number): void;
  // Told the request once it is known to be in the cluster.
  onCreated?(request: { name: string; uid: string }): void;
  download?: typeof downloadArtifact;
  pollMs?: number;
  urlTimeoutMs?: number;
  totalMs?: number;
  closeMs?: number;
}

export const DOWNLOAD_BOUNDS = { pollMs: 250, urlTimeoutMs: 30_000, totalMs: 120_000, closeMs: 5_000 } as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const LABEL = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
const SUBDOMAIN = /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/;
// The name of a request is the name of its target, a dash and the identifier of the request: a target
// whose name is longer leaves no room for them in the name of an object.
const TARGET_NAME_BOUND = 253 - 37;

// Every field is of the kind and of the form the way needs, and there is no other: a field that is not a
// text is refused, and never read as one.
function validateInput(value: DiagnosticInput): void {
  if (
    !value ||
    typeof value !== "object" ||
    Object.keys(value).sort().join(",") !== "name,namespace,requestId,target,uid"
  )
    throw new DiagnosticError("validation");
  for (const key of ["requestId", "namespace", "name", "uid"] as const)
    if (typeof value[key] !== "string") throw new DiagnosticError("validation");
  if (
    !UUID.test(value.requestId) ||
    !isArtifactTarget(value.target) ||
    value.namespace.length > 63 ||
    !LABEL.test(value.namespace) ||
    value.name.length > TARGET_NAME_BOUND ||
    !SUBDOMAIN.test(value.name) ||
    !value.uid ||
    value.uid.length > 256
  )
    throw new DiagnosticError("validation");
}

// Two operations run at once in the process, whatever cluster they are of; the others wait their turn,
// and one that is cancelled while it waits leaves the queue.
const MOST = 2;
let running = 0;
const queue: { resolve(): void; signal: AbortSignal; abort(): void }[] = [];

function acquire(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(new DiagnosticError("cancelled"));
  if (running < MOST) {
    running += 1;
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const entry = {
      resolve,
      signal,
      abort: () => {
        const index = queue.indexOf(entry);

        if (index >= 0) queue.splice(index, 1);
        reject(new DiagnosticError("cancelled"));
      },
    };

    signal.addEventListener("abort", entry.abort, { once: true });
    queue.push(entry);
  });
}

function release(): void {
  const next = queue.shift();

  if (next) {
    next.signal.removeEventListener("abort", next.abort);
    next.resolve();
  } else running -= 1;
}

// A wait that ends when the operation is stopped.
function sleep(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DiagnosticError("cancelled"));
      return;
    }
    const stop = () => {
      clearTimeout(timer);
      reject(new DiagnosticError("cancelled"));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", stop);
      resolve();
    }, milliseconds);

    signal.addEventListener("abort", stop, { once: true });
  });
}

// What the way is given to wait for ends with the operation: the route and the download are told to stop
// by the signal, and one that does not stop is left behind, so that it holds neither the operation nor
// its place. What it gives late is given to `late`, which closes it.
function untilStopped<Value>(
  waited: Promise<Value>,
  signal: AbortSignal,
  late?: (value: Value) => void,
): Promise<Value> {
  return new Promise((resolve, reject) => {
    let left = false;
    const leave = () => {
      left = true;
      reject(new DiagnosticError("cancelled"));
    };

    if (signal.aborted) leave();
    else signal.addEventListener("abort", leave, { once: true });
    waited.then(
      (value) => {
        signal.removeEventListener("abort", leave);
        if (left) late?.(value);
        else resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", leave);
        if (!left) reject(error);
      },
    );
  });
}

// The failure of the way for what was raised at a step: its code at that step. What was raised is not
// written on: the adapter gives the same error to every request that waited for one run of the plugin of
// the context, each of which is at a step of its own. What the way raised itself says its step already.
function failed(error: unknown, stage: DownloadStage): DiagnosticError {
  if (error instanceof CredentialPluginError) {
    if (error.stage !== undefined) return error;
    return new CredentialPluginError(error.command, error.reason, stage);
  }
  if (error instanceof DiagnosticError)
    return error.stage === undefined ? new DiagnosticError(error.code, stage, error.verdict, error.needs) : error;
  // What is not a code, raised while the request was created, says nothing of whether it was.
  return new DiagnosticError(stage === "creation" ? "submission-unknown" : "request-failed", stage);
}

// A text of an object that is one, or nothing.
function text(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

// Whether a request read from the cluster is the one of this operation: its name, its namespace, the
// label with the identifier of the request, and the target it was created for.
function isOurs(request: DiagnosticObject, name: string, input: Readonly<DiagnosticInput>): boolean {
  const target = request.spec?.target as { kind?: unknown; name?: unknown } | undefined;

  return (
    !!request.metadata.uid &&
    request.metadata.name === name &&
    request.metadata.namespace === input.namespace &&
    request.metadata.labels?.[DIAGNOSTIC_REQUEST_LABEL] === input.requestId &&
    target?.kind === input.target &&
    target?.name === input.name
  );
}

export async function runDownload(
  api: Api,
  given: DiagnosticInput,
  outer: AbortSignal,
  options: DiagnosticOptions,
): Promise<DiagnosticResult> {
  validateInput(given);
  const input: Readonly<DiagnosticInput> = Object.freeze({ ...given });
  const total = options.totalMs ?? DOWNLOAD_BOUNDS.totalMs;
  const urlTimeout = options.urlTimeoutMs ?? DOWNLOAD_BOUNDS.urlTimeoutMs;
  const interval = options.pollMs ?? DOWNLOAD_BOUNDS.pollMs;
  const closing = options.closeMs ?? DOWNLOAD_BOUNDS.closeMs;

  // The bounds may be made shorter, by a test, and never longer.
  if (
    ![total, urlTimeout, interval, closing].every(Number.isSafeInteger) ||
    total <= 0 ||
    total > DOWNLOAD_BOUNDS.totalMs ||
    urlTimeout <= 0 ||
    urlTimeout > DOWNLOAD_BOUNDS.urlTimeoutMs ||
    interval <= 0 ||
    interval > 1000 ||
    closing <= 0 ||
    closing > DOWNLOAD_BOUNDS.closeMs
  )
    throw new DiagnosticError("validation");
  const controller = new AbortController();
  const signal = controller.signal;
  const cancelled = () => controller.abort();
  let expired = false;
  const timer = setTimeout(() => {
    expired = true;
    controller.abort();
  }, total);
  // The step the way is at: a failure ends at it.
  let stage: DownloadStage = "queue";
  const step = (next: DownloadStage, count?: number) => {
    stage = next;
    options.onStep?.(next, count);
  };
  const kind = artifactKind(input.target);
  // The target as it is now: the object of that name with that UID, or the operation is of another.
  const target = async () => {
    api.assertCurrent();
    const found = await api.read(kind, input.namespace, input.name, signal);

    // An object of that name that is not the one that was confirmed.
    if (
      found.metadata.uid !== input.uid ||
      found.metadata.name !== input.name ||
      found.metadata.namespace !== input.namespace
    )
      throw new DiagnosticError("target-changed", stage, "replaced");
    return found;
  };
  let acquired = false;
  // Whether the storage location asks that the certificate of its store is not verified. It is verified
  // all the same: the key is read only to say so when the certificate is refused.
  let insecure = false;
  let routed: Awaited<ReturnType<DiagnosticOptions["route"]>> | undefined;
  let result: DiagnosticResult | undefined;
  let failure: DiagnosticError | undefined;

  outer.addEventListener("abort", cancelled, { once: true });
  if (outer.aborted) controller.abort();
  try {
    step("queue");
    await acquire(signal);
    acquired = true;
    step("target");
    const operation = await target();
    let backup = operation;

    if (kind === "Restore") {
      step("backup");
      const backupName = text(operation.spec?.backupName);

      // A restore that names no backup: Velero refused it before it took one, and signs no URL for it.
      if (!backupName) throw new DiagnosticError("not-found");
      backup = await api.read("Backup", input.namespace, backupName, signal);
    }
    step("location");
    const locationName = text(backup.spec?.storageLocation);

    if (!locationName) throw new DiagnosticError("not-found");
    const storage = await api.read("BackupStorageLocation", input.namespace, locationName, signal);

    insecure = readsAsTrue((storage.spec?.config as Record<string, unknown> | undefined)?.insecureSkipTLSVerify);
    step("certificate");
    const objectStorage = storage.spec?.objectStorage as
      | { caCert?: string; caCertRef?: { name: string; key: string } }
      | undefined;
    const ca = await api.certificate(input.namespace, objectStorage ?? {}, signal);
    const requestName = downloadRequestName(input.name, input.requestId);
    let request: DiagnosticObject;

    // The target is read once more before the request is created for it: the step of the creation is the
    // creation alone, so that what ends at it says what a creation may have left.
    step("target");
    await target();
    step("creation");
    try {
      request = await api.createDownload(
        input.namespace,
        input.target,
        input.name,
        requestName,
        input.requestId,
        signal,
      );
    } catch (error) {
      // The answer of the creation was lost: the request is looked for by its name, and never created a
      // second time. Not found, the creation is not known, and the name says what to look for.
      if (!(error instanceof DiagnosticError) || error.code !== "submission-unknown") throw error;
      try {
        request = await api.read("DownloadRequest", input.namespace, requestName, signal);
      } catch {
        throw new DiagnosticError("submission-unknown");
      }
    }
    // A request of that name that is not this one: it is kept, and nothing of it is used.
    if (!isOurs(request, requestName, input)) throw new DiagnosticError("conflict");
    const identity = { name: requestName, uid: request.metadata.uid };

    options.onCreated?.(identity);
    step("wait", 0);
    const started = Date.now();
    const deadline = started + urlTimeout;
    let signedUrl = "";

    while (!signedUrl) {
      if (signal.aborted) throw new DiagnosticError("cancelled");
      api.assertCurrent();
      request = await api.read("DownloadRequest", input.namespace, requestName, signal);
      // What the request says is told from what a read of it ends with: each is a verdict of the way.
      // The request by its name is another object now: nothing of it is taken.
      if (request.metadata.uid !== identity.uid || !isOurs(request, requestName, input))
        throw new DiagnosticError("target-changed", "wait", "another");
      // The phase the main branch of Velero has, and the reviewed release does not.
      if (request.status?.phase === "Failed") throw new DiagnosticError("request-failed", "wait", "failed");
      if (
        typeof request.status?.expiration === "string" &&
        (!Number.isFinite(Date.parse(request.status.expiration)) || Date.parse(request.status.expiration) <= Date.now())
      )
        throw new DiagnosticError("deadline", "wait", "expired");
      if (typeof request.status?.downloadURL === "string" && request.status.downloadURL)
        signedUrl = request.status.downloadURL;
      else {
        if (Date.now() >= deadline) throw new DiagnosticError("deadline", "wait", "unsigned");
        step("wait", Math.floor((Date.now() - started) / 1000));
        await sleep(Math.min(interval, Math.max(1, deadline - Date.now())), signal);
      }
    }
    step("route");
    // A route that is given after the operation was stopped is closed, and not used.
    routed = await untilStopped(options.route(signedUrl, input, storage, signal), signal, (late) => {
      Promise.resolve()
        .then(() => late.close())
        .catch(() => undefined);
    });
    const url = new URL(signedUrl);

    step("download");
    const content = await untilStopped(
      (options.download ?? downloadArtifact)(signedUrl, { ...routed.route, ca }, signal, undefined, (bytes) =>
        step("download", bytes),
      ),
      signal,
    );

    signedUrl = "";
    // What is delivered is of the target that was asked: one that changed while the bytes arrived gets none.
    step("delivery");
    await target();
    result = {
      content,
      request: identity,
      route: { mode: routed.route.mode, encrypted: url.protocol === "https:", origin: url.origin },
    };
  } catch (error) {
    failure = expired
      ? new DiagnosticError("deadline", stage, "whole")
      : signal.aborted
        ? new DiagnosticError("cancelled", stage)
        : failed(error, stage);
    // A certificate of the store that was refused, of a location that asks for no verification. Of a
    // handshake that failed for another reason nothing is said of the key: no certificate was refused.
    if (insecure && failure.verdict === "untrusted")
      failure = new DiagnosticError(failure.code, failure.stage, "insecure");
    // A port-forward the cluster refused is what ended the download, and not a store that was not reached:
    // to an identity that may not forward a port, or with a credential the cluster did not take.
    const refusal =
      failure.code !== "cancelled" && failure.verdict !== "whole" && failure.stage === "download"
        ? routed?.refused?.()
        : false;

    if (refusal)
      failure = new DiagnosticError("forbidden", "forward", refusal === "credential" ? "credential" : undefined);
  } finally {
    clearTimeout(timer);
    outer.removeEventListener("abort", cancelled);
    // What was opened for the route is closed, within a bound: a route that does not close is said, and
    // does not hold a place.
    if (routed) {
      let late: ReturnType<typeof setTimeout> | undefined;

      try {
        await Promise.race([
          Promise.resolve().then(() => routed?.close()),
          new Promise((_resolve, reject) => {
            late = setTimeout(() => reject(new Error("The route did not close")), closing);
          }),
        ]);
      } catch {
        failure ??= new DiagnosticError("transport-unreachable", "release");
      } finally {
        clearTimeout(late);
      }
    }
    if (acquired) release();
  }
  // An operation that was stopped while what it opened was closed delivers nothing.
  if (!failure && outer.aborted) failure = new DiagnosticError("cancelled", "release");
  if (failure) throw failure;
  if (!result) throw new DiagnosticError("request-failed", stage);
  return result;
}
