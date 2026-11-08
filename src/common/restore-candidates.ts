// The backups a restore is asked of (SPEC-0017, REQ-265, REQ-267, D10, D13): from the view of a backup, that backup;
// from the view of a schedule, the backups of the schedule the installation read that a restore is offered of,
// Completed or PartiallyFailed, the newest by its start first, the newest Completed chosen first, as the server would
// choose it for a restore of the schedule.

import { backupOffered } from "./restore-create-words";

import type { BackupNamespaces } from "./restore-form";
import type { BackupResource } from "./types";

// The label every backup of a schedule carries.
const SCHEDULE_NAME_LABEL = "velero.io/schedule-name";

// The start of a backup, for its order: one that never started is the oldest.
function startOf(backup: BackupResource): number {
  const start = Date.parse(String(backup.status?.startTimestamp ?? ""));

  return Number.isFinite(start) ? start : Number.NEGATIVE_INFINITY;
}

// The namespaces the spec of a backup names, which the mapping of a restore is matched against.
export function namespacesOfBackup(backup: BackupResource): BackupNamespaces {
  const names = (value: unknown) =>
    Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : undefined;
  const included = names(backup.spec?.includedNamespaces);
  const excluded = names(backup.spec?.excludedNamespaces);

  return {
    ...(included ? { includedNamespaces: included } : {}),
    ...(excluded ? { excludedNamespaces: excluded } : {}),
  };
}

// The backup a restore is of, by its name and its UID, with the namespaces its spec names.
export function restoreBackupOf(backup: BackupResource): {
  name: string;
  uid: string;
  namespaces: BackupNamespaces;
} {
  return { name: backup.metadata.name, uid: backup.metadata.uid ?? "", namespaces: namespacesOfBackup(backup) };
}

// The backups of a schedule a restore is offered of, the newest by its start first, and the one chosen first.
export function scheduleCandidates(
  backups: readonly BackupResource[],
  schedule: string,
): { offered: BackupResource[]; chosen?: BackupResource } {
  const offered = backups
    .filter((backup) => backup.metadata.labels?.[SCHEDULE_NAME_LABEL] === schedule)
    .filter((backup) => backupOffered(backup.status?.phase).offered)
    .sort((one, other) => startOf(other) - startOf(one) || one.metadata.name.localeCompare(other.metadata.name));
  const chosen = offered.find((backup) => backup.status?.phase === "Completed") ?? offered[0];

  return { offered, ...(chosen ? { chosen } : {}) };
}
