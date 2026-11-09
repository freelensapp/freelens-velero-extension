import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { IMAGES } from "../e2e/scripts/local-manifests.mts";
import { pausePatch, resumePatch } from "../src/common/schedule-patch";
import * as kinds from "../src/renderer/api/kinds";

// The README, which npm and GitHub show as the page of the package. What in it can go stale without anyone seeing it
// is read here against what makes it true: the manifest, the code, the pins of the test environment and the files of
// the repository.

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");
const manifest = JSON.parse(read("package.json")) as { engines: { freelens: string } };

/** The words of a text with every run of white space as one space, as Markdown draws them. */
const squeezed = (text: string) => text.replace(/\s+/g, " ");

/** The lines of a document, each marked when it is in a fenced block of code, where nothing is a heading or a link. */
function linesOf(markdown: string): { text: string; fenced: boolean }[] {
  let fence: string | undefined;

  return markdown.split("\n").map((text) => {
    const marker = /^ {0,3}(`{3,}|~{3,})/.exec(text)?.[1];

    if (marker && (fence === undefined || (marker[0] === fence[0] && marker.length >= fence.length))) {
      fence = fence === undefined ? marker : undefined;

      return { text, fenced: true };
    }

    return { text, fenced: fence !== undefined };
  });
}

interface Heading {
  level: number;
  text: string;
  line: number;
}

function headingsOf(markdown: string): Heading[] {
  return linesOf(markdown).flatMap(({ text, fenced }, line) => {
    const match = fenced ? null : /^ {0,3}(#{1,6})[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/.exec(text);

    return match ? [{ level: match[1].length, text: match[2], line }] : [];
  });
}

/** The lines under a heading, up to the next heading of its level or of a level above it. */
function sectionOf(markdown: string, title: string, level: number): string {
  const headings = headingsOf(markdown);
  const start = headings.find((heading) => heading.level === level && heading.text === title);

  expect([title, start === undefined]).toEqual([title, false]);
  const end = headings.find((heading) => heading.line > (start?.line ?? 0) && heading.level <= level);

  return markdown
    .split("\n")
    .slice((start?.line ?? 0) + 1, end?.line)
    .join("\n");
}

/** The rows of the tables of a text, each as its cells, trimmed, without the row of the dashes. */
const rowsOf = (text: string) =>
  text
    .split("\n")
    .filter((line) => /^\s*\|.*\|\s*$/.test(line) && !/^\s*\|[\s|:-]+\|\s*$/.test(line))
    .map((line) =>
      line
        .trim()
        .slice(1, -1)
        .split("|")
        .map((cell) => cell.trim()),
    );

/** The anchor GitHub gives a heading: its words in lower case, without punctuation, each space a hyphen. */
function slugOf(text: string): string {
  return text
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[`*]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 _-]/g, "")
    .replace(/ /g, "-");
}

/** The anchors of the headings of a document, a heading of the same words as one before it with its count. */
function anchorsOf(markdown: string): Set<string> {
  const seen = new Map<string, number>();

  return new Set(
    headingsOf(markdown).map(({ text }) => {
      const slug = slugOf(text);
      const count = seen.get(slug) ?? 0;

      seen.set(slug, count + 1);

      return count === 0 ? slug : `${slug}-${count}`;
    }),
  );
}

/** The prose of a document, line by line: out of its fenced blocks, without its code spans. */
const proseOf = (markdown: string) =>
  linesOf(markdown).map(({ text, fenced }) => (fenced ? "" : text.replace(/`[^`]*`/g, "")));

/** The targets of the links, the images and the definitions of links of a document, out of its code. */
function targetsOf(markdown: string): { target: string; line: number }[] {
  return proseOf(markdown).flatMap((prose, index) =>
    [
      ...prose.matchAll(/\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g),
      ...prose.matchAll(/^ {0,3}\[[^\]]+\]:\s*<?([^\s>]+)>?/g),
      ...prose.matchAll(/<(?:a|img)\b[^>]*?\b(?:href|src)="([^"]+)"/gi),
    ].map((match) => ({ target: match[1], line: index + 1 })),
  );
}

/** The files Git holds for the repository, and every directory of them. */
function repositoryFiles(): { files: Set<string>; directories: Set<string> } {
  const listed = spawnSync("git", ["ls-files", "-z"], { cwd: ROOT, encoding: "utf8" });

  expect([listed.status, listed.stderr]).toEqual([0, ""]);
  const files = new Set(listed.stdout.split("\0").filter(Boolean));
  const directories = new Set(
    [...files].flatMap((file) =>
      file
        .split("/")
        .slice(0, -1)
        .map((_, index, parts) => parts.slice(0, index + 1).join("/")),
    ),
  );

  return { files, directories };
}

/** Why a target of a document leads nowhere, or undefined: a link out of the repository is read by a person. */
function unresolved(
  document: string,
  target: string,
  repository: { files: Set<string>; directories: Set<string> },
): string | undefined {
  if (/^[a-z][a-z0-9+.-]*:/i.test(target)) {
    return undefined;
  }
  // The query of a link, as `?plain=1`, changes how GitHub shows the file, not which file it is.
  const [path, anchor] = target.replace(/\?[^#]*/, "").split("#");
  const file = path === "" ? document : normalize(join(dirname(document), decodeURIComponent(path))).replace(/\/$/, "");

  if (file.startsWith("..") || !(repository.files.has(file) || repository.directories.has(file))) {
    return `${target}: ${file} is not a file of the repository`;
  }
  if (anchor !== undefined && file.endsWith(".md") && !anchorsOf(read(file)).has(anchor)) {
    return `${target}: no heading of ${file} has the anchor ${anchor}`;
  }

  return undefined;
}

/** The classes of the kinds the extension reads, which the host reads: each with its kind, its versions and its page. */
const KINDS_READ = (Object.values(kinds) as unknown[]).filter(
  (value): value is { kind: string; crd: { apiVersions: string[]; title: string } } =>
    typeof value === "function" && "crd" in value,
);

describe("the documents of the package", () => {
  const readme = read("README.md");

  it("says in Requirements the range of Freelens of the manifest and the versions of the API the code reads, lists in Supported APIs each kind the code reads under its version, and names neither a release that is not there nor the tag next", () => {
    const requirements = sectionOf(readme, "Requirements", 2);
    const supported = sectionOf(readme, "Supported APIs", 2);
    const rows = KINDS_READ.flatMap((kind) =>
      kind.crd.apiVersions.map((version) => ({ version, row: `${kind.kind} ${kind.crd.title}` })),
    );
    const versions = [...new Set(rows.map(({ version }) => version))].sort();

    expect(versions.length).toBeGreaterThan(0);
    expect(squeezed(requirements)).toContain(`\`engines.freelens\` as \`${manifest.engines.freelens}\``);
    expect([...new Set([...requirements.matchAll(/`(velero\.io\/[^`]+)`/g)].map((match) => match[1]))].sort()).toEqual(
      versions,
    );
    expect(
      headingsOf(supported)
        .filter(({ level }) => level === 3)
        .map(({ text }) => text)
        .sort(),
    ).toEqual(versions);
    for (const version of versions) {
      const listed = rowsOf(sectionOf(supported, version, 3))
        .filter(([kind]) => /^`\w+`$/.test(kind ?? ""))
        .map(([kind, page]) => `${kind.slice(1, -1)} ${page}`);

      expect([version, listed.sort()]).toEqual([
        version,
        rows
          .filter((kind) => kind.version === version)
          .map(({ row }) => row)
          .sort(),
      ]);
    }
    // The section Status of the README before this one said that there was no release to install.
    expect(sectionOf(readme, "Status", 3)).not.toMatch(/\bno release\b/i);
    expect(squeezed(readme)).not.toMatch(/no release to install/i);
    // No npm tag but the one of a release: 1.0.0 is the first publication, and Freelens installs the newest release by
    // its name.
    expect(readme).not.toMatch(/`next`|@next\b|version=next/);
  });

  it("says in Compatibility the target of SPEC-0015 and the versions the test environment pins, and that any other is untested", () => {
    const compatibility = sectionOf(sectionOf(readme, "Requirements", 2), "Compatibility", 3);
    const table = new Map(rowsOf(compatibility).map(([component, versions]) => [component, versions]));
    const header = read("docs/specs/SPEC-0015-freelens-v2-host.md");
    const [, commit = "", freelens = ""] =
      /^- \*\*Freelens validation target:\*\* freelensapp\/freelens `([0-9a-f]{40})`, the commit of the tag v(\d+\.\d+\.\d+) /m.exec(
        header,
      ) ?? [];
    // The version of an image as its tag names it, `v1.18.4`, and the line of it, `1.18.x`.
    const pinned = (image: string) => /:(v(\d+\.\d+)\.\d+)@/.exec(image)?.slice(1) ?? [];
    const [velero = "", veleroLine] = pinned(IMAGES.velero);
    const [plugin = "", pluginLine] = pinned(IMAGES.plugin);
    const [node = ""] = pinned(IMAGES.node);

    expect([commit, freelens, velero, plugin, node].every((value) => value !== "")).toBe(true);
    expect(table.get("Freelens")).toContain(`${freelens.replace(/\.\d+$/, "")}.x, tested at ${freelens}`);
    expect(table.get("Freelens")).toContain(`\`${commit}\``);
    expect(table.get("Velero")).toContain(`${veleroLine}.x with its AWS plugin ${pluginLine}.x`);
    expect(table.get("Velero")).toContain(`tested at Velero ${velero} and the AWS plugin ${plugin}`);
    expect(table.get("Kubernetes")).toContain(`Tested at ${node.slice(1)},`);
    expect(squeezed(compatibility)).toMatch(/A version outside this table, .+?, is untested/);
  });

  it("says in Write actions, under Features, each kind and verb the adapter of the main process allows, no other kind of Velero written, and the three rules it keeps", () => {
    // The subsection of Features that says what the extension writes, as the other extensions of the organization have
    // it: the README has no section Safety.
    const writeActions = sectionOf(sectionOf(readme, "Features", 2), "Write actions", 3);
    const adapter = read("src/main/diagnostic-kubernetes.ts");
    // Each request of the adapter that writes, a POST or a PATCH, with the kind of its path: a kind its method takes as
    // a parameter is the literal type of that parameter.
    const writes = [...adapter.matchAll(/this\.send\("(POST|PATCH)", this\.path\((?:"(\w+)"|kind\b)/g)].map((match) => {
      const kind = match[2] ?? [...adapter.slice(0, match.index).matchAll(/\bkind: "(\w+)"/g)].at(-1)?.[1];

      return `${match[1] === "POST" ? "Create" : "Patch"} ${kind}`;
    });
    // What the patch of a schedule writes: the fields of its operations that are not tests, for a pause and a resume.
    const fields = [...pausePatch("uid"), ...resumePatch("uid", { expression: "@daily", skipImmediately: false })]
      .filter(({ op }) => op !== "test")
      .map(({ path }) => path.slice(1).replace("/", "."));
    const table = rowsOf(writeActions).filter(([write]) => /^(Create|Patch)\b/.test(write ?? ""));
    const said = table.map(([write, kind]) => `${write.split(" ")[0]} ${kind.replace(/`/g, "")}`);
    const patched = table
      .filter(([write]) => write.startsWith("Patch"))
      .flatMap(([write]) => [...write.matchAll(/`([^`]+)`/g)].map((match) => match[1]));
    const written = new Set(writes.map((write) => write.split(" ")[1]));
    const velero = new Set([...KINDS_READ.map(({ kind }) => kind), ...written]);
    const named = [...writeActions.matchAll(/`(\w+)`/g)].map((match) => match[1]).filter((name) => velero.has(name));

    expect(writes.length).toBeGreaterThan(0);
    expect([...new Set(said)].sort()).toEqual([...new Set(writes)].sort());
    expect([...new Set(patched)].sort()).toEqual([...new Set(fields)].sort());
    expect(named.filter((name) => !written.has(name))).toEqual([]);
    for (const rule of [
      "Signed URLs stay in the main process and are never logged, stored or shown.",
      "TLS is verified by default",
      "Missing or unreadable data is shown as unknown, never as healthy.",
    ]) {
      expect([rule, squeezed(writeActions).includes(rule)]).toEqual([rule, true]);
    }
  });

  it("resolves every relative link, image and anchor of the README, and holds it to ASCII with no em dash and no emoji", () => {
    const repository = repositoryFiles();
    const broken = targetsOf(readme).flatMap(({ target, line }) => {
      const why = unresolved("README.md", target, repository);

      return why === undefined ? [] : [`${line}: ${why}`];
    });
    const outside = readme
      .split("\n")
      .flatMap((line, index) =>
        [...line].some((character) => (character.codePointAt(0) ?? 0) > 0x7f) ? [`${index + 1}: ${line}`] : [],
      );
    // GitHub draws a shortcode of its prose, as `:rocket:`, as an emoji.
    const shortcodes = proseOf(readme).flatMap((prose, index) =>
      [...prose.replace(/\]\([^)]*\)/g, "](").matchAll(/:[a-z0-9_+-]+:/g)].map((match) => `${index + 1}: ${match[0]}`),
    );

    expect(broken).toEqual([]);
    expect(outside).toEqual([]);
    expect(shortcodes).toEqual([]);
    // The em dash, written by its code point: the formatter writes the escape as the character.
    expect(readme.includes(String.fromCodePoint(0x2014))).toBe(false);
  });
});
