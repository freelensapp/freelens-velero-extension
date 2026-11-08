// The write of a backup asked from a schedule by hand (SPEC-0017, REQ-246, REQ-248 to REQ-250, REQ-255 to
// REQ-259). The confirmation reads the schedule, builds the backup the release would make of it and writes its
// text once, which the review shows and the token keeps. The run reads the schedule again, sends that text only
// when the backup it builds now is the same, and reads the backup every second until Velero writes its phase. A
// creation whose answer is not known is never sent again: the backup is looked for by its name.

import { backupFromSchedule, bodyText, scheduleRefused } from "../common/backup-from-schedule";
import {
  type Answer,
  type BackupCreated,
  carriedErrors,
  failure,
  textWithinBound,
  type WriteConfirmAnswer,
  type WriteConfirmRequest,
  type WriteRunRequest,
} from "../common/ipc";
import { type CreationDependencies, canonical, createKept } from "./creation";
import { DiagnosticError } from "./diagnostic-transport";

import type { DiagnosticKubernetes, DiagnosticObject } from "./diagnostic-kubernetes";
import type { Write } from "./write-gate";

// The label Velero adds to a backup when it starts it: a backup found by its name may carry it beside the labels of
// the text.
const LOCATION_LABEL = "velero.io/storage-location";

export const BACKUP_NOW_WORDS = {
  notASchedule: "A backup is asked from one schedule, by its name and its UID, with the name of the backup.",
  scheduleChanged:
    "The schedule changed since the view read it: another one has its name now. Go back to the view, which reads it again.",
  reviewChanged: "The schedule changed since the review: nothing was sent. Ask for a new review.",
  scheduleGone: "The schedule is not there any more: nothing was sent.",
  notServed: (namespace: string) =>
    `The API server answered that what the backup needs is not there, the namespace ${namespace} or the kind Backup of Velero: nothing was created.`,
  unreadable: "The schedule could not be read as a schedule: nothing was sent.",
  tooLarge: (characters: number) =>
    `The backup this schedule makes is written in ${characters} characters, more than a review carries: nothing was confirmed. A backup of this schedule is asked from the command line.`,
  exists: (name: string) =>
    `A backup named ${name} is already there, and is left as it is: nothing was created. Ask for a new review with another name.`,
  forbiddenRead: (namespace: string) =>
    `The identity of this cluster may not read the schedule in ${namespace}: nothing was sent.`,
  forbiddenCreate: (namespace: string) =>
    `The identity of this cluster may not create a backup in ${namespace}: nothing was created.`,
  credential:
    "The cluster did not take the credential of the context: it may have expired. Sign in again, then ask again. Nothing was created.",
  refused: "The API server refused the backup as written: nothing was created.",
  unsent: "The backup could not be written for the cluster: nothing was sent.",
  declined: "The API server did not take the creation, for a reason the extension does not name: nothing was created.",
  changed: "The cluster changed: nothing was sent to it.",
  cancelled: "The write was cancelled: nothing was sent.",
  unreachable: "The API server could not be reached: nothing was sent. Asking again is safe.",
  slow: "The API server did not answer the read of the schedule in time: nothing was sent. Asking again is safe.",
  frameGone: "The frame that asked for the write is not there any more: nothing was sent.",
  frameGoneAfter: "The frame that asked for the write is not there any more.",
  changedAfter: (name: string) =>
    `The cluster changed while it answered the creation: its answer is not used, and the backup ${name} may have been created. It is not sent again by itself: look for it among the backups.`,
  notDone: (name: string) =>
    `The API server did not answer the creation, and the backup ${name} is not there as far as the reads show. Asking again is a new review.`,
  other: (name: string) =>
    `The API server did not answer the creation, and a backup named ${name} is there that is not known to be this one: it does not carry the labels or the fields of the review, or it is older than the confirmation.`,
  unknown: (name: string) =>
    `The API server did not answer the creation, and the backup ${name} could not be read: it may have been created. It is not sent again by itself: look for it among the backups.`,
  failed: "The backup could not be asked: nothing is known to have been created.",
};

// Where a backup is in the queue of the server, and the errors of the validation Velero refused it with, as written:
// what the contract cannot carry is counted, and read in the view of the backup.
function detailsOf(object: DiagnosticObject): { position?: number; errors?: string[]; errorsLeft?: number } {
  const status = (object as { status?: { queuePosition?: unknown; validationErrors?: unknown } }).status;
  const position = status?.queuePosition;

  return {
    ...(Number.isSafeInteger(position) && (position as number) >= 1 ? { position: position as number } : {}),
    ...carriedErrors(status?.validationErrors),
  };
}

// The end of a read or of the creation, in the words of this write, with whether asking again is safe: it is where
// nothing was sent and what stopped it may pass. A cluster that changed is said as it is. A creation the API server
// answered and the adapter did not take, because the cluster changed meanwhile, may have made the backup.
function endOf(error: unknown, stage: "read" | "creation", namespace: string, backup: string): Answer<never> {
  const creation = stage === "creation";

  if (!(error instanceof DiagnosticError)) return failure("request-failed", stage, false, BACKUP_NOW_WORDS.failed);
  switch (error.code) {
    case "not-found":
      return failure(
        "not-found",
        stage,
        false,
        creation ? BACKUP_NOW_WORDS.notServed(namespace) : BACKUP_NOW_WORDS.scheduleGone,
      );
    case "forbidden":
      // A credential the cluster does not take says nothing of what the identity may do (SPEC-0017, ACT-06).
      if (error.verdict === "credential") return failure("request-failed", stage, true, BACKUP_NOW_WORDS.credential);
      return failure(
        "forbidden",
        stage,
        false,
        creation ? BACKUP_NOW_WORDS.forbiddenCreate(namespace) : BACKUP_NOW_WORDS.forbiddenRead(namespace),
      );
    case "conflict":
      return failure("conflict", stage, false, BACKUP_NOW_WORDS.exists(backup));
    case "validation":
      // The API server refused the body; or the adapter refused to send it, and nothing reached the cluster.
      return failure(
        "validation",
        stage,
        false,
        error.verdict === "refused" ? BACKUP_NOW_WORDS.refused : BACKUP_NOW_WORDS.unsent,
      );
    case "target-changed":
      if (error.verdict === "answered")
        return failure("submission-unknown", stage, false, BACKUP_NOW_WORDS.changedAfter(backup));
      return failure("target-changed", stage, false, BACKUP_NOW_WORDS.changed);
    case "cancelled":
      return failure("cancelled", stage, true, BACKUP_NOW_WORDS.cancelled);
    case "deadline":
      return failure("deadline", stage, true, BACKUP_NOW_WORDS.slow);
    case "transport-unreachable":
      return failure("transport-unreachable", stage, true, BACKUP_NOW_WORDS.unreachable);
    case "request-failed":
      return failure("request-failed", stage, false, creation ? BACKUP_NOW_WORDS.declined : BACKUP_NOW_WORDS.failed);
    default:
      return failure(error.code, stage, false, BACKUP_NOW_WORDS.failed);
  }
}

// The confirmation: the gate is open for the namespace, the schedule is the one the view read, and the backup it
// makes is written as the text that the review shows and the run sends.
export async function confirmBackupNow(
  dependencies: CreationDependencies,
  sender: string,
  request: WriteConfirmRequest,
  signal: AbortSignal,
): Promise<Answer<WriteConfirmAnswer>> {
  const { target, backup } = request;

  if (target?.kind !== "Schedule" || !backup)
    return failure("validation", "request", false, BACKUP_NOW_WORDS.notASchedule);
  const refused = scheduleRefused(target.name);

  if (refused) return failure("validation", "request", false, refused);
  const opened = dependencies.gate.opened(request.cluster, request.namespace);

  if (!opened.ok) return opened;
  let schedule: DiagnosticObject;

  try {
    schedule = await opened.value.read("Schedule", request.namespace, target.name, signal);
  } catch (error) {
    return endOf(error, "read", request.namespace, backup);
  }
  if (schedule.metadata.uid !== target.uid) return failure("conflict", "read", false, BACKUP_NOW_WORDS.scheduleChanged);
  const body = backupFromSchedule(schedule, backup);

  if (!body) return failure("request-failed", "read", false, BACKUP_NOW_WORDS.unreadable);
  const text = bodyText(body);

  // The text travels in the answer of the confirmation: one the answer cannot carry is not confirmed, and no token is
  // given for it.
  if (!textWithinBound(text)) return failure("validation", "review", false, BACKUP_NOW_WORDS.tooLarge(text.length));
  const confirmed = dependencies.gate.confirm(
    sender,
    request.cluster,
    request.namespace,
    request.kind,
    target,
    undefined,
    { name: backup, text },
  );

  return confirmed.ok ? { ok: true, value: { ...confirmed.value, text } } : confirmed;
}

// The labels the text gives the backup, which a backup found by its name carries when it is the one created: none for a
// backup of the form, which has no label. Nothing when the text cannot be read.
function labelsOf(text: string): Record<string, string> | undefined {
  try {
    const metadata = (JSON.parse(text) as { metadata?: unknown }).metadata;

    if (!metadata || typeof metadata !== "object") return undefined;
    const labels = (metadata as { labels?: unknown }).labels;

    if (labels === undefined) return {};
    return labels && typeof labels === "object" ? (labels as Record<string, string>) : undefined;
  } catch {
    return undefined;
  }
}

// The fields of the spec of a backup of the form that Velero keeps as they were sent when it starts it: the storage
// location, which the form always writes, the selectors, the namespaces included, the choices and the durations. The
// lists it adds to, the excluded namespaces, the resources and the snapshot locations, are not among them.
const KEPT_AS_SENT = [
  "storageLocation",
  "includedNamespaces",
  "labelSelector",
  "orLabelSelectors",
  "snapshotVolumes",
  "includeClusterResources",
  "defaultVolumesToFsBackup",
  "snapshotMoveData",
  "ttl",
  "csiSnapshotTimeout",
  "itemOperationTimeout",
];

// Whether a backup found by its name carries the fields of the text that Velero keeps as they were sent. A backup of
// the form has no label and no source: what tells it from one another hand made with its name is its spec.
function keptAsSent(text: string, found: DiagnosticObject): boolean {
  let sent: Record<string, unknown> | undefined;

  try {
    sent = (JSON.parse(text) as { spec?: Record<string, unknown> }).spec;
  } catch {
    return false;
  }
  const carried = ((found as { spec?: unknown }).spec ?? {}) as Record<string, unknown>;

  return (
    sent !== undefined &&
    KEPT_AS_SENT.every((field) => !(field in sent) || canonical(sent[field]) === canonical(carried[field]))
  );
}

// Whether a backup found by its name after an answer that was lost is the one created: it carries every label of the
// text, the label of the schedule among them for a backup asked from one, and the label of the storage location is the
// one Velero adds (SPEC-0017, REQ-250); a backup of the form, which has no label, carries the fields Velero keeps as
// they were sent.
function sameBackup(text: string, found: DiagnosticObject): boolean {
  const labels = labelsOf(text);
  const carried = found.metadata.labels ?? {};

  return (
    labels !== undefined &&
    Object.entries(labels).every(([key, value]) => key === LOCATION_LABEL || carried[key] === value) &&
    (Object.keys(labels).length > 0 || keptAsSent(text, found))
  );
}

// The run: the token of the confirmation, the schedule read again and the same backup built of it, the frame that
// asked still there, the text sent byte for byte, and the reads after the creation. The caller watches the frame and
// ends the write.
export async function runBackupNow(
  dependencies: CreationDependencies,
  sender: string,
  request: WriteRunRequest,
  watch: (write: Write) => () => void,
  still: () => boolean = () => true,
): Promise<Answer<BackupCreated>> {
  const { target, backup } = request;

  if (target?.kind !== "Schedule" || !backup)
    return failure("validation", "request", false, BACKUP_NOW_WORDS.notASchedule);
  const taken = dependencies.gate.take(
    sender,
    request.cluster,
    request.namespace,
    request.kind,
    target,
    request.token,
    request.request,
    undefined,
    backup,
  );

  if (!taken.ok) return taken;
  const { adapter, write, text, confirmedAt } = taken.value;
  const signal = write.controller.signal;
  const stop = watch(write);

  try {
    write.status = { step: "reading the schedule" };
    let schedule: DiagnosticObject;

    try {
      schedule = await adapter.read("Schedule", request.namespace, target.name, signal);
    } catch (error) {
      return endOf(error, "read", request.namespace, backup);
    }
    if (schedule.metadata.uid !== target.uid)
      return failure("conflict", "read", false, BACKUP_NOW_WORDS.scheduleChanged);
    const again = backupFromSchedule(schedule, backup);

    // What would be sent now is what the review showed, or nothing is sent.
    if (!text || !again || bodyText(again) !== text)
      return failure("conflict", "read", false, BACKUP_NOW_WORDS.reviewChanged);
    return await createBackupKept(dependencies, adapter, request, text, confirmedAt, write, still);
  } finally {
    stop();
    dependencies.gate.finish(request.cluster, request.request);
  }
}

// The creation of a backup whose text the confirmation kept, once what it depends on was read again: from a schedule
// or from the form, the same POST of that text, the same reads after it, and, when its answer is not known, the same
// look for the backup by its name (SPEC-0017, REQ-248 to REQ-250). Every end of a request that was sent is kept.
export function createBackupKept(
  dependencies: CreationDependencies,
  adapter: DiagnosticKubernetes,
  request: WriteRunRequest,
  text: string,
  confirmedAt: number,
  write: Write,
  still: () => boolean,
): Promise<Answer<BackupCreated>> {
  const backup = String(request.backup);

  return createKept(
    {
      kind: "Backup",
      noun: "backup",
      name: backup,
      create: (to, namespace, body, signal) => to.createBackup(namespace, body, signal),
      endOf: (error) => endOf(error, "creation", request.namespace, backup),
      same: (found) => sameBackup(text, found),
      value: (read, phase, found) => ({
        name: read.metadata.name,
        uid: read.metadata.uid,
        ...(phase ? { phase } : {}),
        ...detailsOf(read),
        ...(found ? { found: true } : {}),
      }),
      words: {
        cancelled: BACKUP_NOW_WORDS.cancelled,
        frameGone: BACKUP_NOW_WORDS.frameGone,
        frameGoneAfter: BACKUP_NOW_WORDS.frameGoneAfter,
        notDone: BACKUP_NOW_WORDS.notDone(backup),
        unknown: BACKUP_NOW_WORDS.unknown(backup),
      },
      other: failure("submission-unknown", "creation", false, BACKUP_NOW_WORDS.other(backup)),
    },
    dependencies,
    adapter,
    request,
    text,
    confirmedAt,
    write,
    still,
  );
}
