import { describe, expect, it } from "vitest";
import { MARK_GAP, MARK_NAMED, markCount, markWords, operationLine, shownWords } from "./operation-line";

import type { Drawn } from "./operation-line";

const NOW = Date.parse("2026-09-28T12:00:00Z");
const HOUR = 3_600_000;

function operation(name: string, ago: number): Drawn {
  return {
    view: {
      name,
      // What the line reads of an operation: whether it is in flight, whether it started, its failure.
      state: { lifecycle: "terminal", execution: "started" } as unknown as Drawn["view"]["state"],
      evidence: { signal: "none" } as unknown as Drawn["view"]["evidence"],
    },
    time: { of: "start", time: NOW - ago },
  };
}

describe("mark of many operations", () => {
  const waiting = (name: string, ago: number): Drawn => ({
    view: {
      name,
      state: { lifecycle: "in-flight", execution: "not-started" } as unknown as Drawn["view"]["state"],
      evidence: { signal: "failure" } as unknown as Drawn["view"]["evidence"],
    },
    time: { of: "creation", time: NOW - ago },
  });

  it("says that one of them did not start, carries a failure or is in flight, when one does", () => {
    const line = operationLine(
      [operation("done-1", 3 * HOUR), operation("done-2", 3 * HOUR - 1000), operation("alone", HOUR)],
      NOW,
      600,
      { from: NOW - 24 * HOUR },
    );
    const mixed = operationLine(
      [operation("done-1", 3 * HOUR), waiting("waits", 3 * HOUR - 1000), operation("alone", HOUR)],
      NOW,
      600,
      { from: NOW - 24 * HOUR },
    );
    const facts = (found: typeof line) =>
      found?.marks.map(({ items, failing, inFlight, notStarted }) => [
        items.map((item) => item.view.name),
        failing,
        inFlight,
        notStarted,
      ]);

    expect(facts(line)).toEqual([
      [["done-2", "done-1"], false, false, false],
      [["alone"], false, false, false],
    ]);
    // The one that waits is the second of its mark: what it is is said of the mark.
    expect(facts(mixed)).toEqual([
      [["waits", "done-1"], true, true, true],
      [["alone"], false, false, false],
    ]);
  });

  it("names the newest of them in its words, and says how many more there are", () => {
    const items = Array.from({ length: 12 }, (_, index) => operation(`backup-${index}`, HOUR + index * 1000));
    const line = operationLine(items, NOW, 600, { from: NOW - 24 * HOUR });
    const say = (item: Drawn) => item.view.name;

    if (!line) throw new Error("The line is drawn");
    expect(MARK_NAMED).toBe(5);
    expect(line.marks).toHaveLength(1);
    expect(markWords(line.marks[0], "backup", say)).toBe(
      "12 backups close to each other. backup-0. backup-1. backup-2. backup-3. backup-4. and 7 more",
    );
    expect(markWords({ ...line.marks[0], failing: true, items: items.slice(0, 5) }, "restore", say)).toBe(
      "5 restores close to each other. one of them at least with a failure. backup-0. backup-1. backup-2. backup-3. backup-4",
    );
    expect(markWords({ ...line.marks[0], items: items.slice(0, 1) }, "backup", say)).toBe("backup-0");
  });
});

describe("mark that was chosen", () => {
  it("says how many of what it holds are shown: many, one, and none when they are gone", () => {
    expect([1200, 2].map((count) => shownWords(count, "operation"))).toEqual([
      "The 1200 operations of one mark are shown.",
      "The 2 operations of one mark are shown.",
    ]);
    expect(shownWords(1, "backup")).toBe("One backup of one mark is shown.");
    expect(shownWords(0, "backup")).toBe("No backup of the mark that was chosen is among the ones that exist now.");
    // Where the list goes back to a time, what is not shown may exist and be older than that.
    expect(shownWords(0, "operation", "the ones of the last 7 days that exist now")).toBe(
      "No operation of the mark that was chosen is among the ones of the last 7 days that exist now.",
    );
    expect(shownWords(1, "operation", "the ones of the last 7 days that exist now")).toBe(
      "One operation of one mark is shown.",
    );
  });
});

describe("number of a mark", () => {
  it("is the number of the operations up to a thousand, and their thousands from there on", () => {
    expect([1, 2, 9, 10, 24, 99, 100, 870, 999].map(markCount)).toEqual([
      "1",
      "2",
      "9",
      "10",
      "24",
      "99",
      "100",
      "870",
      "999",
    ]);
    expect([1000, 1870, 9999, 10_000, 36_000, 99_999].map(markCount)).toEqual(["1k", "1k", "9k", "10k", "36k", "99k"]);
  });

  it("is never longer than the room of a mark, which is three characters", () => {
    for (const count of [0, 1, 12, 123, 1234, 12_345, 123_456, 1_234_567, 2.5]) {
      expect([count, markCount(count).length <= 3]).toEqual([count, true]);
    }
    expect(markCount(123_456)).toBe("99k");
    expect(markCount(2.5)).toBe("2");
  });

  it("is of marks that are a gap from each other at least, however many operations each one holds", () => {
    // Two thousand operations in a day: the marks hold hundreds each, and none is nearer than the gap.
    const items = Array.from({ length: 2000 }, (_, index) => operation(`backup-${index}`, (index * 24 * HOUR) / 2000));
    const line = operationLine(items, NOW, 600, { from: NOW - 24 * HOUR });

    if (!line) throw new Error("The line is drawn");
    expect(line.marks.reduce((held, mark) => held + mark.items.length, 0)).toBe(2000);
    expect(Math.max(...line.marks.map((mark) => mark.items.length))).toBeGreaterThanOrEqual(90);
    line.marks.forEach((mark, index) => {
      const before = line.marks[index - 1];

      if (before) expect((mark.at - before.at) * 600).toBeGreaterThanOrEqual(MARK_GAP);
    });
  });
});
