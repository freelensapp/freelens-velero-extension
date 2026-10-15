import { describe, expect, it } from "vitest";
import { formatDuration } from "./duration";
import { unread } from "./location-users";
import { BACKUP_PHASES } from "./phases";
import { emptyRead, failed, loading, succeeded } from "./read-state";
import { COUNT_BOUND, GRACE, parseExpression, UTC } from "./schedule-adherence";
import { holdsSubmissions, scheduleHistory } from "./schedule-history";
import {
  adherenceContext,
  adherenceOrder,
  CLOCK_WORDS,
  clocksOf,
  keepOffset,
  lastObservedRun,
  momentText,
  runText,
  SIGNAL_WEIGHTS,
  SIGNAL_WORDS,
  scheduleSignal,
} from "./schedule-signal";
import { NOTES } from "./schedule-view";
import { LABELS } from "./types";

import type { FamilyRead } from "./read-state";
import type { Zone } from "./schedule-adherence";
import type {
  AdherenceContext,
  AdherenceReads,
  ApiServerTime,
  ScheduleSignal,
  ServerOffset,
  SignalState,
} from "./schedule-signal";
import type { BackupResource, ScheduleResource } from "./types";

// The zone of the machine the tests run on is one no case below is computed or written in, fourteen hours east
// of UTC: an instant computed or written in it would fail every case. The module never reads it.
process.env.TZ = "Pacific/Kiritimati";

const MINUTE = 60_000;
const HOUR = 3_600_000;
const NAMESPACE = "velero-demo";
const now = Date.parse("2026-10-14T12:00:00Z");

function schedule(
  name: string,
  status?: ScheduleResource["status"],
  spec: ScheduleResource["spec"] = { schedule: "0 3 * * *" },
  created = "2026-08-01T00:00:00Z",
): ScheduleResource {
  return {
    metadata: { name, namespace: NAMESPACE, creationTimestamp: created },
    spec,
    ...(status ? { status } : {}),
  };
}

function backup(
  name: string,
  created: number,
  more: { schedule?: string; phase?: string; start?: number; namespace?: string } = {},
): BackupResource {
  return {
    metadata: {
      name,
      namespace: more.namespace ?? NAMESPACE,
      creationTimestamp: new Date(created).toISOString(),
      labels: more.schedule === "" ? {} : { [LABELS.schedule]: more.schedule ?? name.replace(/-\d+$/, "") },
    },
    // A phase of nothing is a backup that reports none.
    status: {
      ...(more.phase === "" ? {} : { phase: more.phase ?? "Completed" }),
      ...(more.start === undefined ? {} : { startTimestamp: new Date(more.start).toISOString() }),
    },
  };
}

// The fourteen digits of a wall clock, as the controller names a backup: the instant written as UTC.
function digits(wall: number): string {
  return new Date(wall).toISOString().replace(/[-:T]/g, "").slice(0, 14);
}

// The backup the controller creates for a submission, in a server whose zone is so many minutes east of UTC:
// named with the wall clock of the submission, created a second after it.
function submitted(name: string, submission: number, minutes: number, created = submission + 1000): BackupResource {
  return backup(`${name}-${digits(submission + minutes * MINUTE)}`, created, { schedule: name });
}

function reads(schedules: ScheduleResource[], backups: BackupResource[], at = now): AdherenceReads {
  return { schedules: succeeded(schedules, at), backups: succeeded(backups, at) };
}

// The installation with these schedules and backups, read at the clock, with the offset they give.
function contextOf(
  schedules: ScheduleResource[],
  backups: BackupResource[],
  at = now,
  server?: ApiServerTime,
): AdherenceContext {
  const read = reads(schedules, backups, at);

  return adherenceContext(read, at, keepOffset(undefined, read), server);
}

// A reason of the words of a family that was not read, inside a sentence.
const lowered = (text: string) => text.charAt(0).toLowerCase() + text.slice(1);

const submission = Date.parse("2026-10-13T03:00:41Z");
const nightly = schedule("nightly", { phase: "Enabled", lastBackup: "2026-10-13T03:00:41Z" });

describe("ADH-03: the zone of the server, derived from the backup of a submission", () => {
  it.each([
    ["two hours east of UTC", 120],
    ["one hour west of UTC", -60],
    ["UTC", 0],
    ["five hours and three quarters east of UTC", 345],
    ["twelve hours west of UTC", -720],
    ["fourteen hours east of UTC", 840],
  ])("reads the offset of a server %s in the name of the backup of the submission", (_, minutes) => {
    const own = submitted("nightly", submission, minutes);

    expect(keepOffset(undefined, reads([nightly], [own]))).toEqual({
      minutes,
      schedule: "nightly",
      backup: own.metadata.name,
      submission,
      created: submission + 1000,
    });
  });

  it("takes a remainder under a minute, and gives nothing for one of a minute or more", () => {
    // The creation half a minute after the submission, and the digits of the name fifty or ninety seconds
    // before the creation: the backup is the one of the submission, and only the remainder tells them apart.
    const created = submission + 30_000;
    const fifty = backup(`nightly-${digits(created - 50_000 + 2 * HOUR)}`, created, { schedule: "nightly" });
    const ninety = backup(`nightly-${digits(created - 90_000 + 2 * HOUR)}`, created, { schedule: "nightly" });

    expect(keepOffset(undefined, reads([nightly], [fifty]))?.minutes).toBe(120);
    expect(keepOffset(undefined, reads([nightly], [ninety]))).toBeUndefined();
  });

  it("gives nothing for a name of thirteen digits, a backup two minutes from the submission, or no backup", () => {
    const thirteen = backup(`nightly-${digits(submission + 2 * HOUR).slice(0, 13)}`, submission + 1000, {
      schedule: "nightly",
    });
    const late = submitted("nightly", submission, 120, submission + 2 * MINUTE);

    expect(keepOffset(undefined, reads([nightly], [thirteen]))).toBeUndefined();
    expect(keepOffset(undefined, reads([nightly], [late]))).toBeUndefined();
    expect(keepOffset(undefined, reads([nightly], []))).toBeUndefined();
    // Digits that name no wall clock, and an offset no zone in use has.
    expect(
      keepOffset(undefined, reads([nightly], [backup("nightly-20261313030041", submission, { schedule: "nightly" })])),
    ).toBeUndefined();
    expect(keepOffset(undefined, reads([nightly], [submitted("nightly", submission, 15 * 60)]))).toBeUndefined();
    // Of no schedule, of another namespace, or of a schedule with no submission: no submission to match.
    expect(
      keepOffset(
        undefined,
        reads([nightly], [backup(`nightly-${digits(submission + 2 * HOUR)}`, submission, { schedule: "" })]),
      ),
    ).toBeUndefined();
    expect(
      keepOffset(
        undefined,
        reads(
          [nightly],
          [
            backup(`nightly-${digits(submission + 2 * HOUR)}`, submission, {
              schedule: "nightly",
              namespace: "velero-other",
            }),
          ],
        ),
      ),
    ).toBeUndefined();
    expect(
      keepOffset(
        undefined,
        reads([schedule("nightly", { phase: "Enabled" })], [submitted("nightly", submission, 120)]),
      ),
    ).toBeUndefined();
  });

  // A backup asked by hand from the schedule is named in UTC by the command line, and carries the label of the
  // schedule: alone in the minute of a submission it is taken for the one of the controller, and misleads the
  // offset by the offset of the server, which the spec accepts.
  it("takes a backup asked by hand in the same minute as the submission, which may mislead", () => {
    const byHand = backup(`nightly-${digits(submission + 20_000)}`, submission + 20_000, { schedule: "nightly" });
    const own = submitted("nightly", submission, 120);

    expect(keepOffset(undefined, reads([nightly], [byHand]))).toMatchObject({
      minutes: 0,
      backup: byHand.metadata.name,
    });
    // Beside the backup of the controller, the nearer to the submission is taken.
    expect(keepOffset(undefined, reads([nightly], [byHand, own]))).toMatchObject({
      minutes: 120,
      backup: own.metadata.name,
    });
  });

  it("takes the newest submission of the installation for every schedule, whichever schedule it is of", () => {
    const weekly = schedule("weekly", { phase: "Enabled", lastBackup: "2026-10-12T01:00:00Z" });
    const fresh = schedule("fresh", { phase: "Enabled" });
    const offset = keepOffset(
      undefined,
      reads(
        [weekly, fresh, nightly],
        [submitted("weekly", Date.parse("2026-10-12T01:00:00Z"), 120), submitted("nightly", submission, 120)],
      ),
    );

    expect(offset).toMatchObject({ minutes: 120, schedule: "nightly", submission });
    expect(offset?.changed).toBeUndefined();
  });

  it("takes the newest of two offsets among the submissions, and keeps the other as the change", () => {
    const daily = schedule("daily", { phase: "Enabled", lastBackup: "2026-10-12T03:00:00Z" });
    const before = submitted("daily", Date.parse("2026-10-12T03:00:00Z"), 60);
    const after = submitted("nightly", submission, 120);

    expect(keepOffset(undefined, reads([daily, nightly], [before, after]))).toEqual({
      minutes: 120,
      schedule: "nightly",
      backup: after.metadata.name,
      submission,
      created: submission + 1000,
      changed: {
        minutes: 60,
        schedule: "daily",
        backup: before.metadata.name,
        submission: Date.parse("2026-10-12T03:00:00Z"),
      },
    });
  });

  it("keeps the offset for the session once the backup it was read in is gone", () => {
    const own = submitted("nightly", submission, 120);
    const kept = keepOffset(undefined, reads([nightly], [own]));

    expect(kept?.minutes).toBe(120);
    // The backup expired, was deleted, or the backups cannot be read any more: the offset stays.
    expect(keepOffset(kept, reads([nightly], []))).toBe(kept);
    expect(
      keepOffset(kept, {
        schedules: succeeded([nightly], now),
        backups: failed(emptyRead<BackupResource>(), "forbidden"),
      }),
    ).toBe(kept);
    expect(keepOffset(kept, { schedules: emptyRead<ScheduleResource>(), backups: emptyRead<BackupResource>() })).toBe(
      kept,
    );
    // The same evidence read again is the same value, which a view can tell from a change.
    expect(keepOffset(kept, reads([nightly], [own]))).toBe(kept);
    // Older evidence does not take the place of what is kept; newer evidence does.
    const later = Date.parse("2026-10-14T03:00:12Z");
    const again = schedule("nightly", { phase: "Enabled", lastBackup: new Date(later).toISOString() });
    const newer = keepOffset(kept, reads([again], [own, submitted("nightly", later, 120)]));

    expect(newer).toMatchObject({ minutes: 120, submission: later });
    expect(keepOffset(newer, reads([nightly], [own]))).toBe(newer);
  });

  it("says that the offset changed since the one kept, with the submission it was read in before", () => {
    const kept = keepOffset(undefined, reads([nightly], [submitted("nightly", submission, 120)])) as ServerOffset;
    const later = Date.parse("2026-10-26T03:00:12Z");
    const again = schedule("nightly", { phase: "Enabled", lastBackup: new Date(later).toISOString() });
    const changed = keepOffset(kept, reads([again], [submitted("nightly", later, 60)]));

    expect(changed).toMatchObject({
      minutes: 60,
      submission: later,
      changed: { minutes: 120, schedule: "nightly", backup: kept.backup, submission },
    });
    // The change stays said while the offset is the one it changed to.
    const next = Date.parse("2026-10-27T03:00:12Z");
    const third = schedule("nightly", { phase: "Enabled", lastBackup: new Date(next).toISOString() });

    expect(keepOffset(changed, reads([third], [submitted("nightly", next, 60)]))?.changed).toEqual(changed?.changed);
  });
});

describe("ADH-07: the clocks of this machine and of the cluster", () => {
  const bare = (more: ScheduleResource["status"], created = "2026-08-01T00:00:00Z") =>
    schedule("nightly", { phase: "Enabled", ...more }, { schedule: "0 3 * * *" }, created);

  it("finds no clock ahead when no object reports a time after the clock of this machine", () => {
    const clocks = clocksOf(
      reads([bare({ lastBackup: "2026-10-14T03:00:41Z" })], [submitted("nightly", now - HOUR, 0)]),
      now,
    );

    expect(clocks).toMatchObject({ now, cluster: now, ahead: 0 });
    expect(clocks.by).toBeUndefined();
    expect(clocks.server).toBeUndefined();
    expect(clocks.words).toBe(`${CLOCK_WORDS.compared} ${CLOCK_WORDS.aheadOnly}: ${CLOCK_WORDS.noneAhead}`);
    expect(CLOCK_WORDS.aheadOnly).toContain("Only a clock of the cluster that is ahead");
    // Less than a second after the read is not said: the times of the objects are written to the second.
    const close = clocksOf(reads([bare({ lastBackup: new Date(now + 700).toISOString() })], []), now);

    expect(close).toMatchObject({ ahead: 0, cluster: now, words: clocks.words });
    expect(close.by).toBeUndefined();
  });

  it.each([
    ["a submission", () => [bare({ lastBackup: new Date(now + HOUR).toISOString() })], [], "schedule", "submission"],
    ["a creation", () => [bare({}, new Date(now + HOUR).toISOString())], [], "schedule", "creation"],
    ["a skip", () => [bare({ lastSkipped: new Date(now + HOUR).toISOString() })], [], "schedule", "skip"],
    [
      "the start of a backup",
      () => [bare({})],
      [backup("nightly-1", now - HOUR, { start: now + HOUR })],
      "backup",
      "start",
    ],
    ["the creation of a backup", () => [bare({})], [backup("nightly-1", now + HOUR)], "backup", "creation"],
  ] as const)("finds the clock of the cluster ahead by %s after the clock", (_, made, backups, kind, time) => {
    const clocks = clocksOf(reads(made(), [...backups]), now);
    const name = kind === "schedule" ? "nightly" : "nightly-1";

    // Without the time of the API server the lateness stays counted by the clock of this machine.
    expect(clocks).toMatchObject({ ahead: HOUR, by: { kind, name, time }, cluster: now });
    expect(clocks.words).toBe(
      [
        CLOCK_WORDS.compared,
        `${CLOCK_WORDS.aheadOnly}: ${CLOCK_WORDS.ahead({ kind, name, time }, HOUR)}`,
        CLOCK_WORDS.laterStill,
      ].join(" "),
    );
    expect(CLOCK_WORDS.laterStill).toContain("later still");
  });

  it("takes the latest of the times after the clock, by the clock at the read that brought the object", () => {
    const clocks = clocksOf(
      reads(
        [
          bare({
            lastBackup: new Date(now + 10 * MINUTE).toISOString(),
            lastSkipped: new Date(now + 20 * MINUTE).toISOString(),
          }),
        ],
        [backup("nightly-1", now + 5 * MINUTE)],
      ),
      now,
    );

    expect(clocks).toMatchObject({ ahead: 20 * MINUTE, by: { kind: "schedule", time: "skip" } });
    // The schedules read ten minutes before the clock of the views ticked again: a time five minutes after that
    // read is ahead of the clock of this machine when it was read, and before the clock of the views.
    const earlier = clocksOf(
      {
        schedules: succeeded([bare({ lastBackup: new Date(now - 5 * MINUTE).toISOString() })], now - 10 * MINUTE),
        backups: succeeded([], now),
      },
      now,
    );

    expect(earlier).toMatchObject({ ahead: 5 * MINUTE, by: { kind: "schedule", time: "submission" } });
    // A read that failed keeps its objects with the time it was read: they still count.
    const kept = failed(succeeded([bare({ lastBackup: new Date(now + MINUTE).toISOString() })], now), "failed");

    expect(clocksOf({ schedules: kept, backups: emptyRead<BackupResource>() }, now).ahead).toBe(MINUTE);
  });

  it("counts by the clock of the cluster through the time of the API server, both ways, and says so", () => {
    const quiet = reads([bare({ lastBackup: "2026-10-14T03:00:41Z" })], []);
    const ahead = clocksOf(quiet, now, { date: now + 3 * MINUTE, at: now });
    const behind = clocksOf(quiet, now, { date: now - 2 * MINUTE, at: now });
    const agree = clocksOf(quiet, now, { date: now + 400, at: now });

    expect(ahead).toMatchObject({ server: 3 * MINUTE, cluster: now + 3 * MINUTE, ahead: 0 });
    expect(ahead.words).toBe(CLOCK_WORDS.server(3 * MINUTE));
    expect(behind).toMatchObject({ server: -2 * MINUTE, cluster: now - 2 * MINUTE });
    expect(behind.words).toBe(CLOCK_WORDS.server(-2 * MINUTE));
    expect(CLOCK_WORDS.server(-2 * MINUTE)).toContain("behind");
    expect(CLOCK_WORDS.server(3 * MINUTE)).toContain("ahead");
    expect(agree).toMatchObject({ server: 400, cluster: now + 400 });
    expect(agree.words).toBe(CLOCK_WORDS.server(400));
    expect(CLOCK_WORDS.server(400)).toContain("within a second");
    // Without it, only a cluster that is ahead can be seen: the words say which of the two holds.
    expect(clocksOf(quiet, now).words).toContain(CLOCK_WORDS.aheadOnly);
    expect(ahead.words).not.toContain(CLOCK_WORDS.aheadOnly);
    // An object ahead of the clock of the API server is said beside it: the clock that wrote it, which may be
    // the one of the controller, may count a run later still.
    const both = clocksOf(reads([bare({ lastBackup: new Date(now + HOUR).toISOString() })], []), now, {
      date: now + 3000,
      at: now,
    });

    expect(both).toMatchObject({ ahead: HOUR, server: 3000, cluster: now + 3000 });
    expect(both.words).toBe(
      [
        CLOCK_WORDS.server(3000),
        CLOCK_WORDS.object({ kind: "schedule", name: "nightly", time: "submission" }, HOUR),
      ].join(" "),
    );
    // Not beside an API server as far ahead as it.
    const level = clocksOf(reads([bare({ lastBackup: new Date(now + 2 * MINUTE).toISOString() })], []), now, {
      date: now + 2 * MINUTE,
      at: now,
    });

    expect(level.words).toBe(CLOCK_WORDS.server(2 * MINUTE));
  });
});

const ROME: Zone = { of: "named", name: "Europe/Rome" };
const EAST: Zone = { of: "fixed", minutes: 120 };

describe("the words of a time, in the zone the expression is read in", () => {
  it("writes a run with its date when it is not the day of the clock in that zone, and a time the cluster wrote whole", () => {
    expect(runText(UTC, Date.parse("2026-10-14T03:00:00Z"), now)).toBe("03:00 UTC");
    expect(runText(UTC, Date.parse("2026-10-13T03:00:00Z"), now)).toBe("03:00 UTC on 2026-10-13");
    expect(runText(UTC, Date.parse("2026-10-14T09:00:41Z"), now)).toBe("09:00:41 UTC");
    expect(runText(EAST, Date.parse("2026-10-14T23:30:00Z"), now)).toBe("01:30 UTC+02:00 on 2026-10-15");
    expect(runText({ of: "fixed", minutes: -330 }, Date.parse("2026-10-14T08:30:00Z"), now)).toBe("03:00 UTC-05:30");
    expect(runText(ROME, Date.parse("2026-10-14T01:00:00Z"), now)).toBe("03:00 Europe/Rome");
    expect(momentText(UTC, Date.parse("2026-10-13T03:00:41Z"))).toBe("2026-10-13 03:00:41 UTC");
    expect(momentText(EAST, Date.parse("2026-10-13T03:00:41Z"))).toBe("2026-10-13 05:00:41 UTC+02:00");
    expect(momentText(ROME, Date.parse("2026-01-13T03:00:41Z"))).toBe("2026-01-13 04:00:41 Europe/Rome");
  });
});

describe("ADH-03: the zone a schedule is read in, in its signal", () => {
  const own = submitted("nightly", submission, 120);
  const moment = "2026-10-13 05:00:41 UTC+02:00";

  it("runs with the zone of the machine fourteen hours east of UTC, which nothing is computed or written in", () => {
    expect(new Date(now).getTimezoneOffset()).toBe(-840);
  });

  it("computes with the offset of the newest submission, and says it with the schedule it came from when it is another", () => {
    const fresh = schedule("fresh", { phase: "Enabled" }, { schedule: "0 3 * * *" }, "2026-10-14T10:00:00Z");
    const context = contextOf([nightly, fresh], [own]);
    const signal = scheduleSignal(fresh, context);
    const other = SIGNAL_WORDS.otherSchedule("nightly");

    // 03:00 two hours east of UTC, the day after the creation: 01:00 in UTC.
    expect(signal).toMatchObject({ state: "awaited", zone: { of: "derived" }, anchor: { of: "creation" } });
    expect(signal.expected?.at).toBe(Date.parse("2026-10-15T01:00:00Z"));
    expect(signal.notes).toEqual([SIGNAL_WORDS.derived("UTC+02:00", own.metadata.name, other, moment)]);
    expect(signal.zone?.words).toBe(SIGNAL_WORDS.zone.derived("UTC+02:00", own.metadata.name, other, moment));
    expect(scheduleSignal(nightly, context).notes).toEqual([
      SIGNAL_WORDS.derived("UTC+02:00", own.metadata.name, SIGNAL_WORDS.thisSchedule, moment),
    ]);
    // Approximate across a change of daylight saving time, which a derived offset cannot see.
    expect(signal.notes[0]).toContain("an hour off");
  });

  it("says that the offset changed between two submissions, the newest standing", () => {
    const daily = schedule("daily", { phase: "Enabled", lastBackup: "2026-10-12T03:00:00Z" });
    const before = submitted("daily", Date.parse("2026-10-12T03:00:00Z"), 60);
    const context = contextOf([daily, nightly], [before, own]);
    const changed = (of: string) =>
      SIGNAL_WORDS.changed("UTC+01:00", before.metadata.name, of, "2026-10-12 04:00:00 UTC+01:00");

    expect(scheduleSignal(nightly, context).notes).toEqual([
      SIGNAL_WORDS.derived("UTC+02:00", own.metadata.name, SIGNAL_WORDS.thisSchedule, moment),
      changed(SIGNAL_WORDS.otherSchedule("daily")),
    ]);
    expect(scheduleSignal(daily, context).notes).toEqual([
      SIGNAL_WORDS.derived("UTC+02:00", own.metadata.name, SIGNAL_WORDS.otherSchedule("nightly"), moment),
      changed(SIGNAL_WORDS.thisSchedule),
    ]);
  });

  it("computes an interval with no zone, and five fields with no zone only from a derived offset", () => {
    const every = schedule(
      "every",
      { phase: "Enabled", lastBackup: "2026-10-14T10:00:00Z" },
      { schedule: "@every 6h" },
    );
    const context = contextOf([every, nightly], []);

    expect(scheduleSignal(every, context)).toMatchObject({
      state: "awaited",
      zone: { of: "interval", words: SIGNAL_WORDS.zone.interval },
      notes: [],
      next: { kind: "at", at: Date.parse("2026-10-14T16:00:00Z") },
    });
    expect(scheduleSignal(nightly, context)).toMatchObject({ state: "not-known", reason: "no-offset" });
  });

  it("computes with the offset kept once the backup it was read in is gone", () => {
    const kept = keepOffset(undefined, reads([nightly], [own]));
    const gone = reads([nightly], []);
    const signal = scheduleSignal(nightly, adherenceContext(gone, now, keepOffset(kept, gone)));

    expect(signal).toMatchObject({ state: "overdue", zone: { of: "derived" } });
    expect(signal.expected?.at).toBe(Date.parse("2026-10-14T01:00:00Z"));
    expect(scheduleSignal(nightly, adherenceContext(gone, now)).reason).toBe("no-offset");
  });

  it("reads Local as the zone of the server, and a name this machine does not know as a zone not known", () => {
    const local = schedule(
      "local",
      { phase: "Enabled", lastBackup: "2026-10-13T03:00:41Z" },
      { schedule: "TZ=Local 0 3 * * *" },
    );
    const mars = schedule(
      "mars",
      { phase: "Enabled", lastBackup: "2026-10-13T03:00:41Z" },
      { schedule: "TZ=Mars/Olympus 0 3 * * *" },
    );

    expect(scheduleSignal(local, contextOf([local], []))).toMatchObject({
      reason: "no-offset",
      words: SIGNAL_WORDS.noOffset(true, SIGNAL_WORDS.noSubmissionBackup),
    });
    expect(scheduleSignal(local, contextOf([local, nightly], [own]))).toMatchObject({
      state: "overdue",
      zone: { of: "derived" },
    });
    // Velero took the expression: the words say that this machine does not know the zone, never that the
    // server refused it.
    expect(scheduleSignal(mars, contextOf([mars], []))).toMatchObject({
      state: "not-known",
      reason: "unknown-zone",
      words: SIGNAL_WORDS.unknownZone("Mars/Olympus"),
      zone: { of: "named", words: SIGNAL_WORDS.zone.namedNotKnown("Mars/Olympus") },
    });
    expect(SIGNAL_WORDS.unknownZone("Mars/Olympus")).not.toMatch(/refuse/);
  });

  it("says the two runs of the hour a named zone repeats, on that day, in the words of the awaited state", () => {
    const rome = (lastBackup: string, expression = "CRON_TZ=Europe/Rome 0 2 * * *") =>
      schedule("rome", { phase: "Enabled", lastBackup }, { schedule: expression });
    const at = (item: ScheduleResource, clock: string) =>
      scheduleSignal(item, contextOf([item], [], Date.parse(clock)));
    const repeated = SIGNAL_WORDS.repeated(
      "2026-10-25",
      "Europe/Rome",
      "03:00",
      "02:00",
      "02:00 Europe/Rome (UTC+02:00)",
      "02:00 Europe/Rome (UTC+01:00)",
    );
    const first = at(rome("2026-10-24T00:00:30Z"), "2026-10-24T22:00:00Z");

    expect(first.expected?.at).toBe(Date.parse("2026-10-25T00:00:00Z"));
    expect(first.words).toBe(
      `${SIGNAL_WORDS.awaited("2h", "02:00 Europe/Rome", SIGNAL_WORDS.from("last-submission", "2026-10-24 02:00:30 Europe/Rome"))} ${repeated}`,
    );
    // Once the first is submitted the second is the next run, and the words still say both.
    const second = at(rome("2026-10-25T00:00:12Z"), "2026-10-25T00:30:00Z");

    expect(second.expected?.at).toBe(Date.parse("2026-10-25T01:00:00Z"));
    expect(second.words).toContain(repeated);
    // After the second, and for an expression with no run in that hour, nothing of it.
    const after = at(rome("2026-10-25T01:00:12Z"), "2026-10-25T02:00:00Z");

    expect(after.words).toBe(
      SIGNAL_WORDS.awaited(
        "23h",
        "02:00 Europe/Rome on 2026-10-26",
        SIGNAL_WORDS.from("last-submission", "2026-10-25 02:00:12 Europe/Rome"),
      ),
    );
    expect(at(rome("2026-10-24T02:00:30Z", "CRON_TZ=Europe/Rome 0 4 * * *"), "2026-10-24T22:00:00Z").words).toBe(
      SIGNAL_WORDS.awaited(
        "5h",
        "04:00 Europe/Rome",
        SIGNAL_WORDS.from("last-submission", "2026-10-24 04:00:30 Europe/Rome"),
      ),
    );
    // A zone west of UTC, on the day it goes back.
    const york = at(rome("2026-10-31T05:30:30Z", "CRON_TZ=America/New_York 30 1 * * *"), "2026-11-01T04:00:00Z");

    expect(york.words).toContain(
      SIGNAL_WORDS.repeated(
        "2026-11-01",
        "America/New_York",
        "02:00",
        "01:00",
        "01:30 America/New_York (UTC-04:00)",
        "01:30 America/New_York (UTC-05:00)",
      ),
    );
  });

  it("computes and writes the same signals whatever the zone of the machine", () => {
    const items = [
      nightly,
      schedule(
        "rome",
        { phase: "Enabled", lastBackup: "2026-10-13T00:00:30Z" },
        { schedule: "CRON_TZ=Europe/Rome 0 2 * * *" },
      ),
      schedule("every", { phase: "Enabled", lastBackup: "2026-10-14T10:00:00Z" }, { schedule: "@every 6h" }),
      schedule("fresh", { phase: "Enabled" }, { schedule: "0 3 * * *" }, "2026-10-14T10:00:00Z"),
    ];
    const signals = () => {
      const context = contextOf(items, [own]);

      return items.map((item) => [scheduleSignal(item, context), lastObservedRun(item, context)]);
    };
    const before = signals();
    const machine = process.env.TZ;

    process.env.TZ = "America/Los_Angeles";
    try {
      expect(new Date(now).getTimezoneOffset()).toBe(420);
      expect(signals()).toEqual(before);
    } finally {
      process.env.TZ = machine;
    }
    expect(new Date(now).getTimezoneOffset()).toBe(-840);
    expect(JSON.stringify(before)).not.toMatch(/\+14:00|-07:00|Kiritimati|Los_Angeles/);
  });
});

describe("ADH-04: awaited, due, overdue and held, by the clock of this machine", () => {
  const daily = schedule(
    "daily",
    { phase: "Enabled", lastBackup: "2026-10-13T03:00:41Z" },
    { schedule: "TZ=UTC 0 3 * * *" },
  );
  const expected = Date.parse("2026-10-14T03:00:00Z");
  const from = SIGNAL_WORDS.from("last-submission", "2026-10-13 03:00:41 UTC");
  const at = (clock: number, backups: BackupResource[] = [], item = daily) =>
    scheduleSignal(item, contextOf([item], backups, clock));

  it("is awaited while the expected run is ahead, and at it", () => {
    const signal = at(expected - 2 * HOUR - 12 * MINUTE);

    expect(signal).toMatchObject({
      state: "awaited",
      label: SIGNAL_WORDS.label.awaited,
      mark: "awaited",
      weight: SIGNAL_WEIGHTS.awaited,
      measure: expected,
      late: false,
      notes: [],
      next: { kind: "at", at: expected, text: SIGNAL_WORDS.inTime("2h 12m") },
      zone: { of: "named", words: SIGNAL_WORDS.zone.named("UTC") },
      anchor: { of: "last-submission", at: submission, words: from.charAt(0).toUpperCase() + from.slice(1) },
    });
    expect(signal.words).toBe(SIGNAL_WORDS.awaited("2h 12m", "03:00 UTC", from));
    expect(signal.expected).toEqual({
      at: expected,
      lateness: -(2 * HOUR + 12 * MINUTE),
      passed: 0,
      beyond: false,
      words: SIGNAL_WORDS.passedNone,
    });
    // At the instant itself: the controller submits when its clock is after it.
    expect(at(expected).state).toBe("awaited");
  });

  it("is due for the five minutes of the grace after the expected run", () => {
    const signal = at(expected + 4 * MINUTE);

    expect(signal).toMatchObject({
      state: "due",
      label: SIGNAL_WORDS.label.due,
      mark: "awaited",
      weight: SIGNAL_WEIGHTS.due,
      late: false,
      next: { kind: "at", at: expected, text: SIGNAL_WORDS.ago("4m") },
    });
    expect(signal.words).toBe(SIGNAL_WORDS.due("03:00 UTC", "4m"));
    expect(signal.words).toContain("once a minute");
    expect(at(expected + 1000).state).toBe("due");
    expect(at(expected + GRACE).state).toBe("due");
    expect(at(expected + GRACE + 1000).state).toBe("overdue");
  });

  it("is overdue after the grace, with how long, the expected run, its anchor and the count", () => {
    const signal = at(expected + 6 * MINUTE);

    expect(signal).toMatchObject({
      state: "overdue",
      label: SIGNAL_WORDS.label.overdue,
      mark: "late",
      weight: SIGNAL_WEIGHTS.overdue,
      measure: expected,
      late: true,
      anchor: { of: "last-submission", at: submission },
    });
    expect(signal.expected).toEqual({
      at: expected,
      lateness: 6 * MINUTE,
      passed: 1,
      beyond: false,
      last: expected,
      words: SIGNAL_WORDS.passedOne("03:00 UTC"),
    });
    expect(signal.words).toBe(SIGNAL_WORDS.overdue("6m", "03:00 UTC", from, SIGNAL_WORDS.passed(1, false)));
    const three = at(Date.parse("2026-10-16T12:00:00Z"));

    expect(three.expected).toMatchObject({ passed: 3, last: Date.parse("2026-10-16T03:00:00Z") });
    expect(three.expected?.words).toBe(SIGNAL_WORDS.passedMany(3, "03:00 UTC on 2026-10-14", "03:00 UTC"));
    expect(three.words).toBe(
      SIGNAL_WORDS.overdue("2d 9h", "03:00 UTC on 2026-10-14", from, SIGNAL_WORDS.passed(3, false)),
    );
  });

  it("counts up to one hundred, and says which of the three times the count starts from", () => {
    const minutely = schedule(
      "minutely",
      { phase: "Enabled", lastBackup: "2025-10-14T00:00:00Z" },
      { schedule: "@every 1m" },
    );
    const first = Date.parse("2025-10-14T00:01:00Z");
    const many = at(now, [], minutely);

    expect(many.expected).toMatchObject({ at: first, passed: COUNT_BOUND, beyond: true });
    expect(many.expected?.words).toBe(SIGNAL_WORDS.passedBeyond("00:01 UTC on 2025-10-14"));
    expect(many.words).toBe(
      SIGNAL_WORDS.overdue(
        formatDuration(now - first),
        "00:01 UTC on 2025-10-14",
        SIGNAL_WORDS.from("last-submission", "2025-10-14 00:00:00 UTC"),
        SIGNAL_WORDS.passed(COUNT_BOUND, true),
      ),
    );
    expect(SIGNAL_WORDS.passed(COUNT_BOUND, true)).toContain(`more than ${COUNT_BOUND}`);
    const created = schedule("created", { phase: "Enabled" }, { schedule: "TZ=UTC 0 3 * * *" }, "2026-10-12T10:00:00Z");

    expect(at(now, [], created)).toMatchObject({ state: "overdue", anchor: { of: "creation" } });
    expect(at(now, [], created).words).toBe(
      SIGNAL_WORDS.overdue(
        "1d 9h",
        "03:00 UTC on 2026-10-13",
        SIGNAL_WORDS.from("creation", "2026-10-12 10:00:00 UTC"),
        SIGNAL_WORDS.passed(2, false),
      ),
    );
    const skipped = schedule(
      "skipped",
      { phase: "Enabled", lastBackup: "2026-10-12T03:00:00Z", lastSkipped: "2026-10-13T10:00:00Z" },
      { schedule: "TZ=UTC 0 3 * * *" },
    );

    expect(at(now, [], skipped)).toMatchObject({ state: "overdue", anchor: { of: "last-skipped" } });
    expect(at(now, [], skipped).words).toBe(
      SIGNAL_WORDS.overdue(
        "9h",
        "03:00 UTC",
        SIGNAL_WORDS.from("last-skipped", "2026-10-13 10:00:00 UTC"),
        SIGNAL_WORDS.passed(1, false),
      ),
    );
  });

  it.each([...BACKUP_PHASES.map((phase): [string, string] => [phase, phase]), ["no phase", ""]])(
    "is held by a backup of the schedule that reports %s only when it is none, New or InProgress",
    (_, phase) => {
      const backups = [backup("daily-20261014030041", expected + 41_000, { phase })];
      const holds = phase === "" || phase === "New" || phase === "InProgress";
      const history = scheduleHistory(daily, succeeded(backups, now), now);

      expect(at(expected + HOUR, backups).state).toBe(holds ? "held" : "overdue");
      // As the history of the schedule says of what holds the submissions.
      expect(history.state === "listed" && holdsSubmissions(history.items)).toBe(holds);
    },
  );

  it("leads with the hold, which is late once the grace passed", () => {
    const holding = backup("daily-20261014030000", expected, { phase: "InProgress" });
    const beyond = at(expected + 2 * HOUR + 14 * MINUTE, [holding]);

    expect(beyond).toMatchObject({
      state: "held",
      label: SIGNAL_WORDS.label.held,
      mark: "late",
      weight: SIGNAL_WEIGHTS.held,
      late: true,
      hold: { state: "held", backup: holding.metadata.name, phase: "InProgress", others: 0 },
    });
    expect(beyond.words).toBe(
      `${SIGNAL_WORDS.held(holding.metadata.name, "InProgress")} ${SIGNAL_WORDS.heldExpected("03:00 UTC", "2h 14m")}`,
    );
    expect(at(expected + 2 * MINUTE, [holding])).toMatchObject({ state: "held", mark: "awaited", late: false });
    expect(at(expected - HOUR, [holding]).words).toBe(
      `${SIGNAL_WORDS.held(holding.metadata.name, "InProgress")} ${SIGNAL_WORDS.heldNext("03:00 UTC", SIGNAL_WORDS.inTime("1h"))}`,
    );
    // The newest that holds them is named, and the others counted.
    const more = at(expected + HOUR, [
      holding,
      backup("daily-20261014020000", expected - HOUR, { phase: "New" }),
      backup("daily-20261014010000", expected - 2 * HOUR, { phase: "" }),
    ]);

    expect(more.hold).toEqual({
      state: "held",
      backup: holding.metadata.name,
      phase: "InProgress",
      others: 2,
    });
    expect(more.words).toContain(SIGNAL_WORDS.heldMore(2));
    expect(SIGNAL_WORDS.held("b", "none")).toContain("reports no phase");
  });

  it("is none of the four for an expression with no instant, which Velero submits at every look", () => {
    const look = schedule(
      "look",
      { phase: "Enabled", lastBackup: "2026-10-14T11:59:00Z" },
      { schedule: "TZ=UTC 0 0 30 2 *" },
    );
    const signal = at(now, [], look);

    expect(signal).toMatchObject({
      state: "at-every-look",
      label: SIGNAL_WORDS.label["at-every-look"],
      mark: "not-known",
      weight: SIGNAL_WEIGHTS["at-every-look"],
      late: false,
      next: { kind: "none", text: SIGNAL_WORDS.none },
    });
    expect(signal.expected).toBeUndefined();
    expect(signal.measure).toBeUndefined();
    expect(signal.words).toBe(
      SIGNAL_WORDS.atEveryLook(SIGNAL_WORDS.beyondFiveYears, SIGNAL_WORDS.lastSubmission("2026-10-14 11:59:00 UTC")),
    );
    for (const descriptor of ["@triggered", "@manual", "@none"]) {
      const none = schedule("look", { phase: "Enabled" }, { schedule: descriptor }, "2026-10-14T11:00:00Z");

      expect(at(now, [], none).words).toBe(
        SIGNAL_WORDS.atEveryLook(SIGNAL_WORDS.noInstant(descriptor), SIGNAL_WORDS.noSubmissionYet),
      );
    }
    const held = at(now, [backup("look-20261014115900", now - MINUTE, { phase: "InProgress" })], look);

    expect(held.state).toBe("at-every-look");
    expect(held.words).toContain(SIGNAL_WORDS.heldNow("look-20261014115900", "InProgress"));
  });
});

describe("ADH-05: no run for a schedule that is paused, refused or not read", () => {
  const due = "2026-10-12T03:00:41Z";
  const run = "03:00 UTC on 2026-10-13";
  const dueAt = Date.parse("2026-10-13T03:00:00Z");
  const paused = (lastBackup = due, more: Partial<NonNullable<ScheduleResource["spec"]>> = {}) =>
    schedule("paused", { phase: "Enabled", lastBackup }, { schedule: "TZ=UTC 0 3 * * *", paused: true, ...more });
  const of = (item: ScheduleResource, backups: BackupResource[] = []) =>
    scheduleSignal(item, contextOf([item], backups));

  it("says that no run is expected until it is resumed, and that Velero would submit at once a run that is due", () => {
    const unset = of(paused());

    expect(unset).toMatchObject({
      state: "paused",
      label: SIGNAL_WORDS.label.paused,
      mark: "paused",
      weight: SIGNAL_WEIGHTS.paused,
      late: false,
      next: { kind: "none", text: SIGNAL_WORDS.none },
      resume: { would: "submit", due: dueAt, skip: "server" },
    });
    expect(unset.expected).toBeUndefined();
    expect(unset.words).toBe(
      `${SIGNAL_WORDS.paused} ${SIGNAL_WORDS.resume.submitUnlessServer(run)} ${SIGNAL_WORDS.resume.skipMoves}`,
    );
    const no = of(paused(due, { skipImmediately: false }));

    expect(no.resume).toEqual({ would: "submit", due: dueAt, skip: false });
    expect(no.words).toBe(`${SIGNAL_WORDS.paused} ${SIGNAL_WORDS.resume.submit(run)} ${SIGNAL_WORDS.resume.skipMoves}`);
    const skip = of(paused(due, { skipImmediately: true }));

    expect(skip.resume).toEqual({ would: "skip", due: dueAt });
    expect(skip.words).toBe(`${SIGNAL_WORDS.paused} ${SIGNAL_WORDS.resume.skip} ${SIGNAL_WORDS.resume.skipDue(run)}`);
  });

  it("says that Velero would submit nothing at once when no run is due", () => {
    const waits = of(paused("2026-10-14T03:00:41Z"));

    expect(waits.resume).toEqual({ would: "wait", next: Date.parse("2026-10-15T03:00:00Z") });
    expect(waits.words).toBe(`${SIGNAL_WORDS.paused} ${SIGNAL_WORDS.resume.wait("03:00 UTC on 2026-10-15")}`);
    expect(of(paused("2026-10-14T03:00:41Z", { skipImmediately: false })).resume).toEqual(waits.resume);
    const skip = of(paused("2026-10-14T03:00:41Z", { skipImmediately: true }));

    expect(skip.resume).toEqual({ would: "skip" });
    expect(skip.words).toBe(`${SIGNAL_WORDS.paused} ${SIGNAL_WORDS.resume.skip}`);
  });

  it("says what would hold the submissions at the resume, and when what Velero would do is not known", () => {
    const holding = backup("paused-20261014100000", now - 2 * HOUR, { phase: "InProgress" });
    const held = of(paused(), [holding]);

    expect(held.resume).toEqual({ would: "hold", due: dueAt, backup: holding.metadata.name, phase: "InProgress" });
    expect(held.words).toBe(
      `${SIGNAL_WORDS.paused} ${SIGNAL_WORDS.resume.hold(holding.metadata.name, "InProgress", run)}`,
    );
    const noZone = of(
      schedule("paused", { phase: "Enabled", lastBackup: due }, { schedule: "0 3 * * *", paused: true }),
    );

    expect(noZone.resume).toEqual({ would: "not-known", why: SIGNAL_WORDS.why["no-offset"] });
    expect(noZone.words).toBe(`${SIGNAL_WORDS.paused} ${SIGNAL_WORDS.resume.notKnown(SIGNAL_WORDS.why["no-offset"])}`);
    expect(
      of(schedule("paused", { phase: "Enabled", lastBackup: due }, { schedule: "0 3 * * FRI#L", paused: true })).resume,
    ).toEqual({ would: "not-known", why: SIGNAL_WORDS.why["not-readable"] });
    const look = of(schedule("paused", { phase: "Enabled", lastBackup: due }, { schedule: "@none", paused: true }));

    expect(look.resume).toEqual({ would: "every-look" });
    expect(look.words).toBe(`${SIGNAL_WORDS.paused} ${SIGNAL_WORDS.resume.everyLook(SIGNAL_WORDS.noInstant("@none"))}`);
    // The backups not read: whether one would hold the submissions is not known, and said.
    const deniedRead = failed(emptyRead<BackupResource>(), "forbidden");
    const denied = scheduleSignal(
      paused(),
      adherenceContext({ schedules: succeeded([paused()], now), backups: deniedRead }, now),
    );

    expect(denied.resume).toMatchObject({ would: "submit" });
    expect(denied.notes).toEqual([SIGNAL_WORDS.holdNotKnown(lowered(unread("backups", deniedRead).reason))]);
  });

  it("says of a paused schedule Velero refused or has not read what its phase says, with nothing computed", () => {
    for (const [status, said] of [
      [{ phase: "FailedValidation", lastBackup: due }, SIGNAL_WORDS.resume.refused],
      [undefined, SIGNAL_WORDS.resume.notRead],
      [{ phase: "New" }, SIGNAL_WORDS.resume.notRead],
      [{ phase: "Weird", lastBackup: due }, SIGNAL_WORDS.resume.unknownPhase("Weird")],
    ] as const) {
      const signal = of(schedule("paused", status, { schedule: "TZ=UTC 0 3 * * *", paused: true }));

      expect(signal).toMatchObject({
        state: "paused",
        words: `${SIGNAL_WORDS.paused} ${said}`,
        next: { kind: "none" },
      });
      expect(Object.keys(signal).sort()).toEqual([
        "label",
        "late",
        "mark",
        "next",
        "notes",
        "state",
        "weight",
        "words",
      ]);
    }
    expect(SIGNAL_WORDS.resume.notRead).toBe(NOTES.notReadPaused);
  });

  it("gates on the phase before the expression is read: refused, not read and a phase not known", () => {
    for (const [status, state, reason, words] of [
      [{ phase: "FailedValidation", lastBackup: due }, "refused", undefined, SIGNAL_WORDS.refused],
      [undefined, "not-known", "not-read", SIGNAL_WORDS.notRead],
      [{ phase: "New" }, "not-known", "not-read", SIGNAL_WORDS.notRead],
      [{ phase: "Paused", lastBackup: due }, "not-known", "unknown-phase", SIGNAL_WORDS.unknownPhase("Paused")],
    ] as const) {
      // An expression this version cannot read, one with no zone and one Velero refuses alike: nothing of the
      // expression is read before the phase.
      for (const expression of ["0 3 * * FRI#L", "0 3 * * *", "TZ= 0 3 * * *", "TZ=UTC 0 3 * * *"]) {
        const signal = of(schedule("gated", status, { schedule: expression }));

        expect(signal).toMatchObject({ state, words, mark: state === "refused" ? "refused" : "not-known" });
        expect(signal.reason).toBe(reason);
        expect(signal.next.kind).toBe(state === "refused" ? "none" : "not-known");
        expect(JSON.stringify(signal)).not.toMatch(/"at"|lateness|passed|anchor|expected|resume|hold/);
      }
    }
    expect(SIGNAL_WORDS.notRead).toContain(NOTES.notRead);
  });
});

describe("ADH-06: what is not known, each with its mark and its words", () => {
  const enabled = (name: string, expression: string, status: ScheduleResource["status"] = undefined) =>
    schedule(name, status ?? { phase: "Enabled", lastBackup: "2026-10-13T03:00:41Z" }, { schedule: expression });
  const every = schedule("every", { phase: "Enabled", lastBackup: "2026-10-14T10:00:00Z" }, { schedule: "@every 6h" });

  it("gives each state of uncertainty the mark of what is not known, never the one of a schedule on time", () => {
    const hash = parseExpression("0 3 * * FRI#L");
    const cases: [ScheduleResource, SignalState, string | undefined, string][] = [
      [
        enabled("zone", "0 3 * * *"),
        "not-known",
        "no-offset",
        SIGNAL_WORDS.noOffset(false, SIGNAL_WORDS.noSubmissionBackup),
      ],
      [
        enabled("local", "CRON_TZ=Local @daily"),
        "not-known",
        "no-offset",
        SIGNAL_WORDS.noOffset(true, SIGNAL_WORDS.noSubmissionBackup),
      ],
      [
        enabled("mars", "TZ=Mars/Olympus 0 3 * * *"),
        "not-known",
        "unknown-zone",
        SIGNAL_WORDS.unknownZone("Mars/Olympus"),
      ],
      [
        enabled("hash", "0 3 * * FRI#L"),
        "not-known",
        "not-readable",
        SIGNAL_WORDS.notReadable(hash.kind === "refused" ? hash.reason : ""),
      ],
      [schedule("silent", undefined, { schedule: "TZ=UTC 0 3 * * *" }), "not-known", "not-read", SIGNAL_WORDS.notRead],
      [
        enabled("odd", "TZ=UTC 0 3 * * *", { phase: "Disabled" }),
        "not-known",
        "unknown-phase",
        SIGNAL_WORDS.unknownPhase("Disabled"),
      ],
      [
        {
          metadata: { name: "bare", namespace: NAMESPACE },
          spec: { schedule: "TZ=UTC 0 3 * * *" },
          status: { phase: "Enabled" },
        },
        "not-known",
        "no-anchor",
        SIGNAL_WORDS.noAnchor,
      ],
      [
        enabled("look", "@manual"),
        "at-every-look",
        undefined,
        SIGNAL_WORDS.atEveryLook(
          SIGNAL_WORDS.noInstant("@manual"),
          SIGNAL_WORDS.lastSubmission("2026-10-13 03:00:41 UTC"),
        ),
      ],
    ];
    const context = contextOf(
      cases.map(([item]) => item),
      [],
    );

    expect(hash.kind).toBe("refused");
    for (const [item, state, reason, words] of cases) {
      const signal = scheduleSignal(item, context);

      expect(signal).toMatchObject({ state, words, mark: "not-known", late: false, label: SIGNAL_WORDS.label[state] });
      expect(signal.reason).toBe(reason);
      expect(signal.next.kind).not.toBe("at");
      expect(signal.weight).toBeLessThan(SIGNAL_WEIGHTS.awaited);
      expect(signal.weight).toBeGreaterThan(SIGNAL_WEIGHTS.due);
    }
    expect(Object.keys(SIGNAL_WORDS.reasons).sort()).toEqual(
      ["no-anchor", "no-offset", "not-read", "not-readable", "unknown-phase", "unknown-zone"].sort(),
    );
  });

  it("says that a signal is of a read before the last one, with when it was", () => {
    const of = (schedules: FamilyRead<ScheduleResource>, backups: FamilyRead<BackupResource> = succeeded([], now)) =>
      scheduleSignal(every, adherenceContext({ schedules, backups }, now));
    const earlier = (status: "failed" | "forbidden" | "not-served") =>
      failed(succeeded([every], now - 3 * MINUTE), status);

    expect(of(earlier("failed"))).toMatchObject({
      state: "awaited",
      notes: [SIGNAL_WORDS.schedulesStale("3m", SIGNAL_WORDS.since.failed)],
    });
    for (const status of ["forbidden", "not-served"] as const) {
      expect(of(earlier(status)).notes).toEqual([SIGNAL_WORDS.schedulesStale("3m", SIGNAL_WORDS.since[status])]);
    }
    // A read asked again keeps what it said, and is not of before.
    expect(of(loading(succeeded([every], now))).notes).toEqual([]);
    // The backups the hold is read in, of a read before the last.
    const backups = failed(succeeded([backup("every-20261014100000", now - 2 * HOUR)], now - 5 * MINUTE), "failed");
    const held = of(succeeded([every], now), backups);

    expect(held.hold).toEqual({ state: "none", stale: now - 5 * MINUTE });
    expect(held.notes).toEqual([SIGNAL_WORDS.backupsStale("5m", SIGNAL_WORDS.since.failed)]);
  });

  it("keeps the state of an interval with the words of the hold when the backups are not read, and not of five fields", () => {
    const late = schedule("late", { phase: "Enabled", lastBackup: "2026-10-14T08:00:00Z" }, { schedule: "@every 1h" });

    for (const read of [
      failed(emptyRead<BackupResource>(), "forbidden"),
      failed(emptyRead<BackupResource>(), "not-served"),
      failed(emptyRead<BackupResource>(), "failed"),
      emptyRead<BackupResource>(),
    ]) {
      const reason = lowered(unread("backups", read).reason);
      const context = adherenceContext({ schedules: succeeded([every, late, nightly], now), backups: read }, now);

      expect(scheduleSignal(every, context)).toMatchObject({
        state: "awaited",
        hold: { state: "not-known", reason },
        notes: [SIGNAL_WORDS.holdNotKnown(reason)],
      });
      expect(scheduleSignal(late, context)).toMatchObject({
        state: "overdue",
        notes: [SIGNAL_WORDS.holdNotKnown(reason)],
      });
      expect(scheduleSignal(nightly, context)).toMatchObject({
        state: "not-known",
        reason: "no-offset",
        words: SIGNAL_WORDS.noOffset(false, reason),
      });
    }
  });
});

describe("ADH-07: the lateness by the clock of the cluster, which an object ahead cannot shorten", () => {
  // Every hour from 10:30: expected at 11:30, half an hour before the clock of this machine.
  const hourly = schedule(
    "hourly",
    { phase: "Enabled", lastBackup: "2026-10-14T10:30:00Z" },
    { schedule: "@every 1h" },
  );
  const ahead = new Date(now + HOUR).toISOString();
  const from = SIGNAL_WORDS.from("last-submission", "2026-10-14 10:30:00 UTC");
  const overdue = SIGNAL_WORDS.overdue("30m", "11:30 UTC", from, SIGNAL_WORDS.passed(1, false));

  it.each([
    ["a submission", [schedule("other", { phase: "Enabled", lastBackup: ahead }, { schedule: "@every 1h" })], []],
    ["a creation", [schedule("other", { phase: "Enabled" }, { schedule: "@every 1h" }, ahead)], []],
    ["a skip", [schedule("other", { phase: "Enabled", lastSkipped: ahead }, { schedule: "@every 1h" })], []],
    ["the start of a backup", [], [backup("other-1", now - HOUR, { start: now + HOUR })]],
  ] as const)(
    "says overdue what is late by this machine beside %s after the clock, a cluster ahead",
    (_, others, backups) => {
      const context = contextOf([hourly, ...others], [...backups]);

      // The controller counts by its clock, ahead by an hour at least: the run is later still by it.
      expect(context.clocks).toMatchObject({ ahead: HOUR, cluster: now });
      expect(context.clocks.words).toContain(CLOCK_WORDS.laterStill);
      expect(scheduleSignal(hourly, context)).toMatchObject({
        state: "overdue",
        mark: "late",
        late: true,
        words: overdue,
      });
    },
  );

  // Probe P3b of the review of the slice: a schedule half an hour late by this machine, beside another that
  // reports its submission at 12:50 at 12:00, is late by an hour and twenty minutes at least by the clock of the
  // cluster: it is overdue, never due with the mark of a schedule on time.
  it("says overdue a schedule late by this machine beside another that reports 12:50 at 12:00", () => {
    const other = schedule(
      "other",
      { phase: "Enabled", lastBackup: "2026-10-14T12:50:00Z" },
      { schedule: "@every 1h" },
    );
    const context = contextOf([hourly, other], []);

    expect(scheduleSignal(hourly, context)).toMatchObject({
      state: "overdue",
      label: SIGNAL_WORDS.label.overdue,
      mark: "late",
      weight: SIGNAL_WEIGHTS.overdue,
      late: true,
      words: overdue,
    });
    expect(context.clocks.words).toBe(
      [
        CLOCK_WORDS.compared,
        `${CLOCK_WORDS.aheadOnly}: ${CLOCK_WORDS.ahead({ kind: "schedule", name: "other", time: "submission" }, 50 * MINUTE)}`,
        CLOCK_WORDS.laterStill,
      ].join(" "),
    );
    // With nothing after the clock, the same state and the same words.
    expect(scheduleSignal(hourly, contextOf([hourly], []))).toMatchObject({ state: "overdue", words: overdue });
  });

  it("counts the lateness by the clock of the cluster with the time of the API server, both ways", () => {
    const at = (difference: number, backups: BackupResource[] = []) =>
      scheduleSignal(hourly, contextOf([hourly], backups, now, { date: now + difference, at: now }));
    const holding = [backup("hourly-1", now - 10 * MINUTE, { phase: "InProgress" })];

    // An hour ahead: an hour and a half late by the clock of the cluster, two runs passed.
    expect(at(HOUR)).toMatchObject({ state: "overdue", late: true, expected: { lateness: 90 * MINUTE, passed: 2 } });
    expect(at(HOUR).words).toBe(SIGNAL_WORDS.overdue("1h 30m", "11:30 UTC", from, SIGNAL_WORDS.passed(2, false)));
    // Twenty-eight minutes behind: two minutes late by the clock of the cluster, which is due.
    expect(at(-28 * MINUTE)).toMatchObject({
      state: "due",
      mark: "awaited",
      late: false,
      words: SIGNAL_WORDS.due("11:30 UTC", "2m"),
    });
    // An hour behind: the run is ahead by the clock of the cluster.
    expect(at(-HOUR)).toMatchObject({ state: "awaited", next: { kind: "at", text: SIGNAL_WORDS.inTime("30m") } });
    // Within a second: as by the clock of this machine.
    expect(at(400)).toMatchObject({ state: "overdue", words: overdue });
    // A hold within the grace by the clock of the cluster is not late, and one past it is.
    expect(at(-27 * MINUTE, holding)).toMatchObject({ state: "held", mark: "awaited", late: false });
    expect(at(HOUR, holding)).toMatchObject({ state: "held", mark: "late", late: true });
  });
});

describe("ADH-08: the last observed run in words", () => {
  const own = submitted("nightly", submission, 120);
  const observed = (backups: FamilyRead<BackupResource>, item = nightly, kept?: ServerOffset) => {
    const read = { schedules: succeeded([item], now), backups };

    return lastObservedRun(item, adherenceContext(read, now, kept ?? keepOffset(undefined, read)));
  };
  const wall = "2026-10-13 05:00:41 UTC+02:00";

  it("names the backup of the last submission, and says when it is not among the backups that exist", () => {
    expect(observed(succeeded([own], now))).toEqual({
      submission: { state: "found", at: submission, backup: own.metadata.name },
      words: [SIGNAL_WORDS.observed.found(wall, own.metadata.name)],
    });
    // Gone: the submission stands, and so does the signal counted from it.
    const kept = keepOffset(undefined, reads([nightly], [own]));

    expect(observed(succeeded([], now), nightly, kept)).toEqual({
      submission: { state: "not-found", at: submission },
      words: [SIGNAL_WORDS.observed.notFound(wall)],
    });
    expect(scheduleSignal(nightly, adherenceContext(reads([nightly], []), now, kept)).state).toBe("overdue");
  });

  it("says that a backup newer than the last submission is not a submission, and moves nothing", () => {
    const byHand = backup("nightly-20261013150000", Date.parse("2026-10-13T15:00:00Z"));
    const synced = backup("nightly-20260901030041", Date.parse("2026-10-14T06:00:00Z"));
    const seen = observed(succeeded([own, byHand, synced], now));

    expect(seen.newer).toEqual({ backup: synced.metadata.name, created: Date.parse("2026-10-14T06:00:00Z"), count: 2 });
    expect(seen.words).toEqual([
      SIGNAL_WORDS.observed.found(wall, own.metadata.name),
      SIGNAL_WORDS.observed.newer(synced.metadata.name, "2026-10-14 08:00:00 UTC+02:00"),
      SIGNAL_WORDS.observed.newerMore(1),
    ]);
  });

  it("names the newest backup when it is another and older, and says of a schedule with no submission that none of its backups is one", () => {
    const older = backup("nightly-20261012050041", Date.parse("2026-10-12T03:00:42Z"));
    const seen = observed(succeeded([older], now));

    expect(seen).toEqual({
      submission: { state: "not-found", at: submission },
      newest: older.metadata.name,
      words: [
        SIGNAL_WORDS.observed.notFound("2026-10-13 03:00:41 UTC"),
        SIGNAL_WORDS.observed.newest(older.metadata.name),
      ],
    });
    const fresh = schedule("nightly", { phase: "Enabled" });

    expect(observed(succeeded([older], now), fresh)).toEqual({
      submission: { state: "none" },
      newer: { backup: older.metadata.name, created: Date.parse("2026-10-12T03:00:42Z"), count: 1 },
      words: [SIGNAL_WORDS.observed.none, SIGNAL_WORDS.observed.newer(older.metadata.name, "2026-10-12 03:00:42 UTC")],
    });
  });

  it("does not say whether the backup of the submission exists when the backups were not read", () => {
    const read = failed(emptyRead<BackupResource>(), "forbidden");
    const reason = lowered(unread("backups", read).reason);

    expect(observed(read)).toEqual({
      submission: { state: "not-known", at: submission, reason },
      words: [SIGNAL_WORDS.observed.notKnown("2026-10-13 03:00:41 UTC", reason)],
    });
    expect(observed(read, schedule("nightly", { phase: "Enabled" }))).toEqual({
      submission: { state: "none" },
      words: [SIGNAL_WORDS.observed.none],
    });
  });

  // Probes P8 and P12b of the review of the slice: a read of the backups that ended before the submission cannot
  // hold its backup, and one that failed since says nothing of now.
  it("does not say the backup of the submission gone from a read before it, nor from one that failed since", () => {
    const older = backup("nightly-20261012050041", Date.parse("2026-10-12T03:00:42Z"));
    // The backups last read at 02:00 on the day of the submission, and failing since.
    const before = observed(failed(succeeded([older], Date.parse("2026-10-13T02:00:00Z")), "failed"));
    const reason = SIGNAL_WORDS.observed.readBefore("1d 10h");

    expect(before.submission).toEqual({ state: "not-known", at: submission, reason });
    expect(before.words[0]).toBe(SIGNAL_WORDS.observed.notKnown("2026-10-13 03:00:41 UTC", reason));
    // Both read well, the backups ten seconds ago and the submission five.
    const fresh = schedule("nightly", { phase: "Enabled", lastBackup: "2026-10-14T11:59:55Z" });
    const lagging = lastObservedRun(
      fresh,
      adherenceContext({ schedules: succeeded([fresh], now), backups: succeeded([], now - 10_000) }, now),
    );

    expect(lagging.submission).toEqual({
      state: "not-known",
      at: Date.parse("2026-10-14T11:59:55Z"),
      reason: SIGNAL_WORDS.observed.readBefore("10s"),
    });
    // Read after the submission, and failing since.
    expect(observed(failed(succeeded([older], now - 3 * MINUTE), "failed")).submission).toEqual({
      state: "not-known",
      at: submission,
      reason: SIGNAL_WORDS.observed.readEarlier("3m", SIGNAL_WORDS.since.failed),
    });
    // The last read, after the submission, says that its backup is gone.
    expect(observed(succeeded([older], now)).submission).toEqual({ state: "not-found", at: submission });
  });

  it("never names a missed run between two backups", () => {
    const gap = [backup("nightly-20261001030041", Date.parse("2026-10-01T03:00:42Z")), own];
    const read = succeeded(gap, now);

    expect(JSON.stringify([observed(read), scheduleSignal(nightly, contextOf([nightly], gap))])).not.toMatch(
      /missed|missing|skipped run/i,
    );
  });
});

describe("REQ-168: the order by adherence", () => {
  const every = (name: string, lastBackup: number, expression = "@every 1h") =>
    schedule(name, { phase: "Enabled", lastBackup: new Date(lastBackup).toISOString() }, { schedule: expression });
  const items = [
    schedule(
      "paused",
      { phase: "Enabled", lastBackup: "2026-10-14T10:00:00Z" },
      { schedule: "@every 1h", paused: true },
    ),
    schedule("refused-b", { phase: "FailedValidation" }, { schedule: "TZ= 0 3 * * *" }),
    schedule("refused-a", { phase: "FailedValidation" }, { schedule: "TZ= 0 3 * * *" }),
    every("awaited-later", now - 30 * MINUTE, "@every 2h"),
    every("awaited-soon-b", now - 50 * MINUTE),
    every("awaited-soon-a", now - 50 * MINUTE),
    schedule("zone-b", { phase: "Enabled", lastBackup: "2026-10-13T03:00:41Z" }),
    schedule("zone-a", { phase: "Enabled", lastBackup: "2026-10-13T03:00:41Z" }),
    every("look", now - MINUTE, "@none"),
    every("due", now - 62 * MINUTE),
    every("held", now - 30 * MINUTE),
    every("overdue-shorter", now - 2 * HOUR),
    every("overdue-longer", now - 5 * HOUR),
  ];
  const signals = () => {
    const context = contextOf(items, [backup("held-1", now - 10 * MINUTE, { phase: "InProgress" })]);

    return items.map((item) => ({ name: item.metadata.name, signal: scheduleSignal(item, context) }));
  };

  it("weighs the states in the order of the spec", () => {
    expect(
      (Object.keys(SIGNAL_WEIGHTS) as SignalState[]).sort((one, other) => SIGNAL_WEIGHTS[one] - SIGNAL_WEIGHTS[other]),
    ).toEqual(["overdue", "held", "due", "at-every-look", "not-known", "awaited", "refused", "paused"]);
  });

  it("orders a schedule of every state, two of one weight by their measure, and two by name", () => {
    const ordered = signals()
      .map(({ name, signal }) => ({ name, key: adherenceOrder(signal, name) }))
      .sort((one, other) => (one.key < other.key ? -1 : one.key > other.key ? 1 : 0))
      .map(({ name }) => name);

    expect(signals().map(({ name, signal }) => [name, signal.state])).toEqual(
      expect.arrayContaining([
        ["overdue-longer", "overdue"],
        ["held", "held"],
        ["due", "due"],
        ["look", "at-every-look"],
        ["zone-a", "not-known"],
        ["awaited-soon-a", "awaited"],
        ["refused-a", "refused"],
        ["paused", "paused"],
      ]),
    );
    expect(ordered).toEqual([
      // The longest overdue first, then held, then due.
      "overdue-longer",
      "overdue-shorter",
      "held",
      "due",
      "look",
      // Not known, by name, before what is awaited, the soonest first and by name when as soon.
      "zone-a",
      "zone-b",
      "awaited-soon-a",
      "awaited-soon-b",
      "awaited-later",
      "refused-a",
      "refused-b",
      "paused",
    ]);
  });

  it("gives plain values: nothing in a signal is a function, a date or a value that is not one", () => {
    const all = signals().map(({ signal }) => signal);

    expect(JSON.stringify(all)).not.toMatch(/NaN|undefined|Infinity|function/);
    for (const signal of all) expect(JSON.parse(JSON.stringify(signal))).toStrictEqual(signal as ScheduleSignal);
  });
});
