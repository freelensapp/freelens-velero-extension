import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  ARTIFACT_TARGETS,
  artifactKind,
  carriedErrors,
  downloadRequestName,
  ERRORS_BOUND,
  FAILURE_TEXT_BOUND,
  KEPT_ENDS_BOUND,
  PAGE_BOUND,
  PROBLEMS_WORDS,
  REQUEST_BOUND,
  REQUEST_STAGES,
  readAllowanceRequest,
  readAnswer,
  readArtifactPage,
  readArtifactPageRequest,
  readArtifactReleaseRequest,
  readArtifactSaved,
  readArtifactValue,
  readBackupCreated,
  readGateDisableRequest,
  readGateEnableRequest,
  readGateState,
  readGateStateRequest,
  readKeptEnds,
  readRestoreCreated,
  readScheduleChanged,
  readScheduleCreated,
  readServerStatusValue,
  readWriteCancelRequest,
  readWriteConfirmAnswer,
  readWriteConfirmRequest,
  readWriteEndsRequest,
  readWriteRunRequest,
  readWriteShownRequest,
  readWriteStatus,
  readWriteStatusRequest,
  saidProblems,
  savedFileName,
  TEXT_BOUND,
} from "./ipc";

const cluster = "86a008d2588de4178aa2ac8a245ac1f4";
const target = { kind: "Backup", name: "nightly", uid: "0e7c5b7a-uid" };

describe("the requests between the processes", () => {
  it("reads a request of the state of the gate, and refuses what is not one", () => {
    expect(readGateStateRequest({ cluster })).toEqual({ cluster });
    expect(readGateStateRequest({ cluster, extra: 1 })).toBeUndefined();
    expect(readGateStateRequest({ cluster: "not a cluster!" })).toBeUndefined();
    expect(readGateStateRequest({ cluster: ["a"] })).toBeUndefined();
    expect(readGateStateRequest("cluster")).toBeUndefined();
    expect(readGateStateRequest(null)).toBeUndefined();
    expect(readGateStateRequest({})).toBeUndefined();
  });

  it("reads a request that turns writes on, with the words of the dialog", () => {
    const request = { cluster, namespace: "velero", confirmation: { context: "kind-demo", namespace: "velero" } };

    expect(readGateEnableRequest(request)).toEqual(request);
    expect(readGateEnableRequest({ ...request, namespace: "Velero" })).toBeUndefined();
    expect(readGateEnableRequest({ ...request, namespace: "a".repeat(64) })).toBeUndefined();
    expect(readGateEnableRequest({ ...request, confirmation: { context: "kind-demo" } })).toBeUndefined();
    expect(readGateEnableRequest({ ...request, confirmation: { context: "", namespace: "velero" } })).toBeUndefined();
    expect(readGateEnableRequest({ ...request, confirmation: { context: 1, namespace: "velero" } })).toBeUndefined();
    expect(readGateEnableRequest({ cluster, namespace: "velero" })).toBeUndefined();
  });

  it("reads a confirmation of a write, of one artifact of one object for a DownloadRequest and of none for a ServerStatusRequest", () => {
    const download = { cluster, namespace: "velero", kind: "DownloadRequest", target, artifact: "BackupLog" };

    expect(readWriteConfirmRequest(download)).toEqual(download);
    // The artifact is a part of what is confirmed: a DownloadRequest without one is not a request.
    expect(readWriteConfirmRequest({ cluster, namespace: "velero", kind: "DownloadRequest", target })).toBeUndefined();
    expect(
      readWriteConfirmRequest({ cluster, namespace: "velero", kind: "ServerStatusRequest", artifact: "BackupLog" }),
    ).toBeUndefined();
    expect(readWriteConfirmRequest({ cluster, namespace: "velero", kind: "ServerStatusRequest" })).toEqual({
      cluster,
      namespace: "velero",
      kind: "ServerStatusRequest",
    });
    expect(readWriteConfirmRequest({ cluster, namespace: "velero", kind: "DownloadRequest" })).toBeUndefined();
    expect(
      readWriteConfirmRequest({ cluster, namespace: "velero", kind: "ServerStatusRequest", target }),
    ).toBeUndefined();
    expect(readWriteConfirmRequest({ ...download, kind: "Backup" })).toBeUndefined();
    expect(readWriteConfirmRequest({ ...download, target: { ...target, kind: "Pod" } })).toBeUndefined();
    expect(readWriteConfirmRequest({ ...download, target: { ...target, uid: "" } })).toBeUndefined();
    expect(readWriteConfirmRequest({ ...download, target: { ...target, name: "Not A Name" } })).toBeUndefined();
    expect(readWriteConfirmRequest({ ...download, target: { ...target, more: 1 } })).toBeUndefined();
  });

  it("reads a confirmation of a backup asked from a schedule: of the schedule by its name and UID, with the name of the backup", () => {
    const schedule = { kind: "Schedule", name: "daily", uid: "5b0c2f6e-uid" };
    const now = {
      cluster,
      namespace: "velero",
      kind: "backup-from-schedule",
      target: schedule,
      backup: "daily-20261108034105",
    };

    expect(readWriteConfirmRequest(now)).toEqual(now);
    // The name of the backup is a part of what is confirmed, and one the API server takes.
    for (const backup of ["", "Daily", "daily_1", "a".repeat(217), 7]) {
      expect([backup, readWriteConfirmRequest({ ...now, backup })]).toEqual([backup, undefined]);
    }
    expect(readWriteConfirmRequest({ ...now, backup: "a".repeat(216) })).toMatchObject({ backup: "a".repeat(216) });
    // A schedule whose name a label does not take is asked for no backup, by the reader as by the confirmation.
    const long = { ...schedule, name: "s".repeat(64) };

    expect(readWriteConfirmRequest({ ...now, target: long })).toBeUndefined();
    expect(readWriteConfirmRequest({ ...now, target: { ...long, name: "s".repeat(63) } })).toMatchObject({
      target: { name: "s".repeat(63) },
    });
    // Of a schedule only, with no artifact, and no name of a backup for another kind.
    expect(
      readWriteConfirmRequest({ cluster, namespace: "velero", kind: "backup-from-schedule", backup: "b" }),
    ).toBeUndefined();
    expect(readWriteConfirmRequest({ ...now, target })).toBeUndefined();
    expect(readWriteConfirmRequest({ ...now, artifact: "BackupLog" })).toBeUndefined();
    expect(
      readWriteConfirmRequest({
        cluster,
        namespace: "velero",
        kind: "DownloadRequest",
        target: schedule,
        artifact: "BackupLog",
      }),
    ).toBeUndefined();
    expect(
      readWriteConfirmRequest({ cluster, namespace: "velero", kind: "ServerStatusRequest", backup: "b" }),
    ).toBeUndefined();
    // The run carries what was confirmed, with its token and its identifier, and nothing of the body.
    const run = { ...now, token: randomUUID(), request: randomUUID() };

    expect(readWriteRunRequest(run)).toEqual(run);
    expect(readWriteRunRequest({ ...run, backup: "Daily" })).toBeUndefined();
    expect(readWriteRunRequest({ ...run, text: "{}" })).toBeUndefined();
  });

  it("reads a confirmation of a backup of the form: its name and the fields of its template, of no object", () => {
    const template = {
      includedNamespaces: ["shop", "shop-*"],
      excludedResources: ["secrets"],
      includeClusterResources: false,
      labelSelector: "app=web",
      storageLocation: "default",
      volumeSnapshotLocations: ["aws"],
      snapshotVolumes: true,
      ttl: "720h",
    };
    const form = { cluster, namespace: "velero", kind: "backup", backup: "shop-by-hand", template };

    expect(readWriteConfirmRequest(form)).toEqual(form);
    expect(readWriteConfirmRequest({ ...form, template: {} })).toEqual({ ...form, template: {} });
    // What the release refuses of a template is said by the main process with its words, not refused here.
    expect(readWriteConfirmRequest({ ...form, template: { excludedNamespaces: ["*"] } })).toMatchObject({
      template: { excludedNamespaces: ["*"] },
    });
    for (const [what, value] of [
      ["no template", { cluster, namespace: "velero", kind: "backup", backup: "shop-by-hand" }],
      ["no name", { cluster, namespace: "velero", kind: "backup", template }],
      ["a name the API server refuses", { ...form, backup: "Shop" }],
      ["a target", { ...form, target: { kind: "Schedule", name: "daily", uid: "u" } }],
      ["an artifact", { ...form, artifact: "BackupLog" }],
      ["a field of the template it does not know", { ...form, template: { ...template, hooks: {} } }],
      ["a list that is not one", { ...form, template: { includedNamespaces: "shop" } }],
      ["an empty item", { ...form, template: { includedNamespaces: [""] } }],
      ["an item too long", { ...form, template: { includedResources: ["r".repeat(254)] } }],
      ["too many items", { ...form, template: { includedResources: Array.from({ length: 257 }, (_, i) => `n${i}`) } }],
      ["a boolean that is not one", { ...form, template: { snapshotVolumes: "true" } }],
      ["a duration that is not text", { ...form, template: { ttl: 720 } }],
      ["a duration too long", { ...form, template: { ttl: "1".repeat(65) } }],
      ["a selector too long", { ...form, template: { labelSelector: "a".repeat(1025) } }],
      ["too many selectors", { ...form, template: { orLabelSelectors: Array.from({ length: 17 }, () => "a") } }],
      ["a template of another kind", { cluster, namespace: "velero", kind: "ServerStatusRequest", template }],
    ] as const) {
      expect([what, readWriteConfirmRequest(value)]).toEqual([what, undefined]);
    }
    // The run carries the name, and none of the template, which the text kept with the token is made of.
    const run = {
      cluster,
      namespace: "velero",
      kind: "backup",
      backup: "shop-by-hand",
      token: randomUUID(),
      request: randomUUID(),
    };

    expect(readWriteRunRequest(run)).toEqual(run);
    expect(readWriteRunRequest({ ...run, template })).toBeUndefined();
  });

  it("reads a pause and a resume of a schedule: the schedule, at a resume the expression its review read and the choice of skipping, and a run that carries nothing more", () => {
    const target = { kind: "Schedule", name: "nightly", uid: "nightly-uid" };
    const pause = { cluster, namespace: "velero", kind: "schedule-pause", target };
    const resume = {
      cluster,
      namespace: "velero",
      kind: "schedule-resume",
      target,
      resume: { expression: "CRON_TZ=Europe/Rome 0 3 * * *", skipImmediately: true },
    };
    const run = { token: randomUUID(), request: randomUUID() };

    expect(readWriteConfirmRequest(pause)).toEqual(pause);
    expect(readWriteConfirmRequest(resume)).toEqual(resume);
    expect(readWriteRunRequest({ ...pause, ...run })).toEqual({ ...pause, ...run });
    expect(readWriteRunRequest({ ...pause, kind: "schedule-resume", ...run })).toEqual({
      ...pause,
      kind: "schedule-resume",
      ...run,
    });
    for (const [what, value] of [
      ["no schedule", { ...pause, target: undefined }],
      ["a backup", { ...pause, target: { ...target, kind: "Backup" } }],
      ["a resume with nothing to resume with", { ...resume, resume: undefined }],
      ["a pause with something to resume with", { ...pause, resume: resume.resume }],
      ["an empty expression", { ...resume, resume: { ...resume.resume, expression: "" } }],
      ["an expression beyond the bound", { ...resume, resume: { ...resume.resume, expression: "x".repeat(4097) } }],
      ["a choice that is not true or false", { ...resume, resume: { ...resume.resume, skipImmediately: "true" } }],
      ["a field it does not know", { ...resume, resume: { ...resume.resume, paused: false } }],
      ["a backup named", { ...pause, backup: "nightly-1" }],
      ["a form of a restore", { ...pause, restore: "r", restoreForm: { existingResourcePolicy: "none" } }],
    ] as const) {
      expect([what, readWriteConfirmRequest(value)]).toEqual([what, undefined]);
    }
    // The run carries nothing of the patch, which the text kept with the token is.
    expect(readWriteRunRequest({ ...resume, ...run })).toBeUndefined();
    expect(readWriteRunRequest({ ...pause, typed: "nightly", ...run })).toBeUndefined();
  });

  it("reads what a schedule is after its pause or its resume, and nothing else", () => {
    const changed = {
      name: "nightly",
      uid: "u",
      paused: false,
      skipImmediately: true,
      lastSkipped: "2026-11-08T12:00:00Z",
    };

    expect(readScheduleChanged(changed)).toEqual(changed);
    expect(readScheduleChanged({ name: "nightly", uid: "u", paused: true })).toEqual({
      name: "nightly",
      uid: "u",
      paused: true,
    });
    for (const wrong of [
      { ...changed, paused: "true" },
      { ...changed, skipImmediately: "false" },
      { ...changed, lastSkipped: "" },
      { ...changed, phase: "Enabled" },
      { name: "nightly", uid: "u" },
      { ...changed, name: "Nightly" },
    ])
      expect(readScheduleChanged(wrong)).toBeUndefined();
  });

  it("reads a confirmation of a restore: its backup, its name and its form, and a run with the name of its backup typed", () => {
    const target = { kind: "Backup", name: "nightly", uid: "nightly-uid" };
    const restoreForm = {
      includedNamespaces: ["shop"],
      excludedResources: ["secrets"],
      namespaceMapping: [["shop", "shop-restored"]],
      clusterResources: "needed",
      labelSelector: "app=web",
      restorePVs: false,
      existingResourcePolicy: "update",
    };
    const form = { cluster, namespace: "velero", kind: "restore", target, restore: "nightly-1", restoreForm };

    expect(readWriteConfirmRequest(form)).toEqual(form);
    expect(readWriteConfirmRequest({ ...form, restoreForm: { existingResourcePolicy: "none" } })).toMatchObject({
      restoreForm: { existingResourcePolicy: "none" },
    });
    // Every field of the form, each read as it was sent: none is taken and dropped.
    const whole = {
      includedNamespaces: ["shop", "web-*"],
      excludedNamespaces: ["web-test"],
      namespaceMapping: [
        ["shop", "shop-restored"],
        ["web-a", "web-restored"],
      ],
      includedResources: ["configmaps"],
      excludedResources: ["secrets"],
      clusterResources: "every",
      orLabelSelectors: ["app=web", "tier=db"],
      restorePVs: true,
      existingResourcePolicy: "none",
    };
    const { orLabelSelectors: _selectors, ...withOne } = whole;
    const wholeWithSelector = { ...withOne, labelSelector: "app=web" };

    expect(readWriteConfirmRequest({ ...form, restoreForm: whole })).toEqual({ ...form, restoreForm: whole });
    expect(readWriteConfirmRequest({ ...form, restoreForm: wholeWithSelector })).toEqual({
      ...form,
      restoreForm: wholeWithSelector,
    });
    // What the restore controller refuses of the form is said by the main process with its words, not refused here.
    expect(
      readWriteConfirmRequest({ ...form, restoreForm: { ...restoreForm, includedResources: ["nodes"] } }),
    ).toMatchObject({ restoreForm: { includedResources: ["nodes"] } });
    const many = (count: number) => Array.from({ length: count }, (_, at) => [`n${at}`, `t${at}`]);

    expect(
      readWriteConfirmRequest({ ...form, restoreForm: { ...restoreForm, namespaceMapping: many(64) } }),
    ).toBeTruthy();
    for (const [what, value] of [
      ["no form", { cluster, namespace: "velero", kind: "restore", target, restore: "nightly-1" }],
      ["no name", { cluster, namespace: "velero", kind: "restore", target, restoreForm }],
      ["no backup", { cluster, namespace: "velero", kind: "restore", restore: "nightly-1", restoreForm }],
      ["a schedule as its target", { ...form, target: { ...target, kind: "Schedule" } }],
      ["a restore as its target", { ...form, target: { ...target, kind: "Restore" } }],
      ["a name the API server refuses", { ...form, restore: "Nightly-1" }],
      ["a name longer than 216 characters", { ...form, restore: "a".repeat(217) }],
      ["no policy", { ...form, restoreForm: { includedNamespaces: ["shop"] } }],
      [
        "a policy the release does not have",
        { ...form, restoreForm: { ...restoreForm, existingResourcePolicy: "replace" } },
      ],
      [
        "a choice of the cluster-scoped resources it does not have",
        { ...form, restoreForm: { ...restoreForm, clusterResources: "all" } },
      ],
      [
        "a mapping that is not pairs",
        { ...form, restoreForm: { ...restoreForm, namespaceMapping: { shop: "shop-2" } } },
      ],
      ["a pair of three", { ...form, restoreForm: { ...restoreForm, namespaceMapping: [["a", "b", "c"]] } }],
      ["a mapping beyond the bound", { ...form, restoreForm: { ...restoreForm, namespaceMapping: many(65) } }],
      [
        "a choice of the volumes that is not a boolean",
        { ...form, restoreForm: { ...restoreForm, restorePVs: "true" } },
      ],
      [
        "a list beyond the bound",
        { ...form, restoreForm: { ...restoreForm, includedNamespaces: Array(257).fill("a") } },
      ],
      ["a field the form does not offer", { ...form, restoreForm: { ...restoreForm, resourcePolicy: {} } }],
      ["the name of a backup typed", { ...form, typed: "nightly" }],
      ["a form of a backup of the form", { cluster, namespace: "velero", kind: "backup", backup: "b", restoreForm }],
      [
        "the name of a restore of another kind",
        { cluster, namespace: "velero", kind: "ServerStatusRequest", restore: "r" },
      ],
    ] as const) {
      expect([what, readWriteConfirmRequest(value)]).toEqual([what, undefined]);
    }
    const run = {
      cluster,
      namespace: "velero",
      kind: "restore",
      target,
      restore: "nightly-1",
      typed: "nightly",
      token: randomUUID(),
      request: randomUUID(),
    };

    expect(readWriteRunRequest(run)).toEqual(run);
    // What was typed is carried as it was typed, to be compared: an empty name or another one is the main process's.
    expect(readWriteRunRequest({ ...run, typed: "" })).toMatchObject({ typed: "" });
    for (const [what, value] of [
      ["no name typed", { ...run, typed: undefined }],
      ["a name typed that is not text", { ...run, typed: 3 }],
      ["a name typed longer than a name", { ...run, typed: "a".repeat(254) }],
      ["the form", { ...run, restoreForm }],
      [
        "a name typed for a backup of the form",
        {
          cluster,
          namespace: "velero",
          kind: "backup",
          backup: "b",
          typed: "b",
          token: run.token,
          request: run.request,
        },
      ],
    ] as const) {
      const { typed: _typed, ...rest } = value as Record<string, unknown>;

      expect([what, readWriteRunRequest("typed" in value && value.typed === undefined ? rest : value)]).toEqual([
        what,
        undefined,
      ]);
    }
  });

  it("reads what a restore is once created, within the bounds of its errors", () => {
    const created = {
      name: "nightly-1",
      uid: "u",
      phase: "FailedValidation",
      errors: ["one"],
      errorsLeft: 2,
      found: true,
    };

    expect(readRestoreCreated(created)).toEqual(created);
    expect(readRestoreCreated({ name: "nightly-1", uid: "u" })).toEqual({ name: "nightly-1", uid: "u" });
    for (const value of [
      { ...created, paused: true },
      { ...created, position: 1 },
      { ...created, errors: [] },
      { ...created, errorsLeft: 0 },
      { ...created, found: false },
      { ...created, phase: "x".repeat(65) },
      { ...created, name: "Nightly" },
    ])
      expect(readRestoreCreated(value)).toBeUndefined();
  });

  it("reads a confirmation of a schedule of the form: its name, its wrapper and its template, of no object", () => {
    const wrapper = {
      expression: "0 3 * * *",
      paused: false,
      skipImmediately: true,
      useOwnerReferencesInBackup: false,
    };
    const template = { includedNamespaces: ["shop"], storageLocation: "default" };
    const form = { cluster, namespace: "velero", kind: "schedule", schedule: "nightly-shop", wrapper, template };

    expect(readWriteConfirmRequest(form)).toEqual(form);
    // What the main process refuses of an expression is said with its words, not refused here.
    for (const expression of ["", "@none", "61 * * * *", "0 3 * *\t*"])
      expect(readWriteConfirmRequest({ ...form, wrapper: { ...wrapper, expression } })).toMatchObject({
        wrapper: { expression },
      });
    expect(readWriteConfirmRequest({ ...form, schedule: "a".repeat(63) })).toMatchObject({ schedule: "a".repeat(63) });
    for (const [what, value] of [
      ["no wrapper", { cluster, namespace: "velero", kind: "schedule", schedule: "nightly-shop", template }],
      ["no template", { cluster, namespace: "velero", kind: "schedule", schedule: "nightly-shop", wrapper }],
      ["no name", { cluster, namespace: "velero", kind: "schedule", wrapper, template }],
      ["a name of 64 characters", { ...form, schedule: "a".repeat(64) }],
      ["a name the API server refuses", { ...form, schedule: "Nightly" }],
      ["the name of a backup", { ...form, backup: "nightly-shop" }],
      ["a target", { ...form, target: { kind: "Schedule", name: "daily", uid: "u" } }],
      ["a flag that is not set", { ...form, wrapper: { ...wrapper, paused: undefined } }],
      ["a flag that is not a boolean", { ...form, wrapper: { ...wrapper, useOwnerReferencesInBackup: "false" } }],
      ["an expression that is not text", { ...form, wrapper: { ...wrapper, expression: 3 } }],
      ["an expression beyond what is carried", { ...form, wrapper: { ...wrapper, expression: "x".repeat(4097) } }],
      ["a field of the wrapper it does not know", { ...form, wrapper: { ...wrapper, labels: {} } }],
      ["a field of the template it does not know", { ...form, template: { ...template, hooks: {} } }],
      [
        "a wrapper of a backup of the form",
        { cluster, namespace: "velero", kind: "backup", backup: "shop", wrapper, template },
      ],
      ["a wrapper of another kind", { cluster, namespace: "velero", kind: "ServerStatusRequest", wrapper }],
    ] as const) {
      expect([what, readWriteConfirmRequest(value)]).toEqual([what, undefined]);
    }
    // The run carries the name, and none of the wrapper or of the template, which the text kept with the token is made
    // of.
    const run = {
      cluster,
      namespace: "velero",
      kind: "schedule",
      schedule: "nightly-shop",
      token: randomUUID(),
      request: randomUUID(),
    };

    expect(readWriteRunRequest(run)).toEqual(run);
    expect(readWriteRunRequest({ ...run, wrapper })).toBeUndefined();
    expect(readWriteRunRequest({ ...run, template })).toBeUndefined();
    expect(readWriteRunRequest({ ...run, schedule: undefined })).toBeUndefined();
  });

  it("takes the eight artifacts the extension shows, each of the kind of its target, and no other target of the API", () => {
    const of = (artifact: unknown, kind: string) => ({
      cluster,
      namespace: "velero",
      kind: "DownloadRequest",
      target: { ...target, kind },
      artifact,
    });

    expect(ARTIFACT_TARGETS).toHaveLength(8);
    for (const artifact of ARTIFACT_TARGETS) {
      const kind = artifactKind(artifact);
      const other = kind === "Backup" ? "Restore" : "Backup";

      expect([artifact, kind]).toEqual([artifact, artifact.startsWith("Backup") ? "Backup" : "Restore"]);
      expect(readWriteConfirmRequest(of(artifact, kind))).toMatchObject({ artifact, target: { kind } });
      // The log of a restore is not asked of a backup.
      expect([artifact, readWriteConfirmRequest(of(artifact, other))]).toEqual([artifact, undefined]);
    }
    // The six other targets of the API of the reviewed release, the contents of a backup first, and what
    // is not a target at all.
    for (const refused of [
      "BackupContents",
      "BackupVolumeSnapshots",
      "BackupItemOperations",
      "RestoreItemOperations",
      "CSIBackupVolumeSnapshots",
      "CSIBackupVolumeSnapshotContents",
      "backuplog",
      "BackupLog ",
      "",
      ["BackupLog"],
      { kind: "BackupLog" },
      1,
      null,
    ]) {
      expect([refused, readWriteConfirmRequest(of(refused, "Backup"))]).toEqual([refused, undefined]);
      expect([
        refused,
        readWriteRunRequest({ ...of(refused, "Backup"), token: randomUUID(), request: randomUUID() }),
      ]).toEqual([refused, undefined]);
    }
  });

  it("names a DownloadRequest after its target and the identifier of the request", () => {
    const request = randomUUID();

    expect(downloadRequestName("nightly", request)).toBe(`nightly-${request}`);
    expect(downloadRequestName("restore.of-monday", "0e7c")).toBe("restore.of-monday-0e7c");
  });

  it("reads a run of a write, with its token and its identifier", () => {
    const token = randomUUID();
    const request = randomUUID();

    expect(readWriteRunRequest({ cluster, namespace: "velero", kind: "ServerStatusRequest", token, request })).toEqual({
      cluster,
      namespace: "velero",
      kind: "ServerStatusRequest",
      token,
      request,
    });
    expect(
      readWriteRunRequest({
        cluster,
        namespace: "velero",
        kind: "DownloadRequest",
        target,
        token,
        request,
        artifact: "BackupLog",
      }),
    ).toEqual({ cluster, namespace: "velero", kind: "DownloadRequest", target, token, request, artifact: "BackupLog" });
    expect(
      readWriteRunRequest({ cluster, namespace: "velero", kind: "DownloadRequest", target, token, request }),
    ).toBeUndefined();
    expect(
      readWriteRunRequest({
        cluster,
        namespace: "velero",
        kind: "ServerStatusRequest",
        token,
        request,
        artifact: "BackupLog",
      }),
    ).toBeUndefined();
    // What is run is what was confirmed: an artifact that is not of the kind of its target is not read.
    expect(
      readWriteRunRequest({
        cluster,
        namespace: "velero",
        kind: "DownloadRequest",
        target,
        token,
        request,
        artifact: "RestoreLog",
      }),
    ).toBeUndefined();
    expect(
      readWriteRunRequest({ cluster, namespace: "velero", kind: "ServerStatusRequest", token: "abc", request }),
    ).toBeUndefined();
    expect(
      readWriteRunRequest({ cluster, namespace: "velero", kind: "ServerStatusRequest", token, request: [request] }),
    ).toBeUndefined();
    expect(readWriteRunRequest({ cluster, namespace: "velero", kind: "ServerStatusRequest", token })).toBeUndefined();
  });

  it("reads the status and the cancellation of a write", () => {
    const request = randomUUID();

    expect(readWriteStatusRequest({ cluster, request })).toEqual({ cluster, request });
    expect(readWriteCancelRequest({ cluster, request })).toEqual({ cluster, request });
    expect(readWriteStatusRequest({ cluster, request: "1" })).toBeUndefined();
    expect(readWriteStatusRequest({ cluster, request, token: request })).toBeUndefined();
  });

  it("reads the request of a page of the text of an artifact, and the one that lets the text go", () => {
    const request = randomUUID();

    expect(readArtifactPageRequest({ cluster, request, page: 0 })).toEqual({ cluster, request, page: 0 });
    expect(readArtifactPageRequest({ cluster, request, page: 15 })).toEqual({ cluster, request, page: 15 });
    for (const page of [-1, 1.5, "0", Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53, null, undefined]) {
      expect([page, readArtifactPageRequest({ cluster, request, page })]).toEqual([page, undefined]);
    }
    expect(readArtifactPageRequest({ cluster, request })).toBeUndefined();
    expect(readArtifactPageRequest({ cluster, request: "1", page: 0 })).toBeUndefined();
    expect(readArtifactPageRequest({ cluster, request, page: 0, url: "https://leak.invalid" })).toBeUndefined();
    expect(readArtifactReleaseRequest({ cluster, request })).toEqual({ cluster, request });
    expect(readArtifactReleaseRequest({ cluster, request, page: 0 })).toBeUndefined();
  });

  it("refuses a request beyond the bound, whatever its fields say", () => {
    // Every field is the one of a valid request: only what the request weighs between the processes is
    // beyond the bound, or cannot be weighed at all.
    const heavy = (fields: Record<string, unknown>, weight: number) =>
      Object.assign(Object.create({ toJSON: () => "x".repeat(weight) }), fields);
    const request = randomUUID();

    expect(readGateStateRequest(heavy({ cluster }, REQUEST_BOUND - 2))).toEqual({ cluster });
    expect(readGateStateRequest(heavy({ cluster }, REQUEST_BOUND + 1))).toBeUndefined();
    expect(readGateDisableRequest(heavy({ cluster }, REQUEST_BOUND + 1))).toBeUndefined();
    expect(readWriteStatusRequest(heavy({ cluster, request }, REQUEST_BOUND - 2))).toEqual({ cluster, request });
    expect(readWriteStatusRequest(heavy({ cluster, request }, REQUEST_BOUND + 1))).toBeUndefined();
    expect(
      readGateEnableRequest(
        heavy(
          { cluster, namespace: "velero", confirmation: { context: "kind-a", namespace: "velero" } },
          REQUEST_BOUND + 1,
        ),
      ),
    ).toBeUndefined();
    expect(
      readWriteConfirmRequest(heavy({ cluster, namespace: "velero", kind: "ServerStatusRequest" }, REQUEST_BOUND + 1)),
    ).toBeUndefined();
    const unreadable = Object.assign(
      Object.create({
        toJSON: () => {
          throw new Error("cannot be weighed");
        },
      }),
      { cluster },
    );

    expect(readGateStateRequest(unreadable)).toBeUndefined();
  });
});

describe("the answers of a write of a body", () => {
  it("reads the text of the body beside the token, within the bound of a request, and none when there is none", () => {
    const token = randomUUID();

    expect(readWriteConfirmAnswer({ token, expires: 1, text: "{}" })).toEqual({ token, expires: 1, text: "{}" });
    expect(readWriteConfirmAnswer({ token, expires: 1 })).toEqual({ token, expires: 1 });
    // The bound is of the text written as JSON, with its quotes and what it escapes.
    for (const text of ["", 7, "x".repeat(TEXT_BOUND - 1), '"'.repeat(TEXT_BOUND / 2)]) {
      expect([String(text).length, readWriteConfirmAnswer({ token, expires: 1, text })]).toEqual([
        String(text).length,
        undefined,
      ]);
    }
    const largest = "x".repeat(TEXT_BOUND - 2);

    expect(readWriteConfirmAnswer({ token, expires: 1, text: largest })?.text).toHaveLength(TEXT_BOUND - 2);
    // The largest text arrives whole through the way of every answer, which is within the bound of a request.
    expect(
      readAnswer({ ok: true, value: { token, expires: Date.now() + 30_000, text: largest } }, readWriteConfirmAnswer),
    ).toMatchObject({ ok: true, value: { text: largest } });
  });

  it("reads the backup a schedule was asked for: its name, its UID, and the phase Velero wrote when it wrote one", () => {
    expect(readBackupCreated({ name: "daily-20261108034105", uid: "u-1" })).toEqual({
      name: "daily-20261108034105",
      uid: "u-1",
    });
    expect(readBackupCreated({ name: "b", uid: "u-1", phase: "New" })).toEqual({ name: "b", uid: "u-1", phase: "New" });
    // Found by its name after an answer that was lost.
    expect(readBackupCreated({ name: "b", uid: "u-1", found: true })).toEqual({ name: "b", uid: "u-1", found: true });
    for (const value of [
      { name: "Not A Name", uid: "u" },
      { name: "b", uid: "" },
      { name: "b", uid: "u", phase: "" },
      { name: "b", uid: "u", phase: 1 },
      { name: "b", uid: "u", spec: {} },
      { name: "b", uid: "u", found: false },
      { name: "b", uid: "u", found: "yes" },
    ]) {
      expect([value, readBackupCreated(value)]).toEqual([value, undefined]);
    }
  });
});

describe("a schedule of the form created, between the processes", () => {
  it("reads its name, its UID, the phase and the errors Velero wrote, whether it is paused, and whether it was found", () => {
    expect(readScheduleCreated({ name: "nightly", uid: "u" })).toEqual({ name: "nightly", uid: "u" });
    const failed = { name: "nightly", uid: "u", phase: "FailedValidation", errors: ["one", "two"] };

    expect(readScheduleCreated(failed)).toEqual(failed);
    expect(readScheduleCreated({ name: "nightly", uid: "u", paused: true, found: true })).toEqual({
      name: "nightly",
      uid: "u",
      paused: true,
      found: true,
    });
    for (const value of [
      { name: "Nightly", uid: "u" },
      { name: "nightly", uid: "" },
      { name: "nightly", uid: "u", phase: "P".repeat(65) },
      { name: "nightly", uid: "u", errors: [] },
      { name: "nightly", uid: "u", errors: Array.from({ length: 17 }, () => "e") },
      { name: "nightly", uid: "u", errors: ["e".repeat(4097)] },
      { name: "nightly", uid: "u", paused: false },
      { name: "nightly", uid: "u", found: "yes" },
      { name: "nightly", uid: "u", position: 1 },
      { name: "nightly", uid: "u", errors: Array.from({ length: 9 }, () => "e".repeat(4096)) },
      { name: "nightly", uid: "u", errorsLeft: 0 },
    ]) {
      expect([value, readScheduleCreated(value)]).toEqual([value, undefined]);
    }
    expect(readScheduleCreated({ name: "nightly", uid: "u", phase: "FailedValidation", errorsLeft: 2 })).toEqual({
      name: "nightly",
      uid: "u",
      phase: "FailedValidation",
      errorsLeft: 2,
    });
  });
});

describe("the errors of a validation an answer carries", () => {
  it("carries them in order, each whole, until one does not fit, and counts the others", () => {
    expect(carriedErrors(undefined)).toEqual({});
    expect(carriedErrors(["one", "two"])).toEqual({ errors: ["one", "two"] });
    expect(carriedErrors(["e".repeat(4097), "two"])).toEqual({ errorsLeft: 2 });
    const many = Array.from({ length: 20 }, (_, at) => `error ${at}`);

    expect(carriedErrors(many)).toEqual({ errors: many.slice(0, 16), errorsLeft: 4 });
    const long = Array.from({ length: 16 }, () => "e".repeat(4096));

    expect(carriedErrors(long)).toEqual({ errors: long.slice(0, 8), errorsLeft: 8 });
    expect(ERRORS_BOUND.total).toBe(32_768);
  });

  it("reads no answer whose errors are beyond their total, and counts the others it says", () => {
    const long = Array.from({ length: 9 }, () => "e".repeat(4096));

    expect(readBackupCreated({ name: "b", uid: "u", phase: "FailedValidation", errors: long })).toBeUndefined();
    expect(readBackupCreated({ name: "b", uid: "u", phase: "FailedValidation", errorsLeft: 3 })).toEqual({
      name: "b",
      uid: "u",
      phase: "FailedValidation",
      errorsLeft: 3,
    });
    expect(readBackupCreated({ name: "b", uid: "u", errorsLeft: 0 })).toBeUndefined();
    expect(readBackupCreated({ name: "b", uid: "u", errorsLeft: 1.5 })).toBeUndefined();
  });
});

describe("the place in the queue and the errors of a backup created, between the processes", () => {
  it("reads the place of a backup in the queue and the errors of its validation, within their bounds", () => {
    const created = { name: "shop", uid: "u", phase: "Queued", position: 2 };

    expect(readBackupCreated(created)).toEqual(created);
    expect(
      readBackupCreated({ ...created, phase: "FailedValidation", position: undefined, errors: ["e"] }),
    ).toBeUndefined();
    const failed = { name: "shop", uid: "u", phase: "FailedValidation", errors: ["one", "two"] };

    expect(readBackupCreated(failed)).toEqual(failed);
    for (const value of [
      { ...created, position: 0 },
      { ...created, position: 1.5 },
      { ...failed, errors: [] },
      { ...failed, errors: [""] },
      { ...failed, errors: ["e".repeat(4097)] },
      { ...failed, errors: Array.from({ length: 17 }, () => "e") },
    ]) {
      expect(readBackupCreated(value)).toBeUndefined();
    }
  });
});

describe("the ends kept for a cluster, between the processes", () => {
  const end = {
    request: randomUUID(),
    kind: "backup-from-schedule",
    namespace: "velero",
    context: "kind-a",
    name: "daily-20261108034105",
    schedule: "daily",
    outcome: { created: true, phase: "New", found: true },
    at: 1,
  };

  it("reads the ends of a cluster, each with what to look for and how it ended, and the end a frame showed", () => {
    const refused = {
      ...end,
      request: randomUUID(),
      outcome: { created: false, code: "conflict", text: "A backup named it is already there." },
    };

    expect(readKeptEnds([end, refused])).toEqual([end, refused]);
    // One request is one end, the last.
    expect(readKeptEnds([end, { ...end, at: 2 }])).toEqual([{ ...end, at: 2 }]);
    expect(KEPT_ENDS_BOUND).toBe(16);
    expect(readKeptEnds([])).toEqual([]);
    expect(readWriteEndsRequest({ cluster })).toEqual({ cluster });
    expect(readWriteShownRequest({ cluster, request: end.request })).toEqual({ cluster, request: end.request });
    expect(readWriteShownRequest({ cluster, request: "not-a-uuid" })).toBeUndefined();
  });

  it("reads the end of a pause and of a resume, applied with nothing more or not done, and of no other shape", () => {
    const { schedule: _schedule, ...base } = end;
    const paused = {
      ...base,
      request: randomUUID(),
      kind: "schedule-pause",
      name: "nightly",
      outcome: { created: true },
    };
    const resumed = { ...paused, request: randomUUID(), kind: "schedule-resume" };
    const refused = {
      ...paused,
      request: randomUUID(),
      outcome: { created: false, code: "conflict", text: "The schedule nightly changed since the review." },
    };

    expect(readKeptEnds([paused, resumed, refused])).toEqual([paused, resumed, refused]);
    expect(readKeptEnds([{ ...paused, outcome: { created: true, phase: "Enabled" } }])).toEqual([]);
    expect(readKeptEnds([{ ...paused, outcome: { created: true, paused: true } }])).toEqual([]);
    expect(readKeptEnds([{ ...paused, schedule: "nightly" }])).toEqual([]);
  });

  it("reads the end of a schedule of the form, which names no schedule it was asked from", () => {
    const { schedule: _schedule, ...created } = { ...end, kind: "schedule", name: "nightly-shop" };

    expect(readKeptEnds([created])).toEqual([created]);
    expect(readKeptEnds([{ ...created, schedule: "daily" }])).toEqual([]);
  });

  it("reads the end of a restore, which names its backup and no schedule", () => {
    const { schedule: _schedule, ...restore } = { ...end, kind: "restore", name: "nightly-1", backup: "nightly" };

    expect(readKeptEnds([restore])).toEqual([restore]);
    const { backup: _backup, ...unnamed } = restore;

    expect(readKeptEnds([unnamed])).toEqual([]);
    expect(readKeptEnds([{ ...restore, schedule: "daily" }])).toEqual([]);
    // Only a restore names a backup.
    expect(readKeptEnds([{ ...end, backup: "nightly" }])).toEqual([]);
  });

  it("reads the end of a backup of the form, which names no schedule", () => {
    const { schedule: _schedule, ...form } = { ...end, kind: "backup" };

    expect(readKeptEnds([form])).toEqual([form]);
    // A backup of the form names no schedule, and one asked from a schedule names its own.
    expect(readKeptEnds([{ ...form, schedule: "daily" }])).toEqual([]);
    const { schedule: _none, ...unnamed } = end;

    expect(readKeptEnds([unnamed])).toEqual([]);
  });

  it.each([
    ["a request that is not an identifier", { ...end, request: "r" }],
    ["another kind", { ...end, kind: "DownloadRequest" }],
    ["a name that is not one", { ...end, name: "Daily" }],
    ["a field the contract does not know", { ...end, more: 1 }],
    ["an outcome of no shape", { ...end, outcome: { created: "yes" } }],
    ["a failure without words", { ...end, outcome: { created: false, code: "conflict" } }],
    ["a time that is not one", { ...end, at: Number.NaN }],
    ["a phase longer than one", { ...end, outcome: { created: true, phase: "P".repeat(65) } }],
    ["a namespace that is not one", { ...end, namespace: "Velero" }],
    ["no context", { ...end, context: "" }],
    ["a schedule that is not a name", { ...end, schedule: "" }],
    ["a time of another type", { ...end, at: "1" }],
    ["an outcome with a field it does not know", { ...end, outcome: { created: true, more: 1 } }],
    ["a found that is not true", { ...end, outcome: { created: true, found: false } }],
    ["a code that is not one", { ...end, outcome: { created: false, code: "", text: "words" } }],
    ["words too long", { ...end, outcome: { created: false, code: "conflict", text: "w".repeat(1025) } }],
    ["no object", 7],
  ])("leaves out an end with %s, and keeps the others", (_, value) => {
    const other = { ...end, request: randomUUID() };

    expect(readKeptEnds([value, other])).toEqual([other]);
  });

  it("refuses what is not a list of ends, or more ends than are kept", () => {
    const many = (count: number) => Array.from({ length: count }, () => ({ ...end, request: randomUUID() }));

    expect(readKeptEnds({ ends: [end] })).toBeUndefined();
    expect(readKeptEnds(many(KEPT_ENDS_BOUND + 1))).toBeUndefined();
    expect(readKeptEnds(many(KEPT_ENDS_BOUND))).toHaveLength(KEPT_ENDS_BOUND);
  });
});

describe("what the operator allows, between the processes", () => {
  const origin = "https://storage.example:9000";

  it("reads a request that allows or takes back: one cluster, one kind, one origin, and a location for an origin", () => {
    expect(readAllowanceRequest({ cluster, what: "origin", origin, location: "velero/default" })).toEqual({
      cluster,
      what: "origin",
      origin,
      location: "velero/default",
    });
    expect(readAllowanceRequest({ cluster, what: "private", origin })).toEqual({ cluster, what: "private", origin });
    expect(readAllowanceRequest({ cluster, what: "http", origin: "http://minio.storage:9000" })).toEqual({
      cluster,
      what: "http",
      origin: "http://minio.storage:9000",
    });
    for (const broken of [
      { what: "private", origin },
      { cluster, origin },
      { cluster, what: "private" },
      { cluster, what: "everything", origin },
      { cluster, what: "origin", origin },
      { cluster, what: "origin", origin, location: "Not A Name" },
      { cluster, what: "private", origin, location: "velero/default" },
      // What is allowed is an origin, and never a URL: nothing after the host and the port.
      { cluster, what: "private", origin: `${origin}/bucket/key` },
      { cluster, what: "private", origin: `${origin}?X-Amz-Signature=synthetic` },
      { cluster, what: "private", origin: "https://user:secret@storage.example" },
      { cluster, what: "private", origin: "HTTPS://Storage.example" },
      { cluster, what: "private", origin, since: 1 },
      { cluster: "../other", what: "private", origin },
      "allow everything",
      null,
    ])
      expect([broken, readAllowanceRequest(broken)]).toEqual([broken, undefined]);
  });

  it("reads in a failure what the operator may allow for the request to go on, and nothing else of that form", () => {
    const refused = { ok: false, code: "destination-denied", stage: "route", retry: false, text: "Not allowed yet." };
    const read = (needs: unknown) => readAnswer({ ...refused, needs }, readWriteConfirmAnswer);

    expect(read({ what: "origin", origin, location: "velero/default" })).toEqual({
      ...refused,
      needs: { what: "origin", origin, location: "velero/default" },
    });
    expect(read({ what: "private", origin })).toEqual({ ...refused, needs: { what: "private", origin } });
    // A failure that asks for nothing has no such field.
    expect(readAnswer(refused, readWriteConfirmAnswer)).toEqual(refused);
    for (const needs of [
      { what: "origin", origin },
      { what: "private", origin: `${origin}/bucket/key?X-Amz-Signature=synthetic` },
      { what: "private", origin, url: "https://leak.invalid" },
      { what: "everything", origin },
      "https://storage.example",
      null,
      [],
    ])
      expect([needs, read(needs)]).toEqual([needs, expect.objectContaining({ code: "validation", stage: "answer" })]);
  });
});

describe("the problems a failure says", () => {
  const LEAD = "The form is refused, and nothing was sent: ";

  it("says each problem as a sentence that ends with its full stop, in its order", () => {
    expect(saidProblems(LEAD, ["nodes are non-restorable resources", "The name is taken."])).toBe(
      `${LEAD}nodes are non-restorable resources. The name is taken.`,
    );
  });

  it("says as many as the text of a failure carries, and how many more, in a text the views take", () => {
    // Twenty-five conflicts of the lists, as many names in both.
    const problems = Array.from(
      { length: 25 },
      (_, at) =>
        `Invalid included/excluded namespace lists: excludes list cannot contain an item in the includes list: namespace-of-the-shop-${at}`,
    );
    const text = saidProblems(LEAD, problems);

    expect(text.length).toBeLessThanOrEqual(FAILURE_TEXT_BOUND);
    expect(text.startsWith(`${LEAD}${problems[0]}. ${problems[1]}.`)).toBe(true);
    const said = (text.match(/namespace-of-the-shop-/g) ?? []).length;

    expect(said).toBeGreaterThan(0);
    expect(text.endsWith(` ${PROBLEMS_WORDS.more(25 - said)}`)).toBe(true);
    expect(
      readAnswer({ ok: false, code: "validation", stage: "request", retry: false, text }, readWriteConfirmAnswer),
    ).toEqual({ ok: false, code: "validation", stage: "request", retry: false, text });
    // The bound of the views, and a text one character longer is not one they take.
    expect(
      readAnswer(
        { ok: false, code: "validation", stage: "request", retry: false, text: "x".repeat(FAILURE_TEXT_BOUND + 1) },
        readWriteConfirmAnswer,
      ),
    ).toMatchObject({ code: "validation", stage: "answer" });
  });

  it("leaves out a problem too long to be said and says the next ones, and says how many it left", () => {
    const long = "x".repeat(FAILURE_TEXT_BOUND);

    expect(saidProblems(LEAD, [long, "The name is taken"])).toBe(`${LEAD}The name is taken. ${PROBLEMS_WORDS.more(1)}`);
    expect(saidProblems(LEAD, [long, long])).toBe(`${LEAD}${PROBLEMS_WORDS.unsaid(2)}`);
    expect(saidProblems(LEAD, [long])).toBe(`${LEAD}${PROBLEMS_WORDS.unsaid(1)}`);
  });
});

describe("the answers between the processes", () => {
  it("reads an answer with its value, and a failure with its code, its stage, its retry and its words", () => {
    expect(readAnswer({ ok: true, value: { token: randomUUID(), expires: 1 } }, readWriteConfirmAnswer)).toMatchObject({
      ok: true,
    });
    expect(
      readAnswer(
        { ok: false, code: "forbidden", stage: "gate", retry: false, text: "Writes are off." },
        readWriteConfirmAnswer,
      ),
    ).toEqual({ ok: false, code: "forbidden", stage: "gate", retry: false, text: "Writes are off." });
  });

  it("turns what is not an answer into a failure of the way, without raising", () => {
    for (const broken of [
      undefined,
      null,
      "ok",
      { ok: "yes" },
      { ok: true },
      { ok: true, value: {}, more: 1 },
      { ok: true, value: { token: "nope", expires: 1 } },
      { ok: false, code: "forbidden" },
      { ok: false, code: "forbidden", stage: "gate", retry: "no", text: "x" },
      { ok: false, code: "forbidden", stage: "gate", retry: false, text: "x", url: "https://leak.invalid" },
    ]) {
      expect(readAnswer(broken, readWriteConfirmAnswer)).toMatchObject({
        ok: false,
        code: "validation",
        stage: "answer",
      });
    }
  });

  it("reads what the main process answers of an artifact: the request, the size, the pages and the route in words", () => {
    const value = {
      request: { name: "nightly-0e7c5b7a", uid: "uid" },
      size: 12,
      pages: 1,
      route: { mode: "tunnel", encrypted: false, origin: "http://storage.velero.svc:8333" },
    };

    expect(readArtifactValue(value)).toEqual(value);
    expect(readArtifactValue({ ...value, route: { ...value.route, mode: "direct", encrypted: true } })).toMatchObject({
      route: { mode: "direct", encrypted: true },
    });
    // A text of no byte is a text: it has no page.
    expect(readArtifactValue({ ...value, size: 0, pages: 0 })).toMatchObject({ size: 0, pages: 0 });
    expect(readArtifactValue({ ...value, route: { ...value.route, mode: "test" } })).toBeUndefined();
    expect(readArtifactValue({ ...value, route: { ...value.route, encrypted: "yes" } })).toBeUndefined();
    expect(readArtifactValue({ ...value, size: -1 })).toBeUndefined();
    expect(readArtifactValue({ ...value, pages: 1.5 })).toBeUndefined();
    expect(readArtifactValue({ ...value, request: { name: "nightly" } })).toBeUndefined();
    expect(readArtifactValue({ ...value, url: "https://leak.invalid/?X-Amz-Signature=1" })).toBeUndefined();
    // The origin of the store and nothing of a URL after it: no path, no query, no user.
    for (const origin of [
      "http://storage.velero.svc:8333/bucket/backups/nightly/nightly-logs.gz",
      "https://storage.example.invalid/?X-Amz-Signature=SENTINEL",
      "https://user:secret@storage.example.invalid",
      "https://storage.example.invalid#fragment",
      "ftp://storage.example.invalid",
      "storage.example.invalid",
      "",
      1,
    ]) {
      expect([origin, readArtifactValue({ ...value, route: { ...value.route, origin } })]).toEqual([origin, undefined]);
    }
  });

  it("reads a page of the text of an artifact, as large as a page is and no larger", () => {
    const page = { page: 0, pages: 2, text: 'time="2026-09-30T10:00:00Z" level=info msg="Backup completed"' };
    const full = { page: 1, pages: 2, text: "x".repeat(PAGE_BOUND) };

    expect(readArtifactPage(page)).toEqual(page);
    expect(readArtifactPage(full)).toEqual(full);
    expect(readArtifactPage({ ...full, text: `${full.text}x` })).toBeUndefined();
    expect(readArtifactPage({ ...page, page: 2 })).toBeUndefined();
    expect(readArtifactPage({ ...page, page: -1 })).toBeUndefined();
    expect(readArtifactPage({ ...page, text: ["x"] })).toBeUndefined();
    expect(readArtifactPage({ ...page, more: 1 })).toBeUndefined();
    // A page is beyond the bound of a request, and is read when its reader bounds it itself; every other
    // answer stays within the bound, and so does a failure, whoever reads it.
    expect(readAnswer({ ok: true, value: full }, readArtifactPage, true)).toEqual({ ok: true, value: full });
    expect(readAnswer({ ok: true, value: full }, readArtifactPage)).toMatchObject({ ok: false, stage: "answer" });
    expect(readAnswer({ ok: true, value: { ...full, text: `${full.text}x` } }, readArtifactPage, true)).toMatchObject({
      ok: false,
      stage: "answer",
    });
    expect(
      readAnswer(
        { ok: false, code: "forbidden", stage: "request", retry: false, text: "x".repeat(REQUEST_BOUND) },
        readArtifactPage,
        true,
      ),
    ).toMatchObject({ ok: false, code: "validation", stage: "answer" });
  });

  it("reads whether a text was saved, and nothing else of what the main process answers of a saving", () => {
    expect(readArtifactSaved({ saved: true })).toEqual({ saved: true });
    // The operator closed the dialog: nothing was written, and that is what the views read.
    expect(readArtifactSaved({ saved: false })).toEqual({ saved: false });
    for (const saved of ["true", 1, 0, null, undefined, {}]) {
      expect([saved, readArtifactSaved({ saved })]).toEqual([saved, undefined]);
    }
    expect(readArtifactSaved({})).toBeUndefined();
    expect(readArtifactSaved(null)).toBeUndefined();
    expect(readArtifactSaved(true)).toBeUndefined();
    // Nothing of a file crosses the contract: an answer that says where the text went is not one.
    expect(readArtifactSaved({ saved: true, path: "/home/operator/nightly-logs.txt" })).toBeUndefined();
    expect(readAnswer({ ok: true, value: { saved: false } }, readArtifactSaved)).toEqual({
      ok: true,
      value: { saved: false },
    });
  });

  it("suggests for the text of an artifact the name of its file in the store, as text, and nothing that is not of a name", () => {
    expect(ARTIFACT_TARGETS.map((artifact) => [artifact, savedFileName(artifact, "nightly")])).toEqual([
      ["BackupLog", "nightly-logs.txt"],
      ["RestoreLog", "restore-nightly-logs.txt"],
      ["BackupResults", "nightly-results.json"],
      ["RestoreResults", "restore-nightly-results.json"],
      ["BackupResourceList", "nightly-resource-list.json"],
      ["RestoreResourceList", "restore-nightly-resource-list.json"],
      ["BackupVolumeInfos", "nightly-volumeinfo.json"],
      ["RestoreVolumeInfo", "restore-nightly-volumeinfo.json"],
    ]);
    // The name of an object is of letters, digits, dots and dashes, and is written as it is.
    expect(savedFileName("BackupLog", "nightly.2026-09-30_a")).toBe("nightly.2026-09-30_a-logs.txt");
    // What is not a letter, a digit, a dot, a dash or an underscore is not written into the name of a
    // file: a name that is not the one of an object leads to no folder, and says nothing to a shell.
    expect(savedFileName("RestoreResults", "../of monday/night:è")).toBe("restore-.._of_monday_night__-results.json");
  });

  it("reads the state of the gate, on and off, with the connection when it is there", () => {
    const off = { cluster: { id: cluster, name: "demo", context: "kind-demo" }, writes: { on: false } };
    const on = { ...off, writes: { on: true, namespace: "velero", since: 1700000000000 } };

    expect(readGateState(off)).toEqual(off);
    expect(readGateState(on)).toEqual(on);
    expect(readGateState({ ...off, connection: { supported: false, reason: "unusable" } })).toEqual({
      ...off,
      connection: { supported: false, reason: "unusable" },
    });
    expect(readGateState({ ...off, writes: { on: true } })).toBeUndefined();
    expect(readGateState({ ...off, writes: { on: false, namespace: "x" } })).toBeUndefined();
    expect(readGateState({ ...off, connection: { supported: false, reason: "other" } })).toBeUndefined();
    expect(readGateState({ ...off, cluster: { id: cluster, name: "demo" } })).toBeUndefined();
  });

  it("reads nothing of a connection the main process can no longer say: a credential it takes, or a form of a kubeconfig it refuses", () => {
    const off = { cluster: { id: cluster, name: "demo", context: "kind-demo" }, writes: { on: false } };

    // The writes go through the client of the host: the main process names no credential and refuses no form
    // of a kubeconfig, and what says one is not an answer of the contract.
    for (const connection of [
      { supported: true, credential: "token" },
      { supported: true, credential: "plugin" },
      { supported: true },
      ...[
        "entry",
        "file",
        "context",
        "auth-provider",
        "proxy",
        "basic",
        "insecure-tls",
        "no-credential",
        "impersonation",
      ].map((reason) => ({ supported: false, reason })),
      { supported: false, reason: "unusable", credential: "token" },
    ]) {
      expect(readGateState({ ...off, connection })).toBeUndefined();
    }
    expect(REQUEST_STAGES).toEqual({ creation: "creation", wait: "wait" });
  });

  it("reads the status of a write and the answer of the server", () => {
    expect(readWriteStatus({ step: "waiting for the URL", count: 3 })).toEqual({
      step: "waiting for the URL",
      count: 3,
    });
    expect(readWriteStatus({ step: "created" })).toEqual({ step: "created" });
    expect(readWriteStatus({ step: "created", count: "3" })).toBeUndefined();
    expect(readWriteStatus({ count: 3 })).toBeUndefined();
    const status = {
      version: "v1.18.4",
      processed: "2026-09-30T10:00:00Z",
      plugins: [{ name: "velero.io/aws", kind: "ObjectStore" }],
      request: { name: "freelens-velero-abcde", uid: "uid" },
    };

    expect(readServerStatusValue(status)).toEqual(status);
    expect(readServerStatusValue({ ...status, plugins: [{ name: "velero.io/aws" }] })).toBeUndefined();
    expect(readServerStatusValue({ ...status, plugins: "none" })).toBeUndefined();
    expect(readServerStatusValue({ ...status, request: { name: "x" } })).toBeUndefined();
  });
});
