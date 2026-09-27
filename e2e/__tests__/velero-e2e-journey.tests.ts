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
      // Only the views that exist have an entry: the group, and the backups under it.
      expect(await cluster.veleroSidebarEntries(frame)).toEqual({ velero: "Velero", "velero-backups": "Backups" });
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
      await cluster.expectRow(frame, "backup-completed", "Completed", "No errors", "10 / 10 (100%)");
      await cluster.expectRow(frame, "backup-finalizingpartiallyfailed", "Finalizing", "1 error", "so far");
      await cluster.expectRow(frame, "backup-failedvalidation", "Failed validation", "1 validation error");
      await cluster.expectRow(frame, "backup-partiallyfailed", "Partially failed", "1 error");
      await cluster.expectRow(frame, "backup-deleting", "Deleting", "Unknown");
      await cluster.expectRow(frame, "backup-new", "New", "Not reported", "Not started");
      expect(await cluster.mountedBackups(frame)).toHaveLength(13);
      // A phase that finished in a failure does not carry the mark of what went well.
      expect(await frame.locator('[data-testid=velero-backups] [data-phase="Failed"] .Icon').first().innerText()).toBe(
        "highlight_off",
      );
      expect(await cluster.notices(frame)).toEqual({});
      expect(await cluster.layoutProblems(frame)).toEqual([]);
      await cluster.captureScreenshot(frame, "dark-backups");
    },
    TIMEOUT,
  );

  it(
    "reads again the installation that is shown and nothing else",
    async () => {
      const earlier = cluster.apiRequests();

      await frame.click("[data-testid=velero-refresh]");
      await frame.waitForTimeout(3000);
      const later = cluster.apiRequests();

      expect(later[DISCOVERY]).toBe(earlier[DISCOVERY] + 1);
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
      expect(await frame.locator("[data-testid=velero-backup-counts-note]").count()).toBe(1);
      // A workspace that only reads: nothing in it asks Velero for a log, and nothing edits or deletes.
      expect(
        (await frame.locator("[data-testid=velero-backup-workspace] button").allInnerTexts()).map((text) =>
          text.replace(/\s+/g, " ").trim(),
        ),
      ).toEqual(["arrow_back Backups"]);
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
      const location = await cluster.reference(frame, "velero-reference-BackupStorageLocation-fixture-unavailable");

      expect(location.state).toBe("resolved");
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
      const schedule = await cluster.reference(frame, "velero-reference-Schedule-views-daily");
      const location = await cluster.reference(frame, "velero-reference-BackupStorageLocation-views-available");
      const snapshots = await cluster.reference(frame, "velero-reference-VolumeSnapshotLocation-views-snapshots");
      const restores = await cluster.reference(frame, "velero-related-restores");

      expect(schedule).toMatchObject({ state: "resolved" });
      expect(schedule.text).toContain("0 3 * * *");
      expect(location).toMatchObject({ state: "resolved" });
      expect(location.text).toContain("Available");
      expect(location.text).toContain("ReadWrite");
      expect(snapshots).toMatchObject({ state: "resolved" });
      expect(restores.state).toBe("listed");
      expect(restores.text).toContain("restore-of-daily-completed (Completed)");
      expect(restores.text).toContain("restore-of-daily-partiallyfailed (Partially failed)");
      expect(await cluster.notices(frame)).toEqual({});
      expect(await cluster.layoutProblems(frame)).toEqual([]);
      await frame.locator("[data-testid=velero-backup-references]").scrollIntoViewIfNeeded();
      await cluster.captureScreenshot(frame, "dark-backup-references");
      await cluster.closeWorkspace(frame);

      await cluster.openWorkspace(frame, "backup-missing-location");
      const missing = await cluster.reference(frame, "velero-reference-BackupStorageLocation-views-removed");

      expect(missing.state).toBe("absent");
      expect(missing.text).toContain("views-removed");
      expect(await frame.locator("[data-testid=velero-backup-references] a").count()).toBe(0);
      await frame.locator("[data-testid=velero-backup-references]").scrollIntoViewIfNeeded();
      await cluster.captureScreenshot(frame, "dark-backup-references-missing");
      await cluster.closeWorkspace(frame);

      await cluster.openWorkspace(frame, "backup-missing-schedule");
      expect((await cluster.reference(frame, "velero-reference-Schedule-views-removed")).state).toBe("absent");
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
      await frame.locator(`[data-backup-row="${SCHEDULED}"]`).click({ button: "right" });
      expect(await frame.locator(".Menu .MenuItem").count()).toBe(0);
      // A right click opens nothing; what a left click of the same place would do is open the workspace.
      await frame.waitForTimeout(500);
      if ((await frame.locator("[data-testid=velero-backup-workspace]").count()) > 0)
        await cluster.closeWorkspace(frame);
      await frame.locator(`[data-backup-row="${SCHEDULED}"]`).focus();
      for (const key of ["Delete", "Backspace", "Control+a", "Meta+Backspace"]) {
        await started.window.keyboard.press(key);
      }
      expect(await frame.locator('[data-testid="confirmation-dialog"], .Dialog, .ConfirmDialog').count()).toBe(0);
      await cluster.expectRow(frame, SCHEDULED, "Completed");
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

      expect(Object.keys(before.versions).length).toBeGreaterThan(1000);
      expect(after.versions).toEqual(before.versions);
      expect(after.installed).toEqual(before.installed);
      expect(before.requests).toBe(0);
      expect(after.requests).toBe(0);
      expect(cluster.writes(requests, cluster.REQUEST_KINDS)).toEqual(cluster.writes(counted, cluster.REQUEST_KINDS));
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
