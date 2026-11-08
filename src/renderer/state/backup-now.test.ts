import { describe, expect, it } from "vitest";
import { BACKUP_NAME_WORDS } from "../../common/backup-from-schedule";
import { BackupNow, backupLeft } from "./backup-now";

import type { Answer, BackupCreated, Failure, WriteConfirmAnswer } from "../../common/ipc";
import type { BackupNowClient } from "../api/ipc";

// 2026-11-08 04:30:15 UTC, the clock of the machine.
const NOW = Date.UTC(2026, 10, 8, 4, 30, 15);
const SCHEDULE = { name: "nightly", uid: "schedule-uid" };
const TEXT = '{\n  "apiVersion": "velero.io/v1",\n  "kind": "Backup"\n}';

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
  const runs: Held<BackupCreated>[] = [];
  const client: BackupNowClient = {
    confirmBackupNow: (...args) =>
      new Promise((resolve) => {
        confirms.push({ args, answer: resolve });
      }),
    runBackupNow: (...args) =>
      new Promise((resolve) => {
        runs.push({ args, answer: resolve });
      }),
  };

  return { client, confirms, runs };
}

function backupNow(options: { client?: BackupNowClient; writesOn?: boolean } = {}) {
  const clock = { now: NOW };
  const refusals: number[] = [];
  let request = 0;
  const writes = { on: options.writesOn ?? true };
  const state = new BackupNow({
    client: options.client,
    cluster: () => "cluster-a",
    namespace: () => "velero",
    writesOn: () => writes.on,
    now: () => clock.now,
    requestId: () => `request-${++request}`,
    refused: () => refusals.push(clock.now),
  });

  return { state, clock, refusals, writes };
}

const turn = () => new Promise((resolve) => setTimeout(resolve, 0));

function confirmed(token: string, text = TEXT, expires = NOW + 30_000): Answer<WriteConfirmAnswer> {
  return { ok: true, value: { token, expires, text } };
}

describe("a backup asked from a schedule, in the views", () => {
  it("proposes the name the command line proposes, from the clock in UTC, and keeps the form of the schedule", () => {
    const { state, clock } = backupNow({ client: mainProcess().client });

    state.start(SCHEDULE);
    expect(state.name).toBe("nightly-20261108043015");
    expect(state.step).toEqual({ state: "form" });
    state.type("nightly-by-hand");
    clock.now += 5000;
    // The workspace opened again for the same schedule shows the form it had.
    state.open(SCHEDULE);
    expect(state.name).toBe("nightly-by-hand");
    // One of the same name created since, with another UID, is another schedule.
    state.open({ name: "nightly", uid: "other-uid" });
    expect(state.name).toBe("nightly-20261108043020");
    state.open({ name: "weekly", uid: "weekly-uid" });
    expect(state.schedule).toEqual({ name: "weekly", uid: "weekly-uid" });
    expect(state.name).toBe("weekly-20261108043020");
  });

  it("checks the name as it is typed, with the rule in words", () => {
    const { state } = backupNow({ client: mainProcess().client });

    state.start(SCHEDULE);
    expect(state.problem).toBeUndefined();
    state.type("");
    expect(state.problem).toBe(BACKUP_NAME_WORDS.empty);
    state.type("Nightly");
    expect(state.problem).toBe(BACKUP_NAME_WORDS.form);
    state.type("a".repeat(217));
    expect(state.problem).toBe(BACKUP_NAME_WORDS.long(217));
    state.type("a".repeat(216));
    expect(state.problem).toBeUndefined();
  });

  it("asks nothing with writes off, with a name that is refused, or for a schedule whose name a label does not take", async () => {
    const main = mainProcess();
    const { state, writes } = backupNow({ client: main.client });

    state.start(SCHEDULE);
    writes.on = false;
    await state.review();
    writes.on = true;
    state.type("Not A Name");
    await state.review();
    state.start({ name: "s".repeat(64), uid: "long-uid" });
    expect(state.refused).toBe(BACKUP_NAME_WORDS.scheduleTooLong(64));
    await state.review();
    expect(main.confirms).toHaveLength(0);
    expect(state.step).toEqual({ state: "form" });
  });

  it("shows the review with the text of the main process, and a change of the name drops it with its token", async () => {
    const main = mainProcess();
    const { state } = backupNow({ client: main.client });

    state.start(SCHEDULE);
    const asked = state.review();

    expect(state.step).toEqual({ state: "asking" });
    expect(main.confirms[0].args).toEqual(["cluster-a", "velero", SCHEDULE, "nightly-20261108043015"]);
    main.confirms[0].answer(confirmed("token-1"));
    await asked;
    expect(state.step).toEqual({
      state: "reviewing",
      token: "token-1",
      expires: NOW + 30_000,
      text: TEXT,
      name: "nightly-20261108043015",
    });
    state.type("nightly-2");
    expect(state.step).toEqual({ state: "form" });
    await state.create();
    expect(main.runs).toHaveLength(0);
  });

  it("creates the backup with the token of the review and a new request, and shows what Velero wrote", async () => {
    const main = mainProcess();
    const { state } = backupNow({ client: main.client });

    state.start(SCHEDULE);
    const asked = state.review();

    main.confirms[0].answer(confirmed("token-1"));
    await asked;
    const created = state.create();

    expect(state.step).toEqual({ state: "running", request: "request-1", name: "nightly-20261108043015" });
    expect(state.busy).toBe(true);
    // A second gesture while it runs asks nothing more.
    await state.create();
    expect(main.runs).toHaveLength(1);
    expect(main.runs[0].args).toEqual([
      "cluster-a",
      "velero",
      SCHEDULE,
      "nightly-20261108043015",
      "token-1",
      "request-1",
    ]);
    main.runs[0].answer({ ok: true, value: { name: "nightly-20261108043015", uid: "backup-uid", phase: "New" } });
    await created;
    expect(state.step).toEqual({
      state: "created",
      backup: { name: "nightly-20261108043015", uid: "backup-uid", phase: "New" },
    });
  });

  it("asks a token that expired again, and goes on only for the same text", async () => {
    const main = mainProcess();
    const { state, clock } = backupNow({ client: main.client });

    state.start(SCHEDULE);
    let asked = state.review();

    main.confirms[0].answer(confirmed("token-1"));
    await asked;
    clock.now += 31_000;
    let created = state.create();

    main.confirms[1].answer(confirmed("token-2", TEXT, clock.now + 30_000));
    await turn();
    expect(main.runs[0].args[4]).toBe("token-2");
    main.runs[0].answer({ ok: true, value: { name: "nightly-20261108043015", uid: "backup-uid" } });
    await created;
    expect(state.step).toEqual({ state: "created", backup: { name: "nightly-20261108043015", uid: "backup-uid" } });

    // The schedule changed while the review was read: the new text is a new review, and nothing is sent.
    state.start(SCHEDULE);
    asked = state.review();
    main.confirms[2].answer(confirmed("token-3"));
    await asked;
    clock.now += 31_000;
    created = state.create();
    main.confirms[3].answer(confirmed("token-4", `${TEXT} `, clock.now + 30_000));
    await created;
    expect(main.runs).toHaveLength(1);
    expect(state.step).toMatchObject({ state: "reviewing", token: "token-4", text: `${TEXT} ` });
  });

  it("proposes the name of the next second when the API server answers that the name is taken", async () => {
    const main = mainProcess();
    const { state, refusals } = backupNow({ client: main.client });

    state.start(SCHEDULE);
    const asked = state.review();

    main.confirms[0].answer(confirmed("token-1"));
    await asked;
    const created = state.create();
    const taken = failure("conflict", "creation", "A backup named nightly-20261108043015 is already there.");

    main.runs[0].answer(taken);
    await created;
    expect(state.step).toEqual({ state: "failed", failure: taken, left: "none", name: "nightly-20261108043015" });
    expect(state.name).toBe("nightly-20261108043016");
    expect(refusals).toHaveLength(1);
    // Asking again is a new review, of the name proposed.
    void state.review();
    expect(main.confirms[1].args[3]).toBe("nightly-20261108043016");
  });

  it("says when a backup may be there: an answer that was lost, or a run the views did not hear the end of", () => {
    expect(backupLeft(failure("submission-unknown", "creation"))).toBe("unknown");
    expect(backupLeft(failure("request-failed", "way"))).toBe("unknown");
    expect(backupLeft(failure("request-failed", "answer"))).toBe("unknown");
    expect(backupLeft(failure("conflict", "read"))).toBe("none");
    expect(backupLeft(failure("forbidden", "creation"))).toBe("none");
    expect(backupLeft(failure("validation", "request"))).toBe("none");
  });

  it("takes nothing that arrives for a review that was left, and does not leave a backup that is being created", async () => {
    const main = mainProcess();
    const { state } = backupNow({ client: main.client });

    state.start(SCHEDULE);
    const asked = state.review();

    state.leave();
    main.confirms[0].answer(confirmed("token-1"));
    await asked;
    expect(state.step).toEqual({ state: "form" });

    const again = state.review();

    main.confirms[1].answer(confirmed("token-2"));
    await again;
    const created = state.create();

    state.leave();
    state.start({ name: "weekly", uid: "weekly-uid" });
    expect(state.step).toMatchObject({ state: "running" });
    expect(state.schedule).toEqual(SCHEDULE);
    main.runs[0].answer({ ok: true, value: { name: "nightly-20261108043015", uid: "backup-uid", phase: "Queued" } });
    await created;
    expect(state.step).toMatchObject({ state: "created" });

    // Another installation: nothing of this one stays, and what arrives for it is not taken.
    state.start(SCHEDULE);
    const dropped = state.review();

    state.drop();
    main.confirms[2].answer(confirmed("token-3"));
    await dropped;
    expect(state.step).toEqual({ state: "form" });
    expect(state.schedule).toBeUndefined();
    expect(state.name).toBe("");
  });

  it("says that the views have no way to the main process, and asks nothing", async () => {
    const { state, refusals } = backupNow();

    state.start(SCHEDULE);
    await state.review();
    expect(state.step).toMatchObject({
      state: "failed",
      left: "none",
      failure: { code: "request-failed", stage: "way" },
    });
    expect(refusals).toHaveLength(0);
  });
});
