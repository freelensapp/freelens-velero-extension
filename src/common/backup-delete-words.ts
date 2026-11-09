// The words of the deletion of one backup (SPEC-0017, REQ-278 to REQ-284): whether Delete backup is offered for the
// phase of a backup and what its command says, what the review says beside the text of the request, and what the
// result says of the request and of the backup read together. Pure functions of what was read, which are arguments.

import { IN_PROGRESS } from "./delete-request";

import type { MeaningPart } from "./backup-from-schedule";
import type { BackupDeleted } from "./ipc";

// Whether Delete backup is offered for a backup in this phase, and the words its command says (REQ-278): one Velero
// refuses to delete is not offered; one Deleting is, as a new attempt; one Velero has not started is, and Velero
// deletes it before it starts it when it names its storage location. One that names none Velero refuses to delete
// until it starts it: it writes the location of a backup when it starts it (backup_controller.go L431-L446), and reads
// the location the backup names when it processes a request (backup_deletion_controller.go L188-L198).
export function deleteOffered(
  phase: string | undefined,
  storageLocation?: string,
): { offered: boolean; words?: string } {
  if (phase !== undefined && (IN_PROGRESS as readonly string[]).includes(phase))
    return {
      offered: false,
      words: `The backup is ${phase}: Velero refuses to delete a backup in progress, waiting for its plugins or finalizing, and Delete backup is offered once it ends.`,
    };
  if (phase === "Deleting")
    return {
      offered: true,
      words:
        "The backup is Deleting: Velero is deleting it, or a deletion of it failed and it stays Deleting. A new request tries the deletion again.",
    };
  if (phase === undefined || phase === "New" || phase === "Queued" || phase === "ReadyToStart")
    return {
      offered: true,
      words: storageLocation
        ? `The backup is ${phase ?? "without a phase"}: Velero has not started it, and deletes it before it starts it.`
        : `The backup is ${phase ?? "without a phase"} and names no storage location: Velero writes its location when it starts it, and refuses a request to delete it before then.`,
    };
  return { offered: true };
}

// What the workspace says, by its parts.
export const BACKUP_DELETE_VIEW_WORDS = {
  title: (backup: string) => `Delete the backup ${backup}`,
  what: (backup: string, namespace: string) =>
    `A deletion of the backup ${backup} in ${namespace}: Velero deletes its data, its files in the store and its restores, then the backup itself. The main process reads the backup again when the review is asked, and again when the request is created.`,
  writesOff:
    "Writes are off for this installation: the review asks for writes on, which are turned on in the target bar.",
  another: (backup: string) =>
    `The deletion of the backup ${backup} is being asked: one is asked at a time, and this one can be asked when it ends.`,
  backupMissing: (backup: string, namespace: string) =>
    `The backup ${backup} is not among the backups of ${namespace} the installation read: there is no backup to delete.`,
  backupNotRead: "The backups of this installation are not read yet: the review opens once the backup is read.",
  backupsForbidden:
    "The identity of this cluster may not read the backups of this installation: the backup cannot be read, and no review is asked.",
  backupsFailed:
    "The backups of this installation could not be read: the review opens once they are read again, at the next read of the views.",
  asking: "Asking the main process for the review: it reads the backup again and writes the request it would create.",
  running: (backup: string) =>
    `Creating the request to delete the backup ${backup}, then reading it with the backup every second for thirty seconds at most, until what they show is an end.`,
  review: "This DeleteBackupRequest will be created when you confirm, and not before:",
  meaning: "What it means",
  text: "What is sent, as it is sent",
  typeBackup: (backup: string) =>
    `A deletion cannot be undone: type the name of the backup, ${backup}, to delete it. The name is compared again when the request is created.`,
  typed: "The name is typed as it is written: Delete backup is enabled.",
  notTyped: (backup: string) => `Delete backup is enabled once ${backup} is typed as it is written.`,
  found:
    "The answer of the creation was lost on the way: what is said is what was read after it, the requests of the backup made since a minute before the confirmation, by the labels of the backup, and the backup. A request read is this one or another of the same backup.",
  foundUnread:
    "The answer of the creation was lost on the way, and the requests of the backup could not be read: what came of it is what the backup alone shows.",
  unread:
    "The identity of this cluster may not read the requests to delete a backup: what is said is what the backup alone shows.",
  errorsLeft: (count: number, backup: string) =>
    `Velero wrote ${count} more ${count === 1 ? "error" : "errors"}: \`velero backup describe ${backup}\` lists the attempts to delete it with their errors.`,
  unknownLeft:
    "Look at the view of the backup before asking again: a request may have been created, and Velero may be deleting the backup.",
};

// What the installation read that the review is said with: the phase of the backup, its storage location and what the
// views read of it, and how many other requests to delete a backup of its name the main process found at the
// confirmation, or that it could not read them.
export interface DeleteReviewContext {
  backupPhase?: string;
  storageLocation?: string;
  // The location as the views read it: not there, its access mode and its phase, when they are known.
  location?: { missing: true } | { accessMode?: string; phase?: string };
  others?: number | "unread";
}

// The location of the backup in the words of what Velero refuses (REQ-280), with what the views read of it when it
// would be refused.
function locationWords(context: DeleteReviewContext): string {
  const name = context.storageLocation;
  const refuses = name
    ? `Velero refuses the request when the storage location ${name} of the backup is not there, is ReadOnly or is not Available.`
    : "The backup names no storage location: Velero refuses the request when its location is not there, is ReadOnly or is not Available.";
  const location = context.location;

  if (!name || !location) return refuses;
  if ("missing" in location)
    return `${refuses} The views do not read a location of that name in this installation: Velero would refuse it.`;
  if (location.accessMode === "ReadOnly")
    return `${refuses} The views read it ReadOnly: Velero would refuse it until it is ReadWrite.`;
  // Velero takes a location as Available by its phase alone (util/velero/velero.go L130-L132): one without a phase is
  // refused.
  if (location.phase !== "Available")
    return `${refuses} The views read it ${location.phase ?? "without a phase"}: Velero would refuse it until it is Available.`;
  return refuses;
}

// What the review of a deletion says beside its text (REQ-280, REQ-283, REQ-284): the one request, and what it is not;
// the phase of the backup; what Velero deletes, step by step in the order it does it; what it deletes only when nothing
// failed, and what stays when something did; the location and its refusals, and the other requests of a backup of its
// name, which Velero checks and deletes before the steps; the other installations of the location; and that it cannot
// be undone.
export function deleteMeaning(backup: string, context: DeleteReviewContext = {}): MeaningPart[] {
  const parts: MeaningPart[] = [
    {
      id: "request",
      words: `One DeleteBackupRequest of the backup ${backup}, which Velero processes, and nothing else: no DELETE of the Backup, which would leave its files in the store, from where the sync of the location brings it back.`,
    },
  ];
  const offered = deleteOffered(context.backupPhase, context.storageLocation);

  if (offered.words) parts.push({ id: "phase", words: offered.words });
  parts.push(
    {
      id: "order",
      words:
        "Velero deletes, in this order: what the plugins of the backup delete; its volume snapshots; the snapshots of its pod volume backups; the data it moved, with its uploads; its files in the store; every restore of the backup, with the files of each; and the Backup itself.",
    },
    {
      id: "failure",
      words:
        "The files in the store and the Backup are deleted only when nothing failed before them; the restores are deleted even when a step after the one of the plugins failed. A backup Velero cannot delete stays Deleting, with the errors of the request.",
    },
    { id: "location", words: locationWords(context) },
  );
  // Velero deletes the other requests of a backup by the label of its name (backup_deletion_controller.go L500-L522).
  if (context.others === "unread")
    parts.push({
      id: "others",
      words:
        "Velero deletes every other request to delete a backup of this name before it starts this one: whether there is one could not be read.",
    });
  else if (context.others !== undefined && context.others > 0)
    parts.push({
      id: "others",
      words:
        context.others === 1
          ? "Another request to delete a backup of this name is there: Velero deletes it before it starts this one."
          : `${context.others} other requests to delete a backup of this name are there: Velero deletes them before it starts this one.`,
    });
  parts.push(
    {
      id: "installations",
      words:
        "Every installation that syncs the same storage location deletes, at its next sync, its own Backup object whose files are gone.",
    },
    { id: "undone", words: "This cannot be undone: what Velero deletes is not brought back." },
  );
  return parts;
}

// What the result says of the request and of the backup read together after the creation (REQ-282), first the end,
// then each error as Velero wrote it; it never says the backup deleted before a read showed it gone.
export function deletedWords(backup: string, deleted: BackupDeleted): string[] {
  const phase = deleted.phase ?? "without a phase";
  let end: string;

  if (deleted.requestsUnread)
    end =
      deleted.end === "completed"
        ? `The backup ${backup} is not there any more: Velero deleted it.`
        : deleted.end === "in-progress"
          ? `The backup ${backup} is Deleting: Velero is deleting it, or a deletion of it failed and it stays Deleting.`
          : `The backup ${backup} is still ${phase}: Velero has not started the deletion, or refused it, as far as the backup shows.`;
  else
    switch (deleted.end) {
      case "completed":
        end = `The backup ${backup} is not there any more: Velero deleted it, and the request with it, since nothing failed.`;
        break;
      case "replaced":
        end = `The request is not there any more, and the backup ${backup} is: another request for the same backup, which Velero started after this one, took its place, since Velero deletes the other requests of a backup before it starts. The view of the backup says how it goes.`;
        break;
      case "refused":
        end = deleted.phase
          ? `Velero refused the request, and deleted nothing of the backup: the backup ${backup} keeps its phase, ${deleted.phase}. Each error is as Velero wrote it:`
          : `Velero refused the request, and deleted nothing of the backup. Each error is as Velero wrote it:`;
        break;
      case "failed":
        end = `Velero started the deletion of the backup ${backup}, and a step of it failed: the backup stays Deleting, and a new request tries the deletion again. Each error is as Velero wrote it:`;
        break;
      case "in-progress":
        end = `Velero is deleting the backup ${backup}: when it was last read, the request was InProgress, or Processed with the backup still there. The view of the backup says how it goes.`;
        break;
      default:
        end = `Velero had not started the request when it was last read: it had no phase then. The view of the backup says whether Velero deletes it.`;
    }
  return [
    ...(deleted.requestsUnread ? [BACKUP_DELETE_VIEW_WORDS.unread] : []),
    end,
    ...(deleted.errors ?? []),
    ...(deleted.errorsLeft ? [BACKUP_DELETE_VIEW_WORDS.errorsLeft(deleted.errorsLeft, backup)] : []),
  ];
}
