/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

// The Overview of an installation, in a packaged Freelens, against the test
// environment: the installation whose operations are counted back from the
// time they were placed at, the one the controllers of Velero are at work in,
// and the one of the long lists. The suite reads the application and the
// cluster, and writes to neither.

import { expect } from "@jest/globals";
import * as cluster from "../helpers/velero-cluster";
import * as velero from "../helpers/velero-extension";

import type { Frame } from "playwright";

const TIMEOUT = 10 * 60 * 1000;
const OVERVIEW = cluster.OVERVIEW;
const DISCOVERY = "LIST backupstoragelocations cluster";
const KINDS = ["backups", "restores", "schedules", "backupstoragelocations", "volumesnapshotlocations"];
const BUDGET = 250;
// How long what must not happen is waited for.
const NOTHING = 1500;
// The backup the controllers of the installation made, which completed.
const LIVE = `fixture-backup-${process.env.E2E_FIXTURE_RUN}`;
const HOUR = 3_600_000;
// How far back each window of the page goes.
const WINDOWS: Record<string, number> = { "24h": 24 * HOUR, "7d": 7 * 24 * HOUR, "30d": 30 * 24 * HOUR };
// How far from the edge of the window an operation is expected on one side of it: the page reads the clock
// when it draws, and the suite when it reads what was drawn.
const MARGIN = 5 * 60_000;
// The phases of an operation that ended with a failure.
const FAILED = ["PartiallyFailed", "Failed", "FailedValidation"];
const text = (value: string) => value.replace(/\s+/g, " ").trim();
// The operations that did not start are at the time they were created, which is the same for the three
// of them to the second or not: their order among themselves is the one of their names, or of a second.
const CREATED = ["backup/flying-queued", "backup/scheduled-refused", "restore/restore-refused"];
// The ones that started, from the newest: the ones of the same time by their names.
const OF_A_DAY = [
  "backup/flying-running",
  "backup/recent-1h",
  "restore/restore-flying",
  "backup/flying-failing",
  "backup/recent-3h",
  "restore/restored-3h",
  "backup/recent-5h",
  "backup/scheduled-8h",
];
const OF_A_WEEK = [...OF_A_DAY, "backup/recent-2d", "restore/restored-3d", "backup/recent-5d"];
const OF_A_MONTH = [...OF_A_WEEK, "backup/recent-10d", "restore/restored-20d", "backup/recent-25d"];
// What needs attention with the window of seven days, in the order of the page.
const ITEMS: [rule: string, name: string][] = [
  ["A9", "restore-flying"],
  ["A9", "flying-failing"],
  // The storage by name: the time of its items is the one of a validation, which moves.
  ["A3", "overview-default"],
  ["A2", "overview-silent"],
  ["A1", "overview-unavailable"],
  ["A3", "overview-unavailable"],
  ["A7", "overview-schedule-07"],
  ["A5", "overview-schedule-07"],
  ["A6", "overview-schedule-11"],
  ["A8", "overview-schedule-11"],
  ["A10", "restore-refused"],
  ["A10", "recent-3h"],
  ["A10", "recent-2d"],
  ["A10", "restored-3d"],
];
const names = (operations: string[], kind: string) =>
  operations.filter((operation) => operation.startsWith(`${kind}/`)).map((operation) => operation.split("/")[1]);

function percentile(values: number[], fraction: number): number {
  const sorted = [...values].sort((one, other) => one - other);

  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
}

describe("overview of an installation", () => {
  let started: velero.StartedApplication;
  let frame: Frame;
  const errors = velero.createErrorCollector();
  let before: cluster.ClusterSnapshot;
  let counted: Record<string, number>;
  // How many times the suite asked the views to read again: each one looks for the installations.
  let asked = 0;
  const page = () => frame.locator("[data-testid=velero-overview]");
  // What a part of the page shows in words, as it is read: the names of the marks are not words of it.
  const words = (selector: string) =>
    frame
      .locator(selector)
      .first()
      .evaluate((element) => {
        const icons = [...element.querySelectorAll<HTMLElement>(".Icon")];
        const shown = icons.map((icon) => icon.style.display);

        for (const icon of icons) icon.style.display = "none";
        const said = (element as HTMLElement).innerText.replace(/\s+/g, " ").trim();

        icons.forEach((icon, index) => {
          icon.style.display = shown[index];
        });
        return said;
      });
  const item = (rule: string, kind: string, name: string) =>
    words(
      `[data-testid=velero-overview-attention] [data-rule="${rule}"]:has([data-testid="velero-open-${kind}-${name}"])`,
    );
  // A picture of the page with a band at its top: a band under what the window holds is in no picture.
  const picture = async (band: string, name: string) => {
    const scrolled = await frame.evaluate((id) => {
      const page = document.querySelector<HTMLElement>("[data-testid=velero-overview]");
      const element = document.querySelector<HTMLElement>(`[data-testid=velero-overview-${id}]`);

      if (!page || !element) throw new Error(`The band ${id} is not shown`);
      const moved: string[] = [];

      element.scrollIntoView({ block: "start" });

      // What holds the page is not scrolled by who reads it: the page is, inside its room.
      for (let holder = page.parentElement; holder; holder = holder.parentElement) {
        if (holder.scrollTop !== 0) {
          moved.push(
            `${holder.tagName.toLowerCase()}.${String(holder.className).split(" ")[0]} by ${holder.scrollTop}, ` +
              `${holder.scrollHeight} in ${holder.clientHeight}, ${getComputedStyle(holder).overflowY}`,
          );
          holder.scrollTop = 0;
        }
      }
      return moved;
    }, band);

    expect([name, scrolled]).toEqual([name, []]);
    await frame.waitForTimeout(300);
    await cluster.captureScreenshot(frame, name);
    await cluster.scrollOverview(frame, 0);
  };
  const showEvery = async (band: "attention" | "in-flight" | "recent") => {
    const more = frame.locator(`[data-testid=velero-overview-${band}-more]`);

    for (let pages = 0; pages < 50 && (await more.count()) > 0; pages += 1) await more.click();
  };
  // The marks of a row of the line of time, as the operations each one holds, from the oldest.
  const marks = async (row: "backups" | "restores") =>
    (await cluster.overview(frame)).marks[row].flatMap((mark) => mark.split(","));
  const open = async (selector: string, kind: string, name: string) => {
    await frame.locator(selector).first().click();
    await frame.waitForSelector(`[data-testid=velero-${kind}-name] >> text="${name}"`, { timeout: 60_000 });
    const shown = await cluster.shownView(frame);

    expect(shown).toEqual({ kind, name, back: "arrow_back Overview" });
    // The Overview is under the view, and the address names the view.
    expect(await frame.locator("[data-testid=velero-overview-page]").count()).toBe(1);
    expect(await cluster.addressViews(frame)).toEqual([`${kind}/${name}`]);
  };
  const back = async () => {
    await cluster.closeWorkspace(frame);
    await page().waitFor({ state: "visible", timeout: 60_000 });
    expect(await cluster.shownView(frame)).toBeUndefined();
    expect(await cluster.addressViews(frame)).toEqual([]);
  };
  const held = (resource: string, namespace: string) => {
    const read = cluster.kubectlE2E("get", `${resource}.velero.io`, "--namespace", namespace, "-o", "name");

    if (read.status !== 0) throw new Error(`The ${resource} of ${namespace} could not be read`);
    return read.stdout
      .split("\n")
      .filter(Boolean)
      .map((name) => name.split("/")[1]);
  };
  // The operations of an installation as the cluster holds them, each at the time the views place it at: its
  // start, or its creation when it did not start; and when it completed, when it says so.
  const operationsOf = (namespace: string) =>
    (["backup", "restore"] as const).flatMap((kind) => {
      const read = cluster.kubectlE2E("get", `${kind}s.velero.io`, "--namespace", namespace, "-o", "json");

      if (read.status !== 0) throw new Error(`The ${kind}s of ${namespace} could not be read`);
      return (
        JSON.parse(read.stdout) as {
          items: {
            metadata: { name: string; creationTimestamp: string };
            status?: {
              phase?: string;
              startTimestamp?: string;
              completionTimestamp?: string;
              validationErrors?: string[];
            };
          }[];
        }
      ).items.map(({ metadata, status }) => ({
        kind,
        name: metadata.name,
        phase: status?.phase ?? "",
        time: Date.parse(status?.startTimestamp ?? metadata.creationTimestamp),
        completed: status?.completionTimestamp === undefined ? undefined : Date.parse(status.completionTimestamp),
        validation: status?.validationErrors?.length ?? 0,
      }));
    });
  type Operation = ReturnType<typeof operationsOf>[number];
  const byName = (one: Operation, other: Operation) => (one.name < other.name ? -1 : one.name > other.name ? 1 : 0);
  // The order the page finds the newest completed backup by: when each completed, the newest first, and of
  // two that completed at the same time the first by its name; one that does not say when it completed goes
  // after the ones that say it, and of two that do not, the newest by the time the views place it at.
  const completedFirst = (one: Operation, other: Operation) => {
    if (one.completed === undefined || other.completed === undefined) {
      if (one.completed !== other.completed) return one.completed === undefined ? 1 : -1;
      return other.time - one.time || byName(one, other);
    }
    return other.completed - one.completed || byName(one, other);
  };

  beforeAll(async () => {
    if (!cluster.fixturesReady()) {
      throw new Error(cluster.fixturesMissing());
    }
    before = cluster.clusterSnapshot();
    errors.start();
    let kubeconfig = "";

    // The kubeconfig is in the profile before the install is asked, for each start of the application.
    started = await velero.startWithExtension(async () => {
      kubeconfig = await cluster.publishKubeconfig();
    });
    errors.watch(started.window);
    await velero.dismissNotifications(started.window);
    await velero.navigateToCatalog(started.app);
    expect(await velero.catalogClusterCount(started.window)).toBe(1);
    // What the API server counted before the frame of the cluster, and the extension in it, is there.
    counted = cluster.apiRequests();
    frame = await cluster.openClusterFromCatalog(started.window, kubeconfig);
    await velero.setWindowSize(started.app, 1440, 900);
    await cluster.countAddressChanges(frame);
  }, TIMEOUT);

  afterAll(async () => {
    if (started) errors.stop(started.window);
    await started?.cleanup();
  }, TIMEOUT);

  it(
    "is the first entry under Velero, and reads no family before an installation is chosen",
    async () => {
      // The entry of a group opens the group, in the host: it leads to no page, and asks nothing.
      await cluster.clickSidebarItem(frame, cluster.sidebarLinkTestId("velero"));
      await frame.waitForSelector(`[data-parent-id-test="${cluster.sidebarItemTestId("velero")}"]`, {
        timeout: 60_000,
      });
      await frame.waitForTimeout(NOTHING);
      expect(await frame.locator("[data-testid^=velero-][data-testid$=-page]").count()).toBe(0);
      expect(cluster.clusterReads(cluster.apiRequests())).toEqual(cluster.clusterReads(counted));
      await cluster.openPage(frame, OVERVIEW);
      // The entry of the group is marked with the Overview, which is the page it names.
      expect(
        await frame
          .locator(`[data-testid="${cluster.sidebarItemTestId("velero")}"]`)
          .getAttribute("data-is-active-test"),
      ).toBe("true");
      expect(await cluster.veleroSidebarEntries(frame)).toEqual({
        velero: "Velero",
        "velero-overview": "Overview",
        "velero-backups": "Backups",
        "velero-restores": "Restores",
        "velero-schedules": "Schedules",
        "velero-storage-locations": "Backup Storage Locations",
        "velero-snapshot-locations": "Volume Snapshot Locations",
      });
      expect((await frame.locator(".TabLayout .Tabs .Tab").allInnerTexts()).map(text)).toEqual([
        "Overview",
        "Backups",
        "Restores",
        "Schedules",
        "Backup Storage Locations",
        "Volume Snapshot Locations",
      ]);
      expect(text(await frame.locator(".TabLayout .Tabs .Tab.active").innerText())).toBe("Overview");
      expect(await frame.locator(".TabLayout .TabLayout").count()).toBe(0);
      // No installation is chosen: the page asks which one, as every page does, and shows nothing of any.
      await frame.waitForSelector("[data-testid=velero-state-choose]", { timeout: 60_000 });
      expect(await frame.locator("[data-testid^=velero-choice-]").count()).toBe(cluster.SUGGESTED_NAMESPACES.length);
      expect(await page().count()).toBe(0);
      const opened = cluster.apiRequests();

      expect(opened[DISCOVERY]).toBe((counted[DISCOVERY] ?? 0) + 1);
      expect(cluster.clusterReads(opened)).toEqual({
        ...cluster.clusterReads(counted),
        [DISCOVERY]: (counted[DISCOVERY] ?? 0) + 1,
      });
      expect(await cluster.layoutProblems(frame, OVERVIEW)).toEqual([]);
      // The installation is chosen: its five families are read, in its namespace, and nothing of the
      // whole cluster is asked again.
      await frame.click(`[data-testid="velero-choice-${cluster.E2E_OVERVIEW_NAMESPACE}"]`);
      await cluster.overview(frame);
      await frame.waitForTimeout(1500);
      const read = cluster.apiRequests();

      for (const kind of KINDS) {
        const key = `LIST ${kind} namespace`;

        expect([key, (read[key] ?? 0) - (opened[key] ?? 0) >= 1]).toEqual([key, true]);
      }
      expect(cluster.clusterReads(read)).toEqual(cluster.clusterReads(opened));
      expect((await cluster.target(frame)).namespace).toBe(cluster.E2E_OVERVIEW_NAMESPACE);
    },
    TIMEOUT,
  );

  it(
    "asks the cluster nothing of its own when it is opened from another page",
    async () => {
      await cluster.openPage(frame, cluster.BACKUPS);
      await cluster.waitForBackups(frame);
      expect(
        await cluster.readsDuring(
          frame,
          async () => {
            await cluster.openPage(frame, OVERVIEW);
            await cluster.overview(frame);
          },
          () => cluster.openPage(frame, cluster.BACKUPS),
        ),
      ).toEqual({});
      expect(await page().count()).toBe(1);
    },
    TIMEOUT,
  );

  it(
    "says how many objects of each of the five families were read",
    async () => {
      const shown = await cluster.overview(frame);

      expect(shown.read).toEqual({
        backups: { text: "Backups 13", state: "read" },
        restores: { text: "Restores 6", state: "read" },
        schedules: { text: "Schedules 12", state: "read" },
        storageLocations: { text: "Backup Storage Locations 3", state: "read" },
        snapshotLocations: { text: "Volume Snapshot Locations 0", state: "read" },
      });
      // The numbers are the ones of the cluster, read by the suite and not by the application.
      expect(KINDS.map((kind) => held(kind, cluster.E2E_OVERVIEW_NAMESPACE).length)).toEqual([13, 6, 12, 3, 0]);
      expect(await cluster.notices(frame, [])).toEqual({});
      expect(await cluster.layoutProblems(frame, OVERVIEW)).toEqual([]);
      await cluster.captureScreenshot(frame, "dark-overview");
    },
    TIMEOUT,
  );

  it(
    "lists what needs attention by its rules, in the order of the page, with the reason of each",
    async () => {
      const shown = await cluster.overview(frame);

      expect(shown.window).toBe("7d");
      expect(shown.summary).toBe("14 items in what was read.");
      expect(shown.unchecked).toEqual([]);
      // Ten at a time: what is first is read first, and the ones that follow are asked for.
      expect(shown.items).toEqual(ITEMS.slice(0, 10));
      expect(text(await frame.locator("[data-testid=velero-overview-attention-more]").innerText())).toBe(
        "Show 4 more of the 4 items that follow",
      );
      await showEvery("attention");
      expect((await cluster.overview(frame)).items).toEqual(ITEMS);
      expect(await frame.locator("[data-testid=velero-overview-attention-more]").count()).toBe(0);
      // Each item says its group, what it is of, and its reason in words.
      expect(await item("A9", "restore", "restore-flying")).toMatch(
        /^In flight: restore-flying .+ Finalizing: 1 error\.$/,
      );
      expect(await item("A1", "storage-location", "overview-unavailable")).toMatch(
        /^Storage: overview-unavailable .+ Velero reports it unavailable: Synthetic storage failure; no endpoint was contacted\. Last validated 3d( \d+h)? ago\.$/,
      );
      expect(await item("A2", "storage-location", "overview-silent")).toBe(
        "Storage: overview-silent Velero has not reported on it.",
      );
      expect(await item("A3", "storage-location", "overview-default")).toMatch(
        /^Storage: overview-default .+ Last validated 2d( \d+h)? ago\. The availability may be out of date: the last validation is older than one hour, by the clock of this machine\.$/,
      );
      expect(await item("A5", "schedule", "overview-schedule-07")).toBe(
        "Schedules: overview-schedule-07 Velero refused its expression: invalid schedule: expected exactly 5 fields, found 2: [every night].",
      );
      expect(await item("A6", "schedule", "overview-schedule-11")).toBe(
        "Schedules: overview-schedule-11 Velero has not read this schedule yet.",
      );
      expect(await item("A7", "schedule", "overview-schedule-07")).toMatch(
        /^Schedules: overview-schedule-07 .+ Its newest backup, scheduled-refused, ended with a failure\. Failed validation: 1 validation error\. scheduled-refused$/,
      );
      expect(await item("A8", "schedule", "overview-schedule-11")).toBe(
        "Schedules: overview-schedule-11 Its template names the storage location overview-unavailable. The release refuses a backup sent to this location: Velero reports it Unavailable. overview-unavailable",
      );
      expect(await item("A10", "restore", "restore-refused")).toMatch(
        /^Ended: restore-refused .+ Failed validation: 1 validation error\.$/,
      );
      expect(await item("A10", "backup", "recent-2d")).toMatch(/^Ended: recent-2d .+ Partially failed: 1 error\.$/);
      // The paused schedule, the one whose newest backup completed and the backup of a schedule that
      // failed before its newest one are no items: none of them is named.
      const named = (await cluster.overview(frame)).items.map(([, name]) => name);

      expect(named).not.toContain("overview-schedule-05");
      expect(named).not.toContain("overview-schedule-01");
      expect(named).not.toContain("scheduled-refused");
      expect(await cluster.valuesOfTheWhole(frame)).toEqual([]);
      expect(await cluster.layoutProblems(frame, OVERVIEW)).toEqual([]);
      await picture("attention", "dark-overview-attention");
    },
    TIMEOUT,
  );

  it(
    "lists what is in flight from the oldest, with what each one reports",
    async () => {
      const shown = await cluster.overview(frame);

      expect(shown.inFlight).toEqual([
        "backup/flying-failing",
        "restore/restore-flying",
        "backup/flying-running",
        "backup/flying-queued",
      ]);
      expect(text(await frame.locator("[data-testid=velero-overview-in-flight-count]").innerText())).toBe(
        "4 in flight, from the oldest.",
      );
      // The band has half the page: an operation is two lines, its kind beside its name, and when it
      // started is what the elapsed time says to who points at it.
      expect(await cluster.operationCells(frame, "in-flight", "backup/flying-failing")).toEqual({
        operation: "flying-failing",
        kind: "backup",
        phase: "Waiting for plugin operations",
        failure: "1 error",
        progress: "Items: 10 / 10 (100%)",
        elapsed: expect.stringMatching(/^\d+h( \d+m)? so far$/),
      });
      expect(await cluster.operationCells(frame, "in-flight", "backup/flying-running")).toEqual({
        operation: "flying-running",
        kind: "backup",
        phase: "In progress",
        failure: "No failure reported",
        progress: "Items: 4 / 10 (40%)",
        elapsed: expect.stringMatching(/ so far$/),
      });
      // One that waits did not start: it is at the time it was created, and that is said.
      expect(await cluster.operationCells(frame, "in-flight", "backup/flying-queued")).toEqual({
        operation: "flying-queued",
        kind: "backup",
        phase: "Queued",
        failure: "No failure reported",
        progress: "Items: Not reported",
        elapsed: "Not started",
      });
      expect(
        await frame
          .locator('[data-testid=velero-overview-in-flight-list] [data-operation="backup/flying-queued"] [data-time]')
          .evaluate((cell) => [cell.getAttribute("data-time"), cell.getAttribute("title")]),
      ).toEqual(["creation", expect.stringMatching(/ \(created, did not start\)$/)]);
      expect(await cluster.operationCells(frame, "in-flight", "restore/restore-flying")).toMatchObject({
        operation: "restore-flying",
        kind: "restore",
        phase: "Finalizing",
        failure: "1 error",
      });
      // The list of the recent operations has the page: each of them has its kind and its time.
      expect(await cluster.operationCells(frame, "recent", "backup/flying-queued")).toEqual({
        operation: "flying-queued",
        kind: "backup",
        phase: "Queued",
        failure: "No failure reported",
        progress: "Not reported",
        time: expect.stringMatching(/ \(created, did not start\)$/),
        duration: "Not started",
      });
    },
    TIMEOUT,
  );

  it(
    "names the newest completed backup, of the installation and of each schedule, and says what completed means",
    async () => {
      const shown = await cluster.overview(frame);

      expect(shown.completed).toMatch(/^recent-1h completed \S/);
      expect(await words("[data-testid=velero-overview-completed]")).toContain(
        "Completed is what Velero reports of a backup. It is not a test of a restore: nothing here says that a backup can be restored.",
      );
      const line = (schedule: string) =>
        words(`[data-testid=velero-overview-schedules-list] [data-line="${schedule}"] [data-completed]`);

      expect(await line("overview-schedule-01")).toMatch(/^recent-1h completed \S/);
      // The newest backup of the schedule failed its validation: the newest that completed is the one before.
      expect(await line("overview-schedule-07")).toMatch(/^scheduled-8h completed \S/);
      expect(await line("overview-schedule-02")).toBe("None among the backups that exist");
    },
    TIMEOUT,
  );

  it(
    "shows the operations of the window on the line of time and in the list under it, for each of the three windows",
    async () => {
      const recent = async () => {
        await showEvery("recent");
        return (await cluster.overview(frame)).recent;
      };
      const expectWindow = async (window: string, started: string[]) => {
        const first = await cluster.overview(frame);

        expect(first.window).toBe(window);
        // Ten at a time, from the newest.
        expect(first.recent).toHaveLength(10);
        const listed = await recent();

        expect([...listed.slice(0, 3)].sort()).toEqual(CREATED);
        expect(listed.slice(3)).toEqual(started);
        // The line has the same operations, each one in the row of its kind, and nothing else.
        expect((await marks("backups")).sort()).toEqual(names([...CREATED, ...started], "backup").sort());
        expect((await marks("restores")).sort()).toEqual(names([...CREATED, ...started], "restore").sort());
        expect(await cluster.layoutProblems(frame, OVERVIEW)).toEqual([]);
        return first;
      };
      const week = await expectWindow("7d", OF_A_WEEK);

      await cluster.chooseWindow(frame, "24h");
      const day = await expectWindow("24h", OF_A_DAY);

      expect(day.from).not.toBe(week.from);
      expect(text(await frame.locator("[data-testid=velero-overview-line-to]").innerText())).toBe("Now");
      // What ended with a failure before the window is no item of it.
      await showEvery("attention");
      expect((await cluster.overview(frame)).items).toEqual(
        ITEMS.filter(([, name]) => name !== "recent-2d" && name !== "restored-3d"),
      );
      // With a day on the line the operations of an hour apart have a mark each, and the one that did
      // not start has the mark that says so.
      const restores = frame.locator("[data-line-row=restores] [data-line-mark]");

      expect(
        await restores.evaluateAll((elements) =>
          elements.map((element) => [
            element.getAttribute("data-line-mark"),
            element.getAttribute("data-failing"),
            element.getAttribute("data-not-started"),
          ]),
        ),
      ).toEqual([
        ["restored-3h", "false", "false"],
        ["restore-flying", "true", "false"],
        ["restore-refused", "true", "true"],
      ]);
      expect(await restores.nth(2).getAttribute("aria-label")).toMatch(
        /^restore-refused, Failed validation, 1 validation error, Created, did not start /,
      );
      expect(text(await restores.nth(2).locator(".Icon").innerText())).toBe("block");
      await picture("recent", "dark-overview-window-24h");
      await cluster.chooseWindow(frame, "30d");
      const month = await expectWindow("30d", OF_A_MONTH);

      expect(month.from).not.toBe(week.from);
      await showEvery("attention");
      expect((await cluster.overview(frame)).items).toEqual([...ITEMS, ["A10", "recent-25d"]]);
      // What is older than every window is in no window, and is in the list of its kind.
      expect(await recent()).not.toContain("backup/recent-40d");
      expect(await frame.locator("[data-testid=velero-overview-untimed]").count()).toBe(0);
      await picture("recent", "dark-overview-window-30d");
    },
    TIMEOUT,
  );

  it(
    "shows alone the operations of a mark that holds more than one, and all of them again",
    async () => {
      // With thirty days on the line the operations of the last day are close to each other.
      const group = frame.locator("[data-line-row=backups] [data-line-mark*=',']").last();
      const together = ((await group.getAttribute("data-line-mark")) ?? "").split(",");

      expect(together.length).toBeGreaterThan(1);
      expect(text(await group.innerText())).toBe(String(together.length));
      expect(await group.getAttribute("aria-label")).toMatch(
        new RegExp(`^${together.length} backups close to each other\\. one of them at least with a failure\\. `),
      );
      await group.click();
      expect(await group.getAttribute("aria-pressed")).toBe("true");
      expect(text(await frame.locator("[data-testid=velero-overview-shown]").innerText())).toBe(
        `The ${together.length} operations of one mark are shown. Show all`,
      );
      await showEvery("recent");
      expect((await cluster.overview(frame)).recent.sort()).toEqual(together.map((name) => `backup/${name}`).sort());
      // No view was opened: a mark of many is a choice of what the list shows.
      expect(await cluster.shownView(frame)).toBeUndefined();
      await frame.click("[data-testid=velero-overview-shown] button");
      expect(await frame.locator("[data-testid=velero-overview-shown]").count()).toBe(0);
      expect(await group.getAttribute("aria-pressed")).toBe("false");
      expect((await cluster.overview(frame)).recent).toHaveLength(10);
      await cluster.chooseWindow(frame, "7d");
    },
    TIMEOUT,
  );

  it(
    "gives a line to ten of the twelve schedules, the ones a rule names first, and to each storage location",
    async () => {
      const shown = await cluster.overview(frame);

      expect(shown.schedules).toEqual([
        "overview-schedule-07",
        "overview-schedule-11",
        "overview-schedule-01",
        "overview-schedule-02",
        "overview-schedule-03",
        "overview-schedule-04",
        "overview-schedule-05",
        "overview-schedule-06",
        "overview-schedule-08",
        "overview-schedule-09",
      ]);
      expect(await words("[data-testid=velero-overview-schedules-others]")).toBe("2 more in the list of the schedules");
      expect(await words('[data-testid=velero-overview-schedules-list] [data-line="overview-schedule-05"]')).toBe(
        "overview-schedule-05 Enabled Paused None among the backups that exist",
      );
      expect(await words('[data-testid=velero-overview-schedules-list] [data-line="overview-schedule-07"]')).toMatch(
        /^overview-schedule-07 Failed validation Not paused scheduled-8h completed /,
      );
      expect(shown.storage).toEqual(["overview-default", "overview-silent", "overview-unavailable"]);
      expect(await frame.locator("[data-testid=velero-overview-storage-others]").count()).toBe(0);
      expect(await words('[data-testid=velero-overview-storage-list] [data-line="overview-default"]')).toMatch(
        /^overview-default Available Read and write Marked default 2d( \d+h)? ago, may be out of date$/,
      );
      expect(await words('[data-testid=velero-overview-storage-list] [data-line="overview-silent"]')).toBe(
        "overview-silent Not reported Not set Not marked Never validated",
      );
      // The others are in the list of the schedules, which has the twelve of them.
      await frame.click("[data-testid=velero-overview-schedules-all]");
      await frame.waitForSelector("[data-testid=velero-schedules-page]", { timeout: 60_000 });
      await cluster.waitForList(frame, cluster.SCHEDULES);
      expect(await cluster.mounted(frame, cluster.SCHEDULES)).toHaveLength(12);
      await cluster.openPage(frame, OVERVIEW);
      await cluster.overview(frame);
    },
    TIMEOUT,
  );

  it(
    "leads from every part of the page to an object or to a list, and back to where it was",
    async () => {
      // The cells of what was read lead to the lists.
      for (const [family, list] of [
        ["backups", cluster.BACKUPS],
        ["restores", cluster.RESTORES],
        ["schedules", cluster.SCHEDULES],
        ["storageLocations", cluster.STORAGE_LOCATIONS],
        ["snapshotLocations", cluster.SNAPSHOT_LOCATIONS],
      ] as const) {
        await frame.click(`[data-testid=velero-overview-read-${family}]`);
        await frame.waitForSelector(`[data-testid=velero-${list.id}-page]`, { timeout: 60_000 });
        expect((await cluster.target(frame)).namespace).toBe(cluster.E2E_OVERVIEW_NAMESPACE);
        await cluster.openPage(frame, OVERVIEW);
        await cluster.overview(frame);
      }
      const attention = "[data-testid=velero-overview-attention]";

      // An item leads to its object, and to the other object its reason names.
      await open(
        `${attention} [data-rule=A1] [data-testid="velero-open-storage-location-overview-unavailable"]`,
        "storage-location",
        "overview-unavailable",
      );
      await back();
      // Who comes back is on what they had opened the view from.
      expect(await cluster.focusOn(frame, "velero-open-storage-location-overview-unavailable")).toBe(
        "velero-open-storage-location-overview-unavailable",
      );
      expect(
        await frame.evaluate(() => document.activeElement?.closest("[data-rule]")?.getAttribute("data-rule") ?? ""),
      ).toBe("A1");
      await open(
        `${attention} [data-rule=A7] [data-testid="velero-open-backup-scheduled-refused"]`,
        "backup",
        "scheduled-refused",
      );
      await back();
      await open(
        `${attention} [data-rule=A5] [data-testid="velero-open-schedule-overview-schedule-07"]`,
        "schedule",
        "overview-schedule-07",
      );
      await back();
      await open(
        `${attention} [data-rule=A9] [data-testid="velero-open-restore-restore-flying"]`,
        "restore",
        "restore-flying",
      );
      // From the view to the backup the restore names, and back to the restore and to the page.
      await cluster.followTo(frame, "backup", "recent-5d");
      expect(await cluster.shownView(frame)).toEqual({
        kind: "backup",
        name: "recent-5d",
        back: "arrow_back Restores / restore-flying",
      });
      await cluster.closeWorkspace(frame);
      expect(await cluster.shownView(frame)).toEqual({
        kind: "restore",
        name: "restore-flying",
        back: "arrow_back Overview",
      });
      await back();
      await open(
        '[data-testid=velero-overview-completed] [data-testid="velero-open-backup-recent-1h"]',
        "backup",
        "recent-1h",
      );
      await back();
      await open(
        '[data-testid=velero-overview-in-flight-list] [data-testid="velero-open-backup-flying-running"]',
        "backup",
        "flying-running",
      );
      await back();
      await open(
        '[data-testid=velero-overview-recent-list] [data-testid="velero-open-restore-restored-3h"]',
        "restore",
        "restored-3h",
      );
      await back();
      await open(
        '[data-testid=velero-overview-schedules-list] [data-testid="velero-open-schedule-overview-schedule-05"]',
        "schedule",
        "overview-schedule-05",
      );
      await back();
      await open(
        '[data-testid=velero-overview-storage-list] [data-testid="velero-open-storage-location-overview-silent"]',
        "storage-location",
        "overview-silent",
      );
      await back();
      // The location is named in its item and in its line: who comes back is on the one that was used,
      // after as many views as were opened before this one.
      expect(await cluster.focusOn(frame, "velero-open-storage-location-overview-silent")).toBe(
        "velero-open-storage-location-overview-silent",
      );
      expect(
        await frame.evaluate(
          () => document.activeElement?.closest("[data-testid=velero-overview-storage-list]") !== null,
        ),
      ).toBe(true);
      // A mark of one operation leads to it.
      await open('[data-line-row=restores] [data-line-mark="restored-3d"]', "restore", "restored-3d");
      await back();
      await frame.waitForFunction(
        () => document.activeElement?.getAttribute("data-line-mark") === "restored-3d",
        undefined,
        { timeout: 10_000 },
      );
      // Every way of the page is to an object that the installation holds, of a kind that has a view.
      await showEvery("attention");
      await showEvery("recent");
      const ways = await page()
        .locator("[data-testid^=velero-open-]")
        .evaluateAll((elements) => [...new Set(elements.map((element) => element.getAttribute("data-testid") ?? ""))]);
      const objects = {
        backup: held("backups", cluster.E2E_OVERVIEW_NAMESPACE),
        restore: held("restores", cluster.E2E_OVERVIEW_NAMESPACE),
        schedule: held("schedules", cluster.E2E_OVERVIEW_NAMESPACE),
        "storage-location": held("backupstoragelocations", cluster.E2E_OVERVIEW_NAMESPACE),
      };

      // The fourteen operations of the window, ten schedules and three storage locations.
      expect(ways).toHaveLength(27);
      expect(
        ways.filter((way) => {
          const found = /^velero-open-(backup|restore|schedule|storage-location)-(.+)$/.exec(way);

          return !found || !objects[found[1] as keyof typeof objects].includes(found[2]);
        }),
      ).toEqual([]);
      // Nothing of the page edits or deletes, and with writes off nothing of it asks Velero for something:
      // its buttons are ways, windows, marks, what shows more of a list, and the way to the writes in the
      // target bar, which the band of the server offers while they are off and which creates nothing.
      expect(
        await page()
          .locator("button")
          .evaluateAll((elements) =>
            elements
              .filter(
                (element) =>
                  !/^velero-open-|^velero-overview-window-|^velero-overview-[a-z-]+-more$/.test(
                    element.getAttribute("data-testid") ?? "",
                  ) && !element.hasAttribute("data-line-mark"),
              )
              .map((element) => element.getAttribute("data-testid") ?? (element.textContent ?? "").trim()),
          ),
      ).toEqual(["velero-overview-server-to-target"]);
      expect(await frame.locator("[data-testid=velero-writes]").getAttribute("data-writes")).toBe("off");
    },
    TIMEOUT,
  );

  it(
    "lists and counts what ended with a failure inside the window, with the backups synced from the store at the time they started",
    async () => {
      const run = cluster.E2E_FIXTURE_RUN;

      await cluster.selectInstallation(frame, cluster.E2E_NAMESPACE);
      await frame.waitForSelector(`[data-testid="velero-open-backup-${LIVE}"]`, {
        timeout: 60_000,
      });
      const shown = await cluster.overview(frame);

      expect(Object.keys(WINDOWS)).toContain(shown.window);
      // The edge of the window the page shows, by the clock of the suite.
      const from = Date.now() - WINDOWS[shown.window];
      const operations = operationsOf(cluster.E2E_NAMESPACE);
      const of = (kind: string) => operations.filter((operation) => operation.kind === kind);

      // The installation holds the backup its controllers ran and its restore, the two backups the server
      // synced from the store, and the three operations it refused, all of this run: what was read is what
      // the cluster holds, counted by the suite and not by the application.
      expect(operations.map(({ kind, name }) => `${kind}/${name}`).sort()).toEqual(
        [
          `backup/${LIVE}`,
          `backup/fixture-synced-backup-${run}`,
          `backup/fixture-synced-backup-no-log-${run}`,
          `backup/fixture-invalid-backup-${run}`,
          `restore/fixture-restore-${run}`,
          `restore/fixture-invalid-restore-${run}`,
          `restore/fixture-orphan-restore-${run}`,
        ].sort(),
      );
      expect(shown.read).toEqual({
        backups: { text: `Backups ${of("backup").length}`, state: "read" },
        restores: { text: `Restores ${of("restore").length}`, state: "read" },
        schedules: { text: "Schedules 0", state: "read" },
        storageLocations: { text: "Backup Storage Locations 1", state: "read" },
        snapshotLocations: { text: "Volume Snapshot Locations 0", state: "read" },
      });
      // What ended with a failure is an item while its time is inside the window: the creation of what the
      // server refused, which did not start, and the start of the backups synced from the store, four hundred
      // days back. The installation has no schedule: each one is an item of its own. Within five minutes of
      // the edge the page and the suite may see it on two sides: what is there is expected neither way.
      const failed = operations.filter((operation) => FAILED.includes(operation.phase));
      const edge = failed.filter((operation) => Math.abs(operation.time - from) <= MARGIN).map(({ name }) => name);
      const inside = failed
        .filter((operation) => operation.time > from + MARGIN)
        .sort((one, other) => other.time - one.time || (one.name < other.name ? -1 : 1));

      expect(shown.items.filter(([, name]) => !edge.includes(name))).toEqual(inside.map(({ name }) => ["A10", name]));
      expect(shown.summary).toBe(
        shown.items.length
          ? `${shown.items.length} item${shown.items.length === 1 ? "" : "s"} in what was read.`
          : "Nothing in what was read needs attention.",
      );
      // Each says that its operation ended, and why: a validation that failed, with as many errors as the
      // cluster holds of it.
      for (const operation of inside.filter(({ phase }) => phase === "FailedValidation")) {
        const errors = `${operation.validation} validation error${operation.validation === 1 ? "" : "s"}`;

        expect(await item("A10", operation.kind, operation.name)).toMatch(
          new RegExp(`^Ended: ${operation.name} .+ Failed validation: ${errors}\\.$`),
        );
      }
      expect(shown.unchecked).toEqual([]);
      expect(shown.inFlight).toEqual([]);
      expect(text(await frame.locator("[data-testid=velero-overview-in-flight-none]").innerText())).toBe(
        "No backup and no restore is in flight.",
      );
      // The newest completed backup is the one the controllers ran, by the time each one completed, as the page
      // orders them: the synced backup that completed was created after it, and completed four hundred days
      // back.
      expect(
        of("backup")
          .filter(({ phase }) => phase === "Completed")
          .sort(completedFirst)[0]?.name,
      ).toBe(LIVE);
      expect(shown.completed).toMatch(new RegExp(`^${LIVE} completed \\S`));
      expect(await words("[data-testid=velero-overview-schedules]")).toBe(
        "Schedules No schedule is in this installation.",
      );
      // The location the controller of the installation validates every minute is not late.
      expect(shown.storage).toEqual(["default"]);
      expect(await words('[data-testid=velero-overview-storage-list] [data-line="default"]')).toMatch(
        /^default Available .+ Marked default \d+s ago$|^default Available .+ Marked default 1m( \d+s)? ago$/,
      );
      expect(await cluster.valuesOfTheWhole(frame)).toEqual([]);
      expect(await cluster.layoutProblems(frame, OVERVIEW)).toEqual([]);
      await cluster.captureScreenshot(frame, "dark-overview-demo");
    },
    TIMEOUT,
  );

  it(
    "gives no value for an installation as a whole, in any of the installations of the fixtures",
    async () => {
      const rules: Record<string, string[]> = {};
      // What the rule of the default names in each installation.
      const defaults: Record<string, string[]> = {};

      for (const namespace of [
        cluster.E2E_STATIC_NAMESPACE,
        cluster.E2E_VIEWS_NAMESPACE,
        cluster.E2E_DEFAULTS_NAMESPACE,
        cluster.E2E_OVERVIEW_NAMESPACE,
      ]) {
        await cluster.selectInstallation(frame, namespace);
        await frame.waitForFunction(
          (expected) =>
            (document.querySelector("[data-testid=velero-target] .Select__single-value")?.textContent ?? "").startsWith(
              expected,
            ) && document.querySelector("[data-testid=velero-overview-read-storageLocations][data-read=read]") !== null,
          namespace,
          { timeout: 60_000 },
        );
        await showEvery("attention");
        const shown = await cluster.overview(frame);

        rules[namespace] = [...new Set(shown.items.map(([rule]) => rule))].sort();
        defaults[namespace] = shown.items.filter(([rule]) => rule === "A4").map(([, name]) => name);
        expect([namespace, await cluster.valuesOfTheWhole(frame)]).toEqual([namespace, []]);
        expect([namespace, await cluster.layoutProblems(frame, OVERVIEW)]).toEqual([namespace, []]);
        expect([namespace, shown.summary]).toEqual([
          namespace,
          `${shown.items.length} item${shown.items.length === 1 ? "" : "s"} in what was read.`,
        ]);
      }
      // The installation of the phases marks no location default: the item is of no single location,
      // and leads to their list. The one of the two defaults marks one that is read-only: the item is
      // of that location.
      expect(defaults[cluster.E2E_STATIC_NAMESPACE]).toEqual(["Default storage location"]);
      expect(defaults[cluster.E2E_DEFAULTS_NAMESPACE]).toEqual(["defaults-older"]);
      expect(defaults[cluster.E2E_OVERVIEW_NAMESPACE]).toEqual([]);
      // Every rule gave an item on the cluster, in one installation or in another.
      expect([...new Set(Object.values(rules).flat())].sort()).toEqual(
        ["A1", "A10", "A2", "A3", "A4", "A5", "A6", "A7", "A8", "A9"].sort(),
      );
    },
    TIMEOUT,
  );

  it(
    "answers a change of the window within the budget with two thousand operations, twenty times over",
    async () => {
      await cluster.configureInstallation(frame, cluster.E2E_SCALE_NAMESPACE);
      await frame.waitForSelector("[data-testid=velero-overview-read-backups][data-read=read] >> text=1000", {
        timeout: 60_000,
      });
      const shown = await cluster.overview(frame);

      expect(shown.read.backups).toEqual({ text: "Backups 1000", state: "read" });
      expect(shown.read.restores).toEqual({ text: "Restores 1000", state: "read" });
      expect(shown.window).toBe("7d");
      // Warm: the first changes load what the ones after find loaded.
      for (const window of ["24h", "30d", "7d"]) await cluster.measureWindow(frame, window);
      const order = ["24h", "30d", "7d"];
      const times: ({ interaction: string } & cluster.Measure)[] = [];
      const holds: Record<string, { marks: number; listed: number }> = {};

      for (let index = 0; index < 20; index += 1) {
        const window = order[index % order.length];

        times.push({ interaction: `${index + 1}: ${window}`, ...(await cluster.measureWindow(frame, window)) });
        const changed = await cluster.overview(frame);

        expect(changed.window).toBe(window);
        holds[window] = {
          marks: changed.marks.backups.length + changed.marks.restores.length,
          listed: changed.recent.length,
        };
      }
      const rounded = (values: number[]) => ({
        p95: Math.round(percentile(values, 0.95)),
        median: Math.round(percentile(values, 0.5)),
        slowest: Math.round(Math.max(...values)),
      });
      const report = {
        backups: 1000,
        restores: 1000,
        interactions: times.length,
        budget: BUDGET,
        response: rounded(times.map((time) => time.response)),
        holds,
        times: times.map((time) => ({ interaction: time.interaction, response: Math.round(time.response) })),
      };

      console.log(`OVER-12 ${JSON.stringify(report)}`);
      await cluster.writeReport("over-12-window-performance", report);
      expect(report.interactions).toBe(20);
      expect(report.times.filter((time) => !(time.response > 0))).toEqual([]);
      // Each window holds operations, on the line and in the list, ten at a time.
      for (const window of order) {
        expect([window, holds[window].marks > 0, holds[window].listed]).toEqual([window, true, 10]);
      }
      expect(report.response.p95).toBeLessThan(BUDGET);
      expect(await cluster.valuesOfTheWhole(frame)).toEqual([]);
      expect(await cluster.layoutProblems(frame, OVERVIEW)).toEqual([]);
      await picture("recent", "dark-overview-two-thousand");
    },
    TIMEOUT,
  );

  it(
    "stays where it is scrolled, with what was shown of its lists, when the installation is read again",
    async () => {
      await showEvery("recent");
      await frame.click("[data-testid=velero-overview-attention-more]");
      const shown = await cluster.overview(frame);
      const scrolled = await cluster.scrollOverview(frame, 700);

      expect(scrolled).toBeGreaterThan(500);
      await cluster.readAgain(frame);
      asked += 1;
      expect(Math.abs((await cluster.scrollOverview(frame)) - scrolled)).toBeLessThanOrEqual(2);
      const after = await cluster.overview(frame);

      expect(after.items).toEqual(shown.items);
      expect(after.items).toHaveLength(20);
      expect(after.recent).toEqual(shown.recent);
      expect(after.inFlight).toEqual(shown.inFlight);
      // A read of the views, which comes by itself every fifteen seconds, moves nothing either.
      await cluster.afterRead(frame);
      expect(Math.abs((await cluster.scrollOverview(frame)) - scrolled)).toBeLessThanOrEqual(2);
      expect((await cluster.overview(frame)).items).toEqual(shown.items);
      await cluster.scrollOverview(frame, 0);
    },
    TIMEOUT,
  );

  it(
    "leaves the objects of Velero as they were, and asks Velero for nothing",
    async () => {
      const after = cluster.clusterSnapshot();
      const requests = cluster.apiRequests();

      expect(after.versions).toEqual(before.versions);
      // The controller of the installation validates its location while the suite runs: the objects of
      // its namespace are the same ones.
      expect(after.installed).toEqual(before.installed);
      expect(before.requests).toBe(0);
      expect(after.requests).toBe(0);
      expect(cluster.counted(cluster.writes(counted), cluster.writes(requests))).toEqual({});
      // Of the whole cluster the storage locations were listed, to find the installations: when the
      // views were opened, and each time they were asked to read again.
      expect(cluster.counted(cluster.clusterReads(counted), cluster.clusterReads(requests))).toEqual({
        [DISCOVERY]: 1 + asked,
      });
      expect(errors.errors()).toEqual([]);
    },
    TIMEOUT,
  );
});
