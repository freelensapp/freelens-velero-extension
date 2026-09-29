/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

// The Backup Storage Locations and the Volume Snapshot Locations, in a
// packaged Freelens, against the test environment: the location the
// controller of the installation validates every minute, and the synthetic
// ones no controller reads, which report what was written into them days
// ago, or nothing. The suite reads the application and the cluster, and
// writes to neither.

import { expect } from "@jest/globals";
import * as utils from "../helpers/utils";
import * as cluster from "../helpers/velero-cluster";
import * as velero from "../helpers/velero-extension";

import type { Frame } from "playwright";

const TIMEOUT = 10 * 60 * 1000;
const STORAGE = cluster.STORAGE_LOCATIONS;
const SNAPSHOT = cluster.SNAPSHOT_LOCATIONS;
const text = (value: string) => value.replace(/\s+/g, " ").trim();
// How long what must not happen is waited for: longer than the frame the host opens a menu in.
const NOTHING = 1500;
const MENU = ".Menu .MenuItem";
const DIALOG = '[data-testid="confirmation-dialog"], .Dialog, .ConfirmDialog';
const LATE = ", may be out of date";
const REFUSED =
  "The reviewed release refuses the backups sent to a storage location that it does not report Available, and the restores of the backups the location holds.";

describe("views of the locations", () => {
  let started: velero.StartedApplication;
  let frame: Frame;
  const errors = velero.createErrorCollector();
  let before: cluster.ClusterSnapshot;
  let counted: Record<string, number>;
  // What a band shows in words, as it is read: the names of the marks are not words of the view.
  const words = (selector: string) =>
    frame.locator(selector).evaluate((element) => {
      let shown = (element as HTMLElement).innerText.replace(/\s+/g, " ").trim();

      for (const icon of element.querySelectorAll(".Icon")) {
        const name = (icon.textContent ?? "").trim();

        if (name) shown = shown.replace(`${name} `, "");
      }
      return shown;
    });
  const status = (of: cluster.ListOf) => words(`[data-testid=velero-${of.kind}-status]`);
  const workspace = (of: cluster.ListOf) => frame.locator(`[data-testid=velero-${of.kind}-workspace]`);
  const notes = (of: cluster.ListOf) =>
    frame.$$eval(`[data-testid=velero-${of.id}-note] > span`, (elements) =>
      elements.map((element) => (element.textContent ?? "").replace(/\s+/g, " ").trim()),
    );
  const marks = (of: cluster.ListOf, name: string) =>
    frame
      .locator(`[data-testid=velero-${of.id}] .TableRow`, { has: frame.locator(`[data-${of.kind}-row="${name}"]`) })
      .locator("[data-availability]")
      .evaluate((element) => [element.getAttribute("data-availability"), element.getAttribute("data-mark")]);
  // What the cluster holds of a location, read by the suite and not by the application.
  const held = (namespace: string, name: string) => {
    const read = cluster.kubectlE2E(
      "get",
      "backupstoragelocations.velero.io",
      name,
      "--namespace",
      namespace,
      "-o",
      "json",
    );

    if (read.status !== 0) throw new Error(`The location ${name} of ${namespace} could not be read`);
    return JSON.parse(read.stdout) as {
      metadata: { creationTimestamp: string };
      spec: { default?: boolean; accessMode?: string; validationFrequency?: string };
      status?: { phase?: string; lastValidationTime?: string };
    };
  };

  beforeAll(async () => {
    if (!cluster.fixturesReady()) {
      throw new Error(`The fixtures are missing from ${cluster.E2E_CLUSTER_NAME}. Run \`pnpm demo:up\` first.`);
    }
    before = cluster.clusterSnapshot();
    errors.start();
    started = await velero.startIsolated();
    errors.watch(started.window);
    const kubeconfig = await cluster.publishKubeconfig();

    await utils.clickWelcomeButton(started.window);
    await velero.installExtension(started.app, started.window);
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
    "lists the storage locations with availability, access mode and default as three facts",
    async () => {
      await cluster.openPage(frame, STORAGE);
      expect(Object.keys(await cluster.veleroSidebarEntries(frame))).toEqual([
        "velero",
        "velero-overview",
        "velero-backups",
        "velero-restores",
        "velero-schedules",
        "velero-storage-locations",
        "velero-snapshot-locations",
      ]);
      await frame.waitForSelector("[data-testid=velero-state-choose]", { timeout: 60_000 });
      await frame.click(`[data-testid="velero-choice-${cluster.E2E_VIEWS_NAMESPACE}"]`);
      await cluster.waitForList(frame, STORAGE);
      expect((await cluster.mounted(frame, STORAGE)).sort()).toEqual([
        cluster.LONG_LOCATION_NAME,
        "views-archive",
        "views-available",
        "views-unavailable",
        "views-unreported",
        "views-with-credential",
      ]);
      // Each value in the cell of its column.
      await cluster.expectCells(STORAGE, frame, "views-available", {
        phase: "Available",
        access: "Read and write",
        marked: "Marked default",
        provider: "aws",
      });
      await cluster.expectCells(STORAGE, frame, "views-archive", {
        phase: "Available",
        access: "Read only",
        marked: "Not marked",
        synced: "Never synced",
      });
      await cluster.expectCells(STORAGE, frame, "views-unavailable", {
        phase: "Unavailable",
        access: "Read and write",
        marked: "Not marked",
      });
      await cluster.expectCells(STORAGE, frame, "views-unreported", {
        phase: "Not reported",
        access: "Not set",
        validated: "Never validated",
        synced: "Never synced",
      });
      // Nothing but a reported Available has the mark of what is available.
      expect(await marks(STORAGE, "views-available")).toEqual(["available", "available"]);
      expect(await marks(STORAGE, "views-unavailable")).toEqual(["unavailable", "unavailable"]);
      expect(await marks(STORAGE, "views-unreported")).toEqual(["not-reported", "unknown"]);
      // One location is marked default: the list has nothing to say of the default.
      expect(await notes(STORAGE)).toEqual([]);
      expect((await frame.locator(".TabLayout .Tabs .Tab").allInnerTexts()).map(text)).toEqual([
        "Overview",
        "Backups",
        "Restores",
        "Schedules",
        "Backup Storage Locations",
        "Volume Snapshot Locations",
      ]);
      expect(await frame.locator(".TabLayout .TabLayout").count()).toBe(0);
      expect(await cluster.notices(frame, [])).toEqual({});
      expect(await cluster.layoutProblems(frame, STORAGE)).toEqual([]);
      // Every column is shown, and its words are read whole: the name that is as long as a name can be is
      // the one that is cut, and it is whole in its tip.
      const columns = await cluster.columnsOf(STORAGE, frame);

      expect(columns.shown).toEqual(["name", "phase", "access", "marked", "provider", "validated", "synced"]);
      expect(columns.cut.filter((column) => column !== "name")).toEqual([]);
      expect(
        await frame.locator(`[data-storage-location-row="${cluster.LONG_LOCATION_NAME}"]`).getAttribute("title"),
      ).toBe(cluster.LONG_LOCATION_NAME);
      // What Velero says of a location it cannot use is the tip of its mark.
      expect(
        await frame
          .locator("[data-testid=velero-storage-locations] .TableRow", {
            has: frame.locator('[data-storage-location-row="views-unavailable"]'),
          })
          .locator("[data-availability]")
          .getAttribute("title"),
      ).toContain("The bucket of the location was looked for and was not found");
      await cluster.captureScreenshot(frame, "dark-storage-locations");
    },
    TIMEOUT,
  );

  it(
    "says that an availability may be out of date when no controller validated the location for days",
    async () => {
      // No controller reads the synthetic locations: what they report was written days before the
      // environment came up, whatever its age.
      for (const name of [
        "views-available",
        "views-archive",
        "views-unavailable",
        "views-with-credential",
        cluster.LONG_LOCATION_NAME,
      ]) {
        const cells = await cluster.cellsOf(STORAGE, frame, name);

        expect([name, cells.validated]).toEqual([
          name,
          expect.stringMatching(/^\d+d( \d+h)? ago, may be out of date$/),
        ]);
      }
      await cluster.openWorkspace(frame, "views-available", STORAGE);
      expect(await status(STORAGE)).toContain(
        "The availability may be out of date: the last validation is older than 3 times the frequency, by the clock of this machine.",
      );
      expect(await frame.locator("[data-testid=velero-location-validation]").getAttribute("data-late")).toBe("true");
      await cluster.captureScreenshot(frame, "dark-storage-location-late");
      await cluster.closeWorkspace(frame);
      await cluster.openWorkspace(frame, "views-archive", STORAGE);
      const archive = await status(STORAGE);

      expect(archive).toContain(
        "The availability may be out of date: the last validation is older than one hour, by the clock of this machine.",
      );
      // Available and read only, side by side, and what it means for a new backup.
      expect(archive).toMatch(/AVAILABILITY Available/i);
      expect(archive).toContain("The location is available and read-only: it does not take new backups.");
      expect(text(await frame.locator("[data-testid=velero-storage-location-storage]").innerText())).toContain(
        "The frequency is the one of the server of Velero, which this view does not read.",
      );
      await cluster.closeWorkspace(frame);
    },
    TIMEOUT,
  );

  it(
    "shows the location the controller of the installation validates as it reports it",
    async () => {
      await cluster.selectInstallation(frame, cluster.E2E_NAMESPACE);
      await cluster.waitForList(frame, STORAGE);
      const location = held(cluster.E2E_NAMESPACE, "default");

      // What the suite expects of a location that is validated is what the release does here: the
      // installer marks it default and names no access mode and no frequency, and the controller writes a
      // phase with the time of a validation that is minutes old at most.
      expect(location.spec.default).toBe(true);
      expect(location.spec.accessMode).toBeUndefined();
      expect(location.spec.validationFrequency).toBeUndefined();
      const cells = await cluster.expectCells(STORAGE, frame, "default", {
        phase: "Available",
        marked: "Marked default",
        access: "Not set",
      });

      expect(location.status?.phase).toBe("Available");
      expect(Date.now() - Date.parse(location.status?.lastValidationTime ?? "")).toBeLessThan(10 * 60_000);
      // Validated by the controller within the last minutes, which is what the cell says.
      expect(cells.validated).toMatch(/^\d+(s|m( \d+s)?) ago$/);
      expect(cells.validated).not.toContain(LATE);
      expect(await marks(STORAGE, "default")).toEqual(["available", "available"]);
      await cluster.openWorkspace(frame, "default", STORAGE);
      expect(await frame.locator("[data-testid=velero-location-validation]").getAttribute("data-late")).toBe("false");
      expect(await status(STORAGE)).not.toContain("may be out of date");
      expect(await status(STORAGE)).toContain(
        "The release refuses a backup for the access mode only when it is read-only.",
      );
      expect(await words("[data-testid=velero-storage-location-storage]")).toContain(
        "The frequency is the one of the server of Velero, which this view does not read.",
      );
      expect(await workspace(STORAGE).locator("[data-testid=velero-location-refused]").count()).toBe(0);
      // The backup the controller ran names the location, and leads to its view.
      expect(text(await workspace(STORAGE).locator("[data-testid=velero-location-backups-counts]").innerText())).toBe(
        "1 backup that exists: 1 completed.",
      );
      expect(await cluster.layoutProblems(frame, STORAGE)).toEqual([]);
      await cluster.captureScreenshot(frame, "dark-storage-location-validated");
      await cluster.closeWorkspace(frame);
    },
    TIMEOUT,
  );

  it(
    "says that no location is marked default, and names each one when more than one is",
    async () => {
      await cluster.selectInstallation(frame, cluster.E2E_STATIC_NAMESPACE);
      await cluster.waitForList(frame, STORAGE);
      expect((await cluster.mounted(frame, STORAGE)).sort()).toEqual(["fixture-readonly", "fixture-unavailable"]);
      expect(await notes(STORAGE)).toEqual([
        "No storage location of this installation is marked default. The server of Velero may name one in its settings, which this view does not read.",
      ]);
      await cluster.expectCells(STORAGE, frame, "fixture-readonly", { marked: "Not marked" });
      await cluster.captureScreenshot(frame, "dark-storage-locations-no-default");

      await cluster.selectInstallation(frame, cluster.E2E_DEFAULTS_NAMESPACE);
      await cluster.waitForList(frame, STORAGE);
      await cluster.expectCells(STORAGE, frame, "defaults-newer", { marked: "Marked default" });
      await cluster.expectCells(STORAGE, frame, "defaults-older", {
        marked: "Marked default",
        access: "Read only",
        phase: "Available",
      });
      // The one the release would keep is the one created last, and it is not settled which one it keeps
      // of two created in the same second: the suite reads when each was created, and expects what the
      // view says of that.
      const created = (name: string) =>
        Date.parse(held(cluster.E2E_DEFAULTS_NAMESPACE, name).metadata.creationTimestamp);
      const first =
        "2 storage locations are marked default: defaults-newer, defaults-older. The reviewed release sends a backup that names no location to the first of them it finds, and keeps marked the one created last";

      expect(created("defaults-newer")).toBeGreaterThanOrEqual(created("defaults-older"));
      expect(await notes(STORAGE)).toEqual([
        created("defaults-newer") > created("defaults-older")
          ? `${first}, which is defaults-newer.`
          : `${first}: defaults-newer and defaults-older were created in the same second, and which of them it keeps is not settled.`,
      ]);
      expect(await cluster.layoutProblems(frame, STORAGE)).toEqual([]);
      await cluster.captureScreenshot(frame, "dark-storage-locations-two-defaults");
    },
    TIMEOUT,
  );

  it(
    "shows what Velero says of a location that is unavailable, and what depends on it",
    async () => {
      await cluster.selectInstallation(frame, cluster.E2E_STATIC_NAMESPACE);
      await cluster.waitForList(frame, STORAGE);
      // Opening a location asks nothing of the cluster: what uses it was read with the installation.
      expect(
        await cluster.readsDuring(
          frame,
          () => cluster.openWorkspace(frame, "fixture-unavailable", STORAGE),
          () => cluster.closeWorkspace(frame),
        ),
      ).toEqual({});
      const shown = await status(STORAGE);

      expect(shown).toMatch(/AVAILABILITY Unavailable/i);
      expect(shown).toContain("Synthetic storage failure; no endpoint was contacted");
      expect(shown).toMatch(/LAST VALIDATION Never validated/i);
      expect(await workspace(STORAGE).locator("[data-testid=velero-location-refused]").innerText()).toBe(REFUSED);
      // Every backup and every schedule of the namespace of the phases names it.
      expect(
        text(await workspace(STORAGE).locator("[data-testid=velero-location-backups-counts]").innerText()),
      ).toMatch(/^13 backups that exist: \d+ completed; \d+ ended with a failure; \d+ in flight/);
      expect(
        await workspace(STORAGE).locator("[data-testid=velero-location-schedules] button").allInnerTexts(),
      ).toEqual(["schedule-enabled", "schedule-invalid", "schedule-paused"]);
      expect(await cluster.notices(frame, [])).toEqual({});
      expect(await cluster.layoutProblems(frame, STORAGE)).toEqual([]);
      await workspace(STORAGE).locator("[data-testid=velero-location-users]").scrollIntoViewIfNeeded();
      await cluster.captureScreenshot(frame, "dark-storage-location-unavailable");
      // From what uses the location to its view, and back to the location.
      const changes: [step: string, changes: number, views: string[]][] = [];
      const step = async (name: string, take: () => Promise<void>) => {
        const count = await cluster.addressChanges(frame);

        await take();
        changes.push([name, (await cluster.addressChanges(frame)) - count, await cluster.addressViews(frame)]);
      };

      await step("to a schedule that names it", () => cluster.followTo(frame, "schedule", "schedule-paused"));
      expect(await cluster.shownView(frame)).toEqual({
        kind: "schedule",
        name: "schedule-paused",
        back: "arrow_back Backup Storage Locations / fixture-unavailable",
      });
      expect(await frame.locator("[data-testid=velero-storage-locations-page]").count()).toBe(1);
      // The schedule names the location it was opened from: the way back, not a way further.
      await step("from the schedule to the location", () =>
        cluster.followTo(frame, "storage-location", "fixture-unavailable"),
      );
      expect(await cluster.shownView(frame)).toEqual({
        kind: "storage-location",
        name: "fixture-unavailable",
        back: "arrow_back Backup Storage Locations",
      });
      expect(changes).toEqual([
        ["to a schedule that names it", 1, ["storage-location/fixture-unavailable", "schedule/schedule-paused"]],
        ["from the schedule to the location", 1, ["storage-location/fixture-unavailable"]],
      ]);
      await cluster.closeWorkspace(frame);
      expect(await cluster.focusOn(frame, "fixture-unavailable")).toBe("fixture-unavailable");
    },
    TIMEOUT,
  );

  it(
    "shows a message of many lines whole, and says that nothing uses a location that none names",
    async () => {
      await cluster.selectInstallation(frame, cluster.E2E_VIEWS_NAMESPACE);
      await cluster.waitForList(frame, STORAGE);
      await cluster.openWorkspace(frame, "views-unavailable", STORAGE);
      const shown = await status(STORAGE);

      for (const line of [
        "Synthetic storage failure; no endpoint was contacted.",
        "The bucket of the location was looked for and was not found,",
        "and the second attempt ended as the first.",
      ]) {
        expect(shown).toContain(line);
      }
      expect(text(await workspace(STORAGE).locator("[data-testid=velero-location-backups-counts]").innerText())).toBe(
        "No backup that exists names this location.",
      );
      expect(text(await workspace(STORAGE).locator("[data-testid=velero-location-schedules]").innerText())).toBe(
        "No schedule names this location in its template",
      );
      expect(await cluster.layoutProblems(frame, STORAGE)).toEqual([]);
      await cluster.closeWorkspace(frame);
    },
    TIMEOUT,
  );

  it(
    "shows where a location points and the Secrets it names, and nothing of what a URL may hide",
    async () => {
      await cluster.openWorkspace(frame, "views-with-credential", STORAGE);
      const storage = text(await frame.locator("[data-testid=velero-storage-location-storage]").innerText());
      const credentials = text(await frame.locator("[data-testid=velero-storage-location-credentials]").innerText());
      const config = frame.locator("[data-testid=velero-location-config]");
      const entry = async (key: string) => text(await config.locator(`[data-config-key="${key}"] td`).innerText());

      expect(storage).toMatch(/PROVIDER aws/i);
      expect(storage).toMatch(/PREFIX with-credential/i);
      expect(storage).toMatch(/VALIDATION FREQUENCY Turned off/i);
      expect(storage).toContain(
        "The periodic validation is turned off: the availability is the one of the last validation.",
      );
      expect(storage).toMatch(/SYNC PERIOD Turned off/i);
      expect(await status(STORAGE)).toMatch(/LAST SYNC Never synced/i);
      expect(
        await config
          .locator("[data-config-key]")
          .evaluateAll((rows) => rows.map((row) => row.getAttribute("data-config-key"))),
      ).toEqual(["insecureSkipTLSVerify", "region", "s3Url"]);
      // The query of the address is left out, and the view says that it left something out.
      expect(await entry("s3Url")).not.toMatch(/\?|synthetic|left-out/);
      expect(await entry("s3Url")).toMatch(/^https?:\/\/[^?@]+$/);
      expect(await frame.locator("[data-testid=velero-location-left-out]").innerText()).toContain(
        "is left out of what is shown",
      );
      expect(await entry("insecureSkipTLSVerify")).toContain("The verification of TLS is turned off");
      // The Secrets by their names: they are not among the objects of the cluster, and no one looked.
      expect(credentials).toMatch(/CREDENTIAL Secret views-credential, key cloud/i);
      expect(credentials).toMatch(/CERTIFICATE Secret views-storage-ca, key ca\.crt/i);
      expect(credentials).toContain("The Secret is named, and is not read.");
      expect(await cluster.notices(frame, [])).toEqual({});
      expect(await cluster.layoutProblems(frame, STORAGE)).toEqual([]);
      await frame.locator("[data-testid=velero-storage-location-credentials]").scrollIntoViewIfNeeded();
      await cluster.captureScreenshot(frame, "dark-storage-location-credentials");
      await cluster.closeWorkspace(frame);
    },
    TIMEOUT,
  );

  it(
    "leads from a backup, from a restore and from a schedule to their locations, and back",
    async () => {
      await cluster.openBackups(frame);
      await cluster.waitForBackups(frame);
      await cluster.openWorkspace(frame, "views-daily-20260901030000");
      await cluster.followTo(frame, "storage-location", "views-available");
      expect(await cluster.shownView(frame)).toEqual({
        kind: "storage-location",
        name: "views-available",
        back: "arrow_back Backups / views-daily-20260901030000",
      });
      expect(await frame.locator("[data-testid=velero-backups-page]").count()).toBe(1);
      await cluster.closeWorkspace(frame);
      await cluster.followTo(frame, "snapshot-location", "views-snapshots");
      expect(await cluster.shownView(frame)).toEqual({
        kind: "snapshot-location",
        name: "views-snapshots",
        back: "arrow_back Backups / views-daily-20260901030000",
      });
      await cluster.closeWorkspace(frame);
      await cluster.closeWorkspace(frame);
      expect(await cluster.focusOn(frame, "views-daily-20260901030000")).toBe("views-daily-20260901030000");
      // A location that is not there is a name with its reason, and no way.
      await cluster.openWorkspace(frame, "backup-missing-location");
      expect(
        (await cluster.reference(frame, "velero-reference-BackupStorageLocation-views-removed", "absent")).state,
      ).toBe("absent");
      expect(
        await frame.locator('[data-testid="velero-reference-BackupStorageLocation-views-removed"] button').count(),
      ).toBe(0);
      await cluster.closeWorkspace(frame);

      await cluster.openPage(frame, cluster.RESTORES);
      await cluster.waitForList(frame, cluster.RESTORES);
      await cluster.openWorkspace(frame, "restore-mapped", cluster.RESTORES);
      await cluster.followTo(frame, "storage-location", "views-available");
      expect((await cluster.shownView(frame))?.back).toBe("arrow_back Restores / restore-mapped");
      await cluster.closeWorkspace(frame);
      await cluster.closeWorkspace(frame);

      await cluster.openPage(frame, cluster.SCHEDULES);
      await cluster.waitForList(frame, cluster.SCHEDULES);
      await cluster.openWorkspace(frame, "views-to-archive", cluster.SCHEDULES);
      await cluster.followTo(frame, "storage-location", "views-archive");
      expect(await cluster.shownView(frame)).toEqual({
        kind: "storage-location",
        name: "views-archive",
        back: "arrow_back Schedules / views-to-archive",
      });
      // The location names the schedule it was opened from, which is the way back.
      expect(
        await workspace(STORAGE).locator("[data-testid=velero-location-schedules] button").allInnerTexts(),
      ).toEqual(["views-to-archive"]);
      await started.window.keyboard.press("Escape");
      await frame.waitForSelector('[data-testid=velero-schedule-name] >> text="views-to-archive"', {
        timeout: 60_000,
      });
      await cluster.showList(frame);
      // A schedule whose template names no location leads to the one marked default, which says that
      // the backups of the schedule go to it.
      await cluster.openWorkspace(frame, "views-to-default", cluster.SCHEDULES);
      await cluster.followTo(frame, "storage-location", "views-available");
      expect((await cluster.shownView(frame))?.back).toBe("arrow_back Schedules / views-to-default");
      expect(
        await workspace(STORAGE).locator("[data-testid=velero-location-by-default] button").allInnerTexts(),
      ).toContain("views-to-default");
      expect(await workspace(STORAGE).locator("[data-testid=velero-location-by-default-note]").innerText()).toBe(
        "Their template names no location: their backups go to the one marked default, which is this one.",
      );
      await cluster.showList(frame);
      await cluster.openPage(frame, STORAGE);
      await cluster.waitForList(frame, STORAGE);
    },
    TIMEOUT,
  );

  it(
    "keeps the search, the order and the width of a column when a location is opened and closed",
    async () => {
      expect([...(await cluster.search(frame, "read only", STORAGE))].sort()).toEqual(["views-archive"]);
      expect([...(await cluster.search(frame, "views-una", STORAGE))].sort()).toEqual(["views-unavailable"]);
      expect([...(await cluster.search(frame, "out of date", STORAGE))].sort()).toEqual([
        cluster.LONG_LOCATION_NAME,
        "views-archive",
        "views-available",
        "views-unavailable",
        "views-with-credential",
      ]);
      await frame.click("[data-testid=velero-storage-locations] .TableHead .TableCell.access");
      const resized = await cluster.resizeColumn(frame, "name", 90, STORAGE);

      expect(resized.after - resized.before).toBeGreaterThan(30);
      const state = await cluster.listState(frame, STORAGE);

      expect(state.search).toBe("out of date");
      expect(state.sorted).toMatch(/^access /);
      const modes = async () =>
        Promise.all(
          (await cluster.mounted(frame, STORAGE)).map(
            async (name) => (await cluster.cellsOf(STORAGE, frame, name)).access,
          ),
        );
      const asked = await modes();

      // The rows are in the order of their access mode, which is not the one of their names: the one
      // location that is read only is at one end. Asked again, the order is the other one, and it is at
      // the other end.
      expect(asked).toHaveLength(5);
      expect([[...asked].sort(), [...asked].sort().reverse()]).toContainEqual(asked);
      expect([asked[0], asked[4]].sort()).toEqual(["Read and write", "Read only"]);
      expect([...(await cluster.mounted(frame, STORAGE))]).not.toEqual(
        [...(await cluster.mounted(frame, STORAGE))].sort(),
      );
      await frame.click("[data-testid=velero-storage-locations] .TableHead .TableCell.access");
      const again = await cluster.listState(frame, STORAGE);

      expect(again.sorted).toMatch(/^access /);
      expect(again.sorted).not.toBe(state.sorted);
      expect(await modes()).toEqual([...asked].reverse());
      await frame.click("[data-testid=velero-storage-locations] .TableHead .TableCell.access");
      expect((await cluster.listState(frame, STORAGE)).sorted).toBe(state.sorted);
      await cluster.openWorkspace(frame, "views-archive", STORAGE);
      await cluster.closeWorkspace(frame);
      const back = await cluster.listStateLike(frame, state, STORAGE);

      expect(back.search).toBe(state.search);
      expect(back.sorted).toBe(state.sorted);
      expect(back.items).toBe(state.items);
      expect(back.first).toBe(state.first);
      expect(Math.abs(back.columns.name - state.columns.name)).toBeLessThanOrEqual(1);
      await cluster.search(frame, "", STORAGE);
    },
    TIMEOUT,
  );

  it(
    "lists the snapshot locations with a phase that has the mark of what is not known",
    async () => {
      await cluster.openPage(frame, SNAPSHOT);
      await cluster.waitForList(frame, SNAPSHOT);
      expect((await cluster.mounted(frame, SNAPSHOT)).sort()).toEqual([
        "views-snapshots",
        "views-snapshots-unreported",
      ]);
      await cluster.expectCells(SNAPSHOT, frame, "views-snapshots", { phase: "Available", provider: "aws" });
      await cluster.expectCells(SNAPSHOT, frame, "views-snapshots-unreported", {
        phase: "Not reported",
        provider: "csi",
      });
      // A snapshot location that reports Available is not shown as one that is: nothing of the release
      // wrote the phase, and nothing checks it.
      expect(await marks(SNAPSHOT, "views-snapshots")).toEqual(["available", "unknown"]);
      expect(await marks(SNAPSHOT, "views-snapshots-unreported")).toEqual(["not-reported", "unknown"]);
      expect(await notes(SNAPSHOT)).toEqual([
        "The reviewed release neither writes nor checks the phase of a volume snapshot location: a phase that is here says nothing of whether the location can be used.",
      ]);
      expect(await cluster.notices(frame, [])).toEqual({});
      expect(await cluster.layoutProblems(frame, SNAPSHOT)).toEqual([]);
      await cluster.captureScreenshot(frame, "dark-snapshot-locations");
      expect([...(await cluster.search(frame, "csi", SNAPSHOT))]).toEqual(["views-snapshots-unreported"]);
      await cluster.search(frame, "", SNAPSHOT);

      await cluster.openWorkspace(frame, "views-snapshots", SNAPSHOT);
      const shown = await status(SNAPSHOT);

      expect(shown).toMatch(/PHASE Available/i);
      expect(shown).toContain("The reviewed release neither writes nor checks the phase of a volume snapshot location");
      // The backups of the views name it, and the schedules whose template does.
      expect(
        text(await workspace(SNAPSHOT).locator("[data-testid=velero-location-backups-counts]").innerText()),
      ).toMatch(/^\d+ backups that exist: /);
      expect(
        (await workspace(SNAPSHOT).locator("[data-testid=velero-location-schedules] button").allInnerTexts()).length,
      ).toBeGreaterThan(0);
      expect(await workspace(SNAPSHOT).locator("[data-testid=velero-location-refused]").count()).toBe(0);
      expect(await cluster.layoutProblems(frame, SNAPSHOT)).toEqual([]);
      await cluster.captureScreenshot(frame, "dark-snapshot-location-workspace");
      await cluster.closeWorkspace(frame);

      await cluster.openWorkspace(frame, "views-snapshots-unreported", SNAPSHOT);
      expect(await status(SNAPSHOT)).toMatch(/PHASE Not reported/i);
      expect(text(await frame.locator("[data-testid=velero-snapshot-location-credentials]").innerText())).toMatch(
        /CREDENTIAL Secret views-credential, key cloud/i,
      );
      expect(text(await workspace(SNAPSHOT).locator("[data-testid=velero-location-backups-counts]").innerText())).toBe(
        "No backup that exists names this location.",
      );
      await cluster.closeWorkspace(frame);
    },
    TIMEOUT,
  );

  it(
    "offers no way to select, edit, delete or set as default a location, by pointer or by keyboard",
    async () => {
      await cluster.openPage(frame, STORAGE);
      await cluster.waitForList(frame, STORAGE);
      const appears = (selector: string) =>
        frame.waitForSelector(selector, { state: "visible", timeout: NOTHING }).then(
          () => true,
          () => false,
        );

      for (const of of [STORAGE, SNAPSHOT]) {
        const name = of === STORAGE ? "views-available" : "views-snapshots";
        const list = frame.locator(`[data-testid=velero-${of.id}]`);

        await cluster.openPage(frame, of);
        await cluster.waitForList(frame, of);
        expect(await list.locator(".TableCell.checkbox, .Checkbox, input[type=checkbox]").count()).toBe(0);
        expect(await list.locator(".TableCell.menu .Icon, .MenuActions").count()).toBe(0);
        expect(await list.locator(".AddRemoveButtons button, .add-button, .remove-button").count()).toBe(0);
        await frame.locator(`[data-${of.kind}-row="${name}"]`).click({ button: "right" });
        expect([of.id, await appears(MENU)]).toEqual([of.id, false]);
        await cluster.showList(frame);
        await frame.locator(`[data-${of.kind}-row="${name}"]`).focus();
        for (const key of ["Delete", "Backspace", "Control+a", "Meta+Backspace"]) {
          await started.window.keyboard.press(key);
          expect([of.id, key, await appears(DIALOG)]).toEqual([of.id, key, false]);
          expect([of.id, key, await cluster.shownView(frame)]).toEqual([of.id, key, undefined]);
        }
        expect(await list.locator(".TableRow.selected, .TableRow.checked").count()).toBe(0);
        await cluster.openWorkspace(frame, name, of);
        const controls = await workspace(of)
          .locator("button, a, input, select, textarea")
          .evaluateAll((elements) => elements.map((element) => element.getAttribute("data-testid") ?? ""));

        // The way back and the ways to the other views: nothing that writes.
        expect([of.id, controls.filter((control) => !control.startsWith("velero-open-"))]).toEqual([
          of.id,
          ["velero-back"],
        ]);
        expect(await workspace(of).innerText()).not.toMatch(/\b(delete|edit|remove|set as default|validate now)\b/i);
        await cluster.closeWorkspace(frame);
      }
      // The same click on the list the host shows of the same objects opens its menu: what is looked for
      // above is what the host shows when it offers to edit and to delete.
      await cluster.navigate(frame, "/crd/velero.io/backupstoragelocations");
      await cluster.selectHostNamespace(frame, cluster.E2E_VIEWS_NAMESPACE);
      await frame.locator(".TableRow", { hasText: "views-available" }).first().click({ button: "right" });
      await frame.waitForSelector(MENU, { state: "visible", timeout: 60_000 });
      expect((await frame.locator(MENU).allInnerTexts()).join(" ")).toMatch(/Delete/);
      expect(await frame.locator(".TableRow .TableCell.checkbox").count()).toBeGreaterThan(0);
      await started.window.keyboard.press("Escape");
      await frame.waitForSelector(MENU, { state: "hidden", timeout: 60_000 });
    },
    TIMEOUT,
  );

  it(
    "gives the details of the host the same reading, and a way to the workspace for the installation selected",
    async () => {
      await cluster.navigate(frame, "/crd/velero.io/backupstoragelocations");
      await cluster.selectHostNamespace(frame, cluster.E2E_VIEWS_NAMESPACE);
      const details = await cluster.hostDetails(
        frame,
        "views-archive",
        "Available",
        "Read only",
        "Not marked",
        "The availability may be out of date: the last validation is older than one hour, by the clock of this machine.",
        "The location is available and read-only: it does not take new backups.",
      );

      expect(details).not.toMatch(/healthy/i);
      expect(await frame.locator("[data-testid=velero-storage-location-details-link]").count()).toBe(1);
      await cluster.captureScreenshot(frame, "dark-host-details-storage-location");
      await cluster.closeDetails(frame);

      await cluster.selectHostNamespace(frame, cluster.E2E_STATIC_NAMESPACE);
      await cluster.hostDetails(
        frame,
        "fixture-unavailable",
        "Unavailable",
        "Synthetic storage failure; no endpoint was contacted",
        "Never validated",
      );
      expect(await frame.locator("[data-testid=velero-storage-location-details-link]").count()).toBe(0);
      expect(await frame.locator("[data-testid=velero-storage-location-details-elsewhere]").innerText()).toContain(
        cluster.E2E_STATIC_NAMESPACE,
      );
      await cluster.closeDetails(frame);

      await cluster.navigate(frame, "/crd/velero.io/volumesnapshotlocations");
      await cluster.selectHostNamespace(frame, cluster.E2E_VIEWS_NAMESPACE);
      await cluster.hostDetails(
        frame,
        "views-snapshots",
        "Available",
        "The reviewed release neither writes nor checks the phase of a volume snapshot location",
      );
      await frame.click("[data-testid=velero-snapshot-location-details-link]");
      await frame.waitForSelector('[data-testid=velero-snapshot-location-name] >> text="views-snapshots"', {
        timeout: 60_000,
      });
      expect(await frame.locator("[data-testid=velero-snapshot-locations-page]").count()).toBe(1);
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
      // The controller of the installation validates its location while the suite runs: the objects of
      // its namespace are the same ones.
      expect(after.installed).toEqual(before.installed);
      expect(before.requests).toBe(0);
      expect(after.requests).toBe(0);
      expect(cluster.counted(cluster.writes(counted), cluster.writes(requests))).toEqual({});
      expect(cluster.counted(cluster.clusterReads(counted), cluster.clusterReads(requests))).toEqual({
        "LIST backupstoragelocations cluster": 1,
      });
      // The Secrets the locations name are not in the cluster: the views showed names that lead nowhere.
      // That no Secret is asked is what the reader is tested for, which refuses every path to one.
      for (const name of ["views-credential", "views-storage-ca"]) {
        expect(
          cluster.kubectlE2E("get", "secrets", name, "--namespace", cluster.E2E_VIEWS_NAMESPACE, "-o", "name").status,
        ).not.toBe(0);
      }
      expect(errors.errors()).toEqual([]);
    },
    TIMEOUT,
  );
});
