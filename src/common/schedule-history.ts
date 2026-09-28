import { backupView } from "./backup-view";
import { newestFirst, operationTime } from "./operation-time";
import { LABELS } from "./types";

import type { BackupView } from "./backup-view";
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

function backupsOf(items: BackupResource[], namespace: string, schedule: string): BackupResource[] {
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
export interface StripMark {
  // Where the mark is between the two ends of the line, from 0 to 1.
  at: number;
  // From the newest.
  items: HistoryItem[];
  // One of them carries a failure.
  failing: boolean;
  inFlight: boolean;
  // One of them did not start: it is at the time it was created.
  notStarted: boolean;
}

export interface Strip {
  // The two ends of the line: the time of the oldest backup that is drawn, and now.
  from: number;
  to: number;
  // From the oldest, as they are read along the line.
  marks: StripMark[];
  // The backups that have no time: they are in the list, and not on the line.
  undrawn: HistoryItem[];
}

// How far from each other two marks are drawn at least, in the units of the width: the width of a mark, and
// what tells it from the one beside it.
export const MARK_GAP = 28;

// Where each backup is on a line of time of a given width, in the units the width is given in. Two marks
// closer than `gap` would be drawn over each other: they are one mark, which says how many they are.
// Nothing is made for the time between two backups: not a missed run, not an expected one. The line ends
// now, or at the newest backup when the clock of the cluster is ahead of the one that draws the line.
export function historyStrip(items: HistoryItem[], now: number, width: number, gap = MARK_GAP): Strip | undefined {
  const timed = items
    .filter((item): item is HistoryItem & { time: { time: number } } => item.time.of !== "none")
    // Inside a mark the backups are from the newest, and the ones of the same time by their names.
    .sort((one, other) => one.time.time - other.time.time || other.view.name.localeCompare(one.view.name));
  const drawn = new Set<HistoryItem>(timed);
  const undrawn = items.filter((item) => !drawn.has(item));

  if (!timed.length) return undefined;
  const from = timed[0].time.time;
  const to = Math.max(now, timed[timed.length - 1].time.time);
  const span = Math.max(to - from, 1);
  const room = Math.max(width, 1);
  const marks: StripMark[] = [];
  let first = 0;

  for (const item of timed) {
    const at = (item.time.time - from) / span;
    const last = marks[marks.length - 1];
    const failing = item.view.evidence.signal === "failure";
    const inFlight = item.view.state.lifecycle === "in-flight";
    const notStarted = item.time.of === "creation" && item.view.state.execution === "not-started";

    // The distance is from the first backup of the mark: a mark does not grow along the line.
    if (last && (at - first) * room < gap) {
      last.items.unshift(item);
      last.failing ||= failing;
      last.inFlight ||= inFlight;
      last.notStarted ||= notStarted;
    } else {
      first = at;
      marks.push({ at, items: [item], failing, inFlight, notStarted });
    }
  }
  return { from, to, marks, undrawn };
}
