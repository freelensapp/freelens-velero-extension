/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

// The Schedules, in a packaged Freelens, against the fixtures of the test
// environment: the schedules Velero took, refused and has not read, one with
// a history of backups, the ones whose backups go where none is taken, and
// the adherence of each, its next run computed by the suite from the object
// and the clock. The suite reads the application and the cluster, and writes
// to neither.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as cluster from "../../integration/helpers/velero-cluster";
import * as velero from "../../integration/helpers/velero-extension";

import type { Frame } from "playwright";

const TIMEOUT = 10 * 60 * 1000;
const SCHEDULES = cluster.SCHEDULES;
const HISTORY = [
  "views-history-0",
  "views-history-1",
  "views-history-2",
  "views-history-3-again",
  "views-history-3",
  "views-history-4",
  "views-history-5",
  "views-history-6",
];
const text = (value: string) => value.replace(/\s+/g, " ").trim();
// How long what must not happen is waited for: longer than the frame the host opens a menu in.
const NOTHING = 1500;
const MENU = ".Menu .MenuItem";
const DIALOG = '[data-testid="confirmation-dialog"], .Dialog, .ConfirmDialog';
// No view of a schedule says when it should have run but where its adherence is said: the cells of the next run
// and of the adherence in the list, the band of its view, and two items of the details of the host.
const EXPECTATION = /next run|overdue|missed|expected run|is late|should have/i;
// The order by adherence, from what needs a hand first.
const WEIGHTS: Record<string, number> = {
  overdue: 0,
  held: 1,
  due: 2,
  "at-every-look": 3,
  "not-known": 4,
  awaited: 5,
  refused: 6,
  paused: 7,
};
const LABELS: Record<string, string> = { awaited: "Awaited", due: "Due", overdue: "Overdue" };
// The schedules of the installation of the views whose zone no backup gives, or that Velero has not read, and the
// paused ones.
const NOT_KNOWN = [
  "schedule-new",
  "schedule-unread",
  "views-daily",
  "views-history",
  "views-submitted",
  "views-to-archive",
  "views-to-default",
  "views-to-removed",
];
const PAUSED = ["schedule-skipping", "schedule-unread-paused"];

// A time as the band writes it in UTC: to the second, with the name of the zone.
function inUtc(time: string): string {
  return `${new Date(time).toISOString().slice(0, 19).replace("T", " ")} UTC`;
}

describe("views of the schedules", () => {
  let started: velero.StartedApplication;
  let frame: Frame;
  const errors = velero.createErrorCollector();
  let before: cluster.ClusterSnapshot;
  let counted: Record<string, number>;

  beforeAll(async () => {
    if (!cluster.fixturesReady()) {
      throw new Error(cluster.fixturesMissing());
    }
    before = cluster.clusterSnapshot();
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
    counted = cluster.apiRequests();
    frame = await cluster.openClusterFromCatalog(started.window, kubeconfig);
    await velero.setWindowSize(started.app, 1440, 900);
    await cluster.countAddressChanges(frame);
  }, TIMEOUT);

  afterAll(async () => {
    if (started) errors.stop(started.window);
    await started?.cleanup();
  }, TIMEOUT);

  it(
    "lists the schedules with paused and validation as two facts, and what Velero has not read as such",
    async () => {
      await cluster.openPage(frame, SCHEDULES);
      expect(Object.keys(await cluster.veleroSidebarEntries(frame))).toEqual([
        "velero",
        "velero-overview",
        "velero-backups",
        "velero-restores",
        "velero-schedules",
        "velero-storage-locations",
        "velero-snapshot-locations",
        "velero-backup-repositories",
        "velero-pod-volume-backups",
        "velero-pod-volume-restores",
      ]);
      await frame.waitForSelector("[data-testid=velero-state-choose]", { timeout: 60_000 });
      await frame.click(`[data-testid="velero-choice-${cluster.E2E_STATIC_NAMESPACE}"]`);
      await cluster.waitForList(frame, SCHEDULES);
      expect((await cluster.mounted(frame, SCHEDULES)).sort()).toEqual([
        "schedule-enabled",
        "schedule-invalid",
        "schedule-paused",
      ]);
      // Each value in the cell of its column. None of these schedules has a backup among the ones that
      // exist, and that is what the list says.
      await cluster.expectCells(SCHEDULES, frame, "schedule-enabled", {
        schedule: "0 0 1 1 *",
        paused: "Not paused",
        next: "Not known",
        adherence: "Not known",
        submitted: "Not reported",
        newest: "None that exists",
        phase: "Enabled",
      });
      await cluster.expectCells(SCHEDULES, frame, "schedule-paused", {
        paused: "Paused",
        next: "None",
        adherence: "Paused",
        phase: "Enabled",
      });
      await cluster.expectCells(SCHEDULES, frame, "schedule-invalid", {
        schedule: "invalid-synthetic-cron",
        paused: "Paused",
        next: "None",
        adherence: "Paused",
        phase: "Failed validation",
      });
      // No run is said of a schedule that is paused, whatever its validation; a schedule of five fields whose zone
      // no backup of the installation gives is not known, with its reason.
      expect(await cluster.rowAdherence(frame, "schedule-enabled")).toEqual({
        next: "not-known",
        state: "not-known",
        mark: "not-known",
        reason: "no-offset",
      });
      for (const name of ["schedule-paused", "schedule-invalid"]) {
        expect([name, await cluster.rowAdherence(frame, name)]).toEqual([
          name,
          { next: "none", state: "paused", mark: "paused", reason: "" },
        ]);
      }
      expect(
        await cluster.wordsOutside(frame, "[data-testid=velero-schedules]", ".TableCell.next, .TableCell.adherence"),
      ).not.toMatch(EXPECTATION);
      // No object of the installation reports a time after the clock of this machine: nothing is said over the list.
      expect(await frame.locator("[data-testid=velero-schedules-note]").count()).toBe(0);
      // Every page of the group has the tabs of the group, and the layout of the host once.
      expect((await frame.locator(".TabLayout .Tabs .Tab").allInnerTexts()).map(text)).toEqual([
        "Overview",
        "Backups",
        "Restores",
        "Schedules",
        "Backup Storage Locations",
        "Volume Snapshot Locations",
        "Backup Repositories",
        "Pod Volume Backups",
        "Pod Volume Restores",
      ]);
      expect(await frame.locator(".TabLayout .TabLayout").count()).toBe(0);
      expect(await cluster.notices(frame, [])).toEqual({});
      expect(await cluster.layoutProblems(frame, SCHEDULES)).toEqual([]);
      await cluster.captureScreenshot(frame, "dark-schedules");
    },
    TIMEOUT,
  );

  it(
    "shows the expression of a schedule Velero refused as it is written, with why it refused it",
    async () => {
      const workspace = frame.locator("[data-testid=velero-schedule-workspace]");

      await cluster.openWorkspace(frame, "schedule-invalid", SCHEDULES);
      expect(await workspace.locator("[data-testid=velero-schedule-expression]").innerText()).toBe(
        "invalid-synthetic-cron",
      );
      expect(await workspace.locator("[data-testid=velero-schedule-messages]").innerText()).toContain(
        "Synthetic invalid schedule",
      );
      // Paused before its validation: the band says the pause, and nothing else of the view says a run.
      const band = await cluster.adherenceBand(frame);

      expect(band.state).toBe("paused");
      expect(band.lines.next).toContain(
        "Paused: no run is expected until it is resumed. Velero refused its expression when it last read it, which is before the pause.",
      );
      expect(
        await cluster.wordsOutside(
          frame,
          "[data-testid=velero-schedule-workspace]",
          "[data-testid=velero-schedule-adherence]",
        ),
      ).not.toMatch(EXPECTATION);
      await cluster.captureScreenshot(frame, "dark-schedule-invalid");
      await cluster.closeWorkspace(frame);
    },
    TIMEOUT,
  );

  it(
    "says of the schedules Velero does not read what is to be known of them",
    async () => {
      await cluster.selectInstallation(frame, cluster.E2E_VIEWS_NAMESPACE);
      await cluster.expectCells(SCHEDULES, frame, "schedule-new", { paused: "Not paused", phase: "New" });
      await cluster.expectCells(SCHEDULES, frame, "schedule-unread", { paused: "Not paused", phase: "Not reported" });
      await cluster.expectCells(SCHEDULES, frame, "schedule-unread-paused", {
        paused: "Paused",
        phase: "Not reported",
      });
      // Of what Velero has not read no run is said: not known while it is not paused, none while it is.
      for (const name of ["schedule-new", "schedule-unread"]) {
        expect([name, await cluster.rowAdherence(frame, name)]).toEqual([
          name,
          { next: "not-known", state: "not-known", mark: "not-known", reason: "not-read" },
        ]);
      }
      expect(await cluster.rowAdherence(frame, "schedule-unread-paused")).toEqual({
        next: "none",
        state: "paused",
        mark: "paused",
        reason: "",
      });
      // What Velero has not validated does not carry the mark of what it took.
      expect(
        await frame
          .locator("[data-testid=velero-schedules] .TableRow", {
            has: frame.locator('[data-schedule-row="schedule-unread"]'),
          })
          .locator("[data-validation]")
          .getAttribute("data-validation"),
      ).toBe("not-validated");
      await cluster.openWorkspace(frame, "schedule-skipping", SCHEDULES);
      const workspace = frame.locator("[data-testid=velero-schedule-workspace]");
      const status = text(await workspace.locator("[data-testid=velero-schedule-status]").innerText());
      const notes = await workspace.locator("[data-testid=velero-schedule-notes] li").allInnerTexts();

      expect(status).toMatch(/PAUSED Paused/i);
      expect(status).toMatch(/SKIP IMMEDIATELY Yes/i);
      expect(status).toContain("Time zone: The one of the Velero server, which this view does not read");
      expect(notes).toEqual([
        "Velero does not read a schedule while it is paused: its validation and its errors are the ones written before the pause.",
        "When Velero reads the schedule again it writes the time of that reading as the last skipped, sets skip immediately back to no, and counts the next run from that time.",
      ]);
      // Paused, and what a resume would do is not known: the zone its expression is read in is the one of the
      // server, which no backup of the installation gives. Its submission is not among the backups that exist.
      const band = await cluster.adherenceBand(frame);

      expect(band.state).toBe("paused");
      expect(band.order).toEqual(["next", "zone", "observed", "clocks"]);
      expect(band.lines.next).toContain(
        "Paused: no run is expected until it is resumed. Whether Velero would submit a backup at once when it is resumed is not known, since the time zone of the Velero server is not known.",
      );
      expect(band.lines.zone).toMatch(/^Not known: the one of the Velero server/);
      expect(band.lines.observed).toContain(
        "Last submission 2026-08-01 00:00:00 UTC: its backup is not among the backups that exist",
      );
      expect(band.ways).toEqual([]);
      await cluster.captureScreenshot(frame, "dark-schedule-paused");
      await cluster.closeWorkspace(frame);

      await cluster.openWorkspace(frame, "schedule-unread-paused", SCHEDULES);
      expect(await workspace.locator("[data-testid=velero-schedule-notes] li").allInnerTexts()).toEqual([
        "Velero has not read this schedule, and will not until it is resumed.",
      ]);
      await cluster.closeWorkspace(frame);
    },
    TIMEOUT,
  );

  it(
    "shows the last submission and the newest backup as two values, and the newest is the one that never started",
    async () => {
      await cluster.expectRowOf(
        SCHEDULES,
        frame,
        "views-history",
        "0 1 * * *",
        "Not paused",
        "views-history-0",
        "1 validation error",
        "Enabled",
      );
      await cluster.expectRowOf(SCHEDULES, frame, "views-daily", "views-daily-20260901030000", "2 warnings");
      await cluster.expectRowOf(SCHEDULES, frame, "views-zoned", "CRON_TZ=Europe/Rome 30 2 * * *", "None that exists");
      expect(await cluster.mounted(frame, SCHEDULES)).toHaveLength(12);
      expect(await cluster.layoutProblems(frame, SCHEDULES)).toEqual([]);
      await cluster.captureScreenshot(frame, "dark-schedules-with-history");
    },
    TIMEOUT,
  );

  it(
    "shows the history of a schedule, from the newest, on a line of time and in a list",
    async () => {
      // Opening a schedule asks nothing of the cluster: its history was read with the installation. It is
      // opened in the time between two reads of the installation, with the counters of the API server
      // read before and after.
      expect(
        await cluster.readsDuring(
          frame,
          () => cluster.openWorkspace(frame, "views-history", SCHEDULES),
          () => cluster.closeWorkspace(frame),
        ),
      ).toEqual({});
      const workspace = frame.locator("[data-testid=velero-schedule-workspace]");
      const shown = await cluster.history(frame);

      expect(shown.rows).toEqual(HISTORY);
      expect(await workspace.locator("[data-testid=velero-history-counts]").innerText()).toBe(
        "8 backups that exist: 5 completed; 3 ended with a failure.",
      );
      // Every backup is on the line, from the oldest, and no mark is drawn over another: it holds however
      // old the environment is.
      expect(cluster.backupsOnTheLine(shown.marks)).toEqual([...HISTORY].reverse());
      expect(shown.over).toEqual([]);
      // Each day has its mark, and the two backups that are an hour apart are one.
      expect(cluster.dayOnTheLine(shown.width)).toBeGreaterThan(2 * cluster.MARK_WIDTH);
      expect(shown.marks).toEqual([
        "views-history-6",
        "views-history-5",
        "views-history-4",
        "views-history-3-again,views-history-3",
        "views-history-2",
        "views-history-1",
        "views-history-0",
      ]);
      const group = workspace.locator('[data-strip-mark="views-history-3-again,views-history-3"]');

      expect(await group.innerText()).toBe("2");
      expect(await group.getAttribute("data-failing")).toBe("true");
      expect(await group.getAttribute("aria-label")).toContain("2 backups close to each other");
      const newest = workspace.locator('[data-history-row="views-history-0"]');

      expect(text(await newest.innerText())).toContain("Failed validation");
      expect(text(await newest.innerText())).toContain("(created, did not start)");
      expect(await workspace.locator('[data-strip-mark="views-history-0"]').getAttribute("data-not-started")).toBe(
        "true",
      );
      expect(text(await workspace.locator("[data-testid=velero-schedule-newest]").innerText())).toContain(
        "views-history-0",
      );
      // The last submission is the time the newest backup was created, as the release writes the two, and
      // what the release wrote into the schedule when it read it is shown.
      const status = text(await workspace.locator("[data-testid=velero-schedule-status]").innerText());
      const submitted = cluster.kubectlE2E(
        "get",
        "backups.velero.io",
        "views-history-0",
        "--namespace",
        cluster.E2E_VIEWS_NAMESPACE,
        "-o",
        "jsonpath={.metadata.creationTimestamp}",
      );

      expect(submitted.status).toBe(0);
      expect(
        cluster
          .kubectlE2E(
            "get",
            "schedules.velero.io",
            "views-history",
            "--namespace",
            cluster.E2E_VIEWS_NAMESPACE,
            "-o",
            "jsonpath={.status.lastBackup}",
          )
          .stdout.trim(),
      ).toBe(submitted.stdout.trim());
      expect(status).toMatch(/SKIP IMMEDIATELY No/i);
      expect(await workspace.innerText()).toContain("These are the backups that exist now");
      // Its backups are not named as Velero names the backup of a submission: the zone of the server is not
      // derived from them, and the backup of the last submission is not among the ones that exist. The newest
      // backup, views-history-0, was created first and is the submission's time: it is named as the newest that
      // exists. The other backups of the history are created after it, in its second or in a later one: when some
      // are after the submission, the newest of those is named first, as a backup that is not a submission.
      const band = await cluster.adherenceBand(frame);
      const listed = cluster.kubectlE2E(
        "get",
        "backups.velero.io",
        "--namespace",
        cluster.E2E_VIEWS_NAMESPACE,
        "--selector",
        "velero.io/schedule-name=views-history",
        "-o",
        'jsonpath={range .items[*]}{.metadata.name}={.metadata.creationTimestamp}{"\\n"}{end}',
      );

      expect(listed.status).toBe(0);
      const after = listed.stdout
        .trim()
        .split("\n")
        .map((line) => line.split("="))
        .filter(
          ([name, created]) => name !== "views-history-0" && Date.parse(created) > Date.parse(submitted.stdout.trim()),
        )
        .map(([name]) => `velero-open-backup-${name}`);

      expect(band.state).toBe("not-known");
      expect(band.order).toEqual(["next", "zone", "anchor", "observed", "clocks"]);
      expect(band.lines.next).toContain(
        "Not known: the expression names no time zone, and the one of the Velero server is not read.",
      );
      expect(band.lines.anchor).toBe(`The last submission, ${inUtc(submitted.stdout.trim())}`);
      expect(band.lines.observed).toContain(
        `Last submission ${inUtc(submitted.stdout.trim())}: its backup is not among the backups that exist`,
      );
      expect(band.lines.observed).toContain("The newest backup of the schedule that exists is views-history-0.");
      expect(band.ways.at(-1)).toBe("velero-open-backup-views-history-0");
      if (after.length) {
        expect(band.ways).toHaveLength(2);
        expect(after).toContain(band.ways[0]);
        expect(band.lines.observed).toContain("is not a submission of the schedule");
      } else {
        expect(band.ways).toHaveLength(1);
      }
      expect(
        await cluster.wordsOutside(
          frame,
          "[data-testid=velero-schedule-workspace]",
          "[data-testid=velero-schedule-adherence]",
        ),
      ).not.toMatch(EXPECTATION);
      expect(await cluster.notices(frame, [])).toEqual({});
      expect(await cluster.layoutProblems(frame, SCHEDULES)).toEqual([]);
      await cluster.captureScreenshot(frame, "dark-schedule-workspace");
      await workspace.locator("[data-testid=velero-history-strip]").scrollIntoViewIfNeeded();
      await cluster.captureScreenshot(frame, "dark-schedule-history");
    },
    TIMEOUT,
  );

  it(
    "shows alone the backups of a mark that holds more than one, and leads from a mark to its backup",
    async () => {
      const workspace = frame.locator("[data-testid=velero-schedule-workspace]");

      await workspace.locator('[data-strip-mark="views-history-3-again,views-history-3"]').click();
      expect((await cluster.history(frame)).rows).toEqual(["views-history-3-again", "views-history-3"]);
      expect(await workspace.locator("[data-testid=velero-history-shown]").innerText()).toContain(
        "The 2 backups of one mark are shown.",
      );
      await cluster.captureScreenshot(frame, "dark-schedule-history-mark");
      await workspace.locator("[data-testid=velero-history-shown] button").click();
      expect((await cluster.history(frame)).rows).toEqual(HISTORY);
      // Every step changes the address once, and the address names the views that are open.
      const changes: [step: string, changes: number, views: string[]][] = [];
      const step = async (name: string, take: () => Promise<void>) => {
        const before = await cluster.addressChanges(frame);

        await take();
        changes.push([name, (await cluster.addressChanges(frame)) - before, await cluster.addressViews(frame)]);
      };

      await step("from a mark to its backup", async () => {
        await workspace.locator('[data-strip-mark="views-history-4"]').click();
        await frame.waitForSelector('[data-testid=velero-backup-name] >> text="views-history-4"', { timeout: 60_000 });
      });
      expect(await cluster.shownView(frame)).toEqual({
        kind: "backup",
        name: "views-history-4",
        back: "arrow_back Schedules / views-history",
      });
      expect(await frame.locator("[data-testid=velero-schedules-page]").count()).toBe(1);
      // The backup names its schedule, which is where it was opened from: the way back, not a way further.
      await step("from the backup to its schedule", () => cluster.followTo(frame, "schedule", "views-history"));
      expect(await cluster.shownView(frame)).toEqual({
        kind: "schedule",
        name: "views-history",
        back: "arrow_back Schedules",
      });
      await step("to the newest backup", () => cluster.followTo(frame, "backup", "views-history-0"));
      expect(text(await frame.locator("[data-testid=velero-backup-status]").innerText())).toMatch(
        /STARTED Not reported/i,
      );
      await step("back with Escape", async () => {
        await started.window.keyboard.press("Escape");
        await frame.waitForSelector('[data-testid=velero-schedule-name] >> text="views-history"', { timeout: 60_000 });
      });
      expect(changes).toEqual([
        ["from a mark to its backup", 1, ["schedule/views-history", "backup/views-history-4"]],
        ["from the backup to its schedule", 1, ["schedule/views-history"]],
        ["to the newest backup", 1, ["schedule/views-history", "backup/views-history-0"]],
        ["back with Escape", 1, ["schedule/views-history"]],
      ]);
    },
    TIMEOUT,
  );

  it(
    "shows the template as the schedule carries it, what it refers to, and the restores that name the schedule",
    async () => {
      const workspace = frame.locator("[data-testid=velero-schedule-workspace]");
      const location = await cluster.reference(
        frame,
        "velero-reference-BackupStorageLocation-views-available",
        "resolved",
      );

      expect(location.state).toBe("resolved");
      expect(location.text).toContain("Available, ReadWrite");
      expect(
        (await cluster.reference(frame, "velero-reference-VolumeSnapshotLocation-views-snapshots", "resolved")).state,
      ).toBe("resolved");
      expect(await workspace.locator("[data-testid=velero-schedule-location-warning]").count()).toBe(0);
      expect(await workspace.locator('[data-scope="retention"]').innerText()).toBe("720h0m0s");
      expect(await workspace.locator('[data-scope="cluster-resources"]').innerText()).toBe("No");
      expect(await workspace.locator('[data-scope="excluded-namespaces"]').innerText()).toBe("Not set");
      expect(await workspace.locator("[data-testid=velero-schedule-template]").innerText()).not.toMatch(
        /undefined|null|NaN/,
      );
      expect((await cluster.reference(frame, "velero-related-restores", "listed")).text).toBe("None");
      await workspace.locator("[data-testid=velero-schedule-template]").scrollIntoViewIfNeeded();
      await cluster.captureScreenshot(frame, "dark-schedule-template");
      await cluster.closeWorkspace(frame);

      await cluster.openWorkspace(frame, "views-daily", SCHEDULES);
      const restores = await cluster.reference(frame, "velero-related-restores", "listed");

      // The restores Velero took of a backup of the schedule carry its name, which Velero wrote.
      expect(restores.state).toBe("listed");
      expect(restores.text).toBe(
        "restore-mapped (Waiting for plugin operations), restore-of-daily-completed (Completed), " +
          "restore-of-daily-partiallyfailed (Partially failed)",
      );
      expect(await workspace.locator("[data-testid=velero-schedule-restores-note]").innerText()).toContain(
        "was asked from it, or from a backup of it",
      );
      await cluster.followTo(frame, "restore", "restore-mapped");
      expect((await cluster.shownView(frame))?.back).toBe("arrow_back Schedules / views-daily");
      // The restore names the schedule, which is a way to its view now that the schedules have one.
      expect(await frame.locator('[data-testid="velero-reference-Schedule-views-daily"] button').innerText()).toBe(
        "views-daily",
      );
      // The way back leads to the schedule the restore was opened from.
      await frame.locator("[data-testid=velero-back]").click();
      await frame.waitForSelector('[data-testid=velero-schedule-name] >> text="views-daily"', { timeout: 60_000 });
      expect(await cluster.shownView(frame)).toEqual({
        kind: "schedule",
        name: "views-daily",
        back: "arrow_back Schedules",
      });
      await cluster.showList(frame);
    },
    TIMEOUT,
  );

  it(
    "says where the backups of a schedule go, and when the place does not take them",
    async () => {
      const workspace = frame.locator("[data-testid=velero-schedule-workspace]");

      await cluster.openWorkspace(frame, "views-to-removed", SCHEDULES);
      expect(
        (await cluster.reference(frame, "velero-reference-BackupStorageLocation-views-removed", "absent")).state,
      ).toBe("absent");
      expect(await workspace.locator("[data-testid=velero-schedule-location-warning]").innerText()).toContain(
        "The release refuses a backup sent to a location that is not there.",
      );
      await cluster.closeWorkspace(frame);

      await cluster.openWorkspace(frame, "views-to-archive", SCHEDULES);
      expect(
        (await cluster.reference(frame, "velero-reference-BackupStorageLocation-views-archive", "resolved")).text,
      ).toContain("Available, ReadOnly");
      expect(await workspace.locator("[data-testid=velero-schedule-location-warning]").innerText()).toContain(
        "it is read-only",
      );
      await workspace.locator("[data-testid=velero-schedule-references]").scrollIntoViewIfNeeded();
      await cluster.captureScreenshot(frame, "dark-schedule-location-refused");
      await cluster.closeWorkspace(frame);

      await cluster.openWorkspace(frame, "views-to-default", SCHEDULES);
      const fallback = workspace.locator("[data-testid=velero-schedule-default-location]");

      expect(await fallback.getAttribute("data-default")).toBe("marked");
      expect(await fallback.innerText()).toBe(
        "Not set: Velero uses the location marked default, views-available (Available, ReadWrite).",
      );
      expect(await workspace.locator("[data-testid=velero-schedule-location-warning]").count()).toBe(0);
      await cluster.closeWorkspace(frame);

      await cluster.openWorkspace(frame, "views-zoned", SCHEDULES);
      expect(text(await workspace.locator("[data-testid=velero-schedule-status]").innerText())).toContain(
        "Time zone: Europe/Rome, named by the expression",
      );
      await cluster.closeWorkspace(frame);
    },
    TIMEOUT,
  );

  it(
    "says the next run of a schedule that names its zone, counted from its creation, in its row and in its band",
    async () => {
      // Velero has submitted nothing of it: its run is the first 02:30 of Europe/Rome after its creation, and it
      // is awaited until then, due for the grace after it and overdue after that.
      const created = cluster.kubectlE2E(
        "get",
        "schedules.velero.io",
        "views-zoned",
        "--namespace",
        cluster.E2E_VIEWS_NAMESPACE,
        "-o",
        "jsonpath={.metadata.creationTimestamp}",
      );

      expect(created.status).toBe(0);
      const creation = Date.parse(created.stdout.trim());
      const run = cluster.halfPastTwoInRome(creation);
      const ran = cluster.inRome(run);
      const before = Date.now();
      const row = await cluster.rowAdherence(frame, "views-zoned");
      const cells = await cluster.cellsOf(SCHEDULES, frame, "views-zoned");

      expect(row.next).toBe("at");
      expect(cluster.statesAround(run, before, Date.now())).toContain(row.state);
      expect(cells.adherence).toBe(LABELS[row.state]);
      expect(cells.next).toMatch(row.state === "awaited" ? /^in \d/ : / ago$/);

      await cluster.openWorkspace(frame, "views-zoned", SCHEDULES);
      const shown = Date.now();
      const band = await cluster.adherenceBand(frame);
      const begun = cluster.inRome(creation);

      expect(cluster.statesAround(run, shown, Date.now())).toContain(band.state);
      expect(band.order).toEqual(["next", "zone", "anchor", "observed", "passed", "clocks"]);
      // The run in the zone of the expression, with its date when it is not the day of the clock there.
      const forms = [...new Set([shown - 20_000, Date.now()].map((clock) => cluster.inRome(clock).date))].map((day) =>
        day === ran.date ? "02:30 Europe/Rome" : `02:30 Europe/Rome on ${ran.date}`,
      );

      expect([band.lines.next, forms.some((form) => new RegExp(`${form}[.,]`).test(band.lines.next))]).toEqual([
        band.lines.next,
        true,
      ]);
      expect(band.lines.next).toMatch(/A schedule is due for \S+ after its expected run, and overdue after that/);
      expect(band.lines.zone).toBe("Europe/Rome, named by the expression");
      expect(band.lines.anchor).toBe(
        `The creation of the schedule, ${begun.date} ${begun.minute}:${begun.second} Europe/Rome`,
      );
      expect(band.lines.observed).toBe("No submission is written in the schedule.");
      expect(band.lines.passed).toMatch(
        band.state === "awaited" ? /^None yet: the expected run is ahead$/ : /^\d+ expected runs? passed/,
      );
      // The header Date of the API server reaches the frame through the proxies of the host (AGENTS.md), so the
      // times are compared by the clock of the cluster; how far it is from the one of this machine is the clock
      // of Docker's machine, which can drift by a second or more after a sleep: the form is asserted, not the gap.
      expect(band.lines.clocks).toMatch(
        /^Times are compared by the clock of the cluster, which the time its API server writes in its answers gives: it is (within a second of the clock of this machine|(ahead of|behind) the clock of this machine by \d+[dhms]( \d+[dhms])?)\.$/,
      );
      expect(band.ways).toEqual([]);
      expect(await cluster.layoutProblems(frame, SCHEDULES)).toEqual([]);
      await cluster.captureScreenshot(frame, "dark-schedule-adherence");
      await cluster.closeWorkspace(frame);
    },
    TIMEOUT,
  );

  it(
    "leads from a backup to its schedule and back, over the list of the backups",
    async () => {
      await cluster.openBackups(frame);
      await cluster.waitForBackups(frame);
      await cluster.openWorkspace(frame, "views-history-2");
      await cluster.followTo(frame, "schedule", "views-history");
      expect(await cluster.shownView(frame)).toEqual({
        kind: "schedule",
        name: "views-history",
        back: "arrow_back Backups / views-history-2",
      });
      expect(await frame.locator("[data-testid=velero-backups-page]").count()).toBe(1);
      await cluster.closeWorkspace(frame);
      await cluster.closeWorkspace(frame);
      expect(await cluster.focusOn(frame, "views-history-2")).toBe("views-history-2");
      // A backup that names a schedule that is not there has a name with its reason, and no way.
      await cluster.openWorkspace(frame, "backup-missing-schedule");
      expect((await cluster.reference(frame, "velero-reference-Schedule-views-removed", "absent")).state).toBe(
        "absent",
      );
      expect(await frame.locator('[data-testid="velero-reference-Schedule-views-removed"] button').count()).toBe(0);
      await cluster.closeWorkspace(frame);
      await cluster.openPage(frame, SCHEDULES);
      await cluster.waitForList(frame, SCHEDULES);
    },
    TIMEOUT,
  );

  it(
    "orders by the next run and by adherence, both ways, and finds the schedules of a state by its word",
    async () => {
      // The rows of the list, in their order once the head of a column is clicked.
      const ordered = async (column: string, expected: string[]) => {
        const deadline = Date.now() + 10_000;
        let names: string[] = [];

        await frame.click(`[data-testid=velero-schedules] .TableHead .TableCell.${column}`);
        do {
          names = await cluster.mounted(frame, SCHEDULES);
          if (names.join() === expected.join()) break;
          await frame.waitForTimeout(250);
        } while (Date.now() < deadline);
        return names;
      };
      // The two schedules that submitted two days before the fixtures were started and have no backup: the
      // interval is overdue at every age of the environment, and the one of five fields is not known for want of
      // the zone of the server.
      expect(await cluster.rowAdherence(frame, "views-interval")).toEqual({
        next: "at",
        state: "overdue",
        mark: "late",
        reason: "",
      });
      expect(await cluster.rowAdherence(frame, "views-submitted")).toEqual({
        next: "not-known",
        state: "not-known",
        mark: "not-known",
        reason: "no-offset",
      });
      // By the next run: the instants from the earliest, then what is not known, then what has none, each by name.
      // The run of the interval was expected two days back, before the one of the schedule that names its zone,
      // which is after its creation. The second click reverses all of it.
      const byNext = ["views-interval", "views-zoned", ...NOT_KNOWN, ...PAUSED];

      expect(await ordered("next", byNext)).toEqual(byNext);
      expect(await ordered("next", [...byNext].reverse())).toEqual([...byNext].reverse());
      // By adherence: what needs a hand first, what is not known before what is on time, the paused ones last. Of
      // what is overdue, the interval was expected first.
      const zoned = await cluster.rowAdherence(frame, "views-zoned");
      const before = WEIGHTS[zoned.state] < WEIGHTS["not-known"];
      const byAdherence = [
        "views-interval",
        ...(before ? ["views-zoned"] : []),
        ...NOT_KNOWN,
        ...(before ? [] : ["views-zoned"]),
        ...PAUSED,
      ];

      expect(await ordered("adherence", byAdherence)).toEqual(byAdherence);
      expect(await ordered("adherence", [...byAdherence].reverse())).toEqual([...byAdherence].reverse());
      // The word of a state finds the schedules in it, and the sentence of the state is not searched.
      expect([...(await cluster.search(frame, "Not known", SCHEDULES))].sort()).toEqual(NOT_KNOWN);
      expect([...(await cluster.search(frame, "derived from the backup of a last submission", SCHEDULES))]).toEqual([]);
      await cluster.search(frame, "", SCHEDULES);
    },
    TIMEOUT,
  );

  // Before the case that resizes a column: the host keeps the width a resize gives every column of the list, and
  // this case measures the list as the stylesheet draws it.
  it(
    "gives its room to the columns that say what a schedule does, at each width where a column gives its own",
    async () => {
      const all = [
        "name",
        "installation",
        "schedule",
        "paused",
        "next",
        "adherence",
        "submitted",
        "newest",
        "phase",
        "age",
      ];
      const without = (...gone: string[]) => all.filter((column) => !gone.includes(column));
      // The columns that hold their words whole in a list of 1,000 pixels or more, the age where it is shown.
      const whole = ["paused", "next", "adherence", "submitted", "age"];
      let width = 1440;
      let zoom = 1;
      // The width of the window and the zoom each room was reached at, in the report of the case.
      const reached: Record<number, { width: number; zoom: number }> = {};
      // The window is set so that the room of the list is the one asked, by the difference measured; with the
      // window zoomed out when it cannot be made wide enough for it within the screen, and zoomed in when it cannot
      // be made narrow enough.
      const roomOf = async (room: number) => {
        for (const factor of [1, 0.8, 2]) {
          if (factor !== zoom) {
            zoom = factor;
            await velero.setZoom(started.app, zoom);
          }
          for (let tries = 0; tries < 4; tries += 1) {
            const now = await cluster.listRoom(frame, SCHEDULES);

            if (Math.round(now) === room) {
              reached[room] = { width, zoom };
              return;
            }
            width += Math.round((room - now) * zoom);
            const inner = await frame.evaluate(() => window.innerWidth);

            await velero.setWindowSize(started.app, width, 900);
            await frame
              .waitForFunction((before) => window.innerWidth !== before, inner, { timeout: 5_000 })
              .catch(() => undefined);
          }
        }
        throw new Error(`The room of the list of the schedules could not be made ${room} pixels`);
      };
      const shown: Record<number, string[]> = {};
      // At each room: what is cut of the columns that hold their words whole there, what is clipped with no
      // ellipsis and no tip, and the words that leave the line of their row.
      const read: Record<number, { cut: string[]; clipped: string[]; misaligned: string[] }> = {};

      // The window and the zoom are given back whatever happens: every later case reads the window of 1440 by 900.
      try {
        for (const edge of [1200, 1000, 760, 640]) {
          for (const room of [edge + 1, edge]) {
            await roomOf(room);
            const columns = await cluster.columnsOf(SCHEDULES, frame);

            shown[room] = columns.shown;
            read[room] = {
              cut: room >= 1000 ? columns.cut.filter((column) => whole.includes(column)) : [],
              clipped: columns.clipped,
              misaligned: await cluster.misalignedWords(SCHEDULES, frame),
            };
          }
        }
        // On a Mac with a work area of 1,792 by 1,003 pixels and on the hosted runner, 1,920 by 1,200, every room was
        // reached at the zoom of 1, with a window 323 pixels wider than the room: from 963 pixels for 640 to 1,524 for
        // 1,201. The report keeps the widths, the zoom and the work area of each run.
        expect(read).toEqual(
          Object.fromEntries(Object.keys(read).map((room) => [room, { cut: [], clipped: [], misaligned: [] }])),
        );
        expect(shown).toEqual({
          1201: without(),
          1200: without("installation"),
          1001: without("installation"),
          1000: without("installation", "age"),
          761: without("installation", "age"),
          760: without("installation", "submitted", "newest", "age"),
          641: without("installation", "submitted", "newest", "age"),
          640: without("installation", "schedule", "submitted", "newest", "age"),
        });
        expect(await cluster.layoutProblems(frame, SCHEDULES)).toEqual([]);
      } finally {
        // The report is written whatever happens: it says how far the rooms were reached when one was not.
        const screen = await started.app.evaluate(({ screen }) => screen.getPrimaryDisplay().workAreaSize);

        await cluster.writeReport("schedules-rooms", { screen, reached, shown, read });
        await velero.setZoom(started.app, 1);
        await velero.setWindowSize(started.app, 1440, 900);
        await frame.waitForFunction(() => window.innerWidth > 1000, undefined, { timeout: 60_000 });
      }
      // In a window of 1440 paused, the next run, the adherence, the last submission and the age are read whole, in
      // any language and at any age the host writes, nothing is clipped and every word is on the line of its row.
      const wide = await cluster.columnsOf(SCHEDULES, frame);

      expect(wide.cut.filter((column) => whole.includes(column))).toEqual([]);
      expect(wide.clipped).toEqual([]);
      expect(await cluster.misalignedWords(SCHEDULES, frame)).toEqual([]);
      expect(await cluster.tooWide(SCHEDULES, frame, cluster.WORDS_OF_A_SCHEDULE)).toEqual([]);
    },
    TIMEOUT,
  );

  it(
    "keeps the search, the order and the width of a column when a schedule is opened and closed",
    async () => {
      expect([...(await cluster.search(frame, "views-to", SCHEDULES))].sort()).toEqual([
        "views-to-archive",
        "views-to-default",
        "views-to-removed",
      ]);
      await frame.click("[data-testid=velero-schedules] .TableHead .TableCell.schedule");
      const resized = await cluster.resizeColumn(frame, "name", 90, SCHEDULES);

      // The edge was dragged to the right: the column is wider. The columns that hold their words whole
      // do not give all the room that was asked of them.
      expect(resized.after - resized.before).toBeGreaterThan(30);
      const state = await cluster.listState(frame, SCHEDULES);

      expect(state.search).toBe("views-to");
      expect(state.sorted).toMatch(/^schedule /);
      // The order is the one of the expression, as the rows show it.
      const expressions = await Promise.all(
        (await cluster.mounted(frame, SCHEDULES)).map(
          async (name) => (await cluster.cellsOf(SCHEDULES, frame, name)).schedule,
        ),
      );

      expect(expressions).toHaveLength(3);
      expect([[...expressions].sort(), [...expressions].sort().reverse()]).toContainEqual(expressions);
      await cluster.openWorkspace(frame, "views-to-archive", SCHEDULES);
      await cluster.closeWorkspace(frame);
      const back = await cluster.listStateLike(frame, state, SCHEDULES);

      expect(back.search).toBe(state.search);
      expect(back.sorted).toBe(state.sorted);
      expect(back.items).toBe(state.items);
      expect(back.first).toBe(state.first);
      expect(Math.abs(back.columns.name - state.columns.name)).toBeLessThanOrEqual(1);
      await cluster.search(frame, "", SCHEDULES);
    },
    TIMEOUT,
  );

  it(
    "offers no way to select, edit, delete, pause or run a schedule, by pointer or by keyboard",
    async () => {
      const list = frame.locator("[data-testid=velero-schedules]");

      expect(await list.locator(".TableCell.checkbox, .Checkbox, input[type=checkbox]").count()).toBe(0);
      expect(await list.locator(".TableCell.menu .Icon, .MenuActions").count()).toBe(0);
      expect(await list.locator(".AddRemoveButtons button, .add-button, .remove-button").count()).toBe(0);
      // What must not happen is waited for, for longer than the host takes to open a menu, and is
      // expected not to have happened: the host opens the menu of a row in the frame after the click.
      const appears = (selector: string) =>
        frame.waitForSelector(selector, { state: "visible", timeout: NOTHING }).then(
          () => true,
          () => false,
        );

      await frame.locator('[data-schedule-row="views-history"]').click({ button: "right" });
      expect(await appears(MENU)).toBe(false);
      await cluster.showList(frame);
      await frame.locator('[data-schedule-row="views-history"]').focus();
      for (const key of ["Delete", "Backspace", "Control+a", "Meta+Backspace"]) {
        await started.window.keyboard.press(key);
        expect([key, await appears(DIALOG)]).toEqual([key, false]);
        expect([key, await cluster.shownView(frame)]).toEqual([key, undefined]);
      }
      expect(await list.locator(".TableRow.selected, .TableRow.checked").count()).toBe(0);
      // The same click on the list the host shows of the same objects opens its menu: what is looked for
      // above is what the host shows when it offers to edit and to delete.
      await cluster.navigate(frame, "/crd/velero.io/schedules");
      await cluster.selectHostNamespace(frame, cluster.E2E_VIEWS_NAMESPACE);
      await frame.locator(".TableRow", { hasText: "views-history" }).first().click({ button: "right" });
      await frame.waitForSelector(MENU, { state: "visible", timeout: 60_000 });
      expect((await frame.locator(MENU).allInnerTexts()).join(" ")).toMatch(/Delete/);
      // So are the boxes that select a row, and the dialog the host asks a confirmation with: it is opened
      // and left with its way out, and the last case of the suite finds that nothing was written.
      expect(await frame.locator(".TableRow .TableCell.checkbox").count()).toBeGreaterThan(0);
      await frame.locator(MENU, { hasText: "Delete" }).first().click();
      await frame.waitForSelector(DIALOG, { state: "visible", timeout: 60_000 });
      await frame.locator(".ConfirmDialog .confirm-buttons .cancel").click();
      await frame.waitForSelector(DIALOG, { state: "hidden", timeout: 60_000 });
      if (await frame.locator(MENU).count()) await started.window.keyboard.press("Escape");
      await frame.waitForSelector(MENU, { state: "hidden", timeout: 60_000 });
      await cluster.openPage(frame, SCHEDULES);
      await cluster.waitForList(frame, SCHEDULES);
      await cluster.openWorkspace(frame, "views-history", SCHEDULES);
      const controls = await frame
        .locator("[data-testid=velero-schedule-workspace]")
        .locator("button, a, input, select, textarea")
        .evaluateAll((elements) =>
          elements.map(
            (element) => element.getAttribute("data-testid") ?? (element.hasAttribute("data-strip-mark") ? "mark" : ""),
          ),
        );

      // The way back, the ways to the other views and the marks of the line: nothing that writes.
      expect(controls.filter((control) => control !== "mark" && !control.startsWith("velero-open-"))).toEqual([
        "velero-back",
      ]);
      expect(await frame.locator("[data-testid=velero-schedule-workspace]").innerText()).not.toMatch(
        /\b(delete|edit|pause now|resume|run now|trigger)\b/i,
      );
      await cluster.closeWorkspace(frame);
    },
    TIMEOUT,
  );

  it(
    "gives the details of the host the same reading, and a way to the workspace for the installation selected",
    async () => {
      const created = cluster.kubectlE2E(
        "get",
        "schedules.velero.io",
        "views-zoned",
        "--namespace",
        cluster.E2E_VIEWS_NAMESPACE,
        "-o",
        "jsonpath={.metadata.creationTimestamp}",
      );

      expect(created.status).toBe(0);
      const run = cluster.halfPastTwoInRome(Date.parse(created.stdout.trim()));
      const listedAt = Date.now();
      const listed = await cluster.rowAdherence(frame, "views-zoned");

      await cluster.navigate(frame, "/crd/velero.io/schedules");
      await cluster.selectHostNamespace(frame, cluster.E2E_VIEWS_NAMESPACE);
      const details = await cluster.hostDetails(
        frame,
        "views-zoned",
        "Enabled",
        "Not paused",
        "CRON_TZ=Europe/Rome 30 2 * * *",
        "Europe/Rome, named by the expression",
        "Next run",
        "Adherence",
      );
      const drawer = "[data-testid=velero-schedule-details]";
      const said = await frame.locator(drawer).evaluate((element) => ({
        next: element.querySelector("[data-next]")?.getAttribute("data-next") ?? "",
        state: element.querySelector("[data-adherence]")?.getAttribute("data-adherence") ?? "",
      }));
      const ran = cluster.inRome(run);
      const forms = [...new Set([listedAt - 20_000, Date.now()].map((clock) => cluster.inRome(clock).date))].map(
        (day) => (day === ran.date ? "02:30 Europe/Rome" : `02:30 Europe/Rome on ${ran.date}`),
      );

      // The details say what the row says, with the clock of their own: the same run, in a state of the span.
      expect(said.next).toBe(listed.next);
      expect(cluster.statesAround(run, listedAt, Date.now())).toEqual(
        expect.arrayContaining([listed.state, said.state]),
      );
      expect([details, forms.some((form) => new RegExp(`${form}[.,]`).test(details))]).toEqual([details, true]);
      // Outside the two items nothing says when the schedule should have run, and the first is named Next run.
      expect(
        (await cluster.wordsOutside(frame, drawer, "[data-next], [data-adherence], [data-adherence-words]")).replace(
          "Next run",
          "",
        ),
      ).not.toMatch(EXPECTATION);
      expect(await frame.locator("[data-testid=velero-schedule-details-link]").count()).toBe(1);
      await cluster.captureScreenshot(frame, "dark-host-details-schedule");
      await cluster.closeDetails(frame);

      await cluster.selectHostNamespace(frame, cluster.E2E_STATIC_NAMESPACE);
      await cluster.hostDetails(frame, "schedule-invalid", "Failed validation", "Paused", "Synthetic invalid schedule");
      expect(text(await frame.locator("[data-testid=velero-schedule-details]").innerText())).toContain(
        "the ones written before the pause",
      );
      expect(await frame.locator("[data-testid=velero-schedule-details-link]").count()).toBe(0);
      expect(await frame.locator("[data-testid=velero-schedule-details-elsewhere]").innerText()).toContain(
        cluster.E2E_STATIC_NAMESPACE,
      );
      // Of an installation that is not the one selected nothing was read: paused comes before anything it would
      // need of it.
      expect(
        await frame.locator("[data-testid=velero-schedule-details] [data-adherence]").getAttribute("data-adherence"),
      ).toBe("paused");
      await cluster.closeDetails(frame);

      await cluster.selectHostNamespace(frame, cluster.E2E_VIEWS_NAMESPACE);
      await cluster.hostDetails(frame, "views-history", "Enabled");
      await frame.click("[data-testid=velero-schedule-details-link]");
      await frame.waitForSelector('[data-testid=velero-schedule-name] >> text="views-history"', { timeout: 60_000 });
      expect(await frame.locator("[data-testid=velero-schedules-page]").count()).toBe(1);
      // The link leads to the view of the extension: the drawer is gone with the address that named the object,
      // and neither the log of the main process nor the ones of the frames have an error.
      expect(await cluster.hostDetailsGone(frame)).toEqual({ drawer: false, address: false });
      expect(Object.values(await velero.hostLogErrors(started.app)).flat()).toEqual([]);
      expect((await cluster.history(frame)).rows).toEqual(HISTORY);
      await cluster.closeWorkspace(frame);
    },
    TIMEOUT,
  );

  it(
    "leaves the objects of Velero as they were, and asks Velero for nothing",
    async () => {
      const after = cluster.clusterSnapshot();
      const requests = cluster.apiRequests();

      expect(after.versions).toEqual(before.versions);
      expect(after.installed).toEqual(before.installed);
      expect(before.requests).toBe(0);
      expect(after.requests).toBe(0);
      // No request of any kind of Velero that is not a read, by whoever: the suite writes nothing, and the
      // installation under test has nothing to do.
      expect(cluster.writes(counted, requests)).toEqual({});
      // Of the whole cluster only the storage locations were listed, once, which is how the installations
      // are found.
      expect(cluster.counted(cluster.clusterReads(counted), cluster.clusterReads(requests))).toEqual({
        "LIST backupstoragelocations cluster": 1,
      });
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
