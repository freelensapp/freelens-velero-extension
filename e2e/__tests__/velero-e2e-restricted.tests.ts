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
    "shows a location with the Secrets it names to an identity that reads no Secret, and denies nothing of it",
    async () => {
      const locations = cluster.STORAGE_LOCATIONS;
      const identity = `system:serviceaccount:${cluster.E2E_VIEWS_NAMESPACE}:views-reader`;
      const secrets = cluster.kubectlE2E(
        "get",
        "secrets",
        "--namespace",
        cluster.E2E_VIEWS_NAMESPACE,
        "--as",
        identity,
        "-o",
        "name",
      );

      // The identity the application reads the cluster with may not read a Secret, and may read a location.
      expect(secrets.status).not.toBe(0);
      expect(secrets.stderr).toMatch(/forbidden/i);
      expect(
        cluster.kubectlE2E(
          "get",
          "backupstoragelocations.velero.io",
          "--namespace",
          cluster.E2E_VIEWS_NAMESPACE,
          "--as",
          identity,
          "-o",
          "name",
        ).status,
      ).toBe(0);
      await cluster.openPage(frame, locations);
      await cluster.selectInstallation(frame, cluster.E2E_VIEWS_NAMESPACE);
      await cluster.waitForList(frame, locations);
      await cluster.openWorkspace(frame, "views-with-credential", locations);
      const credentials = (
        await frame.locator("[data-testid=velero-storage-location-credentials]").innerText()
      ).replace(/\s+/g, " ");

      expect(credentials).toMatch(/CREDENTIAL Secret views-credential, key cloud/i);
      expect(credentials).toMatch(/CERTIFICATE Secret views-storage-ca, key ca\.crt/i);
      // The view shows the location and what uses it, which this identity reads: nothing of it is denied,
      // and what is denied of the restores and of the snapshot locations is not said over it.
      expect(await frame.locator("[data-testid=velero-location-backups]").getAttribute("data-users")).toBe("listed");
      expect(await frame.locator("[data-testid=velero-location-schedules]").getAttribute("data-users")).toBe("listed");
      expect(await cluster.notices(frame, [])).toEqual({});
      await cluster.captureScreenshot(frame, "dark-restricted-location-credentials");
      await cluster.closeWorkspace(frame);
      // The snapshot locations are denied to it: their list says so, and is not an empty one.
      await cluster.openPage(frame, cluster.SNAPSHOT_LOCATIONS);
      await frame.waitForSelector("[data-testid=velero-snapshot-locations-unavailable]", { timeout: 60_000 });
      expect(await frame.locator("[data-testid=velero-snapshot-locations-unavailable]").innerText()).toContain(
        "Access to the volume snapshot locations of this namespace is denied",
      );
    },
    TIMEOUT,
  );

  it(
    "says on the Overview what is denied, which is not a count of none, and what could not be checked",
    async () => {
      await cluster.selectInstallation(frame, cluster.E2E_VIEWS_NAMESPACE);
      await cluster.openPage(frame, cluster.OVERVIEW);
      const shown = await cluster.overview(frame);

      expect(shown.read.restores).toEqual({ text: "Restores Access denied", state: "denied" });
      expect(shown.read.snapshotLocations).toEqual({
        text: "Volume Snapshot Locations Access denied",
        state: "denied",
      });
      expect([shown.read.backups.state, shown.read.schedules.state, shown.read.storageLocations.state]).toEqual([
        "read",
        "read",
        "read",
      ]);
      expect(shown.read.backups.text).toMatch(/^Backups \d+$/);
      // The rules looked at what was read, and say what they did not look at: the restores. No rule is
      // of the snapshot locations, and nothing is said of them among what needs attention.
      expect(shown.unchecked).toEqual(["restores"]);
      expect(shown.summary).toMatch(/^\d+ items in what was read\. Not everything was read\.$/);
      const attention = (await frame.locator("[data-testid=velero-overview-attention]").innerText()).replace(
        /\s+/g,
        " ",
      );

      expect(attention).toContain("The restores of this installation cannot be read: access is denied.");
      expect(attention).toContain(
        "Whether a restore in flight carries a failure, and whether one ended with a failure, were not checked.",
      );
      // No item is of a restore, and the restores are not said none: in flight, and on the line of time.
      expect(await frame.locator("[data-testid=velero-overview] [data-testid^=velero-open-restore-]").count()).toBe(0);
      expect(await frame.locator("[data-testid=velero-overview-in-flight-none]").count()).toBe(0);
      expect(
        (await frame.locator("[data-testid=velero-overview-in-flight]").innerText()).replace(/\s+/g, " "),
      ).toContain("Whether a restore is in flight is not known.");
      expect(
        (await frame.locator("[data-testid=velero-overview-line-restores-unread]").innerText()).replace(/\s+/g, " "),
      ).toMatch(
        /^The restores of this installation cannot be read: access is denied\. The restores of the last 7 days are not known, which is not that there are none\.$/,
      );
      expect(await frame.locator("[data-line-row=restores] [data-line-mark]").count()).toBe(0);
      // The backups were read, and their row is drawn: what it holds depends on how old the fixtures
      // are, which are not placed again, and is not what is looked at here.
      expect(await frame.locator("[data-line-row=backups]").getAttribute("data-line")).toBe("listed");
      expect(await frame.locator("[data-testid=velero-overview-line-backups-unread]").count()).toBe(0);
      expect(
        (await frame.locator("[data-testid=velero-overview-in-flight-none-of-one]").count()) +
          (await frame.locator('[data-testid=velero-overview-in-flight-list] [data-operation^="backup/"]').count()),
      ).toBeGreaterThan(0);
      // What was read is shown as where everything is: the newest backup that completed, the schedules.
      expect(shown.completed).toMatch(/ completed \S/);
      expect(shown.schedules.length).toBeGreaterThan(0);
      expect(shown.storage.length).toBeGreaterThan(0);
      expect(await cluster.valuesOfTheWhole(frame)).toEqual([]);
      expect(await cluster.layoutProblems(frame, cluster.OVERVIEW)).toEqual([]);
      await cluster.captureScreenshot(frame, "dark-restricted-overview");
      // The cell of what is denied leads to its list, which says the same.
      await frame.click("[data-testid=velero-overview-read-restores]");
      await frame.waitForSelector("[data-testid=velero-restores-unavailable]", { timeout: 60_000 });
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
