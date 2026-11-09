/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

// The views for who may read a part: an identity of the test environment that
// reads the backups, the schedules and the storage locations of one namespace,
// and nothing of the rest of the cluster. What it cannot read is said, and is
// neither an empty list nor a count of zero.
//
// Then the views for the reader of the README (REQ-288 of SPEC-0018), which
// holds the role of the README that reads: `list` on every family of the
// installation, in its namespace, and on the storage locations of the whole
// cluster. The views find the installations and read every family of one,
// none denied, so that a verb the views start to need fails here before it
// reaches an operator; and the two ways the adapter writes, a creation and a
// patch, end as forbidden at the step whose verb the role lacks, with the
// words of what the identity may not do, and nothing written.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as cluster from "../../integration/helpers/velero-cluster";
import * as velero from "../../integration/helpers/velero-extension";
import { writesOf } from "../../integration/helpers/velero-guard";
import { BACKUP_NOW_WORDS } from "../../src/main/backup-now";
import { SCHEDULE_PATCH_WORDS } from "../../src/main/schedule-patch";

import type { Frame } from "playwright";

const TIMEOUT = 10 * 60 * 1000;
const SCHEDULED = "views-daily-20260901030000";

describe("views with restricted access", () => {
  let started: velero.StartedApplication;
  let frame: Frame;
  let before: cluster.ClusterSnapshot;

  beforeAll(async () => {
    if (!cluster.fixturesReady()) {
      throw new Error(cluster.fixturesMissing());
    }
    before = cluster.clusterSnapshot();
    let kubeconfig = "";

    // The kubeconfig is in the profile before the install is asked, for each start of the application. The
    // store of the profile names the one of the reader as the only one the catalog syncs: the catalog holds
    // the test cluster through it, and nothing else.
    started = await velero.startWithExtension(
      async () => {
        kubeconfig = await cluster.publishKubeconfig(cluster.readerKubeconfigPath(), "velero-e2e-reader");
      },
      "Dark",
      2,
      [cluster.readerKubeconfigPath()],
    );
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
      // The view of a backup shows the band of its pod volume backups and of its data uploads, which this identity
      // may not read: their families are denied over it as well, the moment the view asked them.
      const shown = await cluster.notices(frame, ["dataUploads", "podVolumeBackups", "restores", "snapshotLocations"]);

      expect(Object.keys(shown).sort()).toEqual(["dataUploads", "podVolumeBackups", "restores", "snapshotLocations"]);
      expect(shown.podVolumeBackups).toContain("access is denied");
      expect(shown.dataUploads).toContain("access is denied");
      expect(shown.restores).toContain("access is denied");
      expect(shown.snapshotLocations).toContain("access is denied");
      // The band itself says that the pod volume backups cannot be read, and that how many the backup has is not
      // known: no count, no group, no row, which would say a number of what was not read (scenario 7, KIND-16).
      expect(await cluster.volumeBand(frame, "denied")).toMatchObject({
        kind: "PodVolumeBackup",
        state: "denied",
        words:
          "The pod volume backups of this installation cannot be read: access is denied. How many this backup has is not known.",
        count: "",
        groups: [],
        rows: [],
        more: false,
      });
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
    "says that the backup repositories and the operations of the volumes are denied, and not that there are none",
    async () => {
      // The identity reads the backups, the schedules and the storage locations: each list of the five kinds of
      // the volumes says that it is denied, with no row and no count, and the notice of its family says the same.
      for (const [of, family, plural] of [
        [cluster.REPOSITORIES, "backupRepositories", "backup repositories"],
        [cluster.POD_VOLUME_BACKUPS, "podVolumeBackups", "pod volume backups"],
        [cluster.POD_VOLUME_RESTORES, "podVolumeRestores", "pod volume restores"],
        [cluster.DATA_UPLOADS, "dataUploads", "data uploads"],
        [cluster.DATA_DOWNLOADS, "dataDownloads", "data downloads"],
      ] as const) {
        await cluster.openPage(frame, of);
        await frame.waitForSelector(`[data-testid=velero-${of.id}-unavailable]`, { timeout: 60_000 });
        const state = (await frame.locator(`[data-testid=velero-${of.id}-unavailable]`).innerText()).replace(
          /\s+/g,
          " ",
        );

        expect([of.id, state]).toEqual([
          of.id,
          `The ${plural} of ${cluster.E2E_VIEWS_NAMESPACE} are not shown Access to the ${plural} of this namespace is denied. How many there are is not known.`,
        ]);
        expect([of.id, await frame.locator(`[data-testid=velero-${of.id}]`).count()]).toEqual([of.id, 0]);
        expect([
          of.id,
          /\b\d+ items?\b/.test(await frame.locator(`[data-testid=velero-${of.id}-page]`).innerText()),
        ]).toEqual([of.id, false]);
        const notices = await cluster.notices(frame, [family]);

        expect([of.id, Object.keys(notices)]).toEqual([of.id, [family]]);
        expect([of.id, notices[family]]).toEqual([of.id, expect.stringContaining("access is denied")]);
        expect([of.id, await cluster.layoutProblems(frame, of)]).toEqual([of.id, []]);
        await cluster.captureScreenshot(frame, `dark-restricted-${of.id}-denied`);
      }
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
      expect(shown.read.backupRepositories).toEqual({ text: "Backup Repositories Access denied", state: "denied" });
      expect([shown.read.backups.state, shown.read.schedules.state, shown.read.storageLocations.state]).toEqual([
        "read",
        "read",
        "read",
      ]);
      expect(shown.read.backups.text).toMatch(/^Backups \d+$/);
      // The rules looked at what was read, and say what they did not look at: the restores and the backup
      // repositories. No rule is of the snapshot locations, and nothing is said of them among what needs attention.
      // The backups are read, and none of them gives the zone of the server: the adherence of the six schedules of
      // five fields that name no zone is not known, and so is the adherence of the two Velero has not read, which is
      // said.
      expect(shown.unchecked).toEqual(["restores", "backupRepositories"]);
      expect(shown.summary).toMatch(
        /^\d+ items in what was read\. The adherence of 8 schedules is not known\. Not everything was read\.$/,
      );
      expect(shown.notKnown).toEqual({ count: 8, reasons: { "not-read": 2, "no-offset": 6 } });
      const attention = (await frame.locator("[data-testid=velero-overview-attention]").innerText()).replace(
        /\s+/g,
        " ",
      );

      expect(attention).toContain("The restores of this installation cannot be read: access is denied.");
      expect(attention).toContain(
        "Whether a restore in flight carries a failure, and whether one ended with a failure, were not checked.",
      );
      expect(attention).toContain(
        "The backup repositories of this installation cannot be read: access is denied. The readiness and the maintenance of the backup repositories were not checked.",
      );
      // No item is of a restore or of a repository, and the restores are not said none: in flight, and on the line
      // of time.
      expect(await frame.locator("[data-testid=velero-overview] [data-testid^=velero-open-restore-]").count()).toBe(0);
      expect(
        await frame.locator("[data-testid=velero-overview] [data-testid^=velero-open-backup-repository-]").count(),
      ).toBe(0);
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
      // The cell of what is denied leads to its list, which says the same: the restores, and the backup repositories.
      await frame.click("[data-testid=velero-overview-read-restores]");
      await frame.waitForSelector("[data-testid=velero-restores-unavailable]", { timeout: 60_000 });
      await cluster.openPage(frame, cluster.OVERVIEW);
      await cluster.overview(frame);
      await frame.click("[data-testid=velero-overview-read-backupRepositories]");
      await frame.waitForSelector(`[data-testid=velero-${cluster.REPOSITORIES.id}-unavailable]`, { timeout: 60_000 });
    },
    TIMEOUT,
  );

  it(
    "says the adherence of the schedules it reads with the backups: an interval overdue, five fields not known for want of an offset",
    async () => {
      await cluster.selectInstallation(frame, cluster.E2E_VIEWS_NAMESPACE);
      await cluster.openPage(frame, cluster.SCHEDULES);
      await cluster.waitForList(frame, cluster.SCHEDULES);
      // The interval is counted from its last submission, two days back, whatever the backups say; the schedule of
      // five fields names no zone, and no backup of the installation gives the one of the server.
      expect(await cluster.rowAdherence(frame, "views-interval")).toEqual({
        next: "at",
        state: "overdue",
        mark: "late",
        reason: "",
      });
      expect(await cluster.rowAdherence(frame, "views-daily")).toEqual({
        next: "not-known",
        state: "not-known",
        mark: "not-known",
        reason: "no-offset",
      });
      expect(await cluster.layoutProblems(frame, cluster.SCHEDULES)).toEqual([]);
      await cluster.captureScreenshot(frame, "dark-restricted-adherence");
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

// The schedule with a history of the installation of the views, which the reader of the README asks a backup of and a
// pause of; how long what must not happen is waited for; and the parts of the workspaces of the two writes.
const SCHEDULE = "views-history";
const NOTHING = 1500;
const backUpNow = (id: string) => `[data-testid=velero-backup-now-${id}]`;
const patch = (id: string) => `[data-testid=velero-schedule-patch-${id}]`;
// The field of the name of the backup: the host gives its own element the identifier, or the input in it.
const NAME_FIELD = `${backUpNow("field")} input, input${backUpNow("field")}`;

/** A schedule as the environment reads it, through the kubectl of the environment. */
function scheduleOf(name: string, namespace: string): { metadata: { uid: string; resourceVersion: string } } {
  const { status, stdout, stderr } = cluster.kubectlE2E(
    "get",
    "schedules.velero.io",
    name,
    "--namespace",
    namespace,
    "-o",
    "json",
  );

  if (status !== 0) throw new Error(`kubectl get schedule ${name} failed: ${stderr}`);
  return JSON.parse(stdout) as { metadata: { uid: string; resourceVersion: string } };
}

describe("views and two writes with the role of the README that reads", () => {
  let started: velero.StartedApplication;
  let frame: Frame;
  let before: cluster.ClusterSnapshot;

  beforeAll(async () => {
    if (!cluster.fixturesReady()) {
      throw new Error(cluster.fixturesMissing());
    }
    before = cluster.clusterSnapshot();
    let kubeconfig = "";

    // The store of the profile names the kubeconfig of the reader of the README as the only one the catalog syncs: the
    // catalog holds the test cluster through it, and nothing else.
    started = await velero.startWithExtension(
      async () => {
        kubeconfig = await cluster.publishKubeconfig(cluster.readmeReaderKubeconfigPath(), "velero-e2e-readme-reader");
      },
      "Dark",
      2,
      [cluster.readmeReaderKubeconfigPath()],
    );
    await velero.dismissNotifications(started.window);
    await velero.navigateToCatalog(started.app);
    expect(await velero.catalogClusterCount(started.window)).toBe(1);
    frame = await cluster.openClusterFromCatalog(started.window, kubeconfig);
  }, TIMEOUT);

  afterAll(async () => {
    await started?.cleanup();
  }, TIMEOUT);

  it(
    "finds where the installations are and reads every family of the installation of the views, none denied",
    async () => {
      await cluster.openBackups(frame);
      // The ClusterRole lists the storage locations of the whole cluster: each namespace that holds one is suggested,
      // as it is to the administrator of the environment. A role that did not let the views list them would ask for a
      // namespace instead.
      await frame.waitForSelector("[data-testid=velero-state-choose], [data-testid=velero-state-configure]", {
        timeout: 60_000,
      });
      expect(await frame.locator("[data-testid=velero-state-configure]").count()).toBe(0);
      expect(await frame.locator("[data-testid^=velero-choice-]").count()).toBe(cluster.SUGGESTED_NAMESPACES.length);
      await frame.click(`[data-testid="velero-choice-${cluster.E2E_VIEWS_NAMESPACE}"]`);
      await cluster.waitForBackups(frame);
      expect((await cluster.target(frame)).namespace).toBe(cluster.E2E_VIEWS_NAMESPACE);
      // The Role lists the ten families of the installation: each list has its rows, and nothing is denied over it.
      for (const of of [
        cluster.BACKUPS,
        cluster.RESTORES,
        cluster.SCHEDULES,
        cluster.STORAGE_LOCATIONS,
        cluster.SNAPSHOT_LOCATIONS,
        cluster.REPOSITORIES,
        cluster.POD_VOLUME_BACKUPS,
        cluster.POD_VOLUME_RESTORES,
        cluster.DATA_UPLOADS,
        cluster.DATA_DOWNLOADS,
      ]) {
        await cluster.openPage(frame, of);
        // A family the role did not let the views list would say so in place of its rows.
        await frame.waitForSelector(
          `[data-testid=velero-${of.id}] .TableRow:not(.TableHead), [data-testid=velero-${of.id}-unavailable]`,
          { timeout: 60_000 },
        );
        expect([of.id, await frame.locator(`[data-testid=velero-${of.id}-unavailable]`).count()]).toEqual([of.id, 0]);
        await cluster.waitForList(frame, of);
        expect([of.id, await cluster.notices(frame, [])]).toEqual([of.id, {}]);
      }
      // The Overview reads its six families, each of them read, and says nothing that it did not look at.
      await cluster.openPage(frame, cluster.OVERVIEW);
      const shown = await cluster.overview(frame);

      expect(Object.keys(shown.read)).toHaveLength(6);
      expect(Object.entries(shown.read).filter(([, read]) => read.state !== "read")).toEqual([]);
      expect(shown.unchecked).toEqual([]);
      expect(await cluster.layoutProblems(frame, cluster.OVERVIEW)).toEqual([]);
      await cluster.captureScreenshot(frame, "dark-readme-reader-overview");
    },
    TIMEOUT,
  );

  it(
    "refuses a backup at the read of its schedule and the patch of the schedule, with the words of what the identity may not do, writes left on and nothing written",
    async () => {
      const namespace = cluster.E2E_VIEWS_NAMESPACE;
      const name = `${SCHEDULE}-of-the-readme-reader`;
      const history = scheduleOf(SCHEDULE, namespace);
      const earlier = cluster.apiRequests();

      await cluster.openPage(frame, cluster.SCHEDULES);
      await cluster.waitForList(frame, cluster.SCHEDULES);
      await cluster.openWorkspace(frame, SCHEDULE, cluster.SCHEDULES);
      await frame.click("[data-testid=velero-schedule-back-up-now]");
      await frame.waitForSelector(backUpNow("workspace"), { timeout: 30_000 });
      await frame.waitForSelector("[data-testid=velero-writes-on]", { timeout: 60_000 });
      await cluster.turnWritesOn(frame);
      await frame.locator(NAME_FIELD).first().fill(name);
      // The confirmation reads the schedule by its name, which the role does not allow: no review is shown, and the
      // words say the read the identity may not make. A role that let the read through would show the review.
      await frame.click(backUpNow("ask"));
      await frame.waitForSelector(`${backUpNow("failure")}, ${backUpNow("review")}`, { timeout: 60_000 });
      expect(await frame.locator(backUpNow("review")).count()).toBe(0);
      expect([
        await frame.locator(backUpNow("failure")).getAttribute("data-code"),
        await frame.locator(backUpNow("failure")).getAttribute("data-stage"),
        await cluster.wordsOf(frame, backUpNow("failure-text")),
      ]).toEqual(["forbidden", "read", BACKUP_NOW_WORDS.forbiddenRead(namespace)]);
      // The refusal is of the cluster, not of the gate: writes stay on, and no backup of the name is there.
      await frame.waitForTimeout(NOTHING);
      expect(await cluster.writesState(frame)).toBe("on");
      expect(cluster.kubectlE2E("get", "backups.velero.io", name, "--namespace", namespace).status).not.toBe(0);
      // The pause of the schedule: its review reads nothing, and its run sends the patch, which the role does not allow.
      await cluster.showList(frame);
      await cluster.openPage(frame, cluster.SCHEDULES);
      await cluster.waitForList(frame, cluster.SCHEDULES);
      await cluster.openWorkspace(frame, SCHEDULE, cluster.SCHEDULES);
      await frame.click("[data-testid=velero-schedule-pause]");
      await frame.waitForSelector(patch("ask"), { timeout: 30_000 });
      await frame.click(patch("ask"));
      await frame.waitForSelector(patch("review"), { timeout: 30_000 });
      await frame.click(patch("run"));
      // A role that let the patch through would show its result.
      await frame.waitForSelector(`${patch("failure")}, ${patch("result")}`, { timeout: 60_000 });
      expect(await frame.locator(patch("result")).count()).toBe(0);
      expect([
        await frame.locator(patch("failure")).getAttribute("data-code"),
        await frame.locator(patch("failure")).getAttribute("data-stage"),
        await cluster.wordsOf(frame, patch("failure-text")),
      ]).toEqual(["forbidden", "patch", SCHEDULE_PATCH_WORDS.forbidden(namespace)]);
      await frame.waitForTimeout(NOTHING);
      expect(await cluster.writesState(frame)).toBe("on");
      expect(scheduleOf(SCHEDULE, namespace).metadata).toMatchObject({
        uid: history.metadata.uid,
        resourceVersion: history.metadata.resourceVersion,
      });
      // No write of any kind of Velero since the first command, every PATCH of a schedule counted: no controller runs
      // here, and the runner that stands in for the server patches its storage location alone.
      expect(writesOf(cluster.counted(earlier, cluster.apiRequests()), false, 0)).toEqual({});
      expect(await cluster.layoutProblems(frame, cluster.SCHEDULES)).toEqual([]);
      await cluster.captureScreenshot(frame, "dark-readme-reader-patch-refused");
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
