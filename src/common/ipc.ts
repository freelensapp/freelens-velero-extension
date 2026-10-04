// The way between the two processes of the extension: the procedures the renderer calls, what each is
// given and what each answers. Every request is validated by the process that receives it, every answer
// by the one that receives it, and neither trusts the other. No raw error, URL, header, body or path of a
// file is in any of them: a failure is a code, a stage, whether it is safe to try again and words.

import type { DiagnosticCode } from "../main/diagnostic-transport";

export const CHANNELS = {
  gateState: "gate.state",
  gateEnable: "gate.enable",
  gateDisable: "gate.disable",
  gateChanged: "gate.changed",
  writeConfirm: "write.confirm",
  writeRun: "write.run",
  writeStatus: "write.status",
  writeCancel: "write.cancel",
} as const;

export const WRITE_KINDS = ["DownloadRequest", "ServerStatusRequest"] as const;
export type WriteKind = (typeof WRITE_KINDS)[number];

// What a request of a generated name is created with, which the confirmation of the views shows: the
// prefix of its name, so that an operator who lists the requests knows what created them, and the labels
// that say the same. The main process creates with these and the views show these: they are written once.
export const REQUEST_PREFIX = "freelens-velero-";
export const REQUEST_LABELS: Readonly<Record<string, string>> = {
  "app.kubernetes.io/managed-by": "freelens-velero-extension",
};

// Where the write of such a request failed, which the main process says and the views read what the
// request left in the cluster by: before the cluster answered its creation, while the request was waited
// for, which is after it was created, and while the plugin of the context was asked for its credential
// before the creation.
export const REQUEST_STAGES = { creation: "creation", wait: "wait", credential: "credential" } as const;

// The largest request the processes accept of each other.
export const REQUEST_BOUND = 64 * 1024;

export type FailureCode = DiagnosticCode | "connection-unsupported";

export interface Failure {
  ok: false;
  code: FailureCode;
  // Where it failed: the gate, the catalog, the connection, the creation, the wait, and so on.
  stage: string;
  // Whether asking again, as it was asked, is safe.
  retry: boolean;
  // Words that are safe to show.
  text: string;
}
export type Answer<Value> = { ok: true; value: Value } | Failure;

// What the main process says of the connection of a cluster, when writes are on for it: the adapter takes
// a client certificate, a token or a plugin that gives a credential; every other form is named.
export type Connection =
  | { supported: true; credential: "certificate" | "token" | "plugin" }
  | {
      supported: false;
      reason: ConnectionReason;
    };

export const CONNECTION_REASON_NAMES = [
  "entry",
  "file",
  "context",
  "auth-provider",
  "proxy",
  "basic",
  "insecure-tls",
  "no-credential",
  "impersonation",
  "unusable",
] as const;
export type ConnectionReason = (typeof CONNECTION_REASON_NAMES)[number];

// Why the writes of the extension cannot use the connection of a cluster: the form of the kubeconfig the
// adapter refuses, or what is missing of it. The main process says them when it refuses to turn writes
// on, and the views show them.
export const CONNECTION_REASONS: Record<ConnectionReason, string> = {
  entry: "The cluster is not in the catalog of Freelens any more.",
  file: "The kubeconfig of the cluster cannot be read.",
  context: "The context of the cluster is not in its kubeconfig.",
  "auth-provider":
    "The connection of this cluster uses an authentication provider of the kubeconfig, which the writes of the extension do not use.",
  proxy: "The connection of this cluster goes through a proxy, which the writes of the extension do not use.",
  basic:
    "The connection of this cluster uses a user name and a password, which the writes of the extension do not use.",
  "insecure-tls":
    "The connection of this cluster turns the verification of TLS off, which the writes of the extension never do.",
  "no-credential": "The connection of this cluster has no credential the writes of the extension can use.",
  impersonation:
    "The connection of this cluster impersonates groups, a uid or extra fields, which the writes of the extension cannot send.",
  unusable: "The connection of this cluster is not one the writes of the extension can use.",
};

// The state of the gate of one cluster, as the main process holds it.
export interface GateState {
  // The cluster, as the catalog of the host names it, and its context.
  cluster: { id: string; name: string; context: string };
  writes: { on: false } | { on: true; namespace: string; since: number };
  connection?: Connection;
}

export interface GateStateRequest {
  cluster: string;
}
export interface GateEnableRequest {
  cluster: string;
  namespace: string;
  // What the dialog named: it must be the context and the namespace the gate is turned on for.
  confirmation: { context: string; namespace: string };
}
export interface GateDisableRequest {
  cluster: string;
}

// The target of a write that is of one object, for the kinds that have one.
export interface WriteTarget {
  kind: "Backup" | "Restore";
  name: string;
  uid: string;
}
export interface WriteConfirmRequest {
  cluster: string;
  namespace: string;
  kind: WriteKind;
  target?: WriteTarget;
}
export interface WriteConfirmAnswer {
  token: string;
  expires: number;
}
export interface WriteRunRequest {
  cluster: string;
  namespace: string;
  kind: WriteKind;
  target?: WriteTarget;
  token: string;
  request: string;
  // What the kind of the write needs beside its target: the kind of artifact of a DownloadRequest.
  artifact?: string;
}
export interface WriteStatusRequest {
  cluster: string;
  request: string;
}
export interface WriteCancelRequest {
  cluster: string;
  request: string;
}

// What a write is at, for the frame that asked it.
export interface WriteStatus {
  step: string;
  // What the step counts, when it counts something: bytes, seconds.
  count?: number;
}

export interface ServerStatusValue {
  version: string;
  processed: string;
  plugins: { name: string; kind: string }[];
  request: { name: string; uid: string };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const CLUSTER = /^[a-z0-9][a-z0-9-]{0,63}$/i;
const LABEL = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
const SUBDOMAIN = /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// The keys of a request are exactly the ones its contract names: a field the contract does not know
// refuses the request, and so does one it names that is missing.
function hasKeys(value: Record<string, unknown>, required: string[], optional: string[] = []): boolean {
  const keys = Object.keys(value);

  return (
    required.every((key) => keys.includes(key)) && keys.every((key) => required.includes(key) || optional.includes(key))
  );
}

function isCluster(value: unknown): value is string {
  return typeof value === "string" && CLUSTER.test(value);
}

export function isNamespace(value: unknown): value is string {
  return typeof value === "string" && value.length <= 63 && LABEL.test(value);
}

function isName(value: unknown): value is string {
  return typeof value === "string" && value.length <= 253 && SUBDOMAIN.test(value);
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

function isText(value: unknown, bound = 256): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= bound;
}

function isWriteKind(value: unknown): value is WriteKind {
  return typeof value === "string" && (WRITE_KINDS as readonly string[]).includes(value);
}

function isTarget(value: unknown): value is WriteTarget {
  return (
    isRecord(value) &&
    hasKeys(value, ["kind", "name", "uid"]) &&
    (value.kind === "Backup" || value.kind === "Restore") &&
    isName(value.name) &&
    isText(value.uid)
  );
}

// A request is within its bound before anything of it is read.
function withinBound(value: unknown): boolean {
  try {
    return JSON.stringify(value).length <= REQUEST_BOUND;
  } catch {
    return false;
  }
}

export function readGateStateRequest(value: unknown): GateStateRequest | undefined {
  if (!withinBound(value) || !isRecord(value) || !hasKeys(value, ["cluster"]) || !isCluster(value.cluster)) return;
  return { cluster: value.cluster };
}

export function readGateEnableRequest(value: unknown): GateEnableRequest | undefined {
  if (!withinBound(value) || !isRecord(value) || !hasKeys(value, ["cluster", "namespace", "confirmation"])) return;
  const confirmation = value.confirmation;

  if (
    !isCluster(value.cluster) ||
    !isNamespace(value.namespace) ||
    !isRecord(confirmation) ||
    !hasKeys(confirmation, ["context", "namespace"]) ||
    !isText(confirmation.context) ||
    !isNamespace(confirmation.namespace)
  )
    return;
  return {
    cluster: value.cluster,
    namespace: value.namespace,
    confirmation: { context: confirmation.context, namespace: confirmation.namespace },
  };
}

export function readGateDisableRequest(value: unknown): GateDisableRequest | undefined {
  return readGateStateRequest(value);
}

export function readWriteConfirmRequest(value: unknown): WriteConfirmRequest | undefined {
  if (!withinBound(value) || !isRecord(value) || !hasKeys(value, ["cluster", "namespace", "kind"], ["target"])) return;
  if (!isCluster(value.cluster) || !isNamespace(value.namespace) || !isWriteKind(value.kind)) return;
  if ("target" in value && !isTarget(value.target)) return;
  // A DownloadRequest is of a backup or of a restore; a ServerStatusRequest is of none.
  if ((value.kind === "DownloadRequest") !== "target" in value) return;
  return {
    cluster: value.cluster,
    namespace: value.namespace,
    kind: value.kind,
    ...(value.target ? { target: { ...(value.target as WriteTarget) } } : {}),
  };
}

export function readWriteRunRequest(value: unknown): WriteRunRequest | undefined {
  if (
    !withinBound(value) ||
    !isRecord(value) ||
    !hasKeys(value, ["cluster", "namespace", "kind", "token", "request"], ["target", "artifact"])
  )
    return;
  const confirm = readWriteConfirmRequest({
    cluster: value.cluster,
    namespace: value.namespace,
    kind: value.kind,
    ...("target" in value ? { target: value.target } : {}),
  });

  if (!confirm || !isUuid(value.token) || !isUuid(value.request)) return;
  if ("artifact" in value && !isText(value.artifact, 64)) return;
  if ((value.kind === "DownloadRequest") !== "artifact" in value) return;
  return {
    ...confirm,
    token: value.token,
    request: value.request,
    ...(typeof value.artifact === "string" ? { artifact: value.artifact } : {}),
  };
}

export function readWriteStatusRequest(value: unknown): WriteStatusRequest | undefined {
  if (!withinBound(value) || !isRecord(value) || !hasKeys(value, ["cluster", "request"])) return;
  if (!isCluster(value.cluster) || !isUuid(value.request)) return;
  return { cluster: value.cluster, request: value.request };
}

export const readWriteCancelRequest = readWriteStatusRequest;

// The answers, read by the renderer: what is not an answer of the contract is a failure of the way.
export function readAnswer<Value>(value: unknown, readValue: (inner: unknown) => Value | undefined): Answer<Value> {
  const broken: Failure = {
    ok: false,
    code: "validation",
    stage: "answer",
    retry: false,
    text: "The main process answered with what the views do not understand.",
  };

  if (!withinBound(value) || !isRecord(value) || typeof value.ok !== "boolean") return broken;
  if (value.ok) {
    if (!hasKeys(value, ["ok", "value"])) return broken;
    const read = readValue(value.value);

    return read === undefined ? broken : { ok: true, value: read };
  }
  if (
    !hasKeys(value, ["ok", "code", "stage", "retry", "text"]) ||
    !isText(value.code, 64) ||
    !isText(value.stage, 64) ||
    typeof value.retry !== "boolean" ||
    !isText(value.text, 1024)
  )
    return broken;
  return { ok: false, code: value.code as FailureCode, stage: value.stage, retry: value.retry, text: value.text };
}

export function readGateState(value: unknown): GateState | undefined {
  if (!isRecord(value) || !hasKeys(value, ["cluster", "writes"], ["connection"])) return;
  const cluster = value.cluster;
  const writes = value.writes;

  if (
    !isRecord(cluster) ||
    !hasKeys(cluster, ["id", "name", "context"]) ||
    !isCluster(cluster.id) ||
    !isText(cluster.name) ||
    !isText(cluster.context)
  )
    return;
  if (!isRecord(writes) || typeof writes.on !== "boolean") return;
  if (writes.on && (!hasKeys(writes, ["on", "namespace", "since"]) || !isNamespace(writes.namespace))) return;
  if (writes.on && (typeof writes.since !== "number" || !Number.isFinite(writes.since))) return;
  if (!writes.on && !hasKeys(writes, ["on"])) return;
  let connection: Connection | undefined;

  if ("connection" in value) {
    const read = readConnection(value.connection);

    if (!read) return;
    connection = read;
  }
  return {
    cluster: { id: cluster.id, name: cluster.name, context: cluster.context },
    writes: writes.on
      ? { on: true, namespace: writes.namespace as string, since: writes.since as number }
      : { on: false },
    ...(connection ? { connection } : {}),
  };
}

const REASONS: readonly string[] = CONNECTION_REASON_NAMES;
const CREDENTIALS = ["certificate", "token", "plugin"];

export function readConnection(value: unknown): Connection | undefined {
  if (!isRecord(value) || typeof value.supported !== "boolean") return;
  if (value.supported) {
    if (!hasKeys(value, ["supported", "credential"]) || !CREDENTIALS.includes(value.credential as string)) return;
    return { supported: true, credential: value.credential as "certificate" | "token" | "plugin" };
  }
  if (!hasKeys(value, ["supported", "reason"]) || !REASONS.includes(value.reason as string)) return;
  return { supported: false, reason: value.reason as ConnectionReason };
}

export function readWriteConfirmAnswer(value: unknown): WriteConfirmAnswer | undefined {
  if (!isRecord(value) || !hasKeys(value, ["token", "expires"]) || !isUuid(value.token)) return;
  if (typeof value.expires !== "number" || !Number.isFinite(value.expires)) return;
  return { token: value.token, expires: value.expires };
}

export function readWriteStatus(value: unknown): WriteStatus | undefined {
  if (!isRecord(value) || !hasKeys(value, ["step"], ["count"]) || !isText(value.step, 64)) return;
  if ("count" in value && (typeof value.count !== "number" || !Number.isFinite(value.count))) return;
  return { step: value.step, ...(typeof value.count === "number" ? { count: value.count } : {}) };
}

export function readServerStatusValue(value: unknown): ServerStatusValue | undefined {
  if (!isRecord(value) || !hasKeys(value, ["version", "processed", "plugins", "request"])) return;
  if (!isText(value.version, 256) || !isText(value.processed, 64) || !Array.isArray(value.plugins)) return;
  const request = value.request;

  if (!isRecord(request) || !hasKeys(request, ["name", "uid"]) || !isName(request.name) || !isText(request.uid)) return;
  const plugins: { name: string; kind: string }[] = [];

  for (const plugin of value.plugins) {
    if (!isRecord(plugin) || !hasKeys(plugin, ["name", "kind"]) || !isText(plugin.name) || !isText(plugin.kind)) return;
    plugins.push({ name: plugin.name, kind: plugin.kind });
  }
  return {
    version: value.version,
    processed: value.processed,
    plugins,
    request: { name: request.name, uid: request.uid },
  };
}

// A failure, with the words of its code where the caller has none of its own.
export function failure(code: FailureCode, stage: string, retry: boolean, text: string): Failure {
  return { ok: false, code, stage, retry, text };
}
