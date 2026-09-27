/**
 * Copyright (c) OpenLens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { expect } from "@jest/globals";
import * as utils from "../helpers/utils";

import type { ConsoleMessage, ElectronApplication, Page } from "playwright";

const EXTENSION = "@freelensapp/velero-extension";
const DISPATCHERS = ["undici.globalDispatcher.1", "undici.globalDispatcher.2"];

interface LoadedEntry {
  entry?: string;
  exportNames: string[];
  defaultName?: string;
  extendsHost: boolean;
}

describe("extensions page tests", () => {
  let window: Page;
  let app: ElectronApplication;
  let cleanup: undefined | (() => Promise<void>);
  let dispatchersBefore: string[] = [];
  const errorLogs: string[] = [];
  const processErrorLogs: string[] = [];
  const outputErrorPattern = /\[out\]\s*error:/i;
  const ansiEscapePattern = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");
  let processOutputBuffer = "";
  let restoreProcessOutputHooks: undefined | (() => void);

  const collectOutputErrors = (chunk: string | Uint8Array) => {
    const text = typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
    processOutputBuffer += text;

    // Keep buffer bounded while preserving enough tail to match split patterns across chunks.
    if (processOutputBuffer.length > 200_000) {
      processOutputBuffer = processOutputBuffer.slice(-20_000);
    }

    const normalizedOutput = processOutputBuffer.replaceAll(ansiEscapePattern, "");

    if (outputErrorPattern.test(normalizedOutput)) {
      processErrorLogs.push(normalizedOutput.trim());
      processOutputBuffer = "";
    }
  };

  const logger = (msg: ConsoleMessage) => {
    const text = msg.text();
    const normalizedText = text.replaceAll(ansiEscapePattern, "");

    console.log(text);

    // Some app logs are emitted as "log" messages, so inspect both console type and message content.
    if (msg.type() === "error" || outputErrorPattern.test(normalizedText)) {
      errorLogs.push(`[${msg.type()}] ${normalizedText}`);
    }
  };

  /** What each dispatcher slot of the main process holds: the name of its class, or "undefined". */
  const dispatchers = () =>
    app.evaluate(
      (_electron, keys) =>
        keys.map((key) => {
          const slots = globalThis as unknown as Record<symbol, { constructor?: { name?: string } } | undefined>;
          const value = slots[Symbol.for(key)];

          return value === undefined ? "undefined" : (value.constructor?.name ?? typeof value);
        }),
      DISPATCHERS,
    );

  beforeAll(async () => {
    const originalStdoutWrite = process.stdout.write.bind(process.stdout);
    const originalStderrWrite = process.stderr.write.bind(process.stderr);

    process.stdout.write = ((chunk, encoding, cb) => {
      collectOutputErrors(chunk);

      return originalStdoutWrite(chunk, encoding as never, cb as never);
    }) as typeof process.stdout.write;

    process.stderr.write = ((chunk, encoding, cb) => {
      collectOutputErrors(chunk);

      return originalStderrWrite(chunk, encoding as never, cb as never);
    }) as typeof process.stderr.write;

    restoreProcessOutputHooks = () => {
      process.stdout.write = originalStdoutWrite;
      process.stderr.write = originalStderrWrite;
    };

    ({ window, cleanup, app } = await utils.start());
    window.on("console", logger);
    console.log("await utils.clickWelcomeButton");
    await utils.clickWelcomeButton(window);
    dispatchersBefore = await dispatchers();

    // Navigate to extensions page
    console.log("await app.evaluate");
    await app.evaluate(async ({ app }) => {
      await app.applicationMenu
        ?.getMenuItemById(process.platform === "darwin" ? "mac" : "file")
        ?.submenu?.getMenuItemById("navigate-to-extensions")
        ?.click();
    });

    // Trigger extension install
    const textbox = window.getByPlaceholder("Name or file path or URL");
    console.log("await textbox.fill");
    await textbox.fill(process.env.EXTENSION_PATH || EXTENSION);
    const install_button_selector = 'button[class*="Button install-module__button--"]';
    console.log("await window.click [data-waiting=false]");
    await window.click(install_button_selector.concat("[data-waiting=false]"));

    // Expect extension to be listed in installed list and enabled
    console.log('await window.waitForSelector div[class*="installed-extensions-module__extensionName--"]');
    const installedExtensionName = await (
      await window.waitForSelector('div[class*="installed-extensions-module__extensionName--"]')
    ).textContent();
    expect(installedExtensionName).toBe(EXTENSION);
    const installedExtensionState = await (
      await window.waitForSelector('div[class*="installed-extensions-module__enabled--"]')
    ).textContent();
    expect(installedExtensionState).toBe("Enabled");
    // Dismiss any notifications so a notification still in its enter animation
    // does not intercept pointer events on the elements behind it.
    console.log("dismiss notifications");
    const notificationCloseSelector =
      'i[data-testid*="close-notification-for-notification_"], div[class*="close-button-module__closeButton--"][aria-label="Close"]';
    for (let attempt = 0; attempt < 10; attempt++) {
      const closeButtons = await window.$$(notificationCloseSelector);
      if (closeButtons.length === 0) break;
      for (const closeButton of closeButtons) {
        await closeButton.click({ force: true }).catch(() => {});
      }
      await window.waitForTimeout(200);
    }
  }, 120 * 1000);

  afterAll(
    async () => {
      // Keep listeners active through cleanup to catch late shutdown errors in CI logs.
      await cleanup?.();
      window.off("console", logger);
      restoreProcessOutputHooks?.();
      expect([...errorLogs, ...processErrorLogs]).toEqual([]);
    },
    10 * 60 * 1000,
  );

  it(
    "installs an extension",
    async () => {
      expect([...errorLogs, ...processErrorLogs]).toEqual([]);
    },
    100 * 60 * 1000,
  );

  it("loads the main entry point in the main process of the host", async () => {
    const loaded: LoadedEntry = await app.evaluate(() => {
      const main = process.mainModule;

      if (!main) throw new Error("The main module of the host is not reachable");
      const modules = (main.constructor as unknown as { _cache: Record<string, NodeModule> })._cache;
      const entry = Object.keys(modules).find((key) => /velero-extension[\\/]out[\\/]main[\\/]index\.js$/.test(key));
      const exported = entry ? (modules[entry].exports as Record<string, unknown>) : undefined;
      const extension = exported?.default as (new () => unknown) | undefined;
      const host = (globalThis as unknown as { LensExtensions: { Main: { LensExtension: new () => unknown } } })
        .LensExtensions.Main.LensExtension;

      return {
        entry,
        exportNames: Object.keys(exported ?? {}).sort(),
        defaultName: extension?.name,
        extendsHost: extension ? extension.prototype instanceof host : false,
      };
    });

    expect(loaded.entry).toBeDefined();
    expect(loaded.defaultName).toBe("VeleroMain");
    expect(loaded.extendsHost).toBe(true);
    expect(loaded.exportNames).toEqual(
      expect.arrayContaining([
        "DiagnosticError",
        "DiagnosticKubernetes",
        "DiagnosticService",
        "downloadArtifact",
        "openPodTunnel",
      ]),
    );
  });

  it("loads the renderer entry point in the window of the host", async () => {
    const loaded: LoadedEntry = await window.evaluate(() => {
      const modules = (require as unknown as { cache: Record<string, NodeModule> }).cache;
      const entry = Object.keys(modules).find((key) =>
        /velero-extension[\\/]out[\\/]renderer[\\/]index\.js$/.test(key),
      );
      const exported = entry ? (modules[entry].exports as Record<string, unknown>) : undefined;
      const extension = exported?.default as (new () => unknown) | undefined;
      const host = (globalThis as unknown as { LensExtensions: { Renderer: { LensExtension: new () => unknown } } })
        .LensExtensions.Renderer.LensExtension;

      return {
        entry,
        exportNames: Object.keys(exported ?? {}).sort(),
        defaultName: extension?.name,
        extendsHost: extension ? extension.prototype instanceof host : false,
      };
    });

    expect(loaded.entry).toBeDefined();
    expect(loaded.defaultName).toBe("VeleroRenderer");
    expect(loaded.extendsHost).toBe(true);
  });

  it("leaves the dispatcher of the host process as it found it", async () => {
    expect(await dispatchers()).toEqual(dispatchersBefore);
  });

  it("downloads and decodes an artifact inside the main process of the host", async () => {
    const outcome = await app.evaluate(async () => {
      const main = process.mainModule;

      if (!main) throw new Error("The main module of the host is not reachable");
      const modules = (main.constructor as unknown as { _cache: Record<string, NodeModule> })._cache;
      const entry = Object.keys(modules).find((key) => /velero-extension[\\/]out[\\/]main[\\/]index\.js$/.test(key));

      if (!entry) throw new Error("The main entry point of the extension is not loaded");
      const { downloadArtifact } = modules[entry].exports as {
        downloadArtifact(url: string, route: object, signal: AbortSignal): Promise<Buffer>;
      };
      const load = main.require.bind(main);
      const http = load("node:http") as typeof import("node:http");
      const zlib = load("node:zlib") as typeof import("node:zlib");
      const payload = Buffer.from(`${"synthetic log line\n".repeat(2000)}end`);
      const seen: { url?: string; host?: string }[] = [];
      const server = http.createServer((request, response) => {
        seen.push({ url: request.url, host: request.headers.host });
        if (request.url?.startsWith("/missing")) {
          response.writeHead(404).end();
          return;
        }
        response.writeHead(200, { "content-type": "application/gzip" });
        response.end(zlib.gzipSync(payload));
      });

      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      const address = server.address();

      if (!address || typeof address === "string") throw new Error("Missing loopback listener");
      const port = address.port;
      const route = (pathname: string) => ({
        origin: `http://artifact.invalid:${port}`,
        pathname,
        address: "127.0.0.1",
        port,
        mode: "test",
        allowHttp: true,
      });
      const failure = (error: unknown) => {
        const { code, message } = error as { code?: string; message?: string };

        return { code, message };
      };

      try {
        const content = await downloadArtifact(
          `http://artifact.invalid:${port}/logs/a.gz?X-Sig=abc`,
          route("/logs/a.gz"),
          new AbortController().signal,
        );
        const missing = await downloadArtifact(
          `http://artifact.invalid:${port}/missing?X-Sig=abc`,
          route("/missing"),
          new AbortController().signal,
        ).then(() => ({ code: "resolved", message: "" }), failure);
        let foreign: { code?: string; message?: string };

        try {
          await downloadArtifact(
            `http://other.invalid:${port}/logs/a.gz`,
            route("/logs/a.gz"),
            new AbortController().signal,
          );
          foreign = { code: "accepted" };
        } catch (error) {
          foreign = failure(error);
        }

        return { equal: content.equals(payload), missing, foreign, seen };
      } finally {
        server.closeAllConnections();
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    });

    expect(outcome.equal).toBe(true);
    expect(outcome.seen[0]).toEqual({
      url: "/logs/a.gz?X-Sig=abc",
      host: expect.stringMatching(/^artifact\.invalid:/),
    });
    expect(outcome.missing.code).toBe("artifact-missing");
    expect(outcome.missing.message).not.toMatch(/X-Sig|artifact\.invalid/);
    expect(outcome.foreign.code).toBe("destination-denied");
  });
});
