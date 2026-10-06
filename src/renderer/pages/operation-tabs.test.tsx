// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { addressChanges, addressSearch, Renderer } from "../../../test/freelens-extensions";
import { confirmDialogs, listProps } from "../../../test/host-components";
import { emptyPreferences, heldPreferences, RESOURCES } from "../../common/discovery";
import { closeViews, openView } from "../navigation";
import { Installation } from "../state/installation";
import { BackupsPage } from "./backups-page";
import { RestoresPage } from "./restores-page";

import type { Answer, Family } from "../../common/discovery";
import type { ArtifactValue, GateState, Answer as IpcAnswer } from "../../common/ipc";
import type { ArtifactClient, GateClient, WriteClient } from "../api/ipc";
import type { ArtifactViewerProps } from "../components/artifact-viewer";

// The viewers are what their own slices make of them. Here each is a double of the contract a tab has
// with its viewer: it records what it was given, and has the part a tab gives the focus to.
const viewers = vi.hoisted(() => ({ given: [] as { viewer: string; props: Record<string, unknown> }[] }));

vi.mock("../components/log-viewer", async () => ({ LogViewer: await viewerDouble("log") }));
vi.mock("../components/results-viewer", async () => ({ ResultsViewer: await viewerDouble("results") }));
vi.mock("../components/resources-viewer", async () => ({ ResourcesViewer: await viewerDouble("resources") }));
vi.mock("../components/volumes-viewer", async () => ({ VolumesViewer: await viewerDouble("volumes") }));

async function viewerDouble(viewer: string) {
  const { CONTENT } = await vi.importActual<typeof import("../components/artifact-viewer")>(
    "../components/artifact-viewer",
  );

  return (props: ArtifactViewerProps) => {
    viewers.given.push({ viewer, props: { ...props } });
    return (
      <div data-testid={props.id} data-viewer={viewer}>
        <div tabIndex={-1} {...{ [CONTENT]: "" }} />
      </div>
    );
  };
}

const DISCOVERY = "/apis/velero.io/v1";
const LOCATIONS = "/apis/velero.io/v1/backupstoragelocations";
const A = "velero-a";
const B = "velero-b";
const NOW = Date.parse("2026-10-05T09:30:00Z");

function path(family: Family, namespace: string): string {
  return `/apis/velero.io/v1/namespaces/${namespace}/${RESOURCES[family]}`;
}

function list(...items: unknown[]): Answer {
  return { status: 200, body: { items } };
}

function object(kind: string, name: string, spec: object, status: object, uid = `${kind.toLowerCase()}-${name}-uid`) {
  return {
    apiVersion: "velero.io/v1",
    kind,
    metadata: { name, namespace: A, uid, resourceVersion: "1", creationTimestamp: "2026-10-01T10:00:00Z" },
    spec,
    status,
  };
}

// The release writes no counter of zero: one error, and no warning, is a counter of the errors alone.
const nightly = (uid?: string) =>
  object(
    "Backup",
    "nightly",
    { storageLocation: "default" },
    { phase: "FinalizingPartiallyFailed", startTimestamp: "2026-10-01T10:00:00Z", errors: 1 },
    uid,
  );
// The release can fail an operation before it counts: nothing is counted of this one.
const stopped = object("Backup", "stopped", { storageLocation: "default" }, { phase: "Failed" });
const monday = (uid?: string) =>
  object(
    "Restore",
    "monday",
    { backupName: "nightly" },
    { phase: "PartiallyFailed", startTimestamp: "2026-10-01T11:00:00Z", errors: 2, warnings: 3 },
    uid,
  );
// A restore whose status writes its errors, and no warning: the release writes no counter of zero.
const tuesday = object(
  "Restore",
  "tuesday",
  { backupName: "nightly" },
  { phase: "PartiallyFailed", startTimestamp: "2026-10-01T12:00:00Z", errors: 1 },
);

function answers(more: Record<string, Answer> = {}): Record<string, Answer> {
  return {
    [DISCOVERY]: { status: 200, body: { resources: Object.values(RESOURCES).map((name) => ({ name })) } },
    [LOCATIONS]: list({ metadata: { name: "default", namespace: A } }, { metadata: { name: "default", namespace: B } }),
    [path("backups", A)]: list(nightly(), stopped),
    [path("restores", A)]: list(monday()),
    [path("schedules", A)]: list(),
    [path("storageLocations", A)]: list(object("BackupStorageLocation", "default", {}, { phase: "Available" })),
    [path("snapshotLocations", A)]: list(),
    ...Object.fromEntries((Object.keys(RESOURCES) as Family[]).map((family) => [path(family, B), list()])),
    ...more,
  };
}

const VALUE: ArtifactValue = {
  request: { name: "nightly-request-1", uid: "request-uid" },
  size: 9,
  pages: 1,
  route: { mode: "tunnel", encrypted: true, origin: "https://storage.velero.svc:9000" },
};

// The main process, as the views see it. Every call of a write, and of what follows one, is recorded:
// the state of the gate is what the target bar asks when a page opens, and is not one.
function mainProcess() {
  let state: GateState = {
    cluster: { id: "cluster-a", name: "local-demo", context: "kind-local-demo" },
    writes: { on: false },
  };
  const calls: string[] = [];
  const runs: ((answer: IpcAnswer<ArtifactValue>) => void)[] = [];
  let tokens = 0;
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
    confirm: async (_cluster, _namespace, kind, target, artifact) => {
      calls.push(`confirm ${kind} ${target?.kind}/${target?.name}/${target?.uid} ${artifact}`);
      tokens += 1;
      return { ok: true, value: { token: `token-${tokens}`, expires: NOW + 30_000 } };
    },
    runServerStatus: async () => {
      calls.push("runServerStatus");
      return { ok: false, code: "request-failed", stage: "request", retry: false, text: "Not asked here." };
    },
    status: async () => {
      calls.push("status");
      return { ok: true, value: { step: "wait" } };
    },
    cancel: async (_cluster, request) => {
      calls.push(`cancel ${request}`);
      return { ok: true, value: null };
    },
    runDownload: (_cluster, _namespace, target, artifact, _token, request) => {
      calls.push(`run ${target.kind}/${target.name} ${artifact} ${request}`);
      return new Promise((resolve) => runs.push(resolve));
    },
    page: async (_cluster, request, page) => {
      calls.push(`page ${request} ${page}`);
      return { ok: true, value: { page, pages: 1, text: "one line\n" } };
    },
    release: async (_cluster, request) => {
      calls.push(`release ${request}`);
      return { ok: true, value: null };
    },
    save: async (_cluster, request) => {
      calls.push(`save ${request}`);
      return { ok: true, value: { saved: true } };
    },
  };

  return {
    gate,
    writer,
    calls,
    answer: async () => {
      const resolve = runs.shift();

      if (!resolve) throw new Error("No download waits");
      await act(async () => {
        resolve({ ok: true, value: VALUE });
        await new Promise((done) => setTimeout(done, 0));
      });
    },
  };
}

function mount(page: typeof BackupsPage = BackupsPage, table = answers()) {
  const main = mainProcess();
  const asked: string[] = [];
  let requests = 0;
  const installation = new Installation({
    cluster: { id: "cluster-a", name: "local-demo" },
    read: async (address) => {
      asked.push(address);
      return table[address] ?? { status: 404 };
    },
    now: () => NOW,
    storage: heldPreferences({ ...emptyPreferences(), selected: { "cluster-a": A } }),
    gate: main.gate,
    writer: main.writer,
    requestId: () => {
      requests += 1;
      return `request-${requests}`;
    },
  });
  const Page = page;
  const view = render(<Page installation={installation} />);

  return { installation, main, asked, table, view };
}

// The address as a link, or the operator, writes it.
function address(search: string): void {
  act(() => Renderer.Navigation.navigate({ search }));
}

const tabs = () => screen.getAllByRole("tab");
const tab = (title: string) => tabs().find((one) => one.textContent === title) as HTMLElement;
const selected = () => tabs().map((one) => one.getAttribute("aria-selected") === "true");
const panel = () => screen.getByRole("tabpanel");

async function listed(kind: "backup" | "restore", count: number) {
  await waitFor(() => expect(document.querySelectorAll(`[data-${kind}-row]`)).toHaveLength(count));
  await waitFor(() => expect(screen.getByTestId("velero-writes-state").textContent).not.toBe(""));
}

async function writesOn() {
  fireEvent.click(await screen.findByTestId("velero-writes-on"));
  await act(async () => {
    await confirmDialogs.at(-1)?.ok?.();
  });
  await waitFor(() => expect(screen.getByTestId("velero-writes").getAttribute("data-writes")).toBe("on"));
}

// The two gestures of a tab, and the text the main process gives.
async function load(main: ReturnType<typeof mainProcess>, id: string) {
  const runs = main.calls.filter((call) => call.startsWith("run")).length;

  fireEvent.click(screen.getByTestId(`${id}-create`));
  fireEvent.click(await screen.findByTestId(`${id}-confirm-create`));
  await waitFor(() => expect(main.calls.filter((call) => call.startsWith("run"))).toHaveLength(runs + 1));
  await main.answer();
  await waitFor(() => expect(screen.getByTestId(id).getAttribute("data-step")).toBe("loaded"));
}

afterEach(() => {
  act(() => closeViews());
  if (addressSearch()) address("");
  cleanup();
  listProps.clear();
  confirmDialogs.length = 0;
  viewers.given.length = 0;
});

describe("the tabs in the workspace of a backup", () => {
  it("are under its header, the summary first and open, with everything the workspace showed before them", async () => {
    mount();
    await listed("backup", 2);
    fireEvent.click(screen.getByText("nightly"));
    const workspace = await screen.findByTestId("velero-backup-workspace");

    expect(within(workspace).getByRole("tablist").getAttribute("aria-label")).toBe("What is shown of the backup");
    expect(tabs().map((one) => one.textContent)).toEqual(["Summary", "Log", "Results", "Resources", "Volumes"]);
    expect(selected()).toEqual([true, false, false, false, false]);
    // One panel, named by the tab that is shown, which names it.
    expect(panel().id).toBe("velero-backup-panel");
    expect(panel().getAttribute("aria-labelledby")).toBe("velero-backup-tab-summary");
    expect(panel().getAttribute("data-tab")).toBe("summary");
    for (const one of tabs()) expect(one.getAttribute("aria-controls")).toBe(panel().id);
    // The summary is what the workspace shows, whole.
    for (const part of ["status", "stages", "progress", "counts-note", "scope", "references"])
      expect([part, panel().contains(screen.getByTestId(`velero-backup-${part}`))]).toEqual([part, true]);
    // The header, then the tabs, then what they show.
    const order = [screen.getByTestId("velero-back"), tabs()[0], panel()];

    expect(order[0].compareDocumentPosition(order[1]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(order[1].compareDocumentPosition(order[2]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(panel().contains(tabs()[0])).toBe(false);
    expect(addressSearch()).toBe("view=backup%2Fnightly");
  });

  it("says in the summary that what the counters count is in the Log and Results tabs", async () => {
    mount();
    await listed("backup", 2);
    act(() => openView({ kind: "backup", name: "nightly" }));
    expect((await screen.findByTestId("velero-backup-counts-note")).textContent).toBe(
      "The status reports 1 error and 0 warnings and does not say what they are: that is in the log and in the results of the backup, which the Log and Results tabs load when they are asked.",
    );
  });

  it("writes the tab that is chosen into the address, with one change of it, and shows the tab the address names", async () => {
    mount();
    await listed("backup", 2);
    act(() => openView({ kind: "backup", name: "nightly" }));
    await screen.findByTestId("velero-backup-workspace");
    const before = addressChanges.count;

    fireEvent.click(tab("Log"));
    expect(addressSearch()).toBe("view=backup%2Fnightly&tab=log");
    expect(addressChanges.count - before).toBe(1);
    expect(selected()).toEqual([false, true, false, false, false]);
    expect(panel().getAttribute("aria-labelledby")).toBe("velero-backup-tab-log");
    expect(panel().getAttribute("data-tab")).toBe("log");
    // The panel shows the tab of the log, at its first state, and nothing of the summary.
    expect(within(panel()).getByTestId("velero-backup-log").getAttribute("data-step")).toBe("first");
    expect(screen.queryByTestId("velero-backup-status")).toBeNull();
    // The address is what says the tab: a link, or the way back of the host, shows another.
    for (const [search, shown, id] of [
      ["view=backup%2Fnightly&tab=results", "results", "velero-backup-results"],
      ["view=backup%2Fnightly&tab=resources", "resources", "velero-backup-resources"],
      ["view=backup%2Fnightly&tab=volumes", "volumes", "velero-backup-volumes"],
    ]) {
      address(search);
      expect(panel().getAttribute("data-tab")).toBe(shown);
      expect(within(panel()).getByTestId(id).getAttribute("data-step")).toBe("first");
      expect(panel().getAttribute("aria-labelledby")).toBe(`velero-backup-tab-${shown}`);
    }
    // What is no tab is the summary, and the summary is chosen by taking the tab out of the address.
    address("view=backup%2Fnightly&tab=contents");
    expect(panel().getAttribute("data-tab")).toBe("summary");
    expect(screen.getByTestId("velero-backup-status")).toBeTruthy();
    fireEvent.click(tab("Volumes"));
    fireEvent.click(tab("Summary"));
    expect(addressSearch()).toBe("view=backup%2Fnightly");
    expect(screen.getByTestId("velero-backup-status")).toBeTruthy();
  });

  it("shows the tab of an address the page is opened at, with nothing of it loaded", async () => {
    address("view=backup%2Fnightly&tab=results");
    const { main } = mount();

    await listed("backup", 2);
    expect(selected()).toEqual([false, false, true, false, false]);
    expect(within(panel()).getByTestId("velero-backup-results").getAttribute("data-step")).toBe("first");
    expect(viewers.given).toEqual([]);
    expect(main.calls).toEqual([]);
  });

  it("asks nothing and creates nothing when a tab is opened, with writes off and with writes on", async () => {
    const { main, asked } = mount();

    await listed("backup", 2);
    act(() => openView({ kind: "backup", name: "nightly" }));
    await screen.findByTestId("velero-backup-workspace");
    const read = asked.length;

    for (const title of ["Log", "Results", "Resources", "Volumes", "Summary"]) fireEvent.click(tab(title));
    await writesOn();
    for (const title of ["Log", "Results", "Resources", "Volumes", "Summary", "Log"]) {
      fireEvent.click(tab(title));
      await act(async () => {
        await new Promise((done) => setTimeout(done, 0));
      });
    }
    // The tab offers its command, and waits for it.
    expect(screen.getByTestId("velero-backup-log-create")).toBeTruthy();
    // No procedure of a write was called, and the cluster was read no more than it was.
    expect(main.calls).toEqual([]);
    expect(asked).toHaveLength(read);
    expect(asked.every((one) => !/request/i.test(one))).toBe(true);
  });

  it("keeps what a tab loaded while the view is open, and drops it when the view closes", async () => {
    const { main } = mount();

    await listed("backup", 2);
    act(() => openView({ kind: "backup", name: "nightly" }));
    await screen.findByTestId("velero-backup-workspace");
    await writesOn();
    fireEvent.click(tab("Log"));
    await load(main, "velero-backup-log");
    expect(viewers.given.at(-1)?.props).toEqual({ id: "velero-backup-log-viewer", text: "one line\n", of: "Backup" });
    const calls = main.calls.length;

    // Another tab is at its own first state, and the summary is the summary.
    fireEvent.click(tab("Results"));
    expect(screen.getByTestId("velero-backup-results").getAttribute("data-step")).toBe("first");
    fireEvent.click(tab("Summary"));
    expect(screen.queryByTestId("velero-backup-log")).toBeNull();
    // Back at the log, the text is the one that was loaded: nothing was asked for it again.
    fireEvent.click(tab("Log"));
    expect(screen.getByTestId("velero-backup-log").getAttribute("data-step")).toBe("loaded");
    expect(screen.getByTestId("velero-backup-log-viewer")).toBeTruthy();
    expect(main.calls).toHaveLength(calls);
    // The view closes: the main process is told to let the text go.
    fireEvent.click(screen.getByTestId("velero-back"));
    await waitFor(() => expect(screen.queryByTestId("velero-backup-workspace")).toBeNull());
    expect(main.calls.slice(calls)).toEqual(["release request-1"]);
    // Opened again, the view is at its summary, and the tab of the log at its first state.
    act(() => openView({ kind: "backup", name: "nightly" }));
    await screen.findByTestId("velero-backup-workspace");
    expect(panel().getAttribute("data-tab")).toBe("summary");
    fireEvent.click(tab("Log"));
    expect(screen.getByTestId("velero-backup-log").getAttribute("data-step")).toBe("first");
    expect(main.calls.slice(calls)).toEqual(["release request-1"]);
  });

  it("drops what a tab loaded when another installation is selected", async () => {
    const { main } = mount();

    await listed("backup", 2);
    act(() => openView({ kind: "backup", name: "nightly" }));
    await screen.findByTestId("velero-backup-workspace");
    await writesOn();
    fireEvent.click(tab("Log"));
    await load(main, "velero-backup-log");
    fireEvent.change(screen.getByLabelText("Velero namespace"), { target: { value: B } });
    await waitFor(() => expect(main.calls).toContain("release request-1"));
    await waitFor(() => expect(screen.queryByTestId("velero-backup-workspace")).toBeNull());
  });

  it("drops what a tab loaded of a backup when another one took its place under the same name", async () => {
    const { main, installation, table } = mount();

    await listed("backup", 2);
    act(() => openView({ kind: "backup", name: "nightly" }));
    await screen.findByTestId("velero-backup-workspace");
    await writesOn();
    fireEvent.click(tab("Log"));
    await load(main, "velero-backup-log");
    table[path("backups", A)] = list(nightly("another-uid"), stopped);
    await act(() => installation.refresh());
    expect(screen.getByTestId("velero-backup-replaced")).toBeTruthy();
    expect(screen.getByTestId("velero-backup-log").getAttribute("data-step")).toBe("first");
    expect(screen.queryByTestId("velero-backup-log-viewer")).toBeNull();
    expect(main.calls.at(-1)).toBe("release request-1");
    // What is asked now is asked of the backup that is there.
    fireEvent.click(screen.getByTestId("velero-backup-log-create"));
    await screen.findByTestId("velero-backup-log-confirm");
    expect(main.calls.at(-1)).toBe("confirm DownloadRequest Backup/nightly/another-uid BackupLog");
  });

  it("gives the results the counters the status writes with its phase, and no counter it does not write", async () => {
    const { main } = mount();

    await listed("backup", 2);
    act(() => openView({ kind: "backup", name: "nightly" }));
    await screen.findByTestId("velero-backup-workspace");
    await writesOn();
    fireEvent.click(tab("Results"));
    await load(main, "velero-backup-results");
    // One error is written. The warnings the release counted and did not write are a zero of the views,
    // which is not in the object: no counter of them is given.
    expect(viewers.given.at(-1)).toEqual({
      viewer: "results",
      props: {
        id: "velero-backup-results-viewer",
        text: "one line\n",
        of: "Backup",
        counters: { errors: 1 },
        phase: "FinalizingPartiallyFailed",
      },
    });
    fireEvent.click(screen.getByTestId("velero-back"));
    act(() => openView({ kind: "backup", name: "stopped" }));
    await screen.findByTestId("velero-backup-workspace");
    fireEvent.click(tab("Results"));
    await load(main, "velero-backup-results");
    expect(viewers.given.at(-1)?.props.counters).toEqual({});
  });

  it("shows no tabs of a backup that is not found", async () => {
    mount();
    await listed("backup", 2);
    address("view=backup%2Fremoved&tab=log");
    expect(await screen.findByTestId("velero-backup-missing")).toBeTruthy();
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.queryByRole("tabpanel")).toBeNull();
    expect(screen.queryByTestId("velero-backup-log")).toBeNull();
  });
});

describe("the tabs in the workspace of a restore", () => {
  it("are under its header, the summary first and open, with everything the workspace showed before them", async () => {
    mount(RestoresPage);
    await listed("restore", 1);
    fireEvent.click(screen.getByText("monday"));
    const workspace = await screen.findByTestId("velero-restore-workspace");

    expect(within(workspace).getByRole("tablist").getAttribute("aria-label")).toBe("What is shown of the restore");
    expect(tabs().map((one) => one.textContent)).toEqual(["Summary", "Log", "Results", "Resources", "Volumes"]);
    expect(selected()).toEqual([true, false, false, false, false]);
    expect(panel().id).toBe("velero-restore-panel");
    expect(panel().getAttribute("aria-labelledby")).toBe("velero-restore-tab-summary");
    for (const part of ["status", "stages", "progress", "counts-note", "source", "mappings-none", "scope"])
      expect([part, panel().contains(screen.getByTestId(`velero-restore-${part}`))]).toEqual([part, true]);
    expect(screen.getByTestId("velero-restore-counts-note").textContent).toBe(
      "The status reports 2 errors and 3 warnings and does not say what they are: that is in the log and in the results of the restore, which the Log and Results tabs load when they are asked.",
    );
    // What the Tab key reaches in the workspace, in its order: the way back, the five tabs, each one a
    // stop as the tabs of the host are, and then the way to the backup, which is six presses from the way
    // back. The keyboard journey of the packaged application counts them.
    const stops = [...workspace.querySelectorAll<HTMLElement>("button, a[href], input, [tabindex]")]
      .filter((part) => part.tabIndex >= 0)
      .map((part) => part.getAttribute("data-testid"));

    expect(stops.slice(0, 7)).toEqual([
      "velero-back",
      "velero-restore-tab-summary",
      "velero-restore-tab-log",
      "velero-restore-tab-results",
      "velero-restore-tab-resources",
      "velero-restore-tab-volumes",
      "velero-open-backup-nightly",
    ]);
  });

  it("shows the tab that is chosen, asks nothing for it, and loads what its command asks, of the restore", async () => {
    const { main } = mount(RestoresPage);

    await listed("restore", 1);
    act(() => openView({ kind: "restore", name: "monday" }));
    await screen.findByTestId("velero-restore-workspace");
    await writesOn();
    for (const [title, id] of [
      ["Log", "velero-restore-log"],
      ["Resources", "velero-restore-resources"],
      ["Volumes", "velero-restore-volumes"],
      ["Results", "velero-restore-results"],
    ]) {
      fireEvent.click(tab(title));
      expect(within(panel()).getByTestId(id).getAttribute("data-step")).toBe("first");
      expect(panel().getAttribute("aria-labelledby")).toBe(`velero-restore-tab-${title.toLowerCase()}`);
      // The strip says that this tab is the one selected, and no other.
      expect(
        tabs()
          .filter((one) => one.getAttribute("aria-selected") === "true")
          .map((one) => one.textContent),
      ).toEqual([title]);
    }
    expect(addressSearch()).toBe("view=restore%2Fmonday&tab=results");
    expect(main.calls).toEqual([]);
    await load(main, "velero-restore-results");
    expect(main.calls.slice(0, 2)).toEqual([
      "confirm DownloadRequest Restore/monday/restore-monday-uid RestoreResults",
      "run Restore/monday RestoreResults request-1",
    ]);
    expect(viewers.given.at(-1)).toEqual({
      viewer: "results",
      props: {
        id: "velero-restore-results-viewer",
        text: "one line\n",
        of: "Restore",
        counters: { errors: 2, warnings: 3 },
        phase: "PartiallyFailed",
      },
    });
    // The view closes with Escape: what the tab loaded goes.
    fireEvent.keyDown(screen.getByTestId("velero-restore-workspace"), { key: "Escape" });
    await waitFor(() => expect(screen.queryByTestId("velero-restore-workspace")).toBeNull());
    expect(main.calls.at(-1)).toBe("release request-1");
  });

  it("drops what a tab loaded of a restore when another one took its place under the same name", async () => {
    const { main, installation, table } = mount(RestoresPage);

    await listed("restore", 1);
    act(() => openView({ kind: "restore", name: "monday" }));
    await screen.findByTestId("velero-restore-workspace");
    await writesOn();
    fireEvent.click(tab("Log"));
    await load(main, "velero-restore-log");
    expect(viewers.given.at(-1)?.props).toEqual({ id: "velero-restore-log-viewer", text: "one line\n", of: "Restore" });
    table[path("restores", A)] = list(monday("another-uid"));
    await act(() => installation.refresh());
    // The text was of the restore that is not there any more: it goes, here and in the main process.
    expect(screen.getByTestId("velero-restore-log").getAttribute("data-step")).toBe("first");
    expect(screen.queryByTestId("velero-restore-log-viewer")).toBeNull();
    expect(main.calls.at(-1)).toBe("release request-1");
    // What is asked now is asked of the restore that is there.
    fireEvent.click(screen.getByTestId("velero-restore-log-create"));
    await screen.findByTestId("velero-restore-log-confirm");
    expect(main.calls.at(-1)).toBe("confirm DownloadRequest Restore/monday/another-uid RestoreLog");
  });

  it("gives the results the counters the status of a restore writes with its phase, and no counter it does not write", async () => {
    const { main } = mount(RestoresPage, answers({ [path("restores", A)]: list(monday(), tuesday) }));

    await listed("restore", 2);
    act(() => openView({ kind: "restore", name: "tuesday" }));
    await screen.findByTestId("velero-restore-workspace");
    await writesOn();
    fireEvent.click(tab("Results"));
    await load(main, "velero-restore-results");
    // One error is written. The warnings the release counted and did not write are a zero of the views,
    // which is not in the object: no counter of them is given, to be compared with what the results count.
    expect(viewers.given.at(-1)).toEqual({
      viewer: "results",
      props: {
        id: "velero-restore-results-viewer",
        text: "one line\n",
        of: "Restore",
        counters: { errors: 1 },
        phase: "PartiallyFailed",
      },
    });
  });

  it("shows no tabs of a restore that is not found", async () => {
    mount(RestoresPage);
    await listed("restore", 1);
    address("view=restore%2Fremoved&tab=volumes");
    expect(await screen.findByTestId("velero-restore-missing")).toBeTruthy();
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.queryByRole("tabpanel")).toBeNull();
  });
});
