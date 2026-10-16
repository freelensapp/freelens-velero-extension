/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

// The views of the first milestone, in a packaged Freelens, against the fixtures
// of the test environment: the synthetic objects of every phase, the references
// that lead somewhere and the ones that do not, and the real backup in the
// namespace of the installation. The suite reads the application and the
// cluster, and writes to neither.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as artifacts from "../../integration/helpers/velero-artifacts";
import * as cluster from "../../integration/helpers/velero-cluster";
import * as velero from "../../integration/helpers/velero-extension";

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
// The five kinds of Velero with pages of their own, as the API names them.
const FAMILIES = ["backups", "backupstoragelocations", "restores", "schedules", "volumesnapshotlocations"];
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
  let kubeconfig = "";

  beforeAll(async () => {
    if (!cluster.fixturesReady()) {
      throw new Error(cluster.fixturesMissing());
    }
    before = cluster.clusterSnapshot();
    errors.start();

    // The kubeconfig is in the profile before the install is asked, for each start of the application.
    started = await velero.startWithExtension(async () => {
      kubeconfig = await cluster.publishKubeconfig();
    });
    errors.watch(started.window);
    await velero.dismissNotifications(started.window);
    await velero.navigateToCatalog(started.app);
    // The catalog holds the test cluster and nothing of the machine it runs on.
    expect(await velero.catalogClusterCount(started.window)).toBe(1);
    // What the API server counted before the frame of the cluster, and the extension in it, is there.
    counted = cluster.apiRequests();
    frame = await cluster.openClusterFromCatalog(started.window, kubeconfig);
    await velero.setWindowSize(started.app, 1440, 900);
    // Every address of the frame that names an object for the details of the host is kept from now on.
    await cluster.watchHostDetails(frame);
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
        "velero-overview": "Overview",
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
      expect(Object.values(lists).slice(0, 3)).toEqual(["Overview", "Backups", "Restores"]);
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
    "leaves the focus with the search of the host when its list opens, and gives it back there at Ctrl or Cmd with F",
    async () => {
      const inSearch = () =>
        frame.evaluate(
          () => document.activeElement === document.querySelector("[data-testid=velero-backups] .SearchInput input"),
        );

      // The list of the case before was mounted when the namespace was chosen: the search of the host took the
      // focus then, as the host gives it to the search of every list it draws.
      expect(await inSearch()).toBe(true);
      // From a row, the keys the host takes for the whole frame bring the focus back to the search of the list.
      await frame.locator('[data-backup-row="backup-completed"]').focus();
      expect(await inSearch()).toBe(false);
      await started.window.keyboard.press(process.platform === "darwin" ? "Meta+f" : "Control+f");
      await expect.poll(inSearch, { timeout: 10_000 }).toBe(true);
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
    "reads the cluster from its frame, whose identifier the address of the frame and the catalogs of both processes give alike",
    async () => {
      // The identifier the host wrote in the address of the frame is the one it gives the cluster of the
      // kubeconfig and the context of the environment, in the catalog of the renderer and in the one of the
      // main process, which name the same cluster.
      const id = cluster.frameClusterId(frame);
      const origin = new URL(frame.url()).origin;

      expect(new URL(frame.url()).hostname).toBe(`${id}.renderer.freelens.app`);
      expect(id).toBe(cluster.clusterEntityId(kubeconfig, cluster.E2E_KUBE_CONTEXT));
      expect(await cluster.rendererCatalogCluster(frame)).toEqual({
        id,
        name: cluster.E2E_KUBE_CONTEXT,
        contextName: cluster.E2E_KUBE_CONTEXT,
      });
      expect(await velero.mainCatalog(started.app)).toEqual([
        {
          id,
          name: cluster.E2E_KUBE_CONTEXT,
          kubeConfigPath: kubeconfig,
          contextName: cluster.E2E_KUBE_CONTEXT,
          status: "connected",
        },
      ]);
      // A read of the installation leaves from the frame, to the address of the frame: what the window sent of
      // it is what the API server counted of the reads of the kinds of Velero, and nothing else reached it. The
      // controllers of the installation read through their watches, which are not counted here; a read that
      // something else asked in the same time is taken again.
      const reads = (counts: Record<string, number>) =>
        Object.fromEntries(Object.entries(counts).filter(([key]) => /^(LIST|GET) /.test(key)));
      let seen: cluster.SeenRequest[] = [];
      let sent: Record<string, number> = {};
      let asked: Record<string, number> = {};

      for (let attempt = 1; attempt <= 3; attempt += 1) {
        await cluster.afterRead(frame);
        const earlier = cluster.apiRequests();

        seen = await cluster.veleroRequestsDuring(started.window, async () => {
          await cluster.readAgain(frame);
          await frame.waitForTimeout(1500);
        });
        asked = reads(cluster.counted(earlier, cluster.apiRequests()));
        sent = {};
        for (const request of seen) {
          const key = cluster.countedAs(request);

          if (key) sent[key] = (sent[key] ?? 0) + 1;
        }
        sent = reads(sent);
        if (JSON.stringify(Object.entries(sent).sort()) === JSON.stringify(Object.entries(asked).sort())) break;
      }
      // Every read went from the frame of the cluster to the proxy of its own address: of a kind of Velero, or
      // of the group, which says what the cluster serves.
      expect(
        seen.filter(
          (request) =>
            request.method !== "GET" ||
            new URL(request.url).origin !== origin ||
            !/^\/api-kube\/apis\/velero\.io\/v1(\/|$)/.test(new URL(request.url).pathname) ||
            new URL(request.frame || "about:blank").origin !== origin,
        ),
      ).toEqual([]);
      for (const kind of FAMILIES) expect([kind, (sent[`LIST ${kind} namespace`] ?? 0) >= 1]).toEqual([kind, true]);
      expect(sent["LIST backupstoragelocations cluster"]).toBeGreaterThanOrEqual(1);
      expect(sent).toEqual(asked);
      await cluster.writeReport("host-12-reads-of-the-frame", {
        cluster: id,
        origin,
        sent,
        asked,
        group: seen.filter((request) => !cluster.countedAs(request)).length,
      });
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
      // The workspace opens at the first of its five tabs, the summary, which only reads: the way to the
      // location of the backup, beside the way back of the workspace, and no field. What Velero wrote of the
      // backup is asked for by a command of another tab, and nothing edits or deletes.
      const tabs = await artifacts.tabsOf(frame, "backup");
      const buttons = async (selector: string) =>
        (await frame.locator(`${selector} button`).allInnerTexts()).map((text) => text.replace(/\s+/g, " ").trim());

      expect(tabs.tabs.map(({ title }) => title)).toEqual(artifacts.TABS.map(({ title }) => title));
      expect([tabs.open, tabs.selected]).toEqual(["summary", [artifacts.PARTS.tab("backup", "summary")]]);
      expect(await buttons(`[data-testid=${artifacts.PARTS.shown("backup")}]`)).toEqual(["fixture-unavailable"]);
      expect(await buttons("[data-testid=velero-backup-workspace]")).toEqual([
        "arrow_back Backups",
        "fixture-unavailable",
      ]);
      expect(
        await frame.locator("[data-testid=velero-backup-workspace]").locator("a, input, select, textarea").count(),
      ).toBe(0);
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
    "opens the details of the host by none of its own actions",
    async () => {
      // The cases before this one took the actions of the views alone: a page of the group, a choice, a read,
      // the views of objects, their ways to one another and back, another installation. None of them named an
      // object for the details of the host in the address of the frame, which is what opens their drawer.
      expect(await cluster.hostDetailsAddresses(frame)).toEqual([]);
      expect(await cluster.hostDetailsShown(frame)).toEqual({ drawer: false, address: false });
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
      // The link leads to the view of the extension: the drawer is gone with the address that named the object,
      // and neither the log of the main process nor the ones of the frames have an error.
      expect(await cluster.hostDetailsGone(frame)).toEqual({ drawer: false, address: false });
      const logs = await velero.hostLogErrors(started.app);

      expect(Object.keys(logs)).toEqual(
        expect.arrayContaining([
          "lens.log",
          "lens-renderer-root-frame.log",
          `lens-renderer-cluster-${cluster.frameClusterId(frame)}-frame.log`,
        ]),
      );
      expect(Object.values(logs).flat()).toEqual([]);
      await cluster.closeWorkspace(frame);
      await cluster.expectRow(frame, SCHEDULED, "Completed");
    },
    TIMEOUT,
  );

  it(
    "opens a view of its list under the details of the host, which a way of the view closes as a click outside does",
    async () => {
      // The details of the host over the page of the backups, as the host opens them: by the address.
      await cluster.showHostDetails(
        frame,
        `/apis/velero.io/v1/namespaces/${cluster.E2E_VIEWS_NAMESPACE}/backups/${SCHEDULED}`,
      );
      await frame.waitForSelector(".Drawer.KubeObjectDetails [data-testid=velero-backup-details]", {
        timeout: 60_000,
      });
      // A click on a row of the list opens its view under them, and the drawer stays over it: the row of the
      // host prevents the default of the click, which the drawer then does not take for a click outside.
      await frame
        .locator("[data-testid=velero-backups] .TableRow", { has: frame.locator(`[data-backup-row="${SCHEDULED}"]`) })
        .locator(".TableCell.phase")
        .click();
      await frame.waitForSelector(`[data-testid=velero-backup-name] >> text="${SCHEDULED}"`, { timeout: 60_000 });
      expect(await cluster.addressViews(frame)).toEqual([`backup/${SCHEDULED}`]);
      expect(await cluster.hostDetailsShown(frame)).toEqual({ drawer: true, address: true });
      await cluster.captureScreenshot(frame, "dark-view-under-host-details");
      // A way of the view is a click outside the drawer: the host closes it, and the view goes on to the
      // schedule, with the views the address names.
      await cluster.followTo(frame, "schedule", "views-daily");
      expect(await cluster.hostDetailsGone(frame)).toEqual({ drawer: false, address: false });
      expect(await cluster.addressViews(frame)).toEqual([`backup/${SCHEDULED}`, "schedule/views-daily"]);
      await cluster.showList(frame);
      // The name of a row, which the keyboard reaches, keeps its click to itself: the drawer stays as well. The
      // way back of the view, a command, is a click outside, and the drawer goes.
      await cluster.showHostDetails(
        frame,
        `/apis/velero.io/v1/namespaces/${cluster.E2E_VIEWS_NAMESPACE}/backups/backup-inprogress`,
      );
      await cluster.openWorkspace(frame, "backup-inprogress");
      expect(await cluster.hostDetailsShown(frame)).toEqual({ drawer: true, address: true });
      await frame.click("[data-testid=velero-back]");
      expect(await cluster.hostDetailsGone(frame)).toEqual({ drawer: false, address: false });
      expect(await cluster.shownView(frame)).toBeUndefined();
      expect(Object.values(await velero.hostLogErrors(started.app)).flat()).toEqual([]);
      await cluster.expectRow(frame, SCHEDULED, "Completed");
    },
    TIMEOUT,
  );

  it(
    "gives every page of the group the tabs of the group, and leaves its five kinds out of the Custom Resources of the host until it is disabled",
    async () => {
      const { velero: _group, ...entries } = await cluster.veleroSidebarEntries(frame);
      const titles = Object.values(entries);

      for (const of of [
        cluster.OVERVIEW,
        cluster.BACKUPS,
        cluster.RESTORES,
        cluster.SCHEDULES,
        cluster.STORAGE_LOCATIONS,
        cluster.SNAPSHOT_LOCATIONS,
      ]) {
        await cluster.openPage(frame, of);
        expect([of.id, await cluster.groupTabs(frame)]).toEqual([of.id, { tabs: titles, active: [entries[of.menu]] }]);
        expect([of.id, await frame.locator(".TabLayout .TabLayout").count()]).toEqual([of.id, 0]);
      }
      // While the extension is enabled the kinds with pages of their own are out of the tree, and the other
      // kinds of the group are in it.
      const enabled = await cluster.customResourceKinds(frame);

      expect(enabled.filter((kind) => FAMILIES.includes(kind))).toEqual([]);
      expect(enabled).toContain("downloadrequests");
      await cluster.captureScreenshot(frame, "dark-custom-resources-enabled");
      // Disabled from the Extensions page, the extension leaves the sidebar, and the tree has the five again.
      await velero.disableExtension(started.app, started.window);
      await velero.captureWindowScreenshot(started.window, "dark-extension-disabled");
      await velero.navigateToCatalog(started.app);
      frame = await cluster.openClusterFromCatalog(started.window, kubeconfig);
      await expect.poll(() => cluster.veleroSidebarEntries(frame), { timeout: 60_000 }).toEqual({});
      expect(await cluster.customResourceKinds(frame)).toEqual([...enabled, ...FAMILIES].sort());
      await cluster.captureScreenshot(frame, "dark-custom-resources-disabled");
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
