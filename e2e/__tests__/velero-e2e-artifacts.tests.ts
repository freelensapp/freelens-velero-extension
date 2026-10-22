/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

// The tabs Log, Results, Resources and Volumes of the workspace of a backup and
// of a restore, in a packaged Freelens, against the test environment: the
// backup the controller of the demo took, and the restore it ran of it; then
// the fixtures of the tabs, the backup synced from the store with artifacts
// made for the rules of the tabs, the one synced without its log, the backup
// and the restore the server refused, and the restore asked from a schedule
// that has no backup; and a backup whose storage location is not there, in
// another installation, and the reader of a part, to whom the cluster refuses
// the creation. A tab asks nothing when it opens; it shows the request before
// it creates it; and what it loads is what the release wrote of the operation
// into the store, or what the fixtures wrote there in its place.
//
// The suite asks the extension to write: each load is a DownloadRequest in the
// namespace of the installation, created through the gate. It tells its guard
// the name of each one, reads each in the cluster by that name, and counts the
// creations on the API server. It deletes none, and neither does the extension:
// the server removes a request ten minutes after it signed it, and the suite
// waits for that. So what creates a request comes first, the restore before
// the backup, and what creates none comes after it, while the server counts
// its ten minutes: the tabs of the backup hold their texts until the end of
// the cases of the demo. One view is shown at a time, and a view opened over
// another takes its loads: the fixtures of the tabs come after every case of
// the demo, each operation with its loads first and what creates none after,
// and the last request of the suite is the large log, whose cases that create
// none overlap the wait. The one thing that does not wait is the saving of a
// log, which follows its load: the main process holds a text for ten minutes
// and no longer.
//
// A case looks at one thing, and starts from the view the case before it left
// without asking anything of that case but the text it needs: a load that
// failed fails its own case, and the cases of the other tabs go on.
//
// Nothing here is a number copied from a run: what is expected of an artifact
// is what the release writes of any operation, what the status of the object
// says, what the suite counts in the file it saved, and, of the fixtures of the
// tabs, what the runner of the suites counted of them outside the extension,
// which it writes beside the reports of the suite before it starts it.
//
// The suite takes about twenty minutes, five to seven of them the wait for
// the server: a request it left behind would fail the last case of every
// suite after it.

import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as artifacts from "../../integration/helpers/velero-artifacts";
import * as cluster from "../../integration/helpers/velero-cluster";
import * as velero from "../../integration/helpers/velero-extension";

import type { Frame } from "playwright";

const TIMEOUT = 15 * 60 * 1000;
const RESOURCE = "downloadrequests";
const NAMESPACE = cluster.E2E_NAMESPACE;
// The cluster as the catalog of the host names it, which is by its context.
const CLUSTER = cluster.E2E_KUBE_CONTEXT;
const OPERATIONS: artifacts.Operation[] = ["backup", "restore"];
// The run of the fixtures, which the runner of the suites names: eight hexadecimal characters.
const RUN = process.env.E2E_FIXTURE_RUN ?? "";
// The backup the controller of the installation took, and the restore it ran of it.
const NAMES: Record<artifacts.Operation, string> = {
  backup: `fixture-backup-${RUN}`,
  restore: `fixture-restore-${RUN}`,
};
// What the fixtures of the tabs placed in the installation, by the names of the run: the backup the server
// synced from the store, whose artifacts are made for the rules of the tabs; the one it synced without its
// log, whose other artifacts are empty; the backup and the restore it refused at their validation; and the
// restore asked from a schedule that has no backup, refused without a backup name.
const SYNCED = `fixture-synced-backup-${RUN}`;
const WITHOUT_LOG = `fixture-synced-backup-no-log-${RUN}`;
const REFUSED: Record<artifacts.Operation, string> = {
  backup: `fixture-invalid-backup-${RUN}`,
  restore: `fixture-invalid-restore-${RUN}`,
};
const ORPHAN = `fixture-orphan-restore-${RUN}`;
// The installation of the views, where a backup names a storage location that is not there, and where the
// reader of a part reads the backups, the schedules and the storage locations, and may create nothing.
const VIEWS = cluster.E2E_VIEWS_NAMESPACE;
const MISSING_LOCATION = "backup-missing-location";
const OF_THE_READER = "views-daily-20260901030000";
// The cluster as the catalog names it when it is opened through the kubeconfig of the reader of a part,
// through the one of the identity of the installation that may not port-forward, and through the one of the
// identity of the installation whose token an `exec` plugin gives.
const SECOND_CONTEXT = "velero-e2e-reader";
const THIRD_CONTEXT = "velero-e2e-no-port-forward";
const FOURTH_CONTEXT = "velero-e2e-exec-plugin";
// The executable of the proxy of the host, which authenticates a cluster with its kubeconfig.
const HOST_PROXY = "freelens-k8s-proxy";
// What the host says when it saves the store of the extension into its file.
const STORE_SAVED = /\[BASE-STORE\]: saving \S*velero-preferences\.json/;
// How far down the list of lines of a log places its rows at most, in pixels of the layout, as the viewer
// counts it: the rows of a text taller than that, at the ratio of the window, are left out of the list.
const PLACED = 33_000_000;
// How long a cluster that was disconnected is watched for a request of the extension.
const DISCONNECTED_FOR = 60_000;
const FAMILIES: Record<artifacts.Operation, string> = { backup: "backups", restore: "restores" };
const LISTS: Record<artifacts.Operation, cluster.ListOf> = { backup: cluster.BACKUPS, restore: cluster.RESTORES };
// The labels the extension gives a DownloadRequest: who created it, and the identifier of the request of the views.
const LABELS = { "app.kubernetes.io/managed-by": "freelens-velero-extension" };
const REQUEST_LABEL = "freelensapp.io/diagnostic-request";
const IDENTIFIER = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
// A resource as the release writes it: its API version and its kind, as `v1/Pod` or `apps/v1/Deployment`.
const RESOURCE_NAME = /^(?:[a-z0-9.-]+\/)?v\d+[a-z0-9]*\/[A-Z][A-Za-z0-9]*$/;
// The actions the release writes after an item of a restore.
const ACTIONS = ["created", "updated", "failed", "skipped"] as const;
// How long what must not happen is waited for.
const NOTHING = 1500;
// How long after its last load the suite waits for the server: the ten minutes a request lives after it is
// signed, the minute between two passes of the server, and a margin.
const REMOVED_WITHIN = 12 * 60 * 1000;
// How long the panel has to show the part of a load the main process runs for a step of that part to be
// expected among the ones it showed: the views ask the main process where a load is four times a second.
const WATCHABLE = 1000;
// The second gestures the cases of the suite give, twenty-five: eighteen loads that end with their text, which
// are the four tabs of the restore, the log of the backup twice and its other three tabs, the three empty
// artifacts of the backup synced without its log, the results, the resources and the volumes of the backup
// synced with its artifacts, its log, the log of the backup through the identity whose token an `exec` plugin
// gives, and the log of the backup once the extension was disabled and enabled again; three that end as a file
// the store does not have, the log of the backup synced without one and the logs of the two operations that
// failed their validation; one that ends at the port-forward, which its identity may not ask; one whose cluster
// is disconnected while it runs; and two that are cancelled, the results of the backup as soon as their load
// begins, and the large log once its request is in the cluster.
const GESTURES = 25;
// The rows a list of lines mounts at most.
const ROWS_BOUND = 100;
// The characters a row shows of a line at most: a longer line is cut in its row, and whole in its copy.
const LINE_BOUND = 10_000;
// What is pictured of the tabs for the review, in both themes, whenever the suite runs: the picture of a
// load while it runs is beside these, and is taken when a load lasts long enough to be pictured.
const PICTURED = ["first", "confirmation", "log", "results", "resources", "volumes"];
const LOADING = "loading";
// The measures of the log of 200,000 lines: an answer of the search or of the filter within this many milliseconds,
// and the longest frame of a scroll gesture within this many, both at the 95th percentile of twenty after five
// that warm the viewer; and the idle frame of the window at the median of sixty, over which no frame can be timed.
const ANSWER_BUDGET = 250;
const FRAME_BUDGET = 50;
const IDLE_FRAME = 25;
const IDLE_FRAMES = 60;
const MEASURED = 20;
// The scroll: a notch is three lines; the gesture that warms the list goes to one line; the far gestures go to
// these lines, the first three each followed by two notches and two pages, forward, backward and forward again.
const NOTCH = 3;
const WARM_SCROLL = 100_000;
const FAR = [50_000, 150_000, 199_000, 25_000, 175_000, 75_000, 125_000, 2];
// The choices of the levels of the log, each one click from the one before, from none chosen: two that warm the
// filter, the clicks that choose none again, ten that are measured, each a combination never chosen before in the
// view, and the clicks that choose none again at the end.
const TOGGLES: [use: string, levels: artifacts.LogLevel[]][] = [
  ["warm", ["warning", "other"]],
  ["none", ["warning", "other"]],
  ["measured", ["debug", "error", "other", "debug", "warning", "info", "error", "other", "debug", "error"]],
  ["none", ["info", "warning", "debug", "error"]],
];
// The levels the case of the log chose before the measures, each alone.
const CHOSEN_BEFORE: artifacts.LogLevel[][] = [["info"], ["error"]];

interface OperationRead {
  spec?: { storageLocation?: string; backupName?: string };
  status?: {
    phase?: string;
    errors?: number;
    warnings?: number;
    progress?: { totalItems?: number; itemsBackedUp?: number; itemsRestored?: number };
  };
}

// The percentile of the measures, as the suite of the long lists and the measure of the unit tests take it: of
// twenty times, the 95th leaves the slowest out, and no other.
function percentile(values: number[], fraction: number): number {
  const sorted = [...values].sort((one, other) => one - other);

  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
}

const tenths = (ms: number) => Math.round(ms * 10) / 10;

describe("the log, the results, the resources and the volumes of an operation", () => {
  let started: velero.StartedApplication | undefined;
  let frame: Frame;
  // The kubeconfig of the environment, as it is published in the profile: the catalog names the cluster by it.
  let kubeconfig = "";
  let before: cluster.ClusterSnapshot;
  // What the runner counted of the fixtures of the tabs, outside the extension.
  let facts: artifacts.TabFixtureFacts;
  // What the API server counted of the requests, and of every kind of Velero, before the application started.
  let counted: Record<string, number>;
  let written: Record<string, number>;
  // The origin the storage location of the backup signs over, which is where every text comes from.
  let origin = "";
  // When the suite last gave the second gesture of a load, which is what creates a request: the server
  // removes a request ten minutes after it signed it. Nothing, while the suite gave none.
  let lastLoad = 0;
  // How many second gestures the suite gave so far.
  let gestures = 0;
  // The log of the backup as the suite saved it, which is what it counts the lines and the matches in.
  let saved: { file: string; lines: string[] } | undefined;
  const errors = velero.createErrorCollector();
  // What the suite asked the extension to create, by the names the tabs gave.
  const ledger = artifacts.requestLedger();
  // What each tab loaded, by its operation and its tab: nothing for a tab whose text went.
  const loads: Record<string, (artifacts.Loaded & { moments: artifacts.LoadMoment[] }) | undefined> = {};
  // The name a load is kept by: its kind, its operation and its tab. The operations of the demo are the
  // ones a kind names by itself.
  const of = (kind: artifacts.Operation, tab: artifacts.ArtifactTab, name = NAMES[kind]) => `${kind}/${name}/${tab}`;
  // What was seen, of each load that ended with its text, of the part the main process runs: for how long,
  // the steps only the main process tells, and every step, in the order the loads were made.
  const watched: { load: string; lasted: number; told: string[]; steps: string[] }[] = [];
  const pictures: Record<string, string> = {};
  // At how many loads a picture of a load was asked, by the name of the picture.
  const pictured: Record<string, number> = {};
  const problems: Record<string, string[]> = {};
  // What the check of the layout of a tab found of each tab that was shown, by the same names.
  const tabProblems: Record<string, string[]> = {};

  const application = () => {
    if (!started) throw new Error("The application is not running");
    return started;
  };
  // What the API server counted of the requests since a reading of its counters. The server of the
  // installation removes a request ten minutes after it signed it, whenever that falls: its removals are
  // counted at the end of the suite, with everything else.
  const since = (earlier: Record<string, number>) => {
    const { "DELETE 200": _removed, ...rest } = cluster.counted(earlier, cluster.requestCodes(RESOURCE));

    return rest;
  };
  // The view of an operation at a tab, from the list of its kind: whatever view was open is closed.
  const open = async (kind: artifacts.Operation, tab: artifacts.WorkspaceTab, name = NAMES[kind]) => {
    await artifacts.openWorkspaceOf(frame, kind, name);
    if (tab !== "summary") await artifacts.openTab(frame, kind, tab);
  };
  // The view of an operation at a tab, as the case before left it: it is opened from its list only when it
  // is not the one that is shown, since a view that is opened again holds nothing of what its tabs loaded.
  const stay = async (kind: artifacts.Operation, tab: artifacts.WorkspaceTab, name = NAMES[kind]) => {
    if (await artifacts.viewOf(frame, kind, name)) await artifacts.openTab(frame, kind, tab);
    else await open(kind, tab, name);
  };
  const writesOn = async () => {
    if ((await cluster.writesState(frame)) !== "on") await cluster.turnWritesOn(frame);
  };
  // What the extension asked of the DownloadRequests since a reading of the counters: what the server of
  // the installation writes into the requests it holds is left out, as its removals are. It writes into a
  // request when it comes to it, which may be while a case that creates nothing is looking.
  const askedSince = (earlier: Record<string, number>) =>
    Object.fromEntries(Object.entries(since(earlier)).filter(([key]) => !key.startsWith("PATCH ")));
  // Nothing reached the cluster since two readings of the counters: nothing the extension asks of a
  // DownloadRequest, and no request of another kind of Velero that is not a read, by whoever.
  const expectNoWrite = async (earlier: Record<string, number>, writesBefore: Record<string, number>) => {
    await frame.waitForTimeout(NOTHING);
    expect(askedSince(earlier)).toEqual({});
    expect(
      Object.keys(cluster.counted(writesBefore, cluster.writes(cluster.apiRequests()))).filter(
        (key) => key.split(" ")[1] !== RESOURCE,
      ),
    ).toEqual([]);
  };
  // Where the suite has a log saved: under the profile of the run, which goes with it.
  const savedInto = (what = "the-log-of-the-backup") => {
    const directory = path.join(application().directory, "saved-by-the-suite");

    return { directory, file: path.join(directory, `${what}.txt`) };
  };
  // The log of a backup, shown with the command that saves it. The main process holds a text for ten
  // minutes after its load, and the command goes when that time has passed: a case that comes to it later
  // says so by name, with what the tab says of until when, and not as a command that was not found.
  const toTheSave = async (name = NAMES.backup) => {
    const id = (part: artifacts.PanelPart) => artifacts.PARTS.panel("backup", "log", part);
    const loaded = loads[of("backup", "log", name)];

    if (!loaded)
      throw new Error(`The log of the backup ${name} is not loaded: the case that loads it comes before this one`);
    await stay("backup", "log", name);
    const state = await artifacts.panelState(frame, "backup", "log");

    if (!state.commands.includes(id("save"))) {
      const until = (await artifacts.present(frame, id("saveUntil")))
        ? await artifacts.said(frame, id("saveUntil"))
        : "The tab says nothing of until when its text can be saved.";
      // The command is not offered either while the dialog of a saving is open: one nobody answered.
      const saving = (await artifacts.present(frame, id("saving")))
        ? await artifacts.attribute(frame, id("saving"), "data-saving")
        : "nothing";

      throw new Error(
        `The log of the backup is not offered to be saved: its tab is at ${state.step}, and its saving at ${saving}. ${until}`,
      );
    }
    return loaded;
  };
  // What the dialog of the save was asked with, the one time a saving asks it: what is saved, and the name
  // of a file with no folder. Where a part of a signed URL would be is looked at first, and said by name.
  const expectAsked = (calls: velero.SaveDialogCall[], name = NAMES.backup) => {
    const title = artifacts.WORDS.saveTitle("backup", "log", name, NAMESPACE, CLUSTER);

    expect(
      artifacts.signedUrlIn({
        "the title of the dialog": calls.map((call) => call.title).join("\n"),
        "the message of the dialog": calls.map((call) => call.message).join("\n"),
        "the file the dialog suggests": calls.map((call) => call.defaultPath).join("\n"),
      }),
    ).toEqual([]);
    expect(calls).toEqual([{ title, message: title, defaultPath: artifacts.WORDS.savedFile("backup", "log", name) }]);
  };
  // A part of the viewer of the log of the backup.
  const logPart = (part?: artifacts.ViewerPart) => artifacts.PARTS.viewer("backup", "log", part);
  // The keys that move among the lines of the log are of its list: it is given the focus before them.
  const toTheList = async () => {
    await (await artifacts.part(frame, logPart("text"))).focus();
  };
  // The log of a backup in a viewer that starts anew, at its first line, with no search, no level chosen
  // and its lines not wrapped: a viewer keeps what was chosen in it for as long as its tab is shown, and
  // each case of the log starts from none of it. The text is the one that was loaded: nothing is asked.
  const freshLog = async (name = NAMES.backup) => {
    const loaded = loads[of("backup", "log", name)];

    if (!loaded)
      throw new Error(`The log of the backup ${name} is not loaded: the case that loads it comes before this one`);
    await stay("backup", "results", name);
    await artifacts.openTab(frame, "backup", "log");
    const state = await artifacts.panelState(frame, "backup", "log");

    if (state.step !== "loaded" || !state.viewer || state.shown !== loaded.request) {
      throw new Error(
        `The log of the backup ${name} is not shown as it was loaded: its tab is at ${state.step}, ` +
          `with ${state.shown === "" ? "no text" : `the text of ${state.shown}`}`,
      );
    }
    return artifacts.logLike(frame, "backup", "shows its first lines", (shown) => shown.mounted[0] === 1);
  };
  // The lines of the log of the backup as the suite saved it, for the cases that count in the file.
  const savedLines = () => {
    if (!saved) throw new Error("The log of the backup was not saved: the case that saves it comes before this one");
    if (saved.lines[0]?.startsWith("{")) {
      throw new Error("The log is in the JSON format: the cases that count in the file read the text format");
    }
    return saved.lines;
  };
  // What the cluster holds of an operation: its spec and its status, as its controller wrote them.
  const read = (kind: artifacts.Operation, name = NAMES[kind]): OperationRead => {
    const found = cluster.veleroObject<OperationRead>(FAMILIES[kind], name);

    if (!found) {
      throw new Error(
        `The ${kind} ${name} is not in ${NAMESPACE}: the environment does not hold it, or is older than its ` +
          "backup lasts. `pnpm demo:up` creates the operations of the demo again, and `pnpm e2e:views` places " +
          "the fixtures of the tabs.",
      );
    }
    return found;
  };
  // A picture of the frame for the review, named by the theme it is taken in.
  const picture = async (name: string) => {
    const { theme } = await cluster.applied(frame);
    const file = await cluster.captureScreenshot(frame, `${theme}-artifact-${name}`);

    if (file) pictures[`${theme}-artifact-${name}`] = file;
  };
  // A picture of a load while it runs, for the theme the application is in, asked at each load of the
  // suite until one is kept. A load of a small file can end while its picture is taken: the picture is kept
  // under the name of a load only when the panel said that it was loading before the picture was asked and
  // after it was taken, and is removed otherwise. It fails no load: a theme no load was pictured in is said
  // by a case of its own.
  const loadingPicture = async (kind: artifacts.Operation, tab: artifacts.ArtifactTab) => {
    try {
      const theme = await frame.evaluate(() => (document.body.classList.contains("theme-light") ? "light" : "dark"));
      const name = `${theme}-artifact-${LOADING}`;
      const step = () => artifacts.attribute(frame, artifacts.PARTS.panel(kind, tab), "data-step");

      if (pictures[name]) return;
      pictured[name] = (pictured[name] ?? 0) + 1;
      if ((await step()) !== "loading") return;
      const taken = await cluster.captureScreenshot(frame, `${name}-as-it-was-taken`);

      if (!taken) return;
      if ((await step()) !== "loading") {
        await rm(taken, { force: true });
        return;
      }
      const kept = path.join(path.dirname(taken), `${name}.png`);

      await rename(taken, kept);
      pictures[name] = kept;
    } catch (error) {
      console.log(`No picture was taken of the load of the ${artifacts.ARTIFACTS[tab].noun} of the ${kind}: ${error}`);
    }
  };
  // What the checks of the layout find of a tab that is shown, kept by a name: a case that goes on to
  // something else leaves it here. The check of the page looks at the page and at what holds it, and knows
  // no part of a tab; the check of the tab looks at the parts of the tab. Each is expected to have found
  // nothing by a case of its own, after the pictures.
  const layout = async (name: string, kind: artifacts.Operation, tab: artifacts.WorkspaceTab) => {
    problems[name] = await cluster.layoutProblems(frame, LISTS[kind]);
    tabProblems[name] = await artifacts.tabLayoutProblems(frame, kind, tab);
  };
  // A report is written beside the pictures, which a hosted run uploads. One that would carry a part of a
  // URL the server signed is not written, and the case fails by the name of the report and of nothing in it.
  const report = async (name: string, value: unknown) => {
    if (artifacts.signedUrlIn({ [name]: JSON.stringify(value) }).length > 0) {
      throw new Error(`The report ${name} would carry a part of a signed URL: it is not written`);
    }
    await cluster.writeReport(name, value);
  };
  // What the guard is told of a load when its second gesture was given, whatever became of the load: the
  // request the panel named is one of the suite when the cluster holds it. A load that ended without its
  // text, or that did not end, may have created its request all the same, and a request the guard was not
  // told would be found by every case after it, and left to the suites after this one.
  const told = (request: string) => {
    lastLoad = Date.now();
    gestures += 1;
    if (request !== "" && cluster.downloadRequests(NAMESPACE).some((held) => held.name === request)) {
      ledger.add(request);
    }
  };
  // What was seen of a load is kept, for the case that looks at the steps of every load of the suite.
  const watch = (
    kind: artifacts.Operation,
    tab: artifacts.ArtifactTab,
    moments: artifacts.LoadMoment[],
    name = NAMES[kind],
  ) => {
    watched.push({
      load: of(kind, tab, name),
      ...artifacts.toldByTheMainProcess(moments),
      steps: artifacts.stepsSeen(moments),
    });
  };
  // The request of a load that ended, with its text or at a store that does not have the file: it is in
  // the cluster under the name the tab gives it, as the confirmation showed it and processed by the server.
  // And nothing the guard was not told is in the namespace, which is expected last: what it finds is of
  // another load, and hides nothing of this one.
  const expectRequest = (
    kind: artifacts.Operation,
    tab: artifacts.ArtifactTab,
    request: string,
    name = NAMES[kind],
  ) => {
    const identifier = request.slice(name.length + 1);
    const held = cluster.downloadRequests(NAMESPACE);
    const mine = held.find((entry) => entry.name === request);

    expect([kind, tab, request, mine !== undefined, ledger.asked().includes(request)]).toEqual([
      kind,
      tab,
      request,
      true,
      true,
    ]);
    expect([kind, tab, request.startsWith(`${name}-`), IDENTIFIER.test(identifier)]).toEqual([kind, tab, true, true]);
    expect([kind, tab, mine?.target]).toEqual([kind, tab, { kind: artifacts.ARTIFACTS[tab].targets[kind], name }]);
    expect([kind, tab, mine?.labels]).toEqual([kind, tab, { ...LABELS, [REQUEST_LABEL]: identifier }]);
    expect([kind, tab, mine?.phase, (mine?.expiration ?? "") !== ""]).toEqual([kind, tab, "Processed", true]);
    expect([kind, tab, held.map((entry) => entry.name).filter((name) => !ledger.asked().includes(name))]).toEqual([
      kind,
      tab,
      [],
    ]);
  };
  // What the tab says of a text it loaded: when and how much, over the text, and under it through which
  // request and the way it came by.
  const expectLoaded = (kind: artifacts.Operation, tab: artifacts.ArtifactTab, loaded: artifacts.Loaded) => {
    const words = artifacts.WORDS.loaded(tab, loaded.size);

    expect([kind, tab, Number.isInteger(loaded.size), loaded.size > 0]).toEqual([kind, tab, true, true]);
    expect([kind, tab, loaded.said.slice(0, words.start.length), loaded.said.slice(-words.end.length)]).toEqual([
      kind,
      tab,
      words.start,
      words.end,
    ]);
    expect([kind, tab, loaded.through]).toEqual([kind, tab, artifacts.WORDS.through(loaded.request)]);
    // The store of the environment is a Service of the cluster: the bytes come through a tunnel to its Pod.
    expect([kind, tab, loaded.route, loaded.came]).toEqual([
      kind,
      tab,
      "tunnel",
      artifacts.WORDS.cameBy("tunnel", origin.startsWith("https:"), origin),
    ]);
  };
  // One load, from the command of its tab to its text, with one creation counted for it. The guard is told
  // the request of the load before anything is expected of it, and when the load ended without its text.
  // A picture of the load is asked while it runs.
  const loadOf = async (kind: artifacts.Operation, tab: artifacts.ArtifactTab, name = NAMES[kind]) => {
    const earlier = cluster.requestCodes(RESOURCE);
    const loaded = await artifacts.load(frame, kind, tab, told, { loading: () => loadingPicture(kind, tab) });

    // What the tab loaded is kept first: the cases after this one start from it, whatever is found of it here.
    loads[of(kind, tab, name)] = loaded;
    watch(kind, tab, loaded.moments, name);
    expectRequest(kind, tab, loaded.request, name);
    expect([kind, tab, since(earlier)["POST 201"]]).toEqual([kind, tab, 1]);
    expectLoaded(kind, tab, loaded);

    return loaded;
  };
  // One load that ends without its text, from the command of its tab to how it ended, with one creation
  // counted for it: the request was created, and the server processed it, as for any other load. The
  // guard is told the request as `loadOf` tells it. A load that ends with its text fails by name.
  const endedWithout = async (kind: artifacts.Operation, tab: artifacts.ArtifactTab, name: string) => {
    const earlier = cluster.requestCodes(RESOURCE);

    await artifacts.ask(frame, kind, tab);
    const { ended, moments, request } = await artifacts.runLoad(frame, kind, tab, told, {
      loading: () => loadingPicture(kind, tab),
    });

    watch(kind, tab, moments, name);
    if (ended === "loaded") {
      throw new Error(
        `The ${artifacts.ARTIFACTS[tab].noun} of the ${kind} ${name} was loaded: the store has a file for it`,
      );
    }
    expectRequest(kind, tab, request, name);
    expect([kind, tab, since(earlier)["POST 201"]]).toEqual([kind, tab, 1]);

    return { failure: await artifacts.failureOf(frame, kind, tab), request, moments };
  };
  // What holds of the results of an operation whose plugins ran no operation of their own: the file counts
  // what the status counts, a counter the status does not write being a count of none, and the tab has
  // nothing to say of a difference. The errors come first, then the warnings, each by Velero, the cluster
  // and the namespaces by their names.
  const expectResults = async (kind: artifacts.Operation, name = NAMES[kind]) => {
    const status = read(kind, name).status ?? {};
    const results = await artifacts.resultsShown(frame, kind);

    expect([kind, results.errors, results.warnings]).toEqual([kind, status.errors ?? 0, status.warnings ?? 0]);
    expect([kind, results.summary]).toEqual([kind, artifacts.WORDS.results(kind, results.errors, results.warnings)]);
    expect([kind, results.differs]).toEqual([kind, undefined]);
    if (results.errors + results.warnings === 0) {
      expect([kind, results.groups]).toEqual([kind, []]);
      return;
    }
    expect([kind, results.groups.map((group) => [group.kind, group.count, group.title])]).toEqual([
      kind,
      [
        ["errors", results.errors, artifacts.WORDS.group("errors", results.errors)],
        ["warnings", results.warnings, artifacts.WORDS.group("warnings", results.warnings)],
      ],
    ]);
    for (const group of results.groups) {
      const places = group.places.map((place) => (place.where === "velero" ? 0 : place.where === "cluster" ? 1 : 2));
      const namespaces = group.places.filter((place) => place.where === "namespace").map((place) => place.namespace);

      expect([kind, group.kind, group.places.reduce((sum, place) => sum + place.count, 0)]).toEqual([
        kind,
        group.kind,
        group.count,
      ]);
      expect([kind, group.kind, places, namespaces]).toEqual([
        kind,
        group.kind,
        [...places].sort(),
        [...namespaces].sort(),
      ]);
      for (const place of group.places) {
        expect([kind, group.kind, place.title]).toEqual([
          kind,
          group.kind,
          artifacts.WORDS.place(group.kind, place.where, place.namespace, place.count),
        ]);
      }
    }
  };
  // What holds of the rows of a resource list that are mounted: the first is a resource, each resource is
  // written as its API version and its kind with the count of its items, and each item has a name, and a
  // namespace or the word that says it is of the cluster.
  const expectRows = (kind: artifacts.Operation, rows: artifacts.ResourceRow[]) => {
    expect([kind, rows.length > 0 && "resource" in rows[0]]).toEqual([kind, true]);
    for (const row of rows) {
      if ("resource" in row) {
        expect([kind, row.resource, RESOURCE_NAME.test(row.resource)]).toEqual([kind, row.resource, true]);
        expect([kind, row.resource, row.said]).toEqual([kind, row.resource, artifacts.WORDS.itemsOf(row.count)]);
      } else {
        expect([kind, row.item, row.name !== "", row.namespace !== ""]).toEqual([kind, row.item, true, true]);
        if (row.scope === "cluster") expect([kind, row.item, row.namespace]).toEqual([kind, row.item, "cluster"]);
      }
    }
  };

  beforeAll(async () => {
    // The operations of the suite are named by the run of the fixtures: without it they are named by
    // nothing, and would be said missing from an environment that has them.
    if (!/^[0-9a-f]{8}$/.test(RUN)) {
      throw new Error(
        `E2E_FIXTURE_RUN is "${RUN}", and the run of the fixtures is eight hexadecimal characters. ` +
          "Run the suite through `pnpm e2e:views`, which names it.",
      );
    }
    if (!cluster.fixturesReady()) {
      throw new Error(cluster.fixturesMissing());
    }
    // What the runner counted of the fixtures of the tabs is of this run, and names the operations the suite
    // names: facts of another run would be compared with what the cluster holds of this one.
    facts = await artifacts.tabFixtureFacts();
    expect([facts.run, facts.namespace, facts.synced.backup, facts.withoutLog.backup]).toEqual([
      RUN,
      NAMESPACE,
      SYNCED,
      WITHOUT_LOG,
    ]);
    expect([facts.refused.backup.name, facts.refused.restore.name, facts.refused.orphan.name]).toEqual([
      REFUSED.backup,
      REFUSED.restore,
      ORPHAN,
    ]);
    // The two operations of the controller are there, and the location the backup names says where it signs.
    read("restore");
    const location = cluster.veleroObject<{ spec?: { config?: Record<string, string> } }>(
      "backupstoragelocations",
      read("backup").spec?.storageLocation ?? "",
    );
    const signedOver = location?.spec?.config?.publicUrl || location?.spec?.config?.s3Url;

    if (!signedOver) {
      throw new Error(`The storage location of ${NAMES.backup} names no URL of its store: its origin is not known`);
    }
    origin = new URL(signedOver).origin;
    before = cluster.clusterSnapshot();
    // A request an earlier run left would be counted with the ones of this one, and removed while it runs.
    if (before.named.length > 0) {
      throw new Error(
        `Requests to Velero are in the cluster before the suite starts: ${before.named.join(", ")}. ` +
          "The server removes a DownloadRequest ten minutes after it signed it: wait for it, then run again.",
      );
    }
    counted = cluster.requestCodes(RESOURCE);
    written = cluster.apiRequests();
    errors.start();
    // The kubeconfig is in the profile before the install is asked, for each start of the application.
    started = await velero.startWithExtension(async () => {
      kubeconfig = await cluster.publishKubeconfig();
    });
    errors.watch(started.window);
    await velero.dismissNotifications(started.window);
    await velero.navigateToCatalog(started.app);
    expect(await velero.catalogClusterCount(started.window)).toBe(1);
    frame = await cluster.openClusterFromCatalog(started.window, kubeconfig);
    await velero.setWindowSize(started.app, 1440, 900);
    await cluster.openBackups(frame);
    await cluster.selectInstallation(frame, NAMESPACE);
    await cluster.waitForBackups(frame);
  }, TIMEOUT);

  // Whatever happened, the suites after this one find no request of this one: the server removes the ones
  // of its installation, and the application is closed before the wait, which needs nothing of it. A suite
  // that gave no second gesture created nothing, and waits for nothing: what it found in the cluster when
  // it started is of another run, and is said at once. What a case left in the installation of the views,
  // which no server reads, is removed with the helper after the wait: nothing, in a run where every case
  // passed.
  afterAll(async () => {
    try {
      if (started) errors.stop(started.window);
      await started?.cleanup();
    } finally {
      if (lastLoad > 0) {
        const deadline = lastLoad + REMOVED_WITHIN;

        try {
          if (cluster.downloadRequests(NAMESPACE).length > 0) {
            console.log(
              `The suite waits for the server to remove its requests from ${NAMESPACE}, ` +
                `for ${Math.max(0, Math.ceil((deadline - Date.now()) / 60_000))} minutes at most`,
            );
          }
          const left = await cluster.awaitRequestsGone(NAMESPACE, deadline);

          if (left.length > 0) {
            console.log(`Requests are left in ${NAMESPACE}: ${left.map((request) => request.name).join(", ")}`);
          }
        } catch (error) {
          console.log(String(error));
        }
      }
      // A request a case created in the installation of the views would stay for ever, and fail every suite
      // after this one: the one removal the suites make, of what one of them asked the extension to create,
      // outside the installation of the demo, where the server removes its own.
      try {
        const removed = cluster.removeRequestsOfTheExtension(VIEWS, "DownloadRequest");

        if (removed > 0) console.log(`Removed ${removed} DownloadRequests of the extension left in ${VIEWS}`);
      } catch (error) {
        console.log(String(error));
      }
    }
  }, TIMEOUT);

  it(
    "shows the five tabs of the workspace of a backup and of a restore in their order, the summary open, and names the tab that is open in the address",
    async () => {
      for (const kind of OPERATIONS) {
        const name = NAMES[kind];

        await artifacts.openWorkspaceOf(frame, kind, name);
        const first = await artifacts.tabsOf(frame, kind);

        // A list of tabs with its name, and five tabs in it, each with its role, whether it is selected
        // and the part it shows.
        expect([kind, first.role, first.name]).toEqual([kind, "tablist", `What is shown of the ${kind}`]);
        expect([kind, first.tabs]).toEqual([
          kind,
          artifacts.TABS.map((tab) => ({
            id: artifacts.PARTS.tab(kind, tab.id),
            title: tab.title,
            role: "tab",
            selected: tab.id === "summary" ? "true" : "false",
            controls: artifacts.PARTS.shown(kind),
          })),
        ]);
        // The summary is open, and no tab in the address says it.
        expect([kind, first.open, first.address]).toEqual([kind, "summary", ""]);
        expect([kind, first.panel]).toEqual([
          kind,
          { role: "tabpanel", id: artifacts.PARTS.shown(kind), labelled: artifacts.PARTS.tab(kind, "summary") },
        ]);
        // A tab that is chosen is the one that is selected, the one the part is named by, and the one the
        // address names, beside the view.
        for (const tab of artifacts.ARTIFACT_TABS) {
          await artifacts.openTab(frame, kind, tab);
          const at = await artifacts.tabsOf(frame, kind);

          expect([kind, tab, at.open, at.address, at.selected, at.panel.labelled]).toEqual([
            kind,
            tab,
            tab,
            tab,
            [artifacts.PARTS.tab(kind, tab)],
            artifacts.PARTS.tab(kind, tab),
          ]);
          expect([kind, tab, await cluster.addressViews(frame)]).toEqual([kind, tab, [`${kind}/${name}`]]);
        }
        await artifacts.openTab(frame, kind, "summary");
        expect([kind, (await artifacts.tabsOf(frame, kind)).address]).toEqual([kind, ""]);
        // A picture of the summary under the strip, for the review: it is what it was before the tabs.
        // The pointer is parked in a corner: what it rests on is drawn as pointed at.
        if (kind === "backup") {
          await application().window.mouse.move(1, 1);
          await cluster.captureScreenshot(frame, "dark-artifact-summary");
        }
        // A tab is opened by its address as well.
        await artifacts.openAt(frame, kind, name, "resources");
        expect([kind, (await artifacts.tabsOf(frame, kind)).selected]).toEqual([
          kind,
          [artifacts.PARTS.tab(kind, "resources")],
        ]);
        // A page that is opened again shows the tab it was at, with nothing of it loaded: another page,
        // then the address the view had.
        const address = await frame.evaluate(() => `${window.location.pathname}${window.location.search}`);

        await cluster.openPage(frame, cluster.OVERVIEW);
        await cluster.navigate(frame, address);
        await artifacts.shownAt(frame, kind, name, "resources");
        expect([kind, (await artifacts.panelState(frame, kind, "resources")).step]).toEqual([kind, "first"]);
        // What is no tab is the summary: the contents of a backup have none, whatever an address asks for.
        await cluster.navigate(frame, `${artifacts.viewAddress(kind, name)}&tab=contents`);
        await artifacts.shownAt(frame, kind, name, "summary");
      }
    },
    TIMEOUT,
  );

  it(
    "says with writes off what each tab would create, and offers the way to the target bar and no other command",
    async () => {
      const earlier = cluster.requestCodes(RESOURCE);

      // The main process said where the gate is: the command that turns writes on is offered, and they are off.
      await frame.waitForSelector("[data-testid=velero-writes-on]", { timeout: 60_000 });
      expect(await cluster.writesState(frame)).toBe("off");
      for (const kind of OPERATIONS) {
        await open(kind, "summary");
        for (const tab of artifacts.ARTIFACT_TABS) {
          await artifacts.openTab(frame, kind, tab);
          const state = await artifacts.panelState(frame, kind, tab);

          // The way to the target bar is the one command of the tab: nothing in it creates a request.
          expect([kind, tab, state.step, state.commands, state.viewer]).toEqual([
            kind,
            tab,
            "first",
            [artifacts.PARTS.panel(kind, tab, "toTarget")],
            false,
          ]);
          // The state of the gate is said first and apart, then what the tab would create.
          expect([kind, tab, await artifacts.said(frame, artifacts.PARTS.panel(kind, tab, "writesOff"))]).toEqual([
            kind,
            tab,
            artifacts.WORDS.writesOff,
          ]);
          expect([kind, tab, await artifacts.said(frame, artifacts.PARTS.panel(kind, tab, "what"))]).toEqual([
            kind,
            tab,
            artifacts.WORDS.wouldCreate(kind, tab, NAMES[kind], NAMESPACE, CLUSTER),
          ]);
          expect([kind, tab, await artifacts.said(frame, artifacts.PARTS.panel(kind, tab, "toTarget"))]).toEqual([
            kind,
            tab,
            artifacts.WORDS.toTheWrites,
          ]);
        }
      }
      // The way leads to the command that turns writes on, which is not given here.
      await artifacts.clickOn(frame, artifacts.PARTS.panel("restore", "volumes", "toTarget"));
      expect(await cluster.focusOn(frame, "velero-writes-on")).toBe("velero-writes-on");
      await frame.waitForTimeout(NOTHING);
      expect(since(earlier)).toEqual({});
      expect(await cluster.layoutProblems(frame, cluster.RESTORES)).toEqual([]);
      await cluster.captureScreenshot(frame, "dark-artifact-writes-off");
    },
    TIMEOUT,
  );

  it(
    "opens every tab with writes on, by a click and by its address, and closes the view and opens it again: the API server counts no creation and no read of a DownloadRequest for any of it, and no read of a family for the tabs opened by a click",
    async () => {
      await cluster.turnWritesOn(frame);
      const earlier = cluster.requestCodes(RESOURCE);

      for (const kind of OPERATIONS) {
        await open(kind, "summary");
        // The four tabs are opened by a click in the time between two reads of the installation, with the
        // counters of the API server read before and after: nothing is read of any family for them. The
        // reads of the families are measured for the clicks alone: a tab opened by its address, and a view
        // opened again, are measured below by what is counted of the DownloadRequests, which are what a
        // tab could create.
        expect([
          kind,
          await cluster.readsDuring(
            frame,
            async () => {
              for (const tab of artifacts.ARTIFACT_TABS) await artifacts.openTab(frame, kind, tab);
            },
            () => artifacts.openTab(frame, kind, "summary"),
          ),
        ]).toEqual([kind, {}]);
        for (const tab of artifacts.ARTIFACT_TABS) {
          await artifacts.openAt(frame, kind, NAMES[kind], tab);
          expect([kind, tab, (await artifacts.panelState(frame, kind, tab)).step]).toEqual([kind, tab, "first"]);
        }
        await cluster.closeWorkspace(frame);
        await cluster.openWorkspace(frame, NAMES[kind], LISTS[kind]);
        await artifacts.openTab(frame, kind, "log");
        expect([kind, (await artifacts.panelState(frame, kind, "log")).step]).toEqual([kind, "first"]);
      }
      // With writes on and no command given, nothing reached the cluster: no creation, and no read of a request.
      await frame.waitForTimeout(NOTHING);
      expect(since(earlier)).toEqual({});
      expect(cluster.downloadRequests(NAMESPACE)).toEqual([]);
      expect(await cluster.writesState(frame)).toBe("on");
    },
    TIMEOUT,
  );

  it(
    "offers with writes on the command of each tab, in the name of the kind of request it creates",
    async () => {
      await writesOn();
      for (const kind of OPERATIONS) {
        await open(kind, "summary");
        for (const tab of artifacts.ARTIFACT_TABS) {
          await artifacts.openTab(frame, kind, tab);
          const state = await artifacts.panelState(frame, kind, tab);

          expect([kind, tab, state.step, state.commands, state.viewer]).toEqual([
            kind,
            tab,
            "first",
            [artifacts.PARTS.panel(kind, tab, "create")],
            false,
          ]);
          expect([kind, tab, await artifacts.said(frame, artifacts.PARTS.panel(kind, tab, "what"))]).toEqual([
            kind,
            tab,
            artifacts.WORDS.wouldCreate(kind, tab, NAMES[kind], NAMESPACE, CLUSTER),
          ]);
          expect([kind, tab, await artifacts.said(frame, artifacts.PARTS.panel(kind, tab, "create"))]).toEqual([
            kind,
            tab,
            artifacts.WORDS.command(kind, tab),
          ]);
        }
      }
      await open("backup", "log");
      expect(await cluster.layoutProblems(frame)).toEqual([]);
      await picture("first");
    },
    TIMEOUT,
  );

  it(
    "shows the request as it will be submitted before it creates it, with the keyboard alone, and creates nothing when the confirmation is left by its command or with Escape",
    async () => {
      const keyboard = application().window.keyboard;
      const earlier = cluster.requestCodes(RESOURCE);

      await writesOn();
      for (const kind of OPERATIONS) {
        const id = (part?: artifacts.PanelPart) => artifacts.PARTS.panel(kind, "log", part);

        await open(kind, "log");
        // The command with the keyboard: what takes its place has the focus, and it is not the command
        // that creates.
        await (await artifacts.part(frame, id("create"))).focus();
        await keyboard.press("Enter");
        await artifacts.part(frame, id("confirm"));
        expect([kind, await cluster.focusOn(frame, id("confirm"))]).toEqual([kind, id("confirm")]);
        expect([kind, await artifacts.confirmationOf(frame, kind, "log")]).toEqual([
          kind,
          artifacts.WORDS.confirmation(kind, "log", NAMES[kind], NAMESPACE, CLUSTER, CLUSTER),
        ]);
        expect([kind, await artifacts.said(frame, id("confirmCreate"))]).toEqual([kind, artifacts.WORDS.confirmCreate]);
        expect([kind, await artifacts.said(frame, id("confirmBack"))]).toEqual([kind, artifacts.WORDS.confirmBack]);
        expect([kind, (await artifacts.panelState(frame, kind, "log")).step]).toEqual([kind, "confirming"]);
        expect([kind, await artifacts.present(frame, id("create"))]).toEqual([kind, false]);
        await layout(`dark-artifact-confirmation-of-the-${kind}`, kind, "log");
        if (kind === "backup") await picture("confirmation");
        // The command that creates, then the one that leaves: one press each.
        expect([kind, await cluster.tabTo(frame, (focus) => focus === id("confirmCreate"), 2)]).toEqual([kind, 1]);
        expect([kind, await cluster.tabTo(frame, (focus) => focus === id("confirmBack"), 2)]).toEqual([kind, 1]);
        await keyboard.press("Enter");
        await artifacts.gone(frame, id("confirm"));
        // Who leaves the confirmation is on the command again.
        expect([kind, await cluster.focusOn(frame, id("create"))]).toEqual([kind, id("create")]);
        // Escape leaves it as well, from wherever the focus is in it.
        await keyboard.press("Enter");
        await artifacts.part(frame, id("confirm"));
        expect([kind, await cluster.focusOn(frame, id("confirm"))]).toEqual([kind, id("confirm")]);
        await keyboard.press("Escape");
        await artifacts.gone(frame, id("confirm"));
        expect([kind, await cluster.focusOn(frame, id("create"))]).toEqual([kind, id("create")]);
        // The view is still the one of the operation, at its tab: the key was of the confirmation.
        expect([kind, (await artifacts.tabsOf(frame, kind)).open]).toEqual([kind, "log"]);
        expect([kind, (await artifacts.panelState(frame, kind, "log")).step]).toEqual([kind, "first"]);
      }
      // With writes on and no confirmation, nothing reached the cluster.
      await frame.waitForTimeout(NOTHING);
      expect(since(earlier)).toEqual({});
      expect(cluster.downloadRequests(NAMESPACE)).toEqual([]);
    },
    TIMEOUT,
  );

  it(
    "says in the details the host shows of a Backup and of a Restore where the four artifacts are, leads to the workspace, and asks the cluster for none of them",
    async () => {
      const earlier = cluster.requestCodes(RESOURCE);

      for (const kind of OPERATIONS) {
        const section = `[data-testid="${artifacts.PARTS.details(kind)}"]`;

        await cluster.navigate(frame, `/crd/velero.io/${FAMILIES[kind]}`);
        await cluster.selectHostNamespace(frame, NAMESPACE);
        await cluster.hostDetails(frame, NAMES[kind], artifacts.WORDS.inTheWorkspace(kind));
        expect([kind, await artifacts.said(frame, artifacts.PARTS.detailsWords(kind))]).toEqual([
          kind,
          artifacts.WORDS.inTheWorkspace(kind),
        ]);
        expect([kind, await artifacts.said(frame, artifacts.PARTS.detailsLink(kind))]).toEqual([
          kind,
          artifacts.WORDS.toTheWorkspace(kind),
        ]);
        // The section loads nothing: it has no command, and its one way is the way to the workspace.
        expect([kind, await frame.locator(`${section} button`).count()]).toEqual([kind, 0]);
        expect([kind, await frame.locator(`${section} a`).count()]).toEqual([kind, 1]);
        // The section is under what the host shows of the object by itself, further down than the drawer
        // has room for: its words are brought into that room before the picture of them is taken.
        if (kind === "backup") {
          await (await artifacts.part(frame, artifacts.PARTS.detailsWords(kind))).scrollIntoViewIfNeeded();
          await cluster.captureScreenshot(frame, "dark-artifact-host-details");
        }
        await artifacts.clickOn(frame, artifacts.PARTS.detailsLink(kind));
        // The way leads to the view of the operation, at its summary: no tab is in the address.
        await artifacts.shownAt(frame, kind, NAMES[kind], "summary");
        expect([kind, await cluster.addressViews(frame)]).toEqual([kind, [`${kind}/${NAMES[kind]}`]]);
        expect([kind, (await artifacts.tabsOf(frame, kind)).address]).toEqual([kind, ""]);
        expect([kind, (await cluster.target(frame)).namespace]).toEqual([kind, NAMESPACE]);
        // The tabs are there, and nothing of them is loaded.
        for (const tab of artifacts.ARTIFACT_TABS) {
          await artifacts.openTab(frame, kind, tab);
          expect([kind, tab, (await artifacts.panelState(frame, kind, tab)).step]).toEqual([kind, tab, "first"]);
        }
      }
      await frame.waitForTimeout(NOTHING);
      expect(since(earlier)).toEqual({});
      expect(cluster.downloadRequests(NAMESPACE)).toEqual([]);
      // The pages of the host were shown meanwhile: writes are on as they were left.
      expect(await cluster.writesState(frame)).toBe("on");
    },
    TIMEOUT,
  );

  it(
    "loads the log of the restore of the demo through a request of its own, and shows its lines from the first, each of one level or of none of them",
    async () => {
      // The first load of the suite: the view of the restore is opened from its list, with nothing loaded.
      await open("restore", "log");
      await writesOn();
      await loadOf("restore", "log");
      const log = await artifacts.logLike(
        frame,
        "restore",
        "shows its first lines",
        (shown) => shown.mounted.length > 0,
      );

      expect(log.lines).toBeGreaterThan(0);
      expect([log.shown, log.rows, log.count]).toEqual([
        log.lines,
        log.lines,
        artifacts.WORDS.lines(log.lines, log.lines),
      ]);
      expect(artifacts.LOG_LEVELS.reduce((sum, level) => sum + log.levels[level].count, 0)).toBe(log.lines);
      expect(log.mounted[0]).toBe(1);
      await layout("dark-artifact-log-of-the-restore", "restore", "log");
      // A picture of it for the review: a log of more than one level. The pointer is parked in a corner:
      // what it rests on is drawn as pointed at.
      await application().window.mouse.move(1, 1);
      await cluster.captureScreenshot(frame, "dark-artifact-log-of-the-restore");
    },
    TIMEOUT,
  );

  it(
    "loads the results of the restore of the demo through a request of its own, and counts in them what the status of the restore counts",
    async () => {
      await stay("restore", "results");
      await writesOn();
      await loadOf("restore", "results");
      await expectResults("restore");
      await layout("dark-artifact-results-of-the-restore", "restore", "results");
    },
    TIMEOUT,
  );

  it(
    "loads the resource list of the restore of the demo through a request of its own, and shows every item with what the restore did with it, by each choice of an action",
    async () => {
      await stay("restore", "resources");
      await writesOn();
      await loadOf("restore", "resources");
      const list = await artifacts.resourcesLike(
        frame,
        "restore",
        "shows its first rows",
        (shown) => shown.rows.length > 0,
      );
      const actions = list.actions;

      if (!actions) throw new Error("The resource list of the restore offers no choice by action");
      expect(list.columns).toEqual(["namespace", "name", "action"]);
      expect(list.items).toBeGreaterThan(0);
      expect([list.leftItems, list.leftResources, list.said]).toEqual([
        list.items,
        list.resources,
        artifacts.WORDS.resources(list.items, list.resources),
      ]);
      expectRows("restore", list.rows);
      // The release gives every item an action: the four count every item, and none is without one. The
      // restore of the demo created what it restored.
      expect(actions.all.count).toBe(list.items);
      expect(ACTIONS.reduce((sum, action) => sum + actions[action].count, 0)).toBe(list.items);
      expect(actions["not-stated"].count).toBe(0);
      expect(actions.created.count).toBeGreaterThan(0);
      for (const choice of artifacts.ACTION_CHOICES) {
        expect([choice, actions[choice].said, actions[choice].chosen]).toEqual([
          choice,
          artifacts.WORDS.actionChoice(choice, actions[choice].count),
          choice === "all",
        ]);
      }
      expect(
        list.rows.flatMap((row) => ("item" in row && !ACTIONS.some((action) => action === row.action) ? [row] : [])),
      ).toEqual([]);
      // A picture of it for the review, with the action of each item and the choices by action.
      await application().window.mouse.move(1, 1);
      await cluster.captureScreenshot(frame, "dark-artifact-resources-of-the-restore");
      // A choice leaves the items of its action, and one that leaves none says what it asked for.
      for (const choice of artifacts.ACTION_CHOICES) {
        if (choice === "all") continue;
        await artifacts.clickOn(frame, artifacts.PARTS.action("restore", choice));
        const left = await artifacts.resourcesLike(
          frame,
          "restore",
          `shows what the choice ${choice} leaves`,
          (shown) => shown.actions?.[choice].chosen === true && (shown.leftItems === 0 || shown.rows.length > 0),
        );

        expect([choice, left.leftItems]).toEqual([choice, actions[choice].count]);
        if (left.leftItems === 0) {
          expect([choice, left.said, left.rows, left.columns]).toEqual([
            choice,
            artifacts.WORDS.noneOfTheAction(list.items, choice),
            [],
            [],
          ]);
        } else {
          expect([choice, left.said]).toEqual([
            choice,
            artifacts.WORDS.resourcesLeft(left.leftItems, list.items, left.leftResources, list.resources),
          ]);
          expect([choice, [...new Set(left.rows.flatMap((row) => ("item" in row ? [row.action] : [])))]]).toEqual([
            choice,
            [choice === "not-stated" ? "" : choice],
          ]);
        }
      }
      await artifacts.clickOn(frame, artifacts.PARTS.action("restore", "all"));
      await artifacts.resourcesLike(
        frame,
        "restore",
        "shows every item again",
        (shown) => shown.leftItems === list.items,
      );
      await layout("dark-artifact-resources-of-the-restore", "restore", "resources");
    },
    TIMEOUT,
  );

  it(
    "loads the volume information of the restore of the demo through a request of its own, which is of no volume, and says that Velero recorded none",
    async () => {
      await stay("restore", "volumes");
      await writesOn();
      // The restore of the demo restored no volume: the release writes an empty list for it.
      await loadOf("restore", "volumes");
      expect(await artifacts.volumesShown(frame, "restore")).toEqual({
        count: 0,
        said: artifacts.WORDS.volumes("restore", 0),
        of: "",
        columns: [],
        rows: [],
        titles: [],
      });
    },
    TIMEOUT,
  );

  it(
    "keeps what each tab of the restore loaded while the other tabs were shown",
    async () => {
      const kept: [string, string, string | undefined][] = [];

      await stay("restore", "summary");
      for (const tab of artifacts.ARTIFACT_TABS) {
        await artifacts.openTab(frame, "restore", tab);
        const state = await artifacts.panelState(frame, "restore", tab);

        kept.push([tab, state.step, state.shown === "" ? undefined : state.shown]);
      }
      // Every tab is read before any is expected: a tab whose load did not end with its text is said
      // beside the ones that kept theirs.
      expect(kept).toEqual(
        artifacts.ARTIFACT_TABS.map((tab) => [
          tab,
          loads[of("restore", tab)] ? "loaded" : "the tab loaded nothing in the case before this one",
          loads[of("restore", tab)]?.request,
        ]),
      );
    },
    TIMEOUT,
  );

  it(
    "loads the log of the backup of the demo after the confirmation: the steps that are seen of the load, in the order they are told, then the text with the name of its request, its size and the way it came by, and the focus on its first line",
    async () => {
      const id = (part?: artifacts.PanelPart) => artifacts.PARTS.panel("backup", "log", part);

      await open("backup", "log");
      await writesOn();
      const earlier = cluster.requestCodes(RESOURCE);

      await artifacts.ask(frame, "backup", "log");
      // The load runs: a picture of the step it is at is asked at once, and takes nothing from the load.
      // The guard is told its request however it ends.
      const { moments } = await artifacts.runLoad(frame, "backup", "log", told, {
        loading: () => loadingPicture("backup", "log"),
      });
      const loaded = await artifacts.loadedFacts(frame, "backup", "log");

      loads[of("backup", "log")] = { ...loaded, moments };
      watch("backup", "log", moments);
      // What the panel showed, with the steps, the words of each and the names, and what the API server
      // counted for the load are kept for who reads the run, before anything is expected of either. No URL.
      const asked = since(earlier);

      await report("artifact-load-of-the-log", moments);
      await report("artifact-requests-of-a-load", asked);
      expectRequest("backup", "log", loaded.request);
      // The confirmation, then the load, then the text: nothing else, and in that order.
      expect(moments.map((moment) => moment.step).filter((step, at, steps) => step !== steps[at - 1])).toEqual([
        "confirming",
        "loading",
        "loaded",
      ]);
      // The steps: the wait for a place first and the pages of the text last, which the views draw by
      // themselves, and whatever was seen between them in the order the main process tells its steps. This
      // holds of a load seen at the first and the last alone: whether a step the main process tells was
      // seen is looked at for every load of the suite, in a case of its own.
      const steps = artifacts.stepsSeen(moments);

      expect(steps[0]).toBe("queue");
      expect(steps[steps.length - 1]).toBe("pages");
      expect([steps, artifacts.inTheOrder(steps, artifacts.STEPS.backup)]).toEqual([steps, true]);
      // Each step in its words, and the request named by the name it has in the cluster from the first.
      for (const moment of moments.filter((seen) => seen.step === "loading")) {
        expect([moment.at, moment.request]).toEqual([moment.at, loaded.request]);
        expect([moment.at, moment.status]).toEqual([
          moment.at,
          expect.stringMatching(artifacts.stepWords(moment.at, loaded.request)),
        ]);
      }
      // No text is shown while the load runs, and the one that is loaded is the one of this request.
      expect(moments.filter((moment) => moment.step === "loading" && (moment.viewer || moment.shown))).toEqual([]);
      expect(moments[moments.length - 1]).toMatchObject({ step: "loaded", shown: loaded.request, viewer: true });
      expectLoaded("backup", "log", loaded);
      // After the text, the command that loads it again and the one that saves it.
      expect((await artifacts.panelState(frame, "backup", "log")).commands).toEqual([id("create"), id("save")]);
      expect(await artifacts.said(frame, id("create"))).toBe(artifacts.WORDS.command("backup", "log", true));
      expect(await artifacts.said(frame, id("what"))).toBe(artifacts.WORDS.again("log"));
      expect(await artifacts.said(frame, id("save"))).toBe(artifacts.WORDS.save("log"));
      // The keyboard is on the first line of what arrived.
      const first = artifacts.PARTS.line("backup", "log", 1);

      await artifacts.part(frame, first);
      expect(await cluster.focusOn(frame, first)).toBe(first);
      // One creation, the reads of the request by its name while its URL was waited for, and what the
      // server wrote into it: nothing else. How many times the server writes is kept beside the pictures.
      expect(Object.keys(asked).filter((key) => !["GET 200", "PATCH 200", "POST 201"].includes(key))).toEqual([]);
      expect(asked["POST 201"]).toBe(1);
      expect(asked["GET 200"]).toBeGreaterThanOrEqual(1);
      expect(asked["PATCH 200"]).toBeGreaterThanOrEqual(1);
      // Nothing of the URL the server signed is in what the view shows, nor in what the panel said. What is
      // expected is where a part of one was found, by name: the words themselves are given to no expectation.
      expect(
        artifacts.signedUrlIn({
          "the view of the backup": await cluster.wordsOf(
            frame,
            `[data-testid="${artifacts.PARTS.workspace("backup")}"]`,
          ),
          ...Object.fromEntries(
            moments.map((moment, at) => [`what the panel said at its moment ${at + 1}`, moment.status]),
          ),
        }),
      ).toEqual([]);
      expect(await cluster.writesState(frame)).toBe("on");
    },
    TIMEOUT,
  );

  it(
    "loads the log again as a new request, with the text of before shown until the new request is created",
    async () => {
      const id = (part?: artifacts.PanelPart) => artifacts.PARTS.panel("backup", "log", part);
      const first = loads[of("backup", "log")];

      if (!first) throw new Error("The log of the backup is not loaded: the case that loads it comes before this one");
      await stay("backup", "log");
      const earlier = cluster.requestCodes(RESOURCE);

      await artifacts.ask(frame, "backup", "log");
      // Under the confirmation of the second request the text of the first is shown, and nothing is created.
      const under = await artifacts.panelState(frame, "backup", "log");

      expect([under.step, under.viewer, under.shown]).toEqual(["confirming", true, first.request]);
      // What the second gesture takes away stays said under the text while it is asked for.
      expect(await artifacts.said(frame, id("what"))).toBe(artifacts.WORDS.again("log"));
      expect(askedSince(earlier)).toEqual({});
      expect(
        cluster
          .downloadRequests(NAMESPACE)
          .map((request) => request.name)
          .filter((name) => !ledger.asked().includes(name)),
      ).toEqual([]);
      // The second gesture lets go of the text of the first load, whatever becomes of the second.
      loads[of("backup", "log")] = undefined;
      const { moments } = await artifacts.runLoad(frame, "backup", "log", told, {
        loading: () => loadingPicture("backup", "log"),
      });
      const second = await artifacts.loadedFacts(frame, "backup", "log");

      loads[of("backup", "log")] = { ...second, moments };
      watch("backup", "log", moments);
      expectRequest("backup", "log", second.request);
      expect(second.request).not.toBe(first.request);
      // The text of before was there until the second gesture, went with it, and the one that came is of
      // the new request, which the load named from its first step.
      const running = moments.filter((moment) => moment.step === "loading");

      expect(moments[0]).toMatchObject({ step: "confirming", shown: first.request, viewer: true });
      expect(running.length).toBeGreaterThan(0);
      expect(running.filter((moment) => moment.viewer || moment.shown || moment.request !== second.request)).toEqual(
        [],
      );
      expect(moments[moments.length - 1]).toMatchObject({ step: "loaded", shown: second.request, viewer: true });
      expect(since(earlier)["POST 201"]).toBe(1);
      expectLoaded("backup", "log", second);
      expect((await artifacts.panelState(frame, "backup", "log")).commands).toEqual([id("create"), id("save")]);
    },
    TIMEOUT,
  );

  it(
    "writes nothing when the dialog of the host that asks where to save the log is left, and says that nothing was saved",
    async () => {
      const running = application();
      const id = (part?: artifacts.PanelPart) => artifacts.PARTS.panel("backup", "log", part);
      const { directory } = savedInto();

      // The dialog of the host is not shown: what stands in its place answers that it was left.
      await mkdir(directory, { recursive: true });
      await velero.replaceSaveDialog(running.app);
      await toTheSave();
      const asked = (await velero.saveDialogCalls(running.app)).length;
      const earlier = cluster.requestCodes(RESOURCE);
      const writesBefore = cluster.writes(cluster.apiRequests());

      await artifacts.clickOn(frame, id("save"));
      await artifacts.attributeLike(frame, id("saving"), "data-saving", "left");
      expect(await artifacts.said(frame, id("saving"))).toBe(artifacts.WORDS.notSaved("log"));
      expectAsked((await velero.saveDialogCalls(running.app)).slice(asked));
      // No file was written, and the text can still be saved.
      expect(await readdir(directory)).toEqual([]);
      expect((await artifacts.panelState(frame, "backup", "log")).commands).toContain(id("save"));
      await expectNoWrite(earlier, writesBefore);
    },
    TIMEOUT,
  );

  it(
    "saves the log into the file that is chosen in the dialog of the host, the text the tab shows and no other, and writes nothing to the cluster for it",
    async () => {
      const running = application();
      const keyboard = running.window.keyboard;
      const id = (part?: artifacts.PanelPart) => artifacts.PARTS.panel("backup", "log", part);
      const { directory, file } = savedInto();

      // The dialog of the host answers the file of the suite, in the profile of this run, and is not shown.
      await mkdir(directory, { recursive: true });
      await velero.replaceSaveDialog(running.app, file);
      const loaded = await toTheSave();
      const asked = (await velero.saveDialogCalls(running.app)).length;
      const earlier = cluster.requestCodes(RESOURCE);
      const writesBefore = cluster.writes(cluster.apiRequests());

      await artifacts.clickOn(frame, id("save"));
      await artifacts.attributeLike(frame, id("saving"), "data-saving", "saved");
      expect(await artifacts.said(frame, id("saving"))).toBe(artifacts.WORDS.saved("log"));
      expectAsked((await velero.saveDialogCalls(running.app)).slice(asked));
      // The file is where the suite chose, and no other is: it is kept for the cases that count in it.
      expect(await readdir(directory)).toEqual([path.basename(file)]);
      const lines = artifacts.linesOf(await readFile(file, "utf8"));

      saved = { file, lines };
      // It is the text the tab holds: its bytes, its lines, the first and the last of them.
      expect((await stat(file)).size).toBe(loaded.size);
      expect(lines.length).toBe((await artifacts.logShown(frame, "backup")).lines);
      expect(lines.length).toBeGreaterThan(0);
      await (await artifacts.part(frame, artifacts.PARTS.viewer("backup", "log", "text"))).focus();
      await keyboard.press("Home");
      expect(await artifacts.lineShown(frame, "backup", "log", 1)).toEqual({ text: lines[0], cut: false });
      await keyboard.press("End");
      expect(await artifacts.lineShown(frame, "backup", "log", lines.length)).toEqual({
        text: lines[lines.length - 1],
        cut: false,
      });
      await keyboard.press("Home");
      await expectNoWrite(earlier, writesBefore);
    },
    TIMEOUT,
  );

  it(
    "clears the search of the log with Escape in its field and lets go of nothing: the view stays open at its tab, and its text is saved once more",
    async () => {
      const running = application();
      const id = (part?: artifacts.PanelPart) => artifacts.PARTS.panel("backup", "log", part);
      const search = artifacts.PARTS.viewer("backup", "log", "search");
      const { directory } = savedInto();
      const again = path.join(directory, "the-log-of-the-backup-after-escape.txt");
      const loaded = await toTheSave();

      await artifacts.searchLog(frame, "backup", NAMES.backup);
      await (await artifacts.part(frame, search)).press("Escape");
      const cleared = await artifacts.logLike(
        frame,
        "backup",
        "has its search cleared",
        (shown) => shown.search.words === "" && shown.search.field === "",
      );
      const state = await artifacts.panelState(frame, "backup", "log");

      // The key was of the field: it cleared the words, and the field keeps the keyboard.
      expect(cleared.search.said).toBe("");
      expect(await cluster.focusOn(frame, search)).toBe(search);
      // The view of the backup was not left: it is at its tab, with the text that was loaded.
      expect((await artifacts.tabsOf(frame, "backup")).open).toBe("log");
      expect([state.step, state.shown]).toEqual(["loaded", loaded.request]);
      expect(state.commands).toContain(id("save"));
      // And the main process still holds its copy of the text, which is what a saving writes. The tab may
      // say already, of the saving before this one, that the text was saved: this saving is waited for by
      // its file, which is another one.
      await mkdir(directory, { recursive: true });
      await velero.replaceSaveDialog(running.app, again);
      await artifacts.clickOn(frame, id("save"));
      await artifacts.until(
        `The log is saved once more, into a file of ${loaded.size} bytes`,
        async () => (await stat(again).catch(() => undefined))?.size ?? "no file",
        (size) => size === loaded.size,
      );
      await artifacts.attributeLike(frame, id("saving"), "data-saving", "saved");
    },
    TIMEOUT,
  );

  it(
    "cancels a load as soon as it begins, and says how it ended, with the command that asks again and no text",
    async () => {
      const id = (part?: artifacts.PanelPart) => artifacts.PARTS.panel("backup", "results", part);

      // The results of the backup, which no case asked for yet.
      await stay("backup", "results");
      await writesOn();
      const earlier = cluster.requestCodes(RESOURCE);

      await artifacts.ask(frame, "backup", "results");
      // The command that cancels is given inside the page, the moment the panel offers it. The request the
      // load ran is the one the panel named when the load began: when it was created before the cancel
      // reached it, it is in the cluster, and the guard was told.
      const {
        ended,
        moments,
        request: named,
      } = await artifacts.runLoad(frame, "backup", "results", told, { cancel: true });

      if (ended === "loaded") {
        throw new Error("The load ended with its text before the cancel reached it: nothing was cancelled");
      }
      const failure = await artifacts.failureOf(frame, "backup", "results");
      const created = ledger.asked().includes(named);

      await report("artifact-load-cancelled", { failure, created, moments });
      expect(named.startsWith(`${NAMES.backup}-`)).toBe(true);
      expect(failure.code).toBe("cancelled");
      expect(moments.some((moment) => moment.status === artifacts.WORDS.cancelling)).toBe(true);
      // How it ended is said by the step it was stopped at: before anything was created, while the request
      // was created, or after it was in the cluster, where it stays.
      if (artifacts.BEFORE_THE_CREATION.includes(failure.stage)) {
        expect([failure.stage, failure.text, created]).toEqual([failure.stage, artifacts.WORDS.cancelledBefore, false]);
      } else if (failure.stage === "creation") {
        expect([failure.stage, failure.text]).toEqual([
          failure.stage,
          expect.stringMatching(/^The request was cancelled while it was created: /),
        ]);
      } else {
        expect([failure.stage, artifacts.AFTER_THE_CREATION.includes(failure.stage), created]).toEqual([
          failure.stage,
          true,
          true,
        ]);
        expect([failure.stage, failure.text]).toEqual([
          failure.stage,
          expect.stringMatching(/^The download was cancelled\. /),
        ]);
      }
      expect(since(earlier)["POST 201"] ?? 0).toBe(created ? 1 : 0);
      // The tab holds no text, and offers the command that asks again, which has the focus.
      const state = await artifacts.panelState(frame, "backup", "results");

      expect([state.step, state.viewer, state.commands]).toEqual(["failed", false, [id("create")]]);
      // A load that ended before anything was created left no request: the one that is asked is no other.
      const another = !artifacts.BEFORE_THE_CREATION.includes(failure.stage);

      expect([failure.stage, await artifacts.said(frame, id("what"))]).toEqual([
        failure.stage,
        artifacts.WORDS.askAgain(NAMESPACE, another),
      ]);
      expect([failure.stage, await artifacts.said(frame, id("create"))]).toEqual([
        failure.stage,
        artifacts.WORDS.command("backup", "results", another),
      ]);
      // What the operator asked for is said, and is not drawn as a fault.
      expect(await artifacts.attribute(frame, id("failure"), "data-ended")).toBe("cancelled");
      expect(await cluster.focusOn(frame, id("create"))).toBe(id("create"));
      expect(await cluster.layoutProblems(frame)).toEqual([]);
      await cluster.captureScreenshot(frame, "dark-artifact-cancelled");
    },
    TIMEOUT,
  );

  it(
    "leaves pictures of the first state and of the confirmation of a tab in the light theme, and creates nothing for them",
    async () => {
      const running = application();
      const earlier = cluster.requestCodes(RESOURCE);

      await velero.setColorTheme(running.app, running.window, "Light");
      const expected = { theme: "light", width: 1440, height: 900 };

      expect(await cluster.appliedLike(frame, expected)).toEqual(expected);
      // The tab of the volumes of the backup is one that loaded nothing yet: it is at its first state.
      await stay("backup", "volumes");
      await writesOn();
      expect((await artifacts.panelState(frame, "backup", "volumes")).step).toBe("first");
      await layout("light-artifact-first", "backup", "volumes");
      await picture("first");
      await artifacts.ask(frame, "backup", "volumes");
      await layout("light-artifact-confirmation", "backup", "volumes");
      await picture("confirmation");
      await artifacts.clickOn(frame, artifacts.PARTS.panel("backup", "volumes", "confirmBack"));
      await artifacts.gone(frame, artifacts.PARTS.panel("backup", "volumes", "confirm"));
      expect(askedSince(earlier)).toEqual({});
    },
    TIMEOUT,
  );

  it(
    "loads the results of the backup of the demo through a request of its own, and counts in them what the status of the backup counts",
    async () => {
      // The results are asked again after the load that was cancelled, or for the first time.
      await stay("backup", "results");
      await writesOn();
      await loadOf("backup", "results");
      await expectResults("backup");
      expect(await cluster.layoutProblems(frame)).toEqual([]);
    },
    TIMEOUT,
  );

  it(
    "loads the resource list of the backup of the demo through a request of its own, with no action of a restore, and narrows it by the words of its filter",
    async () => {
      await stay("backup", "resources");
      await writesOn();
      await loadOf("backup", "resources");
      const list = await artifacts.resourcesLike(
        frame,
        "backup",
        "shows its first rows",
        (shown) => shown.rows.length > 0,
      );

      // A backup has no action: no column, and no choice.
      expect(list.columns).toEqual(["namespace", "name"]);
      expect(list.actions).toBeUndefined();
      expect(list.rows.filter((row) => "item" in row && row.action !== undefined)).toEqual([]);
      // The items of the list are the ones the backup counted when its work ended.
      expect(list.items).toBe(read("backup").status?.progress?.itemsBackedUp);
      expect(list.items).toBeGreaterThan(0);
      expect([list.leftItems, list.leftResources, list.said]).toEqual([
        list.items,
        list.resources,
        artifacts.WORDS.resources(list.items, list.resources),
      ]);
      expectRows("backup", list.rows);
      // The filter narrows the list: the resource of the first row leaves its items, and words no item
      // carries leave none, which is said.
      const first = list.rows[0];
      const filter = await artifacts.part(frame, artifacts.PARTS.viewer("backup", "resources", "filter"));

      if (!("resource" in first)) throw new Error("The first row of the resource list is not a resource");
      await filter.fill(first.resource);
      const narrowed = await artifacts.resourcesLike(
        frame,
        "backup",
        `is filtered by ${first.resource}`,
        (shown) => shown.filter === first.resource && shown.rows.length > 0,
      );

      expect(narrowed.leftItems).toBeGreaterThanOrEqual(first.count);
      expect(narrowed.leftItems).toBeLessThanOrEqual(list.items);
      expect(narrowed.said).toBe(
        artifacts.WORDS.resourcesLeft(narrowed.leftItems, list.items, narrowed.leftResources, list.resources),
      );
      await filter.fill(`no-item-of-${RUN}-carries-this`);
      const none = await artifacts.resourcesLike(
        frame,
        "backup",
        "is filtered to nothing",
        (shown) => shown.leftItems === 0,
      );

      expect([none.said, none.rows, none.columns]).toEqual([artifacts.WORDS.noneOfTheWords(list.items), [], []]);
      // Escape in the field clears it, and the view is not left: its texts would go with it.
      await filter.press("Escape");
      const cleared = await artifacts.resourcesLike(
        frame,
        "backup",
        "has its filter cleared",
        (shown) => shown.filter === "" && shown.leftItems === list.items,
      );

      expect(cleared.said).toBe(artifacts.WORDS.resources(list.items, list.resources));
      expect((await artifacts.tabsOf(frame, "backup")).open).toBe("resources");
      expect(await cluster.layoutProblems(frame)).toEqual([]);
    },
    TIMEOUT,
  );

  it(
    "loads the volume information of the backup of the demo, which is of no volume, and says that Velero recorded none",
    async () => {
      await stay("backup", "volumes");
      await writesOn();
      await loadOf("backup", "volumes");
      expect(await artifacts.volumesShown(frame, "backup")).toEqual({
        count: 0,
        said: artifacts.WORDS.volumes("backup", 0),
        of: "",
        columns: [],
        rows: [],
        titles: [],
      });
      // The words that say so are where the keyboard is after the load.
      const none = artifacts.PARTS.viewer("backup", "volumes", "none");

      expect(await cluster.focusOn(frame, none)).toBe(none);
    },
    TIMEOUT,
  );

  it(
    "leaves pictures of the four tabs of the backup, loaded, in both themes, and no page a tab was shown on is wider than its room, taller than what holds it, or cut",
    async () => {
      const running = application();
      const unloaded: string[] = [];

      await stay("backup", "summary");
      for (const theme of ["Light", "Dark"] as const) {
        const expected = { theme: theme.toLowerCase(), width: 1440, height: 900 };

        if ((await cluster.applied(frame)).theme !== expected.theme) {
          await velero.setColorTheme(running.app, running.window, theme);
        }
        expect([theme, await cluster.appliedLike(frame, expected)]).toEqual([theme, expected]);
        for (const tab of artifacts.ARTIFACT_TABS) {
          await artifacts.openTab(frame, "backup", tab);
          const state = await artifacts.panelState(frame, "backup", tab);

          // A tab that does not show what it loaded is said after the pictures of the others were taken.
          if (state.step !== "loaded" || !state.viewer || state.shown !== loads[of("backup", tab)]?.request) {
            unloaded.push(`${expected.theme}: the tab ${tab} is at ${state.step}`);
            continue;
          }
          await artifacts.part(frame, artifacts.PARTS.viewer("backup", tab));
          await frame.waitForTimeout(500);
          await layout(`${expected.theme}-artifact-${tab}`, "backup", tab);
          await picture(tab);
        }
      }
      await report("artifact-layout", { pages: problems, tabs: tabProblems });
      expect(unloaded).toEqual([]);
      expect(Object.fromEntries(Object.entries(problems).filter(([, found]) => found.length > 0))).toEqual({});
      // The pictures of the review that are taken whenever the suite runs are there: the first state, the
      // confirmation and the four tabs loaded, in each theme. The one of a load while it runs is of the case
      // after this one.
      const taken = Object.keys(pictures).filter((name) => !name.endsWith(`-${LOADING}`));

      expect(taken.sort()).toEqual(
        ["dark", "light"].flatMap((theme) => PICTURED.map((name) => `${theme}-artifact-${name}`)).sort(),
      );
      for (const name of taken) expect([name, (await stat(pictures[name])).size > 0]).toEqual([name, true]);
    },
    TIMEOUT,
  );

  it(
    "shows no part of a tab over the part beside it, and no panel and no viewer wider than its room, in any tab that was looked at",
    async () => {
      // The check of a page knows no part of a tab. This one was asked of every tab the cases before this
      // one looked at: the tabs of the strip, the parts of the panel and its commands, the parts of the
      // viewer, the bar of the log with its search and its levels, the filter of the resources with its
      // choices by action, and the head of its table.
      expect(Object.keys(tabProblems).length).toBeGreaterThan(0);
      expect(Object.fromEntries(Object.entries(tabProblems).filter(([, found]) => found.length > 0))).toEqual({});
    },
    TIMEOUT,
  );

  it(
    "leaves a picture of a load while it runs, in each theme",
    async () => {
      // The review looks at a load while it runs, in each theme. A picture is asked at each load of the
      // suite, six in the dark theme and three in the light one, and is kept only when the load ran before
      // it was asked and after it was taken: the loads of the demo are of small files, and one can end
      // while it is pictured. A theme that is said here had every load end too soon for its picture, which
      // says nothing of the tabs: the load that is long enough to be looked at is the one of the large log.
      const names = ["dark", "light"].map((theme) => `${theme}-artifact-${LOADING}`);

      expect(
        names.filter((name) => !pictures[name]).map((name) => `${name}: not taken, in ${pictured[name] ?? 0} loads`),
      ).toEqual([]);
      for (const name of names) expect([name, (await stat(pictures[name])).size > 0]).toEqual([name, true]);
    },
    TIMEOUT,
  );

  it(
    "shows the four tabs of the backup, loaded, in a view that has the room of a list at 900 by 650 and at twice the zoom, in both themes: no list is taller than the room it is read in, a list that fits at 1440 by 900 is whole without a scroll of the view, and the confirmation keeps its commands in that room",
    async () => {
      const running = application();
      const earlier = cluster.requestCodes(RESOURCE);
      const id = (part?: artifacts.PanelPart) => artifacts.PARTS.panel("backup", "volumes", part);
      const sizes = [
        { name: "900x650", width: 900, height: 650, zoom: 1 },
        { name: "zoom-200", width: 1440, height: 900, zoom: 2 },
      ];
      const unloaded: string[] = [];
      const found: Record<string, string[]> = {};
      const rooms: Record<string, artifacts.TabRoom> = {};
      const unseen: Record<string, string[]> = {};
      // The lists that are not whole in the room of their view once they are brought into it.
      const cut: string[] = [];
      // A tab of the backup as it was loaded, with what the two checks of the layout find of it and the
      // room it is read in, kept by a name. The pointer is parked in a corner first: what it rests on is
      // drawn as pointed at, and is no state of the tab. A page that is scrolled, as one is at twice the
      // zoom, is looked at from its top, where its target bar is, and its tab from its end, where the
      // view is whole: that is where it is left for the picture.
      const look = async (name: string, tab: artifacts.ArtifactTab) => {
        await artifacts.openTab(frame, "backup", tab);
        const state = await artifacts.panelState(frame, "backup", tab);

        if (state.step !== "loaded" || !state.viewer || state.shown !== loads[of("backup", tab)]?.request) {
          unloaded.push(`${name}: the tab ${tab} is at ${state.step}`);
          return false;
        }
        await running.window.mouse.move(1, 1);
        await artifacts.scrollPage(frame, "backup", "top");
        await frame.waitForTimeout(500);
        const page = await cluster.layoutProblems(frame);

        await artifacts.scrollPage(frame, "backup", "end");
        found[name] = [...page, ...(await artifacts.tabLayoutProblems(frame, "backup", tab))];
        rooms[name] = await artifacts.tabRoom(frame, "backup", tab);
        // The list of the tab is brought into the room of the view, where the picture finds it: it is
        // whole there, at whatever size.
        if ((await artifacts.listInSight(frame, "backup", tab)) === false) cut.push(name);
        await artifacts.scrollPage(frame, "backup", "end");
        return true;
      };

      await stay("backup", "summary");
      await writesOn();
      try {
        // At 1440 by 900 the room of the view holds a list with what is over it and under it: the list
        // takes what the room leaves, and the view is not scrolled beside it.
        for (const tab of ["log", "resources"] as const) await look(`dark-1440x900-${tab}`, tab);
        for (const theme of ["Light", "Dark"] as const) {
          if ((await cluster.applied(frame)).theme !== theme.toLowerCase()) {
            await velero.setColorTheme(running.app, running.window, theme);
          }
          for (const size of sizes) {
            const expected = {
              theme: theme.toLowerCase(),
              width: Math.round(size.width / size.zoom),
              height: Math.round(size.height / size.zoom),
            };
            const named = (what: string) => `${expected.theme}-artifact-${what}-${size.name}`;

            await velero.setWindowSize(running.app, size.width, size.height);
            await velero.setZoom(running.app, size.zoom);
            expect([theme, size.name, await cluster.appliedLike(frame, expected)]).toEqual([
              theme,
              size.name,
              expected,
            ]);
            for (const tab of artifacts.ARTIFACT_TABS) {
              if (await look(named(tab), tab)) await cluster.captureScreenshot(frame, named(tab), size.zoom);
            }
            // The confirmation of a load again, over a text that is shown: its two commands are in the
            // room of the view with it, whatever the room is tall. It is left, and nothing is created.
            await artifacts.ask(frame, "backup", "volumes");
            await cluster.focusOn(frame, id("confirm"));
            await running.window.mouse.move(1, 1);
            await artifacts.scrollPage(frame, "backup", "end");
            await frame.waitForTimeout(500);
            unseen[named("confirmation")] = await artifacts.outOfTheRoom(frame, "backup", [
              id("confirmCreate"),
              id("confirmBack"),
            ]);
            found[named("confirmation")] = await artifacts.tabLayoutProblems(frame, "backup", "volumes");
            await cluster.captureScreenshot(frame, named("confirmation"), size.zoom);
            await artifacts.clickOn(frame, id("confirmBack"));
            await artifacts.gone(frame, id("confirm"));
          }
        }
      } finally {
        // The cases after this one are looked at in the window they expect, whatever this one found.
        await velero.setZoom(running.app, 1).catch(() => undefined);
        await velero.setWindowSize(running.app, 1440, 900).catch(() => undefined);
        await cluster.appliedLike(frame, { theme: "dark", width: 1440, height: 900 }).catch(() => undefined);
      }
      await report("artifact-sizes", { rooms, found, unseen, cut });
      expect(unloaded).toEqual([]);
      expect(cut).toEqual([]);
      expect(Object.fromEntries(Object.entries(found).filter(([, problems]) => problems.length > 0))).toEqual({});
      expect(Object.fromEntries(Object.entries(unseen).filter(([, parts]) => parts.length > 0))).toEqual({});
      // Where the room holds the list and what is around it, the view holds no more than its room: the
      // list is whole in it, with one scrollbar, its own.
      for (const tab of ["log", "resources"] as const) {
        const room = rooms[`dark-1440x900-${tab}`];

        expect([tab, room?.list !== undefined, (room?.holds ?? 0) - (room?.room ?? 0) <= 1]).toEqual([tab, true, true]);
      }
      // Nothing of this asked the cluster for anything.
      expect(askedSince(earlier)).toEqual({});
    },
    TIMEOUT,
  );

  it(
    "shows the log of the backup as lines numbered from one, every line of it, each of one level or of none, with no search, no level chosen and its lines not wrapped",
    async () => {
      const first = await freshLog();

      expect(first.lines).toBeGreaterThan(0);
      expect([first.shown, first.rows]).toEqual([first.lines, first.lines]);
      expect(first.count).toBe(artifacts.WORDS.lines(first.lines, first.lines));
      expect(first.mounted).toEqual(first.mounted.map((_line, at) => at + 1));
      expect(first.numbers).toEqual(first.mounted.map(String));
      expect([first.wrap, first.search.words, first.search.said]).toEqual([false, "", ""]);
      expect(artifacts.LOG_LEVELS.filter((level) => first.levels[level].chosen)).toEqual([]);
      expect(artifacts.LOG_LEVELS.reduce((sum, level) => sum + first.levels[level].count, 0)).toBe(first.lines);
      expect(await cluster.layoutProblems(frame)).toEqual([]);
    },
    TIMEOUT,
  );

  it(
    "mounts a hundred rows of the log at most: at its first line, at its last, and with its lines wrapped",
    async () => {
      const keyboard = application().window.keyboard;
      const first = await freshLog();
      const enough = "the log of the backup of the demo has more lines than a list mounts";

      // The bound is proven on a log that has more lines than it: a log that has fewer mounts every line,
      // whatever its list does, and would say nothing of the bound.
      expect([enough, first.lines > ROWS_BOUND]).toEqual([enough, true]);
      expect(first.mounted.length).toBeLessThanOrEqual(ROWS_BOUND);
      await toTheList();
      await keyboard.press("End");
      const last = await artifacts.logLike(frame, "backup", "is at its last line", (shown) =>
        shown.mounted.includes(first.lines),
      );

      expect(last.mounted.length).toBeLessThanOrEqual(ROWS_BOUND);
      await artifacts.clickOn(frame, logPart("wrap"));
      const wrapped = await artifacts.logLike(
        frame,
        "backup",
        "wraps its lines",
        (shown) => shown.wrap && shown.columns !== undefined && shown.mounted.length > 0,
      );

      expect(wrapped.mounted.length).toBeLessThanOrEqual(ROWS_BOUND);
    },
    TIMEOUT,
  );

  it(
    "counts the lines of each level of the log as the file that was saved has them, and a level that is chosen leaves the lines of the file that are of it, by their numbers",
    async () => {
      const lines = savedLines();
      const first = await freshLog();
      // The suite reads the level of each line of the file by itself, as an operator would.
      const counts = Object.fromEntries(
        artifacts.LOG_LEVELS.map((level) => [level, lines.filter((line) => artifacts.levelOf(line) === level).length]),
      );

      expect(Object.fromEntries(artifacts.LOG_LEVELS.map((level) => [level, first.levels[level].count]))).toEqual(
        counts,
      );
      // The level most lines of the file are of: its lines are shown from the first of them.
      const level = [...artifacts.LOG_LEVELS].sort((one, other) => counts[other] - counts[one])[0];
      const ofTheLevel = lines.flatMap((line, index) => (artifacts.levelOf(line) === level ? [index + 1] : []));

      await artifacts.clickOn(frame, artifacts.PARTS.level("backup", level));
      const filtered = await artifacts.logLike(
        frame,
        "backup",
        `shows the lines of the level ${level}`,
        (shown) => shown.levels[level].chosen && shown.shown === counts[level] && shown.mounted.length > 0,
      );

      expect(filtered.mounted).toEqual(ofTheLevel.slice(0, filtered.mounted.length));
    },
    TIMEOUT,
  );

  it(
    "searches the log by the name of the backup and moves among the matches with Enter and with Shift and Enter, around both ends, with the row of the match marked",
    async () => {
      const first = await freshLog();
      const field = await artifacts.part(frame, logPart("search"));
      const searched = await artifacts.searchLog(frame, "backup", NAMES.backup);
      const matches = searched.search.matches;
      // The match the search is at: its place among the matches, its line, the one row that is marked,
      // which is the row of that line, and the words that say so. It answers the line.
      const at = async (match: number, after: string) => {
        const shown = await artifacts.logLike(
          frame,
          "backup",
          `is at match ${match + 1} of ${matches}, with the row of its line marked, ${after}`,
          (log) =>
            log.search.match === match &&
            log.search.line !== undefined &&
            log.marked.length === 1 &&
            log.marked[0] === log.search.line,
        );
        const line = shown.search.line ?? 0;

        expect([after, shown.search.matches, shown.search.said]).toEqual([
          after,
          matches,
          artifacts.WORDS.match(match, matches, line),
        ]);
        return line;
      };

      // Every entry of the log of a backup carries the name of the backup: more lines than one carry it.
      expect(matches).toBeGreaterThan(1);
      const one = await at(0, "after the words were typed");

      // Shift with Enter goes to the match before, around the start, and Enter to the next, around the end.
      await field.press("Shift+Enter");
      const last = await at(matches - 1, "after Shift with Enter on the first match");

      await field.press("Enter");
      expect(await at(0, "after Enter on the last match")).toBe(one);
      await field.press("Enter");
      const two = await at(1, "after Enter on the first match");

      // The second match, with the keyboard in the field and not on its row: a picture of it for the
      // review, in both themes. The pointer is parked in a corner: what it rests on is drawn as pointed at.
      await application().window.mouse.move(1, 1);
      await cluster.captureScreenshot(frame, "dark-artifact-log-search");
      await velero.setColorTheme(application().app, application().window, "Light");
      expect((await cluster.appliedLike(frame, { theme: "light", width: 1440, height: 900 })).theme).toBe("light");
      expect(await at(1, "in the light theme")).toBe(two);
      await cluster.captureScreenshot(frame, "light-artifact-log-search");
      await velero.setColorTheme(application().app, application().window, "Dark");
      expect((await cluster.appliedLike(frame, { theme: "dark", width: 1440, height: 900 })).theme).toBe("dark");
      await field.press("Shift+Enter");
      expect(await at(0, "after Shift with Enter on the second match")).toBe(one);
      // A match is a line, and the matches are in the order of their lines.
      expect([one < two, two <= last]).toEqual([true, true]);
      // The field keeps the keyboard, and no line is hidden by a search.
      expect(await cluster.focusOn(frame, logPart("search"))).toBe(logPart("search"));
      expect((await artifacts.logShown(frame, "backup")).shown).toBe(first.lines);
      // Words no line carries: no match, said so, and nowhere to move to.
      const none = await artifacts.searchLog(frame, "backup", `no-line-of-${RUN}-carries-this`);

      expect([none.search.matches, none.search.match, none.search.line, none.search.said, none.marked]).toEqual([
        0,
        -1,
        undefined,
        artifacts.WORDS.noMatch(),
        [],
      ]);
      expect(await (await artifacts.part(frame, logPart("searchNext"))).isDisabled()).toBe(true);
      expect(await (await artifacts.part(frame, logPart("searchPrevious"))).isDisabled()).toBe(true);
    },
    TIMEOUT,
  );

  it(
    "counts as the matches of a search the lines of the file that was saved that carry the words, whatever their capitals",
    async () => {
      const lines = savedLines();

      await freshLog();
      const found = artifacts.matchingLines(lines, NAMES.backup);
      const named = await artifacts.searchLog(frame, "backup", NAMES.backup);

      // The search is at the first of the lines that carry the words.
      expect([named.search.matches, named.search.line]).toEqual([found.length, found[0]]);
      // The words are marked in the rows that are mounted of the lines that carry them, as the file
      // writes them, and in no other row.
      expect(named.found).toEqual(named.mounted.filter((line) => found.includes(line)));
      expect(named.found.length).toBeGreaterThan(0);
      expect(named.foundWords).toEqual([NAMES.backup]);
      // The capitals of the words do not matter: a line the release writes in the log of a backup.
      const total = artifacts.matchingLines(lines, "backed up a total of");
      const capitals = await artifacts.searchLog(frame, "backup", "BACKED UP A TOTAL OF");

      expect(total.length).toBeGreaterThan(0);
      expect(capitals.search.matches).toBe(total.length);
      expect(total).toContain(capitals.search.line);
      // The words are marked in the capitals of the file, not in the ones that were typed.
      const marked = await artifacts.logLike(
        frame,
        "backup",
        "marks the words in the row of the match it is at",
        (shown) => shown.search.line !== undefined && shown.found.includes(shown.search.line),
      );

      expect(marked.found).toEqual(marked.mounted.filter((line) => total.includes(line)));
      expect(marked.foundWords.map((words) => words.toLowerCase())).toEqual(["backed up a total of"]);
    },
    TIMEOUT,
  );

  it(
    "leaves the lines of a level that is chosen, as many as its choice counts, hides none once the level is left, and says of a level no line is of that it leaves none",
    async () => {
      const first = await freshLog();
      const counts = Object.fromEntries(artifacts.LOG_LEVELS.map((level) => [level, first.levels[level].count]));
      // The level most lines are of.
      const level = [...artifacts.LOG_LEVELS].sort((one, other) => counts[other] - counts[one])[0];

      await artifacts.clickOn(frame, artifacts.PARTS.level("backup", level));
      const filtered = await artifacts.logLike(
        frame,
        "backup",
        `shows the lines of the level ${level}`,
        (shown) => shown.levels[level].chosen && shown.shown === counts[level] && shown.mounted.length > 0,
      );

      expect(filtered.count).toBe(artifacts.WORDS.lines(counts[level], first.lines));
      // A picture of a level that is chosen, for the review: the choice says that it is made by more than
      // a color. The pointer is parked in a corner: what it rests on is drawn as pointed at.
      await application().window.mouse.move(1, 1);
      await cluster.captureScreenshot(frame, "dark-artifact-log-level");
      // The lines keep the numbers they have in the log, each once and in their order.
      expect(filtered.mounted).toEqual([...new Set(filtered.mounted)].sort((one, other) => one - other));
      // A level that is chosen changes what no choice counts.
      expect(artifacts.LOG_LEVELS.map((each) => filtered.levels[each].count)).toEqual(
        artifacts.LOG_LEVELS.map((each) => counts[each]),
      );
      await artifacts.clickOn(frame, artifacts.PARTS.level("backup", level));
      await artifacts.logLike(
        frame,
        "backup",
        "hides no line again",
        (shown) => !shown.levels[level].chosen && shown.shown === first.lines,
      );
      // A level no line is of leaves none, which is said in the place of the list.
      const empty = artifacts.LOG_LEVELS.find((each) => counts[each] === 0);

      if (!empty) {
        console.log("Every level has a line in the log of the backup: a level that leaves none was not looked at");
        return;
      }
      await artifacts.clickOn(frame, artifacts.PARTS.level("backup", empty));
      const nothing = await artifacts.logLike(
        frame,
        "backup",
        `shows no line of the level ${empty}`,
        (shown) => shown.levels[empty].chosen && shown.shown === 0,
      );

      expect([empty, nothing.none, nothing.mounted]).toEqual([empty, artifacts.WORDS.noLineOfTheLevels, []]);
      await artifacts.clickOn(frame, artifacts.PARTS.level("backup", empty));
      await artifacts.logLike(frame, "backup", "hides no line again", (shown) => shown.shown === first.lines);
    },
    TIMEOUT,
  );

  it(
    "wraps the lines of the log at the columns of its room when it is asked to, hiding none, and shows each on one line again when it is asked again",
    async () => {
      const first = await freshLog();

      await artifacts.clickOn(frame, logPart("wrap"));
      const wrapped = await artifacts.logLike(
        frame,
        "backup",
        "wraps its lines",
        (shown) => shown.wrap && shown.columns !== undefined && shown.mounted.length > 0,
      );

      expect(wrapped.columns).toBeGreaterThanOrEqual(20);
      expect([wrapped.shown, wrapped.mounted[0]]).toEqual([first.lines, 1]);
      expect(await cluster.layoutProblems(frame)).toEqual([]);
      expect(await artifacts.tabLayoutProblems(frame, "backup", "log")).toEqual([]);
      // The lines as they are wrapped, with the choice that says so, for the review, in both themes: the
      // choice stays made through the change of the theme. The pointer is parked in a corner.
      await application().window.mouse.move(1, 1);
      await cluster.captureScreenshot(frame, "dark-artifact-log-wrapped");
      await velero.setColorTheme(application().app, application().window, "Light");
      try {
        expect((await cluster.appliedLike(frame, { theme: "light", width: 1440, height: 900 })).theme).toBe("light");
        await artifacts.logLike(
          frame,
          "backup",
          "keeps its lines wrapped in the light theme",
          (shown) => shown.wrap && shown.columns !== undefined && shown.mounted.length > 0,
        );
        await cluster.captureScreenshot(frame, "light-artifact-log-wrapped");
      } finally {
        await velero.setColorTheme(application().app, application().window, "Dark");
      }
      expect((await cluster.appliedLike(frame, { theme: "dark", width: 1440, height: 900 })).theme).toBe("dark");
      await artifacts.clickOn(frame, logPart("wrap"));
      const plain = await artifacts.logLike(
        frame,
        "backup",
        "does not wrap its lines again",
        (shown) => !shown.wrap && shown.columns === undefined,
      );

      expect(plain.shown).toBe(first.lines);
    },
    TIMEOUT,
  );

  it(
    "copies a line of the log whole with the command of its row, and says so",
    async () => {
      const running = application();
      const focused = () => frame.evaluate(() => document.hasFocus());

      await freshLog();
      // The line as its row shows it, which is the whole of a line that is not cut.
      const line = await artifacts.lineShown(frame, "backup", "log", 1);

      if (line.cut) throw new Error("The first line of the log is cut in its row: the case does not know it whole");
      // The clipboard is the one of the machine: the text it holds is put back when the case ends, whatever
      // the case found. What another program copies while the case reads it is read in its place.
      const held = await running.app.evaluate(({ clipboard }) => clipboard.readText());

      try {
        // The browser gives the clipboard to no page that does not have the focus, whatever the page does:
        // a copy that is refused for that says nothing of the command. The list is given the focus, the
        // window is asked for it when that was not enough, and a frame still without it is said by name.
        await toTheList();
        if (!(await focused())) {
          await running.app.evaluate(({ BrowserWindow }) => {
            for (const window of BrowserWindow.getAllWindows()) {
              if (window.isVisible()) window.focus();
            }
          });
          await toTheList();
        }
        if (!(await focused())) {
          throw new Error(
            "The frame of the cluster does not have the focus, with its list focused and its window asked for it: " +
              "the browser refuses the clipboard to it, and the copy of a line was not looked at",
          );
        }
        await artifacts.clickOn(frame, artifacts.PARTS.line("backup", "log", 1, "copy"));
        expect(
          await artifacts.until(
            "The copy of the first line is said",
            () => artifacts.said(frame, logPart("copied")),
            (words) => words !== "",
          ),
        ).toBe(artifacts.WORDS.copied(1, line.text.length));
        expect(await running.app.evaluate(({ clipboard }) => clipboard.readText())).toBe(line.text);
      } finally {
        await running.app.evaluate(({ clipboard }, text) => clipboard.writeText(text), held).catch(() => undefined);
      }
    },
    TIMEOUT,
  );

  it(
    "moves among the tabs with the arrows, Home and End, around both ends, chooses a tab with Enter and with Space, and scrolls nothing for Space",
    async () => {
      const running = application();
      const keyboard = running.window.keyboard;
      const earlier = cluster.requestCodes(RESOURCE);
      const loaded = loads[of("backup", "log")];
      const tab = (name: artifacts.WorkspaceTab) => artifacts.PARTS.tab("backup", name);
      // Where the keyboard is after a key.
      const after = async (key: string) => {
        await keyboard.press(key);
        return cluster.focused(frame);
      };
      const shown = async () => (await artifacts.tabsOf(frame, "backup")).open;
      // The view of the backup is what is scrolled when it holds more than its room.
      const view = () =>
        frame.evaluate((id) => {
          const part = document.querySelector<HTMLElement>(`[data-testid="${id}"]`);

          if (!part) throw new Error(`The part ${id} is not in the page`);
          return { scrolled: part.scrollTop, holds: part.scrollHeight, room: part.clientHeight };
        }, artifacts.PARTS.workspace("backup"));
      const more = "the view of the log holds more under what its room shows";

      // The log is shown in a window of 900 by 650, where its view holds more than its room shows: that
      // is what the browser would scroll by a page for Space on something that is no command. The host
      // leaves the key to it: the tabs take it, and the view stays where it is. At 1440 by 900 the view of
      // a log holds what its room shows, and the key would have nothing to scroll.
      const { theme } = await cluster.applied(frame);

      await velero.setWindowSize(running.app, 900, 650);
      try {
        const narrow = { theme, width: 900, height: 650 };

        expect(await cluster.appliedLike(frame, narrow)).toEqual(narrow);
        await freshLog();
        await (await artifacts.part(frame, tab("log"))).focus();
        const before = await view();

        expect([more, before.holds - before.room - before.scrolled > 1]).toEqual([more, true]);
        expect(await after("Space")).toBe(tab("log"));
        await frame.waitForTimeout(NOTHING);
        expect([await shown(), (await view()).scrolled]).toEqual(["log", before.scrolled]);
      } finally {
        await velero.setWindowSize(running.app, 1440, 900).catch(() => undefined);
        await cluster.appliedLike(frame, { theme, width: 1440, height: 900 }).catch(() => undefined);
      }
      await (await artifacts.part(frame, tab("log"))).focus();
      // The arrows move the keyboard among the tabs and choose none of them: the tab that is open stays.
      expect(await after("ArrowRight")).toBe(tab("results"));
      // A picture of the tab the keyboard is on, beside the one that is open, for the review.
      await running.window.mouse.move(1, 1);
      await cluster.captureScreenshot(frame, "dark-artifact-tab-focus");
      expect(await after("ArrowRight")).toBe(tab("resources"));
      expect(await after("ArrowLeft")).toBe(tab("results"));
      expect(await shown()).toBe("log");
      // Space chooses the tab the keyboard is on, which keeps the keyboard and says that it is selected.
      expect(await after("Space")).toBe(tab("results"));
      await artifacts.attributeLike(frame, artifacts.PARTS.shown("backup"), "data-tab", "results");
      expect((await artifacts.tabsOf(frame, "backup")).selected).toEqual([tab("results")]);
      // End and Home go to the last and to the first, and the arrows go around both ends.
      expect(await after("End")).toBe(tab("volumes"));
      expect(await after("ArrowRight")).toBe(tab("summary"));
      expect(await after("ArrowLeft")).toBe(tab("volumes"));
      expect(await after("Home")).toBe(tab("summary"));
      expect(await shown()).toBe("results");
      // Enter chooses as Space does, and the tab that is chosen shows what it had loaded.
      expect(await after("ArrowRight")).toBe(tab("log"));
      expect(await after("Enter")).toBe(tab("log"));
      await artifacts.attributeLike(frame, artifacts.PARTS.shown("backup"), "data-tab", "log");
      expect((await artifacts.tabsOf(frame, "backup")).selected).toEqual([tab("log")]);
      expect((await artifacts.panelState(frame, "backup", "log")).shown).toBe(loaded?.request);
      // No key of the tabs asked the cluster for anything.
      expect(askedSince(earlier)).toEqual({});
    },
    TIMEOUT,
  );

  it(
    "keeps the text of each tab while the view is open, and holds none of them once the view was closed and opened again",
    async () => {
      const earlier = cluster.requestCodes(RESOURCE);
      const kept: [string, string, boolean, string | undefined][] = [];

      // Each tab still shows what it loaded, after every other was shown. Every tab is read before any is
      // expected: one whose load did not end with its text is said beside the ones that kept theirs.
      await stay("backup", "summary");
      for (const tab of artifacts.ARTIFACT_TABS) {
        await artifacts.openTab(frame, "backup", tab);
        const state = await artifacts.panelState(frame, "backup", tab);

        kept.push([tab, state.step, state.viewer, state.shown === "" ? undefined : state.shown]);
      }
      expect(kept).toEqual(
        artifacts.ARTIFACT_TABS.map((tab) => [
          tab,
          loads[of("backup", tab)] ? "loaded" : "the tab loaded nothing in the cases before this one",
          loads[of("backup", tab)] !== undefined,
          loads[of("backup", tab)]?.request,
        ]),
      );
      // The view is closed and opened again: every tab is at its first state, and its command creates a
      // request, not another one.
      await cluster.closeWorkspace(frame);
      await cluster.openWorkspace(frame, NAMES.backup);
      for (const tab of artifacts.ARTIFACT_TABS) {
        await artifacts.openTab(frame, "backup", tab);
        const state = await artifacts.panelState(frame, "backup", tab);

        expect([tab, state.step, state.viewer, state.shown]).toEqual([tab, "first", false, ""]);
        expect([tab, await artifacts.said(frame, artifacts.PARTS.panel("backup", tab, "create"))]).toEqual([
          tab,
          artifacts.WORDS.command("backup", tab),
        ]);
      }
      // So is a page that is opened again at the tab it was at.
      await cluster.openPage(frame, cluster.OVERVIEW);
      await artifacts.openAt(frame, "backup", NAMES.backup, "log");
      expect((await artifacts.panelState(frame, "backup", "log")).step).toBe("first");
      await frame.waitForTimeout(NOTHING);
      expect(askedSince(earlier)).toEqual({});
    },
    TIMEOUT,
  );

  // What follows is of the fixtures of the tabs, each opened from its list: the view of an operation of the
  // demo that was open went, with the texts its tabs held, and every case of the demo is before this one.
  // Each operation comes with the loads that create a request, and what creates none comes after them.

  it(
    "says of the synced backup without a log that the store does not have the file, by the phase of a backup that ended, with no command to try again, and loads its results, its resource list and its volume information, which are empty in the words of each viewer",
    async () => {
      const id = (part?: artifacts.PanelPart) => artifacts.PARTS.panel("backup", "log", part);
      const empty = facts.withoutLog;

      await open("backup", "log", WITHOUT_LOG);
      await writesOn();
      // The words of a file the store does not have are the ones of a backup that ended: the phase of the
      // backup says so, read from the cluster before the load, and it is the one the fixtures stored.
      expect([read("backup", WITHOUT_LOG).status?.phase, empty.status.phase]).toEqual(["Completed", "Completed"]);
      const { failure, request } = await endedWithout("backup", "log", WITHOUT_LOG);

      // The request was created and processed, and the store had no file for it: the load ended at the
      // download, as a file the store does not have.
      expect([failure.code, failure.stage]).toEqual(["artifact-missing", "download"]);
      expect(failure.text).toBe(artifacts.WORDS.storeHasNoFile("backup", WITHOUT_LOG, request, NAMESPACE));
      // What a missing file means for a backup that ended: the log was removed, or never written, and the
      // upload of the log of a backup is best effort. It is said in the past, with when the store was asked.
      expect(await artifacts.said(frame, id("missing"))).toMatch(artifacts.WORDS.lostLogOfABackup);
      // No command asks again: the one command takes the tab back to its first state, and has the focus.
      const state = await artifacts.panelState(frame, "backup", "log");

      expect([state.step, state.viewer, state.shown, state.commands]).toEqual(["failed", false, "", [id("begin")]]);
      expect(await artifacts.said(frame, id("notAgain"))).toBe(artifacts.WORDS.notAgain);
      expect(await artifacts.said(frame, id("begin"))).toBe(artifacts.WORDS.beginAgain);
      // A file the phase accounts for is drawn as information, and not as a fault.
      expect(await artifacts.attribute(frame, id("failure"), "data-ended")).toBe("missing");
      expect(await cluster.focusOn(frame, id("begin"))).toBe(id("begin"));
      expect(await cluster.layoutProblems(frame)).toEqual([]);
      await cluster.captureScreenshot(frame, "dark-artifact-lost-log");
      // The three other artifacts are in the store, and empty: each is loaded through a request of its own,
      // holds as many bytes as the fixtures gave the store, and says so in the words of its viewer.
      await artifacts.openTab(frame, "backup", "results");
      expect((await loadOf("backup", "results", WITHOUT_LOG)).size).toBe(empty.results.bytes);
      await expectResults("backup", WITHOUT_LOG);
      expect(await artifacts.resultsShown(frame, "backup")).toMatchObject({
        errors: 0,
        warnings: 0,
        summary: artifacts.WORDS.results("backup", 0, 0),
        groups: [],
      });
      await artifacts.openTab(frame, "backup", "resources");
      expect((await loadOf("backup", "resources", WITHOUT_LOG)).size).toBe(empty.resourceList.bytes);
      expect(await artifacts.resourcesShown(frame, "backup")).toEqual({
        items: 0,
        resources: 0,
        leftItems: 0,
        leftResources: 0,
        said: artifacts.WORDS.resources(0, 0),
        filter: undefined,
        columns: [],
        actions: undefined,
        rows: [],
      });
      await artifacts.openTab(frame, "backup", "volumes");
      expect((await loadOf("backup", "volumes", WITHOUT_LOG)).size).toBe(empty.volumeInfo.bytes);
      expect(await artifacts.volumesShown(frame, "backup")).toEqual({
        count: 0,
        said: artifacts.WORDS.volumes("backup", 0),
        of: "",
        columns: [],
        rows: [],
        titles: [],
      });
      expect(await cluster.layoutProblems(frame)).toEqual([]);
    },
    TIMEOUT,
  );

  it(
    "says of the log of the backup and of the restore that failed their validation that Velero writes nothing for an operation that failed its validation, with a request each",
    async () => {
      for (const kind of OPERATIONS) {
        const id = (part?: artifacts.PanelPart) => artifacts.PARTS.panel(kind, "log", part);

        await open(kind, "log", REFUSED[kind]);
        await writesOn();
        expect([kind, read(kind, REFUSED[kind]).status?.phase]).toEqual([kind, "FailedValidation"]);
        const { failure, request } = await endedWithout(kind, "log", REFUSED[kind]);

        // Velero signed a URL for the request all the same: the store was asked, and had no file.
        expect([kind, failure.code, failure.stage]).toEqual([kind, "artifact-missing", "download"]);
        expect([kind, failure.text]).toEqual([
          kind,
          artifacts.WORDS.storeHasNoFile(kind, REFUSED[kind], request, NAMESPACE),
        ]);
        expect([kind, await artifacts.said(frame, id("missing"))]).toEqual([
          kind,
          artifacts.WORDS.nothingForValidation("log", kind),
        ]);
        const state = await artifacts.panelState(frame, kind, "log");

        expect([kind, state.step, state.viewer, state.commands]).toEqual([kind, "failed", false, [id("begin")]]);
        expect([kind, await artifacts.attribute(frame, id("failure"), "data-ended")]).toEqual([kind, "missing"]);
        expect([kind, await cluster.focusOn(frame, id("begin"))]).toEqual([kind, id("begin")]);
        expect([kind, await cluster.layoutProblems(frame, LISTS[kind])]).toEqual([kind, []]);
        if (kind === "backup") await cluster.captureScreenshot(frame, "dark-artifact-failed-validation");
      }
    },
    TIMEOUT,
  );

  it(
    "shows the results, the resources and the volumes of the backup synced from the store as the fixtures wrote them: four errors, two of Velero and one of each of two namespaces, and two warnings, one of Velero and one of the cluster, each message in its parts and as it is written; the resources sorted, with their counts, the items of the cluster and the filters; and each volume in its row, with its details by the names the release writes them with",
    async () => {
      const synced = facts.synced;
      const status = read("backup", SYNCED).status ?? {};

      await open("backup", "results", SYNCED);
      await writesOn();
      // The status of the backup is the one the fixtures stored, synced by the server: the counts the
      // results are compared with are read from the cluster, and are the ones the fixtures counted.
      expect([status.phase, status.errors, status.warnings, status.progress?.itemsBackedUp]).toEqual([
        "PartiallyFailed",
        synced.results.errors,
        synced.results.warnings,
        synced.resourceList.items,
      ]);
      // The results: the counts of the status, the places in their order with their counts, and each
      // message in its parts, as the hook of the server writes an entry, and as it is written.
      expect((await loadOf("backup", "results", SYNCED)).size).toBe(synced.results.bytes);
      await expectResults("backup", SYNCED);
      const results = await artifacts.resultsShown(frame, "backup");
      const written = synced.results.value;
      const placesOf = (group: "errors" | "warnings"): [string, string, number][] => {
        const value = written[group] ?? {};
        const namespaces = value.namespaces ?? {};

        return (
          [
            ["velero", "", value.velero?.length ?? 0],
            ["cluster", "", value.cluster?.length ?? 0],
            ...Object.keys(namespaces)
              .sort()
              .map((namespace): [string, string, number] => ["namespace", namespace, namespaces[namespace].length]),
          ] as [string, string, number][]
        ).filter((place) => place[2] > 0);
      };

      expect([results.errors, results.warnings]).toEqual([synced.results.errors, synced.results.warnings]);
      expect(
        results.groups.map((group) => [
          group.kind,
          group.places.map((place) => [place.where, place.namespace, place.count]),
        ]),
      ).toEqual([
        ["errors", placesOf("errors")],
        ["warnings", placesOf("warnings")],
      ]);
      // Every message as the fixtures filed it: the text the results write is the one of an entry of the
      // log, which the fixtures counted with its parts.
      const partsOf = (text: string) => {
        const entry = synced.log.entries.find((candidate) => candidate.text === text);

        if (!entry) throw new Error(`The results carry a message the log of the fixtures did not file: ${text}`);
        return Object.fromEntries(
          (["resource", "name", "message", "error"] as const).flatMap((part) =>
            entry[part] === undefined ? [] : [[part, entry[part]]],
          ),
        );
      };
      const expected = (["errors", "warnings"] as const).flatMap((group) =>
        placesOf(group).map(([where, namespace]) => {
          const value = written[group] ?? {};
          const texts =
            where === "namespace"
              ? (value.namespaces?.[namespace] ?? [])
              : (value[where as "velero" | "cluster"] ?? []);

          return { where, namespace, messages: texts.map((text) => ({ text, parts: partsOf(text) })) };
        }),
      );

      expect(synced.log.entries.length).toBe(synced.results.errors + synced.results.warnings);
      expect(await artifacts.resultMessages(frame, "backup")).toEqual(expected);
      expect(await cluster.layoutProblems(frame)).toEqual([]);
      await application().window.mouse.move(1, 1);
      await cluster.captureScreenshot(frame, "dark-artifact-results-synced");
      // The resources: as many items and resources as the fixtures wrote, and the items the status counted;
      // sorted by their API version and kind, each with its items sorted, the ones of the cluster said so.
      await artifacts.openTab(frame, "backup", "resources");
      expect((await loadOf("backup", "resources", SYNCED)).size).toBe(synced.resourceList.bytes);
      const list = await artifacts.resourcesLike(
        frame,
        "backup",
        "shows its first rows",
        (shown) => shown.rows.length > 0,
      );
      const items = synced.resourceList.value;
      const sorted = Object.keys(items).sort();
      const itemRow = (item: string): Extract<artifacts.ResourceRow, { item: string }> => {
        const slash = item.indexOf("/");

        return slash < 0
          ? { item, namespace: "cluster", scope: "cluster", name: item, action: undefined }
          : { item, namespace: item.slice(0, slash), scope: "", name: item.slice(slash + 1), action: undefined };
      };
      const rows = sorted.flatMap((resource): artifacts.ResourceRow[] => [
        { resource, count: items[resource].length, said: artifacts.WORDS.itemsOf(items[resource].length) },
        ...[...items[resource]].sort().map(itemRow),
      ]);

      expect([list.items, list.resources, list.columns, list.actions]).toEqual([
        synced.resourceList.items,
        synced.resourceList.resources,
        ["namespace", "name"],
        undefined,
      ]);
      expect([list.leftItems, list.leftResources, list.said]).toEqual([
        list.items,
        list.resources,
        artifacts.WORDS.resources(list.items, list.resources),
      ]);
      expect(rows.length).toBe(synced.resourceList.items + synced.resourceList.resources);
      expectRows("backup", list.rows);
      expect(list.rows.length).toBeGreaterThan(1);
      expect(list.rows).toEqual(rows.slice(0, list.rows.length));
      // The filter: by a namespace, by two words of which one is a resource, and by the kind of a resource
      // whose one item is of the cluster. What each leaves is counted on what the fixtures wrote, by the
      // rule of the filter: every word in the resource, the namespace or the name, whatever its capitals.
      const leftBy = (words: string) => {
        const asked = words.toLowerCase().split(/\s+/).filter(Boolean);
        let left = 0;
        let resources = 0;

        for (const resource of sorted) {
          const kept = items[resource].filter((item) => {
            const row = itemRow(item);
            const namespace = row.scope === "cluster" ? "" : row.namespace.toLowerCase();

            return asked.every(
              (word) =>
                resource.toLowerCase().includes(word) ||
                namespace.includes(word) ||
                row.name.toLowerCase().includes(word),
            );
          }).length;

          if (kept > 0) {
            left += kept;
            resources += 1;
          }
        }
        return { items: left, resources };
      };
      const namespaced = rows.find((row) => "item" in row && row.scope === "");
      const ofTheCluster = sorted.find((resource) => items[resource].length === 1 && !items[resource][0].includes("/"));

      if (!namespaced || !("item" in namespaced)) throw new Error("No item of the fixtures is in a namespace");
      if (!ofTheCluster) throw new Error("No resource of the fixtures has one item, of the cluster");
      const alone = ofTheCluster.slice(ofTheCluster.lastIndexOf("/") + 1);
      const filter = await artifacts.part(frame, artifacts.PARTS.viewer("backup", "resources", "filter"));

      expect([alone, leftBy(alone).items]).toEqual([alone, 1]);
      for (const words of [namespaced.namespace, `Role ${namespaced.namespace}`, alone]) {
        const counted = leftBy(words);

        expect([words, counted.items > 0, counted.items < list.items]).toEqual([words, true, true]);
        await filter.fill(words);
        const narrowed = await artifacts.resourcesLike(
          frame,
          "backup",
          `is filtered by ${words}`,
          (shown) => shown.filter === words && shown.leftItems === counted.items && shown.rows.length > 0,
        );

        expect([words, narrowed.leftResources, narrowed.said]).toEqual([
          words,
          counted.resources,
          artifacts.WORDS.resourcesLeft(counted.items, list.items, counted.resources, list.resources),
        ]);
      }
      // The last words left one item, of the cluster: its resource with what the filter left of it, and
      // the item with the word that says it is of no namespace.
      expect((await artifacts.resourcesShown(frame, "backup")).rows).toEqual([
        { resource: ofTheCluster, count: 1, said: artifacts.WORDS.itemsLeft(1, 1) },
        itemRow(items[ofTheCluster][0]),
      ]);
      await application().window.mouse.move(1, 1);
      await cluster.captureScreenshot(frame, "dark-artifact-resources-synced");
      await filter.fill("");
      await artifacts.resourcesLike(
        frame,
        "backup",
        "has its filter cleared",
        (shown) => shown.filter === "" && shown.leftItems === list.items,
      );
      expect(await cluster.layoutProblems(frame)).toEqual([]);
      // The volumes: one row for each, in the order of the release, with the columns of a backup; what each
      // cell says of its entry, and what it writes for who points at it, a time or a count as it is.
      await artifacts.openTab(frame, "backup", "volumes");
      expect((await loadOf("backup", "volumes", SYNCED)).size).toBe(synced.volumeInfo.bytes);
      const volumes = await artifacts.volumesShown(frame, "backup");
      const entries = synced.volumeInfo.value;
      const text = (entry: Record<string, unknown>, key: string) =>
        typeof entry[key] === "string" ? (entry[key] as string) : undefined;
      const mark = (entry: Record<string, unknown>, key: string) =>
        typeof entry[key] === "boolean" ? artifacts.WORDS.mark(entry[key] as boolean) : artifacts.WORDS.notStated;
      // The size is read from the detail that carries one: what was moved, then the snapshot, then the pod volume.
      const sizeOf = (entry: Record<string, unknown>) => {
        for (const key of ["snapshotDataMovementInfo", "csiSnapshotInfo", "pvbInfo"]) {
          const size = (entry[key] as { size?: unknown } | undefined)?.size;

          if (typeof size === "number" && size > 0) return size;
        }
        return undefined;
      };
      const rowOf = (entry: Record<string, unknown>) => {
        const size = sizeOf(entry);
        const reason = text(entry, "skippedReason");

        return {
          claim: `${text(entry, "pvcName") ?? artifacts.WORDS.notStated} ${artifacts.WORDS.inNamespace(text(entry, "pvcNamespace") ?? "")}`,
          volume: text(entry, "pvName") ?? artifacts.WORDS.notStated,
          method: text(entry, "backupMethod") ?? artifacts.WORDS.notStated,
          result: text(entry, "result") ?? artifacts.WORDS.notStated,
          moved: mark(entry, "snapshotDataMoved"),
          kept: mark(entry, "preserveLocalSnapshot"),
          skipped: `${mark(entry, "skipped")}${reason ? ` ${reason}` : ""}`,
          // A time is written as the views write one: what it is written for who points at it is compared.
          started: text(entry, "startTimestamp") ? expect.stringMatching(/\d/) : artifacts.WORDS.notStated,
          ended: text(entry, "completionTimestamp") ? expect.stringMatching(/\d/) : artifacts.WORDS.notStated,
          size: size === undefined ? artifacts.WORDS.notStated : artifacts.WORDS.size(size),
        };
      };
      const titlesOf = (entry: Record<string, unknown>) => {
        const size = sizeOf(entry);

        return {
          claim: "",
          volume: "",
          method: "",
          result: "",
          moved: "",
          kept: "",
          skipped: "",
          started: text(entry, "startTimestamp") ?? "",
          ended: text(entry, "completionTimestamp") ?? "",
          size: size === undefined ? "" : artifacts.WORDS.bytesOf(size),
        };
      };

      expect([volumes.count, volumes.said, volumes.of]).toEqual([
        synced.volumeInfo.volumes,
        artifacts.WORDS.volumes("backup", synced.volumeInfo.volumes),
        "Backup",
      ]);
      expect(volumes.columns).toEqual(artifacts.WORDS.volumeColumns.backup);
      expect(volumes.rows).toEqual(entries.map(rowOf));
      expect(volumes.titles).toEqual(entries.map(titlesOf));
      // By name: the native snapshot has no size, and the CSI snapshot has its end and its result.
      const native = entries.findIndex((entry) => text(entry, "backupMethod") === "NativeSnapshot");
      const csi = entries.findIndex((entry) => text(entry, "backupMethod") === "CSISnapshot");

      expect([native >= 0, csi >= 0]).toEqual([true, true]);
      expect(volumes.rows[native].size).toBe(artifacts.WORDS.notStated);
      expect([volumes.rows[csi].result, volumes.titles[csi].ended]).toEqual([
        "succeeded",
        text(entries[csi], "completionTimestamp"),
      ]);
      // The details of a row, opened by its command: each detail the entry carries, by the name the tab
      // gives it, with its fields by the names they are written with, the ones the release writes without
      // a JSON name among them, and the value of each as it is written.
      const shownValue = (value: unknown): string => {
        if (typeof value === "string") return value;
        if (
          typeof value === "object" &&
          value !== null &&
          !Array.isArray(value) &&
          Object.values(value).every((entry) => typeof entry === "string")
        ) {
          return Object.entries(value)
            .map(([key, entry]) => `${key}=${entry}`)
            .join(", ");
        }
        return JSON.stringify(value);
      };
      const detailsOf = (entry: Record<string, unknown>) =>
        Object.keys(artifacts.WORDS.volumeDetail)
          .filter((key) => entry[key] !== undefined)
          .map((key) => {
            const detail = entry[key] as Record<string, unknown>;

            return {
              name: key,
              title: artifacts.WORDS.volumeDetail[key],
              fields: Object.keys(detail).map((name) => ({ name, value: shownValue(detail[name]) })),
              none: "",
            };
          });

      for (const [row, field] of [
        [csi, "ReadyToUse"],
        [native, "Phase"],
      ] as const) {
        const toggle = artifacts.PARTS.volumeToggle("backup", row);

        await artifacts.clickOn(frame, toggle);
        expect([row, await artifacts.attribute(frame, toggle, "aria-expanded")]).toEqual([row, "true"]);
        const details = await artifacts.volumeDetails(frame, "backup", row);

        expect([row, details]).toEqual([row, { none: "", details: detailsOf(entries[row]) }]);
        expect([row, details.details.flatMap((detail) => detail.fields.map((found) => found.name))]).toEqual([
          row,
          expect.arrayContaining([field]),
        ]);
        if (row === csi) {
          expect(await cluster.layoutProblems(frame)).toEqual([]);
          await application().window.mouse.move(1, 1);
          await cluster.captureScreenshot(frame, "dark-artifact-volumes-detail");
        }
        await artifacts.clickOn(frame, toggle);
        await artifacts.gone(frame, artifacts.PARTS.volumeDetails("backup", row));
      }
    },
    TIMEOUT,
  );

  it(
    "cancels the load of the log of the backup synced from the store once its request is in the cluster, and says how it ended, with the command that asks again and no text; then asks again: a new request, the steps of the load in the order the main process tells them, the pages of the text rising to the last, and the bytes of the download that do not go down",
    async () => {
      const id = (part?: artifacts.PanelPart) => artifacts.PARTS.panel("backup", "log", part);
      const synced = facts.synced.log;

      await stay("backup", "log", SYNCED);
      await writesOn();
      const earlier = cluster.requestCodes(RESOURCE);

      await artifacts.ask(frame, "backup", "log");
      // The command that cancels is given inside the page, as soon as the panel is at a step after the
      // creation: the request is in the cluster then, and the guard is told its name.
      const {
        ended,
        moments,
        request: named,
      } = await artifacts.runLoad(frame, "backup", "log", told, { cancel: "created" });

      if (ended === "loaded") {
        throw new Error(
          "The load of the large log ended with its text before the cancel reached it: nothing was cancelled",
        );
      }
      const failure = await artifacts.failureOf(frame, "backup", "log");

      await report("artifact-large-log-cancelled", { failure, moments });
      expect(named.startsWith(`${SYNCED}-`)).toBe(true);
      expect(ledger.asked()).toContain(named);
      expect([failure.code, failure.stage, artifacts.AFTER_THE_CREATION.includes(failure.stage)]).toEqual([
        "cancelled",
        failure.stage,
        true,
      ]);
      expect(failure.text).toBe(artifacts.WORDS.cancelledAfter(named, NAMESPACE));
      expect(moments.some((moment) => moment.status === artifacts.WORDS.cancelling)).toBe(true);
      expect(since(earlier)["POST 201"]).toBe(1);
      // The request is in the cluster, as the extension created it: the server removes it, not the cancel.
      const held = cluster.downloadRequests(NAMESPACE).find((entry) => entry.name === named);

      expect(held?.target).toEqual({ kind: "BackupLog", name: SYNCED });
      expect(held?.labels).toEqual({ ...LABELS, [REQUEST_LABEL]: named.slice(SYNCED.length + 1) });
      // The tab holds no text, and offers the command that asks again, which is another request.
      const state = await artifacts.panelState(frame, "backup", "log");

      expect([state.step, state.viewer, state.shown, state.commands]).toEqual(["failed", false, "", [id("create")]]);
      expect(await artifacts.said(frame, id("what"))).toBe(artifacts.WORDS.askAgain(NAMESPACE, true));
      expect(await artifacts.said(frame, id("create"))).toBe(artifacts.WORDS.command("backup", "log", true));
      expect(await artifacts.attribute(frame, id("failure"), "data-ended")).toBe("cancelled");
      expect(await cluster.focusOn(frame, id("create"))).toBe(id("create"));
      expect(await cluster.layoutProblems(frame)).toEqual([]);
      await cluster.captureScreenshot(frame, "dark-artifact-cancelled-after-creation");
      // Then the command asks again: a new request, and the load is watched to its text. A picture of the
      // load is asked while it runs: this is the one load of the suite long enough to be pictured.
      const again = cluster.requestCodes(RESOURCE);

      await artifacts.ask(frame, "backup", "log");
      const second = await artifacts.runLoad(frame, "backup", "log", told, {
        loading: () => loadingPicture("backup", "log"),
      });
      const loaded = await artifacts.loadedFacts(frame, "backup", "log");

      loads[of("backup", "log", SYNCED)] = { ...loaded, moments: second.moments };
      watch("backup", "log", second.moments, SYNCED);
      await report("artifact-load-of-the-large-log", second.moments);
      expectRequest("backup", "log", loaded.request, SYNCED);
      expect(loaded.request).not.toBe(named);
      expect(since(again)["POST 201"]).toBe(1);
      expectLoaded("backup", "log", loaded);
      expect(loaded.size).toBe(synced.bytes);
      // The confirmation, then the load, then the text, in that order; the request named while it loaded,
      // and no text shown before it arrived.
      const running = second.moments.filter((moment) => moment.step === "loading");

      expect(second.moments.map((moment) => moment.step).filter((step, at, steps) => step !== steps[at - 1])).toEqual([
        "confirming",
        "loading",
        "loaded",
      ]);
      expect(running.length).toBeGreaterThan(0);
      expect(running.filter((moment) => moment.request !== loaded.request || moment.viewer || moment.shown)).toEqual(
        [],
      );
      // Two different steps at least, in the order the main process tells them, and the pages last; each
      // step in its words.
      const steps = artifacts.stepsSeen(second.moments);

      expect([steps, new Set(steps).size >= 2, artifacts.inTheOrder(steps, artifacts.STEPS.backup)]).toEqual([
        steps,
        true,
        true,
      ]);
      expect(steps[steps.length - 1]).toBe("pages");
      for (const moment of running) {
        expect([moment.at, moment.status]).toEqual([
          moment.at,
          expect.stringMatching(artifacts.stepWords(moment.at, loaded.request)),
        ]);
      }
      // The pages of the text rise, never fall, and reach the last of as many as the fixtures counted.
      const pages = artifacts.pagesSeen(second.moments);

      expect(pages.length).toBeGreaterThan(0);
      expect(pages.map((page) => page.of)).toEqual(pages.map(() => synced.pages));
      expect(pages.map((page) => page.page)).toEqual(
        [...pages.map((page) => page.page)].sort((one, other) => one - other),
      );
      expect(pages[pages.length - 1].page).toBe(synced.pages);
      // The bytes the download tells, where it tells them, do not go down.
      const bytes = artifacts.bytesSeen(second.moments);

      if (bytes.length === 0) console.log("The download of the large log showed no count of its bytes");
      expect(bytes).toEqual([...bytes].sort((one, other) => one - other));
      // The keyboard is on the first line of what arrived, and the commands are the ones of a text.
      const first = artifacts.PARTS.line("backup", "log", 1);

      await artifacts.part(frame, first);
      expect(await cluster.focusOn(frame, first)).toBe(first);
      expect((await artifacts.panelState(frame, "backup", "log")).commands).toEqual([id("create"), id("save")]);
    },
    TIMEOUT,
  );

  it(
    "shows the log of 200,000 lines: saved as it was stored, with the digest the fixtures counted; its lines and its levels as the fixtures counted them, a hundred rows mounted at most at five places, the searches with their counts, the next and the previous match, the line that names a level in its message, the lines that are cut and the one across two pages, and the lines wrapped",
    async () => {
      const running = application();
      const keyboard = running.window.keyboard;
      const synced = facts.synced.log;
      const id = (part?: artifacts.PanelPart) => artifacts.PARTS.panel("backup", "log", part);
      const { directory, file } = savedInto("the-log-of-the-synced-backup");

      // The save comes first, within the ten minutes the main process holds the text: the dialog of the
      // host answers the file of the suite. The file is the one the fixtures gave the store, byte for byte.
      await mkdir(directory, { recursive: true });
      await velero.replaceSaveDialog(running.app, file);
      const loaded = await toTheSave(SYNCED);
      const asked = (await velero.saveDialogCalls(running.app)).length;
      const earlier = cluster.requestCodes(RESOURCE);
      const writesBefore = cluster.writes(cluster.apiRequests());

      await artifacts.clickOn(frame, id("save"));
      await artifacts.attributeLike(frame, id("saving"), "data-saving", "saved");
      expect(await artifacts.said(frame, id("saving"))).toBe(artifacts.WORDS.saved("log"));
      expectAsked((await velero.saveDialogCalls(running.app)).slice(asked), SYNCED);
      const saved = await readFile(file);
      const lines = artifacts.linesOf(saved.toString("utf8"));

      expect([saved.length, loaded.size]).toEqual([synced.bytes, synced.bytes]);
      expect(createHash("sha256").update(saved).digest("hex")).toBe(synced.sha256);
      expect(lines.length).toBe(synced.lines);
      await expectNoWrite(earlier, writesBefore);
      // The viewer: every line, with the count of each level as the fixtures counted it, and as the suite
      // reads the level of each line of the file, as an operator would.
      const first = await freshLog(SYNCED);

      expect([first.lines, first.shown, first.rows, first.count]).toEqual([
        synced.lines,
        synced.lines,
        synced.lines,
        artifacts.WORDS.lines(synced.lines, synced.lines),
      ]);
      expect(Object.fromEntries(artifacts.LOG_LEVELS.map((level) => [level, first.levels[level].count]))).toEqual(
        synced.levels,
      );
      expect(
        Object.fromEntries(
          artifacts.LOG_LEVELS.map((level) => [
            level,
            lines.filter((line) => artifacts.levelOf(line) === level).length,
          ]),
        ),
      ).toEqual(synced.levels);
      // A hundred rows mounted at most, at five places of the log: its first line, its last, a quarter of
      // the way, the line of twenty thousand characters, and fifty lines before the end.
      expect([first.mounted[0], first.mounted.length <= ROWS_BOUND]).toEqual([1, true]);
      await toTheList();
      await keyboard.press("End");
      const last = await artifacts.logLike(frame, "backup", "is at its last line", (shown) =>
        shown.mounted.includes(synced.lines),
      );

      expect(last.mounted.length).toBeLessThanOrEqual(ROWS_BOUND);
      for (const line of [Math.floor(synced.lines / 4), synced.long.twentyThousand, synced.lines - 50]) {
        const at = await artifacts.scrollLogTo(frame, "backup", line);

        expect([line, at.mounted.length <= ROWS_BOUND]).toEqual([line, true]);
      }
      // The searches the fixtures counted the lines of: each with its count, which the suite counts in the
      // file as well, and the first of its lines; one in other capitals than the file writes it, and one no
      // line carries.
      const searches = synced.searches.filter((search) => search.use === "content");
      const field = await artifacts.part(frame, logPart("search"));

      expect(searches.length).toBe(4);
      for (const search of searches) {
        const found = artifacts.matchingLines(lines, search.text);
        const shown = await artifacts.searchLog(frame, "backup", search.text);

        expect([search.text, found.length, shown.search.matches, shown.search.line]).toEqual([
          search.text,
          search.matches,
          search.matches,
          found[0],
        ]);
        if (search.matches === 0)
          expect([search.text, shown.search.said]).toEqual([search.text, artifacts.WORDS.noMatch()]);
      }
      const capitals = searches.find((search) => search.text !== search.text.toLowerCase() && search.matches > 1);

      if (!capitals) throw new Error("No search of the fixtures is in capitals with more than one line");
      expect((await artifacts.searchLog(frame, "backup", capitals.text.toLowerCase())).search.matches).toBe(
        capitals.matches,
      );
      // The next and the previous match, with the row of the match marked, among the lines that carry the
      // words of an error: the match the search is at is the line, in the order of the lines.
      const errors = searches.find((search) => search.text === "level=error");

      if (!errors) throw new Error("No search of the fixtures is for the words of an error");
      const errorLines = artifacts.matchingLines(lines, errors.text);
      const at = async (match: number, after: string) => {
        const shown = await artifacts.logLike(
          frame,
          "backup",
          `is at match ${match + 1} of ${errorLines.length}, with the row of its line marked, ${after}`,
          (log) =>
            log.search.words === errors.text &&
            log.search.match === match &&
            log.marked.length === 1 &&
            log.marked[0] === log.search.line,
        );

        expect([after, shown.search.line, shown.search.said]).toEqual([
          after,
          errorLines[match],
          artifacts.WORDS.match(match, errorLines.length, errorLines[match]),
        ]);
      };

      await artifacts.searchLog(frame, "backup", errors.text);
      await at(0, "after the words were typed");
      await field.press("Enter");
      await at(1, "after Enter on the first match");
      await field.press("Shift+Enter");
      await at(0, "after Shift with Enter on the second match");
      await field.press("Shift+Enter");
      await at(errorLines.length - 1, "after Shift with Enter on the first match");
      // The entry at info whose message names the level of an error is at info: with that level chosen,
      // the words of the error are found in as many lines as the fixtures wrote them into a message, and
      // the first of them is the one the fixtures counted. The file says the same of that line.
      await artifacts.clickOn(frame, artifacts.PARTS.level("backup", "info"));
      const trapped = await artifacts.logLike(
        frame,
        "backup",
        "shows the lines of the level info that carry the words of an error",
        (shown) => shown.levels.info.chosen && shown.shown === synced.levels.info && shown.search.words === errors.text,
      );

      expect([trapped.search.matches, trapped.search.line]).toEqual([
        synced.levelInMessage.lines,
        synced.levelInMessage.line,
      ]);
      expect(artifacts.levelOf(lines[synced.levelInMessage.line - 1])).toBe("info");
      expect(lines[synced.levelInMessage.line - 1]).toContain(errors.text);
      await artifacts.clickOn(frame, artifacts.PARTS.level("backup", "info"));
      await field.fill("");
      // The lines of the level error alone: as many as the fixtures wrote, by their numbers in the log,
      // which are the ones of the entries the fixtures filed as errors and the ones the file has.
      await artifacts.clickOn(frame, artifacts.PARTS.level("backup", "error"));
      const errorsOnly = await artifacts.logLike(
        frame,
        "backup",
        "shows the lines of the level error",
        (shown) =>
          shown.levels.error.chosen &&
          !shown.levels.info.chosen &&
          shown.search.words === "" &&
          shown.shown === synced.levels.error,
      );

      expect(errorsOnly.mounted).toEqual(
        lines.flatMap((line, index) => (artifacts.levelOf(line) === "error" ? [index + 1] : [])),
      );
      expect(errorsOnly.mounted).toEqual(
        synced.entries
          .filter((entry) => entry.level === "error")
          .map((entry) => entry.line)
          .sort((one, other) => one - other),
      );
      expect(errorsOnly.count).toBe(artifacts.WORDS.lines(synced.levels.error, synced.lines));
      await running.window.mouse.move(1, 1);
      await cluster.captureScreenshot(frame, "dark-artifact-log-errors");
      await artifacts.clickOn(frame, artifacts.PARTS.level("backup", "error"));
      await artifacts.logLike(frame, "backup", "hides no line again", (shown) => shown.shown === synced.lines);
      // The line of ten thousand characters is whole in its row, the next, of one more, is cut, and the
      // one of twenty thousand is cut in its row and says how much of it is not shown.
      const { tenThousand, tenThousandAndOne, twentyThousand } = synced.long;

      expect([
        lines[tenThousand - 1].length,
        lines[tenThousandAndOne - 1].length,
        lines[twentyThousand - 1].length,
      ]).toEqual([LINE_BOUND, LINE_BOUND + 1, 2 * LINE_BOUND]);
      await artifacts.scrollLogTo(frame, "backup", tenThousand);
      expect(await artifacts.lineShown(frame, "backup", "log", tenThousand)).toEqual({
        text: lines[tenThousand - 1],
        cut: false,
      });
      const oneMore = await artifacts.lineShown(frame, "backup", "log", tenThousandAndOne);

      expect([oneMore.cut, oneMore.text.length, lines[tenThousandAndOne - 1].startsWith(oneMore.text)]).toEqual([
        true,
        LINE_BOUND,
        true,
      ]);
      await artifacts.scrollLogTo(frame, "backup", twentyThousand);
      const long = await artifacts.lineShown(frame, "backup", "log", twentyThousand);

      expect([long.cut, long.text.length, lines[twentyThousand - 1].startsWith(long.text)]).toEqual([
        true,
        LINE_BOUND,
        true,
      ]);
      expect(await artifacts.said(frame, artifacts.PARTS.line("backup", "log", twentyThousand, "cut"))).toBe(
        artifacts.WORDS.cutLine(lines[twentyThousand - 1].length - long.text.length),
      );
      await running.window.mouse.move(1, 1);
      await cluster.captureScreenshot(frame, "dark-artifact-log-cut-line");
      // The line the first page of the text ended inside, in a character of more than one byte, is whole.
      const across = lines[synced.boundaryLine - 1];

      expect(Buffer.byteLength(across) > across.length).toBe(true);
      await artifacts.scrollLogTo(frame, "backup", synced.boundaryLine);
      expect(await artifacts.lineShown(frame, "backup", "log", synced.boundaryLine)).toEqual({
        text: across,
        cut: false,
      });
      // The lines wrapped, a hundred rows mounted at most, and on one line each again.
      await artifacts.clickOn(frame, logPart("wrap"));
      const wrapped = await artifacts.logLike(
        frame,
        "backup",
        "wraps its lines",
        (shown) => shown.wrap && shown.columns !== undefined && shown.mounted.length > 0,
      );

      expect([wrapped.shown, wrapped.mounted.length <= ROWS_BOUND]).toEqual([synced.lines, true]);
      await artifacts.clickOn(frame, logPart("wrap"));
      await artifacts.logLike(frame, "backup", "does not wrap its lines again", (shown) => !shown.wrap);
      expect(await cluster.layoutProblems(frame)).toEqual([]);
    },
    TIMEOUT,
  );

  it(
    "answers ten searches and ten filters of the log of 200,000 lines within 250 milliseconds at the 95th percentile, after five interactions that warm the viewer, and draws the longest frame of each of twenty scroll gestures within 50 at the same percentile, with a hundred rows mounted at most, once sixty idle frames of the window say that a frame can be timed",
    async () => {
      const began = Date.now();
      const synced = facts.synced.log;
      const { file } = savedInto("the-log-of-the-synced-backup");
      // The dataset is the file the case of the save wrote, read again and counted: no save is repeated. What is
      // expected of a search is what the runner counted of the fixtures, and the suite counts it in the file as
      // well, before anything is timed: no count comes from what the view showed.
      const bytes = await readFile(file);
      const digest = createHash("sha256").update(bytes).digest("hex");
      const lines = artifacts.linesOf(bytes.toString("utf8"));
      // The lines whose rows take two rows: the ones a row cuts.
      const tall = lines.flatMap((line, index) => (line.length > LINE_BOUND ? [index + 1] : []));
      const of = (use: string) => synced.searches.filter((search) => search.use === use);
      const texts = { warm: of("warm"), measured: of("measured") };
      // The texts the case of the log searched before this one, whatever their capitals.
      const searchedBefore = of("content").map((search) => search.text.toLowerCase());
      const inTheFile = new Map(
        [...texts.warm, ...texts.measured].map((search) => [
          search.text,
          artifacts.matchingLines(lines, search.text).length,
        ]),
      );
      const disagree = [...texts.warm, ...texts.measured].filter(
        (search) => inTheFile.get(search.text) !== search.matches,
      );

      if (disagree.length > 0) {
        throw new Error(
          "The file does not carry the texts as the fixtures counted them: " +
            disagree
              .map((search) => `"${search.text}" in ${inTheFile.get(search.text)} lines for ${search.matches}`)
              .join(", "),
        );
      }
      // The choices of the levels, in the groups of TOGGLES, each one click from the one before: the levels each
      // leaves chosen, and how many lines it leaves, which is the sum of the counts of those levels while one is
      // chosen at least, and every line while none is: no level chosen hides no line.
      const key = (levels: readonly artifacts.LogLevel[]) => levels.join("+") || "none";
      let chosen: artifacts.LogLevel[] = [];
      const [warmChoices, noneAgain, measuredChoices, noneAtLast] = TOGGLES.map(([, levels]) =>
        levels.map((level) => {
          chosen = chosen.includes(level) ? chosen.filter((each) => each !== level) : [...chosen, level];
          const sorted = artifacts.LOG_LEVELS.filter((each) => chosen.includes(each));

          return {
            level,
            levels: sorted,
            shown: sorted.length ? sorted.reduce((sum, each) => sum + synced.levels[each], 0) : synced.lines,
          };
        }),
      );
      const first = await freshLog(SYNCED);
      const room = await artifacts.logRoom(frame, "backup");
      // The height of a row of one line, read once from the page: LINE_HEIGHT of the helpers mirrors LINE of
      // the product, and a line height the product changed fails here, by its name, before a gesture misses
      // its rows.
      const oneLine = first.mounted.find((line) => !tall.includes(line));

      expect(oneLine).toBeDefined();
      expect(await artifacts.logRowHeight(frame, "backup", oneLine ?? 1)).toBe(artifacts.LINE_HEIGHT);
      // A page of the scroll: the lines the room shows, less one, as the keys page; a notch, three lines. The
      // gestures go to fixed lines: the first three far ones are each followed by two notches and two pages,
      // forward, backward and forward again.
      const page = Math.floor(room / artifacts.LINE_HEIGHT) - 1;
      const places: { kind: string; line: number }[] = [];
      let at = 1;
      const go = (kind: string, line: number) => {
        places.push({ kind, line });
        at = line;
      };

      for (const [far, by] of [
        [FAR[0], 1],
        [FAR[1], -1],
        [FAR[2], 1],
      ]) {
        go("far", far);
        go("notch", at + by * NOTCH);
        go("notch", at + by * NOTCH);
        go("page", at + by * page);
        go("page", at + by * page);
      }
      for (const far of FAR.slice(3)) go("far", far);
      // What is measured, as it is taken: the time of each answer and the frames of each gesture, with the rows
      // the list had mounted when each ended, and the most of them at once.
      const warmAnswers: { interaction: string; ms: number; mounted: number }[] = [];
      const answers: typeof warmAnswers = [];
      const warmGestures: { interaction: string; longest: number; frames: number[]; mounted: number }[] = [];
      const gestures: typeof warmGestures = [];
      let baseline: number[] = [];
      let mounted = first.mounted.length;
      let stopped: unknown;
      const search = async (text: artifacts.FixtureSearch, into: typeof answers) => {
        const answer = await artifacts.measureLogSearch(frame, "backup", text.text, {
          matches: text.matches,
          shown: synced.lines,
        });

        into.push({ interaction: `search ${text.text}`, ms: answer.ms, mounted: answer.mounted });
        mounted = Math.max(mounted, answer.mounted);
      };
      const choose = async (choice: (typeof warmChoices)[number], into?: typeof answers) => {
        const answer = await artifacts.measureLogFilter(frame, "backup", choice.level, {
          levels: choice.levels,
          shown: choice.shown,
        });

        into?.push({ interaction: `levels ${key(choice.levels)}`, ms: answer.ms, mounted: answer.mounted });
        mounted = Math.max(mounted, answer.mounted);
      };
      // The search is cleared between the series, which is not measured: the rows mounted after it count.
      const clear = async () => {
        mounted = Math.max(mounted, (await artifacts.searchLog(frame, "backup", "")).mounted.length);
      };
      const scroll = async (place: { kind: string; line: number }, into: typeof gestures) => {
        const gesture = await artifacts.measureLogScroll(
          frame,
          "backup",
          artifacts.logRowTop(place.line, tall),
          { first: place.line, last: artifacts.logRoomEnd(place.line, tall, room, lines.length) },
          lines.length,
        );

        into.push({
          interaction: `${place.kind} to ${place.line}`,
          longest: Math.max(...gesture.frames),
          frames: gesture.frames,
          mounted: gesture.mounted,
        });
        mounted = Math.max(mounted, gesture.mounted);
      };

      try {
        // The window first: sixty idle frames. One that draws them slower than a frame can be timed by says so,
        // and nothing is measured on it.
        baseline = await artifacts.frameBaseline(frame, "backup", IDLE_FRAMES);
        const idle = percentile(baseline, 0.5);

        if (idle > IDLE_FRAME) {
          throw new Error(
            `The window draws an idle frame in ${tenths(idle)} ms at the median of ${IDLE_FRAMES}: it is not ` +
              "drawing fast enough to time a frame by, and the measures are not taken",
          );
        }
        // Five interactions that warm the viewer: two searches, two choices of levels and one scroll. The search
        // and the levels are cleared again after them, which is not measured.
        for (const text of texts.warm) await search(text, warmAnswers);
        await clear();
        for (const choice of warmChoices) await choose(choice, warmAnswers);
        for (const choice of noneAgain) await choose(choice);
        await scroll({ kind: "far", line: WARM_SCROLL }, warmGestures);
        // Twenty answers: ten searches, each of a text never searched in the view, then ten choices of levels,
        // each a combination never chosen in it.
        for (const text of texts.measured) await search(text, answers);
        await clear();
        for (const choice of measuredChoices) await choose(choice, answers);
        for (const choice of noneAtLast) await choose(choice);
        // Twenty gestures of the scroll: eight far, six of a notch and six of a page, to fixed lines. They begin
        // at the first line, where the list began: the searches brought their matches into the room, and the
        // choices of the levels kept the place they found the list at, which is no place a gesture is timed from.
        mounted = Math.max(mounted, (await artifacts.scrollLogTo(frame, "backup", 1)).mounted.length);
        for (const place of places) await scroll(place, gestures);
      } catch (error) {
        stopped = error;
      }
      const summary = (values: number[]) => ({
        p95: tenths(percentile(values, 0.95)),
        median: tenths(percentile(values, 0.5)),
        slowest: tenths(Math.max(...values)),
      });
      const rounded = (answer: (typeof answers)[number]) => ({ ...answer, ms: tenths(answer.ms) });
      const roundedFrames = (gesture: (typeof gestures)[number]) => ({
        ...gesture,
        longest: tenths(gesture.longest),
        frames: gesture.frames.map(tenths),
      });
      const measured = {
        lines: lines.length,
        bytes: bytes.length,
        budgets: { answer: ANSWER_BUDGET, frame: FRAME_BUDGET, rows: ROWS_BOUND, idleFrame: IDLE_FRAME },
        baseline: { ...summary(baseline), frames: baseline.map(tenths) },
        rows: { mounted },
        scroll: { room, page, notch: NOTCH },
        // How long the case took, from its start to its report, in milliseconds: the counts in the file included.
        took: Date.now() - began,
        answers: {
          ...summary(answers.map((answer) => answer.ms)),
          searches: summary(answers.filter((answer) => answer.interaction.startsWith("search ")).map((a) => a.ms)),
          filters: summary(answers.filter((answer) => answer.interaction.startsWith("levels ")).map((a) => a.ms)),
          warm: warmAnswers.map(rounded),
          times: answers.map(rounded),
        },
        frames: {
          ...summary(gestures.map((gesture) => gesture.longest)),
          warm: warmGestures.map(roundedFrames),
          gestures: gestures.map(roundedFrames),
        },
        ...(stopped === undefined ? {} : { stopped: String(stopped) }),
      };

      // Written before anything is asserted, so that a run that fails leaves its numbers.
      console.log(`VIEW-10 ${JSON.stringify(measured)}`);
      await report("view-10-log-performance", measured);
      if (stopped !== undefined) throw stopped;
      // The dataset: the log of the fixtures, as the case of the save wrote it and as the viewer counts it, with
      // its two lines that are cut.
      expect([lines.length, digest, first.lines, first.shown]).toEqual([
        synced.lines,
        synced.sha256,
        synced.lines,
        synced.lines,
      ]);
      expect(tall).toEqual(
        [synced.long.twentyThousand, synced.long.tenThousandAndOne].sort((one, other) => one - other),
      );
      // What the measures broke, each by name, so that one run says all of it: twenty answers of twenty different
      // interactions, none of a text or of a choice the view was given before; twenty gestures to twenty lines; a
      // time for each; the rows mounted at once; the two budgets.
      const lower = (text: string) => text.toLowerCase();
      const seenTexts = [...searchedBefore, ...texts.warm.map((search) => lower(search.text))];
      const seenLevels = [
        ...CHOSEN_BEFORE.map(key),
        ...[...warmChoices, ...noneAgain].map((choice) => key(choice.levels)),
      ];
      const repeatedTexts = texts.measured.filter(
        (search, index) =>
          seenTexts.includes(lower(search.text)) ||
          texts.measured.slice(0, index).some((other) => lower(other.text) === lower(search.text)),
      );
      const repeatedLevels = measuredChoices.filter(
        (choice, index) =>
          seenLevels.includes(key(choice.levels)) ||
          measuredChoices.slice(0, index).some((other) => key(other.levels) === key(choice.levels)),
      );
      const broken: string[] = [];

      if (answers.length !== MEASURED) broken.push(`${answers.length} answers were measured, not ${MEASURED}`);
      for (const search of repeatedTexts) broken.push(`the text "${search.text}" was searched before in the view`);
      for (const choice of repeatedLevels)
        broken.push(`the levels ${key(choice.levels)} were chosen before in the view`);
      if (gestures.length !== MEASURED) broken.push(`${gestures.length} gestures were measured, not ${MEASURED}`);
      if (new Set(places.map((place) => place.line)).size !== places.length) broken.push("two gestures go to one line");
      if (
        [...warmAnswers, ...answers].some((answer) => !(answer.ms > 0)) ||
        [...warmGestures, ...gestures].some((gesture) => gesture.frames.some((ms) => !(ms > 0)))
      ) {
        broken.push("an interaction took no time");
      }
      if (mounted > ROWS_BOUND) broken.push(`${mounted} rows were mounted at once, over the bound of ${ROWS_BOUND}`);
      if (!(measured.answers.p95 < ANSWER_BUDGET)) {
        broken.push(
          `the answers take ${measured.answers.p95} ms at the 95th percentile, over the budget of ${ANSWER_BUDGET}`,
        );
      }
      if (!(measured.frames.p95 < FRAME_BUDGET)) {
        broken.push(
          `the longest frame of a gesture takes ${measured.frames.p95} ms at the 95th percentile, over the budget of ${FRAME_BUDGET}`,
        );
      }
      expect(broken).toEqual([]);
    },
    TIMEOUT,
  );

  it(
    "measures the memory of the window that draws the log of 200,000 lines, at its first line, at its middle and once every row of it is placed, and says what the bound of its list allows in that window",
    async () => {
      const running = application();
      const synced = facts.synced.log;
      // The viewer as it starts: the rows it placed are the ones of its first lines. The list keeps the place
      // of every row it placed, up to the furthest, which is what grows as it is scrolled.
      const first = await freshLog(SYNCED);
      const ratio = await frame.evaluate(() => window.devicePixelRatio || 1);
      const atFirst = await velero.frameMemory(running.app, running.window, frame);
      const middle = await artifacts.scrollLogTo(frame, "backup", Math.floor(synced.lines / 2));
      const atMiddle = await velero.frameMemory(running.app, running.window, frame);
      const last = await artifacts.scrollLogTo(frame, "backup", synced.lines);
      const atLast = await velero.frameMemory(running.app, running.window, frame);
      // The rows the list has room for, in this window: the ones placed no further down than the browser
      // places anything, at the ratio of the window. The log is the longest text of the fixtures.
      const bound = Math.floor(PLACED / Math.max(1, ratio) / artifacts.LINE_HEIGHT);
      const placed = last.rows;
      const perRow = (bytes: number) => Math.round((bytes / Math.max(1, placed - first.mounted.length)) * 10) / 10;
      const heapGrew = atLast.heap.usedBytes - atFirst.heap.usedBytes;
      const processGrew = (atLast.process.workingSetKB - atFirst.process.workingSetKB) * 1024;
      const measured = {
        lines: synced.lines,
        rows: placed,
        ratio,
        bound,
        ownProcess: atLast.ownProcess,
        mounted: { first: first.mounted.length, middle: middle.mounted.length, last: last.mounted.length },
        heapBytes: { first: atFirst.heap.usedBytes, middle: atMiddle.heap.usedBytes, last: atLast.heap.usedBytes },
        workingSetKB: {
          first: atFirst.process.workingSetKB,
          middle: atMiddle.process.workingSetKB,
          last: atLast.process.workingSetKB,
          peak: atLast.process.peakWorkingSetKB,
        },
        // What the places of the rows hold, from what grew between the first line and the last, for each row
        // placed, and what that is at the bound of the list in this window and in a window of ratio one.
        perPlacedRow: { heapBytes: perRow(heapGrew), workingSetBytes: perRow(processGrew) },
        atTheBound: {
          rows: bound,
          heapBytes: Math.round(perRow(heapGrew) * bound),
          workingSetBytes: Math.round(perRow(processGrew) * bound),
        },
        atTheBoundOfRatioOne: {
          rows: Math.floor(PLACED / artifacts.LINE_HEIGHT),
          heapBytes: Math.round(perRow(heapGrew) * Math.floor(PLACED / artifacts.LINE_HEIGHT)),
        },
      };

      console.log(`MEMORY ${JSON.stringify(measured)}`);
      await report("artifact-memory-of-the-longest-list", measured);
      // Nothing of the memory is a budget: it is measured, for the review. What is asserted is what the
      // measure is of: the log whole in the list, a hundred rows mounted at most at each of the three places.
      expect([
        placed,
        last.mounted.includes(synced.lines),
        middle.mounted.includes(Math.floor(synced.lines / 2)),
      ]).toEqual([synced.lines, true, true]);
      expect([first, middle, last].map((shown) => shown.mounted.length).filter((count) => count > ROWS_BOUND)).toEqual(
        [],
      );
      expect(
        [atFirst, atMiddle, atLast].every((taken) => taken.heap.usedBytes > 0 && taken.process.workingSetKB > 0),
      ).toBe(true);
    },
    TIMEOUT,
  );

  it(
    "turns writes off when another installation is selected, and holds nothing of the tabs back in the installation of the demo; and says in the installation of the views, with writes on for it, that the storage location of a backup is not there, before any request, with no command and nothing counted",
    async () => {
      const held = loads[of("backup", "log", SYNCED)];

      if (!held)
        throw new Error(`The log of the backup ${SYNCED} is not loaded: the case that loads it comes before this one`);
      await stay("backup", "log", SYNCED);
      expect((await artifacts.panelState(frame, "backup", "log")).shown).toBe(held.request);
      const earlier = cluster.requestCodes(RESOURCE);
      const writesBefore = cluster.writes(cluster.apiRequests());

      // Another installation: writes are off there, as a change of installation turns them off.
      await cluster.selectInstallation(frame, VIEWS);
      await frame.waitForSelector("[data-testid=velero-writes][data-writes=off]", { timeout: 60_000 });
      expect((await cluster.target(frame)).namespace.startsWith(VIEWS)).toBe(true);
      // Back in the installation of the demo: writes are off, and the tabs of the backup hold nothing.
      await cluster.selectInstallation(frame, NAMESPACE);
      await frame.waitForSelector("[data-testid=velero-writes][data-writes=off]", { timeout: 60_000 });
      await open("backup", "summary", SYNCED);
      for (const tab of artifacts.ARTIFACT_TABS) {
        await artifacts.openTab(frame, "backup", tab);
        const state = await artifacts.panelState(frame, "backup", tab);

        expect([tab, state.step, state.viewer, state.shown]).toEqual([tab, "first", false, ""]);
      }
      loads[of("backup", "log", SYNCED)] = undefined;
      // In the installation of the views, with writes turned on for it: the backup whose storage location is
      // not there is said so before any request, in every tab, with no command.
      await cluster.selectInstallation(frame, VIEWS);
      await frame.waitForSelector("[data-testid=velero-writes-on]", { timeout: 60_000 });
      await cluster.turnWritesOn(frame);
      await open("backup", "summary", MISSING_LOCATION);
      for (const tab of artifacts.ARTIFACT_TABS) {
        const id = (part?: artifacts.PanelPart) => artifacts.PARTS.panel("backup", tab, part);

        await artifacts.openTab(frame, "backup", tab);
        const state = await artifacts.panelState(frame, "backup", tab);

        expect([tab, state.step, state.viewer, state.commands]).toEqual([tab, "first", false, []]);
        expect([tab, await artifacts.said(frame, id("nothing"))]).toEqual([
          tab,
          artifacts.WORDS.noLocationOfTheBackup("backup", MISSING_LOCATION, VIEWS),
        ]);
        expect([
          tab,
          await artifacts.present(frame, id("create")),
          await artifacts.present(frame, id("what")),
          await artifacts.present(frame, id("toTarget")),
        ]).toEqual([tab, false, false, false]);
      }
      await expectNoWrite(earlier, writesBefore);
      expect(cluster.downloadRequests(VIEWS)).toEqual([]);
      expect(await cluster.writesState(frame)).toBe("on");
      expect(await cluster.layoutProblems(frame)).toEqual([]);
      await cluster.captureScreenshot(frame, "dark-artifact-no-location");
    },
    TIMEOUT,
  );

  it(
    "says of the restore without a backup name that there is nothing to ask for, before any request, with no command with writes on and nothing counted",
    async () => {
      // Back in the installation of the demo, where the restore is: a change of installation turned writes
      // off, and they are turned on again for it.
      await cluster.selectInstallation(frame, NAMESPACE);
      await frame.waitForSelector("[data-testid=velero-writes-on]", { timeout: 60_000 });
      await cluster.turnWritesOn(frame);
      const earlier = cluster.requestCodes(RESOURCE);
      const writesBefore = cluster.writes(cluster.apiRequests());
      const restore = read("restore", ORPHAN);

      // The restore was refused without a backup name: it names none, and Velero signs no URL for it.
      expect([restore.status?.phase, restore.spec?.backupName ?? ""]).toEqual(["FailedValidation", ""]);
      await open("restore", "summary", ORPHAN);
      for (const tab of artifacts.ARTIFACT_TABS) {
        const id = (part?: artifacts.PanelPart) => artifacts.PARTS.panel("restore", tab, part);

        await artifacts.openTab(frame, "restore", tab);
        const state = await artifacts.panelState(frame, "restore", tab);

        expect([tab, state.step, state.viewer, state.commands]).toEqual([tab, "first", false, []]);
        expect([tab, await artifacts.said(frame, id("nothing"))]).toEqual([
          tab,
          artifacts.WORDS.noBackupOfTheRestore(ORPHAN, NAMESPACE),
        ]);
        expect([
          tab,
          await artifacts.present(frame, id("create")),
          await artifacts.present(frame, id("what")),
          await artifacts.present(frame, id("toTarget")),
        ]).toEqual([tab, false, false, false]);
      }
      await expectNoWrite(earlier, writesBefore);
      expect(
        cluster
          .downloadRequests(NAMESPACE)
          .map((request) => request.name)
          .filter((name) => !ledger.asked().includes(name)),
      ).toEqual([]);
      expect(await cluster.writesState(frame)).toBe("on");
      expect(await cluster.layoutProblems(frame, cluster.RESTORES)).toEqual([]);
      await cluster.captureScreenshot(frame, "dark-artifact-nothing-to-ask");
    },
    TIMEOUT,
  );

  it(
    "says that the cluster refused the creation to the reader of a part, at the creation, with writes left on and nothing in the namespace",
    async () => {
      const running = application();
      const id = (part?: artifacts.PanelPart) => artifacts.PARTS.panel("backup", "log", part);
      // A second entry of the catalog: the same cluster through the kubeconfig of the reader of a part,
      // which may read the backups, the schedules and the storage locations of the namespace of the views,
      // and create nothing. Its context is renamed: the catalog tells the two entries apart by it.
      const source = JSON.parse(await readFile(cluster.readerKubeconfigPath(), "utf8")) as {
        contexts?: { name: string }[];
        "current-context"?: string;
      };

      for (const context of source.contexts ?? []) context.name = SECOND_CONTEXT;
      source["current-context"] = SECOND_CONTEXT;
      const renamed = path.join(running.directory, "reader-kubeconfig.json");

      await writeFile(renamed, JSON.stringify(source), { mode: 0o600 });
      const second = await cluster.publishKubeconfig(renamed, "velero-e2e-reader");
      let refused = "";

      try {
        await velero.navigateToCatalog(running.app);
        await running.window.waitForSelector(`div.TableCell >> text='${SECOND_CONTEXT}'`, { timeout: 60_000 });
        const other = await cluster.openClusterFromCatalog(running.window, second, SECOND_CONTEXT);

        await cluster.openPage(other, cluster.BACKUPS);
        await cluster.configureInstallation(other, VIEWS);
        await cluster.waitForList(other, cluster.BACKUPS);
        await cluster.openWorkspace(other, OF_THE_READER, cluster.BACKUPS);
        await artifacts.shownAt(other, "backup", OF_THE_READER, "summary");
        await artifacts.openTab(other, "backup", "log");
        await other.waitForSelector("[data-testid=velero-writes-on]", { timeout: 60_000 });
        await cluster.turnWritesOn(other);
        const earlier = cluster.requestCodes(RESOURCE);

        expect((await artifacts.panelState(other, "backup", "log")).commands).toEqual([id("create")]);
        await artifacts.ask(other, "backup", "log");
        expect(await artifacts.confirmationOf(other, "backup", "log")).toMatchObject({
          namespace: VIEWS,
          cluster: `${SECOND_CONTEXT} (context ${SECOND_CONTEXT})`,
        });
        // The guard is told nothing: the request is one the cluster refuses, in a namespace that is not
        // the one of the installation. Its name is kept, to look for it where it is not.
        const { ended, moments } = await artifacts.runLoad(other, "backup", "log", (request) => {
          refused = request;
        });

        expect(ended).toBe("failed");
        expect(await artifacts.failureOf(other, "backup", "log")).toEqual({
          code: "forbidden",
          stage: "creation",
          text: artifacts.WORDS.forbiddenCreation,
        });
        // The reads before the creation were allowed: no step after it was seen.
        const steps = artifacts.stepsSeen(moments);

        expect([
          steps,
          artifacts.inTheOrder(steps, artifacts.STEPS.backup),
          steps.some((step) => artifacts.AFTER_THE_CREATION.includes(step) || step === "pages"),
        ]).toEqual([steps, true, false]);
        // No request was created: the one command takes the tab back to its first state, and has the focus.
        const state = await artifacts.panelState(other, "backup", "log");

        expect([state.step, state.viewer, state.commands]).toEqual(["failed", false, [id("begin")]]);
        expect(await artifacts.said(other, id("notAgain"))).toBe(artifacts.WORDS.notAgain);
        expect(await artifacts.attribute(other, id("failure"), "data-ended")).toBe("fault");
        expect(await cluster.focusOn(other, id("begin"))).toBe(id("begin"));
        // The refusal is of the cluster, not of the gate: writes stay on.
        await other.waitForTimeout(NOTHING);
        expect(await cluster.writesState(other)).toBe("on");
        // Nothing is in the namespace, not the request by its name. The API server counts what reaches
        // the kind: a creation it refuses to the identity is not among what it counts, with any code.
        expect(refused.startsWith(`${OF_THE_READER}-`)).toBe(true);
        expect(since(earlier)).toEqual({});
        expect(cluster.downloadRequests(VIEWS)).toEqual([]);
        expect(await cluster.layoutProblems(other)).toEqual([]);
        await cluster.captureScreenshot(other, "dark-artifact-forbidden");
      } finally {
        // The cases after this one look at the first entry of the catalog, which is shown again.
        await velero.navigateToCatalog(running.app);
        frame = await cluster.openClusterFromCatalog(running.window, kubeconfig);
      }
    },
    TIMEOUT,
  );

  it(
    "says that the cluster refused the port-forward to an identity that may neither get nor create pods/portforward, at the port-forward, with the verb it needs, and leaves no kubectl running",
    async () => {
      const running = application();
      const id = (part?: artifacts.PanelPart) => artifacts.PARTS.panel("backup", "log", part);
      // A third entry of the catalog: the same cluster through the kubeconfig of the identity of the installation
      // that may read what a download reads, create its request and read the route to the store, and has no verb
      // of the port-forward. Its context is renamed: the catalog tells the entries apart by it.
      const source = JSON.parse(await readFile(cluster.withoutPortForwardKubeconfigPath(), "utf8")) as {
        contexts?: { name: string }[];
        "current-context"?: string;
      };

      for (const context of source.contexts ?? []) context.name = THIRD_CONTEXT;
      source["current-context"] = THIRD_CONTEXT;
      const renamed = path.join(running.directory, "no-port-forward-kubeconfig.json");

      await writeFile(renamed, JSON.stringify(source), { mode: 0o600 });
      const third = await cluster.publishKubeconfig(renamed, "velero-e2e-no-port-forward");

      try {
        await velero.navigateToCatalog(running.app);
        await running.window.waitForSelector(`div.TableCell >> text='${THIRD_CONTEXT}'`, { timeout: 60_000 });
        const other = await cluster.openClusterFromCatalog(running.window, third, THIRD_CONTEXT);

        // The identity may not look for the installations of the whole cluster: the one of the demo is named.
        await cluster.openPage(other, cluster.BACKUPS);
        await cluster.configureInstallation(other, NAMESPACE);
        await cluster.waitForList(other, cluster.BACKUPS);
        await cluster.openWorkspace(other, NAMES.backup, cluster.BACKUPS);
        await artifacts.shownAt(other, "backup", NAMES.backup, "summary");
        await artifacts.openTab(other, "backup", "log");
        await other.waitForSelector("[data-testid=velero-writes-on]", { timeout: 60_000 });
        await cluster.turnWritesOn(other);
        const earlier = cluster.requestCodes(RESOURCE);

        await artifacts.ask(other, "backup", "log");
        expect(await artifacts.confirmationOf(other, "backup", "log")).toMatchObject({
          namespace: NAMESPACE,
          cluster: `${THIRD_CONTEXT} (context ${THIRD_CONTEXT})`,
        });
        // The guard is told the request: the cluster creates it for this identity, in the installation of the
        // demo, whose server signs it and removes it ten minutes after, as any other of the suite.
        const { ended, moments, request } = await artifacts.runLoad(other, "backup", "log", told);

        expect(ended).toBe("failed");
        expect(await artifacts.failureOf(other, "backup", "log")).toEqual({
          code: "forbidden",
          stage: "forward",
          text: artifacts.WORDS.forbiddenForward(request, NAMESPACE),
        });
        // The reads of the route were allowed, and the creation: no step after the port-forward was seen.
        const steps = artifacts.stepsSeen(moments);

        expect([
          steps,
          artifacts.inTheOrder(steps, artifacts.STEPS.backup),
          steps.some((step) => ["download", "delivery", "pages"].includes(step)),
        ]).toEqual([steps, true, false]);
        // The request is in the cluster as the confirmation showed it, and the server processed it.
        expectRequest("backup", "log", request);
        expect(since(earlier)["POST 201"]).toBe(1);
        // Asking again as it was asked would be refused again: the one command takes the tab back to its first
        // state, and has the focus.
        const state = await artifacts.panelState(other, "backup", "log");

        expect([state.step, state.viewer, state.commands]).toEqual(["failed", false, [id("begin")]]);
        expect(await artifacts.said(other, id("notAgain"))).toBe(artifacts.WORDS.notAgain);
        expect(await artifacts.attribute(other, id("failure"), "data-ended")).toBe("fault");
        expect(await cluster.focusOn(other, id("begin"))).toBe(id("begin"));
        // No kubectl of the application runs: the one that was refused ended before its line of readiness.
        expect(velero.kubectlForwards(running.app)).toEqual([]);
        // The refusal is of the cluster, not of the gate: writes stay on.
        await other.waitForTimeout(NOTHING);
        expect(await cluster.writesState(other)).toBe("on");
        expect(await cluster.layoutProblems(other)).toEqual([]);
        await cluster.captureScreenshot(other, "dark-artifact-port-forward-refused");
      } finally {
        await velero.navigateToCatalog(running.app);
        frame = await cluster.openClusterFromCatalog(running.window, kubeconfig);
      }
    },
    TIMEOUT,
  );

  it(
    "loads the log of the backup of the demo through the tunnel for an identity whose token an exec plugin gives, which the proxy of the host runs, and neither the extension nor the kubectl of the tunnel does: its text, one creation, and no kubectl left",
    async () => {
      const running = application();
      // A fourth entry of the catalog: the same cluster through the kubeconfig of the identity of the installation
      // whose token an `exec` plugin of the test environment gives, with what the documentation lists for the
      // writes and for a download through the cluster. Its context is renamed: the catalog tells the entries apart
      // by it. The plugin writes the name of the executable of the process that runs it, at each of its runs, in a
      // file of the private state of the environment: nothing ran it before this case.
      const source = JSON.parse(await readFile(cluster.execPluginKubeconfigPath(), "utf8")) as {
        contexts?: { name: string }[];
        "current-context"?: string;
      };

      for (const context of source.contexts ?? []) context.name = FOURTH_CONTEXT;
      source["current-context"] = FOURTH_CONTEXT;
      const renamed = path.join(running.directory, "exec-plugin-kubeconfig.json");

      await writeFile(renamed, JSON.stringify(source), { mode: 0o600 });
      expect(await cluster.execPluginRuns()).toEqual([]);
      const fourth = await cluster.publishKubeconfig(renamed, "velero-e2e-exec-plugin");

      try {
        await velero.navigateToCatalog(running.app);
        await running.window.waitForSelector(`div.TableCell >> text='${FOURTH_CONTEXT}'`, { timeout: 60_000 });
        const other = await cluster.openClusterFromCatalog(running.window, fourth, FOURTH_CONTEXT);

        // The identity may not look for the installations of the whole cluster: the one of the demo is named.
        await cluster.openPage(other, cluster.BACKUPS);
        await cluster.configureInstallation(other, NAMESPACE);
        await cluster.waitForList(other, cluster.BACKUPS);
        await cluster.openWorkspace(other, NAMES.backup, cluster.BACKUPS);
        await artifacts.shownAt(other, "backup", NAMES.backup, "summary");
        await artifacts.openTab(other, "backup", "log");
        await other.waitForSelector("[data-testid=velero-writes-on]", { timeout: 60_000 });
        await cluster.turnWritesOn(other);
        const earlier = cluster.requestCodes(RESOURCE);

        await artifacts.ask(other, "backup", "log");
        expect(await artifacts.confirmationOf(other, "backup", "log")).toMatchObject({
          namespace: NAMESPACE,
          cluster: `${FOURTH_CONTEXT} (context ${FOURTH_CONTEXT})`,
        });
        // The guard is told the request, which the server of the installation signs and removes as any other.
        const { ended, moments } = await artifacts.runLoad(other, "backup", "log", told);

        expect(ended).toBe("loaded");
        const loaded = await artifacts.loadedFacts(other, "backup", "log");
        const asked = since(earlier);

        watch("backup", "log", moments);
        // The request is in the cluster as the confirmation showed it, processed by the server, and the text
        // came through the tunnel, which the kubectl of the host ran for the load.
        expectRequest("backup", "log", loaded.request);
        expectLoaded("backup", "log", loaded);
        // One creation, the reads of the request by its name and what the server wrote into it: nothing else.
        expect(Object.keys(asked).filter((key) => !["GET 200", "PATCH 200", "POST 201"].includes(key))).toEqual([]);
        expect(asked["POST 201"]).toBe(1);
        // No kubectl of the application runs: the one of the load ended with it.
        expect(velero.kubectlForwards(running.app)).toEqual([]);
        // The plugin was run, and by the proxy of the host alone: neither by the main process of the host, where
        // the extension runs, nor by the kubectl of the tunnel, whose kubeconfig names the proxy and no plugin.
        const runs = await cluster.execPluginRuns();

        await report("artifact-runs-of-the-exec-plugin", { runs, route: loaded.route });
        expect(runs.length).toBeGreaterThan(0);
        expect([...new Set(runs)]).toEqual([HOST_PROXY]);
        expect(await cluster.writesState(other)).toBe("on");
        expect(await cluster.layoutProblems(other)).toEqual([]);
        await cluster.captureScreenshot(other, "dark-artifact-exec-plugin");
      } finally {
        await velero.navigateToCatalog(running.app);
        frame = await cluster.openClusterFromCatalog(running.window, kubeconfig);
      }
    },
    TIMEOUT,
  );

  it(
    "keeps one of each thing through a disable and an enable from the Extensions page: writes off until they are turned on, the same procedures, the file of the store saved once for one change, and a load that is one creation, one kubectl and one answer",
    async () => {
      const running = application();
      const identifier = cluster.frameClusterId(frame);
      const procedures = async () => {
        const channels = await velero.watchHandlers(running.app);

        await velero.stopWatchingHandlers(running.app);
        return channels.map((channel) => channel.slice(channel.indexOf(":") + 1)).sort();
      };
      // One change of the store, the installation that is chosen, and the savings of its file the host says.
      const savedFor = async (namespace: string) => {
        const saves = velero.countOutput(STORE_SAVED);

        try {
          await cluster.selectInstallation(frame, namespace);
          await artifacts.until(
            `The store is saved for the installation ${namespace}`,
            async () => saves.count(),
            (count) => count > 0,
          );
          // The host writes a store as soon as it changes: what would come of a second saving comes at once.
          await frame.waitForTimeout(3000);
          return saves.count();
        } finally {
          saves.stop();
        }
      };
      const stored = async () => {
        const [file] = await velero.storedPreferences(running.directory);

        return (file?.content as { selected?: Record<string, string> } | undefined)?.selected?.[identifier];
      };

      // Before the disable: the procedures of the extension, and the savings of one change, which the extension
      // asks of the host once.
      await cluster.openBackups(frame);
      const before = await procedures();

      expect([await savedFor(VIEWS), await stored()]).toEqual([1, VIEWS]);
      expect([await savedFor(NAMESPACE), await stored()]).toEqual([1, NAMESPACE]);
      await writesOn();
      // Disabled from the Extensions page: no kubectl of the application runs after it.
      await velero.disableExtension(running.app, running.window);
      expect(velero.kubectlForwards(running.app)).toEqual([]);
      await velero.enableExtension(running.app, running.window);
      await velero.navigateToCatalog(running.app);
      frame = await cluster.openClusterFromCatalog(running.window, kubeconfig);
      await cluster.openBackups(frame);
      // Enabled again: the same procedures, each once, writes off for the installation the store kept, until they
      // are turned on, and one saving of the file for one change, as before.
      expect(await procedures()).toEqual(before);
      expect(new Set(before).size).toBe(before.length);
      await frame.waitForSelector("[data-testid=velero-writes][data-writes=off]", { timeout: 60_000 });
      expect((await cluster.target(frame)).namespace).toBe(NAMESPACE);
      expect([await savedFor(VIEWS), await stored()]).toEqual([1, VIEWS]);
      expect([await savedFor(NAMESPACE), await stored()]).toEqual([1, NAMESPACE]);
      expect(await cluster.writesState(frame)).toBe("off");
      // A load of the large log of the synced backup, whose kubectl runs long enough to be seen: one creation
      // counted, one kubectl seen while it ran and none after, and one answer of the procedure that runs it.
      await open("backup", "log", SYNCED);
      await cluster.turnWritesOn(frame);
      await velero.watchHandlers(running.app);
      const seen = new Set<number>();
      const look = setInterval(() => {
        for (const kubectl of velero.kubectlForwards(running.app)) seen.add(kubectl);
      }, 100);

      try {
        await loadOf("backup", "log", SYNCED);
      } finally {
        clearInterval(look);
      }
      const answered = (await velero.handledRequests(running.app)).filter((call) => call.channel === "write.run");

      await velero.stopWatchingHandlers(running.app);
      expect([...seen].length).toBe(1);
      expect(velero.kubectlForwards(running.app)).toEqual([]);
      expect(answered.map((call) => call.answer)).toEqual(["ok"]);
    },
    TIMEOUT,
  );

  it(
    "ends the kubectl of a load in flight when its cluster is disconnected in the catalog, turns writes off, and asks nothing of the cluster until it is connected again",
    async () => {
      const running = application();
      const identifier = cluster.frameClusterId(frame);

      // Electron tells the host of every load in the window that does not end: the frame of a cluster disconnected
      // here is taken out of the window, and its load aborted, which the host logs as a frame and not as an error.
      await velero.watchFailedLoads(running.app);
      // The other entries of the catalog the suite opened are disconnected first, as an operator leaves a cluster
      // it is done with: their views read their installation every fifteen seconds while they are shown, and the
      // API server would count those reads with what is looked for here.
      for (const entry of await velero.mainCatalog(running.app)) {
        if (entry.id !== identifier && entry.status === "connected") {
          await velero.disconnectInCatalog(running.app, running.window, entry.id);
        }
      }
      await velero.navigateToCatalog(running.app);
      frame = await cluster.openClusterFromCatalog(running.window, kubeconfig);
      // The large log, whose load lasts longest, with writes on.
      await open("backup", "log", SYNCED);
      await writesOn();
      const earlier = cluster.requestCodes(RESOURCE);

      await artifacts.ask(frame, "backup", "log");
      await artifacts.clickOn(frame, artifacts.PARTS.panel("backup", "log", "confirmCreate"));
      // The kubectl of the load is held where it is as soon as it runs, as a slow link would hold it: the load is
      // on its way through the tunnel while the cluster is disconnected. It is let go once the cluster is not
      // connected any more, which the extension told it to end at.
      const held = await artifacts.until(
        "A kubectl of the application runs for the load",
        async () => velero.kubectlForwards(running.app),
        (found) => found.length > 0,
        60_000,
      );

      try {
        for (const kubectl of held) process.kill(kubectl, "SIGSTOP");
      } catch {
        throw new Error("The load ended before its kubectl could be held: nothing was in flight to disconnect");
      }
      try {
        // The request of the load is in the cluster: the guard is told its name.
        const created = cluster
          .downloadRequests(NAMESPACE)
          .map((request) => request.name)
          .filter((name) => !ledger.asked().includes(name));

        expect(created).toHaveLength(1);
        told(created[0]);
        await velero.disconnectInCatalog(running.app, running.window, identifier);
      } finally {
        for (const kubectl of held) {
          try {
            process.kill(kubectl, "SIGCONT");
          } catch {
            // It ended already.
          }
        }
      }
      // kubectl ends: within the five seconds the extension gives it, and a margin.
      await artifacts.until(
        "The kubectl of the load ended",
        async () => velero.kubectlForwards(running.app),
        (left) => left.length === 0,
        15_000,
      );
      // A minute with the cluster disconnected: it stays so, and nothing of the extension reaches its API server,
      // no request of a DownloadRequest and no read of a family. What the server of the installation writes into
      // the requests it holds, and its removals of them, are its own.
      const requested = cluster.requestCodes(RESOURCE);
      const families = cluster.apiRequests();

      await new Promise((resolve) => setTimeout(resolve, DISCONNECTED_FOR));
      expect((await velero.mainCatalog(running.app)).find((entry) => entry.id === identifier)?.status).toBe(
        "disconnected",
      );
      expect(askedSince(requested)).toEqual({});
      expect(
        Object.keys(cluster.counted(cluster.familyReads(families), cluster.familyReads(cluster.apiRequests()))).filter(
          (key) => !key.startsWith("WATCH "),
        ),
      ).toEqual([]);
      expect(velero.kubectlForwards(running.app)).toEqual([]);
      // Connected again by the operator, from the catalog: the frame of the cluster is a new one, writes are off
      // in it, and the views read the installation again.
      frame = await cluster.openClusterFromCatalog(running.window, kubeconfig);
      await cluster.openBackups(frame);
      await cluster.waitForBackups(frame);
      await frame.waitForSelector("[data-testid=velero-writes][data-writes=off]", { timeout: 60_000 });
      expect(await cluster.writesState(frame)).toBe("off");
      // One creation for the load, and nothing else of the requests.
      expect(since(earlier)["POST 201"]).toBe(1);
      // What Electron told the host of the loads that did not end is of the frames the disconnections took out:
      // each a frame inside the window, its load aborted, and none of the window itself.
      const aborted = await velero.failedLoads(running.app);

      await report("artifact-loads-the-disconnections-ended", aborted);
      expect(aborted.filter((load) => load.mainFrame || load.code !== -3)).toEqual([]);
    },
    TIMEOUT,
  );

  it(
    "shows a step that only the main process tells in one load of the suite at least, and in every load whose part in the main process was shown for a second or longer",
    async () => {
      // The views ask the main process where a load is four times a second, and draw by themselves the wait
      // for a place and the pages of the text: a load seen at those two alone says nothing of the asking.
      // One whose part in the main process the panel showed for a second or longer was asked several
      // times, and showed a step of it. A shorter one proves nothing by itself, and is said in the report:
      // the order of the steps of a load long enough to be watched is of the case of the large log. The
      // loads of the suite are many, though, and the main process waits a quarter of a second between two
      // reads of a request Velero has not signed yet: one of them at least was asked meanwhile, and showed
      // what was answered; and the load of the large log lasts seconds, and shows its steps. A suite whose loads all showed the wait for a place and the pages alone never
      // drew a step the main process told.
      const shownLong = watched.filter((load) => load.lasted >= WATCHABLE);
      const asked = "the loads that showed a step only the main process tells";

      await report("artifact-steps-of-the-loads", {
        watchable: WATCHABLE,
        loads: watched.map((load) => ({ ...load, watchable: load.lasted >= WATCHABLE })),
      });
      if (shownLong.length === 0) {
        console.log(
          `No load of the suite was shown for ${WATCHABLE} ms before its pages: no step of the main process was looked for`,
        );
      }
      expect(watched.length).toBeGreaterThan(0);
      expect(shownLong.filter((load) => load.told.length === 0)).toEqual([]);
      expect([asked, watched.filter((load) => load.told.length > 0).length > 0]).toEqual([asked, true]);
    },
    TIMEOUT,
  );

  it(
    "leaves nothing behind: the server removes each request ten minutes after it signed it, and nothing else of Velero was written",
    async () => {
      const asked = ledger.asked();
      let left: cluster.DownloadRequestRead[] = [];
      let unseen: unknown;

      // First what is wanted of every run, whatever failed in it, and needs nothing of the application: the
      // wait for the server, then what the API server counted, written beside the pictures. A suite that
      // gave no second gesture waits for nothing.
      const waited = Date.now();

      try {
        left = await cluster.awaitRequestsGone(NAMESPACE, lastLoad > 0 ? lastLoad + REMOVED_WITHIN : Date.now());
      } catch (error) {
        unseen = error;
      }
      // How long the wait took, for who reads the run: it is most of what the suite takes after its last load.
      console.log(
        `The server removed the requests of the suite after ${Math.round((Date.now() - waited) / 1000)} seconds of waiting, ` +
          `${Math.round((Date.now() - lastLoad) / 1000)} seconds after the last load`,
      );
      const {
        "GET 200": reads = 0,
        "PATCH 200": patched = 0,
        ...rest
      } = cluster.counted(counted, cluster.requestCodes(RESOURCE));
      const others = Object.keys(
        cluster.counted(cluster.writes(written), cluster.writes(cluster.apiRequests())),
      ).filter((key) => key.split(" ")[1] !== RESOURCE);

      await report("artifact-requests-of-the-suite", {
        gestures,
        asked,
        left: left.map((request) => request.name),
        reads,
        patched,
        ...rest,
        others,
        ...(unseen === undefined ? {} : { wait: String(unseen) }),
      });
      // A request no server looked at is said by its name, as the wait said it.
      if (unseen !== undefined) throw unseen;
      // The server removed every request of the namespace.
      expect(left.map((request) => request.name)).toEqual([]);
      // Every creation the API server counted is of a request the guard knows by its name, and the server
      // removed as many. Beside them, the reads of each by its name and what the server wrote into each, and
      // nothing else. This is of what was counted: a creation the API server refuses to the identity is not
      // among what it counts, with any code, and the counters say nothing of one.
      expect(rest).toEqual({ "POST 201": asked.length, "DELETE 200": asked.length });
      expect(reads).toBeGreaterThanOrEqual(asked.length);
      // The server writes into a request once, when it signs it: as many writes as requests the ledger
      // holds, which every run recorded and this case pins. A server that writes a request twice, or never,
      // fails it. The reads are more: the main process reads a request by its name until it is signed.
      expect(patched).toBe(asked.length);
      // No request of another kind of Velero that is not a read, by whoever.
      expect(others).toEqual([]);
      expect(before.requests).toBe(0);
      expect(cluster.clusterSnapshot()).toEqual(before);
      // Writes are turned off as the operator would, where they are not off already: the suite leaves the
      // gate as it found it. The command is there only while writes are on, or not known.
      if ((await cluster.writesState(frame)) !== "off") {
        await artifacts.clickOn(frame, "velero-writes-off");
        await frame.waitForSelector("[data-testid=velero-writes][data-writes=off]", { timeout: 60_000 });
      }
      expect(await cluster.writesState(frame)).toBe("off");
      // Last, what says that every case before this one gave its gesture: eighteen loads that end with their
      // text, three that end as a file the store does not have, one that ends at the port-forward, one whose
      // cluster is disconnected while it runs, and two that are cancelled, each a request of its own but for
      // the first cancelled one, which created one or none. A case that failed before its gesture is found
      // here, after everything else was read.
      expect(["the second gestures of the suite", gestures]).toEqual(["the second gestures of the suite", GESTURES]);
      expect(asked.length).toBeGreaterThanOrEqual(GESTURES - 1);
      expect(asked.length).toBeLessThanOrEqual(GESTURES);
    },
    TIMEOUT,
  );

  it(
    "leaves no error in the application",
    async () => {
      expect(errors.errors()).toEqual([]);
    },
    TIMEOUT,
  );
});
