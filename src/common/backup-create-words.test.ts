import { describe, expect, it } from "vitest";
import { BACKUP_CREATE_VIEW_WORDS, backupCreateMeaning, phaseWords, TEMPLATE_FIELD_WORDS } from "./backup-create-words";
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
    expect(phaseWords("ReadyToStart")).toBe("Velero wrote its phase: ReadyToStart. It starts it when no backup runs.");
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
});
