/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

// The views of the first milestone, in a packaged Freelens, against the fixtures
// of the test environment: the synthetic objects of every phase, the references
// that lead somewhere and the ones that do not, and the real backup in the
// namespace of the installation. The suite reads the application and the
// cluster, and writes to neither.

import { expect } from "@jest/globals";
import * as utils from "../helpers/utils";
import * as cluster from "../helpers/velero-cluster";
import * as velero from "../helpers/velero-extension";

import type { Frame } from "playwright";

const TIMEOUT = 10 * 60 * 1000;
const DISCOVERY = "LIST backupstoragelocations cluster";
const PHASES = "backup-finalizingpartiallyfailed";
const SCHEDULED = "views-daily-20260901030000";
// How long what must not happen is waited for: longer than the frame the host opens a menu in.
const NOTHING = 1500;
const MENU = ".Menu .MenuItem";
const DIALOG = '[data-testid="confirmation-dialog"], .Dialog, .ConfirmDialog';
const STARTED = /\b2026\b/;
const WAITING = {
  failure: "No failure reported",
  progress: "Not reported",
  started: "Not reported",
  duration: "Not started",
};
const AT_WORK = { progress: "10 / 10 (100%)", started: STARTED, duration: / so far$/ };
// What each cell of the row of a backup shows in each phase, as the release leaves the object: no counter
// of zero, every item done once the work ended, and no time for what did not start.
const ROWS: Record<string, Record<string, string | RegExp>> = {
  "backup-new": { phase: "New", ...WAITING },
  "backup-queued": { phase: "Queued", ...WAITING },
  "backup-readytostart": { phase: "Ready to start", ...WAITING },
  "backup-failedvalidation": { phase: "Failed validation", ...WAITING, failure: "1 validation error" },
  "backup-inprogress": {
    phase: "In progress",
    failure: "No failure reported",
    progress: "4 / 10 (40%)",
    started: STARTED,
    duration: / so far$/,
  },
  "backup-waitingforpluginoperations": { phase: "Waiting for plugin operations", failure: "No errors", ...AT_WORK },
  "backup-waitingforpluginoperationspartiallyfailed": {
    phase: "Waiting for plugin operations",
    failure: "1 error",
    ...AT_WORK,
  },
  "backup-finalizing": { phase: "Finalizing", failure: "No errors", ...AT_WORK },
  "backup-finalizingpartiallyfailed": { phase: "Finalizing", failure: "1 error", ...AT_WORK },
  "backup-completed": { phase: "Completed", failure: "No errors", ...AT_WORK, duration: "1m" },
  "backup-partiallyfailed": { phase: "Partially failed", failure: "1 error", ...AT_WORK, duration: "1m" },
  // The release can fail a backup before it counts: no counter is not a count of none.
  "backup-failed": {
    phase: "Failed",
    failure: "Failure",
    progress: "4 / 10 (40%)",
    started: STARTED,
    duration: "1m",
  },
  // What the backup was before its deletion is not in its phase any more.
  "backup-deleting": { phase: "Deleting", failure: "Unknown", ...AT_WORK, duration: "1m" },
};

describe("views of the first milestone", () => {
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
    // The catalog holds the test cluster and nothing of the machine it runs on.
    expect(await velero.catalogClusterCount(started.window)).toBe(1);
    // What the API server counted before the frame of the cluster, and the extension in it, is there.
    counted = cluster.apiRequests();
    frame = await cluster.openClusterFromCatalog(started.window, kubeconfig);
    await velero.setWindowSize(started.app, 1440, 900);
  }, TIMEOUT);

  afterAll(async () => {
    if (started) errors.stop(started.window);
    await started?.cleanup();
  }, TIMEOUT);

  it(
    "asks nothing of the cluster until a view of Velero is opened",
    async () => {
      await frame.waitForSelector(`[data-testid="${cluster.sidebarLinkTestId("velero")}"]`, { timeout: 60_000 });
      // The extension is active and its entry is in the sidebar: time for a discovery to start, if one did.
      await frame.waitForTimeout(5000);
      const active = cluster.apiRequests();

      expect(active[DISCOVERY] ?? 0).toBe(counted[DISCOVERY] ?? 0);
      expect(cluster.clusterReads(active)).toEqual(cluster.clusterReads(counted));
    },
    TIMEOUT,
  );

  it(
    "asks to choose among the namespaces that hold a storage location, and chooses none",
    async () => {
      await cluster.openBackups(frame);
      // Only the views that exist have an entry: the group, and under it the lists that are there.
      expect(await cluster.veleroSidebarEntries(frame)).toEqual({
        velero: "Velero",
        "velero-backups": "Backups",
        "velero-restores": "Restores",
        "velero-schedules": "Schedules",
        "velero-storage-locations": "Backup Storage Locations",
        "velero-snapshot-locations": "Volume Snapshot Locations",
      });
      await frame.waitForSelector("[data-testid=velero-state-choose]", { timeout: 60_000 });
      expect((await cluster.target(frame)).cluster).toBe(cluster.E2E_KUBE_CONTEXT);
      expect((await cluster.target(frame)).namespace).toBe("");
      for (const namespace of cluster.SUGGESTED_NAMESPACES) {
        expect(await frame.locator(`[data-testid="velero-choice-${namespace}"]`).count()).toBe(1);
      }
      // The namespace of the long list holds no storage location: nothing suggests it.
      expect(await frame.locator("[data-testid^=velero-choice-]").count()).toBe(cluster.SUGGESTED_NAMESPACES.length);
      expect(await frame.locator("[data-testid=velero-backups]").count()).toBe(0);
      // One discovery, of this cluster, and no family read before a namespace is chosen.
      const opened = cluster.apiRequests();

      expect(opened[DISCOVERY]).toBe((counted[DISCOVERY] ?? 0) + 1);
      expect(opened["LIST backups cluster"] ?? 0).toBe(counted["LIST backups cluster"] ?? 0);
      expect(await cluster.layoutProblems(frame)).toEqual([]);
      await cluster.captureScreenshot(frame, "dark-choose-installation");
    },
    TIMEOUT,
  );

  it(
    "refuses what is not the name of a namespace, before any request",
    async () => {
      await cluster.configureInstallation(frame, "Not/A Namespace");
      await frame.waitForSelector("[data-testid=velero-configure-error]", { timeout: 60_000 });
      expect(await frame.locator("[data-testid=velero-state-choose]").count()).toBe(1);
      await frame.fill("[data-testid=velero-configure] input", "");
    },
    TIMEOUT,
  );

  it(
    "lists the backups of the namespace that is chosen, one for each phase",
    async () => {
      await frame.click(`[data-testid="velero-choice-${cluster.E2E_STATIC_NAMESPACE}"]`);
      await cluster.waitForBackups(frame);
      expect((await cluster.target(frame)).namespace).toBe(cluster.E2E_STATIC_NAMESPACE);
      expect((await cluster.mountedBackups(frame)).sort()).toEqual(Object.keys(ROWS).sort());
      // Every phase, each value in the cell of its column: a value of another column does not answer.
      for (const [name, cells] of Object.entries(ROWS)) {
        await cluster.expectCells(cluster.BACKUPS, frame, name, {
          name,
          installation: cluster.E2E_STATIC_NAMESPACE,
          storage: "fixture-unavailable",
          ...cells,
        });
      }
      expect(await frame.locator("[data-testid=velero-backups] .info-panel").innerText()).toBe("13 items");
      // In a window of 1440 the installation, which the target bar says, gives its room to the columns
      // that say what happened: the failure, the progress, the start and the duration are read whole.
      const columns = await cluster.columnsOf(cluster.BACKUPS, frame);

      expect(columns.shown).toEqual(["name", "phase", "failure", "progress", "started", "duration", "storage", "age"]);
      expect(columns.cut.filter((column) => ["failure", "progress", "started", "duration"].includes(column))).toEqual(
        [],
      );
      // The same in the languages that write a date longer than the one of this machine.
      expect(await cluster.tooWide(cluster.BACKUPS, frame, cluster.WORDS_OF_AN_OPERATION)).toEqual([]);
      // The host gives the pages of a group the tabs of the group: the first page has them as the others.
      // They are the entries of the group in the sidebar, in their order.
      const { velero: _group, ...lists } = await cluster.veleroSidebarEntries(frame);

      expect(
        (await frame.locator(".TabLayout .Tabs .Tab").allInnerTexts()).map((tab) => tab.replace(/\s+/g, " ").trim()),
      ).toEqual(Object.values(lists));
      expect(Object.values(lists).slice(0, 2)).toEqual(["Backups", "Restores"]);
      expect(await frame.locator(".TabLayout .TabLayout").count()).toBe(0);
      // A phase that finished in a failure does not carry the mark of what went well.
      expect(await frame.locator('[data-testid=velero-backups] [data-phase="Failed"] .Icon').first().innerText()).toBe(
        "highlight_off",
      );
      expect(await cluster.notices(frame, [])).toEqual({});
      expect(await cluster.layoutProblems(frame)).toEqual([]);
      await cluster.captureScreenshot(frame, "dark-backups");
    },
    TIMEOUT,
  );

  it(
    "reads again the installation that is shown and nothing else",
    async () => {
      const earlier = cluster.apiRequests();

      await cluster.readAgain(frame);
      const later = cluster.apiRequests();

      expect(later[DISCOVERY]).toBe(earlier[DISCOVERY] + 1);
      // The five families of the namespace that is shown were read, which the counters see.
      for (const kind of ["backups", "restores", "schedules", "backupstoragelocations", "volumesnapshotlocations"]) {
        const key = `LIST ${kind} namespace`;

        expect([key, (later[key] ?? 0) - (earlier[key] ?? 0) >= 1]).toEqual([key, true]);
      }
      // Of the whole cluster only the storage locations are listed, which is how the installations are found.
      expect(cluster.clusterReads(later)).toEqual({
        ...cluster.clusterReads(earlier),
        [DISCOVERY]: earlier[DISCOVERY] + 1,
      });
      expect((await cluster.target(frame)).namespace).toBe(cluster.E2E_STATIC_NAMESPACE);
      await cluster.expectRow(frame, "backup-completed", "Completed");
    },
    TIMEOUT,
  );

  it(
    "opens the workspace of a backup that is finalizing with errors, and goes back to the list",
    async () => {
      await cluster.openWorkspace(frame, PHASES);
      const status = await frame.locator("[data-testid=velero-backup-status]").innerText();

      expect(status).toContain("Finalizing");
      expect(status).toContain("In flight");
      expect(status).toContain("1 error");
      expect(status).toContain(cluster.E2E_STATIC_NAMESPACE);
      expect(status).toContain(cluster.E2E_KUBE_CONTEXT);
      expect(await frame.locator("[data-testid=velero-backup-progress]").innerText()).toContain("10 / 10 (100%)");
      expect(await frame.locator('[data-testid=velero-backup-stages] [aria-current="step"]').innerText()).toBe(
        "Finalizing",
      );
      // The warnings the release did not write are none, and whose zero it is is said.
      expect(await frame.locator("[data-testid=velero-backup-counts]").innerText()).toBe("1 / 0");
      expect(status).toContain("Velero writes no counter when it counts none");
      expect(await frame.locator("[data-testid=velero-backup-counts-note]").innerText()).toContain(
        "The status reports 1 error and 0 warnings",
      );
      // A workspace that only reads: the way back and the way to the location of the backup. Nothing in
      // it asks Velero for a log, and nothing edits or deletes.
      expect(
        (await frame.locator("[data-testid=velero-backup-workspace] button").allInnerTexts()).map((text) =>
          text.replace(/\s+/g, " ").trim(),
        ),
      ).toEqual(["arrow_back Backups", "fixture-unavailable"]);
      expect(await cluster.layoutProblems(frame)).toEqual([]);
      await cluster.captureScreenshot(frame, "dark-backup-workspace");
      await cluster.closeWorkspace(frame);
      await cluster.expectRow(frame, PHASES, "Finalizing");
    },
    TIMEOUT,
  );

  it(
    "shows why a backup failed its validation, what it was asked and where it would have gone",
    async () => {
      await cluster.openWorkspace(frame, "backup-failedvalidation");
      const workspace = frame.locator("[data-testid=velero-backup-workspace]");

      expect(await workspace.locator("[data-testid=velero-backup-status]").innerText()).toContain("Finished");
      expect(await workspace.locator("[data-testid=velero-backup-messages]").innerText()).toContain(
        "Synthetic validation error; no operation was executed",
      );
      expect(await workspace.locator("[data-testid=velero-backup-scope]").innerText()).toContain(
        `velero-source-${process.env.E2E_FIXTURE_RUN}`,
      );
      const location = await cluster.reference(
        frame,
        "velero-reference-BackupStorageLocation-fixture-unavailable",
        "resolved",
      );

      expect(location.state).toBe("resolved");
      // A backup that failed its validation did not start: nothing was counted, and that is said.
      expect(await workspace.locator("[data-testid=velero-backup-counts]").innerText()).toBe(
        "Not reported / Not reported",
      );
      expect(await workspace.locator("[data-testid=velero-backup-status]").innerText()).toContain(
        "Nothing was counted: the operation did not start.",
      );
      expect(location.text).toContain("Unavailable");
      await cluster.captureScreenshot(frame, "dark-backup-failed-validation");
      await cluster.closeWorkspace(frame);
    },
    TIMEOUT,
  );

  it(
    "shows another installation when it is selected, and of a name they share the backup of the one selected",
    async () => {
      await cluster.openWorkspace(frame, "backup-inprogress");
      const first = await frame.locator("[data-testid=velero-backup-workspace]").getAttribute("data-backup-uid");

      expect(await frame.locator("[data-testid=velero-backup-progress]").innerText()).toContain("4 / 10");
      await cluster.closeWorkspace(frame);
      await cluster.selectInstallation(frame, cluster.E2E_VIEWS_NAMESPACE);
      await cluster.expectRow(frame, SCHEDULED, "Completed", "2 warnings", "views-available");
      // Nothing of the installation that was shown before is in the list of this one.
      expect(await cluster.mountedBackups(frame)).not.toContain(PHASES);
      await cluster.expectRow(frame, "backup-unreported", "Not reported", "Unknown");
      await cluster.openWorkspace(frame, "backup-inprogress");
      const second = await frame.locator("[data-testid=velero-backup-workspace]").getAttribute("data-backup-uid");

      expect(second).not.toBe(first);
      expect(second).toBe(
        cluster.kubectlE2E(
          "get",
          "backups.velero.io",
          "backup-inprogress",
          "--namespace",
          cluster.E2E_VIEWS_NAMESPACE,
          "-o",
          "jsonpath={.metadata.uid}",
        ).stdout,
      );
      expect(await frame.locator("[data-testid=velero-backup-progress]").innerText()).toContain("7 / 10");
      expect(await frame.locator("[data-testid=velero-backup-status]").innerText()).toContain(
        cluster.E2E_VIEWS_NAMESPACE,
      );
      await cluster.closeWorkspace(frame);
      await cluster.captureScreenshot(frame, "dark-backups-references-installation");
    },
    TIMEOUT,
  );

  it(
    "follows the references of a backup by names and labels, and says which ones lead nowhere",
    async () => {
      await cluster.openWorkspace(frame, SCHEDULED);
      const schedule = await cluster.reference(frame, "velero-reference-Schedule-views-daily", "resolved");
      const location = await cluster.reference(
        frame,
        "velero-reference-BackupStorageLocation-views-available",
        "resolved",
      );
      const snapshots = await cluster.reference(
        frame,
        "velero-reference-VolumeSnapshotLocation-views-snapshots",
        "resolved",
      );
      const restores = await cluster.reference(frame, "velero-related-restores", "listed");

      expect(schedule).toMatchObject({ state: "resolved" });
      expect(schedule.text).toContain("0 3 * * *");
      expect(location).toMatchObject({ state: "resolved" });
      expect(location.text).toContain("Available");
      expect(location.text).toContain("ReadWrite");
      expect(snapshots).toMatchObject({ state: "resolved" });
      expect(restores.state).toBe("listed");
      expect(restores.text).toContain("restore-of-daily-completed (Completed)");
      expect(restores.text).toContain("restore-of-daily-partiallyfailed (Partially failed)");
      // The schedule, the locations and each restore are ways to their views.
      expect(
        (await frame.locator("[data-testid=velero-backup-workspace] button").allInnerTexts()).map((text) =>
          text.replace(/\s+/g, " ").trim(),
        ),
      ).toEqual([
        "arrow_back Backups",
        "views-daily",
        "views-available",
        "views-snapshots",
        "restore-mapped",
        "restore-of-daily-completed",
        "restore-of-daily-partiallyfailed",
      ]);
      expect(await cluster.notices(frame, [])).toEqual({});
      expect(await cluster.layoutProblems(frame)).toEqual([]);
      await frame.locator("[data-testid=velero-backup-references]").scrollIntoViewIfNeeded();
      await cluster.captureScreenshot(frame, "dark-backup-references");
      await cluster.closeWorkspace(frame);

      await cluster.openWorkspace(frame, "backup-missing-location");
      const missing = await cluster.reference(frame, "velero-reference-BackupStorageLocation-views-removed", "absent");

      expect(missing.state).toBe("absent");
      expect(missing.text).toContain("views-removed");
      expect(await frame.locator("[data-testid=velero-backup-references] a").count()).toBe(0);
      await frame.locator("[data-testid=velero-backup-references]").scrollIntoViewIfNeeded();
      await cluster.captureScreenshot(frame, "dark-backup-references-missing");
      await cluster.closeWorkspace(frame);

      await cluster.openWorkspace(frame, "backup-missing-schedule");
      expect((await cluster.reference(frame, "velero-reference-Schedule-views-removed", "absent")).state).toBe(
        "absent",
      );
      await cluster.closeWorkspace(frame);

      await cluster.openWorkspace(frame, "backup-unreported");
      expect(await frame.locator("[data-testid=velero-backup-status]").innerText()).toContain("Not reported");
      expect(await frame.locator("[data-testid=velero-backup-status]").innerText()).not.toContain("NaN");
      await cluster.closeWorkspace(frame);
    },
    TIMEOUT,
  );

  it(
    "offers no way to select, edit or delete a backup, by pointer or by keyboard",
    async () => {
      const list = frame.locator("[data-testid=velero-backups]");

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

      await frame.locator(`[data-backup-row="${SCHEDULED}"]`).click({ button: "right" });
      expect(await appears(MENU)).toBe(false);
      // A right click opens nothing; what a left click of the same place would do is open the workspace.
      await cluster.showList(frame);
      await frame.locator(`[data-backup-row="${SCHEDULED}"]`).focus();
      for (const key of ["Delete", "Backspace", "Control+a", "Meta+Backspace"]) {
        await started.window.keyboard.press(key);
        expect([key, await appears(DIALOG)]).toEqual([key, false]);
        expect([key, await cluster.shownView(frame)]).toEqual([key, undefined]);
      }
      expect(await list.locator(".TableRow.selected, .TableRow.checked").count()).toBe(0);
      await cluster.expectRow(frame, SCHEDULED, "Completed");
      // The same click on the list the host shows of the same objects opens its menu: what is looked for
      // above is what the host shows when it offers to edit and to delete.
      await cluster.navigate(frame, "/crd/velero.io/backups");
      await cluster.selectHostNamespace(frame, cluster.E2E_VIEWS_NAMESPACE);
      await frame.locator(".TableRow", { hasText: SCHEDULED }).first().click({ button: "right" });
      await frame.waitForSelector(MENU, { state: "visible", timeout: 60_000 });
      expect((await frame.locator(MENU).allInnerTexts()).join(" ")).toMatch(/Delete/);
      await started.window.keyboard.press("Escape");
      await frame.waitForSelector(MENU, { state: "hidden", timeout: 60_000 });
      await cluster.openBackups(frame);
      await cluster.waitForBackups(frame);
    },
    TIMEOUT,
  );

  it(
    "gives the details of the host the same reading, and a way to the workspace for the installation selected",
    async () => {
      await cluster.navigate(frame, "/crd/velero.io/backups");
      await cluster.selectHostNamespace(frame, cluster.E2E_VIEWS_NAMESPACE);
      const details = await cluster.hostDetails(
        frame,
        "backup-missing-location",
        "Failed validation (Finished)",
        "1 validation error",
        "views-removed",
      );

      expect(details).toContain("Synthetic validation error; no operation was executed");
      expect(await frame.locator("[data-testid=velero-backup-details-link]").count()).toBe(1);
      await cluster.captureScreenshot(frame, "dark-host-details");
      await cluster.closeDetails(frame);

      await cluster.selectHostNamespace(frame, cluster.E2E_STATIC_NAMESPACE);
      await cluster.hostDetails(frame, PHASES, "Finalizing (In flight)", "1 error", "10 / 10 (100%)");
      // A backup of a namespace that is not the one selected has no link: the workspace would not show it.
      expect(await frame.locator("[data-testid=velero-backup-details-link]").count()).toBe(0);
      expect(await frame.locator("[data-testid=velero-backup-details-elsewhere]").innerText()).toContain(
        cluster.E2E_STATIC_NAMESPACE,
      );
      await cluster.closeDetails(frame);

      await cluster.selectHostNamespace(frame, cluster.E2E_VIEWS_NAMESPACE);
      await cluster.hostDetails(frame, SCHEDULED, "Completed (Finished)");
      await frame.click("[data-testid=velero-backup-details-link]");
      await frame.waitForSelector(`[data-testid=velero-backup-workspace] >> text="${SCHEDULED}"`, { timeout: 60_000 });
      expect((await cluster.target(frame)).namespace).toBe(cluster.E2E_VIEWS_NAMESPACE);
      await cluster.closeWorkspace(frame);
      await cluster.expectRow(frame, SCHEDULED, "Completed");
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
