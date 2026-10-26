/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

// What the suite of the adherence expects of each fixture, computed from the objects as the cluster holds them and
// from the clock, by the rules of the controller as SPEC-0013 states them (REQ-160 to REQ-163, REQ-167), and never
// with the code of the extension. It knows the expressions of the fixtures and refuses any other: it is not a second
// parser. Nothing here reads the cluster or the page: the suite reads them, and its own cases give the objects and
// the clock.

import { halfPastTwoInRome } from "./velero-cluster";

const SECOND = 1000;
const MINUTE = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;
const QUARTER = 15 * MINUTE;
// A schedule is due for five minutes after its expected run, and overdue after that (REQ-163); the count of the
// expected runs that passed stops past one hundred (REQ-161).
export const GRACE = 5 * MINUTE;
export const COUNT_BOUND = 100;
// The clock of the page is a tick of up to five seconds before a read of it, and the read up to fifteen seconds old;
// the clock of the cluster is the one of this machine within a second, which the reader corrects by half of one.
const TICK_AND_READ = 20 * SECOND;
const CLUSTER = SECOND;
export const BUENOS_AIRES = "America/Argentina/Buenos_Aires";
const ROME = "Europe/Rome";

/** A schedule or a backup, as far as the rules read it. */
export interface HeldObject {
  metadata: { name: string; creationTimestamp?: string; labels?: Record<string, string> };
  spec?: { schedule?: string } | null;
  status?: { phase?: string; lastBackup?: string; lastSkipped?: string } | null;
}

/** The two clocks every expectation is computed at: before the read of the page, less its age, and after it. */
export interface Clocks {
  from: number;
  to: number;
}

export function clocksAround(before: number, after: number): Clocks {
  return { from: before - TICK_AND_READ, to: after + CLUSTER };
}

// --- The zones, and the times in the words of the views ---

export type Zone = { of: "fixed"; minutes: number } | { of: "named"; name: string };
export const UTC: Zone = { of: "fixed", minutes: 0 };

// The offset of a zone at an instant, in minutes east of UTC: a named one by Intl, which throws on a name it does not
// know.
function offsetIn(zone: Zone, instant: number): number {
  if (zone.of === "fixed") return zone.minutes;
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: zone.name,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
      .formatToParts(instant)
      .map((part) => [part.type, Number(part.value)]),
  );
  const wall = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);

  return Math.round((wall - Math.floor(instant / SECOND) * SECOND) / MINUTE);
}

export function zoneKnown(name: string): boolean {
  try {
    offsetIn({ of: "named", name }, 0);
    return true;
  } catch {
    return false;
  }
}

const two = (value: number) => String(value).padStart(2, "0");

export function zoneName(zone: Zone): string {
  if (zone.of === "named") return zone.name;
  if (zone.minutes === 0) return "UTC";
  const size = Math.abs(zone.minutes);

  return `UTC${zone.minutes < 0 ? "-" : "+"}${two(Math.floor(size / 60))}:${two(size % 60)}`;
}

function wall(zone: Zone, instant: number): { date: string; minute: string; second: number } {
  const at = new Date(instant + offsetIn(zone, instant) * MINUTE);

  return {
    date: at.toISOString().slice(0, 10),
    minute: at.toISOString().slice(11, 16),
    second: at.getUTCSeconds(),
  };
}

/** A time the cluster wrote, as the words write it: `YYYY-MM-DD HH:MM:SS ZONE`. */
export function moment(zone: Zone, instant: number): string {
  const at = wall(zone, instant);

  return `${at.date} ${at.minute}:${two(at.second)} ${zoneName(zone)}`;
}

/** A run, as the words write it: `HH:MM[:SS] ZONE`, with ` on YYYY-MM-DD` when it is not the day of the clock. */
export function runText(zone: Zone, instant: number, clock: number): string {
  const at = wall(zone, instant);
  const time = `${at.minute}${at.second ? `:${two(at.second)}` : ""} ${zoneName(zone)}`;

  return at.date === wall(zone, clock).date ? time : `${time} on ${at.date}`;
}

// --- The expressions of the fixtures ---

type Rule =
  | { kind: "every"; period: number }
  | { kind: "daily"; hour: number; minute: number }
  | { kind: "named"; zone: string; next: (after: number) => number }
  | { kind: "no-instant" };

// The first midnight of the first of January in a named zone after an instant, by Intl.
function newYearAfter(zone: string, after: number): number {
  const year = Number(wall({ of: "named", name: zone }, after).date.slice(0, 4));

  for (const candidate of [year, year + 1]) {
    const midnight = Date.UTC(candidate, 0, 1);
    let at = midnight - offsetIn({ of: "named", name: zone }, midnight) * MINUTE;

    at = midnight - offsetIn({ of: "named", name: zone }, at) * MINUTE;
    if (at > after) return at;
  }
  throw new Error(`No new year in ${zone} after ${new Date(after).toISOString()}`);
}

function ruleOf(expression: string | undefined): Rule {
  const interval = /^@every (\d+)h$/.exec(expression ?? "");
  const daily = /^(\d{1,2}) (\d{1,2}) \* \* \*$/.exec(expression ?? "");

  if (interval) return { kind: "every", period: Number(interval[1]) * HOUR };
  if (daily) return { kind: "daily", minute: Number(daily[1]), hour: Number(daily[2]) };
  if (expression === `CRON_TZ=${ROME} 30 2 * * *`) return { kind: "named", zone: ROME, next: halfPastTwoInRome };
  if (expression === `CRON_TZ=${BUENOS_AIRES} 0 0 1 1 *`) {
    return { kind: "named", zone: BUENOS_AIRES, next: (after) => newYearAfter(BUENOS_AIRES, after) };
  }
  if (expression === "0 0 30 2 *") return { kind: "no-instant" };
  throw new Error(
    `The suite computes the expressions of the fixtures, and "${expression}" is not one of them: it is not a parser`,
  );
}

// The first instant after a time, from its upcoming second, in the zone of the server for a daily expression.
function nextAfter(rule: Rule, after: number, server?: Zone): number {
  if (rule.kind === "every") return Math.floor(after / SECOND) * SECOND + rule.period;
  if (rule.kind === "named") return rule.next(after);
  if (rule.kind !== "daily" || !server) throw new Error("The next run of this expression needs a zone");
  const offset = offsetIn(server, after) * MINUTE;
  const day = Math.floor((after + offset) / DAY) * DAY;
  let at = day + rule.hour * HOUR + rule.minute * MINUTE - offset;

  while (at <= after) at += DAY;
  return at;
}

// --- The anchor, the offset of the server and the hold ---

const time = (value: string | undefined) => (value ? Date.parse(value) : undefined);

/** Where the controller counts from: the last submission, the creation, the last skip when later. */
export function anchorOf(schedule: HeldObject): { of: "last-submission" | "creation" | "last-skipped"; at: number } {
  const submitted = time(schedule.status?.lastBackup);
  const skipped = time(schedule.status?.lastSkipped);
  const anchor =
    submitted === undefined
      ? { of: "creation" as const, at: time(schedule.metadata.creationTimestamp) ?? Number.NaN }
      : { of: "last-submission" as const, at: submitted };

  return skipped !== undefined && skipped > anchor.at ? { of: "last-skipped", at: skipped } : anchor;
}

const scheduleOf = (backup: HeldObject) => backup.metadata.labels?.["velero.io/schedule-name"];

/** The backup of the last submission of a schedule: its label, its name of fourteen digits, within a minute of it. */
export function submissionBackup(schedule: HeldObject, backups: HeldObject[]): HeldObject | undefined {
  const submitted = time(schedule.status?.lastBackup);
  const name = schedule.metadata.name;

  if (submitted === undefined) return undefined;
  return backups
    .filter((backup) => scheduleOf(backup) === name && new RegExp(`^${name}-\\d{14}$`).test(backup.metadata.name))
    .map((backup) => ({ backup, distance: Math.abs((time(backup.metadata.creationTimestamp) ?? 0) - submitted) }))
    .filter(({ distance }) => distance <= MINUTE)
    .sort((one, other) => one.distance - other.distance)[0]?.backup;
}

export interface ServerOffset {
  minutes: number;
  schedule: string;
  backup: string;
  submission: number;
  changed?: { minutes: number; schedule: string; backup: string; submission: number };
}

/**
 * The offset of the server of an installation (REQ-162): of each backup of a last submission, its fourteen digits
 * read as a wall clock less its creation, rounded to the quarter of an hour, with a remainder under a minute; the
 * newest submission stands, and the newest that gives another offset is said beside it.
 */
export function serverOffset(schedules: HeldObject[], backups: HeldObject[]): ServerOffset | undefined {
  const offsets = schedules
    .flatMap((schedule) => {
      const backup = submissionBackup(schedule, backups);
      const digits = backup?.metadata.name.slice(-14) ?? "";
      const named = Date.parse(
        `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}T${digits.slice(8, 10)}:${digits.slice(10, 12)}:${digits.slice(12)}Z`,
      );
      const difference = named - (time(backup?.metadata.creationTimestamp) ?? Number.NaN);
      const rounded = Math.round(difference / QUARTER) * QUARTER;

      return backup && Math.abs(difference - rounded) < MINUTE
        ? [
            {
              minutes: rounded / MINUTE + 0,
              schedule: schedule.metadata.name,
              backup: backup.metadata.name,
              submission: time(schedule.status?.lastBackup) ?? 0,
            },
          ]
        : [];
    })
    .sort((one, other) => other.submission - one.submission || (one.schedule < other.schedule ? -1 : 1));
  const [newest] = offsets;
  const changed = offsets.find((offset) => offset.minutes !== newest?.minutes);

  return newest && (changed ? { ...newest, changed } : newest);
}

/** The backup that holds the submissions of a schedule: of its label, with no phase, New or InProgress. */
export function holdingBackup(schedule: HeldObject, backups: HeldObject[]): string | undefined {
  return backups
    .filter((backup) => scheduleOf(backup) === schedule.metadata.name)
    .filter((backup) => ["", "New", "InProgress"].includes(backup.status?.phase ?? ""))
    .sort(
      (one, other) => (time(other.metadata.creationTimestamp) ?? 0) - (time(one.metadata.creationTimestamp) ?? 0),
    )[0]?.metadata.name;
}

// --- What a schedule is expected to show at a clock ---

export type State = "awaited" | "due" | "overdue" | "held" | "at-every-look" | "not-known";

export interface Expected {
  state: State;
  // The kind of the next run, the mark and the reason of a state that is not known, as the attributes say them.
  next: "at" | "none" | "not-known";
  mark: "awaited" | "late" | "not-known";
  reason: "" | "no-offset" | "unknown-zone";
  // The zone the times of the schedule are written in, and the offset of the server it was read with.
  zone: Zone;
  offset?: ServerOffset;
  anchor: ReturnType<typeof anchorOf>;
  // The expected run, how long ago it was (below zero while it is ahead), the runs that passed and the last of them.
  at?: number;
  lateness?: number;
  passed?: number;
  beyond?: boolean;
  last?: number;
  held?: string;
}

export interface Installation {
  schedules: HeldObject[];
  backups: HeldObject[];
}

/** What a schedule of an installation is to show by the clock of the cluster. */
export function expectedOf(schedule: HeldObject, installation: Installation, clock: number): Expected {
  const rule = ruleOf(schedule.spec?.schedule);
  const anchor = anchorOf(schedule);
  const offset = serverOffset(installation.schedules, installation.backups);
  const server: Zone | undefined = offset ? { of: "fixed", minutes: offset.minutes } : undefined;
  const known = rule.kind !== "named" || zoneKnown(rule.zone);
  // An interval names no zone and is written in UTC; a named zone this machine does not know is written in UTC too.
  const zone: Zone =
    rule.kind === "named"
      ? known
        ? { of: "named", name: rule.zone }
        : UTC
      : rule.kind === "every"
        ? UTC
        : (server ?? UTC);
  const base = { zone, anchor, ...(offset && (rule.kind === "daily" || rule.kind === "no-instant") ? { offset } : {}) };

  // An expression with no instant is submitted at every look, whatever its zone.
  if (rule.kind === "no-instant")
    return { ...base, state: "at-every-look", next: "none", mark: "not-known", reason: "" };
  if (!known || (rule.kind === "daily" && !server)) {
    return {
      ...base,
      state: "not-known",
      next: "not-known",
      mark: "not-known",
      reason: known ? "no-offset" : "unknown-zone",
    };
  }
  const at = nextAfter(rule, anchor.at, server);
  let passed = 0;
  let last: number | undefined;

  for (let run = at; clock > run && passed <= COUNT_BOUND; run = nextAfter(rule, run, server)) {
    passed += 1;
    if (passed <= COUNT_BOUND) last = run;
  }
  const lateness = clock - at;
  const held = holdingBackup(schedule, installation.backups);
  const late = clock > at && lateness > GRACE;
  const counted = { at, lateness, passed: Math.min(passed, COUNT_BOUND), beyond: passed > COUNT_BOUND, last };

  if (held)
    return { ...base, ...counted, held, state: "held", next: "at", mark: late ? "late" : "awaited", reason: "" };
  const state: State = clock <= at ? "awaited" : late ? "overdue" : "due";

  return { ...base, ...counted, state, next: "at", mark: late ? "late" : "awaited", reason: "" };
}

/** The same at the two clocks of a read: what the page shows is one of them. */
export function expectedAround(schedule: HeldObject, installation: Installation, clocks: Clocks): Expected[] {
  return [expectedOf(schedule, installation, clocks.from), expectedOf(schedule, installation, clocks.to)];
}

// --- The orders of the list (REQ-168) ---

const WEIGHTS: Record<State, number> = {
  overdue: 0,
  held: 1,
  due: 2,
  "at-every-look": 3,
  "not-known": 4,
  awaited: 5,
};
const byName = (one: string, other: string) => (one < other ? -1 : one > other ? 1 : 0);

/** By adherence: the weight of the state, then the expected run from the earliest, then the name. */
export function byAdherence(expected: Record<string, Expected>): string[] {
  const measure = (one: Expected) => (one.state === "at-every-look" || one.state === "not-known" ? 0 : (one.at ?? 0));

  return Object.keys(expected).sort(
    (one, other) =>
      WEIGHTS[expected[one].state] - WEIGHTS[expected[other].state] ||
      measure(expected[one]) - measure(expected[other]) ||
      byName(one, other),
  );
}

/** By the next run: the instants from the earliest, then the ones not known, then the ones with none, each by name. */
export function byNextRun(expected: Record<string, Expected>): string[] {
  const rank = { at: 0, "not-known": 1, none: 2 };

  return Object.keys(expected).sort(
    (one, other) =>
      rank[expected[one].next] - rank[expected[other].next] ||
      (expected[one].at ?? 0) - (expected[other].at ?? 0) ||
      byName(one, other),
  );
}

// --- The durations and the words ---

const UNITS: Record<string, number> = { d: DAY, h: HOUR, m: MINUTE, s: SECOND };
const NEXT_UNIT: Record<string, number> = { d: HOUR, h: MINUTE, m: SECOND, s: SECOND };
const DURATION = "less than a second|\\d+[dhms](?: \\d+[dhms])?";

/**
 * The span of milliseconds a duration of the views stands for, read by its two units: `2d 3h` is from two days and
 * three hours to an hour more, `5m` from five minutes to a second more.
 */
export function durationSpan(text: string): [number, number] {
  if (text === "less than a second") return [0, SECOND];
  const found = /^(\d+)([dhms])(?: (\d+)([dhms]))?$/.exec(text);

  if (!found) throw new Error(`"${text}" is not a duration of the views`);
  const low = Number(found[1]) * UNITS[found[2]] + (found[3] ? Number(found[3]) * UNITS[found[4]] : 0);

  return [low, low + NEXT_UNIT[found[2]]];
}

/** A part of the words: a text as it is written, or a duration expected between two bounds. */
export type Part = string | { between: [number, number] };

export function between(...values: number[]): Part {
  return { between: [Math.min(...values), Math.max(...values)] };
}

const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Whether the words shown hold one of the forms: the texts as they are written, and each duration read back into
 * its span, which overlaps the one computed. Never a comparison of two texts of a duration.
 */
export function holdsForm(shown: string, ...forms: Part[][]): boolean {
  return formIn(shown, forms, false);
}

/** The same, of words that are the form whole and nothing more. */
export function isForm(shown: string, ...forms: Part[][]): boolean {
  return formIn(shown, forms, true);
}

function formIn(shown: string, forms: Part[][], whole: boolean): boolean {
  return forms.some((form) => {
    const pattern = form.map((part) => (typeof part === "string" ? escaped(part) : `(${DURATION})`)).join("");
    const found = new RegExp(whole ? `^${pattern}$` : pattern).exec(shown);
    const spans = form.filter((part): part is { between: [number, number] } => typeof part !== "string");

    return (
      found !== null &&
      spans.every(({ between: [low, high] }, index) => {
        const [from, to] = durationSpan(found[index + 1]);

        return from <= high && to > low;
      })
    );
  });
}
