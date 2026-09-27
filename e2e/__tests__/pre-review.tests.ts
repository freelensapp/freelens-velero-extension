/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

// The pass before the review of the milestone: the views in both themes, at
// the two sizes of the window and at twice the zoom, and the journey with the
// keyboard alone. Every view is checked for what lies over something else or
// does not fit, and is left as a screenshot of the frame of the test cluster.

import { expect } from "@jest/globals";
import * as utils from "../helpers/utils";
import * as cluster from "../helpers/velero-cluster";
import * as velero from "../helpers/velero-extension";

import type { Frame } from "playwright";

const TIMEOUT = 15 * 60 * 1000;
const THEMES: velero.ColorTheme[] = ["Dark", "Light"];
const SIZES = [
  { name: "1440x900", width: 1440, height: 900, zoom: 1 },
  { name: "900x650", width: 900, height: 650, zoom: 1 },
  { name: "1440x900-zoom-200", width: 1440, height: 900, zoom: 2 },
];
const OPENED = "backup-finalizingpartiallyfailed";

describe("pre-review of the first milestone", () => {
  let started: velero.StartedApplication;
  let frame: Frame;
  let before: cluster.ClusterSnapshot;
  const problems: Record<string, string[]> = {};

  // Every theme at every size: the view is set by the caller, and is what is checked and captured.
  const everyLayout = async (view: string, prepare?: () => Promise<void>) => {
    for (const theme of THEMES) {
      await velero.setColorTheme(started.app, started.window, theme);
      for (const size of SIZES) {
        await velero.setWindowSize(started.app, size.width, size.height);
        await velero.setZoom(started.app, size.zoom);
        await frame.waitForTimeout(1500);
        await prepare?.();
        const name = `${theme.toLowerCase()}-${size.name}-${view}`;

        problems[name] = await cluster.layoutProblems(frame);
        await cluster.captureScreenshot(frame, name, size.zoom);
      }
    }
    await velero.setZoom(started.app, 1);
    await velero.setWindowSize(started.app, 1440, 900);
    await velero.setColorTheme(started.app, started.window, "Dark");
    await frame.waitForTimeout(1000);
  };
  const found = (view: string) =>
    Object.fromEntries(
      Object.entries(problems).filter(
        ([name, list]) => SIZES.some((size) => name.endsWith(`-${size.name}-${view}`)) && list.length > 0,
      ),
    );

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
    await cluster.openBackups(frame);
  }, TIMEOUT);

  afterAll(async () => {
    await velero.setZoom(started.app, 1).catch(() => undefined);
    await started?.cleanup();
  }, TIMEOUT);

  it(
    "shows the choice of the installation in both themes, at every size",
    async () => {
      await frame.waitForSelector("[data-testid=velero-state-choose]", { timeout: 60_000 });
      await everyLayout("choose");
      expect(found("choose")).toEqual({});
    },
    TIMEOUT,
  );

  it(
    "chooses an installation with the keyboard alone",
    async () => {
      await frame.locator("[data-testid=velero-refresh]").focus();
      const presses = await cluster.tabTo(frame, (focus) => focus === `velero-choice-${cluster.E2E_STATIC_NAMESPACE}`);

      expect(presses).toBeLessThanOrEqual(cluster.SUGGESTED_NAMESPACES.length);
      await started.window.keyboard.press("Enter");
      await cluster.waitForBackups(frame);
      expect((await cluster.target(frame)).namespace).toBe(cluster.E2E_STATIC_NAMESPACE);
    },
    TIMEOUT,
  );

  it(
    "shows the list of the backups in both themes, at every size",
    async () => {
      await cluster.showList(frame);
      await everyLayout("backups");
      expect(found("backups")).toEqual({});
    },
    TIMEOUT,
  );

  it(
    "opens a backup and comes back with the keyboard alone, and finds the focus where it was",
    async () => {
      await cluster.showList(frame);
      await frame.locator("[data-testid=velero-refresh]").focus();
      // From the target bar to the list: the search, the headers of the columns, and the rows by their names.
      await cluster.tabTo(frame, (focus) => focus === "backup-completed");
      await cluster.tabTo(frame, (focus) => focus === OPENED, 20);
      await started.window.keyboard.press("Enter");
      await frame.waitForSelector(`[data-testid=velero-backup-workspace] >> text="${OPENED}"`, { timeout: 60_000 });
      expect(await cluster.focused(frame)).toBe("velero-back");
      await started.window.keyboard.press("Escape");
      await frame.waitForSelector("[data-testid=velero-backup-workspace]", { state: "detached", timeout: 60_000 });
      expect(await cluster.focused(frame)).toBe(OPENED);
      // The same with the way back, which is where the focus starts from.
      await started.window.keyboard.press("Enter");
      await frame.waitForSelector(`[data-testid=velero-backup-workspace] >> text="${OPENED}"`, { timeout: 60_000 });
      await started.window.keyboard.press("Enter");
      await frame.waitForSelector("[data-testid=velero-backup-workspace]", { state: "detached", timeout: 60_000 });
      expect(await cluster.focused(frame)).toBe(OPENED);
      // The selector of the installation answers to the keyboard as well.
      await frame.locator("#velero-installation").focus();
      await started.window.keyboard.press("ArrowDown");
      await frame.waitForSelector(".Select__option", { timeout: 60_000 });
      await started.window.keyboard.press("Escape");
      expect((await cluster.target(frame)).namespace).toBe(cluster.E2E_STATIC_NAMESPACE);
    },
    TIMEOUT,
  );

  it(
    "shows the workspace of a backup in both themes, at every size",
    async () => {
      await cluster.showList(frame);
      await cluster.openWorkspace(frame, OPENED);
      await everyLayout("workspace");
      await everyLayout("workspace-references", async () => {
        await frame.locator("[data-testid=velero-backup-references]").scrollIntoViewIfNeeded();
      });
      await cluster.closeWorkspace(frame);
      expect(found("workspace")).toEqual({});
      expect(found("workspace-references")).toEqual({});
    },
    TIMEOUT,
  );

  it(
    "shows a name as long as a name can be without covering what is beside it",
    async () => {
      await cluster.showList(frame);
      await cluster.selectInstallation(frame, cluster.E2E_VIEWS_NAMESPACE);
      await cluster.waitForBackups(frame);
      await everyLayout("long-name");
      const long = (await cluster.mountedBackups(frame)).find((name) => name.length === 63) ?? "";

      expect(long).not.toBe("");
      await cluster.openWorkspace(frame, long);
      await everyLayout("long-name-workspace");
      await cluster.closeWorkspace(frame);
      expect(found("long-name")).toEqual({});
      expect(found("long-name-workspace")).toEqual({});
    },
    TIMEOUT,
  );

  it(
    "leaves the objects of Velero as they were",
    async () => {
      const after = cluster.clusterSnapshot();

      await cluster.writeReport("pre-review-layout", problems);
      expect(Object.keys(problems)).toHaveLength(THEMES.length * SIZES.length * 6);
      expect(after.versions).toEqual(before.versions);
      expect(after.installed).toEqual(before.installed);
      expect(after.requests).toBe(0);
    },
    TIMEOUT,
  );
});
