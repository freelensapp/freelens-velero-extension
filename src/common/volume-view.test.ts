import { describe, expect, it } from "vitest";
import {
  backup,
  before,
  MINUTE,
  NOW,
  ownedBy,
  podVolumeBackup,
  podVolumeRestore,
  read,
  restore,
} from "../../test/volume-builders";
import { bytesProgress } from "./progress";
import { mapEntries, unknownFields, VOLUME_SORTING, volumeSearch, volumeView } from "./volume-view";
import { bytesText, bytesTip, incrementalText, NOT_REPORTED, POD_NOT_NAMED } from "./volume-words";

const MiB = 1_048_576;

describe("the bytes of an operation", () => {
  it.each([
    // progress, state, reason, percentage, words
    [{ bytesDone: 512 * MiB, totalBytes: 1024 * MiB }, "measured", undefined, 50, "512.0 MiB of 1.0 GiB (50%)"],
    [{ bytesDone: 1023, totalBytes: 1024 }, "measured", undefined, 99, "1023 B of 1.0 KiB (99%)"],
    [{ bytesDone: 3 * MiB, totalBytes: 3 * MiB }, "measured", undefined, 100, "3.0 MiB of 3.0 MiB (100%)"],
    // The release leaves a count out when it is zero: a total that is missing is none, and bytes done are not over it.
    [{ bytesDone: 5 * MiB }, "indeterminate", "no-total", undefined, "5.0 MiB done, no total"],
    [{ totalBytes: 2 * MiB }, "measured", undefined, 0, "0 B of 2.0 MiB (0%)"],
    [{}, "indeterminate", "no-total", undefined, "No total reported"],
    [
      { bytesDone: 3 * MiB, totalBytes: 2 * MiB },
      "indeterminate",
      "over-total",
      undefined,
      "3.0 MiB of 2.0 MiB, over the total",
    ],
    [undefined, "indeterminate", "not-reported", undefined, NOT_REPORTED],
    [null, "indeterminate", "not-reported", undefined, NOT_REPORTED],
    [{ bytesDone: 1.5, totalBytes: 2 }, "indeterminate", "invalid", undefined, "Reported 1.5 of 2 bytes"],
    [{ bytesDone: -1, totalBytes: 2 }, "indeterminate", "invalid", undefined, "Reported -1 of 2 bytes"],
    [{ bytesDone: "10", totalBytes: 20 }, "indeterminate", "invalid", undefined, "Reported 10 of 20 bytes"],
  ])("of %j are %s", (progress, state, reason, percentage, words) => {
    const found = bytesProgress(progress as never);

    expect([found.state, found.reason, found.percentage, bytesText(found)]).toEqual([state, reason, percentage, words]);
    expect(Number.isNaN(found.percentage)).toBe(false);
    expect(bytesText(found)).not.toContain("NaN");
  });

  it("are read whole in the tip, as they are counted", () => {
    expect(bytesTip(bytesProgress({ bytesDone: 1, totalBytes: 2048 }))).toBe("1 byte of 2048 bytes");
    expect(bytesTip(bytesProgress(undefined))).toBeUndefined();
  });

  it("do not say zero bytes of a progress that carries nothing", () => {
    expect(bytesText(bytesProgress({}))).not.toMatch(/\b0 B\b/);
  });
});

describe("the incremental size and the snapshot size", () => {
  it("is the incremental size of a pod volume backup when it carries one, and not reported otherwise, never zero", () => {
    const owner = backup("nightly", "Completed");
    const reads = { backups: read([owner]), restores: read([]) };
    const carried = volumeView(
      "PodVolumeBackup",
      podVolumeBackup("nightly-x7k2p", { phase: "Completed", incrementalBytes: 2 * MiB }),
      NOW,
      reads,
    );
    const missing = volumeView("PodVolumeBackup", podVolumeBackup("nightly-q9w3e", { phase: "Completed" }), NOW, reads);

    expect(incrementalText(carried.incremental?.value)).toBe("2.0 MiB");
    expect(incrementalText(missing.incremental?.value)).toBe(NOT_REPORTED);
    expect(carried.snapshotSize).toBeUndefined();
  });

  it("is nothing of an incremental size for a pod volume restore, and its snapshot size is the logical one", () => {
    const view = volumeView("PodVolumeRestore", podVolumeRestore("monday-a1b2c", { phase: "Completed" }), NOW, {
      backups: read([]),
      restores: read([]),
    });

    expect(view.incremental).toBeUndefined();
    expect(view.snapshotSize).toEqual({ value: MiB });
  });
});

describe("the view of an operation", () => {
  const nightly = backup("nightly", "InProgress", { uid: "backup-nightly-1" });
  const monday = restore("monday", "InProgress", { uid: "restore-monday-1" });
  const reads = { backups: read([nightly]), restores: read([monday]) };

  it("reads the node of a pod volume backup from its spec, and of a pod volume restore from its status", () => {
    const backed = volumeView(
      "PodVolumeBackup",
      podVolumeBackup(
        "nightly-x7k2p",
        { phase: "InProgress", startTimestamp: before(MINUTE) },
        ownedBy("Backup", nightly),
      ),
      NOW,
      reads,
    );
    const restored = volumeView(
      "PodVolumeRestore",
      podVolumeRestore("monday-a1b2c", { phase: "Accepted", node: "worker-2" }, ownedBy("Restore", monday)),
      NOW,
      reads,
    );

    expect([backed.node, restored.node]).toEqual(["worker-1", "worker-2"]);
    expect(volumeView("PodVolumeRestore", podVolumeRestore("legacy", { phase: "Completed" }), NOW, reads).node).toBe(
      undefined,
    );
    expect([backed.source, restored.source]).toEqual(["shop/cart-0, data", "shop-restored/cart-0, data"]);
    expect([backed.owner.reference?.state, restored.owner.reference?.state]).toEqual(["resolved", "resolved"]);
    expect(
      volumeView("PodVolumeBackup", podVolumeBackup("odd", undefined, { spec: { pod: null, volume: "" } }), NOW, reads)
        .source,
    ).toBe(POD_NOT_NAMED);
  });

  it("is searched by what its columns show and by the message of Velero", () => {
    const view = volumeView(
      "PodVolumeBackup",
      podVolumeBackup(
        "nightly-x7k2p",
        { phase: "Failed", message: "data path failed: disk full" },
        { ...ownedBy("Backup", nightly), spec: { uploaderType: "" } },
      ),
      NOW,
      reads,
    );

    expect(volumeSearch(view)).toEqual([
      "nightly-x7k2p",
      "velero",
      "Failed",
      "Failed",
      "data path failed: disk full",
      "nightly",
      "shop/cart-0, data",
      "worker-1",
      "Not reported",
      "Not started",
      "No time written",
      "default",
      "Not set",
    ]);
    // The progress, the start and the duration the columns show are searched as they show them.
    const moved = volumeView(
      "PodVolumeBackup",
      podVolumeBackup(
        "nightly-moved",
        { phase: "InProgress", progress: { bytesDone: 536_870_912, totalBytes: 1_073_741_824 } },
        ownedBy("Backup", nightly),
      ),
      NOW,
      reads,
    );

    expect(volumeSearch(moved)).toContain("512.0 MiB of 1.0 GiB (50%)");
  });

  it("is ordered by callbacks that answer a number, a text or an array, never undefined or NaN", () => {
    const views = [
      podVolumeBackup("a", undefined, { spec: { node: "", backupStorageLocation: "" } }),
      podVolumeBackup("b", {
        phase: "InProgress",
        startTimestamp: before(MINUTE),
        progress: { bytesDone: 1, totalBytes: 4 },
      }),
      podVolumeBackup("c", { phase: "Odd", progress: { bytesDone: Number.NaN } as never }),
      podVolumeBackup("d", { phase: "Completed", startTimestamp: "soon", completionTimestamp: before(0) }),
    ].map((operation) => volumeView("PodVolumeBackup", operation, NOW, reads));

    for (const [column, order] of Object.entries(VOLUME_SORTING)) {
      for (const view of views) {
        const value = [order(view)].flat();

        expect([column, value.some((part) => part === undefined || Number.isNaN(part))]).toEqual([column, false]);
      }
    }
    // What has no node or no start is last in the first order a click gives.
    expect(views.map(VOLUME_SORTING.node)).toEqual([
      [1, ""],
      [0, "worker-1"],
      [0, "worker-1"],
      [0, "worker-1"],
    ]);
    expect(views.map(VOLUME_SORTING.started)).toEqual([
      [1, 0],
      [0, NOW - MINUTE],
      [1, 0],
      [1, 0],
    ]);
    expect(views.map(VOLUME_SORTING.bytes)).toEqual([
      [-1, -1],
      [25, 1],
      [-1, -1],
      [-1, -1],
    ]);
  });

  it("names the fields the reviewed release does not write, and the keys of its maps by their characters", () => {
    const later = podVolumeBackup("later", { phase: "Completed", activities: [] } as never, {
      spec: { parentSnapshot: "a" } as never,
    });

    expect(unknownFields("PodVolumeBackup", later)).toEqual(["spec.parentSnapshot", "status.activities"]);
    expect(unknownFields("PodVolumeBackup", podVolumeBackup("plain", { phase: "New" }))).toEqual([]);
    expect(mapEntries({ volume: "data", backup: "nightly", n: 3 })).toEqual([
      { key: "backup", value: "nightly" },
      { key: "n", value: "3" },
      { key: "volume", value: "data" },
    ]);
    expect(mapEntries(null)).toEqual([]);
  });
});
