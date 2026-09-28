import { describe, expect, it } from "vitest";
import { emptyRead, failed, failedStatus, hasItems, isStale, loading, succeeded } from "./read-state";
import { backupReferences, resolveReference, restoreReferences, sameObject } from "./references";
import { LABELS } from "./types";

import type { FamilyRead } from "./read-state";
import type { InstallationReads, RestoreReads } from "./references";
import type {
  BackupResource,
  BackupStorageLocationResource,
  RestoreResource,
  ScheduleResource,
  VolumeSnapshotLocationResource,
} from "./types";

const now = Date.parse("2026-09-01T10:30:00Z");

function frozen<Value>(value: Value): Value {
  if (value && typeof value === "object") {
    for (const inner of Object.values(value)) frozen(inner);
    Object.freeze(value);
  }
  return value;
}

function object<Spec>(name: string, namespace: string, uid: string, spec?: Spec) {
  return { metadata: { name, namespace, uid }, ...(spec ? { spec } : {}) };
}

function reads(overrides: Partial<InstallationReads> = {}): InstallationReads {
  return frozen({
    schedules: succeeded<ScheduleResource>([object("nightly", "velero-demo", "schedule-demo")], now),
    storageLocations: succeeded<BackupStorageLocationResource>(
      [object("default", "velero-demo", "location-demo"), object("default", "velero-other", "location-other")],
      now,
    ),
    snapshotLocations: succeeded<VolumeSnapshotLocationResource>([], now),
    restores: succeeded<RestoreResource>(
      [
        object("restore-one", "velero-demo", "restore-one", { backupName: "nightly-1" }),
        object("restore-two", "velero-demo", "restore-two", { backupName: "nightly-1" }),
        object("restore-of-another", "velero-demo", "restore-three", { backupName: "nightly-2" }),
        object("restore-elsewhere", "velero-other", "restore-four", { backupName: "nightly-1" }),
        object("restore-without-source", "velero-demo", "restore-five"),
      ],
      now,
    ),
    ...overrides,
  });
}

const backup: BackupResource = frozen({
  metadata: {
    name: "nightly-1",
    namespace: "velero-demo",
    uid: "backup-demo",
    labels: { [LABELS.schedule]: "nightly", [LABELS.storageLocation]: "default" },
  },
  spec: { storageLocation: "default", volumeSnapshotLocations: ["snapshots"] },
});

describe("what is known of a family of resources", () => {
  it("reads the status of a failure from its code and from nothing else", () => {
    expect(failedStatus(403)).toBe("forbidden");
    expect(failedStatus(401)).toBe("forbidden");
    expect(failedStatus(404)).toBe("not-served");
    for (const code of [500, 503, 0, undefined, null, "403", "Forbidden", "forbidden: access denied"]) {
      expect(failedStatus(code)).toBe("failed");
    }
  });

  it("keeps what was read when the next read does not succeed", () => {
    const first = succeeded([object("one", "velero-demo", "uid-one")], now);
    const asking = loading(first);
    const denied = failed(asking, "forbidden");

    expect(first).toEqual({ status: "ready", items: [first.items[0]], lastSuccess: now });
    expect(denied).toEqual({ status: "forbidden", items: first.items, lastSuccess: now });
    expect(isStale(first)).toBe(false);
    expect(isStale(asking)).toBe(false);
    expect(isStale(denied)).toBe(true);
    expect(hasItems(denied)).toBe(true);
  });

  it("keeps what the last read said of a family while the family is asked again", () => {
    const first = succeeded([object("one", "velero-demo", "uid-one")], now);
    const denied = failed(first, "forbidden");
    const never = failed(emptyRead<unknown>(), "forbidden");

    // What was read is not of an earlier read until a read fails.
    expect(loading(first)).toEqual({ status: "ready", items: first.items, lastSuccess: now, reading: true });
    // What was denied, not served or failed stays so until a read says otherwise.
    expect(loading(denied)).toEqual({ status: "forbidden", items: first.items, lastSuccess: now, reading: true });
    expect(loading(never)).toEqual({ status: "forbidden", items: [], lastSuccess: undefined, reading: true });
    expect(loading(failed(first, "failed")).status).toBe("failed");
    expect(loading(failed(first, "not-served")).status).toBe("not-served");
    expect(isStale(loading(denied))).toBe(true);
    expect(hasItems(loading(never))).toBe(false);
    // Only a family that was never answered is loading, and it stays so while it is asked again.
    expect(loading(emptyRead())).toEqual({ status: "loading", items: [], lastSuccess: undefined });
    expect(loading(loading(emptyRead()))).toEqual({ status: "loading", items: [], lastSuccess: undefined });
    // The read that ends says what it found, and that nothing is being asked.
    expect(succeeded([], now + 1)).toEqual({ status: "ready", items: [], lastSuccess: now + 1 });
    expect("reading" in failed(loading(first), "failed")).toBe(false);
    expect(loading(loading(first))).toEqual(loading(first));
  });

  it("resolves a reference the same way while its family is asked again", () => {
    const ready = succeeded([object("default", "velero-demo", "uid-default")], now);
    const denied = failed(emptyRead<ReturnType<typeof object>>(), "forbidden");

    for (const name of ["default", "gone"]) {
      expect(resolveReference("BackupStorageLocation", name, "velero-demo", loading(ready))).toEqual(
        resolveReference("BackupStorageLocation", name, "velero-demo", ready),
      );
      expect(resolveReference("BackupStorageLocation", name, "velero-demo", loading(denied))).toEqual(
        resolveReference("BackupStorageLocation", name, "velero-demo", denied),
      );
    }
    expect(resolveReference("BackupStorageLocation", "default", "velero-demo", loading(ready))).toMatchObject({
      state: "resolved",
      stale: false,
      reason: "",
    });
    expect(resolveReference("BackupStorageLocation", "default", "velero-demo", loading(denied)).state).toBe(
      "inaccessible",
    );
  });

  it("has no number of items for a family that was never read", () => {
    const never = failed(emptyRead<unknown>(), "forbidden");

    expect(emptyRead()).toEqual({ status: "idle", items: [] });
    expect(never).toEqual({ status: "forbidden", items: [], lastSuccess: undefined });
    expect(hasItems(never)).toBe(false);
    expect(hasItems(emptyRead())).toBe(false);
    expect(hasItems(loading(emptyRead()))).toBe(false);
    expect(isStale(never)).toBe(false);
    // An empty list that was read is a number: zero.
    expect(hasItems(succeeded([], now))).toBe(true);
  });
});

describe("references of a backup", () => {
  it("resolves schedule, storage and restores by names and labels, without owner references", () => {
    const references = backupReferences(backup, reads());

    expect(references.schedule).toEqual({
      kind: "Schedule",
      name: "nightly",
      namespace: "velero-demo",
      state: "resolved",
      uid: "schedule-demo",
      stale: false,
      reason: "",
    });
    expect(references.storageLocation).toMatchObject({ state: "resolved", uid: "location-demo" });
    expect(references.restores).toMatchObject({ state: "listed", stale: false });
    expect(
      references.restores.state === "listed" ? references.restores.items.map((item) => item.metadata.name) : [],
    ).toEqual(["restore-one", "restore-two"]);
  });

  it("stays inside the namespace of the backup when another installation has the same names", () => {
    const elsewhere = frozen({ ...backup, metadata: { ...backup.metadata, namespace: "velero-other", uid: "other" } });
    const references = backupReferences(elsewhere, reads());

    expect(references.storageLocation).toMatchObject({ state: "resolved", uid: "location-other" });
    expect(references.schedule).toMatchObject({ state: "absent", namespace: "velero-other" });
    expect(references.schedule?.uid).toBeUndefined();
    expect(
      references.restores.state === "listed" ? references.restores.items.map((item) => item.metadata.name) : [],
    ).toEqual(["restore-elsewhere"]);
  });

  it("calls absent only what a list that was read does not hold", () => {
    const references = backupReferences(backup, reads());

    expect(references.volumeSnapshotLocations).toEqual([
      {
        kind: "VolumeSnapshotLocation",
        name: "snapshots",
        namespace: "velero-demo",
        state: "absent",
        stale: false,
        reason: "No volume snapshot location of this name in velero-demo",
      },
    ]);
  });

  it.each([
    ["forbidden", "inaccessible", "access is denied"],
    ["not-served", "unknown", "does not serve"],
    ["failed", "unknown", "could not be read"],
    ["idle", "not-read", "not read yet"],
    ["loading", "not-read", "not read yet"],
  ] as const)("does not call absent the target of a family that is %s", (status, state, reason) => {
    const family = { status, items: [] } as FamilyRead<never>;
    const references = backupReferences(
      backup,
      reads({ schedules: family, storageLocations: family, snapshotLocations: family, restores: family }),
    );

    for (const reference of [references.schedule, references.storageLocation, references.volumeSnapshotLocations[0]]) {
      expect(reference?.state).toBe(state);
      expect(reference?.reason).toContain(reason);
      expect(reference?.uid).toBeUndefined();
    }
    expect(references.restores.state).toBe(state);
    expect("items" in references.restores).toBe(false);
  });

  it("does not show zero restores when their list was denied", () => {
    const references = backupReferences(backup, reads({ restores: failed(emptyRead(), "forbidden") }));

    expect(references.restores).toEqual({
      state: "inaccessible",
      reason: "The restores of this installation cannot be read: access is denied",
    });
  });

  it("shows zero restores when their list was read and holds none of the backup", () => {
    expect(backupReferences(backup, reads({ restores: succeeded([], now) })).restores).toEqual({
      state: "listed",
      stale: false,
      items: [],
    });
  });

  it("keeps what an earlier read found, and says that it is of an earlier read", () => {
    const before = reads();
    const references = backupReferences(
      backup,
      reads({
        schedules: failed(before.schedules, "failed"),
        restores: failed(before.restores, "forbidden"),
        storageLocations: failed(succeeded([], now), "failed"),
      }),
    );

    expect(references.schedule).toMatchObject({ state: "resolved", uid: "schedule-demo", stale: true });
    expect(references.schedule?.reason).not.toBe("");
    expect(references.restores).toMatchObject({ state: "listed", stale: true });
    // Not found in a list of before: it may have been created since.
    expect(references.storageLocation).toMatchObject({ state: "unknown", stale: false });
  });

  it("names no schedule for a backup that has none, and no storage for one that reports none", () => {
    const manual = frozen({ metadata: { name: "manual", namespace: "velero-demo", uid: "manual" } });
    const references = backupReferences(manual, reads());

    expect("schedule" in references).toBe(false);
    expect("storageLocation" in references).toBe(false);
    expect(references.volumeSnapshotLocations).toEqual([]);
    expect(references.restores).toMatchObject({ state: "listed", items: [] });
  });

  it("falls back on the label of the storage when the spec does not name it", () => {
    const labelled = frozen({
      metadata: { name: "labelled", namespace: "velero-demo", labels: { [LABELS.storageLocation]: "default" } },
      spec: {},
    });

    expect(backupReferences(labelled, reads()).storageLocation).toMatchObject({ name: "default", state: "resolved" });
  });

  it("ignores names that are not names", () => {
    const odd = frozen({
      metadata: { name: "odd", namespace: "velero-demo", labels: { [LABELS.schedule]: "" } },
      spec: { storageLocation: "", volumeSnapshotLocations: ["", 7, null, "snapshots"] },
    }) as unknown as BackupResource;
    const references = backupReferences(odd, reads());

    expect("schedule" in references).toBe(false);
    expect("storageLocation" in references).toBe(false);
    expect(references.volumeSnapshotLocations.map((reference) => reference.name)).toEqual(["snapshots"]);
  });

  it("resolves one object by name inside one namespace", () => {
    const family = succeeded([object("default", "velero-demo", "one"), object("default", "velero-other", "two")], now);

    expect(resolveReference("BackupStorageLocation", "default", "velero-other", family).uid).toBe("two");
    expect(resolveReference("BackupStorageLocation", "default", "velero-third", family).state).toBe("absent");
    expect(resolveReference("BackupStorageLocation", "Default", "velero-demo", family).state).toBe("absent");
  });

  it("tells an object from one created later with its name", () => {
    const first = object("nightly-1", "velero-demo", "first");

    expect(sameObject(first, object("nightly-1", "velero-demo", "first"))).toBe(true);
    expect(sameObject(first, object("nightly-1", "velero-demo", "second"))).toBe(false);
    // Without the two identifiers nothing says that they are the same.
    expect(sameObject(first, { metadata: { name: "nightly-1", namespace: "velero-demo" } })).toBe(false);
  });
});

describe("references of a restore", () => {
  const sources = (overrides: Partial<RestoreReads> = {}): RestoreReads =>
    frozen({
      backups: succeeded<BackupResource>(
        [
          backup,
          object("nightly-1", "velero-other", "backup-other", { storageLocation: "elsewhere" }),
          { metadata: { name: "by-label", namespace: "velero-demo", labels: { [LABELS.storageLocation]: "default" } } },
          object("no-location", "velero-demo", "backup-bare"),
        ],
        now,
      ),
      schedules: succeeded<ScheduleResource>([object("nightly", "velero-demo", "schedule-demo")], now),
      storageLocations: succeeded<BackupStorageLocationResource>(
        [object("default", "velero-demo", "location-demo"), object("elsewhere", "velero-other", "location-other")],
        now,
      ),
      ...overrides,
    });
  const restore = (spec?: RestoreResource["spec"], namespace = "velero-demo"): RestoreResource =>
    frozen({ metadata: { name: "restore-1", namespace, uid: "restore-demo" }, ...(spec ? { spec } : {}) });

  it("resolves the backup, the schedule and the storage location of the backup by their names", () => {
    const found = restoreReferences(restore({ backupName: "nightly-1", scheduleName: "nightly" }), sources());

    expect(found.backup).toMatchObject({ kind: "Backup", state: "resolved", uid: "backup-demo", stale: false });
    expect(found.schedule).toMatchObject({ kind: "Schedule", state: "resolved", uid: "schedule-demo" });
    expect(found.storageLocation).toMatchObject({
      kind: "BackupStorageLocation",
      name: "default",
      state: "resolved",
      uid: "location-demo",
    });
  });

  it("stays inside the namespace of the restore when another installation has the same names", () => {
    const found = restoreReferences(restore({ backupName: "nightly-1" }, "velero-other"), sources());

    expect(found.backup).toMatchObject({ state: "resolved", uid: "backup-other", namespace: "velero-other" });
    expect(found.storageLocation).toMatchObject({ name: "elsewhere", state: "resolved", uid: "location-other" });
  });

  it("names no source for a restore that names none, and makes none up from the schedule", () => {
    expect(restoreReferences(restore(), sources())).toEqual({});
    expect(restoreReferences(restore({ backupName: "", scheduleName: "" }), sources())).toEqual({});
    const asked = restoreReferences(restore({ scheduleName: "nightly" }), sources());

    expect(asked.schedule?.state).toBe("resolved");
    expect(asked.backup).toBeUndefined();
    expect(asked.storageLocation).toBeUndefined();
  });

  it("calls absent a backup that a list that was read does not hold, and knows no storage through it", () => {
    const found = restoreReferences(restore({ backupName: "expired", scheduleName: "removed" }), sources());

    expect(found.backup).toMatchObject({ state: "absent", reason: "No backup of this name in velero-demo" });
    expect(found.schedule).toMatchObject({ state: "absent" });
    expect(found.storageLocation).toBeUndefined();
  });

  it.each([
    ["forbidden", "inaccessible", "access is denied"],
    ["not-served", "unknown", "does not serve"],
    ["failed", "unknown", "could not be read"],
  ] as const)("does not call absent a backup whose list was %s", (status, state, reason) => {
    const found = restoreReferences(
      restore({ backupName: "nightly-1", scheduleName: "nightly" }),
      sources({ backups: failed(emptyRead<BackupResource>(), status) }),
    );

    expect(found.backup).toMatchObject({ state });
    expect(found.backup?.reason).toContain(reason);
    // The schedule has its own list, which was read.
    expect(found.schedule?.state).toBe("resolved");
    expect(found.storageLocation).toBeUndefined();
  });

  it("keeps a backup that an earlier read found, and says that it is of an earlier read", () => {
    const earlier = sources().backups;
    const found = restoreReferences(
      restore({ backupName: "nightly-1" }),
      sources({ backups: failed(earlier, "failed") }),
    );

    expect(found.backup).toMatchObject({ state: "resolved", stale: true });
    expect(found.storageLocation).toMatchObject({ state: "resolved", stale: false });
  });

  it("reads the storage location from the label of the backup when its spec names none, or knows none", () => {
    expect(restoreReferences(restore({ backupName: "by-label" }), sources()).storageLocation).toMatchObject({
      name: "default",
      state: "resolved",
    });
    expect(restoreReferences(restore({ backupName: "no-location" }), sources()).storageLocation).toBeUndefined();
  });

  it("tells a storage location that is denied from one that is not there", () => {
    const denied = restoreReferences(
      restore({ backupName: "nightly-1" }),
      sources({ storageLocations: failed(emptyRead<BackupStorageLocationResource>(), "forbidden") }),
    );
    const removed = restoreReferences(
      restore({ backupName: "nightly-1" }),
      sources({ storageLocations: succeeded<BackupStorageLocationResource>([], now) }),
    );

    expect(denied.storageLocation?.state).toBe("inaccessible");
    expect(removed.storageLocation?.state).toBe("absent");
  });
});
