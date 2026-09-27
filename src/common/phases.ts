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
// What the phase alone says. The counters and the validation errors are evidence of their own.
export type PhaseFailure = "none" | "partial" | "failed" | "validation" | "unknown";

export interface OperationState {
  // The text the object reports, kept as it is; absent when the object reports none.
  reported?: string;
  recognized: boolean;
  lifecycle: Lifecycle;
  failure: PhaseFailure;
  // What an operator reads first. The reported text stays beside it.
  label: string;
}

const CONTRACT: Record<string, { lifecycle: Lifecycle; failure: PhaseFailure; label: string }> = {
  New: { lifecycle: "in-flight", failure: "none", label: "New" },
  Queued: { lifecycle: "in-flight", failure: "none", label: "Queued" },
  ReadyToStart: { lifecycle: "in-flight", failure: "none", label: "Ready to start" },
  InProgress: { lifecycle: "in-flight", failure: "none", label: "In progress" },
  WaitingForPluginOperations: { lifecycle: "in-flight", failure: "none", label: "Waiting for plugin operations" },
  WaitingForPluginOperationsPartiallyFailed: {
    lifecycle: "in-flight",
    failure: "partial",
    label: "Waiting for plugin operations",
  },
  Finalizing: { lifecycle: "in-flight", failure: "none", label: "Finalizing" },
  FinalizingPartiallyFailed: { lifecycle: "in-flight", failure: "partial", label: "Finalizing" },
  Completed: { lifecycle: "terminal", failure: "none", label: "Completed" },
  PartiallyFailed: { lifecycle: "terminal", failure: "partial", label: "Partially failed" },
  Failed: { lifecycle: "terminal", failure: "failed", label: "Failed" },
  FailedValidation: { lifecycle: "terminal", failure: "validation", label: "Failed validation" },
  // What the backup was before its deletion is not in the phase any more.
  Deleting: { lifecycle: "deleting", failure: "unknown", label: "Deleting" },
};

export function operationPhases(kind: OperationKind): readonly string[] {
  return kind === "Backup" ? BACKUP_PHASES : RESTORE_PHASES;
}

export function operationState(kind: OperationKind, phase: unknown): OperationState {
  if (typeof phase !== "string" || phase === "") {
    return { recognized: false, lifecycle: "unknown", failure: "unknown", label: "Not reported" };
  }
  // A phase of the other kind is not a phase of this one: a Restore never waits in a queue.
  const contract = operationPhases(kind).includes(phase) ? CONTRACT[phase] : undefined;

  if (!contract)
    return { reported: phase, recognized: false, lifecycle: "unknown", failure: "unknown", label: "Unknown" };
  return { reported: phase, recognized: true, ...contract };
}

export function isInFlight(state: OperationState): boolean {
  return state.lifecycle === "in-flight";
}

export function isTerminal(state: OperationState): boolean {
  return state.lifecycle === "terminal";
}
