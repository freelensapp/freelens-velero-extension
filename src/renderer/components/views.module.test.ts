import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DATA_DOWNLOADS } from "../pages/data-downloads-page";
import { DATA_UPLOADS } from "../pages/data-uploads-page";
import { POD_VOLUME_BACKUPS } from "../pages/pod-volume-backups-page";
import { POD_VOLUME_RESTORES } from "../pages/pod-volume-restores-page";
import { REPOSITORIES } from "../pages/repositories-page";
import { SCHEDULES } from "../pages/schedules-page";

// The columns a rule of the room of a list hides, by the width at which it hides them: each `@container` block
// of `max-width` whose rules hide cells of the lists, read from the stylesheet as it is written.
function hiddenBelow(): Map<number, Set<string>> {
  const text = readFileSync(join(process.cwd(), "src", "renderer", "components", "views.module.css"), "utf8");
  const hidden = new Map<number, Set<string>>();

  for (const block of text.matchAll(/@container \(max-width: (\d+)px\) \{([\s\S]*?)\n\}/g)) {
    const width = Number(block[1]);

    for (const rule of block[2].matchAll(/([^{}]+)\{([^}]*)\}/g)) {
      if (!/display:\s*none/.test(rule[2])) continue;
      for (const cell of rule[1].matchAll(/\.TableCell\.([a-z-]+)/g)) {
        hidden.set(width, (hidden.get(width) ?? new Set()).add(cell[1]));
      }
    }
  }
  return hidden;
}

// The columns a rule of the room of a list gives a width of their own from a width up: each `@container` block of
// `min-width` whose rules give cells a `min-width`, read from the stylesheet as it is written.
function wholeFrom(): Map<number, Set<string>> {
  const text = readFileSync(join(process.cwd(), "src", "renderer", "components", "views.module.css"), "utf8");
  const whole = new Map<number, Set<string>>();

  for (const block of text.matchAll(/@container \(min-width: (\d+)px\) \{([\s\S]*?)\n\}/g)) {
    const width = Number(block[1]);

    for (const rule of block[2].matchAll(/([^{}]+)\{([^}]*)\}/g)) {
      if (!/min-width:\s*calc\(/.test(rule[2])) continue;
      for (const cell of rule[1].matchAll(/\.TableCell\.([a-z-]+)/g)) {
        whole.set(width, (whole.get(width) ?? new Set()).add(cell[1]));
      }
    }
  }
  return whole;
}

describe("room of the list of the schedules", () => {
  const classes = SCHEDULES.columns.map((column) => column.className);
  // What a list of the schedules shows in a room of a width: the classes of its columns no rule hides there.
  const shownAt = (width: number) => {
    const hidden = new Set([...hiddenBelow()].filter(([below]) => width <= below).flatMap(([, cells]) => [...cells]));

    return classes.filter((name) => !hidden.has(name));
  };

  // Decided by the lead maintainer on 2026-10-26 (REQ-168 of SPEC-0013): the last submission and the newest backup
  // give their room with the installation, so that what the list shows in a window of 1440 by 900 is read whole.
  it("gives the installation, the last submission and the newest backup at 1,200, the age at 1,000 and the expression at 640", () => {
    const all = classes;
    const gone = (width: number) => all.filter((name) => !shownAt(width).includes(name));

    expect(shownAt(1201)).toEqual(all);
    for (const width of [1200, 1199, 1001]) {
      expect([width, gone(width)]).toEqual([width, ["installation", "submitted", "newest"]]);
    }
    for (const width of [1000, 999, 761, 760, 759, 641]) {
      expect([width, gone(width)]).toEqual([width, ["installation", "submitted", "newest", "age"]]);
    }
    expect(gone(640)).toEqual(["installation", "schedule", "submitted", "newest", "age"]);
  });

  it("never hides the name, paused, the next run, the adherence or the validation", () => {
    for (const width of [320, 520, 640, 760, 1000, 1199, 1200, 1440]) {
      expect(shownAt(width)).toEqual(expect.arrayContaining(["name", "paused", "next", "adherence", "phase"]));
    }
  });

  it("gives paused, the next run, the adherence, the last submission and the age a width of their own from 1,000", () => {
    const whole = wholeFrom();

    expect(classes.filter((name) => whole.get(1000)?.has(name))).toEqual([
      "paused",
      "next",
      "adherence",
      "submitted",
      "age",
    ]);
  });
});

describe("lines of the overview", () => {
  // A mark is centred on the middle of the line, half an x over the baseline, and its word with it: in a cell at the
  // top of a row of plain words, that word was drawn a pixel under the others.
  it("puts the mark of a line at the top of its cell, where the words of the other cells are", () => {
    const text = readFileSync(join(process.cwd(), "src", "renderer", "components", "views.module.css"), "utf8");

    expect(/\.overviewLines \.references \.status \{([^}]*)\}/.exec(text)?.[1]).toMatch(/vertical-align:\s*top;/);
  });
});

describe("words of a cell", () => {
  // A badge in a block is drawn on the line of the block, off the line of the words of its row: the link of the host
  // that holds the badge of the node of an operation is a flex box, inside the flex box of its cell.
  it("makes a link of the host in a cell a flex box that can be narrower than its words", () => {
    const text = readFileSync(join(process.cwd(), "src", "renderer", "components", "views.module.css"), "utf8");
    const rule = /\.cellWords > a \{([^}]*)\}/.exec(text)?.[1] ?? "";

    expect([/display:\s*flex;/.test(rule), /min-width:\s*0;/.test(rule)]).toEqual([true, true]);
  });
});

// What a list shows in a room of a width: the classes of its columns no rule hides there.
function shownIn(classes: string[]) {
  return (width: number) => {
    const hidden = new Set([...hiddenBelow()].filter(([below]) => width <= below).flatMap(([, cells]) => [...cells]));

    return classes.filter((name) => !hidden.has(name));
  };
}

describe("room of the list of the backup repositories", () => {
  const classes = REPOSITORIES.columns.map((column) => column.className);
  const shownAt = shownIn(classes);
  const gone = (width: number) => classes.filter((name) => !shownAt(width).includes(name));

  it("gives the installation at 1,200, the age at 1,000, and the type and the frequency at 760", () => {
    expect(shownAt(1201)).toEqual(classes);
    expect(gone(1200)).toEqual(["installation"]);
    expect(gone(1000)).toEqual(["installation", "age"]);
    expect(gone(760)).toEqual(["installation", "repository-type", "frequency", "age"]);
    expect(gone(640)).toEqual(gone(760));
  });

  it("never hides the name, the volume namespace, the storage location, the readiness or the last maintenance", () => {
    for (const width of [320, 520, 640, 760]) {
      expect(shownAt(width)).toEqual(["name", "volume-namespace", "location", "readiness", "maintained"]);
    }
  });
});

describe.each([
  ["pod volume backups", POD_VOLUME_BACKUPS],
  ["pod volume restores", POD_VOLUME_RESTORES],
  ["data uploads", DATA_UPLOADS],
  ["data downloads", DATA_DOWNLOADS],
])("room of the list of the %s", (_, definition) => {
  const classes = definition.columns.map((column) => column.className);
  const shownAt = shownIn(classes);
  const gone = (width: number) => classes.filter((name) => !shownAt(width).includes(name));

  it("gives the installation at 1,200, the age at 1,000, the duration, the location and the uploader or the data mover at 760, the node and the start at 640", () => {
    expect(shownAt(1201)).toEqual(classes);
    expect(gone(1200)).toEqual(["installation"]);
    expect(gone(1000)).toEqual(["installation", "age"]);
    expect(gone(760)).toEqual(["installation", "duration", "storage", "uploader", "age"]);
    expect(gone(640)).toEqual(["installation", "node", "started", "duration", "storage", "uploader", "age"]);
  });

  it("never hides the name, the phase, the backup or the restore, the volume or the claim and the progress", () => {
    for (const width of [320, 520, 640]) {
      expect(shownAt(width)).toEqual(["name", "phase", "operation", "volume", "progress"]);
    }
    for (const width of [760, 1000, 1200]) {
      expect(shownAt(width)).toEqual(expect.arrayContaining(["name", "phase", "operation", "volume", "progress"]));
    }
  });
});

describe("colors of the words", () => {
  // The colors of the two themes of the host at the validation target, as a page reads them: in
  // packages/core/src/renderer/themes, lens-light.injectable.ts and lens-dark.injectable.ts, lines 30 to 121.
  const HOST = {
    light: {
      primary: "#00a7a0",
      colorOk: "#399c3d",
      colorWarning: "#ff9800",
      colorError: "#ce3933",
      textColorPrimary: "#555555",
      textColorTertiary: "#555555",
      textColorAccent: "#222222",
      mainBackground: "#f1f1f1",
      contentColor: "#ffffff",
      layoutTabsBackground: "#f8f8f8",
      tableBgcStripe: "#f8f8f8",
      tableBgcSelected: "#f4f5f5",
      inputControlBackground: "#f6f6f7",
    },
    dark: {
      primary: "#00a7a0",
      colorOk: "#4caf50",
      colorWarning: "#ff9800",
      colorError: "#ce3933",
      textColorPrimary: "#8e9297",
      textColorTertiary: "#909ba6",
      textColorAccent: "#ffffff",
      mainBackground: "#1e2124",
      contentColor: "#262b2f",
      layoutTabsBackground: "#252729",
      tableBgcStripe: "#2a2d33",
      tableBgcSelected: "#383c42",
      inputControlBackground: "#1e2125",
    },
  };
  type Theme = keyof typeof HOST;
  // The backgrounds the views write words on: the page, a list, the target bar, the rows of a kind of resources, a
  // field, and the row of a list the pointer is on or that is selected, which the host draws for its lists
  // (`table/table.scss`, lines 30 to 35, at the validation target).
  const BACKGROUNDS = [
    "mainBackground",
    "contentColor",
    "layoutTabsBackground",
    "tableBgcStripe",
    "inputControlBackground",
    "tableBgcSelected",
  ] as const;
  const text = () => readFileSync(join(process.cwd(), "src", "renderer", "components", "views.module.css"), "utf8");
  const rgb = (hex: string) => [1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16));
  // The relative luminance and the ratio of WCAG 2.1, and a mix of two colors in sRGB, as `color-mix` makes it.
  const luminance = (color: number[]) =>
    color
      .map((part) => part / 255)
      .map((part) => (part <= 0.04045 ? part / 12.92 : ((part + 0.055) / 1.055) ** 2.4))
      .reduce((sum, part, at) => sum + part * [0.2126, 0.7152, 0.0722][at], 0);
  const ratio = (one: number[], other: number[]) => {
    const [high, low] = [luminance(one), luminance(other)].sort((a, b) => b - a);

    return (high + 0.05) / (low + 0.05);
  };
  // A value of the stylesheet, `var(--name)` or `color-mix(in srgb, var(--name) N%, var(--other))`, in a theme.
  const colorOf = (value: string, theme: Theme): number[] => {
    const named = (name: string) => rgb(HOST[theme][name as keyof (typeof HOST)[Theme]]);
    const plain = /^var\(--(\w+)\)$/.exec(value);
    const mixed = /^color-mix\(in srgb, var\(--(\w+)\) (\d+)%, var\(--(\w+)\)\)$/.exec(value);

    if (plain) return named(plain[1]);
    if (!mixed) throw new Error(`A color of the words that is not read: ${value}`);
    const share = Number(mixed[2]) / 100;
    const [one, other] = [named(mixed[1]), named(mixed[3])];

    return one.map((part, at) => Math.round(part * share + other[at] * (1 - share)));
  };
  // The colors of the words the body defines, by their names, in a block of the stylesheet.
  const wordsIn = (selector: string) =>
    Object.fromEntries(
      [
        ...(new RegExp(`^${selector.replace(/[.()]/g, "\\$&")} \\{([^}]*)\\}`, "m").exec(text())?.[1] ?? "").matchAll(
          /--(veleroText\w+): ([^;]+);/g,
        ),
      ].map(([, name, value]) => [name, value]),
    );

  it("defines the colors of the words on the body, which the pages, the sections of the details of the host and the error page are all under, and nowhere else", () => {
    // Every block of the stylesheet that defines one of them, by its selector, the comments left out.
    const defining = [
      ...text()
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .matchAll(/([^{}]+)\{([^{}]*)\}/g),
    ]
      .filter(([, , body]) => /--veleroText\w+\s*:/.test(body))
      .map(([, selector]) => selector.trim());

    expect(defining).toEqual([":global(body)", ":global(body.theme-light)"]);
  });

  it("writes the words of a link, a success, a warning and a failure at the contrast of AA in both themes, on every background of the views", () => {
    const dark = wordsIn(":global(body)");
    const light = { ...dark, ...wordsIn(":global(body.theme-light)") };

    expect(Object.keys(dark).sort()).toEqual([
      "veleroTextError",
      "veleroTextLink",
      "veleroTextOk",
      "veleroTextWarning",
    ]);
    for (const [theme, words] of [
      ["dark", dark],
      ["light", light],
    ] as const) {
      for (const [name, value] of Object.entries(words)) {
        const below = BACKGROUNDS.filter(
          (background) => ratio(colorOf(value, theme), rgb(HOST[theme][background])) < 4.5,
        );

        expect([theme, name, value, below]).toEqual([theme, name, value, []]);
      }
    }
  });

  it("writes no words in a color of the host that says something but through the colors of the words", () => {
    // The property of the color of the words alone, whatever follows the value, in the semantic colors of the themes of
    // the host: neither `background-color` nor `border-color` is read.
    const direct = [
      ...text()
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .matchAll(
          /(?<![-\w])color\s*:\s*var\(--(primary|colorOk|colorSuccess|colorInfo|colorWarning|colorError|colorSoftError)\)[^;}]*/g,
        ),
    ].map(([declaration]) => declaration.trim());

    expect(direct).toEqual([]);
  });

  it("writes the words of a code element in the light theme, and of the rows of a kind of resources in both, at the contrast of AA", () => {
    const code = /^:global\(body\.theme-light\) \.page code \{\s*color: ([^;]+);\s*\}/m.exec(text())?.[1] ?? "";
    const kind = /^\.resourcesKind \{[^}]*?(?<![-\w])color: ([^;]+);/m.exec(text())?.[1] ?? "";

    expect(
      BACKGROUNDS.filter((background) => ratio(colorOf(code, "light"), rgb(HOST.light[background])) < 4.5),
    ).toEqual([]);
    for (const theme of ["light", "dark"] as const) {
      expect([theme, ratio(colorOf(kind, theme), rgb(HOST[theme].tableBgcStripe)) >= 4.5]).toEqual([theme, true]);
    }
  });
});
