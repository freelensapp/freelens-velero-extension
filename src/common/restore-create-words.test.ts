import { describe, expect, it } from "vitest";
import { scheduleCandidates } from "./restore-candidates";
import {
  backupOffered,
  NOT_OFFERED_OF_A_RESTORE,
  restoreCreateMeaning,
  restoreResultWords,
} from "./restore-create-words";
import { RESTORE_WORDS, type RestoreForm, restoreFromForm, restoreProblems } from "./restore-form";

import type { BackupResource } from "./types";

// The zone of the machine the tests run on is one no case below is computed or written in, fourteen hours east of
// UTC. The module never reads it.
process.env.TZ = "Pacific/Kiritimati";

const BACKUP = { includedNamespaces: ["shop", "web-*"], excludedNamespaces: ["web-test"] };

function body(form: Partial<RestoreForm> = {}) {
  const made = restoreFromForm(
    "velero",
    "nightly-20261108120000",
    "nightly",
    { clusterResources: "needed", existingResourcePolicy: "none", ...form },
    BACKUP,
  );

  if (!made) throw new Error("The form of the test is refused");
  return made;
}

function said(parts: { id: string; words: string }[]): Record<string, string> {
  return Object.fromEntries(parts.map((part) => [part.id, part.words]));
}

describe("whether a backup is offered for a restore", () => {
  it("offers a backup Completed, one PartiallyFailed with the words that some items may be missing, and says why not for every other phase", () => {
    expect(backupOffered("Completed")).toEqual({ offered: true });
    expect(backupOffered("PartiallyFailed")).toEqual({
      offered: true,
      words:
        "The backup PartiallyFailed: Velero restores what it holds, and some of its items may be missing; its view says its errors.",
    });
    for (const phase of ["Failed", "FailedValidation"])
      expect(backupOffered(phase)).toEqual({
        offered: false,
        words: `The backup is ${phase}: it holds nothing Velero restores whole, and a restore is not offered of it.`,
      });
    expect(backupOffered("Deleting")).toEqual({
      offered: false,
      words: "The backup is Deleting: Velero is deleting its data, and a restore is not offered of it.",
    });
    for (const phase of [
      undefined,
      "New",
      "Queued",
      "ReadyToStart",
      "InProgress",
      "WaitingForPluginOperations",
      "WaitingForPluginOperationsPartiallyFailed",
      "Finalizing",
      "FinalizingPartiallyFailed",
    ])
      expect([phase, backupOffered(phase)]).toEqual([
        phase,
        {
          offered: false,
          words: `The backup is ${phase ?? "without a phase"}: it has not ended, so its files are not in the store yet, or not all its data, and a restore is offered once it is Completed or PartiallyFailed.`,
        },
      ]);
  });

  it("lists the backups of a schedule Completed and PartiallyFailed, the newest by its start first, the newest Completed chosen first", () => {
    const backup = (name: string, phase: string, start: string, schedule = "nightly"): BackupResource =>
      ({
        apiVersion: "velero.io/v1",
        kind: "Backup",
        metadata: { name, namespace: "velero", uid: `${name}-uid`, labels: { "velero.io/schedule-name": schedule } },
        spec: {},
        status: { phase, startTimestamp: start },
      }) as unknown as BackupResource;
    const backups = [
      backup("nightly-1", "Completed", "2026-11-06T03:00:00Z"),
      backup("nightly-2", "Completed", "2026-11-07T03:00:00Z"),
      backup("nightly-3", "PartiallyFailed", "2026-11-08T03:00:00Z"),
      backup("nightly-4", "Failed", "2026-11-08T04:00:00Z"),
      backup("nightly-5", "InProgress", "2026-11-08T05:00:00Z"),
      backup("weekly-1", "Completed", "2026-11-08T06:00:00Z", "weekly"),
    ];
    const { offered, chosen } = scheduleCandidates(backups, "nightly");

    expect(offered.map((item) => item.metadata.name)).toEqual(["nightly-3", "nightly-2", "nightly-1"]);
    expect(chosen?.metadata.name).toBe("nightly-2");
    // With none Completed, the newest that ended is chosen; with none that ended, none.
    expect(scheduleCandidates(backups.slice(2), "nightly").chosen?.metadata.name).toBe("nightly-3");
    expect(scheduleCandidates(backups.slice(3, 5), "nightly")).toEqual({ offered: [] });
  });
});

describe("what the review of a restore says", () => {
  it("says the backup and its location, the namespaces, each mapping with its target and whether the host lists it, and the ones restored by their names", () => {
    const words = said(
      restoreCreateMeaning(
        body({
          includedNamespaces: ["shop", "web-*", "cache"],
          namespaceMapping: [
            ["shop", "shop-restored"],
            ["web-a", "web"],
          ],
        }),
        { listed: ["web", "cache", "velero"], storageLocation: "default", backupPhase: "Completed" },
      ),
    );

    expect(words.source).toBe(
      "The restore takes the backup nightly, from the storage location default: Velero refuses the restore when the storage location of the backup is not Available.",
    );
    expect(words["partially-failed"]).toBeUndefined();
    expect(words.includedNamespaces).toBe("Included namespaces: shop, web-*, cache.");
    expect(words.excludedNamespaces).toBe("Excluded namespaces: not set. None.");
    expect(words["mapping-shop"]).toBe(
      "shop is restored into shop-restored, which the host does not list in the cluster: Velero creates it from the namespace of the backup.",
    );
    expect(words["mapping-web-a"]).toBe(
      "web-a is restored into web, which the host lists in the cluster: Velero restores into it as it is, and never changes the namespace itself.",
    );
    // A namespace restored by its name: a pattern is no name, and a mapped one is said by its mapping.
    expect(words["unmapped-cache"]).toBe(
      "cache is restored into cache, which the host lists in the cluster: Velero restores into it as it is, and never changes the namespace itself.",
    );
    expect(words["unmapped-shop"]).toBeUndefined();
    expect(words["unmapped-web-*"]).toBeUndefined();
    // With no list of the host, whether it lists a target is not known.
    expect(said(restoreCreateMeaning(body({ namespaceMapping: [["shop", "s2"]] })))["mapping-shop"]).toBe(
      "shop is restored into s2. Whether the host lists it is not known.",
    );
    expect(said(restoreCreateMeaning(body())).namespaceMapping).toBe(
      "Mapping of the namespaces: not set. Each namespace is restored into the namespace of its name.",
    );
  });

  it("says the three choices of the cluster-scoped resources, with what each takes", () => {
    expect(said(restoreCreateMeaning(body({ clusterResources: "every" }))).clusterResources).toBe(
      "Cluster-scoped resources: every one the backup holds, written true. Velero creates each that is not in the cluster, roles and their bindings among them.",
    );
    expect(said(restoreCreateMeaning(body({ clusterResources: "none" }))).clusterResources).toBe(
      "Cluster-scoped resources: none, written false. The volume of a claim backed up by a native snapshot or by a file system backup does not come back; a CSI snapshot of it is restored all the same, as a content under a new name from which the claim gets a new volume, unless the volumes are not restored.",
    );
    expect(said(restoreCreateMeaning(body({ clusterResources: "needed" }))).clusterResources).toBe(
      "Cluster-scoped resources: the ones the restored resources need, left out. Velero adds the volume of a bound claim, restored under a new name when one of its name exists and its namespace is mapped, the priority class of a pod and the content of a CSI snapshot; when the restore takes every namespace, it takes every cluster-scoped resource of the backup.",
    );
  });

  it("says what each policy does with a resource that exists, the volumes as set, and the selectors", () => {
    const always =
      "With either policy, a ServiceAccount that exists is merged with the one of the backup, and the namespaces themselves are never changed.";

    expect(said(restoreCreateMeaning(body())).existingResourcePolicy).toBe(
      `Resources that exist: none. Velero leaves a resource of the backup that exists in the cluster as it is, and reports it as a warning when it differs. ${always}`,
    );
    expect(said(restoreCreateMeaning(body({ existingResourcePolicy: "update" }))).existingResourcePolicy).toBe(
      `Resources that exist: update. Velero applies to a resource of the backup that exists in the cluster and differs a merge patch from the copy in the cluster to the object of the backup, so that a field only the cluster has is removed; it writes the two labels of the restore on one that is the same, and reports as a warning what it could not update. ${always}`,
    );
    expect(said(restoreCreateMeaning(body())).restorePVs).toBe(
      "Restore the volumes: not set. Velero restores them as when it is true.",
    );
    expect(said(restoreCreateMeaning(body({ restorePVs: true }))).restorePVs).toBe(
      "Restore the volumes: true. Velero creates the volumes of the backup from their snapshots, native or CSI, and restores the file system backups of the pods.",
    );
    expect(said(restoreCreateMeaning(body({ restorePVs: false }))).restorePVs).toBe(
      "Restore the volumes: false. Velero creates no volume from a snapshot. A volume backed up with a snapshot of its provider is restored as the backup holds it, naming the disk it named, and its claim is bound to it; a claim of a CSI snapshot gets a new empty volume of its storage class. The file system backups of the pods are restored all the same.",
    );
    expect(said(restoreCreateMeaning(body({ labelSelector: "app=web" }))).selector).toBe(
      'Label selector: {"matchLabels":{"app":"web"}}. Velero restores the objects it selects.',
    );
    expect(said(restoreCreateMeaning(body({ orLabelSelectors: ["app=web", "tier=db"] }))).selector).toBe(
      'Any of the label selectors: [{"matchLabels":{"app":"web"}},{"matchLabels":{"tier":"db"}}]. Velero restores the objects any of them selects.',
    );
    expect(said(restoreCreateMeaning(body())).selector).toBe(
      "Label selector: not set. Every object, whatever its labels.",
    );
  });

  it("says what Velero never restores, the status, its labels, what it writes into the spec, what is not known and what is not offered, whole", () => {
    const words = said(restoreCreateMeaning(body({ includedResources: ["deployments"] })));

    expect(words.includedResources).toBe("Included resources: deployments.");
    expect(words.excludedResources).toBe("Excluded resources: not set. None but the ones Velero never restores.");
    expect(words.never).toBe(
      "Velero never restores nodes, events, events.events.k8s.io, backups.velero.io, restores.velero.io, resticrepositories.velero.io, csinodes.storage.k8s.io, volumeattachments.storage.k8s.io, backuprepositories.velero.io, nor mirror pods, the pods that succeeded or failed, and the jobs that completed.",
    );
    expect(words.status).toBe(
      "The status of an object is not restored, unless the object carries the annotation velero.io/restore-status set to true.",
    );
    expect(words.labels).toBe(
      "Every object Velero restores carries the labels velero.io/backup-name and velero.io/restore-name, but the namespaces it creates.",
    );
    expect(words.resolved).toBe(
      "When it starts the restore, Velero writes into its spec the schedule of the backup, when it has one, which the view of the restore then names, and the timeout of the item operations, and adds to the excluded resources the ones it never restores.",
    );
    expect(words["not-known"]).toBe(
      "The extension does not read what the backup holds: which objects Velero will create, leave or update is not known here. The tab of the resources of the backup lists what it holds.",
    );
    expect(words["not-offered"]).toBe(NOT_OFFERED_OF_A_RESTORE);
  });

  it("says that a backup PartiallyFailed may miss items, and the warnings of the form", () => {
    const form: RestoreForm = {
      namespaceMapping: [["shop", "shop-2"]],
      clusterResources: "needed",
      existingResourcePolicy: "none",
    };
    const { warnings } = restoreProblems(form, {});
    const made = restoreFromForm("velero", "r", "nightly", form, {});

    if (!made) throw new Error("The form of the test is refused");
    const words = said(restoreCreateMeaning(made, { backupPhase: "PartiallyFailed", warnings }));

    expect(words["partially-failed"]).toBe(backupOffered("PartiallyFailed").words);
    expect(words["warning-0"]).toBe(RESTORE_WORDS.everyNamespace("shop"));
    expect(Object.keys(words)[0]).toBe("source");
  });
});

describe("what the result of a restore says", () => {
  it("says the phase Velero wrote, or none yet", () => {
    expect(restoreResultWords(undefined)).toBe(
      "Velero has not read it yet: it had no phase after thirty seconds of reads. Its view goes on reading it.",
    );
    expect(restoreResultWords("InProgress")).toBe(
      "Velero wrote its phase: InProgress. It is restoring what the backup holds: its view goes on reading it.",
    );
    expect(restoreResultWords("FailedValidation")).toBe(
      "Velero wrote its phase: FailedValidation. It refused the restore, which writes nothing: each error is as it wrote it.",
    );
    expect(restoreResultWords("Completed")).toBe(
      "Velero wrote its phase: Completed. It restored what the fields chose; its view says the warnings and the errors it counted.",
    );
    expect(restoreResultWords("PartiallyFailed")).toBe(
      "Velero wrote its phase: PartiallyFailed. It restored some of what the fields chose; its view says the errors.",
    );
    expect(restoreResultWords("Failed")).toBe("Velero wrote its phase: Failed. Its view says why.");
    expect(restoreResultWords("New")).toBe("Velero wrote its phase: New. It has not started it yet.");
    expect(restoreResultWords("WaitingForPluginOperations")).toBe(
      "Velero wrote its phase: WaitingForPluginOperations. Its view goes on reading it.",
    );
  });
});
