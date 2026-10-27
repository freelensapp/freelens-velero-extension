/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

// The backup repositories, the pod volume backups and the pod volume restores, in a packaged Freelens, against
// the test environment as its fixtures leave it today: no object of the three kinds is in it, in the namespace of
// the views or in the one of the installation, where no backup of the file system ran yet. The suite proves the
// lists of the three kinds with what they say of a namespace that holds none, and the reads of the pod volume
// operations, which the views ask only while a view that shows them is open, counted on the API server. The suite
// reads the application and the cluster, and writes to neither.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as cluster from "../../integration/helpers/velero-cluster";
import * as velero from "../../integration/helpers/velero-extension";

import type { Frame } from "playwright";

const TIMEOUT = 10 * 60 * 1000;
const LISTS: [cluster.ListOf, string][] = [
  [cluster.REPOSITORIES, "backup repository"],
  [cluster.POD_VOLUME_BACKUPS, "pod volume backup"],
  [cluster.POD_VOLUME_RESTORES, "pod volume restore"],
];
const PVB = "LIST podvolumebackups namespace";
const PVR = "LIST podvolumerestores namespace";
// How many reads of the installation each window of the reads waits for: one every fifteen seconds.
const CYCLES = 3;

describe("views of the backup repositories and of the pod volume operations", () => {
  let started: velero.StartedApplication;
  let frame: Frame;
  const errors = velero.createErrorCollector();
  let before: cluster.ClusterSnapshot;
  let counted: Record<string, number>;
  const empty = (of: cluster.ListOf) =>
    frame
      .locator(`[data-testid=velero-${of.id}-empty] > span`)
      .evaluate((element) => (element.textContent ?? "").replace(/\s+/g, " ").trim());
  // The requests the API server counted while the views read the installation `reads` times, from the end of a
  // read to the end of the last: what the page that is shown asks at each read.
  const askedOver = async (reads: number) => {
    await cluster.afterRead(frame);
    const first = cluster.apiRequests();

    for (let read = 0; read < reads; read += 1) await cluster.afterRead(frame);
    return cluster.counted(first, cluster.apiRequests());
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
    counted = cluster.apiRequests();
    frame = await cluster.openClusterFromCatalog(started.window, kubeconfig);
    await velero.setWindowSize(started.app, 1440, 900);
  }, TIMEOUT);

  afterAll(async () => {
    if (started) errors.stop(started.window);
    await started?.cleanup();
  }, TIMEOUT);

  it(
    "lists none of the three kinds in the installation of the views, and says of each list of what it is",
    async () => {
      for (const [of, noun] of LISTS) {
        await cluster.openPage(frame, of);
        if (of === cluster.REPOSITORIES) await cluster.selectInstallation(frame, cluster.E2E_VIEWS_NAMESPACE);
        await frame.waitForSelector(`[data-testid=velero-${of.id}-empty]`, { timeout: 60_000 });
        expect([of.id, await empty(of)]).toEqual([
          of.id,
          `No ${noun} is in the namespace ${cluster.E2E_VIEWS_NAMESPACE} of ${cluster.E2E_KUBE_CONTEXT}.`,
        ]);
        // The host says that the list is empty: no row, and the count of none, which is a count.
        expect([of.id, await cluster.mounted(frame, of)]).toEqual([of.id, []]);
        expect([of.id, await cluster.notices(frame, [])]).toEqual([of.id, {}]);
        expect([of.id, await cluster.layoutProblems(frame, of)]).toEqual([of.id, []]);
        await cluster.captureScreenshot(frame, `dark-${of.id}-empty`);
      }
      // In the smallest window of the review the head of each list, its twelve or nine columns among it, lies over
      // nothing and fits its room. The room of the columns with their rows, at 900 by 650 and at each edge of the
      // room, is measured once objects of the three kinds are in the installation, with their fixtures.
      await velero.setWindowSize(started.app, 900, 650);
      for (const [of] of LISTS) {
        await cluster.openPage(frame, of);
        await frame.waitForSelector(`[data-testid=velero-${of.id}-empty]`, { timeout: 60_000 });
        expect([of.id, await cluster.layoutProblems(frame, of)]).toEqual([of.id, []]);
      }
      await velero.setWindowSize(started.app, 1440, 900);
    },
    TIMEOUT,
  );

  it(
    "lists no backup repository in the installation, where no backup of the file system ran yet",
    async () => {
      await cluster.openPage(frame, cluster.REPOSITORIES);
      await cluster.selectInstallation(frame, cluster.E2E_NAMESPACE);
      await frame.waitForSelector(`[data-testid=velero-${cluster.REPOSITORIES.id}-empty]`, { timeout: 60_000 });
      expect(await empty(cluster.REPOSITORIES)).toBe(
        `No backup repository is in the namespace ${cluster.E2E_NAMESPACE} of ${cluster.E2E_KUBE_CONTEXT}.`,
      );
      // The cluster says the same, read by the suite and not by the application.
      const held = cluster.kubectlE2E(
        "get",
        "backuprepositories.velero.io",
        "--namespace",
        cluster.E2E_NAMESPACE,
        "-o",
        "name",
      );

      expect([held.status, held.stdout.trim()]).toEqual([0, ""]);
      await cluster.selectInstallation(frame, cluster.E2E_VIEWS_NAMESPACE);
    },
    TIMEOUT,
  );

  it(
    "reads the pod volume backups while their list is shown, once at each read, and not while another page is",
    async () => {
      await cluster.openPage(frame, cluster.POD_VOLUME_BACKUPS);
      await frame.waitForSelector(`[data-testid=velero-${cluster.POD_VOLUME_BACKUPS.id}-empty]`, { timeout: 60_000 });
      const shown = await askedOver(CYCLES);

      // One list of the family at each read the page waited for, and none of the pod volume restores, which no
      // view that is open shows. The counters carry no namespace: what the node agent of the installation asks of
      // the four kinds of its namespace is counted with the reads of the views. On the test environment of
      // 2026-10-27 each window counted one list at each read, three of three, and nothing else listed the two
      // kinds in a namespace; the bound below, one more than the reads waited for, leaves room for a read that
      // ends at the edge of a window. The controllers of the four kinds are measured with their objects in place.
      expect(shown[PVB] ?? 0).toBeGreaterThanOrEqual(CYCLES);
      expect(shown[PVB] ?? 0).toBeLessThanOrEqual(CYCLES + 1);
      expect(shown[PVR] ?? 0).toBe(0);
      await cluster.openPage(frame, cluster.POD_VOLUME_RESTORES);
      await frame.waitForSelector(`[data-testid=velero-${cluster.POD_VOLUME_RESTORES.id}-empty]`, { timeout: 60_000 });
      const restores = await askedOver(CYCLES);

      expect(restores[PVR] ?? 0).toBeGreaterThanOrEqual(CYCLES);
      expect(restores[PVR] ?? 0).toBeLessThanOrEqual(CYCLES + 1);
      // The page of the pod volume backups was left: its family is not asked at the reads after it.
      expect(restores[PVB] ?? 0).toBe(0);
      for (const of of [cluster.BACKUPS, cluster.OVERVIEW]) {
        await cluster.openPage(frame, of);
        // A read that was asked before the page was left may have asked them still: the window begins after it.
        await cluster.afterRead(frame);
        const elsewhere = await askedOver(CYCLES);

        // None of the pod volume operations is listed while these pages are shown, by the views or by anything else
        // of the test environment, whose counters showed none in either window on 2026-10-27.
        expect([of.id, elsewhere[PVB] ?? 0, elsewhere[PVR] ?? 0]).toEqual([of.id, 0, 0]);
        expect([of.id, (elsewhere["LIST backuprepositories namespace"] ?? 0) >= CYCLES]).toEqual([of.id, true]);
      }
      await cluster.writeReport("kind-02-reads-of-the-pod-volume-operations", {
        cycles: CYCLES,
        podVolumeBackupsShown: shown,
        podVolumeRestoresShown: restores,
      });
    },
    TIMEOUT,
  );

  it(
    "leaves the objects of Velero as they were, writes nothing, and asks Velero for nothing",
    async () => {
      const after = cluster.clusterSnapshot();
      const requests = cluster.apiRequests();

      expect(after.versions).toEqual(before.versions);
      expect(after.installed).toEqual(before.installed);
      expect(before.requests).toBe(0);
      expect(after.requests).toBe(0);
      expect(cluster.writes(counted, requests)).toEqual({});
      expect(errors.errors()).toEqual([]);
    },
    TIMEOUT,
  );
});
