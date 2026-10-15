import { describe, expect, it } from "vitest";
import { COUNT_BOUND, expectedRun, expressionZone, parseExpression, UTC } from "../src/common/schedule-adherence";

import type { ExpectedRun, Zone } from "../src/common/schedule-adherence";
import type { ScheduleResource } from "../src/common/types";

// The measure of the unit tests of the adherence (ADH-16, REQ-175): the signals of 1,000 schedules of mixed
// expressions, every so many minutes or hours, five fields with and without a zone name, the calendar
// descriptors and a few with no instant, computed twenty times after five calls that warm them, within the
// budget of an interaction at the 95th percentile; and the signal of one schedule within its own budget.
// The parsed expressions are kept by their text and the count of the expected runs that passed is bounded,
// which the measure asserts beside the times. No other test times them: this file is run by its own
// configuration, once the other tests ended and alone, as the measure of the log is.
const BUDGET = 250;
const ONE_BUDGET = 2;
const SCHEDULES = 1000;
const WARM = 5;
const MEASURED = 20;

// The clock of the measure, and the placement the fixtures of the packaged application count their times
// back from: every submission is at the placement or in the hours before it.
const NOW = Date.parse("2026-10-14T14:00:00.250Z");
// The zone of the server, as the views would derive it: two hours east of UTC.
const SERVER: Zone = { of: "fixed", minutes: 120 };
const DESCRIPTORS = ["@hourly", "@daily", "@weekly", "@monthly", "@yearly", "@midnight", "@annually"];

// The expressions, each of its own text but for the descriptors, so that the parses are measured on the
// first call: the minute and the hour of a five-field expression are the ones of the schedule, and so is
// the interval of an @every one. A tenth of them name a zone east of UTC, a tenth a zone west of it, a tenth
// is a zone east of UTC again, a tenth a calendar descriptor, and one in a hundred has no instant, which the
// controller submits at every look.
function expression(index: number): string {
  const minute = index % 60;
  const hour = Math.floor(index / 60) % 24;

  switch (index % 10) {
    case 0:
      return `@every ${(index % 9) + 1}m${index % 59}s`;
    case 1:
      return `@every ${index + 1}h`;
    case 2:
      return `${minute} ${hour} * * *`;
    case 3:
      return `TZ=Europe/Rome ${minute} ${hour} * * *`;
    case 4:
      return `CRON_TZ=America/New_York ${minute} ${hour} * * 1-5`;
    case 5:
      return `${minute % 30}/30 ${hour} * * ${index % 7}`;
    case 6:
      return `${minute} ${hour} 1,15 * *`;
    case 7:
      return DESCRIPTORS[index % DESCRIPTORS.length];
    case 8:
      return `TZ=Asia/Tokyo ${minute} ${hour} * * *`;
    default:
      return index % 100 === 99 ? "0 0 30 2 *" : `${minute} ${hour} * * 0`;
  }
}

// The schedules: each with its last submission between the placement and 35 hours before it, so that a
// few expected runs passed for most of them and more than the bound for the ones every few minutes.
function schedules(): ScheduleResource[] {
  return Array.from({ length: SCHEDULES }, (_, index) => ({
    metadata: {
      name: `schedule-${index}`,
      namespace: "velero-adherence",
      creationTimestamp: "2026-09-01T00:00:00Z",
    },
    spec: { schedule: expression(index) },
    status: { phase: "Enabled", lastBackup: new Date(NOW - (index % 36) * 3_600_000 - 250).toISOString() },
  }));
}

// The signals of every schedule, as a list computes them when it is drawn: the expression parsed, its zone
// the one it names or the one of the server, the expected run from the anchor and the clock.
function signals(items: ScheduleResource[]): ExpectedRun[] {
  return items.map((item) => {
    const parsed = parseExpression(item.spec?.schedule);

    return expectedRun(item, parsed, parsed.kind === "refused" ? UTC : (expressionZone(parsed) ?? SERVER), NOW);
  });
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
  // One schedule of five fields in a zone it names, with its last submission 29 hours before the clock: a
  // parse, the next instant and the count of the runs that passed.
  const one = items[353];

  it("are computed within the budget at the 95th percentile, the parse kept and the count bounded", () => {
    // The first call parses the thousand expressions and reads the zones: its time is reported, not held
    // to the budget, since a list parses each expression once for its text.
    const cold = timed(() => signals(items));
    const warm = Array.from({ length: WARM - 1 }, () => timed(() => signals(items)).ms);
    const measured = Array.from({ length: MEASURED }, () => timed(() => signals(items)));
    const oneWarm = Array.from({ length: WARM }, () => timed(() => signals([one])).ms);
    const oneMeasured = Array.from({ length: MEASURED }, () => timed(() => signals([one])));
    const kinds: Record<string, number> = {};
    let bounded = 0;
    let passed = 0;

    for (const signal of cold.value) {
      kinds[signal.kind] = (kinds[signal.kind] ?? 0) + 1;
      if (signal.kind === "expected") {
        passed += signal.passed;
        if (signal.beyond) bounded += 1;
      }
    }
    const report = {
      schedules: items.length,
      expressions: new Set(items.map((item) => item.spec?.schedule)).size,
      budget: BUDGET,
      oneBudget: ONE_BUDGET,
      kinds,
      passed,
      bounded,
      cold: tenths(cold.ms),
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
    // repeat, every one read, ten of them with no instant.
    expect(items.length).toBe(SCHEDULES);
    expect(report.expressions).toBe(898);
    expect(Object.keys(kinds).sort()).toEqual(["at-every-look", "expected"]);
    expect(kinds["at-every-look"]).toBe(10);
    // Every call answered what the first one did: the computation depends on its arguments alone.
    const first = JSON.stringify(cold.value);

    expect(measured.every((call) => JSON.stringify(call.value) === first)).toBe(true);
    const oneFirst = JSON.stringify(signals([one]));

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
    expect(cold.value.filter((signal) => signal.kind === "expected" && signal.passed > COUNT_BOUND)).toEqual([]);
    expect(signals([one])[0]).toMatchObject({ kind: "expected", due: true, beyond: false });
    // Every call took a time, and both series answer within their budget at the 95th percentile.
    expect(measured.every((call) => call.ms > 0) && oneMeasured.every((call) => call.ms > 0)).toBe(true);
    expect(report.all.p95).toBeLessThan(BUDGET);
    expect(report.one.p95).toBeLessThan(ONE_BUDGET);
  });
});
