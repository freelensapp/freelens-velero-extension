import { operationDuration, timestamp } from "./duration";
import { operationEvidence } from "./evidence";
import { durationText, lifecycleText, phaseText, progressText, signalText, timeText } from "./operation-text";
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

// What the search of the list looks into: what the columns show, and the words of the status. The age is
// the one column the host writes, from the time the object was created.
export function searchFields(view: BackupView): string[] {
  return [
    view.name,
    view.namespace,
    view.state.reported ?? "",
    view.state.label,
    lifecycleText(view.state),
    signalText(view.evidence),
    progressText(view.progress),
    timeText(view.started),
    durationText(view.duration),
    view.storage ?? "",
    view.schedule ?? "",
    ...view.evidence.validationErrors,
  ].filter(Boolean);
}

// An order for each column that has one. What is not reported has the lowest value of its column: it is
// first in the ascending order and last in the descending one.
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
