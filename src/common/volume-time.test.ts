import { afterEach, describe, expect, it, vi } from "vitest";
import { before, MINUTE, NOW, podVolumeBackup } from "../../test/volume-builders";
import { newestFirst } from "./operation-time";
import { volumeOperationState } from "./volume-phases";
import { spanValue, volumeTimes } from "./volume-time";
import { spanNote, spanText } from "./volume-words";

import type { VolumeKind } from "./volume-phases";

afterEach(() => {
  vi.useRealTimers();
});

function times(kind: VolumeKind, phase: string | undefined, status: object, now = NOW) {
  const state = volumeOperationState(kind, phase);
  const found = volumeTimes(state, status, now);

  return { ...found, text: spanText(found.span), note: spanNote(state, found.span), value: spanValue(found.span) };
}

describe("the times of an operation, by the clock of the caller", () => {
  it("are none but its creation for one New or with no phase", () => {
    for (const phase of [undefined, "New"]) {
      expect(times("PodVolumeBackup", phase, {})).toEqual({
        span: { state: "not-started" },
        text: "Not started",
        note: "It has no time but its creation.",
        value: -1,
      });
    }
  });

  it("are the waiting from the acceptance for one Accepted or Prepared, with what each waits for", () => {
    const accepted = times("PodVolumeBackup", "Accepted", { acceptedTimestamp: before(3 * MINUTE) });

    expect(accepted).toMatchObject({
      accepted: NOW - 3 * MINUTE,
      span: { state: "waiting", milliseconds: 3 * MINUTE, since: NOW - 3 * MINUTE },
      text: "Waiting 3m",
      value: 3 * MINUTE,
    });
    expect(accepted.note).toContain("preparing timeout, which the view does not read");
    const prepared = times("PodVolumeRestore", "Prepared", { acceptedTimestamp: before(90_000) });

    expect(prepared).toMatchObject({ span: { state: "waiting", milliseconds: 90_000 }, text: "Waiting 1m 30s" });
    expect(prepared.note).toContain("about to start the data path");
    expect(times("PodVolumeBackup", "Accepted", {})).toMatchObject({
      span: { state: "unavailable", reason: "no-accepted" },
      text: "Accepted time not reported",
      value: -1,
    });
  });

  it("are the elapsed time from the start for one InProgress or Canceling", () => {
    for (const phase of ["InProgress", "Canceling"]) {
      expect(
        times("PodVolumeBackup", phase, {
          acceptedTimestamp: before(12 * MINUTE),
          startTimestamp: before(10 * MINUTE),
        }),
      ).toMatchObject({
        accepted: NOW - 12 * MINUTE,
        started: NOW - 10 * MINUTE,
        span: { state: "elapsed", milliseconds: 10 * MINUTE },
        text: "10m so far",
      });
    }
    expect(times("PodVolumeBackup", "InProgress", {})).toMatchObject({
      span: { state: "unavailable", reason: "no-start" },
      text: "Start not reported",
    });
    expect(times("PodVolumeBackup", "InProgress", { startTimestamp: before(-MINUTE) })).toMatchObject({
      span: { state: "unavailable", reason: "future" },
    });
  });

  it("are the duration of one that ended, from its start to its completion", () => {
    expect(
      times("PodVolumeBackup", "Completed", {
        acceptedTimestamp: before(20 * MINUTE),
        startTimestamp: before(18 * MINUTE),
        completionTimestamp: before(14 * MINUTE),
      }),
    ).toMatchObject({
      accepted: NOW - 20 * MINUTE,
      started: NOW - 18 * MINUTE,
      completed: NOW - 14 * MINUTE,
      span: { state: "duration", milliseconds: 4 * MINUTE },
      text: "4m",
      value: 4 * MINUTE,
    });
  });

  it("give no duration of a start equal to the completion, which the failure or the cancellation wrote", () => {
    for (const phase of ["Failed", "Canceled"]) {
      const found = times("PodVolumeBackup", phase, {
        startTimestamp: before(5 * MINUTE),
        completionTimestamp: before(5 * MINUTE),
      });

      expect(found).toMatchObject({
        span: { state: "instant", at: NOW - 5 * MINUTE },
        text: "No duration: the start is the completion",
        value: -1,
      });
      expect(found.note).toContain("not a duration of the work");
    }
  });

  it("say that one ended before its data path began when the release wrote a completion and no start", () => {
    const found = times("PodVolumeRestore", "Failed", { completionTimestamp: before(MINUTE) });

    expect(found).toMatchObject({
      span: { state: "no-start", at: NOW - MINUTE },
      text: "No duration: no start was written",
    });
    expect(found.started).toBeUndefined();
  });

  it("say that the release wrote no time for one that ended with neither, as the preparing timeout fails one", () => {
    const found = times("PodVolumeBackup", "Failed", { acceptedTimestamp: before(40 * MINUTE) });

    expect(found).toMatchObject({ span: { state: "no-time" }, text: "No time written", value: -1 });
    expect(found.note).toBe("The release wrote no time for it, as for one its preparing timeout failed.");
  });

  it("are not read from what is not a time, and are not given backwards", () => {
    expect(
      times("PodVolumeBackup", "Completed", { startTimestamp: "soon", completionTimestamp: before(0) }),
    ).toMatchObject({ span: { state: "unavailable", reason: "unreadable" }, text: "Time not readable" });
    expect(
      times("PodVolumeBackup", "Completed", { startTimestamp: before(0), completionTimestamp: before(MINUTE) }),
    ).toMatchObject({ span: { state: "unavailable", reason: "reversed" }, text: "Completion before start" });
    expect(times("PodVolumeBackup", "Completed", { startTimestamp: before(MINUTE) })).toMatchObject({
      span: { state: "unavailable", reason: "no-end" },
    });
  });

  it("move with the clock, and leave no timer", () => {
    vi.useFakeTimers();
    const status = { startTimestamp: before(MINUTE) };

    expect(times("PodVolumeBackup", "InProgress", status, NOW).text).toBe("1m so far");
    expect(times("PodVolumeBackup", "InProgress", status, NOW + MINUTE).text).toBe("2m so far");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("never give a value that is not a number to order by", () => {
    for (const phase of [
      undefined,
      "New",
      "Accepted",
      "Prepared",
      "InProgress",
      "Canceling",
      "Completed",
      "Failed",
      "Canceled",
      "Odd",
    ]) {
      for (const status of [
        {},
        { startTimestamp: "x" },
        { startTimestamp: before(MINUTE), completionTimestamp: before(0) },
      ]) {
        expect(Number.isNaN(times("PodVolumeBackup", phase, status).value)).toBe(false);
      }
    }
  });
});

describe("the order of the operations", () => {
  it("is by the time of the operation: its start, else its creation, the newest first", () => {
    const operations = [
      podVolumeBackup(
        "started-early",
        { phase: "Completed", startTimestamp: before(60 * MINUTE) },
        { created: before(61 * MINUTE) },
      ),
      podVolumeBackup("new-late", { phase: "New" }, { created: before(MINUTE) }),
      podVolumeBackup(
        "started-late",
        { phase: "InProgress", startTimestamp: before(5 * MINUTE) },
        { created: before(90 * MINUTE) },
      ),
    ];

    expect([...operations].sort(newestFirst).map((operation) => operation.metadata.name)).toEqual([
      "new-late",
      "started-late",
      "started-early",
    ]);
  });
});
