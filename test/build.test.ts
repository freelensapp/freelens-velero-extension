import { readdirSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Common, forbiddenAccesses, type HostExtensionStub, Main, Renderer } from "./freelens-extensions";

interface Manifest {
  private: boolean;
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
});

beforeEach(() => {
  forbiddenAccesses.length = 0;
});

afterAll(() => {
  vi.unstubAllGlobals();
});

it("pins the SDK and host to Freelens 1.10.3 with publication disabled", () => {
  expect(manifest.engines.freelens).toBe("1.10.3");
  expect(manifest.devDependencies["@freelensapp/extensions"]).toBe("1.10.3");
  expect(manifest.devDependencies["@types/react"]).toBe("17.0.93");
  expect(manifest.private).toBe(true);
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
    expect(files.some((file) => /\.test\.|kubeconfig|\.pem$|\.key$/.test(file.name))).toBe(false);
  });
});

interface ArchiveTools {
  c(options: { cwd: string; file: string; gzip: boolean }, files: string[]): Promise<void>;
  x(options: { file: string; cwd: string; strip: number }): Promise<void>;
}

type QueryValues = Record<string, string | string[] | null>;

interface QueryTools {
  parse(input: string): QueryValues;
  stringify(input: QueryValues): string;
}

describe("development dependency consumers", () => {
  const launcher = createRequire(load.resolve("@trunkio/launcher/package.json"));
  const sdk = createRequire(load.resolve("@freelensapp/extensions/package.json"));
  const core = createRequire(sdk.resolve("@freelensapp/core/package.json"));
  const tar = launcher("tar") as ArchiveTools;
  const query = core("query-string") as QueryTools;

  it("supports the launcher's asynchronous gzip extraction and strip contract", async () => {
    const directory = await mkdtemp(join(tmpdir(), "velero-tooling-test-"));

    try {
      const source = join(directory, "source");
      const destination = join(directory, "destination");
      const archive = join(directory, "fixture.tar.gz");
      const executable = "synthetic executable fixture\n";

      await mkdir(join(source, "release", "metadata"), { recursive: true });
      await mkdir(destination);
      await writeFile(join(source, "release", "trunk"), executable, { mode: 0o755 });
      await writeFile(join(source, "release", "metadata", "version.txt"), "fixture-version\n");
      await tar.c({ cwd: source, file: archive, gzip: true }, ["release"]);
      await tar.x({ file: archive, cwd: destination, strip: 1 });

      expect(await readFile(join(destination, "trunk"), "utf8")).toBe(executable);
      expect(await readFile(join(destination, "metadata", "version.txt"), "utf8")).toBe("fixture-version\n");
      expect(readdirSync(destination).sort()).toEqual(["metadata", "trunk"]);
      if (process.platform !== "win32") {
        expect((await stat(join(destination, "trunk"))).mode & 0o100).toBe(0o100);
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("rejects an invalid downloaded archive through the launcher extraction API", async () => {
    const directory = await mkdtemp(join(tmpdir(), "velero-tooling-test-"));

    try {
      const archive = join(directory, "invalid.tar.gz");
      const destination = join(directory, "destination");

      await mkdir(destination);
      await writeFile(archive, "not an archive");

      await expect(tar.x({ file: archive, cwd: destination, strip: 1 })).rejects.toThrow();
      expect(readdirSync(destination)).toEqual([]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it.each([
    ["name=sample+backup&namespace=velero-demo", { name: "sample backup", namespace: "velero-demo" }],
    ["path=group%2Fbackup%3Fkey%3Da%26value%3Db", { path: "group/backup?key=a&value=b" }],
    ["text=caf%C3%A9&symbol=%E2%82%AC", { text: "caf\u00e9", symbol: "\u20ac" }],
    ["tag=one&tag=two&empty=&flag", { tag: ["one", "two"], empty: "", flag: null }],
    ["broken=%E0%A4%A&percent=%ZZ&valid=a%20b", { broken: "%E0%A4%A", percent: "%ZZ", valid: "a b" }],
  ] as const)("preserves the SDK query-string decoding contract for %s", (input, expected) => {
    const parsed = query.parse(input);

    expect(parsed).toEqual(expected);
    expect(query.parse(query.stringify(parsed))).toEqual(parsed);
  });

  it("keeps prototype-like query keys isolated from object prototypes", () => {
    const parsed = query.parse("__proto__=synthetic&constructor=fixture");

    expect(Object.getPrototypeOf(parsed)).toBeNull();
    expect(Object.hasOwn(parsed, "__proto__")).toBe(true);
    expect(Object.getOwnPropertyDescriptor(parsed, "__proto__")?.value).toBe("synthetic");
    expect(parsed.constructor).toBe("fixture");
  });
});
