import { backupView } from "./backup-view";
import { newestFirst, operationTime } from "./operation-time";
import { backupLocation } from "./references";
import { historyCounts } from "./schedule-history";

import type { Defaults } from "./location-view";
import type { FamilyRead } from "./read-state";
import type { HistoryCounts, HistoryItem } from "./schedule-history";
import type { BackupResource, ScheduleResource } from "./types";

// What uses a location: the backups that name it and the schedules whose template names it, in the
// namespace of the location. What could not be read is not known, which is not none.

export type LocationKind = "storage" | "snapshot";

export type Unread = { state: "inaccessible" | "unknown" | "not-read"; reason: string };

export type UsingBackups =
  | {
      state: "listed";
      // The backups are of an earlier read: the last one did not succeed.
      stale: boolean;
      counts: HistoryCounts;
      // The newest of them, by the time of the operation.
      newest?: HistoryItem;
    }
  | Unread;

export type UsingSchedules = { state: "listed"; stale: boolean; names: string[] } | Unread;

// The schedules whose template names no storage location: their backups go to a location marked default.
// With one marked it is that one; with more than one it is the first of them the release finds.
export interface SentByDefault {
  schedules: UsingSchedules;
  certain: boolean;
}

export interface LocationUsers {
  backups: UsingBackups;
  schedules: UsingSchedules;
  // Of a storage location that is marked default, and of no other.
  byDefault?: SentByDefault;
}

export function unread(plural: string, read: FamilyRead<unknown>): Unread {
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

type Named = { storageLocation?: unknown; volumeSnapshotLocations?: unknown } | null | undefined;

function names(spec: Named, storage?: string): { storage?: string; snapshot: string[] } {
  const written = spec?.storageLocation;
  const named = storage ?? (typeof written === "string" && written !== "" ? written : undefined);
  const snapshots = spec?.volumeSnapshotLocations;

  return {
    ...(named === undefined ? {} : { storage: named }),
    snapshot: Array.isArray(snapshots) ? snapshots.filter((name): name is string => typeof name === "string") : [],
  };
}

function uses(named: ReturnType<typeof names>, kind: LocationKind, name: string): boolean {
  return kind === "storage" ? named.storage === name : named.snapshot.includes(name);
}

// Names are put in order by their characters, which is the same on every machine.
function byName(one: string, other: string): number {
  return one < other ? -1 : one > other ? 1 : 0;
}

// `marked` is what is marked default in the installation of a storage location: the location that is
// marked has, beside what names it, the schedules that name none.
export function locationUsers(
  kind: LocationKind,
  location: { metadata: { name: string; namespace?: string } },
  reads: { backups: FamilyRead<BackupResource>; schedules: FamilyRead<ScheduleResource> },
  now: number,
  marked?: Defaults,
): LocationUsers {
  const namespace = location.metadata.namespace ?? "";
  const { name } = location.metadata;
  const read = (family: FamilyRead<unknown>) => family.status === "ready" || family.lastSuccess !== undefined;
  const backups = (): UsingBackups => {
    const items = reads.backups.items
      // The location of a backup is the one a view of the backup leads to: its spec, or its label.
      .filter(
        (backup) =>
          backup.metadata.namespace === namespace && uses(names(backup.spec, backupLocation(backup)), kind, name),
      )
      .sort(newestFirst)
      .map((backup) => ({ view: backupView(backup, now), time: operationTime(backup) }));

    return {
      state: "listed",
      stale: reads.backups.status !== "ready",
      counts: historyCounts(items),
      ...(items.length ? { newest: items[0] } : {}),
    };
  };
  const schedules = (takes: (named: ReturnType<typeof names>) => boolean): UsingSchedules =>
    read(reads.schedules)
      ? {
          state: "listed",
          stale: reads.schedules.status !== "ready",
          names: reads.schedules.items
            .filter((schedule) => schedule.metadata.namespace === namespace && takes(names(schedule.spec?.template)))
            .map((schedule) => schedule.metadata.name)
            .sort(byName),
        }
      : unread("schedules", reads.schedules);
  const sends = kind === "storage" && marked !== undefined && marked.names.includes(name);

  return {
    backups: read(reads.backups) ? backups() : unread("backups", reads.backups),
    schedules: schedules((named) => uses(named, kind, name)),
    ...(sends
      ? {
          byDefault: {
            schedules: schedules((named) => named.storage === undefined),
            certain: marked.state === "one",
          },
        }
      : {}),
  };
}

export const SENT_BY_DEFAULT =
  "Their template names no location: their backups go to the one marked default, which is this one.";
export const MAY_BE_SENT_BY_DEFAULT =
  "Their template names no location, and more than one is marked default: their backups go to the first of them the release finds.";

// The backups that name a location, in words: how many they are and how they ended.
export function usingBackupsText(counts: HistoryCounts): string {
  if (!counts.total) return "No backup that exists names this location";
  const parts = [
    counts.completed ? `${counts.completed} completed` : "",
    counts.failed ? `${counts.failed} ended with a failure` : "",
    counts.inFlight
      ? `${counts.inFlight} in flight${counts.inFlightFailing ? `, ${counts.inFlightFailing} of them with a failure` : ""}`
      : "",
    counts.unknown ? `${counts.unknown} of a state that is not known` : "",
  ].filter(Boolean);

  return `${counts.total} backup${counts.total === 1 ? "" : "s"} that exist${counts.total === 1 ? "s" : ""}: ${parts.join("; ")}`;
}

// What the reviewed release refuses of a storage location that it does not report available.
export const REFUSED_WHEN_NOT_AVAILABLE =
  "The reviewed release refuses the backups sent to a storage location that it does not report Available, and the restores of the backups the location holds.";
