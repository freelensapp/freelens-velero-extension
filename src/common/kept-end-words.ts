// What the target bar says of the end of a write that no view showed (SPEC-0017, REQ-250): what to look for, where,
// and how it ended, in the words of the main process for a failure.

import type { KeptEnd } from "./ipc";

export function keptEndWords(end: KeptEnd): string {
  if (end.kind === "schedule-pause" || end.kind === "schedule-resume") {
    const pause = end.kind === "schedule-pause";
    const what = `The ${pause ? "pause" : "resume"} of the schedule ${end.name}, in ${end.namespace} (context ${end.context}),`;

    if (!end.outcome.created) return `${what} ended while no view of it was open: ${end.outcome.text}`;
    return `${what} was applied while no view of it was open: ${pause ? "the schedule is paused, and Velero does not read it until it is resumed." : "the schedule is resumed, and Velero reads it at once."}`;
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
