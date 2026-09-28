/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

// The Restores for who may read them and not the backups: an identity of the
// test environment that reads the restores, the schedules and the locations of
// one namespace. The source of a restore is a backup it cannot read: it is
// said denied, and is neither absent nor a link.

import { expect } from "@jest/globals";
import * as utils from "../helpers/utils";
import * as cluster from "../helpers/velero-cluster";
import * as velero from "../helpers/velero-extension";

import type { Frame } from "playwright";

const TIMEOUT = 10 * 60 * 1000;
const RESTORES = cluster.RESTORES;
const SCHEDULED = "views-daily-20260901030000";
const MAPPED = "restore-mapped";

describe("restores with restricted access", () => {
  let started: velero.StartedApplication;
  let frame: Frame;
  let before: cluster.ClusterSnapshot;

  beforeAll(async () => {
    if (!cluster.fixturesReady()) {
      throw new Error(`The fixtures are missing from ${cluster.E2E_CLUSTER_NAME}. Run \`pnpm demo:up\` first.`);
    }
    before = cluster.clusterSnapshot();
    started = await velero.startIsolated();
    const kubeconfig = await cluster.publishKubeconfig(
      cluster.secondReaderKubeconfigPath(),
      "velero-e2e-reader-of-restores",
    );

    await utils.clickWelcomeButton(started.window);
    await velero.installExtension(started.app, started.window);
    await velero.dismissNotifications(started.window);
    await velero.navigateToCatalog(started.app);
    expect(await velero.catalogClusterCount(started.window)).toBe(1);
    frame = await cluster.openClusterFromCatalog(started.window, kubeconfig);
    await velero.setWindowSize(started.app, 1440, 900);
  }, TIMEOUT);

  afterAll(async () => {
    await started?.cleanup();
  }, TIMEOUT);

  it(
    "reads the restores of the namespace that is named, and says nothing of what the list does not need",
    async () => {
      await cluster.openPage(frame, RESTORES);
      await frame.waitForSelector("[data-testid=velero-state-configure]", { timeout: 60_000 });
      await cluster.configureInstallation(frame, cluster.E2E_VIEWS_NAMESPACE);
      await cluster.waitForList(frame, RESTORES);
      await cluster.expectCells(RESTORES, frame, MAPPED, {
        source: `${SCHEDULED}, schedule views-daily`,
        phase: "Waiting for plugin operations",
        failure: "1 error",
      });
      expect(await cluster.mounted(frame, RESTORES)).toHaveLength(6);
      // The list needs the restores and has them: the backups that are denied are not its notice.
      expect(await cluster.notices(frame, [])).toEqual({});
      await cluster.captureScreenshot(frame, "dark-restricted-restores");
    },
    TIMEOUT,
  );

  it(
    "keeps the restore and says that its source cannot be read, which is not that it is not there",
    async () => {
      await cluster.openWorkspace(frame, MAPPED, RESTORES);
      const shown = async () => ({
        notices: await cluster.notices(frame, ["backups"]),
        status: (await frame.locator("[data-testid=velero-restore-status]").innerText()).replace(/\s+/g, " "),
        source: await cluster.reference(frame, `velero-reference-Backup-${SCHEDULED}`, "inaccessible"),
        location: await frame.locator("[data-testid=velero-reference-BackupStorageLocation-none]").innerText(),
        schedule: await cluster.reference(frame, "velero-reference-Schedule-views-daily", "resolved"),
        stale: await frame.locator("[data-testid=velero-restore-stale]").count(),
      });
      const first = await shown();

      expect(Object.keys(first.notices)).toEqual(["backups"]);
      expect(first.notices.backups).toContain("access is denied");
      expect(first.status).toContain("Waiting for plugin operations");
      expect(first.source.state).toBe("inaccessible");
      expect(first.source.text).toContain("access is denied");
      expect(first.source.text).not.toMatch(/No backup of this name/);
      expect(await frame.locator(`[data-testid="velero-reference-Backup-${SCHEDULED}"] button`).count()).toBe(0);
      // What is known through the backup is not known, and the schedule, which is read, is.
      expect(first.location).toBe("Known through the backup, which is not among what was read");
      expect(first.schedule.state).toBe("resolved");
      expect(first.stale).toBe(0);
      expect(await cluster.layoutProblems(frame, RESTORES)).toEqual([]);
      // A read that is asked with the restore open finds the same, and what is denied stays denied: it is
      // not of an earlier read, and it is not missing.
      await cluster.readAgain(frame);
      expect(await shown()).toEqual(first);
      await frame.locator("[data-testid=velero-restore-source]").scrollIntoViewIfNeeded();
      await cluster.captureScreenshot(frame, "dark-restricted-restore-source");
      await cluster.closeWorkspace(frame);
      await cluster.readAgain(frame);
      expect(await cluster.mounted(frame, RESTORES)).toHaveLength(6);
      expect(await cluster.notices(frame, [])).toEqual({});
    },
    TIMEOUT,
  );

  it(
    "says that the backups are denied, and not that there are none",
    async () => {
      await cluster.openBackups(frame);
      await frame.waitForSelector("[data-testid=velero-backups-unavailable]", { timeout: 60_000 });
      const state = await frame.locator("[data-testid=velero-backups-unavailable]").innerText();

      expect(state).toContain("Access to the backups of this namespace is denied");
      expect(state).toContain("How many there are is not known");
      expect(await cluster.mountedBackups(frame)).toEqual([]);
      expect(await frame.locator("[data-testid=velero-backups-page]").innerText()).not.toMatch(/\b\d+ items?\b/);
      await cluster.captureScreenshot(frame, "dark-restricted-backups-denied");
    },
    TIMEOUT,
  );

  it(
    "leaves the objects of Velero as they were",
    async () => {
      const after = cluster.clusterSnapshot();

      expect(after.versions).toEqual(before.versions);
      expect(after.installed).toEqual(before.installed);
      expect(after.requests).toBe(0);
    },
    TIMEOUT,
  );
});
