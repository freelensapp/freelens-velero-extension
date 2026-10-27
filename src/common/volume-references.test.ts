import { describe, expect, it } from "vitest";
import {
  backup,
  ownedBy,
  podVolumeBackup,
  podVolumeRestore,
  read,
  repository,
  restore,
} from "../../test/volume-builders";
import {
  operationClaim,
  operationLocation,
  operationNode,
  operationOwner,
  operationPod,
  operationRepository,
  repositoryType,
  volumeNamespace,
} from "./volume-references";
import { REFERENCE_WORDS } from "./volume-words";

import type { BackupStorageLocationResource } from "./types";

const nightly = backup("nightly", "Completed", { uid: "backup-nightly-2" });

describe("the backup or the restore an operation belongs to", () => {
  it("is found by the labels of its name and its UID, a way to it", () => {
    const owner = operationOwner(
      podVolumeBackup("nightly-x7k2p", undefined, ownedBy("Backup", nightly)),
      "Backup",
      read([nightly]),
    );

    expect(owner).toEqual({
      by: "labels",
      replaced: false,
      reference: {
        kind: "Backup",
        name: "nightly",
        namespace: "velero",
        state: "resolved",
        uid: "backup-nightly-2",
        stale: false,
        reason: "",
      },
    });
  });

  it("is another object when the one of that name has another UID: the backup it belongs to was deleted", () => {
    const earlier = backup("nightly", "Completed", { uid: "backup-nightly-1" });
    const owner = operationOwner(
      podVolumeBackup("nightly-x7k2p", undefined, ownedBy("Backup", earlier)),
      "Backup",
      read([nightly]),
    );

    expect(owner.replaced).toBe(true);
    expect(owner.reference).toMatchObject({ name: "nightly", state: "absent" });
    expect(owner.reference?.reason).toContain("another one, created after the one this operation belongs to");
  });

  it("is absent, denied, not read or failed as what was read of the backups says", () => {
    const operation = podVolumeBackup("nightly-x7k2p", undefined, ownedBy("Backup", nightly));
    const state = (status: Parameters<typeof read>[1], items = [] as (typeof nightly)[]) =>
      operationOwner(operation, "Backup", read(items, status)).reference;

    expect(state("ready")).toMatchObject({ state: "absent", reason: REFERENCE_WORDS.absent("backup", "velero") });
    expect(state("forbidden")).toMatchObject({ state: "inaccessible", reason: REFERENCE_WORDS.denied("backups") });
    expect(state("idle")).toMatchObject({ state: "not-read", reason: REFERENCE_WORDS["not-read"]("backups") });
    expect(state("loading")).toMatchObject({ state: "not-read" });
    expect(state("failed")).toMatchObject({ state: "unknown", reason: REFERENCE_WORDS.failed("backups") });
    expect(state("not-served")).toMatchObject({ state: "unknown", reason: REFERENCE_WORDS["not-served"]("backups") });
    // Read before a read that failed: found, and said so.
    expect(operationOwner(operation, "Backup", read([nightly], "failed", 1)).reference).toMatchObject({
      state: "resolved",
      stale: true,
      reason: REFERENCE_WORDS.stale("backups"),
    });
  });

  it("is named by the owner reference when the labels name none, and by nothing when neither does", () => {
    const { ownerReferences } = ownedBy("Backup", nightly);
    const byReference = operationOwner(podVolumeBackup("x", undefined, { ownerReferences }), "Backup", read([nightly]));

    expect([byReference.by, byReference.reference?.state]).toEqual(["owner-reference", "resolved"]);
    expect(operationOwner(podVolumeBackup("y", undefined), "Backup", read([nightly]))).toEqual({
      by: "none",
      replaced: false,
    });
  });

  it("is the one the labels name when the owner reference names another, with the disagreement said beside", () => {
    const other = backup("weekly", "Completed", { uid: "backup-weekly-1" });
    const { labels } = ownedBy("Backup", nightly);
    const { ownerReferences } = ownedBy("Backup", other);
    const owner = operationOwner(
      podVolumeBackup("x", undefined, { labels, ownerReferences }),
      "Backup",
      read([nightly, other]),
    );

    expect(owner.reference).toMatchObject({ name: "nightly", state: "resolved" });
    expect(owner.disagreement).toBe(
      "Its owner reference names the backup weekly of UID backup-weekly-1, which its labels do not name",
    );
    const sameName = operationOwner(
      podVolumeBackup("z", undefined, {
        labels,
        ownerReferences: [{ kind: "Backup", name: "nightly", uid: "backup-nightly-1" }],
      }),
      "Backup",
      read([nightly]),
    );

    expect(sameName.disagreement).toContain("of UID backup-nightly-1");
    expect(
      operationOwner(podVolumeBackup("w", undefined, ownedBy("Backup", nightly)), "Backup", read([nightly]))
        .disagreement,
    ).toBe(undefined);
  });

  it("is a restore for a pod volume restore, by its own labels", () => {
    const monday = restore("monday", "Completed", { uid: "restore-monday-1" });
    const owner = operationOwner(
      podVolumeRestore("monday-a1b2c", undefined, ownedBy("Restore", monday)),
      "Restore",
      read([monday]),
    );

    expect(owner.reference).toMatchObject({
      kind: "Restore",
      name: "monday",
      state: "resolved",
      uid: "restore-monday-1",
    });
  });

  it("is of the namespace of the operation alone", () => {
    const elsewhere = backup("nightly", "Completed", { uid: "backup-nightly-2", namespace: "other" });

    expect(
      operationOwner(podVolumeBackup("x", undefined, ownedBy("Backup", nightly)), "Backup", read([elsewhere])).reference
        ?.state,
    ).toBe("absent");
  });
});

describe("a name the release cuts in a label", () => {
  // The labels as the release writes them: a name over 63 characters is cut to its first 57 and the first six
  // hexadecimal characters of its SHA-256, computed outside the extension.
  it("finds the owner of an operation by a name of 63, 64 and 78 characters, with no disagreement", () => {
    const cases = [
      [
        "daily-backups-of-the-shop-database-and-of-its-uploaded-files-ab",
        "daily-backups-of-the-shop-database-and-of-its-uploaded-files-ab",
      ],
      [
        "daily-backups-of-the-shop-database-and-of-its-uploaded-files-abc",
        "daily-backups-of-the-shop-database-and-of-its-uploaded-fi1cdcbe",
      ],
      [
        "the-daily-backups-of-the-shop-database-and-of-its-files-of-2026-20261026120000",
        "the-daily-backups-of-the-shop-database-and-of-its-files-o80b6c5",
      ],
    ] as const;

    expect(cases.map(([name]) => name.length)).toEqual([63, 64, 78]);
    for (const [name, label] of cases) {
      const uid = `backup-${name.length}`;
      const owner = backup(name, "Completed", { uid });
      const operation = podVolumeBackup("x", undefined, {
        labels: { "velero.io/backup-name": label, "velero.io/backup-uid": uid },
        ownerReferences: [{ apiVersion: "velero.io/v1", kind: "Backup", name, uid, controller: true }],
      });
      const found = operationOwner(operation, "Backup", read([nightly, owner]));

      expect([name.length, found.by, found.reference?.state, found.reference?.name, found.disagreement]).toEqual([
        name.length,
        "labels",
        "resolved",
        name,
        undefined,
      ]);
    }
  });

  it("names an owner that is not in the read by the whole name of its owner reference, which the label is the cut of", () => {
    const name = "the-daily-backups-of-the-shop-database-and-of-its-files-of-2026-20261026120000";
    const label = "the-daily-backups-of-the-shop-database-and-of-its-files-o80b6c5";
    const labels = { "velero.io/backup-name": label, "velero.io/backup-uid": "backup-78" };
    const owned = podVolumeBackup("x", undefined, {
      labels,
      ownerReferences: [{ apiVersion: "velero.io/v1", kind: "Backup", name, uid: "backup-78", controller: true }],
    });
    const found = operationOwner(owned, "Backup", read([nightly]));

    expect([found.by, found.reference?.state, found.reference?.name, found.disagreement]).toEqual([
      "labels",
      "absent",
      name,
      undefined,
    ]);
    expect(found.reference?.reason).toBe(REFERENCE_WORDS.absent("backup", "velero"));
    // With no owner reference, the label is all that names it.
    const labelled = operationOwner(podVolumeBackup("y", undefined, { labels }), "Backup", read([nightly]));

    expect([labelled.reference?.state, labelled.reference?.name]).toEqual(["absent", label]);
  });

  it("finds the repository of an operation whose storage location is named with 63 and 64 characters", () => {
    const cases = [
      [
        "the-storage-location-of-the-backups-of-the-shop-in-the-region-a",
        "the-storage-location-of-the-backups-of-the-shop-in-the-region-a",
      ],
      [
        "the-storage-location-of-the-backups-of-the-shop-in-the-region-ab",
        "the-storage-location-of-the-backups-of-the-shop-in-the-re2c9aa0",
      ],
    ] as const;

    expect(cases.map(([location]) => location.length)).toEqual([63, 64]);
    for (const [location, label] of cases) {
      const far = repository(
        "shop-far-kopia",
        { phase: "Ready" },
        {
          spec: { backupStorageLocation: location },
          labels: {
            "velero.io/volume-namespace": "shop",
            "velero.io/storage-location": label,
            "velero.io/repository-type": "kopia",
          },
        },
      );
      const operation = podVolumeBackup("x", undefined, { spec: { backupStorageLocation: location } });

      expect([location.length, operationRepository("PodVolumeBackup", operation, read([far]))]).toEqual([
        location.length,
        expect.objectContaining({ state: "found", reference: expect.objectContaining({ name: "shop-far-kopia" }) }),
      ]);
    }
  });
});

describe("the storage location of an operation", () => {
  it("is the one its spec names, among the ones of its installation", () => {
    const location = { metadata: { name: "default", namespace: "velero", uid: "l" } } as BackupStorageLocationResource;

    expect(operationLocation(podVolumeBackup("x", undefined), read([location]))).toMatchObject({
      state: "resolved",
      name: "default",
    });
    expect(operationLocation(podVolumeBackup("x", undefined), read([]))).toMatchObject({ state: "absent" });
    expect(
      operationLocation(podVolumeBackup("x", undefined, { spec: { backupStorageLocation: "" } }), read([])),
    ).toBeUndefined();
  });
});

describe("the repository of an operation", () => {
  const kopia = repository("shop-default-kopia", { phase: "Ready" });
  const restic = repository("shop-default-restic", { phase: "Ready" }, { spec: { repositoryType: "restic" } });

  it("is found by its three labels, and never by its name", () => {
    expect(
      operationRepository("PodVolumeBackup", podVolumeBackup("x", undefined), read([kopia, restic])),
    ).toMatchObject({
      state: "found",
      reference: { kind: "BackupRepository", name: "shop-default-kopia", state: "resolved" },
    });
    // The name of a repository says the triple; the labels say another one, and the labels are what the release reads.
    const misnamed = repository("shop-default-kopia", { phase: "Ready" }, { labels: {} });

    expect(operationRepository("PodVolumeBackup", podVolumeBackup("x", undefined), read([misnamed]))).toMatchObject({
      state: "none",
    });
  });

  it("is of the type the uploader names: kopia, or restic for restic and for an empty uploader", () => {
    expect([repositoryType("kopia"), repositoryType("restic"), repositoryType(""), repositoryType(undefined)]).toEqual([
      "kopia",
      "restic",
      "restic",
      "restic",
    ]);
    expect(repositoryType("rsync")).toBeUndefined();
    expect(
      operationRepository(
        "PodVolumeBackup",
        podVolumeBackup("x", undefined, { spec: { uploaderType: "" } }),
        read([kopia, restic]),
      ),
    ).toMatchObject({ state: "found", reference: { name: "shop-default-restic" } });
    expect(
      operationRepository(
        "PodVolumeBackup",
        podVolumeBackup("x", undefined, { spec: { uploaderType: "rsync" } }),
        read([kopia]),
      ),
    ).toMatchObject({
      state: "no-triple",
      reason: "The uploader rsync names no type of repository the reviewed release knows",
    });
  });

  it("is of the namespace of the pod for a pod volume backup, and of the source namespace for a pod volume restore", () => {
    expect(volumeNamespace("PodVolumeBackup", podVolumeBackup("x", undefined))).toBe("shop");
    expect(volumeNamespace("PodVolumeRestore", podVolumeRestore("x", undefined))).toBe("shop");
    expect(operationRepository("PodVolumeRestore", podVolumeRestore("x", undefined), read([kopia]))).toMatchObject({
      state: "found",
    });
  });

  it("is none, or more than one, which the release refuses, each said", () => {
    const twin = repository("shop-default-kopia-2", { phase: "Ready" }, { labels: kopia.metadata.labels });

    expect(operationRepository("PodVolumeBackup", podVolumeBackup("x", undefined), read([restic]))).toEqual({
      state: "none",
      names: [],
      reason: "No repository of this installation names the volumes of shop, the location default and the type kopia",
    });
    expect(operationRepository("PodVolumeBackup", podVolumeBackup("x", undefined), read([twin, kopia]))).toEqual({
      state: "many",
      names: ["shop-default-kopia", "shop-default-kopia-2"],
      reason:
        "2 repositories name the volumes of shop, the location default and the type kopia: the release refuses more than one",
    });
  });

  it("is not known when the repositories were not read, are denied or failed", () => {
    const operation = podVolumeBackup("x", undefined);

    expect(operationRepository("PodVolumeBackup", operation, read([], "forbidden"))).toMatchObject({
      state: "inaccessible",
      reason: REFERENCE_WORDS.denied("backup repositories"),
    });
    expect(operationRepository("PodVolumeBackup", operation, read([], "idle"))).toMatchObject({ state: "not-read" });
    expect(operationRepository("PodVolumeBackup", operation, read([], "failed"))).toMatchObject({ state: "unknown" });
    // Read before a read that failed: what was read is what is said.
    expect(operationRepository("PodVolumeBackup", operation, read([kopia], "failed", 1))).toMatchObject({
      state: "found",
      reference: { stale: true },
    });
    // None found in what was read before is not known, and two found are said read before.
    expect(operationRepository("PodVolumeBackup", operation, read([restic], "forbidden", 1))).toEqual({
      state: "inaccessible",
      names: [],
      reason: "The backup repositories of this installation cannot be read: access is denied",
    });
    expect(operationRepository("PodVolumeBackup", operation, read([restic], "failed", 1))).toMatchObject({
      state: "unknown",
    });
    const twin = repository("shop-default-kopia-2", { phase: "Ready" }, { labels: kopia.metadata.labels });

    expect(operationRepository("PodVolumeBackup", operation, read([twin, kopia], "failed", 1))).toEqual({
      state: "many",
      names: ["shop-default-kopia", "shop-default-kopia-2"],
      reason:
        "2 repositories name the volumes of shop, the location default and the type kopia: the release refuses more than one. Read before the backup repositories stopped answering",
    });
  });
});

describe("the pod, the node and the claim of an operation", () => {
  it("are names: the pod with its namespace and UID, the node of the spec of a backup and of the status of a restore", () => {
    expect(operationPod(podVolumeBackup("x", undefined))).toEqual({
      namespace: "shop",
      name: "cart-0",
      uid: "pod-cart-0",
    });
    expect(operationPod(podVolumeBackup("x", undefined, { spec: { pod: null } }))).toEqual({});
    expect(operationNode("PodVolumeBackup", podVolumeBackup("x", { phase: "Completed" }))).toBe("worker-1");
    expect(operationNode("PodVolumeRestore", podVolumeRestore("x", { phase: "Accepted", node: "worker-2" }))).toBe(
      "worker-2",
    );
    expect(operationNode("PodVolumeRestore", podVolumeRestore("x", { phase: "InProgress" }))).toBeUndefined();
  });

  it("are the claim by the annotation of its name and the label of its UID, as text", () => {
    expect(
      operationClaim(
        "PodVolumeBackup",
        podVolumeBackup("x", undefined, {
          labels: { "velero.io/pvc-uid": "claim-1" },
          annotations: { "velero.io/pvc-name": "data-cart-0" },
        }),
      ),
    ).toEqual({ name: "data-cart-0", uid: "claim-1" });
    expect(
      operationClaim(
        "PodVolumeRestore",
        podVolumeRestore("x", undefined, { labels: { "velero.io/pvc-uid": "claim-1" } }),
      ),
    ).toEqual({
      uid: "claim-1",
    });
    expect(operationClaim("PodVolumeBackup", podVolumeBackup("x", undefined))).toEqual({});
  });
});
