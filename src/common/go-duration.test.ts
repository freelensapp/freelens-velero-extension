import { describe, expect, it } from "vitest";
import goldens from "../../test/template-goldens.json";
import { duration, goDurationNanoseconds, goDurationText } from "./go-duration";

describe("a duration as the API writes one", () => {
  it.each([
    ["1h0m0s", 3_600_000],
    ["1m0s", 60_000],
    ["30s", 30_000],
    ["90s", 90_000],
    ["2h45m", 9_900_000],
    ["1.5h", 5_400_000],
    ["300ms", 300],
    ["1h30m15.5s", 5_415_500],
    ["720h0m0s", 2_592_000_000],
    ["0s", 0],
    ["0", 0],
    ["-1m", -60_000],
    ["+5s", 5000],
    [".5s", 500],
    // The longest the release reads, in hours.
    ["2562047h", 2_562_047 * 3_600_000],
  ])("reads %j as %i milliseconds", (written, milliseconds) => {
    expect(duration(written)).toEqual({ read: true, milliseconds, written });
  });

  it.each([
    "1",
    "60",
    "soon",
    "1 hour",
    "1h 30m",
    "h",
    "1x",
    "1h30",
    "PT1H",
    "1d",
    "--1s",
    "1e3s",
    // The parser of the release takes no space, and no duration longer than the number it keeps one in.
    " 10s ",
    "10s ",
    " 10s",
    "\t10s",
    "99999999999h",
    "2562048h",
  ])("keeps %j as it is written, and reads no duration from it", (written) => {
    expect(duration(written)).toEqual({ read: false, written });
  });

  it("reads nothing where nothing is", () => {
    for (const value of [undefined, null, ""]) expect(duration(value)).toEqual({ read: false });
  });

  it("keeps what is not a text as it would be written, and reads no duration from it", () => {
    expect(duration(60)).toEqual({ read: false, written: "60" });
    expect(duration({ seconds: 60 })).toEqual({ read: false, written: '{"seconds":60}' });
    expect(duration(true)).toEqual({ read: false, written: "true" });
  });

  it("gives no number that is not one", () => {
    for (const written of ["1h", "0.1s", "2562047h47m16s", "-0s"]) {
      const read = duration(written);

      expect(read.read).toBe(true);
      expect(JSON.stringify(read)).not.toMatch(/NaN|Infinity/);
    }
  });
});

describe("a duration as Go reads it and prints it", () => {
  it.each([
    ["720h", 2_592_000_000_000_000n, "720h0m0s"],
    ["1.5h", 5_400_000_000_000n, "1h30m0s"],
    ["90s", 90_000_000_000n, "1m30s"],
    ["300ms", 300_000_000n, "300ms"],
    ["1500us", 1_500_000n, "1.5ms"],
    ["1500µs", 1_500_000n, "1.5ms"],
    ["1500μs", 1_500_000n, "1.5ms"],
    ["999ns", 999n, "999ns"],
    ["1.5s", 1_500_000_000n, "1.5s"],
    ["2h45m30.25s", 9_930_250_000_000n, "2h45m30.25s"],
    ["1h2m3s4ms5us6ns", 3_723_004_005_006n, "1h2m3.004005006s"],
    ["0.000000001s", 1n, "1ns"],
    ["0.0000000005s", 0n, "0s"],
    ["0", 0n, "0s"],
    ["-1h", -3_600_000_000_000n, "-1h0m0s"],
    ["+2h", 7_200_000_000_000n, "2h0m0s"],
    // The largest of 63 bits, and the smallest.
    ["9223372036854775807ns", 9_223_372_036_854_775_807n, "2562047h47m16.854775807s"],
    ["-9223372036854775808ns", -9_223_372_036_854_775_808n, "-2562047h47m16.854775808s"],
  ])("reads %s as Go does, and prints it as Go does", (text, nanoseconds, printed) => {
    expect(goDurationNanoseconds(text)).toBe(nanoseconds);
    expect(goDurationText(nanoseconds)).toBe(printed);
  });

  it.each([
    "",
    "1",
    "h",
    "1d",
    "1 h",
    " 1h",
    "1h ",
    "1H",
    ".s",
    "1.5.5s",
    "9223372036854775808ns",
    "100000000000000000000ns",
    // A unit is one of the table: a name an object inherits is not one.
    "1constructor",
    "1toString",
    "1__proto__",
  ])("refuses %j, as Go does", (text) => {
    expect(goDurationNanoseconds(text)).toBeUndefined();
  });
});

describe("a duration against what Go made of it", () => {
  it.each(goldens.durations as { text: string; nanoseconds?: string; printed?: string; error?: string }[])(
    "reads and prints $text as Go 1.26 did",
    ({ text, nanoseconds, printed, error }) => {
      const read = goDurationNanoseconds(text);

      if (error !== undefined) {
        expect(read).toBeUndefined();
        return;
      }
      expect(read).toBe(BigInt(String(nanoseconds)));
      expect(goDurationText(read as bigint)).toBe(printed);
    },
  );
});
