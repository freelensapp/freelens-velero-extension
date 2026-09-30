/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

// The views for who may read the restores and not the backups: an identity of
// the test environment that reads the restores, the schedules and the locations
// of one namespace. The source of a restore and the history of a schedule are
// backups it cannot read: they are said denied, and are neither absent nor empty.

import { expect } from "@jest/globals";
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
    started = await velero.startWithExtension();
    const kubeconfig = await cluster.publishKubeconfig(
      cluster.secondReaderKubeconfigPath(),
      "velero-e2e-reader-of-restores",
    );
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
      // The schedule has a view of its own: a reference that resolves is a way to it.
      expect(await frame.locator('[data-testid="velero-reference-Schedule-views-daily"] button').count()).toBe(1);
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
    "says that the history of a schedule is not known, and not that the schedule has no backup",
    async () => {
      await cluster.openPage(frame, cluster.SCHEDULES);
      await cluster.waitForList(frame, cluster.SCHEDULES);
      await cluster.expectCells(cluster.SCHEDULES, frame, "views-history", {
        schedule: "0 1 * * *",
        newest: "Not known",
        phase: "Enabled",
      });
      expect(await frame.locator("[data-testid=velero-schedules]").innerText()).not.toContain("None that exists");
      // The list says of each schedule that its newest backup is not known: the notice of what is denied
      // is of the view of one schedule, which shows its history.
      expect(await cluster.notices(frame, [])).toEqual({});
      await cluster.openWorkspace(frame, "views-history", cluster.SCHEDULES);
      const history = frame.locator("[data-testid=velero-schedule-history]");

      expect(await history.getAttribute("data-history")).toBe("inaccessible");
      expect(await history.innerText()).toContain("access is denied");
      expect(await history.innerText()).toContain("is not known, which is not that it has none");
      // No row and no line: nothing is drawn of a history that is not known.
      expect(await cluster.history(frame)).toEqual({ rows: [], marks: [], over: [], width: 0 });
      expect(await frame.locator("[data-testid=velero-history-counts]").count()).toBe(0);
      expect((await cluster.notices(frame, ["backups"])).backups).toContain("access is denied");
      // What the schedule is asked, and where its backups go, is read: the locations are not denied.
      expect(
        (await cluster.reference(frame, "velero-reference-BackupStorageLocation-views-available", "resolved")).state,
      ).toBe("resolved");
      expect((await cluster.reference(frame, "velero-related-restores", "listed")).state).toBe("listed");
      expect(await cluster.layoutProblems(frame, cluster.SCHEDULES)).toEqual([]);
      await history.scrollIntoViewIfNeeded();
      await cluster.captureScreenshot(frame, "dark-restricted-schedule-history");
      await cluster.closeWorkspace(frame);
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
    "says that the backups that name a location are not known, which is not that none names it",
    async () => {
      const locations = cluster.STORAGE_LOCATIONS;

      await cluster.openPage(frame, locations);
      await cluster.waitForList(frame, locations);
      await cluster.expectCells(locations, frame, "views-available", {
        phase: "Available",
        marked: "Marked default",
      });
      // The list needs the locations and has them: the backups that are denied are not its notice.
      expect(await cluster.notices(frame, [])).toEqual({});
      await cluster.openWorkspace(frame, "views-available", locations);
      const backups = frame.locator("[data-testid=velero-location-backups]");
      const shown = (await backups.innerText()).replace(/\s+/g, " ").trim();

      expect(await backups.getAttribute("data-users")).toBe("inaccessible");
      expect(shown).toContain("access is denied");
      expect(shown).toContain("Which backups name this location is not known, which is not that none does");
      expect(shown).not.toMatch(/No backup that exists/);
      // The schedules are read: the ones whose template names the location, or none, are told.
      expect(await frame.locator("[data-testid=velero-location-schedules]").getAttribute("data-users")).toBe("listed");
      expect(
        (await frame.locator("[data-testid=velero-location-schedules] button").allInnerTexts()).length,
      ).toBeGreaterThan(0);
      expect(Object.keys(await cluster.notices(frame, ["backups"]))).toEqual(["backups"]);
      expect(await cluster.layoutProblems(frame, locations)).toEqual([]);
      await frame.locator("[data-testid=velero-location-users]").scrollIntoViewIfNeeded();
      await cluster.captureScreenshot(frame, "dark-restricted-location-users");
      await cluster.closeWorkspace(frame);
      // The snapshot locations are read by this identity, which the first reader is denied.
      await cluster.openPage(frame, cluster.SNAPSHOT_LOCATIONS);
      await cluster.waitForList(frame, cluster.SNAPSHOT_LOCATIONS);
      expect((await cluster.mounted(frame, cluster.SNAPSHOT_LOCATIONS)).sort()).toEqual([
        "views-snapshots",
        "views-snapshots-unreported",
      ]);
    },
    TIMEOUT,
  );

  it(
    "says on the Overview that the backups are not known: the newest that completed, the ones in flight, the ones of a schedule",
    async () => {
      await cluster.openPage(frame, cluster.OVERVIEW);
      const shown = await cluster.overview(frame);

      expect(shown.read.backups).toEqual({ text: "Backups Access denied", state: "denied" });
      expect(shown.read.restores).toEqual({ text: "Restores 6", state: "read" });
      expect(shown.unchecked).toEqual(["backups"]);
      const attention = (await frame.locator("[data-testid=velero-overview-attention]").innerText()).replace(
        /\s+/g,
        " ",
      );

      expect(attention).toContain("The backups of this installation cannot be read: access is denied.");
      expect(attention).toContain(
        "Whether a backup in flight carries a failure, whether one ended with a failure, and how the newest backup of each schedule ended were not checked.",
      );
      // No item is of a backup or names one, and no schedule is said to have a newest backup that failed.
      expect(await frame.locator("[data-testid=velero-overview] [data-testid^=velero-open-backup-]").count()).toBe(0);
      expect(shown.items.filter(([rule]) => rule === "A7")).toEqual([]);
      // The newest backup that completed is not known, which is not that none completed.
      expect(shown.completed).toBe("Not known: the backups of this installation cannot be read: access is denied");
      expect(
        await frame
          .locator("[data-testid=velero-overview-schedules-list] [data-completed]")
          .evaluateAll((elements) => [...new Set(elements.map((element) => (element.textContent ?? "").trim()))]),
      ).toEqual(["Not known"]);
      expect(
        (await frame.locator("[data-testid=velero-overview-in-flight]").innerText()).replace(/\s+/g, " "),
      ).toContain("Whether a backup is in flight is not known.");
      expect(await frame.locator("[data-testid=velero-overview-in-flight-none]").count()).toBe(0);
      expect(
        (await frame.locator("[data-testid=velero-overview-line-backups-unread]").innerText()).replace(/\s+/g, " "),
      ).toMatch(/^The backups of this installation cannot be read: access is denied\. The backups of the last 7 days /);
      // The restores that were read are where they would be: in flight, with their failures.
      expect(shown.inFlight.length).toBeGreaterThan(0);
      expect(shown.inFlight.every((operation) => operation.startsWith("restore/"))).toBe(true);
      expect(await cluster.valuesOfTheWhole(frame)).toEqual([]);
      expect(await cluster.layoutProblems(frame, cluster.OVERVIEW)).toEqual([]);
      await cluster.captureScreenshot(frame, "dark-restricted-restores-overview");
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
