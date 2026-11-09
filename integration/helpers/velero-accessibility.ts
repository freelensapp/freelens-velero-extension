/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

// What the accessibility scan of the pre-review decides from what it read of a view (REQ-293 of SPEC-0018), with
// nothing read here: where the element of a violation comes from, the exceptions of the file beside the suite, and
// which violations fail their case. Kept apart from the scan, which drives the frame (`velero-axe.ts`), so that the
// unit tests prove it without an application.

/** The rules the scan runs: the ones of WCAG 2.1 at the levels A and AA, by their tags, and not the best practices. */
export const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

/** The impacts that fail a case, on an element the extension renders. */
const FAILING_IMPACTS = ["serious", "critical"];

/**
 * A class of the stylesheet of the extension, as its build names the classes of its modules: `_<name>_<hash>_<line>`,
 * the form the build test reads in `dist/renderer.css`. The views give their own elements these classes and no other:
 * the five plain names of `resources-viewer.tsx` and the names of the columns of the lists are given to the cells of
 * the host, which carry `TableCell` beside them.
 */
const EXTENSION_CLASS = /^_[A-Za-z0-9]+_[a-z0-9]{5}_\d+$/;

/**
 * A class of the stylesheet modules of the host, as its build names them, `[name]__[local]--[hash:base64:5]`
 * (`freelens/electron.vite.config.ts`, line 410, at the validation target): the badge of `WithTooltip` is one.
 */
const HOST_MODULE_CLASS = /^([A-Za-z0-9_-]+?)__([A-Za-z0-9_-]+?)--[A-Za-z0-9_-]+$/;

/**
 * The classes the host gives the components the views use, read in its source at the validation target, each with its
 * component and whether it holds what it is given. A component that holds is named by its root, and by the part it
 * draws around what it is given when it draws one: an element with no class inside it is a child the extension gave
 * it. Inside a component that draws all it holds, as inside any other class of the host, such an element is a part
 * the host drew, and the component is named by its root alone, which every part of it is under. Under
 * `packages/ui-components`: `button/src/button.tsx`, lines 38 and 61 to 65; `icon/src/icon.tsx`, line 226;
 * `spinner/src/spinner.tsx`, line 25. Under `packages/core/src/renderer/components`: `input/input.tsx`, line 409;
 * `input/search-input.tsx`, line 93; `select/select.tsx`, line 253; `checkbox/checkbox.tsx`, line 34;
 * `table/table.tsx`, line 299; `table/table-head.tsx`, line 29; `table/table-row.tsx`, line 40;
 * `table/table-cell.tsx`, lines 99 and 110; `tabs/tabs.tsx`, lines 39, 129 and 146; `drawer/drawer-item.tsx`, lines
 * 44, 47 and 48; `drawer/drawer-title.tsx`, line 33; `item-object-list/list-layout.tsx`, line 303;
 * `item-object-list/header.tsx`, lines 78, 85 and 87; `item-object-list/content.tsx`, line 558;
 * `kube-object-list-layout/kube-object-list-layout.tsx`, line 242.
 */
const HOST_CLASSES: Record<string, { component: string; holds: boolean }> = {
  // What holds the words or the elements it is given.
  Button: { component: "Button", holds: true },
  Table: { component: "Table", holds: true },
  TableHead: { component: "TableHead", holds: true },
  TableRow: { component: "TableRow", holds: true },
  TableCell: { component: "TableCell", holds: true },
  content: { component: "TableCell", holds: true },
  Tabs: { component: "Tabs", holds: true },
  Tab: { component: "Tab", holds: true },
  label: { component: "Tab", holds: true },
  DrawerItem: { component: "DrawerItem", holds: true },
  name: { component: "DrawerItem", holds: true },
  value: { component: "DrawerItem", holds: true },
  DrawerTitle: { component: "DrawerTitle", holds: true },
  ItemListLayout: { component: "ItemListLayout", holds: true },
  header: { component: "ItemListLayout", holds: true },
  title: { component: "ItemListLayout", holds: true },
  "info-panel": { component: "ItemListLayout", holds: true },
  items: { component: "ItemListLayout", holds: true },
  KubeObjectListLayout: { component: "KubeObjectListLayout", holds: true },
  // What draws all it holds.
  Icon: { component: "Icon", holds: false },
  Spinner: { component: "Spinner", holds: false },
  Input: { component: "Input", holds: false },
  SearchInput: { component: "SearchInput", holds: false },
  Select: { component: "Select", holds: false },
  Checkbox: { component: "Checkbox", holds: false },
};

/** One element of the way from the element of a violation up to the root of the view: its tag and its classes. */
export interface ElementFacts {
  tag: string;
  classes: string[];
}

/** Where the element of a violation comes from, with the component of the host it is of, and what decided. */
export interface Origin {
  origin: "extension" | "host";
  component?: string;
  by: string;
}

// The component of the host a class names, when the list above knows it, or a module of the host names it.
function knownComponent(name: string): { component: string; holds: boolean } | undefined {
  if (Object.hasOwn(HOST_CLASSES, name)) return HOST_CLASSES[name];
  const module = HOST_MODULE_CLASS.exec(name);

  // The badge of `WithTooltip` holds the words it is given (`badge/badge.tsx`, lines 70 and 82).
  return module ? { component: `${module[1]}__${module[2]}`, holds: module[2] === "badge" } : undefined;
}

/**
 * Where the element of a violation comes from, read from the way up from it to the root of the view, the element
 * first. The first element of the way that has a class decides. A class of the host on it, any class that is not of
 * the stylesheet of the extension, makes it the host's, even beside a class of the extension: the element itself, or
 * a part the host drew inside one of its components. An element with no class inside a component of the host that
 * holds what it is given is the extension's, a child it gave, and inside one that does not, the host's. A class of
 * the extension alone makes it the extension's, and so does the root of the view, reached with no class of the host.
 */
export function originOf(chain: ElementFacts[]): Origin {
  if (chain.length === 0) throw new Error("A violation is of an element of the view: its way to the root is empty");
  for (const [index, element] of chain.entries()) {
    const host = element.classes.filter((name) => !EXTENSION_CLASS.test(name));

    if (host.length > 0) {
      // The component the element is of: the first one the list knows, from the element up.
      const component =
        chain
          .slice(index)
          .flatMap((above) => above.classes.map(knownComponent))
          .find((known) => known !== undefined)?.component ?? host.join(" ");

      if (index === 0) return { origin: "host", component, by: `its classes of the host: ${host.join(" ")}` };
      if (host.some((name) => knownComponent(name)?.holds)) {
        return { origin: "extension", by: `a child the extension gave the ${component} of the host` };
      }
      return { origin: "host", component, by: `drawn by the ${component} of the host` };
    }
    if (element.classes.length > 0) {
      return {
        origin: "extension",
        by: index === 0 ? "its class of the extension" : "inside an element of the extension",
      };
    }
  }
  return { origin: "extension", by: "inside the root of the view, with no class of the host" };
}

/** An exception of the file beside the suite: the rule, a selector its element matches, and the spec that keeps it. */
export interface Exception {
  rule: string;
  element: string;
  spec: string;
}

/**
 * The exceptions of the file beside the suite, a list in JSON. Each names exactly its rule, by the identifier of the
 * rule of axe-core, its element, by a selector the element matches, and the choice of a spec that keeps it, which
 * starts with the identifier of the spec. Anything else in the file is refused with its words, before any view is
 * looked at: an exception that cannot be read would let a violation through, or fail one it was written for.
 */
export function readExceptions(text: string, file = "The file of the exceptions"): Exception[] {
  let parsed: unknown;

  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`${file} is not JSON`);
  }
  if (!Array.isArray(parsed)) throw new Error(`${file} holds a list of exceptions, and this is not a list`);
  const exceptions = parsed.map((entry: unknown, index): Exception => {
    const which = `${file}: exception ${index + 1}`;

    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) throw new Error(`${which} is no object`);
    const fields = entry as Record<string, unknown>;
    const keys = Object.keys(fields).sort();

    if (keys.join(" ") !== "element rule spec") {
      throw new Error(
        `${which} names ${keys.join(", ") || "nothing"}: an exception names its rule, its element and its spec`,
      );
    }
    for (const key of keys) {
      const value = fields[key];

      if (typeof value !== "string" || value.trim() === "" || value !== value.trim()) {
        throw new Error(`${which} has no ${key} that can be read: a text, with nothing around it`);
      }
    }
    const { rule, element, spec } = fields as unknown as Exception;

    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(rule)) {
      throw new Error(`${which} names a rule, ${rule}, of no form of axe-core`);
    }
    if (!/^SPEC-\d{4}\b.+/.test(spec)) {
      throw new Error(`${which} names no choice of a spec that keeps it: ${spec}`);
    }
    return { rule, element, spec };
  });
  const named = exceptions.map(({ rule, element }) => `${rule} ${element}`);
  const twice = named.filter((key, index) => named.indexOf(key) !== index);

  if (twice.length > 0) throw new Error(`${file} names ${twice.join(", ")} twice`);
  return exceptions;
}

/**
 * A violation the scan found on one element: its rule, its impact, where it comes from, and the exceptions whose
 * element it matches.
 */
export interface Found {
  rule: string;
  impact: string | null;
  origin: Origin;
  // The indexes of the exceptions whose selector the element matches, whatever their rule.
  matches: number[];
}

/** What becomes of a violation: whether it fails its case, and the exception that keeps it, when one does. */
export interface Verdict {
  fails: boolean;
  exception?: number;
}

/**
 * A violation of impact serious or critical on an element the extension renders fails its case, unless an exception
 * names its rule and its element. What comes from the host, and an impact moderate or minor, is reported and does not
 * fail; an exception that matches a violation of the host is used all the same.
 */
export function verdictOf(found: Found, exceptions: Exception[]): Verdict {
  const exception = found.matches.find((index) => exceptions[index]?.rule === found.rule);
  const severe = found.impact !== null && FAILING_IMPACTS.includes(found.impact);

  return {
    fails: found.origin.origin === "extension" && severe && exception === undefined,
    ...(exception === undefined ? {} : { exception }),
  };
}

/** The exceptions no violation of the run used, which the report lists and which fail nothing (D8 of SPEC-0018). */
export function unusedExceptions(exceptions: Exception[], verdicts: Verdict[]): Exception[] {
  const used = new Set(verdicts.map((verdict) => verdict.exception));

  return exceptions.filter((_, index) => !used.has(index));
}
