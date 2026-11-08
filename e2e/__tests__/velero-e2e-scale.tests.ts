/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

// The long lists: a thousand synthetic backups and a thousand synthetic
// restores in a namespace that holds no storage location. How many rows are
// mounted, how long a list takes to answer, and what it keeps of its state
// when an object is opened and closed. Since the fifth pull request of T5.1,
// the two thousand pod volume backups of the same namespace, the view of the
// backup of two hundred of them, the reads of their families counted on the
// API server, and nothing of a pod or of a Job read, with the control that
// the counters see such a read.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as cluster from "../../integration/helpers/velero-cluster";
import * as velero from "../../integration/helpers/velero-extension";

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

// The same for the restores: by their phases, by their names and by the backup each one names.
const RESTORE_SEARCHES = [
  "failed validation",
  "new",
  "restore-09",
  "backup-0007",
  "finalizing",
  "restore-0123",
  "in flight",
  "partially",
  "restore-1000",
  "completed",
];

// The pod volume backups of the long list: two for each of the first nine hundred backups, and two hundred of the
// thousandth, each named by its backup and a suffix the run makes.
const POD_VOLUME_BACKUPS = 2000;
// The same for the pod volume backups: by their phases and by the backups they belong to, which their names begin with.
const POD_VOLUME_BACKUP_SEARCHES = [
  "failed",
  "backup-09",
  "completed",
  "backup-0123",
  "accepted",
  "backup-1000",
  "canceled",
  "prepared",
  "backup-07",
  "in progress",
];

// The lists of the two families of the operations of a volume, in the namespace of the installation.
const PVB = "LIST podvolumebackups namespace";
const PVR = "LIST podvolumerestores namespace";
// How many reads of the installation each window of the reads waits for: one every fifteen seconds.
const CYCLES = 3;
// The backup whose band holds the most operations: the thousandth, with two hundred pod volume backups.
const BUSIEST = "backup-1000";
const OPERATIONS_OF_THE_BUSIEST = 200;

function percentile(values: number[], fraction: number): number {
  const sorted = [...values].sort((one, other) => one - other);

  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
}

// The measure of a list: twenty interactions after the ones that warm it, ten searches and five objects
// opened and closed, with the most rows the list had mounted at once.
async function measureList(
  frame: Frame,
  of: cluster.ListOf,
  searches: string[],
): Promise<{
  objects: number;
  mounted: number;
  interactions: number;
  budget: number;
  response: { p95: number; median: number; slowest: number };
  total: { p95: number; median: number; slowest: number };
  times: { interaction: string; response: number; total: number }[];
}> {
  // How many objects the list says it shows, with nothing searched: what was read of the namespace.
  const objects = Number(/^(\d+) items$/.exec((await cluster.listState(frame, of)).items)?.[1] ?? Number.NaN);

  // Warm: the first interactions load what the ones after find loaded.
  for (const text of ["new", "in progress", ""]) await cluster.measureSearch(frame, text, of);
  await cluster.measureOpen(frame, (await cluster.mounted(frame, of))[0], of);
  await cluster.measureClose(frame, of);
  const times: ({ interaction: string } & cluster.Measure)[] = [];
  let mounted = 0;

  // Every search is of a text the list is not searched by: one that changes nothing has no time.
  expect(searches.every((text, index) => text !== "" && text !== searches[index - 1])).toBe(true);
  for (const text of searches) {
    times.push({ interaction: `search ${text}`, ...(await cluster.measureSearch(frame, text, of)) });
    mounted = Math.max(mounted, (await cluster.mounted(frame, of)).length);
  }
  await cluster.measureSearch(frame, "", of);
  mounted = Math.max(mounted, (await cluster.mounted(frame, of)).length);
  for (let index = 0; index < 5; index += 1) {
    const name = (await cluster.mounted(frame, of))[index * 3];

    times.push({ interaction: `open ${name}`, ...(await cluster.measureOpen(frame, name, of)) });
    times.push({ interaction: `back from ${name}`, ...(await cluster.measureClose(frame, of)) });
  }
  const rounded = (values: number[]) => ({
    p95: Math.round(percentile(values, 0.95)),
    median: Math.round(percentile(values, 0.5)),
    slowest: Math.round(Math.max(...values)),
  });

  return {
    objects,
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
}

// What was measured is twenty interactions that took a time, of the objects that were read.
function expectMeasured(
  report: { interactions: number; times: { interaction: string; response: number; total: number }[] },
  objects: number,
): void {
  expect(objects).toBe(BACKUPS);
  expect(report.interactions).toBe(20);
  expect(new Set(report.times.map((time) => time.interaction)).size).toBe(20);
  // An interaction that changed what is shown took a frame at least, and the whole of it no less than
  // the part the list answers for.
  expect(report.times.filter((time) => !(time.total > 0) || time.response > time.total)).toEqual([]);
}

// The rows that are shown are of operations that started one after the other, the latest first: their
// names carry the order they were made in, which is the one of their starts.
function expectLatestFirst(names: string[]): void {
  const order = names.map((name) => Number(/-(\d{4})$/.exec(name)?.[1]));

  expect(order.length).toBeGreaterThan(3);
  expect(order).toEqual([...order].sort((one, other) => other - one));
  expect(new Set(order).size).toBe(order.length);
}

// Scrolls a list to its end, and waits for it to show rows that are not the ones of its beginning.
async function endOfList(frame: Frame, of: cluster.ListOf, beginning: string[]): Promise<void> {
  await cluster.scrollList(frame, 1_000_000, of);
  const deadline = Date.now() + 60_000;
  let rows = await cluster.mounted(frame, of);

  while ((rows.length === 0 || rows.some((name) => beginning.includes(name))) && Date.now() < deadline) {
    await frame.waitForTimeout(100);
    rows = await cluster.mounted(frame, of);
  }
  expect(rows.length).toBeGreaterThan(0);
  expect(rows.filter((name) => beginning.includes(name))).toEqual([]);
  expect((await cluster.listState(frame, of)).scroll).toBeGreaterThan(1000);
}

describe("long list of backups", () => {
  let started: velero.StartedApplication;
  let frame: Frame;
  let before: cluster.ClusterSnapshot;

  beforeAll(async () => {
    if (!cluster.fixturesReady()) {
      throw new Error(cluster.fixturesMissing());
    }
    before = cluster.clusterSnapshot();
    let kubeconfig = "";

    // The kubeconfig is in the profile before the install is asked, for each start of the application.
    started = await velero.startWithExtension(async () => {
      kubeconfig = await cluster.publishKubeconfig();
    });
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
      expect(await cluster.search(frame, "backup-1000")).toEqual(["backup-1000"]);
      await cluster.expectCells(cluster.BACKUPS, frame, "backup-1000", { storage: "scale-location-1" });
      await cluster.search(frame, "");
      await frame.waitForSelector(`[data-testid=velero-backups] >> text="${BACKUPS} items"`, { timeout: 60_000 });
      await endOfList(frame, cluster.BACKUPS, mounted);
      expect((await cluster.mountedBackups(frame)).length).toBeLessThanOrEqual(MOUNTED);
      await cluster.scrollList(frame, 0);
      // The storage locations these backups name are in no list: the reference says so.
      const first = (await cluster.mountedBackups(frame))[0];
      const location = (await cluster.cellsOf(cluster.BACKUPS, frame, first)).storage;

      expect(location).toMatch(/^scale-location-[123]$/);
      await cluster.openWorkspace(frame, first);
      expect(
        (await cluster.reference(frame, `velero-reference-BackupStorageLocation-${location}`, "absent")).state,
      ).toBe("absent");
      await cluster.closeWorkspace(frame);
      await cluster.captureScreenshot(frame, "dark-backups-thousand");
    },
    TIMEOUT,
  );

  it(
    "answers a search and a selection within the budget, twenty times over",
    async () => {
      const { objects, ...measured } = await measureList(frame, cluster.BACKUPS, SEARCHES);
      const report = { backups: objects, ...measured };
      const { mounted } = report;

      console.log(`BACK-12 ${JSON.stringify(report)}`);
      await cluster.writeReport("back-12-list-performance", report);
      expectMeasured(report, objects);
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

      // The edge was dragged to the right: the column is wider. The columns that hold their words whole
      // do not give all the room that was asked of them.
      expect(resized.after - resized.before).toBeGreaterThan(30);
      await cluster.scrollList(frame, 1500);
      const state = await cluster.listState(frame);

      expect(state.search).toBe("scale-location-3");
      expect(state.scroll).toBeGreaterThan(1000);
      expect(state.sorted).toMatch(/^started /);
      // The order is the one of the start, as the rows are: each backup started after the one before
      // it, and the ones that are shown here are the latest first.
      expectLatestFirst(await cluster.visibleBackups(frame));
      // A row the operator sees: one that is mounted above or below what is shown is not one to click.
      const name = (await cluster.visibleBackups(frame))[3];

      expect(name).toBeDefined();
      await cluster.openWorkspace(frame, name);
      await cluster.captureScreenshot(frame, "dark-backup-from-filtered-list");
      await cluster.closeWorkspace(frame);
      const back = await cluster.listStateLike(frame, state);

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
    "shows all the restores of the namespace, and mounts a part of them",
    async () => {
      await cluster.showList(frame);
      await cluster.search(frame, "");
      await cluster.openPage(frame, cluster.RESTORES);
      await cluster.waitForList(frame, cluster.RESTORES);
      expect((await cluster.target(frame)).namespace).toBe(`${cluster.E2E_SCALE_NAMESPACE} (configured)`);
      await frame.waitForSelector(`[data-testid=velero-restores] >> text="${BACKUPS} items"`, { timeout: 60_000 });
      const mounted = await cluster.mounted(frame, cluster.RESTORES);

      expect(mounted.length).toBeGreaterThan(0);
      expect(mounted.length).toBeLessThanOrEqual(MOUNTED);
      // No record is hidden: the last one is found by the search, with the backup it names.
      expect(await cluster.search(frame, "restore-1000", cluster.RESTORES)).toEqual(["restore-1000"]);
      await cluster.expectCells(cluster.RESTORES, frame, "restore-1000", { source: "backup-1000" });
      await cluster.search(frame, "", cluster.RESTORES);
      await frame.waitForSelector(`[data-testid=velero-restores] >> text="${BACKUPS} items"`, { timeout: 60_000 });
      await endOfList(frame, cluster.RESTORES, mounted);
      expect((await cluster.mounted(frame, cluster.RESTORES)).length).toBeLessThanOrEqual(MOUNTED);
      await cluster.scrollList(frame, 0, cluster.RESTORES);
      await cluster.captureScreenshot(frame, "dark-restores-thousand");
    },
    TIMEOUT,
  );

  it(
    "answers a search and a selection of the restores within the budget, twenty times over",
    async () => {
      const { objects, ...measured } = await measureList(frame, cluster.RESTORES, RESTORE_SEARCHES);
      const report = { restores: objects, ...measured };

      console.log(`REST-11 ${JSON.stringify(report)}`);
      await cluster.writeReport("rest-11-list-performance", report);
      expectMeasured(report, objects);
      expect(report.mounted).toBeGreaterThan(0);
      expect(report.mounted).toBeLessThanOrEqual(MOUNTED);
      expect(report.response.p95).toBeLessThan(BUDGET);
    },
    TIMEOUT,
  );

  it(
    "keeps the search, the order and the scroll of the restores when one is opened and closed",
    async () => {
      await cluster.search(frame, "backup-00", cluster.RESTORES);
      await frame.click("[data-testid=velero-restores] .TableHead .TableCell.started");
      await frame.click("[data-testid=velero-restores] .TableHead .TableCell.started");
      await cluster.scrollList(frame, 1500, cluster.RESTORES);
      const state = await cluster.listState(frame, cluster.RESTORES);

      expect(state.search).toBe("backup-00");
      expect(state.scroll).toBeGreaterThan(1000);
      expect(state.sorted).toMatch(/^started /);
      expectLatestFirst(await cluster.visibleRowsOf(frame, cluster.RESTORES));
      const name = (await cluster.visibleRowsOf(frame, cluster.RESTORES))[3];

      expect(name).toBeDefined();
      await cluster.openWorkspace(frame, name, cluster.RESTORES);
      // From the restore to its backup, which is one of the thousand, and back: the list is where it was.
      const backup = (await frame.locator("[data-testid^=velero-open-backup-]").innerText()).trim();

      await cluster.followTo(frame, "backup", backup);
      await cluster.closeWorkspace(frame);
      await cluster.closeWorkspace(frame);
      const back = await cluster.listStateLike(frame, state, cluster.RESTORES);

      expect(back.search).toBe(state.search);
      expect(back.sorted).toBe(state.sorted);
      expect(back.items).toBe(state.items);
      expect(Math.abs(back.scroll - state.scroll)).toBeLessThanOrEqual(2);
      expect(back.first).toBe(state.first);
      await cluster.captureScreenshot(frame, "dark-restores-thousand-filtered-after-back");
    },
    TIMEOUT,
  );

  it(
    "shows all the two thousand pod volume backups of the namespace, and mounts a part of them",
    async () => {
      const of = cluster.POD_VOLUME_BACKUPS;

      await cluster.showList(frame);
      await cluster.openPage(frame, of);
      await cluster.waitForList(frame, of);
      expect((await cluster.target(frame)).namespace).toBe(`${cluster.E2E_SCALE_NAMESPACE} (configured)`);
      await frame.waitForSelector(`[data-testid=velero-pod-volume-backups] >> text="${POD_VOLUME_BACKUPS} items"`, {
        timeout: 60_000,
      });
      const mounted = await cluster.mounted(frame, of);

      expect(mounted.length).toBeGreaterThan(0);
      expect(mounted.length).toBeLessThanOrEqual(MOUNTED);
      // No record is hidden: the search finds the operations of the thousandth backup, and only them, a part of them
      // mounted.
      const found = await cluster.search(frame, "backup-1000", of);

      expect(found.length).toBeGreaterThan(0);
      expect(found.length).toBeLessThanOrEqual(MOUNTED);
      expect(found.filter((name) => !name.startsWith("backup-1000-"))).toEqual([]);
      await cluster.search(frame, "", of);
      await frame.waitForSelector(`[data-testid=velero-pod-volume-backups] >> text="${POD_VOLUME_BACKUPS} items"`, {
        timeout: 60_000,
      });
      await endOfList(frame, of, mounted);
      expect((await cluster.mounted(frame, of)).length).toBeLessThanOrEqual(MOUNTED);
      await cluster.scrollList(frame, 0, of);
      await cluster.captureScreenshot(frame, "dark-pod-volume-backups-two-thousand");
    },
    TIMEOUT,
  );

  it(
    "answers a search and a selection of the pod volume backups within the budget, twenty times over",
    async () => {
      const { objects, ...measured } = await measureList(frame, cluster.POD_VOLUME_BACKUPS, POD_VOLUME_BACKUP_SEARCHES);
      const report = { podVolumeBackups: objects, ...measured };

      // The report is written before anything is asserted of it: a case that fails leaves what was measured.
      console.log(`KIND-18 ${JSON.stringify(report)}`);
      await cluster.writeReport("kind-18-volumes-performance", report);
      expect(objects).toBe(POD_VOLUME_BACKUPS);
      expect(report.interactions).toBe(20);
      expect(new Set(report.times.map((time) => time.interaction)).size).toBe(20);
      expect(report.times.filter((time) => !(time.total > 0) || time.response > time.total)).toEqual([]);
      expect(report.mounted).toBeGreaterThan(0);
      expect(report.mounted).toBeLessThanOrEqual(MOUNTED);
      expect(report.response.p95).toBeLessThan(BUDGET);
    },
    TIMEOUT,
  );

  it(
    "counts on the API server a list of the pods and one of the Jobs of a namespace, which the cases after it count none of",
    async () => {
      // The control of the counters the cases of KIND-14 read: a list of each kind in a namespace, made by `kubectl`
      // between two readings, is counted as a read in a namespace, as a read of the views would be. A count of none
      // after it is one the counters could have seen.
      const before = cluster.workloadRequests();

      for (const kind of ["pods", "jobs"]) {
        expect([kind, cluster.kubectlE2E("get", kind, "--namespace", "kube-system", "-o", "name").status]).toEqual([
          kind,
          0,
        ]);
      }
      const read = cluster.workloadReads(cluster.counted(before, cluster.workloadRequests()));

      expect(read["LIST pods namespace"] ?? 0).toBeGreaterThanOrEqual(1);
      expect(read["LIST jobs namespace"] ?? 0).toBeGreaterThanOrEqual(1);
    },
    TIMEOUT,
  );

  it(
    "reads the two thousand pod volume backups once at each read while their list is open, and not while the Overview is",
    async () => {
      // The requests the API server counted while the views read the installation `reads` times, from the end of a
      // read to the end of the last: what the page that is shown asks at each read. On the CRDs alone no controller
      // lists the two families, so what is counted is what the views asked.
      const askedOver = async (reads: number) => {
        await cluster.afterRead(frame);
        const first = cluster.apiRequests();
        const firstOfTheWorkloads = cluster.workloadRequests();

        for (let read = 0; read < reads; read += 1) await cluster.afterRead(frame);
        return {
          ...cluster.counted(first, cluster.apiRequests()),
          ...cluster.workloadReads(cluster.counted(firstOfTheWorkloads, cluster.workloadRequests())),
        };
      };
      // What was read of a pod or of a Job in a namespace or by name: on the CRDs alone no server, node agent or
      // maintenance Job runs, so what is counted there is what the views asked (SPEC-0014, REQ-190, KIND-14).
      const workloads = (counts: Record<string, number>) =>
        Object.fromEntries(Object.entries(counts).filter(([key]) => / (pods|jobs) /.test(key)));

      await cluster.showList(frame);
      await cluster.waitForList(frame, cluster.POD_VOLUME_BACKUPS);
      const shown = await askedOver(CYCLES);

      await cluster.openPage(frame, cluster.OVERVIEW);
      await cluster.overview(frame);
      // A read that was asked before the page was left may have asked them still: the window begins after it.
      await cluster.afterRead(frame);
      const overview = await askedOver(CYCLES);
      const report = { cycles: CYCLES, podVolumeBackupsShown: shown, overviewShown: overview };

      // The report is written before anything is asserted of it: a case that fails leaves what was counted.
      console.log(`KIND-18 ${JSON.stringify(report)}`);
      await cluster.writeReport("kind-18-reads-of-the-pod-volume-operations", report);
      // One list of the two thousand at each read, however many they are, with a bound of one more for a read that
      // ends at the edge of the window; none of the pod volume restores, which no view that is open shows.
      expect(shown[PVB] ?? 0).toBeGreaterThanOrEqual(CYCLES);
      expect(shown[PVB] ?? 0).toBeLessThanOrEqual(CYCLES + 1);
      expect(shown[PVR] ?? 0).toBe(0);
      // The Overview reads none of the families of the operations.
      expect([overview[PVB] ?? 0, overview[PVR] ?? 0]).toEqual([0, 0]);
      // And neither the list of the operations nor the Overview reads a pod or a Job.
      expect([workloads(shown), workloads(overview)]).toEqual([{}, {}]);
    },
    TIMEOUT,
  );

  it(
    "opens the view of the backup of two hundred operations within the budget, twenty times over",
    async () => {
      await cluster.openPage(frame, cluster.BACKUPS);
      await cluster.waitForBackups(frame);
      expect(await cluster.search(frame, BUSIEST)).toEqual([BUSIEST]);
      const workloadsBefore = cluster.workloadRequests();
      // The first time the view asks the family of the operations, which the band waits for.
      await cluster.openWorkspace(frame, BUSIEST);
      const band = await cluster.volumeBand(frame, "rows");

      expect(band.kind).toBe("PodVolumeBackup");
      expect(band.count).toBe(`${OPERATIONS_OF_THE_BUSIEST} pod volume backups, from the newest`);
      expect(band.rows).toHaveLength(10);
      expect(band.more).toBe(true);
      const times: number[] = [];
      const listsBefore = cluster.apiRequests();
      const began = Date.now();

      // Each time: a read with the view open, which keeps the family read; then the view is closed and opened again
      // before the next read, so that what is measured is the view and its band built from what was read.
      for (let index = 0; index < 22; index += 1) {
        await cluster.readAgain(frame);
        await cluster.closeWorkspace(frame);
        const measured = await cluster.measureOpenWithBand(frame, BUSIEST);

        // The first two warm what the ones after find loaded.
        if (index >= 2) times.push(measured.response);
      }
      // The family was read at each read and at no opening: one list of the pod volume backups for each of the
      // twenty-two reads asked, and for each read of the views every fifteen seconds that fell in the loop, with one
      // more for a read at its edge. An opening that asked the family again would add twenty-two.
      const lists = cluster.counted(listsBefore, cluster.apiRequests())[PVB] ?? 0;
      const periodic = Math.ceil((Date.now() - began) / 15_000);
      const report = {
        operations: OPERATIONS_OF_THE_BUSIEST,
        interactions: times.length,
        budget: BUDGET,
        response: {
          p95: Math.round(percentile(times, 0.95)),
          median: Math.round(percentile(times, 0.5)),
          slowest: Math.round(Math.max(...times)),
        },
        times: times.map(Math.round),
      };

      console.log(`KIND-18 ${JSON.stringify({ ...report, lists, periodic })}`);
      await cluster.writeReport("kind-18-busiest-backup-performance", { ...report, lists, periodic });
      await cluster.closeWorkspace(frame);
      await cluster.search(frame, "");
      expect(report.interactions).toBe(20);
      expect(times.filter((time) => !(time > 0))).toEqual([]);
      expect(report.response.p95).toBeLessThan(BUDGET);
      expect(lists).toBeGreaterThanOrEqual(22);
      expect(lists).toBeLessThanOrEqual(22 + periodic + 1);
      // The view and its band read nothing of a pod or of a Job, twenty-two times opened (KIND-14).
      expect(cluster.workloadReads(cluster.counted(workloadsBefore, cluster.workloadRequests()))).toEqual({});
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
