// What the accessibility scan of the pre-review decides from what it read of a view (REQ-293 of SPEC-0018, the unit
// part of VIS-02): where the element of a violation comes from, the file of the exceptions, and which violations fail
// their case, and what the report says of each. The ways from an element up to the root of the view are written as the
// scan reads them in the frame, with the classes the host gives its components at the validation target.

import { describe, expect, it } from "vitest";
import {
  contrastOf,
  type ElementFacts,
  type Exception,
  type Found,
  originOf,
  readExceptions,
  unusedExceptions,
  verdictOf,
  violationLine,
  WCAG_TAGS,
} from "../integration/helpers/velero-accessibility";

// A way from an element up to the root of the view, the element first, each element by its tag and its classes.
const way = (...elements: [string, ...string[]][]): ElementFacts[] =>
  elements.map(([tag, ...classes]) => ({ tag, classes }));
const ROOT: [string, ...string[]] = ["div", "_page_akqzu_1"];
// The classes of the components of the host the views use, as its source at the validation target gives them, by the
// component each names: the ones that hold what they are given, and the ones that draw all they hold.
const HOLDING: Record<string, string> = {
  Button: "Button",
  Table: "Table",
  TableHead: "TableHead",
  TableRow: "TableRow",
  TableCell: "TableCell",
  content: "TableCell",
  Tabs: "Tabs",
  Tab: "Tab",
  label: "Tab",
  DrawerItem: "DrawerItem",
  name: "DrawerItem",
  value: "DrawerItem",
  DrawerTitle: "DrawerTitle",
  ItemListLayout: "ItemListLayout",
  header: "ItemListLayout",
  title: "ItemListLayout",
  "info-panel": "ItemListLayout",
  items: "ItemListLayout",
  KubeObjectListLayout: "KubeObjectListLayout",
};
const DRAWING = ["Icon", "Spinner", "Input", "SearchInput", "Select", "Checkbox"];

describe("where the element of a violation comes from", () => {
  it("is the extension for an element with a class of its stylesheet, and for what has no class inside it, up to the root of the view", () => {
    expect(originOf(way(["button", "_rowLink_akqzu_412"], ["div", "TableCell", "name"], ROOT))).toEqual({
      origin: "extension",
      by: "its class of the extension",
    });
    expect(originOf(way(["span"], ["div", "_fact_akqzu_88"], ROOT))).toEqual({
      origin: "extension",
      by: "inside an element of the extension",
    });
    expect(originOf(way(["span"], ["p"], ["div"]))).toEqual({
      origin: "extension",
      by: "inside the root of the view, with no class of the host",
    });
    expect(originOf(way(ROOT))).toEqual({ origin: "extension", by: "its class of the extension" });
  });

  it("is the host for the root of one of its components and for a part it draws in it, by the classes it gives them, a class of the extension beside them or not", () => {
    const host = (chain: ElementFacts[]) => {
      const { origin, component } = originOf(chain);

      return [origin, component];
    };

    expect(host(way(["i", "Icon", "material", "small"], ["button", "_back_akqzu_160"], ROOT))).toEqual([
      "host",
      "Icon",
    ]);
    expect(host(way(["span", "icon"], ["i", "Icon", "material"], ROOT))).toEqual(["host", "Icon"]);
    expect(host(way(["button", "Button", "_command_akqzu_9"], ROOT))).toEqual(["host", "Button"]);
    expect(host(way(["div", "TableCell", "name"], ["div", "TableRow"], ROOT))).toEqual(["host", "TableCell"]);
    expect(host(way(["div", "Spinner"], ROOT))).toEqual(["host", "Spinner"]);
    expect(
      host(way(["input", "input", "grow"], ["label", "input-area", "flex", "items-center", "gap-2"], ["div", "Input"])),
    ).toEqual(["host", "Input"]);
    expect(host(way(["div", "SearchInput", "compact"], ["div", "header", "flex"], ["div", "ItemListLayout"]))).toEqual([
      "host",
      "SearchInput",
    ]);
    // The parts of the select of the host, which react-select names by its prefix and styles with classes of its own.
    expect(
      host(way(["div", "Select__single-value", "css-1dimb5e-singleValue"], ["div", "Select", "theme-dark"])),
    ).toEqual(["host", "Select"]);
    expect(host(way(["span", "css-1f43avz-a11yText-A11yText"], ["div", "Select"], ROOT))).toEqual(["host", "Select"]);
    // A class of the stylesheet modules of the host, as the badge of `WithTooltip` has.
    expect(host(way(["div", "badge-module__badge--aB3_x", "badge-module__flat--Zz9-1"], ROOT))).toEqual([
      "host",
      "badge-module__badge",
    ]);
    // A class the list does not know is the host's all the same: the views give their elements none but their own.
    expect(host(way(["div", "flex", "gap-2"], ["div", "Tab", "flex"], ROOT))).toEqual(["host", "Tab"]);
    expect(host(way(["div", "drawer-content"], ROOT))).toEqual(["host", "drawer-content"]);
  });

  it("is the extension for an element with no class that the extension gave a component of the host that holds what it is given, and the host inside one that does not", () => {
    const of = (chain: ElementFacts[]) => originOf(chain).origin;

    // Every class of the host that holds what it is given, and the root it names.
    for (const [name, component] of Object.entries(HOLDING)) {
      expect([name, originOf(way(["span"], ["div", name], ROOT))]).toEqual([
        name,
        { origin: "extension", by: `a child the extension gave the ${component} of the host` },
      ]);
      expect([name, originOf(way(["div", name], ROOT))]).toEqual([
        name,
        { origin: "host", component, by: `its classes of the host: ${name}` },
      ]);
    }
    // Every component that draws all it holds, named by its root among the classes of its modifiers: an element with
    // no class in it is a part it drew.
    for (const component of DRAWING) {
      expect([component, originOf(way(["span"], ["div", component, "flex", "small"], ROOT))]).toEqual([
        component,
        { origin: "host", component, by: `drawn by the ${component} of the host` },
      ]);
    }
    // The words and the elements given to a cell among the classes of its modifiers, to a button, and to a badge.
    expect(of(way(["span"], ["div", "TableCell", "action"], ["div", "TableRow"], ROOT))).toBe("extension");
    expect(of(way(["span"], ["div", "content"], ["div", "TableCell", "nowrap"], ROOT))).toBe("extension");
    expect(of(way(["div"], ["button", "Button", "plain"], ROOT))).toBe("extension");
    expect(of(way(["span"], ["div", "badge-module__badge--aB3_x"], ROOT))).toBe("extension");
    // What the host draws with no class inside a part or a module of its own that holds nothing of the extension.
    expect(of(way(["input"], ["label", "Checkbox", "flex", "items-center"], ROOT))).toBe("host");
    expect(of(way(["path"], ["svg"], ["span", "icon"], ["i", "Icon"], ROOT))).toBe("host");
    expect(of(way(["span"], ["div", "flex", "gap-2"], ROOT))).toBe("host");
    expect(of(way(["span"], ["div", "close-button-module__closeButton--Xy1_2"], ROOT))).toBe("host");
    expect(originOf(way(["span"], ["div", "Select__control"], ["div", "Select"])).by).toBe(
      "drawn by the Select of the host",
    );
  });

  it("is of an element of the view: a way with no element is refused", () => {
    expect(() => originOf([])).toThrow("its way to the root is empty");
  });
});

describe("the file of the exceptions", () => {
  const entry = {
    rule: "color-contrast",
    element: '[data-testid="velero-related-restores"]',
    spec: "SPEC-0011, D4: the muted words of what is not stated",
  };

  it("is a list, empty or of exceptions that each name their rule, their element and the choice of a spec that keeps it", () => {
    expect(readExceptions("[]\n")).toEqual([]);
    expect(readExceptions(JSON.stringify([entry, { ...entry, rule: "link-name" }]))).toEqual([
      entry,
      { ...entry, rule: "link-name" },
    ]);
    // The file as it is in the repository.
    expect(readExceptions("[]\n", "e2e/__tests__/pre-review.exceptions.json")).toEqual([]);
  });

  it("refuses what cannot be read, with its words, before any view is looked at", () => {
    const refused = (value: unknown) => () => readExceptions(typeof value === "string" ? value : JSON.stringify(value));

    expect(refused("[")).toThrow("The file of the exceptions is not JSON");
    expect(refused({ exceptions: [] })).toThrow("holds a list of exceptions, and this is not a list");
    expect(refused([null])).toThrow("exception 1 is no object");
    expect(refused([[entry]])).toThrow("exception 1 is no object");
    expect(refused([entry, { rule: entry.rule, element: entry.element }])).toThrow(
      "exception 2 names element, rule: an exception names its rule, its element and its spec",
    );
    expect(refused([{ ...entry, why: "kept" }])).toThrow("names element, rule, spec, why");
    expect(refused([{}])).toThrow("names nothing");
    for (const key of ["rule", "element", "spec"]) {
      expect(refused([{ ...entry, [key]: "" }])).toThrow(`has no ${key} that can be read`);
      expect(refused([{ ...entry, [key]: ` ${entry[key as keyof typeof entry]}` }])).toThrow(
        `has no ${key} that can be read`,
      );
      expect(refused([{ ...entry, [key]: 1 }])).toThrow(`has no ${key} that can be read`);
    }
    expect(refused([{ ...entry, rule: "Color_Contrast" }])).toThrow(
      "names a rule, Color_Contrast, of no form of axe-core",
    );
    expect(refused([{ ...entry, rule: "color-contrast-" }])).toThrow("of no form of axe-core");
    expect(refused([{ ...entry, spec: "SPEC-0011" }])).toThrow("names no choice of a spec that keeps it: SPEC-0011");
    expect(refused([{ ...entry, spec: "D4 of SPEC-0011" }])).toThrow("names no choice of a spec that keeps it");
    expect(refused([{ ...entry, spec: "SPEC-11, D4" }])).toThrow("names no choice of a spec that keeps it");
    expect(refused([entry, { ...entry, spec: "SPEC-0017, D2: another reason" }])).toThrow(
      `names color-contrast ${entry.element} twice`,
    );
    expect(() => readExceptions("{}", "e2e/__tests__/pre-review.exceptions.json")).toThrow(
      "e2e/__tests__/pre-review.exceptions.json holds a list of exceptions",
    );
  });
});

describe("what becomes of a violation", () => {
  const exceptions: Exception[] = [
    { rule: "color-contrast", element: "[data-muted]", spec: "SPEC-0011, D4: the muted words" },
    { rule: "label", element: "input[data-typed]", spec: "SPEC-0017, D9: the field named by its legend" },
  ];
  const extension = { origin: "extension" as const, by: "its class of the extension" };
  const host = { origin: "host" as const, component: "TableCell", by: "its classes of the host: TableCell" };
  const found = (fields: Partial<Found>): Found => ({
    rule: "color-contrast",
    impact: "serious",
    origin: extension,
    matches: [],
    ...fields,
  });

  it("runs the rules of WCAG 2.1 at the levels A and AA, by their tags, and not the best practices", () => {
    expect(WCAG_TAGS).toEqual(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]);
  });

  it("fails its case when it is serious or critical on an element the extension renders, and no exception names its rule and its element", () => {
    expect(verdictOf(found({ impact: "serious" }), exceptions)).toEqual({ fails: true });
    expect(verdictOf(found({ impact: "critical", rule: "button-name" }), exceptions)).toEqual({ fails: true });
    // An exception whose element it matches, of another rule, keeps nothing.
    expect(verdictOf(found({ rule: "link-name", matches: [0, 1] }), exceptions)).toEqual({ fails: true });
  });

  it("is reported and fails nothing when it is moderate or minor, when it comes from the host, or when an exception names it", () => {
    for (const impact of ["moderate", "minor", null]) {
      expect([impact, verdictOf(found({ impact }), exceptions)]).toEqual([impact, { fails: false }]);
    }
    expect(verdictOf(found({ impact: "critical", origin: host }), exceptions)).toEqual({ fails: false });
    expect(verdictOf(found({ matches: [0] }), exceptions)).toEqual({ fails: false, exception: 0 });
    expect(verdictOf(found({ rule: "label", impact: "critical", matches: [0, 1] }), exceptions)).toEqual({
      fails: false,
      exception: 1,
    });
    // An exception of the host's element is used all the same.
    expect(verdictOf(found({ origin: host, matches: [0] }), exceptions)).toEqual({ fails: false, exception: 0 });
  });

  it("lists the exceptions no violation used, which the report says and which fail nothing", () => {
    const verdicts = [
      verdictOf(found({ matches: [0] }), exceptions),
      verdictOf(found({ rule: "link-name", matches: [1] }), exceptions),
    ];

    expect(unusedExceptions(exceptions, verdicts)).toEqual([exceptions[1]]);
    expect(unusedExceptions(exceptions, [])).toEqual(exceptions);
    expect(unusedExceptions([], verdicts)).toEqual([]);
  });
});

describe("what the report says of a violation", () => {
  // The data of the check of a contrast, as axe-core 4.14.0 writes it.
  const measured = {
    fgColor: "#00a7a0",
    bgColor: "#f1f1f1",
    contrastRatio: 2.64,
    fontSize: "9.8pt (13px)",
    fontWeight: "normal",
    expectedContrastRatio: "4.5:1",
    shadowColor: undefined,
  };

  it("reads the colors of a contrast, their ratio, the ratio asked and the font, and nothing when the data does not say them", () => {
    expect(contrastOf(measured)).toEqual({
      foreground: "#00a7a0",
      background: "#f1f1f1",
      ratio: 2.64,
      expected: "4.5:1",
      font: "9.8pt (13px), normal",
    });
    expect(contrastOf({ ...measured, fontSize: undefined, fontWeight: undefined })).toEqual({
      foreground: "#00a7a0",
      background: "#f1f1f1",
      ratio: 2.64,
      expected: "4.5:1",
    });
    expect(contrastOf({ ...measured, fontWeight: "bold" })?.font).toBe("9.8pt (13px), bold");
    for (const data of [
      undefined,
      null,
      "2.64",
      { ...measured, fgColor: undefined },
      { ...measured, bgColor: 1 },
      { ...measured, contrastRatio: "2.64" },
      { ...measured, expectedContrastRatio: 4.5 },
    ]) {
      expect([data, contrastOf(data)]).toEqual([data, undefined]);
    }
  });

  it("says a violation in one line: its rule, its impact and its element, then its contrast or what is to be fixed", () => {
    const summary = "Fix any of the following: Element does not have inner text that is visible to screen readers";

    expect(
      violationLine({
        rule: "color-contrast",
        impact: "serious",
        selector: "._link_akqzu_619",
        summary: "Fix any of the following: Element has insufficient color contrast of 2.64",
        contrast: contrastOf(measured),
      }),
    ).toBe("color-contrast (serious) on ._link_akqzu_619: #00a7a0 on #f1f1f1, 2.64 to 1 where 4.5:1 is asked");
    expect(violationLine({ rule: "button-name", impact: "critical", selector: "._back_akqzu_295", summary })).toBe(
      `button-name (critical) on ._back_akqzu_295: ${summary}`,
    );
    expect(violationLine({ rule: "region", impact: null, selector: "div", summary: "Fix it" })).toBe(
      "region (no impact) on div: Fix it",
    );
  });
});
