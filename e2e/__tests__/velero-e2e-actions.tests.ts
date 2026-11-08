/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

// The actions of SPEC-0017 in a packaged Freelens, on the CRDs of the release alone, where no controller runs
// (REQ-254, ACT-11): Back up now from the view of a schedule (T4.2). With writes off the command writes nothing; a
// review that is not confirmed, nothing; a confirmed one, exactly one POST of a Backup, whose every field is the one of
// the text the review showed, and no other write. The backup stays without a phase, as the result says, and the view
// of the schedule lists it at its next read (NOW-05). A name already taken is a conflict (NOW-04). The workspace in both
// themes, at every size and at twice the zoom, with the longest name a schedule may have (ACT-10). What the suite
// created it removes, and the objects of Velero are as they were.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as cluster from "../../integration/helpers/velero-cluster";
import * as velero from "../../integration/helpers/velero-extension";
import { backupFromSchedule, bodyText } from "../../src/common/backup-from-schedule";
import { BACKUP_NOW_VIEW_WORDS } from "../../src/common/backup-now-words";
import { BACKUP_NOW_WORDS } from "../../src/main/backup-now";

import type { Frame } from "playwright";

const TIMEOUT = 15 * 60 * 1000;
const SCHEDULES = cluster.SCHEDULES;
// The schedule with a history in the installation of the views, and the one with the longest name a label takes.
const SCHEDULE = "views-history";
const LONG = "schedule-with-a-name-as-long-as-the-value-of-a-label-is-allowed";
const THEMES: velero.ColorTheme[] = ["Dark", "Light"];
const SIZES = [
  { name: "1440x900", width: 1440, height: 900, zoom: 1 },
  { name: "900x650", width: 900, height: 650, zoom: 1 },
  { name: "1440x900-zoom-200", width: 1440, height: 900, zoom: 2 },
];
// How long what must not happen is waited for.
const NOTHING = 1500;
const part = (id: string) => `[data-testid=velero-backup-now-${id}]`;
// The field of the name: the host gives its own element the identifier, or the input in it.
const FIELD = `${part("field")} input, input${part("field")}`;

interface BackupRead {
  metadata: {
    name: string;
    namespace: string;
    uid: string;
    labels?: Record<string, string>;
    annotations?: Record<string, string>;
    ownerReferences?: unknown[];
  };
  spec?: unknown;
  status?: { phase?: string };
}

function read<Value>(resource: string, name: string, namespace: string): Value {
  const { status, stdout, stderr } = cluster.kubectlE2E("get", resource, name, "--namespace", namespace, "-o", "json");

  if (status !== 0) throw new Error(`kubectl get ${resource} ${name} failed: ${stderr}`);
  return JSON.parse(stdout) as Value;
}

describe("the actions of Velero, on the CRDs of the release alone", () => {
  let started: velero.StartedApplication | undefined;
  let frame: Frame;
  const errors = velero.createErrorCollector();
  let before: cluster.ClusterSnapshot;
  // What the suite created, to remove it.
  const created: { namespace: string; name: string; uid: string }[] = [];

  const writesOn = async () => {
    await frame.click("[data-testid=velero-writes-on]");
    const dialog = frame.locator("[data-testid=confirmation-dialog]");

    await dialog.waitFor({ state: "visible", timeout: 60_000 });
    await dialog.locator("[data-testid=confirm]").click();
    await frame.waitForSelector("[data-testid=velero-writes][data-writes=on]", { timeout: 60_000 });
  };
  const backUpNow = async (namespace: string, schedule: string) => {
    await cluster.openPage(frame, SCHEDULES);
    await cluster.selectInstallation(frame, namespace);
    await cluster.waitForList(frame, SCHEDULES);
    await cluster.openWorkspace(frame, schedule, SCHEDULES);
    await frame.click("[data-testid=velero-schedule-back-up-now]");
    await frame.waitForSelector("[data-testid=velero-backup-now-workspace]", { timeout: 30_000 });
  };
  const nameInField = () => frame.locator(FIELD).first().inputValue();
  // The writes of the kinds of Velero since a reading of the counters, whoever made them.
  const writesSince = (earlier: Record<string, number>) => cluster.writes(earlier, cluster.apiRequests());

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
    frame = await cluster.openClusterFromCatalog(started.window, kubeconfig);
    await velero.setWindowSize(started.app, 1440, 900);
  }, TIMEOUT);

  afterAll(async () => {
    try {
      for (const backup of created) cluster.removeCreatedBackup(backup.namespace, backup.name, backup.uid);
    } finally {
      if (started) {
        errors.stop(started.window);
        await velero.setZoom(started.app, 1).catch(() => undefined);
      }
      await started?.cleanup();
    }
  }, TIMEOUT);

  it(
    "offers Back up now in the view of a schedule, and with writes off fills the form and writes nothing",
    async () => {
      const earlier = cluster.apiRequests();

      await backUpNow(cluster.E2E_VIEWS_NAMESPACE, SCHEDULE);
      expect(await nameInField()).toMatch(new RegExp(`^${SCHEDULE}-\\d{14}$`));
      expect(await cluster.wordsOf(frame, part("writes-off"))).toBe(BACKUP_NOW_VIEW_WORDS.writesOff);
      expect(await frame.locator(part("ask")).count()).toBe(0);
      await frame.locator(FIELD).first().fill(`${SCHEDULE}-by-hand`);
      expect(await nameInField()).toBe(`${SCHEDULE}-by-hand`);
      // Enter asks for a review, which writes off do not give.
      await frame.locator(FIELD).first().press("Enter");
      await frame.waitForTimeout(NOTHING);
      expect(await frame.locator(part("review")).count()).toBe(0);
      await frame.click(part("to-target"));
      expect(await cluster.focusOn(frame, "velero-writes-on")).toBe("velero-writes-on");
      expect(writesSince(earlier)).toEqual({});
    },
    TIMEOUT,
  );

  it(
    "shows in its review the text of the backup the schedule makes, as the API server holds the schedule, and writes nothing for a review that is left",
    async () => {
      await writesOn();
      const earlier = cluster.apiRequests();

      await frame.locator(FIELD).first().fill(`${SCHEDULE}-reviewed`);
      await frame.click(part("ask"));
      await frame.waitForSelector(part("review"), { timeout: 30_000 });
      const shown = await frame.locator(part("text")).textContent();
      const schedule = read<unknown>("schedules.velero.io", SCHEDULE, cluster.E2E_VIEWS_NAMESPACE);
      const body = backupFromSchedule(schedule, `${SCHEDULE}-reviewed`);

      expect(shown).toBe(body && bodyText(body));
      expect(await cluster.wordsOf(frame, part("meaning"))).toContain(
        "The backup is asked by hand and is not a submission of the schedule",
      );
      // Left by Escape: the form again, with its name, and nothing written.
      await frame.locator(part("review")).focus();
      await started?.window.keyboard.press("Escape");
      await frame.waitForSelector(part("review"), { state: "detached", timeout: 30_000 });
      expect(await nameInField()).toBe(`${SCHEDULE}-reviewed`);
      await frame.click(part("ask"));
      await frame.waitForSelector(part("review"), { timeout: 30_000 });
      await frame.click(part("back"));
      await frame.waitForSelector(part("review"), { state: "detached", timeout: 30_000 });
      await frame.waitForTimeout(NOTHING);
      expect(writesSince(earlier)).toEqual({});
    },
    TIMEOUT,
  );

  it(
    "creates exactly one Backup, the text of its review, and nothing else, says that Velero has not read it, and leads to it",
    async () => {
      const earlier = cluster.apiRequests();
      const codes = cluster.requestCodes("backups");
      const name = await nameInField();

      await frame.click(part("ask"));
      await frame.waitForSelector(part("review"), { timeout: 30_000 });
      const text = String(await frame.locator(part("text")).textContent());

      await frame.click(part("create"));
      // Read every second for thirty seconds: no controller writes a phase here.
      await frame.waitForSelector(part("result"), { timeout: 90_000 });
      const backup = read<BackupRead>("backups.velero.io", name, cluster.E2E_VIEWS_NAMESPACE);

      created.push({ namespace: cluster.E2E_VIEWS_NAMESPACE, name, uid: backup.metadata.uid });
      expect(await cluster.wordsOf(frame, part("phase"))).toBe(BACKUP_NOW_VIEW_WORDS.unread);
      // One POST of a Backup, and no other write of any kind of Velero.
      expect(cluster.counted(codes, cluster.requestCodes("backups"))).toEqual({ "POST 201": 1 });
      const written = writesSince(earlier);

      expect([Object.keys(written).length, Object.values(written)]).toEqual([1, [1]]);
      expect(Object.keys(written)[0]).toMatch(/^POST backups /);
      // Every field of the text, with the same value in the object.
      const sent = JSON.parse(text) as BackupRead;

      expect(backup.metadata.name).toBe(sent.metadata.name);
      expect(backup.metadata.namespace).toBe(sent.metadata.namespace);
      expect(backup.metadata.labels).toEqual(sent.metadata.labels);
      expect(backup.metadata.annotations).toEqual(sent.metadata.annotations);
      expect(backup.metadata.ownerReferences).toEqual(sent.metadata.ownerReferences);
      expect(backup.spec).toEqual(sent.spec);
      expect(backup.status?.phase).toBeUndefined();
      // The way to the backup takes the place of the workspace: its way back is the schedule.
      await frame.click(part("open"));
      await frame.waitForSelector("[data-testid=velero-backup-workspace]", { timeout: 30_000 });
      await cluster.closeWorkspace(frame);
      await frame.waitForSelector("[data-testid=velero-schedule-workspace]", { timeout: 30_000 });
    },
    TIMEOUT,
  );

  it(
    "lists the backup among the ones of the schedule at the next read of the view",
    async () => {
      const [backup] = created;

      expect(backup).toBeDefined();
      await frame.click("[data-testid=velero-refresh]");
      await frame.waitForSelector(`[data-history-row="${backup.name}"]`, { timeout: 60_000 });
    },
    TIMEOUT,
  );

  it(
    "says that a name already taken is taken, leads to the backup that has it, and proposes the name of the next second",
    async () => {
      const [backup] = created;
      const codes = cluster.requestCodes("backups");

      await frame.click("[data-testid=velero-schedule-back-up-now]");
      await frame.waitForSelector("[data-testid=velero-backup-now-workspace]", { timeout: 30_000 });
      await frame.locator(FIELD).first().fill(backup.name);
      await frame.click(part("ask"));
      await frame.waitForSelector(part("review"), { timeout: 30_000 });
      await frame.click(part("create"));
      await frame.waitForSelector(part("failure"), { timeout: 60_000 });
      expect(await frame.locator(part("failure")).getAttribute("data-code")).toBe("conflict");
      expect(await cluster.wordsOf(frame, part("failure-text"))).toBe(BACKUP_NOW_WORDS.exists(backup.name));
      const proposed = await nameInField();

      expect(proposed).toMatch(new RegExp(`^${SCHEDULE}-\\d{14}$`));
      expect(proposed).not.toBe(backup.name);
      expect(await frame.locator(`[data-testid="velero-open-backup-${backup.name}"]`).count()).toBe(1);
      expect(cluster.counted(codes, cluster.requestCodes("backups"))).toEqual({ "POST 409": 1 });
      // The backup that has the name is as it was.
      expect(read<BackupRead>("backups.velero.io", backup.name, cluster.E2E_VIEWS_NAMESPACE).metadata.uid).toBe(
        backup.uid,
      );
      await cluster.closeWorkspace(frame);
    },
    TIMEOUT,
  );

  it(
    "shows the form and the review in both themes, at every size and at twice the zoom, with the longest name of a schedule",
    async () => {
      if (!started) throw new Error("The application is not running");
      const problems: Record<string, string[]> = {};
      const screenshots: string[] = [];
      const earlier = cluster.apiRequests();

      await backUpNow(cluster.E2E_ADHERENCE_NAMESPACE, LONG);
      await writesOn();
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
          expect([size.name, await cluster.appliedLike(frame, expected)]).toEqual([size.name, expected]);
          await frame.waitForTimeout(1000);
          const name = `${theme.toLowerCase()}-${size.name}-backup-now`;

          problems[`${name}-form`] = await cluster.layoutProblems(frame, SCHEDULES);
          screenshots.push(await cluster.requiredScreenshot(frame, `${name}-form`, size.zoom));
          await frame.click(part("ask"));
          await frame.waitForSelector(part("review"), { timeout: 30_000 });
          problems[`${name}-review`] = await cluster.layoutProblems(frame, SCHEDULES);
          screenshots.push(await cluster.requiredScreenshot(frame, `${name}-review`, size.zoom));
          await frame.click(part("back"));
          await frame.waitForSelector(part("review"), { state: "detached", timeout: 30_000 });
        }
      }
      await velero.setZoom(started.app, 1);
      await velero.setWindowSize(started.app, 1440, 900);
      await velero.setColorTheme(started.app, started.window, "Dark");
      await cluster.writeReport("backup-now-layout", problems);
      expect(Object.fromEntries(Object.entries(problems).filter(([, found]) => found.length > 0))).toEqual({});
      expect(new Set(screenshots).size).toBe(THEMES.length * SIZES.length * 2);
      // Twelve reviews asked, none confirmed: nothing written.
      expect(writesSince(earlier)).toEqual({});
      await cluster.closeWorkspace(frame);
    },
    TIMEOUT,
  );

  it(
    "leaves the objects of Velero as they were once its backup is removed",
    async () => {
      for (const backup of created.splice(0)) cluster.removeCreatedBackup(backup.namespace, backup.name, backup.uid);
      const after = cluster.clusterSnapshot();

      expect(after.versions).toEqual(before.versions);
      expect(after.installed).toEqual(before.installed);
      expect(after.requests).toBe(0);
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
