// The package as Freelens v2 installs it, and the bundles as it loads them (REQ-196, REQ-198 and REQ-199; the
// unit parts of HOST-01, HOST-03 and HOST-04). The bundles are the ones `pnpm build` writes, which the unit run
// builds first. The bundle of the renderer is loaded here, with the API of the host the other tests have; the
// one of the main process in a process of its own, where nothing of the tests is, as the host loads it.

import { spawnSync } from "node:child_process";
import { type Dirent, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import * as Mobx from "mobx";
import * as MobxReact from "mobx-react";
import * as React from "react";
import * as ReactJsxRuntime from "react/jsx-runtime";
import * as ReactDom from "react-dom";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ACTIVATION_CALLS } from "./activation";
import {
  Common,
  forbiddenAccesses,
  type HostExtensionStub,
  hostCalls,
  loaded,
  Main,
  Renderer,
  resetIpc,
} from "./freelens-extensions";

interface Manifest {
  private?: boolean;
  type?: string;
  main: string;
  renderer: string;
  files: string[];
  engines: Record<string, string>;
  packageManager: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
}

const manifest: Manifest = JSON.parse(readFileSync(resolve("package.json"), "utf8"));
const MAIN = resolve("dist/main.js");
const RENDERER = resolve("dist/renderer.js");

// The release of the validation target of SPEC-0015, and the versions of the catalog of the host at its commit
// (pnpm-workspace.yaml of freelensapp/freelens at b9b53e16056578c5407312eba5823a089972f6d5, lines 11 to 17, 56
// and 120).
const SDK = "2.0.0";
const HOST_LIBRARIES = {
  react: "19.3.1",
  "react-dom": "19.3.1",
  "@types/react": "19.3.0",
  "@types/react-dom": "19.3.0",
  mobx: "7.0.6",
  "mobx-react": "10.0.2",
  electron: "44.10.0",
};
const REACT_WINDOW = "2.3.4";

// The modules a map of a bundle names, by where they come from: the sources of the extension, or a package,
// with the folder of the store of pnpm it was taken from, which names its version.
function sourcesOf(bundle: string): { own: string[]; packages: string[]; folders: string[] } {
  const { sources } = JSON.parse(readFileSync(`${bundle}.map`, "utf8")) as { sources: string[] };
  const own = sources.filter((source) => source.startsWith("../src/")).map((source) => source.slice(3));
  const others = sources.filter((source) => !source.startsWith("../src/"));

  return {
    own,
    packages: others.map((source) => source.replace(/^.*\/node_modules\/(?!\.pnpm)/, "")),
    folders: others.map((source) => /node_modules\/\.pnpm\/([^/]+)\//.exec(source)?.[1] ?? source),
  };
}

describe("the manifest", () => {
  it("declares the range of Freelens 2, an ES module, the entries and the files in dist, and the Node of the template", () => {
    expect(manifest.engines).toEqual({ node: ">= 24.0.0", freelens: "^2.0.0" });
    expect(manifest.type).toBe("module");
    expect([manifest.main, manifest.renderer]).toEqual(["dist/main.js", "dist/renderer.js"]);
    expect(manifest.files).toEqual(["dist/**/*"]);
    expect(manifest.private).toBeUndefined();
  });

  it("pins the SDK exactly to the version of the validation target, and takes no other package of Freelens", () => {
    const all = [
      manifest.dependencies,
      manifest.devDependencies,
      manifest.peerDependencies,
      manifest.optionalDependencies,
    ].flatMap((dependencies) => Object.keys(dependencies ?? {}));

    expect(manifest.devDependencies?.["@freelensapp/extensions"]).toBe(SDK);
    expect(all.filter((name) => name.startsWith("@freelensapp/"))).toEqual(["@freelensapp/extensions"]);
  });

  it("has the libraries of the host as devDependencies at the versions of its catalog, and react-window alone in dependencies", () => {
    expect(
      Object.fromEntries(Object.keys(HOST_LIBRARIES).map((name) => [name, manifest.devDependencies?.[name]])),
    ).toEqual(HOST_LIBRARIES);
    // What the bundle carries, and nothing the host gives.
    expect(manifest.dependencies).toEqual({ "react-window": REACT_WINDOW });
    expect(manifest.peerDependencies).toBeUndefined();
    expect(manifest.optionalDependencies).toBeUndefined();
  });

  it("installs with pnpm 12 and strict peer dependencies, so a library of the host outside the range of the SDK fails the install", () => {
    const workspace = readFileSync(resolve("pnpm-workspace.yaml"), "utf8");

    expect(manifest.packageManager).toMatch(/^pnpm@12\.\d+\.\d+\+sha512\.[0-9a-f]{128}$/);
    expect(workspace).toMatch(/^strictPeerDependencies: true$/m);
  });
});

describe("the files of the build", () => {
  it("are the two entries, their maps and the one stylesheet the host links, and nothing else", () => {
    const files = (readdirSync(resolve("dist"), { recursive: true, withFileTypes: true }) as Dirent[])
      .filter((file) => !file.isDirectory())
      .map((file) => file.name)
      .sort();

    expect(files).toEqual(["main.js", "main.js.map", "renderer.css", "renderer.js", "renderer.js.map"]);
  });
});

describe("the bundle of the renderer", () => {
  const content = () => readFileSync(RENDERER, "utf8");

  it("carries its own sources of the renderer and of common, the shim of the SDK and react-window, and nothing else", () => {
    const { own, packages, folders } = sourcesOf(RENDERER);

    expect(packages).toEqual(["@freelensapp/extensions/dist/extension-api.js", "react-window/dist/react-window.js"]);
    expect(folders.map((folder) => folder.split("_")[0])).toEqual([
      `@freelensapp+extensions@${SDK}`,
      `react-window@${REACT_WINDOW}`,
    ]);
    expect(own.length).toBeGreaterThan(40);
    expect(own.filter((source) => !/^src\/(renderer|common)\//.test(source) || /\.test\./.test(source))).toEqual([]);
  });

  it("takes the libraries of the host from FreelensExtensionApi, and asks for no module of Node or Electron", () => {
    const text = content();

    for (const library of ["React", "ReactJsxRuntime", "Mobx", "MobxReact"])
      expect([library, text.includes(`globalThis.FreelensExtensionApi.${library}`)]).toEqual([library, true]);
    expect(text).toContain("globalThis.FreelensExtensionApi;");
    // No import at all, no require, and no name of a module of Node or of Electron.
    expect(text).not.toMatch(/^\s*import[\s{*]|\bimport\(|\brequire\(|["'](?:node:[a-z/_]+|electron)["']/m);
  });

  it("injects no style: its rules are in the one stylesheet the host links, which defines every class it uses", () => {
    const text = content();
    const sheet = readFileSync(resolve("dist/renderer.css"), "utf8");
    const used = [...new Set([...text.matchAll(/"(_[A-Za-z0-9]+_[a-z0-9]{5}_\d+)"/g)].map(([, name]) => name))];

    expect(text).not.toMatch(/jsx\("style"|createElement\("style"|<style|\?inline|insertRule|adoptedStyleSheets/);
    expect(used.length).toBeGreaterThan(100);
    expect(used.filter((name) => !sheet.includes(`.${name}`))).toEqual([]);
  });

  describe("loaded with the API of the host", () => {
    beforeAll(() => {
      // What the host gives an extension on its global before it loads it: its API and its libraries
      // (docs/extensions/migrating-from-v1.md lines 127 to 184 at the validation target).
      vi.stubGlobal("FreelensExtensionApi", {
        Common,
        Main,
        Renderer,
        React,
        ReactDom,
        ReactJsxRuntime,
        Mobx,
        MobxReact,
      });
    });

    beforeEach(() => {
      forbiddenAccesses.length = 0;
      hostCalls.length = 0;
    });

    afterAll(() => {
      vi.unstubAllGlobals();
    });

    it("extends the class of the host, activates and deactivates asking what its sources ask, and draws every page and section inside a boundary", async () => {
      const compiled = (await import(/* @vite-ignore */ pathToFileURL(RENDERER).href)) as {
        default: new () => HostExtensionStub & { customResources: unknown[] };
      };
      const extension = new compiled.default();
      type Drawn = { type: { getDerivedStateFromError?: unknown }; props: Record<string, unknown> };
      const object = { metadata: { name: "one", namespace: "velero" } };

      expect(Object.getPrototypeOf(compiled.default)).toBe(Renderer.LensExtension);
      resetIpc();
      await loaded(extension);
      await extension.disable();
      expect(forbiddenAccesses).toEqual([]);
      expect(hostCalls).toEqual(ACTIVATION_CALLS.renderer);
      // The registrations the host reads, as they were built: every page and every section is drawn inside a
      // boundary of the extension, which keeps an error in its place.
      const pages = (extension.clusterPages as { id: string; components: { Page(props: object): Drawn } }[]).map(
        (page) => page.components.Page({ params: {} }),
      );
      const sections = (
        extension.kubeObjectDetailItems as { kind: string; components: { Details(props: object): Drawn } }[]
      ).map((item) => item.components.Details({ object }));

      expect(pages).toHaveLength(9);
      expect(sections).toHaveLength(8);
      for (const drawn of [...pages, ...sections]) {
        expect(typeof drawn.type.getDerivedStateFromError).toBe("function");
        expect(drawn.props.extension).toBe(extension);
      }
      expect(sections.map((drawn) => drawn.props.resetKey)).toEqual(Array(8).fill(object));
      expect(
        (extension.customResources as { kind: string }[]).map((kind) => [
          kind.kind,
          Object.getPrototypeOf(kind) === Renderer.K8sApi.LensExtensionKubeObject,
        ]),
      ).toEqual(
        [
          "Backup",
          "Restore",
          "Schedule",
          "BackupStorageLocation",
          "VolumeSnapshotLocation",
          "BackupRepository",
          "PodVolumeBackup",
          "PodVolumeRestore",
        ].map((kind) => [kind, true]),
      );
    });
  });
});

describe("the bundle of the main process", () => {
  it("carries its own sources of the main process and of common and the shim of the SDK, and nothing else", () => {
    const { own, packages, folders } = sourcesOf(MAIN);

    expect(packages).toEqual(["@freelensapp/extensions/dist/extension-api.js"]);
    expect(folders.map((folder) => folder.split("_")[0])).toEqual([`@freelensapp+extensions@${SDK}`]);
    expect(own.length).toBeGreaterThan(15);
    expect(own.filter((source) => !/^src\/(main|common)\//.test(source) || /\.test\./.test(source))).toEqual([]);
  });

  it("loads under Node with a stand-in of the host, activates and deactivates, takes nothing of Electron when it loads, and leaves the dispatcher of the host alone", () => {
    const probe = `
      import { registerHooks } from "node:module";
      const asked = [];
      registerHooks({
        resolve(specifier, context, next) {
          if (specifier === "electron" || specifier.startsWith("electron/")) {
            asked.push(specifier);
            throw new Error("The module of Electron was asked for");
          }
          return next(specifier, context);
        },
      });
      const calls = [];
      const stores = new Map();
      class ExtensionStore {
        static getInstanceOrCreate() {
          if (!stores.has(this)) stores.set(this, new this());
          return stores.get(this);
        }
        loadExtension() {
          calls.push("ExtensionStore.loadExtension");
        }
      }
      const instances = new Map();
      class Ipc {
        static createInstance(extension) {
          const instance = new this(extension);
          instances.set(this, instance);
          return instance;
        }
        static getInstance() {
          return instances.get(this);
        }
        static resetInstance() {
          instances.delete(this);
        }
        constructor(extension) {
          this.extension = extension;
          calls.push("Ipc.constructor");
        }
        handle(channel) {
          calls.push("Ipc.handle " + channel);
        }
        broadcast() {}
      }
      class LensExtension {
        manifestPath = "/synthetic/extensions/velero/package.json";
      }
      // What the activation must not ask of the host: a cluster, the catalog, the client of the proxy, kubectl.
      const blocked = (name) =>
        new Proxy({}, {
          get(_target, property) {
            calls.push("asked " + name + "." + String(property));
            throw new Error(name);
          },
        });
      // The dispatcher of the process of the host, which a client of HTTP of the bundle would replace.
      const slots = ["undici.globalDispatcher.1", "undici.globalDispatcher.2"].map((key) => Symbol.for(key));
      const dispatchers = slots.map((slot) => (globalThis[slot] = { of: "the host" }));
      globalThis.FreelensExtensionApi = {
        Common: { Store: { ExtensionStore } },
        Main: {
          LensExtension,
          Ipc,
          Catalog: blocked("Main.Catalog"),
          K8sApi: blocked("Main.K8sApi"),
          K8s: blocked("Main.K8s"),
          Shell: blocked("Main.Shell"),
        },
        Renderer: {},
        Mobx: await import("mobx"),
      };
      const loaded = await import(process.argv[1]);
      const extension = new loaded.default();

      await extension.onActivate();
      await extension.onDeactivate();
      process.stdout.write(
        JSON.stringify({
          asked,
          calls,
          // What the deactivation leaves of the IPC: nothing, so that the next activation makes its own.
          instancesLeft: instances.size,
          extendsTheHost: Object.getPrototypeOf(loaded.default) === LensExtension,
          exported: Object.keys(loaded).sort(),
          dispatchers: slots.map((slot, index) => globalThis[slot] === dispatchers[index]),
        }),
      );
    `;
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", probe, pathToFileURL(MAIN).href], {
      encoding: "utf8",
      timeout: 30_000,
      env: { ...process.env, NODE_OPTIONS: "", NODE_PATH: "" },
    });

    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toEqual({
      asked: [],
      // The store of the preferences, the way between the processes and its procedures, as from its sources.
      calls: [...ACTIVATION_CALLS.main],
      instancesLeft: 0,
      extendsTheHost: true,
      exported: [
        "DiagnosticError",
        "DiagnosticKubernetes",
        "KubectlTunnels",
        "WriteGate",
        "default",
        "downloadArtifact",
        "registerHandlers",
      ],
      dispatchers: [true, true],
    });
  });

  it("takes the module of Electron only when a file is saved, carries no client of Kubernetes, no ws and no reader of a kubeconfig, and runs no process but the kubectl it is given", () => {
    const content = readFileSync(MAIN, "utf8");
    const imports = [...content.matchAll(/^import .* from "([^"]+)";$/gm)];

    expect(content).not.toMatch(/@kubernetes|node_modules\/\.pnpm\/(?:ws|undici)@|KubeConfig|loadYaml|WebSocket/);
    expect(content).not.toContain("undici.globalDispatcher");
    // Every module the bundle imports when it loads is one of Node; Electron, for the dialog of a save, is
    // imported once and only there, when a file is saved.
    expect(imports.filter(([, from]) => !from.startsWith("node:"))).toEqual([]);
    expect([...content.matchAll(/["']electron(?:\/[^"']*)?["']/g)].map(([name]) => name)).toEqual(['"electron"']);
    expect(content).toContain('await import("electron")');
    expect(content).not.toMatch(/__require|createRequire/);
    // A process of the extension is started by `spawn` alone, with the kubectl the host gives; no file is
    // read, and only the one the operator chooses is written.
    expect(imports.map(([line]) => line).filter((line) => line.includes("child_process"))).toEqual([
      'import { spawn } from "node:child_process";',
    ]);
    expect(content).not.toMatch(/\b(?:execFile|execFileSync|execSync|spawnSync|fork)\(/);
    expect(imports.map(([line]) => line).filter((line) => /"(?:node:)?fs(?:\/promises)?"/.test(line))).toEqual([
      'import { writeFile } from "node:fs/promises";',
    ]);
    for (const name of ["@kubernetes/client-node", "ws", "@types/ws"]) {
      expect(manifest.dependencies?.[name]).toBeUndefined();
      expect(manifest.devDependencies?.[name]).toBeUndefined();
    }
  });
});
