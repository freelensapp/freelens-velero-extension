import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Which parts of the views a run of .github/workflows/views-tests.yaml runs. On main, every night and on demand,
// every part. On a pull request, the parts its changed files reach, by the rules of e2e/views-parts.json, in order:
// a file of `everyPart` (the runner, the environment, the toolchain, the main process, this list) runs every part;
// a file of `noPart` (documents, unit tests, other workflows, configuration of the linters) runs none; any other file
// runs the parts whose `paths` it matches, and every part when it matches none, so that a file no rule knows is never
// left without the suites that could see it.

export interface ViewsPart {
  name: string;
  environment: "demo" | "definitions";
  suites: string[];
  paths: string[];
}

export interface ViewsParts {
  parts: ViewsPart[];
  everyPart: string[];
  noPart: string[];
}

export const VIEWS_PARTS_FILE = new URL("../views-parts.json", import.meta.url);

export function readViewsParts(file: URL = VIEWS_PARTS_FILE): ViewsParts {
  return JSON.parse(readFileSync(file, "utf8")) as ViewsParts;
}

const matches = (patterns: string[], file: string) => patterns.some((pattern) => new RegExp(pattern).test(file));

// The names of the parts to run, in the order of the list: every part when `changed` is undefined (a run that is not
// of a pull request), otherwise the parts the changed files reach.
export function partsToRun(definition: ViewsParts, changed: string[] | undefined): string[] {
  const all = definition.parts.map((part) => part.name);

  if (changed === undefined) return all;
  const chosen = new Set<string>();

  for (const file of changed) {
    if (matches(definition.everyPart, file)) return all;
    if (matches(definition.noPart, file)) continue;
    const reached = definition.parts.filter((part) => matches(part.paths, file)).map((part) => part.name);

    if (reached.length === 0) return all;
    for (const name of reached) chosen.add(name);
  }
  return all.filter((name) => chosen.has(name));
}

// The parts as the matrix of the job takes them, without the paths, which only this script reads.
export function matrixOf(definition: ViewsParts, names: string[]) {
  return definition.parts
    .filter((part) => names.includes(part.name))
    .map(({ name, environment, suites }) => ({ name, environment, suites }));
}

// In the job: the event comes from GITHUB_EVENT_NAME and, for a pull request, the changed files from git, between the
// base the workflow fetched and the head; the matrix goes to GITHUB_OUTPUT as `parts`, with a line for the log.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const definition = readViewsParts();
  const event = process.env.GITHUB_EVENT_NAME ?? "";
  const base = process.env.BASE_SHA ?? "";
  const changed =
    event === "pull_request"
      ? execFileSync("git", ["diff", "--name-only", `${base}...HEAD`], { encoding: "utf8" })
          .split("\n")
          .filter(Boolean)
      : undefined;
  const names = partsToRun(definition, changed);
  const output = process.env.GITHUB_OUTPUT;

  console.log(
    changed === undefined
      ? `Every part, for a run of ${event || "no event"}: ${names.join(", ")}`
      : `${changed.length} changed files reach: ${names.length > 0 ? names.join(", ") : "no part"}`,
  );
  if (output) appendFileSync(output, `parts=${JSON.stringify(matrixOf(definition, names))}\n`);
}
