import type { OperationState } from "./phases";

export type DurationGap =
  // The work of the operation did not begin: it has no start time to report.
  | "not-started"
  // The phase does not say that the work did not begin, and the object reports no start.
  | "no-start"
  | "no-end"
  | "invalid-start"
  | "invalid-end"
  | "future-start"
  | "reversed";

export type OperationDuration =
  // Still counting: the value is the one at `now`.
  | { state: "running"; milliseconds: number; start: number }
  | { state: "finished"; milliseconds: number; start: number; end: number }
  | { state: "unavailable"; reason: DurationGap };

// A timestamp of the API, or nothing: a text that is not one does not become a time.
export function timestamp(value: unknown): number | undefined {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/.test(value)) {
    return undefined;
  }
  const time = Date.parse(value);

  return Number.isNaN(time) ? undefined : time;
}

function missing(value: unknown): boolean {
  return value === undefined || value === null || value === "";
}

// The clock of the caller is an argument: a test sets it, and the views share one reading of it.
export function operationDuration(
  state: OperationState,
  status: { startTimestamp?: unknown; completionTimestamp?: unknown } | null | undefined,
  now: number,
): OperationDuration {
  const start = timestamp(status?.startTimestamp);
  const end = timestamp(status?.completionTimestamp);

  if (start === undefined) {
    if (!missing(status?.startTimestamp)) return { state: "unavailable", reason: "invalid-start" };
    return { state: "unavailable", reason: state.execution === "not-started" ? "not-started" : "no-start" };
  }
  if (!missing(status?.completionTimestamp) && end === undefined)
    return { state: "unavailable", reason: "invalid-end" };
  if (end !== undefined) {
    return end < start
      ? { state: "unavailable", reason: "reversed" }
      : { state: "finished", milliseconds: end - start, start, end };
  }
  // Without an end only an operation in flight has a duration, and it is the one so far. One that is
  // finished, being deleted or of an unknown phase does not get a timer that would run forever.
  if (state.lifecycle !== "in-flight") return { state: "unavailable", reason: "no-end" };
  if (start > now) return { state: "unavailable", reason: "future-start" };
  return { state: "running", milliseconds: now - start, start };
}

export function formatDuration(milliseconds: number): string {
  const seconds = Math.floor(milliseconds / 1000);
  const parts: [number, string][] = [
    [Math.floor(seconds / 86_400), "d"],
    [Math.floor((seconds % 86_400) / 3600), "h"],
    [Math.floor((seconds % 3600) / 60), "m"],
    [seconds % 60, "s"],
  ];
  const first = parts.findIndex(([value]) => value > 0);

  if (first === -1) return "0s";
  // Two units at most: the seconds of an operation of days are noise.
  return parts
    .slice(first, first + 2)
    .filter(([value]) => value > 0)
    .map(([value, unit]) => `${value}${unit}`)
    .join(" ");
}
