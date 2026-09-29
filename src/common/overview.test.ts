import { describe, expect, it } from "vitest";
import { operationLine } from "./operation-line";
import {
  attention,
  attentionSummary,
  COMPLETED_NOTE,
  COVERAGE_WORDS,
  coverage,
  DEFAULT_WINDOW,
  GROUP_TITLES,
  inFlight,
  LINES,
  locationLines,
  newestCompleted,
  RULES,
  readWindow,
  recent,
  scheduleLines,
  WINDOW_LENGTH,
  WINDOW_TITLES,
  WINDOWS,
} from "./overview";
import { BACKUP_PHASES, RESTORE_PHASES } from "./phases";
import { emptyRead, failed, succeeded } from "./read-state";

import type { AttentionItem, OverviewReads, Rule } from "./overview";
import type {
  BackupResource,
  BackupStorageLocationResource,
  RestoreResource,
  ScheduleResource,
  VolumeSnapshotLocationResource,
} from "./types";

const now = Date.parse("2026-09-10T12:00:00Z");
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const A = "velero-a";
const ago = (milliseconds: number) => new Date(now - milliseconds).toISOString().replace(".000Z", "Z");

// What the host hands over is plain data that the extension does not own: no helper may change it.
function frozen<Value>(value: Value): Value {
  if (value && typeof value === "object") {
    for (const inner of Object.values(value)) frozen(inner);
    Object.freeze(value);
  }
  return value;
}

function object<Resource>(name: string, spec: object | undefined, status: object | undefined, more: object = {}) {
  return frozen({
    metadata: { name, namespace: A, uid: `uid-${name}`, creationTimestamp: ago(40 * DAY), ...more },
    ...(spec ? { spec } : {}),
    ...(status ? { status } : {}),
  }) as Resource;
}

// What the release writes with a phase: no start for what waits or was refused, no counter of zero, a
// count of the errors where the phase says that there are some.
function ran(phase: string, started: number, more: object = {}) {
  if (["New", "Queued", "ReadyToStart"].includes(phase)) return { phase, ...more };
  if (phase === "FailedValidation") return { phase, validationErrors: ["refused"], ...more };
  return {
    phase,
    startTimestamp: ago(started),
    ...(["Completed", "PartiallyFailed", "Failed"].includes(phase)
      ? { completionTimestamp: ago(started - 5 * MINUTE) }
      : {}),
    ...(phase.includes("PartiallyFailed") ? { errors: 2 } : {}),
    ...(phase === "Failed" ? { failureReason: "stopped" } : {}),
    ...more,
  };
}

const backup = (name: string, phase: string, started: number, more: { schedule?: string; created?: number } = {}) =>
  object<BackupResource>(name, { storageLocation: "default" }, ran(phase, started), {
    creationTimestamp: ago(more.created ?? started),
    ...(more.schedule ? { labels: { "velero.io/schedule-name": more.schedule } } : {}),
  });
const restore = (name: string, phase: string, started: number, created = started) =>
  object<RestoreResource>(name, { backupName: "one" }, ran(phase, started), { creationTimestamp: ago(created) });
// A schedule Velero read, unless it is given no status: `null` is a schedule that reports nothing.
const schedule = (name: string, spec: object = {}, status: object | null = { phase: "Enabled" }) =>
  object<ScheduleResource>(
    name,
    { schedule: "0 3 * * *", skipImmediately: false, template: {}, ...spec },
    status ?? undefined,
  );
const location = (name: string, spec: object = {}, status: object | undefined = undefined) =>
  object<BackupStorageLocationResource>(
    name,
    { provider: "aws", ...spec },
    status ?? { phase: "Available", lastValidationTime: ago(30_000) },
  );
const fine = location("default", { default: true });

function reads(more: Partial<OverviewReads> = {}): OverviewReads {
  return {
    backups: succeeded<BackupResource>([], now),
    restores: succeeded<RestoreResource>([], now),
    schedules: succeeded<ScheduleResource>([], now),
    storageLocations: succeeded<BackupStorageLocationResource>([fine], now),
    snapshotLocations: succeeded<VolumeSnapshotLocationResource>([], now),
    ...more,
  };
}

const denied = <Item>() => failed(emptyRead<Item>(), "forbidden");
const stale = <Item>(items: Item[]) => failed(succeeded(items, now - MINUTE), "failed");
const rules = (found: { items: AttentionItem[] }) => found.items.map((item) => [item.rule, item.name ?? ""]);
const item = (found: { items: AttentionItem[] }, rule: Rule, name?: string) => {
  const items = found.items.filter((candidate) => candidate.rule === rule && candidate.name === name);

  if (items.length !== 1) throw new Error(`${rule} gives ${items.length} items for ${name ?? "the list"}`);
  return items[0];
};

describe("window of the recent operations", () => {
  it("is 24 hours, 7 days or 30 days, and 7 days when none was chosen", () => {
    expect(WINDOWS).toEqual(["24h", "7d", "30d"]);
    expect(DEFAULT_WINDOW).toBe("7d");
    expect(WINDOW_LENGTH).toEqual({ "24h": DAY, "7d": 7 * DAY, "30d": 30 * DAY });
    expect(WINDOW_TITLES).toEqual({ "24h": "24 hours", "7d": "7 days", "30d": "30 days" });
    for (const window of WINDOWS) expect(readWindow(window)).toBe(window);
    for (const stored of [undefined, null, "", "1h", "7D", 7, { window: "24h" }, ["24h"], "30d "]) {
      expect(readWindow(stored)).toBe("7d");
    }
  });
});

describe("what was read of an installation", () => {
  it("is a number for a family that was read, its state for one that was not, and a time for one that is stale", () => {
    const found = coverage({
      backups: succeeded([backup("a", "Completed", HOUR), backup("b", "Completed", 2 * HOUR)], now),
      restores: denied(),
      schedules: stale([schedule("nightly")]),
      storageLocations: failed(emptyRead(), "not-served"),
      snapshotLocations: failed(emptyRead(), "failed"),
    });

    expect(found).toEqual([
      { family: "backups", kind: "backup", state: "read", count: 2 },
      { family: "restores", kind: "restore", state: "denied" },
      { family: "schedules", kind: "schedule", state: "stale", count: 1, at: now - MINUTE, status: "failed" },
      { family: "storageLocations", kind: "storage-location", state: "not-served" },
      { family: "snapshotLocations", kind: "snapshot-location", state: "failed" },
    ]);
    // A family that holds nothing was read, and holds none: it is a number, which is zero.
    expect(coverage(reads())[0]).toEqual({ family: "backups", kind: "backup", state: "read", count: 0 });
    // One that was never answered is not a family that holds none.
    for (const read of [emptyRead<BackupResource>(), { ...emptyRead<BackupResource>(), status: "loading" as const }]) {
      expect(coverage(reads({ backups: read }))[0]).toEqual({ family: "backups", kind: "backup", state: "not-read" });
    }
    expect(COVERAGE_WORDS).toEqual({
      denied: "Access denied",
      "not-served": "Not served by the cluster",
      failed: "Could not be read",
      "not-read": "Not read yet",
    });
  });
});

describe("what needs attention", () => {
  it("is nothing for an installation where no rule finds anything, which is not that all is well", () => {
    const found = attention(
      reads({
        backups: succeeded([backup("a", "Completed", HOUR), backup("b", "InProgress", MINUTE)], now),
        restores: succeeded([restore("r", "Completed", HOUR)], now),
        schedules: succeeded([schedule("nightly"), schedule("held", { paused: true })], now),
      }),
      now,
      "7d",
    );

    expect(found).toEqual({ items: [], unchecked: [], earlier: [] });
    expect(attentionSummary(found)).toBe("Nothing in what was read needs attention.");
  });

  it("A1: lists a storage location that reports Unavailable, with what Velero says and its last validation", () => {
    const found = attention(
      reads({
        storageLocations: succeeded(
          [
            fine,
            location("broken", {}, { phase: "Unavailable", message: "no bucket", lastValidationTime: ago(30_000) }),
            location("mute", {}, { phase: "Unavailable" }),
            // What Velero says ends as a sentence does, with lines after it.
            location("ended", {}, { phase: "Unavailable", message: "The bucket was not found.\n" }),
          ],
          now,
        ),
      }),
      now,
      "7d",
    );

    expect(rules(found)).toEqual([
      ["A1", "broken"],
      ["A1", "ended"],
      ["A1", "mute"],
    ]);
    // The reason goes on after what Velero says with one full stop, however that ends.
    expect(item(found, "A1", "ended").reason).toBe(
      "Velero reports it unavailable: The bucket was not found. Never validated.",
    );
    expect(item(found, "A1", "broken")).toEqual({
      rule: "A1",
      group: "storage",
      kind: "storage-location",
      name: "broken",
      title: "broken",
      reason: "Velero reports it unavailable: no bucket. Last validated 30s ago.",
      time: now - 30_000,
      stale: false,
    });
    expect(item(found, "A1", "mute").reason).toBe("Velero reports it unavailable. Never validated.");
    expect("time" in item(found, "A1", "mute")).toBe(false);
  });

  it("A2: lists a storage location that reports no availability, and not one that reports what is not known", () => {
    const found = attention(
      reads({
        storageLocations: succeeded([fine, object("silent", { provider: "aws" }, undefined)], now),
      }),
      now,
      "7d",
    );

    expect(rules(found)).toEqual([["A2", "silent"]]);
    expect(item(found, "A2", "silent").reason).toBe("Velero has not reported on it.");
    // A phase that is not known is neither unavailable nor silent: no rule names it.
    expect(
      rules(
        attention(
          reads({ storageLocations: succeeded([fine, location("odd", {}, { phase: "Degraded" })], now) }),
          now,
          "7d",
        ),
      ),
    ).toEqual([]);
  });

  it("A3: lists a storage location whose availability may be out of date, with the frequency it names", () => {
    const found = attention(
      reads({
        storageLocations: succeeded(
          [
            fine,
            location("old", {}, { phase: "Available", lastValidationTime: ago(2 * DAY) }),
            location(
              "slow",
              { validationFrequency: "1m0s" },
              { phase: "Available", lastValidationTime: ago(10 * MINUTE) },
            ),
            location(
              "fresh",
              { validationFrequency: "1m0s" },
              { phase: "Available", lastValidationTime: ago(2 * MINUTE) },
            ),
            location("never", {}, { phase: "Available" }),
            location("off", { validationFrequency: "0s" }, { phase: "Available", lastValidationTime: ago(2 * DAY) }),
            location(
              "unread",
              { validationFrequency: "often" },
              { phase: "Available", lastValidationTime: ago(2 * DAY) },
            ),
          ],
          now,
        ),
      }),
      now,
      "7d",
    );

    // By name: the time the reason refers to moves at every validation.
    expect(rules(found)).toEqual([
      ["A3", "off"],
      ["A3", "old"],
      ["A3", "slow"],
      ["A3", "unread"],
    ]);
    // A frequency that is turned off is why no validation is to come, and one that cannot be read is
    // why the one of the server counts: both are said.
    expect(item(found, "A3", "off").reason).toBe(
      "Last validated 2d ago. The availability may be out of date: the last validation is older than one hour, by the clock of this machine. The periodic validation is turned off: the availability is the one of the last validation.",
    );
    expect(item(found, "A3", "unread").reason).toBe(
      "Last validated 2d ago. The availability may be out of date: the last validation is older than one hour, by the clock of this machine. This is not a frequency the release takes: it uses the one of its server, which this view does not read.",
    );
    expect(item(found, "A3", "old")).toMatchObject({
      reason:
        "Last validated 2d ago. The availability may be out of date: the last validation is older than one hour, by the clock of this machine.",
      time: now - 2 * DAY,
    });
    expect(item(found, "A3", "slow").reason).toBe(
      "Last validated 10m ago, with a frequency of 1m0s. The availability may be out of date: the last validation is older than 3 times the frequency, by the clock of this machine.",
    );
  });

  it("A4: lists the default that is missing, and the one that does not take a backup", () => {
    const none = attention(reads({ storageLocations: succeeded([location("a"), location("b")], now) }), now, "7d");

    // An item of no single object: it has no name, and leads to the list.
    expect(none.items).toEqual([
      {
        rule: "A4",
        group: "storage",
        kind: "storage-location",
        title: "Default storage location",
        reason:
          "No storage location is marked default. The server of Velero may name one in its settings, which this view does not read: a backup that names no location goes there.",
        stale: false,
      },
    ]);
    const refusing = attention(
      reads({
        storageLocations: succeeded(
          [
            location("archive", { default: true, accessMode: "ReadOnly" }),
            location("broken", { default: true }, { phase: "Unavailable", lastValidationTime: ago(30_000) }),
            object("silent", { provider: "aws", default: true }, undefined),
            location("plain", { accessMode: "ReadOnly" }),
          ],
          now,
        ),
      }),
      now,
      "7d",
    );

    expect(rules(refusing).filter(([rule]) => rule === "A4")).toEqual([
      ["A4", "archive"],
      ["A4", "broken"],
      ["A4", "silent"],
    ]);
    expect(item(refusing, "A4", "archive").reason).toBe(
      "It is marked default. The release refuses a backup sent to this location: it is read-only.",
    );
    expect(item(refusing, "A4", "broken").reason).toContain("Velero reports it Unavailable");
    expect(item(refusing, "A4", "silent").reason).toContain("Velero reports no availability of it");
    // A location that is read-only and is not marked default is no item: a backup goes there when it is named.
    expect(rules(refusing).filter(([, name]) => name === "plain")).toEqual([]);
    // More than one marked default, each taking the backups, is no item of this rule.
    expect(
      rules(
        attention(
          reads({ storageLocations: succeeded([fine, location("second", { default: true })], now) }),
          now,
          "7d",
        ),
      ),
    ).toEqual([]);
    // No storage location at all: none is marked, and a backup has nowhere to go.
    const empty = attention(reads({ storageLocations: succeeded([], now) }), now, "7d");

    expect(empty.items).toEqual([
      {
        rule: "A4",
        group: "storage",
        kind: "storage-location",
        title: "Default storage location",
        reason:
          "No storage location is in this installation, and none is marked default. The release refuses a backup sent to a location that is not there.",
        stale: false,
      },
    ]);
    // The storage locations that were not read are not an installation that has none.
    expect(rules(attention(reads({ storageLocations: denied() }), now, "7d"))).toEqual([]);
  });

  it("A5: lists a schedule Velero refused, and says of a paused one that its errors are of before the pause", () => {
    const found = attention(
      reads({
        schedules: succeeded(
          [
            schedule("broken", {}, { phase: "FailedValidation", validationErrors: ["expected 5 fields", "found 2"] }),
            schedule("held", { paused: true }, { phase: "FailedValidation", validationErrors: ["bad zone"] }),
            schedule("bare", {}, { phase: "FailedValidation" }),
            schedule("nightly"),
          ],
          now,
        ),
      }),
      now,
      "7d",
    );

    expect(rules(found)).toEqual([
      ["A5", "bare"],
      ["A5", "broken"],
      ["A5", "held"],
    ]);
    expect(item(found, "A5", "broken").reason).toBe("Velero refused its expression: expected 5 fields; found 2.");
    expect(item(found, "A5", "held").reason).toBe(
      "Velero refused its expression: bad zone. Velero does not read a schedule while it is paused: its validation and its errors are the ones written before the pause.",
    );
    expect(item(found, "A5", "bare").reason).toBe("Velero refused its expression, and reports no error.");
  });

  it("A6: lists a schedule that is not paused and reports no phase, and not one that is paused", () => {
    const found = attention(
      reads({
        schedules: succeeded(
          [
            schedule("unread", {}, null),
            schedule("unread-paused", { paused: true }, undefined),
            schedule("new", {}, { phase: "New" }),
          ],
          now,
        ),
      }),
      now,
      "7d",
    );

    expect(rules(found)).toEqual([["A6", "unread"]]);
    expect(item(found, "A6", "unread").reason).toBe("Velero has not read this schedule yet.");
  });

  it("A7: lists a schedule whose newest backup ended with a failure, by the time of the operation", () => {
    const backups = succeeded(
      [
        // The newest failed its validation: it has no start, and is at the time it was created.
        backup("nightly-3", "FailedValidation", 0, { schedule: "nightly", created: 2 * HOUR }),
        backup("nightly-2", "Completed", DAY, { schedule: "nightly" }),
        // A failure that a later backup followed is history.
        backup("weekly-2", "Completed", HOUR, { schedule: "weekly" }),
        backup("weekly-1", "Failed", 8 * DAY, { schedule: "weekly" }),
        backup("partly-1", "PartiallyFailed", 3 * HOUR, { schedule: "partly" }),
        // In flight with a failure: it has not ended, and is an item of what is in flight.
        backup("running-1", "FinalizingPartiallyFailed", HOUR, { schedule: "running" }),
        backup("held-1", "Failed", HOUR, { schedule: "held" }),
        // Named like a backup of the schedule, and of none.
        backup("empty-1", "Failed", 40 * DAY),
      ],
      now,
    );
    const schedules = succeeded(
      [
        schedule("nightly"),
        schedule("weekly"),
        schedule("partly"),
        schedule("running"),
        schedule("held", { paused: true }),
        schedule("empty"),
      ],
      now,
    );
    const found = attention(reads({ backups, schedules }), now, "7d");

    expect(rules(found).filter(([rule]) => rule === "A7")).toEqual([
      ["A7", "nightly"],
      ["A7", "partly"],
    ]);
    expect(item(found, "A7", "nightly")).toEqual({
      rule: "A7",
      group: "schedules",
      kind: "schedule",
      name: "nightly",
      title: "nightly",
      reason: "Its newest backup, nightly-3, ended with a failure. Failed validation: 1 validation error.",
      time: now - 2 * HOUR,
      related: { kind: "backup", name: "nightly-3" },
      stale: false,
    });
    expect(item(found, "A7", "partly").reason).toBe(
      "Its newest backup, partly-1, ended with a failure. Partially failed: 2 errors.",
    );
    // The one in flight is of the first group, and the one of no schedule is outside the window.
    expect(rules(found).filter(([rule]) => rule !== "A7")).toEqual([["A9", "running-1"]]);
  });

  it("A8: lists a schedule whose template names a location that does not take its backups", () => {
    const storageLocations = succeeded(
      [
        fine,
        location("archive", { accessMode: "ReadOnly" }),
        location("broken", {}, { phase: "Unavailable", lastValidationTime: ago(30_000) }),
      ],
      now,
    );
    const to = (name: string, storageLocation: string | undefined, more: object = {}) =>
      schedule(name, { template: storageLocation === undefined ? {} : { storageLocation }, ...more });
    const found = attention(
      reads({
        storageLocations,
        schedules: succeeded(
          [
            to("to-removed", "removed"),
            to("to-archive", "archive"),
            to("to-broken", "broken"),
            to("to-default", "default"),
            to("to-none", undefined),
            to("held", "removed", { paused: true }),
          ],
          now,
        ),
      }),
      now,
      "7d",
    );

    expect(rules(found).filter(([rule]) => rule === "A8")).toEqual([
      ["A8", "to-archive"],
      ["A8", "to-broken"],
      ["A8", "to-removed"],
    ]);
    expect(item(found, "A8", "to-removed")).toMatchObject({
      reason:
        "Its template names the storage location removed, which is not in the installation. The release refuses a backup sent to a location that is not there.",
    });
    // A location that is not there is a name: the item leads to the schedule alone.
    expect("related" in item(found, "A8", "to-removed")).toBe(false);
    expect(item(found, "A8", "to-archive")).toMatchObject({
      reason:
        "Its template names the storage location archive. The release refuses a backup sent to this location: it is read-only.",
      related: { kind: "storage-location", name: "archive" },
    });
    expect(item(found, "A8", "to-broken").reason).toContain("Velero reports it Unavailable");
  });

  it("A9: lists the backups and the restores in flight that carry a failure, and no other in flight", () => {
    const found = attention(
      reads({
        backups: succeeded(
          [
            backup("waiting", "WaitingForPluginOperationsPartiallyFailed", 2 * HOUR),
            backup("clean", "InProgress", HOUR),
            backup("queued", "Queued", 0, { created: HOUR }),
          ],
          now,
        ),
        restores: succeeded(
          [restore("finalizing", "FinalizingPartiallyFailed", HOUR), restore("going", "InProgress", MINUTE)],
          now,
        ),
      }),
      now,
      "24h",
    );

    // From the newest.
    expect(rules(found)).toEqual([
      ["A9", "finalizing"],
      ["A9", "waiting"],
    ]);
    expect(item(found, "A9", "finalizing")).toEqual({
      rule: "A9",
      group: "in-flight",
      kind: "restore",
      name: "finalizing",
      title: "finalizing",
      // Where the operation is, and what it says of a failure: two facts.
      reason: "Finalizing: 2 errors.",
      time: now - HOUR,
      stale: false,
    });
    expect(item(found, "A9", "waiting").kind).toBe("backup");
  });

  it("A10: lists what ended with a failure in the window, of a restore or of a backup of no schedule", () => {
    const at = (window: "24h" | "7d" | "30d") =>
      rules(
        attention(
          reads({
            backups: succeeded(
              [
                backup("by-hand", "Failed", 2 * DAY),
                backup("by-hand-old", "PartiallyFailed", 10 * DAY),
                backup("by-hand-fine", "Completed", HOUR),
                backup("refused", "FailedValidation", 0, { created: HOUR }),
                // The failure of a backup of a schedule is of its schedule.
                backup("nightly-1", "Failed", HOUR, { schedule: "nightly" }),
              ],
              now,
            ),
            schedules: succeeded([schedule("nightly", { paused: true })], now),
            restores: succeeded(
              [
                restore("failed", "Failed", 3 * HOUR),
                restore("partly", "PartiallyFailed", 6 * DAY),
                restore("refused-restore", "FailedValidation", 0, 20 * DAY),
                restore("fine", "Completed", HOUR),
              ],
              now,
            ),
          }),
          now,
          window,
        ),
      );

    expect(at("24h")).toEqual([
      ["A10", "refused"],
      ["A10", "failed"],
    ]);
    expect(at("7d")).toEqual([
      ["A10", "refused"],
      ["A10", "failed"],
      ["A10", "by-hand"],
      ["A10", "partly"],
    ]);
    expect(at("30d")).toEqual([
      ["A10", "refused"],
      ["A10", "failed"],
      ["A10", "by-hand"],
      ["A10", "partly"],
      ["A10", "by-hand-old"],
      ["A10", "refused-restore"],
    ]);
  });

  it("A10: takes a backup whose schedule is not there any more as one of no schedule", () => {
    const orphan = backup("removed-1", "Failed", HOUR, { schedule: "removed" });
    const elsewhere = frozen({
      ...schedule("removed"),
      metadata: { ...schedule("removed").metadata, namespace: "velero-b" },
    }) as ScheduleResource;

    // The schedules were read and hold none of that name: no schedule is there to be an item of.
    expect(rules(attention(reads({ backups: succeeded([orphan], now) }), now, "7d"))).toEqual([["A10", "removed-1"]]);
    // One of that name in another namespace is not its schedule.
    expect(
      rules(
        attention(reads({ backups: succeeded([orphan], now), schedules: succeeded([elsewhere], now) }), now, "7d"),
      ).filter(([rule]) => rule === "A10"),
    ).toEqual([["A10", "removed-1"]]);
    // The schedules were not read: whose backup it is cannot be said, and the line of what was not
    // checked says so.
    const blind = attention(reads({ backups: succeeded([orphan], now), schedules: denied() }), now, "7d");

    expect(rules(blind)).toEqual([]);
    expect(blind.unchecked.map((line) => line.family)).toEqual(["schedules"]);
  });

  it("takes an operation at the edge of the window, and leaves out the one a millisecond before it", () => {
    const edge = (started: number) =>
      rules(attention(reads({ restores: succeeded([restore("edge", "Failed", started)], now) }), now, "24h"));

    expect(edge(DAY)).toEqual([["A10", "edge"]]);
    expect(edge(DAY + 1000)).toEqual([]);
    // An operation the clock of this machine is behind of is of the window.
    expect(edge(-5 * MINUTE)).toEqual([["A10", "edge"]]);
  });

  it("has every rule of the table, and no other", () => {
    expect(RULES).toEqual(["A1", "A2", "A3", "A4", "A5", "A6", "A7", "A8", "A9", "A10"]);
    expect(GROUP_TITLES).toEqual({
      "in-flight": "In flight",
      storage: "Storage",
      schedules: "Schedules",
      ended: "Ended",
    });
  });

  it("keeps a fixed order: what is in flight, the storage, the schedules, what ended", () => {
    const found = attention(
      reads({
        backups: succeeded(
          [backup("by-hand", "Failed", 2 * HOUR), backup("waiting", "FinalizingPartiallyFailed", 3 * DAY)],
          now,
        ),
        restores: succeeded([restore("failed", "Failed", HOUR)], now),
        schedules: succeeded([schedule("b-unread", {}, null), schedule("a-unread", {}, null)], now),
        storageLocations: succeeded(
          [
            location("z-old", { default: true }, { phase: "Available", lastValidationTime: ago(3 * DAY) }),
            object("a-silent", { provider: "aws" }, undefined),
            location("m-old", {}, { phase: "Available", lastValidationTime: ago(2 * DAY) }),
          ],
          now,
        ),
      }),
      now,
      "7d",
    );

    expect(found.items.map(({ group, rule, name }) => [group, rule, name])).toEqual([
      ["in-flight", "A9", "waiting"],
      // The storage by name: the time of its items moves at every validation.
      ["storage", "A2", "a-silent"],
      ["storage", "A3", "m-old"],
      ["storage", "A3", "z-old"],
      // From the newest, and by name where there is no time.
      ["schedules", "A6", "a-unread"],
      ["schedules", "A6", "b-unread"],
      ["ended", "A10", "failed"],
      ["ended", "A10", "by-hand"],
    ]);
    // An item that a read again adds is added in its place: the others keep theirs.
    const before = found.items.map((entry) => entry.name);
    const more = attention(
      reads({
        backups: succeeded(
          [backup("by-hand", "Failed", 2 * HOUR), backup("waiting", "FinalizingPartiallyFailed", 3 * DAY)],
          now,
        ),
        restores: succeeded([restore("failed", "Failed", HOUR), restore("later", "Failed", 90 * MINUTE)], now),
        schedules: succeeded([schedule("b-unread", {}, null), schedule("a-unread", {}, null)], now),
        storageLocations: succeeded(
          [
            location("z-old", { default: true }, { phase: "Available", lastValidationTime: ago(3 * DAY) }),
            object("a-silent", { provider: "aws" }, undefined),
            location("m-old", {}, { phase: "Available", lastValidationTime: ago(2 * DAY) }),
          ],
          now,
        ),
      }),
      now,
      "7d",
    ).items.map((entry) => entry.name);

    expect(more.filter((name) => name !== "later")).toEqual(before);
    expect(more.indexOf("later")).toBe(more.indexOf("failed") + 1);
  });

  it("gives items only from what was read, and one line for each family that was not", () => {
    const found = attention(
      reads({
        backups: succeeded([backup("nightly-1", "Failed", HOUR, { schedule: "nightly" })], now),
        restores: denied(),
        schedules: succeeded(
          [schedule("nightly"), schedule("to-removed", { template: { storageLocation: "removed" } })],
          now,
        ),
        storageLocations: failed(emptyRead(), "failed"),
      }),
      now,
      "7d",
    );

    // No item of a restore, and no item that needs the storage locations: the schedule whose template
    // names one that may not be there is not said to name one that is not.
    expect(rules(found)).toEqual([["A7", "nightly"]]);
    expect(found.unchecked).toEqual([
      {
        family: "restores",
        kind: "restore",
        reason: "The restores of this installation cannot be read: access is denied",
        missing:
          "Whether a restore in flight carries a failure, and whether one ended with a failure, were not checked",
      },
      {
        family: "storageLocations",
        kind: "storage-location",
        reason: "The backup storage locations of this installation could not be read",
        missing:
          "The availability of the storage locations, their last validation, the default and the locations the schedules name were not checked",
      },
    ]);
    expect(attentionSummary(found)).toBe("1 item in what was read. Not everything was read.");
    // The backups denied: the newest backup of a schedule is not known, and no schedule is said to have
    // one that failed.
    const blind = attention(reads({ backups: denied(), schedules: succeeded([schedule("nightly")], now) }), now, "7d");

    expect(blind.items).toEqual([]);
    expect(blind.unchecked.map((line) => line.family)).toEqual(["backups"]);
    expect(attentionSummary(blind)).toBe("Nothing in what was read needs attention. Not everything was read.");
    // The snapshot locations are read by no rule: that they were not read is said where what was read is.
    expect(attention(reads({ snapshotLocations: denied() }), now, "7d")).toEqual({
      items: [],
      unchecked: [],
      earlier: [],
    });
    expect(
      attentionSummary({
        items: [item(found, "A7", "nightly"), item(found, "A7", "nightly")],
        unchecked: [],
        earlier: [],
      }),
    ).toBe("2 items in what was read.");
  });

  it("says that nothing was read when no family the rules look at was, and what is of an earlier read", () => {
    const blind = attention(
      reads({ backups: denied(), restores: denied(), schedules: denied(), storageLocations: emptyRead() }),
      now,
      "7d",
    );

    expect(blind.items).toEqual([]);
    expect(blind.unchecked).toHaveLength(4);
    expect(attentionSummary(blind)).toBe(
      "Nothing was read of what the rules look at: what needs attention is not known.",
    );
    // The storage of an earlier read, with no item: what was looked at is not what is there now.
    const earlier = attention(reads({ storageLocations: stale([fine]) }), now - MINUTE, "7d");

    expect(earlier.items).toEqual([]);
    expect(earlier.earlier).toEqual(["storageLocations"]);
    expect(attentionSummary(earlier)).toBe(
      "Nothing in what was read needs attention. Part of it was read before the last read, which did not succeed.",
    );
    expect(
      attentionSummary(
        attention(reads({ restores: denied(), schedules: stale([schedule("unread", {}, null)]) }), now, "7d"),
      ),
    ).toBe(
      "1 item in what was read. Not everything was read. Part of it was read before the last read, which did not succeed.",
    );
  });

  it("reads the objects of a name in the namespace and of the kind they are of", () => {
    const elsewhere = <Resource extends { metadata: object }>(resource: Resource) =>
      frozen({ ...resource, metadata: { ...resource.metadata, namespace: "velero-b" } }) as Resource;
    const found = attention(
      reads({
        // The newest backup that carries the name of the schedule is of another namespace, and failed.
        backups: succeeded(
          [
            backup("nightly-1", "Completed", 2 * HOUR, { schedule: "nightly" }),
            elsewhere(backup("nightly-2", "Failed", HOUR, { schedule: "nightly" })),
          ],
          now,
        ),
        schedules: succeeded(
          [schedule("nightly"), schedule("to-archive", { template: { storageLocation: "archive" } })],
          now,
        ),
        // The location the template names is fine here, and the one of that name elsewhere is not. The one
        // of elsewhere is the first that was read: the name alone would find it.
        storageLocations: succeeded(
          [
            elsewhere(location("archive", {}, { phase: "Unavailable", lastValidationTime: ago(30_000) })),
            fine,
            location("archive"),
          ],
          now,
        ),
      }),
      now,
      "7d",
    );

    expect(rules(found).filter(([rule]) => rule === "A7" || rule === "A8")).toEqual([]);
    // A schedule and a storage location of the same name: the rules of one are not the ones of the other.
    const same = reads({
      schedules: succeeded([schedule("nightly")], now),
      storageLocations: succeeded(
        [fine, location("nightly", {}, { phase: "Unavailable", lastValidationTime: ago(30_000) })],
        now,
      ),
    });
    const named = attention(same, now, "7d");
    const schedules = scheduleLines(same, now, named);
    const locations = locationLines(same, now, named);

    expect(rules(named)).toEqual([["A1", "nightly"]]);
    expect(schedules.state === "listed" && schedules.items.map((line) => [line.view.name, line.rules])).toEqual([
      ["nightly", []],
    ]);
    expect(locations.state === "listed" && locations.items.map((line) => [line.view.name, line.rules])).toEqual([
      ["nightly", ["A1"]],
      ["default", []],
    ]);
  });

  it("says of the items of a read that is not the last one that they were read before", () => {
    const found = attention(
      reads({
        backups: stale([
          backup("nightly-1", "Failed", HOUR, { schedule: "nightly" }),
          backup("by-hand", "Failed", HOUR),
        ]),
        schedules: succeeded([schedule("nightly"), schedule("unread", {}, null)], now),
        storageLocations: stale([object("silent", { provider: "aws", default: true }, undefined)]),
      }),
      now,
      "7d",
    );

    expect(found.items.map(({ rule, name, stale: before }) => [rule, name, before])).toEqual([
      ["A2", "silent", true],
      ["A4", "silent", true],
      // The schedule was read, and its newest backup is of the read before. What has a time is before
      // what has none.
      ["A7", "nightly", true],
      ["A6", "unread", false],
      ["A10", "by-hand", true],
    ]);
    // What is of an earlier read was read: it is not a family that could not be checked.
    expect(found.unchecked).toEqual([]);
  });

  it("never gives a value of the whole, and never the words of a verdict", () => {
    const found = attention(
      reads({
        backups: succeeded(
          BACKUP_PHASES.map((phase, index) => backup(`b-${index}`, phase, HOUR)),
          now,
        ),
        restores: succeeded(
          RESTORE_PHASES.map((phase, index) => restore(`r-${index}`, phase, HOUR)),
          now,
        ),
        schedules: succeeded([schedule("unread", {}, null), schedule("nightly")], now),
        storageLocations: succeeded([location("a"), object("silent", { provider: "aws" }, undefined)], now),
      }),
      now,
      "30d",
    );
    const words = JSON.stringify([
      found,
      attentionSummary(found),
      attentionSummary({ items: [], unchecked: [], earlier: [] }),
      COMPLETED_NOTE,
    ]);

    expect(found.items.length).toBeGreaterThan(5);
    expect(words).not.toMatch(/healthy|protected|\bsafe\b|all is well|\bscore\b|%/i);
    expect(Object.keys(found)).toEqual(["items", "unchecked", "earlier"]);
  });
});

describe("operations in flight", () => {
  it("lists the backups and the restores in flight in every phase, from the oldest", () => {
    const found = inFlight(
      reads({
        backups: succeeded(
          [
            backup("new", "New", 0, { created: 10 * MINUTE }),
            backup("queued", "Queued", 0, { created: 3 * HOUR }),
            backup("ready", "ReadyToStart", 0, { created: 20 * MINUTE }),
            backup("running", "InProgress", 2 * HOUR),
            backup("waiting", "WaitingForPluginOperations", 5 * HOUR),
            backup("waiting-failing", "WaitingForPluginOperationsPartiallyFailed", 4 * HOUR),
            backup("finalizing", "Finalizing", HOUR),
            backup("finalizing-failing", "FinalizingPartiallyFailed", 30 * MINUTE),
            backup("done", "Completed", 6 * HOUR),
            backup("failed", "Failed", 6 * HOUR),
            backup("refused", "FailedValidation", 0, { created: 6 * HOUR }),
            backup("deleting", "Deleting", 6 * HOUR),
          ],
          now,
        ),
        restores: succeeded(
          [restore("restoring", "InProgress", 90 * MINUTE), restore("restored", "Completed", DAY)],
          now,
        ),
      }),
      now,
    );

    expect(found.items.map((operation) => [operation.kind, operation.view.name])).toEqual([
      ["backup", "waiting"],
      ["backup", "waiting-failing"],
      ["backup", "queued"],
      ["backup", "running"],
      ["restore", "restoring"],
      ["backup", "finalizing"],
      ["backup", "finalizing-failing"],
      ["backup", "ready"],
      ["backup", "new"],
    ]);
    // One that waits has no start: it is at the time it was created, and has no elapsed time.
    const queued = found.items.find((operation) => operation.view.name === "queued");

    expect(queued?.time).toEqual({ of: "creation", time: now - 3 * HOUR });
    expect(queued?.view.duration).toEqual({ state: "unavailable", reason: "not-started" });
    expect(found.items.find((operation) => operation.view.name === "running")?.view.duration).toEqual({
      state: "running",
      milliseconds: 2 * HOUR,
      start: now - 2 * HOUR,
    });
  });

  it("says that none is in flight, and that what was not read is not known", () => {
    const none = inFlight(reads({ backups: succeeded([backup("done", "Completed", HOUR)], now) }), now);

    expect(none).toEqual({
      backups: { state: "listed", stale: false, at: now, items: [] },
      restores: { state: "listed", stale: false, at: now, items: [] },
      items: [],
    });
    const partly = inFlight(
      reads({ backups: denied(), restores: stale([restore("restoring", "InProgress", HOUR)]) }),
      now,
    );

    expect(partly.backups).toEqual({
      state: "inaccessible",
      reason: "The backups of this installation cannot be read: access is denied",
    });
    expect(partly.restores).toMatchObject({ state: "listed", stale: true, at: now - MINUTE });
    expect(partly.items.map((operation) => operation.view.name)).toEqual(["restoring"]);
  });
});

describe("newest completed backup", () => {
  const backups = succeeded(
    [
      backup("old", "Completed", 3 * DAY),
      backup("newest", "Completed", 2 * HOUR, { schedule: "nightly" }),
      backup("nightly-old", "Completed", 2 * DAY, { schedule: "nightly" }),
      // Later than every one that completed, and not completed.
      backup("failed", "Failed", HOUR, { schedule: "nightly" }),
      backup("partly", "PartiallyFailed", 30 * MINUTE),
      backup("running", "InProgress", 10 * MINUTE),
      backup("weekly-1", "Failed", DAY, { schedule: "weekly" }),
    ],
    now,
  );

  it("is the one that completed last, of the installation and of each schedule", () => {
    const found = newestCompleted(backups, now);

    expect(found).toMatchObject({ state: "found", stale: false, completed: now - 2 * HOUR + 5 * MINUTE });
    expect(found.state === "found" && found.backup.name).toBe("newest");
    const nightly = newestCompleted(backups, now, { name: "nightly", namespace: A });

    expect(nightly.state === "found" && nightly.backup.name).toBe("newest");
    // None among the backups that exist, which is not that none was ever made.
    expect(newestCompleted(backups, now, { name: "weekly", namespace: A })).toEqual({ state: "none", stale: false });
    expect(newestCompleted(backups, now, { name: "nightly", namespace: "velero-b" })).toEqual({
      state: "none",
      stale: false,
    });
    expect(newestCompleted(succeeded([], now), now)).toEqual({ state: "none", stale: false });
    expect(COMPLETED_NOTE).toBe(
      "Completed is what Velero reports of a backup. It is not a test of a restore: nothing here says that a backup can be restored.",
    );
  });

  it("goes by the time of the completion, and not by the one of the start", () => {
    const long = object<BackupResource>(
      "long",
      {},
      { phase: "Completed", startTimestamp: ago(10 * HOUR), completionTimestamp: ago(HOUR) },
    );
    const short = object<BackupResource>(
      "short",
      {},
      { phase: "Completed", startTimestamp: ago(3 * HOUR), completionTimestamp: ago(2 * HOUR) },
    );
    const silent = object<BackupResource>("silent", {}, { phase: "Completed", startTimestamp: ago(MINUTE) });
    const found = newestCompleted(succeeded([short, silent, long], now), now);

    expect(found.state === "found" && [found.backup.name, found.completed]).toEqual(["long", now - HOUR]);
    // One that completed and does not say when is after the ones that say it, and is shown without a time.
    const alone = newestCompleted(succeeded([silent], now), now);

    expect(alone.state === "found" && alone.backup.name).toBe("silent");
    expect("completed" in alone).toBe(false);
  });

  it("is not known when the backups were not read, and is of an earlier read when the last one failed", () => {
    expect(newestCompleted(denied(), now)).toEqual({
      state: "inaccessible",
      reason: "The backups of this installation cannot be read: access is denied",
    });
    expect(newestCompleted(emptyRead(), now).state).toBe("not-read");
    expect(newestCompleted(stale(backups.items), now)).toMatchObject({ state: "found", stale: true });
    expect(newestCompleted(stale<BackupResource>([]), now)).toEqual({ state: "none", stale: true });
  });
});

describe("recent operations", () => {
  const found = (window: "24h" | "7d" | "30d", more: Partial<OverviewReads> = {}) =>
    recent(
      reads({
        backups: succeeded(
          [
            backup("hour", "Completed", HOUR),
            backup("days", "Failed", 3 * DAY),
            backup("weeks", "Completed", 20 * DAY),
            backup("months", "Completed", 40 * DAY),
            // It did not start: it is at the time it was created.
            backup("refused", "FailedValidation", 0, { created: 2 * HOUR }),
            object<BackupResource>("timeless", {}, { phase: "Completed" }, { creationTimestamp: "soon" }),
          ],
          now,
        ),
        restores: succeeded([restore("restored", "Completed", 2 * DAY), restore("old", "Failed", 35 * DAY)], now),
        ...more,
      }),
      now,
      window,
    );
  const names = (window: "24h" | "7d" | "30d") => found(window).items.map((operation) => operation.view.name);

  it("holds the operations whose time is in the window, from the newest, in two rows", () => {
    expect(names("24h")).toEqual(["hour", "refused"]);
    expect(names("7d")).toEqual(["hour", "refused", "restored", "days"]);
    expect(names("30d")).toEqual(["hour", "refused", "restored", "days", "weeks"]);
    const week = found("7d");

    expect(week).toMatchObject({ window: "7d", from: now - 7 * DAY, untimed: 1 });
    expect(week.backups.state === "listed" && week.backups.items.map((operation) => operation.view.name)).toEqual([
      "hour",
      "days",
      "refused",
    ]);
    expect(week.restores.state === "listed" && week.restores.items.map((operation) => operation.view.name)).toEqual([
      "restored",
    ]);
    expect(week.items.find((operation) => operation.view.name === "refused")?.time).toEqual({
      of: "creation",
      time: now - 2 * HOUR,
    });
  });

  it("keeps the row that was read when the other was not", () => {
    const partly = found("7d", { restores: denied() });

    expect(partly.restores).toEqual({
      state: "inaccessible",
      reason: "The restores of this installation cannot be read: access is denied",
    });
    expect(partly.items.map((operation) => operation.view.name)).toEqual(["hour", "refused", "days"]);
  });

  it("draws the two rows on one line, which begins where the window does", () => {
    const week = found("7d");
    const items = (row: typeof week.backups) => (row.state === "listed" ? row.items : []);
    const backups = operationLine(items(week.backups), now, 700, { from: week.from });
    const restores = operationLine(items(week.restores), now, 700, { from: week.from });

    expect([backups?.from, backups?.to, restores?.from, restores?.to]).toEqual([week.from, now, week.from, now]);
    expect(backups?.marks.map((mark) => [mark.items.map((operation) => operation.view.name), mark.at])).toEqual([
      [["days"], 4 / 7],
      // An hour apart on a line of a week: one mark, from the newest, which says that one of them failed.
      [["hour", "refused"], (7 * DAY - 2 * HOUR) / (7 * DAY)],
    ]);
    expect(backups?.marks[1]).toMatchObject({ failing: true, notStarted: true });
    expect(restores?.marks.map((mark) => mark.at)).toEqual([5 / 7]);
    // A row with nothing in it is a line with no mark: nothing is drawn where no operation is.
    expect(operationLine([], now, 700, { from: week.from })).toEqual({
      from: week.from,
      to: now,
      marks: [],
      undrawn: [],
    });
    // What is before the beginning of the line is not of the line.
    expect(
      operationLine(items(found("30d").backups), now, 700, { from: week.from })?.marks.flatMap((mark) => mark.items),
    ).toHaveLength(3);
    // The two rows end at the same time, which is the newest operation when the cluster is ahead.
    expect(operationLine(items(week.restores), now, 700, { from: week.from, to: now + HOUR })?.to).toBe(now + HOUR);
  });
});

describe("lines of the schedules and of the storage locations", () => {
  it("shows ten lines at most, the ones a rule names first, then by name, with the number of the others", () => {
    const names = Array.from({ length: 12 }, (_, index) => `schedule-${String(index + 1).padStart(2, "0")}`);
    const all = reads({
      schedules: succeeded(
        names.map((name) =>
          name === "schedule-11"
            ? schedule(name, {}, null)
            : name === "schedule-07"
              ? schedule(name, {}, { phase: "FailedValidation", validationErrors: ["x"] })
              : schedule(name),
        ),
        now,
      ),
      backups: succeeded(
        [
          backup("schedule-01-a", "Completed", DAY, { schedule: "schedule-01" }),
          backup("schedule-01-b", "Completed", HOUR, { schedule: "schedule-01" }),
        ],
        now,
      ),
    });
    const found = scheduleLines(all, now, attention(all, now, "7d"));

    expect(LINES).toBe(10);
    if (found.state !== "listed") throw new Error("The schedules were read");
    expect(found.items.map((line) => line.view.name)).toEqual([
      "schedule-07",
      "schedule-11",
      ...names.filter((name) => !["schedule-07", "schedule-11"].includes(name)).slice(0, 8),
    ]);
    expect(found.others).toBe(2);
    expect(found.items.slice(0, 3).map((line) => line.rules)).toEqual([["A5"], ["A6"], []]);
    // Each line has the newest completed of its backups, or none among the backups that exist.
    const first = found.items.find((line) => line.view.name === "schedule-01")?.newestCompleted;

    expect(first?.state === "found" && first.backup.name).toBe("schedule-01-b");
    expect(found.items.find((line) => line.view.name === "schedule-02")?.newestCompleted).toEqual({
      state: "none",
      stale: false,
    });
  });

  it("has a line for each storage location, and none for the ones that were not read", () => {
    const all = reads({
      storageLocations: succeeded(
        [
          fine,
          location("archive", { accessMode: "ReadOnly" }),
          location("broken", {}, { phase: "Unavailable", lastValidationTime: ago(3 * DAY) }),
        ],
        now,
      ),
    });
    const found = locationLines(all, now, attention(all, now, "7d"));

    if (found.state !== "listed") throw new Error("The storage locations were read");
    expect(found.items.map((line) => [line.view.name, line.rules])).toEqual([
      ["broken", ["A1", "A3"]],
      ["archive", []],
      ["default", []],
    ]);
    expect(found).toMatchObject({ others: 0, stale: false });
    const blind = reads({ storageLocations: denied(), schedules: failed(emptyRead(), "not-served") });

    expect(locationLines(blind, now, attention(blind, now, "7d"))).toEqual({
      state: "inaccessible",
      reason: "The backup storage locations of this installation cannot be read: access is denied",
    });
    expect(scheduleLines(blind, now, attention(blind, now, "7d"))).toEqual({
      state: "unknown",
      reason: "The cluster does not serve the schedules",
    });
    const before = reads({ schedules: stale([schedule("nightly")]), backups: denied() });
    const lines = scheduleLines(before, now, attention(before, now, "7d"));

    expect(lines).toMatchObject({ state: "listed", stale: true });
    expect(lines.state === "listed" && lines.items[0].newestCompleted.state).toBe("inaccessible");
  });
});
