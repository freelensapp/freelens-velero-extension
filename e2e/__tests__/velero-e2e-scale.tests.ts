/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

// The long list: a thousand synthetic backups in a namespace that holds no
// storage location. How many rows are mounted, how long the list takes to
// answer, and what it keeps of its state when a backup is opened and closed.

import { expect } from "@jest/globals";
import * as utils from "../helpers/utils";
import * as cluster from "../helpers/velero-cluster";
import * as velero from "../helpers/velero-extension";

import type { Frame } from "playwright";

const TIMEOUT = 10 * 60 * 1000;
const BACKUPS = 1000;
const MOUNTED = 100;
const BUDGET = 250;
// What is typed in the search, each time something that changes the rows that are shown.
const SEARCHES = [
  "failed validation",
  "queued",
  "backup-09",
  "scale-location-2",
  "deleting",
  "backup-0123",
  "in flight",
  "partially",
  "backup-1000",
  "completed",
];

function percentile(values: number[], fraction: number): number {
  const sorted = [...values].sort((one, other) => one - other);

  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
}

describe("long list of backups", () => {
  let started: velero.StartedApplication;
  let frame: Frame;
  let before: cluster.ClusterSnapshot;

  beforeAll(async () => {
    if (!cluster.fixturesReady()) {
      throw new Error(`The fixtures are missing from ${cluster.E2E_CLUSTER_NAME}. Run \`pnpm demo:up\` first.`);
    }
    before = cluster.clusterSnapshot();
    started = await velero.startIsolated();
    const kubeconfig = await cluster.publishKubeconfig();

    await utils.clickWelcomeButton(started.window);
    await velero.installExtension(started.app, started.window);
    await velero.dismissNotifications(started.window);
    await velero.navigateToCatalog(started.app);
    expect(await velero.catalogClusterCount(started.window)).toBe(1);
    frame = await cluster.openClusterFromCatalog(started.window, kubeconfig);
    await velero.setWindowSize(started.app, 1440, 900);
    await cluster.openBackups(frame);
  }, TIMEOUT);

  afterAll(async () => {
    await started?.cleanup();
  }, TIMEOUT);

  it(
    "reads a namespace that holds no storage location when it is named, and shows all its backups",
    async () => {
      await frame.waitForSelector("[data-testid=velero-state-choose]", { timeout: 60_000 });
      await cluster.configureInstallation(frame, cluster.E2E_SCALE_NAMESPACE);
      await cluster.waitForBackups(frame);
      await frame.waitForSelector(`[data-testid=velero-backups] >> text="${BACKUPS} items"`, { timeout: 60_000 });
      const mounted = await cluster.mountedBackups(frame);

      expect(mounted.length).toBeGreaterThan(0);
      expect(mounted.length).toBeLessThanOrEqual(MOUNTED);
      // No record is hidden: the last one is found by the search and by the scroll.
      await cluster.search(frame, "backup-1000");
      await cluster.expectRow(frame, "backup-1000", "scale-location-1");
      await cluster.search(frame, "");
      await frame.waitForSelector(`[data-testid=velero-backups] >> text="${BACKUPS} items"`, { timeout: 60_000 });
      await cluster.scrollList(frame, 1_000_000);
      await frame.waitForFunction(
        () => document.querySelectorAll("[data-testid=velero-backups] [data-backup-row]").length > 0,
        undefined,
        { timeout: 60_000 },
      );
      expect((await cluster.mountedBackups(frame)).length).toBeLessThanOrEqual(MOUNTED);
      await cluster.scrollList(frame, 0);
      // The storage locations these backups name are in no list: the reference says so.
      await cluster.openWorkspace(frame, (await cluster.mountedBackups(frame))[0]);
      expect((await cluster.reference(frame, "velero-reference-BackupStorageLocation-scale-location-1")).state).toBe(
        "absent",
      );
      await cluster.closeWorkspace(frame);
      await cluster.captureScreenshot(frame, "dark-backups-thousand");
    },
    TIMEOUT,
  );

  it(
    "answers a search and a selection within the budget, twenty times over",
    async () => {
      // Warm: the first interactions load what the ones after find loaded.
      for (const text of ["new", "ready", ""]) await cluster.measureSearch(frame, text);
      await cluster.measureOpen(frame, (await cluster.mountedBackups(frame))[0]);
      await cluster.measureClose(frame);
      const times: ({ interaction: string } & cluster.Measure)[] = [];
      let mounted = 0;

      for (const text of SEARCHES) {
        times.push({ interaction: `search ${text}`, ...(await cluster.measureSearch(frame, text)) });
        mounted = Math.max(mounted, (await cluster.mountedBackups(frame)).length);
      }
      await cluster.measureSearch(frame, "");
      mounted = Math.max(mounted, (await cluster.mountedBackups(frame)).length);
      for (let index = 0; index < 5; index += 1) {
        const name = (await cluster.mountedBackups(frame))[index * 3];

        times.push({ interaction: `open ${name}`, ...(await cluster.measureOpen(frame, name)) });
        times.push({ interaction: `back from ${name}`, ...(await cluster.measureClose(frame)) });
      }
      const rounded = (values: number[]) => ({
        p95: Math.round(percentile(values, 0.95)),
        median: Math.round(percentile(values, 0.5)),
        slowest: Math.round(Math.max(...values)),
      });
      const report = {
        backups: BACKUPS,
        // The most rows the list had mounted at once, of the thousand it shows.
        mounted,
        interactions: times.length,
        budget: BUDGET,
        // What the list takes to show what it is given: the measure the budget is for.
        response: rounded(times.map((time) => time.response)),
        // The same from the key or the click, with the wait of the search of the host in it.
        total: rounded(times.map((time) => time.total)),
        times: times.map((time) => ({
          interaction: time.interaction,
          response: Math.round(time.response),
          total: Math.round(time.total),
        })),
      };

      console.log(`BACK-12 ${JSON.stringify(report)}`);
      await cluster.writeReport("back-12-list-performance", report);
      expect(times).toHaveLength(20);
      expect(mounted).toBeGreaterThan(0);
      expect(mounted).toBeLessThanOrEqual(MOUNTED);
      expect(report.response.p95).toBeLessThan(BUDGET);
    },
    TIMEOUT,
  );

  it(
    "keeps the search, the order, the width of a column and the scroll when a backup is opened and closed",
    async () => {
      await cluster.search(frame, "scale-location-3");
      await frame.click("[data-testid=velero-backups] .TableHead .TableCell.started");
      await frame.click("[data-testid=velero-backups] .TableHead .TableCell.started");
      const resized = await cluster.resizeColumn(frame, "name", 90);

      expect(Math.abs(resized.after - resized.before)).toBeGreaterThan(30);
      await cluster.scrollList(frame, 1500);
      const state = await cluster.listState(frame);

      expect(state.search).toBe("scale-location-3");
      expect(state.scroll).toBeGreaterThan(1000);
      expect(state.sorted).toMatch(/started/);
      // A row the operator sees: one that is mounted above or below what is shown is not one to click.
      const name = (await cluster.visibleBackups(frame))[3];

      expect(name).toBeDefined();
      await cluster.openWorkspace(frame, name);
      await cluster.captureScreenshot(frame, "dark-backup-from-filtered-list");
      await cluster.closeWorkspace(frame);
      const back = await cluster.listState(frame);

      expect(back.search).toBe(state.search);
      expect(back.sorted).toBe(state.sorted);
      expect(back.items).toBe(state.items);
      expect(Math.abs(back.scroll - state.scroll)).toBeLessThanOrEqual(2);
      expect(Math.abs(back.columns.name - state.columns.name)).toBeLessThanOrEqual(1);
      expect(back.first).toBe(state.first);
      expect((await cluster.target(frame)).namespace).toBe(`${cluster.E2E_SCALE_NAMESPACE} (configured)`);
      await cluster.captureScreenshot(frame, "dark-backups-filtered-after-back");
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
