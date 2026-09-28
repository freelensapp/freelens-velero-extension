import { describe, expect, it } from "vitest";
import {
  BACKUP_PHASES as FIXTURE_BACKUP_PHASES,
  RESTORE_PHASES as FIXTURE_RESTORE_PHASES,
} from "../../e2e/scripts/local-fixtures.mts";
import { formatDuration, operationDuration, timestamp } from "./duration";
import { count, operationEvidence } from "./evidence";
import { BACKUP_PHASES, isInFlight, isTerminal, operationPhases, operationState, RESTORE_PHASES } from "./phases";
import { itemProgress } from "./progress";

import type { Execution, Lifecycle, OperationKind, PhaseFailure } from "./phases";

// What the host hands over is plain data that the extension does not own: no helper may change it.
function frozen<Value>(value: Value): Value {
  if (value && typeof value === "object") {
    for (const inner of Object.values(value)) frozen(inner);
    Object.freeze(value);
  }
  return value;
}

const EXPECTED: Record<string, [Lifecycle, PhaseFailure, Execution, boolean]> = {
  New: ["in-flight", "none", "not-started", false],
  Queued: ["in-flight", "none", "not-started", false],
  ReadyToStart: ["in-flight", "none", "not-started", false],
  InProgress: ["in-flight", "none", "running", false],
  WaitingForPluginOperations: ["in-flight", "none", "ran", true],
  WaitingForPluginOperationsPartiallyFailed: ["in-flight", "partial", "ran", true],
  Finalizing: ["in-flight", "none", "ran", true],
  FinalizingPartiallyFailed: ["in-flight", "partial", "ran", true],
  Completed: ["terminal", "none", "ran", true],
  PartiallyFailed: ["terminal", "partial", "ran", true],
  // The release can fail an operation before it counts: on its restart, or before the work begins.
  Failed: ["terminal", "failed", "ran", false],
  FailedValidation: ["terminal", "validation", "not-started", false],
  Deleting: ["deleting", "unknown", "unknown", false],
};

describe("phases on two axes", () => {
  it("knows the phases of the reviewed release, the ones the fixtures force on the cluster", () => {
    expect(BACKUP_PHASES).toHaveLength(13);
    expect(RESTORE_PHASES).toHaveLength(10);
    expect([...BACKUP_PHASES].sort()).toEqual([...FIXTURE_BACKUP_PHASES].sort());
    expect([...RESTORE_PHASES].sort()).toEqual([...FIXTURE_RESTORE_PHASES].sort());
    expect(new Set(BACKUP_PHASES).size).toBe(13);
    expect(new Set(RESTORE_PHASES).size).toBe(10);
    expect(Object.keys(EXPECTED).sort()).toEqual([...BACKUP_PHASES].sort());
  });

  it.each(
    (["Backup", "Restore"] as const).flatMap((kind) => operationPhases(kind).map((phase) => [kind, phase] as const)),
  )("reads %s %s as the contract says", (kind, phase) => {
    const state = operationState(kind, phase);
    const [lifecycle, failure, execution, counted] = EXPECTED[phase];

    expect(state).toMatchObject({ reported: phase, recognized: true, lifecycle, failure, execution, counted });
    expect(state.label).not.toBe("");
    expect(isInFlight(state)).toBe(lifecycle === "in-flight");
    expect(isTerminal(state)).toBe(lifecycle === "terminal");
  });

  it("says that the work did not begin only of what waits and of what failed its validation", () => {
    for (const kind of ["Backup", "Restore"] as const) {
      const phases = operationPhases(kind);
      const of = (execution: Execution) =>
        phases.filter((phase) => operationState(kind, phase).execution === execution).sort();

      expect(of("not-started")).toEqual(
        ["FailedValidation", "New", "Queued", "ReadyToStart"].filter((phase) => phases.includes(phase as never)),
      );
      expect(of("running")).toEqual(["InProgress"]);
      // What the release counted is every phase it gives after the work but the failed one.
      expect(phases.filter((phase) => operationState(kind, phase).counted).sort()).toEqual(
        of("ran").filter((phase) => phase !== "Failed"),
      );
      expect(of("ran")).toContain("Failed");
    }
  });

  it("finishes only with the four phases the release treats as finished", () => {
    for (const kind of ["Backup", "Restore"] as const) {
      expect(
        operationPhases(kind)
          .filter((phase) => isTerminal(operationState(kind, phase)))
          .sort(),
      ).toEqual(["Completed", "Failed", "FailedValidation", "PartiallyFailed"]);
    }
  });

  it("keeps a partially failed operation in flight while it waits or finalizes", () => {
    for (const kind of ["Backup", "Restore"] as const) {
      for (const phase of ["WaitingForPluginOperationsPartiallyFailed", "FinalizingPartiallyFailed"]) {
        const state = operationState(kind, phase);

        expect(state.lifecycle).toBe("in-flight");
        expect(state.failure).toBe("partial");
        expect(isTerminal(state)).toBe(false);
      }
    }
  });

  it("does not read a deletion as a completion, nor guess what the backup was before it", () => {
    const state = operationState("Backup", "Deleting");

    expect(state.lifecycle).toBe("deleting");
    expect(state.failure).toBe("unknown");
    expect(isTerminal(state)).toBe(false);
    expect(isInFlight(state)).toBe(false);
  });

  it.each([
    ["Backup", "Paused"],
    ["Backup", "completed"],
    ["Backup", " Completed"],
    ["Restore", "Queued"],
    ["Restore", "ReadyToStart"],
    ["Restore", "Deleting"],
    ["Restore", "Archived"],
  ] as const)("keeps the text of %s %s and calls it unknown", (kind, phase) => {
    expect(operationState(kind, phase)).toEqual({
      reported: phase,
      recognized: false,
      lifecycle: "unknown",
      failure: "unknown",
      execution: "unknown",
      counted: false,
      label: "Unknown",
    });
  });

  it.each([undefined, null, "", 0, 7, true, {}, ["Completed"]])("reads a phase of %j as not reported", (phase) => {
    for (const kind of ["Backup", "Restore"] as const) {
      const state = operationState(kind, phase);

      expect(state).toEqual({
        recognized: false,
        lifecycle: "unknown",
        failure: "unknown",
        execution: "unknown",
        counted: false,
        label: "Not reported",
      });
      expect("reported" in state).toBe(false);
    }
  });
});

describe("evidence of a failure", () => {
  const state = (kind: OperationKind, phase: unknown) => operationState(kind, phase);

  it("tells a counter that is missing from one that is zero, before the release counted", () => {
    expect(count(0)).toEqual({ reported: true, value: 0, written: true });
    expect(count(3)).toEqual({ reported: true, value: 3, written: true });
    expect(count(undefined)).toEqual({ reported: false });
    expect(count(null)).toEqual({ reported: false });
    for (const raw of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, "3", true, {}]) {
      expect(count(raw)).toEqual({ reported: false, raw });
    }
  });

  it("reads a counter that is missing after the release counted as the zero it does not write", () => {
    expect(count(undefined, true)).toEqual({ reported: true, value: 0, written: false });
    expect(count(null, true)).toEqual({ reported: true, value: 0, written: false });
    expect(count(0, true)).toEqual({ reported: true, value: 0, written: true });
    expect(count(3, true)).toEqual({ reported: true, value: 3, written: true });
    // What is not a count is not made one by where the operation is.
    for (const raw of [-1, 1.5, "3", true, {}]) expect(count(raw, true)).toEqual({ reported: false, raw });
  });

  it("reads a completed backup without errors as one without a failure signal", () => {
    const evidence = operationEvidence(state("Backup", "Completed"), frozen({ errors: 0, warnings: 0 }));

    expect(evidence).toEqual({
      errors: { reported: true, value: 0, written: true },
      warnings: { reported: true, value: 0, written: true },
      validationErrors: [],
      failureReason: undefined,
      contradictions: [],
      gaps: [],
      signal: "none",
    });
  });

  // The object of an operation that ended without an error, as the release leaves it: no counter at all.
  it.each([
    ["Backup", "Completed"],
    ["Restore", "Completed"],
    ["Backup", "WaitingForPluginOperations"],
    ["Backup", "Finalizing"],
    ["Restore", "Finalizing"],
  ] as const)("reads the %s %s the release leaves without counters as one that counted none", (kind, phase) => {
    for (const status of [frozen({}), undefined, null]) {
      const evidence = operationEvidence(state(kind, phase), status);

      expect(evidence.errors).toEqual({ reported: true, value: 0, written: false });
      expect(evidence.warnings).toEqual({ reported: true, value: 0, written: false });
      expect(evidence.gaps).toEqual([]);
      expect(evidence.contradictions).toEqual([]);
      expect(evidence.signal).toBe("none");
    }
  });

  it("reads the warnings the release wrote beside the errors it did not", () => {
    const evidence = operationEvidence(state("Restore", "Completed"), frozen({ warnings: 3 }));

    expect(evidence.errors).toEqual({ reported: true, value: 0, written: false });
    expect(evidence.warnings).toEqual({ reported: true, value: 3, written: true });
    expect(evidence.signal).toBe("warnings");
  });

  it.each([
    ["Backup", "New"],
    ["Backup", "Queued"],
    ["Backup", "ReadyToStart"],
    ["Backup", "FailedValidation"],
    ["Restore", "New"],
    ["Restore", "FailedValidation"],
    ["Backup", "InProgress"],
    ["Restore", "InProgress"],
    ["Backup", "Failed"],
    ["Restore", "Failed"],
    ["Backup", "Deleting"],
    ["Backup", "Archived"],
    ["Restore", undefined],
  ] as const)("counts nothing for a %s in the phase %s that reports no counter", (kind, phase) => {
    const evidence = operationEvidence(state(kind, phase), frozen({}));

    expect(evidence.errors).toEqual({ reported: false });
    expect(evidence.warnings).toEqual({ reported: false });
    expect(evidence.gaps.filter((gap) => gap.includes("number of"))).toEqual([]);
  });

  it("shows the errors a completed backup reports, against its phase", () => {
    const evidence = operationEvidence(
      state("Backup", "Completed"),
      frozen({ errors: 2, warnings: 0, validationErrors: ["a synthetic rule"], failureReason: "a synthetic reason" }),
    );

    expect(evidence.signal).toBe("failure");
    expect(evidence.errors).toEqual({ reported: true, value: 2, written: true });
    expect(evidence.validationErrors).toEqual(["a synthetic rule"]);
    expect(evidence.failureReason).toBe("a synthetic reason");
    expect(evidence.contradictions).toHaveLength(3);
  });

  it("does not make a failure, nor a success, of warnings alone", () => {
    const completed = operationEvidence(state("Backup", "Completed"), frozen({ errors: 0, warnings: 4 }));
    const running = operationEvidence(state("Restore", "InProgress"), frozen({ warnings: 4 }));

    expect(completed.signal).toBe("warnings");
    expect(completed.contradictions).toEqual([]);
    expect(running.signal).toBe("warnings");
    // The two counters are written together: with the warnings in the object, the errors were counted.
    expect(running.errors).toEqual({ reported: true, value: 0, written: false });
  });

  it("reads the counter that is missing beside the one that is written as counted, whatever the phase", () => {
    // A backup the release failed after it counted: its errors are written, its warnings were none.
    const failed = operationEvidence(state("Backup", "Failed"), frozen({ errors: 2 }));

    expect(failed.errors).toEqual({ reported: true, value: 2, written: true });
    expect(failed.warnings).toEqual({ reported: true, value: 0, written: false });
    expect(failed.gaps).toEqual([]);
    // One it failed before it counted: neither is there, and neither is a zero.
    const stopped = operationEvidence(state("Backup", "Failed"), frozen({ failureReason: "a synthetic reason" }));

    expect(stopped.errors).toEqual({ reported: false });
    expect(stopped.warnings).toEqual({ reported: false });
    // A counter that is not a count does not say that the other was counted.
    const broken = operationEvidence(state("Backup", "Failed"), frozen({ errors: "many" }));

    expect(broken.errors).toEqual({ reported: false, raw: "many" });
    expect(broken.warnings).toEqual({ reported: false });
  });

  it("names a counter that is not a count, wherever the operation is, without calling it zero", () => {
    for (const phase of ["Completed", "InProgress", "New", "Archived"]) {
      const evidence = operationEvidence(state("Backup", phase), frozen({ errors: "many", warnings: -3 }));

      expect(evidence.errors).toEqual({ reported: false, raw: "many" });
      expect(evidence.warnings).toEqual({ reported: false, raw: -3 });
      expect(evidence.gaps).toEqual(["The number of errors is not a count", "The number of warnings is not a count"]);
    }
  });

  it("tells a failed validation from a failed execution, and says when either gives no reason", () => {
    const validation = operationEvidence(
      state("Backup", "FailedValidation"),
      frozen({ validationErrors: ["a synthetic rule", "", 7, null] }),
    );
    const silent = operationEvidence(state("Backup", "FailedValidation"), frozen({ validationErrors: null }));
    const failed = operationEvidence(state("Restore", "Failed"), frozen({ errors: 0, warnings: 0 }));

    expect(validation.validationErrors).toEqual(["a synthetic rule"]);
    expect(validation.signal).toBe("failure");
    expect(validation.gaps).not.toContain(
      "The phase is a failed validation and the object reports no validation error",
    );
    expect(silent.signal).toBe("failure");
    expect(silent.gaps).toContain("The phase is a failed validation and the object reports no validation error");
    expect(failed.signal).toBe("failure");
    expect(failed.gaps).toEqual(["The phase carries a failure and the object reports neither errors nor a reason"]);
    // The same of an operation the release failed before it counted, which carries no counter.
    expect(operationEvidence(state("Restore", "Failed"), frozen({})).gaps).toEqual(failed.gaps);
    expect(operationEvidence(state("Restore", "Failed"), frozen({ failureReason: "a synthetic reason" })).gaps).toEqual(
      [],
    );
  });

  it.each(["WaitingForPluginOperationsPartiallyFailed", "FinalizingPartiallyFailed", "PartiallyFailed", "Failed"])(
    "carries the failure of %s whatever its counters say",
    (phase) => {
      expect(operationEvidence(state("Backup", phase), frozen({ errors: 0, warnings: 0 })).signal).toBe("failure");
      expect(operationEvidence(state("Backup", phase), frozen({})).signal).toBe("failure");
    },
  );

  it("says nothing of an operation whose phase it does not know, unless the object reports errors", () => {
    expect(operationEvidence(state("Backup", "Archived"), frozen({ errors: 0, warnings: 0 })).signal).toBe("unknown");
    expect(operationEvidence(state("Backup", undefined), frozen({})).signal).toBe("unknown");
    expect(operationEvidence(state("Backup", "Deleting"), frozen({ errors: 0 })).signal).toBe("unknown");
    expect(operationEvidence(state("Backup", "Archived"), frozen({ errors: 1 })).signal).toBe("failure");
    expect(operationEvidence(state("Backup", "Deleting"), frozen({ errors: 1 })).signal).toBe("failure");
  });

  it("does not count as errors a counter that is not a count", () => {
    const evidence = operationEvidence(state("Backup", "InProgress"), frozen({ errors: "many", warnings: -3 }));

    expect(evidence.errors).toEqual({ reported: false, raw: "many" });
    expect(evidence.warnings).toEqual({ reported: false, raw: -3 });
    expect(evidence.signal).toBe("none");
  });
});

describe("item progress", () => {
  it("measures the ratio of valid counts and keeps what was reported", () => {
    expect(itemProgress("Backup", frozen({ itemsBackedUp: 4, totalItems: 10 }))).toEqual({
      reported: { done: 4, total: 10 },
      done: 4,
      total: 10,
      percentage: 40,
      state: "measured",
    });
    expect(itemProgress("Restore", frozen({ itemsRestored: 1, totalItems: 3 })).percentage).toBe(33);
    expect(itemProgress("Restore", frozen({ itemsRestored: 0, totalItems: 3 })).percentage).toBe(0);
    expect(itemProgress("Backup", frozen({ itemsBackedUp: 999, totalItems: 1000 })).percentage).toBe(99);
  });

  it("reads the counter of its own kind and not the one of the other", () => {
    expect(itemProgress("Backup", frozen({ itemsRestored: 4, totalItems: 10 }))).toEqual({
      reported: { done: undefined, total: 10 },
      done: 0,
      total: 10,
      percentage: 0,
      state: "measured",
    });
    expect(itemProgress("Restore", frozen({ itemsBackedUp: 4, totalItems: 10 })).done).toBe(0);
  });

  it("reads a count that is missing from a progress that is there as the zero the release does not write", () => {
    // The release writes the total before the first item is done, and no count of zero.
    expect(itemProgress("Restore", frozen({ totalItems: 10 }))).toEqual({
      reported: { done: undefined, total: 10 },
      done: 0,
      total: 10,
      percentage: 0,
      state: "measured",
    });
    expect(itemProgress("Backup", frozen({}))).toEqual({
      reported: { done: undefined, total: undefined },
      done: 0,
      total: 0,
      state: "indeterminate",
      reason: "no-total",
    });
    // A progress that is not there is not one of zero items.
    for (const progress of [undefined, null]) {
      expect(itemProgress("Backup", progress)).toEqual({
        reported: { done: undefined, total: undefined },
        state: "indeterminate",
        reason: "not-reported",
      });
    }
  });

  it("says nothing of the operation when all the items are done", () => {
    const progress = itemProgress("Backup", frozen({ itemsBackedUp: 240, totalItems: 240 }));
    const finalizing = operationState("Backup", "FinalizingPartiallyFailed");

    expect(progress.percentage).toBe(100);
    expect(Object.keys(progress).sort()).toEqual(["done", "percentage", "reported", "state", "total"]);
    expect(finalizing.lifecycle).toBe("in-flight");
  });

  it.each([
    [undefined, "not-reported"],
    [null, "not-reported"],
    ["a text", "not-reported"],
    [{}, "no-total"],
    [{ itemsBackedUp: null, totalItems: null }, "no-total"],
    [{ itemsBackedUp: 4 }, "over-total"],
    [{ itemsBackedUp: 0, totalItems: 0 }, "no-total"],
    [{ totalItems: 0 }, "no-total"],
    [{ itemsBackedUp: 4, totalItems: 0 }, "over-total"],
    [{ itemsBackedUp: -1, totalItems: 10 }, "invalid"],
    [{ itemsBackedUp: 4, totalItems: -10 }, "invalid"],
    [{ itemsBackedUp: 1.5, totalItems: 10 }, "invalid"],
    [{ itemsBackedUp: "4", totalItems: "10" }, "invalid"],
    [{ itemsBackedUp: Number.NaN, totalItems: 10 }, "invalid"],
    [{ itemsBackedUp: 4, totalItems: Number.POSITIVE_INFINITY }, "invalid"],
    [{ itemsBackedUp: 11, totalItems: 10 }, "over-total"],
  ] as const)("gives no percentage for %j: %s", (progress, reason) => {
    const result = itemProgress("Backup", frozen(progress as never));

    expect(result.state).toBe("indeterminate");
    expect(result.reason).toBe(reason);
    expect("percentage" in result).toBe(false);
    expect(JSON.stringify(result)).not.toMatch(/NaN|Infinity/);
  });

  it("keeps the values of an invalid report as they were reported", () => {
    expect(itemProgress("Backup", frozen({ itemsBackedUp: 11, totalItems: 10 })).reported).toEqual({
      done: 11,
      total: 10,
    });
    expect(itemProgress("Backup", frozen({ itemsBackedUp: "4", totalItems: 10 } as never)).reported).toEqual({
      done: "4",
      total: 10,
    });
  });
});

describe("duration with a clock that the caller sets", () => {
  const now = Date.parse("2026-09-01T10:30:00Z");
  const inFlight = operationState("Backup", "InProgress");
  const completed = operationState("Backup", "Completed");

  it("reads the timestamps of the API and nothing that only looks like one", () => {
    expect(timestamp("2026-09-01T10:00:00Z")).toBe(Date.parse("2026-09-01T10:00:00Z"));
    expect(timestamp("2026-09-01T10:00:00.250Z")).toBe(Date.parse("2026-09-01T10:00:00.250Z"));
    expect(timestamp("2026-09-01T12:00:00+02:00")).toBe(Date.parse("2026-09-01T10:00:00Z"));
    for (const value of ["", "yesterday", "2026-09-01", "2026-13-41T10:00:00Z", "1756720800", 1756720800, null, {}]) {
      expect(timestamp(value)).toBeUndefined();
    }
  });

  it("counts the time of an operation in flight from its start to now", () => {
    expect(operationDuration(inFlight, frozen({ startTimestamp: "2026-09-01T10:00:00Z" }), now)).toEqual({
      state: "running",
      milliseconds: 30 * 60 * 1000,
      start: Date.parse("2026-09-01T10:00:00Z"),
    });
    expect(
      operationDuration(inFlight, frozen({ startTimestamp: "2026-09-01T10:00:00Z", completionTimestamp: null }), now)
        .state,
    ).toBe("running");
  });

  it("gives a finished operation the time between its start and its end, whatever the clock says", () => {
    const status = frozen({ startTimestamp: "2026-09-01T10:00:00Z", completionTimestamp: "2026-09-01T10:01:00Z" });

    for (const clock of [now, now + 86_400_000, 0]) {
      expect(operationDuration(completed, status, clock)).toEqual({
        state: "finished",
        milliseconds: 60_000,
        start: Date.parse("2026-09-01T10:00:00Z"),
        end: Date.parse("2026-09-01T10:01:00Z"),
      });
    }
  });

  it("does not start a timer for an operation that finished without saying when", () => {
    for (const phase of ["Completed", "PartiallyFailed", "Failed", "FailedValidation"]) {
      expect(
        operationDuration(operationState("Backup", phase), frozen({ startTimestamp: "2026-09-01T10:00:00Z" }), now),
      ).toEqual({ state: "unavailable", reason: "no-end" });
    }
    for (const phase of ["Deleting", "Archived", undefined]) {
      expect(
        operationDuration(operationState("Backup", phase), frozen({ startTimestamp: "2026-09-01T10:00:00Z" }), now),
      ).toEqual({ state: "unavailable", reason: "no-end" });
    }
  });

  it.each([
    [{}, "no-start"],
    [{ startTimestamp: null }, "no-start"],
    [{ completionTimestamp: "2026-09-01T10:01:00Z" }, "no-start"],
    [{ startTimestamp: "soon" }, "invalid-start"],
    [{ startTimestamp: 1756720800 }, "invalid-start"],
    [{ startTimestamp: "2026-09-01T10:00:00Z", completionTimestamp: "later" }, "invalid-end"],
    [{ startTimestamp: "2026-09-01T10:01:00Z", completionTimestamp: "2026-09-01T10:00:00Z" }, "reversed"],
    [{ startTimestamp: "2026-09-01T11:00:00Z" }, "future-start"],
  ] as const)("has no duration for %j: %s", (status, reason) => {
    expect(operationDuration(inFlight, frozen(status as never), now)).toEqual({ state: "unavailable", reason });
  });

  it("has no duration without a status", () => {
    expect(operationDuration(inFlight, undefined, now)).toEqual({ state: "unavailable", reason: "no-start" });
    expect(operationDuration(completed, null, now)).toEqual({ state: "unavailable", reason: "no-start" });
  });

  it("says that an operation did not start only when its phase says so", () => {
    const reason = (kind: OperationKind, phase: unknown) => {
      const duration = operationDuration(operationState(kind, phase), frozen({}), now);

      return duration.state === "unavailable" ? duration.reason : duration.state;
    };

    for (const phase of ["New", "Queued", "ReadyToStart", "FailedValidation"]) {
      expect(reason("Backup", phase)).toBe("not-started");
    }
    expect(reason("Restore", "New")).toBe("not-started");
    expect(reason("Restore", "FailedValidation")).toBe("not-started");
    // Where the phase says that the work began, or says nothing, a start that is missing is not reported.
    for (const phase of ["InProgress", "Finalizing", "Completed", "Failed", "Deleting", "Archived", undefined]) {
      expect(reason("Backup", phase)).toBe("no-start");
    }
    // A phase of a backup that a restore does not have is not known of a restore.
    expect(reason("Restore", "Queued")).toBe("no-start");
    // A start that is there and is not a time is said so, whatever the phase.
    expect(operationDuration(operationState("Backup", "New"), frozen({ startTimestamp: "soon" }), now)).toEqual({
      state: "unavailable",
      reason: "invalid-start",
    });
  });

  it("takes an operation in flight that reports its end as finished in time, not in phase", () => {
    const duration = operationDuration(
      operationState("Backup", "Finalizing"),
      frozen({ startTimestamp: "2026-09-01T10:00:00Z", completionTimestamp: "2026-09-01T10:01:00Z" }),
      now,
    );

    expect(duration.state).toBe("finished");
    expect(operationState("Backup", "Finalizing").lifecycle).toBe("in-flight");
  });

  it.each([
    [0, "0s"],
    [999, "0s"],
    [1000, "1s"],
    [59_000, "59s"],
    [60_000, "1m"],
    [61_000, "1m 1s"],
    [3_600_000, "1h"],
    [3_661_000, "1h 1m"],
    [86_400_000, "1d"],
    [90_061_000, "1d 1h"],
    [3 * 86_400_000 + 59_000, "3d"],
  ])("writes %d milliseconds as %s", (milliseconds, text) => {
    expect(formatDuration(milliseconds)).toBe(text);
  });
});
