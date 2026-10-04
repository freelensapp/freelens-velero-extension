// The fields of the Velero kinds the extension reads, written from the CRD schemas of Velero v1.18.2.
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
  // Of the release after the reviewed one: read when the object carries it, never asked for.
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

export type BackupResource = VeleroResource<BackupSpec, BackupStatus>;
export type RestoreResource = VeleroResource<RestoreSpec, RestoreStatus>;
export type ScheduleResource = VeleroResource<ScheduleSpec, ScheduleStatus>;
export type BackupStorageLocationResource = VeleroResource<BackupStorageLocationSpec, BackupStorageLocationStatus>;
export type VolumeSnapshotLocationResource = VeleroResource<VolumeSnapshotLocationSpec, VolumeSnapshotLocationStatus>;

// The release of Velero the specs were reviewed against, whose CRD schemas these types are written from.
export const REVIEWED_RELEASE = "v1.18.2";

// The labels Velero writes on the objects it creates for another one.
export const LABELS = {
  schedule: "velero.io/schedule-name",
  backup: "velero.io/backup-name",
  restore: "velero.io/restore-name",
  storageLocation: "velero.io/storage-location",
} as const;
