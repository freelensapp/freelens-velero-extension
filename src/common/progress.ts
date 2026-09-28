import type { OperationKind } from "./phases";

export interface ItemProgress {
  // The two values as the object carries them, whatever they are: one that is missing is missing here.
  reported: { done?: unknown; total?: unknown };
  // The counts as they are read, present only when both can be: in a progress that is there, one that is
  // missing is the zero the release does not write.
  done?: number;
  total?: number;
  percentage?: number;
  state: "measured" | "indeterminate";
  reason?: "not-reported" | "no-total" | "invalid" | "over-total";
}

function valid(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

// The ratio of the items, and nothing about the operation: all the items done is not a finished backup.
// The release writes no count of zero: in a progress that is there, a count that is missing is its zero.
// A progress that is not there reports nothing.
export function itemProgress(
  kind: OperationKind,
  progress: { itemsBackedUp?: unknown; itemsRestored?: unknown; totalItems?: unknown } | null | undefined,
): ItemProgress {
  const reported = {
    done: kind === "Backup" ? progress?.itemsBackedUp : progress?.itemsRestored,
    total: progress?.totalItems,
  };
  const missing = (value: unknown) => value === undefined || value === null;

  if (progress === undefined || progress === null || typeof progress !== "object") {
    return { reported, state: "indeterminate", reason: "not-reported" };
  }
  const done = missing(reported.done) ? 0 : reported.done;
  const total = missing(reported.total) ? 0 : reported.total;

  if (!valid(total) || !valid(done)) return { reported, state: "indeterminate", reason: "invalid" };
  if (done > total) return { reported, done, total, state: "indeterminate", reason: "over-total" };
  if (total === 0) return { reported, done, total, state: "indeterminate", reason: "no-total" };
  return { reported, done, total, percentage: Math.floor((done / total) * 100), state: "measured" };
}
