// A duration as the API of Kubernetes writes one: hours, minutes and seconds one after the other, each
// with its unit, as `1h0m0s`, `90s`, `1.5h` or `300ms`. Nothing else is a duration: a number without a
// unit is not one, and neither is a text that only begins as one.

const UNITS: Record<string, number> = {
  ns: 1e-6,
  us: 1e-3,
  µs: 1e-3,
  μs: 1e-3,
  ms: 1,
  s: 1000,
  m: 60_000,
  h: 3_600_000,
};
// The longest duration the release reads: the nanoseconds of a number of 63 bits, in milliseconds.
const LONGEST = 9_223_372_036_854.775;
const PART = /(\d+(?:\.\d*)?|\.\d+)(ns|us|µs|μs|ms|s|m|h)/y;

export type Duration =
  // The milliseconds the text says, which may be below zero.
  | { read: true; milliseconds: number; written: string }
  // The object carries something that is not a duration: it is kept as it is written.
  | { read: false; written: string }
  // The object carries nothing.
  | { read: false };

export function duration(value: unknown): Duration {
  if (value === undefined || value === null || value === "") return { read: false };
  if (typeof value !== "string") return { read: false, written: JSON.stringify(value) };
  // The parser of the release takes no space, before, after or inside.
  const sign = value.startsWith("-") ? -1 : 1;
  const body = value.replace(/^[+-]/, "");

  // Zero is the one duration that needs no unit.
  if (body === "0") return { read: true, milliseconds: 0, written: value };
  let total = 0;
  let at = 0;

  while (at < body.length) {
    PART.lastIndex = at;
    const part = PART.exec(body);

    if (!part) return { read: false, written: value };
    total += Number(part[1]) * UNITS[part[2]];
    at = PART.lastIndex;
  }
  // What does not fit the number the release keeps a duration in is not one it reads.
  if (at === 0 || !Number.isFinite(total) || total > LONGEST) return { read: false, written: value };
  return { read: true, milliseconds: sign * total + 0, written: value };
}

// The nanoseconds of each unit the parser of Go takes, as `time.ParseDuration` of the release reads them.
const NANOSECONDS: Record<string, bigint> = {
  ns: 1n,
  us: 1_000n,
  µs: 1_000n,
  μs: 1_000n,
  ms: 1_000_000n,
  s: 1_000_000_000n,
  m: 60_000_000_000n,
  h: 3_600_000_000_000n,
};
// The largest magnitude of a duration of Go: the nanoseconds of a number of 63 bits.
const LIMIT = 1n << 63n;

// The nanoseconds of a text as `time.ParseDuration` of Go reads it, with its rounding of a fraction, or nothing when
// Go refuses the text. A field of a backup that holds a duration is read with it, and the API server keeps the text as
// it was sent.
export function goDurationNanoseconds(text: string): bigint | undefined {
  let rest = text;
  let negative = false;

  if (rest.startsWith("-") || rest.startsWith("+")) {
    negative = rest.startsWith("-");
    rest = rest.slice(1);
  }
  if (rest === "0") return 0n;
  if (rest === "") return undefined;
  let total = 0n;

  while (rest !== "") {
    if (!/^[0-9.]/.test(rest)) return undefined;
    const whole = /^[0-9]*/.exec(rest)?.[0] ?? "";
    let value = 0n;

    for (const digit of whole) {
      // Go refuses a whole part that does not fit 63 bits.
      if (value > LIMIT / 10n) return undefined;
      value = value * 10n + BigInt(digit);
      if (value > LIMIT) return undefined;
    }
    rest = rest.slice(whole.length);
    let fraction = 0n;
    let scale = 1;
    let fractionDigits = "";

    if (rest.startsWith(".")) {
      rest = rest.slice(1);
      fractionDigits = /^[0-9]*/.exec(rest)?.[0] ?? "";
      let overflow = false;

      for (const digit of fractionDigits) {
        if (overflow) continue;
        if (fraction > (LIMIT - 1n) / 10n) {
          overflow = true;
          continue;
        }
        const next = fraction * 10n + BigInt(digit);

        if (next > LIMIT) {
          overflow = true;
          continue;
        }
        fraction = next;
        scale *= 10;
      }
      rest = rest.slice(fractionDigits.length);
    }
    // No digit before or after the point, as `.s`.
    if (whole === "" && fractionDigits === "") return undefined;
    const unit = /^[^0-9.]*/.exec(rest)?.[0] ?? "";

    if (unit === "") return undefined;
    rest = rest.slice(unit.length);
    // A unit is one of the table, and nothing an object inherits.
    const nanoseconds = Object.hasOwn(NANOSECONDS, unit) ? NANOSECONDS[unit] : undefined;

    if (nanoseconds === undefined || value > LIMIT / nanoseconds) return undefined;
    value *= nanoseconds;
    if (fraction > 0n) {
      // Go takes the fraction through a number of 64 bits of floating point, and keeps its whole part.
      value += BigInt(Math.trunc(Number(fraction) * (Number(nanoseconds) / scale)));
      if (value > LIMIT) return undefined;
    }
    total += value;
    if (total > LIMIT) return undefined;
  }
  if (negative) return -total;
  return total > LIMIT - 1n ? undefined : total;
}

// The digits of the fraction of a value of `precision` digits, without the zeros at its end, and the whole part, as
// `fmtFrac` of Go writes them.
function fraction(value: bigint, precision: number): { text: string; whole: bigint } {
  let digits = "";
  let printing = false;
  let rest = value;

  for (let index = 0; index < precision; index += 1) {
    const digit = rest % 10n;

    printing = printing || digit !== 0n;
    if (printing) digits = `${digit}${digits}`;
    rest /= 10n;
  }
  return { text: printing ? `.${digits}` : "", whole: rest };
}

// A duration as `Duration.String` of Go writes it: `720h0m0s`, `1m30s`, `1.5s`, `300ms`, `0s`. A field of a backup
// that holds a duration is written so.
export function goDurationText(nanoseconds: bigint): string {
  const negative = nanoseconds < 0n;
  const magnitude = negative ? -nanoseconds : nanoseconds;
  let text: string;

  if (magnitude < 1_000_000_000n) {
    if (magnitude === 0n) return "0s";
    const [precision, unit] =
      magnitude < 1_000n ? [0, "ns"] : magnitude < 1_000_000n ? [3, "µs"] : ([6, "ms"] as const);
    const { text: digits, whole } = fraction(magnitude, precision);

    text = `${whole}${digits}${unit}`;
  } else {
    const { text: digits, whole: seconds } = fraction(magnitude, 9);
    const minutes = seconds / 60n;
    const hours = minutes / 60n;

    text = `${seconds % 60n}${digits}s`;
    if (minutes > 0n) text = `${minutes % 60n}m${text}`;
    if (hours > 0n) text = `${hours}h${text}`;
  }
  return negative ? `-${text}` : text;
}
