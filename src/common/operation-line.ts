import type { OperationEvidence } from "./evidence";
import type { OperationTime } from "./operation-time";
import type { OperationState } from "./phases";

// What is drawn on a line of time: an operation with its time, which is its start, or its creation when it
// did not start.
export interface Drawn {
  view: { name: string; state: OperationState; evidence: OperationEvidence };
  time: OperationTime;
}

// One mark of the line: an operation, or the operations that would be drawn over each other.
export interface LineMark<Item extends Drawn> {
  // Where the mark is between the two ends of the line, from 0 to 1.
  at: number;
  // From the newest.
  items: Item[];
  // One of them carries a failure.
  failing: boolean;
  inFlight: boolean;
  // One of them did not start: it is at the time it was created.
  notStarted: boolean;
}

export interface Line<Item extends Drawn> {
  // The two ends of the line.
  from: number;
  to: number;
  // From the oldest, as they are read along the line.
  marks: LineMark<Item>[];
  // The operations that have no time: they are in the list, and not on the line.
  undrawn: Item[];
}

// How far from each other two marks are drawn at least, in the units of the width: the width of a mark, and
// what tells it from the one beside it.
export const MARK_GAP = 28;

// How many operations a mark holds, in the room of a mark, which is three characters: the number, or its
// thousands from a thousand on. A mark is as wide as the gap lets it be, whatever it holds: one that grew
// with its number would be drawn over the one beside it. How many they are exactly is in its words.
export function markCount(count: number): string {
  if (count < 1000) return String(Math.max(0, Math.floor(count)));
  return `${Math.min(99, Math.floor(count / 1000))}k`;
}

// How many of its operations a mark names, in its words and in what the suites read of it: the newest.
export const MARK_NAMED = 5;
export const MARK_LISTED = 20;

// What a mark says to who points at it, or reaches it with the keyboard. One of many says how many they
// are, whether one of them failed, the newest of them and how many more there are: a mark of hundreds
// that named each one would say more than anyone reads.
export function markWords<Item extends Drawn>(mark: LineMark<Item>, noun: string, say: (item: Item) => string): string {
  if (mark.items.length === 1) return say(mark.items[0]);
  const others = mark.items.length - MARK_NAMED;

  return [
    `${mark.items.length} ${noun}s close to each other`,
    mark.failing ? "one of them at least with a failure" : "",
    ...mark.items.slice(0, MARK_NAMED).map(say),
    others > 0 ? `and ${others} more` : "",
  ]
    .filter(Boolean)
    .join(". ");
}

// What is said of a mark that was chosen, over the list of what it holds. The number is of the ones that
// are shown now: since the mark was chosen one of them may be gone, or be older than what the list goes
// back to, which is said where the list goes back to a time.
export function shownWords(count: number, noun: string, among = "the ones that exist now"): string {
  if (count < 1) return `No ${noun} of the mark that was chosen is among ${among}.`;
  if (count === 1) return `One ${noun} of one mark is shown.`;
  return `The ${count} ${noun}s of one mark are shown.`;
}

export interface LineOptions {
  gap?: number;
  // Where the line begins. Without it the line begins at the oldest operation.
  from?: number;
  // Where the line ends at least, beside now: the newest operation of another row of the same line.
  to?: number;
}

// Where each operation is on a line of time of a given width, in the units the width is given in. Two
// marks closer than the gap would be drawn over each other: they are one mark, which says how many they
// are. Nothing is made for the time between two operations: not a missed run, not an expected one. The
// line ends now, or at the newest operation when the clock of the cluster is ahead of the one that draws
// the line. An operation before the beginning of the line is not of the line.
export function operationLine<Item extends Drawn>(
  items: Item[],
  now: number,
  width: number,
  options: LineOptions = {},
): Line<Item> | undefined {
  const gap = options.gap ?? MARK_GAP;
  const timed = items
    .filter((item): item is Item & { time: { time: number } } => item.time.of !== "none")
    .filter((item) => options.from === undefined || item.time.time >= options.from)
    // Inside a mark the operations are from the newest, and the ones of the same time by their names.
    .sort(
      (one, other) =>
        one.time.time - other.time.time ||
        (one.view.name < other.view.name ? 1 : one.view.name > other.view.name ? -1 : 0),
    );
  const undrawn = items.filter((item) => item.time.of === "none");

  // A line that has a beginning is drawn with nothing on it; one that has none begins at an operation.
  if (!timed.length && options.from === undefined) return undefined;
  const from = options.from ?? timed[0].time.time;
  const to = Math.max(now, options.to ?? now, timed.length ? timed[timed.length - 1].time.time : now);
  const span = Math.max(to - from, 1);
  const room = Math.max(width, 1);
  const marks: LineMark<Item>[] = [];
  let first = 0;

  for (const item of timed) {
    const at = (item.time.time - from) / span;
    const last = marks[marks.length - 1];
    const failing = item.view.evidence.signal === "failure";
    const inFlight = item.view.state.lifecycle === "in-flight";
    const notStarted = item.time.of === "creation" && item.view.state.execution === "not-started";

    // The distance is from the first operation of the mark: a mark does not grow along the line.
    if (last && (at - first) * room < gap) {
      last.items.unshift(item);
      last.failing ||= failing;
      last.inFlight ||= inFlight;
      last.notStarted ||= notStarted;
    } else {
      first = at;
      marks.push({ at, items: [item], failing, inFlight, notStarted });
    }
  }
  return { from, to, marks, undrawn };
}
