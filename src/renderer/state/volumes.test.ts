import { runInAction } from "mobx";
import { describe, expect, it } from "vitest";
import { backup, NOW, ownedBy, podVolumeBackup, read } from "../../../test/volume-builders";
import { emptyPreferences, heldPreferences, RESOURCES } from "../../common/discovery";
import { rowKey } from "../../common/volume-band";
import { Installation } from "./installation";
import { volumesOf, volumeWaysOf } from "./volumes";

import type { Resource } from "./installation";

const nightly = backup("nightly", "InProgress", { uid: "backup-nightly-2" });

function installation() {
  return new Installation({
    cluster: { id: "cluster-a", name: "local-demo" },
    read: async () => ({ status: 404 }),
    now: () => NOW,
    storage: heldPreferences({ ...emptyPreferences(), selected: { "cluster-a": "velero" } }),
  });
}

// A read of the installation: each family it asks is stored as a new read, with a new array of items.
function stored(made: Installation, family: "podVolumeBackups" | "podVolumeRestores" | "backups", items: unknown[]) {
  runInAction(() => {
    made.reads = { ...made.reads, [family]: read(items as Resource[]) };
  });
}

describe("the index of the operations of an installation", () => {
  it("is made once for a read, and the same at every drawing and every tick of the clock until a read", () => {
    const made = installation();

    stored(made, "podVolumeBackups", [
      podVolumeBackup("nightly-a", { phase: "Completed" }, ownedBy("Backup", nightly)),
    ]);
    const first = volumesOf(made);

    expect(volumesOf(made)).toBe(first);
    expect(first.ofBackup.size).toBe(1);
    // A read of a family the index is not made of makes no new one.
    stored(made, "backups", [nightly]);
    expect(volumesOf(made)).toBe(first);
    // A read of a family it is made of does, even with the same objects in a new array.
    stored(made, "podVolumeBackups", [...made.reads.podVolumeBackups.items]);
    const second = volumesOf(made);

    expect(second).not.toBe(first);
    expect(volumesOf(made)).toBe(second);
    stored(made, "podVolumeRestores", []);
    expect(volumesOf(made)).not.toBe(second);
  });

  it("is made again when the availability of the API changes what a read is said to be", () => {
    const made = installation();
    const first = volumesOf(made);

    runInAction(() => {
      made.api = {
        state: "served",
        resources: Object.values(RESOURCES).filter((name) => name !== "podvolumebackups"),
        missing: ["podVolumeBackups"],
      };
    });
    const second = volumesOf(made);

    expect(second).not.toBe(first);
    expect(second.reads.podVolumeBackups.status).toBe("not-served");
  });

  it("is of one installation: another one has its own", () => {
    const one = installation();
    const other = installation();

    expect(volumesOf(one)).not.toBe(volumesOf(other));
  });
});

describe("the ways of the Volumes tab of an installation", () => {
  it("are the same object at a read that leads to the same operations, and a new one when they change", () => {
    const made = installation();
    const a = podVolumeBackup("nightly-a", { phase: "InProgress" }, ownedBy("Backup", nightly));

    stored(made, "podVolumeBackups", [a]);
    const first = volumeWaysOf(made, "Backup", nightly.metadata);

    expect([...first]).toEqual([[rowKey("shop", "cart-0", "data"), { kind: "pod-volume-backup", name: "nightly-a" }]]);
    // A tick, then a read that changes the phase and nothing of the ways.
    expect(volumeWaysOf(made, "Backup", nightly.metadata)).toBe(first);
    stored(made, "podVolumeBackups", [{ ...a, status: { phase: "Completed" } }]);
    expect(volumesOf(made)).not.toBe(undefined);
    expect(volumeWaysOf(made, "Backup", nightly.metadata)).toBe(first);
    // A read that brings another operation of the owner changes them.
    stored(made, "podVolumeBackups", [
      a,
      podVolumeBackup("nightly-b", { phase: "New" }, { ...ownedBy("Backup", nightly), spec: { volume: "cache" } }),
    ]);
    const second = volumeWaysOf(made, "Backup", nightly.metadata);

    expect(second).not.toBe(first);
    expect(second.size).toBe(2);
    // Another owner has its own.
    expect(volumeWaysOf(made, "Backup", { namespace: "velero", uid: "backup-weekly-1" }).size).toBe(0);
  });
});
