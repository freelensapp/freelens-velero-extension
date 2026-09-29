// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emptyPreferences, heldPreferences, RESOURCES } from "../../common/discovery";
import { COMPLETED_NOTE } from "../../common/overview";
import { closeViews, openView, openViews } from "../navigation";
import { Installation } from "../state/installation";
import { OverviewPage } from "./overview-page";

import type { Answer, Family, Preferences } from "../../common/discovery";

const DISCOVERY = "/apis/velero.io/v1";
const LOCATIONS = "/apis/velero.io/v1/backupstoragelocations";
const A = "velero-a";
const B = "velero-b";
const NOW = Date.parse("2026-09-10T12:00:00Z");
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const ago = (milliseconds: number) => new Date(NOW - milliseconds).toISOString().replace(".000Z", "Z");
const shown = (milliseconds: number) => new Date(NOW - milliseconds).toLocaleString();
const extension = { name: "@freelensapp/velero-extension" };

type Answers = Record<string, Answer | (() => Promise<Answer>)>;

function path(family: Family, namespace: string): string {
  return `/apis/velero.io/v1/namespaces/${namespace}/${RESOURCES[family]}`;
}

function list(...items: unknown[]): Answer {
  return { status: 200, body: { items } };
}

function object(kind: string, name: string, namespace: string, spec?: object, status?: object, more: object = {}) {
  return {
    apiVersion: "velero.io/v1",
    kind,
    metadata: {
      name,
      namespace,
      uid: `${namespace}-${kind.toLowerCase()}-${name}`,
      resourceVersion: "1",
      creationTimestamp: ago(40 * DAY),
      ...more,
    },
    ...(spec ? { spec } : {}),
    ...(status ? { status } : {}),
  };
}

// What the release writes with a phase: no start for what waits or was refused, no counter of zero.
function ran(phase: string, started: number) {
  if (["New", "Queued", "ReadyToStart"].includes(phase)) return { phase };
  if (phase === "FailedValidation") return { phase, validationErrors: ["refused"] };
  return {
    phase,
    startTimestamp: ago(started),
    progress: { totalItems: 10, itemsBackedUp: phase === "InProgress" ? 4 : 10 },
    ...(["Completed", "PartiallyFailed", "Failed"].includes(phase)
      ? { completionTimestamp: ago(started - 5 * MINUTE) }
      : {}),
    ...(phase.includes("PartiallyFailed") ? { errors: 2 } : {}),
    ...(phase === "Failed" ? { failureReason: "stopped" } : {}),
  };
}

const backup = (name: string, phase: string, started: number, more: { schedule?: string; created?: number } = {}) =>
  object("Backup", name, A, { storageLocation: "default" }, ran(phase, started), {
    creationTimestamp: ago(more.created ?? started),
    ...(more.schedule ? { labels: { "velero.io/schedule-name": more.schedule } } : {}),
  });
const restore = (name: string, phase: string, started: number) =>
  object("Restore", name, A, { backupName: "by-hand" }, ran(phase, started), { creationTimestamp: ago(started) });
const schedule = (name: string, spec: object = {}, status: object | null = { phase: "Enabled" }) =>
  object(
    "Schedule",
    name,
    A,
    { schedule: "0 3 * * *", skipImmediately: false, template: { storageLocation: "default" }, ...spec },
    status ?? undefined,
  );
const location = (name: string, spec: object = {}, status: object | null = null) =>
  object(
    "BackupStorageLocation",
    name,
    A,
    { provider: "aws", ...spec },
    status ?? { phase: "Available", lastValidationTime: ago(30_000) },
  );

const backups = [
  backup("nightly-3", "FailedValidation", 0, { schedule: "nightly", created: 2 * HOUR }),
  backup("nightly-2", "Completed", DAY, { schedule: "nightly" }),
  backup("nightly-1", "Completed", 2 * DAY, { schedule: "nightly" }),
  backup("weekly-1", "Completed", 5 * DAY, { schedule: "weekly" }),
  backup("by-hand", "Completed", 3 * HOUR),
  backup("old", "Failed", 20 * DAY),
  backup("running", "InProgress", 20 * MINUTE),
  backup("waiting", "WaitingForPluginOperationsPartiallyFailed", 3 * HOUR),
  backup("queued", "Queued", 0, { created: 10 * MINUTE }),
];
const restores = [
  restore("restoring", "FinalizingPartiallyFailed", HOUR),
  restore("restored", "Completed", 2 * DAY),
  restore("failed", "Failed", 6 * DAY),
];
const schedules = [
  schedule("nightly"),
  schedule("weekly", { paused: true }),
  schedule("broken", {}, { phase: "FailedValidation", validationErrors: ["expected exactly 5 fields"] }),
  schedule("to-archive", { template: { storageLocation: "archive" } }),
];
const locations = [
  location("default", { default: true, accessMode: "ReadWrite" }),
  location("archive", { accessMode: "ReadOnly" }),
  location("broken", {}, { phase: "Unavailable", message: "no bucket", lastValidationTime: ago(2 * DAY) }),
];
const served: Answer = { status: 200, body: { resources: Object.values(RESOURCES).map((name) => ({ name })) } };

function answers(more: Answers = {}): Answers {
  return {
    [DISCOVERY]: served,
    [LOCATIONS]: list({ metadata: { name: "default", namespace: A } }, { metadata: { name: "default", namespace: B } }),
    [path("backups", A)]: list(...backups),
    [path("restores", A)]: list(...restores),
    [path("schedules", A)]: list(...schedules),
    [path("storageLocations", A)]: list(...locations),
    [path("snapshotLocations", A)]: list(object("VolumeSnapshotLocation", "snapshots", A, { provider: "aws" })),
    [path("backups", B)]: list(),
    [path("restores", B)]: list(),
    [path("schedules", B)]: list(),
    [path("storageLocations", B)]: list(
      object(
        "BackupStorageLocation",
        "default",
        B,
        { default: true },
        { phase: "Available", lastValidationTime: ago(1000) },
      ),
    ),
    [path("snapshotLocations", B)]: list(),
    ...more,
  };
}

function mount(table: Answers, preferences: Preferences = chosen(A)) {
  const asked: string[] = [];
  const written: Preferences[] = [];
  const clock = { now: NOW };
  const installation = new Installation({
    cluster: { id: "cluster-a", name: "local-demo" },
    read: async (address) => {
      asked.push(address);
      const answer = table[address] ?? { status: 404 };

      return typeof answer === "function" ? answer() : answer;
    },
    now: () => clock.now,
    storage: heldPreferences(preferences, (next) => written.push(next)),
  });
  const view = render(<OverviewPage extension={extension} installation={installation} />);

  return { installation, asked, written, clock, table, view };
}

const chosen = (namespace: string, more: Partial<Preferences> = {}): Preferences => ({
  ...emptyPreferences(),
  selected: { "cluster-a": namespace },
  ...more,
});
const page = async () => {
  const found = await screen.findByTestId("velero-overview");

  await waitFor(() => expect(cell("backups").getAttribute("data-read")).not.toBe("not-read"));
  return found;
};
const band = (id: string) => screen.getByTestId(`velero-overview-${id}`);
const cell = (family: Family) => screen.getByTestId(`velero-overview-read-${family}`);
const items = () =>
  [...band("attention").querySelectorAll("[data-rule]")].map((item) => [
    item.getAttribute("data-rule"),
    item.querySelector("button, a")?.textContent,
  ]);
const operations = (id: string) =>
  [...(screen.queryByTestId(id)?.querySelectorAll("[data-operation]") ?? [])].map((row) =>
    row.getAttribute("data-operation"),
  );
const marks = (row: string) =>
  [...document.querySelectorAll(`[data-line-row="${row}"] [data-line-mark]`)].map((mark) =>
    mark.getAttribute("data-line-mark"),
  );
const lines = (id: string) =>
  [...(screen.queryByTestId(id)?.querySelectorAll("[data-line]") ?? [])].map((line) => line.getAttribute("data-line"));
// The words of a value of the whole, which no part of the page says.
const VERDICT = /healthy|protected|\bsafe\b|all is well|\bscore\b|\bstatus of the installation\b/i;
// A percentage is of the items of one operation, in the lists of the operations, and of nothing else.
const noValueOfTheWhole = () => {
  expect(screen.getByTestId("velero-overview").textContent).not.toMatch(VERDICT);
  for (const id of ["read", "attention", "completed", "schedules", "storage"]) {
    expect([id, /%/.test(band(id).textContent ?? "")]).toEqual([id, false]);
  }
  expect(document.querySelectorAll("[role=progressbar], [role=meter], meter, progress")).toHaveLength(0);
};

beforeEach(() => {
  vi.setSystemTime(NOW);
});

afterEach(() => {
  act(() => closeViews());
  cleanup();
  vi.useRealTimers();
});

describe("what was read", () => {
  it("says of each of the five families how many of its objects were read, and leads to its list", async () => {
    const { asked } = mount(answers());

    await page();
    expect(
      (["backups", "restores", "schedules", "storageLocations", "snapshotLocations"] as const).map((family) => [
        cell(family).textContent,
        cell(family).getAttribute("data-read"),
        cell(family).getAttribute("href"),
      ]),
    ).toEqual([
      ["Backups9", "read", "/extension/freelensapp--velero-extension/backups"],
      ["Restores3", "read", "/extension/freelensapp--velero-extension/restores"],
      ["Schedules4", "read", "/extension/freelensapp--velero-extension/schedules"],
      ["Backup Storage Locations3", "read", "/extension/freelensapp--velero-extension/storage-locations"],
      ["Volume Snapshot Locations1", "read", "/extension/freelensapp--velero-extension/snapshot-locations"],
    ]);
    // The page asks what every other view asks, and nothing of its own.
    expect([...new Set(asked)].sort()).toEqual(
      [DISCOVERY, LOCATIONS, ...Object.keys(RESOURCES).map((family) => path(family as Family, A))].sort(),
    );
    expect(screen.getByTestId("velero-overview-page")).toBeTruthy();
  });

  it("says the state of a family that was not read, and the time of one that is of an earlier read", async () => {
    const partly: Answer = {
      status: 200,
      body: {
        resources: Object.values(RESOURCES)
          .filter((name) => name !== "volumesnapshotlocations")
          .map((name) => ({ name })),
      },
    };
    const { installation, table, clock } = mount(
      answers({ [DISCOVERY]: partly, [path("restores", A)]: { status: 403 }, [path("backups", A)]: {} }),
    );

    await page();
    expect([cell("restores").textContent, cell("restores").getAttribute("data-read")]).toEqual([
      "RestoresAccess denied",
      "denied",
    ]);
    expect(cell("backups").textContent).toBe("BackupsCould not be read");
    await waitFor(() =>
      expect(cell("snapshotLocations").textContent).toBe("Volume Snapshot LocationsNot served by the cluster"),
    );
    expect(cell("schedules").textContent).toBe("Schedules4");
    // A family that could not be read is not one that holds none.
    expect(screen.getByTestId("velero-overview-read").textContent).not.toMatch(/Backups0|Restores0/);
    // With its day: what was read before may be of the day before.
    const read = new Date(clock.now).toLocaleString();

    clock.now += MINUTE;
    table[path("schedules", A)] = { status: 500 };
    await act(() => installation.refresh());
    expect([cell("schedules").textContent, cell("schedules").getAttribute("data-read")]).toEqual([
      `Schedules4Read at ${read}: they could not be read since then`,
      "stale",
    ]);
  });
});

describe("what needs attention", () => {
  it("lists the items of the rules in their order, each with its reason and the way to its object", async () => {
    mount(answers());
    await page();
    expect(items()).toEqual([
      ["A9", "restoring"],
      ["A9", "waiting"],
      ["A1", "broken"],
      ["A3", "broken"],
      ["A7", "nightly"],
      ["A5", "broken"],
      ["A8", "to-archive"],
      ["A10", "failed"],
    ]);
    expect(screen.getByTestId("velero-overview-attention-summary").textContent).toBe("8 items in what was read.");
    const first = band("attention").querySelector('[data-rule="A7"]') as HTMLElement;

    expect(first.textContent).toContain("Schedules: nightly");
    expect(first.textContent).toContain(
      "Its newest backup, nightly-3, ended with a failure. Failed validation: 1 validation error.",
    );
    // The time the reason refers to: the one the backup was created at, which never started.
    expect(first.textContent).toContain(shown(2 * HOUR));
    expect(
      within(first)
        .getAllByRole("button")
        .map((button) => button.getAttribute("data-testid")),
    ).toEqual(["velero-open-schedule-nightly", "velero-open-backup-nightly-3"]);
    noValueOfTheWhole();
  });

  it("says that nothing in what was read needs attention, and never that all is well", async () => {
    mount(
      answers({
        [path("backups", A)]: list(backup("by-hand", "Completed", HOUR)),
        [path("restores", A)]: list(),
        [path("schedules", A)]: list(schedule("nightly")),
        [path("storageLocations", A)]: list(location("default", { default: true })),
      }),
    );
    await page();
    expect(items()).toEqual([]);
    expect(screen.getByTestId("velero-overview-attention-summary").textContent).toBe(
      "Nothing in what was read needs attention.",
    );
    expect(band("attention").querySelector("ul")).toBeNull();
    noValueOfTheWhole();
  });

  it("gives no item of a family that was not read, and says what could not be checked", async () => {
    mount(
      answers({
        [path("backups", A)]: list(backup("by-hand", "Completed", HOUR)),
        [path("restores", A)]: { status: 403 },
        [path("schedules", A)]: list(schedule("nightly")),
        [path("storageLocations", A)]: list(location("default", { default: true })),
      }),
    );
    await page();
    expect(items()).toEqual([]);
    expect(screen.getByTestId("velero-overview-attention-summary").textContent).toBe(
      "Nothing in what was read needs attention. Not everything was read.",
    );
    const line = band("attention").querySelector('[data-unchecked="restores"]') as HTMLElement;

    expect(line.textContent).toBe(
      "help_outlineRestoresThe restores of this installation cannot be read: access is denied. Whether a restore in flight carries a failure, and whether one ended with a failure, were not checked.",
    );
    expect(screen.getByTestId("velero-overview-unchecked-restores").getAttribute("href")).toBe(
      "/extension/freelensapp--velero-extension/restores",
    );
    noValueOfTheWhole();
  });

  it("says of the items of an earlier read that they were read before", async () => {
    const { installation, table, clock } = mount(answers());

    await page();
    clock.now += MINUTE;
    table[path("storageLocations", A)] = { status: 500 };
    await act(() => installation.refresh());
    const stale = [...band("attention").querySelectorAll("[data-rule]")].map((item) => [
      item.getAttribute("data-rule"),
      item.getAttribute("data-stale"),
    ]);

    expect(stale).toEqual([
      ["A9", "false"],
      ["A9", "false"],
      ["A1", "true"],
      ["A3", "true"],
      ["A7", "false"],
      ["A5", "false"],
      // The schedule was read, and the location its template names is of the read before.
      ["A8", "true"],
      ["A10", "false"],
    ]);
    expect((band("attention").querySelector('[data-rule="A1"]') as HTMLElement).textContent).toContain(
      "It was read before the last read, which did not succeed.",
    );
    // What the rules looked at is not all of now, and the page says so beside how many items there are.
    expect(screen.getByTestId("velero-overview-attention-summary").textContent).toBe(
      "8 items in what was read. Part of it was read before the last read, which did not succeed.",
    );
  });

  it("says that nothing was read when no family the rules look at was", async () => {
    mount(
      answers({
        [path("backups", A)]: { status: 403 },
        [path("restores", A)]: { status: 403 },
        [path("schedules", A)]: { status: 403 },
        [path("storageLocations", A)]: { status: 403 },
      }),
    );
    await page();
    expect(screen.getByTestId("velero-overview-attention-summary").textContent).toBe(
      "Nothing was read of what the rules look at: what needs attention is not known.",
    );
    expect(items()).toEqual([]);
    expect([...band("attention").querySelectorAll("[data-unchecked]")]).toHaveLength(4);
    noValueOfTheWhole();
  });

  it("leads to the list for an item that is of no single object", async () => {
    mount(answers({ [path("storageLocations", A)]: list(location("first"), location("second")) }));
    await page();
    expect(items()).toContainEqual(["A4", "Default storage location"]);
    expect(screen.getByTestId("velero-overview-item-A4-list").getAttribute("href")).toBe(
      "/extension/freelensapp--velero-extension/storage-locations",
    );
  });
});

describe("what is in flight and what completed", () => {
  it("lists the backups and the restores in flight from the oldest, with their progress and their time", async () => {
    mount(answers());
    await page();
    expect(operations("velero-overview-in-flight-list")).toEqual([
      "backup/waiting",
      "restore/restoring",
      "backup/running",
      "backup/queued",
    ]);
    const cells = (list: string, key: string) => [
      ...(document.querySelector(`[data-testid=velero-overview-${list}-list] [data-operation="${key}"]`)?.children ??
        []),
    ];
    const row = (key: string, list = "in-flight") => cells(list, key).map((cell) => cell.textContent);
    const heads = (list: string) =>
      [...document.querySelectorAll(`[data-testid=velero-overview-${list}-list] th`)].map((head) => head.textContent);

    // What is said of an operation in flight, by the name of each part.
    const flight = (key: string) =>
      Object.fromEntries(
        [
          ...document.querySelectorAll(
            `[data-testid=velero-overview-in-flight-list] [data-operation="${key}"] [data-part]`,
          ),
        ].map((part) => [part.getAttribute("data-part"), part.textContent]),
      );
    const started = (key: string) =>
      document
        .querySelector(`[data-testid=velero-overview-in-flight-list] [data-operation="${key}"] [data-part=elapsed]`)
        ?.getAttribute("title");

    // The band has half the page: an operation is two lines, its kind beside its name, and when it
    // started is in the tip of its elapsed time.
    expect(heads("in-flight")).toEqual([]);
    expect(flight("backup/running")).toEqual({
      kind: "backup",
      elapsed: "20m so far",
      phase: "autorenewIn progress",
      failure: "removeNo failure reported",
      progress: "Items: 4 / 10 (40%)",
    });
    expect(started("backup/running")).toBe(`${shown(20 * MINUTE)} (started)`);
    // One that waits has no start: it is at the time it was created, and its elapsed time is not made up.
    expect(flight("backup/queued")).toMatchObject({ progress: "Items: Not reported", elapsed: "Not started" });
    expect(started("backup/queued")).toBe(`${shown(10 * MINUTE)} (created, did not start)`);
    expect(flight("restore/restoring")).toMatchObject({
      kind: "restore",
      phase: "autorenewFinalizing",
      failure: "error_outline2 errors",
    });
    expect(
      document.querySelector('[data-testid=velero-overview-in-flight-list] [data-operation="restore/restoring"] button')
        ?.textContent,
    ).toBe("restoring");
    // The list of the recent operations has the page: each has its kind and its time in a column.
    expect(heads("recent")).toEqual(["Operation", "Kind", "Phase", "Failure", "Progress", "Time", "Duration"]);
    expect(row("backup/running", "recent")).toEqual([
      "running",
      "backup",
      "autorenewIn progress",
      "removeNo failure reported",
      "4 / 10 (40%)",
      `${shown(20 * MINUTE)} (started)`,
      "20m so far",
    ]);
    expect(row("backup/queued", "recent").slice(4)).toEqual([
      "Not reported",
      `${shown(10 * MINUTE)} (created, did not start)`,
      "Not started",
    ]);
  });

  it("says that nothing is in flight, and that what was not read is not known", async () => {
    mount(answers({ [path("backups", A)]: list(backup("done", "Completed", HOUR)), [path("restores", A)]: list() }));
    await page();
    expect(screen.getByTestId("velero-overview-in-flight-none").textContent).toBe(
      "No backup and no restore is in flight.",
    );
    cleanup();
    mount(answers({ [path("backups", A)]: { status: 403 } }));
    await page();
    expect(operations("velero-overview-in-flight-list")).toEqual(["restore/restoring"]);
    expect(band("in-flight").textContent).toContain(
      "The backups of this installation cannot be read: access is denied. Whether a backup is in flight is not known.",
    );
    expect(screen.queryByTestId("velero-overview-in-flight-none")).toBeNull();
    expect(screen.queryByTestId("velero-overview-in-flight-none-of-one")).toBeNull();
    // Of the kind that was read it is known that none is in flight, and of the other it is not.
    cleanup();
    mount(
      answers({
        [path("backups", A)]: { status: 403 },
        [path("restores", A)]: list(restore("done", "Completed", HOUR)),
      }),
    );
    await page();
    expect(operations("velero-overview-in-flight-list")).toEqual([]);
    expect(screen.queryByTestId("velero-overview-in-flight-none")).toBeNull();
    expect(screen.getByTestId("velero-overview-in-flight-none-of-one").textContent).toBe("No restore is in flight.");
    expect(band("in-flight").textContent).toContain("Whether a backup is in flight is not known.");
    cleanup();
    mount(answers({ [path("backups", A)]: list(), [path("restores", A)]: { status: 500 } }));
    await page();
    expect(screen.getByTestId("velero-overview-in-flight-none-of-one").textContent).toBe("No backup is in flight.");
    expect(band("in-flight").textContent).toContain("Whether a restore is in flight is not known.");
  });

  it("shows the newest backup that completed, by the time it completed, and says what completed means", async () => {
    mount(answers());
    await page();
    expect(band("completed").textContent).toContain(COMPLETED_NOTE);
    expect(band("completed").querySelector("[data-completed]")?.textContent).toBe(
      `by-hand completed ${shown(3 * HOUR - 5 * MINUTE)}`,
    );
    expect(within(band("completed")).getByRole("button").getAttribute("data-testid")).toBe(
      "velero-open-backup-by-hand",
    );
    cleanup();
    mount(answers({ [path("backups", A)]: list(backup("failed", "Failed", HOUR)) }));
    await page();
    expect(band("completed").querySelector("[data-completed]")?.textContent).toBe("None among the backups that exist");
    cleanup();
    mount(answers({ [path("backups", A)]: { status: 403 } }));
    await page();
    // Why it is not known is said in words, where the band has the room for them.
    expect(band("completed").querySelector("[data-completed]")?.textContent).toBe(
      "Not known: the backups of this installation cannot be read: access is denied",
    );
    expect(band("completed").querySelector("[data-completed]")?.getAttribute("data-completed")).toBe("inaccessible");
    // In the line of a schedule it is what the words say to who points at them.
    expect(
      [...band("schedules").querySelectorAll("[data-completed]")].map((line) => [
        line.textContent,
        line.getAttribute("title"),
      ]),
    ).toEqual(
      Array.from({ length: 4 }, () => [
        "Not known",
        "The backups of this installation cannot be read: access is denied",
      ]),
    );
  });

  it("says that a backup completed and does not report when, and does not make a time up", async () => {
    const silent = backup("silent", "Completed", 2 * HOUR);

    mount(
      answers({
        [path("backups", A)]: list({ ...silent, status: { phase: "Completed", startTimestamp: ago(2 * HOUR) } }),
      }),
    );
    await page();
    expect(band("completed").querySelector("[data-completed]")?.textContent).toBe(
      "silent completion time not reported",
    );
  });

  it("says that the backups are not served by the cluster, which is not that they could not be read", async () => {
    const partly: Answer = {
      status: 200,
      body: {
        resources: Object.values(RESOURCES)
          .filter((name) => name !== "backups")
          .map((name) => ({ name })),
      },
    };
    const { asked } = mount(answers({ [DISCOVERY]: partly }));

    await page();
    await waitFor(() => expect(cell("backups").textContent).toBe("BackupsNot served by the cluster"));
    expect(cell("backups").getAttribute("data-read")).toBe("not-served");
    expect(band("completed").querySelector("[data-completed]")?.textContent).toBe(
      "Not known: the cluster does not serve the backups",
    );
    expect(screen.getByTestId("velero-overview-line-backups-unread").textContent).toContain(
      "The cluster does not serve the backups.",
    );
    expect(band("in-flight").textContent).toContain("The cluster does not serve the backups.");
    // What the cluster does not serve is not asked.
    expect(asked).not.toContain(path("backups", A));
    noValueOfTheWhole();
  });
});

describe("recent operations", () => {
  it("shows the operations of seven days when no window was chosen, in two rows and in a list", async () => {
    mount(answers());
    await page();
    expect(
      WINDOW_IDS.map((window) => screen.getByTestId(`velero-overview-window-${window}`).getAttribute("aria-pressed")),
    ).toEqual(["false", "true", "false"]);
    expect(operations("velero-overview-recent-list")).toEqual([
      "backup/queued",
      "backup/running",
      "restore/restoring",
      "backup/nightly-3",
      "backup/by-hand",
      "backup/waiting",
      "backup/nightly-2",
      "backup/nightly-1",
      "restore/restored",
      "backup/weekly-1",
    ]);
    // Ten at a time, and the others when they are asked.
    fireEvent.click(screen.getByTestId("velero-overview-recent-more"));
    expect(operations("velero-overview-recent-list").slice(10)).toEqual(["restore/failed"]);
    expect(screen.queryByTestId("velero-overview-recent-more")).toBeNull();
    // Each operation is on the line of its kind, from the oldest: the ones that are close share a mark.
    expect(marks("backups").join(",").split(",").sort()).toEqual(
      ["by-hand", "nightly-1", "nightly-2", "nightly-3", "queued", "running", "waiting", "weekly-1"].sort(),
    );
    expect(marks("backups")[0]).toBe("weekly-1");
    expect(marks("restores").join(",").split(",")).toEqual(["failed", "restored", "restoring"]);
    expect(screen.getByTestId("velero-overview-line-from").textContent).toBe(shown(7 * DAY));
    expect(screen.getByTestId("velero-overview-line-to").textContent).toBe("Now");
  });

  it("keeps the window that is chosen, and asks nothing of the cluster for it", async () => {
    const { asked, written, installation } = mount(answers());

    await page();
    const before = asked.length;

    fireEvent.click(screen.getByTestId("velero-overview-window-24h"));
    expect(screen.getByTestId("velero-overview-window-24h").getAttribute("aria-pressed")).toBe("true");
    expect(operations("velero-overview-recent-list")).toEqual([
      "backup/queued",
      "backup/running",
      "restore/restoring",
      "backup/nightly-3",
      "backup/by-hand",
      "backup/waiting",
      "backup/nightly-2",
    ]);
    expect(screen.getByTestId("velero-overview-line-from").textContent).toBe(shown(DAY));
    expect(written.at(-1)).toEqual({ selected: { "cluster-a": A }, configured: {}, window: "24h" });
    expect(asked).toHaveLength(before);
    // What ended with a failure outside the window is not an item of the window: it is history.
    expect(items().filter(([rule]) => rule === "A10")).toEqual([]);
    fireEvent.click(screen.getByTestId("velero-overview-window-30d"));
    expect(operations("velero-overview-recent-list")).toHaveLength(10);
    expect(marks("backups").join(",").split(",")).toContain("old");
    expect(installation.window).toBe("30d");
    expect(items().filter(([rule]) => rule === "A10")).toEqual([
      ["A10", "failed"],
      ["A10", "old"],
    ]);
  });

  it("takes the window that was kept by another session", async () => {
    mount(answers(), chosen(A, { window: "30d" }));
    await page();
    expect(screen.getByTestId("velero-overview-window-30d").getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByTestId("velero-overview-line-from").textContent).toBe(shown(30 * DAY));
  });

  it("shows alone the operations of a mark that holds more than one, and opens the one of a mark of one", async () => {
    mount(answers());
    await page();
    const group = [...document.querySelectorAll<HTMLElement>("[data-line-mark]")].find((mark) =>
      (mark.getAttribute("data-line-mark") ?? "").includes(","),
    );

    if (!group) throw new Error("No mark holds more than one operation");
    const names = (group.getAttribute("data-line-mark") ?? "").split(",");

    expect(group.textContent).toBe(String(names.length));
    expect(group.getAttribute("aria-label")).toContain(`${names.length} backups close to each other`);
    fireEvent.click(group);
    expect(operations("velero-overview-recent-list")).toEqual(names.map((name) => `backup/${name}`));
    expect(screen.getByTestId("velero-overview-shown").textContent).toContain(
      `The ${names.length} operations of one mark are shown.`,
    );
    fireEvent.click(within(screen.getByTestId("velero-overview-shown")).getByRole("button"));
    expect(operations("velero-overview-recent-list")).toHaveLength(10);
    // The button went away with what it said: the focus is on the mark that was chosen.
    expect(document.activeElement).toBe(group);
    expect(group.getAttribute("aria-pressed")).toBe("false");
    const single = document.querySelector<HTMLElement>('[data-line-row="restores"] [data-line-mark="failed"]');

    expect(single?.getAttribute("data-failing")).toBe("true");
    fireEvent.click(single as HTMLElement);
    expect(openViews()).toEqual([{ kind: "restore", name: "failed" }]);
    expect((await screen.findByTestId("velero-back")).textContent).toContain("Overview");
  });

  it("draws nothing where no operation is, and says of a row that was not read that it is not known", async () => {
    mount(answers({ [path("restores", A)]: { status: 403 }, [path("backups", A)]: list() }));
    await page();
    expect(marks("backups")).toEqual([]);
    expect(screen.getByTestId("velero-overview-line-backups-none").textContent).toBe(
      "No backup of the last 7 days is among the ones that exist.",
    );
    expect(screen.getByTestId("velero-overview-line-restores-unread").textContent).toBe(
      "The restores of this installation cannot be read: access is denied. The restores of the last 7 days are not known, which is not that there are none.",
    );
    expect(screen.queryByTestId("velero-overview-recent-list")).toBeNull();
    expect(band("recent").textContent).not.toMatch(/missed|expected|overdue|should have/i);
    // A row that was not read is not one that holds none.
    expect(screen.queryByTestId("velero-overview-line-restores-none")).toBeNull();
    expect(screen.queryByTestId("velero-overview-line-backups-unread")).toBeNull();
  });

  it("says of a mark that was chosen how many of its operations are there now", async () => {
    // Three backups within minutes of each other are one mark, days after another.
    const close = ["one", "two", "three"].map((name, index) => backup(name, "Completed", 3 * HOUR + index * MINUTE));
    const far = backup("far", "Completed", 5 * DAY);
    const { installation, table } = mount(
      answers({ [path("backups", A)]: list(...close, far), [path("restores", A)]: list() }),
    );
    const said = () => screen.getByTestId("velero-overview-shown").textContent;
    const read = async (...items: unknown[]) => {
      table[path("backups", A)] = list(...items, far);
      await act(() => installation.refresh());
    };

    await page();
    expect(marks("backups")).toEqual(["far", "one,two,three"]);
    fireEvent.click(document.querySelector('[data-line-mark="one,two,three"]') as HTMLElement);
    expect(said()).toBe("The 3 operations of one mark are shown. Show all");
    // One of them is gone at the read after: the number is of the ones that are shown.
    await read(close[0], close[2]);
    expect(operations("velero-overview-recent-list")).toEqual(["backup/one", "backup/three"]);
    expect(said()).toBe("The 2 operations of one mark are shown. Show all");
    await read(close[2]);
    expect(operations("velero-overview-recent-list")).toEqual(["backup/three"]);
    expect(said()).toBe("One operation of one mark is shown. Show all");
    await read();
    expect(screen.queryByTestId("velero-overview-recent-list")).toBeNull();
    expect(said()).toBe(
      "No operation of the mark that was chosen is among the ones of the last 7 days that exist now. Show all",
    );
    // What is said is said to who does not see it as well, when it changes.
    expect(screen.getByTestId("velero-overview-shown").querySelector('[role="status"]')?.textContent).toBe(
      "No operation of the mark that was chosen is among the ones of the last 7 days that exist now.",
    );
    fireEvent.click(within(screen.getByTestId("velero-overview-shown")).getByRole("button"));
    expect(screen.queryByTestId("velero-overview-shown")).toBeNull();
    expect(operations("velero-overview-recent-list")).toEqual(["backup/far"]);
    // The mark is not there any more: the focus is on the window, and not on nothing.
    expect(document.activeElement).toBe(screen.getByTestId("velero-overview-window-7d"));
  });

  it("says of a mark that was chosen what the window does not hold any more, which moves with the clock", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"], now: NOW });
    // Two backups that started seconds after the beginning of the window of seven days, and one of an hour ago.
    const edge = [backup("edge-1", "Completed", 7 * DAY - 2000), backup("edge-2", "Completed", 7 * DAY - 8000)];
    const { asked } = mount(
      answers({
        [path("backups", A)]: list(...edge, backup("far", "Completed", HOUR)),
        [path("restores", A)]: list(),
      }),
    );
    const said = () => screen.getByTestId("velero-overview-shown").textContent;
    const later = (milliseconds: number) =>
      act(() => {
        vi.advanceTimersByTime(milliseconds);
      });

    await page();
    expect(marks("backups")).toEqual(["edge-2,edge-1", "far"]);
    fireEvent.click(document.querySelector('[data-line-mark="edge-2,edge-1"]') as HTMLElement);
    expect(said()).toBe("The 2 operations of one mark are shown. Show all");
    const before = asked.length;

    // Five seconds later the window begins after the first of them, which exists as it did.
    later(5000);
    expect(operations("velero-overview-recent-list")).toEqual(["backup/edge-2"]);
    expect(said()).toBe("One operation of one mark is shown. Show all");
    later(5000);
    expect(screen.queryByTestId("velero-overview-recent-list")).toBeNull();
    // It does not say that they do not exist: they are not of the last seven days any more.
    expect(said()).toBe(
      "No operation of the mark that was chosen is among the ones of the last 7 days that exist now. Show all",
    );
    expect(cell("backups").textContent).toBe("Backups3");
    expect(asked).toHaveLength(before);
  });

  it("forgets the operations of a mark when another window is chosen", async () => {
    mount(answers());
    await page();
    const group = [...document.querySelectorAll<HTMLElement>("[data-line-mark]")].find((mark) =>
      (mark.getAttribute("data-line-mark") ?? "").includes(","),
    );

    fireEvent.click(group as HTMLElement);
    expect(screen.getByTestId("velero-overview-shown")).toBeTruthy();
    // The marks of another window hold other operations: the ones of this mark are not what it shows.
    fireEvent.click(screen.getByTestId("velero-overview-window-30d"));
    expect(screen.queryByTestId("velero-overview-shown")).toBeNull();
    expect(operations("velero-overview-recent-list")).toHaveLength(10);
  });

  it("says how many operations report no time, which no window holds", async () => {
    const timeless = (name: string) => {
      const made = backup(name, "New", 0);

      return { ...made, metadata: { ...made.metadata, creationTimestamp: undefined } };
    };

    mount(answers({ [path("backups", A)]: list(backup("by-hand", "Completed", HOUR), timeless("one")) }));
    await page();
    expect(screen.getByTestId("velero-overview-untimed").textContent).toBe(
      "One operation reports no time, and no window holds what has none: it is in the list of its kind.",
    );
    expect(operations("velero-overview-recent-list")).not.toContain("backup/one");
    cleanup();
    mount(answers({ [path("backups", A)]: list(timeless("one"), timeless("two"), timeless("three")) }));
    await page();
    expect(screen.getByTestId("velero-overview-untimed").textContent).toBe(
      "3 operations report no time, and no window holds what has none: they are in the lists of their kinds.",
    );
    cleanup();
    mount(answers());
    await page();
    expect(screen.queryByTestId("velero-overview-untimed")).toBeNull();
  });

  it("says in the words of a mark what it draws: what did not start, and a failure among many", async () => {
    mount(
      answers({
        [path("backups", A)]: list(
          backup("refused", "FailedValidation", 0, { created: 6 * DAY }),
          backup("waited", "Queued", 0, { created: 5 * DAY }),
          // Two that completed, close to each other, and two more of which one failed.
          backup("fine-1", "Completed", 3 * DAY),
          backup("fine-2", "Completed", 3 * DAY + MINUTE),
          backup("bad-1", "Failed", DAY),
          backup("bad-2", "Completed", DAY + MINUTE),
        ),
        [path("restores", A)]: list(),
      }),
    );
    await page();
    const drawn = [...document.querySelectorAll<HTMLElement>('[data-line-row="backups"] [data-line-mark]')].map(
      (mark) => ({
        names: mark.getAttribute("data-line-mark"),
        shown: mark.textContent,
        failing: mark.getAttribute("data-failing"),
        waiting: mark.getAttribute("data-not-started"),
        said: mark.getAttribute("aria-label") ?? "",
        title: mark.getAttribute("title"),
      }),
    );

    expect(drawn.map(({ names, shown: text, failing, waiting }) => [names, text, failing, waiting])).toEqual([
      // What did not start has its own mark, whatever its phase is.
      ["refused", "block", "true", "true"],
      ["waited", "block", "false", "true"],
      ["fine-1,fine-2", "2", "false", "false"],
      ["bad-1,bad-2", "2", "true", "false"],
    ]);
    expect(drawn[0].said).toBe(
      `refused, Failed validation, 1 validation error, Created, did not start ${shown(6 * DAY)}`,
    );
    expect(drawn[2].said).toMatch(/^2 backups close to each other\. fine-1, Completed, /);
    expect(drawn[3].said).toMatch(
      /^2 backups close to each other\. one of them at least with a failure\. bad-1, Failed, /,
    );
    // What a mark says to who reaches it with the keyboard is what it says to who points at it.
    expect(drawn.filter(({ said, title }) => said === "" || said !== title)).toEqual([]);
  });

  it("draws the two rows on one line, which ends at the newest operation when the cluster is ahead", async () => {
    mount(
      answers({
        // The clock of the cluster is a day ahead of the one of this machine.
        [path("backups", A)]: list(backup("ahead", "InProgress", -DAY)),
        [path("restores", A)]: list(restore("half", "Completed", 12 * HOUR)),
      }),
      chosen(A, { window: "24h" }),
    );
    await page();
    const left = (row: string) =>
      [...document.querySelectorAll<HTMLElement>(`[data-line-row="${row}"] [data-line-mark]`)].map(
        (mark) => mark.style.left,
      );

    expect(screen.getByTestId("velero-overview-line-to").textContent).toBe(shown(-DAY));
    expect(left("backups")).toEqual(["100%"]);
    // Twelve hours after the beginning of a line that is forty-eight hours long.
    expect(left("restores")).toEqual(["25%"]);
  });

  it("says of a row of an earlier read when it was read", async () => {
    const { installation, table, clock } = mount(answers());

    await page();
    const read = new Date(clock.now).toLocaleString();

    clock.now += MINUTE;
    table[path("backups", A)] = { status: 500 };
    await act(() => installation.refresh());
    expect(screen.getByTestId("velero-overview-line-backups-stale").textContent).toBe(
      `The backups could not be read again: these were read at ${read}.`,
    );
    expect(screen.queryByTestId("velero-overview-line-restores-stale")).toBeNull();
    expect(marks("backups").join(",").split(",")).toContain("by-hand");
  });
});

describe("an installation of many operations", () => {
  it("shows the first ten of what needs attention and of what is in flight, and the others when they are asked", async () => {
    const many = Array.from({ length: 25 }, (_, index) =>
      backup(`failing-${String(index + 1).padStart(2, "0")}`, "FinalizingPartiallyFailed", (index + 1) * MINUTE),
    );

    mount(answers({ [path("backups", A)]: list(...many), [path("restores", A)]: list() }));
    await page();
    const attended = () =>
      items()
        .filter(([rule]) => rule === "A9")
        .map(([, name]) => name);

    // From the newest among the items, and from the oldest among what is in flight.
    expect(attended()).toEqual(many.slice(0, 10).map((item) => item.metadata.name));
    // Twenty-five in flight with a failure, two of the storage and two of the schedules.
    expect(screen.getByTestId("velero-overview-attention-summary").textContent).toBe("29 items in what was read.");
    expect(screen.getByTestId("velero-overview-attention-more").textContent).toBe(
      "Show 10 more of the 19 items that follow",
    );
    fireEvent.click(screen.getByTestId("velero-overview-attention-more"));
    expect(attended()).toHaveLength(20);
    expect(screen.getByTestId("velero-overview-attention-more").textContent).toBe(
      "Show 9 more of the 9 items that follow",
    );
    fireEvent.click(screen.getByTestId("velero-overview-attention-more"));
    expect(items()).toHaveLength(29);
    expect(screen.queryByTestId("velero-overview-attention-more")).toBeNull();
    expect(screen.getByTestId("velero-overview-in-flight-count").textContent).toBe("25 in flight, from the oldest.");
    expect(operations("velero-overview-in-flight-list")).toEqual(
      [...many]
        .reverse()
        .slice(0, 10)
        .map((item) => `backup/${item.metadata.name}`),
    );
    fireEvent.click(screen.getByTestId("velero-overview-in-flight-more"));
    expect(operations("velero-overview-in-flight-list")).toHaveLength(20);
  });

  it("writes the number of a mark in the room of a mark, and how many they are in its words", async () => {
    // Twelve hundred backups in the same minute are one mark, and twenty-five in another are one more.
    const crowd = Array.from({ length: 1200 }, (_, index) => backup(`crowd-${index}`, "Completed", 2 * DAY + index));
    const some = Array.from({ length: 25 }, (_, index) => backup(`some-${index}`, "Completed", 4 * DAY + index));

    mount(answers({ [path("backups", A)]: list(...crowd, ...some), [path("restores", A)]: list() }));
    await page();
    const marks = [...document.querySelectorAll<HTMLElement>('[data-line-row="backups"] [data-line-mark]')].map(
      (mark) => ({
        held: Number(mark.getAttribute("data-line-held")),
        named: (mark.getAttribute("data-line-mark") ?? "").split(","),
        shown: mark.textContent,
        characters: mark.querySelector("span")?.getAttribute("data-characters"),
        said: mark.getAttribute("aria-label") ?? "",
      }),
    );

    expect(marks.map(({ held, shown, characters }) => [held, shown, characters])).toEqual([
      [25, "25", "2"],
      [1200, "1k", "2"],
    ]);
    // A mark of many names the newest of them, and says how many more there are: not each of them.
    expect(marks[1].said).toMatch(
      /^1200 backups close to each other\. crowd-0, Completed, .+\. crowd-4, Completed, [^.]+\. and 1195 more$/,
    );
    expect(marks[1].said.length).toBeLessThan(600);
    expect(marks[0].said).toMatch(/\. and 20 more$/);
    expect(marks.map(({ named }) => named.length)).toEqual([20, 20]);
    // Every operation of the mark is shown when the mark is chosen, the ones it does not name as well.
    fireEvent.click(document.querySelectorAll<HTMLElement>('[data-line-row="backups"] [data-line-mark]')[0]);
    expect(screen.getByTestId("velero-overview-shown").textContent).toContain(
      "The 25 operations of one mark are shown.",
    );
  });
});

describe("lines of the schedules and of the storage", () => {
  it("shows a line for each schedule and each storage location, the ones a rule names first", async () => {
    mount(answers());
    await page();
    expect(lines("velero-overview-schedules-list")).toEqual(["broken", "nightly", "to-archive", "weekly"]);
    expect(lines("velero-overview-storage-list")).toEqual(["broken", "archive", "default"]);
    const row = (id: string, name: string) =>
      [...(screen.getByTestId(id).querySelector(`[data-line="${name}"]`)?.children ?? [])].map(
        (cell) => cell.textContent,
      );

    expect(row("velero-overview-schedules-list", "nightly")).toEqual([
      "nightly",
      "check_circle_outlineEnabled",
      "Not paused",
      `nightly-2 completed ${shown(DAY - 5 * MINUTE)}`,
    ]);
    expect(row("velero-overview-schedules-list", "weekly").slice(2)).toEqual([
      "Paused",
      `weekly-1 completed ${shown(5 * DAY - 5 * MINUTE)}`,
    ]);
    expect(row("velero-overview-schedules-list", "broken").slice(1)).toEqual([
      "highlight_offFailed validation",
      "Not paused",
      "None among the backups that exist",
    ]);
    expect(row("velero-overview-storage-list", "broken")).toEqual([
      "broken",
      "highlight_offUnavailable",
      "Not set",
      "Not marked",
      "2d ago, may be out of date",
    ]);
    expect(row("velero-overview-storage-list", "archive").slice(1)).toEqual([
      "check_circle_outlineAvailable",
      "Read only",
      "Not marked",
      "30s ago",
    ]);
    expect(screen.queryByTestId("velero-overview-schedules-others")).toBeNull();
    expect(screen.queryByTestId("velero-overview-storage-others")).toBeNull();
  });

  it("shows ten storage locations of twelve, with the number of the others and the way to their list", async () => {
    const names = Array.from({ length: 12 }, (_, index) => `location-${String(index + 1).padStart(2, "0")}`);

    mount(
      answers({
        [path("storageLocations", A)]: list(
          ...names.map((name, index) => location(name, index === 0 ? { default: true } : {})),
        ),
      }),
    );
    await page();
    expect(lines("velero-overview-storage-list")).toEqual(names.slice(0, 10));
    expect(screen.getByTestId("velero-overview-storage-others").textContent).toBe(
      "2 more in the list of the storage locations",
    );
    expect(screen.getByTestId("velero-overview-storage-all").getAttribute("href")).toBe(
      "/extension/freelensapp--velero-extension/storage-locations",
    );
  });

  it("shows ten schedules of twelve, with the number of the others and the way to their list", async () => {
    const names = Array.from({ length: 12 }, (_, index) => `schedule-${String(index + 1).padStart(2, "0")}`);

    mount(
      answers({
        [path("schedules", A)]: list(
          ...names.map((name) =>
            name === "schedule-11"
              ? schedule(name, {}, null)
              : name === "schedule-07"
                ? schedule(name, {}, { phase: "FailedValidation", validationErrors: ["x"] })
                : schedule(name),
          ),
        ),
      }),
    );
    await page();
    expect(lines("velero-overview-schedules-list")).toEqual([
      "schedule-07",
      "schedule-11",
      ...names.filter((name) => !["schedule-07", "schedule-11"].includes(name)).slice(0, 8),
    ]);
    expect(screen.getByTestId("velero-overview-schedules-others").textContent).toBe(
      "2 more in the list of the schedules",
    );
    expect(screen.getByTestId("velero-overview-schedules-all").getAttribute("href")).toBe(
      "/extension/freelensapp--velero-extension/schedules",
    );
  });
});

describe("each band in its own state", () => {
  it.each([
    // The newest completed backup of each schedule is of the backups: its line says that it is not known.
    ["backups", { status: 403 }, ["completed", "in-flight", "recent", "schedules"]],
    ["restores", { status: 500 }, ["in-flight", "recent"]],
    ["schedules", { status: 403 }, ["schedules"]],
    ["storageLocations", {}, ["storage"]],
  ] as const)("takes nothing from the others when the %s cannot be read", async (family, answer, affected) => {
    mount(answers({ [path(family, A)]: answer as Answer }));
    await page();
    const denied = (id: string) =>
      band(id).querySelector(
        "[data-unread], [data-completed=inaccessible], [data-completed=unknown], [data-line=inaccessible], [data-line=unknown]",
      ) !== null;

    for (const id of ["completed", "in-flight", "recent", "schedules", "storage"]) {
      expect([id, denied(id)]).toEqual([id, (affected as readonly string[]).includes(id)]);
    }
    // The bands that were read are as they are when everything is.
    if (family !== "schedules") expect(lines("velero-overview-schedules-list")).toHaveLength(4);
    if (family !== "storageLocations") expect(lines("velero-overview-storage-list")).toHaveLength(3);
    if (family !== "backups" && family !== "restores") {
      expect(operations("velero-overview-in-flight-list")).toHaveLength(4);
    }
    expect(cell(family).getAttribute("data-read")).not.toBe("read");
    noValueOfTheWhole();
  });

  it("shows an installation with nothing in it as one that holds none, and says so of each band", async () => {
    mount(
      answers({
        [path("backups", A)]: list(),
        [path("restores", A)]: list(),
        [path("schedules", A)]: list(),
        [path("storageLocations", A)]: list(),
        [path("snapshotLocations", A)]: list(),
      }),
    );
    await page();
    expect(cell("backups").textContent).toBe("Backups0");
    expect(band("schedules").textContent).toContain("No schedule is in this installation.");
    expect(band("storage").textContent).toContain("No storage location is in this installation.");
    expect(band("completed").querySelector("[data-completed]")?.textContent).toBe("None among the backups that exist");
    expect(screen.getByTestId("velero-overview-in-flight-none")).toBeTruthy();
    // An installation with no storage location has nowhere to send a backup to, and that is an item.
    expect(items()).toEqual([["A4", "Default storage location"]]);
    expect((band("attention").querySelector('[data-rule="A4"]') as HTMLElement).textContent).toContain(
      "No storage location is in this installation, and none is marked default.",
    );
  });

  it.each([
    ["backups", ["completed", "in-flight", "recent", "schedules"]],
    ["restores", ["in-flight", "recent"]],
    ["schedules", ["schedules"]],
    ["storageLocations", ["storage"]],
  ] as const)(
    "says that the %s are not served, or not read yet, in the bands made from them",
    async (family, affected) => {
      const unknown = (id: string) =>
        band(id).querySelector(
          "[data-unread], [data-completed=unknown], [data-completed=not-read], [data-line=unknown], [data-line=not-read]",
        ) !== null;
      const bands = () => ["completed", "in-flight", "recent", "schedules", "storage"].filter(unknown);
      const partly: Answer = {
        status: 200,
        body: {
          resources: Object.values(RESOURCES)
            .filter((name) => name !== RESOURCES[family])
            .map((name) => ({ name })),
        },
      };

      // The cluster does not serve the kind.
      mount(answers({ [DISCOVERY]: partly }));
      await page();
      await waitFor(() => expect(cell(family).getAttribute("data-read")).toBe("not-served"));
      expect(bands()).toEqual(affected);
      noValueOfTheWhole();
      cleanup();
      // The kind is being read for the first time: its answer has not come.
      mount(answers({ [path(family, A)]: () => new Promise<Answer>(() => undefined) }));
      await screen.findByTestId("velero-overview");
      await waitFor(() =>
        expect(cell(family === "backups" ? "restores" : "backups").getAttribute("data-read")).toBe("read"),
      );
      expect(cell(family).getAttribute("data-read")).toBe("not-read");
      expect(bands()).toEqual(affected);
      expect(screen.queryByTestId("velero-overview-in-flight-none")).toBeNull();
      noValueOfTheWhole();
    },
  );

  it("keeps what was read of a band when its family stops answering, and says when it was read", async () => {
    const { installation, table, clock } = mount(answers());

    await page();
    const read = new Date(clock.now).toLocaleString();
    const before = lines("velero-overview-storage-list");

    clock.now += MINUTE;
    table[path("schedules", A)] = { status: 500 };
    await act(() => installation.refresh());
    expect(lines("velero-overview-schedules-list")).toHaveLength(4);
    expect(band("schedules").querySelector("[data-stale]")?.textContent).toBe(
      `The schedules could not be read again: this is what was read at ${read}.`,
    );
    // The other bands are as they were.
    expect(lines("velero-overview-storage-list")).toEqual(before);
    expect(band("storage").querySelector("[data-stale]")).toBeNull();
    expect(band("in-flight").querySelector("[data-stale]")).toBeNull();
  });
});

describe("the page and the views it leads to", () => {
  it("opens a view over the page, and comes back to what it was opened from", async () => {
    mount(answers());
    await page();
    const link = within(band("storage")).getByTestId("velero-open-storage-location-archive");

    fireEvent.click(link);
    const workspace = await screen.findByTestId("velero-storage-location-workspace");

    expect(screen.getByTestId("velero-overview-page")).toBeTruthy();
    expect(screen.getByTestId("velero-back").textContent).toBe("arrow_backOverview");
    expect(within(workspace).getByTestId("velero-storage-location-name").textContent).toBe("archive");
    fireEvent.click(within(workspace).getByTestId("velero-open-schedule-to-archive"));
    await screen.findByTestId("velero-schedule-workspace");
    expect(screen.getByTestId("velero-back").textContent).toContain("Backup Storage Locations / archive");
    fireEvent.click(screen.getByTestId("velero-back"));
    await screen.findByTestId("velero-storage-location-workspace");
    fireEvent.click(screen.getByTestId("velero-back"));
    await waitFor(() => expect(screen.queryByTestId("velero-storage-location-workspace")).toBeNull());
    // The location is named twice on the page: the focus is on the one the view was opened from.
    await waitFor(() => expect(document.activeElement).toBe(link));
  });

  it("comes back to what a view was opened from every time, and not the first time alone", async () => {
    mount(answers());
    await page();
    const back = async (kind: string) => {
      await screen.findByTestId(`velero-${kind}-workspace`);
      fireEvent.click(screen.getByTestId("velero-back"));
      await waitFor(() => expect(screen.queryByTestId(`velero-${kind}-workspace`)).toBeNull());
    };
    // The location that is unavailable is named three times: in its two items and in its line.
    const places = screen.getAllByTestId("velero-open-storage-location-broken");
    const line = within(band("storage")).getByTestId("velero-open-storage-location-broken");

    expect(places).toHaveLength(3);
    expect(places.indexOf(line)).toBe(2);
    for (const place of [line, places[1], line]) {
      fireEvent.click(place);
      await back("storage-location");
      await waitFor(() => expect(document.activeElement).toBe(place));
    }
    // A mark of the line of time, after the views that were opened before it.
    const mark = document.querySelector<HTMLElement>('[data-line-row="restores"] [data-line-mark="failed"]');

    fireEvent.click(mark as HTMLElement);
    await back("restore");
    await waitFor(() => expect(document.activeElement).toBe(mark));
    // With the keyboard, as with a click.
    const again = within(band("schedules")).getByTestId("velero-open-schedule-weekly");

    fireEvent.keyDown(again, { key: "Enter" });
    fireEvent.click(again);
    await back("schedule");
    await waitFor(() => expect(document.activeElement).toBe(again));
  });

  it("gives the focus to where an object is named when the view was opened from nothing of the page", async () => {
    mount(answers());
    await page();
    // Something of the page was pointed at, long before a view opens by itself.
    fireEvent.click(screen.getByTestId("velero-overview-window-30d"));
    await act(async () => {
      vi.setSystemTime(NOW + 5000);
      await new Promise((resolve) => setTimeout(resolve, 1100));
    });
    act(() => openView({ kind: "schedule", name: "weekly" }));
    await screen.findByTestId("velero-schedule-workspace");
    fireEvent.click(screen.getByTestId("velero-back"));
    await waitFor(() => expect(screen.queryByTestId("velero-schedule-workspace")).toBeNull());
    await waitFor(() =>
      expect(document.activeElement?.getAttribute("data-testid")).toBe("velero-open-schedule-weekly"),
    );
  });

  it("has no control that writes: the ways to the lists and to the views, and the choice of the window", async () => {
    mount(answers());
    const overview = await page();
    const controls = [...overview.querySelectorAll("button, a, input, select, textarea")].map(
      (control) => control.getAttribute("data-testid") ?? (control.hasAttribute("data-line-mark") ? "mark" : ""),
    );

    expect(
      controls.filter(
        (control) =>
          control !== "mark" &&
          !control.startsWith("velero-open-") &&
          !control.startsWith("velero-overview-read-") &&
          !control.startsWith("velero-overview-window-"),
      ),
      // What shows more of a list that is there.
    ).toEqual(["velero-overview-recent-more"]);
    expect(overview.textContent).not.toMatch(/\b(delete|edit|remove|retry|run now|restore now|back up now)\b/i);
    noValueOfTheWhole();
  });

  it("does not show the answer of the installation that was selected before", async () => {
    let answer: (value: Answer) => void = () => undefined;
    const late = new Promise<Answer>((resolve) => {
      answer = resolve;
    });
    const { installation } = mount(answers({ [path("backups", A)]: () => late }));

    await waitFor(() => expect(installation.namespace).toBe(A));
    fireEvent.change(await screen.findByLabelText("Velero namespace"), { target: { value: B } });
    await waitFor(() => expect(cell("backups").textContent).toBe("Backups0"));
    await act(async () => {
      answer(list(...backups));
      await late;
    });
    expect(cell("backups").textContent).toBe("Backups0");
    expect(screen.queryByTestId("velero-overview-in-flight-list")).toBeNull();
  });

  it("stops asking when the page closes", async () => {
    vi.useFakeTimers();
    const { asked, view } = mount(answers());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(16_000);
    });
    const before = asked.length;

    expect(asked.filter((address) => address === path("backups", A)).length).toBeGreaterThanOrEqual(2);
    view.unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(120_000);
    });
    expect(asked).toHaveLength(before);
    expect(vi.getTimerCount()).toBe(0);
  });
});

const WINDOW_IDS = ["24h", "7d", "30d"] as const;
