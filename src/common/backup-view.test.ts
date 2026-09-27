import { describe, expect, it } from "vitest";
import {
  backupView,
  countsSentence,
  countsText,
  durationText,
  lifecycleText,
  phaseText,
  progressText,
  SORTING,
  searchFields,
  signalText,
} from "./backup-view";
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
    expect(countsSentence(backupView(backup({ phase: "Failed", errors: 3 }), now).evidence)).toBe(
      "3 errors and no number of warnings",
    );
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
    expect(durationText(view.duration)).toBe("Not started");
    expect(view.storage).toBeUndefined();
    expect(view.schedule).toBeUndefined();
    expect(JSON.stringify(view)).not.toMatch(/NaN|Infinity/);
  });

  it("tells a completed backup without a count of errors from one that counted none", () => {
    expect(signalText(backupView(backup({ phase: "Completed" }), now).evidence)).toBe("No failure reported");
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
    [{ totalItems: 10 }, "Not reported / 10"],
    [{ itemsBackedUp: 0, totalItems: 0 }, "No items counted"],
    [{ itemsBackedUp: 11, totalItems: 10 }, "Reported 11 / 10"],
    [{ itemsBackedUp: -1, totalItems: 10 }, "Reported -1 / 10"],
    [null, "Not reported"],
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
