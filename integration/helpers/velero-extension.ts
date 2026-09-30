/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

// Helpers shared by the integration smoke test (`integration/__tests__`) and
// the E2E suite (`e2e/__tests__`).
//
// Both suites run inside a checkout of freelensapp/freelens: their files are
// copied next to the Freelens ones, under `integration/__tests__` and
// `integration/helpers`, and are run by the Freelens `test:integration` script,
// which owns the Playwright/Electron launch helpers (`../helpers/utils`) these
// suites build on. That is why relative imports of `../helpers/*` resolve when
// the tests run but not inside this repository.

import { execFileSync } from "node:child_process";
import { mkdir, readdir, readFile, rm, unlink, writeFile } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { setImmediate } from "node:timers";
import { _electron as electron } from "playwright";
import * as utils from "./utils";

import type { ConsoleMessage, ElectronApplication, Page, Request } from "playwright";

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
 * Starts Freelens as the helper of the host does, with two differences: before
 * the launch the profile gets preferences that sync no kubeconfig, and that name
 * a theme. Left to its default, Freelens loads the kubeconfig of the user into
 * its catalog, and the clusters of the user have no place in a run of this
 * suite, nor in one of its screenshots; and it takes the theme of the system,
 * which is dark on a machine and light on another.
 */
export async function startIsolated(profile?: string, theme: ColorTheme = "Dark"): Promise<StartedApplication> {
  const executable = utils.appPaths[process.platform];

  if (!executable) {
    throw new Error(`No Freelens build is known for ${process.platform}`);
  }
  const directory =
    profile ?? path.join(os.tmpdir(), "freelens-integration-testing", `velero-${process.pid}-${Date.now()}`);

  process.env.FREELENS_INTEGRATION_TESTING_DIR = directory;
  // Playwright does not read the package.json through the runtime of Jest.
  process.env.PW_VERSION_OVERRIDE = (
    require("./../../package.json") as { devDependencies: Record<string, string> }
  ).devDependencies.playwright.replace(/[^0-9.]/g, "");
  global.setImmediate = setImmediate;
  // A profile that is given is the one of a start before this one, and is found as that start left it.
  if (!profile) {
    await rm(directory, { recursive: true, force: true });
    await mkdir(path.join(directory, "home", ".freelens", "extensions"), { recursive: true });
    await mkdir(path.join(directory, APPLICATION_NAME), { recursive: true });
    await writeFile(
      path.join(directory, APPLICATION_NAME, "lens-user-store.json"),
      JSON.stringify({ preferences: { syncKubeconfigEntries: [], colorTheme: theme } }),
      { mode: 0o600 },
    );
  }
  const app = await electron.launch({
    args: ["--integration-testing"],
    executablePath: executable,
    bypassCSP: true,
    env: { ...process.env, FREELENS_INTEGRATION_TESTING_DIR: directory, LOG_LEVEL: "debug" } as Record<string, string>,
    timeout: 100_000,
  });
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
const OUTPUT_ERROR_PATTERN = /\[out\]\s*error:/i;
// The host's kubectl proxy logs at error level every request its client gave
// up on before the API server answered. That is what closing a drawer does to
// the reference loads it had just started: an abort on purpose, not a failure.
// The record spans from its opening line to its closing one.
const CANCELED_PROXY_RECORD_PATTERN =
  /[^\n]*\[out\]\s*error:\s*┏[^\n]*Error while proxying request: context canceled[\s\S]*?\[out\]\s*error:\s*┗[^\n]*\n?/g;
const CANCELED_PROXY_START_PATTERN = /\[out\]\s*error:\s*┏[^\n]*Error while proxying request: context canceled/;
const HOST_ASSET_FAILURE_PATTERN = /^Failed to load resource: net::/;
const HOST_ASSET_URL_PATTERN = /^https:\/\/renderer\.freelens\.app(:\d+)?\/build\//;

/**
 * Collects everything that looks like an error while the app runs: renderer
 * console messages and the process output of the main process, which reports
 * extension failures as plain `[out] error:` lines rather than as exceptions.
 */
export interface ErrorCollector {
  /** Starts capturing the process output. Call it before launching the app. */
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
  let restoreOutputHooks: undefined | (() => void);

  const collectOutputErrors = (chunk: string | Uint8Array) => {
    const text = typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");

    outputBuffer += text;

    // Keep the buffer bounded while preserving enough tail to match patterns
    // split across chunks.
    if (outputBuffer.length > 200_000) {
      outputBuffer = outputBuffer.slice(-20_000);
    }

    const normalizedOutput = outputBuffer.replace(ANSI_ESCAPE_PATTERN, "").replace(CANCELED_PROXY_RECORD_PATTERN, "");

    // A canceled-request record that is still arriving: wait for its end.
    if (CANCELED_PROXY_START_PATTERN.test(normalizedOutput)) {
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

    // Some app logs are emitted as "log" messages, so inspect both the console
    // type and the message content.
    if (message.type() === "error" || OUTPUT_ERROR_PATTERN.test(normalizedText)) {
      consoleErrors.push(`[${message.type()}] ${normalizedText}`);
    }
  };

  return {
    start: () => {
      const originalStdoutWrite = process.stdout.write.bind(process.stdout);
      const originalStderrWrite = process.stderr.write.bind(process.stderr);

      process.stdout.write = ((chunk, encoding, callback) => {
        collectOutputErrors(chunk);

        return originalStdoutWrite(chunk, encoding as never, callback as never);
      }) as typeof process.stdout.write;

      process.stderr.write = ((chunk, encoding, callback) => {
        collectOutputErrors(chunk);

        return originalStderrWrite(chunk, encoding as never, callback as never);
      }) as typeof process.stderr.write;

      restoreOutputHooks = () => {
        process.stdout.write = originalStdoutWrite;
        process.stderr.write = originalStderrWrite;
      };
    },

    watch: (window: Page) => {
      window.on("console", logger);
      window.on("requestfailed", requestFailedLogger);
    },

    stop: (window: Page) => {
      window.off("console", logger);
      window.off("requestfailed", requestFailedLogger);
      restoreOutputHooks?.();
      restoreOutputHooks = undefined;
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
 */
export async function startWithExtension(theme: ColorTheme = "Dark", attempts = 2): Promise<StartedApplication> {
  for (let attempt = 1; ; attempt++) {
    const started = await startIsolated(undefined, theme);

    try {
      await utils.clickWelcomeButton(started.window);
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

/**
 * Installs the packed extension and waits for it to be listed as enabled.
 *
 * `EXTENSION_PATH` points at the tarball built from this repository; without it
 * the extension is installed from the registry by name.
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

  const textbox = window.getByPlaceholder("Name or file path or URL");

  try {
    await textbox.waitFor({ state: "visible", timeout: INSTALL_TIMEOUT });
  } catch {
    const screenshot = await captureWindowScreenshot(window, "install-no-extensions-page");

    throw new Error(
      `The Extensions page never showed its install field (menu navigation may have failed). Current URL: ${window.url()}.` +
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
