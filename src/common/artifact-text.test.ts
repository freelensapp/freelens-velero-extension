import { describe, expect, it } from "vitest";
import {
  ARTIFACT_TABS,
  ASKING,
  againNote,
  allowCommand,
  allowNote,
  artifactOf,
  askAgainNote,
  beginAgain,
  CANCEL_COMMAND,
  CANCELLING,
  cameBy,
  cameThrough,
  inTheWorkspace,
  loadCommand,
  loadedText,
  loadStep,
  missingFile,
  NOT_AGAIN,
  nothingToAsk,
  notTheText,
  requestWords,
  savableNoMore,
  savableUntil,
  saveCommand,
  saveTitle,
  savingText,
  TO_THE_WRITES,
  wouldCreate,
  writesOff,
} from "./artifact-text";
import { downloadFailure } from "./diagnostic-text";
import { ARTIFACT_HOLD_MS, DIAGNOSTIC_REQUEST_LABEL, downloadRequestName, REQUEST_LABELS } from "./ipc";
import { BACKUP_PHASES, operationState, RESTORE_PHASES } from "./phases";
import { emptyRead, failed, loading, succeeded } from "./read-state";

import type { Failure } from "./ipc";
import type { FamilyRead } from "./read-state";
import type { BackupResource, BackupStorageLocationResource, RestoreResource } from "./types";

describe("the tabs of the artifacts of an operation", () => {
  it("names the four after the summary, in their order, each with the kind of request it asks for", () => {
    expect(ARTIFACT_TABS.map((tab) => [tab.id, tab.title])).toEqual([
      ["log", "Log"],
      ["results", "Results"],
      ["resources", "Resources"],
      ["volumes", "Volumes"],
    ]);
    expect(ARTIFACT_TABS.map((tab) => artifactOf(tab.id, "Backup"))).toEqual([
      "BackupLog",
      "BackupResults",
      "BackupResourceList",
      "BackupVolumeInfos",
    ]);
    // The volume information of a restore is named in the singular by the release.
    expect(ARTIFACT_TABS.map((tab) => artifactOf(tab.id, "Restore"))).toEqual([
      "RestoreLog",
      "RestoreResults",
      "RestoreResourceList",
      "RestoreVolumeInfo",
    ]);
  });

  it("says what a tab would create before it creates anything, and for which object", () => {
    expect(wouldCreate("log", { kind: "Backup", name: "nightly", namespace: "velero", cluster: "production" })).toBe(
      "Loading the log of the backup nightly creates a DownloadRequest of the kind BackupLog for that backup, in velero of the cluster production. Velero signs a URL for the request and removes it after ten minutes. Nothing else is written, and nothing is created before the request is shown and confirmed.",
    );
    expect(wouldCreate("volumes", { kind: "Restore", name: "monday", namespace: "velero-b", cluster: "staging" })).toBe(
      "Loading the volume information of the restore monday creates a DownloadRequest of the kind RestoreVolumeInfo for that restore, in velero-b of the cluster staging. Velero signs a URL for the request and removes it after ten minutes. Nothing else is written, and nothing is created before the request is shown and confirmed.",
    );
    // The results are many, and the sentence is written for them as for the others.
    expect(wouldCreate("results", { kind: "Restore", name: "monday", namespace: "velero-b", cluster: "staging" })).toBe(
      "Loading the results of the restore monday creates a DownloadRequest of the kind RestoreResults for that restore, in velero-b of the cluster staging. Velero signs a URL for the request and removes it after ten minutes. Nothing else is written, and nothing is created before the request is shown and confirmed.",
    );
  });

  it("says nothing of whether the file is in the storage before it is asked: the phase may say that it is not", () => {
    for (const tab of ARTIFACT_TABS)
      for (const kind of ["Backup", "Restore"] as const) {
        const said = wouldCreate(tab.id, { kind, name: "nightly", namespace: "velero", cluster: "production" });

        expect([tab.id, kind, /\b(is|are) in the storage\b/.test(said)]).toEqual([tab.id, kind, false]);
        expect([
          tab.id,
          kind,
          said.startsWith(`Loading the ${tab.noun} of the ${kind.toLowerCase()} nightly creates`),
        ]).toEqual([tab.id, kind, true]);
      }
  });
});

describe("the words of a file the store does not have, by the phase of its operation", () => {
  const said = (kind: "Backup" | "Restore", phase: unknown, tab: "log" | "results" | "resources" | "volumes" = "log") =>
    missingFile(tab, kind, operationState(kind, phase));

  it("says that Velero writes nothing for an operation that failed its validation", () => {
    expect(said("Backup", "FailedValidation")).toBe(
      "Velero writes nothing into the storage for a backup that failed its validation: there is no log to read. What it refused is in the summary.",
    );
    expect(said("Restore", "FailedValidation", "results")).toBe(
      "Velero writes nothing into the storage for a restore that failed its validation: there are no results to read. What it refused is in the summary.",
    );
  });

  it("says that the file is written when the work ends, for an operation that did not start or is at work", () => {
    for (const phase of ["New", "Queued", "ReadyToStart", "InProgress"])
      expect([phase, said("Backup", phase, "resources")]).toEqual([
        phase,
        "The resource list of a backup is written into the storage when its work ends: it is not there yet.",
      ]);
    expect(said("Restore", "InProgress", "volumes")).toBe(
      "The volume information of a restore is written into the storage when its work ends: it is not there yet.",
    );
  });

  it("says of an operation that is being deleted that its files are being removed, whatever its work was at", () => {
    // A restore has no phase for its deletion, and a backup may be deleted in any: what is being deleted
    // is said by the view, beside what the phase says. No file of it is said to be written later.
    for (const [kind, phases] of [
      ["Backup", ["New", "Queued", "InProgress", "Finalizing", "Completed", "Failed", "Deleting"]],
      ["Restore", ["New", "InProgress", "Completed", "PartiallyFailed"]],
    ] as const)
      for (const phase of phases)
        expect([
          kind,
          phase,
          missingFile("results", kind, { ...operationState(kind, phase), lifecycle: "deleting" }),
        ]).toEqual([
          kind,
          phase,
          `The results of this ${kind.toLowerCase()} are not in the storage: the ${kind.toLowerCase()} is being deleted, and its files are being removed.`,
        ]);
    // One that failed its validation never had a file: that is what is said of it, deleted or not.
    expect(
      missingFile("log", "Restore", { ...operationState("Restore", "FailedValidation"), lifecycle: "deleting" }),
    ).toBe(said("Restore", "FailedValidation"));
  });

  it("says that the file is not in the storage for an operation whose work ended, and that the log of a backup is best effort", () => {
    for (const phase of [
      "Completed",
      "PartiallyFailed",
      "WaitingForPluginOperations",
      "WaitingForPluginOperationsPartiallyFailed",
      "Finalizing",
      "FinalizingPartiallyFailed",
    ]) {
      expect([phase, said("Backup", phase, "results")]).toEqual([
        phase,
        "The results of this backup are not in the storage: they were removed from it, or they were never written there.",
      ]);
      // The upload of the log of a backup does not fail the backup: one can end without it.
      expect([phase, said("Backup", phase)]).toEqual([
        phase,
        "The log of this backup is not in the storage: it was removed from it, or it was never written there. Velero uploads the log of a backup as best it can, and a backup ends without it when the upload fails.",
      ]);
    }
    // The log of a restore is not best effort: nothing more is said of it.
    expect(said("Restore", "Completed")).toBe(
      "The log of this restore is not in the storage: it was removed from it, or it was never written there.",
    );
  });

  it("says that an operation that failed at work may have written its files, or none", () => {
    expect(said("Backup", "Failed")).toBe(
      "The log of this backup is not in the storage. Velero may have written the files of a backup that failed before it failed, or none if it failed before it wrote them.",
    );
    expect(said("Restore", "Failed", "volumes")).toBe(
      "The volume information of this restore is not in the storage. Velero may have written the files of a restore that failed before it failed, or none if it failed before it wrote them.",
    );
  });

  it("says that the files of a backup that is being deleted are being removed", () => {
    expect(said("Backup", "Deleting", "resources")).toBe(
      "The resource list of this backup is not in the storage: the backup is being deleted, and its files are being removed.",
    );
  });

  it("claims nothing of a phase it does not know, or of an object that reports none", () => {
    for (const phase of [undefined, "", "Paused", 7])
      expect([phase, said("Backup", phase)]).toEqual([
        phase,
        "The log of this backup is not in the storage. What its phase says of its files is not known.",
      ]);
    // A phase of the other kind is not one of this kind.
    expect(said("Restore", "Queued")).toBe(
      "The log of this restore is not in the storage. What its phase says of its files is not known.",
    );
  });

  it("has words for every phase of the release, each naming the file that was asked", () => {
    for (const [kind, phases] of [
      ["Backup", BACKUP_PHASES],
      ["Restore", RESTORE_PHASES],
    ] as const)
      for (const phase of phases)
        for (const tab of ARTIFACT_TABS) {
          const words = said(kind, phase, tab.id);

          expect([kind, phase, tab.id, words.includes(tab.noun)]).toEqual([kind, phase, tab.id, true]);
          expect(words).not.toMatch(/undefined|not known/);
        }
  });
});

describe("the words of the steps of a load", () => {
  it("says each step the main process is at, with what it counts", () => {
    // The first step is said of every load, and claims no wait: a load waits only while two others run.
    expect(loadStep("queue")).toBe(
      "Starting the load. Two artifacts at most are loaded at the same time: a third one waits for its turn.",
    );
    expect(loadStep("target")).toBe("Reading the object the artifact is of.");
    expect(loadStep("backup")).toBe("Reading the backup of the restore.");
    expect(loadStep("location")).toBe("Reading the storage location.");
    expect(loadStep("certificate")).toBe("Reading the certificate of the storage location.");
    expect(loadStep("creation", undefined, "nightly-0e7c5b7a")).toBe("Creating the DownloadRequest nightly-0e7c5b7a.");
    expect(loadStep("wait", 0, "nightly-0e7c5b7a")).toBe(
      "The DownloadRequest nightly-0e7c5b7a is created. Waiting for Velero to sign its URL.",
    );
    expect(loadStep("wait", 7, "nightly-0e7c5b7a")).toBe(
      "The DownloadRequest nightly-0e7c5b7a is created. Waiting for Velero to sign its URL: 7 seconds so far, of thirty at most.",
    );
    for (const step of ["route", "service", "endpoints", "pod", "forward"])
      expect([step, loadStep(step)]).toEqual([step, "Finding the way to the store."]);
    expect(loadStep("download")).toBe("Downloading and decompressing the file.");
    expect(loadStep("download", 1536)).toBe("Downloading and decompressing the file: 1.5 KiB so far.");
    // A download of which no byte arrived yet counts none, and says so: it is not the step without a count.
    expect(loadStep("download", 0)).toBe("Downloading and decompressing the file: 0 B so far.");
    expect(loadStep("delivery")).toBe("Checking that the object is still the one that was asked.");
    expect(loadStep("pages", 3, undefined, 8)).toBe("Taking the text from the main process: page 3 of 8.");
    // A step is said without what it counts to who does not see: the step is told, and not each count.
    expect(loadStep("pages")).toBe("Taking the text from the main process.");
    expect(loadStep("wait", undefined, "nightly-0e7c5b7a")).toBe(
      "The DownloadRequest nightly-0e7c5b7a is created. Waiting for Velero to sign its URL.",
    );
    // A step this version does not know is said as it is named, and nothing is claimed of it.
    expect(loadStep("a-later-step")).toBe("Loading: a-later-step.");
    // And so is one named as something every object has: its words are words, whatever it is named.
    for (const step of ["__proto__", "constructor", "toString", "hasOwnProperty", "valueOf"])
      expect([step, loadStep(step)]).toEqual([step, `Loading: ${step}.`]);
  });

  it("says of a text the main process did not give as it said it held it that nothing of it is shown", () => {
    expect(notTheText("nightly-0e7c5b7a", "velero")).toBe(
      "What the main process gave of the text is not what it said it held: a page that is not the one that was asked, or more text than an artifact has. Nothing of it is shown. The DownloadRequest nightly-0e7c5b7a stays in velero until Velero removes it.",
    );
  });
});

describe("what is said before any request, of an operation Velero signs no URL for", () => {
  const NS = "velero-a";
  const backup = (name: string, storageLocation?: string): BackupResource => ({
    metadata: { name, namespace: NS, uid: `${name}-uid` },
    spec: storageLocation === undefined ? {} : { storageLocation },
  });
  const restore = (name: string, backupName?: string): RestoreResource => ({
    metadata: { name, namespace: NS, uid: `${name}-uid` },
    spec: backupName === undefined ? { scheduleName: "nightly" } : { backupName },
  });
  // A backup the release ended: it took it, and wrote into it the storage location it was given.
  const ended = (item: BackupResource): BackupResource => ({ ...item, status: { phase: "Completed" } });
  const location = (name: string, namespace = NS): BackupStorageLocationResource => ({ metadata: { name, namespace } });
  const read = (
    locations: FamilyRead<BackupStorageLocationResource> = succeeded([location("default")], 1_000),
    backups: FamilyRead<BackupResource> = succeeded([backup("nightly", "default"), backup("moved", "gone")], 1_000),
  ) => ({ backups, storageLocations: locations });
  const NO_BACKUP =
    "The backup of the restore monday is not there: the restore names none, or the one it names is not in velero-a. Velero signs no URL for such a restore, and no request was created.";
  const NO_LOCATION = (target: string) =>
    `The storage location of the backup of ${target} is not in velero-a: Velero signs no URL without it, and no request was created.`;

  it("says of a restore that names no backup that Velero signs no URL for it, in the words the main process ends with", () => {
    // Velero refused the restore before it chose a backup: asked from a schedule that has none.
    expect(nothingToAsk("log", "Restore", restore("monday"), read())).toBe(NO_BACKUP);
    expect(nothingToAsk("volumes", "Restore", { ...restore("monday"), spec: { backupName: "" } }, read())).toBe(
      NO_BACKUP,
    );
    expect(nothingToAsk("results", "Restore", { metadata: restore("monday").metadata }, read())).toBe(NO_BACKUP);
    // They are the words of the request itself, for that step.
    expect(NO_BACKUP).toBe(
      downloadFailure("not-found", "backup", { artifact: "RestoreLog", name: "monday", namespace: NS }).text,
    );
    // It needs nothing of what the installation read: the object says it.
    expect(nothingToAsk("log", "Restore", restore("monday"), read(emptyRead(), emptyRead()))).toBe(NO_BACKUP);
  });

  it("says of a backup whose storage location is not there that Velero signs no URL without it", () => {
    // The backup ended and names none: the object says it, whatever was read of the locations.
    expect(nothingToAsk("log", "Backup", ended(backup("nightly")), read())).toBe(NO_LOCATION("the backup nightly"));
    expect(nothingToAsk("log", "Backup", ended(backup("nightly", "")), read())).toBe(NO_LOCATION("the backup nightly"));
    expect(nothingToAsk("log", "Backup", ended(backup("nightly")), read(emptyRead()))).toBe(
      NO_LOCATION("the backup nightly"),
    );
    // The one it names is not among the locations that were read, or is of another namespace.
    expect(nothingToAsk("resources", "Backup", backup("moved", "gone"), read())).toBe(NO_LOCATION("the backup moved"));
    expect(
      nothingToAsk("log", "Backup", backup("nightly", "default"), read(succeeded([location("default", "other")], 1))),
    ).toBe(NO_LOCATION("the backup nightly"));
    expect(NO_LOCATION("the backup moved")).toBe(
      downloadFailure("not-found", "location", { artifact: "BackupResourceList", name: "moved", namespace: NS }).text,
    );
    // The label the release writes on a backup is not what the request reads: the spec is.
    expect(
      nothingToAsk(
        "log",
        "Backup",
        {
          ...ended(backup("nightly")),
          metadata: { ...backup("nightly").metadata, labels: { "velero.io/storage-location": "default" } },
        },
        read(),
      ),
    ).toBe(NO_LOCATION("the backup nightly"));
  });

  it("says of a backup that did not start, and names no storage location yet, what its phase says and no fault of the storage", () => {
    // The release writes the storage location into a backup that names none when it starts the backup:
    // one that waits for its turn behind another names none, and its storage is not at fault.
    const NAMED =
      "Velero names the storage location of a backup when it starts the backup, and signs no URL for a backup that names none: no request is offered until then.";
    const at = (phase: string | undefined, name = "second", storageLocation?: string): BackupResource => ({
      ...backup(name, storageLocation),
      ...(phase === undefined ? {} : { status: { phase } }),
    });

    for (const phase of ["New", "Queued", "ReadyToStart"]) {
      expect([phase, nothingToAsk("log", "Backup", at(phase), read())]).toEqual([
        phase,
        `The log of a backup is written into the storage when its work ends: it is not there yet. ${NAMED}`,
      ]);
      // They are the words a missing file has for that phase, and what the request would end with is not said.
      expect(nothingToAsk("log", "Backup", at(phase), read())).toContain(
        missingFile("log", "Backup", operationState("Backup", phase)),
      );
      expect(nothingToAsk("log", "Backup", at(phase), read())).not.toContain("is not in velero-a");
    }
    expect(nothingToAsk("results", "Backup", at("Queued", "second", ""), read(emptyRead()))).toBe(
      `The results of a backup are written into the storage when its work ends: they are not there yet. ${NAMED}`,
    );
    // An object Velero has not given a phase names none for the same reason, and nothing is said of its work.
    expect(nothingToAsk("volumes", "Backup", at(undefined), read())).toBe(
      `This backup reports no phase, and names no storage location. ${NAMED}`,
    );
    // A backup the release took has the location it was given: one that names none after that has none.
    for (const phase of ["FailedValidation", "InProgress", "Finalizing", "Completed", "Failed", "Deleting", "Archived"])
      expect([phase, nothingToAsk("log", "Backup", at(phase), read())]).toEqual([
        phase,
        NO_LOCATION("the backup second"),
      ]);
    // One that waits and names a location that is not there is told so: that is what it names.
    expect(nothingToAsk("log", "Backup", at("Queued", "moved", "gone"), read())).toBe(NO_LOCATION("the backup moved"));
    // And one that waits with a location that is there has what the request needs, as far as the view read.
    expect(nothingToAsk("log", "Backup", at("Queued", "nightly", "default"), read())).toBeUndefined();
  });

  it("says the same of a restore whose backup is at a storage location that is not there", () => {
    expect(nothingToAsk("log", "Restore", restore("monday", "moved"), read())).toBe(NO_LOCATION("the restore monday"));
    // The backup was read before its family stopped answering: what it names is still what it names.
    expect(
      nothingToAsk(
        "log",
        "Restore",
        restore("monday", "unplaced"),
        read(undefined, failed(succeeded([backup("unplaced")], 1_000), "failed")),
      ),
    ).toBe(NO_LOCATION("the restore monday"));
  });

  it("says nothing when the request has what it needs, as far as the view read", () => {
    expect(nothingToAsk("log", "Backup", backup("nightly", "default"), read())).toBeUndefined();
    expect(nothingToAsk("log", "Restore", restore("monday", "nightly"), read())).toBeUndefined();
    // While the locations are read again, they are what the read before said.
    expect(
      nothingToAsk("log", "Backup", backup("nightly", "default"), read(loading(succeeded([location("default")], 1)))),
    ).toBeUndefined();
  });

  it("claims nothing of what was not read: a list that is denied, failed or of an earlier read is not an absence", () => {
    const before = succeeded([location("default")], 1_000);

    for (const locations of [
      emptyRead<BackupStorageLocationResource>(),
      loading(emptyRead<BackupStorageLocationResource>()),
      failed(emptyRead<BackupStorageLocationResource>(), "forbidden"),
      failed(emptyRead<BackupStorageLocationResource>(), "not-served"),
      failed(emptyRead<BackupStorageLocationResource>(), "failed"),
      failed(before, "failed"),
    ])
      expect([locations.status, nothingToAsk("log", "Backup", backup("moved", "gone"), read(locations))]).toEqual([
        locations.status,
        undefined,
      ]);
    // The backup a restore names is not among what was read: whether it is there is what the request reads.
    expect(nothingToAsk("log", "Restore", restore("monday", "expired"), read())).toBeUndefined();
    expect(nothingToAsk("log", "Restore", restore("monday", "nightly"), read(undefined, emptyRead()))).toBeUndefined();
  });
});

describe("the words of the states of a tab", () => {
  it("says the state of the gate while writes are not on, and the way to where they are turned on", () => {
    expect(writesOff()).toBe("Writes are off for this installation: they are turned on in the target bar.");
    expect(writesOff(true)).toBe("Whether writes are on is not known: the target bar asks the main process again.");
    expect(TO_THE_WRITES).toBe("Go to the writes in the target bar");
  });

  it("names the command by the kind it creates, and says that a load after another is another request", () => {
    expect(loadCommand("log", "Backup")).toBe("Create a DownloadRequest of the kind BackupLog");
    expect(loadCommand("volumes", "Restore")).toBe("Create a DownloadRequest of the kind RestoreVolumeInfo");
    expect(loadCommand("results", "Backup", true)).toBe("Create another DownloadRequest of the kind BackupResults");
    // The text that is shown stays through the confirmation, and goes when the new request is created.
    expect(againNote("log")).toBe(
      "Loading the log again creates another DownloadRequest, and what is shown goes when that request is created.",
    );
    expect(againNote("results")).toBe(
      "Loading the results again creates another DownloadRequest, and what is shown goes when that request is created.",
    );
    expect(ASKING).toBe("Asking the main process for the confirmation of the request.");
    expect(CANCEL_COMMAND).toBe("Cancel the load");
    // Said at whatever step the load is: a request that runs is stopped by the main process, and a load
    // that is past it, or before it, is stopped where it is.
    expect(CANCELLING).toBe("Cancelling: the load is stopped at the step it is at, and the tab says how it ended.");
  });

  it("says the request a tab would create as its confirmation shows it: its name, its spec and its target", () => {
    // The labels are the ones the main process creates with: the one that names the extension, and the one
    // that carries the identifier, which is made when the request is confirmed.
    const labels = {
      ...REQUEST_LABELS,
      [DIAGNOSTIC_REQUEST_LABEL]: "the identifier of the request",
    };

    expect(requestWords("log", { kind: "Backup", name: "nightly" })).toEqual({
      name: "nightly-, followed by the identifier of the request",
      labels,
      spec: "target.kind BackupLog, target.name nightly",
      target: "The backup nightly",
    });
    expect(requestWords("volumes", { kind: "Restore", name: "monday" })).toEqual({
      name: "monday-, followed by the identifier of the request",
      labels,
      spec: "target.kind RestoreVolumeInfo, target.name monday",
      target: "The restore monday",
    });
    expect(Object.keys(labels)).toEqual(["app.kubernetes.io/managed-by", "freelensapp.io/diagnostic-request"]);
    // The name is the one the main process gives the request, up to its identifier.
    expect(requestWords("log", { kind: "Backup", name: "nightly" }).name.split(",")[0]).toBe(
      downloadRequestName("nightly", ""),
    );
  });

  it("says what asking again does after a load that ended, and what is offered where it is not safe", () => {
    expect(askAgainNote("velero")).toBe("Asking again creates another DownloadRequest in velero.");
    // After a load that ended before anything was created, the request that is asked is no other one.
    expect(askAgainNote("velero", false)).toBe("Asking again creates a DownloadRequest in velero.");
    expect(NOT_AGAIN).toBe(
      "The main process says that asking again as it was asked is not safe after this. The command takes the tab back to where it was before the request, and asks nothing.",
    );
    // The one command of such a tab, in the name of where it leads: the first state, or the text the
    // tab still shows.
    expect(beginAgain(false)).toBe("Take the tab back to its first state");
    expect(beginAgain(true)).toBe("Go back to the text that is shown");
  });

  it("says a file the store did not have in the past, with when it was asked for, once that is known", () => {
    const said = (kind: "Backup" | "Restore", phase: unknown, tab: "log" | "results" = "log") =>
      missingFile(tab, kind, operationState(kind, phase), "9:30:00");

    // The operation may have gone on since: what the store held is said of the moment it was asked.
    expect(said("Backup", "InProgress")).toBe(
      "The log of a backup is written into the storage when its work ends: it was not there when it was asked for, at 9:30:00.",
    );
    expect(said("Restore", "New", "results")).toBe(
      "The results of a restore are written into the storage when its work ends: they were not there when they were asked for, at 9:30:00.",
    );
    expect(said("Backup", "Completed", "results")).toBe(
      "The results of this backup were not in the storage when they were asked for, at 9:30:00: they were removed from it, or they were never written there.",
    );
    expect(said("Backup", "Completed")).toBe(
      "The log of this backup was not in the storage when it was asked for, at 9:30:00: it was removed from it, or it was never written there. Velero uploads the log of a backup as best it can, and a backup ends without it when the upload fails.",
    );
    expect(said("Backup", "Failed")).toBe(
      "The log of this backup was not in the storage when it was asked for, at 9:30:00. Velero may have written the files of a backup that failed before it failed, or none if it failed before it wrote them.",
    );
    expect(said("Backup", "Deleting")).toBe(
      "The log of this backup was not in the storage when it was asked for, at 9:30:00: the backup is being deleted, and its files are being removed.",
    );
    expect(said("Backup", undefined)).toBe(
      "The log of this backup was not in the storage when it was asked for, at 9:30:00. What its phase says of its files is not known.",
    );
    // What Velero never writes is said as it is: no time changes it.
    expect(said("Backup", "FailedValidation")).toBe(
      missingFile("log", "Backup", operationState("Backup", "FailedValidation")),
    );
  });

  it("names the command that allows what a download needs by what it allows, and says what becomes of it", () => {
    expect(allowCommand({ what: "origin", origin: "https://storage.example:9000", location: "velero/default" })).toBe(
      "Allow downloads from https://storage.example:9000 for the storage location default of velero",
    );
    expect(allowCommand({ what: "private", origin: "https://storage.example:9000" })).toBe(
      "Allow a connection to a private address of https://storage.example:9000",
    );
    expect(allowCommand({ what: "http", origin: "http://minio.storage:9000" })).toBe(
      "Allow a connection to http://minio.storage:9000 that is not encrypted, made directly from this machine",
    );
    expect(allowNote("log")).toBe(
      "What is allowed is kept for this cluster until it is taken back in the target bar. The log is then asked again, which creates another DownloadRequest.",
    );
    expect(allowNote("results")).toBe(
      "What is allowed is kept for this cluster until it is taken back in the target bar. The results are then asked again, which creates another DownloadRequest.",
    );
  });
});

describe("what the details of the host say of the artifacts of an operation", () => {
  it("says that the four are in the workspace, each asked for there, and that the details load none", () => {
    expect(inTheWorkspace("Backup")).toBe(
      "The log, the results, the resource list and the volume information of this backup are in its workspace, each loaded there when it is asked for. None of them is loaded here.",
    );
    expect(inTheWorkspace("Restore")).toBe(
      "The log, the results, the resource list and the volume information of this restore are in its workspace, each loaded there when it is asked for. None of them is loaded here.",
    );
  });

  it("says of a text that was loaded when and how much of it there is, and apart the request it came through", () => {
    const value = {
      request: { name: "nightly-0e7c5b7a", uid: "request-uid" },
      size: 1536,
      pages: 1,
      route: { mode: "tunnel" as const, encrypted: false, origin: "http://seaweedfs.velero.svc:8333" },
    };

    expect(loadedText("log", value, "10/5/2026, 9:30:00 AM")).toBe(
      "The log was loaded at 10/5/2026, 9:30:00 AM (1.5 KiB of text).",
    );
    expect(loadedText("results", { ...value, size: 0 }, "noon")).toBe("The results were loaded at noon (0 B of text).");
    expect(loadedText("volumes", { ...value, size: 64 * 1024 * 1024 }, "noon")).toBe(
      "The volume information was loaded at noon (64.0 MiB of text).",
    );
    // The request is said after the text, with the way it came by: its sentence is of the file, on every tab.
    expect(cameThrough(value.request.name)).toBe("The file came through the DownloadRequest nightly-0e7c5b7a.");
    // The unit changes at 1024 of the one before it, and not after.
    expect(loadedText("log", { ...value, size: 1023 }, "noon")).toContain(" (1023 B of text).");
    expect(loadedText("log", { ...value, size: 1024 }, "noon")).toContain(" (1.0 KiB of text).");
    expect(loadedText("log", { ...value, size: 1024 ** 2 }, "noon")).toContain(" (1.0 MiB of text).");
  });

  it("says the way a text came by: through the cluster or directly, encrypted or not, and from which origin", () => {
    expect(cameBy({ mode: "tunnel", encrypted: false, origin: "http://seaweedfs.velero.svc:8333" })).toBe(
      "It came from http://seaweedfs.velero.svc:8333 through a tunnel to the Pod of the store, opened through the API server of the cluster. The connection to the store was not encrypted: its bytes travelled inside the connection to the API server, and inside the cluster.",
    );
    expect(cameBy({ mode: "tunnel", encrypted: true, origin: "https://minio.storage.svc:9000" })).toBe(
      "It came from https://minio.storage.svc:9000 through a tunnel to the Pod of the store, opened through the API server of the cluster, over TLS that was verified.",
    );
    expect(cameBy({ mode: "direct", encrypted: true, origin: "https://s3.eu-west-1.amazonaws.com" })).toBe(
      "It came from https://s3.eu-west-1.amazonaws.com, directly from this machine, over TLS that was verified.",
    );
    // What the operator allowed for that origin is said for what it is.
    expect(cameBy({ mode: "direct", encrypted: false, origin: "http://storage.example:9000" })).toBe(
      "It came from http://storage.example:9000, directly from this machine. The connection was not encrypted: that was allowed for this origin.",
    );
  });
});

describe("the words of the saving of a text", () => {
  it("names the command by what it saves", () => {
    expect(ARTIFACT_TABS.map((tab) => saveCommand(tab.id))).toEqual([
      "Save the log to a file",
      "Save the results to a file",
      "Save the resource list to a file",
      "Save the volume information to a file",
    ]);
  });

  it("says over the dialog of a saving what is saved, of which operation, installation and cluster", () => {
    expect(saveTitle("BackupLog", "nightly", "velero", "production")).toBe(
      "Save the log of the backup nightly, of velero in the cluster production",
    );
    expect(saveTitle("RestoreVolumeInfo", "monday", "velero-b", "staging")).toBe(
      "Save the volume information of the restore monday, of velero-b in the cluster staging",
    );
    // Every artifact of every tab has its words, by the kind of its operation.
    for (const tab of ARTIFACT_TABS)
      for (const kind of ["Backup", "Restore"] as const)
        expect([tab.id, kind, saveTitle(artifactOf(tab.id, kind), "x", "ns", "c")]).toEqual([
          tab.id,
          kind,
          `Save the ${tab.noun} of the ${kind.toLowerCase()} x, of ns in the cluster c`,
        ]);
  });

  it("says what the saving is at: the dialog, the file that was written, the dialog that was closed", () => {
    expect(savingText("log", { state: "none" })).toBeUndefined();
    expect(savingText("log", { state: "asked" })).toBe(
      "Choose the file in the dialog of Freelens: the log is written there, on this machine, and nothing is written to the cluster.",
    );
    expect(savingText("results", { state: "asked" })).toBe(
      "Choose the file in the dialog of Freelens: the results are written there, on this machine, and nothing is written to the cluster.",
    );
    expect(savingText("log", { state: "saved" })).toBe("The log was saved into the file that was chosen.");
    expect(savingText("results", { state: "saved" })).toBe("The results were saved into the file that was chosen.");
    expect(savingText("resources", { state: "left" })).toBe(
      "No file was chosen: the resource list was not saved, and nothing was written.",
    );
    expect(savingText("results", { state: "left" })).toBe(
      "No file was chosen: the results were not saved, and nothing was written.",
    );
  });

  it("says until when a text can be saved, and after that that the main process let its copy go", () => {
    // The words say the minutes the main process holds a text for.
    expect(ARTIFACT_HOLD_MS).toBe(10 * 60 * 1000);
    expect(savableUntil("log", "9:40:00")).toBe(
      "The log can be saved to a file until 9:40:00 at most: the main process keeps its copy for 10 minutes after a load, or less when it needs the room for other texts.",
    );
    expect(savableUntil("results", "9:40:00")).toBe(
      "The results can be saved to a file until 9:40:00 at most: the main process keeps its copy for 10 minutes after a load, or less when it needs the room for other texts.",
    );
    expect(savableNoMore("volumes", "9:40:00")).toBe(
      "The main process kept its copy of the volume information until 9:40:00, and let it go. What is shown stays: it is saved only after it is loaded again, which creates another DownloadRequest.",
    );
    expect(savableNoMore("results", "9:40:00")).toBe(
      "The main process kept its copy of the results until 9:40:00, and let it go. What is shown stays: they are saved only after they are loaded again, which creates another DownloadRequest.",
    );
  });

  it("says why a file was not written in the words of the main process, and nothing of its own", () => {
    const failure: Failure = {
      ok: false,
      code: "request-failed",
      stage: "save",
      retry: true,
      text: "The file could not be written. The text is still held: choose another file, or load it again.",
    };

    expect(savingText("log", { state: "failed", failure })).toBe(failure.text);
    expect(savingText("results", { state: "failed", failure })).toBe(failure.text);
  });
});
