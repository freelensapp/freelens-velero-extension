// The times of an operation of the volumes as the release writes them, and what is said of how long it took or
// has been taking, by a clock that is an argument: a test sets it, and the views share one reading of it.

import { timestamp } from "./duration";

import type { VolumeOperationState } from "./volume-phases";

export type VolumeSpan =
  // Accepted or Prepared: how long it has waited since a node agent accepted it.
  | { state: "waiting"; milliseconds: number; since: number }
  // InProgress or Canceling: how long its data path has been at work.
  | { state: "elapsed"; milliseconds: number; since: number }
  // Ended, from its start to its completion.
  | { state: "duration"; milliseconds: number }
  // Ended with a start equal to its completion: the time the failure or the cancellation wrote, which is not a
  // duration of the work.
  | { state: "instant"; at: number }
  // Ended with a completion and no start: it ended before its data path began.
  | { state: "no-start"; at: number }
  // Ended with no time at all, as one the preparing timeout failed.
  | { state: "no-time" }
  // New, or with no phase: it has no time but its creation.
  | { state: "not-started" }
  // A time the phase asks for is not in the object, or the times cannot be read together.
  | { state: "unavailable"; reason: "no-accepted" | "no-start" | "no-end" | "unreadable" | "reversed" | "future" };

export interface VolumeTimes {
  accepted?: number;
  started?: number;
  completed?: number;
  span: VolumeSpan;
}

interface TimedStatus {
  acceptedTimestamp?: unknown;
  startTimestamp?: unknown;
  completionTimestamp?: unknown;
}

function written(value: unknown): boolean {
  return value !== undefined && value !== null && value !== "";
}

function span(state: VolumeOperationState, status: TimedStatus | null | undefined, now: number): VolumeSpan {
  const accepted = timestamp(status?.acceptedTimestamp);
  const started = timestamp(status?.startTimestamp);
  const completed = timestamp(status?.completionTimestamp);
  const unreadable = [
    [status?.acceptedTimestamp, accepted],
    [status?.startTimestamp, started],
    [status?.completionTimestamp, completed],
  ].some(([value, time]) => written(value) && time === undefined);

  if (unreadable) return { state: "unavailable", reason: "unreadable" };
  if (state.lifecycle === "terminal") {
    if (completed === undefined) {
      return started === undefined ? { state: "no-time" } : { state: "unavailable", reason: "no-end" };
    }
    if (started === undefined) return { state: "no-start", at: completed };
    if (completed < started) return { state: "unavailable", reason: "reversed" };
    return completed === started
      ? { state: "instant", at: completed }
      : { state: "duration", milliseconds: completed - started };
  }
  if (state.lifecycle === "unknown") {
    // A phase the release does not write says nothing of the times: a duration is given only when both ends are.
    if (started !== undefined && completed !== undefined && completed >= started) {
      return { state: "duration", milliseconds: completed - started };
    }
    return { state: "unavailable", reason: "no-start" };
  }
  if (state.execution === "running") {
    if (started === undefined) return { state: "unavailable", reason: "no-start" };
    if (started > now) return { state: "unavailable", reason: "future" };
    return { state: "elapsed", milliseconds: now - started, since: started };
  }
  // In flight and not started: waiting for a node agent, or from the moment one accepted it.
  if (state.reported === "Accepted" || state.reported === "Prepared") {
    if (accepted === undefined) return { state: "unavailable", reason: "no-accepted" };
    if (accepted > now) return { state: "unavailable", reason: "future" };
    return { state: "waiting", milliseconds: now - accepted, since: accepted };
  }
  return { state: "not-started" };
}

export function volumeTimes(
  state: VolumeOperationState,
  status: TimedStatus | null | undefined,
  now: number,
): VolumeTimes {
  const accepted = timestamp(status?.acceptedTimestamp);
  const started = timestamp(status?.startTimestamp);
  const completed = timestamp(status?.completionTimestamp);

  return {
    ...(accepted === undefined ? {} : { accepted }),
    ...(started === undefined ? {} : { started }),
    ...(completed === undefined ? {} : { completed }),
    span: span(state, status, now),
  };
}

// The value a list orders the column of the duration by: the milliseconds of what has one, and below every one of
// them what has none.
export function spanValue(value: VolumeSpan): number {
  return value.state === "waiting" || value.state === "elapsed" || value.state === "duration" ? value.milliseconds : -1;
}
