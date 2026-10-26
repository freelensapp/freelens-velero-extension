/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

// The adherence of the schedules on its fixtures, in a packaged Freelens. What each fixture is to show is computed by
// the suite from the objects as the cluster holds them and from the clock, by the rules of the controller
// (`integration/helpers/velero-adherence.ts`), whose own cases come first and start no application.

import { describe, expect, it } from "vitest";
import * as adherence from "../../integration/helpers/velero-adherence";

import type { Expected, HeldObject, Part } from "../../integration/helpers/velero-adherence";

const SECOND = 1000;
const MINUTE = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;

// The attributes a row, a line and the details say the adherence of a schedule by.
const attributes = (one: Expected) => ({ next: one.next, state: one.state, mark: one.mark, reason: one.reason });

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
});
