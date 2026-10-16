/**
 * Copyright (c) OpenLens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

// The extension in Freelens 2, with no cluster: the tarball installed from the Extensions page of a new
// profile and listed as Enabled; each entry point reached as the host loaded it, and extending the
// classes of the host; the dispatcher of the host process as it was; the bundle of the main process
// downloading an artifact inside that process; and no error in what the host writes, on its output, in
// its console or in the files of its log.
//
// The host imports the main entry point, an ES module, from its file, and the renderer one from a URL of
// its own scheme. A module is held by the loader of its process under its URL, so the case asks the
// same URL and checks that the process holds one script of it before and after: what answers is the
// module the host loaded, and nothing loaded it a second time.

import { readdirSync, readFileSync, realpathSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as velero from "../helpers/velero-extension";

import type { ElectronApplication, Page } from "playwright";

const EXTENSION = velero.EXTENSION_NAME;
const SANITIZED = EXTENSION.replace("@", "").replace("/", "--");
const DISPATCHERS = ["undici.globalDispatcher.1", "undici.globalDispatcher.2"];
// The name the extension gives its store of the preferences, which each entry point opens when it is activated.
const STORE = "[VELERO-PREFERENCES]: LOADED";
const ANSI_ESCAPE_PATTERN = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");

interface LoadedEntry {
  // The scripts of the process that hold the entry point, by their URL, before the case asked for it and after.
  scripts: { before: string[]; after: string[] };
  exportNames: string[];
  defaultName?: string;
  extendsHost: boolean;
}

/** What each dispatcher slot of a main process holds: the name of its class, or "undefined". */
function dispatchersOf(app: ElectronApplication): Promise<string[]> {
  return app.evaluate(
    (_electron, keys) =>
      keys.map((key) => {
        const slots = globalThis as unknown as Record<symbol, { constructor?: { name?: string } } | undefined>;
        const value = slots[Symbol.for(key)];

        return value === undefined ? "undefined" : (value.constructor?.name ?? typeof value);
      }),
    DISPATCHERS,
  );
}

describe("extensions page tests", () => {
  let started: velero.StartedApplication | undefined;
  let app: ElectronApplication;
  let window: Page;
  let dispatchersBefore: string[] = [];
  const errors = velero.createErrorCollector();
  // The build the host made of the tarball in the profile: its folder, which names the build, and the
  // two entries of its manifest.
  const build = { folder: "", segment: "", main: "", renderer: "" };

  beforeAll(
    async () => {
      errors.start();
      started = await velero.startWithExtension(async (application) => {
        errors.watch(application.window);
        dispatchersBefore = await dispatchersOf(application.app);
      });
      ({ app, window } = started);
      await velero.dismissNotifications(window);
      const builds = path.join(started.directory, "Freelens", "extensions", SANITIZED);
      const [segment, ...others] = readdirSync(builds);
      const manifest = JSON.parse(readFileSync(path.join(builds, segment, "package.json"), "utf8")) as {
        main: string;
        renderer: string;
      };

      expect(others).toEqual([]);
      Object.assign(build, {
        folder: path.join(builds, segment),
        segment,
        main: manifest.main,
        renderer: manifest.renderer,
      });
    },
    5 * 60 * 1000,
  );

  afterAll(
    async () => {
      // Keep listeners active through cleanup to catch late shutdown errors.
      await started?.cleanup();
      if (window) errors.stop(window);
      expect(errors.errors()).toEqual([]);
    },
    10 * 60 * 1000,
  );

  it("installs the extension, which Freelens 2 lists as Enabled", async () => {
    const version = await app.evaluate(({ app }) => app.getVersion());
    const row = window.locator('[data-testid="extensions-table"] tbody tr', { hasText: EXTENSION });

    console.log(`Freelens ${version}, build of the extension ${build.segment}`);
    expect(version.split(".")[0]).toBe("2");
    await velero.navigateToExtensions(app);
    expect((await row.locator("td").nth(2).innerText()).trim()).toBe("Enabled");
    expect(errors.errors()).toEqual([]);
  });

  it("loads the main entry point in the main process of the host", async () => {
    const entry = realpathSync(path.join(build.folder, build.main));
    const loaded: LoadedEntry = await app.evaluate(
      async (_electron, { file, url }) => {
        const main = process.mainModule;

        if (!main) throw new Error("The main module of the host is not reachable");
        const inspector = main.require("node:inspector") as typeof import("node:inspector");
        // The scripts the process holds under the URL of the entry point, as its debugger lists them.
        const scripts = async () => {
          const session = new inspector.Session();
          const found: string[] = [];

          session.connect();
          session.on("Debugger.scriptParsed", ({ params }) => {
            if (params.url === url) found.push(params.scriptId);
          });
          try {
            await new Promise<void>((resolve, reject) =>
              session.post("Debugger.enable", (error) => (error ? reject(error) : resolve())),
            );
            await new Promise<void>((resolve) => session.post("Debugger.disable", () => resolve()));
          } finally {
            session.disconnect();
          }
          return found;
        };
        const before = await scripts();
        const exported = main.require(file) as Record<string, unknown>;
        const after = await scripts();
        const extension = exported.default as (new () => unknown) | undefined;
        const host = (globalThis as unknown as { FreelensExtensionApi: { Main: { LensExtension: new () => unknown } } })
          .FreelensExtensionApi.Main.LensExtension;

        return {
          scripts: { before, after },
          exportNames: Object.keys(exported).sort(),
          defaultName: extension?.name,
          extendsHost: extension ? extension.prototype instanceof host : false,
        };
      },
      { file: entry, url: pathToFileURL(entry).href },
    );

    // One script, the one the host loaded, and the same one after the case asked for its module.
    expect(loaded.scripts.before).toHaveLength(1);
    expect(loaded.scripts.after).toEqual(loaded.scripts.before);
    expect(loaded.defaultName).toBe("VeleroMain");
    expect(loaded.extendsHost).toBe(true);
    expect(loaded.exportNames).toEqual(
      expect.arrayContaining([
        "DiagnosticError",
        "DiagnosticKubernetes",
        "KubectlTunnels",
        "WriteGate",
        "downloadArtifact",
        "registerHandlers",
      ]),
    );
  });

  it("loads the renderer entry point in the window of the host, and links its stylesheet", async () => {
    const url = `freelens-extension://extensions/${[SANITIZED, build.segment, ...build.renderer.split("/")]
      .filter((segment) => segment !== "" && segment !== ".")
      .map(encodeURIComponent)
      .join("/")}`;
    const session = await window.context().newCDPSession(window);
    const scripts = async () => {
      const found: string[] = [];
      const listener = ({ url: parsed, scriptId }: { url: string; scriptId: string }) => {
        if (parsed === url) found.push(scriptId);
      };

      session.on("Debugger.scriptParsed", listener);
      await session.send("Debugger.enable");
      await session.send("Debugger.disable");
      session.off("Debugger.scriptParsed", listener);
      return found;
    };

    try {
      const before = await scripts();
      // Written as the text the page runs: the runner of the tests rewrites an `import()` of a function it
      // compiles into a call of its own, which the page does not have.
      const loaded = (await window.evaluate(`(async () => {
        const exported = await import(${JSON.stringify(url)});
        const extension = exported.default;
        const host = globalThis.FreelensExtensionApi.Renderer.LensExtension;

        return {
          exportNames: Object.keys(exported).sort(),
          defaultName: extension?.name,
          extendsHost: extension ? extension.prototype instanceof host : false,
          stylesheets: [...document.querySelectorAll("head link[rel=stylesheet]")].map((link) => link.href),
        };
      })()`)) as Omit<LoadedEntry, "scripts"> & { stylesheets: string[] };
      const after = await scripts();

      expect(before).toHaveLength(1);
      expect(after).toEqual(before);
      expect(loaded.defaultName).toBe("VeleroRenderer");
      expect(loaded.extendsHost).toBe(true);
      expect(loaded.exportNames).toEqual(["default"]);
      expect(loaded.stylesheets.filter((href) => href.includes(SANITIZED))).toEqual([
        url.replace(/renderer\.js$/, "renderer.css"),
      ]);
    } finally {
      await session.detach().catch(() => undefined);
    }
  });

  it("leaves the dispatcher of the host process as it found it", async () => {
    expect(await dispatchersOf(app)).toEqual(dispatchersBefore);
  });

  it("downloads and decodes an artifact inside the main process of the host", async () => {
    const outcome = await app.evaluate(
      async (_electron, file) => {
        const main = process.mainModule;

        if (!main) throw new Error("The main module of the host is not reachable");
        // The module the host loaded, as the case before proved.
        const { downloadArtifact } = main.require(file) as {
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
          let missing: { code?: string; message?: string };
          let foreign: { code?: string; message?: string };

          try {
            await downloadArtifact(
              `http://artifact.invalid:${port}/missing?X-Sig=abc`,
              route("/missing"),
              new AbortController().signal,
            );
            missing = { code: "resolved", message: "" };
          } catch (error) {
            missing = failure(error);
          }
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
      },
      realpathSync(path.join(build.folder, build.main)),
    );

    expect(outcome.equal).toBe(true);
    expect(outcome.seen[0]).toEqual({
      url: "/logs/a.gz?X-Sig=abc",
      host: expect.stringMatching(/^artifact\.invalid:/),
    });
    expect(outcome.missing.code).toBe("artifact-missing");
    expect(outcome.missing.message).not.toMatch(/X-Sig|artifact\.invalid/);
    expect(outcome.foreign.code).toBe("destination-denied");
  });

  it("logs the activation of each entry point, and no error, in the files of the log of the host", async () => {
    const directory = await velero.logDirectory(app);
    const files = (await readdir(directory)).filter((file) => file.endsWith(".log"));
    const lines = async (file: string) =>
      (await readFile(path.join(directory, file), "utf8")).replace(ANSI_ESCAPE_PATTERN, "").split("\n");
    const errorsOf: Record<string, string[]> = {};
    const activated: string[] = [];

    for (const file of files) {
      const read = await lines(file);

      errorsOf[file] = read.filter((line) => /^\s*error:/i.test(line));
      if (read.some((line) => line.includes(STORE))) activated.push(file);
    }

    // The log of the main process and the one of the window: each entry point opened its store when it
    // was activated.
    expect(files).toEqual(expect.arrayContaining(["lens.log", "lens-renderer-root-frame.log"]));
    expect(activated.sort()).toEqual(["lens-renderer-root-frame.log", "lens.log"]);
    expect(Object.values(errorsOf).flat()).toEqual([]);
  });
});
