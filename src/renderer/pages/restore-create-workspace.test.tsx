// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { runInAction } from "mobx";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FIRST_VERSION_RESOURCES } from "../../../test/discovery";
import { hostNamespaces, hostNamespacesLoaded } from "../../../test/freelens-extensions";
import { confirmDialogs } from "../../../test/host-components";
import { BACKUP_CREATE_VIEW_WORDS } from "../../common/backup-create-words";
import { emptyPreferences, heldPreferences, RESOURCES } from "../../common/discovery";
import {
  backupOffered,
  NOT_OFFERED_OF_A_RESTORE,
  RESTORE_CREATE_VIEW_WORDS,
  restoreResultWords,
} from "../../common/restore-create-words";
import { RESTORE_WORDS, type RestoreForm, restoreBodyText, restoreFromForm } from "../../common/restore-form";
import { closeViews, openTab, openView, openViews } from "../navigation";
import { Installation } from "../state/installation";
import { BackupsPage } from "./backups-page";
import { OFFERED_BOUND } from "./restore-create-workspace";
import { SchedulesPage } from "./schedules-page";

import type { Answer, Family } from "../../common/discovery";
import type { Failure, GateState, Answer as IpcAnswer, RestoreCreated, WriteConfirmAnswer } from "../../common/ipc";
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
// Sunday 8 November 2026, 11:00 UTC.
const NOW = Date.UTC(2026, 10, 8, 11, 0, 0);
const ID = "velero-restore-create";
const NAME = "nightly-20261108110000";
const TARGET = { kind: "Backup", name: "nightly", uid: "nightly-uid" };

function path(family: Family, namespace: string): string {
  return `/apis/velero.io/v1/namespaces/${namespace}/${RESOURCES[family]}`;
}

function list(...items: unknown[]): Answer {
  return { status: 200, body: { items } };
}

const storage = (name: string) => ({
  apiVersion: "velero.io/v1",
  kind: "BackupStorageLocation",
  metadata: { name, namespace: A, uid: `${name}-uid` },
  spec: { provider: "aws", objectStorage: { bucket: "bucket" }, default: true },
  status: { phase: "Available" },
});

const backup = (name: string, phase: string, more: { start?: string; schedule?: string } = {}) => ({
  apiVersion: "velero.io/v1",
  kind: "Backup",
  metadata: {
    name,
    namespace: A,
    uid: `${name}-uid`,
    ...(more.schedule ? { labels: { "velero.io/schedule-name": more.schedule } } : {}),
  },
  spec: { includedNamespaces: ["shop", "web-*"], excludedNamespaces: ["web-test"], storageLocation: "default" },
  status: { phase, startTimestamp: more.start ?? "2026-11-08T03:00:00Z" },
});

const schedule = (name: string) => ({
  apiVersion: "velero.io/v1",
  kind: "Schedule",
  metadata: { name, namespace: A, uid: `${name}-uid`, creationTimestamp: "2026-11-01T00:00:00Z" },
  spec: { schedule: "0 3 * * *", template: {} },
  status: { phase: "Enabled" },
});

function answers(): Record<string, Answer> {
  return {
    [DISCOVERY]: { status: 200, body: { resources: FIRST_VERSION_RESOURCES.map((name) => ({ name })) } },
    [LOCATIONS]: list(storage("default")),
    [path("backups", A)]: list(
      backup("nightly", "Completed"),
      backup("partial", "PartiallyFailed"),
      backup("running", "InProgress"),
      backup("daily-1", "Completed", { schedule: "daily", start: "2026-11-06T03:00:00Z" }),
      backup("daily-2", "Completed", { schedule: "daily", start: "2026-11-07T03:00:00Z" }),
      backup("daily-3", "Failed", { schedule: "daily", start: "2026-11-08T03:00:00Z" }),
    ),
    [path("restores", A)]: list({
      apiVersion: "velero.io/v1",
      kind: "Restore",
      metadata: { name: "taken", namespace: A, uid: "taken-uid" },
      spec: { backupName: "nightly" },
      status: { phase: "Completed" },
    }),
    [path("schedules", A)]: list(schedule("daily"), schedule("empty")),
    [path("storageLocations", A)]: list(storage("default")),
    [path("snapshotLocations", A)]: list(),
  };
}

const NOTHING: Failure = { ok: false, code: "request-failed", stage: "request", retry: false, text: "Not asked." };

// The text the main process writes for a restore of the form, as it writes it.
function textOf(form: RestoreForm, name = NAME, of = "nightly"): string {
  const body = restoreFromForm(A, name, of, form, {
    includedNamespaces: ["shop", "web-*"],
    excludedNamespaces: ["web-test"],
  });

  if (!body) throw new Error("The form of the test is refused");
  return restoreBodyText(body);
}

// The main process: the gate, and the confirmations and runs of a restore, which wait until the test answers them.
function mainProcess() {
  let state: GateState = {
    cluster: { id: "cluster-a", name: "local-demo", context: "kind-local-demo" },
    writes: { on: false },
  };
  const confirms: { args: unknown[]; answer: (answer: IpcAnswer<WriteConfirmAnswer>) => void }[] = [];
  const runs: { args: unknown[]; answer: (answer: IpcAnswer<RestoreCreated>) => void }[] = [];
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
    confirmBackupDelete: async () => NOTHING,
    runBackupDelete: async () => NOTHING,
    confirmBackupNow: async () => NOTHING,
    runBackupNow: async () => NOTHING,
    confirmBackupCreate: async () => NOTHING,
    runBackupCreate: async () => NOTHING,
    confirmScheduleCreate: async () => NOTHING,
    runScheduleCreate: async () => NOTHING,
    confirmSchedulePatch: async () => NOTHING,
    runSchedulePatch: async () => NOTHING,
    confirmRestoreCreate: (...args) => new Promise((answer) => confirms.push({ args, answer })),
    runRestoreCreate: (...args) => new Promise((answer) => runs.push({ args, answer })),
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
    confirm: (text: string) =>
      settle(confirms.at(-1), { ok: true, value: { token: `token-${confirms.length}`, expires: NOW + 30_000, text } }),
    run: (answer: IpcAnswer<RestoreCreated>) => settle(runs.at(-1), answer),
  };
}

function mount(page: "backups" | "schedules" = "backups", main = mainProcess(), table: Record<string, Answer> = {}) {
  const installation = new Installation({
    cluster: { id: "cluster-a", name: "local-demo" },
    read: async (address) => table[address] ?? answers()[address] ?? { status: 404 },
    now: () => Date.now(),
    storage: heldPreferences({ ...emptyPreferences(), selected: { "cluster-a": A } }),
    gate: main.gate,
    writer: main.writer,
    actions: main.actions,
    keptEnds: main.keptEnds,
  });
  const view = render(
    page === "backups" ? <BackupsPage installation={installation} /> : <SchedulesPage installation={installation} />,
  );

  return { installation, main, view };
}

const part = (id: string) => screen.getByTestId(`${ID}-${id}`);
const maybe = (id: string) => screen.queryByTestId(`${ID}-${id}`);
const focused = () => document.activeElement?.getAttribute("data-testid");
const field = () => part("field") as HTMLInputElement;
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
  await screen.findByTestId("velero-backup-restore");
}

async function restoreOf(name: string) {
  await openBackup(name);
  fireEvent.click(screen.getByTestId("velero-backup-restore"));
  await screen.findByTestId("velero-restore-backup-workspace");
}

async function writesOn() {
  await waitFor(() => expect(screen.getByTestId("velero-writes-on")).toBeTruthy());
  fireEvent.click(screen.getByTestId("velero-writes-on"));
  await act(async () => {
    await confirmDialogs.at(-1)?.ok?.();
  });
  await waitFor(() => expect(screen.getByTestId("velero-writes").getAttribute("data-writes")).toBe("on"));
}

// The review of a restore of the backup nightly with the cluster-scoped resources none, asked and answered.
async function reviewed(
  main: ReturnType<typeof mainProcess>,
  form: RestoreForm = { clusterResources: "none", existingResourcePolicy: "none" },
) {
  fireEvent.click(part("clusterResources-none"));
  press("ask");
  await waitFor(() => expect(main.confirms).toHaveLength(1));
  await main.confirm(textOf(form));
  await waitFor(() => expect(maybe("review")).toBeTruthy());
}

beforeEach(() => {
  vi.setSystemTime(NOW);
  runInAction(() => hostNamespaces.replace([{ name: "shop" }, { name: "web" }]));
});

afterEach(() => {
  act(() => closeViews());
  cleanup();
  confirmDialogs.length = 0;
  runInAction(() => {
    hostNamespaces.clear();
    hostNamespacesLoaded.set(true);
  });
  vi.useRealTimers();
});

describe("restore, from the view of a backup", () => {
  it("offers Restore for a backup that ended well, says that a backup PartiallyFailed may miss items, and why not for one in progress", async () => {
    mount();
    await openBackup("nightly");
    expect((screen.getByTestId("velero-backup-restore") as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByTestId("velero-backup-restore-note")).toBeNull();
    act(() => closeViews());
    await openBackup("partial");
    expect((screen.getByTestId("velero-backup-restore") as HTMLButtonElement).disabled).toBe(false);
    expect(words(screen.getByTestId("velero-backup-restore-note"))).toBe(backupOffered("PartiallyFailed").words);
    act(() => closeViews());
    await openBackup("running");
    expect((screen.getByTestId("velero-backup-restore") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId("velero-backup-restore").getAttribute("aria-describedby")).toBe(
      "velero-backup-restore-note",
    );
    expect(words(screen.getByTestId("velero-backup-restore-note"))).toBe(backupOffered("InProgress").words);
  });

  it("opens the form over the view of the backup, named in the address, the name proposed in UTC and the namespaces of the backup offered, with writes off", async () => {
    mount();
    await restoreOf("nightly");
    expect(openViews()).toEqual([
      { kind: "backup", name: "nightly" },
      { kind: "restore-backup", name: "nightly" },
    ]);
    expect(screen.getByTestId("velero-restore-backup-name").textContent).toBe("Restore");
    expect(field().value).toBe(NAME);
    expect(words(part("from-backup"))).toBe("nightly, Completed");
    // The names the spec of the backup names are offered, and its patterns are not.
    expect(maybe("includedNamespaces-shop")).toBeTruthy();
    expect(maybe("includedNamespaces-web-*")).toBeNull();
    // The policy for the resources that exist is none, and the cluster-scoped resources are not chosen.
    expect((part("existingResourcePolicy-none") as HTMLInputElement).checked).toBe(true);
    for (const choice of ["every", "none", "needed"])
      expect([choice, (part(`clusterResources-${choice}`) as HTMLInputElement).checked]).toEqual([choice, false]);
    expect(words(part("not-offered"))).toBe(NOT_OFFERED_OF_A_RESTORE);
    expect(words(part("writes-off"))).toBe(RESTORE_CREATE_VIEW_WORDS.writesOff);
    expect(maybe("ask")).toBeNull();
    fireEvent.click(screen.getByTestId("velero-back"));
    await waitFor(() => expect(screen.queryByTestId("velero-restore-backup-workspace")).toBeNull());
    expect(openViews()).toEqual([{ kind: "backup", name: "nightly" }]);
  });

  it("holds the review back until the cluster-scoped resources are chosen, says what the restore controller refuses, and a name taken", async () => {
    const { main } = mount();

    await restoreOf("nightly");
    await writesOn();
    expect((part("ask") as HTMLButtonElement).disabled).toBe(true);
    expect(words(part("held"))).toBe(RESTORE_CREATE_VIEW_WORDS.heldClusterResources);
    expect(words(part("clusterResources-problem"))).toBe(RESTORE_WORDS.noClusterResources);
    fireEvent.click(part("clusterResources-none"));
    type(part("includedResources"), "pods, nodes");
    expect([...part("includedResources-problem").querySelectorAll("li")].map((item) => words(item))).toEqual([
      RESTORE_WORDS.nonRestorable("nodes"),
      RESTORE_WORDS.resourceLists("excludes list cannot contain an item in the includes list: nodes"),
    ]);
    expect(words(part("held"))).toBe(RESTORE_CREATE_VIEW_WORDS.held);
    type(part("includedResources"), "");
    type(field(), "taken");
    await waitFor(() => expect(words(part("name-taken"))).toBe(RESTORE_CREATE_VIEW_WORDS.nameTaken("taken")));
    expect(field().getAttribute("aria-describedby")).toBe(`${ID}-name-rule ${ID}-name-taken`);
    type(field(), "Taken");
    expect(field().getAttribute("aria-invalid")).toBe("true");
    type(field(), NAME);
    expect((part("ask") as HTMLButtonElement).disabled).toBe(false);
    // Escape in the name gives the proposal back: the backup and the clock in UTC, as when the form was opened.
    fireEvent.keyDown(field(), { key: "Escape" });
    expect(field().value).toMatch(/^nightly-\d{14}$/);
    expect((part("ask") as HTMLButtonElement).disabled).toBe(false);
    type(field(), NAME);
    fireEvent.keyDown(field(), { key: "Enter" });
    await waitFor(() => expect(main.confirms).toHaveLength(1));
    expect(main.confirms[0].args).toEqual([
      "cluster-a",
      A,
      TARGET,
      NAME,
      { clusterResources: "none", existingResourcePolicy: "none" },
    ]);
  });

  it("maps a namespace of the backup into another, refuses a source the backup does not hold, and takes a pair back", async () => {
    mount();
    await restoreOf("nightly");
    fireEvent.click(part("namespaceMapping-add"));
    type(part("namespaceMapping-source-0"), "web-test");
    type(part("namespaceMapping-target-0"), "web");
    expect(words(part("namespaceMapping-problem"))).toBe(RESTORE_WORDS.usedForNothing("web-test"));
    type(part("namespaceMapping-source-0"), "shop");
    expect(maybe("namespaceMapping-problem")).toBeNull();
    expect(useMapping()).toEqual([["shop", "web"]]);
    fireEvent.click(part("namespaceMapping-remove-0"));
    expect(maybe("namespaceMapping-pair-0")).toBeNull();
  });

  it("shows the text beside what it means, and creates the restore only once the name of the backup is typed as it is written", async () => {
    const { main } = mount();

    await restoreOf("nightly");
    await writesOn();
    await reviewed(main);
    expect(part("text").textContent).toBe(textOf({ clusterResources: "none", existingResourcePolicy: "none" }));
    // The text is a region the Tab key reaches, named by its title, whatever its length.
    expect(screen.getByRole("region", { name: RESTORE_CREATE_VIEW_WORDS.text })).toBe(part("text"));
    expect(part("text").tabIndex).toBe(0);
    expect(words(part("meaning").querySelector('[data-part="source"]') as Element)).toBe(
      "The restore takes the backup nightly, from the storage location default: Velero refuses the restore when the storage location of the backup is not Available.",
    );
    expect(focused()).toBe(`${ID}-review`);
    expect((part("create") as HTMLButtonElement).disabled).toBe(true);
    expect(words(part("typed-state"))).toBe(RESTORE_CREATE_VIEW_WORDS.notTyped("nightly"));
    type(part("typed"), "nightl");
    expect((part("create") as HTMLButtonElement).disabled).toBe(true);
    type(part("typed"), "nightly");
    expect((part("create") as HTMLButtonElement).disabled).toBe(false);
    expect(words(part("typed-state"))).toBe(RESTORE_CREATE_VIEW_WORDS.typed);
    // Escape in the field takes back what was typed, and leaves the review.
    fireEvent.keyDown(part("typed"), { key: "Escape" });
    expect([(part("typed") as HTMLInputElement).value, (part("create") as HTMLButtonElement).disabled]).toEqual([
      "",
      true,
    ]);
    type(part("typed"), "nightly");
    press("create");
    await waitFor(() => expect(main.runs).toHaveLength(1));
    expect(main.runs[0].args.slice(0, 6)).toEqual(["cluster-a", A, TARGET, NAME, "nightly", "token-1"]);
    expect(words(part("status"))).toBe(RESTORE_CREATE_VIEW_WORDS.running(NAME));
    await main.run({
      ok: true,
      value: { name: NAME, uid: "u", phase: "FailedValidation", errors: ["The BSL default is unavailable"] },
    });
    await waitFor(() => expect(maybe("result")).toBeTruthy());
    expect(words(part("phase"))).toBe(restoreResultWords("FailedValidation"));
    expect([...part("errors").querySelectorAll("li")].map((item) => item.textContent)).toEqual([
      "The BSL default is unavailable",
    ]);
    await waitFor(() => expect(focused()).toBe(`${ID}-result`));
    expect(main.shown).toEqual([main.runs[0].args[6]]);
    press("open");
    await waitFor(() =>
      expect(openViews()).toEqual([
        { kind: "backup", name: "nightly" },
        { kind: "restore", name: NAME },
      ]),
    );
  });

  it("keeps what was typed after a conflict, with the way to the restore that has the name", async () => {
    const { main } = mount();

    await restoreOf("nightly");
    await writesOn();
    await reviewed(main);
    type(part("typed"), "nightly");
    press("create");
    await waitFor(() => expect(main.runs).toHaveLength(1));
    await main.run({ ok: false, code: "conflict", stage: "creation", retry: false, text: "A restore is there." });
    await waitFor(() => expect(maybe("failure")).toBeTruthy());
    expect(part("failure").getAttribute("role")).toBe("alert");
    expect(field().value).toBe(NAME);
    expect((part("clusterResources-none") as HTMLInputElement).checked).toBe(true);
    expect(screen.getByTestId(`velero-open-restore-${NAME}`)).toBeTruthy();
    await waitFor(() => expect(focused()).toBe(`${ID}-ask`));
  });
});

describe("restore, opened from the address", () => {
  it("holds the review back for a backup that has not ended, with why, though the address opened its form", async () => {
    mount();
    await screen.findByTestId("velero-backups-create");
    act(() => openView({ kind: "restore-backup", name: "running" }));
    await screen.findByTestId("velero-restore-backup-workspace");
    await writesOn();
    await waitFor(() => expect(words(part("from-problem"))).toBe(backupOffered("InProgress").words));
    fireEvent.click(part("clusterResources-none"));
    expect((part("ask") as HTMLButtonElement).disabled).toBe(true);
  });

  it("chooses the backup of a schedule once the backups are read, when the form was opened before them", async () => {
    mount("schedules");
    act(() => openView({ kind: "restore-schedule", name: "daily" }));
    await screen.findByTestId("velero-restore-schedule-workspace");
    await waitFor(() => expect(field().value).toBe("daily-2-20261108110000"));
    expect((part("from-daily-2") as HTMLInputElement).checked).toBe(true);
  });
});

describe("restore, from the view of a schedule", () => {
  it("lists the backups of the schedule that ended well, the newest Completed chosen, and proposes the name again for another", async () => {
    const { main } = mount("schedules");

    await screen.findByTestId("velero-schedules-create");
    act(() => openView({ kind: "schedule", name: "daily" }));
    await screen.findByTestId("velero-schedule-restore");
    fireEvent.click(screen.getByTestId("velero-schedule-restore"));
    await screen.findByTestId("velero-restore-schedule-workspace");
    expect(openViews()).toEqual([
      { kind: "schedule", name: "daily" },
      { kind: "restore-schedule", name: "daily" },
    ]);
    expect(maybe("from-daily-3")).toBeNull();
    expect([
      (part("from-daily-2") as HTMLInputElement).checked,
      (part("from-daily-1") as HTMLInputElement).checked,
    ]).toEqual([true, false]);
    expect(field().value).toBe("daily-2-20261108110000");
    fireEvent.click(part("from-daily-1"));
    expect(field().value).toBe("daily-1-20261108110000");
    await writesOn();
    fireEvent.click(part("clusterResources-needed"));
    press("ask");
    await waitFor(() => expect(main.confirms).toHaveLength(1));
    expect(main.confirms[0].args.slice(2, 4)).toEqual([
      { kind: "Backup", name: "daily-1", uid: "daily-1-uid" },
      "daily-1-20261108110000",
    ]);
  });

  it("says that a schedule with no backup that ended well has none to restore, and offers no command", async () => {
    mount("schedules");
    await screen.findByTestId("velero-schedules-create");
    act(() => openView({ kind: "schedule", name: "empty" }));
    await screen.findByTestId("velero-schedule-restore");
    await waitFor(() =>
      expect(words(screen.getByTestId("velero-schedule-restore-none"))).toBe(
        RESTORE_CREATE_VIEW_WORDS.noBackup("empty"),
      ),
    );
    expect((screen.getByTestId("velero-schedule-restore") as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("what the form of a restore keeps, says and leads to", () => {
  it("keeps a name typed among the others as it is typed, key by key, a name the backup names among it, and the checkbox apart", async () => {
    const { main } = mount();

    await restoreOf("nightly");
    await writesOn();
    const typed = () => part("includedNamespaces-typed") as HTMLInputElement;

    for (const text of ["s", "sh", "sho", "shop", "shop-", "shop-2"]) {
      type(typed(), text);
      expect([text, typed().value]).toEqual([text, text]);
    }
    expect((part("includedNamespaces-shop") as HTMLInputElement).checked).toBe(false);
    fireEvent.click(part("includedNamespaces-shop"));
    expect([(part("includedNamespaces-shop") as HTMLInputElement).checked, typed().value]).toEqual([true, "shop-2"]);
    type(part("excludedNamespaces-typed"), "web-o");
    fireEvent.click(part("clusterResources-none"));
    press("ask");
    await waitFor(() => expect(main.confirms).toHaveLength(1));
    expect(main.confirms[0].args[4]).toEqual({
      includedNamespaces: ["shop", "shop-2"],
      excludedNamespaces: ["web-o"],
      clusterResources: "none",
      existingResourcePolicy: "none",
    });
  });

  it("takes the backup created again under its name for the one the form is of, and asks the review of it", async () => {
    const table: Record<string, Answer> = {};
    const { main, installation } = mount("backups", mainProcess(), table);

    await restoreOf("nightly");
    await writesOn();
    type(field(), "my-restore");
    table[path("backups", A)] = list({
      ...backup("nightly", "Completed"),
      metadata: { name: "nightly", namespace: A, uid: "nightly-uid-2" },
    });
    await act(() => installation.refresh());
    fireEvent.click(part("clusterResources-none"));
    press("ask");
    await waitFor(() => expect(main.confirms).toHaveLength(1));
    expect(main.confirms[0].args.slice(2, 4)).toEqual([
      { kind: "Backup", name: "nightly", uid: "nightly-uid-2" },
      "my-restore",
    ]);
  });

  it("chooses the newest backup of a schedule again when the form is asked again, and another when the one chosen went", async () => {
    const table: Record<string, Answer> = {};
    const { installation } = mount("schedules", mainProcess(), table);
    const daily = (...more: ReturnType<typeof backup>[]) =>
      list(
        backup("daily-1", "Completed", { schedule: "daily", start: "2026-11-06T03:00:00Z" }),
        backup("daily-2", "Completed", { schedule: "daily", start: "2026-11-07T03:00:00Z" }),
        ...more,
      );

    await screen.findByTestId("velero-schedules-create");
    act(() => openView({ kind: "schedule", name: "daily" }));
    await screen.findByTestId("velero-schedule-restore");
    fireEvent.click(screen.getByTestId("velero-schedule-restore"));
    await screen.findByTestId("velero-restore-schedule-workspace");
    expect((part("from-daily-2") as HTMLInputElement).checked).toBe(true);
    act(() => closeViews());
    table[path("backups", A)] = daily(
      backup("daily-4", "Completed", { schedule: "daily", start: "2026-11-08T05:00:00Z" }),
    );
    await act(() => installation.refresh());
    act(() => openView({ kind: "schedule", name: "daily" }));
    await screen.findByTestId("velero-schedule-restore");
    fireEvent.click(screen.getByTestId("velero-schedule-restore"));
    await screen.findByTestId("velero-restore-schedule-workspace");
    expect([(part("from-daily-4") as HTMLInputElement).checked, field().value]).toEqual([
      true,
      "daily-4-20261108110000",
    ]);
    // The one chosen expired: the newest that is left takes its place, and no backup is said to be missing.
    table[path("backups", A)] = daily();
    await act(() => installation.refresh());
    await waitFor(() => expect((part("from-daily-2") as HTMLInputElement).checked).toBe(true));
    expect(maybe("from-problem")).toBeNull();
  });

  it("says why there is no backup to restore as the read of the backups says it, in the form and in the view of a schedule", async () => {
    for (const [answer, said] of [
      [{ status: 403 }, RESTORE_CREATE_VIEW_WORDS.backupsForbidden],
      [{ status: 500 }, RESTORE_CREATE_VIEW_WORDS.backupsFailed],
      [list(backup("nightly", "Completed")), RESTORE_CREATE_VIEW_WORDS.backupMissing("gone", A)],
    ] as const) {
      mount("backups", mainProcess(), { [path("backups", A)]: answer as Answer });
      await screen.findByTestId("velero-backups-page");
      act(() => openView({ kind: "restore-backup", name: "gone" }));
      await screen.findByTestId("velero-restore-backup-workspace");
      await waitFor(() => expect(words(part("from-problem"))).toBe(said));
      expect(part("from").getAttribute("aria-describedby")).toBe(`${ID}-from-problem`);
      act(() => closeViews());
      cleanup();
    }
    mount("schedules", mainProcess(), { [path("backups", A)]: { status: 403 } });
    await screen.findByTestId("velero-schedules-create");
    act(() => openView({ kind: "schedule", name: "daily" }));
    await waitFor(() =>
      expect(words(screen.getByTestId("velero-schedule-restore-none"))).toBe(
        RESTORE_CREATE_VIEW_WORDS.backupsForbidden,
      ),
    );
  });

  it("names each field of a mapping by its place, marks the pair that is wrong, takes back on Escape, and moves the focus to the pair added and to the one that took the place of a pair removed", async () => {
    mount();
    await restoreOf("nightly");
    press("namespaceMapping-add");
    expect(focused()).toBe(`${ID}-namespaceMapping-source-0`);
    type(part("namespaceMapping-source-0"), "shop");
    type(part("namespaceMapping-target-0"), "shop-2");
    press("namespaceMapping-add");
    expect(focused()).toBe(`${ID}-namespaceMapping-source-1`);
    type(part("namespaceMapping-source-1"), "web-test");
    type(part("namespaceMapping-target-1"), "web-2");
    expect([
      part("namespaceMapping-source-0").getAttribute("aria-label"),
      part("namespaceMapping-target-1").getAttribute("aria-label"),
    ]).toEqual([RESTORE_CREATE_VIEW_WORDS.mappingSourceOf(1, 2), RESTORE_CREATE_VIEW_WORDS.mappingTargetOf(2, 2)]);
    expect([
      part("namespaceMapping-source-0").getAttribute("aria-invalid"),
      part("namespaceMapping-source-1").getAttribute("aria-invalid"),
    ]).toEqual([null, "true"]);
    expect(part("namespaceMapping-target-1").getAttribute("aria-describedby")).toBe(
      `${ID}-namespaceMapping-not-set ${ID}-namespaceMapping-problem`,
    );
    fireEvent.keyDown(part("namespaceMapping-target-1"), { key: "Escape" });
    expect(useMapping()).toEqual([
      ["shop", "shop-2"],
      ["web-test", ""],
    ]);
    expect(maybe("namespaceMapping")).toBeTruthy();
    press("namespaceMapping-remove-0");
    expect([useMapping(), focused()]).toEqual([[["web-test", ""]], `${ID}-namespaceMapping-source-0`]);
    press("namespaceMapping-remove-0");
    expect([useMapping(), focused()]).toEqual([[], `${ID}-namespaceMapping-add`]);
  });

  it("says that whether the host lists a target is not known before its store loaded the namespaces", async () => {
    const { main } = mount();

    runInAction(() => hostNamespacesLoaded.set(false));
    await restoreOf("nightly");
    await writesOn();
    press("namespaceMapping-add");
    type(part("namespaceMapping-source-0"), "shop");
    type(part("namespaceMapping-target-0"), "shop-2");
    await reviewed(main, {
      namespaceMapping: [["shop", "shop-2"]],
      clusterResources: "none",
      existingResourcePolicy: "none",
    });
    expect(words(part("meaning").querySelector('[data-part="mapping-shop"]') as Element)).toBe(
      "shop is restored into shop-2. Whether the host lists it is not known.",
    );
  });

  it("leads from the review to the resources of the backup, and from an end that is not known to the restore of its name", async () => {
    const { main } = mount();

    await restoreOf("nightly");
    await writesOn();
    await reviewed(main);
    expect(words(part("backup-resources"))).toBe(RESTORE_CREATE_VIEW_WORDS.backupResources("nightly"));
    type(part("typed"), "nightly");
    press("create");
    await waitFor(() => expect(main.runs).toHaveLength(1));
    await main.run({
      ok: false,
      code: "submission-unknown",
      stage: "creation",
      retry: false,
      text: "The API server did not answer.",
    });
    await waitFor(() => expect(maybe("failure-left")).toBeTruthy());
    expect(words(screen.getByTestId(`velero-open-restore-${NAME}`))).toBe(RESTORE_CREATE_VIEW_WORDS.lookFor(NAME));
    press("ask");
    await waitFor(() => expect(main.confirms).toHaveLength(2));
    await main.confirm(textOf({ clusterResources: "none", existingResourcePolicy: "none" }));
    await waitFor(() => expect(maybe("review")).toBeTruthy());
    fireEvent.click(part("backup-resources"));
    await waitFor(() => expect([openViews(), openTab()]).toEqual([[{ kind: "backup", name: "nightly" }], "resources"]));
  });

  it("lists the newest backups of a schedule, the one chosen among them, and says how many older ones it does not", async () => {
    const many = Array.from({ length: OFFERED_BOUND + 6 }, (_, at) =>
      backup(`hourly-${String(at).padStart(2, "0")}`, "Completed", {
        schedule: "hourly",
        start: new Date(Date.UTC(2026, 10, 7, at)).toISOString(),
      }),
    );

    mount("schedules", mainProcess(), {
      [path("backups", A)]: list(...many),
      [path("schedules", A)]: list(schedule("hourly")),
    });
    await screen.findByTestId("velero-schedules-create");
    act(() => openView({ kind: "restore-schedule", name: "hourly" }));
    await screen.findByTestId("velero-restore-schedule-workspace");
    await waitFor(() => expect(field().value).toBe("hourly-29-20261108110000"));
    expect(document.querySelectorAll(`[data-testid^="${ID}-from-hourly-"]`)).toHaveLength(OFFERED_BOUND);
    expect(words(part("from-older"))).toBe(RESTORE_CREATE_VIEW_WORDS.olderBackups(6));
    expect(part("from").getAttribute("aria-describedby")).toBe(`${ID}-from-older`);
    expect(maybe("from-hourly-05")).toBeNull();
  });

  it("leaves the review by Escape and by its command with the focus on the command that asks again, creates on Enter only once the name is typed, and leaves the review with the workspace", async () => {
    const { main, installation } = mount();

    await restoreOf("nightly");
    await writesOn();
    await reviewed(main);
    act(() => part("review").focus());
    fireEvent.keyDown(part("review"), { key: "Escape" });
    await waitFor(() => expect(maybe("review")).toBeNull());
    await waitFor(() => expect(focused()).toBe(`${ID}-ask`));
    press("ask");
    await waitFor(() => expect(main.confirms).toHaveLength(2));
    await main.confirm(textOf({ clusterResources: "none", existingResourcePolicy: "none" }));
    await waitFor(() => expect(maybe("review")).toBeTruthy());
    press("back");
    await waitFor(() => expect(maybe("review")).toBeNull());
    await waitFor(() => expect(focused()).toBe(`${ID}-ask`));
    press("ask");
    await waitFor(() => expect(main.confirms).toHaveLength(3));
    await main.confirm(textOf({ clusterResources: "none", existingResourcePolicy: "none" }));
    await waitFor(() => expect(maybe("review")).toBeTruthy());
    type(part("typed"), "nightl");
    fireEvent.keyDown(part("typed"), { key: "Enter" });
    expect(main.runs).toHaveLength(0);
    type(part("typed"), "nightly");
    // The workspace closes: its review goes, and nothing is created.
    act(() => closeViews());
    await waitFor(() => expect(installation.restoreCreate.step.state).toBe("form"));
    expect(main.runs).toHaveLength(0);
  });

  it("drops a review when writes go off, and says the ways to the writes with writes off", async () => {
    const { main, installation } = mount();

    await restoreOf("nightly");
    await writesOn();
    await reviewed(main);
    fireEvent.click(screen.getByTestId("velero-writes-off"));
    await waitFor(() => expect(maybe("review")).toBeNull());
    expect(installation.restoreCreate.step.state).toBe("form");
    expect(words(part("writes-off"))).toBe(RESTORE_CREATE_VIEW_WORDS.writesOff);
    press("to-target");
    expect(document.activeElement?.getAttribute("data-testid")).toBe("velero-writes-on");
  });

  it("says the gate of the cluster when it is not known, and holds the review back for a name not typed, with why", async () => {
    const main = mainProcess();

    main.gate.state = async () => ({
      ok: false,
      code: "request-failed",
      stage: "way",
      retry: true,
      text: "The views have no way to the main process.",
    });
    mount("backups", main);
    await restoreOf("nightly");
    await waitFor(() => expect(words(part("writes-off"))).toBe(BACKUP_CREATE_VIEW_WORDS.gateUnknown));
    expect(maybe("to-target")).toBeTruthy();
    cleanup();
    act(() => closeViews());
    mount();
    await restoreOf("nightly");
    await writesOn();
    fireEvent.click(part("clusterResources-none"));
    type(field(), "");
    expect([(part("ask") as HTMLButtonElement).disabled, words(part("held"))]).toEqual([
      true,
      RESTORE_CREATE_VIEW_WORDS.heldName,
    ]);
  });
});

// The mapping the form holds, as the inputs show it.
function useMapping(): [string, string][] {
  return [...document.querySelectorAll(`[data-testid^="${ID}-namespaceMapping-pair-"]`)].map((pair) => {
    const [source, target] = [...pair.querySelectorAll("input")].map((input) => (input as HTMLInputElement).value);

    return [source, target];
  });
}
