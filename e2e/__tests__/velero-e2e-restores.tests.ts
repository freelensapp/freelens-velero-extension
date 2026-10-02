/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

// The Restores, in a packaged Freelens, against the fixtures of the test
// environment: a restore for every phase, one as Velero keeps a restore it
// took, one that failed its validation, one of a backup that is not there
// any more, and the restore the controller of the installation ran. The suite
// reads the application and the cluster, and writes to neither.

import { expect } from "@jest/globals";
import * as cluster from "../helpers/velero-cluster";
import * as velero from "../helpers/velero-extension";

import type { Frame } from "playwright";

const TIMEOUT = 10 * 60 * 1000;
const RESTORES = cluster.RESTORES;
const SCHEDULED = "views-daily-20260901030000";
const MAPPED = "restore-mapped";
const text = (value: string) => value.replace(/\s+/g, " ").trim();
// How long what must not happen is waited for: longer than the frame the host opens a menu in.
const NOTHING = 1500;
const MENU = ".Menu .MenuItem";
const DIALOG = '[data-testid="confirmation-dialog"], .Dialog, .ConfirmDialog';
const STARTED = /\b2026\b/;
// What each cell of the row of a restore shows in each phase, as the release leaves the object: no counter
// of zero, every item done once the work ended, and no time for what did not start.
const PHASES: Record<string, Record<string, string | RegExp>> = {
  "restore-new": {
    phase: "New",
    failure: "No failure reported",
    progress: "Not reported",
    started: "Not reported",
    duration: "Not started",
  },
  "restore-failedvalidation": {
    phase: "Failed validation",
    failure: "1 validation error",
    progress: "Not reported",
    started: "Not reported",
    duration: "Not started",
  },
  "restore-inprogress": {
    phase: "In progress",
    failure: "No failure reported",
    progress: "4 / 10 (40%)",
    started: STARTED,
    duration: / so far$/,
  },
  "restore-waitingforpluginoperations": {
    phase: "Waiting for plugin operations",
    failure: "No errors",
    progress: "10 / 10 (100%)",
    started: STARTED,
    duration: / so far$/,
  },
  "restore-waitingforpluginoperationspartiallyfailed": {
    phase: "Waiting for plugin operations",
    failure: "1 error",
    progress: "10 / 10 (100%)",
    started: STARTED,
    duration: / so far$/,
  },
  "restore-finalizing": {
    phase: "Finalizing",
    failure: "No errors",
    progress: "10 / 10 (100%)",
    started: STARTED,
    duration: / so far$/,
  },
  "restore-finalizingpartiallyfailed": {
    phase: "Finalizing",
    failure: "1 error",
    progress: "10 / 10 (100%)",
    started: STARTED,
    duration: / so far$/,
  },
  "restore-completed": {
    phase: "Completed",
    failure: "No errors",
    progress: "10 / 10 (100%)",
    started: STARTED,
    duration: "1m",
  },
  "restore-partiallyfailed": {
    phase: "Partially failed",
    failure: "1 error",
    progress: "10 / 10 (100%)",
    started: STARTED,
    duration: "1m",
  },
  // The release can fail a restore before it counts: no counter is not a count of none.
  "restore-failed": {
    phase: "Failed",
    failure: "Failure",
    progress: "4 / 10 (40%)",
    started: STARTED,
    duration: "1m",
  },
};

describe("views of the restores", () => {
  let started: velero.StartedApplication;
  let frame: Frame;
  const errors = velero.createErrorCollector();
  let before: cluster.ClusterSnapshot;
  let counted: Record<string, number>;
  const source = process.env.E2E_FIXTURE_RUN ? `velero-source-${process.env.E2E_FIXTURE_RUN}` : "";
  const restored = process.env.E2E_FIXTURE_RUN ? `velero-restored-${process.env.E2E_FIXTURE_RUN}` : "";

  beforeAll(async () => {
    if (!cluster.fixturesReady()) {
      throw new Error(`The fixtures are missing from ${cluster.E2E_CLUSTER_NAME}. Run \`pnpm demo:up\` first.`);
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
    "has an entry of its own, and asks to choose the installation as every view does",
    async () => {
      await cluster.openPage(frame, RESTORES);
      expect(await cluster.veleroSidebarEntries(frame)).toMatchObject({
        velero: "Velero",
        "velero-backups": "Backups",
        "velero-restores": "Restores",
      });
      await frame.waitForSelector("[data-testid=velero-state-choose]", { timeout: 60_000 });
      expect(await frame.locator("[data-testid=velero-restores]").count()).toBe(0);
      // One discovery, of this cluster, and nothing else of the whole cluster before a namespace is chosen.
      expect(cluster.counted(cluster.clusterReads(counted), cluster.clusterReads(cluster.apiRequests()))).toEqual({
        "LIST backupstoragelocations cluster": 1,
      });
      // No installation is selected: nothing was read of one, and the target bar says so.
      expect(await frame.locator("[data-testid=velero-read-time]").innerText()).toBe("Not read yet");
    },
    TIMEOUT,
  );

  it(
    "lists the restores of the namespace that is chosen, one for each phase",
    async () => {
      await frame.click(`[data-testid="velero-choice-${cluster.E2E_STATIC_NAMESPACE}"]`);
      await cluster.waitForList(frame, RESTORES);
      expect((await cluster.target(frame)).namespace).toBe(cluster.E2E_STATIC_NAMESPACE);
      expect((await cluster.mounted(frame, RESTORES)).sort()).toEqual(Object.keys(PHASES).sort());
      // Every phase, each value in the cell of its column: a value of another column does not answer.
      for (const [name, cells] of Object.entries(PHASES)) {
        await cluster.expectCells(RESTORES, frame, name, {
          name,
          installation: cluster.E2E_STATIC_NAMESPACE,
          source: "backup-completed",
          ...cells,
        });
      }
      // That nothing went wrong is marked of what the release counted, and of nothing else.
      const marks = await frame.$$eval("[data-testid=velero-restores] .TableRow:not(.TableHead)", (rows) =>
        Object.fromEntries(
          rows.map((row) => [
            row.querySelector("[data-restore-row]")?.getAttribute("data-restore-row") ?? "",
            row.querySelector("[data-signal]")?.getAttribute("data-mark") ?? "",
          ]),
        ),
      );

      expect(marks).toEqual({
        "restore-new": "not-counted",
        "restore-failedvalidation": "failure",
        "restore-inprogress": "not-counted",
        "restore-waitingforpluginoperations": "none",
        "restore-waitingforpluginoperationspartiallyfailed": "failure",
        "restore-finalizing": "none",
        "restore-finalizingpartiallyfailed": "failure",
        "restore-completed": "none",
        "restore-partiallyfailed": "failure",
        "restore-failed": "failure",
      });
      expect(await frame.locator('[data-testid=velero-restores] [data-phase="Failed"] .Icon').first().innerText()).toBe(
        "highlight_off",
      );
      expect(await frame.locator("[data-testid=velero-restores] .info-panel").innerText()).toBe("10 items");
      // In a window of 1440 the installation, which the target bar says, gives its room to the columns
      // that say what happened: the failure, the progress, the start and the duration are read whole.
      const narrow = await cluster.columnsOf(RESTORES, frame);

      expect(narrow.shown).toEqual(["name", "source", "phase", "failure", "progress", "started", "duration"]);
      expect(narrow.cut.filter((column) => ["failure", "progress", "started", "duration"].includes(column))).toEqual(
        [],
      );
      // The same in the languages that write a date longer than the one of this machine.
      expect(await cluster.tooWide(RESTORES, frame, cluster.WORDS_OF_AN_OPERATION)).toEqual([]);
      await velero.setWindowSize(started.app, 1760, 900);
      await frame.waitForFunction(() => window.innerWidth > 1500, undefined, { timeout: 60_000 });
      expect((await cluster.columnsOf(RESTORES, frame)).shown).toEqual([
        "name",
        "installation",
        "source",
        "phase",
        "failure",
        "progress",
        "started",
        "duration",
      ]);
      await velero.setWindowSize(started.app, 1440, 900);
      await frame.waitForFunction(() => window.innerWidth < 1500, undefined, { timeout: 60_000 });
      expect(await cluster.notices(frame, [])).toEqual({});
      expect(await cluster.layoutProblems(frame, RESTORES)).toEqual([]);
      await cluster.captureScreenshot(frame, "dark-restores");
    },
    TIMEOUT,
  );

  it(
    "opens a restore as Velero keeps it: in flight with its failure, into where, and the scope it carries",
    async () => {
      await cluster.selectInstallation(frame, cluster.E2E_VIEWS_NAMESPACE);
      await cluster.expectRowOf(
        RESTORES,
        frame,
        MAPPED,
        `${SCHEDULED}, schedule views-daily`,
        "Waiting for plugin operations",
        "1 error",
      );
      // Opening a restore asks nothing of the cluster: what it shows was read with the installation. It is
      // opened in the time between two reads of the installation, with the counters of the API server
      // read before and after.
      expect(
        await cluster.readsDuring(
          frame,
          () => cluster.openWorkspace(frame, MAPPED, RESTORES),
          () => cluster.closeWorkspace(frame),
        ),
      ).toEqual({});
      const workspace = frame.locator("[data-testid=velero-restore-workspace]");
      const status = text(await workspace.locator("[data-testid=velero-restore-status]").innerText());

      expect(status).toContain("Waiting for plugin operations");
      expect(status).toContain("In flight");
      expect(status).toContain("1 error");
      expect(status).toContain(cluster.E2E_VIEWS_NAMESPACE);
      expect(status).toContain(cluster.E2E_KUBE_CONTEXT);
      // The warnings the release did not write are none, and whose zero it is is said.
      expect(await workspace.locator("[data-testid=velero-restore-counts]").innerText()).toBe("1 / 0");
      expect(status).toContain("Velero writes no counter when it counts none");
      expect(await workspace.locator('[data-testid=velero-restore-stages] [aria-current="step"]').innerText()).toBe(
        "Plugin operations",
      );
      // The release leaves the work with every item done: what waits is an operation of a plugin. The
      // hooks are counted when the restore is finalized: a restore that waits has no line for them.
      expect(await workspace.locator("[data-testid=velero-restore-progress]").innerText()).toBe("10 / 10 (100%)");
      expect(text(await workspace.locator("[data-testid=velero-restore-operations]").innerText())).toBe("1 / 0 / 0");
      expect(await workspace.locator("[data-testid=velero-restore-hooks]").count()).toBe(0);
      expect(await workspace.locator("[data-testid=velero-restore-completed-note]").count()).toBe(0);
      // Into where: each namespace of the backup beside the one it is restored into.
      expect(
        (await workspace.locator("[data-testid=velero-restore-mappings] tbody tr").allInnerTexts()).map(text),
      ).toEqual([`${source} ${restored}`, `${source}-second ${restored}-second`]);
      expect(await workspace.locator("[data-testid=velero-restore-mappings-rest]").innerText()).toContain(
        "a namespace that is not mapped goes into the namespace of the same name",
      );
      const scope = text(await workspace.locator("[data-testid=velero-restore-scope]").innerText());

      expect(await workspace.locator('[data-scope="existing-resources"]').innerText()).toBe("update");
      expect(await workspace.locator('[data-scope="item-operation-timeout"]').innerText()).toBe("4h0m0s");
      expect(await workspace.locator('[data-scope="excluded-resources"]').innerText()).toBe(
        "secrets, nodes, events, events.events.k8s.io, backups.velero.io, restores.velero.io, " +
          "resticrepositories.velero.io, csinodes.storage.k8s.io, volumeattachments.storage.k8s.io, " +
          "backuprepositories.velero.io",
      );
      expect(await workspace.locator('[data-scope="persistent-volumes"]').innerText()).toBe("No");
      expect(await workspace.locator('[data-scope="cluster-resources"]').innerText()).toBe("No");
      expect(await workspace.locator('[data-scope="label-selector"]').innerText()).toBe("Not set");
      expect(await workspace.locator('[data-scope="restored-status"]').innerText()).toBe("Not set");
      expect(scope).toContain("velero.io/restore-status true, and of no other");
      expect(scope).toContain("Velero adds its own entries when it takes a restore");
      expect(scope).toContain("Velero fills it when it takes a restore that does not set it");
      expect(scope).not.toMatch(/undefined|null|NaN/);
      expect(await workspace.locator('[data-scope="resource-policy"]').count()).toBe(0);
      // The source as the object names it, and what it cannot say.
      expect(await cluster.reference(frame, `velero-reference-Backup-${SCHEDULED}`, "resolved")).toMatchObject({
        state: "resolved",
      });
      expect(await cluster.reference(frame, "velero-reference-Schedule-views-daily", "resolved")).toMatchObject({
        state: "resolved",
      });
      const location = await cluster.reference(
        frame,
        "velero-reference-BackupStorageLocation-views-available",
        "resolved",
      );

      expect(location.state).toBe("resolved");
      expect(location.text).toContain("Available");
      expect(location.text).toContain("ReadWrite");
      expect(await workspace.locator("[data-testid=velero-restore-source-note]").innerText()).toContain(
        "the object does not say which of the two was submitted",
      );
      // A view that only reads: the way back, and the ways to the views of the backup, of the schedule and
      // of the location the backup is in.
      expect((await workspace.locator("button").allInnerTexts()).map(text)).toEqual([
        "arrow_back Restores",
        SCHEDULED,
        "views-daily",
        "views-available",
      ]);
      expect(await workspace.locator("a, input, select, textarea").count()).toBe(0);
      expect(await cluster.notices(frame, [])).toEqual({});
      expect(await cluster.layoutProblems(frame, RESTORES)).toEqual([]);
      await cluster.captureScreenshot(frame, "dark-restore-workspace");
      await workspace.locator("[data-testid=velero-restore-mappings]").scrollIntoViewIfNeeded();
      await cluster.captureScreenshot(frame, "dark-restore-into");
      await workspace.locator("[data-testid=velero-restore-scope]").scrollIntoViewIfNeeded();
      await cluster.captureScreenshot(frame, "dark-restore-scope");
      await cluster.closeWorkspace(frame);
      await cluster.expectRowOf(RESTORES, frame, MAPPED, "Waiting for plugin operations");
    },
    TIMEOUT,
  );

  it(
    "makes up no backup and no time for a restore that failed its validation",
    async () => {
      await cluster.expectRowOf(
        RESTORES,
        frame,
        "restore-of-schedule",
        "Schedule views-removed",
        "Failed validation",
        "2 validation errors",
        "Not started",
      );
      await cluster.openWorkspace(frame, "restore-of-schedule", RESTORES);
      const workspace = frame.locator("[data-testid=velero-restore-workspace]");
      const status = text(await workspace.locator("[data-testid=velero-restore-status]").innerText());

      expect(status).toContain("Failed validation");
      expect(status).toContain("Finished");
      expect(status).toMatch(/STARTED Not reported/i);
      expect(status).toMatch(/DURATION Not started/i);
      expect(status).toMatch(/COMPLETED Not reported/i);
      expect(await workspace.locator("[data-testid=velero-restore-counts]").innerText()).toBe(
        "Not reported / Not reported",
      );
      expect(status).toContain("Nothing was counted: the operation did not start.");
      // Velero completes what it takes, whether it then refuses it or not.
      expect(await workspace.locator('[data-scope="item-operation-timeout"]').innerText()).toBe("4h0m0s");
      const messages = await workspace.locator("[data-testid=velero-restore-messages]").innerText();

      expect(messages).toContain("No backups found for schedule");
      expect(messages).toContain("No completed backups found for schedule");
      expect(await workspace.locator("[data-testid=velero-reference-Backup-none]").innerText()).toContain(
        "names no backup",
      );
      expect(await workspace.locator("[data-testid=velero-reference-BackupStorageLocation-none]").innerText()).toBe(
        "Not known: the object names no backup, and the location is the one of the backup",
      );
      expect((await cluster.reference(frame, "velero-reference-Schedule-views-removed", "absent")).state).toBe(
        "absent",
      );
      expect(await workspace.locator("[data-testid=velero-restore-source-note]").innerText()).toContain(
        "names no backup",
      );
      expect(await workspace.locator("[role=progressbar]").count()).toBe(0);
      expect((await workspace.locator("button").allInnerTexts()).map(text)).toEqual(["arrow_back Restores"]);
      await cluster.captureScreenshot(frame, "dark-restore-failed-validation");
      await cluster.closeWorkspace(frame);
    },
    TIMEOUT,
  );

  it(
    "shows a source that is not there any more as a name with its reason, and says completed and no more",
    async () => {
      await cluster.openWorkspace(frame, "restore-of-removed", RESTORES);
      const workspace = frame.locator("[data-testid=velero-restore-workspace]");
      const missing = await cluster.reference(frame, "velero-reference-Backup-views-removed", "absent");

      expect(missing.state).toBe("absent");
      expect(missing.text).toBe(`views-removed (No backup of this name in ${cluster.E2E_VIEWS_NAMESPACE})`);
      expect(await workspace.locator("[data-testid=velero-reference-Backup-views-removed] button").count()).toBe(0);
      expect(
        await workspace.locator("[data-testid=velero-reference-BackupStorageLocation-none]").innerText(),
      ).toContain("Known through the backup");
      expect(await workspace.locator("[data-testid=velero-restore-completed-note]").innerText()).toContain(
        "Completed is what Velero reports of the restore",
      );
      expect(await workspace.innerText()).not.toMatch(/recovered|verified|healthy/i);
      // As the release leaves a restore that ended without an error: no counter, which is no error.
      expect(await workspace.locator("[data-testid=velero-restore-counts]").innerText()).toBe("0 / 0");
      expect(
        await workspace.locator("[data-testid=velero-restore-status] [data-signal]").getAttribute("data-mark"),
      ).toBe("none");
      expect(await workspace.locator("[data-testid=velero-restore-messages]").count()).toBe(0);
      expect(await workspace.locator("[data-testid=velero-restore-hooks]").count()).toBe(0);
      expect(await workspace.locator("[data-testid=velero-restore-mappings-none]").innerText()).toBe(
        "Not set: what is restored of a namespace goes into the namespace of the same name.",
      );
      await workspace.locator("[data-testid=velero-restore-source]").scrollIntoViewIfNeeded();
      await cluster.captureScreenshot(frame, "dark-restore-source-missing");
      await cluster.closeWorkspace(frame);
    },
    TIMEOUT,
  );

  it(
    "leads from a restore to its backup and back, over the list of the restores",
    async () => {
      // Every step changes the address once, and the address names the views that are open.
      const changes: [step: string, changes: number, views: string[]][] = [];
      const step = async (name: string, take: () => Promise<void>) => {
        const before = await cluster.addressChanges(frame);

        await take();
        changes.push([name, (await cluster.addressChanges(frame)) - before, await cluster.addressViews(frame)]);
      };

      await step("open the restore", () => cluster.openWorkspace(frame, MAPPED, RESTORES));
      await step("follow to the backup", () => cluster.followTo(frame, "backup", SCHEDULED));
      expect(await cluster.shownView(frame)).toEqual({
        kind: "backup",
        name: SCHEDULED,
        back: `arrow_back Restores / ${MAPPED}`,
      });
      // The page is the one the first view was opened from, with its list behind.
      expect(await frame.locator("[data-testid=velero-restores-page]").count()).toBe(1);
      expect(await frame.locator("[data-testid=velero-backup-status]").innerText()).toContain("Completed");
      await cluster.captureScreenshot(frame, "dark-backup-from-restore");
      // The backup leads to its restores: the one it was opened from is a way back, not a way further.
      await step("follow to the restore it came from", () => cluster.followTo(frame, "restore", MAPPED));
      expect(await cluster.shownView(frame)).toEqual({ kind: "restore", name: MAPPED, back: "arrow_back Restores" });
      await step("follow to the backup again", () => cluster.followTo(frame, "backup", SCHEDULED));
      await step("take the way back", () => cluster.closeWorkspace(frame));
      expect(await cluster.shownView(frame)).toEqual({ kind: "restore", name: MAPPED, back: "arrow_back Restores" });
      await step("leave with Escape", async () => {
        await started.window.keyboard.press("Escape");
        await frame.waitForSelector("[data-testid=velero-restore-workspace]", { state: "detached", timeout: 60_000 });
      });
      expect(changes).toEqual([
        ["open the restore", 1, [`restore/${MAPPED}`]],
        ["follow to the backup", 1, [`restore/${MAPPED}`, `backup/${SCHEDULED}`]],
        ["follow to the restore it came from", 1, [`restore/${MAPPED}`]],
        ["follow to the backup again", 1, [`restore/${MAPPED}`, `backup/${SCHEDULED}`]],
        ["take the way back", 1, [`restore/${MAPPED}`]],
        ["leave with Escape", 1, []],
      ]);
      expect(await cluster.focusOn(frame, MAPPED)).toBe(MAPPED);
    },
    TIMEOUT,
  );

  it(
    "leads from a backup to its restores and back, over the list of the backups",
    async () => {
      await cluster.openBackups(frame);
      await cluster.waitForBackups(frame);
      expect((await cluster.target(frame)).namespace).toBe(cluster.E2E_VIEWS_NAMESPACE);
      await cluster.openWorkspace(frame, SCHEDULED);
      const restores = await cluster.reference(frame, "velero-related-restores", "listed");

      expect(restores.state).toBe("listed");
      expect(restores.text).toContain("restore-of-daily-completed (Completed)");
      expect(restores.text).toContain(`${MAPPED} (Waiting for plugin operations)`);
      await cluster.followTo(frame, "restore", "restore-of-daily-partiallyfailed");
      expect(await cluster.shownView(frame)).toEqual({
        kind: "restore",
        name: "restore-of-daily-partiallyfailed",
        back: `arrow_back Backups / ${SCHEDULED}`,
      });
      expect(await frame.locator("[data-testid=velero-backups-page]").count()).toBe(1);
      expect(text(await frame.locator("[data-testid=velero-restore-status]").innerText())).toContain(
        "Partially failed",
      );
      // It was finalized: its hooks were counted, two of which one failed.
      expect(text(await frame.locator("[data-testid=velero-restore-hooks]").innerText())).toBe("2 / 1");
      expect(await frame.locator("[data-testid=velero-restore-operations]").count()).toBe(0);
      await cluster.closeWorkspace(frame);
      expect(await cluster.shownView(frame)).toEqual({ kind: "backup", name: SCHEDULED, back: "arrow_back Backups" });
      await cluster.closeWorkspace(frame);
      expect(await cluster.shownView(frame)).toBeUndefined();
      await cluster.expectRow(frame, SCHEDULED, "Completed");
      await cluster.openPage(frame, RESTORES);
      await cluster.waitForList(frame, RESTORES);
    },
    TIMEOUT,
  );

  it(
    "keeps the search, the order and the width of a column when a restore is opened and closed",
    async () => {
      const found = await cluster.search(frame, "restore-of", RESTORES);

      expect([...found].sort()).toEqual([
        "restore-of-daily-completed",
        "restore-of-daily-partiallyfailed",
        "restore-of-removed",
        "restore-of-schedule",
      ]);
      await frame.click("[data-testid=velero-restores] .TableHead .TableCell.source");
      const resized = await cluster.resizeColumn(frame, "name", 90, RESTORES);

      // The edge was dragged to the right: the column is wider. The columns that hold their words whole
      // do not give all the room that was asked of them.
      expect(resized.after - resized.before).toBeGreaterThan(30);
      const state = await cluster.listState(frame, RESTORES);

      expect(state.search).toBe("restore-of");
      expect(state.sorted).toMatch(/^source /);
      // The order is the one of the source, as the rows show it: the restore without a backup is
      // ordered by its schedule.
      const sources = await Promise.all(
        (await cluster.mounted(frame, RESTORES)).map(
          async (name) => (await cluster.cellsOf(RESTORES, frame, name)).source,
        ),
      );

      expect(sources).toHaveLength(4);
      expect([[...sources].sort(), [...sources].sort().reverse()]).toContainEqual(sources);
      await cluster.openWorkspace(frame, "restore-of-daily-completed", RESTORES);
      await cluster.closeWorkspace(frame);
      const back = await cluster.listStateLike(frame, state, RESTORES);

      expect(back.search).toBe(state.search);
      expect(back.sorted).toBe(state.sorted);
      expect(back.items).toBe(state.items);
      expect(back.first).toBe(state.first);
      expect(Math.abs(back.columns.name - state.columns.name)).toBeLessThanOrEqual(1);
      expect(await cluster.mounted(frame, RESTORES)).toHaveLength(4);
      await cluster.captureScreenshot(frame, "dark-restores-filtered-after-back");
      // Every column has a part in the search: what a cell shows finds its row.
      expect(await cluster.search(frame, "10 / 10 (100%)", RESTORES)).toHaveLength(4);
      expect(await cluster.search(frame, "Not started", RESTORES)).toEqual(["restore-of-schedule"]);
      expect(await cluster.search(frame, "so far", RESTORES)).toEqual(
        expect.arrayContaining([MAPPED, cluster.LONG_RESTORE_NAME]),
      );
      expect((await cluster.search(frame, "", RESTORES)).length).toBe(6);
    },
    TIMEOUT,
  );

  it(
    "offers no way to select, edit or delete a restore, by pointer or by keyboard",
    async () => {
      const list = frame.locator("[data-testid=velero-restores]");

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

      await frame.locator(`[data-restore-row="${MAPPED}"]`).click({ button: "right" });
      expect(await appears(MENU)).toBe(false);
      await cluster.showList(frame);
      await frame.locator(`[data-restore-row="${MAPPED}"]`).focus();
      for (const key of ["Delete", "Backspace", "Control+a", "Meta+Backspace"]) {
        await started.window.keyboard.press(key);
        expect([key, await appears(DIALOG)]).toEqual([key, false]);
        expect([key, await cluster.shownView(frame)]).toEqual([key, undefined]);
      }
      expect(await list.locator(".TableRow.selected, .TableRow.checked").count()).toBe(0);
      await cluster.expectRowOf(RESTORES, frame, MAPPED, "Waiting for plugin operations");
      // The same click on the list the host shows of the same objects opens its menu: what is looked for
      // above is what the host shows when it offers to edit and to delete.
      await cluster.navigate(frame, "/crd/velero.io/restores");
      await cluster.selectHostNamespace(frame, cluster.E2E_VIEWS_NAMESPACE);
      await frame.locator(".TableRow", { hasText: MAPPED }).first().click({ button: "right" });
      await frame.waitForSelector(MENU, { state: "visible", timeout: 60_000 });
      expect((await frame.locator(MENU).allInnerTexts()).join(" ")).toMatch(/Delete/);
      await started.window.keyboard.press("Escape");
      await frame.waitForSelector(MENU, { state: "hidden", timeout: 60_000 });
      await cluster.openPage(frame, RESTORES);
      await cluster.waitForList(frame, RESTORES);
    },
    TIMEOUT,
  );

  it(
    "gives the details of the host the same reading, and a way to the workspace for the installation selected",
    async () => {
      await cluster.navigate(frame, "/crd/velero.io/restores");
      await cluster.selectHostNamespace(frame, cluster.E2E_VIEWS_NAMESPACE);
      const details = await cluster.hostDetails(
        frame,
        MAPPED,
        "Waiting for plugin operations (In flight)",
        "1 error",
        "1 / 0",
        "10 / 10 (100%)",
        SCHEDULED,
        "views-daily",
      );

      expect(details).toContain("the object does not say which of the two was submitted");
      expect(await frame.locator("[data-testid=velero-restore-details-link]").count()).toBe(1);
      await cluster.captureScreenshot(frame, "dark-host-details-restore");
      await cluster.closeDetails(frame);

      await cluster.selectHostNamespace(frame, cluster.E2E_STATIC_NAMESPACE);
      await cluster.hostDetails(frame, "restore-failedvalidation", "Failed validation (Finished)", "Not started");
      // A restore of a namespace that is not the one selected has no link: the workspace would not show it.
      expect(await frame.locator("[data-testid=velero-restore-details-link]").count()).toBe(0);
      expect(await frame.locator("[data-testid=velero-restore-details-elsewhere]").innerText()).toContain(
        cluster.E2E_STATIC_NAMESPACE,
      );
      await cluster.closeDetails(frame);

      await cluster.selectHostNamespace(frame, cluster.E2E_VIEWS_NAMESPACE);
      await cluster.hostDetails(frame, MAPPED, "Waiting for plugin operations (In flight)");
      await frame.click("[data-testid=velero-restore-details-link]");
      await frame.waitForSelector(`[data-testid=velero-restore-name] >> text="${MAPPED}"`, { timeout: 60_000 });
      expect(await frame.locator("[data-testid=velero-restores-page]").count()).toBe(1);
      expect((await cluster.target(frame)).namespace).toBe(cluster.E2E_VIEWS_NAMESPACE);
      await cluster.closeWorkspace(frame);
      await cluster.expectRowOf(RESTORES, frame, MAPPED, "Waiting for plugin operations");
    },
    TIMEOUT,
  );

  it(
    "shows the restore the controller of the installation ran as the release left it",
    async () => {
      const name = `fixture-restore-${process.env.E2E_FIXTURE_RUN}`;
      const read = cluster.kubectlE2E(
        "get",
        "restores.velero.io",
        name,
        "--namespace",
        cluster.E2E_NAMESPACE,
        "-o",
        "json",
      );

      // The release deletes a backup that expired, and its restores with it.
      if (read.status !== 0 || !read.stdout) {
        throw new Error(
          `The restore ${name} is not in ${cluster.E2E_NAMESPACE}: the environment is older than its backup lasts. ` +
            "Create it again with `pnpm demo:down` and `pnpm demo:up`.",
        );
      }
      const object = JSON.parse(read.stdout) as {
        status: Record<string, unknown> & { progress: { totalItems: number; itemsRestored: number } };
      };

      // What the suite expects of the release is what the release did here: a restore that ended without
      // an error carries no counter of its errors and none of its warnings.
      expect(object.status.phase).toBe("Completed");
      expect(Object.keys(object.status)).not.toContain("errors");
      expect(Object.keys(object.status)).not.toContain("warnings");
      expect(object.status.progress.itemsRestored).toBe(object.status.progress.totalItems);
      await cluster.selectInstallation(frame, cluster.E2E_NAMESPACE);
      const total = object.status.progress.totalItems;

      await cluster.expectCells(RESTORES, frame, name, {
        installation: cluster.E2E_NAMESPACE,
        source: `fixture-backup-${process.env.E2E_FIXTURE_RUN}`,
        phase: "Completed",
        failure: "No errors",
        progress: `${total} / ${total} (100%)`,
        started: /\d/,
        duration: /^\d+[smh]/,
      });
      await cluster.openWorkspace(frame, name, RESTORES);
      const workspace = frame.locator("[data-testid=velero-restore-workspace]");
      const status = workspace.locator("[data-testid=velero-restore-status]");

      expect(await status.locator("[data-signal]").getAttribute("data-mark")).toBe("none");
      expect(text(await status.locator("[data-signal]").innerText())).toBe("check No errors");
      expect(await workspace.locator("[data-testid=velero-restore-counts]").innerText()).toBe("0 / 0");
      expect(text(await status.innerText())).toContain("Velero writes no counter when it counts none");
      expect(text(await status.innerText())).not.toContain("Not reported");
      expect(await workspace.locator("[data-testid=velero-restore-messages]").count()).toBe(0);
      expect(await workspace.locator("[data-testid=velero-restore-hooks]").count()).toBe(0);
      expect(await workspace.locator("[data-testid=velero-restore-operations]").count()).toBe(0);
      expect(await workspace.locator('[data-scope="item-operation-timeout"]').innerText()).toMatch(/^\d+h/);
      expect(await workspace.locator('[data-scope="excluded-resources"]').innerText()).toContain("restores.velero.io");
      expect(
        (
          await cluster.reference(
            frame,
            `velero-reference-Backup-fixture-backup-${process.env.E2E_FIXTURE_RUN}`,
            "resolved",
          )
        ).state,
      ).toBe("resolved");
      await cluster.captureScreenshot(frame, "dark-restore-of-the-controller");
      // The backup it restored, which the same controller took, is read the same way.
      await cluster.followTo(frame, "backup", `fixture-backup-${process.env.E2E_FIXTURE_RUN}`);
      const backup = frame.locator("[data-testid=velero-backup-workspace]");

      expect(await backup.locator("[data-testid=velero-backup-counts]").innerText()).toBe("0 / 0");
      expect(await backup.locator("[data-testid=velero-backup-status] [data-signal]").getAttribute("data-mark")).toBe(
        "none",
      );
      expect(await backup.locator("[data-testid=velero-backup-progress]").innerText()).toBe(
        `${total} / ${total} (100%)`,
      );
      await cluster.showList(frame);
      await cluster.selectInstallation(frame, cluster.E2E_VIEWS_NAMESPACE);
      await cluster.waitForList(frame, RESTORES);
    },
    TIMEOUT,
  );

  it(
    "counts what the views ask when they are asked to read again, and nothing when a view is opened",
    async () => {
      // What counts nothing when a restore is opened counts the reads of a read that is asked: the five
      // families of the namespace that is selected, and the discovery.
      const seen = (await cluster.readState(frame)).read;

      await cluster.afterRead(frame, seen);
      const last = (await cluster.readState(frame)).read;
      const earlier = cluster.apiRequests();

      await frame.click("[data-testid=velero-refresh]");
      await cluster.afterRead(frame, last);
      const asked = cluster.counted(cluster.familyReads(earlier), cluster.familyReads(cluster.apiRequests()));

      for (const kind of ["backups", "restores", "schedules", "backupstoragelocations", "volumesnapshotlocations"]) {
        expect([kind, (asked[`LIST ${kind} namespace`] ?? 0) >= 1]).toEqual([kind, true]);
      }
      expect(asked["LIST backupstoragelocations cluster"]).toBe(1);
      expect(await cluster.mounted(frame, RESTORES)).toHaveLength(6);
      expect(await cluster.notices(frame, [])).toEqual({});
    },
    TIMEOUT,
  );

  it(
    "leaves the objects of Velero as they were, and asks Velero for nothing",
    async () => {
      const after = cluster.clusterSnapshot();
      const requests = cluster.apiRequests();

      expect(Object.keys(before.versions).length).toBeGreaterThan(2000);
      expect(after.versions).toEqual(before.versions);
      expect(after.installed).toEqual(before.installed);
      expect(before.requests).toBe(0);
      expect(after.requests).toBe(0);
      // No request of any kind of Velero that is not a read, by whoever: the suite writes nothing, and the
      // installation under test has nothing to do.
      expect(cluster.counted(cluster.writes(counted), cluster.writes(requests))).toEqual({});
      // Of the whole cluster only the storage locations were listed, which is how the installations are
      // found: once when the views were opened, and once for each read that was asked.
      const whole = cluster.counted(cluster.clusterReads(counted), cluster.clusterReads(requests));

      expect(Object.keys(whole)).toEqual(["LIST backupstoragelocations cluster"]);
      expect(whole["LIST backupstoragelocations cluster"]).toBe(2);
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
