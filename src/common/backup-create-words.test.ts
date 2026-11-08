import { describe, expect, it } from "vitest";
import {
  BACKUP_CREATE_VIEW_WORDS,
  backupCreateMeaning,
  fieldWords,
  locationsReadWords,
  phaseWords,
  providerWarnings,
  TEMPLATE_FIELD_WORDS,
} from "./backup-create-words";
import { backupFromForm } from "./backup-form";

import type { BackupTemplate } from "./backup-template";

function body(template: BackupTemplate) {
  const made = backupFromForm("velero", "shop-by-hand", template);

  if (!made) throw new Error("The template of the test is refused");
  return made;
}

describe("the words of a backup of the form", () => {
  it("says each phase Velero writes of a new backup, the place in the queue when it is written", () => {
    expect(phaseWords("New")).toBe("Velero wrote its phase: New. It has not put it in its queue yet.");
    expect(phaseWords("Queued")).toBe("Velero wrote its phase: Queued. It waits for the backups before it.");
    expect(phaseWords("Queued", 3)).toBe("Velero wrote its phase: Queued, number 3 in the queue.");
    expect(phaseWords("ReadyToStart")).toBe(
      "Velero wrote its phase: ReadyToStart. Its queue let it go, and the backup controller starts it next.",
    );
    expect(phaseWords("InProgress")).toBe("Velero wrote its phase: InProgress.");
    expect(phaseWords("FailedValidation")).toBe(
      "Velero wrote its phase: FailedValidation. It refused the backup, which makes nothing: its view says each error.",
    );
    expect(phaseWords("Completed")).toBe("Velero wrote its phase: Completed.");
  });

  it("reads the review whole: the validation, the queue, where it goes, how long it is kept, each field, and the warnings", () => {
    const meaning = backupCreateMeaning(
      body({
        includedNamespaces: ["shop", "web-*"],
        excludedResources: ["secrets"],
        storageLocation: "default",
        ttl: "48h",
      }),
      { accessMode: "Read and write", listed: ["shop", "web"] },
    );

    expect(meaning.map((part) => part.id)).toEqual([
      "validated",
      "queue",
      "location",
      "ttl",
      "field-includedNamespaces",
      "field-excludedNamespaces",
      "field-includedResources",
      "field-excludedResources",
      "field-includeClusterResources",
      "field-labelSelector",
      "field-orLabelSelectors",
      "field-volumeSnapshotLocations",
      "field-snapshotVolumes",
      "field-defaultVolumesToFsBackup",
      "field-snapshotMoveData",
      "field-ttl",
      "field-csiSnapshotTimeout",
      "field-itemOperationTimeout",
      "not-listed",
      "labelled-later",
      "global-policy",
      "resolved",
    ]);
    const said = Object.fromEntries(meaning.map((part) => [part.id, part.words]));

    expect(said.location).toBe("It goes to the storage location default, whose access mode is Read and write.");
    expect(said.ttl).toBe("It is kept for 48h0m0s, from when Velero starts it.");
    expect(said["field-includedNamespaces"]).toBe("Included namespaces: shop, web-*.");
    expect(said["field-includedResources"]).toBe(
      `Included resources: not set. ${TEMPLATE_FIELD_WORDS.includedResources.notSet}`,
    );
    expect(said["not-listed"]).toBe(BACKUP_CREATE_VIEW_WORDS.notListed(["web-*"]));
    expect(said.resolved).toBe(BACKUP_CREATE_VIEW_WORDS.resolved);
  });

  it("says the time to live of the server when none is set, and no warning of a global policy without resource filters", () => {
    const meaning = backupCreateMeaning(body({ storageLocation: "default" }), { listed: ["shop"] });
    const said = Object.fromEntries(meaning.map((part) => [part.id, part.words]));

    expect(said.ttl).toBe(
      "It is kept for the time to live the server sets, 720 hours unless it is started with another, from when Velero starts it.",
    );
    expect(said.location).toBe("It goes to the storage location default.");
    expect(said["global-policy"]).toBeUndefined();
    expect(said["not-listed"]).toBeUndefined();
    // A selector is said as the API takes it.
    const selected = backupCreateMeaning(body({ storageLocation: "default", labelSelector: "app=web" }));

    expect(selected.find((part) => part.id === "field-labelSelector")?.words).toBe(
      'Label selector: {"matchLabels":{"app":"web"}}.',
    );
  });

  it("says what a choice set does, and the excluded resources Velero adds", () => {
    expect(fieldWords("includeClusterResources", false)).toBe(
      "Cluster-scoped resources: false. Left out, the ones an action adds included.",
    );
    expect(fieldWords("snapshotVolumes", true)).toBe(
      `Snapshot volumes: true. ${TEMPLATE_FIELD_WORDS.snapshotVolumes.true}`,
    );
    expect(fieldWords("defaultVolumesToFsBackup", false)).toBe(
      `File system backup of every volume: false. ${TEMPLATE_FIELD_WORDS.defaultVolumesToFsBackup.false}`,
    );
    expect(fieldWords("snapshotMoveData", undefined)).toBe(
      `Move the data of snapshots: not set. ${TEMPLATE_FIELD_WORDS.snapshotMoveData.notSet}`,
    );
    expect(fieldWords("ttl", "48h0m0s")).toBe("Time to live: 48h0m0s.");
    expect(TEMPLATE_FIELD_WORDS.excludedResources.notSet).toContain("volumesnapshots.snapshot.storage.k8s.io");
    expect(TEMPLATE_FIELD_WORDS.excludedResources.notSet).toContain("volumesnapshotcontents.snapshot.storage.k8s.io");
  });

  it("warns of a provider with several snapshot locations and none chosen, and of no other", () => {
    const locations = [
      { name: "aws-east", provider: "aws" },
      { name: "aws-west", provider: "aws" },
      { name: "gcp", provider: "gcp" },
    ];

    expect(providerWarnings([], locations).map((part) => part.id)).toEqual(["provider-aws"]);
    expect(providerWarnings([], locations)[0].words).toBe(
      "The provider aws has 2 snapshot locations and none is chosen: Velero then needs a default of the server for that provider, which the extension does not read, and refuses the backup without one.",
    );
    expect(providerWarnings(["aws-west"], locations)).toEqual([]);
  });

  it("says a read of the locations that did not answer as what it is, never as none", () => {
    expect(locationsReadWords("forbidden", "storage")).toBe(
      "The storage locations of this installation cannot be read: access is denied. None can be chosen, and the review does not open.",
    );
    expect(locationsReadWords("not-served", "snapshot")).toMatch(/^The cluster does not serve the snapshot locations/);
    expect(locationsReadWords("failed", "storage")).toMatch(/could not be read/);
    expect(locationsReadWords("loading", "storage")).toMatch(/not read yet/);
    expect(locationsReadWords("idle", "snapshot")).toBe(
      "The snapshot locations of this installation are not read yet.",
    );
  });

  it("says the global policy of the server of this backup, and the access mode only when it is written", () => {
    const meaning = backupCreateMeaning(body({ storageLocation: "default", includeClusterResources: false }));
    const said = Object.fromEntries(meaning.map((part) => [part.id, part.words]));

    expect(said["global-policy"]).toBe(
      "The resource filters and the cluster-scoped choice make the backup FailedValidation when the server names a global volume policy with filters, a setting the extension does not read.",
    );
    expect(said.location).toBe("It goes to the storage location default.");
  });
});
