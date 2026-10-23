// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { backupObject, HOUR, scheduleObject, submissionOf } from "../../../test/adherence-builders";
import { emptyRead, failed, succeeded } from "../../common/read-state";
import { adherenceContext, lastObservedRun, SIGNAL_WORDS, scheduleSignal } from "../../common/schedule-signal";
import { AdherenceBand, BAND_WORDS } from "./adherence";

import type { BackupResource, ScheduleResource } from "../../common/types";

// The zone of the machine the tests run on is one no case below is computed or written in, fourteen hours east
// of UTC, as in the tests of the signal: a word of the adherence written in it would fail.
process.env.TZ = "Pacific/Kiritimati";

const NOW = Date.parse("2026-09-10T12:00:00Z");
const NS = "velero-demo";
// The run of today at three, submitted: the backup the controller made for it exists.
const SUBMITTED = Date.parse("2026-09-10T03:00:00Z");

afterEach(cleanup);

const band = () => screen.getByTestId("velero-schedule-adherence");
const lines = () => [...band().querySelectorAll("[data-line]")].map((row) => row.getAttribute("data-line"));
const line = (name: string) => band().querySelector(`[data-line="${name}"] td`);

function drawn(schedule: ScheduleResource, backups: BackupResource[]) {
  const context = adherenceContext({ schedules: succeeded([schedule], NOW), backups: succeeded(backups, NOW) }, NOW);

  render(<AdherenceBand schedule={schedule} context={context} />);
  return { context, signal: scheduleSignal(schedule, context), observed: lastObservedRun(schedule, context) };
}

describe("band of the adherence of a schedule", () => {
  it("says while the backups of the installation are read that it says the adherence once they are", () => {
    render(<AdherenceBand schedule={scheduleObject("nightly", NS)} />);
    expect(band().getAttribute("data-adherence")).toBe("loading");
    expect(band().textContent).toBe(BAND_WORDS.loading);
    expect(lines()).toEqual([]);
  });

  it("draws one line for each fact it has, in the order an operator reads them, and the clocks always", () => {
    const schedule = scheduleObject("nightly", NS, { expression: "TZ=UTC 0 3 * * *", lastBackup: SUBMITTED });
    const { context, signal } = drawn(schedule, [submissionOf("nightly", NS, SUBMITTED, 0)]);
    const order = ["next", "zone", "anchor", "observed", "held", "passed", "clocks"];
    const shown = lines();

    expect(band().getAttribute("data-adherence")).toBe(signal.state);
    // Every line it draws is one of the band, in the order of the band, each once.
    expect(shown).toEqual(order.filter((name) => shown.includes(name)));
    for (const always of ["next", "observed", "clocks"]) expect(shown).toContain(always);
    expect(shown.includes("zone")).toBe(Boolean(signal.zone));
    expect(shown.includes("anchor")).toBe(Boolean(signal.anchor));
    expect(shown.includes("passed")).toBe(Boolean(signal.expected));
    // Nothing holds the submissions of this schedule: no line says what holds them.
    expect(shown).not.toContain("held");
    expect(line("next")?.textContent).toContain(signal.words);
    expect(line("next")?.textContent).toContain(SIGNAL_WORDS.grace);
    expect(line("clocks")?.textContent).toBe(context.clocks.words);
    // The backup of the submission is named with the way to its view.
    expect(
      line("observed")?.querySelector(
        `[data-testid="velero-open-backup-${submissionOf("nightly", NS, SUBMITTED, 0).metadata.name}"]`,
      ),
    ).not.toBeNull();
  });

  it("draws for a schedule of each state its lines in order, what holds it only when something does", () => {
    const at = (time: string) => Date.parse(time);
    // One schedule of each state, each with its own backups: overdue by an hour, due by two minutes, held by a
    // backup in progress, submitted at every look, awaited, not read by Velero, refused and paused.
    const cases: [ScheduleResource, BackupResource[]][] = [
      [scheduleObject("late", NS, { expression: "TZ=UTC 0 11 * * *", lastBackup: at("2026-09-09T11:00:00Z") }), []],
      [scheduleObject("tick", NS, { expression: "TZ=UTC 58 11 * * *", lastBackup: at("2026-09-09T11:58:00Z") }), []],
      [
        scheduleObject("holding", NS, { expression: "TZ=UTC 0 11 * * *", lastBackup: at("2026-09-09T11:00:00Z") }),
        [
          submissionOf("holding", NS, at("2026-09-09T11:00:00Z"), 0, {
            phase: "InProgress",
            start: at("2026-09-09T11:00:02Z"),
          }),
        ],
      ],
      [scheduleObject("look", NS, { expression: "TZ=UTC 0 0 30 2 *", lastBackup: at("2026-09-10T11:59:00Z") }), []],
      [
        scheduleObject("nightly", NS, { expression: "TZ=UTC 0 3 * * *", lastBackup: SUBMITTED }),
        [submissionOf("nightly", NS, SUBMITTED, 0)],
      ],
      [scheduleObject("fresh", NS, { phase: "" }), []],
      [
        scheduleObject("broken", NS, {
          expression: "every night",
          phase: "FailedValidation",
          validationErrors: ["invalid schedule: expected exactly 5 fields, found 2"],
        }),
        [],
      ],
      [
        scheduleObject("weekly", NS, { expression: "0 4 * * 0", paused: true, lastBackup: at("2026-08-30T04:00:00Z") }),
        [],
      ],
    ];
    const order = ["next", "zone", "anchor", "observed", "held", "passed", "clocks"];
    const states = new Set<string>();
    // For each line of the band, whether a schedule had it, and whether one had it not.
    const seen = new Map<string, Set<boolean>>(order.map((name) => [name, new Set<boolean>()]));

    for (const [schedule, backups] of cases) {
      const { context, signal } = drawn(schedule, backups);
      const shown = lines();

      states.add(signal.state);
      for (const name of order) seen.get(name)?.add(shown.includes(name));
      expect([schedule.metadata.name, band().getAttribute("data-adherence")]).toEqual([
        schedule.metadata.name,
        signal.state,
      ]);
      expect(shown).toEqual(order.filter((name) => shown.includes(name)));
      for (const always of ["next", "observed", "clocks"]) expect(shown).toContain(always);
      expect([schedule.metadata.name, shown.includes("held")]).toEqual([
        schedule.metadata.name,
        signal.hold?.state === "held" || signal.hold?.state === "not-known",
      ]);
      expect(line("clocks")?.textContent).toBe(context.clocks.words);
      // The grace is said of the states whose run is expected, or held, and of no other.
      expect([schedule.metadata.name, Boolean(line("next")?.querySelector("[data-grace]"))]).toEqual([
        schedule.metadata.name,
        ["awaited", "due", "overdue", "held"].includes(signal.state),
      ]);
      cleanup();
    }
    expect([...states].sort()).toEqual(
      ["at-every-look", "awaited", "due", "held", "not-known", "overdue", "paused", "refused"].sort(),
    );
    // The lines that are not always drawn were each drawn for one of them and not for another.
    expect(Object.fromEntries([...seen].map(([name, values]) => [name, [...values].sort()]))).toEqual({
      next: [true],
      zone: [false, true],
      anchor: [false, true],
      observed: [true],
      held: [false, true],
      passed: [false, true],
      clocks: [true],
    });
  });

  it("names the newer backup that is not a submission, and the newest one, each with the way to its view", () => {
    const schedule = scheduleObject("nightly", NS, { expression: "TZ=UTC 0 3 * * *", lastBackup: SUBMITTED });
    const own = submissionOf("nightly", NS, SUBMITTED, 0);
    // Asked by hand two hours after the submission, with the label of the schedule.
    const byHand = backupObject("nightly-by-hand", NS, SUBMITTED + 2 * HOUR, { schedule: "nightly" });
    const way = (backup: BackupResource) =>
      line("observed")?.querySelector(`[data-testid="velero-open-backup-${backup.metadata.name}"]`) ?? null;
    const newer = drawn(schedule, [own, byHand]);
    const words = (observed: string[]) => {
      for (const sentence of observed) expect(line("observed")?.textContent).toContain(sentence);
    };

    expect(newer.observed.newer?.backup).toBe("nightly-by-hand");
    words(newer.observed.words);
    expect(way(own)).not.toBeNull();
    expect(way(byHand)).not.toBeNull();
    cleanup();
    // The backup of the submission is gone, and the one of the run of the day before is the newest that exists.
    const before = submissionOf("nightly", NS, SUBMITTED - 24 * HOUR, 0);
    const gone = drawn(schedule, [before]);

    expect(gone.observed.submission.state).toBe("not-found");
    expect(gone.observed.newest).toBe(before.metadata.name);
    words(gone.observed.words);
    expect(way(before)).not.toBeNull();
    expect(line("observed")?.querySelectorAll('[data-testid^="velero-open-"]')).toHaveLength(1);
  });

  it("says each sentence of what holds the submissions once, on the line of the hold", () => {
    const count = (text: string) => (band().textContent ?? "").split(text).length - 1;
    // Two backups of the run hold the submissions.
    const schedule = scheduleObject("nightly", NS, { expression: "TZ=UTC 0 3 * * *", lastBackup: SUBMITTED });
    const holding = [
      submissionOf("nightly", NS, SUBMITTED, 0, { phase: "InProgress", start: SUBMITTED + 2000 }),
      backupObject("nightly-by-hand", NS, SUBMITTED + 60_000, { schedule: "nightly", phase: "InProgress" }),
    ];
    const two = drawn(schedule, holding);

    expect([two.signal.state, two.signal.hold?.state === "held" && two.signal.hold.others]).toEqual(["held", 1]);
    expect(count(SIGNAL_WORDS.heldMore(1))).toBe(1);
    expect(line("held")?.textContent).toContain(SIGNAL_WORDS.heldMore(1));
    cleanup();
    // Submitted at every look while a backup holds: the backup is named once.
    const look = scheduleObject("look", NS, { expression: "TZ=UTC 0 0 30 2 *", lastBackup: SUBMITTED });
    const inProgress = submissionOf("look", NS, SUBMITTED, 0, { phase: "InProgress", start: SUBMITTED + 2000 });
    const every = drawn(look, [inProgress]);
    const now = SIGNAL_WORDS.heldNow(inProgress.metadata.name, "InProgress");

    expect([every.signal.state, every.signal.words.includes(now)]).toEqual(["at-every-look", true]);
    expect(count(now)).toBe(1);
    expect(line("held")?.textContent).toContain(now);
    cleanup();
    // The backups cannot be read: whether one holds is not known, which the line of the hold says, and only it.
    const context = adherenceContext(
      { schedules: succeeded([schedule], NOW), backups: failed(emptyRead<BackupResource>(), "forbidden") },
      NOW,
    );
    const signal = scheduleSignal(schedule, context);

    render(<AdherenceBand schedule={schedule} context={context} />);
    expect(signal.hold?.state).toBe("not-known");
    const said = signal.hold?.state === "not-known" ? SIGNAL_WORDS.holdNotKnown(signal.hold.reason) : "";

    expect(signal.notes).toContain(said);
    expect(line("held")?.textContent).toBe(said);
    expect(count(said)).toBe(1);
  });

  it("says what holds the submissions, with the way to the backup that holds them", () => {
    const schedule = scheduleObject("nightly", NS, { expression: "TZ=UTC 0 3 * * *", lastBackup: SUBMITTED });
    const holding = submissionOf("nightly", NS, SUBMITTED, 0, { phase: "InProgress", start: SUBMITTED + 2000 });
    const { signal } = drawn(schedule, [holding]);

    expect(signal.hold?.state).toBe("held");
    expect(lines()).toContain("held");
    expect(line("held")?.querySelector(`[data-testid="velero-open-backup-${holding.metadata.name}"]`)).not.toBeNull();
  });
});
