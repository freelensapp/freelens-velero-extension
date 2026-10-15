import { describe, expect, it } from "vitest";
import { emptyRead, failed, succeeded } from "./read-state";
import { CLOCK_WORDS, clocksOf, keepOffset } from "./schedule-signal";
import { LABELS } from "./types";

import type { AdherenceReads, ServerOffset } from "./schedule-signal";
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
    status: {
      phase: more.phase ?? "Completed",
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

    expect(clocks).toMatchObject({ now, ahead: 0, bound: 0 });
    expect(clocks.by).toBeUndefined();
    expect(clocks.server).toBeUndefined();
    expect(clocks.words).toBe(`${CLOCK_WORDS.compared} ${CLOCK_WORDS.aheadOnly}: ${CLOCK_WORDS.noneAhead}`);
    expect(CLOCK_WORDS.aheadOnly).toContain("Only a clock of the cluster that is ahead");
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

    expect(clocks).toMatchObject({ ahead: HOUR, by: { kind, name, time }, bound: HOUR });
    expect(clocks.words).toContain(CLOCK_WORDS.ahead({ kind, name, time }, HOUR));
    expect(clocks.words).toContain(CLOCK_WORDS.bound(HOUR));
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

  it("compares the clocks through the time of the API server both ways when it is given, and says so", () => {
    const quiet = reads([bare({ lastBackup: "2026-10-14T03:00:41Z" })], []);
    const ahead = clocksOf(quiet, now, { date: now + 3 * MINUTE, at: now });
    const behind = clocksOf(quiet, now, { date: now - 2 * MINUTE, at: now });
    const agree = clocksOf(quiet, now, { date: now + 400, at: now });

    expect(ahead).toMatchObject({ server: 3 * MINUTE, bound: 3 * MINUTE, ahead: 0 });
    expect(ahead.words).toBe(
      [CLOCK_WORDS.compared, CLOCK_WORDS.server(3 * MINUTE), CLOCK_WORDS.bound(3 * MINUTE)].join(" "),
    );
    expect(behind).toMatchObject({ server: -2 * MINUTE, bound: 2 * MINUTE });
    expect(behind.words).toContain(CLOCK_WORDS.server(-2 * MINUTE));
    expect(CLOCK_WORDS.server(-2 * MINUTE)).toContain("behind");
    expect(CLOCK_WORDS.server(3 * MINUTE)).toContain("ahead");
    expect(agree).toMatchObject({ server: 400, bound: 400 });
    expect(agree.words).toBe([CLOCK_WORDS.compared, CLOCK_WORDS.server(400)].join(" "));
    expect(CLOCK_WORDS.server(400)).toContain("within a second");
    // Without it, only a cluster that is ahead can be seen: the words say which of the two holds.
    expect(clocksOf(quiet, now).words).toContain(CLOCK_WORDS.aheadOnly);
    expect(ahead.words).not.toContain(CLOCK_WORDS.aheadOnly);
    // An object ahead by more than the API server says is said beside it, and bounds what is said overdue.
    const both = clocksOf(reads([bare({ lastBackup: new Date(now + HOUR).toISOString() })], []), now, {
      date: now + 3000,
      at: now,
    });

    expect(both).toMatchObject({ ahead: HOUR, server: 3000, bound: HOUR });
    expect(both.words).toContain(CLOCK_WORDS.object({ kind: "schedule", name: "nightly", time: "submission" }, HOUR));
  });
});
