import { BackupWorkspace } from "./backup-workspace";
import { RepositoryWorkspace } from "./repository-workspace";
import { RestoreWorkspace } from "./restore-workspace";
import { ScheduleWorkspace } from "./schedule-workspace";
import { SnapshotLocationWorkspace } from "./snapshot-location-workspace";
import { StorageLocationWorkspace } from "./storage-location-workspace";
import { VolumeOperationWorkspace } from "./volume-operation-workspace";

import type { OpenViewProps } from "../components/family-page";

// The view of one object, of the kind the address names. Every page shows it over its own list: a view
// opened from another one does not leave the list the first was opened from.
export function OpenView({ target, ...props }: OpenViewProps) {
  switch (target.kind) {
    case "restore":
      return <RestoreWorkspace name={target.name} {...props} />;
    case "schedule":
      return <ScheduleWorkspace name={target.name} {...props} />;
    case "storage-location":
      return <StorageLocationWorkspace name={target.name} {...props} />;
    case "snapshot-location":
      return <SnapshotLocationWorkspace name={target.name} {...props} />;
    case "backup-repository":
      return <RepositoryWorkspace name={target.name} {...props} />;
    case "pod-volume-backup":
      return <VolumeOperationWorkspace volume="PodVolumeBackup" name={target.name} {...props} />;
    case "pod-volume-restore":
      return <VolumeOperationWorkspace volume="PodVolumeRestore" name={target.name} {...props} />;
    default:
      return <BackupWorkspace name={target.name} {...props} />;
  }
}
