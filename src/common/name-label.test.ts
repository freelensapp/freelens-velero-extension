import { describe, expect, it } from "vitest";
import { labelOf } from "./name-label";

// The values are the ones of the rule of the release, computed outside the extension: the first 57 characters
// and the first 6 hexadecimal characters of the SHA-256 of the whole name.
describe("the label of a name", () => {
  it("is the name of 63 characters or fewer", () => {
    const name = "daily-backups-of-the-shop-database-and-of-its-uploaded-files-ab";

    expect(name).toHaveLength(63);
    expect(labelOf(name)).toBe(name);
    expect(labelOf("nightly")).toBe("nightly");
  });

  it("is a name over 63 characters cut as the release cuts it, in 63 characters", () => {
    const cases = [
      [
        "daily-backups-of-the-shop-database-and-of-its-uploaded-files-abc",
        "daily-backups-of-the-shop-database-and-of-its-uploaded-fi1cdcbe",
      ],
      [
        "the-daily-backups-of-the-shop-database-and-of-its-files-of-2026-20261026120000",
        "the-daily-backups-of-the-shop-database-and-of-its-files-o80b6c5",
      ],
      [`${"a".repeat(100)}-${"b".repeat(100)}-${"c".repeat(51)}`, `${"a".repeat(57)}abc0c1`],
    ] as const;

    for (const [name, label] of cases) {
      expect([name.length, labelOf(name)]).toEqual([name.length, label]);
      expect(labelOf(name)).toHaveLength(63);
    }
    expect(cases.map(([name]) => name.length)).toEqual([64, 78, 253]);
  });
});
