/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

// Helpers shared by the integration test (`integration/__tests__`) and the
// suites of the views (`e2e/__tests__`).
//
// Both run in this repository, under its own Vitest (`vitest.integration.config.ts`,
// `pnpm test:integration`), and start the application themselves with `_electron`
// of Playwright: the Freelens that `FREELENS_APP` names, built from source at the
// validation target in CI, and the package of that commit on a machine of a
// developer. They reach its main process as well as its windows: the menu of the
// application, which is the way an operator goes to the catalog and to the
// Extensions page, the size and the zoom of its window, the dialog of a save, the
// modules it loaded, and what the process writes.

import { execFileSync } from "node:child_process";
import { realpathSync, statSync } from "node:fs";
import { mkdir, readdir, readFile, rm, unlink, writeFile } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { StringDecoder } from "node:string_decoder";
import { _electron as electron } from "playwright";

import type { ConsoleMessage, ElectronApplication, Frame, Page, Request } from "playwright";

/** Name of this extension, as published and as shown by the extensions page. */
export const EXTENSION_NAME = "@freelensapp/velero-extension";

const ELEMENT_TIMEOUT = 60 * 1000;

/**
 * Where failure screenshots go. The runner of the suite points this at the repository
 * root so that CI can upload the directory as an artifact. Mirrors the
 * ARTIFACTS_DIR of velero-cluster.ts, duplicated here rather than shared
 * because this module screenshots the top-level Page, not a cluster Frame.
 */
const ARTIFACTS_DIR = process.env.E2E_ARTIFACTS_DIR || path.join(process.cwd(), "e2e-artifacts");

/**
 * Screenshots the whole app window. Never throws: a failed screenshot must
 * not replace the failure that asked for it.
 */
export async function captureWindowScreenshot(window: Page, name: string): Promise<string | undefined> {
  const file = path.join(ARTIFACTS_DIR, `${name.replace(/[^a-zA-Z0-9-]+/g, "-")}.png`);

  try {
    await mkdir(ARTIFACTS_DIR, { recursive: true });
    await window.screenshot({ path: file, fullPage: true });

    return file;
  } catch {
    return undefined;
  }
}

/** The name of the application, which is also the name of its directory inside the profile. */
const APPLICATION_NAME = process.env.FREELENS_APP_NAME || "Freelens";

/**
 * The executable of the application the suites start. `FREELENS_APP` names the
 * application: its bundle on macOS (`Freelens.app`), the folder the build unpacked
 * on Linux and Windows, or the executable itself. It is never an application
 * installed in `/Applications` for daily use: what the suites start is a build made
 * for them, and they start it in a profile of their own.
 */
export function applicationExecutable(): string {
  const named = process.env.FREELENS_APP;

  if (!named) {
    throw new Error(
      "FREELENS_APP is not set: it names the Freelens the suites start (see docs/development/TESTING.md)",
    );
  }
  const application = realpathSync(path.resolve(named));

  if (/^\/(System\/Volumes\/Data\/)?Applications\//.test(application)) {
    throw new Error(`${named} is installed in /Applications: the suites start a build made for them, never that one`);
  }
  if (application.endsWith(".app")) return path.join(application, "Contents", "MacOS", APPLICATION_NAME);
  if (statSync(application).isDirectory()) {
    return path.join(
      application,
      process.platform === "win32" ? `${APPLICATION_NAME}.exe` : APPLICATION_NAME.toLowerCase(),
    );
  }

  return application;
}

/**
 * What the processes of the applications started here write on their standard output, as the host writes
 * it, given to every collector of errors that listens: the host logs there what it logs to its file, every
 * level, with the level at the start of each line.
 */
const outputListeners = new Set<(text: string) => void>();

function tapOutput(app: ElectronApplication): void {
  const decoder = new StringDecoder("utf8");

  app.process().stdout?.on("data", (chunk: Buffer) => {
    const text = decoder.write(chunk);

    for (const listener of outputListeners) listener(text);
  });
}

/**
 * The kubeconfig of the environment the store of a new profile names, by default, as the one the catalog
 * syncs: the one the suite is given, or none. Without an entry the host would sync the `.kube` of its home.
 */
function environmentKubeconfigs(): string[] {
  return process.env.E2E_KUBECONFIG ? [process.env.E2E_KUBECONFIG] : [];
}

/**
 * Gives a step its time and its name: a step that does not end says which one
 * it was, where the case around it would only say that its own time was up.
 */
export async function within<Result>(name: string, milliseconds: number, step: Promise<Result>): Promise<Result> {
  let timer: NodeJS.Timeout | undefined;
  const expired = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`${name} did not end in ${milliseconds / 1000} s`)), milliseconds);
  });

  try {
    return await Promise.race([step, expired]);
  } finally {
    clearTimeout(timer);
  }
}

// The processes a process started, and the ones those started.
function descendants(process: number): number[] {
  const found: number[] = [];
  const visit = (parent: number) => {
    let children: number[] = [];

    try {
      children = execFileSync("pgrep", ["-P", String(parent)], { encoding: "utf8" })
        .split("\n")
        .map(Number)
        .filter(Boolean);
    } catch {
      // No process of that parent.
    }
    for (const child of children) {
      found.push(child);
      visit(child);
    }
  };

  visit(process);

  return found;
}

// What is running under an identifier, or nothing when nothing is.
function command(identifier: number): string {
  try {
    return execFileSync("ps", ["-p", String(identifier), "-o", "command="], { encoding: "utf8" }).trim();
  } catch {
    return "";
  }
}

export interface StartedApplication {
  app: ElectronApplication;
  window: Page;
  /** The profile of this run: what the application keeps is under it. */
  directory: string;
  /** Closes the application and leaves its profile, for a second start to find. */
  close: () => Promise<void>;
  /** Closes the application and removes its profile. */
  cleanup: () => Promise<void>;
}

/**
 * Starts the application in a profile of its own, `FREELENS_INTEGRATION_TESTING_DIR`, a folder under
 * the one of the temporary files of the system: only there does the host take its home from the profile
 * as well as its data, so that it finds neither the kubeconfig nor the extensions of the user. Before
 * the start the store of the profile names a kubeconfig of the environment as the only one the catalog
 * syncs, the one of the environment unless another is given, and a theme: left to its defaults the host
 * syncs the `.kube` of its home and takes the theme of the system, which is dark on a machine and light
 * on another. On macOS the logs of the host and its reports of a crash go to the Library of the home the
 * system gives the process, which `CFFIXED_USER_HOME` points at the profile, so that the ones of the user
 * stay as they were.
 */
export async function startIsolated(
  profile?: string,
  theme: ColorTheme = "Dark",
  kubeconfigs: string[] = environmentKubeconfigs(),
): Promise<StartedApplication> {
  const executable = applicationExecutable();
  const directory =
    profile ?? path.join(os.tmpdir(), "freelens-integration-testing", `velero-${process.pid}-${Date.now()}`);
  const systemHome = path.join(directory, "system-home");

  if (!path.resolve(directory).startsWith(`${os.tmpdir()}${path.sep}`)) {
    throw new Error(`The profile ${directory} is not under ${os.tmpdir()}: the host would take the home of the user`);
  }
  process.env.FREELENS_INTEGRATION_TESTING_DIR = directory;
  // A profile that is given is the one of a start before this one, and is found as that start left it.
  if (!profile) {
    await rm(directory, { recursive: true, force: true });
    await mkdir(path.join(directory, APPLICATION_NAME), { recursive: true });
    await mkdir(systemHome, { recursive: true });
    await writeFile(
      path.join(directory, APPLICATION_NAME, "lens-user-store.json"),
      JSON.stringify({
        preferences: { syncKubeconfigEntries: kubeconfigs.map((filePath) => ({ filePath })), colorTheme: theme },
      }),
      { mode: 0o600 },
    );
  }
  const app = await electron.launch({
    args: ["--integration-testing"],
    executablePath: executable,
    bypassCSP: true,
    env: {
      ...process.env,
      FREELENS_INTEGRATION_TESTING_DIR: directory,
      LOG_LEVEL: "debug",
      ...(process.platform === "darwin" ? { CFFIXED_USER_HOME: systemHome } : {}),
    } as Record<string, string>,
    timeout: 100_000,
  });

  tapOutput(app);
  // The application is asked to close and is given its time. One that does not leave is ended, and what
  // it held of its profile is released, for the start after this one to find the profile free.
  const close = async () => {
    const child = app.process();
    // The application starts a proxy for every cluster it opens, and may leave it behind when it goes.
    const started = child.pid ? descendants(child.pid).map((identifier) => [identifier, command(identifier)]) : [];
    const gone = () => child.exitCode !== null || child.signalCode !== null;
    const left = new Promise<void>((resolve) => {
      if (gone()) resolve();
      else child.once("exit", () => resolve());
    });
    const wait = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

    await Promise.race([app.close().catch(() => undefined), wait(30_000)]);
    await Promise.race([left, wait(15_000)]);
    if (!gone()) {
      console.log("The application did not leave when asked: it is ended");
      child.kill("SIGKILL");
      await Promise.race([left, wait(15_000)]);
      for (const lock of ["SingletonLock", "SingletonCookie", "SingletonSocket"]) {
        await rm(path.join(directory, APPLICATION_NAME, lock), { force: true }).catch(() => undefined);
      }
    }
    // What the application started and left: ended if it is still what it was, which an identifier
    // that was given to another process in the meantime is not.
    for (const [identifier, was] of started as [number, string][]) {
      if (was && command(identifier) === was) {
        try {
          process.kill(identifier, "SIGTERM");
        } catch {
          // It left in the meantime.
        }
      }
    }
  };
  const cleanup = async () => {
    await close();
    await rm(directory, { recursive: true, force: true }).catch(() => undefined);
  };

  try {
    const deadline = Date.now() + 60_000;
    let window = app.windows().find((page) => page.url().startsWith("https://renderer.freelens.app"));

    while (!window && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      window = app.windows().find((page) => page.url().startsWith("https://renderer.freelens.app"));
    }
    if (!window) {
      throw new Error("Freelens did not open its main window");
    }

    return { app, window, directory, close, cleanup };
  } catch (error) {
    await cleanup();
    throw error;
  }
}

/** Where the host writes its logs: the one of its main process, `lens.log`, and the ones of its frames. */
export async function logDirectory(app: ElectronApplication): Promise<string> {
  return app.evaluate(({ app }) => app.getPath("logs"));
}

/**
 * The lines at the level of an error in each file of the log of the host: the one of its main process, the
 * one of the window and the one of each frame of a cluster, which the renderer sends to the main process.
 * The record of a request of the proxy that its client gave up on, and the one of the check of the host for its
 * own latest version that got no answer, are left out, as the collector of errors leaves them out of the output.
 * A line is given cut, as a failure message needs it.
 */
export async function hostLogErrors(app: ElectronApplication): Promise<Record<string, string[]>> {
  const directory = await logDirectory(app);
  const found: Record<string, string[]> = {};

  for (const file of (await readdir(directory)).filter((name) => name.endsWith(".log")).sort()) {
    const text = (await readFile(path.join(directory, file), "utf8"))
      .replace(ANSI_ESCAPE_PATTERN, "")
      .replace(CANCELED_PROXY_RECORD_PATTERN, "")
      .replace(LATEST_VERSION_RECORD_PATTERN, "");

    found[file] = text
      .split("\n")
      .filter(
        (line) =>
          /^\s*error:/i.test(line) &&
          !CANCELED_PROXY_LINE_PATTERN.test(line) &&
          !LATEST_VERSION_LINE_PATTERN.test(line),
      )
      .map((line) => line.slice(0, 300));
  }
  return found;
}

/** A cluster of the catalog of the main process, as the host gives it to an extension. */
export interface MainCatalogEntry {
  id: string;
  name: string;
  kubeConfigPath: string;
  contextName: string;
  status: string;
}

/** The clusters of the catalog of the main process, through the API the host gives the extensions there. */
export async function mainCatalog(app: ElectronApplication): Promise<MainCatalogEntry[]> {
  return app.evaluate(() => {
    const api = (
      globalThis as unknown as {
        FreelensExtensionApi?: { Main?: { Catalog?: { getAllClusters?: () => MainCatalogEntry[] } } };
      }
    ).FreelensExtensionApi;

    return (api?.Main?.Catalog?.getAllClusters?.() ?? []).map(({ id, name, kubeConfigPath, contextName, status }) => ({
      id,
      name,
      kubeConfigPath,
      contextName,
      status: String(status),
    }));
  });
}

/**
 * Waits for the catalog of the main process to give a cluster a state, and answers the entry: a minute at
 * most, after which the state it has is said.
 */
export async function clusterInState(app: ElectronApplication, id: string, state: string): Promise<MainCatalogEntry> {
  const deadline = Date.now() + ELEMENT_TIMEOUT;

  for (;;) {
    const entry = (await mainCatalog(app)).find((cluster) => cluster.id === id);

    if (entry?.status === state) return entry;
    if (Date.now() > deadline) {
      throw new Error(`The cluster ${id} is ${entry ? entry.status : "not in the catalog"}, and not ${state}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

/**
 * Disconnects a cluster in the catalog, as an operator does: the menu of its row, and its command Disconnect,
 * which the host offers for a cluster that is connected. Answers once the catalog of the main process says that
 * the cluster is disconnected.
 */
export async function disconnectInCatalog(app: ElectronApplication, window: Page, id: string): Promise<void> {
  await navigateToCatalog(app);
  // The icon of the row opens its menu, which carries the identifier of the row once it is open.
  const opens = window.locator(`[data-testid="icon-for-menu-actions-for-catalog-for-${id}"]`);

  await opens.waitFor({ state: "visible", timeout: ELEMENT_TIMEOUT });
  await opens.click();
  await window
    .locator(`[data-testid="menu-actions-for-catalog-for-${id}"] .MenuItem`, { hasText: /^\s*Disconnect\s*$/ })
    .click({ timeout: ELEMENT_TIMEOUT });
  await clusterInState(app, id, "disconnected");
}

/**
 * Disables the extension from the Extensions page, as an operator does: the command of the menu of its row.
 * The page then says that it is disabled.
 */
export async function disableExtension(app: ElectronApplication, window: Page): Promise<void> {
  await navigateToExtensions(app);
  const row = window.locator("tr", {
    has: window.locator('div[class*="installed-extensions-module__extensionName--"]', { hasText: EXTENSION_NAME }),
  });

  await row.waitFor({ state: "visible", timeout: ELEMENT_TIMEOUT });
  await window.click(`[id="menu-actions-for-installed-extensions-for-${EXTENSION_NAME}"]`);
  await window.locator(".Menu .MenuItem", { hasText: "Disable" }).click();
  await row.locator("td").nth(2).getByText("Disabled", { exact: true }).waitFor({ timeout: ELEMENT_TIMEOUT });
}

/**
 * Enables the extension again from the Extensions page, as an operator does: the command of the menu of its
 * row, which the host names "Enabled" while the extension is disabled. The page then says that it is enabled.
 */
export async function enableExtension(app: ElectronApplication, window: Page): Promise<void> {
  await navigateToExtensions(app);
  const row = window.locator("tr", {
    has: window.locator('div[class*="installed-extensions-module__extensionName--"]', { hasText: EXTENSION_NAME }),
  });

  await row.waitFor({ state: "visible", timeout: ELEMENT_TIMEOUT });
  await row.locator("td").nth(2).getByText("Disabled", { exact: true }).waitFor({ timeout: ELEMENT_TIMEOUT });
  await window.click(`[id="menu-actions-for-installed-extensions-for-${EXTENSION_NAME}"]`);
  await window.locator(".Menu .MenuItem", { hasText: "Enabled" }).click();
  await row.locator("td").nth(2).getByText("Enabled", { exact: true }).waitFor({ timeout: ELEMENT_TIMEOUT });
}

/**
 * The kubectl that the application runs to forward a port, which the extension runs for a download through
 * the cluster: the processes under the main process of the application whose command is a kubectl
 * port-forward, by their identifiers. The host runs no other. The table of the processes is read once, so
 * that a case can ask it several times a second while a load runs.
 */
export function kubectlForwards(app: ElectronApplication): number[] {
  const main = app.process().pid;

  if (!main) return [];
  const rows = execFileSync("ps", ["-A", "-o", "pid=,ppid=,command="], { encoding: "utf8" })
    .split("\n")
    .map((line) => /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line))
    .filter((match) => match !== null)
    .map(([, pid, parent, line]) => ({ pid: Number(pid), parent: Number(parent), line }));
  const under = new Set([main]);

  // A process is under the main process when its parent is: the table is gone through until nothing is added.
  for (let added = true; added; ) {
    added = false;
    for (const row of rows) {
      if (under.has(row.parent) && !under.has(row.pid)) {
        under.add(row.pid);
        added = true;
      }
    }
  }
  return rows
    .filter((row) => row.pid !== main && under.has(row.pid) && /\bkubectl\s+port-forward\b/.test(row.line))
    .map((row) => row.pid);
}

/** What the process that draws a frame of the window holds in memory, and the heap of its scripts. */
export interface FrameMemory {
  /** The process that draws the frame, and what it holds, in kilobytes as Electron counts them. */
  process: { pid: number; workingSetKB: number; peakWorkingSetKB: number };
  /** The heap of the scripts of that process, in bytes, after its garbage was collected. */
  heap: { usedBytes: number; totalBytes: number };
  /** Whether the frame has a process of its own, or is drawn by the one of the window. */
  ownProcess: boolean;
}

/**
 * Measures the memory of the window where a frame is drawn: its garbage is collected, through the protocol of
 * the tools of the browser, then the heap of its scripts is read, and Electron is asked what the process that
 * draws the frame holds. A frame of the same site as the window is drawn by the process of the window, and is
 * reached through the window; one with a process of its own through itself.
 */
export async function frameMemory(app: ElectronApplication, window: Page, frame: Frame): Promise<FrameMemory> {
  const context = window.context();
  const own = await context.newCDPSession(frame).catch(() => undefined);
  const session = own ?? (await context.newCDPSession(window));

  try {
    await session.send("HeapProfiler.collectGarbage");
    await new Promise((resolve) => setTimeout(resolve, 500));
    await session.send("HeapProfiler.collectGarbage");
    const heap = await session.send("Runtime.getHeapUsage");
    // The frame is known to Electron by its origin: its path changes with every view it shows.
    const drawing = await app.evaluate(({ app, BrowserWindow }, origin) => {
      const frames = BrowserWindow.getAllWindows().flatMap((each) =>
        each.isVisible() ? each.webContents.mainFrame.framesInSubtree : [],
      );
      const drawn = frames.find((each) => {
        try {
          return new URL(each.url).origin === origin;
        } catch {
          return false;
        }
      });

      if (!drawn) throw new Error(`No frame of the window is of ${origin}`);
      const metric = app.getAppMetrics().find((each) => each.pid === drawn.osProcessId);

      if (!metric) throw new Error(`Electron counts no process ${drawn.osProcessId} for the frame of ${origin}`);
      return {
        pid: metric.pid,
        workingSetKB: metric.memory.workingSetSize,
        peakWorkingSetKB: metric.memory.peakWorkingSetSize,
      };
    }, new URL(frame.url()).origin);

    return {
      process: drawing,
      heap: { usedBytes: heap.usedSize, totalBytes: heap.totalSize },
      ownProcess: own !== undefined,
    };
  } finally {
    await session.detach().catch(() => undefined);
  }
}

/** A load in the window that did not end, as Electron tells it: its code, whether it was of the window itself, and the host of its address. */
export interface FailedLoad {
  code: number;
  mainFrame: boolean;
  host: string;
}

/**
 * Keeps, from now on, every load in the windows of the application that did not end, as Electron tells it to the
 * host, which logs a load of a window that failed at the level of an error, a load of a frame inside it that was
 * aborted at the level of debugging, and a load of a frame that failed otherwise as a warning.
 */
export async function watchFailedLoads(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ BrowserWindow }) => {
    const main = globalThis as unknown as { veleroFailedLoads?: FailedLoad[] };

    if (main.veleroFailedLoads) return;
    const seen: FailedLoad[] = [];

    main.veleroFailedLoads = seen;
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.on("did-fail-load", (_event, code, _description, address, mainFrame) => {
        let host = "";

        try {
          host = new URL(address).host;
        } catch {
          host = address;
        }
        seen.push({ code, mainFrame, host });
      });
    }
  });
}

/** The loads that did not end since they are watched. */
export async function failedLoads(app: ElectronApplication): Promise<FailedLoad[]> {
  return app.evaluate(() => {
    const seen = (globalThis as unknown as { veleroFailedLoads?: FailedLoad[] }).veleroFailedLoads;

    if (!seen) throw new Error("The loads are not watched: watchFailedLoads comes first");
    return [...seen];
  });
}

/**
 * Counts, from now on, the lines the applications started here write on their standard output that match a
 * pattern: what the host says of its own work, the saving of the store of an extension among it. A line is
 * counted once it is whole.
 */
export function countOutput(pattern: RegExp): { count: () => number; stop: () => void } {
  let partial = "";
  let count = 0;
  const listener = (text: string) => {
    const lines = `${partial}${text}`.split("\n");

    partial = lines.pop() ?? "";
    for (const line of lines) if (pattern.test(line.replace(ANSI_ESCAPE_PATTERN, ""))) count += 1;
  };

  outputListeners.add(listener);
  return { count: () => count, stop: () => outputListeners.delete(listener) };
}

/** A request a handler of the extension in the main process was given, as it read it, and its answer. */
export interface HandledRequest {
  /** The procedure, without the prefix the host gives the channels of an extension. */
  channel: string;
  /** The address of the frame the request came from, which the handler reads the cluster of. */
  address: string;
  /** The process and the frame of the sender, which tell the frames of one window apart. */
  processId: number;
  frameId: number;
  /** The cluster the request named. */
  named: string;
  /** `ok`, or the code and the stage of the refusal. */
  answer: string;
  /** Of the state of the gate: the cluster it is of, as the catalog of the main process names it, and the writes. */
  state?: { cluster: string; on: boolean };
}

interface HandlerWatch {
  calls: HandledRequest[];
  originals: [channel: string, handler: unknown][];
}

/**
 * Watches the handlers the host registered for the procedures of the extension, in its main process. Electron
 * keeps the handler of a channel in a map it reads at every call; each one of the extension is wrapped there,
 * and called as it was with what it was given: the wrapper reads of the event what the handler reads, the
 * address of the frame and the identifiers of its process and frame, and keeps the answer. The channels are
 * answered with their whole names, which the host prefixes; `stopWatchingHandlers` puts the handlers back.
 */
export async function watchHandlers(app: ElectronApplication): Promise<string[]> {
  return app.evaluate(({ ipcMain }) => {
    type Handler = (event: Electron.IpcMainInvokeEvent, ...args: unknown[]) => unknown;
    const handlers = (ipcMain as unknown as { _invokeHandlers?: Map<string, Handler> })._invokeHandlers;
    const main = globalThis as unknown as { veleroHandlers?: HandlerWatch };

    if (!handlers) throw new Error("Electron keeps the handlers of its channels elsewhere: no _invokeHandlers");
    if (main.veleroHandlers) return main.veleroHandlers.originals.map(([channel]) => channel);
    const kept: HandlerWatch = { calls: [], originals: [] };

    for (const [channel, handler] of [...handlers]) {
      if (!/^extensions@[0-9a-f]{64}:[a-z]+\.[a-z]+$/.test(channel)) continue;
      kept.originals.push([channel, handler]);
      handlers.set(channel, async (event, ...args) => {
        let address = "";

        try {
          address = event.senderFrame?.url ?? "";
        } catch {
          address = "(a frame that was disposed)";
        }
        const named = (args[0] as { cluster?: unknown } | undefined)?.cluster;
        const answer = (await handler(event, ...args)) as {
          ok?: boolean;
          code?: string;
          stage?: string;
          value?: { cluster?: { id?: string }; writes?: { on?: boolean } };
        };

        kept.calls.push({
          channel: channel.slice(channel.indexOf(":") + 1),
          address,
          processId: event.processId,
          frameId: event.frameId,
          named: typeof named === "string" ? named : "",
          answer: answer?.ok ? "ok" : `${answer?.code} at ${answer?.stage}`,
          ...(answer?.ok && answer.value?.writes
            ? { state: { cluster: answer.value.cluster?.id ?? "", on: answer.value.writes.on === true } }
            : {}),
        });
        return answer;
      });
    }
    main.veleroHandlers = kept;
    return kept.originals.map(([channel]) => channel);
  });
}

/** What the handlers of the extension were given since they are watched. */
export async function handledRequests(app: ElectronApplication): Promise<HandledRequest[]> {
  return app.evaluate(() => {
    const kept = (globalThis as unknown as { veleroHandlers?: HandlerWatch }).veleroHandlers;

    if (!kept) throw new Error("The handlers are not watched: watchHandlers comes first");
    return kept.calls;
  });
}

/** Puts back the handlers of the extension that `watchHandlers` wrapped. */
export async function stopWatchingHandlers(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ ipcMain }) => {
    const handlers = (ipcMain as unknown as { _invokeHandlers?: Map<string, unknown> })._invokeHandlers;
    const main = globalThis as unknown as { veleroHandlers?: HandlerWatch };

    for (const [channel, handler] of main.veleroHandlers?.originals ?? []) handlers?.set(channel, handler);
    main.veleroHandlers = undefined;
  });
}

/** Leaves the welcome page, which a new profile starts on. */
export async function clickWelcomeButton(window: Page): Promise<void> {
  await window.click("[data-testid=welcome-menu-container] li a");
}

/** Gives the window of the application a size, in pixels of its content. */
export async function setWindowSize(app: ElectronApplication, width: number, height: number): Promise<void> {
  await app.evaluate(
    ({ BrowserWindow }, size) => {
      for (const window of BrowserWindow.getAllWindows()) {
        if (!window.isVisible()) continue;
        if (window.isMaximized()) window.unmaximize();
        window.setMinimumSize(1, 1);
        window.setContentSize(size.width, size.height);
      }
    },
    { width, height },
  );
}

/** Zooms the window of the application: 1 is what it starts with, 2 is twice that. */
export async function setZoom(app: ElectronApplication, factor: number): Promise<void> {
  await app.evaluate(({ BrowserWindow }, zoom) => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (window.isVisible()) window.webContents.setZoomFactor(zoom);
    }
  }, factor);
}

/** What the dialog that asks where to save a file was asked with, each time the main process asked it. */
export interface SaveDialogCall {
  title: string;
  message: string;
  defaultPath: string;
}

interface SaveDialogStand {
  /** The file the dialog answers, or nothing for a dialog that is left. */
  answer: string;
  calls: SaveDialogCall[];
  /** What stands in the place of the dialog, to know it again. */
  stand?: unknown;
}

/**
 * Stands in the place of the dialog of the host that asks where to save a
 * file, in the main process of the application: from now on no dialog is
 * shown, and the one that is asked answers the file that is given here, or
 * that it was left when none is given. The extension asks the module of
 * Electron for its dialog each time it saves, which is what makes the one that
 * stands there the one it asks. Called again, it changes the answer and keeps
 * what the dialog was asked so far. A replacement the module did not keep is
 * said here, and not found later as a dialog nobody answers.
 */
export async function replaceSaveDialog(app: ElectronApplication, file = ""): Promise<void> {
  await app.evaluate(({ dialog }, chosen) => {
    const main = globalThis as unknown as { veleroSaveDialog?: SaveDialogStand };
    const kept: SaveDialogStand = main.veleroSaveDialog ?? { answer: "", calls: [] };

    kept.answer = chosen;
    if (main.veleroSaveDialog) return;
    const stand = (...asked: unknown[]) => {
      // The dialog is asked with its options, after the window it belongs to when it is given one.
      const options = (asked[asked.length - 1] ?? {}) as Record<string, unknown>;

      kept.calls.push({
        title: String(options.title ?? ""),
        message: String(options.message ?? ""),
        defaultPath: String(options.defaultPath ?? ""),
      });
      return Promise.resolve(
        kept.answer ? { canceled: false, filePath: kept.answer } : { canceled: true, filePath: "" },
      );
    };

    kept.stand = stand;
    main.veleroSaveDialog = kept;
    dialog.showSaveDialog = stand as unknown as typeof dialog.showSaveDialog;
  }, file);
  // The module is asked again, as the extension asks it: what it gives now is what was put there.
  const stands = await app.evaluate(({ dialog }) => {
    const kept = (globalThis as unknown as { veleroSaveDialog?: SaveDialogStand }).veleroSaveDialog;

    return kept !== undefined && (dialog.showSaveDialog as unknown) === kept.stand;
  });

  if (!stands) {
    throw new Error(
      "The dialog of the save was not replaced: the module of Electron does not give what was put in its place",
    );
  }
}

/** What the dialog of the save was asked with since it was replaced, from the first time. */
export async function saveDialogCalls(app: ElectronApplication): Promise<SaveDialogCall[]> {
  const calls = await app.evaluate(
    () => (globalThis as unknown as { veleroSaveDialog?: SaveDialogStand }).veleroSaveDialog?.calls ?? null,
  );

  if (!calls) throw new Error("The dialog of the save is not replaced: replaceSaveDialog comes first");

  return calls;
}

/**
 * What the extension keeps in the profile between two starts: every file of
 * its store, with what it holds. The files of the host are not among them.
 */
export async function storedPreferences(directory: string): Promise<{ file: string; content: unknown }[]> {
  const found: { file: string; content: unknown }[] = [];
  const visit = async (folder: string) => {
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      const entryPath = path.join(folder, entry.name);

      if (entry.isDirectory()) {
        if (entry.name !== "node_modules" && entry.name !== "extensions") await visit(entryPath);
      } else if (/velero/i.test(entryPath.slice(directory.length)) && entry.name.endsWith(".json")) {
        found.push({
          file: entryPath.slice(directory.length),
          content: JSON.parse(await readFile(entryPath, "utf8")),
        });
      }
    }
  };

  await visit(directory);

  return found;
}

/**
 * The clusters of the catalog. The suite asks for their number and for nothing
 * else of them: what a catalog holds beside the test cluster is not for a log.
 */
/**
 * How many clusters the catalog lists. The catalog reads the kubeconfigs of the profile as they are
 * written, a moment after: the first row is waited for, a minute at most, and the count is of then.
 */
export async function catalogClusterCount(window: Page): Promise<number> {
  const rows = window.locator("div.TableRow:not(.TableHead)");

  await rows
    .first()
    .waitFor({ state: "visible", timeout: ELEMENT_TIMEOUT })
    .catch(() => undefined);
  return rows.count();
}

/** The text of every notification currently shown, for failure messages. */
async function notificationTexts(window: Page): Promise<string[]> {
  try {
    const texts = await window.$$eval('[class*="Notification"], [class*="notification"]', (elements) =>
      elements.map((element) => element.textContent ?? ""),
    );

    return texts.map((text) => text.replace(/\s+/g, " ").trim()).filter(Boolean);
  } catch {
    return [];
  }
}

const ANSI_ESCAPE_PATTERN = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");
// A line the host logs at the level of an error starts with the level, on its output as in its file.
const OUTPUT_ERROR_PATTERN = /^\s*error:/im;
// The host's kubectl proxy logs at error level every request its client gave
// up on before the API server answered. That is what closing a drawer does to
// the reference loads it had just started: an abort on purpose, not a failure.
// The record spans from its opening line to its closing one, with no line that
// opens another record between them. One whose closing line has not arrived yet
// is the last thing written: its opening line, then lines that neither open nor
// close a record, to the end.
const CANCELED_PROXY_RECORD_PATTERN =
  /^[^\n]*error:\s*┏[^\n]*Error while proxying request: context canceled[^\n]*\n(?:(?![^\n]*\b[a-z]+:\s*[┏▪])[^\n]*\n)*?[^\n]*error:\s*┗[^\n]*\n?/gim;
const CANCELED_PROXY_START_PATTERN =
  /error:\s*┏[^\n]*Error while proxying request: context canceled[^\n]*(?:\n(?![^\n]*\b[a-z]+:\s*[┏▪┗])[^\n]*)*$/i;
// In the file of the log the same record is one line, as the proxy wrote it.
const CANCELED_PROXY_LINE_PATTERN = /^\s*error:[^\n]*Error while proxying request: context canceled\s*$/i;
// The welcome page of the host asks the npm registry for the latest version of
// the host, with a limit of five seconds, and the main process logs at the level
// of an error an answer that does not come: a state of the network of the
// machine, which says nothing of the application or of the extension. On the
// output it is a record of several lines, as the one above; in the file of the
// log it is one line.
const LATEST_VERSION_RECORD_PATTERN =
  /^[^\n]*error:\s*┏[^\n]*\[GET-LATEST-VERSION\]: Failed to fetch latest version[^\n]*\n(?:(?![^\n]*\b[a-z]+:\s*[┏▪])[^\n]*\n)*?[^\n]*error:\s*┗[^\n]*\n?/gim;
const LATEST_VERSION_START_PATTERN =
  /error:\s*┏[^\n]*\[GET-LATEST-VERSION\]: Failed to fetch latest version[^\n]*(?:\n(?![^\n]*\b[a-z]+:\s*[┏▪┗])[^\n]*)*$/i;
const LATEST_VERSION_LINE_PATTERN = /^\s*error:\s*\[GET-LATEST-VERSION\]: Failed to fetch latest version\b/i;
const HOST_ASSET_FAILURE_PATTERN = /^Failed to load resource: net::/;
const HOST_ASSET_URL_PATTERN = /^https:\/\/renderer\.freelens\.app(:\d+)?\/build\//;
// On Freelens v2 the reads of the frame of a cluster, the host's and the views' alike, leave from the frame through
// the browser, which writes in its console, at the level of an error, every answer that is not a success as a
// resource that failed to load. An answer of the API server that refuses a read to the identity, or has nothing
// of what was read, is a state the one that read it shows: the host when a restricted identity opens a cluster,
// the views for a family that is denied or not served. The line is of the browser, and says nothing of an error
// of the application. Any other answer, as a request the API server could not take, stays an error.
const REFUSED_READ_PATTERN = /^Failed to load resource: the server responded with a status of 40[134] /;
const CLUSTER_READ_URL_PATTERN = /^https:\/\/[0-9a-f]+\.renderer\.freelens\.app(:\d+)?\/api-kube\//;

/**
 * Collects everything that looks like an error while the app runs: renderer
 * console messages and the output of the process of the application, where the
 * host logs a failure of an extension as a line at the level of an error rather
 * than as an exception.
 */
export interface ErrorCollector {
  /** Starts capturing the output of the applications the helpers start. Call it before launching the app. */
  start: () => void;
  /** Starts capturing the renderer console of a window. */
  watch: (window: Page) => void;
  /** Stops capturing both. */
  stop: (window: Page) => void;
  /** Everything captured so far. */
  errors: () => string[];
}

export function createErrorCollector(): ErrorCollector {
  const consoleErrors: string[] = [];
  const outputErrors: string[] = [];

  let outputBuffer = "";

  const collectOutputErrors = (text: string) => {
    outputBuffer += text;

    // Keep the buffer bounded while preserving enough tail to match patterns
    // split across chunks.
    if (outputBuffer.length > 200_000) {
      outputBuffer = outputBuffer.slice(-20_000);
    }

    const normalizedOutput = outputBuffer
      .replace(ANSI_ESCAPE_PATTERN, "")
      .replace(CANCELED_PROXY_RECORD_PATTERN, "")
      .replace(LATEST_VERSION_RECORD_PATTERN, "");

    // A record left out that is still arriving: wait for its end.
    if (CANCELED_PROXY_START_PATTERN.test(normalizedOutput) || LATEST_VERSION_START_PATTERN.test(normalizedOutput)) {
      return;
    }

    if (OUTPUT_ERROR_PATTERN.test(normalizedOutput)) {
      outputErrors.push(normalizedOutput.trim());
      outputBuffer = "";
    }
  };

  // "Failed to load resource" console errors never say which resource: the
  // request event does, so the URL and the reason are logged next to them.
  const requestFailedLogger = (request: Request) => {
    console.log(`[request failed] ${request.method()} ${request.url()}: ${request.failure()?.errorText ?? "unknown"}`);
  };

  const logger = (message: ConsoleMessage) => {
    const text = message.text();
    const normalizedText = text.replace(ANSI_ESCAPE_PATTERN, "");

    console.log(text);

    // The host's own bundle (its fonts, its chunks) is served by the app to
    // itself; on a loaded machine one of those requests was seen to fail at
    // startup with a TLS error. It is logged with its URL above, and it is not
    // something the extension did: it does not count as an extension error.
    if (HOST_ASSET_FAILURE_PATTERN.test(normalizedText) && HOST_ASSET_URL_PATTERN.test(message.location().url)) {
      return;
    }
    // A read of the frame of a cluster that the API server refused to the identity or had nothing for: its URL is
    // said beside it, and it is not counted as an error.
    if (REFUSED_READ_PATTERN.test(normalizedText) && CLUSTER_READ_URL_PATTERN.test(message.location().url)) {
      console.log(`[refused or not found by the cluster] ${message.location().url}`);
      return;
    }

    // Some app logs are emitted as "log" messages, so inspect both the console
    // type and the message content.
    if (message.type() === "error" || OUTPUT_ERROR_PATTERN.test(normalizedText)) {
      consoleErrors.push(`[${message.type()}] ${normalizedText}`);
    }
  };

  return {
    start: () => {
      outputListeners.add(collectOutputErrors);
    },

    watch: (window: Page) => {
      window.on("console", logger);
      window.on("requestfailed", requestFailedLogger);
    },

    stop: (window: Page) => {
      window.off("console", logger);
      window.off("requestfailed", requestFailedLogger);
      outputListeners.delete(collectOutputErrors);
    },

    errors: () => [...consoleErrors, ...outputErrors],
  };
}

/** Opens the extensions page through the application menu. */
export async function navigateToExtensions(app: ElectronApplication): Promise<void> {
  await app.evaluate(async ({ app }) => {
    await app.applicationMenu
      ?.getMenuItemById(process.platform === "darwin" ? "mac" : "file")
      ?.submenu?.getMenuItemById("navigate-to-extensions")
      ?.click();
  });
}

/** Opens the catalog through the application menu. */
export async function navigateToCatalog(app: ElectronApplication): Promise<void> {
  await within(
    "The way to the catalog",
    60_000,
    app.evaluate(async ({ app }) => {
      await app.applicationMenu?.getMenuItemById("view")?.submenu?.getMenuItemById("navigate-to-catalog")?.click();
    }),
  );
}

/**
 * Leaves the welcome page when the application starts on it. A start that
 * finds a profile may be somewhere else already.
 */
export async function leaveWelcome(window: Page): Promise<void> {
  await window.click("[data-testid=welcome-menu-container] li a", { timeout: 15_000 }).catch(() => undefined);
}

/** Opens the preferences page through the application menu. */
export async function navigateToPreferences(app: ElectronApplication): Promise<void> {
  await app.evaluate(async ({ app }) => {
    await app.applicationMenu
      ?.getMenuItemById(process.platform === "darwin" ? "mac" : "file")
      ?.submenu?.getMenuItemById("navigate-to-preferences")
      ?.click();
  });
}

export type ColorTheme = "Dark" | "Light";

/**
 * Switches the app-wide color theme through the preferences page, then
 * closes preferences again (its close button navigates back in history,
 * landing on whatever was open before, e.g. a connected cluster).
 *
 * A connected cluster's iframe is not reloaded by this round trip - it keeps
 * its own route and state - so callers can keep using a `Frame` obtained
 * before calling this.
 */
/**
 * Closes the preferences and makes sure they are gone. A click on the close
 * button can land while the theme select still has its menu open, in which
 * case it only closes the menu: the preferences then stay over the cluster
 * frame and intercept every click of the cases that follow. So the close is
 * verified, retried, and finally asked of Escape, which closes the preferences.
 */
async function closePreferences(window: Page): Promise<void> {
  const preferences = window.locator(".SettingLayout.Preferences");

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    await window.click('[data-testid="close-preferences"]', { timeout: 10_000 }).catch(() => undefined);

    try {
      await preferences.waitFor({ state: "hidden", timeout: 5000 });

      return;
    } catch {
      await window.keyboard.press("Escape").catch(() => undefined);

      if ((await preferences.count()) === 0 || !(await preferences.first().isVisible())) {
        return;
      }
    }
  }

  throw new Error("The preferences could not be closed after the theme change");
}

export async function setColorTheme(app: ElectronApplication, window: Page, theme: ColorTheme): Promise<void> {
  await navigateToPreferences(app);

  await window.waitForSelector("[data-preference-tab-link-test=app]", { timeout: ELEMENT_TIMEOUT });
  await window.click("[data-preference-tab-link-test=app]");

  // The options menu of the host select re-renders while the page settles, and
  // under load a click can wait on an option that keeps being replaced. The
  // pick is therefore retried with a short timeout, reopening the menu each
  // time, and the preferences are closed whatever happens: a theme that could
  // not be set must not leave the preferences open over every case that follows.
  let lastError: unknown;

  try {
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      try {
        const themeInput = await window.waitForSelector("#theme-input", { timeout: ELEMENT_TIMEOUT });

        await themeInput.click();
        await window.click(`.Select__option >> text="${theme}"`, { timeout: 10_000 });
        lastError = undefined;
        break;
      } catch (error) {
        lastError = error;
        // Clicking the tab we are already on closes the menu by blur; Escape
        // is not used because it closes the preferences themselves.
        await window.click("[data-preference-tab-link-test=app]").catch(() => undefined);
        await window.waitForTimeout(1000);
      }
    }
  } finally {
    await closePreferences(window);
  }

  if (lastError) {
    throw lastError;
  }
}

// Freelens's own install pipeline gives up waiting for the extension loader to
// pick up the unpacked files after 10s (unpack-extension.injectable.tsx) and
// shows an error notification instead. Everything after that point (registry
// lookup, download, tar extraction, the loader's file-watch detection) can
// occasionally take longer than that under load or on a cold filesystem-event
// cache (observed on a fresh macOS checkout, where the very first launch of a
// newly built, unsigned app bundle can be slow for reasons entirely outside
// this code, e.g. Gatekeeper's on-first-run scan). This wait is kept
// deliberately generous, and identical on every platform, rather than
// special-cased per OS: a slow-but-eventually-successful install should not
// be reported as a real failure on any platform, macOS included.
const INSTALL_TIMEOUT = 90 * 1000;

/**
 * The host gave up on the install. The host gives its loader ten seconds to see the extension among
 * the ones it unpacked, and on a busy machine it gives up, with a notification that the installation
 * failed: the extension never appears as installed, or appears and stays disabled. A second attempt
 * in the same application gives up as well. What helps is a second start, in a new profile.
 */
export class HostGaveUpError extends Error {}

/**
 * A file the runner may leave beside the artifacts of the suites, for one start: the main process of the
 * application is held for thirteen seconds right after the install is asked, which is how the host
 * is made to give up on purpose. The file goes when it is read, so that the start after is not held.
 */
const STALL_SIGNAL = path.join(ARTIFACTS_DIR, "..", "stall-the-host-once");

async function stallIfAsked(app: ElectronApplication): Promise<void> {
  try {
    await unlink(STALL_SIGNAL);
  } catch {
    return;
  }
  const identifier = app.process().pid;

  if (!identifier) return;
  console.log("The main process of the application is held for 13 seconds, as the signal asks");
  process.kill(identifier, "SIGSTOP");
  await new Promise((resolve) => setTimeout(resolve, 13_000));
  process.kill(identifier, "SIGCONT");
}

/**
 * Starts the application in a new profile, leaves the welcome and installs the extension. When the
 * host gives up on the install the application is closed, its profile removed, and another one is
 * started in a new profile, once: the host does not recover inside the same application.
 *
 * What a suite puts in the profile, its kubeconfig, is put there by `beforeInstall`, for each start and
 * before the welcome is left: the suites did so before they started through here, and the installs that
 * were asked of a profile without it were given up on by the host far more often on the runners. The
 * store of the profile names `kubeconfigs` for the catalog to sync, the one of the environment unless a
 * suite gives another.
 */
export async function startWithExtension(
  beforeInstall?: (started: StartedApplication) => Promise<void>,
  theme: ColorTheme = "Dark",
  attempts = 2,
  kubeconfigs: string[] = environmentKubeconfigs(),
): Promise<StartedApplication> {
  for (let attempt = 1; ; attempt++) {
    const started = await startIsolated(undefined, theme, kubeconfigs);

    try {
      await beforeInstall?.(started);
      await clickWelcomeButton(started.window);
      await installExtension(started.app, started.window);
      return started;
    } catch (error) {
      await started.cleanup();
      if (attempt >= attempts || !(error instanceof HostGaveUpError)) throw error;
      console.log(
        `The host gave up on the install (start ${attempt} of ${attempts}): the application is started again in a new profile`,
      );
    }
  }
}

/** What the Extensions page says when no extension is installed in the profile. */
const NO_EXTENSION = "There are no extensions installed.";

/**
 * Installs the packed extension and waits for it to be listed as enabled.
 *
 * `EXTENSION_PATH` points at the tarball built from this repository; without it
 * the extension is installed from the registry by name. The page is to list no
 * extension before: the profile is a new one, and an extension found there
 * would be one of another profile.
 *
 * On failure, screenshots the window and reports every notification and the
 * state of the install button, so a stuck install is never a blind timeout.
 */
export async function installExtension(
  app: ElectronApplication,
  window: Page,
  extensionPath = process.env.EXTENSION_PATH || EXTENSION_NAME,
): Promise<void> {
  await navigateToExtensions(app);

  const textbox = window.getByPlaceholder("Name, URL, or path to a package or directory");

  try {
    await textbox.waitFor({ state: "visible", timeout: INSTALL_TIMEOUT });
    await window.getByText(NO_EXTENSION, { exact: true }).waitFor({ state: "visible", timeout: INSTALL_TIMEOUT });
  } catch {
    const screenshot = await captureWindowScreenshot(window, "install-no-extensions-page");

    throw new Error(
      `The Extensions page never showed its install field, or it listed an extension before the install. Current URL: ${window.url()}.` +
        (screenshot ? ` Screenshot: ${screenshot}` : ""),
    );
  }

  await textbox.fill(extensionPath);

  const installButtonSelector = 'button[class*="Button install-module__button--"]';

  await window.click(installButtonSelector.concat("[data-waiting=false]"), { timeout: INSTALL_TIMEOUT });
  await stallIfAsked(app);

  const extensionNameSelector = 'div[class*="installed-extensions-module__extensionName--"]';

  let installedExtensionName: string | null;

  try {
    installedExtensionName = await (
      await window.waitForSelector(extensionNameSelector, { timeout: INSTALL_TIMEOUT })
    ).textContent();
  } catch {
    const screenshot = await captureWindowScreenshot(window, "install-timed-out");
    const notifications = await notificationTexts(window);

    throw new HostGaveUpError(
      `"${EXTENSION_NAME}" never appeared as installed within ${INSTALL_TIMEOUT}ms.` +
        (notifications.length > 0
          ? ` Notifications shown: ${notifications.join(" | ")}.`
          : " No notifications shown.") +
        (screenshot ? ` Screenshot: ${screenshot}` : ""),
    );
  }

  if (installedExtensionName !== EXTENSION_NAME) {
    const screenshot = await captureWindowScreenshot(window, "install-wrong-name");

    throw new Error(
      `Expected ${EXTENSION_NAME} to be installed, found ${String(installedExtensionName)}.` +
        (screenshot ? ` Screenshot: ${screenshot}` : ""),
    );
  }

  let installedExtensionState: string | null;

  try {
    installedExtensionState = await (
      await window.waitForSelector('div[class*="installed-extensions-module__enabled--"]', {
        timeout: INSTALL_TIMEOUT,
      })
    ).textContent();
  } catch {
    const screenshot = await captureWindowScreenshot(window, "install-not-enabled");

    throw new HostGaveUpError(
      `"${EXTENSION_NAME}" was installed but never showed its enabled state within ${INSTALL_TIMEOUT}ms.` +
        (screenshot ? ` Screenshot: ${screenshot}` : ""),
    );
  }

  if (installedExtensionState !== "Enabled") {
    const screenshot = await captureWindowScreenshot(window, "install-not-enabled-state");

    throw new Error(
      `Expected ${EXTENSION_NAME} to be enabled, found ${String(installedExtensionState)}.` +
        (screenshot ? ` Screenshot: ${screenshot}` : ""),
    );
  }
}

/**
 * Dismisses every notification, so that one still in its enter animation does
 * not intercept pointer events meant for the elements behind it.
 */
export async function dismissNotifications(window: Page): Promise<void> {
  const notificationCloseSelector =
    'i[data-testid*="close-notification-for-notification_"], div[class*="close-button-module__closeButton--"][aria-label="Close"]';

  for (let attempt = 0; attempt < 10; attempt++) {
    const closeButtons = await window.$$(notificationCloseSelector);

    if (closeButtons.length === 0) {
      return;
    }

    for (const closeButton of closeButtons) {
      await closeButton.click({ force: true }).catch(() => {});
    }

    await window.waitForTimeout(200);
  }
}
