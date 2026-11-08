// The words of the pause and of the resume of a schedule, with a clock of the test (SPEC-0017, PAUSE-03): what the
// review of a pause says; what the review of a resume says after an instant passed and before it, with and without
// skip immediately, with a last skip later than the last backup, with a backup of the schedule that holds it, with an
// expression the server refuses and with a zone that is not known; the next runs, the ones of the parser of SPEC-0013;
// and what the result says.

import { describe, expect, it } from "vitest";
import { timeText } from "./operation-text";
import { emptyRead, failed, succeeded } from "./read-state";
import { nextInstant, parseExpression } from "./schedule-adherence";
import { patchResultWords, pauseMeaning, resumeMeaning, SCHEDULE_PATCH_VIEW_WORDS } from "./schedule-patch-words";
import { adherenceContext, keepOffset, SIGNAL_WORDS } from "./schedule-signal";
import { LABELS } from "./types";

import type { MeaningPart } from "./backup-from-schedule";
import type { AdherenceContext } from "./schedule-signal";
import type { BackupResource, ScheduleResource } from "./types";

// The zone of the machine the tests run on is one no case below is computed or written in.
process.env.TZ = "Pacific/Kiritimati";

const NOW = Date.parse("2026-10-14T12:00:00Z");
const ZONE_WORDS =
  "The runs are in the zone UTC, which the expression names. The server of the official image of the release knows the zones by their names; a server built otherwise must know this one, which the extension does not read.";
const VALIDATION =
  "Velero validates the expression again when it reads the schedule at the resume, and writes FailedValidation for one it refuses: a schedule it refuses submits no backup.";
const ONLY =
  "The patch tests that the schedule is the one reviewed, still paused and of the same expression, then writes paused false and skip immediately, and nothing else: a schedule that changed since is not resumed.";

function schedule(status: ScheduleResource["status"], spec: ScheduleResource["spec"]): ScheduleResource {
  return {
    metadata: { name: "nightly", namespace: "velero-demo", creationTimestamp: "2026-08-01T00:00:00Z", uid: "u" },
    spec,
    status,
  };
}

// A backup of the schedule, in its phase or with none.
function backup(name: string, phase: string): BackupResource {
  return {
    metadata: {
      name,
      namespace: "velero-demo",
      creationTimestamp: new Date(NOW - 2 * 3_600_000).toISOString(),
      labels: { [LABELS.schedule]: "nightly" },
    },
    status: phase === "" ? {} : { phase },
  };
}

function contextOf(
  item: ScheduleResource,
  backups: BackupResource[] = [],
  now = NOW,
  server?: { date: number; at: number },
): AdherenceContext {
  const read = { schedules: succeeded([item], now), backups: succeeded(backups, now) };

  return adherenceContext(read, now, keepOffset(undefined, read), server);
}

const words = (parts: MeaningPart[]) => Object.fromEntries(parts.map(({ id, words }) => [id, words]));
// Paused with its last backup two days ago: the run of yesterday is due.
const due = schedule(
  { phase: "Enabled", lastBackup: "2026-10-12T03:00:41Z" },
  { schedule: "TZ=UTC 0 3 * * *", paused: true },
);
const runs = (first: string, days: number[]) =>
  `The next 5 runs after the resume, counted from now: ${[first, ...days.map((day) => `2026-10-${day} 03:00 UTC (UTC)`)].filter(Boolean).join("; ")}. ${ZONE_WORDS}`;

describe("the words of the review of a pause", () => {
  it("say that Velero does not read a paused schedule, that a backup submitted goes on, the adherence, and what the patch writes", () => {
    const active = schedule(
      { phase: "Enabled", lastBackup: "2026-10-14T03:00:41Z" },
      { schedule: "TZ=UTC 0 3 * * *", skipImmediately: true },
    );

    expect(pauseMeaning(active, contextOf(active, [backup("nightly-20261014100000", "")]))).toEqual([
      {
        id: "reads",
        words:
          "Velero does not read a paused schedule: it submits no backup, writes no phase and validates nothing until the schedule is resumed.",
      },
      {
        id: "running",
        words: `A backup the schedule already submitted goes on: a pause stops none. ${SIGNAL_WORDS.heldNow("nightly-20261014100000", "none")}`,
      },
      {
        id: "adherence",
        words:
          "The views then say it paused, as its adherence does: no run is expected until it is resumed, and none is counted late.",
      },
      {
        id: "only",
        words:
          "The patch writes paused true and nothing else: skip immediately stays true, and the template and the expression stay as they are.",
      },
    ]);
    const { skipImmediately: _skip, ...spec } = active.spec ?? {};
    const plain = { ...active, spec: spec as ScheduleResource["spec"] };
    const said = words(pauseMeaning(plain, contextOf(plain, [backup("nightly-20261014100000", "Completed")])));

    expect([said.running, said.only]).toEqual([
      "A backup the schedule already submitted goes on: a pause stops none.",
      "The patch writes paused true and nothing else: the schedule keeps no skip immediately, and the template and the expression stay as they are.",
    ]);
    // With nothing read of the installation, no backup is named.
    expect(words(pauseMeaning(plain, undefined)).running).toBe(
      "A backup the schedule already submitted goes on: a pause stops none.",
    );
  });
});

describe("the words of the review of a resume", () => {
  it("say a run due since the last backup submitted at once, once, or skipped with skip immediately, and the runs after it", () => {
    expect(resumeMeaning(due, false, contextOf(due))).toEqual([
      {
        id: "due",
        words: `${SIGNAL_WORDS.resume.submit("03:00 UTC on 2026-10-13")} One backup, and not one for each run that passed while it was paused. Counted from the last submission, 2026-10-12 03:00:41 UTC.`,
      },
      { id: "runs", words: runs("a backup at once", [15, 16, 17, 18]) },
      { id: "validation", words: VALIDATION },
      {
        id: "skip",
        words:
          "The schedule carries no skip immediately, which leaves it to the setting of the Velero server: the resume writes false, and the setting does not decide.",
      },
      { id: "only", words: ONLY },
    ]);
    const skipped = words(resumeMeaning(due, true, contextOf(due)));

    expect([skipped.due, skipped.runs, skipped.skip]).toEqual([
      "A run was due at 03:00 UTC on 2026-10-13: with skip immediately true, Velero skips it when it reads the schedule at the resume, writes that time into status.lastSkipped, counts the next run from it and sets skip immediately back to false. Counted from the last submission, 2026-10-12 03:00:41 UTC.",
      runs("", [15, 16, 17, 18, 19]),
      "The schedule carries no skip immediately, which leaves it to the setting of the Velero server: the resume writes true, and the setting does not decide.",
    ]);
  });

  it("say no run due before the next instant, with skip immediately or without, and count from a last skip later than the last backup", () => {
    const waits = schedule(
      { phase: "Enabled", lastBackup: "2026-10-14T03:00:41Z" },
      { schedule: "TZ=UTC 0 3 * * *", paused: true, skipImmediately: true },
    );
    const without = words(resumeMeaning(waits, false, contextOf(waits)));
    const withSkip = words(resumeMeaning(waits, true, contextOf(waits)));

    expect([without.due, without.runs, without.skip]).toEqual([
      `${SIGNAL_WORDS.resume.wait("03:00 UTC on 2026-10-15")} Counted from the last submission, 2026-10-14 03:00:41 UTC.`,
      runs("", [15, 16, 17, 18, 19]),
      "The schedule carries skip immediately true: the resume writes false in its place.",
    ]);
    expect([withSkip.due, withSkip.runs, withSkip.skip]).toEqual([
      `${SIGNAL_WORDS.resume.wait("03:00 UTC on 2026-10-15")} Counted from the last submission, 2026-10-14 03:00:41 UTC. Skip immediately skips no run, since none is due: Velero sets it back to false when it reads the schedule, and writes that time into status.lastSkipped.`,
      runs("", [15, 16, 17, 18, 19]),
      "The schedule carries skip immediately true: the resume writes it again.",
    ]);
    // Skipped this morning, after the last backup two days ago: the run of yesterday is not due.
    const skippedLater = schedule(
      { phase: "Enabled", lastBackup: "2026-10-12T03:00:41Z", lastSkipped: "2026-10-14T10:00:00Z" },
      { schedule: "TZ=UTC 0 3 * * *", paused: true, skipImmediately: false },
    );
    const later = words(resumeMeaning(skippedLater, false, contextOf(skippedLater)));

    expect([later.due, later.skip]).toEqual([
      `${SIGNAL_WORDS.resume.wait("03:00 UTC on 2026-10-15")} Counted from the last skip, 2026-10-14 10:00:00 UTC.`,
      "The schedule carries skip immediately false: the resume writes it again.",
    ]);
  });

  it("say an interval from the last backup, or from the resume with skip immediately, and its first run alone", () => {
    const every = schedule(
      { phase: "Enabled", lastBackup: "2026-10-14T11:30:00Z" },
      { schedule: "@every 1h", paused: true },
    );
    const later = (first: string, opening = "") =>
      `${opening ? `After the resume: ${opening}, then` : "The first run after the resume:"} ${first}; then each one is at its interval after the submission before it, which comes up to a minute after its instant. An interval is counted without a zone.`;

    expect(words(resumeMeaning(every, false, contextOf(every)))).toMatchObject({
      due: `${SIGNAL_WORDS.resume.wait("12:30 UTC")} Counted from the last submission, 2026-10-14 11:30:00 UTC.`,
      runs: later("2026-10-14 12:30 UTC"),
    });
    expect(words(resumeMeaning(every, true, contextOf(every)))).toMatchObject({
      due: "No run is due. With skip immediately true, Velero counts the next run from the time it reads the schedule at the resume, writes that time into status.lastSkipped and sets skip immediately back to false.",
      runs: later("2026-10-14 13:00 UTC"),
    });
    const late = { ...every, status: { phase: "Enabled", lastBackup: "2026-10-14T09:30:00Z" } };

    expect(words(resumeMeaning(late, false, contextOf(late)))).toMatchObject({
      due: `${SIGNAL_WORDS.resume.submit("10:30 UTC")} One backup, and not one for each run that passed while it was paused. Counted from the last submission, 2026-10-14 09:30:00 UTC.`,
      runs: later("2026-10-14 13:00 UTC", "a backup at once"),
    });
  });

  it("say the backups of the schedule that hold the run that is due, and the runs after them", () => {
    const holding = backup("nightly-20261014100000", "InProgress");
    const held = words(resumeMeaning(due, false, contextOf(due, [holding])));
    const skipped = words(resumeMeaning(due, true, contextOf(due, [holding])));

    expect([held.due, held.runs]).toEqual([
      `${SIGNAL_WORDS.resume.hold("nightly-20261014100000", "InProgress", "03:00 UTC on 2026-10-13")} It submits the run that is due at its first look after that backup ends. Counted from the last submission, 2026-10-12 03:00:41 UTC.`,
      runs("a backup at the first look after nightly-20261014100000 ends", [15, 16, 17, 18]),
    ]);
    expect([skipped.due, skipped.runs]).toEqual([
      `A run was due at 03:00 UTC on 2026-10-13: with skip immediately true, Velero skips it when it reads the schedule at the resume, writes that time into status.lastSkipped, counts the next run from it and sets skip immediately back to false. ${SIGNAL_WORDS.heldNow("nightly-20261014100000", "InProgress")} Counted from the last submission, 2026-10-12 03:00:41 UTC.`,
      runs("", [15, 16, 17, 18, 19]),
    ]);
    // Two backups hold it: the run comes once both ended.
    const two = words(resumeMeaning(due, false, contextOf(due, [holding, backup("nightly-20261014110000", "New")])));

    expect([two.due.includes("after the backups that hold it end."), two.runs]).toEqual([
      true,
      runs("a backup at the first look after the backups that hold it end", [15, 16, 17, 18]),
    ]);
    // An interval held: its next runs count from a submission whose time is not known.
    const every = schedule(
      { phase: "Enabled", lastBackup: "2026-10-14T09:30:00Z" },
      { schedule: "@every 1h", paused: true },
    );

    expect(words(resumeMeaning(every, false, contextOf(every, [holding]))).runs).toBe(
      "After the resume: a backup at the first look after nightly-20261014100000 ends; then each one is at its interval after the submission before it, which comes up to a minute after its instant. An interval is counted without a zone.",
    );
    // The backups not read: whether one holds the schedule is not known, and said beside the run that is due.
    const denied = adherenceContext(
      { schedules: succeeded([due], NOW), backups: failed(emptyRead<BackupResource>(), "forbidden") },
      NOW,
    );
    const unread = words(resumeMeaning(due, false, denied)).due;

    expect(unread.startsWith(SIGNAL_WORDS.resume.submit("03:00 UTC on 2026-10-13"))).toBe(true);
    expect(unread).toMatch(/Whether a backup of the schedule holds the submissions is not known/);
  });

  it("count by the clock of the cluster, which the adherence counts what is due by", () => {
    // The API server is two minutes ahead of this machine, a minute before an instant by its clock.
    const at = Date.parse("2026-10-14T11:59:00Z");
    const noon = schedule(
      { phase: "Enabled", lastBackup: "2026-10-13T12:00:41Z" },
      { schedule: "TZ=UTC 0 12 * * *", paused: true },
    );
    const said = words(resumeMeaning(noon, false, contextOf(noon, [], at, { date: at + 2 * 60_000, at })));

    expect(said.due.startsWith(SIGNAL_WORDS.resume.submit("12:00 UTC"))).toBe(true);
    expect(
      said.runs.startsWith(
        "The next 5 runs after the resume, counted from now: a backup at once; 2026-10-15 12:00 UTC (UTC);",
      ),
    ).toBe(true);
  });

  it("say the runs of the parser of SPEC-0013 in a zone the expression names, with the hour it repeats", () => {
    const now = Date.parse("2026-10-22T12:00:00Z");
    const rome = schedule(
      { phase: "Enabled", lastBackup: "2026-10-22T00:30:41Z" },
      { schedule: "CRON_TZ=Europe/Rome 30 2 * * *", paused: true },
    );
    const said = words(resumeMeaning(rome, false, contextOf(rome, [], now)));
    const parsed = parseExpression("CRON_TZ=Europe/Rome 30 2 * * *");
    const instants: number[] = [];
    let after = now;

    // The five instants the parser of the adherence gives, in UTC: two of them in the hour the zone repeats.
    while (instants.length < 5 && parsed.kind !== "refused") {
      const next = nextInstant(parsed, after, { of: "named", name: "Europe/Rome" });

      if (next.kind !== "instant") break;
      instants.push(next.at);
      after = next.at;
    }
    expect(instants.map((instant) => new Date(instant).toISOString())).toEqual([
      "2026-10-23T00:30:00.000Z",
      "2026-10-24T00:30:00.000Z",
      "2026-10-25T00:30:00.000Z",
      "2026-10-25T01:30:00.000Z",
      "2026-10-26T01:30:00.000Z",
    ]);
    expect(said.due).toBe(
      `${SIGNAL_WORDS.resume.wait("02:30 Europe/Rome on 2026-10-23")} Counted from the last submission, 2026-10-22 02:30:41 Europe/Rome.`,
    );
    expect(said.runs).toBe(
      "The next 5 runs after the resume, counted from now: 2026-10-23 02:30 Europe/Rome (UTC+02:00); 2026-10-24 02:30 Europe/Rome (UTC+02:00); 2026-10-25 02:30 Europe/Rome (UTC+02:00); 2026-10-25 02:30 Europe/Rome (UTC+01:00); 2026-10-26 02:30 Europe/Rome (UTC+01:00). On 2026-10-25 the clock of Europe/Rome goes back from 03:00 to 02:00: the run of the expression in the hour it repeats is expected twice, at 02:30 Europe/Rome (UTC+02:00) and again at 02:30 Europe/Rome (UTC+01:00). The runs are in the zone Europe/Rome, which the expression names. The server of the official image of the release knows the zones by their names; a server built otherwise must know this one, which the extension does not read.",
    );
  });

  it("say no run when the zone of the server is not known, the expression has no instant, it was refused, or nothing was read", () => {
    const noZone = schedule(
      { phase: "Enabled", lastBackup: "2026-10-12T03:00:41Z" },
      { schedule: "0 3 * * *", paused: true },
    );

    expect(resumeMeaning(noZone, true, contextOf(noZone)).map(({ id }) => id)).toEqual([
      "due",
      "runs",
      "validation",
      "skip",
      "only",
    ]);
    expect(words(resumeMeaning(noZone, true, contextOf(noZone))).runs).toBe(
      `The next runs are not known: the expression names no zone, and the zone of the Velero server is not known, since ${contextOf(noZone).noOffset}.`,
    );
    expect(words(resumeMeaning(noZone, false, contextOf(noZone))).due).toBe(
      SIGNAL_WORDS.resume.notKnown(SIGNAL_WORDS.why["no-offset"]),
    );
    expect(words(resumeMeaning(noZone, true, contextOf(noZone))).due).toBe(
      `${SIGNAL_WORDS.resume.notKnown(SIGNAL_WORDS.why["no-offset"])} With skip immediately true, Velero submits nothing at once: it counts the next run from the time it reads the schedule.`,
    );
    const none = schedule(
      { phase: "Enabled", lastBackup: "2026-10-12T03:00:41Z" },
      { schedule: "@none", paused: true },
    );

    expect(words(resumeMeaning(none, false, contextOf(none))).due).toBe(
      SIGNAL_WORDS.resume.everyLook(SIGNAL_WORDS.noInstant("@none")),
    );
    expect(words(resumeMeaning(none, true, contextOf(none))).due).toBe(
      `${SIGNAL_WORDS.resume.everyLook(SIGNAL_WORDS.noInstant("@none"))} Skip immediately skips nothing here: Velero writes the time it reads the schedule into status.lastSkipped, and submits at that look all the same, since the expression has no instant to count the next run to.`,
    );
    const beyond = schedule(
      { phase: "Enabled", lastBackup: "2026-10-12T03:00:41Z" },
      { schedule: "TZ=UTC 0 0 30 2 *", paused: true },
    );

    expect(words(resumeMeaning(beyond, false, contextOf(beyond))).due).toBe(
      SIGNAL_WORDS.resume.everyLook(SIGNAL_WORDS.beyondFiveYears),
    );
    const refused = schedule({ phase: "FailedValidation" }, { schedule: "0 3 * *", paused: true });

    expect(resumeMeaning(refused, false, contextOf(refused))).toEqual([
      {
        id: "due",
        words:
          "Velero refused the expression when it last read the schedule, before the pause: it is FailedValidation, and submits no backup while Velero refuses it.",
      },
      { id: "validation", words: VALIDATION },
      {
        id: "skip",
        words:
          "The schedule carries no skip immediately, which leaves it to the setting of the Velero server: the resume writes false, and the setting does not decide.",
      },
      { id: "only", words: ONLY },
    ]);
    expect(words(resumeMeaning(due, false, undefined)).due).toBe(
      "Whether Velero submits a backup at the resume is not known: the backups of the installation were not read.",
    );
    // An expression this version cannot read: whether it has an instant to skip is not known either.
    const unreadable = schedule(
      { phase: "Enabled", lastBackup: "2026-10-12T03:00:41Z" },
      { schedule: "0 3 * * FRI#L", paused: true },
    );

    expect(words(resumeMeaning(unreadable, true, contextOf(unreadable))).due).toBe(
      SIGNAL_WORDS.resume.notKnown(SIGNAL_WORDS.why["not-readable"]),
    );
    // A schedule Velero never read, and a phase this version does not know.
    const never = schedule(undefined, { schedule: "TZ=UTC 0 3 * * *", paused: true });

    expect(words(resumeMeaning(never, false, contextOf(never))).due).toBe(
      "Velero had not validated the schedule when it was paused: it validates it when it reads it at the resume, and once it takes the expression, a run is due at once when an instant of the expression has passed since the creation, unless skip immediately is true.",
    );
    const odd = schedule({ phase: "Odd" }, { schedule: "TZ=UTC 0 3 * * *", paused: true });

    expect(words(resumeMeaning(odd, false, contextOf(odd))).due).toBe(
      `${SIGNAL_WORDS.resume.unknownPhase("Odd")} Whether Velero submits a backup at the resume is not known.`,
    );
  });
});

describe("the words of the workspace and of the result", () => {
  it("say writes off for each action: a pause has no field, a resume its choice", () => {
    expect([
      SCHEDULE_PATCH_VIEW_WORDS.writesOff("schedule-pause"),
      SCHEDULE_PATCH_VIEW_WORDS.writesOff("schedule-resume"),
    ]).toEqual([
      "Writes are off for this installation: the review asks for writes on, which are turned on in the target bar.",
      "Writes are off for this installation: the choice can be made, and the review asks for writes on, which are turned on in the target bar.",
    ]);
  });

  it("say what the schedule carries of skip immediately, and what the choice writes in its place", () => {
    expect(SCHEDULE_PATCH_VIEW_WORDS.carried(undefined, true)).toBe(
      "The schedule carries no skip immediately, which leaves it to the setting of the Velero server: the resume writes true, and the setting does not decide.",
    );
    expect(SCHEDULE_PATCH_VIEW_WORDS.carried(null, false)).toContain("carries no skip immediately");
    expect(SCHEDULE_PATCH_VIEW_WORDS.carried(false, false)).toBe(
      "The schedule carries skip immediately false: the resume writes it again.",
    );
    expect(SCHEDULE_PATCH_VIEW_WORDS.carried(false, true)).toBe(
      "The schedule carries skip immediately false: the resume writes true in its place.",
    );
  });

  it("say the schedule paused, or resumed with what skip immediately holds and the time Velero skipped", () => {
    expect(patchResultWords("schedule-pause", { name: "nightly", uid: "u", paused: true })).toEqual([
      "The schedule nightly is paused: Velero does not read it until it is resumed.",
    ]);
    expect(
      patchResultWords("schedule-resume", { name: "nightly", uid: "u", paused: false, skipImmediately: false }),
    ).toEqual([
      "The schedule nightly is resumed: Velero reads it at once.",
      "Skip immediately is false: a run that is due is submitted.",
    ]);
    expect(
      patchResultWords("schedule-resume", { name: "nightly", uid: "u", paused: false, skipImmediately: true })[1],
    ).toBe(
      "Skip immediately is true: Velero had not read the schedule when it was read after the patch, and sets it back to false when it does.",
    );
    expect(
      patchResultWords("schedule-resume", {
        name: "nightly",
        uid: "u",
        paused: false,
        skipImmediately: false,
        lastSkipped: "2026-10-14T12:00:01Z",
      })[1],
    ).toBe(
      `Velero read the schedule, set skip immediately back to false, and wrote that it skipped at ${timeText(Date.parse("2026-10-14T12:00:01Z"))}: the next run is counted from that time.`,
    );
  });
});
