/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

// The adherence of the schedules on its fixtures, in a packaged Freelens: the installation of its states, the one of
// two offsets and the one of three hundred schedules, all placed by the clock and named by the operator, and the
// schedule the controller of the installation of the demo validated. What each fixture is to show is computed by the
// suite from the objects as the cluster holds them and from the clock, by the rules of the controller
// (`integration/helpers/velero-adherence.ts`), whose own cases come first and start no application. The suite reads
// the application and the cluster, and writes to neither.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as adherence from "../../integration/helpers/velero-adherence";
import * as cluster from "../../integration/helpers/velero-cluster";
import * as velero from "../../integration/helpers/velero-extension";
import { writesOf } from "../../integration/helpers/velero-guard";

import type { Frame } from "playwright";

import type {
  Clocks,
  Expected,
  HeldObject,
  Installation,
  Part,
  Zone,
  ZoneKnown,
} from "../../integration/helpers/velero-adherence";

const TIMEOUT = 10 * 60 * 1000;
const SCHEDULES = cluster.SCHEDULES;
const OVERVIEW = cluster.OVERVIEW;
const SECOND = 1000;
const MINUTE = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;
const BUDGET = 250;
const MOUNTED = 100;
const DISCOVERY = "LIST backupstoragelocations cluster";
const PLACED = "freelensapp.io/velero-fixture-placed";
const RUN = cluster.E2E_FIXTURE_RUN;
const REAL = `fixture-yearly-${RUN}`;
// The schedule with a name as long as the value of a label may be, written here as the fixtures name it.
const LONG = "schedule-with-a-name-as-long-as-the-value-of-a-label-is-allowed";
// The eight schedules of the installation of the states.
const STATES = [
  "adherence-awaited",
  "adherence-overdue",
  "adherence-held",
  "adherence-every-look",
  "adherence-derived",
  "adherence-borrowed",
  "adherence-ahead",
  LONG,
];
// Whether the Intl of the application knows the zone the schedule with the long name names, as the one of Node
// does: the nightly the suites run in knows it, and shows that schedule awaited with its next run at the new year
// of Buenos Aires (the packaged runs of 2026-10-26). An application that does not would show it not known with
// `unknown-zone` in its row, the orders, its band, the details and its line of the Overview, which counts it.
const APPLICATION_KNOWS_BUENOS_AIRES: boolean = true;
const knows: ZoneKnown = (name) => name !== adherence.BUENOS_AIRES || APPLICATION_KNOWS_BUENOS_AIRES;

// The forms of the words of the views, written as they are; the values in them are computed by the suite.
const WORDS = {
  label: {
    awaited: "Awaited",
    due: "Due",
    overdue: "Overdue",
    held: "Held",
    "at-every-look": "At every look",
    "not-known": "Not known",
  },
  from: {
    "last-submission": "the last submission",
    creation: "the creation of the schedule",
    "last-skipped": "the last skip",
  },
  awaited: (inTime: Part, run: string, from: string): Part[] => [
    "Next run in ",
    inTime,
    `, at ${run}. Counted from ${from}.`,
  ],
  due: (run: string, ago: Part): Part[] => [
    `Due: expected at ${run}, `,
    ago,
    " ago. Velero looks at a schedule once a minute.",
  ],
  overdue: (by: Part, run: string, from: string, passed: string): Part[] => [
    "Overdue by ",
    by,
    `: expected at ${run}. Counted from ${from}, with no submission since; ${passed}. Velero may not be at work, or may not be able to list the backups.`,
  ],
  passed: (count: number, beyond: boolean) =>
    beyond ? "more than 100 expected runs passed" : `${count} expected run${count === 1 ? "" : "s"} passed`,
  held: (backup: string) => `Held: Velero submits nothing while the backup ${backup} is InProgress.`,
  heldExpected: (run: string, ago: Part): Part[] => [`A run was expected at ${run}, `, ago, " ago."],
  heldNext: (run: string, inTime: Part): Part[] => [`The next run is at ${run}, in `, inTime, "."],
  atEveryLook: (last: string) =>
    `At every look: the expression has no instant within five years, and Velero submits a backup at each of its looks, once a minute, while no backup of the schedule is New, InProgress or without a phase. Last submission ${last}.`,
  unknownZone: (name: string) =>
    `Not known: the expression names the time zone ${name}, which this machine does not know, and the run cannot be computed here. Velero took the expression: its server knows the zone.`,
  noOffset:
    "Not known: the expression names no time zone, and the one of the Velero server is not read. It is derived from the backup of a last submission, of this schedule or of another of the installation, and ",
  grace:
    "A schedule is due for 5m after its expected run, and overdue after that: Velero looks at a schedule once a minute and submits at its first look after the run.",
  hostTime: "In the time zone of the preferences:",
  thisSchedule: "this schedule",
  otherSchedule: (name: string) => `the schedule ${name}`,
  derived: (offset: string, backup: string, of: string, moment: string) =>
    `Computed with ${offset}, the offset of the clock of the Velero server when it submitted the backup ${backup} of ${of}, at ${moment}: across a change of daylight saving time the run may be an hour off.`,
  changed: (offset: string, backup: string, of: string, moment: string) =>
    `The offset was ${offset} when the server submitted the backup ${backup} of ${of}, at ${moment}: it changed between the two submissions, and the newest stands.`,
  holdNotKnown: "Whether a backup of the schedule holds the submissions is not known, since ",
  zone: {
    named: (name: string) => `${name}, named by the expression`,
    namedNotKnown: (name: string) => `${name}, named by the expression, which this machine does not know`,
    interval: "None: an interval is counted without a time zone, and its times are written in UTC",
    derived: (offset: string, backup: string, of: string, moment: string) =>
      `${offset}, the offset of the clock of the Velero server when it submitted the backup ${backup} of ${of}, at ${moment}`,
  },
  passedNone: "None yet: the expected run is ahead",
  passedOne: (run: string) => `1 expected run passed, at ${run}`,
  passedMany: (count: number, first: string, last: string) =>
    `${count} expected runs passed, the first at ${first} and the last at ${last}`,
  passedBeyond: (first: string) => `More than 100 expected runs passed, the first at ${first}`,
  observed: {
    found: (moment: string, backup: string) => `Last submission ${moment}: its backup is ${backup}.`,
    notFound: (moment: string) =>
      `Last submission ${moment}: its backup is not among the backups that exist; it expired, was deleted or cannot be read. The submission stands, since the schedule carries it.`,
    readBefore: (moment: string, ago: Part): Part[] => [
      `Last submission ${moment}: whether its backup exists is not known, since the backups were last read `,
      ago,
      " ago, before it.",
    ],
    none: "No submission is written in the schedule.",
    newer: (backup: string, moment: string) =>
      `The backup ${backup}, created ${moment}, is not a submission of the schedule: it was asked by hand or synced from the store, and it moves nothing in the schedule.`,
  },
  heldNow: (backup: string) => `The backup ${backup} is InProgress now.`,
  // The clocks with the time of the API server, which reaches the frame: the difference is said, and a time an
  // object reports after the clock of this machine.
  server:
    /^Times are compared by the clock of the cluster, which the time its API server writes in its answers gives: it is (within a second of the clock of this machine|(ahead of|behind) the clock of this machine by \d+[dhms]( \d+[dhms])?)\./,
  object: (name: string, after: Part): Part[] => [
    `The schedule ${name} reports its last submission `,
    after,
    " after the clock of this machine, later than the clock of the API server: by the clock that wrote it a run may be later still.",
  ],
};

const text = (value: string) => value.replace(/\s+/g, " ").trim();
const capital = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);
const unique = <Item>(items: Item[]) => [...new Map(items.map((item) => [JSON.stringify(item), item])).values()];

function percentile(values: number[], fraction: number): number {
  const sorted = [...values].sort((one, other) => one - other);

  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
}

// The schedules and the backups of an installation, as the cluster holds them.
function installationOf(namespace: string): Installation {
  const read = cluster.kubectlE2E(
    "get",
    "schedules.velero.io,backups.velero.io",
    "--namespace",
    namespace,
    "-o",
    "json",
  );

  if (read.status !== 0) throw new Error(`The schedules and the backups of ${namespace} could not be read`);
  const items = (JSON.parse(read.stdout) as { items: (HeldObject & { kind: string })[] }).items;

  return {
    schedules: items.filter((item) => item.kind === "Schedule"),
    backups: items.filter((item) => item.kind === "Backup"),
  };
}

function scheduleOf(installation: Installation, name: string): HeldObject {
  const found = installation.schedules.find((schedule) => schedule.metadata.name === name);

  if (!found) throw new Error(`The schedule ${name} is not in the installation`);
  return found;
}

// The attributes a row, a line and the details say the adherence of a schedule by.
const attributes = (one: Expected) => ({ next: one.next, state: one.state, mark: one.mark, reason: one.reason });

// The word of the next run: how far the expected run is from the clock of the page, which is between the two clocks
// of the read. A run between the two is said ago or ahead, by as much as that clock is past it or short of it.
function nextWords(expected: Expected[]): Part[][] {
  const [first] = expected;

  if (first.next === "none") return [["None"]];
  if (first.next === "not-known") return [["Not known"]];
  const lateness = expected.map((one) => one.lateness ?? 0);
  const earliest = Math.min(...lateness);
  const latest = Math.max(...lateness);

  return [
    ...(latest > 0 ? [[adherence.between(Math.max(earliest, 0), latest), " ago"]] : []),
    ...(earliest <= 0 ? [["in ", adherence.between(Math.max(-latest, 0), -earliest)]] : []),
  ];
}

// The offset of the server in words, and whose submission it was read in.
const offsetWords = (minutes: number) => adherence.zoneName({ of: "fixed", minutes });
const whose = (of: string, name: string) => (of === name ? WORDS.thisSchedule : WORDS.otherSchedule(of));

// The words of the band of a schedule, at each of the two clocks: the sentence of its state, the notes beside it,
// and each line. What the page shows is one of them.
interface BandForm {
  state: string;
  order: string[];
  // The word of the state beside its mark, and the sentence of the state.
  label: string;
  next: Part[];
  // Whether the sentence is the form whole: the one of an offset that is not read ends with why, which the read
  // gives.
  whole: boolean;
  notes: string[];
  grace: boolean;
  host: boolean;
  zone: string;
  anchor: string;
  observed: Part[];
  held?: string;
  passed?: string;
}

function bandForms(name: string, installation: Installation, clocks: Clocks, zones: ZoneKnown = knows): BandForm[] {
  const schedule = scheduleOf(installation, name);

  return unique(
    ([clocks.from, clocks.to] as const).map((clock) => {
      const one = adherence.expectedOf(schedule, installation, clock, zones);
      // A duration of this clock, widened to the other one: the page read it at a clock between the two.
      const span = (value: number) =>
        adherence.between(value - (clocks.to - clocks.from), value + (clocks.to - clocks.from));
      const zone: Zone = one.zone;
      const at = one.at ?? 0;
      const run = adherence.runText(zone, at, clock);
      const from = `${WORDS.from[one.anchor.of]}, ${adherence.moment(zone, one.anchor.at)}`;
      const offset = one.offset;
      const derived = offset
        ? [
            WORDS.derived(
              offsetWords(offset.minutes),
              offset.backup,
              whose(offset.schedule, name),
              adherence.moment(zone, offset.submission),
            ),
            ...(offset.changed
              ? [
                  WORDS.changed(
                    offsetWords(offset.changed.minutes),
                    offset.changed.backup,
                    whose(offset.changed.schedule, name),
                    adherence.moment({ of: "fixed", minutes: offset.changed.minutes }, offset.changed.submission),
                  ),
                ]
              : []),
          ]
        : [];
      const lateness = one.lateness ?? 0;
      const submitted = schedule.status?.lastBackup ? Date.parse(schedule.status.lastBackup) : undefined;
      const next: Part[] =
        one.state === "awaited"
          ? WORDS.awaited(span(-lateness), run, from)
          : one.state === "due"
            ? WORDS.due(run, span(lateness))
            : one.state === "overdue"
              ? WORDS.overdue(span(lateness), run, from, WORDS.passed(one.passed ?? 0, one.beyond ?? false))
              : one.state === "held"
                ? [
                    `${WORDS.held(one.held ?? "")} `,
                    ...(lateness > 0 ? WORDS.heldExpected(run, span(lateness)) : WORDS.heldNext(run, span(-lateness))),
                  ]
                : one.state === "at-every-look"
                  ? [WORDS.atEveryLook(adherence.moment(zone, submitted ?? one.anchor.at))]
                  : one.reason === "unknown-zone"
                    ? [WORDS.unknownZone(adherence.BUENOS_AIRES)]
                    : [WORDS.noOffset];
      const counted = ["awaited", "due", "overdue", "held"].includes(one.state);
      const own = adherence.submissionBackup(schedule, installation.backups);
      const newer = installation.backups
        .filter(
          (backup) =>
            backup.metadata.labels?.["velero.io/schedule-name"] === name &&
            backup !== own &&
            (submitted === undefined || Date.parse(backup.metadata.creationTimestamp ?? "") > submitted),
        )
        .sort(
          (one, other) =>
            Date.parse(other.metadata.creationTimestamp ?? "") - Date.parse(one.metadata.creationTimestamp ?? ""),
        );
      const observed: Part[] = [
        ...(submitted === undefined
          ? [WORDS.observed.none]
          : own
            ? [WORDS.observed.found(adherence.moment(zone, submitted), own.metadata.name)]
            : submitted > clocks.to
              ? WORDS.observed.readBefore(
                  adherence.moment(zone, submitted),
                  adherence.between(0, clocks.to - clocks.from),
                )
              : [WORDS.observed.notFound(adherence.moment(zone, submitted))]),
        ...(newer[0]
          ? [
              ` ${WORDS.observed.newer(
                newer[0].metadata.name,
                adherence.moment(zone, Date.parse(newer[0].metadata.creationTimestamp ?? "")),
              )}`,
            ]
          : []),
      ];
      const zoneLine =
        one.zone.of === "named"
          ? WORDS.zone.named(one.zone.name)
          : one.reason === "unknown-zone"
            ? WORDS.zone.namedNotKnown(adherence.BUENOS_AIRES)
            : schedule.spec?.schedule?.startsWith("@every")
              ? WORDS.zone.interval
              : offset
                ? WORDS.zone.derived(
                    offsetWords(offset.minutes),
                    offset.backup,
                    whose(offset.schedule, name),
                    adherence.moment(zone, offset.submission),
                  )
                : "";
      const passed = !counted
        ? undefined
        : one.passed === 0
          ? WORDS.passedNone
          : one.beyond
            ? WORDS.passedBeyond(run)
            : one.passed === 1
              ? WORDS.passedOne(run)
              : WORDS.passedMany(one.passed ?? 0, run, adherence.runText(zone, one.last ?? at, clock));

      return {
        state: one.state,
        order: [
          "next",
          "zone",
          "anchor",
          "observed",
          ...(one.held ? ["held"] : []),
          ...(counted ? ["passed"] : []),
          "clocks",
        ],
        label: WORDS.label[one.state],
        next,
        whole: one.reason !== "no-offset",
        // A schedule at every look is said with no word of the offset.
        notes: one.state === "at-every-look" ? [] : derived,
        grace: counted,
        host: one.next === "at",
        zone: zoneLine,
        anchor: capital(from),
        observed,
        ...(one.held ? { held: WORDS.heldNow(one.held) } : {}),
        ...(passed ? { passed } : {}),
      };
    }),
  );
}

// The words of the clocks of an installation where a schedule reports its last submission after the clock of this
// machine: the form the time of the API server gives, then the object, by as much as it reports ahead of the read.
function clocksHold(said: string, name: string, installation: Installation, clocks: Clocks): boolean {
  const reported = Date.parse(scheduleOf(installation, name).status?.lastBackup ?? "");

  return (
    WORDS.server.test(said) &&
    adherence.holdsForm(said, WORDS.object(name, adherence.between(reported - clocks.to, reported - clocks.from)))
  );
}

// Of what was counted, the backups created, by name and of any scope: a backup the real schedule submitted would be
// one of them. What else is a write is the rule of the guard of the suites (`writes`), which leaves out what the
// controllers of the installation of the demo write by themselves.
function createdBackups(all: Record<string, number>): string[] {
  return Object.keys(all).filter((key) => key.startsWith("POST backups "));
}

describe("what the suite of the adherence expects, computed by the rules of the controller", () => {
  const P = Date.parse("2026-10-26T13:20:07Z");
  const at = (instant: number) => new Date(instant).toISOString().replace(".000Z", "Z");
  const schedule = (
    name: string,
    expression: string,
    lastBackup?: number,
    created = P,
    lastSkipped?: number,
  ): HeldObject => ({
    metadata: { name, creationTimestamp: at(created) },
    spec: { schedule: expression },
    status: {
      phase: "Enabled",
      ...(lastBackup === undefined ? {} : { lastBackup: new Date(lastBackup).toISOString() }),
      ...(lastSkipped === undefined ? {} : { lastSkipped: at(lastSkipped) }),
    },
  });
  // A backup of a submission, named by a wall clock and created at an instant.
  const backup = (of: string, wall: number, created: number, phase = "Completed"): HeldObject => ({
    metadata: {
      name: `${of}-${new Date(wall).toISOString().replace(/[-:T]/g, "").slice(0, 14)}`,
      creationTimestamp: at(created),
      labels: { "velero.io/schedule-name": of },
    },
    status: { phase },
  });
  const one = (item: HeldObject, clock: number, backups: HeldObject[] = []) =>
    adherence.expectedOf(item, { schedules: [item], backups }, clock);

  it("counts an interval from its anchor, truncated to the second, and from the later of its anchors", () => {
    const awaited = one(schedule("awaited", "@every 24h", P + 750), P + MINUTE);

    expect([awaited.at, awaited.state, awaited.mark, awaited.next, awaited.passed]).toEqual([
      P + DAY,
      "awaited",
      "awaited",
      "at",
      0,
    ]);
    expect(awaited.zone).toEqual(adherence.UTC);
    // No submission: from the creation; a skip later than it: from the skip.
    expect(one(schedule("new", "@every 24h", undefined, P - HOUR), P).at).toBe(P - HOUR + DAY);
    expect(one(schedule("skipped", "@every 24h", P - DAY, P - 2 * DAY, P - HOUR), P).anchor).toEqual({
      of: "last-skipped",
      at: P - HOUR,
    });
  });

  it("counts twenty-five runs of the hourly interval just after the placement, and thirty-seven twelve hours later", () => {
    const overdue = schedule("overdue", "@every 1h", P - 25 * HOUR);
    const placed = one(overdue, P + SECOND);
    const later = one(overdue, P + 12 * HOUR + SECOND);

    expect([placed.state, placed.mark, placed.at, placed.passed, placed.last, placed.lateness]).toEqual([
      "overdue",
      "late",
      P - 24 * HOUR,
      25,
      P,
      24 * HOUR + SECOND,
    ]);
    expect([later.passed, later.last, later.beyond]).toEqual([37, P + 12 * HOUR, false]);
    // Past a hundred the count says only that more passed.
    const old = one(schedule("old", "@every 1h", P - 200 * HOUR), P);

    expect([old.passed, old.beyond, old.last]).toEqual([100, true, P - 100 * HOUR]);
  });

  it("gives a daily expression at UTC+02:00 its run at 01:00 UTC, awaited on one side of it and due then overdue on the other", () => {
    // The backup of the submission is named by a wall clock two hours east of UTC, created at the submission.
    const submitted = Date.parse("2026-10-26T13:20:05Z");
    const derived = schedule("derived", "0 3 * * *", submitted);
    const backups = [backup("derived", submitted + 2 * HOUR, submitted + 2 * SECOND)];
    const run = Date.parse("2026-10-27T01:00:00Z");
    const state = (clock: number) => one(derived, clock, backups).state;

    expect(one(derived, P, backups).at).toBe(run);
    expect(one(derived, P, backups).zone).toEqual({ of: "fixed", minutes: 120 });
    expect([state(run - SECOND), state(run), state(run + SECOND), state(run + 6 * MINUTE)]).toEqual([
      "awaited",
      "awaited",
      "due",
      "overdue",
    ]);
    expect(adherence.runText({ of: "fixed", minutes: 120 }, run, P)).toBe("03:00 UTC+02:00 on 2026-10-27");
    expect(adherence.moment({ of: "fixed", minutes: 120 }, submitted)).toBe("2026-10-26 15:20:05 UTC+02:00");
    // Without an offset of the server it is not known, for want of one.
    expect(attributes(one(derived, P))).toEqual({
      next: "not-known",
      state: "not-known",
      mark: "not-known",
      reason: "no-offset",
    });
  });

  it("finds the 02:30 of Rome after an instant, both runs of the hour it repeats on 2026-10-25 among them", () => {
    const rome = (created: string, clock: number) =>
      one(schedule("zoned", "CRON_TZ=Europe/Rome 30 2 * * *", undefined, Date.parse(created)), clock);

    expect(rome("2026-07-01T12:00:00Z", Date.parse("2026-07-01T13:00:00Z")).at).toBe(
      Date.parse("2026-07-02T00:30:00Z"),
    );
    // The first 02:30 of the day the hour repeats is at UTC+02:00, the second at UTC+01:00.
    expect(rome("2026-10-24T12:00:00Z", Date.parse("2026-10-24T13:00:00Z")).at).toBe(
      Date.parse("2026-10-25T00:30:00Z"),
    );
    expect(rome("2026-10-25T00:45:00Z", Date.parse("2026-10-25T00:50:00Z")).at).toBe(
      Date.parse("2026-10-25T01:30:00Z"),
    );
    expect(adherence.moment({ of: "named", name: "Europe/Rome" }, Date.parse("2026-10-25T01:30:00Z"))).toBe(
      "2026-10-25 02:30:00 Europe/Rome",
    );
  });

  it("finds the new year of Buenos Aires on each side of it, through Intl", () => {
    const expression = `CRON_TZ=${adherence.BUENOS_AIRES} 0 0 1 1 *`;
    const before = one(schedule("long", expression, Date.parse("2026-12-31T02:59:59Z")), P);
    const after = one(schedule("long", expression, Date.parse("2027-01-01T03:00:00Z")), P);

    expect(adherence.zoneKnown(adherence.BUENOS_AIRES)).toBe(true);
    expect([before.at, before.state, before.zone]).toEqual([
      Date.parse("2027-01-01T03:00:00Z"),
      "awaited",
      { of: "named", name: adherence.BUENOS_AIRES },
    ]);
    expect(after.at).toBe(Date.parse("2028-01-01T03:00:00Z"));
    expect(adherence.runText(before.zone, before.at ?? 0, Date.parse("2026-12-31T12:00:00Z"))).toBe(
      `00:00 ${adherence.BUENOS_AIRES} on 2027-01-01`,
    );
  });

  it("expects either state of a schedule read across the edge of the grace, at the clock before the read less twenty seconds and after it", () => {
    const run = Date.parse("2026-10-26T15:00:00Z");
    const item = schedule("edge", "@every 1h", run - HOUR);
    const before = run + 5 * MINUTE + 10 * SECOND;
    const clocks = adherence.clocksAround(before, before + 2 * SECOND);

    expect(clocks).toEqual({ from: before - 20 * SECOND, to: before + 3 * SECOND });
    expect(
      adherence.expectedAround(item, { schedules: [item], backups: [] }, clocks).map((expected) => expected.state),
    ).toEqual(["due", "overdue"]);
  });

  it("says a schedule held by a backup in progress, late once the grace passed, and one with no instant at every look", () => {
    const item = schedule("held", "@every 1h", P - 3 * HOUR);
    const holds = [backup("held", P, P + SECOND, "InProgress")];
    const held = one(item, P + MINUTE, holds);

    expect([held.state, held.mark, held.held, held.at]).toEqual(["held", "late", holds[0].metadata.name, P - 2 * HOUR]);
    expect(one(schedule("soon", "@every 1h", P - HOUR), P + MINUTE, [backup("soon", P, P, "New")]).mark).toBe(
      "awaited",
    );
    expect(attributes(one(schedule("look", "0 0 30 2 *", P - MINUTE), P))).toEqual({
      next: "none",
      state: "at-every-look",
      mark: "not-known",
      reason: "",
    });
  });

  it("reads a duration of two units back into its span, and compares spans, never two texts", () => {
    expect(adherence.durationSpan("2d 3h")).toEqual([2 * DAY + 3 * HOUR, 2 * DAY + 4 * HOUR]);
    expect(adherence.durationSpan("5m")).toEqual([5 * MINUTE, 5 * MINUTE + SECOND]);
    expect(adherence.durationSpan("less than a second")).toEqual([0, SECOND]);
    const said = "Overdue by 2d 3h: expected at 13:20:07 UTC.";
    const form = (low: number, high: number): Part[] => ["Overdue by ", { between: [low, high] }, ": expected at "];

    // The computed span is inside the hour the words stand for, or overlaps one of its ends.
    expect(adherence.holdsForm(said, form(2 * DAY + 3 * HOUR + 30 * MINUTE, 2 * DAY + 3 * HOUR + 31 * MINUTE))).toBe(
      true,
    );
    expect(adherence.holdsForm(said, form(2 * DAY + 2 * HOUR + 59 * MINUTE, 2 * DAY + 3 * HOUR))).toBe(true);
    expect(adherence.holdsForm(said, form(2 * DAY + 4 * HOUR, 2 * DAY + 5 * HOUR))).toBe(false);
    expect(adherence.holdsForm(said, form(2 * DAY + 2 * HOUR, 2 * DAY + 2 * HOUR + 59 * MINUTE))).toBe(false);
  });

  it("derives the offset of the server with a remainder under a minute, the newest submission standing", () => {
    const daily = (name: string, submitted: number) => schedule(name, "0 3 * * *", submitted);
    const offset = (remainder: number) =>
      adherence.serverOffset([daily("one", P)], [backup("one", P + 2 * HOUR + remainder, P)])?.minutes;

    expect([offset(0), offset(50 * SECOND), offset(-50 * SECOND)]).toEqual([120, 120, 120]);
    expect([offset(60 * SECOND), offset(61 * SECOND)]).toEqual([undefined, undefined]);
    // A backup two minutes from its submission is not the backup of it, though its name would give an offset.
    expect(
      adherence.serverOffset([daily("one", P)], [backup("one", P + 2 * HOUR + 2 * MINUTE, P + 2 * MINUTE)]),
    ).toBeUndefined();
    const split = adherence.serverOffset(
      [daily("newer", P), daily("older", P - 20 * SECOND)],
      [backup("newer", P + 2 * HOUR, P), backup("older", P, P + 5 * SECOND)],
    );

    expect(split).toEqual({
      minutes: 120,
      schedule: "newer",
      backup: backup("newer", P + 2 * HOUR, P).metadata.name,
      submission: P,
      changed: {
        minutes: 0,
        schedule: "older",
        backup: backup("older", P, P).metadata.name,
        submission: P - 20 * SECOND,
      },
    });
  });

  it("orders by adherence and by the next run as the list does, and refuses an expression it does not know", () => {
    const named = (name: string, state: Expected["state"], next: Expected["next"], at?: number): [string, Expected] => [
      name,
      { state, next, mark: "awaited", reason: "", zone: adherence.UTC, anchor: { of: "creation", at: 0 }, at },
    ];
    const expected = Object.fromEntries([
      named("b-awaited", "awaited", "at", 30),
      named("a-awaited", "awaited", "at", 30),
      named("soon", "awaited", "at", 20),
      named("look", "at-every-look", "none"),
      named("unknown", "not-known", "not-known"),
      named("late", "overdue", "at", 2),
      named("later", "overdue", "at", 1),
      named("held", "held", "at", 5),
    ]);

    expect(adherence.byAdherence(expected)).toEqual([
      "later",
      "late",
      "held",
      "look",
      "unknown",
      "soon",
      "a-awaited",
      "b-awaited",
    ]);
    expect(adherence.byNextRun(expected)).toEqual([
      "later",
      "late",
      "held",
      "soon",
      "a-awaited",
      "b-awaited",
      "unknown",
      "look",
    ]);
    expect(() => one(schedule("other", "*/5 * * * *", P), P)).toThrow(/is not one of them: it is not a parser/);
  });

  it("counts from the last submission when the last skip is earlier, and no run at the very instant of the clock", () => {
    const skippedBefore = one(schedule("kept", "@every 24h", P - HOUR, P - 2 * DAY, P - 3 * HOUR), P);
    const hourly = schedule("hourly", "@every 1h", P - HOUR);

    expect(skippedBefore.anchor).toEqual({ of: "last-submission", at: P - HOUR });
    // The run is at the clock itself: it has not passed, and the schedule awaits it.
    expect([one(hourly, P).at, one(hourly, P).passed, one(hourly, P).state]).toEqual([P, 0, "awaited"]);
    expect([one(hourly, P + 1).passed, one(hourly, P + 1).state]).toEqual([1, "due"]);
  });

  it("says due at the very edge of the grace, overdue past it, and overdue at the clock after the read by its second alone", () => {
    const run = Date.parse("2026-10-26T15:00:00Z");
    const item = schedule("edge", "@every 1h", run - HOUR);
    const state = (clock: number) => one(item, clock).state;

    expect([state(run + adherence.GRACE), state(run + adherence.GRACE + 1)]).toEqual(["due", "overdue"]);
    // Read with the clock after it at the edge itself: only the second of the clock of the cluster passes it.
    const after = run + adherence.GRACE;
    const clocks = adherence.clocksAround(after - 2 * SECOND, after);

    expect(
      adherence.expectedAround(item, { schedules: [item], backups: [] }, clocks).map((expected) => expected.state),
    ).toEqual(["due", "overdue"]);
  });

  it("holds by a backup with no phase, names the newest that holds, and takes the nearest backup as the one of a submission", () => {
    const item = schedule("held", "@every 1h", P - 3 * HOUR);
    const older = backup("held", P - HOUR, P + SECOND, "");
    const newer = backup("held", P, P + 2 * SECOND, "InProgress");

    expect([one(item, P, [older]).state, one(item, P, [older]).held]).toEqual(["held", older.metadata.name]);
    expect(one(item, P, [older, newer]).held).toBe(newer.metadata.name);
    expect(one(item, P, [newer, older]).held).toBe(newer.metadata.name);
    // Two backups of the schedule within a minute of its submission: the nearer is the one of it.
    const daily = schedule("daily", "0 3 * * *", P);
    const near = backup("daily", P + 2 * HOUR, P + 10 * SECOND);
    const far = backup("daily", P + 2 * HOUR - MINUTE, P + 40 * SECOND);

    expect(adherence.submissionBackup(daily, [far, near])?.metadata.name).toBe(near.metadata.name);
    expect(adherence.submissionBackup(daily, [near, far])?.metadata.name).toBe(near.metadata.name);
    // The name of the schedule is read as it is written: a dot in it is a dot.
    const dotted = schedule("a.b", "0 3 * * *", P);
    const other = backup("axb", P + 2 * HOUR, P);

    expect(
      adherence.submissionBackup(dotted, [
        { ...other, metadata: { ...other.metadata, labels: { "velero.io/schedule-name": "a.b" } } },
      ]),
    ).toBeUndefined();
    expect(adherence.submissionBackup(dotted, [backup("a.b", P + 2 * HOUR, P)])?.metadata.name).toMatch(
      /^a\.b-\d{14}$/,
    );
  });

  it("derives offsets of a half hour and west of UTC by the quarter of an hour, and writes a run of the day of the clock without its date", () => {
    const daily = (name: string) => schedule(name, "0 3 * * *", P);
    const offset = (shift: number) => adherence.serverOffset([daily("one")], [backup("one", P + shift, P)])?.minutes;

    expect([offset(5 * HOUR + 30 * MINUTE), offset(-3 * HOUR), offset(5 * HOUR + 45 * MINUTE)]).toEqual([
      330, -180, 345,
    ]);
    expect([
      adherence.zoneName({ of: "fixed", minutes: 330 }),
      adherence.zoneName({ of: "fixed", minutes: -180 }),
    ]).toEqual(["UTC+05:30", "UTC-03:00"]);
    expect(adherence.moment({ of: "fixed", minutes: -180 }, P)).toBe("2026-10-26 10:20:07 UTC-03:00");
    // The day of the clock: the time alone, its seconds only when they are not zero.
    expect(adherence.runText(adherence.UTC, P + HOUR, P)).toBe("14:20:07 UTC");
    expect(adherence.runText({ of: "fixed", minutes: 120 }, Date.parse("2026-10-26T13:00:00Z"), P)).toBe(
      "15:00 UTC+02:00",
    );
  });

  it("finds the 02:30 of Rome on the day the hour is skipped at the first instant after the change", () => {
    const created = Date.parse("2027-03-27T12:00:00Z");
    const rome = one(schedule("zoned", "CRON_TZ=Europe/Rome 30 2 * * *", undefined, created), created + MINUTE);

    expect(rome.at).toBe(Date.parse("2027-03-28T01:00:00Z"));
    expect(cluster.halfPastTwoInRome(Date.parse("2027-03-28T01:00:00Z"))).toBe(Date.parse("2027-03-29T00:30:00Z"));
  });

  it("says not known a schedule whose zone the page does not know, with its words, and knows the zones Node knows", () => {
    const expression = `CRON_TZ=${adherence.BUENOS_AIRES} 0 0 1 1 *`;
    const item = schedule(LONG, expression, P);
    const installation = { schedules: [item], backups: [] };
    const unknown = adherence.expectedOf(item, installation, P, () => false);

    expect(adherence.zoneKnown("Mars/Olympus_Mons")).toBe(false);
    expect([attributes(unknown), unknown.zone, unknown.at]).toEqual([
      { next: "not-known", state: "not-known", mark: "not-known", reason: "unknown-zone" },
      adherence.UTC,
      undefined,
    ]);
    const [form] = bandForms(LONG, installation, { from: P, to: P }, () => false);

    expect([form.next, form.zone, form.label, form.host]).toEqual([
      [WORDS.unknownZone(adherence.BUENOS_AIRES)],
      WORDS.zone.namedNotKnown(adherence.BUENOS_AIRES),
      "Not known",
      false,
    ]);
    expect(adherence.expectedOf(item, installation, P).state).toBe("awaited");
  });

  it("says the next run ago or in by as much as the clock of the page is from it, a run between the two clocks either way", () => {
    const run = Date.parse("2026-10-27T01:00:00Z");
    const item = schedule("between", "@every 1h", run - HOUR);
    const words = (clocks: Clocks) =>
      nextWords(adherence.expectedAround(item, { schedules: [item], backups: [] }, clocks));
    const across = words({ from: run - 10 * SECOND, to: run + 10 * SECOND });

    expect(
      ["5s ago", "in 5s", "less than a second ago", "15s ago", "in 15s"].map((said) =>
        adherence.isForm(said, ...across),
      ),
    ).toEqual([true, true, true, false, false]);
    const past = words({ from: run + MINUTE, to: run + MINUTE + 20 * SECOND });

    expect(["1m 10s ago", "in 5s", "50s ago"].map((said) => adherence.isForm(said, ...past))).toEqual([
      true,
      false,
      false,
    ]);
  });

  it("says of a band the last submission ahead of the clocks as read before it, a newer backup that is not a submission, and the last submission of a schedule at every look", () => {
    const clocks = adherence.clocksAround(P, P + SECOND);
    const ahead = schedule("ahead", "@every 24h", P + DAY);
    const [aheadForm] = bandForms("ahead", { schedules: [ahead], backups: [] }, clocks);

    expect(
      adherence.isForm(
        "Last submission 2026-10-27 13:20:07 UTC: whether its backup exists is not known, since the backups were last read 12s ago, before it.",
        aheadForm.observed,
      ),
    ).toBe(true);
    const held = schedule("held", "@every 1h", P - 3 * HOUR);
    const holding = backup("held", P, P + SECOND, "InProgress");
    const [heldForm] = bandForms("held", { schedules: [held], backups: [holding] }, clocks);

    expect([heldForm.observed, heldForm.held]).toEqual([
      [
        WORDS.observed.notFound("2026-10-26 10:20:07 UTC"),
        ` ${WORDS.observed.newer(holding.metadata.name, "2026-10-26 13:20:08 UTC")}`,
      ],
      WORDS.heldNow(holding.metadata.name),
    ]);
    // At every look the words say the last submission, a skip after it moving only the anchor.
    const look = schedule("look", "0 0 30 2 *", P - MINUTE, P - DAY, P);
    const [lookForm] = bandForms("look", { schedules: [look], backups: [] }, clocks);

    expect([lookForm.next, lookForm.notes, lookForm.anchor]).toEqual([
      [WORDS.atEveryLook("2026-10-26 13:19:07 UTC")],
      [],
      "The last skip, 2026-10-26 13:20:07 UTC",
    ]);
  });

  it("reads the counters of the API server by verb, kind and scope, and the guard keeps out only what the controllers write of one object", () => {
    const line = (resource: string, scope: string, verb: string, count: number) =>
      `apiserver_request_total{code="200",component="apiserver",dry_run="",group="velero.io",resource="${resource}",scope="${scope}",subresource="",verb="${verb}",version="v1"} ${count}`;
    const metrics = (patched: number, located: number, listed: number) =>
      [
        "# HELP apiserver_request_total Counter of apiserver requests",
        line("schedules", "resource", "PATCH", patched),
        line("backupstoragelocations", "resource", "PATCH", located),
        line("backups", "resource", "POST", 1348),
        line("schedules", "namespace", "LIST", listed),
        'apiserver_request_total{code="200",group="apps",resource="deployments",scope="namespace",verb="LIST"} 3',
      ].join("\n");
    // Three minutes of the controller of the installation of the demo, read as the counters gave them.
    const more = cluster.counted(cluster.countsOf(metrics(19, 40, 7)), cluster.countsOf(metrics(22, 41, 9)));

    expect(more).toEqual({
      "PATCH schedules resource": 3,
      "PATCH backupstoragelocations resource": 1,
      "LIST schedules namespace": 2,
    });
    // The guard of the suites, over those three minutes, leaves them out.
    expect(writesOf(more, true, 3)).toEqual({});
    expect(createdBackups(more)).toEqual([]);
    // A backup created, a PATCH of a backup, one of the schedules of another scope and more PATCHes of a schedule by
    // its name than the minutes and two are what the guard is for.
    const written = {
      ...more,
      "PATCH schedules resource": 6,
      "POST backups resource": 1,
      "PATCH backups resource": 1,
      "PATCH schedules namespace": 1,
    };

    expect(writesOf(written, true, 3)).toEqual({
      "PATCH schedules resource": 1,
      "POST backups resource": 1,
      "PATCH backups resource": 1,
      "PATCH schedules namespace": 1,
    });
    expect(createdBackups(written)).toEqual(["POST backups resource"]);
  });
});

describe("adherence of the schedules on its fixtures", () => {
  let started: velero.StartedApplication;
  let frame: Frame;
  const errors = velero.createErrorCollector();
  let before: cluster.ClusterSnapshot;
  let counted: Record<string, number>;
  // The installation of the states as the cluster held it when the suite began, and when it was placed.
  let states: Installation;
  let placed = 0;
  const row = (name: string) =>
    frame.locator("[data-testid=velero-schedules] .TableRow", {
      has: frame.locator(`[data-schedule-row="${name}"]`),
    });
  // How many tips are shown once that many are, or after ten seconds.
  const tipsShown = async (count: number) => {
    const tips = frame.locator("[role=tooltip]:visible");
    const deadline = Date.now() + 10_000;
    let shown = await tips.count();

    while (shown !== count && Date.now() < deadline) {
      await frame.waitForTimeout(100);
      shown = await tips.count();
    }
    return shown;
  };
  // Whether the tip of a cell shows when the cell is pointed at, and only then: none before, one with words after.
  // Its words are the host's, and are not read.
  const tipShown = async (name: string, column: "next" | "adherence") => {
    const before = await tipsShown(0);

    await row(name)
      .locator(`.TableCell.${column} ${column === "next" ? "[data-next]" : "[data-adherence]"}`)
      .hover();
    const after = await tipsShown(1);
    const words = after === 1 ? (await frame.locator("[role=tooltip]:visible").innerText()).trim() : "";

    await started.window.mouse.move(1, 1);
    return before === 0 && after === 1 && words !== "";
  };
  // The rows of the list, in their order once the head of a column is clicked.
  const ordered = async (column: string, expected: string[][]) => {
    const deadline = Date.now() + 10_000;
    let names: string[] = [];

    await frame.click(`[data-testid=velero-schedules] .TableHead .TableCell.${column}`);
    do {
      names = await cluster.mounted(frame, SCHEDULES);
      if (expected.some((order) => order.join() === names.join())) break;
      await frame.waitForTimeout(250);
    } while (Date.now() < deadline);
    return names;
  };
  // The expectations of every schedule of the installation of the states at the two clocks of a read.
  const expectations = (clocks: Clocks) =>
    [clocks.from, clocks.to].map((clock) =>
      Object.fromEntries(
        STATES.map((name) => [name, adherence.expectedOf(scheduleOf(states, name), states, clock, knows)] as const),
      ),
    );
  // What the API server counted of the kinds of Velero while a view stayed open for a period of the reads of the
  // views, but its reads and what the controllers write by themselves, by the rule of the guard of the suites.
  const countedWhileOpen = async (view: string): Promise<[string, string[]]> => {
    const opened = cluster.apiRequests();

    await cluster.afterRead(frame);
    await frame.waitForTimeout(16 * SECOND);

    return [view, Object.keys(cluster.writes(opened, cluster.apiRequests()))];
  };

  beforeAll(async () => {
    if (!cluster.fixturesReady()) {
      throw new Error(cluster.fixturesMissing());
    }
    if (
      !cluster.E2E_ADHERENCE_NAMESPACE ||
      !cluster.E2E_ADHERENCE_SPLIT_NAMESPACE ||
      !cluster.E2E_ADHERENCE_SCALE_NAMESPACE
    ) {
      throw new Error(
        "E2E_ADHERENCE_NAMESPACE, E2E_ADHERENCE_SPLIT_NAMESPACE and E2E_ADHERENCE_SCALE_NAMESPACE name the installations of the adherence: `pnpm e2e:views` gives them",
      );
    }
    before = cluster.clusterSnapshot();
    states = installationOf(cluster.E2E_ADHERENCE_NAMESPACE);
    placed = Date.parse(
      (states.schedules[0] as HeldObject & { metadata: { annotations?: Record<string, string> } }).metadata
        .annotations?.[PLACED] ?? "",
    );
    errors.start();
    let kubeconfig = "";

    // The kubeconfig is in the profile before the install is asked, for each start of the application.
    started = await velero.startWithExtension(async () => {
      kubeconfig = await cluster.publishKubeconfig();
    });
    errors.watch(started.window);
    await velero.dismissNotifications(started.window);
    await velero.navigateToCatalog(started.app);
    expect(await velero.catalogClusterCount(started.window)).toBe(1);
    // What the API server counted before the frame of the cluster, and the extension in it, is there.
    counted = cluster.apiRequests();
    frame = await cluster.openClusterFromCatalog(started.window, kubeconfig);
    await velero.setWindowSize(started.app, 1440, 900);
  }, TIMEOUT);

  afterAll(async () => {
    if (started) errors.stop(started.window);
    await started?.cleanup();
  }, TIMEOUT);

  it(
    "lists the eight schedules of the installation of the states, each with its next run and its adherence as the rules give them",
    async () => {
      // The fixtures are as they were placed, counted from the clock of the placement, and good for twelve hours
      // after it: a run that reaches this case past them places them again before the suites.
      const submitted = (name: string) => Date.parse(scheduleOf(states, name).status?.lastBackup ?? "");

      expect(Number.isFinite(placed)).toBe(true);
      const age = { placed: new Date(placed).toISOString(), minutes: Math.round((Date.now() - placed) / MINUTE) };

      expect([age, age.minutes < 12 * 60]).toEqual([age, true]);
      expect(
        [
          "adherence-awaited",
          "adherence-overdue",
          "adherence-held",
          "adherence-every-look",
          "adherence-ahead",
          LONG,
        ].map((name) => (submitted(name) - Math.floor(placed / SECOND) * SECOND) / MINUTE),
      ).toEqual([0, -25 * 60, -3 * 60, -1, 24 * 60, 0]);
      await cluster.openPage(frame, SCHEDULES);
      await frame.waitForSelector("[data-testid=velero-state-choose], [data-testid=velero-schedules]", {
        timeout: 60_000,
      });
      // The installations of the adherence hold no storage location: the operator names them.
      await cluster.configureInstallation(frame, cluster.E2E_ADHERENCE_NAMESPACE);
      await cluster.waitForList(frame, SCHEDULES);
      expect((await cluster.target(frame)).namespace).toBe(`${cluster.E2E_ADHERENCE_NAMESPACE} (configured)`);
      expect((await cluster.mounted(frame, SCHEDULES)).sort()).toEqual([...STATES].sort());
      // The clock of the cluster is ahead of this machine by what the schedule ahead reports: said once over the
      // list, and printed before it is asserted. The expectations take the clock of the cluster within a second of
      // the one of this machine, as its API server gives it on kind: a clock further off fails here, by its words.
      const noted = Date.now();
      const notes = await frame.$$eval("[data-testid=velero-schedules-note] > span", (elements) =>
        elements.map((element) => (element.textContent ?? "").replace(/\s+/g, " ").trim()),
      );
      const noteClocks = adherence.clocksAround(noted, Date.now());

      console.log(`ADH-07 ${JSON.stringify({ notes })}`);
      expect(notes).toHaveLength(1);
      expect([notes[0], clocksHold(notes[0], "adherence-ahead", states, noteClocks)]).toEqual([notes[0], true]);
      expect([notes[0], notes[0].includes("it is within a second of the clock of this machine")]).toEqual([
        notes[0],
        true,
      ]);
      for (const name of STATES) {
        const read = Date.now();
        const shown = await cluster.rowAdherence(frame, name);
        const cells = await cluster.cellsOf(SCHEDULES, frame, name);
        const clocks = adherence.clocksAround(read, Date.now());
        const expected = adherence.expectedAround(scheduleOf(states, name), states, clocks, knows);

        expect([name, expected.map(attributes)]).toEqual([name, expect.arrayContaining([shown])]);
        expect([name, cells.adherence]).toEqual([name, WORDS.label[shown.state as Expected["state"]]]);
        expect([name, cells.next, adherence.isForm(cells.next, ...nextWords(expected))]).toEqual([
          name,
          cells.next,
          true,
        ]);
        expect([name, await tipShown(name, "next"), await tipShown(name, "adherence")]).toEqual([name, true, true]);
      }
      expect(await cluster.layoutProblems(frame, SCHEDULES)).toEqual([]);
      await cluster.captureScreenshot(frame, "dark-adherence-schedules");
    },
    TIMEOUT,
  );

  it(
    "orders the schedules by the next run and by adherence, both ways, and finds the schedules of a state by its word",
    async () => {
      // The clock before the click and after the rows settled: an order computed at either is accepted. The rows
      // are awaited, ten seconds at most, until they are one of the orders computed for a read that long.
      const ordersAt = (column: string, reversed: boolean, clocks: Clocks) =>
        expectations(clocks)
          .map((expected) => (column === "next" ? adherence.byNextRun(expected) : adherence.byAdherence(expected)))
          .map((order) => (reversed ? [...order].reverse() : order));

      for (const column of ["next", "adherence"]) {
        for (const reversed of [false, true]) {
          const asked = Date.now();
          const rows = await ordered(column, ordersAt(column, reversed, adherence.clocksAround(asked, asked + 10_000)));
          const orders = ordersAt(column, reversed, adherence.clocksAround(asked, Date.now()));

          expect([column, reversed, orders]).toEqual([column, reversed, expect.arrayContaining([rows])]);
        }
      }
      // The word of a state finds the schedules in it, and its name when the name holds the word.
      const inState = (word: string, clocks: Clocks) =>
        expectations(clocks).map((expected) =>
          STATES.filter(
            (name) =>
              WORDS.label[expected[name].state].toLowerCase() === word.toLowerCase() ||
              name.includes(word.toLowerCase().replace(/ /g, "-")),
          ).sort(),
        );

      for (const word of ["Overdue", "At every look"]) {
        const asked = Date.now();
        const found = [...(await cluster.search(frame, word, SCHEDULES))].sort();
        const expected = inState(word, adherence.clocksAround(asked, Date.now()));

        expect([word, expected]).toEqual([word, expect.arrayContaining([found])]);
      }
      // A sentence of a state is not searched.
      expect(await cluster.search(frame, "Velero may not be at work", SCHEDULES)).toEqual([]);
      await cluster.search(frame, "", SCHEDULES);
    },
    TIMEOUT,
  );

  it(
    "says in the band of each schedule its state, its zone, its anchor, its last observed run, what holds it, the runs that passed and the clocks",
    async () => {
      for (const name of STATES) {
        await cluster.openWorkspace(frame, name, SCHEDULES);
        const read = Date.now();
        const band = await cluster.adherenceBand(frame);
        const clocks = adherence.clocksAround(read, Date.now());
        const forms = bandForms(name, states, clocks);
        // The word beside the mark, the sentence whole, each note under it exactly, and the grace and the date of
        // the host where they apply.
        const holding = (form: BandForm) =>
          form.state === band.state &&
          form.order.join() === band.order.join() &&
          band.next.word === form.label &&
          (form.whole ? adherence.isForm : adherence.holdsForm)(band.next.words, form.next) &&
          JSON.stringify(band.next.notes) === JSON.stringify(form.notes) &&
          band.next.grace === form.grace &&
          band.next.host === form.host &&
          band.lines.next.includes(WORDS.grace) === form.grace &&
          band.lines.next.includes(WORDS.hostTime) === form.host &&
          band.lines.zone === form.zone &&
          band.lines.anchor === form.anchor &&
          adherence.isForm(band.lines.observed, form.observed) &&
          band.lines.held === form.held &&
          band.lines.passed === form.passed;

        if (name === STATES[0]) console.log(`ADH-07 ${JSON.stringify({ clocks: band.lines.clocks })}`);
        expect([name, band, forms.some(holding)]).toEqual([name, band, true]);
        // Every band of the installation names the schedule whose last submission is ahead of this machine.
        expect([name, clocksHold(band.lines.clocks, "adherence-ahead", states, clocks)]).toEqual([name, true]);
        expect([name, await cluster.layoutProblems(frame, SCHEDULES)]).toEqual([name, []]);
        if (name === LONG) {
          // The name of 63 characters wraps in the sentence that holds it, with nothing over anything else.
          expect(LONG).toHaveLength(63);
          await cluster.captureScreenshot(frame, "dark-adherence-band-long-name");
        }
        if (name === "adherence-held") {
          const held = scheduleOf(states, name);
          const backup = adherence.holdingBackup(held, states.backups) ?? "";

          // The backup that holds is not a submission, in UTC, as the command line names one asked by hand; its
          // ways are on the line of the last observed run and on the line of what holds.
          expect(backup).toMatch(/^adherence-held-\d{14}$/);
          expect(band.ways).toEqual([`velero-open-backup-${backup}`, `velero-open-backup-${backup}`]);
          await cluster.captureScreenshot(frame, "dark-adherence-band-held");
        } else {
          expect([name, band.ways]).toEqual([
            name,
            name === "adherence-derived"
              ? [
                  `velero-open-backup-${adherence.submissionBackup(scheduleOf(states, name), states.backups)?.metadata.name}`,
                ]
              : [],
          ]);
        }
        await cluster.closeWorkspace(frame);
      }
    },
    TIMEOUT,
  );

  it(
    "leads from the band of the held schedule to the backup that holds it and back, over the list, which is where it was",
    async () => {
      const held = adherence.holdingBackup(scheduleOf(states, "adherence-held"), states.backups) ?? "";

      await cluster.search(frame, "adherence", SCHEDULES);
      await frame.click("[data-testid=velero-schedules] .TableHead .TableCell.name");
      const list = await cluster.listState(frame, SCHEDULES);

      expect(list.search).toBe("adherence");
      await cluster.openWorkspace(frame, "adherence-held", SCHEDULES);
      await frame.click(
        `[data-testid=velero-schedule-adherence] [data-line=held] [data-testid="velero-open-backup-${held}"]`,
      );
      await frame.waitForSelector(`[data-testid=velero-backup-name] >> text="${held}"`, { timeout: 60_000 });
      expect(await cluster.shownView(frame)).toEqual({
        kind: "backup",
        name: held,
        back: "arrow_back Schedules / adherence-held",
      });
      expect(await frame.locator("[data-testid=velero-schedules-page]").count()).toBe(1);
      expect(await cluster.addressViews(frame)).toEqual(["schedule/adherence-held", `backup/${held}`]);
      await cluster.closeWorkspace(frame);
      expect((await cluster.shownView(frame))?.name).toBe("adherence-held");
      expect(await cluster.focusOn(frame, "velero-back")).toBe("velero-back");
      await cluster.closeWorkspace(frame);
      expect(await cluster.focusOn(frame, "adherence-held")).toBe("adherence-held");
      expect(await cluster.listStateLike(frame, list, SCHEDULES)).toEqual(list);
      await cluster.search(frame, "", SCHEDULES);
    },
    TIMEOUT,
  );

  it(
    "says of the installation of two offsets that the newest stands, and that it was UTC at the submission before it",
    async () => {
      const split = installationOf(cluster.E2E_ADHERENCE_SPLIT_NAMESPACE);
      const submitted = (name: string) => Date.parse(scheduleOf(split, name).status?.lastBackup ?? "");

      // The older submission is before the newer one, or the offset of the older would be the newest.
      expect([
        "split-older before split-newer",
        submitted("split-older") < submitted("split-newer"),
        scheduleOf(split, "split-older").status?.lastBackup,
        scheduleOf(split, "split-newer").status?.lastBackup,
      ]).toEqual([
        "split-older before split-newer",
        true,
        scheduleOf(split, "split-older").status?.lastBackup,
        scheduleOf(split, "split-newer").status?.lastBackup,
      ]);
      const offset = adherence.serverOffset(split.schedules, split.backups);

      expect([offset?.minutes, offset?.schedule, offset?.changed?.minutes, offset?.changed?.schedule]).toEqual([
        120,
        "split-newer",
        0,
        "split-older",
      ]);
      await cluster.configureInstallation(frame, cluster.E2E_ADHERENCE_SPLIT_NAMESPACE);
      await frame.waitForSelector('[data-testid=velero-schedules] [data-schedule-row="split-older"]', {
        timeout: 60_000,
      });
      for (const name of ["split-newer", "split-older"]) {
        const read = Date.now();
        const shown = await cluster.rowAdherence(frame, name);
        const clocks = adherence.clocksAround(read, Date.now());

        expect([name, adherence.expectedAround(scheduleOf(split, name), split, clocks, knows).map(attributes)]).toEqual(
          [name, expect.arrayContaining([shown])],
        );
        await cluster.openWorkspace(frame, name, SCHEDULES);
        const opened = Date.now();
        const band = await cluster.adherenceBand(frame);
        const forms = bandForms(name, split, adherence.clocksAround(opened, Date.now()));

        // The zone of the newest submission, and the words that it changed, with the backup of the older one.
        expect([name, band.lines.zone]).toEqual([name, forms[0].zone]);
        expect([name, band.next.notes]).toEqual([name, forms[0].notes]);
        expect([name, band.next.notes.length]).toEqual([name, 2]);
        expect(band.lines.next).toContain("The offset was UTC when the server submitted the backup split-older-");
        expect(await cluster.layoutProblems(frame, SCHEDULES)).toEqual([]);
        await cluster.captureScreenshot(frame, `dark-adherence-band-${name}`);
        await cluster.closeWorkspace(frame);
      }
    },
    TIMEOUT,
  );

  it(
    "gives the details of the host of a schedule of each state what its row and its band say",
    async () => {
      const named = [
        "adherence-awaited",
        "adherence-overdue",
        "adherence-held",
        "adherence-every-look",
        "adherence-derived",
      ];

      // The details compute with the reads of the views of the installation that is selected.
      await cluster.selectInstallation(frame, cluster.E2E_ADHERENCE_NAMESPACE);
      await cluster.waitForList(frame, SCHEDULES);
      const listedAt = Date.now();
      const rows: Record<string, cluster.RowAdherence> = {};

      for (const name of named) rows[name] = await cluster.rowAdherence(frame, name);
      // What the details say of the schedule that is open: the kind of its next run, its state and its reason, the
      // date of the host, and their words.
      const detailsSaid = () =>
        frame.locator("[data-testid=velero-schedule-details]").evaluate((element) => ({
          next: element.querySelector("[data-next]")?.getAttribute("data-next") ?? "",
          state: element.querySelector("[data-adherence]")?.getAttribute("data-adherence") ?? "",
          reason: element.querySelector("[data-adherence]")?.getAttribute("data-reason") ?? "",
          host: element.querySelector("[data-host-time]") !== null,
          words: (element.querySelector("[data-adherence-words]")?.textContent ?? "").replace(/\s+/g, " ").trim(),
        }));

      await cluster.navigate(frame, "/crd/velero.io/schedules");
      await cluster.selectHostNamespace(frame, cluster.E2E_ADHERENCE_NAMESPACE);
      for (const name of named) {
        await cluster.hostDetails(frame, name, "Next run", "Adherence");
        const said = await detailsSaid();
        const clocks = adherence.clocksAround(listedAt, Date.now());
        const expected = adherence.expectedAround(scheduleOf(states, name), states, clocks, knows);
        // The words of the details are the sentence of the state and its notes; the age of the read of the views,
        // which closed, is said after them, and is not read here.
        const words = said.words.replace(/ ?Computed with the backups of the installation as they were read .*$/, "");

        // The same kind of next run as the row, and a state the row or the rules give at the clocks of the two reads.
        expect([name, said.next]).toEqual([name, rows[name].next]);
        expect([name, [rows[name].state, ...expected.map((one) => one.state)]]).toEqual([
          name,
          expect.arrayContaining([said.state]),
        ]);
        // The date of the host is beside an instant, and only beside one.
        expect([name, said.host]).toEqual([name, rows[name].next === "at"]);
        expect([
          name,
          words,
          bandForms(name, states, clocks).some((form) => adherence.holdsForm(words, form.next)),
        ]).toEqual([name, words, true]);
        await cluster.closeDetails(frame);
      }
      // Of an installation that is not the one selected nothing was read, the offset of its server among it: the
      // schedule of five fields of the installation of two offsets, which its own reads give UTC+02:00, is not known
      // for want of an offset, though the installation selected has one of the same.
      await cluster.selectHostNamespace(frame, cluster.E2E_ADHERENCE_SPLIT_NAMESPACE);
      await cluster.hostDetails(frame, "split-newer", "Next run", "Adherence");
      const elsewhere = await detailsSaid();

      expect([elsewhere.next, elsewhere.state, elsewhere.reason, elsewhere.host]).toEqual([
        "not-known",
        "not-known",
        "no-offset",
        false,
      ]);
      expect(elsewhere.words).not.toContain("UTC+02:00");
      await cluster.closeDetails(frame);
      await cluster.captureScreenshot(frame, "dark-adherence-host-details");
      await cluster.openPage(frame, SCHEDULES);
      await cluster.waitForList(frame, SCHEDULES);
    },
    TIMEOUT,
  );

  it(
    "lists in the Overview the schedules that are late or submitted at every look, in the order of the page, and counts what is not known in the views",
    async () => {
      // Of the other rules, A4 alone gives an item in this installation: it holds no storage location (A1 to A3 none,
      // A4 the default one), every schedule is Enabled and read (no A5, no A6), the one backup that ended completed
      // (no A7), no template names a location (no A8), the backup in progress reports no failure (no A9), and no
      // operation ended with a failure (no A10).
      await cluster.openPage(frame, OVERVIEW);
      const read = Date.now();
      const shown = await cluster.overview(frame);
      const clocks = adherence.clocksAround(read, Date.now());
      const all = expectations(clocks);
      // The items of A11: overdue or held beyond the grace at the time of their expected run, at every look at the
      // time of the last submission, from the newest, then by name.
      const items = all.map((expected) =>
        STATES.filter((name) => expected[name].mark === "late" || expected[name].state === "at-every-look")
          .map((name) => ({
            name,
            time:
              expected[name].state === "at-every-look"
                ? Date.parse(scheduleOf(states, name).status?.lastBackup ?? "")
                : (expected[name].at ?? 0),
          }))
          .sort((one, other) => other.time - one.time || (one.name < other.name ? -1 : 1))
          .map(({ name }) => ["A11", name]),
      );

      expect(items).toEqual(expect.arrayContaining([shown.items.slice(1)]));
      expect(shown.items[0]).toEqual(["A4", "Default storage location"]);
      expect(shown.items.slice(1).map(([, name]) => name)).toEqual(
        expect.arrayContaining(["adherence-overdue", "adherence-held", "adherence-every-look"]),
      );
      // The item of the held schedule leads to the backup that holds it as well; the one at every look is timed by
      // its last submission.
      const held = adherence.holdingBackup(scheduleOf(states, "adherence-held"), states.backups) ?? "";

      expect(
        await frame
          .locator(
            '[data-testid=velero-overview-attention] [data-rule="A11"]:has([data-testid="velero-open-schedule-adherence-held"])',
          )
          .locator(`[data-testid="velero-open-backup-${held}"]`)
          .count(),
      ).toBe(1);
      // Nothing is not known, unless the Intl of the application does not know the zone of the long name.
      expect(shown.notKnown).toEqual(
        APPLICATION_KNOWS_BUENOS_AIRES ? undefined : { count: 1, reasons: { "unknown-zone": 1 } },
      );
      expect(shown.summary).toMatch(
        new RegExp(
          `^${shown.items.length} items in what was read\\.${APPLICATION_KNOWS_BUENOS_AIRES ? "" : " The adherence of 1 schedules? is not known\\."}$`,
        ),
      );
      // A line for each of the eight, the ones a rule names first, each with the adherence of its row.
      expect([...shown.schedules].sort()).toEqual([...STATES].sort());
      const lines = all.map((expected) => Object.fromEntries(STATES.map((name) => [name, attributes(expected[name])])));

      expect(lines).toEqual(expect.arrayContaining([shown.adherence]));
      expect(await cluster.valuesOfTheWhole(frame)).toEqual([]);
      expect(await cluster.layoutProblems(frame, OVERVIEW)).toEqual([]);
      await cluster.captureScreenshot(frame, "dark-adherence-overview");
      // In the installation of the views, the count of the schedules whose adherence is not known, by reason.
      await cluster.selectInstallation(frame, cluster.E2E_VIEWS_NAMESPACE);
      await frame.waitForSelector("[data-testid=velero-overview-read-schedules][data-read=read]", { timeout: 60_000 });
      expect((await cluster.overview(frame)).notKnown).toEqual({
        count: 8,
        reasons: { "not-read": 2, "no-offset": 6 },
      });
    },
    TIMEOUT,
  );

  it(
    "says of the schedule the controller validated that it runs a year after its creation, in its row, its band and its line",
    async () => {
      const read = cluster.kubectlE2E(
        "get",
        "schedules.velero.io",
        REAL,
        "--namespace",
        cluster.E2E_NAMESPACE,
        "-o",
        "json",
      );

      expect(read.status).toBe(0);
      const real = JSON.parse(read.stdout) as HeldObject & { spec: { skipImmediately?: unknown } };
      const submissions = cluster.kubectlE2E(
        "get",
        "backups.velero.io",
        "--namespace",
        cluster.E2E_NAMESPACE,
        "--selector",
        `velero.io/schedule-name=${REAL}`,
        "-o",
        "name",
      );

      // Enabled, with whether a run that is due is skipped written by the controller, and nothing submitted.
      expect([real.status?.phase, real.spec.skipImmediately, real.status?.lastBackup]).toEqual([
        "Enabled",
        false,
        undefined,
      ]);
      expect([submissions.status, submissions.stdout]).toEqual([0, ""]);
      const demo: Installation = { schedules: [real], backups: [] };
      const runs = (clocks: Clocks) => adherence.expectedAround(real, demo, clocks, knows);

      await cluster.selectInstallation(frame, cluster.E2E_NAMESPACE);
      await cluster.openPage(frame, SCHEDULES);
      await cluster.waitForList(frame, SCHEDULES);
      const listed = Date.now();
      const shown = await cluster.rowAdherence(frame, REAL);
      const cells = await cluster.cellsOf(SCHEDULES, frame, REAL);
      const clocks = adherence.clocksAround(listed, Date.now());

      // A year after its creation, or its last skip when that is later, as the cluster wrote them.
      const anchor = Math.max(
        Date.parse(real.metadata.creationTimestamp ?? ""),
        real.status?.lastSkipped ? Date.parse(real.status.lastSkipped) : 0,
      );

      expect(runs(clocks)[0].at).toBe(anchor + 8760 * HOUR);
      expect(runs(clocks).map(attributes)).toEqual(expect.arrayContaining([shown]));
      expect([cells.next, adherence.isForm(cells.next, ...nextWords(runs(clocks)))]).toEqual([cells.next, true]);
      await cluster.openWorkspace(frame, REAL, SCHEDULES);
      const opened = Date.now();
      const band = await cluster.adherenceBand(frame);
      const forms = bandForms(REAL, demo, adherence.clocksAround(opened, Date.now()));

      expect([band.lines.next, forms.some((form) => adherence.holdsForm(band.lines.next, form.next))]).toEqual([
        band.lines.next,
        true,
      ]);
      expect(band.lines.anchor).toBe(forms[0].anchor);
      await cluster.closeWorkspace(frame);
      await cluster.openPage(frame, OVERVIEW);
      const lined = Date.now();
      const line = (await cluster.overview(frame)).adherence[REAL];
      const said = text(
        await frame
          .locator(`[data-testid=velero-overview-schedules-list] [data-line="${REAL}"] [data-next]`)
          .innerText(),
      );
      const around = runs(adherence.clocksAround(lined, Date.now()));

      expect(around.map(attributes)).toEqual(expect.arrayContaining([line]));
      expect([said, adherence.isForm(said, ...nextWords(around))]).toEqual([said, true]);
    },
    TIMEOUT,
  );

  it(
    "answers a search and an order of a list of three hundred schedules, and a change of the window of their Overview, within the budget",
    async () => {
      // Each search is of a text the list is not searched by and changes its rows: names, words of a state and parts
      // of the expressions.
      const searches = [
        "schedule-29",
        "Overdue",
        "@every",
        "Awaited",
        "CRON_TZ=America/New_York",
        "At every look",
        "@monthly",
        "schedule-1",
        "Europe/Rome",
        "Asia/Tokyo",
      ];
      // Each order is a column and a direction not asked before, the first click on a head asc and the second desc.
      const orders = [
        "next",
        "next",
        "adherence",
        "adherence",
        "schedule",
        "schedule",
        "submitted",
        "submitted",
        "name",
        "name",
      ];
      const first = async () => (await cluster.mounted(frame, SCHEDULES)).slice(0, 40).join();
      const settled = async () => {
        let rows = await first();

        for (let tries = 0; tries < 40; tries += 1) {
          await frame.waitForTimeout(150);
          const again = await first();

          if (again === rows) return rows;
          rows = again;
        }
        return rows;
      };
      // The first forty rows once they changed from the ones before and held for two reads, or what they are after
      // ten seconds: an order that re-renders slowly is not taken for one that changed nothing.
      const changedFrom = async (previous: string) => {
        const deadline = Date.now() + 10_000;
        let rows = await first();

        while (Date.now() < deadline) {
          await frame.waitForTimeout(150);
          const again = await first();

          if (again === rows && rows !== previous) return rows;
          rows = again;
        }
        return rows;
      };
      // Two clicks on another head, then two on the name: the list is by name, the other way.
      const byNameDesc = async () => {
        for (const column of ["next", "name", "name"]) {
          await frame.click(`[data-testid=velero-schedules] .TableHead .TableCell.${column}`);
        }
        return settled();
      };

      await cluster.openPage(frame, SCHEDULES);
      await cluster.configureInstallation(frame, cluster.E2E_ADHERENCE_SCALE_NAMESPACE);
      await frame.waitForSelector('[data-testid=velero-schedules] >> text="300 items"', { timeout: 60_000 });
      // Warm: the first interactions load what the ones after find loaded.
      for (const search of ["@hourly", "schedule-2", ""]) await cluster.measureSearch(frame, search, SCHEDULES);
      expect(searches.every((search, index) => search !== "" && search !== searches[index - 1])).toBe(true);
      // Every order changes the first forty rows from the one before: asked once untimed from the same start as the
      // timed ones, so that each timed order is one the list computed once before.
      const changed: string[] = [];
      let previous = await byNameDesc();

      for (const [index, column] of orders.entries()) {
        await frame.click(`[data-testid=velero-schedules] .TableHead .TableCell.${column}`);
        const rows = await changedFrom(previous);

        if (rows === previous) changed.push(`${index + 1}: ${column}`);
        previous = rows;
      }
      expect(changed).toEqual([]);
      const times: ({ interaction: string } & cluster.Measure)[] = [];
      let mounted = 0;

      for (const search of searches) {
        times.push({ interaction: `search ${search}`, ...(await cluster.measureSearch(frame, search, SCHEDULES)) });
        mounted = Math.max(mounted, (await cluster.mounted(frame, SCHEDULES)).length);
      }
      await cluster.measureSearch(frame, "", SCHEDULES);
      await byNameDesc();
      for (const [index, column] of orders.entries()) {
        const direction = index % 2 === 0 ? "asc" : "desc";

        times.push({
          interaction: `order ${column} ${direction}`,
          ...(await cluster.measureOrder(frame, column, SCHEDULES)),
        });
        mounted = Math.max(mounted, (await cluster.mounted(frame, SCHEDULES)).length);
      }
      // An order that changes nothing the measure reads is refused, not timed: with one row left by a search, an
      // order changes neither the row nor the words of the list.
      await cluster.measureSearch(frame, "schedule-300", SCHEDULES);
      expect(await cluster.mounted(frame, SCHEDULES)).toHaveLength(1);
      await expect(cluster.measureOrder(frame, "name", SCHEDULES, 2_000)).rejects.toThrow(/Nothing changed after/);
      await cluster.measureSearch(frame, "", SCHEDULES);
      const rounded = (values: number[]) => ({
        p95: Math.round(percentile(values, 0.95)),
        median: Math.round(percentile(values, 0.5)),
        slowest: Math.round(Math.max(...values)),
      });
      const list = {
        measure: "list",
        schedules: Number(/^(\d+) items$/.exec((await cluster.listState(frame, SCHEDULES)).items)?.[1] ?? Number.NaN),
        mounted,
        interactions: times.length,
        budget: BUDGET,
        // What the list takes to show what it is given, the measure the budget is for, and the same from the key.
        response: rounded(times.map((time) => time.response)),
        total: rounded(times.map((time) => time.total)),
        times: times.map((time) => ({
          interaction: time.interaction,
          response: Math.round(time.response),
          total: Math.round(time.total),
        })),
      };

      console.log(`ADH-16 ${JSON.stringify(list)}`);
      await cluster.writeReport("adh-16-list-performance", list);
      // The Overview of the same installation, twenty changes of the window after three that warm it.
      await cluster.openPage(frame, OVERVIEW);
      await frame.waitForSelector("[data-testid=velero-overview-read-backups][data-read=read] >> text=300", {
        timeout: 60_000,
      });
      const windows = ["24h", "30d", "7d"];
      const changes: ({ interaction: string } & cluster.Measure)[] = [];
      const holds: Record<string, { marks: number; listed: number }> = {};
      const numberIn = (said: string) => Number(/(\d+)$/.exec(said)?.[1] ?? Number.NaN);
      const read = (await cluster.overview(frame)).read;

      expect((await cluster.overview(frame)).window).toBe("7d");
      for (const window of windows) await cluster.measureWindow(frame, window);
      for (let index = 0; index < 20; index += 1) {
        const window = windows[index % windows.length];

        changes.push({ interaction: `${index + 1}: ${window}`, ...(await cluster.measureWindow(frame, window)) });
        const shown = await cluster.overview(frame);

        expect([index + 1, shown.window]).toEqual([index + 1, window]);
        holds[window] = {
          marks: shown.marks.backups.length + shown.marks.restores.length,
          listed: shown.recent.length,
        };
      }
      // What the Overview read, as it says it: the schedules and the backups of the installation.
      const overview = {
        measure: "overview",
        schedules: numberIn(read.schedules.text),
        backups: numberIn(read.backups.text),
        interactions: changes.length,
        budget: BUDGET,
        response: rounded(changes.map((change) => change.response)),
        holds,
        times: changes.map((change) => ({ interaction: change.interaction, response: Math.round(change.response) })),
      };

      console.log(`ADH-16 ${JSON.stringify(overview)}`);
      await cluster.writeReport("adh-16-overview-performance", overview);
      // What was measured: twenty different interactions of the list of three hundred, which took a time, with at
      // most a hundred rows mounted; and twenty changes of the window, each holding operations.
      expect(list.schedules).toBe(300);
      expect(list.interactions).toBe(20);
      expect(new Set(list.times.map((time) => time.interaction)).size).toBe(20);
      expect(list.times.filter((time) => !(time.total > 0) || time.response > time.total)).toEqual([]);
      expect(list.mounted).toBeGreaterThan(0);
      expect(list.mounted).toBeLessThanOrEqual(MOUNTED);
      expect([overview.schedules, overview.backups]).toEqual([300, 300]);
      expect([read.schedules.state, read.backups.state]).toEqual(["read", "read"]);
      expect(overview.interactions).toBe(20);
      expect(overview.times.filter((time) => !(time.response > 0))).toEqual([]);
      for (const window of windows) {
        expect([window, holds[window].marks > 0, holds[window].listed]).toEqual([window, true, 10]);
      }
      expect(list.response.p95).toBeLessThan(BUDGET);
      expect(overview.response.p95).toBeLessThan(BUDGET);
      expect(await cluster.valuesOfTheWhole(frame)).toEqual([]);
      expect(await cluster.layoutProblems(frame, OVERVIEW)).toEqual([]);
    },
    TIMEOUT,
  );

  it(
    "leaves the objects of Velero as they were, asks Velero for nothing, and reads only with the Schedules and the Overview open",
    async () => {
      // The evidence of DISC-07 with the Schedules and then the Overview of the installation of the states open for a
      // period of the reads each: the API server counted only reads of the kinds of Velero, whoever asked them, but
      // what the controllers of the installation of the demo write by themselves.
      await cluster.selectInstallation(frame, cluster.E2E_ADHERENCE_NAMESPACE);
      await cluster.openPage(frame, SCHEDULES);
      await cluster.waitForList(frame, SCHEDULES);
      const schedules = await countedWhileOpen("Schedules");

      await cluster.openPage(frame, OVERVIEW);
      await cluster.overview(frame);
      const overview = await countedWhileOpen("Overview");

      // The controller of the installation patches the schedule it validated at each of its looks with nothing
      // changed, and its storage location at each validation: the guard leaves both out, and proves the schedule
      // unchanged by its version and its status, and the installation by the identities of its objects.
      expect(cluster.SCHEDULE_PATCHED_AT_EVERY_LOOK).toBe(true);
      for (const [view, written] of [schedules, overview]) {
        expect([view, written]).toEqual([view, []]);
      }
      const after = cluster.clusterSnapshot();
      const requests = cluster.apiRequests();
      const all = cluster.counted(counted, requests);
      const real = Object.keys(before.versions).filter((key) =>
        key.startsWith(`${cluster.E2E_NAMESPACE}/schedules/${REAL}/`),
      );

      expect(real).toHaveLength(1);
      expect(after.versions[real[0]]).toBe(before.versions[real[0]]);
      expect(after.versions).toEqual(before.versions);
      expect(after.installed).toEqual(before.installed);
      expect(before.requests).toBe(0);
      expect(after.requests).toBe(0);
      expect(after.named).toEqual(before.named);
      // The writes of the whole suite by the rule of the guard: no request that is not a read but the PATCH of the
      // storage locations and, of a schedule by its name, no more than the whole minutes between the two readings of
      // the counters and two, the ones the controller sends at each of its looks; a PATCH of a schedule of any other
      // scope is a write.
      expect(cluster.writes(counted, requests)).toEqual({});
      // No submission: a backup the real schedule submitted would be a POST of a backup, and would carry its label.
      expect(createdBackups(all)).toEqual([]);
      expect(
        cluster.kubectlE2E(
          "get",
          "backups.velero.io",
          "--namespace",
          cluster.E2E_NAMESPACE,
          "--selector",
          `velero.io/schedule-name=${REAL}`,
          "-o",
          "name",
        ).stdout,
      ).toBe("");
      // Of the whole cluster the storage locations were listed, to find the installations, once, when the views were
      // opened: the suite never asks them to read again.
      expect(cluster.counted(cluster.clusterReads(counted), cluster.clusterReads(requests))).toEqual({
        [DISCOVERY]: 1,
      });
    },
    TIMEOUT,
  );

  it(
    "leaves no error in the application",
    async () => {
      expect(errors.errors()).toEqual([]);
      expect(Object.values(await velero.hostLogErrors(started.app)).flat()).toEqual([]);
    },
    TIMEOUT,
  );
});
