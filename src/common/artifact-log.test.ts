import { beforeAll, describe, expect, it, vi } from "vitest";
import { entryFields, tabArtifacts, tabExpectations } from "../../e2e/scripts/local-artifacts.mts";
import { fixtureNames, liveBackup, syncedBackups, tabArtifactPaths } from "../../e2e/scripts/local-fixtures.mts";
import { DEMO_NAMESPACE } from "../../e2e/scripts/local-kind.mts";
import {
  cutLine,
  foundPlaces,
  LINE_BOUND,
  LOG_LEVELS,
  lineLength,
  linePieces,
  lineRows,
  logLine,
  parseLog,
  pieceParts,
  rowOf,
  searchLog,
  shownLines,
  textLines,
} from "./artifact-log";
import { missingFile } from "./artifact-text";
import { operationState } from "./phases";

import type { LogLevel } from "./artifact-log";

// Entries as the server of the reviewed release writes them, in its two formats.
const text = (level: string, message: string, fields = 'backup=velero/nightly logSource="pkg/backup/backup.go:1"') =>
  `time="2026-10-04T18:08:23Z" level=${level} msg="${message}" ${fields}`;
const json = (level: string, message: string, more: Record<string, unknown> = {}) =>
  JSON.stringify({ backup: "velero/nightly", ...more, level, msg: message, time: "2026-10-04T18:08:23Z" });

describe("the lines of a log", () => {
  it("numbers the lines as they are written, whatever ends them, and counts no line after the last break", () => {
    const log = parseLog("first\nsecond\r\nthird\n");

    expect(log.starts.length).toBe(3);
    expect([0, 1, 2].map((line) => logLine(log, line))).toEqual(["first", "second", "third"]);
    // A text that does not end with a break has its last line all the same, and an empty text has none.
    expect(parseLog("first\nsecond").starts.length).toBe(2);
    expect(logLine(parseLog("first\nsecond"), 1)).toBe("second");
    expect(parseLog("").starts.length).toBe(0);
    expect(parseLog("\n").starts.length).toBe(1);
    // An empty line between two is a line, with its number.
    expect([0, 1, 2].map((line) => logLine(parseLog("a\n\nb"), line))).toEqual(["a", "", "b"]);
    // The text is the one that was given, and no other copy of it.
    const given = "one\ntwo";

    expect(parseLog(given).text).toBe(given);
    expect(() => logLine(log, 3)).toThrow();
    expect(() => logLine(log, -1)).toThrow();
    // A number that is no whole number is the number of no line: nothing is read between two lines.
    for (const none of [1.5, 0.1, Number.NaN]) expect(() => logLine(log, none)).toThrow(RangeError);
  });

  it("reads the level of an entry of the text format from its start, and nothing from the words of its message", () => {
    const log = parseLog(
      [
        text("error", "Error backing up item"),
        text("warning", "Volume skipped"),
        text("info", "Backing up item"),
        text("debug", "Skipping action"),
        // The words of a message say nothing of the level of its entry.
        text("info", "the entry before was written with level=error by the plugin"),
        'msg="an entry without a time and without a level, which says level=error in its words"',
        "a line that is no entry at all",
        "",
        // A level the release does not write for an operation keeps its line among the others.
        text("fatal", "the server stops"),
        text("trace", "a detail"),
        // An entry written without its time begins with its level.
        'level=warning msg="no time"',
        // What merely begins with the letters of a level is not one.
        text("information", "not a level"),
        // An entry that ends with its level ends where its line does: the next line is another entry.
        "level=debug",
        'time="2026-10-04T18:08:23Z" level=error',
        // A time written without its quotes is a time all the same, and the level follows it.
        'time=2026-10-04T18:08:23Z level=error msg="no quotes around its time"',
        // What follows the time without a space between them is not the level of an entry.
        'time="2026-10-04T18:08:23Z"-level=error msg="no space after its time"',
        'time=2026-10-04T18:08:23Z"level=error msg="a quote in the place of the space"',
        "time= level=error",
        text("info", "the last entry"),
      ].join("\n"),
    );

    expect([...log.levels].map((level) => ["error", "warning", "info", "debug", "other"][level])).toEqual([
      "error",
      "warning",
      "info",
      "debug",
      "info",
      "other",
      "other",
      "other",
      "other",
      "other",
      "warning",
      "other",
      "debug",
      "error",
      "error",
      "other",
      "other",
      "other",
      "info",
    ]);
    expect(log.counts).toEqual({ error: 3, warning: 2, info: 3, debug: 2, other: 9 });
  });

  it("reads the level of an entry whose line ends with a return and a break, as it reads one that ends with a break", () => {
    const entries = [
      json("error", "Error backing up item"),
      text("warning", "Volume skipped"),
      // An entry that ends with its level, and an object that ends its line: the return is of neither.
      "level=debug",
      json("info", "nested", { data: { level: "error" } }),
      "a line that is no entry",
      "",
    ];
    const levels = (log: ReturnType<typeof parseLog>) =>
      [...log.levels].map((level) => ["error", "warning", "info", "debug", "other"][level]);
    const returned = parseLog(`${entries.join("\r\n")}\r\n`);

    expect(levels(returned)).toEqual(["error", "warning", "debug", "info", "other", "other"]);
    expect(levels(returned)).toEqual(levels(parseLog(`${entries.join("\n")}\n`)));
    expect(returned.counts).toEqual({ error: 1, warning: 1, info: 1, debug: 1, other: 2 });
  });

  it("reads the level of an entry of the JSON format from its own key, wherever it is among the others", () => {
    const log = parseLog(
      [
        json("error", "Error backing up item", { "error.message": "boom" }),
        json("warning", "Volume skipped"),
        json("info", "Backing up item"),
        json("debug", "Skipping action"),
        // A message that carries the key in its words, which a JSON text writes with its quotes escaped.
        json("info", 'the entry before said "level":"error"'),
        // A field that is an object with a key of that name, before the key of the entry.
        json("info", "nested", { data: { level: "error" } }),
        // The same, with no key of the entry: the level of the object inside is not the one of the entry.
        JSON.stringify({ data: { level: "error" }, msg: "no level of its own" }),
        // And with a level of the entry that is none of the four: it is no error.
        json("fatal", "nested", { data: { level: "info" } }),
        // What begins as an object and is not one.
        '{"level":"error"',
        // A level that is not a text.
        '{"level":3,"msg":"a number"}',
        "{}",
      ].join("\n"),
    );

    expect([...log.levels].map((level) => ["error", "warning", "info", "debug", "other"][level])).toEqual([
      "error",
      "warning",
      "info",
      "debug",
      "info",
      "info",
      "other",
      "other",
      "other",
      "other",
      "other",
    ]);
    expect(log.counts).toEqual({ error: 1, warning: 1, info: 3, debug: 1, other: 5 });
  });

  it("reads an entry of the JSON format as the JSON it is only when an object is written before its level", () => {
    const parse = vi.spyOn(JSON, "parse");

    try {
      // The level of an entry is found by its key, in the text as it is: a log has an entry for each of
      // its lines, and none of them is parsed to read one word of it.
      const plain = parseLog([json("error", "a"), json("info", "b"), json("debug", "c")].join("\n"));

      expect(plain.counts).toEqual({ error: 1, warning: 0, info: 1, debug: 1, other: 0 });
      expect(parse).not.toHaveBeenCalled();
      // An object before the key may have a key of the same name: that entry is parsed, and no other.
      const nested = parseLog([json("info", "a", { data: { level: "error" } }), json("warning", "b")].join("\n"));

      expect(nested.counts).toEqual({ error: 0, warning: 1, info: 1, debug: 0, other: 0 });
      expect(parse).toHaveBeenCalledTimes(1);
    } finally {
      parse.mockRestore();
    }
  });
});

describe("a text made to be slow to read", () => {
  it("reads lines that open what they never close in the time of any other text of their size", () => {
    // A time that is never closed, on every line of a long text: what would close it is the next quote of
    // the text, which is never further than the next line that opens one, so each line costs what it is.
    const open = 'time="2026-10-04T18:08:23Z level=error\n'.repeat(400_000);
    const start = performance.now();
    const log = parseLog(open);

    expect(performance.now() - start).toBeLessThan(2_000);
    expect(log.counts).toEqual({ error: 0, warning: 0, info: 0, debug: 0, other: 400_000 });
    // One such line, and nothing but lines without a quote after it: the text is looked through once.
    const once = parseLog(`time="never closed\n${"level=info plain\n".repeat(400_000)}`);

    expect(once.counts).toEqual({ error: 0, warning: 0, info: 400_000, debug: 0, other: 1 });
    // An object that is never closed, and one that has no level, on every line.
    expect(parseLog('{"msg":"no level, and no end"\n'.repeat(400_000)).counts.other).toBe(400_000);
  }, 20_000);
});

describe("the lines a filter by level leaves", () => {
  const log = parseLog(
    [text("info", "a"), text("error", "b"), "c", text("warning", "d"), text("error", "e"), text("debug", "f")].join(
      "\n",
    ),
  );

  it("hides no line until a level is chosen", () => {
    expect(shownLines(log, new Set())).toBeUndefined();
    expect(shownLines(log, undefined)).toBeUndefined();
  });

  it("leaves the lines of the levels that were chosen, in their order", () => {
    expect([...(shownLines(log, new Set(["error"])) ?? [])]).toEqual([1, 4]);
    expect([...(shownLines(log, new Set(["error", "warning"])) ?? [])]).toEqual([1, 3, 4]);
    expect([...(shownLines(log, new Set(["other"])) ?? [])]).toEqual([2]);
    // Every level chosen is every line, by a list of its own.
    expect([...(shownLines(log, new Set(["error", "warning", "info", "debug", "other"])) ?? [])]).toEqual([
      0, 1, 2, 3, 4, 5,
    ]);
    expect([...(shownLines(parseLog(text("info", "a")), new Set(["error"])) ?? [1])]).toEqual([]);
  });
});

describe("the search of a log", () => {
  const log = parseLog(
    [
      text("info", "Backing up item"),
      text("error", "Error backing up item: BACKING store refused"),
      "nothing of it here",
      text("warning", "a.c is not abc"),
      text("info", "backing BACKING backing"),
    ].join("\n"),
  );

  it("finds the lines that carry the words, whatever their capitals, each line once", () => {
    expect([...searchLog(log, "backing")]).toEqual([0, 1, 4]);
    expect([...searchLog(log, "BACKING UP")]).toEqual([0, 1]);
    expect([...searchLog(log, "store refused")]).toEqual([1]);
    expect([...searchLog(log, "no such words")]).toEqual([]);
  });

  it("takes the words as they are typed, and no pattern from them", () => {
    expect([...searchLog(log, "a.c")]).toEqual([3]);
    expect([...searchLog(log, ".*")]).toEqual([]);
    expect([...searchLog(log, "item:")]).toEqual([1]);
    expect([...searchLog(parseLog("a (b) [c] {d} ^e$ f|g h\\i j+k? l*"), "(b) [c] {d} ^e$ f|g h\\i j+k? l*")]).toEqual([
      0,
    ]);
  });

  it("finds nothing for no words, and for words no line can carry", () => {
    expect([...searchLog(log, "")]).toEqual([]);
    expect([...searchLog(log, "item\ntime")]).toEqual([]);
    expect([...searchLog(parseLog(""), "a")]).toEqual([]);
    // Words that hold a break are the words of no line, even where the text has them across two lines.
    const broken = parseLog("first words\r\nmiddle\nlast words");

    for (const words of ["words\r\nmiddle", "middle\nlast", "\n", "\r", "words\r"])
      expect([words, [...searchLog(broken, words)]]).toEqual([words, []]);
    expect([...searchLog(broken, "words")]).toEqual([0, 2]);
  });

  it("looks among the lines a filter leaves, and nowhere else", () => {
    expect([...searchLog(log, "backing", new Set(["error"]))]).toEqual([1]);
    expect([...searchLog(log, "backing", new Set(["info", "warning"]))]).toEqual([0, 4]);
    expect([...searchLog(log, "backing", new Set(["debug"]))]).toEqual([]);
    expect([...searchLog(log, "backing", new Set())]).toEqual([0, 1, 4]);
  });

  it("finds words at the very start and at the very end of the text", () => {
    const edges = parseLog("first words\nmiddle\nlast words");

    expect([...searchLog(edges, "first")]).toEqual([0]);
    expect([...searchLog(edges, "words")]).toEqual([0, 2]);
    expect([...searchLog(edges, "last words")]).toEqual([2]);
  });

  it("says where the words are in what a row shows of a line, every place of them, whatever their capitals", () => {
    // Each place by where it begins and where it ends, in their order, none over another.
    expect(foundPlaces("backing BACKING backing", "backing")).toEqual([
      [0, 7],
      [8, 15],
      [16, 23],
    ]);
    expect(foundPlaces("first words", "first")).toEqual([[0, 5]]);
    expect(foundPlaces("last words", "words")).toEqual([[5, 10]]);
    // A place begins after the one before it ended: words that would lie over themselves are found once.
    expect(foundPlaces("aaaa", "aa")).toEqual([
      [0, 2],
      [2, 4],
    ]);
    // The words are taken as they are typed, as the search takes them, and no pattern is read from them.
    expect(foundPlaces("a.c is not abc", "a.c")).toEqual([[0, 3]]);
    expect(foundPlaces("a (b) [c]", "(b) [c]")).toEqual([[2, 9]]);
    expect(foundPlaces("anything at all", ".*")).toEqual([]);
    // Nothing for no words, for words no line can carry, and for a line that does not carry them.
    expect(foundPlaces("backing", "")).toEqual([]);
    expect(foundPlaces("item time", "item\ntime")).toEqual([]);
    expect(foundPlaces("nothing of it here", "backing")).toEqual([]);
    expect(foundPlaces("", "backing")).toEqual([]);
    // A line the search finds has a place of the words, and a line it does not find has none.
    for (let line = 0; line < log.starts.length; line += 1) {
      expect([line, foundPlaces(logLine(log, line), "BACKING").length > 0]).toEqual([
        line,
        [...searchLog(log, "BACKING")].includes(line),
      ]);
    }
  });

  it("cuts a piece of a line in the parts the places of the words make of it, and loses nothing of it", () => {
    const whole = [{ text: "abcdef", found: false }];

    // No place, and places that are before the piece or after it: the piece is one part.
    expect(pieceParts("abcdef", 0, [])).toEqual(whole);
    expect(pieceParts("abcdef", 10, [[2, 5]])).toEqual(whole);
    expect(pieceParts("abcdef", 0, [[6, 9]])).toEqual(whole);
    expect(pieceParts("abcdef", 0, [[1, 3]])).toEqual([
      { text: "a", found: false },
      { text: "bc", found: true },
      { text: "def", found: false },
    ]);
    expect(
      pieceParts("abcdef", 0, [
        [0, 2],
        [2, 3],
        [5, 6],
      ]),
    ).toEqual([
      { text: "ab", found: true },
      { text: "c", found: true },
      { text: "de", found: false },
      { text: "f", found: true },
    ]);
    // Words that go from a piece of a wrapped line to the next are found in both, each with its part.
    expect(pieceParts("abc", 0, [[2, 5]])).toEqual([
      { text: "ab", found: false },
      { text: "c", found: true },
    ]);
    expect(pieceParts("def", 3, [[2, 5]])).toEqual([
      { text: "de", found: true },
      { text: "f", found: false },
    ]);
    // Words that end where a piece begins are of the piece before it alone: they leave no part in this one.
    expect(pieceParts("def", 3, [[1, 3]])).toEqual([{ text: "def", found: false }]);
    expect(
      pieceParts("def", 3, [
        [1, 3],
        [4, 5],
      ]),
    ).toEqual([
      { text: "d", found: false },
      { text: "e", found: true },
      { text: "f", found: false },
    ]);
    // The piece of an empty line is one part that holds nothing.
    expect(pieceParts("", 0, [[0, 2]])).toEqual([{ text: "", found: false }]);
    // The parts of the pieces of a line are the line, whatever the columns and wherever the words are.
    const line = text("info", "backing BACKING backing");
    const places = foundPlaces(line, "backing");

    for (const columns of [undefined, 1, 5, 7, 64]) {
      let from = 0;
      const parts = linePieces(line, columns).flatMap((piece) => {
        const cut = pieceParts(piece, from, places);

        from += piece.length;
        return cut;
      });

      expect([columns, parts.map((part) => part.text).join("")]).toEqual([columns, line]);
      expect([
        columns,
        parts
          .filter((part) => part.found)
          .map((part) => part.text)
          .join("")
          .toLowerCase(),
      ]).toEqual([columns, "backingbackingbacking"]);
    }
  });
});

describe("a line longer than a row shows", () => {
  it("is cut in its row at the bound, with how much was left out, and is whole where it is copied", () => {
    const long = `${text("info", "x".repeat(20_000))}`;
    const log = parseLog(`short\n${long}\nshort again`);
    const whole = logLine(log, 1);

    expect(whole).toBe(long);
    expect(whole.length).toBeGreaterThan(20_000);
    expect(cutLine(whole)).toEqual({ text: whole.slice(0, LINE_BOUND), left: whole.length - LINE_BOUND });
    expect(LINE_BOUND).toBe(10_000);
    // A line within the bound, and one of exactly the bound, are shown whole.
    expect(cutLine("short")).toEqual({ text: "short", left: 0 });
    expect(cutLine("y".repeat(LINE_BOUND))).toEqual({ text: "y".repeat(LINE_BOUND), left: 0 });
    expect(cutLine("y".repeat(LINE_BOUND + 1)).left).toBe(1);
    // A character written as two halves is not cut between them at the bound: it is left out whole, and
    // what is shown ends before it.
    const pair = "\u{1F600}";

    expect(cutLine(`${"z".repeat(LINE_BOUND - 1)}${pair}tail`)).toEqual({
      text: "z".repeat(LINE_BOUND - 1),
      left: pair.length + 4,
    });
    expect(cutLine(`${"z".repeat(LINE_BOUND - 2)}${pair}tail`)).toEqual({
      text: `${"z".repeat(LINE_BOUND - 2)}${pair}`,
      left: 4,
    });
  });
});

describe("the lines of a text that is no log", () => {
  it("are the ones of a log, where each begins, and no level is read from them", () => {
    const given = 'first\nsecond\r\n\n{"level":"error"}\nlast';
    const lines = textLines(given);

    expect([...lines.starts]).toEqual([...parseLog(given).starts]);
    expect([0, 1, 2, 3, 4].map((line) => logLine(lines, line))).toEqual([
      "first",
      "second",
      "",
      '{"level":"error"}',
      "last",
    ]);
    // The text is the one that was given, and nothing but where its lines begin is beside it.
    expect(lines.text).toBe(given);
    expect(Object.keys(lines).sort()).toEqual(["starts", "text"]);
    expect(textLines("").starts.length).toBe(0);
    expect(textLines("\n").starts.length).toBe(1);
    expect(textLines("one\ntwo\n").starts.length).toBe(2);
  });

  it("reads a text of one long line that would be an entry without reading it as one", () => {
    // An object of another shape on one line, with a key of the name of the level inside another: read as
    // the entry of a log it is parsed whole, whatever its size.
    const one = `{"data":{"level":"error"},"items":[${'"item",'.repeat(1_000)}"last"],"level":"info"}`;
    const parse = vi.spyOn(JSON, "parse");

    try {
      const lines = textLines(one);

      expect(parse).not.toHaveBeenCalled();
      expect(lines.starts.length).toBe(1);
      expect(lineLength(lines, 0)).toBe(one.length);
      expect(parseLog(one).counts.info).toBe(1);
      expect(parse).toHaveBeenCalledTimes(1);
    } finally {
      parse.mockRestore();
    }
  });
});

describe("the length of a line", () => {
  it("is the one of its text, counted without making the text", () => {
    for (const given of ["first\nsecond\r\nthird\n", "a\n\nb", "one", "\n", "ends with a return\r", "\r\n\r\n"]) {
      const lines = textLines(given);

      for (let line = 0; line < lines.starts.length; line += 1)
        expect([given, line, lineLength(lines, line)]).toEqual([given, line, logLine(lines, line).length]);
    }
    expect(() => lineLength(textLines("one"), 1)).toThrow();
    expect(() => lineLength(textLines("one"), -1)).toThrow();
    expect(() => lineLength(textLines("one\ntwo"), 0.5)).toThrow(RangeError);
  });
});

describe("the rows a line takes on the screen", () => {
  it("is one row when the lines are not wrapped, and one more for a line that is cut", () => {
    const lines = textLines(`short\n\n${"x".repeat(LINE_BOUND)}\n${"y".repeat(LINE_BOUND + 1)}`);

    expect([0, 1, 2, 3].map((line) => lineRows(lines, line))).toEqual([1, 1, 1, 2]);
    expect(linePieces("short")).toEqual(["short"]);
    expect(linePieces("")).toEqual([""]);
  });

  it("is one row for each piece of so many characters when they are wrapped, an empty line being one row", () => {
    const lines = textLines(`${"a".repeat(10)}\n${"b".repeat(11)}\n\n${"c".repeat(30)}\nd`);

    expect([0, 1, 2, 3, 4].map((line) => lineRows(lines, line, 10))).toEqual([1, 2, 1, 3, 1]);
    expect(linePieces("b".repeat(11), 10)).toEqual(["b".repeat(10), "b"]);
    expect(linePieces("abcdefg", 3)).toEqual(["abc", "def", "g"]);
    expect(linePieces("abcdefg", 1)).toEqual(["a", "b", "c", "d", "e", "f", "g"]);
    expect(linePieces("", 10)).toEqual([""]);
    // A number of columns that is none wraps nothing.
    for (const none of [0, -3, Number.NaN, undefined]) {
      expect(linePieces("abcdefg", none)).toEqual(["abcdefg"]);
      expect(lineRows(lines, 3, none)).toBe(1);
    }
    // A part of a column is no column.
    expect(linePieces("abcdefg", 3.9)).toEqual(["abc", "def", "g"]);
    expect(lineRows(lines, 3, 10.5)).toBe(3);
  });

  it("does not break a character written as two halves, and counts the rows of the pieces it makes", () => {
    const pair = "\u{1F600}";

    expect(linePieces(`ab${pair}cd`, 3)).toEqual(["ab", `${pair}c`, "d"]);
    expect(linePieces(`${pair}${pair}`, 1)).toEqual([pair, pair]);
    expect(linePieces(`a${pair}`, 2)).toEqual(["a", pair]);
    // Whatever the line and the columns, the rows counted are the pieces made of what the row shows of
    // the line, and one more when the line is cut; and the pieces are the line, in their order.
    const samples = [
      "",
      "plain",
      `${pair}`.repeat(40),
      `x${pair}`.repeat(33),
      `${"z".repeat(LINE_BOUND - 1)}${pair}tail`,
      "w".repeat(LINE_BOUND * 2 + 7),
      `${pair}`.repeat(LINE_BOUND),
    ];
    const lines = textLines(samples.join("\n"));

    for (const columns of [1, 2, 3, 7, 80, 120, LINE_BOUND, LINE_BOUND + 5]) {
      samples.forEach((sample, line) => {
        const shown = cutLine(logLine(lines, line));
        const pieces = linePieces(shown.text, columns);

        expect(pieces.join("")).toBe(shown.text);
        expect([columns, line, lineRows(lines, line, columns)]).toEqual([
          columns,
          line,
          pieces.length + (shown.left ? 1 : 0),
        ]);
        for (const piece of pieces) expect(piece.length).toBeLessThanOrEqual(columns + 1);
        expect(lineLength(lines, line)).toBe(sample.length);
      });
    }
  });
});

describe("the row of a line", () => {
  it("is the line itself while no line is hidden", () => {
    expect([0, 7, 499_999].map((line) => rowOf(undefined, line))).toEqual([0, 7, 499_999]);
  });

  it("is its place among the lines a filter leaves, the one of the next line left, and the last after them all", () => {
    const shown = Uint32Array.from([2, 5, 6, 40]);

    expect([2, 5, 6, 40].map((line) => rowOf(shown, line))).toEqual([0, 1, 2, 3]);
    expect([0, 1, 3, 4, 7, 39].map((line) => rowOf(shown, line))).toEqual([0, 0, 1, 1, 3, 3]);
    expect([41, 1_000].map((line) => rowOf(shown, line))).toEqual([3, 3]);
    // No line is left: there is no row.
    expect(rowOf(new Uint32Array(0), 3)).toBe(-1);
  });
});

// What the code answers of a long log, a long line among its entries. Its times are not taken here: the
// measure of the unit tests takes them, in test/artifact-log.measure.ts, once the other tests ended and alone.
describe("a log of five hundred thousand lines", { timeout: 60_000 }, () => {
  // The level of the entry of each place: entries of every level, and of several lengths.
  const levelAt = (index: number) =>
    index % 97 === 0 ? "error" : index % 13 === 0 ? "warning" : index % 5 === 0 ? "debug" : "info";
  const make = () => {
    const lines: string[] = [];

    for (let index = 0; index < 500_000; index += 1) {
      lines.push(
        text(
          levelAt(index),
          index % 50_000 === 0 ? `a long entry ${"z".repeat(12_000)}` : `Backed up item ${index} of the namespace`,
          `backup=velero/large name=item-${index} namespace=ns-${index % 40} logSource="pkg/backup/item_backupper.go:${index % 900}"`,
        ),
      );
    }
    return lines.join("\n");
  };
  let large: string;

  // Made once, when the cases of this part begin and not when the file is read.
  beforeAll(() => {
    large = make();
  }, 60_000);

  it("is read, filtered and searched: each line at its level, the lines of the levels chosen, and of the words", () => {
    const log = parseLog(large);
    const chosen = Array.from({ length: 500_000 }, (_, index) => index).filter((index) =>
      ["error", "warning"].includes(levelAt(index)),
    );

    expect(log.starts.length).toBe(500_000);
    expect(log.counts.error).toBe(Math.ceil(500_000 / 97));
    expect(log.counts.error + log.counts.warning + log.counts.info + log.counts.debug).toBe(500_000);
    expect([...(shownLines(log, new Set(["error", "warning"])) ?? [])]).toEqual(chosen);
    // Words every line carries but the ten long ones, words one line carries, and words none does; and words
    // among the errors, which every error carries but the long entry of the first line.
    expect(searchLog(log, "backed up item").length).toBe(500_000 - 10);
    expect(searchLog(log, "ITEM-499999").length).toBe(1);
    expect(searchLog(log, "words that are in no line").length).toBe(0);
    expect(searchLog(log, "backed up item", new Set(["error"])).length).toBe(Math.ceil(500_000 / 97) - 1);
  });

  // What a list of its lines is built from: the rows of every line, wrapped and not, and the lines of a
  // text that is read without its levels.
  it("has the rows of its lines counted, wrapped and not, and its lines read as a text without levels", () => {
    const log = parseLog(large);
    const rows = (columns?: number) => {
      let sum = 0;

      for (let line = 0; line < log.starts.length; line += 1) sum += lineRows(log, line, columns);
      return sum;
    };
    // The rows a plain reading of the lines counts: a row for each piece of what a row shows of a line, and
    // one more for a line that is cut.
    const plain = (columns: number) =>
      large
        .split("\n")
        .reduce(
          (sum, line) =>
            sum +
            Math.max(1, Math.ceil(Math.min(line.length, LINE_BOUND) / columns)) +
            (line.length > LINE_BOUND ? 1 : 0),
          0,
        );

    // Ten lines are cut, and have the row that says so.
    expect(rows()).toBe(500_000 + 10);
    expect(rows(120)).toBeGreaterThan(500_000 * 2);
    expect([rows(120), rows(40)]).toEqual([plain(120), plain(40)]);
    expect(textLines(large).starts.length).toBe(500_000);
  });
});

// The log the fixtures give the store for the first of the two backups its sync creates, made as the fixtures
// make it. The generator counted its facts while it wrote it, by a reading of its own: the parser finds them in
// the text.
describe("the log of the backup the store is given for the tabs", { timeout: 60_000 }, () => {
  const run = "a1b2c3d4";
  const started = Date.parse("2026-10-05T10:00:00.000Z");
  const make = () => {
    const artifacts = tabArtifacts({ backup: fixtureNames(run).syncedBackup, namespace: DEMO_NAMESPACE, started });

    return { artifacts, content: artifacts.log.text, facts: artifacts.log.facts, log: parseLog(artifacts.log.text) };
  };
  let fixture: ReturnType<typeof make>;
  // The numbers of the lines the parser read at a level, and of the entries the generator wrote at it, from one.
  const read = (level: LogLevel) =>
    [...fixture.log.levels].flatMap((place, index) => (LOG_LEVELS[place] === level ? [index + 1] : []));
  const written = (level: "error" | "warning") =>
    fixture.facts.entries.filter((entry) => entry.level === level).map((entry) => entry.line);

  // Made once, when the cases of this part begin and not when the file is read: the cases before them, some of
  // which are timed, run with nothing of a log of two hundred thousand lines held.
  beforeAll(() => {
    fixture = make();
  }, 60_000);

  it("has the lines and the levels the generator counted, the errors and the warnings at the lines of their entries", () => {
    const { facts, log } = fixture;

    expect(log.starts.length).toBe(facts.lines);
    expect(log.counts).toEqual(facts.levels);
    expect([read("error"), read("warning")]).toEqual([written("error"), written("warning")]);
    // The two levels, chosen, leave those lines and no other.
    expect([...(shownLines(log, new Set(["error", "warning"])) ?? [])].map((line) => line + 1)).toEqual(
      facts.entries.map((entry) => entry.line),
    );
    // Each line and its break are the text, to the character.
    let characters = 0;

    for (let line = 0; line < log.starts.length; line += 1) characters += lineLength(log, line) + 1;
    expect(characters).toBe(facts.characters);
  });

  it("reads no level from the words of a line, where the generator wrote the words of one", () => {
    const { facts, log } = fixture;
    const within = (words: string, level: LogLevel) => searchLog(log, words, new Set([level])).length;

    // Entries at info whose message says `level=error`, and lines that are no entry and say `level=error` or
    // `level=warning`: the first are read at info, the others at no level.
    expect(
      [facts.levelInMessage.line, facts.levelInFreeText.line].map((number) => LOG_LEVELS[log.levels[number - 1]]),
    ).toEqual(["info", "other"]);
    expect(within("level=error", "info")).toBe(facts.levelInMessage.lines);
    expect(within("level=error", "other") + within("level=warning", "other")).toBe(facts.levelInFreeText.lines);
    expect([within("level=error", "error"), within("level=warning", "warning")]).toEqual([
      facts.levels.error,
      facts.levels.warning,
    ]);
  });

  it("finds the texts the suites search for in as many lines as the generator counted, whatever their capitals", () => {
    const { facts, log } = fixture;

    expect(facts.searches.map((search) => [search.text, searchLog(log, search.text).length])).toEqual(
      facts.searches.map((search) => [search.text, search.matches]),
    );
  });

  it("cuts in their rows the long lines the generator wrote, and keeps each whole for a copy", () => {
    const { facts, log } = fixture;
    const long = [facts.long.twentyThousand, facts.long.tenThousand, facts.long.tenThousandAndOne].map(
      (number) => number - 1,
    );

    expect(long.map((line) => lineLength(log, line))).toEqual([20_000, 10_000, 10_001]);
    expect(long.map((line) => cutLine(logLine(log, line)).left)).toEqual([20_000 - LINE_BOUND, 0, 1]);
    // A row for what is shown of each, and one more for the words that say how much of it was left out.
    expect(long.map((line) => lineRows(log, line))).toEqual([2, 1, 2]);
    // The line the first page of the text ends inside is one line, with its character whole.
    expect(logLine(log, facts.boundaryLine - 1)).toMatch(
      /\u2192 is a character of three bytes, across the end of the first page$/,
    );
  });

  it("reads the levels of its entries written in the JSON format of the server, the error under error.message", () => {
    const { content, facts } = fixture;
    const lines = content.split("\n");
    // The first lines of the log, its entries at error and at warning, an entry at info that says another level
    // in its message and a line that is no entry, written as the server writes them when it is started with the
    // JSON format: one object a line, of the fields of the entry, the text of an error under `error.message`.
    // Where the logging library puts each key was not read: here they are in the order of their names, as Go
    // writes a map in JSON, which puts the backup and the error before the level. A line that is no entry is
    // kept as it is.
    const numbers = [
      ...Array.from({ length: 200 }, (_, index) => index + 1),
      ...facts.entries.map((entry) => entry.line),
      facts.levelInMessage.line,
      facts.levelInFreeText.line,
    ];
    const json = numbers.map((number) => {
      const line = lines[number - 1];
      const fields = entryFields(line);

      if (fields[0]?.[0] !== "time") return { line, level: "other" };
      const named = fields.map(([key, value]): [string, string] => [key === "error" ? "error.message" : key, value]);

      named.sort(([one], [other]) => (one < other ? -1 : one > other ? 1 : 0));
      return { line: JSON.stringify(Object.fromEntries(named)), level: new Map(fields).get("level") };
    });
    const parsed = parseLog(`${json.map((entry) => entry.line).join("\n")}\n`);

    expect([...parsed.levels].map((place) => LOG_LEVELS[place])).toEqual(json.map((entry) => entry.level));
    expect(parsed.counts.error + parsed.counts.warning).toBe(facts.entries.length);
    // The entries that carry an error carry it there, and under no key of the text format.
    expect(json.filter((entry) => entry.line.includes('"error.message":"')).length).toBe(
      facts.entries.filter((entry) => entry.error !== undefined).length,
    );
    expect(json.filter((entry) => entry.line.includes('"error":')).length).toBe(0);
  });

  it("has none for the second backup the store is given, which the tab says by the phase the fixtures give it", () => {
    const owner = "synthetic-owner";
    const like = { ...liveBackup(owner, run), status: { phase: "Completed" } };
    const { withoutLog } = syncedBackups(owner, run, started, like, tabExpectations(fixture.artifacts));
    const { phase } = withoutLog.status as { phase?: string };
    const paths = tabArtifactPaths(run);

    expect([Object.keys(paths.synced).includes("log"), Object.keys(paths.withoutLog).includes("log")]).toEqual([
      true,
      false,
    ]);
    expect(phase).toBe("Completed");
    expect(missingFile("log", "Backup", operationState("Backup", phase))).toContain(
      "Velero uploads the log of a backup as best it can, and a backup ends without it when the upload fails.",
    );
  });
});
