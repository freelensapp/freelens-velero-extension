import { describe, expect, it } from "vitest";
import { SCHEDULE_CREATE_VIEW_WORDS } from "../../common/schedule-create-words";
import { SCHEDULE_FORM_WORDS, scheduleBodyText, scheduleFromForm } from "../../common/schedule-form";
import { ScheduleCreate } from "./schedule-create";

import type { BackupTemplate } from "../../common/backup-template";
import type { Answer as IpcAnswer, ScheduleCreated, WriteConfirmAnswer } from "../../common/ipc";
import type { ScheduleWrapper } from "../../common/schedule-form";

const NOW = Date.UTC(2026, 10, 8, 12, 0, 0);
const WRAPPER: ScheduleWrapper = {
  expression: "CRON_TZ=Europe/Rome 0 3 * * *",
  paused: false,
  skipImmediately: false,
  useOwnerReferencesInBackup: false,
};
const REQUEST = "00000000-0000-4000-8000-000000000001";

function textOf(name: string, wrapper: ScheduleWrapper, template: BackupTemplate): string {
  const body = scheduleFromForm("velero", name, wrapper, template, NOW);

  if (!body) throw new Error("The form of the test is refused");
  return scheduleBodyText(body);
}

// A schedule of the form, with a main process that answers what the test gives it, at once.
function made(answers: { confirm?: IpcAnswer<WriteConfirmAnswer>[]; run?: IpcAnswer<ScheduleCreated>[] } = {}) {
  const asked = { confirm: [] as unknown[][], run: [] as unknown[][], refused: 0, shown: [] as string[] };
  let now = NOW;
  let writes = true;
  const state = new ScheduleCreate({
    client: {
      confirmScheduleCreate: async (...args) => {
        asked.confirm.push(args);
        return (
          answers.confirm?.shift() ?? { ok: false, code: "request-failed", stage: "request", retry: false, text: "No." }
        );
      },
      runScheduleCreate: async (...args) => {
        asked.run.push(args);
        return (
          answers.run?.shift() ?? { ok: false, code: "request-failed", stage: "request", retry: false, text: "No." }
        );
      },
    },
    cluster: () => "cluster-a",
    namespace: () => "velero",
    writesOn: () => writes,
    now: () => now,
    requestId: () => REQUEST,
    refused: () => {
      asked.refused += 1;
    },
    shown: (request) => asked.shown.push(request),
  });

  return {
    state,
    asked,
    later: (milliseconds: number) => {
      now += milliseconds;
    },
    writesOff: () => {
      writes = false;
    },
  };
}

const confirmed = (text: string, expires = NOW + 30_000): IpcAnswer<WriteConfirmAnswer> => ({
  ok: true,
  value: { token: `token-${text.length}`, expires, text },
});

function filled(state: ScheduleCreate, wrapper: ScheduleWrapper = WRAPPER) {
  state.type("nightly-shop");
  state.write(wrapper.expression);
  for (const flag of ["paused", "skipImmediately", "useOwnerReferencesInBackup"] as const)
    state.flag(flag, wrapper[flag]);
  state.set("storageLocation", "default");
}

describe("a schedule of the form, in the views", () => {
  it("writes the three flags false unless chosen, and says what is wrong of the name and of the expression", () => {
    const { state } = made();

    expect(state.wrapper).toEqual({
      expression: "",
      paused: false,
      skipImmediately: false,
      useOwnerReferencesInBackup: false,
    });
    expect(state.expressionWords).toBeUndefined();
    state.type("a".repeat(64));
    expect(state.nameProblem).toBe(SCHEDULE_FORM_WORDS.nameLong(64));
    // The words of the controller for an expression its parser refuses, said as Velero's, and the ones of the main
    // process for one Velero would take, an expression with no instant or with a character that is not printable.
    state.write("0 3 * *");
    expect(state.expressionWords).toBe(
      SCHEDULE_CREATE_VIEW_WORDS.expressionRefused("invalid schedule: expected exactly 5 fields, found 4: [0 3 * *]"),
    );
    state.write("CRON_TZ=europe/rome 0 3 * * *");
    expect(state.expressionWords).toBe(
      SCHEDULE_CREATE_VIEW_WORDS.expressionRefused(
        'invalid schedule: unknown time zone "europe/rome": unknown time zone europe/rome',
      ),
    );
    state.write("@none");
    expect(state.expressionWords).toBe(SCHEDULE_FORM_WORDS.noInstant);
    state.write("0 3\t* * *");
    expect(state.expressionWords).toBe(SCHEDULE_FORM_WORDS.expressionNotPrintable);
    state.write("0 3 * * *");
    expect(state.expressionWords).toBeUndefined();
  });

  it("asks for no review with writes off, a name, an expression or a template refused, or what the workspace holds it back for", async () => {
    const { state, asked, writesOff } = made();

    filled(state, { ...WRAPPER, expression: "" });
    await state.review();
    state.write("0 3 * *");
    await state.review();
    state.write(WRAPPER.expression);
    state.type("Nightly");
    await state.review();
    state.type("nightly-shop");
    state.set("excludedNamespaces", ["*"]);
    await state.review();
    state.set("excludedNamespaces", undefined);
    await state.review(["The storage locations of this installation cannot be read."]);
    writesOff();
    await state.review();
    expect(asked.confirm).toEqual([]);
    expect(state.step).toEqual({ state: "form" });
  });

  it("asks the main process with the name, the wrapper and the fields set, and takes no text that is not a schedule of the form", async () => {
    const { state, asked } = made({ confirm: [confirmed('{"kind":"Backup","metadata":{},"spec":{}}')] });

    filled(state);
    await state.review();
    expect(asked.confirm).toEqual([["cluster-a", "velero", "nightly-shop", WRAPPER, { storageLocation: "default" }]]);
    expect(state.step).toMatchObject({ state: "failed", failure: { code: "validation", stage: "review" } });
  });

  it("creates the schedule with the token of its review, says it paused when it is, and the end it showed to the main process", async () => {
    const wrapper = { ...WRAPPER, paused: true, skipImmediately: true };
    const text = textOf("nightly-shop", wrapper, { storageLocation: "default" });
    const { state, asked } = made({
      confirm: [confirmed(text)],
      run: [{ ok: true, value: { name: "nightly-shop", uid: "u", paused: true } }],
    });

    filled(state, wrapper);
    await state.review();
    const creating = state.create();

    expect(state.step).toMatchObject({ state: "running", name: "nightly-shop", paused: true });
    await creating;
    expect(asked.run).toEqual([["cluster-a", "velero", "nightly-shop", `token-${text.length}`, REQUEST]]);
    expect(state.step).toEqual({
      state: "created",
      schedule: { name: "nightly-shop", uid: "u", paused: true },
      request: REQUEST,
    });
    state.see();
    expect(asked.shown).toEqual([REQUEST]);
  });

  it("drops a review when a field, the expression or a flag changes, and asks a token that expired again for the same text", async () => {
    const text = textOf("nightly-shop", WRAPPER, { storageLocation: "default" });
    const { state, asked, later } = made({
      confirm: [confirmed(text), confirmed(text), confirmed(text), confirmed(text, NOW + 90_000)],
      run: [{ ok: true, value: { name: "nightly-shop", uid: "u", phase: "Enabled" } }],
    });

    filled(state);
    await state.review();
    state.flag("paused", true);
    expect(state.step).toEqual({ state: "form" });
    state.flag("paused", false);
    await state.review();
    state.write("CRON_TZ=Europe/Rome 0 4 * * *");
    expect(state.step).toEqual({ state: "form" });
    state.write(WRAPPER.expression);
    await state.review();
    later(31_000);
    await state.create();
    expect(asked.confirm).toHaveLength(4);
    expect(asked.run).toEqual([["cluster-a", "velero", "nightly-shop", `token-${text.length}`, REQUEST]]);
    expect(state.step).toMatchObject({ state: "created", schedule: { phase: "Enabled" } });
  });

  it("keeps what was typed after a conflict, says a schedule that may be there, and gives a new form from the command once one was created", async () => {
    const text = textOf("nightly-shop", WRAPPER, { storageLocation: "default" });
    const { state } = made({
      confirm: [confirmed(text), confirmed(text), confirmed(text)],
      run: [
        { ok: false, code: "conflict", stage: "creation", retry: false, text: "Taken." },
        { ok: false, code: "submission-unknown", stage: "creation", retry: false, text: "Not known." },
        { ok: true, value: { name: "nightly-shop", uid: "u" } },
      ],
    });

    filled(state);
    await state.review();
    await state.create();
    expect(state.step).toMatchObject({ state: "failed", left: "none", name: "nightly-shop" });
    state.start();
    expect([state.name, state.wrapper, state.template]).toEqual([
      "nightly-shop",
      WRAPPER,
      { storageLocation: "default" },
    ]);
    await state.review();
    await state.create();
    expect(state.step).toMatchObject({ state: "failed", left: "unknown" });
    await state.review();
    await state.create();
    expect(state.step.state).toBe("created");
    state.start();
    expect([state.step, state.name, state.wrapper.expression, state.template]).toEqual([{ state: "form" }, "", "", {}]);
  });

  it("drops what was typed when the installation changes, and takes no answer of a step that moved on", async () => {
    const held: { resolve: (answer: unknown) => void }[] = [];
    const hold = <Value>() =>
      new Promise<Value>((resolve) => held.push({ resolve: resolve as (answer: unknown) => void }));
    const state = new ScheduleCreate({
      client: { confirmScheduleCreate: () => hold(), runScheduleCreate: () => hold() },
      cluster: () => "cluster-a",
      namespace: () => "velero",
      writesOn: () => true,
      now: () => NOW,
      requestId: () => REQUEST,
      refused: () => undefined,
    });
    const text = textOf("nightly-shop", WRAPPER, { storageLocation: "default" });

    filled(state);
    const asked = state.review();

    state.leave();
    held[0].resolve(confirmed(text));
    await asked;
    expect(state.step).toEqual({ state: "form" });
    const reviewed = state.review();

    held[1].resolve(confirmed(text));
    await reviewed;
    const creating = state.create();

    state.drop();
    held[2].resolve({ ok: true, value: { name: "nightly-shop", uid: "u" } });
    await creating;
    expect([state.step, state.name, state.wrapper.expression, state.template]).toEqual([{ state: "form" }, "", "", {}]);
  });
});

describe("what a schedule of the form drops, renews and tells the main process", () => {
  const renewed = (text: string, token: string, expires = NOW + 90_000): IpcAnswer<WriteConfirmAnswer> => ({
    ok: true,
    value: { token, expires, text },
  });
  const TEMPLATE = { storageLocation: "default" };

  it("drops a review when the name or a field of the template changes", async () => {
    const text = textOf("nightly-shop", WRAPPER, TEMPLATE);
    const { state } = made({ confirm: [confirmed(text), confirmed(text)] });

    filled(state);
    await state.review();
    expect(state.step.state).toBe("reviewing");
    state.type("nightly-shop-2");
    expect(state.step).toEqual({ state: "form" });
    state.type("nightly-shop");
    await state.review();
    expect(state.step.state).toBe("reviewing");
    state.set("ttl", "72h");
    expect(state.step).toEqual({ state: "form" });
  });

  it("runs an expired review with the token asked again for the same text, with the same form", async () => {
    const text = textOf("nightly-shop", WRAPPER, TEMPLATE);
    const { state, asked, later } = made({
      confirm: [renewed(text, "token-first", NOW + 30_000), renewed(text, "token-renewed")],
      run: [{ ok: true, value: { name: "nightly-shop", uid: "u", phase: "Enabled" } }],
    });

    filled(state);
    await state.review();
    later(31_000);
    await state.create();
    expect(asked.confirm).toEqual([
      ["cluster-a", "velero", "nightly-shop", WRAPPER, TEMPLATE],
      ["cluster-a", "velero", "nightly-shop", WRAPPER, TEMPLATE],
    ]);
    expect(asked.run).toEqual([["cluster-a", "velero", "nightly-shop", "token-renewed", REQUEST]]);
    expect(state.step.state).toBe("created");
  });

  it("shows another text asked again in place of the review, and sends nothing; a renewal with no text or refused ends it", async () => {
    const text = textOf("nightly-shop", WRAPPER, TEMPLATE);
    const other = textOf("nightly-shop", { ...WRAPPER, expression: "CRON_TZ=Europe/Rome 0 4 * * *" }, TEMPLATE);
    const { state, asked, later } = made({
      confirm: [
        renewed(text, "token-first", NOW + 30_000),
        renewed(other, "token-other"),
        renewed(text, "token-third", NOW + 120_000),
        renewed("", "token-empty"),
        renewed(text, "token-fifth", NOW + 300_000),
        renewed('{"kind":"Backup","metadata":{},"spec":{}}', "token-backup"),
        renewed(text, "token-seventh", NOW + 600_000),
        { ok: false, code: "forbidden", stage: "gate", retry: false, text: "Writes are off." },
      ],
    });

    filled(state);
    await state.review();
    later(31_000);
    await state.create();
    expect(state.step).toEqual({
      state: "reviewing",
      token: "token-other",
      expires: NOW + 90_000,
      text: other,
      name: "nightly-shop",
      replaced: true,
    });
    state.leave();
    await state.review();
    later(120_000);
    await state.create();
    expect(state.step).toMatchObject({ state: "failed", failure: { code: "validation", stage: "review" } });
    // A text that is not the one of a schedule of the form is not one either.
    await state.review();
    later(300_000);
    await state.create();
    expect(state.step).toMatchObject({ state: "failed", failure: { code: "validation", stage: "review" } });
    await state.review();
    later(600_000);
    await state.create();
    expect(state.step).toMatchObject({ state: "failed", failure: { code: "forbidden", stage: "gate" } });
    expect(asked.run).toEqual([]);
    expect(asked.refused).toBe(1);
  });

  it("takes no renewal of a step that moved on, asks for a review only from the form, and creates nothing with writes off", async () => {
    const held: { resolve: (answer: unknown) => void }[] = [];
    const hold = <Value>() =>
      new Promise<Value>((resolve) => held.push({ resolve: resolve as (answer: unknown) => void }));
    let now = NOW;
    let writes = true;
    const runs: unknown[] = [];
    const state = new ScheduleCreate({
      client: {
        confirmScheduleCreate: () => hold(),
        runScheduleCreate: async (...args) => {
          runs.push(args);
          return { ok: true, value: { name: "nightly-shop", uid: "u" } };
        },
      },
      cluster: () => "cluster-a",
      namespace: () => "velero",
      writesOn: () => writes,
      now: () => now,
      requestId: () => REQUEST,
      refused: () => undefined,
    });
    const text = textOf("nightly-shop", WRAPPER, TEMPLATE);

    filled(state);
    const reviewed = state.review();

    // A second review while one is asked asks nothing.
    await state.review();
    expect(held).toHaveLength(1);
    held[0].resolve(renewed(text, "token-first", NOW + 30_000));
    await reviewed;
    // A review shown is not asked again.
    await state.review();
    expect(held).toHaveLength(1);
    now += 31_000;
    const creating = state.create();

    expect(held).toHaveLength(2);
    // The installation changed while the token was asked again: its answer is not taken, and nothing is sent.
    state.drop();
    held[1].resolve(renewed(text, "token-renewed"));
    await creating;
    expect([state.step, runs]).toEqual([{ state: "form" }, []]);
    filled(state);
    const again = state.review();

    held[2].resolve(renewed(text, "token-third", now + 30_000));
    await again;
    writes = false;
    await state.create();
    expect(runs).toEqual([]);
    expect(state.step.state).toBe("reviewing");
  });

  it("tells the main process an end a view showed, and not the one of a write whose end is not known", async () => {
    const text = textOf("nightly-shop", WRAPPER, TEMPLATE);
    const { state, asked } = made({
      confirm: [confirmed(text), confirmed(text)],
      run: [
        { ok: false, code: "submission-unknown", stage: "answer", retry: false, text: "No answer was read." },
        { ok: false, code: "conflict", stage: "creation", retry: false, text: "Taken." },
      ],
    });

    filled(state);
    await state.review();
    await state.create();
    state.see();
    expect(asked.shown).toEqual([]);
    await state.review();
    await state.create();
    state.see();
    expect(asked.shown).toEqual([REQUEST]);
    expect(asked.refused).toBe(2);
  });
});
