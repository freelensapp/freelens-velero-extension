// The views of one object that the extension has, and how the address of a page names the ones that are
// open. The address holds them in the order they were opened: the last one is shown, and the way back leads
// to the one before it, or to the list when there is none.

import { FAMILIES } from "./discovery";

import type { Family } from "./discovery";

export const VIEW_KINDS = ["backup", "restore", "schedule", "storage-location", "snapshot-location"] as const;
export type ViewKind = (typeof VIEW_KINDS)[number];

export interface ViewTarget {
  kind: ViewKind;
  name: string;
}

// What is read of the installation to show a view of each kind, and how the kind is called. A view shows
// something of the families it reads: what is missing of the others is not said over it.
export const VIEWS: Record<ViewKind, { family: Family; reads: readonly Family[]; title: string; noun: string }> = {
  backup: { family: "backups", reads: FAMILIES, title: "Backups", noun: "backup" },
  restore: { family: "restores", reads: FAMILIES, title: "Restores", noun: "restore" },
  schedule: { family: "schedules", reads: FAMILIES, title: "Schedules", noun: "schedule" },
  // A location is shown with what uses it, which is the backups and the schedules that name it.
  "storage-location": {
    family: "storageLocations",
    reads: ["backups", "schedules", "storageLocations"],
    title: "Backup Storage Locations",
    noun: "backup storage location",
  },
  "snapshot-location": {
    family: "snapshotLocations",
    reads: ["backups", "schedules", "snapshotLocations"],
    title: "Volume Snapshot Locations",
    noun: "volume snapshot location",
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
