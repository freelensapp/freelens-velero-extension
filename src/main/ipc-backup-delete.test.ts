// The procedures of the deletion of one backup, as the frames call them (SPEC-0017, DELETE-02, DELETE-04, DELETE-05,
// DELETE-07, ACT-02, ACT-03, ACT-05 to ACT-07): the confirmation that reads the backup by its name and answers the text
// of its DeleteBackupRequest; the run that takes the name of the backup as it was typed, reads the backup again and
// sends that text byte for byte, then reads the request and the backup together until what they show is an end; and
// every way it ends, a creation whose answer is not known never sent again and looked for by the labels of its backup.

import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { deleteRequestOf, deleteRequestText } from "../common/delete-request";
import { CHANNELS, readKeptEnds } from "../common/ipc";
import { BACKUP_DELETE_WORDS, LOOK_AFTER, runBackupDelete } from "./backup-delete";
import { DiagnosticError } from "./diagnostic-transport";
import { registerHandlers } from "./ipc";
import { WriteGate } from "./write-gate";

import type { CatalogEntry } from "./catalog";
import type { DiagnosticObject } from "./diagnostic-kubernetes";
import type { IpcEvent, Registrar } from "./ipc";

const FRAME_A: IpcEvent = {
  senderFrame: { url: "https://cluster-a.renderer.freelens.app:1234/" },
  processId: 1,
  frameId: 4,
};
const BACKUP = { kind: "Backup" as const, name: "nightly", uid: "nightly-uid" };
const NOW = Date.parse("2026-11-08T12:00:00Z");
const TEXT = deleteRequestText(deleteRequestOf("velero", { name: BACKUP.name, uid: BACKUP.uid }));
// The errors of a refusal and of a deletion that failed, as Velero writes them.
const REFUSAL = ["backup deletion failed: backup storage location default is ReadOnly"];
const ERRORS = ["error deleting backup from backup storage: synthetic", "error deleting restore restore-1: synthetic"];

function backupOf(phase: string | undefined, uid = BACKUP.uid): DiagnosticObject {
  return {
    apiVersion: "velero.io/v1",
    kind: "Backup",
    metadata: { name: BACKUP.name, namespace: "velero", uid },
    spec: { storageLocation: "default" },
    ...(phase ? { status: { phase } } : {}),
  } as DiagnosticObject;
}

// What the cluster of the test holds, and what the deletion controller does between two reads: each step is taken at a
// read of the requests, by their name or by the labels of their backup.
interface State {
  backup: DiagnosticObject | undefined;
  requests: Map<string, DiagnosticObject>;
  steps: ((state: State) => void)[];
  backupError?: DiagnosticError;
  requestError?: DiagnosticError;
  listError?: DiagnosticError;
  create?: (text: string) => Promise<DiagnosticObject>;
  now: number;
  generated: number;
  // A jump of the clock at the next wait, as if the wait had lasted longer.
  jump?: number;
}

// The steps of the deletion controller of the release (backup_deletion_controller.go).
const velero = {
  // The request read, and the backup Deleting while Velero deletes what it holds.
  starts: (state: State) => {
    for (const request of state.requests.values()) request.status = { phase: "InProgress" };
    if (state.backup) state.backup.status = { phase: "Deleting" };
  },
  // Nothing failed: the backup goes, and every request of it with it.
  completes: (state: State) => {
    state.backup = undefined;
    state.requests.clear();
  },
  // The backup gone and the request Processed with no error, before Velero deletes the requests.
  processed: (state: State) => {
    state.backup = undefined;
    for (const request of state.requests.values()) request.status = { phase: "Processed" };
  },
  // Refused before it starts: the backup keeps its phase.
  refuses: (state: State) => {
    for (const request of state.requests.values()) request.status = { phase: "Processed", errors: REFUSAL };
  },
  // A step after the one of the plugins failed: the backup stays Deleting.
  fails: (state: State) => {
    for (const request of state.requests.values()) request.status = { phase: "Processed", errors: ERRORS };
    if (state.backup) state.backup.status = { phase: "Deleting" };
  },
  // A later request for the same backup, which deletes the other ones before it starts.
  replaces: (state: State) => {
    state.requests.clear();
  },
  // Nothing happens at this read.
  waits: (_state: State) => undefined,
};

function fixture() {
  const catalog: CatalogEntry[] = [
    { id: "cluster-a", name: "demo", kubeConfigPath: "/synthetic/a", contextName: "kind-a", status: "connected" },
  ];
  const handlers = new Map<string, (event: IpcEvent, payload: unknown) => Promise<unknown>>();
  const registrar: Registrar = {
    handle: (channel, handler) => handlers.set(channel, handler),
    broadcast: () => undefined,
  };
  const state: State = {
    backup: backupOf("Completed"),
    requests: new Map(),
    steps: [],
    now: NOW,
    generated: 0,
  };
  const step = () => state.steps.shift()?.(state);
  const adapter = {
    binding: { id: "cluster-a", name: "demo", kubeConfigPath: "/synthetic/a", contextName: "kind-a" },
    assertCurrent: vi.fn(),
    read: vi.fn(async (kind: string, _namespace: string, name: string, signal?: AbortSignal) => {
      // As the adapter does, a read with a signal that ended does not leave.
      if (signal?.aborted) throw new DiagnosticError("cancelled");
      if (kind === "Backup") {
        if (state.backupError) throw state.backupError;
        if (!state.backup || state.backup.metadata.name !== name) throw new DiagnosticError("not-found");
        return structuredClone(state.backup);
      }
      step();
      if (state.requestError) throw state.requestError;
      const request = state.requests.get(name);

      if (!request) throw new DiagnosticError("not-found");
      return structuredClone(request);
    }),
    createDeleteBackupRequest: vi.fn(async (namespace: string, text: string): Promise<DiagnosticObject> => {
      if (state.create) return state.create(text);
      const created = requestOf(text, namespace);

      state.requests.set(created.metadata.name, created);
      return structuredClone(created);
    }),
    deleteRequestsOf: vi.fn(async (_namespace: string, backup: { name: string; uid: string }, signal?: AbortSignal) => {
      if (signal?.aborted) throw new DiagnosticError("cancelled");
      step();
      if (state.listError) throw state.listError;
      return [...state.requests.values()]
        .filter((item) => item.metadata.labels?.["velero.io/backup-uid"] === backup.uid)
        .map((item) => structuredClone(item));
    }),
  };
  // The request the API server makes of a text: a name generated from its prefix, a UID and the time of its creation.
  const requestOf = (text: string, namespace = "velero", at = state.now): DiagnosticObject => {
    const body = JSON.parse(text) as DiagnosticObject & { metadata: { generateName: string } };

    state.generated += 1;
    const name = `${body.metadata.generateName}${String(state.generated).padStart(5, "x")}`;

    return {
      ...body,
      metadata: {
        ...body.metadata,
        name,
        namespace,
        uid: `${name}-uid`,
        creationTimestamp: new Date(at).toISOString(),
      },
    } as DiagnosticObject;
  };
  const gate = new WriteGate({ catalog: () => catalog, adapter: () => adapter as never, now: () => state.now });

  registerHandlers(registrar, {
    catalog: () => catalog,
    gate,
    pollMs: 5,
    now: () => state.now,
    sleep: async (milliseconds: number) => {
      state.now += milliseconds + (state.jump ?? 0);
      state.jump = undefined;
    },
  });
  const call = (channel: string, payload: unknown, event = FRAME_A) => {
    const handler = handlers.get(channel);

    if (!handler) throw new Error(`no handler for ${channel}`);
    return handler(event, payload) as Promise<{
      ok: boolean;
      value?: Record<string, unknown>;
      code?: string;
      text?: string;
      stage?: string;
      retry?: boolean;
    }>;
  };
  const enable = () =>
    call(CHANNELS.gateEnable, {
      cluster: "cluster-a",
      namespace: "velero",
      confirmation: { context: "kind-a", namespace: "velero" },
    });
  const of = { cluster: "cluster-a", namespace: "velero", kind: "delete-backup", target: BACKUP };
  const confirm = (target = BACKUP) => call(CHANNELS.writeConfirm, { ...of, target });
  const run = (token: string, typed = BACKUP.name, request = randomUUID(), target = BACKUP) =>
    call(CHANNELS.writeRun, { ...of, target, typed, token, request });
  const token = async () => String((await confirm()).value?.token);
  const backupReads = () => adapter.read.mock.calls.filter(([kind]) => kind === "Backup");
  const ends = async () => readKeptEnds((await call(CHANNELS.writeEnds, { cluster: "cluster-a" })).value) ?? [];

  return { state, adapter, gate, call, enable, confirm, run, token, backupReads, requestOf, ends };
}

describe("the confirmation of the deletion of a backup", () => {
  it("is refused with writes off, and reads nothing", async () => {
    const { confirm, adapter } = fixture();

    expect(await confirm()).toMatchObject({ ok: false, code: "forbidden", stage: "gate" });
    expect(adapter.read).not.toHaveBeenCalled();
  });

  it("reads the backup and answers the text of its DeleteBackupRequest, as `velero backup delete` makes it, with the token", async () => {
    const { enable, confirm, backupReads, adapter } = fixture();

    await enable();
    const confirmed = await confirm();

    expect(confirmed).toMatchObject({ ok: true, value: { text: TEXT, token: expect.any(String) } });
    // The name the API server generates from the prefix of the backup, the labels of its name and of its UID, and the
    // backup by its name: no other label, no annotation, no name and no status.
    expect(JSON.parse(String(confirmed.value?.text))).toEqual({
      apiVersion: "velero.io/v1",
      kind: "DeleteBackupRequest",
      metadata: {
        namespace: "velero",
        generateName: "nightly-",
        labels: { "velero.io/backup-name": "nightly", "velero.io/backup-uid": "nightly-uid" },
      },
      spec: { backupName: "nightly" },
    });
    expect(backupReads()).toHaveLength(1);
    expect(adapter.createDeleteBackupRequest).not.toHaveBeenCalled();
  });

  it("takes a backup of every phase Velero deletes, and is a conflict for one in progress or of another UID", async () => {
    const { enable, confirm, state } = fixture();

    await enable();
    for (const phase of [
      undefined,
      "New",
      "Queued",
      "ReadyToStart",
      "Completed",
      "PartiallyFailed",
      "Failed",
      "FailedValidation",
      "Deleting",
    ]) {
      state.backup = backupOf(phase);
      expect(await confirm(), String(phase)).toMatchObject({ ok: true });
    }
    // The phases of a backup in progress, waiting for its plugins or finalizing, which Velero refuses to delete.
    for (const phase of [
      "InProgress",
      "WaitingForPluginOperations",
      "WaitingForPluginOperationsPartiallyFailed",
      "Finalizing",
      "FinalizingPartiallyFailed",
    ]) {
      state.backup = backupOf(phase);
      expect(await confirm()).toEqual({
        ok: false,
        code: "conflict",
        stage: "read",
        retry: false,
        text: BACKUP_DELETE_WORDS.inProgress("nightly", phase),
      });
    }
    state.backup = backupOf("Completed", "another-uid");
    expect(await confirm()).toMatchObject({
      ok: false,
      code: "conflict",
      stage: "read",
      text: BACKUP_DELETE_WORDS.backupChanged,
    });
    state.backup = undefined;
    expect(await confirm()).toMatchObject({
      ok: false,
      code: "not-found",
      stage: "read",
      text: BACKUP_DELETE_WORDS.backupGone("nightly"),
    });
  });

  it("says a read of the backup the identity may not make, or one whose credential the cluster did not take", async () => {
    const { enable, confirm, state } = fixture();

    await enable();
    state.backupError = new DiagnosticError("forbidden");
    expect(await confirm()).toMatchObject({
      ok: false,
      code: "forbidden",
      stage: "read",
      text: BACKUP_DELETE_WORDS.forbiddenRead("velero"),
    });
    state.backupError = new DiagnosticError("forbidden", undefined, "credential");
    expect(await confirm()).toMatchObject({
      ok: false,
      code: "request-failed",
      retry: true,
      text: BACKUP_DELETE_WORDS.credential,
    });
  });

  it("is refused by the contract with a target that is not a backup, a field of another write, or a name typed", async () => {
    const { enable, call, adapter } = fixture();

    await enable();
    const of = { cluster: "cluster-a", namespace: "velero", kind: "delete-backup" };

    for (const payload of [
      of,
      { ...of, target: { kind: "Schedule", name: "nightly", uid: "nightly-uid" } },
      { ...of, target: { kind: "Restore", name: "nightly", uid: "nightly-uid" } },
      { ...of, target: BACKUP, backup: "nightly" },
      { ...of, target: BACKUP, restore: "nightly-restore" },
      { ...of, target: BACKUP, artifact: "BackupLog" },
      { ...of, target: BACKUP, resume: { expression: "0 3 * * *", skipImmediately: false } },
      { ...of, target: BACKUP, typed: "nightly" },
    ])
      expect(await call(CHANNELS.writeConfirm, payload)).toMatchObject({ ok: false, code: "validation" });
    expect(adapter.read).not.toHaveBeenCalled();
  });
});

describe("the run of the deletion of a backup", () => {
  it("takes the name of the backup typed, reads the backup again, sends the text byte for byte, once, and reads the request and the backup until the deletion completed", async () => {
    const { enable, run, token, adapter, state, backupReads } = fixture();

    await enable();
    const confirmed = await token();

    state.steps = [velero.waits, velero.starts, velero.waits, velero.completes];
    expect(await run(confirmed)).toEqual({ ok: true, value: { end: "completed", request: "nightly-xxxx1" } });
    expect(adapter.createDeleteBackupRequest).toHaveBeenCalledOnce();
    expect(adapter.createDeleteBackupRequest.mock.calls[0]?.slice(0, 2)).toEqual(["velero", TEXT]);
    // Read at the confirmation and at the run, then with the request at each of its four reads; the requests are read
    // by the name the API server gave this one, and never listed.
    expect(backupReads()).toHaveLength(6);
    expect(adapter.deleteRequestsOf).not.toHaveBeenCalled();
  });

  it("says each of the six ends the request and the backup show together, and never the backup deleted before the read shows it gone", async () => {
    const { enable, run, token, state } = fixture();

    await enable();
    const runOf = async (steps: ((state: State) => void)[], phase = "Completed") => {
      state.backup = backupOf(phase);
      state.requests.clear();
      state.steps = [...steps];
      return run(await token());
    };

    // Gone with the backup: a deletion Velero completed, since it deletes its requests when nothing failed.
    expect(await runOf([velero.starts, velero.completes])).toMatchObject({
      ok: true,
      value: { end: "completed" },
    });
    // Processed with no error, the backup gone: completed as well, once the read shows the backup gone.
    expect(await runOf([velero.processed])).toMatchObject({ ok: true, value: { end: "completed" } });
    // Gone with the backup there: a later request for the same backup replaced it.
    expect(await runOf([velero.replaces])).toMatchObject({
      ok: true,
      value: { end: "replaced", phase: "Completed" },
    });
    // Processed with the error of a refusal, the backup in the phase it had: refused, each error as written.
    expect(await runOf([velero.refuses])).toEqual({
      ok: true,
      value: { end: "refused", request: expect.any(String), phase: "Completed", errors: REFUSAL },
    });
    // A new request for a backup whose deletion failed before, refused at the location: the backup keeps its phase,
    // Deleting, and nothing was tried.
    expect(await runOf([velero.refuses], "Deleting")).toEqual({
      ok: true,
      value: { end: "refused", request: expect.any(String), phase: "Deleting", errors: REFUSAL },
    });
    // A backup that went before Velero looked at the request: refused, and nothing said of a phase.
    expect(
      await runOf([
        (inner) => {
          inner.backup = undefined;
          for (const request of inner.requests.values())
            request.status = { phase: "Processed", errors: ["backup deletion failed: backup not found"] };
        },
      ]),
    ).toEqual({
      ok: true,
      value: { end: "refused", request: expect.any(String), errors: ["backup deletion failed: backup not found"] },
    });
    // Processed with errors and the backup Deleting: a deletion that failed on the way, each error as written.
    expect(await runOf([velero.starts, velero.fails])).toEqual({
      ok: true,
      value: { end: "failed", request: expect.any(String), phase: "Deleting", errors: ERRORS },
    });
    // No phase for thirty seconds: Velero has not read it; InProgress for thirty seconds: Velero is at it.
    expect(await runOf([])).toEqual({
      ok: true,
      value: { end: "unread", request: expect.any(String), phase: "Completed" },
    });
    expect(await runOf([velero.starts])).toEqual({
      ok: true,
      value: { end: "in-progress", request: expect.any(String), phase: "Deleting" },
    });
    // A backup with no phase, deleted before it starts.
    expect(await runOf([velero.completes], "")).toMatchObject({ ok: true, value: { end: "completed" } });
    // Another request under the name of this one, of another UID, is not this one: this one is gone.
    expect(
      await runOf([
        (inner) => {
          for (const request of inner.requests.values()) request.metadata.uid = "another-uid";
        },
      ]),
    ).toMatchObject({ ok: true, value: { end: "replaced", phase: "Completed" } });
  });

  it("ends a read that does not answer with the thirty seconds, and the look after a lost answer with its own bound", async () => {
    const { enable, run, token, state, adapter, requestOf } = fixture();
    const hanging = (_kind: string, _namespace: string, _name: string, signal?: AbortSignal) =>
      new Promise<DiagnosticObject>((_resolve, reject) => {
        signal?.addEventListener("abort", () => reject(new DiagnosticError("cancelled")), { once: true });
      });

    await enable();
    const confirmed = await token();
    // The first wait lasts all but the last second of the thirty: the read that hangs then ends with them.
    state.jump = 28_000;
    adapter.read.mockImplementation(async (kind, namespace, name, signal) =>
      kind === "DeleteBackupRequest"
        ? hanging(kind, namespace, name, signal)
        : structuredClone(state.backup as DiagnosticObject),
    );
    expect(await run(confirmed)).toEqual({ ok: true, value: { end: "unread", request: expect.any(String) } });
    // The look after a lost answer ends at its own bound.
    const bound = LOOK_AFTER.forMs;

    LOOK_AFTER.forMs = 5;
    try {
      adapter.deleteRequestsOf.mockImplementation((_namespace, _backup, signal) =>
        hanging("DeleteBackupRequest", "", "", signal),
      );
      state.create = async (text) => {
        state.requests.set(requestOf(text).metadata.name, requestOf(text));
        throw new DiagnosticError("submission-unknown");
      };
      expect(await run(await token())).toMatchObject({
        ok: false,
        code: "submission-unknown",
        text: BACKUP_DELETE_WORDS.unknown("nightly"),
      });
    } finally {
      LOOK_AFTER.forMs = bound;
    }
  });

  it("reads every second for thirty seconds at most, and stops at an end", async () => {
    const { enable, run, token, adapter, state } = fixture();

    await enable();
    const started = state.now;

    expect(await run(await token())).toMatchObject({ ok: true, value: { end: "unread" } });
    expect(state.now - started).toBe(30_000);
    expect(adapter.read.mock.calls.filter(([kind]) => kind === "DeleteBackupRequest")).toHaveLength(30);
    // Each end that is final is read once, and the reads stop there.
    for (const steps of [[velero.refuses], [velero.completes], [velero.replaces], [velero.fails]]) {
      adapter.read.mockClear();
      state.backup = backupOf("Completed");
      state.requests.clear();
      state.steps = [...steps];
      await run(await token());
      expect(adapter.read.mock.calls.filter(([kind]) => kind === "DeleteBackupRequest")).toHaveLength(1);
    }
    // A request Processed with no error while the backup is still read is read again, until the backup is gone.
    adapter.read.mockClear();
    state.backup = backupOf("Completed");
    state.requests.clear();
    state.steps = [
      (inner) => {
        for (const request of inner.requests.values()) request.status = { phase: "Processed" };
        if (inner.backup) inner.backup.status = { phase: "Deleting" };
      },
      velero.waits,
      velero.completes,
    ];
    expect(await run(await token())).toEqual({ ok: true, value: { end: "completed", request: expect.any(String) } });
    expect(adapter.read.mock.calls.filter(([kind]) => kind === "DeleteBackupRequest")).toHaveLength(3);
  });

  it("says a read of the requests the identity may not make, and reads the backup alone then", async () => {
    const { enable, run, token, state } = fixture();

    await enable();
    const runOf = async (steps: ((state: State) => void)[]) => {
      state.backup = backupOf("Completed");
      state.requests.clear();
      state.steps = [...steps];
      return run(await token());
    };

    state.requestError = new DiagnosticError("forbidden");
    // The backup gone: deleted. Deleting: Velero is at it, or a deletion failed. Else: not started.
    expect(await runOf([velero.completes])).toEqual({
      ok: true,
      value: { end: "completed", request: expect.any(String), requestsUnread: true },
    });
    expect(await runOf([velero.starts])).toEqual({
      ok: true,
      value: { end: "in-progress", request: expect.any(String), phase: "Deleting", requestsUnread: true },
    });
    expect(await runOf([])).toEqual({
      ok: true,
      value: { end: "unread", request: expect.any(String), phase: "Completed", requestsUnread: true },
    });
    // A credential the cluster does not take says nothing of what the identity may read: the reads end there.
    state.requestError = new DiagnosticError("forbidden", undefined, "credential");
    expect(await runOf([velero.completes])).toEqual({
      ok: true,
      value: { end: "unread", request: expect.any(String) },
    });
  });

  it("ends the reads with what the last one showed when a read fails, and when another backup has the name", async () => {
    const { enable, run, token, state } = fixture();

    await enable();
    state.steps = [velero.starts, (inner) => (inner.requestError = new DiagnosticError("request-failed"))];
    expect(await run(await token())).toMatchObject({ ok: true, value: { end: "in-progress", phase: "Deleting" } });
    state.requestError = undefined;
    state.backup = backupOf("Completed");
    state.requests.clear();
    // A backup created again under the name is not the one of the request: this one is gone.
    state.steps = [(inner) => (inner.backup = backupOf("Completed", "another-uid")), velero.replaces];
    expect(await run(await token())).toMatchObject({ ok: true, value: { end: "completed" } });
  });

  it("runs nothing for another name typed, and keeps the review for the name as it is written", async () => {
    const { enable, run, token, adapter } = fixture();

    await enable();
    const confirmed = await token();

    for (const typed of ["nightl", "nightly ", "Nightly", "weekly", ""])
      expect(await run(confirmed, typed)).toEqual({
        ok: false,
        code: "validation",
        stage: "request",
        retry: false,
        text: BACKUP_DELETE_WORDS.typed("nightly"),
      });
    expect(adapter.createDeleteBackupRequest).not.toHaveBeenCalled();
    // The token was not taken: the name as it is written runs it.
    expect(await run(confirmed)).toMatchObject({ ok: true });
  });

  it("is refused by the contract without a name typed, or with the text of a request", async () => {
    const { enable, call, token, adapter } = fixture();

    await enable();
    const of = { cluster: "cluster-a", namespace: "velero", kind: "delete-backup", target: BACKUP };
    const confirmed = await token();

    for (const payload of [
      { ...of, token: confirmed, request: randomUUID() },
      { ...of, typed: 7, token: confirmed, request: randomUUID() },
      { ...of, typed: "a".repeat(254), token: confirmed, request: randomUUID() },
      { ...of, typed: "nightly", text: TEXT, token: confirmed, request: randomUUID() },
    ])
      expect(await call(CHANNELS.writeRun, payload)).toMatchObject({ ok: false, code: "validation" });
    expect(adapter.createDeleteBackupRequest).not.toHaveBeenCalled();
  });

  it("sends nothing when the backup changed since the review, went, or is in progress now", async () => {
    const { enable, run, token, adapter, state } = fixture();

    await enable();
    for (const [backup, code, text] of [
      [backupOf("Completed", "another-uid"), "conflict", BACKUP_DELETE_WORDS.backupChanged],
      [undefined, "not-found", BACKUP_DELETE_WORDS.backupGone("nightly")],
      [backupOf("InProgress"), "conflict", BACKUP_DELETE_WORDS.inProgress("nightly", "InProgress")],
    ] as const) {
      state.backup = backupOf("Completed");
      const confirmed = await token();

      state.backup = backup;
      expect(await run(confirmed)).toMatchObject({ ok: false, code, stage: "read", text });
    }
    expect(adapter.createDeleteBackupRequest).not.toHaveBeenCalled();
  });

  it("sends nothing when the write is cancelled while the backup is read again", async () => {
    const { enable, run, token, call, adapter } = fixture();

    await enable();
    const confirmed = await token();
    const request = randomUUID();

    adapter.read.mockImplementationOnce(async () => {
      await call(CHANNELS.writeCancel, { cluster: "cluster-a", request });
      return backupOf("Completed");
    });
    expect(await run(confirmed, "nightly", request)).toEqual({
      ok: false,
      code: "cancelled",
      stage: "creation",
      retry: true,
      text: BACKUP_DELETE_WORDS.cancelled,
    });
    expect(adapter.createDeleteBackupRequest).not.toHaveBeenCalled();
  });

  it("runs only for the backup it was confirmed for, by its name and its UID", async () => {
    const { enable, run, token, adapter } = fixture();

    await enable();
    const confirmed = await token();

    expect(
      await run(confirmed, "nightly", randomUUID(), { kind: "Backup", name: "nightly", uid: "another-uid" }),
    ).toMatchObject({ ok: false, code: "forbidden", stage: "confirmation" });
    expect(
      await run(confirmed, "weekly", randomUUID(), { kind: "Backup", name: "weekly", uid: "nightly-uid" }),
    ).toMatchObject({
      ok: false,
      code: "forbidden",
      stage: "confirmation",
    });
    expect(adapter.createDeleteBackupRequest).not.toHaveBeenCalled();
  });

  it("sends nothing when the text kept with the token is not the request of the backup of the run", async () => {
    const { enable, gate, state, adapter } = fixture();

    await enable();
    const request = (text: string | undefined) => {
      const confirmed = gate.confirm(
        "frame",
        "cluster-a",
        "velero",
        "delete-backup",
        BACKUP,
        undefined,
        text === undefined ? { name: "nightly" } : { name: "nightly", text },
      );

      if (!confirmed.ok) throw new Error("not confirmed");
      return runBackupDelete(
        {
          gate,
          now: () => state.now,
          sleep: async (milliseconds) => {
            state.now += milliseconds;
          },
        },
        "frame",
        {
          cluster: "cluster-a",
          namespace: "velero",
          kind: "delete-backup",
          target: BACKUP,
          typed: "nightly",
          token: confirmed.value.token,
          request: randomUUID(),
        },
        () => () => undefined,
      );
    };

    for (const text of [
      undefined,
      "",
      JSON.stringify(JSON.parse(TEXT)),
      deleteRequestText(deleteRequestOf("another", { name: "nightly", uid: "nightly-uid" })),
      deleteRequestText(deleteRequestOf("velero", { name: "weekly", uid: "nightly-uid" })),
      deleteRequestText(deleteRequestOf("velero", { name: "nightly", uid: "another-uid" })),
    ])
      expect(await request(text)).toMatchObject({
        ok: false,
        code: "conflict",
        stage: "review",
        text: BACKUP_DELETE_WORDS.reviewChanged,
      });
    expect(adapter.createDeleteBackupRequest).not.toHaveBeenCalled();
  });

  it("says each end of the creation with its code, its stage, its safety and its words, and keeps the ends of what was sent and only them", async () => {
    const { enable, run, token, state, ends } = fixture();

    await enable();
    const kept = new Map<string, string>();

    for (const [error, code, retry, text, sent] of [
      // A 409 is the generated name meeting the name of a request that is there: nothing was created.
      [new DiagnosticError("conflict"), "conflict", false, BACKUP_DELETE_WORDS.exists, true],
      [new DiagnosticError("forbidden"), "forbidden", false, BACKUP_DELETE_WORDS.forbiddenCreate("velero"), true],
      [
        new DiagnosticError("forbidden", undefined, "credential"),
        "request-failed",
        true,
        BACKUP_DELETE_WORDS.credential,
        true,
      ],
      [
        new DiagnosticError("validation", undefined, "refused"),
        "validation",
        false,
        BACKUP_DELETE_WORDS.rejected,
        true,
      ],
      [new DiagnosticError("not-found"), "not-found", false, BACKUP_DELETE_WORDS.notServed("velero"), true],
      [new DiagnosticError("request-failed"), "request-failed", false, BACKUP_DELETE_WORDS.declined, true],
      // The cluster changed once it answered: the request may have been created.
      [
        new DiagnosticError("target-changed", undefined, "answered"),
        "submission-unknown",
        false,
        BACKUP_DELETE_WORDS.changedAfter("nightly"),
        true,
      ],
      [new Error("synthetic"), "request-failed", false, BACKUP_DELETE_WORDS.failed, true],
      // What was not sent is not kept: a text the adapter refused, a cluster that changed before, one it could not reach.
      [new DiagnosticError("validation"), "validation", false, BACKUP_DELETE_WORDS.unsent, false],
      [new DiagnosticError("target-changed"), "target-changed", false, BACKUP_DELETE_WORDS.changed, false],
      [
        new DiagnosticError("transport-unreachable"),
        "transport-unreachable",
        true,
        BACKUP_DELETE_WORDS.unreachable,
        false,
      ],
    ] as const) {
      const request = randomUUID();

      state.create = async () => {
        throw error;
      };
      expect(await run(await token(), "nightly", request)).toEqual({ ok: false, code, stage: "creation", retry, text });
      if (sent) kept.set(request, code);
    }
    expect(
      new Map((await ends()).map((end) => [end.request, end.outcome.created ? "created" : end.outcome.code])),
    ).toEqual(kept);
  });

  it("says each end of the read of the backup at the run with its safety, and sends nothing", async () => {
    const { enable, run, token, state, adapter } = fixture();

    await enable();
    for (const [error, code, retry, text] of [
      [new DiagnosticError("deadline"), "deadline", true, BACKUP_DELETE_WORDS.slow],
      [new DiagnosticError("transport-unreachable"), "transport-unreachable", true, BACKUP_DELETE_WORDS.unreachable],
      [new DiagnosticError("forbidden"), "forbidden", false, BACKUP_DELETE_WORDS.forbiddenRead("velero")],
      [
        new DiagnosticError("forbidden", undefined, "credential"),
        "request-failed",
        true,
        BACKUP_DELETE_WORDS.credential,
      ],
    ] as const) {
      const confirmed = await token();

      state.backupError = error;
      expect(await run(confirmed)).toEqual({ ok: false, code, stage: "read", retry, text });
      state.backupError = undefined;
    }
    expect(adapter.createDeleteBackupRequest).not.toHaveBeenCalled();
  });

  it("takes no answer of the creation that is not the request of this backup", async () => {
    const { enable, run, token, state, requestOf } = fixture();

    await enable();
    for (const strange of [
      (text: string) => ({ ...requestOf(text), kind: "Backup" }),
      (text: string) => ({ ...requestOf(text), spec: { backupName: "weekly" } }),
      (text: string) => {
        const created = requestOf(text);

        return { ...created, metadata: { ...created.metadata, labels: { "velero.io/backup-uid": "another-uid" } } };
      },
      (text: string) => {
        const created = requestOf(text);

        return { ...created, metadata: { ...created.metadata, uid: "" } };
      },
    ]) {
      state.create = async (text) => strange(text) as DiagnosticObject;
      expect(await run(await token())).toEqual({
        ok: false,
        code: "submission-unknown",
        stage: "creation",
        retry: false,
        text: BACKUP_DELETE_WORDS.strange("nightly"),
      });
    }
  });

  it("looks for a request whose answer was lost by the labels of its backup, with the backup, and never sends it again", async () => {
    const { enable, run, token, adapter, state, requestOf } = fixture();

    await enable();
    const lost =
      (made: boolean, at?: () => number) =>
      async (text: string): Promise<DiagnosticObject> => {
        if (made) {
          const created = requestOf(text, "velero", at?.() ?? state.now);

          state.requests.set(created.metadata.name, created);
        }
        throw new DiagnosticError("submission-unknown");
      };
    const runOf = async (made: boolean, steps: ((state: State) => void)[] = [], at?: () => number) => {
      state.backup = backupOf("Completed");
      state.requests.clear();
      state.steps = [...steps];
      state.create = lost(made, at);
      return run(await token());
    };

    // Found, and followed until Velero completed the deletion: the end, said as found.
    expect(await runOf(true, [velero.waits, velero.starts, velero.completes])).toEqual({
      ok: true,
      value: { end: "completed", found: true },
    });
    // Found, and refused.
    expect(await runOf(true, [velero.waits, velero.refuses])).toEqual({
      ok: true,
      value: { end: "refused", request: expect.any(String), phase: "Completed", errors: REFUSAL, found: true },
    });
    // None since the confirmation and the backup there: not done as far as the read shows.
    expect(await runOf(false)).toEqual({
      ok: false,
      code: "submission-unknown",
      stage: "creation",
      retry: false,
      text: BACKUP_DELETE_WORDS.notDone("nightly"),
    });
    // One stamped half a minute before the confirmation, by a clock of the server behind this one, is found.
    expect(await runOf(true, [velero.waits, velero.completes], () => state.now - 30_000)).toEqual({
      ok: true,
      value: { end: "completed", found: true },
    });
    // One made a minute and more before the confirmation is of another deletion.
    expect(await runOf(true, [], () => state.now - 61_000)).toMatchObject({
      ok: false,
      text: BACKUP_DELETE_WORDS.notDone("nightly"),
    });
    // Two requests made since a minute before the confirmation: the newest is followed, the older refused one is not.
    state.backup = backupOf("Completed");
    state.requests.clear();
    const older = requestOf(TEXT, "velero", state.now - 30_000);

    older.status = { phase: "Processed", errors: REFUSAL };
    state.requests.set(older.metadata.name, older);
    state.steps = [velero.waits, velero.completes];
    state.create = lost(true);
    expect(await run(await token())).toEqual({ ok: true, value: { end: "completed", found: true } });
    // None, and the backup gone: a deletion done.
    expect(await runOf(false, [velero.completes])).toEqual({ ok: true, value: { end: "completed", found: true } });
    // The requests that cannot be read, with the backup there: not known.
    state.listError = new DiagnosticError("request-failed");
    expect(await runOf(true)).toMatchObject({ ok: false, text: BACKUP_DELETE_WORDS.unknown("nightly") });
    state.listError = new DiagnosticError("forbidden");
    expect(await runOf(true)).toMatchObject({ ok: false, text: BACKUP_DELETE_WORDS.unknown("nightly") });
    // The requests the identity may not read, and the backup gone: a deletion done, which the backup alone says.
    expect(await runOf(true, [velero.completes])).toEqual({
      ok: true,
      value: { end: "completed", found: true, requestsUnread: true },
    });
    state.listError = undefined;
    // A backup that cannot be read once the answer was lost: not known.
    state.backup = backupOf("Completed");
    state.requests.clear();
    state.create = async (text) => {
      state.backupError = new DiagnosticError("request-failed");
      return lost(true)(text);
    };
    expect(await run(await token())).toMatchObject({ ok: false, text: BACKUP_DELETE_WORDS.unknown("nightly") });
    state.backupError = undefined;
    expect(adapter.createDeleteBackupRequest).toHaveBeenCalledTimes(11);
  });

  it("ends as not known, never as cancelled, a creation dropped on this side once it was sent, and looks for it with reads the write that stopped does not end", async () => {
    const { enable, run, token, state, requestOf, adapter, call } = fixture();

    await enable();
    const request = randomUUID();

    // The write is cancelled once the request left: its own signal ends, and the reads of the look have theirs.
    state.create = async (text) => {
      const created = requestOf(text);

      state.requests.set(created.metadata.name, created);
      await call(CHANNELS.writeCancel, { cluster: "cluster-a", request });
      throw new DiagnosticError("cancelled");
    };
    state.steps = [velero.waits, velero.starts, velero.completes];
    expect(await run(await token(), "nightly", request)).toEqual({
      ok: true,
      value: { end: "completed", found: true },
    });
    expect(adapter.deleteRequestsOf).toHaveBeenCalled();
  });

  it("keeps the end of a run whose request was sent for its cluster, with the backup and what the reads showed", async () => {
    const { enable, run, token, state, ends } = fixture();

    await enable();
    const request = randomUUID();

    state.steps = [velero.starts, velero.fails];
    await run(await token(), "nightly", request);
    const lost = randomUUID();

    state.backup = backupOf("Completed");
    state.requests.clear();
    state.create = async () => {
      throw new DiagnosticError("submission-unknown");
    };
    state.steps = [velero.completes];
    await run(await token(), "nightly", lost);
    const unread = randomUUID();

    state.backup = backupOf("Completed");
    state.requests.clear();
    state.create = undefined;
    state.requestError = new DiagnosticError("forbidden");
    state.steps = [velero.starts];
    await run(await token(), "nightly", unread);
    state.requestError = undefined;
    expect(await ends()).toEqual([
      {
        request,
        kind: "delete-backup",
        namespace: "velero",
        context: "kind-a",
        name: "nightly",
        outcome: { created: true, deletion: "failed" },
        at: expect.any(Number),
      },
      {
        request: lost,
        kind: "delete-backup",
        namespace: "velero",
        context: "kind-a",
        name: "nightly",
        outcome: { created: true, deletion: "completed", found: true },
        at: expect.any(Number),
      },
      {
        request: unread,
        kind: "delete-backup",
        namespace: "velero",
        context: "kind-a",
        name: "nightly",
        outcome: { created: true, deletion: "in-progress", requestsUnread: true },
        at: expect.any(Number),
      },
    ]);
  });
});

describe("what the deletion of a backup checks before and after its creation", () => {
  it("sends nothing when the frame went while the backup was read again, and keeps no end", async () => {
    const { enable, gate, adapter, state } = fixture();

    await enable();
    const confirmed = gate.confirm("frame", "cluster-a", "velero", "delete-backup", BACKUP, undefined, {
      name: "nightly",
      text: TEXT,
    });

    if (!confirmed.ok) throw new Error("not confirmed");
    let present = true;
    const kept: unknown[] = [];

    adapter.read.mockImplementationOnce(async () => {
      present = false;
      return backupOf("Completed");
    });
    expect(
      await runBackupDelete(
        {
          gate,
          now: () => state.now,
          sleep: async (milliseconds) => {
            state.now += milliseconds;
          },
          keep: (_request, end) => kept.push(end),
        },
        "frame",
        {
          cluster: "cluster-a",
          namespace: "velero",
          kind: "delete-backup",
          target: BACKUP,
          typed: "nightly",
          token: confirmed.value.token,
          request: randomUUID(),
        },
        () => () => undefined,
        () => present,
      ),
    ).toEqual({ ok: false, code: "forbidden", stage: "frame", retry: false, text: BACKUP_DELETE_WORDS.frameGone });
    expect(adapter.createDeleteBackupRequest).not.toHaveBeenCalled();
    expect(kept).toEqual([]);
  });

  it("answers no frame that went after the creation, and keeps the end for the cluster", async () => {
    const { enable, state, gate } = fixture();

    await enable();
    const confirmed = gate.confirm("frame", "cluster-a", "velero", "delete-backup", BACKUP, undefined, {
      name: "nightly",
      text: TEXT,
    });

    if (!confirmed.ok) throw new Error("not confirmed");
    let present = true;
    const kept: unknown[] = [];

    state.steps = [
      (inner) => {
        present = false;
        velero.completes(inner);
      },
    ];
    const answer = await runBackupDelete(
      {
        gate,
        now: () => state.now,
        sleep: async (milliseconds) => {
          state.now += milliseconds;
        },
        keep: (_request, end) => kept.push(end),
      },
      "frame",
      {
        cluster: "cluster-a",
        namespace: "velero",
        kind: "delete-backup",
        target: BACKUP,
        typed: "nightly",
        token: confirmed.value.token,
        request: randomUUID(),
      },
      () => () => undefined,
      () => present,
    );

    expect(answer).toEqual({
      ok: false,
      code: "forbidden",
      stage: "frame",
      retry: false,
      text: BACKUP_DELETE_WORDS.frameGoneAfter,
    });
    expect(kept).toEqual([{ ok: true, value: { end: "completed", request: "nightly-xxxx1" } }]);
  });

  it("joins a run sent again with the same identifier while it runs, and sends the request once", async () => {
    const { enable, run, token, adapter, state } = fixture();

    await enable();
    const confirmed = await token();
    const request = randomUUID();

    state.steps = [velero.completes];
    const [first, second] = await Promise.all([run(confirmed, "nightly", request), run(confirmed, "nightly", request)]);

    expect(second).toEqual(first);
    expect(adapter.createDeleteBackupRequest).toHaveBeenCalledOnce();
  });

  it("refuses a token of another frame, an expired one, another namespace and writes turned off after the confirmation", async () => {
    const { enable, call, run, token, adapter, state } = fixture();

    await enable();
    const other: IpcEvent = { ...FRAME_A, frameId: 5 };

    expect(
      await call(
        CHANNELS.writeRun,
        {
          cluster: "cluster-a",
          namespace: "velero",
          kind: "delete-backup",
          target: BACKUP,
          typed: "nightly",
          token: await token(),
          request: randomUUID(),
        },
        other,
      ),
    ).toMatchObject({ ok: false, code: "forbidden" });
    const expiring = await token();

    state.now += 31_000;
    expect(await run(expiring)).toMatchObject({ ok: false, code: "forbidden", stage: "confirmation" });
    expect(
      await call(CHANNELS.writeRun, {
        cluster: "cluster-a",
        namespace: "elsewhere",
        kind: "delete-backup",
        target: BACKUP,
        typed: "nightly",
        token: await token(),
        request: randomUUID(),
      }),
    ).toMatchObject({ ok: false, code: "forbidden" });
    const before = await token();

    await call(CHANNELS.gateDisable, { cluster: "cluster-a" });
    expect(await run(before)).toMatchObject({ ok: false, code: "forbidden" });
    expect(adapter.createDeleteBackupRequest).not.toHaveBeenCalled();
  });
});
