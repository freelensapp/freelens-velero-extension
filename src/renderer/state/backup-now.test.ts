import { describe, expect, it } from "vitest";
import { BACKUP_NAME_WORDS } from "../../common/backup-from-schedule";
import { BackupNow, backupLeft } from "./backup-now";

import type { Answer, BackupCreated, Failure, WriteConfirmAnswer } from "../../common/ipc";
import type { BackupNowClient } from "../api/ipc";

// 2026-11-08 04:30:15 UTC, the clock of the machine.
const NOW = Date.UTC(2026, 10, 8, 4, 30, 15);
const SCHEDULE = { name: "nightly", uid: "schedule-uid" };
const TEXT = JSON.stringify({ apiVersion: "velero.io/v1", kind: "Backup", metadata: { labels: {} } }, null, 2);

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
  const shown: string[] = [];
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
    shown: (request) => shown.push(request),
  });

  return { state, clock, refusals, writes, shown };
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
      request: "request-1",
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
    expect(state.step).toEqual({
      state: "created",
      backup: { name: "nightly-20261108043015", uid: "backup-uid" },
      request: "request-1",
    });

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
    expect(state.step).toEqual({
      state: "failed",
      failure: taken,
      left: "none",
      name: "nightly-20261108043015",
      request: "request-1",
    });
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

describe("what a backup asked from a schedule keeps and leaves, in the views", () => {
  async function reviewing(main: ReturnType<typeof mainProcess>, state: BackupNow) {
    state.start(SCHEDULE);
    const asked = state.review();

    main.confirms.at(-1)?.answer(confirmed(`token-${main.confirms.length}`));
    await asked;
  }

  it("takes nothing that arrives for a run that was dropped, or for a renewal that was left", async () => {
    const main = mainProcess();
    const { state, clock } = backupNow({ client: main.client });

    await reviewing(main, state);
    clock.now += 31_000;
    const renewing = state.create();

    // The installation changed while the token was asked again.
    state.drop();
    main.confirms[1].answer(confirmed("token-2", TEXT, clock.now + 30_000));
    await renewing;
    expect(main.runs).toHaveLength(0);
    expect(state.step).toEqual({ state: "form" });
    // A new review, read in time.
    clock.now = NOW;
    await reviewing(main, state);
    const running = state.create();

    state.drop();
    main.runs[0].answer({ ok: true, value: { name: "nightly-20261108043046", uid: "backup-uid" } });
    await running;
    expect(state.step).toEqual({ state: "form" });
    expect(state.schedule).toBeUndefined();
  });

  it("ends without a backup when the token cannot be asked again, and says so", async () => {
    const main = mainProcess();
    const { state, clock, refusals } = backupNow({ client: main.client });

    await reviewing(main, state);
    clock.now += 31_000;
    const created = state.create();
    const off = failure("forbidden", "gate", "Writes are off for this installation.");

    main.confirms[1].answer(off);
    await created;
    expect(state.step).toEqual({ state: "failed", failure: off, left: "none", name: "nightly-20261108043015" });
    expect(main.runs).toHaveLength(0);
    expect(refusals).toHaveLength(1);
  });

  it("asks the token again from the instant it expires, and gives the review that takes the place of the old one its own expiry", async () => {
    const main = mainProcess();
    const { state, clock } = backupNow({ client: main.client });

    await reviewing(main, state);
    clock.now = NOW + 30_000;
    const created = state.create();

    expect(main.confirms).toHaveLength(2);
    main.confirms[1].answer(confirmed("token-2", `${TEXT} `, NOW + 60_000));
    await created;
    expect(state.step).toEqual({
      state: "reviewing",
      token: "token-2",
      expires: NOW + 60_000,
      text: `${TEXT} `,
      name: "nightly-20261108043015",
      replaced: true,
    });
  });

  it("gives back the name of the next second, not the one that was taken, after a 409", async () => {
    const main = mainProcess();
    const { state } = backupNow({ client: main.client });

    await reviewing(main, state);
    const created = state.create();

    main.runs[0].answer(failure("conflict", "creation"));
    await created;
    state.type("typed-by-hand");
    // Escape in the field gives back the proposal.
    state.type(state.proposed);
    expect(state.name).toBe("nightly-20261108043016");
  });

  it("asks one review at a time, and nothing while a review is shown or a backup is created", async () => {
    const main = mainProcess();
    const { state } = backupNow({ client: main.client });

    state.start(SCHEDULE);
    const asked = state.review();

    await state.review();
    expect(main.confirms).toHaveLength(1);
    main.confirms[0].answer(confirmed("token-1"));
    await asked;
    await state.review();
    expect(main.confirms).toHaveLength(1);
    const created = state.create();

    await state.review();
    expect(main.confirms).toHaveLength(1);
    // Typing while it is created keeps the run.
    state.type("another-name");
    expect(state.step).toMatchObject({ state: "running" });
    main.runs[0].answer({ ok: true, value: { name: "nightly-20261108043015", uid: "backup-uid" } });
    await created;
  });

  it("runs nothing with writes off or without a way to the main process", async () => {
    const main = mainProcess();
    const { state, writes } = backupNow({ client: main.client });

    await reviewing(main, state);
    writes.on = false;
    await state.create();
    expect(main.runs).toHaveLength(0);
    expect(state.step).toMatchObject({ state: "reviewing" });
    const lone = backupNow();

    lone.state.start(SCHEDULE);
    await lone.state.create();
    expect(lone.state.step).toEqual({ state: "form" });
  });

  it("says that a run the main process raised on may have created the backup", () => {
    expect(backupLeft(failure("request-failed", "handler"))).toBe("unknown");
  });

  it("confirms no review whose text is missing, or is not the body of a backup", async () => {
    const main = mainProcess();
    const { state, clock } = backupNow({ client: main.client });

    for (const text of [undefined, "{}", "not json"]) {
      state.start(SCHEDULE);
      const asked = state.review();

      main.confirms.at(-1)?.answer({
        ok: true,
        value: { token: "token", expires: NOW + 30_000, ...(text === undefined ? {} : { text }) },
      });
      await asked;
      expect(state.step).toMatchObject({
        state: "failed",
        left: "none",
        failure: { code: "validation", stage: "review" },
      });
    }
    // The text asked again when the token expired is read as well.
    await reviewing(main, state);
    clock.now += 31_000;
    const created = state.create();

    main.confirms.at(-1)?.answer({ ok: true, value: { token: "token", expires: clock.now + 30_000 } });
    await created;
    expect(state.step).toMatchObject({ state: "failed", failure: { stage: "review" } });
    expect(main.runs).toHaveLength(0);
  });

  it("keeps an end no workspace showed for the next form, until it is let go, and not one that was shown", async () => {
    const main = mainProcess();
    const { state } = backupNow({ client: main.client });

    await reviewing(main, state);
    const created = state.create();

    main.runs[0].answer({ ok: true, value: { name: "nightly-20261108043015", uid: "backup-uid", phase: "New" } });
    await created;
    state.start({ name: "weekly", uid: "weekly-uid" });
    expect(state.earlier).toEqual({
      schedule: "nightly",
      end: {
        state: "created",
        backup: { name: "nightly-20261108043015", uid: "backup-uid", phase: "New" },
        request: "request-1",
      },
    });
    state.letGo();
    expect(state.earlier).toBeUndefined();
    // Seen by its workspace: not kept.
    await reviewing(main, state);
    const shown = state.create();

    main.runs[1].answer(failure("forbidden", "creation"));
    await shown;
    state.see();
    state.start({ name: "weekly", uid: "weekly-uid" });
    expect(state.earlier).toBeUndefined();
    // A new end is not seen because the one before was.
    await reviewing(main, state);
    const next = state.create();

    main.runs[2].answer(failure("validation", "creation"));
    await next;
    state.start({ name: "weekly", uid: "weekly-uid" });
    expect(state.earlier).toMatchObject({ schedule: "nightly", end: { state: "failed" } });
    // The installation that changes takes it with everything else.
    state.drop();
    expect(state.earlier).toBeUndefined();
  });
});

describe("the end of a run, which a view shows, in the views", () => {
  it("tells the main process that a view showed the end of a run, and of the earlier one, and nothing of an end before a run", async () => {
    const main = mainProcess();
    const { state, shown } = backupNow({ client: main.client });

    state.start(SCHEDULE);
    let asked = state.review();

    main.confirms[0].answer(failure("forbidden", "gate"));
    await asked;
    state.see();
    expect(shown).toEqual([]);
    asked = state.review();
    main.confirms[1].answer(confirmed("token-2"));
    await asked;
    const created = state.create();

    main.runs[0].answer({ ok: true, value: { name: "nightly-20261108043015", uid: "backup-uid" } });
    await created;
    state.start({ name: "weekly", uid: "weekly-uid" });
    state.seeEarlier();
    expect(shown).toEqual(["request-1"]);
    state.letGo();
    state.start(SCHEDULE);
    const again = state.review();

    main.confirms[2].answer(confirmed("token-3"));
    await again;
    const failed = state.create();

    main.runs[1].answer(failure("conflict", "creation"));
    await failed;
    state.see();
    expect(shown).toEqual(["request-1", "request-2"]);
  });
});

describe("an end the views let go of, or do not know", () => {
  it("tells the main process nothing of a run whose answer did not come back, which it keeps for the target bar", async () => {
    const main = mainProcess();
    const { state, shown } = backupNow({ client: main.client });

    state.start(SCHEDULE);
    const asked = state.review();

    main.confirms[0].answer(confirmed("token-1"));
    await asked;
    const created = state.create();

    main.runs[0].answer(failure("validation", "answer"));
    await created;
    state.see();
    expect(shown).toEqual([]);
  });

  it("takes an end the operator let go in the target bar for seen, and says it no more above a form", async () => {
    const main = mainProcess();
    const { state } = backupNow({ client: main.client });

    state.start(SCHEDULE);
    const asked = state.review();

    main.confirms[0].answer(confirmed("token-1"));
    await asked;
    const created = state.create();

    main.runs[0].answer({ ok: true, value: { name: "nightly-20261108043015", uid: "backup-uid" } });
    await created;
    state.letGoOf("request-1");
    state.start({ name: "weekly", uid: "weekly-uid" });
    expect(state.earlier).toBeUndefined();
  });
});
