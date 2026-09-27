import { LABELS } from "./types";

import type { FamilyRead } from "./read-state";
import type {
  BackupResource,
  BackupStorageLocationResource,
  ObjectMetadata,
  RestoreResource,
  ScheduleResource,
  VolumeSnapshotLocationResource,
} from "./types";

export type ReferenceKind = "Schedule" | "BackupStorageLocation" | "VolumeSnapshotLocation" | "Restore" | "Backup";

export type ReferenceState =
  // The object is there, in the same installation.
  | "resolved"
  // The list was read and holds no object of that name.
  | "absent"
  // The reader may not read that kind.
  | "inaccessible"
  // The kind is not served, or its read failed: nothing can be said of the object.
  | "unknown"
  // The kind was not read yet.
  | "not-read";

export interface Reference {
  kind: ReferenceKind;
  name: string;
  namespace: string;
  state: ReferenceState;
  // Of the object found, to tell it from one created later with the same name.
  uid?: string;
  // The object comes from an earlier read: the last one did not succeed.
  stale: boolean;
  reason: string;
}

export type RelatedRestores =
  | { state: "listed"; items: RestoreResource[]; stale: boolean }
  | { state: Exclude<ReferenceState, "resolved" | "absent">; reason: string };

export interface BackupReferences {
  // Absent when the backup names none: a backup started by hand has no schedule.
  schedule?: Reference;
  storageLocation?: Reference;
  volumeSnapshotLocations: Reference[];
  restores: RelatedRestores;
}

export interface InstallationReads {
  schedules: FamilyRead<ScheduleResource>;
  storageLocations: FamilyRead<BackupStorageLocationResource>;
  snapshotLocations: FamilyRead<VolumeSnapshotLocationResource>;
  restores: FamilyRead<RestoreResource>;
}

const NAMES: Record<ReferenceKind, string> = {
  Schedule: "schedule",
  BackupStorageLocation: "backup storage location",
  VolumeSnapshotLocation: "volume snapshot location",
  Restore: "restore",
  Backup: "backup",
};

function unavailable(kind: ReferenceKind, read: FamilyRead<unknown>): { state: ReferenceState; reason: string } {
  const plural = `${NAMES[kind]}s`;

  switch (read.status) {
    case "forbidden":
      return { state: "inaccessible", reason: `The ${plural} of this installation cannot be read: access is denied` };
    case "not-served":
      return { state: "unknown", reason: `The cluster does not serve the ${plural}` };
    case "failed":
      return { state: "unknown", reason: `The ${plural} of this installation could not be read` };
    default:
      return { state: "not-read", reason: `The ${plural} of this installation were not read yet` };
  }
}

// One object by its name, among the ones of the same namespace and of nothing else.
export function resolveReference<Item extends { metadata: ObjectMetadata }>(
  kind: ReferenceKind,
  name: string,
  namespace: string,
  read: FamilyRead<Item>,
): Reference {
  const found = read.items.find((item) => item.metadata.name === name && item.metadata.namespace === namespace);
  const stale = read.status !== "ready";

  if (found) {
    return {
      kind,
      name,
      namespace,
      state: "resolved",
      uid: found.metadata.uid,
      stale,
      reason: stale ? `Read before the ${NAMES[kind]}s stopped answering` : "",
    };
  }
  if (read.status === "ready") {
    return {
      kind,
      name,
      namespace,
      state: "absent",
      stale: false,
      reason: `No ${NAMES[kind]} of this name in ${namespace}`,
    };
  }
  // Not found in a list that was not read now: the object may be there.
  return { kind, name, namespace, stale: false, ...unavailable(kind, read) };
}

function named(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

export function backupReferences(backup: BackupResource, reads: InstallationReads): BackupReferences {
  const namespace = backup.metadata.namespace ?? "";
  const schedule = named(backup.metadata.labels?.[LABELS.schedule]);
  const location = named(backup.spec?.storageLocation) ?? named(backup.metadata.labels?.[LABELS.storageLocation]);
  const snapshots = Array.isArray(backup.spec?.volumeSnapshotLocations)
    ? backup.spec.volumeSnapshotLocations.filter((name): name is string => named(name) !== undefined)
    : [];
  const restores = reads.restores;

  return {
    ...(schedule ? { schedule: resolveReference("Schedule", schedule, namespace, reads.schedules) } : {}),
    ...(location
      ? { storageLocation: resolveReference("BackupStorageLocation", location, namespace, reads.storageLocations) }
      : {}),
    volumeSnapshotLocations: snapshots.map((name) =>
      resolveReference("VolumeSnapshotLocation", name, namespace, reads.snapshotLocations),
    ),
    // A list that was never read says nothing of the restores: not that there are none.
    restores:
      restores.status === "ready" || restores.lastSuccess !== undefined
        ? {
            state: "listed",
            stale: restores.status !== "ready",
            items: restores.items.filter(
              (restore) =>
                restore.metadata.namespace === namespace && restore.spec?.backupName === backup.metadata.name,
            ),
          }
        : (unavailable("Restore", restores) as Exclude<RelatedRestores, { state: "listed" }>),
  };
}

// The same object, not one of the same name: a backup deleted and created again is another backup.
export function sameObject(one: { metadata: ObjectMetadata }, other: { metadata: ObjectMetadata }): boolean {
  if (one.metadata.uid && other.metadata.uid) return one.metadata.uid === other.metadata.uid;
  return false;
}
