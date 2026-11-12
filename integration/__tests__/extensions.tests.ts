/**
 * Copyright (c) OpenLens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

// The extension in Freelens 2, with no cluster: the tarball installed from the Extensions page of a new
// profile and listed as Enabled; each entry point reached as the host loaded it, and extending the
// classes of the host; the dispatcher of the host process as it was; the bundle of the main process
// downloading an artifact inside that process, over HTTP and over HTTPS from a store whose certificate it
// verified, and resolving there the route to a store at a private address, refused without its allowance and
// direct with it, with no connection; and no error in what the host writes, on its output, in its console or
// in the files of its log.
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
import { createTlsFixture } from "../../test/tls-fixture";
import * as velero from "../helpers/velero-extension";
import { PRIVATE_STORE_ADDRESS } from "../helpers/velero-route";

import type { ElectronApplication, Page } from "playwright";

const EXTENSION = velero.EXTENSION_NAME;
const SANITIZED = EXTENSION.replace("@", "").replace("/", "--");
const DISPATCHERS = ["undici.globalDispatcher.1", "undici.globalDispatcher.2"];
// The name of the store the certificate of the test is for, and a name it is not for.
const STORE_NAME = "storage.example.invalid";
const OTHER_NAME = "wrong.example.invalid";
// The origin the storage location of the route gives: the store at a private address, where nothing of the tests
// listens and which the runners do not route.
const PRIVATE_ORIGIN = `https://${PRIVATE_STORE_ADDRESS}:9000`;
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

// What the operator may allow, as a refusal carries it.
interface AllowanceNeeded {
  what: string;
  origin: string;
  location?: string;
}

// How a resolution of a route ended in the main process of the host: the route; the refusal by its class, its code,
// its step, its rule and what the operator may allow; or what else was thrown, by its class and its message.
interface RouteEnded {
  route?: Record<string, unknown>;
  name?: string;
  message?: string;
  code?: string;
  stage?: string;
  verdict?: string;
  needs?: AllowanceNeeded;
}

// The words the main process gives the views of a download that failed.
interface FailureWords {
  ok?: boolean;
  code?: string;
  stage?: string;
  retry?: boolean;
  text?: string;
  needs?: AllowanceNeeded;
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
      // With no cluster: the store of the profile names no kubeconfig for the catalog to sync, also when
      // the test runs beside the suites of the views, which are given the one of the environment.
      started = await velero.startWithExtension(
        async (application) => {
          errors.watch(application.window);
          dispatchersBefore = await dispatchersOf(application.app);
        },
        "Dark",
        2,
        [],
      );
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
        "downloadFailureOf",
        "registerHandlers",
        "resolveRoute",
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

  it("downloads and decodes an artifact over HTTPS inside the main process of the host, from a store whose certificate it verified and from no other", async () => {
    // Made by the case, outside the host, before the downloads, by the helper of the unit tests: an authority
    // made for the test, and the certificate it signed for the store, for two names and two addresses,
    // storage.example.invalid and 127.0.0.1 among them.
    const making = createTlsFixture(STORE_NAME);
    const certificates = await velero.within("The certificates of the test", 45_000, making).catch((error: unknown) => {
      // Made after its time all the same: removed, with its keys, when it ends.
      making.then((late) => late.dispose()).catch(() => undefined);
      throw error;
    });

    try {
      const outcome = await velero.within(
        "The downloads over HTTPS in the main process of the host",
        60_000,
        app.evaluate(
          async (_electron, given) => {
            type Ended = { decoded?: boolean; code?: string; verdict?: string; words?: string };
            const main = process.mainModule;

            if (!main) throw new Error("The main module of the host is not reachable");
            // The module the host loaded, as the case of the main entry point proved.
            const { downloadArtifact, DiagnosticKubernetes } = main.require(given.file) as {
              downloadArtifact(url: string, route: object, signal: AbortSignal): Promise<Buffer>;
              DiagnosticKubernetes: new (
                entry: { id: string; name: string; kubeConfigPath: string; contextName: string },
                host: object,
              ) => {
                certificate(namespace: string, storage: { caCert?: string }, signal: AbortSignal): Promise<string>;
              };
            };
            const load = main.require.bind(main);
            const https = load("node:https") as typeof import("node:https");
            const tls = load("node:tls") as typeof import("node:tls");
            const util = load("node:util") as typeof import("node:util");
            const zlib = load("node:zlib") as typeof import("node:zlib");
            const payload = Buffer.from(`${"synthetic log line over TLS\n".repeat(2000)}end`);
            const seen: { url?: string; host?: string; servername?: string }[] = [];
            // The name each ClientHello asked for, in the order the connections came.
            const hellos: string[] = [];
            const ended: {
              authority?: string;
              trusted?: Ended;
              untrusted?: Ended;
              otherName?: Ended;
              port?: number;
            } = {};
            let connections = 0;
            let closed = false;
            const context = tls.createSecureContext({ key: given.key, cert: given.cert });
            // The store, on the loopback alone, with the certificate the authority of the test signed, which
            // is valid for 127.0.0.1, the address every download connects to: a download refused for another
            // name is refused for the name of its URL, and not for the address. The store counts the
            // connections it is given, the name each asks for, and the requests it is sent.
            const server = https.createServer(
              {
                key: given.key,
                cert: given.cert,
                SNICallback: (servername, callback) => {
                  hellos.push(servername);
                  callback(null, context);
                },
              },
              (request, response) => {
                const servername = (request.socket as import("node:tls").TLSSocket).servername;

                seen.push({
                  url: request.url,
                  host: request.headers.host,
                  servername: typeof servername === "string" ? servername : undefined,
                });
                response.writeHead(200, { "content-type": "application/gzip" });
                response.end(zlib.gzipSync(payload));
              },
            );

            server.on("connection", () => {
              connections += 1;
            });
            await new Promise<void>((resolve, reject) => {
              server.once("error", reject);
              server.listen(0, "127.0.0.1", () => resolve());
            });
            // Listening: from here on the store is closed, however the case ends.
            try {
              const address = server.address();

              if (!address || typeof address === "string") throw new Error("Missing loopback listener");
              const port = address.port;
              // The log of a backup at its signed URL, from the store by the name the URL gives it, within a
              // time of its own: a download that does not end ends as cancelled.
              const download = async (name: string, ca: string | undefined): Promise<Ended> => {
                const origin = `https://${name}:${port}`;

                try {
                  const content = await downloadArtifact(
                    `${origin}${given.target}`,
                    { origin, pathname: given.pathname, address: "127.0.0.1", port, mode: "test", ca },
                    AbortSignal.timeout(12_000),
                  );

                  return { decoded: content.equals(payload) };
                } catch (error) {
                  const { code, verdict, message } = error as { code?: string; verdict?: string; message?: string };
                  let fields: string;

                  try {
                    fields = JSON.stringify(error);
                  } catch {
                    fields = "the enumerable fields of the failure cannot be written";
                  }
                  // What the failure says, in each form it has: its message, its text, its enumerable fields,
                  // and every field of its own, enumerable or not, with its stack and its cause.
                  return {
                    code,
                    verdict,
                    words: [message, String(error), fields, util.inspect(error, { showHidden: true, depth: 4 })].join(
                      "\n",
                    ),
                  };
                }
              };
              // The authority as a storage location gives it inline, its PEM in base64, read by the adapter of
              // the bundle as the download of a log reads it. A failure with no code is kept by its name and
              // its message.
              let ca: string | undefined;

              ended.port = port;
              try {
                ca = await new DiagnosticKubernetes(
                  { id: "fnd-10", name: "fnd-10", kubeConfigPath: "", contextName: "" },
                  {},
                ).certificate("velero", { caCert: given.caCert }, AbortSignal.timeout(5_000));
                ended.authority = typeof ca === "string" ? "read" : "none";
              } catch (error) {
                const { code, name, message } = error as { code?: unknown; name?: unknown; message?: unknown };

                ended.authority = typeof code === "string" ? code : `${String(name)}: ${String(message)}`;
              }
              // The download the store answers comes first: an authority kept from one download for the next
              // would make the second one decode.
              ended.trusted = await download(given.name, ca);
              // The same store with no authority given, and the authority given for a name the certificate of
              // the store is not for.
              ended.untrusted = await download(given.name, undefined);
              ended.otherName = await download(given.other, ca);
            } finally {
              let timer: ReturnType<typeof setTimeout> | undefined;

              server.closeAllConnections();
              closed = await Promise.race([
                new Promise<boolean>((resolve) => server.close(() => resolve(true))),
                new Promise<boolean>((resolve) => {
                  timer = setTimeout(() => resolve(false), 10_000);
                }),
              ]);
              clearTimeout(timer);
            }
            return { ...ended, connections, hellos, seen, closed };
          },
          {
            file: realpathSync(path.join(build.folder, build.main)),
            key: certificates.key,
            cert: certificates.cert,
            caCert: Buffer.from(certificates.ca).toString("base64"),
            name: STORE_NAME,
            other: OTHER_NAME,
            pathname: "/logs/a.gz",
            target: "/logs/a.gz?X-Amz-Signature=synthetic",
          },
        ),
      );

      // The authority read from what the location gives, and the file of the store it signed, decoded whole.
      expect(outcome.authority).toBe("read");
      expect(outcome.trusted).toEqual({ decoded: true });
      // The same store with no authority, and a certificate that is not for the name of the URL: each a
      // certificate refused, said without the URL, its host, its path or its signature.
      for (const refused of [outcome.untrusted, outcome.otherName]) {
        expect(refused).toMatchObject({ code: "tls-invalid", verdict: "untrusted" });
        expect(refused?.words).not.toMatch(/example\.invalid|\/logs\/a\.gz|X-Amz-Signature|https?:\/\//);
      }
      // Three connections, each asking for the name of its URL, in the order of the downloads, and one request,
      // over the connection that was verified: nothing is sent to a store whose certificate was refused, and
      // nothing is asked again without the verification.
      expect(outcome.connections).toBe(3);
      expect(outcome.hellos).toEqual([STORE_NAME, STORE_NAME, OTHER_NAME]);
      expect(outcome.seen).toEqual([
        {
          url: "/logs/a.gz?X-Amz-Signature=synthetic",
          host: `${STORE_NAME}:${outcome.port}`,
          servername: STORE_NAME,
        },
      ]);
      expect(outcome.closed).toBe(true);
    } finally {
      await certificates.dispose();
    }
  }, 150_000);

  it("resolves inside the main process of the host the route to a store at a private address: refused without its allowance, with the words of what may be allowed, direct to that address with it, and nothing connected", async () => {
    // The request of the views the route is for: the log of a backup of the installation in `velero`.
    const request = "0e7c5b7a-1111-4111-8111-000000000290";
    // The build the host made of the tarball in the profile, as its modules name it.
    const folder = realpathSync(build.folder);
    const outcome = await velero.within(
      "The routes resolved in the main process of the host",
      30_000,
      app.evaluate(
        async (_electron, given) => {
          const main = process.mainModule;

          if (!main) throw new Error("The main module of the host is not reachable");
          // The module the host loaded, as the case of the main entry point proved: the route, and the words the main
          // process gives the views of a download that failed.
          const { resolveRoute, downloadFailureOf } = main.require(given.file) as {
            resolveRoute(
              url: string,
              input: object,
              storage: object,
              signal: AbortSignal,
              dependencies: object,
            ): Promise<{ route: Record<string, unknown>; close(): void | Promise<void> }>;
            downloadFailureOf(error: unknown, context: object): FailureWords;
          };
          const net = main.require("node:net") as typeof import("node:net");
          // What the route asks of what it is given, in its order: the allowances of the cluster, which hold nothing,
          // then the private address for the origin of the store, as the operator gives it; and stand-ins of the
          // cluster, of the resolver of this machine and of kubectl, which refuse what they are asked: no cluster
          // takes part, nothing is resolved and no tunnel is opened.
          const asked: string[] = [];
          const allowances: { what: string; origin: string }[] = [];
          const refuse = (what: string) => {
            asked.push(what);
            return Promise.reject(new Error(`The case gives the route no ${what}`));
          };
          const dependencies = {
            allowed: (what: string, origin: string, location: string) => {
              asked.push(`allowed ${what} ${origin} ${location}`);
              return allowances.some((entry) => entry.what === what && entry.origin === origin);
            },
            api: {
              assertCurrent: () => {
                asked.push("catalog");
              },
              read: (kind: string, namespace: string, name: string) => refuse(`read ${kind} ${namespace}/${name}`),
              list: (kind: string, namespace: string, name: string) => refuse(`list ${kind} ${namespace}/${name}`),
            },
            lookup: (host: string) => refuse(`lookup ${host}`),
            tunnel: (pod: { name?: string; port?: number }) => refuse(`kubectl ${pod.name}:${pod.port}`),
          };
          // What the route may have opened: every connection a socket of the process is asked for, and every listener
          // a server of it opens, whose stack, with all its frames, names the build the host made of the extension,
          // and every connection to the address of the store. What else the host opens meanwhile is neither recorded
          // nor touched.
          const opened: string[] = [];
          const sockets: import("node:net").Socket[] = [];
          const servers: import("node:net").Server[] = [];
          const { connect } = net.Socket.prototype;
          const { listen } = net.Server.prototype;
          const ofTheExtension = () => {
            const limit = Error.stackTraceLimit;

            Error.stackTraceLimit = Number.POSITIVE_INFINITY;
            try {
              const stack = new Error("Asked").stack ?? "";

              return stack.includes(given.folder) || stack.includes(given.folderUrl);
            } finally {
              Error.stackTraceLimit = limit;
            }
          };
          // Where a socket is asked to connect, or a server to listen, by the arguments it is given: its options, which
          // `net.connect` passes as the first of an array, a port and a host, or the path of a pipe.
          const where = (args: unknown[]): { host?: string; label: string } => {
            const [first, second] = (Array.isArray(args[0]) ? args[0] : args) as unknown[];

            if (typeof first === "object" && first !== null) {
              const { host, port, path } = first as { host?: unknown; port?: unknown; path?: unknown };

              if (typeof path === "string") return { label: path };
              return { host: typeof host === "string" ? host : undefined, label: `${String(host)}:${String(port)}` };
            }
            if (typeof first === "string" && !/^\d+$/.test(first)) return { label: first };
            const host = typeof second === "string" ? second : undefined;

            return { host, label: `${String(host)}:${String(first)}` };
          };
          // Each resolution ends within a time of its own, the two well within the bound of the evaluation, so that the
          // spies are put back before the case gives up on it. A refusal is kept with the words the main process makes
          // of that very error, and what else is thrown with its message.
          const resolve = async (): Promise<{ ended: RouteEnded; words?: FailureWords }> => {
            let timer: ReturnType<typeof setTimeout> | undefined;

            try {
              const resolved = await Promise.race([
                resolveRoute(given.url, given.input, given.storage, new AbortController().signal, dependencies),
                new Promise<never>((_resolve, reject) => {
                  timer = setTimeout(() => reject(new Error("The resolution did not end in 8 s")), 8_000);
                }),
              ]);

              // A direct route holds nothing to close.
              await resolved.close();
              return { ended: { route: resolved.route } };
            } catch (error) {
              const { name, message, code, stage, verdict, needs } = error as RouteEnded;

              return {
                ended: name === "DiagnosticError" ? { name, code, stage, verdict, needs } : { name, message },
                words: downloadFailureOf(error, given.context),
              };
            } finally {
              clearTimeout(timer);
            }
          };
          const ended: {
            refused?: RouteEnded;
            words?: FailureWords;
            direct?: RouteEnded;
            asked: string[][];
            opened: string[];
          } = { asked: [], opened };

          net.Socket.prototype.connect = function (this: import("node:net").Socket, ...args: unknown[]) {
            const { host, label } = where(args);

            if (host === given.address || ofTheExtension()) {
              opened.push(`connect ${label}`);
              sockets.push(this);
            }
            return connect.apply(this, args as never);
          } as typeof connect;
          net.Server.prototype.listen = function (this: import("node:net").Server, ...args: unknown[]) {
            if (ofTheExtension()) {
              opened.push(`listen ${where(args).label}`);
              servers.push(this);
            }
            return listen.apply(this, args as never);
          } as typeof listen;
          try {
            // Without the allowance of private addresses for the cluster, then with it.
            const refused = await resolve();

            ended.refused = refused.ended;
            ended.words = refused.words;
            ended.asked.push(asked.splice(0));
            allowances.push({ what: "private", origin: given.origin });
            ended.direct = (await resolve()).ended;
            ended.asked.push(asked.splice(0));
            // A turn of the loop and a tenth of a second more, for what the route may ask once it has answered.
            await new Promise<void>((done) => setImmediate(done));
            await new Promise<void>((done) => setTimeout(done, 100));
          } finally {
            net.Socket.prototype.connect = connect;
            net.Server.prototype.listen = listen;
            for (const socket of sockets) socket.destroy();
            for (const server of servers) server.close();
          }
          return ended;
        },
        {
          file: realpathSync(path.join(build.folder, build.main)),
          folder,
          folderUrl: pathToFileURL(folder).href,
          // The log of the backup at its signed URL, in the bucket of the location, which is in the path.
          url: `${PRIVATE_ORIGIN}/fnd-10/backups/fnd-10/fnd-10-logs.gz?X-Amz-Signature=synthetic`,
          origin: PRIVATE_ORIGIN,
          address: PRIVATE_STORE_ADDRESS,
          input: { requestId: request, namespace: "velero", target: "BackupLog", name: "fnd-10", uid: "fnd-10-backup" },
          // A storage location of the plugin of AWS whose URL names the address, as Velero reads one.
          storage: {
            metadata: { name: "default", namespace: "velero", uid: "fnd-10-location" },
            spec: {
              provider: "aws",
              objectStorage: { bucket: "fnd-10" },
              config: { region: "minio", s3ForcePathStyle: "true", s3Url: PRIVATE_ORIGIN },
            },
          },
          // What the main process says a failed download of that request with.
          context: { artifact: "BackupLog", name: "fnd-10", namespace: "velero", request: `fnd-10-${request}` },
        },
      ),
    );

    // Without the allowance: refused, with what the operator may allow, a private address for the origin of the store.
    expect(outcome.refused).toEqual({
      name: "DiagnosticError",
      code: "destination-denied",
      stage: "route",
      verdict: "allowance",
      needs: { what: "private", origin: PRIVATE_ORIGIN },
    });
    // The words the main process makes of that very refusal say what may be allowed, for that origin, and nothing of the
    // path or the signature of the URL; the failure carries it for the views to offer.
    expect(outcome.words).toMatchObject({
      ok: false,
      code: "destination-denied",
      stage: "route",
      retry: false,
      needs: { what: "private", origin: PRIVATE_ORIGIN },
    });
    expect(outcome.words?.text).toContain(
      `The store of ${PRIVATE_ORIGIN} is at a private address: a connection to it is made only after it is allowed.`,
    );
    expect(outcome.words?.text).not.toMatch(/\/backups\/|-logs\.gz|X-Amz-Signature/);
    // With it, the route is direct to that address, at the port of the URL, for the file asked, encrypted.
    expect(outcome.direct).toEqual({
      route: {
        origin: PRIVATE_ORIGIN,
        pathname: "/fnd-10/backups/fnd-10/fnd-10-logs.gz",
        address: PRIVATE_STORE_ADDRESS,
        port: 9000,
        mode: "direct",
        allowHttp: false,
        allowPrivate: true,
      },
    });
    // Each time the route asked the allowance of the cluster, for that origin and that location, and nothing of the
    // cluster, of the resolver of this machine or of kubectl.
    expect(outcome.asked).toEqual([
      [`allowed private ${PRIVATE_ORIGIN} velero/default`],
      [`allowed private ${PRIVATE_ORIGIN} velero/default`],
    ]);
    // And the route asked for no connection and opened no listener, while it was resolved and in the turns after it.
    expect(outcome.opened).toEqual([]);
  }, 60_000);

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
