// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { addressChanges } from "../../../test/freelens-extensions";
import { listProps } from "../../../test/host-components";
import { emptyPreferences, heldPreferences, RESOURCES } from "../../common/discovery";
import { RESTORE_PHASES } from "../../common/phases";
import { Restore } from "../api/kinds";
import { RestoreDetails } from "../details/restore-details";
import { closeViews, openView, openViews } from "../navigation";
import { Installation } from "../state/installation";
import { BackupsPage } from "./backups-page";
import { RestoresPage } from "./restores-page";

import type { Renderer } from "@freelensapp/extensions";

import type { Answer, Family, Preferences } from "../../common/discovery";

const DISCOVERY = "/apis/velero.io/v1";
const LOCATIONS = "/apis/velero.io/v1/backupstoragelocations";
const A = "velero-a";
const B = "velero-b";

type Answers = Record<string, Answer | (() => Promise<Answer>)>;

function path(family: Family, namespace: string): string {
  return `/apis/velero.io/v1/namespaces/${namespace}/${RESOURCES[family]}`;
}

function list(...items: unknown[]): Answer {
  return { status: 200, body: { items } };
}

function object(kind: string, name: string, namespace: string, spec?: object, status?: object, uid?: string) {
  return {
    apiVersion: "velero.io/v1",
    kind,
    metadata: {
      name,
      namespace,
      uid: uid ?? `${namespace}-${kind.toLowerCase()}-${name}`,
      resourceVersion: "1",
      creationTimestamp: "2026-09-01T10:00:00Z",
    },
    ...(spec ? { spec } : {}),
    ...(status ? { status } : {}),
  };
}

const waiting = object(
  "Restore",
  "restore-waiting",
  A,
  {
    backupName: "nightly-1",
    scheduleName: "nightly",
    namespaceMapping: { shop: "shop-restored", billing: "billing-restored" },
    existingResourcePolicy: "update",
    excludedResources: ["nodes", "events"],
    itemOperationTimeout: "4h0m0s",
  },
  {
    phase: "WaitingForPluginOperationsPartiallyFailed",
    startTimestamp: "2026-09-01T10:00:00Z",
    progress: { totalItems: 12, itemsRestored: 12 },
    errors: 1,
    // It waits for an operation of a plugin. Its hooks are counted when it is finalized.
    restoreItemOperationsAttempted: 1,
  },
);
const completed = object(
  "Restore",
  "restore-completed",
  A,
  { backupName: "expired" },
  {
    phase: "Completed",
    startTimestamp: "2026-09-01T10:00:00Z",
    completionTimestamp: "2026-09-01T10:03:00Z",
    progress: { totalItems: 12, itemsRestored: 12 },
    // The release writes no counter of zero: a restore that ended without an error carries none.
    hookStatus: {},
  },
);
const refused = object(
  "Restore",
  "restore-refused",
  A,
  { scheduleName: "nightly" },
  { phase: "FailedValidation", validationErrors: ["No completed backups found for schedule"] },
);
const backup = object(
  "Backup",
  "nightly-1",
  A,
  { storageLocation: "default" },
  { phase: "Completed", startTimestamp: "2026-09-01T09:00:00Z", completionTimestamp: "2026-09-01T09:01:00Z" },
);
const served: Answer = { status: 200, body: { resources: Object.values(RESOURCES).map((name) => ({ name })) } };

function answers(more: Answers = {}): Answers {
  return {
    [DISCOVERY]: served,
    [LOCATIONS]: list({ metadata: { name: "default", namespace: A } }, { metadata: { name: "default", namespace: B } }),
    [path("restores", A)]: list(waiting, completed, refused),
    [path("restores", B)]: list(object("Restore", "restore-waiting", B, { backupName: "other" }, { phase: "New" })),
    [path("backups", A)]: list(backup),
    [path("backups", B)]: list(),
    [path("schedules", A)]: list(object("Schedule", "nightly", A, { schedule: "0 3 * * *" })),
    [path("schedules", B)]: list(),
    [path("storageLocations", A)]: list(
      object("BackupStorageLocation", "default", A, { accessMode: "ReadWrite" }, { phase: "Available" }),
    ),
    [path("storageLocations", B)]: list(),
    [path("snapshotLocations", A)]: list(),
    [path("snapshotLocations", B)]: list(),
    ...more,
  };
}

function mount(table: Answers, preferences: Preferences = emptyPreferences(), page = RestoresPage) {
  const asked: string[] = [];
  const clock = { now: Date.parse("2026-09-01T12:00:00Z") };
  const installation = new Installation({
    cluster: { id: "cluster-a", name: "local-demo" },
    read: async (address) => {
      asked.push(address);
      const answer = table[address] ?? { status: 404 };

      return typeof answer === "function" ? answer() : answer;
    },
    now: () => clock.now,
    storage: heldPreferences(preferences),
  });
  const Page = page;
  const view = render(<Page installation={installation} />);

  return { installation, asked, clock, table, view };
}

const chosen = (namespace: string): Preferences => ({ selected: { "cluster-a": namespace }, configured: {} });
const rows = (kind = "restore") =>
  [...document.querySelectorAll(`[data-${kind}-row]`)].map((row) => row.getAttribute(`data-${kind}-row`));
const notice = (family: string) => screen.queryByTestId(`velero-notice-${family}`)?.textContent ?? "";
const reference = (id: string) => screen.getByTestId(`velero-reference-${id}`);
const scope = (id: string) => document.querySelector(`[data-scope="${id}"]`)?.textContent;

afterEach(() => {
  act(() => closeViews());
  cleanup();
  listProps.clear();
  vi.useRealTimers();
});

describe("list of the restores", () => {
  it("gives the host a list that only reads, with the columns of the restores", async () => {
    mount(answers(), chosen(A));
    await waitFor(() => expect(rows()).toEqual(["restore-waiting", "restore-completed", "restore-refused"]));
    const props = listProps.get("veleroRestoresTable") ?? {};

    expect(props.isSelectable).toBe(false);
    expect((props.renderItemMenu as () => unknown)()).toBeNull();
    expect(props.subscribeStores).toBe(false);
    for (const forbidden of ["onAdd", "addRemoveButtons", "renderFooter", "headerActions"]) {
      expect(props[forbidden]).toBeUndefined();
    }
    const columns = props.renderTableHeader as { id: string; sortBy: string; className: string }[];

    expect(columns.map((column) => column.id)).toEqual([
      "name",
      "namespace",
      "source",
      "phase",
      "errors",
      "progress",
      "started",
      "duration",
    ]);
    // Every column has its order, and a name of its own for its width.
    expect(Object.keys(props.sortingCallbacks as object).sort()).toEqual(columns.map((column) => column.sortBy).sort());
    expect(new Set(columns.map((column) => column.className)).size).toBe(columns.length);
    expect(screen.getByTestId("velero-restores-page")).toBeTruthy();
    expect(screen.queryByTestId("velero-coverage")).toBeNull();
  });

  it("shows a restore that waits with a failure on the two axes, and the source as the object names it", async () => {
    mount(answers(), chosen(A));
    await waitFor(() => expect(rows()).toHaveLength(3));
    const row = screen.getByText("restore-waiting").closest(".TableRow") as HTMLElement;

    expect(within(row).getByText("Waiting for plugin operations")).toBeTruthy();
    expect(within(row).getByText("autorenew")).toBeTruthy();
    expect(within(row).getByText("1 error")).toBeTruthy();
    expect(within(row).getByText("12 / 12 (100%)")).toBeTruthy();
    expect(within(row).getByText("nightly-1, schedule nightly")).toBeTruthy();
    expect(row.textContent).toContain("so far");
    expect(row.textContent).not.toContain("Completed");
    const asked = screen.getByText("restore-refused").closest(".TableRow") as HTMLElement;

    // A restore that failed its validation never started: no time is made up for it.
    expect(within(asked).getByText("Schedule nightly")).toBeTruthy();
    expect(within(asked).getByText("1 validation error")).toBeTruthy();
    expect(within(asked).getByText("Not started")).toBeTruthy();
    expect(asked.querySelector(".TableCell.started")?.textContent).toBe("Not reported");
  });

  it("marks as gone well the restore the release counted, and not one that counted nothing", async () => {
    mount(
      answers({
        [path("restores", A)]: list(
          object("Restore", "waits", A, { backupName: "nightly-1" }, { phase: "New" }),
          object("Restore", "running", A, { backupName: "nightly-1" }, { phase: "InProgress" }),
          object("Restore", "stopped", A, { backupName: "nightly-1" }, { phase: "Failed", failureReason: "stopped" }),
        ),
      }),
      chosen(A),
    );
    await waitFor(() => expect(rows()).toHaveLength(2 + 1));
    const signal = (name: string) =>
      (screen.getByText(name).closest(".TableRow") as HTMLElement).querySelector("[data-signal]");

    expect(signal("waits")?.getAttribute("data-mark")).toBe("not-counted");
    expect(signal("waits")?.textContent).toBe("removeNo failure reported");
    expect(signal("running")?.getAttribute("data-mark")).toBe("not-counted");
    expect(signal("running")?.textContent).toBe("removeNo failure reported");
    expect(signal("stopped")?.getAttribute("data-mark")).toBe("failure");
    expect(signal("stopped")?.getAttribute("title")).toBe("Failure. Errors / warnings: Not reported / Not reported");
  });

  // The object of a restore that ended without an error, as the release leaves it: no counter in it.
  it("shows the restore the release left without counters as one without errors", async () => {
    mount(answers(), chosen(A));
    await waitFor(() => expect(rows()).toHaveLength(3));
    const signal = (screen.getByText("restore-completed").closest(".TableRow") as HTMLElement).querySelector(
      "[data-signal]",
    );

    expect(signal?.getAttribute("data-mark")).toBe("none");
    expect(signal?.textContent).toBe("checkNo errors");
    expect(signal?.getAttribute("title")).toBe("No errors. Errors / warnings: 0 / 0");
    fireEvent.click(screen.getByText("restore-completed"));
    const workspace = await screen.findByTestId("velero-restore-workspace");
    const status = within(workspace).getByTestId("velero-restore-status");

    expect(within(status).getByTestId("velero-restore-counts").textContent).toBe("0 / 0");
    expect(status.textContent).toContain(
      "Velero writes no counter when it counts none: a zero here is a counter that is not in the object.",
    );
    expect(status.querySelector("[data-signal]")?.getAttribute("data-mark")).toBe("none");
    // Nothing is missing of it: no evidence is asked for, and no line for what it did not count.
    expect(within(workspace).queryByText("Errors and evidence")).toBeNull();
    expect(within(workspace).queryByTestId("velero-restore-messages")).toBeNull();
    expect(within(workspace).queryByTestId("velero-restore-hooks")).toBeNull();
    expect(within(workspace).queryByTestId("velero-restore-operations")).toBeNull();
    expect(workspace.textContent).not.toContain("Not reported /");
  });

  it("has a line for the hooks of a restore that was finalized with hooks, and for no other", async () => {
    const finalized = (name: string, hookStatus: object) =>
      object(
        "Restore",
        name,
        A,
        { backupName: "nightly-1" },
        { phase: "PartiallyFailed", errors: 1, progress: { totalItems: 3, itemsRestored: 3 }, hookStatus },
      );

    mount(
      answers({
        [path("restores", A)]: list(
          finalized("two-hooks", { hooksAttempted: 2, hooksFailed: 1 }),
          // The release writes no counter of zero: the hooks that did not fail are not in the object.
          finalized("none-failed", { hooksAttempted: 2 }),
          finalized("no-hooks", {}),
        ),
      }),
      chosen(A),
    );
    await waitFor(() => expect(rows()).toHaveLength(3));
    const hooks = async (name: string) => {
      act(() => closeViews());
      act(() => openView({ kind: "restore", name }));
      await waitFor(() => expect(screen.getByTestId("velero-restore-name").textContent).toBe(name));
      return screen.queryByTestId("velero-restore-hooks")?.textContent;
    };

    expect(await hooks("two-hooks")).toBe("2 / 1");
    expect(await hooks("none-failed")).toBe("2 / 0");
    expect(await hooks("no-hooks")).toBeUndefined();
  });

  it("says why a restore that is at work, or that did not start, has no counters", async () => {
    mount(
      answers({
        [path("restores", A)]: list(
          object("Restore", "waits", A, { backupName: "nightly-1" }, { phase: "New" }),
          object(
            "Restore",
            "running",
            A,
            { backupName: "nightly-1" },
            { phase: "InProgress", startTimestamp: "2026-09-01T11:59:00Z", progress: { totalItems: 12 } },
          ),
        ),
      }),
      chosen(A),
    );
    await waitFor(() => expect(rows()).toHaveLength(2));
    fireEvent.click(screen.getByText("running"));
    const running = within(await screen.findByTestId("velero-restore-workspace"));

    expect(running.getByTestId("velero-restore-counts").textContent).toBe("Not reported / Not reported");
    expect(running.getByTestId("velero-restore-status").textContent).toContain(
      "Velero counts when the work of the operation ends.",
    );
    // The release writes the total before the first item, and no count of zero.
    expect(running.getByTestId("velero-restore-progress").textContent).toBe("0 / 12 (0%)");
    expect(running.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("0");
    expect(running.queryByTestId("velero-restore-messages")).toBeNull();
    act(() => closeViews());
    act(() => openView({ kind: "restore", name: "waits" }));
    await waitFor(() => expect(screen.getByTestId("velero-restore-name").textContent).toBe("waits"));
    const status = screen.getByTestId("velero-restore-status").textContent ?? "";

    expect(status).toContain("Nothing was counted: the operation did not start.");
    expect(status).toContain("DurationNot started");
    expect(screen.queryByTestId("velero-restore-messages")).toBeNull();
  });

  it("marks every phase of a restore with where the operation is", async () => {
    const phases = RESTORE_PHASES.map((phase) => object("Restore", phase.toLowerCase(), A, {}, { phase }));

    mount(answers({ [path("restores", A)]: list(...phases) }), chosen(A));
    await waitFor(() => expect(rows()).toHaveLength(RESTORE_PHASES.length));
    const icons = Object.fromEntries(
      RESTORE_PHASES.map((phase) => {
        const row = screen.getByText(phase.toLowerCase()).closest(".TableRow") as HTMLElement;

        return [phase, row.querySelector("[data-phase] .Icon")?.textContent];
      }),
    );

    expect(icons).toEqual({
      New: "autorenew",
      InProgress: "autorenew",
      WaitingForPluginOperations: "autorenew",
      WaitingForPluginOperationsPartiallyFailed: "autorenew",
      Finalizing: "autorenew",
      FinalizingPartiallyFailed: "autorenew",
      Completed: "check_circle_outline",
      PartiallyFailed: "highlight_off",
      Failed: "highlight_off",
      FailedValidation: "highlight_off",
    });
  });

  it.each([
    ["denied", { status: 403 }, "Access to the restores of this namespace is denied", "access is denied"],
    ["not answered", {}, "could not be read", "could not be read"],
    ["answered with an error", { status: 500 }, "could not be read", "could not be read"],
  ])("does not show a list that was %s as an empty one", async (_name, answer, text, warning) => {
    mount(answers({ [path("restores", A)]: answer as Answer }), chosen(A));
    const state = await screen.findByTestId("velero-restores-unavailable");

    expect(state.textContent).toContain(text);
    expect(state.textContent).toContain("not known");
    expect(screen.queryByTestId("velero-restores")).toBeNull();
    expect(document.body.textContent).not.toMatch(/\b0 items\b/);
    expect(notice("restores")).toContain(warning);
    // What is denied of the restores takes nothing from what was read of the rest.
    expect(notice("backups")).toBe("");
  });

  it("says that the cluster does not serve the restores, which is not that there are none", async () => {
    const partly: Answer = {
      status: 200,
      body: {
        resources: Object.values(RESOURCES)
          .filter((name) => name !== "restores")
          .map((name) => ({ name })),
      },
    };
    const { asked } = mount(answers({ [DISCOVERY]: partly }), chosen(A));
    const state = await screen.findByTestId("velero-restores-unavailable");

    expect(state.textContent).toContain("This cluster does not serve the restores of Velero");
    expect(asked).not.toContain(path("restores", A));
  });

  it("shows a namespace with no restore as a list with none", async () => {
    mount(answers({ [path("restores", A)]: list() }), chosen(A));
    await waitFor(() => expect(screen.getByTestId("velero-restores").textContent).toContain("0 items"));
    expect(screen.getByTestId("velero-restores-empty").textContent).toContain(
      `No restore is in the namespace ${A} of local-demo.`,
    );
    expect(screen.queryByTestId("velero-restores-unavailable")).toBeNull();
  });

  it("keeps what was read when the next read fails, and says when it was read", async () => {
    const { installation, table, clock } = mount(answers(), chosen(A));

    await waitFor(() => expect(rows()).toHaveLength(3));
    const read = new Date(clock.now).toLocaleTimeString();

    clock.now += 60_000;
    table[path("restores", A)] = { status: 500 };
    await act(() => installation.refresh());
    expect(rows()).toHaveLength(3);
    expect(notice("restores")).toContain("could not be read");
    expect(notice("restores")).toContain(`What is shown was read at ${read}`);
  });

  it("has no count of a list that was not read yet, which is not a list with none", async () => {
    let answer: (value: Answer) => void = () => undefined;
    const late = new Promise<Answer>((resolve) => {
      answer = resolve;
    });

    mount(answers({ [path("restores", A)]: () => late }), chosen(A));
    const list_ = await screen.findByTestId("velero-restores");

    expect(screen.getByTestId("velero-restores-not-counted").textContent).toBe("Not read yet");
    expect(list_.textContent).not.toMatch(/\b\d+ items?\b/);
    expect(screen.queryByTestId("velero-restores-empty")).toBeNull();
    expect(screen.getByTestId("velero-read-time").getAttribute("data-reading")).toBe("true");
    expect(screen.getByTestId("velero-read-time").textContent).toBe("Not read yet, reading");
    await act(async () => {
      answer(list(waiting));
      await late;
    });
    await waitFor(() => expect(rows()).toEqual(["restore-waiting"]));
    expect(screen.queryByTestId("velero-restores-not-counted")).toBeNull();
    expect(list_.textContent).toContain("1 item");
    await waitFor(() => expect(screen.getByTestId("velero-read-time").getAttribute("data-reading")).toBe("false"));
  });

  // While the families are asked again, what is shown is what the last read said: nothing is of an
  // earlier read until a read fails, and what was denied is not an empty list for the time of a read.
  it("shows what the last read said while the installation is read again", async () => {
    let asking = false;
    let answer: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      answer = resolve;
    });
    const hold = (value: Answer) => async () => {
      if (asking) await held;
      return value;
    };
    const { installation } = mount(
      answers({
        [path("restores", A)]: hold(list(waiting, completed, refused)),
        [path("backups", A)]: hold(list(backup)),
        [path("schedules", A)]: hold({ status: 403 }),
        [path("storageLocations", A)]: hold({ status: 500 }),
      }),
      chosen(A),
    );

    await waitFor(() => expect(rows()).toHaveLength(3));
    fireEvent.click(screen.getByText("restore-waiting"));
    await screen.findByTestId("velero-restore-workspace");
    const shown = () => ({
      backup: reference("Backup-nightly-1").getAttribute("data-reference"),
      backupText: reference("Backup-nightly-1").textContent,
      schedule: reference("Schedule-nightly").getAttribute("data-reference"),
      scheduleText: reference("Schedule-nightly").textContent,
      schedules: notice("schedules"),
      locations: notice("storageLocations"),
      restores: notice("restores"),
      stale: screen.queryByTestId("velero-restore-stale"),
      status: screen.getByTestId("velero-restore-status").textContent,
      rows: rows(),
    });
    const before = shown();

    expect(before.backup).toBe("resolved");
    expect(before.schedule).toBe("inaccessible");
    expect(before.schedules).toContain("access is denied");
    expect(before.locations).toContain("could not be read");
    expect(before.stale).toBeNull();
    asking = true;
    let read: Promise<void> = Promise.resolve();

    act(() => {
      read = installation.refresh();
    });
    await waitFor(() => expect(screen.getByTestId("velero-read-time").getAttribute("data-reading")).toBe("true"));
    expect(installation.read("restores")).toMatchObject({ status: "ready", reading: true });
    expect(installation.read("schedules")).toMatchObject({ status: "forbidden", reading: true });
    // The same words, the same references, the same rows: and that it is being read again, in the bar.
    expect(shown()).toEqual(before);
    expect(screen.getByTestId("velero-read-time").textContent).toContain(", reading again");
    expect(document.body.textContent).not.toContain("stopped answering");
    expect(document.body.textContent).not.toContain("were not read yet");
    expect(screen.queryByRole("progressbar", { name: "Loading" })).toBeNull();
    await act(async () => {
      answer();
      await read;
    });
    expect(screen.getByTestId("velero-read-time").getAttribute("data-reading")).toBe("false");
    expect(installation.read("restores").reading).toBeUndefined();
    expect(shown()).toEqual(before);
  });

  it("keeps a list that is denied as one that is denied while it is asked again", async () => {
    let asking = false;
    let answer: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      answer = resolve;
    });
    const { installation } = mount(
      answers({
        [path("restores", A)]: async () => {
          if (asking) await held;
          return { status: 403 };
        },
      }),
      chosen(A),
    );

    expect((await screen.findByTestId("velero-restores-unavailable")).textContent).toContain("denied");
    asking = true;
    let read: Promise<void> = Promise.resolve();

    act(() => {
      read = installation.refresh();
    });
    await waitFor(() => expect(installation.read("restores").reading).toBe(true));
    expect(screen.getByTestId("velero-restores-unavailable").textContent).toContain("denied");
    expect(screen.queryByTestId("velero-restores")).toBeNull();
    expect(notice("restores")).toContain("access is denied");
    expect(document.body.textContent).not.toMatch(/\b0 items\b/);
    await act(async () => {
      answer();
      await read;
    });
    expect(screen.getByTestId("velero-restores-unavailable").textContent).toContain("denied");
  });

  it("stops asking when the view closes", async () => {
    vi.useFakeTimers();
    const { asked, view } = mount(answers(), chosen(A));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(16_000);
    });
    const open = asked.length;

    expect(asked.filter((address) => address === path("restores", A)).length).toBeGreaterThanOrEqual(2);
    view.unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(120_000);
    });
    expect(asked).toHaveLength(open);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("workspace of a restore", () => {
  it("opens from a row and shows a restore that waits with a failure as in flight", async () => {
    const { asked } = mount(answers(), chosen(A));

    await waitFor(() => expect(rows()).toHaveLength(3));
    const before = asked.length;

    fireEvent.click(screen.getByText("restore-waiting"));
    const workspace = await screen.findByTestId("velero-restore-workspace");
    const status = within(workspace).getByTestId("velero-restore-status").textContent ?? "";

    expect(workspace.getAttribute("data-restore-uid")).toBe(`${A}-restore-restore-waiting`);
    expect(status).toContain("Waiting for plugin operations");
    expect(status).toContain("In flight");
    expect(status).toContain("1 error");
    expect(status).toContain("Elapsed");
    expect(status).toContain(A);
    expect(status).toContain("local-demo");
    expect(within(workspace).getByRole("progressbar").getAttribute("aria-valuenow")).toBe("100");
    expect(within(workspace).getByText("Plugin operations", { selector: "[aria-current=step]" })).toBeTruthy();
    expect(within(workspace).getByTestId("velero-restore-operations").textContent).toBe("1 / 0 / 0");
    expect(within(workspace).queryByTestId("velero-restore-hooks")).toBeNull();
    expect(within(workspace).queryByTestId("velero-restore-completed-note")).toBeNull();
    // Opening a restore asks nothing: what it shows was read with the installation.
    expect(asked).toHaveLength(before);
    expect(asked.every((address) => !/request/i.test(address))).toBe(true);
    expect(document.activeElement).toBe(screen.getByTestId("velero-back"));
    expect(screen.getByTestId("velero-back").textContent).toContain("Restores");
    fireEvent.keyDown(workspace, { key: "Escape" });
    await waitFor(() => expect(screen.queryByTestId("velero-restore-workspace")).toBeNull());
    expect(document.activeElement?.getAttribute("data-restore-row")).toBe("restore-waiting");
  });

  it("shows what is restored into where, and the scope as the object carries it", async () => {
    mount(answers(), chosen(A));
    await waitFor(() => expect(rows()).toHaveLength(3));
    fireEvent.click(screen.getByText("restore-waiting"));
    const mappings = await screen.findByTestId("velero-restore-mappings");

    expect([...mappings.querySelectorAll("tbody tr")].map((row) => row.textContent)).toEqual([
      "billingbilling-restored",
      "shopshop-restored",
    ]);
    expect(scope("existing-resources")).toBe("update");
    expect(scope("excluded-resources")).toBe("nodes, events");
    expect(scope("included-namespaces")).toBe("Not set");
    expect(scope("persistent-volumes")).toBe("Not set");
    const text = screen.getByTestId("velero-restore-scope").textContent ?? "";

    expect(text).toContain("Velero adds its own entries when it takes a restore");
    expect(text).toContain("Velero fills it when it takes a restore that does not set it");
    expect(text).not.toMatch(/undefined|null|NaN/);
    // A field of a later release is not shown for an object that does not carry it.
    expect(scope("resource-policy")).toBeUndefined();
    // What is not mapped is said of where it goes, beside what is.
    expect(screen.getByTestId("velero-restore-mappings-rest").textContent).toBe(
      "What is restored of a namespace that is not mapped goes into the namespace of the same name.",
    );
    act(() => openView({ kind: "restore", name: "restore-completed" }));
    expect((await screen.findByTestId("velero-restore-mappings-none")).textContent).toBe(
      "Not set: what is restored of a namespace goes into the namespace of the same name.",
    );
    expect(screen.queryByTestId("velero-restore-mappings-rest")).toBeNull();
    // A view opened from another one is of another object: it is not the one before it, created again.
    expect(screen.getByTestId("velero-restore-name").textContent).toBe("restore-completed");
    expect(screen.queryByTestId("velero-restore-replaced")).toBeNull();
  });

  it("shows both names of the source, and does not say which one was submitted", async () => {
    mount(answers(), chosen(A));
    await waitFor(() => expect(rows()).toHaveLength(3));
    fireEvent.click(screen.getByText("restore-waiting"));
    await screen.findByTestId("velero-restore-workspace");
    expect(reference("Backup-nightly-1").getAttribute("data-reference")).toBe("resolved");
    expect(reference("Schedule-nightly").getAttribute("data-reference")).toBe("resolved");
    expect(reference("BackupStorageLocation-default").textContent).toContain("Available, ReadWrite");
    expect(screen.getByTestId("velero-restore-source-note").textContent).toContain(
      "the object does not say which of the two was submitted",
    );
  });

  it("makes up no backup for a restore that failed its validation, and shows why it failed", async () => {
    mount(answers(), chosen(A));
    await waitFor(() => expect(rows()).toHaveLength(3));
    fireEvent.click(screen.getByText("restore-refused"));
    const workspace = await screen.findByTestId("velero-restore-workspace");
    const status = within(workspace).getByTestId("velero-restore-status").textContent ?? "";

    expect(status).toContain("Failed validation");
    expect(status).toContain("Finished");
    expect(status).toContain("StartedNot reported");
    expect(status).toContain("DurationNot started");
    expect(status).toContain("CompletedNot reported");
    expect(within(workspace).getByTestId("velero-restore-messages").textContent).toContain(
      "No completed backups found for schedule",
    );
    expect(screen.getByTestId("velero-reference-Backup-none").textContent).toContain("names no backup");
    expect(screen.getByTestId("velero-reference-BackupStorageLocation-none").textContent).toBe(
      "Not known: the object names no backup, and the location is the one of the backup",
    );
    expect(screen.getByTestId("velero-restore-source-note").textContent).toContain("names no backup");
    expect(within(workspace).queryByRole("progressbar")).toBeNull();
  });

  it("says of the storage location that is not known why it is not", async () => {
    mount(
      answers({
        [path("backups", A)]: list(backup, object("Backup", "bare", A, {}, { phase: "Completed" })),
        [path("restores", A)]: list(
          object("Restore", "of-bare", A, { backupName: "bare" }, { phase: "Completed" }),
          object("Restore", "of-gone", A, { backupName: "gone" }, { phase: "Completed" }),
        ),
      }),
      chosen(A),
    );
    await waitFor(() => expect(rows()).toHaveLength(2));
    const location = () => screen.getByTestId("velero-reference-BackupStorageLocation-none").textContent;

    // The backup is there and names no location: nothing is behind a backup that was not read.
    fireEvent.click(screen.getByText("of-bare"));
    await screen.findByTestId("velero-restore-workspace");
    expect(reference("Backup-bare").getAttribute("data-reference")).toBe("resolved");
    expect(location()).toBe("Not reported: the backup names no storage location");
    act(() => closeViews());
    act(() => openView({ kind: "restore", name: "of-gone" }));
    await waitFor(() => expect(screen.getByTestId("velero-restore-name").textContent).toBe("of-gone"));
    expect(reference("Backup-gone").getAttribute("data-reference")).toBe("absent");
    expect(location()).toBe("Known through the backup, which is not among what was read");
  });

  it("says completed of a restore that completed, and nothing of what it restored", async () => {
    mount(answers(), chosen(A));
    await waitFor(() => expect(rows()).toHaveLength(3));
    fireEvent.click(screen.getByText("restore-completed"));
    const workspace = await screen.findByTestId("velero-restore-workspace");

    expect(within(workspace).getByTestId("velero-restore-completed-note").textContent).toContain(
      "Completed is what Velero reports of the restore",
    );
    expect(workspace.textContent).not.toMatch(/recovered|verified|healthy|succe(ss|eded)/i);
  });

  it("gives a way to the source that is there, and a name with its reason to the one that is not", async () => {
    mount(answers(), chosen(A));
    await waitFor(() => expect(rows()).toHaveLength(3));
    fireEvent.click(screen.getByText("restore-waiting"));
    await screen.findByTestId("velero-restore-workspace");
    expect(within(reference("Backup-nightly-1")).getByRole("button").textContent).toBe("nightly-1");
    expect(within(reference("Schedule-nightly")).getByRole("button").textContent).toBe("nightly");
    // The storage location of the backup is there: a way to its view.
    expect(within(reference("BackupStorageLocation-default")).getByRole("button").textContent).toBe("default");
    act(() => openView({ kind: "restore", name: "restore-completed" }));
    await waitFor(() => expect(screen.getByTestId("velero-restore-name").textContent).toBe("restore-completed"));
    const expired = reference("Backup-expired");

    expect(expired.getAttribute("data-reference")).toBe("absent");
    expect(expired.textContent).toBe(`expired (No backup of this name in ${A})`);
    expect(within(expired).queryByRole("button")).toBeNull();
    expect(screen.getByTestId("velero-restore-workspace").querySelectorAll("a")).toHaveLength(0);
  });

  it.each([
    ["denied", { status: 403 }, "inaccessible", "access is denied"],
    ["not answered", {}, "unknown", "could not be read"],
  ])("does not call absent a source whose list was %s", async (_name, answer, state, reason) => {
    mount(answers({ [path("backups", A)]: answer as Answer }), chosen(A));
    await waitFor(() => expect(rows()).toHaveLength(3));
    fireEvent.click(screen.getByText("restore-waiting"));
    await screen.findByTestId("velero-restore-workspace");
    const source = reference("Backup-nightly-1");

    expect(source.getAttribute("data-reference")).toBe(state);
    expect(source.textContent).toContain(reason);
    expect(within(source).queryByRole("button")).toBeNull();
    expect(notice("backups")).toContain(reason);
    // The restore itself is shown: what is denied of its source takes nothing from it.
    expect(screen.getByTestId("velero-restore-status").textContent).toContain("Waiting for plugin operations");
  });

  it("shows the restore of the installation selected, and another one when it is created again", async () => {
    const { installation, table } = mount(answers(), chosen(A));

    await waitFor(() => expect(rows()).toHaveLength(3));
    fireEvent.click(screen.getByText("restore-waiting"));
    expect((await screen.findByTestId("velero-restore-workspace")).getAttribute("data-restore-uid")).toBe(
      `${A}-restore-restore-waiting`,
    );
    table[path("restores", A)] = list(
      object("Restore", "restore-waiting", A, { backupName: "nightly-1" }, { phase: "New" }, "created-again"),
    );
    expect(screen.queryByTestId("velero-restore-replaced")).toBeNull();
    await act(() => installation.refresh());
    expect(screen.getByTestId("velero-restore-workspace").getAttribute("data-restore-uid")).toBe("created-again");
    expect(screen.getByTestId("velero-restore-status").textContent).toContain("New");
    // What tells the two apart is said in words: an identifier in the page is read by no operator.
    expect(screen.getByTestId("velero-restore-replaced").textContent).toBe(
      "warning_amberThis is another restore of the same name: the one that was open was deleted, and this one was created after it.",
    );
    // It stays said for as long as the view is open, and is not said of a view opened on the new one.
    await act(() => installation.refresh());
    expect(screen.getByTestId("velero-restore-replaced")).toBeTruthy();
    act(() => closeViews());
    act(() => openView({ kind: "restore", name: "restore-waiting" }));
    await screen.findByTestId("velero-restore-workspace");
    expect(screen.queryByTestId("velero-restore-replaced")).toBeNull();
  });

  it("says of a view opened from another one that its object was created again", async () => {
    const { installation, table } = mount(answers(), chosen(A));

    await waitFor(() => expect(rows()).toHaveLength(3));
    fireEvent.click(screen.getByText("restore-waiting"));
    await screen.findByTestId("velero-restore-workspace");
    // The view of another restore, in the place of the first: what was opened is the second.
    act(() => openView({ kind: "restore", name: "restore-completed" }));
    await waitFor(() => expect(screen.getByTestId("velero-restore-name").textContent).toBe("restore-completed"));
    expect(screen.queryByTestId("velero-restore-replaced")).toBeNull();
    table[path("restores", A)] = list(
      waiting,
      object("Restore", "restore-completed", A, { backupName: "expired" }, { phase: "New" }, "created-again"),
    );
    await act(() => installation.refresh());
    expect(screen.getByTestId("velero-restore-workspace").getAttribute("data-restore-uid")).toBe("created-again");
    expect(screen.getByTestId("velero-restore-replaced").textContent).toContain("another restore of the same name");
    // The way back leads to the first, which is the one it was: nothing is said of it.
    fireEvent.click(screen.getByTestId("velero-back"));
    await waitFor(() => expect(screen.getByTestId("velero-restore-name").textContent).toBe("restore-waiting"));
    expect(screen.queryByTestId("velero-restore-replaced")).toBeNull();
  });

  it("closes the views of an installation when another one is selected", async () => {
    mount(answers(), chosen(A));
    await waitFor(() => expect(rows()).toHaveLength(3));
    fireEvent.click(screen.getByText("restore-waiting"));
    fireEvent.click(within(await screen.findByTestId("velero-reference-Backup-nightly-1")).getByRole("button"));
    await screen.findByTestId("velero-backup-workspace");
    expect(openViews()).toHaveLength(2);
    const changes = addressChanges.count;

    // The way back would name a backup the other installation does not have.
    fireEvent.change(screen.getByLabelText("Velero namespace"), { target: { value: B } });
    await waitFor(() => expect(rows()).toEqual(["restore-waiting"]));
    expect(openViews()).toEqual([]);
    expect(addressChanges.count).toBe(changes + 1);
    expect(screen.queryByTestId("velero-backup-workspace")).toBeNull();
    expect(screen.queryByTestId("velero-restore-workspace")).toBeNull();
    // The restore of the same name there is another one, opened as any other.
    fireEvent.click(screen.getByText("restore-waiting"));
    expect((await screen.findByTestId("velero-restore-workspace")).getAttribute("data-restore-uid")).toBe(
      `${B}-restore-restore-waiting`,
    );
    expect(screen.queryByTestId("velero-restore-replaced")).toBeNull();
    expect(screen.getByTestId("velero-reference-Backup-other").getAttribute("data-reference")).toBe("absent");
    expect(screen.getByTestId("velero-restore-status").textContent).not.toContain(A);
    expect(screen.getByTestId("velero-back").textContent).toBe("arrow_backRestores");
  });

  it("says that a restore is being deleted, beside the phase it had", async () => {
    const going = object("Restore", "going", A, { backupName: "nightly-1" }, { phase: "Completed" });

    mount(
      answers({
        [path("restores", A)]: list(
          { ...going, metadata: { ...going.metadata, deletionTimestamp: "2026-09-01T11:00:00Z" } },
          completed,
        ),
      }),
      chosen(A),
    );
    await waitFor(() => expect(rows()).toHaveLength(2));
    fireEvent.click(screen.getByText("going"));
    const workspace = await screen.findByTestId("velero-restore-workspace");

    expect(within(workspace).getByTestId("velero-restore-deleting").textContent).toContain(
      "This restore is being deleted",
    );
    expect(within(workspace).getByTestId("velero-restore-status").textContent).toContain("Completed");
    act(() => closeViews());
    act(() => openView({ kind: "restore", name: "restore-completed" }));
    await waitFor(() => expect(screen.getByTestId("velero-restore-name").textContent).toBe("restore-completed"));
    expect(screen.queryByTestId("velero-restore-deleting")).toBeNull();
  });

  it("hears Escape from wherever the focus is in the view, and from a text that was clicked", async () => {
    mount(answers(), chosen(A));
    await waitFor(() => expect(rows()).toHaveLength(3));
    fireEvent.click(screen.getByText("restore-waiting"));
    const workspace = await screen.findByTestId("velero-restore-workspace");

    // A click on a text gives the focus to what holds it and can have it: the view, not the page.
    expect(workspace.getAttribute("tabindex")).toBe("-1");
    workspace.focus();
    expect(document.activeElement).toBe(workspace);
    fireEvent.keyDown(document.activeElement as Element, { key: "Escape" });
    await waitFor(() => expect(screen.queryByTestId("velero-restore-workspace")).toBeNull());
  });

  it("does not show the answer of the installation that was selected before", async () => {
    let answer: (value: Answer) => void = () => undefined;
    const late = new Promise<Answer>((resolve) => {
      answer = resolve;
    });
    const { installation } = mount(answers({ [path("restores", A)]: () => late }), chosen(A));

    await waitFor(() => expect(installation.namespace).toBe(A));
    fireEvent.change(await screen.findByLabelText("Velero namespace"), { target: { value: B } });
    await waitFor(() => expect(rows()).toEqual(["restore-waiting"]));
    await act(async () => {
      answer(list(waiting, completed, refused));
      await late;
    });
    expect(rows()).toEqual(["restore-waiting"]);
    expect(installation.read("restores").items).toHaveLength(1);
  });

  it("says that a restore is not there, or that it is not known, and not the one for the other", async () => {
    const { installation, table } = mount(answers(), chosen(A));

    await waitFor(() => expect(rows()).toHaveLength(3));
    act(() => openView({ kind: "restore", name: "removed" }));
    expect((await screen.findByTestId("velero-restore-missing")).textContent).toContain("No restore of this name");
    table[path("restores", B)] = { status: 403 };
    fireEvent.change(screen.getByLabelText("Velero namespace"), { target: { value: B } });
    await waitFor(() => expect(installation.read("restores").status).toBe("forbidden"));
    act(() => openView({ kind: "restore", name: "removed" }));
    expect(screen.queryByTestId("velero-restore-missing")).toBeNull();
    expect(screen.getByTestId("velero-restore-unknown").textContent).toBe(
      `Access to the restores of ${B} is denied, so this one cannot be shown. It is not known to be absent.`,
    );
  });

  it("says when what it shows is of an earlier read", async () => {
    const { installation, table, clock } = mount(answers(), chosen(A));

    await waitFor(() => expect(rows()).toHaveLength(3));
    fireEvent.click(screen.getByText("restore-waiting"));
    await screen.findByTestId("velero-restore-workspace");
    expect(screen.queryByTestId("velero-restore-stale")).toBeNull();
    const read = new Date(clock.now).toLocaleTimeString();

    clock.now += 60_000;
    table[path("restores", A)] = { status: 500 };
    await act(() => installation.refresh());
    expect(screen.getByTestId("velero-restore-stale").textContent).toContain(`this is what was read at ${read}`);
    expect(screen.getByTestId("velero-restore-status").textContent).toContain("Waiting for plugin operations");
  });
});

describe("way between a backup and its restores", () => {
  const related = answers({
    [path("restores", A)]: list(waiting, object("Restore", "restore-second", A, { backupName: "nightly-1" })),
  });

  it("leads from a backup to its restore and back to the backup, then to the list where it was", async () => {
    mount(related, chosen(A), BackupsPage);
    await waitFor(() => expect(rows("backup")).toEqual(["nightly-1"]));
    fireEvent.click(screen.getByText("nightly-1"));
    const restores = within(await screen.findByTestId("velero-related-restores"));
    const changes = addressChanges.count;

    expect(restores.getAllByRole("button").map((button) => button.textContent)).toEqual([
      "restore-waiting",
      "restore-second",
    ]);
    fireEvent.click(restores.getByText("restore-waiting"));
    const workspace = await screen.findByTestId("velero-restore-workspace");

    // One change of the address for one change of what is shown.
    expect(addressChanges.count).toBe(changes + 1);
    expect(openViews()).toEqual([
      { kind: "backup", name: "nightly-1" },
      { kind: "restore", name: "restore-waiting" },
    ]);
    expect(screen.queryByTestId("velero-backup-workspace")).toBeNull();
    // The view is over the list it was opened from, which is the one of the backups.
    expect(screen.getByTestId("velero-backups-page")).toBeTruthy();
    expect(rows("backup")).toEqual(["nightly-1"]);
    expect(screen.getByTestId("velero-back").textContent).toContain("Backups / nightly-1");
    expect(document.activeElement).toBe(screen.getByTestId("velero-back"));
    fireEvent.keyDown(workspace, { key: "Escape" });
    await screen.findByTestId("velero-backup-workspace");
    expect(screen.queryByTestId("velero-restore-workspace")).toBeNull();
    expect(screen.getByTestId("velero-back").textContent).toContain("Backups");
    expect(screen.getByTestId("velero-back").textContent).not.toContain("/");
    fireEvent.click(screen.getByTestId("velero-back"));
    await waitFor(() => expect(screen.queryByTestId("velero-backup-workspace")).toBeNull());
    expect(openViews()).toEqual([]);
    expect(document.activeElement?.getAttribute("data-backup-row")).toBe("nightly-1");
  });

  it("goes back to the backup it came from when the restore leads to it, without a longer way", async () => {
    mount(related, chosen(A), BackupsPage);
    await waitFor(() => expect(rows("backup")).toEqual(["nightly-1"]));
    fireEvent.click(screen.getByText("nightly-1"));
    fireEvent.click(within(await screen.findByTestId("velero-related-restores")).getByText("restore-waiting"));
    fireEvent.click(within(await screen.findByTestId("velero-reference-Backup-nightly-1")).getByRole("button"));
    await screen.findByTestId("velero-backup-workspace");
    expect(openViews()).toEqual([{ kind: "backup", name: "nightly-1" }]);
  });

  it("leads from a restore to its backup over the list of the restores, and back", async () => {
    mount(related, chosen(A));
    await waitFor(() => expect(rows()).toHaveLength(2));
    fireEvent.click(screen.getByText("restore-waiting"));
    fireEvent.click(within(await screen.findByTestId("velero-reference-Backup-nightly-1")).getByRole("button"));
    const workspace = await screen.findByTestId("velero-backup-workspace");

    expect(screen.getByTestId("velero-restores-page")).toBeTruthy();
    expect(screen.getByTestId("velero-back").textContent).toContain("Restores / restore-waiting");
    expect(within(workspace).getByTestId("velero-backup-status").textContent).toContain("Completed");
    fireEvent.click(screen.getByTestId("velero-back"));
    await screen.findByTestId("velero-restore-workspace");
    fireEvent.click(screen.getByTestId("velero-back"));
    await waitFor(() => expect(screen.queryByTestId("velero-restore-workspace")).toBeNull());
    expect(document.activeElement?.getAttribute("data-restore-row")).toBe("restore-waiting");
  });

  it("has no control that writes in the view of a restore: the way back and the ways to other views", async () => {
    mount(related, chosen(A));
    await waitFor(() => expect(rows()).toHaveLength(2));
    fireEvent.click(screen.getByText("restore-waiting"));
    const workspace = await screen.findByTestId("velero-restore-workspace");
    const controls = [...workspace.querySelectorAll("button, a, input, select, textarea")];

    expect(controls.map((control) => control.getAttribute("data-testid"))).toEqual([
      "velero-back",
      "velero-open-backup-nightly-1",
      "velero-open-schedule-nightly",
      "velero-open-storage-location-default",
    ]);
    expect(workspace.textContent).not.toMatch(/\b(delete|edit|remove|retry|run again)\b/i);
  });
});

describe("details of the host for a restore", () => {
  const extension = { name: "@freelensapp/velero-extension" } as Renderer.LensExtension;
  const details = (resource: object, preferences: Preferences) => {
    const installation = new Installation({
      cluster: { id: "cluster-a", name: "local-demo" },
      read: async () => {
        throw new Error("The details of the host ask nothing of the cluster");
      },
      now: () => 0,
      storage: heldPreferences(preferences),
    });

    return render(
      <RestoreDetails object={new Restore(resource as never)} extension={extension} installation={installation} />,
    );
  };
  const item = (name: string) => document.querySelector(`[data-name="${name}"] .value`)?.textContent;

  it("reads the restore as the views do, and leads to the workspace of the installation selected", async () => {
    mount(answers(), chosen(A));
    await waitFor(() => expect(rows()).toHaveLength(3));
    const row = screen.getByText("restore-waiting").closest(".TableRow") as HTMLElement;
    const phase = within(row).getByText("Waiting for plugin operations").textContent;
    const progress = row.querySelector(".TableCell.progress")?.textContent;
    const failure = row.querySelector("[data-signal]")?.textContent?.replace("error_outline", "");

    cleanup();
    details(waiting, chosen(A));
    expect(item("Phase")).toBe(`${phase} (In flight)`);
    expect(item("Failure")).toBe(failure);
    expect(item("Item progress")).toBe(progress);
    expect(item("Backup")).toBe("nightly-1");
    expect(item("Schedule")).toBe("nightly");
    expect(item("Source")).toContain("does not say which of the two was submitted");
    expect(item("Installation")).toBe(A);
    expect(screen.getByTestId("velero-restore-details-link").getAttribute("href")).toBe(
      "/extension/freelensapp--velero-extension/restores?view=restore%2Frestore-waiting",
    );
  });

  it("gives no link to a restore of a namespace that is not the one selected", () => {
    details(waiting, chosen(B));
    expect(screen.queryByTestId("velero-restore-details-link")).toBeNull();
    expect(screen.getByTestId("velero-restore-details-elsewhere").textContent).toContain(A);
    cleanup();
    details(refused, emptyPreferences());
    expect(screen.queryByTestId("velero-restore-details-link")).toBeNull();
    expect(item("Validation errors")).toBe("No completed backups found for schedule");
    expect(item("Started")).toBe("Not reported");
  });

  it("follows the installation that is selected while the details are open", () => {
    let kept = chosen(B);
    const installation = new Installation({
      cluster: { id: "cluster-a", name: "local-demo" },
      read: async () => ({ status: 404 }),
      now: () => 0,
      storage: {
        read: () => kept,
        write: (preferences) => {
          kept = preferences;
        },
      },
    });

    render(<RestoreDetails object={new Restore(waiting as never)} extension={extension} installation={installation} />);
    expect(screen.queryByTestId("velero-restore-details-link")).toBeNull();
    expect(screen.getByTestId("velero-restore-details-elsewhere").textContent).toContain(A);
    // The namespace of the restore is named and selected in the views, with the details still open.
    act(() => {
      installation.configure(A);
    });
    expect(screen.queryByTestId("velero-restore-details-elsewhere")).toBeNull();
    expect(screen.getByTestId("velero-restore-details-link").getAttribute("href")).toBe(
      "/extension/freelensapp--velero-extension/restores?view=restore%2Frestore-waiting",
    );
    act(() => {
      installation.configure(B);
    });
    expect(screen.queryByTestId("velero-restore-details-link")).toBeNull();
  });

  it("says the counters and the times as the workspace does", () => {
    details(completed, chosen(A));
    expect(item("Failure")).toBe("No errors");
    // Whose zero a zero is is said wherever the counters are shown.
    expect(item("Errors / warnings")).toBe(
      "0 / 0. Velero writes no counter when it counts none: a zero here is a counter that is not in the object.",
    );
    expect(item("Duration")).toBe("3m");
    cleanup();
    details(object("Restore", "stopped", A, { backupName: "nightly-1" }, { phase: "Failed" }), chosen(A));
    expect(item("Failure")).toBe("Failure");
    expect(item("Errors / warnings")).toBe(
      "Not reported / Not reported. Velero can fail an operation before it counts: a counter that is not in the object is not a count of none.",
    );
    expect(item("Duration")).toBe("Start not reported");
    cleanup();
    details(waiting, chosen(A));
    expect(item("Errors / warnings")).toBe(
      "1 / 0. Velero writes no counter when it counts none: a zero here is a counter that is not in the object.",
    );
  });
});
