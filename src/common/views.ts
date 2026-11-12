// The views of one object that the extension has, and how the address of a page names the ones that are
// open. The address holds them in the order they were opened: the last one is shown, and the way back leads
// to the one before it, or to the list when there is none.

import { BACKUPS_AND_LOCATIONS } from "./discovery";

import type { Family } from "./discovery";

export const VIEW_KINDS = [
  "backup",
  "restore",
  "schedule",
  "storage-location",
  "snapshot-location",
  "backup-repository",
  "pod-volume-backup",
  "pod-volume-restore",
  "data-upload",
  "data-download",
  "backup-now",
  "backup-create",
  "schedule-create",
  "restore-backup",
  "restore-schedule",
  "schedule-pause",
  "schedule-resume",
  "backup-delete",
] as const;
export type ViewKind = (typeof VIEW_KINDS)[number];

export interface ViewTarget {
  kind: ViewKind;
  name: string;
}

// What is read of the installation to show a view of each kind, and how the kind is called. A view shows
// something of the families it reads: what is missing of the others is not said over it. A family of the
// operations of the volumes is read while a view that reads it is open, and only then. Each view reads the
// families it shows, and no other: the families read at every read are asked whatever view is open, and a view
// that reads fewer of them asks no less of the cluster. A backup and a restore are shown with the band of their
// operations of the volumes, the pod volume operations and the data movement of their own kind.
export const VIEWS: Record<
  ViewKind,
  { family: Family; reads: readonly Family[]; title: string; noun: string; plural: string }
> = {
  backup: {
    family: "backups",
    reads: [...BACKUPS_AND_LOCATIONS, "podVolumeBackups", "dataUploads"],
    title: "Backups",
    noun: "backup",
    plural: "backups",
  },
  restore: {
    family: "restores",
    reads: [...BACKUPS_AND_LOCATIONS, "podVolumeRestores", "dataDownloads"],
    title: "Restores",
    noun: "restore",
    plural: "restores",
  },
  schedule: {
    family: "schedules",
    reads: BACKUPS_AND_LOCATIONS,
    title: "Schedules",
    noun: "schedule",
    plural: "schedules",
  },
  // A location is shown with what uses it, which is the backups and the schedules that name it.
  "storage-location": {
    family: "storageLocations",
    reads: ["backups", "schedules", "storageLocations"],
    title: "Backup Storage Locations",
    noun: "backup storage location",
    plural: "backup storage locations",
  },
  "snapshot-location": {
    family: "snapshotLocations",
    reads: ["backups", "schedules", "snapshotLocations"],
    title: "Volume Snapshot Locations",
    noun: "volume snapshot location",
    plural: "volume snapshot locations",
  },
  // A repository is shown with the location it is kept in, and with what used it: the operations of the volumes that
  // wrote into it or read from it, and the backups and the restores they belong to.
  "backup-repository": {
    family: "backupRepositories",
    reads: [
      "backupRepositories",
      "storageLocations",
      "podVolumeBackups",
      "podVolumeRestores",
      "dataUploads",
      "dataDownloads",
      "backups",
      "restores",
    ],
    title: "Backup Repositories",
    noun: "backup repository",
    plural: "backup repositories",
  },
  // An operation of the volumes is shown with its owner, the location it goes to and the repository it uses.
  "pod-volume-backup": {
    family: "podVolumeBackups",
    reads: ["podVolumeBackups", "backups", "storageLocations", "backupRepositories"],
    title: "Pod Volume Backups",
    noun: "pod volume backup",
    plural: "pod volume backups",
  },
  "pod-volume-restore": {
    family: "podVolumeRestores",
    reads: ["podVolumeRestores", "restores", "storageLocations", "backupRepositories"],
    title: "Pod Volume Restores",
    noun: "pod volume restore",
    plural: "pod volume restores",
  },
  "data-upload": {
    family: "dataUploads",
    reads: ["dataUploads", "backups", "storageLocations", "backupRepositories"],
    title: "Data Uploads",
    noun: "data upload",
    plural: "data uploads",
  },
  // A data download is shown with the data upload whose snapshot it restores, when one is found.
  "data-download": {
    family: "dataDownloads",
    reads: ["dataDownloads", "dataUploads", "restores", "storageLocations", "backupRepositories"],
    title: "Data Downloads",
    noun: "data download",
    plural: "data downloads",
  },
  // The workspace of a backup asked from a schedule by hand is of the schedule, by its name: it reads what the view of
  // the schedule reads, and says of the schedule what a view says of what it shows.
  "backup-now": {
    family: "schedules",
    reads: BACKUPS_AND_LOCATIONS,
    title: "Back up now",
    noun: "schedule",
    plural: "schedules",
  },
  // The workspace of a backup of the form is of no object: it is opened over the list of the Backups, and reads the
  // locations it offers and the backups whose names it says are taken.
  "backup-create": {
    family: "backups",
    reads: BACKUPS_AND_LOCATIONS,
    title: "Create backup",
    noun: "backup",
    plural: "backups",
  },
  // The workspace of a schedule of the form is of no object: it is opened over the list of the Schedules, and reads the
  // locations it offers, the schedules whose names it says are taken, and the backups the offset of the server is
  // derived from.
  "schedule-create": {
    family: "schedules",
    reads: BACKUPS_AND_LOCATIONS,
    title: "Create schedule",
    noun: "schedule",
    plural: "schedules",
  },
  // The workspace of a restore is of the backup it is asked from, by its name, or of the schedule whose backups it
  // offers: it reads the backups, the restores whose names it says are taken, and the storage locations.
  "restore-backup": {
    family: "backups",
    reads: BACKUPS_AND_LOCATIONS,
    title: "Restore",
    noun: "backup",
    plural: "backups",
  },
  // The workspace of the deletion of a backup is of the backup, by its name: it reads what the view of the backup
  // reads, whose storage location the review names.
  "backup-delete": {
    family: "backups",
    reads: BACKUPS_AND_LOCATIONS,
    title: "Delete backup",
    noun: "backup",
    plural: "backups",
  },
  "restore-schedule": {
    family: "schedules",
    reads: BACKUPS_AND_LOCATIONS,
    title: "Restore",
    noun: "schedule",
    plural: "schedules",
  },
  // The workspace of a pause or of a resume is of the schedule, by its name: it reads what the view of the schedule
  // reads, whose backups and offset say what a resume would do.
  "schedule-pause": {
    family: "schedules",
    reads: BACKUPS_AND_LOCATIONS,
    title: "Pause schedule",
    noun: "schedule",
    plural: "schedules",
  },
  "schedule-resume": {
    family: "schedules",
    reads: BACKUPS_AND_LOCATIONS,
    title: "Resume schedule",
    noun: "schedule",
    plural: "schedules",
  },
};

// How many views the address keeps: a path longer than this loses where it started from.
export const DEPTH = 8;

function kind(value: string): value is ViewKind {
  return (VIEW_KINDS as readonly string[]).includes(value);
}

// The name of an object of Kubernetes, which is what a view is asked by.
function named(value: string): boolean {
  return value.length > 0 && value.length <= 253 && /^[a-z0-9]([-a-z0-9.]*[a-z0-9])?$/.test(value);
}

export function encodeView(target: ViewTarget): string {
  return `${target.kind}/${target.name}`;
}

// A view as the address names it, or nothing: what is not the name of a view opens none.
export function decodeView(value: unknown): ViewTarget | undefined {
  if (typeof value !== "string") return undefined;
  const at = value.indexOf("/");
  const first = value.slice(0, at);
  const name = value.slice(at + 1);

  return at > 0 && kind(first) && named(name) ? { kind: first, name } : undefined;
}

export function sameView(one: ViewTarget | undefined, other: ViewTarget | undefined): boolean {
  return one !== undefined && other !== undefined && one.kind === other.kind && one.name === other.name;
}

// The views an address names, without what is not one and without a view twice in a row.
export function decodeViews(values: unknown): ViewTarget[] {
  const path: ViewTarget[] = [];

  for (const value of Array.isArray(values) ? values : [values]) {
    const target = decodeView(value);

    if (target && !sameView(path[path.length - 1], target)) path.push(target);
  }
  return path.slice(-DEPTH);
}

// The path after a view is opened from the one that is shown. A view that is already on the path is gone
// back to: following a backup to its restore and the restore to its backup does not make the way longer.
export function openedFrom(path: ViewTarget[], target: ViewTarget): ViewTarget[] {
  const at = path.findIndex((view) => sameView(view, target));

  return (at === -1 ? [...path, target] : path.slice(0, at + 1)).slice(-DEPTH);
}

// The path after the way back is taken.
export function closed(path: ViewTarget[]): ViewTarget[] {
  return path.slice(0, -1);
}

// The path after the view that is shown gives its place to another: the workspace of an action to the view of what
// it created, whose way back leads where the workspace was opened from.
export function replaced(path: ViewTarget[], target: ViewTarget): ViewTarget[] {
  return openedFrom(closed(path), target);
}
