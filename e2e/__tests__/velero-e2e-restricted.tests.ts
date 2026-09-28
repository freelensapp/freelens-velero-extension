/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

// The views for who may read a part: an identity of the test environment that
// reads the backups, the schedules and the storage locations of one namespace,
// and nothing of the rest of the cluster. What it cannot read is said, and is
// neither an empty list nor a count of zero.

import { expect } from "@jest/globals";
import * as utils from "../helpers/utils";
import * as cluster from "../helpers/velero-cluster";
import * as velero from "../helpers/velero-extension";

import type { Frame } from "playwright";

const TIMEOUT = 10 * 60 * 1000;
const SCHEDULED = "views-daily-20260901030000";

describe("views with restricted access", () => {
  let started: velero.StartedApplication;
  let frame: Frame;
  let before: cluster.ClusterSnapshot;

  beforeAll(async () => {
    if (!cluster.fixturesReady()) {
      throw new Error(`The fixtures are missing from ${cluster.E2E_CLUSTER_NAME}. Run \`pnpm demo:up\` first.`);
    }
    before = cluster.clusterSnapshot();
    started = await velero.startIsolated();
    const kubeconfig = await cluster.publishKubeconfig(cluster.readerKubeconfigPath(), "velero-e2e-reader");

    await utils.clickWelcomeButton(started.window);
    await velero.installExtension(started.app, started.window);
    await velero.dismissNotifications(started.window);
    await velero.navigateToCatalog(started.app);
    expect(await velero.catalogClusterCount(started.window)).toBe(1);
    frame = await cluster.openClusterFromCatalog(started.window, kubeconfig);
  }, TIMEOUT);

  afterAll(async () => {
    await started?.cleanup();
  }, TIMEOUT);

  it(
    "does not say that Velero is absent when the installations cannot be looked for, and asks for a namespace",
    async () => {
      await cluster.openBackups(frame);
      await frame.waitForSelector("[data-testid=velero-state-configure]", { timeout: 60_000 });
      const state = await frame.locator("[data-testid=velero-state-configure]").innerText();

      expect(state).toContain("Access to the backup storage locations of the whole cluster is denied");
      expect(state).not.toContain("not installed");
      expect(await frame.locator("[data-testid^=velero-choice-]").count()).toBe(0);
      expect(await cluster.layoutProblems(frame)).toEqual([]);
      await cluster.captureScreenshot(frame, "dark-restricted-name-the-namespace");
    },
    TIMEOUT,
  );

  it(
    "reads what the identity may read of the namespace that is named",
    async () => {
      await cluster.configureInstallation(frame, cluster.E2E_VIEWS_NAMESPACE);
      await cluster.waitForBackups(frame);
      expect((await cluster.target(frame)).namespace).toBe(`${cluster.E2E_VIEWS_NAMESPACE} (configured)`);
      await cluster.expectRow(frame, SCHEDULED, "Completed", "2 warnings");
      // The list needs the backups and has them: what is denied is of no use to it, and is not its notice.
      expect(await cluster.notices(frame, [])).toEqual({});
      await cluster.captureScreenshot(frame, "dark-restricted-backups");
    },
    TIMEOUT,
  );

  it(
    "keeps the backup and says which of its references cannot be read",
    async () => {
      await cluster.openWorkspace(frame, SCHEDULED);
      const shown = await cluster.notices(frame, ["restores", "snapshotLocations"]);

      expect(Object.keys(shown).sort()).toEqual(["restores", "snapshotLocations"]);
      expect(shown.restores).toContain("access is denied");
      expect(shown.snapshotLocations).toContain("access is denied");
      expect(await frame.locator("[data-testid=velero-backup-status]").innerText()).toContain("Completed");
      expect((await cluster.reference(frame, "velero-reference-Schedule-views-daily", "resolved")).state).toBe(
        "resolved",
      );
      expect(
        (await cluster.reference(frame, "velero-reference-BackupStorageLocation-views-available", "resolved")).state,
      ).toBe("resolved");
      const snapshots = await cluster.reference(
        frame,
        "velero-reference-VolumeSnapshotLocation-views-snapshots",
        "inaccessible",
      );
      const restores = await cluster.reference(frame, "velero-related-restores", "inaccessible");

      expect(snapshots.state).toBe("inaccessible");
      expect(snapshots.text).toContain("access is denied");
      // The restores are not none: they are not known.
      expect(restores.state).toBe("inaccessible");
      expect(restores.text).toContain("access is denied");
      expect(restores.text).not.toMatch(/\bNone\b|\b0\b/);
      expect(await cluster.layoutProblems(frame)).toEqual([]);
      await frame.locator("[data-testid=velero-backup-references]").scrollIntoViewIfNeeded();
      await cluster.captureScreenshot(frame, "dark-restricted-references");
      await cluster.closeWorkspace(frame);
    },
    TIMEOUT,
  );

  it(
    "says that the restores are denied, and not that there are none, also while they are asked again",
    async () => {
      await cluster.openPage(frame, cluster.RESTORES);
      await frame.waitForSelector("[data-testid=velero-restores-unavailable]", { timeout: 60_000 });
      const shown = async () => ({
        state: (await frame.locator("[data-testid=velero-restores-unavailable]").innerText()).replace(/\s+/g, " "),
        list: await frame.locator("[data-testid=velero-restores]").count(),
        notices: await cluster.notices(frame, ["restores"]),
        page: await frame.locator("[data-testid=velero-restores-page]").innerText(),
      });
      const first = await shown();

      expect(first.state).toContain("Access to the restores of this namespace is denied");
      expect(first.state).toContain("How many there are is not known");
      expect(first.list).toBe(0);
      expect(first.notices.restores).toContain("access is denied");
      expect(first.page).not.toMatch(/\b\d+ items?\b/);
      expect(await cluster.layoutProblems(frame, cluster.RESTORES)).toEqual([]);
      await cluster.captureScreenshot(frame, "dark-restricted-restores-denied");
      // What is denied is denied for as long as a read says so: a read that is asked does not make an
      // empty list of it, neither while it is asked nor when it ends. What the page shows is taken at
      // every change of it, from before the read is asked: the read is among what was taken.
      const seen = (await cluster.readState(frame)).read;

      await frame.evaluate(() => {
        const page = window as unknown as {
          veleroSamples?: { reading: boolean; unavailable: boolean; list: boolean }[];
          veleroSampler?: MutationObserver;
        };
        const samples: { reading: boolean; unavailable: boolean; list: boolean }[] = [];
        const sample = () =>
          samples.push({
            reading: document.querySelector("[data-testid=velero-read-time]")?.getAttribute("data-reading") === "true",
            unavailable: document.querySelector("[data-testid=velero-restores-unavailable]") !== null,
            list: document.querySelector("[data-testid=velero-restores]") !== null,
          });

        page.veleroSamples = samples;
        page.veleroSampler = new MutationObserver(sample);
        page.veleroSampler.observe(document.body, { attributes: true, childList: true, subtree: true });
        sample();
      });
      await frame.click("[data-testid=velero-refresh]");
      await cluster.afterRead(frame, seen);
      const during = await frame.evaluate(() => {
        const page = window as unknown as {
          veleroSamples?: { reading: boolean; unavailable: boolean; list: boolean }[];
          veleroSampler?: MutationObserver;
        };

        page.veleroSampler?.disconnect();
        return page.veleroSamples ?? [];
      });

      // The read was seen while it was asked, and what was shown during it is what was shown before.
      expect(during.some((sample) => sample.reading)).toBe(true);
      expect(during.filter((sample) => !sample.unavailable || sample.list)).toEqual([]);
      expect((await cluster.readState(frame)).read).not.toBe(seen);
      expect(await shown()).toEqual({ ...first, page: expect.any(String) });
      await cluster.openBackups(frame);
      await cluster.waitForBackups(frame);
    },
    TIMEOUT,
  );

  it(
    "says that the backups of a namespace are denied, and not that there are none",
    async () => {
      // The namespace of the phases is one this identity cannot read.
      await cluster.configureInstallation(frame, cluster.E2E_STATIC_NAMESPACE);
      await frame.waitForSelector("[data-testid=velero-backups-unavailable]", { timeout: 60_000 });
      const state = await frame.locator("[data-testid=velero-backups-unavailable]").innerText();

      expect(state).toContain("Access to the backups of this namespace is denied");
      expect(state).toContain("How many there are is not known");
      expect(await cluster.mountedBackups(frame)).toEqual([]);
      expect((await cluster.notices(frame, ["backups"])).backups).toContain("access is denied");
      expect(await cluster.layoutProblems(frame)).toEqual([]);
      await cluster.captureScreenshot(frame, "dark-restricted-denied");
      // A namespace that was named by mistake is taken back, and the one read before is chosen again.
      await frame.click("[data-testid=velero-namespaces-toggle]");
      await frame.click(`[data-testid="velero-namespaces-forget-${cluster.E2E_STATIC_NAMESPACE}"]`);
      await frame.waitForSelector("[data-testid=velero-state-choose], [data-testid=velero-backups]", {
        timeout: 60_000,
      });
      expect(await frame.locator(`[data-testid="velero-choice-${cluster.E2E_STATIC_NAMESPACE}"]`).count()).toBe(0);
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
