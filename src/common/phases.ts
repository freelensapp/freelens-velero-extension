// The phases of Velero v1.18.2 on two axes: where the operation is, and what it says of a failure.
// One badge for both would show a backup that is still finalizing with errors as finished, or as healthy.

export const BACKUP_PHASES = [
  "New",
  "Queued",
  "ReadyToStart",
  "FailedValidation",
  "InProgress",
  "WaitingForPluginOperations",
  "WaitingForPluginOperationsPartiallyFailed",
  "Finalizing",
  "FinalizingPartiallyFailed",
  "Completed",
  "PartiallyFailed",
  "Failed",
  "Deleting",
] as const;

export const RESTORE_PHASES = [
  "New",
  "FailedValidation",
  "InProgress",
  "WaitingForPluginOperations",
  "WaitingForPluginOperationsPartiallyFailed",
  "Finalizing",
  "FinalizingPartiallyFailed",
  "Completed",
  "PartiallyFailed",
  "Failed",
] as const;

export type OperationKind = "Backup" | "Restore";
export type Lifecycle = "in-flight" | "terminal" | "deleting" | "unknown";
// Where the work of the operation is. The release writes the start time when the work begins: an object
// without one is read by where its phase says the work is.
export type Execution =
  // The work did not begin: the operation waits, or failed its validation.
  | "not-started"
  | "running"
  // The work ended, or was ended: a failed operation may be one the release stopped before its end.
  | "ran"
  | "unknown";
// What the phase alone says. The counters and the validation errors are evidence of their own.
export type PhaseFailure = "none" | "partial" | "failed" | "validation" | "unknown";

export interface OperationState {
  // The text the object reports, kept as it is; absent when the object reports none.
  reported?: string;
  recognized: boolean;
  lifecycle: Lifecycle;
  failure: PhaseFailure;
  execution: Execution;
  // The release gives the phase only after it counted the errors and the warnings of the operation. It
  // writes no counter of zero: a counter that is missing from such an object is a count of none. A failed
  // operation is not among them: the release can fail one before it counts.
  counted: boolean;
  // What an operator reads first. The reported text stays beside it.
  label: string;
}

type Contract = Pick<OperationState, "lifecycle" | "failure" | "execution" | "counted" | "label">;

const CONTRACT: Record<string, Contract> = {
  New: { lifecycle: "in-flight", failure: "none", execution: "not-started", counted: false, label: "New" },
  Queued: { lifecycle: "in-flight", failure: "none", execution: "not-started", counted: false, label: "Queued" },
  ReadyToStart: {
    lifecycle: "in-flight",
    failure: "none",
    execution: "not-started",
    counted: false,
    label: "Ready to start",
  },
  InProgress: { lifecycle: "in-flight", failure: "none", execution: "running", counted: false, label: "In progress" },
  WaitingForPluginOperations: {
    lifecycle: "in-flight",
    failure: "none",
    execution: "ran",
    counted: true,
    label: "Waiting for plugin operations",
  },
  WaitingForPluginOperationsPartiallyFailed: {
    lifecycle: "in-flight",
    failure: "partial",
    execution: "ran",
    counted: true,
    label: "Waiting for plugin operations",
  },
  Finalizing: { lifecycle: "in-flight", failure: "none", execution: "ran", counted: true, label: "Finalizing" },
  FinalizingPartiallyFailed: {
    lifecycle: "in-flight",
    failure: "partial",
    execution: "ran",
    counted: true,
    label: "Finalizing",
  },
  Completed: { lifecycle: "terminal", failure: "none", execution: "ran", counted: true, label: "Completed" },
  PartiallyFailed: {
    lifecycle: "terminal",
    failure: "partial",
    execution: "ran",
    counted: true,
    label: "Partially failed",
  },
  Failed: { lifecycle: "terminal", failure: "failed", execution: "ran", counted: false, label: "Failed" },
  FailedValidation: {
    lifecycle: "terminal",
    failure: "validation",
    execution: "not-started",
    counted: false,
    label: "Failed validation",
  },
  // What the backup was before its deletion is not in the phase any more.
  Deleting: { lifecycle: "deleting", failure: "unknown", execution: "unknown", counted: false, label: "Deleting" },
};

export function operationPhases(kind: OperationKind): readonly string[] {
  return kind === "Backup" ? BACKUP_PHASES : RESTORE_PHASES;
}

export function operationState(kind: OperationKind, phase: unknown): OperationState {
  if (typeof phase !== "string" || phase === "") {
    return {
      recognized: false,
      lifecycle: "unknown",
      failure: "unknown",
      execution: "unknown",
      counted: false,
      label: "Not reported",
    };
  }
  // A phase of the other kind is not a phase of this one: a Restore never waits in a queue.
  const contract = operationPhases(kind).includes(phase) ? CONTRACT[phase] : undefined;

  if (!contract) {
    return {
      reported: phase,
      recognized: false,
      lifecycle: "unknown",
      failure: "unknown",
      execution: "unknown",
      counted: false,
      label: "Unknown",
    };
  }
  return { reported: phase, recognized: true, ...contract };
}

export function isInFlight(state: OperationState): boolean {
  return state.lifecycle === "in-flight";
}

export function isTerminal(state: OperationState): boolean {
  return state.lifecycle === "terminal";
}
