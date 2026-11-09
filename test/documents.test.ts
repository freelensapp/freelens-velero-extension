import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import * as kinds from "../src/renderer/api/kinds";

// The documents npm and GitHub show: the README, which is the page of the package, and the changelog, whose
// section of a version is the body of its GitHub release. What in them can go stale without anyone seeing it is
// read here against what makes it true: the manifest, the code, the workflows and the files of the repository.

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");
const manifest = JSON.parse(read("package.json")) as {
  name: string;
  version: string;
  engines: { freelens: string };
  dependencies: Record<string, string>;
};

/** A workflow without its comments: what it does, without what it says of itself. */
const workflow = (name: string) =>
  read(`.github/workflows/${name}`)
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("#"))
    .join("\n");

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

/** The targets of the links, the images and the definitions of links of a document, out of its code. */
function targetsOf(markdown: string): { target: string; line: number }[] {
  return linesOf(markdown).flatMap(({ text, fenced }, index) => {
    const prose = fenced ? "" : text.replace(/`[^`]*`/g, "");

    return [
      ...prose.matchAll(/\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g),
      ...prose.matchAll(/^ {0,3}\[[^\]]+\]:\s*<?([^\s>]+)>?/g),
      ...prose.matchAll(/<(?:a|img)\b[^>]*?\b(?:href|src)="([^"]+)"/gi),
    ].map((match) => ({ target: match[1], line: index + 1 }));
  });
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
function unresolved(document: string, target: string, repository = repositoryFiles()): string | undefined {
  if (/^[a-z][a-z0-9+.-]*:/i.test(target)) {
    return undefined;
  }
  const [path, anchor] = target.split("#");
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

/** The release file names a document gives, with a version in place of `<version>`, out of its blocks of code. */
function releaseFilesOf(markdown: string): string[] {
  const prefix = `${manifest.name.replace(/^@/, "").replace("/", "-")}-<version>`;

  return linesOf(markdown)
    .filter(({ fenced }) => !fenced)
    .flatMap(({ text }) => [...text.matchAll(/`([^`\s]+)`/g)].map((match) => match[1]))
    .filter((name) => name.startsWith(prefix))
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

describe("the documents of the package", () => {
  const readme = read("README.md");
  const changelog = read("CHANGELOG.md");

  it("says in Requirements the range of Freelens of the manifest and the versions of the API the code reads, lists in Supported APIs each kind the code reads under its version, and says nowhere that there is no release", () => {
    const requirements = sectionOf(readme, "Requirements", 2);
    const supported = sectionOf(readme, "Supported APIs", 2);
    // What the code reads: each class of the kinds, which the host reads, with its version, its kind and the
    // title of its page.
    const kindsRead = Object.values(kinds).map((kind) => ({
      version: kind.crd.apiVersions.join(", "),
      row: `${kind.kind} ${kind.crd.title}`,
    }));
    const versions = [...new Set(kindsRead.map(({ version }) => version))].sort();

    expect(versions.length).toBeGreaterThan(0);
    expect(requirements).toContain(`\`engines.freelens\` as \`${manifest.engines.freelens}\``);
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
      const rows = [...sectionOf(supported, version, 3).matchAll(/^\| `(\w+)` \| ([^|]+?) \|$/gm)].map(
        (match) => `${match[1]} ${match[2]}`,
      );

      expect([version, rows.sort()]).toEqual([
        version,
        kindsRead
          .filter((kind) => kind.version === version)
          .map(({ row }) => row)
          .sort(),
      ]);
    }
    // The section Status of before the first prerelease said that there was no release to install.
    expect(readme).not.toMatch(/\bno release\b/i);
  });

  it("says in Verify a release the three commands of the checksum and npm audit signatures, which the release workflow makes true, and names a file for each pattern the release attaches, and no other", () => {
    const verify = sectionOf(sectionOf(readme, "Install", 2), "Verify a release", 3);
    const release = workflow("release.yaml");
    const patterns = attachedPatterns(release);
    const named = releaseFilesOf(verify);

    // Each checksum is written beside its file, in the directory of the files, by `sha256sum "$f" | tee
    // "$f.sha256"`: the digest, two spaces and the name of the file, the line `sha256sum -c` and `shasum -a 256 -c`
    // check in the directory of a download, and whose first word the line of PowerShell compares.
    expect(release).toMatch(/\n\s+for f in [^\n/;]+; do\n\s+sha256sum "\$f" \| tee "\$f\.sha256"\n\s+done\n/);
    for (const command of [
      "sha256sum -c ",
      "shasum -a 256 -c ",
      "Get-FileHash -Algorithm SHA256 ",
      "npm audit signatures",
    ]) {
      expect([command, verify.includes(command)]).toEqual([command, true]);
    }
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
    expect(versions.filter((version) => notesOf(changelog, version) === "")).toEqual([]);
    // The version of main is 0.1.0-alpha.0 until the pull request of the first prerelease, a form the tag workflow
    // does not tag; from that pull request on, the version has its notes, or the pull request fails.
    const required = tagged.test(manifest.version) ? [manifest.version] : [];

    expect(required.filter((version) => notesOf(changelog, version) === "")).toEqual([]);
  });

  it("resolves every relative link, image and anchor of the README and of the changelog, and holds both to ASCII with no em dash", () => {
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

      expect([document, broken]).toEqual([document, []]);
      expect([document, outside]).toEqual([document, []]);
      // The em dash, written by its code point: the formatter writes the escape as the character.
      expect([document, text.includes(String.fromCodePoint(0x2014))]).toEqual([document, false]);
    }
  });
});
