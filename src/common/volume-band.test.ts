import { describe, expect, it } from "vitest";
import {
  backup,
  before,
  dataDownload,
  dataUpload,
  MINUTE,
  moved,
  NOW,
  ownedBy,
  podVolumeBackup,
  podVolumeRestore,
  read,
  repository,
  restore,
} from "../../test/volume-builders";
import { operationState } from "./phases";
import {
  backupBand,
  movedKey,
  phaseGroups,
  repositoryUses,
  restoreBand,
  rowKey,
  uploadOf,
  volumeWays,
} from "./volume-band";
import { volumeIndex } from "./volume-index";
import { bandSentence } from "./volume-words";

import type { ReadStatus } from "./read-state";
import type {
  DataDownloadResource,
  DataUploadResource,
  PodVolumeBackupResource,
  PodVolumeRestoreResource,
} from "./types";
import type { VolumeBand } from "./volume-band";

const nightly = backup("nightly", "InProgress", { uid: "backup-nightly-2" });
const monday = restore("monday", "InProgress", { uid: "restore-monday-1" });

function index(
  backups: PodVolumeBackupResource[],
  restores: PodVolumeRestoreResource[] = [],
  status: { backups?: ReadStatus; restores?: ReadStatus; uploads?: ReadStatus; downloads?: ReadStatus } = {},
  movement: { uploads?: DataUploadResource[]; downloads?: DataDownloadResource[] } = {},
) {
  return volumeIndex({
    podVolumeBackups: read(backups, status.backups),
    podVolumeRestores: read(restores, status.restores),
    dataUploads: read(movement.uploads ?? [], status.uploads),
    dataDownloads: read(movement.downloads ?? [], status.downloads),
  });
}

// The half of the pod volume operations of a band, and the one of the data movement.
const pods = (band: VolumeBand) => band.halves[0];
const data = (band: VolumeBand) => band.halves[1];

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

    expect([pods(band).kind, pods(band).operations.map((operation) => operation.metadata.name)]).toEqual([
      "PodVolumeBackup",
      ["nightly-new", "nightly-cut", "nightly-old"],
    ]);
    // The groups of backup describe: Failed before Canceled.
    expect(pods(band).groups.map((group) => [group.phase, group.count])).toEqual([
      ["Completed", 1],
      ["Failed", 1],
      ["Canceled", 1],
    ]);
    // The read of the family is the one the band says the state of.
    expect(pods(band).read).toBe(made.reads.podVolumeBackups);
    const ofRestore = restoreBand(made, monday, operationState("Restore", "Completed"));

    expect([pods(ofRestore).kind, pods(ofRestore).operations.map((operation) => operation.metadata.name)]).toEqual([
      "PodVolumeRestore",
      ["monday-a", "monday-b", "monday-c"],
    ]);
    // The groups of restore describe: Canceled before Failed.
    expect(pods(ofRestore).groups.map((group) => group.phase)).toEqual(["Completed", "Canceled", "Failed"]);
    // A restore is not counted in the groups of a backup, nor a backup in the ones of a restore.
    expect(
      pods(
        backupBand(
          made,
          backup("monday", "Completed", { uid: "restore-monday-1" }),
          operationState("Backup", "Completed"),
        ),
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

    expect(pods(band).operations.map((operation) => operation.metadata.name)).toEqual(["nightly-k2"]);
    expect(band.sentence).toBe(
      "The pod volume backups the installation holds of this backup are the ones its run made, or the ones a sync from the store made, in the phase they were stored in. Its data uploads are the ones its run made: a sync makes none.",
    );
  });

  it("says what the release does with the volume operations by the phase of the backup or the restore", () => {
    const backups = (phase: string | undefined) => bandSentence("Backup", operationState("Backup", phase));
    const restores = (phase: string | undefined) => bandSentence("Restore", operationState("Restore", phase));

    expect(backups("InProgress")).toBe(
      "The pod volume backups run while the backup is InProgress: it waits for all of them, and at its own timeout asks the ones that have not ended to cancel. Its data uploads are made as the CSI plugin snapshots each claim, and it waits for them in its plugin operations.",
    );
    expect(backups("WaitingForPluginOperations")).toBe(
      "The pod volume backups ran while the backup was InProgress, and its data uploads were made then. It waits for its plugin operations, among them its data uploads.",
    );
    expect(backups("WaitingForPluginOperationsPartiallyFailed")).toBe(backups("WaitingForPluginOperations"));
    expect(backups("FinalizingPartiallyFailed")).toBe(
      "The pod volume backups ran while the backup was InProgress, and it waited for its data uploads among its plugin operations.",
    );
    expect(backups("New")).toBe(
      "The pod volume backups and the data uploads of a backup are made while it is InProgress, the data uploads as the CSI plugin snapshots each claim: this one has not started.",
    );
    expect(backups(undefined)).toBe(backups("New"));
    expect(backups("Queued")).toBe(backups("New"));
    expect(backups("FailedValidation")).toBe(
      "The pod volume backups and the data uploads of a backup are made once it runs: this one failed its validation, and did not run.",
    );
    for (const ended of ["Completed", "PartiallyFailed", "Failed"]) expect(backups(ended)).toBe(backups("Completed"));
    expect(backups("Deleting")).toBe(
      "The backup is being deleted: its pod volume backups go with it, and its data uploads are deleted.",
    );
    expect(backups("Paused")).toBe(
      "The backup reports a phase the release does not write: what the release does with its pod volume backups and its data uploads is not known.",
    );
    expect(restores("InProgress")).toBe(
      "The node agent of the node of each restored pod takes its pod volume restore when the init container restore-wait of that pod runs. Its data downloads are made as the CSI plugin restores each claim, and it waits for them in its plugin operations.",
    );
    expect(restores("WaitingForPluginOperations")).toBe(
      "The data downloads of the restore were made while it was InProgress. It waits for its plugin operations, among them its data downloads.",
    );
    expect(restores("Completed")).toBe(
      "The pod volume restores and the data downloads the installation holds of this restore are the ones its run made.",
    );
    expect(restores("New")).toBe(
      "The pod volume restores and the data downloads of a restore are made while it is InProgress, the data downloads as the CSI plugin restores each claim: this one has not started.",
    );
    expect(restores("Paused")).toBe(
      "The restore reports a phase the release does not write: what the release does with its pod volume restores and its data downloads is not known.",
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
      ["DataUpload", [], [], []],
      ["DataDownload", [], [], []],
    ]);
  });

  it("counts the kinds it could read, and keeps the read of the one it could not, with no count", () => {
    const made = index([phased("Completed", "nightly-a")], [], { restores: "forbidden" });
    const uses = repositoryUses(made, kopia, reads);

    expect(uses.map((use) => [use.kind, use.read.status, use.operations.length])).toEqual([
      ["PodVolumeBackup", "ready", 1],
      ["PodVolumeRestore", "forbidden", 0],
      ["DataUpload", "ready", 0],
      ["DataDownload", "ready", 0],
    ]);
  });

  it("holds none of each kind when nothing names it", () => {
    const made = index([], []);

    expect(repositoryUses(made, kopia, reads).map((use) => [use.read.status, use.operations.length])).toEqual([
      ["ready", 0],
      ["ready", 0],
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
        dataUploads: read([]),
        dataDownloads: read([]),
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
        pods(backupBand(after(status), nightly, operationState("Backup", "Completed"))).operations.map(
          (operation) => operation.metadata.name,
        ),
        status,
      ).toEqual(["nightly-a"]);
    }
  });
});

describe("the data movement of a backup and of a restore", () => {
  const upload = (name: string, status: Parameters<typeof dataUpload>[1], id: string, owner = nightly) =>
    dataUpload(name, status, moved("Backup", owner, id));
  const download = (name: string, status: Parameters<typeof dataDownload>[1], id: string, owner = monday) =>
    dataDownload(name, status, moved("Restore", owner, id));

  it("is the second half of the band, found by the label of the UID of the owner and counted by phase", () => {
    const made = index(
      [phased("Completed", "nightly-pv")],
      [restored("Completed", "monday-pv")],
      {},
      {
        uploads: [
          upload("nightly-du-a", { phase: "Completed", startTimestamp: before(5 * MINUTE) }, "du-a"),
          upload("nightly-du-b", { phase: "InProgress", startTimestamp: before(MINUTE) }, "du-b"),
          upload("weekly-du", { phase: "Completed" }, "du-c", backup("weekly", "Completed", { uid: "backup-weekly" })),
        ],
        downloads: [download("monday-dd", { phase: "Accepted" }, "dd-a")],
      },
    );
    const band = backupBand(made, nightly, operationState("Backup", "WaitingForPluginOperations"));

    expect(band.halves.map((half) => half.kind)).toEqual(["PodVolumeBackup", "DataUpload"]);
    expect(data(band).operations.map((operation) => operation.metadata.name)).toEqual(["nightly-du-b", "nightly-du-a"]);
    expect(data(band).groups.map((group) => [group.phase, group.count])).toEqual([
      ["Completed", 1],
      ["InProgress", 1],
    ]);
    expect(data(band).read).toBe(made.reads.dataUploads);
    expect(band.sentence).toBe(bandSentence("Backup", operationState("Backup", "WaitingForPluginOperations")));
    const ofRestore = restoreBand(made, monday, operationState("Restore", "InProgress"));

    expect(
      ofRestore.halves.map((half) => [half.kind, half.operations.map((operation) => operation.metadata.name)]),
    ).toEqual([
      ["PodVolumeRestore", ["monday-pv"]],
      ["DataDownload", ["monday-dd"]],
    ]);
  });

  it("groups the data movement in the order of its owner, a data download Canceling after the others", () => {
    const made = index(
      [],
      [],
      {},
      {
        uploads: [
          upload("nightly-du-new", { phase: "New" }, "du-a"),
          upload("nightly-du-canceling", { phase: "Canceling" }, "du-b"),
          upload("nightly-du-done", { phase: "Completed" }, "du-c"),
        ],
        downloads: [
          download("monday-dd-canceling", { phase: "Canceling" }, "dd-a"),
          download("monday-dd-none", undefined, "dd-b"),
          download("monday-dd-done", { phase: "Completed" }, "dd-c"),
        ],
      },
    );

    expect(
      data(backupBand(made, nightly, operationState("Backup", "InProgress"))).groups.map(({ phase }) => phase),
    ).toEqual(["Completed", "Canceling", "New"]);
    expect(
      data(restoreBand(made, monday, operationState("Restore", "InProgress"))).groups.map(({ phase }) => phase),
    ).toEqual(["Completed", "New", "Canceling"]);
  });

  it("keeps each half with the state of its own read: a denied data movement takes nothing from the pod volumes", () => {
    const made = index([phased("Completed", "nightly-pv")], [], { uploads: "forbidden" });
    const band = backupBand(made, nightly, operationState("Backup", "Completed"));

    expect(band.halves.map((half) => [half.kind, half.read.status, half.operations.length])).toEqual([
      ["PodVolumeBackup", "ready", 1],
      ["DataUpload", "forbidden", 0],
    ]);
  });

  it("is counted among what used a kopia repository by its source namespace, whatever its data mover", () => {
    const kopiaShop = repository("shop-default-kopia", { phase: "Ready" });
    const made = index(
      [],
      [],
      {},
      {
        uploads: [
          upload("nightly-du", { phase: "Completed" }, "du-a"),
          dataUpload(
            "nightly-du-other",
            { phase: "Completed" },
            { ...moved("Backup", nightly, "du-b"), spec: { sourceNamespace: "billing" } },
          ),
          // The data mover of the release written out, and one of its own, which the release does not run.
          dataUpload(
            "nightly-du-velero",
            { phase: "Completed" },
            { ...moved("Backup", nightly, "du-c"), spec: { datamover: "velero" } },
          ),
          dataUpload("nightly-du-own", undefined, {
            ...moved("Backup", nightly, "du-d"),
            spec: { datamover: "own-mover" },
          }),
        ],
        downloads: [download("monday-dd", { phase: "Completed" }, "dd-a")],
      },
    );
    const uses = repositoryUses(made, kopiaShop, { backups: read([nightly]), restores: read([monday]) });

    expect(uses.map((use) => [use.kind, use.operations.map((operation) => operation.metadata.name).sort()])).toEqual([
      ["PodVolumeBackup", []],
      ["PodVolumeRestore", []],
      ["DataUpload", ["nightly-du", "nightly-du-own", "nightly-du-velero"]],
      ["DataDownload", ["monday-dd"]],
    ]);
    expect(uses[2].owners.map((owner) => [owner.name, owner.state])).toEqual([["nightly", "resolved"]]);
  });

  it("gives the moved rows of the Volumes tab a way by their operation ID, among the operations of the owner", () => {
    const made = index(
      [],
      [],
      {},
      {
        uploads: [
          upload("nightly-du-a", { phase: "Completed" }, "du-a"),
          upload("weekly-du", { phase: "Completed" }, "du-w", backup("weekly", "Completed", { uid: "backup-weekly" })),
        ],
        downloads: [download("monday-dd", { phase: "Completed" }, "dd-a")],
      },
    );
    const ways = volumeWays(made, "Backup", nightly.metadata);

    expect([...ways]).toEqual([[movedKey("du-a"), { kind: "data-upload", name: "nightly-du-a" }]]);
    // The operation ID of the upload of another backup is not one of this backup's.
    expect(ways.get(movedKey("du-w"))).toBeUndefined();
    expect([...volumeWays(made, "Restore", monday.metadata)]).toEqual([
      [movedKey("dd-a"), { kind: "data-download", name: "monday-dd" }],
    ]);
    // The key of a moved row is never the key of a pod volume.
    expect(movedKey("du-a")).not.toBe(rowKey("", "", "du-a"));
    expect(
      volumeWays(
        index([], [], { uploads: "forbidden" }, { uploads: [upload("x", undefined, "du-x")] }),
        "Backup",
        nightly.metadata,
      ).size,
    ).toBe(0);
  });

  it("finds the data upload a data download restores by its snapshot, the newest of the namespace, or none", () => {
    const restoring = download("monday-dd", { phase: "InProgress" }, "dd-a");
    const snapshot = restoring.spec?.snapshotID ?? "";
    const made = index(
      [],
      [],
      {},
      {
        uploads: [
          upload(
            "nightly-du-old",
            { phase: "Completed", snapshotID: snapshot, startTimestamp: before(60 * MINUTE) },
            "du-o",
          ),
          upload(
            "nightly-du-new",
            { phase: "Completed", snapshotID: snapshot, startTimestamp: before(MINUTE) },
            "du-n",
          ),
          dataUpload("elsewhere", { phase: "Completed", snapshotID: snapshot }, { namespace: "velero-b" }),
        ],
        downloads: [restoring],
      },
    );

    expect(uploadOf(made, restoring)).toMatchObject({ kind: "DataUpload", name: "nightly-du-new", state: "resolved" });
    expect(
      uploadOf(made, dataDownload("other", undefined, { spec: { snapshotID: "not-moved-here" } })),
    ).toBeUndefined();
    expect(uploadOf(made, dataDownload("none", undefined, { spec: { snapshotID: "" } }))).toBeUndefined();
    // An upload in progress has no snapshot yet, and is not the one restored.
    expect(
      uploadOf(index([], [], {}, { uploads: [upload("running", { phase: "InProgress" }, "du-r")] }), restoring),
    ).toBeUndefined();
  });
});
