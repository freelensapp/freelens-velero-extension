import { describe, expect, it } from "vitest";
import {
  locationUsers,
  MAY_BE_SENT_BY_DEFAULT,
  REFUSED_WHEN_NOT_AVAILABLE,
  SENT_BY_DEFAULT,
  usingBackupsText,
} from "./location-users";
import { emptyRead, failed, loading, succeeded } from "./read-state";
import { backupLocation, backupReferences } from "./references";

import type { Defaults } from "./location-view";
import type { FamilyRead } from "./read-state";
import type { BackupResource, ScheduleResource } from "./types";

const now = Date.parse("2026-09-10T12:00:00Z");
const A = "velero-a";
const B = "velero-b";

function frozen<Value>(value: Value): Value {
  if (value && typeof value === "object") {
    for (const inner of Object.values(value)) frozen(inner);
    Object.freeze(value);
  }
  return value;
}

function backup(name: string, spec: object, status?: object, namespace = A): BackupResource {
  return frozen({
    metadata: { name, namespace, uid: `uid-${name}`, creationTimestamp: "2026-09-01T00:00:00Z" },
    spec,
    ...(status ? { status } : {}),
  }) as BackupResource;
}

function schedule(name: string, template: object | undefined, namespace = A): ScheduleResource {
  return frozen({
    metadata: { name, namespace, uid: `uid-${name}` },
    spec: { schedule: "0 3 * * *", ...(template ? { template } : {}) },
  }) as ScheduleResource;
}

const ran = (date: string, phase = "Completed", more: object = {}) => ({
  phase,
  startTimestamp: `${date}T03:00:00Z`,
  ...(phase === "InProgress" ? {} : { completionTimestamp: `${date}T03:05:00Z` }),
  ...more,
});
const backups = succeeded(
  [
    backup("first", { storageLocation: "default", volumeSnapshotLocations: ["snapshots"] }, ran("2026-09-07")),
    backup("second", { storageLocation: "default" }, ran("2026-09-08", "PartiallyFailed", { errors: 2 })),
    backup(
      "running",
      { storageLocation: "default", volumeSnapshotLocations: ["snapshots", "others"] },
      ran("2026-09-09", "InProgress"),
    ),
    // The newest: it failed its validation, and has no start time.
    {
      ...backup(
        "refused",
        { storageLocation: "default" },
        { phase: "FailedValidation", validationErrors: ["refused"] },
      ),
      metadata: { name: "refused", namespace: A, uid: "uid-refused", creationTimestamp: "2026-09-10T03:00:00Z" },
    },
    backup("archived", { storageLocation: "archive" }, ran("2026-09-01")),
    backup("elsewhere", { storageLocation: "default", volumeSnapshotLocations: ["snapshots"] }, ran("2026-09-09"), B),
    backup("unnamed", {}, ran("2026-09-02")),
  ],
  now,
);
const schedules = succeeded(
  [
    schedule("nightly", { storageLocation: "default", volumeSnapshotLocations: ["snapshots"] }),
    schedule("weekly", { storageLocation: "archive" }),
    schedule("bare", undefined),
    schedule("unnamed", { includedNamespaces: ["shop"] }),
    schedule("elsewhere", { storageLocation: "default" }, B),
  ],
  now,
);
const location = (name: string, namespace = A) => ({ metadata: { name, namespace } });

describe("what uses a location", () => {
  it("counts the backups that name a storage location by how they ended, with the newest of them", () => {
    const users = locationUsers("storage", location("default"), { backups, schedules }, now);

    expect(users.backups).toMatchObject({
      state: "listed",
      stale: false,
      counts: { total: 4, completed: 1, failed: 2, inFlight: 1, inFlightFailing: 0, unknown: 0 },
    });
    // The newest is the one that never started, at the time it was created.
    expect(users.backups.state === "listed" && users.backups.newest?.view.name).toBe("refused");
    expect(users.backups.state === "listed" && users.backups.newest?.time).toEqual({
      of: "creation",
      time: Date.parse("2026-09-10T03:00:00Z"),
    });
    expect(users.schedules).toEqual({ state: "listed", stale: false, names: ["nightly"] });
  });

  it("finds what uses a snapshot location through the snapshot locations a backup or a template names", () => {
    const users = locationUsers("snapshot", location("snapshots"), { backups, schedules }, now);

    expect(users.backups.state === "listed" && users.backups.counts).toMatchObject({
      total: 2,
      completed: 1,
      inFlight: 1,
    });
    expect(users.backups.state === "listed" && users.backups.newest?.view.name).toBe("running");
    expect(users.schedules).toEqual({ state: "listed", stale: false, names: ["nightly"] });
    // The name of a storage location is not the name of a snapshot location.
    expect(locationUsers("snapshot", location("default"), { backups, schedules }, now).backups).toMatchObject({
      counts: { total: 0 },
    });
  });

  it("takes the location of a backup as the view of the backup does: its spec, or the label the release writes", () => {
    const labelled = {
      ...backup("labelled", {}, ran("2026-09-09")),
      metadata: {
        name: "labelled",
        namespace: A,
        uid: "uid-labelled",
        creationTimestamp: "2026-09-09T00:00:00Z",
        labels: { "velero.io/storage-location": "archive" },
      },
    } as BackupResource;
    const both = {
      ...backup("both", { storageLocation: "default" }, ran("2026-09-09")),
      metadata: {
        name: "both",
        namespace: A,
        uid: "uid-both",
        creationTimestamp: "2026-09-09T00:00:00Z",
        labels: { "velero.io/storage-location": "archive" },
      },
    } as BackupResource;
    const read = succeeded([labelled, both], now);
    const named = (name: string) => {
      const users = locationUsers("storage", location(name), { backups: read, schedules }, now);

      return users.backups.state === "listed" ? users.backups.counts.total : undefined;
    };

    // The backup that carries the label alone is of the location of the label; the one that names a
    // location in its spec is of that one, whatever its label says.
    expect([named("archive"), named("default")]).toEqual([1, 1]);
    expect([backupLocation(labelled), backupLocation(both)]).toEqual(["archive", "default"]);
    // The same location the view of the backup leads to.
    const reads = {
      backups: read,
      restores: emptyRead<never>(),
      schedules,
      storageLocations: emptyRead<never>(),
      snapshotLocations: emptyRead<never>(),
    };

    expect(backupReferences(labelled, reads as never).storageLocation?.name).toBe("archive");
    expect(backupReferences(both, reads as never).storageLocation?.name).toBe("default");
  });

  it("says which schedules name no location, of a storage location that is marked default and of no other", () => {
    const reads = { backups, schedules };
    const one: Defaults = { state: "one", names: ["default"] };
    const many: Defaults = { state: "many", names: ["archive", "default"], kept: "default" };

    expect(locationUsers("storage", location("default"), reads, now, one).byDefault).toEqual({
      schedules: { state: "listed", stale: false, names: ["bare", "unnamed"] },
      certain: true,
    });
    // With more than one marked the backups go to the first of them the release finds: it is said of each.
    for (const name of ["archive", "default"]) {
      expect(locationUsers("storage", location(name), reads, now, many).byDefault).toMatchObject({
        schedules: { names: ["bare", "unnamed"] },
        certain: false,
      });
    }
    // A location that is not marked, a snapshot location, and a view that was given no mark.
    expect(locationUsers("storage", location("archive"), reads, now, one).byDefault).toBeUndefined();
    expect(locationUsers("snapshot", location("default"), reads, now, one).byDefault).toBeUndefined();
    expect(locationUsers("storage", location("default"), reads, now).byDefault).toBeUndefined();
    expect(
      locationUsers("storage", location("default"), reads, now, { state: "none", names: [] }).byDefault,
    ).toBeUndefined();
    // The ones of another installation are not among them, and what was not read is not none.
    expect(locationUsers("storage", location("default", B), reads, now, one).byDefault?.schedules).toMatchObject({
      names: [],
    });
    expect(
      locationUsers(
        "storage",
        location("default"),
        { backups, schedules: failed(emptyRead<ScheduleResource>(), "forbidden") },
        now,
        one,
      ).byDefault?.schedules,
    ).toMatchObject({ state: "inaccessible" });
    expect(SENT_BY_DEFAULT).toContain("which is this one");
    expect(MAY_BE_SENT_BY_DEFAULT).toContain("the first of them the release finds");
  });

  it("does not count the backups and the schedules of another installation", () => {
    const users = locationUsers("storage", location("default", B), { backups, schedules }, now);

    expect(users.backups.state === "listed" && users.backups.counts.total).toBe(1);
    expect(users.backups.state === "listed" && users.backups.newest?.view.name).toBe("elsewhere");
    expect(users.schedules).toEqual({ state: "listed", stale: false, names: ["elsewhere"] });
  });

  it("says that nothing names a location that nothing names, which is not that it is not known", () => {
    const users = locationUsers("storage", location("unused"), { backups, schedules }, now);

    expect(users.backups).toEqual({
      state: "listed",
      stale: false,
      counts: { total: 0, completed: 0, failed: 0, inFlight: 0, inFlightFailing: 0, unknown: 0 },
    });
    expect("newest" in users.backups).toBe(false);
    expect(users.schedules).toEqual({ state: "listed", stale: false, names: [] });
    expect(usingBackupsText({ total: 0, completed: 0, failed: 0, inFlight: 0, inFlightFailing: 0, unknown: 0 })).toBe(
      "No backup that exists names this location",
    );
  });

  it.each([
    ["forbidden", "inaccessible", "access is denied"],
    ["not-served", "unknown", "does not serve"],
    ["failed", "unknown", "could not be read"],
  ] as const)("does not say none of what was %s", (status, state, reason) => {
    const denied = failed(emptyRead<never>(), status);
    const users = locationUsers("storage", location("default"), { backups: denied, schedules: denied }, now);

    expect(users.backups).toMatchObject({ state, reason: expect.stringContaining(reason) });
    expect(users.schedules).toMatchObject({ state, reason: expect.stringContaining(reason) });
    expect(JSON.stringify(users)).not.toMatch(/"total":0|"names":\[\]/);
    // The two are apart: what is denied of the one takes nothing from the other.
    const partly = locationUsers("storage", location("default"), { backups: denied, schedules }, now);

    expect(partly.backups.state).toBe(state);
    expect(partly.schedules).toEqual({ state: "listed", stale: false, names: ["nightly"] });
  });

  it("is not read before its families are, and is of an earlier read when the last one failed", () => {
    const idle = emptyRead<never>();
    const stale: FamilyRead<BackupResource> = failed(backups, "failed");

    expect(locationUsers("storage", location("default"), { backups: idle, schedules: idle }, now)).toEqual({
      backups: { state: "not-read", reason: "The backups of this installation were not read yet" },
      schedules: { state: "not-read", reason: "The schedules of this installation were not read yet" },
    });
    expect(
      locationUsers("storage", location("default"), { backups: loading(idle), schedules: loading(idle) }, now).backups
        .state,
    ).toBe("not-read");
    expect(locationUsers("storage", location("default"), { backups: stale, schedules }, now).backups).toMatchObject({
      state: "listed",
      stale: true,
      counts: { total: 4 },
    });
    // What is asked again is what the last read said.
    expect(
      locationUsers("storage", location("default"), { backups: loading(backups), schedules }, now).backups,
    ).toEqual(locationUsers("storage", location("default"), { backups, schedules }, now).backups);
  });

  it("says in words how many backups name the location and how they ended", () => {
    const users = locationUsers("storage", location("default"), { backups, schedules }, now);

    expect(users.backups.state === "listed" && usingBackupsText(users.backups.counts)).toBe(
      "4 backups that exist: 1 completed; 2 ended with a failure; 1 in flight",
    );
    expect(usingBackupsText({ total: 1, completed: 0, failed: 0, inFlight: 1, inFlightFailing: 1, unknown: 0 })).toBe(
      "1 backup that exists: 1 in flight, 1 of them with a failure",
    );
    expect(REFUSED_WHEN_NOT_AVAILABLE).toContain("refuses the backups sent to a storage location");
    expect(REFUSED_WHEN_NOT_AVAILABLE).toContain("the restores of the backups the location holds");
  });

  it("stands names that are not names, and does not change what it reads", () => {
    const odd = succeeded(
      [
        backup("odd", { storageLocation: 7, volumeSnapshotLocations: "snapshots" }),
        backup("list", { volumeSnapshotLocations: [null, 3, "snapshots"] }),
        frozen({ metadata: { name: "bare", namespace: A } }) as BackupResource,
      ],
      now,
    );
    const users = locationUsers("snapshot", location("snapshots"), { backups: odd, schedules }, now);

    expect(users.backups.state === "listed" && users.backups.counts.total).toBe(1);
    expect(() => locationUsers("storage", location("default"), { backups, schedules }, now)).not.toThrow();
  });
});
