// The index of the operations of the volumes of an installation (SPEC-0014, REQ-194): made once for a read, in one
// pass over each family, so that the band of a backup or of a restore, the Volumes tab of each and what used a
// repository find their operations in one look of a map, never by a search of the items.

import { labelOf } from "./name-label";
import { newestFirst } from "./operation-time";
import { LABELS } from "./types";
import { repositoryType, tripleKey, volumeNamespace } from "./volume-references";

import type { FamilyRead } from "./read-state";
import type { BackupRepositoryResource, PodVolumeBackupResource, PodVolumeRestoreResource } from "./types";
import type { VolumeKind } from "./volume-phases";
import type { VolumeOperation } from "./volume-references";

// The reads the index is made of: the two families of the pod volume operations, as the installation gives them.
export interface VolumeIndexReads {
  podVolumeBackups: FamilyRead<PodVolumeBackupResource>;
  podVolumeRestores: FamilyRead<PodVolumeRestoreResource>;
}

export interface IndexedOperation {
  kind: VolumeKind;
  operation: VolumeOperation;
}

export interface VolumeIndex {
  reads: VolumeIndexReads;
  // The pod volume backups of each backup, by its namespace and the label of its UID, from the newest.
  ofBackup: ReadonlyMap<string, PodVolumeBackupResource[]>;
  // The pod volume restores of each restore, the same way.
  ofRestore: ReadonlyMap<string, PodVolumeRestoreResource[]>;
  // The operations of each repository, by the namespace and the three labels the release names one with, cut as
  // the release cuts a long one, from the newest.
  usedBy: ReadonlyMap<string, IndexedOperation[]>;
}

function named(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

// The key of the operations of an owner: its namespace and its UID, which the release writes into the label of the
// UID of each of them. The name is never a key: its label is cut when it is long, and another object may take it.
export function ownerKey(namespace: string, uid: string): string {
  return `${namespace}\u0000${uid}`;
}

// The key of the operations that name a repository, by its namespace and the three labels it carries.
export function repositoryKey(repository: BackupRepositoryResource): string | undefined {
  const labels = repository.metadata.labels ?? {};
  const volumes = named(labels[LABELS.volumeNamespace]);
  const location = named(labels[LABELS.storageLocation]);
  const type = named(labels[LABELS.repositoryType]);

  if (!volumes || !location || !type) return undefined;
  return `${repository.metadata.namespace ?? ""}\u0000${tripleKey({ volumeNamespace: volumes, location, type })}`;
}

// The key of the repository an operation names, as `operationRepository` finds it: the namespace of its volume and
// its location cut as the labels hold them, and the type of its uploader.
function operationRepositoryKey(kind: VolumeKind, operation: VolumeOperation): string | undefined {
  const namespace = volumeNamespace(kind, operation);
  const location = named(operation.spec?.backupStorageLocation);
  const type = repositoryType(operation.spec?.uploaderType);

  if (!namespace || !location || !type) return undefined;
  return `${operation.metadata.namespace ?? ""}\u0000${tripleKey({
    volumeNamespace: labelOf(namespace),
    location: labelOf(location),
    type,
  })}`;
}

function add<Item>(map: Map<string, Item[]>, key: string, item: Item): void {
  const found = map.get(key);

  if (found) found.push(item);
  else map.set(key, [item]);
}

const UID_LABEL: Record<VolumeKind, string> = {
  PodVolumeBackup: LABELS.backupUid,
  PodVolumeRestore: LABELS.restoreUid,
};

// One pass over the items of each family: each operation goes into the list of its owner and of the repository it
// names. Each list is then put in order once, from the newest.
export function volumeIndex(reads: VolumeIndexReads): VolumeIndex {
  const ofBackup = new Map<string, PodVolumeBackupResource[]>();
  const ofRestore = new Map<string, PodVolumeRestoreResource[]>();
  const usedBy = new Map<string, IndexedOperation[]>();
  const families: [VolumeKind, readonly VolumeOperation[], Map<string, VolumeOperation[]>][] = [
    ["PodVolumeBackup", reads.podVolumeBackups.items, ofBackup as Map<string, VolumeOperation[]>],
    ["PodVolumeRestore", reads.podVolumeRestores.items, ofRestore as Map<string, VolumeOperation[]>],
  ];

  for (const [kind, items, owners] of families) {
    for (const operation of items) {
      const namespace = operation.metadata.namespace ?? "";
      const uid = named(operation.metadata.labels?.[UID_LABEL[kind]]);
      const repository = operationRepositoryKey(kind, operation);

      if (uid) add(owners, ownerKey(namespace, uid), operation);
      if (repository) add(usedBy, repository, { kind, operation });
    }
  }
  for (const list of [...ofBackup.values(), ...ofRestore.values()]) list.sort(newestFirst);
  for (const list of usedBy.values()) list.sort((one, other) => newestFirst(one.operation, other.operation));
  return { reads, ofBackup, ofRestore, usedBy };
}
