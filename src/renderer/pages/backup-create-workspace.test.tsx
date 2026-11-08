// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { runInAction } from "mobx";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FIRST_VERSION_RESOURCES } from "../../../test/discovery";
import { hostNamespaces } from "../../../test/freelens-extensions";
import { confirmDialogs } from "../../../test/host-components";
import {
  BACKUP_CREATE_VIEW_WORDS,
  backupCreateMeaning,
  NOT_OFFERED,
  phaseWords,
} from "../../common/backup-create-words";
import { backupFromForm, formBodyText } from "../../common/backup-form";
import { TEMPLATE_WORDS } from "../../common/backup-template";
import { emptyPreferences, heldPreferences, RESOURCES } from "../../common/discovery";
import { closeViews, openViews } from "../navigation";
import { Installation } from "../state/installation";
import { BackupsPage } from "./backups-page";

import type { BackupTemplate } from "../../common/backup-template";
import type { Answer, Family } from "../../common/discovery";
import type { BackupCreated, Failure, GateState, Answer as IpcAnswer, WriteConfirmAnswer } from "../../common/ipc";
import type {
  ArtifactClient,
  BackupCreateClient,
  BackupNowClient,
  GateClient,
  KeptEndsClient,
  WriteClient,
} from "../api/ipc";

const DISCOVERY = "/apis/velero.io/v1";
const LOCATIONS = "/apis/velero.io/v1/backupstoragelocations";
const A = "velero-a";
const NOW = Date.UTC(2026, 10, 8, 11, 0, 0);
const ID = "velero-backup-create";

function path(family: Family, namespace: string): string {
  return `/apis/velero.io/v1/namespaces/${namespace}/${RESOURCES[family]}`;
}

function list(...items: unknown[]): Answer {
  return { status: 200, body: { items } };
}

const storage = (name: string, more: { spec?: object; status?: object } = {}) => ({
  apiVersion: "velero.io/v1",
  kind: "BackupStorageLocation",
  metadata: { name, namespace: A, uid: `${name}-uid` },
  spec: { provider: "aws", objectStorage: { bucket: "bucket" }, ...more.spec },
  status: { phase: "Available", ...more.status },
});

const snapshot = (name: string, provider: string) => ({
  apiVersion: "velero.io/v1",
  kind: "VolumeSnapshotLocation",
  metadata: { name, namespace: A, uid: `${name}-uid` },
  spec: { provider },
});

const backup = (name: string) => ({
  apiVersion: "velero.io/v1",
  kind: "Backup",
  metadata: { name, namespace: A, uid: `${name}-uid` },
  spec: {},
  status: { phase: "Completed" },
});

function answers(): Record<string, Answer> {
  return {
    [DISCOVERY]: { status: 200, body: { resources: FIRST_VERSION_RESOURCES.map((name) => ({ name })) } },
    [LOCATIONS]: list(storage("default", { spec: { default: true } })),
    [path("backups", A)]: list(backup("taken")),
    [path("restores", A)]: list(),
    [path("schedules", A)]: list(),
    [path("storageLocations", A)]: list(
      storage("default", { spec: { default: true } }),
      storage("archive", { spec: { accessMode: "ReadOnly" } }),
      storage("away", { status: { phase: "Unavailable" } }),
      storage("second"),
    ),
    [path("snapshotLocations", A)]: list(
      snapshot("aws-east", "aws"),
      snapshot("aws-west", "aws"),
      snapshot("gcp", "gcp"),
    ),
  };
}

const NOTHING: Failure = { ok: false, code: "request-failed", stage: "request", retry: false, text: "Not asked." };

// The text the main process writes for a backup of the form, as it writes it.
function textOf(name: string, template: BackupTemplate): string {
  const body = backupFromForm(A, name, template);

  if (!body) throw new Error("The template of the test is refused");
  return formBodyText(body);
}

// The main process: the gate, and the confirmations and runs of a backup of the form, which wait until the test
// answers them.
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
  const actions: BackupNowClient & BackupCreateClient = {
    confirmBackupNow: async () => NOTHING,
    runBackupNow: async () => NOTHING,
    confirmBackupCreate: (...args) => new Promise((answer) => confirms.push({ args, answer })),
    runBackupCreate: (...args) => new Promise((answer) => runs.push({ args, answer })),
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
  const view = render(<BackupsPage installation={installation} />);

  return { installation, main, view };
}

const part = (id: string) => screen.getByTestId(`${ID}-${id}`);
const maybe = (id: string) => screen.queryByTestId(`${ID}-${id}`);
const focused = () => document.activeElement?.getAttribute("data-testid");
const field = () => part("field") as HTMLInputElement;
const choice = (id: string) => document.getElementById(`${ID}-${id}`) as HTMLSelectElement;
const press = (id: string) => {
  act(() => part(id).focus());
  fireEvent.click(part(id));
};

function words(element: Element): string {
  const copy = element.cloneNode(true) as Element;

  for (const mark of copy.querySelectorAll(".Icon")) mark.remove();
  return (copy.textContent ?? "").replace(/\s+/g, " ").trim();
}

async function createBackup() {
  await screen.findByTestId("velero-backups-create");
  fireEvent.click(screen.getByTestId("velero-backups-create"));
  await screen.findByTestId(`${ID}-workspace`);
  // The locations are read: the default is chosen.
  await waitFor(() => expect(choice("storageLocation").value).toBe("default"));
}

async function writesOn() {
  await waitFor(() => expect(screen.getByTestId("velero-writes-on")).toBeTruthy());
  fireEvent.click(screen.getByTestId("velero-writes-on"));
  await act(async () => {
    await confirmDialogs.at(-1)?.ok?.();
  });
  await waitFor(() => expect(screen.getByTestId("velero-writes").getAttribute("data-writes")).toBe("on"));
}

function type(element: HTMLElement, value: string) {
  fireEvent.change(element, { target: { value } });
}

beforeEach(() => {
  vi.setSystemTime(NOW);
  runInAction(() => hostNamespaces.replace([{ name: "shop" }, { name: "web" }]));
});

afterEach(() => {
  act(() => closeViews());
  cleanup();
  confirmDialogs.length = 0;
  runInAction(() => hostNamespaces.clear());
  vi.useRealTimers();
});

describe("create backup, from the list of the Backups", () => {
  it("opens the form over the list, named in the address, from the one command of the list, with writes off", async () => {
    mount();
    await screen.findByTestId("velero-backups-create");
    // The command is after the count of the host, whose panel says the count alone.
    const panel = document.querySelector("[data-testid=velero-backups] .info-panel");

    await waitFor(() => expect(panel?.textContent).toMatch(/^\d+ items?$/));
    expect(panel?.contains(screen.getByTestId("velero-backups-create"))).toBe(false);
    await createBackup();
    expect(openViews()).toEqual([{ kind: "backup-create", name: "new" }]);
    expect(screen.getByTestId(`${ID}-name`).textContent).toBe("Create backup");
    // The name is the operator's: none is proposed.
    expect(field().value).toBe("");
    expect(words(part("what"))).toBe(BACKUP_CREATE_VIEW_WORDS.what(A));
    expect(words(part("writes-off"))).toBe(BACKUP_CREATE_VIEW_WORDS.writesOff);
    expect(maybe("ask")).toBeNull();
    expect(words(part("not-offered"))).toBe(NOT_OFFERED);
    // The way back is to the list, as it was.
    fireEvent.click(screen.getByTestId("velero-back"));
    await waitFor(() => expect(maybe("workspace")).toBeNull());
    expect(openViews()).toEqual([]);
  });

  it("offers the storage locations the backup can go to, the default first, and says why the others cannot be chosen", async () => {
    mount();
    await createBackup();
    expect([...choice("storageLocation").options].map((option) => option.textContent)).toEqual([
      "Choose a location",
      "default, marked default",
      "second",
    ]);
    expect(words(part("storageLocation-refused-archive"))).toBe(BACKUP_CREATE_VIEW_WORDS.readOnly("archive"));
    expect(words(part("storageLocation-refused-away"))).toBe(BACKUP_CREATE_VIEW_WORDS.unavailable("away"));
    // One snapshot location for each provider, or none.
    expect([...choice("volumeSnapshotLocations-aws").options].map((option) => option.value)).toEqual([
      "",
      "aws-east",
      "aws-west",
    ]);
    expect([...choice("volumeSnapshotLocations-gcp").options].map((option) => option.value)).toEqual(["", "gcp"]);
  });

  it("offers the namespaces the host lists and the patterns typed, and holds the review back for one labelled to be excluded", async () => {
    runInAction(() =>
      hostNamespaces.replace([
        { name: "shop" },
        { name: "legacy", labels: { "velero.io/exclude-from-backup": "true" } },
      ]),
    );
    const { installation } = mount();

    await createBackup();
    await writesOn();
    type(field(), "shop-by-hand");
    fireEvent.click(part("includedNamespaces-shop"));
    type(part("includedNamespaces-typed"), "web-*, shop-2");
    expect(installation.backupCreate.template.includedNamespaces).toEqual(["shop", "web-*", "shop-2"]);
    expect((part("ask") as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(part("includedNamespaces-legacy"));
    expect(words(part("blockers"))).toBe(BACKUP_CREATE_VIEW_WORDS.labelledExcluded("legacy"));
    expect((part("ask") as HTMLButtonElement).disabled).toBe(true);
  });

  it("refuses what the release refuses, field by field, with its words tied to the field, and holds the review back", async () => {
    mount();
    await createBackup();
    await writesOn();
    type(field(), "shop-by-hand");
    type(part("excludedNamespaces-typed"), "*");
    expect([...part("excludedNamespaces-problem").querySelectorAll("li")].map((item) => item.textContent)).toEqual([
      TEMPLATE_WORDS.namespaceLists("excludes list cannot contain '*'"),
      TEMPLATE_WORDS.namespaceLists("excludes list cannot contain an item in the includes list: *"),
    ]);
    expect(part("excludedNamespaces").getAttribute("aria-describedby")).toContain(`${ID}-excludedNamespaces-problem`);
    expect((part("ask") as HTMLButtonElement).disabled).toBe(true);
    type(part("excludedNamespaces-typed"), "");
    type(part("ttl"), "1d");
    expect(words(part("ttl-problem"))).toBe(TEMPLATE_WORDS.duration("1d"));
    type(part("ttl"), "48h");
    expect(words(part("ttl-written"))).toBe("Written as 48h0m0s.");
    expect((part("ask") as HTMLButtonElement).disabled).toBe(false);
  });

  it("says a name already read in the installation before the review, and a name the API server refuses", async () => {
    mount();
    await createBackup();
    type(field(), "taken");
    await waitFor(() => expect(words(part("name-taken"))).toBe(BACKUP_CREATE_VIEW_WORDS.nameTaken("taken")));
    type(field(), "Taken");
    expect(maybe("name-problem")).toBeTruthy();
    expect(field().getAttribute("aria-invalid")).toBe("true");
  });

  it("asks for the review with the name and the fields set, shows the text beside what it means, and creates nothing for a review that is left", async () => {
    const { main } = mount();

    await createBackup();
    await writesOn();
    type(field(), "shop-by-hand");
    fireEvent.click(part("includedNamespaces-shop"));
    type(part("ttl"), "48h");
    press("ask");
    await waitFor(() => expect(main.confirms).toHaveLength(1));
    const template = { includedNamespaces: ["shop"], storageLocation: "default", ttl: "48h" };

    expect(main.confirms[0].args).toEqual(["cluster-a", A, "shop-by-hand", template]);
    const text = textOf("shop-by-hand", template);

    await main.confirm(text);
    await waitFor(() => expect(maybe("review")).toBeTruthy());
    expect(part("text").textContent).toBe(text);
    const body = backupFromForm(A, "shop-by-hand", template);

    expect([...part("meaning").querySelectorAll("li")].map((item) => item.textContent)).toEqual(
      (body ? backupCreateMeaning(body, { accessMode: "Not set", listed: ["shop", "web"] }) : []).map(
        (one) => one.words,
      ),
    );
    // The review has the focus, not the command that creates; Escape leaves it, and the form is as it was.
    expect(focused()).toBe(`${ID}-review`);
    fireEvent.keyDown(part("review"), { key: "Escape" });
    await waitFor(() => expect(maybe("review")).toBeNull());
    expect(field().value).toBe("shop-by-hand");
    expect(main.runs).toHaveLength(0);
  });

  it("drops the review when a field changes", async () => {
    const { main } = mount();

    await createBackup();
    await writesOn();
    type(field(), "shop-by-hand");
    press("ask");
    await waitFor(() => expect(main.confirms).toHaveLength(1));
    await main.confirm(textOf("shop-by-hand", { storageLocation: "default" }));
    await waitFor(() => expect(maybe("review")).toBeTruthy());
    act(() => {
      main.confirms.length = 0;
    });
    fireEvent.keyDown(part("review"), { key: "Escape" });
    await waitFor(() => expect(maybe("review")).toBeNull());
    fireEvent.change(choice("snapshotVolumes"), { target: { value: "false" } });
    expect(maybe("review")).toBeNull();
    expect(main.runs).toHaveLength(0);
  });

  it("creates the backup with the token of its review, and says what Velero wrote: its place in the queue, and each error of a validation", async () => {
    const { main } = mount();

    await createBackup();
    await writesOn();
    type(field(), "shop-by-hand");
    press("ask");
    await waitFor(() => expect(main.confirms).toHaveLength(1));
    await main.confirm(textOf("shop-by-hand", { storageLocation: "default" }));
    await waitFor(() => expect(maybe("review")).toBeTruthy());
    press("create");
    await waitFor(() => expect(main.runs).toHaveLength(1));
    expect(main.runs[0].args.slice(0, 4)).toEqual(["cluster-a", A, "shop-by-hand", "token-1"]);
    await main.run({ ok: true, value: { name: "shop-by-hand", uid: "u", phase: "Queued", position: 2 } });
    await waitFor(() => expect(maybe("result")).toBeTruthy());
    expect(words(part("phase"))).toBe(phaseWords("Queued", 2));
    expect(words(part("phase"))).toBe("Velero wrote its phase: Queued, number 2 in the queue.");
    expect(main.shown).toEqual([main.runs[0].args[4]]);
  });

  it("says each error of a validation Velero refused the backup with", async () => {
    const { main } = mount();

    await createBackup();
    await writesOn();
    type(field(), "shop-by-hand");
    press("ask");
    await waitFor(() => expect(main.confirms).toHaveLength(1));
    await main.confirm(textOf("shop-by-hand", { storageLocation: "default" }));
    await waitFor(() => expect(maybe("review")).toBeTruthy());
    press("create");
    await waitFor(() => expect(main.runs).toHaveLength(1));
    const errors = ["Invalid included/excluded namespace lists: excludes list cannot contain '*'"];

    await main.run({ ok: true, value: { name: "shop-by-hand", uid: "u", phase: "FailedValidation", errors } });
    await waitFor(() => expect(maybe("result")).toBeTruthy());
    expect(words(part("phase"))).toBe(phaseWords("FailedValidation"));
    expect([...part("errors").querySelectorAll("li")].map((item) => item.textContent)).toEqual(errors);
  });

  it("keeps the name of a conflict, with the way to the backup that has it", async () => {
    const { main } = mount();

    await createBackup();
    await writesOn();
    type(field(), "taken");
    press("ask");
    await waitFor(() => expect(main.confirms).toHaveLength(1));
    await main.confirm(textOf("taken", { storageLocation: "default" }));
    await waitFor(() => expect(maybe("review")).toBeTruthy());
    press("create");
    await waitFor(() => expect(main.runs).toHaveLength(1));
    await main.run({
      ok: false,
      code: "conflict",
      stage: "creation",
      retry: false,
      text: "A backup named taken is already there, and is left as it is: nothing was created.",
    });
    await waitFor(() => expect(maybe("failure")).toBeTruthy());
    expect(field().value).toBe("taken");
    expect(screen.getByTestId("velero-open-backup-taken")).toBeTruthy();
  });

  it("gives a new form from the command once the backup was created, and the form as it was left before", async () => {
    const { main } = mount();

    await createBackup();
    await writesOn();
    type(field(), "shop-by-hand");
    type(screen.getByTestId(`${ID}-ttl`), "1h");
    // Left and asked again before the creation: the form as it was.
    act(() => closeViews());
    await createBackup();
    expect([field().value, (screen.getByTestId(`${ID}-ttl`) as HTMLInputElement).value]).toEqual([
      "shop-by-hand",
      "1h",
    ]);
    press("ask");
    await waitFor(() => expect(main.confirms).toHaveLength(1));
    await main.confirm(textOf("shop-by-hand", { storageLocation: "default", ttl: "1h" }));
    await waitFor(() => expect(maybe("review")).toBeTruthy());
    press("create");
    await waitFor(() => expect(main.runs).toHaveLength(1));
    await main.run({ ok: true, value: { name: "shop-by-hand", uid: "u", phase: "New" } });
    await waitFor(() => expect(maybe("result")).toBeTruthy());
    // Asked again once it was created: a new form, the default location chosen first again.
    act(() => closeViews());
    await createBackup();
    expect([maybe("result"), field().value, (screen.getByTestId(`${ID}-ttl`) as HTMLInputElement).value]).toEqual([
      null,
      "",
      "",
    ]);
    expect(field().disabled).toBe(false);
  });

  it("takes back what was typed in the name with Escape, and the workspace stays", async () => {
    mount();
    await createBackup();
    type(field(), "shop-by-hand");
    fireEvent.keyDown(field(), { key: "Escape" });
    expect(field().value).toBe("");
    expect(maybe("workspace")).toBeTruthy();
  });
});
