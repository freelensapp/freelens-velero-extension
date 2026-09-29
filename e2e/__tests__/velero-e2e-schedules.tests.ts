/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

// The Schedules, in a packaged Freelens, against the fixtures of the test
// environment: the schedules Velero took, refused and has not read, one with
// a history of backups, and the ones whose backups go where none is taken.
// The suite reads the application and the cluster, and writes to neither.

import { expect } from "@jest/globals";
import * as utils from "../helpers/utils";
import * as cluster from "../helpers/velero-cluster";
import * as velero from "../helpers/velero-extension";

import type { Frame } from "playwright";

const TIMEOUT = 10 * 60 * 1000;
const SCHEDULES = cluster.SCHEDULES;
const HISTORY = [
  "views-history-0",
  "views-history-1",
  "views-history-2",
  "views-history-3-again",
  "views-history-3",
  "views-history-4",
  "views-history-5",
  "views-history-6",
];
const text = (value: string) => value.replace(/\s+/g, " ").trim();
// How long what must not happen is waited for: longer than the frame the host opens a menu in.
const NOTHING = 1500;
const MENU = ".Menu .MenuItem";
const DIALOG = '[data-testid="confirmation-dialog"], .Dialog, .ConfirmDialog';
// No view of a schedule says when it should have run: that is what the adherence will establish.
const EXPECTATION = /next run|overdue|missed|expected run|is late|should have/i;

describe("views of the schedules", () => {
  let started: velero.StartedApplication;
  let frame: Frame;
  const errors = velero.createErrorCollector();
  let before: cluster.ClusterSnapshot;
  let counted: Record<string, number>;

  beforeAll(async () => {
    if (!cluster.fixturesReady()) {
      throw new Error(`The fixtures are missing from ${cluster.E2E_CLUSTER_NAME}. Run \`pnpm demo:up\` first.`);
    }
    before = cluster.clusterSnapshot();
    errors.start();
    started = await velero.startIsolated();
    errors.watch(started.window);
    const kubeconfig = await cluster.publishKubeconfig();

    await utils.clickWelcomeButton(started.window);
    await velero.installExtension(started.app, started.window);
    await velero.dismissNotifications(started.window);
    await velero.navigateToCatalog(started.app);
    expect(await velero.catalogClusterCount(started.window)).toBe(1);
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
    "lists the schedules with paused and validation as two facts, and what Velero has not read as such",
    async () => {
      await cluster.openPage(frame, SCHEDULES);
      expect(Object.keys(await cluster.veleroSidebarEntries(frame))).toEqual([
        "velero",
        "velero-overview",
        "velero-backups",
        "velero-restores",
        "velero-schedules",
        "velero-storage-locations",
        "velero-snapshot-locations",
      ]);
      await frame.waitForSelector("[data-testid=velero-state-choose]", { timeout: 60_000 });
      await frame.click(`[data-testid="velero-choice-${cluster.E2E_STATIC_NAMESPACE}"]`);
      await cluster.waitForList(frame, SCHEDULES);
      expect((await cluster.mounted(frame, SCHEDULES)).sort()).toEqual([
        "schedule-enabled",
        "schedule-invalid",
        "schedule-paused",
      ]);
      // Each value in the cell of its column. None of these schedules has a backup among the ones that
      // exist, and that is what the list says.
      await cluster.expectCells(SCHEDULES, frame, "schedule-enabled", {
        schedule: "0 0 1 1 *",
        paused: "Not paused",
        started: "Not reported",
        newest: "None that exists",
        phase: "Enabled",
      });
      await cluster.expectCells(SCHEDULES, frame, "schedule-paused", { paused: "Paused", phase: "Enabled" });
      await cluster.expectCells(SCHEDULES, frame, "schedule-invalid", {
        schedule: "invalid-synthetic-cron",
        paused: "Paused",
        phase: "Failed validation",
      });
      expect(await frame.locator("[data-testid=velero-schedules]").innerText()).not.toMatch(EXPECTATION);
      // Every page of the group has the tabs of the group, and the layout of the host once.
      expect((await frame.locator(".TabLayout .Tabs .Tab").allInnerTexts()).map(text)).toEqual([
        "Overview",
        "Backups",
        "Restores",
        "Schedules",
        "Backup Storage Locations",
        "Volume Snapshot Locations",
      ]);
      expect(await frame.locator(".TabLayout .TabLayout").count()).toBe(0);
      expect(await cluster.notices(frame, [])).toEqual({});
      expect(await cluster.layoutProblems(frame, SCHEDULES)).toEqual([]);
      await cluster.captureScreenshot(frame, "dark-schedules");
    },
    TIMEOUT,
  );

  it(
    "shows the expression of a schedule Velero refused as it is written, with why it refused it",
    async () => {
      const workspace = frame.locator("[data-testid=velero-schedule-workspace]");

      await cluster.openWorkspace(frame, "schedule-invalid", SCHEDULES);
      expect(await workspace.locator("[data-testid=velero-schedule-expression]").innerText()).toBe(
        "invalid-synthetic-cron",
      );
      expect(await workspace.locator("[data-testid=velero-schedule-messages]").innerText()).toContain(
        "Synthetic invalid schedule",
      );
      expect(await workspace.innerText()).not.toMatch(EXPECTATION);
      await cluster.captureScreenshot(frame, "dark-schedule-invalid");
      await cluster.closeWorkspace(frame);
    },
    TIMEOUT,
  );

  it(
    "says of the schedules Velero does not read what is to be known of them",
    async () => {
      await cluster.selectInstallation(frame, cluster.E2E_VIEWS_NAMESPACE);
      await cluster.expectCells(SCHEDULES, frame, "schedule-new", { paused: "Not paused", phase: "New" });
      await cluster.expectCells(SCHEDULES, frame, "schedule-unread", { paused: "Not paused", phase: "Not reported" });
      await cluster.expectCells(SCHEDULES, frame, "schedule-unread-paused", {
        paused: "Paused",
        phase: "Not reported",
      });
      // What Velero has not validated does not carry the mark of what it took.
      expect(
        await frame
          .locator("[data-testid=velero-schedules] .TableRow", {
            has: frame.locator('[data-schedule-row="schedule-unread"]'),
          })
          .locator("[data-validation]")
          .getAttribute("data-validation"),
      ).toBe("not-validated");
      await cluster.openWorkspace(frame, "schedule-skipping", SCHEDULES);
      const workspace = frame.locator("[data-testid=velero-schedule-workspace]");
      const status = text(await workspace.locator("[data-testid=velero-schedule-status]").innerText());
      const notes = await workspace.locator("[data-testid=velero-schedule-notes] li").allInnerTexts();

      expect(status).toMatch(/PAUSED Paused/i);
      expect(status).toMatch(/SKIP IMMEDIATELY Yes/i);
      expect(status).toContain("Time zone: The one of the Velero server, which this view does not read");
      expect(notes).toEqual([
        "Velero does not read a schedule while it is paused: its validation and its errors are the ones written before the pause.",
        "When Velero reads the schedule again it writes the time of that reading as the last skipped, sets skip immediately back to no, and counts the next run from that time.",
      ]);
      await cluster.captureScreenshot(frame, "dark-schedule-paused");
      await cluster.closeWorkspace(frame);

      await cluster.openWorkspace(frame, "schedule-unread-paused", SCHEDULES);
      expect(await workspace.locator("[data-testid=velero-schedule-notes] li").allInnerTexts()).toEqual([
        "Velero has not read this schedule, and will not until it is resumed.",
      ]);
      await cluster.closeWorkspace(frame);
    },
    TIMEOUT,
  );

  it(
    "shows the last submission and the newest backup as two values, and the newest is the one that never started",
    async () => {
      await cluster.expectRowOf(
        SCHEDULES,
        frame,
        "views-history",
        "0 1 * * *",
        "Not paused",
        "views-history-0",
        "1 validation error",
        "Enabled",
      );
      await cluster.expectRowOf(SCHEDULES, frame, "views-daily", "views-daily-20260901030000", "2 warnings");
      await cluster.expectRowOf(SCHEDULES, frame, "views-zoned", "CRON_TZ=Europe/Rome 30 2 * * *", "None that exists");
      expect(await cluster.mounted(frame, SCHEDULES)).toHaveLength(10);
      expect(await cluster.layoutProblems(frame, SCHEDULES)).toEqual([]);
      await cluster.captureScreenshot(frame, "dark-schedules-with-history");
    },
    TIMEOUT,
  );

  it(
    "shows the history of a schedule, from the newest, on a line of time and in a list",
    async () => {
      // Opening a schedule asks nothing of the cluster: its history was read with the installation. It is
      // opened in the time between two reads of the installation, with the counters of the API server
      // read before and after.
      expect(
        await cluster.readsDuring(
          frame,
          () => cluster.openWorkspace(frame, "views-history", SCHEDULES),
          () => cluster.closeWorkspace(frame),
        ),
      ).toEqual({});
      const workspace = frame.locator("[data-testid=velero-schedule-workspace]");
      const shown = await cluster.history(frame);

      expect(shown.rows).toEqual(HISTORY);
      expect(await workspace.locator("[data-testid=velero-history-counts]").innerText()).toBe(
        "8 backups that exist: 5 completed; 3 ended with a failure.",
      );
      // Every backup is on the line, from the oldest, and no mark is drawn over another: it holds however
      // old the environment is.
      expect(cluster.backupsOnTheLine(shown.marks)).toEqual([...HISTORY].reverse());
      expect(shown.over).toEqual([]);
      // Each day has its mark, and the two backups that are an hour apart are one.
      expect(cluster.dayOnTheLine(shown.width)).toBeGreaterThan(2 * cluster.MARK_WIDTH);
      expect(shown.marks).toEqual([
        "views-history-6",
        "views-history-5",
        "views-history-4",
        "views-history-3-again,views-history-3",
        "views-history-2",
        "views-history-1",
        "views-history-0",
      ]);
      const group = workspace.locator('[data-strip-mark="views-history-3-again,views-history-3"]');

      expect(await group.innerText()).toBe("2");
      expect(await group.getAttribute("data-failing")).toBe("true");
      expect(await group.getAttribute("aria-label")).toContain("2 backups close to each other");
      const newest = workspace.locator('[data-history-row="views-history-0"]');

      expect(text(await newest.innerText())).toContain("Failed validation");
      expect(text(await newest.innerText())).toContain("(created, did not start)");
      expect(await workspace.locator('[data-strip-mark="views-history-0"]').getAttribute("data-not-started")).toBe(
        "true",
      );
      expect(text(await workspace.locator("[data-testid=velero-schedule-newest]").innerText())).toContain(
        "views-history-0",
      );
      // The last submission is the time the newest backup was created, as the release writes the two, and
      // what the release wrote into the schedule when it read it is shown.
      const status = text(await workspace.locator("[data-testid=velero-schedule-status]").innerText());
      const submitted = cluster.kubectlE2E(
        "get",
        "backups.velero.io",
        "views-history-0",
        "--namespace",
        cluster.E2E_VIEWS_NAMESPACE,
        "-o",
        "jsonpath={.metadata.creationTimestamp}",
      );

      expect(submitted.status).toBe(0);
      expect(
        cluster
          .kubectlE2E(
            "get",
            "schedules.velero.io",
            "views-history",
            "--namespace",
            cluster.E2E_VIEWS_NAMESPACE,
            "-o",
            "jsonpath={.status.lastBackup}",
          )
          .stdout.trim(),
      ).toBe(submitted.stdout.trim());
      expect(status).toMatch(/SKIP IMMEDIATELY No/i);
      expect(await workspace.innerText()).toContain("These are the backups that exist now");
      expect(await workspace.innerText()).not.toMatch(EXPECTATION);
      expect(await cluster.notices(frame, [])).toEqual({});
      expect(await cluster.layoutProblems(frame, SCHEDULES)).toEqual([]);
      await cluster.captureScreenshot(frame, "dark-schedule-workspace");
      await workspace.locator("[data-testid=velero-history-strip]").scrollIntoViewIfNeeded();
      await cluster.captureScreenshot(frame, "dark-schedule-history");
    },
    TIMEOUT,
  );

  it(
    "shows alone the backups of a mark that holds more than one, and leads from a mark to its backup",
    async () => {
      const workspace = frame.locator("[data-testid=velero-schedule-workspace]");

      await workspace.locator('[data-strip-mark="views-history-3-again,views-history-3"]').click();
      expect((await cluster.history(frame)).rows).toEqual(["views-history-3-again", "views-history-3"]);
      expect(await workspace.locator("[data-testid=velero-history-shown]").innerText()).toContain(
        "The 2 backups of one mark are shown.",
      );
      await cluster.captureScreenshot(frame, "dark-schedule-history-mark");
      await workspace.locator("[data-testid=velero-history-shown] button").click();
      expect((await cluster.history(frame)).rows).toEqual(HISTORY);
      // Every step changes the address once, and the address names the views that are open.
      const changes: [step: string, changes: number, views: string[]][] = [];
      const step = async (name: string, take: () => Promise<void>) => {
        const before = await cluster.addressChanges(frame);

        await take();
        changes.push([name, (await cluster.addressChanges(frame)) - before, await cluster.addressViews(frame)]);
      };

      await step("from a mark to its backup", async () => {
        await workspace.locator('[data-strip-mark="views-history-4"]').click();
        await frame.waitForSelector('[data-testid=velero-backup-name] >> text="views-history-4"', { timeout: 60_000 });
      });
      expect(await cluster.shownView(frame)).toEqual({
        kind: "backup",
        name: "views-history-4",
        back: "arrow_back Schedules / views-history",
      });
      expect(await frame.locator("[data-testid=velero-schedules-page]").count()).toBe(1);
      // The backup names its schedule, which is where it was opened from: the way back, not a way further.
      await step("from the backup to its schedule", () => cluster.followTo(frame, "schedule", "views-history"));
      expect(await cluster.shownView(frame)).toEqual({
        kind: "schedule",
        name: "views-history",
        back: "arrow_back Schedules",
      });
      await step("to the newest backup", () => cluster.followTo(frame, "backup", "views-history-0"));
      expect(text(await frame.locator("[data-testid=velero-backup-status]").innerText())).toMatch(
        /STARTED Not reported/i,
      );
      await step("back with Escape", async () => {
        await started.window.keyboard.press("Escape");
        await frame.waitForSelector('[data-testid=velero-schedule-name] >> text="views-history"', { timeout: 60_000 });
      });
      expect(changes).toEqual([
        ["from a mark to its backup", 1, ["schedule/views-history", "backup/views-history-4"]],
        ["from the backup to its schedule", 1, ["schedule/views-history"]],
        ["to the newest backup", 1, ["schedule/views-history", "backup/views-history-0"]],
        ["back with Escape", 1, ["schedule/views-history"]],
      ]);
    },
    TIMEOUT,
  );

  it(
    "shows the template as the schedule carries it, what it refers to, and the restores that name the schedule",
    async () => {
      const workspace = frame.locator("[data-testid=velero-schedule-workspace]");
      const location = await cluster.reference(
        frame,
        "velero-reference-BackupStorageLocation-views-available",
        "resolved",
      );

      expect(location.state).toBe("resolved");
      expect(location.text).toContain("Available, ReadWrite");
      expect(
        (await cluster.reference(frame, "velero-reference-VolumeSnapshotLocation-views-snapshots", "resolved")).state,
      ).toBe("resolved");
      expect(await workspace.locator("[data-testid=velero-schedule-location-warning]").count()).toBe(0);
      expect(await workspace.locator('[data-scope="retention"]').innerText()).toBe("720h0m0s");
      expect(await workspace.locator('[data-scope="cluster-resources"]').innerText()).toBe("No");
      expect(await workspace.locator('[data-scope="excluded-namespaces"]').innerText()).toBe("Not set");
      expect(await workspace.locator("[data-testid=velero-schedule-template]").innerText()).not.toMatch(
        /undefined|null|NaN/,
      );
      expect((await cluster.reference(frame, "velero-related-restores", "listed")).text).toBe("None");
      await workspace.locator("[data-testid=velero-schedule-template]").scrollIntoViewIfNeeded();
      await cluster.captureScreenshot(frame, "dark-schedule-template");
      await cluster.closeWorkspace(frame);

      await cluster.openWorkspace(frame, "views-daily", SCHEDULES);
      const restores = await cluster.reference(frame, "velero-related-restores", "listed");

      // The restores Velero took of a backup of the schedule carry its name, which Velero wrote.
      expect(restores.state).toBe("listed");
      expect(restores.text).toBe(
        "restore-mapped (Waiting for plugin operations), restore-of-daily-completed (Completed), " +
          "restore-of-daily-partiallyfailed (Partially failed)",
      );
      expect(await workspace.locator("[data-testid=velero-schedule-restores-note]").innerText()).toContain(
        "was asked from it, or from a backup of it",
      );
      await cluster.followTo(frame, "restore", "restore-mapped");
      expect((await cluster.shownView(frame))?.back).toBe("arrow_back Schedules / views-daily");
      // The restore names the schedule, which is a way to its view now that the schedules have one.
      expect(await frame.locator('[data-testid="velero-reference-Schedule-views-daily"] button').innerText()).toBe(
        "views-daily",
      );
      // The way back leads to the schedule the restore was opened from.
      await frame.locator("[data-testid=velero-back]").click();
      await frame.waitForSelector('[data-testid=velero-schedule-name] >> text="views-daily"', { timeout: 60_000 });
      expect(await cluster.shownView(frame)).toEqual({
        kind: "schedule",
        name: "views-daily",
        back: "arrow_back Schedules",
      });
      await cluster.showList(frame);
    },
    TIMEOUT,
  );

  it(
    "says where the backups of a schedule go, and when the place does not take them",
    async () => {
      const workspace = frame.locator("[data-testid=velero-schedule-workspace]");

      await cluster.openWorkspace(frame, "views-to-removed", SCHEDULES);
      expect(
        (await cluster.reference(frame, "velero-reference-BackupStorageLocation-views-removed", "absent")).state,
      ).toBe("absent");
      expect(await workspace.locator("[data-testid=velero-schedule-location-warning]").innerText()).toContain(
        "The release refuses a backup sent to a location that is not there.",
      );
      await cluster.closeWorkspace(frame);

      await cluster.openWorkspace(frame, "views-to-archive", SCHEDULES);
      expect(
        (await cluster.reference(frame, "velero-reference-BackupStorageLocation-views-archive", "resolved")).text,
      ).toContain("Available, ReadOnly");
      expect(await workspace.locator("[data-testid=velero-schedule-location-warning]").innerText()).toContain(
        "it is read-only",
      );
      await workspace.locator("[data-testid=velero-schedule-references]").scrollIntoViewIfNeeded();
      await cluster.captureScreenshot(frame, "dark-schedule-location-refused");
      await cluster.closeWorkspace(frame);

      await cluster.openWorkspace(frame, "views-to-default", SCHEDULES);
      const fallback = workspace.locator("[data-testid=velero-schedule-default-location]");

      expect(await fallback.getAttribute("data-default")).toBe("marked");
      expect(await fallback.innerText()).toBe(
        "Not set: Velero uses the location marked default, views-available (Available, ReadWrite).",
      );
      expect(await workspace.locator("[data-testid=velero-schedule-location-warning]").count()).toBe(0);
      await cluster.closeWorkspace(frame);

      await cluster.openWorkspace(frame, "views-zoned", SCHEDULES);
      expect(text(await workspace.locator("[data-testid=velero-schedule-status]").innerText())).toContain(
        "Time zone: Europe/Rome, named by the expression",
      );
      await cluster.closeWorkspace(frame);
    },
    TIMEOUT,
  );

  it(
    "leads from a backup to its schedule and back, over the list of the backups",
    async () => {
      await cluster.openBackups(frame);
      await cluster.waitForBackups(frame);
      await cluster.openWorkspace(frame, "views-history-2");
      await cluster.followTo(frame, "schedule", "views-history");
      expect(await cluster.shownView(frame)).toEqual({
        kind: "schedule",
        name: "views-history",
        back: "arrow_back Backups / views-history-2",
      });
      expect(await frame.locator("[data-testid=velero-backups-page]").count()).toBe(1);
      await cluster.closeWorkspace(frame);
      await cluster.closeWorkspace(frame);
      expect(await cluster.focusOn(frame, "views-history-2")).toBe("views-history-2");
      // A backup that names a schedule that is not there has a name with its reason, and no way.
      await cluster.openWorkspace(frame, "backup-missing-schedule");
      expect((await cluster.reference(frame, "velero-reference-Schedule-views-removed", "absent")).state).toBe(
        "absent",
      );
      expect(await frame.locator('[data-testid="velero-reference-Schedule-views-removed"] button').count()).toBe(0);
      await cluster.closeWorkspace(frame);
      await cluster.openPage(frame, SCHEDULES);
      await cluster.waitForList(frame, SCHEDULES);
    },
    TIMEOUT,
  );

  it(
    "keeps the search, the order and the width of a column when a schedule is opened and closed",
    async () => {
      expect([...(await cluster.search(frame, "views-to", SCHEDULES))].sort()).toEqual([
        "views-to-archive",
        "views-to-default",
        "views-to-removed",
      ]);
      await frame.click("[data-testid=velero-schedules] .TableHead .TableCell.schedule");
      const resized = await cluster.resizeColumn(frame, "name", 90, SCHEDULES);

      // The edge was dragged to the right: the column is wider. The columns that hold their words whole
      // do not give all the room that was asked of them.
      expect(resized.after - resized.before).toBeGreaterThan(30);
      const state = await cluster.listState(frame, SCHEDULES);

      expect(state.search).toBe("views-to");
      expect(state.sorted).toMatch(/^schedule /);
      // The order is the one of the expression, as the rows show it.
      const expressions = await Promise.all(
        (await cluster.mounted(frame, SCHEDULES)).map(
          async (name) => (await cluster.cellsOf(SCHEDULES, frame, name)).schedule,
        ),
      );

      expect(expressions).toHaveLength(3);
      expect([[...expressions].sort(), [...expressions].sort().reverse()]).toContainEqual(expressions);
      await cluster.openWorkspace(frame, "views-to-archive", SCHEDULES);
      await cluster.closeWorkspace(frame);
      const back = await cluster.listStateLike(frame, state, SCHEDULES);

      expect(back.search).toBe(state.search);
      expect(back.sorted).toBe(state.sorted);
      expect(back.items).toBe(state.items);
      expect(back.first).toBe(state.first);
      expect(Math.abs(back.columns.name - state.columns.name)).toBeLessThanOrEqual(1);
      await cluster.search(frame, "", SCHEDULES);
    },
    TIMEOUT,
  );

  it(
    "offers no way to select, edit, delete, pause or run a schedule, by pointer or by keyboard",
    async () => {
      const list = frame.locator("[data-testid=velero-schedules]");

      expect(await list.locator(".TableCell.checkbox, .Checkbox, input[type=checkbox]").count()).toBe(0);
      expect(await list.locator(".TableCell.menu .Icon, .MenuActions").count()).toBe(0);
      expect(await list.locator(".AddRemoveButtons button, .add-button, .remove-button").count()).toBe(0);
      // What must not happen is waited for, for longer than the host takes to open a menu, and is
      // expected not to have happened: the host opens the menu of a row in the frame after the click.
      const appears = (selector: string) =>
        frame.waitForSelector(selector, { state: "visible", timeout: NOTHING }).then(
          () => true,
          () => false,
        );

      await frame.locator('[data-schedule-row="views-history"]').click({ button: "right" });
      expect(await appears(MENU)).toBe(false);
      await cluster.showList(frame);
      await frame.locator('[data-schedule-row="views-history"]').focus();
      for (const key of ["Delete", "Backspace", "Control+a", "Meta+Backspace"]) {
        await started.window.keyboard.press(key);
        expect([key, await appears(DIALOG)]).toEqual([key, false]);
        expect([key, await cluster.shownView(frame)]).toEqual([key, undefined]);
      }
      expect(await list.locator(".TableRow.selected, .TableRow.checked").count()).toBe(0);
      // The same click on the list the host shows of the same objects opens its menu: what is looked for
      // above is what the host shows when it offers to edit and to delete.
      await cluster.navigate(frame, "/crd/velero.io/schedules");
      await cluster.selectHostNamespace(frame, cluster.E2E_VIEWS_NAMESPACE);
      await frame.locator(".TableRow", { hasText: "views-history" }).first().click({ button: "right" });
      await frame.waitForSelector(MENU, { state: "visible", timeout: 60_000 });
      expect((await frame.locator(MENU).allInnerTexts()).join(" ")).toMatch(/Delete/);
      // So are the boxes that select a row, and the dialog the host asks a confirmation with: it is opened
      // and left with its way out, and the last case of the suite finds that nothing was written.
      expect(await frame.locator(".TableRow .TableCell.checkbox").count()).toBeGreaterThan(0);
      await frame.locator(MENU, { hasText: "Delete" }).first().click();
      await frame.waitForSelector(DIALOG, { state: "visible", timeout: 60_000 });
      await frame.locator(".ConfirmDialog .confirm-buttons .cancel").click();
      await frame.waitForSelector(DIALOG, { state: "hidden", timeout: 60_000 });
      if (await frame.locator(MENU).count()) await started.window.keyboard.press("Escape");
      await frame.waitForSelector(MENU, { state: "hidden", timeout: 60_000 });
      await cluster.openPage(frame, SCHEDULES);
      await cluster.waitForList(frame, SCHEDULES);
      await cluster.openWorkspace(frame, "views-history", SCHEDULES);
      const controls = await frame
        .locator("[data-testid=velero-schedule-workspace]")
        .locator("button, a, input, select, textarea")
        .evaluateAll((elements) =>
          elements.map(
            (element) => element.getAttribute("data-testid") ?? (element.hasAttribute("data-strip-mark") ? "mark" : ""),
          ),
        );

      // The way back, the ways to the other views and the marks of the line: nothing that writes.
      expect(controls.filter((control) => control !== "mark" && !control.startsWith("velero-open-"))).toEqual([
        "velero-back",
      ]);
      expect(await frame.locator("[data-testid=velero-schedule-workspace]").innerText()).not.toMatch(
        /\b(delete|edit|pause now|resume|run now|trigger)\b/i,
      );
      await cluster.closeWorkspace(frame);
    },
    TIMEOUT,
  );

  it(
    "gives the details of the host the same reading, and a way to the workspace for the installation selected",
    async () => {
      await cluster.navigate(frame, "/crd/velero.io/schedules");
      await cluster.selectHostNamespace(frame, cluster.E2E_VIEWS_NAMESPACE);
      const details = await cluster.hostDetails(
        frame,
        "views-zoned",
        "Enabled",
        "Not paused",
        "CRON_TZ=Europe/Rome 30 2 * * *",
        "Europe/Rome, named by the expression",
      );

      expect(details).not.toMatch(EXPECTATION);
      expect(await frame.locator("[data-testid=velero-schedule-details-link]").count()).toBe(1);
      await cluster.captureScreenshot(frame, "dark-host-details-schedule");
      await cluster.closeDetails(frame);

      await cluster.selectHostNamespace(frame, cluster.E2E_STATIC_NAMESPACE);
      await cluster.hostDetails(frame, "schedule-invalid", "Failed validation", "Paused", "Synthetic invalid schedule");
      expect(text(await frame.locator("[data-testid=velero-schedule-details]").innerText())).toContain(
        "the ones written before the pause",
      );
      expect(await frame.locator("[data-testid=velero-schedule-details-link]").count()).toBe(0);
      expect(await frame.locator("[data-testid=velero-schedule-details-elsewhere]").innerText()).toContain(
        cluster.E2E_STATIC_NAMESPACE,
      );
      await cluster.closeDetails(frame);

      await cluster.selectHostNamespace(frame, cluster.E2E_VIEWS_NAMESPACE);
      await cluster.hostDetails(frame, "views-history", "Enabled");
      await frame.click("[data-testid=velero-schedule-details-link]");
      await frame.waitForSelector('[data-testid=velero-schedule-name] >> text="views-history"', { timeout: 60_000 });
      expect(await frame.locator("[data-testid=velero-schedules-page]").count()).toBe(1);
      expect((await cluster.history(frame)).rows).toEqual(HISTORY);
      await cluster.closeWorkspace(frame);
    },
    TIMEOUT,
  );

  it(
    "leaves the objects of Velero as they were, and asks Velero for nothing",
    async () => {
      const after = cluster.clusterSnapshot();
      const requests = cluster.apiRequests();

      expect(after.versions).toEqual(before.versions);
      expect(after.installed).toEqual(before.installed);
      expect(before.requests).toBe(0);
      expect(after.requests).toBe(0);
      // No request of any kind of Velero that is not a read, by whoever: the suite writes nothing, and the
      // installation under test has nothing to do.
      expect(cluster.counted(cluster.writes(counted), cluster.writes(requests))).toEqual({});
      // Of the whole cluster only the storage locations were listed, once, which is how the installations
      // are found.
      expect(cluster.counted(cluster.clusterReads(counted), cluster.clusterReads(requests))).toEqual({
        "LIST backupstoragelocations cluster": 1,
      });
    },
    TIMEOUT,
  );

  it(
    "leaves no error in the application",
    async () => {
      expect(errors.errors()).toEqual([]);
    },
    TIMEOUT,
  );
});
