// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hostObject } from "../../../test/freelens-extensions";
import { drawerValue } from "../../../test/host-components";
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
import { emptyPreferences, heldPreferences, RESOURCES } from "../../common/discovery";
import { LEFT_OUT } from "../../common/location-view";
import { NODE_AGENT_WORDS, REPOSITORY_WORDS, VOLUME_WORDS, WORKSPACE_WORDS } from "../../common/volume-words";
import { BackupRepository, PodVolumeBackup, PodVolumeRestore } from "../api/kinds";
import styles from "../components/views.module.css";
import { RepositoryDetails } from "../details/repository-details";
import { VolumeOperationDetails } from "../details/volume-operation-details";
import { closeViews, openView, openViews } from "../navigation";
import { Installation } from "../state/installation";
import { BackupsPage } from "./backups-page";
import { PodVolumeBackupsPage } from "./pod-volume-backups-page";
import { PodVolumeRestoresPage } from "./pod-volume-restores-page";
import { RepositoriesPage } from "./repositories-page";
import { RestoresPage } from "./restores-page";
import { SchedulesPage } from "./schedules-page";

import type { Renderer } from "@freelensapp/extensions";

import type { ReactNode } from "react";

import type { Answer, Family } from "../../common/discovery";

const DISCOVERY = "/apis/velero.io/v1";
const LOCATIONS = "/apis/velero.io/v1/backupstoragelocations";
const A = "velero";
const MiB = 1_048_576;
const extension = { name: "@freelensapp/velero-extension" } as unknown as Renderer.LensExtension;

type Answers = Record<string, Answer | (() => Promise<Answer>)>;

function path(family: Family, namespace = A): string {
  return `/apis/velero.io/v1/namespaces/${namespace}/${RESOURCES[family]}`;
}

function list(...items: unknown[]): Answer {
  return { status: 200, body: { items } };
}

const nightly = backup("nightly", "InProgress", { uid: "backup-nightly-2" });
const weekly = backup("weekly", "Completed", { uid: "backup-weekly-1" });
const monday = restore("monday", "InProgress", { uid: "restore-monday-1" });
const location = (name: string, accessMode = "ReadWrite") => ({
  metadata: { name, namespace: A, uid: `location-${name}` },
  spec: { provider: "aws", accessMode },
  status: { phase: "Available" },
});
const kopia = repository(
  "shop-default-kopia",
  {
    phase: "NotReady",
    message: 'error to connect "https://reader:secret@s3.example.test/store?token=abc"\nconnection refused',
    lastMaintenanceTime: before(8 * DAY),
    recentMaintenance: [
      { result: "Succeeded", startTimestamp: before(8 * DAY + 5 * MINUTE), completeTimestamp: before(8 * DAY) },
      {
        result: "Failed",
        startTimestamp: before(HOUR),
        completeTimestamp: before(HOUR - 2 * MINUTE),
        message: "out of space",
      },
      { result: "Succeeded", startTimestamp: before(15 * DAY + MINUTE), completeTimestamp: before(15 * DAY) },
    ],
  },
  { spec: { repositoryConfig: { cacheLimitMB: "2048" } } },
);
const restic = repository(
  "shop-archive-restic",
  { phase: "Ready", lastMaintenanceTime: before(DAY) },
  {
    spec: {
      backupStorageLocation: "archive",
      repositoryType: "restic",
      resticIdentifier: "s3:https://reader:secret@s3.example.test/store/restic/shop?token=abc",
    },
  },
);
const due = repository(
  "due-default-kopia",
  { phase: "Ready", lastMaintenanceTime: before(30 * DAY) },
  {
    spec: { volumeNamespace: "due" },
  },
);
const failed = podVolumeBackup(
  "nightly-failed",
  {
    phase: "Failed",
    message: "data path failed\nthe disk is full",
    acceptedTimestamp: before(9 * MINUTE),
    startTimestamp: before(7 * MINUTE),
    completionTimestamp: before(7 * MINUTE),
    progress: { bytesDone: 512 * MiB, totalBytes: 1024 * MiB },
  },
  {
    ...ownedBy("Backup", nightly),
    labels: { ...ownedBy("Backup", nightly).labels, "velero.io/pvc-uid": "claim-1" },
    annotations: { "velero.io/pvc-name": "data-cart-0" },
    spec: {
      repoIdentifier: "s3:https://reader:secret@s3.example.test/store/restic/shop?token=abc",
      uploaderSettings: { parallelFilesUpload: "4" },
    },
  },
);
const waiting = podVolumeBackup("nightly-waiting", { phase: "New" }, ownedBy("Backup", nightly));
const disagreeing = podVolumeBackup(
  "nightly-disagreeing",
  { phase: "Completed", incrementalBytes: MiB },
  {
    labels: ownedBy("Backup", nightly).labels,
    ownerReferences: ownedBy("Backup", weekly).ownerReferences,
  },
);
const later = podVolumeBackup("nightly-later", { phase: "InProgress", activities: [] } as never, {
  ...ownedBy("Backup", nightly),
  spec: { parentSnapshot: "a1", cancel: true } as never,
});
const restored = podVolumeRestore(
  "monday-accepted",
  { phase: "Accepted", node: "worker-3", acceptedTimestamp: before(2 * MINUTE) },
  ownedBy("Restore", monday),
);

function answers(more: Answers = {}): Answers {
  return {
    [DISCOVERY]: { status: 200, body: { resources: Object.values(RESOURCES).map((name) => ({ name })) } },
    [LOCATIONS]: list(location("default")),
    [path("backups")]: list(nightly, weekly),
    [path("restores")]: list(monday),
    [path("schedules")]: list(),
    [path("storageLocations")]: list(location("default"), location("archive", "ReadOnly")),
    [path("snapshotLocations")]: list(),
    [path("backupRepositories")]: list(kopia, restic, due),
    [path("podVolumeBackups")]: list(failed, waiting, disagreeing, later),
    [path("podVolumeRestores")]: list(restored),
    ...more,
  };
}

function installation(table: Answers, namespace = A) {
  const asked: string[] = [];
  const made = new Installation({
    cluster: { id: "cluster-a", name: "local-demo" },
    read: async (address) => {
      asked.push(address);
      const answer = table[address] ?? { status: 404 };

      return typeof answer === "function" ? answer() : answer;
    },
    now: () => NOW,
    storage: heldPreferences({ ...emptyPreferences(), selected: { "cluster-a": namespace } }),
  });

  return { installation: made, asked };
}

function mount(table: Answers, page: (installation: Installation) => ReactNode) {
  const made = installation(table);

  render(page(made.installation));
  return made;
}

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

beforeEach(() => {
  vi.setSystemTime(NOW);
});

afterEach(() => {
  act(() => closeViews());
  cleanup();
  vi.useRealTimers();
});

describe("the view of a backup repository", () => {
  it("says whether Velero can use it and why not, when it was last maintained, and when the next is due", async () => {
    mount(answers(), (made) => <RepositoriesPage installation={made} />);
    act(() => openView({ kind: "backup-repository", name: "shop-default-kopia" }));
    const workspace = await screen.findByTestId("velero-backup-repository-workspace");
    const status = within(workspace).getByTestId("velero-backup-repository-status");

    expect(value(status, "Readiness")).toBe("error_outlineNot ready");
    // The message whole, on its lines, an address in it shown as an address is.
    expect(note(status, "Readiness")).toBe(
      `error to connect "https://s3.example.test/store"\nconnection refused ${LEFT_OUT}`,
    );
    // Drawn on its lines, which the text alone does not prove.
    expect(styles.messageLines).toBeTruthy();
    expect(within(status).getByTestId("velero-repository-message").className).toBe(styles.messageLines);
    expect(value(status, "Last maintenance")).toBe(
      `${new Date(NOW - 8 * DAY).toLocaleString()} (8d ago)warning_amber, ${REPOSITORY_WORDS.newestFailed}`,
    );
    // The note as the operator reads it, once as a literal.
    expect(note(status, "Last maintenance")).toBe("The newest maintenance failed: this is the last that succeeded.");
    // Not ready: no maintenance runs, and nothing is computed of when it would.
    expect(value(status, "Next maintenance")).toBe(REPOSITORY_WORDS.notReadyNoMaintenance);
    expect(note(status, "Next maintenance")).toBe(`${REPOSITORY_WORDS.pass} ${REPOSITORY_WORDS.job}`);
    expect([value(status, "Installation"), note(status, "Installation")]).toEqual([A, "Cluster local-demo"]);
    expect(within(workspace).getByTestId("velero-backup-repository-what").textContent).toBe(REPOSITORY_WORDS.what);
  });

  it("says what it is of, with the storage location a way, its configuration, and its maintenances newest first", async () => {
    mount(answers(), (made) => <RepositoriesPage installation={made} />);
    act(() => openView({ kind: "backup-repository", name: "shop-default-kopia" }));
    const workspace = await screen.findByTestId("velero-backup-repository-workspace");
    const of = within(workspace).getByTestId("velero-backup-repository-of");

    expect([value(of, "Volume namespace"), value(of, "Storage location"), value(of, "Type")]).toEqual([
      "shop",
      "default",
      "kopia",
    ]);
    expect([value(of, "Maintenance frequency"), note(of, "Maintenance frequency")]).toEqual(["168h0m0s", "7d"]);
    expect(
      [...within(workspace).getByTestId("velero-backup-repository-config").querySelectorAll("tr")].map(
        (row) => row.textContent,
      ),
    ).toEqual(["cacheLimitMB2048"]);
    const maintenances = [
      ...within(workspace).getByTestId("velero-backup-repository-maintenances").querySelectorAll("tbody tr"),
    ];

    expect(maintenances.map((row) => [...row.querySelectorAll("td")].map((cell) => cell.textContent))).toEqual([
      [
        "Failed",
        new Date(NOW - HOUR).toLocaleString(),
        new Date(NOW - HOUR + 2 * MINUTE).toLocaleString(),
        "2m",
        "out of space",
      ],
      [
        "Succeeded",
        new Date(NOW - 8 * DAY - 5 * MINUTE).toLocaleString(),
        new Date(NOW - 8 * DAY).toLocaleString(),
        "5m",
        "",
      ],
      [
        "Succeeded",
        new Date(NOW - 15 * DAY - MINUTE).toLocaleString(),
        new Date(NOW - 15 * DAY).toLocaleString(),
        "1m",
        "",
      ],
    ]);
    fireEvent.click(within(of).getByTestId("velero-open-storage-location-default"));
    await screen.findByTestId("velero-storage-location-workspace");
    expect(openViews()).toEqual([
      { kind: "backup-repository", name: "shop-default-kopia" },
      { kind: "storage-location", name: "default" },
    ]);
  });

  it("shows the restic identifier as an address is shown, and says that none runs for a read-only location", async () => {
    mount(answers(), (made) => <RepositoriesPage installation={made} />);
    act(() => openView({ kind: "backup-repository", name: "shop-archive-restic" }));
    const workspace = await screen.findByTestId("velero-backup-repository-workspace");

    expect(within(workspace).getByTestId("velero-backup-repository-identifier").textContent).toBe(
      "s3:https://s3.example.test/store/restic/shop",
    );
    expect(within(workspace).getByTestId("velero-backup-repository-due").textContent).toBe(REPOSITORY_WORDS.readOnly);
    expect(workspace.textContent).toContain(REPOSITORY_WORDS.readOnly);
    expect(within(workspace).getByTestId("velero-backup-repository-maintenances").textContent).toBe(
      REPOSITORY_WORDS.noMaintenance,
    );
  });

  it("says that when the next maintenance is due is not known while the storage locations are denied", async () => {
    mount(answers({ [path("storageLocations")]: { status: 403 } }), (made) => <RepositoriesPage installation={made} />);
    act(() => openView({ kind: "backup-repository", name: "due-default-kopia" }));
    await screen.findByTestId("velero-backup-repository-workspace");
    await waitFor(() =>
      expect(screen.getByTestId("velero-backup-repository-due").getAttribute("data-due")).toBe("access-unknown"),
    );
    expect(screen.getByTestId("velero-backup-repository-due").textContent).toBe(REPOSITORY_WORDS.accessUnknown);
  });

  it("says that the next maintenance is due by the clock of this machine, and moves with it", async () => {
    mount(answers(), (made) => <RepositoriesPage installation={made} />);
    act(() => openView({ kind: "backup-repository", name: "due-default-kopia" }));
    const workspace = await screen.findByTestId("velero-backup-repository-workspace");

    expect(within(workspace).getByTestId("velero-backup-repository-due").textContent).toBe(
      "Due: the last maintenance is older than the frequency, by 23d, by the clock of this machine.",
    );
    expect(within(workspace).getByTestId("velero-backup-repository-due").getAttribute("data-due")).toBe("due");
  });

  it("says that a repository of that name is not there, and what is not known of one that cannot be read", async () => {
    mount(answers(), (made) => <RepositoriesPage installation={made} />);
    act(() => openView({ kind: "backup-repository", name: "gone" }));
    expect((await screen.findByTestId("velero-backup-repository-missing")).textContent).toBe(
      WORKSPACE_WORDS.missing("backup repository", A),
    );
    cleanup();
    mount(answers({ [path("backupRepositories")]: { status: 403 } }), (made) => (
      <RepositoriesPage installation={made} />
    ));
    act(() => openView({ kind: "backup-repository", name: "gone" }));
    expect((await screen.findByTestId("velero-backup-repository-unknown")).textContent).toBe(
      `${WORKSPACE_WORDS.denied("backup repositories", A)}${WORKSPACE_WORDS.unknownAfter}`,
    );
  });

  it("tells an object created again under the name from the one that was open, and says what was read before", async () => {
    let table = answers();
    const made = {
      installation: new Installation({
        cluster: { id: "cluster-a", name: "local-demo" },
        read: async (address) => {
          const answer = table[address] ?? { status: 404 };

          return typeof answer === "function" ? answer() : answer;
        },
        now: () => NOW,
        storage: heldPreferences({ ...emptyPreferences(), selected: { "cluster-a": A } }),
      }),
    };

    render(<RepositoriesPage installation={made.installation} />);
    act(() => openView({ kind: "backup-repository", name: "due-default-kopia" }));
    await screen.findByTestId("velero-backup-repository-workspace");
    table = answers({ [path("backupRepositories")]: list({ ...due, metadata: { ...due.metadata, uid: "again" } }) });
    await act(async () => {
      await made.installation.refresh();
    });
    expect(await screen.findByTestId("velero-backup-repository-replaced")).toBeTruthy();
    table = answers({ [path("backupRepositories")]: { status: 500 } });
    await act(async () => {
      await made.installation.refresh();
    });
    expect(screen.getByTestId("velero-backup-repository-stale").textContent).toContain(
      WORKSPACE_WORDS.stale("backup repositories"),
    );
  });
});

describe("the view of a pod volume operation", () => {
  it("says where it is, what it moved and when, the message whole on its lines", async () => {
    mount(answers(), (made) => <PodVolumeBackupsPage installation={made} />);
    act(() => openView({ kind: "pod-volume-backup", name: "nightly-failed" }));
    const workspace = await screen.findByTestId("velero-pod-volume-backup-workspace");
    const status = within(workspace).getByTestId("velero-pod-volume-backup-status");

    expect(value(status, "Phase")).toBe("highlight_offFailed");
    expect(note(status, "Phase")).toContain("Finished, ran or not started, as its times say, failed.");
    expect(note(status, "Phase")).toContain("A start equal to the completion is one the failure wrote");
    expect(within(status).getByTestId("velero-volume-message").textContent).toBe("data path failed\nthe disk is full");
    expect([value(status, "Accepted"), value(status, "Started"), value(status, "Completed")]).toEqual([
      new Date(NOW - 9 * MINUTE).toLocaleString(),
      new Date(NOW - 7 * MINUTE).toLocaleString(),
      new Date(NOW - 7 * MINUTE).toLocaleString(),
    ]);
    expect([value(status, "Duration"), note(status, "Duration")]).toEqual([
      "No duration: the start is the completion",
      "The start is the completion: a time the failure or the cancellation wrote, not a duration of the work.",
    ]);
    expect(within(status).getByTestId("velero-volume-bytes").textContent).toBe("512.0 MiB of 1.0 GiB (50%)");
    expect(within(status).getByRole("progressbar").getAttribute("aria-valuenow")).toBe("50");
    expect(within(status).getByTestId("velero-volume-incremental").textContent).toBe("Not reported");
    expect(within(status).queryByTestId("velero-volume-snapshot-size")).toBeNull();
  });

  it("leads to its backup and back, to its storage location and to its repository, and says what it is of", async () => {
    mount(answers(), (made) => <PodVolumeBackupsPage installation={made} />);
    act(() => openView({ kind: "pod-volume-backup", name: "nightly-failed" }));
    const workspace = await screen.findByTestId("velero-pod-volume-backup-workspace");
    const belongs = within(workspace).getByTestId("velero-volume-belongs");

    expect(value(belongs, "Backup")).toBe("nightly (In progress)");
    expect(value(belongs, "Storage location")).toBe("default");
    expect(value(belongs, "Repository")).toBe("shop-default-kopia");
    const of = within(workspace).getByTestId("velero-volume-of");
    const pod = within(of).getByText("cart-0").closest("a") as HTMLAnchorElement;
    const node = within(of).getByText("worker-1").closest("a") as HTMLAnchorElement;

    expect(new URL(pod.href).searchParams.get("kube-details")).toBe("/api/v1/namespaces/shop/pods/cart-0");
    expect(new URL(node.href).searchParams.get("kube-details")).toBe("/api/v1/nodes/worker-1");
    expect(note(of, "Pod")).toBe(`UID pod-cart-0. ${VOLUME_WORDS.hostResolves}`);
    expect([value(of, "Volume"), value(of, "Claim")]).toEqual(["data", "data-cart-0, UID claim-1"]);
    expect(note(of, "Node")).toBe(VOLUME_WORDS.nodeNote.PodVolumeBackup);
    const settings = within(workspace).getByTestId("velero-volume-settings");

    expect(value(settings, "Uploader")).toBe("kopia");
    expect(value(settings, "Uploader settings")).toBe("parallelFilesUpload: 4");
    expect([value(settings, "Repository identifier"), note(settings, "Repository identifier")]).toEqual([
      "s3:https://s3.example.test/store/restic/shop",
      LEFT_OUT,
    ]);
    expect(value(settings, "Tags")).toBe("backup: nightly, ns: shop, pod: cart-0, volume: data");
    expect(value(settings, "Cancellation")).toBe(VOLUME_WORDS.cancelNotAsked);
    fireEvent.click(within(belongs).getByTestId("velero-open-backup-nightly"));
    await screen.findByTestId("velero-backup-workspace");
    fireEvent.click(screen.getByTestId("velero-back"));
    await screen.findByTestId("velero-pod-volume-backup-workspace");
    expect(openViews()).toEqual([{ kind: "pod-volume-backup", name: "nightly-failed" }]);
  });

  it("says what an operation that did not start waits for, which is no failure", async () => {
    mount(answers(), (made) => <PodVolumeBackupsPage installation={made} />);
    act(() => openView({ kind: "pod-volume-backup", name: "nightly-waiting" }));
    const workspace = await screen.findByTestId("velero-pod-volume-backup-workspace");
    const status = within(workspace).getByTestId("velero-pod-volume-backup-status");

    expect(note(status, "Phase")).toBe(`In flight, not started, no outcome yet. ${NODE_AGENT_WORDS.PodVolumeBackup}`);
    expect([value(status, "Started"), value(status, "Duration")]).toEqual(["Not started", "Not started"]);
    expect(status.querySelector("[data-outcome]")?.getAttribute("data-outcome")).toBe("none");
  });

  it("says the owner reference that names another backup than its labels, and the fields the release does not write", async () => {
    mount(answers(), (made) => <PodVolumeBackupsPage installation={made} />);
    act(() => openView({ kind: "pod-volume-backup", name: "nightly-disagreeing" }));
    let workspace = await screen.findByTestId("velero-pod-volume-backup-workspace");

    expect(note(within(workspace).getByTestId("velero-volume-belongs"), "Backup")).toBe(
      "Its owner reference names the backup weekly of UID backup-weekly-1, which its labels do not name",
    );
    expect(within(workspace).getByTestId("velero-volume-incremental").textContent).toBe("1.0 MiB");
    act(() => openView({ kind: "pod-volume-backup", name: "nightly-later" }));
    workspace = await screen.findByTestId("velero-pod-volume-backup-workspace");
    await waitFor(() =>
      expect(within(workspace).getByTestId("velero-pod-volume-backup-name").textContent).toBe("nightly-later"),
    );
    expect(within(workspace).getByTestId("velero-volume-unknown-fields").textContent).toBe(
      VOLUME_WORDS.unknownFields(["spec.parentSnapshot", "status.activities"]),
    );
    expect(value(within(workspace).getByTestId("velero-volume-settings"), "Cancellation")).toBe(
      VOLUME_WORDS.cancelAsked,
    );
  });

  it("of a pod volume restore says its node from its status, its snapshot size and its source namespace", async () => {
    mount(answers(), (made) => <PodVolumeRestoresPage installation={made} />);
    act(() => openView({ kind: "pod-volume-restore", name: "monday-accepted" }));
    const workspace = await screen.findByTestId("velero-pod-volume-restore-workspace");
    const status = within(workspace).getByTestId("velero-pod-volume-restore-status");

    expect([value(status, "Waiting"), note(status, "Waiting")]).toEqual([
      "Waiting 2m",
      "Since a node agent accepted it. The node agent fails it after its preparing timeout, which the view does not read.",
    ]);
    expect(within(status).getByTestId("velero-volume-snapshot-size").textContent).toBe("1.0 MiB");
    expect(within(status).queryByTestId("velero-volume-incremental")).toBeNull();
    const of = within(workspace).getByTestId("velero-volume-of");

    expect(value(of, "Node")).toBe("worker-3");
    expect(note(of, "Node")).toBe(VOLUME_WORDS.nodeNote.PodVolumeRestore);
    expect(value(within(workspace).getByTestId("velero-volume-belongs"), "Restore")).toBe("monday (In progress)");
    expect(value(within(workspace).getByTestId("velero-volume-settings"), "Source namespace")).toBe("shop");
  });

  it("gives no control that writes: every button is a way, every link one of the host to its details", async () => {
    mount(answers(), (made) => <PodVolumeBackupsPage installation={made} />);
    act(() => openView({ kind: "pod-volume-backup", name: "nightly-failed" }));
    const workspace = await screen.findByTestId("velero-pod-volume-backup-workspace");

    for (const control of workspace.querySelectorAll("button, a, input, select, textarea, [role='menu']")) {
      const testId = control.getAttribute("data-testid") ?? "";
      const way =
        testId === "velero-back" ||
        testId.startsWith("velero-open-") ||
        (control.tagName === "A" && (control.getAttribute("href") ?? "").includes("kube-details="));

      expect([control.outerHTML.slice(0, 80), way]).toEqual([control.outerHTML.slice(0, 80), true]);
    }
  });
});

describe("the sections of the details of the host", () => {
  it("of a repository agree with its row and lead to its view, asking nothing of the cluster", () => {
    const { installation: made, asked } = installation(answers());

    render(
      <RepositoryDetails object={hostObject(BackupRepository, kopia)} extension={extension} installation={made} />,
    );
    const section = screen.getByTestId("velero-backup-repository-details");

    expect(drawerValue("Readiness", section)).toBe(
      "error_outlineNot ready " + 'error to connect "https://s3.example.test/store"\nconnection refused',
    );
    expect(drawerValue("Last maintenance", section)).toBe(
      `${new Date(NOW - 8 * DAY).toLocaleString()} (8d ago)warning_amber, ${REPOSITORY_WORDS.newestFailed}`,
    );
    expect(drawerValue("Workspace", section)).toBe("Open among the backup repositories of Velero");
    expect(asked).toEqual([]);
  });

  it("of an operation say its phase, its progress, its owner as the views last read it, and its node, asking nothing", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"], now: NOW });
    const { installation: made, asked } = installation(answers());

    await made.refresh();
    const before = asked.length;
    const shown = render(
      <VolumeOperationDetails
        volume="PodVolumeBackup"
        object={hostObject(PodVolumeBackup, failed)}
        extension={extension}
        installation={made}
      />,
    );
    const section = screen.getByTestId("velero-pod-volume-backup-details");

    expect(drawerValue("Phase", section)).toBe("Failed (Finished, ran or not started, as its times say, failed)");
    expect(drawerValue("Progress", section)).toBe("512.0 MiB of 1.0 GiB (50%)");
    // No view keeps the reads fresh: how old the one the owner was found in is, is said.
    expect(drawerValue("Backup", section)).toBe(
      "nightly. Found among the backups of the installation as they were read 0s ago, when a view of Velero was last open.",
    );
    expect(drawerValue("Node", section)).toBe("worker-1");
    expect(drawerValue("Workspace", section)).toBe("Open among the pod volume backups of Velero");
    expect(asked).toHaveLength(before);
    expect(vi.getTimerCount()).toBe(1);
    shown.unmount();
    // Its clock ends with it.
    expect(vi.getTimerCount()).toBe(0);
  });

  it("of an operation of another installation say its owner by name, and that it was not looked for", () => {
    const { installation: made } = installation(answers(), "velero-other");
    const elsewhere = podVolumeRestore("monday-x", { phase: "Completed" }, ownedBy("Restore", monday));

    render(
      <VolumeOperationDetails
        volume="PodVolumeRestore"
        object={hostObject(PodVolumeRestore, elsewhere)}
        extension={extension}
        installation={made}
      />,
    );
    const section = screen.getByTestId("velero-pod-volume-restore-details");

    expect(drawerValue("Restore", section)).toBe(`monday. ${VOLUME_WORDS.otherInstallation("restores")}`);
    expect(drawerValue("Workspace", section)).toBe(
      "Select velero among the pod volume restores of Velero to open it there",
    );
  });
});

describe("the notices over a view", () => {
  // A view says what is missing of the families it shows something of, and of no other.
  const daily = {
    metadata: { name: "daily", namespace: A, uid: "schedule-daily" },
    spec: { schedule: "0 1 * * *", template: {} },
    status: { phase: "Enabled" },
  };

  it("say nothing of the denied repositories over a backup, a restore and a schedule, and say it over their list", async () => {
    const denied = answers({ [path("backupRepositories")]: { status: 403 }, [path("schedules")]: list(daily) });

    for (const [kind, name, page] of [
      ["backup", "nightly", (made: Installation) => <BackupsPage installation={made} />],
      ["restore", "monday", (made: Installation) => <RestoresPage installation={made} />],
      ["schedule", "daily", (made: Installation) => <SchedulesPage installation={made} />],
    ] as const) {
      const { installation: made } = mount(denied, page);

      act(() => openView({ kind, name }));
      await screen.findByTestId(`velero-${kind}-workspace`);
      await waitFor(() => expect(made.read("backupRepositories").status).toBe("forbidden"));
      await act(async () => {});
      expect([kind, screen.queryByTestId("velero-notice-backupRepositories")]).toEqual([kind, null]);
      act(() => closeViews());
      cleanup();
    }
    mount(denied, (made) => <RepositoriesPage installation={made} />);
    expect((await screen.findByTestId("velero-notice-backupRepositories")).textContent).toContain("access is denied");
  });

  it("say nothing of the denied restores over a pod volume backup, and say it over a pod volume restore", async () => {
    const denied = answers({ [path("restores")]: { status: 403 } });
    const { installation: made } = mount(denied, (made) => <PodVolumeBackupsPage installation={made} />);

    act(() => openView({ kind: "pod-volume-backup", name: "nightly-failed" }));
    await screen.findByTestId("velero-pod-volume-backup-workspace");
    await waitFor(() => expect(made.read("restores").status).toBe("forbidden"));
    await act(async () => {});
    expect(screen.queryByTestId("velero-notice-restores")).toBeNull();
    act(() => closeViews());
    cleanup();
    mount(denied, (made) => <PodVolumeRestoresPage installation={made} />);
    act(() => openView({ kind: "pod-volume-restore", name: restored.metadata.name }));
    await screen.findByTestId("velero-pod-volume-restore-workspace");
    expect((await screen.findByTestId("velero-notice-restores")).textContent).toContain("access is denied");
  });
});
