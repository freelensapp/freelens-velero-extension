// What the target bar says of the end of a write that no view showed (SPEC-0017, REQ-250): what to look for, where,
// and how it ended, in the words of the main process for a failure.

import type { DeletionEnd, KeptEnd } from "./ipc";

// What the last reads of a deletion showed, of the request and the backup together (SPEC-0017, REQ-282). It never
// says that the backup was deleted before the read shows it gone.
const DELETION_WORDS: Record<DeletionEnd, string> = {
  completed: "the backup is not there any more: Velero deleted it, with the request.",
  replaced:
    "the request is not there any more, and the backup is: another request for the same backup, which Velero started after this one, replaced it.",
  refused: "Velero refused the request, and deleted nothing.",
  failed: "a step of the deletion failed: the backup stays Deleting, and a new request tries again.",
  unread: "Velero had not started the deletion when it was last read.",
  "in-progress": "Velero was at the deletion when it was last read: the view of the backup says how it goes.",
};

// What the backup alone showed, when the identity may not read the requests to delete a backup (REQ-282).
const UNREAD_WORDS: Record<"completed" | "in-progress" | "unread", string> = {
  completed: "the backup is not there any more: Velero deleted it. The requests of the backup could not be read.",
  "in-progress":
    "the backup was Deleting when it was last read: Velero is deleting it, or a deletion of it failed. The requests of the backup could not be read.",
  unread:
    "the backup kept its phase when it was last read: Velero has not started the deletion, or refused it. The requests of the backup could not be read.",
};

export function keptEndWords(end: KeptEnd): string {
  if (end.kind === "delete-backup") {
    const what = `The deletion of the backup ${end.name}, in ${end.namespace} (context ${end.context}),`;

    if (!end.outcome.created) return `${what} ended while no view of it was open: ${end.outcome.text}`;
    const deletion = end.outcome.deletion ?? "unread";
    const unread = end.outcome.requestsUnread === true;
    // After an answer that was lost, what was read is of a request of the backup made since a minute before the
    // confirmation, this one or another, or of the backup alone when the requests could not be read (REQ-250).
    const found = end.outcome.found
      ? unread
        ? ", as the backup shows, read after the answer of its creation was lost"
        : ", as a request of the backup made since a minute before the confirmation shows, this one or another, read after the answer of its creation was lost"
      : "";
    const words =
      unread && (deletion === "completed" || deletion === "in-progress" || deletion === "unread")
        ? UNREAD_WORDS[deletion]
        : DELETION_WORDS[deletion];

    return `${what} was asked while no view of it was open${found}: ${words}`;
  }
  if (end.kind === "schedule-pause" || end.kind === "schedule-resume") {
    const pause = end.kind === "schedule-pause";
    const what = `The ${pause ? "pause" : "resume"} of the schedule ${end.name}, in ${end.namespace} (context ${end.context}),`;

    if (!end.outcome.created) return `${what} ended while no view of it was open: ${end.outcome.text}`;
    const found = end.outcome.found ? ", as the read after the answer of the patch was lost shows" : "";

    return `${what} was applied while no view of it was open${found}: ${pause ? "the schedule is paused, and Velero does not read it until it is resumed." : "the schedule is resumed, and Velero reads it at once."}`;
  }
  const source = end.schedule === undefined ? "asked with the form" : `asked from the schedule ${end.schedule}`;
  const what =
    end.kind === "schedule"
      ? `The schedule ${end.name}, asked with the form in ${end.namespace} (context ${end.context}),`
      : end.kind === "restore"
        ? `The restore ${end.name} of the backup ${end.backup ?? ""}, in ${end.namespace} (context ${end.context}),`
        : `The backup ${end.name}, ${source} in ${end.namespace} (context ${end.context}),`;

  if (!end.outcome.created) return `${what} ended while no view of it was open: ${end.outcome.text}`;
  const found = end.outcome.found ? ", found by its name after the answer of its creation was lost" : "";
  const phase = end.outcome.phase
    ? `Velero wrote its phase: ${end.outcome.phase}.`
    : end.outcome.paused
      ? "It is paused: Velero does not read it until it is resumed."
      : "Velero had written no phase of it when it was last read.";

  return `${what} was created while no view of it was open${found}. ${phase}`;
}
