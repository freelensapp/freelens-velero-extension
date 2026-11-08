// The index of the operations of the volumes of an installation (SPEC-0014, REQ-194): made once for a read, in one
// pass over each family, so that the band of a backup or of a restore, the Volumes tab of each, what used a
// repository and the data upload of a data download find their operations in one look of a map, never by a search
// of the items.

import { labelOf } from "./name-label";
import { newestFirst } from "./operation-time";
import { LABELS } from "./types";
import { operationType, tripleKey, volumeNamespace } from "./volume-references";

import type { FamilyRead } from "./read-state";
import type {
  BackupRepositoryResource,
  DataDownloadResource,
  DataUploadResource,
  PodVolumeBackupResource,
  PodVolumeRestoreResource,
} from "./types";
import type { VolumeKind } from "./volume-phases";
import type { VolumeOperation } from "./volume-references";

// The reads the index is made of: the four families of the operations, as the installation gives them.
export interface VolumeIndexReads {
  podVolumeBackups: FamilyRead<PodVolumeBackupResource>;
  podVolumeRestores: FamilyRead<PodVolumeRestoreResource>;
  dataUploads: FamilyRead<DataUploadResource>;
  dataDownloads: FamilyRead<DataDownloadResource>;
}

// The read of each kind in the reads of the index.
export const READ_OF: Record<VolumeKind, keyof VolumeIndexReads> = {
  PodVolumeBackup: "podVolumeBackups",
  PodVolumeRestore: "podVolumeRestores",
  DataUpload: "dataUploads",
  DataDownload: "dataDownloads",
};

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
  // The data uploads of each backup and the data downloads of each restore, the same way.
  ofUpload: ReadonlyMap<string, DataUploadResource[]>;
  ofDownload: ReadonlyMap<string, DataDownloadResource[]>;
  // The operations of each repository, by the namespace and the three labels the release names one with, cut as
  // the release cuts a long one, from the newest.
  usedBy: ReadonlyMap<string, IndexedOperation[]>;
  // The data uploads of each namespace by the snapshot their data was moved into, from the newest: the data
  // download that restores from that snapshot names it.
  bySnapshot: ReadonlyMap<string, DataUploadResource[]>;
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

// The key of the data uploads of a snapshot, in the namespace of the installation.
export function snapshotKey(namespace: string, snapshot: string): string {
  return `${namespace}\u0000${snapshot}`;
}

// The key of the repository an operation names, as `operationRepository` finds it: the namespace of its volume and
// its location cut as the labels hold them, and the type of its uploader, or kopia for a data movement.
function operationRepositoryKey(kind: VolumeKind, operation: VolumeOperation): string | undefined {
  const namespace = volumeNamespace(kind, operation);
  const location = named(operation.spec?.backupStorageLocation);
  const type = operationType(kind, operation);

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

export const UID_LABEL: Record<VolumeKind, string> = {
  PodVolumeBackup: LABELS.backupUid,
  PodVolumeRestore: LABELS.restoreUid,
  DataUpload: LABELS.backupUid,
  DataDownload: LABELS.restoreUid,
};

// One pass over the items of each family: each operation goes into the list of its owner and of the repository it
// names, and a data upload into the list of its snapshot. Each list is then put in order once, from the newest.
export function volumeIndex(reads: VolumeIndexReads): VolumeIndex {
  const ofBackup = new Map<string, PodVolumeBackupResource[]>();
  const ofRestore = new Map<string, PodVolumeRestoreResource[]>();
  const ofUpload = new Map<string, DataUploadResource[]>();
  const ofDownload = new Map<string, DataDownloadResource[]>();
  const usedBy = new Map<string, IndexedOperation[]>();
  const bySnapshot = new Map<string, DataUploadResource[]>();
  const families: [VolumeKind, readonly VolumeOperation[], Map<string, VolumeOperation[]>][] = [
    ["PodVolumeBackup", reads.podVolumeBackups.items, ofBackup as Map<string, VolumeOperation[]>],
    ["PodVolumeRestore", reads.podVolumeRestores.items, ofRestore as Map<string, VolumeOperation[]>],
    ["DataUpload", reads.dataUploads.items, ofUpload as Map<string, VolumeOperation[]>],
    ["DataDownload", reads.dataDownloads.items, ofDownload as Map<string, VolumeOperation[]>],
  ];

  for (const [kind, items, owners] of families) {
    for (const operation of items) {
      const namespace = operation.metadata.namespace ?? "";
      const uid = named(operation.metadata.labels?.[UID_LABEL[kind]]);
      const repository = operationRepositoryKey(kind, operation);

      if (uid) add(owners, ownerKey(namespace, uid), operation);
      if (repository) add(usedBy, repository, { kind, operation });
      if (kind === "DataUpload") {
        const snapshot = named((operation as DataUploadResource).status?.snapshotID);

        if (snapshot) add(bySnapshot, snapshotKey(namespace, snapshot), operation as DataUploadResource);
      }
    }
  }
  for (const list of [...ofBackup.values(), ...ofRestore.values(), ...ofUpload.values(), ...ofDownload.values()]) {
    list.sort(newestFirst);
  }
  for (const list of bySnapshot.values()) list.sort(newestFirst);
  for (const list of usedBy.values()) list.sort((one, other) => newestFirst(one.operation, other.operation));
  return { reads, ofBackup, ofRestore, ofUpload, ofDownload, usedBy, bySnapshot };
}
