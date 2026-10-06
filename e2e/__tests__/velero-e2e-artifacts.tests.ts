/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

// The tabs Log, Results, Resources and Volumes of the workspace of a backup and
// of a restore, in a packaged Freelens, against the test environment: the
// backup the controller of the demo took, and the restore it ran of it. A tab
// asks nothing when it opens; it shows the request before it creates it; and
// what it loads is what the release wrote of the operation into the store.
//
// The suite asks the extension to write: each load is a DownloadRequest in the
// namespace of the installation, created through the gate. It tells its guard
// the name of each one, reads each in the cluster by that name, and counts the
// creations on the API server. It deletes none, and neither does the extension:
// the server removes a request ten minutes after it signed it, and the suite
// waits for that. So what creates a request comes first, the restore before
// the backup, and what creates none comes after it, while the server counts
// its ten minutes: the tabs of the backup hold their texts until the end. The
// one thing that does not wait is the saving of the log, which follows its
// load: the main process holds a text for ten minutes and no longer.
//
// A case looks at one thing, and starts from the view the case before it left
// without asking anything of that case but the text it needs: a load that
// failed fails its own case, and the cases of the other tabs go on.
//
// Nothing here is a number copied from a run: what is expected of an artifact
// is what the release writes of any operation, what the status of the object
// says, and what the suite counts in the file it saved.
//
// The suite takes about twelve minutes, ten of them the wait for the
// server: a request it left behind would fail the last case of every suite
// after it.

import { mkdir, readdir, readFile, rename, rm, stat } from "node:fs/promises";
import * as path from "node:path";
import { expect } from "@jest/globals";
import * as artifacts from "../helpers/velero-artifacts";
import * as cluster from "../helpers/velero-cluster";
import * as velero from "../helpers/velero-extension";

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
// The second gestures the cases of the suite give: nine loads that end with their text, which are the four
// tabs of the restore, the log of the backup twice and its other three tabs, and the one that is cancelled.
const GESTURES = 10;
// The rows a list of lines mounts at most.
const ROWS_BOUND = 100;
// What is pictured of the tabs for the review, in both themes, whenever the suite runs: the picture of a
// load while it runs is beside these, and is taken when a load lasts long enough to be pictured.
const PICTURED = ["first", "confirmation", "log", "results", "resources", "volumes"];
const LOADING = "loading";

interface OperationRead {
  spec?: { storageLocation?: string };
  status?: {
    phase?: string;
    errors?: number;
    warnings?: number;
    progress?: { totalItems?: number; itemsBackedUp?: number; itemsRestored?: number };
  };
}

describe("the log, the results, the resources and the volumes of an operation", () => {
  let started: velero.StartedApplication | undefined;
  let frame: Frame;
  let before: cluster.ClusterSnapshot;
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
  const open = async (kind: artifacts.Operation, tab: artifacts.WorkspaceTab) => {
    await artifacts.openWorkspaceOf(frame, kind, NAMES[kind]);
    if (tab !== "summary") await artifacts.openTab(frame, kind, tab);
  };
  // The view of an operation at a tab, as the case before left it: it is opened from its list only when it
  // is not the one that is shown, since a view that is opened again holds nothing of what its tabs loaded.
  const stay = async (kind: artifacts.Operation, tab: artifacts.WorkspaceTab) => {
    if (await artifacts.viewOf(frame, kind, NAMES[kind])) await artifacts.openTab(frame, kind, tab);
    else await open(kind, tab);
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
  // Where the suite has the log of the backup saved: under the profile of the run, which goes with it.
  const savedInto = () => {
    const directory = path.join(application().directory, "saved-by-the-suite");

    return { directory, file: path.join(directory, "the-log-of-the-backup.txt") };
  };
  // The log of the backup, shown with the command that saves it. The main process holds a text for ten
  // minutes after its load, and the command goes when that time has passed: a case that comes to it later
  // says so by name, with what the tab says of until when, and not as a command that was not found.
  const toTheSave = async () => {
    const id = (part: artifacts.PanelPart) => artifacts.PARTS.panel("backup", "log", part);
    const loaded = loads["backup/log"];

    if (!loaded) throw new Error("The log of the backup is not loaded: the case that loads it comes before this one");
    await stay("backup", "log");
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
  const expectAsked = (calls: velero.SaveDialogCall[]) => {
    const title = artifacts.WORDS.saveTitle("backup", "log", NAMES.backup, NAMESPACE, CLUSTER);

    expect(
      artifacts.signedUrlIn({
        "the title of the dialog": calls.map((call) => call.title).join("\n"),
        "the message of the dialog": calls.map((call) => call.message).join("\n"),
        "the file the dialog suggests": calls.map((call) => call.defaultPath).join("\n"),
      }),
    ).toEqual([]);
    expect(calls).toEqual([
      { title, message: title, defaultPath: artifacts.WORDS.savedFile("backup", "log", NAMES.backup) },
    ]);
  };
  // A part of the viewer of the log of the backup.
  const logPart = (part?: artifacts.ViewerPart) => artifacts.PARTS.viewer("backup", "log", part);
  // The keys that move among the lines of the log are of its list: it is given the focus before them.
  const toTheList = async () => {
    await (await artifacts.part(frame, logPart("text"))).focus();
  };
  // The log of the backup in a viewer that starts anew, at its first line, with no search, no level chosen
  // and its lines not wrapped: a viewer keeps what was chosen in it for as long as its tab is shown, and
  // each case of the log starts from none of it. The text is the one that was loaded: nothing is asked.
  const freshLog = async () => {
    const loaded = loads["backup/log"];

    if (!loaded) throw new Error("The log of the backup is not loaded: the case that loads it comes before this one");
    await stay("backup", "results");
    await artifacts.openTab(frame, "backup", "log");
    const state = await artifacts.panelState(frame, "backup", "log");

    if (state.step !== "loaded" || !state.viewer || state.shown !== loaded.request) {
      throw new Error(
        `The log of the backup is not shown as it was loaded: its tab is at ${state.step}, ` +
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
  const read = (kind: artifacts.Operation): OperationRead => {
    const found = cluster.veleroObject<OperationRead>(FAMILIES[kind], NAMES[kind]);

    if (!found) {
      throw new Error(
        `The ${kind} ${NAMES[kind]} is not in ${NAMESPACE}: the environment is older than its backup lasts. ` +
          "Create it again with `pnpm demo:down` and `pnpm demo:up`.",
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
  const watch = (kind: artifacts.Operation, tab: artifacts.ArtifactTab, moments: artifacts.LoadMoment[]) => {
    watched.push({
      load: `${kind}/${tab}`,
      ...artifacts.toldByTheMainProcess(moments),
      steps: artifacts.stepsSeen(moments),
    });
  };
  // The request of a load that ended with its text: it is in the cluster under the name the tab gives it,
  // as the confirmation showed it and processed by the server. And nothing the guard was not told is in the
  // namespace, which is expected last: what it finds is of another load, and hides nothing of this one.
  const expectRequest = (kind: artifacts.Operation, tab: artifacts.ArtifactTab, request: string) => {
    const identifier = request.slice(NAMES[kind].length + 1);
    const held = cluster.downloadRequests(NAMESPACE);
    const mine = held.find((entry) => entry.name === request);

    expect([kind, tab, request, mine !== undefined, ledger.asked().includes(request)]).toEqual([
      kind,
      tab,
      request,
      true,
      true,
    ]);
    expect([kind, tab, request.startsWith(`${NAMES[kind]}-`), IDENTIFIER.test(identifier)]).toEqual([
      kind,
      tab,
      true,
      true,
    ]);
    expect([kind, tab, mine?.target]).toEqual([
      kind,
      tab,
      { kind: artifacts.ARTIFACTS[tab].targets[kind], name: NAMES[kind] },
    ]);
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
  const loadOf = async (kind: artifacts.Operation, tab: artifacts.ArtifactTab) => {
    const earlier = cluster.requestCodes(RESOURCE);
    const loaded = await artifacts.load(frame, kind, tab, told, { loading: () => loadingPicture(kind, tab) });

    // What the tab loaded is kept first: the cases after this one start from it, whatever is found of it here.
    loads[`${kind}/${tab}`] = loaded;
    watch(kind, tab, loaded.moments);
    expectRequest(kind, tab, loaded.request);
    expect([kind, tab, since(earlier)["POST 201"]]).toEqual([kind, tab, 1]);
    expectLoaded(kind, tab, loaded);

    return loaded;
  };
  // What holds of the results of an operation whose plugins ran no operation of their own: the file counts
  // what the status counts, a counter the status does not write being a count of none, and the tab has
  // nothing to say of a difference. The errors come first, then the warnings, each by Velero, the cluster
  // and the namespaces by their names.
  const expectResults = async (kind: artifacts.Operation) => {
    const status = read(kind).status ?? {};
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
      throw new Error(`The fixtures are missing from ${cluster.E2E_CLUSTER_NAME}. Run \`pnpm demo:up\` first.`);
    }
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
    let kubeconfig = "";

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
  // it started is of another run, and is said at once.
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
          loads[`restore/${tab}`] ? "loaded" : "the tab loaded nothing in the case before this one",
          loads[`restore/${tab}`]?.request,
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

      loads["backup/log"] = { ...loaded, moments };
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
      const first = loads["backup/log"];

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
      loads["backup/log"] = undefined;
      const { moments } = await artifacts.runLoad(frame, "backup", "log", told, {
        loading: () => loadingPicture("backup", "log"),
      });
      const second = await artifacts.loadedFacts(frame, "backup", "log");

      loads["backup/log"] = { ...second, moments };
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
          if (state.step !== "loaded" || !state.viewer || state.shown !== loads[`backup/${tab}`]?.request) {
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

        if (state.step !== "loaded" || !state.viewer || state.shown !== loads[`backup/${tab}`]?.request) {
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
      const loaded = loads["backup/log"];
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
          loads[`backup/${tab}`] ? "loaded" : "the tab loaded nothing in the cases before this one",
          loads[`backup/${tab}`] !== undefined,
          loads[`backup/${tab}`]?.request,
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

  it(
    "shows a step that only the main process tells in one load of the suite at least, and in every load whose part in the main process was shown for a second or longer",
    async () => {
      // The views ask the main process where a load is four times a second, and draw by themselves the wait
      // for a place and the pages of the text: a load seen at those two alone says nothing of the asking.
      // One whose part in the main process the panel showed for a second or longer was asked several
      // times, and showed a step of it. A shorter one proves nothing by itself, and is said in the report:
      // the order of the steps of a load long enough to be watched is of the case of the large log. The
      // loads of the suite are nine, though, and the main process waits a quarter of a second between two
      // reads of a request Velero has not signed yet: one of them at least was asked meanwhile, and showed
      // what was answered. A suite whose loads all showed the wait for a place and the pages alone never
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
      try {
        left = await cluster.awaitRequestsGone(NAMESPACE, lastLoad > 0 ? lastLoad + REMOVED_WITHIN : Date.now());
      } catch (error) {
        unseen = error;
      }
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
      expect(patched).toBeGreaterThanOrEqual(asked.length);
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
      // Last, what says that every case before this one gave its gesture: nine loads that end with their
      // text and one that is cancelled, each a request of its own but for the cancelled one, which created
      // one or none. A case that failed before its gesture is found here, after everything else was read.
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

  // What follows needs the fixtures of the tabs, which are not in the environment yet: two backups synced
  // from the store, one of them without its log, with artifacts made for the tabs; a backup and a restore
  // the server refuses; and a restore asked from a schedule that has no backup.
  it.todo(
    "says of the synced backup without a log that the store does not have the file, by the phase of a backup that ended, and shows its empty results, resource list and volume information",
  );
  it.todo(
    "says of the log of the backup and of the restore that failed their validation that Velero writes nothing for an operation that failed its validation, with a request each",
  );
  it.todo(
    "shows the results, the resources and the volumes of the synced backup as the fixtures wrote them: errors of two namespaces and warnings of Velero and of the cluster, the counts and the filters, each volume with its details",
  );
  it.todo(
    "cancels the load of the large log once the panel names its request, then loads it again and sees its steps in their order and its pages rise",
  );
  it.todo(
    "shows the log of 200,000 lines: saved as it was stored, a hundred rows mounted at most, the count of each level, the searches with their counts, the lines that are cut and the one across two pages",
  );
  it.todo(
    "answers a search and a filter of the log of 200,000 lines within 250 milliseconds, and draws each frame of a scroll within 50",
  );
  it.todo(
    "says of the restore without a backup name that there is nothing to ask for, with no command with writes on and nothing counted",
  );
  // These two need no fixture that is not there: they are of another installation and of another identity.
  it.todo(
    "turns writes off for another installation and holds no text of the one before, and says before any request that the storage location of a backup is not there",
  );
  it.todo(
    "says that the cluster refused the creation to the reader of a part, with writes left on and nothing in the namespace",
  );
});
