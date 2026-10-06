import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import {
  ENTRY_KEYS,
  emptyArchive,
  entryFields,
  gz,
  LOG_LEVELS,
  logFacts,
  SYNCED_AGE,
  SYNCED_WORK,
  syntheticLog,
  syntheticResourceList,
  syntheticResults,
  syntheticVolumeInfo,
  tabArtifacts,
  tabExpectations,
} from "../e2e/scripts/local-artifacts.mts";
import { DEMO_NAMESPACE } from "../e2e/scripts/local-kind.mts";
import { PAGE_BOUND } from "../src/common/ipc";
import { pageOffsets } from "../src/main/artifact-holder";
import { PINNED } from "./tab-pins";

const MIB = 1024 ** 2;
const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");
const instant = (at: number) => new Date(at).toISOString().replace(/\.\d{3}Z$/, "Z");

// How an entry of the text format begins: its time, to the second and in UTC, its level, its message.
const HEAD = /^time="(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ)" level=([a-z]+) msg=/;

type Log = ReturnType<typeof syntheticLog>;
type Level = (typeof LOG_LEVELS)[number];

// What a plain reading of a log finds, with nothing of what wrote it: the level of a line by the pattern of
// its head, a text by a search of each line, a byte by the encoding of each line.
function plainly(text: string, searches: string[]) {
  const lines = text.split("\n");
  const afterTheLast = lines.pop();
  const numbers: Record<Level, number[]> = { error: [], warning: [], info: [], debug: [], other: [] };
  const withLength = new Map<number, number[]>();
  const levelInMessage: number[] = [];
  const levelInFreeText: number[] = [];
  const wanted = searches.map((search) => search.toLowerCase());
  const found = searches.map((search) => ({ text: search, lines: 0, occurrences: 0 }));
  let bytes = 0;
  let boundaryLine = 0;

  lines.forEach((line, index) => {
    const word = HEAD.exec(line)?.[2] as Level | undefined;
    const level = word && word !== "other" && LOG_LEVELS.includes(word) ? word : "other";
    const size = Buffer.byteLength(line) + 1;
    const folded = line.toLowerCase();

    numbers[level].push(index + 1);
    if (line.length >= 10_000) withLength.set(line.length, [...(withLength.get(line.length) ?? []), index + 1]);
    if (level === "other" && line.includes("level=")) levelInFreeText.push(index + 1);
    if (level !== "other" && line.includes("level=", line.indexOf(" msg="))) levelInMessage.push(index + 1);
    if (bytes <= PAGE_BOUND && PAGE_BOUND < bytes + size) boundaryLine = index + 1;
    bytes += size;
    wanted.forEach((search, at) => {
      const times = search === "" ? 0 : folded.split(search).length - 1;

      found[at].occurrences += times;
      if (times > 0) found[at].lines += 1;
    });
  });
  return {
    afterTheLast,
    lines: lines.length,
    bytes,
    characters: text.length,
    sha256: sha256(text),
    levels: Object.fromEntries(LOG_LEVELS.map((level) => [level, numbers[level].length])),
    errors: numbers.error,
    warnings: numbers.warning,
    long: {
      twentyThousand: withLength.get(20_000),
      tenThousand: withLength.get(10_000),
      tenThousandAndOne: withLength.get(10_001),
    },
    levelInMessage: { lines: levelInMessage.length, line: levelInMessage[0] },
    levelInFreeText: { lines: levelInFreeText.length, line: levelInFreeText[0] },
    twoByteCharacters: text.match(/[\u0080-\u07ff]/g)?.length ?? 0,
    threeByteCharacters: text.match(/[\u0800-\uffff]/g)?.length ?? 0,
    boundaryLine,
    found,
  };
}

// The facts of a log in the shape of a plain reading of it.
function counted({ facts }: Log) {
  return {
    afterTheLast: "",
    lines: facts.lines,
    bytes: facts.bytes,
    characters: facts.characters,
    sha256: facts.sha256,
    levels: facts.levels,
    errors: facts.entries.filter((entry) => entry.level === "error").map((entry) => entry.line),
    warnings: facts.entries.filter((entry) => entry.level === "warning").map((entry) => entry.line),
    long: {
      twentyThousand: [facts.long.twentyThousand],
      tenThousand: [facts.long.tenThousand],
      tenThousandAndOne: [facts.long.tenThousandAndOne],
    },
    levelInMessage: facts.levelInMessage,
    levelInFreeText: facts.levelInFreeText,
    twoByteCharacters: facts.twoByteCharacters,
    threeByteCharacters: facts.threeByteCharacters,
    boundaryLine: facts.boundaryLine,
    found: facts.searches.map((search) => ({ text: search.text, lines: search.matches, occurrences: search.matches })),
  };
}

// The log is long and the machine may be busy: a case has a minute.
describe("artifacts of the tabs", { timeout: 60_000 }, () => {
  const run = "a1b2c3d4";
  const started = Date.parse("2026-10-05T10:00:00.000Z");
  const backup = `fixture-synced-backup-${run}`;
  // Everything the store is given for the tabs, made once: the log has two hundred thousand lines.
  const artifacts = tabArtifacts({ backup, namespace: DEMO_NAMESPACE, started });
  const { text, facts } = artifacts.log;
  const lines = text.split("\n").slice(0, -1);
  const packed = gz(text);
  // A log of other names, of another moment and of fewer lines, and one of short lines.
  const other = { backup: "synthetic", namespace: "velero", started: Date.parse("2031-03-09T23:59:59.321Z") };
  const shorter = syntheticLog({ ...other, lines: 20_000 });
  const brief = syntheticLog({ ...other, lines: 100_000, brief: true });

  // A drift by the clock, by the machine or by an edit fails here by name: the digests and the counts are
  // changed on purpose, with the generator.
  it("makes the same artifacts wherever and whenever it is asked: these digests and these counts", () => {
    const expectations = tabExpectations(artifacts);

    expect(facts.sha256).toBe(PINNED.log);
    expect(facts.levels).toEqual({ error: 4, warning: 2, info: 169_231, debug: 30_217, other: 546 });
    expect([facts.lines, facts.bytes, facts.characters, facts.pages]).toEqual([200_000, 49_143_988, 49_141_855, 12]);
    expect(expectations.results).toMatchObject({
      bytes: 920,
      sha256: "af3d7a279aab05238f812a418660bfda37d58848b8ce210de27b11f93cacf1dd",
    });
    expect(expectations.resourceList).toMatchObject({
      bytes: 221_613,
      sha256: "4cbbee7f9c9564a4c61d2468d84afa88baf092850ba3e6638c46ba5aba0beb94",
    });
    expect(expectations.volumeInfo).toMatchObject({
      bytes: 2653,
      sha256: "aff59e9decc996c8d1fc87eed742102b65a81eb7e985b4f4bffab0109d0c1a44",
    });
    expect(expectations.empty).toEqual({
      results: { bytes: 28, sha256: "444e71de6ae4d67a6abbd96190d1cbe33bb12df0c6c5a6abe1a8ee7b956fd0d8" },
      resourceList: { bytes: 3, sha256: "ca3d163bab055381827226140568f3bef7eaac187cebd76878e0b63e9e442356" },
      volumeInfo: { bytes: 3, sha256: "37517e5f3dc66819f61f5a7bb8ace1921282415f10551d2defa5c3eb0985b570" },
    });
    expect(expectations.digest).toBe(PINNED.all);
    expect(syntheticLog({ ...other, lines: 20_000 })).toEqual(shorter);
    expect(syntheticVolumeInfo(started)).toEqual(artifacts.volumeInfo);
  });

  it("counts in the log, while it writes it, what a plain reading of its text finds", () => {
    for (const log of [artifacts.log, shorter, brief]) {
      expect(counted(log)).toEqual(
        plainly(
          log.text,
          log.facts.searches.map((search) => search.text),
        ),
      );
    }
    // The first page of each ends in another line, and the facts say in which.
    expect(new Set([0, facts.boundaryLine, shorter.facts.boundaryLine, brief.facts.boundaryLine]).size).toBe(4);
  });

  it("gives a line a level only where an entry begins, whatever the words of the line say", () => {
    const naming = (word: string) => lines.filter((line) => line.includes(`level=${word}`)).length;

    expect(facts.levels).toMatchObject({ error: 4, warning: 2 });
    expect(facts.lines).toBe(LOG_LEVELS.reduce((total, level) => total + facts.levels[level], 0));
    // About one line in four hundred has no level, and about three entries in twenty are at debug.
    expect(facts.levels.other).toBeGreaterThan(400);
    expect(facts.levels.other).toBeLessThan(600);
    expect(Math.round(facts.levels.debug / 1000)).toBe(30);
    // A reader that takes a level from anywhere in a line finds more errors and more warnings than there
    // are: forty entries at info name an error in their message, and twenty-four lines with no level name
    // an error or a warning in their words.
    expect(facts.levelInMessage.lines).toBe(40);
    expect(facts.levelInFreeText.lines).toBe(24);
    expect([naming("error"), naming("warning")]).toEqual([4 + 40 + 12, 2 + 12]);
    expect(lines[facts.levelInMessage.line - 1]).toMatch(/^time="[^"]+" level=info msg="[^"]*level=error[^"]*" /);
    expect(lines[facts.levelInFreeText.line - 1]).toMatch(/^synthetic line that is not an entry[^=]* level=error /);
    expect(logFacts(text).levels).toEqual(facts.levels);
  });

  it("writes an entry as the text format of the server does, and the lines 15 milliseconds apart", () => {
    const origin = started - SYNCED_AGE;
    const field = ` backup=${DEMO_NAMESPACE}/${backup} `;

    expect(facts.lines * 15).toBe(SYNCED_WORK);
    expect(instant(origin)).toBe("2025-08-31T10:00:00Z");
    const notFreeText: number[] = [];
    const notEntries: number[] = [];

    lines.forEach((line, index) => {
      const head = HEAD.exec(line);

      if (!head) {
        // Free text: it does not begin as an entry does, and does not carry the field of the backup.
        if (/^(time|level)=/.test(line) || line.includes(field)) notFreeText.push(index + 1);
        return;
      }
      // An entry: its time is the one of its place, it carries the backup and where it was written from,
      // and it has no character of more than one byte, which are in the free text alone.
      if (
        head[1] !== instant(origin + index * 15) ||
        !/^[\x20-\x7e]+$/.test(line) ||
        !line.includes(field) ||
        !line.includes(' logSource="pkg/synthetic/')
      )
        notEntries.push(index + 1);
      if (index % 97 !== 0 && !["error", "warning"].includes(head[2])) return;
      const keys = entryFields(line).map(([key]) => key);

      // The head, then the fields in the order of their keys.
      expect(keys.slice(0, 3)).toEqual(ENTRY_KEYS.slice(0, 3));
      expect(keys.slice(3)).toEqual(keys.slice(3).sort());
      expect(keys).toEqual(expect.arrayContaining([...ENTRY_KEYS]));
    });
    expect([notFreeText, notEntries]).toEqual([[], []]);
    // A log of fewer lines is of less work: its lines are as far apart, from the start of its own moment.
    const fewer = shorter.text.split("\n").slice(0, -1);

    expect(fewer).toHaveLength(20_000);
    expect(
      fewer.flatMap((line, index) => {
        const time = HEAD.exec(line)?.[1];

        return time === undefined || time === instant(other.started - SYNCED_AGE + index * 15) ? [] : [index + 1];
      }),
    ).toEqual([]);
    // Twenty thousand of them are five minutes, from a second before midnight.
    expect(HEAD.exec(fewer.findLast((line) => HEAD.test(line)) ?? "")?.[1]).toBe("2030-02-03T00:04:59Z");
    // A line in the form of the ones the documents of the release show, with a quote inside a value, and one
    // with a value that is empty.
    expect(
      entryFields(
        'time="2020-11-23T12:58:31+03:00" level=error msg="error restoring synthetic: Service \\"synthetic\\" is invalid" logSource="pkg/restore/restore.go:1170" restore=velero/synthetic',
      ),
    ).toEqual([
      ["time", "2020-11-23T12:58:31+03:00"],
      ["level", "error"],
      ["msg", 'error restoring synthetic: Service "synthetic" is invalid'],
      ["logSource", "pkg/restore/restore.go:1170"],
      ["restore", "velero/synthetic"],
    ]);
    expect(entryFields('msg="a\\\\b" name=synthetic namespace= resource=pods')).toEqual([
      ["msg", "a\\b"],
      ["name", "synthetic"],
      ["namespace", ""],
      ["resource", "pods"],
    ]);
    // The release writes the progress of a backup as a field with nothing in it, as the log of the backup
    // of the environment has it: at the end of the line that says how many items were backed up, and inside
    // an entry of an item at info, between its namespace and its resource. Not every entry of an item at info
    // carries it, and no entry at another level does.
    for (const log of [lines, fewer]) {
      const total = log.find((line) => line.includes(' msg="Backed up a total of ')) ?? "";
      const ofItems = log.filter((line) => HEAD.test(line) && / level=info .* name=\S+ namespace=\S+ /.test(line));
      const progressed = log.filter((line) => / namespace=\S+ progress= resource=\S+$/.test(line));

      expect(entryFields(total).slice(-1)).toEqual([["progress", ""]]);
      expect(total.endsWith(" progress=")).toBe(true);
      expect(progressed.every((line) => HEAD.exec(line)?.[2] === "info")).toBe(true);
      expect([progressed.length > 0, progressed.length < ofItems.length]).toEqual([true, true]);
    }
  });

  it("writes the errors and the warnings of the log as the results have them, part by part", () => {
    const marks = [" resource: /", " name: /", " message: /", " error: /"];
    const results = artifacts.results.value;
    const rebuilt: typeof results = { errors: {}, warnings: {} };

    // What the hook of the server makes of an entry at error or at warning, and where the release files it.
    for (const line of lines) {
      const level = /^time="[^"]+" level=(error|warning) /.exec(line)?.[1];

      if (!level) continue;
      const fields = new Map(entryFields(line));
      const namespace = fields.get("namespace");
      const result = rebuilt[level === "error" ? "errors" : "warnings"];
      const message = [
        fields.has("resource") ? ` resource: /${fields.get("resource")}` : "",
        fields.has("name") ? ` name: /${fields.get("name")}` : "",
        ` message: /${fields.get("msg")}`,
        fields.has("error") ? ` error: /${fields.get("error")}` : "",
      ].join("");

      if (namespace === undefined) result.velero = [...(result.velero ?? []), message];
      else if (namespace === "") result.cluster = [...(result.cluster ?? []), message];
      else {
        result.namespaces ??= {};
        result.namespaces[namespace] = [...(result.namespaces[namespace] ?? []), message];
      }
    }
    expect(rebuilt).toEqual(results);
    // Four errors, two of Velero and two of two namespaces, a warning of Velero and a warning of the cluster:
    // the three places. The two of Velero are the ones the release writes, in the order of the log.
    expect(results).toEqual({
      errors: {
        velero: [
          expect.stringMatching(/^ name: \/synthetic-pod-\d+ message: \/Error backing up item error: \/synthetic /),
          expect.stringMatching(/^ message: \/pod volume backup failed: synthetic /),
        ],
        namespaces: {
          "synthetic-ns-17": [expect.any(String)],
          "synthetic-ns-3": [expect.any(String)],
        },
      },
      warnings: { velero: [expect.any(String)], cluster: [expect.any(String)] },
    });
    // The facts tell the same entries: each part they give is the field of the line they give it of, a part
    // the line does not have is not told, and their messages are the ones of the results, place by place.
    const told: typeof results = { errors: {}, warnings: {} };

    for (const entry of facts.entries) {
      const fields = new Map(entryFields(lines[entry.line - 1]));
      const result = told[entry.level === "error" ? "errors" : "warnings"];

      const parts = [entry.level, entry.message, entry.namespace, entry.resource, entry.name, entry.error];
      const written = ["level", "msg", "namespace", "resource", "name", "error"].map((key) => fields.get(key));

      expect([entry.line, ...parts]).toEqual([entry.line, ...written]);
      if (entry.namespace === undefined) result.velero = [...(result.velero ?? []), entry.text];
      else if (entry.namespace === "") result.cluster = [...(result.cluster ?? []), entry.text];
      else {
        result.namespaces ??= {};
        result.namespaces[entry.namespace] = [...(result.namespaces[entry.namespace] ?? []), entry.text];
      }
    }
    expect(told).toEqual(results);
    // They tell where the release files each, and each mark of the hook is in a message once at most.
    expect(
      facts.entries.map((entry) => [
        entry.level,
        entry.place,
        lines[entry.line - 1].includes(` msg="${entry.message}" `),
      ]),
    ).toEqual([
      ["warning", "velero", true],
      ["warning", "cluster", true],
      ["error", "namespace", true],
      ["error", "velero", true],
      ["error", "namespace", true],
      ["error", "velero", true],
    ]);
    for (const entry of facts.entries) {
      expect(entry.text).toBe(
        [
          entry.resource === undefined ? "" : ` resource: /${entry.resource}`,
          entry.name === undefined ? "" : ` name: /${entry.name}`,
          ` message: /${entry.message}`,
          entry.error === undefined ? "" : ` error: /${entry.error}`,
        ].join(""),
      );
      for (const mark of marks)
        expect([entry.line, mark, entry.text.split(mark).length - 1 <= 1]).toEqual([entry.line, mark, true]);
    }
    // One with the four parts, two with the message alone, one of each mix between them.
    expect(facts.entries.map((entry) => marks.filter((mark) => entry.text.includes(mark)).length).sort()).toEqual([
      1, 1, 2, 3, 3, 4,
    ]);
    // The hard one: its error carries a colon before a slash and the word of a mark, and no mark.
    const hard = facts.entries.find((entry) => entry.error?.includes(": /"));

    expect(hard?.error).toContain("error:");
    expect(marks.filter((mark) => hard?.error?.includes(mark))).toEqual([]);
    expect(Object.keys(hard ?? {}).filter((key) => ["resource", "name", "error"].includes(key))).toEqual([
      "name",
      "error",
    ]);
    // The messages of the release have the fields the release gives them, and no other. It says that an item
    // was not backed up with the logger of the backup, which carries the name of the item and its error: no
    // namespace, so the hook files it under Velero. It says that a pod volume failed in a message alone.
    const keysOf = (message: RegExp) =>
      facts.entries
        .filter((entry) => message.test(entry.message))
        .map((entry) => entryFields(lines[entry.line - 1]).map(([key]) => key));

    expect(hard?.message).toBe("Error backing up item");
    expect(keysOf(/^Error backing up item$/)).toEqual([
      ["time", "level", "msg", "backup", "error", "error.file", "error.function", "logSource", "name"],
    ]);
    expect(keysOf(/^pod volume backup failed: /)).toEqual([["time", "level", "msg", "backup", "logSource"]]);
    // Every other one says that it is synthetic: no logger of the release gives its message, and it is filed
    // by the namespace field it carries, or under Velero for a warning that has none.
    expect(
      facts.entries
        .filter((entry) => !/^(Error backing up item$|pod volume backup failed: )/.test(entry.message))
        .map((entry) => [entry.place, /^Synthetic (error|warning): /.test(entry.message)]),
    ).toEqual([
      ["velero", true],
      ["cluster", true],
      ["namespace", true],
      ["namespace", true],
    ]);
    // The release says that a pod volume failed once the items are done, before it says how many they were.
    const total = lines.findIndex((line) => line.includes(' msg="Backed up a total of ')) + 1;
    const failed = facts.entries.find((entry) => entry.message.startsWith("pod volume backup failed: "))?.line ?? 0;

    expect([failed < total, total - failed < 10, lines.length - total < 20]).toEqual([true, true, true]);
    // The status of the backup counts the hooks that ran, and it counts none: no entry says that one failed.
    expect(facts.entries.filter((entry) => /hook/i.test(lines[entry.line - 1])).map((entry) => entry.line)).toEqual([]);
  });

  it("holds each search text once in a line at most, in every shape a search meets", () => {
    const { searches } = facts;
    const of = (use: string) => searches.filter((search) => search.use === use);
    const read = logFacts(
      text,
      searches.map((search) => search.text),
    );

    expect(searches).toHaveLength(16);
    expect(new Set(searches.map((search) => search.text.toLowerCase())).size).toBe(16);
    expect([of("content").length, of("warm").length, of("measured").length]).toEqual([4, 2, 10]);
    // The matches and the lines of a text are one number.
    expect(read.found).toEqual(
      searches.map((search) => ({ text: search.text, lines: search.matches, occurrences: search.matches })),
    );
    // In no line, in one line far down, in tens, in hundreds, in thousands, in most of the lines.
    const shapes = (use: string) =>
      of(use)
        .map(({ matches }) => (matches < 2 ? `${matches}` : `1e${Math.floor(Math.log10(matches))}`))
        .sort();

    expect(shapes("content")).toEqual(["0", "1", "1e1", "1e2"]);
    expect(shapes("warm")).toEqual(["1e1", "1e3"]);
    expect(shapes("measured")).toEqual(["0", "1", "1e1", "1e2", "1e3", "1e3", "1e3", "1e4", "1e5", "1e5"]);
    for (const search of searches.filter(({ matches }) => matches === 1)) {
      expect(lines.findIndex((line) => line.toLowerCase().includes(search.text.toLowerCase()))).toBeGreaterThan(
        190_000,
      );
    }
    // One is in the log in the three cases of its letters, and is asked for in capitals.
    const cases = ["checkpoint written", "Checkpoint Written", "CHECKPOINT WRITTEN"].map(
      (form) => lines.filter((line) => line.includes(form)).length,
    );

    expect(cases.every((count) => count > 100)).toBe(true);
    expect(cases.reduce((total, count) => total + count)).toBe(searches[1].matches);
    expect(searches[1].text).toBe("CHECKPOINT WRITTEN");
  });

  it("ends the first page of the log inside a character, and fills twelve pages", () => {
    const content = Buffer.from(text);
    const offsets = pageOffsets(content);

    // The byte the first page would begin its second with continues a character: the page ends before it.
    expect(content[PAGE_BOUND] & 0xc0).toBe(0x80);
    expect(offsets[1]).toBe(PAGE_BOUND - 1);
    expect(content.toString("utf8", offsets[0], offsets[1]) + content.toString("utf8", offsets[1])).toBe(text);
    expect(Buffer.from(lines.slice(0, facts.boundaryLine).join("\n")).length).toBeGreaterThan(PAGE_BOUND);
    expect(Buffer.from(lines.slice(0, facts.boundaryLine - 1).join("\n")).length).toBeLessThan(PAGE_BOUND);
    expect(facts.pages).toBe(offsets.length - 1);
    expect(facts.pages).toBe(12);
    expect(shorter.facts.pages).toBe(pageOffsets(Buffer.from(shorter.text)).length - 1);
    expect(brief.facts.pages).toBe(pageOffsets(Buffer.from(brief.text)).length - 1);
    // The pages are counted by the bytes. The logs above have as many pages by their characters: this one has
    // more bytes than a page holds and no more characters than that. A change of the generator moves the
    // length that does so by a few lines: the first of these expectations then fails, and says to take it
    // again.
    const over = syntheticLog({ ...other, lines: 18_815 });

    expect([over.facts.characters <= PAGE_BOUND, PAGE_BOUND < over.facts.bytes]).toEqual([true, true]);
    expect([over.facts.pages, pageOffsets(Buffer.from(over.text)).length - 1]).toEqual([2, 2]);
  });

  it("keeps the log within the bounds of an artifact, with its long lines", () => {
    const long = (number: number) => lines[number - 1];

    expect(facts.lines).toBe(200_000);
    expect(lines).toHaveLength(200_000);
    expect(facts.bytes).toBeLessThanOrEqual(48 * MIB);
    expect(packed.length).toBeLessThanOrEqual(8 * MIB);
    // One line of twenty thousand characters, one of ten thousand and the next of ten thousand and one,
    // each with more bytes than characters.
    expect(
      [long(facts.long.twentyThousand), long(facts.long.tenThousand), long(facts.long.tenThousandAndOne)].map(
        (line) => line.length,
      ),
    ).toEqual([20_000, 10_000, 10_001]);
    expect(facts.long.tenThousandAndOne).toBe(facts.long.tenThousand + 1);
    for (const number of Object.values(facts.long)) {
      expect(Buffer.byteLength(long(number))).toBeGreaterThan(long(number).length);
      expect(long(number)).toMatch(/^synthetic .*\S$/);
    }
    // About one entry in two hundred has a long message.
    const longer = lines.filter((line) => line.length > 600 && line.length < 10_000).length;

    expect(longer).toBeGreaterThan(800);
    expect(longer).toBeLessThan(1200);
  });

  it("encodes the results, the resources and the volumes as the release does: one value and a newline", () => {
    const { results, resourceList, volumeInfo, empty } = artifacts;

    for (const artifact of [results, resourceList, volumeInfo, empty.results, empty.resourceList, empty.volumeInfo]) {
      expect(JSON.parse(artifact.text)).toEqual(artifact.value);
      expect(artifact.text).toBe(`${JSON.stringify(artifact.value)}\n`);
      // No character the encoder of the release writes another way: it escapes what could end a tag.
      expect(artifact.text).toMatch(/^[\x20-\x7e]+\n$/);
      expect(artifact.text).not.toMatch(/[<>&]/);
    }
    expect([empty.results.text, empty.resourceList.text, empty.volumeInfo.text]).toEqual([
      '{"errors":{},"warnings":{}}\n',
      "{}\n",
      "[]\n",
    ]);
    expect([syntheticResults("empty"), syntheticResourceList("empty"), syntheticVolumeInfo(started, "empty")]).toEqual([
      empty.results,
      empty.resourceList,
      empty.volumeInfo,
    ]);
    expect([syntheticResults(), syntheticResourceList()]).toEqual([results, resourceList]);
    // The release writes a map in the order of its keys, and the lists of a result in the order of its type:
    // of Velero, of the cluster, of the namespaces.
    expect(results.text).toMatch(
      /^\{"errors":\{"velero":\[.*\],"namespaces":\{"synthetic-ns-17":\[.*\}\},"warnings":\{"velero":\[.*\],"cluster":\[.*\]\}\}\n$/,
    );
    expect(Object.keys(results.value.errors)).toEqual(["velero", "namespaces"]);
    expect(Object.keys(results.value.errors.namespaces ?? {})).toEqual(["synthetic-ns-17", "synthetic-ns-3"]);
  });

  it("lists the resources and their items in the order of the code units", () => {
    const list = artifacts.resourceList.value;
    const resources = Object.keys(list);
    const items = Object.values(list).flat();
    const namespaced = items.filter((item) => item.includes("/"));
    const byLanguage = (names: string[]) => [...names].sort((one, other) => one.localeCompare(other, "en"));
    const roles = list["rbac.authorization.k8s.io/v1/Role"];

    expect([resources.length, items.length, new Set(namespaced.map((item) => item.split("/")[0])).size]).toEqual([
      48, 6000, 24,
    ]);
    expect(resources).toEqual([...resources].sort());
    for (const resource of resources) {
      expect([resource, list[resource]]).toEqual([resource, [...list[resource]].sort()]);
      expect([resource, new Set(list[resource]).size]).toEqual([resource, list[resource].length]);
      expect(resource).toMatch(/^([a-z0-9.]+\/)?v[0-9a-z]+\/[A-Z][A-Za-z]+$/);
    }
    // These names are of one byte a character: their order by code unit is the order of the bytes the
    // release sorts them by.
    expect([...resources, ...items].every((name) => /^[\x21-\x7e]+$/.test(name))).toBe(true);
    // The cluster-scoped ones have no namespace: the namespaces themselves, and the volumes.
    expect(list["v1/Namespace"]).toHaveLength(24);
    expect(list["v1/PersistentVolume"]).toHaveLength(144);
    expect([...list["v1/Namespace"], ...list["v1/PersistentVolume"]].some((item) => item.includes("/"))).toBe(false);
    expect(namespaced.every((item) => list["v1/Namespace"].includes(item.split("/")[0]))).toBe(true);
    // Capitals, colons and dashes: the order of a language is another one, for the resources and for
    // the items of one.
    expect(roles.filter((item) => /\/[A-Z]/.test(item)).length).toBeGreaterThan(0);
    expect(roles.filter((item) => item.includes(":")).length).toBeGreaterThan(0);
    expect(byLanguage(resources)).not.toEqual(resources);
    expect(byLanguage(roles)).not.toEqual(roles);
    // What the log says once, when the items are done.
    expect(lines.filter((line) => line.includes('msg="Backed up a total of 6000 items"'))).toHaveLength(1);
  });

  it("gives each volume the fields of its case, and not the ones of another", () => {
    const volumes = artifacts.volumeInfo.value;
    const [skipped, native, csi, podVolume, failed] = volumes;
    const keys = (value: object | undefined) => Object.keys(value ?? {});
    const always = ["pvcName", "pvcNamespace", "pvName"];
    const truths = ["snapshotDataMoved", "preserveLocalSnapshot", "skipped"];
    const times = ["startTimestamp", "completionTimestamp"];
    const window = [instant(started - SYNCED_AGE), instant(started - SYNCED_AGE + SYNCED_WORK)];

    // In the order the release lists them, with the three truths in every one.
    expect(
      volumes.map((volume) => [
        volume.backupMethod,
        volume.result,
        volume.skipped,
        volume.preserveLocalSnapshot,
        volume.snapshotDataMoved,
      ]),
    ).toEqual([
      [undefined, undefined, true, false, false],
      ["NativeSnapshot", "succeeded", false, false, false],
      ["CSISnapshot", "succeeded", false, true, false],
      ["PodVolumeBackup", "succeeded", false, false, false],
      ["PodVolumeBackup", "failed", false, false, false],
    ]);
    // A skipped volume has its reason, and no method, no result and no times.
    expect(keys(skipped)).toEqual([...always, ...truths, "skippedReason", "pvInfo"]);
    expect(skipped.skippedReason).toMatch(/^[A-Za-z]+: .+;$/);
    // A native snapshot has no times, and its detail no size.
    expect(keys(native)).toEqual([...always, "backupMethod", ...truths, "result", "nativeSnapshotInfo", "pvInfo"]);
    expect(keys(native.nativeSnapshotInfo)).toEqual(["snapshotHandle", "volumeType", "volumeAZ", "iops", "Phase"]);
    expect(JSON.stringify(native)).not.toMatch(/size/i);
    expect(native.nativeSnapshotInfo).toMatchObject({ iops: "3000", Phase: "Completed" });
    // A CSI snapshot of a backup that was finalized has the end and the result its operation gave it.
    expect(keys(csi)).toEqual([...always, "backupMethod", ...truths, ...times, "result", "csiSnapshotInfo", "pvInfo"]);
    expect(keys(csi.csiSnapshotInfo)).toEqual([
      "snapshotHandle",
      "size",
      "driver",
      "vscName",
      "operationID",
      "ReadyToUse",
    ]);
    expect(csi.csiSnapshotInfo).toMatchObject({ size: 10 * 1024 ** 3, ReadyToUse: true });
    expect(csi.csiSnapshotInfo?.operationID).toBe(`${csi.pvcNamespace}/synthetic-snapshot-1/${csi.startTimestamp}`);
    // A pod volume has both times, its size and its phase; the one that failed has no snapshot.
    expect(keys(podVolume)).toEqual([...always, "backupMethod", ...truths, ...times, "result", "pvbInfo", "pvInfo"]);
    expect(keys(failed)).toEqual(keys(podVolume));
    expect(keys(podVolume.pvbInfo)).toEqual([
      "snapshotHandle",
      "size",
      "incrementalSize",
      "uploaderType",
      "volumeName",
      "podName",
      "podNamespace",
      "nodeName",
      "Phase",
    ]);
    expect(keys(failed.pvbInfo)).toEqual([
      "size",
      "uploaderType",
      "volumeName",
      "podName",
      "podNamespace",
      "nodeName",
      "Phase",
    ]);
    expect([podVolume.pvbInfo?.Phase, failed.pvbInfo?.Phase]).toEqual(["Completed", "Failed"]);
    // The volume of every one, with its labels: the one that has none says so.
    expect(volumes.map((volume) => keys(volume.pvInfo))).toEqual(Array(5).fill(["reclaimPolicy", "labels"]));
    expect(volumes.map((volume) => volume.pvInfo.labels === null)).toEqual([false, true, false, false, false]);
    // The times are of the work of the backup, to the second, and move with the start of the run alone.
    for (const volume of [csi, podVolume, failed]) {
      const [start, end] = [volume.startTimestamp as string, volume.completionTimestamp as string];

      expect([window[0] < start, start < end, end <= window[1]]).toEqual([true, true, true]);
      expect([start, end].every((time) => /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(time))).toBe(true);
    }
    // The release gives a CSI snapshot the end its operation tells, and asks the operation once the items
    // are done: the end is not before the line of the log that says how many they were, and not after the
    // backup ended, at whatever thousandth the fixtures were started. A pod volume ends while they are done.
    const done = lines.findIndex((line) => line.includes(' msg="Backed up a total of '));

    for (const thousandths of [0, 1, 150, 789, 999]) {
      const moment = started + thousandths;
      const said = instant(moment - SYNCED_AGE + done * 15);
      const ended = instant(Math.floor((moment - SYNCED_AGE) / 1000) * 1000 + SYNCED_WORK);
      const [, , snapshot, pod] = syntheticVolumeInfo(moment).value;

      expect([thousandths, said <= (snapshot.completionTimestamp ?? ""), snapshot.completionTimestamp]).toEqual([
        thousandths,
        true,
        ended,
      ]);
      expect([thousandths, (pod.completionTimestamp ?? "") < said]).toEqual([thousandths, true]);
    }
    expect(HEAD.exec(lines[done])?.[1]).toBe(instant(started - SYNCED_AGE + done * 15));
    expect(syntheticVolumeInfo(started + 86_400_000).value[2].startTimestamp).toBe(
      instant(Date.parse(csi.startTimestamp as string) + 86_400_000),
    );
    // The volumes are the ones of the resources the backup lists.
    expect(volumes.every((volume) => artifacts.resourceList.value["v1/PersistentVolume"].includes(volume.pvName))).toBe(
      true,
    );
    expect(
      volumes.every((volume) =>
        artifacts.resourceList.value["v1/PersistentVolumeClaim"].includes(`${volume.pvcNamespace}/${volume.pvcName}`),
      ),
    ).toBe(true);
    // The release never collects the snapshots of a CSI driver and their contents: the list of the resources
    // holds the ones the backup took itself, which are the ones of its CSI volumes, each with its content and
    // in the namespace of its claim, and the class they are of.
    const taken = volumes.filter((volume) => volume.backupMethod === "CSISnapshot");
    const snapshots = (kind: string) => artifacts.resourceList.value[`snapshot.storage.k8s.io/v1/${kind}`];

    expect(taken).toEqual([csi]);
    expect(snapshots("VolumeSnapshot")).toEqual(
      taken.map((volume) => volume.csiSnapshotInfo?.operationID.split("/").slice(0, 2).join("/")).sort(),
    );
    expect(snapshots("VolumeSnapshot")).toEqual([`${csi.pvcNamespace}/synthetic-snapshot-1`]);
    expect(snapshots("VolumeSnapshotContent")).toEqual(taken.map((volume) => volume.csiSnapshotInfo?.vscName).sort());
    expect(snapshots("VolumeSnapshotClass")).toHaveLength(1);
    // The release says each pod volume that failed in an error of its own, a message alone that names neither
    // the pod nor the volume: the results have as many of them, under Velero, as the volumes have.
    const reported = (artifacts.results.value.errors.velero ?? []).filter((message) =>
      message.startsWith(" message: /pod volume backup failed: "),
    );

    expect(volumes.filter((volume) => volume.pvbInfo?.Phase === "Failed")).toEqual([failed]);
    expect(reported).toHaveLength(1);
    expect(JSON.stringify(artifacts.results.value)).not.toContain(failed.pvbInfo?.podName);
  });

  it("packs an artifact with gzip, and makes the contents of a backup of an empty tar", () => {
    const words = `${lines[facts.long.tenThousand - 1]}\n`;
    const archive = emptyArchive();
    const unpacked = gunzipSync(archive);

    expect(gunzipSync(gz(words)).toString()).toBe(words);
    expect(gunzipSync(gz(Buffer.from([0, 255, 10, 13]))).equals(Buffer.from([0, 255, 10, 13]))).toBe(true);
    expect(gunzipSync(packed).equals(Buffer.from(text))).toBe(true);
    // Two blocks of zeros end a tar: the archive is never empty bytes, which the deletion could not read.
    expect(archive.length).toBeGreaterThan(0);
    expect([archive[0], archive[1]]).toEqual([0x1f, 0x8b]);
    expect(unpacked).toHaveLength(1024);
    expect(unpacked.every((byte) => byte === 0)).toBe(true);
  });

  it("counts the lines, the levels and the matches of any log", () => {
    const log = [
      'time="2026-01-01T00:00:00Z" level=info msg="one level=error two" backup=velero/synthetic',
      'time="2026-01-01T00:00:00Z" level=warning msg="Synthetic synthetic" backup=velero/synthetic',
      'level=error msg="an entry with no time"',
      'time="2026-01-01T00:00:00Z" level=fatal msg="a level the tabs have no name for"',
      'time="2026-01-01T00:00:00Z"',
      "free text level=debug",
      "",
      'time="2026-01-01T00:00:01Z" level=debug msg="the last line has no newline"',
    ].join("\n");

    expect(logFacts(log, ["SYNTHETIC", "level=", "in no line", ""])).toEqual({
      lines: 8,
      bytes: Buffer.byteLength(log),
      characters: log.length,
      sha256: sha256(log),
      levels: { error: 1, warning: 1, info: 1, debug: 1, other: 4 },
      found: [
        { text: "SYNTHETIC", lines: 2, occurrences: 4 },
        { text: "level=", lines: 6, occurrences: 7 },
        { text: "in no line", lines: 0, occurrences: 0 },
        { text: "", lines: 0, occurrences: 0 },
      ],
    });
    // A level is read to the end of its line when nothing follows it.
    expect(logFacts('time="2026-01-01T00:00:00Z" level=info\nlevel=warning\nlevel=\n').levels).toEqual({
      error: 0,
      warning: 1,
      info: 1,
      debug: 0,
      other: 1,
    });
    // A text is counted again where the one counted before it ended, as a search goes on after a match:
    // two that overlap are one.
    expect(logFacts("aaaa\nabababa\nAbA\n", ["aa", "aba"]).found).toEqual([
      { text: "aa", lines: 1, occurrences: 2 },
      { text: "aba", lines: 2, occurrences: 3 },
    ]);
    expect(logFacts("").lines).toBe(0);
    expect(logFacts("one\n").lines).toBe(1);
    expect(logFacts("one\n\n").lines).toBe(2);
    expect(logFacts("\u00b5\u2192\n")).toMatchObject({ lines: 1, bytes: 6, characters: 3 });
  });

  it("tells the suites what the artifacts hold, as plain data", () => {
    const expectations = tabExpectations(artifacts);
    const digest = (changed: Partial<typeof artifacts>) => tabExpectations({ ...artifacts, ...changed }).digest;

    expect(JSON.parse(JSON.stringify(expectations))).toEqual(expectations);
    expect(expectations).toMatchObject({ backup, namespace: DEMO_NAMESPACE, started, log: facts });
    expect(expectations.results).toEqual({
      bytes: Buffer.byteLength(artifacts.results.text),
      sha256: sha256(artifacts.results.text),
      errors: 4,
      warnings: 2,
      value: artifacts.results.value,
    });
    expect(expectations.resourceList).toEqual({
      bytes: Buffer.byteLength(artifacts.resourceList.text),
      sha256: sha256(artifacts.resourceList.text),
      resources: 48,
      items: 6000,
      value: artifacts.resourceList.value,
    });
    expect(expectations.volumeInfo).toEqual({
      bytes: Buffer.byteLength(artifacts.volumeInfo.text),
      sha256: sha256(artifacts.volumeInfo.text),
      volumes: 5,
      value: artifacts.volumeInfo.value,
    });
    // The errors and the warnings of the status of the backup are the entries of the log at those levels.
    expect([expectations.results.errors, expectations.results.warnings]).toEqual([
      facts.levels.error,
      facts.levels.warning,
    ]);
    // One digest of every text: another text of any of them is another digest.
    expect(digest({})).toBe(expectations.digest);
    for (const changed of [
      { log: shorter },
      { results: artifacts.empty.results },
      { resourceList: artifacts.empty.resourceList },
      { volumeInfo: syntheticVolumeInfo(started + 1000) },
      { empty: { ...artifacts.empty, results: artifacts.results } },
      { empty: { ...artifacts.empty, resourceList: artifacts.resourceList } },
      { empty: { ...artifacts.empty, volumeInfo: artifacts.volumeInfo } },
    ]) {
      expect([Object.keys(changed), digest(changed) === expectations.digest]).toEqual([Object.keys(changed), false]);
    }
  });

  it("makes a brief log of more lines within the bound of an artifact", () => {
    const entries = brief.text.split("\n").filter((line) => HEAD.test(line));

    // Half a million of its lines are within the 64 MiB of an artifact.
    expect((brief.facts.bytes / brief.facts.lines) * 500_000).toBeLessThan(64 * MIB);
    expect(brief.facts.lines).toBe(100_000);
    // No field of an item but in the entries of the results, and no long message at info or at debug.
    expect(entries.filter((line) => line.includes(" resource=")).length).toBe(2);
    expect(entries.filter((line) => / level=(info|debug) /.test(line) && line.length >= 200)).toEqual([]);
    expect(brief.facts.entries).toHaveLength(6);
    expect(brief.facts.levels).toMatchObject({ error: 4, warning: 2 });
  });

  it("refuses a log it cannot count, and volumes of no moment", () => {
    const options = { backup, namespace: DEMO_NAMESPACE, started };

    expect(syntheticLog({ ...options, lines: 1000 }).facts).toMatchObject({
      lines: 1000,
      levels: { error: 4, warning: 2 },
    });
    for (const lines of [999, 1000.5, Number.NaN]) {
      expect(() => syntheticLog({ ...options, lines })).toThrow("A synthetic log has a thousand lines at least");
    }
    for (const names of [
      { backup: "Synthetic Backup" },
      { backup: "" },
      { namespace: "velero/demo" },
      { namespace: "" },
    ]) {
      expect(() => syntheticLog({ ...options, ...names, lines: 1000 })).toThrow(
        "A synthetic log needs the names of a backup and a namespace",
      );
    }
    for (const moment of [Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => syntheticLog({ ...options, started: moment, lines: 1000 })).toThrow(
        "The time the fixtures were started is required",
      );
      expect(() => syntheticVolumeInfo(moment)).toThrow("The time the fixtures were started is required");
    }
  });
});
