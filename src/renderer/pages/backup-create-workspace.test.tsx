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
  locationsReadWords,
  NOT_OFFERED,
  phaseWords,
  TEMPLATE_FIELD_WORDS,
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
  const actions: BackupNowClient &
    BackupCreateClient &
    ScheduleCreateClient &
    RestoreCreateClient &
    SchedulePatchClient &
    BackupDeleteClient = {
    confirmBackupDelete: async () => NOTHING,
    runBackupDelete: async () => NOTHING,
    confirmRestoreCreate: async () => NOTHING,
    runRestoreCreate: async () => NOTHING,
    confirmBackupNow: async () => NOTHING,
    runBackupNow: async () => NOTHING,
    confirmBackupCreate: (...args) => new Promise((answer) => confirms.push({ args, answer })),
    runBackupCreate: (...args) => new Promise((answer) => runs.push({ args, answer })),
    confirmScheduleCreate: async () => NOTHING,
    runScheduleCreate: async () => NOTHING,
    confirmSchedulePatch: async () => NOTHING,
    runSchedulePatch: async () => NOTHING,
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

// The answers of the cluster, and what a case answers in their place, which it may change while it runs.
function mount(main = mainProcess(), table: Record<string, Answer> = {}) {
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
    // Said at the field it is of, tied to it, and the review held back with the words of why.
    expect(words(part("includedNamespaces-problem"))).toBe(BACKUP_CREATE_VIEW_WORDS.labelledExcluded("legacy"));
    expect(part("includedNamespaces").getAttribute("aria-describedby")).toContain(`${ID}-includedNamespaces-problem`);
    expect((part("ask") as HTMLButtonElement).disabled).toBe(true);
    expect(part("ask").getAttribute("aria-describedby")).toBe(`${ID}-held`);
    expect(words(part("held"))).toBe(BACKUP_CREATE_VIEW_WORDS.held);
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
    // The text is a region the Tab key reaches, named by its title, whatever its length.
    expect(screen.getByRole("region", { name: BACKUP_CREATE_VIEW_WORDS.text })).toBe(part("text"));
    expect(part("text").tabIndex).toBe(0);
    const body = backupFromForm(A, "shop-by-hand", template);

    const snapshotLocations = [
      { name: "aws-east", provider: "aws" },
      { name: "aws-west", provider: "aws" },
      { name: "gcp", provider: "gcp" },
    ];

    expect([...part("meaning").querySelectorAll("li")].map((item) => item.textContent)).toEqual(
      (body ? backupCreateMeaning(body, { listed: ["shop", "web"], snapshotLocations }) : []).map((one) => one.words),
    );
    // The access mode of the location is not written, and is not said; the provider with two locations and none
    // chosen is (SPEC-0016, REQ-236).
    expect(part("meaning").textContent).not.toContain("access mode");
    expect(part("meaning").querySelector('[data-part="provider-aws"]')).toBeTruthy();
    expect(part("meaning").querySelector('[data-part="provider-gcp"]')).toBeNull();
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

// What is typed key by key, as the operator types it: each change is the field as it is now and one key more.
function typeByKey(element: HTMLElement, text: string) {
  for (const key of text) {
    const input = element as HTMLInputElement;

    fireEvent.change(input, { target: { value: `${input.value}${key}` } });
  }
}

describe("the form of the template, typed key by key and read by assistive technology", () => {
  it("keeps a selector as it is typed, key by key, its spaces among it, one or several", async () => {
    const { installation } = mount();

    await createBackup();
    fireEvent.change(choice("labelSelector-mode"), { target: { value: "one" } });
    typeByKey(part("labelSelector"), "app in (web,api)");
    expect([
      (part("labelSelector") as HTMLInputElement).value,
      installation.backupCreate.template.labelSelector,
    ]).toEqual(["app in (web,api)", "app in (web,api)"]);
    fireEvent.change(choice("labelSelector-mode"), { target: { value: "several" } });
    typeByKey(part("labelSelector"), " or tier=db");
    expect((part("labelSelector") as HTMLInputElement).value).toBe("app in (web,api) or tier=db");
    expect(installation.backupCreate.template).toMatchObject({ orLabelSelectors: ["app in (web,api)", "tier=db"] });
    expect(installation.backupCreate.template.labelSelector).toBeUndefined();
    // Escape takes back what was typed: no selector.
    fireEvent.keyDown(part("labelSelector"), { key: "Escape" });
    expect((part("labelSelector") as HTMLInputElement).value).toBe("");
    expect(installation.backupCreate.template.orLabelSelectors).toBeUndefined();
  });

  it("keeps the namespaces as they are typed, key by key, a name the host lists among the beginning of a pattern", async () => {
    const { installation } = mount();
    const typed = () => part("includedNamespaces-typed") as HTMLInputElement;
    const shop = () => part("includedNamespaces-shop") as HTMLInputElement;

    await createBackup();
    typeByKey(typed(), "shop-*");
    expect([typed().value, installation.backupCreate.template.includedNamespaces, shop().checked]).toEqual([
      "shop-*",
      ["shop-*"],
      false,
    ]);
    typeByKey(typed(), ", payments, payments-staging");
    expect(installation.backupCreate.template.includedNamespaces).toEqual(["shop-*", "payments", "payments-staging"]);
    // A checkbox chosen beside what is typed, and taken back.
    fireEvent.click(shop());
    expect(installation.backupCreate.template.includedNamespaces).toEqual([
      "shop",
      "shop-*",
      "payments",
      "payments-staging",
    ]);
    fireEvent.click(shop());
    expect(installation.backupCreate.template.includedNamespaces).toEqual(["shop-*", "payments", "payments-staging"]);
    // Escape takes back what was typed, and the checkboxes stay.
    fireEvent.click(shop());
    fireEvent.keyDown(typed(), { key: "Escape" });
    expect([typed().value, installation.backupCreate.template.includedNamespaces]).toEqual(["", ["shop"]]);
    // A name the host lists, typed whole, is its checkbox as well: taken back there, it goes from what was typed.
    fireEvent.click(shop());
    typeByKey(typed(), "shop");
    expect([shop().checked, installation.backupCreate.template.includedNamespaces]).toEqual([true, ["shop"]]);
    fireEvent.click(shop());
    expect([typed().value, installation.backupCreate.template.includedNamespaces]).toEqual(["", undefined]);
  });

  it("takes back with Escape what was typed in a list of resources and in a duration", async () => {
    const { installation } = mount();

    await createBackup();
    typeByKey(part("excludedResources"), "secrets, configmaps");
    typeByKey(part("ttl"), "48h");
    expect(installation.backupCreate.template).toMatchObject({
      excludedResources: ["secrets", "configmaps"],
      ttl: "48h",
    });
    fireEvent.keyDown(part("excludedResources"), { key: "Escape" });
    fireEvent.keyDown(part("ttl"), { key: "Escape" });
    expect(installation.backupCreate.template).toEqual({ storageLocation: "default" });
  });

  it("asks for the review with Enter in a field that is typed, and keeps the focus there", async () => {
    const { main } = mount();

    await createBackup();
    await writesOn();
    type(field(), "shop-by-hand");
    act(() => part("ttl").focus());
    typeByKey(part("ttl"), "48h");
    fireEvent.keyDown(part("ttl"), { key: "Enter" });
    await waitFor(() => expect(main.confirms).toHaveLength(1));
    expect(main.confirms[0].args[3]).toEqual({ storageLocation: "default", ttl: "48h" });
  });

  it("ties every note of a field to it, the choices by a group around them, and names no description that is not there", async () => {
    mount();
    await createBackup();
    type(part("excludedNamespaces-typed"), "*");
    const workspace = part("workspace");
    const named = [...workspace.querySelectorAll("[aria-describedby]")].flatMap((element) =>
      (element.getAttribute("aria-describedby") ?? "").split(" ").filter(Boolean),
    );

    expect(named.length).toBeGreaterThan(10);
    expect(named.filter((id) => !document.getElementById(id))).toEqual([]);
    expect(part("snapshotVolumes-group").getAttribute("aria-describedby")).toBe(`${ID}-snapshotVolumes-not-set`);
    expect(
      words(
        screen.getByTestId(`${ID}-snapshotVolumes-group`).querySelector(`#${ID}-snapshotVolumes-not-set`) as Element,
      ),
    ).toBe(`Not set: ${TEMPLATE_FIELD_WORDS.snapshotVolumes.notSet}`);
    expect(part("storageLocation-group").getAttribute("aria-describedby")).toBe(`${ID}-storageLocation-refused`);
    expect(part("excludedNamespaces-typed").getAttribute("aria-describedby")).toBe(
      `${ID}-excludedNamespaces-not-set ${ID}-excludedNamespaces-problem`,
    );
    expect(part("excludedNamespaces-typed").getAttribute("aria-invalid")).toBe("true");
  });

  it("says snapshot locations it may not read as not known, never as none, and holds the review back for storage locations it may not read", async () => {
    const denied: Answer = { status: 403, body: { kind: "Status", code: 403, reason: "Forbidden" } };

    mount(mainProcess(), {
      [path("snapshotLocations", A)]: denied,
      [path("storageLocations", A)]: denied,
    });
    await screen.findByTestId("velero-backups-create");
    fireEvent.click(screen.getByTestId("velero-backups-create"));
    await screen.findByTestId(`${ID}-workspace`);
    await writesOn();
    type(field(), "shop-by-hand");
    await waitFor(() =>
      expect(words(part("volumeSnapshotLocations-unknown"))).toBe(locationsReadWords("forbidden", "snapshot")),
    );
    expect(part("volumeSnapshotLocations").textContent).not.toContain("The installation has no snapshot location.");
    expect(words(part("storageLocation-problem"))).toBe(locationsReadWords("forbidden", "storage"));
    expect((part("ask") as HTMLButtonElement).disabled).toBe(true);
    expect(words(part("held"))).toBe(BACKUP_CREATE_VIEW_WORDS.held);
  });

  it("holds the review back when the location chosen cannot be chosen any more, and chooses none first when none is the default", async () => {
    const table: Record<string, Answer> = {};
    const { installation } = mount(mainProcess(), table);

    await createBackup();
    await writesOn();
    type(field(), "shop-by-hand");
    expect((part("ask") as HTMLButtonElement).disabled).toBe(false);
    table[path("storageLocations", A)] = list(
      storage("default", { spec: { default: true }, status: { phase: "Unavailable" } }),
      storage("second"),
    );
    await act(async () => {
      await installation.refresh();
    });
    await waitFor(() =>
      expect(words(part("storageLocation-problem"))).toBe(
        BACKUP_CREATE_VIEW_WORDS.chosenRefused(BACKUP_CREATE_VIEW_WORDS.unavailable("default")),
      ),
    );
    expect((part("ask") as HTMLButtonElement).disabled).toBe(true);
    // Another location chosen: the review opens.
    fireEvent.change(choice("storageLocation"), { target: { value: "second" } });
    expect((part("ask") as HTMLButtonElement).disabled).toBe(false);
    // The location chosen gone from the read.
    table[path("storageLocations", A)] = list(storage("default", { spec: { default: true } }));
    await act(async () => {
      await installation.refresh();
    });
    await waitFor(() =>
      expect(words(part("storageLocation-problem"))).toBe(BACKUP_CREATE_VIEW_WORDS.chosenGone("second")),
    );
  });

  it("chooses no location first when none is marked default, and asks for one", async () => {
    const { installation } = mount(mainProcess(), {
      [path("storageLocations", A)]: list(storage("first"), storage("second")),
    });

    await screen.findByTestId("velero-backups-create");
    fireEvent.click(screen.getByTestId("velero-backups-create"));
    await screen.findByTestId(`${ID}-workspace`);
    await waitFor(() =>
      expect([...choice("storageLocation").options].map((option) => option.value)).toContain("first"),
    );
    expect(installation.backupCreate.template.storageLocation).toBeUndefined();
    expect(words(part("storageLocation-problem"))).toBe(TEMPLATE_WORDS.noStorageLocation);
  });

  it("keeps one snapshot location for each provider, the one chosen last", async () => {
    const { installation } = mount();

    await createBackup();
    fireEvent.change(choice("volumeSnapshotLocations-aws"), { target: { value: "aws-east" } });
    fireEvent.change(choice("volumeSnapshotLocations-aws"), { target: { value: "aws-west" } });
    fireEvent.change(choice("volumeSnapshotLocations-gcp"), { target: { value: "gcp" } });
    expect(installation.backupCreate.template.volumeSnapshotLocations).toEqual(["aws-west", "gcp"]);
    fireEvent.change(choice("volumeSnapshotLocations-aws"), { target: { value: "" } });
    expect(installation.backupCreate.template.volumeSnapshotLocations).toEqual(["gcp"]);
  });

  it("ties the name to its rule and to the backup that has it, with the whole rule in words", async () => {
    mount();
    await createBackup();
    expect(words(screen.getByText(BACKUP_CREATE_VIEW_WORDS.nameRule))).toBe(BACKUP_CREATE_VIEW_WORDS.nameRule);
    expect(BACKUP_CREATE_VIEW_WORDS.nameRule).toContain("216 characters at most");
    expect(field().getAttribute("aria-describedby")).toBe(`${ID}-name-rule`);
    type(field(), "taken");
    await waitFor(() => expect(field().getAttribute("aria-describedby")).toBe(`${ID}-name-rule ${ID}-name-taken`));
  });

  it("disables the fields while the review is asked and the backup created, and moves the focus to what follows each step", async () => {
    const { main } = mount();

    await createBackup();
    await writesOn();
    type(field(), "shop-by-hand");
    press("ask");
    await waitFor(() => expect(main.confirms).toHaveLength(1));
    expect([field().disabled, (part("ttl") as HTMLInputElement).disabled]).toEqual([true, true]);
    expect(focused()).toBe(`${ID}-status`);
    await main.confirm(textOf("shop-by-hand", { storageLocation: "default" }));
    await waitFor(() => expect(focused()).toBe(`${ID}-review`));
    press("create");
    await waitFor(() => expect(main.runs).toHaveLength(1));
    expect(focused()).toBe(`${ID}-status`);
    // A failure is said to who does not see as it appears, and the focus goes to the command that asks again.
    await main.run({ ok: false, code: "conflict", stage: "creation", retry: false, text: "Taken." });
    await waitFor(() => expect(focused()).toBe(`${ID}-ask`));
    expect(part("failure").getAttribute("role")).toBe("alert");
    expect(field().disabled).toBe(false);
    press("ask");
    await waitFor(() => expect(main.confirms).toHaveLength(2));
    await main.confirm(textOf("shop-by-hand", { storageLocation: "default" }));
    await waitFor(() => expect(maybe("review")).toBeTruthy());
    press("create");
    await waitFor(() => expect(main.runs).toHaveLength(2));
    await main.run({ ok: true, value: { name: "shop-by-hand", uid: "u" } });
    await waitFor(() => expect(focused()).toBe(`${ID}-result`));
  });

  it("says the review with its context and namespace, and the namespaces typed that the host does not list", async () => {
    const { main } = mount();

    await createBackup();
    await writesOn();
    type(field(), "shop-by-hand");
    type(part("includedNamespaces-typed"), "web-*");
    press("ask");
    await waitFor(() => expect(main.confirms).toHaveLength(1));
    await main.confirm(textOf("shop-by-hand", { storageLocation: "default", includedNamespaces: ["web-*"] }));
    await waitFor(() => expect(maybe("review")).toBeTruthy());
    expect(words(part("review"))).toContain(`Namespace${A}`);
    expect(words(part("review"))).toContain("local-demo (context kind-local-demo)");
    expect(words(part("meaning").querySelector('[data-part="not-listed"]') as Element)).toBe(
      BACKUP_CREATE_VIEW_WORDS.notListed(["web-*"]),
    );
  });

  it("says a backup found by its name, one that may be there, a review that took the place of another, the errors left, and what Velero has not read", async () => {
    const { main } = mount();
    const ask = async (text: string) => {
      press("ask");
      await waitFor(() => expect(main.confirms.length).toBeGreaterThan(0));
      await main.confirm(text);
      await waitFor(() => expect(maybe("review")).toBeTruthy());
      press("create");
    };
    const text = textOf("shop-by-hand", { storageLocation: "default" });

    await createBackup();
    await writesOn();
    type(field(), "shop-by-hand");
    await ask(text);
    await waitFor(() => expect(main.runs).toHaveLength(1));
    await main.run({
      ok: true,
      value: { name: "shop-by-hand", uid: "u", found: true, phase: "FailedValidation", errors: ["e"], errorsLeft: 3 },
    });
    await waitFor(() => expect(maybe("result")).toBeTruthy());
    expect(words(part("found"))).toBe(BACKUP_CREATE_VIEW_WORDS.found);
    expect(words(part("errors-left"))).toBe(BACKUP_CREATE_VIEW_WORDS.errorsLeft(3));
    expect(words(part("result"))).toContain(BACKUP_CREATE_VIEW_WORDS.resolved);
    // The way to the backup takes the place of the workspace.
    press("open");
    await waitFor(() => expect(openViews()).toEqual([{ kind: "backup", name: "shop-by-hand" }]));
    act(() => closeViews());
    await createBackup();
    type(field(), "shop-by-hand");
    await ask(text);
    await waitFor(() => expect(main.runs).toHaveLength(2));
    await main.run({ ok: false, code: "submission-unknown", stage: "creation", retry: false, text: "Not known." });
    await waitFor(() => expect(words(part("failure-left"))).toBe(BACKUP_CREATE_VIEW_WORDS.unknownLeft));
    await ask(text);
    await waitFor(() => expect(main.runs).toHaveLength(3));
    await main.run({ ok: true, value: { name: "shop-by-hand", uid: "u" } });
    await waitFor(() => expect(words(part("phase"))).toBe(BACKUP_CREATE_VIEW_WORDS.unread));
  });
});
