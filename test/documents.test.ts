import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { IMAGES } from "../e2e/scripts/local-manifests.mts";
import { pausePatch, resumePatch } from "../src/common/schedule-patch";
import * as kinds from "../src/renderer/api/kinds";

// The documents npm and GitHub show: the README, which is the page of the package, and the changelog, whose section of a
// version is the body of its GitHub release. What in them can go stale without anyone seeing it is read here against
// what makes it true: the manifest, the code, the workflows, the pins of the test environment and the files of the
// repository.

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");
const manifest = JSON.parse(read("package.json")) as {
  name: string;
  version: string;
  engines: { freelens: string };
  dependencies: Record<string, string>;
};
// The name `pnpm pack` gives the tarball of the package, before its version.
const PREFIX = `${manifest.name.replace(/^@/, "").replace("/", "-")}-`;

/** A workflow without its comments: what it does, without what it says of itself. */
const workflow = (name: string) =>
  read(`.github/workflows/${name}`)
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("#"))
    .join("\n");

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

/** The lines of the fenced blocks of a document, without the fences, each trimmed. */
const commandsOf = (markdown: string) =>
  linesOf(markdown)
    .filter(({ text, fenced }) => fenced && !/^ {0,3}(`{3,}|~{3,})/.test(text))
    .map(({ text }) => text.trim())
    .filter(Boolean);

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

/** The notes of a version as the release workflow takes them: the lines after its heading, up to the next one. */
function notesOf(changelog: string, version: string): string {
  const lines = changelog.split("\n");
  const start = lines.findIndex((line) => line.startsWith(`## v${version} - `));
  const end = lines.findIndex((line, index) => index > start && line.startsWith("## "));

  return start < 0
    ? ""
    : lines
        .slice(start + 1, end < 0 ? undefined : end)
        .join("\n")
        .trim();
}

/** Whether notes say something: a line that is neither blank nor a heading. */
const sayNothing = (notes: string) => !notes.split("\n").some((line) => line.trim() !== "" && !/^#{1,6}\s/.test(line));

/** The parts of a version of the form the tag workflow tags, a release after each of its prereleases. */
function partsOf(version: string): number[] {
  const [, major, minor, patch, prerelease] = /^(\d+)\.(\d+)\.(\d+)(?:-(\d+))?$/.exec(version) ?? [];

  return [major, minor, patch, prerelease ?? `${Number.MAX_SAFE_INTEGER}`].map(Number);
}

function newestFirst(one: string, other: string): number {
  const [a, b] = [partsOf(one), partsOf(other)];
  const at = a.findIndex((part, index) => part !== b[index]);

  return at < 0 ? 0 : b[at] - a[at];
}

/** The release file names a text gives in its code spans, with a version in place of `<version>`. */
function releaseFilesOf(markdown: string): string[] {
  return linesOf(markdown)
    .filter(({ fenced }) => !fenced)
    .flatMap(({ text }) => [...text.matchAll(/`([^`\s]+)`/g)].map((match) => match[1]))
    .filter((name) => name.startsWith(`${PREFIX}<version>`))
    .map((name) => name.replace("<version>", "1.0.0-0"));
}

/** The patterns of the files the step of the release attaches, as its block `files` lists them. */
function attachedPatterns(release: string): string[] {
  const lines = release.split("\n");
  const indent = (line: string) => line.length - line.trimStart().length;
  const step = lines.findIndex((line) => /^\s+uses: softprops\/action-gh-release@/.test(line));
  const files = lines.findIndex((line, index) => step >= 0 && index > step && /^\s+files: \|-?$/.test(line));
  const patterns: string[] = [];

  for (const line of files < 0 ? [] : lines.slice(files + 1)) {
    if (line.trim() === "" || indent(line) <= indent(lines[files])) {
      break;
    }
    patterns.push(line.trim());
  }

  return patterns;
}

const matchesPattern = (pattern: string, name: string) =>
  new RegExp(
    `^${pattern
      .split("*")
      .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
      .join(".*")}$`,
  ).test(name);

/** The classes of the kinds the extension reads, which the host reads: each with its kind, its versions and its page. */
const KINDS_READ = (Object.values(kinds) as unknown[]).filter(
  (value): value is { kind: string; crd: { apiVersions: string[]; title: string } } =>
    typeof value === "function" && "crd" in value,
);

describe("the documents of the package", () => {
  const readme = read("README.md");
  const changelog = read("CHANGELOG.md");

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

  it("says in Safety each kind and verb the adapter of the main process allows, no other kind of Velero written, and the three rules it keeps", () => {
    const safety = sectionOf(readme, "Safety", 2);
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
    const table = rowsOf(safety).filter(([write]) => /^(Create|Patch)\b/.test(write ?? ""));
    const said = table.map(([write, kind]) => `${write.split(" ")[0]} ${kind.replace(/`/g, "")}`);
    const patched = table
      .filter(([write]) => write.startsWith("Patch"))
      .flatMap(([write]) => [...write.matchAll(/`([^`]+)`/g)].map((match) => match[1]));
    const written = new Set(writes.map((write) => write.split(" ")[1]));
    const velero = new Set([...KINDS_READ.map(({ kind }) => kind), ...written]);
    const named = [...safety.matchAll(/`(\w+)`/g)].map((match) => match[1]).filter((name) => velero.has(name));

    expect(writes.length).toBeGreaterThan(0);
    expect([...new Set(said)].sort()).toEqual([...new Set(writes)].sort());
    expect([...new Set(patched)].sort()).toEqual([...new Set(fields)].sort());
    expect(named.filter((name) => !written.has(name))).toEqual([]);
    for (const rule of [
      "Signed URLs stay in the main process and are never logged, stored or shown.",
      "TLS is verified by default",
      "Missing or unreadable data is shown as unknown, never as healthy.",
    ]) {
      expect([rule, squeezed(safety).includes(rule)]).toEqual([rule, true]);
    }
  });

  it("says in Verify a release the commands the release workflow makes true, with the names of its files, and names a file for each pattern the release attaches, and no other", () => {
    const verify = sectionOf(sectionOf(readme, "Install", 2), "Verify a release", 3);
    const release = workflow("release.yaml");
    const patterns = attachedPatterns(release);
    const named = releaseFilesOf(sectionOf(readme, "Install", 2));
    const commands = commandsOf(verify);
    const tarball = `${PREFIX}<version>.tgz`;
    const powershell = commands.filter((line) => line.includes("Get-FileHash"));
    // The line of PowerShell compares the hash of the tarball with the first word of its checksum.
    const [, hashed, compared] =
      /^\(Get-FileHash -Algorithm SHA256 (\S+)\)\.Hash -eq \(\(Get-Content (\S+)\) -split '\\s\+'\)\[0\]$/.exec(
        powershell[0] ?? "",
      ) ?? [];
    // Every name of a file of the package in the README, in its code and in its commands, is the name pack gives it.
    const strangers = [...readme.matchAll(/[\w@<>.:/-]*velero-extension-[\w<>.*-]*/g)]
      .map((match) => match[0])
      .filter((name) => !name.startsWith(PREFIX));

    // Each checksum is written beside its file, in the directory of the files, by `sha256sum "$f" | tee
    // "$f.sha256"`: the digest, two spaces and the name of the file, the line `sha256sum -c` and `shasum -a 256 -c`
    // check in the directory of a download, and whose first word the line of PowerShell compares.
    expect(release).toMatch(/\n\s+for f in [^\n/;]+; do\n\s+sha256sum "\$f" \| tee "\$f\.sha256"\n\s+done\n/);
    expect(commands.filter((line) => line.startsWith("sha256sum"))).toEqual([`sha256sum -c ${tarball}.sha256`]);
    expect(commands.filter((line) => line.startsWith("shasum"))).toEqual([`shasum -a 256 -c ${tarball}.sha256`]);
    expect([powershell.length, hashed, compared]).toEqual([1, tarball, `${tarball}.sha256`]);
    expect(commands).toContain(`npm install ${manifest.name}@<version>`);
    expect(commands).toContain("npm audit signatures");
    expect(strangers).toEqual([]);
    expect(patterns.length).toBeGreaterThan(0);
    expect(patterns.filter((pattern) => !named.some((name) => matchesPattern(pattern, name)))).toEqual([]);
    expect(named.filter((name) => !patterns.some((pattern) => matchesPattern(pattern, name)))).toEqual([]);
    // What the bill of materials lists beside the extension: the libraries the bundles carry, which the manifest
    // declares as its dependencies.
    expect(Object.keys(manifest.dependencies).filter((library) => !verify.includes(library))).toEqual([]);
  });

  it("holds the notes of the version of package.json once it is a version the tag workflow tags, each version once, newest first", () => {
    // The expression the tag workflow matches the version of package.json with, as bash reads it.
    const tagged = new RegExp(/ =~ (\^\S+\$) \]\]/.exec(workflow("tag.yaml"))?.[1] ?? "(?!)");
    const versions = headingsOf(changelog)
      .filter(({ level }) => level === 2)
      .map(({ text }) => {
        const [, version = "", date = ""] = /^v(\S+) - (\d{4}-\d{2}-\d{2})$/.exec(text) ?? [];
        const real = !Number.isNaN(Date.parse(date)) && new Date(date).toISOString().startsWith(date);

        expect([text, tagged.test(version) && real]).toEqual([text, true]);

        return version;
      });

    expect(tagged.source).not.toBe("(?!)");
    expect(versions.length).toBeGreaterThan(0);
    expect(new Set(versions).size).toBe(versions.length);
    expect([...versions].sort(newestFirst)).toEqual(versions);
    expect(versions.filter((version) => sayNothing(notesOf(changelog, version)))).toEqual([]);
    // The version of main is 0.1.0-alpha.0 until the pull request of the first prerelease, a form the tag workflow
    // does not tag; from that pull request on, the version has its notes, or the pull request fails.
    const required = tagged.test(manifest.version) ? [manifest.version] : [];

    expect(required.filter((version) => sayNothing(notesOf(changelog, version)))).toEqual([]);
  });

  it("resolves every relative link, image and anchor of the README and of the changelog, and holds both to ASCII with no em dash and no emoji", () => {
    const repository = repositoryFiles();

    for (const [document, text] of [
      ["README.md", readme],
      ["CHANGELOG.md", changelog],
    ]) {
      const broken = targetsOf(text).flatMap(({ target, line }) => {
        const why = unresolved(document, target, repository);

        return why === undefined ? [] : [`${line}: ${why}`];
      });
      const outside = text
        .split("\n")
        .flatMap((line, index) =>
          [...line].some((character) => (character.codePointAt(0) ?? 0) > 0x7f) ? [`${index + 1}: ${line}`] : [],
        );
      // GitHub draws a shortcode of its prose, as `:rocket:`, as an emoji.
      const shortcodes = proseOf(text).flatMap((prose, index) =>
        [...prose.replace(/\]\([^)]*\)/g, "](").matchAll(/:[a-z0-9_+-]+:/g)].map(
          (match) => `${index + 1}: ${match[0]}`,
        ),
      );

      expect([document, broken]).toEqual([document, []]);
      expect([document, outside]).toEqual([document, []]);
      expect([document, shortcodes]).toEqual([document, []]);
      // The em dash, written by its code point: the formatter writes the escape as the character.
      expect([document, text.includes(String.fromCodePoint(0x2014))]).toEqual([document, false]);
    }
  });
});
