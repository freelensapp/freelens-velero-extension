import { describe, expect, it } from "vitest";
import {
  backup,
  before,
  MINUTE,
  ownedBy,
  podVolumeBackup,
  podVolumeRestore,
  read,
  repository,
  restore,
} from "../../test/volume-builders";
import { labelOf } from "./name-label";
import { ownerKey, repositoryKey, volumeIndex } from "./volume-index";

import type { FamilyRead } from "./read-state";
import type { PodVolumeBackupResource, PodVolumeRestoreResource } from "./types";

const nightly = backup("nightly", "InProgress", { uid: "backup-nightly-2" });
const monday = restore("monday", "InProgress", { uid: "restore-monday-1" });

function index(
  backups: PodVolumeBackupResource[],
  restores: PodVolumeRestoreResource[] = [],
): ReturnType<typeof volumeIndex> {
  return volumeIndex({ podVolumeBackups: read(backups), podVolumeRestores: read(restores) });
}

const names = (items: readonly { metadata: { name: string } }[] | undefined) =>
  items?.map((item) => item.metadata.name);

describe("the index of the operations of the volumes", () => {
  it("finds the operations of a backup and of a restore by the label of the UID, from the newest", () => {
    const made = index(
      [
        podVolumeBackup(
          "nightly-old",
          { phase: "Completed", startTimestamp: before(30 * MINUTE) },
          ownedBy("Backup", nightly),
        ),
        podVolumeBackup(
          "nightly-new",
          { phase: "InProgress", startTimestamp: before(MINUTE) },
          ownedBy("Backup", nightly),
        ),
        // No start: its creation is its time, a day ago.
        podVolumeBackup("nightly-waiting", { phase: "New" }, ownedBy("Backup", nightly)),
      ],
      [podVolumeRestore("monday-x", { phase: "Accepted" }, ownedBy("Restore", monday))],
    );

    expect(names(made.ofBackup.get(ownerKey("velero", "backup-nightly-2")))).toEqual([
      "nightly-new",
      "nightly-old",
      "nightly-waiting",
    ]);
    expect(names(made.ofRestore.get(ownerKey("velero", "restore-monday-1")))).toEqual(["monday-x"]);
    // A backup and a restore are told apart by the label each kind writes, never by a UID alone.
    expect(made.ofBackup.get(ownerKey("velero", "restore-monday-1"))).toBeUndefined();
  });

  it("orders the operations of a restore from the newest as well, whatever their names", () => {
    const made = index(
      [],
      [
        podVolumeRestore(
          "monday-a",
          { phase: "Completed", startTimestamp: before(9 * MINUTE) },
          ownedBy("Restore", monday),
        ),
        podVolumeRestore(
          "monday-b",
          { phase: "InProgress", startTimestamp: before(MINUTE) },
          ownedBy("Restore", monday),
        ),
      ],
    );

    expect(names(made.ofRestore.get(ownerKey("velero", "restore-monday-1")))).toEqual(["monday-b", "monday-a"]);
  });

  it("leaves out of an owner an operation with no label of a UID, one of another namespace, and one of another UID", () => {
    const labels = ownedBy("Backup", nightly);
    const made = index([
      podVolumeBackup("nightly-mine", { phase: "Completed" }, labels),
      // The labels of the name alone, and the owner reference: the band finds the operations by the label of the UID.
      podVolumeBackup(
        "nightly-no-uid",
        { phase: "Completed" },
        { labels: { "velero.io/backup-name": "nightly" }, ownerReferences: labels.ownerReferences },
      ),
      podVolumeBackup("nightly-elsewhere", { phase: "Completed" }, { ...labels, namespace: "velero-b" }),
      // The name of the backup, and the UID of the one that had the name before.
      podVolumeBackup(
        "nightly-before",
        { phase: "Completed" },
        { labels: { "velero.io/backup-name": "nightly", "velero.io/backup-uid": "backup-nightly-1" } },
      ),
    ]);

    expect(names(made.ofBackup.get(ownerKey("velero", "backup-nightly-2")))).toEqual(["nightly-mine"]);
    expect(names(made.ofBackup.get(ownerKey("velero-b", "backup-nightly-2")))).toEqual(["nightly-elsewhere"]);
    expect(names(made.ofBackup.get(ownerKey("velero", "backup-nightly-1")))).toEqual(["nightly-before"]);
    expect([...made.ofBackup.values()].flat()).toHaveLength(3);
  });

  it("finds what used a repository by its three labels, through the cut of a long name, and never by its name", () => {
    const at63 = `l${"o".repeat(61)}c`;
    const at64 = `l${"o".repeat(62)}c`;
    const kopia = repository("shop-default-kopia", { phase: "Ready" });
    const long = repository("shop-long-kopia", { phase: "Ready" }, { spec: { backupStorageLocation: at64 } });
    const whole = repository("shop-whole-kopia", { phase: "Ready" }, { spec: { backupStorageLocation: at63 } });
    const made = index(
      [
        podVolumeBackup(
          "nightly-a",
          { phase: "Completed", startTimestamp: before(2 * MINUTE) },
          ownedBy("Backup", nightly),
        ),
        podVolumeBackup("nightly-b", { phase: "Failed", startTimestamp: before(MINUTE) }, ownedBy("Backup", nightly)),
        // Another type and another location name other repositories.
        podVolumeBackup(
          "nightly-restic",
          { phase: "Completed" },
          { ...ownedBy("Backup", nightly), spec: { uploaderType: "restic" } },
        ),
        podVolumeBackup(
          "nightly-archive",
          { phase: "Completed" },
          { ...ownedBy("Backup", nightly), spec: { backupStorageLocation: "archive" } },
        ),
        podVolumeBackup(
          "nightly-long",
          { phase: "Completed" },
          { ...ownedBy("Backup", nightly), spec: { backupStorageLocation: at64 } },
        ),
        podVolumeBackup(
          "nightly-whole",
          { phase: "Completed" },
          { ...ownedBy("Backup", nightly), spec: { backupStorageLocation: at63 } },
        ),
      ],
      // The namespace of the volumes of a restore is its source namespace.
      [podVolumeRestore("monday-a", { phase: "Completed" }, ownedBy("Restore", monday))],
    );
    const used = (made_: typeof made, key: string | undefined) =>
      made_.usedBy.get(key ?? "")?.map((entry) => `${entry.kind}/${entry.operation.metadata.name}`);

    expect(used(made, repositoryKey(kopia))).toEqual([
      "PodVolumeBackup/nightly-b",
      "PodVolumeBackup/nightly-a",
      "PodVolumeRestore/monday-a",
    ]);
    // The labels of the repository hold the location cut as the release cuts one longer than 63 characters.
    expect(long.metadata.labels?.["velero.io/storage-location"]).toBe(at64);
    const cut = repository(
      "shop-long-kopia",
      { phase: "Ready" },
      {
        spec: { backupStorageLocation: at64 },
        labels: {
          "velero.io/volume-namespace": "shop",
          "velero.io/storage-location": labelOf(at64),
          "velero.io/repository-type": "kopia",
        },
      },
    );

    expect(labelOf(at64)).not.toBe(at64);
    expect(used(made, repositoryKey(cut))).toEqual(["PodVolumeBackup/nightly-long"]);
    // A label that holds the long name whole is not one the release writes: nothing names it.
    expect(used(made, repositoryKey(long))).toBeUndefined();
    expect(used(made, repositoryKey(whole))).toEqual(["PodVolumeBackup/nightly-whole"]);
  });

  it("names no repository that lacks one of the three labels", () => {
    expect(
      repositoryKey(repository("bare", { phase: "Ready" }, { labels: { "velero.io/volume-namespace": "shop" } })),
    ).toBe(undefined);
  });

  it("is made in one pass over each family", () => {
    const passes = { podVolumeBackups: 0, podVolumeRestores: 0 };
    // Each item read, by any way through the array: a loop, an index or a method of the array all read the items by
    // their index, so one pass reads each of them once, and a second pass reads them again.
    const reads = { podVolumeBackups: 0, podVolumeRestores: 0 };
    const counted = <Item>(family: keyof typeof passes, items: Item[]): FamilyRead<Item> => {
      const proxied = new Proxy(items, {
        get(target, key, receiver) {
          if (key === Symbol.iterator) passes[family] += 1;
          if (typeof key === "string" && /^\d+$/.test(key)) reads[family] += 1;
          return Reflect.get(target, key, receiver);
        },
      });

      return read(proxied);
    };

    volumeIndex({
      podVolumeBackups: counted("podVolumeBackups", [
        podVolumeBackup("nightly-a", { phase: "Completed" }, ownedBy("Backup", nightly)),
        podVolumeBackup("nightly-b", { phase: "Completed" }, ownedBy("Backup", nightly)),
      ]),
      podVolumeRestores: counted("podVolumeRestores", [
        podVolumeRestore("monday-a", { phase: "Completed" }, ownedBy("Restore", monday)),
      ]),
    });
    expect(passes).toEqual({ podVolumeBackups: 1, podVolumeRestores: 1 });
    expect(reads).toEqual({ podVolumeBackups: 2, podVolumeRestores: 1 });
  });
});
