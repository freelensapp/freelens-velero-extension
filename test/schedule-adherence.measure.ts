import { describe, expect, it } from "vitest";
import { mixedExpression } from "../e2e/scripts/local-expressions.mts";
import { succeeded } from "../src/common/read-state";
import { COUNT_BOUND, parseExpression } from "../src/common/schedule-adherence";
import { adherenceContext, keepOffset, scheduleSignal } from "../src/common/schedule-signal";
import { LABELS } from "../src/common/types";

import type { AdherenceContext, AdherenceReads, ScheduleSignal } from "../src/common/schedule-signal";
import type { BackupResource, ScheduleResource } from "../src/common/types";

// The measure of the unit tests of the adherence (ADH-16, REQ-175): the signals of 1,000 schedules of mixed
// expressions, every so many minutes or hours, five fields with and without a zone name, the calendar
// descriptors and a few with no instant, each the full signal with its words, as a list computes them for a
// read and a clock: the offset of the server derived from the backups of the submissions, what the
// installation shares for the read, and the signal of every schedule. They are computed twenty times after
// five calls that warm them, within the budget of an interaction at the 95th percentile; and the signal of
// one schedule within its own budget. The parsed expressions are kept by their text and the count of the
// expected runs that passed is bounded, which the measure asserts beside the times. No other test times them:
// this file is run by its own configuration, once the other tests ended and alone, as the measure of the log is.
const BUDGET = 250;
const ONE_BUDGET = 2;
const SCHEDULES = 1000;
const WARM = 5;
const MEASURED = 20;
const NAMESPACE = "velero-adherence";

// The clock of the measure, and the placement the fixtures of the packaged application count their times
// back from: every submission is at the placement or in the hours before it.
const NOW = Date.parse("2026-10-14T14:00:00.250Z");
// The zone of the server the backups of the submissions are named in: two hours east of UTC.
const SERVER_MINUTES = 120;

// The schedules: each with its last submission between the placement and 35 hours before it, so that a
// few expected runs passed for most of them and more than the bound for the ones every few minutes. Their
// expressions are the ones the fixtures of the budget of the adherence place, each of its own text but for
// the descriptors, so that the parses are measured on the first call.
function schedules(): ScheduleResource[] {
  return Array.from({ length: SCHEDULES }, (_, index) => ({
    metadata: {
      name: `schedule-${index}`,
      namespace: NAMESPACE,
      creationTimestamp: "2026-09-01T00:00:00Z",
    },
    spec: { schedule: mixedExpression(index) },
    status: { phase: "Enabled", lastBackup: new Date(NOW - (index % 36) * 3_600_000 - 250).toISOString() },
  }));
}

function backup(name: string, schedule: string, created: number, phase: string): BackupResource {
  return {
    metadata: {
      name,
      namespace: NAMESPACE,
      creationTimestamp: new Date(created).toISOString(),
      labels: { [LABELS.schedule]: schedule },
    },
    status: { phase },
  };
}

// The backups: the one of the last submission of each schedule, named as the controller names it with the
// wall clock of a server two hours east of UTC and created a second after the submission; and, for one
// schedule in a hundred, a backup in progress that holds its submissions.
function backups(items: ScheduleResource[]): BackupResource[] {
  return items.flatMap((item, index) => {
    const submission = Date.parse(item.status?.lastBackup ?? "");
    const wall = new Date(Math.floor(submission / 1000) * 1000 + SERVER_MINUTES * 60_000);
    const digits = wall.toISOString().replace(/[-:T]/g, "").slice(0, 14);
    const name = item.metadata.name;

    return [
      backup(`${name}-${digits}`, name, submission + 1000, "Completed"),
      ...(index % 100 === 50 ? [backup(`${name}-by-hand`, name, NOW - 600_000, "InProgress")] : []),
    ];
  });
}

// The signals of every schedule, as a list computes them for a read and a clock: the offset of the server
// kept from the backups of the read, what the installation shares, and the signal of each schedule.
function signals(reads: AdherenceReads, items: ScheduleResource[]): ScheduleSignal[] {
  const context = adherenceContext(reads, NOW, keepOffset(undefined, reads));

  return items.map((item) => scheduleSignal(item, context));
}

// The percentile of the measures of the packaged application: of twenty times, the 95th leaves the slowest
// out, and no other.
function percentile(values: number[], fraction: number): number {
  const sorted = [...values].sort((one, other) => one - other);

  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
}

function timed<Value>(call: () => Value): { ms: number; value: Value } {
  const start = performance.now();
  const value = call();

  return { ms: performance.now() - start, value };
}

const tenths = (ms: number) => Math.round(ms * 10) / 10;
const hundredths = (ms: number) => Math.round(ms * 100) / 100;

function series(times: number[], round: (ms: number) => number) {
  return {
    p95: round(percentile(times, 0.95)),
    median: round(percentile(times, 0.5)),
    slowest: round(Math.max(...times)),
  };
}

describe("the signals of a thousand schedules", { timeout: 120_000 }, () => {
  const items = schedules();
  const reads: AdherenceReads = { schedules: succeeded(items, NOW), backups: succeeded(backups(items), NOW) };
  // One schedule of five fields in a zone it names, with its last submission 29 hours before the clock: a
  // parse, the next instant, the count of the runs that passed and the words, in the installation of the read.
  const one = items[353];

  it("are computed with their words within the budget at the 95th percentile, the parse kept and the count bounded", () => {
    // The first call parses the thousand expressions and reads the zones: its time is reported, not held
    // to the budget, since a list parses each expression once for its text.
    const cold = timed(() => signals(reads, items));
    const warm = Array.from({ length: WARM - 1 }, () => timed(() => signals(reads, items)).ms);
    const measured = Array.from({ length: MEASURED }, () => timed(() => signals(reads, items)));
    const context: AdherenceContext = adherenceContext(reads, NOW, keepOffset(undefined, reads));
    const shared = timed(() => adherenceContext(reads, NOW, keepOffset(undefined, reads)));
    const oneWarm = Array.from({ length: WARM }, () => timed(() => scheduleSignal(one, context)).ms);
    const oneMeasured = Array.from({ length: MEASURED }, () => timed(() => scheduleSignal(one, context)));
    const states: Record<string, number> = {};
    let bounded = 0;
    let passed = 0;
    let words = 0;

    for (const signal of cold.value) {
      states[signal.state] = (states[signal.state] ?? 0) + 1;
      passed += signal.expected?.passed ?? 0;
      if (signal.expected?.beyond) bounded += 1;
      words += [signal.words, ...signal.notes].join(" ").length;
    }
    const report = {
      schedules: items.length,
      expressions: new Set(items.map((item) => item.spec?.schedule)).size,
      backups: reads.backups.items.length,
      budget: BUDGET,
      oneBudget: ONE_BUDGET,
      offset: context.offset?.minutes,
      states,
      passed,
      bounded,
      words,
      cold: tenths(cold.ms),
      shared: hundredths(shared.ms),
      all: {
        ...series(
          measured.map((call) => call.ms),
          tenths,
        ),
        warm: warm.map(tenths),
        times: measured.map((call) => tenths(call.ms)),
      },
      one: {
        ...series(
          oneMeasured.map((call) => call.ms),
          hundredths,
        ),
        warm: oneWarm.map(hundredths),
        times: oneMeasured.map((call) => hundredths(call.ms)),
      },
    };

    // Written before anything is asserted, so that a run that fails leaves its numbers.
    console.log(`ADH-16 unit ${JSON.stringify(report)}`);
    // A thousand schedules of 898 expressions, since the seven descriptors and the expression with no instant
    // repeat, every one read with the offset derived from the backups of the submissions, ten of them with no
    // instant and ten held by a backup in progress: no signal is not known.
    expect(items.length).toBe(SCHEDULES);
    expect(report.expressions).toBe(898);
    expect(context.offset).toMatchObject({ minutes: SERVER_MINUTES });
    expect(states["not-known"]).toBeUndefined();
    expect(states["at-every-look"]).toBe(10);
    expect(states.held).toBe(10);
    expect(
      Object.keys(states).every((state) => ["awaited", "due", "overdue", "held", "at-every-look"].includes(state)),
    ).toBe(true);
    // Every call answered what the first one did: the computation depends on its arguments alone.
    const first = JSON.stringify(cold.value);

    expect(measured.every((call) => JSON.stringify(call.value) === first)).toBe(true);
    const oneFirst = JSON.stringify(scheduleSignal(one, context));

    expect(oneMeasured.every((call) => JSON.stringify(call.value) === oneFirst)).toBe(true);
    // The parse of an expression is kept for its text, and the count stops at the bound: the schedules every
    // few minutes that are hours old count a hundred and say that there are more.
    expect(
      items.every((item) => {
        const parsed = parseExpression(item.spec?.schedule);

        return parseExpression(item.spec?.schedule) === parsed;
      }),
    ).toBe(true);
    expect(bounded).toBeGreaterThan(0);
    expect(cold.value.filter((signal) => (signal.expected?.passed ?? 0) > COUNT_BOUND)).toEqual([]);
    expect(scheduleSignal(one, context)).toMatchObject({ state: "overdue", expected: { beyond: false } });
    // Every call took a time, and both series answer within their budget at the 95th percentile.
    expect(measured.every((call) => call.ms > 0) && oneMeasured.every((call) => call.ms > 0)).toBe(true);
    expect(report.all.p95).toBeLessThan(BUDGET);
    expect(report.one.p95).toBeLessThan(ONE_BUDGET);
  });
});
