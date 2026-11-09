/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

// The accessibility scan of the pre-review (REQ-293 and REQ-294 of SPEC-0018): axe-core, the file its package ships
// for a page, read from where the package manager installed it and loaded into the frame of the cluster alone, never
// through a bundle; then run on the root of the view of the extension with the rules of WCAG 2.1 at the levels A and
// AA. What it found is decided by `velero-accessibility.ts`.

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { WCAG_TAGS } from "./velero-accessibility";

import type AxeCore from "axe-core";
import type { Frame } from "playwright";

import type { ElementFacts } from "./velero-accessibility";

/** The root of the view of the extension: the page every view of the pre-review is drawn in (`views-frame.tsx`). */
export const PAGE_ROOT = '[data-testid^="velero-"][data-testid$="-page"]';

/**
 * What the scan leaves out inside the root, should the host draw it there: its menus, its dialogs, its drawers and
 * its tooltips (`menu/menu.tsx`, line 407; `dialog/dialog.tsx`, line 167; `drawer/drawer.tsx`, line 220; and
 * `tooltip/src/tooltip.tsx`, line 148, at the validation target). The first three are drawn outside the page, and a
 * tooltip is there while the pointer rests on what holds it, which no scan depends on.
 */
const OVERLAYS_OF_THE_HOST = [".Menu", ".Dialog", ".Drawer", ".Tooltip"];

/** How long a scan may take before the case says that it did not end: shorter than the time of a case. */
const SCAN_TIMEOUT = 120 * 1000;

/** The longest excerpt of the HTML of an element the report keeps. */
const EXCERPT = 200;

/**
 * A change the case may make, in the DOM of the page it scans and only for that scan, to see the scan fail (VIS-02):
 * the name of a button taken away, the label of a field taken away, or the colour of a text brought close to its
 * background. Each is undone once the scan ended, whatever it found.
 */
export interface Break {
  take: "name" | "label" | "contrast";
  // The element the change is made to, inside the root of the view.
  selector: string;
}

/** A violation as the scan read it in the frame, with the way from its element up to the root of the view. */
export interface ScannedViolation {
  rule: string;
  impact: string | null;
  help: string;
  // What axe-core says is to be fixed on the element, in one line.
  summary: string;
  selector: string;
  html: string;
  chain: ElementFacts[];
  matches: number[];
  // What the check of a contrast measured, as axe-core gives it, which `contrastOf` reads.
  contrast?: unknown;
}

/** What one scan of a view found. */
export interface Scanned {
  version: string;
  rules: string[];
  violations: ScannedViolation[];
  // The rules axe-core could not decide on some element, which the review reads.
  undecided: string[];
}

// The file of axe-core that a page loads, read once, where the package manager installed it: Knip reads the resolution
// as the use of the package.
let source: string | undefined;
const axeSource = () => {
  const require = createRequire(import.meta.url);

  source ??= readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");
  return source;
};

/**
 * Loads axe-core into the frame, once. The cluster frame of the host refuses a script written into its page: its
 * Content-Security-Policy is `script-src 'unsafe-eval' 'self' freelens-extension:` (`freelens/package.json`, line 59,
 * set on the frame by `packages/core/src/main/freelens-proxy/freelens-proxy.ts`, line 536, at the validation target),
 * so the text of the file is evaluated in the frame by the driver instead of `addScriptTag`.
 */
async function loadAxe(frame: Frame): Promise<void> {
  if (await frame.evaluate(() => "axe" in window)) return;
  await frame.evaluate(`${axeSource()}\n;undefined`);
  if (!(await frame.evaluate(() => "axe" in window))) {
    throw new Error("axe-core did not load into the frame of the cluster");
  }
}

async function within<T>(work: Promise<T>, milliseconds: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${what} did not end within ${milliseconds / 1000} seconds`)),
      milliseconds,
    );
  });

  try {
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Scans the root of the view of the extension with the rules of WCAG 2.1 at the levels A and AA, and not the best
 * practices, leaving out the overlays of the host. For each violation it reads the way from its element up to the root,
 * which says where it comes from, and the exceptions whose selector its element matches. A selector of the exceptions
 * that the page cannot read fails the scan, by its text. A `broken` change is made just before the scan and undone
 * just after it.
 */
export async function scanView(
  frame: Frame,
  exceptions: string[],
  what: string,
  broken?: Break,
  root = PAGE_ROOT,
): Promise<Scanned> {
  await loadAxe(frame);
  return within(
    frame.evaluate(
      async ({ root, exceptions, tags, overlays, broken, excerpt }) => {
        const axe = (window as unknown as { axe: typeof AxeCore }).axe;
        const roots = document.querySelectorAll(root);

        if (roots.length !== 1) {
          throw new Error(
            `The root of the view, ${root}, is ${roots.length} elements of the frame, where one is scanned`,
          );
        }
        const view = roots[0];
        const unreadable = exceptions.filter((selector) => {
          try {
            view.matches(selector);
            return false;
          } catch {
            return true;
          }
        });

        if (unreadable.length > 0) {
          throw new Error(`The file of the exceptions names selectors the page cannot read: ${unreadable.join(", ")}`);
        }
        const undo: (() => void)[] = [];

        if (broken) {
          const target = view.querySelector<HTMLElement>(broken.selector);

          if (!target) throw new Error(`The element to break, ${broken.selector}, is not in the view`);
          // Every text under an element, emptied and given back as it was.
          const silence = (element: Element) => {
            const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);

            for (let text = walker.nextNode(); text; text = walker.nextNode()) {
              const node = text;
              const was = node.nodeValue;

              node.nodeValue = "";
              undo.push(() => {
                node.nodeValue = was;
              });
            }
          };
          const unname = (element: Element, names: string[]) => {
            for (const name of names) {
              const was = element.getAttribute(name);

              if (was === null) continue;
              element.removeAttribute(name);
              undo.push(() => element.setAttribute(name, was));
            }
          };

          if (broken.take === "name") {
            unname(target, ["aria-label", "aria-labelledby", "title"]);
            silence(target);
          } else if (broken.take === "label") {
            unname(target, ["aria-label", "aria-labelledby", "title", "placeholder"]);
            for (const label of (target as HTMLInputElement).labels ?? []) silence(label);
          } else {
            // A text of a grey a little lighter than the grey behind it, on the element itself: a contrast of about
            // 1.4 to 1, far below the 4.5 to 1 of AA, whatever the theme draws around it. The attribute of the style
            // is given back as it was, or taken away when there was none.
            const was = target.getAttribute("style");

            target.style.setProperty("color", "rgb(64, 64, 64)", "important");
            target.style.setProperty("background-color", "rgb(40, 40, 40)", "important");
            undo.push(() => (was === null ? target.removeAttribute("style") : target.setAttribute("style", was)));
          }
        }
        try {
          const results = await axe.run(
            { include: [view], exclude: overlays },
            { runOnly: { type: "tag", values: tags }, resultTypes: ["violations"], elementRef: true, iframes: false },
          );
          const chainOf = (from: Element) => {
            const chain: { tag: string; classes: string[] }[] = [];

            for (let at: Element | null = from; at; at = at === view ? null : at.parentElement) {
              chain.push({ tag: at.tagName.toLowerCase(), classes: [...at.classList] });
            }
            return chain;
          };

          return {
            version: axe.version,
            rules: [
              ...new Set(
                [...results.violations, ...results.passes, ...results.incomplete, ...results.inapplicable].map(
                  (rule) => rule.id,
                ),
              ),
            ].sort(),
            violations: results.violations.flatMap((rule) =>
              rule.nodes.map((node) => {
                const element = node.element;

                // The check of a contrast says the colors it measured, their ratio and the ratio it expects.
                const measured = node.any.find((check) => check.id === "color-contrast")?.data;

                return {
                  rule: rule.id,
                  impact: node.impact ?? rule.impact ?? null,
                  help: rule.help,
                  summary: (node.failureSummary ?? "").replace(/\s+/g, " ").trim(),
                  selector: node.target.map(String).join(" "),
                  html: node.html.replace(/\s+/g, " ").slice(0, excerpt),
                  chain: element ? chainOf(element) : [],
                  matches: element
                    ? exceptions.flatMap((selector, index) => (element.matches(selector) ? [index] : []))
                    : [],
                  ...(measured === undefined ? {} : { contrast: measured as unknown }),
                };
              }),
            ),
            undecided: results.incomplete.map((rule) => rule.id),
          };
        } finally {
          for (const step of undo.reverse()) step();
        }
      },
      { root, exceptions, tags: WCAG_TAGS, overlays: OVERLAYS_OF_THE_HOST, broken, excerpt: EXCERPT },
    ),
    SCAN_TIMEOUT,
    `The accessibility scan of ${what}`,
  );
}
