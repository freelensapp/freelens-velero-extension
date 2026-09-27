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
import { copyFile, mkdir, writeFile } from "node:fs/promises";
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
/** Where the long list is: a thousand backups and no storage location. */
export const E2E_SCALE_NAMESPACE = process.env.E2E_SCALE_NAMESPACE || "";

/** The namespaces a discovery finds: the ones that hold a backup storage location. */
export const SUGGESTED_NAMESPACES = [E2E_NAMESPACE, E2E_STATIC_NAMESPACE, E2E_VIEWS_NAMESPACE];

/** Connecting a cluster involves starting a proxy, so it is not quick. */
const CLUSTER_TIMEOUT = 3 * 60 * 1000;
const ELEMENT_TIMEOUT = 60 * 1000;
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
    { encoding: "utf8", maxBuffer: 64 * 1024 ** 2 },
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
    [E2E_SCALE_NAMESPACE, "backups.velero.io", "backup-1000"],
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
  const synthetic = [E2E_STATIC_NAMESPACE, E2E_VIEWS_NAMESPACE, E2E_SCALE_NAMESPACE];
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

/** The requests that change something, or ask Velero for something, among the ones counted. */
export function writes(counts: Record<string, number>, kinds?: string[]): Record<string, number> {
  return Object.fromEntries(
    Object.entries(counts).filter(([key]) => {
      const [verb, kind] = key.split(" ");

      return !["GET", "LIST", "WATCH"].includes(verb) && (!kinds || kinds.includes(kind));
    }),
  );
}

export const REQUEST_KINDS = REQUESTS;

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
 * Opens the Backups of Velero from the sidebar and waits for the page, in
 * whatever state it is: a list, or what is shown before one.
 */
export async function openBackups(frame: Frame): Promise<void> {
  const group = sidebarItemTestId("velero");

  if ((await frame.$(`[data-parent-id-test="${group}"]`)) === null) {
    await clickSidebarItem(frame, sidebarLinkTestId("velero"));
    await frame.waitForSelector(`[data-parent-id-test="${group}"]`, { timeout: ELEMENT_TIMEOUT });
  }
  await clickSidebarItem(frame, sidebarLinkTestId("velero-backups"));

  try {
    await frame.waitForSelector("[data-testid=velero-backups-page]", { timeout: ELEMENT_TIMEOUT });
  } catch {
    const screenshot = await captureScreenshot(frame, "page-velero-backups");
    const testIds = await sidebarTestIds(frame);

    throw new Error(
      "The page of the backups never rendered. " +
        `Sidebar test ids present: ${testIds.length > 0 ? testIds.join(", ") : "(none)"}.` +
        (screenshot ? ` Screenshot: ${screenshot}` : ""),
    );
  }
}

/** Goes to an address of the application, as a link of the application would. */
export async function navigate(frame: Frame, address: string): Promise<void> {
  await frame.evaluate((target) => {
    window.history.pushState({}, "", target);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }, address);
}

/** The state the page is in, by the test id of what it shows. */
export async function entryState(frame: Frame): Promise<string> {
  const shown = frame.locator("[data-testid^=velero-state-], [data-testid=velero-backups]").first();

  await shown.waitFor({ state: "attached", timeout: ELEMENT_TIMEOUT });

  return (await shown.getAttribute("data-testid")) ?? "";
}

/** Waits for the list of the backups to show at least one row. */
export async function waitForBackups(frame: Frame): Promise<void> {
  await frame.waitForSelector("[data-testid=velero-backups] .TableRow:not(.TableHead)", { timeout: ELEMENT_TIMEOUT });
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

function tableRow(frame: Frame, name: string): Locator {
  return frame.locator("[data-testid=velero-backups] .TableRow", { hasText: name }).first();
}

/** The cells of a row, as one line, so that adjacent columns can be matched. */
async function rowText(row: Locator): Promise<string> {
  return (await row.innerText()).replace(/\s+/g, " ").trim();
}

/**
 * Asserts that the list has a row for `name` and that the row shows every one
 * of the given values.
 */
export async function expectRow(frame: Frame, name: string, ...cells: string[]): Promise<void> {
  const row = tableRow(frame, name);

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

/** The names of the backups the list has mounted, in the order it shows them. */
export async function mountedBackups(frame: Frame): Promise<string[]> {
  return frame.$$eval("[data-testid=velero-backups] [data-backup-row]", (elements) =>
    elements.map((element) => element.getAttribute("data-backup-row") ?? ""),
  );
}

const LIST = "[data-testid=velero-backups]";

/** Writes what a check measured beside the screenshots of the suite. */
export async function writeReport(name: string, report: unknown): Promise<void> {
  await mkdir(ARTIFACTS_DIR, { recursive: true });
  await writeFile(path.join(ARTIFACTS_DIR, `${name}.json`), `${JSON.stringify(report, null, 2)}\n`);
}

/** What the list says it shows: what is searched, how it is sorted, where it is scrolled, how wide it is. */
export async function listState(frame: Frame): Promise<{
  search: string;
  sorted: string;
  items: string;
  scroll: number;
  first: string;
  columns: Record<string, number>;
}> {
  return frame.evaluate((list) => {
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
      first: root?.querySelector("[data-backup-row]")?.getAttribute("data-backup-row") ?? "",
      columns,
    };
  }, LIST);
}

/** Types in the search of the list, and waits for the list to follow. */
export async function search(frame: Frame, text: string): Promise<void> {
  await frame.fill(`${LIST} .SearchInput input`, text);
  await frame.waitForTimeout(500);
}

/** Scrolls the list to a position, in pixels from its top. */
export async function scrollList(frame: Frame, position: number): Promise<void> {
  await frame.evaluate(
    ({ list, top }) => {
      const scrolled = document.querySelector(`${list} .VirtualList .list`);

      if (scrolled) scrolled.scrollTop = top;
    },
    { list: LIST, top: position },
  );
  await frame.waitForTimeout(300);
}

/** Drags the edge of a column of the list, and answers its width before and after. */
export async function resizeColumn(
  frame: Frame,
  column: string,
  pixels: number,
): Promise<{ before: number; after: number }> {
  const cell = frame.locator(`${LIST} .TableHead .TableCell.${column}`);
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
): Promise<Measure> {
  return frame.evaluate(
    ({ list, action }) =>
      new Promise<{ total: number; response: number }>((resolve, reject) => {
        const root = document.querySelector(list);
        const shown = () =>
          [
            root?.querySelector(".info-panel")?.textContent ?? "",
            ...[...(root?.querySelectorAll("[data-backup-row]") ?? [])]
              .slice(0, 40)
              .map((row) => row.getAttribute("data-backup-row")),
            document.querySelector("[data-testid=velero-backup-workspace]")?.getAttribute("data-backup-uid") ?? "",
            root?.closest("[aria-hidden]") ? "behind" : "shown",
          ].join("|");
        const searched = () => new URLSearchParams(window.location.search).get("search") ?? "";
        const before = shown();
        const start = performance.now();
        // When the list was last seen without what it has to show: the latest moment it can have got it.
        let given = start;
        let waiting = action.kind === "search";
        const wait = () => {
          const now = performance.now();

          if (waiting && searched() !== action.text && shown() === before) {
            given = now;
          } else {
            waiting = false;
          }
          if (shown() !== before) {
            requestAnimationFrame(() => {
              const end = performance.now();

              resolve({ total: end - start, response: end - given });
            });
          } else if (now - start > 10_000) {
            reject(new Error(`Nothing changed after ${JSON.stringify(action)}`));
          } else {
            requestAnimationFrame(wait);
          }
        };

        if (action.kind === "search") {
          const input = root?.querySelector<HTMLInputElement>(".SearchInput input");
          const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;

          if (!input || !set) {
            reject(new Error("The list has no search"));
            return;
          }
          if (input.value === action.text) {
            resolve({ total: 0, response: 0 });
            return;
          }
          set.call(input, action.text);
          input.dispatchEvent(new Event("input", { bubbles: true }));
        } else if (action.kind === "open") {
          const row = [...(root?.querySelectorAll<HTMLElement>("[data-backup-row]") ?? [])].find(
            (element) => element.dataset.backupRow === action.name,
          );

          if (!row) {
            reject(new Error(`No row of ${action.name} is mounted`));
            return;
          }
          row.click();
        } else {
          document.querySelector<HTMLElement>("[data-testid=velero-back]")?.click();
        }
        requestAnimationFrame(wait);
      }),
    { list: LIST, action: interaction },
  );
}

export async function measureSearch(frame: Frame, text: string): Promise<Measure> {
  return measure(frame, { kind: "search", text });
}

export async function measureOpen(frame: Frame, name: string): Promise<Measure> {
  return measure(frame, { kind: "open", name });
}

export async function measureClose(frame: Frame): Promise<Measure> {
  return measure(frame, { kind: "close" });
}

/** The backups whose rows are all inside what the list shows: a click on one does not scroll the list. */
export async function visibleBackups(frame: Frame): Promise<string[]> {
  return frame.evaluate((list) => {
    const shown = document.querySelector(`${list} .VirtualList .list`)?.getBoundingClientRect();

    if (!shown) return [];
    return [...document.querySelectorAll<HTMLElement>(`${list} [data-backup-row]`)]
      .filter((row) => {
        const box = (row.closest(".TableRow") ?? row).getBoundingClientRect();

        return box.top >= shown.top && box.bottom <= shown.bottom;
      })
      .map((row) => row.dataset.backupRow ?? "");
  }, LIST);
}

/** Opens the workspace of a backup from its row, and waits for it. */
export async function openWorkspace(frame: Frame, name: string): Promise<void> {
  await frame.click(`[data-testid=velero-backups] [data-backup-row="${name}"]`);
  await frame.waitForSelector(`[data-testid=velero-backup-workspace] >> text="${name}"`, { timeout: ELEMENT_TIMEOUT });
}

/** Leaves the workspace if one is open: what a case before this one may have left. */
export async function showList(frame: Frame): Promise<void> {
  if ((await frame.locator("[data-testid=velero-backup-workspace]").count()) > 0) await closeWorkspace(frame);
}

/** Leaves the workspace by its way back, and waits for the list. */
export async function closeWorkspace(frame: Frame): Promise<void> {
  await frame.click("[data-testid=velero-back]");
  await frame.waitForSelector("[data-testid=velero-backup-workspace]", { state: "detached", timeout: ELEMENT_TIMEOUT });
}

/** What the workspace says of a reference, with the state it gives to it. */
export async function reference(frame: Frame, testId: string): Promise<{ state: string; text: string }> {
  const element = frame.locator(`[data-testid="${testId}"]`).first();

  await element.waitFor({ state: "visible", timeout: ELEMENT_TIMEOUT });

  return {
    state: (await element.getAttribute("data-reference")) ?? "",
    text: (await element.innerText()).replace(/\s+/g, " ").trim(),
  };
}

/** The notices of what is missing of the installation that is shown. */
export async function notices(frame: Frame): Promise<Record<string, string>> {
  const found = await frame.$$eval("[data-testid^=velero-notice-]", (elements) =>
    elements.map((element) => [
      (element.getAttribute("data-testid") ?? "").replace("velero-notice-", ""),
      (element.textContent ?? "").replace(/\s+/g, " ").trim(),
    ]),
  );

  return Object.fromEntries(found);
}

/**
 * What is wrong with the layout of the page of the backups: what is wider than
 * its room, what lies over something else, what of the target cannot be read.
 * An empty answer is a layout with none of these.
 */
export async function layoutProblems(frame: Frame): Promise<string[]> {
  return frame.evaluate(() => {
    const problems: string[] = [];
    const page = document.querySelector<HTMLElement>("[data-testid=velero-backups-page]");

    if (!page) return ["The page of the backups is not there"];
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
    for (const element of page.querySelectorAll<HTMLElement>(
      "[data-testid=velero-target], [data-testid=velero-backup-workspace], [class*=state], [data-testid=velero-coverage]",
    )) {
      if (shown(element) && element.scrollWidth > element.clientWidth + 1) {
        problems.push(`${name(element)} is wider than its room: ${element.scrollWidth} in ${element.clientWidth}`);
      }
    }
    overlaps("[data-testid=velero-target] > *");
    overlaps("[data-testid=velero-backup-status] > *");
    overlaps("[data-testid=velero-backup-scope] > *");
    overlaps("[data-testid=velero-backup-stages] > *");
    overlaps("[data-testid=velero-backups] .TableHead .TableCell");
    for (const row of [...page.querySelectorAll("[data-testid=velero-backups] .TableRow:not(.TableHead)")].slice(
      0,
      5,
    )) {
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
  });
}

/** The test id, or the name of the backup, of what has the focus of the keyboard. */
export async function focused(frame: Frame): Promise<string> {
  return frame.evaluate(() => {
    const element = document.activeElement;

    return (
      element?.getAttribute("data-testid") ??
      element?.getAttribute("data-backup-row") ??
      element?.getAttribute("aria-label") ??
      element?.tagName.toLowerCase() ??
      ""
    );
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
