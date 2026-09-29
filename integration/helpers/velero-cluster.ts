/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

// Helpers for driving a connected cluster: putting the kubeconfig of the test
// environment where Freelens finds it, opening the cluster from the catalog,
// opening the views of Velero and reading what they show.
//
// See `velero-extension.ts` for why these files live next to the Freelens
// integration helpers at run time.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, mkdir, stat, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { captureWindowScreenshot, EXTENSION_NAME } from "./velero-extension";

import type { Frame, Locator, Page } from "playwright";

/** The cluster `pnpm demo:up` brings up, and its namespaces with Velero objects. */
export const E2E_CLUSTER_NAME = process.env.E2E_CLUSTER_NAME || "freelens-velero-dev";
export const E2E_KUBE_CONTEXT = process.env.E2E_KUBE_CONTEXT || `kind-${E2E_CLUSTER_NAME}`;
/** Where Velero is installed: the real backup and its restore are here. */
export const E2E_NAMESPACE = process.env.E2E_NAMESPACE || "velero-demo";
/** Where the synthetic objects of every phase are, outside the reach of the controllers. */
export const E2E_STATIC_NAMESPACE = process.env.E2E_STATIC_NAMESPACE || "";
/** Where the references that lead somewhere and the ones that do not are, with the reader of a part. */
export const E2E_VIEWS_NAMESPACE = process.env.E2E_VIEWS_NAMESPACE || "";
/** Where two storage locations are marked default, and nothing else is. */
export const E2E_DEFAULTS_NAMESPACE = process.env.E2E_DEFAULTS_NAMESPACE || "";
/** Where the installation of the Overview is: operations whose times are counted back from their placement. */
export const E2E_OVERVIEW_NAMESPACE = process.env.E2E_OVERVIEW_NAMESPACE || "";
/** Where the long list is: a thousand backups and no storage location. */
export const E2E_SCALE_NAMESPACE = process.env.E2E_SCALE_NAMESPACE || "";

/** The namespaces a discovery finds: the ones that hold a backup storage location. */
export const SUGGESTED_NAMESPACES = [
  E2E_NAMESPACE,
  E2E_STATIC_NAMESPACE,
  E2E_VIEWS_NAMESPACE,
  E2E_DEFAULTS_NAMESPACE,
  E2E_OVERVIEW_NAMESPACE,
];

/** Connecting a cluster involves starting a proxy, so it is not quick. */
const CLUSTER_TIMEOUT = 3 * 60 * 1000;
const ELEMENT_TIMEOUT = 60 * 1000;
const KUBECTL_TIMEOUT = 2 * 60 * 1000;
/** What Escape gets before `closeDetails` reaches for the close icon of the drawer. */
const DRAWER_ESCAPE_TIMEOUT = 5 * 1000;

/** Where the screenshots go. The runner of the suite names the directory. */
const ARTIFACTS_DIR = process.env.E2E_ARTIFACTS_DIR || path.join(process.cwd(), "e2e-artifacts");

/**
 * Screenshots the frame of the cluster, and not the window around it. Never
 * throws: a failed screenshot must not replace the failure that asked for it.
 *
 * In a window that is zoomed the driver measures the frame in the pixels of the
 * zoom and cuts the picture in the ones of the window, within a window it
 * believes smaller than it is: the picture is asked of the browser itself.
 */
export async function captureScreenshot(frame: Frame, name: string, zoom = 1): Promise<string | undefined> {
  const file = path.join(ARTIFACTS_DIR, `${name.replace(/[^a-zA-Z0-9-]+/g, "-")}.png`);

  try {
    await mkdir(ARTIFACTS_DIR, { recursive: true });
    const element = await frame.frameElement();

    if (zoom === 1) {
      await element.screenshot({ path: file });
    } else {
      const box = await element.boundingBox();

      if (!box) return undefined;
      const session = await frame.page().context().newCDPSession(frame.page());

      try {
        const { data } = await session.send("Page.captureScreenshot", {
          format: "png",
          clip: {
            x: box.x * zoom,
            y: box.y * zoom,
            width: box.width * zoom,
            height: box.height * zoom,
            scale: 1,
          },
        });

        await writeFile(file, Buffer.from(data, "base64"));
      } finally {
        await session.detach().catch(() => undefined);
      }
    }

    return file;
  } catch {
    return undefined;
  }
}

/** The rows the page currently shows, for failure messages. */
async function visibleRows(frame: Frame): Promise<string[]> {
  try {
    const texts = await frame.locator(".TableRow").allInnerTexts();

    return texts.map((text) => text.replace(/\s+/g, " ").trim()).filter(Boolean);
  } catch {
    return [];
  }
}

/** The sidebar test ids currently in the DOM, for failure messages. */
async function sidebarTestIds(frame: Frame): Promise<string[]> {
  try {
    return await frame.$$eval("[data-testid^='sidebar-item-']", (elements) =>
      elements.map((element) => element.getAttribute("data-testid") ?? ""),
    );
  } catch {
    return [];
  }
}

function required(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(`${name} is not set. Run the suite through \`pnpm e2e:views\`.`);
  }

  return value;
}

export function kubeconfigPath(): string {
  return required("E2E_KUBECONFIG");
}

/** The kubeconfig of the identity that reads three families of one namespace. */
export function readerKubeconfigPath(): string {
  return required("E2E_READER_KUBECONFIG");
}

/** The kubeconfig of the identity that reads the restores and what they refer to, and not the backups. */
export function secondReaderKubeconfigPath(): string {
  return required("E2E_SECOND_READER_KUBECONFIG");
}

/** A list of the views, and the kind of what a row of it opens. */
export interface ListOf {
  /** How the list and its page are found: `velero-<id>` and `velero-<id>-page`. */
  id: string;
  /** How a row and a view are found: `data-<kind>-row` and `velero-<kind>-workspace`. */
  kind: string;
  /** The entry of the sidebar that opens the page. */
  menu: string;
}

/** The restore of the fixtures with a name as long as a name can be. */
// How far from each other two marks of a line of time are drawn at least.
export const MARK_WIDTH = 28;
export const LONG_LOCATION_NAME = "location-with-a-name-as-long-as-the-name-of-an-object-can-be-63";
export const LONG_RESTORE_NAME = "restore-with-a-name-as-long-as-the-name-of-a-restore-can-be-one";

/** The Overview is a page and not a list: it has no rows, and no view of its kind. */
export const OVERVIEW: ListOf = { id: "overview", kind: "overview", menu: "velero-overview" };
export const BACKUPS: ListOf = { id: "backups", kind: "backup", menu: "velero-backups" };
export const RESTORES: ListOf = { id: "restores", kind: "restore", menu: "velero-restores" };
export const SCHEDULES: ListOf = { id: "schedules", kind: "schedule", menu: "velero-schedules" };
export const STORAGE_LOCATIONS: ListOf = {
  id: "storage-locations",
  kind: "storage-location",
  menu: "velero-storage-locations",
};
export const SNAPSHOT_LOCATIONS: ListOf = {
  id: "snapshot-locations",
  kind: "snapshot-location",
  menu: "velero-snapshot-locations",
};

/**
 * Runs the pinned `kubectl` of the test environment against the test cluster,
 * reading only, and returns its exit status and output. The kubeconfig is the
 * one of the environment, never the one of the developer.
 */
export function kubectlE2E(...args: string[]): { status: number; stdout: string; stderr: string } {
  const verb = args.find((argument) => !argument.startsWith("-"));

  if (verb !== "get") {
    throw new Error(`The suite of the views only reads the cluster: "${verb}" is not a read`);
  }
  const { status, stdout, stderr } = spawnSync(
    required("E2E_KUBECTL"),
    ["--kubeconfig", kubeconfigPath(), "--context", E2E_KUBE_CONTEXT, ...args],
    // A read of the cluster that does not end is a failure of the case that asked for it, not a suite
    // that waits for as long as its runner lets it.
    { encoding: "utf8", maxBuffer: 64 * 1024 ** 2, timeout: KUBECTL_TIMEOUT },
  );

  return { status: status ?? 1, stdout: (stdout ?? "").trim(), stderr: (stderr ?? "").trim() };
}

/**
 * True when the cluster is up and the fixtures are on it. A cluster without
 * them is reported as not ready instead of failing later as a page full of
 * missing rows.
 */
export function fixturesReady(): boolean {
  const probes: [namespace: string, resource: string, name: string][] = [
    [E2E_NAMESPACE, "backupstoragelocations.velero.io", "default"],
    [E2E_STATIC_NAMESPACE, "backups.velero.io", "backup-completed"],
    [E2E_STATIC_NAMESPACE, "backups.velero.io", "backup-finalizingpartiallyfailed"],
    [E2E_STATIC_NAMESPACE, "restores.velero.io", "restore-completed"],
    [E2E_STATIC_NAMESPACE, "backupstoragelocations.velero.io", "fixture-unavailable"],
    [E2E_VIEWS_NAMESPACE, "backups.velero.io", "views-daily-20260901030000"],
    [E2E_VIEWS_NAMESPACE, "backups.velero.io", "backup-missing-location"],
    [E2E_VIEWS_NAMESPACE, "restores.velero.io", "restore-mapped"],
    [E2E_VIEWS_NAMESPACE, "schedules.velero.io", "views-history"],
    [E2E_VIEWS_NAMESPACE, "backups.velero.io", "views-history-0"],
    [E2E_VIEWS_NAMESPACE, "schedules.velero.io", "schedule-unread"],
    [E2E_VIEWS_NAMESPACE, "backupstoragelocations.velero.io", "views-with-credential"],
    [E2E_DEFAULTS_NAMESPACE, "backupstoragelocations.velero.io", "defaults-newer"],
    [E2E_OVERVIEW_NAMESPACE, "backups.velero.io", "recent-1h"],
    [E2E_OVERVIEW_NAMESPACE, "schedules.velero.io", "overview-schedule-12"],
    [E2E_SCALE_NAMESPACE, "backups.velero.io", "backup-1000"],
    [E2E_SCALE_NAMESPACE, "restores.velero.io", "restore-1000"],
  ];

  return probes.every(
    ([namespace, resource, name]) =>
      namespace !== "" && kubectlE2E("get", resource, name, "--namespace", namespace, "-o", "name").status === 0,
  );
}

const KINDS = ["backups", "restores", "schedules", "backupstoragelocations", "volumesnapshotlocations"];
// The kinds a read of Velero is asked through: a request of any of them is a write.
const REQUESTS = ["downloadrequests", "serverstatusrequests", "deletebackuprequests"];

export interface ClusterSnapshot {
  /** Every synthetic object with its version, which changes with every write. */
  versions: Record<string, string>;
  /** The objects of the namespace of the installation, which its controllers may change. */
  installed: string[];
  /** The requests to Velero, in every namespace of the fixtures. */
  requests: number;
}

/**
 * What the API server holds of Velero. The synthetic namespaces are out of the
 * reach of the controllers: nothing but a write of what is under test could
 * change their objects. Of the namespace of the installation the objects are
 * listed by identity.
 */
export function clusterSnapshot(): ClusterSnapshot {
  const list = (resource: string, namespace: string) => {
    const { status, stdout, stderr } = kubectlE2E(
      "get",
      `${resource}.velero.io`,
      "--namespace",
      namespace,
      "-o",
      "json",
    );

    if (status !== 0) throw new Error(`kubectl get ${resource} failed: ${stderr}`);
    return (JSON.parse(stdout) as { items: { metadata: { name: string; uid: string; resourceVersion: string } }[] })
      .items;
  };
  const synthetic = [
    E2E_STATIC_NAMESPACE,
    E2E_VIEWS_NAMESPACE,
    E2E_DEFAULTS_NAMESPACE,
    E2E_OVERVIEW_NAMESPACE,
    E2E_SCALE_NAMESPACE,
  ];
  const versions: Record<string, string> = {};
  const installed: string[] = [];
  let requests = 0;

  for (const kind of KINDS) {
    for (const namespace of synthetic) {
      for (const item of list(kind, namespace)) {
        versions[`${namespace}/${kind}/${item.metadata.name}/${item.metadata.uid}`] = item.metadata.resourceVersion;
      }
    }
    for (const item of list(kind, E2E_NAMESPACE)) installed.push(`${kind}/${item.metadata.name}/${item.metadata.uid}`);
  }
  for (const kind of REQUESTS) {
    for (const namespace of [E2E_NAMESPACE, ...synthetic]) requests += list(kind, namespace).length;
  }

  return { versions, requests, installed: installed.sort() };
}

/**
 * How many requests the API server counted for the kinds of Velero, by verb,
 * kind and scope: `LIST backupstoragelocations cluster`. The server counts
 * what reaches it, whoever asks: a list of a kind in the whole cluster is
 * asked by the discovery of the extension and by nothing else of this
 * environment, whose controllers ask for their own namespace.
 */
export function apiRequests(): Record<string, number> {
  const { status, stdout, stderr } = kubectlE2E("get", "--raw", "/metrics");

  if (status !== 0) throw new Error(`The counters of the API server could not be read: ${stderr}`);
  const counts: Record<string, number> = {};

  for (const line of stdout.split("\n")) {
    if (!line.startsWith("apiserver_request_total{") || !line.includes('group="velero.io"')) continue;
    const label = (name: string) => new RegExp(`[{,]${name}="([^"]*)"`).exec(line)?.[1] ?? "";
    const key = `${label("verb")} ${label("resource")} ${label("scope")}`;

    counts[key] = (counts[key] ?? 0) + Number(line.slice(line.lastIndexOf(" ") + 1));
  }

  return counts;
}

/**
 * The lists and the reads of single objects that were asked of the whole
 * cluster, among the ones counted. The watches are left out: the control plane
 * of the cluster watches every kind, and opens its watches again every few
 * minutes.
 */
export function clusterReads(counts: Record<string, number>): Record<string, number> {
  return Object.fromEntries(
    Object.entries(counts).filter(([key]) => {
      const [verb, , scope] = key.split(" ");

      return (verb === "LIST" || verb === "GET") && scope === "cluster";
    }),
  );
}

/**
 * The lists and the reads by name of the five families, in a namespace, of one
 * object or of the whole cluster, among the ones counted, and their watches in
 * a namespace or of one object. It is what a view would ask to read again what
 * it shows. The watches of the whole cluster are left out: the control plane
 * opens its own again every few minutes.
 */
export function familyReads(counts: Record<string, number>): Record<string, number> {
  return Object.fromEntries(
    Object.entries(counts).filter(([key]) => {
      const [verb, kind, scope] = key.split(" ");

      return KINDS.includes(kind) && (verb === "LIST" || verb === "GET" || (verb === "WATCH" && scope !== "cluster"));
    }),
  );
}

/**
 * The requests that change something, or ask Velero for something, among the
 * ones counted: every request of every kind of `velero.io` that is not a read.
 * One is left out, which the installation under test makes by itself: its
 * controller writes into the status of its storage location every time it
 * validates it.
 */
export function writes(counts: Record<string, number>): Record<string, number> {
  return Object.fromEntries(
    Object.entries(counts).filter(([key]) => {
      const [verb, kind] = key.split(" ");

      return !["GET", "LIST", "WATCH"].includes(verb) && !(verb === "PATCH" && kind === "backupstoragelocations");
    }),
  );
}

/** What was counted between two readings of the counters: the requests that are more, with how many more. */
export function counted(before: Record<string, number>, after: Record<string, number>): Record<string, number> {
  return Object.fromEntries(
    Object.keys({ ...before, ...after })
      .map((key) => [key, (after[key] ?? 0) - (before[key] ?? 0)] as const)
      .filter(([, more]) => more !== 0),
  );
}

/**
 * What the target bar says of the reads of the installation: when it was last
 * read, in words and as the moment it was, and whether it is being read.
 */
export async function readState(frame: Frame): Promise<{ text: string; read: string; reading: boolean }> {
  const bar = frame.locator("[data-testid=velero-read-time]");

  return {
    text: (await bar.innerText()).trim(),
    read: (await bar.getAttribute("data-read")) ?? "",
    reading: (await bar.getAttribute("data-reading")) === "true",
  };
}

/**
 * Waits for a read of the installation to end after the one that was last
 * seen: the views read again every fifteen seconds, and what is done right
 * after a read ended is done before the next one begins. What asks for a read
 * takes `seen` before it asks, so that a read that ends at once is not missed.
 */
export async function afterRead(frame: Frame, seen?: string): Promise<void> {
  const before = seen ?? (await readState(frame)).read;

  await frame.waitForFunction(
    (last) => {
      const bar = document.querySelector("[data-testid=velero-read-time]");
      const read = bar?.getAttribute("data-read") ?? "";

      return bar?.getAttribute("data-reading") === "false" && read !== "" && read !== last;
    },
    before,
    { timeout: ELEMENT_TIMEOUT, polling: 100 },
  );
}

/** How long after a step what the step asked is given to reach the API server and be counted. */
const SETTLE = 1500;
/** The views read again every fifteen seconds: what is measured between two reads ends before the second. */
const BETWEEN_READS = 12_000;

/**
 * What the API server counted of the families while a step was taken, in the
 * time between two reads of the installation. Others read the cluster too: the
 * controllers of the installation, in their own namespace. A step that asks
 * nothing is one that was taken once with nothing counted; the step is taken
 * again, after `again` has undone it, when something was. A step that asks
 * the cluster is counted every time it is taken.
 *
 * The time is the one of the application: the moment its last read ended, and
 * the moment the counters were read after the step and after what the step
 * may have asked had the time to be counted. The same read must be the last
 * one when the counters are read: a read that began in between is said.
 */
export async function readsDuring(
  frame: Frame,
  step: () => Promise<void>,
  again: () => Promise<void>,
  tries = 3,
): Promise<Record<string, number>> {
  let asked: Record<string, number> = {};

  for (let attempt = 1; attempt <= tries; attempt += 1) {
    await afterRead(frame);
    const read = (await readState(frame)).read;
    const before = apiRequests();

    await step();
    await frame.waitForTimeout(SETTLE);
    const state = await readState(frame);
    const taken = await frame.evaluate(() => Date.now());
    const after = apiRequests();
    const late = state.reading || state.read !== read || taken - Number(read) > BETWEEN_READS;

    asked = counted(familyReads(before), familyReads(after));
    if (!late && Object.keys(asked).length === 0) return {};
    if (late) asked = { ...asked, "a read of the installation began before the counters were read": 1 };
    if (attempt < tries) await again();
  }

  return asked;
}

/**
 * Copies a kubeconfig of the test environment into the sandboxed Freelens user
 * data directory, which Freelens always watches, so that the cluster shows up
 * in the catalog without touching the kubeconfig of the developer.
 */
export async function publishKubeconfig(source = kubeconfigPath(), fileName = "velero-e2e"): Promise<string> {
  const testingDirectory = process.env.FREELENS_INTEGRATION_TESTING_DIR;

  if (!testingDirectory) {
    throw new Error("FREELENS_INTEGRATION_TESTING_DIR is not set. Launch the app with `startIsolated()`.");
  }

  // The user data directory is <testing dir>/<app name>, and the app name is
  // the product name of the packaged build.
  const appName = process.env.FREELENS_APP_NAME || "Freelens";
  const directory = path.join(testingDirectory, appName, "kubeconfigs");

  await mkdir(directory, { recursive: true });

  const destination = path.join(directory, fileName);

  await copyFile(source, destination);

  return destination;
}

/**
 * Id Freelens gives to a cluster entity: the md5 of the kubeconfig path and the
 * context name. It ends up in the id of the cluster iframe.
 */
export function clusterEntityId(kubeconfigFilePath: string, contextName: string): string {
  return createHash("md5").update(`${kubeconfigFilePath}:${contextName}`).digest("hex");
}

/**
 * Clicks the cluster in the catalog and waits for its frame to be usable. A
 * step that does not end says which one it was, with a picture of the window:
 * the catalog of the suites holds the test cluster and nothing else.
 */
export async function openClusterFromCatalog(
  window: Page,
  kubeconfigFilePath: string,
  contextName = E2E_KUBE_CONTEXT,
): Promise<Frame> {
  const rowSelector = `div.TableCell >> text='${contextName}'`;
  const frameSelector = `#cluster-frame-${clusterEntityId(kubeconfigFilePath, contextName)}`;
  const step = async <Result>(name: string, action: () => Promise<Result>): Promise<Result> => {
    try {
      return await action();
    } catch (error) {
      const screenshot = await captureWindowScreenshot(window, `open-cluster-${name.replace(/\s+/g, "-")}`);

      throw new Error(
        `The cluster was not opened: ${name}. ${(error as Error).message.split("\n")[0]}` +
          (screenshot ? ` Screenshot: ${screenshot}` : ""),
      );
    }
  };

  // The catalog only lists the cluster once the kubeconfig watcher has seen the
  // file, which happens shortly after it is written.
  await step("its row in the catalog", () => window.waitForSelector(rowSelector, { timeout: CLUSTER_TIMEOUT }));
  await step("the click on its row", () => window.click(rowSelector, { timeout: ELEMENT_TIMEOUT }));
  const frameElement = await step("its frame", () =>
    window.waitForSelector(frameSelector, { timeout: CLUSTER_TIMEOUT }),
  );
  const frame = await frameElement.contentFrame();

  if (!frame) {
    throw new Error(`No iframe found for cluster ${contextName}`);
  }
  await step("its sidebar", () => frame.waitForSelector("[data-testid=cluster-sidebar]", { timeout: CLUSTER_TIMEOUT }));

  return frame;
}

// Freelens derives the sidebar test ids from the extension name, dropping the
// leading "@" and turning the "/" into "--".
const SANITIZED_EXTENSION_ID = EXTENSION_NAME.replace("@", "").replace("/", "--");

export function sidebarItemTestId(menuId: string): string {
  return `sidebar-item-${SANITIZED_EXTENSION_ID}-${menuId}`;
}

export function sidebarLinkTestId(menuId: string): string {
  return `link-for-${sidebarItemTestId(menuId)}`;
}

/**
 * Clicks a sidebar entry by dispatching the event on the anchor.
 *
 * The sidebar links navigate from their `onClick` handler, and the cluster
 * overview keeps re-laying itself out for a while after a connection, so a real
 * click can land on a transient overlay instead. Dispatching the event runs the
 * handler whatever is on top.
 */
export async function clickSidebarItem(frame: Frame, testId: string): Promise<void> {
  const selector = `[data-testid="${testId}"]`;

  await frame.waitForSelector(selector, { timeout: ELEMENT_TIMEOUT });
  await frame.dispatchEvent(selector, "click");
}

/** The entries of the sidebar that belong to the extension, with the title each one shows. */
export async function veleroSidebarEntries(frame: Frame): Promise<Record<string, string>> {
  const prefix = `link-for-sidebar-item-${SANITIZED_EXTENSION_ID}-`;
  const entries = await frame.$$eval(
    `[data-testid^="${prefix}"]`,
    (elements, start) =>
      elements.map((element) => {
        // The title without the names of the icons beside it, which are text as well.
        const copy = element.cloneNode(true) as HTMLElement;

        for (const icon of copy.querySelectorAll(".Icon, .icon, i")) icon.remove();
        return [(element.getAttribute("data-testid") ?? "").slice(start.length), (copy.textContent ?? "").trim()];
      }),
    prefix,
  );

  return Object.fromEntries(entries);
}

/**
 * Opens a page of Velero from the sidebar and waits for it, in whatever state
 * it is: a list, or what is shown before one.
 */
export async function openPage(frame: Frame, of: ListOf): Promise<void> {
  const group = sidebarItemTestId("velero");

  if ((await frame.$(`[data-parent-id-test="${group}"]`)) === null) {
    await clickSidebarItem(frame, sidebarLinkTestId("velero"));
    await frame.waitForSelector(`[data-parent-id-test="${group}"]`, { timeout: ELEMENT_TIMEOUT });
  }
  await clickSidebarItem(frame, sidebarLinkTestId(of.menu));

  try {
    await frame.waitForSelector(`[data-testid=velero-${of.id}-page]`, { timeout: ELEMENT_TIMEOUT });
  } catch {
    const screenshot = await captureScreenshot(frame, `page-velero-${of.id}`);
    const testIds = await sidebarTestIds(frame);

    throw new Error(
      `The page of the ${of.id} never rendered. ` +
        `Sidebar test ids present: ${testIds.length > 0 ? testIds.join(", ") : "(none)"}.` +
        (screenshot ? ` Screenshot: ${screenshot}` : ""),
    );
  }
}

export async function openBackups(frame: Frame): Promise<void> {
  await openPage(frame, BACKUPS);
}

/** Goes to an address of the application, as a link of the application would. */
export async function navigate(frame: Frame, address: string): Promise<void> {
  await frame.evaluate((target) => {
    window.history.pushState({}, "", target);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }, address);
}

/** The state the page is in, by the test id of what it shows. */
export async function entryState(frame: Frame, of: ListOf = BACKUPS): Promise<string> {
  const shown = frame.locator(`[data-testid^=velero-state-], [data-testid=velero-${of.id}]`).first();

  await shown.waitFor({ state: "attached", timeout: ELEMENT_TIMEOUT });

  return (await shown.getAttribute("data-testid")) ?? "";
}

/** Waits for a list to show at least one row. */
export async function waitForList(frame: Frame, of: ListOf): Promise<void> {
  await frame.waitForSelector(`[data-testid=velero-${of.id}] .TableRow:not(.TableHead)`, {
    timeout: ELEMENT_TIMEOUT,
  });
}

export async function waitForBackups(frame: Frame): Promise<void> {
  await waitForList(frame, BACKUPS);
}

/** The namespace the target bar says is read, and the cluster it says it is of. */
export async function target(frame: Frame): Promise<{ cluster: string; namespace: string }> {
  return {
    cluster: (await frame.locator("[data-testid=velero-target-cluster]").innerText()).trim(),
    namespace: (await frame.locator("[data-testid=velero-target] .Select__single-value").allInnerTexts())
      .join("")
      .trim(),
  };
}

/** Chooses an installation in the selector of the target bar. */
export async function selectInstallation(frame: Frame, namespace: string): Promise<void> {
  await frame.click("[data-testid=velero-target] .Select__control");
  await frame
    .locator(".Select__option")
    .filter({ hasText: new RegExp(`^${namespace}( \\(.+\\))?$`) })
    .first()
    .click();
  await frame.waitForFunction(
    (expected) =>
      (document.querySelector("[data-testid=velero-target] .Select__single-value")?.textContent ?? "").startsWith(
        expected,
      ),
    namespace,
    { timeout: ELEMENT_TIMEOUT },
  );
}

/**
 * Names a namespace in the form that asks for one: the states before a view
 * show it, and where a view is shown it is behind the target bar.
 */
export async function configureInstallation(frame: Frame, namespace: string): Promise<void> {
  if ((await frame.locator("[data-testid=velero-configure]").count()) === 0) {
    await frame.click("[data-testid=velero-namespaces-toggle]");
    await frame.waitForSelector("[data-testid=velero-configure]", { timeout: ELEMENT_TIMEOUT });
  }
  await frame.fill("[data-testid=velero-configure] input", namespace);
  await frame.click("[data-testid=velero-configure-submit]");
}

function tableRow(frame: Frame, name: string, of: ListOf): Locator {
  // The row whose name is this one: a name that is part of another does not answer for it.
  return frame.locator(`[data-testid=velero-${of.id}] .TableRow`, {
    has: frame.locator(`[data-${of.kind}-row="${name}"]`),
  });
}

/** The cells of a row, as one line, so that adjacent columns can be matched. */
async function rowText(row: Locator): Promise<string> {
  return (await row.innerText()).replace(/\s+/g, " ").trim();
}

/**
 * Asserts that the list of the backups has a row for `name` and that the row
 * shows every one of the given values.
 */
export async function expectRow(frame: Frame, name: string, ...cells: string[]): Promise<void> {
  await expectRowOf(BACKUPS, frame, name, ...cells);
}

/** The same for the list of any kind. */
export async function expectRowOf(of: ListOf, frame: Frame, name: string, ...cells: string[]): Promise<void> {
  const row = tableRow(frame, name, of);

  try {
    await row.waitFor({ state: "visible", timeout: ELEMENT_TIMEOUT });
  } catch {
    const screenshot = await captureScreenshot(frame, `missing-row-${name}`);
    const rows = await visibleRows(frame);

    throw new Error(
      `Row "${name}" never appeared. Rows on the page: ${rows.length > 0 ? rows.join(" | ") : "(none)"}.` +
        (screenshot ? ` Screenshot: ${screenshot}` : ""),
    );
  }

  const text = await rowText(row);

  for (const cell of cells) {
    if (!text.includes(cell)) {
      throw new Error(`Row "${name}" should show "${cell}", got "${text}"`);
    }
  }
}

/**
 * What each cell of a row shows, by the name of its column, without the names
 * of the icons: a value is of its column, and not of the one beside it.
 */
export async function cellsOf(of: ListOf, frame: Frame, name: string): Promise<Record<string, string>> {
  const row = tableRow(frame, name, of);

  await row.waitFor({ state: "visible", timeout: ELEMENT_TIMEOUT });

  return row.evaluate((element) => {
    const cells: Record<string, string> = {};

    for (const cell of element.querySelectorAll(".TableCell")) {
      const copy = cell.cloneNode(true) as HTMLElement;
      const column = String(cell.className)
        .replace(/TableCell|sorting|nowrap/g, "")
        .trim();

      for (const icon of copy.querySelectorAll(".Icon")) icon.remove();
      cells[column] = (copy.textContent ?? "").replace(/\s+/g, " ").trim();
    }

    return cells;
  });
}

/** Waits for the cells of a row to show what is expected of each, and answers them. */
export async function expectCells(
  of: ListOf,
  frame: Frame,
  name: string,
  expected: Record<string, string | RegExp>,
): Promise<Record<string, string>> {
  const deadline = Date.now() + ELEMENT_TIMEOUT;
  const wrong = (cells: Record<string, string>) =>
    Object.entries(expected).filter(([column, value]) =>
      typeof value === "string" ? cells[column] !== value : !value.test(cells[column] ?? ""),
    );
  let cells = await cellsOf(of, frame, name);

  while (wrong(cells).length > 0 && Date.now() < deadline) {
    await frame.waitForTimeout(250);
    cells = await cellsOf(of, frame, name);
  }
  if (wrong(cells).length > 0) {
    throw new Error(
      `Row "${name}" should show ${wrong(cells)
        .map(([column, value]) => `${column}: ${String(value)}`)
        .join(", ")}; it shows ${JSON.stringify(cells)}`,
    );
  }

  return cells;
}

/**
 * The columns the list shows, by their names, and the ones whose words do not
 * fit their cell in a row that is mounted: a value that is cut is read in the
 * tip of its cell, and not at a glance.
 */
export async function columnsOf(of: ListOf, frame: Frame): Promise<{ shown: string[]; cut: string[] }> {
  return frame.evaluate((selector) => {
    const column = (cell: Element) =>
      String(cell.className)
        .replace(/TableCell|sorting|nowrap/g, "")
        .trim();
    const visible = (cell: Element) => getComputedStyle(cell).display !== "none";
    const cut = new Set<string>();

    for (const cell of document.querySelectorAll<HTMLElement>(`${selector} .TableRow:not(.TableHead) .TableCell`)) {
      if (!visible(cell)) continue;
      const words = [cell, ...cell.querySelectorAll<HTMLElement>("*")].filter(
        (element) => getComputedStyle(element).textOverflow === "ellipsis",
      );

      if (words.some((element) => element.scrollWidth > element.clientWidth + 1)) cut.add(column(cell));
    }

    return {
      // The last cell of the head is of the host: what chooses the columns that are shown.
      shown: [...document.querySelectorAll(`${selector} .TableHead .TableCell`)]
        .filter(visible)
        .map(column)
        .filter((name) => name !== "menu"),
      cut: [...cut].sort(),
    };
  }, list(of));
}

/**
 * The texts that do not fit the cell of their column, among the ones given for
 * each column, measured in the font of the cell. What a machine shows depends
 * on its language: a date is written longer in another one, and what fits
 * here may be cut there.
 */
export async function tooWide(of: ListOf, frame: Frame, texts: Record<string, string[]>): Promise<string[]> {
  return frame.evaluate(
    ({ selector, texts }) => {
      const found: string[] = [];

      for (const [column, candidates] of Object.entries(texts)) {
        const cell = document.querySelector<HTMLElement>(`${selector} .TableRow:not(.TableHead) .TableCell.${column}`);

        if (!cell) {
          found.push(`${column}: no cell`);
          continue;
        }
        const style = getComputedStyle(cell);
        const room = cell.clientWidth - Number.parseFloat(style.paddingLeft) - Number.parseFloat(style.paddingRight);
        // What is beside the words in the cell, which is the mark of a failure, takes its part of the room.
        const mark = cell.querySelector<HTMLElement>(".Icon");
        const taken = mark ? mark.getBoundingClientRect().width + 6 : 0;
        const probe = document.createElement("span");

        probe.style.cssText = "position:absolute;visibility:hidden;white-space:nowrap;";
        cell.appendChild(probe);
        for (const text of candidates) {
          probe.textContent = text;
          const width = probe.getBoundingClientRect().width;

          if (width > room - taken)
            found.push(`${column}: "${text}" is ${Math.ceil(width)} in ${Math.floor(room - taken)}`);
        }
        probe.remove();
      }

      return found;
    },
    { selector: list(of), texts },
  );
}

/** What the columns of an operation hold whole in a list with the room for them, in any language. */
export const WORDS_OF_AN_OPERATION = {
  failure: ["No failure reported", "2 validation errors", "12 warnings"],
  progress: ["1000 / 1000 (100%)", "Not reported"],
  started: ["12/31/2026, 12:59:59 PM", "31.12.2026, 23:59:59", "31/12/2026, 23:59:59"],
  duration: ["26d 23h so far", "End not reported"],
};

/** The names of the objects a list has mounted, in the order it shows them. */
export async function mounted(frame: Frame, of: ListOf): Promise<string[]> {
  return frame.$$eval(
    `[data-testid=velero-${of.id}] [data-${of.kind}-row]`,
    (elements, kind) => elements.map((element) => element.getAttribute(`data-${kind}-row`) ?? ""),
    of.kind,
  );
}

export async function mountedBackups(frame: Frame): Promise<string[]> {
  return mounted(frame, BACKUPS);
}

const list = (of: ListOf) => `[data-testid=velero-${of.id}]`;

/** Writes what a check measured beside the screenshots of the suite. */
export async function writeReport(name: string, report: unknown): Promise<void> {
  await mkdir(ARTIFACTS_DIR, { recursive: true });
  await writeFile(path.join(ARTIFACTS_DIR, `${name}.json`), `${JSON.stringify(report, null, 2)}\n`);
}

/** What the list says it shows: what is searched, how it is sorted, where it is scrolled, how wide it is. */
export async function listState(
  frame: Frame,
  of: ListOf = BACKUPS,
): Promise<{
  search: string;
  sorted: string;
  items: string;
  scroll: number;
  first: string;
  columns: Record<string, number>;
}> {
  return frame.evaluate(
    ({ list, kind }) => {
      const root = document.querySelector(list);
      const sorted = root?.querySelector(".TableHead .TableCell .sortIcon.enabled");
      const columns: Record<string, number> = {};

      for (const cell of root?.querySelectorAll<HTMLElement>(".TableHead .TableCell") ?? []) {
        columns[cell.className.replace(/TableCell|sorting|nowrap/g, "").trim()] = cell.getBoundingClientRect().width;
      }

      return {
        search: root?.querySelector<HTMLInputElement>(".SearchInput input")?.value ?? "",
        sorted: sorted
          ? `${sorted
              .closest(".TableCell")
              ?.className.replace(/TableCell|sorting|nowrap/g, "")
              .trim()} ${sorted.textContent?.trim()}`
          : "",
        items: (root?.querySelector(".info-panel")?.textContent ?? "").replace(/\s+/g, " ").trim(),
        scroll: root?.querySelector(".VirtualList .list")?.scrollTop ?? 0,
        first: root?.querySelector(`[data-${kind}-row]`)?.getAttribute(`data-${kind}-row`) ?? "",
        columns,
      };
    },
    { list: list(of), kind: of.kind },
  );
}

export type ListState = Awaited<ReturnType<typeof listState>>;

/**
 * The state of the list once it is the one that is expected, or the last one
 * it had when the time was over. A list that is shown again draws its rows
 * after it is given its scroll: on a machine that is busy the rows of the
 * frame before are still there for a moment.
 */
export async function listStateLike(
  frame: Frame,
  expected: ListState,
  of: ListOf = BACKUPS,
  timeout = 15_000,
): Promise<ListState> {
  const deadline = Date.now() + timeout;
  let state = await listState(frame, of);

  while (
    Date.now() < deadline &&
    (state.first !== expected.first ||
      state.search !== expected.search ||
      state.sorted !== expected.sorted ||
      state.items !== expected.items ||
      Math.abs(state.scroll - expected.scroll) > 2)
  ) {
    await frame.waitForTimeout(100);
    state = await listState(frame, of);
  }

  return state;
}

/**
 * Types in the search of the list, and waits for the list to follow: the host
 * gives the list what was typed when the keys stopped, which is when the text
 * is in the address, and the list then shows the same rows twice in a row.
 */
export async function search(frame: Frame, text: string, of: ListOf = BACKUPS): Promise<string[]> {
  await frame.fill(`${list(of)} .SearchInput input`, text);
  await frame.waitForFunction(
    (searched) => (new URLSearchParams(window.location.search).get("search") ?? "") === searched,
    text,
    { timeout: ELEMENT_TIMEOUT, polling: 50 },
  );
  const deadline = Date.now() + ELEMENT_TIMEOUT;
  let before = await mounted(frame, of);

  for (;;) {
    await frame.waitForTimeout(150);
    const rows = await mounted(frame, of);

    if (rows.join("\n") === before.join("\n")) return rows;
    if (Date.now() > deadline) throw new Error(`The list did not settle after the search of "${text}"`);
    before = rows;
  }
}

/** Scrolls the list to a position, in pixels from its top, and waits for the list to be there. */
export async function scrollList(frame: Frame, position: number, of: ListOf = BACKUPS): Promise<void> {
  const found = await frame.evaluate(
    ({ list, top }) => {
      const scrolled = document.querySelector(`${list} .VirtualList .list`);

      if (scrolled) scrolled.scrollTop = top;
      return scrolled !== null;
    },
    { list: list(of), top: position },
  );

  if (!found) throw new Error(`The list of the ${of.id} has nothing to scroll`);
  await frame.waitForFunction(
    ({ list, top }) => {
      const scrolled = document.querySelector(`${list} .VirtualList .list`);

      // A list shorter than the position stops where it ends.
      return (
        scrolled !== null &&
        (Math.abs(scrolled.scrollTop - top) <= 2 ||
          scrolled.scrollTop >= scrolled.scrollHeight - scrolled.clientHeight - 2)
      );
    },
    { list: list(of), top: position },
    { timeout: ELEMENT_TIMEOUT, polling: 50 },
  );
  await frame.waitForTimeout(300);
}

/** Drags the edge of a column of the list, and answers its width before and after. */
export async function resizeColumn(
  frame: Frame,
  column: string,
  pixels: number,
  of: ListOf = BACKUPS,
): Promise<{ before: number; after: number }> {
  const cell = frame.locator(`${list(of)} .TableHead .TableCell.${column}`);
  const handle = cell.locator(".resize-handle");
  const before = (await cell.boundingBox())?.width ?? 0;
  const box = await handle.boundingBox();

  if (!box) throw new Error(`The column ${column} has no edge to drag`);
  const mouse = frame.page().mouse;

  await mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await mouse.down();
  await mouse.move(box.x + box.width / 2 + pixels / 2, box.y + box.height / 2, { steps: 5 });
  await mouse.move(box.x + box.width / 2 + pixels, box.y + box.height / 2, { steps: 5 });
  await mouse.up();
  await frame.waitForTimeout(300);

  return { before, after: (await cell.boundingBox())?.width ?? 0 };
}

export interface Measure {
  // From the event to the frame that shows what it changed.
  total: number;
  // From the moment the list is given what to show to the frame that shows it. The search of the host
  // waits for the keys to stop before it gives the list what was typed: that wait is in the total only.
  response: number;
}

// The time of an interaction is taken inside the page: the time the driver of the test takes to reach the
// page is not of the list.
async function measure(
  frame: Frame,
  interaction: { kind: "search"; text: string } | { kind: "open"; name: string } | { kind: "close" },
  of: ListOf,
): Promise<Measure> {
  return frame.evaluate(
    ({ list, kind, action }) =>
      new Promise<{ total: number; response: number }>((resolve, reject) => {
        const root = document.querySelector(list);
        const shown = () =>
          [
            root?.querySelector(".info-panel")?.textContent ?? "",
            ...[...(root?.querySelectorAll(`[data-${kind}-row]`) ?? [])]
              .slice(0, 40)
              .map((row) => row.getAttribute(`data-${kind}-row`)),
            document.querySelector(`[data-testid=velero-${kind}-workspace]`)?.getAttribute(`data-${kind}-uid`) ?? "",
            root?.closest("[aria-hidden]") ? "behind" : "shown",
          ].join("|");
        const searched = () => new URLSearchParams(window.location.search).get("search") ?? "";
        const before = shown();
        const start = performance.now();
        // When the list was last seen without what it has to show: the latest moment it can have got it.
        let given = start;
        let waiting = action.kind === "search";
        let over = false;
        // The time that is given is counted by a timer: a window that draws no frame, because it is
        // hidden or behind another, draws none to count it by.
        const deadline = setTimeout(() => {
          over = true;
          reject(new Error(`Nothing changed after ${JSON.stringify(action)}`));
        }, 10_000);
        const wait = () => {
          const now = performance.now();

          if (over) return;
          if (waiting && searched() !== action.text && shown() === before) {
            given = now;
          } else {
            waiting = false;
          }
          if (shown() !== before) {
            requestAnimationFrame(() => {
              const end = performance.now();

              clearTimeout(deadline);
              resolve({ total: end - start, response: end - given });
            });
          } else {
            requestAnimationFrame(wait);
          }
        };
        const refuse = (reason: string) => {
          clearTimeout(deadline);
          reject(new Error(reason));
        };

        if (action.kind === "search") {
          const input = root?.querySelector<HTMLInputElement>(".SearchInput input");
          const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;

          if (!input || !set) {
            refuse("The list has no search");
            return;
          }
          // A search of what is searched already changes nothing: it has no time, and is not a sample.
          if (input.value === action.text) {
            refuse(`The list is searched by "${action.text}" already: nothing to measure`);
            return;
          }
          set.call(input, action.text);
          input.dispatchEvent(new Event("input", { bubbles: true }));
        } else if (action.kind === "open") {
          const row = [...(root?.querySelectorAll<HTMLElement>(`[data-${kind}-row]`) ?? [])].find(
            (element) => element.getAttribute(`data-${kind}-row`) === action.name,
          );

          if (!row) {
            refuse(`No row of ${action.name} is mounted`);
            return;
          }
          row.click();
        } else {
          const back = document.querySelector<HTMLElement>("[data-testid=velero-back]");

          if (!back) {
            refuse("No view is open: there is no way back to take");
            return;
          }
          back.click();
        }
        requestAnimationFrame(wait);
      }),
    { list: list(of), kind: of.kind, action: interaction },
  );
}

export async function measureSearch(frame: Frame, text: string, of: ListOf = BACKUPS): Promise<Measure> {
  return measure(frame, { kind: "search", text }, of);
}

export async function measureOpen(frame: Frame, name: string, of: ListOf = BACKUPS): Promise<Measure> {
  return measure(frame, { kind: "open", name }, of);
}

export async function measureClose(frame: Frame, of: ListOf = BACKUPS): Promise<Measure> {
  return measure(frame, { kind: "close" }, of);
}

/** The objects whose rows are all inside what the list shows: a click on one does not scroll the list. */
export async function visibleRowsOf(frame: Frame, of: ListOf): Promise<string[]> {
  return frame.evaluate(
    ({ list, kind }) => {
      const shown = document.querySelector(`${list} .VirtualList .list`)?.getBoundingClientRect();

      if (!shown) return [];
      return [...document.querySelectorAll<HTMLElement>(`${list} [data-${kind}-row]`)]
        .filter((row) => {
          const box = (row.closest(".TableRow") ?? row).getBoundingClientRect();

          return box.top >= shown.top && box.bottom <= shown.bottom;
        })
        .map((row) => row.getAttribute(`data-${kind}-row`) ?? "");
    },
    { list: list(of), kind: of.kind },
  );
}

export async function visibleBackups(frame: Frame): Promise<string[]> {
  return visibleRowsOf(frame, BACKUPS);
}

/** Opens the view of an object from its row, and waits for it. */
export async function openWorkspace(frame: Frame, name: string, of: ListOf = BACKUPS): Promise<void> {
  await frame.click(`${list(of)} [data-${of.kind}-row="${name}"]`);
  await frame.waitForSelector(`[data-testid=velero-${of.kind}-name] >> text="${name}"`, { timeout: ELEMENT_TIMEOUT });
}

const ANY_VIEW = "[data-testid^=velero-][data-testid$=-workspace]";

/** The kind and the name of the view that is shown, or nothing when the list is. */
export async function shownView(frame: Frame): Promise<{ kind: string; name: string; back: string } | undefined> {
  const view = frame.locator(ANY_VIEW);

  if ((await view.count()) === 0) return undefined;
  const kind = ((await view.first().getAttribute("data-testid")) ?? "").replace(/^velero-|-workspace$/g, "");

  return {
    kind,
    name: (await frame.locator(`[data-testid=velero-${kind}-name]`).innerText()).trim(),
    back: (await frame.locator("[data-testid=velero-back]").innerText()).replace(/\s+/g, " ").trim(),
  };
}

/** Follows a way to another view, and waits for that view. */
export async function followTo(frame: Frame, kind: string, name: string): Promise<void> {
  await frame.click(`${ANY_VIEW} [data-testid="velero-open-${kind}-${name}"]`);
  await frame.waitForSelector(`[data-testid=velero-${kind}-name] >> text="${name}"`, { timeout: ELEMENT_TIMEOUT });
}

/** Leaves every view that is open: what a case before this one may have left. */
export async function showList(frame: Frame): Promise<void> {
  for (let views = 0; views < 10 && (await frame.locator(ANY_VIEW).count()) > 0; views += 1) {
    await frame.click("[data-testid=velero-back]");
    await frame.waitForTimeout(200);
  }
}

/** Takes the way back of the view that is shown, and waits for what is under it. */
export async function closeWorkspace(frame: Frame): Promise<void> {
  const before = await shownView(frame);

  await frame.click("[data-testid=velero-back]");
  await frame.waitForFunction(
    ({ selector, shown }) => {
      const view = document.querySelector(selector);
      const kind = (view?.getAttribute("data-testid") ?? "").replace(/^velero-|-workspace$/g, "");
      const name = document.querySelector(`[data-testid=velero-${kind}-name]`)?.textContent?.trim() ?? "";

      return !view || `${kind}/${name}` !== shown;
    },
    { selector: ANY_VIEW, shown: `${before?.kind}/${before?.name}` },
    { timeout: ELEMENT_TIMEOUT },
  );
}

/**
 * What the workspace says of a reference, with the state it gives to it. With
 * a state that is expected, the reference is waited for until it has it: what
 * it refers to may be read after the view is shown.
 */
export async function reference(
  frame: Frame,
  testId: string,
  expected?: string,
): Promise<{ state: string; text: string }> {
  const element = frame.locator(`[data-testid="${testId}"]`).first();

  await element.waitFor({ state: "visible", timeout: ELEMENT_TIMEOUT });
  if (expected !== undefined) {
    await frame
      .waitForFunction(
        ({ id, state }) => document.querySelector(`[data-testid="${id}"]`)?.getAttribute("data-reference") === state,
        { id: testId, state: expected },
        { timeout: ELEMENT_TIMEOUT, polling: 100 },
      )
      .catch(() => undefined);
  }

  return {
    state: (await element.getAttribute("data-reference")) ?? "",
    text: (await element.innerText()).replace(/\s+/g, " ").trim(),
  };
}

/** The backups a history lists, from the first it shows, and the marks of its line of time, from the oldest. */
export async function history(
  frame: Frame,
): Promise<{ rows: string[]; marks: string[]; over: string[]; width: number }> {
  const drawn = await frame.$$eval("[data-strip-mark]", (elements) =>
    elements.map((element) => {
      const { left, right } = element.getBoundingClientRect();

      return {
        name: element.getAttribute("data-strip-mark") ?? "",
        left,
        right,
        line: element.parentElement?.getBoundingClientRect().width ?? 0,
      };
    }),
  );

  return {
    rows: await frame.$$eval("[data-history-row]", (elements) =>
      elements.map((element) => element.getAttribute("data-history-row") ?? ""),
    ),
    marks: drawn.map((mark) => mark.name),
    // The marks that are drawn over the one before them, by more than the rounding of a pixel.
    over: drawn.filter((mark, index) => index > 0 && mark.left < drawn[index - 1].right - 1).map((mark) => mark.name),
    width: drawn[0]?.line ?? 0,
  };
}

/** The backups the marks of a line hold, from the oldest: the ones of a mark are written from the newest. */
export function backupsOnTheLine(marks: string[]): string[] {
  return marks.flatMap((mark) => mark.split(",").reverse());
}

/** The mark of a line that holds a backup. */
export function markOf(marks: string[], backup: string): string {
  const found = marks.find((mark) => mark.split(",").includes(backup));

  if (!found) throw new Error(`No mark of the line holds ${backup}`);

  return found;
}

/**
 * How wide a day is on the line of time of the schedule with a history, in
 * pixels. The line goes from the oldest backup to now, and the fixtures are
 * put in place once: in an environment that is some weeks old the days are
 * closer than a mark is wide, and a mark holds more than one. What a suite
 * expects of the days, it expects of an environment where each has its mark:
 * in an older one it stops here, and says what to do.
 */
export function dayOnTheLine(width: number, oldest = "views-history-6"): number {
  const read = kubectlE2E(
    "get",
    "backups.velero.io",
    oldest,
    "--namespace",
    E2E_VIEWS_NAMESPACE,
    "-o",
    "jsonpath={.status.startTimestamp}",
  );
  const from = Date.parse(read.stdout.trim());

  if (read.status !== 0 || !Number.isFinite(from)) throw new Error(`The start of ${oldest} could not be read`);
  const day = (width * 86_400_000) / (Date.now() - from);

  if (day < 2 * MARK_WIDTH) {
    throw new Error(
      `The environment is too old for what this suite expects of the line of time: a day is ${Math.round(day)} pixels ` +
        `of a line of ${Math.round(width)}, and a mark is ${MARK_WIDTH}. Create the environment again with ` +
        "`pnpm demo:down` and `pnpm demo:up`.",
    );
  }

  return day;
}

async function shownNotices(frame: Frame): Promise<Record<string, string>> {
  const found = await frame.$$eval("[data-testid^=velero-notice-]", (elements) =>
    elements.map((element) => [
      (element.getAttribute("data-testid") ?? "").replace("velero-notice-", ""),
      (element.textContent ?? "").replace(/\s+/g, " ").trim(),
    ]),
  );

  return Object.fromEntries(found);
}

/**
 * The notices of what is missing of the installation that is shown, once
 * nothing is being read: before that, a family that will be denied has no
 * notice yet. With the families that are expected to have a notice, the
 * notices are waited for until they are of those families; the ones that are
 * there when the time is over are answered.
 */
export async function notices(frame: Frame, expected?: string[]): Promise<Record<string, string>> {
  const deadline = Date.now() + ELEMENT_TIMEOUT;
  const wanted = expected ? [...expected].sort().join(",") : undefined;

  for (;;) {
    const state = await readState(frame);
    const found = await shownNotices(frame);

    if (!state.reading && (wanted === undefined || Object.keys(found).sort().join(",") === wanted)) return found;
    if (Date.now() > deadline) return found;
    await frame.waitForTimeout(200);
  }
}

/** Asks the views to read again, and waits for the read to end. */
export async function readAgain(frame: Frame): Promise<void> {
  const seen = (await readState(frame)).read;

  await frame.click("[data-testid=velero-refresh]");
  await afterRead(frame, seen);
}

/**
 * What is wrong with the layout of the page of the backups: what is wider than
 * its room, what lies over something else, what of the target cannot be read.
 * An empty answer is a layout with none of these.
 */
export async function layoutProblems(frame: Frame, of: ListOf = BACKUPS): Promise<string[]> {
  return frame.evaluate(({ id }) => {
    const problems: string[] = [];
    const page = document.querySelector<HTMLElement>(`[data-testid=velero-${id}-page]`);

    if (!page) return [`The page of the ${id} is not there`];
    const shown = (element: Element) => {
      const box = element.getBoundingClientRect();
      const style = getComputedStyle(element);

      return box.width > 0 && box.height > 0 && style.visibility !== "hidden" && style.display !== "none";
    };
    const name = (element: Element) =>
      element.getAttribute("data-testid") ??
      `${element.tagName.toLowerCase()}.${String(element.className).split(" ")[0]}`;
    const overlaps = (selector: string) => {
      const parts = [...page.querySelectorAll(selector)].filter(shown);

      for (let first = 0; first < parts.length; first += 1) {
        for (let second = first + 1; second < parts.length; second += 1) {
          const one = parts[first].getBoundingClientRect();
          const other = parts[second].getBoundingClientRect();
          const width = Math.min(one.right, other.right) - Math.max(one.left, other.left);
          const height = Math.min(one.bottom, other.bottom) - Math.max(one.top, other.top);

          if (width > 1 && height > 1) problems.push(`${name(parts[first])} lies over ${name(parts[second])}`);
        }
      }
    };
    const inside = page.getBoundingClientRect();

    if (inside.right > window.innerWidth + 1) problems.push("The page is wider than the window");
    // What holds the page, up to the frame: the page is given a room by the host, and what is wider than
    // it is scrolled sideways by the host, under a bar the operator has to find.
    for (let holder: HTMLElement | null = page; holder; holder = holder.parentElement) {
      const scrolls = ["auto", "scroll"].includes(getComputedStyle(holder).overflowX);

      if (scrolls && holder.scrollWidth > holder.clientWidth + 1) {
        problems.push(
          `The page is wider than the room the host gives it: ${holder.scrollWidth} in ${holder.clientWidth} of ${name(holder)}`,
        );
      }
    }
    // The page has the height of its room, and what is taller is scrolled inside the page. What holds the
    // page and is taller than itself can be scrolled by the keyboard, which brings what it reaches into
    // view: the target bar would go where nothing brings it back from.
    for (let holder: HTMLElement | null = page; holder; holder = holder.parentElement) {
      // What is scrolled by who reads it is reached, and brought back: what is cut is not.
      if (["auto", "scroll"].includes(getComputedStyle(holder).overflowY)) continue;
      if (holder.scrollHeight > holder.clientHeight + 1) {
        problems.push(
          `${name(holder)} cuts what is taller than its room: ${holder.scrollHeight} in ${holder.clientHeight}`,
        );
      }
      if (holder.scrollTop !== 0) problems.push(`${name(holder)} is scrolled by ${holder.scrollTop}`);
    }
    if (document.querySelectorAll(".TabLayout .TabLayout").length > 0) {
      problems.push("The layout of the host is inside itself: the page has its margins twice");
    }
    for (const element of page.querySelectorAll<HTMLElement>(
      "[data-testid=velero-target], [data-testid$=-workspace], [class*=state], [data-testid=velero-coverage]",
    )) {
      if (shown(element) && element.scrollWidth > element.clientWidth + 1) {
        problems.push(`${name(element)} is wider than its room: ${element.scrollWidth} in ${element.clientWidth}`);
      }
    }
    overlaps("[data-testid=velero-target] > *");
    overlaps("[data-testid$=-workspace] [data-testid$=-status] > *");
    overlaps("[data-testid$=-workspace] [data-testid$=-scope] > *");
    overlaps("[data-testid$=-workspace] [data-testid$=-stages] > *");
    overlaps("[data-testid=velero-history-strip] [data-strip-mark]");
    overlaps("[data-testid=velero-overview-read] > *");
    overlaps("[data-testid=velero-overview-windows] > button");
    overlaps("[data-line-row=backups] [data-line-mark]");
    overlaps("[data-line-row=restores] [data-line-mark]");
    for (const band of page.querySelectorAll<HTMLElement>(
      "[data-testid=velero-overview] > *, section[data-testid^=velero-overview-]",
    )) {
      if (shown(band) && band.scrollWidth > band.clientWidth + 1) {
        problems.push(`${name(band)} is wider than its room: ${band.scrollWidth} in ${band.clientWidth}`);
      }
    }
    overlaps(`[data-testid=velero-${id}] .TableHead .TableCell`);
    for (const row of [...page.querySelectorAll(`[data-testid=velero-${id}] .TableRow:not(.TableHead)`)].slice(0, 20)) {
      const cells = [...row.querySelectorAll(".TableCell")].filter(shown);

      for (let index = 1; index < cells.length; index += 1) {
        if (cells[index].getBoundingClientRect().left < cells[index - 1].getBoundingClientRect().right - 1) {
          problems.push(`A cell of the list lies over the one before it`);
        }
      }
    }
    for (const selector of ["[data-testid=velero-target-cluster]", "[data-testid=velero-target] .Select__control"]) {
      const element = page.querySelector<HTMLElement>(selector);

      if (!element || !shown(element)) {
        problems.push(`${selector} is not shown`);
        continue;
      }
      const box = element.getBoundingClientRect();

      if (box.left < 0 || box.right > window.innerWidth + 1 || box.top < 0 || box.bottom > window.innerHeight + 1) {
        problems.push(`${selector} is out of the window`);
      }
    }

    return problems;
  }, of);
}

/** The test id, or the name of the row, of what has the focus of the keyboard. */
export async function focused(frame: Frame): Promise<string> {
  return frame.evaluate(() => {
    const element = document.activeElement;
    const row = [...(element?.attributes ?? [])].find((attribute) => /^data-[a-z-]+-row$/.test(attribute.name));

    return (
      element?.getAttribute("data-testid") ??
      row?.value ??
      element?.getAttribute("aria-label") ??
      element?.tagName.toLowerCase() ??
      ""
    );
  });
}

/**
 * Waits for the focus of the keyboard to be on what is expected, and answers
 * where it is when the time is over. The views give the focus in the frames
 * after the one that shows them.
 */
export async function focusOn(frame: Frame, expected: string, timeout = 10_000): Promise<string> {
  const deadline = Date.now() + timeout;
  let focus = await focused(frame);

  while (focus !== expected && Date.now() < deadline) {
    await frame.waitForTimeout(50);
    focus = await focused(frame);
  }

  return focus;
}

/** The views the address names, in the order it names them. */
export async function addressViews(frame: Frame): Promise<string[]> {
  return frame.evaluate(() => new URLSearchParams(window.location.search).getAll("view"));
}

/** What was set for the window and the theme, as the application and the frame of the cluster have it. */
export async function applied(frame: Frame): Promise<{ theme: string; width: number; height: number }> {
  const size = await frame.page().evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }));

  return {
    theme: await frame.evaluate(() => (document.body.classList.contains("theme-light") ? "light" : "dark")),
    ...size,
  };
}

/** Waits for the window and the theme to be what was set, and answers what they are when the time is over. */
export async function appliedLike(
  frame: Frame,
  expected: { theme: string; width: number; height: number },
  timeout = 20_000,
): Promise<{ theme: string; width: number; height: number }> {
  const deadline = Date.now() + timeout;
  const like = (state: { theme: string; width: number; height: number }) =>
    state.theme === expected.theme &&
    Math.abs(state.width - expected.width) <= 2 &&
    Math.abs(state.height - expected.height) <= 2;
  let state = await applied(frame);

  while (!like(state) && Date.now() < deadline) {
    await frame.waitForTimeout(200);
    state = await applied(frame);
  }

  return like(state) ? expected : state;
}

/** Takes a screenshot that has to be there: the path of a picture that was written, with something in it. */
export async function requiredScreenshot(frame: Frame, name: string, zoom = 1): Promise<string> {
  const file = await captureScreenshot(frame, name, zoom);

  if (!file) throw new Error(`The screenshot ${name} was not taken`);
  if ((await stat(file)).size === 0) throw new Error(`The screenshot ${name} is empty`);

  return file;
}

/**
 * Counts the changes of the address of the frame from now on: the entries that
 * are added to its history and the ones that are replaced. The history of a
 * frame stops growing at fifty entries, and says nothing of what is replaced.
 */
export async function countAddressChanges(frame: Frame): Promise<void> {
  await frame.evaluate(() => {
    const page = window as unknown as { veleroAddressChanges?: { pushed: number; replaced: number } };

    if (page.veleroAddressChanges) return;
    const changes = { pushed: 0, replaced: 0 };
    const push = window.history.pushState.bind(window.history);
    const replace = window.history.replaceState.bind(window.history);

    page.veleroAddressChanges = changes;
    window.history.pushState = (...parameters: Parameters<History["pushState"]>) => {
      changes.pushed += 1;
      push(...parameters);
    };
    window.history.replaceState = (...parameters: Parameters<History["replaceState"]>) => {
      changes.replaced += 1;
      replace(...parameters);
    };
  });
}

/** How many times the address of the frame changed since the changes are counted. */
export async function addressChanges(frame: Frame): Promise<number> {
  return frame.evaluate(() => {
    const changes = (window as unknown as { veleroAddressChanges?: { pushed: number; replaced: number } })
      .veleroAddressChanges;

    if (!changes) throw new Error("The changes of the address are not counted: countAddressChanges comes first");
    return changes.pushed + changes.replaced;
  });
}

/**
 * Presses Tab until the focus is on what `reached` says, and answers how many
 * times it took. It gives up after `limit` times.
 */
export async function tabTo(
  frame: Frame,
  reached: (focus: string) => boolean,
  limit = 40,
  key = "Tab",
): Promise<number> {
  for (let presses = 1; presses <= limit; presses += 1) {
    await frame.page().keyboard.press(key);
    if (reached(await focused(frame))) return presses;
  }

  throw new Error(
    `The keyboard did not reach its target in ${limit} presses; the focus is on "${await focused(frame)}"`,
  );
}

/**
 * Points the namespace filter of the host at one namespace. The lists of the
 * host show the namespaces of its filter, and a fresh profile selects
 * `default`: the fixtures are elsewhere.
 */
export async function selectHostNamespace(frame: Frame, namespace: string): Promise<void> {
  const select = await frame.waitForSelector(".NamespaceSelect", { timeout: ELEMENT_TIMEOUT });

  await select.click();
  await select.type(namespace);

  const option = frame.locator(".Select__option").filter({ has: frame.locator(`span:text-is("${namespace}")`) });

  if ((await option.count()) > 0) {
    await option.first().click();
  } else {
    await select.press("Enter");
  }
  // The menu does not close on select, and would cover the table underneath.
  if ((await frame.locator(".Select__menu").count()) > 0) {
    await select.click();
  }
  await frame.waitForSelector(`[data-testid="namespace-select-filter"] >> text="Namespace: ${namespace}"`, {
    timeout: ELEMENT_TIMEOUT,
  });
}

/** The details the host shows of an object, as one line, once they show every text that is expected. */
export async function hostDetails(frame: Frame, name: string, ...texts: string[]): Promise<string> {
  await frame.locator(".TableRow", { hasText: name }).first().locator(".TableCell", { hasText: name }).first().click();

  const drawer = frame.locator(".Drawer.KubeObjectDetails");

  await drawer.waitFor({ state: "visible", timeout: ELEMENT_TIMEOUT });
  const deadline = Date.now() + ELEMENT_TIMEOUT;
  let text = "";
  let missing: string | undefined;

  do {
    text = (await drawer.innerText()).replace(/\s+/g, " ").trim();
    missing = texts.find((expected) => !text.includes(expected));
    if (!missing) break;
    await frame.waitForTimeout(500);
  } while (Date.now() < deadline);

  if (missing) {
    throw new Error(`Details of "${name}" should show "${missing}", got "${text}"`);
  }

  return text;
}

/**
 * Closes the details of the host, wherever the keyboard happens to be: Escape
 * on the drawer, and then its close icon, which needs no focus. A terminal in
 * the dock of the host holds the keyboard and takes the key for itself.
 */
export async function closeDetails(frame: Frame): Promise<void> {
  const drawer = frame.locator(".Drawer.KubeObjectDetails").first();

  await drawer.press("Escape", { timeout: DRAWER_ESCAPE_TIMEOUT }).catch(() => {});

  try {
    await frame.waitForSelector(".Drawer.KubeObjectDetails", { state: "hidden", timeout: DRAWER_ESCAPE_TIMEOUT });

    return;
  } catch {
    // The key went somewhere else. The close icon does not care.
  }

  await drawer
    .locator('.drawer-title > .Icon:has([data-icon-name="close"])')
    .click({ timeout: DRAWER_ESCAPE_TIMEOUT })
    .catch(() => {});
  await frame.waitForSelector(".Drawer.KubeObjectDetails", { state: "hidden", timeout: ELEMENT_TIMEOUT });
}

export interface OverviewShown {
  /** What was read of each family: the words of its cell, and its state. */
  read: Record<string, { text: string; state: string }>;
  summary: string;
  /** The items that are shown, in their order: the rule, and what each one names. */
  items: [rule: string, name: string][];
  unchecked: string[];
  inFlight: string[];
  recent: string[];
  /** The window that is chosen. */
  window: string;
  from: string;
  marks: { backups: string[]; restores: string[] };
  schedules: string[];
  storage: string[];
  completed: string;
}

/**
 * Waits for the Overview to have read the installation that is selected, and
 * answers what it shows, in the words of each of its parts and without the
 * names of the marks.
 */
export async function overview(frame: Frame): Promise<OverviewShown> {
  await frame.waitForFunction(
    () => {
      const cells = [...document.querySelectorAll("[data-testid^=velero-overview-read-]")];

      return cells.length === 5 && cells.every((cell) => cell.getAttribute("data-read") !== "not-read");
    },
    undefined,
    { timeout: ELEMENT_TIMEOUT },
  );

  return frame.evaluate(() => {
    // The words as they are read, a part after the other, without the names of the marks: the marks
    // are taken out of what is drawn for the time of the reading, and put back.
    const words = (element: Element | null | undefined) => {
      if (!element) return "";
      const icons = [...element.querySelectorAll<HTMLElement>(".Icon")];
      const shown = icons.map((icon) => icon.style.display);

      for (const icon of icons) icon.style.display = "none";
      const text = (element as HTMLElement).innerText.replace(/\s+/g, " ").trim();

      icons.forEach((icon, index) => {
        icon.style.display = shown[index];
      });
      return text;
    };
    const all = (selector: string) => [...document.querySelectorAll(selector)];
    const names = (selector: string, attribute: string) =>
      all(selector).map((element) => element.getAttribute(attribute) ?? "");

    return {
      read: Object.fromEntries(
        all("[data-testid^=velero-overview-read-]").map((cell) => [
          (cell.getAttribute("data-testid") ?? "").replace("velero-overview-read-", ""),
          // The parts of a cell are one under the other: a space is between them when they are read.
          // They are read as they are written: how the name of a family is drawn is of its style.
          {
            text: [...cell.children].map((part) => (part.textContent ?? "").replace(/\s+/g, " ").trim()).join(" "),
            state: cell.getAttribute("data-read") ?? "",
          },
        ]),
      ),
      summary: words(document.querySelector("[data-testid=velero-overview-attention-summary]")),
      items: all("[data-testid=velero-overview-attention] [data-rule]").map(
        (item) => [item.getAttribute("data-rule") ?? "", words(item.querySelector("button, a"))] as [string, string],
      ),
      unchecked: names("[data-testid=velero-overview-attention] [data-unchecked]", "data-unchecked"),
      inFlight: names("[data-testid=velero-overview-in-flight-list] [data-operation]", "data-operation"),
      recent: names("[data-testid=velero-overview-recent-list] [data-operation]", "data-operation"),
      window: (
        document
          .querySelector("[data-testid^=velero-overview-window-][aria-pressed=true]")
          ?.getAttribute("data-testid") ?? ""
      ).replace("velero-overview-window-", ""),
      from: words(document.querySelector("[data-testid=velero-overview-line-from]")),
      marks: {
        backups: names("[data-line-row=backups] [data-line-mark]", "data-line-mark"),
        restores: names("[data-line-row=restores] [data-line-mark]", "data-line-mark"),
      },
      schedules: names("[data-testid=velero-overview-schedules-list] [data-line]", "data-line"),
      storage: names("[data-testid=velero-overview-storage-list] [data-line]", "data-line"),
      completed: words(document.querySelector("[data-testid=velero-overview-completed] [data-completed]")),
    };
  });
}

/** Chooses a window of the recent operations, and waits for the page to show it. */
export async function chooseWindow(frame: Frame, window: string): Promise<void> {
  await frame.click(`[data-testid=velero-overview-window-${window}]`);
  await frame.waitForSelector(`[data-testid=velero-overview-window-${window}][aria-pressed=true]`, {
    timeout: ELEMENT_TIMEOUT,
  });
}

/**
 * Chooses a window of the recent operations and measures the answer: from the
 * click to the frame after the one in which the page shows the window.
 */
export async function measureWindow(frame: Frame, window: string): Promise<Measure> {
  return frame.evaluate(
    (chosen) =>
      new Promise<{ total: number; response: number }>((resolve, reject) => {
        const button = document.querySelector<HTMLElement>(`[data-testid=velero-overview-window-${chosen}]`);
        const from = () => document.querySelector("[data-testid=velero-overview-line-from]")?.textContent ?? "";

        if (!button) {
          reject(new Error(`The Overview has no window of ${chosen}`));
          return;
        }
        // A window that is chosen already changes nothing: it has no time, and is not a sample.
        if (button.getAttribute("aria-pressed") === "true") {
          reject(new Error(`The window of ${chosen} is chosen already: nothing to measure`));
          return;
        }
        const before = from();
        const start = performance.now();
        const deadline = setTimeout(() => reject(new Error(`Nothing changed after the window of ${chosen}`)), 10_000);
        const wait = () => {
          if (button.getAttribute("aria-pressed") === "true" && from() !== before) {
            requestAnimationFrame(() => {
              const end = performance.now();

              clearTimeout(deadline);
              resolve({ total: end - start, response: end - start });
            });
          } else {
            requestAnimationFrame(wait);
          }
        };

        button.click();
        requestAnimationFrame(wait);
      }),
    window,
  );
}

/** Where the Overview is scrolled, after it was asked to go somewhere when a position is given. */
export async function scrollOverview(frame: Frame, position?: number): Promise<number> {
  const scrolled = await frame.evaluate((top) => {
    const page = document.querySelector<HTMLElement>("[data-testid=velero-overview]");

    if (!page) throw new Error("The Overview is not shown");
    if (top !== undefined) page.scrollTop = top;
    return page.scrollTop;
  }, position);

  if (position !== undefined) await frame.waitForTimeout(300);
  return scrolled;
}

/**
 * What is said of an operation in a list of the Overview, without the names
 * of the marks: by the names of the columns in the list of the recent
 * operations, and by the names of its parts among the ones in flight, which
 * are not in a table.
 */
export async function operationCells(
  frame: Frame,
  list: "in-flight" | "recent",
  operation: string,
): Promise<Record<string, string>> {
  const row = frame.locator(`[data-testid=velero-overview-${list}-list] [data-operation="${operation}"]`);

  await row.waitFor({ state: "visible", timeout: ELEMENT_TIMEOUT });
  return row.evaluate((element) => {
    const columns = [...(element.closest("table")?.querySelectorAll("thead th") ?? [])].map((head) =>
      (head.textContent ?? "").trim().toLowerCase(),
    );
    // As a part is read, with its marks out of what is drawn for the time of the reading.
    const words = (part: HTMLElement | null) => {
      if (!part) return "";
      const icons = [...part.querySelectorAll<HTMLElement>(".Icon")];
      const shown = icons.map((icon) => icon.style.display);

      for (const icon of icons) icon.style.display = "none";
      const text = part.innerText.replace(/\s+/g, " ").trim();

      icons.forEach((icon, at) => {
        icon.style.display = shown[at];
      });
      return text;
    };
    const cells = [...element.querySelectorAll<HTMLElement>("td")];

    if (cells.length) {
      return Object.fromEntries(cells.map((cell, index) => [columns[index] ?? String(index), words(cell)]));
    }
    return {
      operation: words(element.querySelector<HTMLElement>("[data-testid^=velero-open-]")),
      ...Object.fromEntries(
        [...element.querySelectorAll<HTMLElement>("[data-part]")].map((part) => [
          part.getAttribute("data-part") ?? "",
          words(part),
        ]),
      ),
    };
  });
}

/**
 * What the Overview would say of the installation as a whole, if it said it:
 * the words of a verdict, a percentage outside the progress of an operation,
 * a meter. An empty answer is a page that says none.
 */
export async function valuesOfTheWhole(frame: Frame): Promise<string[]> {
  return frame.evaluate(() => {
    const page = document.querySelector<HTMLElement>("[data-testid=velero-overview]");

    if (!page) return ["The Overview is not shown"];
    const found: string[] = [];
    const verdict = /healthy|protected|\bsafe\b|all is well|\bscore\b|\bstatus of the installation\b/i;
    const said = (element: Element) => {
      const copy = element.cloneNode(true) as HTMLElement;

      for (const icon of copy.querySelectorAll(".Icon")) icon.remove();
      // What a mark says to who points at it is said as well.
      return [
        copy.textContent ?? "",
        ...[...element.querySelectorAll("[title], [aria-label]")].map(
          (part) => `${part.getAttribute("title") ?? ""} ${part.getAttribute("aria-label") ?? ""}`,
        ),
      ].join(" ");
    };
    const words = verdict.exec(said(page));

    if (words) found.push(`The page says "${words[0]}"`);
    for (const band of page.querySelectorAll("[data-testid=velero-overview-read], section[data-testid]")) {
      const id = band.getAttribute("data-testid") ?? "";

      // A percentage is of the items of one operation, in the lists of the operations.
      if (id === "velero-overview-in-flight" || id === "velero-overview-recent") continue;
      if (/%/.test(said(band))) found.push(`${id} shows a percentage`);
    }
    if (page.querySelector("[role=progressbar], [role=meter], meter, progress")) found.push("The page has a meter");
    return found;
  });
}
