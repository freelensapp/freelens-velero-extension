import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
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

  it("gives the installation at 1,200, the age at 1,000, the two times at 760 and the expression at 640", () => {
    const all = classes;

    expect(shownAt(1201)).toEqual(all);
    expect(all.filter((name) => !shownAt(1200).includes(name))).toEqual(["installation"]);
    expect(all.filter((name) => !shownAt(1000).includes(name))).toEqual(["installation", "age"]);
    expect(all.filter((name) => !shownAt(760).includes(name))).toEqual(["installation", "submitted", "newest", "age"]);
    expect(all.filter((name) => !shownAt(640).includes(name))).toEqual([
      "installation",
      "schedule",
      "submitted",
      "newest",
      "age",
    ]);
  });

  it("never hides the name, paused, the next run, the adherence or the validation", () => {
    for (const width of [320, 520, 640, 760, 1000, 1200]) {
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
