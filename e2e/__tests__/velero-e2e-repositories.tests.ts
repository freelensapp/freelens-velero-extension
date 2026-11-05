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
        const readFrom = Date.now();
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
