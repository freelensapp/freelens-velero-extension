// @vitest-environment jsdom

// The deletion of one backup in the views (SPEC-0017, DELETE-01, DELETE-04, DELETE-05, DELETE-07): Delete backup in the
// view of a backup for each phase, the workspace over the view, the review of the request with what it means and the
// name of the backup typed, the result of each end, and what drops a review.

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FIRST_VERSION_RESOURCES } from "../../../test/discovery";
import { confirmDialogs } from "../../../test/host-components";
import { BACKUP_CREATE_VIEW_WORDS } from "../../common/backup-create-words";
import { BACKUP_DELETE_VIEW_WORDS, deletedWords, deleteMeaning, deleteOffered } from "../../common/backup-delete-words";
import { deleteRequestOf, deleteRequestText } from "../../common/delete-request";
import { emptyPreferences, heldPreferences, RESOURCES } from "../../common/discovery";
import { closeViews, openView, openViews } from "../navigation";
import { Installation } from "../state/installation";
import { BackupsPage } from "./backups-page";

import type { Answer, Family } from "../../common/discovery";
import type { BackupDeleted, Failure, GateState, Answer as IpcAnswer, WriteConfirmAnswer } from "../../common/ipc";
import type {
  ArtifactClient,
  BackupCreateClient,
  BackupDeleteClient,
  BackupNowClient,
  GateClient,
  KeptEndsClient,
  RestoreCreateClient,
  ScheduleCreateClient,
  SchedulePatchClient,
  WriteClient,
} from "../api/ipc";

const DISCOVERY = "/apis/velero.io/v1";
const LOCATIONS = "/apis/velero.io/v1/backupstoragelocations";
const A = "velero-a";
const NOW = Date.UTC(2026, 10, 8, 11, 0, 0);
const ID = "velero-backup-delete";
const TARGET = { kind: "Backup", name: "nightly", uid: "nightly-uid" };
const TEXT = deleteRequestText(deleteRequestOf(A, TARGET));

function path(family: Family, namespace: string): string {
  return `/apis/velero.io/v1/namespaces/${namespace}/${RESOURCES[family]}`;
}

function list(...items: unknown[]): Answer {
  return { status: 200, body: { items } };
}

const storage = (name: string, more: { accessMode?: string; phase?: string } = {}) => ({
  apiVersion: "velero.io/v1",
  kind: "BackupStorageLocation",
  metadata: { name, namespace: A, uid: `${name}-uid` },
  spec: {
    provider: "aws",
    objectStorage: { bucket: "bucket" },
    default: true,
    accessMode: more.accessMode ?? "ReadWrite",
  },
  status: { phase: more.phase ?? "Available" },
});

const backup = (name: string, phase: string | undefined, location = "default") => ({
  apiVersion: "velero.io/v1",
  kind: "Backup",
  metadata: { name, namespace: A, uid: `${name}-uid` },
  spec: { includedNamespaces: ["shop"], storageLocation: location },
  ...(phase ? { status: { phase, startTimestamp: "2026-11-08T03:00:00Z" } } : {}),
});

// What a read of the backups answers in place of a backup of the fixtures, by its name, as a case changes it.
let changed: Record<string, ReturnType<typeof backup>> = {};

function answers(): Record<string, Answer> {
  return {
    [DISCOVERY]: { status: 200, body: { resources: FIRST_VERSION_RESOURCES.map((name) => ({ name })) } },
    [LOCATIONS]: list(storage("default"), storage("archive", { accessMode: "ReadOnly" })),
    [path("backups", A)]: list(
      ...[
        backup("nightly", "Completed"),
        backup("running", "InProgress"),
        backup("finalizing", "Finalizing"),
        backup("deleting", "Deleting"),
        backup("fresh", "New"),
        backup("unphased", undefined),
        backup("nowhere", "Queued", ""),
        backup("archived", "Completed", "archive"),
        backup("orphan", "Completed", "gone"),
      ].map((item) => changed[item.metadata.name] ?? item),
    ),
    [path("restores", A)]: list(),
    [path("schedules", A)]: list(),
    [path("storageLocations", A)]: list(storage("default"), storage("archive", { accessMode: "ReadOnly" })),
    [path("snapshotLocations", A)]: list(),
  };
}

const NOTHING: Failure = { ok: false, code: "request-failed", stage: "request", retry: false, text: "Not asked." };

// The main process: the gate, and the confirmations and runs of a deletion, which wait until the test answers them.
function mainProcess() {
  let state: GateState = {
    cluster: { id: "cluster-a", name: "local-demo", context: "kind-local-demo" },
    writes: { on: false },
  };
  const confirms: { args: unknown[]; answer: (answer: IpcAnswer<WriteConfirmAnswer>) => void }[] = [];
  const runs: { args: unknown[]; answer: (answer: IpcAnswer<BackupDeleted>) => void }[] = [];
  const gate: GateClient = {
    state: async () => ({ ok: true, value: state }),
    enable: async (_cluster, namespace) => {
      state = { ...state, writes: { on: true, namespace, since: NOW } };
      return { ok: true, value: state };
    },
    disable: async () => {
      state = { ...state, writes: { on: false } };
      return { ok: true, value: state };
    },
    onChanged: () => () => undefined,
  };
  const writer: WriteClient & ArtifactClient = {
    confirm: async () => NOTHING,
    runServerStatus: async () => NOTHING,
    status: async () => NOTHING,
    cancel: async () => NOTHING,
    runDownload: async () => NOTHING,
    page: async () => NOTHING,
    release: async () => NOTHING,
    save: async () => NOTHING,
  };
  const shown: string[] = [];
  const keptEnds: KeptEndsClient = {
    ends: async () => ({ ok: true, value: [] }),
    shown: async (_cluster, request) => {
      shown.push(request);
      return { ok: true, value: null };
    },
  };
  const actions: BackupNowClient &
    BackupCreateClient &
    ScheduleCreateClient &
    RestoreCreateClient &
    SchedulePatchClient &
    BackupDeleteClient = {
    confirmSchedulePatch: async () => NOTHING,
    runSchedulePatch: async () => NOTHING,
    confirmBackupNow: async () => NOTHING,
    runBackupNow: async () => NOTHING,
    confirmBackupCreate: async () => NOTHING,
    runBackupCreate: async () => NOTHING,
    confirmScheduleCreate: async () => NOTHING,
    runScheduleCreate: async () => NOTHING,
    confirmRestoreCreate: async () => NOTHING,
    runRestoreCreate: async () => NOTHING,
    confirmBackupDelete: (...args) => new Promise((answer) => confirms.push({ args, answer })),
    runBackupDelete: (...args) => new Promise((answer) => runs.push({ args, answer })),
  };
  const settle = async <Value,>(
    held: { answer: (answer: IpcAnswer<Value>) => void } | undefined,
    answer: IpcAnswer<Value>,
  ) => {
    if (!held) throw new Error("Nothing waits");
    await act(async () => {
      held.answer(answer);
      await new Promise((done) => setTimeout(done, 0));
    });
  };

  return {
    gate,
    writer,
    actions,
    keptEnds,
    shown,
    confirms,
    runs,
    confirm: (text = TEXT, others?: number) =>
      settle(confirms.at(-1), {
        ok: true,
        value: {
          token: `token-${confirms.length}`,
          expires: NOW + 30_000,
          text,
          ...(others === undefined ? {} : { others }),
        },
      }),
    answerConfirm: (answer: IpcAnswer<WriteConfirmAnswer>) => settle(confirms.at(-1), answer),
    run: (answer: IpcAnswer<BackupDeleted>) => settle(runs.at(-1), answer),
  };
}

function mount(main = mainProcess()) {
  const installation = new Installation({
    cluster: { id: "cluster-a", name: "local-demo" },
    read: async (address) => answers()[address] ?? { status: 404 },
    now: () => Date.now(),
    storage: heldPreferences({ ...emptyPreferences(), selected: { "cluster-a": A } }),
    gate: main.gate,
    writer: main.writer,
    actions: main.actions,
    keptEnds: main.keptEnds,
  });
  const view = render(<BackupsPage installation={installation} />);

  return { installation, main, view };
}

const part = (id: string) => screen.getByTestId(`${ID}-${id}`);
const maybe = (id: string) => screen.queryByTestId(`${ID}-${id}`);
const focused = () => document.activeElement?.getAttribute("data-testid");
const press = (id: string) => {
  act(() => part(id).focus());
  fireEvent.click(part(id));
};

function words(element: Element): string {
  const copy = element.cloneNode(true) as Element;

  for (const mark of copy.querySelectorAll(".Icon")) mark.remove();
  return (copy.textContent ?? "").replace(/\s+/g, " ").trim();
}

function type(element: HTMLElement, value: string) {
  fireEvent.change(element, { target: { value } });
}

// The view of a backup, opened over the list, and its command.
async function openBackup(name: string) {
  await screen.findByTestId("velero-backups-create");
  act(() => openView({ kind: "backup", name }));
  await screen.findByTestId("velero-backup-delete");
}

async function deletionOf(name: string) {
  await openBackup(name);
  fireEvent.click(screen.getByTestId("velero-backup-delete"));
  await screen.findByTestId("velero-backup-delete-workspace");
}

async function writesOn() {
  await waitFor(() => expect(screen.getByTestId("velero-writes-on")).toBeTruthy());
  fireEvent.click(screen.getByTestId("velero-writes-on"));
  await act(async () => {
    await confirmDialogs.at(-1)?.ok?.();
  });
  await waitFor(() => expect(screen.getByTestId("velero-writes").getAttribute("data-writes")).toBe("on"));
}

// The review of the deletion of the backup nightly, asked and answered.
async function reviewed(main: ReturnType<typeof mainProcess>, others?: number) {
  press("ask");
  await waitFor(() => expect(main.confirms).toHaveLength(1));
  await main.confirm(TEXT, others);
  await waitFor(() => expect(maybe("review")).toBeTruthy());
}

beforeEach(() => {
  vi.setSystemTime(NOW);
});

afterEach(() => {
  act(() => closeViews());
  cleanup();
  confirmDialogs.length = 0;
  changed = {};
  vi.useRealTimers();
});

describe("Delete backup, in the view of a backup", () => {
  it("is offered for a backup that ended, Deleting or not started, with the words of its phase and of a location it does not name, and not for one in progress", async () => {
    mount();
    for (const [name, phase, offered, location] of [
      ["nightly", "Completed", true, "default"],
      ["deleting", "Deleting", true, "default"],
      ["fresh", "New", true, "default"],
      ["unphased", undefined, true, "default"],
      ["nowhere", "Queued", true, ""],
      ["running", "InProgress", false, "default"],
      ["finalizing", "Finalizing", false, "default"],
    ] as const) {
      await openBackup(name);
      const command = screen.getByTestId("velero-backup-delete") as HTMLButtonElement;
      const note = screen.queryByTestId("velero-backup-delete-note");

      expect([name, command.disabled, note ? words(note) : undefined]).toEqual([
        name,
        !offered,
        deleteOffered(phase, location).words,
      ]);
      expect(command.getAttribute("aria-describedby")).toBe(note ? "velero-backup-delete-note" : null);
      act(() => closeViews());
    }
  });

  it("opens the workspace of the deletion of this backup over its view, named in the address, which with writes off asks nothing", async () => {
    const { main } = mount();

    // No row of the list offers a deletion: only the view of one backup does (REQ-284).
    await screen.findByTestId("velero-backups-create");
    await waitFor(() => expect(document.querySelectorAll("[data-backup-row]").length).toBeGreaterThan(0));
    expect(document.querySelectorAll('[data-testid^="velero-backup-delete"]')).toHaveLength(0);
    await deletionOf("nightly");
    expect(openViews()).toEqual([
      { kind: "backup", name: "nightly" },
      { kind: "backup-delete", name: "nightly" },
    ]);
    expect(words(part("what"))).toBe(BACKUP_DELETE_VIEW_WORDS.what("nightly", A));
    await waitFor(() => expect(maybe("writes-off")).toBeTruthy());
    expect(maybe("ask")).toBeNull();
    expect(main.confirms).toHaveLength(0);
  });
});

describe("the deletion of a backup, in its workspace", () => {
  it("shows the text beside what it means, with the other requests of the backup, and deletes only once the name of the backup is typed as it is written", async () => {
    const { main } = mount();

    await deletionOf("nightly");
    await writesOn();
    await reviewed(main, 1);
    expect(main.confirms[0].args).toEqual(["cluster-a", A, TARGET]);
    expect(part("text").textContent).toBe(TEXT);
    expect(
      [...part("meaning").querySelectorAll("li")].map((item) => [item.getAttribute("data-part"), words(item)]),
    ).toEqual(
      deleteMeaning("nightly", {
        backupPhase: "Completed",
        storageLocation: "default",
        location: { accessMode: "ReadWrite", phase: "Available" },
        others: 1,
      }).map((meaning) => [meaning.id, meaning.words]),
    );
    expect(focused()).toBe(`${ID}-review`);
    expect((part("run") as HTMLButtonElement).disabled).toBe(true);
    expect(words(part("typed-state"))).toBe(BACKUP_DELETE_VIEW_WORDS.notTyped("nightly"));
    type(part("typed"), "nightl");
    expect((part("run") as HTMLButtonElement).disabled).toBe(true);
    type(part("typed"), "nightly");
    expect((part("run") as HTMLButtonElement).disabled).toBe(false);
    expect(words(part("typed-state"))).toBe(BACKUP_DELETE_VIEW_WORDS.typed);
    // One character more disables it again: the name is compared as it is written.
    type(part("typed"), "nightlyy");
    expect((part("run") as HTMLButtonElement).disabled).toBe(true);
    type(part("typed"), "nightly");
    // Escape in the field takes back what was typed.
    fireEvent.keyDown(part("typed"), { key: "Escape" });
    expect([(part("typed") as HTMLInputElement).value, (part("run") as HTMLButtonElement).disabled]).toEqual([
      "",
      true,
    ]);
    type(part("typed"), "nightly");
    press("run");
    await waitFor(() => expect(main.runs).toHaveLength(1));
    expect(main.runs[0].args.slice(0, 5)).toEqual(["cluster-a", A, TARGET, "nightly", "token-1"]);
    expect(words(part("status"))).toBe(BACKUP_DELETE_VIEW_WORDS.running("nightly"));
    await main.run({ ok: true, value: { end: "completed" } });
    await waitFor(() => expect(maybe("result")).toBeTruthy());
    expect(part("result").getAttribute("data-end")).toBe("completed");
    expect(words(part("result-0"))).toBe(deletedWords("nightly", { end: "completed" })[0]);
    // A backup that is gone has no view to lead to.
    expect(maybe("open")).toBeNull();
    await waitFor(() => expect(focused()).toBe(`${ID}-result`));
    expect(main.shown).toEqual([main.runs[0].args[5]]);
  });

  // Seven workspaces in one case, each reviewed and run: under the full parallel run of a loaded machine it took up
  // to 5.2 seconds, more than the default of 5, so it has a time of its own.
  it("says each end with the errors as Velero wrote them, the requests not read, an end found after a lost answer, and the way to the view of the backup", async () => {
    for (const deleted of [
      { end: "refused", request: "nightly-abcde", phase: "Completed", errors: ["backup deletion failed: synthetic"] },
      { end: "failed", phase: "Deleting", errors: ["one", "two"], errorsLeft: 2 },
      { end: "replaced", phase: "Completed" },
      { end: "unread", phase: "Completed" },
      { end: "in-progress", phase: "Deleting" },
      { end: "in-progress", phase: "Deleting", requestsUnread: true },
      { end: "completed", found: true },
      { end: "completed", found: true, requestsUnread: true },
    ] satisfies BackupDeleted[]) {
      const { main } = mount();

      await deletionOf("nightly");
      await writesOn();
      await reviewed(main);
      type(part("typed"), "nightly");
      press("run");
      await waitFor(() => expect(main.runs).toHaveLength(1));
      await main.run({ ok: true, value: deleted });
      await waitFor(() => expect(maybe("result")).toBeTruthy());
      expect([...part("result").querySelectorAll('[data-testid^="velero-backup-delete-result-"]')].map(words)).toEqual(
        deletedWords("nightly", deleted),
      );
      expect(maybe("found") === null ? undefined : words(part("found"))).toBe(
        deleted.found
          ? deleted.requestsUnread
            ? BACKUP_DELETE_VIEW_WORDS.foundUnread
            : BACKUP_DELETE_VIEW_WORDS.found
          : undefined,
      );
      if (deleted.end !== "completed") {
        press("open");
        await waitFor(() => expect(openViews()).toEqual([{ kind: "backup", name: "nightly" }]));
      }
      cleanup();
      act(() => closeViews());
      confirmDialogs.length = 0;
    }
  }, 20_000);

  it("keeps a failure in sight with the focus, and leads to the view of the backup from an end that is not known", async () => {
    const { main } = mount();

    await deletionOf("nightly");
    await writesOn();
    await reviewed(main);
    type(part("typed"), "nightly");
    press("run");
    await waitFor(() => expect(main.runs).toHaveLength(1));
    await main.run({ ok: false, code: "submission-unknown", stage: "creation", retry: false, text: "Not known." });
    await waitFor(() => expect(maybe("failure")).toBeTruthy());
    expect([part("failure").getAttribute("role"), words(part("failure-text"))]).toEqual(["alert", "Not known."]);
    expect(words(part("failure-left"))).toBe(BACKUP_DELETE_VIEW_WORDS.unknownLeft);
    expect(screen.getByTestId("velero-open-backup-nightly")).toBeTruthy();
    // The command asks again for a new review.
    await waitFor(() => expect(focused()).toBe(`${ID}-ask`));
    expect(main.shown).toEqual([main.runs[0].args[5]]);
  });

  it("leaves the review by Escape and by its command with the focus on the command that asks again, deletes on Enter only once the name is typed, and leaves the review with the workspace", async () => {
    const { main, installation } = mount();

    await deletionOf("nightly");
    await writesOn();
    await reviewed(main);
    act(() => part("review").focus());
    fireEvent.keyDown(part("review"), { key: "Escape" });
    await waitFor(() => expect(maybe("review")).toBeNull());
    await waitFor(() => expect(focused()).toBe(`${ID}-ask`));
    press("ask");
    await waitFor(() => expect(main.confirms).toHaveLength(2));
    await main.confirm();
    await waitFor(() => expect(maybe("review")).toBeTruthy());
    press("back");
    await waitFor(() => expect(maybe("review")).toBeNull());
    await waitFor(() => expect(focused()).toBe(`${ID}-ask`));
    press("ask");
    await waitFor(() => expect(main.confirms).toHaveLength(3));
    await main.confirm();
    await waitFor(() => expect(maybe("review")).toBeTruthy());
    type(part("typed"), "nightl");
    fireEvent.keyDown(part("typed"), { key: "Enter" });
    expect(main.runs).toHaveLength(0);
    type(part("typed"), "nightly");
    // The workspace closes: its review goes, and nothing is deleted.
    act(() => closeViews());
    await waitFor(() => expect(installation.backupDelete.step.state).toBe("form"));
    expect(main.runs).toHaveLength(0);
  });

  it("drops a review when writes go off, and says the ways to the writes with writes off", async () => {
    const { main, installation } = mount();

    await deletionOf("nightly");
    await writesOn();
    await reviewed(main);
    fireEvent.click(screen.getByTestId("velero-writes-off"));
    await waitFor(() => expect(maybe("review")).toBeNull());
    expect(installation.backupDelete.step.state).toBe("form");
    expect(words(part("writes-off"))).toBe(BACKUP_DELETE_VIEW_WORDS.writesOff);
    press("to-target");
    expect(document.activeElement?.getAttribute("data-testid")).toBe("velero-writes-on");
  });

  it("says the location the views read when Velero would refuse the request, ReadOnly or not there, and that the other requests could not be read", async () => {
    for (const [name, location] of [
      ["archived", { accessMode: "ReadOnly", phase: "Available" }],
      ["orphan", { missing: true }],
    ] as const) {
      const { main } = mount();

      await deletionOf(name);
      await writesOn();
      press("ask");
      await waitFor(() => expect(main.confirms).toHaveLength(1));
      await main.confirm(deleteRequestText(deleteRequestOf(A, { name, uid: `${name}-uid` })));
      await waitFor(() => expect(maybe("review")).toBeTruthy());
      expect(words(part("meaning").querySelector('[data-part="location"]') as Element)).toBe(
        deleteMeaning(name, {
          storageLocation: name === "archived" ? "archive" : "gone",
          location,
        }).find((meaning) => meaning.id === "location")?.words,
      );
      // The main process answered no count of the other requests: the review says that they could not be read.
      expect(words(part("meaning").querySelector('[data-part="others"]') as Element)).toBe(
        deleteMeaning(name, { others: "unread" }).find((meaning) => meaning.id === "others")?.words,
      );
      cleanup();
      act(() => closeViews());
      confirmDialogs.length = 0;
    }
  });

  it("deletes on Enter in the field once the name is typed, and holds Delete backup back while the backup is in a phase Velero refuses to delete", async () => {
    const { main, installation } = mount();

    await deletionOf("nightly");
    await writesOn();
    await reviewed(main, 0);
    type(part("typed"), "nightly");
    // The backup is in progress at the next read: Delete backup is held back, with why, and Enter deletes nothing.
    changed = { nightly: backup("nightly", "InProgress") };
    await act(() => installation.refresh());
    await waitFor(() => expect(words(part("typed-state"))).toBe(deleteOffered("InProgress", "default").words));
    expect((part("run") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.keyDown(part("typed"), { key: "Enter" });
    expect(main.runs).toHaveLength(0);
    // It ended: Enter deletes.
    changed = {};
    await act(() => installation.refresh());
    await waitFor(() => expect(words(part("typed-state"))).toBe(BACKUP_DELETE_VIEW_WORDS.typed));
    fireEvent.keyDown(part("typed"), { key: "Enter" });
    await waitFor(() => expect(main.runs).toHaveLength(1));
    expect(main.runs[0].args.slice(0, 4)).toEqual(["cluster-a", A, TARGET, "nightly"]);
  });

  it("says the deletion of another backup that is being asked, shows nothing of it, and gives the workspace of this backup when it ends", async () => {
    const { main } = mount();
    const archived = { kind: "Backup", name: "archived", uid: "archived-uid" };

    await deletionOf("nightly");
    await writesOn();
    await reviewed(main, 0);
    type(part("typed"), "nightly");
    press("run");
    await waitFor(() => expect(main.runs).toHaveLength(1));
    // The workspace of another backup while the deletion of nightly is being asked.
    act(() => openView({ kind: "backup-delete", name: "archived" }));
    await waitFor(() => expect(words(part("another"))).toBe(BACKUP_DELETE_VIEW_WORDS.another("nightly")));
    expect([maybe("ask"), maybe("status")?.textContent, maybe("review"), maybe("result")]).toEqual([
      null,
      "",
      null,
      null,
    ]);
    await main.run({ ok: true, value: { end: "failed", phase: "Deleting", errors: ["one"] } });
    // Its end is not shown here, and the review asked is of this backup, said by what is read of it.
    await waitFor(() => expect(maybe("another")).toBeNull());
    await waitFor(() => expect((part("ask") as HTMLButtonElement).disabled).toBe(false));
    expect(maybe("result")).toBeNull();
    press("ask");
    await waitFor(() => expect(main.confirms).toHaveLength(2));
    expect(main.confirms[1].args).toEqual(["cluster-a", A, archived]);
    await main.confirm(deleteRequestText(deleteRequestOf(A, archived)), 0);
    await waitFor(() => expect(maybe("review")).toBeTruthy());
    expect(words(part("meaning").querySelector('[data-part="location"]') as Element)).toBe(
      deleteMeaning("archived", {
        storageLocation: "archive",
        location: { accessMode: "ReadOnly", phase: "Available" },
      }).find((meaning) => meaning.id === "location")?.words,
    );
    expect(words(part("typed-state"))).toBe(BACKUP_DELETE_VIEW_WORDS.notTyped("archived"));
  });

  it("says the deletion of the backup that went as one of another backup when a backup of its name is created again while it is asked", async () => {
    const { main, installation } = mount();

    await deletionOf("nightly");
    await writesOn();
    await reviewed(main, 0);
    type(part("typed"), "nightly");
    press("run");
    await waitFor(() => expect(main.runs).toHaveLength(1));
    changed = {
      nightly: { ...backup("nightly", "Completed"), metadata: { name: "nightly", namespace: A, uid: "again" } },
    };
    await act(() => installation.refresh());
    await waitFor(() => expect(words(part("another"))).toBe(BACKUP_DELETE_VIEW_WORDS.another("nightly")));
    expect(maybe("status")?.textContent).toBe("");
    await main.run({ ok: true, value: { end: "completed" } });
    // The backup of the workspace is the one created again: its own workspace, with nothing of the deletion that ended.
    await waitFor(() => expect(maybe("another")).toBeNull());
    expect(maybe("result")).toBeNull();
    press("ask");
    await waitFor(() => expect(main.confirms).toHaveLength(2));
    expect(main.confirms[1].args).toEqual(["cluster-a", A, { kind: "Backup", name: "nightly", uid: "again" }]);
  });

  it("says that the backup of the workspace is another one of the same name, created after the one that was open", async () => {
    const { installation } = mount();

    await deletionOf("nightly");
    expect(screen.queryByTestId("velero-backup-delete-replaced")).toBeNull();
    changed = {
      nightly: { ...backup("nightly", "Completed"), metadata: { name: "nightly", namespace: A, uid: "again" } },
    };
    await act(() => installation.refresh());
    await waitFor(() => expect(screen.queryByTestId("velero-backup-delete-replaced")).toBeTruthy());
  });

  it("refuses a review whose text is not the request of this backup, and confirms nothing", async () => {
    const { main } = mount();

    await deletionOf("nightly");
    await writesOn();
    press("ask");
    await waitFor(() => expect(main.confirms).toHaveLength(1));
    await main.confirm(deleteRequestText(deleteRequestOf(A, { name: "weekly", uid: "weekly-uid" })));
    await waitFor(() => expect(maybe("failure")).toBeTruthy());
    expect([part("failure").getAttribute("data-code"), part("failure").getAttribute("data-stage")]).toEqual([
      "validation",
      "review",
    ]);
    expect(maybe("review")).toBeNull();
  });
});

describe("the deletion of a backup, opened from the address", () => {
  it("asks the review of the backup the address names, once it is read, for a backup Velero deletes", async () => {
    const { main } = mount();

    await screen.findByTestId("velero-backups-create");
    act(() => openView({ kind: "backup-delete", name: "nightly" }));
    await screen.findByTestId("velero-backup-delete-workspace");
    await writesOn();
    await waitFor(() => expect((part("ask") as HTMLButtonElement).disabled).toBe(false));
    press("ask");
    await waitFor(() => expect(main.confirms).toHaveLength(1));
    expect(main.confirms[0].args).toEqual(["cluster-a", A, TARGET]);
  });

  it("holds the review back for a backup Velero refuses to delete, with why, though the address opened its workspace", async () => {
    mount();
    await screen.findByTestId("velero-backups-create");
    act(() => openView({ kind: "backup-delete", name: "running" }));
    await screen.findByTestId("velero-backup-delete-workspace");
    await writesOn();
    await waitFor(() => expect(words(part("held"))).toBe(deleteOffered("InProgress").words));
    expect((part("ask") as HTMLButtonElement).disabled).toBe(true);
  });

  it("says a backup that is not among the ones the installation read, and asks nothing", async () => {
    const { main } = mount();

    await screen.findByTestId("velero-backups-create");
    act(() => openView({ kind: "backup-delete", name: "gone" }));
    await screen.findByTestId("velero-backup-delete-workspace");
    await writesOn();
    await waitFor(() => expect(words(part("held"))).toBe(BACKUP_DELETE_VIEW_WORDS.backupMissing("gone", A)));
    expect((part("ask") as HTMLButtonElement).disabled).toBe(true);
    expect(main.confirms).toHaveLength(0);
  });

  it("says the gate of the cluster when it is not known", async () => {
    const main = mainProcess();

    main.gate.state = async () => ({
      ok: false,
      code: "request-failed",
      stage: "way",
      retry: true,
      text: "The views have no way to the main process.",
    });
    mount(main);
    await deletionOf("nightly");
    await waitFor(() => expect(words(part("writes-off"))).toBe(BACKUP_CREATE_VIEW_WORDS.gateUnknown));
  });
});
