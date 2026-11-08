// The deletion of one backup (SPEC-0017, REQ-278 to REQ-284). The confirmation reads the backup by its name, checks that
// it is the one the view read and in a phase Velero deletes, and writes its DeleteBackupRequest once, as `velero backup
// delete` of the release makes it: the review shows that text and the token keeps it. The run takes the name of the
// backup as the operator typed it, reads the backup again, sends the text byte for byte, then reads the request by the
// name the API server gave it, and the backup with it, every second for thirty seconds at most, until what the two show
// together is an end (REQ-282). A creation whose answer is not known is never sent again: the requests of the backup are
// read by its labels, with the backup (REQ-250). Nothing here deletes an object: the adapter has no DELETE (REQ-284).

import { BACKUP_UID_LABEL, deleteRequestOf, deleteRequestText, readDeleteRequest } from "../common/delete-request";
import {
  type Answer,
  type BackupDeleted,
  carriedErrors,
  type DeletionEnd,
  failure,
  type WriteConfirmAnswer,
  type WriteConfirmRequest,
  type WriteRunRequest,
  type WriteTarget,
} from "../common/ipc";
import { CREATION_MARGIN, type CreationDependencies, phaseOf, READ_AFTER, sent } from "./creation";
import { DiagnosticError } from "./diagnostic-transport";

import type { DiagnosticKubernetes, DiagnosticObject } from "./diagnostic-kubernetes";
import type { Write } from "./write-gate";

// The phases of a backup Velero refuses to delete: in progress, waiting for its plugins, or finalizing
// (backup_deletion_controller.go L155-L208, backup_tracker.go L94-L103). One with no phase, New, Queued or ReadyToStart
// it deletes before it starts.
export const IN_PROGRESS = [
  "InProgress",
  "WaitingForPluginOperations",
  "WaitingForPluginOperationsPartiallyFailed",
  "Finalizing",
  "FinalizingPartiallyFailed",
] as const;

// How long the look for the request after an answer that was lost may last at most, within the thirty seconds of the
// reads after the creation.
export const LOOK_AFTER = { forMs: 10_000 };

// The one error of a refusal of the release, written before Velero changes anything of the backup
// (backup_deletion_controller.go L631-L637): a request it refused deleted nothing.
const REFUSAL = "backup deletion failed: ";

export const BACKUP_DELETE_WORDS = {
  notADeletion:
    "The request is not one of a deletion: a deletion is asked of one backup, by its name and its UID, and the name of the backup is typed before the request is created. Nothing was sent.",
  typed: (backup: string) =>
    `The name typed is not the name of the backup ${backup}: nothing was sent. Type it as it is written in the review.`,
  backupChanged:
    "The backup changed since the view read it: another one has its name now. Go back to the view, which reads it again.",
  inProgress: (backup: string, phase: string) =>
    `The backup ${backup} is ${phase} now: Velero refuses to delete a backup in progress, waiting for its plugins or finalizing, and nothing was sent. Go back to the view, which reads it again.`,
  reviewChanged:
    "The request the run would send is not the one the review showed: nothing was sent. Ask for a new review.",
  backupGone: (backup: string) => `The backup ${backup} is not there any more: nothing was sent.`,
  notServed: (namespace: string) =>
    `The API server answered that what the request needs is not there, the namespace ${namespace} or the kind DeleteBackupRequest of Velero: nothing was created.`,
  // A 409: the name the API server generated from the prefix met the name of a request that is there (REQ-279).
  exists:
    "The name the API server generated for the request is the name of a request that is already there: nothing was created. Asking again is a new review.",
  forbiddenRead: (namespace: string) =>
    `The identity of this cluster may not read the backup in ${namespace}: nothing was sent.`,
  forbiddenCreate: (namespace: string) =>
    `The identity of this cluster may not create a DeleteBackupRequest in ${namespace}: nothing was created.`,
  credential:
    "The cluster did not take the credential of the context: it may have expired. Sign in again, then ask again. Nothing was created.",
  rejected: "The API server refused the request as written: nothing was created.",
  unsent: "The request could not be written for the cluster: nothing was sent.",
  declined: "The API server did not take the creation, for a reason the extension does not name: nothing was created.",
  changed: "The cluster changed: nothing was sent to it.",
  cancelled: "The write was cancelled: nothing was sent.",
  unreachable: "The API server could not be reached: nothing was sent. Asking again is safe.",
  slow: "The API server did not answer the read of the backup in time: nothing was sent. Asking again is safe.",
  frameGone: "The frame that asked for the write is not there any more: nothing was sent.",
  frameGoneAfter: "The frame that asked for the write is not there any more.",
  changedAfter: (backup: string) =>
    `The cluster changed while it answered the creation: its answer is not used, and a request to delete the backup ${backup} may have been created. It is not sent again by itself: the view of the backup says whether Velero deletes it.`,
  // The API server answered the creation with something that is not the request of this backup.
  strange: (backup: string) =>
    `The API server answered the creation with something that is not a request to delete the backup ${backup}: its answer is not used, and a request may have been created. It is not sent again by itself: the view of the backup says whether Velero deletes it.`,
  // The answers of a look for the request by the labels of its backup, after a creation whose answer is not known
  // (REQ-250).
  notDone: (backup: string) =>
    `The API server did not answer the creation, and no request to delete the backup ${backup} made since a minute before the confirmation is there as far as the read shows, while the backup is. It is not sent again by itself: asking again is a new review.`,
  unknown: (backup: string) =>
    `The API server did not answer the creation, and the requests of the backup ${backup} could not be read: a request may have been created. It is not sent again by itself: the view of the backup says whether Velero deletes it.`,
  failed: "The deletion could not be asked: nothing is known to have been created.",
};

// The end of a read of the backup or of the creation, in the words of this write, with whether asking again is safe:
// it is where nothing was sent and what stopped it may pass. A creation the API server answered and the adapter did not
// take, because the cluster changed meanwhile, may have made the request.
function endOf(error: unknown, stage: "read" | "creation", namespace: string, backup: string): Answer<never> {
  const creation = stage === "creation";

  if (!(error instanceof DiagnosticError)) return failure("request-failed", stage, false, BACKUP_DELETE_WORDS.failed);
  switch (error.code) {
    case "not-found":
      return failure(
        "not-found",
        stage,
        false,
        creation ? BACKUP_DELETE_WORDS.notServed(namespace) : BACKUP_DELETE_WORDS.backupGone(backup),
      );
    case "forbidden":
      // A credential the cluster does not take says nothing of what the identity may do.
      if (error.verdict === "credential") return failure("request-failed", stage, true, BACKUP_DELETE_WORDS.credential);
      return failure(
        "forbidden",
        stage,
        false,
        creation ? BACKUP_DELETE_WORDS.forbiddenCreate(namespace) : BACKUP_DELETE_WORDS.forbiddenRead(namespace),
      );
    case "conflict":
      return failure("conflict", stage, false, BACKUP_DELETE_WORDS.exists);
    case "validation":
      // The API server refused the body; or the adapter refused to send it, and nothing reached the cluster.
      return failure(
        "validation",
        stage,
        false,
        error.verdict === "refused" ? BACKUP_DELETE_WORDS.rejected : BACKUP_DELETE_WORDS.unsent,
      );
    case "target-changed":
      if (error.verdict === "answered")
        return failure("submission-unknown", stage, false, BACKUP_DELETE_WORDS.changedAfter(backup));
      return failure("target-changed", stage, false, BACKUP_DELETE_WORDS.changed);
    case "cancelled":
      return failure("cancelled", stage, true, BACKUP_DELETE_WORDS.cancelled);
    case "deadline":
      return failure("deadline", stage, true, BACKUP_DELETE_WORDS.slow);
    case "transport-unreachable":
      return failure("transport-unreachable", stage, true, BACKUP_DELETE_WORDS.unreachable);
    case "request-failed":
      return failure(
        "request-failed",
        stage,
        false,
        creation ? BACKUP_DELETE_WORDS.declined : BACKUP_DELETE_WORDS.failed,
      );
    default:
      return failure(error.code, stage, false, BACKUP_DELETE_WORDS.failed);
  }
}

// The backup of the review, read by its name in the namespace of the installation: the one the view read, by its UID
// (REQ-279), and in a phase Velero deletes (REQ-278), or nothing is sent.
async function readBackup(
  adapter: DiagnosticKubernetes,
  namespace: string,
  target: WriteTarget,
  signal: AbortSignal,
): Promise<Answer<DiagnosticObject>> {
  let backup: DiagnosticObject;

  try {
    backup = await adapter.read("Backup", namespace, target.name, signal);
  } catch (error) {
    return endOf(error, "read", namespace, target.name);
  }
  if (backup.metadata.uid !== target.uid) return failure("conflict", "read", false, BACKUP_DELETE_WORDS.backupChanged);
  const phase = phaseOf(backup);

  if (phase !== undefined && (IN_PROGRESS as readonly string[]).includes(phase))
    return failure("conflict", "read", false, BACKUP_DELETE_WORDS.inProgress(target.name, phase));
  return { ok: true, value: backup };
}

// The confirmation: a deletion of one backup, the gate open for the namespace, the backup the one the view read and in
// a phase Velero deletes, and its request written as the text the review shows and the run sends.
export async function confirmBackupDelete(
  dependencies: CreationDependencies,
  sender: string,
  request: WriteConfirmRequest,
  signal: AbortSignal,
): Promise<Answer<WriteConfirmAnswer>> {
  const { target } = request;

  if (request.kind !== "delete-backup" || target?.kind !== "Backup")
    return failure("validation", "request", false, BACKUP_DELETE_WORDS.notADeletion);
  const opened = dependencies.gate.opened(request.cluster, request.namespace);

  if (!opened.ok) return opened;
  const read = await readBackup(opened.value, request.namespace, target, signal);

  if (!read.ok) return read;
  // The text travels in the answer of the confirmation: the request of a backup, whose names the contract bounds, is
  // always within the bound of an answer.
  const text = deleteRequestText(deleteRequestOf(request.namespace, { name: target.name, uid: target.uid }));
  const confirmed = dependencies.gate.confirm(
    sender,
    request.cluster,
    request.namespace,
    request.kind,
    target,
    undefined,
    { name: target.name, text },
  );

  return confirmed.ok ? { ok: true, value: { ...confirmed.value, text } } : confirmed;
}

// A request as the reads after its creation take it: its name and its UID, its phase and its errors.
interface RequestRead {
  name: string;
  uid: string;
  phase?: string;
  errors?: unknown;
}

function requestOf(item: DiagnosticObject): RequestRead {
  const phase = phaseOf(item);

  return {
    name: item.metadata.name,
    uid: item.metadata.uid,
    ...(phase ? { phase } : {}),
    ...(item.status && "errors" in item.status ? { errors: item.status.errors } : {}),
  };
}

function createdAt(item: DiagnosticObject): number {
  return Date.parse(String((item.metadata as { creationTimestamp?: unknown }).creationTimestamp));
}

// The requests of the backup by the labels that name it, created since a minute before the confirmation, the newest
// first: this request, or another one of the same backup, asked by someone else or by the collector of the expired
// backups (REQ-250).
async function requestsSince(
  adapter: DiagnosticKubernetes,
  namespace: string,
  backup: { name: string; uid: string },
  confirmedAt: number,
  signal: AbortSignal,
): Promise<DiagnosticObject[]> {
  const found = await adapter.deleteRequestsOf(namespace, backup, signal);

  return found
    .filter((item) => Number.isFinite(createdAt(item)) && createdAt(item) >= confirmedAt - CREATION_MARGIN)
    .sort((one, other) => createdAt(other) - createdAt(one));
}

// What one read of the request and of its backup shows: the request, or none when it is not there; that the requests
// could not be read, for the identity may not; and the phase of the backup, empty when it has none, or nothing when it
// is not there. Another backup of its name is not the one of the request: this one is gone.
interface Shown {
  request?: RequestRead;
  requestsUnread: boolean;
  backup: string | null;
}

async function show(
  adapter: DiagnosticKubernetes,
  namespace: string,
  backup: { name: string; uid: string },
  named: { name: string; uid: string } | undefined,
  confirmedAt: number,
  requestsUnread: boolean,
  signal: AbortSignal,
): Promise<Shown> {
  let request: RequestRead | undefined;
  let unread = requestsUnread;

  if (!unread) {
    try {
      if (named) {
        const read = requestOf(await adapter.read("DeleteBackupRequest", namespace, named.name, signal));

        // Another request of the name is not the one created: this one is gone (REQ-248).
        request = read.uid === named.uid ? read : undefined;
      } else {
        const newest = (await requestsSince(adapter, namespace, backup, confirmedAt, signal))[0];

        request = newest ? requestOf(newest) : undefined;
      }
    } catch (error) {
      // A read the identity may not make is said, and the backup is read alone (REQ-282).
      if (error instanceof DiagnosticError && error.code === "forbidden" && error.verdict !== "credential")
        unread = true;
      else if (!(error instanceof DiagnosticError && error.code === "not-found")) throw error;
    }
  }
  try {
    const read = await adapter.read("Backup", namespace, backup.name, signal);

    return { request, requestsUnread: unread, backup: read.metadata.uid === backup.uid ? (phaseOf(read) ?? "") : null };
  } catch (error) {
    if (error instanceof DiagnosticError && error.code === "not-found")
      return { request, requestsUnread: unread, backup: null };
    throw error;
  }
}

// What the request and the backup show together (REQ-282): gone with the backup, a deletion Velero completed, since it
// deletes its requests when nothing failed; gone with the backup there, a request that another one of the same backup,
// which Velero started after it, replaced; Processed with the one error of a refusal, which Velero writes before it
// changes anything of the backup, a deletion it refused, the backup in the phase it had, Deleting included for a backup
// whose deletion failed before; Processed with other errors, a deletion that failed on the way, the backup Deleting;
// InProgress, a deletion Velero is at; no phase, a request Velero has not read. A request Processed with no error is one
// whose backup Velero deleted, and is said so only once the read shows the backup gone. With the requests not read, the
// backup alone says: gone, deleted; Deleting, a deletion Velero is at, or one that failed; else, one Velero has not
// started, or refused.
function endShown(shown: Shown): DeletionEnd {
  const gone = shown.backup === null;

  if (shown.requestsUnread) return gone ? "completed" : shown.backup === "Deleting" ? "in-progress" : "unread";
  if (!shown.request) return gone ? "completed" : "replaced";
  if (shown.request.phase === "Processed") {
    const errors = shown.request.errors;

    if (Array.isArray(errors) && errors.length > 0)
      return errors.length === 1 && typeof errors[0] === "string" && errors[0].startsWith(REFUSAL)
        ? "refused"
        : "failed";
    return gone ? "completed" : "in-progress";
  }
  return shown.request.phase === "InProgress" ? "in-progress" : "unread";
}

// The ends the reads stop at: what comes after them is not of this request.
const FINAL: readonly DeletionEnd[] = ["completed", "replaced", "refused", "failed"];

function deletedOf(shown: Shown, end: DeletionEnd, named: string | undefined): BackupDeleted {
  const request = shown.request?.name ?? named;

  return {
    end,
    ...(request ? { request } : {}),
    ...(shown.backup ? { phase: shown.backup } : {}),
    ...(shown.request && (end === "refused" || end === "failed") ? carriedErrors(shown.request.errors) : {}),
    ...(shown.requestsUnread ? { requestsUnread: true } : {}),
  };
}

// The reads after the creation (REQ-282): the request by its name and its UID, or by the labels of its backup after an
// answer that was lost, and the backup with it, every second until the end of the thirty seconds, a read that hangs
// included, until what they show is an end. A read that fails ends the reads with what the last one showed.
async function readAfter(
  dependencies: CreationDependencies,
  adapter: DiagnosticKubernetes,
  namespace: string,
  backup: { name: string; uid: string },
  start: { named?: { name: string; uid: string }; shown: BackupDeleted; requestsUnread: boolean },
  confirmedAt: number,
  until: number,
  signal: AbortSignal,
  write: Write,
): Promise<BackupDeleted> {
  let last = start.shown;
  let unread = start.requestsUnread;

  write.status = { step: "waiting for Velero" };
  while (!FINAL.includes(last.end) && !signal.aborted && until - dependencies.now() >= READ_AFTER.everyMs) {
    try {
      await dependencies.sleep(READ_AFTER.everyMs, signal);
    } catch {
      break;
    }
    let shown: Shown;

    try {
      // A read that does not answer ends with the thirty seconds.
      const bounded = AbortSignal.any([signal, AbortSignal.timeout(Math.max(until - dependencies.now(), 1))]);

      shown = await show(adapter, namespace, backup, start.named, confirmedAt, unread, bounded);
    } catch {
      break;
    }
    unread = shown.requestsUnread;
    last = deletedOf(shown, endShown(shown), start.named?.name);
  }
  return last;
}

// The run: the name of the backup typed as it is written, the token of the confirmation, the backup read again, the
// frame that asked still there, the text sent byte for byte, and the reads after the creation. The caller watches the
// frame and ends the write.
export async function runBackupDelete(
  dependencies: CreationDependencies,
  sender: string,
  request: WriteRunRequest,
  watch: (write: Write) => () => void,
  still: () => boolean = () => true,
): Promise<Answer<BackupDeleted>> {
  const { target } = request;

  if (request.kind !== "delete-backup" || target?.kind !== "Backup" || request.typed === undefined)
    return failure("validation", "request", false, BACKUP_DELETE_WORDS.notADeletion);
  // The second gesture is looked at before the token is taken: another name typed leaves the review as it is (REQ-281).
  if (request.typed !== target.name)
    return failure("validation", "request", false, BACKUP_DELETE_WORDS.typed(target.name));
  const taken = dependencies.gate.take(
    sender,
    request.cluster,
    request.namespace,
    request.kind,
    target,
    request.token,
    request.request,
    undefined,
    target.name,
  );

  if (!taken.ok) return taken;
  const { adapter, write, text, confirmedAt } = taken.value;
  const stop = watch(write);
  const signal = write.controller.signal;
  const backup = { name: target.name, uid: target.uid };
  // Every end of a request that was sent is kept for the cluster, and is answered to the frame that asked when it is
  // still there.
  const ended = (end: Answer<BackupDeleted>): Answer<BackupDeleted> => {
    try {
      dependencies.keep?.(request, end, adapter.binding?.contextName ?? "");
    } catch {
      /* the end is answered all the same */
    }
    return still() ? end : failure("forbidden", "frame", false, BACKUP_DELETE_WORDS.frameGoneAfter);
  };

  try {
    const kept = text === undefined ? undefined : readDeleteRequest(text);

    // The text kept with the token is the request of this backup, by its name and its UID, in this namespace, or
    // nothing is sent.
    if (
      !text ||
      !kept ||
      kept.namespace !== request.namespace ||
      kept.backup.name !== target.name ||
      kept.backup.uid !== target.uid
    )
      return failure("conflict", "review", false, BACKUP_DELETE_WORDS.reviewChanged);
    write.status = { step: "reading the backup" };
    const checked = await readBackup(adapter, request.namespace, target, signal);

    if (!checked.ok) return checked;
    // A frame that went, or a write stopped, before anything was sent leaves nothing to look for.
    if (signal.aborted) return failure("cancelled", "creation", true, BACKUP_DELETE_WORDS.cancelled);
    if (!still()) return failure("forbidden", "frame", false, BACKUP_DELETE_WORDS.frameGone);
    write.status = { step: "creating the request" };
    let created: DiagnosticObject;

    try {
      created = await adapter.createDeleteBackupRequest(request.namespace, text, signal);
    } catch (error) {
      // No answer, or one dropped on this side once the request had left: the requests of the backup are read by its
      // labels, with reads of their own, which the frame that went does not stop; nothing is sent again.
      if (error instanceof DiagnosticError && (error.code === "submission-unknown" || error.code === "cancelled")) {
        write.status = { step: "looking for the request" };
        // The look and the reads after it share the thirty seconds of the reads after a creation.
        const until = dependencies.now() + READ_AFTER.forMs;
        let shown: Shown;

        try {
          shown = await show(
            adapter,
            request.namespace,
            backup,
            undefined,
            confirmedAt,
            false,
            AbortSignal.timeout(Math.max(Math.min(LOOK_AFTER.forMs, until - dependencies.now()), 1)),
          );
        } catch {
          return ended(failure("submission-unknown", "creation", false, BACKUP_DELETE_WORDS.unknown(target.name)));
        }
        // Requests that cannot be read leave the creation not known while the backup is there; no request of the
        // backup since the confirmation, with the backup there, is no deletion asked, as far as the read shows.
        if (shown.requestsUnread && shown.backup !== null)
          return ended(failure("submission-unknown", "creation", false, BACKUP_DELETE_WORDS.unknown(target.name)));
        if (!shown.request && shown.backup !== null)
          return ended(failure("submission-unknown", "creation", false, BACKUP_DELETE_WORDS.notDone(target.name)));
        const found = await readAfter(
          dependencies,
          adapter,
          request.namespace,
          backup,
          { shown: deletedOf(shown, endShown(shown), undefined), requestsUnread: shown.requestsUnread },
          confirmedAt,
          until,
          new AbortController().signal,
          write,
        );

        return ended({ ok: true, value: { ...found, found: true } });
      }
      const end = endOf(error, "creation", request.namespace, target.name);

      return sent(error) ? ended(end) : end;
    }
    const labels = created.metadata.labels ?? {};

    // An answer that is not the request of this backup, in this namespace, is not taken.
    if (
      created.kind !== "DeleteBackupRequest" ||
      !created.metadata.name ||
      !created.metadata.uid ||
      created.metadata.namespace !== request.namespace ||
      created.spec?.backupName !== target.name ||
      labels[BACKUP_UID_LABEL] !== target.uid
    )
      return ended(failure("submission-unknown", "creation", false, BACKUP_DELETE_WORDS.strange(target.name)));
    const named = { name: created.metadata.name, uid: created.metadata.uid };

    return ended({
      ok: true,
      value: await readAfter(
        dependencies,
        adapter,
        request.namespace,
        backup,
        // The request as it was created: Velero has not read it yet.
        { named, shown: { end: "unread", request: named.name }, requestsUnread: false },
        confirmedAt,
        dependencies.now() + READ_AFTER.forMs,
        signal,
        write,
      ),
    });
  } finally {
    stop();
    dependencies.gate.finish(request.cluster, request.request);
  }
}
