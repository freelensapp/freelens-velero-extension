import type { OperationKind } from "./phases";

export interface ItemProgress {
  // The two values as the object reports them, whatever they are.
  reported: { done?: unknown; total?: unknown };
  // Present only for counts that can be a ratio: the rest is kept in `reported` and nothing is computed.
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
export function itemProgress(
  kind: OperationKind,
  progress: { itemsBackedUp?: unknown; itemsRestored?: unknown; totalItems?: unknown } | null | undefined,
): ItemProgress {
  const done = kind === "Backup" ? progress?.itemsBackedUp : progress?.itemsRestored;
  const total = progress?.totalItems;
  const reported = { done, total };
  const missing = (value: unknown) => value === undefined || value === null;

  if (missing(done) && missing(total)) return { reported, state: "indeterminate", reason: "not-reported" };
  if (!valid(total) || (!missing(done) && !valid(done))) return { reported, state: "indeterminate", reason: "invalid" };
  if (total === 0) return { reported, state: "indeterminate", reason: "no-total", ...(valid(done) ? { done } : {}) };
  if (!valid(done)) return { reported, total, state: "indeterminate", reason: "not-reported" };
  if (done > total) return { reported, done, total, state: "indeterminate", reason: "over-total" };
  return { reported, done, total, percentage: Math.floor((done / total) * 100), state: "measured" };
}
