import { timestamp } from "./duration";

import type { Execution } from "./phases";
import type { ObjectMetadata } from "./types";

// The time of an operation: when it started, or when it was created when it did not. The reviewed release
// writes the start time when the validation of an operation passes and the operation begins: one that waits,
// or that failed its validation, has none. Ordered by their start alone, the backups that fail their
// validation would be after every backup that started, however old: the newest backup of a schedule would
// be an old one that completed.
export type OperationTime =
  | { of: "start"; time: number }
  | { of: "creation"; time: number }
  // The object reports neither.
  | { of: "none" };

interface Timed {
  metadata: Pick<ObjectMetadata, "name" | "creationTimestamp">;
  status?: { startTimestamp?: unknown } | null;
}

export function operationTime(operation: Timed): OperationTime {
  const start = timestamp(operation.status?.startTimestamp);

  if (start !== undefined) return { of: "start", time: start };
  const created = timestamp(operation.metadata.creationTimestamp);

  return created === undefined ? { of: "none" } : { of: "creation", time: created };
}

// From the newest. Equal times go by name, and what has no time goes after what has one.
export function newestFirst(one: Timed, other: Timed): number {
  const first = operationTime(one);
  const second = operationTime(other);

  if (first.of === "none" || second.of === "none") {
    if (first.of !== second.of) return first.of === "none" ? 1 : -1;
  } else if (first.time !== second.time) {
    return second.time - first.time;
  }
  return one.metadata.name.localeCompare(other.metadata.name);
}

// Which of the two times is shown, in words: a time of creation is not shown as a start. That the
// operation did not start is what its phase says: an object without a start whose phase says that the
// work began, or says nothing, reports no start.
export function operationTimeText(time: OperationTime, execution?: Execution): string {
  if (time.of === "start") return "Started";
  if (time.of === "none") return "Not reported";
  return execution === "not-started" ? "Created, did not start" : "Created, start not reported";
}
