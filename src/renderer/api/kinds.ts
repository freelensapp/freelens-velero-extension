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

// The kinds of Velero, as the host reads them: the static fields of each class, for the version the cluster
// serves. The objects the host hands over are its own, made from the data of the API, so a method of an
// instance would not be there at run time: what is derived from an object is in the helpers of common. The
// instance `kind` and `apiVersion` are declared as the literals of each class, which ties a section of the
// details to its kind (`detailsFor`), and `declare` emits nothing: a field would be defined after the
// constructor of the host gave the object its data, and would reset them (docs/extensions/api.md, C6, lines
// 474 to 483 at the validation target). No class here extends `KubeApi` or `KubeObjectStore`: the views
// read the cluster through the reader, and the lists of the host through the store of a list of the
// extension.

export class Backup extends Renderer.K8sApi.LensExtensionKubeObject<Metadata, BackupStatus, BackupSpec> {
  declare kind: "Backup";
  declare apiVersion: "velero.io/v1";

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

export class Restore extends Renderer.K8sApi.LensExtensionKubeObject<Metadata, RestoreStatus, RestoreSpec> {
  declare kind: "Restore";
  declare apiVersion: "velero.io/v1";

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

export class Schedule extends Renderer.K8sApi.LensExtensionKubeObject<Metadata, ScheduleStatus, ScheduleSpec> {
  declare kind: "Schedule";
  declare apiVersion: "velero.io/v1";

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

export class BackupStorageLocation extends Renderer.K8sApi.LensExtensionKubeObject<
  Metadata,
  BackupStorageLocationStatus,
  BackupStorageLocationSpec
> {
  declare kind: "BackupStorageLocation";
  declare apiVersion: "velero.io/v1";

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

export class VolumeSnapshotLocation extends Renderer.K8sApi.LensExtensionKubeObject<
  Metadata,
  VolumeSnapshotLocationStatus,
  VolumeSnapshotLocationSpec
> {
  declare kind: "VolumeSnapshotLocation";
  declare apiVersion: "velero.io/v1";

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
