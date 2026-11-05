/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

// The backup repositories of the views, in a packaged Freelens, against the test environment as its fixtures leave
// it: the namespace of the views holds nine repositories, each with the three labels the release writes, which
// stand for the states of SPEC-0014: Ready with three recent maintenances, the newest failed; Ready with no
// maintenance yet, of the uploader restic; NotReady with a message of several lines; not initialized, with no
// status; Ready and due, maintained thirty days before; two of the same three labels; a name of 63 characters, and
// the one the release makes for a namespace and a location of 63. The suite reads the repositories on the cluster
// with `kubectl get` in that namespace, before it reads the page, and expects of each row what the cluster holds of
// it, by the rules of the reviewed release (`integration/helpers/velero-volumes.ts`). It proves the cells of each
// row, the orders of its readiness and of its last maintenance both ways, and the search. The suite reads the
// application and the cluster, and writes to neither.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as cluster from "../../integration/helpers/velero-cluster";
import * as velero from "../../integration/helpers/velero-extension";
import * as volumes from "../../integration/helpers/velero-volumes";

import type { Frame } from "playwright";

const TIMEOUT = 10 * 60 * 1000;
const REPOSITORIES = cluster.REPOSITORIES;
// Every repository of the views carries the three labels the release writes; the one of the type selects them all.
const ANY_REPOSITORY = "velero.io/repository-type";
const HEAD = "[data-testid=velero-backup-repositories] .TableHead .TableCell";

describe("the backup repositories of the views", () => {
  let started: velero.StartedApplication;
  let frame: Frame;
  const errors = velero.createErrorCollector();
  let before: cluster.ClusterSnapshot;
  let counted: Record<string, number>;
  let held: volumes.RepositoryObject[] = [];
  const named = (name: string) => held.find((repository) => repository.metadata.name === name);
  // The readiness and the last maintenance of each mounted row, in the order the list shows them.
  const shownInOrder = async (column: "readiness" | "maintained") =>
    Promise.all(
      (await cluster.mounted(frame, REPOSITORIES)).map(
        async (name) => [name, (await cluster.cellsOf(REPOSITORIES, frame, name))[column]] as const,
      ),
    );

  beforeAll(async () => {
    if (!cluster.fixturesReady()) {
      throw new Error(cluster.fixturesMissing());
    }
    before = cluster.clusterSnapshot();
    held = cluster.labelledObjects<volumes.RepositoryObject>(
      "backuprepositories",
      ANY_REPOSITORY,
      cluster.E2E_VIEWS_NAMESPACE,
    );
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
    "lists the nine repositories of the views, each with what the cluster holds of it",
    async () => {
      // The nine of the fixtures, as the cluster holds them: the states the list is to show are all there.
      expect(held).toHaveLength(9);
      expect(new Set(held.map((repository) => volumes.readinessOf(repository).word))).toEqual(
        new Set(Object.values(volumes.READINESS).map(({ word }) => word)),
      );
      expect(held.filter(volumes.newestMaintenanceFailed)).toHaveLength(1);
      expect(held.filter((repository) => !repository.status)).toHaveLength(1);
      await cluster.openPage(frame, REPOSITORIES);
      await cluster.selectInstallation(frame, cluster.E2E_VIEWS_NAMESPACE);
      await cluster.waitForList(frame, REPOSITORIES);
      expect([...(await cluster.mounted(frame, REPOSITORIES))].sort()).toEqual(
        held.map((repository) => repository.metadata.name).sort(),
      );
      for (const repository of held) {
        const name = repository.metadata.name;
        const readFrom = Date.now() - volumes.VIEW_CLOCK_LAG;
        const cells = await cluster.expectCells(REPOSITORIES, frame, name, volumes.repositoryCells(repository));
        const readTo = Date.now();

        // The cell of the last maintenance, how long ago by the clock of the machine when the row was read, with
        // the words of a newest maintenance that failed after the time, which is the one of the last that
        // succeeded; or that there was none.
        const expected = volumes.maintainedTexts(repository, readFrom, readTo);

        expect([name, expected.includes(cells.maintained) ? cells.maintained : expected]).toEqual([
          name,
          cells.maintained,
        ]);
      }
      expect(await cluster.notices(frame, [])).toEqual({});
      expect(await cluster.layoutProblems(frame, REPOSITORIES)).toEqual([]);
      await cluster.captureScreenshot(frame, "dark-backup-repositories");
    },
    TIMEOUT,
  );

  it(
    "orders the repositories by their readiness and by their last maintenance, each both ways",
    async () => {
      await cluster.openPage(frame, REPOSITORIES);
      await cluster.waitForList(frame, REPOSITORIES);
      // By the readiness: the ready first, then the ones not ready, then the ones not initialized; asked again, the
      // other way. Within a readiness the order is not compared: it is the one of the names, as the release made them.
      const rank = (word: string) =>
        Object.values(volumes.READINESS).find((readiness) => readiness.word === word)?.rank ?? Number.NaN;

      await frame.click(`${HEAD}.readiness`);
      const ranked = (await shownInOrder("readiness")).map(([, word]) => rank(word));

      expect(ranked).toHaveLength(9);
      expect(ranked).toEqual([...ranked].sort((one, other) => one - other));
      expect(new Set(ranked).size).toBe(3);
      await frame.click(`${HEAD}.readiness`);
      const again = (await shownInOrder("readiness")).map(([, word]) => rank(word));

      expect(again).toEqual([...ranked].sort((one, other) => other - one));
      // By the last maintenance: the oldest first and the ones never maintained last; asked again, the newest first
      // and the ones never maintained first. The order is the one of the times the cluster holds.
      const time = (name: string) => {
        const last = named(name)?.status?.lastMaintenanceTime;

        return last ? Date.parse(last) : Number.POSITIVE_INFINITY;
      };

      await frame.click(`${HEAD}.maintained`);
      const oldest = (await shownInOrder("maintained")).map(([name]) => time(name));

      expect(oldest).toEqual([...oldest].sort((one, other) => one - other));
      expect(oldest.filter((value) => value === Number.POSITIVE_INFINITY)).toHaveLength(
        held.filter((repository) => !repository.status?.lastMaintenanceTime).length,
      );
      await frame.click(`${HEAD}.maintained`);
      const newest = (await shownInOrder("maintained")).map(([name]) => time(name));

      expect(newest.map((value) => (value === Number.POSITIVE_INFINITY ? -1 : value))).toEqual(
        [...oldest].reverse().map((value) => (value === Number.POSITIVE_INFINITY ? -1 : value)),
      );
      expect(await cluster.layoutProblems(frame, REPOSITORIES)).toEqual([]);
    },
    TIMEOUT,
  );

  it(
    "finds a repository by a word of its message, of its readiness, of its type and of a maintenance that failed",
    async () => {
      await cluster.openPage(frame, REPOSITORIES);
      await cluster.waitForList(frame, REPOSITORIES);
      const ofWord = (accept: (repository: volumes.RepositoryObject) => boolean) =>
        held
          .filter(accept)
          .map((repository) => repository.metadata.name)
          .sort();

      const words: [string, (repository: volumes.RepositoryObject) => boolean][] = [
        ["answered 403", (repository) => (repository.status?.message ?? "").includes("answered 403")],
        ["Not initialized yet", (repository) => !repository.status?.phase],
        ["restic", (repository) => repository.spec?.repositoryType === "restic"],
        [volumes.REPOSITORY_WORDS.newestFailed, volumes.newestMaintenanceFailed],
      ];

      for (const [word, accept] of words) {
        const found = ofWord(accept);

        expect([word, found.length]).toEqual([word, 1]);
        expect([word, [...(await cluster.search(frame, word, REPOSITORIES))].sort()]).toEqual([word, found]);
      }
      await cluster.search(frame, "", REPOSITORIES);
      expect((await cluster.mounted(frame, REPOSITORIES)).length).toBe(9);
    },
    TIMEOUT,
  );

  it(
    "shows the recent maintenances of a repository newest first, the newest failed with its message, and the last that succeeded as its last maintenance",
    async () => {
      const repository = held.find(volumes.newestMaintenanceFailed);

      if (!repository) throw new Error("No repository of the views has a newest maintenance that failed");
      const name = repository.metadata.name;
      const last = repository.status?.lastMaintenanceTime ?? "";

      await cluster.openPage(frame, REPOSITORIES);
      await cluster.waitForList(frame, REPOSITORIES);
      await cluster.openWorkspace(frame, name, REPOSITORIES);
      const workspace = frame.locator("[data-testid=velero-backup-repository-workspace]");
      const table = workspace.locator("[data-testid=velero-backup-repository-maintenances]");

      await table.waitFor({ state: "visible", timeout: 60_000 });
      // The three of the release, newest first: the newest failed, with its message; the two before it succeeded.
      const rows = await table.locator("tbody tr").evaluateAll((elements) =>
        elements.map((row) => {
          const cells = [...row.querySelectorAll("td")].map((cell) =>
            (cell.textContent ?? "").replace(/\s+/g, " ").trim(),
          );

          return { result: cells[0], duration: cells[3], message: cells[4] };
        }),
      );

      expect(rows).toEqual(volumes.maintenanceRows(repository));
      expect(rows.map(({ result }) => result)).toEqual(["Failed", "Succeeded", "Succeeded"]);
      // The last maintenance is the time of the last that succeeded, with how long ago and the mark of the newest that
      // failed, and the note that says so.
      const maintained = workspace.locator("[data-testid=velero-backup-repository-maintained]");
      const readFrom = Date.now() - volumes.VIEW_CLOCK_LAG;
      const text = (await maintained.innerText()).replace(/\s+/g, " ").trim();
      const readTo = Date.now();

      expect(await maintained.getAttribute("data-newest-failed")).toBe("true");
      expect(volumes.agoTexts(last, readFrom, readTo).some((ago) => text.endsWith(ago))).toBe(true);
      expect((await workspace.innerText()).replace(/\s+/g, " ")).toContain(volumes.REPOSITORY_WORDS.newestFailedNote);
      await cluster.captureScreenshot(frame, "dark-backup-repository-maintenances");
      await cluster.closeWorkspace(frame);
    },
    TIMEOUT,
  );

  it(
    "says when the next maintenance of each repository is due by the clock of this machine, or why none is",
    async () => {
      await cluster.openPage(frame, REPOSITORIES);
      await cluster.waitForList(frame, REPOSITORIES);
      for (const repository of held) {
        const name = repository.metadata.name;

        await cluster.openWorkspace(frame, name, REPOSITORIES);
        const due = frame.locator("[data-testid=velero-backup-repository-due]");
        // The view says what it knows once the storage locations of the installation were answered: before, that they
        // are being read. What it says then is read again until it is one of what the cluster and the clock allow, a
        // minute at most.
        const deadline = Date.now() + 60_000;
        let text = "";
        let expected: string[] = [];

        do {
          const readFrom = Date.now() - volumes.VIEW_CLOCK_LAG;

          text = (await due.innerText()).replace(/\s+/g, " ").trim();
          expected = volumes.dueTexts(repository, readFrom, Date.now());
          if (expected.includes(text)) break;
          await frame.waitForTimeout(250);
        } while (Date.now() < deadline);
        expect([name, expected.includes(text) ? text : expected]).toEqual([name, text]);
        await cluster.closeWorkspace(frame);
      }
    },
    TIMEOUT,
  );

  it(
    "gives the details of the host the reading of the row, and a way to the view of the repository",
    async () => {
      const repository = held.find((item) => volumes.readinessOf(item) === volumes.READINESS.notReady);

      if (!repository) throw new Error("No repository of the views is not ready");
      const name = repository.metadata.name;

      await cluster.openPage(frame, REPOSITORIES);
      await cluster.waitForList(frame, REPOSITORIES);
      const cells = await cluster.cellsOf(REPOSITORIES, frame, name);

      // The list the host has of the kind, by its address, the one way to it while the extension keeps the kind out
      // of the Custom Resources tree; the section of the extension in its details says what the row says, and the
      // lines of the message of Velero.
      await cluster.navigate(frame, "/crd/velero.io/backuprepositories");
      await cluster.selectHostNamespace(frame, cluster.E2E_VIEWS_NAMESPACE);
      const details = await cluster.hostDetails(
        frame,
        name,
        cells.readiness,
        cells["volume-namespace"],
        cells.location,
        cells["repository-type"],
      );

      for (const line of (repository.status?.message ?? "").split("\n")) expect(details).toContain(line);
      const link = frame.locator("[data-testid=velero-backup-repository-details-link]");

      expect(await link.count()).toBe(1);
      await cluster.captureScreenshot(frame, "dark-backup-repository-host-details");
      // The way of the section opens the view of the repository in the page of the extension.
      await link.click();
      await frame.waitForSelector("[data-testid=velero-backup-repository-workspace]", { timeout: 60_000 });
      expect((await cluster.shownView(frame))?.name).toBe(name);
      if ((await cluster.hostDetailsShown(frame)).drawer) await cluster.closeDetails(frame);
      await cluster.closeWorkspace(frame);
    },
    TIMEOUT,
  );

  it(
    "says what used the real repository of the installation, the pod volume backup and the pod volume restore of the volume of the run, each a way and back",
    async () => {
      // What the volume of the run made, read by the suite on the cluster by the labels the release writes: the
      // repository by its three, the operations by the names of their backup and restore.
      const [repository, ...more] = cluster.labelledObjects<{ metadata: { name: string } }>(
        "backuprepositories",
        cluster.runRepositorySelector(),
      );
      const [backup] = cluster.labelledObjects<{ metadata: { name: string } }>(
        "podvolumebackups",
        `velero.io/backup-name=fixture-volume-backup-${cluster.E2E_FIXTURE_RUN}`,
      );
      const [restore] = cluster.labelledObjects<{ metadata: { name: string } }>(
        "podvolumerestores",
        `velero.io/restore-name=fixture-volume-restore-${cluster.E2E_FIXTURE_RUN}`,
      );

      expect([more.length, Boolean(repository), Boolean(backup), Boolean(restore)]).toEqual([0, true, true, true]);
      await cluster.openPage(frame, REPOSITORIES);
      await cluster.selectInstallation(frame, cluster.E2E_NAMESPACE);
      await cluster.waitForList(frame, REPOSITORIES);
      await cluster.openWorkspace(frame, repository.metadata.name, REPOSITORIES);
      // For each kind: one operation, the newest a way to its view, and the backup or the restore it belongs to.
      for (const [kind, operation, owner] of [
        ["pod-volume-backup", backup.metadata.name, `fixture-volume-backup-${cluster.E2E_FIXTURE_RUN}`],
        ["pod-volume-restore", restore.metadata.name, `fixture-volume-restore-${cluster.E2E_FIXTURE_RUN}`],
      ] as const) {
        const use = frame.locator(`[data-testid=velero-used-by-${kind}]`);

        await use.locator("[data-testid=velero-used-by-count]").waitFor({ state: "visible", timeout: 60_000 });
        expect([kind, (await use.locator("[data-testid=velero-used-by-count]").innerText()).trim()]).toEqual([
          kind,
          `1 ${kind.replaceAll("-", " ")}`,
        ]);
        expect([kind, (await use.innerText()).replace(/\s+/g, " ")]).toEqual([kind, expect.stringContaining(owner)]);
        await use.locator(`[data-testid="velero-open-${kind}-${operation}"]`).click();
        await frame.waitForSelector(`[data-testid=velero-${kind}-workspace]`, { timeout: 60_000 });
        expect([kind, (await cluster.shownView(frame))?.name]).toEqual([kind, operation]);
        await cluster.closeWorkspace(frame);
        expect([kind, (await cluster.shownView(frame))?.name]).toEqual([kind, repository.metadata.name]);
      }
      await cluster.captureScreenshot(frame, "dark-backup-repository-used-by");
      await cluster.closeWorkspace(frame);
      expect(await cluster.shownView(frame)).toBeUndefined();
      await cluster.selectInstallation(frame, cluster.E2E_VIEWS_NAMESPACE);
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
