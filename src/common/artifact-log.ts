// The log of an operation, as the lines of the text that was loaded: where each begins, and its level. The
// text is kept once, as it was given; what is built beside it is two numbers for each line, and the lines
// a search finds. Pure functions: a tab gives them the text and shows what they answer.

// The levels a log is filtered by. An entry the release writes at another level, and a line that is no
// entry, are of none of the four.
export const LOG_LEVELS = ["error", "warning", "info", "debug", "other"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

// A row shows this much of a line; what copies the line takes it whole.
export const LINE_BOUND = 10_000;

export interface ParsedLog {
  // The text as it was loaded: the one copy there is of it.
  text: string;
  // Where each line begins in the text.
  starts: Uint32Array;
  // The level of each line, as its place among the levels above.
  levels: Uint8Array;
  counts: Record<LogLevel, number>;
}

// The lines of a text, whether it is a log or not: the text, and where each of its lines begins. It is what
// a list of lines is given.
export type TextLines = Pick<ParsedLog, "text" | "starts">;

const OTHER = LOG_LEVELS.indexOf("other");
const PLACES = new Map<string, number>(LOG_LEVELS.slice(0, OTHER).map((level, place) => [level, place]));
const SPACE = 32;
const QUOTE = 34;

// The place of the level a word names, the word being the text between two offsets; the place of what
// is none of the four otherwise. No text is made of the word: a log has a word for each of its lines.
function placeOf(text: string, from: number, to: number): number {
  for (let place = 0; place < OTHER; place += 1) {
    const level = LOG_LEVELS[place];

    if (to - from === level.length && text.startsWith(level, from)) return place;
  }
  return OTHER;
}

// The level of an entry of the text format, which begins with its time and then its level, as the logging
// library of the server writes it, or with its level when it is written without a time. The level is a
// word that ends where the next field begins: what the words of a message say further on is not looked
// at, and neither is anything of a line that does not begin this way.
function textLevel(text: string, at: number, end: number): number {
  let from = at;

  if (text.startsWith("time=", at)) {
    let stop = at + 5;

    if (text.charCodeAt(stop) === QUOTE) {
      stop = text.indexOf('"', stop + 1) + 1;
      if (stop <= 0 || stop > end) return OTHER;
    } else {
      while (stop < end && text.charCodeAt(stop) !== SPACE && text.charCodeAt(stop) !== QUOTE) stop += 1;
      if (stop === at + 5) return OTHER;
    }
    if (stop >= end || text.charCodeAt(stop) !== SPACE) return OTHER;
    from = stop + 1;
  }
  if (!text.startsWith("level=", from)) return OTHER;
  from += 6;
  let stop = from;

  while (stop < end && text.charCodeAt(stop) !== SPACE) stop += 1;
  return placeOf(text, from, stop);
}
// The key of the level of an entry of the JSON format, with the quote that opens a value that is a text. A
// message that carries these letters has its quotes escaped, and is not found by them.
const JSON_LEVEL = '"level":"';

// The level of an entry of the JSON format: the value of its own key. An object written before that key
// may have a key of the same name, so such a line is read as the JSON it is.
function jsonLevel(line: string): number {
  // What does not end as an object is not an entry.
  if (!line.endsWith("}")) return OTHER;
  const key = line.indexOf(JSON_LEVEL);

  if (key < 0) return OTHER;
  const inner = line.indexOf("{", 1);

  if (inner >= 0 && inner < key) {
    try {
      const level = (JSON.parse(line) as { level?: unknown }).level;

      return typeof level === "string" ? (PLACES.get(level) ?? OTHER) : OTHER;
    } catch {
      return OTHER;
    }
  }
  const from = key + JSON_LEVEL.length;

  return PLACES.get(line.slice(from, line.indexOf('"', from))) ?? OTHER;
}

// The lines of a log and the level of each. A line ends at its break, whichever it is; a text that does not
// end with a break has its last line all the same, and nothing follows the last break.
export function parseLog(text: string): ParsedLog {
  let count = 0;

  for (let at = 0; at < text.length; ) {
    const next = text.indexOf("\n", at);

    count += 1;
    if (next < 0) break;
    at = next + 1;
  }
  const starts = new Uint32Array(count);
  const levels = new Uint8Array(count);
  const totals = new Array<number>(LOG_LEVELS.length).fill(0);

  for (let line = 0, at = 0; line < count; line += 1) {
    const next = text.indexOf("\n", at);
    const end = next < 0 ? text.length : next;
    let level = OTHER;

    // A line that ends with a return and a break ends before the return.
    const last = end > at && text.charCodeAt(end - 1) === 13 ? end - 1 : end;

    if (text.charCodeAt(at) === 123) level = jsonLevel(text.slice(at, last));
    else if (last > at) level = textLevel(text, at, last);
    starts[line] = at;
    levels[line] = level;
    totals[level] += 1;
    at = end + 1;
  }
  return {
    text,
    starts,
    levels,
    counts: Object.fromEntries(LOG_LEVELS.map((level, place) => [level, totals[place]])) as Record<LogLevel, number>,
  };
}

// The lines of a text that is no log: where each begins, and no level. A text of another shape is not
// read as the entries of a log, which a line that begins as an object would be, whatever its size.
export function textLines(text: string): TextLines {
  let count = 0;

  for (let at = 0; at < text.length; ) {
    const next = text.indexOf("\n", at);

    count += 1;
    if (next < 0) break;
    at = next + 1;
  }
  const starts = new Uint32Array(count);

  for (let line = 1; line < count; line += 1) starts[line] = text.indexOf("\n", starts[line - 1]) + 1;
  return { text, starts };
}

// Where a line begins and where it ends in the text, without its break.
function bounds(lines: TextLines, line: number): [start: number, end: number] {
  if (!Number.isInteger(line) || line < 0 || line >= lines.starts.length) throw new RangeError("No such line");
  const start = lines.starts[line];
  let end = line + 1 < lines.starts.length ? lines.starts[line + 1] - 1 : lines.text.length;

  // The last line of a text that ends with a break ends before it.
  if (line + 1 === lines.starts.length && end > start && lines.text.charCodeAt(end - 1) === 10) end -= 1;
  if (end > start && lines.text.charCodeAt(end - 1) === 13) end -= 1;
  return [start, end];
}

// A line of the log, whole, without its break.
export function logLine(log: TextLines, line: number): string {
  const [start, end] = bounds(log, line);

  return log.text.slice(start, end);
}

// How many characters a line has, without its break: counted from where the lines begin, and no text is
// made of the line.
export function lineLength(lines: TextLines, line: number): number {
  const [start, end] = bounds(lines, line);

  return end - start;
}

// Whether a character is the first half of one written as two.
function firstHalf(text: string, at: number): boolean {
  const half = text.charCodeAt(at);

  return half >= 0xd800 && half <= 0xdbff;
}

// Where a row stops showing a line that begins and ends at two offsets of a text: at its end, or at the
// bound. A character written as two halves is not cut between them.
function cutAt(text: string, start: number, end: number): number {
  if (end - start <= LINE_BOUND) return end;
  return start + (firstHalf(text, start + LINE_BOUND - 1) ? LINE_BOUND - 1 : LINE_BOUND);
}

// What a row shows of a line: the line, or its beginning with how many characters were left out.
export function cutLine(line: string): { text: string; left: number } {
  const at = cutAt(line, 0, line.length);

  return at === line.length ? { text: line, left: 0 } : { text: line.slice(0, at), left: line.length - at };
}

// The columns a line is wrapped at, or nothing for a number that is none: the lines are not wrapped then.
function wrapAt(columns: number | undefined): number | undefined {
  return columns !== undefined && columns >= 1 ? Math.floor(columns) : undefined;
}

// Where the piece that begins at an offset ends, in a row of so many columns: after that many characters,
// or at the end of what is shown. A character written as two halves stays whole, in the piece after when
// the row has the room of more than one character, and in this one when it has not.
function pieceEnd(text: string, at: number, end: number, columns: number): number {
  const next = at + columns;

  if (next >= end) return end;
  if (!firstHalf(text, next - 1)) return next;
  return next - 1 > at ? next - 1 : next + 1;
}

// What a row shows of a line, in the pieces a room of so many columns takes it in: one piece when the
// lines are not wrapped, and one for a line that is empty. The pieces are cut by their number of
// characters, as a terminal does: the height of a row is known before it is drawn.
export function linePieces(shown: string, columns?: number): string[] {
  const width = wrapAt(columns);

  if (width === undefined || shown.length <= width) return [shown];
  const pieces: string[] = [];

  for (let at = 0; at < shown.length; ) {
    const next = pieceEnd(shown, at, shown.length, width);

    pieces.push(shown.slice(at, next));
    at = next;
  }
  return pieces;
}

// How many rows of the screen a line takes: one for each piece of what is shown of it, and one more for
// the words that say how much of it was left out. It is counted on the text as it is: no line is made.
export function lineRows(lines: TextLines, line: number, columns?: number): number {
  const [start, end] = bounds(lines, line);
  const stop = cutAt(lines.text, start, end);
  const width = wrapAt(columns);
  let rows = 1;

  if (width !== undefined && stop - start > width) {
    rows = 0;
    for (let at = start; at < stop; at = pieceEnd(lines.text, at, stop, width)) rows += 1;
  }
  return rows + (stop < end ? 1 : 0);
}

// Which levels were chosen, as a mark for each place; nothing when none was, which hides no line.
function chosen(levels: ReadonlySet<LogLevel> | undefined): boolean[] | undefined {
  return levels?.size ? LOG_LEVELS.map((level) => levels.has(level)) : undefined;
}

// The lines a filter by level leaves, in their order. No line is hidden until a level is chosen: nothing
// is answered then, and every line is shown.
export function shownLines(log: ParsedLog, levels: ReadonlySet<LogLevel> | undefined): Uint32Array | undefined {
  const marks = chosen(levels);

  if (!marks) return undefined;
  const shown = new Uint32Array(
    LOG_LEVELS.reduce((sum, level, place) => sum + (marks[place] ? log.counts[level] : 0), 0),
  );

  for (let line = 0, at = 0; line < log.levels.length; line += 1) if (marks[log.levels[line]]) shown[at++] = line;
  return shown;
}

// The row of a line among the lines a filter leaves: its place among them, the one of the next line that
// is left when it is hidden, and the last when none follows it. While no line is hidden a line is its own
// row. There is no row when no line is left.
export function rowOf(shown: Uint32Array | undefined, line: number): number {
  if (!shown) return line;
  let low = 0;
  let high = shown.length;

  while (low < high) {
    const middle = (low + high) >> 1;

    if (shown[middle] < line) low = middle + 1;
    else high = middle;
  }
  return Math.min(low, shown.length - 1);
}

// The words that were typed, as what is looked for in a text: whatever their capitals, taken as they are,
// with no pattern read from them. Nothing for no words, and for words no line can carry.
function sought(words: string): RegExp | undefined {
  if (!words || /[\r\n]/.test(words)) return undefined;
  return new RegExp(words.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
}

// Where the words that were typed are in what a row shows of a line: where each place of them begins and
// ends, in their order, none over another. They are found as the search finds its lines: a line the search
// found has a place of them, unless it is in what a row leaves out of a line it cuts. It is asked for a
// row that is mounted, and for no other.
export function foundPlaces(shown: string, words: string): [number, number][] {
  const pattern = sought(words);
  const places: [number, number][] = [];

  if (!pattern || !shown) return places;
  for (let match = pattern.exec(shown); match; match = pattern.exec(shown)) {
    places.push([match.index, match.index + match[0].length]);
  }
  return places;
}

// A piece of what a row shows of a line, which begins at an offset of it, in the parts the places of the
// words cut it in: what is of a place, and what is between two. Words that go from a piece of a wrapped
// line to the next are of both. The parts are the piece, in its order, and a piece without a place is one
// part.
export function pieceParts(
  piece: string,
  from: number,
  places: readonly (readonly [number, number])[],
): { text: string; found: boolean }[] {
  const end = from + piece.length;
  const parts: { text: string; found: boolean }[] = [];
  let at = from;

  for (const [start, stop] of places) {
    if (stop <= at) continue;
    if (start >= end) break;
    const begins = Math.max(start, at);
    const ends = Math.min(stop, end);

    if (begins > at) parts.push({ text: piece.slice(at - from, begins - from), found: false });
    parts.push({ text: piece.slice(begins - from, ends - from), found: true });
    at = ends;
  }
  if (at < end || parts.length === 0) parts.push({ text: piece.slice(at - from), found: false });
  return parts;
}

// The lines that carry the words that were typed, whatever their capitals, among the ones a filter by
// level leaves: each line once, in its order. The words are taken as they are, and no pattern is read
// from them. The text is looked through as it is: no other copy of it is made for the search.
export function searchLog(log: ParsedLog, words: string, levels?: ReadonlySet<LogLevel>): Uint32Array {
  const { text, starts } = log;
  const pattern = sought(words);

  if (!pattern || !text) return new Uint32Array(0);
  const marks = chosen(levels);
  const found = new Uint32Array(starts.length);
  let count = 0;
  let line = 0;

  for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
    // The lines are in order: the one of this match is not before the one of the match before it.
    let low = line;
    let high = starts.length - 1;

    while (low < high) {
      const middle = (low + high + 1) >> 1;

      if (starts[middle] <= match.index) low = middle;
      else high = middle - 1;
    }
    if (!marks || marks[log.levels[low]]) found[count++] = low;
    // A line is found once: the search goes on from the next one.
    if (low + 1 >= starts.length) break;
    line = low + 1;
    pattern.lastIndex = starts[line];
  }
  return found.slice(0, count);
}
