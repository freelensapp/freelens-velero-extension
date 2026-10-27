import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
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
])("room of the list of the %s", (_, definition) => {
  const classes = definition.columns.map((column) => column.className);
  const shownAt = shownIn(classes);
  const gone = (width: number) => classes.filter((name) => !shownAt(width).includes(name));

  it("gives the installation at 1,200, the age at 1,000, the duration, the location and the uploader at 760, the node and the start at 640", () => {
    expect(shownAt(1201)).toEqual(classes);
    expect(gone(1200)).toEqual(["installation"]);
    expect(gone(1000)).toEqual(["installation", "age"]);
    expect(gone(760)).toEqual(["installation", "duration", "storage", "uploader", "age"]);
    expect(gone(640)).toEqual(["installation", "node", "started", "duration", "storage", "uploader", "age"]);
  });

  it("never hides the name, the phase, the backup or the restore, the source and the progress", () => {
    for (const width of [320, 520, 640]) {
      expect(shownAt(width)).toEqual(["name", "phase", "operation", "volume", "progress"]);
    }
    for (const width of [760, 1000, 1200]) {
      expect(shownAt(width)).toEqual(expect.arrayContaining(["name", "phase", "operation", "volume", "progress"]));
    }
  });
});
