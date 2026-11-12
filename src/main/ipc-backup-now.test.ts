// The procedures of a backup asked from a schedule by hand, as the frames call them (SPEC-0017, ACT-02, ACT-03,
// ACT-05 to ACT-07, NOW-02, NOW-04): the confirmation that reads the schedule and answers the text of the backup, the
// run that sends that text byte for byte only when the schedule still makes it, the reads after the creation, and
// every way it ends, a creation whose answer is not known never sent again.

import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { backupFromSchedule, bodyText, SCHEDULE_NAME_LABEL } from "../common/backup-from-schedule";
import { CHANNELS, readKeptEnds } from "../common/ipc";
import { BACKUP_NOW_WORDS } from "./backup-now";
import { DiagnosticError } from "./diagnostic-transport";
import { registerHandlers } from "./ipc";
import { KeptEnds } from "./kept-ends";
import { WriteGate } from "./write-gate";

import type { CatalogEntry } from "./catalog";
import type { DiagnosticObject } from "./diagnostic-kubernetes";
import type { IpcEvent, Registrar } from "./ipc";

const FRAME_A: IpcEvent = {
  senderFrame: { url: "https://cluster-a.renderer.freelens.app:1234/" },
  processId: 1,
  frameId: 4,
};
const SCHEDULE = { kind: "Schedule" as const, name: "daily", uid: "schedule-uid" };
const NAME = "daily-20261108034105";
const NOW = Date.parse("2026-11-08T03:41:05Z");

function scheduleObject(more: Record<string, unknown> = {}): DiagnosticObject {
  return {
    apiVersion: "velero.io/v1",
    kind: "Schedule",
    metadata: { name: "daily", namespace: "velero", uid: "schedule-uid", labels: { team: "shop" }, ...more },
    spec: { schedule: "0 3 * * *", template: { includedNamespaces: ["shop"], ttl: "720h0m0s" } },
  } as DiagnosticObject;
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
    schedule: scheduleObject(),
    backups: new Map<string, DiagnosticObject>(),
    phases: [] as string[],
    create: undefined as undefined | ((text: string) => Promise<DiagnosticObject>),
    now: NOW,
  };
  const adapter = {
    // The entry the adapter was made for.
    binding: { id: "cluster-a", name: "demo", kubeConfigPath: "/synthetic/a", contextName: "kind-a" },
    assertCurrent: vi.fn(),
    read: vi.fn(async (kind: string, _namespace: string, name: string): Promise<DiagnosticObject> => {
      if (kind === "Schedule") {
        if (!state.schedule) throw new DiagnosticError("not-found");
        return structuredClone(state.schedule);
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

  const release = registerHandlers(registrar, {
    catalog: () => catalog,
    gate,
    pollMs: 5,
    now: () => state.now,
    // Each wait moves the clock of the test by its length, and takes no time.
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
  const of = { cluster: "cluster-a", namespace: "velero", kind: "backup-from-schedule", target: SCHEDULE };
  const confirm = (backup = NAME, target = SCHEDULE) => call(CHANNELS.writeConfirm, { ...of, target, backup });
  const run = (token: string, backup = NAME, request = randomUUID()) =>
    call(CHANNELS.writeRun, { ...of, backup, token, request });

  return { state, adapter, gate, call, enable, confirm, run, release, catalog };
}

describe("the confirmation of a backup asked from a schedule", () => {
  it("is refused with writes off, and reads nothing", async () => {
    const { confirm, adapter } = fixture();
    const refused = await confirm();

    expect([refused.ok, refused.code, refused.stage]).toEqual([false, "forbidden", "gate"]);
    expect(adapter.read).not.toHaveBeenCalled();
  });

  it("reads the schedule and answers the text of the backup the release makes of it, with the token", async () => {
    const { enable, confirm, state } = fixture();

    await enable();
    const confirmed = await confirm();
    const expected = backupFromSchedule(state.schedule, NAME);

    expect(confirmed.ok).toBe(true);
    expect(confirmed.value?.text).toBe(expected && bodyText(expected));
    expect(JSON.parse(String(confirmed.value?.text)).metadata.labels).toEqual({
      team: "shop",
      [SCHEDULE_NAME_LABEL]: "daily",
    });
    expect(typeof confirmed.value?.token).toBe("string");
  });

  it("is a conflict when the schedule of that name is another one, and gives no token", async () => {
    const { enable, confirm, state } = fixture();

    await enable();
    state.schedule = scheduleObject({ uid: "another-uid" });
    const refused = await confirm();

    expect([refused.ok, refused.code, refused.text]).toEqual([false, "conflict", BACKUP_NOW_WORDS.scheduleChanged]);
    expect(refused.value).toBeUndefined();
  });

  it("says a schedule that is not there, and one whose name is longer than a label may be", async () => {
    const { enable, confirm, state } = fixture();

    await enable();
    state.schedule = undefined as never;
    expect(await confirm()).toMatchObject({ ok: false, code: "not-found", text: BACKUP_NOW_WORDS.scheduleGone });
    const long = { ...SCHEDULE, name: "s".repeat(64) };

    expect(await confirm(NAME, long)).toMatchObject({ ok: false, code: "validation", stage: "request" });
  });
});

describe("the run of a backup asked from a schedule", () => {
  it("sends the text the review showed, byte for byte, once, and reads the backup until Velero writes its phase", async () => {
    const { enable, confirm, run, adapter, state } = fixture();

    await enable();
    const confirmed = await confirm();

    state.phases = ["", "New"];
    const created = await run(String(confirmed.value?.token));

    expect(created).toEqual({ ok: true, value: { name: NAME, uid: "backup-uid", phase: "New" } });
    expect(adapter.createBackup).toHaveBeenCalledTimes(1);
    expect(adapter.createBackup.mock.calls[0][1]).toBe(confirmed.value?.text);
    // The reads stop at the phase: the first said none, the second New.
    expect(adapter.read.mock.calls.filter(([kind]) => kind === "Backup")).toHaveLength(2);
  });

  it("says no phase when Velero wrote none within thirty seconds of reads", async () => {
    const { enable, confirm, run, adapter, state } = fixture();

    await enable();
    const confirmed = await confirm();
    const created = await run(String(confirmed.value?.token));

    expect(created).toEqual({ ok: true, value: { name: NAME, uid: "backup-uid" } });
    // A read each second, for thirty seconds: the reads of the schedule aside.
    expect(adapter.read.mock.calls.filter(([kind]) => kind === "Backup")).toHaveLength(30);
    expect(state.now - NOW).toBe(30_000);
  });

  it("sends nothing when the schedule changed since the review, or is another one", async () => {
    const { enable, confirm, run, adapter, state } = fixture();

    await enable();
    let confirmed = await confirm();

    state.schedule = scheduleObject({ labels: { team: "billing" } });
    expect(await run(String(confirmed.value?.token))).toMatchObject({
      ok: false,
      code: "conflict",
      text: BACKUP_NOW_WORDS.reviewChanged,
    });
    confirmed = await confirm();
    state.schedule = scheduleObject({ uid: "another-uid", labels: { team: "billing" } });
    expect(await run(String(confirmed.value?.token))).toMatchObject({
      ok: false,
      code: "conflict",
      text: BACKUP_NOW_WORDS.scheduleChanged,
    });
    expect(adapter.createBackup).not.toHaveBeenCalled();
  });

  it.each([
    [
      "its template",
      { spec: { schedule: "0 3 * * *", template: { includedNamespaces: ["billing"], ttl: "720h0m0s" } } },
    ],
    ["its annotations", { metadata: { ...scheduleObject().metadata, annotations: { owner: "billing" } } }],
  ])("sends nothing when the schedule changed %s since the review", async (_, change) => {
    const { enable, confirm, run, adapter, state } = fixture();

    await enable();
    const confirmed = await confirm();

    state.schedule = { ...scheduleObject(), ...change } as DiagnosticObject;
    expect(await run(String(confirmed.value?.token))).toMatchObject({
      ok: false,
      code: "conflict",
      text: BACKUP_NOW_WORDS.reviewChanged,
    });
    expect(adapter.createBackup).not.toHaveBeenCalled();
  });

  it("sends nothing for a schedule of the same content with another UID: it is another schedule", async () => {
    const { enable, confirm, run, adapter, state } = fixture();

    await enable();
    const confirmed = await confirm();

    state.schedule = scheduleObject({ uid: "another-uid" });
    expect(await run(String(confirmed.value?.token))).toMatchObject({
      ok: false,
      code: "conflict",
      text: BACKUP_NOW_WORDS.scheduleChanged,
    });
    expect(adapter.createBackup).not.toHaveBeenCalled();
  });

  it("runs only for the name it was confirmed for, and once", async () => {
    const { enable, confirm, run, adapter } = fixture();

    await enable();
    const confirmed = await confirm();
    const token = String(confirmed.value?.token);

    expect(await run(token, `${NAME}-2`)).toMatchObject({ ok: false, code: "forbidden", stage: "confirmation" });
    expect((await run(token)).ok).toBe(true);
    expect(await run(token)).toMatchObject({ ok: false, code: "forbidden", stage: "confirmation" });
    expect(adapter.createBackup).toHaveBeenCalledTimes(1);
  });

  it("joins the run of the same request in flight, and creates one backup", async () => {
    const { enable, confirm, call, adapter } = fixture();

    await enable();
    const confirmed = await confirm();
    const request = randomUUID();
    const payload = {
      cluster: "cluster-a",
      namespace: "velero",
      kind: "backup-from-schedule",
      target: SCHEDULE,
      backup: NAME,
      token: confirmed.value?.token,
      request,
    };
    const [one, two] = await Promise.all([call(CHANNELS.writeRun, payload), call(CHANNELS.writeRun, payload)]);

    expect(one).toEqual(two);
    expect(adapter.createBackup).toHaveBeenCalledTimes(1);
  });

  it("ends a backup of that name already there as a conflict, and one the API server refuses as validation", async () => {
    const { enable, confirm, run, state } = fixture();

    await enable();
    state.create = async () => {
      throw new DiagnosticError("conflict");
    };
    expect(await run(String((await confirm()).value?.token))).toMatchObject({
      ok: false,
      code: "conflict",
      text: BACKUP_NOW_WORDS.exists(NAME),
    });
    // A 422 of the API server.
    state.create = async () => {
      throw new DiagnosticError("validation", undefined, "refused");
    };
    expect(await run(String((await confirm()).value?.token))).toMatchObject({
      ok: false,
      code: "validation",
      text: BACKUP_NOW_WORDS.refused,
    });
  });

  it("looks for a backup whose creation was not answered, and never sends it again", async () => {
    const { enable, confirm, run, adapter, state } = fixture();

    await enable();
    // Created, its answer lost: found by its name, of this schedule and since the confirmation.
    state.create = async (text) => {
      const body = JSON.parse(text) as DiagnosticObject;

      state.backups.set(body.metadata.name, {
        ...body,
        metadata: { ...body.metadata, uid: "backup-uid", creationTimestamp: new Date(state.now).toISOString() },
      } as DiagnosticObject);
      throw new DiagnosticError("submission-unknown");
    };
    state.phases = ["New"];
    expect(await run(String((await confirm()).value?.token))).toEqual({
      ok: true,
      value: { name: NAME, uid: "backup-uid", phase: "New", found: true },
    });
    // Not created: not there as far as the reads show.
    state.backups.clear();
    state.create = async () => {
      throw new DiagnosticError("submission-unknown");
    };
    expect(await run(String((await confirm()).value?.token))).toMatchObject({
      ok: false,
      code: "submission-unknown",
      text: BACKUP_NOW_WORDS.notDone(NAME),
    });
    // A backup of that name made before the confirmation, by another hand: not known to be this one.
    state.backups.set(NAME, {
      metadata: {
        name: NAME,
        namespace: "velero",
        uid: "older-uid",
        creationTimestamp: new Date(NOW - 2 * 60_000).toISOString(),
        labels: { [SCHEDULE_NAME_LABEL]: "daily" },
      },
    } as DiagnosticObject);
    expect(await run(String((await confirm()).value?.token))).toMatchObject({
      ok: false,
      code: "submission-unknown",
      text: BACKUP_NOW_WORDS.other(NAME),
    });
    expect(adapter.createBackup).toHaveBeenCalledTimes(3);
  });
});

describe("what a backup asked from a schedule checks before and after its creation", () => {
  const other = (url: string): IpcEvent => ({ senderFrame: { url }, processId: 1, frameId: 9 });

  // A frame of its own, whose address the test changes when the page is left.
  const ownFrame = async (call: ReturnType<typeof fixture>["call"]) => {
    const frame = structuredClone(FRAME_A);

    await call(
      CHANNELS.gateEnable,
      { cluster: "cluster-a", namespace: "velero", confirmation: { context: "kind-a", namespace: "velero" } },
      frame,
    );
    const confirmed = await call(CHANNELS.writeConfirm, { ...ofSchedule(), backup: NAME }, frame);
    const leave = () => {
      // The frame now shows another cluster: it is not the frame of this one any more.
      frame.senderFrame = { url: "https://cluster-b.renderer.freelens.app:1234/" };
    };

    return { frame, token: confirmed.value?.token, leave };
  };

  it("sends nothing when the frame went while the schedule was read again", async () => {
    const { call, adapter, state } = fixture();
    const { frame, token, leave } = await ownFrame(call);
    const read = adapter.read.getMockImplementation() as (...args: unknown[]) => Promise<DiagnosticObject>;

    adapter.read.mockImplementation(async (...args: unknown[]) => {
      // The page of the cluster is left during the read.
      if (args[0] === "Schedule") leave();
      return read(...args);
    });
    const ended = await call(CHANNELS.writeRun, { ...ofSchedule(), backup: NAME, token, request: randomUUID() }, frame);

    expect(ended).toMatchObject({ ok: false, code: "forbidden", stage: "frame", text: BACKUP_NOW_WORDS.frameGone });
    expect(adapter.createBackup).not.toHaveBeenCalled();
    expect(state.backups.size).toBe(0);
  });

  it("answers no frame that went after the creation", async () => {
    const { call, adapter, state } = fixture();
    const { frame, token, leave } = await ownFrame(call);
    const create = adapter.createBackup.getMockImplementation() as (
      namespace: string,
      text: string,
    ) => Promise<DiagnosticObject>;

    adapter.createBackup.mockImplementation(async (namespace: string, text: string) => {
      const created = await create(namespace, text);

      leave();
      return created;
    });
    state.phases = ["New"];
    const ended = await call(CHANNELS.writeRun, { ...ofSchedule(), backup: NAME, token, request: randomUUID() }, frame);

    expect(ended).toMatchObject({
      ok: false,
      code: "forbidden",
      stage: "frame",
      text: BACKUP_NOW_WORDS.frameGoneAfter,
    });
    expect(adapter.createBackup).toHaveBeenCalledTimes(1);
  });

  it("says that a backup the API server answered may be there, when the cluster changed before the answer was taken", async () => {
    const { enable, confirm, run, adapter, state } = fixture();

    await enable();
    state.create = async () => {
      throw new DiagnosticError("target-changed", undefined, "answered");
    };
    expect(await run(String((await confirm()).value?.token))).toMatchObject({
      ok: false,
      code: "submission-unknown",
      stage: "creation",
      text: BACKUP_NOW_WORDS.changedAfter(NAME),
    });
    // A cluster that changed before anything was sent is said as such.
    state.create = async () => {
      throw new DiagnosticError("target-changed");
    };
    expect(await run(String((await confirm()).value?.token))).toMatchObject({
      ok: false,
      code: "target-changed",
      text: BACKUP_NOW_WORDS.changed,
    });
    expect(adapter.read.mock.calls.filter(([kind]) => kind === "Backup")).toHaveLength(0);
  });

  it("confirms no text the answer of the confirmation cannot carry, and gives no token for it", async () => {
    const { enable, confirm, adapter, state } = fixture();

    await enable();
    state.schedule = scheduleObject({ annotations: { note: "x".repeat(70_000) } });
    const refused = await confirm();

    expect(refused).toMatchObject({ ok: false, code: "validation", stage: "review" });
    expect(refused.text).toMatch(
      /^The backup this schedule makes is written in \d+ characters, more than a review carries/,
    );
    expect(refused.value).toBeUndefined();
    expect(adapter.createBackup).not.toHaveBeenCalled();
  });

  it.each([
    ["creation", new DiagnosticError("not-found"), "not-found", false, BACKUP_NOW_WORDS.notServed("velero")],
    ["creation", new DiagnosticError("forbidden"), "forbidden", false, BACKUP_NOW_WORDS.forbiddenCreate("velero")],
    [
      "creation",
      new DiagnosticError("forbidden", undefined, "credential"),
      "request-failed",
      true,
      BACKUP_NOW_WORDS.credential,
    ],
    [
      "creation",
      new DiagnosticError("validation", undefined, "refused"),
      "validation",
      false,
      BACKUP_NOW_WORDS.refused,
    ],
    ["creation", new DiagnosticError("validation"), "validation", false, BACKUP_NOW_WORDS.unsent],
    ["creation", new DiagnosticError("request-failed"), "request-failed", false, BACKUP_NOW_WORDS.declined],
    [
      "creation",
      new DiagnosticError("transport-unreachable"),
      "transport-unreachable",
      true,
      BACKUP_NOW_WORDS.unreachable,
    ],
    ["read", new DiagnosticError("forbidden"), "forbidden", false, BACKUP_NOW_WORDS.forbiddenRead("velero")],
    ["read", new DiagnosticError("not-found"), "not-found", false, BACKUP_NOW_WORDS.scheduleGone],
    ["read", new DiagnosticError("deadline"), "deadline", true, BACKUP_NOW_WORDS.slow],
    ["read", new DiagnosticError("transport-unreachable"), "transport-unreachable", true, BACKUP_NOW_WORDS.unreachable],
    ["read", new DiagnosticError("cancelled"), "cancelled", true, BACKUP_NOW_WORDS.cancelled],
    [
      "read",
      new DiagnosticError("forbidden", undefined, "credential"),
      "request-failed",
      true,
      BACKUP_NOW_WORDS.credential,
    ],
  ])(
    "ends a refusal at the %s as %s with its code, its safety and its words",
    async (stage, error, code, retry, text) => {
      const { enable, confirm, run, adapter, state } = fixture();

      await enable();
      const confirmed = await confirm();

      if (stage === "read") {
        adapter.read.mockImplementationOnce(async () => {
          throw error;
        });
      } else {
        state.create = async () => {
          throw error;
        };
      }
      expect(await run(String(confirmed.value?.token))).toEqual({ ok: false, code, stage, retry, text });
      expect(adapter.read.mock.calls.filter(([kind]) => kind === "Backup")).toHaveLength(0);
    },
  );

  it("takes a backup found by its name for the one created only when it carries every label of the text", async () => {
    const { enable, confirm, run, state } = fixture();
    const lost = (labels: Record<string, string>) => async (text: string) => {
      const body = JSON.parse(text) as DiagnosticObject;

      state.backups.set(body.metadata.name, {
        ...body,
        metadata: { ...body.metadata, labels, uid: "backup-uid", creationTimestamp: new Date(state.now).toISOString() },
      } as DiagnosticObject);
      throw new DiagnosticError("submission-unknown");
    };

    await enable();
    // The label of the schedule alone: another hand made it, with other labels.
    state.create = lost({ [SCHEDULE_NAME_LABEL]: "daily" });
    expect(await run(String((await confirm()).value?.token))).toMatchObject({
      ok: false,
      code: "submission-unknown",
      text: BACKUP_NOW_WORDS.other(NAME),
    });
    // The labels of the text, without the label of the schedule.
    state.backups.clear();
    state.create = lost({ team: "shop" });
    expect(await run(String((await confirm()).value?.token))).toMatchObject({ text: BACKUP_NOW_WORDS.other(NAME) });
    // Every label of the text, and the one of the location Velero adds when it starts it.
    state.backups.clear();
    state.create = lost({ team: "shop", [SCHEDULE_NAME_LABEL]: "daily", "velero.io/storage-location": "default" });
    state.phases = ["InProgress"];
    expect(await run(String((await confirm()).value?.token))).toEqual({
      ok: true,
      value: { name: NAME, uid: "backup-uid", phase: "InProgress", found: true },
    });
  });

  it("looks for a backup whose creation was dropped on this side once it was sent", async () => {
    const { enable, confirm, run, adapter, state } = fixture();

    await enable();
    state.create = async (text) => {
      const body = JSON.parse(text) as DiagnosticObject;

      state.backups.set(body.metadata.name, {
        ...body,
        metadata: { ...body.metadata, uid: "backup-uid", creationTimestamp: new Date(state.now).toISOString() },
      } as DiagnosticObject);
      throw new DiagnosticError("cancelled");
    };
    state.phases = ["New"];
    expect(await run(String((await confirm()).value?.token))).toEqual({
      ok: true,
      value: { name: NAME, uid: "backup-uid", phase: "New", found: true },
    });
    expect(adapter.createBackup).toHaveBeenCalledTimes(1);
  });

  it("sends nothing when writes go off while the schedule is read again", async () => {
    const { enable, confirm, run, adapter, gate } = fixture();

    await enable();
    const confirmed = await confirm();
    const read = adapter.read.getMockImplementation() as (...args: unknown[]) => Promise<DiagnosticObject>;

    adapter.read.mockImplementation(async (...args: unknown[]) => {
      if (args[0] === "Schedule") gate.disable("cluster-a");
      return read(...args);
    });
    expect(await run(String(confirmed.value?.token))).toEqual({
      ok: false,
      code: "cancelled",
      stage: "creation",
      retry: true,
      text: BACKUP_NOW_WORDS.cancelled,
    });
    expect(adapter.createBackup).not.toHaveBeenCalled();
  });

  it("stops reading a backup of that name that is not the one created", async () => {
    const { enable, confirm, run, adapter, state } = fixture();

    await enable();
    const confirmed = await confirm();
    const read = adapter.read.getMockImplementation() as (...args: unknown[]) => Promise<DiagnosticObject>;

    adapter.read.mockImplementation(async (...args: unknown[]) => {
      const object = await read(...args);

      return args[0] === "Backup"
        ? ({ ...object, metadata: { ...object.metadata, uid: "replaced-uid" } } as DiagnosticObject)
        : object;
    });
    state.phases = ["Completed"];
    expect(await run(String(confirmed.value?.token))).toEqual({ ok: true, value: { name: NAME, uid: "backup-uid" } });
    expect(adapter.read.mock.calls.filter(([kind]) => kind === "Backup")).toHaveLength(1);
  });

  it("does not take a creation answered with another name, or with no UID, for the backup", async () => {
    const { enable, confirm, run, state } = fixture();

    await enable();
    state.create = async () => ({ metadata: { name: "another", namespace: "velero", uid: "u" } }) as DiagnosticObject;
    expect(await run(String((await confirm()).value?.token))).toMatchObject({
      ok: false,
      code: "submission-unknown",
      text: BACKUP_NOW_WORDS.unknown(NAME),
    });
    state.create = async () => ({ metadata: { name: NAME, namespace: "velero", uid: "" } }) as DiagnosticObject;
    expect(await run(String((await confirm()).value?.token))).toMatchObject({ code: "submission-unknown" });
  });

  it("gives no other frame, and no other token, the run of a request in flight", async () => {
    const { enable, confirm, call, adapter } = fixture();

    await enable();
    const first = await confirm();
    const second = await confirm();
    const request = randomUUID();
    const payload = (token: unknown) => ({ ...ofSchedule(), backup: NAME, token, request });
    const running = call(CHANNELS.writeRun, payload(first.value?.token));
    const [another, otherFrame] = await Promise.all([
      call(CHANNELS.writeRun, payload(second.value?.token)),
      call(CHANNELS.writeRun, payload(first.value?.token), other("https://cluster-a.renderer.freelens.app:1234/")),
    ]);

    expect((await running).ok).toBe(true);
    expect(another).toMatchObject({
      ok: false,
      code: "forbidden",
      text: "No write of this frame has this identifier.",
    });
    expect(otherFrame).toMatchObject({ ok: false, code: "forbidden" });
    expect(adapter.createBackup).toHaveBeenCalledTimes(1);
  });

  it("refuses a token of another frame, an expired one, another namespace and writes turned off after the confirmation", async () => {
    const { enable, confirm, call, run, adapter, state, gate } = fixture();

    await enable();
    const token = String((await confirm()).value?.token);
    const otherFrame = other("https://cluster-a.renderer.freelens.app:1234/");

    expect(
      await call(CHANNELS.writeRun, { ...ofSchedule(), backup: NAME, token, request: randomUUID() }, otherFrame),
    ).toMatchObject({ ok: false, code: "forbidden" });
    const expired = String((await confirm()).value?.token);

    state.now += 31_000;
    expect(await run(expired)).toMatchObject({ ok: false, code: "forbidden", stage: "confirmation" });
    const elsewhere = String((await confirm()).value?.token);

    expect(
      await call(CHANNELS.writeRun, {
        ...ofSchedule(),
        namespace: "velero-other",
        backup: NAME,
        token: elsewhere,
        request: randomUUID(),
      }),
    ).toMatchObject({ ok: false, code: "forbidden" });
    const off = String((await confirm()).value?.token);

    gate.disable("cluster-a");
    expect(await run(off)).toMatchObject({ ok: false, code: "forbidden", stage: "gate" });
    expect(adapter.createBackup).not.toHaveBeenCalled();
  });
});

function ofSchedule() {
  return { cluster: "cluster-a", namespace: "velero", kind: "backup-from-schedule", target: SCHEDULE };
}

describe("the end of a backup asked from a schedule, kept for its cluster", () => {
  const another: IpcEvent = {
    senderFrame: { url: "https://cluster-a.renderer.freelens.app:1234/" },
    processId: 1,
    frameId: 7,
  };
  const ends = (call: ReturnType<typeof fixture>["call"], event: IpcEvent = another) =>
    call(CHANNELS.writeEnds, { cluster: "cluster-a" }, event);

  it("keeps the end of a backup whose frame went after the creation, for any frame of the cluster, until one shows it", async () => {
    const { call, adapter, state } = fixture();
    const frame = structuredClone(FRAME_A);

    await call(
      CHANNELS.gateEnable,
      { cluster: "cluster-a", namespace: "velero", confirmation: { context: "kind-a", namespace: "velero" } },
      frame,
    );
    const confirmed = await call(CHANNELS.writeConfirm, { ...ofSchedule(), backup: NAME }, frame);
    const create = adapter.createBackup.getMockImplementation() as (
      namespace: string,
      text: string,
    ) => Promise<DiagnosticObject>;

    adapter.createBackup.mockImplementation(async (namespace: string, text: string) => {
      const created = await create(namespace, text);

      frame.senderFrame = { url: "https://cluster-b.renderer.freelens.app:1234/" };
      return created;
    });
    state.phases = ["New"];
    const request = randomUUID();

    expect(
      await call(CHANNELS.writeRun, { ...ofSchedule(), backup: NAME, token: confirmed.value?.token, request }, frame),
    ).toMatchObject({ ok: false, stage: "frame" });
    expect(await ends(call)).toEqual({
      ok: true,
      value: [
        {
          request,
          kind: "backup-from-schedule",
          namespace: "velero",
          context: "kind-a",
          name: NAME,
          schedule: "daily",
          outcome: { created: true, phase: "New" },
          at: state.now,
        },
      ],
    });
    expect(await call(CHANNELS.writeShown, { cluster: "cluster-a", request }, another)).toEqual({
      ok: true,
      value: null,
    });
    expect(await ends(call)).toEqual({ ok: true, value: [] });
  });

  it("keeps the end of a request that was sent until the frame that asked shows it, and none of one that was not sent", async () => {
    const { enable, confirm, call, state } = fixture();

    await enable();
    const request = randomUUID();
    const token = String((await confirm()).value?.token);

    state.create = async () => {
      throw new DiagnosticError("conflict");
    };
    expect(await call(CHANNELS.writeRun, { ...ofSchedule(), backup: NAME, token, request })).toMatchObject({
      code: "conflict",
    });
    expect((await ends(call, FRAME_A)).value).toEqual([
      expect.objectContaining({
        request,
        outcome: { created: false, code: "conflict", text: BACKUP_NOW_WORDS.exists(NAME) },
      }),
    ]);
    await call(CHANNELS.writeShown, { cluster: "cluster-a", request });
    // Refused before it left: by the adapter, a cluster that changed before anything was sent, a schedule that changed.
    for (const refusal of [new DiagnosticError("validation"), new DiagnosticError("target-changed")]) {
      state.create = async () => {
        throw refusal;
      };
      await call(CHANNELS.writeRun, {
        ...ofSchedule(),
        backup: NAME,
        token: String((await confirm()).value?.token),
        request: randomUUID(),
      });
    }
    const changed = String((await confirm()).value?.token);

    state.schedule = scheduleObject({ labels: { team: "billing" } });
    await call(CHANNELS.writeRun, { ...ofSchedule(), backup: NAME, token: changed, request: randomUUID() });
    expect(await ends(call)).toEqual({ ok: true, value: [] });
  });

  it("gives a frame the ends of its own cluster alone, and lets them go with the extension", async () => {
    const { enable, confirm, call, release, state } = fixture();

    await enable();
    state.create = async () => {
      throw new DiagnosticError("forbidden");
    };
    await call(CHANNELS.writeRun, {
      ...ofSchedule(),
      backup: NAME,
      token: String((await confirm()).value?.token),
      request: randomUUID(),
    });
    expect((await ends(call)).value).toHaveLength(1);
    // A frame of another cluster names this one: refused.
    expect(
      await call(
        CHANNELS.writeEnds,
        { cluster: "cluster-a" },
        {
          senderFrame: { url: "https://cluster-b.renderer.freelens.app:1234/" },
          processId: 1,
          frameId: 8,
        },
      ),
    ).toMatchObject({ ok: false, code: "forbidden" });
    release();
    expect(await ends(call)).toEqual({ ok: true, value: [] });
  });
});

describe("what the end kept for a cluster says, and when it is kept", () => {
  const ends = (call: ReturnType<typeof fixture>["call"]) =>
    call(CHANNELS.writeEnds, { cluster: "cluster-a" }) as Promise<{ ok: boolean; value?: Record<string, unknown>[] }>;
  const lost = (state: ReturnType<typeof fixture>["state"]) => async (text: string) => {
    const body = JSON.parse(text) as DiagnosticObject;

    state.backups.set(body.metadata.name, {
      ...body,
      metadata: { ...body.metadata, uid: "backup-uid", creationTimestamp: new Date(state.now).toISOString() },
    } as DiagnosticObject);
    throw new DiagnosticError("submission-unknown");
  };

  it("keeps a backup found after a lost answer, and an answer with another name, each with how it ended", async () => {
    const { enable, confirm, run, call, state } = fixture();

    await enable();
    state.create = lost(state);
    state.phases = ["New"];
    await run(String((await confirm()).value?.token));
    state.backups.clear();
    state.create = async () => ({ metadata: { name: "another", namespace: "velero", uid: "u" } }) as DiagnosticObject;
    await run(String((await confirm()).value?.token));
    expect((await ends(call)).value?.map(({ outcome }) => outcome)).toEqual([
      { created: true, phase: "New", found: true },
      { created: false, code: "submission-unknown", text: BACKUP_NOW_WORDS.unknown(NAME) },
    ]);
  });

  it.each([
    ["a 422 of the API server", new DiagnosticError("validation", undefined, "refused"), 1],
    ["a creation answered while the cluster changed", new DiagnosticError("target-changed", undefined, "answered"), 1],
    ["an error that is not one of the adapter", new Error("thrown"), 1],
    ["a client of the host that could not be had", new DiagnosticError("transport-unreachable"), 0],
  ])("keeps the end of %s when it was sent, and not otherwise", async (_, error, count) => {
    const { enable, confirm, run, call, state } = fixture();

    await enable();
    state.create = async () => {
      throw error;
    };
    await run(String((await confirm()).value?.token));
    expect((await ends(call)).value).toHaveLength(count);
  });

  it("says the context of the entry the request was sent to, not the one the catalog has once it changed", async () => {
    const { enable, confirm, run, call, state, catalog } = fixture();

    await enable();
    state.create = async () => {
      catalog[0] = { ...catalog[0], contextName: "kind-other" };
      throw new DiagnosticError("target-changed", undefined, "answered");
    };
    await run(String((await confirm()).value?.token));
    catalog[0] = { ...catalog[0], contextName: "kind-a" };
    expect((await ends(call)).value?.map(({ context }) => context)).toEqual(["kind-a"]);
  });

  it("carries no phase longer than one, so that the ends of the cluster stay readable", async () => {
    const { enable, confirm, run, call, state } = fixture();

    await enable();
    state.phases = ["P".repeat(65)];
    expect(await run(String((await confirm()).value?.token))).toEqual({
      ok: true,
      value: { name: NAME, uid: "backup-uid" },
    });
    const listed = await ends(call);

    expect(readKeptEnds(listed.value)).toEqual([expect.objectContaining({ outcome: { created: true } })]);
  });

  it("ends a run the same way when what keeps its end raises", async () => {
    const { enable, confirm, run, state } = fixture();
    const keep = vi.spyOn(KeptEnds.prototype, "keep").mockImplementation(() => {
      throw new Error("the store raised");
    });

    try {
      await enable();
      state.phases = ["New"];
      expect(await run(String((await confirm()).value?.token))).toMatchObject({ ok: true, value: { phase: "New" } });
    } finally {
      keep.mockRestore();
    }
  });
});
