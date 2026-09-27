import { Renderer } from "@freelensapp/extensions";
import { VELERO_API_VERSION } from "../../common/paths";

import type {
  BackupSpec,
  BackupStatus,
  BackupStorageLocationSpec,
  BackupStorageLocationStatus,
  RestoreSpec,
  RestoreStatus,
  ScheduleSpec,
  ScheduleStatus,
  VolumeSnapshotLocationSpec,
  VolumeSnapshotLocationStatus,
} from "../../common/types";

// What the host asks of a kind, and the title of its page.
export interface VeleroCrd extends Renderer.K8sApi.LensExtensionKubeObjectCRD {
  title: string;
}

type Metadata = Renderer.K8sApi.KubeObjectMetadata;

// The host reads the static fields of these classes and hands over plain copies of the objects: a method of
// an instance would not be there at run time. What is derived from an object is in the helpers of common.

export class Backup extends Renderer.K8sApi.LensExtensionKubeObject<Metadata, BackupStatus, BackupSpec> {
  static readonly kind = "Backup";
  static readonly namespaced = true;
  static readonly apiBase = `/apis/${VELERO_API_VERSION}/backups`;
  static readonly crd: VeleroCrd = {
    apiVersions: [VELERO_API_VERSION],
    plural: "backups",
    singular: "backup",
    shortNames: [],
    title: "Backups",
  };
}

export class BackupApi extends Renderer.K8sApi.KubeApi<Backup> {}
export class BackupStore extends Renderer.K8sApi.KubeObjectStore<Backup, BackupApi> {}

export class Restore extends Renderer.K8sApi.LensExtensionKubeObject<Metadata, RestoreStatus, RestoreSpec> {
  static readonly kind = "Restore";
  static readonly namespaced = true;
  static readonly apiBase = `/apis/${VELERO_API_VERSION}/restores`;
  static readonly crd: VeleroCrd = {
    apiVersions: [VELERO_API_VERSION],
    plural: "restores",
    singular: "restore",
    shortNames: [],
    title: "Restores",
  };
}

export class RestoreApi extends Renderer.K8sApi.KubeApi<Restore> {}
export class RestoreStore extends Renderer.K8sApi.KubeObjectStore<Restore, RestoreApi> {}

export class Schedule extends Renderer.K8sApi.LensExtensionKubeObject<Metadata, ScheduleStatus, ScheduleSpec> {
  static readonly kind = "Schedule";
  static readonly namespaced = true;
  static readonly apiBase = `/apis/${VELERO_API_VERSION}/schedules`;
  static readonly crd: VeleroCrd = {
    apiVersions: [VELERO_API_VERSION],
    plural: "schedules",
    singular: "schedule",
    shortNames: [],
    title: "Schedules",
  };
}

export class ScheduleApi extends Renderer.K8sApi.KubeApi<Schedule> {}
export class ScheduleStore extends Renderer.K8sApi.KubeObjectStore<Schedule, ScheduleApi> {}

export class BackupStorageLocation extends Renderer.K8sApi.LensExtensionKubeObject<
  Metadata,
  BackupStorageLocationStatus,
  BackupStorageLocationSpec
> {
  static readonly kind = "BackupStorageLocation";
  static readonly namespaced = true;
  static readonly apiBase = `/apis/${VELERO_API_VERSION}/backupstoragelocations`;
  static readonly crd: VeleroCrd = {
    apiVersions: [VELERO_API_VERSION],
    plural: "backupstoragelocations",
    singular: "backupstoragelocation",
    shortNames: ["bsl"],
    title: "Backup Storage Locations",
  };
}

export class BackupStorageLocationApi extends Renderer.K8sApi.KubeApi<BackupStorageLocation> {}
export class BackupStorageLocationStore extends Renderer.K8sApi.KubeObjectStore<
  BackupStorageLocation,
  BackupStorageLocationApi
> {}

export class VolumeSnapshotLocation extends Renderer.K8sApi.LensExtensionKubeObject<
  Metadata,
  VolumeSnapshotLocationStatus,
  VolumeSnapshotLocationSpec
> {
  static readonly kind = "VolumeSnapshotLocation";
  static readonly namespaced = true;
  static readonly apiBase = `/apis/${VELERO_API_VERSION}/volumesnapshotlocations`;
  static readonly crd: VeleroCrd = {
    apiVersions: [VELERO_API_VERSION],
    plural: "volumesnapshotlocations",
    singular: "volumesnapshotlocation",
    shortNames: ["vsl"],
    title: "Volume Snapshot Locations",
  };
}

export class VolumeSnapshotLocationApi extends Renderer.K8sApi.KubeApi<VolumeSnapshotLocation> {}
export class VolumeSnapshotLocationStore extends Renderer.K8sApi.KubeObjectStore<
  VolumeSnapshotLocation,
  VolumeSnapshotLocationApi
> {}
