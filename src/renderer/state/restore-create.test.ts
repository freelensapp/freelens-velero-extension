import { describe, expect, it } from "vitest";
import { RESTORE_WORDS, type RestoreForm, restoreBodyText, restoreFromForm } from "../../common/restore-form";
import { RestoreCreate } from "./restore-create";

import type { Answer as IpcAnswer, RestoreCreated, WriteConfirmAnswer } from "../../common/ipc";
import type { RestoreBackup } from "./restore-create";

// Sunday 8 November 2026, 12:00:05 UTC.
const NOW = Date.UTC(2026, 10, 8, 12, 0, 5);
const REQUEST = "00000000-0000-4000-8000-000000000001";
const NIGHTLY: RestoreBackup = {
  name: "nightly",
  uid: "nightly-uid",
  namespaces: { includedNamespaces: ["shop", "web-*"], excludedNamespaces: ["web-test"] },
};
const WEEKLY: RestoreBackup = { name: "weekly", uid: "weekly-uid", namespaces: {} };
const TARGET = { kind: "Backup" as const, name: "nightly", uid: "nightly-uid" };
const FORM: RestoreForm = { clusterResources: "none", existingResourcePolicy: "none" };

function textOf(name: string, form: RestoreForm = FORM, backup = NIGHTLY): string {
  const body = restoreFromForm("velero", name, backup.name, form, backup.namespaces);

  if (!body) throw new Error("The form of the test is refused");
  return restoreBodyText(body);
}

// A restore of the form, with a main process that answers what the test gives it, at once.
function made(answers: { confirm?: IpcAnswer<WriteConfirmAnswer>[]; run?: IpcAnswer<RestoreCreated>[] } = {}) {
  const asked = { confirm: [] as unknown[][], run: [] as unknown[][], refused: 0, shown: [] as string[] };
  let now = NOW;
  let writes = true;
  const state = new RestoreCreate({
    client: {
      confirmRestoreCreate: async (...args) => {
        asked.confirm.push(args);
        return (
          answers.confirm?.shift() ?? { ok: false, code: "request-failed", stage: "request", retry: false, text: "No." }
        );
      },
      runRestoreCreate: async (...args) => {
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

const confirmed = (text: string, token = "token-first", expires = NOW + 30_000): IpcAnswer<WriteConfirmAnswer> => ({
  ok: true,
  value: { token, expires, text },
});

// A form of the backup nightly with the cluster-scoped resources chosen, as the operator fills it.
function filled(state: RestoreCreate) {
  state.start({ kind: "backup", name: "nightly" }, NIGHTLY);
  state.set("clusterResources", "none");
}

describe("a restore of the form, in the views", () => {
  it("proposes the name of the command line, in UTC, keeps the one typed, and proposes it again for another backup", () => {
    const { state, later } = made();

    state.start({ kind: "schedule", name: "nightly" }, NIGHTLY);
    expect([state.name, state.proposed]).toEqual(["nightly-20261108120005", true]);
    later(60_000);
    state.choose(WEEKLY);
    expect(state.name).toBe("weekly-20261108120105");
    state.type("my-restore");
    state.choose(NIGHTLY);
    expect([state.name, state.proposed, state.backup]).toEqual(["my-restore", false, NIGHTLY]);
    // The policy is none until another is chosen, and the cluster-scoped resources are not chosen.
    expect(state.form).toEqual({ existingResourcePolicy: "none" });
    expect(state.problems).toEqual({ clusterResources: [RESTORE_WORDS.noClusterResources] });
  });

  it("checks the form against the namespaces of the backup, and keeps the warnings of a backup of every namespace", () => {
    const { state } = made();

    filled(state);
    state.set("namespaceMapping", [["web-test", "web-2"]]);
    expect(state.problems).toEqual({ namespaceMapping: [RESTORE_WORDS.usedForNothing("web-test")] });
    state.choose(WEEKLY);
    expect([state.problems, state.warnings]).toEqual([{}, [RESTORE_WORDS.everyNamespace("web-test")]]);
    // The policy is always written: emptied, it stays as it was.
    state.set("existingResourcePolicy", undefined);
    expect(state.form.existingResourcePolicy).toBe("none");
  });

  it("asks for no review with writes off, no backup, a name or a form refused, or what the workspace holds it back for", async () => {
    const { state, asked, writesOff } = made();

    state.start({ kind: "schedule", name: "nightly" }, undefined);
    state.set("clusterResources", "none");
    await state.review();
    state.choose(NIGHTLY);
    state.type("Nightly");
    await state.review();
    state.type("nightly-restore");
    state.set("includedResources", ["nodes"]);
    await state.review();
    state.set("includedResources", undefined);
    await state.review(["The backup is InProgress."]);
    writesOff();
    await state.review();
    expect(asked.confirm).toEqual([]);
    expect(state.step).toEqual({ state: "form" });
  });

  it("asks the main process with the backup, the name and the form, and creates the restore only once the name of the backup is typed", async () => {
    const text = textOf("nightly-20261108120005");
    const { state, asked } = made({
      confirm: [confirmed(text)],
      run: [{ ok: true, value: { name: "nightly-20261108120005", uid: "u", phase: "InProgress" } }],
    });

    filled(state);
    await state.review();
    expect(asked.confirm).toEqual([["cluster-a", "velero", TARGET, "nightly-20261108120005", FORM]]);
    expect(state.step).toMatchObject({ state: "reviewing", backup: TARGET, text });
    // The command waits for the name as it is written.
    for (const typed of ["", "Nightly", "nightly "]) {
      state.typeBackup(typed);
      expect([typed, state.confirmed]).toEqual([typed, false]);
      await state.create();
    }
    expect(asked.run).toEqual([]);
    state.typeBackup("nightly");
    expect(state.confirmed).toBe(true);
    // The name typed drops no review.
    expect(state.step.state).toBe("reviewing");
    await state.create();
    expect(asked.run).toEqual([
      ["cluster-a", "velero", TARGET, "nightly-20261108120005", "nightly", "token-first", REQUEST],
    ]);
    expect(state.step).toEqual({
      state: "created",
      restore: { name: "nightly-20261108120005", uid: "u", phase: "InProgress" },
      request: REQUEST,
    });
    state.see();
    expect(asked.shown).toEqual([REQUEST]);
  });

  it("drops a review when the name, a field or the backup changes, and the name typed with it", async () => {
    const text = textOf("nightly-20261108120005");
    const { state } = made({ confirm: [confirmed(text), confirmed(text), confirmed(text)] });

    filled(state);
    await state.review();
    state.typeBackup("nightly");
    state.type("other-name");
    expect(state.step).toEqual({ state: "form" });
    await state.review();
    expect(state.typed).toBe("");
    state.set("restorePVs", false);
    expect(state.step).toEqual({ state: "form" });
    await state.review();
    state.choose(WEEKLY);
    expect(state.step).toEqual({ state: "form" });
  });

  it("runs an expired review with the token asked again for the same text, and shows another text in its place", async () => {
    const text = textOf("nightly-20261108120005");
    const other = textOf("nightly-20261108120005", { ...FORM, existingResourcePolicy: "update" });
    const { state, asked, later } = made({
      confirm: [
        confirmed(text, "token-first"),
        confirmed(text, "token-renewed", NOW + 120_000),
        confirmed(text, "token-third", NOW + 200_000),
        confirmed(other, "token-other", NOW + 400_000),
      ],
      run: [{ ok: true, value: { name: "nightly-20261108120005", uid: "u" } }],
    });

    filled(state);
    await state.review();
    state.typeBackup("nightly");
    later(31_000);
    await state.create();
    expect(asked.confirm[1]).toEqual(["cluster-a", "velero", TARGET, "nightly-20261108120005", FORM]);
    expect(asked.run).toEqual([
      ["cluster-a", "velero", TARGET, "nightly-20261108120005", "nightly", "token-renewed", REQUEST],
    ]);
    state.start({ kind: "backup", name: "nightly" }, NIGHTLY);
    state.set("clusterResources", "none");
    await state.review();
    state.typeBackup("nightly");
    later(200_000);
    await state.create();
    expect(state.step).toMatchObject({ state: "reviewing", token: "token-other", text: other, replaced: true });
    // The new review asks for the name again.
    expect([state.typed, state.confirmed]).toEqual(["", false]);
    expect(asked.run).toHaveLength(1);
  });

  it("keeps what was typed after a conflict and after an end that is not known, tells the main process only an end it knows, and says a failure", async () => {
    const text = textOf("nightly-20261108120005");
    const { state, asked } = made({
      confirm: [
        confirmed(text),
        confirmed(text),
        { ok: false, code: "conflict", stage: "read", retry: false, text: "The backup changed." },
      ],
      run: [
        { ok: false, code: "conflict", stage: "creation", retry: false, text: "Taken." },
        { ok: false, code: "submission-unknown", stage: "answer", retry: false, text: "Not known." },
      ],
    });

    filled(state);
    await state.review();
    state.typeBackup("nightly");
    await state.create();
    expect(state.step).toMatchObject({ state: "failed", left: "none", name: "nightly-20261108120005" });
    state.see();
    expect(asked.shown).toEqual([REQUEST]);
    expect([state.name, state.form]).toEqual(["nightly-20261108120005", FORM]);
    await state.review();
    state.typeBackup("nightly");
    await state.create();
    expect(state.step).toMatchObject({ state: "failed", left: "unknown" });
    state.see();
    expect(asked.shown).toEqual([REQUEST]);
    await state.review();
    expect(state.step).toMatchObject({ state: "failed", failure: { code: "conflict", stage: "read" } });
    expect(asked.refused).toBe(3);
  });

  it("starts a new form for another source or once a restore was created, and keeps one being filled; drops it all with the installation", async () => {
    const text = textOf("nightly-20261108120005");
    const { state, writesOff } = made({
      confirm: [confirmed(text)],
      run: [{ ok: true, value: { name: "nightly-20261108120005", uid: "u" } }],
    });

    filled(state);
    state.set("includedNamespaces", ["shop"]);
    state.start({ kind: "backup", name: "nightly" }, NIGHTLY);
    expect(state.form.includedNamespaces).toEqual(["shop"]);
    state.start({ kind: "schedule", name: "nightly" }, NIGHTLY);
    expect(state.form).toEqual({ existingResourcePolicy: "none" });
    expect(state.from).toEqual({ kind: "schedule", name: "nightly" });
    state.set("clusterResources", "none");
    await state.review();
    state.typeBackup("nightly");
    await state.create();
    expect(state.step.state).toBe("created");
    state.start({ kind: "schedule", name: "nightly" }, NIGHTLY);
    expect([state.step, state.typed]).toEqual([{ state: "form" }, ""]);
    state.drop();
    expect([state.from, state.backup, state.name, state.form]).toEqual([
      undefined,
      undefined,
      "",
      { existingResourcePolicy: "none" },
    ]);
    // Nothing is created with writes off.
    writesOff();
    filled(state);
    await state.review();
    expect(state.step).toEqual({ state: "form" });
  });

  it("takes the backup a command offers again for a form of the same source: one created again under its name, or a newer one", () => {
    const { state } = made();

    filled(state);
    state.type("my-restore");
    // The same backup: the form as it was left.
    state.start({ kind: "backup", name: "nightly" }, NIGHTLY);
    expect([state.backup, state.name, state.form.clusterResources]).toEqual([NIGHTLY, "my-restore", "none"]);
    // Created again under its name: its UID, and the name typed kept.
    const again = { ...NIGHTLY, uid: "nightly-uid-2" };

    state.start({ kind: "backup", name: "nightly" }, again);
    expect([state.backup, state.name, state.form.clusterResources]).toEqual([again, "my-restore", "none"]);
    // From a schedule, a newer backup the command offers: the name proposed again for it.
    state.start({ kind: "schedule", name: "daily" }, NIGHTLY);
    expect(state.name).toBe("nightly-20261108120005");
    state.start({ kind: "schedule", name: "daily" }, WEEKLY);
    expect([state.backup, state.name]).toEqual([WEEKLY, "weekly-20261108120005"]);
  });

  it("gives the proposal back on Escape in the name, and none while no backup is chosen", () => {
    const { state, later } = made();

    filled(state);
    state.type("my-restore");
    later(60_000);
    state.propose();
    expect([state.name, state.proposed]).toEqual(["nightly-20261108120105", true]);
    state.start({ kind: "schedule", name: "empty" }, undefined);
    state.propose();
    expect([state.name, state.proposed]).toEqual(["", false]);
  });

  it("changes nothing while a restore is being created, and drops the review, its name typed and its step with the installation", async () => {
    let answer: (value: IpcAnswer<RestoreCreated>) => void = () => undefined;
    const { state } = made({ confirm: [confirmed(textOf("nightly-20261108120005"))] });

    filled(state);
    await state.review();
    (
      state as unknown as { dependencies: { client: { runRestoreCreate(): Promise<unknown> } } }
    ).dependencies.client.runRestoreCreate = () => new Promise((resolve) => (answer = resolve));
    state.typeBackup("nightly");
    const running = state.create();

    expect(state.step.state).toBe("running");
    state.start({ kind: "backup", name: "weekly" }, WEEKLY);
    state.choose(WEEKLY);
    state.type("other");
    state.set("clusterResources", "every");
    state.propose();
    // What is typed is kept as it is typed, and the proposal is not given back meanwhile.
    expect([state.from, state.backup, state.name, state.form.clusterResources, state.step.state]).toEqual([
      { kind: "backup", name: "nightly" },
      NIGHTLY,
      "other",
      "every",
      "running",
    ]);
    answer({ ok: true, value: { name: "nightly-20261108120005", uid: "u" } });
    await running;
    state.drop();
    expect([state.step, state.typed, state.from, state.backup, state.name]).toEqual([
      { state: "form" },
      "",
      undefined,
      undefined,
      "",
    ]);
  });

  it("says that the views have no way to the main process, and refuses a review or a renewal with no text it can show", async () => {
    const noWay = new RestoreCreate({
      cluster: () => "cluster-a",
      namespace: () => "velero",
      writesOn: () => true,
      now: () => NOW,
      requestId: () => REQUEST,
      refused: () => undefined,
    });

    noWay.start({ kind: "backup", name: "nightly" }, NIGHTLY);
    noWay.set("clusterResources", "none");
    await noWay.review();
    expect(noWay.step).toMatchObject({ state: "failed", failure: { stage: "way" } });
    const { state, later } = made({
      confirm: [confirmed("not a restore"), confirmed(textOf("nightly-20261108120005")), confirmed("{")],
    });

    filled(state);
    await state.review();
    expect(state.step).toMatchObject({ state: "failed", failure: { code: "validation", stage: "review" } });
    await state.review();
    expect(state.step.state).toBe("reviewing");
    // A second review while one is shown is not asked.
    await state.review();
    state.typeBackup("nightly");
    later(31_000);
    await state.create();
    expect(state.step).toMatchObject({ state: "failed", failure: { code: "validation", stage: "review" } });
  });

  it("takes no answer of a step that moved on, and creates nothing with writes off", async () => {
    const held: { resolve: (answer: unknown) => void }[] = [];
    const hold = <Value>() =>
      new Promise<Value>((resolve) => held.push({ resolve: resolve as (answer: unknown) => void }));
    let writes = true;
    const runs: unknown[] = [];
    const state = new RestoreCreate({
      client: {
        confirmRestoreCreate: () => hold(),
        runRestoreCreate: async (...args) => {
          runs.push(args);
          return { ok: true, value: { name: "nightly-20261108120005", uid: "u" } };
        },
      },
      cluster: () => "cluster-a",
      namespace: () => "velero",
      writesOn: () => writes,
      now: () => NOW,
      requestId: () => REQUEST,
      refused: () => undefined,
    });
    const text = textOf("nightly-20261108120005");

    filled(state);
    const asked = state.review();

    state.leave();
    held[0].resolve(confirmed(text));
    await asked;
    expect(state.step).toEqual({ state: "form" });
    const again = state.review();

    held[1].resolve(confirmed(text));
    await again;
    state.typeBackup("nightly");
    writes = false;
    await state.create();
    expect([runs, state.step.state]).toEqual([[], "reviewing"]);
  });
});
