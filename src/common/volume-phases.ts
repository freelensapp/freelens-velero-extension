// The phases of the operations of the volumes of Velero v1.18.4, on the two axes of the backups and the restores
// and a third outcome they do not have: a cancellation, which is neither a success nor a failure. The readiness of
// a backup repository and the result of one of its maintenances are beside them.

import type { Execution, Lifecycle } from "./phases";

// The kinds whose objects are operations on the data of a volume.
export type VolumeKind = "PodVolumeBackup" | "PodVolumeRestore";

export const VOLUME_PHASES = [
  "New",
  "Accepted",
  "Prepared",
  "InProgress",
  "Canceling",
  "Completed",
  "Failed",
  "Canceled",
] as const;

// Where the work of an operation is. A failed or a cancelled operation may have ended before or after its data
// path began: the times it carries say which.
export type VolumeExecution = Execution | "ran-or-not-started";

// How the operation ended, or that it did not yet.
export type VolumeOutcome = "none" | "completed" | "failed" | "cancelled" | "unknown";

export interface VolumeOperationState {
  kind: VolumeKind;
  // The text the object reports, kept as it is; absent when the object reports none.
  reported?: string;
  recognized: boolean;
  lifecycle: Exclude<Lifecycle, "deleting">;
  execution: VolumeExecution;
  outcome: VolumeOutcome;
  // The cancellation was asked, and the data path is being stopped.
  cancelAsked: boolean;
  label: string;
}

type Contract = Pick<VolumeOperationState, "lifecycle" | "execution" | "outcome" | "cancelAsked" | "label">;

const WAITING: Contract = {
  lifecycle: "in-flight",
  execution: "not-started",
  outcome: "none",
  cancelAsked: false,
  label: "New",
};

const CONTRACT: Record<(typeof VOLUME_PHASES)[number], Contract> = {
  New: WAITING,
  Accepted: { ...WAITING, label: "Accepted" },
  Prepared: { ...WAITING, label: "Prepared" },
  InProgress: {
    lifecycle: "in-flight",
    execution: "running",
    outcome: "none",
    cancelAsked: false,
    label: "In progress",
  },
  Canceling: { lifecycle: "in-flight", execution: "running", outcome: "none", cancelAsked: true, label: "Canceling" },
  Completed: { lifecycle: "terminal", execution: "ran", outcome: "completed", cancelAsked: false, label: "Completed" },
  Failed: {
    lifecycle: "terminal",
    execution: "ran-or-not-started",
    outcome: "failed",
    cancelAsked: false,
    label: "Failed",
  },
  Canceled: {
    lifecycle: "terminal",
    execution: "ran-or-not-started",
    outcome: "cancelled",
    cancelAsked: false,
    label: "Canceled",
  },
};

function phase(value: string): value is (typeof VOLUME_PHASES)[number] {
  return (VOLUME_PHASES as readonly string[]).includes(value);
}

// The release takes an operation with no phase as a New one: it is waiting, and is not a failure.
export function volumeOperationState(kind: VolumeKind, value: unknown): VolumeOperationState {
  if (value === undefined || value === null || value === "") {
    return { kind, recognized: true, ...WAITING, label: "No phase yet" };
  }
  const reported = typeof value === "string" ? value : JSON.stringify(value);

  if (!phase(reported)) {
    return {
      kind,
      reported,
      recognized: false,
      lifecycle: "unknown",
      execution: "unknown",
      outcome: "unknown",
      cancelAsked: false,
      label: "Unknown",
    };
  }
  return { kind, reported, recognized: true, ...CONTRACT[reported] };
}

// The order of the phases in a list, from the first an operation is in to the last: an order of the lifecycle
// first, then of the phase inside it, what is not known last.
export function phaseRank(state: VolumeOperationState): number {
  if (!state.recognized) return VOLUME_PHASES.length + 1;
  return state.reported === undefined ? 0 : VOLUME_PHASES.indexOf(state.reported as (typeof VOLUME_PHASES)[number]) + 1;
}

export const LIFECYCLE_RANK: Record<VolumeOperationState["lifecycle"], number> = {
  "in-flight": 0,
  terminal: 1,
  unknown: 2,
};

// Whether Velero can use a backup repository, as its phase says. The release writes Ready or NotReady at its
// first pass over one; the command line prints New for one that reports none.
export type Readiness = "ready" | "not-ready" | "not-initialized" | "unknown";

export interface RepositoryReadiness {
  reported?: string;
  readiness: Readiness;
  label: string;
}

export function repositoryReadiness(value: unknown): RepositoryReadiness {
  if (value === undefined || value === null || value === "") {
    return { readiness: "not-initialized", label: "Not initialized yet" };
  }
  const reported = typeof value === "string" ? value : JSON.stringify(value);

  switch (reported) {
    case "New":
      return { reported, readiness: "not-initialized", label: "Not initialized yet" };
    case "Ready":
      return { reported, readiness: "ready", label: "Ready" };
    case "NotReady":
      return { reported, readiness: "not-ready", label: "Not ready" };
    default:
      return { reported, readiness: "unknown", label: "Unknown" };
  }
}

// The order of the readiness in a list: Ready, NotReady, not initialized, then what is not known.
export const READINESS_RANK: Record<Readiness, number> = {
  ready: 0,
  "not-ready": 1,
  "not-initialized": 2,
  unknown: 3,
};

// The result of one maintenance of a repository.
export interface MaintenanceResult {
  reported?: string;
  result: "succeeded" | "failed" | "unknown";
  label: string;
}

export function maintenanceResult(value: unknown): MaintenanceResult {
  if (value === "Succeeded") return { reported: value, result: "succeeded", label: "Succeeded" };
  if (value === "Failed") return { reported: value, result: "failed", label: "Failed" };
  if (value === undefined || value === null || value === "") return { result: "unknown", label: "Not reported" };
  return { reported: typeof value === "string" ? value : JSON.stringify(value), result: "unknown", label: "Unknown" };
}
