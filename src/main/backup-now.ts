// The write of a backup asked from a schedule by hand (SPEC-0017, REQ-246, REQ-248 to REQ-250, REQ-255 to
// REQ-259). The confirmation reads the schedule, builds the backup the release would make of it and writes its
// text once, which the review shows and the token keeps. The run reads the schedule again, sends that text only
// when the backup it builds now is the same, and reads the backup every second until Velero writes its phase. A
// creation whose answer is not known is never sent again: the backup is looked for by its name.

import { backupFromSchedule, bodyText, SCHEDULE_NAME_LABEL, scheduleRefused } from "../common/backup-from-schedule";
import {
  type Answer,
  type BackupCreated,
  failure,
  type WriteConfirmAnswer,
  type WriteConfirmRequest,
  type WriteRunRequest,
} from "../common/ipc";
import { DiagnosticError } from "./diagnostic-transport";

import type { DiagnosticKubernetes, DiagnosticObject } from "./diagnostic-kubernetes";
import type { Write, WriteGate } from "./write-gate";

// How long after its creation the backup is read for the phase Velero writes, and how often (SPEC-0017, REQ-248).
export const READ_AFTER = { everyMs: 1000, forMs: 30_000 };
// The margin of the clocks within which a backup found by its name is taken for the one created (SPEC-0016).
export const CREATION_MARGIN = 60_000;

export const BACKUP_NOW_WORDS = {
  notASchedule: "A backup is asked from one schedule, by its name and its UID, with the name of the backup.",
  scheduleChanged:
    "The schedule changed since the view read it: another one has its name now. Go back to the view, which reads it again.",
  reviewChanged: "The schedule changed since the review: nothing was sent. Ask for a new review.",
  scheduleGone: "The schedule is not there any more: nothing was sent.",
  unreadable: "The schedule could not be read as a schedule: nothing was sent.",
  exists: (name: string) =>
    `A backup named ${name} is already there, and is left as it is: nothing was created. Ask for a new review with another name.`,
  forbidden: (namespace: string) =>
    `The identity of this cluster may not read the schedule or create a backup in ${namespace}: nothing was created.`,
  refused: "The API server refused the backup as written: nothing was created.",
  notDone: (name: string) =>
    `The API server did not answer the creation, and the backup ${name} is not there as far as the reads show. Asking again is a new review.`,
  other: (name: string) =>
    `The API server did not answer the creation, and a backup named ${name} is there that is not known to be this one: it is not from this schedule, or it is older than the confirmation.`,
  unknown: (name: string) =>
    `The API server did not answer the creation, and the backup ${name} could not be read: it may have been created. It is not sent again by itself: look for it among the backups.`,
  failed: "The backup could not be asked: nothing is known to have been created.",
};

// What the main process gives the procedures of this write.
export interface BackupNowDependencies {
  gate: WriteGate<DiagnosticKubernetes>;
  now(): number;
  // Waits, or ends with the signal.
  sleep(milliseconds: number, signal: AbortSignal): Promise<void>;
}

function phaseOf(object: DiagnosticObject): string | undefined {
  const phase = (object as { status?: { phase?: unknown } }).status?.phase;

  return typeof phase === "string" && phase ? phase : undefined;
}

// The end of a read or of the creation, in the words of this write; a cluster that changed is said as it is.
function endOf(error: unknown, stage: string, namespace: string, backup: string): Answer<never> {
  if (!(error instanceof DiagnosticError)) return failure("request-failed", stage, false, BACKUP_NOW_WORDS.failed);
  switch (error.code) {
    case "not-found":
      return failure("not-found", stage, false, BACKUP_NOW_WORDS.scheduleGone);
    case "forbidden":
      return failure("forbidden", stage, false, BACKUP_NOW_WORDS.forbidden(namespace));
    case "conflict":
      return failure("conflict", stage, false, BACKUP_NOW_WORDS.exists(backup));
    case "validation":
      return failure("validation", stage, false, BACKUP_NOW_WORDS.refused);
    case "target-changed":
      return failure("target-changed", stage, false, "The cluster changed: nothing more is asked of it.");
    case "cancelled":
      return failure("cancelled", stage, false, "The write was cancelled.");
    default:
      return failure(error.code, stage, false, BACKUP_NOW_WORDS.failed);
  }
}

// The confirmation: the gate is open for the namespace, the schedule is the one the view read, and the backup it
// makes is written as the text that the review shows and the run sends.
export async function confirmBackupNow(
  dependencies: BackupNowDependencies,
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
  const confirmed = dependencies.gate.confirm(
    sender,
    request.cluster,
    request.namespace,
    request.kind,
    target,
    undefined,
    { backup, text },
  );

  return confirmed.ok ? { ok: true, value: { ...confirmed.value, text } } : confirmed;
}

// The reads after the creation: every second for thirty seconds, until Velero writes a phase of the backup that
// was created, by its UID. What is read is what is answered; a phase not written yet is none.
async function readAfter(
  dependencies: BackupNowDependencies,
  adapter: DiagnosticKubernetes,
  namespace: string,
  created: DiagnosticObject,
  signal: AbortSignal,
  write: Write,
): Promise<Answer<BackupCreated>> {
  const name = created.metadata.name;
  const uid = created.metadata.uid;
  let phase = phaseOf(created);
  const until = dependencies.now() + READ_AFTER.forMs;

  write.status = { step: "waiting for Velero" };
  while (!phase && dependencies.now() < until && !signal.aborted) {
    try {
      await dependencies.sleep(READ_AFTER.everyMs, signal);
      const read = await adapter.read("Backup", namespace, name, signal);

      // Another backup of that name is not the one created: nothing more is read of it.
      if (read.metadata.uid !== uid) break;
      phase = phaseOf(read);
    } catch {
      break;
    }
  }
  return { ok: true, value: { name, uid, ...(phase ? { phase } : {}) } };
}

// A creation whose answer is not known: the backup is read by its name, and is the one created when its creation is
// not earlier than a minute before the confirmation and it carries the label of the schedule (SPEC-0017, REQ-250).
async function reconcile(
  dependencies: BackupNowDependencies,
  adapter: DiagnosticKubernetes,
  request: WriteRunRequest,
  confirmedAt: number,
  signal: AbortSignal,
  write: Write,
): Promise<Answer<BackupCreated>> {
  const backup = String(request.backup);

  write.status = { step: "looking for the backup" };
  let found: DiagnosticObject;

  try {
    found = await adapter.read("Backup", request.namespace, backup, signal);
  } catch (error) {
    if (error instanceof DiagnosticError && error.code === "not-found")
      return failure("submission-unknown", "creation", false, BACKUP_NOW_WORDS.notDone(backup));
    return failure("submission-unknown", "creation", false, BACKUP_NOW_WORDS.unknown(backup));
  }
  const created = Date.parse(String((found.metadata as { creationTimestamp?: unknown }).creationTimestamp));
  const ours =
    Number.isFinite(created) &&
    created >= confirmedAt - CREATION_MARGIN &&
    found.metadata.labels?.[SCHEDULE_NAME_LABEL] === request.target?.name;

  if (!ours) return failure("submission-unknown", "creation", false, BACKUP_NOW_WORDS.other(backup));
  return readAfter(dependencies, adapter, request.namespace, found, signal, write);
}

// The run: the token of the confirmation, the schedule read again and the same backup built of it, the text sent
// byte for byte, and the reads after the creation. The caller watches the frame and ends the write.
export async function runBackupNow(
  dependencies: BackupNowDependencies,
  sender: string,
  request: WriteRunRequest,
  watch: (write: Write) => () => void,
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
    // A frame that went before anything was sent leaves nothing to look for.
    if (signal.aborted) return failure("cancelled", "creation", false, "The write was cancelled: nothing was sent.");
    write.status = { step: "creating the backup" };
    let created: DiagnosticObject;

    try {
      created = await adapter.createBackup(request.namespace, text, signal);
    } catch (error) {
      // No answer, or one dropped on this side once the request had left: the backup may be there. It is looked for,
      // with reads of their own, which the frame that went does not stop.
      if (error instanceof DiagnosticError && (error.code === "submission-unknown" || error.code === "cancelled"))
        return reconcile(dependencies, adapter, request, confirmedAt, new AbortController().signal, write);
      return endOf(error, "creation", request.namespace, backup);
    }
    if (created.metadata.name !== backup || !created.metadata.uid)
      return failure("submission-unknown", "creation", false, BACKUP_NOW_WORDS.unknown(backup));
    return await readAfter(dependencies, adapter, request.namespace, created, signal, write);
  } finally {
    stop();
    dependencies.gate.finish(request.cluster, request.request);
  }
}
