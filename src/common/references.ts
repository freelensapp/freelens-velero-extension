import { defaults } from "./location-view";
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

// The storage location of a backup: the one its spec names, or the one of the label the release writes on
// it. Whoever asks where a backup is, asks here.
export function backupLocation(backup: Pick<BackupResource, "metadata" | "spec">): string | undefined {
  return named(backup.spec?.storageLocation) ?? named(backup.metadata.labels?.[LABELS.storageLocation]);
}

export function backupReferences(backup: BackupResource, reads: InstallationReads): BackupReferences {
  const namespace = backup.metadata.namespace ?? "";
  const schedule = named(backup.metadata.labels?.[LABELS.schedule]);
  const location = backupLocation(backup);
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

export interface RestoreReads {
  backups: FamilyRead<BackupResource>;
  schedules: FamilyRead<ScheduleResource>;
  storageLocations: FamilyRead<BackupStorageLocationResource>;
}

export interface RestoreReferences {
  // Absent when the object names none.
  backup?: Reference;
  schedule?: Reference;
  // The storage location of the backup: known through the backup, and only when the backup is found.
  storageLocation?: Reference;
}

// What a restore refers to, by the names the object carries, inside its own namespace.
export function restoreReferences(restore: RestoreResource, reads: RestoreReads): RestoreReferences {
  const namespace = restore.metadata.namespace ?? "";
  const backup = named(restore.spec?.backupName);
  const schedule = named(restore.spec?.scheduleName);
  const source = backup
    ? reads.backups.items.find((item) => item.metadata.name === backup && item.metadata.namespace === namespace)
    : undefined;
  const location = source ? backupLocation(source) : undefined;

  return {
    ...(backup ? { backup: resolveReference("Backup", backup, namespace, reads.backups) } : {}),
    ...(schedule ? { schedule: resolveReference("Schedule", schedule, namespace, reads.schedules) } : {}),
    ...(location
      ? { storageLocation: resolveReference("BackupStorageLocation", location, namespace, reads.storageLocations) }
      : {}),
  };
}

export interface TemplateReads {
  storageLocations: FamilyRead<BackupStorageLocationResource>;
  snapshotLocations: FamilyRead<VolumeSnapshotLocationResource>;
}

// Where the backups of a schedule go when its template names no storage location: the release takes the
// location marked default, or the one the server names in its settings when none is marked.
export type DefaultLocation =
  | { state: "marked"; name: string }
  // More than one is marked. The release sends a backup to the first of them it finds, and keeps marked
  // the one created last: which one takes a backup is not settled until it has.
  | { state: "many-marked"; names: string[]; kept?: string; tied?: string[] }
  | { state: "none-marked" }
  // The storage locations were not read.
  | { state: "unknown"; reason: string };

export interface TemplateReferences {
  // Absent when the template names none: `fallback` says where the backups go.
  storageLocation?: Reference;
  fallback?: DefaultLocation;
  // What is to be said of the storage location the backups go to, when it does not take them.
  warning?: string;
  volumeSnapshotLocations: Reference[];
}

function defaultLocation(namespace: string, read: FamilyRead<BackupStorageLocationResource>): DefaultLocation {
  if (read.status !== "ready" && read.lastSuccess === undefined) {
    return { state: "unknown", reason: unavailable("BackupStorageLocation", read).reason };
  }
  const marked = defaults(read.items, namespace);

  if (marked.state === "none") return { state: "none-marked" };
  if (marked.state === "one") return { state: "marked", name: marked.names[0] };
  const { names, kept, tied } = marked;

  return { state: "many-marked", names, ...(kept ? { kept } : {}), ...(tied ? { tied } : {}) };
}

// What the reviewed release refuses a backup for, of the storage location it is sent to.
export function locationWarning(location: BackupStorageLocationResource | undefined): string | undefined {
  if (!location) return undefined;
  const refusals = [
    location.spec?.accessMode === "ReadOnly" ? "it is read-only" : "",
    location.status?.phase === "Available"
      ? ""
      : location.status?.phase
        ? `Velero reports it ${location.status.phase}`
        : "Velero reports no availability of it",
  ].filter(Boolean);

  return refusals.length
    ? `The release refuses a backup sent to this location: ${refusals.join(", and ")}.`
    : undefined;
}

// What the template of a schedule refers to, inside the namespace of the schedule.
export function templateReferences(schedule: ScheduleResource, reads: TemplateReads): TemplateReferences {
  const namespace = schedule.metadata.namespace ?? "";
  const template = schedule.spec?.template;
  const location = named(template?.storageLocation);
  const snapshots = Array.isArray(template?.volumeSnapshotLocations)
    ? template.volumeSnapshotLocations.filter((name): name is string => named(name) !== undefined)
    : [];
  const fallback = location ? undefined : defaultLocation(namespace, reads.storageLocations);
  const find = (name: string | undefined) =>
    name
      ? reads.storageLocations.items.find(
          (item) => item.metadata.name === name && item.metadata.namespace === namespace,
        )
      : undefined;
  const reference = location
    ? resolveReference("BackupStorageLocation", location, namespace, reads.storageLocations)
    : undefined;
  // With more than one location marked default a backup may go to any of them: each one that does not
  // take it is named.
  const refusing =
    fallback?.state === "many-marked"
      ? fallback.names
          .map((name) => [name, locationWarning(find(name))] as const)
          .filter(([, reason]) => reason !== undefined)
          .map(([name, reason]) => `${name}: ${reason}`)
      : [];
  const warning =
    reference?.state === "absent"
      ? "The release refuses a backup sent to a location that is not there."
      : fallback?.state === "many-marked"
        ? refusing.join(" ") || undefined
        : locationWarning(find(location ?? (fallback?.state === "marked" ? fallback.name : undefined)));

  return {
    ...(reference ? { storageLocation: reference } : {}),
    ...(fallback ? { fallback } : {}),
    ...(warning ? { warning } : {}),
    volumeSnapshotLocations: snapshots.map((name) =>
      resolveReference("VolumeSnapshotLocation", name, namespace, reads.snapshotLocations),
    ),
  };
}

// The restores that name a schedule. Velero writes the name of the schedule also into a restore asked from
// one of its backups: a restore that names the schedule was not necessarily asked from it.
export function scheduleRestores(
  schedule: { metadata: { name: string; namespace?: string } },
  restores: FamilyRead<RestoreResource>,
): RelatedRestores {
  if (restores.status !== "ready" && restores.lastSuccess === undefined) {
    return unavailable("Restore", restores) as Exclude<RelatedRestores, { state: "listed" }>;
  }
  return {
    state: "listed",
    stale: restores.status !== "ready",
    items: restores.items.filter(
      (restore) =>
        restore.metadata.namespace === (schedule.metadata.namespace ?? "") &&
        restore.spec?.scheduleName === schedule.metadata.name,
    ),
  };
}

// The same object, not one of the same name: a backup deleted and created again is another backup.
export function sameObject(one: { metadata: ObjectMetadata }, other: { metadata: ObjectMetadata }): boolean {
  if (one.metadata.uid && other.metadata.uid) return one.metadata.uid === other.metadata.uid;
  return false;
}
