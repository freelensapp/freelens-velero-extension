// The procedures of a schedule of the form, as the frames call them (SPEC-0016, CRSCH-02 to CRSCH-09, CRSCH-18,
// CRSCH-19, CRSCH-23): the confirmation that refuses a name, an expression or a template the main process refuses,
// reads the locations the template names and answers the text of the Schedule; the run that reads the locations again
// and sends that text byte for byte, then reads what Velero wrote of it; and every way it ends, a creation whose answer
// is not known never sent again and looked for by its name.

import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { TEMPLATE_WORDS } from "../common/backup-template";
import { CHANNELS, readKeptEnds } from "../common/ipc";
import { SCHEDULE_FORM_WORDS, scheduleBodyText, scheduleFromForm } from "../common/schedule-form";
import { BACKUP_CREATE_WORDS } from "./backup-create";
import { DiagnosticError } from "./diagnostic-transport";
import { registerHandlers } from "./ipc";
import { runScheduleCreate, SCHEDULE_CREATE_WORDS } from "./schedule-create";
import { WriteGate } from "./write-gate";

import type { BackupTemplate } from "../common/backup-template";
import type { ScheduleWrapper } from "../common/schedule-form";
import type { CatalogEntry } from "./catalog";
import type { DiagnosticObject } from "./diagnostic-kubernetes";
import type { IpcEvent, Registrar } from "./ipc";

const FRAME_A: IpcEvent = {
  senderFrame: { url: "https://cluster-a.renderer.freelens.app:1234/" },
  processId: 1,
  frameId: 4,
};
const NAME = "nightly-shop";
const NOW = Date.parse("2026-11-08T12:00:00Z");
const WRAPPER: ScheduleWrapper = {
  expression: "CRON_TZ=Europe/Rome 0 3 * * *",
  paused: false,
  skipImmediately: false,
  useOwnerReferencesInBackup: false,
};
const TEMPLATE: BackupTemplate = {
  includedNamespaces: ["shop"],
  storageLocation: "default",
  volumeSnapshotLocations: ["aws-east"],
};

function location(kind: string, name: string, provider = "aws"): DiagnosticObject {
  return {
    apiVersion: "velero.io/v1",
    kind,
    metadata: { name, namespace: "velero", uid: `${name}-uid` },
    spec: { provider },
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
  // What the cluster of the test holds, and what its controller writes of a schedule at each read.
  const state = {
    locations: new Map<string, DiagnosticObject>([
      ["BackupStorageLocation/default", location("BackupStorageLocation", "default")],
      ["VolumeSnapshotLocation/aws-east", location("VolumeSnapshotLocation", "aws-east")],
      ["VolumeSnapshotLocation/aws-west", location("VolumeSnapshotLocation", "aws-west")],
    ]),
    schedules: new Map<string, DiagnosticObject>(),
    // The status the controller writes at each read of the schedule, in turn; none when the list is empty.
    statuses: [] as Record<string, unknown>[],
    readError: undefined as undefined | DiagnosticError,
    create: undefined as undefined | ((text: string) => Promise<DiagnosticObject>),
    now: NOW,
  };
  const adapter = {
    binding: { id: "cluster-a", name: "demo", kubeConfigPath: "/synthetic/a", contextName: "kind-a" },
    assertCurrent: vi.fn(),
    read: vi.fn(
      async (kind: string, _namespace: string, name: string, signal?: AbortSignal): Promise<DiagnosticObject> => {
        // As the adapter does, a read with a signal that ended does not leave.
        if (signal?.aborted) throw new DiagnosticError("cancelled");
        if (kind === "BackupStorageLocation" || kind === "VolumeSnapshotLocation") {
          const found = state.locations.get(`${kind}/${name}`);

          if (!found) throw new DiagnosticError("not-found");
          return structuredClone(found);
        }
        if (state.readError) throw state.readError;
        const schedule = state.schedules.get(name);

        if (!schedule) throw new DiagnosticError("not-found");
        const status = state.statuses.shift();

        if (status) schedule.status = status;
        return structuredClone(schedule);
      },
    ),
    createSchedule: vi.fn(async (namespace: string, text: string): Promise<DiagnosticObject> => {
      if (state.create) return state.create(text);
      const body = JSON.parse(text) as DiagnosticObject;
      const created = {
        ...body,
        metadata: {
          ...body.metadata,
          namespace,
          uid: "schedule-uid",
          creationTimestamp: new Date(state.now).toISOString(),
        },
      } as DiagnosticObject;

      state.schedules.set(body.metadata.name, created);
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
  const of = { cluster: "cluster-a", namespace: "velero", kind: "schedule" };
  const confirm = (wrapper: ScheduleWrapper = WRAPPER, template: BackupTemplate = TEMPLATE, schedule = NAME) =>
    call(CHANNELS.writeConfirm, { ...of, schedule, wrapper, template });
  const run = (token: string, schedule = NAME, request = randomUUID()) =>
    call(CHANNELS.writeRun, { ...of, schedule, token, request });
  const locationReads = () =>
    adapter.read.mock.calls.filter(([kind]) => kind === "BackupStorageLocation" || kind === "VolumeSnapshotLocation");
  const scheduleReads = () => adapter.read.mock.calls.filter(([kind]) => kind === "Schedule");
  // The schedule the controller wrote, with a phase, created when the fixture says.
  const created = (text: string, more: { uid?: string; at?: number; status?: Record<string, unknown> } = {}) => {
    const body = JSON.parse(text) as DiagnosticObject;

    return {
      ...body,
      metadata: {
        ...body.metadata,
        uid: more.uid ?? "schedule-uid",
        creationTimestamp: new Date(more.at ?? state.now).toISOString(),
      },
      ...(more.status ? { status: more.status } : {}),
    } as DiagnosticObject;
  };

  return { state, adapter, gate, call, enable, confirm, run, locationReads, scheduleReads, created };
}

function textOf(wrapper: ScheduleWrapper = WRAPPER, template: BackupTemplate = TEMPLATE, name = NAME): string {
  const body = scheduleFromForm("velero", name, wrapper, template, NOW);

  if (!body) throw new Error("The form of the test is refused");
  return scheduleBodyText(body);
}

describe("the words of a template of a schedule refused", () => {
  it("says each problem as a sentence, in a text the views take", () => {
    expect(SCHEDULE_CREATE_WORDS.refused(["excludes list cannot contain '*'", "The name is taken."])).toBe(
      "The template is refused, and nothing was sent: excludes list cannot contain '*'. The name is taken.",
    );
    expect(SCHEDULE_CREATE_WORDS.refused(Array(40).fill("x".repeat(60))).length).toBeLessThanOrEqual(1024);
  });
});

describe("the confirmation of a schedule of the form", () => {
  it("is refused with writes off, and reads nothing", async () => {
    const { confirm, adapter } = fixture();

    expect(await confirm()).toMatchObject({ ok: false, code: "forbidden", stage: "gate" });
    expect(adapter.read).not.toHaveBeenCalled();
  });

  it("reads the storage location and each snapshot location named, and answers the text of the Schedule with the token", async () => {
    const { enable, confirm, locationReads } = fixture();

    await enable();
    const confirmed = await confirm();

    expect(confirmed.ok).toBe(true);
    expect(confirmed.value?.text).toBe(textOf());
    // A Schedule with its name and its namespace, no label and no annotation, the three flags written, and the
    // template of the fields that were set.
    expect(JSON.parse(String(confirmed.value?.text))).toEqual({
      apiVersion: "velero.io/v1",
      kind: "Schedule",
      metadata: { name: NAME, namespace: "velero" },
      spec: {
        schedule: "CRON_TZ=Europe/Rome 0 3 * * *",
        paused: false,
        skipImmediately: false,
        useOwnerReferencesInBackup: false,
        template: { includedNamespaces: ["shop"], storageLocation: "default", volumeSnapshotLocations: ["aws-east"] },
      },
    });
    expect(locationReads().map(([kind, , name]) => `${kind}/${name}`)).toEqual([
      "BackupStorageLocation/default",
      "VolumeSnapshotLocation/aws-east",
    ]);
    expect(typeof confirmed.value?.token).toBe("string");
  });

  it("refuses a name, an expression or a template the main process refuses, with its words, before it reads anything", async () => {
    const { enable, confirm, call, adapter } = fixture();

    await enable();
    expect(await confirm({ ...WRAPPER, expression: "" })).toMatchObject({
      ok: false,
      code: "validation",
      stage: "request",
      text: SCHEDULE_CREATE_WORDS.expression(SCHEDULE_FORM_WORDS.expressionEmpty),
    });
    expect(await confirm({ ...WRAPPER, expression: "0 3 * *\t*" })).toMatchObject({
      text: SCHEDULE_CREATE_WORDS.expression(SCHEDULE_FORM_WORDS.expressionNotPrintable),
    });
    expect(await confirm({ ...WRAPPER, expression: `0 3 * * * ${"x".repeat(1024)}` })).toMatchObject({
      text: SCHEDULE_CREATE_WORDS.expression(SCHEDULE_FORM_WORDS.expressionLong(1034)),
    });
    for (const expression of ["@triggered", "@manual", "@none", "0 0 30 2 *"])
      expect(await confirm({ ...WRAPPER, expression })).toMatchObject({
        text: SCHEDULE_CREATE_WORDS.expression(SCHEDULE_FORM_WORDS.noInstant),
      });
    expect(await confirm(WRAPPER, { storageLocation: "default", excludedNamespaces: ["*"] })).toMatchObject({
      ok: false,
      code: "validation",
      text: SCHEDULE_CREATE_WORDS.refused([
        TEMPLATE_WORDS.namespaceLists("excludes list cannot contain '*'"),
        TEMPLATE_WORDS.namespaceLists("excludes list cannot contain an item in the includes list: *"),
      ]),
    });
    expect(await confirm(WRAPPER, {})).toMatchObject({
      text: SCHEDULE_CREATE_WORDS.refused([TEMPLATE_WORDS.noStorageLocation]),
    });
    // A name of 64 characters is refused by the contract, before the procedure.
    expect(await confirm(WRAPPER, TEMPLATE, "a".repeat(64))).toMatchObject({ ok: false, code: "validation" });
    expect(
      await call(CHANNELS.writeConfirm, {
        cluster: "cluster-a",
        namespace: "velero",
        kind: "schedule",
        schedule: "a".repeat(63),
        wrapper: WRAPPER,
        template: TEMPLATE,
      }),
    ).toMatchObject({ ok: true });
    expect(adapter.read.mock.calls.filter(([kind]) => kind === "BackupStorageLocation")).toHaveLength(1);
  });

  it("counts the instants of an expression from the clock of the main process, and its bytes as the parser counts them", async () => {
    const { enable, confirm, state } = fixture();

    await enable();
    // A February 29 that is a Sunday: 2032 is within five years of 2028, and not of 2026.
    expect(await confirm({ ...WRAPPER, expression: "* * 29 2 0" })).toMatchObject({
      ok: false,
      text: SCHEDULE_CREATE_WORDS.expression(SCHEDULE_FORM_WORDS.noInstant),
    });
    // A zone the runtime does not know does not make an expression with no instant one with an instant.
    expect(await confirm({ ...WRAPPER, expression: "CRON_TZ=Mars/Olympus_Mons 0 0 30 2 *" })).toMatchObject({
      ok: false,
      text: SCHEDULE_CREATE_WORDS.expression(SCHEDULE_FORM_WORDS.noInstant),
    });
    const of = (bytes: number) => `0 3 * * *${" ".repeat(bytes - 9)}`;

    expect((await confirm({ ...WRAPPER, expression: of(1024) })).ok).toBe(true);
    expect(await confirm({ ...WRAPPER, expression: of(1025) })).toMatchObject({
      ok: false,
      text: SCHEDULE_CREATE_WORDS.expression(SCHEDULE_FORM_WORDS.expressionLong(1025)),
    });
    state.now = Date.parse("2028-03-01T00:00:00Z");
    expect((await confirm({ ...WRAPPER, expression: "* * 29 2 0" })).ok).toBe(true);
  });

  it("leaves to Velero an expression its parser refuses, which the form refuses as it is typed (D11)", async () => {
    const { enable, confirm } = fixture();

    await enable();
    const confirmed = await confirm({ ...WRAPPER, expression: "61 * * * *" });

    expect(confirmed.ok).toBe(true);
    expect(JSON.parse(String(confirmed.value?.text)).spec.schedule).toBe("61 * * * *");
  });

  it("says a location that is not there, naming it, and two snapshot locations of one provider, before anything is created", async () => {
    const { enable, confirm, adapter } = fixture();

    await enable();
    expect(await confirm(WRAPPER, { ...TEMPLATE, storageLocation: "gone" })).toMatchObject({
      ok: false,
      code: "not-found",
      stage: "read",
      text: BACKUP_CREATE_WORDS.locationGone("storage location gone"),
    });
    expect(await confirm(WRAPPER, { ...TEMPLATE, volumeSnapshotLocations: ["aws-east", "gone"] })).toMatchObject({
      code: "not-found",
      text: BACKUP_CREATE_WORDS.locationGone("snapshot location gone"),
    });
    expect(await confirm(WRAPPER, { ...TEMPLATE, volumeSnapshotLocations: ["aws-east", "aws-west"] })).toMatchObject({
      code: "validation",
      text: BACKUP_CREATE_WORDS.twoForProvider("aws", "aws-west", "aws-east"),
    });
    expect(adapter.createSchedule).not.toHaveBeenCalled();
  });

  it("is refused with writes on for another namespace, and confirms no text the answer of the confirmation cannot carry", async () => {
    const { call, confirm, adapter } = fixture();

    await call(CHANNELS.gateEnable, {
      cluster: "cluster-a",
      namespace: "other",
      confirmation: { context: "kind-a", namespace: "other" },
    });
    expect(await confirm()).toMatchObject({ ok: false, code: "forbidden", stage: "gate" });
    await call(CHANNELS.gateEnable, {
      cluster: "cluster-a",
      namespace: "velero",
      confirmation: { context: "kind-a", namespace: "velero" },
    });
    const resources = (prefix: string) => Array.from({ length: 256 }, (_, at) => `${prefix}${at}`.padEnd(114, "x"));
    const refused = await confirm(WRAPPER, {
      storageLocation: "default",
      includedResources: resources("i"),
      excludedResources: resources("e"),
    });

    expect(refused).toMatchObject({ ok: false, code: "validation", stage: "review" });
    expect(refused.text).toMatch(/^The schedule of this form is written in \d+ characters, more than a review carries/);
    expect(refused.value).toBeUndefined();
    expect(adapter.createSchedule).not.toHaveBeenCalled();
  });

  it("is refused by the contract without its wrapper or its template, with a field it does not know, or with a target", async () => {
    const { enable, call } = fixture();

    await enable();
    const of = { cluster: "cluster-a", namespace: "velero", kind: "schedule", schedule: NAME };

    for (const payload of [
      { ...of, template: TEMPLATE },
      { ...of, wrapper: WRAPPER },
      { ...of, wrapper: { ...WRAPPER, paused: undefined }, template: TEMPLATE },
      { ...of, wrapper: { ...WRAPPER, paused: "false" }, template: TEMPLATE },
      { ...of, wrapper: { ...WRAPPER, labels: {} }, template: TEMPLATE },
      { ...of, wrapper: WRAPPER, template: { ...TEMPLATE, hooks: {} } },
      { ...of, wrapper: WRAPPER, template: TEMPLATE, backup: NAME },
      { ...of, wrapper: WRAPPER, template: TEMPLATE, target: { kind: "Schedule", name: "daily", uid: "u" } },
      { ...of, schedule: "Nightly", wrapper: WRAPPER, template: TEMPLATE },
      { cluster: "cluster-a", namespace: "velero", kind: "schedule", wrapper: WRAPPER, template: TEMPLATE },
      // A backup of the form carries no wrapper.
      { cluster: "cluster-a", namespace: "velero", kind: "backup", backup: NAME, template: TEMPLATE, wrapper: WRAPPER },
    ]) {
      expect([payload, await call(CHANNELS.writeConfirm, payload)]).toEqual([
        payload,
        expect.objectContaining({ ok: false, code: "validation" }),
      ]);
    }
    // Each field of the template the form does not offer (REQ-237).
    for (const field of [
      "hooks",
      "orderedResources",
      "resourcePolicy",
      "uploaderConfig",
      "metadata",
      "includedClusterScopedResources",
      "excludedClusterScopedResources",
      "includedNamespaceScopedResources",
      "excludedNamespaceScopedResources",
      "volumeGroupSnapshotLabelKey",
      "datamover",
      "defaultVolumesToRestic",
    ])
      expect([
        field,
        await call(CHANNELS.writeConfirm, { ...of, wrapper: WRAPPER, template: { ...TEMPLATE, [field]: {} } }),
      ]).toEqual([field, expect.objectContaining({ ok: false, code: "validation" })]);
  });
});

describe("the run of a schedule of the form", () => {
  it("reads the locations again, sends the text the review showed, byte for byte, once, and reads the schedule until Velero writes its phase", async () => {
    const { enable, confirm, run, adapter, state, locationReads, scheduleReads } = fixture();

    await enable();
    const confirmed = await confirm();

    state.statuses = [{}, { phase: "Enabled" }];
    expect(await run(String(confirmed.value?.token))).toEqual({
      ok: true,
      value: { name: NAME, uid: "schedule-uid", phase: "Enabled" },
    });
    expect(adapter.createSchedule).toHaveBeenCalledTimes(1);
    expect(adapter.createSchedule.mock.calls[0]).toEqual(["velero", confirmed.value?.text, expect.any(AbortSignal)]);
    // Twice each location, at the confirmation and at the run; the schedule read until it had a phase.
    expect(locationReads()).toHaveLength(4);
    expect(scheduleReads()).toHaveLength(2);
  });

  it("answers each error of the validation Velero refused the expression with, and no phase after thirty seconds", async () => {
    const { enable, confirm, run, state, scheduleReads } = fixture();

    await enable();
    const errors = [
      "invalid schedule: provided bad location Mars/Olympus_Mons: unknown time zone Mars/Olympus_Mons",
      "a second error, as written",
    ];

    state.statuses = [{ phase: "FailedValidation", validationErrors: errors }];
    expect(await run(String((await confirm()).value?.token))).toEqual({
      ok: true,
      value: { name: NAME, uid: "schedule-uid", phase: "FailedValidation", errors },
    });
    // Within the total the answer leaves them, the others counted.
    state.schedules.clear();
    const long = Array.from({ length: 10 }, () => "e".repeat(4096));

    state.statuses = [{ phase: "FailedValidation", validationErrors: long }];
    expect(await run(String((await confirm()).value?.token))).toEqual({
      ok: true,
      value: { name: NAME, uid: "schedule-uid", phase: "FailedValidation", errors: long.slice(0, 8), errorsLeft: 2 },
    });
    state.schedules.clear();
    const reads = scheduleReads().length;

    expect(await run(String((await confirm()).value?.token))).toEqual({
      ok: true,
      value: { name: NAME, uid: "schedule-uid" },
    });
    // Every second for thirty seconds, and no more.
    expect(scheduleReads().length - reads).toBe(30);
  });

  it("reads a paused schedule once, since Velero does not read it", async () => {
    const { enable, confirm, run, scheduleReads } = fixture();

    await enable();
    const confirmed = await confirm({ ...WRAPPER, paused: true, skipImmediately: true });

    expect(await run(String(confirmed.value?.token))).toEqual({
      ok: true,
      value: { name: NAME, uid: "schedule-uid", paused: true },
    });
    expect(scheduleReads()).toHaveLength(1);
  });

  it("is a conflict when the name is taken, which changes nothing of the schedule that has it and asks nothing more", async () => {
    const { enable, confirm, run, state, adapter, scheduleReads } = fixture();

    await enable();
    state.create = async () => {
      throw new DiagnosticError("conflict");
    };
    expect(await run(String((await confirm()).value?.token))).toMatchObject({
      ok: false,
      code: "conflict",
      stage: "creation",
      text: SCHEDULE_CREATE_WORDS.exists(NAME, "velero"),
    });
    expect(adapter.createSchedule).toHaveBeenCalledTimes(1);
    expect(scheduleReads()).toHaveLength(0);
  });

  it("says each end of the creation with its code, its stage and its safety, and never the body of an answer", async () => {
    const { enable, confirm, run, state } = fixture();

    await enable();
    const ends: unknown[] = [];

    for (const error of [
      new DiagnosticError("forbidden"),
      new DiagnosticError("forbidden", undefined, "credential"),
      new DiagnosticError("validation", undefined, "refused"),
      new DiagnosticError("validation"),
      new DiagnosticError("not-found"),
      new DiagnosticError("request-failed"),
      new DiagnosticError("transport-unreachable"),
    ]) {
      state.create = async () => {
        throw error;
      };
      const end = await run(String((await confirm()).value?.token));

      ends.push([end.code, end.stage, (end as { retry?: boolean }).retry, end.text]);
    }
    expect(ends).toEqual([
      ["forbidden", "creation", false, SCHEDULE_CREATE_WORDS.forbiddenCreate("velero")],
      ["request-failed", "creation", true, SCHEDULE_CREATE_WORDS.credential],
      ["validation", "creation", false, SCHEDULE_CREATE_WORDS.rejected],
      ["validation", "creation", false, SCHEDULE_CREATE_WORDS.unsent],
      ["not-found", "creation", false, SCHEDULE_CREATE_WORDS.notServed("velero")],
      ["request-failed", "creation", false, SCHEDULE_CREATE_WORDS.declined],
      ["transport-unreachable", "creation", true, SCHEDULE_CREATE_WORDS.unreachable],
    ]);
  });

  it("looks for a schedule whose answer was lost by its name, its spec and its creation time, and never sends it again", async () => {
    const { enable, confirm, run, adapter, state, created } = fixture();

    await enable();
    // Created, and the answer lost: found with the spec that was sent, `skipImmediately` set back to false by the
    // controller at its first reading, and made since the confirmation.
    state.create = async (text) => {
      const found = created(text, { status: { phase: "Enabled", lastSkipped: new Date(state.now).toISOString() } });

      (found.spec as Record<string, unknown>).skipImmediately = false;
      state.schedules.set(NAME, found);
      throw new DiagnosticError("submission-unknown");
    };
    expect(await run(String((await confirm({ ...WRAPPER, skipImmediately: true })).value?.token))).toEqual({
      ok: true,
      value: { name: NAME, uid: "schedule-uid", phase: "Enabled", found: true },
    });
    // Not there as far as the read shows.
    state.schedules.clear();
    state.create = async () => {
      throw new DiagnosticError("submission-unknown");
    };
    expect(await run(String((await confirm()).value?.token))).toMatchObject({
      ok: false,
      code: "submission-unknown",
      text: SCHEDULE_CREATE_WORDS.notDone(NAME),
    });
    // One of that name with another spec: a conflict, which the creation did not change.
    state.schedules.set(NAME, created(textOf({ ...WRAPPER, expression: "0 4 * * *" }), { uid: "foreign-uid" }));
    expect(await run(String((await confirm()).value?.token))).toMatchObject({
      ok: false,
      code: "conflict",
      text: SCHEDULE_CREATE_WORDS.other(NAME, "velero"),
    });
    // One with the spec of the review, made before the confirmation: a conflict as well.
    state.schedules.set(NAME, created(textOf(), { uid: "older-uid", at: state.now - 2 * 60_000 }));
    expect(await run(String((await confirm()).value?.token))).toMatchObject({
      ok: false,
      code: "conflict",
      text: SCHEDULE_CREATE_WORDS.other(NAME, "velero"),
    });
    // A read that fails keeps it not known, with the name to look for.
    state.readError = new DiagnosticError("forbidden");
    expect(await run(String((await confirm()).value?.token))).toMatchObject({
      ok: false,
      code: "submission-unknown",
      text: SCHEDULE_CREATE_WORDS.unknown(NAME),
    });
    // Five runs, one creation each: none sent again.
    expect(adapter.createSchedule).toHaveBeenCalledTimes(5);
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
    expect(adapter.createSchedule).not.toHaveBeenCalled();
  });

  it("runs only for the name it was confirmed for and once, and the run carries none of the form", async () => {
    const { enable, confirm, run, call, adapter } = fixture();

    await enable();
    const confirmed = await confirm();
    const token = String(confirmed.value?.token);

    expect(await run(token, "another-name")).toMatchObject({ ok: false, code: "forbidden", stage: "confirmation" });
    // A token of a schedule does not create a backup of the form of the same name.
    expect(
      await call(CHANNELS.writeRun, {
        cluster: "cluster-a",
        namespace: "velero",
        kind: "backup",
        backup: NAME,
        token,
        request: randomUUID(),
      }),
    ).toMatchObject({ ok: false, code: "forbidden", stage: "confirmation" });
    for (const more of [{ template: TEMPLATE }, { wrapper: WRAPPER }])
      expect(
        await call(CHANNELS.writeRun, {
          cluster: "cluster-a",
          namespace: "velero",
          kind: "schedule",
          schedule: NAME,
          token,
          request: randomUUID(),
          ...more,
        }),
      ).toMatchObject({ ok: false, code: "validation" });
    expect((await run(token)).ok).toBe(true);
    expect(await run(token)).toMatchObject({ ok: false, code: "forbidden", stage: "confirmation" });
    expect(adapter.createSchedule).toHaveBeenCalledTimes(1);
  });

  it("creates nothing when writes go off before its request was sent", async () => {
    const { enable, confirm, run, adapter, gate } = fixture();

    await enable();
    const confirmed = await confirm();
    const read = adapter.read.getMockImplementation() as (...args: unknown[]) => Promise<DiagnosticObject>;

    // Writes go off while the locations are read again: the run stops there.
    adapter.read.mockImplementation(async (...args: unknown[]) => {
      if (args[0] === "VolumeSnapshotLocation") {
        gate.disable("cluster-a");
        throw new DiagnosticError("cancelled");
      }
      return read(...args);
    });
    expect(await run(String(confirmed.value?.token))).toMatchObject({ ok: false, code: "cancelled", stage: "read" });
    expect(adapter.createSchedule).not.toHaveBeenCalled();
  });

  it("sends nothing when the text kept with the token is not the schedule of the run", async () => {
    const { adapter } = fixture();
    const write = {
      sender: "frame",
      kind: "schedule" as const,
      status: { step: "confirmed" },
      controller: new AbortController(),
      done: false,
    };
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
      kind: "schedule" as const,
      schedule: NAME,
      token: randomUUID(),
      request: randomUUID(),
    };
    const elsewhere = scheduleFromForm("elsewhere", NAME, WRAPPER, TEMPLATE, NOW);

    for (const text of [textOf(WRAPPER, TEMPLATE, "another-name"), scheduleBodyText(elsewhere as never), "{"]) {
      expect(await runScheduleCreate(dependencies(text), "frame", request, () => () => undefined)).toMatchObject({
        ok: false,
        code: "conflict",
        text: SCHEDULE_CREATE_WORDS.reviewChanged,
      });
    }
    expect(adapter.createSchedule).not.toHaveBeenCalled();
  });

  it("joins a run sent again with the same identifier while it runs, and creates nothing more", async () => {
    const { enable, confirm, call, adapter } = fixture();

    await enable();
    const token = String((await confirm()).value?.token);
    const request = randomUUID();
    const payload = { cluster: "cluster-a", namespace: "velero", kind: "schedule", schedule: NAME, token, request };
    const [first, second] = await Promise.all([call(CHANNELS.writeRun, payload), call(CHANNELS.writeRun, payload)]);

    expect(second).toEqual(first);
    expect(adapter.createSchedule).toHaveBeenCalledTimes(1);
  });

  it("keeps the end of a run whose request was sent for its cluster, with its name and no schedule it was asked from", async () => {
    const { enable, confirm, run, call, state } = fixture();

    await enable();
    const request = randomUUID();

    state.statuses = [{ phase: "Enabled" }];
    await run(String((await confirm()).value?.token), NAME, request);
    const ends = await call(CHANNELS.writeEnds, { cluster: "cluster-a" });

    expect(readKeptEnds(ends.value)).toEqual([
      {
        request,
        kind: "schedule",
        namespace: "velero",
        context: "kind-a",
        name: NAME,
        outcome: { created: true, phase: "Enabled" },
        at: expect.any(Number),
      },
    ]);
  });

  it("keeps the end of a paused schedule as one Velero does not read", async () => {
    const { enable, confirm, run, call } = fixture();

    await enable();
    const request = randomUUID();

    await run(String((await confirm({ ...WRAPPER, paused: true })).value?.token), NAME, request);
    const ends = readKeptEnds((await call(CHANNELS.writeEnds, { cluster: "cluster-a" })).value);

    expect(ends?.map((end) => end.outcome)).toEqual([{ created: true, paused: true }]);
  });

  it("ends as not known, never as cancelled, a creation dropped on this side once its request was sent, and keeps that end", async () => {
    const { enable, confirm, run, call, state, gate } = fixture();

    await enable();
    const request = randomUUID();

    // Writes go off while the API server has the request: the answer is dropped here, and the schedule is not found.
    state.create = async () => {
      gate.disable("cluster-a");
      throw new DiagnosticError("cancelled");
    };
    expect(await run(String((await confirm()).value?.token), NAME, request)).toMatchObject({
      ok: false,
      code: "submission-unknown",
      text: SCHEDULE_CREATE_WORDS.notDone(NAME),
    });
    const ends = readKeptEnds((await call(CHANNELS.writeEnds, { cluster: "cluster-a" })).value);

    expect(ends?.map((end) => [end.request, end.kind, end.name, end.outcome])).toEqual([
      [
        request,
        "schedule",
        NAME,
        { created: false, code: "submission-unknown", text: SCHEDULE_CREATE_WORDS.notDone(NAME) },
      ],
    ]);
  });
});

describe("what a schedule of the form checks before and after its creation", () => {
  const OF = { cluster: "cluster-a", namespace: "velero", kind: "schedule" };
  const other = (url: string): IpcEvent => ({ senderFrame: { url }, processId: 1, frameId: 9 });

  // A frame of its own, whose address the test changes when the page is left.
  const ownFrame = async (call: ReturnType<typeof fixture>["call"]) => {
    const frame = structuredClone(FRAME_A);

    await call(
      CHANNELS.gateEnable,
      { cluster: "cluster-a", namespace: "velero", confirmation: { context: "kind-a", namespace: "velero" } },
      frame,
    );
    const confirmed = await call(
      CHANNELS.writeConfirm,
      { ...OF, schedule: NAME, wrapper: WRAPPER, template: TEMPLATE },
      frame,
    );
    const leave = () => {
      // The frame now shows another cluster: it is not the frame of this one any more.
      frame.senderFrame = { url: "https://cluster-b.renderer.freelens.app:1234/" };
    };

    return { frame, token: confirmed.value?.token, leave };
  };
  const endsOf = async (call: ReturnType<typeof fixture>["call"]) =>
    readKeptEnds((await call(CHANNELS.writeEnds, { cluster: "cluster-a" })).value) ?? [];

  it("sends nothing when the frame went while the locations were read again, and keeps no end", async () => {
    const { call, adapter, state } = fixture();
    const { frame, token, leave } = await ownFrame(call);
    const read = adapter.read.getMockImplementation() as (...args: unknown[]) => Promise<DiagnosticObject>;

    adapter.read.mockImplementation(async (...args: unknown[]) => {
      // The page of the cluster is left during the read.
      if (args[0] === "BackupStorageLocation") leave();
      return read(...args);
    });
    const ended = await call(CHANNELS.writeRun, { ...OF, schedule: NAME, token, request: randomUUID() }, frame);

    expect(ended).toMatchObject({
      ok: false,
      code: "forbidden",
      stage: "frame",
      text: SCHEDULE_CREATE_WORDS.frameGone,
    });
    expect(adapter.createSchedule).not.toHaveBeenCalled();
    expect(state.schedules.size).toBe(0);
    expect(await endsOf(call)).toEqual([]);
  });

  it("sends nothing when writes go off while the locations are read again, though the reads answered", async () => {
    const { enable, confirm, run, adapter, gate } = fixture();

    await enable();
    const token = String((await confirm()).value?.token);
    const read = adapter.read.getMockImplementation() as (...args: unknown[]) => Promise<DiagnosticObject>;

    adapter.read.mockImplementation(async (...args: unknown[]) => {
      const answer = await read(...args);

      if (args[0] === "VolumeSnapshotLocation") gate.disable("cluster-a");
      return answer;
    });
    expect(await run(token)).toMatchObject({
      ok: false,
      code: "cancelled",
      stage: "creation",
      text: SCHEDULE_CREATE_WORDS.cancelled,
    });
    expect(adapter.createSchedule).not.toHaveBeenCalled();
  });

  it("answers no frame that went after the creation, and keeps the end for the cluster", async () => {
    const { call, adapter, state } = fixture();
    const { frame, token, leave } = await ownFrame(call);
    const create = adapter.createSchedule.getMockImplementation() as (
      namespace: string,
      text: string,
    ) => Promise<DiagnosticObject>;

    adapter.createSchedule.mockImplementation(async (namespace: string, text: string) => {
      const created = await create(namespace, text);

      leave();
      return created;
    });
    state.statuses = [{ phase: "Enabled" }];
    const request = randomUUID();
    const ended = await call(CHANNELS.writeRun, { ...OF, schedule: NAME, token, request }, frame);

    expect(ended).toMatchObject({
      ok: false,
      code: "forbidden",
      stage: "frame",
      text: SCHEDULE_CREATE_WORDS.frameGoneAfter,
    });
    expect(adapter.createSchedule).toHaveBeenCalledTimes(1);
    expect((await endsOf(call)).map((end) => [end.request, end.name, end.outcome.created])).toEqual([
      [request, NAME, true],
    ]);
  });

  it("keeps the end of a creation the API server refused, and none of one that never left", async () => {
    const { enable, confirm, run, call, state, adapter } = fixture();

    await enable();
    const answered = new Map<string, string>();

    for (const [error, code] of [
      [new DiagnosticError("conflict"), "conflict"],
      [new DiagnosticError("forbidden"), "forbidden"],
      [new DiagnosticError("validation", undefined, "refused"), "validation"],
      [new DiagnosticError("not-found"), "not-found"],
    ] as const) {
      const request = randomUUID();

      state.create = async () => {
        throw error;
      };
      expect(await run(String((await confirm()).value?.token), NAME, request)).toMatchObject({ ok: false, code });
      answered.set(request, code);
    }
    // What the adapter refused to send, and a cluster that could not be reached, sent nothing.
    for (const error of [new DiagnosticError("validation"), new DiagnosticError("transport-unreachable")]) {
      state.create = async () => {
        throw error;
      };
      await run(String((await confirm()).value?.token));
    }
    const ends = await endsOf(call);

    expect(new Map(ends.map((end) => [end.request, end.outcome.created ? "created" : end.outcome.code]))).toEqual(
      answered,
    );
    expect(adapter.read.mock.calls.filter(([kind]) => kind === "Schedule")).toHaveLength(0);
  });

  it("says that a schedule the API server answered may be there, when the cluster changed before the answer was taken", async () => {
    const { enable, confirm, run, state, scheduleReads } = fixture();

    await enable();
    state.create = async () => {
      throw new DiagnosticError("target-changed", undefined, "answered");
    };
    expect(await run(String((await confirm()).value?.token))).toMatchObject({
      ok: false,
      code: "submission-unknown",
      stage: "creation",
      text: SCHEDULE_CREATE_WORDS.changedAfter(NAME),
    });
    // A cluster that changed before anything was sent is said as such.
    state.create = async () => {
      throw new DiagnosticError("target-changed");
    };
    expect(await run(String((await confirm()).value?.token))).toMatchObject({
      ok: false,
      code: "target-changed",
      text: SCHEDULE_CREATE_WORDS.changed,
    });
    expect(scheduleReads()).toHaveLength(0);
  });

  it("stops reading a schedule of that name that is not the one created, and takes no answer of another name or with no UID", async () => {
    const { enable, confirm, run, adapter, state, scheduleReads } = fixture();

    await enable();
    const create = adapter.createSchedule.getMockImplementation() as (
      namespace: string,
      text: string,
    ) => Promise<DiagnosticObject>;

    // Another schedule takes the name once the creation answered.
    adapter.createSchedule.mockImplementationOnce(async (namespace: string, text: string) => {
      const created = await create(namespace, text);

      state.schedules.set(NAME, {
        ...created,
        metadata: { ...created.metadata, uid: "another-uid" },
        status: { phase: "Enabled" },
      } as DiagnosticObject);
      return created;
    });
    const ended = await run(String((await confirm()).value?.token));

    expect(ended).toMatchObject({ ok: true, value: { name: NAME, uid: "schedule-uid" } });
    expect(ended.value?.phase).toBeUndefined();
    expect(scheduleReads()).toHaveLength(1);
    for (const answer of [
      { name: "another-name", uid: "u" },
      { name: NAME, uid: "" },
    ]) {
      state.create = async (text: string) => {
        const body = JSON.parse(text) as DiagnosticObject;

        return { ...body, metadata: { ...body.metadata, ...answer } } as DiagnosticObject;
      };
      expect(await run(String((await confirm()).value?.token))).toMatchObject({
        ok: false,
        code: "submission-unknown",
        text: SCHEDULE_CREATE_WORDS.unknown(NAME),
      });
    }
    expect(scheduleReads()).toHaveLength(1);
  });

  it("looks for a schedule whose answer was lost with a read the write that stopped does not end, and reads a paused one it finds once", async () => {
    const { enable, confirm, run, state, gate, created, scheduleReads } = fixture();

    await enable();
    // Writes go off while the API server has the request: the signal of the write ended, the look has its own.
    state.create = async (text: string) => {
      state.schedules.set(NAME, created(text));
      gate.disable("cluster-a");
      throw new DiagnosticError("cancelled");
    };
    expect(await run(String((await confirm({ ...WRAPPER, paused: true })).value?.token))).toMatchObject({
      ok: true,
      value: { name: NAME, uid: "schedule-uid", paused: true, found: true },
    });
    // The look by its name, and the one read of a schedule Velero does not read.
    expect(scheduleReads()).toHaveLength(2);
  });

  it("takes a schedule found by its name for the one created only when its spec is the one sent, skip immediately aside", async () => {
    const { enable, confirm, run, state, created } = fixture();

    await enable();
    const changes: ((spec: Record<string, unknown>) => void)[] = [
      (spec) => {
        spec.schedule = "0 4 * * *";
      },
      (spec) => {
        spec.paused = true;
      },
      (spec) => {
        spec.useOwnerReferencesInBackup = true;
      },
      (spec) => {
        (spec.template as Record<string, unknown>).ttl = "1h0m0s";
      },
      (spec) => {
        delete (spec.template as Record<string, unknown>).volumeSnapshotLocations;
      },
    ];
    const lost = (change: (spec: Record<string, unknown>) => void) => async (text: string) => {
      const found = created(text);

      change((found as unknown as { spec: Record<string, unknown> }).spec);
      state.schedules.set(NAME, found);
      throw new DiagnosticError("submission-unknown");
    };

    for (const change of changes) {
      state.schedules.clear();
      state.create = lost(change);
      expect(await run(String((await confirm()).value?.token))).toMatchObject({
        ok: false,
        code: "conflict",
        text: SCHEDULE_CREATE_WORDS.other(NAME, "velero"),
      });
    }
    // The controller sets skip immediately back to false at its first reading: the spec is the one sent.
    state.schedules.clear();
    state.create = lost((spec) => {
      spec.skipImmediately = false;
    });
    expect(await run(String((await confirm({ ...WRAPPER, skipImmediately: true })).value?.token))).toMatchObject({
      ok: true,
      value: { found: true },
    });
  });

  it("takes a schedule found by its name for the one created within a minute before the confirmation, and not before", async () => {
    const { enable, confirm, run, state, created } = fixture();

    await enable();
    for (const [margin, ok] of [
      [59_000, true],
      [61_000, false],
    ] as const) {
      state.schedules.clear();
      const token = String((await confirm()).value?.token);
      const at = state.now - margin;

      state.create = async (text: string) => {
        state.schedules.set(NAME, created(text, { at }));
        throw new DiagnosticError("submission-unknown");
      };
      expect((await run(token)).ok).toBe(ok);
    }
  });

  it("refuses a token of another frame, an expired one, and joins no run of another name with the same identifier", async () => {
    const { enable, confirm, call, run, adapter, state } = fixture();

    await enable();
    const token = String((await confirm()).value?.token);

    expect(
      await call(
        CHANNELS.writeRun,
        { ...OF, schedule: NAME, token, request: randomUUID() },
        other("https://cluster-a.renderer.freelens.app:1234/"),
      ),
    ).toMatchObject({ ok: false, code: "forbidden" });
    const expired = String((await confirm()).value?.token);

    state.now += 31_000;
    expect(await run(expired)).toMatchObject({ ok: false, code: "forbidden", stage: "confirmation" });
    expect(adapter.createSchedule).not.toHaveBeenCalled();
    // The same identifier, sent for another schedule while the first runs, is not that run.
    const first = String((await confirm()).value?.token);
    const request = randomUUID();
    const [ran, another] = await Promise.all([run(first, NAME, request), run(first, "another-name", request)]);

    expect(ran.ok).toBe(true);
    expect(another).toMatchObject({
      ok: false,
      code: "forbidden",
      text: "No write of this frame has this identifier.",
    });
    expect(adapter.createSchedule).toHaveBeenCalledTimes(1);
  });
});
