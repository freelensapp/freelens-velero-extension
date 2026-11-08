// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FIRST_VERSION_RESOURCES } from "../../../test/discovery";
import { confirmDialogs } from "../../../test/host-components";
import { BACKUP_NAME_WORDS, MEANING_WORDS } from "../../common/backup-from-schedule";
import { BACKUP_NOW_VIEW_WORDS } from "../../common/backup-now-words";
import { emptyPreferences, heldPreferences, RESOURCES } from "../../common/discovery";
import { keptEndWords } from "../../common/kept-end-words";
import { closeViews, openView, openViews } from "../navigation";
import { Installation } from "../state/installation";
import { SchedulesPage } from "./schedules-page";

import type { Answer, Family } from "../../common/discovery";
import type {
  BackupCreated,
  Failure,
  GateState,
  Answer as IpcAnswer,
  KeptEnd,
  WriteConfirmAnswer,
} from "../../common/ipc";
import type {
  ArtifactClient,
  BackupCreateClient,
  BackupNowClient,
  GateClient,
  KeptEndsClient,
  ScheduleCreateClient,
  WriteClient,
} from "../api/ipc";

const DISCOVERY = "/apis/velero.io/v1";
const LOCATIONS = "/apis/velero.io/v1/backupstoragelocations";
const A = "velero-a";
// 2026-11-08 04:30:15 UTC.
const NOW = Date.UTC(2026, 10, 8, 4, 30, 15);
const LONG = "s".repeat(64);

function path(family: Family, namespace: string): string {
  return `/apis/velero.io/v1/namespaces/${namespace}/${RESOURCES[family]}`;
}

function list(...items: unknown[]): Answer {
  return { status: 200, body: { items } };
}

const schedule = (name: string, spec: object = {}) => ({
  apiVersion: "velero.io/v1",
  kind: "Schedule",
  metadata: { name, namespace: A, uid: `${name}-uid`, labels: { team: "storage" } },
  spec: { schedule: "0 3 * * *", template: { includedNamespaces: ["shop"], ttl: "72h0m0s" }, ...spec },
  status: { phase: "Enabled" },
});

const location = {
  apiVersion: "velero.io/v1",
  kind: "BackupStorageLocation",
  metadata: { name: "default", namespace: A, uid: "default-uid" },
  spec: { provider: "aws", objectStorage: { bucket: "bucket" } },
  status: { phase: "Available" },
};

function answers(): Record<string, Answer> {
  return {
    [DISCOVERY]: { status: 200, body: { resources: FIRST_VERSION_RESOURCES.map((name) => ({ name })) } },
    [LOCATIONS]: list(location),
    [path("backups", A)]: list(),
    [path("restores", A)]: list(),
    [path("schedules", A)]: list(schedule("nightly", { paused: true }), schedule(LONG), schedule("weekly")),
    [path("storageLocations", A)]: list(location),
    [path("snapshotLocations", A)]: list(),
  };
}

// The text the main process writes for the backup of nightly, as it writes it.
const TEXT = JSON.stringify(
  {
    apiVersion: "velero.io/v1",
    kind: "Backup",
    metadata: {
      name: "nightly-20261108043015",
      namespace: A,
      labels: { team: "storage", "velero.io/schedule-name": "nightly" },
    },
    spec: { includedNamespaces: ["shop"], ttl: "72h0m0s" },
  },
  null,
  2,
);

const NOTHING: Failure = { ok: false, code: "request-failed", stage: "request", retry: false, text: "Not asked." };

// The main process: the gate, and the confirmations and runs of a backup asked from a schedule, which wait until the
// test answers them.
function mainProcess() {
  let state: GateState = {
    cluster: { id: "cluster-a", name: "local-demo", context: "kind-local-demo" },
    writes: { on: false },
  };
  const confirms: { args: unknown[]; answer: (answer: IpcAnswer<WriteConfirmAnswer>) => void }[] = [];
  const runs: { args: unknown[]; answer: (answer: IpcAnswer<BackupCreated>) => void }[] = [];
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
  // The views ask nothing else of the main process here.
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
  // What the main process keeps for the cluster, and the ends a view said it showed.
  const kept: KeptEnd[] = [];
  const shown: string[] = [];
  let asks = 0;
  const keptEnds: KeptEndsClient = {
    ends: async () => {
      asks += 1;
      return { ok: true, value: [...kept] };
    },
    shown: async (_cluster, request) => {
      shown.push(request);
      return { ok: true, value: null };
    },
  };
  // A backup of the form is not asked here.
  const actions: BackupNowClient & BackupCreateClient & ScheduleCreateClient = {
    confirmBackupNow: (...args) => new Promise((answer) => confirms.push({ args, answer })),
    runBackupNow: (...args) => new Promise((answer) => runs.push({ args, answer })),
    confirmBackupCreate: async () => NOTHING,
    runBackupCreate: async () => NOTHING,
    confirmScheduleCreate: async () => NOTHING,
    runScheduleCreate: async () => NOTHING,
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
    kept,
    shown,
    // How many times the views asked for the ends.
    asked: () => asks,
    confirms,
    runs,
    confirm: (text = TEXT) =>
      settle(confirms.at(-1), { ok: true, value: { token: `token-${confirms.length}`, expires: NOW + 30_000, text } }),
    run: (answer: IpcAnswer<BackupCreated>) => settle(runs.at(-1), answer),
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
  const view = render(<SchedulesPage installation={installation} />);

  return { installation, main, view };
}

const part = (id: string) => screen.getByTestId(`velero-backup-now-${id}`);
const maybe = (id: string) => screen.queryByTestId(`velero-backup-now-${id}`);
const focused = () => document.activeElement?.getAttribute("data-testid");
const field = () => part("field") as HTMLInputElement;
// A command used as a click of the pointer uses it: it has the focus when it acts.
const press = (id: string) => {
  act(() => part(id).focus());
  fireEvent.click(part(id));
};

// The words of a part, without the names of its marks, which the host draws as icons.
function words(element: Element): string {
  const copy = element.cloneNode(true) as Element;

  for (const mark of copy.querySelectorAll(".Icon")) mark.remove();
  return (copy.textContent ?? "").replace(/\s+/g, " ").trim();
}

async function openSchedule(name: string) {
  await waitFor(() => expect(screen.getByText(name, { selector: "[data-schedule-row]" })).toBeTruthy());
  fireEvent.click(screen.getByText(name, { selector: "[data-schedule-row]" }));
  await screen.findByTestId("velero-schedule-workspace");
}

async function writesOn() {
  await waitFor(() => expect(screen.getByTestId("velero-writes-on")).toBeTruthy());
  fireEvent.click(screen.getByTestId("velero-writes-on"));
  await act(async () => {
    await confirmDialogs.at(-1)?.ok?.();
  });
  await waitFor(() => expect(screen.getByTestId("velero-writes").getAttribute("data-writes")).toBe("on"));
}

async function backUpNow() {
  await openSchedule("nightly");
  fireEvent.click(screen.getByTestId("velero-schedule-back-up-now"));
  await screen.findByTestId("velero-backup-now-workspace");
}

// The review asked and shown.
async function review(main: ReturnType<typeof mainProcess>) {
  press("ask");
  await waitFor(() => expect(main.confirms).toHaveLength(1));
  await main.confirm();
  await waitFor(() => expect(maybe("review")).toBeTruthy());
}

// The name is proposed from the clock of the machine: every test gives it the one the names are written for.
beforeEach(() => {
  vi.setSystemTime(NOW);
});

afterEach(() => {
  act(() => closeViews());
  cleanup();
  confirmDialogs.length = 0;
  vi.useRealTimers();
});

describe("back up now, from the view of a schedule", () => {
  it("opens the form over the view of the schedule, named in the address, with the name the command line proposes", async () => {
    mount();
    await backUpNow();
    expect(openViews()).toEqual([
      { kind: "schedule", name: "nightly" },
      { kind: "backup-now", name: "nightly" },
    ]);
    expect(screen.getByTestId("velero-backup-now-name").textContent).toBe("Back up now");
    expect(field().value).toBe("nightly-20261108043015");
    expect(words(part("what"))).toBe(BACKUP_NOW_VIEW_WORDS.what("nightly", A));
    // The way back is to the view of the schedule, as it was.
    fireEvent.click(screen.getByTestId("velero-back"));
    await screen.findByTestId("velero-schedule-workspace");
    expect(openViews()).toEqual([{ kind: "schedule", name: "nightly" }]);
  });

  it("disables the command for a schedule whose name a label does not take, with the words why", async () => {
    mount();
    await openSchedule(LONG);
    const command = screen.getByTestId("velero-schedule-back-up-now") as HTMLButtonElement;

    expect(command.disabled).toBe(true);
    expect(document.getElementById(command.getAttribute("aria-describedby") ?? "")?.textContent).toBe(
      BACKUP_NAME_WORDS.scheduleTooLong(64),
    );
  });

  it("fills the form with writes off, and leads to the target bar for the review", async () => {
    const { main } = mount();

    await backUpNow();
    expect(words(part("writes-off"))).toBe(BACKUP_NOW_VIEW_WORDS.writesOff);
    expect(maybe("ask")).toBeNull();
    fireEvent.change(field(), { target: { value: "nightly-by-hand" } });
    expect(field().value).toBe("nightly-by-hand");
    fireEvent.click(part("to-target"));
    expect(focused()).toBe("velero-writes-on");
    expect(main.confirms).toHaveLength(0);
  });

  it("says what is wrong with the name, tied to the field, and asks nothing for it", async () => {
    const { main } = mount();

    await backUpNow();
    await writesOn();
    fireEvent.change(field(), { target: { value: "Nightly" } });
    expect(part("name-problem").textContent).toBe(BACKUP_NAME_WORDS.form);
    expect(field().getAttribute("aria-describedby")).toBe("velero-backup-now-name-rule velero-backup-now-name-problem");
    expect(field().getAttribute("aria-invalid")).toBe("true");
    expect((part("ask") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(field(), { target: { value: "a".repeat(217) } });
    expect(part("name-problem").textContent).toBe(BACKUP_NAME_WORDS.long(217));
    // Escape gives back the name the form proposed, and does not leave the view.
    fireEvent.keyDown(field(), { key: "Escape" });
    expect(field().value).toBe("nightly-20261108043015");
    expect(maybe("name-problem")).toBeNull();
    expect(main.confirms).toHaveLength(0);
  });

  it("shows the text of the main process as it came, beside what it means, and leaves it by its command or Escape", async () => {
    const { main } = mount();

    await backUpNow();
    await writesOn();
    await review(main);
    expect(main.confirms[0].args).toEqual([
      "cluster-a",
      A,
      { name: "nightly", uid: "nightly-uid" },
      "nightly-20261108043015",
    ]);
    expect(focused()).toBe("velero-backup-now-review");
    expect(part("text").textContent).toBe(TEXT);
    const meaning = [...part("meaning").querySelectorAll("li")].map((item) => item.getAttribute("data-part"));

    expect(meaning).toEqual([
      "by-hand",
      "queue",
      "hold",
      "restore",
      "validation",
      "paused",
      "label:velero.io/schedule-name",
      "label:team",
    ]);
    expect(part("meaning").textContent).toContain(MEANING_WORDS.paused);
    expect(part("meaning").textContent).toContain(MEANING_WORDS.label("team", "storage", "schedule"));
    expect(part("review").textContent).toContain("local-demo (context kind-local-demo)");
    press("back");
    expect(maybe("review")).toBeNull();
    expect(focused()).toBe("velero-backup-now-ask");
    press("ask");
    await waitFor(() => expect(main.confirms).toHaveLength(2));
    await main.confirm();
    await waitFor(() => expect(maybe("review")).toBeTruthy());
    fireEvent.keyDown(part("review"), { key: "Escape" });
    expect(maybe("review")).toBeNull();
    expect(screen.queryByTestId("velero-backup-now-workspace")).toBeTruthy();
    expect(main.runs).toHaveLength(0);
  });

  it("creates the backup, shows the phase Velero wrote and leads to the view of the backup in place of the form", async () => {
    const { main } = mount();

    await backUpNow();
    await writesOn();
    await review(main);
    press("create");
    await waitFor(() => expect(main.runs).toHaveLength(1));
    expect(main.runs[0].args.slice(0, 5)).toEqual([
      "cluster-a",
      A,
      { name: "nightly", uid: "nightly-uid" },
      "nightly-20261108043015",
      "token-1",
    ]);
    expect(part("status").textContent).toBe(BACKUP_NOW_VIEW_WORDS.running("nightly-20261108043015"));
    expect(focused()).toBe("velero-backup-now-status");
    await main.run({ ok: true, value: { name: "nightly-20261108043015", uid: "backup-uid", phase: "InProgress" } });
    expect(part("phase").textContent).toBe(BACKUP_NOW_VIEW_WORDS.phase("InProgress"));
    expect(focused()).toBe("velero-backup-now-result");
    // Shown here: the main process keeps it no more.
    await waitFor(() => expect(main.shown).toEqual([main.runs[0].args[5]]));
    fireEvent.click(part("open"));
    expect(openViews()).toEqual([
      { kind: "schedule", name: "nightly" },
      { kind: "backup", name: "nightly-20261108043015" },
    ]);
  });

  it("says that the backup was found by its name when the answer of its creation was lost", async () => {
    const { main } = mount();

    await backUpNow();
    await writesOn();
    await review(main);
    press("create");
    await waitFor(() => expect(main.runs).toHaveLength(1));
    await main.run({
      ok: true,
      value: { name: "nightly-20261108043015", uid: "backup-uid", phase: "New", found: true },
    });
    expect(part("found").textContent).toBe(BACKUP_NOW_VIEW_WORDS.found);
    expect(part("phase").textContent).toBe(BACKUP_NOW_VIEW_WORDS.phase("New"));
  });

  it("says that Velero has not read the backup yet when it wrote no phase", async () => {
    const { main } = mount();

    await backUpNow();
    await writesOn();
    await review(main);
    press("create");
    await waitFor(() => expect(main.runs).toHaveLength(1));
    await main.run({ ok: true, value: { name: "nightly-20261108043015", uid: "backup-uid" } });
    expect(part("phase").textContent).toBe(BACKUP_NOW_VIEW_WORDS.unread);
    expect(maybe("found")).toBeNull();
    expect(part("result").getAttribute("data-phase")).toBe("");
  });

  it("leads to the backup that has the name, and proposes the name of the next second", async () => {
    const { main } = mount();

    await backUpNow();
    await writesOn();
    await review(main);
    press("create");
    await waitFor(() => expect(main.runs).toHaveLength(1));
    await main.run({
      ok: false,
      code: "conflict",
      stage: "creation",
      retry: false,
      text: "A backup named nightly-20261108043015 is already there, and is left as it is: nothing was created. Ask for a new review with another name.",
    });
    expect(part("failure").getAttribute("data-code")).toBe("conflict");
    expect(part("failure").getAttribute("data-left")).toBe("none");
    expect(field().value).toBe("nightly-20261108043016");
    expect(focused()).toBe("velero-backup-now-ask");
    fireEvent.click(screen.getByTestId("velero-open-backup-nightly-20261108043015"));
    expect(openViews().at(-1)).toEqual({ kind: "backup", name: "nightly-20261108043015" });
  });

  it("says that a backup whose creation was not answered may be there", async () => {
    const { main } = mount();

    await backUpNow();
    await writesOn();
    await review(main);
    press("create");
    await waitFor(() => expect(main.runs).toHaveLength(1));
    await main.run({
      ok: false,
      code: "submission-unknown",
      stage: "creation",
      retry: false,
      text: "The API server did not answer the creation, and the backup nightly-20261108043015 could not be read: it may have been created.",
    });
    expect(part("failure").getAttribute("data-left")).toBe("unknown");
    expect(part("failure-left").textContent).toBe(BACKUP_NOW_VIEW_WORDS.unknownLeft);
  });

  it("waits for a backup asked from another schedule, then gives the form of this one with the end of the other above it", async () => {
    const { main } = mount();

    await backUpNow();
    await writesOn();
    await review(main);
    press("create");
    await waitFor(() => expect(main.runs).toHaveLength(1));
    // Away from the workspace while the backup is created, to the other schedule.
    act(() => closeViews());
    await openSchedule("weekly");
    fireEvent.click(screen.getByTestId("velero-schedule-back-up-now"));
    await screen.findByTestId("velero-backup-now-workspace");
    expect(part("another").textContent).toBe(BACKUP_NOW_VIEW_WORDS.another("nightly"));
    await main.run({ ok: true, value: { name: "nightly-20261108043015", uid: "backup-uid", phase: "New" } });
    await waitFor(() => expect(field().value).toBe("weekly-20261108043015"));
    expect(part("earlier-words").textContent).toBe(
      `${BACKUP_NOW_VIEW_WORDS.created("nightly-20261108043015")} ${BACKUP_NOW_VIEW_WORDS.phase("New")}`,
    );
    expect(screen.getByTestId("velero-open-backup-nightly-20261108043015")).toBeTruthy();
    // Shown above the form: the main process keeps it no more.
    await waitFor(() => expect(main.shown).toEqual([main.runs[0].args[5]]));
    fireEvent.click(part("earlier-let-go"));
    expect(maybe("earlier")).toBeNull();
  });

  it("says no end again that its workspace showed", async () => {
    const { main } = mount();

    await backUpNow();
    await writesOn();
    await review(main);
    press("create");
    await waitFor(() => expect(main.runs).toHaveLength(1));
    await main.run({ ok: true, value: { name: "nightly-20261108043015", uid: "backup-uid", phase: "New" } });
    expect(maybe("result")).toBeTruthy();
    act(() => closeViews());
    await openSchedule("weekly");
    fireEvent.click(screen.getByTestId("velero-schedule-back-up-now"));
    await screen.findByTestId("velero-backup-now-workspace");
    await waitFor(() => expect(field().value).toBe("weekly-20261108043015"));
    expect(maybe("earlier")).toBeNull();
  });

  it("says that the review took the place of one whose schedule changed while it was read", async () => {
    const { main } = mount();

    await backUpNow();
    await writesOn();
    await review(main);
    act(() => vi.setSystemTime(NOW + 31_000));
    press("create");
    await waitFor(() => expect(main.confirms).toHaveLength(2));
    await main.confirm(TEXT.replace('"72h0m0s"', '"96h0m0s"'));
    await waitFor(() => expect(maybe("replaced")).toBeTruthy());
    expect(part("replaced").textContent).toBe(BACKUP_NOW_VIEW_WORDS.replaced);
    expect(part("text").textContent).toContain('"96h0m0s"');
    expect(main.runs).toHaveLength(0);
  });

  it("confirms no review whose text the views cannot read as a backup", async () => {
    const { main } = mount();

    await backUpNow();
    await writesOn();
    press("ask");
    await waitFor(() => expect(main.confirms).toHaveLength(1));
    await main.confirm("{}");
    await waitFor(() => expect(maybe("failure")).toBeTruthy());
    expect(part("failure").getAttribute("data-stage")).toBe("review");
    expect(maybe("review")).toBeNull();
  });

  it("leaves a review with the workspace, and keeps the name for when it is opened again by the address", async () => {
    const { main } = mount();

    await backUpNow();
    await writesOn();
    fireEvent.change(field(), { target: { value: "nightly-by-hand" } });
    await review(main);
    fireEvent.click(screen.getByTestId("velero-back"));
    await screen.findByTestId("velero-schedule-workspace");
    act(() => openView({ kind: "backup-now", name: "nightly" }));
    await screen.findByTestId("velero-backup-now-workspace");
    expect(part("body").getAttribute("data-step")).toBe("form");
    expect(field().value).toBe("nightly-by-hand");
  });

  it("opens the form of a schedule from the address alone, with the name the command line proposes", async () => {
    mount();
    await waitFor(() => expect(screen.getByText("nightly", { selector: "[data-schedule-row]" })).toBeTruthy());
    act(() => openView({ kind: "backup-now", name: "nightly" }));
    await screen.findByTestId("velero-backup-now-workspace");
    await waitFor(() => expect(field().value).toBe("nightly-20261108043015"));
  });

  it("gives a new form with a new proposal each time the command is used", async () => {
    mount();
    await backUpNow();
    fireEvent.change(field(), { target: { value: "nightly-by-hand" } });
    fireEvent.click(screen.getByTestId("velero-back"));
    await screen.findByTestId("velero-schedule-workspace");
    fireEvent.click(screen.getByTestId("velero-schedule-back-up-now"));
    await screen.findByTestId("velero-backup-now-workspace");
    expect(field().value).toBe("nightly-20261108043015");
  });

  it("asks the review with Enter in the field, says what it does meanwhile, and asks nothing with writes off", async () => {
    const { main } = mount();

    await backUpNow();
    fireEvent.keyDown(field(), { key: "Enter" });
    expect(main.confirms).toHaveLength(0);
    await writesOn();
    act(() => field().focus());
    fireEvent.keyDown(field(), { key: "Enter" });
    await waitFor(() => expect(main.confirms).toHaveLength(1));
    // The field, disabled while the main process is asked, gives the focus to the words that say so.
    await waitFor(() => expect(focused()).toBe("velero-backup-now-status"));
    await main.confirm();
    await waitFor(() => expect(focused()).toBe("velero-backup-now-review"));
  });

  it("drops a review when writes are turned off, and keeps the name", async () => {
    const { main } = mount();

    await backUpNow();
    await writesOn();
    fireEvent.change(field(), { target: { value: "nightly-by-hand" } });
    await review(main);
    fireEvent.click(screen.getByTestId("velero-writes-off"));
    await waitFor(() => expect(maybe("review")).toBeNull());
    expect(words(part("writes-off"))).toBe(BACKUP_NOW_VIEW_WORDS.writesOff);
    expect(field().value).toBe("nightly-by-hand");
  });

  it("drops everything of the backup when another installation is selected, and when the extension goes", async () => {
    const { main, installation } = mount();

    await backUpNow();
    await writesOn();
    await review(main);
    act(() => {
      installation.configure("velero-b");
    });
    await waitFor(() => expect(installation.backupNow.schedule).toBeUndefined());
    expect(installation.backupNow.step).toEqual({ state: "form" });
    act(() => installation.backupNow.start({ name: "nightly", uid: "nightly-uid" }));
    act(() => installation.dispose());
    expect(installation.backupNow.schedule).toBeUndefined();
  });

  it("says in the target bar the end of a backup no view showed, with the way to it, until it is dismissed", async () => {
    const main = mainProcess();
    const end: KeptEnd = {
      request: "00000000-0000-4000-8000-0000000000aa",
      kind: "backup-from-schedule",
      namespace: A,
      context: "kind-local-demo",
      name: "nightly-20261108043015",
      schedule: "nightly",
      outcome: { created: true, phase: "Completed" },
      at: NOW,
    };

    main.kept.push(end);
    mount(main);
    const band = await screen.findByTestId("velero-kept-ends");

    expect(band.textContent).toContain(keptEndWords(end));
    expect(screen.getByTestId("velero-open-backup-nightly-20261108043015")).toBeTruthy();
    fireEvent.click(screen.getByTestId("velero-kept-end-dismiss"));
    expect(main.shown).toEqual([end.request]);
    expect(screen.queryByTestId("velero-kept-ends")).toBeNull();
  });

  it("leads to a schedule of the form the target bar says, as a schedule, and to nothing when none was created", async () => {
    const main = mainProcess();
    const end = (request: string, name: string, outcome: KeptEnd["outcome"]): KeptEnd => ({
      request,
      kind: "schedule",
      namespace: A,
      context: "kind-local-demo",
      name,
      outcome,
      at: NOW,
    });

    main.kept.push(
      end("00000000-0000-4000-8000-0000000000c1", "nightly-shop", { created: true, phase: "Enabled" }),
      end("00000000-0000-4000-8000-0000000000c2", "weekly-shop", {
        created: false,
        code: "conflict",
        text: "A schedule named weekly-shop is already there.",
      }),
    );
    mount(main);
    await screen.findByTestId("velero-kept-ends");
    expect(screen.getByTestId("velero-open-schedule-nightly-shop").textContent).toBe("Open the schedule nightly-shop");
    expect(screen.queryByTestId("velero-open-backup-nightly-shop")).toBeNull();
    expect(screen.queryByTestId("velero-open-schedule-weekly-shop")).toBeNull();
    expect(screen.getAllByTestId("velero-kept-end-dismiss").map((button) => button.getAttribute("aria-label"))).toEqual(
      ["Dismiss what is said of the schedule nightly-shop", "Dismiss what is said of the schedule weekly-shop"],
    );
  });

  it("leads to a restore the target bar says, as a restore", async () => {
    const main = mainProcess();

    main.kept.push({
      request: "00000000-0000-4000-8000-0000000000d1",
      kind: "restore",
      namespace: A,
      context: "kind-local-demo",
      name: "nightly-20261108120000",
      backup: "nightly",
      outcome: { created: true, phase: "InProgress" },
      at: NOW,
    });
    mount(main);
    await screen.findByTestId("velero-kept-ends");
    expect(screen.getByTestId("velero-open-restore-nightly-20261108120000").textContent).toBe(
      "Open the restore nightly-20261108120000",
    );
    expect(screen.getByTestId("velero-kept-end-dismiss").getAttribute("aria-label")).toBe(
      "Dismiss what is said of the restore nightly-20261108120000",
    );
  });

  it("says no end again above a form once the operator dismissed it in the target bar", async () => {
    const main = mainProcess();
    const { installation } = mount(main);

    await backUpNow();
    await writesOn();
    await review(main);
    press("create");
    await waitFor(() => expect(main.runs).toHaveLength(1));
    // Away from the workspace while the backup is created: its end is for the target bar.
    act(() => closeViews());
    const request = String(main.runs[0].args[5]);

    await main.run({ ok: true, value: { name: "nightly-20261108043015", uid: "backup-uid", phase: "New" } });
    main.kept.push({
      request,
      kind: "backup-from-schedule",
      namespace: A,
      context: "kind-local-demo",
      name: "nightly-20261108043015",
      schedule: "nightly",
      outcome: { created: true, phase: "New" },
      at: NOW,
    });
    await act(async () => {
      await installation.readEnds();
    });
    fireEvent.click(await screen.findByTestId("velero-kept-end-dismiss"));
    expect(main.shown).toEqual([request]);
    await openSchedule("weekly");
    fireEvent.click(screen.getByTestId("velero-schedule-back-up-now"));
    await screen.findByTestId("velero-backup-now-workspace");
    await waitFor(() => expect(field().value).toBe("weekly-20261108043015"));
    expect(maybe("earlier")).toBeNull();
    // A late list that still holds it does not bring it back.
    await act(async () => {
      await installation.readEnds();
    });
    expect(screen.queryByTestId("velero-kept-ends")).toBeNull();
  });

  it("asks for the ends at every read, and leads to a backup only when it was created in the installation shown", async () => {
    const main = mainProcess();
    const end = (request: string, more: Partial<KeptEnd>): KeptEnd => ({
      request,
      kind: "backup-from-schedule",
      namespace: A,
      context: "kind-local-demo",
      name: "nightly-20261108043015",
      schedule: "nightly",
      outcome: { created: true },
      at: NOW,
      ...more,
    });

    main.kept.push(
      end("00000000-0000-4000-8000-0000000000b1", { namespace: "velero-b", name: "weekly-20261108043015" }),
      end("00000000-0000-4000-8000-0000000000b2", {
        name: "nightly-20261108043016",
        outcome: { created: false, code: "conflict", text: "A backup named nightly-20261108043016 is already there." },
      }),
    );
    const { installation } = mount(main);

    await screen.findByTestId("velero-kept-ends");
    expect(screen.getAllByTestId("velero-kept-end")).toHaveLength(2);
    expect(screen.queryByTestId("velero-open-backup-weekly-20261108043015")).toBeNull();
    expect(screen.queryByTestId("velero-open-backup-nightly-20261108043016")).toBeNull();
    const before = main.asked();

    await act(async () => {
      await installation.refresh();
    });
    expect(main.asked()).toBeGreaterThan(before);
  });
});
