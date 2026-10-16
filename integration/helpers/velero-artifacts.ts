/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

// Helpers for the tabs of the workspace of a backup and of a restore: the
// identifiers of their parts, written once; the way to a workspace at a tab;
// what the panel of a tab says of where its load is; a load walked from its
// command to its text; what each viewer shows of the text it was given; and
// the words the tabs say, as a suite expects them.
//
// A part that is not in the page fails the case that asked for it, by its
// name: it is never read as empty. A number is read from an attribute, never
// from the words around it, which the language of a machine writes its way.
//
// See `velero-extension.ts` for how the suites start the application they drive.

import { readFile } from "node:fs/promises";
import * as path from "node:path";
import {
  ARTIFACTS_DIR,
  BACKUPS,
  captureScreenshot,
  navigate,
  openPage,
  openWorkspace,
  RESTORES,
  showList,
  waitForList,
  wordsOf,
} from "./velero-cluster";
import { EXTENSION_NAME } from "./velero-extension";

import type { Frame, Locator } from "playwright";

import type { ListOf } from "./velero-cluster";

/** The operations whose workspace has the tabs. */
export type Operation = "backup" | "restore";
/** The tabs that show what Velero wrote of an operation into its storage. */
export type ArtifactTab = "log" | "results" | "resources" | "volumes";
export type WorkspaceTab = "summary" | ArtifactTab;

/** The tabs of a workspace, in their order, with the title each one shows. */
export const TABS: readonly { id: WorkspaceTab; title: string }[] = [
  { id: "summary", title: "Summary" },
  { id: "log", title: "Log" },
  { id: "results", title: "Results" },
  { id: "resources", title: "Resources" },
  { id: "volumes", title: "Volumes" },
];

/** The diagnostic tabs, in their order. */
export const ARTIFACT_TABS: readonly ArtifactTab[] = ["log", "results", "resources", "volumes"];

/**
 * What each diagnostic tab shows, as a sentence names it, and the kind of
 * DownloadRequest it asks for, by the kind of its operation.
 */
export const ARTIFACTS: Record<ArtifactTab, { noun: string; plural: boolean; targets: Record<Operation, string> }> = {
  log: { noun: "log", plural: false, targets: { backup: "BackupLog", restore: "RestoreLog" } },
  results: { noun: "results", plural: true, targets: { backup: "BackupResults", restore: "RestoreResults" } },
  resources: {
    noun: "resource list",
    plural: false,
    targets: { backup: "BackupResourceList", restore: "RestoreResourceList" },
  },
  volumes: {
    noun: "volume information",
    plural: false,
    targets: { backup: "BackupVolumeInfos", restore: "RestoreVolumeInfo" },
  },
};

/** The levels a log is filtered by, in the order of their choices. */
export const LOG_LEVELS = ["error", "warning", "info", "debug", "other"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

/** The choices of the filter by action of the resource list of a restore, in their order. */
export const ACTION_CHOICES = ["all", "created", "updated", "failed", "skipped", "not-stated"] as const;
export type ActionChoice = (typeof ACTION_CHOICES)[number];

const LISTS: Record<Operation, ListOf> = { backup: BACKUPS, restore: RESTORES };

/** How long a part is waited for before the case that asked for it fails by the name of the part. */
const PART_TIMEOUT = 30_000;
/** How long a load is given: the main process gives a request two minutes, and the pages of its text follow. */
const LOAD_TIMEOUT = 150_000;
/**
 * The height of a line of a list of lines, in pixels: a row is as tall as the lines it takes. It mirrors
 * LINE of src/renderer/components/artifact-lines.tsx, which the suites do not import: the case of the
 * measures reads the height of one mounted row and checks it against this, so that a line height the
 * product changed fails there, by its name, and not by the rows every gesture then misses.
 */
export const LINE_HEIGHT = 20;

/** When a load is cancelled: as soon as it begins, or once its request is in the cluster. */
export type CancelAt = boolean | "created";

// The parts of the panel of a diagnostic tab, by what each is, with the end of its identifier.
const OF_THE_PANEL = {
  // What is said of a text that was loaded, over it, and under it of its request and of the way it came by.
  loaded: "loaded",
  through: "through",
  route: "route",
  notes: "notes",
  // How a load ended without its text: its words, and what a missing file means for the phase.
  failure: "failure",
  failureText: "failure-text",
  missing: "missing",
  // What the tab is doing, in the words that are seen, and as it is said to who does not see.
  status: "status",
  said: "said",
  cancel: "cancel",
  // What is offered after a load that is not to be asked again.
  notAgain: "not-again",
  begin: "begin",
  // What is said of an operation Velero signs no URL for.
  nothing: "nothing",
  // The first state while writes are not on, and the way to the target bar.
  writesOff: "writes-off",
  toTarget: "to-target",
  // What the command does, and the command.
  what: "what",
  create: "create",
  allow: "allow",
  allowFailure: "allow-failure",
  // The confirmation of the request, with its two commands.
  confirm: "confirm",
  confirmCreate: "confirm-create",
  confirmBack: "confirm-back",
  // The saving of a text.
  save: "save",
  saving: "saving",
  saveUntil: "save-until",
  viewer: "viewer",
} as const;

export type PanelPart = keyof typeof OF_THE_PANEL;

// The parts of a viewer, by what each is, with the end of its identifier.
const OF_A_VIEWER = {
  // A text shown as its lines: the log, and an artifact of another shape, which has a note over it. The
  // list of the lines is the text, and the part of it that scrolls is its rows.
  note: "note",
  wrap: "wrap",
  count: "count",
  text: "text",
  none: "none",
  left: "left",
  copied: "copied",
  // The search of the log and its levels.
  search: "search",
  searchPrevious: "search-previous",
  searchNext: "search-next",
  searchStatus: "search-status",
  levels: "levels",
  // The results.
  summary: "summary",
  differs: "differs",
  shown: "shown",
  errors: "errors",
  warnings: "warnings",
  // The resource list: its filter, its choices by action, its table, what scrolls, and its two kinds of rows.
  // What scrolls is the rows, as it is of a list of lines.
  filter: "filter",
  actions: "actions",
  table: "table",
  rows: "rows",
  kind: "kind",
  item: "item",
} as const;

export type ViewerPart = keyof typeof OF_A_VIEWER;

/**
 * The identifiers of the parts of the tabs, written once, as the components
 * write them. Every reader of this file finds a part through here.
 */
export const PARTS = {
  /** The view of an operation, and the name it shows. */
  workspace: (kind: Operation) => `velero-${kind}-workspace`,
  name: (kind: Operation) => `velero-${kind}-name`,
  /** The strip of the tabs of a workspace, one tab of it, and what shows the tab that is open. */
  strip: (kind: Operation) => `velero-${kind}-tabs`,
  tab: (kind: Operation, tab: WorkspaceTab) => `velero-${kind}-tab-${tab}`,
  shown: (kind: Operation) => `velero-${kind}-panel`,
  /** The panel of a diagnostic tab, or one part of it. */
  panel: (kind: Operation, tab: ArtifactTab, part?: PanelPart) =>
    part ? `velero-${kind}-${tab}-${OF_THE_PANEL[part]}` : `velero-${kind}-${tab}`,
  /** The viewer of a diagnostic tab, or one part of it. */
  viewer: (kind: Operation, tab: ArtifactTab, part?: ViewerPart) =>
    part ? `velero-${kind}-${tab}-viewer-${OF_A_VIEWER[part]}` : `velero-${kind}-${tab}-viewer`,
  /** A line of a text, by its number, or its command that copies, its words, or what says that it was cut. */
  line: (kind: Operation, tab: ArtifactTab, line: number, part?: "copy" | "text" | "cut") =>
    `velero-${kind}-${tab}-viewer-line-${line}${part ? `-${part}` : ""}`,
  /** The choice of a level of the log. */
  level: (kind: Operation, level: LogLevel) => `velero-${kind}-log-viewer-level-${level}`,
  /** The choice of an action of the resource list of a restore. */
  action: (kind: Operation, choice: ActionChoice) => `velero-${kind}-resources-viewer-action-${choice}`,
  /** The command that opens the details of a volume, by the place of its row, and the details. */
  volumeToggle: (kind: Operation, row: number) => `velero-${kind}-volumes-viewer-toggle-${row}`,
  volumeDetails: (kind: Operation, row: number) => `velero-${kind}-volumes-viewer-details-${row}`,
  /** What the details of the host show of an operation: the section, its words of the tabs, and its way to the view. */
  details: (kind: Operation) => `velero-${kind}-details`,
  detailsWords: (kind: Operation) => `velero-${kind}-details-artifacts`,
  detailsLink: (kind: Operation) => `velero-${kind}-details-link`,
};

const selector = (id: string) => `[data-testid="${id}"]`;

// What a part of a URL the server signed looks like, for the store of the test environment and for any other
// that signs the way it does.
const SIGNED = /X-Amz-|Signature=|AWSAccessKeyId=/i;
// What stands in the place of words that carry such a part.
const NOT_REPEATED = "(words that carry a part of a signed URL, which are not repeated)";

/**
 * Words as a helper answers them. The ones that carry a part of a signed URL are not repeated: what a
 * helper answers is printed by the expectation that fails on it, and written into the reports of a run.
 */
function repeatable(words: string): string {
  return SIGNED.test(words) ? NOT_REPEATED : words;
}

/**
 * Reads until what is read is as expected, and answers it. When the time is
 * over it says what was waited for and what was last read.
 */
export async function until<Read>(
  what: string,
  read: () => Promise<Read>,
  like: (found: Read) => boolean,
  timeout = PART_TIMEOUT,
): Promise<Read> {
  const deadline = Date.now() + timeout;

  for (;;) {
    const found = await read();

    if (like(found)) return found;
    if (Date.now() >= deadline) {
      throw new Error(`${what}: not so after ${timeout / 1000} s. What was last read: ${JSON.stringify(found)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

/**
 * A part that has to be in the page, by its identifier. One that is not there
 * when its time is over fails by its name, with a picture of the frame.
 */
export async function part(frame: Frame, id: string, timeout = PART_TIMEOUT): Promise<Locator> {
  const found = frame.locator(selector(id)).first();

  try {
    await found.waitFor({ state: "attached", timeout });
  } catch {
    const screenshot = await captureScreenshot(frame, `missing-part-${id}`);

    throw new Error(
      `The part ${id} is not in the page after ${timeout / 1000} s.${screenshot ? ` Screenshot: ${screenshot}` : ""}`,
    );
  }

  return found;
}

/** Whether a part is in the page now. A part that is expected not to be there is asked for this way. */
export async function present(frame: Frame, id: string): Promise<boolean> {
  return (await frame.locator(selector(id)).count()) > 0;
}

/** Waits for a part to leave the page, and says which one stayed. */
export async function gone(frame: Frame, id: string, timeout = PART_TIMEOUT): Promise<void> {
  try {
    await frame.locator(selector(id)).first().waitFor({ state: "detached", timeout });
  } catch {
    throw new Error(`The part ${id} is still in the page after ${timeout / 1000} s`);
  }
}

/** An attribute a part has to write, as it is written. */
export async function attribute(frame: Frame, id: string, name: string): Promise<string> {
  const value = await (await part(frame, id)).getAttribute(name);

  if (value === null) throw new Error(`The part ${id} does not write ${name}`);

  return value;
}

/** An attribute a part has to write as a number. */
export async function numberOf(frame: Frame, id: string, name: string): Promise<number> {
  const value = await attribute(frame, id, name);

  if (value.trim() === "" || !Number.isFinite(Number(value))) {
    throw new Error(`The part ${id} writes ${name}="${value}", which is not a number`);
  }

  return Number(value);
}

/** Waits for an attribute of a part to be what is expected, and says what it is when the time is over. */
export async function attributeLike(
  frame: Frame,
  id: string,
  name: string,
  expected: string,
  timeout = PART_TIMEOUT,
): Promise<void> {
  await part(frame, id, timeout);
  await until(
    `The part ${id} writes ${name}="${expected}"`,
    () => frame.locator(selector(id)).first().getAttribute(name),
    (value) => value === expected,
    timeout,
  );
}

/** A click on a part that has to be in the page. */
export async function clickOn(frame: Frame, id: string): Promise<void> {
  await (await part(frame, id)).click();
}

/**
 * What a part that has to be in the page says in words, as it is read, without the names of its marks.
 * Words that carry a part of a signed URL are not repeated.
 */
export async function said(frame: Frame, id: string): Promise<string> {
  await part(frame, id);

  return repeatable(await wordsOf(frame, selector(id)));
}

/** The address of the view of an operation over the list of its kind, at a tab of it. */
export function viewAddress(kind: Operation, name: string, tab: WorkspaceTab = "summary"): string {
  const page = `/extension/${EXTENSION_NAME.replace(/^@/, "").replace(/\//g, "--")}/${LISTS[kind].id}`;
  const search = new URLSearchParams({ view: `${kind}/${name}`, ...(tab === "summary" ? {} : { tab }) });

  return `${page}?${search.toString()}`;
}

/** Waits for the view of an operation to be shown at a tab: its name, the tab that is selected, and what it shows. */
export async function shownAt(frame: Frame, kind: Operation, name: string, tab: WorkspaceTab): Promise<void> {
  const read = () =>
    frame.evaluate(
      ({ title, panel, chosen }) => ({
        name: (document.querySelector<HTMLElement>(`[data-testid="${title}"]`)?.innerText ?? "").trim(),
        open: document.querySelector(`[data-testid="${panel}"]`)?.getAttribute("data-tab") ?? "",
        selected: document.querySelector(`[data-testid="${chosen}"]`)?.getAttribute("aria-selected") ?? "",
      }),
      { title: PARTS.name(kind), panel: PARTS.shown(kind), chosen: PARTS.tab(kind, tab) },
    );

  try {
    await until(
      `The view of the ${kind} ${name} is shown at its tab ${tab}`,
      read,
      (found) => found.name === name && found.open === tab && found.selected === "true",
    );
  } catch (error) {
    const screenshot = await captureScreenshot(frame, `view-of-${kind}-not-at-${tab}`);

    throw new Error(`${(error as Error).message}${screenshot ? ` Screenshot: ${screenshot}` : ""}`);
  }
}

/**
 * Whether the view that is shown is the one of this operation. A case that goes on from where the one
 * before it left asks this first: a view that is opened again holds nothing of what its tabs loaded.
 */
export async function viewOf(frame: Frame, kind: Operation, name: string): Promise<boolean> {
  return frame.evaluate(
    ({ view, title, name }) =>
      document.querySelector(`[data-testid="${view}"]`) !== null &&
      (document.querySelector<HTMLElement>(`[data-testid="${title}"]`)?.innerText ?? "").trim() === name,
    { view: PARTS.workspace(kind), title: PARTS.name(kind), name },
  );
}

/**
 * Opens the list of the kind of an operation from the sidebar, leaves whatever
 * view is open, and opens the view of the operation from its row: where a case
 * starts from, whatever the case before it left. A view that was open is
 * closed by this, and what its tabs had loaded goes with it.
 */
export async function openWorkspaceOf(frame: Frame, kind: Operation, name: string): Promise<void> {
  await openPage(frame, LISTS[kind]);
  await showList(frame);
  await waitForList(frame, LISTS[kind]);
  await openWorkspace(frame, name, LISTS[kind]);
  await shownAt(frame, kind, name, "summary");
}

/** Opens a tab of the view that is shown, by a click on it, and waits for the view to show it. */
export async function openTab(frame: Frame, kind: Operation, tab: WorkspaceTab): Promise<void> {
  await (await part(frame, PARTS.tab(kind, tab))).click();
  await attributeLike(frame, PARTS.shown(kind), "data-tab", tab);
  await attributeLike(frame, PARTS.tab(kind, tab), "aria-selected", "true");
}

/** Opens the view of an operation by its address, at a tab of it, and waits for the view to show the tab. */
export async function openAt(frame: Frame, kind: Operation, name: string, tab: WorkspaceTab): Promise<void> {
  await navigate(frame, viewAddress(kind, name, tab));
  await shownAt(frame, kind, name, tab);
}

export interface TabsShown {
  /** The role of the strip, and what it is called for who does not see it. */
  role: string;
  name: string;
  /** The tabs, in their order. */
  tabs: { id: string; title: string; role: string; selected: string; controls: string }[];
  /** The tabs that say they are selected, by their identifiers. */
  selected: string[];
  /** The tab the view shows, as the part that shows it says. */
  open: string;
  /** The part that shows the tab: its role, its identifier, and the tab it says it is named by. */
  panel: { role: string; id: string; labelled: string };
  /** The tab the address names: none for the summary. */
  address: string;
}

/** The tabs of the view that is shown, with their roles and which one is selected, and the tab of the address. */
export async function tabsOf(frame: Frame, kind: Operation): Promise<TabsShown> {
  await part(frame, PARTS.strip(kind));
  await part(frame, PARTS.shown(kind));

  return frame.evaluate(
    ({ strip, shown }) => {
      const list = document.querySelector<HTMLElement>(`[data-testid="${strip}"]`);
      const panel = document.querySelector<HTMLElement>(`[data-testid="${shown}"]`);

      if (!list || !panel) throw new Error(`The tabs ${strip} went while they were read`);
      const tabs = [...list.children].map((tab) => ({
        id: tab.getAttribute("data-testid") ?? "",
        title: (tab.querySelector<HTMLElement>(".label")?.innerText ?? "").trim(),
        role: tab.getAttribute("role") ?? "",
        selected: tab.getAttribute("aria-selected") ?? "",
        controls: tab.getAttribute("aria-controls") ?? "",
      }));

      return {
        role: list.getAttribute("role") ?? "",
        name: list.getAttribute("aria-label") ?? "",
        tabs,
        selected: tabs.filter((tab) => tab.selected === "true").map((tab) => tab.id),
        open: panel.getAttribute("data-tab") ?? "",
        panel: {
          role: panel.getAttribute("role") ?? "",
          id: panel.id,
          labelled: panel.getAttribute("aria-labelledby") ?? "",
        },
        address: new URLSearchParams(window.location.search).get("tab") ?? "",
      };
    },
    { strip: PARTS.strip(kind), shown: PARTS.shown(kind) },
  );
}

export interface PanelState {
  /** Where the load of the tab is: first, asking, confirming, loading, loaded or failed. */
  step: string;
  /** The step a load is at, and the request it runs, while it loads. */
  at: string;
  request: string;
  /** What the tab is doing, in the words that are seen, and as it is said to who does not see. */
  status: string;
  spoken: string;
  /** The commands of the panel outside its viewer, by their identifiers, in their order. */
  commands: string[];
  /** Whether a text is shown, and the request it came through when one is. */
  viewer: boolean;
  shown: string;
}

/**
 * What the panel of a diagnostic tab says of where its load is. Words that carry a part of a signed URL
 * are not repeated.
 */
export async function panelState(frame: Frame, kind: Operation, tab: ArtifactTab): Promise<PanelState> {
  const id = PARTS.panel(kind, tab);

  await part(frame, id);
  const state = await frame.evaluate((id) => {
    const panel = document.querySelector<HTMLElement>(`[data-testid="${id}"]`);

    if (!panel) throw new Error(`The part ${id} went while it was read`);
    const within = (suffix: string) => panel.querySelector<HTMLElement>(`[data-testid="${id}-${suffix}"]`);
    const viewer = within("viewer");

    return {
      step: panel.getAttribute("data-step") ?? "",
      at: panel.getAttribute("data-at") ?? "",
      request: panel.getAttribute("data-request") ?? "",
      status: (within("status")?.innerText ?? "").replace(/\s+/g, " ").trim(),
      // What is said to who does not see is not drawn: it is read as it is written.
      spoken: (within("said")?.textContent ?? "").replace(/\s+/g, " ").trim(),
      commands: [...panel.querySelectorAll<HTMLElement>("button, a[href]")]
        .filter((command) => !viewer?.contains(command))
        .map(
          (command) => command.getAttribute("data-testid") ?? `a command without an identifier: ${command.innerText}`,
        ),
      viewer: viewer !== null,
      shown: within("loaded")?.getAttribute("data-request") ?? "",
    };
  }, id);

  return { ...state, status: repeatable(state.status), spoken: repeatable(state.spoken) };
}

/** The object the confirmation of a tab shows, field by field, as it will be submitted. */
export async function confirmationOf(frame: Frame, kind: Operation, tab: ArtifactTab): Promise<Record<string, string>> {
  const id = PARTS.panel(kind, tab, "confirm");

  await part(frame, id);
  const fields = await frame.$$eval(`${selector(id)} [data-field]`, (rows) =>
    rows.map((row) => [
      row.getAttribute("data-field") ?? "",
      (row.querySelector<HTMLElement>("dd")?.innerText ?? "").replace(/\s+/g, " ").trim(),
    ]),
  );

  if (fields.length === 0) throw new Error(`The confirmation ${id} shows no field of the object`);

  return Object.fromEntries(fields);
}

/** The first gesture of a load: the command of the tab, then the object it would create. Nothing is created. */
export async function ask(frame: Frame, kind: Operation, tab: ArtifactTab): Promise<void> {
  await (await part(frame, PARTS.panel(kind, tab, "create"))).click();
  await part(frame, PARTS.panel(kind, tab, "confirm"));
}

export interface LoadMoment {
  /** Milliseconds since the watch began, on the clock of the page. */
  time: number;
  /** Where the load was, the step it was at and the request it ran. */
  step: string;
  at: string;
  request: string;
  /** What the tab said it was doing, in the words that are seen. */
  status: string;
  /** The request of the text that was shown, when one was, and whether its viewer was drawn. */
  shown: string;
  viewer: boolean;
}

interface LoadWatch {
  moments: LoadMoment[];
  observer: MutationObserver;
  cancelled: boolean;
}

/**
 * Watches the panel of a tab from inside the page, from now on: every state it
 * shows, with the step, the request and the words of each, is kept with its
 * time, so that what is expected of a load does not depend on when the driver
 * of the suite looked. Asked to cancel, it gives the command that cancels as
 * soon as the panel offers it, which is when the load begins, or, asked to
 * cancel once the request is created, as soon as the panel is at a step after
 * the creation: the request is then in the cluster, whatever the cancel ends.
 */
export async function watchLoad(
  frame: Frame,
  kind: Operation,
  tab: ArtifactTab,
  options: { cancel?: CancelAt } = {},
): Promise<void> {
  const id = PARTS.panel(kind, tab);

  await part(frame, id);
  await frame.evaluate(
    ({ id, cancel, created }) => {
      const page = window as unknown as { veleroLoads?: Record<string, LoadWatch> };

      if (!page.veleroLoads) page.veleroLoads = {};
      page.veleroLoads[id]?.observer.disconnect();
      const started = performance.now();
      const moments: LoadMoment[] = [];
      const look = () => {
        const panel = document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
        const within = (suffix: string) => panel?.querySelector<HTMLElement>(`[data-testid="${id}-${suffix}"]`);
        const moment: LoadMoment = {
          time: Math.round(performance.now() - started),
          step: panel?.getAttribute("data-step") ?? "not shown",
          at: panel?.getAttribute("data-at") ?? "",
          request: panel?.getAttribute("data-request") ?? "",
          status: (within("status")?.innerText ?? "").replace(/\s+/g, " ").trim(),
          shown: within("loaded")?.getAttribute("data-request") ?? "",
          viewer: within("viewer") != null,
        };
        const last = moments[moments.length - 1];

        if (
          !last ||
          last.step !== moment.step ||
          last.at !== moment.at ||
          last.request !== moment.request ||
          last.status !== moment.status ||
          last.shown !== moment.shown ||
          last.viewer !== moment.viewer
        ) {
          moments.push(moment);
        }
        if (cancel && !watch.cancelled) {
          const command = within("cancel");
          // Once the request is created, the panel is at a step after the creation.
          const ready = cancel === "created" ? created.includes(moment.at) : true;

          if (command && ready) {
            watch.cancelled = true;
            command.click();
          }
        }
      };
      const watch: LoadWatch = { moments, cancelled: false, observer: new MutationObserver(look) };

      page.veleroLoads[id] = watch;
      watch.observer.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
      look();
    },
    { id, cancel: options.cancel ?? false, created: [...AFTER_THE_CREATION, "pages"] },
  );
}

/**
 * What the panel of a tab showed since it is watched, from the first state, and ends the watch. Words that
 * carry a part of a signed URL are not repeated.
 */
export async function loadSeen(frame: Frame, kind: Operation, tab: ArtifactTab): Promise<LoadMoment[]> {
  const id = PARTS.panel(kind, tab);
  const moments = await frame.evaluate((id) => {
    const watch = (window as unknown as { veleroLoads?: Record<string, LoadWatch> }).veleroLoads?.[id];

    if (!watch) return null;
    watch.observer.disconnect();
    return watch.moments;
  }, id);

  if (!moments) throw new Error(`The panel ${id} is not watched: watchLoad comes before the confirmation`);

  return moments.map((moment) => ({ ...moment, status: repeatable(moment.status) }));
}

/**
 * The second gesture of a load: the panel is watched, then the command of the
 * confirmation creates the request. With `cancel`, the load is cancelled as
 * soon as it begins, or once its request is created. With `keyboard`, the
 * command is given with Enter on it, and not with a click: the journeys with
 * the keyboard alone give it so.
 */
export async function confirm(
  frame: Frame,
  kind: Operation,
  tab: ArtifactTab,
  options: { cancel?: CancelAt; keyboard?: boolean } = {},
): Promise<void> {
  await watchLoad(frame, kind, tab, { cancel: options.cancel });
  const command = await part(frame, PARTS.panel(kind, tab, "confirmCreate"));

  if (options.keyboard) await command.press("Enter");
  else await command.click();
}

/**
 * Waits for a load to end, with its text or without it, and answers how. A
 * load that does not end says where it was left, with a picture of the frame.
 */
export async function loadEnded(
  frame: Frame,
  kind: Operation,
  tab: ArtifactTab,
  timeout = LOAD_TIMEOUT,
): Promise<"loaded" | "failed"> {
  try {
    const state = await until(
      `The load of the ${ARTIFACTS[tab].noun} of the ${kind} ended`,
      () => panelState(frame, kind, tab),
      (found) => found.step === "loaded" || found.step === "failed",
      timeout,
    );

    return state.step === "loaded" ? "loaded" : "failed";
  } catch (error) {
    const screenshot = await captureScreenshot(frame, `load-of-${kind}-${tab}-did-not-end`);

    throw new Error(`${(error as Error).message}${screenshot ? ` Screenshot: ${screenshot}` : ""}`);
  }
}

/** How a load ended without its text: its code, the step it ended at, and its words. */
export async function failureOf(
  frame: Frame,
  kind: Operation,
  tab: ArtifactTab,
): Promise<{ code: string; stage: string; text: string }> {
  const id = PARTS.panel(kind, tab, "failure");

  return {
    code: await attribute(frame, id, "data-code"),
    stage: await attribute(frame, id, "data-stage"),
    text: await said(frame, PARTS.panel(kind, tab, "failureText")),
  };
}

export interface Loaded {
  /** The name of the request the text came through. */
  request: string;
  /** The bytes of the text. */
  size: number;
  /** How the bytes came: through a tunnel to the Pod of the store, or directly from this machine. */
  route: string;
  /** What the tab says of the text, of the request it came through, and of the way it came by. */
  said: string;
  through: string;
  came: string;
}

/**
 * The facts of the text a tab loaded. A tab that holds none says how its load
 * ended instead, in the failure of the case.
 */
export async function loadedFacts(frame: Frame, kind: Operation, tab: ArtifactTab): Promise<Loaded> {
  const state = await panelState(frame, kind, tab);
  const what = `The ${ARTIFACTS[tab].noun} of the ${kind}`;

  if (state.step === "failed" && !state.viewer) {
    const failure = await failureOf(frame, kind, tab);

    throw new Error(`${what} is not loaded: the load ended as ${failure.code} at ${failure.stage}. ${failure.text}`);
  }
  if (!state.viewer) throw new Error(`${what} is not loaded: its tab is at ${state.step}`);
  const loaded = PARTS.panel(kind, tab, "loaded");
  const route = PARTS.panel(kind, tab, "route");

  return {
    request: await attribute(frame, loaded, "data-request"),
    size: await numberOf(frame, loaded, "data-size"),
    route: await attribute(frame, route, "data-route"),
    said: await said(frame, loaded),
    through: await said(frame, PARTS.panel(kind, tab, "through")),
    came: await said(frame, route),
  };
}

/**
 * The name the panel gave the request of a load when the load began, which is the name the request has in
 * the cluster once it is created, or nothing for a load that never began.
 */
export function requestOf(moments: readonly LoadMoment[]): string {
  return moments.find((moment) => moment.step === "loading" && moment.request !== "")?.request ?? "";
}

/**
 * The second gesture of a load, and its end, however it ends: the panel is watched, the command of the
 * confirmation creates the request, and the load is waited for. The name the panel gave the request is
 * given to `named` before this answers or fails, whatever became of the load: a request can be in the
 * cluster after a load that ended without its text, or that did not end, and who asked for it has to know
 * it by its name. With `cancel`, the load is cancelled as soon as it begins, or once its request is
 * created. With `keyboard`, the command of the confirmation is given with Enter. What is done right after
 * the gesture, to look at a step of the load, is given as `loading`.
 */
export async function runLoad(
  frame: Frame,
  kind: Operation,
  tab: ArtifactTab,
  named: (request: string) => void,
  options: { cancel?: CancelAt; keyboard?: boolean; loading?: () => Promise<void> } = {},
): Promise<{ ended: "loaded" | "failed"; moments: LoadMoment[]; request: string }> {
  await confirm(frame, kind, tab, { cancel: options.cancel ?? false, keyboard: options.keyboard === true });
  let ended: "loaded" | "failed" | undefined;
  let moments: LoadMoment[] = [];
  let failed: unknown;

  try {
    await options.loading?.();
    ended = await loadEnded(frame, kind, tab);
  } catch (error) {
    failed = error;
  }
  try {
    moments = await loadSeen(frame, kind, tab);
  } catch (error) {
    failed ??= error;
  }
  const request = requestOf(moments);

  // The name is given whatever happened so far, and what happened first is what is said.
  try {
    named(request);
  } catch (error) {
    failed ??= error;
  }
  if (failed !== undefined) throw failed;
  if (ended === undefined) throw new Error(`The load of the ${ARTIFACTS[tab].noun} of the ${kind} did not end`);

  return { ended, moments, request };
}

/**
 * One load, from the command of the tab to its text: the two gestures, the
 * wait, and the facts of what was loaded with everything the panel showed
 * meanwhile. The name of its request is given to `named` however the load
 * ends, as `runLoad` gives it. What is done between the two gestures and right
 * after the second is given by the caller, to look at the confirmation and at
 * a step of the load.
 */
export async function load(
  frame: Frame,
  kind: Operation,
  tab: ArtifactTab,
  named: (request: string) => void,
  between: { confirming?: () => Promise<void>; loading?: () => Promise<void> } = {},
): Promise<Loaded & { moments: LoadMoment[] }> {
  await ask(frame, kind, tab);
  await between.confirming?.();
  const { moments } = await runLoad(frame, kind, tab, named, { loading: between.loading });

  return { ...(await loadedFacts(frame, kind, tab)), moments };
}

/**
 * The steps the main process tells of a DownloadRequest, in their order, and
 * the taking of the pages of the text after them. The object the artifact is
 * of is read twice, the second time right before the request is created.
 */
export const STEPS: Record<Operation, readonly string[]> = {
  backup: [
    "queue",
    "target",
    "location",
    "certificate",
    "target",
    "creation",
    "wait",
    "route",
    "download",
    "delivery",
    "pages",
  ],
  restore: [
    "queue",
    "target",
    "backup",
    "location",
    "certificate",
    "target",
    "creation",
    "wait",
    "route",
    "download",
    "delivery",
    "pages",
  ],
};

/**
 * The steps before the request is created, and the ones after it is in the cluster: the last of them is
 * the closing of what the download opened, which a load can be cancelled at as at any other.
 */
export const BEFORE_THE_CREATION = ["queue", "target", "backup", "location", "certificate"];
export const AFTER_THE_CREATION = [
  "wait",
  "route",
  "service",
  "endpoints",
  "pod",
  "forward",
  "download",
  "delivery",
  "release",
];

/** The steps a load was seen at, each once for as long as the panel stayed at it, in the order they were seen. */
export function stepsSeen(moments: LoadMoment[]): string[] {
  const steps: string[] = [];

  for (const moment of moments) {
    if (moment.step === "loading" && steps[steps.length - 1] !== moment.at) steps.push(moment.at);
  }

  return steps;
}

/**
 * Whether the steps that were seen are, in their order, among the ones that
 * are told: the main process is asked where it is four times a second, so a
 * step may pass unseen, and none is seen out of its place.
 */
export function inTheOrder(seen: readonly string[], told: readonly string[]): boolean {
  let from = 0;

  for (const step of seen) {
    const found = told.indexOf(step, from);

    if (found < 0) return false;
    from = found + 1;
  }

  return true;
}

/**
 * The steps only the main process tells. The other two are drawn by the views by themselves: the wait for
 * a place when the load begins, before anything is asked, and the pages while the text is taken. A load
 * seen at those two alone says nothing of whether the main process was ever asked where it is.
 */
export const TOLD_BY_THE_MAIN_PROCESS: readonly string[] = [
  "target",
  "backup",
  "location",
  "certificate",
  "creation",
  "wait",
  "route",
  "download",
  "delivery",
];

/**
 * What was seen of the part of a load the main process runs: for how long the panel showed it, in
 * milliseconds on the clock of the page, from the moment the load began to the first page of its text or
 * to its end without one, and the steps seen meanwhile that only the main process tells. The views ask the
 * main process where it is four times a second: a part that lasted less than a few of those may have been
 * seen at no step of it.
 */
export function toldByTheMainProcess(moments: readonly LoadMoment[]): { lasted: number; told: string[] } {
  const began = moments.findIndex((moment) => moment.step === "loading");

  if (began < 0) return { lasted: 0, told: [] };
  const after = moments.findIndex((moment, at) => at > began && (moment.step !== "loading" || moment.at === "pages"));
  const run = moments.slice(began, after < 0 ? moments.length : after);
  const ended = after < 0 ? moments[moments.length - 1] : moments[after];

  return {
    lasted: ended.time - moments[began].time,
    told: [...new Set(run.map((moment) => moment.at).filter((step) => TOLD_BY_THE_MAIN_PROCESS.includes(step)))],
  };
}

/**
 * The pages of the text the panel said it was taking, in the order they were seen: each with the count of
 * the pages there are. The views count the pages themselves, and write the two numbers into the words of
 * the step as they are.
 */
export function pagesSeen(moments: readonly LoadMoment[]): { page: number; of: number }[] {
  return moments.flatMap((moment) => {
    if (moment.step !== "loading" || moment.at !== "pages") return [];
    const found = /: page (\d+) of (\d+)\.$/.exec(moment.status);

    return found ? [{ page: Number(found[1]), of: Number(found[2]) }] : [];
  });
}

const UNITS: Record<string, number> = { B: 1, KiB: 1024, MiB: 1024 ** 2, GiB: 1024 ** 3 };

/**
 * The bytes the panel said had come so far while the file was downloaded, in the order they were seen,
 * as the words of the step round them: in the unit that reads best, to a tenth of it. Nothing for a
 * download whose words told no bytes.
 */
export function bytesSeen(moments: readonly LoadMoment[]): number[] {
  return moments.flatMap((moment) => {
    if (moment.step !== "loading" || moment.at !== "download") return [];
    const found = /: (\d+(?:\.\d)?) (B|KiB|MiB|GiB) so far\.$/.exec(moment.status);

    return found ? [Number(found[1]) * UNITS[found[2]]] : [];
  });
}

function pattern(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * What the tab says while a load is at a step, as a pattern: the words of the
 * step, with what the step counts where it counts something, which is read
 * here as a number that is there and not as the number it is.
 */
export function stepWords(step: string, request: string): RegExp {
  const named = pattern(request);
  const steps: Record<string, string> = {
    queue: "Starting the load\\. Two artifacts at most are loaded at the same time: a third one waits for its turn\\.",
    target: "Reading the object the artifact is of\\.",
    backup: "Reading the backup of the restore\\.",
    location: "Reading the storage location\\.",
    certificate: "Reading the certificate of the storage location\\.",
    creation: `Creating the DownloadRequest ${named}\\.`,
    wait: `The DownloadRequest ${named} is created\\. Waiting for Velero to sign its URL(: \\d+ seconds so far, of thirty at most)?\\.`,
    route: "Finding the way to the store\\.",
    download: "Downloading and decompressing the file(: \\d+(\\.\\d)? (B|KiB|MiB|GiB) so far)?\\.",
    delivery: "Checking that the object is still the one that was asked\\.",
    pages: "Taking the text from the main process(: page \\d+ of \\d+)?\\.",
  };

  return new RegExp(`^${steps[step] ?? `no words are written for the step ${pattern(step)}`}$`);
}

/**
 * Where a part of a signed URL is, among the texts that are given, each under the name of what it is the
 * text of. The names are answered and never a text: a URL the server signed is not to be shown, kept or
 * printed, and what an expectation is given is printed when it fails. Words a helper did not repeat are
 * found as well.
 */
export function signedUrlIn(texts: Record<string, string>): string[] {
  return Object.entries(texts)
    .filter(([, text]) => SIGNED.test(text) || text.includes(NOT_REPEATED))
    .map(([name]) => name);
}

/**
 * What a suite asked the extension to create, by the names the tabs gave of
 * the requests: it is what the guard of the suite is told, to compare with
 * what the cluster holds and with what the API server counted.
 */
export function requestLedger(): { add(name: string): void; asked(): string[] } {
  const names: string[] = [];

  return {
    add(name: string) {
      if (!name) throw new Error("A request is told to the guard by its name, and this one has none");
      if (names.includes(name))
        throw new Error(`The request ${name} was told to the guard already: a load is a new one`);
      names.push(name);
    },
    asked: () => [...names].sort(),
  };
}

/** The lines of a text as the tabs count them: a line ends at its break, and nothing follows the last break. */
export function linesOf(text: string): string[] {
  if (text === "") return [];
  const lines = text.split("\n");

  if (lines[lines.length - 1] === "") lines.pop();

  return lines.map((line) => (line.endsWith("\r") ? line.slice(0, -1) : line));
}

/** The numbers of the lines that carry some words, whatever their capitals, counted from one. */
export function matchingLines(lines: readonly string[], words: string): number[] {
  const carried = new RegExp(pattern(words), "i");

  return lines.flatMap((line, index) => (carried.test(line) ? [index + 1] : []));
}

/**
 * The level of a line of a log in the text format of the server, read as an
 * operator reads it: after the time the line begins with, the word that
 * follows `level=`. A line that does not begin so is of none of the four.
 */
export function levelOf(line: string): LogLevel {
  const level = /^(?:time=(?:"[^"]*"|[^\s"]+) )?level=(\S*)(?: |$)/.exec(line)?.[1] ?? "";

  return level === "error" || level === "warning" || level === "info" || level === "debug" ? level : "other";
}

/**
 * Refuses a viewer that shows its text as the lines it is, with the note of
 * another shape over it: the artifact was not of the shape of the release, and
 * what a reader of the form would answer of it would be of nothing.
 */
async function inItsForm(frame: Frame, kind: Operation, tab: ArtifactTab): Promise<void> {
  await part(frame, PARTS.viewer(kind, tab));
  if (await present(frame, PARTS.viewer(kind, tab, "note"))) {
    throw new Error(
      `The ${ARTIFACTS[tab].noun} of the ${kind} is shown as text, and not in its form: ` +
        (await said(frame, PARTS.viewer(kind, tab, "note"))),
    );
  }
}

export interface LogShown {
  /** The lines of the log, the ones a filter leaves, and the rows the list has room for. */
  lines: number;
  shown: number;
  rows: number;
  /** What the tab says of how many lines it shows. */
  count: string;
  /** Whether the lines are wrapped, and at how many columns once the room was measured. */
  wrap: boolean;
  columns: number | undefined;
  /** Each level with how many lines are of it, and whether it is chosen. */
  levels: Record<LogLevel, { count: number; chosen: boolean }>;
  search: {
    /** What the field holds, and the words the matches are of. */
    field: string;
    words: string;
    /** How many lines carry the words, the match the search is at, from zero, and its line, from one. */
    matches: number;
    match: number;
    line: number | undefined;
    said: string;
  };
  /** The lines whose rows are mounted, by their numbers, and the number each row shows. */
  mounted: number[];
  numbers: string[];
  /** The lines whose rows are marked as the match the search is at. */
  marked: number[];
  /** The lines whose rows have the words of the search marked in them, and those words as each row writes them. */
  found: number[];
  foundWords: string[];
  /** What is said in the place of the list when no line is left, or nothing. */
  none: string;
}

/** What the viewer of a log shows, read in one look: what is written together is read together. */
export async function logShown(frame: Frame, kind: Operation): Promise<LogShown> {
  const id = PARTS.viewer(kind, "log");

  await part(frame, id);

  return frame.evaluate(
    ({ id, levels }) => {
      const root = document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
      const find = (suffix: string) => root?.querySelector<HTMLElement>(`[data-testid="${id}-${suffix}"]`) ?? null;
      const need = (suffix: string) => {
        const found = find(suffix);

        if (!found) throw new Error(`The part ${id}-${suffix} is not in the page`);
        return found;
      };
      const number = (element: HTMLElement, name: string) => {
        const value = element.getAttribute(name);

        if (value === null || value.trim() === "" || !Number.isFinite(Number(value))) {
          throw new Error(
            `The part ${element.getAttribute("data-testid")} does not write ${name} as a number: ${value}`,
          );
        }
        return Number(value);
      };
      const words = (element: HTMLElement | null) => (element?.innerText ?? "").replace(/\s+/g, " ").trim();
      const count = need("count");
      const status = need("search-status");
      const list = find("text");
      const rows = [...(root?.querySelectorAll<HTMLElement>("[data-text-line]") ?? [])];
      const line = status.getAttribute("data-line");
      const columns = list?.getAttribute("data-columns");

      return {
        lines: number(count, "data-lines"),
        shown: number(count, "data-shown"),
        rows: list ? number(list, "data-rows") : 0,
        count: words(count),
        wrap: need("wrap").getAttribute("aria-pressed") === "true",
        columns: columns ? Number(columns) : undefined,
        levels: Object.fromEntries(
          levels.map((level) => {
            const choice = need(`level-${level}`);

            return [
              level,
              { count: number(choice, "data-count"), chosen: choice.getAttribute("aria-pressed") === "true" },
            ];
          }),
        ),
        search: {
          field: (need("search") as HTMLInputElement).value,
          words: status.getAttribute("data-words") ?? "",
          matches: number(status, "data-matches"),
          match: number(status, "data-match"),
          line: line ? Number(line) : undefined,
          said: words(status),
        },
        mounted: rows.map((row) => Number(row.getAttribute("data-text-line"))),
        // The number of a line is the first thing its row shows.
        numbers: rows.map((row) => words(row.querySelector<HTMLElement>("span"))),
        marked: rows
          .filter((row) => row.getAttribute("aria-current") === "true")
          .map((row) => Number(row.getAttribute("data-text-line"))),
        found: rows
          .filter((row) => row.querySelector("mark") !== null)
          .map((row) => Number(row.getAttribute("data-text-line"))),
        foundWords: [
          ...new Set(rows.flatMap((row) => [...row.querySelectorAll("mark")].map((mark) => mark.textContent ?? ""))),
        ],
        none: words(find("none")),
      };
    },
    { id, levels: [...LOG_LEVELS] },
  ) as Promise<LogShown>;
}

/** Waits for the viewer of a log to show what is expected, and answers what it shows. */
export async function logLike(
  frame: Frame,
  kind: Operation,
  what: string,
  like: (shown: LogShown) => boolean,
): Promise<LogShown> {
  return until(`The log of the ${kind} ${what}`, () => logShown(frame, kind), like);
}

/** Types words in the search of a log, and answers what the viewer shows once the search is of those words. */
export async function searchLog(frame: Frame, kind: Operation, words: string): Promise<LogShown> {
  await (await part(frame, PARTS.viewer(kind, "log", "search"))).fill(words);

  return logLike(frame, kind, `is searched by "${words}"`, (shown) => shown.search.words === words);
}

/**
 * Scrolls the list of the lines of a log to where a line is, by its number, as far as the rows before it
 * are as tall as a line, and answers what the viewer shows once the row of that line is mounted. A row
 * that is taller, which a line that is cut is, puts the line a little further down: the row of the line
 * is still among the ones the list keeps ready around its room.
 */
export async function scrollLogTo(frame: Frame, kind: Operation, line: number): Promise<LogShown> {
  const id = PARTS.viewer(kind, "log", "text");
  const rows = PARTS.viewer(kind, "log", "rows");

  await part(frame, id);
  const found = await frame.evaluate(
    ({ rows, top }) => {
      const scrolled = document.querySelector(`[data-testid="${rows}"]`);

      if (scrolled) scrolled.scrollTop = top;
      return scrolled !== null;
    },
    { rows, top: (line - 1) * LINE_HEIGHT },
  );

  if (!found) throw new Error(`The list ${id} has nothing to scroll`);

  return logLike(frame, kind, `mounts the row of its line ${line}`, (shown) => shown.mounted.includes(line));
}

/**
 * The height of the row of a line of the log, in pixels, as the page lays it out, or nothing while the row
 * is not mounted: the row of a line that is not cut is as tall as LINE_HEIGHT.
 */
export async function logRowHeight(frame: Frame, kind: Operation, line: number): Promise<number | undefined> {
  const id = PARTS.line(kind, "log", line);

  return frame.evaluate((id) => {
    const row = document.querySelector<HTMLElement>(`[data-testid="${id}"]`);

    return row ? Math.round(row.getBoundingClientRect().height) : undefined;
  }, id);
}

// How long a measure of the log waits for what it expects before it gives up and says what it last saw.
const MEASURE_TIMEOUT = 10_000;

/** What a measure of an answer of the log gives: its time in milliseconds, and the rows the list had mounted when it ended. */
export interface LogAnswer {
  ms: number;
  mounted: number;
}

/** What a scroll gesture of the log gives: each frame, in milliseconds, until the rows were the ones of the position, and the rows mounted then. */
export interface LogGesture {
  frames: number[];
  mounted: number;
}

/**
 * The pixels from the top of the list of the lines of a log to the row of a
 * line, by its number, given the lines whose rows are cut, which take two rows.
 */
export function logRowTop(line: number, tall: readonly number[]): number {
  return (line - 1) * LINE_HEIGHT + LINE_HEIGHT * tall.filter((cut) => cut < line).length;
}

/**
 * The last line whose row begins inside the room of the list, of so many
 * pixels, when the row of a line is at the top of the room: the lines from the
 * one to the other are the ones the room shows at that position.
 */
export function logRoomEnd(line: number, tall: readonly number[], room: number, lines: number): number {
  const top = logRowTop(line, tall);
  let last = line;

  while (last < lines && logRowTop(last + 1, tall) < top + room) last += 1;
  return last;
}

/** The room of the list of the lines of a log, in pixels: how much of it is shown at once. */
export async function logRoom(frame: Frame, kind: Operation): Promise<number> {
  const id = PARTS.viewer(kind, "log", "text");

  await part(frame, id);
  const room = await frame.evaluate(
    (rows) => document.querySelector<HTMLElement>(`[data-testid="${rows}"]`)?.clientHeight ?? 0,
    PARTS.viewer(kind, "log", "rows"),
  );

  if (!room) throw new Error(`The list ${id} has no room`);
  return room;
}

/**
 * Times idle frames of the window inside the page: the time from one frame to
 * the next, as many frames as asked, with nothing asked of the viewer. A
 * window that draws no frame to count, as a hidden one, is said so after ten
 * seconds, with the frames it drew.
 */
export async function frameBaseline(frame: Frame, kind: Operation, count: number): Promise<number[]> {
  await part(frame, PARTS.viewer(kind, "log", "text"));
  return frame.evaluate(
    ({ count, timeout }) =>
      new Promise<number[]>((resolve, reject) => {
        const frames: number[] = [];
        let last = performance.now();
        let over = false;
        const deadline = setTimeout(() => {
          over = true;
          reject(
            new Error(
              `The window drew ${frames.length} idle frames in ${timeout / 1000} s, and ${count} were asked: ` +
                JSON.stringify(frames.map((ms) => Math.round(ms))),
            ),
          );
        }, timeout);
        const look = () => {
          const now = performance.now();

          if (over) return;
          frames.push(now - last);
          last = now;
          if (frames.length < count) {
            requestAnimationFrame(look);
            return;
          }
          clearTimeout(deadline);
          resolve(frames);
        };

        requestAnimationFrame(look);
      }),
    { count, timeout: MEASURE_TIMEOUT },
  );
}

/**
 * Types words into the search of a log as the keys do, in one event, and
 * times inside the page what the viewer takes to answer: from the event to
 * the frame after the one where the words the matches are of, the number of
 * matches and the number of lines shown are all three the ones expected. A
 * viewer that writes the words before its matches, or a count that is not the
 * one expected, does not end the measure: after ten seconds it is said what
 * the viewer last showed. A wait of the viewer for the keys to stop, when it
 * has one, is in the time; the driver of the test is not.
 */
export async function measureLogSearch(
  frame: Frame,
  kind: Operation,
  words: string,
  expected: { matches: number; shown: number },
): Promise<LogAnswer> {
  const id = PARTS.viewer(kind, "log");

  await part(frame, id);
  return frame.evaluate(
    ({ id, words, expected, timeout }) =>
      new Promise<{ ms: number; mounted: number }>((resolve, reject) => {
        const root = document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
        const field = root?.querySelector<HTMLInputElement>(`[data-testid="${id}-search"]`);
        const status = root?.querySelector<HTMLElement>(`[data-testid="${id}-search-status"]`);
        const count = root?.querySelector<HTMLElement>(`[data-testid="${id}-count"]`);
        const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;

        if (!root || !field || !status || !count || !set) {
          reject(new Error(`The log ${id} has no search, no status of it or no count of its lines to measure`));
          return;
        }
        // A search of what is searched already changes nothing: it has no time, and is not a sample.
        if (field.value === words) {
          reject(new Error(`The log is searched by "${words}" already: nothing to measure`));
          return;
        }
        const seen = () => ({
          words: status.getAttribute("data-words") ?? "",
          matches: Number(status.getAttribute("data-matches")),
          shown: Number(count.getAttribute("data-shown")),
        });
        const answered = () => {
          const now = seen();

          return now.words === words && now.matches === expected.matches && now.shown === expected.shown;
        };
        let over = false;
        let start = 0;
        const deadline = setTimeout(() => {
          const last = seen();

          over = true;
          reject(
            new Error(
              `The search of "${words}" did not show ${expected.matches} matches of ${expected.shown} lines in ` +
                `${timeout / 1000} s: the viewer last showed the words "${last.words}", ${last.matches} matches and ` +
                `${last.shown} lines`,
            ),
          );
        }, timeout);
        const look = () => {
          if (over) return;
          if (!answered()) {
            requestAnimationFrame(look);
            return;
          }
          requestAnimationFrame(() => {
            const ms = performance.now() - start;

            clearTimeout(deadline);
            resolve({ ms, mounted: root.querySelectorAll("[data-text-line]").length });
          });
        };

        start = performance.now();
        set.call(field, words);
        field.dispatchEvent(new Event("input", { bubbles: true }));
        requestAnimationFrame(look);
      }),
    { id, words, expected, timeout: MEASURE_TIMEOUT },
  );
}

/**
 * Clicks the choice of a level of a log, and times inside the page what the
 * viewer takes to answer: from the click to the frame after the one where the
 * levels chosen are the ones expected and the number of lines shown is the
 * one expected, which is the sum of the counts of those levels. After ten
 * seconds it is said what the viewer last showed.
 */
export async function measureLogFilter(
  frame: Frame,
  kind: Operation,
  level: LogLevel,
  expected: { levels: readonly LogLevel[]; shown: number },
): Promise<LogAnswer> {
  const id = PARTS.viewer(kind, "log");

  await part(frame, id);
  return frame.evaluate(
    ({ id, level, levels, expected, timeout }) =>
      new Promise<{ ms: number; mounted: number }>((resolve, reject) => {
        const root = document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
        const choices = levels.map(
          (each) => root?.querySelector<HTMLElement>(`[data-testid="${id}-level-${each}"]`) ?? null,
        );
        const choice = choices[levels.indexOf(level)];
        const count = root?.querySelector<HTMLElement>(`[data-testid="${id}-count"]`);

        if (!root || !count || !choice || choices.some((each) => each === null)) {
          reject(new Error(`The log ${id} has no choice of the level ${level}, or no count of its lines, to measure`));
          return;
        }
        const seen = () => ({
          chosen: levels.filter((_, at) => choices[at]?.getAttribute("aria-pressed") === "true"),
          shown: Number(count.getAttribute("data-shown")),
        });
        const wanted = levels.filter((each) => expected.levels.includes(each)).join("+");
        const answered = () => {
          const now = seen();

          return now.chosen.join("+") === wanted && now.shown === expected.shown;
        };
        let over = false;
        let start = 0;
        const deadline = setTimeout(() => {
          const last = seen();

          over = true;
          reject(
            new Error(
              `The choice of the level ${level} did not show the levels ${wanted || "none"} with ${expected.shown} ` +
                `lines in ${timeout / 1000} s: the viewer last showed the levels ${last.chosen.join("+") || "none"} ` +
                `and ${last.shown} lines`,
            ),
          );
        }, timeout);
        const look = () => {
          if (over) return;
          if (!answered()) {
            requestAnimationFrame(look);
            return;
          }
          requestAnimationFrame(() => {
            const ms = performance.now() - start;

            clearTimeout(deadline);
            resolve({ ms, mounted: root.querySelectorAll("[data-text-line]").length });
          });
        };

        start = performance.now();
        choice.click();
        requestAnimationFrame(look);
      }),
    { id, level, levels: [...LOG_LEVELS], expected, timeout: MEASURE_TIMEOUT },
  );
}

/**
 * Scrolls the list of the lines of a log to a position, in pixels from its
 * top, and times each frame inside the page until the rows mounted are the
 * ones of that position: the list has moved, at both of its ends, and every
 * row the room shows there is mounted, by the numbers of the lines expected.
 * The frame after that one is timed as well, which draws them; the longest
 * of the frames is the measure of the gesture. The rows the list keeps ready
 * around its room come with the move, whatever their number. A gesture that
 * leaves an end of the rows mounted where it was is not one the measure takes,
 * unless that end is at an edge of the list, its first line or its last of so
 * many, and stays there: a list that keeps many rows ready has an end at the
 * edge long before a gesture reaches it. After ten seconds it is said which
 * rows were mounted last.
 */
export async function measureLogScroll(
  frame: Frame,
  kind: Operation,
  top: number,
  shows: { first: number; last: number },
  lines: number,
): Promise<LogGesture> {
  const id = PARTS.viewer(kind, "log", "text");
  const rows = PARTS.viewer(kind, "log", "rows");

  await part(frame, id);
  return frame.evaluate(
    ({ id, rows, top, shows, lines, timeout }) =>
      new Promise<{ frames: number[]; mounted: number }>((resolve, reject) => {
        const root = document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
        const scrolled = root?.querySelector<HTMLElement>(`[data-testid="${rows}"]`);

        if (!root || !scrolled) {
          reject(new Error(`The list ${id} has nothing to scroll`));
          return;
        }
        const mounted = () =>
          [...root.querySelectorAll<HTMLElement>("[data-text-line]")].map((row) =>
            Number(row.getAttribute("data-text-line")),
          );
        const ends = (rows: number[]) => ({ first: Math.min(...rows), last: Math.max(...rows) });
        const before = ends(mounted());
        // An end has moved when it is not where it was, or when it is at the edge of the list and was there.
        const moved = (now: number, was: number, edge: number) => now !== was || (now === edge && was === edge);
        const arrived = () => {
          const rows = mounted();
          const now = ends(rows);

          if (rows.length === 0 || !moved(now.first, before.first, 1) || !moved(now.last, before.last, lines)) {
            return false;
          }
          const has = new Set(rows);

          for (let line = shows.first; line <= shows.last; line += 1) if (!has.has(line)) return false;
          return true;
        };
        const frames: number[] = [];
        let last = 0;
        let over = false;
        const deadline = setTimeout(() => {
          const now = ends(mounted());

          over = true;
          reject(
            new Error(
              `The list did not mount the rows of the lines ${shows.first} to ${shows.last} in ${timeout / 1000} s ` +
                `after the scroll to ${top} px: the rows mounted were ${now.first} to ${now.last}, ` +
                `${before.first} to ${before.last} before, in ${frames.length} frames`,
            ),
          );
        }, timeout);
        const look = () => {
          const now = performance.now();

          if (over) return;
          frames.push(now - last);
          last = now;
          if (!arrived()) {
            requestAnimationFrame(look);
            return;
          }
          requestAnimationFrame(() => {
            frames.push(performance.now() - last);
            clearTimeout(deadline);
            resolve({ frames, mounted: mounted().length });
          });
        };

        last = performance.now();
        scrolled.scrollTop = top;
        requestAnimationFrame(look);
      }),
    { id, rows, top, shows, lines, timeout: MEASURE_TIMEOUT },
  );
}

/**
 * A line of a text as its row shows it, without what says that it was cut, and
 * whether it was. It is read as it is written, every space of it: a line is
 * compared with the line of a file, and is not words of the page.
 */
export async function lineShown(
  frame: Frame,
  kind: Operation,
  tab: ArtifactTab,
  line: number,
): Promise<{ text: string; cut: boolean }> {
  const id = PARTS.line(kind, tab, line, "text");

  return (await part(frame, id)).evaluate((element) => {
    const pieces = [...element.children].filter((piece) => !(piece.getAttribute("data-testid") ?? "").endsWith("-cut"));

    return {
      text: pieces.map((piece) => piece.textContent ?? "").join(""),
      cut: pieces.length !== element.children.length,
    };
  });
}

export interface ResultsShown {
  /** How many errors and how many warnings the results hold. */
  errors: number;
  warnings: number;
  /** What the tab says of the whole, of counts that differ from the status, and of messages that are not drawn. */
  summary: string;
  differs: string | undefined;
  cut: string | undefined;
  /** The groups that are drawn, in their order, each with its places in their order. */
  groups: {
    kind: string;
    count: number;
    title: string;
    places: { where: string; namespace: string; count: number; title: string; messages: number }[];
  }[];
}

/** What the viewer of the results shows: the counts, the two groups and the places of each. */
export async function resultsShown(frame: Frame, kind: Operation): Promise<ResultsShown> {
  const id = PARTS.viewer(kind, "results");

  await inItsForm(frame, kind, "results");
  await part(frame, PARTS.viewer(kind, "results", "summary"));

  return frame.evaluate((id) => {
    const root = document.querySelector<HTMLElement>(`[data-testid="${id}"]`);

    if (!root) throw new Error(`The part ${id} went while it was read`);
    const number = (element: Element, name: string) => {
      const value = element.getAttribute(name);

      if (value === null || value.trim() === "" || !Number.isFinite(Number(value))) {
        throw new Error(`The part ${element.getAttribute("data-testid")} does not write ${name} as a number: ${value}`);
      }
      return Number(value);
    };
    // The words as they are read, with the marks out of what is drawn for the time of the reading.
    const words = (element: HTMLElement | null) => {
      if (!element) return undefined;
      const icons = [...element.querySelectorAll<HTMLElement>(".Icon")];
      const drawn = icons.map((icon) => icon.style.display);

      for (const icon of icons) icon.style.display = "none";
      const read = element.innerText.replace(/\s+/g, " ").trim();

      icons.forEach((icon, index) => {
        icon.style.display = drawn[index];
      });
      return read;
    };
    const within = (suffix: string) => root.querySelector<HTMLElement>(`[data-testid="${id}-${suffix}"]`);

    return {
      errors: number(root, "data-errors"),
      warnings: number(root, "data-warnings"),
      summary: words(within("summary")) ?? "",
      differs: words(within("differs")),
      cut: words(within("shown")),
      groups: [...root.querySelectorAll<HTMLElement>(":scope > section")].map((group) => ({
        kind: (group.getAttribute("data-testid") ?? "").slice(id.length + 1),
        count: number(group, "data-count"),
        title: words(group.querySelector<HTMLElement>("h3")) ?? "",
        places: [...group.querySelectorAll<HTMLElement>("[data-place]")].map((place) => ({
          where: place.getAttribute("data-place") ?? "",
          namespace: place.getAttribute("data-namespace") ?? "",
          count: number(place, "data-count"),
          title: words(place.querySelector<HTMLElement>("h4")) ?? "",
          messages: place.querySelectorAll("li").length,
        })),
      })),
    };
  }, id);
}

/** A message of the results as its place shows it: as it is written, and in its parts when it has them. */
export interface ResultMessageShown {
  text: string;
  parts?: Record<string, string>;
}

/**
 * The messages of each place of the results that is drawn, in the order of the page: the text of each as it
 * is written, read as it is written, and the parts of one in the form the hook of the server gives, each by
 * the name of its part. A message of another form has no parts.
 */
export async function resultMessages(
  frame: Frame,
  kind: Operation,
): Promise<{ where: string; namespace: string; messages: ResultMessageShown[] }[]> {
  const id = PARTS.viewer(kind, "results");

  await inItsForm(frame, kind, "results");

  return frame.evaluate((id) => {
    const root = document.querySelector<HTMLElement>(`[data-testid="${id}"]`);

    if (!root) throw new Error(`The part ${id} went while it was read`);

    return [...root.querySelectorAll<HTMLElement>("[data-place]")].map((place) => ({
      where: place.getAttribute("data-place") ?? "",
      namespace: place.getAttribute("data-namespace") ?? "",
      messages: [...place.querySelectorAll<HTMLElement>("li")].map((item) => {
        const written = item.querySelector<HTMLElement>("[data-written]");

        if (!written) return { text: item.textContent ?? "" };
        return {
          text: written.textContent ?? "",
          parts: Object.fromEntries(
            [...item.querySelectorAll<HTMLElement>("dd[data-part]")].map((part) => [
              part.getAttribute("data-part") ?? "",
              part.textContent ?? "",
            ]),
          ),
        };
      }),
    }));
  }, id);
}

/** A row of a resource list that is mounted: a resource with the count of its items, or one item of it. */
export type ResourceRow =
  | { resource: string; count: number; said: string }
  | { item: string; namespace: string; scope: string; name: string; action: string | undefined };

export interface ResourcesShown {
  /** The items and the resources of the list, and the ones the filter leaves. */
  items: number;
  resources: number;
  leftItems: number;
  leftResources: number;
  /** What the tab says of them. */
  said: string;
  /** What the field of the filter holds, or nothing for a list with no item, which has no filter. */
  filter: string | undefined;
  /** The columns of the head, by their names, in their order: none while no row is shown. */
  columns: string[];
  /** The choices of the filter by action, with what each would leave: none for a backup. */
  actions: Record<string, { count: number; chosen: boolean; said: string }> | undefined;
  /** The rows that are mounted, from the first that is drawn. */
  rows: ResourceRow[];
}

/** What the viewer of a resource list shows: its counts, its filter, its head and the rows that are mounted. */
export async function resourcesShown(frame: Frame, kind: Operation): Promise<ResourcesShown> {
  const id = PARTS.viewer(kind, "resources");

  await inItsForm(frame, kind, "resources");
  await part(frame, PARTS.viewer(kind, "resources", "count"));

  return frame.evaluate(
    ({ id, choices }) => {
      const root = document.querySelector<HTMLElement>(`[data-testid="${id}"]`);

      if (!root) throw new Error(`The part ${id} went while it was read`);
      const number = (element: Element, name: string) => {
        const value = element.getAttribute(name);

        if (value === null || value.trim() === "" || !Number.isFinite(Number(value))) {
          throw new Error(
            `The part ${element.getAttribute("data-testid")} does not write ${name} as a number: ${value}`,
          );
        }
        return Number(value);
      };
      const words = (element: HTMLElement | null) => (element?.innerText ?? "").replace(/\s+/g, " ").trim();
      const within = (suffix: string) => root.querySelector<HTMLElement>(`[data-testid="${id}-${suffix}"]`);
      const column = (cell: Element) =>
        String(cell.className)
          .replace(/TableCell|sorting|nowrap/g, "")
          .trim();
      const table = within("table");
      const field = within("filter") as HTMLInputElement | null;
      const drawn = [
        ...(table?.querySelectorAll<HTMLElement>(`[data-testid="${id}-kind"], [data-testid="${id}-item"]`) ?? []),
      ].sort((one, other) => one.getBoundingClientRect().top - other.getBoundingClientRect().top);

      return {
        items: number(root, "data-items"),
        resources: number(root, "data-resources"),
        leftItems: number(root, "data-left-items"),
        leftResources: number(root, "data-left-resources"),
        said: words(within("count")),
        filter: field ? field.value : undefined,
        columns: [...(table?.querySelectorAll(".TableHead .TableCell") ?? [])].map(column),
        actions: within("actions")
          ? Object.fromEntries(
              choices.map((choice) => {
                const command = within(`action-${choice}`);

                if (!command) throw new Error(`The part ${id}-action-${choice} is not in the page`);
                return [
                  choice,
                  {
                    count: number(command, "data-count"),
                    chosen: command.getAttribute("aria-pressed") === "true",
                    said: words(command),
                  },
                ];
              }),
            )
          : undefined,
        rows: drawn.map((row) => {
          if (row.getAttribute("data-testid") === `${id}-kind`) {
            return {
              resource: row.getAttribute("data-resource") ?? "",
              count: number(row, "data-count"),
              said: words(row.querySelector<HTMLElement>(".TableCell.count")),
            };
          }
          const action = row.querySelector(".TableCell.action [data-action]");

          return {
            item: row.getAttribute("data-item") ?? "",
            namespace: words(row.querySelector<HTMLElement>(".TableCell.namespace")),
            scope: row.querySelector("[data-scope]")?.getAttribute("data-scope") ?? "",
            name: words(row.querySelector<HTMLElement>(".TableCell.name")),
            action: action ? (action.getAttribute("data-action") ?? "") : undefined,
          };
        }),
      };
    },
    { id, choices: [...ACTION_CHOICES] },
  );
}

/** Waits for the viewer of a resource list to show what is expected, and answers what it shows. */
export async function resourcesLike(
  frame: Frame,
  kind: Operation,
  what: string,
  like: (shown: ResourcesShown) => boolean,
): Promise<ResourcesShown> {
  return until(`The resource list of the ${kind} ${what}`, () => resourcesShown(frame, kind), like);
}

export interface VolumesShown {
  /** How many volumes Velero recorded, and what the tab says of them. */
  count: number;
  said: string;
  /** The kind of operation the table says it is of, and its columns: nothing of either while no volume is listed. */
  of: string;
  columns: string[];
  /** One row for a volume: what each of its cells says, by the name of its column. */
  rows: Record<string, string>[];
  /** For each row, what a cell writes for who points at it, by the name of its column: a time or a count as it is. */
  titles: Record<string, string>[];
}

/** What the viewer of the volume information shows: how many volumes, and a row for each. */
export async function volumesShown(frame: Frame, kind: Operation): Promise<VolumesShown> {
  const id = PARTS.viewer(kind, "volumes");

  await inItsForm(frame, kind, "volumes");
  const count = await numberOf(frame, id, "data-count");

  return frame.evaluate(
    ({ id, count }) => {
      const root = document.querySelector<HTMLElement>(`[data-testid="${id}"]`);

      if (!root) throw new Error(`The part ${id} went while it was read`);
      const words = (element: HTMLElement | null) => {
        if (!element) return "";
        const icons = [...element.querySelectorAll<HTMLElement>(".Icon")];
        const drawn = icons.map((icon) => icon.style.display);

        for (const icon of icons) icon.style.display = "none";
        const read = element.innerText.replace(/\s+/g, " ").trim();

        icons.forEach((icon, index) => {
          icon.style.display = drawn[index];
        });
        return read;
      };
      const within = (suffix: string) => root.querySelector<HTMLElement>(`[data-testid="${id}-${suffix}"]`);
      const table = within("table");
      const sentence = within(count === 0 ? "none" : "count");

      if (!sentence) throw new Error(`The part ${id}-${count === 0 ? "none" : "count"} is not in the page`);
      return {
        count,
        said: words(sentence),
        of: table?.getAttribute("data-of") ?? "",
        columns: [...(table?.querySelectorAll<HTMLElement>("[role=columnheader]") ?? [])].map(words),
        rows: [...(table?.querySelectorAll<HTMLElement>("[data-volume-row]") ?? [])].map((row) =>
          Object.fromEntries(
            [...row.querySelectorAll<HTMLElement>("[data-column]")].map((cell) => [
              cell.getAttribute("data-column") ?? "",
              words(cell),
            ]),
          ),
        ),
        titles: [...(table?.querySelectorAll<HTMLElement>("[data-volume-row]") ?? [])].map((row) =>
          Object.fromEntries(
            [...row.querySelectorAll<HTMLElement>("[data-column]")].map((cell) => [
              cell.getAttribute("data-column") ?? "",
              cell.querySelector("[title]")?.getAttribute("title") ?? "",
            ]),
          ),
        ),
      };
    },
    { id, count },
  );
}

/** A detail of a volume as its row shows it: the key it is under, what the tab calls it, and its fields. */
export interface VolumeDetailShown {
  name: string;
  title: string;
  fields: { name: string; value: string }[];
  /** What the detail says when it is written with no field, or nothing. */
  none: string;
}

/**
 * The details of a volume, by the place of its row, once they are open: each detail with its fields by the
 * names they are written with, and the words that say that the entry carries none.
 */
export async function volumeDetails(
  frame: Frame,
  kind: Operation,
  row: number,
): Promise<{ none: string; details: VolumeDetailShown[] }> {
  const id = PARTS.volumeDetails(kind, row);

  await part(frame, id);

  return frame.evaluate((id) => {
    const root = document.querySelector<HTMLElement>(`[data-testid="${id}"]`);

    if (!root) throw new Error(`The part ${id} went while it was read`);

    return {
      none: root.querySelector<HTMLElement>(":scope > p")?.textContent ?? "",
      details: [...root.querySelectorAll<HTMLElement>("[data-detail]")].map((detail) => ({
        name: detail.getAttribute("data-detail") ?? "",
        title: detail.querySelector<HTMLElement>("h4")?.textContent ?? "",
        fields: [...detail.querySelectorAll<HTMLElement>("[data-field]")].map((field) => ({
          name: field.getAttribute("data-field") ?? "",
          value: field.querySelector<HTMLElement>("dd")?.textContent ?? "",
        })),
        none: detail.querySelector<HTMLElement>("p")?.textContent ?? "",
      })),
    };
  }, id);
}

/** The height a list of a viewer has at least, in pixels: ten lines of a text. */
export const LIST_LEAST = 200;
/** How many rows of a viewer the check of the layout looks at, from the first: as many as the check of a page does. */
const ROWS_LOOKED = 20;

/**
 * What is wrong with the layout of a tab of the view that is shown, which the check of the layout of a page
 * does not look at: the tabs of the strip, and the strip inside its room; the parts of the panel and its
 * commands, the parts of its viewer, the bar of the log with its search and its levels, the filter of the
 * resources with its choices by action, and the head of its table; the rows of the results, of the
 * resources and of the volumes, each cell after the one before it and no part of a message over another.
 * Of each group, the parts that lie over one another; of the panel and of its viewer, whether it is wider
 * than its room. And the room of the view, which is what scrolls a tab: whether it is shorter than a list
 * needs, and whether a list that is scrolled inside itself, the lines of a text and the rows of a resource
 * list, is taller than the room it is read in, where no scroll of the view brings it whole into sight. An
 * empty answer is a tab with none of these. A strip or a panel that is not in the page is answered as a
 * problem, by its name.
 */
export async function tabLayoutProblems(frame: Frame, kind: Operation, tab: WorkspaceTab): Promise<string[]> {
  return frame.evaluate(
    ({ strip, panel, workspace, least, rowsLooked }) => {
      const problems: string[] = [];
      const shown = (element: Element) => {
        const box = element.getBoundingClientRect();
        const style = getComputedStyle(element);

        return box.width > 0 && box.height > 0 && style.visibility !== "hidden" && style.display !== "none";
      };
      const name = (element: Element) =>
        element.getAttribute("data-testid") ??
        `${element.tagName.toLowerCase()}.${String(element.className).split(" ")[0]}`;
      // The parts of a group that lie over one another, by more than the pixel two borders share.
      const overlaps = (group: string, parts: Element[]) => {
        const drawn = parts.filter(shown);

        for (let first = 0; first < drawn.length; first += 1) {
          for (let second = first + 1; second < drawn.length; second += 1) {
            const one = drawn[first].getBoundingClientRect();
            const other = drawn[second].getBoundingClientRect();
            const width = Math.min(one.right, other.right) - Math.max(one.left, other.left);
            const height = Math.min(one.bottom, other.bottom) - Math.max(one.top, other.top);

            if (width > 1 && height > 1) {
              problems.push(`${group}: ${name(drawn[first])} lies over ${name(drawn[second])}`);
            }
          }
        }
      };
      // The cells of a row, each beginning where the one before it ended, or after it: a row of a table of
      // the host lays its cells side by side, and one that is wider than its room pushes the next under it
      // or over it.
      const cellsInOrder = (group: string, rows: Element[], cells: string) => {
        for (const row of rows.slice(0, rowsLooked)) {
          const drawn = [...row.querySelectorAll(cells)].filter(shown);

          for (let index = 1; index < drawn.length; index += 1) {
            if (drawn[index].getBoundingClientRect().left < drawn[index - 1].getBoundingClientRect().right - 1) {
              problems.push(`${group}: a cell of ${name(row)} lies over the one before it`);
              break;
            }
          }
        }
      };
      const tabs = document.querySelector<HTMLElement>(`[data-testid="${strip}"]`);

      if (!tabs) return [`The strip ${strip} is not in the page`];
      overlaps("The tabs", [...tabs.children]);
      // What the rule finds: a strip wider than its room, which overflows sideways, cut or pushing the view.
      // What it does not: the strip of the host wraps its tabs to a second line when they do not fit, which
      // leaves it no wider than its room, and is left to human judgment, with the pictures of the pre-review.
      if (tabs.scrollWidth > tabs.clientWidth + 1) {
        problems.push(`The strip ${strip} is wider than its room: ${tabs.scrollWidth} in ${tabs.clientWidth}`);
      }
      // The summary has no panel of an artifact: its layout is the one the check of the page looks at.
      if (!panel) return problems;
      const root = document.querySelector<HTMLElement>(`[data-testid="${panel}"]`);

      if (!root) return [...problems, `The panel ${panel} is not in the page`];
      const viewer = root.querySelector<HTMLElement>(`[data-testid="${panel}-viewer"]`);
      const within = (suffix: string) =>
        viewer?.querySelector<HTMLElement>(`[data-testid="${panel}-viewer-${suffix}"]`) ?? null;
      // A part with the ones beside it, in what holds them.
      const beside = (part: Element | null) => [...(part?.parentElement?.children ?? [])];

      // What is said to who does not see is out of the flow and takes no room: it is no part of these.
      overlaps(
        "The parts of the panel",
        [...root.children].filter((part) => part.getAttribute("data-testid") !== `${panel}-said`),
      );
      overlaps(
        "The commands of the panel",
        [...root.querySelectorAll("button")].filter((command) => !viewer?.contains(command)),
      );
      for (const part of [root, viewer]) {
        // What is scrolled sideways by who reads it is reached: what is cut, or pushes its holder, is not.
        if (!part || !shown(part) || ["auto", "scroll"].includes(getComputedStyle(part).overflowX)) continue;
        if (part.scrollWidth > part.clientWidth + 1) {
          problems.push(`${name(part)} is wider than its room: ${part.scrollWidth} in ${part.clientWidth}`);
        }
      }
      // The view is what scrolls a tab: its room is the one a tab is read in.
      const view = root.closest<HTMLElement>(`[data-testid="${workspace}"]`);

      if (!view) return [...problems, `The panel ${panel} is in no view ${workspace}`];
      if (view.clientHeight < least) {
        problems.push(`The view has a room of ${view.clientHeight}, shorter than a list needs: ${least}`);
      }
      if (!viewer) return problems;
      for (const list of [within("text"), within("rows")]) {
        if (!list || !shown(list)) continue;
        const height = Math.round(list.getBoundingClientRect().height);

        if (height > view.clientHeight + 1) {
          problems.push(`${name(list)} is taller than the room of its view: ${height} in ${view.clientHeight}`);
        }
      }
      overlaps("The parts of the viewer", [...viewer.children]);
      // The bar of the log: the search, the levels, the choice to wrap and the count, and inside the
      // search and the levels the parts of each.
      overlaps("The bar of the log", beside(within("levels")));
      overlaps("The search of the log", beside(within("search-status")));
      // The levels with the words before them, which say what choosing one does.
      overlaps("The levels of the log", [...(within("levels")?.children ?? [])]);
      // The filter of the resources beside its choices by action, the choices, and the head of the table.
      overlaps("The filter of the resources", beside(within("actions")));
      overlaps("The choices by action", [...(within("actions")?.querySelectorAll("button") ?? [])]);
      overlaps("The head of the resources", [...(within("table")?.querySelectorAll(".TableHead .TableCell") ?? [])]);
      // The rows of the resources that are mounted: a resource with its count, an item with its cells.
      cellsInOrder(
        "The rows of the resources",
        [
          ...(within("table")?.querySelectorAll(
            `[data-testid="${panel}-viewer-kind"], [data-testid="${panel}-viewer-item"]`,
          ) ?? []),
        ],
        ".TableCell",
      );
      // The rows of the volumes under their head, and the fields of a detail that is open.
      const volumes = viewer.querySelector(`[data-testid="${panel}-viewer-table"]`);

      overlaps("The head of the volumes", [...(volumes?.querySelectorAll("[role=columnheader]") ?? [])]);
      cellsInOrder(
        "The rows of the volumes",
        [...(volumes?.querySelectorAll("[data-volume-row]") ?? [])],
        "[role=cell]",
      );
      for (const details of [...(volumes?.querySelectorAll("[data-volume-details]") ?? [])].slice(0, rowsLooked)) {
        for (const detail of details.querySelectorAll("[data-detail]")) {
          overlaps(`The fields of the detail ${detail.getAttribute("data-detail")}`, [
            ...detail.querySelectorAll("[data-field]"),
          ]);
        }
      }
      // The rows of the results: the messages of each place, none wider than its room, and in each message
      // the name of a part beside its value, and no part over another.
      const messages = [...viewer.querySelectorAll("[data-place] li")].slice(0, rowsLooked);

      for (const message of messages) {
        if (!shown(message)) continue;
        if (message.scrollWidth > message.clientWidth + 1) {
          problems.push(
            `A message of the results is wider than its room: ${message.scrollWidth} in ${message.clientWidth}`,
          );
        }
        overlaps("The parts of a message of the results", [...(message.querySelector("dl")?.children ?? [])]);
      }

      return problems;
    },
    {
      strip: PARTS.strip(kind),
      panel: tab === "summary" ? "" : PARTS.panel(kind, tab),
      workspace: PARTS.workspace(kind),
      least: LIST_LEAST,
      rowsLooked: ROWS_LOOKED,
    },
  );
}

export interface TabRoom {
  /** The room of the view, which is what scrolls a tab, what the view holds, and how far it is scrolled. */
  room: number;
  holds: number;
  scrolled: number;
  /** The height of the list of the viewer that is scrolled inside itself: none for a viewer without one. */
  list: number | undefined;
  /** The room of the page, which holds the target bar over the view, and what the page holds. */
  page: { room: number; holds: number };
}

/** The room a tab of the view that is shown is read in, in pixels of the page, as the browser laid it out. */
export async function tabRoom(frame: Frame, kind: Operation, tab: ArtifactTab): Promise<TabRoom> {
  await part(frame, PARTS.panel(kind, tab));

  return frame.evaluate(
    ({ workspace, viewer }) => {
      const view = document.querySelector<HTMLElement>(`[data-testid="${workspace}"]`);
      const page = view?.closest<HTMLElement>('[data-testid^="velero-"][data-testid$="-page"]');

      if (!view || !page) throw new Error(`The view ${workspace} is not in a page`);
      const list =
        document.querySelector<HTMLElement>(`[data-testid="${viewer}-text"]`) ??
        document.querySelector<HTMLElement>(`[data-testid="${viewer}-rows"]`);

      return {
        room: view.clientHeight,
        holds: view.scrollHeight,
        scrolled: Math.round(view.scrollTop),
        list: list ? Math.round(list.getBoundingClientRect().height) : undefined,
        page: { room: page.clientHeight, holds: page.scrollHeight },
      };
    },
    { workspace: PARTS.workspace(kind), viewer: PARTS.viewer(kind, tab) },
  );
}

/**
 * Scrolls the page that holds the view that is shown to its top, where its target bar is, or to its end,
 * where its view is whole. A page is scrolled where its room is shorter than what it cannot give up, as
 * it is at twice the zoom: elsewhere this moves nothing.
 */
export async function scrollPage(frame: Frame, kind: Operation, to: "top" | "end"): Promise<void> {
  await frame.evaluate(
    ({ workspace, to }) => {
      const page = document
        .querySelector<HTMLElement>(`[data-testid="${workspace}"]`)
        ?.closest<HTMLElement>('[data-testid^="velero-"][data-testid$="-page"]');

      if (!page) throw new Error(`The view ${workspace} is not in a page`);
      page.scrollTop = to === "top" ? 0 : page.scrollHeight;
    },
    { workspace: PARTS.workspace(kind), to },
  );
}

/**
 * Brings the list of the viewer of a tab that is scrolled inside itself, the lines of a text or the rows of
 * a resource list, into the room of its view, as the keyboard does when it reaches it, and answers whether
 * the list is then whole in that room. Nothing is answered for a viewer without such a list.
 */
export async function listInSight(frame: Frame, kind: Operation, tab: ArtifactTab): Promise<boolean | undefined> {
  return frame.evaluate(
    ({ workspace, viewer }) => {
      const view = document.querySelector<HTMLElement>(`[data-testid="${workspace}"]`);
      const list =
        document.querySelector<HTMLElement>(`[data-testid="${viewer}-text"]`) ??
        document.querySelector<HTMLElement>(`[data-testid="${viewer}-rows"]`);

      if (!view) throw new Error(`The view ${workspace} is not in the page`);
      if (!list) return undefined;
      list.scrollIntoView({ block: "end" });
      const room = view.getBoundingClientRect();
      const box = list.getBoundingClientRect();

      return box.height > 0 && box.top >= room.top - 1 && box.bottom <= room.bottom + 1;
    },
    { workspace: PARTS.workspace(kind), viewer: PARTS.viewer(kind, tab) },
  );
}

/**
 * The parts, of the ones that are named, that are not whole inside the room of the view that is shown: what
 * the operator does not see of them without scrolling the view. A part that is not in the page is answered
 * among them.
 */
export async function outOfTheRoom(frame: Frame, kind: Operation, ids: string[]): Promise<string[]> {
  return frame.evaluate(
    ({ workspace, ids }) => {
      const view = document.querySelector<HTMLElement>(`[data-testid="${workspace}"]`);

      if (!view) throw new Error(`The view ${workspace} is not in the page`);
      const room = view.getBoundingClientRect();

      return ids.filter((id) => {
        const box = document.querySelector<HTMLElement>(`[data-testid="${id}"]`)?.getBoundingClientRect();

        return !box || box.height === 0 || box.top < room.top - 1 || box.bottom > room.bottom + 1;
      });
    },
    { workspace: PARTS.workspace(kind), ids },
  );
}

/** A text the suites search the log of the fixtures for, with how many of its lines carry it. */
export interface FixtureSearch {
  text: string;
  matches: number;
  use: string;
}

/** An error or a warning the log of the fixtures filed into the results: where, and in which parts. */
export interface FixtureEntry {
  line: number;
  level: string;
  place: string;
  namespace?: string;
  resource?: string;
  name?: string;
  message: string;
  error?: string;
  /** The message as the results write it. */
  text: string;
}

/** What the fixtures wrote of an artifact into the store: its bytes and its digest. */
export interface FixtureFile {
  bytes: number;
  sha256: string;
}

/**
 * What the runner of the suites counted of the fixtures of the tabs, outside the extension: what the
 * generators counted of the artifacts of the backup synced from the store, and the empty artifacts of the
 * one synced without its log. The fields a suite reads.
 */
export interface TabFixtureFacts {
  run: string;
  namespace: string;
  synced: {
    backup: string;
    log: FixtureFile & {
      lines: number;
      pages: number;
      levels: Record<LogLevel, number>;
      entries: FixtureEntry[];
      long: { twentyThousand: number; tenThousand: number; tenThousandAndOne: number };
      /** The entries at info whose message names the level of an error: how many, and the first of them. */
      levelInMessage: { lines: number; line: number };
      /** The lines with no level whose words name one: how many, and the first of them. */
      levelInFreeText: { lines: number; line: number };
      /** The line the first page of the text ends inside. */
      boundaryLine: number;
      searches: FixtureSearch[];
    };
    results: FixtureFile & {
      errors: number;
      warnings: number;
      value: Record<string, { velero?: string[]; cluster?: string[]; namespaces?: Record<string, string[]> }>;
    };
    resourceList: FixtureFile & { resources: number; items: number; value: Record<string, string[]> };
    volumeInfo: FixtureFile & { volumes: number; value: Record<string, unknown>[] };
    status: { phase?: string; errors?: number; warnings?: number };
  };
  withoutLog: {
    backup: string;
    results: FixtureFile;
    resourceList: FixtureFile;
    volumeInfo: FixtureFile;
    status: { phase?: string };
  };
  /** The real backup and the real restore of the demo: what a plain count found in the files the server wrote of them. */
  real: {
    backup: { name: string; log: { lines: number; levels: Record<LogLevel, number> } };
    restore: {
      name: string;
      resourceList: { resources: number; items: number; actions: Record<string, number> };
    };
  };
  refused: { backup: { name: string }; restore: { name: string }; orphan: { name: string } };
}

/**
 * What the runner of the suites wrote of the fixtures of the tabs, beside the reports of the suites, before
 * it started them: what each artifact of the tabs holds, counted outside the extension. A suite that does
 * not find it was not started by the runner.
 */
export async function tabFixtureFacts(): Promise<TabFixtureFacts> {
  const file = path.join(ARTIFACTS_DIR, "tab-fixtures.json");
  let text: string;

  try {
    text = await readFile(file, "utf8");
  } catch {
    throw new Error(
      `What the fixtures of the tabs hold is not in ${file}: run the suite through \`pnpm e2e:views\`, which writes it there.`,
    );
  }

  return JSON.parse(text) as TabFixtureFacts;
}

function many(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

// A count of errors or of warnings in words, none said as such.
function counted(count: number, noun: string): string {
  return count === 0 ? `no ${noun}` : many(count, noun);
}

// A count of bytes in the unit that reads best, as the tabs write the size of a text.
function bytes(count: number): string {
  if (count < 1024) return `${count} B`;
  const units = ["KiB", "MiB", "GiB"];
  let value = count / 1024;
  let unit = 0;

  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }

  return `${value.toFixed(1)} ${units[unit]}`;
}

const REQUEST = "DownloadRequest";
// The identifier of a request is made when the request is confirmed: until then it is said in words.
const IDENTIFIER = "the identifier of the request";
// What a filter by action asks of an item, in the words that follow "none".
const ASKED: Record<Exclude<ActionChoice, "all">, string> = {
  created: "was created",
  updated: "was updated",
  failed: "failed",
  skipped: "was skipped",
  "not-stated": "is without a stated action",
};

/**
 * The words of the tabs, as a suite expects them: written here once more, and
 * not taken from the extension, so that a word that changes there is seen
 * here. Each takes what it is said of, and no number is read back from one.
 */
export const WORDS = {
  /** What a tab would create, said before anything is created. */
  wouldCreate: (kind: Operation, tab: ArtifactTab, name: string, namespace: string, cluster: string) =>
    `Loading the ${ARTIFACTS[tab].noun} of the ${kind} ${name} creates a ${REQUEST} of the kind ${ARTIFACTS[tab].targets[kind]} for that ${kind}, in ${namespace} of the cluster ${cluster}. Velero signs a URL for the request and removes it after ten minutes. Nothing else is written, and nothing is created before the request is shown and confirmed.`,
  /** The state of the gate while writes are off, and the way to the target bar. */
  writesOff: "Writes are off for this installation: they are turned on in the target bar.",
  toTheWrites: "Go to the writes in the target bar",
  /** The command of a tab, in the name of the kind it creates: of a load that follows another, another request. */
  command: (kind: Operation, tab: ArtifactTab, again = false) =>
    `Create ${again ? "another" : "a"} ${REQUEST} of the kind ${ARTIFACTS[tab].targets[kind]}`,
  /** What loading again does, and what asking again does after a load that ended without its text. */
  again: (tab: ArtifactTab) =>
    `Loading the ${ARTIFACTS[tab].noun} again creates another ${REQUEST}, and what is shown goes when that request is created.`,
  askAgain: (namespace: string, another = true) =>
    `Asking again creates ${another ? "another" : "a"} ${REQUEST} in ${namespace}.`,
  /** The request as its confirmation shows it, field by field. */
  confirmation: (
    kind: Operation,
    tab: ArtifactTab,
    name: string,
    namespace: string,
    cluster: string,
    context: string,
  ) => ({
    kind: `${REQUEST} (velero.io/v1)`,
    name: `${name}-, followed by ${IDENTIFIER}`,
    namespace,
    cluster: `${cluster} (context ${context})`,
    labels: `app.kubernetes.io/managed-by=freelens-velero-extension, freelensapp.io/diagnostic-request=${IDENTIFIER}`,
    spec: `target.kind ${ARTIFACTS[tab].targets[kind]}, target.name ${name}`,
    target: `The ${kind} ${name}`,
  }),
  confirmCreate: `Create the ${REQUEST}`,
  confirmBack: "Do not create it",
  /** The command that cancels a load, and what is said while it is cancelled. */
  cancel: "Cancel the load",
  cancelling: "Cancelling: the load is stopped at the step it is at, and the tab says how it ended.",
  /** How a load that was cancelled before anything was created is said to have ended. */
  cancelledBefore: "The request was cancelled before anything was created.",
  /** What the search field of the log is called, for who does not see it. */
  searchLabel: "Search the log",
  /**
   * What is said over a text that was loaded, around the time it was loaded
   * at, which is written as the language of the machine writes a time.
   */
  loaded: (tab: ArtifactTab, size: number) => ({
    start: `The ${ARTIFACTS[tab].noun} ${ARTIFACTS[tab].plural ? "were" : "was"} loaded at `,
    end: ` (${bytes(size)} of text).`,
  }),
  /** The request a text came through, said under the text, before the way it came by. */
  through: (request: string) => `The file came through the ${REQUEST} ${request}.`,
  /** The way a text came by. */
  cameBy: (mode: string, encrypted: boolean, origin: string) => {
    if (mode === "tunnel") {
      const through = `It came from ${origin} through a tunnel to the Pod of the store, opened through the API server of the cluster`;

      return encrypted
        ? `${through}, over TLS that was verified.`
        : `${through}. The connection to the store was not encrypted: its bytes travelled inside the connection to the API server, and inside the cluster.`;
    }
    const directly = `It came from ${origin}, directly from this machine`;

    return encrypted
      ? `${directly}, over TLS that was verified.`
      : `${directly}. The connection was not encrypted: that was allowed for this origin.`;
  },
  /** The saving of a text: its command, what the dialog is told, the file it is suggested, and how it ended. */
  save: (tab: ArtifactTab) => `Save the ${ARTIFACTS[tab].noun} to a file`,
  saveTitle: (kind: Operation, tab: ArtifactTab, name: string, namespace: string, cluster: string) =>
    `Save the ${ARTIFACTS[tab].noun} of the ${kind} ${name}, of ${namespace} in the cluster ${cluster}`,
  savedFile: (kind: Operation, tab: ArtifactTab, name: string) => {
    const files: Record<ArtifactTab, string> = {
      log: "logs.txt",
      results: "results.json",
      resources: "resource-list.json",
      volumes: "volumeinfo.json",
    };

    return `${kind === "restore" ? "restore-" : ""}${name}-${files[tab]}`.replace(/[^A-Za-z0-9._-]/g, "_");
  },
  saved: (tab: ArtifactTab) =>
    `The ${ARTIFACTS[tab].noun} ${ARTIFACTS[tab].plural ? "were" : "was"} saved into the file that was chosen.`,
  notSaved: (tab: ArtifactTab) =>
    `No file was chosen: the ${ARTIFACTS[tab].noun} ${ARTIFACTS[tab].plural ? "were" : "was"} not saved, and nothing was written.`,
  /** What the details of the host say of the tabs, and their way to the view. */
  inTheWorkspace: (kind: Operation) =>
    `The log, the results, the resource list and the volume information of this ${kind} are in its workspace, each loaded there when it is asked for. None of them is loaded here.`,
  toTheWorkspace: (kind: Operation) => `Open among the ${kind}s of Velero`,
  /** The log: how many lines it shows, what its search says, a line that was copied, and no line of a level. */
  lines: (shown: number, lines: number) =>
    shown === lines ? many(lines, "line") : `${shown} of ${many(lines, "line")}`,
  match: (match: number, matches: number, line: number) => `Match ${match + 1} of ${matches}, on line ${line}.`,
  noMatch: (filtered = false) => `No line${filtered ? " of the levels that are chosen" : ""} carries these words.`,
  copied: (line: number, characters: number) => `Line ${line} is copied whole: ${many(characters, "character")}.`,
  noLineOfTheLevels: "No line is of the levels that are chosen.",
  /** The results: the whole, the title of a group and the title of a place. */
  results: (kind: Operation, errors: number, warnings: number) => {
    const each = `${counted(errors, "error")} and ${counted(warnings, "warning")}`;
    const all = errors + warnings;

    return all === 0
      ? `Velero recorded ${each} for this ${kind}.`
      : `Velero recorded ${all} ${all === 1 ? "message" : "messages"} for this ${kind}: ${each}.`;
  },
  group: (group: string, count: number) =>
    `${group === "errors" ? "Errors" : "Warnings"}: ${count === 0 ? "none" : count}`,
  place: (group: string, where: string, namespace: string, count: number) =>
    `${where === "namespace" ? `Namespace ${namespace}` : where === "velero" ? "Velero" : "Cluster"}: ${counted(count, group === "errors" ? "error" : "warning")}`,
  /** The resource list: what it holds, what a filter leaves, and what it says when a filter leaves nothing. */
  resources: (items: number, resources: number) =>
    items === 0 ? "The resource list holds no item." : `${many(items, "item")} of ${many(resources, "resource")}.`,
  resourcesLeft: (leftItems: number, items: number, leftResources: number, resources: number) =>
    `${leftItems} of ${many(items, "item")}, of ${leftResources} of ${many(resources, "resource")}.`,
  noneOfTheAction: (items: number, action: Exclude<ActionChoice, "all">) =>
    `Of ${many(items, "item")}, none ${ASKED[action]}.`,
  noneOfTheWords: (items: number) =>
    `Of ${many(items, "item")}, none carries what was typed in its resource, its namespace or its name.`,
  itemsOf: (count: number) => (count === 0 ? "No item" : many(count, "item")),
  actionChoice: (choice: ActionChoice, count: number) =>
    `${choice === "not-stated" ? "Not stated" : `${choice[0].toUpperCase()}${choice.slice(1)}`}: ${count}`,
  /** The volume information: how many volumes Velero recorded. */
  volumes: (kind: Operation, count: number) =>
    count === 0
      ? `Velero recorded no volume for this ${kind}.`
      : `Velero recorded ${count} ${count === 1 ? "volume" : "volumes"} for this ${kind}.`,
  /** The columns of the table of the volumes, by the kind of the operation, after the one of the details. */
  volumeColumns: {
    backup: [
      "Details",
      "Claim",
      "Volume",
      "Method",
      "Result",
      "Data moved",
      "Local snapshot kept",
      "Skipped",
      "Started",
      "Ended",
      "Size",
    ],
    restore: ["Details", "Claim", "Volume", "Method", "Data moved", "Size"],
  } as Record<Operation, string[]>,
  /** What a cell of the volumes says: of what an entry does not say, of a mark, of a namespace and of a size. */
  notStated: "Not stated",
  mark: (mark: boolean) => (mark ? "Yes" : "No"),
  inNamespace: (namespace: string) => `in ${namespace}`,
  size: (count: number) => sizeWords(count),
  bytesOf: (count: number) => `${count} ${count === 1 ? "byte" : "bytes"}`,
  /** What the tab calls each detail of a volume of a backup, by the key it is under. */
  volumeDetail: {
    csiSnapshotInfo: "CSI snapshot",
    snapshotDataMovementInfo: "Data movement",
    nativeSnapshotInfo: "Native snapshot",
    pvbInfo: "Pod volume backup",
    pvInfo: "Volume",
  } as Record<string, string>,
  /** A resource of the list with a filter on: how many of its items the filter leaves. */
  itemsLeft: (left: number, all: number) => `${left} of ${many(all, "item")}`,
  /** A line a row cuts: how much of it is not shown. */
  cutLine: (left: number) =>
    `${many(left, "more character")} of this line ${left === 1 ? "is" : "are"} not shown: the copy of the line takes it whole.`,
  /** How a load that ended at a store without the file is said, and what a missing file means for the phase. */
  storeHasNoFile: (kind: Operation, name: string, request: string, namespace: string) =>
    `The store has no such file: Velero wrote none for the ${kind} ${name}, or it is not there any more. The ${REQUEST} ${request} stays in ${namespace} until Velero removes it.`,
  nothingForValidation: (tab: ArtifactTab, kind: Operation) =>
    `Velero writes nothing into the storage for a ${kind} that failed its validation: there ${ARTIFACTS[tab].plural ? `are no ${ARTIFACTS[tab].noun}` : `is no ${ARTIFACTS[tab].noun}`} to read. What it refused is in the summary.`,
  /** The log of a backup that ended, which the store does not have: said in the past, with when it was asked for. */
  lostLogOfABackup:
    /^The log of this backup was not in the storage when it was asked for, at .+: it was removed from it, or it was never written there\. Velero uploads the log of a backup as best it can, and a backup ends without it when the upload fails\.$/,
  /** What is offered after a load that is not to be asked again: one command that asks nothing. */
  notAgain:
    "The main process says that asking again as it was asked is not safe after this. The command takes the tab back to where it was before the request, and asks nothing.",
  beginAgain: "Take the tab back to its first state",
  /** What is said before any request, of an operation Velero signs no URL for. */
  noBackupOfTheRestore: (name: string, namespace: string) =>
    `The backup of the restore ${name} is not there: the restore names none, or the one it names is not in ${namespace}. Velero signs no URL for such a restore, and no request was created.`,
  /** The location of a backup is said of the backup once; the one of a restore is of the backup of the restore. */
  noLocationOfTheBackup: (kind: Operation, name: string, namespace: string) =>
    `The storage location of ${kind === "restore" ? `the backup of the restore ${name}` : `the backup ${name}`} is not in ${namespace}: Velero signs no URL without it, and no request was created.`,
  /** How a creation the cluster refused to the identity is said. */
  forbiddenCreation:
    "The cluster refused the creation of a DownloadRequest: the identity needs the verb create on downloadrequests of the namespace.",
  /** How a load cancelled once its request was in the cluster is said to have ended. */
  cancelledAfter: (request: string, namespace: string) =>
    `The download was cancelled. The ${REQUEST} ${request} stays in ${namespace} until Velero removes it.`,
};

// A size of a volume in the unit that reads best, as the tab of the volumes writes it: a size that would be
// written as 1024.0 of a unit is one of the unit above.
function sizeWords(size: number): string {
  if (size < 1024) return `${size} B`;
  const units = ["KiB", "MiB", "GiB", "TiB", "PiB"];
  let value = size / 1024;
  let unit = 0;

  while (Math.round(value * 10) >= 10240 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }

  return `${value.toFixed(1)} ${units[unit]}`;
}
