import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Common, forbiddenAccesses, type HostExtensionStub, hostCalls, Main, Renderer } from "./freelens-extensions";

interface Manifest {
  private?: boolean;
  version: string;
  main: string;
  renderer: string;
  files: string[];
  engines: { freelens: string };
  devDependencies: Record<string, string>;
  dependencies?: Record<string, string>;
}

const manifest: Manifest = JSON.parse(readFileSync(resolve("package.json"), "utf8"));
const load = createRequire(import.meta.url);

beforeAll(() => {
  vi.stubGlobal("LensExtensions", { Common, Main, Renderer });
  // What the host provides beside its SDK. The bundles ask for them by these names and carry none of them.
  vi.stubGlobal("React", load("react"));
  vi.stubGlobal("ReactDom", load("react-dom"));
  vi.stubGlobal("ReactJsxRuntime", load("react/jsx-runtime"));
  vi.stubGlobal("Mobx", load("mobx"));
  vi.stubGlobal("MobxReact", load("mobx-react"));
});

beforeEach(() => {
  forbiddenAccesses.length = 0;
  hostCalls.length = 0;
});

afterAll(() => {
  vi.unstubAllGlobals();
});

it("builds against the SDK of Freelens 1.10.3 and installs on the hosts compatible with it", () => {
  expect(manifest.engines.freelens).toBe("^1.10.3");
  expect(manifest.devDependencies["@freelensapp/extensions"]).toBe("1.10.3");
  expect(manifest.devDependencies["@types/react"]).toBe("17.0.93");
  expect(manifest.private).toBeUndefined();
  expect(Object.keys(manifest.dependencies ?? {})).toEqual([]);
});

it("limits package contents to the compiled process entry points", () => {
  expect(manifest.files).toEqual(["out/main/**", "out/renderer/**"]);
  expect(manifest.main).toBe("out/main/index.js");
  expect(manifest.renderer).toBe("out/renderer/index.js");
});

describe.each([
  ["main", manifest.main, Main.LensExtension],
  ["renderer", manifest.renderer, Renderer.LensExtension],
] as const)("%s bundle", (_name, entry, HostExtension) => {
  it("loads as CommonJS using only the host's extension runtime", () => {
    const compiled = load(resolve(entry)) as { default: new () => HostExtensionStub };
    const extension = new compiled.default();

    expect(Object.getPrototypeOf(compiled.default)).toBe(HostExtension);
    extension.activate();
    extension.disable();
    expect(forbiddenAccesses).toEqual([]);
    expect(hostCalls).toEqual(["ExtensionStore.loadExtension"]);
  });

  it("contains no host SDK implementation or test fixtures", () => {
    const directory = resolve(entry, "..");
    const files = readdirSync(directory, { recursive: true, withFileTypes: true }).filter((file) => file.isFile());
    const javascript = files.filter((file) => file.name.endsWith(".js"));
    const content = javascript.map((file) => readFileSync(resolve(file.parentPath, file.name), "utf8")).join("\n");

    expect(javascript.length).toBeGreaterThan(0);
    expect(content).toContain("global.LensExtensions");
    expect(content).not.toContain('require("@freelensapp/extensions")');
    expect(content).not.toMatch(/@freelensapp\/(?:core|extensions)|freelens-extensions\.ts|forbiddenAccesses|vitest/);
    // The libraries of the host are asked of the host: none of them is in the bundle.
    expect(content).not.toMatch(/react\.production\.min|react-dom\.production|__REACT_DEVTOOLS|mobx\.cjs/);
    expect(files.some((file) => /\.test\.|kubeconfig|\.pem$|\.key$/.test(file.name))).toBe(false);
  });
});

it("main bundle leaves the dispatcher of the host process alone", () => {
  const probe = `
    globalThis.LensExtensions = {
      Common: { Store: { ExtensionStore: class {} } },
      Main: { LensExtension: class {} },
    };
    globalThis.Mobx = require("mobx");
    const slots = ["undici.globalDispatcher.1", "undici.globalDispatcher.2"].map((key) => Symbol.for(key));
    const before = slots.map((slot) => globalThis[slot]);
    require(process.argv[1]);
    process.stdout.write(JSON.stringify(slots.map((slot, index) => globalThis[slot] === before[index])));
  `;
  const result = spawnSync(process.execPath, ["-e", probe, resolve(manifest.main)], {
    encoding: "utf8",
    timeout: 30_000,
  });
  const directory = resolve(manifest.main, "..");
  const content = readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter((file) => file.isFile() && file.name.endsWith(".js"))
    .map((file) => readFileSync(resolve(file.parentPath, file.name), "utf8"))
    .join("\n");

  expect(result.stderr).toBe("");
  expect(JSON.parse(result.stdout)).toEqual([true, true]);
  expect(content).not.toContain("undici.globalDispatcher");
});
