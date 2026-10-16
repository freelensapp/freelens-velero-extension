// The bundle of the main process as the host loads it: an ES module imported by the URL of its file, with
// the API of the host on `globalThis.FreelensExtensionApi`. It is loaded in a process of its own, where
// nothing of the tests is, by a probe that answers for the host with stand-ins and refuses the module of
// Electron, which the main process takes when a file is saved and never when it is loaded. The bundle is
// the one `pnpm build` writes, which the unit run builds first.

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, it } from "vitest";
import { CHANNELS } from "../src/common/ipc";

const MAIN = resolve("dist/main.js");

it("loads under Node with a stand-in of the host, activates and deactivates, and takes nothing of Electron when it loads", () => {
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
    // The store of the preferences, the way between the processes and its procedures: nothing else.
    calls: [
      "ExtensionStore.loadExtension",
      "Ipc.constructor",
      ...[
        CHANNELS.gateState,
        CHANNELS.gateEnable,
        CHANNELS.gateDisable,
        CHANNELS.writeConfirm,
        CHANNELS.writeStatus,
        CHANNELS.writeCancel,
        CHANNELS.writeRun,
        CHANNELS.artifactPage,
        CHANNELS.artifactRelease,
        CHANNELS.artifactSave,
        CHANNELS.allowanceGrant,
        CHANNELS.allowanceRevoke,
      ].map((channel) => `Ipc.handle ${channel}`),
    ],
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
  });
});

it("carries no client of Kubernetes, no ws and no reader of a kubeconfig, and runs no process but the kubectl it is given", () => {
  const content = readFileSync(MAIN, "utf8");
  const imports = [...content.matchAll(/^import .* from "([^"]+)";$/gm)].map((line) => line[0]);
  const manifest = JSON.parse(readFileSync(resolve("package.json"), "utf8")) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };

  expect(content).not.toMatch(/@kubernetes|node_modules\/\.pnpm\/(?:ws|undici)@|KubeConfig|loadYaml|WebSocket/);
  // A process of the extension is started by `spawn` alone, with the kubectl the host gives; no file is
  // read, and only the one the operator chooses is written.
  expect(imports.filter((line) => line.includes("child_process"))).toEqual([
    'import { spawn } from "node:child_process";',
  ]);
  expect(content).not.toMatch(/\b(?:execFile|execFileSync|execSync|spawnSync|fork)\(/);
  expect(imports.filter((line) => /"(?:node:)?fs(?:\/promises)?"/.test(line))).toEqual([
    'import { writeFile } from "node:fs/promises";',
  ]);
  // Nothing is asked of a module by `require`: the module of Electron is imported when a file is saved.
  expect(content).not.toMatch(/__require|createRequire/);
  expect(content).toContain('await import("electron")');
  for (const name of ["@kubernetes/client-node", "ws", "@types/ws"]) {
    expect(manifest.dependencies?.[name]).toBeUndefined();
    expect(manifest.devDependencies?.[name]).toBeUndefined();
  }
});
