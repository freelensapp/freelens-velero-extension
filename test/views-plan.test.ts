import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { WITHOUT_A_CONTROLLER } from "../e2e/scripts/local-fixtures.mts";
import { matrixOf, partsToRun, readViewsParts } from "../e2e/scripts/views-plan.mts";

const definition = readViewsParts();
const every = ["artifacts", "pre-review", "volumes-and-server", "static-views-1", "static-views-2"];
const statics = ["static-views-1", "static-views-2"];

describe("the parts of the views a run takes", () => {
  it("runs every part on main, every night and on demand", () => {
    expect(partsToRun(definition, undefined)).toEqual(every);
  });

  it("runs every part for a change to the runner, the environment, the main process or the toolchain", () => {
    for (const file of [
      "e2e/scripts/local-demo.mts",
      "e2e/views-parts.json",
      "src/main/diagnostic-transport.ts",
      ".github/workflows/views-tests.yaml",
      "package.json",
      "pnpm-lock.yaml",
      "vite.config.mjs",
      "build/vite-plugin-host-modules.mjs",
      "mise.toml",
      "test/tls-fixture.ts",
      "src/renderer/tsconfig.json",
      "integration/tsconfig.json",
    ]) {
      expect([file, partsToRun(definition, [file])]).toEqual([file, every]);
    }
  });

  it("runs no part for documents, unit tests, other workflows and the configuration of the linters", () => {
    for (const file of [
      "README.md",
      "docs/development/TESTING.md",
      "src/common/schedule-adherence.test.ts",
      "src/renderer/components/workspace.test.tsx",
      "test/environment.test.ts",
      ".github/workflows/unit-tests.yaml",
      ".trunk/trunk.yaml",
      ".renovaterc.json5",
      "integration/__tests__/backups.tests.ts",
    ]) {
      expect([file, partsToRun(definition, [file])]).toEqual([file, []]);
    }
    expect(partsToRun(definition, [])).toEqual([]);
  });

  it("runs the parts a view of the renderer or a module of common reaches, and the static views with them", () => {
    expect(partsToRun(definition, ["src/renderer/pages/schedules-page.tsx"])).toEqual(statics);
    expect(partsToRun(definition, ["src/common/schedule-adherence.ts"])).toEqual(statics);
    expect(partsToRun(definition, ["src/renderer/components/log-viewer.tsx"])).toEqual(["artifacts", ...statics]);
    expect(partsToRun(definition, ["src/common/artifact-log.ts"])).toEqual(["artifacts", ...statics]);
    expect(partsToRun(definition, ["src/renderer/pages/server-band.tsx"])).toEqual(["volumes-and-server", ...statics]);
    expect(partsToRun(definition, ["src/renderer/pages/overview-page.tsx"])).toEqual(statics);
    // The band of the volumes, its index and the references of an operation make the ways of the Volumes tab too.
    for (const file of ["src/common/volume-band.ts", "src/common/volume-index.ts", "src/common/volume-references.ts"]) {
      expect([file, partsToRun(definition, [file])]).toEqual([file, ["artifacts", "volumes-and-server", ...statics]]);
    }
    expect(partsToRun(definition, ["src/common/volume-words.ts"])).toEqual(["volumes-and-server", ...statics]);
    // The sections of the host of the three kinds of the volumes, whose cases are in the suites with the server.
    for (const file of [
      "src/renderer/details/repository-details.tsx",
      "src/renderer/details/volume-operation-details.tsx",
    ]) {
      expect([file, partsToRun(definition, [file])]).toEqual([file, ["volumes-and-server", ...statics]]);
    }
    // The pages of the data movement, whose lists are the ones of the volume operations.
    for (const file of ["src/renderer/pages/data-uploads-page.tsx", "src/renderer/pages/data-downloads-page.tsx"]) {
      expect([file, partsToRun(definition, [file])]).toEqual([file, ["volumes-and-server", ...statics]]);
    }
    expect(partsToRun(definition, ["src/renderer/components/views.module.css"])).toEqual(["pre-review", ...statics]);
  });

  it("runs the parts with a server for the state, the reads, the way between the processes and the frame they rest on", () => {
    // What only those suites see: the loads of the tabs, the answers of the server, the tab in the address, the reads
    // a view asks for on demand, the confirmation of a write.
    for (const file of ["src/renderer/state/installation.ts", "src/renderer/api/ipc.ts", "src/common/ipc.ts"]) {
      expect([file, partsToRun(definition, [file])]).toEqual([file, ["artifacts", "volumes-and-server", ...statics]]);
    }
    expect(partsToRun(definition, ["src/renderer/navigation.ts"])).toEqual(["artifacts", ...statics]);
    expect(partsToRun(definition, ["src/renderer/details/backup-details.tsx"])).toEqual(["artifacts", ...statics]);
    expect(partsToRun(definition, ["src/common/discovery.ts"])).toEqual(["volumes-and-server", ...statics]);
    expect(partsToRun(definition, ["src/renderer/components/views-frame.tsx"])).toEqual([
      "pre-review",
      "volumes-and-server",
      ...statics,
    ]);
    expect(partsToRun(definition, ["src/renderer/components/target-bar.tsx"])).toEqual(every);
    expect(partsToRun(definition, ["src/renderer/components/workspace.tsx"])).toEqual(["pre-review", ...statics]);
  });

  it("runs the part of a suite that changed, and every part for a file no rule knows", () => {
    expect(partsToRun(definition, ["e2e/__tests__/velero-e2e-artifacts.tests.ts"])).toEqual(["artifacts", ...statics]);
    expect(partsToRun(definition, ["e2e/__tests__/pre-review.tests.ts"])).toEqual(["pre-review", ...statics]);
    expect(partsToRun(definition, ["e2e/__tests__/velero-e2e-journey.tests.ts"])).toEqual(statics);
    expect(partsToRun(definition, ["integration/__tests__/extensions.tests.ts"])).toEqual(statics);
    expect(partsToRun(definition, ["assets/new-icon.svg"])).toEqual(every);
    expect(partsToRun(definition, ["README.md", "assets/new-icon.svg"])).toEqual(every);
  });

  it("gives the matrix of the job the name, the environment and the suites of each part, in their order", () => {
    expect(matrixOf(definition, ["static-views-2", "artifacts"])).toEqual([
      { name: "artifacts", environment: "demo", suites: ["velero-e2e-artifacts"] },
      { name: "static-views-2", environment: "definitions", suites: definition.parts[4].suites },
    ]);
    expect(matrixOf(definition, [])).toEqual([]);
  });

  it("names every suite of the views, the pre-review and FND-10 in one part, and only suites without a controller in a part on the CRDs alone", () => {
    const files = ["e2e/__tests__", "integration/__tests__"].flatMap((directory) =>
      readdirSync(new URL(`../${directory}`, import.meta.url), { encoding: "utf8", recursive: true })
        .filter((name) => name.endsWith(".tests.ts"))
        .map((name) => `${directory}/${name}`),
    );
    const partsOf = (file: string) =>
      definition.parts.filter((part) => part.suites.some((suite) => file.includes(suite))).map((part) => part.name);

    expect(definition.parts.map((part) => [part.name, part.environment])).toEqual([
      ["artifacts", "demo"],
      ["pre-review", "demo"],
      ["volumes-and-server", "demo"],
      ["static-views-1", "definitions"],
      ["static-views-2", "definitions"],
    ]);
    expect(
      definition.parts
        .filter((part) => part.environment === "definitions")
        .flatMap((part) => part.suites.filter((suite) => !WITHOUT_A_CONTROLLER.includes(suite))),
    ).toEqual([]);
    expect(definition.parts.filter((part) => part.suites.length === 0 || part.suites.join("+").length > 255)).toEqual(
      [],
    );
    expect(files.length).toBeGreaterThan(16);
    expect(Object.fromEntries(files.map((file) => [file, partsOf(file)]))).toEqual(
      Object.fromEntries(
        files.map((file) => [
          file,
          file.startsWith("e2e/") || file === "integration/__tests__/extensions.tests.ts" ? [expect.any(String)] : [],
        ]),
      ),
    );
    expect(
      definition.parts.flatMap((part) => part.suites).filter((suite) => !files.some((file) => file.includes(suite))),
    ).toEqual([]);
    // Every rule is a valid expression.
    for (const pattern of [
      ...definition.everyPart,
      ...definition.noPart,
      ...definition.parts.flatMap((p) => p.paths),
    ]) {
      expect(() => new RegExp(pattern)).not.toThrow();
    }
  });

  it("takes the parts from the job that decides them, and passes the check when no part was needed", () => {
    const workflow = readFileSync(new URL("../.github/workflows/views-tests.yaml", import.meta.url), "utf8");

    expect(workflow).toMatch(/\n {4}needs: plan\n {4}if: \$\{\{ needs\.plan\.outputs\.parts != '\[\]' \}\}\n/);
    expect(workflow).toMatch(/\n {8}part: \$\{\{ fromJSON\(needs\.plan\.outputs\.parts\) \}\}\n/);
    expect(workflow).toMatch(/\n {8}run: node e2e\/scripts\/views-plan\.mts\n/);
    expect(workflow).toMatch(/\n {4}- cron: [0-9 *]+\n/);
    expect(workflow).toMatch(/\n {4}needs: \[plan, test-views\]\n {4}if: \$\{\{ always\(\) \}\}\n/);
    expect(workflow).toMatch(
      /\n {10}PLAN: \$\{\{ needs\.plan\.result \}\}\n {10}PARTS: \$\{\{ needs\.plan\.outputs\.parts \}\}\n {10}RESULT: \$\{\{ needs\.test-views\.result \}\}\n/,
    );
  });
});

describe("the end to end tests a pull request runs", () => {
  it("runs them for every change but the renderer, the suites of the views, the documents, the unit tests and the linters, and every night", () => {
    const workflow = readFileSync(new URL("../.github/workflows/e2e-tests.yaml", import.meta.url), "utf8");
    const block = workflow.slice(workflow.indexOf("\n    paths:\n"), workflow.indexOf("\n  schedule:\n"));
    const paths = [...block.matchAll(/^ {6}- "?([^"\n]+)"?$/gm)].map((match) => match[1]);

    expect(paths[0]).toBe("**");
    for (const excluded of [
      "!src/renderer/**",
      "!e2e/__tests__/**",
      "!docs/**",
      "!**/*.md",
      "!**/*.test.ts",
      "!.github/**",
    ]) {
      expect(paths).toContain(excluded);
    }
    // Later patterns win: the workflow itself is named again after the workflows are left out.
    expect(paths.indexOf(".github/workflows/e2e-tests.yaml")).toBeGreaterThan(paths.indexOf("!.github/**"));
    expect(paths.filter((path) => path.startsWith("!src/") && path !== "!src/renderer/**")).toEqual([]);
    expect(workflow).toMatch(/\n {2}schedule:\n {4}- cron: [0-9 *]+\n/);
  });
});
