import { describe, expect, it } from "vitest";
import { patchText, pausePatch, resumePatch } from "../../common/schedule-patch";
import { PauseResume } from "./schedule-patch";

import type { Answer, Failure, ScheduleChanged, WriteConfirmAnswer } from "../../common/ipc";
import type { SchedulePatchClient } from "../api/ipc";

// 2026-11-08 04:30:15 UTC, the clock of the machine.
const NOW = Date.UTC(2026, 10, 8, 4, 30, 15);
const EXPRESSION = "CRON_TZ=Europe/Rome 0 3 * * *";
const SCHEDULE = { name: "nightly", uid: "nightly-uid", expression: EXPRESSION };
const PAUSE = patchText(pausePatch("nightly-uid"));
const resumeText = (skipImmediately: boolean, expression = EXPRESSION, uid = "nightly-uid") =>
  patchText(resumePatch(uid, { expression, skipImmediately }));

function failure(code: Failure["code"], stage: string, text = `${code} at ${stage}`): Failure {
  return { ok: false, code, stage, retry: false, text };
}

interface Held<Value> {
  args: unknown[];
  answer(value: Answer<Value>): void;
}

// The main process as the state sees it: each confirmation and each run waits until the test answers it.
function mainProcess() {
  const confirms: Held<WriteConfirmAnswer>[] = [];
  const runs: Held<ScheduleChanged>[] = [];
  const client: SchedulePatchClient = {
    confirmSchedulePatch: (...args) =>
      new Promise((resolve) => {
        confirms.push({ args, answer: resolve });
      }),
    runSchedulePatch: (...args) =>
      new Promise((resolve) => {
        runs.push({ args, answer: resolve });
      }),
  };

  return { client, confirms, runs };
}

function pauseResume(options: { client?: SchedulePatchClient; writesOn?: boolean } = {}) {
  const clock = { now: NOW };
  const refusals: number[] = [];
  const shown: string[] = [];
  let request = 0;
  const writes = { on: options.writesOn ?? true };
  const state = new PauseResume({
    client: options.client,
    cluster: () => "cluster-a",
    namespace: () => "velero",
    writesOn: () => writes.on,
    now: () => clock.now,
    requestId: () => `request-${++request}`,
    refused: () => refusals.push(clock.now),
    shown: (request) => shown.push(request),
  });

  return { state, clock, refusals, writes, shown };
}

const turn = () => new Promise((resolve) => setTimeout(resolve, 0));

function confirmed(token: string, text: string, expires = NOW + 30_000): Answer<WriteConfirmAnswer> {
  return { ok: true, value: { token, expires, text } };
}

const PAUSED: ScheduleChanged = { name: "nightly", uid: "nightly-uid", paused: true };

describe("a pause and a resume of a schedule, in the views", () => {
  it("proposes skip immediately as the schedule carries it, true when it is true and false otherwise, and keeps the form it had", () => {
    const { state } = pauseResume({ client: mainProcess().client });

    for (const [carried, proposed] of [
      [true, true],
      [false, false],
      [undefined, false],
      ["true", false],
    ] as const) {
      state.start("schedule-resume", SCHEDULE, carried);
      expect([carried, state.skip]).toEqual([carried, proposed]);
    }
    state.start("schedule-resume", SCHEDULE, false);
    state.choose(true);
    // The workspace opened again for the same schedule, the same action and the same expression keeps its choice.
    state.open("schedule-resume", SCHEDULE, false);
    expect(state.skip).toBe(true);
    // Another action, a schedule of the same name created since, and an expression that changed are another form.
    for (const [action, schedule] of [
      ["schedule-pause", SCHEDULE],
      ["schedule-resume", { ...SCHEDULE, uid: "other-uid" }],
      ["schedule-resume", { ...SCHEDULE, expression: "0 4 * * *" }],
      ["schedule-resume", { ...SCHEDULE, name: "weekly" }],
    ] as const) {
      state.start("schedule-resume", SCHEDULE, false);
      state.choose(true);
      state.open(action, schedule, false);
      expect([action, schedule, state.action, state.schedule, state.skip]).toEqual([
        action,
        schedule,
        action,
        schedule,
        false,
      ]);
    }
  });

  it("asks nothing with writes off, without a schedule, or for a resume without its expression, and says a missing way", async () => {
    const main = mainProcess();
    const { state, writes, refusals } = pauseResume({ client: main.client });

    await state.review();
    state.start("schedule-pause", SCHEDULE, undefined);
    writes.on = false;
    await state.review();
    writes.on = true;
    state.start("schedule-resume", { name: "nightly", uid: "nightly-uid" }, undefined);
    await state.review();
    expect(main.confirms).toHaveLength(0);
    expect(state.step).toEqual({ state: "form" });
    const lost = pauseResume();

    lost.state.start("schedule-pause", SCHEDULE, undefined);
    await lost.state.review();
    expect(lost.state.step).toMatchObject({ state: "failed", left: "none", failure: { stage: "way" } });
    expect([refusals, lost.refusals]).toEqual([[], []]);
  });

  it("asks the review of a pause and of a resume with what each tests and writes, and shows the text the main process answered", async () => {
    const main = mainProcess();
    const { state } = pauseResume({ client: main.client });

    state.start("schedule-pause", SCHEDULE, undefined);
    const asking = state.review();

    expect(state.step).toEqual({ state: "asking" });
    expect(state.busy).toBe(true);
    main.confirms[0].answer(confirmed("token-1", PAUSE));
    await asking;
    expect(main.confirms[0].args).toEqual([
      "cluster-a",
      "velero",
      "schedule-pause",
      { name: "nightly", uid: "nightly-uid" },
      undefined,
    ]);
    expect(state.step).toEqual({ state: "reviewing", token: "token-1", expires: NOW + 30_000, text: PAUSE });
    expect(state.busy).toBe(false);
    state.start("schedule-resume", SCHEDULE, true);
    const resuming = state.review();

    main.confirms[1].answer(confirmed("token-2", resumeText(true)));
    await resuming;
    expect(main.confirms[1].args).toEqual([
      "cluster-a",
      "velero",
      "schedule-resume",
      { name: "nightly", uid: "nightly-uid" },
      { expression: EXPRESSION, skipImmediately: true },
    ]);
    expect(state.step).toMatchObject({ state: "reviewing", token: "token-2", text: resumeText(true) });
  });

  it("confirms no text that is not the patch asked: another action, schedule, expression or choice, or no patch", async () => {
    const main = mainProcess();
    const { state, refusals } = pauseResume({ client: main.client });

    for (const text of [
      PAUSE,
      resumeText(false),
      resumeText(true, "0 4 * * *"),
      resumeText(true, EXPRESSION, "other-uid"),
      "{",
      "",
    ]) {
      state.start("schedule-resume", SCHEDULE, true);
      const asking = state.review();

      main.confirms.at(-1)?.answer(confirmed("token", text));
      await asking;
      expect([text, state.step]).toEqual([
        text,
        expect.objectContaining({
          state: "failed",
          left: "none",
          failure: expect.objectContaining({ stage: "review" }),
        }),
      ]);
    }
    state.start("schedule-pause", SCHEDULE, undefined);
    const asking = state.review();

    main.confirms.at(-1)?.answer(confirmed("token", patchText(pausePatch("other-uid"))));
    await asking;
    expect(state.step).toMatchObject({ state: "failed", failure: { stage: "review" } });
    // A review the main process refused says its words, and the gate is asked again.
    state.start("schedule-pause", SCHEDULE, undefined);
    const refusing = state.review();

    main.confirms.at(-1)?.answer(failure("forbidden", "gate"));
    await refusing;
    expect(state.step).toEqual({ state: "failed", failure: failure("forbidden", "gate"), left: "none" });
    expect(refusals).toEqual([NOW]);
  });

  it("drops a review with its token when the choice changes, and keeps a patch that is being sent", async () => {
    const main = mainProcess();
    const { state } = pauseResume({ client: main.client });

    state.start("schedule-resume", SCHEDULE, false);
    const asking = state.review();

    main.confirms[0].answer(confirmed("token-1", resumeText(false)));
    await asking;
    state.choose(true);
    expect([state.step, state.skip]).toEqual([{ state: "form" }, true]);
    const again = state.review();

    main.confirms[1].answer(confirmed("token-2", resumeText(true)));
    await again;
    const running = state.run();

    state.choose(false);
    expect(state.step).toEqual({ state: "running", request: "request-1" });
    main.runs[0].answer({ ok: true, value: { ...PAUSED, paused: false, skipImmediately: true } });
    await running;
    expect(state.step).toMatchObject({ state: "done" });
  });

  it("sends the patch with the token of its review and the identifier of the run, and ends with the schedule read after it", async () => {
    const main = mainProcess();
    const { state, refusals } = pauseResume({ client: main.client });

    state.start("schedule-pause", SCHEDULE, undefined);
    const asking = state.review();

    main.confirms[0].answer(confirmed("token-1", PAUSE));
    await asking;
    const running = state.run();

    expect(state.step).toEqual({ state: "running", request: "request-1" });
    expect(state.busy).toBe(true);
    main.runs[0].answer({ ok: true, value: PAUSED });
    await running;
    expect(main.runs[0].args).toEqual([
      "cluster-a",
      "velero",
      "schedule-pause",
      { name: "nightly", uid: "nightly-uid" },
      "token-1",
      "request-1",
    ]);
    expect(state.step).toEqual({ state: "done", changed: PAUSED, request: "request-1" });
    expect(refusals).toEqual([]);
  });

  it("ends a run that failed with whether the patch may be there, and asks the gate again", async () => {
    const main = mainProcess();
    const { state, refusals } = pauseResume({ client: main.client });

    for (const [answer, left] of [
      [failure("conflict", "patch"), "none"],
      [failure("submission-unknown", "patch"), "unknown"],
      [failure("request-failed", "way"), "unknown"],
    ] as const) {
      state.start("schedule-pause", SCHEDULE, undefined);
      const asking = state.review();

      main.confirms.at(-1)?.answer(confirmed("token", PAUSE));
      await asking;
      const running = state.run();

      main.runs.at(-1)?.answer(answer);
      await running;
      expect(state.step).toEqual({ state: "failed", failure: answer, left, request: `request-${refusals.length}` });
    }
    expect(refusals).toHaveLength(3);
  });

  it("asks a token that expired again once, sends with the new one for the same text, and shows another text as a new review", async () => {
    const main = mainProcess();
    const { state, clock } = pauseResume({ client: main.client });

    state.start("schedule-pause", SCHEDULE, undefined);
    let asking = state.review();

    main.confirms[0].answer(confirmed("token-1", PAUSE));
    await asking;
    clock.now = NOW + 30_000;
    let running = state.run();

    main.confirms[1].answer(confirmed("token-2", PAUSE, NOW + 60_000));
    await turn();
    main.runs[0].answer({ ok: true, value: PAUSED });
    await running;
    expect(main.runs[0].args[4]).toBe("token-2");
    expect(state.step).toMatchObject({ state: "done" });
    // The same patch written another way is another text: a new review, and nothing sent.
    state.start("schedule-pause", SCHEDULE, undefined);
    asking = state.review();
    main.confirms[2].answer(confirmed("token-3", PAUSE, NOW + 30_000));
    await asking;
    clock.now = NOW + 31_000;
    running = state.run();
    main.confirms[3].answer(confirmed("token-4", JSON.stringify(pausePatch("nightly-uid")), NOW + 61_000));
    await running;
    expect(state.step).toEqual({
      state: "reviewing",
      token: "token-4",
      expires: NOW + 61_000,
      text: JSON.stringify(pausePatch("nightly-uid")),
      replaced: true,
    });
    expect(main.runs).toHaveLength(1);
    // A renewal of an installation that changed meanwhile is not taken, and nothing is sent.
    state.start("schedule-pause", SCHEDULE, undefined);
    asking = state.review();
    main.confirms.at(-1)?.answer(confirmed("token", PAUSE, NOW));
    await asking;
    running = state.run();
    state.drop();
    main.confirms.at(-1)?.answer(confirmed("token-renewed", PAUSE, NOW + 60_000));
    await running;
    expect([state.step, main.runs]).toEqual([{ state: "form" }, [expect.anything()]]);
    // A renewal refused, or answered with a text that is not the patch asked, sends nothing.
    for (const answer of [failure("forbidden", "gate"), confirmed("token-5", resumeText(true))]) {
      state.start("schedule-pause", SCHEDULE, undefined);
      asking = state.review();
      main.confirms.at(-1)?.answer(confirmed("token", PAUSE, NOW));
      await asking;
      running = state.run();
      main.confirms.at(-1)?.answer(answer);
      await running;
      expect(state.step).toMatchObject({ state: "failed", left: "none" });
    }
    expect(main.runs).toHaveLength(1);
  });

  it("takes nothing that arrives for a step that was left, writes that went off, or an installation that changed", async () => {
    const main = mainProcess();
    const { state, writes } = pauseResume({ client: main.client });

    state.start("schedule-pause", SCHEDULE, undefined);
    let asking = state.review();

    state.leave();
    main.confirms[0].answer(confirmed("token-1", PAUSE));
    await asking;
    expect(state.step).toEqual({ state: "form" });
    asking = state.review();
    main.confirms[1].answer(confirmed("token-2", PAUSE));
    await asking;
    state.leave();
    expect(state.step).toEqual({ state: "form" });
    // A review with writes turned off since is not sent.
    asking = state.review();
    main.confirms[2].answer(confirmed("token-3", PAUSE));
    await asking;
    writes.on = false;
    await state.run();
    expect(main.runs).toHaveLength(0);
    writes.on = true;
    // A patch that is being sent is not left: the main process says how it ended.
    const running = state.run();

    state.leave();
    state.start("schedule-resume", SCHEDULE, true);
    expect(state.step).toEqual({ state: "running", request: "request-1" });
    expect(state.action).toBe("schedule-pause");
    main.runs[0].answer({ ok: true, value: PAUSED });
    await running;
    expect(state.step).toMatchObject({ state: "done" });
    // An installation that changed drops the form, the choice with it, and takes nothing of a patch sent for it.
    state.start("schedule-resume", SCHEDULE, true);
    asking = state.review();
    main.confirms[3].answer(confirmed("token-4", resumeText(true)));
    await asking;
    const dropped = state.run();

    state.drop();
    main.runs[1].answer({ ok: true, value: { ...PAUSED, paused: false, skipImmediately: true } });
    await dropped;
    expect([state.step, state.action, state.schedule, state.skip]).toEqual([
      { state: "form" },
      undefined,
      undefined,
      false,
    ]);
  });

  it("tells the main process an end a view showed, except one whose answer was not known", async () => {
    const main = mainProcess();
    const { state, shown } = pauseResume({ client: main.client });
    const ending = async (answer: Answer<ScheduleChanged>) => {
      state.start("schedule-pause", SCHEDULE, undefined);
      const asking = state.review();

      main.confirms.at(-1)?.answer(confirmed("token", PAUSE));
      await asking;
      const running = state.run();

      main.runs.at(-1)?.answer(answer);
      await running;
    };

    await ending({ ok: true, value: PAUSED });
    state.see();
    await ending(failure("conflict", "patch"));
    state.see();
    for (const stage of ["way", "answer", "handler"]) {
      await ending(failure("request-failed", stage));
      state.see();
    }
    expect(shown).toEqual(["request-1", "request-2"]);
    // A view that shows the form tells nothing.
    state.start("schedule-pause", SCHEDULE, undefined);
    state.see();
    expect(shown).toHaveLength(2);
  });
});
