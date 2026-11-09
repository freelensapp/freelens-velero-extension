// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { runInAction } from "mobx";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FIRST_VERSION_RESOURCES } from "../../../test/discovery";
import { hostNamespaces } from "../../../test/freelens-extensions";
import { confirmDialogs } from "../../../test/host-components";
import { BACKUP_CREATE_VIEW_WORDS, locationsReadWords } from "../../common/backup-create-words";
import { emptyPreferences, heldPreferences, RESOURCES } from "../../common/discovery";
import { keptEndWords } from "../../common/kept-end-words";
import {
  FLAG_LABELS,
  FLAG_NOTES,
  SCHEDULE_CREATE_VIEW_WORDS,
  scheduleResultWords,
} from "../../common/schedule-create-words";
import { SCHEDULE_FORM_WORDS, scheduleBodyText, scheduleFromForm } from "../../common/schedule-form";
import { closeViews, openViews } from "../navigation";
import { Installation } from "../state/installation";
import { SchedulesPage } from "./schedules-page";

import type { BackupTemplate } from "../../common/backup-template";
import type { Answer, Family } from "../../common/discovery";
import type {
  Failure,
  GateState,
  Answer as IpcAnswer,
  KeptEnd,
  ScheduleCreated,
  WriteConfirmAnswer,
} from "../../common/ipc";
import type { ScheduleWrapper } from "../../common/schedule-form";
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
// Sunday 8 November 2026, 12:00 UTC: 13:00 in Rome.
const NOW = Date.UTC(2026, 10, 8, 12, 0, 0);
const ID = "velero-schedule-create";
const WRAPPER: ScheduleWrapper = {
  expression: "CRON_TZ=Europe/Rome 0 3 * * *",
  paused: false,
  skipImmediately: false,
  useOwnerReferencesInBackup: false,
};

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
    [LOCATIONS]: list(storage("default", { spec: { default: true } })),
    [path("backups", A)]: list(),
    [path("restores", A)]: list(),
    [path("schedules", A)]: list(schedule("taken")),
    [path("storageLocations", A)]: list(storage("default", { spec: { default: true } }), storage("second")),
    [path("snapshotLocations", A)]: list(),
  };
}

const NOTHING: Failure = { ok: false, code: "request-failed", stage: "request", retry: false, text: "Not asked." };

function textOf(name: string, wrapper: ScheduleWrapper, template: BackupTemplate): string {
  const body = scheduleFromForm(A, name, wrapper, template, NOW);

  if (!body) throw new Error("The form of the test is refused");
  return scheduleBodyText(body);
}

function mainProcess() {
  let state: GateState = {
    cluster: { id: "cluster-a", name: "local-demo", context: "kind-local-demo" },
    writes: { on: false },
  };
  const confirms: { args: unknown[]; answer: (answer: IpcAnswer<WriteConfirmAnswer>) => void }[] = [];
  const runs: { args: unknown[]; answer: (answer: IpcAnswer<ScheduleCreated>) => void }[] = [];
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
  const kept: KeptEnd[] = [];
  const keptEnds: KeptEndsClient = {
    ends: async () => ({ ok: true, value: [...kept] }),
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
    confirmBackupCreate: async () => NOTHING,
    runBackupCreate: async () => NOTHING,
    confirmScheduleCreate: (...args) => new Promise((answer) => confirms.push({ args, answer })),
    runScheduleCreate: (...args) => new Promise((answer) => runs.push({ args, answer })),
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
    kept,
    confirms,
    runs,
    confirm: (text: string) =>
      settle(confirms.at(-1), { ok: true, value: { token: `token-${confirms.length}`, expires: NOW + 30_000, text } }),
    run: (answer: IpcAnswer<ScheduleCreated>) => settle(runs.at(-1), answer),
  };
}

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
  const view = render(<SchedulesPage installation={installation} />);

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

async function createSchedule() {
  await screen.findByTestId("velero-schedules-create");
  fireEvent.click(screen.getByTestId("velero-schedules-create"));
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

describe("create schedule, from the list of the Schedules", () => {
  it("opens the form over the list, named in the address, from the one command of the list, with writes off", async () => {
    mount();
    await screen.findByTestId("velero-schedules-create");
    const panel = document.querySelector("[data-testid=velero-schedules] .info-panel");

    await waitFor(() => expect(panel?.textContent).toMatch(/^\d+ items?$/));
    expect(panel?.contains(screen.getByTestId("velero-schedules-create"))).toBe(false);
    await createSchedule();
    expect(openViews()).toEqual([{ kind: "schedule-create", name: "new" }]);
    expect(screen.getByTestId(`${ID}-name`).textContent).toBe("Create schedule");
    expect([field().value, (part("expression") as HTMLInputElement).value]).toEqual(["", ""]);
    for (const flag of ["paused", "skipImmediately", "useOwnerReferencesInBackup"] as const) {
      expect([flag, (part(flag) as HTMLInputElement).checked]).toEqual([flag, false]);
      // Named by its label alone, and described by its note, which is not in the label.
      expect(words(part(flag).closest("label") as Element)).toBe(FLAG_LABELS[flag]);
      expect(part(flag).getAttribute("aria-describedby")).toBe(`${ID}-${flag}-note`);
      expect(words(document.getElementById(`${ID}-${flag}-note`) as Element)).toBe(FLAG_NOTES[flag]);
      expect(
        part(flag)
          .closest("label")
          ?.contains(part(`${flag}-note`)),
      ).toBe(false);
    }
    expect(words(part("writes-off"))).toBe(SCHEDULE_CREATE_VIEW_WORDS.writesOff);
    expect(maybe("ask")).toBeNull();
    fireEvent.click(screen.getByTestId("velero-back"));
    await waitFor(() => expect(maybe("workspace")).toBeNull());
    expect(openViews()).toEqual([]);
  });

  it("says what Velero would refuse of the expression, tied to it, and holds the review back with why", async () => {
    mount();
    await createSchedule();
    await writesOn();
    type(field(), "nightly-shop");
    expect(words(part("held"))).toBe(SCHEDULE_CREATE_VIEW_WORDS.heldExpression);
    type(part("expression"), "0 3 * *");
    expect(words(part("expression-problem"))).toBe(
      SCHEDULE_CREATE_VIEW_WORDS.expressionRefused("invalid schedule: expected exactly 5 fields, found 4: [0 3 * *]"),
    );
    expect(part("expression").getAttribute("aria-describedby")).toBe(`${ID}-expression-rule ${ID}-expression-problem`);
    expect(part("expression").getAttribute("aria-invalid")).toBe("true");
    expect((part("ask") as HTMLButtonElement).disabled).toBe(true);
    // An expression Velero would take, which the main process refuses, is said in the words of the main process.
    type(part("expression"), "@none");
    expect(words(part("expression-problem"))).toBe(SCHEDULE_FORM_WORDS.noInstant);
    expect(words(part("held"))).toBe(SCHEDULE_CREATE_VIEW_WORDS.held);
    type(part("expression"), WRAPPER.expression);
    expect(maybe("expression-problem")).toBeNull();
    expect((part("ask") as HTMLButtonElement).disabled).toBe(false);
    // Escape takes back what was typed.
    fireEvent.keyDown(part("expression"), { key: "Escape" });
    expect((part("expression") as HTMLInputElement).value).toBe("");
  });

  it("asks for the review with Enter in the expression, with the wrapper typed, and the fields wait while it is asked", async () => {
    const { main } = mount();

    await createSchedule();
    await writesOn();
    type(field(), "nightly-shop");
    act(() => part("expression").focus());
    type(part("expression"), WRAPPER.expression);
    fireEvent.keyDown(part("expression"), { key: "Enter" });
    await waitFor(() => expect(main.confirms).toHaveLength(1));
    expect(main.confirms[0].args[3]).toEqual(WRAPPER);
    for (const id of ["field", "expression", "paused", "skipImmediately", "useOwnerReferencesInBackup"])
      expect([id, (part(id) as HTMLInputElement).disabled]).toEqual([id, true]);
    expect(words(part("status"))).toBe(SCHEDULE_CREATE_VIEW_WORDS.asking);
  });

  it("asks for the review with Enter in the name, and takes back what was typed with Escape there", async () => {
    const { main } = mount();

    await createSchedule();
    await writesOn();
    type(part("expression"), WRAPPER.expression);
    type(field(), "nightly-shop");
    fireEvent.keyDown(field(), { key: "Escape" });
    expect(field().value).toBe("");
    expect(maybe("workspace")).toBeTruthy();
    type(field(), "nightly-shop");
    act(() => field().focus());
    fireEvent.keyDown(field(), { key: "Enter" });
    await waitFor(() => expect(main.confirms).toHaveLength(1));
    expect(main.confirms[0].args[2]).toBe("nightly-shop");
  });

  it("says a name already read in the installation before the review, and one every backup could not carry", async () => {
    mount();
    await createSchedule();
    type(field(), "taken");
    await waitFor(() => expect(words(part("name-taken"))).toBe(SCHEDULE_CREATE_VIEW_WORDS.nameTaken("taken")));
    expect(field().getAttribute("aria-describedby")).toBe(`${ID}-name-rule ${ID}-name-taken`);
    type(field(), "a".repeat(64));
    expect(words(part("name-problem"))).toBe(SCHEDULE_FORM_WORDS.nameLong(64));
    expect(field().getAttribute("aria-invalid")).toBe("true");
    expect(field().getAttribute("aria-describedby")).toBe(`${ID}-name-rule ${ID}-name-problem`);
  });

  it("holds the review back while the storage locations of the installation cannot be read, with why", async () => {
    const denied: Answer = { status: 403, body: { kind: "Status", code: 403, reason: "Forbidden" } };
    const { main, installation } = mount(mainProcess(), {
      [path("storageLocations", A)]: denied,
      [LOCATIONS]: denied,
    });

    await screen.findByTestId("velero-schedules-create");
    fireEvent.click(screen.getByTestId("velero-schedules-create"));
    await screen.findByTestId(`${ID}-workspace`);
    await writesOn();
    type(field(), "nightly-shop");
    type(part("expression"), WRAPPER.expression);
    await waitFor(() =>
      expect(words(part("storageLocation-problem"))).toBe(locationsReadWords("forbidden", "storage")),
    );
    expect((part("ask") as HTMLButtonElement).disabled).toBe(true);
    expect(words(part("held"))).toBe(SCHEDULE_CREATE_VIEW_WORDS.held);
    // A location the form holds from before does not open the review while the locations cannot be read.
    act(() => installation.scheduleCreate.set("storageLocation", "default"));
    expect((part("ask") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.keyDown(part("expression"), { key: "Enter" });
    expect(main.confirms).toHaveLength(0);
  });

  it("asks for the review with the name, the wrapper and the fields set, and shows the text beside the runs to come in its zone", async () => {
    const { main } = mount();

    await createSchedule();
    await writesOn();
    type(field(), "nightly-shop");
    type(part("expression"), WRAPPER.expression);
    fireEvent.click(part("skipImmediately"));
    fireEvent.click(part("includedNamespaces-shop"));
    press("ask");
    await waitFor(() => expect(main.confirms).toHaveLength(1));
    const wrapper = { ...WRAPPER, skipImmediately: true };
    const template = { includedNamespaces: ["shop"], storageLocation: "default" };

    expect(main.confirms[0].args).toEqual(["cluster-a", A, "nightly-shop", wrapper, template]);
    const text = textOf("nightly-shop", wrapper, template);

    await main.confirm(text);
    await waitFor(() => expect(maybe("review")).toBeTruthy());
    expect(part("text").textContent).toBe(text);
    expect(words(part("meaning").querySelector('[data-part="runs"]') as Element)).toBe(
      "The next 5 runs, counted from now, the creation a moment later: 2026-11-09 03:00 Europe/Rome (UTC+01:00); 2026-11-10 03:00 Europe/Rome (UTC+01:00); 2026-11-11 03:00 Europe/Rome (UTC+01:00); 2026-11-12 03:00 Europe/Rome (UTC+01:00); 2026-11-13 03:00 Europe/Rome (UTC+01:00).",
    );
    expect(words(part("meaning").querySelector('[data-part="flag-skipImmediately"]') as Element)).toMatch(
      /^Skip immediately: true\./,
    );
    expect(words(part("review"))).toContain("local-demo (context kind-local-demo)");
    expect(focused()).toBe(`${ID}-review`);
    fireEvent.keyDown(part("review"), { key: "Escape" });
    await waitFor(() => expect(maybe("review")).toBeNull());
    expect(field().value).toBe("nightly-shop");
    expect(main.runs).toHaveLength(0);
  });

  it("says why the runs are not known when the expression names no zone, and the way out on the expression typed", async () => {
    const { main } = mount();

    await createSchedule();
    await writesOn();
    type(field(), "nightly-shop");
    type(part("expression"), "0 3 * * *");
    press("ask");
    await waitFor(() => expect(main.confirms).toHaveLength(1));
    await main.confirm(textOf("nightly-shop", { ...WRAPPER, expression: "0 3 * * *" }, { storageLocation: "default" }));
    await waitFor(() => expect(maybe("review")).toBeTruthy());
    expect(words(part("meaning").querySelector('[data-part="zone"]') as Element)).toMatch(
      /^The next runs are not known: the expression names no zone, .*CRON_TZ=<zone> 0 3 \* \* \*\.$/,
    );
    expect(part("meaning").querySelector('[data-part="runs"]')).toBeNull();
  });

  it("creates the schedule with the token of its review, says what Velero wrote, and leads to the schedule", async () => {
    const { main } = mount();
    const text = textOf("nightly-shop", WRAPPER, { storageLocation: "default" });

    await createSchedule();
    await writesOn();
    type(field(), "nightly-shop");
    type(part("expression"), WRAPPER.expression);
    press("ask");
    await waitFor(() => expect(main.confirms).toHaveLength(1));
    await main.confirm(text);
    await waitFor(() => expect(maybe("review")).toBeTruthy());
    press("create");
    await waitFor(() => expect(main.runs).toHaveLength(1));
    expect(words(part("status"))).toBe(SCHEDULE_CREATE_VIEW_WORDS.running("nightly-shop"));
    expect(main.runs[0].args.slice(0, 4)).toEqual(["cluster-a", A, "nightly-shop", "token-1"]);
    const errors = ["invalid schedule: provided bad location Mars/Olympus_Mons: unknown time zone Mars/Olympus_Mons"];

    await main.run({
      ok: true,
      value: { name: "nightly-shop", uid: "u", phase: "FailedValidation", errors, errorsLeft: 2 },
    });
    await waitFor(() => expect(maybe("result")).toBeTruthy());
    expect(words(part("phase"))).toBe(scheduleResultWords({ phase: "FailedValidation" }));
    expect([...part("errors").querySelectorAll("li")].map((item) => item.textContent)).toEqual(errors);
    expect(words(part("errors-left"))).toBe(SCHEDULE_CREATE_VIEW_WORDS.errorsLeft(2));
    expect(words(part("result"))).toContain(SCHEDULE_CREATE_VIEW_WORDS.templateChecked);
    expect(words(part("result"))).toContain(SCHEDULE_CREATE_VIEW_WORDS.listed);
    expect(main.shown).toEqual([main.runs[0].args[4]]);
    // The result has the focus once the command that created went.
    await waitFor(() => expect(focused()).toBe(`${ID}-result`));
    press("open");
    await waitFor(() => expect(openViews()).toEqual([{ kind: "schedule", name: "nightly-shop" }]));
  });

  it("says a schedule found by its name after a lost answer, and one that may be there, with what to do before asking again", async () => {
    const { main } = mount();
    const text = textOf("nightly-shop", WRAPPER, { storageLocation: "default" });
    const ask = async (count: number) => {
      press("ask");
      await waitFor(() => expect(main.confirms).toHaveLength(count));
      await main.confirm(text);
      await waitFor(() => expect(maybe("review")).toBeTruthy());
      press("create");
      await waitFor(() => expect(main.runs).toHaveLength(count));
    };

    await createSchedule();
    await writesOn();
    type(field(), "nightly-shop");
    type(part("expression"), WRAPPER.expression);
    await ask(1);
    await main.run({
      ok: false,
      code: "submission-unknown",
      stage: "creation",
      retry: false,
      text: "The schedule could not be read.",
    });
    await waitFor(() => expect(maybe("failure")).toBeTruthy());
    expect(words(part("failure-left"))).toBe(SCHEDULE_CREATE_VIEW_WORDS.unknownLeft);
    // The failure is said to who does not see as it appears, and the focus is on the command that asks again.
    expect(part("failure").getAttribute("role")).toBe("alert");
    await waitFor(() => expect(focused()).toBe(`${ID}-ask`));
    await ask(2);
    await main.run({ ok: true, value: { name: "nightly-shop", uid: "u", phase: "Enabled", found: true } });
    await waitFor(() => expect(maybe("result")).toBeTruthy());
    expect(words(part("found"))).toBe(SCHEDULE_CREATE_VIEW_WORDS.found);
  });

  it("says the gate of the cluster when it is not known, and leads to the target bar", async () => {
    const main = mainProcess();

    main.gate.state = async () => ({
      ok: false,
      code: "request-failed",
      stage: "way",
      retry: true,
      text: "The views have no way to the main process.",
    });
    mount(main);
    await createSchedule();
    await waitFor(() => expect(words(part("writes-off"))).toBe(BACKUP_CREATE_VIEW_WORDS.gateUnknown));
    expect(maybe("to-target")).toBeTruthy();
  });

  it("says the runs in the offset of the server the installation derived, when the expression names no zone", async () => {
    const taken = {
      ...schedule("taken"),
      status: { phase: "Enabled", lastBackup: "2026-11-07T02:00:00Z" },
    };
    const backup = {
      apiVersion: "velero.io/v1",
      kind: "Backup",
      metadata: {
        name: "taken-20261107030000",
        namespace: A,
        uid: "taken-backup-uid",
        creationTimestamp: "2026-11-07T02:00:01Z",
        labels: { "velero.io/schedule-name": "taken" },
      },
      spec: {},
      status: { phase: "Completed" },
    };
    const { main } = mount(mainProcess(), {
      [path("schedules", A)]: list(taken),
      [path("backups", A)]: list(backup),
    });
    const expression = "0 3 * * *";

    await createSchedule();
    await writesOn();
    type(field(), "nightly-shop");
    type(part("expression"), expression);
    press("ask");
    await waitFor(() => expect(main.confirms).toHaveLength(1));
    await main.confirm(textOf("nightly-shop", { ...WRAPPER, expression }, { storageLocation: "default" }));
    await waitFor(() => expect(maybe("review")).toBeTruthy());
    expect(words(part("meaning").querySelector('[data-part="zone"]') as Element)).toMatch(
      /^The expression names no zone: the runs are in UTC\+01:00, the offset of the clock of the Velero server when it submitted the backup taken-20261107030000 of the schedule taken, /,
    );
    expect(words(part("meaning").querySelector('[data-part="runs"]') as Element)).toMatch(
      /^The next 5 runs, counted from now, the creation a moment later: 2026-11-09 03:00 UTC\+01:00;/,
    );
  });

  it("creates a paused schedule, read once, and says that Velero does not read it", async () => {
    const { main } = mount();
    const wrapper = { ...WRAPPER, paused: true };

    await createSchedule();
    await writesOn();
    type(field(), "nightly-shop");
    type(part("expression"), WRAPPER.expression);
    fireEvent.click(part("paused"));
    press("ask");
    await waitFor(() => expect(main.confirms).toHaveLength(1));
    await main.confirm(textOf("nightly-shop", wrapper, { storageLocation: "default" }));
    await waitFor(() => expect(maybe("review")).toBeTruthy());
    expect(words(part("meaning").querySelector('[data-part="runs"]') as Element)).toMatch(
      /^No run is upcoming while the schedule is paused\./,
    );
    press("create");
    await waitFor(() => expect(main.runs).toHaveLength(1));
    expect(words(part("status"))).toBe(SCHEDULE_CREATE_VIEW_WORDS.runningPaused("nightly-shop"));
    await main.run({ ok: true, value: { name: "nightly-shop", uid: "u", paused: true } });
    await waitFor(() => expect(words(part("phase"))).toBe(scheduleResultWords({ paused: true })));
  });

  it("keeps what was typed after a conflict, with the way to the schedule that has it, and gives a new form once one was created", async () => {
    const { main } = mount();
    const text = textOf("taken", WRAPPER, { storageLocation: "default" });

    await createSchedule();
    await writesOn();
    type(field(), "taken");
    type(part("expression"), WRAPPER.expression);
    press("ask");
    await waitFor(() => expect(main.confirms).toHaveLength(1));
    await main.confirm(text);
    await waitFor(() => expect(maybe("review")).toBeTruthy());
    press("create");
    await waitFor(() => expect(main.runs).toHaveLength(1));
    await main.run({
      ok: false,
      code: "conflict",
      stage: "creation",
      retry: false,
      text: "A schedule named taken is there.",
    });
    await waitFor(() => expect(maybe("failure")).toBeTruthy());
    expect([field().value, (part("expression") as HTMLInputElement).value]).toEqual(["taken", WRAPPER.expression]);
    expect(screen.getByTestId("velero-open-schedule-taken")).toBeTruthy();
    type(field(), "nightly-shop");
    press("ask");
    await waitFor(() => expect(main.confirms).toHaveLength(2));
    await main.confirm(textOf("nightly-shop", WRAPPER, { storageLocation: "default" }));
    await waitFor(() => expect(maybe("review")).toBeTruthy());
    press("create");
    await waitFor(() => expect(main.runs).toHaveLength(2));
    await main.run({ ok: true, value: { name: "nightly-shop", uid: "u", phase: "Enabled" } });
    await waitFor(() => expect(maybe("result")).toBeTruthy());
    act(() => closeViews());
    await createSchedule();
    expect([maybe("result"), field().value, (part("expression") as HTMLInputElement).value]).toEqual([null, "", ""]);
  });

  it("says in the target bar the end of a schedule no view showed, with the way to it, until it is dismissed", async () => {
    const main = mainProcess();
    const end: KeptEnd = {
      request: "00000000-0000-4000-8000-0000000000aa",
      kind: "schedule",
      namespace: A,
      context: "kind-local-demo",
      name: "nightly-shop",
      outcome: { created: true, phase: "Enabled" },
      at: NOW,
    };

    main.kept.push(end);
    mount(main);
    const band = await screen.findByTestId("velero-kept-ends");

    expect(band.textContent).toContain(keptEndWords(end));
    expect(screen.getByTestId("velero-open-schedule-nightly-shop")).toBeTruthy();
    expect(screen.getByTestId("velero-kept-end-dismiss").getAttribute("aria-label")).toBe(
      "Dismiss what is said of the schedule nightly-shop",
    );
    fireEvent.click(screen.getByTestId("velero-kept-end-dismiss"));
    expect(main.shown).toEqual([end.request]);
    expect(screen.queryByTestId("velero-kept-ends")).toBeNull();
  });
});
