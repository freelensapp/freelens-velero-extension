// The fields of the Velero kinds the extension reads, written from the CRD schemas of Velero v1.18.2 and compared with the ones of v1.18.4, the reviewed release.
// The backup repositories and the pod volume operations are written from the schemas of v1.18.4, which are the
// same in v1.18.2 (SPEC-0014).
// Every field is optional: a schema admits an object without it, and a missing field is not a default.

export interface ObjectMetadata {
  name: string;
  namespace?: string;
  uid?: string;
  resourceVersion?: string;
  creationTimestamp?: string;
  deletionTimestamp?: string;
  labels?: Record<string, string>;
  annotations?: Record<string, string>;
  ownerReferences?: OwnerReference[] | null;
}

// The owner of an object, as Kubernetes writes it: the release makes a backup or a restore the owner of the
// operations it creates for it.
export interface OwnerReference {
  apiVersion?: string;
  kind?: string;
  name?: string;
  uid?: string;
  controller?: boolean;
}

// A resource as the host hands it over: plain data, without methods.
export interface VeleroResource<Spec, Status> {
  apiVersion?: string;
  kind?: string;
  metadata: ObjectMetadata;
  spec?: Spec;
  status?: Status;
}

export interface LabelSelector {
  matchLabels?: Record<string, string>;
  matchExpressions?: { key: string; operator: string; values?: string[] }[];
}

export interface TypedLocalObjectReference {
  apiGroup?: string;
  kind: string;
  name: string;
}

export interface HookStatus {
  hooksAttempted?: number;
  hooksFailed?: number;
}

export interface BackupSpec {
  csiSnapshotTimeout?: string;
  datamover?: string;
  defaultVolumesToFsBackup?: boolean | null;
  // What each hook does is not read: how many there are, and how they are called.
  hooks?: { resources?: { name?: string }[] | null } | null;
  orderedResources?: Record<string, string> | null;
  uploaderConfig?: { parallelFilesUpload?: number } | null;
  volumeGroupSnapshotLabelKey?: string;
  excludedClusterScopedResources?: string[] | null;
  excludedNamespaceScopedResources?: string[] | null;
  excludedNamespaces?: string[] | null;
  excludedResources?: string[] | null;
  includeClusterResources?: boolean | null;
  includedClusterScopedResources?: string[] | null;
  includedNamespaceScopedResources?: string[] | null;
  includedNamespaces?: string[] | null;
  includedResources?: string[] | null;
  itemOperationTimeout?: string;
  labelSelector?: LabelSelector | null;
  orLabelSelectors?: LabelSelector[] | null;
  resourcePolicy?: TypedLocalObjectReference;
  snapshotMoveData?: boolean | null;
  snapshotVolumes?: boolean | null;
  storageLocation?: string;
  ttl?: string;
  volumeSnapshotLocations?: string[];
}

export interface BackupStatus {
  backupItemOperationsAttempted?: number;
  backupItemOperationsCompleted?: number;
  backupItemOperationsFailed?: number;
  completionTimestamp?: string | null;
  csiVolumeSnapshotsAttempted?: number;
  csiVolumeSnapshotsCompleted?: number;
  errors?: number;
  expiration?: string | null;
  failureReason?: string;
  formatVersion?: string;
  hookStatus?: HookStatus | null;
  phase?: string;
  progress?: { itemsBackedUp?: number; totalItems?: number } | null;
  queuePosition?: number;
  startTimestamp?: string | null;
  validationErrors?: string[] | null;
  volumeSnapshotsAttempted?: number;
  volumeSnapshotsCompleted?: number;
  warnings?: number;
}

export interface RestoreSpec {
  backupName?: string;
  excludedNamespaces?: string[] | null;
  excludedResources?: string[] | null;
  existingResourcePolicy?: string | null;
  // What each hook does is not read: how many there are, and how they are called.
  hooks?: { resources?: { name?: string }[] | null };
  includeClusterResources?: boolean | null;
  includedNamespaces?: string[] | null;
  includedResources?: string[] | null;
  itemOperationTimeout?: string;
  labelSelector?: LabelSelector | null;
  namespaceMapping?: Record<string, string>;
  orLabelSelectors?: LabelSelector[] | null;
  preserveNodePorts?: boolean | null;
  resourceModifier?: TypedLocalObjectReference | null;
  // Since v1.18.3 of the reviewed series: read when the object carries it, never asked for.
  resourcePolicy?: TypedLocalObjectReference | null;
  restorePVs?: boolean | null;
  restoreStatus?: { excludedResources?: string[] | null; includedResources?: string[] | null } | null;
  scheduleName?: string;
  uploaderConfig?: { parallelFilesDownload?: number; writeSparseFiles?: boolean | null } | null;
}

export interface RestoreStatus {
  completionTimestamp?: string | null;
  errors?: number;
  failureReason?: string;
  hookStatus?: HookStatus | null;
  phase?: string;
  progress?: { itemsRestored?: number; totalItems?: number } | null;
  restoreItemOperationsAttempted?: number;
  restoreItemOperationsCompleted?: number;
  restoreItemOperationsFailed?: number;
  startTimestamp?: string | null;
  validationErrors?: string[] | null;
  warnings?: number;
}

export interface ScheduleSpec {
  paused?: boolean;
  schedule?: string;
  skipImmediately?: boolean;
  template?: BackupSpec;
  useOwnerReferencesInBackup?: boolean | null;
}

export interface ScheduleStatus {
  lastBackup?: string | null;
  lastSkipped?: string | null;
  phase?: string;
  validationErrors?: string[];
}

// The reference to one key of a Secret of the namespace of the object. The views show it by its names:
// no Secret is read.
export interface SecretKeyReference {
  name?: string;
  key?: string;
  optional?: boolean;
}

export interface BackupStorageLocationSpec {
  accessMode?: string;
  backupSyncPeriod?: string | null;
  config?: Record<string, string> | null;
  credential?: SecretKeyReference | null;
  default?: boolean;
  objectStorage?: {
    bucket?: string;
    prefix?: string;
    // Deprecated in the reviewed release: a certificate written in the object, as the API encodes bytes.
    caCert?: string;
    caCertRef?: SecretKeyReference | null;
  } | null;
  provider?: string;
  validationFrequency?: string | null;
}

export interface BackupStorageLocationStatus {
  lastSyncedTime?: string | null;
  lastValidationTime?: string | null;
  message?: string;
  phase?: string;
  // Deprecated and unused in the reviewed release: never read for the access mode.
  accessMode?: string;
}

export interface VolumeSnapshotLocationSpec {
  config?: Record<string, string> | null;
  credential?: SecretKeyReference | null;
  provider?: string;
}

export interface VolumeSnapshotLocationStatus {
  phase?: string;
}

// A backup repository: one for each volume namespace, storage location and type, which the backups and the
// restores of the file system and of the data movement write into and read from.
export interface BackupRepositorySpec {
  volumeNamespace?: string;
  backupStorageLocation?: string;
  // `kopia`, `restic`, or empty.
  repositoryType?: string;
  resticIdentifier?: string;
  maintenanceFrequency?: string;
  repositoryConfig?: Record<string, string> | null;
}

export interface BackupRepositoryMaintenance {
  // `Succeeded` or `Failed`.
  result?: string;
  startTimestamp?: string | null;
  completeTimestamp?: string | null;
  message?: string;
}

export interface BackupRepositoryStatus {
  // `New`, `Ready` or `NotReady`.
  phase?: string;
  message?: string;
  lastMaintenanceTime?: string | null;
  recentMaintenance?: BackupRepositoryMaintenance[] | null;
}

// The pod of a pod volume operation, as an object reference.
export interface PodReference {
  kind?: string;
  namespace?: string;
  name?: string;
  uid?: string;
}

// The progress of the data path of an operation, one type for the four operation kinds: the release leaves out
// each count when it is zero.
export interface DataMoveProgress {
  totalBytes?: number;
  bytesDone?: number;
}

export interface PodVolumeBackupSpec {
  // The node of the pod: the release writes no node into the status of a pod volume backup.
  node?: string;
  pod?: PodReference | null;
  volume?: string;
  backupStorageLocation?: string;
  repoIdentifier?: string;
  // `kopia`, `restic`, or empty.
  uploaderType?: string;
  tags?: Record<string, string> | null;
  uploaderSettings?: Record<string, string> | null;
  cancel?: boolean;
}

export interface PodVolumeBackupStatus {
  phase?: string;
  path?: string;
  snapshotID?: string;
  message?: string;
  startTimestamp?: string | null;
  completionTimestamp?: string | null;
  progress?: DataMoveProgress | null;
  // Left out when zero.
  incrementalBytes?: number;
  acceptedTimestamp?: string | null;
}

export interface PodVolumeRestoreSpec {
  pod?: PodReference | null;
  volume?: string;
  backupStorageLocation?: string;
  repoIdentifier?: string;
  uploaderType?: string;
  snapshotID?: string;
  // The logical size of the snapshot, taken from the pod volume backup.
  snapshotSize?: number;
  sourceNamespace?: string;
  uploaderSettings?: Record<string, string> | null;
  cancel?: boolean;
}

export interface PodVolumeRestoreStatus {
  phase?: string;
  message?: string;
  startTimestamp?: string | null;
  completionTimestamp?: string | null;
  progress?: DataMoveProgress | null;
  acceptedTimestamp?: string | null;
  node?: string;
}

export type BackupResource = VeleroResource<BackupSpec, BackupStatus>;
export type RestoreResource = VeleroResource<RestoreSpec, RestoreStatus>;
export type ScheduleResource = VeleroResource<ScheduleSpec, ScheduleStatus>;
export type BackupStorageLocationResource = VeleroResource<BackupStorageLocationSpec, BackupStorageLocationStatus>;
export type VolumeSnapshotLocationResource = VeleroResource<VolumeSnapshotLocationSpec, VolumeSnapshotLocationStatus>;
export type BackupRepositoryResource = VeleroResource<BackupRepositorySpec, BackupRepositoryStatus>;
export type PodVolumeBackupResource = VeleroResource<PodVolumeBackupSpec, PodVolumeBackupStatus>;
export type PodVolumeRestoreResource = VeleroResource<PodVolumeRestoreSpec, PodVolumeRestoreStatus>;

// The release of Velero the specs were reviewed against, whose CRD schemas these types are written from.
export const REVIEWED_RELEASE = "v1.18.4";

// The labels Velero writes on the objects it creates for another one: a backup repository is named by the three of
// its volume namespace, its location and its type, and an operation by the name and the UID of its owner.
export const LABELS = {
  schedule: "velero.io/schedule-name",
  backup: "velero.io/backup-name",
  backupUid: "velero.io/backup-uid",
  restore: "velero.io/restore-name",
  restoreUid: "velero.io/restore-uid",
  podUid: "velero.io/pod-uid",
  pvcUid: "velero.io/pvc-uid",
  storageLocation: "velero.io/storage-location",
  volumeNamespace: "velero.io/volume-namespace",
  repositoryType: "velero.io/repository-type",
  asyncOperationId: "velero.io/async-operation-id",
} as const;

// The annotation of a pod volume backup of a claim, which names the claim.
export const PVC_NAME_ANNOTATION = "velero.io/pvc-name";
