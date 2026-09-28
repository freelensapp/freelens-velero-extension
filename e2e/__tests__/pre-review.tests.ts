/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

// The pass before the review of a milestone: the views in both themes, at
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
const RESTORES = cluster.RESTORES;
const RESTORED = "restore-mapped";
const LONG_RESTORE = cluster.LONG_RESTORE_NAME;
// The views that are checked, each in both themes at every size.
const VIEWS = 16;
const SCHEDULES = cluster.SCHEDULES;
const SCHEDULED = "views-history";

describe("pre-review of the views", () => {
  let started: velero.StartedApplication;
  let frame: Frame;
  let before: cluster.ClusterSnapshot;
  const problems: Record<string, string[]> = {};
  const screenshots: string[] = [];

  // Every theme at every size: the view is set by the caller, and is what is checked and captured. A
  // layout is checked once the theme, the size and the zoom are the ones that were set: one that was
  // not applied would be the layout before it, checked twice.
  const everyLayout = async (view: string, prepare?: () => Promise<void>, of = cluster.BACKUPS) => {
    for (const theme of THEMES) {
      await velero.setColorTheme(started.app, started.window, theme);
      for (const size of SIZES) {
        const expected = {
          theme: theme.toLowerCase(),
          width: Math.round(size.width / size.zoom),
          height: Math.round(size.height / size.zoom),
        };

        await velero.setWindowSize(started.app, size.width, size.height);
        await velero.setZoom(started.app, size.zoom);
        expect([view, size.name, await cluster.appliedLike(frame, expected)]).toEqual([view, size.name, expected]);
        await frame.waitForTimeout(1000);
        await prepare?.();
        const name = `${theme.toLowerCase()}-${size.name}-${view}`;

        problems[name] = await cluster.layoutProblems(frame, of);
        screenshots.push(await cluster.requiredScreenshot(frame, name, size.zoom));
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
      expect(await cluster.focusOn(frame, "velero-back")).toBe("velero-back");
      await started.window.keyboard.press("Escape");
      await frame.waitForSelector("[data-testid=velero-backup-workspace]", { state: "detached", timeout: 60_000 });
      expect(await cluster.focusOn(frame, OPENED)).toBe(OPENED);
      // The same with the way back, which is where the focus starts from.
      await started.window.keyboard.press("Enter");
      await frame.waitForSelector(`[data-testid=velero-backup-workspace] >> text="${OPENED}"`, { timeout: 60_000 });
      expect(await cluster.focusOn(frame, "velero-back")).toBe("velero-back");
      await started.window.keyboard.press("Enter");
      await frame.waitForSelector("[data-testid=velero-backup-workspace]", { state: "detached", timeout: 60_000 });
      expect(await cluster.focusOn(frame, OPENED)).toBe(OPENED);
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
    "shows the list of the restores in both themes, at every size",
    async () => {
      await cluster.showList(frame);
      await cluster.openPage(frame, RESTORES);
      await cluster.waitForList(frame, RESTORES);
      expect((await cluster.target(frame)).namespace).toBe(cluster.E2E_VIEWS_NAMESPACE);
      await everyLayout("restores", undefined, RESTORES);
      expect(found("restores")).toEqual({});
    },
    TIMEOUT,
  );

  it(
    "shows a restore with names as long as they can be without covering what is beside them",
    async () => {
      await cluster.showList(frame);
      // The row of the restore, with the name of its backup in the source, is in the list that was checked.
      const cells = await cluster.cellsOf(RESTORES, frame, LONG_RESTORE);

      expect(LONG_RESTORE).toHaveLength(63);
      expect(cells.name).toBe(LONG_RESTORE);
      expect(cells.source).toHaveLength(63);
      await cluster.openWorkspace(frame, LONG_RESTORE, RESTORES);
      expect(await frame.locator("[data-testid=velero-restore-name]").innerText()).toBe(LONG_RESTORE);
      await everyLayout("long-restore-workspace", undefined, RESTORES);
      await everyLayout(
        "long-restore-workspace-into",
        async () => {
          await frame.locator("[data-testid=velero-restore-mappings]").scrollIntoViewIfNeeded();
        },
        RESTORES,
      );
      // The names of the namespaces it maps are whole, in the two themes and at every size.
      const mapping = (await frame.locator("[data-testid=velero-restore-mappings] tbody td").allInnerTexts()).map(
        (text) => text.trim(),
      );

      expect(mapping.map((name) => name.length)).toEqual([63, 63]);
      await cluster.closeWorkspace(frame);
      expect(found("long-restore-workspace")).toEqual({});
      expect(found("long-restore-workspace-into")).toEqual({});
    },
    TIMEOUT,
  );

  it(
    "opens a restore, follows it to its backup and comes back with the keyboard alone",
    async () => {
      await cluster.showList(frame);
      await frame.locator("[data-testid=velero-refresh]").focus();
      await cluster.tabTo(frame, (focus) => focus === RESTORED, 60);
      await started.window.keyboard.press("Enter");
      await frame.waitForSelector(`[data-testid=velero-restore-name] >> text="${RESTORED}"`, { timeout: 60_000 });
      expect(await cluster.focusOn(frame, "velero-back")).toBe("velero-back");
      // From the way back to the way to the backup, which is the next thing the keyboard reaches.
      await cluster.tabTo(frame, (focus) => focus.startsWith("velero-open-backup-"), 5);
      await started.window.keyboard.press("Enter");
      await frame.waitForSelector("[data-testid=velero-backup-workspace]", { timeout: 60_000 });
      expect(await cluster.focusOn(frame, "velero-back")).toBe("velero-back");
      expect((await cluster.shownView(frame))?.back).toBe(`arrow_back Restores / ${RESTORED}`);
      await started.window.keyboard.press("Escape");
      await frame.waitForSelector(`[data-testid=velero-restore-name] >> text="${RESTORED}"`, { timeout: 60_000 });
      expect(await cluster.focusOn(frame, "velero-back")).toBe("velero-back");
      await started.window.keyboard.press("Escape");
      await frame.waitForSelector("[data-testid=velero-restore-workspace]", { state: "detached", timeout: 60_000 });
      expect(await cluster.focusOn(frame, RESTORED)).toBe(RESTORED);
      // Escape is heard from a text of the view that was clicked, which is not a control.
      await started.window.keyboard.press("Enter");
      await frame.waitForSelector(`[data-testid=velero-restore-name] >> text="${RESTORED}"`, { timeout: 60_000 });
      await frame.locator("[data-testid=velero-restore-name]").click();
      await started.window.keyboard.press("Escape");
      await frame.waitForSelector("[data-testid=velero-restore-workspace]", { state: "detached", timeout: 60_000 });
      expect(await cluster.focusOn(frame, RESTORED)).toBe(RESTORED);
    },
    TIMEOUT,
  );

  it(
    "shows the workspace of a restore in both themes, at every size",
    async () => {
      await cluster.showList(frame);
      await cluster.openWorkspace(frame, RESTORED, RESTORES);
      await everyLayout("restore-workspace", undefined, RESTORES);
      await everyLayout(
        "restore-workspace-into",
        async () => {
          await frame.locator("[data-testid=velero-restore-mappings]").scrollIntoViewIfNeeded();
        },
        RESTORES,
      );
      await everyLayout(
        "restore-workspace-scope",
        async () => {
          await frame.locator("[data-testid=velero-restore-scope]").scrollIntoViewIfNeeded();
        },
        RESTORES,
      );
      await cluster.closeWorkspace(frame);
      expect(found("restore-workspace")).toEqual({});
      expect(found("restore-workspace-into")).toEqual({});
      expect(found("restore-workspace-scope")).toEqual({});
    },
    TIMEOUT,
  );

  it(
    "shows the list of the schedules in both themes, at every size",
    async () => {
      await cluster.showList(frame);
      await cluster.openPage(frame, SCHEDULES);
      await cluster.waitForList(frame, SCHEDULES);
      await everyLayout("schedules", undefined, SCHEDULES);
      expect(found("schedules")).toEqual({});
    },
    TIMEOUT,
  );

  it(
    "reads the history of a schedule with the keyboard alone: its line of time, mark by mark, and its list",
    async () => {
      await cluster.showList(frame);
      await frame.locator("[data-testid=velero-refresh]").focus();
      await cluster.tabTo(frame, (focus) => focus === SCHEDULED, 80);
      await started.window.keyboard.press("Enter");
      await frame.waitForSelector(`[data-testid=velero-schedule-name] >> text="${SCHEDULED}"`, { timeout: 60_000 });
      expect(await cluster.focusOn(frame, "velero-back")).toBe("velero-back");
      // After the way back and the newest backup, the marks of the line, from the oldest, one press each.
      const reached: string[] = [];
      const line = await cluster.history(frame);

      // Each day of the history has its mark: what is expected below is of an environment that is not old.
      expect(cluster.dayOnTheLine(line.width)).toBeGreaterThan(2 * cluster.MARK_WIDTH);
      for (let presses = 0; presses < 12 && reached.length < 7; presses += 1) {
        await started.window.keyboard.press("Tab");
        const mark = await frame.evaluate(() => document.activeElement?.getAttribute("data-strip-mark") ?? "");

        if (mark) {
          reached.push(mark);
          // What a mark is, is said to who does not see it.
          expect(await frame.evaluate(() => document.activeElement?.getAttribute("aria-label") ?? "")).toContain(
            mark.split(",")[0],
          );
        }
      }
      expect(reached).toEqual((await cluster.history(frame)).marks);
      expect(reached).toHaveLength(7);
      // The mark that holds two backups shows them alone in the list, and the next press goes on along the line.
      await frame.locator('[data-strip-mark="views-history-3-again,views-history-3"]').focus();
      await started.window.keyboard.press("Enter");
      expect((await cluster.history(frame)).rows).toEqual(["views-history-3-again", "views-history-3"]);
      await started.window.keyboard.press("Enter");
      expect((await cluster.history(frame)).rows).toHaveLength(8);
      // A mark of one backup opens it, and Escape comes back to the schedule.
      await frame.locator('[data-strip-mark="views-history-6"]').focus();
      await started.window.keyboard.press("Enter");
      await frame.waitForSelector('[data-testid=velero-backup-name] >> text="views-history-6"', { timeout: 60_000 });
      await started.window.keyboard.press("Escape");
      await frame.waitForSelector(`[data-testid=velero-schedule-name] >> text="${SCHEDULED}"`, { timeout: 60_000 });
      await started.window.keyboard.press("Escape");
      await frame.waitForSelector("[data-testid=velero-schedule-workspace]", { state: "detached", timeout: 60_000 });
      expect(await cluster.focusOn(frame, SCHEDULED)).toBe(SCHEDULED);
    },
    TIMEOUT,
  );

  it(
    "shows the workspace of a schedule, its history and its template in both themes, at every size",
    async () => {
      await cluster.showList(frame);
      await cluster.openWorkspace(frame, SCHEDULED, SCHEDULES);
      await everyLayout("schedule-workspace", undefined, SCHEDULES);
      await everyLayout(
        "schedule-workspace-history",
        async () => {
          await frame.locator("[data-testid=velero-history-strip]").scrollIntoViewIfNeeded();
          // At every width each backup is on the line, in a mark of its own or with the ones close to it.
          const shown = await cluster.history(frame);

          expect(cluster.backupsOnTheLine(shown.marks)).toEqual([...shown.rows].reverse());
          // No mark is drawn over another, at whatever width.
          expect(shown.over).toEqual([]);
        },
        SCHEDULES,
      );
      await everyLayout(
        "schedule-workspace-template",
        async () => {
          await frame.locator("[data-testid=velero-schedule-template]").scrollIntoViewIfNeeded();
        },
        SCHEDULES,
      );
      await cluster.closeWorkspace(frame);
      expect(found("schedule-workspace")).toEqual({});
      expect(found("schedule-workspace-history")).toEqual({});
      expect(found("schedule-workspace-template")).toEqual({});
    },
    TIMEOUT,
  );

  it(
    "leaves the objects of Velero as they were",
    async () => {
      const after = cluster.clusterSnapshot();

      await cluster.writeReport("pre-review-layout", problems);
      expect(Object.keys(problems)).toHaveLength(THEMES.length * SIZES.length * VIEWS);
      // A picture of every view was written, each under a name of its own.
      expect(new Set(screenshots).size).toBe(THEMES.length * SIZES.length * VIEWS);
      expect(after.versions).toEqual(before.versions);
      expect(after.installed).toEqual(before.installed);
      expect(after.requests).toBe(0);
    },
    TIMEOUT,
  );
});
