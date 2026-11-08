// The procedures of the pause and of the resume of a schedule, as the frames call them (SPEC-0017, PAUSE-02, PAUSE-04,
// ACT-02, ACT-03, ACT-05 to ACT-07): the confirmation that writes the JSON patch of the action and reads nothing; the
// run that sends that text byte for byte, once, reads the schedule once and answers what the patch wrote; a 422 read as
// a test that failed when the schedule is not as the patch tested; and every way it ends, a patch whose answer is not
// known never sent again and the schedule read to say what it shows.

import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { CHANNELS, readKeptEnds } from "../common/ipc";
import { patchText, pausePatch, readSchedulePatch, resumePatch } from "../common/schedule-patch";
import { DiagnosticError } from "./diagnostic-transport";
import { registerHandlers } from "./ipc";
import { confirmSchedulePatch, runSchedulePatch, SCHEDULE_PATCH_WORDS } from "./schedule-patch";
import { WriteGate } from "./write-gate";

import type { CatalogEntry } from "./catalog";
import type { DiagnosticObject } from "./diagnostic-kubernetes";
import type { IpcEvent, Registrar } from "./ipc";

const FRAME_A: IpcEvent = {
  senderFrame: { url: "https://cluster-a.renderer.freelens.app:1234/" },
  processId: 1,
  frameId: 4,
};
const SCHEDULE = { kind: "Schedule" as const, name: "nightly", uid: "nightly-uid" };
const EXPRESSION = "CRON_TZ=Europe/Rome 0 3 * * *";
const NOW = Date.parse("2026-11-08T12:00:00Z");

function scheduleOf(paused: boolean | undefined, more: Record<string, unknown> = {}): DiagnosticObject {
  return {
    apiVersion: "velero.io/v1",
    kind: "Schedule",
    metadata: { name: SCHEDULE.name, namespace: "velero", uid: SCHEDULE.uid },
    spec: { schedule: EXPRESSION, template: {}, ...(paused === undefined ? {} : { paused }) },
    status: { phase: "Enabled" },
    ...more,
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
  // What the cluster of the test holds, and what the API server does with a patch: its tests, then its writes, as a
  // JSON patch is applied.
  const state = {
    schedule: scheduleOf(undefined) as DiagnosticObject | undefined,
    readError: undefined as undefined | DiagnosticError,
    patch: undefined as undefined | ((text: string) => Promise<DiagnosticObject>),
    // What the controller writes into the schedule once it read it, after a resume.
    afterRead: undefined as undefined | ((schedule: DiagnosticObject) => void),
    now: NOW,
  };
  const apply = (text: string): DiagnosticObject => {
    const schedule = state.schedule;

    if (!schedule) throw new DiagnosticError("not-found");
    const next = structuredClone(schedule) as DiagnosticObject & { spec: Record<string, unknown> };

    for (const operation of JSON.parse(text) as { op: string; path: string; value: unknown }[]) {
      const [, part, field] = operation.path.split("/");
      const holder = (part === "metadata" ? next.metadata : next.spec) as Record<string, unknown>;

      if (operation.op === "test" && JSON.stringify(holder[field]) !== JSON.stringify(operation.value))
        throw new DiagnosticError("validation", undefined, "refused");
      if (operation.op === "replace" && !(field in holder))
        throw new DiagnosticError("validation", undefined, "refused");
      if (operation.op === "add" || operation.op === "replace") holder[field] = operation.value;
    }
    state.schedule = next;
    return structuredClone(next);
  };
  const adapter = {
    binding: { id: "cluster-a", name: "demo", kubeConfigPath: "/synthetic/a", contextName: "kind-a" },
    assertCurrent: vi.fn(),
    read: vi.fn(async (kind: string, _namespace: string, name: string, signal?: AbortSignal) => {
      if (signal?.aborted) throw new DiagnosticError("cancelled");
      if (kind !== "Schedule") throw new DiagnosticError("validation");
      if (state.readError) throw state.readError;
      if (!state.schedule || state.schedule.metadata.name !== name) throw new DiagnosticError("not-found");
      state.afterRead?.(state.schedule);
      return structuredClone(state.schedule);
    }),
    patchSchedule: vi.fn(async (_namespace: string, _name: string, text: string): Promise<DiagnosticObject> => {
      if (state.patch) return state.patch(text);
      return apply(text);
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
      retry?: boolean;
    }>;
  };
  const enable = () =>
    call(CHANNELS.gateEnable, {
      cluster: "cluster-a",
      namespace: "velero",
      confirmation: { context: "kind-a", namespace: "velero" },
    });
  const pause = { cluster: "cluster-a", namespace: "velero", kind: "schedule-pause", target: SCHEDULE };
  const resume = (skipImmediately = false, expression = EXPRESSION) => ({
    cluster: "cluster-a",
    namespace: "velero",
    kind: "schedule-resume",
    target: SCHEDULE,
    resume: { expression, skipImmediately },
  });
  const confirm = (payload: object = pause) => call(CHANNELS.writeConfirm, payload);
  const run = (token: string, kind = "schedule-pause", request = randomUUID(), target = SCHEDULE) =>
    call(CHANNELS.writeRun, { cluster: "cluster-a", namespace: "velero", kind, target, token, request });
  const reads = () => adapter.read.mock.calls.filter(([kind]) => kind === "Schedule");
  const endsOf = async () => readKeptEnds((await call(CHANNELS.writeEnds, { cluster: "cluster-a" })).value) ?? [];

  return { state, adapter, gate, call, enable, pause, resume, confirm, run, reads, endsOf, apply };
}

describe("the confirmation of a pause and of a resume", () => {
  it("is refused with writes off and with writes on for another namespace, and reads nothing", async () => {
    const { call, confirm, adapter } = fixture();

    expect(await confirm()).toMatchObject({ ok: false, code: "forbidden", stage: "gate" });
    await call(CHANNELS.gateEnable, {
      cluster: "cluster-a",
      namespace: "other",
      confirmation: { context: "kind-a", namespace: "other" },
    });
    expect(await confirm()).toMatchObject({ ok: false, code: "forbidden", stage: "gate" });
    expect(adapter.read).not.toHaveBeenCalled();
  });

  it("answers the text of the patch of the action with the token, and reads nothing: the tests of the patch are the check", async () => {
    const { enable, confirm, resume, adapter } = fixture();

    await enable();
    const paused = await confirm();
    const resumed = await confirm(resume(true));

    expect(paused).toMatchObject({ ok: true, value: { text: patchText(pausePatch(SCHEDULE.uid)) } });
    expect(resumed).toMatchObject({
      ok: true,
      value: { text: patchText(resumePatch(SCHEDULE.uid, { expression: EXPRESSION, skipImmediately: true })) },
    });
    expect(JSON.parse(String(resumed.value?.text))).toEqual([
      { op: "test", path: "/metadata/uid", value: "nightly-uid" },
      { op: "test", path: "/spec/paused", value: true },
      { op: "test", path: "/spec/schedule", value: EXPRESSION },
      { op: "replace", path: "/spec/paused", value: false },
      { op: "add", path: "/spec/skipImmediately", value: true },
    ]);
    expect(adapter.read).not.toHaveBeenCalled();
  });

  it("is refused by the contract for what is not a schedule, a resume with nothing to resume with, or anything more", async () => {
    const { enable, call, pause, resume } = fixture();

    await enable();
    for (const payload of [
      { ...pause, target: { ...SCHEDULE, kind: "Backup" } },
      { ...pause, target: undefined },
      { ...resume(), resume: undefined },
      { ...pause, resume: resume().resume },
      { ...pause, backup: "nightly-1" },
      { ...resume(), resume: { expression: "", skipImmediately: false } },
    ])
      expect([payload, await call(CHANNELS.writeConfirm, payload)]).toEqual([
        payload,
        expect.objectContaining({ ok: false, code: "validation" }),
      ]);
  });
});

describe("the run of a pause and of a resume", () => {
  it("sends the text of the pause byte for byte, once, reads the schedule once, and answers it paused", async () => {
    const { enable, confirm, run, adapter, reads } = fixture();

    await enable();
    const confirmed = await confirm();

    expect(await run(String(confirmed.value?.token))).toEqual({
      ok: true,
      value: { name: "nightly", uid: "nightly-uid", paused: true },
    });
    expect(adapter.patchSchedule.mock.calls).toEqual([["velero", "nightly", confirmed.value?.text, expect.anything()]]);
    expect(reads()).toHaveLength(1);
  });

  it("pauses a schedule paused already and leaves it as it was, since a pause tests no paused", async () => {
    const { enable, confirm, run, state } = fixture();

    await enable();
    state.schedule = scheduleOf(true);
    const before = structuredClone(state.schedule);

    expect(await run(String((await confirm()).value?.token))).toMatchObject({ ok: true, value: { paused: true } });
    expect(state.schedule).toEqual(before);
  });

  it("resumes with skipImmediately as chosen, and answers what Velero wrote once it read the schedule", async () => {
    const { enable, confirm, resume, run, state } = fixture();

    await enable();
    state.schedule = scheduleOf(true);
    expect(await run(String((await confirm(resume(false))).value?.token), "schedule-resume")).toEqual({
      ok: true,
      value: { name: "nightly", uid: "nightly-uid", paused: false, skipImmediately: false },
    });
    // Velero reads a resumed schedule at once: it skips the run and sets the field back to false.
    state.schedule = scheduleOf(true);
    state.afterRead = (schedule) => {
      const spec = schedule.spec as Record<string, unknown>;

      if (spec.skipImmediately === true) {
        spec.skipImmediately = false;
        schedule.status = { ...(schedule.status ?? {}), lastSkipped: "2026-11-08T12:00:01Z" };
      }
    };
    expect(await run(String((await confirm(resume(true))).value?.token), "schedule-resume")).toEqual({
      ok: true,
      value: {
        name: "nightly",
        uid: "nightly-uid",
        paused: false,
        skipImmediately: false,
        lastSkipped: "2026-11-08T12:00:01Z",
      },
    });
  });

  it("says a test that failed as a change since the review, with the schedule read: another UID, not paused, another expression", async () => {
    const { enable, confirm, resume, run, state, reads } = fixture();

    await enable();
    for (const [schedule, kind, payload] of [
      [
        scheduleOf(undefined, { metadata: { name: "nightly", namespace: "velero", uid: "other-uid" } }),
        "schedule-pause",
        undefined,
      ],
      [scheduleOf(false), "schedule-resume", resume()],
      [scheduleOf(undefined), "schedule-resume", resume()],
      [scheduleOf(true), "schedule-resume", resume(false, "0 4 * * *")],
    ] as const) {
      state.schedule = schedule;
      const token = String((await confirm(payload ?? undefined)).value?.token);

      expect([kind, await run(token, kind)]).toEqual([
        kind,
        expect.objectContaining({
          ok: false,
          code: "conflict",
          stage: "patch",
          text: SCHEDULE_PATCH_WORDS.changed("nightly"),
        }),
      ]);
    }
    expect(reads()).toHaveLength(4);
  });

  it("says a 422 of a schedule as the patch tested it a refusal, and one that went as gone", async () => {
    const { enable, confirm, resume, run, state } = fixture();

    await enable();
    state.schedule = scheduleOf(true);
    state.patch = async () => {
      throw new DiagnosticError("validation", undefined, "refused");
    };
    expect(await run(String((await confirm(resume())).value?.token), "schedule-resume")).toMatchObject({
      ok: false,
      code: "validation",
      text: SCHEDULE_PATCH_WORDS.rejected,
    });
    state.schedule = undefined;
    expect(await run(String((await confirm()).value?.token))).toMatchObject({
      ok: false,
      code: "not-found",
      text: SCHEDULE_PATCH_WORDS.gone("nightly", "velero"),
    });
    state.schedule = scheduleOf(true);
    state.readError = new DiagnosticError("forbidden");
    expect(await run(String((await confirm()).value?.token))).toMatchObject({
      ok: false,
      code: "validation",
      text: SCHEDULE_PATCH_WORDS.rejected,
    });
  });

  it.each([
    [new DiagnosticError("forbidden"), "forbidden", false, SCHEDULE_PATCH_WORDS.forbidden("velero")],
    [
      new DiagnosticError("forbidden", undefined, "credential"),
      "request-failed",
      true,
      SCHEDULE_PATCH_WORDS.credential,
    ],
    [new DiagnosticError("validation"), "validation", false, SCHEDULE_PATCH_WORDS.unsent],
    [new DiagnosticError("not-found"), "not-found", false, SCHEDULE_PATCH_WORDS.gone("nightly", "velero")],
    [new DiagnosticError("conflict"), "conflict", false, SCHEDULE_PATCH_WORDS.conflict("nightly")],
    [new DiagnosticError("request-failed"), "request-failed", false, SCHEDULE_PATCH_WORDS.declined],
    [new DiagnosticError("transport-unreachable"), "transport-unreachable", true, SCHEDULE_PATCH_WORDS.unreachable],
    [new DiagnosticError("target-changed"), "target-changed", false, SCHEDULE_PATCH_WORDS.targetChanged],
    [
      new DiagnosticError("target-changed", undefined, "answered"),
      "submission-unknown",
      false,
      SCHEDULE_PATCH_WORDS.changedAfter("nightly"),
    ],
    [new Error("broken"), "request-failed", false, SCHEDULE_PATCH_WORDS.failed],
  ] as const)(
    "ends a patch refused as %s with its code, its safety and its words",
    async (error, code, retry, text) => {
      const { enable, confirm, run, state, reads } = fixture();

      await enable();
      state.patch = async () => {
        throw error;
      };
      expect(await run(String((await confirm()).value?.token))).toEqual({
        ok: false,
        code,
        stage: "patch",
        retry,
        text,
      });
      expect(reads()).toHaveLength(0);
    },
  );

  it("never sends again a patch whose answer is not known, and says what the schedule read then shows", async () => {
    const { enable, confirm, run, state, adapter, gate } = fixture();

    await enable();
    // The answer was lost after the patch was applied: the schedule is paused, as far as the read shows.
    state.patch = async (text) => {
      fixtureApply(state, text);
      throw new DiagnosticError("submission-unknown");
    };
    expect(await run(String((await confirm()).value?.token))).toMatchObject({
      ok: false,
      code: "submission-unknown",
      text: SCHEDULE_PATCH_WORDS.unknownRead("nightly", true),
    });
    // The read fails as well.
    state.readError = new DiagnosticError("transport-unreachable");
    expect(await run(String((await confirm()).value?.token))).toMatchObject({
      ok: false,
      code: "submission-unknown",
      text: SCHEDULE_PATCH_WORDS.unknown("nightly"),
    });
    // Writes go off while the API server has the request: the read has a signal of its own.
    state.readError = undefined;
    state.schedule = scheduleOf(undefined);
    state.patch = async () => {
      gate.disable("cluster-a");
      throw new DiagnosticError("cancelled");
    };
    expect(await run(String((await confirm()).value?.token))).toMatchObject({
      ok: false,
      code: "submission-unknown",
      text: SCHEDULE_PATCH_WORDS.unknownRead("nightly", false),
    });
    expect(adapter.patchSchedule).toHaveBeenCalledTimes(3);
  });

  it("takes no answer of another schedule, and answers the patch when the read after it does not answer", async () => {
    const { enable, confirm, run, state } = fixture();

    await enable();
    state.patch = async (text) => ({ ...fixtureApply(state, text), metadata: { name: "nightly", uid: "other-uid" } });
    expect(await run(String((await confirm()).value?.token))).toMatchObject({
      ok: false,
      code: "submission-unknown",
      text: SCHEDULE_PATCH_WORDS.unknown("nightly"),
    });
    state.patch = undefined;
    state.schedule = scheduleOf(undefined);
    state.readError = new DiagnosticError("deadline");
    expect(await run(String((await confirm()).value?.token))).toEqual({
      ok: true,
      value: { name: "nightly", uid: "nightly-uid", paused: true },
    });
  });

  it("keeps for the cluster the end of a patch that was sent, applied or not, and none of one that never left", async () => {
    const { enable, confirm, run, state, endsOf } = fixture();

    await enable();
    const applied = randomUUID();
    const refused = randomUUID();

    await run(String((await confirm()).value?.token), "schedule-pause", applied);
    state.patch = async () => {
      throw new DiagnosticError("conflict");
    };
    await run(String((await confirm()).value?.token), "schedule-pause", refused);
    for (const error of [new DiagnosticError("validation"), new DiagnosticError("transport-unreachable")]) {
      state.patch = async () => {
        throw error;
      };
      await run(String((await confirm()).value?.token));
    }
    expect((await endsOf()).map((end) => [end.request, end.kind, end.name, end.outcome])).toEqual([
      [applied, "schedule-pause", "nightly", { created: true }],
      [
        refused,
        "schedule-pause",
        "nightly",
        { created: false, code: "conflict", text: SCHEDULE_PATCH_WORDS.conflict("nightly") },
      ],
    ]);
  });

  it("sends nothing when the text kept with the token is not the patch of the run, of its schedule", async () => {
    const { adapter } = fixture();
    const write = {
      sender: "frame",
      kind: "schedule-pause" as const,
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
      kind: "schedule-pause" as const,
      target: SCHEDULE,
      token: randomUUID(),
      request: randomUUID(),
    };

    for (const text of [
      patchText(pausePatch("other-uid")),
      patchText(resumePatch(SCHEDULE.uid, { expression: EXPRESSION, skipImmediately: false })),
      "{",
    ])
      expect(await runSchedulePatch(dependencies(text), "frame", request, () => () => undefined)).toMatchObject({
        ok: false,
        code: "conflict",
        text: SCHEDULE_PATCH_WORDS.reviewChanged,
      });
    expect(adapter.patchSchedule).not.toHaveBeenCalled();
    expect(readSchedulePatch(patchText(pausePatch(SCHEDULE.uid)))).toMatchObject({ action: "schedule-pause" });
    // A frame that went before anything was sent: nothing is sent, and nothing is kept.
    expect(
      await runSchedulePatch(
        dependencies(patchText(pausePatch(SCHEDULE.uid))),
        "frame",
        request,
        () => () => undefined,
        () => false,
      ),
    ).toMatchObject({ ok: false, code: "forbidden", stage: "frame", text: SCHEDULE_PATCH_WORDS.frameGone });
    expect(adapter.patchSchedule).not.toHaveBeenCalled();
  });

  it("confirms no resume with nothing to resume with, and no pause with something to resume with, called past the contract", async () => {
    const { gate } = fixture();
    const dependencies = { gate, now: () => NOW, sleep: async () => undefined };
    const of = { cluster: "cluster-a", namespace: "velero", target: SCHEDULE };

    for (const request of [
      { ...of, kind: "schedule-resume" as const },
      { ...of, kind: "schedule-pause" as const, resume: { expression: EXPRESSION, skipImmediately: false } },
      { ...of, kind: "schedule-pause" as const, target: { ...SCHEDULE, kind: "Backup" as const } },
    ])
      expect(await confirmSchedulePatch(dependencies, "frame", request, new AbortController().signal)).toMatchObject({
        ok: false,
        code: "validation",
        text: SCHEDULE_PATCH_WORDS.notAPatch,
      });
    // A text the answer of a confirmation cannot carry is not confirmed.
    gate.enable("cluster-a", "velero", { context: "kind-a", namespace: "velero" }, { key: "frame", alive: () => true });
    const long = await confirmSchedulePatch(
      dependencies,
      "frame",
      { ...of, kind: "schedule-resume", resume: { expression: "x".repeat(70_000), skipImmediately: false } },
      new AbortController().signal,
    );

    expect(long).toMatchObject({ ok: false, code: "validation", stage: "review" });
    expect((long as { text: string }).text).toMatch(
      /^The patch is written in \d+ characters, more than a review carries/,
    );
  });
});

describe("what a pause and a resume check before and after the patch", () => {
  const other = (url: string): IpcEvent => ({ senderFrame: { url }, processId: 1, frameId: 9 });

  it("refuses a token of another frame, an expired one, another namespace, another action and writes turned off after the confirmation", async () => {
    const { enable, confirm, call, run, adapter, state, gate } = fixture();

    await enable();
    const token = String((await confirm()).value?.token);
    const payload = (with_: Record<string, unknown> = {}) => ({
      cluster: "cluster-a",
      namespace: "velero",
      kind: "schedule-pause",
      target: SCHEDULE,
      token,
      request: randomUUID(),
      ...with_,
    });

    expect(
      await call(CHANNELS.writeRun, payload(), other("https://cluster-a.renderer.freelens.app:1234/")),
    ).toMatchObject({ ok: false, code: "forbidden" });
    expect(await call(CHANNELS.writeRun, payload({ kind: "schedule-resume" }))).toMatchObject({
      ok: false,
      code: "forbidden",
      stage: "confirmation",
    });
    expect(await call(CHANNELS.writeRun, payload({ namespace: "velero-other" }))).toMatchObject({
      ok: false,
      code: "forbidden",
    });
    expect(await call(CHANNELS.writeRun, payload({ target: { ...SCHEDULE, uid: "other-uid" } }))).toMatchObject({
      ok: false,
      code: "forbidden",
      stage: "confirmation",
    });
    const expired = String((await confirm()).value?.token);

    state.now += 31_000;
    expect(await run(expired)).toMatchObject({ ok: false, code: "forbidden", stage: "confirmation" });
    const off = String((await confirm()).value?.token);

    gate.disable("cluster-a");
    expect(await run(off)).toMatchObject({ ok: false, code: "forbidden", stage: "gate" });
    expect(adapter.patchSchedule).not.toHaveBeenCalled();
  });

  it("sends nothing for a frame that went before the patch, and answers no frame that went after it, keeping the end", async () => {
    const { call, adapter, endsOf } = fixture();
    const frame = structuredClone(FRAME_A);

    await call(
      CHANNELS.gateEnable,
      { cluster: "cluster-a", namespace: "velero", confirmation: { context: "kind-a", namespace: "velero" } },
      frame,
    );
    const confirmed = await call(
      CHANNELS.writeConfirm,
      { cluster: "cluster-a", namespace: "velero", kind: "schedule-pause", target: SCHEDULE },
      frame,
    );
    const leave = () => {
      frame.senderFrame = { url: "https://cluster-b.renderer.freelens.app:1234/" };
    };
    const patch = adapter.patchSchedule.getMockImplementation() as (...args: unknown[]) => Promise<DiagnosticObject>;

    adapter.patchSchedule.mockImplementation(async (...args: unknown[]) => {
      const answer = await patch(...args);

      leave();
      return answer;
    });
    const request = randomUUID();
    const ended = await call(
      CHANNELS.writeRun,
      {
        cluster: "cluster-a",
        namespace: "velero",
        kind: "schedule-pause",
        target: SCHEDULE,
        token: confirmed.value?.token,
        request,
      },
      frame,
    );

    expect(ended).toMatchObject({
      ok: false,
      code: "forbidden",
      stage: "frame",
      text: SCHEDULE_PATCH_WORDS.frameGoneAfter,
    });
    expect((await endsOf()).map((end) => [end.request, end.outcome])).toEqual([[request, { created: true }]]);
  });

  it("frees its place among the writes once it ended: seventeen patches in a row", async () => {
    const { enable, confirm, run, adapter } = fixture();

    await enable();
    for (let count = 0; count < 17; count += 1)
      expect([count, (await run(String((await confirm()).value?.token))).ok]).toEqual([count, true]);
    expect(adapter.patchSchedule).toHaveBeenCalledTimes(17);
  });

  it("joins a run sent again with the same identifier while it runs, and gives no other token or schedule the run of a request in flight", async () => {
    const { enable, confirm, call, adapter } = fixture();

    await enable();
    const first = String((await confirm()).value?.token);
    const second = String((await confirm()).value?.token);
    const request = randomUUID();
    const payload = (token: string, target = SCHEDULE) => ({
      cluster: "cluster-a",
      namespace: "velero",
      kind: "schedule-pause",
      target,
      token,
      request,
    });
    const running = call(CHANNELS.writeRun, payload(first));
    const [again, another, otherSchedule] = await Promise.all([
      call(CHANNELS.writeRun, payload(first)),
      call(CHANNELS.writeRun, payload(second)),
      call(CHANNELS.writeRun, payload(first, { ...SCHEDULE, name: "weekly" })),
    ]);
    const ran = await running;

    expect(ran.ok).toBe(true);
    expect(again).toEqual(ran);
    for (const refused of [another, otherSchedule])
      expect(refused).toMatchObject({
        ok: false,
        code: "forbidden",
        text: "No write of this frame has this identifier.",
      });
    expect(adapter.patchSchedule).toHaveBeenCalledTimes(1);
  });
});

// The patch applied to the schedule of the fixture, as the API server applies it.
function fixtureApply(state: { schedule: DiagnosticObject | undefined }, text: string): DiagnosticObject {
  const schedule = structuredClone(state.schedule) as DiagnosticObject & { spec: Record<string, unknown> };

  for (const operation of JSON.parse(text) as { op: string; path: string; value: unknown }[])
    if (operation.op !== "test") schedule.spec[operation.path.split("/")[2]] = operation.value;
  state.schedule = schedule;
  return structuredClone(schedule);
}
