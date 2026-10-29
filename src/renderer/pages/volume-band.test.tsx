// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { runInAction } from "mobx";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  backup,
  before,
  DAY,
  MINUTE,
  NOW,
  ownedBy,
  podVolumeBackup,
  podVolumeRestore,
  read,
  repository,
  restore,
} from "../../../test/volume-builders";
import { emptyPreferences, heldPreferences, RESOURCES } from "../../common/discovery";
import { operationState } from "../../common/phases";
import { BAND_WORDS, bandSentence, REPOSITORY_WORDS, USED_BY_WORDS } from "../../common/volume-words";
import { UsedBy, VolumeBand } from "../components/volume-band";
import { closeView, closeViews, openView, openViews } from "../navigation";
import { Installation, READ_EVERY } from "../state/installation";
import { BackupsPage } from "./backups-page";
import { RepositoriesPage } from "./repositories-page";
import { RestoresPage } from "./restores-page";

import type { ReactNode } from "react";

import type { Answer, Family } from "../../common/discovery";
import type { ReadStatus } from "../../common/read-state";
import type { Resource } from "../state/installation";

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

const nightly = backup("nightly", "InProgress", { uid: "backup-nightly-2" });
const failing = backup("failing", "PartiallyFailed", { uid: "backup-failing-1" });
const monday = restore("monday", "InProgress", { uid: "restore-monday-1" });
const location = (name: string) => ({
  metadata: { name, namespace: A, uid: `location-${name}` },
  spec: { provider: "aws", accessMode: "ReadWrite" },
  status: { phase: "Available" },
});
const kopia = repository("shop-default-kopia", { phase: "Ready", lastMaintenanceTime: before(DAY) });

// The operations of the backup at work, each of its own pod, from the newest: one started a minute later than the
// one after it.
const many = Array.from({ length: 23 }, (_, at) =>
  podVolumeBackup(
    `nightly-${String(at).padStart(2, "0")}`,
    {
      phase: at === 0 ? "InProgress" : at === 1 ? "Failed" : "Completed",
      startTimestamp: before((at + 1) * MINUTE),
      ...(at === 1 ? { message: "data path failed\nthe disk is full" } : {}),
      ...(at === 0 ? { progress: { bytesDone: 512, totalBytes: 1024 } } : {}),
    },
    {
      ...ownedBy("Backup", nightly),
      spec: { pod: { kind: "Pod", namespace: "shop", name: `cart-${at}`, uid: `pod-cart-${at}` } },
    },
  ),
);
const restored = podVolumeRestore("monday-a", { phase: "Canceling" }, ownedBy("Restore", monday));
const finished = podVolumeRestore("monday-b", { phase: "Completed" }, ownedBy("Restore", monday));

function answers(more: Answers = {}): Answers {
  return {
    [DISCOVERY]: { status: 200, body: { resources: Object.values(RESOURCES).map((name) => ({ name })) } },
    [LOCATIONS]: list(location("default")),
    [path("backups")]: list(nightly, failing),
    [path("restores")]: list(monday),
    [path("schedules")]: list(),
    [path("storageLocations")]: list(location("default")),
    [path("snapshotLocations")]: list(),
    [path("backupRepositories")]: list(kopia),
    [path("podVolumeBackups")]: list(...many),
    [path("podVolumeRestores")]: list(restored, finished),
    ...more,
  };
}

function installation(table: Answers) {
  const asked: string[] = [];
  const made = new Installation({
    cluster: { id: "cluster-a", name: "local-demo" },
    read: async (address) => {
      asked.push(address);
      const answer = table[address] ?? { status: 404 };

      return typeof answer === "function" ? answer() : answer;
    },
    now: () => NOW,
    storage: heldPreferences({ ...emptyPreferences(), selected: { "cluster-a": A } }),
  });

  return { installation: made, asked, table };
}

function mount(table: Answers, page: (installation: Installation) => ReactNode) {
  const made = installation(table);

  render(page(made.installation));
  return made;
}

const band = () => screen.getByTestId("velero-volume-band");
const rows = () => [...band().querySelectorAll("tbody tr")].map((row) => row.getAttribute("data-operation"));
const count = (asked: string[], family: Family) => asked.filter((one) => one === path(family)).length;
// The counts of the groups as they are read, each beside its mark, whose name the host draws as an icon.
const groups = (of: HTMLElement) =>
  [...within(of).getByTestId("velero-volume-groups").querySelectorAll("li")].map((group) => [
    group.getAttribute("data-phase"),
    group.lastElementChild?.textContent,
  ]);

async function opened(kind: "backup" | "restore", name: string) {
  act(() => openView({ kind, name }));
  await screen.findByTestId(`velero-${kind}-workspace`);
  await waitFor(() => expect(band().getAttribute("data-state")).toBe("rows"));
}

beforeEach(() => {
  vi.setSystemTime(NOW);
});

afterEach(() => {
  act(() => closeViews());
  cleanup();
  vi.useRealTimers();
});

describe("the band of the volume operations of a backup", () => {
  it("lists them from the newest, counted in the groups of backup describe, each a way to its view and back", async () => {
    mount(answers(), (made) => <BackupsPage installation={made} />);
    await opened("backup", "nightly");
    const summary = screen.getByTestId("velero-backup-workspace");

    // After the status and its stale notice, before the current stage.
    expect(band().previousElementSibling?.getAttribute("data-testid")).toBe("velero-backup-status");
    expect(band().nextElementSibling?.textContent).toBe("Current stage");
    expect(within(band()).getByRole("heading").textContent).toBe("Volumes");
    expect(within(band()).getByTestId("velero-volume-sentence").textContent).toBe(
      "The pod volume backups run while the backup is InProgress: it waits for all of them, and at its own timeout asks the ones that have not ended to cancel.",
    );
    expect(within(band()).getByTestId("velero-volume-count").textContent).toBe(
      "23 pod volume backups, from the newest",
    );
    expect(groups(band())).toEqual([
      ["Completed", "Completed: 21"],
      ["Failed", "Failed: 1"],
      ["InProgress", "In progress: 1"],
    ]);
    // Ten at first, from the newest.
    expect(rows()).toEqual(many.slice(0, 10).map((operation) => operation.metadata.name));
    const first = band().querySelector("tbody tr") as HTMLElement;

    expect([...first.querySelectorAll("td")].map((cell) => cell.textContent)).toEqual([
      "data",
      "cart-0",
      "autorenewIn progress",
      "512 B of 1.0 KiB (50%)",
      "worker-1",
    ]);
    expect(first.querySelector("[data-pod]")?.getAttribute("data-pod")).toBe("shop/cart-0");
    // The way is the row's, to the view of the operation, which returns to the backup.
    const way = within(first).getByTestId("velero-open-pod-volume-backup-nightly-00");

    expect(way.getAttribute("title")).toBe(BAND_WORDS.way("pod volume backup", "nightly-00"));
    // Its name begins with the volume the column shows, and says which operation it opens.
    expect(way.getAttribute("aria-label")).toBe("data: Open the pod volume backup nightly-00");
    fireEvent.click(way);
    await screen.findByTestId("velero-pod-volume-backup-workspace");
    expect(openViews()).toEqual([
      { kind: "backup", name: "nightly" },
      { kind: "pod-volume-backup", name: "nightly-00" },
    ]);
    act(() => closeView());
    await screen.findByTestId("velero-backup-workspace");
    expect(openViews()).toEqual([{ kind: "backup", name: "nightly" }]);
    // The band says nothing of the items: the item progress keeps its own fact and note (scenario 1).
    expect(band().textContent).not.toContain("item");
    expect(within(summary).getByTestId("velero-backup-progress")).toBeTruthy();
  });

  it("shows ten more at each command, with the focus on the first it added, until there are none", async () => {
    mount(answers(), (made) => <BackupsPage installation={made} />);
    await opened("backup", "nightly");
    const more = () => within(band()).queryByTestId("velero-volume-more");

    expect(more()?.textContent).toBe("Show ten more");
    fireEvent.click(more() as HTMLElement);
    await waitFor(() => expect(rows()).toHaveLength(20));
    expect(document.activeElement?.getAttribute("data-way")).toBe("nightly-10");
    fireEvent.click(more() as HTMLElement);
    await waitFor(() => expect(rows()).toHaveLength(23));
    expect(document.activeElement?.getAttribute("data-way")).toBe("nightly-20");
    expect(more()).toBeNull();
    // No control of the band writes: its rows are ways, and its one command pages them.
    expect(
      [...band().querySelectorAll("button")].every(
        (button) => button.hasAttribute("data-way") || button.getAttribute("data-testid") === "velero-volume-more",
      ),
    ).toBe(true);
  });

  it("counts one failed with its message in the tip of its row, beside the failure of the backup (scenario 2)", async () => {
    const broken = podVolumeBackup(
      "failing-a",
      { phase: "Failed", message: "data path failed\nthe disk is full" },
      ownedBy("Backup", failing),
    );

    mount(answers({ [path("podVolumeBackups")]: list(broken) }), (made) => <BackupsPage installation={made} />);
    await opened("backup", "failing");
    const row = band().querySelector('[data-operation="failing-a"]') as HTMLElement;

    expect(groups(band())).toEqual([["Failed", "Failed: 1"]]);
    // The tip of the phase is the message of Velero, whole.
    const pointed = row.querySelectorAll("td")[2].querySelector("[id^='tooltip_target_']") as HTMLElement;

    fireEvent.mouseEnter(pointed);
    expect(screen.getByRole("tooltip").textContent).toBe("data path failed\nthe disk is full");
    fireEvent.mouseLeave(pointed);
    // The failure of the backup itself stays where the status says it.
    expect(screen.getByTestId("velero-backup-status").textContent).toContain("Partially failed");
  });

  it("says that a backup has none among the ones the installation holds, and what was not read is not none", async () => {
    mount(answers({ [path("podVolumeBackups")]: list() }), (made) => <BackupsPage installation={made} />);
    await opened("backup", "nightly");

    expect(within(band()).getByTestId("velero-volume-state").textContent).toBe(
      "This backup has no pod volume backup among the ones the installation holds.",
    );
    expect(within(band()).queryByTestId("velero-volume-count")).toBeNull();
  });

  it("gives no count and no row when the family is denied, and the notice over the view says it", async () => {
    const { installation: made } = mount(answers({ [path("podVolumeBackups")]: { status: 403 } }), (made) => (
      <BackupsPage installation={made} />
    ));

    act(() => openView({ kind: "backup", name: "nightly" }));
    await screen.findByTestId("velero-backup-workspace");
    await waitFor(() => expect(made.read("podVolumeBackups").status).toBe("forbidden"));
    expect(band().getAttribute("data-state")).toBe("denied");
    expect(within(band()).getByTestId("velero-volume-state").textContent).toBe(
      "The pod volume backups of this installation cannot be read: access is denied. How many this backup has is not known.",
    );
    expect([within(band()).queryByTestId("velero-volume-count"), band().querySelector("tbody")]).toEqual([null, null]);
    expect((await screen.findByTestId("velero-notice-podVolumeBackups")).textContent).toContain("access is denied");
  });

  it("says once that the operations are being read, and keeps the rows of an earlier read with when", async () => {
    let answer: (value: Answer) => void = () => undefined;
    const table = answers({ [path("podVolumeBackups")]: () => new Promise<Answer>((resolve) => (answer = resolve)) });
    const { installation: made } = mount(table, (made) => <BackupsPage installation={made} />);

    act(() => openView({ kind: "backup", name: "nightly" }));
    await screen.findByTestId("velero-backup-workspace");
    await waitFor(() => expect(band().getAttribute("data-state")).toBe("loading"));
    const words = BAND_WORDS.loading("pod volume backups");

    expect(words).toBe("The pod volume backups of the installation are being read.");
    expect(screen.getByTestId("velero-backup-workspace").textContent?.split(words)).toHaveLength(2);
    await act(async () => answer(list(...many.slice(0, 2))));
    await waitFor(() => expect(rows()).toEqual(["nightly-00", "nightly-01"]));
    table[path("podVolumeBackups")] = { status: 500 };
    await act(() => made.refresh());
    expect(rows()).toEqual(["nightly-00", "nightly-01"]);
    expect(within(band()).getByTestId("velero-volume-stale").textContent).toBe(
      `The pod volume backups could not be read again: these are the ones read at ${new Date(NOW).toLocaleTimeString()}.`,
    );
  });
});

describe("the band in each state of the read of its family", () => {
  const owner = backup("nightly", "Completed", { uid: "backup-nightly-2" });
  const mine = podVolumeBackup("nightly-a", { phase: "Completed" }, ownedBy("Backup", owner));

  it.each([
    [
      "idle",
      [],
      undefined,
      "not-read",
      "The pod volume backups of this installation were not read yet: how many this backup has is not known.",
    ],
    ["loading", [], undefined, "loading", "The pod volume backups of the installation are being read."],
    [
      "forbidden",
      [],
      undefined,
      "denied",
      "The pod volume backups of this installation cannot be read: access is denied. How many this backup has is not known.",
    ],
    [
      "failed",
      [],
      undefined,
      "failed",
      "The pod volume backups of this installation could not be read. How many this backup has is not known.",
    ],
    ["not-served", [], undefined, "not-served", "The cluster does not serve the pod volume backups of Velero."],
    ["ready", [], NOW, "rows", "This backup has no pod volume backup among the ones the installation holds."],
    ["failed", [mine], NOW - MINUTE, "rows", undefined],
    ["forbidden", [mine], NOW - MINUTE, "rows", undefined],
    ["not-served", [mine], NOW - MINUTE, "rows", undefined],
  ] as const)("says what is known when the read is %s", (status, items, lastSuccess, state, words) => {
    const made = installation({}).installation;

    runInAction(() => {
      made.reads = {
        ...made.reads,
        podVolumeBackups: read(items as unknown as Resource[], status as ReadStatus, lastSuccess),
      };
    });
    render(
      <VolumeBand installation={made} kind="Backup" owner={owner} state={operationState("Backup", "Completed")} />,
    );
    expect(band().getAttribute("data-state")).toBe(state);
    expect(screen.queryByTestId("velero-volume-state")?.textContent).toBe(words);
    // A family of an earlier read keeps its rows and says when.
    expect([screen.queryByTestId("velero-volume-stale") !== null, rows()]).toEqual(
      lastSuccess === NOW - MINUTE ? [true, ["nightly-a"]] : [false, []],
    );
    expect(screen.getByTestId("velero-volume-sentence").textContent).toBe(
      bandSentence("Backup", operationState("Backup", "Completed")),
    );
  });
});

describe("the band of the volume operations of a restore", () => {
  it("lists its pod volume restores in the groups of restore describe, Canceling after them", async () => {
    mount(answers(), (made) => <RestoresPage installation={made} />);
    await opened("restore", "monday");

    expect(band().getAttribute("data-kind")).toBe("PodVolumeRestore");
    expect(within(band()).getByTestId("velero-volume-sentence").textContent).toBe(
      "The node agent of the node of each restored pod takes its pod volume restore when the init container restore-wait of that pod runs.",
    );
    expect(groups(band())).toEqual([
      ["Completed", "Completed: 1"],
      ["Canceling", "Canceling: 1"],
    ]);
    fireEvent.click(within(band()).getByTestId("velero-open-pod-volume-restore-monday-a"));
    await screen.findByTestId("velero-pod-volume-restore-workspace");
    expect(openViews().map((view) => view.kind)).toEqual(["restore", "pod-volume-restore"]);
  });
});

describe("the reads of the views of a backup and of a restore", () => {
  it("keep the family from a backup to one of its operations, and let it go at the read after the way closes", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const { asked, installation: made } = mount(answers(), (made) => <BackupsPage installation={made} />);

    await opened("backup", "nightly");
    expect([count(asked, "podVolumeBackups"), count(asked, "podVolumeRestores")]).toEqual([1, 0]);
    fireEvent.click(screen.getByTestId("velero-open-pod-volume-backup-nightly-00"));
    await screen.findByTestId("velero-pod-volume-backup-workspace");
    // The operation opened from the band finds its family read: nothing between the two let it go.
    expect(made.read("podVolumeBackups").status).toBe("ready");
    expect(screen.getByTestId("velero-pod-volume-backup-workspace").querySelector(".Spinner")).toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(READ_EVERY);
    });
    expect([count(asked, "podVolumeBackups"), count(asked, "podVolumeRestores")]).toEqual([2, 0]);
    act(() => closeViews());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2 * READ_EVERY);
    });
    expect(count(asked, "podVolumeBackups")).toBe(2);
    expect(made.read("podVolumeBackups")).toEqual({ status: "idle", items: [] });
  });

  it("hold the family of every view of the way: an operation, its storage location, then back twice", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const { asked, installation: made } = mount(answers(), (made) => <BackupsPage installation={made} />);

    await opened("backup", "nightly");
    fireEvent.click(screen.getByTestId("velero-open-pod-volume-backup-nightly-00"));
    const operation = await screen.findByTestId("velero-pod-volume-backup-workspace");

    fireEvent.click(within(operation).getByTestId("velero-open-storage-location-default"));
    await screen.findByTestId("velero-storage-location-workspace");
    // The location reads neither family; the views under it do, and the way back leads to them.
    for (const reads of [2, 3]) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(READ_EVERY);
      });
      expect(count(asked, "podVolumeBackups")).toBe(reads);
      expect(made.read("podVolumeBackups").status).toBe("ready");
    }
    act(() => closeView());
    const back = await screen.findByTestId("velero-pod-volume-backup-workspace");

    // No spinner of a family asked again: the view of the operation is drawn from what was kept.
    expect(back.querySelector(".Spinner")).toBeNull();
    expect(within(back).getByTestId("velero-pod-volume-backup-name").textContent).toBe("nightly-00");
    act(() => closeView());
    await screen.findByTestId("velero-backup-workspace");
    expect(band().getAttribute("data-state")).toBe("rows");
    expect(rows()).toHaveLength(10);
    expect(count(asked, "podVolumeRestores")).toBe(0);
  });

  it("hold the family of the first view of the way: a repository, a pod volume backup it names, its location", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const { asked, installation: made } = mount(answers(), (made) => <RepositoriesPage installation={made} />);

    act(() => openView({ kind: "backup-repository", name: "shop-default-kopia" }));
    const kept = await screen.findByTestId("velero-backup-repository-workspace");

    fireEvent.click(await within(kept).findByTestId("velero-open-pod-volume-backup-nightly-00"));
    const operation = await screen.findByTestId("velero-pod-volume-backup-workspace");

    fireEvent.click(within(operation).getByTestId("velero-open-storage-location-default"));
    await screen.findByTestId("velero-storage-location-workspace");
    const start = count(asked, "podVolumeRestores");

    // Only the repository, under the two views on top, reads the pod volume restores.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(READ_EVERY);
    });
    expect(count(asked, "podVolumeRestores")).toBe(start + 1);
    expect(made.read("podVolumeRestores").status).toBe("ready");
  });

  it("hold the family of a view in the middle of the way: a pod volume restore, its repository, its location", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const { asked, installation: made } = mount(answers(), (made) => <RestoresPage installation={made} />);

    act(() => openView({ kind: "pod-volume-restore", name: "monday-a" }));
    const operation = await screen.findByTestId("velero-pod-volume-restore-workspace");

    fireEvent.click(await within(operation).findByTestId("velero-open-backup-repository-shop-default-kopia"));
    const kept = await screen.findByTestId("velero-backup-repository-workspace");

    fireEvent.click(await within(kept).findByTestId("velero-open-storage-location-default"));
    await screen.findByTestId("velero-storage-location-workspace");
    const start = count(asked, "podVolumeBackups");

    // Only the repository, between the first view and the one on top, reads the pod volume backups.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(READ_EVERY);
    });
    expect(count(asked, "podVolumeBackups")).toBe(start + 1);
    expect(made.read("podVolumeBackups").status).toBe("ready");
  });
});

describe("what used a repository", () => {
  it("is counted by kind and by phase, with the newest of each and the backups and restores they belong to", async () => {
    mount(answers(), (made) => <RepositoriesPage installation={made} />);
    act(() => openView({ kind: "backup-repository", name: "shop-default-kopia" }));
    const workspace = await screen.findByTestId("velero-backup-repository-workspace");
    const used = () => within(workspace).getByTestId("velero-used-by");

    await waitFor(() =>
      expect(within(used()).getByTestId("velero-used-by-pod-volume-backup").getAttribute("data-state")).toBe("rows"),
    );
    // The last band of the view, after its maintenances.
    expect(workspace.lastElementChild).toBe(used());
    const backups = within(used()).getByTestId("velero-used-by-pod-volume-backup");
    const restores = within(used()).getByTestId("velero-used-by-pod-volume-restore");

    expect(within(backups).getByTestId("velero-used-by-count").textContent).toBe("23 pod volume backups");
    expect(groups(backups)).toEqual([
      ["Completed", "Completed: 21"],
      ["Failed", "Failed: 1"],
      ["InProgress", "In progress: 1"],
    ]);
    expect(within(backups).getByTestId("velero-open-pod-volume-backup-nightly-00").textContent).toBe("nightly-00");
    expect(within(backups).getByTestId("velero-used-by-owners").textContent).toBe("nightly");
    // The repository of the restores is the one of their source namespace, location and type.
    expect(within(restores).getByTestId("velero-used-by-count").textContent).toBe("2 pod volume restores");
    expect(within(restores).getByTestId("velero-used-by-owners").textContent).toBe("monday");
    fireEvent.click(within(restores).getByTestId("velero-open-restore-monday"));
    await screen.findByTestId("velero-restore-workspace");
    expect(openViews().map((view) => view.kind)).toEqual(["backup-repository", "restore"]);
  });

  it("counts the kinds it could read and names the one it could not, and says nothing used it when all were read", async () => {
    mount(answers({ [path("podVolumeRestores")]: { status: 403 } }), (made) => (
      <RepositoriesPage installation={made} />
    ));
    act(() => openView({ kind: "backup-repository", name: "shop-default-kopia" }));
    let workspace = await screen.findByTestId("velero-backup-repository-workspace");

    await waitFor(() =>
      expect(within(workspace).getByTestId("velero-used-by-pod-volume-restore").getAttribute("data-state")).toBe(
        "denied",
      ),
    );
    expect(within(workspace).getByTestId("velero-used-by-pod-volume-restore").textContent).toBe(
      `Pod Volume Restores${USED_BY_WORDS.denied("pod volume restores")}`,
    );
    expect(USED_BY_WORDS.denied("pod volume restores")).toBe(
      "The pod volume restores of this installation cannot be read: access is denied. What used it among them is not known.",
    );
    expect(within(workspace).getByTestId("velero-used-by-pod-volume-backup").getAttribute("data-state")).toBe("rows");
    expect(within(workspace).queryByTestId("velero-used-by-nothing")).toBeNull();
    act(() => closeViews());
    cleanup();
    // The kind read names none of it, and the other is denied: that nothing used it is not known.
    mount(answers({ [path("podVolumeBackups")]: list(), [path("podVolumeRestores")]: { status: 403 } }), (made) => (
      <RepositoriesPage installation={made} />
    ));
    act(() => openView({ kind: "backup-repository", name: "shop-default-kopia" }));
    workspace = await screen.findByTestId("velero-backup-repository-workspace");
    await waitFor(() =>
      expect(within(workspace).getByTestId("velero-used-by-pod-volume-restore").getAttribute("data-state")).toBe(
        "denied",
      ),
    );
    expect(within(workspace).queryByTestId("velero-used-by-nothing")).toBeNull();
    expect(within(workspace).getByTestId("velero-used-by-pod-volume-backup").textContent).toBe(
      "Pod Volume BackupsNone of the pod volume backups of the installation names it.",
    );
    act(() => closeViews());
    cleanup();
    mount(answers({ [path("podVolumeBackups")]: list(), [path("podVolumeRestores")]: list() }), (made) => (
      <RepositoriesPage installation={made} />
    ));
    act(() => openView({ kind: "backup-repository", name: "shop-default-kopia" }));
    workspace = await screen.findByTestId("velero-backup-repository-workspace");
    expect((await within(workspace).findByTestId("velero-used-by-nothing")).textContent).toBe(USED_BY_WORDS.nothing);
  });

  it("shows the backups it belongs to ten at a time, with the focus on the first it added", async () => {
    const owners = Array.from({ length: 11 }, (_, at) =>
      backup(`daily-${String(at).padStart(2, "0")}`, "Completed", { uid: `backup-daily-${at}` }),
    );
    const operations = owners.map((owner, at) =>
      podVolumeBackup(
        `${owner.metadata.name}-a`,
        { phase: "Completed", startTimestamp: before((at + 1) * MINUTE) },
        ownedBy("Backup", owner),
      ),
    );

    mount(answers({ [path("backups")]: list(...owners), [path("podVolumeBackups")]: list(...operations) }), (made) => (
      <RepositoriesPage installation={made} />
    ));
    act(() => openView({ kind: "backup-repository", name: "shop-default-kopia" }));
    const workspace = await screen.findByTestId("velero-backup-repository-workspace");
    const used = () => within(workspace).getByTestId("velero-used-by-pod-volume-backup");
    const named = () =>
      [...within(used()).getByTestId("velero-used-by-owners").querySelectorAll("li")].map((owner) => owner.textContent);

    await waitFor(() => expect(named()).toEqual(owners.slice(0, 10).map((owner) => owner.metadata.name)));
    // The command of the owners is not the one of the rows of a band.
    fireEvent.click(within(used()).getByTestId("velero-used-by-more"));
    await waitFor(() => expect(named()).toHaveLength(11));
    expect(document.activeElement?.getAttribute("data-testid")).toBe("velero-open-backup-daily-10");
    expect(within(used()).queryByTestId("velero-used-by-more")).toBeNull();
  });
});

describe("what used a repository in each state of the read of its families", () => {
  const owner = backup("nightly", "Completed", { uid: "backup-nightly-2" });
  const mine = podVolumeBackup("nightly-a", { phase: "Completed" }, ownedBy("Backup", owner));

  function shown(backups: ReturnType<typeof read>) {
    const made = installation({}).installation;

    runInAction(() => {
      made.reads = { ...made.reads, podVolumeBackups: backups as never, podVolumeRestores: read([]) };
    });
    render(<UsedBy installation={made} repository={kopia} />);
  }

  it.each([
    [
      "idle",
      [],
      undefined,
      "not-read",
      "The pod volume backups of this installation were not read yet: what used it among them is not known.",
    ],
    ["loading", [], undefined, "loading", "The pod volume backups of the installation are being read."],
    [
      "forbidden",
      [],
      undefined,
      "denied",
      "The pod volume backups of this installation cannot be read: access is denied. What used it among them is not known.",
    ],
    [
      "failed",
      [],
      undefined,
      "failed",
      "The pod volume backups of this installation could not be read. What used it among them is not known.",
    ],
    [
      "not-served",
      [],
      undefined,
      "not-served",
      "The cluster does not serve the pod volume backups of Velero: what used it among them is not known.",
    ],
    ["failed", [], NOW - MINUTE, "none", "None of the pod volume backups of the installation names it."],
    ["forbidden", [mine], NOW - MINUTE, "rows", "1 pod volume backup"],
  ] as const)("says what is known of a kind when its read is %s", (status, items, lastSuccess, state, words) => {
    shown(read(items as unknown as Resource[], status as ReadStatus, lastSuccess));
    const used = screen.getByTestId("velero-used-by-pod-volume-backup");
    const said =
      state === "rows" ? within(used).getByTestId("velero-used-by-count") : used.querySelector("p[data-state]");

    expect([said?.getAttribute("data-state") ?? "rows", said?.textContent]).toEqual([state, words]);
    // What is of an earlier read says so in place, with or without rows, and nothing is said unused.
    expect(within(used).queryByTestId("velero-volume-stale")?.textContent).toBe(
      lastSuccess === undefined
        ? undefined
        : `The pod volume backups could not be read again: these are the ones read at ${new Date(lastSuccess).toLocaleTimeString()}.`,
    );
    expect(screen.queryByTestId("velero-used-by-nothing")).toBeNull();
  });

  it("says that no pod volume operation of the installation used it only when each kind was read now and none names it", () => {
    shown(read([]));
    expect(screen.getByTestId("velero-used-by-nothing").textContent).toBe(
      "No pod volume operation of the installation used it.",
    );
    expect(screen.queryByTestId("velero-used-by-pod-volume-backup")).toBeNull();
  });
});

describe("when the next maintenance of a repository is due", () => {
  it("is being read while the storage locations were never answered, and computed once they are", async () => {
    let answer: (value: Answer) => void = () => undefined;
    const table = answers({
      [path("storageLocations")]: () => new Promise<Answer>((resolve) => (answer = resolve)),
    });

    mount(table, (made) => <RepositoriesPage installation={made} />);
    act(() => openView({ kind: "backup-repository", name: "shop-default-kopia" }));
    const workspace = await screen.findByTestId("velero-backup-repository-workspace");
    const due = () => within(workspace).getByTestId("velero-backup-repository-due");

    // The repositories answered first: the location is not known to be absent or denied yet.
    expect(due().getAttribute("data-due")).toBe("locations-being-read");
    expect(due().textContent).toBe(
      "Not known yet: the storage locations of the installation are being read, and the server runs no maintenance of a repository of a read-only one.",
    );
    expect(due().textContent).toBe(REPOSITORY_WORDS.locationsBeingRead);
    await act(async () => answer(list(location("default"))));
    await waitFor(() => expect(due().getAttribute("data-due")).toBe("not-due"));
  });
});
