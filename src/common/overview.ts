import { backupView } from "./backup-view";
import { timestamp } from "./duration";
import { unread } from "./location-users";
import {
  defaults,
  frequencyNote,
  lateNote,
  NEVER_VALIDATED,
  storageLocationView,
  validationAge,
} from "./location-view";
import { phaseText, signalText } from "./operation-text";
import { newestFirst, operationTime } from "./operation-time";
import { hasItems, isStale } from "./read-state";
import { locationWarning } from "./references";
import { restoreView } from "./restore-view";
import { backupsOf } from "./schedule-history";
import { NOTES, scheduleView } from "./schedule-view";
import { WINDOW_LENGTH } from "./window";

import type { BackupView } from "./backup-view";
import type { Family } from "./discovery";
import type { Unread } from "./location-users";
import type { StorageLocationView } from "./location-view";
import type { OperationTime } from "./operation-time";
import type { FamilyRead, ReadStatus } from "./read-state";
import type { RestoreView } from "./restore-view";
import type { ScheduleView } from "./schedule-view";
import type {
  BackupResource,
  BackupStorageLocationResource,
  RestoreResource,
  ScheduleResource,
  VolumeSnapshotLocationResource,
} from "./types";
import type { ViewKind, ViewTarget } from "./views";
import type { Window } from "./window";

// What the Overview says of an installation, from the five lists that were read of it and from nothing
// else. It gives no value for the installation as a whole: what needs attention is a list of items, each
// of one rule and of the objects the rule read, beside what was read and what was not.

export interface OverviewReads {
  backups: FamilyRead<BackupResource>;
  restores: FamilyRead<RestoreResource>;
  schedules: FamilyRead<ScheduleResource>;
  storageLocations: FamilyRead<BackupStorageLocationResource>;
  snapshotLocations: FamilyRead<VolumeSnapshotLocationResource>;
}

export { DEFAULT_WINDOW, readWindow, WINDOW_LENGTH, WINDOW_TITLES, WINDOWS } from "./window";

export type { Window } from "./window";

// Names are put in order by their characters, which is the same on every machine.
function byName(one: string, other: string): number {
  return one < other ? -1 : one > other ? 1 : 0;
}

const KINDS: Record<Family, ViewKind> = {
  backups: "backup",
  restores: "restore",
  schedules: "schedule",
  storageLocations: "storage-location",
  snapshotLocations: "snapshot-location",
};
const PLURALS: Record<Family, string> = {
  backups: "backups",
  restores: "restores",
  schedules: "schedules",
  storageLocations: "backup storage locations",
  snapshotLocations: "volume snapshot locations",
};

// What was read of a family: the number of its objects when it was read, its state when it was not.
export type Coverage = { family: Family; kind: ViewKind } & (
  | { state: "read"; count: number }
  // The objects are of an earlier read: the last one did not succeed.
  | { state: "stale"; count: number; at: number; status: ReadStatus }
  | { state: "denied" | "not-served" | "failed" | "not-read" }
);

const NOT_READ: Record<ReadStatus, "denied" | "not-served" | "failed" | "not-read"> = {
  forbidden: "denied",
  "not-served": "not-served",
  failed: "failed",
  idle: "not-read",
  loading: "not-read",
  ready: "not-read",
};

export function coverage(reads: OverviewReads): Coverage[] {
  return (Object.keys(KINDS) as Family[]).map((family) => {
    const read = reads[family];
    const of = { family, kind: KINDS[family] };

    if (read.status === "ready") return { ...of, state: "read", count: read.items.length };
    if (isStale(read)) {
      return { ...of, state: "stale", count: read.items.length, at: read.lastSuccess ?? 0, status: read.status };
    }
    return { ...of, state: NOT_READ[read.status] };
  });
}

export const COVERAGE_WORDS: Record<Exclude<Coverage["state"], "read" | "stale">, string> = {
  denied: "Access denied",
  "not-served": "Not served by the cluster",
  failed: "Could not be read",
  "not-read": "Not read yet",
};

// What is said of a family whose objects are of an earlier read, by what the last read answered.
export const STALE_WORDS: Partial<Record<ReadStatus, string>> = {
  forbidden: "access is denied since then",
  "not-served": "the cluster does not serve them since then",
  failed: "they could not be read since then",
};

// A part of the page that is made from one family: what was read of it, or why it was not.
export type Part<Item> = { state: "listed"; stale: boolean; at?: number; items: Item[] } | Unread;

function part<Resource, Item>(
  family: Family,
  read: FamilyRead<Resource>,
  make: (items: Resource[]) => Item[],
): Part<Item> {
  if (!hasItems(read)) return unread(PLURALS[family], read);
  return {
    state: "listed",
    stale: read.status !== "ready",
    ...(read.lastSuccess === undefined ? {} : { at: read.lastSuccess }),
    items: make(read.items),
  };
}

// A backup or a restore, with the time it is placed at.
export type Operation =
  | { kind: "backup"; view: BackupView; time: OperationTime }
  | { kind: "restore"; view: RestoreView; time: OperationTime };

interface Operations {
  backups: Part<Operation>;
  restores: Part<Operation>;
}

// The operations of a read, with the clock they were made with. What needs attention, what is in flight and
// the recent operations are made from the same ones: they are made once for a read and a clock, and not
// once for each of the three.
let made: { key: unknown[]; operations: Operations } | undefined;

function operationsOf(reads: OverviewReads, now: number): Operations {
  const key = [
    reads.backups.items,
    reads.backups.status,
    reads.backups.lastSuccess,
    reads.restores.items,
    reads.restores.status,
    reads.restores.lastSuccess,
    now,
  ];

  if (made?.key.every((value, index) => value === key[index])) return made.operations;
  const operations = {
    backups: part("backups", reads.backups, (items) =>
      items.map((item) => ({ kind: "backup" as const, view: backupView(item, now), time: operationTime(item) })),
    ),
    restores: part("restores", reads.restores, (items) =>
      items.map((item) => ({ kind: "restore" as const, view: restoreView(item, now), time: operationTime(item) })),
    ),
  };

  made = { key, operations };
  return operations;
}

function only<Item>(found: Part<Item>, keep: (item: Item) => boolean): Part<Item> {
  return found.state === "listed" ? { ...found, items: found.items.filter(keep) } : found;
}

// From the oldest by the time of the operation: what waits for longer is read first. What has no time
// goes last, by its name.
function oldestFirst(one: Operation, other: Operation): number {
  if (one.time.of === "none" || other.time.of === "none") {
    if (one.time.of !== other.time.of) return one.time.of === "none" ? 1 : -1;
    return byName(one.view.name, other.view.name);
  }
  return one.time.time - other.time.time || byName(one.view.name, other.view.name);
}

function newestOperationFirst(one: Operation, other: Operation): number {
  if (one.time.of === "none" || other.time.of === "none") {
    if (one.time.of !== other.time.of) return one.time.of === "none" ? 1 : -1;
    return byName(one.view.name, other.view.name);
  }
  return other.time.time - one.time.time || byName(one.view.name, other.view.name);
}

// The backups and the restores in flight, the ones that wait among them.
export interface InFlight {
  backups: Part<Operation>;
  restores: Part<Operation>;
  // The ones of both kinds that were read, from the oldest.
  items: Operation[];
}

export function inFlight(reads: OverviewReads, now: number): InFlight {
  const all = operationsOf(reads, now);
  const flying = (operation: Operation) => operation.view.state.lifecycle === "in-flight";
  const backups = only(all.backups, flying);
  const restores = only(all.restores, flying);

  return {
    backups,
    restores,
    items: [
      ...(backups.state === "listed" ? backups.items : []),
      ...(restores.state === "listed" ? restores.items : []),
    ].sort(oldestFirst),
  };
}

// The newest backup that completed, by the time it completed. Completed is what Velero reports of a
// backup: it is not a test of a restore.
export type NewestCompleted =
  | { state: "found"; stale: boolean; backup: BackupView; completed?: number }
  // None among the backups that exist.
  | { state: "none"; stale: boolean }
  | Unread;

export const COMPLETED_NOTE =
  "Completed is what Velero reports of a backup. It is not a test of a restore: nothing here says that a backup can be restored.";

function completedFirst(one: BackupResource, other: BackupResource): number {
  const first = timestamp(one.status?.completionTimestamp);
  const second = timestamp(other.status?.completionTimestamp);

  // One that completed and does not say when goes after the ones that say it.
  if (first === undefined || second === undefined) {
    if (first !== second) return first === undefined ? 1 : -1;
    return newestFirst(one, other);
  }
  return second - first || byName(one.metadata.name, other.metadata.name);
}

export function newestCompleted(
  backups: FamilyRead<BackupResource>,
  now: number,
  schedule?: { name: string; namespace: string },
): NewestCompleted {
  if (!hasItems(backups)) return unread(PLURALS.backups, backups);
  const stale = backups.status !== "ready";
  // The backups of a schedule are the ones of its namespace that carry its name in their label.
  const among = schedule === undefined ? backups.items : backupsOf(backups.items, schedule.namespace, schedule.name);
  let newest: BackupResource | undefined;

  // The first of them is looked for, and the others are not put in order for it.
  for (const backup of among) {
    if (backup.status?.phase !== "Completed") continue;
    if (newest === undefined || completedFirst(backup, newest) < 0) newest = backup;
  }
  if (!newest) return { state: "none", stale };
  const view = backupView(newest, now);

  return {
    state: "found",
    stale,
    backup: view,
    ...(view.completed === undefined ? {} : { completed: view.completed }),
  };
}

// The operations whose time is in the window, in two rows: the backups and the restores.
export interface Recent {
  window: Window;
  from: number;
  backups: Part<Operation>;
  restores: Part<Operation>;
  // The ones of both kinds that were read, from the newest.
  items: Operation[];
  // The ones that report no time, which a window cannot hold: they are in the lists of their kind.
  untimed: number;
}

export function recent(reads: OverviewReads, now: number, window: Window): Recent {
  const all = operationsOf(reads, now);
  const from = now - WINDOW_LENGTH[window];
  // An operation with a time after the clock of this machine is of the window: the clock of the cluster
  // may be ahead.
  const inside = (operation: Operation) => operation.time.of !== "none" && operation.time.time >= from;
  const backups = only(all.backups, inside);
  const restores = only(all.restores, inside);
  const read = [all.backups, all.restores].flatMap((found) => (found.state === "listed" ? found.items : []));

  return {
    window,
    from,
    backups,
    restores,
    items: [
      ...(backups.state === "listed" ? backups.items : []),
      ...(restores.state === "listed" ? restores.items : []),
    ].sort(newestOperationFirst),
    untimed: read.filter((operation) => operation.time.of === "none").length,
  };
}

// What needs attention. Each item is of one rule, names its object and its reason, and leads to the object,
// or to the list of its kind when it is of no single object.
export const RULES = ["A1", "A2", "A3", "A4", "A5", "A6", "A7", "A8", "A9", "A10"] as const;
export type Rule = (typeof RULES)[number];
export type Group = "in-flight" | "storage" | "schedules" | "ended";

export const GROUPS: Group[] = ["in-flight", "storage", "schedules", "ended"];
export const GROUP_TITLES: Record<Group, string> = {
  "in-flight": "In flight",
  storage: "Storage",
  schedules: "Schedules",
  ended: "Ended",
};

export interface AttentionItem {
  rule: Rule;
  group: Group;
  // The kind of the object, or of the list the item leads to.
  kind: ViewKind;
  // The object the item is of. Absent when the item is of no single object: it leads to the list.
  name?: string;
  // What the item names, in words: the name of the object, or what the list is of.
  title: string;
  reason: string;
  // The time the reason refers to, when there is one.
  time?: number;
  // Another object the reason names, which the item leads to as well.
  related?: ViewTarget;
  // The item is of a read that is not the last one: it was read before.
  stale: boolean;
}

// What could not be checked, because the family it is checked on was not read.
export interface Unchecked {
  family: Family;
  kind: ViewKind;
  reason: string;
  // What the rules would have looked for in the family.
  missing: string;
}

export interface Attention {
  items: AttentionItem[];
  unchecked: Unchecked[];
  // The families the rules looked at whose objects are of an earlier read: the last one did not succeed.
  earlier: Family[];
}

const MISSING: Partial<Record<Family, string>> = {
  backups:
    "Whether a backup in flight carries a failure, whether one ended with a failure, and how the newest backup of each schedule ended were not checked",
  restores: "Whether a restore in flight carries a failure, and whether one ended with a failure, were not checked",
  schedules:
    "The validation of the schedules, their newest backups and the locations their templates name were not checked",
  storageLocations:
    "The availability of the storage locations, their last validation, the default and the locations the schedules name were not checked",
};

function failing(view: BackupView | RestoreView): boolean {
  return view.evidence.signal === "failure";
}

function operationReason(view: BackupView | RestoreView): string {
  return `${phaseText(view.state)}: ${signalText(view.evidence)}`;
}

function when(time: OperationTime): { time?: number } {
  return time.of === "none" ? {} : { time: time.time };
}

function said(message: string | undefined): string {
  const words = (message ?? "").replace(/[\s.]+$/, "");

  return words ? `: ${words}` : "";
}

function validationWords(view: StorageLocationView): string {
  return view.validation.at === undefined ? NEVER_VALIDATED : `Last validated ${validationAge(view.validation)}`;
}

function storageItems(reads: OverviewReads, now: number): AttentionItem[] {
  const read = reads.storageLocations;

  if (!hasItems(read)) return [];
  const stale = read.status !== "ready";
  const items: AttentionItem[] = [];
  const namespaces = [...new Set(read.items.map((location) => location.metadata.namespace ?? ""))];

  for (const location of read.items) {
    const view = storageLocationView(location, now);
    const of = { group: "storage" as const, kind: "storage-location" as const, name: view.name, title: view.name };
    const validated = view.validation.at === undefined ? {} : { time: view.validation.at };

    if (view.availability.availability === "unavailable") {
      items.push({
        ...of,
        rule: "A1",
        // What Velero says may end as a sentence does: the reason goes on after it with one full stop.
        reason: `Velero reports it unavailable${said(view.message)}. ${validationWords(view)}.`,
        ...validated,
        stale,
      });
    }
    if (view.availability.availability === "not-reported") {
      items.push({ ...of, rule: "A2", reason: "Velero has not reported on it.", stale });
    }
    if (view.validation.late) {
      const frequency =
        view.validation.frequency.of === "location" ? `, with a frequency of ${view.validation.frequency.written}` : "";
      // A frequency that is turned off, and one the release does not take, are said: they are why no
      // validation is to come, or why the one of the server is the one that counts.
      const note = view.validation.frequency.of === "location" ? "" : frequencyNote(view.validation.frequency);
      const named = view.validation.frequency.of === "off" || view.validation.frequency.written !== undefined;

      items.push({
        ...of,
        rule: "A3",
        reason: [`${validationWords(view)}${frequency}.`, lateNote(view.validation), named ? note : ""]
          .filter(Boolean)
          .join(" "),
        ...validated,
        stale,
      });
    }
    if (view.marked) {
      const refused = locationWarning(location);

      if (refused) items.push({ ...of, rule: "A4", reason: `It is marked default. ${refused}`, stale });
    }
  }
  const missing = { rule: "A4" as const, group: "storage" as const, kind: "storage-location" as const, stale };

  // An installation that holds no storage location marks none default, and has none to send a backup to.
  if (!read.items.length) {
    items.push({
      ...missing,
      title: "Default storage location",
      reason:
        "No storage location is in this installation, and none is marked default. The release refuses a backup sent to a location that is not there.",
    });
  }
  // The default is of an installation, which is a namespace: one item for each one that marks none.
  for (const namespace of namespaces) {
    if (defaults(read.items, namespace).state === "none") {
      items.push({
        ...missing,
        title: "Default storage location",
        reason:
          "No storage location is marked default. The server of Velero may name one in its settings, which this view does not read: a backup that names no location goes there.",
      });
    }
  }
  return items;
}

function scheduleItems(reads: OverviewReads, now: number): AttentionItem[] {
  const read = reads.schedules;

  if (!hasItems(read)) return [];
  const items: AttentionItem[] = [];
  const backups = hasItems(reads.backups);
  const locations = hasItems(reads.storageLocations);

  for (const schedule of read.items) {
    const view = scheduleView(schedule);
    const namespace = schedule.metadata.namespace ?? "";
    const of = { group: "schedules" as const, kind: "schedule" as const, name: view.name, title: view.name };
    const stale = read.status !== "ready";
    const paused = view.paused === "paused";

    if (view.state.validation === "invalid") {
      items.push({
        ...of,
        rule: "A5",
        reason: [
          view.validationErrors.length
            ? `Velero refused its expression: ${view.validationErrors.join("; ")}.`
            : "Velero refused its expression, and reports no error.",
          ...(paused ? [NOTES.paused] : []),
        ].join(" "),
        stale,
      });
    }
    // A paused schedule gives no item for a phase it does not report, for its backups and for its
    // template: that it is paused is in its line.
    if (paused) continue;
    if (view.state.reported === undefined) {
      items.push({ ...of, rule: "A6", reason: NOTES.notRead, stale });
    }
    if (backups) {
      // The backups of the schedule, from the newest: they are put in order once for a read.
      const newest = backupsOf(reads.backups.items, namespace, view.name)[0];
      const ended = newest ? backupView(newest, now) : undefined;

      if (newest && ended && ended.state.lifecycle === "terminal" && failing(ended)) {
        items.push({
          ...of,
          rule: "A7",
          reason: `Its newest backup, ${ended.name}, ended with a failure. ${operationReason(ended)}.`,
          ...when(operationTime(newest)),
          related: { kind: "backup", name: ended.name },
          stale: stale || reads.backups.status !== "ready",
        });
      }
    }
    if (locations) {
      const named = schedule.spec?.template?.storageLocation;

      if (typeof named === "string" && named !== "") {
        const location = reads.storageLocations.items.find(
          (item) => item.metadata.name === named && item.metadata.namespace === namespace,
        );
        const refused = location
          ? locationWarning(location)
          : "The release refuses a backup sent to a location that is not there.";

        if (refused) {
          items.push({
            ...of,
            rule: "A8",
            reason: `Its template names the storage location ${named}${location ? "" : ", which is not in the installation"}. ${refused}`,
            ...(location ? { related: { kind: "storage-location" as const, name: named } } : {}),
            stale: stale || reads.storageLocations.status !== "ready",
          });
        }
      }
    }
  }
  return items;
}

function operationItems(reads: OverviewReads, now: number, window: Window): AttentionItem[] {
  const all = operationsOf(reads, now);
  const from = now - WINDOW_LENGTH[window];
  const items: AttentionItem[] = [];
  // The schedules that were read. When they were not, whose backup a backup is cannot be said: the line
  // of what was not checked says so.
  const schedules = hasItems(reads.schedules)
    ? new Set(reads.schedules.items.map((schedule) => `${schedule.metadata.namespace ?? ""}/${schedule.metadata.name}`))
    : undefined;

  for (const found of [all.backups, all.restores]) {
    if (found.state !== "listed") continue;
    for (const operation of found.items) {
      const { view, kind, time } = operation;
      const of = { kind, name: view.name, title: view.name, stale: found.stale };

      if (!failing(view)) continue;
      if (view.state.lifecycle === "in-flight") {
        items.push({ ...of, rule: "A9", group: "in-flight", reason: `${operationReason(view)}.`, ...when(time) });
      }
      // The failure of a backup of a schedule is of its schedule: the newest one is an item of the
      // schedule, and the ones before it are history. A backup that names a schedule that is not among
      // the ones that were read has no schedule to be an item of: it is one of no schedule.
      const named = kind === "backup" ? (view as BackupView).schedule : undefined;
      const scheduled =
        named !== undefined && (schedules === undefined || schedules.has(`${(view as BackupView).namespace}/${named}`));

      if (view.state.lifecycle === "terminal" && !scheduled && time.of !== "none" && time.time >= from) {
        items.push({ ...of, rule: "A10", group: "ended", reason: `${operationReason(view)}.`, ...when(time) });
      }
    }
  }
  return items;
}

// The order of the items is fixed: what is in flight, the storage, the schedules, what ended; each group
// from the newest, and by name where there is no time.
function inOrder(one: AttentionItem, other: AttentionItem): number {
  const groups = GROUPS.indexOf(one.group) - GROUPS.indexOf(other.group);

  if (groups) return groups;
  // The time of an item of the storage is the one of the last validation, which moves at every
  // validation: by it, two locations that Velero validates every minute would change places while they
  // are read. The items of the storage are by name.
  if (one.group === "storage") {
    return byName(one.title, other.title) || RULES.indexOf(one.rule) - RULES.indexOf(other.rule);
  }
  if (one.time === undefined || other.time === undefined) {
    if (one.time !== other.time) return one.time === undefined ? 1 : -1;
  } else if (one.time !== other.time) {
    return other.time - one.time;
  }
  return byName(one.title, other.title) || RULES.indexOf(one.rule) - RULES.indexOf(other.rule);
}

export function attention(reads: OverviewReads, now: number, window: Window): Attention {
  const unchecked = (Object.keys(MISSING) as Family[])
    .filter((family) => !hasItems(reads[family]))
    .map((family) => ({
      family,
      kind: KINDS[family],
      reason: unread(PLURALS[family], reads[family]).reason,
      missing: MISSING[family] ?? "",
    }));

  return {
    items: [...operationItems(reads, now, window), ...storageItems(reads, now), ...scheduleItems(reads, now)].sort(
      inOrder,
    ),
    unchecked,
    earlier: (Object.keys(MISSING) as Family[]).filter((family) => isStale(reads[family])),
  };
}

export const NOTHING_READ = "Nothing was read of what the rules look at: what needs attention is not known.";

// What is said of what the rules found: how many items, or that nothing in what was read needs attention,
// which is never that all is well; then what the rules did not look at, and what they looked at as it was
// before the last read.
export function attentionSummary(found: Attention): string {
  if (found.unchecked.length === Object.keys(MISSING).length) return NOTHING_READ;
  return [
    found.items.length
      ? `${found.items.length} item${found.items.length === 1 ? "" : "s"} in what was read.`
      : "Nothing in what was read needs attention.",
    found.unchecked.length ? "Not everything was read." : "",
    found.earlier.length ? "Part of it was read before the last read, which did not succeed." : "",
  ]
    .filter(Boolean)
    .join(" ");
}

// One line for each schedule and for each storage location, ten at most: the ones a rule names first, then
// by name.
export const LINES = 10;

export interface Lines<Item> {
  items: Item[];
  // How many more there are, which are in the list of their kind.
  others: number;
}

export type LinesPart<Item> = ({ state: "listed"; stale: boolean } & Lines<Item>) | Unread;

export interface ScheduleLine {
  view: ScheduleView;
  // The rules that name the schedule.
  rules: Rule[];
  newestCompleted: NewestCompleted;
}

export interface LocationLine {
  view: StorageLocationView;
  rules: Rule[];
}

function lines<Item extends { view: { name: string }; rules: Rule[] }>(items: Item[]): Lines<Item> {
  const ordered = [...items].sort(
    (one, other) =>
      Number(other.rules.length > 0) - Number(one.rules.length > 0) || byName(one.view.name, other.view.name),
  );

  return { items: ordered.slice(0, LINES), others: Math.max(0, ordered.length - LINES) };
}

// The rules that name each object of a kind, by the name of the object: the items are read once.
function rulesOf(found: Attention, kind: ViewKind): (name: string) => Rule[] {
  const rules = new Map<string, Set<Rule>>();

  for (const item of found.items) {
    if (item.kind !== kind || item.name === undefined) continue;
    rules.set(item.name, (rules.get(item.name) ?? new Set()).add(item.rule));
  }
  return (name) => [...(rules.get(name) ?? [])];
}

export function scheduleLines(reads: OverviewReads, now: number, found: Attention): LinesPart<ScheduleLine> {
  if (!hasItems(reads.schedules)) return unread(PLURALS.schedules, reads.schedules);
  const rules = rulesOf(found, "schedule");
  const shown = lines(
    reads.schedules.items.map((schedule) => ({
      schedule,
      view: scheduleView(schedule),
      rules: rules(schedule.metadata.name),
    })),
  );

  return {
    state: "listed",
    stale: reads.schedules.status !== "ready",
    // The newest completed backup is looked for of the schedules that have a line, and of no other.
    items: shown.items.map(({ schedule, view, rules: named }) => ({
      view,
      rules: named,
      newestCompleted: newestCompleted(reads.backups, now, {
        name: schedule.metadata.name,
        namespace: schedule.metadata.namespace ?? "",
      }),
    })),
    others: shown.others,
  };
}

export function locationLines(reads: OverviewReads, now: number, found: Attention): LinesPart<LocationLine> {
  if (!hasItems(reads.storageLocations)) return unread(PLURALS.storageLocations, reads.storageLocations);
  const rules = rulesOf(found, "storage-location");

  return {
    state: "listed",
    stale: reads.storageLocations.status !== "ready",
    ...lines(
      reads.storageLocations.items.map((location) => ({
        view: storageLocationView(location, now),
        rules: rules(location.metadata.name),
      })),
    ),
  };
}
