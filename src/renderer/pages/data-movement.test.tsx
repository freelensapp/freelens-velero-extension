// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hostObject } from "../../../test/freelens-extensions";
import { drawerValue, listProps } from "../../../test/host-components";
import {
  backup,
  before,
  dataDownload,
  dataUpload,
  MINUTE,
  moved,
  NOW,
  ownedBy,
  podVolumeBackup,
  repository,
  restore,
} from "../../../test/volume-builders";
import { emptyPreferences, FAMILIES, heldPreferences, RESOURCES, versionOf } from "../../common/discovery";
import { PATHS } from "../../common/paths";
import {
  LIST_NOTES,
  LIST_WORDS,
  MOVER_NOTE,
  NODE_AGENT_WORDS,
  NOT_WRITTEN,
  VOLUME_WORDS,
} from "../../common/volume-words";
import { DataDownload, DataUpload } from "../api/kinds";
import { VolumeOperationDetails } from "../details/volume-operation-details";
import { closeViews, openView, openViews } from "../navigation";
import { Installation } from "../state/installation";
import { BackupsPage } from "./backups-page";
import { DataDownloadsPage } from "./data-downloads-page";
import { DataUploadsPage } from "./data-uploads-page";
import { OverviewPage } from "./overview-page";
import { RestoresPage } from "./restores-page";

import type { Renderer } from "@freelensapp/extensions";

import type { ReactNode } from "react";

import type { Answer, Family } from "../../common/discovery";

const DISCOVERY = "/apis/velero.io/v1";
const SECOND = "/apis/velero.io/v2alpha1";
const LOCATIONS = "/apis/velero.io/v1/backupstoragelocations";
const A = "velero";
const MiB = 1_048_576;
const extension = { name: "@freelensapp/velero-extension" } as unknown as Renderer.LensExtension;

type Answers = Record<string, Answer | (() => Promise<Answer>)>;

function path(family: Family, namespace = A): string {
  return PATHS.family(family, namespace);
}

function list(...items: unknown[]): Answer {
  return { status: 200, body: { items } };
}

// A backup that moves the data of its snapshots and waits for its plugin operations, the restore of it, and their
// data movement: an upload in progress, one completed whose snapshot the download restores, one New.
const nightly = backup("nightly", "WaitingForPluginOperations", { uid: "backup-nightly-2" });
const monday = restore("monday", "InProgress", { uid: "restore-monday-1" });
const location = (name: string) => ({
  metadata: { name, namespace: A, uid: `location-${name}` },
  spec: { provider: "aws", accessMode: "ReadWrite" },
  status: { phase: "Available" },
});
const kopia = repository("shop-default-kopia", { phase: "Ready", lastMaintenanceTime: before(MINUTE) });
const uploading = dataUpload(
  "nightly-d4m8s",
  {
    phase: "InProgress",
    node: "worker-2",
    nodeOS: "linux",
    acceptedByNode: "worker-1",
    acceptedTimestamp: before(5 * MINUTE),
    startTimestamp: before(4 * MINUTE),
    progress: { bytesDone: 256 * MiB, totalBytes: 512 * MiB },
  },
  moved("Backup", nightly, "du-backup-nightly-2.pvc-orders-0"),
);
const uploaded = dataUpload(
  "nightly-k2p9x",
  {
    phase: "Completed",
    node: "worker-1",
    nodeOS: "linux",
    acceptedByNode: "worker-1",
    path: "/host_pods/9f2c/volumes/kubernetes.io~csi/pvc-1/mount",
    snapshotID: "9a8b7c6d5e4f3a2b",
    dataMoverResult: { parallelFilesUpload: "4" },
    acceptedTimestamp: before(30 * MINUTE),
    startTimestamp: before(29 * MINUTE),
    completionTimestamp: before(20 * MINUTE),
    progress: { bytesDone: 2 * MiB, totalBytes: 2 * MiB },
    incrementalBytes: MiB,
  },
  {
    ...moved("Backup", nightly, "du-backup-nightly-2.pvc-ledger-0"),
    spec: { sourcePVC: "ledger-0", dataMoverConfig: { parallelFilesUpload: "4" } },
  },
);
const waiting = dataUpload("nightly-n7v3c", undefined, {
  ...moved("Backup", nightly, "du-backup-nightly-2.pvc-cache-0"),
  spec: { sourcePVC: "cache-0", datamover: "acme-mover", snapshotType: "Clone" },
});
const restoring = dataDownload(
  "monday-r2t6v",
  { phase: "Prepared", node: "worker-3", acceptedByNode: "worker-3", acceptedTimestamp: before(2 * MINUTE) },
  moved("Restore", monday, "dd-restore-monday-1.pvc-ledger-0"),
);
const pending = dataDownload("monday-q8w1z", undefined, {
  ...moved("Restore", monday, "dd-restore-monday-1.pvc-orders-0"),
  spec: { snapshotID: "not-moved-here", targetVolume: { pvc: "orders-0", namespace: "shop-restored" } },
});

function answers(more: Answers = {}): Answers {
  return {
    [DISCOVERY]: {
      status: 200,
      body: {
        resources: FAMILIES.filter((family) => versionOf(family) === "v1").map((family) => ({
          name: RESOURCES[family],
        })),
      },
    },
    [SECOND]: { status: 200, body: { resources: [{ name: "datauploads" }, { name: "datadownloads" }] } },
    [LOCATIONS]: list(location("default")),
    [path("backups")]: list(nightly),
    [path("restores")]: list(monday),
    [path("schedules")]: list(),
    [path("storageLocations")]: list(location("default")),
    [path("snapshotLocations")]: list(),
    [path("backupRepositories")]: list(kopia),
    [path("podVolumeBackups")]: list(
      podVolumeBackup("nightly-x7k2p", { phase: "Completed" }, ownedBy("Backup", nightly)),
    ),
    [path("podVolumeRestores")]: list(),
    [path("dataUploads")]: list(uploading, uploaded, waiting),
    [path("dataDownloads")]: list(restoring, pending),
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
    storage: heldPreferences({ ...emptyPreferences(), selected: { "cluster-a": A } }),
  });

  render(page(installation));
  return { installation, asked };
}

const rows = (kind: string) =>
  [...document.querySelectorAll(`[data-${kind}-row]`)].map((row) => row.getAttribute(`data-${kind}-row`));
const row = (kind: string, name: string) =>
  screen.getByText(name, { selector: `[data-${kind}-row]` }).closest(".TableRow") as HTMLElement;
const cell = (kind: string, name: string, column: string) =>
  row(kind, name).querySelector(`.TableCell.${column}`) as HTMLElement;

// A fact of a band of a view: its name, its value and its note, which are its three parts in that order.
const fact = (band: HTMLElement, name: string) => {
  const found = [...band.querySelectorAll<HTMLElement>("div")].filter(
    (element) => element.firstElementChild?.textContent === name && element.children.length >= 2,
  );

  if (found.length !== 1) throw new Error(`The fact ${name} is ${found.length} times in the band`);
  return found[0];
};
const value = (band: HTMLElement, name: string) => fact(band, name).children[1].textContent;
const note = (band: HTMLElement, name: string) => fact(band, name).children[2]?.textContent;
const halves = () =>
  within(screen.getByTestId("velero-volume-band"))
    .getAllByTestId("velero-volume-half")
    .map((half) => [half.getAttribute("data-kind"), half.getAttribute("data-state")]);

beforeEach(() => {
  vi.setSystemTime(NOW);
});

afterEach(() => {
  act(() => closeViews());
  cleanup();
  listProps.clear();
  vi.useRealTimers();
});

describe("the lists of the data movement", () => {
  it("give the host lists that only read, with the twelve columns of the spec, the data mover in the place of the uploader", async () => {
    mount(answers(), (installation) => <DataUploadsPage installation={installation} />);
    await waitFor(() => expect(rows("data-upload")).toHaveLength(3));
    const props = listProps.get("veleroDataUploadsTable") ?? {};
    const columns = props.renderTableHeader as { title: string; id: string; className: string }[];

    expect(props.isSelectable).toBe(false);
    expect((props.renderItemMenu as () => unknown)()).toBeNull();
    expect(columns.map((column) => [column.title, column.id])).toEqual([
      ["Name", "name"],
      ["Installation", "namespace"],
      ["Phase", "phase"],
      ["Backup", "operation"],
      ["Source", "volume"],
      ["Node", "node"],
      ["Progress", "bytes"],
      ["Started", "started"],
      ["Duration", "duration"],
      ["Storage location", "storage"],
      ["Data mover", "uploader"],
      ["Age", "age"],
    ]);
    expect(screen.getAllByTestId("velero-data-uploads-note").map((one) => one.textContent)).toEqual([
      `info_outline${LIST_NOTES.DataUpload}`,
    ]);
  });

  it("show the source claim, the node of the data path, the bytes, and the data mover, built-in or marked as not known", async () => {
    mount(answers(), (installation) => <DataUploadsPage installation={installation} />);
    await waitFor(() => expect(rows("data-upload")).toHaveLength(3));

    expect(cell("data-upload", "nightly-d4m8s", "volume").textContent).toBe("shop/orders-0");
    expect(cell("data-upload", "nightly-d4m8s", "node").textContent).toBe("worker-2");
    expect(cell("data-upload", "nightly-d4m8s", "progress").textContent).toBe("256.0 MiB of 512.0 MiB (50%)");
    expect(cell("data-upload", "nightly-d4m8s", "uploader").textContent).toBe("Built-in");
    expect(cell("data-upload", "nightly-d4m8s", "operation").textContent).toBe("nightly");
    // A data mover the release does not run is kept as its text, with the mark of what is not known.
    const other = cell("data-upload", "nightly-n7v3c", "uploader");

    expect(other.textContent).toContain("acme-mover");
    expect(other.querySelector("[data-written=unknown]")).not.toBeNull();
    expect(other.innerHTML).not.toContain(NOT_WRITTEN.note);
    expect(cell("data-upload", "nightly-k2p9x", "volume").textContent).toBe("shop/ledger-0");
  });

  it("show the target claim of a data download, and its restore as a way", async () => {
    mount(answers(), (installation) => <DataDownloadsPage installation={installation} />);
    await waitFor(() => expect(rows("data-download")).toHaveLength(2));
    const props = listProps.get("veleroDataDownloadsTable") ?? {};

    expect((props.renderTableHeader as { title: string }[]).map((column) => column.title)).toContain("Restore");
    expect(cell("data-download", "monday-r2t6v", "volume").textContent).toBe("shop-restored/orders-0");
    expect(cell("data-download", "monday-r2t6v", "operation").textContent).toBe("monday");
    expect(cell("data-download", "monday-r2t6v", "phase").textContent).toContain("Prepared");
    expect(screen.getAllByTestId("velero-data-downloads-note").map((one) => one.textContent)).toEqual([
      `info_outline${LIST_NOTES.DataDownload}`,
    ]);
  });

  it("say that the cluster does not serve them where the second version is not served, and nothing else changes", async () => {
    const { asked } = mount(answers({ [SECOND]: { status: 404 } }), (installation) => (
      <DataUploadsPage installation={installation} />
    ));

    expect((await screen.findByTestId("velero-data-uploads-unavailable")).textContent).toContain(
      LIST_WORDS["not-served"]("data uploads"),
    );
    expect(asked.some((address) => address.includes("v2alpha1/namespaces"))).toBe(false);
    cleanup();
    mount(answers({ [SECOND]: { status: 404 } }), (installation) => <BackupsPage installation={installation} />);
    act(() => openView({ kind: "backup", name: "nightly" }));
    await screen.findByTestId("velero-backup-workspace");
    await waitFor(() =>
      expect(halves()).toEqual([
        ["PodVolumeBackup", "rows"],
        ["DataUpload", "not-served"],
      ]),
    );
  });
});

describe("the families of the data movement, read where they are shown", () => {
  it("are read under the second version while their list or a view that shows them is open, and not by the Overview", async () => {
    const { asked } = mount(answers(), (installation) => (
      <OverviewPage extension={extension} installation={installation} />
    ));

    await screen.findByTestId("velero-overview-page");
    await waitFor(() => expect(asked).toContain(path("backupRepositories")));
    expect(asked.filter((address) => address.includes("v2alpha1/namespaces"))).toEqual([]);
    cleanup();
    const backups = mount(answers(), (installation) => <BackupsPage installation={installation} />);

    act(() => openView({ kind: "backup", name: "nightly" }));
    await screen.findByTestId("velero-backup-workspace");
    await waitFor(() => expect(backups.asked).toContain(path("dataUploads")));
    expect(backups.asked).not.toContain(path("dataDownloads"));
    // The way of views goes with the page it was opened over.
    act(() => closeViews());
    cleanup();
    const restores = mount(answers(), (installation) => <RestoresPage installation={installation} />);

    act(() => openView({ kind: "restore", name: "monday" }));
    await screen.findByTestId("velero-restore-workspace");
    await waitFor(() => expect(restores.asked).toContain(path("dataDownloads")));
    expect(restores.asked).not.toContain(path("dataUploads"));
  });
});

describe("the band of a backup and of a restore", () => {
  it("shows the data uploads of a backup in a half of their own, by claim, from the newest, each a way to its view", async () => {
    mount(answers(), (installation) => <BackupsPage installation={installation} />);
    act(() => openView({ kind: "backup", name: "nightly" }));
    const workspace = await screen.findByTestId("velero-backup-workspace");

    await waitFor(() =>
      expect(halves()).toEqual([
        ["PodVolumeBackup", "rows"],
        ["DataUpload", "rows"],
      ]),
    );
    const data = within(workspace).getAllByTestId("velero-volume-half")[1];

    expect(within(data).getByTestId("velero-volume-count").textContent).toBe("3 data uploads, from the newest");
    // A claim and no pod: the columns of a data movement.
    expect([...data.querySelectorAll("thead th")].map((head) => head.textContent)).toEqual([
      "Claim",
      "Phase",
      "Bytes",
      "Node",
    ]);
    expect([...data.querySelectorAll("tbody tr")].map((one) => one.getAttribute("data-operation"))).toEqual([
      "nightly-d4m8s",
      "nightly-k2p9x",
      "nightly-n7v3c",
    ]);
    fireEvent.click(within(data).getByTestId("velero-open-data-upload-nightly-d4m8s"));
    await screen.findByTestId("velero-data-upload-workspace");
    expect(openViews()).toEqual([
      { kind: "backup", name: "nightly" },
      { kind: "data-upload", name: "nightly-d4m8s" },
    ]);
    fireEvent.click(screen.getByTestId("velero-back"));
    await screen.findByTestId("velero-backup-workspace");
  });

  it("shows the data downloads of a restore, and says which kind it cannot read without taking the other", async () => {
    mount(answers({ [path("dataDownloads")]: { status: 403 } }), (installation) => (
      <RestoresPage installation={installation} />
    ));
    act(() => openView({ kind: "restore", name: "monday" }));
    await screen.findByTestId("velero-restore-workspace");
    await waitFor(() =>
      expect(halves()).toEqual([
        ["PodVolumeRestore", "rows"],
        ["DataDownload", "denied"],
      ]),
    );
    const data = within(screen.getByTestId("velero-volume-band")).getAllByTestId("velero-volume-half")[1];

    expect(within(data).getByTestId("velero-volume-state").textContent).toBe(
      "The data downloads of this installation cannot be read: access is denied. How many this restore has is not known.",
    );
  });
});

describe("the view of a data movement", () => {
  it("of a data upload says what it moves, from which snapshot, where its data path runs, and how it was made", async () => {
    mount(answers(), (made) => <DataUploadsPage installation={made} />);
    act(() => openView({ kind: "data-upload", name: "nightly-k2p9x" }));
    const workspace = await screen.findByTestId("velero-data-upload-workspace");
    const status = within(workspace).getByTestId("velero-data-upload-status");

    expect(within(status).getByTestId("velero-volume-bytes").textContent).toBe("2.0 MiB of 2.0 MiB (100%)");
    expect(within(status).getByTestId("velero-volume-incremental").textContent).toBe("1.0 MiB");
    expect(within(status).queryByTestId("velero-volume-snapshot-size")).toBeNull();
    const belongs = within(workspace).getByTestId("velero-volume-belongs");

    expect(value(belongs, "Backup")).toBe("nightly (Waiting for plugin operations)");
    expect(value(belongs, "Repository")).toBe("shop-default-kopia");
    const of = within(workspace).getByTestId("velero-volume-of");

    expect([
      value(of, "Source namespace"),
      value(of, "Source claim"),
      value(of, "Volume snapshot"),
      value(of, "Snapshot class"),
      value(of, "Driver"),
      value(of, "Storage class"),
      value(of, "Node"),
    ]).toEqual([
      "shop",
      "ledger-0, UID pvc-du-backup-nightly-2.pvc-ledger-0",
      "velero-orders-0-x7k2p",
      "csi-snapclass",
      "hostpath.csi.k8s.io",
      "standard",
      "worker-1",
    ]);
    expect(note(of, "Node")).toBe(VOLUME_WORDS.nodeNote.DataUpload);
    // The node agent that accepted it is the one of its node: it is not said twice.
    expect(within(of).queryByText("Accepted by")).toBeNull();
    const settings = within(workspace).getByTestId("velero-volume-settings");

    expect([
      value(settings, "Data mover"),
      value(settings, "Data mover configuration"),
      value(settings, "Operation timeout"),
      value(settings, "Node OS"),
      value(settings, "Snapshot type"),
      value(settings, "Snapshot ID"),
      value(settings, "Path"),
      value(settings, "Data mover result"),
      value(settings, "Cancellation"),
    ]).toEqual([
      "Built-in",
      "parallelFilesUpload: 4",
      "10m0s",
      "linux",
      "CSI",
      "9a8b7c6d5e4f3a2b",
      "/host_pods/9f2c/volumes/kubernetes.io~csi/pvc-1/mount",
      "parallelFilesUpload: 4",
      VOLUME_WORDS.cancelNotAsked,
    ]);
    expect(note(settings, "Data mover")).toBe(MOVER_NOTE);
    // Nothing of a pod: a data movement has none.
    expect(within(workspace).queryByText("Pod")).toBeNull();
  });

  it("of a data upload says the node agent that accepted it when its data path runs on another node", async () => {
    mount(answers(), (made) => <DataUploadsPage installation={made} />);
    act(() => openView({ kind: "data-upload", name: "nightly-d4m8s" }));
    const workspace = await screen.findByTestId("velero-data-upload-workspace");
    const of = within(workspace).getByTestId("velero-volume-of");

    expect([value(of, "Node"), value(of, "Accepted by"), note(of, "Accepted by")]).toEqual([
      "worker-2",
      "worker-1",
      VOLUME_WORDS.acceptedBy,
    ]);
  });

  it("of a data upload New says what it waits for, and marks a data mover and a snapshot type the release does not write", async () => {
    mount(answers(), (made) => <DataUploadsPage installation={made} />);
    act(() => openView({ kind: "data-upload", name: "nightly-n7v3c" }));
    const workspace = await screen.findByTestId("velero-data-upload-workspace");
    const status = within(workspace).getByTestId("velero-data-upload-status");

    expect(note(status, "Phase")).toContain(NODE_AGENT_WORDS.DataUpload);
    const settings = within(workspace).getByTestId("velero-volume-settings");

    expect(value(settings, "Data mover")).toContain("acme-mover");
    expect(note(settings, "Data mover")).toBe(NOT_WRITTEN.note);
    expect(value(settings, "Snapshot type")).toContain("Clone");
    expect(note(settings, "Snapshot type")).toBe(NOT_WRITTEN.note);
    expect(settings.querySelectorAll("[data-written=unknown]")).toHaveLength(2);
  });

  it("of a data download says where it restores to, from which snapshot, and leads to the data upload of that snapshot", async () => {
    mount(answers(), (made) => <DataDownloadsPage installation={made} />);
    act(() => openView({ kind: "data-download", name: "monday-r2t6v" }));
    const workspace = await screen.findByTestId("velero-data-download-workspace");
    const status = within(workspace).getByTestId("velero-data-download-status");

    expect(within(status).getByTestId("velero-volume-snapshot-size").textContent).toBe("2.0 MiB");
    expect(within(status).queryByTestId("velero-volume-incremental")).toBeNull();
    expect(value(status, "Waiting")).toBe("Waiting 2m");
    const of = within(workspace).getByTestId("velero-volume-of");

    expect([
      value(of, "Target namespace"),
      value(of, "Target claim"),
      value(of, "Volume"),
      value(of, "Source namespace"),
      value(of, "Snapshot ID"),
      value(of, "Data upload"),
    ]).toEqual(["shop-restored", "orders-0", "Not reported", "shop", "9a8b7c6d5e4f3a2b", "nightly-k2p9x"]);
    expect(note(of, "Data upload")).toBe(VOLUME_WORDS.uploadNote);
    fireEvent.click(within(of).getByTestId("velero-open-data-upload-nightly-k2p9x"));
    await screen.findByTestId("velero-data-upload-workspace");
    fireEvent.click(screen.getByTestId("velero-back"));
    await screen.findByTestId("velero-data-download-workspace");
    expect(openViews()).toEqual([{ kind: "data-download", name: "monday-r2t6v" }]);
  });

  it("of a data download whose snapshot no data upload of the installation names says nothing of one", async () => {
    mount(answers(), (made) => <DataDownloadsPage installation={made} />);
    act(() => openView({ kind: "data-download", name: "monday-q8w1z" }));
    const workspace = await screen.findByTestId("velero-data-download-workspace");
    const of = within(workspace).getByTestId("velero-volume-of");

    expect(value(of, "Snapshot ID")).toBe("not-moved-here");
    expect(within(of).queryByText("Data upload")).toBeNull();
    expect(note(within(workspace).getByTestId("velero-data-download-status"), "Phase")).toContain(
      NODE_AGENT_WORDS.DataDownload,
    );
  });

  it("gives no control that writes: every button is a way", async () => {
    mount(answers(), (made) => <DataDownloadsPage installation={made} />);
    act(() => openView({ kind: "data-download", name: "monday-r2t6v" }));
    const workspace = await screen.findByTestId("velero-data-download-workspace");

    for (const button of within(workspace).getAllByRole("button")) {
      expect(button.getAttribute("data-testid") ?? "").toMatch(/^velero-(back|open-)/);
    }
    expect(workspace.querySelectorAll("input, select, textarea").length).toBe(0);
  });
});

describe("the sections of the details of the host", () => {
  it("of a data upload and of a data download say their phase, progress, owner and node, asking nothing", async () => {
    const shown = mount(answers(), () => null);

    await shown.installation.refresh();
    const before = shown.asked.length;

    render(
      <>
        <VolumeOperationDetails
          volume="DataUpload"
          object={hostObject(DataUpload, uploading)}
          extension={extension}
          installation={shown.installation}
        />
        <VolumeOperationDetails
          volume="DataDownload"
          object={hostObject(DataDownload, restoring)}
          extension={extension}
          installation={shown.installation}
        />
      </>,
    );
    const upload = screen.getByTestId("velero-data-upload-details");
    const download = screen.getByTestId("velero-data-download-details");

    expect(drawerValue("Progress", upload)).toBe("256.0 MiB of 512.0 MiB (50%)");
    expect(drawerValue("Backup", upload)).toContain("nightly");
    expect(drawerValue("Node", upload)).toBe("worker-2");
    expect(drawerValue("Restore", download)).toContain("monday");
    expect(drawerValue("Workspace", download)).toBe("Open among the data downloads of Velero");
    expect(shown.asked).toHaveLength(before);
  });
});
