import { describe, expect, it } from "vitest";
import { closed, DEPTH, decodeView, decodeViews, encodeView, openedFrom, sameView, VIEW_KINDS, VIEWS } from "./views";

import type { ViewTarget } from "./views";

const backup = (name: string): ViewTarget => ({ kind: "backup", name });
const restore = (name: string): ViewTarget => ({ kind: "restore", name });

describe("views in the address of a page", () => {
  it("names a view by its kind and its name, and reads back what it wrote", () => {
    for (const kind of VIEW_KINDS) {
      const target = { kind, name: "nightly-20260901030000" };

      expect(encodeView(target)).toBe(`${kind}/nightly-20260901030000`);
      expect(decodeView(encodeView(target))).toEqual(target);
      expect(VIEWS[kind].noun).not.toBe("");
    }
  });

  it.each([
    undefined,
    null,
    7,
    "",
    "backup",
    "backup/",
    "/nightly",
    "secret/nightly",
    "backup/Not A Name",
    "backup/../restores",
    "backup/nightly/other",
    `backup/${"a".repeat(254)}`,
    ["backup/nightly"],
  ])("opens no view for %j", (value) => {
    expect(decodeView(value)).toBeUndefined();
  });

  it("reads the views of an address in their order, without what is not one", () => {
    expect(decodeViews(["backup/nightly-1", "nothing", "restore/restore-1"])).toEqual([
      backup("nightly-1"),
      restore("restore-1"),
    ]);
    expect(decodeViews("backup/nightly-1")).toEqual([backup("nightly-1")]);
    expect(decodeViews([])).toEqual([]);
    expect(decodeViews(undefined)).toEqual([]);
    expect(decodeViews("")).toEqual([]);
  });

  it("does not keep a view twice in a row", () => {
    expect(decodeViews(["backup/nightly-1", "backup/nightly-1", "restore/restore-1"])).toEqual([
      backup("nightly-1"),
      restore("restore-1"),
    ]);
  });
});

describe("way between the views", () => {
  it("opens a view over the one that is shown, and goes back to it", () => {
    const first = openedFrom([], backup("nightly-1"));
    const second = openedFrom(first, restore("restore-1"));

    expect(first).toEqual([backup("nightly-1")]);
    expect(second).toEqual([backup("nightly-1"), restore("restore-1")]);
    expect(closed(second)).toEqual(first);
    expect(closed(first)).toEqual([]);
    expect(closed([])).toEqual([]);
  });

  it("goes back to a view that is already on the way, and does not make the way longer", () => {
    const path = [backup("nightly-1"), restore("restore-1")];

    expect(openedFrom(path, backup("nightly-1"))).toEqual([backup("nightly-1")]);
    expect(openedFrom([...path, backup("nightly-2")], restore("restore-1"))).toEqual(path);
  });

  it("tells a backup from a restore of the same name", () => {
    expect(sameView(backup("same"), restore("same"))).toBe(false);
    expect(openedFrom([backup("same")], restore("same"))).toEqual([backup("same"), restore("same")]);
    expect(sameView(undefined, undefined)).toBe(false);
  });

  it("keeps a way of a bounded length, and the end of it", () => {
    let path: ViewTarget[] = [];

    for (let index = 0; index < DEPTH + 5; index += 1) path = openedFrom(path, backup(`nightly-${index}`));
    expect(path).toHaveLength(DEPTH);
    expect(path[path.length - 1]).toEqual(backup(`nightly-${DEPTH + 4}`));
    expect(decodeViews(Array.from({ length: DEPTH + 5 }, (_, index) => `backup/nightly-${index}`))).toHaveLength(DEPTH);
  });

  it("does not change the way it is given", () => {
    const path = Object.freeze([backup("nightly-1")]) as ViewTarget[];

    expect(() => openedFrom(path, restore("restore-1"))).not.toThrow();
    expect(() => closed(path)).not.toThrow();
    expect(path).toEqual([backup("nightly-1")]);
  });
});
