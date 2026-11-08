// The procedures of a backup asked from a schedule by hand, as the frames call them (SPEC-0017, ACT-02, ACT-03,
// ACT-05 to ACT-07, NOW-02, NOW-04): the confirmation that reads the schedule and answers the text of the backup, the
// run that sends that text byte for byte only when the schedule still makes it, the reads after the creation, and
// every way it ends, a creation whose answer is not known never sent again.

import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { backupFromSchedule, bodyText, SCHEDULE_NAME_LABEL } from "../common/backup-from-schedule";
import { CHANNELS } from "../common/ipc";
import { BACKUP_NOW_WORDS } from "./backup-now";
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

  registerHandlers(registrar, {
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

  return { state, adapter, gate, call, enable, confirm, run };
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
    state.create = async () => {
      throw new DiagnosticError("validation");
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
      value: { name: NAME, uid: "backup-uid", phase: "New" },
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
