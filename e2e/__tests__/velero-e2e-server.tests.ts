/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

// The band of the server in the Overview, in a packaged Freelens, against the
// test environment: the version of the real server of the demo and its plugins,
// a request no server answers in a synthetic installation, and the refusal of
// the cluster for an identity that may not create. It is the first suite that
// asks the extension to write. The API server counts one creation for each
// request that was confirmed and none for a command that was not, and what the
// suite asked for is gone when it ends: the server removes the request it
// processed, and the suite removes the one no server looks at.
//
// The server of the demo is the reviewed release, as it is and not as a fixture
// would make it: it lists every BackupItemAction and RestoreItemAction twice,
// which the band shows once, and the suite expects of it what it does.

import { readFile, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { expect } from "@jest/globals";
import * as cluster from "../helpers/velero-cluster";
import * as velero from "../helpers/velero-extension";

import type { Frame } from "playwright";

const TIMEOUT = 15 * 60 * 1000;
const OVERVIEW = cluster.OVERVIEW;
const SECOND_CONTEXT = "velero-e2e-reader";
const RESOURCE = "serverstatusrequests";
const PREFIX = "freelens-velero-";
const LABELS = { "app.kubernetes.io/managed-by": "freelens-velero-extension" };
// The release the extension was reviewed against, which is the one of the test environment.
const REVIEWED = "v1.18.2";
// The kinds of plugins the reviewed release lists, in its order.
const KINDS = [
  "ObjectStore",
  "VolumeSnapshotter",
  "BackupItemAction",
  "BackupItemActionV2",
  "RestoreItemAction",
  "RestoreItemActionV2",
  "DeleteItemAction",
  "ItemBlockAction",
];
const THEMES: velero.ColorTheme[] = ["Dark", "Light"];
const SIZES = [
  { name: "1440x900", width: 1440, height: 900, zoom: 1 },
  { name: "900x650", width: 900, height: 650, zoom: 1 },
  { name: "1440x900-zoom-200", width: 1440, height: 900, zoom: 2 },
];
// How long what must not happen is waited for.
const NOTHING = 1500;
// How long after it processed a request the server looks at it again, and removes it.
const LOOKS_AGAIN = 5 * 60 * 1000;
const RUNNING = "Creating the ServerStatusRequest, then waiting for the server to answer for ten seconds at most.";
const part = (id: string) => `[data-testid=velero-overview-server-${id}]`;
const id = (name: string) => `velero-overview-server-${name}`;

describe("the version of the server", () => {
  let started: velero.StartedApplication | undefined;
  let profile = "";
  let kubeconfig = "";
  let frame: Frame;
  let before: cluster.ClusterSnapshot;
  let counted: Record<string, number>;
  // The request the server of the demo answered, as the API server held it.
  let answered: cluster.ServerStatusRequestObject | undefined;

  const writes = async (within: Frame) =>
    (await within.locator("[data-testid=velero-writes]").getAttribute("data-writes")) ?? "";
  const turnOn = async (within: Frame) => {
    await within.click("[data-testid=velero-writes-on]");
    const dialog = within.locator("[data-testid=confirmation-dialog]");

    await dialog.waitFor({ state: "visible", timeout: 60_000 });
    await dialog.locator("[data-testid=confirm]").click();
    await within.waitForSelector("[data-testid=velero-writes][data-writes=on]", { timeout: 60_000 });
  };
  // The first gesture: the command, then the object it would create.
  const ask = async (within: Frame) => {
    await within.click(part("create"));
    await within.waitForSelector(part("confirm"), { timeout: 30_000 });
  };
  // What the confirmation says of the object, field by field.
  const facts = (within: Frame) =>
    within.$$eval(`${part("confirm")} [data-field]`, (fields) =>
      Object.fromEntries(
        fields.map((field) => [
          field.getAttribute("data-field") ?? "",
          (field.querySelector("dd")?.textContent ?? "").trim(),
        ]),
      ),
    );
  // What the API server counted for the requests since a reading of its counters. The server of the demo
  // removes the request it processed when it looks at it again, whenever that falls: its removal is
  // counted at the end of the suite, with everything else.
  const since = (earlier: Record<string, number>) => {
    const { "DELETE 200": _removed, ...rest } = cluster.counted(earlier, cluster.requestCodes(RESOURCE));

    return rest;
  };
  const failure = async (within: Frame) => ({
    code: await within.locator(part("failure")).getAttribute("data-code"),
    stage: await within.locator(part("failure")).getAttribute("data-stage"),
    text: await cluster.wordsOf(within, part("failure-text")),
  });

  beforeAll(async () => {
    if (!cluster.fixturesReady()) {
      throw new Error(`The fixtures are missing from ${cluster.E2E_CLUSTER_NAME}. Run \`pnpm demo:up\` first.`);
    }
    before = cluster.clusterSnapshot();
    counted = cluster.requestCodes(RESOURCE);
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

  // Whatever happened, the suites after this one find no request and no server about to remove one.
  afterAll(async () => {
    try {
      for (const namespace of [cluster.E2E_OVERVIEW_NAMESPACE, cluster.E2E_VIEWS_NAMESPACE]) {
        cluster.removeRequestsOfTheExtension(namespace);
      }
      const deadline = Date.now() + LOOKS_AGAIN + 2 * 60 * 1000;

      while (cluster.serverStatusRequests(cluster.E2E_NAMESPACE).length > 0 && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 5000));
      }
    } finally {
      if (started) await velero.setZoom(started.app, 1).catch(() => undefined);
      await started?.cleanup();
    }
  }, TIMEOUT);

  it(
    "says that the version is not read when the page opens, and with writes off leads to the target bar and creates nothing",
    async () => {
      const earlier = cluster.requestCodes(RESOURCE);

      await cluster.openPage(frame, OVERVIEW);
      await cluster.selectInstallation(frame, cluster.E2E_NAMESPACE);
      await frame.waitForSelector(part("unread"), { timeout: 60_000 });
      await frame.waitForSelector("[data-testid=velero-writes-on]", { timeout: 60_000 });
      // The band is after what was read, before every other band.
      const bands = await frame.$$eval("[data-testid=velero-overview] > *", (parts) =>
        parts.map((band) => band.getAttribute("data-testid")),
      );

      expect(bands.slice(0, 2)).toEqual(["velero-overview-read", "velero-overview-server"]);
      expect(await cluster.wordsOf(frame, "#velero-overview-server-title")).toBe("Server");
      expect(await cluster.wordsOf(frame, part("unread"))).toBe(
        "The version of the server and its plugins are not read.",
      );
      expect(await cluster.wordsOf(frame, part("writes-off"))).toBe(
        `Asking the server for them creates a ServerStatusRequest in ${cluster.E2E_NAMESPACE}, which the server answers. Writes are off for this installation: they are turned on in the target bar.`,
      );
      expect(await frame.locator(part("create")).count()).toBe(0);
      await frame.click(part("to-target"));
      expect(await cluster.focusOn(frame, "velero-writes-on")).toBe("velero-writes-on");
      // The page asked the cluster nothing of the requests: no creation, and no read of one.
      await frame.waitForTimeout(NOTHING);
      expect(since(earlier)).toEqual({});
      expect(await cluster.layoutProblems(frame, OVERVIEW)).toEqual([]);
      await cluster.captureScreenshot(frame, "dark-server-writes-off");
    },
    TIMEOUT,
  );

  it(
    "shows the object before it creates it, with the keyboard alone, and creates nothing for a command that is not confirmed",
    async () => {
      if (!started) throw new Error("The application is not running");
      const earlier = cluster.requestCodes(RESOURCE);

      await turnOn(frame);
      await frame.waitForSelector(part("create"), { timeout: 60_000 });
      expect(await cluster.wordsOf(frame, part("create"))).toBe("Create a ServerStatusRequest");
      expect(await cluster.wordsOf(frame, part("what"))).toBe(
        `Asking the server for them creates a ServerStatusRequest in ${cluster.E2E_NAMESPACE}, which the server answers.`,
      );
      // The command with the keyboard: what takes its place has the focus, and it is not the command
      // that creates.
      await frame.locator(part("create")).focus();
      await started.window.keyboard.press("Enter");
      await frame.waitForSelector(part("confirm"), { timeout: 30_000 });
      expect(await cluster.focusOn(frame, id("confirm"))).toBe(id("confirm"));
      expect(await facts(frame)).toEqual({
        kind: "ServerStatusRequest (velero.io/v1)",
        name: `Generated by the API server, beginning with ${PREFIX}`,
        namespace: cluster.E2E_NAMESPACE,
        cluster: `${cluster.E2E_KUBE_CONTEXT} (context ${cluster.E2E_KUBE_CONTEXT})`,
        labels: Object.entries(LABELS)
          .map(([key, value]) => `${key}=${value}`)
          .join(", "),
        spec: "Empty",
        target: "None: the request is of the server, not of an object",
      });
      expect(await cluster.wordsOf(frame, part("confirm-create"))).toBe("Create the ServerStatusRequest");
      expect(await cluster.wordsOf(frame, part("confirm-back"))).toBe("Do not create it");
      expect(await frame.locator(part("create")).count()).toBe(0);
      expect(await cluster.layoutProblems(frame, OVERVIEW)).toEqual([]);
      await cluster.captureScreenshot(frame, "dark-server-confirmation");
      // The command that creates, then the one that leaves: one press each.
      expect(await cluster.tabTo(frame, (focus) => focus === id("confirm-create"), 2)).toBe(1);
      expect(await cluster.tabTo(frame, (focus) => focus === id("confirm-back"), 2)).toBe(1);
      await started.window.keyboard.press("Enter");
      await frame.waitForSelector(part("confirm"), { state: "detached", timeout: 30_000 });
      // Who leaves the confirmation is on the command again.
      expect(await cluster.focusOn(frame, id("create"))).toBe(id("create"));
      // Escape leaves it as well, from wherever the focus is in it.
      await started.window.keyboard.press("Enter");
      await frame.waitForSelector(part("confirm"), { timeout: 30_000 });
      expect(await cluster.focusOn(frame, id("confirm"))).toBe(id("confirm"));
      await started.window.keyboard.press("Escape");
      await frame.waitForSelector(part("confirm"), { state: "detached", timeout: 30_000 });
      expect(await cluster.focusOn(frame, id("create"))).toBe(id("create"));
      // The page is still the Overview: the key was of the confirmation.
      expect(await frame.locator("[data-testid=velero-overview]").count()).toBe(1);
      // With writes on and no confirmation, nothing reached the cluster.
      await frame.waitForTimeout(NOTHING);
      expect(since(earlier)).toEqual({});
      expect(cluster.serverStatusRequests(cluster.E2E_NAMESPACE)).toEqual([]);
    },
    TIMEOUT,
  );

  it(
    "reads the version of the server of the demo and its plugins after the confirmation: one creation, and the reads of the request",
    async () => {
      const earlier = cluster.requestCodes(RESOURCE);

      await ask(frame);
      await frame.click(part("confirm-create"));
      await frame.waitForSelector(part("version"), { timeout: 60_000 });
      // The answer has the focus, and is where the operator sees it: not above the page, under the
      // plugins of the server.
      expect(await cluster.focusOn(frame, id("version"))).toBe(id("version"));
      expect(
        await frame.locator(part("version")).evaluate((version) => {
          const box = version.getBoundingClientRect();
          const at = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);

          return at === version || version.contains(at);
        }),
      ).toBe(true);
      // The request the band names is in the cluster, as the confirmation showed it, and the server
      // processed it.
      const named = /the request (\S+) when/.exec(await cluster.wordsOf(frame, part("request")))?.[1] ?? "";
      const held = cluster.serverStatusRequests(cluster.E2E_NAMESPACE);

      expect(held.map((request) => request.metadata.name)).toEqual([named]);
      answered = held[0];
      expect(named.startsWith(PREFIX)).toBe(true);
      expect(answered.metadata.generateName).toBe(PREFIX);
      expect(answered.metadata.labels).toEqual(LABELS);
      expect(answered.spec ?? {}).toEqual({});
      expect(answered.status?.phase).toBe("Processed");
      // What the band says is what the server wrote into it.
      const status = answered.status ?? {};
      const plugins = status.plugins ?? [];

      expect(status.serverVersion).toBe(REVIEWED);
      expect(await cluster.wordsOf(frame, part("version"))).toBe(`Velero ${REVIEWED}`);
      expect(await frame.locator(part("version")).getAttribute("data-relation")).toBe("same");
      expect(await cluster.wordsOf(frame, part("note"))).toBe(
        "This is the release the extension was reviewed against.",
      );
      expect(await cluster.wordsOf(frame, part("processed"))).toBe(
        `Processed by the server at ${await frame.evaluate(
          (written) => new Date(written).toLocaleString(),
          status.processedTimestamp ?? "",
        )}`,
      );
      // The plugins by kind, in the order of the release, the names sorted in each: the object lists them
      // in no order. Each plugin once: the object lists some more than once.
      const names = new Map<string, Set<string>>();
      const listed = new Map<string, number>();

      for (const plugin of plugins) {
        names.set(plugin.kind, (names.get(plugin.kind) ?? new Set<string>()).add(plugin.name));
        listed.set(plugin.kind, (listed.get(plugin.kind) ?? 0) + 1);
      }
      const others = [...names.keys()].filter((kind) => !KINDS.includes(kind)).sort();
      const expected = [...KINDS, ...others].map((kind) => [
        kind,
        String((names.get(kind) ?? new Set()).size),
        [...(names.get(kind) ?? [])].sort(),
      ]);
      const loaded = [...names.values()].reduce((sum, of) => sum + of.size, 0);
      const shown = await frame.$$eval(`${part("plugins")} [data-kind]`, (rows) =>
        rows.map((row) => [
          row.getAttribute("data-kind"),
          row.getAttribute("data-count"),
          [...row.querySelectorAll("[data-plugin]")].map((plugin) => (plugin.textContent ?? "").trim()),
        ]),
      );

      expect(shown).toEqual(expected);
      expect(others).toEqual([]);
      expect(loaded).toBeGreaterThan(5);
      // What the reviewed release does, which no fixture showed: an action of an older kind is in the
      // object twice, and no other plugin is. A release that lists them otherwise is one to read again.
      expect(
        [...listed.entries()]
          .filter(([kind, entries]) => entries !== (names.get(kind) ?? new Set()).size)
          .map(([kind, entries]) => [kind, entries / (names.get(kind) ?? new Set()).size])
          .sort(),
      ).toEqual([
        ["BackupItemAction", 2],
        ["RestoreItemAction", 2],
      ]);
      expect(await cluster.wordsOf(frame, part("plugins-count"))).toBe(
        `${loaded} plugins loaded. The request lists ${plugins.length} entries: ${plugins.length - loaded} repeat a plugin of the same kind, which is shown once.`,
      );
      expect([...(names.get("ObjectStore") ?? [])]).toContain("velero.io/aws");
      // Beside the object store plugins, the provider of the storage location of the demo and its plugin.
      const providers = await frame.$$eval(`${part("plugins")} [data-provider]`, (lines) =>
        lines.map((line) => [
          line.getAttribute("data-provider"),
          line.getAttribute("data-loaded"),
          line.closest("[data-kind]")?.getAttribute("data-kind"),
        ]),
      );

      expect(providers).toEqual([["aws", "true", "ObjectStore"]]);
      expect(await cluster.wordsOf(frame, `${part("plugins")} [data-provider=aws]`)).toBe(
        "The provider aws of the storage location default needs the object store plugin velero.io/aws, which is loaded.",
      );
      expect(await cluster.wordsOf(frame, part("create"))).toBe("Create another ServerStatusRequest");
      // One creation, the reads of the request by its name, and what the server wrote into it: nothing else.
      const asked = since(earlier);

      expect(Object.keys(asked).sort()).toEqual(["GET 200", "PATCH 200", "POST 201"]);
      expect(asked["POST 201"]).toBe(1);
      expect(asked["PATCH 200"]).toBe(1);
      expect(asked["GET 200"]).toBeGreaterThanOrEqual(1);
      expect(await writes(frame)).toBe("on");
      expect(await cluster.layoutProblems(frame, OVERVIEW)).toEqual([]);
      await cluster.captureScreenshot(frame, "dark-server-version");
    },
    TIMEOUT,
  );

  it(
    "keeps what was read through a read of the Overview and a visit to another page, and asks the cluster nothing for it",
    async () => {
      const earlier = cluster.requestCodes(RESOURCE);
      const read = async () => [
        await cluster.wordsOf(frame, part("version")),
        await cluster.wordsOf(frame, part("processed")),
        await cluster.wordsOf(frame, part("request")),
      ];
      const first = await read();

      await cluster.readAgain(frame);
      expect(await read()).toEqual(first);
      await cluster.openPage(frame, cluster.BACKUPS);
      await cluster.waitForBackups(frame);
      await cluster.openPage(frame, OVERVIEW);
      await frame.waitForSelector(part("version"), { timeout: 60_000 });
      expect(await read()).toEqual(first);
      await frame.waitForTimeout(NOTHING);
      expect(since(earlier)).toEqual({});
      // The request is still in the cluster: the server removes it when it looks at it again, not before.
      expect(cluster.serverStatusRequests(cluster.E2E_NAMESPACE).map((request) => request.metadata.name)).toEqual([
        answered?.metadata.name,
      ]);
    },
    TIMEOUT,
  );

  it(
    "shows the answer of the server and the confirmation of a write in both themes, at every size",
    async () => {
      if (!started) throw new Error("The application is not running");
      const problems: Record<string, string[]> = {};
      const screenshots: string[] = [];

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
          expect([size.name, await cluster.appliedLike(frame, expected)]).toEqual([size.name, expected]);
          await frame.waitForTimeout(1000);
          await frame.locator("[data-testid=velero-overview-server]").scrollIntoViewIfNeeded();
          const name = `${theme.toLowerCase()}-${size.name}-server`;

          problems[`${name}-version`] = await cluster.layoutProblems(frame, OVERVIEW);
          screenshots.push(await cluster.requiredScreenshot(frame, `${name}-version`, size.zoom));
          // The confirmation of another request, under what was read: asked, looked at, and left.
          await ask(frame);
          await frame.locator(part("confirm")).scrollIntoViewIfNeeded();
          problems[`${name}-confirmation`] = await cluster.layoutProblems(frame, OVERVIEW);
          screenshots.push(await cluster.requiredScreenshot(frame, `${name}-confirmation`, size.zoom));
          await frame.click(part("confirm-back"));
          await frame.waitForSelector(part("confirm"), { state: "detached", timeout: 30_000 });
        }
      }
      await velero.setZoom(started.app, 1);
      await velero.setWindowSize(started.app, 1440, 900);
      await velero.setColorTheme(started.app, started.window, "Dark");
      await frame.waitForTimeout(1000);
      await cluster.scrollOverview(frame, 0);
      await cluster.writeReport("server-layout", problems);
      expect(Object.fromEntries(Object.entries(problems).filter(([, found]) => found.length > 0))).toEqual({});
      expect(new Set(screenshots).size).toBe(THEMES.length * SIZES.length * 2);
      // A confirmation that was left created nothing: the request of the demo is the only one.
      expect(cluster.serverStatusRequests(cluster.E2E_NAMESPACE)).toHaveLength(1);
    },
    TIMEOUT,
  );

  it(
    "says that the server did not answer in an installation no server looks at, after ten seconds, and leaves the request where it is",
    async () => {
      const namespace = cluster.E2E_OVERVIEW_NAMESPACE;

      // Another installation: writes are off, and what was read of the one before is not shown.
      await cluster.selectInstallation(frame, namespace);
      await frame.waitForSelector("[data-testid=velero-writes][data-writes=off]", { timeout: 60_000 });
      await frame.waitForSelector(part("unread"), { timeout: 60_000 });
      expect(await frame.locator(part("version")).count()).toBe(0);
      expect(cluster.serverStatusRequests(namespace)).toEqual([]);
      await turnOn(frame);
      const earlier = cluster.requestCodes(RESOURCE);

      await ask(frame);
      expect((await facts(frame)).namespace).toBe(namespace);
      const confirmed = Date.now();

      await frame.click(part("confirm-create"));
      await frame.waitForSelector(`${part("body")}[data-step=running]`, { timeout: 30_000 });
      expect(await cluster.wordsOf(frame, part("status"))).toBe(RUNNING);
      // The command went, and the request runs: the focus is on the words that say so.
      expect(await cluster.focusOn(frame, id("status"))).toBe(id("status"));
      await frame.waitForSelector(part("failure"), { timeout: 60_000 });
      const waited = Date.now() - confirmed;

      // Ten seconds, and not the time of a request that hangs.
      expect(waited).toBeGreaterThanOrEqual(10_000);
      expect(waited).toBeLessThan(25_000);
      expect(await failure(frame)).toEqual({
        code: "deadline",
        stage: "wait",
        text: "The server did not answer in ten seconds: it may be stopped, or busy. The request stays until the server processes it.",
      });
      expect(await cluster.wordsOf(frame, part("failure-request"))).toBe(
        `The request is a ServerStatusRequest of ${namespace} whose name begins with ${PREFIX}. The extension deletes no request: the server deletes one when it looks at it again, five minutes after it processed it, and one that no server processes stays until someone removes it.`,
      );
      // Not answered is not a claim that the server is down.
      expect(await cluster.wordsOf(frame, "[data-testid=velero-overview-server]")).not.toMatch(
        /\b(down|dead|broken|crashed)\b/i,
      );
      expect(await cluster.wordsOf(frame, part("unread"))).toBe(
        "The version of the server and its plugins are not read.",
      );
      expect(await cluster.wordsOf(frame, part("create"))).toBe("Create another ServerStatusRequest");
      expect(await writes(frame)).toBe("on");
      // The request is in the cluster as it was created: no server wrote into it, and nothing removed it.
      const left = cluster.serverStatusRequests(namespace);

      expect(left).toHaveLength(1);
      expect(left[0].metadata.name.startsWith(PREFIX)).toBe(true);
      expect(left[0].metadata.generateName).toBe(PREFIX);
      expect(left[0].metadata.labels).toEqual(LABELS);
      expect(left[0].spec ?? {}).toEqual({});
      expect(left[0].status).toBeUndefined();
      // One creation and the reads of the request, four times a second for ten seconds: nothing else.
      const asked = since(earlier);

      expect(Object.keys(asked).sort()).toEqual(["GET 200", "POST 201"]);
      expect(asked["POST 201"]).toBe(1);
      expect(asked["GET 200"]).toBeGreaterThanOrEqual(10);
      expect(asked["GET 200"]).toBeLessThanOrEqual(45);
      expect(await cluster.layoutProblems(frame, OVERVIEW)).toEqual([]);
      await cluster.captureScreenshot(frame, "dark-server-not-answered");
    },
    TIMEOUT,
  );

  it(
    "says that the cluster refused the creation to an identity that may not create, and leaves writes on",
    async () => {
      if (!started) throw new Error("The application is not running");
      // A second entry of the catalog: the same cluster through the kubeconfig of the reader of a part,
      // which may read three kinds of one namespace and create nothing.
      const source = JSON.parse(await readFile(cluster.readerKubeconfigPath(), "utf8")) as {
        contexts?: { name: string }[];
        "current-context"?: string;
      };

      for (const context of source.contexts ?? []) context.name = SECOND_CONTEXT;
      source["current-context"] = SECOND_CONTEXT;
      const renamed = path.join(profile, "reader-kubeconfig.json");

      await writeFile(renamed, JSON.stringify(source), { mode: 0o600 });
      const second = await cluster.publishKubeconfig(renamed, "velero-e2e-reader");

      await velero.navigateToCatalog(started.app);
      await started.window.waitForSelector(`div.TableCell >> text='${SECOND_CONTEXT}'`, { timeout: 60_000 });
      const other = await cluster.openClusterFromCatalog(started.window, second, SECOND_CONTEXT);

      await cluster.openPage(other, OVERVIEW);
      await cluster.configureInstallation(other, cluster.E2E_VIEWS_NAMESPACE);
      await other.waitForSelector(part("unread"), { timeout: 60_000 });
      await other.waitForSelector("[data-testid=velero-writes-on]", { timeout: 60_000 });
      await turnOn(other);
      const earlier = cluster.requestCodes(RESOURCE);

      await ask(other);
      expect(await facts(other)).toMatchObject({
        namespace: cluster.E2E_VIEWS_NAMESPACE,
        cluster: `${SECOND_CONTEXT} (context ${SECOND_CONTEXT})`,
      });
      await other.click(part("confirm-create"));
      await other.waitForSelector(part("failure"), { timeout: 60_000 });
      expect(await failure(other)).toEqual({
        code: "forbidden",
        stage: "creation",
        text: "The cluster refused the creation of a ServerStatusRequest: the identity needs the verb create on serverstatusrequests of the namespace.",
      });
      // Nothing was created: there is no request to say where it is, and the command creates the first.
      expect(await other.locator(part("failure-request")).count()).toBe(0);
      expect(await cluster.wordsOf(other, part("create"))).toBe("Create a ServerStatusRequest");
      // The refusal is of the cluster, not of the gate: writes stay on.
      await other.waitForTimeout(NOTHING);
      expect(await writes(other)).toBe("on");
      // Nothing was created, and nothing was read. The API server counts what reaches the kind: a
      // creation it refuses to the identity is not among what it counts, with any code.
      expect(since(earlier)).toEqual({});
      expect(cluster.serverStatusRequests(cluster.E2E_VIEWS_NAMESPACE)).toEqual([]);
      expect(await cluster.layoutProblems(other, OVERVIEW)).toEqual([]);
      await cluster.captureScreenshot(other, "dark-server-refused");
    },
    TIMEOUT,
  );

  it(
    "leaves nothing behind: the server removes the request it processed when it looks at it again, five minutes after",
    async () => {
      const processed = Date.parse(answered?.status?.processedTimestamp ?? "");

      expect(Number.isFinite(processed)).toBe(true);
      // The request no server looks at is still as it was left, and it is the suite that removes it.
      expect(cluster.serverStatusRequests(cluster.E2E_OVERVIEW_NAMESPACE)).toHaveLength(1);
      const deadline = processed + LOOKS_AGAIN + 2 * 60 * 1000;

      while (cluster.serverStatusRequests(cluster.E2E_NAMESPACE).length > 0 && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 5000));
      }
      expect(cluster.serverStatusRequests(cluster.E2E_NAMESPACE)).toEqual([]);
      // Every request of the suite, as the API server counted it: two creations, what the server wrote
      // into the one it processed, and its removal of it. The creation the cluster refused is not counted.
      const { "GET 200": reads, ...asked } = cluster.counted(counted, cluster.requestCodes(RESOURCE));

      expect(reads).toBeGreaterThanOrEqual(11);
      expect(asked).toEqual({ "POST 201": 2, "PATCH 200": 1, "DELETE 200": 1 });
      expect(cluster.removeRequestsOfTheExtension(cluster.E2E_OVERVIEW_NAMESPACE)).toBe(1);
      expect(cluster.clusterSnapshot()).toEqual(before);
    },
    TIMEOUT,
  );
});
