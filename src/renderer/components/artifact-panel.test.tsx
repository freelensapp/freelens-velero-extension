// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { observer } from "mobx-react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { confirmDialogs } from "../../../test/host-components";
import {
  ASKING,
  againNote,
  allowCommand,
  allowNote,
  artifactOf,
  askAgainNote,
  beginAgain,
  CANCEL_COMMAND,
  CANCELLING,
  cameBy,
  cameThrough,
  loadCommand,
  loadedText,
  loadStep,
  missingFile,
  NOT_AGAIN,
  savableNoMore,
  savableUntil,
  saveCommand,
  savingText,
  TO_THE_WRITES,
  wouldCreate,
  writesOff,
} from "../../common/artifact-text";
import { downloadFailure } from "../../common/diagnostic-text";
import { emptyPreferences, heldPreferences, RESOURCES } from "../../common/discovery";
import { ARTIFACT_HOLD_MS } from "../../common/ipc";
import { BACKUP_PHASES, operationState, RESTORE_PHASES } from "../../common/phases";
import { Installation } from "../state/installation";
import { ArtifactPanel, artifactPanelId } from "./artifact-panel";
import { time } from "./status";
import { TargetBar } from "./target-bar";

import type { AllowanceFor } from "../../common/allowances";
import type { ArtifactTab } from "../../common/artifact-text";
import type { Answer, Family } from "../../common/discovery";
import type {
  ArtifactPage,
  ArtifactSaved,
  ArtifactValue,
  Failure,
  GateState,
  Answer as IpcAnswer,
  WriteStatus,
} from "../../common/ipc";
import type { OperationKind } from "../../common/phases";
import type { AllowanceClient, ArtifactClient, GateClient, WriteClient } from "../api/ipc";
import type { ArtifactViewerProps } from "./artifact-viewer";

// The viewers are what their own slices make of them. Here each is a double of the contract a tab has
// with its viewer: it records what it was given, and has the part a tab gives the focus to.
const viewers = vi.hoisted(() => ({ given: [] as { viewer: string; props: Record<string, unknown> }[] }));

vi.mock("./log-viewer", async () => ({ LogViewer: await viewerDouble("log") }));
vi.mock("./results-viewer", async () => ({ ResultsViewer: await viewerDouble("results") }));
vi.mock("./resources-viewer", async () => ({ ResourcesViewer: await viewerDouble("resources") }));
vi.mock("./volumes-viewer", async () => ({ VolumesViewer: await viewerDouble("volumes") }));

async function viewerDouble(viewer: string) {
  const { CONTENT } = await vi.importActual<typeof import("./artifact-viewer")>("./artifact-viewer");

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
const NOW = Date.parse("2026-10-05T09:30:00Z");
const ORIGIN = "https://storage.example:9000";

function path(family: Family, namespace: string): string {
  return `/apis/velero.io/v1/namespaces/${namespace}/${RESOURCES[family]}`;
}

function list(...items: unknown[]): Answer {
  return { status: 200, body: { items } };
}

function object(kind: string, name: string, spec: object, status?: object, metadata: object = {}) {
  return {
    apiVersion: "velero.io/v1",
    kind,
    metadata: { name, namespace: A, uid: `${kind.toLowerCase()}-${name}-uid`, ...metadata },
    spec,
    ...(status ? { status } : {}),
  };
}

const backup = (name: string, phase?: string, more: { location?: string; status?: object } = {}) =>
  object(
    "Backup",
    name,
    { storageLocation: more.location ?? "default" },
    phase === undefined ? more.status : { phase, ...more.status },
  );
const restore = (name: string, phase: string, source?: string, metadata?: object) =>
  object("Restore", name, source ? { backupName: source } : { scheduleName: "nightly" }, { phase }, metadata);

function answers(more: Record<string, Answer> = {}): Record<string, Answer> {
  return {
    [DISCOVERY]: { status: 200, body: { resources: Object.values(RESOURCES).map((name) => ({ name })) } },
    [LOCATIONS]: list({ metadata: { name: "default", namespace: A } }),
    [path("backups", A)]: list(
      // The release writes no counter of zero: this one reports its errors, and no warning.
      backup("nightly", "PartiallyFailed", { status: { errors: 2 } }),
      backup("refused", "FailedValidation"),
      backup("waiting", "New"),
      // A backup that waits behind another: the release names its storage location when it starts it.
      backup("queued", "Queued", { location: "" }),
      backup("working", "InProgress"),
      backup("finalizing", "Finalizing"),
      backup("failed", "Failed"),
      backup("deleting", "Deleting"),
      backup("silent"),
      backup("unlocated", "Completed", { location: "gone" }),
    ),
    [path("restores", A)]: list(
      restore("monday", "Completed", "nightly"),
      restore("orphan", "FailedValidation"),
      restore("leaving", "Completed", "nightly", { deletionTimestamp: "2026-10-05T09:00:00Z" }),
      // A restore that is deleted while it is at work: the release has no phase for it.
      restore("stopping", "InProgress", "nightly", { deletionTimestamp: "2026-10-05T09:00:00Z" }),
    ),
    [path("schedules", A)]: list(),
    [path("storageLocations", A)]: list(object("BackupStorageLocation", "default", {}, { phase: "Available" })),
    [path("snapshotLocations", A)]: list(),
    ...more,
  };
}

const VALUE: ArtifactValue = {
  request: { name: "nightly-request-1", uid: "request-uid" },
  size: 23,
  pages: 2,
  route: { mode: "tunnel", encrypted: false, origin: "http://seaweedfs.velero.svc:8333" },
};
const TEXT = "first line\nsecond line\n";
const OK: IpcAnswer<null> = { ok: true, value: null };
// The time of a test that waits for the tab to ask the main process where a request is, four times a
// second, or that goes through many loads: enough of it on a machine that is busy.
const SLOW = 30_000;

const failed = (code: Failure["code"], stage: string, retry: boolean, more: Partial<Failure> = {}): Failure => ({
  ok: false,
  code,
  stage,
  retry,
  text: `Synthetic words of ${code} at ${stage}.`,
  ...more,
});

// The main process, as a tab sees it: the gate, and the writes, of which every call is recorded. A
// download and a saving answer when the test says, and so does a page once the test holds the pages.
function mainProcess() {
  let state: GateState = {
    cluster: { id: "cluster-a", name: "local-demo", context: "kind-local-demo" },
    writes: { on: false },
  };
  const calls: string[] = [];
  const runs: ((answer: IpcAnswer<ArtifactValue>) => void)[] = [];
  const savings: ((answer: IpcAnswer<ArtifactSaved>) => void)[] = [];
  const pages: (() => void)[] = [];
  const held = {
    // What the main process says the request is at, when it is asked.
    status: { step: "queue" } as WriteStatus,
    polls: 0,
    lost: false,
    holdPages: false,
    confirm: undefined as Failure | undefined,
    allow: undefined as Failure | undefined,
    tokens: 0,
  };
  const gate: GateClient = {
    state: async () =>
      held.lost
        ? failed("request-failed", "way", true, { text: "The main process did not answer." })
        : { ok: true, value: state },
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
    confirm: async (_cluster, namespace, kind, target, artifact) => {
      calls.push(`confirm ${namespace} ${kind} ${target?.kind}/${target?.name}/${target?.uid} ${artifact}`);
      if (held.confirm) return held.confirm;
      held.tokens += 1;
      return { ok: true, value: { token: `token-${held.tokens}`, expires: NOW + 30_000 } };
    },
    runServerStatus: async () => failed("request-failed", "request", false),
    status: async () => {
      held.polls += 1;
      return { ok: true, value: held.status };
    },
    cancel: async (_cluster, request) => {
      calls.push(`cancel ${request}`);
      return OK;
    },
    runDownload: (_cluster, namespace, target, artifact, token, request) => {
      calls.push(`run ${namespace} ${target.kind}/${target.name}/${target.uid} ${artifact} ${token} ${request}`);
      return new Promise((resolve) => runs.push(resolve));
    },
    page: async (_cluster, request, page): Promise<IpcAnswer<ArtifactPage>> => {
      calls.push(`page ${request} ${page}`);
      if (held.holdPages) await new Promise<void>((resolve) => pages.push(resolve));
      return { ok: true, value: { page, pages: 2, text: TEXT.slice(page * 11, page ? undefined : 11) } };
    },
    release: async (_cluster, request) => {
      calls.push(`release ${request}`);
      return OK;
    },
    save: (_cluster, request) => {
      calls.push(`save ${request}`);
      return new Promise((resolve) => savings.push(resolve));
    },
  };
  const allowances: AllowanceClient = {
    allow: async (_cluster, allowed: AllowanceFor) => {
      calls.push(`allow ${allowed.what} ${allowed.origin} ${allowed.location ?? ""}`.trim());
      return held.allow ?? OK;
    },
    takeBack: async () => OK,
  };
  const settle = (act_: () => void) =>
    act(async () => {
      act_();
      await new Promise((done) => setTimeout(done, 0));
    });

  return {
    gate,
    writer,
    allowances,
    calls,
    held,
    // The download that waits answers, and the tab is given the time to take what follows.
    answer: async (answer: IpcAnswer<ArtifactValue> = { ok: true, value: VALUE }) => {
      const resolve = runs.shift();

      if (!resolve) throw new Error("No download waits");
      await settle(() => resolve(answer));
    },
    saved: async (answer: IpcAnswer<ArtifactSaved>) => {
      const resolve = savings.shift();

      if (!resolve) throw new Error("No saving waits");
      await settle(() => resolve(answer));
    },
    page: async () => {
      const resolve = pages.shift();

      if (!resolve) throw new Error("No page waits");
      await settle(resolve);
    },
  };
}

interface Shown {
  kind: OperationKind;
  name: string;
  tab: ArtifactTab;
}

// The keys that reach what holds a tab, which listens to them as the workspace of the view does.
const heard: string[] = [];

// A tab, as its workspace holds it: under the target bar, with the object the installation read, and with
// the installation told that the view of the object is open.
const Tab = observer(({ installation, kind, name, tab }: Shown & { installation: Installation }) => {
  React.useEffect(() => {
    void installation.open();
  }, [installation]);
  React.useEffect(() => installation.artifacts.open(kind, name), [installation, kind, name]);
  const found =
    kind === "Backup"
      ? installation.read("backups").items.find((item) => item.metadata.name === name)
      : installation.read("restores").items.find((item) => item.metadata.name === name);
  const status = found?.status;

  return (
    <>
      <TargetBar installation={installation} />
      {found ? (
        // biome-ignore lint/a11y/noStaticElementInteractions: what holds the tab, which listens to the keys as the workspace does
        <div onKeyDown={(event) => heard.push(event.key)}>
          <ArtifactPanel
            installation={installation}
            kind={kind}
            tab={tab}
            object={found}
            counters={{
              ...(typeof status?.errors === "number" ? { errors: status.errors } : {}),
              ...(typeof status?.warnings === "number" ? { warnings: status.warnings } : {}),
            }}
          />
        </div>
      ) : null}
    </>
  );
});

function mount(
  shown: Partial<Shown> = {},
  options: { table?: Record<string, Answer>; main?: ReturnType<typeof mainProcess>; way?: boolean } = {},
) {
  const main = options.main ?? mainProcess();
  const table = options.table ?? answers();
  const of: Shown = { kind: "Backup", name: "nightly", tab: "log", ...shown };
  let requests = 0;
  const installation = new Installation({
    cluster: { id: "cluster-a", name: "local-demo" },
    read: async (address) => table[address] ?? { status: 404 },
    now: () => NOW,
    storage: heldPreferences({ ...emptyPreferences(), selected: { "cluster-a": A } }),
    // Without a way to the main process the views have neither its gate nor its writes.
    ...(options.way === false ? {} : { gate: main.gate, writer: main.writer, allowances: main.allowances }),
    requestId: () => {
      requests += 1;
      return `request-${requests}`;
    },
  });
  const view = render(<Tab installation={installation} {...of} />);
  const id = artifactPanelId(of.kind, of.tab);

  return {
    installation,
    main,
    table,
    view,
    id,
    show: (next: Partial<Shown>) => view.rerender(<Tab installation={installation} {...of} {...next} />),
    panel: () => screen.getByTestId(id),
    part: (name: string) => screen.getByTestId(`${id}-${name}`),
    maybe: (name: string) => screen.queryByTestId(`${id}-${name}`),
    // The commands a tab offers, by the names they are found by.
    commands: () =>
      [...screen.getByTestId(id).querySelectorAll("button")].map((button) => button.getAttribute("data-testid")),
  };
}

type Mounted = ReturnType<typeof mount>;

// Whether the parts are in the page in the order they are given.
function before(...parts: Element[]): boolean {
  return parts.every(
    (part, at) => at === 0 || (parts[at - 1].compareDocumentPosition(part) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0,
  );
}

const focused = () => document.activeElement?.getAttribute("data-testid");

// A command is given as the pointer gives it in the application: what is pressed has the focus.
function press(element: HTMLElement): void {
  element.focus();
  fireEvent.click(element);
}

// The words of a part, without the names of its marks, which the host draws as icons.
function words(element: Element): string {
  const copy = element.cloneNode(true) as Element;

  for (const mark of copy.querySelectorAll(".Icon")) mark.remove();
  return (copy.textContent ?? "").replace(/\s+/g, " ").trim();
}

async function opened({ id }: Mounted) {
  await screen.findByTestId(id);
  await waitFor(() => expect(screen.getByTestId("velero-writes-state").textContent).not.toBe(""));
}

async function writesOn(mounted: Mounted) {
  await opened(mounted);
  await waitFor(() => expect(screen.getByTestId("velero-writes-on")).toBeTruthy());
  fireEvent.click(screen.getByTestId("velero-writes-on"));
  await act(async () => {
    await confirmDialogs.at(-1)?.ok?.();
  });
  await waitFor(() => expect(screen.getByTestId("velero-writes").getAttribute("data-writes")).toBe("on"));
}

// The two gestures, up to the request that runs.
async function ask(mounted: Mounted) {
  const runs = () => mounted.main.calls.filter((call) => call.startsWith("run"));
  const before = runs().length;

  press(mounted.part("create"));
  await waitFor(() => expect(mounted.maybe("confirm")).toBeTruthy());
  press(mounted.part("confirm-create"));
  await waitFor(() => expect(runs()).toHaveLength(before + 1));
}

async function load(mounted: Mounted) {
  await ask(mounted);
  await mounted.main.answer();
  await waitFor(() => expect(mounted.panel().getAttribute("data-step")).toBe("loaded"));
}

async function fail(mounted: Mounted, failure: Failure) {
  await ask(mounted);
  await mounted.main.answer(failure);
  await waitFor(() => expect(mounted.panel().getAttribute("data-step")).toBe("failed"));
}

// The step the main process says, once the tab asked it: it asks four times a second, and is given the
// time of a machine that is busy.
async function at(mounted: Mounted, status: WriteStatus) {
  mounted.main.held.status = status;
  await waitFor(() => expect(mounted.panel().getAttribute("data-at")).toBe(status.step), { timeout: 5000 });
}

afterEach(() => {
  cleanup();
  confirmDialogs.length = 0;
  viewers.given.length = 0;
  heard.length = 0;
});

describe("the first state of a diagnostic tab", () => {
  it("says what it would create and that writes are off, leads to the target bar, and asks nothing", async () => {
    const mounted = mount();

    await opened(mounted);
    expect(mounted.panel().getAttribute("data-step")).toBe("first");
    // The state of the gate is said first and apart, since it decides what can be done: then what the
    // tab would create, with its object named once.
    expect(mounted.part("writes-off").textContent).toBe(writesOff());
    expect(mounted.part("what").textContent).toBe(
      wouldCreate("log", { kind: "Backup", name: "nightly", namespace: A, cluster: "local-demo" }),
    );
    expect(mounted.part("what").textContent).toContain(
      "Loading the log of the backup nightly creates a DownloadRequest of the kind BackupLog for that backup, in velero-a of the cluster local-demo.",
    );
    expect(before(mounted.part("writes-off"), mounted.part("to-target"), mounted.part("what"))).toBe(true);
    // The way to the target bar is the only command.
    expect(mounted.commands()).toEqual([`${mounted.id}-to-target`]);
    expect(mounted.part("to-target").textContent).toBe(TO_THE_WRITES);
    press(mounted.part("to-target"));
    expect(focused()).toBe("velero-writes-on");
    expect(mounted.part("status").textContent).toBe("");
    expect(viewers.given).toEqual([]);
    // Opening the tab asked nothing of the main process but the state of the gate.
    expect(mounted.main.calls).toEqual([]);
    expect(mounted.main.held.polls).toBe(0);
  });

  it("says that it is not known whether writes are on, and leads to where the main process is asked again", async () => {
    const main = mainProcess();

    main.held.lost = true;
    const mounted = mount({ kind: "Restore", name: "monday", tab: "volumes" }, { main });

    await opened(mounted);
    await waitFor(() => expect(screen.getByTestId("velero-writes").getAttribute("data-writes")).toBe("unknown"));
    expect(mounted.id).toBe("velero-restore-volumes");
    expect(mounted.part("writes-off").textContent).toBe(writesOff(true));
    expect(mounted.part("what").textContent).toBe(
      wouldCreate("volumes", { kind: "Restore", name: "monday", namespace: A, cluster: "local-demo" }),
    );
    expect(mounted.commands()).toEqual([`${mounted.id}-to-target`]);
    press(mounted.part("to-target"));
    expect(focused()).toBe("velero-writes-ask");
    expect(mounted.main.calls).toEqual([]);
  });

  it("says that the views have no way to the main process, and offers no command", async () => {
    const mounted = mount({}, { way: false });

    await opened(mounted);
    await waitFor(() => expect(mounted.installation.gateFailure).toBeDefined());
    expect(mounted.part("writes-off").textContent).toBe(
      "The views have no way to the main process of the extension: writes cannot be turned on.",
    );
    expect(mounted.part("what").textContent).toBe(
      wouldCreate("log", { kind: "Backup", name: "nightly", namespace: A, cluster: "local-demo" }),
    );
    expect(mounted.commands()).toEqual([]);
  });

  it("says that writes are off, and leads to the target bar, when the main process refused to turn them on", async () => {
    const main = mainProcess();
    const refusal = failed("forbidden", "connection", false, {
      text: "The credential of this context is not one writes can be turned on with.",
    });

    main.gate.enable = async () => refusal;
    const mounted = mount({}, { main });

    await opened(mounted);
    await waitFor(() => expect(screen.getByTestId("velero-writes-on")).toBeTruthy());
    fireEvent.click(screen.getByTestId("velero-writes-on"));
    await act(async () => {
      await confirmDialogs.at(-1)?.ok?.();
    });
    await waitFor(() => expect(mounted.installation.gateFailure).toBe(refusal.text));
    // The main process answered, and what it holds is known: writes are off. Why they were not turned on
    // is said where they are turned on; the tab says what it says with writes off, first and apart, leads
    // there, and then says what it would create.
    expect(mounted.installation.gateUnknown).toBe(false);
    expect(mounted.part("writes-off").textContent).toBe(writesOff());
    expect(mounted.part("what").textContent).toBe(
      wouldCreate("log", { kind: "Backup", name: "nightly", namespace: A, cluster: "local-demo" }),
    );
    expect(before(mounted.part("writes-off"), mounted.part("to-target"), mounted.part("what"))).toBe(true);
    expect(mounted.commands()).toEqual([`${mounted.id}-to-target`]);
    expect(mounted.main.calls).toEqual([]);
  });

  it("offers one command in the name of the kind when writes are on, and asks nothing until it is given", async () => {
    for (const [kind, name, tab, command] of [
      ["Backup", "nightly", "log", "Create a DownloadRequest of the kind BackupLog"],
      ["Backup", "nightly", "results", "Create a DownloadRequest of the kind BackupResults"],
      ["Restore", "monday", "resources", "Create a DownloadRequest of the kind RestoreResourceList"],
      ["Restore", "monday", "volumes", "Create a DownloadRequest of the kind RestoreVolumeInfo"],
    ] as const) {
      const mounted = mount({ kind, name, tab });

      await writesOn(mounted);
      expect(mounted.part("what").textContent).toBe(
        wouldCreate(tab, { kind, name, namespace: A, cluster: "local-demo" }),
      );
      expect(mounted.maybe("writes-off")).toBeNull();
      expect(mounted.commands()).toEqual([`${mounted.id}-create`]);
      expect(words(mounted.part("create"))).toBe(command);
      expect(words(mounted.part("create"))).toBe(loadCommand(tab, kind));
      expect(mounted.main.calls).toEqual([]);
      cleanup();
    }
  });
});

describe("what a diagnostic tab says before any request", () => {
  it("says of a restore that names no backup that Velero signs no URL for it, and offers no command", async () => {
    const mounted = mount({ kind: "Restore", name: "orphan", tab: "log" });
    const unsigned = downloadFailure("not-found", "backup", { artifact: "RestoreLog", name: "orphan", namespace: A });

    // It is said whatever the gate is at: with writes off the tab does not say what it would create, and
    // does not lead to where writes are turned on for a request that would not be offered.
    await opened(mounted);
    expect(mounted.part("nothing").textContent).toBe(unsigned.text);
    expect(mounted.maybe("writes-off")).toBeNull();
    expect(mounted.commands()).toEqual([]);
    await writesOn(mounted);
    expect(mounted.part("nothing").textContent).toBe(unsigned.text);
    expect(mounted.part("nothing").textContent).toContain("Velero signs no URL for such a restore");
    expect(mounted.commands()).toEqual([]);
    // Nothing is said of what would be created: nothing would.
    expect(mounted.maybe("what")).toBeNull();
    expect(mounted.maybe("writes-off")).toBeNull();
    expect(mounted.main.calls).toEqual([]);
  });

  it("says of a backup whose storage location is not there that Velero signs no URL without it", async () => {
    const mounted = mount({ name: "unlocated", tab: "resources" });

    await writesOn(mounted);
    expect(mounted.part("nothing").textContent).toBe(
      downloadFailure("not-found", "location", { artifact: "BackupResourceList", name: "unlocated", namespace: A })
        .text,
    );
    expect(mounted.commands()).toEqual([]);
    expect(mounted.main.calls).toEqual([]);
  });
});

describe("what a diagnostic tab says of a backup that waits to start", () => {
  it("says what its phase says when it names no storage location yet, and not that its storage is at fault", async () => {
    const mounted = mount({ name: "queued", tab: "log" });

    await writesOn(mounted);
    expect(mounted.part("nothing").textContent).toBe(
      "The log of a backup is written into the storage when its work ends: it is not there yet. Velero names the storage location of a backup when it starts the backup, and signs no URL for a backup that names none: no request is offered until then.",
    );
    // No request is offered for it: Velero would sign no URL.
    expect(mounted.commands()).toEqual([]);
    expect(mounted.maybe("what")).toBeNull();
    expect(mounted.main.calls).toEqual([]);
    // The release started it, and named its location: the tab offers its command.
    mounted.table[path("backups", A)] = list(backup("queued", "InProgress"));
    await act(() => mounted.installation.refresh());
    expect(mounted.maybe("nothing")).toBeNull();
    expect(mounted.commands()).toEqual([`${mounted.id}-create`]);
  });
});

describe("the confirmation of the request of a tab", () => {
  it("shows the object as it will be submitted, on the first gesture, and creates nothing before the second", async () => {
    const mounted = mount();

    await writesOn(mounted);
    press(mounted.part("create"));
    const confirmation = await screen.findByTestId(`${mounted.id}-confirm`);
    const facts = Object.fromEntries(
      [...confirmation.querySelectorAll("[data-field]")].map((field) => [
        field.getAttribute("data-field"),
        field.querySelector("dd")?.textContent,
      ]),
    );

    expect(facts).toEqual({
      kind: "DownloadRequest (velero.io/v1)",
      name: "nightly-, followed by the identifier of the request",
      namespace: A,
      cluster: "local-demo (context kind-local-demo)",
      labels:
        "app.kubernetes.io/managed-by=freelens-velero-extension, freelensapp.io/diagnostic-request=the identifier of the request",
      spec: "target.kind BackupLog, target.name nightly",
      target: "The backup nightly",
    });
    expect(mounted.panel().getAttribute("data-step")).toBe("confirming");
    // The command that asked went: the focus is on the confirmation, and not on what creates.
    expect(focused()).toBe(`${mounted.id}-confirm`);
    expect(mounted.commands()).toEqual([`${mounted.id}-confirm-create`, `${mounted.id}-confirm-back`]);
    // The main process was asked for a confirmation of that artifact of that object, and for nothing else.
    expect(mounted.main.calls).toEqual([
      "confirm velero-a DownloadRequest Backup/nightly/backup-nightly-uid BackupLog",
    ]);
    press(mounted.part("confirm-create"));
    await waitFor(() => expect(mounted.main.calls).toHaveLength(2));
    expect(mounted.main.calls[1]).toBe("run velero-a Backup/nightly/backup-nightly-uid BackupLog token-1 request-1");
  });

  it("shows the request of its own tab: the artifact of the tab, of the operation the tab is of", async () => {
    for (const [kind, name, tab, spec, target] of [
      ["Backup", "nightly", "results", "target.kind BackupResults, target.name nightly", "The backup nightly"],
      ["Restore", "monday", "resources", "target.kind RestoreResourceList, target.name monday", "The restore monday"],
      ["Restore", "monday", "volumes", "target.kind RestoreVolumeInfo, target.name monday", "The restore monday"],
    ] as const) {
      const mounted = mount({ kind, name, tab });

      await writesOn(mounted);
      press(mounted.part("create"));
      const confirmation = await screen.findByTestId(`${mounted.id}-confirm`);
      const said = (field: string) => confirmation.querySelector(`[data-field="${field}"] dd`)?.textContent;

      expect([tab, said("name"), said("spec"), said("target")]).toEqual([
        tab,
        `${name}-, followed by the identifier of the request`,
        spec,
        target,
      ]);
      cleanup();
    }
  });

  it("is left with its second command and with Escape, which create nothing and give the focus back to the command", async () => {
    const mounted = mount();

    await writesOn(mounted);
    press(mounted.part("create"));
    press(await screen.findByTestId(`${mounted.id}-confirm-back`));
    expect(mounted.panel().getAttribute("data-step")).toBe("first");
    expect(mounted.maybe("confirm")).toBeNull();
    expect(focused()).toBe(`${mounted.id}-create`);
    press(mounted.part("create"));
    // Escape is of the confirmation: what holds the tab does not take it for its own way back.
    fireEvent.keyDown(await screen.findByTestId(`${mounted.id}-confirm-create`), { key: "Tab" });
    fireEvent.keyDown(mounted.part("confirm-create"), { key: "Escape" });
    expect(mounted.panel().getAttribute("data-step")).toBe("first");
    expect(focused()).toBe(`${mounted.id}-create`);
    expect(heard).toEqual(["Tab"]);
    expect(mounted.main.calls.filter((call) => !call.startsWith("confirm"))).toEqual([]);
  });

  it("is left when writes are turned off while it waits, and when its tab is left", async () => {
    const mounted = mount();

    await writesOn(mounted);
    press(mounted.part("create"));
    await screen.findByTestId(`${mounted.id}-confirm`);
    fireEvent.click(screen.getByTestId("velero-writes-off"));
    await waitFor(() => expect(mounted.maybe("writes-off")).toBeTruthy());
    expect(mounted.maybe("confirm")).toBeNull();
    expect(mounted.panel().getAttribute("data-step")).toBe("first");
    // Another tab is shown, then this one again: a confirmation that was shown waits for nothing.
    await writesOn(mounted);
    press(mounted.part("create"));
    await screen.findByTestId(`${mounted.id}-confirm`);
    mounted.show({ tab: "results" });
    expect(screen.getByTestId("velero-backup-results").getAttribute("data-step")).toBe("first");
    mounted.show({ tab: "log" });
    expect(mounted.panel().getAttribute("data-step")).toBe("first");
    expect(mounted.maybe("confirm")).toBeNull();
    expect(mounted.main.calls.filter((call) => !call.startsWith("confirm"))).toEqual([]);
  });
});

describe("the load of a diagnostic tab", () => {
  it(
    "says each step the main process is at, with the name of the request and what the step counts",
    async () => {
      const mounted = mount();
      const request = "nightly-request-1";

      await writesOn(mounted);
      await ask(mounted);
      expect(mounted.panel().getAttribute("data-step")).toBe("loading");
      // Until the main process is asked, the tab says the step every request begins at.
      expect(mounted.part("status").textContent).toBe(loadStep("queue"));
      // The command that confirmed went: the focus is on the words that say what the tab is doing.
      expect(focused()).toBe(`${mounted.id}-status`);
      // The words that are seen carry a counter that moves four times a second: they are not what is
      // said to who does not see, which is another part, there from the start.
      expect(mounted.part("status").getAttribute("role")).toBeNull();
      expect(mounted.part("status").getAttribute("aria-live")).toBeNull();
      expect(mounted.part("said").getAttribute("role")).toBe("status");
      expect(mounted.part("said").textContent).toBe(loadStep("queue"));
      // The mark of the host that moves is beside the words, and says nothing they do not: it is hidden
      // from who does not see, who is told the step by the part beside it.
      expect(mounted.part("status").querySelector(".Spinner")).toBeTruthy();
      expect(mounted.part("status").querySelector(".Spinner")?.getAttribute("aria-hidden")).toBe("true");
      // The way to cancel is the only command.
      expect(mounted.commands()).toEqual([`${mounted.id}-cancel`]);
      expect(words(mounted.part("cancel"))).toBe(CANCEL_COMMAND);
      for (const status of [
        { step: "location" },
        { step: "creation" },
        { step: "wait", count: 3 },
        { step: "route" },
        { step: "download", count: 2048 },
        { step: "delivery" },
      ]) {
        await at(mounted, status);
        expect(mounted.part("status").textContent).toBe(loadStep(status.step, status.count, request));
      }
      await at(mounted, { step: "wait", count: 3 });
      expect(mounted.part("status").textContent).toBe(
        "The DownloadRequest nightly-request-1 is created. Waiting for Velero to sign its URL: 3 seconds so far, of thirty at most.",
      );
      await at(mounted, { step: "download", count: 2048 });
      expect(mounted.part("status").textContent).toBe("Downloading and decompressing the file: 2.0 KiB so far.");
      expect(mounted.main.held.polls).toBeGreaterThan(0);
      expect(focused()).toBe(`${mounted.id}-status`);
    },
    SLOW,
  );

  it(
    "says a step to who does not see when the load comes to it, and not again each time its counter moves",
    async () => {
      const mounted = mount();
      const request = "nightly-request-1";
      const said = () => mounted.part("said").textContent;

      await opened(mounted);
      // The part is there before anything is asked, with nothing in it: what it says later is a change.
      expect([mounted.part("said").getAttribute("role"), said()]).toEqual(["status", ""]);
      await writesOn(mounted);
      await ask(mounted);
      // Every change of what the part says is counted, as a reader of the screen is told each one.
      let changes = 0;
      const told = new MutationObserver((records) => {
        changes += records.length;
      });

      told.observe(mounted.part("said"), { childList: true, characterData: true, subtree: true });
      await at(mounted, { step: "wait", count: 1 });
      expect(said()).toBe(`The DownloadRequest ${request} is created. Waiting for Velero to sign its URL.`);
      const waiting = changes;

      // The seconds of the wait go by, and the bytes of the download: the words that are seen follow
      // them, and what is said does not move.
      for (const count of [2, 3, 4]) {
        mounted.main.held.status = { step: "wait", count };
        await waitFor(() => expect(mounted.part("status").textContent).toBe(loadStep("wait", count, request)), {
          timeout: 5000,
        });
      }
      told.takeRecords();
      expect([said(), changes]).toEqual([
        `The DownloadRequest ${request} is created. Waiting for Velero to sign its URL.`,
        waiting,
      ]);
      await at(mounted, { step: "download", count: 1024 });
      expect(said()).toBe("Downloading and decompressing the file.");
      const downloading = changes;

      for (const count of [2048, 4096]) {
        mounted.main.held.status = { step: "download", count };
        await waitFor(() => expect(mounted.part("status").textContent).toBe(loadStep("download", count)), {
          timeout: 5000,
        });
      }
      told.takeRecords();
      expect([said(), changes]).toEqual(["Downloading and decompressing the file.", downloading]);
      // The pages are said once, whatever their number.
      mounted.main.held.holdPages = true;
      await mounted.main.answer();
      await waitFor(() => expect(mounted.panel().getAttribute("data-at")).toBe("pages"));
      expect(said()).toBe("Taking the text from the main process.");
      const taking = changes;

      await mounted.main.page();
      expect(mounted.part("status").textContent).toBe("Taking the text from the main process: page 2 of 2.");
      told.takeRecords();
      expect([said(), changes]).toEqual(["Taking the text from the main process.", taking]);
      await mounted.main.page();
      await waitFor(() => expect(mounted.panel().getAttribute("data-step")).toBe("loaded"));
      // Nothing is being done any more, and nothing is said of it.
      expect([said(), mounted.part("status").textContent]).toEqual(["", ""]);
      told.disconnect();
    },
    SLOW,
  );

  it("says the pages it takes of the text, one by one, once the main process has it", async () => {
    const mounted = mount();

    mounted.main.held.holdPages = true;
    await writesOn(mounted);
    await ask(mounted);
    await mounted.main.answer();
    expect(mounted.part("status").textContent).toBe(loadStep("pages", 1, "nightly-request-1", 2));
    expect(mounted.part("status").textContent).toBe("Taking the text from the main process: page 1 of 2.");
    await mounted.main.page();
    expect(mounted.part("status").textContent).toBe("Taking the text from the main process: page 2 of 2.");
    expect(mounted.panel().getAttribute("data-step")).toBe("loading");
    await mounted.main.page();
    expect(mounted.panel().getAttribute("data-step")).toBe("loaded");
  });

  it(
    "cancels the request that runs, says so, and offers nothing until the main process says how it ended",
    async () => {
      const mounted = mount();

      await writesOn(mounted);
      await ask(mounted);
      await at(mounted, { step: "wait", count: 1 });
      press(mounted.part("cancel"));
      await waitFor(() => expect(mounted.part("status").textContent).toBe(CANCELLING));
      // It is said to who does not see as well: nothing moves in these words.
      expect(mounted.part("said").textContent).toBe(CANCELLING);
      expect(mounted.main.calls.at(-1)).toBe("cancel request-1");
      expect(mounted.commands()).toEqual([]);
      // The command that cancelled went: the focus is on the words that say so.
      expect(focused()).toBe(`${mounted.id}-status`);
      // The main process goes on saying where the request is: the tab says that it is being cancelled.
      await at(mounted, { step: "route" });
      expect(mounted.part("status").textContent).toBe(CANCELLING);
      expect(mounted.commands()).toEqual([]);
      await mounted.main.answer(
        downloadFailure("cancelled", "wait", {
          artifact: "BackupLog",
          name: "nightly",
          namespace: A,
          request: "nightly-request-1",
        }),
      );
      await waitFor(() => expect(mounted.panel().getAttribute("data-step")).toBe("failed"));
      expect(mounted.part("failure-text").textContent).toBe(
        "The download was cancelled. The DownloadRequest nightly-request-1 stays in velero-a until Velero removes it.",
      );
      expect(mounted.part("status").textContent).toBe("");
    },
    SLOW,
  );
});

describe("a load that is cancelled in a tab that was shown again while it ran", () => {
  it("gives the focus to the words that say so, and then to the command, as in a tab that was not left", async () => {
    const mounted = mount();

    await writesOn(mounted);
    await ask(mounted);
    // Another tab is shown, then this one again: the load went on, and nothing of this tab was used since.
    mounted.show({ tab: "results" });
    mounted.show({ tab: "log" });
    expect(mounted.panel().getAttribute("data-step")).toBe("loading");
    press(mounted.part("cancel"));
    await waitFor(() => expect(mounted.part("status").textContent).toBe(CANCELLING));
    // The command that cancelled went with the gesture: the focus is not left on nothing.
    expect(mounted.maybe("cancel")).toBeNull();
    expect(focused()).toBe(`${mounted.id}-status`);
    await mounted.main.answer(failed("cancelled", "wait", true));
    await waitFor(() => expect(mounted.panel().getAttribute("data-step")).toBe("failed"));
    expect(focused()).toBe(`${mounted.id}-create`);
  });
});

describe("a load that is cancelled while its pages are taken", () => {
  it(
    "takes no more of them, shows no text, and says that the request stays in the cluster",
    async () => {
      const mounted = mount();

      await writesOn(mounted);
      mounted.main.held.holdPages = true;
      await ask(mounted);
      await mounted.main.answer();
      await waitFor(() => expect(mounted.panel().getAttribute("data-at")).toBe("pages"));
      expect(mounted.part("status").textContent).toBe(loadStep("pages", 1, "nightly-request-1", 2));
      // The command that cancels is offered at this step as at the others, and does what it says.
      press(mounted.part("cancel"));
      await waitFor(() => expect(mounted.part("status").textContent).toBe(CANCELLING));
      await mounted.main.page();
      await waitFor(() => expect(mounted.panel().getAttribute("data-step")).toBe("failed"));
      expect(mounted.part("failure").getAttribute("data-code")).toBe("cancelled");
      expect(mounted.part("failure-text").textContent).toBe(
        "The download was cancelled. The DownloadRequest nightly-request-1 stays in velero-a until Velero removes it.",
      );
      expect(screen.queryByTestId("velero-backup-log-viewer")).toBeNull();
      expect(mounted.main.calls.filter((call) => call.startsWith("page"))).toEqual(["page request-1 0"]);
      expect(mounted.main.calls.at(-1)).toBe("release request-1");
      // Asking again is safe, and is another request.
      expect(mounted.part("what").textContent).toBe(askAgainNote(A));
      expect(mounted.commands()).toEqual([`${mounted.id}-create`]);
    },
    SLOW,
  );
});

describe("the text a diagnostic tab loaded", () => {
  it("is given to the viewer of the tab, with when it was loaded, its size, its request and the way it came by", async () => {
    const mounted = mount();

    await writesOn(mounted);
    await load(mounted);
    expect(mounted.part("loaded").textContent).toBe(loadedText("log", VALUE, time(NOW)));
    expect(mounted.part("loaded").textContent).toContain("(23 B of text).");
    expect(mounted.part("through").textContent).toBe(cameThrough(VALUE.request.name));
    expect(mounted.part("through").textContent).toBe("The file came through the DownloadRequest nightly-request-1.");
    expect(mounted.part("route").textContent).toBe(cameBy(VALUE.route));
    expect(mounted.part("route").getAttribute("data-route")).toBe("tunnel");
    expect(mounted.part("route").textContent).toContain(
      "It came from http://seaweedfs.velero.svc:8333 through a tunnel to the Pod of the store",
    );
    expect(mounted.part("route").textContent).toContain("The connection to the store was not encrypted");
    // The viewer of the log, with the pages as one text, the kind of the operation, and no counter.
    expect(viewers.given.at(-1)).toEqual({
      viewer: "log",
      props: { id: "velero-backup-log-viewer", text: TEXT, of: "Backup" },
    });
    expect(screen.getByTestId("velero-backup-log-viewer")).toBeTruthy();
    // Nothing is being done: the part says nothing, and nothing moves in it.
    expect(mounted.part("status").textContent).toBe("");
    expect(mounted.part("status").querySelector(".Spinner")).toBeNull();
    expect(mounted.main.calls.slice(2)).toEqual(["page request-1 0", "page request-1 1"]);
  });

  it("writes as attributes the request a load runs, from its first step, then the request the text came through and the bytes of the text", async () => {
    const mounted = mount();
    const running = () => mounted.panel().getAttribute("data-request");

    await writesOn(mounted);
    // Nothing runs: the tab names no request.
    expect(running()).toBeNull();
    await ask(mounted);
    // The request is named as it is in the cluster once it is created, before the main process said a step.
    expect([mounted.panel().getAttribute("data-at"), running()]).toEqual(["queue", "nightly-request-1"]);
    await at(mounted, { step: "wait", count: 1 });
    expect(running()).toBe("nightly-request-1");
    await mounted.main.answer();
    await waitFor(() => expect(mounted.panel().getAttribute("data-step")).toBe("loaded"));
    // The load ended: no request runs, and what is said of the text carries its request and its bytes.
    expect(running()).toBeNull();
    expect(["data-request", "data-size"].map((name) => mounted.part("loaded").getAttribute(name))).toEqual([
      "nightly-request-1",
      String(VALUE.size),
    ]);
    expect(mounted.part("loaded").textContent).toContain(`(${VALUE.size} B of text).`);
  });

  it("comes first: one line over it, with the commands that load it again and save it, and under it what is said of its request, of its way, of loading again and of its saving", async () => {
    const mounted = mount();

    await writesOn(mounted);
    await load(mounted);
    const viewer = screen.getByTestId("velero-backup-log-viewer");
    const head = mounted.part("loaded").parentElement as HTMLElement;

    // One line: the words of the load and, beside them, the two commands and what became of a saving.
    expect([...head.querySelectorAll("[data-testid]")].map((part) => part.getAttribute("data-testid"))).toEqual(
      ["loaded", "create", "save", "saving"].map((part) => `${mounted.id}-${part}`),
    );
    // Nothing is between that line and the text: what is said of the commands is under the text, and
    // each command is described by its words there.
    expect(head.nextElementSibling).toBe(viewer);
    expect(
      before(
        mounted.part("loaded"),
        mounted.part("create"),
        mounted.part("save"),
        viewer,
        mounted.part("through"),
        mounted.part("route"),
        mounted.part("what"),
        mounted.part("save-until"),
      ),
    ).toBe(true);
    expect(mounted.part("notes").contains(mounted.part("what"))).toBe(true);
    expect(mounted.part("create").getAttribute("aria-describedby")).toBe(mounted.part("what").id);
    expect(mounted.part("save").getAttribute("aria-describedby")).toBe(mounted.part("save-until").id);
    // Under a confirmation of a load again the line stays over the text, without its commands, and the
    // confirmation is between the two: it is what the operator is asked. What loading again takes away
    // stays said under the text, where it was.
    press(mounted.part("create"));
    const confirmation = await screen.findByTestId(`${mounted.id}-confirm`);

    expect(mounted.commands()).toEqual([`${mounted.id}-confirm-create`, `${mounted.id}-confirm-back`]);
    expect(before(mounted.part("loaded"), confirmation, viewer, mounted.part("route"), mounted.part("what"))).toBe(
      true,
    );
    // The line holds its words alone then: no command, and no part for what became of a saving.
    expect(
      [...(mounted.part("loaded").parentElement as HTMLElement).querySelectorAll("[data-testid]")].map((part) =>
        part.getAttribute("data-testid"),
      ),
    ).toEqual([`${mounted.id}-loaded`]);
    expect(mounted.part("what").textContent).toBe(againNote("log"));
    // Until when the text is saved is said under the text, where the command that saves it is described, and goes with it.
    expect(mounted.maybe("save-until")).toBeNull();
  });

  it("gives the focus to the first line of the text when it arrives", async () => {
    const mounted = mount();

    await writesOn(mounted);
    await load(mounted);
    const content = screen.getByTestId("velero-backup-log-viewer").querySelector("[data-artifact-content]");

    expect(content).toBeTruthy();
    expect(document.activeElement).toBe(content);
  });

  it(
    "does not take the focus from an operator who moved elsewhere while the text was loaded",
    async () => {
      const mounted = mount();

      await writesOn(mounted);
      await ask(mounted);
      await at(mounted, { step: "wait", count: 1 });
      screen.getByTestId("velero-refresh").focus();
      await mounted.main.answer();
      await waitFor(() => expect(mounted.panel().getAttribute("data-step")).toBe("loaded"));
      expect(focused()).toBe("velero-refresh");
    },
    SLOW,
  );

  it("takes the focus only after a gesture of the tab: a tab that is shown, with or without a text, leaves it where it is", async () => {
    const mounted = mount();

    await writesOn(mounted);
    // The tab was drawn with its command, and nothing of it was used: the focus is where it was.
    expect(mounted.maybe("create")).toBeTruthy();
    expect(document.activeElement).toBe(document.body);
    await load(mounted);
    (document.activeElement as HTMLElement).blur();
    // Another tab is shown, then this one again, with the text it loaded.
    mounted.show({ tab: "results" });
    mounted.show({ tab: "log" });
    expect(mounted.panel().getAttribute("data-step")).toBe("loaded");
    expect(document.activeElement).toBe(document.body);
  });

  it("is given to its viewer once: a tab that is drawn again with what it had draws no viewer again", async () => {
    // The viewer of each tab, whatever its artifact.
    for (const tab of ["log", "resources", "volumes"] as const) {
      const other = mount({ tab });

      await writesOn(other);
      await load(other);
      const once = viewers.given.length;

      other.show({});
      await act(() => other.installation.refresh());
      other.show({});
      expect(other.panel().getAttribute("data-step")).toBe("loaded");
      expect([tab, viewers.given.length]).toEqual([tab, once]);
      cleanup();
    }
    const mounted = mount({ tab: "results" });

    await writesOn(mounted);
    await load(mounted);
    const drawn = viewers.given.length;

    // The clock of the views, and a read of the installation, draw the tab again with what it had.
    mounted.show({});
    await act(() => mounted.installation.refresh());
    mounted.show({});
    expect(mounted.panel().getAttribute("data-step")).toBe("loaded");
    expect(viewers.given).toHaveLength(drawn);
    // A counter the status counts otherwise is given to the viewer.
    mounted.table[path("backups", A)] = list(backup("nightly", "PartiallyFailed", { status: { errors: 5 } }));
    await act(() => mounted.installation.refresh());
    expect(viewers.given).toHaveLength(drawn + 1);
    expect(viewers.given.at(-1)?.props.counters).toEqual({ errors: 5 });
  });

  it("gives each tab its own viewer, and the results the counters of the status with its phase, and only those", async () => {
    for (const [kind, name, tab, counted] of [
      ["Backup", "nightly", "results", { counters: { errors: 2 }, phase: "PartiallyFailed" }],
      ["Restore", "monday", "results", { counters: {}, phase: "Completed" }],
      ["Backup", "nightly", "resources", undefined],
      ["Restore", "monday", "volumes", undefined],
    ] as const) {
      const mounted = mount({ kind, name, tab });

      await writesOn(mounted);
      await load(mounted);
      expect(viewers.given.at(-1)).toEqual({
        viewer: tab,
        props: { id: `${mounted.id}-viewer`, text: TEXT, of: kind, ...counted },
      });
      // What is said of the text, of loading it again and of saving it is said of the artifact of the tab.
      expect([tab, mounted.part("loaded").textContent]).toEqual([tab, loadedText(tab, VALUE, time(NOW))]);
      expect([tab, mounted.part("what").textContent]).toEqual([tab, againNote(tab)]);
      expect([tab, words(mounted.part("save"))]).toEqual([tab, saveCommand(tab)]);
      cleanup();
    }
  });

  it("is loaded again as another request, through its confirmation, and stays shown until that request is created", async () => {
    const mounted = mount();

    await writesOn(mounted);
    await load(mounted);
    expect(mounted.part("what").textContent).toBe(againNote("log"));
    expect(mounted.part("what").textContent).toContain("goes when that request is created");
    expect(words(mounted.part("create"))).toBe("Create another DownloadRequest of the kind BackupLog");
    // What the command does is said to who reaches it with the keyboard as well: the note describes it.
    expect(mounted.part("create").getAttribute("aria-describedby")).toBe(mounted.part("what").id);
    expect(mounted.commands()).toEqual([`${mounted.id}-create`, `${mounted.id}-save`]);
    const before = mounted.main.calls.length;
    const drawn = viewers.given.length;

    press(mounted.part("create"));
    await screen.findByTestId(`${mounted.id}-confirm`);
    // The text is still shown under the confirmation, as it was loaded: nothing is created, and nothing
    // is let go, before the second gesture.
    expect(screen.getByTestId("velero-backup-log-viewer")).toBeTruthy();
    expect(mounted.part("loaded").textContent).toBe(loadedText("log", VALUE, time(NOW)));
    // What the second gesture takes away stays said while it is asked for, among what is said under the
    // text: the command it described went, and the words did not go with it.
    expect(mounted.part("what").textContent).toBe(againNote("log"));
    expect(mounted.part("notes").contains(mounted.part("what"))).toBe(true);
    expect(mounted.maybe("create")).toBeNull();
    expect(viewers.given).toHaveLength(drawn);
    expect(mounted.main.calls.slice(before)).toEqual([
      "confirm velero-a DownloadRequest Backup/nightly/backup-nightly-uid BackupLog",
    ]);
    // The confirmation is left: the tab is where it was, with its text, and the focus is on its command.
    press(mounted.part("confirm-back"));
    expect(mounted.panel().getAttribute("data-step")).toBe("loaded");
    expect(screen.getByTestId("velero-backup-log-viewer")).toBeTruthy();
    expect(viewers.given).toHaveLength(drawn);
    expect(focused()).toBe(`${mounted.id}-create`);
    expect(mounted.commands()).toEqual([`${mounted.id}-create`, `${mounted.id}-save`]);
    expect(mounted.main.calls.slice(before)).toHaveLength(1);
    // Asked again and left with Escape, the same.
    press(mounted.part("create"));
    fireEvent.keyDown(await screen.findByTestId(`${mounted.id}-confirm-create`), { key: "Escape" });
    expect(mounted.panel().getAttribute("data-step")).toBe("loaded");
    expect(screen.getByTestId("velero-backup-log-viewer")).toBeTruthy();
    expect(focused()).toBe(`${mounted.id}-create`);
    // Confirmed, the text goes in both processes and the new request is created.
    press(mounted.part("create"));
    press(await screen.findByTestId(`${mounted.id}-confirm-create`));
    await waitFor(() => expect(mounted.main.calls.at(-1)).toContain("run "));
    expect(mounted.main.calls.slice(-2)).toEqual([
      "release request-1",
      "run velero-a Backup/nightly/backup-nightly-uid BackupLog token-4 request-2",
    ]);
    expect(screen.queryByTestId("velero-backup-log-viewer")).toBeNull();
    expect(mounted.maybe("loaded")).toBeNull();
  });

  it("stays shown under a confirmation that is left because writes went off, or because its tab was left", async () => {
    const mounted = mount();

    await writesOn(mounted);
    await load(mounted);
    press(mounted.part("create"));
    await screen.findByTestId(`${mounted.id}-confirm`);
    fireEvent.click(screen.getByTestId("velero-writes-off"));
    await waitFor(() => expect(mounted.maybe("writes-off")).toBeTruthy());
    expect(mounted.maybe("confirm")).toBeNull();
    expect(mounted.panel().getAttribute("data-step")).toBe("loaded");
    expect(screen.getByTestId("velero-backup-log-viewer")).toBeTruthy();
    expect(mounted.main.calls.some((call) => call.startsWith("release"))).toBe(false);
    await writesOn(mounted);
    press(mounted.part("create"));
    await screen.findByTestId(`${mounted.id}-confirm`);
    mounted.show({ tab: "results" });
    mounted.show({ tab: "log" });
    expect(mounted.panel().getAttribute("data-step")).toBe("loaded");
    expect(screen.getByTestId("velero-backup-log-viewer")).toBeTruthy();
    expect(mounted.main.calls.some((call) => call.startsWith("release"))).toBe(false);
  });

  it("stays shown with writes off, when it can be saved and not loaded again", async () => {
    const mounted = mount();

    await writesOn(mounted);
    await load(mounted);
    fireEvent.click(screen.getByTestId("velero-writes-off"));
    await waitFor(() => expect(mounted.maybe("writes-off")).toBeTruthy());
    // The text and the command that saves it come first: the state of the gate, the way to the target bar
    // and what loading again would do are under the text.
    expect(mounted.part("writes-off").textContent).toBe(writesOff());
    expect(mounted.part("what").textContent).toBe(againNote("log"));
    expect(mounted.commands()).toEqual([`${mounted.id}-save`, `${mounted.id}-to-target`]);
    expect(
      before(
        mounted.part("save"),
        screen.getByTestId("velero-backup-log-viewer"),
        mounted.part("writes-off"),
        mounted.part("to-target"),
        mounted.part("what"),
      ),
    ).toBe(true);
    expect(screen.getByTestId("velero-backup-log-viewer")).toBeTruthy();
    expect(mounted.panel().getAttribute("data-step")).toBe("loaded");
  });

  it("stays shown when its backup has no storage location any more, with what is said of that in the place of the command", async () => {
    const mounted = mount();

    await writesOn(mounted);
    await load(mounted);
    mounted.table[path("storageLocations", A)] = list();
    await act(() => mounted.installation.refresh());
    expect(mounted.part("nothing").textContent).toBe(
      downloadFailure("not-found", "location", { artifact: "BackupLog", name: "nightly", namespace: A }).text,
    );
    // Loading again would create nothing: it is not offered. The text is there, and can be saved.
    expect(mounted.commands()).toEqual([`${mounted.id}-save`]);
    expect(mounted.maybe("what")).toBeNull();
    expect(screen.getByTestId("velero-backup-log-viewer")).toBeTruthy();
  });

  it("is of a load the installation dropped no more: the tab takes the new one, at its first state", async () => {
    const mounted = mount();

    await writesOn(mounted);
    await load(mounted);
    act(() => mounted.installation.artifacts.drop());
    expect(mounted.panel().getAttribute("data-step")).toBe("first");
    expect(screen.queryByTestId("velero-backup-log-viewer")).toBeNull();
    expect(mounted.main.calls.at(-1)).toBe("release request-1");
    // The load the tab shows now is the one the installation holds: it goes with the next drop.
    press(mounted.part("create"));
    await screen.findByTestId(`${mounted.id}-confirm`);
    act(() => mounted.installation.artifacts.drop());
    expect(mounted.panel().getAttribute("data-step")).toBe("first");
  });
});

describe("the saving of the text of a tab", () => {
  it("asks the main process, says that the dialog of the host is open, and what became of the saving", async () => {
    const mounted = mount();

    await writesOn(mounted);
    await load(mounted);
    expect(words(mounted.part("save"))).toBe(saveCommand("log"));
    expect(mounted.part("saving").textContent).toBe("");
    expect(mounted.part("saving").getAttribute("role")).toBe("status");
    const before = mounted.main.calls.length;

    press(mounted.part("save"));
    await waitFor(() => expect(mounted.part("saving").getAttribute("data-saving")).toBe("asked"));
    // The main process is asked to save the text it holds for the tab, and nothing else is asked of it.
    expect(mounted.main.calls.slice(before)).toEqual(["save request-1"]);
    expect(mounted.part("saving").textContent).toBe(savingText("log", { state: "asked" }));
    // One saving at a time: the command is not offered while the dialog is open, and the focus is on
    // what the saving is at.
    expect(mounted.maybe("save")).toBeNull();
    expect(focused()).toBe(`${mounted.id}-saving`);
    await mounted.main.saved({ ok: true, value: { saved: true } });
    expect(mounted.part("saving").textContent).toBe("The log was saved into the file that was chosen.");
    expect(mounted.part("saving").getAttribute("data-saving")).toBe("saved");
    expect(mounted.maybe("save")).toBeTruthy();
    // The text is where it was.
    expect(screen.getByTestId("velero-backup-log-viewer")).toBeTruthy();
    expect(mounted.main.calls.slice(before)).toEqual(["save request-1"]);
  });

  it("says that nothing was written when the dialog is closed, and why when the file was not written", async () => {
    const mounted = mount({ tab: "results" });
    const unwritten = failed("request-failed", "save", true, {
      text: "The file could not be written. The text is still held: choose another file, or load it again.",
    });

    await writesOn(mounted);
    await load(mounted);
    press(mounted.part("save"));
    await waitFor(() => expect(mounted.part("saving").getAttribute("data-saving")).toBe("asked"));
    await mounted.main.saved({ ok: true, value: { saved: false } });
    expect(mounted.part("saving").textContent).toBe(
      "No file was chosen: the results were not saved, and nothing was written.",
    );
    press(mounted.part("save"));
    await waitFor(() => expect(mounted.part("saving").getAttribute("data-saving")).toBe("asked"));
    await mounted.main.saved(unwritten);
    expect(mounted.part("saving").textContent).toBe(unwritten.text);
    expect(mounted.part("saving").getAttribute("data-saving")).toBe("failed");
    // The text is still held: it can be saved again.
    expect(mounted.maybe("save")).toBeTruthy();
  });

  it("offers no saving of a text the main process holds no more, and keeps the text shown", async () => {
    const mounted = mount();
    const gone = failed("not-found", "save", false, {
      text: "The main process holds this text no more: load it again to save it.",
    });

    await writesOn(mounted);
    await load(mounted);
    press(mounted.part("save"));
    await waitFor(() => expect(mounted.part("saving").getAttribute("data-saving")).toBe("asked"));
    await mounted.main.saved(gone);
    expect(mounted.part("saving").textContent).toBe(gone.text);
    expect(mounted.maybe("save")).toBeNull();
    expect(screen.getByTestId("velero-backup-log-viewer")).toBeTruthy();
    expect(mounted.commands()).toEqual([`${mounted.id}-create`]);
  });
});

describe("the commands of a diagnostic tab", () => {
  it("are named by their words alone: the mark the host draws beside them is no part of the name", async () => {
    // The host draws an icon as the text of its name: one that is not hidden from who does not see is
    // read at the head of the command, glued to its words.
    const named = (name: string) => screen.getByRole("button", { name });
    const mounted = mount();

    await writesOn(mounted);
    expect(named(loadCommand("log", "Backup"))).toBe(mounted.part("create"));
    press(mounted.part("create"));
    await screen.findByTestId(`${mounted.id}-confirm`);
    expect(named("Create the DownloadRequest")).toBe(mounted.part("confirm-create"));
    expect(named("Do not create it")).toBe(mounted.part("confirm-back"));
    press(mounted.part("confirm-create"));
    await waitFor(() => expect(mounted.maybe("cancel")).toBeTruthy());
    expect(named(CANCEL_COMMAND)).toBe(mounted.part("cancel"));
    await mounted.main.answer();
    await waitFor(() => expect(mounted.panel().getAttribute("data-step")).toBe("loaded"));
    expect(named(saveCommand("log"))).toBe(mounted.part("save"));
    expect(named(loadCommand("log", "Backup", true))).toBe(mounted.part("create"));
    // And so are the command that allows, and the one that takes the tab back.
    const needs: AllowanceFor = { what: "private", origin: ORIGIN };

    await ask(mounted);
    await mounted.main.answer(failed("destination-denied", "route", false, { needs }));
    await waitFor(() => expect(mounted.maybe("allow")).toBeTruthy());
    expect(named(allowCommand(needs))).toBe(mounted.part("allow"));
    mounted.main.held.allow = failed("request-failed", "allowances", false);
    cleanup();
    confirmDialogs.length = 0;
    const refused = mount();

    await writesOn(refused);
    await fail(refused, failed("forbidden", "creation", false));
    expect(named(beginAgain(false))).toBe(refused.part("begin"));
    // Every mark of the tab is hidden from who does not see.
    for (const mark of refused.panel().querySelectorAll(".Icon")) expect(mark.getAttribute("aria-hidden")).toBe("true");
  });
});

describe("the time the main process holds the text of a tab for", () => {
  it("is said in the words the command that saves is described by, and ends the offer when it has passed", async () => {
    const timers = vi.spyOn(globalThis, "setTimeout");
    const mounted = mount({ tab: "results" });

    await writesOn(mounted);
    await load(mounted);
    const until = time(NOW + ARTIFACT_HOLD_MS);

    expect(mounted.part("save-until").textContent).toBe(savableUntil("results", until));
    expect(mounted.part("save-until").textContent).toContain(`until ${until} at most`);
    expect(mounted.part("save").getAttribute("aria-describedby")).toBe(mounted.part("save-until").id);
    // The time passes while the operator reads, with the keyboard on the command.
    const hold = timers.mock.calls.filter(([, delay]) => delay === ARTIFACT_HOLD_MS);

    expect(hold).toHaveLength(1);
    mounted.part("save").focus();
    act(() => (hold[0][0] as () => void)());
    // The command is not offered for a text it could not save, and the words say what there is to do.
    expect(mounted.maybe("save")).toBeNull();
    expect(mounted.part("save-until").textContent).toBe(savableNoMore("results", until));
    expect(mounted.part("save-until").textContent).toContain("loaded again");
    // The keyboard is not left on a command that went: it is on the words that took its place.
    expect(focused()).toBe(`${mounted.id}-save-until`);
    // The text stays shown, nothing was asked of the main process, and the tab can load again.
    expect(screen.getByTestId("velero-backup-results-viewer")).toBeTruthy();
    expect(mounted.main.calls.some((call) => call.startsWith("save") || call.startsWith("release"))).toBe(false);
    expect(mounted.commands()).toEqual([`${mounted.id}-create`]);
    timers.mockRestore();
  });

  it("takes no focus when it passes with the keyboard elsewhere than on the command that saves", async () => {
    const timers = vi.spyOn(globalThis, "setTimeout");
    const mounted = mount({ tab: "results" });

    await writesOn(mounted);
    await load(mounted);
    const hold = timers.mock.calls.filter(([, delay]) => delay === ARTIFACT_HOLD_MS);

    // The operator reads, with the focus on nothing: the words that take the place of the command say what
    // there is to do, and the focus is not moved to them from where the operator left it.
    (document.activeElement as HTMLElement).blur();
    expect(document.activeElement).toBe(document.body);
    act(() => (hold[0][0] as () => void)());
    expect(mounted.maybe("save")).toBeNull();
    expect(mounted.part("save-until").textContent).toBe(savableNoMore("results", time(NOW + ARTIFACT_HOLD_MS)));
    expect(document.activeElement).toBe(document.body);
    timers.mockRestore();
  });

  it("is not said of a text the main process let go before it, for room: its own words say that", async () => {
    const mounted = mount();
    const gone = failed("not-found", "delivery", false, {
      text: "The text of this artifact is not held any more: load it again to save it.",
    });

    await writesOn(mounted);
    await load(mounted);
    press(mounted.part("save"));
    await waitFor(() => expect(mounted.part("saving").getAttribute("data-saving")).toBe("asked"));
    // While the dialog is open the time is still said.
    expect(mounted.part("save-until").textContent).toBe(savableUntil("log", time(NOW + ARTIFACT_HOLD_MS)));
    await mounted.main.saved(gone);
    expect(mounted.part("saving").textContent).toBe(gone.text);
    expect(mounted.maybe("save-until")).toBeNull();
  });
});

describe("a load of a diagnostic tab that ended without its text", () => {
  it("says the words of the main process as an alert, and offers to ask again where that is safe", async () => {
    const mounted = mount();
    const late = downloadFailure("deadline", "wait", {
      artifact: "BackupLog",
      name: "nightly",
      namespace: A,
      request: "nightly-request-1",
      verdict: "unsigned",
    });

    await writesOn(mounted);
    await fail(mounted, late);
    expect(late.retry).toBe(true);
    expect(mounted.part("failure").getAttribute("role")).toBe("alert");
    expect(mounted.part("failure").getAttribute("data-code")).toBe("deadline");
    expect(mounted.part("failure").getAttribute("data-stage")).toBe("wait");
    expect(mounted.part("failure-text").textContent).toBe(late.text);
    expect(mounted.part("failure-text").textContent).toContain("Velero did not sign a URL in thirty seconds");
    // No file is said to be missing: the store was not asked.
    expect(mounted.maybe("missing")).toBeNull();
    expect(mounted.part("what").textContent).toBe(askAgainNote(A));
    expect(mounted.commands()).toEqual([`${mounted.id}-create`]);
    expect(words(mounted.part("create"))).toBe("Create another DownloadRequest of the kind BackupLog");
    // The focus is back on the command.
    expect(focused()).toBe(`${mounted.id}-create`);
    expect(viewers.given).toEqual([]);
    // Asking again is another request, through its confirmation.
    press(mounted.part("create"));
    await screen.findByTestId(`${mounted.id}-confirm`);
    expect(mounted.maybe("failure")).toBeNull();
    press(mounted.part("confirm-create"));
    await waitFor(() => expect(mounted.main.calls.at(-1)).toContain("token-2 request-2"));
  });

  it("marks a fault as one, and tells from it a load that was cancelled and a file the store does not have", async () => {
    for (const [code, stage, ended, role, mark] of [
      ["deadline", "wait", "fault", "alert", "error_outline"],
      ["transport-unreachable", "download", "fault", "alert", "error_outline"],
      ["artifact-missing", "download", "missing", "alert", "info_outline"],
      ["cancelled", "wait", "cancelled", "status", "cancel"],
    ] as const) {
      const mounted = mount();

      await writesOn(mounted);
      await fail(
        mounted,
        downloadFailure(code, stage, { artifact: "BackupLog", name: "nightly", namespace: A, request: "nightly-r" }),
      );
      // What the operator asked for is said, and is no alert; its mark is not the one of a fault.
      expect([code, mounted.part("failure").getAttribute("data-ended")]).toEqual([code, ended]);
      expect([code, mounted.part("failure").getAttribute("role")]).toEqual([code, role]);
      expect([code, mounted.part("failure").querySelector(".Icon")?.textContent]).toEqual([code, mark]);
      cleanup();
      confirmDialogs.length = 0;
    }
  });

  it("asks for a request, and not for another one, after a load that ended before anything was created", async () => {
    const mounted = mount();
    const context = { artifact: "BackupLog", name: "nightly", namespace: A } as const;

    await writesOn(mounted);
    // Cancelled while the object was read: nothing was created, and the words say so.
    await fail(mounted, downloadFailure("cancelled", "target", context));
    expect(mounted.part("failure-text").textContent).toBe("The request was cancelled before anything was created.");
    expect(mounted.part("what").textContent).toBe(askAgainNote(A, false));
    expect(mounted.part("what").textContent).toBe("Asking again creates a DownloadRequest in velero-a.");
    expect(words(mounted.part("create"))).toBe("Create a DownloadRequest of the kind BackupLog");
    expect(focused()).toBe(`${mounted.id}-create`);
    // Cancelled once its request was in the cluster: the next one is another.
    await fail(mounted, downloadFailure("cancelled", "wait", { ...context, request: "nightly-request-2" }));
    expect(mounted.part("what").textContent).toBe(askAgainNote(A));
    expect(words(mounted.part("create"))).toBe("Create another DownloadRequest of the kind BackupLog");
  });

  it("offers one command where asking again is not safe, which takes the tab back to its first state and asks nothing", async () => {
    const mounted = mount();
    const refused = downloadFailure("forbidden", "creation", { artifact: "BackupLog", name: "nightly", namespace: A });

    await writesOn(mounted);
    await fail(mounted, refused);
    expect(refused.retry).toBe(false);
    expect(mounted.part("failure-text").textContent).toBe(
      "The cluster refused the creation of a DownloadRequest: the identity needs the verb create on downloadrequests of the namespace.",
    );
    expect(mounted.part("not-again").textContent).toBe(NOT_AGAIN);
    // The same request is not offered again: the one command is the way back, and the focus is on it.
    expect(mounted.commands()).toEqual([`${mounted.id}-begin`]);
    expect(words(mounted.part("begin"))).toBe(beginAgain(false));
    expect(mounted.part("begin").getAttribute("aria-describedby")).toBe(mounted.part("not-again").id);
    expect(mounted.maybe("what")).toBeNull();
    expect(focused()).toBe(`${mounted.id}-begin`);
    const asked = mounted.main.calls.length;

    press(mounted.part("begin"));
    // The tab is at its first state, with its command, on which the focus is: nothing was asked.
    expect(mounted.panel().getAttribute("data-step")).toBe("first");
    expect(mounted.maybe("failure")).toBeNull();
    expect(mounted.part("what").textContent).toBe(
      wouldCreate("log", { kind: "Backup", name: "nightly", namespace: A, cluster: "local-demo" }),
    );
    expect(mounted.commands()).toEqual([`${mounted.id}-create`]);
    expect(words(mounted.part("create"))).toBe("Create a DownloadRequest of the kind BackupLog");
    expect(focused()).toBe(`${mounted.id}-create`);
    expect(mounted.main.calls).toHaveLength(asked);
  });

  it("leads back from a refusal of the gate to what the refusal says to do: the target bar, or the command", async () => {
    // The main process refuses the confirmation because writes are off there, which the views did not know.
    const off = mount();
    const gate = failed("forbidden", "gate", false, {
      text: "Writes are off for this installation: turn them on in the target bar.",
    });

    await writesOn(off);
    off.main.held.confirm = gate;
    press(off.part("create"));
    await waitFor(() => expect(off.panel().getAttribute("data-step")).toBe("failed"));
    expect(off.part("failure-text").textContent).toBe(gate.text);
    expect(off.commands()).toEqual([`${off.id}-begin`]);
    expect(focused()).toBe(`${off.id}-begin`);
    // The mirror is turned off, as the main process is: the way back shows the way to the target bar.
    fireEvent.click(screen.getByTestId("velero-writes-off"));
    await waitFor(() => expect(screen.getByTestId("velero-writes").getAttribute("data-writes")).toBe("off"));
    expect(off.commands()).toEqual([`${off.id}-begin`]);
    press(off.part("begin"));
    expect(off.panel().getAttribute("data-step")).toBe("first");
    expect(off.commands()).toEqual([`${off.id}-to-target`]);
    expect(focused()).toBe(`${off.id}-to-target`);
    // Writes are turned on again in the target bar: the tab offers its command, with nothing closed.
    off.main.held.confirm = undefined;
    await writesOn(off);
    expect(off.commands()).toEqual([`${off.id}-create`]);
    press(off.part("create"));
    await screen.findByTestId(`${off.id}-confirm`);
    cleanup();
    confirmDialogs.length = 0;
    // The confirmation of a load again is refused, over a text that is shown: the way back is to the text.
    const over = mount();
    const changed = failed("target-changed", "connection", false, {
      text: "The connection of this cluster changed: writes are off.",
    });

    await writesOn(over);
    await load(over);
    over.main.held.confirm = changed;
    press(over.part("create"));
    await waitFor(() => expect(over.panel().getAttribute("data-step")).toBe("failed"));
    expect(screen.getByTestId("velero-backup-log-viewer")).toBeTruthy();
    expect(words(over.part("begin"))).toBe(beginAgain(true));
    // What is said under the refusal is why it is not asked again, and not what loading again does.
    expect(over.part("not-again").textContent).toBe(NOT_AGAIN);
    expect(over.commands()).toEqual([`${over.id}-begin`]);
    press(over.part("begin"));
    expect(over.panel().getAttribute("data-step")).toBe("loaded");
    expect(over.main.calls.some((call) => call.startsWith("release"))).toBe(false);
    expect(over.commands()).toEqual([`${over.id}-create`, `${over.id}-save`]);
    expect(focused()).toBe(`${over.id}-create`);
  });

  it("offers to ask again only with writes on: with writes off it says where they are turned on", async () => {
    const mounted = mount();

    await writesOn(mounted);
    await fail(mounted, failed("transport-unreachable", "download", true));
    fireEvent.click(screen.getByTestId("velero-writes-off"));
    await waitFor(() => expect(mounted.maybe("writes-off")).toBeTruthy());
    expect(mounted.part("writes-off").textContent).toBe(writesOff());
    expect(mounted.part("what").textContent).toBe(askAgainNote(A));
    expect(mounted.commands()).toEqual([`${mounted.id}-to-target`]);
    expect(mounted.part("failure-text").textContent).toBe("Synthetic words of transport-unreachable at download.");
  });

  it(
    "says what a file the store does not have means for every phase a backup and a restore have",
    async () => {
      for (const [kind, phases, tab] of [
        ["Backup", BACKUP_PHASES, "log"],
        ["Restore", RESTORE_PHASES, "results"],
      ] as const) {
        // One operation in each phase, named by it.
        const table = answers({
          [path(kind === "Backup" ? "backups" : "restores", A)]: list(
            ...phases.map((phase) =>
              kind === "Backup" ? backup(phase.toLowerCase(), phase) : restore(phase.toLowerCase(), phase, "nightly"),
            ),
          ),
        });
        const mounted = mount({ kind, name: phases[0].toLowerCase(), tab }, { table });

        await writesOn(mounted);
        for (const phase of phases) {
          mounted.show({ name: phase.toLowerCase() });
          expect(mounted.panel().getAttribute("data-step")).toBe("first");
          await fail(mounted, failed("artifact-missing", "download", false));
          expect([phase, mounted.part("missing").textContent]).toEqual([
            phase,
            missingFile(tab, kind, operationState(kind, phase), time(NOW)),
          ]);
          // Each phase of the release has its words: none is said not to be known.
          expect(mounted.part("missing").textContent).not.toMatch(/not known/);
          // The way back is offered, and taken, for the next phase: nothing is asked for it.
          press(mounted.part("begin"));
        }
        cleanup();
      }
    },
    SLOW,
  );

  it(
    "says what a file the store does not have means, by the phase of the operation, in the words of its tab",
    async () => {
      for (const [kind, name, tab, phase, said] of [
        [
          "Backup",
          "refused",
          "log",
          "FailedValidation",
          "Velero writes nothing into the storage for a backup that failed its validation",
        ],
        [
          "Backup",
          "waiting",
          "results",
          "New",
          "written into the storage when its work ends: they were not there when",
        ],
        [
          "Backup",
          "working",
          "resources",
          "InProgress",
          "written into the storage when its work ends: it was not there when",
        ],
        ["Backup", "finalizing", "log", "Finalizing", "Velero uploads the log of a backup as best it can"],
        ["Backup", "nightly", "volumes", "PartiallyFailed", "it was removed from it, or it was never written there."],
        [
          "Backup",
          "failed",
          "log",
          "Failed",
          "Velero may have written the files of a backup that failed before it failed",
        ],
        ["Backup", "deleting", "log", "Deleting", "the backup is being deleted, and its files are being removed"],
        ["Backup", "silent", "log", undefined, "What its phase says of its files is not known."],
        ["Restore", "monday", "log", "Completed", "it was removed from it, or it was never written there."],
      ] as const) {
        const mounted = mount({ kind, name, tab });
        const missing = downloadFailure("artifact-missing", "download", {
          artifact: artifactOf(tab, kind),
          name,
          namespace: A,
          request: `${name}-request-1`,
        });

        await writesOn(mounted);
        await fail(mounted, missing);
        expect(mounted.part("failure").getAttribute("data-code")).toBe("artifact-missing");
        expect(mounted.part("failure-text").textContent).toBe(missing.text);
        expect([name, mounted.part("missing").textContent]).toEqual([
          name,
          missingFile(tab, kind, operationState(kind, phase), time(NOW)),
        ]);
        expect([name, mounted.part("missing").textContent?.includes(said)]).toEqual([name, true]);
        // The store has no such file: asking again as it was asked is not offered, and the way back is.
        expect(mounted.commands()).toEqual([`${mounted.id}-begin`]);
        expect(mounted.part("not-again").textContent).toBe(NOT_AGAIN);
        cleanup();
      }
    },
    SLOW,
  );

  it("says of an operation that has a time of deletion that its files are being removed, whatever its phase", async () => {
    // One that ended, and one that was at work: its files are not said to be written when its work ends.
    for (const name of ["leaving", "stopping"]) {
      const mounted = mount({ kind: "Restore", name, tab: "results" });

      await writesOn(mounted);
      await fail(mounted, failed("artifact-missing", "download", false));
      expect([name, mounted.part("missing").textContent]).toEqual([
        name,
        `The results of this restore were not in the storage when they were asked for, at ${time(NOW)}: the restore is being deleted, and its files are being removed.`,
      ]);
      cleanup();
    }
  });

  it("gives the focus to the words of how a load ended when no command follows them", async () => {
    const mounted = mount();

    await writesOn(mounted);
    await ask(mounted);
    // The storage location of the backup goes while the request runs: Velero signs no URL without it,
    // and asking again is not offered.
    mounted.table[path("storageLocations", A)] = list();
    await act(() => mounted.installation.refresh());
    await mounted.main.answer(failed("transport-unreachable", "download", true));
    await waitFor(() => expect(mounted.panel().getAttribute("data-step")).toBe("failed"));
    expect(mounted.maybe("nothing")).toBeTruthy();
    expect(mounted.commands()).toEqual([]);
    // The keyboard is not left on the words of a load that runs no more, which say nothing now.
    expect(mounted.part("status").textContent).toBe("");
    expect(focused()).toBe(`${mounted.id}-failure`);
  });

  it("keeps what a missing file meant when the store was asked, for an operation that went on since", async () => {
    const mounted = mount({ name: "working" });
    // What the store held is said of the moment it was asked, with that moment: it is true of it whatever
    // the backup did since.
    const then = `The log of a backup is written into the storage when its work ends: it was not there when it was asked for, at ${time(NOW)}.`;

    await writesOn(mounted);
    await fail(mounted, failed("artifact-missing", "download", false));
    expect(mounted.part("missing").textContent).toBe(then);
    mounted.table[path("backups", A)] = list(backup("working", "Completed"));
    await act(() => mounted.installation.refresh());
    expect(mounted.installation.read("backups").items[0].status?.phase).toBe("Completed");
    // The store was not asked again: nothing is claimed of what it holds of a backup that ended.
    expect(mounted.part("missing").textContent).toBe(then);
    // Another tab is shown, then this one again: the words are the same.
    mounted.show({ tab: "results" });
    mounted.show({ tab: "log" });
    expect(mounted.part("missing").textContent).toBe(then);
    // The backup ended since: the way back leads to the command that asks the store again, in this view.
    press(mounted.part("begin"));
    expect(mounted.commands()).toEqual([`${mounted.id}-create`]);
  });

  it("offers to allow what the download needs, in the name of what it allows, then asks again", async () => {
    const mounted = mount();
    const needs: AllowanceFor = { what: "origin", origin: ORIGIN, location: `${A}/default` };
    const denied = downloadFailure("destination-denied", "route", {
      artifact: "BackupLog",
      name: "nightly",
      namespace: A,
      request: "nightly-request-1",
      verdict: "allowance",
      needs,
    });

    await writesOn(mounted);
    await fail(mounted, denied);
    expect(denied.retry).toBe(false);
    expect(mounted.part("failure-text").textContent).toBe(denied.text);
    expect(mounted.part("failure-text").textContent).toContain(`The URL of the request is of ${ORIGIN}`);
    expect(mounted.part("what").textContent).toBe(allowNote("log"));
    expect(mounted.commands()).toEqual([`${mounted.id}-allow`]);
    expect(words(mounted.part("allow"))).toBe(allowCommand(needs));
    expect(words(mounted.part("allow"))).toBe(
      `Allow downloads from ${ORIGIN} for the storage location default of velero-a`,
    );
    // What becomes of what is allowed is said to who reaches the command with the keyboard as well.
    expect(mounted.part("allow").getAttribute("aria-describedby")).toBe(mounted.part("what").id);
    expect(focused()).toBe(`${mounted.id}-allow`);
    expect(mounted.installation.allowances).toEqual([]);
    const before = mounted.main.calls.length;

    press(mounted.part("allow"));
    await screen.findByTestId(`${mounted.id}-confirm`);
    // The main process keeps what was allowed, and the artifact is asked again: a new confirmation.
    expect(mounted.main.calls.slice(before)).toEqual([
      `allow origin ${ORIGIN} ${A}/default`,
      "confirm velero-a DownloadRequest Backup/nightly/backup-nightly-uid BackupLog",
    ]);
    expect(mounted.installation.allowances).toEqual([{ ...needs, since: NOW }]);
    expect(focused()).toBe(`${mounted.id}-confirm`);
  });

  it("names a private address and a connection that is not encrypted in the command that allows them", async () => {
    for (const needs of [
      { what: "private", origin: ORIGIN },
      { what: "http", origin: "http://minio.storage:9000" },
    ] as const) {
      const mounted = mount();

      await writesOn(mounted);
      await fail(mounted, failed("destination-denied", "route", false, { needs }));
      expect(words(mounted.part("allow"))).toBe(allowCommand(needs));
      expect(words(mounted.part("allow"))).toContain(needs.origin);
      cleanup();
    }
  });

  it("asks nothing again when the main process did not keep what was allowed, and says why", async () => {
    const mounted = mount();
    const needs: AllowanceFor = { what: "private", origin: ORIGIN };
    const unkept = failed("request-failed", "allowance", false, { text: "The allowance could not be kept." });

    mounted.main.held.allow = unkept;
    await writesOn(mounted);
    await fail(mounted, failed("destination-denied", "route", false, { needs }));
    const before = mounted.main.calls.length;

    press(mounted.part("allow"));
    await waitFor(() => expect(mounted.maybe("allow-failure")).toBeTruthy());
    expect(mounted.part("allow-failure").textContent).toBe(unkept.text);
    expect(mounted.part("allow-failure").getAttribute("role")).toBe("alert");
    expect(mounted.main.calls.slice(before)).toEqual([`allow private ${ORIGIN}`]);
    expect(mounted.panel().getAttribute("data-step")).toBe("failed");
    expect(mounted.installation.allowances).toEqual([]);
    // It is said under the command that allows, and under no other: the command of another tab creates a
    // request and allows nothing.
    mounted.show({ tab: "results" });
    expect(screen.getByTestId("velero-backup-results-create")).toBeTruthy();
    expect(screen.queryByTestId("velero-backup-results-allow-failure")).toBeNull();
  });

  it("asks nothing again after an allowance when the tab went on while the main process kept it", async () => {
    const mounted = mount();
    const needs: AllowanceFor = { what: "private", origin: ORIGIN };
    let keep: (answer: IpcAnswer<null>) => void = () => undefined;

    // The main process keeps what is allowed when the test says.
    mounted.main.allowances.allow = (_cluster, allowed) => {
      mounted.main.calls.push(`allow ${allowed.what} ${allowed.origin}`);
      return new Promise((resolve) => {
        keep = resolve;
      });
    };
    await writesOn(mounted);
    await fail(mounted, failed("destination-denied", "route", false, { needs }));
    const before = mounted.main.calls.length;

    press(mounted.part("allow"));
    await waitFor(() => expect(mounted.main.calls.slice(before)).toEqual([`allow private ${ORIGIN}`]));
    // What the installation held of the view is dropped meanwhile, as it is when another object took the
    // place of the one that is shown: the tab is at its first state, of another load.
    act(() => mounted.installation.artifacts.drop());
    expect(mounted.panel().getAttribute("data-step")).toBe("first");
    await act(async () => {
      keep(OK);
      await new Promise((done) => setTimeout(done, 0));
    });
    // The allowance was kept, and nothing is asked for a tab that is not where it was.
    expect(mounted.installation.allowances).toEqual([{ ...needs, since: NOW }]);
    expect(mounted.main.calls.slice(before)).toEqual([`allow private ${ORIGIN}`]);
    expect(mounted.panel().getAttribute("data-step")).toBe("first");
  });

  it("says a confirmation the main process refused, with the words it gave", async () => {
    const mounted = mount();
    const refused = failed("forbidden", "gate", false, { text: "Writes are off for this installation." });

    await writesOn(mounted);
    mounted.main.held.confirm = refused;
    press(mounted.part("create"));
    await waitFor(() => expect(mounted.panel().getAttribute("data-step")).toBe("failed"));
    expect(mounted.part("failure-text").textContent).toBe(refused.text);
    expect(mounted.part("failure").getAttribute("data-stage")).toBe("gate");
    expect(mounted.main.calls.filter((call) => call.startsWith("run"))).toEqual([]);
  });

  it("says that the main process is asked for the confirmation while it is", async () => {
    const mounted = mount();
    let confirm: (answer: IpcAnswer<{ token: string; expires: number }>) => void = () => undefined;

    await writesOn(mounted);
    mounted.main.writer.confirm = () =>
      new Promise((resolve) => {
        confirm = resolve;
      });
    press(mounted.part("create"));
    await waitFor(() => expect(mounted.part("status").textContent).toBe(ASKING));
    // It is said to who does not see as well, in the part that says what the tab is doing.
    expect(mounted.part("said").textContent).toBe(ASKING);
    expect(mounted.panel().getAttribute("data-step")).toBe("asking");
    expect(mounted.commands()).toEqual([]);
    expect(focused()).toBe(`${mounted.id}-status`);
    await act(async () => {
      confirm({ ok: true, value: { token: "token-1", expires: NOW + 30_000 } });
      await new Promise((done) => setTimeout(done, 0));
    });
    expect(mounted.maybe("confirm")).toBeTruthy();
    expect(focused()).toBe(`${mounted.id}-confirm`);
  });
});
