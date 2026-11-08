// The procedures of a backup of the form, as the frames call them (SPEC-0017, ACT-02, ACT-03, ACT-05 to ACT-07,
// CRBAK-02, CRBAK-03): the confirmation that refuses a template the release refuses, reads the locations it names and
// answers the text of the backup; the run that reads the locations again and sends that text byte for byte; and every
// way it ends, a creation whose answer is not known never sent again and looked for by its name.

import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { backupFromForm, formBodyText } from "../common/backup-form";
import { TEMPLATE_WORDS } from "../common/backup-template";
import { CHANNELS, readAnswer, readBackupCreated, readKeptEnds } from "../common/ipc";
import { BACKUP_CREATE_WORDS, runBackupCreate } from "./backup-create";
import { BACKUP_NOW_WORDS } from "./backup-now";
import { DiagnosticError } from "./diagnostic-transport";
import { registerHandlers } from "./ipc";
import { WriteGate } from "./write-gate";

import type { BackupTemplate } from "../common/backup-template";
import type { CatalogEntry } from "./catalog";
import type { DiagnosticObject } from "./diagnostic-kubernetes";
import type { IpcEvent, Registrar } from "./ipc";

const FRAME_A: IpcEvent = {
  senderFrame: { url: "https://cluster-a.renderer.freelens.app:1234/" },
  processId: 1,
  frameId: 4,
};
const NAME = "shop-by-hand";
const NOW = Date.parse("2026-11-08T11:00:00Z");
const TEMPLATE: BackupTemplate = {
  includedNamespaces: ["shop"],
  storageLocation: "default",
  volumeSnapshotLocations: ["aws-east"],
  ttl: "48h",
};

function location(kind: string, name: string, provider = "aws"): DiagnosticObject {
  return {
    apiVersion: "velero.io/v1",
    kind,
    metadata: { name, namespace: "velero", uid: `${name}-uid` },
    spec: { provider },
  } as DiagnosticObject;
}

// A read of a snapshot location that answers only when its request is aborted, which ends it as cancelled.
function hangingUntilAborted(read: (...args: unknown[]) => Promise<DiagnosticObject>) {
  return (...args: unknown[]): Promise<DiagnosticObject> => {
    if (args[0] !== "VolumeSnapshotLocation") return read(...args);
    const signal = args[3] as AbortSignal;

    return new Promise((_resolve, reject) => {
      if (signal.aborted) reject(new DiagnosticError("cancelled"));
      signal.addEventListener("abort", () => reject(new DiagnosticError("cancelled")), { once: true });
    });
  };
}

function fixture() {
  const catalog: CatalogEntry[] = [
    { id: "cluster-a", name: "demo", kubeConfigPath: "/synthetic/a", contextName: "kind-a", status: "connected" },
  ];
  const handlers = new Map<string, (event: IpcEvent, payload: unknown) => Promise<unknown>>();
  const registrar: Registrar = {
    handle: (channel, handler) => handlers.set(channel, handler),
    broadcast: () => undefined,
  };
  // What the cluster of the test holds, and what its server writes of a backup at each read.
  const state = {
    locations: new Map<string, DiagnosticObject>([
      ["BackupStorageLocation/default", location("BackupStorageLocation", "default")],
      ["VolumeSnapshotLocation/aws-east", location("VolumeSnapshotLocation", "aws-east")],
      ["VolumeSnapshotLocation/aws-west", location("VolumeSnapshotLocation", "aws-west")],
      ["VolumeSnapshotLocation/gcp", location("VolumeSnapshotLocation", "gcp", "gcp")],
    ]),
    readError: undefined as undefined | DiagnosticError,
    backups: new Map<string, DiagnosticObject>(),
    phases: [] as string[],
    create: undefined as undefined | ((text: string) => Promise<DiagnosticObject>),
    now: NOW,
  };
  const adapter = {
    binding: { id: "cluster-a", name: "demo", kubeConfigPath: "/synthetic/a", contextName: "kind-a" },
    assertCurrent: vi.fn(),
    read: vi.fn(async (kind: string, _namespace: string, name: string): Promise<DiagnosticObject> => {
      if (kind === "BackupStorageLocation" || kind === "VolumeSnapshotLocation") {
        if (state.readError) throw state.readError;
        const found = state.locations.get(`${kind}/${name}`);

        if (!found) throw new DiagnosticError("not-found");
        return structuredClone(found);
      }
      const backup = state.backups.get(name);

      if (!backup) throw new DiagnosticError("not-found");
      const phase = state.phases.shift();

      if (phase) backup.status = { phase };
      return structuredClone(backup);
    }),
    createBackup: vi.fn(async (namespace: string, text: string): Promise<DiagnosticObject> => {
      if (state.create) return state.create(text);
      const body = JSON.parse(text) as DiagnosticObject;
      const created = {
        ...body,
        metadata: {
          ...body.metadata,
          namespace,
          uid: "backup-uid",
          creationTimestamp: new Date(state.now).toISOString(),
        },
      } as DiagnosticObject;

      state.backups.set(body.metadata.name, created);
      return structuredClone(created);
    }),
  };
  const gate = new WriteGate({ catalog: () => catalog, adapter: () => adapter as never, now: () => state.now });

  registerHandlers(registrar, {
    catalog: () => catalog,
    gate,
    pollMs: 5,
    now: () => state.now,
    sleep: async (milliseconds: number) => {
      state.now += milliseconds;
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
    }>;
  };
  const enable = () =>
    call(CHANNELS.gateEnable, {
      cluster: "cluster-a",
      namespace: "velero",
      confirmation: { context: "kind-a", namespace: "velero" },
    });
  const of = { cluster: "cluster-a", namespace: "velero", kind: "backup" };
  const confirm = (template: BackupTemplate = TEMPLATE, backup = NAME) =>
    call(CHANNELS.writeConfirm, { ...of, backup, template });
  const run = (token: string, backup = NAME, request = randomUUID()) =>
    call(CHANNELS.writeRun, { ...of, backup, token, request });
  const locationReads = () =>
    adapter.read.mock.calls.filter(([kind]) => kind === "BackupStorageLocation" || kind === "VolumeSnapshotLocation");

  return { state, adapter, gate, call, enable, confirm, run, locationReads };
}

describe("the words of a template refused", () => {
  it("says each problem as a sentence, in a text the views take", () => {
    expect(BACKUP_CREATE_WORDS.refused(["excludes list cannot contain '*'", "The name is taken."])).toBe(
      "The template is refused, and nothing was sent: excludes list cannot contain '*'. The name is taken.",
    );
    expect(BACKUP_CREATE_WORDS.refused(Array(40).fill("x".repeat(60))).length).toBeLessThanOrEqual(1024);
  });
});

describe("the confirmation of a backup of the form", () => {
  it("is refused with writes off, and reads nothing", async () => {
    const { confirm, adapter } = fixture();

    expect(await confirm()).toMatchObject({ ok: false, code: "forbidden", stage: "gate" });
    expect(adapter.read).not.toHaveBeenCalled();
  });

  it("reads the storage location and each snapshot location named, and answers the text of the backup with the token", async () => {
    const { enable, confirm, locationReads } = fixture();

    await enable();
    const confirmed = await confirm();
    const expected = backupFromForm("velero", NAME, TEMPLATE);

    expect(confirmed.ok).toBe(true);
    expect(confirmed.value?.text).toBe(expected && formBodyText(expected));
    // A Backup with its name and its namespace, no label and no annotation, and the fields that were set.
    expect(JSON.parse(String(confirmed.value?.text))).toEqual({
      apiVersion: "velero.io/v1",
      kind: "Backup",
      metadata: { name: NAME, namespace: "velero" },
      spec: {
        includedNamespaces: ["shop"],
        storageLocation: "default",
        ttl: "48h0m0s",
        volumeSnapshotLocations: ["aws-east"],
      },
    });
    expect(locationReads().map(([kind, , name]) => `${kind}/${name}`)).toEqual([
      "BackupStorageLocation/default",
      "VolumeSnapshotLocation/aws-east",
    ]);
    expect(typeof confirmed.value?.token).toBe("string");
  });

  it("refuses a template the release refuses, with its words, before it reads anything, and gives no token", async () => {
    const { enable, confirm, adapter } = fixture();

    await enable();
    const refused = await confirm({ storageLocation: "default", excludedNamespaces: ["*"] });

    expect(refused).toMatchObject({ ok: false, code: "validation", stage: "request" });
    expect(refused.text).toBe(
      BACKUP_CREATE_WORDS.refused([
        TEMPLATE_WORDS.namespaceLists("excludes list cannot contain '*'"),
        TEMPLATE_WORDS.namespaceLists("excludes list cannot contain an item in the includes list: *"),
      ]),
    );
    expect(refused.value).toBeUndefined();
    expect(adapter.read).not.toHaveBeenCalled();
  });

  it("says a location that is not there, one the identity may not read, and two snapshot locations of one provider", async () => {
    const { enable, confirm, state, adapter } = fixture();

    await enable();
    expect(await confirm({ ...TEMPLATE, storageLocation: "gone" })).toMatchObject({
      ok: false,
      code: "not-found",
      stage: "read",
      text: BACKUP_CREATE_WORDS.locationGone("storage location gone"),
    });
    expect(await confirm({ ...TEMPLATE, volumeSnapshotLocations: ["aws-east", "gone"] })).toMatchObject({
      ok: false,
      code: "not-found",
      text: BACKUP_CREATE_WORDS.locationGone("snapshot location gone"),
    });
    expect(await confirm({ ...TEMPLATE, volumeSnapshotLocations: ["aws-east", "aws-west"] })).toMatchObject({
      ok: false,
      code: "validation",
      stage: "read",
      text: BACKUP_CREATE_WORDS.twoForProvider("aws", "aws-west", "aws-east"),
    });
    // Two locations of two providers are taken.
    expect((await confirm({ ...TEMPLATE, volumeSnapshotLocations: ["aws-east", "gcp"] })).ok).toBe(true);
    state.readError = new DiagnosticError("forbidden");
    expect(await confirm()).toMatchObject({
      ok: false,
      code: "forbidden",
      text: BACKUP_CREATE_WORDS.forbiddenRead("storage location default", "velero"),
    });
    state.readError = new DiagnosticError("deadline");
    expect(await confirm()).toMatchObject({ ok: false, code: "deadline", text: BACKUP_CREATE_WORDS.slow });
    expect(adapter.createBackup).not.toHaveBeenCalled();
  });

  it("stops reading the locations when the frame that asked goes, and gives no token", async () => {
    const { adapter, call } = fixture();
    const frame: IpcEvent = { ...FRAME_A, senderFrame: { url: FRAME_A.senderFrame?.url ?? "" } };

    await call(
      CHANNELS.gateEnable,
      { cluster: "cluster-a", namespace: "velero", confirmation: { context: "kind-a", namespace: "velero" } },
      frame,
    );
    const read = adapter.read.getMockImplementation() as (...args: unknown[]) => Promise<DiagnosticObject>;
    const hanging = hangingUntilAborted(read);

    adapter.read.mockImplementation((...args: unknown[]) => {
      // The page of the cluster is left while the snapshot location is read.
      if (args[0] === "VolumeSnapshotLocation")
        frame.senderFrame = { url: "https://cluster-b.renderer.freelens.app:1234/" };
      return hanging(...args);
    });
    const refused = await call(
      CHANNELS.writeConfirm,
      { cluster: "cluster-a", namespace: "velero", kind: "backup", backup: NAME, template: TEMPLATE },
      frame,
    );

    expect(refused).toMatchObject({ ok: false, code: "cancelled", stage: "read", text: BACKUP_CREATE_WORDS.cancelled });
    expect(refused.value).toBeUndefined();
  });

  it("confirms no text the answer of the confirmation cannot carry, and gives no token for it", async () => {
    const { enable, confirm, adapter } = fixture();

    await enable();
    // Within the bounds of the contract and of a request, and written longer than the answer carries: the indentation
    // of the text is longer than the commas of the request.
    const resources = (prefix: string) => Array.from({ length: 256 }, (_, at) => `${prefix}${at}`.padEnd(114, "x"));
    const refused = await confirm({
      storageLocation: "default",
      includedResources: resources("i"),
      excludedResources: resources("e"),
    });

    expect(refused).toMatchObject({ ok: false, code: "validation", stage: "review" });
    expect(refused.text).toMatch(
      /^The backup of this template is written in \d+ characters, more than a review carries/,
    );
    expect(refused.value).toBeUndefined();
    expect(adapter.createBackup).not.toHaveBeenCalled();
  });

  it("is refused by the contract without a template or with a field it does not know", async () => {
    const { enable, call } = fixture();

    await enable();
    const of = { cluster: "cluster-a", namespace: "velero", kind: "backup", backup: NAME };

    for (const payload of [
      of,
      { ...of, template: { ...TEMPLATE, hooks: {} } },
      { ...of, template: { ...TEMPLATE, ttl: 48 } },
      { ...of, template: TEMPLATE, target: { kind: "Schedule", name: "daily", uid: "u" } },
      { ...of, backup: "Not-A-Name", template: TEMPLATE },
    ]) {
      expect(await call(CHANNELS.writeConfirm, payload)).toMatchObject({ ok: false, code: "validation" });
    }
  });
});

describe("the run of a backup of the form", () => {
  it("reads the locations again, sends the text the review showed, byte for byte, once, and reads the backup until Velero writes its phase", async () => {
    const { enable, confirm, run, adapter, state, locationReads } = fixture();

    await enable();
    const confirmed = await confirm();

    state.phases = ["", "Queued"];
    expect(await run(String(confirmed.value?.token))).toEqual({
      ok: true,
      value: { name: NAME, uid: "backup-uid", phase: "Queued" },
    });
    expect(adapter.createBackup).toHaveBeenCalledTimes(1);
    expect(adapter.createBackup.mock.calls[0][1]).toBe(confirmed.value?.text);
    // Twice each location, at the confirmation and at the run.
    expect(locationReads()).toHaveLength(4);
  });

  it("answers where the backup is in the queue, and each error of a validation, as Velero wrote them", async () => {
    const { enable, confirm, run, state } = fixture();

    await enable();
    state.create = async (text) => {
      const body = JSON.parse(text) as DiagnosticObject;
      const created = {
        ...body,
        metadata: { ...body.metadata, uid: "backup-uid", creationTimestamp: new Date(state.now).toISOString() },
        status: { phase: "Queued", queuePosition: 3 },
      } as DiagnosticObject;

      state.backups.set(body.metadata.name, created);
      return structuredClone(created);
    };
    expect(await run(String((await confirm()).value?.token))).toEqual({
      ok: true,
      value: { name: NAME, uid: "backup-uid", phase: "Queued", position: 3 },
    });
    state.backups.clear();
    const errors = ["Invalid included/excluded namespace lists: excludes list cannot contain '*'"];

    state.create = async (text) => {
      const body = JSON.parse(text) as DiagnosticObject;
      const created = {
        ...body,
        metadata: { ...body.metadata, uid: "backup-uid", creationTimestamp: new Date(state.now).toISOString() },
        status: { phase: "FailedValidation", validationErrors: errors },
      } as DiagnosticObject;

      state.backups.set(body.metadata.name, created);
      return structuredClone(created);
    };
    expect(await run(String((await confirm()).value?.token))).toEqual({
      ok: true,
      value: { name: NAME, uid: "backup-uid", phase: "FailedValidation", errors },
    });
    // Errors beyond what the contract carries are read in the view of the backup.
    state.backups.clear();
    state.create = async (text) => {
      const body = JSON.parse(text) as DiagnosticObject;
      const created = {
        ...body,
        metadata: { ...body.metadata, uid: "backup-uid", creationTimestamp: new Date(state.now).toISOString() },
        status: { phase: "FailedValidation", validationErrors: ["e".repeat(4097)] },
      } as DiagnosticObject;

      state.backups.set(body.metadata.name, created);
      return structuredClone(created);
    };
    expect(await run(String((await confirm()).value?.token))).toEqual({
      ok: true,
      value: { name: NAME, uid: "backup-uid", phase: "FailedValidation", errorsLeft: 1 },
    });
    // The errors are carried in order until one does not fit the total the answer leaves them, and the others are
    // counted: sixteen of 4,096 characters would make an answer the views refuse.
    state.backups.clear();
    const long = Array.from({ length: 16 }, (_, at) => `${at}`.padEnd(4096, "e"));

    state.create = async (text) => {
      const body = JSON.parse(text) as DiagnosticObject;
      const created = {
        ...body,
        metadata: { ...body.metadata, uid: "backup-uid", creationTimestamp: new Date(state.now).toISOString() },
        status: { phase: "FailedValidation", validationErrors: long },
      } as DiagnosticObject;

      state.backups.set(body.metadata.name, created);
      return structuredClone(created);
    };
    const answered = await run(String((await confirm()).value?.token));

    expect(answered).toEqual({
      ok: true,
      value: { name: NAME, uid: "backup-uid", phase: "FailedValidation", errors: long.slice(0, 8), errorsLeft: 8 },
    });
    expect(readAnswer(answered, readBackupCreated)).toEqual(answered);
  });

  it("stops reading the locations again when writes go off, and sends nothing", async () => {
    const { enable, confirm, run, adapter, gate } = fixture();

    await enable();
    const confirmed = await confirm();
    const read = adapter.read.getMockImplementation() as (...args: unknown[]) => Promise<DiagnosticObject>;
    const hanging = hangingUntilAborted(read);

    adapter.read.mockImplementation((...args: unknown[]) => {
      if (args[0] === "VolumeSnapshotLocation") gate.disable("cluster-a");
      return hanging(...args);
    });
    expect(await run(String(confirmed.value?.token))).toMatchObject({
      ok: false,
      code: "cancelled",
      stage: "read",
      text: BACKUP_CREATE_WORDS.cancelled,
    });
    expect(adapter.createBackup).not.toHaveBeenCalled();
  });

  it("takes a backup found by its name for the one created only when it carries the fields Velero keeps as they were sent", async () => {
    const { enable, confirm, run, state } = fixture();

    await enable();
    // Another hand made a backup of that name since the confirmation, to another location; ours never landed.
    state.create = async () => {
      state.backups.set(NAME, {
        apiVersion: "velero.io/v1",
        kind: "Backup",
        metadata: {
          name: NAME,
          namespace: "velero",
          uid: "foreign-uid",
          creationTimestamp: new Date(state.now).toISOString(),
        },
        spec: { includedNamespaces: ["shop"], storageLocation: "elsewhere", ttl: "48h0m0s" },
      } as DiagnosticObject);
      throw new DiagnosticError("submission-unknown");
    };
    expect(await run(String((await confirm()).value?.token))).toMatchObject({
      ok: false,
      code: "submission-unknown",
      text: BACKUP_NOW_WORDS.other(NAME),
    });
    // One with the fields of the text, the lists Velero adds to aside, is the one created.
    state.backups.clear();
    state.create = async () => {
      state.backups.set(NAME, {
        apiVersion: "velero.io/v1",
        kind: "Backup",
        metadata: {
          name: NAME,
          namespace: "velero",
          uid: "backup-uid",
          creationTimestamp: new Date(state.now).toISOString(),
        },
        spec: {
          includedNamespaces: ["shop"],
          storageLocation: "default",
          ttl: "48h0m0s",
          volumeSnapshotLocations: ["aws-east", "gcp"],
          excludedNamespaces: ["labelled"],
          csiSnapshotTimeout: "10m0s",
        },
      } as DiagnosticObject);
      throw new DiagnosticError("submission-unknown");
    };
    expect(await run(String((await confirm()).value?.token))).toEqual({
      ok: true,
      value: { name: NAME, uid: "backup-uid", found: true },
    });
  });

  it("sends nothing when a location went since the review", async () => {
    const { enable, confirm, run, adapter, state } = fixture();

    await enable();
    const confirmed = await confirm();

    state.locations.delete("VolumeSnapshotLocation/aws-east");
    expect(await run(String(confirmed.value?.token))).toMatchObject({
      ok: false,
      code: "not-found",
      text: BACKUP_CREATE_WORDS.locationGone("snapshot location aws-east"),
    });
    expect(adapter.createBackup).not.toHaveBeenCalled();
  });

  it("runs only for the name it was confirmed for, and a token of a backup of a schedule does not run it", async () => {
    const { enable, confirm, run, call, adapter } = fixture();

    await enable();
    const confirmed = await confirm();

    expect(await run(String(confirmed.value?.token), "another-name")).toMatchObject({
      ok: false,
      code: "forbidden",
      stage: "confirmation",
    });
    expect(
      await call(CHANNELS.writeRun, {
        cluster: "cluster-a",
        namespace: "velero",
        kind: "backup-from-schedule",
        target: { kind: "Schedule", name: "daily", uid: "schedule-uid" },
        backup: NAME,
        token: String(confirmed.value?.token),
        request: randomUUID(),
      }),
    ).toMatchObject({ ok: false, code: "forbidden", stage: "confirmation" });
    // The run carries none of the template.
    expect(
      await call(CHANNELS.writeRun, {
        cluster: "cluster-a",
        namespace: "velero",
        kind: "backup",
        backup: NAME,
        template: TEMPLATE,
        token: String(confirmed.value?.token),
        request: randomUUID(),
      }),
    ).toMatchObject({ ok: false, code: "validation" });
    expect(adapter.createBackup).not.toHaveBeenCalled();
  });

  it("sends nothing when the text kept with the token is not the backup of the run", async () => {
    const { adapter } = fixture();
    const write = {
      sender: "frame",
      kind: "backup" as const,
      status: { step: "confirmed" },
      controller: new AbortController(),
      done: false,
    };
    const kept = (name: string, namespace = "velero") =>
      formBodyText(backupFromForm(namespace, name, TEMPLATE) as NonNullable<ReturnType<typeof backupFromForm>>);
    const dependencies = (text: string) => ({
      gate: {
        take: () => ({ ok: true as const, value: { adapter, write, text, confirmedAt: NOW } }),
        finish: vi.fn(),
      } as never,
      now: () => NOW,
      sleep: async () => undefined,
    });
    const request = {
      cluster: "cluster-a",
      namespace: "velero",
      kind: "backup" as const,
      backup: NAME,
      token: randomUUID(),
      request: randomUUID(),
    };

    for (const text of [kept("another-name"), kept(NAME, "elsewhere"), "{"]) {
      expect(await runBackupCreate(dependencies(text), "frame", request, () => () => undefined)).toMatchObject({
        ok: false,
        code: "conflict",
        text: BACKUP_CREATE_WORDS.reviewChanged,
      });
    }
    expect(adapter.createBackup).not.toHaveBeenCalled();
  });

  it("is a conflict when the name is taken, with the words of a backup that has it", async () => {
    const { enable, confirm, run, state } = fixture();

    await enable();
    state.create = async () => {
      throw new DiagnosticError("conflict");
    };
    expect(await run(String((await confirm()).value?.token))).toMatchObject({
      ok: false,
      code: "conflict",
      stage: "creation",
      text: BACKUP_NOW_WORDS.exists(NAME),
    });
  });

  it("looks for a backup whose answer was lost by its name and its creation time, and never sends it again", async () => {
    const { enable, confirm, run, adapter, state } = fixture();

    await enable();
    // Created, and the answer lost: found by its name, with no label to carry, made since the confirmation.
    state.create = async (text) => {
      const body = JSON.parse(text) as DiagnosticObject;

      state.backups.set(NAME, {
        ...body,
        metadata: { ...body.metadata, uid: "backup-uid", creationTimestamp: new Date(state.now).toISOString() },
      } as DiagnosticObject);
      throw new DiagnosticError("submission-unknown");
    };
    expect(await run(String((await confirm()).value?.token))).toEqual({
      ok: true,
      value: { name: NAME, uid: "backup-uid", found: true },
    });
    // Not there as far as the reads show.
    state.backups.clear();
    state.create = async () => {
      throw new DiagnosticError("submission-unknown");
    };
    expect(await run(String((await confirm()).value?.token))).toMatchObject({
      ok: false,
      code: "submission-unknown",
      text: BACKUP_NOW_WORDS.notDone(NAME),
    });
    // One of that name made before the confirmation: not known to be this one.
    state.backups.set(NAME, {
      metadata: {
        name: NAME,
        namespace: "velero",
        uid: "older-uid",
        creationTimestamp: new Date(state.now - 2 * 60_000).toISOString(),
      },
    } as DiagnosticObject);
    expect(await run(String((await confirm()).value?.token))).toMatchObject({
      ok: false,
      code: "submission-unknown",
      text: BACKUP_NOW_WORDS.other(NAME),
    });
    // Three runs, one creation each: none sent again.
    expect(adapter.createBackup).toHaveBeenCalledTimes(3);
  });

  it("keeps the end of a run whose request was sent for its cluster, with its name and no schedule", async () => {
    const { enable, confirm, run, call } = fixture();

    await enable();
    const request = randomUUID();

    await run(String((await confirm()).value?.token), NAME, request);
    const ends = await call(CHANNELS.writeEnds, { cluster: "cluster-a" });
    const read = readKeptEnds(ends.value);

    expect(read).toEqual([
      {
        request,
        kind: "backup",
        namespace: "velero",
        context: "kind-a",
        name: NAME,
        outcome: { created: true },
        at: expect.any(Number),
      },
    ]);
  });
});
