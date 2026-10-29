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
  repository,
  restore,
} from "../../test/volume-builders";
import { operationState } from "./phases";
import { backupBand, phaseGroups, repositoryUses, restoreBand, rowKey, volumeWays } from "./volume-band";
import { volumeIndex } from "./volume-index";
import { bandSentence } from "./volume-words";

import type { ReadStatus } from "./read-state";
import type { PodVolumeBackupResource, PodVolumeRestoreResource } from "./types";

const nightly = backup("nightly", "InProgress", { uid: "backup-nightly-2" });
const monday = restore("monday", "InProgress", { uid: "restore-monday-1" });

function index(
  backups: PodVolumeBackupResource[],
  restores: PodVolumeRestoreResource[] = [],
  status: { backups?: ReadStatus; restores?: ReadStatus } = {},
) {
  return volumeIndex({
    podVolumeBackups: read(backups, status.backups),
    podVolumeRestores: read(restores, status.restores),
  });
}

const phased = (phase: string | undefined, name: string) =>
  podVolumeBackup(name, phase === undefined ? undefined : { phase }, ownedBy("Backup", nightly));
const restored = (phase: string | undefined, name: string) =>
  podVolumeRestore(name, phase === undefined ? undefined : { phase }, ownedBy("Restore", monday));

describe("the counts of the band by phase", () => {
  it("are in the groups of backup describe for a backup, with none and New together", () => {
    const operations = [
      phased("New", "a"),
      phased(undefined, "b"),
      phased("Accepted", "c"),
      phased("InProgress", "d"),
      phased("Failed", "e"),
      phased("Completed", "f"),
      phased("Completed", "g"),
      phased("Canceling", "h"),
      phased("Canceled", "i"),
      phased("Prepared", "j"),
      // A phase written empty, or as null, is none.
      podVolumeBackup("k", { phase: "" as never }, ownedBy("Backup", nightly)),
      podVolumeBackup("l", { phase: null as never }, ownedBy("Backup", nightly)),
    ];

    expect(
      phaseGroups("PodVolumeBackup", "Backup", operations).map((group) => [group.phase, group.label, group.count]),
    ).toEqual([
      ["Completed", "Completed", 2],
      ["Failed", "Failed", 1],
      ["Canceled", "Canceled", 1],
      ["InProgress", "In progress", 1],
      ["Canceling", "Canceling", 1],
      ["Prepared", "Prepared", 1],
      ["Accepted", "Accepted", 1],
      ["New", "New", 4],
    ]);
  });

  it("are in the groups of restore describe for a restore, Canceling and what the release does not write after them", () => {
    const operations = [
      restored("Failed", "a"),
      restored("Canceled", "b"),
      restored("Completed", "c"),
      restored("Canceling", "d"),
      restored("Paused", "e"),
      restored(undefined, "f"),
    ];
    const groups = phaseGroups("PodVolumeRestore", "Restore", operations);

    // Canceled before Failed, as restore describe prints them, which backup describe does the other way round.
    expect(groups.map((group) => [group.phase, group.label, group.count])).toEqual([
      ["Completed", "Completed", 1],
      ["Canceled", "Canceled", 1],
      ["Failed", "Failed", 1],
      ["New", "New", 1],
      ["Canceling", "Canceling", 1],
      ["Paused", "Unknown: Paused", 1],
    ]);
    // The phase the release does not write has the mark of what is not known.
    expect(groups.at(-1)?.state.recognized).toBe(false);
    // No operation is left out of the counts.
    expect(groups.reduce((sum, group) => sum + group.count, 0)).toBe(operations.length);
    expect(
      phaseGroups("PodVolumeBackup", "Backup", [phased("Failed", "x"), phased("Canceled", "y")]).map(
        (group) => group.phase,
      ),
    ).toEqual(["Failed", "Canceled"]);
  });
});

describe("the band of a backup and of a restore", () => {
  it("holds the operations of the owner from the newest, and none of another", () => {
    const other = backup("weekly", "Completed", { uid: "backup-weekly-1" });
    const made = index(
      [
        podVolumeBackup(
          "nightly-old",
          { phase: "Completed", startTimestamp: before(9 * MINUTE) },
          ownedBy("Backup", nightly),
        ),
        podVolumeBackup("nightly-new", { phase: "Failed", startTimestamp: before(MINUTE) }, ownedBy("Backup", nightly)),
        podVolumeBackup(
          "nightly-cut",
          { phase: "Canceled", startTimestamp: before(5 * MINUTE) },
          ownedBy("Backup", nightly),
        ),
        podVolumeBackup("weekly-a", { phase: "Completed" }, ownedBy("Backup", other)),
      ],
      [restored("Completed", "monday-a"), restored("Failed", "monday-b"), restored("Canceled", "monday-c")],
    );
    const band = backupBand(made, nightly, operationState("Backup", "InProgress"));

    expect([band.kind, band.operations.map((operation) => operation.metadata.name)]).toEqual([
      "PodVolumeBackup",
      ["nightly-new", "nightly-cut", "nightly-old"],
    ]);
    // The groups of backup describe: Failed before Canceled.
    expect(band.groups.map((group) => [group.phase, group.count])).toEqual([
      ["Completed", 1],
      ["Failed", 1],
      ["Canceled", 1],
    ]);
    // The read of the family is the one the band says the state of.
    expect(band.read).toBe(made.reads.podVolumeBackups);
    const ofRestore = restoreBand(made, monday, operationState("Restore", "Completed"));

    expect([ofRestore.kind, ofRestore.operations.map((operation) => operation.metadata.name)]).toEqual([
      "PodVolumeRestore",
      ["monday-a", "monday-b", "monday-c"],
    ]);
    // The groups of restore describe: Canceled before Failed.
    expect(ofRestore.groups.map((group) => group.phase)).toEqual(["Completed", "Canceled", "Failed"]);
    // A restore is not counted in the groups of a backup, nor a backup in the ones of a restore.
    expect(
      backupBand(
        made,
        backup("monday", "Completed", { uid: "restore-monday-1" }),
        operationState("Backup", "Completed"),
      ).operations,
    ).toEqual([]);
  });

  it("finds a backup synced from the store by the UID the sync rewrote, and says what the release does with it", () => {
    // The sync creates the pod volume backups of the store with the UID label rewritten to the synced backup.
    const synced = backup("nightly", "Completed", { uid: "backup-nightly-synced" });
    const made = index([
      podVolumeBackup("nightly-k2", { phase: "Completed" }, ownedBy("Backup", synced)),
      podVolumeBackup("nightly-k1", { phase: "Completed" }, ownedBy("Backup", nightly)),
    ]);
    const band = backupBand(made, synced, operationState("Backup", "Completed"));

    expect(band.operations.map((operation) => operation.metadata.name)).toEqual(["nightly-k2"]);
    expect(band.sentence).toBe(
      "The pod volume backups the installation holds of this backup are the ones its run made, or the ones a sync from the store made, in the phase they were stored in.",
    );
  });

  it("says what the release does with the pod volume operations by the phase of the backup or the restore", () => {
    const backups = (phase: string | undefined) => bandSentence("Backup", operationState("Backup", phase));
    const restores = (phase: string | undefined) => bandSentence("Restore", operationState("Restore", phase));

    expect(backups("InProgress")).toBe(
      "The pod volume backups run while the backup is InProgress: it waits for all of them, and at its own timeout asks the ones that have not ended to cancel.",
    );
    expect(backups("WaitingForPluginOperations")).toBe(
      "The pod volume backups ran while the backup was InProgress. It waits for its plugin operations, which is when its data uploads run.",
    );
    expect(backups("WaitingForPluginOperationsPartiallyFailed")).toBe(backups("WaitingForPluginOperations"));
    expect(backups("FinalizingPartiallyFailed")).toBe("The pod volume backups ran while the backup was InProgress.");
    expect(backups("New")).toBe(
      "The pod volume backups of a backup are made while it is InProgress: this one has not started.",
    );
    expect(backups(undefined)).toBe(backups("New"));
    expect(backups("Queued")).toBe(backups("New"));
    expect(backups("FailedValidation")).toBe(
      "The pod volume backups of a backup are made while it is InProgress: this one failed its validation, and did not run.",
    );
    for (const ended of ["Completed", "PartiallyFailed", "Failed"]) expect(backups(ended)).toBe(backups("Completed"));
    expect(backups("Deleting")).toBe("The backup is being deleted: its pod volume backups go with it.");
    expect(backups("Paused")).toBe(
      "The backup reports a phase the release does not write: what the release does with its pod volume backups is not known.",
    );
    expect(restores("InProgress")).toBe(
      "The node agent of the node of each restored pod takes its pod volume restore when the init container restore-wait of that pod runs.",
    );
    expect(restores("WaitingForPluginOperations")).toBe(
      "The restore waits for its plugin operations, which is when its data downloads run.",
    );
    expect(restores("Completed")).toBe(
      "The pod volume restores the installation holds of this restore are the ones its run made.",
    );
    expect(restores("New")).toBe(
      "The pod volume restores of a restore are made while it is InProgress: this one has not started.",
    );
    expect(restores("Paused")).toBe(
      "The restore reports a phase the release does not write: what the release does with its pod volume restores is not known.",
    );
    // The release writes no phase Deleting for a restore.
    expect(restores("Deleting")).toBe(restores("Paused"));
    // A phase the release does not write is not known, even when it begins as one it does.
    expect(backups("FinalizingSoon")).toBe(backups("Paused"));
    expect(restores("WaitingForPluginOperationsSoon")).toBe(restores("Paused"));
  });
});

describe("what used a repository", () => {
  const kopia = repository("shop-default-kopia", { phase: "Ready" });
  const reads = { backups: read([nightly]), restores: read([monday]) };

  it("is counted by kind and by phase, from the newest of each, with the backups and the restores they belong to", () => {
    const weekly = backup("weekly", "Completed", { uid: "backup-weekly-1" });
    const made = index(
      [
        podVolumeBackup(
          "nightly-a",
          { phase: "Completed", startTimestamp: before(3 * MINUTE) },
          ownedBy("Backup", nightly),
        ),
        podVolumeBackup("weekly-a", { phase: "Failed", startTimestamp: before(MINUTE) }, ownedBy("Backup", weekly)),
        podVolumeBackup(
          "nightly-b",
          { phase: "Completed", startTimestamp: before(2 * MINUTE) },
          ownedBy("Backup", nightly),
        ),
        // Another type and another location are other repositories.
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
      ],
      [restored("InProgress", "monday-a")],
    );
    const uses = repositoryUses(made, kopia, { ...reads, backups: read([nightly, weekly]) });

    expect(
      uses.map((use) => [
        use.kind,
        use.operations.map((operation) => operation.metadata.name),
        use.groups.map((group) => [group.phase, group.count]),
        use.owners.map((owner) => [owner.name, owner.state]),
      ]),
    ).toEqual([
      [
        "PodVolumeBackup",
        ["weekly-a", "nightly-b", "nightly-a"],
        [
          ["Completed", 2],
          ["Failed", 1],
        ],
        [
          ["weekly", "resolved"],
          ["nightly", "resolved"],
        ],
      ],
      ["PodVolumeRestore", ["monday-a"], [["InProgress", 1]], [["monday", "resolved"]]],
    ]);
  });

  it("counts the kinds it could read, and keeps the read of the one it could not, with no count", () => {
    const made = index([phased("Completed", "nightly-a")], [], { restores: "forbidden" });
    const uses = repositoryUses(made, kopia, reads);

    expect(uses.map((use) => [use.kind, use.read.status, use.operations.length])).toEqual([
      ["PodVolumeBackup", "ready", 1],
      ["PodVolumeRestore", "forbidden", 0],
    ]);
  });

  it("holds none of each kind when nothing names it", () => {
    const made = index([], []);

    expect(repositoryUses(made, kopia, reads).map((use) => [use.read.status, use.operations.length])).toEqual([
      ["ready", 0],
      ["ready", 0],
    ]);
  });
});

describe("the ways of the rows of the Volumes tab", () => {
  it("lead to the pod volume backup or restore of the owner by the namespace of the pod, the pod and the volume", () => {
    const made = index(
      [
        podVolumeBackup(
          "nightly-new",
          { phase: "Completed", startTimestamp: before(MINUTE) },
          ownedBy("Backup", nightly),
        ),
        // The same pod and volume, older: the newest is the way.
        podVolumeBackup(
          "nightly-old",
          { phase: "Failed", startTimestamp: before(9 * MINUTE) },
          ownedBy("Backup", nightly),
        ),
        podVolumeBackup(
          "nightly-cache",
          { phase: "Completed" },
          { ...ownedBy("Backup", nightly), spec: { volume: "cache" } },
        ),
      ],
      [restored("Completed", "monday-a")],
    );

    expect([...volumeWays(made, "Backup", nightly.metadata)]).toEqual([
      [rowKey("shop", "cart-0", "data"), { kind: "pod-volume-backup", name: "nightly-new" }],
      [rowKey("shop", "cart-0", "cache"), { kind: "pod-volume-backup", name: "nightly-cache" }],
    ]);
    expect([...volumeWays(made, "Restore", monday.metadata)]).toEqual([
      [rowKey("shop-restored", "cart-0", "data"), { kind: "pod-volume-restore", name: "monday-a" }],
    ]);
  });

  it("are none for another owner of the same pod and volume, and none when the family was denied", () => {
    const weekly = backup("weekly", "Completed", { uid: "backup-weekly-1" });
    const made = index([podVolumeBackup("nightly-a", { phase: "Completed" }, ownedBy("Backup", nightly))]);

    expect(volumeWays(made, "Backup", weekly.metadata).size).toBe(0);
    expect(volumeWays(made, "Backup", { namespace: "velero" }).size).toBe(0);
    expect(volumeWays(index([], [], { backups: "forbidden" }), "Backup", nightly.metadata).size).toBe(0);
  });

  it("are none when the family is denied after a read that found them, and kept after a read that failed or of a kind no longer served, as the band keeps its rows", () => {
    const mine = [podVolumeBackup("nightly-a", { phase: "Completed" }, ownedBy("Backup", nightly))];
    const after = (status: ReadStatus, reading = false) =>
      volumeIndex({
        podVolumeBackups: { ...read(mine, status, NOW - MINUTE), reading },
        podVolumeRestores: read([]),
      });

    expect(volumeWays(after("ready"), "Backup", nightly.metadata).size).toBe(1);
    expect(volumeWays(after("ready", true), "Backup", nightly.metadata).size).toBe(1);
    expect(volumeWays(after("forbidden"), "Backup", nightly.metadata).size).toBe(0);
    for (const status of ["failed", "not-served"] as const) {
      expect([...volumeWays(after(status), "Backup", nightly.metadata).values()], status).toEqual([
        { kind: "pod-volume-backup", name: "nightly-a" },
      ]);
    }
    for (const status of ["forbidden", "failed", "not-served"] as const) {
      expect(
        backupBand(after(status), nightly, operationState("Backup", "Completed")).operations.map(
          (operation) => operation.metadata.name,
        ),
        status,
      ).toEqual(["nightly-a"]);
    }
  });
});
