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
