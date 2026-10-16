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
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as cluster from "../../integration/helpers/velero-cluster";
import * as velero from "../../integration/helpers/velero-extension";

import type { Frame } from "playwright";

const TIMEOUT = 10 * 60 * 1000;
const SECOND_CONTEXT = "velero-e2e-second";

describe("the gate of the writes", () => {
  let started: velero.StartedApplication | undefined;
  let profile = "";
  let kubeconfig = "";
  let frame: Frame;
  // The frame of the second entry of the catalog, and the path of its kubeconfig.
  let other: Frame | undefined;
  let second = "";
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
      throw new Error(cluster.fixturesMissing());
    }
    before = cluster.clusterSnapshot();
    counted = cluster.apiRequests();
    // The kubeconfig is in the profile before the install is asked, for each start of the application.
    started = await velero.startWithExtension(async () => {
      kubeconfig = await cluster.publishKubeconfig();
    });
    profile = started.directory;
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
      second = await cluster.publishKubeconfig(renamed, "velero-e2e-second");
      await velero.navigateToCatalog(started.app);
      await started.window.waitForSelector(`div.TableCell >> text='${SECOND_CONTEXT}'`, { timeout: 60_000 });
      other = await cluster.openClusterFromCatalog(started.window, second, SECOND_CONTEXT);

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
    "binds every request to the frame it comes from, by the address of the frame that a handler of the main process reads",
    async () => {
      if (!started || !other) throw new Error("The application or the frame of the second entry is not there");
      const { app, window } = started;
      const port = new URL(window.url()).port;
      const firstId = cluster.clusterEntityId(kubeconfig, cluster.E2E_KUBE_CONTEXT);
      const secondId = cluster.clusterEntityId(second, SECOND_CONTEXT);

      // Each frame is the frame of its cluster, by the identifier of its address, which both catalogs give it.
      expect([cluster.frameClusterId(frame), cluster.frameClusterId(other)]).toEqual([firstId, secondId]);
      const byId = (one: { id: string }, other: { id: string }) => one.id.localeCompare(other.id);

      expect(
        (await velero.mainCatalog(app)).map(({ id, contextName, status }) => ({ id, contextName, status })).sort(byId),
      ).toEqual(
        [
          { id: firstId, contextName: cluster.E2E_KUBE_CONTEXT, status: "connected" },
          { id: secondId, contextName: SECOND_CONTEXT, status: "connected" },
        ].sort(byId),
      );
      // The handlers of the twelve procedures the frames call, as the host registered them in the main process,
      // are watched there; each frame asks the state of its gate when a page of the group opens.
      const channels = await velero.watchHandlers(app);

      expect(channels.map((channel) => channel.slice(channel.indexOf(":") + 1)).sort()).toEqual([
        "allowance.grant",
        "allowance.revoke",
        "artifact.page",
        "artifact.release",
        "artifact.save",
        "gate.disable",
        "gate.enable",
        "gate.state",
        "write.cancel",
        "write.confirm",
        "write.run",
        "write.status",
      ]);
      try {
        await cluster.openPage(frame, cluster.RESTORES);
        await frame.waitForSelector("[data-testid=velero-writes][data-writes=on]", { timeout: 60_000 });
        await velero.navigateToCatalog(app);
        other = await cluster.openClusterFromCatalog(window, second, SECOND_CONTEXT);
        await cluster.openPage(other, cluster.RESTORES);
        await other.waitForSelector("[data-testid=velero-writes-on]", { timeout: 60_000 });
        expect(await writesState(other)).toEqual({ state: "Off", on: false });
        // A request of the frame of the second entry that names the cluster of the first one, sent to the same
        // channel as the extension sends it: the handler reads the frame it came from, and refuses it.
        const state = channels.find((channel) => channel.endsWith(":gate.state")) ?? "";
        const forged = await other.evaluate(
          async ({ channel, cluster: named }) => {
            const { ipcRenderer } = (
              globalThis as unknown as {
                require: (name: string) => { ipcRenderer: { invoke: (...args: unknown[]) => Promise<unknown> } };
              }
            ).require("electron");

            return ipcRenderer.invoke(channel, { cluster: named });
          },
          { channel: state, cluster: firstId },
        );

        expect(forged).toMatchObject({ ok: false, code: "forbidden", stage: "frame" });
        const handled = await velero.handledRequests(app);
        const of = (id: string) => handled.filter((request) => new URL(request.address).hostname.startsWith(`${id}.`));
        const keys = (requests: velero.HandledRequest[]) => [
          ...new Set(requests.map(({ processId, frameId }) => `${processId}:${frameId}`)),
        ];

        // Every request came from the address of a frame of a cluster of v2, with the port of the window.
        expect(
          handled.filter(({ address }) => {
            const { hostname, protocol, port: at } = new URL(address);

            return protocol !== "https:" || !/^[0-9a-f]{32}\.renderer\.freelens\.app$/.test(hostname) || at !== port;
          }),
        ).toEqual([]);
        // The frame of the first entry asked for its own cluster, which the main process answered with writes on.
        expect(of(firstId).filter(({ channel }) => channel === "gate.state").length).toBeGreaterThan(0);
        for (const request of of(firstId)) {
          expect(request).toMatchObject({ named: firstId, answer: "ok" });
          if (request.state) expect(request.state).toEqual({ cluster: firstId, on: true });
        }
        // The one of the second entry asked for its own, off, and was refused the first one at the frame.
        const asked = of(secondId);

        expect(asked.filter(({ named }) => named === secondId).length).toBeGreaterThan(0);
        for (const request of asked.filter(({ named }) => named === secondId)) {
          expect(request).toMatchObject({ answer: "ok" });
          if (request.state) expect(request.state).toEqual({ cluster: secondId, on: false });
        }
        expect(asked.filter(({ named }) => named !== secondId)).toEqual([
          expect.objectContaining({ channel: "gate.state", named: firstId, answer: "forbidden at frame" }),
        ]);
        // Two senders: each frame has its process and frame identifiers, which tell it from the other.
        expect([keys(of(firstId)).length, keys(asked).length]).toEqual([1, 1]);
        expect(keys(of(firstId))).not.toEqual(keys(asked));
        await cluster.writeReport("host-14-handled-requests", {
          port,
          frames: { first: firstId, second: secondId },
          handled: handled.map(({ address, ...request }) => ({ ...request, host: new URL(address).host })),
        });
      } finally {
        await velero.stopWatchingHandlers(app);
      }
      // The first frame still has writes on: nothing the second one asked changed its gate.
      await velero.navigateToCatalog(app);
      frame = await cluster.openClusterFromCatalog(window, kubeconfig);
      await frame.waitForSelector("[data-testid=velero-writes][data-writes=on]", { timeout: 60_000 });
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
