import { backupView } from "./backup-view";
import { MARK_GAP, operationLine } from "./operation-line";
import { newestFirst, operationTime } from "./operation-time";
import { LABELS } from "./types";

import type { BackupView } from "./backup-view";
import type { Line, LineMark } from "./operation-line";
import type { OperationTime } from "./operation-time";
import type { FamilyRead } from "./read-state";
import type { BackupResource } from "./types";

export interface HistoryItem {
  view: BackupView;
  time: OperationTime;
}

// How the backups of a history ended, by what each one reports. The numbers are of the backups that exist:
// a backup that expired, or that was deleted, is not among them.
export interface HistoryCounts {
  total: number;
  completed: number;
  // Ended with a failure.
  failed: number;
  inFlight: number;
  // Of the ones in flight, the ones that carry a failure.
  inFlightFailing: number;
  // A phase that is not known, not reported, or a deletion.
  unknown: number;
}

export type History =
  | {
      state: "listed";
      // The backups are of an earlier read: the last one did not succeed.
      stale: boolean;
      // From the newest, by the time of the operation.
      items: HistoryItem[];
      counts: HistoryCounts;
    }
  // The backups were not read: the history is not known, which is not that it is empty.
  | { state: "inaccessible" | "unknown" | "not-read"; reason: string };

function unavailable(read: FamilyRead<unknown>): Exclude<History, { state: "listed" }> {
  switch (read.status) {
    case "forbidden":
      return { state: "inaccessible", reason: "The backups of this installation cannot be read: access is denied" };
    case "not-served":
      return { state: "unknown", reason: "The cluster does not serve the backups" };
    case "failed":
      return { state: "unknown", reason: "The backups of this installation could not be read" };
    default:
      return { state: "not-read", reason: "The backups of this installation were not read yet" };
  }
}

export function historyCounts(items: HistoryItem[]): HistoryCounts {
  const counts = { total: items.length, completed: 0, failed: 0, inFlight: 0, inFlightFailing: 0, unknown: 0 };

  for (const { view } of items) {
    const failing = view.evidence.signal === "failure";

    if (view.state.lifecycle === "in-flight") {
      counts.inFlight += 1;
      if (failing) counts.inFlightFailing += 1;
    } else if (view.state.lifecycle !== "terminal") {
      counts.unknown += 1;
    } else if (failing) {
      counts.failed += 1;
    } else {
      counts.completed += 1;
    }
  }
  return counts;
}

// The backups of one read by the schedule they carry in their label, from the newest. They are put in order
// once for each read: a list asks for the history of every schedule it shows, each time it is drawn.
const bySchedule = new WeakMap<BackupResource[], Map<string, BackupResource[]>>();

export function backupsOf(items: BackupResource[], namespace: string, schedule: string): BackupResource[] {
  let index = bySchedule.get(items);

  if (!index) {
    index = new Map();
    for (const backup of items) {
      const named = backup.metadata.labels?.[LABELS.schedule];

      if (typeof named !== "string" || named === "") continue;
      const key = `${backup.metadata.namespace ?? ""}/${named}`;

      index.set(key, [...(index.get(key) ?? []), backup]);
    }
    for (const list of index.values()) list.sort(newestFirst);
    bySchedule.set(items, index);
  }
  return index.get(`${namespace}/${schedule}`) ?? [];
}

// The backups of a schedule: the ones of its namespace that carry its name in the label Velero writes on the
// backups it makes from a schedule. The name of a backup is not what tells whose it is.
export function scheduleHistory(
  schedule: { metadata: { name: string; namespace?: string } },
  backups: FamilyRead<BackupResource>,
  now: number,
): History {
  if (backups.status !== "ready" && backups.lastSuccess === undefined) return unavailable(backups);
  const items = backupsOf(backups.items, schedule.metadata.namespace ?? "", schedule.metadata.name).map((backup) => ({
    view: backupView(backup, now),
    time: operationTime(backup),
  }));

  return { state: "listed", stale: backups.status !== "ready", items, counts: historyCounts(items) };
}

// The reviewed release submits no backup of a schedule while one of its backups, whichever, reports no
// phase, New or InProgress.
export function holdsSubmissions(items: HistoryItem[]): boolean {
  return items.some(
    ({ view }) => view.state.reported === undefined || ["New", "InProgress"].includes(view.state.reported),
  );
}

export function countsText(counts: HistoryCounts): string {
  if (!counts.total) return "No backup of this schedule is among the ones that exist";
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

// One mark of the line of time: a backup, or the backups that would be drawn over each other.
export type StripMark = LineMark<HistoryItem>;
export type Strip = Line<HistoryItem>;

export { MARK_GAP };

// Where each backup of a history is on a line of time of a given width: the line of the operations, from
// the oldest backup that exists to now.
export function historyStrip(items: HistoryItem[], now: number, width: number, gap = MARK_GAP): Strip | undefined {
  return operationLine(items, now, width, { gap });
}
