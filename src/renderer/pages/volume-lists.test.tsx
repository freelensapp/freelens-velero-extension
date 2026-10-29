// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { listProps } from "../../../test/host-components";
import {
  backup,
  before,
  DAY,
  HOUR,
  MINUTE,
  NOW,
  ownedBy,
  podVolumeBackup,
  podVolumeRestore,
  repository,
  restore,
} from "../../../test/volume-builders";
import { emptyPreferences, heldPreferences, RESOURCES, TITLES } from "../../common/discovery";
import { VIEWS } from "../../common/views";
import {
  LIST_NOTES,
  LIST_WORDS,
  NODE_AGENT_WORDS,
  NOT_REPORTED,
  NOT_WRITTEN,
  REFERENCE_WORDS,
  REPOSITORY_WORDS,
} from "../../common/volume-words";
import styles from "../components/views.module.css";
import { closeViews, openView } from "../navigation";
import { Installation, READ_EVERY } from "../state/installation";
import { BackupsPage } from "./backups-page";
import { OverviewPage } from "./overview-page";
import { PodVolumeBackupsPage } from "./pod-volume-backups-page";
import { PodVolumeRestoresPage } from "./pod-volume-restores-page";
import { RepositoriesPage } from "./repositories-page";
import { RestoresPage } from "./restores-page";
import { SchedulesPage } from "./schedules-page";

import type { Renderer } from "@freelensapp/extensions";

import type { ReactNode } from "react";

import type { Answer, Family, Preferences } from "../../common/discovery";

const DISCOVERY = "/apis/velero.io/v1";
const LOCATIONS = "/apis/velero.io/v1/backupstoragelocations";
const A = "velero";

type Answers = Record<string, Answer | (() => Promise<Answer>)>;

function path(family: Family, namespace = A): string {
  return `/apis/velero.io/v1/namespaces/${namespace}/${RESOURCES[family]}`;
}

function list(...items: unknown[]): Answer {
  return { status: 200, body: { items } };
}

// The installation of the tests: a backup in flight with its pod volume backups in every phase, a restore with its
// pod volume restores, and the repositories of each state.
const nightly = backup("nightly", "InProgress", { uid: "backup-nightly-2" });
const earlier = backup("nightly", "Completed", { uid: "backup-nightly-1" });
const monday = restore("monday", "InProgress", { uid: "restore-monday-1" });
const LONG = "repository-with-a-name-as-long-as-the-name-of-an-object-can-be-6";
const MiB = 1_048_576;
const of = ownedBy("Backup", nightly);
const repositories = [
  repository("shop-default-kopia", {
    phase: "Ready",
    lastMaintenanceTime: before(DAY),
    recentMaintenance: [
      { result: "Succeeded", startTimestamp: before(DAY + MINUTE), completeTimestamp: before(DAY) },
      {
        result: "Failed",
        startTimestamp: before(HOUR),
        completeTimestamp: before(HOUR - MINUTE),
        message: "out of space",
      },
    ],
  }),
  repository(
    "shop-default-restic",
    { phase: "Ready" },
    { spec: { repositoryType: "restic", resticIdentifier: "s3:https://s3.example.test/store/restic/shop" } },
  ),
  repository(
    "broken-archive-kopia",
    { phase: "NotReady", message: "error to connect to the repository\nconnection refused" },
    { spec: { volumeNamespace: "broken", backupStorageLocation: "archive" } },
  ),
  repository("fresh-default-kopia", undefined, { spec: { volumeNamespace: "fresh", maintenanceFrequency: "" } }),
  repository("odd-default-", { phase: "Broken" }, { spec: { volumeNamespace: "odd", repositoryType: "" } }),
  repository(LONG, { phase: "Ready", lastMaintenanceTime: before(2 * HOUR) }, { spec: { volumeNamespace: "long" } }),
];
const pvbs = [
  podVolumeBackup("nightly-none", undefined, of),
  podVolumeBackup("nightly-new", { phase: "New" }, of),
  podVolumeBackup("nightly-accepted", { phase: "Accepted", acceptedTimestamp: before(3 * MINUTE) }, of),
  podVolumeBackup(
    "nightly-running",
    {
      phase: "InProgress",
      acceptedTimestamp: before(12 * MINUTE),
      startTimestamp: before(10 * MINUTE),
      progress: { bytesDone: 512 * MiB, totalBytes: 1024 * MiB },
    },
    { ...of, spec: { node: "worker-2" } },
  ),
  podVolumeBackup("nightly-canceling", { phase: "Canceling", startTimestamp: before(5 * MINUTE) }, of),
  podVolumeBackup(
    "nightly-completed",
    {
      phase: "Completed",
      startTimestamp: before(20 * MINUTE),
      completionTimestamp: before(16 * MINUTE),
      progress: { bytesDone: 2 * MiB, totalBytes: 2 * MiB },
      incrementalBytes: MiB,
    },
    of,
  ),
  podVolumeBackup(
    "nightly-failed",
    {
      phase: "Failed",
      message: "data path failed\nthe disk is full",
      startTimestamp: before(7 * MINUTE),
      completionTimestamp: before(7 * MINUTE),
    },
    of,
  ),
  podVolumeBackup("nightly-timeout", { phase: "Failed", message: "timeout on preparing PVB" }, of),
  podVolumeBackup("nightly-canceled", { phase: "Canceled", message: "canceled by the backup" }, of),
  podVolumeBackup("nightly-odd", { phase: "Paused" }, { ...of, spec: { node: "", uploaderType: "" } }),
  podVolumeBackup("nightly-earlier", { phase: "Completed" }, ownedBy("Backup", earlier)),
];
const pvrs = [
  podVolumeRestore("monday-new", { phase: "New" }, ownedBy("Restore", monday)),
  podVolumeRestore(
    "monday-accepted",
    { phase: "Accepted", node: "worker-3", acceptedTimestamp: before(MINUTE) },
    ownedBy("Restore", monday),
  ),
  podVolumeRestore(
    "monday-legacy",
    { phase: "Completed", startTimestamp: before(9 * MINUTE), completionTimestamp: before(8 * MINUTE) },
    { ...ownedBy("Restore", monday), spec: { uploaderType: "restic" } },
  ),
];
const location = (name: string, accessMode = "ReadWrite") => ({
  metadata: { name, namespace: A, uid: `location-${name}` },
  spec: { provider: "aws", accessMode },
  status: { phase: "Available" },
});

function answers(more: Answers = {}): Answers {
  return {
    [DISCOVERY]: { status: 200, body: { resources: Object.values(RESOURCES).map((name) => ({ name })) } },
    [LOCATIONS]: list(location("default")),
    [path("backups")]: list(nightly),
    [path("restores")]: list(monday),
    [path("schedules")]: list(),
    [path("storageLocations")]: list(location("default")),
    [path("snapshotLocations")]: list(),
    [path("backupRepositories")]: list(...repositories),
    [path("podVolumeBackups")]: list(...pvbs),
    [path("podVolumeRestores")]: list(...pvrs),
    ...more,
  };
}

function mount(table: Answers, page: (installation: Installation) => ReactNode) {
  const asked: string[] = [];
  const installation = new Installation({
    cluster: { id: "cluster-a", name: "local-demo" },
    read: async (address) => {
      asked.push(address);
      const answer = table[address] ?? { status: 404 };

      return typeof answer === "function" ? answer() : answer;
    },
    now: () => NOW,
    storage: heldPreferences({ ...emptyPreferences(), selected: { "cluster-a": A } } satisfies Preferences),
  });

  render(page(installation));
  return { installation, asked };
}

const extension = { name: "@freelensapp/velero-extension" } as unknown as Renderer.LensExtension;
const rows = (kind: string) =>
  [...document.querySelectorAll(`[data-${kind}-row]`)].map((row) => row.getAttribute(`data-${kind}-row`));
const row = (kind: string, name: string) =>
  screen.getByText(name, { selector: `[data-${kind}-row]` }).closest(".TableRow") as HTMLElement;
const cell = (kind: string, name: string, column: string) =>
  row(kind, name).querySelector(`.TableCell.${column}`) as HTMLElement;
const head = (column: string) => document.querySelector(`.TableHead .TableCell.${column}`) as HTMLElement;
const tip = (element: Element) => {
  const pointed = element.querySelector("[id^='tooltip_target_']") as HTMLElement;

  fireEvent.mouseEnter(pointed);
  const said = screen.getByRole("tooltip").textContent;

  fireEvent.mouseLeave(pointed);
  return said;
};

beforeEach(() => {
  vi.setSystemTime(NOW);
});

afterEach(() => {
  act(() => closeViews());
  cleanup();
  listProps.clear();
  vi.useRealTimers();
});

describe("the list of the backup repositories", () => {
  it("gives the host a list that only reads, with the columns of the spec in their order", async () => {
    mount(answers(), (installation) => <RepositoriesPage installation={installation} />);
    await waitFor(() => expect(rows("backup-repository")).toHaveLength(repositories.length));
    const props = listProps.get("veleroBackupRepositoriesTable") ?? {};
    const columns = props.renderTableHeader as { title: string; id: string; sortBy: string; className: string }[];

    expect(props.isSelectable).toBe(false);
    expect((props.renderItemMenu as () => unknown)()).toBeNull();
    for (const forbidden of ["onAdd", "addRemoveButtons", "renderFooter", "headerActions"]) {
      expect(props[forbidden]).toBeUndefined();
    }
    expect(columns.map((column) => [column.title, column.id, column.className])).toEqual([
      ["Name", "name", "name"],
      ["Installation", "namespace", "installation"],
      ["Volume namespace", "volume-namespace", "volume-namespace"],
      ["Storage location", "location", "location"],
      ["Type", "type", "repository-type"],
      ["Readiness", "readiness", "readiness"],
      ["Last maintenance", "maintained", "maintained"],
      ["Maintenance frequency", "frequency", "frequency"],
      ["Age", "age", "age"],
    ]);
    expect(Object.keys(props.sortingCallbacks as object).sort()).toEqual(columns.map((column) => column.sortBy).sort());
  });

  it("says the readiness of each with its mark and word, the message in the tip, and its last maintenance", async () => {
    mount(answers(), (installation) => <RepositoriesPage installation={installation} />);
    await waitFor(() => expect(rows("backup-repository")).toHaveLength(repositories.length));
    const readiness = (name: string) => cell("backup-repository", name, "readiness");

    expect(
      ["shop-default-kopia", "broken-archive-kopia", "fresh-default-kopia", "odd-default-"].map((name) => [
        readiness(name).querySelector("[data-readiness]")?.getAttribute("data-readiness"),
        readiness(name).querySelector(".Icon")?.textContent,
        readiness(name).querySelector("[data-readiness]")?.lastElementChild?.textContent,
      ]),
    ).toEqual([
      ["ready", "check", "Ready"],
      ["not-ready", "error_outline", "Not ready"],
      ["not-initialized", "hourglass_empty", "Not initialized yet"],
      ["unknown", "help_outline", "Unknown: Broken"],
    ]);
    expect(tip(readiness("broken-archive-kopia"))).toBe("error to connect to the repository\nconnection refused");
    // One tip for a cell: the mark in the badge carries no tip of its own, which would say the message twice.
    expect(readiness("broken-archive-kopia").querySelector("[title]")).toBeNull();
    const maintained = cell("backup-repository", "shop-default-kopia", "maintained");

    // The time of the last that succeeded, with the mark of the newest that failed beside it, said in words.
    expect(
      maintained.getAttribute("data-newest-failed") ?? maintained.firstElementChild?.getAttribute("data-newest-failed"),
    ).toBe("true");
    expect(maintained.textContent).toBe(`1d ago${"warning_amber"}, ${REPOSITORY_WORDS.newestFailed}`);
    // The mark says its words to the pointer as well, as a sentence that is read alone.
    expect(maintained.querySelector("[data-maintenance=failed]")?.getAttribute("title")).toBe(
      "The newest maintenance failed",
    );
    expect(cell("backup-repository", "shop-default-restic", "maintained").textContent).toBe(
      REPOSITORY_WORDS.neverMaintained,
    );
    expect(cell("backup-repository", "fresh-default-kopia", "frequency").textContent).toBe("Not set");
    expect(cell("backup-repository", "shop-default-kopia", "frequency").textContent).toBe("168h0m0s");
    expect(cell("backup-repository", "odd-default-", "repository-type").textContent).toBe("Not set");
    expect(cell("backup-repository", "shop-default-restic", "repository-type").textContent).toBe("restic");
    expect(cell("backup-repository", "shop-default-kopia", "volume-namespace").textContent).toBe("shop");
  });

  it("marks a type the release does not write as not known, beside its text, and no type it writes", async () => {
    const zfs = repository("shop-default-zfs", { phase: "Ready" }, { spec: { repositoryType: "zfs" } });

    mount(answers({ [path("backupRepositories")]: list(...repositories, zfs) }), (installation) => (
      <RepositoriesPage installation={installation} />
    ));
    await waitFor(() => expect(rows("backup-repository")).toHaveLength(repositories.length + 1));
    const type = (name: string) => cell("backup-repository", name, "repository-type");

    expect(type("shop-default-zfs").querySelector("[data-written=unknown] .Icon")?.textContent).toBe("help_outline");
    expect(type("shop-default-zfs").textContent).toBe(`help_outlinezfs, ${NOT_WRITTEN.mark}`);
    expect(tip(type("shop-default-zfs"))).toBe(`zfs: ${NOT_WRITTEN.mark}`);
    expect(
      ["shop-default-kopia", "shop-default-restic", "odd-default-"].map(
        (name) => type(name).querySelector("[data-written]") ?? type(name).textContent,
      ),
    ).toEqual(["kopia", "restic", "Not set"]);
  });

  it("makes the storage location a way to its view when it is there, and says why when it is not", async () => {
    mount(answers(), (installation) => <RepositoriesPage installation={installation} />);
    await waitFor(() => expect(rows("backup-repository")).toHaveLength(repositories.length));
    const way = cell("backup-repository", "shop-default-kopia", "location").querySelector("button") as HTMLElement;

    expect(way.textContent).toBe("default");
    const absent = cell("backup-repository", "broken-archive-kopia", "location");

    expect(absent.querySelector("button")).toBeNull();
    expect(absent.querySelector("[data-reference]")?.getAttribute("data-reference")).toBe("absent");
    expect(tip(absent)).toBe("No backup storage location of this name in velero");
    fireEvent.click(way);
    await screen.findByTestId("velero-storage-location-workspace");
  });

  it("orders by readiness and by the last maintenance both ways, none last in the first, and searches the message", async () => {
    mount(answers(), (installation) => <RepositoriesPage installation={installation} />);
    await waitFor(() => expect(rows("backup-repository")).toHaveLength(repositories.length));
    fireEvent.click(head("readiness"));
    const ready = ["shop-default-kopia", "shop-default-restic", LONG];

    expect(rows("backup-repository").slice(0, 3).sort()).toEqual([...ready].sort());
    expect(rows("backup-repository").slice(3)).toEqual(["broken-archive-kopia", "fresh-default-kopia", "odd-default-"]);
    fireEvent.click(head("readiness"));
    expect(rows("backup-repository").slice(0, 3)).toEqual([
      "odd-default-",
      "fresh-default-kopia",
      "broken-archive-kopia",
    ]);
    fireEvent.click(head("maintained"));
    expect(rows("backup-repository").slice(0, 2)).toEqual(["shop-default-kopia", LONG]);
    fireEvent.click(head("maintained"));
    expect(rows("backup-repository").slice(-2)).toEqual([LONG, "shop-default-kopia"]);
    const props = listProps.get("veleroBackupRepositoriesTable") ?? {};
    const items = (props.getItems as () => { getName(): string }[])();
    const searched = (name: string) =>
      (props.searchFilters as ((item: unknown) => string[])[]).flatMap((filter) =>
        filter(items.find((item) => item.getName() === name)),
      );

    expect(searched("broken-archive-kopia")).toContain("error to connect to the repository\nconnection refused");
    expect(searched("broken-archive-kopia")).toContain("Not ready");
    expect(searched("shop-default-restic")).toContain(REPOSITORY_WORDS.neverMaintained);
  });
});

describe("the lists of the pod volume operations", () => {
  it("gives the host lists that only read, with the twelve columns of the spec in their order", async () => {
    mount(answers(), (installation) => <PodVolumeBackupsPage installation={installation} />);
    await waitFor(() => expect(rows("pod-volume-backup")).toHaveLength(pvbs.length));
    const props = listProps.get("veleroPodVolumeBackupsTable") ?? {};
    const columns = props.renderTableHeader as { title: string; id: string; sortBy: string; className: string }[];

    expect(props.isSelectable).toBe(false);
    expect((props.renderItemMenu as () => unknown)()).toBeNull();
    expect(columns.map((column) => [column.title, column.id, column.className])).toEqual([
      ["Name", "name", "name"],
      ["Installation", "namespace", "installation"],
      ["Phase", "phase", "phase"],
      ["Backup", "operation", "operation"],
      ["Source", "volume", "volume"],
      ["Node", "node", "node"],
      ["Progress", "bytes", "progress"],
      ["Started", "started", "started"],
      ["Duration", "duration", "duration"],
      ["Storage location", "storage", "storage"],
      ["Uploader", "uploader", "uploader"],
      ["Age", "age", "age"],
    ]);
    expect(Object.keys(props.sortingCallbacks as object).sort()).toEqual(columns.map((column) => column.sortBy).sort());
    // What no row says, over the list.
    expect(screen.getAllByTestId("velero-pod-volume-backups-note").map((note) => note.textContent)).toEqual([
      `info_outline${LIST_NOTES.PodVolumeBackup}`,
    ]);
  });

  it("says each phase with its mark and its label, the message of Velero in the tip", async () => {
    mount(answers(), (installation) => <PodVolumeBackupsPage installation={installation} />);
    await waitFor(() => expect(rows("pod-volume-backup")).toHaveLength(pvbs.length));
    const phase = (name: string) => cell("pod-volume-backup", name, "phase");

    // What an operation with no phase or New waits for is in its tip, which no message takes.
    expect([tip(phase("nightly-none")), tip(phase("nightly-new"))]).toEqual([
      NODE_AGENT_WORDS.PodVolumeBackup,
      NODE_AGENT_WORDS.PodVolumeBackup,
    ]);

    expect(
      [
        "nightly-none",
        "nightly-new",
        "nightly-accepted",
        "nightly-running",
        "nightly-canceling",
        "nightly-completed",
        "nightly-failed",
        "nightly-canceled",
        "nightly-odd",
      ].map((name) => [
        phase(name).querySelector(".Icon")?.textContent,
        phase(name).querySelector("[data-phase]")?.lastElementChild?.textContent,
        phase(name).querySelector("[data-outcome]")?.getAttribute("data-outcome"),
      ]),
    ).toEqual([
      ["hourglass_empty", "No phase yet", "none"],
      ["hourglass_empty", "New", "none"],
      ["hourglass_empty", "Accepted", "none"],
      ["autorenew", "In progress", "none"],
      ["stop_circle", "Canceling", "none"],
      ["check_circle_outline", "Completed", "completed"],
      ["highlight_off", "Failed", "failed"],
      ["block", "Canceled", "cancelled"],
      ["help_outline", "Unknown: Paused", "unknown"],
    ]);
    expect(tip(phase("nightly-failed"))).toBe("data path failed\nthe disk is full");
    expect(tip(phase("nightly-timeout"))).toBe("timeout on preparing PVB");
    // One tip for a cell: the mark in the badge carries no tip of its own, which would say the message twice.
    expect(phase("nightly-failed").querySelector("[title]")).toBeNull();
    // The release writes a message on a cancellation as well: it is in the tip whatever the phase.
    expect(tip(phase("nightly-canceled"))).toBe("canceled by the backup");
  });

  it("says in the tip the message of an operation that completed with one, as the release writes for an empty volume", async () => {
    const empty = podVolumeBackup(
      "nightly-empty",
      { phase: "Completed", message: "volume was empty so no snapshot was taken" },
      of,
    );

    mount(answers({ [path("podVolumeBackups")]: list(...pvbs, empty) }), (installation) => (
      <PodVolumeBackupsPage installation={installation} />
    ));
    await waitFor(() => expect(rows("pod-volume-backup")).toHaveLength(pvbs.length + 1));
    const phase = cell("pod-volume-backup", "nightly-empty", "phase");

    expect(phase.querySelector("[data-outcome]")?.getAttribute("data-outcome")).toBe("completed");
    expect(tip(phase)).toBe("volume was empty so no snapshot was taken");
    // A completed operation that carries no message says its phase in the tip.
    expect(tip(cell("pod-volume-backup", "nightly-completed", "phase"))).toBe("Completed");
  });

  it("makes the backup a way when it is the one of that UID, and says another one took the name otherwise", async () => {
    mount(answers({ [path("backups")]: list(nightly) }), (installation) => (
      <PodVolumeBackupsPage installation={installation} />
    ));
    await waitFor(() => expect(rows("pod-volume-backup")).toHaveLength(pvbs.length));
    const way = cell("pod-volume-backup", "nightly-completed", "operation").querySelector("button") as HTMLElement;
    const other = cell("pod-volume-backup", "nightly-earlier", "operation");

    expect(way.textContent).toBe("nightly");
    expect(other.querySelector("button")).toBeNull();
    expect(tip(other)).toBe("The backup of this name is another one, created after the one this operation belongs to");
    fireEvent.click(way);
    await screen.findByTestId("velero-backup-workspace");
  });

  it("shows the source, the node as a way of the host, the bytes, the start, the duration, the location and the uploader", async () => {
    mount(answers(), (installation) => <PodVolumeBackupsPage installation={installation} />);
    await waitFor(() => expect(rows("pod-volume-backup")).toHaveLength(pvbs.length));
    const text = (name: string, column: string) => cell("pod-volume-backup", name, column).textContent;

    expect(text("nightly-running", "volume")).toBe("shop/cart-0, data");
    const node = cell("pod-volume-backup", "nightly-running", "node").querySelector("a") as HTMLAnchorElement;

    expect([node.textContent, new URL(node.href).searchParams.get("kube-details")]).toEqual([
      "worker-2",
      "/api/v1/nodes/worker-2",
    ]);
    expect(text("nightly-odd", "node")).toBe(NOT_REPORTED);
    expect(text("nightly-running", "progress")).toBe("512.0 MiB of 1.0 GiB (50%)");
    expect(text("nightly-new", "progress")).toBe(NOT_REPORTED);
    expect(text("nightly-new", "started")).toBe("Not started");
    expect(text("nightly-running", "started")).toBe(new Date(NOW - 10 * MINUTE).toLocaleString());
    expect(text("nightly-accepted", "duration")).toBe("Waiting 3m");
    expect(text("nightly-running", "duration")).toBe("10m so far");
    expect(text("nightly-completed", "duration")).toBe("4m");
    expect(text("nightly-failed", "duration")).toBe("No duration: the start is the completion");
    expect(text("nightly-timeout", "duration")).toBe("No time written");
    expect(text("nightly-completed", "storage")).toBe("default");
    expect(text("nightly-completed", "uploader")).toBe("kopia");
    // An uploader that is not set is said so: the release reads it as restic, and Built-in is a data mover.
    expect(text("nightly-odd", "uploader")).toBe("Not set");
  });

  it("holds the words of the node, and of a backup not named, in a badge that is a flex item of its cell", async () => {
    const orphan = podVolumeBackup("nightly-orphan", { phase: "Completed" });

    mount(answers({ [path("podVolumeBackups")]: list(...pvbs, orphan) }), (installation) => (
      <PodVolumeBackupsPage installation={installation} />
    ));
    await waitFor(() => expect(rows("pod-volume-backup")).toHaveLength(pvbs.length + 1));
    // What is between the cell and the badge of its words, each element by its tag and its class.
    const between = (name: string, column: string) => {
      const box = cell("pod-volume-backup", name, column).firstElementChild as HTMLElement;
      const badge = box.querySelector(".badge") as HTMLElement;
      const parts: string[] = [];

      for (let element = badge.parentElement; element && element !== box; element = element.parentElement) {
        parts.unshift(element.tagName);
      }
      return [box.className, ...parts];
    };

    // The flex box of the cell holds the link of the host, a flex box itself by the stylesheet, which holds the
    // badge: no block between them, where a line would be drawn around the badge. A node that is not reported and
    // a backup that is not named are a badge of the flex box of the cell.
    expect(between("nightly-running", "node")).toEqual([styles.cellWords, "A"]);
    expect(between("nightly-odd", "node")).toEqual([styles.cellWords]);
    expect(between("nightly-orphan", "operation")).toEqual([`${styles.cellWords} ${styles.muted}`]);
    expect(cell("pod-volume-backup", "nightly-orphan", "operation").textContent).toBe(NOT_REPORTED);
    expect(cell("pod-volume-backup", "nightly-odd", "node").textContent).toBe(NOT_REPORTED);
  });

  it("marks an uploader the release does not write as not known, beside its text, and no uploader it writes", async () => {
    const other = podVolumeBackup(
      "nightly-other",
      { phase: "Completed" },
      { ...of, spec: { uploaderType: "velero-x" } },
    );

    mount(answers({ [path("podVolumeBackups")]: list(...pvbs, other) }), (installation) => (
      <PodVolumeBackupsPage installation={installation} />
    ));
    await waitFor(() => expect(rows("pod-volume-backup")).toHaveLength(pvbs.length + 1));
    const uploader = (name: string) => cell("pod-volume-backup", name, "uploader");

    expect(uploader("nightly-other").querySelector("[data-written=unknown] .Icon")?.textContent).toBe("help_outline");
    expect(uploader("nightly-other").textContent).toBe(`help_outlinevelero-x, ${NOT_WRITTEN.mark}`);
    expect(tip(uploader("nightly-other"))).toBe(`velero-x: ${NOT_WRITTEN.mark}`);
    // Kopia, and an uploader that is not set, which the release reads as restic, are no unknown.
    expect(
      ["nightly-completed", "nightly-odd"].map(
        (name) => uploader(name).querySelector("[data-written]") ?? uploader(name).textContent,
      ),
    ).toEqual(["kopia", "Not set"]);
  });

  it("orders by the phase and by the node both ways, none last in the first order, and searches the message", async () => {
    mount(answers(), (installation) => <PodVolumeBackupsPage installation={installation} />);
    await waitFor(() => expect(rows("pod-volume-backup")).toHaveLength(pvbs.length));
    // What each row says of the phase and of the node, in the order of the rows.
    const phases = () =>
      rows("pod-volume-backup").map(
        (name) =>
          cell("pod-volume-backup", name as string, "phase").querySelector("[data-phase]")?.lastElementChild
            ?.textContent,
      );
    const nodes = () =>
      rows("pod-volume-backup").map((name) => cell("pod-volume-backup", name as string, "node").textContent);
    const inOrder = [
      "No phase yet",
      "New",
      "Accepted",
      "In progress",
      "Canceling",
      "Completed",
      "Completed",
      "Failed",
      "Failed",
      "Canceled",
      "Unknown: Paused",
    ];

    fireEvent.click(head("phase"));
    expect(rows("pod-volume-backup").slice(0, 3)).toEqual(["nightly-none", "nightly-new", "nightly-accepted"]);
    expect(rows("pod-volume-backup").at(-1)).toBe("nightly-odd");
    // In flight by the order of its phases, then finished, then what is not known.
    expect(phases()).toEqual(inOrder);
    fireEvent.click(head("phase"));
    expect(rows("pod-volume-backup")[0]).toBe("nightly-odd");
    expect(phases()).toEqual([...inOrder].reverse());
    fireEvent.click(head("node"));
    expect(rows("pod-volume-backup").at(-1)).toBe("nightly-odd");
    expect(nodes()).toEqual([...Array(pvbs.length - 2).fill("worker-1"), "worker-2", NOT_REPORTED]);
    fireEvent.click(head("node"));
    expect(rows("pod-volume-backup")[0]).toBe("nightly-odd");
    expect(nodes()).toEqual([NOT_REPORTED, "worker-2", ...Array(pvbs.length - 2).fill("worker-1")]);
    const props = listProps.get("veleroPodVolumeBackupsTable") ?? {};
    const items = (props.getItems as () => { getName(): string }[])();
    const searched = (props.searchFilters as ((item: unknown) => string[])[]).flatMap((filter) =>
      filter(items.find((item) => item.getName() === "nightly-failed")),
    );

    expect(searched).toEqual(expect.arrayContaining(["data path failed\nthe disk is full", "nightly", "worker-1"]));
  });

  it("reads the node of a pod volume restore from its status, and says none for one a legacy controller took", async () => {
    mount(answers(), (installation) => <PodVolumeRestoresPage installation={installation} />);
    await waitFor(() => expect(rows("pod-volume-restore")).toHaveLength(pvrs.length));
    const props = listProps.get("veleroPodVolumeRestoresTable") ?? {};

    expect((props.renderTableHeader as { title: string }[])[3].title).toBe("Restore");
    expect(cell("pod-volume-restore", "monday-accepted", "node").textContent).toBe("worker-3");
    expect(cell("pod-volume-restore", "monday-legacy", "node").textContent).toBe(NOT_REPORTED);
    expect(cell("pod-volume-restore", "monday-legacy", "uploader").textContent).toBe("restic");
    expect(cell("pod-volume-restore", "monday-new", "volume").textContent).toBe("shop-restored/cart-0, data");
    expect(screen.getByTestId("velero-pod-volume-restores-note").textContent).toBe(
      `info_outline${LIST_NOTES.PodVolumeRestore}`,
    );
    // The words of a pod volume restore that waits are of the node of the restored pod.
    expect(NODE_AGENT_WORDS.PodVolumeRestore).toContain("restored pod");
  });

  it("gives no control that writes: no menu, no selection, and nothing in a row but its ways", async () => {
    mount(answers(), (installation) => <PodVolumeBackupsPage installation={installation} />);
    await waitFor(() => expect(rows("pod-volume-backup")).toHaveLength(pvbs.length));
    for (const name of rows("pod-volume-backup")) {
      const shown = row("pod-volume-backup", name as string);
      const controls = [
        ...shown.querySelectorAll("button, a, input, select, textarea, [role='checkbox'], [role='menu']"),
      ];

      for (const control of controls) {
        const way =
          control.hasAttribute("data-pod-volume-backup-row") ||
          control.getAttribute("data-reference") === "resolved" ||
          (control.tagName === "A" && (control.getAttribute("href") ?? "").includes("kube-details="));

        expect([name, control.outerHTML.slice(0, 80), way]).toEqual([name, control.outerHTML.slice(0, 80), true]);
      }
      expect(shown.querySelector(".TableCell.menu")?.textContent ?? "").toBe("");
      expect(shown.querySelector(".TableCell.checkbox")).toBeNull();
    }
  });
});

describe("what a list says of its family", () => {
  it.each([
    [
      "pod-volume-backups",
      "podVolumeBackups",
      (installation: Installation) => <PodVolumeBackupsPage installation={installation} />,
    ],
    [
      "pod-volume-restores",
      "podVolumeRestores",
      (installation: Installation) => <PodVolumeRestoresPage installation={installation} />,
    ],
    [
      "backup-repositories",
      "backupRepositories",
      (installation: Installation) => <RepositoriesPage installation={installation} />,
    ],
  ] as const)("in each state: %s", async (id, family, page) => {
    const kind =
      id === "backup-repositories"
        ? "backup-repository"
        : id === "pod-volume-backups"
          ? "pod-volume-backup"
          : "pod-volume-restore";
    const { plural, noun } = VIEWS[kind];
    const read = { backupRepositories: repositories, podVolumeBackups: pvbs, podVolumeRestores: pvrs }[family];

    for (const [status, words] of [
      [403, LIST_WORDS.denied(plural)],
      [404, LIST_WORDS["not-served"](plural)],
      [500, LIST_WORDS.failed(plural)],
    ] as const) {
      mount(answers({ [path(family)]: { status } }), page);
      const unavailable = await screen.findByTestId(`velero-${id}-unavailable`);

      expect([status, unavailable.textContent]).toEqual([status, `${LIST_WORDS.notShown(plural, A)}${words}`]);
      cleanup();
    }
    mount(answers({ [path(family)]: list() }), page);
    expect((await screen.findByTestId(`velero-${id}-empty`)).textContent).toBe(
      `info_outline${LIST_WORDS.empty(noun, A, "local-demo")}`,
    );
    cleanup();
    // Never answered: no rows, no count.
    mount(answers({ [path(family)]: () => new Promise<Answer>(() => undefined) }), page);
    expect((await screen.findByTestId(`velero-${id}-not-counted`)).textContent).toBe(LIST_WORDS.notCounted);
    cleanup();
    // Read, then failed: the rows of the read that succeeded stay, and the list says when they were read.
    const table = answers();
    const { installation } = mount(table, page);

    await waitFor(() => expect(rows(kind)).toHaveLength(read.length));
    table[path(family)] = { status: 500 };
    await act(async () => {
      await installation.refresh();
    });
    expect(rows(kind)).toHaveLength(read.length);
    expect(screen.queryByTestId(`velero-${id}-unavailable`)).toBeNull();
    expect(screen.getByTestId(`velero-notice-${family}`).textContent).toBe(
      `error_outline${TITLES[family]} could not be read. What is shown was read at ${new Date(NOW).toLocaleTimeString()}.`,
    );
  });

  it.each([
    [
      "pod-volume-backup",
      "backups",
      "nightly-completed",
      "nightly",
      (installation: Installation) => <PodVolumeBackupsPage installation={installation} />,
    ],
    [
      "pod-volume-restore",
      "restores",
      "monday-new",
      "monday",
      (installation: Installation) => <PodVolumeRestoresPage installation={installation} />,
    ],
  ] as const)(
    "marks the column of the %s owner of an earlier read by the notice over the list",
    async (kind, family, name, owner, page) => {
      const table = answers();
      const { installation } = mount(table, page);
      const way = () => cell(kind, name, "operation").querySelector("button") as HTMLButtonElement;

      await waitFor(() => expect(way()?.textContent).toBe(owner));
      expect(screen.queryByTestId(`velero-notice-${family}`)).toBeNull();
      table[path(family)] = { status: 500 };
      await act(async () => {
        await installation.refresh();
      });
      // The owner stays a way, as it was read, with why in its tip; what marks the column is the notice over the
      // list, which names the family the column is taken from and when it was read.
      expect([way().textContent, way().title]).toEqual([owner, REFERENCE_WORDS.stale(family)]);
      expect(screen.getByTestId(`velero-notice-${family}`).textContent).toBe(
        `error_outline${TITLES[family]} could not be read. What is shown was read at ${new Date(NOW).toLocaleTimeString()}.`,
      );
    },
  );
});

describe("the families of the pod volume operations, read where they are shown", () => {
  const PVB = path("podVolumeBackups");
  const PVR = path("podVolumeRestores");
  const count = (asked: string[], at: string) => asked.filter((one) => one === at).length;

  it("are read while their list is shown, at every read, and not while the Overview or another list is", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const backups = mount(answers(), (installation) => <BackupsPage installation={installation} />);

    await waitFor(() => expect(rows("backup")).toEqual(["nightly"]));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2 * READ_EVERY);
    });
    expect([
      count(backups.asked, PVB),
      count(backups.asked, PVR),
      count(backups.asked, path("backupRepositories")),
    ]).toEqual([0, 0, 3]);
    cleanup();
    const overview = mount(answers(), (installation) => (
      <OverviewPage extension={extension} installation={installation} />
    ));

    await screen.findByTestId("velero-overview-page");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2 * READ_EVERY);
    });
    expect([count(overview.asked, PVB), count(overview.asked, PVR)]).toEqual([0, 0]);
    cleanup();
    const shown = mount(answers(), (installation) => <PodVolumeBackupsPage installation={installation} />);

    await waitFor(() => expect(rows("pod-volume-backup")).toHaveLength(pvbs.length));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2 * READ_EVERY);
    });
    expect([count(shown.asked, PVB), count(shown.asked, PVR)]).toEqual([3, 0]);
  });

  it("are both read while a repository is open over its list, and kept while an operation is opened from it", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const { asked, installation } = mount(answers(), (installation) => (
      <RepositoriesPage installation={installation} />
    ));

    await waitFor(() => expect(rows("backup-repository")).toHaveLength(repositories.length));
    expect([count(asked, PVB), count(asked, PVR)]).toEqual([0, 0]);
    // The view of a repository shows what used it: both families are asked at once, alone, and at each read while
    // it is open.
    act(() => openView({ kind: "backup-repository", name: "shop-default-kopia" }));
    await screen.findByTestId("velero-backup-repository-workspace");
    await waitFor(() =>
      expect([installation.read("podVolumeBackups").status, installation.read("podVolumeRestores").status]).toEqual([
        "ready",
        "ready",
      ]),
    );
    expect([count(asked, PVB), count(asked, PVR)]).toEqual([1, 1]);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(READ_EVERY);
    });
    expect([count(asked, PVB), count(asked, PVR)]).toEqual([2, 2]);
    // An operation opened from it keeps what the repository under it reads: the way back finds both read.
    act(() => openView({ kind: "pod-volume-backup", name: "nightly-completed" }));
    await screen.findByTestId("velero-pod-volume-backup-workspace");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(READ_EVERY);
    });
    expect([count(asked, PVB), count(asked, PVR)]).toEqual([3, 3]);
    expect(installation.read("podVolumeRestores").status).toBe("ready");
    act(() => closeViews());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2 * READ_EVERY);
    });
    expect([count(asked, PVB), count(asked, PVR)]).toEqual([3, 3]);
    expect(installation.read("podVolumeBackups")).toEqual({ status: "idle", items: [] });
    expect(installation.read("podVolumeRestores")).toEqual({ status: "idle", items: [] });
  });

  it("are asked by a view of a backup and of a restore, each its own, and not by a view of a schedule", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const daily = {
      metadata: { name: "daily", namespace: A, uid: "schedule-daily" },
      spec: { schedule: "0 1 * * *", template: {} },
      status: { phase: "Enabled" },
    };

    for (const [kind, name, page, expected] of [
      ["backup", "nightly", (made: Installation) => <BackupsPage installation={made} />, [1, 0]],
      ["restore", "monday", (made: Installation) => <RestoresPage installation={made} />, [0, 1]],
      ["schedule", "daily", (made: Installation) => <SchedulesPage installation={made} />, [0, 0]],
    ] as const) {
      const { asked, installation } = mount(answers({ [path("schedules")]: list(daily) }), page);

      await waitFor(() => expect(installation.read("backups").status).toBe("ready"));
      expect([kind, count(asked, PVB), count(asked, PVR)]).toEqual([kind, 0, 0]);
      act(() => openView({ kind, name }));
      const workspace = await screen.findByTestId(`velero-${kind}-workspace`);

      expect(within(workspace).getByTestId(`velero-${kind}-name`).textContent).toBe(name);
      // The family of the view is asked at once, alone, and the other is not.
      await waitFor(() => expect(installation.reading).toBe(false));
      expect([kind, count(asked, PVB), count(asked, PVR)]).toEqual([kind, ...expected]);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(READ_EVERY);
      });
      expect([kind, count(asked, PVB), count(asked, PVR)]).toEqual([kind, 2 * expected[0], 2 * expected[1]]);
      expect(asked).toContain(path("backupRepositories"));
      act(() => closeViews());
      cleanup();
    }
  });
});
