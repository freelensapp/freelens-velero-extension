import { timestamp } from "./duration";
import { backupsOf } from "./schedule-history";

import type { BackupResource, ScheduleResource } from "./types";

// The grammar of the cron library of the reviewed release and the computation of the expected run of a
// schedule, written from the rules of the two functions the schedule controller of Velero v1.18.4 calls,
// ParseStandard and Next of netresearch/go-cron v0.15.0 (parser.go, spec.go, constantdelay.go and
// triggered.go), and from the controller, pkg/controller/schedule_controller.go. Nothing of that code is
// copied: the rules are written here from their lines, and the texts of the refusals are the ones the
// controller writes into a schedule, word for word. Everything is a pure function on plain data, with the
// clock as an argument; the only oracle of a time zone is Intl, never the zone of the desktop or of the
// host; the views that show what is computed here are later slices of the milestone.
// The rules of the grammar and the texts of the refusals kept verbatim are those of netresearch/go-cron
// v0.15.0, MIT, Copyright (c) 2025-2026 Netresearch DTT GmbH: the controller writes those texts into the
// schedule, which is why they are kept, and this notice goes with them as the directives ask.

// The grace before a schedule is late and the bound of the count of the expected runs that passed, in one
// place (SPEC-0013, REQ-161 and REQ-163): the controller looks at every schedule once a minute
// (schedule_controller.go L44) and submits at the first look after the instant; five looks are the grace,
// and past one hundred instants the count says only that there are more.
export const GRACE = 5 * 60_000;
export const COUNT_BOUND = 100;

const SECOND = 1000;
const MINUTE = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;

// --- The words of a refusal, as Go writes them ---

// The bytes of a character in UTF-8, which is what the parser counts and indexes.
function utf8(character: string): number[] {
  const code = character.codePointAt(0) ?? 0;

  if (code < 0x80) return [code];
  if (code < 0x800) return [0xc0 | (code >> 6), 0x80 | (code & 0x3f)];
  if (code < 0x10000) return [0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f)];
  return [0xf0 | (code >> 18), 0x80 | ((code >> 12) & 0x3f), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f)];
}

function bytesOf(text: string): number {
  let bytes = 0;

  for (const character of text) bytes += utf8(character).length;
  return bytes;
}

const NAMED_ESCAPES: Record<string, string> = {
  "\u0007": "\\a",
  "\b": "\\b",
  "\f": "\\f",
  "\n": "\\n",
  "\r": "\\r",
  "\t": "\\t",
  "\v": "\\v",
};
const PRINTABLE = /^[\p{L}\p{M}\p{N}\p{P}\p{S}]$/u;

// A character as the %q verb of Go writes it inside quotes, by the rules of strconv.Quote: the quote and
// the backslash escaped, a control character by its name or in hexadecimal, a character that is not
// printable in its \u form, every other character as it is.
function escaped(character: string, quote: string): string {
  if (character === quote || character === "\\") return `\\${character}`;
  const named = NAMED_ESCAPES[character];

  if (named) return named;
  const code = character.codePointAt(0) ?? 0;

  if (code < 0x20 || code === 0x7f) return `\\x${code.toString(16).padStart(2, "0")}`;
  if (code < 0x80 || PRINTABLE.test(character)) return character;
  return code <= 0xffff ? `\\u${code.toString(16).padStart(4, "0")}` : `\\U${code.toString(16).padStart(8, "0")}`;
}

function quoted(text: string): string {
  return `"${Array.from(text, (character) => escaped(character, '"')).join("")}"`;
}

function quotedRune(character: string): string {
  return `'${escaped(character, "'")}'`;
}

// A text as the time package of Go quotes it in the error of a duration: the quote and the backslash
// escaped, each byte of a control character or of a character beyond ASCII in hexadecimal.
function timeQuoted(text: string): string {
  let out = '"';

  for (const character of text) {
    const code = character.codePointAt(0) ?? 0;

    if (code >= 0x80 || code < 0x20) {
      for (const byte of utf8(character)) out += `\\x${byte.toString(16).padStart(2, "0")}`;
    } else {
      out += character === '"' || character === "\\" ? `\\${character}` : character;
    }
  }
  return `${out}"`;
}

// The characters strings.Fields splits on and strings.TrimSpace trims: the ones unicode.IsSpace knows,
// which are not the ones a regular expression knows as spaces (U+0085 is among them, U+FEFF is not): the
// five controls, the space, the next line, the no-break space, the Ogham space, the en quad to the hair
// space, the line and the paragraph separators, the narrow and the medium mathematical spaces and the
// ideographic space, as a class built from their code points.
const SPACE_CLASS = `[${String.fromCharCode(9, 10, 11, 12, 13, 32, 0x85, 0xa0, 0x1680)}${String.fromCharCode(0x2000)}-${String.fromCharCode(0x200a, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000)}]`;
const SPACES = new RegExp(`${SPACE_CLASS}+`);
const EDGES = new RegExp(`^${SPACE_CLASS}+|${SPACE_CLASS}+$`, "g");

function fieldsOf(text: string): string[] {
  return text.split(SPACES).filter((field) => field !== "");
}

// --- The grammar of ParseStandard ---

// What the parser refuses, with its words; the controller writes them after `invalid schedule: `.
class Refusal extends Error {}

function refuse(message: string): never {
  throw new Refusal(message);
}

// strconv.Atoi as the parser calls it (parser.go L1414-L1424): an optional sign and decimal digits, within
// the integer of 64 bits, nothing else; then no number below zero.
function integer(text: string): bigint {
  if (!/^[+-]?[0-9]+$/.test(text)) {
    refuse(`failed to parse int from ${quoted(text)}: strconv.Atoi: parsing ${quoted(text)}: invalid syntax`);
  }
  const value = BigInt(text);

  if (value > 9_223_372_036_854_775_807n || value < -9_223_372_036_854_775_808n) {
    refuse(`failed to parse int from ${quoted(text)}: strconv.Atoi: parsing ${quoted(text)}: value out of range`);
  }
  if (value < 0n) refuse(`negative number (${value}) not allowed: ${quoted(text)}`);
  return value;
}

// The bounds of the fields (spec.go L89-L118): every field of the standard parser is cyclic, so that a
// range whose start is after its end wraps; the months and the days of the week have names, read in any
// capitals; the days of the week run 0 to 7, and 7 is Sunday as 0 is (spec.go L127-L146).
interface Bounds {
  min: number;
  max: number;
  names?: Record<string, number>;
}

const MINUTES: Bounds = { min: 0, max: 59 };
const HOURS: Bounds = { min: 0, max: 23 };
const DAYS_OF_MONTH: Bounds = { min: 1, max: 31 };
const MONTHS: Bounds = {
  min: 1,
  max: 12,
  names: { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 },
};
const DAYS_OF_WEEK: Bounds = { min: 0, max: 7, names: { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 } };

function boundValue(text: string, bounds: Bounds): bigint {
  const named = bounds.names?.[text.toLowerCase()];

  return named === undefined ? integer(text) : BigInt(named);
}

// The values of one range of a field (parser.go L1132-L1225, L1449-L1465): a value, first-last, * or ?
// for every value, each with /step; N/step runs from N to the end of the field; a value below the
// minimum, above the maximum or a step of zero is refused, and a step must be smaller than the size of
// its range, which the parser counts in an unsigned integer of 64 bits. A range whose start is after its
// end wraps around the end of the field, as 22-2 for the hours or NOV-FEB.
function rangeValues(expression: string, bounds: Bounds): number[] {
  const rangeAndStep = expression.split("/");
  const lowAndHigh = rangeAndStep[0].split("-");
  const single = lowAndHigh.length === 1;
  const min = BigInt(bounds.min);
  const max = BigInt(bounds.max);
  let start: bigint;
  let end: bigint;

  if (lowAndHigh[0] === "*" || lowAndHigh[0] === "?") {
    start = min;
    end = max;
  } else {
    start = boundValue(lowAndHigh[0], bounds);
    if (lowAndHigh.length === 1) end = start;
    else if (lowAndHigh.length === 2) end = boundValue(lowAndHigh[1], bounds);
    else refuse(`too many hyphens: ${quoted(rangeAndStep[0])}`);
  }
  let step = 1n;

  if (rangeAndStep.length === 2) {
    step = integer(rangeAndStep[1]);
    if (single) end = max;
  } else if (rangeAndStep.length > 2) {
    refuse(`too many slashes: ${quoted(expression)}`);
  }
  if (start < min) refuse(`beginning of range (${start}) below minimum (${min}): ${quoted(expression)}`);
  if (end > max) refuse(`end of range (${end}) above maximum (${max}): ${quoted(expression)}`);
  if (step === 0n) refuse(`step of range must be a positive number: ${quoted(expression)}`);
  let size = start > end ? max - start + 1n + (end - min + 1n) : end - start + 1n;

  if (size < 0n) size += 2n ** 64n;
  if (step > 1n && step >= size) {
    refuse(`step (${step}) must be less than range size (${size}): ${quoted(expression)}`);
  }
  const from = Number(start);
  const to = Number(end);
  const by = Number(step);
  const values: number[] = [];

  if (from > to) {
    const span = bounds.max - bounds.min + 1;

    for (let at = from; at <= to + span; at += by) {
      values.push(at > bounds.max ? ((at - bounds.min) % span) + bounds.min : at);
    }
  } else {
    for (let at = from; at <= to; at += by) values.push(at);
  }
  return values;
}

// A field is a list of ranges, with commas, the empty ones dropped (parser.go L845-L856).
function fieldValues(field: string, bounds: Bounds): Set<number> {
  const values = new Set<number>();

  for (const expression of field.split(",")) {
    if (expression === "") continue;
    for (const value of rangeValues(expression, bounds)) values.add(value);
  }
  return values;
}

// The day of the month refuses the extended syntax of the module before its values are read (parser.go
// L529-L544), and the day of the week the syntax of an occurrence (L547-L562); 7 is Sunday (L559-L560).
function dayOfMonthValues(field: string): Set<number> {
  const upper = field.toUpperCase();

  if (upper.includes("L") || upper.includes("W")) {
    refuse("extended day-of-month syntax requires DomL option (for L, L-n) or DomW option (for nW, LW) to be enabled");
  }
  return fieldValues(field, DAYS_OF_MONTH);
}

function dayOfWeekValues(field: string): Set<number> {
  if (field.includes("#")) refuse("#n/#L syntax requires DowNth or DowLast option to be enabled");
  const values = fieldValues(field, DAYS_OF_WEEK);

  if (values.delete(7)) values.add(0);
  return values;
}

// The name of a zone is validated before it is loaded (parser.go L1384-L1412): 64 bytes at most, of
// letters, digits and / _ - + : only, the first character that is not one named with its position in
// bytes; an empty name is refused. Which names the server knows is not validated here: the server took
// the expression, or refused it, and the runtime says later which names it knows itself.
const ZONE_CHARACTER = /^[A-Za-z0-9/_\-+:]$/;

function zoneNameProblem(name: string): string | undefined {
  if (name.length === 0) return "empty timezone string";
  if (bytesOf(name) > 64) return "timezone string too long (max 64 chars)";
  let position = 0;

  for (const character of name) {
    if (!ZONE_CHARACTER.test(character)) {
      return `invalid character ${quotedRune(character)} at position ${position} in timezone`;
    }
    position += utf8(character).length;
  }
  return undefined;
}

const UNIT_NANOSECONDS: Record<string, bigint> = {
  ns: 1n,
  us: 1_000n,
  µs: 1_000n,
  μs: 1_000n,
  ms: 1_000_000n,
  s: 1_000_000_000n,
  m: 60_000_000_000n,
  h: 3_600_000_000_000n,
};
// The number Go keeps a duration in has 63 bits and a sign.
const LARGEST = 1n << 63n;

// The digits after the point as Go reads them: a number and its scale, the digits past the capacity of the
// number consumed and ignored.
function leadingFraction(digits: string): [fraction: bigint, scale: number] {
  let fraction = 0n;
  let scale = 1;
  let overflow = false;

  for (const digit of digits) {
    if (overflow) continue;
    if (fraction > (LARGEST - 1n) / 10n) {
      overflow = true;
      continue;
    }
    const next = fraction * 10n + BigInt(digit);

    if (next > LARGEST) {
      overflow = true;
      continue;
    }
    fraction = next;
    scale *= 10;
  }
  return [fraction, scale];
}

// A duration as time.ParseDuration reads one, with its refusals in the words of Go: an optional sign, then
// numbers, each with a fraction and a unit, nanoseconds to hours, one after the other, or 0 alone; the whole
// numbers exact, the fraction of each in a floating number as Go computes it, and the bounds of Go.
function goDuration(text: string): { nanoseconds: bigint } | { error: string } {
  const invalid = { error: `time: invalid duration ${timeQuoted(text)}` };
  let rest = text;
  let negative = false;

  if (rest.startsWith("-") || rest.startsWith("+")) {
    negative = rest.startsWith("-");
    rest = rest.slice(1);
  }
  if (rest === "0") return { nanoseconds: 0n };
  if (rest === "") return invalid;
  let total = 0n;

  while (rest !== "") {
    const first = rest[0];

    if (!(first === "." || (first >= "0" && first <= "9"))) return invalid;
    const whole = (/^[0-9]*/.exec(rest) ?? [""])[0];

    rest = rest.slice(whole.length);
    let value = whole === "" ? 0n : BigInt(whole);

    if (value > LARGEST) return invalid;
    let digits = "";
    let fraction = 0n;
    let scale = 1;

    if (rest.startsWith(".")) {
      rest = rest.slice(1);
      digits = (/^[0-9]*/.exec(rest) ?? [""])[0];
      rest = rest.slice(digits.length);
      [fraction, scale] = leadingFraction(digits);
    }
    if (whole === "" && digits === "") return invalid;
    const unit = (/^[^.0-9]*/.exec(rest) ?? [""])[0];

    if (unit === "") return { error: `time: missing unit in duration ${timeQuoted(text)}` };
    rest = rest.slice(unit.length);
    const nanoseconds = UNIT_NANOSECONDS[unit];

    if (nanoseconds === undefined) {
      return { error: `time: unknown unit ${timeQuoted(unit)} in duration ${timeQuoted(text)}` };
    }
    if (value > LARGEST / nanoseconds) return invalid;
    value *= nanoseconds;
    if (fraction > 0n) {
      value += BigInt(Math.trunc(Number(fraction) * (Number(nanoseconds) / scale)));
      if (value > LARGEST) return invalid;
    }
    total += value;
    if (total > LARGEST) return invalid;
  }
  if (!negative && total > LARGEST - 1n) return invalid;
  return { nanoseconds: negative ? -total : total };
}

// The zone an expression names: with a prefix TZ= or CRON_TZ= and a name, with the name Local, which is
// the zone of the server, or with no prefix, which is the zone of the server as well.
export type ExpressionZone = { of: "named"; name: string } | { of: "local" } | { of: "none" };

// The values of the five fields, as sets. The seconds are the first second of the minute, always.
export interface FieldSets {
  minutes: ReadonlySet<number>;
  hours: ReadonlySet<number>;
  days: ReadonlySet<number>;
  months: ReadonlySet<number>;
  weekdays: ReadonlySet<number>;
}

export type CalendarDescriptor = "@yearly" | "@annually" | "@monthly" | "@weekly" | "@daily" | "@midnight" | "@hourly";

export type ParsedExpression =
  | { kind: "fields"; zone: ExpressionZone; fields: FieldSets }
  | { kind: "calendar"; zone: ExpressionZone; descriptor: CalendarDescriptor; fields: FieldSets }
  // Every so many seconds, whole: the parser truncates the duration to the second.
  | { kind: "every"; zone: ExpressionZone; seconds: number }
  // A descriptor whose next instant is always the zero time: no instant.
  | { kind: "no-instant"; zone: ExpressionZone; descriptor: "@triggered" | "@manual" | "@none" };

export type Parsed =
  | ParsedExpression
  // What the controller writes into the validation errors of the schedule, word for word.
  | { kind: "refused"; reason: string };

// The spec of a schedule, as the controller names the expression; a prefix with nothing after it, a
// descriptor and five fields take the whole text after the prefix (parser.go L328-L366, L415-L526).
const EXPRESSION_LIMIT = 1024;
// The controller refuses an empty expression itself, before the parser (schedule_controller.go L179-L181).
const EMPTY_EXPRESSION = "Schedule must be a non-empty valid Cron expression";

function all(bounds: Bounds): Set<number> {
  const values = new Set<number>();

  for (let value = bounds.min; value <= bounds.max; value += 1) values.add(value);
  return values;
}

const FIRST = new Set([0]);
const EVERY_WEEKDAY = all({ min: 0, max: 6 });

// The descriptors (parser.go L1490-L1537): the calendar ones are the first minute of the year, the month,
// the week (Sunday), the day and the hour; @every takes a duration as Go reads one, refused below a
// second and truncated to the second (L141, L1525-L1533, constantdelay.go L42-L55); three have no instant
// (L1521-L1522, triggered.go L21-L24).
function descriptor(text: string, zone: ExpressionZone): Parsed {
  const calendar = (
    name: CalendarDescriptor,
    hours: Set<number>,
    days: Set<number>,
    months: Set<number>,
    weekdays: Set<number>,
  ): Parsed => ({
    kind: "calendar",
    zone,
    descriptor: name,
    fields: { minutes: FIRST, hours, days, months, weekdays },
  });

  switch (text) {
    case "@yearly":
    case "@annually":
      return calendar(text, FIRST, new Set([1]), new Set([1]), EVERY_WEEKDAY);
    case "@monthly":
      return calendar(text, FIRST, new Set([1]), all(MONTHS), EVERY_WEEKDAY);
    case "@weekly":
      return calendar(text, FIRST, all(DAYS_OF_MONTH), all(MONTHS), FIRST);
    case "@daily":
    case "@midnight":
      return calendar(text, FIRST, all(DAYS_OF_MONTH), all(MONTHS), EVERY_WEEKDAY);
    case "@hourly":
      return calendar(text, all(HOURS), all(DAYS_OF_MONTH), all(MONTHS), EVERY_WEEKDAY);
    case "@triggered":
    case "@manual":
    case "@none":
      return { kind: "no-instant", zone, descriptor: text };
    default:
      break;
  }
  if (text.startsWith("@every ")) {
    const read = goDuration(text.slice("@every ".length));

    if ("error" in read) refuse(`failed to parse duration ${quoted(text)}: ${read.error}`);
    if (read.nanoseconds < 1_000_000_000n) refuse(`@every duration must be at least 1s: ${quoted(text)}`);
    return { kind: "every", zone, seconds: Number(read.nanoseconds / 1_000_000_000n) };
  }
  return refuse(`unrecognized descriptor: ${quoted(text)}`);
}

function parse(text: string): Parsed {
  if (text.length === 0) return { kind: "refused", reason: EMPTY_EXPRESSION };
  try {
    const bytes = bytesOf(text);

    if (bytes > EXPRESSION_LIMIT) refuse(`spec too long: ${bytes} > ${EXPRESSION_LIMIT}`);
    let zone: ExpressionZone = { of: "none" };
    let rest = text;

    if (text.startsWith("TZ=") || text.startsWith("CRON_TZ=")) {
      const space = text.indexOf(" ");

      if (space === -1) refuse(`missing fields after timezone in spec ${quoted(text)}`);
      let name = text.slice(text.indexOf("=") + 1, space);

      // Matching quotes around the name are taken off, as a shell would write them.
      if (
        name.length >= 2 &&
        ((name.startsWith('"') && name.endsWith('"')) || (name.startsWith("'") && name.endsWith("'")))
      ) {
        name = name.slice(1, -1);
      }
      const problem = zoneNameProblem(name);

      if (problem) refuse(`invalid timezone ${quoted(name)}: ${problem}`);
      zone = name === "Local" ? { of: "local" } : { of: "named", name };
      rest = text.slice(space).replace(EDGES, "");
      if (rest.length === 0) refuse(`missing fields after timezone ${quoted(name)}`);
    }
    if (rest.startsWith("@")) return descriptor(rest, zone);
    const fields = fieldsOf(rest);

    if (fields.length !== 5) refuse(`expected exactly 5 fields, found ${fields.length}: [${fields.join(" ")}]`);
    // The hash expressions of the module are refused before any field is read (parser.go L453-L464).
    if (fields.some((field) => field.split(",").some((part) => part.startsWith("H")))) {
      refuse("h expressions require hash option to be enabled");
    }
    // In the order the parser reads them: the minute, the hour and the month, then the day of the month,
    // then the day of the week (parser.go L475-L497).
    const minutes = fieldValues(fields[0], MINUTES);
    const hours = fieldValues(fields[1], HOURS);
    const months = fieldValues(fields[3], MONTHS);
    const days = dayOfMonthValues(fields[2]);
    const weekdays = dayOfWeekValues(fields[4]);

    return { kind: "fields", zone, fields: { minutes, hours, days, months, weekdays } };
  } catch (error) {
    if (error instanceof Refusal) return { kind: "refused", reason: `invalid schedule: ${error.message}` };
    throw error;
  }
}

// The parsed expressions are kept by the text of the expression (REQ-175): a list computes the signal of
// each of its schedules every time it is drawn. What is kept must not be changed by its callers.
const PARSED = new Map<string, Parsed>();
const PARSED_BOUND = 4096;

export function parseExpression(value: unknown): Parsed {
  const text = typeof value === "string" ? value : "";
  let parsed = PARSED.get(text);

  if (!parsed) {
    parsed = parse(text);
    if (PARSED.size >= PARSED_BOUND) PARSED.clear();
    PARSED.set(text, parsed);
  }
  return parsed;
}

// --- The next instant ---

// The zone an instant is computed in: a name as the runtime knows it through Intl, or an offset from UTC
// in minutes, which the zone of the server is derived as.
export type Zone = { of: "named"; name: string } | { of: "fixed"; minutes: number };

export const UTC: Zone = { of: "fixed", minutes: 0 };

interface ZoneClock {
  // The offset of the zone at an instant, in milliseconds east of UTC.
  offsetAt(instant: number): number;
}

type DayOffsets = { change: undefined; offset: number } | { change: number; before: number; after: number };

interface ZoneFacts {
  format: Intl.DateTimeFormat;
  // The offsets over each day of UTC the computations touched, by the number of the day.
  days: Map<number, DayOffsets>;
}

// The zones the runtime was asked about, by name: nothing kept for a name it does not know.
const ZONES = new Map<string, ZoneFacts | null>();
const DAYS_BOUND = 8192;

function zoneFacts(name: string): ZoneFacts | null {
  let facts = ZONES.get(name);

  if (facts === undefined) {
    try {
      facts = {
        format: new Intl.DateTimeFormat("en-US", {
          timeZone: name,
          hourCycle: "h23",
          year: "numeric",
          month: "numeric",
          day: "numeric",
          hour: "numeric",
          minute: "numeric",
          second: "numeric",
        }),
        days: new Map(),
      };
    } catch {
      facts = null;
    }
    ZONES.set(name, facts);
  }
  return facts;
}

// The offset of a zone at an instant, from the wall clock Intl writes of that instant in it.
function readOffset(facts: ZoneFacts, instant: number): number {
  const parts: Record<string, number> = {};

  for (const part of facts.format.formatToParts(new Date(instant))) {
    if (part.type !== "literal") parts[part.type] = Number(part.value);
  }
  const wall = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);

  return wall - Math.floor(instant / SECOND) * SECOND;
}

// The offsets of a zone over one day of UTC: one offset, or a change at a minute of the day, since the
// rules of a zone change at whole minutes and never twice in a day. A day is read once, with two readings
// of the wall clock and a few more when it has a change: reading the wall clock through Intl costs
// microseconds, and the loops of the next instant step by the minute and by the second.
function dayOffsets(facts: ZoneFacts, day: number): DayOffsets {
  let offsets = facts.days.get(day);

  if (offsets) return offsets;
  const start = day * DAY;
  const before = readOffset(facts, start);
  const after = readOffset(facts, start + DAY - 1);

  if (before === after) {
    offsets = { change: undefined, offset: before };
  } else {
    let low = 0;
    let high = 1440;

    while (high - low > 1) {
      const middle = (low + high) >> 1;

      if (readOffset(facts, start + middle * MINUTE) === after) high = middle;
      else low = middle;
    }
    offsets = { change: start + high * MINUTE, before, after };
  }
  if (facts.days.size >= DAYS_BOUND) facts.days.clear();
  facts.days.set(day, offsets);
  return offsets;
}

function zoneClock(zone: Zone): ZoneClock | undefined {
  if (zone.of === "fixed") {
    const offset = zone.minutes * MINUTE;

    return { offsetAt: () => offset };
  }
  const facts = zoneFacts(zone.name);

  if (!facts) return undefined;
  return {
    offsetAt: (instant) => {
      const offsets = dayOffsets(facts, Math.floor(instant / DAY));

      if (offsets.change === undefined) return offsets.offset;
      return instant < offsets.change ? offsets.before : offsets.after;
    },
  };
}

// The offset of a zone at an instant, in minutes east of UTC, as the computation reads it: nothing for a name
// the runtime does not know. The words of an instant are written in the zone of the expression with it, and
// never with the zone of the machine.
export function zoneOffset(zone: Zone, instant: number): number | undefined {
  const clock = zoneClock(zone);

  return clock ? clock.offsetAt(instant) / MINUTE : undefined;
}

interface Wall {
  year: number;
  month: number;
  day: number;
  weekday: number;
  hour: number;
  minute: number;
  second: number;
}

type Time = Pick<Wall, "hour" | "minute" | "second">;

// The wall clock of an instant in a zone.
function wallOf(clock: ZoneClock, instant: number): Wall {
  const date = new Date(instant + clock.offsetAt(instant));

  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    weekday: date.getUTCDay(),
    hour: date.getUTCHours(),
    minute: date.getUTCMinutes(),
    second: date.getUTCSeconds(),
  };
}

// The time of day of an instant in a zone, without its date: the loops of the hours, the minutes and the
// seconds read nothing else, and step up to sixty times for one instant.
function timeOf(clock: ZoneClock, instant: number): Time {
  const seconds = Math.floor((instant + clock.offsetAt(instant)) / SECOND);
  const ofDay = ((seconds % 86_400) + 86_400) % 86_400;

  return { hour: Math.floor(ofDay / 3600), minute: Math.floor((ofDay % 3600) / 60), second: ofDay % 60 };
}

// The instant of a wall clock in a zone, as time.Date of Go chooses it in the hour a change of daylight
// saving time repeats or skips: the offset at the wall clock read as UTC, corrected by the offset at the
// instant that gives. The fields may be outside their ranges, as Go normalizes them.
function instantOf(
  clock: ZoneClock,
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
): number {
  const wall = Date.UTC(year, month - 1, day, hour, minute, second);

  return wall - clock.offsetAt(wall - clock.offsetAt(wall));
}

// AddDate of Go: the wall clock of the instant, with months or days added, as a new instant.
function addDate(clock: ZoneClock, instant: number, months: number, days: number): number {
  const wall = wallOf(clock, instant);

  return instantOf(clock, wall.year, wall.month + months, wall.day + days, wall.hour, wall.minute, wall.second);
}

// Next of spec.go (L367-L468), written from its loop: from the upcoming second of the given time, in the
// zone, the first month, day, hour, minute and second that match, the later fields reset to their first
// value once an earlier one was advanced, back to the month when a field wraps; no instant past five
// years of the given time, where the library gives the zero time. The hour loop stops at the first instant
// after a change of daylight saving time when the hour the change skipped is in the expression (L336-L345,
// L439-L454), and a day whose midnight does not exist starts at its first hour (L324-L334). The minute and
// the second loops add their unit to the instant: in the hour a change repeats, both occurrences are
// instants. A day of the month and a day of the week that are both restricted must both match (L470-L506).
function nextOfFields(fields: FieldSets, after: number, clock: ZoneClock): number | undefined {
  // A field with no value, which the grammar admits (a field of commas alone, a step from a value above
  // the maximum), matches no instant: the loop of the library would step by the minute to the five years.
  if ([fields.minutes, fields.hours, fields.days, fields.months, fields.weekdays].some((set) => set.size === 0)) {
    return undefined;
  }
  let instant = Math.floor(after / SECOND) * SECOND + SECOND;
  let added = false;
  const yearLimit = wallOf(clock, instant).year + 5;

  wrap: for (;;) {
    let wall = wallOf(clock, instant);

    if (wall.year > yearLimit) return undefined;
    while (!fields.months.has(wall.month)) {
      if (!added) {
        added = true;
        instant = instantOf(clock, wall.year, wall.month, 1, 0, 0, 0);
      }
      instant = addDate(clock, instant, 1, 0);
      wall = wallOf(clock, instant);
      if (wall.month === 1) continue wrap;
    }
    while (!(fields.days.has(wall.day) && fields.weekdays.has(wall.weekday))) {
      if (!added) {
        added = true;
        instant = instantOf(clock, wall.year, wall.month, wall.day, 0, 0, 0);
      }
      instant = addDate(clock, instant, 0, 1);
      wall = wallOf(clock, instant);
      if (wall.hour !== 0) {
        instant += wall.hour > 12 ? (24 - wall.hour) * HOUR : -wall.hour * HOUR;
        wall = wallOf(clock, instant);
      }
      if (wall.day === 1) continue wrap;
    }
    // From here the date of the instant is the one of `wall`: the resets below take it from there.
    let time: Time = wall;

    while (!fields.hours.has(time.hour)) {
      if (!added) {
        added = true;
        instant = instantOf(clock, wall.year, wall.month, wall.day, time.hour, 0, 0);
        time = timeOf(clock, instant);
      }
      const previous = time.hour;

      instant += HOUR;
      time = timeOf(clock, instant);
      if (time.hour - previous === 2 && fields.hours.has(time.hour - 1)) break;
      if (time.hour === 0) continue wrap;
    }
    while (!fields.minutes.has(time.minute)) {
      if (!added) {
        added = true;
        instant = Math.floor(instant / MINUTE) * MINUTE;
      }
      instant += MINUTE;
      time = timeOf(clock, instant);
      if (time.minute === 0) continue wrap;
    }
    while (time.second !== 0) {
      if (!added) {
        added = true;
        instant = Math.floor(instant / SECOND) * SECOND;
      }
      instant += SECOND;
      time = timeOf(clock, instant);
      if (time.second === 0) continue wrap;
    }
    return instant;
  }
}

export type NextInstant =
  | { kind: "instant"; at: number }
  // The zero time of the library: a descriptor without an instant, or none within five years.
  | { kind: "none"; reason: "no-instant" | "beyond-five-years" }
  // A name the runtime does not know: a result, since the server may know it.
  | { kind: "zone-not-known"; name: string };

// The first instant of the expression after the given time, in the zone: for @every the given time
// rounded down to the second plus the duration (constantdelay.go L63-L74), whatever the zone.
export function nextInstant(parsed: ParsedExpression, after: number, zone: Zone): NextInstant {
  if (parsed.kind === "every")
    return { kind: "instant", at: Math.floor(after / SECOND) * SECOND + parsed.seconds * SECOND };
  if (parsed.kind === "no-instant") return { kind: "none", reason: "no-instant" };
  const clock = zoneClock(zone);

  if (!clock) return { kind: "zone-not-known", name: zone.of === "named" ? zone.name : "" };
  const at = nextOfFields(parsed.fields, after, clock);

  return at === undefined ? { kind: "none", reason: "beyond-five-years" } : { kind: "instant", at };
}

// The zone an expression names, for the computation; nothing for an expression that names none or Local,
// whose zone is the one of the server, which the views establish otherwise.
export function expressionZone(parsed: ParsedExpression): Zone | undefined {
  return parsed.zone.of === "named" ? { of: "named", name: parsed.zone.name } : undefined;
}

// --- The expected run ---

// Where the controller counts the next run from (schedule_controller.go L275-L284): the last submission,
// the creation of the schedule when there is none, and the last skipped time when it is later than that.
export type Anchor = { of: "last-submission" | "creation" | "last-skipped"; at: number };

export function anchorOf(schedule: Pick<ScheduleResource, "metadata" | "status">): Anchor | undefined {
  const submission = timestamp(schedule.status?.lastBackup);
  const created = timestamp(schedule.metadata.creationTimestamp);
  const skipped = timestamp(schedule.status?.lastSkipped);
  let anchor: Anchor | undefined;

  if (submission !== undefined) anchor = { of: "last-submission", at: submission };
  else if (created !== undefined) anchor = { of: "creation", at: created };
  if (skipped !== undefined && (anchor === undefined || skipped > anchor.at))
    anchor = { of: "last-skipped", at: skipped };
  return anchor;
}

export type ExpectedRun =
  | {
      kind: "expected";
      anchor: Anchor;
      // The first instant of the expression after the anchor.
      at: number;
      // The clock is after the expected run, strictly: the controller submits at its next look.
      due: boolean;
      // The instants after the anchor and before the clock, counted one by one, at most the bound.
      passed: number;
      // More than the bound passed: the count stopped there.
      beyond: boolean;
      // The last of the instants that passed, when any did.
      lastPassed?: number;
    }
  // The expression has no instant after the anchor: the controller reads the zero time as a run that is
  // due, and submits a backup at each of its looks.
  | { kind: "at-every-look"; anchor: Anchor; reason: "no-instant" | "beyond-five-years" }
  | { kind: "zone-not-known"; anchor: Anchor; name: string }
  // The expression names no zone and none was given.
  | { kind: "no-zone"; anchor: Anchor }
  // This version cannot read the expression: nothing is computed, whatever the server did with it.
  | { kind: "not-readable"; reason: string }
  // The schedule reports no time to count from.
  | { kind: "no-anchor" };

// The expected run of a schedule as the controller counts it (schedule_controller.go L241-L251,
// L275-L289): the next instant after the anchor, due when the clock is after it, strictly; and the
// expected instants that passed since the anchor, which the controller does not catch up on (L258-L260),
// one by one up to the bound. The instants are computed in the zone the expression names, and in the given
// zone, the one of the server as the views establish it, only when the expression names none (REQ-162).
export function expectedRun(
  schedule: Pick<ScheduleResource, "metadata" | "status">,
  parsed: Parsed,
  zone: Zone | undefined,
  now: number,
): ExpectedRun {
  if (parsed.kind === "refused") return { kind: "not-readable", reason: parsed.reason };
  const anchor = anchorOf(schedule);

  if (!anchor) return { kind: "no-anchor" };
  const effective = expressionZone(parsed) ?? zone;

  if (effective === undefined && (parsed.kind === "fields" || parsed.kind === "calendar"))
    return { kind: "no-zone", anchor };
  const first = nextInstant(parsed, anchor.at, effective ?? UTC);

  if (first.kind === "zone-not-known") return { kind: "zone-not-known", anchor, name: first.name };
  if (first.kind === "none") return { kind: "at-every-look", anchor, reason: first.reason };
  let passed = 0;
  let beyond = false;
  let lastPassed: number | undefined;
  let next: NextInstant = first;

  while (next.kind === "instant" && now > next.at) {
    if (passed === COUNT_BOUND) {
      beyond = true;
      break;
    }
    passed += 1;
    lastPassed = next.at;
    next = nextInstant(parsed, next.at, effective ?? UTC);
  }
  return {
    kind: "expected",
    anchor,
    at: first.at,
    due: now > first.at,
    passed,
    beyond,
    ...(lastPassed === undefined ? {} : { lastPassed }),
  };
}

// --- The backup of the last submission ---

// The controller creates the backup and writes the submission with one reading of its clock
// (schedule_controller.go L257-L266): a minute covers the API server and the patch.
const SUBMISSION_WINDOW = MINUTE;

// The name the controller gives what it submits: the name of the schedule, a hyphen and the wall clock of
// the server, fourteen digits (schedule_types.go, TimestampedName).
function isSubmissionName(name: string, schedule: string): boolean {
  return name.length === schedule.length + 15 && name.startsWith(`${schedule}-`) && /^\d{14}$/.test(name.slice(-14));
}

export type SubmissionBackup =
  // The milliseconds from the submission to the creation of the backup.
  | { kind: "found"; backup: BackupResource; distance: number }
  // The submission stands, since the schedule carries it: its backup expired, was deleted or cannot be read.
  | { kind: "not-found"; submission: number }
  | { kind: "no-submission" };

// The backup of the last submission among the backups that exist (REQ-167): of the backups of the
// schedule, the ones that carry its name in their label as the history reads them, the one named as the
// controller names a submission and created within a minute of status.lastBackup, the nearest when
// several are, by name when two are as near.
export function submissionBackup(schedule: ScheduleResource, backups: BackupResource[]): SubmissionBackup {
  const submission = timestamp(schedule.status?.lastBackup);

  if (submission === undefined) return { kind: "no-submission" };
  let found: { backup: BackupResource; distance: number } | undefined;

  for (const backup of backupsOf(backups, schedule.metadata.namespace ?? "", schedule.metadata.name)) {
    if (!isSubmissionName(backup.metadata.name, schedule.metadata.name)) continue;
    const created = timestamp(backup.metadata.creationTimestamp);

    if (created === undefined) continue;
    const distance = created - submission;

    if (Math.abs(distance) > SUBMISSION_WINDOW) continue;
    if (
      !found ||
      Math.abs(distance) < Math.abs(found.distance) ||
      (Math.abs(distance) === Math.abs(found.distance) && backup.metadata.name < found.backup.metadata.name)
    ) {
      found = { backup, distance };
    }
  }
  return found ? { kind: "found", ...found } : { kind: "not-found", submission };
}

// The backups of the schedule that are newer than its last submission, the backup of the submission left
// out, from the newest: none of them is a submission of the schedule, since the controller writes the
// submission right after the one backup it creates. Asked by hand or synced from the store, they move
// nothing in the schedule. Without a submission, every backup of the schedule is one of them.
export function laterBackups(schedule: ScheduleResource, backups: BackupResource[]): BackupResource[] {
  const submission = timestamp(schedule.status?.lastBackup);
  const found = submissionBackup(schedule, backups);

  return backupsOf(backups, schedule.metadata.namespace ?? "", schedule.metadata.name).filter((backup) => {
    if (found.kind === "found" && backup === found.backup) return false;
    const created = timestamp(backup.metadata.creationTimestamp);

    return created !== undefined && (submission === undefined || created > submission);
  });
}
