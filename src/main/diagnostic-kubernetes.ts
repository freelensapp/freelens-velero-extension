// The create-only adapter of a cluster: every request it makes goes through the client of the host for that
// cluster, `Main.K8sApi.KubeJsonApi.forCluster`, which reaches the API server through the proxy of Freelens,
// with the identity of the connection of the host. The extension reads no kubeconfig, runs no credential
// plugin and keeps no connection of its own.
//
// Before every request the entry of the cluster is read in the catalog of the host: an entry that is not
// there, that is not connected, or whose kubeconfig or context changed since writes were turned on, is
// refused as a target that changed, before anything is sent. The proxy of the host answers a request to a
// cluster that is not connected 503, and an upgrade to one, as the port-forward of the tunnel, starts its proxy.
//
// Every answer is read by its status, which `getResponse` gives whatever it is, and what a call rejects with
// is read by its shape: the client of the host rejects with things that are not an `Error`. It has no
// deadline and no bound on the size of an answer of its own, so the adapter keeps ten seconds for a request,
// with a signal of its own, and 4 MiB of an answer, counted as the body arrives.

import { X509Certificate } from "node:crypto";
import { backupNameProblem } from "../common/backup-from-schedule";
import { BACKUP_NAME_LABEL, BACKUP_UID_LABEL, readDeleteRequest } from "../common/delete-request";
import { type ArtifactTarget, DIAGNOSTIC_REQUEST_LABEL, isArtifactTarget } from "../common/ipc";
import { labelOf } from "../common/name-label";
import { EXISTING_RESOURCE_POLICIES, RESTORE_SPEC_KEYS, restoreNameProblem } from "../common/restore-form";
import { scheduleNameProblem } from "../common/schedule-form";
import { readSchedulePatch } from "../common/schedule-patch";
import { type CatalogEntry, refusalOf, sameEntry } from "./catalog";
import { DiagnosticError } from "./diagnostic-transport";

export interface DiagnosticObject {
  apiVersion?: string;
  kind?: string;
  metadata: { name: string; namespace?: string; uid: string; labels?: Record<string, string> };
  spec?: Record<string, unknown>;
  status?: Record<string, unknown>;
  data?: Record<string, string>;
}

// What the client of the host answers: a structural answer, with its status and its body as it arrives,
// which is not a Response of the DOM. `FetchResponse` of the SDK.
export interface HostAnswer {
  readonly status: number;
  readonly body: ReadableStream<Uint8Array> | null;
  text(): Promise<string>;
}

// What a request is sent with. Header names are lowercase: the client merges them into its own headers key
// by key, and a name in capitals would be sent beside its default, not in its place.
export interface HostRequestInit {
  // In capitals: the fetch of Chromium sends a method other than DELETE, GET, HEAD, OPTIONS, POST and PUT as it is
  // written, and the API server answers a patch in small letters with 405 (SPEC-0017, the contract).
  method: "GET" | "POST" | "PATCH";
  headers: Record<string, string>;
  body?: string;
  signal: AbortSignal;
}

// The client of the host for the API server of one cluster, of which the adapter calls `getResponse` alone:
// it gives the answer whatever its status, where the other calls parse it whole and reject.
export interface HostClient {
  getResponse(
    path: string,
    params: { query?: Record<string, string> } | undefined,
    init: HostRequestInit,
  ): Promise<HostAnswer>;
}

// What the adapter asks of the host for its cluster.
export interface AdapterHost {
  // The entry of the cluster in the catalog of the host as it is now; nothing when it is not there.
  entry(): CatalogEntry | undefined;
  // The client of the host for the cluster: `Main.K8sApi.KubeJsonApi.forCluster(id)`.
  client(): HostClient;
}

// The bounds of one request: the client of the host has neither.
export const REQUEST_BOUNDS = { timeMs: 10_000, bytes: 4 * 1024 ** 2 } as const;

const resources = {
  Backup: "backups",
  Restore: "restores",
  Schedule: "schedules",
  BackupStorageLocation: "backupstoragelocations",
  VolumeSnapshotLocation: "volumesnapshotlocations",
  DownloadRequest: "downloadrequests",
  ServerStatusRequest: "serverstatusrequests",
  DeleteBackupRequest: "deletebackuprequests",
  Pod: "pods",
  Service: "services",
  Secret: "secrets",
  EndpointSlice: "endpointslices",
} as const;
// The label of an endpoint slice that names the Service it is of.
const SERVICE_NAME_LABEL = "kubernetes.io/service-name";
// A value of a label, as the API server takes it: a UID read in a selector is one, and adds no other term to it.
const LABEL_VALUE = /^[A-Za-z0-9](?:[-A-Za-z0-9_.]{0,61}[A-Za-z0-9])?$/;
export type DiagnosticKind = keyof typeof resources;

function name(value: string, maximum = 253): string {
  if (typeof value !== "string" || value.length > maximum || !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(value))
    throw new DiagnosticError("validation");
  return value;
}

// The query of a request, with only the parameters that have a value. The API server reads a key with no
// value as true for a boolean. The client of the host leaves a value that is undefined or null out of the
// address, and writes an empty one as such a key: no parameter without a value is given to it. Nothing at
// all when no parameter is left.
export function queryOf(query: Readonly<Record<string, string | undefined>> = {}): Record<string, string> | undefined {
  const kept = Object.entries(query).filter(
    (entry): entry is [string, string] => typeof entry[1] === "string" && entry[1] !== "",
  );

  return kept.length ? Object.fromEntries(kept) : undefined;
}

// The code of an answer of the API server, by its status. A credential the cluster does not take is told
// from a permission it refuses: it says nothing of what the identity may do. A creation the server failed
// may have happened; one it refused otherwise did not.
function statusError(status: number, creation: boolean): DiagnosticError {
  if (status === 401) return new DiagnosticError("forbidden", undefined, "credential");
  if (status === 403) return new DiagnosticError("forbidden");
  if (status === 404) return new DiagnosticError("not-found");
  if (status === 409) return new DiagnosticError("conflict");
  // The API server refused the request for its content: nothing was made (SPEC-0017, the way of a write). It is told
  // from what the adapter refuses to send by itself.
  if (status === 422) return new DiagnosticError("validation", undefined, "refused");
  return new DiagnosticError(creation && status >= 500 ? "submission-unknown" : "request-failed");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

// What a call of the client of the host rejected with, read by its shape, as the source of the host gives
// them: the `Status` body of a read the API server refused with 403, or the text of that body when it is not
// JSON; an error the client parsed, which carries the body it parsed as `error`, whose `code` is the status
// when the body was a `Status`; and the error of the fetch when no answer came. Only the last is an `Error`,
// and nothing else is taken for one. A creation is never said not to have happened when no answer says so.
export function rejectionOf(rejection: unknown, creation: boolean): DiagnosticError {
  if (rejection instanceof Error) return new DiagnosticError(creation ? "submission-unknown" : "transport-unreachable");
  if (typeof rejection === "string" && !creation) return statusError(403, creation);
  if (isRecord(rejection)) {
    if (rejection.kind === "Status" && Number.isInteger(rejection.code))
      return statusError(rejection.code as number, creation);
    const parsed = rejection.error;

    if (isRecord(parsed) && Number.isInteger(parsed.code)) return statusError(parsed.code as number, creation);
  }
  return new DiagnosticError(creation ? "submission-unknown" : "request-failed");
}

// The body of an answer that is not read is let go, whatever the answer holds.
function discard(answer: unknown): void {
  try {
    const body = isRecord(answer) ? (answer.body as { cancel?: () => Promise<void> } | null | undefined) : undefined;

    body?.cancel?.()?.catch(() => undefined);
  } catch {
    // Nothing of it is of the request.
  }
}

// What is waited for, until the signal of the request is aborted: a client that does not hear the signal
// does not hold the request beyond its bound. What is given late is given to `late`.
function whileOpen<Value>(waited: Promise<Value>, signal: AbortSignal, late?: (value: Value) => void): Promise<Value> {
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

// The body of an answer, counted as it arrives: beyond the bound the request is stopped, and nothing of it is
// kept. An answer without a body as a stream is read as its text, and counted then.
async function bodyOf(
  answer: HostAnswer,
  bound: number,
  signal: AbortSignal,
  stop: () => void,
): Promise<Buffer | undefined> {
  if (!answer.body) {
    const text = Buffer.from(await whileOpen(Promise.resolve(answer.text()), signal), "utf8");

    return text.length > bound ? undefined : text;
  }
  const reader = answer.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;

  try {
    for (;;) {
      const { done, value } = await whileOpen(reader.read(), signal);

      if (done) return Buffer.concat(chunks, size);
      size += value.byteLength;
      if (size > bound) {
        chunks.length = 0;
        reader.cancel().catch(() => undefined);
        stop();
        return undefined;
      }
      chunks.push(value);
    }
  } finally {
    // What is left of the body is not read: an answer that is too large, or a request that was stopped.
    reader.cancel().catch(() => undefined);
  }
}

// The adapter is one for each cluster, made for the entry of the catalog writes were turned on with, and
// asks the cluster for reads, for creations and for the two patches of a schedule, and for nothing else.
// The keys of an object the actions create, and no other: no status, which the API server would keep for a kind with
// no subresource of it, and nothing it does not know.
const OBJECT_KEYS = "apiVersion,kind,metadata,spec";

export class DiagnosticKubernetes {
  // The entry the adapter was made for: its cluster, and the kubeconfig and the context the catalog named.
  readonly binding: Readonly<Omit<CatalogEntry, "status">>;

  constructor(
    entry: CatalogEntry,
    private readonly host: AdapterHost,
    private readonly requestLabels: Readonly<Record<string, string>> = {},
  ) {
    if (!entry?.id || typeof entry.kubeConfigPath !== "string" || typeof entry.contextName !== "string")
      throw new DiagnosticError("validation");
    this.binding = Object.freeze({
      id: entry.id,
      name: entry.name,
      kubeConfigPath: entry.kubeConfigPath,
      contextName: entry.contextName,
    });
  }

  // Why nothing may be sent to the cluster now, if anything: its entry is not there or is not connected,
  // said as such, or it is not the entry the adapter was made for.
  private refusal(): DiagnosticError | undefined {
    let entry: CatalogEntry | undefined;

    try {
      entry = this.host.entry();
    } catch {
      return new DiagnosticError("target-changed");
    }
    const refused = refusalOf(entry);

    if (refused) return new DiagnosticError("target-changed", undefined, refused);
    if (!sameEntry(this.binding, entry)) return new DiagnosticError("target-changed");
    return undefined;
  }

  // Whether the cluster is the one the adapter was made for, and connected. Read before every request.
  assertCurrent(): void {
    const refusal = this.refusal();

    if (refusal) throw refusal;
  }

  private path(kind: DiagnosticKind, namespace: string, objectName?: string): string {
    const base = ["Pod", "Service", "Secret"].includes(kind)
      ? "/api/v1"
      : kind === "EndpointSlice"
        ? "/apis/discovery.k8s.io/v1"
        : "/apis/velero.io/v1";

    return `${base}/namespaces/${name(namespace, 63)}/${resources[kind]}${objectName ? `/${name(objectName)}` : ""}`;
  }

  private async send(
    method: "GET" | "POST" | "PATCH",
    path: string,
    signal: AbortSignal,
    options: { query?: Record<string, string | undefined>; body?: unknown; text?: string; contentType?: string } = {},
  ): Promise<DiagnosticObject> {
    // Before anything leaves: the cluster is in the catalog, connected, and the one of the adapter.
    this.assertCurrent();
    if (signal.aborted) throw new DiagnosticError("cancelled");
    // A write, a creation or a patch, whose answer is lost is not known to have been made, and is looked for.
    const creation = method !== "GET";
    // A body written once, as the review showed it, is sent as it is: what was read is what is sent.
    const payload = options.text ?? (options.body === undefined ? undefined : JSON.stringify(options.body));
    const query = queryOf(options.query);
    let client: HostClient;

    // A client the host does not give: nothing was sent, a creation either.
    try {
      client = this.host.client();
    } catch {
      throw new DiagnosticError("transport-unreachable");
    }
    // The signal of this request: stopped by the operation, at the bound of time, and when its answer is
    // too large.
    const controller = new AbortController();
    let expired = false;
    const abort = () => controller.abort();
    const timer = setTimeout(() => {
      expired = true;
      controller.abort();
    }, REQUEST_BOUNDS.timeMs);
    // What ends a request that has no answer to read: the bound or a lost answer. A creation without an
    // answer is not known to have been made, and is looked for by its name.
    const unanswered = (code: "deadline" | "transport-unreachable") =>
      new DiagnosticError(creation ? "submission-unknown" : code);

    signal.addEventListener("abort", abort, { once: true });
    try {
      let answer: HostAnswer;

      try {
        answer = await whileOpen(
          // Called inside the promise: what the client raises at once is a rejection as well.
          new Promise<HostAnswer>((resolve) =>
            resolve(
              client.getResponse(path, query ? { query } : undefined, {
                method,
                headers: {
                  accept: "application/json",
                  ...(payload === undefined ? {} : { "content-type": options.contentType ?? "application/json" }),
                },
                ...(payload === undefined ? {} : { body: payload }),
                signal: controller.signal,
              }),
            ),
          ),
          controller.signal,
          discard,
        );
      } catch (rejection) {
        if (signal.aborted) throw new DiagnosticError("cancelled");
        if (expired) throw unanswered("deadline");
        throw rejectionOf(rejection, creation);
      }
      if (!isRecord(answer) || !Number.isInteger(answer.status)) {
        discard(answer);
        throw new DiagnosticError(creation ? "submission-unknown" : "request-failed");
      }
      if (answer.status < 200 || answer.status >= 300) {
        discard(answer);
        throw statusError(answer.status, creation);
      }
      let bytes: Buffer | undefined;

      try {
        bytes = await bodyOf(answer, REQUEST_BOUNDS.bytes, controller.signal, abort);
      } catch {
        if (signal.aborted) throw new DiagnosticError("cancelled");
        throw unanswered(expired ? "deadline" : "transport-unreachable");
      }
      // The answer of a creation that cannot be read says nothing of the creation.
      if (!bytes) throw new DiagnosticError(creation ? "submission-unknown" : "payload-too-large");
      // The cluster is looked at again once it answered: an answer of a cluster that changed meanwhile is
      // not used. A creation it answered may have been made, which is said apart.
      if (this.refusal()) throw new DiagnosticError("target-changed", undefined, creation ? "answered" : undefined);
      let result: unknown;

      try {
        result = JSON.parse(bytes.toString("utf8"));
      } catch {
        result = undefined;
      }
      if (!isRecord(result) || !isRecord(result.metadata))
        throw new DiagnosticError(creation ? "submission-unknown" : "request-failed");
      return result as unknown as DiagnosticObject;
    } finally {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
    }
  }

  async read(
    kind: DiagnosticKind,
    namespace: string,
    objectName: string,
    signal: AbortSignal,
  ): Promise<DiagnosticObject> {
    if (!(kind in resources)) throw new DiagnosticError("validation");
    const result = await this.send("GET", this.path(kind, namespace, objectName), signal);

    if (result.metadata.name !== objectName || result.metadata.namespace !== namespace || !result.metadata.uid)
      throw new DiagnosticError("target-changed");
    return result;
  }

  // The endpoint slices of a Service, by the label that names it: the one list the adapter asks for, for
  // the route to a store inside the cluster. What the cluster answers is taken only when every slice is of
  // that namespace and of that Service.
  list(kind: "EndpointSlice", namespace: string, service: string, signal: AbortSignal): Promise<DiagnosticObject[]> {
    if (kind !== "EndpointSlice") throw new DiagnosticError("validation");
    const selector = `${SERVICE_NAME_LABEL}=${name(service, 63)}`;

    return this.send("GET", this.path(kind, namespace), signal, { query: { labelSelector: selector } }).then(
      (result) => {
        const items = (result as { items?: unknown }).items;

        if (
          !Array.isArray(items) ||
          !items.every(
            (item: DiagnosticObject | undefined) =>
              typeof item?.metadata?.name === "string" &&
              item.metadata.namespace === namespace &&
              item.metadata.labels?.[SERVICE_NAME_LABEL] === service,
          )
        )
          throw new DiagnosticError("request-failed");
        return items as DiagnosticObject[];
      },
    );
  }

  createDownload(
    namespace: string,
    target: ArtifactTarget,
    targetName: string,
    requestName: string,
    requestId: string,
    signal: AbortSignal,
  ): Promise<DiagnosticObject> {
    if (!isArtifactTarget(target) || !/^[a-f0-9-]{36}$/.test(requestId)) throw new DiagnosticError("validation");
    return this.send("POST", this.path("DownloadRequest", namespace), signal, {
      body: {
        apiVersion: "velero.io/v1",
        kind: "DownloadRequest",
        metadata: {
          namespace: name(namespace, 63),
          name: name(requestName),
          labels: { ...this.requestLabels, [DIAGNOSTIC_REQUEST_LABEL]: requestId },
        },
        spec: { target: { kind: target, name: name(targetName) } },
      },
    });
  }

  // The Backup a schedule was asked for, sent as the text the review showed, byte for byte (SPEC-0017, REQ-246): a
  // text that is not a Backup of this namespace, with a name the form of the backup takes, is refused before anything
  // leaves.
  createBackup(namespace: string, text: string, signal: AbortSignal): Promise<DiagnosticObject> {
    let body: unknown;

    try {
      body = JSON.parse(text);
    } catch {
      throw new DiagnosticError("validation");
    }
    if (
      !isRecord(body) ||
      Object.keys(body).sort().join() !== OBJECT_KEYS ||
      body.apiVersion !== "velero.io/v1" ||
      body.kind !== "Backup" ||
      !isRecord(body.metadata) ||
      body.metadata.namespace !== namespace ||
      typeof body.metadata.name !== "string" ||
      "generateName" in body.metadata ||
      !isRecord(body.spec)
    )
      throw new DiagnosticError("validation");
    if (backupNameProblem(body.metadata.name) !== undefined) throw new DiagnosticError("validation");
    return this.send("POST", this.path("Backup", namespace), signal, { text });
  }

  // The Schedule of the form, sent as the text the review showed, byte for byte (SPEC-0016, REQ-223, REQ-224): a text
  // that is not a Schedule of this namespace with its name and its namespace alone, a name every backup of it can
  // carry in its label, and a spec, is refused before anything leaves.
  createSchedule(namespace: string, text: string, signal: AbortSignal): Promise<DiagnosticObject> {
    let body: unknown;

    try {
      body = JSON.parse(text);
    } catch {
      throw new DiagnosticError("validation");
    }
    if (
      !isRecord(body) ||
      Object.keys(body).sort().join() !== OBJECT_KEYS ||
      body.apiVersion !== "velero.io/v1" ||
      body.kind !== "Schedule" ||
      !isRecord(body.metadata) ||
      Object.keys(body.metadata).sort().join() !== "name,namespace" ||
      body.metadata.namespace !== namespace ||
      typeof body.metadata.name !== "string" ||
      !isRecord(body.spec)
    )
      throw new DiagnosticError("validation");
    if (scheduleNameProblem(body.metadata.name) !== undefined) throw new DiagnosticError("validation");
    return this.send("POST", this.path("Schedule", namespace), signal, { text });
  }

  // The Restore of the form, sent as the text the review showed, byte for byte (SPEC-0017, REQ-266, REQ-273): a text
  // that is not a Restore of this namespace, with its name and its namespace alone and a spec that names a backup, has
  // only the fields the form offers and a policy for the resources that exist the form offers, is refused before
  // anything leaves.
  createRestore(namespace: string, text: string, signal: AbortSignal): Promise<DiagnosticObject> {
    let body: unknown;

    try {
      body = JSON.parse(text);
    } catch {
      throw new DiagnosticError("validation");
    }
    if (
      !isRecord(body) ||
      Object.keys(body).sort().join() !== OBJECT_KEYS ||
      body.apiVersion !== "velero.io/v1" ||
      body.kind !== "Restore" ||
      !isRecord(body.metadata) ||
      Object.keys(body.metadata).sort().join() !== "name,namespace" ||
      body.metadata.namespace !== namespace ||
      typeof body.metadata.name !== "string" ||
      !isRecord(body.spec) ||
      typeof body.spec.backupName !== "string" ||
      body.spec.backupName === "" ||
      !Object.keys(body.spec).every((key) => (RESTORE_SPEC_KEYS as readonly string[]).includes(key)) ||
      !(EXISTING_RESOURCE_POLICIES as readonly unknown[]).includes(body.spec.existingResourcePolicy)
    )
      throw new DiagnosticError("validation");
    if (restoreNameProblem(body.metadata.name) !== undefined) throw new DiagnosticError("validation");
    return this.send("POST", this.path("Restore", namespace), signal, { text });
  }

  // The pause or the resume of a schedule, sent as the text the review showed, byte for byte, with the method in
  // capitals and the media type of a JSON patch (SPEC-0017, REQ-275): a text that is not exactly the patch of a pause or
  // of a resume of a schedule is refused before anything leaves.
  patchSchedule(namespace: string, scheduleName: string, text: string, signal: AbortSignal): Promise<DiagnosticObject> {
    if (!readSchedulePatch(text) || typeof scheduleName !== "string" || scheduleName === "")
      throw new DiagnosticError("validation");
    return this.send("PATCH", this.path("Schedule", namespace, scheduleName), signal, {
      text,
      contentType: "application/json-patch+json",
    });
  }

  // The ServerStatusRequest of the view of the server (SPEC-0012), with the name the API server generates from the
  // prefix.
  createGenerated(
    kind: "ServerStatusRequest",
    namespace: string,
    prefix: string,
    signal: AbortSignal,
  ): Promise<DiagnosticObject> {
    if (kind !== "ServerStatusRequest" || !prefix.endsWith("-")) throw new DiagnosticError("validation");
    name(prefix.slice(0, -1), 210);
    return this.send("POST", this.path(kind, namespace), signal, {
      body: {
        apiVersion: "velero.io/v1",
        kind,
        metadata: { namespace: name(namespace, 63), generateName: prefix, labels: { ...this.requestLabels } },
        spec: {},
      },
    });
  }

  // The DeleteBackupRequest of one backup, sent as the text the review showed, byte for byte (SPEC-0017, REQ-279): a
  // text that is not exactly the request of a backup of this namespace, as `velero backup delete` makes it, is refused
  // before anything leaves. The adapter deletes nothing itself (REQ-284).
  createDeleteBackupRequest(namespace: string, text: string, signal: AbortSignal): Promise<DiagnosticObject> {
    const read = readDeleteRequest(text);

    if (!read || read.namespace !== namespace) throw new DiagnosticError("validation");
    name(read.backup.name);
    return this.send("POST", this.path("DeleteBackupRequest", namespace), signal, { text });
  }

  // The DeleteBackupRequests of one backup, by the labels that name it and its UID, as the deletion controller finds
  // them (SPEC-0017, REQ-250, REQ-282): what the cluster answers is taken only when every request is of that namespace
  // and carries both labels.
  deleteRequestsOf(
    namespace: string,
    backup: { name: string; uid: string },
    signal: AbortSignal,
  ): Promise<DiagnosticObject[]> {
    const label = labelOf(name(backup.name));

    if (typeof backup.uid !== "string" || !LABEL_VALUE.test(backup.uid)) throw new DiagnosticError("validation");
    const selector = `${BACKUP_NAME_LABEL}=${label},${BACKUP_UID_LABEL}=${backup.uid}`;

    return this.send("GET", this.path("DeleteBackupRequest", namespace), signal, {
      query: { labelSelector: selector },
    }).then((result) => {
      const items = (result as { items?: unknown }).items;

      if (
        !Array.isArray(items) ||
        !items.every(
          (item: DiagnosticObject | undefined) =>
            typeof item?.metadata?.name === "string" &&
            item.metadata.namespace === namespace &&
            item.metadata.labels?.[BACKUP_NAME_LABEL] === label &&
            item.metadata.labels?.[BACKUP_UID_LABEL] === backup.uid,
        )
      )
        throw new DiagnosticError("request-failed");
      return items as DiagnosticObject[];
    });
  }

  async certificate(
    namespace: string,
    storage: { caCert?: string; caCertRef?: { name: string; key: string } },
    signal: AbortSignal,
  ): Promise<string | undefined> {
    // The inline value, which the release keeps for the locations written before the reference. A location
    // that gives both is read as the release reads it: the reference is taken, and what the Secret gives
    // takes the place of the inline value, or the read ends without it.
    let value = storage.caCert;

    if (storage.caCertRef) {
      const reference = storage.caCertRef;
      if (!/^[a-zA-Z0-9._-]+$/.test(reference.key)) throw new DiagnosticError("validation");
      const secret = await this.read("Secret", namespace, reference.name, signal);

      value = secret.data?.[reference.key];
      if (!value) throw new DiagnosticError("tls-invalid");
    }
    if (!value) return undefined;
    try {
      if (value.length > 1024 * 1024) throw new Error();
      const pem = value.startsWith("-----BEGIN CERTIFICATE-----")
        ? value
        : Buffer.from(value, "base64").toString("utf8");

      new X509Certificate(pem);
      return pem;
    } catch {
      throw new DiagnosticError("tls-invalid");
    }
  }
}
