/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

// What the extension keeps between two starts of the application, which is two
// maps of namespaces and the window of the recent operations, and what it does
// with a choice that is not valid any more. The application is started
// three times on the same profile; the cluster is only read.

import { readFile, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { expect } from "@jest/globals";
import * as utils from "../helpers/utils";
import * as cluster from "../helpers/velero-cluster";
import * as velero from "../helpers/velero-extension";

import type { Frame } from "playwright";

const TIMEOUT = 10 * 60 * 1000;
// The name of a namespace that is not in the cluster: what is left of a choice when its namespace goes.
const REMOVED = "velero-removed-installation";

describe("preferences of the views", () => {
  let started: velero.StartedApplication | undefined;
  let profile = "";
  let kubeconfig = "";
  let frame: Frame;
  let before: cluster.ClusterSnapshot;

  // Every start after the first finds the profile of the one before. Each step has its time and its
  // name: the one that does not end is the one the case reports.
  const restart = async (change?: () => Promise<void>) => {
    const running = started;

    started = undefined;
    await velero.within("The end of the application", 90_000, running?.close() ?? Promise.resolve());
    await change?.();
    started = await velero.within("The start of the application", 180_000, velero.startIsolated(profile));
    await velero.leaveWelcome(started.window);
    await velero.navigateToCatalog(started.app);
    // The catalog of a start that finds a profile holds the test cluster and nothing else, as the first did.
    await started.window.waitForSelector(`div.TableCell >> text='${cluster.E2E_KUBE_CONTEXT}'`, { timeout: 180_000 });
    expect(await velero.catalogClusterCount(started.window)).toBe(1);
    frame = await cluster.openClusterFromCatalog(started.window, kubeconfig);
    await cluster.openBackups(frame);
  };

  beforeAll(async () => {
    if (!cluster.fixturesReady()) {
      throw new Error(`The fixtures are missing from ${cluster.E2E_CLUSTER_NAME}. Run \`pnpm demo:up\` first.`);
    }
    before = cluster.clusterSnapshot();
    started = await velero.startIsolated();
    profile = started.directory;
    kubeconfig = await cluster.publishKubeconfig();
    await utils.clickWelcomeButton(started.window);
    await velero.installExtension(started.app, started.window);
    await velero.dismissNotifications(started.window);
    await velero.navigateToCatalog(started.app);
    expect(await velero.catalogClusterCount(started.window)).toBe(1);
    frame = await cluster.openClusterFromCatalog(started.window, kubeconfig);
    await cluster.openBackups(frame);
  }, TIMEOUT);

  afterAll(async () => {
    await started?.cleanup();
  }, TIMEOUT);

  it(
    "keeps the namespace that was configured, the one that was chosen and the window, and nothing of the cluster",
    async () => {
      await frame.waitForSelector("[data-testid=velero-state-choose]", { timeout: 60_000 });
      await cluster.configureInstallation(frame, cluster.E2E_SCALE_NAMESPACE);
      await cluster.waitForBackups(frame);
      await cluster.selectInstallation(frame, cluster.E2E_STATIC_NAMESPACE);
      await cluster.expectRow(frame, "backup-completed", "Completed");
      // The window of the recent operations is seven days until one is chosen, on the Overview.
      await cluster.openPage(frame, cluster.OVERVIEW);
      expect((await cluster.overview(frame)).window).toBe("7d");
      await cluster.chooseWindow(frame, "30d");
      await cluster.openBackups(frame);
      // The host writes the store when what it holds changes: a moment for the file.
      await frame.waitForTimeout(3000);
      const stored = await velero.storedPreferences(profile);

      expect(stored).toHaveLength(1);
      const { __internal__: _host, ...kept } = stored[0].content as Record<string, unknown>;
      const identifier = cluster.clusterEntityId(kubeconfig, cluster.E2E_KUBE_CONTEXT);

      expect(kept).toEqual({
        selected: { [identifier]: cluster.E2E_STATIC_NAMESPACE },
        configured: { [identifier]: [cluster.E2E_SCALE_NAMESPACE] },
        window: "30d",
      });
      const text = await readFile(path.join(profile, stored[0].file), "utf8");

      expect(text).not.toMatch(/token|client-key|certificate|BEGIN |password|secret|resourceVersion|"uid"|write/i);
      expect(text).not.toContain("backup-completed");
    },
    TIMEOUT,
  );

  it(
    "finds the choice at the next start, and reads the namespace without asking again",
    async () => {
      await restart();
      await cluster.waitForBackups(frame);
      expect(await cluster.entryState(frame)).toBe("velero-backups");
      expect((await cluster.target(frame)).namespace).toBe(cluster.E2E_STATIC_NAMESPACE);
      await cluster.expectRow(frame, "backup-completed", "Completed");
      await frame.click("[data-testid=velero-target] .Select__control");
      const options = (await frame.locator(".Select__option").allInnerTexts()).map((text) => text.trim());

      expect(options).toEqual(
        [...cluster.SUGGESTED_NAMESPACES.filter(Boolean), `${cluster.E2E_SCALE_NAMESPACE} (configured)`].sort(),
      );
      await started?.window.keyboard.press("Escape");
      // The window is the one that was chosen before the application was closed.
      await cluster.openPage(frame, cluster.OVERVIEW);
      expect((await cluster.overview(frame)).window).toBe("30d");
      await cluster.openBackups(frame);
    },
    TIMEOUT,
  );

  it(
    "keeps a namespace that is not there any more selected, and does not take another in its place",
    async () => {
      // Between two starts the file says that the namespace selected is one that is not in the cluster.
      await restart(async () => {
        const [stored] = await velero.storedPreferences(profile);
        const content = stored.content as { selected: Record<string, string> };
        const identifier = cluster.clusterEntityId(kubeconfig, cluster.E2E_KUBE_CONTEXT);

        await writeFile(
          path.join(profile, stored.file),
          JSON.stringify({ ...content, selected: { ...content.selected, [identifier]: REMOVED } }),
          { mode: 0o600 },
        );
      });
      await frame.waitForSelector("[data-testid=velero-notice-stale-selection]", { timeout: 60_000 });
      expect((await cluster.target(frame)).namespace).toBe(`${REMOVED} (not found)`);
      expect((await cluster.notices(frame))["stale-selection"]).toContain(REMOVED);
      // No backup of another installation is shown in its place.
      expect(await cluster.mountedBackups(frame)).toEqual([]);
      expect(await cluster.layoutProblems(frame)).toEqual([]);
      await cluster.captureScreenshot(frame, "dark-selection-not-found");
      // The operator chooses another one, and that is the one kept.
      await cluster.selectInstallation(frame, cluster.E2E_VIEWS_NAMESPACE);
      await cluster.expectRow(frame, "views-daily-20260901030000", "Completed");
      expect(await frame.locator("[data-testid=velero-notice-stale-selection]").count()).toBe(0);
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
