/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

// The data uploads and the data downloads, in a packaged Freelens, on the CRDs of the release alone: the namespace of
// the views holds the synthetic data movement its fixtures place, whose status the fixtures write and no node agent
// reads (SPEC-0014, REQ-195). The suite proves their lists against what the cluster holds of each, the view of each
// phase, the second half of the band of a backup and of a restore, the way from a download to the upload of its
// snapshot and back, the details of the host and their way to the view, the reads of the two families, and no way to
// write. It reads the application and the cluster, and writes to neither.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as cluster from "../../integration/helpers/velero-cluster";
import * as velero from "../../integration/helpers/velero-extension";
import * as volumes from "../../integration/helpers/velero-volumes";

import type { Frame } from "playwright";

const TIMEOUT = 10 * 60 * 1000;
const BACKUP = "backup-inprogress";
const RESTORE = "restore-mapped";
const DU = "LIST datauploads namespace";
const DD = "LIST datadownloads namespace";
const PVB = "LIST podvolumebackups namespace";
const PVR = "LIST podvolumerestores namespace";
// How many reads of the installation each window of the reads waits for: one every fifteen seconds.
const CYCLES = 3;
const REPORT = "kind-02-reads-of-the-data-movement";

/** A data upload or a data download as the cluster holds it, with what the suite reads of it. */
interface Movement {
  metadata: { name: string; labels?: Record<string, string> };
  spec?: {
    sourcePVC?: string;
    sourceNamespace?: string;
    datamover?: string;
    snapshotID?: string;
    targetVolume?: { pvc?: string; namespace?: string };
  };
  status?: { phase?: string; node?: string; acceptedByNode?: string; snapshotID?: string; message?: string };
}

// The label of each phase, as the views write it.
const PHASE_LABELS: Record<string, string> = {
  "": "No phase yet",
  New: "New",
  Accepted: "Accepted",
  Prepared: "Prepared",
  InProgress: "In progress",
  Canceling: "Canceling",
  Completed: "Completed",
  Failed: "Failed",
  Canceled: "Canceled",
};

describe("views of the data uploads and of the data downloads", () => {
  let started: velero.StartedApplication;
  let frame: Frame;
  const errors = velero.createErrorCollector();
  let before: cluster.ClusterSnapshot;
  let counted: Record<string, number>;
  const report: Record<string, unknown> = { cycles: CYCLES };
  const held = (resource: "datauploads" | "datadownloads", owner: string) =>
    cluster
      .labelledObjects<Movement>(resource, owner, cluster.E2E_VIEWS_NAMESPACE)
      .sort((one, other) => one.metadata.name.localeCompare(other.metadata.name));
  const uploads = () => held("datauploads", "velero.io/backup-name");
  const downloads = () => held("datadownloads", "velero.io/restore-name");
  const askedOver = async (reads: number) => {
    await cluster.afterRead(frame);
    const first = cluster.apiRequests();

    for (let read = 0; read < reads; read += 1) await cluster.afterRead(frame);
    return cluster.counted(first, cluster.apiRequests());
  };
  const half = (kind: string) => `[data-testid=velero-volume-band] [data-testid=velero-volume-half][data-kind=${kind}]`;

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
    "lists the data uploads and the data downloads of the views, each with what the cluster holds of it",
    async () => {
      for (const [of, items, source] of [
        [
          cluster.DATA_UPLOADS,
          uploads(),
          (item: Movement) => `${item.spec?.sourceNamespace}/${item.spec?.sourcePVC}`,
        ],
        [
          cluster.DATA_DOWNLOADS,
          downloads(),
          (item: Movement) => `${item.spec?.targetVolume?.namespace}/${item.spec?.targetVolume?.pvc}`,
        ],
      ] as const) {
        expect([of.id, items.length > 0]).toEqual([of.id, true]);
        await cluster.openPage(frame, of);
        await cluster.selectInstallation(frame, cluster.E2E_VIEWS_NAMESPACE);
        await cluster.waitForList(frame, of);
        expect([of.id, [...(await cluster.mounted(frame, of))].sort()]).toEqual([
          of.id,
          items.map(({ metadata }) => metadata.name).sort(),
        ]);
        for (const item of items) {
          const owner = item.metadata.labels?.[of === cluster.DATA_UPLOADS ? "velero.io/backup-name" : "velero.io/restore-name"];
          const mover = item.spec?.datamover;

          await cluster.expectCells(of, frame, item.metadata.name, {
            phase: PHASE_LABELS[item.status?.phase ?? ""],
            operation: String(owner),
            volume: source(item),
            node: item.status?.node ?? "Not reported",
            // Not set is the built-in data mover, `velero` is shown as written, another is marked as not known.
            uploader: !mover ? "Built-in" : mover === "velero" ? mover : `${mover}, ${volumes.NOT_WRITTEN_MARK}`,
          });
        }
        expect([of.id, await cluster.notices(frame, [])]).toEqual([of.id, {}]);
        expect([of.id, await cluster.layoutProblems(frame, of)]).toEqual([of.id, []]);
        await cluster.captureScreenshot(frame, `dark-${of.id}`);
      }
    },
    TIMEOUT,
  );

  it(
    "says in the view of a data upload of each phase what the phase means, as the release writes it",
    async () => {
      const ofEach = new Map<string, string>();

      for (const { metadata, status } of uploads().filter(
        ({ metadata }) => metadata.labels?.["velero.io/backup-name"] === BACKUP,
      )) {
        if (!ofEach.has(status?.phase || "New")) ofEach.set(status?.phase || "New", metadata.name);
      }
      expect([...ofEach.keys()].sort()).toEqual(Object.keys(volumes.DATA_UPLOAD_PHASE_SENTENCES).sort());
      await cluster.openPage(frame, cluster.DATA_UPLOADS);
      await cluster.waitForList(frame, cluster.DATA_UPLOADS);
      for (const [phase, name] of ofEach) {
        await cluster.openWorkspace(frame, name, cluster.DATA_UPLOADS);
        const view = frame.locator("[data-testid=velero-data-upload-workspace]");
        const status = view.locator("[data-testid=velero-data-upload-status]");

        expect([phase, await volumes.factOf(status, "Phase")]).toEqual([
          phase,
          expect.stringContaining(volumes.DATA_UPLOAD_PHASE_SENTENCES[phase]),
        ]);
        await cluster.closeWorkspace(frame);
      }
    },
    TIMEOUT,
  );

  it(
    "counts the data uploads of the backup in progress in the second half of its band, ten and ten more, each a way and back",
    async () => {
      const own = uploads().filter(({ metadata }) => metadata.labels?.["velero.io/backup-name"] === BACKUP);

      await cluster.openPage(frame, cluster.BACKUPS);
      await cluster.selectInstallation(frame, cluster.E2E_VIEWS_NAMESPACE);
      await cluster.waitForList(frame, cluster.BACKUPS);
      await cluster.openWorkspace(frame, BACKUP, cluster.BACKUPS);
      const band = await cluster.volumeBand(frame, "rows", "DataUpload");

      expect(band.kind).toBe("DataUpload");
      expect(band.count).toBe(`${own.length} data uploads, from the newest`);
      expect(band.groups.reduce((sum, [, count]) => sum + count, 0)).toBe(own.length);
      expect(band.rows).toHaveLength(10);
      expect(band.more).toBe(true);
      // The first half is the pod volume backups of the backup, beside it.
      expect((await cluster.volumeBand(frame, "rows")).kind).toBe("PodVolumeBackup");
      await frame.locator(`${half("DataUpload")} [data-testid=velero-volume-more]`).click();
      await frame.waitForFunction(
        ({ selector, count }) => document.querySelectorAll(`${selector} [data-testid=velero-volume-rows] tbody tr`).length === count,
        { selector: half("DataUpload"), count: own.length },
        { timeout: 60_000 },
      );
      const [first] = band.rows;

      await frame.locator(`${half("DataUpload")} [data-testid="velero-open-data-upload-${first}"]`).click();
      await frame.waitForSelector("[data-testid=velero-data-upload-workspace]", { timeout: 60_000 });
      expect((await cluster.shownView(frame))?.name).toBe(first);
      await cluster.closeWorkspace(frame);
      expect((await cluster.shownView(frame))?.name).toBe(BACKUP);
      await cluster.captureScreenshot(frame, "dark-backup-band-of-the-data-movement");
      await cluster.closeWorkspace(frame);
      expect(await cluster.shownView(frame)).toBeUndefined();
    },
    TIMEOUT,
  );

  it(
    "leads from the data download of the mapped restore that completed to the data upload of its snapshot, and back",
    async () => {
      const own = downloads().filter(({ metadata }) => metadata.labels?.["velero.io/restore-name"] === RESTORE);
      const completed = own.find(({ status }) => status?.phase === "Completed");
      const upload = uploads().find(({ status }) => status?.snapshotID === completed?.spec?.snapshotID);

      expect([Boolean(completed), Boolean(upload)]).toEqual([true, true]);
      await cluster.openPage(frame, cluster.RESTORES);
      await cluster.selectInstallation(frame, cluster.E2E_VIEWS_NAMESPACE);
      await cluster.waitForList(frame, cluster.RESTORES);
      await cluster.openWorkspace(frame, RESTORE, cluster.RESTORES);
      const band = await cluster.volumeBand(frame, "rows", "DataDownload");

      expect(band.count).toBe(`${own.length} data downloads, from the newest`);
      await frame
        .locator(`${half("DataDownload")} [data-testid="velero-open-data-download-${completed?.metadata.name}"]`)
        .click();
      const view = frame.locator("[data-testid=velero-data-download-workspace]");

      await view.waitFor({ state: "visible", timeout: 60_000 });
      const of = view.locator("[data-testid=velero-volume-of]");

      expect(await volumes.factOf(of, "Snapshot ID")).toBe(completed?.spec?.snapshotID);
      expect(await volumes.factOf(of, "Data upload")).toBe(upload?.metadata.name);
      await view.locator(`[data-testid="velero-open-data-upload-${upload?.metadata.name}"]`).click();
      await frame.waitForSelector("[data-testid=velero-data-upload-workspace]", { timeout: 60_000 });
      expect((await cluster.shownView(frame))?.name).toBe(upload?.metadata.name);
      await cluster.closeWorkspace(frame);
      expect((await cluster.shownView(frame))?.name).toBe(completed?.metadata.name);
      // The download whose snapshot no upload names says nothing of one.
      const lost = own.find(({ spec }) => !uploads().some(({ status }) => status?.snapshotID === spec?.snapshotID));

      expect(Boolean(lost)).toBe(true);
      await cluster.closeWorkspace(frame);
      await frame
        .locator(`${half("DataDownload")} [data-testid="velero-open-data-download-${lost?.metadata.name}"]`)
        .click();
      await frame.waitForSelector("[data-testid=velero-data-download-workspace]", { timeout: 60_000 });
      expect(
        await frame.locator("[data-testid=velero-data-download-workspace] [data-testid=velero-volume-of]").innerText(),
      ).not.toContain("Data upload");
      await cluster.closeWorkspace(frame);
      await cluster.closeWorkspace(frame);
      expect(await cluster.shownView(frame)).toBeUndefined();
    },
    TIMEOUT,
  );

  it(
    "marks the data mover the release does not run as not known, and says what a data movement New waits for",
    async () => {
      const own = uploads().find(({ spec }) => spec?.datamover === "views-mover");

      expect(Boolean(own)).toBe(true);
      await cluster.openPage(frame, cluster.DATA_UPLOADS);
      await cluster.waitForList(frame, cluster.DATA_UPLOADS);
      await cluster.openWorkspace(frame, String(own?.metadata.name), cluster.DATA_UPLOADS);
      const view = frame.locator("[data-testid=velero-data-upload-workspace]");

      expect(await volumes.factOf(view.locator("[data-testid=velero-volume-settings]"), "Data mover")).toContain(
        "views-mover",
      );
      expect(await view.locator("[data-testid=velero-volume-settings] [data-written=unknown]").count()).toBe(1);
      expect(await volumes.factOf(view.locator("[data-testid=velero-data-upload-status]"), "Phase")).toContain(
        volumes.DATA_UPLOAD_PHASE_SENTENCES.New,
      );
      await cluster.closeWorkspace(frame);
    },
    TIMEOUT,
  );

  it(
    "gives the details of the host of a data upload and of a data download the reading of their views, and a way to each",
    async () => {
      const [upload] = uploads().filter(({ status }) => status?.phase === "InProgress");
      const [download] = downloads().filter(({ status }) => status?.phase === "Completed");

      for (const [resource, kind, name, texts] of [
        ["datauploads", "data-upload", upload.metadata.name, ["In progress", BACKUP]],
        ["datadownloads", "data-download", download.metadata.name, ["Completed", RESTORE]],
      ] as const) {
        await cluster.navigate(frame, `/crd/velero.io/${resource}`);
        await cluster.selectHostNamespace(frame, cluster.E2E_VIEWS_NAMESPACE);
        const details = await cluster.hostDetails(frame, name, ...texts, cluster.E2E_VIEWS_NAMESPACE);
        const link = frame.locator(`[data-testid=velero-${kind}-details-link]`);

        expect([kind, details.includes("Velero")]).toEqual([kind, true]);
        expect([kind, await link.count()]).toEqual([kind, 1]);
        await cluster.captureScreenshot(frame, `dark-${kind}-host-details`);
        await link.click();
        await frame.waitForSelector(`[data-testid=velero-${kind}-workspace]`, { timeout: 60_000 });
        expect([kind, (await cluster.shownView(frame))?.name]).toEqual([kind, name]);
        expect([kind, await cluster.hostDetailsGone(frame)]).toEqual([kind, { drawer: false, address: false }]);
        await cluster.closeWorkspace(frame);
      }
    },
    TIMEOUT,
  );

  it(
    "reads the data uploads while their list or a backup is shown and the data downloads while their list or a restore is, once at each read, and neither with the Overview",
    async () => {
      const windows: Record<string, Record<string, number>> = {};

      await cluster.openPage(frame, cluster.DATA_UPLOADS);
      await cluster.waitForList(frame, cluster.DATA_UPLOADS);
      windows.uploads = await askedOver(CYCLES);
      await cluster.openPage(frame, cluster.DATA_DOWNLOADS);
      await cluster.waitForList(frame, cluster.DATA_DOWNLOADS);
      windows.downloads = await askedOver(CYCLES);
      await cluster.openPage(frame, cluster.OVERVIEW);
      await cluster.overview(frame);
      await cluster.afterRead(frame);
      windows.overview = await askedOver(CYCLES);
      await cluster.openPage(frame, cluster.BACKUPS);
      await cluster.waitForList(frame, cluster.BACKUPS);
      await cluster.openWorkspace(frame, BACKUP, cluster.BACKUPS);
      await cluster.volumeBand(frame, "rows", "DataUpload");
      windows.backup = await askedOver(CYCLES);
      await cluster.closeWorkspace(frame);
      report.windows = windows;
      await cluster.writeReport(REPORT, report);
      const within = (count: number | undefined) => (count ?? 0) >= CYCLES && (count ?? 0) <= CYCLES + 1;

      expect([within(windows.uploads[DU]), windows.uploads[DD] ?? 0]).toEqual([true, 0]);
      expect([within(windows.downloads[DD]), windows.downloads[DU] ?? 0]).toEqual([true, 0]);
      expect([windows.overview[DU] ?? 0, windows.overview[DD] ?? 0, windows.overview[PVB] ?? 0, windows.overview[PVR] ?? 0]).toEqual([
        0, 0, 0, 0,
      ]);
      expect([within(windows.backup[DU]), within(windows.backup[PVB]), windows.backup[DD] ?? 0]).toEqual([
        true,
        true,
        0,
      ]);
    },
    TIMEOUT,
  );

  it(
    "offers no way to select, edit, cancel or delete a data upload or a data download, by pointer or by keyboard",
    async () => {
      const appears = (selector: string) =>
        frame.waitForSelector(selector, { state: "visible", timeout: 1500 }).then(
          () => true,
          () => false,
        );

      for (const of of [cluster.DATA_UPLOADS, cluster.DATA_DOWNLOADS]) {
        const list = frame.locator(`[data-testid=velero-${of.id}]`);

        await cluster.showList(frame);
        await cluster.openPage(frame, of);
        await cluster.selectInstallation(frame, cluster.E2E_VIEWS_NAMESPACE);
        await cluster.waitForList(frame, of);
        const [name] = await cluster.mounted(frame, of);

        expect([of.id, await list.locator(".TableCell.checkbox, .Checkbox, input[type=checkbox]").count()]).toEqual([
          of.id,
          0,
        ]);
        expect([of.id, await list.locator(".TableCell.menu .Icon, .MenuActions").count()]).toEqual([of.id, 0]);
        await frame.locator(`[data-${of.kind}-row="${name}"]`).click({ button: "right" });
        expect([of.id, await appears(".Menu .MenuItem")]).toEqual([of.id, false]);
        await cluster.showList(frame);
        await frame.locator(`[data-${of.kind}-row="${name}"]`).focus();
        for (const key of ["Delete", "Backspace", "Control+a", "Meta+Backspace"]) {
          await started.window.keyboard.press(key);
          expect([of.id, key, await appears('[data-testid="confirmation-dialog"], .Dialog, .ConfirmDialog')]).toEqual([
            of.id,
            key,
            false,
          ]);
        }
        await cluster.openWorkspace(frame, name, of);
        const workspace = frame.locator(`[data-testid=velero-${of.kind}-workspace]`);
        const buttons = await workspace
          .locator("button")
          .evaluateAll((found) => found.map((button) => button.getAttribute("data-testid") ?? button.textContent ?? ""));

        expect([of.id, buttons.filter((id) => !/^velero-(back|open-)/.test(id))]).toEqual([of.id, []]);
        expect([of.id, await workspace.locator("input, select, textarea").count()]).toEqual([of.id, 0]);
        await cluster.closeWorkspace(frame);
      }
    },
    TIMEOUT,
  );

  it(
    "leaves the objects of Velero as they were, writes nothing, and asks Velero for nothing",
    async () => {
      const after = cluster.clusterSnapshot();

      expect(after.versions).toEqual(before.versions);
      expect(after.installed).toEqual(before.installed);
      expect(after.requests).toBe(0);
      expect(cluster.writes(counted, cluster.apiRequests())).toEqual({});
    },
    TIMEOUT,
  );
});
