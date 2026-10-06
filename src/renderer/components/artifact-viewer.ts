import type { KeyboardEvent } from "react";

import type { OperationKind } from "../../common/phases";

// What the viewer of an artifact is given by the tab that loaded it: the one copy of the text the tab
// holds, the kind of operation it is of, and the name its parts are found by. The results are given as
// well the counters the status of the object writes, and the phase it reports with them, to say when the
// file counts otherwise and why it can.
export interface ArtifactViewerProps {
  id: string;
  text: string;
  of: OperationKind;
  counters?: { errors?: number; warnings?: number };
  phase?: string;
}

// The mark of the part of a viewer that is given the focus when its text arrives: the first line of what
// it shows. Each viewer has one, which can be given the focus and is not in the order of the Tab key. A
// viewer that shows its text in a list of the host has it when the list has drawn its first row, which is
// a moment after the viewer itself: the tab waits for it.
export const CONTENT = "data-artifact-content";

// Escape in a text field of a viewer belongs to the field, as it does in the search field of the host: it
// clears what was typed and goes no further, so that the view is never left from inside a field. It
// answers whether the key was Escape, for a field that has other keys of its own.
export function escapeOfField(event: KeyboardEvent, clear: () => void): boolean {
  if (event.key !== "Escape") return false;
  event.stopPropagation();
  clear();
  return true;
}
