import { describe, expect, it } from "vitest";
import { backupView, SORTING, searchFields } from "./backup-view";
import {
  countsNote,
  countsSentence,
  countsText,
  durationText,
  lifecycleText,
  phaseText,
  progressText,
  signalMark,
  signalText,
  timeText,
} from "./operation-text";
import { BACKUP_PHASES } from "./phases";

import type { BackupResource } from "./types";

const now = Date.parse("2026-09-01T10:30:00Z");

function backup(status: BackupResource["status"], extra: Partial<BackupResource> = {}): BackupResource {
  return {
    metadata: {
      name: "nightly-1",
      namespace: "velero-demo",
      uid: "uid-1",
      creationTimestamp: "2026-09-01T09:59:00Z",
      labels: { "velero.io/schedule-name": "nightly" },
    },
    spec: { storageLocation: "default" },
    status,
    ...extra,
  };
}

describe("what the views show of a backup", () => {
  it("says the counters in words, and the ones that are not reported as not reported", () => {
    expect(countsSentence(backupView(backup({ phase: "Completed", errors: 0, warnings: 2 }), now).evidence)).toBe(
      "0 errors and 2 warnings",
    );
    expect(countsSentence(backupView(backup({ phase: "Failed", errors: 1, warnings: 1 }), now).evidence)).toBe(
      "1 error and 1 warning",
    );
    // The release writes the two counters together, and no zero: the warnings of a backup that failed
    // with its errors counted are none.
    expect(countsSentence(backupView(backup({ phase: "Failed", errors: 3 }), now).evidence)).toBe(
      "3 errors and 0 warnings",
    );
    expect(countsSentence(backupView(backup({ phase: "Failed" }), now).evidence)).toBe(
      "no number of errors and no number of warnings",
    );
    expect(
      countsSentence(backupView(backup({ phase: "Failed", errors: 3, warnings: "many" as never }), now).evidence),
    ).toBe("3 errors and no number of warnings");
  });

  it("reads a backup that is finalizing with all its items as in flight, with its failure", () => {
    const view = backupView(
      backup({
        phase: "FinalizingPartiallyFailed",
        startTimestamp: "2026-09-01T10:00:00Z",
        progress: { itemsBackedUp: 240, totalItems: 240 },
        errors: 2,
        warnings: 0,
      }),
      now,
    );

    expect(phaseText(view.state)).toBe("Finalizing");
    expect(lifecycleText(view.state)).toBe("In flight");
    expect(signalText(view.evidence)).toBe("2 errors");
    expect(progressText(view.progress)).toBe("240 / 240 (100%)");
    expect(durationText(view.duration)).toBe("30m so far");
    expect(view).toMatchObject({ storage: "default", schedule: "nightly", name: "nightly-1" });
  });

  it("shows the validation errors of a backup that never ran, and no log is needed for them", () => {
    const view = backupView(
      backup({ phase: "FailedValidation", validationErrors: ["a synthetic rule", "another one"] }),
      now,
    );

    expect(phaseText(view.state)).toBe("Failed validation");
    expect(lifecycleText(view.state)).toBe("Finished");
    expect(signalText(view.evidence)).toBe("2 validation errors");
    expect(durationText(view.duration)).toBe("Not started");
    expect(progressText(view.progress)).toBe("Not reported");
    expect(searchFields(view)).toContain("a synthetic rule");
  });

  it("has words for every phase of the release, and none of them is empty", () => {
    for (const phase of BACKUP_PHASES) {
      const view = backupView(backup({ phase }), now);

      expect(phaseText(view.state)).not.toBe("");
      expect(lifecycleText(view.state)).not.toBe("");
      expect(signalText(view.evidence)).not.toBe("");
      expect(searchFields(view)).toContain(phase);
    }
  });

  it("keeps the text of a phase it does not know beside the word that says so", () => {
    const view = backupView(backup({ phase: "Archived", errors: 0, warnings: 0 }), now);

    expect(phaseText(view.state)).toBe("Unknown: Archived");
    expect(lifecycleText(view.state)).toBe("Unknown");
    expect(signalText(view.evidence)).toBe("Unknown");
    expect(searchFields(view)).toContain("Archived");
  });

  it("says that nothing is reported where nothing is, without a zero or a dash", () => {
    const view = backupView({ metadata: { name: "empty", namespace: "velero-demo" } }, now);

    expect(phaseText(view.state)).toBe("Not reported");
    expect(countsText(view.evidence)).toBe("Not reported / Not reported");
    expect(progressText(view.progress)).toBe("Not reported");
    // Without a phase nothing says that the backup did not start.
    expect(durationText(view.duration)).toBe("Start not reported");
    expect(view.storage).toBeUndefined();
    expect(view.schedule).toBeUndefined();
    expect(JSON.stringify(view)).not.toMatch(/NaN|Infinity/);
  });

  // The release writes no counter of zero: a backup that completed without an error carries none.
  it("reads the completed backup the release leaves without counters as one without errors", () => {
    const view = backupView(backup({ phase: "Completed" }), now);

    expect(signalText(view.evidence)).toBe("No errors");
    expect(countsText(view.evidence)).toBe("0 / 0");
    expect(countsNote(view.evidence, view.state)).toContain("Velero writes no counter when it counts none");
    expect(signalText(backupView(backup({ phase: "Completed", warnings: 2 }), now).evidence)).toBe("2 warnings");
  });

  it("says why the counters are not there of a backup that did not count", () => {
    const note = (status: BackupResource["status"]) => {
      const view = backupView(backup(status), now);

      return [signalText(view.evidence), countsText(view.evidence), countsNote(view.evidence, view.state)];
    };

    expect(note({ phase: "New" })).toEqual([
      "No failure reported",
      "Not reported / Not reported",
      "Nothing was counted: the operation did not start.",
    ]);
    expect(note({ phase: "InProgress" })).toEqual([
      "No failure reported",
      "Not reported / Not reported",
      "Velero counts when the work of the operation ends.",
    ]);
    expect(note({ phase: "Failed", failureReason: "a synthetic reason" })).toEqual([
      "Failure",
      "Not reported / Not reported",
      "Velero can fail an operation before it counts: a counter that is not in the object is not a count of none.",
    ]);
    expect(note({ phase: "Archived" })).toEqual(["Unknown", "Not reported / Not reported", undefined]);
    // Counters that are written need no word.
    expect(note({ phase: "PartiallyFailed", errors: 2, warnings: 1 })).toEqual(["2 errors", "2 / 1", undefined]);
    expect(note({ phase: "PartiallyFailed", errors: 2 })[2]).toContain("Velero writes no counter");
  });

  it("marks as gone well only an operation that counted its errors and found none", () => {
    const mark = (status: BackupResource["status"]) => signalMark(backupView(backup(status), now).evidence);

    expect(mark({ phase: "Completed", errors: 0, warnings: 0 })).toBe("none");
    expect(mark({ phase: "InProgress", errors: 0 })).toBe("none");
    // An operation that did not start counted nothing: that no failure is reported is not that it went well.
    expect(mark({ phase: "New" })).toBe("not-counted");
    expect(mark({ phase: "Queued" })).toBe("not-counted");
    // Nor did one that is still at work: the release counts when the work ends.
    expect(mark({ phase: "InProgress" })).toBe("not-counted");
    // After it counted, the release writes no counter of zero: no counter is no error.
    expect(mark({ phase: "Completed" })).toBe("none");
    expect(mark({ phase: "Finalizing" })).toBe("none");
    expect(mark({ phase: "WaitingForPluginOperations" })).toBe("none");
    expect(mark({ phase: "Completed", warnings: 3 })).toBe("warnings");
    expect(mark({ phase: "Completed", errors: 0, warnings: 3 })).toBe("warnings");
    expect(mark({ phase: "Failed" })).toBe("failure");
    expect(mark({ phase: "FailedValidation", validationErrors: ["refused"] })).toBe("failure");
    expect(mark(undefined)).toBe("unknown");
    expect(mark({ phase: "Deleting" })).toBe("unknown");
    expect(signalText(backupView(backup({ phase: "Completed", errors: 0, warnings: 0 }), now).evidence)).toBe(
      "No errors",
    );
    expect(signalText(backupView(backup({ phase: "Completed", errors: 0, warnings: 1 }), now).evidence)).toBe(
      "1 warning",
    );
    expect(countsText(backupView(backup({ phase: "Completed", errors: 0, warnings: 3 }), now).evidence)).toBe("0 / 3");
  });

  it.each([
    [{ itemsBackedUp: 4, totalItems: 10 }, "4 / 10 (40%)"],
    // The release writes the total first, and no count of zero.
    [{ totalItems: 10 }, "0 / 10 (0%)"],
    [{ itemsBackedUp: 0, totalItems: 0 }, "No items counted"],
    [{}, "No items counted"],
    [{ itemsBackedUp: 11, totalItems: 10 }, "Reported 11 / 10"],
    [{ itemsBackedUp: 4 }, "Reported 4 / 0"],
    [{ itemsBackedUp: -1, totalItems: 10 }, "Reported -1 / 10"],
    [{ itemsBackedUp: "4" }, "Reported 4 / nothing"],
    [{ itemsBackedUp: 4, totalItems: {} }, "Reported 4 / {}"],
    [null, "Not reported"],
    [undefined, "Not reported"],
  ])("writes the progress %j as %s", (progress, text) => {
    expect(progressText(backupView(backup({ phase: "InProgress", progress: progress as never }), now).progress)).toBe(
      text,
    );
  });

  it.each([
    [
      { phase: "Completed", startTimestamp: "2026-09-01T10:00:00Z", completionTimestamp: "2026-09-01T10:01:30Z" },
      "1m 30s",
    ],
    [{ phase: "Completed", startTimestamp: "2026-09-01T10:00:00Z" }, "End not reported"],
    [{ phase: "InProgress", startTimestamp: "2026-09-01T11:00:00Z" }, "Start in the future"],
    [
      { phase: "Completed", startTimestamp: "2026-09-01T10:01:00Z", completionTimestamp: "2026-09-01T10:00:00Z" },
      "End before start",
    ],
    [{ phase: "InProgress", startTimestamp: "soon" }, "Start not readable"],
  ])("writes the duration of %j as %s", (status, text) => {
    expect(durationText(backupView(backup(status), now).duration)).toBe(text);
  });

  it("writes a time as the host writes its own, in the language and the zone of the operator", () => {
    for (const time of ["2026-09-01T10:00:00Z", "2026-01-31T23:59:59Z", "2026-06-15T00:00:00.500Z"]) {
      expect(timeText(Date.parse(time))).toBe(new Date(time).toLocaleString());
    }
    expect(timeText(undefined)).toBe("Not reported");
    expect(timeText(0)).toBe(new Date(0).toLocaleString());
  });

  it("is searched by what every column shows but the age, which the host writes", () => {
    const view = backupView(
      backup({
        phase: "InProgress",
        startTimestamp: "2026-09-01T10:00:00Z",
        progress: { itemsBackedUp: 4, totalItems: 10 },
      }),
      now,
    );

    for (const text of [
      view.name,
      view.namespace,
      phaseText(view.state),
      signalText(view.evidence),
      progressText(view.progress),
      timeText(view.started),
      durationText(view.duration),
      view.storage ?? "",
    ]) {
      expect(text).not.toBe("");
      expect(searchFields(view)).toContain(text);
    }
  });

  it("does not change the backup it reads", () => {
    const frozen = Object.freeze(
      backup(Object.freeze({ phase: "Completed", progress: Object.freeze({ itemsBackedUp: 1, totalItems: 1 }) })),
    );

    expect(() => backupView(frozen, now)).not.toThrow();
  });
});

describe("order of the list", () => {
  const views = [
    backupView(backup({ phase: "Completed", errors: 0, progress: { itemsBackedUp: 10, totalItems: 10 } }), now),
    backupView(backup({ phase: "InProgress", errors: 3, progress: { itemsBackedUp: 4, totalItems: 10 } }), now),
    backupView(backup({ phase: "New" }), now),
  ];

  it("puts what is not reported after what is, by errors and by progress", () => {
    expect(views.map(SORTING.errors)).toEqual([0, 3, -1]);
    expect(views.map(SORTING.progress)).toEqual([100, 40, -1]);
    expect(views.map(SORTING.duration)).toEqual([-1, -1, -1]);
  });

  it("has an order for every column that names one", () => {
    for (const order of Object.values(SORTING)) {
      for (const view of views) expect(["string", "number"]).toContain(typeof order(view));
    }
  });
});
