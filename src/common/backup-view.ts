import { formatDuration, operationDuration, timestamp } from "./duration";
import { operationEvidence } from "./evidence";
import { operationState } from "./phases";
import { itemProgress } from "./progress";

import type { OperationDuration } from "./duration";
import type { OperationEvidence } from "./evidence";
import type { OperationState } from "./phases";
import type { ItemProgress } from "./progress";
import type { BackupResource } from "./types";

// What the list and the workspace show of a backup. Both read it from here, and so does the section of
// the details of the host: one interpretation of the status, wherever the backup is shown.
export interface BackupView {
  name: string;
  namespace: string;
  uid?: string;
  state: OperationState;
  evidence: OperationEvidence;
  progress: ItemProgress;
  duration: OperationDuration;
  started?: number;
  completed?: number;
  expires?: number;
  created?: number;
  storage?: string;
  schedule?: string;
}

export const NOT_REPORTED = "Not reported";

export function backupView(backup: BackupResource, now: number): BackupView {
  const state = operationState("Backup", backup.status?.phase);
  const storage = backup.spec?.storageLocation;
  const schedule = backup.metadata.labels?.["velero.io/schedule-name"];

  return {
    name: backup.metadata.name,
    namespace: backup.metadata.namespace ?? "",
    uid: backup.metadata.uid,
    state,
    evidence: operationEvidence(state, backup.status),
    progress: itemProgress("Backup", backup.status?.progress),
    duration: operationDuration(state, backup.status, now),
    started: timestamp(backup.status?.startTimestamp),
    completed: timestamp(backup.status?.completionTimestamp),
    expires: timestamp(backup.status?.expiration),
    created: timestamp(backup.metadata.creationTimestamp),
    storage: typeof storage === "string" && storage ? storage : undefined,
    schedule: typeof schedule === "string" && schedule ? schedule : undefined,
  };
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

export function countsText(evidence: OperationEvidence): string {
  const errors = evidence.errors.reported ? String(evidence.errors.value) : NOT_REPORTED;
  const warnings = evidence.warnings.reported ? String(evidence.warnings.value) : NOT_REPORTED;

  return `${errors} / ${warnings}`;
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

export function progressText(progress: ItemProgress): string {
  if (progress.state === "measured") return `${progress.done} / ${progress.total} (${progress.percentage}%)`;
  switch (progress.reason) {
    case "not-reported":
      return progress.total === undefined ? NOT_REPORTED : `Not reported / ${progress.total}`;
    case "no-total":
      return "No items counted";
    default:
      // What was reported stays readable, without a ratio that it cannot give.
      return `Reported ${String(progress.reported.done)} / ${String(progress.reported.total)}`;
  }
}

const GAPS = {
  "no-start": "Not started",
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

// What the search of the list looks into: what the columns show, and the words of the status.
export function searchFields(view: BackupView): string[] {
  return [
    view.name,
    view.state.reported ?? "",
    view.state.label,
    lifecycleText(view.state),
    signalText(view.evidence),
    view.storage ?? "",
    view.schedule ?? "",
    ...view.evidence.validationErrors,
  ].filter(Boolean);
}

// An order for each column that has one. What is not reported goes after what is, whichever way is sorted.
export const SORTING = {
  name: (view: BackupView) => view.name,
  namespace: (view: BackupView) => view.namespace,
  phase: (view: BackupView) => phaseText(view.state),
  errors: (view: BackupView) => (view.evidence.errors.reported ? view.evidence.errors.value : -1),
  progress: (view: BackupView) => view.progress.percentage ?? -1,
  started: (view: BackupView) => view.started ?? 0,
  duration: (view: BackupView) => (view.duration.state === "unavailable" ? -1 : view.duration.milliseconds),
  storage: (view: BackupView) => view.storage ?? "",
  age: (view: BackupView) => -(view.created ?? 0),
};
