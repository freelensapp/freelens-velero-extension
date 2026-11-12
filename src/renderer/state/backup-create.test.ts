import { describe, expect, it } from "vitest";
import { backupFromForm, formBodyText } from "../../common/backup-form";
import { BackupCreate } from "./backup-create";

import type { BackupTemplate } from "../../common/backup-template";
import type { BackupCreated, Answer as IpcAnswer, WriteConfirmAnswer } from "../../common/ipc";

const NOW = Date.UTC(2026, 10, 8, 11, 0, 0);

function textOf(name: string, template: BackupTemplate): string {
  const body = backupFromForm("velero", name, template);

  if (!body) throw new Error("The template of the test is refused");
  return formBodyText(body);
}

// A backup of the form, with a main process that answers what the test gives it, at once.
function made(answers: { confirm?: IpcAnswer<WriteConfirmAnswer>[]; run?: IpcAnswer<BackupCreated>[] } = {}) {
  const asked = { confirm: [] as unknown[][], run: [] as unknown[][], refused: 0, shown: [] as string[] };
  let now = NOW;
  let writes = true;
  const state = new BackupCreate({
    client: {
      confirmBackupCreate: async (...args) => {
        asked.confirm.push(args);
        return (
          answers.confirm?.shift() ?? { ok: false, code: "request-failed", stage: "request", retry: false, text: "No." }
        );
      },
      runBackupCreate: async (...args) => {
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
    requestId: () => "00000000-0000-4000-8000-000000000001",
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

describe("a backup of the form, in the views", () => {
  it("leaves out a field set to nothing, and an empty list, and drops a review when a field changes", async () => {
    const { state } = made({ confirm: [confirmed(textOf("shop", { storageLocation: "default" }))] });

    state.set("storageLocation", "default");
    state.set("includedNamespaces", ["shop"]);
    state.set("includedNamespaces", []);
    state.set("ttl", "48h");
    state.set("ttl", undefined);
    expect(state.template).toEqual({ storageLocation: "default" });
    state.type("shop");
    await state.review();
    expect(state.step.state).toBe("reviewing");
    state.set("snapshotVolumes", false);
    expect(state.step).toEqual({ state: "form" });
  });

  it("asks for no review with writes off, a name or a template refused, or what the workspace holds it back for", async () => {
    const { state, asked, writesOff } = made();

    state.set("storageLocation", "default");
    state.type("Shop");
    await state.review();
    state.type("shop");
    state.set("excludedNamespaces", ["*"]);
    await state.review();
    state.set("excludedNamespaces", undefined);
    await state.review(["The host lists legacy with the label velero.io/exclude-from-backup=true."]);
    writesOff();
    await state.review();
    expect(asked.confirm).toEqual([]);
    expect(state.step).toEqual({ state: "form" });
  });

  it("asks the main process with the name and the fields set, and takes no text that is not a backup of the form", async () => {
    const { state, asked } = made({ confirm: [confirmed('{"kind":"Restore"}')] });

    state.set("storageLocation", "default");
    state.type("shop");
    await state.review();
    expect(asked.confirm).toEqual([["cluster-a", "velero", "shop", { storageLocation: "default" }]]);
    expect(state.step).toMatchObject({ state: "failed", failure: { code: "validation", stage: "review" } });
  });

  it("creates the backup with the token of its review, and says the end it showed to the main process", async () => {
    const text = textOf("shop", { storageLocation: "default" });
    const { state, asked } = made({
      confirm: [confirmed(text)],
      run: [{ ok: true, value: { name: "shop", uid: "u", phase: "Queued", position: 1 } }],
    });

    state.set("storageLocation", "default");
    state.type("shop");
    await state.review();
    await state.create();
    expect(asked.run).toEqual([
      ["cluster-a", "velero", "shop", `token-${text.length}`, "00000000-0000-4000-8000-000000000001"],
    ]);
    expect(state.step).toEqual({
      state: "created",
      backup: { name: "shop", uid: "u", phase: "Queued", position: 1 },
      request: "00000000-0000-4000-8000-000000000001",
    });
    state.see();
    expect(asked.shown).toEqual(["00000000-0000-4000-8000-000000000001"]);
  });

  it("asks a token that expired again, and shows a new review in place of the old one when the text changed, sending nothing", async () => {
    const before = textOf("shop", { storageLocation: "default" });
    const after = textOf("shop", { storageLocation: "default", ttl: "1h" });
    const { state, asked, later } = made({ confirm: [confirmed(before), confirmed(after, NOW + 90_000)] });

    state.set("storageLocation", "default");
    state.type("shop");
    await state.review();
    later(31_000);
    await state.create();
    expect(asked.run).toEqual([]);
    expect(state.step).toMatchObject({ state: "reviewing", text: after, replaced: true });
  });

  it("keeps the name of a conflict, and says a backup that may be there when its answer was lost", async () => {
    const text = textOf("taken", { storageLocation: "default" });
    const { state, asked } = made({
      confirm: [confirmed(text), confirmed(text)],
      run: [
        { ok: false, code: "conflict", stage: "creation", retry: false, text: "Taken." },
        { ok: false, code: "submission-unknown", stage: "creation", retry: false, text: "Not known." },
      ],
    });

    state.set("storageLocation", "default");
    state.type("taken");
    await state.review();
    await state.create();
    expect(state.name).toBe("taken");
    expect(state.step).toMatchObject({ state: "failed", left: "none", name: "taken" });
    await state.review();
    await state.create();
    expect(state.step).toMatchObject({ state: "failed", left: "unknown" });
    expect(asked.refused).toBe(2);
  });

  it("gives a new form from the command once the backup before was created, and keeps a form being filled, one that failed and a backup being created", async () => {
    const text = textOf("shop", { storageLocation: "default", ttl: "1h" });
    const { state } = made({
      confirm: [confirmed(text), confirmed(text)],
      run: [
        { ok: false, code: "conflict", stage: "creation", retry: false, text: "Taken." },
        { ok: true, value: { name: "shop", uid: "u" } },
      ],
    });

    state.set("storageLocation", "default");
    state.set("ttl", "1h");
    state.type("shop");
    state.start();
    expect([state.step, state.name, state.template]).toEqual([
      { state: "form" },
      "shop",
      { storageLocation: "default", ttl: "1h" },
    ]);
    await state.review();
    await state.create();
    state.start();
    expect([state.step, state.name]).toEqual([expect.objectContaining({ state: "failed", name: "shop" }), "shop"]);
    await state.review();
    const creating = state.create();

    state.start();
    expect(state.step.state).toBe("running");
    await creating;
    expect(state.step.state).toBe("created");
    state.see();
    state.start();
    expect([state.step, state.name, state.template]).toEqual([{ state: "form" }, "", {}]);
  });

  it("takes no answer once the step that asked it moved on: a review left, a run and a renewal of the installation before", async () => {
    const held: { resolve: (answer: IpcAnswer<WriteConfirmAnswer> | IpcAnswer<BackupCreated>) => void }[] = [];
    const hold = <Value>() =>
      new Promise<Value>((resolve) => held.push({ resolve: resolve as (answer: unknown) => void }));
    let now = NOW;
    const state = new BackupCreate({
      client: { confirmBackupCreate: () => hold(), runBackupCreate: () => hold() },
      cluster: () => "cluster-a",
      namespace: () => "velero",
      writesOn: () => true,
      now: () => now,
      requestId: () => "00000000-0000-4000-8000-000000000001",
      refused: () => undefined,
    });
    const text = textOf("shop", { storageLocation: "default" });

    state.set("storageLocation", "default");
    state.type("shop");
    // A review asked, then left: its answer, which comes after, is not taken.
    const asked = state.review();

    expect(state.step).toEqual({ state: "asking" });
    state.leave();
    expect(state.step).toEqual({ state: "form" });
    held[0].resolve(confirmed(text));
    await asked;
    expect(state.step).toEqual({ state: "form" });
    // A run asked, then the installation changed: its answer is not taken.
    const reviewed = state.review();

    held[1].resolve(confirmed(text));
    await reviewed;
    const creating = state.create();

    expect(state.step.state).toBe("running");
    state.drop();
    held[2].resolve({ ok: true, value: { name: "shop", uid: "u" } });
    await creating;
    expect(state.step).toEqual({ state: "form" });
    // A token renewed, then the installation changed: the renewal is not taken, and nothing is run.
    state.set("storageLocation", "default");
    state.type("shop");
    const again = state.review();

    held[3].resolve(confirmed(text));
    await again;
    now += 31_000;
    const renewing = state.create();

    state.drop();
    held[4].resolve(confirmed(text, now + 30_000));
    await renewing;
    expect(state.step).toEqual({ state: "form" });
    expect(held).toHaveLength(5);
  });

  it("goes on with the renewed token when the text is the same, and asks nothing from a step that is not the form", async () => {
    const text = textOf("shop", { storageLocation: "default" });
    const renewed = { ok: true as const, value: { token: "renewed-token", expires: NOW + 90_000, text } };
    const { state, asked, later } = made({
      confirm: [confirmed(text), renewed],
      run: [{ ok: true, value: { name: "shop", uid: "u" } }],
    });

    state.set("storageLocation", "default");
    state.type("shop");
    await state.review();
    // A review shown is not asked again.
    await state.review();
    expect(asked.confirm).toHaveLength(1);
    later(31_000);
    await state.create();
    expect(asked.run).toEqual([
      ["cluster-a", "velero", "shop", "renewed-token", "00000000-0000-4000-8000-000000000001"],
    ]);
  });

  it("creates nothing with writes off, takes a failed step back to the form at a change of a field, and says only a failure that is the end of a run", async () => {
    const text = textOf("shop", { storageLocation: "default" });
    const { state, asked } = made({
      confirm: [confirmed(text), confirmed(text)],
      run: [
        { ok: false, code: "conflict", stage: "creation", retry: false, text: "Taken." },
        { ok: false, code: "request-failed", stage: "answer", retry: false, text: "Not understood." },
      ],
    });

    state.set("storageLocation", "default");
    state.type("shop");
    await state.review();
    await state.create();
    expect(state.step).toMatchObject({ state: "failed" });
    // The end of a run that failed is told to the main process when a view showed it.
    state.see();
    expect(asked.shown).toEqual(["00000000-0000-4000-8000-000000000001"]);
    state.set("ttl", "1h");
    expect(state.step).toEqual({ state: "form" });
    state.set("ttl", undefined);
    await state.review();
    await state.create();
    // A failure whose answer the views did not understand is not the end the main process keeps: it is not told.
    state.see();
    expect(asked.shown).toEqual(["00000000-0000-4000-8000-000000000001"]);
    // With writes off nothing is created from a review.
    const off = made({ confirm: [confirmed(text)] });

    off.state.set("storageLocation", "default");
    off.state.type("shop");
    await off.state.review();
    off.writesOff();
    await off.state.create();
    expect(off.asked.run).toEqual([]);
    expect(off.state.step.state).toBe("reviewing");
  });

  it("drops what was typed when the installation changes", async () => {
    const { state } = made({
      confirm: [confirmed(textOf("shop", { storageLocation: "default" }))],
      run: [{ ok: true, value: { name: "shop", uid: "u" } }],
    });

    state.set("storageLocation", "default");
    state.type("shop");
    await state.review();
    await state.create();
    state.drop();
    expect([state.step, state.name, state.template]).toEqual([{ state: "form" }, "", {}]);
  });
});
