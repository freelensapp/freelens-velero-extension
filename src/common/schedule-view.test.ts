import { describe, expect, it } from "vitest";
import { backupScope } from "./backup-scope";
import { newestFirst, operationTime, operationTimeText } from "./operation-time";
import { BACKUP_PHASES } from "./phases";
import { emptyRead, failed, succeeded } from "./read-state";
import { locationWarning, scheduleRestores, templateReferences } from "./references";
import {
  countsText,
  historyCounts,
  historyStrip,
  holdsSubmissions,
  MARK_GAP,
  scheduleHistory,
} from "./schedule-history";
import {
  expression,
  NOTES,
  ownedText,
  pausedText,
  SCHEDULE_PHASES,
  scheduleState,
  scheduleView,
  zoneText,
} from "./schedule-view";
import { LABELS } from "./types";

import type { TemplateReads } from "./references";
import type {
  BackupResource,
  BackupStorageLocationResource,
  RestoreResource,
  ScheduleResource,
  VolumeSnapshotLocationResource,
} from "./types";

const now = Date.parse("2026-09-10T12:00:00Z");
const day = 86_400_000;

function frozen<Value>(value: Value): Value {
  if (value && typeof value === "object") {
    for (const inner of Object.values(value)) frozen(inner);
    Object.freeze(value);
  }
  return value;
}

function schedule(
  spec: ScheduleResource["spec"] = { schedule: "0 3 * * *" },
  status?: ScheduleResource["status"],
  namespace = "velero-demo",
): ScheduleResource {
  return frozen({
    metadata: { name: "nightly", namespace, uid: "schedule-demo", creationTimestamp: "2026-08-01T00:00:00Z" },
    spec,
    ...(status ? { status } : {}),
  });
}

function backup(
  name: string,
  status: BackupResource["status"],
  more: { schedule?: string; namespace?: string; created?: string } = {},
): BackupResource {
  return frozen({
    metadata: {
      name,
      namespace: more.namespace ?? "velero-demo",
      uid: `uid-${name}`,
      creationTimestamp: more.created ?? "2026-09-01T03:00:00Z",
      labels: (more.schedule === "" ? {} : { [LABELS.schedule]: more.schedule ?? "nightly" }) as Record<string, string>,
    },
    spec: { storageLocation: "default" },
    ...(status ? { status } : {}),
  });
}

const started = (date: string, phase = "Completed", more: object = {}) => ({
  phase,
  startTimestamp: `${date}T03:00:00Z`,
  ...(phase === "Completed" || phase === "Failed" || phase === "PartiallyFailed"
    ? { completionTimestamp: `${date}T03:05:00Z` }
    : {}),
  // The release writes no counter of zero: a backup that completed carries none.
  ...(phase === "Completed" || phase === "InProgress" ? {} : { errors: 1 }),
  ...more,
});

describe("state of a schedule", () => {
  it("knows the phases of the reviewed release, and what each says of the expression", () => {
    expect(
      SCHEDULE_PHASES.map((phase) => [phase, scheduleState(phase).validation, scheduleState(phase).label]),
    ).toEqual([
      ["New", "not-validated", "New"],
      ["Enabled", "valid", "Enabled"],
      ["FailedValidation", "invalid", "Failed validation"],
    ]);
  });

  it.each([undefined, null, "", 0, {}, ["Enabled"]])("reads a phase of %j as not reported, not as enabled", (phase) => {
    expect(scheduleState(phase)).toEqual({ recognized: false, validation: "not-validated", label: "Not reported" });
  });

  it.each(["Paused", "Disabled", "Completed", "enabled"])("keeps the text of %s, a phase it does not know", (phase) => {
    expect(scheduleState(phase)).toEqual({
      reported: phase,
      recognized: false,
      validation: "unknown",
      label: `Unknown: ${phase}`,
    });
  });
});

describe("expression of a schedule", () => {
  it.each([
    ["0 3 * * *", { of: "server" }],
    ["@every 6h", { of: "server" }],
    ["@daily", { of: "server" }],
    ["invalid-synthetic-cron", { of: "server" }],
    ["TZ=Europe/Rome 0 3 * * *", { of: "expression", prefix: "TZ", name: "Europe/Rome" }],
    ["CRON_TZ=Asia/Tokyo 30 1 * * 1-5", { of: "expression", prefix: "CRON_TZ", name: "Asia/Tokyo" }],
    ["TZ=UTC @hourly", { of: "expression", prefix: "TZ", name: "UTC" }],
  ])("shows %j as it is written, with the time zone it is read in", (written, zone) => {
    expect(expression(written)).toEqual({ written, zone });
  });

  it.each([undefined, null, "", "   ", 7])("has no expression and no time zone for %j", (written) => {
    expect(expression(written)).toEqual({ zone: { of: "none" } });
  });

  it("does not take a time zone from what only looks like a prefix", () => {
    expect(expression("tz=Europe/Rome 0 3 * * *").zone).toEqual({ of: "server" });
    expect(expression("0 3 * * * TZ=Europe/Rome").zone).toEqual({ of: "server" });
    expect(expression(" TZ=Europe/Rome 0 3 * * *").zone).toEqual({ of: "server" });
  });

  // The release takes for the name what is between the prefix and the first space, and gives it to the
  // library of the time zones of its language: an empty name is UTC, and Local is the zone of the server.
  it("reads the name of a time zone as the release takes it", () => {
    expect(expression("TZ= 0 3 * * *").zone).toEqual({ of: "expression", prefix: "TZ", name: "" });
    expect(zoneText(expression("TZ= 0 3 * * *").zone)).toBe(
      "UTC: the expression names a time zone with no name, which the release reads so",
    );
    expect(zoneText(expression("CRON_TZ=Local 0 3 * * *").zone)).toBe(
      "The one of the Velero server, which the expression names Local and this view does not read",
    );
    // A tab is not what ends the name for the release.
    expect(expression("TZ=Europe/Rome\t0 3 * * *").zone).toEqual({
      of: "expression",
      prefix: "TZ",
      name: "Europe/Rome\t0",
    });
    // A prefix with nothing after it is an expression the release refuses.
    expect(expression("TZ=Europe/Rome").zone).toEqual({ of: "none" });
    expect(zoneText({ of: "none" })).toBe("Not reported");
  });

  it("says whose time zone it is, and never the one of the desktop", () => {
    expect(zoneText({ of: "expression", prefix: "TZ", name: "Europe/Rome" })).toBe(
      "Europe/Rome, named by the expression",
    );
    expect(zoneText({ of: "server" })).toBe("The one of the Velero server, which this view does not read");
    expect(zoneText({ of: "none" })).toBe("Not reported");
    expect(zoneText({ of: "server" })).not.toContain(Intl.DateTimeFormat().resolvedOptions().timeZone);
  });

  it("computes nothing from the expression: a view has no time that no object reports", () => {
    const view = scheduleView(schedule({ schedule: "0 3 * * *" }, { phase: "Enabled" }));

    expect(
      Object.entries(view)
        .filter(([, value]) => value !== undefined)
        .map(([key]) => key)
        .sort(),
    ).toEqual(
      ["created", "expression", "name", "namespace", "notes", "paused", "state", "uid", "validationErrors"].sort(),
    );
    expect(JSON.stringify(view)).not.toMatch(/next|expected|overdue|missed|due/i);
  });
});

describe("what the views show of a schedule", () => {
  it("keeps paused and phase as two facts", () => {
    const enabled = scheduleView(schedule({ schedule: "0 3 * * *", paused: false }, { phase: "Enabled" }));
    const paused = scheduleView(schedule({ schedule: "0 3 * * *", paused: true }, { phase: "Enabled" }));
    const invalid = scheduleView(
      schedule(
        { schedule: "invalid", paused: true },
        { phase: "FailedValidation", validationErrors: ["invalid schedule: expected exactly 5 fields"] },
      ),
    );

    expect([enabled.paused, enabled.state.label, enabled.notes]).toEqual(["not-paused", "Enabled", []]);
    expect([paused.paused, paused.state.label, paused.notes]).toEqual(["paused", "Enabled", [NOTES.paused]]);
    expect([invalid.paused, invalid.state.label]).toEqual(["paused", "Failed validation"]);
    expect(invalid.validationErrors).toEqual(["invalid schedule: expected exactly 5 fields"]);
    expect(invalid.notes).toEqual([NOTES.paused]);
    expect(NOTES.paused).toContain("the ones written before the pause");
    expect(pausedText("paused")).toBe("Paused");
    expect(pausedText("not-paused")).toBe("Not paused");
  });

  it("says of a schedule that reports no phase that Velero has not read it", () => {
    expect(scheduleView(schedule({ schedule: "0 3 * * *" })).notes).toEqual([NOTES.notRead]);
    expect(scheduleView(schedule({ schedule: "0 3 * * *", paused: true })).notes).toEqual([NOTES.notReadPaused]);
    expect(NOTES.notReadPaused).toContain("will not until it is resumed");
    // A schedule that is new reports a phase: it is not one that reports none.
    expect(scheduleView(schedule({ schedule: "0 3 * * *" }, { phase: "New" })).notes).toEqual([]);
  });

  it("reads paused from the spec alone, and as not paused what is not set", () => {
    for (const value of [undefined, null, false, "true", 1]) {
      expect(scheduleView(schedule({ schedule: "0 3 * * *", paused: value as never })).paused).toBe("not-paused");
    }
  });

  it("says in words what skipping does when it is asked, and nothing when it is not", () => {
    const asked = scheduleView(schedule({ schedule: "0 3 * * *", skipImmediately: true }, { phase: "Enabled" }));
    const refused = scheduleView(schedule({ schedule: "0 3 * * *", skipImmediately: false }, { phase: "Enabled" }));
    const unset = scheduleView(schedule({ schedule: "0 3 * * *" }, { phase: "Enabled" }));

    expect([asked.skipImmediately, asked.notes]).toEqual([true, [NOTES.skip]]);
    expect([refused.skipImmediately, refused.notes]).toEqual([false, []]);
    expect("skipImmediately" in unset).toBe(false);
    // The release writes the time of the reading whether a run was due or not.
    expect(NOTES.skip).toContain("writes the time of that reading as the last skipped");
    expect(NOTES.skip).not.toMatch(/\bdue\b|missed|skips the run/);
  });

  it("names the last submission what it is, with the time it was last skipped", () => {
    const view = scheduleView(
      schedule(
        { schedule: "0 3 * * *" },
        { phase: "Enabled", lastBackup: "2026-09-09T03:00:00Z", lastSkipped: "2026-09-05T10:00:00Z" },
      ),
    );

    expect(view.lastSubmission).toBe(Date.parse("2026-09-09T03:00:00Z"));
    expect(view.lastSkipped).toBe(Date.parse("2026-09-05T10:00:00Z"));
    expect(Object.keys(view).join(" ")).not.toMatch(/lastBackup|lastSuccess/);
    expect(NOTES.submission).toContain("How the backup ended is in the history");
    const silent = scheduleView(schedule({ schedule: "0 3 * * *" }, { phase: "Enabled", lastBackup: "yesterday" }));

    expect(silent.lastSubmission).toBeUndefined();
    expect(silent.lastSkipped).toBeUndefined();
  });

  it("says whether the backups are owned by the schedule, as written", () => {
    const owned = (value: unknown) =>
      scheduleView(schedule({ schedule: "0 3 * * *", useOwnerReferencesInBackup: value as never })).owned;

    expect([owned(true), owned(false), owned(null), owned(undefined)].map(ownedText)).toEqual([
      "Yes",
      "No",
      "Not set",
      "Not set",
    ]);
  });

  it("has a view of a schedule that holds nothing", () => {
    const view = scheduleView(frozen({ metadata: { name: "bare" } }) as ScheduleResource);

    expect(view).toMatchObject({ name: "bare", namespace: "", paused: "not-paused", validationErrors: [] });
    expect(view.expression).toEqual({ zone: { of: "none" } });
    expect(JSON.stringify(view)).not.toMatch(/NaN|undefined/);
  });
});

describe("time of an operation", () => {
  it("is its start when it has one, and its creation when it did not start", () => {
    expect(operationTime(backup("a", started("2026-09-09")))).toEqual({
      of: "start",
      time: Date.parse("2026-09-09T03:00:00Z"),
    });
    expect(
      operationTime(
        backup("b", { phase: "FailedValidation", validationErrors: ["x"] }, { created: "2026-09-10T03:00:00Z" }),
      ),
    ).toEqual({ of: "creation", time: Date.parse("2026-09-10T03:00:00Z") });
    expect(operationTime(backup("c", { phase: "New" }, { created: "2026-09-10T03:00:01Z" })).of).toBe("creation");
    expect(operationTime(frozen({ metadata: { name: "d" } }))).toEqual({ of: "none" });
    expect(operationTime(frozen({ metadata: { name: "e", creationTimestamp: "soon" }, status: null }))).toEqual({
      of: "none",
    });
  });

  it("says which of the two times it is, and that an operation did not start only when its phase says so", () => {
    expect(operationTimeText({ of: "start", time: 1 }, "ran")).toBe("Started");
    expect(operationTimeText({ of: "creation", time: 1 }, "not-started")).toBe("Created, did not start");
    // A phase that says that the work began, or that says nothing, with no start: the start is not reported.
    for (const execution of ["running", "ran", "unknown", undefined] as const) {
      expect(operationTimeText({ of: "creation", time: 1 }, execution)).toBe("Created, start not reported");
    }
    expect(operationTimeText({ of: "none" }, "not-started")).toBe("Not reported");
  });

  it("puts a backup that failed its validation today before one that completed yesterday", () => {
    const refused = backup("nightly-3", { phase: "FailedValidation" }, { created: "2026-09-10T03:00:00Z" });
    const completed = backup("nightly-2", started("2026-09-09"), { created: "2026-09-09T03:00:00Z" });
    const silent = frozen({ metadata: { name: "nightly-0" } });
    const same = backup("nightly-1", started("2026-09-09"), { created: "2026-09-09T03:00:00Z" });

    expect([completed, silent, refused, same].sort(newestFirst).map((item) => item.metadata.name)).toEqual([
      "nightly-3",
      "nightly-1",
      "nightly-2",
      "nightly-0",
    ]);
  });
});

describe("history of a schedule", () => {
  const backups = [
    backup("nightly-20260907", started("2026-09-07")),
    backup("nightly-20260908", started("2026-09-08", "PartiallyFailed")),
    backup("nightly-20260909", started("2026-09-09", "InProgress")),
    backup(
      "nightly-20260910",
      { phase: "FailedValidation", validationErrors: ["x"] },
      { created: "2026-09-10T03:00:00Z" },
    ),
    backup("weekly-20260906", started("2026-09-06"), { schedule: "weekly" }),
    backup("by-hand", started("2026-09-09"), { schedule: "" }),
    backup("nightly-20260909", started("2026-09-09"), { namespace: "velero-other" }),
    // Named like a backup of the schedule, and not one of it: the label is what tells.
    backup("nightly-20260905", started("2026-09-05"), { schedule: "" }),
  ];

  it("holds the backups that carry the name of the schedule in their label, in its namespace, from the newest", () => {
    const history = scheduleHistory(schedule(), succeeded(backups, now), now);

    expect(history.state).toBe("listed");
    if (history.state !== "listed") return;
    expect(history.stale).toBe(false);
    expect(history.items.map((item) => [item.view.name, item.time.of])).toEqual([
      ["nightly-20260910", "creation"],
      ["nightly-20260909", "start"],
      ["nightly-20260908", "start"],
      ["nightly-20260907", "start"],
    ]);
    expect(history.items.every((item) => item.view.namespace === "velero-demo")).toBe(true);
    // The newest backup is the one that failed its validation, which has no start time.
    expect(history.items[0].view.state.label).toBe("Failed validation");
    expect(history.items[0].view.started).toBeUndefined();
  });

  it("counts the history by what it holds, and the counts are of the backups that exist", () => {
    const history = scheduleHistory(schedule(), succeeded(backups, now), now);

    if (history.state !== "listed") throw new Error("The history was read");
    expect(history.counts).toEqual({ total: 4, completed: 1, failed: 2, inFlight: 1, inFlightFailing: 0, unknown: 0 });
    expect(countsText(history.counts)).toBe("4 backups that exist: 1 completed; 2 ended with a failure; 1 in flight");
    const others = scheduleHistory(
      schedule(),
      succeeded(
        [
          backup("a", started("2026-09-09", "FinalizingPartiallyFailed")),
          backup("b", { phase: "Deleting" }),
          backup("c", undefined),
          backup("d", { phase: "Later" }),
        ],
        now,
      ),
      now,
    );

    if (others.state !== "listed") throw new Error("The history was read");
    expect(countsText(others.counts)).toBe(
      "4 backups that exist: 1 in flight, 1 of them with a failure; 3 of a state that is not known",
    );
    expect(countsText(historyCounts([]))).toBe("No backup of this schedule is among the ones that exist");
    expect(countsText(historyCounts(history.items.slice(3)))).toBe("1 backup that exists: 1 completed");
  });

  it("counts a backup of every phase of the release once, by where its phase says the backup is", () => {
    // What the release writes with each phase: no start for a backup that waits or was refused, no counter
    // of zero, and a count of the errors where the phase says that there are some.
    const waits = ["New", "Queued", "ReadyToStart", "FailedValidation"];
    const counted = Object.fromEntries(
      BACKUP_PHASES.map((phase) => {
        const status = waits.includes(phase)
          ? { phase, ...(phase === "FailedValidation" ? { validationErrors: ["x"] } : {}) }
          : {
              phase,
              startTimestamp: "2026-09-09T03:00:00Z",
              ...(phase.includes("PartiallyFailed") ? { errors: 1 } : {}),
              ...(phase === "Failed" ? { failureReason: "x" } : {}),
            };
        const history = scheduleHistory(schedule(), succeeded([backup(`of-${phase}`, status)], now), now);

        if (history.state !== "listed") throw new Error("The history was read");
        const { total, ...counts } = history.counts;

        expect(total).toBe(1);
        return [
          phase,
          Object.entries(counts)
            .filter(([, value]) => value)
            .map(([name]) => name)
            .join("+"),
        ];
      }),
    );

    expect(counted).toEqual({
      New: "inFlight",
      Queued: "inFlight",
      ReadyToStart: "inFlight",
      FailedValidation: "failed",
      InProgress: "inFlight",
      WaitingForPluginOperations: "inFlight",
      WaitingForPluginOperationsPartiallyFailed: "inFlight+inFlightFailing",
      Finalizing: "inFlight",
      FinalizingPartiallyFailed: "inFlight+inFlightFailing",
      Completed: "completed",
      PartiallyFailed: "failed",
      Failed: "failed",
      Deleting: "unknown",
    });
    // Every backup is counted once, whatever it reports: the parts are the whole.
    const all = scheduleHistory(
      schedule(),
      succeeded([...BACKUP_PHASES.map((phase) => backup(`of-${phase}`, { phase })), backup("silent", undefined)], now),
      now,
    );

    if (all.state !== "listed") throw new Error("The history was read");
    expect(all.counts.total).toBe(14);
    expect(all.counts.completed + all.counts.failed + all.counts.inFlight + all.counts.unknown).toBe(14);
  });

  it("has no word for the distance between two backups", () => {
    const history = scheduleHistory(
      schedule(),
      succeeded([backup("first", started("2026-08-01")), backup("last", started("2026-09-09"))], now),
      now,
    );

    if (history.state !== "listed") throw new Error("The history was read");
    // What a history holds is its backups and how many they are: nothing of it is about the time between them.
    expect(Object.keys(history).sort()).toEqual(["counts", "items", "stale", "state"]);
    expect(Object.keys(history.items[0]).sort()).toEqual(["time", "view"]);
    expect(Object.keys(history.counts).sort()).toEqual(
      ["completed", "failed", "inFlight", "inFlightFailing", "total", "unknown"].sort(),
    );
    expect(countsText(history.counts)).toBe("2 backups that exist: 2 completed");
  });

  it.each([
    ["forbidden", "inaccessible", "access is denied"],
    ["not-served", "unknown", "does not serve"],
    ["failed", "unknown", "could not be read"],
  ] as const)("is not an empty one when the backups were %s, and has no counts", (status, state, reason) => {
    const history = scheduleHistory(schedule(), failed(emptyRead<BackupResource>(), status), now);

    expect(history.state).toBe(state);
    expect((history as { reason: string }).reason).toContain(reason);
    expect("counts" in history).toBe(false);
    expect("items" in history).toBe(false);
  });

  it("is not read before the backups are, and is of an earlier read when the last one failed", () => {
    expect(scheduleHistory(schedule(), emptyRead<BackupResource>(), now).state).toBe("not-read");
    const earlier = scheduleHistory(schedule(), failed(succeeded(backups, now - 60_000), "failed"), now);

    expect(earlier).toMatchObject({ state: "listed", stale: true });
    expect((earlier as { items: unknown[] }).items).toHaveLength(4);
  });

  it("is empty for a schedule that has no backup among the ones that exist", () => {
    const history = scheduleHistory(
      frozen({ metadata: { name: "monthly", namespace: "velero-demo" } }),
      succeeded(backups, now),
      now,
    );

    expect(history).toMatchObject({ state: "listed", items: [], counts: { total: 0 } });
  });
});

describe("line of time of a history", () => {
  const items = (list: BackupResource[]) => {
    const history = scheduleHistory(schedule(), succeeded(list, now), now);

    if (history.state !== "listed") throw new Error("The history was read");
    return history.items;
  };

  it("places each backup between the oldest and now, by the time of the operation", () => {
    const strip = historyStrip(
      items([
        backup("first", started("2026-08-31")),
        backup("middle", started("2026-09-05", "PartiallyFailed")),
        backup("refused", { phase: "FailedValidation" }, { created: "2026-09-10T03:00:00Z" }),
      ]),
      now,
      1000,
    );

    expect(strip?.from).toBe(Date.parse("2026-08-31T03:00:00Z"));
    expect(strip?.to).toBe(now);
    expect(strip?.marks.map((mark) => mark.items.map((item) => item.view.name))).toEqual([
      ["first"],
      ["middle"],
      ["refused"],
    ]);
    expect(strip?.marks[0].at).toBe(0);
    expect(strip?.marks[1].at).toBeCloseTo((5 * day) / (now - Date.parse("2026-08-31T03:00:00Z")), 5);
    expect(strip?.marks.every((mark) => mark.at >= 0 && mark.at <= 1)).toBe(true);
    expect(strip?.marks.map((mark) => [mark.failing, mark.notStarted])).toEqual([
      [false, false],
      [true, false],
      [true, true],
    ]);
    expect(strip?.undrawn).toEqual([]);
  });

  it("draws as one mark the backups that would be over each other, and says when one of them failed", () => {
    const close = [
      backup("old", started("2026-08-01")),
      backup("a", started("2026-09-09")),
      backup("b", { ...started("2026-09-09", "Failed"), startTimestamp: "2026-09-09T03:30:00Z" }),
      backup("c", { ...started("2026-09-09", "InProgress"), startTimestamp: "2026-09-09T04:00:00Z" }),
    ];
    const narrow = historyStrip(items(close), now, 400);
    const wide = historyStrip(items(close), now, 400_000);

    expect(narrow?.marks.map((mark) => mark.items.map((item) => item.view.name))).toEqual([["old"], ["c", "b", "a"]]);
    expect(narrow?.marks[1]).toMatchObject({ failing: true, inFlight: true, notStarted: false });
    // With the room for each, each has its mark: the groups are of the width, not of the backups.
    expect(wide?.marks).toHaveLength(4);
    expect(wide?.marks.flatMap((mark) => mark.items)).toHaveLength(4);
    expect(narrow?.marks.flatMap((mark) => mark.items)).toHaveLength(4);
  });

  it("does not let a mark grow along the line", () => {
    const daily = Array.from({ length: 30 }, (_, index) =>
      backup(`nightly-${index}`, started(`2026-08-${String(index + 1).padStart(2, "0")}`)),
    );
    const strip = historyStrip(items(daily), now, 600, 40);

    expect(strip?.marks.length).toBeGreaterThan(5);
    expect(Math.max(...(strip?.marks ?? []).map((mark) => mark.items.length))).toBeLessThan(10);
  });

  it("leaves out of the line what has no time, and nothing else", () => {
    const strip = historyStrip(
      [
        ...items([backup("known", started("2026-09-09"))]),
        { view: items([backup("silent", undefined)])[0].view, time: { of: "none" } },
      ],
      now,
      800,
    );

    expect(strip?.marks.map((mark) => mark.items[0].view.name)).toEqual(["known"]);
    expect(strip?.undrawn.map((item) => item.view.name)).toEqual(["silent"]);
    expect(strip?.to).toBe(now);
  });

  // The clock of the machine that draws the line may be behind the one of the cluster.
  it("ends the line at a backup whose time is after the clock, and does not take it off the line", () => {
    const strip = historyStrip(
      items([backup("known", started("2026-09-09")), backup("ahead", started("2026-10-01"))]),
      now,
      800,
    );

    expect(strip?.marks.map((mark) => [mark.items[0].view.name, mark.at])).toEqual([
      ["known", 0],
      ["ahead", 1],
    ]);
    expect(strip?.undrawn).toEqual([]);
    expect(strip?.to).toBe(Date.parse("2026-10-01T03:00:00Z"));
    expect(JSON.stringify(strip)).not.toMatch(/NaN|Infinity/);
  });

  it("keeps two marks as far from each other as a mark is wide, and the backups of a mark from the newest", () => {
    expect(MARK_GAP).toBeGreaterThanOrEqual(26);
    const close = items([
      backup("one", started("2026-09-09")),
      backup("two", started("2026-09-09")),
      backup("old", started("2026-08-01")),
    ]);
    const strip = historyStrip(close, now, 800);
    const last = strip?.marks[strip.marks.length - 1];

    // The ones of the same time go by their names, as in the list under the line.
    expect(last?.items.map((item) => item.view.name)).toEqual(["one", "two"]);
    for (const [index, mark] of (strip?.marks ?? []).entries()) {
      const before = strip?.marks[index - 1];

      if (before) expect((mark.at - before.at) * 800).toBeGreaterThanOrEqual(MARK_GAP);
    }
  });

  it("says that a backup did not start by its phase, and not by a start that is missing", () => {
    const strip = historyStrip(
      items([
        backup("refused", { phase: "FailedValidation" }, { created: "2026-09-08T03:00:00Z" }),
        backup("silent", { phase: "Completed" }, { created: "2026-09-09T03:00:00Z" }),
      ]),
      now,
      800,
    );

    expect(strip?.marks.map((mark) => [mark.items[0].view.name, mark.notStarted])).toEqual([
      ["refused", true],
      ["silent", false],
    ]);
  });

  it("has no line for a history that has nothing to draw", () => {
    expect(historyStrip([], now, 800)).toBeUndefined();
    expect(historyStrip([{ view: items([backup("silent", undefined)])[0].view, time: { of: "none" } }], now, 800)).toBe(
      undefined,
    );
  });

  it("stands a width of nothing, and one backup alone", () => {
    const one = historyStrip(items([backup("only", started("2026-09-09"))]), now, 0);

    expect(one?.marks).toHaveLength(1);
    expect(one?.marks[0].at).toBe(0);
    expect(JSON.stringify(one)).not.toContain("NaN");
  });
});

describe("template of a schedule", () => {
  const location = (name: string, spec: object, status?: object, namespace = "velero-demo") =>
    ({ metadata: { name, namespace, uid: `uid-${name}` }, spec, ...(status ? { status } : {}) }) as never;
  const reads = (overrides: Partial<TemplateReads> = {}): TemplateReads =>
    frozen({
      storageLocations: succeeded<BackupStorageLocationResource>(
        [
          location("default", { default: true, accessMode: "ReadWrite" }, { phase: "Available" }),
          location("archive", { accessMode: "ReadOnly" }, { phase: "Available" }),
          location("broken", { accessMode: "ReadWrite" }, { phase: "Unavailable", message: "refused" }),
          location("silent", { accessMode: "ReadWrite" }),
          location("elsewhere", { default: true }, { phase: "Available" }, "velero-other"),
        ],
        now,
      ),
      snapshotLocations: succeeded<VolumeSnapshotLocationResource>([location("snapshots", { provider: "aws" })], now),
      ...overrides,
    });
  const asking = (template: object) => schedule({ schedule: "0 3 * * *", template: template as never });

  it("shows the template as the object carries it, and says not set of what is not", () => {
    const facts = Object.fromEntries(
      backupScope({
        includedNamespaces: ["shop"],
        excludedResources: ["secrets"],
        includeClusterResources: false,
        snapshotVolumes: true,
        ttl: "720h0m0s",
        labelSelector: { matchLabels: { app: "shop" } },
      }).map((fact) => [fact.id, fact]),
    );

    expect(facts["included-namespaces"].value).toBe("shop");
    expect(facts["excluded-resources"].value).toBe("secrets");
    expect(facts["cluster-resources"].value).toBe("No");
    expect(facts["volume-snapshots"].value).toBe("Yes");
    expect(facts.retention.value).toBe("720h0m0s");
    expect(facts["label-selector"].value).toBe("app=shop");
    expect(facts["excluded-namespaces"].value).toBe("Not set");
    for (const empty of [undefined, null, {}]) {
      const unset = backupScope(empty as never);

      expect(unset.map((fact) => fact.value)).toEqual(unset.map(() => "Not set"));
      expect(JSON.stringify(unset)).not.toMatch(/undefined|null|NaN/);
    }
    expect(backupScope({}).find((fact) => fact.id === "included-namespaces")?.note).toContain("release");
  });

  it("writes the selectors of the template as the object carries them", () => {
    const facts = Object.fromEntries(
      backupScope({
        labelSelector: {
          matchLabels: { app: "shop" },
          matchExpressions: [
            { key: "tier", operator: "In", values: ["web", "api"] },
            { key: "legacy", operator: "DoesNotExist" },
          ],
        },
        orLabelSelectors: [
          { matchLabels: { app: "billing" } },
          { matchExpressions: [{ key: "zone", operator: "Exists" }] },
        ],
      } as never).map((fact) => [fact.id, fact]),
    );

    // The expressions by their key, their operator and their values: how many they are says nothing.
    expect(facts["label-selector"].value).toBe("app=shop, tier In (web, api), legacy DoesNotExist");
    expect(facts["alternative-selectors"].value).toBe("(app=billing) or (zone Exists)");
  });

  it("resolves the locations the template names, and warns of none that takes the backups", () => {
    const found = templateReferences(
      asking({ storageLocation: "default", volumeSnapshotLocations: ["snapshots", "removed"] }),
      reads(),
    );

    expect(found.storageLocation).toMatchObject({ state: "resolved", uid: "uid-default" });
    expect(found.warning).toBeUndefined();
    expect(found.fallback).toBeUndefined();
    expect(found.volumeSnapshotLocations.map((reference) => [reference.name, reference.state])).toEqual([
      ["snapshots", "resolved"],
      ["removed", "absent"],
    ]);
  });

  it.each([
    ["removed", "absent", "a location that is not there"],
    ["archive", "resolved", "it is read-only"],
    ["broken", "resolved", "Velero reports it Unavailable"],
    ["silent", "resolved", "Velero reports no availability of it"],
  ])("says that the backups sent to %s are refused", (name, state, warning) => {
    const found = templateReferences(asking({ storageLocation: name }), reads());

    expect(found.storageLocation?.state).toBe(state);
    expect(found.warning).toContain(warning);
    expect(found.warning).toContain("The release refuses a backup");
  });

  it("says both reasons of a location that is read-only and unavailable", () => {
    expect(locationWarning(location("both", { accessMode: "ReadOnly" }, { phase: "Unavailable" }) as never)).toBe(
      "The release refuses a backup sent to this location: it is read-only, and Velero reports it Unavailable.",
    );
    expect(locationWarning(undefined)).toBeUndefined();
  });

  it("says where the backups go when the template names no location", () => {
    expect(templateReferences(asking({}), reads())).toMatchObject({
      fallback: { state: "marked", name: "default" },
      volumeSnapshotLocations: [],
    });
    expect(templateReferences(asking({}), reads()).storageLocation).toBeUndefined();
    const unmarked = reads({
      storageLocations: succeeded<BackupStorageLocationResource>(
        [location("archive", { accessMode: "ReadOnly" }, { phase: "Available" })],
        now,
      ),
    });

    expect(templateReferences(asking({}), unmarked)).toMatchObject({ fallback: { state: "none-marked" } });
    expect(templateReferences(asking({}), unmarked).warning).toBeUndefined();
    // The location of another installation that is marked default is not the one of this installation.
    expect(
      templateReferences(schedule({ schedule: "0 3 * * *" }, undefined, "velero-third"), reads()).fallback,
    ).toEqual({ state: "none-marked" });
  });

  it("warns of the default location that does not take the backups", () => {
    const marked = reads({
      storageLocations: succeeded<BackupStorageLocationResource>(
        [location("a", { default: true }, { phase: "Unavailable" }), location("b", {}, { phase: "Available" })],
        now,
      ),
    });
    const found = templateReferences(asking({}), marked);

    expect(found.fallback).toEqual({ state: "marked", name: "a" });
    expect(found.warning).toContain("Velero reports it Unavailable");
  });

  // The release sends a backup to the first default it finds and keeps marked the one created last: with
  // more than one marked, which one takes a backup is not settled, and the view picks none.
  it("names every location that is marked default when more than one is, and the one the release keeps", () => {
    const at = (name: string, created: string, spec: object, status: object) => ({
      metadata: { name, namespace: "velero-demo", uid: `uid-${name}`, creationTimestamp: created },
      spec,
      status,
    });
    const marked = reads({
      storageLocations: succeeded<BackupStorageLocationResource>(
        [
          at("b", "2026-09-02T00:00:00Z", { default: true, accessMode: "ReadOnly" }, { phase: "Available" }),
          at("a", "2026-09-01T00:00:00Z", { default: true }, { phase: "Available" }),
          at("c", "2026-09-02T00:00:00Z", { default: true }, { phase: "Unavailable" }),
          at("d", "2026-09-03T00:00:00Z", {}, { phase: "Available" }),
        ] as never,
        now,
      ),
    });
    const found = templateReferences(asking({}), marked);

    // Of the ones created at the same time the release keeps the first it compared, which is the first by name.
    expect(found.fallback).toEqual({ state: "many-marked", names: ["a", "b", "c"], kept: "b" });
    // Each one that does not take a backup is named with its reason: a backup may go to any of them.
    expect(found.warning).toBe(
      "b: The release refuses a backup sent to this location: it is read-only. c: The release refuses a backup sent to this location: Velero reports it Unavailable.",
    );
    const fine = reads({
      storageLocations: succeeded<BackupStorageLocationResource>(
        [
          at("a", "2026-09-01T00:00:00Z", { default: true }, { phase: "Available" }),
          at("b", "soon", { default: true }, { phase: "Available" }),
        ] as never,
        now,
      ),
    });

    expect(templateReferences(asking({}), fine).fallback).toEqual({
      state: "many-marked",
      names: ["a", "b"],
      kept: "a",
    });
    expect(templateReferences(asking({}), fine).warning).toBeUndefined();
  });

  it("shows the filters and the settings the template carries beside the ones it shows always", () => {
    const facts = Object.fromEntries(
      backupScope({
        includedNamespaceScopedResources: ["deployments", "configmaps"],
        excludedClusterScopedResources: ["nodes"],
        hooks: { resources: [{ name: "freeze" }, {}] },
        orderedResources: { pods: "shop/db,shop/web" },
        resourcePolicy: { kind: "configmap", name: "policy" },
        csiSnapshotTimeout: "10m0s",
        itemOperationTimeout: "4h0m0s",
        datamover: "velero",
        uploaderConfig: { parallelFilesUpload: 4 },
        volumeGroupSnapshotLabelKey: "group",
        storageLocation: "default",
        volumeSnapshotLocations: ["snapshots"],
      }).map((fact) => [fact.id, fact.value]),
    );

    expect(facts).toMatchObject({
      "included-resources": "Not set",
      "included-namespace-scoped-resources": "deployments, configmaps",
      "excluded-cluster-scoped-resources": "nodes",
      hooks: "2: freeze",
      "ordered-resources": "pods: shop/db,shop/web",
      "resource-policy": "configmap policy",
      "csi-snapshot-timeout": "10m0s",
      "item-operation-timeout": "4h0m0s",
      "data-mover": "velero",
      uploader: "4 files at a time",
      "volume-group-snapshot-label": "group",
    });
    // The locations have a band of their own, and what is not set of these has no line.
    expect(Object.keys(facts)).not.toContain("field-storageLocation");
    expect(Object.keys(facts)).not.toContain("excluded-namespace-scoped-resources");
    expect(backupScope({}).map((fact) => fact.id)).toHaveLength(11);
  });

  it("shows the labels the template gives the backups, which the release takes in place of the ones of the schedule", () => {
    const labels = (template: object) => backupScope(template as never).find((fact) => fact.id === "labels");

    expect(labels({ metadata: { labels: { team: "shop", tier: "gold" } } })).toEqual({
      id: "labels",
      name: "Labels of the backups",
      value: "team=shop, tier=gold",
      note: "The release gives a backup these labels, and not the ones of the schedule.",
    });
    // A template that carries none, or carries nothing that is a label, has no line for them.
    for (const template of [{}, { metadata: {} }, { metadata: { labels: {} } }, { metadata: { labels: null } }]) {
      expect(labels(template)).toBeUndefined();
    }
    // The labels are not shown a second time as a field with no words.
    expect(
      backupScope({ metadata: { labels: { team: "shop" } } } as never).filter((fact) => fact.id.startsWith("field-")),
    ).toEqual([]);
  });

  it("shows a field it has no words for by the name the object gives it, as it is written", () => {
    const facts = backupScope({ ttl: "1h0m0s", futureFilter: ["a"], anotherSetting: "on", nothing: null } as never);
    const others = facts.filter((fact) => fact.id.startsWith("field-"));

    expect(others.map((fact) => [fact.name, fact.value])).toEqual([
      ["anotherSetting", "on"],
      ["futureFilter", '["a"]'],
    ]);
    expect(others[0].note).toContain("no words for");
  });

  it("says of the namespaces that are not set that the release includes the ones that are not excluded", () => {
    const facts = backupScope({ excludedNamespaces: ["kube-system"] });

    expect(facts.find((fact) => fact.id === "included-namespaces")).toEqual({
      id: "included-namespaces",
      name: "Included namespaces",
      value: "Not set",
      note: "The release includes every namespace, but the ones that are excluded.",
    });
  });

  it("knows that a backup that reports no phase, New or InProgress holds the submissions, whichever it is", () => {
    const held = (...statuses: (object | undefined)[]) => {
      const history = scheduleHistory(
        schedule(),
        succeeded(
          statuses.map((status, index) => backup(`b-${index}`, status)),
          now,
        ),
        now,
      );

      return history.state === "listed" && holdsSubmissions(history.items);
    };

    expect(held(started("2026-09-09"), started("2026-09-08", "Failed"))).toBe(false);
    expect(held(started("2026-09-09"), started("2026-09-08", "InProgress"))).toBe(true);
    expect(held({ phase: "New" }, started("2026-09-08"))).toBe(true);
    expect(held(started("2026-09-09"), undefined)).toBe(true);
    // The other phases in flight do not hold them.
    expect(held(started("2026-09-09", "Finalizing"), started("2026-09-08", "WaitingForPluginOperations"))).toBe(false);
    expect(held({ phase: "Queued" }, { phase: "FailedValidation" })).toBe(false);
    expect(held()).toBe(false);
  });

  it("does not know where the backups go when the locations were not read", () => {
    const denied = reads({ storageLocations: failed(emptyRead<BackupStorageLocationResource>(), "forbidden") });

    expect(templateReferences(asking({}), denied).fallback).toMatchObject({ state: "unknown" });
    expect(templateReferences(asking({ storageLocation: "default" }), denied)).toMatchObject({
      storageLocation: { state: "inaccessible" },
    });
    expect(templateReferences(asking({ storageLocation: "default" }), denied).warning).toBeUndefined();
  });
});

describe("restores that name a schedule", () => {
  const restore = (name: string, spec: RestoreResource["spec"], namespace = "velero-demo"): RestoreResource =>
    frozen({ metadata: { name, namespace, uid: `uid-${name}` }, spec });
  const restores = [
    restore("from-the-schedule", { scheduleName: "nightly" }),
    restore("from-a-backup-of-it", { backupName: "nightly-20260909", scheduleName: "nightly" }),
    restore("of-another", { scheduleName: "weekly" }),
    restore("of-none", { backupName: "by-hand" }),
    restore("elsewhere", { scheduleName: "nightly" }, "velero-other"),
  ];

  it("are the ones of its namespace that carry its name, whichever way they were asked", () => {
    const found = scheduleRestores(schedule(), succeeded(restores, now));

    expect(found).toMatchObject({ state: "listed", stale: false });
    expect((found as { items: RestoreResource[] }).items.map((item) => item.metadata.name)).toEqual([
      "from-the-schedule",
      "from-a-backup-of-it",
    ]);
  });

  it("are none when their list was read and none names the schedule", () => {
    expect(scheduleRestores(schedule(), succeeded(restores.slice(2), now))).toEqual({
      state: "listed",
      stale: false,
      items: [],
    });
    expect(scheduleRestores(schedule(), succeeded([], now))).toMatchObject({ state: "listed", items: [] });
  });

  it("are not none when their list was not read", () => {
    expect(scheduleRestores(schedule(), failed(emptyRead<RestoreResource>(), "forbidden"))).toMatchObject({
      state: "inaccessible",
    });
    expect(scheduleRestores(schedule(), emptyRead<RestoreResource>()).state).toBe("not-read");
    expect(scheduleRestores(schedule(), failed(succeeded(restores, now), "failed"))).toMatchObject({
      state: "listed",
      stale: true,
    });
  });
});
