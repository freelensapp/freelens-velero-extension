/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

// The pass before the review of a milestone: the views in both themes, at
// the two sizes of the window and at twice the zoom, and the journeys with the
// keyboard alone. Every view is checked for what lies over something else or
// does not fit, and is left as a screenshot of the frame of the test cluster.
//
// The tabs of a workspace are among the views, open: a diagnostic tab with
// writes off, the confirmation of a request, the log of the backup that
// failed its validation, the resource list of the restore of the demo, and
// the log, the results and the volume information of the backup synced from
// the store. They load what the fixtures of the tabs wrote, each load a
// DownloadRequest in the namespace of the installation, told to the guard by
// its name and read in the cluster by it. Nothing deletes a request: the
// server removes one ten minutes after it signed it, and the last case waits
// for that. So the loads come as early as the views allow, and the views of
// the other pages are looked at while the server counts its minutes.
//
// Every view is scanned as well, in both themes at the two sizes of the
// window, by axe-core with the rules of WCAG 2.1 at the levels A and AA, inside
// the root of the view of the extension (REQ-293 of SPEC-0018). A violation of
// impact serious or critical on an element the extension renders fails the
// case of its view, unless the file of the exceptions beside the suite names
// its rule, its element and the choice of a spec that keeps it; what comes from
// a component of the host is reported and fails nothing.

import { existsSync, readFileSync, rmSync } from "node:fs";
import * as path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as accessibility from "../../integration/helpers/velero-accessibility";
import * as artifacts from "../../integration/helpers/velero-artifacts";
import * as axe from "../../integration/helpers/velero-axe";
import * as cluster from "../../integration/helpers/velero-cluster";
import * as velero from "../../integration/helpers/velero-extension";

import type { Frame } from "playwright";

const TIMEOUT = 15 * 60 * 1000;
const THEMES: velero.ColorTheme[] = ["Dark", "Light"];
const SIZES = [
  { name: "1440x900", width: 1440, height: 900, zoom: 1 },
  { name: "900x650", width: 900, height: 650, zoom: 1 },
  { name: "1440x900-zoom-200", width: 1440, height: 900, zoom: 2 },
];
// The sizes the accessibility scan looks at each view in: the two windows, at the zoom of 1.
const SCANNED = SIZES.filter((size) => size.zoom === 1);
// The exceptions of the scan, a file beside the suite: each names its rule, its element and the choice of a spec that
// keeps it.
const EXCEPTIONS = "e2e/__tests__/pre-review.exceptions.json";
// A file the runner may leave beside the artifacts of the suites, for one run: three views are broken on purpose, in
// the DOM of the page and for their scan alone, in the dark theme at 1440 by 900, and the scan must fail the case of
// each (VIS-02). The file goes when it is read, so that the run after is not broken.
const BREAK_SIGNAL = path.join(cluster.ARTIFACTS_DIR, "..", "break-the-scan-once");
const BREAKS: Record<string, axe.Break> = {
  // The text of the name of the first backup of the list, a grey on a grey.
  backups: { take: "contrast", selector: "[data-testid=velero-backups] button[data-backup-row]" },
  // The way back of the workspace of a backup, with no words and no title.
  workspace: { take: "name", selector: "[data-testid=velero-back]" },
  // The first namespace the form of Create backup offers by its checkbox, with its label emptied.
  "backup-create-form": {
    take: "label",
    selector: 'input[type=checkbox][data-testid^="velero-backup-create-includedNamespaces-"]',
  },
};
const OPENED = "backup-finalizingpartiallyfailed";
const RESTORES = cluster.RESTORES;
const RESTORED = "restore-mapped";
const LONG_RESTORE = cluster.LONG_RESTORE_NAME;
// The views that are checked, each in both themes at every size: eight of the tabs, then the fifty-seven of the pages,
// four of them of the adherence of the schedules, ten of the backup repositories, of the pod volume operations and of
// the data movement, two of Back up now, two of Create backup, two of Create schedule, two of Restore, four of Pause
// and Resume, and three of Delete backup.
const VIEWS = 65;
const OVERVIEW = cluster.OVERVIEW;
const SCHEDULES = cluster.SCHEDULES;
const SCHEDULED = "views-history";
// A schedule of the views that is paused, with skip immediately true, which a resume proposes.
const SKIPPING = "schedule-skipping";
// The parts of the workspace of a pause and of a resume.
const schedulePatch = (id: string) => `[data-testid=velero-schedule-patch-${id}]`;
const STORAGE = cluster.STORAGE_LOCATIONS;
const SNAPSHOT = cluster.SNAPSHOT_LOCATIONS;
// The installation of the demo, where the tabs load what the fixtures of the tabs wrote into its store,
// and the cluster as the catalog of the host names it, which is by its context.
const NAMESPACE = cluster.E2E_NAMESPACE;
const CLUSTER = cluster.E2E_KUBE_CONTEXT;
// The operations of the tabs, named by the run of the fixtures: the backup synced from the store, with
// the large log; the backup the server refused, whose log the store does not have; the restore of the demo.
const SYNCED = `fixture-synced-backup-${cluster.E2E_FIXTURE_RUN}`;
const REFUSED = `fixture-invalid-backup-${cluster.E2E_FIXTURE_RUN}`;
const DEMO_RESTORE = `fixture-restore-${cluster.E2E_FIXTURE_RUN}`;
// How long after its last load the suite waits for the server: the ten minutes a request lives after it is
// signed, the minute between two passes of the server, and a margin.
const REMOVED_WITHIN = 12 * 60 * 1000;
// The narrowest window the bar of the log is looked at in: the width of the window at twice the zoom.
const NARROWEST = 720;
// The schedule of the installation of the states of the adherence that a backup in progress holds, and the one with
// a name as long as the value of a label may be, as the fixtures name them.
const HELD = "adherence-held";
const LONG_SCHEDULE = "schedule-with-a-name-as-long-as-the-value-of-a-label-is-allowed";
// The parts of the workspace of Back up now, and its field of the name: the host gives its own element the
// identifier, or the input in it.
const backUpNow = (id: string) => `[data-testid=velero-backup-now-${id}]`;
const NAME_FIELD = `${backUpNow("field")} input, input${backUpNow("field")}`;
// The parts of the workspace of the backup of the form, and its field of the name.
const createBackup = (id: string) => `[data-testid=velero-backup-create-${id}]`;
const CREATE_FIELD = `${createBackup("field")} input, input${createBackup("field")}`;
const createSchedule = (id: string) => `[data-testid=velero-schedule-create-${id}]`;
const SCHEDULE_FIELD = `${createSchedule("field")} input, input${createSchedule("field")}`;
// An expression of 200 characters the parser takes: a zone, each of the first forty-eight minutes, and a few hours.
const LONG_EXPRESSION = `CRON_TZ=America/Argentina/ComodRivadavia ${Array.from({ length: 48 }, (_, at) => at).join(",")} 13-15 1-7,15-21 * MON-FRI`;
const SCHEDULE_EXPRESSION = `${createSchedule("expression")} input, input${createSchedule("expression")}`;
// The parts of the workspace of a restore, its field of the name, and the backup it is asked of, which ended well.
const restoreOf = (id: string) => `[data-testid=velero-restore-create-${id}]`;
const RESTORE_FIELD = `${restoreOf("field")} input, input${restoreOf("field")}`;
const RESTORABLE = "views-history-1";
const RESTORE_SOURCES = 'input[type=checkbox][data-testid^="velero-restore-create-includedNamespaces-"]';
// The parts of the workspace of a deletion, and its field of the name of the backup.
const deleteOf = (id: string) => `[data-testid=velero-backup-delete-${id}]`;
const DELETE_TYPED = `${deleteOf("typed")} input, input${deleteOf("typed")}`;
// The backup of the views with a name of 63 characters, InProgress: Delete backup is held back for it.
const LONG_BACKUP = cluster.LONG_BACKUP_NAME;
// A tab of the view that is shown: the operation the view is of, and the tab.
interface Tab {
  kind: artifacts.Operation;
  tab: artifacts.WorkspaceTab;
}
// A violation the scan found, as the report lists it: the view, the theme and the size; the rule and its impact; what
// axe-core says is to be fixed, and for a contrast the colors, their ratio and the ratio asked; the element, by a
// selector and an excerpt of its HTML; where it comes from; and whether it fails, or the spec that keeps it.
interface ScanRow {
  view: string;
  theme: string;
  size: string;
  rule: string;
  impact: string | null;
  help: string;
  summary: string;
  contrast?: accessibility.Contrast;
  element: { selector: string; html: string };
  origin: accessibility.Origin["origin"];
  component?: string;
  by: string;
  fails: boolean;
  exception?: string;
}

describe("pre-review of the views", () => {
  let started: velero.StartedApplication;
  let frame: Frame;
  let before: cluster.ClusterSnapshot;
  // What the runner counted of the artifacts of the tabs, outside the extension.
  let facts: artifacts.TabFixtureFacts;
  // When the suite last gave the second gesture of a load, which is what creates a request: nothing while
  // it gave none.
  let lastLoad = 0;
  const problems: Record<string, string[]> = {};
  const screenshots: string[] = [];
  // The exceptions of the scan, read before the application starts; the views broken on purpose, when the signal asks.
  let exceptions: accessibility.Exception[] = [];
  let breaks: Record<string, axe.Break> = {};
  // What the scan found in each layout it looked at, by the name of the layout; what became of each violation; and the
  // version of axe-core and the rules it ran.
  const scans: Record<string, { rows: ScanRow[]; undecided: string[]; broken?: string }> = {};
  const verdicts: accessibility.Verdict[] = [];
  let scannedWith: { version: string; rules: string[] } | undefined;
  // What the suite asked the extension to create, by the names the tabs gave.
  const ledger = artifacts.requestLedger();
  // What each tab loaded, by its operation and its tab.
  const loads: Record<string, artifacts.Loaded> = {};
  // What is written for who reads the run of the tabs: each view with what it shows and the requests it
  // created, what the journeys with the keyboard read, the requests of the suite, and what no suite
  // checks, which is left to the review.
  const tabs: {
    views: Record<string, { shows: string; requests: string[] }>;
    journeys: Record<string, unknown>;
    requests: Record<string, unknown>;
    humanJudgment: string[];
  } = {
    views: {},
    journeys: {},
    requests: {},
    humanJudgment: [
      "The contrast of the parts of the tabs in both themes, which no suite checks: the choices of the bar drawn as checkboxes, the match the search is at beside the other matches, the words of a failure beside its mark and its line, and the row of a resource over the rows of its items.",
      "What Escape does in the search field: it clears the words and keeps the keyboard in the field, and the view is not left. The suite of the tabs asserts that; whether it is what an operator expects of the key is for the review.",
      "Whether a long line reads well when it is cut: its row shows its first characters, and after them the words that say how many more are not shown, in the pictures of the log at 900 by 650 and at twice the zoom.",
    ],
  };

  // The scan of a layout: what axe-core found inside the root of the view, each violation with where it comes from
  // and what becomes of it. A view the signal breaks is broken in the dark theme at 1440 by 900, for that scan alone.
  const scan = async (view: string, theme: velero.ColorTheme, size: string, name: string) => {
    const broken = theme === "Dark" && size === SCANNED[0].name ? breaks[view] : undefined;
    const found = await axe.scanView(
      frame,
      exceptions.map((exception) => exception.element),
      name,
      broken,
    );

    scannedWith ??= { version: found.version, rules: found.rules };
    const rows = found.violations.map((violation): ScanRow => {
      const origin = accessibility.originOf(violation.chain);
      const verdict = accessibility.verdictOf({ ...violation, origin }, exceptions);
      const contrast = accessibility.contrastOf(violation.contrast);

      verdicts.push(verdict);
      return {
        view,
        theme: theme.toLowerCase(),
        size,
        rule: violation.rule,
        impact: violation.impact,
        help: violation.help,
        summary: violation.summary,
        ...(contrast ? { contrast } : {}),
        element: { selector: violation.selector, html: violation.html },
        origin: origin.origin,
        ...(origin.component ? { component: origin.component } : {}),
        by: origin.by,
        fails: verdict.fails,
        ...(verdict.exception === undefined ? {} : { exception: exceptions[verdict.exception].spec }),
      };
    });

    scans[name] = { rows, undecided: found.undecided, ...(broken ? { broken: broken.take } : {}) };
  };
  // Every theme at every size: the view is set by the caller, and is what is checked and captured. A
  // layout is checked once the theme, the size and the zoom are the ones that were set: one that was
  // not applied would be the layout before it, checked twice. A tab of a view is looked at as the suite
  // of the tabs looks at one: the pointer is parked in a corner, since what it rests on is drawn as
  // pointed at and is no state of the tab; a page that is scrolled, as one with a tab is at twice the
  // zoom, is looked at from its top, where its target bar is, by the check of the page, and from its end,
  // where the view is whole, by the check of the tab, which is where it is left for the picture. What `more`
  // answers at each size is recorded with the problems of the layout. At the zoom of 1 the view is then scanned, once
  // its picture is taken. The violations of the scan that fail are asserted once every layout of the view was looked
  // at, softly: the case goes on to its other views, so that each is looked at and scanned, and fails at its end.
  const everyLayout = async (
    view: string,
    prepare?: () => Promise<void>,
    of = cluster.BACKUPS,
    tab?: Tab,
    more?: () => Promise<string[]>,
  ) => {
    for (const theme of THEMES) {
      await velero.setColorTheme(started.app, started.window, theme);
      for (const size of SIZES) {
        const expected = {
          theme: theme.toLowerCase(),
          width: Math.round(size.width / size.zoom),
          height: Math.round(size.height / size.zoom),
        };

        await velero.setWindowSize(started.app, size.width, size.height);
        await velero.setZoom(started.app, size.zoom);
        expect([view, size.name, await cluster.appliedLike(frame, expected)]).toEqual([view, size.name, expected]);
        await frame.waitForTimeout(1000);
        await prepare?.();
        const name = `${theme.toLowerCase()}-${size.name}-${view}`;

        if (tab) {
          await started.window.mouse.move(1, 1);
          await artifacts.scrollPage(frame, tab.kind, "top");
          await frame.waitForTimeout(300);
          const page = await cluster.layoutProblems(frame, of);

          await artifacts.scrollPage(frame, tab.kind, "end");
          problems[name] = [...page, ...(await artifacts.tabLayoutProblems(frame, tab.kind, tab.tab))];
        } else {
          problems[name] = await cluster.layoutProblems(frame, of);
        }
        if (more) problems[name] = [...problems[name], ...(await more())];
        screenshots.push(await cluster.requiredScreenshot(frame, name, size.zoom));
        if (SCANNED.includes(size)) await scan(view, theme, size.name, name);
      }
    }
    await velero.setZoom(started.app, 1);
    await velero.setWindowSize(started.app, 1440, 900);
    await velero.setColorTheme(started.app, started.window, "Dark");
    await frame.waitForTimeout(1000);
    expect.soft({ view, failing: failingOf(view) }).toEqual({ view, failing: [] });
  };
  // The violations of the scan of a view that fail, in each layout it was scanned in, each in one line.
  const failingOf = (view: string) =>
    Object.entries(scans)
      .filter(([name]) => SCANNED.some((size) => name.endsWith(`-${size.name}-${view}`)))
      .flatMap(([name, { rows }]) =>
        rows
          .filter((row) => row.fails)
          .map((row) => `${name}: ${accessibility.violationLine({ ...row, ...row.element })}`),
      );
  // What the check of the layout found of a view, at every size.
  const found = (view: string) =>
    Object.fromEntries(
      Object.entries(problems).filter(
        ([name, list]) => SIZES.some((size) => name.endsWith(`-${size.name}-${view}`)) && list.length > 0,
      ),
    );
  // What the guard is told of a load when its second gesture was given, whatever became of the load: the
  // request the panel named is one of the suite when the cluster holds it. A load that ended without its
  // text may have created its request all the same.
  const told = (request: string) => {
    lastLoad = Date.now();
    if (request !== "" && cluster.downloadRequests(NAMESPACE).some((held) => held.name === request)) {
      ledger.add(request);
    }
  };
  // The request of a load: in the cluster under the name the tab gave it, known to the guard, of the
  // target that was asked, created by the extension; and nothing the guard was not told is in the
  // namespace, which is expected last: what it finds is of another load, and hides nothing of this one.
  const expectRequest = (kind: artifacts.Operation, tab: artifacts.ArtifactTab, name: string, request: string) => {
    const held = cluster.downloadRequests(NAMESPACE);
    const mine = held.find((entry) => entry.name === request);

    expect([kind, tab, request, request.startsWith(`${name}-`), mine !== undefined]).toEqual([
      kind,
      tab,
      request,
      true,
      true,
    ]);
    expect([kind, tab, ledger.asked().includes(request)]).toEqual([kind, tab, true]);
    expect([kind, tab, mine?.target]).toEqual([kind, tab, { kind: artifacts.ARTIFACTS[tab].targets[kind], name }]);
    expect([kind, tab, mine?.labels["app.kubernetes.io/managed-by"]]).toEqual([kind, tab, "freelens-velero-extension"]);
    expect([kind, tab, held.map((entry) => entry.name).filter((held) => !ledger.asked().includes(held))]).toEqual([
      kind,
      tab,
      [],
    ]);
  };
  // One load with the pointer, from the command of its tab to its text, told to the guard.
  const loadOf = async (kind: artifacts.Operation, tab: artifacts.ArtifactTab, name: string) => {
    const loaded = await artifacts.load(frame, kind, tab, told);

    loads[`${kind}/${tab}`] = loaded;
    expectRequest(kind, tab, name, loaded.request);
    return loaded;
  };
  // The view of an operation at a tab, as the case before left it: a case that finds another view fails by
  // its name, since a view that is opened again holds nothing of what its tabs loaded.
  const stay = async (kind: artifacts.Operation, name: string, tab: artifacts.WorkspaceTab) => {
    if (!(await artifacts.viewOf(frame, kind, name))) {
      throw new Error(
        `The view of the ${kind} ${name} is not the one that is shown: the case that opens it comes first`,
      );
    }
    await artifacts.openTab(frame, kind, tab);
  };
  // The tab of the strip that has the focus, and whether it says it is selected, read as attributes.
  const focusedTab = () =>
    frame.evaluate(() => ({
      id: document.activeElement?.getAttribute("data-testid") ?? "",
      selected: document.activeElement?.getAttribute("aria-selected") ?? "",
    }));
  // Where the keyboard is after a key, among the tabs.
  const after = async (key: string) => {
    await started.window.keyboard.press(key);
    return focusedTab();
  };
  // A report is written beside the pictures. One that would carry a part of a URL the server signed is not
  // written, and the case fails by the name of the report and of nothing in it.
  const report = async (name: string, value: unknown) => {
    if (artifacts.signedUrlIn({ [name]: JSON.stringify(value) }).length > 0) {
      throw new Error(`The report ${name} would carry a part of a signed URL: it is not written`);
    }
    await cluster.writeReport(name, value);
  };

  beforeAll(async () => {
    // A file of the exceptions that cannot be read says so before anything starts.
    exceptions = accessibility.readExceptions(
      readFileSync(new URL("./pre-review.exceptions.json", import.meta.url), "utf8"),
      EXCEPTIONS,
    );
    if (existsSync(BREAK_SIGNAL)) {
      rmSync(BREAK_SIGNAL);
      breaks = BREAKS;
      console.log(`The scan is broken on purpose in ${Object.keys(BREAKS).join(", ")}, as the signal asks`);
    }
    if (!cluster.fixturesReady()) {
      throw new Error(cluster.fixturesMissing());
    }
    facts = await artifacts.tabFixtureFacts();
    if (facts.synced.backup !== SYNCED) {
      throw new Error(
        `The facts of the fixtures are of the backup ${facts.synced.backup}, and the suite expects ${SYNCED}`,
      );
    }
    before = cluster.clusterSnapshot();
    // A request an earlier run left would be counted with the ones of this one, and removed while it runs.
    if (before.named.length > 0) {
      throw new Error(
        `Requests to Velero are in the cluster before the suite starts: ${before.named.join(", ")}. ` +
          "The server removes a DownloadRequest ten minutes after it signed it: wait for it, then run again.",
      );
    }
    let kubeconfig = "";

    // The kubeconfig is in the profile before the install is asked, for each start of the application.
    started = await velero.startWithExtension(async () => {
      kubeconfig = await cluster.publishKubeconfig();
    });
    await velero.dismissNotifications(started.window);
    await velero.navigateToCatalog(started.app);
    expect(await velero.catalogClusterCount(started.window)).toBe(1);
    frame = await cluster.openClusterFromCatalog(started.window, kubeconfig);
    await cluster.openBackups(frame);
  }, TIMEOUT);

  afterAll(async () => {
    await velero.setZoom(started.app, 1).catch(() => undefined);
    await started?.cleanup();
  }, TIMEOUT);

  it(
    "shows the choice of the installation in both themes, at every size",
    async () => {
      await frame.waitForSelector("[data-testid=velero-state-choose]", { timeout: 60_000 });
      await everyLayout("choose");
      expect(found("choose")).toEqual({});
    },
    TIMEOUT,
  );

  it(
    "chooses an installation with the keyboard alone",
    async () => {
      await frame.locator("[data-testid=velero-refresh]").focus();
      const presses = await cluster.tabTo(frame, (focus) => focus === `velero-choice-${cluster.E2E_STATIC_NAMESPACE}`);

      expect(presses).toBeLessThanOrEqual(cluster.SUGGESTED_NAMESPACES.length);
      await started.window.keyboard.press("Enter");
      await cluster.waitForBackups(frame);
      expect((await cluster.target(frame)).namespace).toBe(cluster.E2E_STATIC_NAMESPACE);
    },
    TIMEOUT,
  );

  it(
    "shows a diagnostic tab of the installation of the demo with writes off in both themes, at every size",
    async () => {
      const id = (part?: artifacts.PanelPart) => artifacts.PARTS.panel("backup", "log", part);

      await cluster.showList(frame);
      await cluster.selectInstallation(frame, NAMESPACE);
      await cluster.waitForBackups(frame);
      // The main process said where the gate is: the command that turns writes on is offered, and they are off.
      await frame.waitForSelector("[data-testid=velero-writes-on]", { timeout: 60_000 });
      expect(await cluster.writesState(frame)).toBe("off");
      await artifacts.openWorkspaceOf(frame, "backup", REFUSED);
      await artifacts.openTab(frame, "backup", "log");
      const state = await artifacts.panelState(frame, "backup", "log");

      // The way to the target bar is the one command of the tab, and the state of the gate is said first.
      expect([state.step, state.commands, state.viewer]).toEqual(["first", [id("toTarget")], false]);
      expect(await artifacts.said(frame, id("writesOff"))).toBe(artifacts.WORDS.writesOff);
      await everyLayout("tab-writes-off", undefined, cluster.BACKUPS, { kind: "backup", tab: "log" });
      tabs.views["tab-writes-off"] = { shows: `the Log tab of the backup ${REFUSED}, with writes off`, requests: [] };
      expect(found("tab-writes-off")).toEqual({});
    },
    TIMEOUT,
  );

  it(
    "moves among the tabs with the keyboard alone, from the way back: the arrows, Home and End, each tab saying whether it is selected, Enter opening one and the address naming it; and reads the roles of the list",
    async () => {
      const tab = (name: artifacts.WorkspaceTab) => artifacts.PARTS.tab("backup", name);
      const shown = artifacts.PARTS.shown("backup");
      const reached: { key: string; id: string; selected: string }[] = [];
      // Where the keyboard is after a key, kept for the report.
      const moved = async (key: string) => {
        const at = await after(key);

        reached.push({ key, ...at });
        return at;
      };

      await stay("backup", REFUSED, "log");
      await frame.locator("[data-testid=velero-back]").focus();
      expect(await cluster.focused(frame)).toBe("velero-back");
      // One press from the way back reaches Delete backup, on the line of the name, Restore being disabled for a
      // backup that failed its validation; the next reaches the strip, at its first tab. The log is the tab that is
      // open: each tab the keyboard reaches says whether it is the selected one.
      expect(await moved("Tab")).toEqual({ id: "velero-backup-delete", selected: "" });
      expect(await moved("Tab")).toEqual({ id: tab("summary"), selected: "false" });
      expect(await moved("ArrowRight")).toEqual({ id: tab("log"), selected: "true" });
      expect(await moved("End")).toEqual({ id: tab("volumes"), selected: "false" });
      expect(await moved("ArrowRight")).toEqual({ id: tab("summary"), selected: "false" });
      expect(await moved("ArrowLeft")).toEqual({ id: tab("volumes"), selected: "false" });
      expect(await moved("Home")).toEqual({ id: tab("summary"), selected: "false" });
      // Moving chose nothing: the log is still the tab that is open.
      expect((await artifacts.tabsOf(frame, "backup")).open).toBe("log");
      // Enter opens the tab the keyboard is on, which then says it is selected, and the address names it:
      // the summary by naming none.
      await started.window.keyboard.press("Enter");
      await artifacts.attributeLike(frame, shown, "data-tab", "summary");
      expect(await focusedTab()).toEqual({ id: tab("summary"), selected: "true" });
      expect((await artifacts.tabsOf(frame, "backup")).address).toBe("");
      expect(await moved("ArrowRight")).toEqual({ id: tab("log"), selected: "false" });
      await started.window.keyboard.press("Enter");
      await artifacts.attributeLike(frame, shown, "data-tab", "log");
      expect(await focusedTab()).toEqual({ id: tab("log"), selected: "true" });
      const strip = await artifacts.tabsOf(frame, "backup");

      expect([strip.address, await cluster.addressViews(frame)]).toEqual(["log", [`backup/${REFUSED}`]]);
      // The roles, read as attributes: one list of tabs with its name, five tabs each with its role and the
      // part it shows, one of them selected, and the part named by the tab that is open.
      expect([strip.role, strip.name]).toEqual(["tablist", "What is shown of the backup"]);
      expect(strip.tabs.map((each) => [each.id, each.role, each.controls])).toEqual(
        artifacts.TABS.map((each) => [tab(each.id), "tab", shown]),
      );
      expect(strip.tabs).toHaveLength(5);
      expect(strip.selected).toEqual([tab("log")]);
      expect(strip.panel).toEqual({ role: "tabpanel", id: shown, labelled: tab("log") });
      tabs.journeys["the tabs with the keyboard"] = { reached, roles: strip };
    },
    TIMEOUT,
  );

  it(
    "turns writes on, reaches the command of the tab with the keyboard alone, and shows the confirmation of the request in both themes, at every size",
    async () => {
      const id = (part?: artifacts.PanelPart) => artifacts.PARTS.panel("backup", "log", part);

      await stay("backup", REFUSED, "log");
      await cluster.turnWritesOn(frame);
      await artifacts.part(frame, id("create"));
      // From the tab that is open the keyboard goes through the three tabs after it, each one a stop, and
      // reaches the command of the tab: four presses. The command with the keyboard: what takes its place
      // has the focus, and it is not the command that creates, which is one press away.
      await (await artifacts.part(frame, artifacts.PARTS.tab("backup", "log"))).focus();
      const presses = await cluster.tabTo(frame, (focus) => focus === id("create"), 8);

      expect(presses).toBe(4);
      await started.window.keyboard.press("Enter");
      await artifacts.part(frame, id("confirm"));
      expect(await cluster.focusOn(frame, id("confirm"))).toBe(id("confirm"));
      expect(await artifacts.confirmationOf(frame, "backup", "log")).toEqual(
        artifacts.WORDS.confirmation("backup", "log", REFUSED, NAMESPACE, CLUSTER, CLUSTER),
      );
      expect(await cluster.tabTo(frame, (focus) => focus === id("confirmCreate"), 2)).toBe(1);
      expect((await artifacts.panelState(frame, "backup", "log")).step).toBe("confirming");
      await everyLayout("tab-confirmation", undefined, cluster.BACKUPS, { kind: "backup", tab: "log" });
      // The confirmation is still shown, and nothing was created for it.
      expect((await artifacts.panelState(frame, "backup", "log")).step).toBe("confirming");
      expect(cluster.downloadRequests(NAMESPACE)).toEqual([]);
      tabs.views["tab-confirmation"] = { shows: `the confirmation of the log of the backup ${REFUSED}`, requests: [] };
      tabs.journeys["the command and its confirmation with the keyboard"] = { presses, toTheCommandThatCreates: 1 };
      expect(found("tab-confirmation")).toEqual({});
    },
    TIMEOUT,
  );

  it(
    "loads the log of the backup that failed its validation from its confirmation, with the keyboard alone: the store has no such file, said by the phase, the one command takes the tab back and has the focus; in both themes, at every size",
    async () => {
      const id = (part?: artifacts.PanelPart) => artifacts.PARTS.panel("backup", "log", part);

      await stay("backup", REFUSED, "log");
      if ((await artifacts.panelState(frame, "backup", "log")).step !== "confirming") {
        throw new Error("The confirmation of the log is not shown: the case that reaches it comes first");
      }
      await (await artifacts.part(frame, id("confirmCreate"))).focus();
      const { ended, request } = await artifacts.runLoad(frame, "backup", "log", told, { keyboard: true });
      const failure = await artifacts.failureOf(frame, "backup", "log");
      const state = await artifacts.panelState(frame, "backup", "log");

      tabs.views["tab-log-missing"] = {
        shows: `the Log tab of the backup ${REFUSED}, whose file the store does not have`,
        requests: [request],
      };
      tabs.journeys["the focus after a failure that has no command to ask again"] = {
        ended,
        failure,
        commands: state.commands,
        focus: await cluster.focused(frame),
      };
      expect(ended).toBe("failed");
      expectRequest("backup", "log", REFUSED, request);
      // The server signed a URL for a file the store does not have: the load ended at the store, after the
      // request was created, which stays until the server removes it.
      expect([failure.code, artifacts.AFTER_THE_CREATION.includes(failure.stage)]).toEqual(["artifact-missing", true]);
      expect(failure.text).toBe(artifacts.WORDS.storeHasNoFile("backup", REFUSED, request, NAMESPACE));
      expect(await artifacts.attribute(frame, id("failure"), "data-ended")).toBe("missing");
      // What the missing file means is said by the phase: the backup failed its validation.
      expect(await artifacts.said(frame, id("missing"))).toBe(artifacts.WORDS.nothingForValidation("log", "backup"));
      // Asking again as it was asked is not offered: the one command takes the tab back to its first state,
      // and the focus is on it, which is where the code leaves it after a failure that has no command to
      // ask again.
      expect([state.step, state.viewer, state.commands]).toEqual(["failed", false, [id("begin")]]);
      expect(await artifacts.said(frame, id("notAgain"))).toBe(artifacts.WORDS.notAgain);
      expect(await artifacts.said(frame, id("begin"))).toBe(artifacts.WORDS.beginAgain);
      expect(await cluster.focusOn(frame, id("begin"))).toBe(id("begin"));
      await everyLayout("tab-log-missing", undefined, cluster.BACKUPS, { kind: "backup", tab: "log" });
      expect(found("tab-log-missing")).toEqual({});
    },
    TIMEOUT,
  );

  it(
    "loads the resource list of the restore of the demo, with what the restore did with each item, and shows it in both themes, at every size",
    async () => {
      await artifacts.openWorkspaceOf(frame, "restore", DEMO_RESTORE);
      await artifacts.openTab(frame, "restore", "resources");
      expect(await cluster.writesState(frame)).toBe("on");
      const loaded = await loadOf("restore", "resources", DEMO_RESTORE);
      const list = await artifacts.resourcesLike(
        frame,
        "restore",
        "shows its first rows",
        (shown) => shown.rows.length > 0,
      );
      const counted = facts.real.restore.resourceList;

      tabs.views["tab-restore-resources"] = {
        shows: `the Resources tab of the restore ${DEMO_RESTORE}, with its actions`,
        requests: [loaded.request],
      };
      // The list is the one the fixtures wrote: as many items and resources as the runner counted in the
      // file, and as many of each action.
      expect([list.items, list.resources]).toEqual([counted.items, counted.resources]);
      expect(list.columns).toEqual(["namespace", "name", "action"]);
      if (!list.actions) throw new Error("The resource list of the restore offers no choice by action");
      expect(list.actions.all.count).toBe(counted.items);
      for (const action of ["created", "updated", "failed", "skipped"] as const) {
        expect([action, list.actions[action].count]).toEqual([action, counted.actions[action] ?? 0]);
      }
      await everyLayout("tab-restore-resources", undefined, RESTORES, { kind: "restore", tab: "resources" });
      expect(found("tab-restore-resources")).toEqual({});
    },
    TIMEOUT,
  );

  it(
    "cancels the load of the log of the synced backup as soon as the panel names its request, with the keyboard alone, and finds the focus on the command that asks again; then loads it, and finds the focus on its first line",
    async () => {
      const id = (part?: artifacts.PanelPart) => artifacts.PARTS.panel("backup", "log", part);
      const keyboard = started.window.keyboard;
      // The second gesture, from the command the focus is on: Enter, the confirmation with the focus on it,
      // one press to the command that creates.
      const toTheCreation = async () => {
        await keyboard.press("Enter");
        await artifacts.part(frame, id("confirm"));
        expect(await cluster.focusOn(frame, id("confirm"))).toBe(id("confirm"));
        expect(await cluster.tabTo(frame, (focus) => focus === id("confirmCreate"), 2)).toBe(1);
      };

      await artifacts.openWorkspaceOf(frame, "backup", SYNCED);
      await artifacts.openTab(frame, "backup", "log");
      expect(await cluster.writesState(frame)).toBe("on");
      await (await artifacts.part(frame, id("create"))).focus();
      await toTheCreation();
      // The command that cancels is given inside the page, the moment the panel offers it, which is when it
      // names the request. The request the load ran is in the cluster when it was created before the
      // cancel reached it, and the guard was told.
      const cancelled = await artifacts.runLoad(frame, "backup", "log", told, { cancel: true, keyboard: true });

      if (cancelled.ended === "loaded") {
        throw new Error("The load ended with its text before the cancel reached it: nothing was cancelled");
      }
      const failure = await artifacts.failureOf(frame, "backup", "log");
      const created = ledger.asked().includes(cancelled.request);
      const afterTheCancel = await artifacts.panelState(frame, "backup", "log");

      tabs.journeys["the focus after a cancelled load"] = {
        request: cancelled.request,
        created,
        failure,
        commands: afterTheCancel.commands,
        focus: await cluster.focused(frame),
      };
      expect(cancelled.request.startsWith(`${SYNCED}-`)).toBe(true);
      expect(failure.code).toBe("cancelled");
      expect(cancelled.moments.some((moment) => moment.status === artifacts.WORDS.cancelling)).toBe(true);
      if (created) expectRequest("backup", "log", SYNCED, cancelled.request);
      // The code is safe to ask again: the command that asks again is there, and the focus is on it.
      expect([afterTheCancel.step, afterTheCancel.viewer, afterTheCancel.commands]).toEqual([
        "failed",
        false,
        [id("create")],
      ]);
      expect(await cluster.focusOn(frame, id("create"))).toBe(id("create"));
      // The load, from the command the focus is on.
      await toTheCreation();
      const { ended, request } = await artifacts.runLoad(frame, "backup", "log", told, { keyboard: true });

      expect(ended).toBe("loaded");
      const loaded = await artifacts.loadedFacts(frame, "backup", "log");

      loads["backup/log"] = loaded;
      tabs.views["tab-log-searched"] = {
        shows: `the Log tab of the backup ${SYNCED}, loaded, searched, with a level chosen`,
        requests: [...(created ? [cancelled.request] : []), loaded.request],
      };
      expect(loaded.request).toBe(request);
      expectRequest("backup", "log", SYNCED, loaded.request);
      // The keyboard is on the first line of what arrived.
      const first = artifacts.PARTS.line("backup", "log", 1);

      await artifacts.part(frame, first);
      expect(await cluster.focusOn(frame, first)).toBe(first);
      tabs.journeys["the focus after a load"] = { request: loaded.request, focus: await cluster.focused(frame) };
      // The log is the one the fixtures wrote: its lines, and the lines of each level, as the runner
      // counted them in the file.
      const log = await artifacts.logLike(
        frame,
        "backup",
        "shows its first lines",
        (shown) => shown.mounted.length > 0,
      );

      expect(log.lines).toBe(facts.synced.log.lines);
      expect(Object.fromEntries(artifacts.LOG_LEVELS.map((level) => [level, log.levels[level].count]))).toEqual(
        facts.synced.log.levels,
      );
    },
    TIMEOUT,
  );

  it(
    "loads the results and the volume information of the synced backup, each through a request of its own, and keeps the log it loaded",
    async () => {
      await stay("backup", SYNCED, "results");
      const results = await loadOf("backup", "results", SYNCED);
      const shown = await artifacts.resultsShown(frame, "backup");

      tabs.views["tab-results"] = { shows: `the Results tab of the backup ${SYNCED}`, requests: [results.request] };
      expect([shown.errors, shown.warnings]).toEqual([facts.synced.results.errors, facts.synced.results.warnings]);
      await artifacts.openTab(frame, "backup", "volumes");
      const volumes = await loadOf("backup", "volumes", SYNCED);

      tabs.views["tab-volumes-detail"] = {
        shows: `the Volumes tab of the backup ${SYNCED}, with the details of its first volume open`,
        requests: [volumes.request],
      };
      expect((await artifacts.volumesShown(frame, "backup")).count).toBe(facts.synced.volumeInfo.volumes);
      // The log is still shown as it was loaded.
      await artifacts.openTab(frame, "backup", "log");
      expect((await artifacts.panelState(frame, "backup", "log")).shown).toBe(loads["backup/log"]?.request);
    },
    TIMEOUT,
  );

  it(
    "searches the log of the synced backup with the keyboard alone: the field by its label, what is typed, the count told to who does not see against the facts of the fixtures, Enter and Shift with Enter; and shows it with a level chosen in both themes, at every size",
    async () => {
      const keyboard = started.window.keyboard;
      const search = artifacts.PARTS.viewer("backup", "log", "search");
      const status = artifacts.PARTS.viewer("backup", "log", "searchStatus");
      // Of the texts the runner searched the log for, the one the fewest lines hold, of those more than one
      // line holds: its matches are few enough to move among. The fixtures hold a text once in a line at
      // most, so what the runner counted as its matches is its lines, which is what the viewer counts.
      const searched = [...facts.synced.log.searches]
        .filter((search) => search.matches > 1)
        .sort((one, other) => one.matches - other.matches)[0];

      if (!searched) throw new Error("No text the runner searched for is in more than one line of the synced log");
      await stay("backup", SYNCED, "log");
      // The field by its label, which names it to who does not see.
      const label = await artifacts.attribute(frame, search, "aria-labelledby");

      expect(label).not.toBe("");
      expect((await frame.locator(`#${label}`).innerText()).trim()).toBe(artifacts.WORDS.searchLabel);
      await (await artifacts.part(frame, search)).focus();
      await keyboard.type(searched.text, { delay: 20 });
      const typed = await artifacts.logLike(
        frame,
        "backup",
        `is searched by "${searched.text}"`,
        (shown) => shown.search.words === searched.text && shown.search.field === searched.text,
      );

      // The count, told to who does not see by the part that has the role of a status, is read as an
      // attribute: as many matches as the runner counted for the text. The search is at the first of them,
      // and says so.
      expect(await artifacts.attribute(frame, status, "role")).toBe("status");
      expect([typed.search.matches, typed.search.match, typed.search.line !== undefined]).toEqual([
        searched.matches,
        0,
        true,
      ]);
      expect(typed.search.said).toBe(artifacts.WORDS.match(0, searched.matches, typed.search.line ?? 0));
      // Enter moves to the next match, and Shift with Enter back to the one before, with the keyboard in
      // the field.
      await keyboard.press("Enter");
      const next = await artifacts.logLike(
        frame,
        "backup",
        "is at its second match",
        (shown) => shown.search.match === 1,
      );

      expect(next.search.said).toBe(artifacts.WORDS.match(1, searched.matches, next.search.line ?? 0));
      expect((next.search.line ?? 0) > (typed.search.line ?? 0)).toBe(true);
      await keyboard.press("Shift+Enter");
      const back = await artifacts.logLike(
        frame,
        "backup",
        "is at its first match again",
        (shown) => shown.search.match === 0,
      );

      expect(back.search.line).toBe(typed.search.line);
      expect(await cluster.focusOn(frame, search)).toBe(search);
      tabs.journeys["the search with the keyboard"] = {
        label,
        typed: searched.text,
        matches: typed.search.matches,
        counted: searched.matches,
        lines: [typed.search.line, next.search.line, back.search.line],
      };
      // A level chosen: the one most lines are of, as the runner counted them.
      const level = [...artifacts.LOG_LEVELS].sort(
        (one, other) => facts.synced.log.levels[other] - facts.synced.log.levels[one],
      )[0];

      await artifacts.clickOn(frame, artifacts.PARTS.level("backup", level));
      await artifacts.logLike(
        frame,
        "backup",
        `shows the lines of the level ${level}`,
        (shown) => shown.levels[level].chosen && shown.shown === facts.synced.log.levels[level],
      );
      await everyLayout("tab-log-searched", undefined, cluster.BACKUPS, { kind: "backup", tab: "log" });
      expect(found("tab-log-searched")).toEqual({});
    },
    TIMEOUT,
  );

  it(
    "stands still at the widths where the bar of the log goes to a second line",
    async () => {
      const viewer = artifacts.PARTS.viewer("backup", "log");
      // The bar of the viewer is its first part; the list it scrolls and the strip of the tabs are watched
      // with it.
      const watched = [
        `[data-testid="${viewer}"] > :first-child`,
        `[data-testid="${artifacts.PARTS.viewer("backup", "log", "text")}"]`,
        `[data-testid="${artifacts.PARTS.strip("backup")}"]`,
      ];
      const tall = async (width: number) => {
        await velero.setWindowSize(started.app, width, 900);
        await frame.waitForTimeout(300);
        return (await cluster.movesOf(frame, cluster.BACKUPS, 1, watched)).heights[0];
      };
      // The widths at which the bar is taller than it was eight pixels wider: where its levels, its count or
      // what its search says go to another line. They are of the words the bar holds and of the font they
      // are written in, and are found from the widest window to the narrowest a view is looked at in.
      const transitions: number[] = [];
      const moved: Record<number, unknown> = {};

      await stay("backup", SYNCED, "log");
      try {
        let before = await tall(1440);

        for (let width = 1440 - 8; width >= NARROWEST; width -= 8) {
          const now = await tall(width);

          if (now > before) transitions.push(width);
          before = now;
        }
        expect(transitions.length).toBeGreaterThan(0);
        // A scrollbar that comes and goes makes the view narrower and wider by what it is wide: around the
        // width the bar goes to another line at, the view with it would not be the view without it.
        for (const transition of transitions) {
          for (let at = transition + 16; at >= transition - 8; at -= 2) {
            await velero.setWindowSize(started.app, at, 900);
            await frame.waitForTimeout(500);
            let found = await cluster.movesOf(frame, cluster.BACKUPS, 60, watched);

            // A page that was given another width takes a moment to be still, and the installation may be
            // read while it is looked at, once: what comes and goes is never still.
            for (let again = 0; again < 3 && found.changes > 1; again += 1) {
              found = await cluster.movesOf(frame, cluster.BACKUPS, 60, watched);
            }
            if (found.changes > 1 || found.scrolled) moved[at] = found;
          }
        }
      } finally {
        // The views after this one are looked at in the window they expect.
        await velero.setWindowSize(started.app, 1440, 900);
        await frame.waitForTimeout(1000);
      }
      tabs.journeys["the widths where the bar of the log goes to a second line"] = { transitions, moved };
      expect(moved).toEqual({});
    },
    TIMEOUT,
  );

  it(
    "shows the log of the synced backup with its lines wrapped in both themes, at every size",
    async () => {
      await stay("backup", SYNCED, "log");
      await artifacts.clickOn(frame, artifacts.PARTS.viewer("backup", "log", "wrap"));
      const wrapped = await artifacts.logLike(
        frame,
        "backup",
        "wraps its lines",
        (shown) => shown.wrap && shown.columns !== undefined && shown.mounted.length > 0,
      );

      expect(wrapped.columns).toBeGreaterThanOrEqual(20);
      tabs.views["tab-log-wrapped"] = { shows: `the same log, with its lines wrapped`, requests: [] };
      await everyLayout("tab-log-wrapped", undefined, cluster.BACKUPS, { kind: "backup", tab: "log" });
      expect(found("tab-log-wrapped")).toEqual({});
    },
    TIMEOUT,
  );

  it(
    "shows the results of the synced backup in both themes, at every size",
    async () => {
      await stay("backup", SYNCED, "results");
      expect((await artifacts.panelState(frame, "backup", "results")).shown).toBe(loads["backup/results"]?.request);
      await everyLayout("tab-results", undefined, cluster.BACKUPS, { kind: "backup", tab: "results" });
      expect(found("tab-results")).toEqual({});
    },
    TIMEOUT,
  );

  it(
    "shows the volume information of the synced backup with the details of a volume open in both themes, at every size",
    async () => {
      const toggle = artifacts.PARTS.volumeToggle("backup", 0);
      const details = artifacts.PARTS.volumeDetails("backup", 0);

      await stay("backup", SYNCED, "volumes");
      expect((await artifacts.panelState(frame, "backup", "volumes")).shown).toBe(loads["backup/volumes"]?.request);
      await artifacts.clickOn(frame, toggle);
      await artifacts.attributeLike(frame, toggle, "aria-expanded", "true");
      await artifacts.part(frame, details);
      await everyLayout(
        "tab-volumes-detail",
        async () => {
          // The details are under the rows: they are brought into the room of the view for the picture.
          await (await artifacts.part(frame, details)).scrollIntoViewIfNeeded();
        },
        cluster.BACKUPS,
        { kind: "backup", tab: "volumes" },
      );
      expect(found("tab-volumes-detail")).toEqual({});
    },
    TIMEOUT,
  );

  it(
    "comes back to the installation the second case chose, which turns writes off, and leaves the view",
    async () => {
      await cluster.showList(frame);
      await cluster.selectInstallation(frame, cluster.E2E_STATIC_NAMESPACE);
      await cluster.waitForBackups(frame);
      expect((await cluster.target(frame)).namespace).toBe(cluster.E2E_STATIC_NAMESPACE);
      await frame.waitForSelector("[data-testid=velero-writes][data-writes=off]", { timeout: 60_000 });
      expect(await cluster.writesState(frame)).toBe("off");
    },
    TIMEOUT,
  );

  it(
    "shows the list of the backups in both themes, at every size",
    async () => {
      await cluster.showList(frame);
      await everyLayout("backups");
      expect(found("backups")).toEqual({});
    },
    TIMEOUT,
  );

  it(
    "stands still at the widths where the target bar goes to a second line",
    async () => {
      await cluster.showList(frame);
      const tall = async (width: number) => {
        await velero.setWindowSize(started.app, width, 900);
        await frame.waitForTimeout(300);
        return (await cluster.movesOf(frame, cluster.BACKUPS, 1)).bar;
      };
      const wide = await tall(1440);
      let width = 1440;

      // The width the bar is taller at is of the words it holds and of the font they are written in.
      while (width > 900 && (await tall(width)) <= wide) width -= 8;
      expect(width).toBeGreaterThan(900);
      // A scrollbar that comes and goes makes the page narrower and wider by what it is wide: around the
      // width the bar goes to a second line at, the page with it would not be the page without it.
      const moved: Record<number, unknown> = {};

      try {
        for (let at = width + 24; at >= width - 8; at -= 2) {
          await velero.setWindowSize(started.app, at, 900);
          await frame.waitForTimeout(500);
          let found = await cluster.movesOf(frame);

          // A page that was given another width takes a moment to be still, and the installation may be
          // read while it is looked at, once: what comes and goes is never still, however long it is
          // looked at.
          for (let again = 0; again < 3 && found.changes > 1; again += 1) found = await cluster.movesOf(frame);
          if (found.changes > 1 || found.scrolled) moved[at] = found;
        }
      } finally {
        // The views after this one are looked at in the window they expect.
        await velero.setWindowSize(started.app, 1440, 900);
        await frame.waitForTimeout(1000);
      }
      expect(moved).toEqual({});
    },
    TIMEOUT,
  );

  it(
    "opens a backup and comes back with the keyboard alone, and finds the focus where it was",
    async () => {
      await cluster.showList(frame);
      await frame.locator("[data-testid=velero-refresh]").focus();
      // From the target bar to the list: the search, the headers of the columns, and the rows by their names.
      await cluster.tabTo(frame, (focus) => focus === "backup-completed");
      await cluster.tabTo(frame, (focus) => focus === OPENED, 20);
      await started.window.keyboard.press("Enter");
      await frame.waitForSelector(`[data-testid=velero-backup-workspace] >> text="${OPENED}"`, { timeout: 60_000 });
      expect(await cluster.focusOn(frame, "velero-back")).toBe("velero-back");
      await started.window.keyboard.press("Escape");
      await frame.waitForSelector("[data-testid=velero-backup-workspace]", { state: "detached", timeout: 60_000 });
      expect(await cluster.focusOn(frame, OPENED)).toBe(OPENED);
      // The same with the way back, which is where the focus starts from.
      await started.window.keyboard.press("Enter");
      await frame.waitForSelector(`[data-testid=velero-backup-workspace] >> text="${OPENED}"`, { timeout: 60_000 });
      expect(await cluster.focusOn(frame, "velero-back")).toBe("velero-back");
      await started.window.keyboard.press("Enter");
      await frame.waitForSelector("[data-testid=velero-backup-workspace]", { state: "detached", timeout: 60_000 });
      expect(await cluster.focusOn(frame, OPENED)).toBe(OPENED);
      // The selector of the installation answers to the keyboard as well.
      await frame.locator("#velero-installation").focus();
      await started.window.keyboard.press("ArrowDown");
      await frame.waitForSelector(".Select__option", { timeout: 60_000 });
      await started.window.keyboard.press("Escape");
      expect((await cluster.target(frame)).namespace).toBe(cluster.E2E_STATIC_NAMESPACE);
    },
    TIMEOUT,
  );

  it(
    "shows the workspace of a backup in both themes, at every size",
    async () => {
      await cluster.showList(frame);
      await cluster.openWorkspace(frame, OPENED);
      // The summary holds the band of the volumes, which says here that the installation holds no pod volume backup
      // of the backup, with no row: the pictures are taken once it says so, and not while it is being read.
      // The room of its rows at 900 by 650 and at twice the zoom is seen once the fixtures place operations of a
      // backup.
      expect((await cluster.volumeBand(frame, "none")).state).toBe("none");
      await everyLayout("workspace");
      await everyLayout("workspace-references", async () => {
        await frame.locator("[data-testid=velero-backup-references]").scrollIntoViewIfNeeded();
      });
      await cluster.closeWorkspace(frame);
      expect(found("workspace")).toEqual({});
      expect(found("workspace-references")).toEqual({});
    },
    TIMEOUT,
  );

  it(
    "shows a name as long as a name can be without covering what is beside it",
    async () => {
      await cluster.showList(frame);
      await cluster.selectInstallation(frame, cluster.E2E_VIEWS_NAMESPACE);
      await cluster.waitForBackups(frame);
      await everyLayout("long-name");
      const long = (await cluster.mountedBackups(frame)).find((name) => name.length === 63) ?? "";

      expect(long).not.toBe("");
      await cluster.openWorkspace(frame, long);
      await everyLayout("long-name-workspace");
      await cluster.closeWorkspace(frame);
      expect(found("long-name")).toEqual({});
      expect(found("long-name-workspace")).toEqual({});
    },
    TIMEOUT,
  );

  it(
    "shows the list of the restores in both themes, at every size",
    async () => {
      await cluster.showList(frame);
      await cluster.openPage(frame, RESTORES);
      await cluster.waitForList(frame, RESTORES);
      expect((await cluster.target(frame)).namespace).toBe(cluster.E2E_VIEWS_NAMESPACE);
      await everyLayout("restores", undefined, RESTORES);
      expect(found("restores")).toEqual({});
    },
    TIMEOUT,
  );

  it(
    "shows a restore with names as long as they can be without covering what is beside them",
    async () => {
      await cluster.showList(frame);
      // The row of the restore, with the name of its backup in the source, is in the list that was checked.
      const cells = await cluster.cellsOf(RESTORES, frame, LONG_RESTORE);

      expect(LONG_RESTORE).toHaveLength(63);
      expect(cells.name).toBe(LONG_RESTORE);
      expect(cells.source).toHaveLength(63);
      await cluster.openWorkspace(frame, LONG_RESTORE, RESTORES);
      expect(await frame.locator("[data-testid=velero-restore-name]").innerText()).toBe(LONG_RESTORE);
      await everyLayout("long-restore-workspace", undefined, RESTORES);
      await everyLayout(
        "long-restore-workspace-into",
        async () => {
          await frame.locator("[data-testid=velero-restore-mappings]").scrollIntoViewIfNeeded();
        },
        RESTORES,
      );
      // The names of the namespaces it maps are whole, in the two themes and at every size.
      const mapping = (await frame.locator("[data-testid=velero-restore-mappings] tbody td").allInnerTexts()).map(
        (text) => text.trim(),
      );

      expect(mapping.map((name) => name.length)).toEqual([63, 63]);
      await cluster.closeWorkspace(frame);
      expect(found("long-restore-workspace")).toEqual({});
      expect(found("long-restore-workspace-into")).toEqual({});
    },
    TIMEOUT,
  );

  it(
    "opens a restore, follows it to its backup and comes back with the keyboard alone",
    async () => {
      await cluster.showList(frame);
      await frame.locator("[data-testid=velero-refresh]").focus();
      await cluster.tabTo(frame, (focus) => focus === RESTORED, 60);
      await started.window.keyboard.press("Enter");
      await frame.waitForSelector(`[data-testid=velero-restore-name] >> text="${RESTORED}"`, { timeout: 60_000 });
      expect(await cluster.focusOn(frame, "velero-back")).toBe("velero-back");
      // From the way back the keyboard goes through the five tabs of the workspace, each one a stop as the
      // tabs of the host are, then the band of its volumes, whose rows, the seven pod volume restores of the
      // restore, each hold a way to the operation and a link to its pod, five of them a link to the node a node
      // agent accepted them on, and the data downloads of the restore, each a way, with a link to the node of the
      // ones a node agent prepared; then it reaches the way to the backup.
      const downloads = cluster.labelledObjects<{ status?: { node?: string } }>(
        "datadownloads",
        `velero.io/restore-name=${RESTORED}`,
        cluster.E2E_VIEWS_NAMESPACE,
      );

      expect((await cluster.volumeBand(frame, "rows")).rows).toHaveLength(7);
      expect((await cluster.volumeBand(frame, "rows", "DataDownload")).rows).toHaveLength(downloads.length);
      const stops = await frame
        .locator("[data-testid=velero-volume-band] a, [data-testid=velero-volume-band] button")
        .count();

      expect(stops).toBe(7 + 7 + 5 + downloads.length + downloads.filter(({ status }) => status?.node).length);
      expect(await cluster.tabTo(frame, (focus) => focus.startsWith("velero-open-backup-"), 6 + stops + 2)).toBe(
        6 + stops,
      );
      await started.window.keyboard.press("Enter");
      await frame.waitForSelector("[data-testid=velero-backup-workspace]", { timeout: 60_000 });
      expect(await cluster.focusOn(frame, "velero-back")).toBe("velero-back");
      expect((await cluster.shownView(frame))?.back).toBe(`arrow_back Restores / ${RESTORED}`);
      await started.window.keyboard.press("Escape");
      await frame.waitForSelector(`[data-testid=velero-restore-name] >> text="${RESTORED}"`, { timeout: 60_000 });
      expect(await cluster.focusOn(frame, "velero-back")).toBe("velero-back");
      await started.window.keyboard.press("Escape");
      await frame.waitForSelector("[data-testid=velero-restore-workspace]", { state: "detached", timeout: 60_000 });
      expect(await cluster.focusOn(frame, RESTORED)).toBe(RESTORED);
      // Escape is heard from a text of the view that was clicked, which is not a control.
      await started.window.keyboard.press("Enter");
      await frame.waitForSelector(`[data-testid=velero-restore-name] >> text="${RESTORED}"`, { timeout: 60_000 });
      await frame.locator("[data-testid=velero-restore-name]").click();
      await started.window.keyboard.press("Escape");
      await frame.waitForSelector("[data-testid=velero-restore-workspace]", { state: "detached", timeout: 60_000 });
      expect(await cluster.focusOn(frame, RESTORED)).toBe(RESTORED);
    },
    TIMEOUT,
  );

  it(
    "shows the workspace of a restore in both themes, at every size",
    async () => {
      await cluster.showList(frame);
      await cluster.openWorkspace(frame, RESTORED, RESTORES);
      // The summary holds the band of the volumes, with the seven pod volume restores and the eight data downloads the
      // views place for the restore in the rows of its two halves, and the pictures are taken once it shows them: the
      // room of its rows at 900 by 650 and at twice the zoom is seen in the pictures of the band.
      expect((await cluster.volumeBand(frame, "rows")).state).toBe("rows");
      expect((await cluster.volumeBand(frame, "rows", "DataDownload")).state).toBe("rows");
      await everyLayout("restore-workspace", undefined, RESTORES);
      await everyLayout(
        "restore-workspace-volumes",
        async () => {
          await frame.locator("[data-testid=velero-volume-band]").scrollIntoViewIfNeeded();
        },
        RESTORES,
      );
      await everyLayout(
        "restore-workspace-into",
        async () => {
          await frame.locator("[data-testid=velero-restore-mappings]").scrollIntoViewIfNeeded();
        },
        RESTORES,
      );
      await everyLayout(
        "restore-workspace-scope",
        async () => {
          await frame.locator("[data-testid=velero-restore-scope]").scrollIntoViewIfNeeded();
        },
        RESTORES,
      );
      await cluster.closeWorkspace(frame);
      expect(found("restore-workspace")).toEqual({});
      expect(found("restore-workspace-volumes")).toEqual({});
      expect(found("restore-workspace-into")).toEqual({});
      expect(found("restore-workspace-scope")).toEqual({});
    },
    TIMEOUT,
  );

  it(
    "shows the list of the schedules in both themes, at every size",
    async () => {
      await cluster.showList(frame);
      await cluster.openPage(frame, SCHEDULES);
      await cluster.waitForList(frame, SCHEDULES);
      await everyLayout("schedules", undefined, SCHEDULES);
      expect(found("schedules")).toEqual({});
    },
    TIMEOUT,
  );

  it(
    "reads the history of a schedule with the keyboard alone: its line of time, mark by mark, and its list",
    async () => {
      await cluster.showList(frame);
      await frame.locator("[data-testid=velero-refresh]").focus();
      await cluster.tabTo(frame, (focus) => focus === SCHEDULED, 80);
      await started.window.keyboard.press("Enter");
      await frame.waitForSelector(`[data-testid=velero-schedule-name] >> text="${SCHEDULED}"`, { timeout: 60_000 });
      expect(await cluster.focusOn(frame, "velero-back")).toBe("velero-back");
      // After the way back, the commands of the schedule and the newest backup, the marks of the line, from the
      // oldest, one press each.
      const reached: string[] = [];
      const line = await cluster.history(frame);

      // Each day of the history has its mark: what is expected below is of an environment that is not old.
      expect(cluster.dayOnTheLine(line.width)).toBeGreaterThan(2 * cluster.MARK_WIDTH);
      for (let presses = 0; presses < 16 && reached.length < 7; presses += 1) {
        await started.window.keyboard.press("Tab");
        const mark = await frame.evaluate(() => document.activeElement?.getAttribute("data-strip-mark") ?? "");

        if (mark) {
          reached.push(mark);
          // What a mark is, is said to who does not see it.
          expect(await frame.evaluate(() => document.activeElement?.getAttribute("aria-label") ?? "")).toContain(
            mark.split(",")[0],
          );
        }
      }
      expect(reached).toEqual((await cluster.history(frame)).marks);
      expect(reached).toHaveLength(7);
      // The mark that holds two backups shows them alone in the list, and the next press goes on along the line.
      await frame.locator('[data-strip-mark="views-history-3-again,views-history-3"]').focus();
      await started.window.keyboard.press("Enter");
      expect((await cluster.history(frame)).rows).toEqual(["views-history-3-again", "views-history-3"]);
      await started.window.keyboard.press("Enter");
      expect((await cluster.history(frame)).rows).toHaveLength(8);
      // A mark of one backup opens it, and Escape comes back to the schedule.
      await frame.locator('[data-strip-mark="views-history-6"]').focus();
      await started.window.keyboard.press("Enter");
      await frame.waitForSelector('[data-testid=velero-backup-name] >> text="views-history-6"', { timeout: 60_000 });
      await started.window.keyboard.press("Escape");
      await frame.waitForSelector(`[data-testid=velero-schedule-name] >> text="${SCHEDULED}"`, { timeout: 60_000 });
      await started.window.keyboard.press("Escape");
      await frame.waitForSelector("[data-testid=velero-schedule-workspace]", { state: "detached", timeout: 60_000 });
      expect(await cluster.focusOn(frame, SCHEDULED)).toBe(SCHEDULED);
    },
    TIMEOUT,
  );

  it(
    "shows the workspace of a schedule, its history and its template in both themes, at every size",
    async () => {
      await cluster.showList(frame);
      await cluster.openWorkspace(frame, SCHEDULED, SCHEDULES);
      await everyLayout("schedule-workspace", undefined, SCHEDULES);
      await everyLayout(
        "schedule-workspace-history",
        async () => {
          await frame.locator("[data-testid=velero-history-strip]").scrollIntoViewIfNeeded();
          // At every width each backup is on the line, in a mark of its own or with the ones close to it.
          const shown = await cluster.history(frame);

          expect(cluster.backupsOnTheLine(shown.marks)).toEqual([...shown.rows].reverse());
          // No mark is drawn over another, at whatever width.
          expect(shown.over).toEqual([]);
        },
        SCHEDULES,
      );
      await everyLayout(
        "schedule-workspace-template",
        async () => {
          await frame.locator("[data-testid=velero-schedule-template]").scrollIntoViewIfNeeded();
        },
        SCHEDULES,
      );
      await cluster.closeWorkspace(frame);
      expect(found("schedule-workspace")).toEqual({});
      expect(found("schedule-workspace-history")).toEqual({});
      expect(found("schedule-workspace-template")).toEqual({});
    },
    TIMEOUT,
  );

  it(
    "shows the lists of the locations in both themes, at every size",
    async () => {
      await cluster.showList(frame);
      await cluster.openPage(frame, STORAGE);
      await cluster.waitForList(frame, STORAGE);
      await everyLayout("storage-locations", undefined, STORAGE);
      expect(found("storage-locations")).toEqual({});
      await cluster.openPage(frame, SNAPSHOT);
      await cluster.waitForList(frame, SNAPSHOT);
      await everyLayout("snapshot-locations", undefined, SNAPSHOT);
      expect(found("snapshot-locations")).toEqual({});
    },
    TIMEOUT,
  );

  it(
    "opens a location and what uses it with the keyboard alone, and comes back to its row",
    async () => {
      await velero.setColorTheme(started.app, started.window, "Dark");
      await velero.setWindowSize(started.app, 1440, 900);
      await velero.setZoom(started.app, 1);
      await cluster.showList(frame);
      await cluster.openPage(frame, STORAGE);
      await cluster.waitForList(frame, STORAGE);
      await frame.locator("[data-testid=velero-refresh]").focus();
      await cluster.tabTo(frame, (focus) => focus === "views-available", 80);
      await started.window.keyboard.press("Enter");
      await frame.waitForSelector('[data-testid=velero-storage-location-name] >> text="views-available"', {
        timeout: 60_000,
      });
      expect(await cluster.focusOn(frame, "velero-back")).toBe("velero-back");
      // After the way back, what uses the location: the newest backup that names it, then the schedules.
      const reached = await cluster.tabTo(frame, (focus) => focus.startsWith("velero-open-backup-"), 5);

      expect(reached).toBeLessThanOrEqual(5);
      const backup = (await cluster.focused(frame)).replace("velero-open-backup-", "");

      await started.window.keyboard.press("Enter");
      await frame.waitForSelector(`[data-testid=velero-backup-name] >> text="${backup}"`, { timeout: 60_000 });
      await started.window.keyboard.press("Escape");
      await frame.waitForSelector('[data-testid=velero-storage-location-name] >> text="views-available"', {
        timeout: 60_000,
      });
      await cluster.tabTo(frame, (focus) => focus.startsWith("velero-open-schedule-"), 8);
      const schedule = (await cluster.focused(frame)).replace("velero-open-schedule-", "");

      await started.window.keyboard.press("Enter");
      await frame.waitForSelector(`[data-testid=velero-schedule-name] >> text="${schedule}"`, { timeout: 60_000 });
      await started.window.keyboard.press("Escape");
      await frame.waitForSelector('[data-testid=velero-storage-location-name] >> text="views-available"', {
        timeout: 60_000,
      });
      await started.window.keyboard.press("Escape");
      await frame.waitForSelector("[data-testid=velero-storage-location-workspace]", {
        state: "detached",
        timeout: 60_000,
      });
      expect(await cluster.focusOn(frame, "views-available")).toBe("views-available");
    },
    TIMEOUT,
  );

  it(
    "shows the workspace of a location, a message of many lines and what uses it in both themes, at every size",
    async () => {
      await cluster.showList(frame);
      await cluster.openPage(frame, STORAGE);
      await cluster.waitForList(frame, STORAGE);
      await cluster.openWorkspace(frame, "views-unavailable", STORAGE);
      // What Velero says of the location, in the lines it says it in, is read whole at every size.
      await everyLayout(
        "storage-location-workspace",
        async () => {
          const status = (await frame.locator("[data-testid=velero-storage-location-status]").innerText()).replace(
            /\s+/g,
            " ",
          );

          expect(status).toContain("and the second attempt ended as the first.");
        },
        STORAGE,
      );
      await cluster.closeWorkspace(frame);
      // A name, a bucket and a prefix as long as they can be are read whole, at every size.
      await cluster.openWorkspace(frame, cluster.LONG_LOCATION_NAME, STORAGE);
      await everyLayout(
        "long-location-workspace",
        async () => {
          const storage = (await frame.locator("[data-testid=velero-storage-location-storage]").innerText()).replace(
            /\s+/g,
            " ",
          );

          expect(await frame.locator("[data-testid=velero-storage-location-name]").innerText()).toBe(
            cluster.LONG_LOCATION_NAME,
          );
          expect(storage).toContain("bucket-with-a-name-as-long-as-the-name-of-a-bucket-can-be-in-s3");
          expect(storage).toContain("kept/for/a/year");
        },
        STORAGE,
      );
      await cluster.closeWorkspace(frame);
      await cluster.openWorkspace(frame, "views-with-credential", STORAGE);
      await everyLayout(
        "storage-location-workspace-storage",
        async () => {
          await frame.locator("[data-testid=velero-storage-location-credentials]").scrollIntoViewIfNeeded();
        },
        STORAGE,
      );
      await cluster.closeWorkspace(frame);
      await cluster.openWorkspace(frame, "views-available", STORAGE);
      await everyLayout(
        "storage-location-workspace-users",
        async () => {
          await frame.locator("[data-testid=velero-location-users]").scrollIntoViewIfNeeded();
        },
        STORAGE,
      );
      await cluster.closeWorkspace(frame);
      await cluster.openPage(frame, SNAPSHOT);
      await cluster.waitForList(frame, SNAPSHOT);
      await cluster.openWorkspace(frame, "views-snapshots", SNAPSHOT);
      await everyLayout("snapshot-location-workspace", undefined, SNAPSHOT);
      await cluster.closeWorkspace(frame);
      for (const view of [
        "storage-location-workspace",
        "long-location-workspace",
        "storage-location-workspace-storage",
        "storage-location-workspace-users",
        "snapshot-location-workspace",
      ]) {
        expect([view, found(view)]).toEqual([view, {}]);
      }
    },
    TIMEOUT,
  );

  it(
    "shows the lists of the backup repositories, the pod volume backups, the pod volume restores, the data uploads and the data downloads in both themes, at every size",
    async () => {
      for (const [view, list] of [
        ["backup-repositories", cluster.REPOSITORIES],
        ["pod-volume-backups", cluster.POD_VOLUME_BACKUPS],
        ["pod-volume-restores", cluster.POD_VOLUME_RESTORES],
        ["data-uploads", cluster.DATA_UPLOADS],
        ["data-downloads", cluster.DATA_DOWNLOADS],
      ] as const) {
        await cluster.showList(frame);
        await cluster.openPage(frame, list);
        await cluster.waitForList(frame, list);
        expect([view, (await cluster.target(frame)).namespace]).toEqual([view, cluster.E2E_VIEWS_NAMESPACE]);
        await everyLayout(view, undefined, list);
        expect([view, found(view)]).toEqual([view, {}]);
      }
    },
    TIMEOUT,
  );

  it(
    "shows a repository with its maintenances and what used it, the band of the backup in progress whole, and a pod volume backup that failed with a message of several lines, in both themes, at every size",
    async () => {
      // The repository of the views whose newest maintenance failed: its three maintenances and what used it.
      await cluster.showList(frame);
      await cluster.openPage(frame, cluster.REPOSITORIES);
      await cluster.waitForList(frame, cluster.REPOSITORIES);
      await cluster.openWorkspace(frame, "views-workloads-views-available-kopia", cluster.REPOSITORIES);
      await frame.waitForSelector("[data-testid=velero-backup-repository-maintenances]", { timeout: 60_000 });
      // What used it, once each kind of the operations is read: none of its parts is being read when it is looked at.
      await frame.waitForFunction(
        () => {
          const used = document.querySelector("[data-testid=velero-used-by]");

          return used !== null && used.querySelector("[data-state=loading], [data-state=not-read]") === null;
        },
        undefined,
        { timeout: 60_000 },
      );
      await everyLayout("backup-repository-workspace", undefined, cluster.REPOSITORIES);
      expect(found("backup-repository-workspace")).toEqual({});
      await cluster.closeWorkspace(frame);
      // The band of the backup in progress with all of its rows shown, read where it is in the view.
      const band = frame.locator("[data-testid=velero-volume-band]");

      await cluster.openPage(frame, cluster.BACKUPS);
      await cluster.waitForList(frame, cluster.BACKUPS);
      await cluster.openWorkspace(frame, "backup-inprogress", cluster.BACKUPS);
      await cluster.volumeBand(frame, "rows");
      await cluster.volumeBand(frame, "rows", "DataUpload");
      // Each half shows ten rows and the command that shows ten more, which shows the rest: the twelve data uploads of
      // the backup, beside its pod volume backups.
      for (const kind of ["PodVolumeBackup", "DataUpload"]) {
        await frame
          .locator(`[data-testid=velero-volume-half][data-kind=${kind}] [data-testid=velero-volume-more]`)
          .click();
        await frame.waitForSelector(
          `[data-testid=velero-volume-half][data-kind=${kind}] [data-testid=velero-volume-more]`,
          {
            state: "detached",
            timeout: 60_000,
          },
        );
      }
      await everyLayout("backup-inprogress-band", () => band.scrollIntoViewIfNeeded());
      expect(found("backup-inprogress-band")).toEqual({});
      // Its pod volume backup that failed with a message of several lines, read on the cluster by the label of the
      // backup, opened from its row.
      const [failed] = cluster
        .labelledObjects<{ metadata: { name: string }; status?: { phase?: string; message?: string } }>(
          "podvolumebackups",
          "velero.io/backup-name=backup-inprogress",
          cluster.E2E_VIEWS_NAMESPACE,
        )
        .filter(({ status }) => status?.phase === "Failed" && (status.message ?? "").includes("\n"));

      expect(failed).toBeDefined();
      await frame.locator(`[data-testid="velero-open-pod-volume-backup-${failed.metadata.name}"]`).click();
      await frame.waitForSelector("[data-testid=velero-pod-volume-backup-workspace]", { timeout: 60_000 });
      await everyLayout("pod-volume-backup-workspace");
      expect(found("pod-volume-backup-workspace")).toEqual({});
      await cluster.closeWorkspace(frame);
      await cluster.closeWorkspace(frame);
    },
    TIMEOUT,
  );

  it(
    "shows a data upload that failed with a message of several lines and a data download with the way to the data upload of its snapshot, in both themes, at every size",
    async () => {
      // The data upload of the backup in progress that failed with a message of several lines, read on the cluster by
      // the label of the backup, opened from its row in the second half of the band.
      const [failed] = cluster
        .labelledObjects<{ metadata: { name: string }; status?: { phase?: string; message?: string } }>(
          "datauploads",
          "velero.io/backup-name=backup-inprogress",
          cluster.E2E_VIEWS_NAMESPACE,
        )
        .filter(({ status }) => status?.phase === "Failed" && (status.message ?? "").includes("\n"));

      expect(failed).toBeDefined();
      await cluster.showList(frame);
      await cluster.openPage(frame, cluster.BACKUPS);
      await cluster.waitForList(frame, cluster.BACKUPS);
      await cluster.openWorkspace(frame, "backup-inprogress", cluster.BACKUPS);
      await cluster.volumeBand(frame, "rows", "DataUpload");
      const way = frame.locator(`[data-testid="velero-open-data-upload-${failed.metadata.name}"]`);

      if (!(await way.count())) {
        await frame
          .locator("[data-testid=velero-volume-half][data-kind=DataUpload] [data-testid=velero-volume-more]")
          .click();
      }
      await way.click();
      await frame.waitForSelector("[data-testid=velero-data-upload-workspace]", { timeout: 60_000 });
      await everyLayout("data-upload-workspace");
      expect(found("data-upload-workspace")).toEqual({});
      await cluster.closeWorkspace(frame);
      await cluster.closeWorkspace(frame);
      // The data download of the mapped restore that completed, whose snapshot a data upload of the installation
      // names, opened from its row in the second half of the band of the restore.
      const [completed] = cluster
        .labelledObjects<{ metadata: { name: string }; status?: { phase?: string } }>(
          "datadownloads",
          `velero.io/restore-name=${RESTORED}`,
          cluster.E2E_VIEWS_NAMESPACE,
        )
        .filter(({ status }) => status?.phase === "Completed");

      expect(completed).toBeDefined();
      await cluster.openPage(frame, RESTORES);
      await cluster.waitForList(frame, RESTORES);
      await cluster.openWorkspace(frame, RESTORED, RESTORES);
      await cluster.volumeBand(frame, "rows", "DataDownload");
      await frame.locator(`[data-testid="velero-open-data-download-${completed.metadata.name}"]`).click();
      await frame.waitForSelector(
        "[data-testid=velero-data-download-workspace] [data-testid^=velero-open-data-upload-]",
        { timeout: 60_000 },
      );
      await everyLayout("data-download-workspace", undefined, RESTORES);
      expect(found("data-download-workspace")).toEqual({});
      await cluster.closeWorkspace(frame);
      await cluster.closeWorkspace(frame);
    },
    TIMEOUT,
  );

  it(
    "reads the band of the backup in progress with the keyboard alone: ten more, a row, its view, and Escape back to the backup and to its row",
    async () => {
      await cluster.showList(frame);
      await cluster.openPage(frame, cluster.BACKUPS);
      await cluster.waitForList(frame, cluster.BACKUPS);
      await cluster.openWorkspace(frame, "backup-inprogress", cluster.BACKUPS);
      expect((await cluster.volumeBand(frame, "rows")).rows).toHaveLength(10);
      // From the way back the keyboard reaches the command that shows ten more, and Enter shows them.
      expect(await cluster.focusOn(frame, "velero-back")).toBe("velero-back");
      await cluster.tabTo(frame, (focus) => focus === "velero-volume-more", 80);
      await started.window.keyboard.press("Enter");
      await frame.waitForFunction(
        () =>
          document.querySelectorAll(
            "[data-testid=velero-volume-half][data-kind=PodVolumeBackup] [data-testid=velero-volume-rows] tbody tr",
          ).length > 10,
        undefined,
        { timeout: 60_000 },
      );
      // A way of a row, which Enter follows to the view of its operation; Escape comes back to the view of the backup
      // with the focus on its way back, as from any view opened over another (the restore and its backup above).
      // That the band shows its first ten rows again there, so that the row that was opened may not be among them,
      // is for the review of the milestone: the focus is on the way back, as from any view.
      await cluster.tabTo(frame, (focus) => focus.startsWith("velero-open-pod-volume-backup-"), 40);
      const way = (await cluster.focused(frame)).replace(/^velero-open-pod-volume-backup-/, "");

      await started.window.keyboard.press("Enter");
      await frame.waitForSelector("[data-testid=velero-pod-volume-backup-workspace]", { timeout: 60_000 });
      expect((await cluster.shownView(frame))?.name).toBe(way);
      expect(await cluster.focusOn(frame, "velero-back")).toBe("velero-back");
      await started.window.keyboard.press("Escape");
      await frame.waitForSelector("[data-testid=velero-pod-volume-backup-workspace]", {
        state: "detached",
        timeout: 60_000,
      });
      expect((await cluster.shownView(frame))?.name).toBe("backup-inprogress");
      expect(await cluster.focusOn(frame, "velero-back")).toBe("velero-back");
      await started.window.keyboard.press("Escape");
      await frame.waitForSelector("[data-testid=velero-backup-workspace]", { state: "detached", timeout: 60_000 });
      expect(await cluster.focusOn(frame, "backup-inprogress")).toBe("backup-inprogress");
    },
    TIMEOUT,
  );

  it(
    "shows the Overview in both themes, at every size, with its bands side by side where there is room",
    async () => {
      await cluster.showList(frame);
      await cluster.openPage(frame, OVERVIEW);
      await cluster.selectInstallation(frame, cluster.E2E_OVERVIEW_NAMESPACE);
      await frame.waitForSelector('[data-testid="velero-open-backup-recent-1h"]', { timeout: 60_000 });
      const sides: Record<string, boolean> = {};
      // Where a band is, from the left of the page: two bands of a row are beside each other, or one
      // under the other.
      const beside = (one: string, other: string) =>
        frame.evaluate(
          ([first, second]) => {
            const left = (id: string) =>
              document.querySelector(`[data-testid=velero-overview-${id}]`)?.getBoundingClientRect().left ?? -1;

            return left(second) > left(first) + 100;
          },
          [one, other],
        );

      // The six cells of what was read, the backup repositories the sixth: two rows of three at 900 by 650, and
      // rows of two at twice the zoom, where the picture shows the first row and the page scrolls to the others.
      await everyLayout(
        "overview",
        async () => {
          await cluster.scrollOverview(frame, 0);
          const { width } = await cluster.applied(frame);

          sides[`${width} attention`] = await beside("attention", "completed");
          sides[`${width} schedules`] = await beside("schedules", "storage");
          // The marks of the line carry what they mean without the colour: a shape or a number, and words.
          expect(
            await frame
              .locator("[data-line-mark]")
              .evaluateAll((marks) =>
                marks
                  .filter(
                    (mark) =>
                      !(mark.getAttribute("aria-label") ?? "").trim() ||
                      !(mark.getAttribute("title") ?? "").trim() ||
                      !(mark.textContent ?? "").trim(),
                  )
                  .map((mark) => mark.getAttribute("data-line-mark")),
              ),
          ).toEqual([]);
          expect(await frame.locator("[data-line-mark]").count()).toBeGreaterThan(3);
          // A failure is a shape beside the mark, and what carries none has none: a mark of many and
          // one of an operation in flight are drawn the same with a failure and without.
          const shapes = await frame
            .locator("[data-line-mark]")
            .evaluateAll((marks) =>
              marks.map((mark) => [
                mark.getAttribute("data-failing"),
                getComputedStyle(mark, "::after").content.replace(/"/g, ""),
              ]),
            );

          expect(shapes.filter(([failing, shape]) => (failing === "true") !== (shape === "!"))).toEqual([]);
          expect(shapes.filter(([failing]) => failing === "true").length).toBeGreaterThan(0);
          expect(shapes.filter(([failing]) => failing === "false").length).toBeGreaterThan(0);
        },
        OVERVIEW,
      );
      // At 1440 the bands that share a row are beside each other, but the schedules, whose lines and the ones of
      // the storage have not the room of their columns side by side there: they are alone on their row, with the
      // storage under them. At 900, and at twice the zoom, one is under the other.
      expect(sides).toEqual({
        "1440 attention": true,
        "1440 schedules": false,
        "900 attention": false,
        "900 schedules": false,
        "720 attention": false,
        "720 schedules": false,
      });
      await everyLayout(
        "overview-recent",
        async () => {
          await frame.locator("[data-testid=velero-overview-recent]").scrollIntoViewIfNeeded();
          await frame.locator("[data-testid=velero-overview-recent-list]").scrollIntoViewIfNeeded();
        },
        OVERVIEW,
      );
      await everyLayout(
        "overview-schedules-and-storage",
        async () => {
          await frame.locator("[data-testid=velero-overview-storage]").scrollIntoViewIfNeeded();
        },
        OVERVIEW,
      );
      await cluster.scrollOverview(frame, 0);
      // The installation of the demo as it is: what its controllers ran, nothing in flight, and what the
      // server refused, which needs attention for as long as it is inside the window.
      await cluster.selectInstallation(frame, cluster.E2E_NAMESPACE);
      await frame.waitForSelector(`[data-testid="velero-open-backup-fixture-backup-${cluster.E2E_FIXTURE_RUN}"]`, {
        timeout: 60_000,
      });
      await frame.waitForSelector("[data-testid=velero-overview-in-flight-none]", { timeout: 60_000 });
      await cluster.overview(frame);
      await everyLayout("overview-demo", undefined, OVERVIEW);
      for (const view of ["overview", "overview-recent", "overview-schedules-and-storage", "overview-demo"]) {
        expect([view, found(view)]).toEqual([view, {}]);
      }
    },
    TIMEOUT,
  );

  it(
    "chooses a window and reads the line of time with the keyboard alone, and comes back to the mark",
    async () => {
      await velero.setColorTheme(started.app, started.window, "Dark");
      await velero.setWindowSize(started.app, 1440, 900);
      await velero.setZoom(started.app, 1);
      await cluster.showList(frame);
      await cluster.openPage(frame, OVERVIEW);
      await cluster.selectInstallation(frame, cluster.E2E_OVERVIEW_NAMESPACE);
      await frame.waitForSelector('[data-testid="velero-open-backup-recent-1h"]', { timeout: 60_000 });
      expect((await cluster.overview(frame)).window).toBe("7d");
      // The windows are reached one after the other, and the one that is chosen says so.
      await frame.locator("[data-testid=velero-overview-window-24h]").focus();
      await started.window.keyboard.press("Enter");
      await frame.waitForSelector("[data-testid=velero-overview-window-24h][aria-pressed=true]", { timeout: 60_000 });
      expect(await cluster.focused(frame)).toBe("velero-overview-window-24h");
      expect(await cluster.tabTo(frame, (focus) => focus === "velero-overview-window-30d", 3)).toBe(2);
      // After the windows, the marks of the line: the backups from the oldest, then the restores. Each
      // one says what it is of to who reaches it.
      const said: string[] = [];
      const marks = await frame.locator("[data-line-mark]").count();
      const presses = await cluster.tabTo(
        frame,
        (focus) => {
          said.push(focus);
          return focus.startsWith("restored-3h, Completed, ");
        },
        marks + 2,
      );

      expect(presses).toBeLessThanOrEqual(marks);
      expect(said.filter((focus) => focus.startsWith("recent-5h, Completed, "))).toHaveLength(1);
      const mark = await cluster.focused(frame);

      expect(mark).toMatch(/^restored-3h, Completed, No errors, Started .+, 1m$/);
      await started.window.keyboard.press("Enter");
      await frame.waitForSelector('[data-testid=velero-restore-name] >> text="restored-3h"', { timeout: 60_000 });
      expect(await cluster.focusOn(frame, "velero-back")).toBe("velero-back");
      await started.window.keyboard.press("Escape");
      await frame.waitForSelector("[data-testid=velero-restore-workspace]", { state: "detached", timeout: 60_000 });
      // Who comes back is on the mark the view was opened from.
      expect(await cluster.focusOn(frame, mark)).toBe(mark);
      await cluster.chooseWindow(frame, "7d");
    },
    TIMEOUT,
  );

  it(
    "shows the adherence of the schedules in the list, in two bands and in the Overview in both themes, at every size, each mark with its word",
    async () => {
      // Every mark of the adherence is hidden from who does not see it, and has its word beside it: answered are
      // the ones that do not.
      const unsaid = () =>
        frame.locator("[data-adherence]:not([data-testid])").evaluateAll((marks) =>
          marks
            .filter((mark) => {
              const icon = mark.querySelector(".Icon");
              const word = [...mark.childNodes]
                .filter((node) => node !== icon)
                .map((node) => node.textContent ?? "")
                .join("")
                .trim();

              const hidden =
                icon?.getAttribute("aria-hidden") === "true" || icon?.querySelector('[aria-hidden="true"]') != null;

              return !hidden || word === "";
            })
            .map((mark) => mark.getAttribute("data-adherence")),
        );
      // The marks are counted in the part the view is: a band over the list counts its own, not the rows behind.
      const marked = async (view: string, least: number, within = "") => {
        expect([view, await unsaid()]).toEqual([view, []]);
        expect([
          view,
          (await frame.locator(`${within} [data-adherence]:not([data-testid])`.trim()).count()) >= least,
        ]).toEqual([view, true]);
      };
      const WORKSPACE = "[data-testid=velero-schedule-workspace]";
      // The words of every cell whole, cut with an ellipsis and a tip, or wrapped, and on the line of their row.
      const fitted = (of: cluster.ListOf | cluster.LinesOf) => async () => [
        ...(await cluster.columnsOf(of, frame)).clipped.map((column) => `clipped with no ellipsis or tip: ${column}`),
        ...(await cluster.misalignedWords(of, frame)).map((words) => `off the line of its row: ${words}`),
      ];

      await cluster.showList(frame);
      await cluster.openPage(frame, SCHEDULES);
      // The installations of the adherence hold no storage location: the operator names them.
      await cluster.configureInstallation(frame, cluster.E2E_ADHERENCE_NAMESPACE);
      await frame.waitForSelector(`[data-testid=velero-schedules] [data-schedule-row="${HELD}"]`, { timeout: 60_000 });
      await cluster.rowAdherence(frame, HELD);
      await everyLayout(
        "adherence-schedules",
        () => marked("adherence-schedules", 8),
        SCHEDULES,
        undefined,
        fitted(SCHEDULES),
      );
      await cluster.openWorkspace(frame, HELD, SCHEDULES);
      await cluster.adherenceBand(frame);
      await everyLayout(
        "adherence-band-held",
        async () => {
          await frame.locator("[data-testid=velero-schedule-adherence]").scrollIntoViewIfNeeded();
          await marked("adherence-band-held", 1, WORKSPACE);
        },
        SCHEDULES,
      );
      await cluster.closeWorkspace(frame);
      await cluster.openWorkspace(frame, LONG_SCHEDULE, SCHEDULES);
      await cluster.adherenceBand(frame);
      await everyLayout(
        "adherence-band-long-name",
        async () => {
          await frame.locator("[data-testid=velero-schedule-adherence]").scrollIntoViewIfNeeded();
          await marked("adherence-band-long-name", 1, WORKSPACE);
        },
        SCHEDULES,
      );
      await cluster.closeWorkspace(frame);
      await cluster.openPage(frame, OVERVIEW);
      await cluster.overview(frame);
      await everyLayout(
        "adherence-overview",
        async () => {
          await cluster.scrollOverview(frame, 0);
          await marked("adherence-overview", 8);
        },
        OVERVIEW,
        undefined,
        fitted(cluster.SCHEDULE_LINES),
      );
      for (const view of [
        "adherence-schedules",
        "adherence-band-held",
        "adherence-band-long-name",
        "adherence-overview",
      ]) {
        expect([view, found(view)]).toEqual([view, {}]);
      }
    },
    TIMEOUT,
  );

  it(
    "reads the band of a schedule with the keyboard alone: from the list to the schedule, to the backup that holds it, and back to its row",
    async () => {
      await velero.setColorTheme(started.app, started.window, "Dark");
      await velero.setWindowSize(started.app, 1440, 900);
      await velero.setZoom(started.app, 1);
      await cluster.showList(frame);
      await cluster.openPage(frame, SCHEDULES);
      await frame.waitForSelector(`[data-testid=velero-schedules] [data-schedule-row="${HELD}"]`, { timeout: 60_000 });
      await frame.locator("[data-testid=velero-refresh]").focus();
      await cluster.tabTo(frame, (focus) => focus === HELD, 80);
      await started.window.keyboard.press("Enter");
      await frame.waitForSelector(`[data-testid=velero-schedule-name] >> text="${HELD}"`, { timeout: 60_000 });
      // The way back first, then the way to the backup that holds the schedule, in its band.
      expect(await cluster.focusOn(frame, "velero-back")).toBe("velero-back");
      await cluster.tabTo(frame, (focus) => focus.startsWith(`velero-open-backup-${HELD}-`), 20);
      const backup = (await cluster.focused(frame)).replace("velero-open-backup-", "");

      expect(backup).toMatch(new RegExp(`^${HELD}-\\d{14}$`));
      await started.window.keyboard.press("Enter");
      await frame.waitForSelector(`[data-testid=velero-backup-name] >> text="${backup}"`, { timeout: 60_000 });
      expect(await cluster.focusOn(frame, "velero-back")).toBe("velero-back");
      expect((await cluster.shownView(frame))?.back).toBe(`arrow_back Schedules / ${HELD}`);
      await started.window.keyboard.press("Escape");
      await frame.waitForSelector(`[data-testid=velero-schedule-name] >> text="${HELD}"`, { timeout: 60_000 });
      expect(await cluster.focusOn(frame, "velero-back")).toBe("velero-back");
      await started.window.keyboard.press("Escape");
      await frame.waitForSelector("[data-testid=velero-schedule-workspace]", { state: "detached", timeout: 60_000 });
      expect(await cluster.focusOn(frame, HELD)).toBe(HELD);
    },
    TIMEOUT,
  );

  it(
    "asks a backup of the schedule with the longest name with the keyboard alone: its command, the name and Escape in it, the review and Escape back to the form, and the way back to the schedule and to its row",
    async () => {
      const keyboard = started.window.keyboard;
      const named = () => frame.locator(NAME_FIELD).first().inputValue();
      const inField = () =>
        frame.evaluate(() => document.activeElement?.closest("[data-testid=velero-backup-now-field]") != null);

      await cluster.showList(frame);
      await cluster.openPage(frame, SCHEDULES);
      await frame.waitForSelector(`[data-testid=velero-schedules] [data-schedule-row="${LONG_SCHEDULE}"]`, {
        timeout: 60_000,
      });
      // Writes on for the installation of the adherence, through the dialog of the host: the review is asked of
      // a gate that is on, and nothing is created.
      await cluster.turnWritesOn(frame);
      await frame.locator("[data-testid=velero-refresh]").focus();
      await cluster.tabTo(frame, (focus) => focus === LONG_SCHEDULE, 120);
      await keyboard.press("Enter");
      await frame.waitForSelector(`[data-testid=velero-schedule-name] >> text="${LONG_SCHEDULE}"`, { timeout: 60_000 });
      expect(await cluster.focusOn(frame, "velero-back")).toBe("velero-back");
      await cluster.tabTo(frame, (focus) => focus === "velero-schedule-back-up-now", 40);
      await keyboard.press("Enter");
      await frame.waitForSelector(backUpNow("workspace"), { timeout: 30_000 });
      expect(await cluster.focusOn(frame, "velero-back")).toBe("velero-back");
      const proposed = await named();

      expect(proposed).toMatch(new RegExp(`^${LONG_SCHEDULE}-\\d{14}$`));
      // The field after the way back. Escape in it gives back the name the form proposed, and the view stays.
      for (let presses = 0; presses < 6 && !(await inField()); presses += 1) await keyboard.press("Tab");
      expect(await inField()).toBe(true);
      await keyboard.press("End");
      await keyboard.type("-by-hand", { delay: 20 });
      expect(await named()).toBe(`${proposed}-by-hand`);
      await keyboard.press("Escape");
      expect([await named(), await frame.locator(backUpNow("workspace")).count()]).toEqual([proposed, 1]);
      // Enter asks for the review, which has the focus, and not the command that creates; Escape leaves it, and the
      // focus is on the command that asks again, the name as it was.
      await keyboard.press("Enter");
      await frame.waitForSelector(backUpNow("review"), { timeout: 30_000 });
      expect(await cluster.focusOn(frame, "velero-backup-now-review")).toBe("velero-backup-now-review");
      await keyboard.press("Escape");
      await frame.waitForSelector(backUpNow("review"), { state: "detached", timeout: 30_000 });
      expect(await cluster.focusOn(frame, "velero-backup-now-ask")).toBe("velero-backup-now-ask");
      expect(await named()).toBe(proposed);
      // Escape outside the field leaves the view for the schedule, whose way back has the focus, and then the
      // schedule for its row.
      await keyboard.press("Escape");
      await frame.waitForSelector(backUpNow("workspace"), { state: "detached", timeout: 30_000 });
      await frame.waitForSelector(`[data-testid=velero-schedule-name] >> text="${LONG_SCHEDULE}"`, { timeout: 60_000 });
      expect(await cluster.focusOn(frame, "velero-back")).toBe("velero-back");
      await keyboard.press("Escape");
      await frame.waitForSelector("[data-testid=velero-schedule-workspace]", { state: "detached", timeout: 60_000 });
      expect(await cluster.focusOn(frame, LONG_SCHEDULE)).toBe(LONG_SCHEDULE);
    },
    TIMEOUT,
  );

  it(
    "shows Back up now with the longest name of a schedule, its form and its review, in both themes, at every size",
    async () => {
      // A small window at twice the zoom is shorter than the target bar and the view, and the page is scrolled:
      // it is looked at from its top, where its target bar is, and then the field of the name, or the beginning of
      // the review, which is longer than the window, is brought into sight, and left there for the picture. Its
      // room is the part of the window that every part around it that scrolls shows.
      const top = () =>
        frame.evaluate(() => {
          const page = document.querySelector<HTMLElement>("[data-testid=velero-schedules-page]");

          if (page) page.scrollTop = 0;
        });
      const inSight = (selector: string, whole: boolean) => async () =>
        frame
          .locator(selector)
          .first()
          .evaluate((part, whole) => {
            part.scrollIntoView({ block: "start" });
            let room = { top: 0, bottom: window.innerHeight };

            for (let holder = part.parentElement; holder; holder = holder.parentElement) {
              if (!["auto", "scroll"].includes(getComputedStyle(holder).overflowY)) continue;
              const box = holder.getBoundingClientRect();

              room = { top: Math.max(room.top, box.top), bottom: Math.min(room.bottom, box.bottom) };
            }
            const box = part.getBoundingClientRect();
            const seen =
              box.top >= room.top - 1 && (whole ? box.bottom <= room.bottom + 1 : box.top + 40 <= room.bottom);

            return seen
              ? []
              : [
                  `${part.getAttribute("data-testid") ?? part.tagName.toLowerCase()} is not ${whole ? "whole" : "begun"} in sight: ` +
                    `${Math.round(box.top)} to ${Math.round(box.bottom)} in a room of ${Math.round(room.top)} to ${Math.round(room.bottom)}`,
                ];
          }, whole);

      await cluster.showList(frame);
      await cluster.openPage(frame, SCHEDULES);
      if ((await cluster.writesState(frame)) !== "on") await cluster.turnWritesOn(frame);
      await cluster.openWorkspace(frame, LONG_SCHEDULE, SCHEDULES);
      await frame.click("[data-testid=velero-schedule-back-up-now]");
      await frame.waitForSelector(backUpNow("workspace"), { timeout: 30_000 });
      await everyLayout("backup-now-form", top, SCHEDULES, undefined, inSight(NAME_FIELD, true));
      await frame.click(backUpNow("ask"));
      await frame.waitForSelector(backUpNow("review"), { timeout: 30_000 });
      await everyLayout("backup-now-review", top, SCHEDULES, undefined, inSight(backUpNow("review"), false));
      await frame.click(backUpNow("back"));
      await frame.waitForSelector(backUpNow("review"), { state: "detached", timeout: 30_000 });
      await cluster.showList(frame);
      expect(found("backup-now-form")).toEqual({});
      expect(found("backup-now-review")).toEqual({});
    },
    TIMEOUT,
  );

  it(
    "asks a backup of the form with the keyboard alone: the command of the list, the name and Escape in it, a namespace the host lists, the review and Escape back to the form, and the way back to the list",
    async () => {
      const keyboard = started.window.keyboard;
      const named = () => frame.locator(CREATE_FIELD).first().inputValue();
      const inField = () =>
        frame.evaluate(() => document.activeElement?.closest("[data-testid=velero-backup-create-field]") != null);

      await cluster.showList(frame);
      await cluster.openPage(frame, cluster.BACKUPS);
      await cluster.selectInstallation(frame, cluster.E2E_VIEWS_NAMESPACE);
      await cluster.waitForList(frame, cluster.BACKUPS);
      // Writes on for the installation of the views, through the dialog of the host: the review is asked of a gate
      // that is on, and nothing is created.
      if ((await cluster.writesState(frame)) !== "on") await cluster.turnWritesOn(frame);
      await frame.locator("[data-testid=velero-refresh]").focus();
      await cluster.tabTo(frame, (focus) => focus === "velero-backups-create", 40);
      await keyboard.press("Enter");
      await frame.waitForSelector(createBackup("workspace"), { timeout: 30_000 });
      expect(await cluster.focusOn(frame, "velero-back")).toBe("velero-back");
      // The field after the way back. Escape in it takes back what was typed, and the view stays.
      for (let presses = 0; presses < 6 && !(await inField()); presses += 1) await keyboard.press("Tab");
      expect(await inField()).toBe(true);
      await keyboard.type("views-by-hand", { delay: 20 });
      await keyboard.press("Escape");
      expect([await named(), await frame.locator(createBackup("workspace")).count()]).toEqual(["", 1]);
      await keyboard.type("views-by-hand", { delay: 20 });
      // A namespace the host lists, by its checkbox, and back to the field.
      await cluster.tabTo(frame, (focus) => focus === "velero-backup-create-includedNamespaces-default", 40);
      await keyboard.press("Space");
      expect(await frame.locator(createBackup("includedNamespaces-default")).isChecked()).toBe(true);
      for (let presses = 0; presses < 60 && !(await inField()); presses += 1) await keyboard.press("Shift+Tab");
      expect(await inField()).toBe(true);
      // Enter asks for the review, which has the focus; Escape leaves it, and the focus is on the command that asks
      // again, the form as it was.
      await keyboard.press("Enter");
      await frame.waitForSelector(createBackup("review"), { timeout: 30_000 });
      expect(await cluster.focusOn(frame, "velero-backup-create-review")).toBe("velero-backup-create-review");
      await keyboard.press("Escape");
      await frame.waitForSelector(createBackup("review"), { state: "detached", timeout: 30_000 });
      expect(await cluster.focusOn(frame, "velero-backup-create-ask")).toBe("velero-backup-create-ask");
      expect(await named()).toBe("views-by-hand");
      // Escape outside a field leaves the view for the list.
      await keyboard.press("Escape");
      await frame.waitForSelector(createBackup("workspace"), { state: "detached", timeout: 30_000 });
      expect(await cluster.focusOn(frame, "velero-backups-create")).toBe("velero-backups-create");
    },
    TIMEOUT,
  );

  it(
    "shows Create backup, its form and its review, in both themes, at every size",
    async () => {
      // A small window at twice the zoom is shorter than the target bar and the view, and the page is scrolled: it is
      // looked at from its top, where its target bar is, and then the field of the name, or the beginning of the
      // review, is brought into sight, and left there for the picture.
      const top = () =>
        frame.evaluate(() => {
          const page = document.querySelector<HTMLElement>("[data-testid=velero-backups-page]");

          if (page) page.scrollTop = 0;
        });
      const inSight = (selector: string) => async () =>
        frame
          .locator(selector)
          .first()
          .evaluate((part) => {
            part.scrollIntoView({ block: "start" });
            let room = { top: 0, bottom: window.innerHeight };

            for (let holder = part.parentElement; holder; holder = holder.parentElement) {
              if (!["auto", "scroll"].includes(getComputedStyle(holder).overflowY)) continue;
              const box = holder.getBoundingClientRect();

              room = { top: Math.max(room.top, box.top), bottom: Math.min(room.bottom, box.bottom) };
            }
            const box = part.getBoundingClientRect();

            return box.top >= room.top - 1 && box.top + 40 <= room.bottom
              ? []
              : [
                  `${part.getAttribute("data-testid") ?? part.tagName.toLowerCase()} is not begun in sight: ` +
                    `${Math.round(box.top)} to ${Math.round(box.bottom)} in a room of ${Math.round(room.top)} to ${Math.round(room.bottom)}`,
                ];
          });

      await cluster.showList(frame);
      await cluster.openPage(frame, cluster.BACKUPS);
      if ((await cluster.writesState(frame)) !== "on") await cluster.turnWritesOn(frame);
      await frame.click("[data-testid=velero-backups-create]");
      await frame.waitForSelector(createBackup("workspace"), { timeout: 30_000 });
      // A name as long as a backup of the form may have, which the field, the review and the result carry whole.
      await frame.locator(CREATE_FIELD).first().fill("views-by-hand-".padEnd(216, "x"));
      await everyLayout("backup-create-form", top, cluster.BACKUPS, undefined, inSight(CREATE_FIELD));
      await frame.click(createBackup("ask"));
      await frame.waitForSelector(createBackup("review"), { timeout: 30_000 });
      await everyLayout("backup-create-review", top, cluster.BACKUPS, undefined, inSight(createBackup("review")));
      await frame.click(createBackup("back"));
      await frame.waitForSelector(createBackup("review"), { state: "detached", timeout: 30_000 });
      await cluster.showList(frame);
      expect(found("backup-create-form")).toEqual({});
      expect(found("backup-create-review")).toEqual({});
    },
    TIMEOUT,
  );

  it(
    "asks a schedule of the form with the keyboard alone: the command of the list, the name and Escape in it, the expression, a flag, the review and Escape back to the form, and the way back to the list",
    async () => {
      const keyboard = started.window.keyboard;
      const named = () => frame.locator(SCHEDULE_FIELD).first().inputValue();
      const inField = (id: string) =>
        frame.evaluate(
          (testid) => document.activeElement?.closest(`[data-testid=${testid}]`) != null,
          `velero-schedule-create-${id}`,
        );

      await cluster.showList(frame);
      await cluster.openPage(frame, SCHEDULES);
      await cluster.selectInstallation(frame, cluster.E2E_VIEWS_NAMESPACE);
      await cluster.waitForList(frame, SCHEDULES);
      if ((await cluster.writesState(frame)) !== "on") await cluster.turnWritesOn(frame);
      await frame.locator("[data-testid=velero-refresh]").focus();
      await cluster.tabTo(frame, (focus) => focus === "velero-schedules-create", 40);
      await keyboard.press("Enter");
      await frame.waitForSelector(createSchedule("workspace"), { timeout: 30_000 });
      expect(await cluster.focusOn(frame, "velero-back")).toBe("velero-back");
      // The field of the name after the way back. Escape in it takes back what was typed, and the view stays.
      for (let presses = 0; presses < 6 && !(await inField("field")); presses += 1) await keyboard.press("Tab");
      expect(await inField("field")).toBe(true);
      await keyboard.type("views-by-hand", { delay: 20 });
      await keyboard.press("Escape");
      expect([await named(), await frame.locator(createSchedule("workspace")).count()]).toEqual(["", 1]);
      await keyboard.type("views-by-hand", { delay: 20 });
      // The expression, next, and a flag by its checkbox.
      await keyboard.press("Tab");
      expect(await inField("expression")).toBe(true);
      await keyboard.type("CRON_TZ=Europe/Rome 0 3 * * *", { delay: 10 });
      await cluster.tabTo(frame, (focus) => focus === "velero-schedule-create-skipImmediately", 20);
      await keyboard.press("Space");
      expect(await frame.locator(createSchedule("skipImmediately")).isChecked()).toBe(true);
      // Back to the expression: Enter asks for the review, which has the focus; Escape leaves it, and the focus is on
      // the command that asks again, the form as it was.
      for (let presses = 0; presses < 10 && !(await inField("expression")); presses += 1)
        await keyboard.press("Shift+Tab");
      expect(await inField("expression")).toBe(true);
      await keyboard.press("Enter");
      await frame.waitForSelector(createSchedule("review"), { timeout: 30_000 });
      expect(await cluster.focusOn(frame, "velero-schedule-create-review")).toBe("velero-schedule-create-review");
      await keyboard.press("Escape");
      await frame.waitForSelector(createSchedule("review"), { state: "detached", timeout: 30_000 });
      expect(await cluster.focusOn(frame, "velero-schedule-create-ask")).toBe("velero-schedule-create-ask");
      expect(await named()).toBe("views-by-hand");
      // Escape outside a field leaves the view for the list.
      await keyboard.press("Escape");
      await frame.waitForSelector(createSchedule("workspace"), { state: "detached", timeout: 30_000 });
      expect(await cluster.focusOn(frame, "velero-schedules-create")).toBe("velero-schedules-create");
    },
    TIMEOUT,
  );

  it(
    "asks a restore with the keyboard alone: the command of the view of a backup, the name and Escape in it, a choice of the cluster-scoped resources, the review, the name of the backup typed and Escape in it, Escape back to the form, and the way back to the backup",
    async () => {
      const keyboard = started.window.keyboard;
      const named = () => frame.locator(RESTORE_FIELD).first().inputValue();
      const inField = (id: string) =>
        frame.evaluate(
          (testid) => document.activeElement?.closest(`[data-testid=${testid}]`) != null,
          `velero-restore-create-${id}`,
        );

      await cluster.showList(frame);
      await cluster.openPage(frame, cluster.BACKUPS);
      await cluster.selectInstallation(frame, cluster.E2E_VIEWS_NAMESPACE);
      await cluster.waitForList(frame, cluster.BACKUPS);
      if ((await cluster.writesState(frame)) !== "on") await cluster.turnWritesOn(frame);
      await cluster.openWorkspace(frame, RESTORABLE, cluster.BACKUPS);
      await frame.locator("[data-testid=velero-back]").focus();
      await cluster.tabTo(frame, (focus) => focus === "velero-backup-restore", 20);
      await keyboard.press("Enter");
      await frame.waitForSelector("[data-testid=velero-restore-backup-workspace]", { timeout: 30_000 });
      expect(await cluster.focusOn(frame, "velero-back")).toBe("velero-back");
      // The field of the name after the way back, with the name proposed: what is typed in it is taken back by Escape,
      // which gives the proposal back, and the view stays.
      for (let presses = 0; presses < 6 && !(await inField("field")); presses += 1) await keyboard.press("Tab");
      expect(await inField("field")).toBe(true);
      const second = (instant: number) => new Date(instant).toISOString().slice(0, 19).replace(/[-:T]/g, "");

      expect(await named()).toMatch(new RegExp(`^${RESTORABLE}-\\d{14}$`));
      await keyboard.type("-by-hand", { delay: 20 });
      const before = Date.now();

      await keyboard.press("Escape");
      const after = Date.now();
      // The proposal is made again of the time of Escape, to the second.
      const proposed = await named();

      expect(proposed).toMatch(new RegExp(`^${RESTORABLE}-\\d{14}$`));
      expect([
        proposed >= `${RESTORABLE}-${second(before)}`,
        proposed <= `${RESTORABLE}-${second(after + 1000)}`,
        await frame.locator("[data-testid=velero-restore-backup-workspace]").count(),
      ]).toEqual([true, true, 1]);
      await keyboard.press("ControlOrMeta+A");
      await keyboard.type("views-restore-by-hand", { delay: 20 });
      // A choice of the cluster-scoped resources, by its radio button, and back to the field.
      await cluster.tabTo(frame, (focus) => focus === "velero-restore-create-clusterResources-every", 60);
      await keyboard.press("ArrowDown");
      expect(await frame.locator(restoreOf("clusterResources-none")).isChecked()).toBe(true);
      for (let presses = 0; presses < 60 && !(await inField("field")); presses += 1) await keyboard.press("Shift+Tab");
      expect(await inField("field")).toBe(true);
      // Enter asks for the review, which has the focus; the name of the backup is typed in it, and Escape there takes
      // it back; Escape on the review leaves it, and the focus is on the command that asks again, the form as it was.
      await keyboard.press("Enter");
      await frame.waitForSelector(restoreOf("review"), { timeout: 30_000 });
      expect(await cluster.focusOn(frame, "velero-restore-create-review")).toBe("velero-restore-create-review");
      for (let presses = 0; presses < 10 && !(await inField("typed")); presses += 1) await keyboard.press("Tab");
      expect(await inField("typed")).toBe(true);
      await keyboard.type(RESTORABLE, { delay: 20 });
      expect(await frame.locator(restoreOf("create")).isDisabled()).toBe(false);
      await keyboard.press("Escape");
      expect(await frame.locator(restoreOf("create")).isDisabled()).toBe(true);
      await frame.locator(restoreOf("review")).focus();
      await keyboard.press("Escape");
      await frame.waitForSelector(restoreOf("review"), { state: "detached", timeout: 30_000 });
      expect(await cluster.focusOn(frame, "velero-restore-create-ask")).toBe("velero-restore-create-ask");
      expect(await named()).toBe("views-restore-by-hand");
      // Escape outside a field leaves the view for the view of the backup, whose keyboard starts from its way back.
      await keyboard.press("Escape");
      await frame.waitForSelector("[data-testid=velero-restore-backup-workspace]", {
        state: "detached",
        timeout: 30_000,
      });
      await frame.waitForSelector("[data-testid=velero-backup-workspace]", { timeout: 30_000 });
      expect(await cluster.focusOn(frame, "velero-back")).toBe("velero-back");
      await cluster.closeWorkspace(frame);
    },
    TIMEOUT,
  );

  it(
    "shows Restore, its form and its review, in both themes, at every size",
    async () => {
      const top = () =>
        frame.evaluate(() => {
          const page = document.querySelector<HTMLElement>("[data-testid=velero-backups-page]");

          if (page) page.scrollTop = 0;
        });
      const inSight = (selector: string) => async () =>
        frame
          .locator(selector)
          .first()
          .evaluate((part) => {
            part.scrollIntoView({ block: "start" });
            let room = { top: 0, bottom: window.innerHeight };

            for (let holder = part.parentElement; holder; holder = holder.parentElement) {
              if (!["auto", "scroll"].includes(getComputedStyle(holder).overflowY)) continue;
              const box = holder.getBoundingClientRect();

              room = { top: Math.max(room.top, box.top), bottom: Math.min(room.bottom, box.bottom) };
            }
            const box = part.getBoundingClientRect();

            return box.top >= room.top - 1 && box.top + 40 <= room.bottom
              ? []
              : [
                  `${part.getAttribute("data-testid") ?? part.tagName.toLowerCase()} is not begun in sight: ` +
                    `${Math.round(box.top)} to ${Math.round(box.bottom)} in a room of ${Math.round(room.top)} to ${Math.round(room.bottom)}`,
                ];
          });

      await cluster.showList(frame);
      await cluster.openPage(frame, cluster.BACKUPS);
      if ((await cluster.writesState(frame)) !== "on") await cluster.turnWritesOn(frame);
      await cluster.openWorkspace(frame, RESTORABLE, cluster.BACKUPS);
      await frame.click("[data-testid=velero-backup-restore]");
      await frame.waitForSelector("[data-testid=velero-restore-backup-workspace]", { timeout: 30_000 });
      // The longest name a restore may have, the namespace the backup includes, and a mapping of it into a namespace of
      // the longest name.
      const source = String(await frame.locator(RESTORE_SOURCES).first().getAttribute("data-testid")).replace(
        "velero-restore-create-includedNamespaces-",
        "",
      );

      await frame.locator(RESTORE_FIELD).first().fill("views-restore-".padEnd(216, "x"));
      await frame.click(restoreOf(`includedNamespaces-${source}`));
      await frame.click(restoreOf("namespaceMapping-add"));
      await frame.locator(restoreOf("namespaceMapping-source-0")).fill(source);
      await frame.locator(restoreOf("namespaceMapping-target-0")).fill("restored-".padEnd(63, "x"));
      await frame.click(restoreOf("clusterResources-needed"));
      await everyLayout("restore-form", top, cluster.BACKUPS, undefined, inSight(RESTORE_FIELD));
      await frame.click(restoreOf("ask"));
      await frame.waitForSelector(restoreOf("review"), { timeout: 30_000 });
      await everyLayout("restore-review", top, cluster.BACKUPS, undefined, inSight(restoreOf("review")));
      await frame.click(restoreOf("back"));
      await frame.waitForSelector(restoreOf("review"), { state: "detached", timeout: 30_000 });
      await cluster.showList(frame);
      expect(found("restore-form")).toEqual({});
      expect(found("restore-review")).toEqual({});
    },
    TIMEOUT,
  );

  it(
    "shows Create schedule, its form and its review, in both themes, at every size",
    async () => {
      const top = () =>
        frame.evaluate(() => {
          const page = document.querySelector<HTMLElement>("[data-testid=velero-schedules-page]");

          if (page) page.scrollTop = 0;
        });
      const inSight = (selector: string) => async () =>
        frame
          .locator(selector)
          .first()
          .evaluate((part) => {
            part.scrollIntoView({ block: "start" });
            let room = { top: 0, bottom: window.innerHeight };

            for (let holder = part.parentElement; holder; holder = holder.parentElement) {
              if (!["auto", "scroll"].includes(getComputedStyle(holder).overflowY)) continue;
              const box = holder.getBoundingClientRect();

              room = { top: Math.max(room.top, box.top), bottom: Math.min(room.bottom, box.bottom) };
            }
            const box = part.getBoundingClientRect();

            return box.top >= room.top - 1 && box.top + 40 <= room.bottom
              ? []
              : [
                  `${part.getAttribute("data-testid") ?? part.tagName.toLowerCase()} is not begun in sight: ` +
                    `${Math.round(box.top)} to ${Math.round(box.bottom)} in a room of ${Math.round(room.top)} to ${Math.round(room.bottom)}`,
                ];
          });

      await cluster.showList(frame);
      await cluster.openPage(frame, SCHEDULES);
      if ((await cluster.writesState(frame)) !== "on") await cluster.turnWritesOn(frame);
      await frame.click("[data-testid=velero-schedules-create]");
      await frame.waitForSelector(createSchedule("workspace"), { timeout: 30_000 });
      // The longest name a schedule may have, and an expression of 200 characters.
      expect(LONG_EXPRESSION).toHaveLength(200);
      await frame.locator(SCHEDULE_FIELD).first().fill("a".repeat(63));
      await frame.locator(SCHEDULE_EXPRESSION).first().fill(LONG_EXPRESSION);
      await everyLayout("schedule-create-form", top, SCHEDULES, undefined, inSight(SCHEDULE_FIELD));
      await frame.click(createSchedule("ask"));
      await frame.waitForSelector(createSchedule("review"), { timeout: 30_000 });
      await everyLayout("schedule-create-review", top, SCHEDULES, undefined, inSight(createSchedule("review")));
      await frame.click(createSchedule("back"));
      await frame.waitForSelector(createSchedule("review"), { state: "detached", timeout: 30_000 });
      await cluster.showList(frame);
      expect(found("schedule-create-form")).toEqual({});
      expect(found("schedule-create-review")).toEqual({});
    },
    TIMEOUT,
  );

  it(
    "asks a pause and a resume with the keyboard alone: the command of the view, the review and Escape back, the choice by its checkbox, and the way back to the view",
    async () => {
      const keyboard = started.window.keyboard;

      await cluster.showList(frame);
      await cluster.openPage(frame, SCHEDULES);
      await cluster.selectInstallation(frame, cluster.E2E_VIEWS_NAMESPACE);
      await cluster.waitForList(frame, SCHEDULES);
      if ((await cluster.writesState(frame)) !== "on") await cluster.turnWritesOn(frame);
      for (const [name, action] of [
        [SCHEDULED, "pause"],
        [SKIPPING, "resume"],
      ] as const) {
        await cluster.openWorkspace(frame, name, SCHEDULES);
        // The command after the way back of the view, on the line of its name.
        expect(await cluster.focusOn(frame, "velero-back")).toBe("velero-back");
        await cluster.tabTo(frame, (focus) => focus === `velero-schedule-${action}`, 10);
        await keyboard.press("Enter");
        await frame.waitForSelector(`[data-testid=velero-schedule-${action}-workspace]`, { timeout: 30_000 });
        expect(await cluster.focusOn(frame, "velero-back")).toBe("velero-back");
        if (action === "resume") {
          // The choice by its checkbox, proposed as the schedule carries it, and taken back.
          await cluster.tabTo(frame, (focus) => focus === "velero-schedule-patch-skip", 10);
          expect(await frame.locator(schedulePatch("skip")).isChecked()).toBe(true);
          await keyboard.press("Space");
          expect(await frame.locator(schedulePatch("skip")).isChecked()).toBe(false);
        }
        // The command that asks for the review, which has the focus once shown; Escape leaves it for the command.
        await cluster.tabTo(frame, (focus) => focus === "velero-schedule-patch-ask", 10);
        await keyboard.press("Enter");
        await frame.waitForSelector(schedulePatch("review"), { timeout: 30_000 });
        expect(await cluster.focusOn(frame, "velero-schedule-patch-review")).toBe("velero-schedule-patch-review");
        await keyboard.press("Escape");
        await frame.waitForSelector(schedulePatch("review"), { state: "detached", timeout: 30_000 });
        expect(await cluster.focusOn(frame, "velero-schedule-patch-ask")).toBe("velero-schedule-patch-ask");
        // Escape outside a field leaves the workspace for the view, whose way back has the focus, and then the view
        // for its row.
        await keyboard.press("Escape");
        await frame.waitForSelector(`[data-testid=velero-schedule-${action}-workspace]`, {
          state: "detached",
          timeout: 30_000,
        });
        await frame.waitForSelector(`[data-testid=velero-schedule-name] >> text="${name}"`, { timeout: 60_000 });
        expect(await cluster.focusOn(frame, "velero-back")).toBe("velero-back");
        await keyboard.press("Escape");
        await frame.waitForSelector("[data-testid=velero-schedule-workspace]", { state: "detached", timeout: 60_000 });
        expect(await cluster.focusOn(frame, name)).toBe(name);
      }
    },
    TIMEOUT,
  );

  it(
    "shows Pause and Resume, their forms and their reviews, in both themes, at every size",
    async () => {
      // The page is looked at from its top, then the beginning of the form, or of the review, is brought into sight
      // and left there for the picture, as for the other actions.
      const top = () =>
        frame.evaluate(() => {
          const page = document.querySelector<HTMLElement>("[data-testid=velero-schedules-page]");

          if (page) page.scrollTop = 0;
        });
      const inSight = (selector: string) => async () =>
        frame
          .locator(selector)
          .first()
          .evaluate((part) => {
            part.scrollIntoView({ block: "start" });
            let room = { top: 0, bottom: window.innerHeight };

            for (let holder = part.parentElement; holder; holder = holder.parentElement) {
              if (!["auto", "scroll"].includes(getComputedStyle(holder).overflowY)) continue;
              const box = holder.getBoundingClientRect();

              room = { top: Math.max(room.top, box.top), bottom: Math.min(room.bottom, box.bottom) };
            }
            const box = part.getBoundingClientRect();

            return box.top >= room.top - 1 && box.top + 40 <= room.bottom
              ? []
              : [
                  `${part.getAttribute("data-testid") ?? part.tagName.toLowerCase()} is not begun in sight: ` +
                    `${Math.round(box.top)} to ${Math.round(box.bottom)} in a room of ${Math.round(room.top)} to ${Math.round(room.bottom)}`,
                ];
          });

      await cluster.showList(frame);
      await cluster.openPage(frame, SCHEDULES);
      await cluster.selectInstallation(frame, cluster.E2E_VIEWS_NAMESPACE);
      await cluster.waitForList(frame, SCHEDULES);
      if ((await cluster.writesState(frame)) !== "on") await cluster.turnWritesOn(frame);
      for (const [name, action] of [
        [SCHEDULED, "pause"],
        [SKIPPING, "resume"],
      ] as const) {
        await cluster.openWorkspace(frame, name, SCHEDULES);
        await frame.click(`[data-testid=velero-schedule-${action}]`);
        await frame.waitForSelector(`[data-testid=velero-schedule-${action}-workspace]`, { timeout: 30_000 });
        await everyLayout(`schedule-${action}-form`, top, SCHEDULES, undefined, inSight(schedulePatch("what")));
        await frame.click(schedulePatch("ask"));
        await frame.waitForSelector(schedulePatch("review"), { timeout: 30_000 });
        await everyLayout(`schedule-${action}-review`, top, SCHEDULES, undefined, inSight(schedulePatch("review")));
        // Nothing is sent: the review is left, then the workspace and the view.
        await frame.click(schedulePatch("back"));
        await frame.waitForSelector(schedulePatch("review"), { state: "detached", timeout: 30_000 });
        await cluster.closeWorkspace(frame);
        await frame.waitForSelector("[data-testid=velero-schedule-workspace]", { timeout: 30_000 });
        await cluster.closeWorkspace(frame);
        expect(found(`schedule-${action}-form`)).toEqual({});
        expect(found(`schedule-${action}-review`)).toEqual({});
      }
    },
    TIMEOUT,
  );

  it(
    "asks a deletion with the keyboard alone: the command of the view after Restore, the review, its field after the text, the name typed and taken back by Escape, Delete backup and Do not delete it reached, Do not delete it and Escape back to the command, and the way back to the view, with nothing sent",
    async () => {
      const keyboard = started.window.keyboard;
      // Whether the focus is in the field of the name: the host gives its own element the identifier, or the input.
      const inTyped = () =>
        frame.evaluate(() => document.activeElement?.closest("[data-testid=velero-backup-delete-typed]") != null);

      await cluster.showList(frame);
      await cluster.openPage(frame, cluster.BACKUPS);
      await cluster.selectInstallation(frame, cluster.E2E_VIEWS_NAMESPACE);
      await cluster.waitForList(frame, cluster.BACKUPS);
      if ((await cluster.writesState(frame)) !== "on") await cluster.turnWritesOn(frame);
      await cluster.openWorkspace(frame, RESTORABLE, cluster.BACKUPS);
      await frame.locator("[data-testid=velero-back]").focus();
      // On the line of the name, Restore and then Delete backup, each one press away (SPEC-0017, the decisions of the
      // second pull request of T4.6).
      expect(await cluster.tabTo(frame, (focus) => focus === "velero-backup-restore", 20)).toBe(1);
      expect(await cluster.tabTo(frame, (focus) => focus === "velero-backup-delete", 20)).toBe(1);
      await keyboard.press("Enter");
      await frame.waitForSelector("[data-testid=velero-backup-delete-workspace]", { timeout: 30_000 });
      expect(await cluster.focusOn(frame, "velero-back")).toBe("velero-back");
      // The command that asks for the review, which has the focus once shown.
      await cluster.tabTo(frame, (focus) => focus === "velero-backup-delete-ask", 10);
      await keyboard.press("Enter");
      await frame.waitForSelector(deleteOf("review"), { timeout: 30_000 });
      expect(await cluster.focusOn(frame, "velero-backup-delete-review")).toBe("velero-backup-delete-review");
      // The field of the name is the first stop after the review, or the second when the text of the request scrolls,
      // which Chromium gives the keyboard as a scroller with nothing to focus in it.
      const scrolls = await frame
        .locator(deleteOf("text"))
        .evaluate((text) => text.scrollWidth > text.clientWidth || text.scrollHeight > text.clientHeight);
      let presses = 0;

      for (; presses < 10 && !(await inTyped()); presses += 1) await keyboard.press("Tab");
      expect([await inTyped(), presses]).toEqual([true, scrolls ? 2 : 1]);
      // The name of the backup typed in its field enables Delete backup; Escape there takes it back, and the review
      // stays.
      await keyboard.type(RESTORABLE, { delay: 20 });
      expect(await frame.locator(deleteOf("run")).isDisabled()).toBe(false);
      await keyboard.press("Escape");
      expect([
        await frame.locator(DELETE_TYPED).first().inputValue(),
        await frame.locator(deleteOf("run")).isDisabled(),
        await frame.locator(deleteOf("review")).count(),
      ]).toEqual(["", true, 1]);
      // Typed again: Delete backup is the next stop, enabled and not pressed, and Do not delete it the one after it,
      // which Enter takes: the review is left, and the focus is on the command that asks again.
      await keyboard.type(RESTORABLE, { delay: 20 });
      expect(await cluster.tabTo(frame, (focus) => focus === "velero-backup-delete-run", 3)).toBe(1);
      expect(await frame.locator(deleteOf("run")).isDisabled()).toBe(false);
      expect(await cluster.tabTo(frame, (focus) => focus === "velero-backup-delete-back", 3)).toBe(1);
      await keyboard.press("Enter");
      await frame.waitForSelector(deleteOf("review"), { state: "detached", timeout: 30_000 });
      expect(await cluster.focusOn(frame, "velero-backup-delete-ask")).toBe("velero-backup-delete-ask");
      // Escape on the review leaves it as well, and the focus is on the command that asks again.
      await keyboard.press("Enter");
      await frame.waitForSelector(deleteOf("review"), { timeout: 30_000 });
      expect(await cluster.focusOn(frame, "velero-backup-delete-review")).toBe("velero-backup-delete-review");
      await keyboard.press("Escape");
      await frame.waitForSelector(deleteOf("review"), { state: "detached", timeout: 30_000 });
      expect(await cluster.focusOn(frame, "velero-backup-delete-ask")).toBe("velero-backup-delete-ask");
      // Escape outside a field leaves the workspace for the view, whose way back has the focus, and then the view for
      // its row.
      await keyboard.press("Escape");
      await frame.waitForSelector("[data-testid=velero-backup-delete-workspace]", {
        state: "detached",
        timeout: 30_000,
      });
      await frame.waitForSelector(`[data-testid=velero-backup-name] >> text="${RESTORABLE}"`, { timeout: 60_000 });
      expect(await cluster.focusOn(frame, "velero-back")).toBe("velero-back");
      await keyboard.press("Escape");
      await frame.waitForSelector("[data-testid=velero-backup-workspace]", { state: "detached", timeout: 60_000 });
      expect(await cluster.focusOn(frame, RESTORABLE)).toBe(RESTORABLE);
      // Nothing was sent: no request to delete a backup is in the installation of the views.
      expect(cluster.deleteRequestsOf(cluster.E2E_VIEWS_NAMESPACE)).toEqual([]);
    },
    TIMEOUT,
  );

  it(
    "shows Delete backup, its workspace and its review with the name typed, and the workspace of the backup of 63 characters in progress, held back with its words, in both themes, at every size",
    async () => {
      // The page is looked at from its top, then the beginning of the workspace, or of the review, is brought into
      // sight and left there for the picture, as for the other actions.
      const top = () =>
        frame.evaluate(() => {
          const page = document.querySelector<HTMLElement>("[data-testid=velero-backups-page]");

          if (page) page.scrollTop = 0;
        });
      const inSight = (selector: string) => async () =>
        frame
          .locator(selector)
          .first()
          .evaluate((part) => {
            part.scrollIntoView({ block: "start" });
            let room = { top: 0, bottom: window.innerHeight };

            for (let holder = part.parentElement; holder; holder = holder.parentElement) {
              if (!["auto", "scroll"].includes(getComputedStyle(holder).overflowY)) continue;
              const box = holder.getBoundingClientRect();

              room = { top: Math.max(room.top, box.top), bottom: Math.min(room.bottom, box.bottom) };
            }
            const box = part.getBoundingClientRect();

            return box.top >= room.top - 1 && box.top + 40 <= room.bottom
              ? []
              : [
                  `${part.getAttribute("data-testid") ?? part.tagName.toLowerCase()} is not begun in sight: ` +
                    `${Math.round(box.top)} to ${Math.round(box.bottom)} in a room of ${Math.round(room.top)} to ${Math.round(room.bottom)}`,
                ];
          });

      await cluster.showList(frame);
      await cluster.openPage(frame, cluster.BACKUPS);
      await cluster.selectInstallation(frame, cluster.E2E_VIEWS_NAMESPACE);
      await cluster.waitForList(frame, cluster.BACKUPS);
      if ((await cluster.writesState(frame)) !== "on") await cluster.turnWritesOn(frame);
      await cluster.openWorkspace(frame, RESTORABLE, cluster.BACKUPS);
      await frame.click("[data-testid=velero-backup-delete]");
      await frame.waitForSelector("[data-testid=velero-backup-delete-workspace]", { timeout: 30_000 });
      await everyLayout("backup-delete-form", top, cluster.BACKUPS, undefined, inSight(deleteOf("what")));
      await frame.click(deleteOf("ask"));
      await frame.waitForSelector(deleteOf("review"), { timeout: 30_000 });
      await frame.locator(DELETE_TYPED).first().fill(RESTORABLE);
      await everyLayout("backup-delete-review", top, cluster.BACKUPS, undefined, inSight(deleteOf("review")));
      // Nothing is sent: the review is left, then the workspace and the view.
      await frame.click(deleteOf("back"));
      await frame.waitForSelector(deleteOf("review"), { state: "detached", timeout: 30_000 });
      await cluster.closeWorkspace(frame);
      await frame.waitForSelector("[data-testid=velero-backup-workspace]", { timeout: 30_000 });
      await cluster.closeWorkspace(frame);
      // The backup of the views with a name of 63 characters is InProgress: Delete backup is held back for it, and the
      // workspace of its deletion, opened by the address as a link opens it, says why with its name in the title and in
      // what the deletion is, and asks nothing. Its review waits for a Completed backup of that length.
      await cluster.openWorkspace(frame, LONG_BACKUP, cluster.BACKUPS);
      expect(await frame.locator("[data-testid=velero-backup-delete]").isDisabled()).toBe(true);
      await frame.evaluate((name) => {
        const search = new URLSearchParams(window.location.search);

        search.append("view", `backup-delete/${name}`);
        window.history.pushState({}, "", `${window.location.pathname}?${search}`);
        window.dispatchEvent(new PopStateEvent("popstate"));
      }, LONG_BACKUP);
      await frame.waitForSelector("[data-testid=velero-backup-delete-workspace]", { timeout: 30_000 });
      expect(await cluster.addressViews(frame)).toEqual([`backup/${LONG_BACKUP}`, `backup-delete/${LONG_BACKUP}`]);
      await frame.waitForSelector(deleteOf("held"), { timeout: 30_000 });
      expect(await frame.locator(deleteOf("ask")).isDisabled()).toBe(true);
      await everyLayout("backup-delete-held", top, cluster.BACKUPS, undefined, inSight(deleteOf("what")));
      await cluster.closeWorkspace(frame);
      await frame.waitForSelector("[data-testid=velero-backup-workspace]", { timeout: 30_000 });
      await cluster.closeWorkspace(frame);
      expect(found("backup-delete-form")).toEqual({});
      expect(found("backup-delete-review")).toEqual({});
      expect(found("backup-delete-held")).toEqual({});
    },
    TIMEOUT,
  );

  it(
    "leaves the objects of Velero as they were: the server removes each request ten minutes after it signed it",
    async () => {
      // The wait for the server is counted from the last load of the suite, and needs nothing of the
      // application. A request no server looked at is said by the wait, by its name.
      const left = lastLoad > 0 ? await cluster.awaitRequestsGone(NAMESPACE, lastLoad + REMOVED_WITHIN) : [];
      const after = cluster.clusterSnapshot();

      tabs.requests = { asked: ledger.asked(), left: left.map((request) => request.name), lastLoad };
      await cluster.writeReport("pre-review-layout", problems);
      await report("pre-review-tabs", tabs);
      // Every violation the scan found, in every layout it looked at, with what became of it; the count of each rule by
      // its impact and where it comes from; what axe-core could not decide; and the exceptions no violation used,
      // which fail nothing.
      const violations = Object.values(scans).flatMap(({ rows }) => rows);
      const counted: Record<string, number> = {};

      for (const row of violations) {
        const key = `${row.rule}, ${row.impact}, ${row.origin}${row.fails ? ", fails" : ""}`;

        counted[key] = (counted[key] ?? 0) + 1;
      }
      await report("pre-review-accessibility", {
        axe: scannedWith?.version,
        tags: accessibility.WCAG_TAGS,
        rules: scannedWith?.rules,
        root: axe.PAGE_ROOT,
        scans: Object.keys(scans).length,
        broken: Object.fromEntries(
          Object.entries(scans).flatMap(([name, scanned]) => (scanned.broken ? [[name, scanned.broken]] : [])),
        ),
        failing: violations.filter((row) => row.fails).length,
        counted,
        violations,
        undecided: Object.fromEntries(
          Object.entries(scans).flatMap(([name, { undecided }]) => (undecided.length > 0 ? [[name, undecided]] : [])),
        ),
        exceptions: {
          file: EXCEPTIONS,
          named: exceptions.length,
          unused: accessibility.unusedExceptions(exceptions, verdicts),
        },
      });
      expect(left.map((request) => request.name)).toEqual([]);
      // Five loads ended, with their text or without it, and one was cancelled, which created a request or
      // none: five or six requests, each told to the guard by its name.
      expect(ledger.asked().length).toBeGreaterThanOrEqual(5);
      expect(ledger.asked().length).toBeLessThanOrEqual(6);
      expect(Object.keys(problems)).toHaveLength(THEMES.length * SIZES.length * VIEWS);
      // A picture of every view was written, each under a name of its own.
      expect(new Set(screenshots).size).toBe(THEMES.length * SIZES.length * VIEWS);
      // Every view was scanned in both themes at the two sizes, by rules axe-core ran.
      expect(Object.keys(scans)).toHaveLength(THEMES.length * SCANNED.length * VIEWS);
      expect(scannedWith?.rules.length).toBeGreaterThan(0);
      expect(after.versions).toEqual(before.versions);
      expect(after.installed).toEqual(before.installed);
      expect(after.requests).toBe(0);
    },
    TIMEOUT,
  );
});
