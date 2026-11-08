/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

// The actions of SPEC-0017 in a packaged Freelens, on the CRDs of the release alone, where no controller runs
// (REQ-254, ACT-11): Back up now from the view of a schedule (T4.2), Create backup from the list of the Backups (T4.3),
// Create schedule of SPEC-0016 from the list of the Schedules (T4.7, REQ-241), Restore from the view of a backup or of a
// schedule (T4.4), and Pause and Resume from the view of a schedule (T4.5, PAUSE-04). With writes off the command
// writes nothing; a review that is not confirmed, nothing; a confirmed one, exactly one POST of the object, whose every
// field is the one of the text the review showed, or one PATCH of the schedule, the text of the review, and no other
// write. The backup stays without a phase, as the result says, and the view of the schedule lists it at its next read
// (NOW-05). A name already taken is a conflict (NOW-04). The reader of a part is refused at the creation and at the
// patch. What the suite created it removes, and the objects of Velero are as they were. The workspace in both themes,
// at every size and with the keyboard alone, is in the pre-review (ACT-10).

import { readFile, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as cluster from "../../integration/helpers/velero-cluster";
import * as velero from "../../integration/helpers/velero-extension";
import { writesOf } from "../../integration/helpers/velero-guard";
import { BACKUP_CREATE_VIEW_WORDS } from "../../src/common/backup-create-words";
import { backupFromForm, formBodyText } from "../../src/common/backup-form";
import { backupFromSchedule, bodyText } from "../../src/common/backup-from-schedule";
import { BACKUP_NOW_VIEW_WORDS } from "../../src/common/backup-now-words";
import { backupOffered, RESTORE_CREATE_VIEW_WORDS, restoreResultWords } from "../../src/common/restore-create-words";
import { type RestoreForm, restoreBodyText, restoreFromForm } from "../../src/common/restore-form";
import { scheduleResultWords } from "../../src/common/schedule-create-words";
import { scheduleBodyText, scheduleFromForm } from "../../src/common/schedule-form";
import { patchText, pausePatch, resumePatch } from "../../src/common/schedule-patch";
import { SCHEDULE_PATCH_VIEW_WORDS } from "../../src/common/schedule-patch-words";
import { BACKUP_NOW_WORDS } from "../../src/main/backup-now";
import { RESTORE_CREATE_WORDS } from "../../src/main/restore-create";
import { SCHEDULE_CREATE_WORDS } from "../../src/main/schedule-create";
import { SCHEDULE_PATCH_WORDS } from "../../src/main/schedule-patch";

import type { Frame } from "playwright";

const TIMEOUT = 15 * 60 * 1000;
const SCHEDULES = cluster.SCHEDULES;
// The schedule with a history in the installation of the views, and the name of the backups of the form.
const SCHEDULE = "views-history";
const FORM = "views-form";
// How long what must not happen is waited for.
const NOTHING = 1500;
// The context of the reader of a part, as a second entry of the catalog.
const SECOND_CONTEXT = "velero-e2e-reader";
const part = (id: string) => `[data-testid=velero-backup-now-${id}]`;
// The parts of the workspace of the backup of the form, and a field of it: the host gives its own element the
// identifier, or the input in it.
const create = (id: string) => `[data-testid=velero-backup-create-${id}]`;
const formField = (id: string) => `${create(id)} input, input${create(id)}`;
// The parts of the workspace of the schedule of the form, and a field of it.
const newSchedule = (id: string) => `[data-testid=velero-schedule-create-${id}]`;
const scheduleField = (id: string) => `${newSchedule(id)} input, input${newSchedule(id)}`;
// The parts of the workspace of a pause and of a resume.
const patch = (id: string) => `[data-testid=velero-schedule-patch-${id}]`;
// The schedule of the form the suite creates: its expression names its zone, and has no instant before the suite ends.
const SCHEDULE_FORM = { expression: "CRON_TZ=Europe/Rome 0 3 * * *", template: { storageLocation: "views-available" } };
// A choice of the form: the host gives the identifier to its input, and the class Select to the element around it,
// and its options carry the identifier with -options.
const choiceOf = (id: string) => `.Select:has(#velero-backup-create-${id})`;
const optionsOf = (id: string) => `.velero-backup-create-${id}-options .Select__option`;
// The field of the name: the host gives its own element the identifier, or the input in it.
const FIELD = `${part("field")} input, input${part("field")}`;
// The parts of the workspace of a restore, and a field of it.
const restore = (id: string) => `[data-testid=velero-restore-create-${id}]`;
const restoreField = (id: string) => `${restore(id)} input, input${restore(id)}`;
// The backup a restore is asked of in the suite, the newest that ended well of the schedule with a history, and the one
// that failed its validation, which is not offered.
const RESTORED = "views-history-1";
const NOT_RESTORABLE = "views-history-0";

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

interface ScheduleRead {
  metadata: { name: string; uid: string; resourceVersion: string };
  spec: Record<string, unknown>;
}

function read<Value>(resource: string, name: string, namespace: string): Value {
  const { status, stdout, stderr } = cluster.kubectlE2E("get", resource, name, "--namespace", namespace, "-o", "json");

  if (status !== 0) throw new Error(`kubectl get ${resource} ${name} failed: ${stderr}`);
  return JSON.parse(stdout) as Value;
}

describe("the actions of Velero, on the CRDs of the release alone", () => {
  let started: velero.StartedApplication | undefined;
  let frame: Frame;
  let kubeconfig = "";
  const errors = velero.createErrorCollector();
  let before: cluster.ClusterSnapshot;
  // What the suite created, to remove it: each backup by its name from the moment it is asked, and by its UID once
  // the suite read it. One whose creation the view did not say, created all the same, is removed by its name when it
  // was created since the suite began, a minute before it for the clocks.
  const created: { namespace: string; name: string; uid?: string }[] = [];
  // The schedules the suite created, kept and removed the same way.
  const createdSchedules: { namespace: string; name: string; uid?: string }[] = [];
  // The restores the suite created, kept and removed the same way.
  const createdRestores: { namespace: string; name: string; uid?: string }[] = [];
  let began = 0;

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
  // The workspace of a backup of the form, from the command of the list of the Backups of the installation of the views.
  const openCreate = async (on: Frame) => {
    await cluster.showList(on);
    await cluster.openPage(on, cluster.BACKUPS);
    await cluster.waitForList(on, cluster.BACKUPS);
    await on.click("[data-testid=velero-backups-create]");
    await on.waitForSelector(create("workspace"), { timeout: 30_000 });
  };
  // The workspace of a schedule of the form, from the command of the list of the Schedules of the installation of the
  // views.
  const openScheduleCreate = async (on: Frame) => {
    await cluster.showList(on);
    await cluster.openPage(on, SCHEDULES);
    await cluster.waitForList(on, SCHEDULES);
    await on.click("[data-testid=velero-schedules-create]");
    await on.waitForSelector(newSchedule("workspace"), { timeout: 30_000 });
  };
  // The workspace of a restore, from the command of the view of a backup of the installation of the views.
  const openRestore = async (on: Frame, backup: string) => {
    await cluster.showList(on);
    await cluster.openPage(on, cluster.BACKUPS);
    await cluster.waitForList(on, cluster.BACKUPS);
    await cluster.openWorkspace(on, backup, cluster.BACKUPS);
    await on.click("[data-testid=velero-backup-restore]");
    await on.waitForSelector("[data-testid=velero-restore-backup-workspace]", { timeout: 30_000 });
  };
  const nameInField = () => frame.locator(FIELD).first().inputValue();
  // The writes of the kinds of Velero since a reading of the counters, whoever made them.
  const writesSince = (earlier: Record<string, number>) => cluster.writes(earlier, cluster.apiRequests());
  // The same, each PATCH of a schedule counted: on the CRDs alone no controller patches one, and a PATCH of one is the
  // suite's. The PATCH of the storage location that the runner sends once a minute, in place of the server, is left out
  // as the guard of the suites leaves it out.
  const everyWrite = (earlier: Record<string, number>) =>
    writesOf(cluster.counted(earlier, cluster.apiRequests()), false, 0);
  // The codes of the writes of the schedules since a reading, each one counted.
  const scheduleCodes = (codes: Record<string, number>) =>
    Object.fromEntries(
      Object.entries(cluster.counted(codes, cluster.requestCodes("schedules"))).filter(
        ([key]) => !key.startsWith("GET "),
      ),
    );

  beforeAll(async () => {
    if (!cluster.fixturesReady()) {
      throw new Error(cluster.fixturesMissing());
    }
    before = cluster.clusterSnapshot();
    began = Date.now() - 60_000;
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
  }, TIMEOUT);

  afterAll(async () => {
    const left: string[] = [];

    // Each backup and each schedule the suite created is removed, whatever became of the others.
    for (const backup of created) {
      try {
        cluster.removeCreatedBackup(backup.namespace, backup.name, backup.uid, began);
      } catch (error) {
        left.push(String(error));
      }
    }
    for (const schedule of createdSchedules) {
      try {
        cluster.removeCreatedSchedule(schedule.namespace, schedule.name, schedule.uid, began);
      } catch (error) {
        left.push(String(error));
      }
    }
    for (const restored of createdRestores) {
      try {
        cluster.removeCreatedRestore(restored.namespace, restored.name, restored.uid, began);
      } catch (error) {
        left.push(String(error));
      }
    }
    if (started) errors.stop(started.window);
    await started?.cleanup();
    if (left.length > 0) throw new Error(left.join("; "));
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
      const asked: (typeof created)[number] = { namespace: cluster.E2E_VIEWS_NAMESPACE, name };

      // Known before it is asked: a backup created whose result the view does not say is removed all the same.
      created.push(asked);
      await frame.click(part("create"));
      // Read every second for thirty seconds: no controller writes a phase here.
      await frame.waitForSelector(part("result"), { timeout: 90_000 });
      const backup = read<BackupRead>("backups.velero.io", name, cluster.E2E_VIEWS_NAMESPACE);

      asked.uid = backup.metadata.uid;
      expect(await cluster.wordsOf(frame, part("phase"))).toBe(BACKUP_NOW_VIEW_WORDS.unread);
      // One POST of a Backup, and no other write of any kind of Velero. The result read the backup every second.
      const { "GET 200": _reads, ...codesOfWrites } = cluster.counted(codes, cluster.requestCodes("backups"));

      expect(codesOfWrites).toEqual({ "POST 201": 1 });
      const written = writesSince(earlier);

      expect([Object.keys(written).length, Object.values(written)]).toEqual([1, [1]]);
      expect(Object.keys(written)[0]).toMatch(/^POST backups /);
      // Every field of the text, with the same value in the object, and no other field in its metadata but the ones
      // the API server writes of every object.
      const sent = JSON.parse(text) as BackupRead;
      const {
        uid: _uid,
        resourceVersion: _version,
        creationTimestamp: _created,
        generation: _generation,
        managedFields: _fields,
        ...metadata
      } = backup.metadata as Record<string, unknown>;

      expect(metadata).toEqual(sent.metadata);
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
    "says that a name already taken is taken, leads to the backup that has it, and proposes a name of the time it failed",
    async () => {
      const [backup] = created;
      const codes = cluster.requestCodes("backups");
      // The time in UTC to the second, as the names the form proposes end with it.
      const second = (instant: number) => new Date(instant).toISOString().slice(0, 19).replace(/[-:T]/g, "");

      await frame.click("[data-testid=velero-schedule-back-up-now]");
      await frame.waitForSelector("[data-testid=velero-backup-now-workspace]", { timeout: 30_000 });
      await frame.locator(FIELD).first().fill(backup.name);
      await frame.click(part("ask"));
      await frame.waitForSelector(part("review"), { timeout: 30_000 });
      const asked = Date.now();

      await frame.click(part("create"));
      await frame.waitForSelector(part("failure"), { timeout: 60_000 });
      const failed = Date.now();

      expect(await frame.locator(part("failure")).getAttribute("data-code")).toBe("conflict");
      expect(await cluster.wordsOf(frame, part("failure-text"))).toBe(BACKUP_NOW_WORDS.exists(backup.name));
      // A name of the time the creation failed, to the second, or of the next second: the one of the next second when
      // the name taken is the one of that second is proven at the unit layer.
      const proposed = await nameInField();

      expect(proposed).toMatch(new RegExp(`^${SCHEDULE}-\\d{14}$`));
      expect([proposed >= `${SCHEDULE}-${second(asked)}`, proposed <= `${SCHEDULE}-${second(failed + 1000)}`]).toEqual([
        true,
        true,
      ]);
      expect(await frame.locator(`[data-testid="velero-open-backup-${backup.name}"]`).count()).toBe(1);
      const { "GET 200": _reads, ...codesOfWrites } = cluster.counted(codes, cluster.requestCodes("backups"));

      expect(codesOfWrites).toEqual({ "POST 409": 1 });
      // The backup that has the name is as it was.
      expect(read<BackupRead>("backups.velero.io", backup.name, cluster.E2E_VIEWS_NAMESPACE).metadata.uid).toBe(
        backup.uid,
      );
      await cluster.closeWorkspace(frame);
    },
    TIMEOUT,
  );

  it(
    "offers Create backup in the header of the list of the Backups, the locations a backup can go to with the reasons of the others, and with writes off writes nothing",
    async () => {
      const earlier = cluster.apiRequests();

      await openCreate(frame);
      // Writes are on from the cases before: off here, on again in the next case.
      await frame.click("[data-testid=velero-writes-off]");
      await frame.waitForSelector("[data-testid=velero-writes][data-writes=off]", { timeout: 60_000 });
      expect(await cluster.wordsOf(frame, `${choiceOf("storageLocation")} .Select__single-value`)).toBe(
        "views-available, marked default",
      );
      for (const [location, words] of [
        ["views-archive", BACKUP_CREATE_VIEW_WORDS.readOnly("views-archive")],
        ["views-unavailable", BACKUP_CREATE_VIEW_WORDS.unavailable("views-unavailable")],
        ["views-unreported", BACKUP_CREATE_VIEW_WORDS.unavailable("views-unreported")],
      ]) {
        expect([location, await cluster.wordsOf(frame, create(`storageLocation-refused-${location}`))]).toEqual([
          location,
          words,
        ]);
      }
      // The locations a backup can go to are offered, the one marked default first and the others by their names, and
      // none of the ones refused; the default is chosen again, which closes the menu.
      await frame.click(`${choiceOf("storageLocation")} .Select__control`);
      expect(await frame.locator(optionsOf("storageLocation")).allTextContents()).toEqual([
        "views-available, marked default",
        ...[cluster.LONG_LOCATION_NAME, "views-with-credential"].sort(),
      ]);
      await frame.locator(optionsOf("storageLocation")).first().click();
      // The namespaces the host lists are offered, each one.
      const listed = String(cluster.kubectlE2E("get", "namespaces", "-o", "jsonpath={.items[*].metadata.name}").stdout)
        .trim()
        .split(/\s+/);

      expect(listed).toContain("default");
      for (const namespace of listed)
        expect([namespace, await frame.locator(create(`includedNamespaces-${namespace}`)).count()]).toEqual([
          namespace,
          1,
        ]);
      await frame.locator(formField("field")).first().fill(`${FORM}-off`);
      await frame.locator(formField("field")).first().press("Enter");
      await frame.waitForTimeout(NOTHING);
      expect(await frame.locator(create("review")).count()).toBe(0);
      expect(await cluster.wordsOf(frame, create("writes-off"))).toBe(BACKUP_CREATE_VIEW_WORDS.writesOff);
      expect(writesSince(earlier)).toEqual({});
    },
    TIMEOUT,
  );

  it(
    "shows in its review the text of the backup of the fields set, and writes nothing for a review that is left",
    async () => {
      await writesOn();
      const earlier = cluster.apiRequests();
      const name = `${FORM}-reviewed`;
      const template = {
        includedNamespaces: ["default"],
        excludedResources: ["secrets"],
        storageLocation: "views-available",
        volumeSnapshotLocations: ["views-snapshots"],
        ttl: "72h",
      };

      await frame.locator(formField("field")).first().fill(name);
      await frame.click(create("includedNamespaces-default"));
      await frame.locator(formField("excludedResources")).first().fill("secrets");
      await frame.locator(formField("ttl")).first().fill("72h");
      await frame.click(`${choiceOf("volumeSnapshotLocations-aws")} .Select__control`);
      await frame
        .locator(optionsOf("volumeSnapshotLocations-aws"))
        .filter({ hasText: /^views-snapshots$/ })
        .first()
        .click();
      await frame.click(create("ask"));
      await frame.waitForSelector(create("review"), { timeout: 30_000 });
      const body = backupFromForm(cluster.E2E_VIEWS_NAMESPACE, name, template);

      expect(await frame.locator(create("text")).textContent()).toBe(body && formBodyText(body));
      // What the text means is said beside it: the time to live that was set, as the text writes it.
      expect(await cluster.wordsOf(frame, create("meaning"))).toContain(
        `It is kept for ${String(body?.spec.ttl)}, from when Velero starts it.`,
      );
      // Left by Escape: the form again, as it was, and nothing written.
      await frame.locator(create("review")).focus();
      await started?.window.keyboard.press("Escape");
      await frame.waitForSelector(create("review"), { state: "detached", timeout: 30_000 });
      expect(await frame.locator(formField("field")).first().inputValue()).toBe(name);
      await frame.waitForTimeout(NOTHING);
      expect(writesSince(earlier)).toEqual({});
    },
    TIMEOUT,
  );

  it(
    "creates exactly one Backup of the form, the text of its review, and nothing else, and leads to it",
    async () => {
      const earlier = cluster.apiRequests();
      const codes = cluster.requestCodes("backups");
      const name = await frame.locator(formField("field")).first().inputValue();

      await frame.click(create("ask"));
      await frame.waitForSelector(create("review"), { timeout: 30_000 });
      const text = String(await frame.locator(create("text")).textContent());
      const asked: (typeof created)[number] = { namespace: cluster.E2E_VIEWS_NAMESPACE, name };

      created.push(asked);
      await frame.click(create("create"));
      await frame.waitForSelector(create("result"), { timeout: 90_000 });
      const backup = read<BackupRead>("backups.velero.io", name, cluster.E2E_VIEWS_NAMESPACE);

      asked.uid = backup.metadata.uid;
      expect(await cluster.wordsOf(frame, create("phase"))).toBe(BACKUP_CREATE_VIEW_WORDS.unread);
      const { "GET 200": _reads, ...codesOfWrites } = cluster.counted(codes, cluster.requestCodes("backups"));

      expect(codesOfWrites).toEqual({ "POST 201": 1 });
      const written = writesSince(earlier);

      expect([Object.keys(written).length, Object.values(written)]).toEqual([1, [1]]);
      expect(Object.keys(written)[0]).toMatch(/^POST backups /);
      // Every field of the text, with the same value in the object: no label, no annotation, the fields set alone.
      const sent = JSON.parse(text) as BackupRead;
      const {
        uid: _uid,
        resourceVersion: _version,
        creationTimestamp: _created,
        generation: _generation,
        managedFields: _fields,
        ...metadata
      } = backup.metadata as Record<string, unknown>;

      expect(Object.keys(sent.metadata).sort()).toEqual(["name", "namespace"]);
      expect(metadata).toEqual(sent.metadata);
      expect(backup.spec).toEqual(sent.spec);
      expect(backup.status?.phase).toBeUndefined();
      // The way to the backup takes the place of the workspace: its way back is the list.
      await frame.click(create("open"));
      await frame.waitForSelector("[data-testid=velero-backup-workspace]", { timeout: 30_000 });
      await cluster.closeWorkspace(frame);
      await frame.waitForSelector(create("workspace"), { state: "detached", timeout: 30_000 });
      expect(await cluster.shownView(frame)).toBeUndefined();
      await cluster.waitForList(frame, cluster.BACKUPS);
    },
    TIMEOUT,
  );

  it(
    "says a name already taken before the review, and at the creation a conflict that keeps the name, with the way to the backup that has it",
    async () => {
      const backup = created[created.length - 1];
      const codes = cluster.requestCodes("backups");

      await openCreate(frame);
      await frame.locator(formField("field")).first().fill(backup.name);
      await frame.waitForSelector(create("name-taken"), { timeout: 30_000 });
      expect(await cluster.wordsOf(frame, create("name-taken"))).toBe(BACKUP_CREATE_VIEW_WORDS.nameTaken(backup.name));
      await frame.click(create("ask"));
      await frame.waitForSelector(create("review"), { timeout: 30_000 });
      await frame.click(create("create"));
      await frame.waitForSelector(create("failure"), { timeout: 60_000 });
      expect(await frame.locator(create("failure")).getAttribute("data-code")).toBe("conflict");
      expect(await cluster.wordsOf(frame, create("failure-text"))).toBe(BACKUP_NOW_WORDS.exists(backup.name));
      expect(await frame.locator(formField("field")).first().inputValue()).toBe(backup.name);
      expect(await frame.locator(`[data-testid="velero-open-backup-${backup.name}"]`).count()).toBe(1);
      const { "GET 200": _reads, ...codesOfWrites } = cluster.counted(codes, cluster.requestCodes("backups"));

      expect(codesOfWrites).toEqual({ "POST 409": 1 });
      expect(read<BackupRead>("backups.velero.io", backup.name, cluster.E2E_VIEWS_NAMESPACE).metadata.uid).toBe(
        backup.uid,
      );
      await cluster.closeWorkspace(frame);
    },
    TIMEOUT,
  );

  it(
    "opens Create schedule over the list, named in the address, leaves the list as it was when it closes, and drops a review when writes go off before the creation, which creates nothing",
    async () => {
      // Writes are on, as the case before left them.
      await frame.waitForSelector("[data-testid=velero-writes][data-writes=on]", { timeout: 60_000 });
      await cluster.showList(frame);
      await cluster.openPage(frame, SCHEDULES);
      await cluster.waitForList(frame, SCHEDULES);
      await cluster.search(frame, "views", SCHEDULES);
      await cluster.scrollList(frame, 60, SCHEDULES);
      const state = await cluster.listState(frame, SCHEDULES);

      await frame.click("[data-testid=velero-schedules-create]");
      await frame.waitForSelector(newSchedule("workspace"), { timeout: 30_000 });
      expect(await cluster.addressViews(frame)).toEqual(["schedule-create/new"]);
      await cluster.closeWorkspace(frame);
      const back = await cluster.listStateLike(frame, state, SCHEDULES);

      expect([back.search, back.items, back.first]).toEqual([state.search, state.items, state.first]);
      expect(Math.abs(back.scroll - state.scroll)).toBeLessThanOrEqual(2);
      await cluster.search(frame, "", SCHEDULES);
      // A review shown when writes go off is dropped with its token, and nothing is created (CRSCH-23).
      const earlier = cluster.apiRequests();
      const codes = cluster.requestCodes("schedules");

      await openScheduleCreate(frame);
      await frame.locator(scheduleField("field")).first().fill(`${FORM}-schedule-dropped`);
      await frame.locator(scheduleField("expression")).first().fill(SCHEDULE_FORM.expression);
      await frame.click(newSchedule("ask"));
      await frame.waitForSelector(newSchedule("review"), { timeout: 30_000 });
      await frame.click("[data-testid=velero-writes-off]");
      await frame.waitForSelector("[data-testid=velero-writes][data-writes=off]", { timeout: 60_000 });
      await frame.waitForSelector(newSchedule("review"), { state: "detached", timeout: 30_000 });
      await frame.waitForTimeout(NOTHING);
      expect(cluster.requestWrites("schedules", codes, cluster.requestCodes("schedules"))).toEqual({});
      expect(writesSince(earlier)).toEqual({});
      // Writes on again, as the next case takes them.
      await writesOn();
      await cluster.closeWorkspace(frame);
    },
    TIMEOUT,
  );

  it(
    "offers Create schedule in the header of the list of the Schedules, and with writes off fills the form and writes nothing",
    async () => {
      const earlier = cluster.apiRequests();

      await openScheduleCreate(frame);
      await frame.click("[data-testid=velero-writes-off]");
      await frame.waitForSelector("[data-testid=velero-writes][data-writes=off]", { timeout: 60_000 });
      await frame.locator(scheduleField("field")).first().fill(`${FORM}-schedule-off`);
      await frame.locator(scheduleField("expression")).first().fill(SCHEDULE_FORM.expression);
      await frame.locator(scheduleField("expression")).first().press("Enter");
      await frame.waitForTimeout(NOTHING);
      expect(await frame.locator(newSchedule("review")).count()).toBe(0);
      expect(await frame.locator(newSchedule("writes-off")).count()).toBe(1);
      expect(writesSince(earlier)).toEqual({});
    },
    TIMEOUT,
  );

  it(
    "shows in its review the text of the schedule of the fields set, the flags written, and writes nothing for a review that is left",
    async () => {
      await writesOn();
      const earlier = cluster.apiRequests();
      const name = `${FORM}-schedule`;
      const wrapper = {
        expression: SCHEDULE_FORM.expression,
        paused: false,
        skipImmediately: true,
        useOwnerReferencesInBackup: false,
      };

      await frame.locator(scheduleField("field")).first().fill(name);
      await frame.click(newSchedule("skipImmediately"));
      await frame.click(newSchedule("ask"));
      await frame.waitForSelector(newSchedule("review"), { timeout: 30_000 });
      const body = scheduleFromForm(cluster.E2E_VIEWS_NAMESPACE, name, wrapper, SCHEDULE_FORM.template, Date.now());

      expect(await frame.locator(newSchedule("text")).textContent()).toBe(body && scheduleBodyText(body));
      // Left by Escape: the form again, as it was, and nothing written.
      await frame.locator(newSchedule("review")).focus();
      await started?.window.keyboard.press("Escape");
      await frame.waitForSelector(newSchedule("review"), { state: "detached", timeout: 30_000 });
      expect(await frame.locator(scheduleField("field")).first().inputValue()).toBe(name);
      await frame.waitForTimeout(NOTHING);
      expect(writesSince(earlier)).toEqual({});
    },
    TIMEOUT,
  );

  it(
    "creates exactly one Schedule of the form, the text of its review, and nothing else, and leads to it",
    async () => {
      const earlier = cluster.apiRequests();
      const codes = cluster.requestCodes("schedules");
      const name = await frame.locator(scheduleField("field")).first().inputValue();

      await frame.click(newSchedule("ask"));
      await frame.waitForSelector(newSchedule("review"), { timeout: 30_000 });
      const text = String(await frame.locator(newSchedule("text")).textContent());
      const asked: (typeof createdSchedules)[number] = { namespace: cluster.E2E_VIEWS_NAMESPACE, name };

      createdSchedules.push(asked);
      await frame.click(newSchedule("create"));
      await frame.waitForSelector(newSchedule("result"), { timeout: 90_000 });
      const schedule = read<BackupRead>("schedules.velero.io", name, cluster.E2E_VIEWS_NAMESPACE);

      asked.uid = schedule.metadata.uid;
      // No controller runs on the CRDs alone: Velero did not read it.
      expect(await cluster.wordsOf(frame, newSchedule("phase"))).toBe(scheduleResultWords({}));
      // The controller of the environment of the demo patches the real schedule at every look: those are left out.
      expect(cluster.requestWrites("schedules", codes, cluster.requestCodes("schedules"))).toEqual({ "POST 201": 1 });
      const written = writesSince(earlier);

      expect([Object.keys(written).length, Object.values(written)]).toEqual([1, [1]]);
      expect(Object.keys(written)[0]).toMatch(/^POST schedules /);
      // Every field of the text, with the same value in the object: no label, no annotation, the three flags written.
      const sent = JSON.parse(text) as BackupRead;
      const {
        uid: _uid,
        resourceVersion: _version,
        creationTimestamp: _created,
        generation: _generation,
        managedFields: _fields,
        ...metadata
      } = schedule.metadata as Record<string, unknown>;

      expect(metadata).toEqual(sent.metadata);
      expect(schedule.spec).toEqual(sent.spec);
      expect(schedule.status?.phase).toBeUndefined();
      // The way to the schedule takes the place of the workspace: its way back is the list.
      await frame.click(newSchedule("open"));
      await frame.waitForSelector("[data-testid=velero-schedule-workspace]", { timeout: 30_000 });
      await cluster.closeWorkspace(frame);
      await frame.waitForSelector(newSchedule("workspace"), { state: "detached", timeout: 30_000 });
    },
    TIMEOUT,
  );

  it(
    "says a name already taken before the review, and at the creation a conflict that leaves the schedule that has it as it was",
    async () => {
      const schedule = createdSchedules[createdSchedules.length - 1];
      const codes = cluster.requestCodes("schedules");
      const before = read<{ metadata: { resourceVersion: string } }>(
        "schedules.velero.io",
        schedule.name,
        cluster.E2E_VIEWS_NAMESPACE,
      ).metadata.resourceVersion;

      await openScheduleCreate(frame);
      await frame.locator(scheduleField("field")).first().fill(schedule.name);
      await frame.waitForSelector(newSchedule("name-taken"), { timeout: 30_000 });
      await frame.locator(scheduleField("expression")).first().fill(SCHEDULE_FORM.expression);
      await frame.click(newSchedule("ask"));
      await frame.waitForSelector(newSchedule("review"), { timeout: 30_000 });
      await frame.click(newSchedule("create"));
      await frame.waitForSelector(newSchedule("failure"), { timeout: 60_000 });
      expect(await frame.locator(newSchedule("failure")).getAttribute("data-code")).toBe("conflict");
      expect(await cluster.wordsOf(frame, newSchedule("failure-text"))).toBe(
        SCHEDULE_CREATE_WORDS.exists(schedule.name, cluster.E2E_VIEWS_NAMESPACE),
      );
      expect(await frame.locator(scheduleField("field")).first().inputValue()).toBe(schedule.name);
      expect(await frame.locator(`[data-testid="velero-open-schedule-${schedule.name}"]`).count()).toBe(1);
      expect(cluster.requestWrites("schedules", codes, cluster.requestCodes("schedules"))).toEqual({ "POST 409": 1 });
      expect(
        read<{ metadata: { resourceVersion: string } }>(
          "schedules.velero.io",
          schedule.name,
          cluster.E2E_VIEWS_NAMESPACE,
        ).metadata.resourceVersion,
      ).toBe(before);
      await cluster.closeWorkspace(frame);
    },
    TIMEOUT,
  );

  it(
    "offers Pause in the view of the schedule of the form, which is not paused, over the view and named in the address, and with writes off writes nothing",
    async () => {
      const name = `${FORM}-schedule`;

      // Writes are on, as the case before left them.
      await frame.waitForSelector("[data-testid=velero-writes][data-writes=on]", { timeout: 60_000 });
      const earlier = cluster.apiRequests();

      await cluster.openPage(frame, SCHEDULES);
      await cluster.waitForList(frame, SCHEDULES);
      await cluster.openWorkspace(frame, name, SCHEDULES);
      expect(await frame.locator("[data-testid=velero-schedule-resume]").count()).toBe(0);
      await frame.click("[data-testid=velero-schedule-pause]");
      await frame.waitForSelector("[data-testid=velero-schedule-pause-workspace]", { timeout: 30_000 });
      expect(await cluster.addressViews(frame)).toEqual([`schedule/${name}`, `schedule-pause/${name}`]);
      await frame.click("[data-testid=velero-writes-off]");
      await frame.waitForSelector("[data-testid=velero-writes][data-writes=off]", { timeout: 60_000 });
      expect(await frame.locator(patch("writes-off")).count()).toBe(1);
      expect(await frame.locator(patch("ask")).count()).toBe(0);
      await frame.waitForTimeout(NOTHING);
      expect(everyWrite(earlier)).toEqual({});
      // Writes on again, as the next case takes them.
      await writesOn();
    },
    TIMEOUT,
  );

  it(
    "pauses it with exactly one PATCH of the Schedule, the text of its review, answered 200, and nothing else, and says it paused",
    async () => {
      const name = `${FORM}-schedule`;
      const before = read<ScheduleRead>("schedules.velero.io", name, cluster.E2E_VIEWS_NAMESPACE);
      const earlier = cluster.apiRequests();
      const codes = cluster.requestCodes("schedules");

      await frame.click(patch("ask"));
      await frame.waitForSelector(patch("review"), { timeout: 30_000 });
      expect(await frame.locator(patch("text")).textContent()).toBe(patchText(pausePatch(before.metadata.uid)));
      await frame.click(patch("run"));
      await frame.waitForSelector(patch("result"), { timeout: 60_000 });
      expect(await cluster.wordsOf(frame, patch("result-0"))).toBe(SCHEDULE_PATCH_VIEW_WORDS.paused(name));
      // One PATCH of the schedule, answered 200, and no other write of any kind of Velero.
      expect(scheduleCodes(codes)).toEqual({ "PATCH 200": 1 });
      const written = everyWrite(earlier);

      expect([Object.keys(written).length, Object.values(written)]).toEqual([1, [1]]);
      expect(Object.keys(written)[0]).toMatch(/^PATCH schedules /);
      // Paused, and nothing else of the schedule changed.
      const after = read<ScheduleRead>("schedules.velero.io", name, cluster.E2E_VIEWS_NAMESPACE);

      expect([after.metadata.uid, after.spec]).toEqual([before.metadata.uid, { ...before.spec, paused: true }]);
      // The way to the view of the schedule takes the place of the workspace, and the view offers Resume at its read.
      await frame.click(patch("open"));
      await frame.waitForSelector("[data-testid=velero-schedule-resume]", { timeout: 60_000 });
      expect(await cluster.addressViews(frame)).toEqual([`schedule/${name}`]);
    },
    TIMEOUT,
  );

  it(
    "resumes it with skip immediately as the schedule carries it, exactly one PATCH, and says what skip immediately holds",
    async () => {
      const name = `${FORM}-schedule`;
      const before = read<ScheduleRead>("schedules.velero.io", name, cluster.E2E_VIEWS_NAMESPACE);
      const earlier = cluster.apiRequests();
      const codes = cluster.requestCodes("schedules");

      expect([before.spec.paused, before.spec.skipImmediately]).toEqual([true, true]);
      await frame.click("[data-testid=velero-schedule-resume]");
      await frame.waitForSelector("[data-testid=velero-schedule-resume-workspace]", { timeout: 30_000 });
      // The schedule of the form was created with skip immediately true: the resume proposes it.
      expect(await frame.locator(patch("skip")).isChecked()).toBe(true);
      await frame.click(patch("ask"));
      await frame.waitForSelector(patch("review"), { timeout: 30_000 });
      expect(await frame.locator(patch("text")).textContent()).toBe(
        patchText(resumePatch(before.metadata.uid, { expression: SCHEDULE_FORM.expression, skipImmediately: true })),
      );
      await frame.click(patch("run"));
      await frame.waitForSelector(patch("result"), { timeout: 60_000 });
      // No controller runs on the CRDs alone: skip immediately is as written, and no run was skipped.
      expect([
        await cluster.wordsOf(frame, patch("result-0")),
        await cluster.wordsOf(frame, patch("result-1")),
      ]).toEqual([
        SCHEDULE_PATCH_VIEW_WORDS.resumed(name),
        SCHEDULE_PATCH_VIEW_WORDS.skipAfter({ name, uid: before.metadata.uid, paused: false, skipImmediately: true }),
      ]);
      expect(scheduleCodes(codes)).toEqual({ "PATCH 200": 1 });
      expect(Object.values(everyWrite(earlier))).toEqual([1]);
      const after = read<ScheduleRead>("schedules.velero.io", name, cluster.E2E_VIEWS_NAMESPACE);

      expect(after.spec).toEqual({ ...before.spec, paused: false, skipImmediately: true });
      await cluster.closeWorkspace(frame);
      await frame.waitForSelector("[data-testid=velero-schedule-resume-workspace]", {
        state: "detached",
        timeout: 30_000,
      });
      await cluster.closeWorkspace(frame);
    },
    TIMEOUT,
  );

  it(
    "offers Restore in the view of a backup that ended well, says why not for one that failed its validation, and with writes off writes nothing",
    async () => {
      const earlier = cluster.apiRequests();

      await cluster.showList(frame);
      await cluster.openPage(frame, cluster.BACKUPS);
      await cluster.waitForList(frame, cluster.BACKUPS);
      await cluster.openWorkspace(frame, NOT_RESTORABLE, cluster.BACKUPS);
      expect(await frame.locator("[data-testid=velero-backup-restore]").isDisabled()).toBe(true);
      expect(await cluster.wordsOf(frame, "[data-testid=velero-backup-restore-note]")).toBe(
        backupOffered("FailedValidation").words,
      );
      await cluster.closeWorkspace(frame);
      await openRestore(frame, RESTORED);
      // Writes are on from the cases before: off here, on again in the next case.
      if ((await cluster.writesState(frame)) === "on") {
        await frame.click("[data-testid=velero-writes-off]");
        await frame.waitForSelector("[data-testid=velero-writes][data-writes=off]", { timeout: 60_000 });
      }
      expect(await frame.locator(restoreField("field")).first().inputValue()).toMatch(
        new RegExp(`^${RESTORED}-\\d{14}$`),
      );
      await frame.click(restore("clusterResources-none"));
      await frame.locator(restoreField("field")).first().press("Enter");
      await frame.waitForTimeout(NOTHING);
      expect(await frame.locator(restore("review")).count()).toBe(0);
      expect(await cluster.wordsOf(frame, restore("writes-off"))).toBe(RESTORE_CREATE_VIEW_WORDS.writesOff);
      expect(writesSince(earlier)).toEqual({});
    },
    TIMEOUT,
  );

  it(
    "shows in its review the text of the restore of the fields set, and writes nothing for a review that is left",
    async () => {
      await writesOn();
      const earlier = cluster.apiRequests();
      const name = await frame.locator(restoreField("field")).first().inputValue();
      // The namespace the backup includes, which the form offers by its name: a mapping restores from it.
      const backup = read<{ spec?: { includedNamespaces?: string[]; excludedNamespaces?: string[] } }>(
        "backups.velero.io",
        RESTORED,
        cluster.E2E_VIEWS_NAMESPACE,
      );
      const source = backup.spec?.includedNamespaces?.[0] ?? "";
      const form: RestoreForm = {
        includedNamespaces: [source],
        namespaceMapping: [[source, "views-restored"]],
        clusterResources: "none",
        existingResourcePolicy: "update",
      };

      expect(source).not.toBe("");
      await frame.click(restore(`includedNamespaces-${source}`));
      await frame.click(restore("namespaceMapping-add"));
      await frame.locator(restore("namespaceMapping-source-0")).fill(source);
      await frame.locator(restore("namespaceMapping-target-0")).fill("views-restored");
      await frame.click(restore("existingResourcePolicy-update"));
      await frame.click(restore("ask"));
      await frame.waitForSelector(restore("review"), { timeout: 30_000 });
      const body = restoreFromForm(cluster.E2E_VIEWS_NAMESPACE, name, RESTORED, form, {
        ...(backup.spec?.includedNamespaces ? { includedNamespaces: backup.spec.includedNamespaces } : {}),
        ...(backup.spec?.excludedNamespaces ? { excludedNamespaces: backup.spec.excludedNamespaces } : {}),
      });

      expect(await frame.locator(restore("text")).textContent()).toBe(body && restoreBodyText(body));
      expect(await cluster.wordsOf(frame, restore("meaning"))).toContain(
        "Resources that exist: update. Velero applies to a resource of the backup that exists in the cluster",
      );
      // Left by Escape: the form again, as it was, and nothing written.
      await frame.locator(restore("review")).focus();
      await started?.window.keyboard.press("Escape");
      await frame.waitForSelector(restore("review"), { state: "detached", timeout: 30_000 });
      expect(await frame.locator(restoreField("field")).first().inputValue()).toBe(name);
      await frame.waitForTimeout(NOTHING);
      expect(writesSince(earlier)).toEqual({});
    },
    TIMEOUT,
  );

  it(
    "creates exactly one Restore of the backup, the text of its review, only once the name of the backup is typed, and nothing else, and leads to it",
    async () => {
      const earlier = cluster.apiRequests();
      const codes = cluster.requestCodes("restores");
      const name = await frame.locator(restoreField("field")).first().inputValue();

      await frame.click(restore("ask"));
      await frame.waitForSelector(restore("review"), { timeout: 30_000 });
      const text = String(await frame.locator(restore("text")).textContent());

      expect(await frame.locator(restore("create")).isDisabled()).toBe(true);
      await frame.locator(restoreField("typed")).first().fill(RESTORED.slice(0, -1));
      expect(await frame.locator(restore("create")).isDisabled()).toBe(true);
      await frame.locator(restoreField("typed")).first().fill(RESTORED);
      const asked: (typeof createdRestores)[number] = { namespace: cluster.E2E_VIEWS_NAMESPACE, name };

      createdRestores.push(asked);
      await frame.click(restore("create"));
      await frame.waitForSelector(restore("result"), { timeout: 90_000 });
      const restored = read<BackupRead>("restores.velero.io", name, cluster.E2E_VIEWS_NAMESPACE);

      asked.uid = restored.metadata.uid;
      // No controller runs on the CRDs alone: Velero did not read it.
      expect(await cluster.wordsOf(frame, restore("phase"))).toBe(restoreResultWords(undefined));
      const { "GET 200": _reads, ...codesOfWrites } = cluster.counted(codes, cluster.requestCodes("restores"));

      expect(codesOfWrites).toEqual({ "POST 201": 1 });
      const written = writesSince(earlier);

      expect([Object.keys(written).length, Object.values(written)]).toEqual([1, [1]]);
      expect(Object.keys(written)[0]).toMatch(/^POST restores /);
      // Every field of the text, with the same value in the object: its name and its namespace alone, no label, no
      // annotation, its backup by name and no schedule.
      const sent = JSON.parse(text) as BackupRead & { spec: Record<string, unknown> };
      const {
        uid: _uid,
        resourceVersion: _version,
        creationTimestamp: _created,
        generation: _generation,
        managedFields: _fields,
        ...metadata
      } = restored.metadata as Record<string, unknown>;

      expect(Object.keys(sent.metadata).sort()).toEqual(["name", "namespace"]);
      expect(metadata).toEqual(sent.metadata);
      expect(restored.spec).toEqual(sent.spec);
      expect([sent.spec.backupName, "scheduleName" in sent.spec]).toEqual([RESTORED, false]);
      expect(restored.status?.phase).toBeUndefined();
      // The way to the restore takes the place of the workspace.
      await frame.click(restore("open"));
      await frame.waitForSelector("[data-testid=velero-restore-workspace]", { timeout: 30_000 });
      await cluster.closeWorkspace(frame);
    },
    TIMEOUT,
  );

  it(
    "says a name already taken before the review, and at the creation a conflict that keeps the form, with the way to the restore that has it",
    async () => {
      const taken = createdRestores[createdRestores.length - 1];
      const codes = cluster.requestCodes("restores");

      await openRestore(frame, RESTORED);
      await frame.locator(restoreField("field")).first().fill(taken.name);
      await frame.waitForSelector(restore("name-taken"), { timeout: 30_000 });
      expect(await cluster.wordsOf(frame, restore("name-taken"))).toBe(RESTORE_CREATE_VIEW_WORDS.nameTaken(taken.name));
      await frame.click(restore("clusterResources-needed"));
      await frame.click(restore("ask"));
      await frame.waitForSelector(restore("review"), { timeout: 30_000 });
      await frame.locator(restoreField("typed")).first().fill(RESTORED);
      await frame.click(restore("create"));
      await frame.waitForSelector(restore("failure"), { timeout: 60_000 });
      expect(await frame.locator(restore("failure")).getAttribute("data-code")).toBe("conflict");
      expect(await cluster.wordsOf(frame, restore("failure-text"))).toBe(
        RESTORE_CREATE_WORDS.exists(taken.name, cluster.E2E_VIEWS_NAMESPACE),
      );
      expect(await frame.locator(restoreField("field")).first().inputValue()).toBe(taken.name);
      expect(await frame.locator(`[data-testid="velero-open-restore-${taken.name}"]`).count()).toBe(1);
      const { "GET 200": _reads, ...codesOfWrites } = cluster.counted(codes, cluster.requestCodes("restores"));

      expect(codesOfWrites).toEqual({ "POST 409": 1 });
      expect(read<BackupRead>("restores.velero.io", taken.name, cluster.E2E_VIEWS_NAMESPACE).metadata.uid).toBe(
        taken.uid,
      );
      await cluster.closeWorkspace(frame);
    },
    TIMEOUT,
  );

  it(
    "restores from the view of a schedule the newest of its backups that ended well, and creates exactly one Restore of it, the text of its review",
    async () => {
      const earlier = cluster.apiRequests();
      const codes = cluster.requestCodes("restores");

      await cluster.showList(frame);
      await cluster.openPage(frame, SCHEDULES);
      await cluster.waitForList(frame, SCHEDULES);
      await cluster.openWorkspace(frame, SCHEDULE, SCHEDULES);
      await frame.click("[data-testid=velero-schedule-restore]");
      await frame.waitForSelector("[data-testid=velero-restore-schedule-workspace]", { timeout: 30_000 });
      expect(await frame.locator(restore(`from-${RESTORED}`)).isChecked()).toBe(true);
      expect(await frame.locator(restore(`from-${NOT_RESTORABLE}`)).count()).toBe(0);
      const name = await frame.locator(restoreField("field")).first().inputValue();

      expect(name).toMatch(new RegExp(`^${RESTORED}-\\d{14}$`));
      await frame.click(restore("clusterResources-none"));
      await frame.click(restore("ask"));
      await frame.waitForSelector(restore("review"), { timeout: 30_000 });
      const text = String(await frame.locator(restore("text")).textContent());

      await frame.locator(restoreField("typed")).first().fill(RESTORED);
      const asked: (typeof createdRestores)[number] = { namespace: cluster.E2E_VIEWS_NAMESPACE, name };

      createdRestores.push(asked);
      await frame.click(restore("create"));
      await frame.waitForSelector(restore("result"), { timeout: 90_000 });
      const restored = read<BackupRead & { spec: Record<string, unknown> }>(
        "restores.velero.io",
        name,
        cluster.E2E_VIEWS_NAMESPACE,
      );

      asked.uid = restored.metadata.uid;
      // Exactly one POST of a Restore, answered 201, and no other write, of the text the review showed.
      const { "GET 200": _reads, ...codesOfWrites } = cluster.counted(codes, cluster.requestCodes("restores"));

      expect(codesOfWrites).toEqual({ "POST 201": 1 });
      const written = writesSince(earlier);

      expect([Object.keys(written).length, Object.values(written)]).toEqual([1, [1]]);
      expect(Object.keys(written)[0]).toMatch(/^POST restores /);
      const sent = JSON.parse(text) as BackupRead & { spec: Record<string, unknown> };
      const {
        uid: _uid,
        resourceVersion: _version,
        creationTimestamp: _created,
        generation: _generation,
        managedFields: _fields,
        ...metadata
      } = restored.metadata as Record<string, unknown>;

      expect(metadata).toEqual(sent.metadata);
      expect(restored.spec).toEqual(sent.spec);
      expect(sent.spec.backupName).toBe(RESTORED);
      await cluster.closeWorkspace(frame);
    },
    TIMEOUT,
  );

  it(
    "refuses the reader of a part at the creation and at the patch, with the words of what it may not do, writes left on and nothing written",
    async () => {
      if (!started) throw new Error("The application is not running");
      const running = started;
      // A second entry of the catalog: the same cluster through the kubeconfig of the reader of a part, which may read
      // the backups, the schedules and the storage locations of the namespace of the views, and create nothing. Its
      // context is renamed: the catalog tells the two entries apart by it.
      const source = JSON.parse(await readFile(cluster.readerKubeconfigPath(), "utf8")) as {
        contexts?: { name: string }[];
        "current-context"?: string;
      };

      for (const context of source.contexts ?? []) context.name = SECOND_CONTEXT;
      source["current-context"] = SECOND_CONTEXT;
      const renamed = path.join(running.directory, "reader-kubeconfig.json");

      await writeFile(renamed, JSON.stringify(source), { mode: 0o600 });
      const second = await cluster.publishKubeconfig(renamed, "velero-e2e-reader");
      const earlier = cluster.apiRequests();
      const name = `${SCHEDULE}-of-the-reader`;

      try {
        await velero.navigateToCatalog(running.app);
        await running.window.waitForSelector(`div.TableCell >> text='${SECOND_CONTEXT}'`, { timeout: 60_000 });
        const other = await cluster.openClusterFromCatalog(running.window, second, SECOND_CONTEXT);

        await cluster.openPage(other, SCHEDULES);
        await cluster.configureInstallation(other, cluster.E2E_VIEWS_NAMESPACE);
        await cluster.waitForList(other, SCHEDULES);
        await cluster.openWorkspace(other, SCHEDULE, SCHEDULES);
        await other.click("[data-testid=velero-schedule-back-up-now]");
        await other.waitForSelector("[data-testid=velero-backup-now-workspace]", { timeout: 30_000 });
        await other.waitForSelector("[data-testid=velero-writes-on]", { timeout: 60_000 });
        await cluster.turnWritesOn(other);
        await other.locator(FIELD).first().fill(name);
        // The reads of the review are the reader's own: the schedule is read, and the review shown.
        await other.click(part("ask"));
        await other.waitForSelector(part("review"), { timeout: 30_000 });
        await other.click(part("create"));
        await other.waitForSelector(part("failure"), { timeout: 60_000 });
        expect([
          await other.locator(part("failure")).getAttribute("data-code"),
          await other.locator(part("failure")).getAttribute("data-stage"),
          await cluster.wordsOf(other, part("failure-text")),
        ]).toEqual(["forbidden", "creation", BACKUP_NOW_WORDS.forbiddenCreate(cluster.E2E_VIEWS_NAMESPACE)]);
        // The refusal is of the cluster, not of the gate: writes stay on, and nothing is in the namespace.
        await other.waitForTimeout(NOTHING);
        expect(await cluster.writesState(other)).toBe("on");
        expect(
          cluster.kubectlE2E("get", "backups.velero.io", name, "--namespace", cluster.E2E_VIEWS_NAMESPACE).status,
        ).not.toBe(0);
        expect(writesSince(earlier)).toEqual({});
        expect(await cluster.layoutProblems(other, SCHEDULES)).toEqual([]);
        // The backup of the form, refused the same way: the reads of the review are the reader's own.
        const formName = `${FORM}-of-the-reader`;

        await openCreate(other);
        await other.locator(formField("field")).first().fill(formName);
        await other.click(create("ask"));
        await other.waitForSelector(create("review"), { timeout: 30_000 });
        // Removed after the suite should the reader ever create it.
        created.push({ namespace: cluster.E2E_VIEWS_NAMESPACE, name: formName });
        await other.click(create("create"));
        await other.waitForSelector(create("failure"), { timeout: 60_000 });
        expect([
          await other.locator(create("failure")).getAttribute("data-code"),
          await other.locator(create("failure")).getAttribute("data-stage"),
          await cluster.wordsOf(other, create("failure-text")),
        ]).toEqual(["forbidden", "creation", BACKUP_NOW_WORDS.forbiddenCreate(cluster.E2E_VIEWS_NAMESPACE)]);
        // Writes stay on here as well, and nothing is in the namespace.
        await other.waitForTimeout(NOTHING);
        expect(await cluster.writesState(other)).toBe("on");
        expect(
          cluster.kubectlE2E("get", "backups.velero.io", formName, "--namespace", cluster.E2E_VIEWS_NAMESPACE).status,
        ).not.toBe(0);
        expect(writesSince(earlier)).toEqual({});
        expect(await cluster.layoutProblems(other, cluster.BACKUPS)).toEqual([]);
        // The schedule of the form, refused the same way.
        const scheduleName = `${FORM}-schedule-of-the-reader`;

        await openScheduleCreate(other);
        await other.locator(scheduleField("field")).first().fill(scheduleName);
        await other.locator(scheduleField("expression")).first().fill(SCHEDULE_FORM.expression);
        await other.click(newSchedule("ask"));
        await other.waitForSelector(newSchedule("review"), { timeout: 30_000 });
        await other.click(newSchedule("create"));
        await other.waitForSelector(newSchedule("failure"), { timeout: 60_000 });
        expect([
          await other.locator(newSchedule("failure")).getAttribute("data-code"),
          await other.locator(newSchedule("failure")).getAttribute("data-stage"),
          await cluster.wordsOf(other, newSchedule("failure-text")),
        ]).toEqual(["forbidden", "creation", SCHEDULE_CREATE_WORDS.forbiddenCreate(cluster.E2E_VIEWS_NAMESPACE)]);
        expect(
          cluster.kubectlE2E("get", "schedules.velero.io", scheduleName, "--namespace", cluster.E2E_VIEWS_NAMESPACE)
            .status,
        ).not.toBe(0);
        expect(writesSince(earlier)).toEqual({});
        // A restore, refused the same way: the reader may read the backup, and create no restore.
        await openRestore(other, RESTORED);
        const restoreName = await other.locator(restoreField("field")).first().inputValue();

        createdRestores.push({ namespace: cluster.E2E_VIEWS_NAMESPACE, name: restoreName });
        await other.click(restore("clusterResources-none"));
        await other.click(restore("ask"));
        await other.waitForSelector(restore("review"), { timeout: 30_000 });
        await other.locator(restoreField("typed")).first().fill(RESTORED);
        await other.click(restore("create"));
        await other.waitForSelector(restore("failure"), { timeout: 60_000 });
        expect([
          await other.locator(restore("failure")).getAttribute("data-code"),
          await other.locator(restore("failure")).getAttribute("data-stage"),
          await cluster.wordsOf(other, restore("failure-text")),
        ]).toEqual(["forbidden", "creation", RESTORE_CREATE_WORDS.forbiddenCreate(cluster.E2E_VIEWS_NAMESPACE)]);
        await other.waitForTimeout(NOTHING);
        expect(await cluster.writesState(other)).toBe("on");
        expect(writesSince(earlier)).toEqual({});
        // The pause of a schedule, refused at the patch: the reader may read the schedules, and patch none.
        const history = read<ScheduleRead>("schedules.velero.io", SCHEDULE, cluster.E2E_VIEWS_NAMESPACE);

        await cluster.showList(other);
        await cluster.openPage(other, SCHEDULES);
        await cluster.waitForList(other, SCHEDULES);
        await cluster.openWorkspace(other, SCHEDULE, SCHEDULES);
        await other.click("[data-testid=velero-schedule-pause]");
        await other.waitForSelector(patch("ask"), { timeout: 30_000 });
        await other.click(patch("ask"));
        await other.waitForSelector(patch("review"), { timeout: 30_000 });
        await other.click(patch("run"));
        await other.waitForSelector(patch("failure"), { timeout: 60_000 });
        expect([
          await other.locator(patch("failure")).getAttribute("data-code"),
          await other.locator(patch("failure")).getAttribute("data-stage"),
          await cluster.wordsOf(other, patch("failure-text")),
        ]).toEqual(["forbidden", "patch", SCHEDULE_PATCH_WORDS.forbidden(cluster.E2E_VIEWS_NAMESPACE)]);
        await other.waitForTimeout(NOTHING);
        expect(await cluster.writesState(other)).toBe("on");
        expect(
          read<ScheduleRead>("schedules.velero.io", SCHEDULE, cluster.E2E_VIEWS_NAMESPACE).metadata.resourceVersion,
        ).toBe(history.metadata.resourceVersion);
        expect(everyWrite(earlier)).toEqual({});
      } finally {
        // The cases after this one look at the first entry of the catalog, which is shown again.
        await velero.navigateToCatalog(running.app);
        frame = await cluster.openClusterFromCatalog(running.window, kubeconfig);
      }
    },
    TIMEOUT,
  );

  it(
    "leaves the objects of Velero as they were once its backups, its schedules and its restores are removed",
    async () => {
      // Each one is let go once it was removed: one whose removal failed is tried again after the suite.
      for (const backup of [...created]) {
        cluster.removeCreatedBackup(backup.namespace, backup.name, backup.uid, began);
        created.splice(created.indexOf(backup), 1);
      }
      for (const schedule of [...createdSchedules]) {
        cluster.removeCreatedSchedule(schedule.namespace, schedule.name, schedule.uid, began);
        createdSchedules.splice(createdSchedules.indexOf(schedule), 1);
      }
      for (const restored of [...createdRestores]) {
        cluster.removeCreatedRestore(restored.namespace, restored.name, restored.uid, began);
        createdRestores.splice(createdRestores.indexOf(restored), 1);
      }
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
