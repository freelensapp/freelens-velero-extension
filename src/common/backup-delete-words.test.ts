// The words of the deletion of one backup (SPEC-0017, DELETE-01, DELETE-03, DELETE-05, DELETE-06): the command for
// each phase of the release and for none, what the review says in the order Velero deletes, the other requests of the
// backup, and the six ends of the result, never the backup deleted before a read showed it gone.

import { describe, expect, it } from "vitest";
import { BACKUP_DELETE_VIEW_WORDS, deletedWords, deleteMeaning, deleteOffered } from "./backup-delete-words";
import { BACKUP_PHASES } from "./phases";

describe("Delete backup for each phase of a backup", () => {
  it("is not offered for a backup in progress, waiting for its plugins or finalizing, and says why", () => {
    for (const phase of [
      "InProgress",
      "WaitingForPluginOperations",
      "WaitingForPluginOperationsPartiallyFailed",
      "Finalizing",
      "FinalizingPartiallyFailed",
    ])
      expect(deleteOffered(phase)).toEqual({
        offered: false,
        words: `The backup is ${phase}: Velero refuses to delete a backup in progress, waiting for its plugins or finalizing, and Delete backup is offered once it ends.`,
      });
  });

  it("is offered for a backup Deleting as a new attempt, for one Velero has not started, and for one that ended, and for every phase of the release", () => {
    expect(deleteOffered("Deleting")).toEqual({
      offered: true,
      words:
        "The backup is Deleting: Velero is deleting it, or a deletion of it failed and it stays Deleting. A new request tries the deletion again.",
    });
    for (const phase of [undefined, "New", "Queued", "ReadyToStart"])
      expect(deleteOffered(phase)).toEqual({
        offered: true,
        words: `The backup is ${phase ?? "without a phase"}: Velero has not started it, and deletes it before it starts it.`,
      });
    for (const phase of ["Completed", "PartiallyFailed", "Failed", "FailedValidation"])
      expect(deleteOffered(phase)).toEqual({ offered: true });
    // Each phase of the release is one of the above.
    const said = new Set([
      "InProgress",
      "WaitingForPluginOperations",
      "WaitingForPluginOperationsPartiallyFailed",
      "Finalizing",
      "FinalizingPartiallyFailed",
      "Deleting",
      "New",
      "Queued",
      "ReadyToStart",
      "Completed",
      "PartiallyFailed",
      "Failed",
      "FailedValidation",
    ]);

    expect(BACKUP_PHASES.filter((phase) => !said.has(phase))).toEqual([]);
  });
});

describe("what the review of a deletion says", () => {
  it("says the one request, what Velero deletes in its order, what it deletes only when nothing failed, the location and its refusals, the other installations, and that it cannot be undone", () => {
    expect(deleteMeaning("shop-1", { backupPhase: "Completed", storageLocation: "default" })).toEqual([
      {
        id: "request",
        words:
          "One DeleteBackupRequest of the backup shop-1, which Velero processes, and nothing else: no DELETE of the Backup, which would leave its files in the store, from where the sync of the location brings it back.",
      },
      {
        id: "order",
        words:
          "Velero deletes, in this order: what the plugins of the backup delete; its volume snapshots; the snapshots of its pod volume backups; the data it moved, with its uploads; its files in the store; every restore of the backup, with the files of each; and the Backup itself.",
      },
      {
        id: "failure",
        words:
          "The files in the store and the Backup are deleted only when nothing failed before them; the restores are deleted even when a step after the one of the plugins failed. A backup Velero cannot delete stays Deleting, with the errors of the request.",
      },
      {
        id: "location",
        words:
          "Velero refuses the request when the storage location default of the backup is not there, is ReadOnly or is not Available.",
      },
      {
        id: "installations",
        words:
          "Every installation that syncs the same storage location deletes, at its next sync, its own Backup object whose files are gone.",
      },
      { id: "undone", words: "This cannot be undone: what Velero deletes is not brought back." },
    ]);
  });

  it("says the phase of a backup Deleting or not started, after the request", () => {
    expect(deleteMeaning("shop-1", { backupPhase: "Deleting" }).map((part) => part.id)).toEqual([
      "request",
      "phase",
      "order",
      "failure",
      "location",
      "installations",
      "undone",
    ]);
    expect(deleteMeaning("shop-1").find((part) => part.id === "phase")?.words).toBe(deleteOffered(undefined).words);
  });

  it("says what the views read of the location when Velero would refuse the request, and a backup that names none", () => {
    const location = (context: Parameters<typeof deleteMeaning>[1]) =>
      deleteMeaning("shop-1", { storageLocation: "default", ...context }).find((part) => part.id === "location")?.words;
    const refuses =
      "Velero refuses the request when the storage location default of the backup is not there, is ReadOnly or is not Available.";

    expect(location({ location: { missing: true } })).toBe(
      `${refuses} The views do not read a location of that name in this installation: Velero would refuse it.`,
    );
    expect(location({ location: { accessMode: "ReadOnly", phase: "Available" } })).toBe(
      `${refuses} The views read it ReadOnly: Velero would refuse it until it is ReadWrite.`,
    );
    expect(location({ location: { accessMode: "ReadWrite", phase: "Unavailable" } })).toBe(
      `${refuses} The views read it Unavailable: Velero would refuse it until it is Available.`,
    );
    expect(location({ location: { accessMode: "ReadWrite", phase: "Available" } })).toBe(refuses);
    expect(location({ location: {} })).toBe(refuses);
    expect(deleteMeaning("shop-1").find((part) => part.id === "location")?.words).toBe(
      "The backup names no storage location: Velero refuses the request when its location is not there, is ReadOnly or is not Available.",
    );
  });

  it("says the other requests of the backup, which Velero deletes before it starts this one, and nothing when there are none or they were not read", () => {
    const others = (count?: number) =>
      deleteMeaning("shop-1", count === undefined ? {} : { others: count }).find((part) => part.id === "others")?.words;

    expect(others(1)).toBe(
      "Another request to delete this backup is there: Velero deletes it before it starts this one.",
    );
    expect(others(3)).toBe(
      "3 other requests to delete this backup are there: Velero deletes them before it starts this one.",
    );
    expect(others(0)).toBeUndefined();
    expect(others()).toBeUndefined();
    expect(deleteMeaning("shop-1", { others: 2 }).map((part) => part.id)).toEqual([
      "request",
      "phase",
      "order",
      "failure",
      "location",
      "others",
      "installations",
      "undone",
    ]);
  });
});

describe("what the result of a deletion says", () => {
  it("says each of the six ends of the request and the backup read together, with each error as Velero wrote it", () => {
    expect(deletedWords("shop-1", { end: "completed" })).toEqual([
      "The backup shop-1 is not there any more: Velero deleted it, and the request with it, since nothing failed.",
    ]);
    expect(deletedWords("shop-1", { end: "replaced", phase: "Completed" })).toEqual([
      "The request is not there any more, and the backup shop-1 is: another request for the same backup, which Velero started after this one, took its place, since Velero deletes the other requests of a backup before it starts. The view of the backup says how it goes.",
    ]);
    expect(
      deletedWords("shop-1", {
        end: "refused",
        phase: "Completed",
        errors: ["backup deletion failed: backup storage location default is ReadOnly"],
      }),
    ).toEqual([
      "Velero refused the request, and deleted nothing: the backup shop-1 keeps its phase, Completed. Each error is as Velero wrote it:",
      "backup deletion failed: backup storage location default is ReadOnly",
    ]);
    // A refusal of a backup that went says no phase.
    expect(deletedWords("shop-1", { end: "refused", errors: ["backup deletion failed: backup not found"] })).toEqual([
      "Velero refused the request, and deleted nothing. Each error is as Velero wrote it:",
      "backup deletion failed: backup not found",
    ]);
    expect(deletedWords("shop-1", { end: "failed", phase: "Deleting", errors: ["one", "two"], errorsLeft: 3 })).toEqual(
      [
        "Velero started the deletion of the backup shop-1, and a step of it failed: the backup stays Deleting, and a new request tries the deletion again. Each error is as Velero wrote it:",
        "one",
        "two",
        "Velero wrote 3 more errors: `velero backup describe shop-1` lists the attempts to delete it with their errors.",
      ],
    );
    expect(deletedWords("shop-1", { end: "in-progress", phase: "Deleting" })).toEqual([
      "Velero is deleting the backup shop-1: the request was InProgress when it was last read. The view of the backup says how it goes.",
    ]);
    expect(deletedWords("shop-1", { end: "unread", phase: "Completed" })).toEqual([
      "Velero has not read the request yet: it had no phase after thirty seconds of reads. The view of the backup says whether Velero deletes it.",
    ]);
    expect(deletedWords("shop-1", { end: "refused", errorsLeft: 1 }).at(-1)).toBe(
      BACKUP_DELETE_VIEW_WORDS.errorsLeft(1, "shop-1"),
    );
    expect(BACKUP_DELETE_VIEW_WORDS.errorsLeft(1, "shop-1")).toBe(
      "Velero wrote 1 more error: `velero backup describe shop-1` lists the attempts to delete it with their errors.",
    );
  });

  it("says what the backup alone shows when the requests could not be read", () => {
    const unread = (end: "completed" | "in-progress" | "unread", phase?: string) =>
      deletedWords("shop-1", { end, requestsUnread: true, ...(phase ? { phase } : {}) });

    expect(unread("completed")).toEqual([
      BACKUP_DELETE_VIEW_WORDS.unread,
      "The backup shop-1 is not there any more: Velero deleted it.",
    ]);
    expect(unread("in-progress", "Deleting")).toEqual([
      BACKUP_DELETE_VIEW_WORDS.unread,
      "The backup shop-1 is Deleting: Velero is deleting it, or a deletion of it failed and it stays Deleting.",
    ]);
    expect(unread("unread", "Completed")).toEqual([
      BACKUP_DELETE_VIEW_WORDS.unread,
      "The backup shop-1 is still Completed: Velero has not started the deletion, or refused it, as far as the backup shows.",
    ]);
    expect(unread("unread")[1]).toBe(
      "The backup shop-1 is still without a phase: Velero has not started the deletion, or refused it, as far as the backup shows.",
    );
  });
});
