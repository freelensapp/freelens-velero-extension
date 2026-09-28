// The words the views show of an operation, a backup or a restore: one text for a phase, a failure, a
// progress and a duration, wherever they are shown.

import { formatDuration } from "./duration";

import type { OperationDuration } from "./duration";
import type { OperationEvidence } from "./evidence";
import type { OperationState } from "./phases";
import type { ItemProgress } from "./progress";

export const NOT_REPORTED = "Not reported";

// The format of a date and its time in the language and the zone of the operator. It is made once: a
// list asks for the time of every row each time it is searched, and a format is slow to make.
let format: Intl.DateTimeFormat | undefined;

// A time as the views show it, in the language and the zone of the machine of the operator.
export function timeText(value: number | undefined): string {
  if (value === undefined) return NOT_REPORTED;
  format ??= new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
  });
  return format.format(value);
}

// The phase as the operator reads it: the label, and beside it the text of the object when it says more.
export function phaseText(state: OperationState): string {
  if (!state.reported) return state.label;
  return state.recognized ? state.label : `${state.label}: ${state.reported}`;
}

const LIFECYCLES = { "in-flight": "In flight", terminal: "Finished", deleting: "Being deleted", unknown: "Unknown" };

export function lifecycleText(state: OperationState): string {
  return LIFECYCLES[state.lifecycle];
}

// The failure signal in words: a color alone says nothing to who cannot tell it from another.
export function signalText(evidence: OperationEvidence): string {
  const errors = evidence.errors.reported ? evidence.errors.value : undefined;
  const warnings = evidence.warnings.reported ? evidence.warnings.value : undefined;

  switch (evidence.signal) {
    case "failure":
      if (evidence.validationErrors.length) return plural(evidence.validationErrors.length, "validation error");
      return errors ? plural(errors, "error") : "Failure";
    case "warnings":
      return plural(warnings ?? 0, "warning");
    case "unknown":
      return "Unknown";
    default:
      return errors === undefined ? "No failure reported" : "No errors";
  }
}

// How the failure signal is marked. That nothing went wrong is marked only for an operation that counted
// its errors and found none: one that reports no count, as one that did not start, says that no failure is
// reported, and what is not reported is not marked as what went well.
export type SignalMark = "failure" | "warnings" | "none" | "unknown" | "not-counted";

export function signalMark(evidence: OperationEvidence): SignalMark {
  return evidence.signal === "none" && !evidence.errors.reported ? "not-counted" : evidence.signal;
}

export function countsText(evidence: OperationEvidence): string {
  const errors = evidence.errors.reported ? String(evidence.errors.value) : NOT_REPORTED;
  const warnings = evidence.warnings.reported ? String(evidence.warnings.value) : NOT_REPORTED;

  return `${errors} / ${warnings}`;
}

// What is to be said of the counters beside their values: whose zero a zero is, and why a counter is not
// there yet. Nothing when the counters are written.
export function countsNote(evidence: OperationEvidence, state: OperationState): string | undefined {
  const omitted = [evidence.errors, evidence.warnings].some((value) => value.reported && !value.written);
  const missing = [evidence.errors, evidence.warnings].some((value) => !value.reported && value.raw === undefined);

  if (omitted) {
    return "Velero writes no counter when it counts none: a zero here is a counter that is not in the object.";
  }
  if (!missing) return undefined;
  if (state.execution === "not-started") return "Nothing was counted: the operation did not start.";
  if (state.execution === "running") return "Velero counts when the work of the operation ends.";
  if (state.failure === "failed") {
    return "Velero can fail an operation before it counts: a counter that is not in the object is not a count of none.";
  }
  return undefined;
}

// The counters in a sentence: what is counted, and what is not reported as such.
export function countsSentence(evidence: OperationEvidence): string {
  const errors = evidence.errors.reported ? plural(evidence.errors.value, "error") : "no number of errors";
  const warnings = evidence.warnings.reported ? plural(evidence.warnings.value, "warning") : "no number of warnings";

  return `${errors} and ${warnings}`;
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

// A value of the object that is not a count, as it can be read beside a text.
function carried(value: unknown): string {
  if (value === undefined || value === null) return "nothing";
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}

export function progressText(progress: ItemProgress): string {
  if (progress.state === "measured") return `${progress.done} / ${progress.total} (${progress.percentage}%)`;
  switch (progress.reason) {
    case "not-reported":
      return NOT_REPORTED;
    case "no-total":
      return "No items counted";
    case "over-total":
      return `Reported ${progress.done} / ${progress.total}`;
    default:
      // What was reported stays readable, without a ratio that it cannot give.
      return `Reported ${carried(progress.reported.done)} / ${carried(progress.reported.total)}`;
  }
}

const GAPS = {
  "not-started": "Not started",
  "no-start": "Start not reported",
  "no-end": "End not reported",
  "invalid-start": "Start not readable",
  "invalid-end": "End not readable",
  "future-start": "Start in the future",
  reversed: "End before start",
};

export function durationText(duration: OperationDuration): string {
  if (duration.state === "unavailable") return GAPS[duration.reason];
  return duration.state === "running"
    ? `${formatDuration(duration.milliseconds)} so far`
    : formatDuration(duration.milliseconds);
}
