// What the target bar says of the end of a write that no view showed (SPEC-0017, REQ-250): what to look for, where,
// and how it ended, in the words of the main process for a failure.

import type { KeptEnd } from "./ipc";

export function keptEndWords(end: KeptEnd): string {
  const what = `The backup ${end.name}, asked from the schedule ${end.schedule} in ${end.namespace} (context ${end.context}),`;

  if (!end.outcome.created) return `${what} ended while no view of it was open: ${end.outcome.text}`;
  const found = end.outcome.found ? ", found by its name after the answer of its creation was lost" : "";
  const phase = end.outcome.phase ? `Velero wrote its phase: ${end.outcome.phase}.` : "Velero had not read it yet.";

  return `${what} was created while no view of it was open${found}. ${phase}`;
}
