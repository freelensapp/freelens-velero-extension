/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

// The backup repositories, the pod volume backups and the pod volume restores, in a packaged Freelens, against
// the test environment as its fixtures leave it: the namespace of the views holds the pod volume operations and the
// repositories of its fixtures, the one of the defaults none of the three kinds, and the installation what the
// volume of the run made there, one repository Ready, one pod volume backup and one pod volume restore; its cases
// read the repository, and the two operations are probed by `fixturesReady`, which calls them missing. The suite
// proves the lists of the three kinds with what they say of a namespace that holds none, the repository of the
// installation as the cluster holds it, and the reads of the pod volume operations, which the views ask only while
// a view that shows them is open, counted on the API server: their lists, and the view of a backup and of a
// restore, whose band shows the operations of its own kind. The suite reads the application and the cluster, and
// writes to neither.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as cluster from "../../integration/helpers/velero-cluster";
import * as velero from "../../integration/helpers/velero-extension";
import * as volumes from "../../integration/helpers/velero-volumes";

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
// The report of the windows of the reads, with what was counted while each page was shown.
const REPORT = "kind-02-reads-of-the-pod-volume-operations";
// A backup and a restore of the installation of the views, whose views show the band of their volume operations.
const BACKUP = "views-daily-20260901030000";
const RESTORE = "restore-mapped";

describe("views of the backup repositories and of the pod volume operations", () => {
  let started: velero.StartedApplication;
  let frame: Frame;
  const errors = velero.createErrorCollector();
  let before: cluster.ClusterSnapshot;
  let counted: Record<string, number>;
  // The report is written after each window and before what is expected of it, so that a case that fails leaves
  // the counts that tell why.
  const report: Record<string, unknown> = { cycles: CYCLES };
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
    "lists none of the three kinds in the installation of the defaults, and says of each list of what it is",
    async () => {
      for (const [of, noun] of LISTS) {
        await cluster.openPage(frame, of);
        if (of === cluster.REPOSITORIES) await cluster.selectInstallation(frame, cluster.E2E_DEFAULTS_NAMESPACE);
        await frame.waitForSelector(`[data-testid=velero-${of.id}-empty]`, { timeout: 60_000 });
        expect([of.id, await empty(of)]).toEqual([
          of.id,
          `No ${noun} is in the namespace ${cluster.E2E_DEFAULTS_NAMESPACE} of ${cluster.E2E_KUBE_CONTEXT}.`,
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
    "lists in the installation the one backup repository the volume of the run made, Ready, as the cluster holds it",
    async () => {
      // The repository the server made for the volume of the run, read by the suite on the cluster by the three
      // labels the release writes into it, never by its name, which the release says it may change.
      const made = cluster.labelledObjects<{ metadata: { name: string }; status?: { phase?: string } }>(
        "backuprepositories",
        cluster.runRepositorySelector(),
      );

      expect(made.map((repository) => repository.status?.phase)).toEqual(["Ready"]);
      // It is the one repository of the installation, read by the suite and not by the application.
      const held = cluster.kubectlE2E(
        "get",
        "backuprepositories.velero.io",
        "--namespace",
        cluster.E2E_NAMESPACE,
        "-o",
        "name",
      );

      expect([held.status, held.stdout.trim()]).toEqual([0, `backuprepository.velero.io/${made[0].metadata.name}`]);
      await cluster.openPage(frame, cluster.REPOSITORIES);
      await cluster.selectInstallation(frame, cluster.E2E_NAMESPACE);
      await frame.waitForSelector(
        `[data-testid=velero-${cluster.REPOSITORIES.id}] [data-${cluster.REPOSITORIES.kind}-row]`,
        { timeout: 60_000 },
      );
      expect(await cluster.mounted(frame, cluster.REPOSITORIES)).toEqual([made[0].metadata.name]);
      expect(await cluster.notices(frame, [])).toEqual({});
      expect(await cluster.layoutProblems(frame, cluster.REPOSITORIES)).toEqual([]);
      await cluster.selectInstallation(frame, cluster.E2E_VIEWS_NAMESPACE);
    },
    TIMEOUT,
  );

  it(
    "reads the pod volume backups while their list is shown, once at each read, and not while another page is",
    async () => {
      // The installation of the views holds pod volume backups and pod volume restores of its fixtures.
      await cluster.openPage(frame, cluster.POD_VOLUME_BACKUPS);
      await frame.waitForSelector(
        `[data-testid=velero-${cluster.POD_VOLUME_BACKUPS.id}] [data-${cluster.POD_VOLUME_BACKUPS.kind}-row]`,
        { timeout: 60_000 },
      );
      const shown = await askedOver(CYCLES);

      report.podVolumeBackupsShown = shown;
      await cluster.writeReport(REPORT, report);

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
      await frame.waitForSelector(
        `[data-testid=velero-${cluster.POD_VOLUME_RESTORES.id}] [data-${cluster.POD_VOLUME_RESTORES.kind}-row]`,
        { timeout: 60_000 },
      );
      const restores = await askedOver(CYCLES);

      report.podVolumeRestoresShown = restores;
      await cluster.writeReport(REPORT, report);
      expect(restores[PVR] ?? 0).toBeGreaterThanOrEqual(CYCLES);
      expect(restores[PVR] ?? 0).toBeLessThanOrEqual(CYCLES + 1);
      // The page of the pod volume backups was left: its family is not asked at the reads after it.
      expect(restores[PVB] ?? 0).toBe(0);
      for (const of of [cluster.BACKUPS, cluster.OVERVIEW]) {
        await cluster.openPage(frame, of);
        // A read that was asked before the page was left may have asked them still: the window begins after it.
        await cluster.afterRead(frame);
        const elsewhere = await askedOver(CYCLES);

        report[`${of.id}Shown`] = elsewhere;
        await cluster.writeReport(REPORT, report);
        // None of the pod volume operations is listed while these pages are shown, by the views or by anything else
        // of the test environment, whose counters showed none in either window on 2026-10-27.
        expect([of.id, elsewhere[PVB] ?? 0, elsewhere[PVR] ?? 0]).toEqual([of.id, 0, 0]);
        expect([of.id, (elsewhere["LIST backuprepositories namespace"] ?? 0) >= CYCLES]).toEqual([of.id, true]);
      }
    },
    TIMEOUT,
  );

  it(
    "reads the pod volume backups while a backup is open and the pod volume restores while a restore is, once at each read, and not the family of the other",
    async () => {
      // The daily backup holds no operation of its own: its one pod volume backup names in its label the UID of an
      // earlier backup of the same name, and its band says none. The suite reads that pod volume backup on the
      // cluster, by the label of the name, before the windows of the reads begin, so that the band says none of an
      // operation the views placed, not of one that is not there. The mapped restore holds its seven pod volume
      // restores, which its band shows in rows.
      const daily = cluster.veleroObject<{ metadata: { uid?: string } }>(
        "backups",
        BACKUP,
        cluster.E2E_VIEWS_NAMESPACE,
      );
      const ofTheName = cluster.labelledObjects<{ metadata: { labels?: Record<string, string> } }>(
        "podvolumebackups",
        `velero.io/backup-name=${BACKUP}`,
        cluster.E2E_VIEWS_NAMESPACE,
      );

      expect(daily?.metadata.uid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
      expect(
        ofTheName.map(({ metadata }) => {
          const uid = metadata.labels?.["velero.io/backup-uid"];

          return { labelled: uid !== undefined, ofTheBackup: uid === daily?.metadata.uid };
        }),
      ).toEqual([{ labelled: true, ofTheBackup: false }]);
      for (const [of, name, kind, own, other, band] of [
        [cluster.BACKUPS, BACKUP, "backupOpen", PVB, PVR, "none"],
        [cluster.RESTORES, RESTORE, "restoreOpen", PVR, PVB, "rows"],
      ] as const) {
        await cluster.openPage(frame, of);
        await cluster.waitForList(frame, of);
        await cluster.openWorkspace(frame, name, of);
        // The view asks the family of its band at once when it opens, alone: the window begins once the band was
        // answered, and after the read of the installation that follows it ended.
        expect([kind, (await cluster.volumeBand(frame, band)).state]).toEqual([kind, band]);
        const open = await askedOver(CYCLES);

        report[kind] = open;
        await cluster.writeReport(REPORT, report);
        // One list of the family of the band at each read the view waited for, and none of the other family, which
        // no view that is open shows. The counters carry no namespace: what the node agent of the installation asks
        // of the four kinds is counted with the reads of the views, as for the lists above, with the same bound.
        // The run of the pattern on 2026-10-29 saw one list at each read, three of three, with a backup and with a
        // restore open, and none of the other family; the bound stays the one of the lists.
        expect([kind, (open[own] ?? 0) >= CYCLES, (open[own] ?? 0) <= CYCLES + 1]).toEqual([kind, true, true]);
        expect([kind, open[other] ?? 0]).toEqual([kind, 0]);
        await cluster.closeWorkspace(frame);
      }
    },
    TIMEOUT,
  );

  it(
    "says in the view of a pod volume backup of each phase what the phase means, as the release writes it",
    async () => {
      // The pod volume backups of the backup in progress, read by the suite on the cluster, one of each phase: the
      // first of each in the order of their names.
      const owner = cluster.veleroObject<{ metadata: { uid?: string } }>(
        "backups",
        "backup-inprogress",
        cluster.E2E_VIEWS_NAMESPACE,
      );
      const own = cluster
        .labelledObjects<{ metadata: { name: string; labels?: Record<string, string> }; status?: { phase?: string } }>(
          "podvolumebackups",
          "velero.io/backup-name=backup-inprogress",
          cluster.E2E_VIEWS_NAMESPACE,
        )
        .filter(({ metadata }) => metadata.labels?.["velero.io/backup-uid"] === owner?.metadata.uid)
        .sort((one, other) => one.metadata.name.localeCompare(other.metadata.name));
      const ofEach = new Map<string, string>();

      for (const { metadata, status } of own) {
        if (!ofEach.has(status?.phase || "New")) ofEach.set(status?.phase || "New", metadata.name);
      }
      expect([...ofEach.keys()].sort()).toEqual(Object.keys(volumes.BACKUP_PHASE_SENTENCES).sort());
      await cluster.openPage(frame, cluster.BACKUPS);
      await cluster.selectInstallation(frame, cluster.E2E_VIEWS_NAMESPACE);
      await cluster.waitForList(frame, cluster.BACKUPS);
      await cluster.openWorkspace(frame, "backup-inprogress", cluster.BACKUPS);
      for (const [phase, name] of ofEach) {
        const way = frame.locator(`[data-testid="velero-open-pod-volume-backup-${name}"]`);

        await cluster.volumeBand(frame, "rows");
        // The band shows ten rows at first: the command shows the others.
        if (!(await way.count())) await frame.locator("[data-testid=velero-volume-more]").click();
        await way.click();
        const view = frame.locator("[data-testid=velero-pod-volume-backup-workspace]");

        await view.waitFor({ state: "visible", timeout: 60_000 });
        expect([phase, (await view.innerText()).replace(/\s+/g, " ")]).toEqual([
          phase,
          expect.stringContaining(volumes.BACKUP_PHASE_SENTENCES[phase]),
        ]);
        await cluster.closeWorkspace(frame);
      }
      await cluster.closeWorkspace(frame);
    },
    TIMEOUT,
  );

  it(
    "counts the pod volume backups of the backup in progress by their phases, shows ten and ten more, each a way and back",
    async () => {
      // The operations of the backup in progress, read by the suite on the cluster by the label of its name and of
      // its UID, as the release labels them; one with no phase is counted with New, as `velero backup describe`
      // counts it.
      const owner = cluster.veleroObject<{ metadata: { uid?: string } }>(
        "backups",
        "backup-inprogress",
        cluster.E2E_VIEWS_NAMESPACE,
      );
      const own = cluster
        .labelledObjects<{ metadata: { name: string; labels?: Record<string, string> }; status?: { phase?: string } }>(
          "podvolumebackups",
          "velero.io/backup-name=backup-inprogress",
          cluster.E2E_VIEWS_NAMESPACE,
        )
        .filter(({ metadata }) => metadata.labels?.["velero.io/backup-uid"] === owner?.metadata.uid);
      const counts = new Map<string, number>();

      for (const { status } of own) counts.set(status?.phase || "New", (counts.get(status?.phase || "New") ?? 0) + 1);
      expect(own.length).toBeGreaterThan(10);
      expect(own.length).toBeLessThanOrEqual(20);
      await cluster.openPage(frame, cluster.BACKUPS);
      await cluster.selectInstallation(frame, cluster.E2E_VIEWS_NAMESPACE);
      await cluster.waitForList(frame, cluster.BACKUPS);
      await cluster.openWorkspace(frame, "backup-inprogress", cluster.BACKUPS);
      const first = await cluster.volumeBand(frame, "rows");

      expect([...first.groups].sort()).toEqual([...counts.entries()].sort());
      expect(first.rows).toHaveLength(10);
      expect(first.more).toBe(true);
      await frame.locator("[data-testid=velero-volume-more]").click();
      await frame.waitForFunction(
        (shown) => document.querySelectorAll("[data-testid=velero-volume-rows] tbody tr").length === shown,
        own.length,
        { timeout: 60_000 },
      );
      const all = await cluster.volumeBand(frame, "rows");

      expect([...all.rows].sort()).toEqual(own.map(({ metadata }) => metadata.name).sort());
      expect(all.more).toBe(false);
      await cluster.captureScreenshot(frame, "dark-backup-inprogress-band");
      // A row is a way to the view of its operation, and the way back leads to the backup again.
      for (const name of [all.rows[0], all.rows[all.rows.length - 1]]) {
        await frame.locator(`[data-testid="velero-open-pod-volume-backup-${name}"]`).click();
        await frame.waitForSelector("[data-testid=velero-pod-volume-backup-workspace]", { timeout: 60_000 });
        expect((await cluster.shownView(frame))?.name).toBe(name);
        await cluster.closeWorkspace(frame);
        expect((await cluster.shownView(frame))?.name).toBe("backup-inprogress");
      }
      await cluster.closeWorkspace(frame);
    },
    TIMEOUT,
  );

  it(
    "shows the one pod volume backup of a backup that partially failed, failed with its message beside the failure of the backup, and no repository of the views for it",
    async () => {
      const name = "views-history-4";
      const owner = cluster.veleroObject<{ metadata: { uid?: string }; status?: { phase?: string } }>(
        "backups",
        name,
        cluster.E2E_VIEWS_NAMESPACE,
      );
      const own = cluster
        .labelledObjects<{
          metadata: { name: string; labels?: Record<string, string> };
          status?: { phase?: string; message?: string };
        }>("podvolumebackups", `velero.io/backup-name=${name}`, cluster.E2E_VIEWS_NAMESPACE)
        .filter(({ metadata }) => metadata.labels?.["velero.io/backup-uid"] === owner?.metadata.uid);

      expect(owner?.status?.phase).toBe("PartiallyFailed");
      expect(own.map(({ status }) => status?.phase)).toEqual(["Failed"]);
      const [operation] = own;

      await cluster.openPage(frame, cluster.BACKUPS);
      await cluster.selectInstallation(frame, cluster.E2E_VIEWS_NAMESPACE);
      await cluster.waitForList(frame, cluster.BACKUPS);
      await cluster.openWorkspace(frame, name, cluster.BACKUPS);
      const band = await cluster.volumeBand(frame, "rows");

      expect(band.groups).toEqual([["Failed", 1]]);
      expect(band.rows).toEqual([operation.metadata.name]);
      // The failure of the backup itself is beside the band, in the status of the backup.
      expect(await frame.locator("[data-testid=velero-backup-status]").innerText()).toContain("Partially failed");
      await frame.locator(`[data-testid="velero-open-pod-volume-backup-${operation.metadata.name}"]`).click();
      const view = frame.locator("[data-testid=velero-pod-volume-backup-workspace]");

      await view.waitFor({ state: "visible", timeout: 60_000 });
      expect((await view.locator("[data-testid=velero-volume-message]").innerText()).trim()).toBe(
        operation.status?.message,
      );
      // Its pod is of a namespace no repository of the views is for: none is found by the three labels.
      expect(await view.locator("[data-testid=velero-volume-repository]").getAttribute("data-reference")).toBe("none");
      await cluster.closeWorkspace(frame);
      await cluster.closeWorkspace(frame);
      expect(await cluster.shownView(frame)).toBeUndefined();
    },
    TIMEOUT,
  );

  it(
    "gives the details of the host of a pod volume backup and of a pod volume restore the reading of their views, and a way to each",
    async () => {
      // A pod volume backup that failed with a message, of the backup that partially failed, and the pod volume
      // restore of the mapped restore that completed with no node, of the legacy controller of restic: each read by
      // the suite on the cluster by the label of its owner.
      const [backup] = cluster
        .labelledObjects<{ metadata: { name: string }; status?: { phase?: string; message?: string } }>(
          "podvolumebackups",
          "velero.io/backup-name=views-history-4",
          cluster.E2E_VIEWS_NAMESPACE,
        )
        .filter(({ status }) => status?.phase === "Failed");
      const [restore] = cluster
        .labelledObjects<{ metadata: { name: string }; spec?: { uploaderType?: string }; status?: { phase?: string } }>(
          "podvolumerestores",
          `velero.io/restore-name=${RESTORE}`,
          cluster.E2E_VIEWS_NAMESPACE,
        )
        .filter(({ spec, status }) => status?.phase === "Completed" && spec?.uploaderType === "restic");

      expect([Boolean(backup), Boolean(restore)]).toEqual([true, true]);
      for (const [resource, kind, name, texts] of [
        [
          "podvolumebackups",
          "pod-volume-backup",
          backup.metadata.name,
          ["Failed", backup.status?.message ?? "", "views-history-4"],
        ],
        ["podvolumerestores", "pod-volume-restore", restore.metadata.name, ["Completed", RESTORE]],
      ] as const) {
        await cluster.navigate(frame, `/crd/velero.io/${resource}`);
        await cluster.selectHostNamespace(frame, cluster.E2E_VIEWS_NAMESPACE);
        const details = await cluster.hostDetails(frame, name, ...texts, cluster.E2E_VIEWS_NAMESPACE);

        expect([kind, details.includes("Velero")]).toEqual([kind, true]);
        expect([kind, await frame.locator(`[data-testid=velero-${kind}-details-link]`).count()]).toEqual([kind, 1]);
        await cluster.captureScreenshot(frame, `dark-${kind}-host-details`);
        await cluster.closeDetails(frame);
      }
    },
    TIMEOUT,
  );

  it(
    "says of the pod volume backup of the name of the daily backup that its owner reference names the backup that is there, which its labels do not name",
    async () => {
      // Its labels name the daily backup with the UID of an earlier backup of that name; its owner reference names
      // the one that is there, with the UID the cluster gave it. Both read by the suite on the cluster.
      const daily = cluster.veleroObject<{ metadata: { uid?: string } }>(
        "backups",
        BACKUP,
        cluster.E2E_VIEWS_NAMESPACE,
      );
      const [operation] = cluster.labelledObjects<{
        metadata: { name: string; ownerReferences?: { kind?: string; name?: string; uid?: string }[] };
      }>("podvolumebackups", `velero.io/backup-name=${BACKUP}`, cluster.E2E_VIEWS_NAMESPACE);

      expect(operation.metadata.ownerReferences?.map(({ kind, name, uid }) => [kind, name, uid])).toEqual([
        ["Backup", BACKUP, daily?.metadata.uid],
      ]);
      await cluster.openPage(frame, cluster.POD_VOLUME_BACKUPS);
      await cluster.selectInstallation(frame, cluster.E2E_VIEWS_NAMESPACE);
      await cluster.waitForList(frame, cluster.POD_VOLUME_BACKUPS);
      await cluster.openWorkspace(frame, operation.metadata.name, cluster.POD_VOLUME_BACKUPS);
      const view = frame.locator("[data-testid=velero-pod-volume-backup-workspace]");

      await view.locator("[data-testid=velero-volume-belongs]").waitFor({ state: "visible", timeout: 60_000 });
      expect((await view.locator("[data-testid=velero-volume-belongs]").innerText()).replace(/\s+/g, " ")).toContain(
        `Its owner reference names the backup ${BACKUP} of UID ${daily?.metadata.uid}, which its labels do not name`,
      );
      await cluster.captureScreenshot(frame, "dark-pod-volume-backup-of-another-uid");
      await cluster.closeWorkspace(frame);
    },
    TIMEOUT,
  );

  it(
    "shows the pod volume backup of the real backup of the volume as the cluster holds it, and the way to its repository and back",
    async () => {
      // What the node agent wrote for the volume of the run, read by the suite on the cluster by the label of the
      // backup, never by its name, which the release makes; and the repository the server made for it.
      const backup = `fixture-volume-backup-${cluster.E2E_FIXTURE_RUN}`;
      const operations = cluster.labelledObjects<{
        metadata: { name: string };
        spec?: { node?: string; volume?: string; pod?: { namespace?: string } };
        status?: { phase?: string; snapshotID?: string };
      }>("podvolumebackups", `velero.io/backup-name=${backup}`);
      const [repository] = cluster.labelledObjects<{ metadata: { name: string } }>(
        "backuprepositories",
        cluster.runRepositorySelector(),
      );

      expect(operations.map(({ status }) => status?.phase)).toEqual(["Completed"]);
      const [operation] = operations;

      expect(operation.status?.snapshotID).toBeTruthy();
      await cluster.openPage(frame, cluster.BACKUPS);
      await cluster.selectInstallation(frame, cluster.E2E_NAMESPACE);
      await cluster.waitForList(frame, cluster.BACKUPS);
      await cluster.openWorkspace(frame, backup, cluster.BACKUPS);
      expect((await cluster.volumeBand(frame, "rows")).rows).toHaveLength(1);
      // The row of the band is the way to the view of the pod volume backup.
      await frame.locator(`[data-testid="velero-open-pod-volume-backup-${operation.metadata.name}"]`).click();
      const view = frame.locator("[data-testid=velero-pod-volume-backup-workspace]");

      await view.waitFor({ state: "visible", timeout: 60_000 });
      expect((await cluster.shownView(frame))?.name).toBe(operation.metadata.name);
      expect(await volumes.factOf(view, "Phase")).toMatch(/^Completed\b/);
      expect(await volumes.factOf(view, "Snapshot ID")).toBe(operation.status?.snapshotID);
      expect(await volumes.factOf(view, "Node")).toBe(operation.spec?.node);
      expect(await volumes.factOf(view, "Volume")).toBe(operation.spec?.volume);
      expect(await volumes.factOf(view, "Pod namespace")).toBe(operation.spec?.pod?.namespace);
      await cluster.captureScreenshot(frame, "dark-pod-volume-backup-of-the-volume");
      // Its repository, found by the three labels, is a way to the view of the repository, and the way back leads to
      // the pod volume backup again, then to the backup, then to the list.
      await frame.locator(`[data-testid="velero-open-backup-repository-${repository.metadata.name}"]`).click();
      await frame.waitForSelector("[data-testid=velero-backup-repository-workspace]", { timeout: 60_000 });
      expect((await cluster.shownView(frame))?.name).toBe(repository.metadata.name);
      await cluster.closeWorkspace(frame);
      expect((await cluster.shownView(frame))?.name).toBe(operation.metadata.name);
      await cluster.closeWorkspace(frame);
      expect((await cluster.shownView(frame))?.name).toBe(backup);
      await cluster.closeWorkspace(frame);
      expect(await cluster.shownView(frame)).toBeUndefined();
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
