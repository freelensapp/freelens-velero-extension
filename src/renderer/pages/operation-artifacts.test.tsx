// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { addressSearch, Renderer } from "../../../test/freelens-extensions";
import { confirmDialogs, listProps, virtualList } from "../../../test/host-components";
import { otherShape as otherResources, parseResources, resourcesCount } from "../../common/artifact-resources";
import { otherShape as otherResults, parseResults, resultsSummary } from "../../common/artifact-results";
import { artifactOf } from "../../common/artifact-text";
import { otherShape as otherVolumes, volumesCount } from "../../common/artifact-volumes";
import { emptyPreferences, heldPreferences, RESOURCES } from "../../common/discovery";
import { CONTENT } from "../components/artifact-viewer";
import { closeViews, openView } from "../navigation";
import { Installation } from "../state/installation";
import { BackupsPage } from "./backups-page";
import { RestoresPage } from "./restores-page";

import type { ArtifactTab } from "../../common/artifact-text";
import type { Answer, Family } from "../../common/discovery";
import type { ArtifactTarget, GateState } from "../../common/ipc";
import type { OperationKind } from "../../common/phases";
import type { ArtifactClient, GateClient, WriteClient } from "../api/ipc";

// Nothing of the extension is replaced here: the page, the workspace, the tabs, the panel of a tab, the
// viewer of each and the lines of a text are the ones the operator has, on the doubles of the host. What
// is under test is what each of them gives to the next.

const DISCOVERY = "/apis/velero.io/v1";
const LOCATIONS = "/apis/velero.io/v1/backupstoragelocations";
const A = "velero-a";
const NOW = Date.parse("2026-10-05T09:30:00Z");
// The time of a test that goes through the load of several tabs, on a machine that is busy.
const SLOW = 30_000;
// The room the list of the host has in the tests, which one of them takes away and gives back.
const ROOM = virtualList.room;

function path(family: Family, namespace: string): string {
  return `/apis/velero.io/v1/namespaces/${namespace}/${RESOURCES[family]}`;
}

function list(...items: unknown[]): Answer {
  return { status: 200, body: { items } };
}

function object(kind: string, name: string, spec: object, status: object) {
  return {
    apiVersion: "velero.io/v1",
    kind,
    metadata: {
      name,
      namespace: A,
      uid: `${kind.toLowerCase()}-${name}-uid`,
      resourceVersion: "1",
      creationTimestamp: "2026-10-01T10:00:00Z",
    },
    spec,
    status,
  };
}

function answers(): Record<string, Answer> {
  return {
    [DISCOVERY]: { status: 200, body: { resources: Object.values(RESOURCES).map((name) => ({ name })) } },
    [LOCATIONS]: list({ metadata: { name: "default", namespace: A } }),
    // The release counts the status and the results of an operation on the same messages, and adds to
    // the status alone the errors of the operations of its plugins: each status counts one error more
    // than its results hold, and as many warnings. An operation with an error did not complete.
    [path("backups", A)]: list(
      object(
        "Backup",
        "nightly",
        { storageLocation: "default" },
        { phase: "PartiallyFailed", startTimestamp: "2026-10-01T10:00:00Z", errors: 2, warnings: 1 },
      ),
      // A backup that completed with nothing to count: the release writes no counter of zero.
      object(
        "Backup",
        "quiet",
        { storageLocation: "default" },
        { phase: "Completed", startTimestamp: "2026-10-01T09:00:00Z" },
      ),
    ),
    [path("restores", A)]: list(
      object(
        "Restore",
        "monday",
        { backupName: "nightly" },
        { phase: "PartiallyFailed", startTimestamp: "2026-10-01T11:00:00Z", errors: 2, warnings: 1 },
      ),
    ),
    [path("schedules", A)]: list(),
    [path("storageLocations", A)]: list(object("BackupStorageLocation", "default", {}, { phase: "Available" })),
    [path("snapshotLocations", A)]: list(),
  };
}

// What Velero wrote of the two operations, in the forms of the reviewed release. The messages of a backup
// are the entries of its log as the hook of the server writes them, the message always among their parts;
// the ones of a restore are the texts of the restore itself, and its log is its own.
const LOG = [
  'time="2026-10-01T10:00:01Z" level=info msg="Backing up item" backup=velero-a/nightly',
  'time="2026-10-01T10:00:02Z" level=error msg="Error backing up item" backup=velero-a/nightly',
].join("\n");
const RESTORE_LOG = [
  'time="2026-10-01T11:00:01Z" level=info msg="Starting restore of backup velero-a/nightly" restore=velero-a/monday',
  'time="2026-10-01T11:00:02Z" level=error msg="error restoring pay: synthetic refusal" restore=velero-a/monday',
].join("\n");
const RESULTS = JSON.stringify({
  errors: {
    namespaces: { shop: [" resource: /pods name: /cart message: /Error backing up item error: /hook failed"] },
  },
  warnings: { velero: [" message: /a synthetic warning of the server"] },
});
const RESTORE_RESULTS = JSON.stringify({
  errors: { namespaces: { shop: ["error restoring pods/shop/pay: synthetic refusal"] } },
  warnings: {
    namespaces: {
      shop: [
        "could not restore, ConfigMap:settings already exists. Warning: the in-cluster version is different than the backed-up version",
      ],
    },
  },
});
const BACKED_UP = JSON.stringify({ "v1/Pod": ["shop/cart", "shop/pay"], "v1/Namespace": ["shop"] });
const RESTORED = JSON.stringify({ "v1/Pod": ["shop/cart(created)", "shop/pay(failed)"] });
const VOLUMES = JSON.stringify([
  { pvcName: "data", pvcNamespace: "shop", pvName: "pv-1", backupMethod: "NativeSnapshot", result: "succeeded" },
]);
const RESTORED_VOLUMES = JSON.stringify([
  { pvcName: "data", pvcNamespace: "shop", pvName: "pv-1", restoreMethod: "NativeSnapshot", snapshotDataMoved: false },
]);
// A JSON that is of none of the shapes of the release, on two lines, and what every tab says of one.
const OTHER = '{\n"kind": "Status"}';
const OTHER_SHAPE = "not of the shape the extension was written for";

function texts(): Record<ArtifactTarget, string> {
  return {
    BackupLog: LOG,
    BackupResults: RESULTS,
    BackupResourceList: BACKED_UP,
    BackupVolumeInfos: VOLUMES,
    RestoreLog: RESTORE_LOG,
    RestoreResults: RESTORE_RESULTS,
    RestoreResourceList: RESTORED,
    RestoreVolumeInfo: RESTORED_VOLUMES,
  };
}

// The main process, as the views see it: the gate, and a download that answers with the text of the
// artifact that was asked, in one page. Every call of a write is recorded.
function mainProcess() {
  let state: GateState = {
    cluster: { id: "cluster-a", name: "local-demo", context: "kind-local-demo" },
    writes: { on: false },
  };
  const calls: string[] = [];
  const written = texts();
  const asked = new Map<string, ArtifactTarget>();
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
    confirm: async () => {
      tokens += 1;
      return { ok: true, value: { token: `token-${tokens}`, expires: NOW + 30_000 } };
    },
    runServerStatus: async () => ({
      ok: false,
      code: "request-failed",
      stage: "request",
      retry: false,
      text: "Not asked here.",
    }),
    status: async () => ({ ok: true, value: { step: "wait" } }),
    cancel: async () => ({ ok: true, value: null }),
    runDownload: async (_cluster, _namespace, target, artifact, _token, request) => {
      calls.push(`run ${target.kind}/${target.name} ${artifact}`);
      asked.set(request, artifact);
      return {
        ok: true,
        value: {
          request: { name: `${target.name}-${request}`, uid: `${request}-uid` },
          size: written[artifact].length,
          pages: 1,
          route: { mode: "tunnel", encrypted: true, origin: "https://storage.velero.svc:9000" },
        },
      };
    },
    page: async (_cluster, request, page) => ({
      ok: true,
      value: { page, pages: 1, text: written[asked.get(request) as ArtifactTarget] },
    }),
    release: async (_cluster, request) => {
      calls.push(`release ${request}`);
      return { ok: true, value: null };
    },
    save: async () => ({ ok: true, value: { saved: true } }),
  };

  return { gate, writer, calls, written };
}

function mount(page: typeof BackupsPage = BackupsPage) {
  const main = mainProcess();
  const table = answers();
  let requests = 0;
  const installation = new Installation({
    cluster: { id: "cluster-a", name: "local-demo" },
    read: async (address) => table[address] ?? { status: 404 },
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

  render(<Page installation={installation} />);
  return { ...main, table, installation };
}

const tab = (title: string) => screen.getAllByRole("tab").find((one) => one.textContent === title) as HTMLElement;
const focused = () => document.activeElement?.getAttribute("data-testid");

// A command is given as the pointer gives it in the application: what is pressed has the focus.
function press(element: HTMLElement): void {
  element.focus();
  fireEvent.click(element);
}

// The view of an operation, open over its list, with writes on.
async function opened(kind: OperationKind, name: string) {
  const main = mount(kind === "Backup" ? BackupsPage : RestoresPage);

  await waitFor(() => expect(document.querySelectorAll(`[data-${kind.toLowerCase()}-row]`).length).toBeGreaterThan(0));
  await waitFor(() => expect(screen.getByTestId("velero-writes-state").textContent).not.toBe(""));
  act(() => openView({ kind: kind === "Backup" ? "backup" : "restore", name }));
  await screen.findByTestId(`velero-${kind.toLowerCase()}-workspace`);
  fireEvent.click(await screen.findByTestId("velero-writes-on"));
  await act(async () => {
    await confirmDialogs.at(-1)?.ok?.();
  });
  await waitFor(() => expect(screen.getByTestId("velero-writes").getAttribute("data-writes")).toBe("on"));
  return main;
}

// A tab is chosen, and its text is asked for with the two gestures of its panel. What is given back is
// the name the parts of its viewer are found by.
async function loaded(kind: OperationKind, title: string): Promise<string> {
  const id = `velero-${kind.toLowerCase()}-${title.toLowerCase()}`;

  fireEvent.click(tab(title));
  press(screen.getByTestId(`${id}-create`));
  press(await screen.findByTestId(`${id}-confirm-create`));
  await waitFor(() => expect(screen.getByTestId(id).getAttribute("data-step")).toBe("loaded"));
  return `${id}-viewer`;
}

// What a viewer says of counts that differ, a sentence a paragraph.
function differs(viewer: string): string[] {
  return [...screen.getByTestId(`${viewer}-differs`).querySelectorAll("p")].map((line) => line.textContent ?? "");
}

// The parts of a tab that are marked as the first line of what it shows.
function marked(viewer: string): HTMLElement[] {
  const panel = screen.getByTestId(viewer.replace(/-viewer$/, ""));

  return [...panel.querySelectorAll<HTMLElement>(`[${CONTENT}]`)];
}

// The list of the host is given a room, or loses it, as it does when what holds it changes its size.
function room(height: number): void {
  virtualList.room = height;
  fireEvent(window, new Event("resize"));
}

// What was asked of the page had the time to be done.
async function settled() {
  await act(async () => {
    await new Promise((done) => setTimeout(done, 0));
  });
}

afterEach(() => {
  virtualList.room = ROOM;
  act(() => closeViews());
  if (addressSearch()) act(() => Renderer.Navigation.navigate({ search: "" }));
  cleanup();
  listProps.clear();
  confirmDialogs.length = 0;
});

describe("what the tabs of an operation show of what Velero wrote of it", () => {
  it(
    "is the text each tab loaded, in the viewer of the tab, under the name of its panel",
    async () => {
      const main = await opened("Backup", "nightly");
      const log = await loaded("Backup", "Log");

      expect(log).toBe("velero-backup-log-viewer");
      expect(screen.getByTestId(log).contains(screen.getByTestId(`${log}-search`))).toBe(true);
      expect(screen.getByTestId(`${log}-line-2-text`).textContent).toBe(LOG.split("\n")[1]);
      expect(screen.getByTestId(`${log}-level-error`).getAttribute("data-count")).toBe("1");
      const results = await loaded("Backup", "Results");

      expect(screen.getByTestId(results).contains(screen.getByTestId(`${results}-summary`))).toBe(true);
      expect(screen.getByTestId(`${results}-summary`).textContent).toBe(
        resultsSummary(parseResults(RESULTS) as NonNullable<ReturnType<typeof parseResults>>, "Backup"),
      );
      expect(screen.getByTestId(`${results}-errors-namespace-shop`)).toBeTruthy();
      const resources = await loaded("Backup", "Resources");
      const backedUp = parseResources(BACKED_UP, "Backup") as NonNullable<ReturnType<typeof parseResources>>;

      expect(screen.getByTestId(resources).contains(screen.getByTestId(`${resources}-count`))).toBe(true);
      expect(screen.getByTestId(`${resources}-count`).textContent).toBe(resourcesCount(backedUp, backedUp, ""));
      expect(screen.getAllByTestId(`${resources}-item`).map((item) => item.getAttribute("data-item"))).toEqual([
        "shop",
        "shop/cart",
        "shop/pay",
      ]);
      const volumes = await loaded("Backup", "Volumes");

      expect(screen.getByTestId(volumes).contains(screen.getByTestId(`${volumes}-count`))).toBe(true);
      expect(screen.getByTestId(`${volumes}-count`).textContent).toBe(volumesCount(1, "Backup"));
      expect(screen.getByTestId(volumes).querySelectorAll("[data-volume-row]")).toHaveLength(1);
      // One request for each tab, of the artifact of the tab, and no other.
      expect(main.calls).toEqual(
        (["log", "results", "resources", "volumes"] as ArtifactTab[]).map(
          (one) => `run Backup/nightly ${artifactOf(one, "Backup")}`,
        ),
      );
    },
    SLOW,
  );

  it(
    "is shown again as it was loaded when its tab is shown again, with nothing asked for it",
    async () => {
      const main = await opened("Backup", "nightly");
      const log = await loaded("Backup", "Log");
      const resources = await loaded("Backup", "Resources");

      fireEvent.click(tab("Log"));
      expect(screen.getByTestId(`${log}-line-1-text`).textContent).toBe(LOG.split("\n")[0]);
      fireEvent.click(tab("Resources"));
      expect(screen.getAllByTestId(`${resources}-item`)).toHaveLength(3);
      expect(main.calls).toHaveLength(2);
    },
    SLOW,
  );

  it(
    "says of which kind of operation it is, to the viewers that show a backup and a restore differently",
    async () => {
      await opened("Restore", "monday");
      const resources = await loaded("Restore", "Resources");

      // What a restore did with each item is a column, and a choice: a backup has neither.
      expect(screen.getByTestId(`${resources}-actions`)).toBeTruthy();
      expect(
        [...screen.getByTestId(resources).querySelectorAll("[data-action]")].map((action) => action.textContent),
      ).toEqual(["created", "failed"]);
      const volumes = await loaded("Restore", "Volumes");

      expect(screen.getByTestId(`${volumes}-table`).getAttribute("data-of")).toBe("Restore");
      expect(screen.getByTestId(`${volumes}-count`).textContent).toBe(volumesCount(1, "Restore"));
      expect(screen.getByTestId(volumes).querySelector('[data-column="method"]')?.textContent).toBe("NativeSnapshot");
      cleanup();
      act(() => closeViews());
      await opened("Backup", "nightly");
      expect(await loaded("Backup", "Resources")).toBe("velero-backup-resources-viewer");
      expect(screen.queryByTestId("velero-backup-resources-viewer-actions")).toBeNull();
    },
    SLOW,
  );

  it(
    "is given what the status counts in the Results tab, which says when the file counts otherwise",
    async () => {
      await opened("Backup", "nightly");
      const results = await loaded("Backup", "Results");

      // The status of the backup counts two errors, and its results hold one: the operations of its
      // plugins add to the status alone. Its warnings are counted the same by both.
      expect(differs(results)).toEqual([
        "The status of the backup reports 2 errors, and its results hold 1. The operations of the plugins of a backup add their errors to its status after its results were written, and not to the results: the status can count more.",
      ]);
      cleanup();
      act(() => closeViews());
      // The same of the restore, whose messages are the texts of the restore and have no parts.
      await opened("Restore", "monday");
      const restored = await loaded("Restore", "Results");

      expect(differs(restored)).toEqual([
        "The status of the restore reports 2 errors, and its results hold 1. The operations of the plugins of a restore add their errors to its status after its results were written, and not to the results: the status can count more.",
      ]);
      expect(screen.getByTestId(`${restored}-errors-namespace-shop`).querySelector("dl")).toBeNull();
      expect(screen.getByTestId(`${restored}-errors-namespace-shop`).textContent).toContain(
        "error restoring pods/shop/pay: synthetic refusal",
      );
    },
    SLOW,
  );

  it(
    "says nothing of a difference for a status that writes no counter: a zero the views count is not one it wrote",
    async () => {
      const main = await opened("Backup", "quiet");

      // The store holds results with a message for a backup whose status writes neither counter.
      main.written.BackupResults = RESULTS;
      const results = await loaded("Backup", "Results");

      expect(screen.getByTestId(`${results}-summary`).textContent).toBe(
        resultsSummary(parseResults(RESULTS) as NonNullable<ReturnType<typeof parseResults>>, "Backup"),
      );
      expect(screen.queryByTestId(`${results}-differs`)).toBeNull();
    },
    SLOW,
  );

  it(
    "is given the phase of a restore with its counters, which says why its results count more while it is finalized",
    async () => {
      const main = await opened("Restore", "monday");

      main.table[path("restores", A)] = list(
        object(
          "Restore",
          "monday",
          { backupName: "nightly" },
          { phase: "FinalizingPartiallyFailed", startTimestamp: "2026-10-01T11:00:00Z", errors: 1, warnings: 1 },
        ),
      );
      await act(async () => {
        await main.installation.refresh();
      });
      // Two warnings in the results, and a status that was written before the finalization counted the
      // second.
      main.written.RestoreResults = JSON.stringify({
        errors: { namespaces: { shop: ["error restoring pods/shop/pay: synthetic refusal"] } },
        warnings: { velero: ["a synthetic warning of the finalization", "another one"] },
      });
      const results = await loaded("Restore", "Results");

      expect(differs(results)).toEqual([
        "The status of the restore reports 1 warning, and its results hold 2. When Velero finalizes a restore it adds what it finds to the results before it writes the status: the results can count more until the restore ends.",
      ]);
    },
    SLOW,
  );
});

describe("Escape in a text field of a tab", () => {
  it(
    "clears the field and leaves the view open with everything it loaded, and closes the view from anywhere else in it",
    async () => {
      const main = await opened("Backup", "nightly");
      const log = await loaded("Backup", "Log");
      const resources = await loaded("Backup", "Resources");
      const asked = main.calls.length;
      const filter = screen.getByTestId(`${resources}-filter`) as HTMLInputElement;

      fireEvent.change(filter, { target: { value: "cart" } });
      fireEvent.keyDown(filter, { key: "Escape" });
      expect(filter.value).toBe("");
      // Pressed again in the field that is empty, it still leaves the view where it is.
      fireEvent.keyDown(filter, { key: "Escape" });
      await settled();
      expect(screen.getByTestId("velero-backup-workspace")).toBeTruthy();
      expect(screen.getAllByTestId(`${resources}-item`)).toHaveLength(3);
      fireEvent.click(tab("Log"));
      const search = screen.getByTestId(`${log}-search`) as HTMLInputElement;

      fireEvent.change(search, { target: { value: "error" } });
      fireEvent.keyDown(search, { key: "Escape" });
      fireEvent.keyDown(search, { key: "Escape" });
      await settled();
      expect(search.value).toBe("");
      expect(screen.getByTestId("velero-backup-workspace")).toBeTruthy();
      // Nothing was let go in the main process: the texts are the ones that were loaded.
      expect(main.calls).toHaveLength(asked);
      expect(screen.getByTestId(`${log}-line-2-text`).textContent).toBe(LOG.split("\n")[1]);
      // From a line of the log, as from anywhere else in the view, Escape closes the view as it did.
      fireEvent.keyDown(screen.getByTestId(`${log}-line-1`), { key: "Escape" });
      await waitFor(() => expect(screen.queryByTestId("velero-backup-workspace")).toBeNull());
      expect(main.calls.slice(asked).sort()).toEqual(["release request-1", "release request-2"]);
    },
    SLOW,
  );
});

describe("the first line of what a tab shows", () => {
  it(
    "is the one part of its viewer that is marked, and is given the focus when the text arrives",
    async () => {
      await opened("Backup", "nightly");
      for (const [title, part] of [
        ["Log", "line-1"],
        ["Results", "summary"],
        ["Resources", "count"],
        ["Volumes", "count"],
      ]) {
        const viewer = await loaded("Backup", title);
        const first = screen.getByTestId(`${viewer}-${part}`);

        expect([title, marked(viewer)]).toEqual([title, [first]]);
        // It can be given the focus, and is not in the order of the Tab key.
        expect([title, first.tabIndex]).toEqual([title, -1]);
        expect([title, focused()]).toEqual([title, `${viewer}-${part}`]);
      }
    },
    SLOW,
  );

  it(
    "is the first line of the text, for a text that is not of the shape of the release",
    async () => {
      const main = await opened("Backup", "nightly");

      for (const artifact of ["BackupResults", "BackupResourceList", "BackupVolumeInfos"] as const)
        main.written[artifact] = OTHER;
      for (const [title, note] of [
        ["Results", otherResults("Backup")],
        ["Resources", otherResources("Backup")],
        ["Volumes", otherVolumes("Backup")],
      ]) {
        const viewer = await loaded("Backup", title);

        // The text is shown as the lines it is, with the note of its tab over them: nothing of the form
        // the tab gives the shape of the release is drawn.
        expect([title, screen.getByTestId(`${viewer}-note`).textContent]).toEqual([title, note]);
        // The three tabs say it of their own artifact, in the same words.
        expect([title, note.includes("of this backup") && note.includes(OTHER_SHAPE)]).toEqual([title, true]);
        expect(screen.getByTestId(viewer).contains(screen.getByTestId(`${viewer}-note`))).toBe(true);
        expect([title, screen.getByTestId(`${viewer}-line-1-text`).textContent]).toEqual([title, "{"]);
        expect([title, screen.getByTestId(`${viewer}-line-2-text`).textContent]).toEqual([title, '"kind": "Status"}']);
        expect([title, screen.getByTestId(`${viewer}-count`).textContent]).toEqual([title, "2 lines"]);
        expect(screen.queryByTestId(`${viewer}-summary`)).toBeNull();
        expect(screen.queryByTestId(`${viewer}-table`)).toBeNull();
        expect([title, marked(viewer)]).toEqual([title, [screen.getByTestId(`${viewer}-line-1`)]]);
        expect([title, focused()]).toEqual([title, `${viewer}-line-1`]);
      }
    },
    SLOW,
  );

  it(
    "is given the focus when it is drawn, in a list that had no room when its text arrived",
    async () => {
      await opened("Backup", "nightly");
      // The list of the host measures its room before it draws a row, and draws none while it has no room.
      virtualList.room = 0;
      const viewer = await loaded("Backup", "Log");

      expect(marked(viewer)).toEqual([]);
      // The focus waits on the words of the tab: it is not given to a command in the meantime.
      expect(focused()).toBe("velero-backup-log-status");
      // What else changes in the tab meanwhile is not what is waited for.
      fireEvent.change(screen.getByTestId(`${viewer}-search`), { target: { value: "backing" } });
      await settled();
      expect(screen.getByTestId(`${viewer}-search-status`).textContent).toBe("Match 1 of 2, on line 1.");
      expect(focused()).toBe("velero-backup-log-status");
      room(ROOM);
      await settled();
      expect(marked(viewer)).toEqual([screen.getByTestId(`${viewer}-line-1`)]);
      expect(focused()).toBe(`${viewer}-line-1`);
    },
    SLOW,
  );

  it(
    "is not given the focus the operator moved to something else before it was drawn",
    async () => {
      await opened("Backup", "nightly");
      virtualList.room = 0;
      const viewer = await loaded("Backup", "Log");

      screen.getByTestId(`${viewer}-search`).focus();
      room(ROOM);
      await settled();
      expect(marked(viewer)).toHaveLength(1);
      expect(focused()).toBe(`${viewer}-search`);
    },
    SLOW,
  );

  it(
    "is not waited for any more when another tab is shown in its place",
    async () => {
      await opened("Backup", "nightly");
      virtualList.room = 0;
      const viewer = await loaded("Backup", "Log");

      fireEvent.click(tab("Results"));
      fireEvent.click(tab("Log"));
      room(ROOM);
      await settled();
      // The line is drawn, and the tab that is shown again took no focus: no command of it was given.
      expect(marked(viewer)).toHaveLength(1);
      expect(focused()).not.toBe(`${viewer}-line-1`);
    },
    SLOW,
  );
});
