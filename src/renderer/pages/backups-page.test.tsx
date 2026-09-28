// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { listProps } from "../../../test/host-components";
import { emptyPreferences, RESOURCES } from "../../common/discovery";
import { BACKUP_PHASES } from "../../common/phases";
import { Backup } from "../api/kinds";
import { BackupDetails } from "../details/backup-details";
import { closeViews, openView } from "../navigation";
import { Installation } from "../state/installation";
import { BackupsPage } from "./backups-page";

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

function backup(name: string, namespace: string, status?: object, more: { uid?: string; spec?: object } = {}) {
  return {
    apiVersion: "velero.io/v1",
    kind: "Backup",
    metadata: {
      name,
      namespace,
      uid: more.uid ?? `${namespace}-${name}`,
      resourceVersion: "1",
      creationTimestamp: "2026-09-01T10:00:00Z",
    },
    spec: { storageLocation: "default", includedNamespaces: ["shop"], ...more.spec },
    ...(status ? { status } : {}),
  };
}

const finalizing = backup(
  "nightly-1",
  A,
  {
    phase: "FinalizingPartiallyFailed",
    startTimestamp: "2026-09-01T10:00:00Z",
    progress: { totalItems: 10, itemsBackedUp: 10 },
    // The release writes no counter of zero: no warning is no counter of the warnings.
    errors: 1,
  },
  { spec: { volumeSnapshotLocations: ["snapshots"] } },
);
const completed = backup("nightly-2", A, {
  phase: "Completed",
  startTimestamp: "2026-09-01T10:00:00Z",
  completionTimestamp: "2026-09-01T10:01:00Z",
  progress: { totalItems: 10, itemsBackedUp: 10 },
});
const served: Answer = { status: 200, body: { resources: Object.values(RESOURCES).map((name) => ({ name })) } };

function answers(more: Answers = {}): Answers {
  return {
    [DISCOVERY]: served,
    [LOCATIONS]: list({ metadata: { name: "default", namespace: A } }, { metadata: { name: "default", namespace: B } }),
    [path("backups", A)]: list(finalizing, completed),
    [path("backups", B)]: list(backup("nightly-1", B, { phase: "Completed" })),
    ...Object.fromEntries(
      [A, B].flatMap((namespace) => [
        [path("restores", namespace), list()],
        [path("schedules", namespace), list()],
        [path("storageLocations", namespace), list({ metadata: { name: "default", namespace, uid: "location" } })],
        [path("snapshotLocations", namespace), list()],
      ]),
    ),
    ...more,
  };
}

function mount(table: Answers, preferences: Preferences = emptyPreferences()) {
  const asked: string[] = [];
  const written: Preferences[] = [];
  const clock = { now: Date.parse("2026-09-01T12:00:00Z") };
  const installation = new Installation({
    cluster: { id: "cluster-a", name: "local-demo" },
    read: async (address) => {
      asked.push(address);
      const answer = table[address] ?? { status: 404 };

      return typeof answer === "function" ? answer() : answer;
    },
    now: () => clock.now,
    storage: { read: () => preferences, write: (next) => written.push(next) },
  });
  const view = render(<BackupsPage installation={installation} />);

  return { installation, asked, written, clock, table, view };
}

const chosen = (namespace: string): Preferences => ({ selected: { "cluster-a": namespace }, configured: {} });
const rows = () =>
  [...document.querySelectorAll("[data-backup-row]")].map((row) => row.getAttribute("data-backup-row"));
const notice = (family: string) => screen.queryByTestId(`velero-notice-${family}`)?.textContent ?? "";

afterEach(() => {
  act(() => closeViews());
  cleanup();
  listProps.clear();
  vi.useRealTimers();
});

describe("page of the backups", () => {
  it("asks to choose between two installations and takes none, then lists the backups of the one chosen", async () => {
    const { asked, written } = mount(answers());

    await screen.findByTestId("velero-state-choose");
    expect(screen.queryByTestId("velero-backups")).toBeNull();
    expect(asked).toEqual([DISCOVERY, LOCATIONS]);
    fireEvent.click(screen.getByTestId(`velero-choice-${B}`));
    await waitFor(() => expect(rows()).toEqual(["nightly-1"]));
    expect(written).toEqual([chosen(B)]);
    expect(asked.filter((address) => address.includes(`/namespaces/${A}/`))).toEqual([]);
  });

  it("shows no backup of another installation in the place of one that is not found any more", async () => {
    const { installation, table } = mount(answers(), chosen(A));

    await waitFor(() => expect(rows()).toEqual(["nightly-1", "nightly-2"]));
    table[LOCATIONS] = list({ metadata: { name: "default", namespace: B } });
    table[path("backups", A)] = list();
    await act(() => installation.refresh());
    expect(notice("stale-selection")).toContain(`No storage location is in ${A} any more`);
    expect(rows()).toEqual([]);
    expect(installation.namespace).toBe(A);
  });
});

describe("list of the backups", () => {
  it("gives the host a list that only reads, and shows each backup on the two axes", async () => {
    mount(answers(), chosen(A));
    await waitFor(() => expect(rows()).toEqual(["nightly-1", "nightly-2"]));
    const props = listProps.get("veleroBackupsTable") ?? {};
    const row = screen.getByText("nightly-1").closest(".TableRow") as HTMLElement;

    expect(props.isSelectable).toBe(false);
    expect((props.renderItemMenu as () => unknown)()).toBeNull();
    expect(props.subscribeStores).toBe(false);
    for (const forbidden of ["onAdd", "addRemoveButtons", "renderFooter", "headerActions"]) {
      expect(props[forbidden]).toBeUndefined();
    }
    expect((props.renderTableHeader as { id: string }[]).map((column) => column.id)).toEqual([
      "name",
      "namespace",
      "phase",
      "errors",
      "progress",
      "started",
      "duration",
      "storage",
      "age",
    ]);
    // All the items done, and the operation is neither finished nor healthy.
    expect(within(row).getByText("Finalizing")).toBeTruthy();
    expect(within(row).getByText("autorenew")).toBeTruthy();
    expect(within(row).getByText("1 error")).toBeTruthy();
    expect(within(row).getByText("10 / 10 (100%)")).toBeTruthy();
    expect(row.textContent).toContain("so far");
    expect(row.textContent).not.toContain("Completed");
  });

  it("marks every phase with where the operation is, and a phase that finished in a failure as such", async () => {
    const phases = BACKUP_PHASES.map((phase) => backup(phase.toLowerCase(), A, { phase }));

    mount(answers({ [path("backups", A)]: list(...phases) }), chosen(A));
    await waitFor(() => expect(rows()).toHaveLength(BACKUP_PHASES.length));
    const icons = Object.fromEntries(
      BACKUP_PHASES.map((phase) => {
        const row = screen.getByText(phase.toLowerCase()).closest(".TableRow") as HTMLElement;

        return [phase, row.querySelector("[data-phase] .Icon")?.textContent];
      }),
    );

    expect(icons).toEqual({
      New: "autorenew",
      Queued: "autorenew",
      ReadyToStart: "autorenew",
      InProgress: "autorenew",
      WaitingForPluginOperations: "autorenew",
      WaitingForPluginOperationsPartiallyFailed: "autorenew",
      Finalizing: "autorenew",
      FinalizingPartiallyFailed: "autorenew",
      Completed: "check_circle_outline",
      PartiallyFailed: "highlight_off",
      Failed: "highlight_off",
      FailedValidation: "highlight_off",
      Deleting: "delete_outline",
    });
    // The failure is said in words beside its mark, for who cannot tell a color from another.
    for (const phase of ["WaitingForPluginOperationsPartiallyFailed", "FinalizingPartiallyFailed", "Failed"]) {
      const row = screen.getByText(phase.toLowerCase()).closest(".TableRow") as HTMLElement;

      expect(row.querySelector("[data-signal]")?.getAttribute("data-signal")).toBe("failure");
      expect(row.querySelector("[data-signal]")?.textContent).toContain("Failure");
    }
  });

  it.each([
    ["denied", { status: 403 }, "Access to the backups of this namespace is denied", "access is denied"],
    ["not answered", {}, "could not be read", "could not be read"],
    ["answered with an error", { status: 500 }, "could not be read", "could not be read"],
  ])("does not show a list that was %s as an empty one", async (_name, answer, text, warning) => {
    mount(answers({ [path("backups", A)]: answer as Answer }), chosen(A));
    const state = await screen.findByTestId("velero-backups-unavailable");

    expect(state.textContent).toContain(text);
    expect(state.textContent).toContain("not known");
    expect(screen.queryByTestId("velero-backups")).toBeNull();
    expect(document.body.textContent).not.toMatch(/\b0 items\b/);
    expect(notice("backups")).toContain(warning);
  });

  it("shows a namespace with no backup as a list with none, and says nothing is missing", async () => {
    mount(answers({ [path("backups", A)]: list() }), chosen(A));
    await waitFor(() => expect(screen.getByTestId("velero-backups").textContent).toContain("0 items"));
    expect(screen.getByTestId("velero-backups-empty").textContent).toContain(
      `No backup is in the namespace ${A} of local-demo.`,
    );
    expect(screen.queryByTestId("velero-backups-unavailable")).toBeNull();
    expect(screen.queryByTestId("velero-coverage")).toBeNull();
  });

  it("keeps what was read when the next read fails, and says when it was read", async () => {
    const { installation, table, clock } = mount(answers(), chosen(A));

    await waitFor(() => expect(rows()).toHaveLength(2));
    const read = new Date(clock.now).toLocaleTimeString();

    clock.now += 60_000;
    table[path("backups", A)] = { status: 500 };
    await act(() => installation.refresh());
    expect(rows()).toEqual(["nightly-1", "nightly-2"]);
    expect(notice("backups")).toContain("could not be read");
    expect(notice("backups")).toContain(`What is shown was read at ${read}`);
    // A failure with no status is not an absence: what was read stays.
    table[path("backups", A)] = {};
    await act(() => installation.refresh());
    expect(rows()).toEqual(["nightly-1", "nightly-2"]);
    expect(screen.queryByTestId("velero-state-not-installed")).toBeNull();
  });

  it("stops asking when the view closes", async () => {
    vi.useFakeTimers();
    const { asked, view } = mount(answers(), chosen(A));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(16_000);
    });
    const open = asked.length;

    expect(asked.filter((address) => address === path("backups", A)).length).toBeGreaterThanOrEqual(2);
    view.unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(120_000);
    });
    expect(asked).toHaveLength(open);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("workspace of a backup", () => {
  it("opens from a row and shows a backup that is finalizing with errors as in flight", async () => {
    const { asked } = mount(answers(), chosen(A));

    await waitFor(() => expect(rows()).toHaveLength(2));
    const before = asked.length;

    fireEvent.click(screen.getByText("nightly-1"));
    const workspace = await screen.findByTestId("velero-backup-workspace");
    const status = within(workspace).getByTestId("velero-backup-status").textContent ?? "";

    expect(workspace.getAttribute("data-backup-uid")).toBe(`${A}-nightly-1`);
    expect(status).toContain("Finalizing");
    expect(status).toContain("In flight");
    expect(status).toContain("1 error");
    expect(status).toContain("Elapsed");
    expect(status).toContain(A);
    expect(status).toContain("local-demo");
    expect(within(workspace).getByRole("progressbar").getAttribute("aria-valuenow")).toBe("100");
    expect(within(workspace).getByText("Finalizing", { selector: "[aria-current=step]" })).toBeTruthy();
    expect(within(workspace).getByTestId("velero-backup-counts-note").textContent).toContain(
      "The status reports 1 error and 0 warnings and does not say what they are",
    );
    // Opening a backup asks nothing: what it shows was read with the installation.
    expect(asked).toHaveLength(before);
    expect(asked.every((address) => !/request/i.test(address))).toBe(true);
    expect(document.activeElement).toBe(screen.getByTestId("velero-back"));
    // The list is behind the workspace, as it was.
    expect(rows()).toEqual(["nightly-1", "nightly-2"]);
    fireEvent.keyDown(workspace, { key: "Escape" });
    await waitFor(() => expect(screen.queryByTestId("velero-backup-workspace")).toBeNull());
    expect(document.activeElement?.getAttribute("data-backup-row")).toBe("nightly-1");
  });

  it("gives the focus back to the row, and leaves it where the operator moved it after that", async () => {
    mount(answers(), chosen(A));
    await waitFor(() => expect(rows()).toHaveLength(2));
    fireEvent.click(screen.getByText("nightly-2"));
    fireEvent.click(await screen.findByTestId("velero-back"));
    await waitFor(() => expect(screen.queryByTestId("velero-backup-workspace")).toBeNull());
    expect(document.activeElement?.getAttribute("data-backup-row")).toBe("nightly-2");
    // The operator goes on at once: the row does not take back what it was given.
    screen.getByTestId("velero-refresh").focus();
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(document.activeElement).toBe(screen.getByTestId("velero-refresh"));
  });

  it("keeps the backup and marks what cannot be read of its references", async () => {
    mount(
      answers({
        [path("restores", A)]: { status: 403 },
        [path("snapshotLocations", A)]: {},
        [path("schedules", A)]: list(),
      }),
      chosen(A),
    );
    await waitFor(() => expect(rows()).toHaveLength(2));
    // The list needs the backups alone: what is denied of the rest is not its notice.
    expect(screen.queryByTestId("velero-coverage")).toBeNull();
    fireEvent.click(screen.getByText("nightly-1"));
    await screen.findByTestId("velero-backup-workspace");
    expect(notice("restores")).toContain("access is denied");
    expect(notice("snapshotLocations")).toContain("could not be read");
    const restores = screen.getByTestId("velero-related-restores");
    const snapshots = screen.getByTestId("velero-reference-VolumeSnapshotLocation-snapshots");

    expect(restores.getAttribute("data-reference")).toBe("inaccessible");
    expect(restores.textContent).not.toMatch(/None|\b0\b/);
    expect(snapshots.getAttribute("data-reference")).toBe("unknown");
    expect(screen.getByTestId("velero-reference-BackupStorageLocation-default").getAttribute("data-reference")).toBe(
      "resolved",
    );
    expect(screen.getByTestId("velero-reference-Schedule-none").textContent).toContain("names no schedule");
    expect(screen.getByTestId("velero-backup-status").textContent).toContain("Finalizing");
  });

  it("shows what a backup reports against its phase, and no ratio where none can be given", async () => {
    mount(
      answers({
        [path("backups", A)]: list(
          backup("contradicted", A, { phase: "Completed", errors: 2, progress: { totalItems: 0, itemsBackedUp: 0 } }),
          backup("silent", A),
          backup("exceeded", A, { phase: "InProgress", progress: { totalItems: 4, itemsBackedUp: 9 } }),
        ),
      }),
      chosen(A),
    );
    await waitFor(() => expect(rows()).toHaveLength(3));
    expect(document.body.textContent).not.toContain("NaN");
    fireEvent.click(screen.getByText("contradicted"));
    const messages = (await screen.findByTestId("velero-backup-messages")).textContent ?? "";

    expect(messages).toContain("The phase is Completed and the object reports errors");
    // The warnings the release did not write are none, and nothing is missing of them.
    expect(messages).not.toContain("warnings");
    expect(screen.getByTestId("velero-backup-counts").textContent).toBe("2 / 0");
    expect(screen.getByTestId("velero-backup-status").textContent).toContain("2 errors");
    expect(screen.getByTestId("velero-backup-progress").textContent).toBe("No items counted");
    expect(screen.queryByRole("progressbar")).toBeNull();
    act(() => closeViews());
    act(() => openView({ kind: "backup", name: "silent" }));
    await waitFor(() => expect(screen.getByTestId("velero-backup-name").textContent).toBe("silent"));
    expect(screen.getByTestId("velero-backup-status").textContent).toContain("Not reported");
    expect(screen.getByTestId("velero-backup-status").textContent).toContain("Unknown");
    act(() => closeViews());
    act(() => openView({ kind: "backup", name: "exceeded" }));
    await waitFor(() => expect(screen.getByTestId("velero-backup-name").textContent).toBe("exceeded"));
    expect(screen.getByTestId("velero-backup-progress").textContent).toBe("Reported 9 / 4");
    expect(document.body.textContent).not.toContain("NaN");
  });

  it("shows the backup of the installation selected, and another one when it is created again", async () => {
    const { installation, table } = mount(answers(), chosen(A));

    await waitFor(() => expect(rows()).toHaveLength(2));
    fireEvent.click(screen.getByText("nightly-1"));
    expect((await screen.findByTestId("velero-backup-workspace")).getAttribute("data-backup-uid")).toBe(
      `${A}-nightly-1`,
    );
    table[path("backups", A)] = list(backup("nightly-1", A, { phase: "New" }, { uid: "created-again" }));
    await act(() => installation.refresh());
    expect(screen.getByTestId("velero-backup-workspace").getAttribute("data-backup-uid")).toBe("created-again");
    expect(screen.getByTestId("velero-backup-status").textContent).toContain("New");
    expect(screen.getByTestId("velero-backup-replaced").textContent).toContain(
      "This is another backup of the same name",
    );
    // The views of an installation close when another one is selected: the backup of the same name there
    // is another one, and what was read of the first is gone.
    fireEvent.change(screen.getByLabelText("Velero namespace"), { target: { value: B } });
    await waitFor(() => expect(rows()).toEqual(["nightly-1"]));
    expect(screen.queryByTestId("velero-backup-workspace")).toBeNull();
    fireEvent.click(screen.getByText("nightly-1"));
    expect((await screen.findByTestId("velero-backup-workspace")).getAttribute("data-backup-uid")).toBe(
      `${B}-nightly-1`,
    );
    expect(screen.queryByTestId("velero-backup-replaced")).toBeNull();
    expect(screen.getByTestId("velero-backup-status").textContent).toContain(B);
    expect(screen.getByTestId("velero-backup-status").textContent).not.toContain(A);
  });

  it("says of the deletion of a backup what its phase says, and nothing of what Velero holds", async () => {
    const going = backup("going", A, { phase: "Deleting" });

    mount(
      answers({
        [path("backups", A)]: list({
          ...going,
          metadata: { ...going.metadata, deletionTimestamp: "2026-09-01T11:00:00Z" },
        }),
      }),
      chosen(A),
    );
    await waitFor(() => expect(rows()).toHaveLength(1));
    fireEvent.click(screen.getByText("going"));
    const workspace = await screen.findByTestId("velero-backup-workspace");

    // A backup is deleted through a request to Velero, and nothing of Velero holds its object.
    expect(within(workspace).getByTestId("velero-backup-status").textContent).toContain("Deleting");
    expect(screen.queryByTestId("velero-backup-deleting")).toBeNull();
    // The view is a region with the name of the object for its name.
    expect(workspace.tagName).toBe("SECTION");
    expect(document.getElementById(workspace.getAttribute("aria-labelledby") ?? "")?.textContent).toBe("going");
  });

  it("says that a backup is not there, or that it is not known, and not the one for the other", async () => {
    const { installation, table } = mount(answers(), chosen(A));

    await waitFor(() => expect(rows()).toHaveLength(2));
    act(() => openView({ kind: "backup", name: "removed" }));
    expect((await screen.findByTestId("velero-backup-missing")).textContent).toContain("No backup of this name");
    table[path("backups", B)] = { status: 403 };
    fireEvent.change(screen.getByLabelText("Velero namespace"), { target: { value: B } });
    await waitFor(() => expect(installation.read("backups").status).toBe("forbidden"));
    act(() => openView({ kind: "backup", name: "removed" }));
    expect(screen.queryByTestId("velero-backup-missing")).toBeNull();
    expect(screen.getByTestId("velero-backup-unknown").textContent).toBe(
      `Access to the backups of ${B} is denied, so this one cannot be shown. It is not known to be absent.`,
    );
    expect(screen.getByTestId("velero-backups-unavailable").textContent).toContain("denied");
  });
});

describe("details of the host", () => {
  const extension = { name: "@freelensapp/velero-extension" } as Renderer.LensExtension;
  const details = (resource: object, preferences: Preferences) => {
    const installation = new Installation({
      cluster: { id: "cluster-a", name: "local-demo" },
      read: async () => {
        throw new Error("The details of the host ask nothing of the cluster");
      },
      now: () => 0,
      storage: { read: () => preferences, write: () => undefined },
    });

    return render(
      <BackupDetails object={new Backup(resource as never)} extension={extension} installation={installation} />,
    );
  };
  const item = (name: string) => document.querySelector(`[data-name="${name}"] .value`)?.textContent;

  it("reads the backup as the views do, and leads to the workspace of the installation selected", async () => {
    mount(answers(), chosen(A));
    await waitFor(() => expect(rows()).toHaveLength(2));
    const row = screen.getByText("nightly-1").closest(".TableRow") as HTMLElement;
    const phase = within(row).getByText("Finalizing").textContent;

    cleanup();
    details(finalizing, chosen(A));
    expect(item("Phase")).toBe(`${phase} (In flight)`);
    expect(item("Failure")).toBe("1 error");
    expect(item("Item progress")).toBe("10 / 10 (100%)");
    expect(item("Installation")).toBe(A);
    expect(screen.getByTestId("velero-backup-details-link").getAttribute("href")).toBe(
      "/extension/freelensapp--velero-extension/backups?view=backup%2Fnightly-1",
    );
  });

  it("gives no link to a backup of a namespace that is not the one selected", () => {
    details(finalizing, chosen(B));
    expect(screen.queryByTestId("velero-backup-details-link")).toBeNull();
    expect(screen.getByTestId("velero-backup-details-elsewhere").textContent).toContain(A);
    cleanup();
    details(finalizing, emptyPreferences());
    expect(screen.queryByTestId("velero-backup-details-link")).toBeNull();
  });
});
