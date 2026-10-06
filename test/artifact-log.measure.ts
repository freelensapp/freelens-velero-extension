import { describe, expect, it } from "vitest";
import { logFacts, syntheticLog } from "../e2e/scripts/local-artifacts.mts";
import {
  LINE_BOUND,
  LOG_LEVELS,
  lineRows,
  parseLog,
  searchLog,
  shownLines,
  textLines,
} from "../src/common/artifact-log";

import type { TextLines } from "../src/common/artifact-log";

// The measure of the unit tests of a log, on half a million lines: the parser, the search, the filter by
// level, the search among the lines a filter leaves, the rows of a list of the lines, wrapped and not, and the
// lines of a text read without its levels. Each series is of twenty calls after five that warm it, as the
// measures of the packaged application take theirs, and answers within the budget at its 95th percentile.
// No other test times them: this file is run by its own configuration, once the other tests ended and alone.
//
// The budget is the one of an interaction. A level that is chosen is answered by the lines the filter leaves
// and by the rows of a list of them; the choice to wrap the lines, and a room of another width, by the rows
// as well, which a list counts then and not while it is scrolled. The lines of a text that is no log are
// read once, when it is loaded, as a log is read by the parser.
const BUDGET = 250;
const LINES = 500_000;
// The bound of the text of an artifact: what is measured is a text the tab can be given.
const ARTIFACT_BOUND = 64 * 1024 ** 2;
const WARM = 5;
const MEASURED = 20;
// The columns a list of the lines is counted in: none, which wraps nothing, the room of a wide window, and
// a narrow one.
const WIDTHS = [undefined, 120, 40] as const;
// Every choice of levels but the one of none, each the levels of a number in their order: the single levels
// and the pairs come first, the choices of four levels and of every level last.
const CHOICES = Array.from({ length: 2 ** LOG_LEVELS.length - 1 }, (_, index) =>
  LOG_LEVELS.filter((_, place) => ((index + 1) >> place) & 1),
);

// The percentile of the measures of the packaged application: of twenty times, the 95th leaves the slowest
// out, and no other.
function percentile(values: number[], fraction: number): number {
  const sorted = [...values].sort((one, other) => one - other);

  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
}

// The time of one call, from just before it to just after it, and what it answered.
function timed<Value>(call: () => Value): { ms: number; value: Value } {
  const start = performance.now();
  const value = call();

  return { ms: performance.now() - start, value };
}

const tenths = (ms: number) => Math.round(ms * 10) / 10;

function series(times: number[]) {
  return {
    p95: tenths(percentile(times, 0.95)),
    median: tenths(percentile(times, 0.5)),
    slowest: tenths(Math.max(...times)),
  };
}

// The rows of every line of a list that holds them all, as a list counts them when it is given its lines.
function rowsOf(lines: TextLines, columns?: number): number {
  let sum = 0;

  for (let line = 0; line < lines.starts.length; line += 1) sum += lineRows(lines, line, columns);
  return sum;
}

describe("a log of half a million lines", { timeout: 300_000 }, () => {
  // The log of the fixtures in its brief form, whose lines are shorter, so that half a million of them are the
  // text of one artifact. It is made once, with what its generator counted while it wrote it; it has the long
  // lines of the log of the fixtures, of 20,000, 10,000 and 10,001 characters.
  const { text, facts } = syntheticLog({
    backup: "synthetic",
    namespace: "velero",
    started: Date.parse("2031-03-09T23:59:59.321Z"),
    lines: LINES,
    brief: true,
  });
  const of = (use: string) => facts.searches.filter((search) => search.use === use).map((search) => search.text);
  // The texts the generator gives a search beside the ones of the content of the tab, and more, read in the log
  // as it is: the lines that are no entry, a file the entries say they were written from, a second, a minute
  // and an hour of the work, a character of three bytes of the lines that are no entry, the key of that file
  // in other capitals than the log writes it, and the function an error was made in, whose marks are no
  // pattern.
  const more = {
    warm: ["synthetic line that is not an entry", "pkg/synthetic/finalizer.go", 'time="2030-02-03T01:30:'],
    measured: [
      'time="2030-02-03T00:30:00Z"',
      'time="2030-02-03T01:00:',
      'time="2030-02-03T01:',
      "€",
      "logsource=",
      "synthetic.(*pluginWorker).run",
    ],
  };
  const warm = [...of("warm"), ...more.warm];
  const measured = [...of("measured"), ...of("content"), ...more.measured];
  // The choices that warm the filter are the five that leave the most lines; the ones that are measured are
  // twenty others, none chosen before, each level alone among them.
  const choices = { warm: CHOICES.slice(-WARM), measured: CHOICES.slice(0, MEASURED) };

  it("is parsed, searched, filtered and counted in rows, every series within the budget", () => {
    const warmParses = Array.from({ length: WARM }, () => timed(() => parseLog(text)).ms);
    // A measured parse keeps its counts and nothing else: no line of it is held while the others are timed.
    const parses = Array.from({ length: MEASURED }, () => {
      const { ms, value } = timed(() => parseLog(text));

      return { ms, counts: value.counts };
    });
    // What is searched, filtered and counted is of one more parse, which is not timed.
    const log = parseLog(text);
    const warmSearches = warm.map((words) => ({ text: words, ms: timed(() => searchLog(log, words)).ms }));
    const searches = measured.map((words) => {
      const { ms, value } = timed(() => searchLog(log, words));

      return { text: words, lines: value.length, ms };
    });
    // Each choice of levels keeps how many lines it leaves, and whether they are in their order, each of a level
    // that was chosen: read once its time was taken, and before the next choice is timed.
    const warmFilters = choices.warm.map((levels) => ({
      levels: levels.join("+"),
      ms: timed(() => shownLines(log, new Set(levels))).ms,
    }));
    const filters = choices.measured.map((levels) => {
      const { ms, value } = timed(() => shownLines(log, new Set(levels)));
      const places = new Set(levels.map((level) => LOG_LEVELS.indexOf(level)));
      let ordered = value !== undefined;

      for (let at = 0; ordered && value && at < value.length; at += 1) {
        ordered = places.has(log.levels[value[at]]) && (at === 0 || value[at] > value[at - 1]);
      }
      return { levels: levels.join("+"), lines: value?.length, ordered, ms };
    });
    // Each text among the lines of a choice of levels: the warm texts with the warm choices, and the measured
    // ones each with a measured choice.
    const warmAmong = warm.map((words, index) => ({
      text: words,
      levels: choices.warm[index].join("+"),
      ms: timed(() => searchLog(log, words, new Set(choices.warm[index]))).ms,
    }));
    const among = measured.map((words, index) => {
      const levels = choices.measured[index];
      const { ms, value } = timed(() => searchLog(log, words, new Set(levels)));

      return { text: words, levels: levels.join("+"), lines: value.length, ms };
    });
    // The rows of the lines at each width, twenty times after five.
    const rows = WIDTHS.map((columns) => {
      const warmed = Array.from({ length: WARM }, () => timed(() => rowsOf(log, columns)).ms);
      const counted = Array.from({ length: MEASURED }, () => timed(() => rowsOf(log, columns)));

      return { columns, warm: warmed, counted };
    });
    // A measured reading of the text without its levels keeps how many lines it has, and where its last line
    // begins.
    const warmTexts = Array.from({ length: WARM }, () => timed(() => textLines(text)).ms);
    const texts = Array.from({ length: MEASURED }, () => {
      const { ms, value } = timed(() => textLines(text));

      return { ms, lines: value.starts.length, last: value.starts.at(-1) };
    });
    const report = {
      lines: log.starts.length,
      bytes: Buffer.byteLength(text),
      budget: BUDGET,
      parse: {
        ...series(parses.map((parse) => parse.ms)),
        warm: warmParses.map(tenths),
        times: parses.map((parse) => tenths(parse.ms)),
      },
      search: {
        ...series(searches.map((search) => search.ms)),
        warm: warmSearches.map((search) => ({ text: search.text, ms: tenths(search.ms) })),
        times: searches.map((search) => ({ text: search.text, lines: search.lines, ms: tenths(search.ms) })),
      },
      filter: {
        ...series(filters.map((filter) => filter.ms)),
        warm: warmFilters.map((filter) => ({ levels: filter.levels, ms: tenths(filter.ms) })),
        times: filters.map((filter) => ({ levels: filter.levels, lines: filter.lines, ms: tenths(filter.ms) })),
      },
      searchAmongLevels: {
        ...series(among.map((search) => search.ms)),
        warm: warmAmong.map((search) => ({ text: search.text, levels: search.levels, ms: tenths(search.ms) })),
        times: among.map((search) => ({
          text: search.text,
          levels: search.levels,
          lines: search.lines,
          ms: tenths(search.ms),
        })),
      },
      rows: rows.map(({ columns, warm: warmed, counted }) => ({
        columns: columns ?? "not wrapped",
        rows: counted[0].value,
        ...series(counted.map((count) => count.ms)),
        warm: warmed.map(tenths),
        times: counted.map((count) => tenths(count.ms)),
      })),
      textLines: {
        ...series(texts.map((read) => read.ms)),
        warm: warmTexts.map(tenths),
        times: texts.map((read) => tenths(read.ms)),
      },
    };

    // Written before anything is asserted, so that a run that fails leaves its numbers.
    console.log(`VIEW-10 unit ${JSON.stringify(report)}`);
    // Half a million lines, which are the text of one artifact.
    expect([facts.lines, report.lines]).toEqual([LINES, LINES]);
    expect(report.bytes).toBeLessThan(ARTIFACT_BOUND);
    // Twenty texts after five, each one no search before it was of, whatever its capitals; and twenty choices
    // of levels after five, each one no choice before it was.
    expect([warm.length, measured.length]).toEqual([WARM, MEASURED]);
    expect(new Set([...warm, ...measured].map((words) => words.toLowerCase())).size).toBe(WARM + MEASURED);
    expect([choices.warm.length, choices.measured.length]).toEqual([WARM, MEASURED]);
    expect(new Set([...choices.warm, ...choices.measured].map((levels) => levels.join("+"))).size).toBe(
      WARM + MEASURED,
    );
    expect(LOG_LEVELS.every((level) => choices.measured.some((levels) => levels.join("+") === level))).toBe(true);
    // What was timed answered what the generator wrote: the levels it counted, and the lines of each text, which
    // for the texts it does not give a search are the ones a plain reading of the log counts, once nothing is
    // timed.
    const counts = new Map<string, number>([
      ...facts.searches.map((search): [string, number] => [search.text, search.matches]),
      ...logFacts(text, more.measured).found.map((found): [string, number] => [found.text, found.lines]),
    ]);

    expect(parses.filter((parse) => JSON.stringify(parse.counts) !== JSON.stringify(facts.levels))).toEqual([]);
    expect(searches.map((search) => [search.text, search.lines])).toEqual(
      measured.map((words) => [words, counts.get(words)]),
    );
    // A choice of levels leaves as many lines as the generator wrote at them, in their order, each of a level
    // that was chosen.
    expect(filters.map((filter) => [filter.levels, filter.lines, filter.ordered])).toEqual(
      choices.measured.map((levels) => [
        levels.join("+"),
        levels.reduce((sum, level) => sum + facts.levels[level], 0),
        true,
      ]),
    );
    // A text among the lines of a choice is found in the lines the search finds of it whose level is chosen.
    expect(among.map((search) => [search.text, search.levels, search.lines])).toEqual(
      measured.map((words, index) => {
        const chosen = new Set(choices.measured[index].map((level) => LOG_LEVELS.indexOf(level)));

        return [
          words,
          choices.measured[index].join("+"),
          [...searchLog(log, words)].filter((line) => chosen.has(log.levels[line])).length,
        ];
      }),
    );
    // The rows a plain reading of the lines counts: one for each piece of the room of what a row shows of a
    // line, the line or its first ten thousand characters, and one more for a line that is cut. Its lines have
    // no character written as two halves, which a row does not cut, and no return before their breaks. Two of
    // them are longer than a row shows, the ones of 20,000 and of 10,001 characters.
    const plain = text.split("\n").slice(0, -1);
    const plainRows = (columns?: number) =>
      plain.reduce(
        (sum, line) =>
          sum +
          (columns === undefined ? 1 : Math.max(1, Math.ceil(Math.min(line.length, LINE_BOUND) / columns))) +
          (line.length > LINE_BOUND ? 1 : 0),
        0,
      );

    expect(/[\r\uD800-\uDFFF]/.test(text)).toBe(false);
    expect(plain.filter((line) => line.length > LINE_BOUND).map((line) => line.length)).toEqual([20_000, 10_001]);
    expect(rows.map(({ columns, counted }) => [columns, counted.map((count) => count.value)])).toEqual(
      WIDTHS.map((columns) => [columns, Array(MEASURED).fill(plainRows(columns))]),
    );
    expect(texts.map((read) => [read.lines, read.last])).toEqual(
      Array(MEASURED).fill([LINES, text.lastIndexOf("\n", text.length - 2) + 1]),
    );
    // Every call took a time, and each series answers within the budget at its 95th percentile.
    const timesOf = {
      parse: parses.map((parse) => parse.ms),
      search: searches.map((search) => search.ms),
      filter: filters.map((filter) => filter.ms),
      searchAmongLevels: among.map((search) => search.ms),
      ...Object.fromEntries(
        rows.map(({ columns, counted }) => [`rows ${columns ?? "not wrapped"}`, counted.map((count) => count.ms)]),
      ),
      textLines: texts.map((read) => read.ms),
    };

    expect(Object.values(timesOf).every((times) => times.length === MEASURED && times.every((ms) => ms > 0))).toBe(
      true,
    );
    expect(
      Object.entries(timesOf)
        .filter(([, times]) => percentile(times, 0.95) >= BUDGET)
        .map(([name]) => name),
    ).toEqual([]);
  });
});
