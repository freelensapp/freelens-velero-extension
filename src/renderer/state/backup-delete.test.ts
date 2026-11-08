import { describe, expect, it } from "vitest";
import { deleteRequestOf, deleteRequestText } from "../../common/delete-request";
import { BackupDelete } from "./backup-delete";

import type { BackupDeleted, Answer as IpcAnswer, WriteConfirmAnswer } from "../../common/ipc";

const NOW = Date.UTC(2026, 10, 8, 12, 0, 5);
const REQUEST = "00000000-0000-4000-8000-000000000001";
const NIGHTLY = { kind: "Backup" as const, name: "nightly", uid: "nightly-uid" };
const WEEKLY = { kind: "Backup" as const, name: "weekly", uid: "weekly-uid" };
const TEXT = deleteRequestText(deleteRequestOf("velero", NIGHTLY));
const NO = { ok: false, code: "request-failed", stage: "request", retry: false, text: "No." } as const;

// A deletion, with a main process that answers what the test gives it, at once.
function made(answers: { confirm?: IpcAnswer<WriteConfirmAnswer>[]; run?: IpcAnswer<BackupDeleted>[] } = {}) {
  const asked = { confirm: [] as unknown[][], run: [] as unknown[][], refused: 0, shown: [] as string[] };
  let now = NOW;
  let writes = true;
  const state = new BackupDelete({
    client: {
      confirmBackupDelete: async (...args) => {
        asked.confirm.push(args);
        return answers.confirm?.shift() ?? NO;
      },
      runBackupDelete: async (...args) => {
        asked.run.push(args);
        return answers.run?.shift() ?? NO;
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

const confirmed = (
  text: string = TEXT,
  more: { token?: string; expires?: number; others?: number } = {},
): IpcAnswer<WriteConfirmAnswer> => ({
  ok: true,
  value: {
    token: more.token ?? "token-first",
    expires: more.expires ?? NOW + 30_000,
    text,
    ...(more.others === undefined ? {} : { others: more.others }),
  },
});

describe("the deletion of a backup, in the views", () => {
  it("asks the main process with the backup alone, and deletes only once the name of the backup is typed as it is written", async () => {
    const { state, asked } = made({
      confirm: [confirmed(TEXT, { others: 1 })],
      run: [{ ok: true, value: { end: "completed" } }],
    });

    state.start(NIGHTLY);
    await state.review();
    expect(asked.confirm).toEqual([["cluster-a", "velero", NIGHTLY]]);
    expect(state.step).toEqual({
      state: "reviewing",
      token: "token-first",
      expires: NOW + 30_000,
      text: TEXT,
      backup: NIGHTLY,
      others: 1,
    });
    for (const typed of ["", "nightl", "Nightly", "nightly "]) {
      state.typeBackup(typed);
      expect(state.confirmed).toBe(false);
      await state.run();
      expect(asked.run).toEqual([]);
    }
    state.typeBackup("nightly");
    expect(state.confirmed).toBe(true);
    await state.run();
    expect(asked.run).toEqual([["cluster-a", "velero", NIGHTLY, "nightly", "token-first", REQUEST]]);
    expect(state.step).toEqual({ state: "done", deleted: { end: "completed" }, request: REQUEST, backup: NIGHTLY });
  });

  it("asks for no review with writes off, with no backup, or while one is asked", async () => {
    const { state, asked, writesOff } = made();

    await state.review();
    expect(asked.confirm).toEqual([]);
    state.start(NIGHTLY);
    writesOff();
    await state.review();
    expect(asked.confirm).toEqual([]);
  });

  it("refuses a review whose text is not exactly the request of this backup in this namespace, and a renewal with another backup's", async () => {
    for (const text of [
      undefined,
      "",
      JSON.stringify(JSON.parse(TEXT)),
      deleteRequestText(deleteRequestOf("velero", WEEKLY)),
      deleteRequestText(deleteRequestOf("another", NIGHTLY)),
      deleteRequestText(deleteRequestOf("velero", { name: "nightly", uid: "another-uid" })),
    ]) {
      const { state, asked } = made({
        confirm: [
          text === undefined ? { ok: true, value: { token: "token-first", expires: NOW + 30_000 } } : confirmed(text),
        ],
      });

      state.start(NIGHTLY);
      await state.review();
      expect(state.step).toMatchObject({ state: "failed", failure: { code: "validation", stage: "review" } });
      expect(asked.refused).toBe(0);
    }
  });

  it("runs an expired review with the token asked again for the same text, and sends nothing when the renewal answers another text", async () => {
    const { state, asked, later } = made({
      confirm: [confirmed(), confirmed(TEXT, { token: "token-second", others: 2 })],
      run: [{ ok: true, value: { end: "unread" } }],
    });

    state.start(NIGHTLY);
    await state.review();
    state.typeBackup("nightly");
    later(31_000);
    await state.run();
    expect(asked.confirm).toHaveLength(2);
    expect(asked.run[0]?.[4]).toBe("token-second");
    // Another text in the renewal is not the request of the review: nothing is sent.
    const other = made({
      confirm: [confirmed(), { ok: true, value: { token: "token-second", expires: NOW + 90_000, text: `${TEXT} ` } }],
    });

    other.state.start(NIGHTLY);
    await other.state.review();
    other.state.typeBackup("nightly");
    other.later(31_000);
    await other.state.run();
    expect(other.asked.run).toEqual([]);
    expect(other.state.step).toMatchObject({ state: "failed", failure: { code: "validation", stage: "review" } });
  });

  it("keeps a failure in sight, tells the main process only an end it knows, and refuses no end it did not see", async () => {
    const lost = {
      ok: false,
      code: "submission-unknown",
      stage: "creation",
      retry: false,
      text: "Not known.",
    } as const;
    const { state, asked } = made({ confirm: [confirmed()], run: [lost] });

    state.start(NIGHTLY);
    await state.review();
    state.typeBackup("nightly");
    await state.run();
    expect(state.step).toEqual({ state: "failed", failure: lost, left: "unknown", request: REQUEST });
    expect(asked.refused).toBe(1);
    state.see();
    expect(asked.shown).toEqual([REQUEST]);
    // A failure of the way is not an end the main process knows.
    const way = made({ confirm: [confirmed()], run: [{ ...lost, stage: "way" }] });

    way.state.start(NIGHTLY);
    await way.state.review();
    way.state.typeBackup("nightly");
    await way.state.run();
    way.state.see();
    expect(way.asked.shown).toEqual([]);
    // An end that was done is told.
    const done = made({ confirm: [confirmed()], run: [{ ok: true, value: { end: "refused" } }] });

    done.state.start(NIGHTLY);
    await done.state.review();
    done.state.typeBackup("nightly");
    await done.state.run();
    done.state.see();
    expect(done.asked.shown).toEqual([REQUEST]);
  });

  it("drops a review when it is left or when writes go off, keeps the workspace of the same backup, and starts a new one for another", async () => {
    const { state } = made({ confirm: [confirmed(), confirmed()] });

    state.start(NIGHTLY);
    await state.review();
    state.typeBackup("nightly");
    state.leave();
    expect(state.step).toEqual({ state: "form" });
    await state.review();
    expect(state.step.state).toBe("reviewing");
    // The command of the view of the same backup asks again for a review.
    state.start(NIGHTLY);
    expect(state.step).toEqual({ state: "form" });
    state.typeBackup("night");
    state.start(WEEKLY);
    expect([state.backup, state.typed, state.step]).toEqual([WEEKLY, "", { state: "form" }]);
    // A backup created again under its name is another one.
    state.start({ ...WEEKLY, uid: "weekly-again" });
    expect(state.backup?.uid).toBe("weekly-again");
  });

  it("changes nothing while a deletion is being asked, takes no answer of a step that moved on, and drops everything with the installation", async () => {
    let answer: (value: IpcAnswer<WriteConfirmAnswer>) => void = () => undefined;
    const { state, asked } = made();

    state["dependencies"].client = {
      confirmBackupDelete: () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
      runBackupDelete: async () => NO,
    };
    state.start(NIGHTLY);
    const asking = state.review();

    expect(state.busy).toBe(true);
    state.start(WEEKLY);
    expect(state.backup).toEqual(NIGHTLY);
    state.leave();
    answer(confirmed());
    await asking;
    expect(state.step).toEqual({ state: "form" });
    state.typeBackup("nightly");
    state.drop();
    expect([state.backup, state.typed, state.step]).toEqual([undefined, "", { state: "form" }]);
    expect(asked.refused).toBe(0);
  });

  it("says that the views have no way to the main process", async () => {
    const state = new BackupDelete({
      cluster: () => "cluster-a",
      namespace: () => "velero",
      writesOn: () => true,
      now: () => NOW,
      requestId: () => REQUEST,
      refused: () => undefined,
    });

    state.start(NIGHTLY);
    await state.review();
    expect(state.step).toMatchObject({ state: "failed", failure: { code: "request-failed", stage: "way" } });
  });
});
