/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

// The gate of the writes: off when the session starts, on for one installation of
// one cluster through the dialog of the host that names the cluster, its context
// and the namespace, off again when another installation is selected and when the
// application is started again, each frame of a cluster with a gate of its own, and
// nothing written to the cluster by any of it.

import { readFile, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { expect } from "@jest/globals";
import * as cluster from "../helpers/velero-cluster";
import * as velero from "../helpers/velero-extension";

import type { Frame } from "playwright";

const TIMEOUT = 10 * 60 * 1000;
const SECOND_CONTEXT = "velero-e2e-second";

describe("the gate of the writes", () => {
  let started: velero.StartedApplication | undefined;
  let profile = "";
  let kubeconfig = "";
  let frame: Frame;
  let before: cluster.ClusterSnapshot;
  let counted: Record<string, number>;

  // What the target bar says of the writes: the words, and whether they are on.
  const writesState = async (within: Frame) => ({
    state: (await within.locator("[data-testid=velero-writes-state]").innerText()).trim(),
    on: (await within.locator("[data-testid=velero-writes]").getAttribute("data-writes")) === "on",
  });
  const turnOn = async (within: Frame) => {
    await within.click("[data-testid=velero-writes-on]");
    const dialog = within.locator("[data-testid=confirmation-dialog]");

    await dialog.waitFor({ state: "visible", timeout: 60_000 });
    await dialog.locator("[data-testid=confirm]").click();
    await within.waitForSelector("[data-testid=velero-writes][data-writes=on]", { timeout: 60_000 });
  };

  beforeAll(async () => {
    if (!cluster.fixturesReady()) {
      throw new Error(`The fixtures are missing from ${cluster.E2E_CLUSTER_NAME}. Run \`pnpm demo:up\` first.`);
    }
    before = cluster.clusterSnapshot();
    counted = cluster.apiRequests();
    started = await velero.startWithExtension();
    profile = started.directory;
    kubeconfig = await cluster.publishKubeconfig();
    await velero.dismissNotifications(started.window);
    await velero.navigateToCatalog(started.app);
    expect(await velero.catalogClusterCount(started.window)).toBe(1);
    frame = await cluster.openClusterFromCatalog(started.window, kubeconfig);
    await velero.setWindowSize(started.app, 1440, 900);
  }, TIMEOUT);

  afterAll(async () => {
    await started?.cleanup();
  }, TIMEOUT);

  it(
    "says that writes are off when the session starts, on every page of the group",
    async () => {
      await cluster.openBackups(frame);
      await cluster.selectInstallation(frame, cluster.E2E_NAMESPACE);
      await cluster.waitForBackups(frame);
      await frame.waitForSelector("[data-testid=velero-writes-on]", { timeout: 60_000 });
      expect(await writesState(frame)).toEqual({ state: "Off", on: false });
      await cluster.openPage(frame, cluster.RESTORES);
      await frame.waitForSelector("[data-testid=velero-writes-on]", { timeout: 60_000 });
      expect(await writesState(frame)).toEqual({ state: "Off", on: false });
      expect(await cluster.layoutProblems(frame, cluster.RESTORES)).toEqual([]);
      await cluster.captureScreenshot(frame, "dark-gate-off");
    },
    TIMEOUT,
  );

  it(
    "turns writes on through the dialog of the host, which names the cluster, its context and the namespace",
    async () => {
      await frame.click("[data-testid=velero-writes-on]");
      const dialog = frame.locator("[data-testid=confirmation-dialog]");

      await dialog.waitFor({ state: "visible", timeout: 60_000 });
      const words = (await dialog.innerText()).replace(/\s+/g, " ");

      expect(words).toContain(`installation ${cluster.E2E_NAMESPACE} of the cluster ${cluster.E2E_KUBE_CONTEXT}`);
      expect(words).toContain(`context ${cluster.E2E_KUBE_CONTEXT}`);
      expect(words).toContain("DownloadRequest");
      expect(words).toContain("ServerStatusRequest");
      expect(words).toContain("Turn writes on");
      await cluster.captureScreenshot(frame, "dark-gate-dialog");
      // Nothing is on before the dialog is answered.
      expect(await writesState(frame)).toEqual({ state: "Off", on: false });
      await dialog.locator("[data-testid=confirm]").click();
      await frame.waitForSelector("[data-testid=velero-writes][data-writes=on]", { timeout: 60_000 });
      const shown = await writesState(frame);

      expect(shown.on).toBe(true);
      expect(shown.state).toContain(`On for ${cluster.E2E_NAMESPACE} since`);
      // On every page of the group.
      await cluster.openPage(frame, cluster.SCHEDULES);
      await frame.waitForSelector("[data-testid=velero-writes][data-writes=on]", { timeout: 60_000 });
      expect((await writesState(frame)).state).toContain(`On for ${cluster.E2E_NAMESPACE} since`);
      expect(await cluster.layoutProblems(frame, cluster.SCHEDULES)).toEqual([]);
      await cluster.captureScreenshot(frame, "dark-gate-on");
    },
    TIMEOUT,
  );

  it(
    "turns writes off when another installation is selected, and does not turn them on again by itself",
    async () => {
      await cluster.selectInstallation(frame, cluster.E2E_STATIC_NAMESPACE);
      await frame.waitForSelector("[data-testid=velero-writes][data-writes=off]", { timeout: 60_000 });
      expect(await writesState(frame)).toEqual({ state: "Off", on: false });
      await cluster.selectInstallation(frame, cluster.E2E_NAMESPACE);
      await frame.waitForSelector("[data-testid=velero-writes-on]", { timeout: 60_000 });
      expect(await writesState(frame)).toEqual({ state: "Off", on: false });
      await frame.click("[data-testid=velero-writes-on]");
      await frame.locator("[data-testid=confirmation-dialog]").waitFor({ state: "visible", timeout: 60_000 });
      // The dialog left alone leaves writes off.
      await frame.locator("[data-testid=confirmation-dialog] button").filter({ hasText: "Keep writes off" }).click();
      await frame.locator("[data-testid=confirmation-dialog]").waitFor({ state: "hidden", timeout: 60_000 });
      expect(await writesState(frame)).toEqual({ state: "Off", on: false });
      await turnOn(frame);
      await frame.click("[data-testid=velero-writes-off]");
      await frame.waitForSelector("[data-testid=velero-writes][data-writes=off]", { timeout: 60_000 });
      expect(await writesState(frame)).toEqual({ state: "Off", on: false });
    },
    TIMEOUT,
  );

  it(
    "gives every frame of a cluster a gate of its own",
    async () => {
      if (!started) throw new Error("The application is not running");
      await turnOn(frame);
      // A second entry of the catalog: the same cluster through the kubeconfig of the reader, under a
      // context of another name, which is another frame of the same window.
      const source = JSON.parse(await readFile(cluster.readerKubeconfigPath(), "utf8")) as {
        contexts?: { name: string }[];
        "current-context"?: string;
      };

      for (const context of source.contexts ?? []) context.name = SECOND_CONTEXT;
      source["current-context"] = SECOND_CONTEXT;
      const renamed = path.join(profile, "second-kubeconfig.json");

      await writeFile(renamed, JSON.stringify(source), { mode: 0o600 });
      const second = await cluster.publishKubeconfig(renamed, "velero-e2e-second");

      await velero.navigateToCatalog(started.app);
      await started.window.waitForSelector(`div.TableCell >> text='${SECOND_CONTEXT}'`, { timeout: 60_000 });
      const other = await cluster.openClusterFromCatalog(started.window, second, SECOND_CONTEXT);

      await cluster.openBackups(other);
      await cluster.configureInstallation(other, cluster.E2E_VIEWS_NAMESPACE);
      await other.waitForSelector("[data-testid=velero-writes-on]", { timeout: 60_000 });
      expect(await writesState(other)).toEqual({ state: "Off", on: false });
      // The first frame keeps its own.
      await velero.navigateToCatalog(started.app);
      frame = await cluster.openClusterFromCatalog(started.window, kubeconfig);
      await frame.waitForSelector("[data-testid=velero-writes]", { timeout: 60_000 });
      expect((await writesState(frame)).on).toBe(true);
    },
    TIMEOUT,
  );

  it(
    "turns writes off when the application is started again, and keeps nothing of the gate in its store",
    async () => {
      const running = started;

      started = undefined;
      await velero.within("The end of the application", 90_000, running?.close() ?? Promise.resolve());
      started = await velero.within("The start of the application", 180_000, velero.startIsolated(profile));
      await velero.leaveWelcome(started.window);
      await velero.navigateToCatalog(started.app);
      await started.window.waitForSelector(`div.TableCell >> text='${cluster.E2E_KUBE_CONTEXT}'`, { timeout: 180_000 });
      frame = await cluster.openClusterFromCatalog(started.window, kubeconfig);
      await cluster.openBackups(frame);
      await frame.waitForSelector("[data-testid=velero-writes-on]", { timeout: 60_000 });
      expect(await writesState(frame)).toEqual({ state: "Off", on: false });
      const stored = await velero.storedPreferences(profile);

      expect(stored.length).toBeGreaterThan(0);
      for (const { content } of stored) {
        expect(JSON.stringify(content)).not.toMatch(/writes|gate|token|confirmation|enabled/i);
      }
    },
    TIMEOUT,
  );

  it(
    "wrote nothing to the cluster",
    async () => {
      const after = cluster.apiRequests();

      expect(cluster.writes(cluster.counted(counted, after))).toEqual({});
      expect(cluster.clusterSnapshot()).toEqual(before);
    },
    TIMEOUT,
  );
});
