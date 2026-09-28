import { describe, expect, it } from "vitest";
import { duration } from "./go-duration";

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
