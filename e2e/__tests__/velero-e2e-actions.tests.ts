/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

// The actions of SPEC-0017 in a packaged Freelens, on the CRDs of the release alone, where no controller runs
// (REQ-254, ACT-11): Back up now from the view of a schedule (T4.2), Create backup from the list of the Backups (T4.3),
// Create schedule of SPEC-0016 from the list of the Schedules (T4.7, REQ-241), Restore from the view of a backup or of a
// schedule (T4.4), Pause and Resume from the view of a schedule (T4.5, PAUSE-04), and Delete backup from the view of a
// backup (T4.6, DELETE-05). With writes off the command writes nothing; a review that is not confirmed, nothing; a
// confirmed one, exactly one POST of the object, whose every field is the one of the text the review showed, or one
// PATCH of the schedule, the text of the review, and no other write. The backup stays without a phase, as the result
// says, and the view of the schedule lists it at its next read (NOW-05); a request to delete a backup stays without a
// phase, and the backup as it was. A name already taken is a conflict (NOW-04). The reader of a part is refused at the
// creation and at the patch. What the suite created it removes, and the objects of Velero are as they were. The
// workspace in both themes, at every size and with the keyboard alone, is in the pre-review (ACT-10).

import { readFile, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as cluster from "../../integration/helpers/velero-cluster";
import * as velero from "../../integration/helpers/velero-extension";
import { writesOf } from "../../integration/helpers/velero-guard";
import { BACKUP_CREATE_VIEW_WORDS } from "../../src/common/backup-create-words";
import {
  BACKUP_DELETE_VIEW_WORDS,
  deletedWords,
  deleteMeaning,
  deleteOffered,
} from "../../src/common/backup-delete-words";
import { backupFromForm, formBodyText } from "../../src/common/backup-form";
import { backupFromSchedule, bodyText } from "../../src/common/backup-from-schedule";
import { BACKUP_NOW_VIEW_WORDS } from "../../src/common/backup-now-words";
import { deleteRequestOf, deleteRequestText } from "../../src/common/delete-request";
import { backupOffered, RESTORE_CREATE_VIEW_WORDS, restoreResultWords } from "../../src/common/restore-create-words";
import { type RestoreForm, restoreBodyText, restoreFromForm } from "../../src/common/restore-form";
import { scheduleResultWords } from "../../src/common/schedule-create-words";
import { scheduleBodyText, scheduleFromForm } from "../../src/common/schedule-form";
import { patchText, pausePatch, resumePatch } from "../../src/common/schedule-patch";
import { SCHEDULE_PATCH_VIEW_WORDS } from "../../src/common/schedule-patch-words";
import { BACKUP_DELETE_WORDS } from "../../src/main/backup-delete";
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
// The parts of the workspace of a deletion, and a field of it.
const deletion = (id: string) => `[data-testid=velero-backup-delete-${id}]`;
const deletionField = (id: string) => `${deletion(id)} input, input${deletion(id)}`;
// The backup the suite deletes, the one of the form it created, which no controller starts on the CRDs alone; and the
// backup in progress of the installation of the views, which Delete backup is not offered for.
const DELETED = `${FORM}-reviewed`;
const IN_PROGRESS_BACKUP = "backup-inprogress";
// The reads of the request and of the backup by their names that the reads after the creation of a deletion make at
// least, of each: the case that deletes says why.
const READS_AFTER = 10;

interface BackupRead {
  metadata: {
    name: string;
    namespace: string;
    uid: string;
    resourceVersion?: string;
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
  // The requests to delete a backup the suite created and read, each by its name and the UID the suite read of it,
  // removed by that UID as the backups, the schedules and the restores are; one read without the label of the UID of
  // its backup, by its name when it was created since the suite began.
  const createdRequests: { namespace: string; name: string; uid?: string }[] = [];
  // The backups whose deletion the suite asked, by their UID from the moment each is asked: a request of one of them
  // that the suite did not read is removed by the label of that UID when it was created since the suite began.
  const askedDeletions: { namespace: string; backupUid: string }[] = [];
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
    for (const request of createdRequests) {
      try {
        cluster.removeCreatedDeleteRequest(request.namespace, request.name, request.uid, began);
      } catch (error) {
        left.push(String(error));
      }
    }
    for (const asked of askedDeletions) {
      try {
        cluster.removeCreatedDeleteRequests(asked.namespace, asked.backupUid, began);
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
    "offers Delete backup in the view of a backup and on no row of the list, says why not for one in progress, offers it with writes off, opens over the view and named in the address, leads to the writes of the target bar, and writes nothing",
    async () => {
      const earlier = cluster.apiRequests();

      await cluster.showList(frame);
      await cluster.openPage(frame, cluster.BACKUPS);
      await cluster.waitForList(frame, cluster.BACKUPS);
      // No row of the list offers a deletion: the view of one backup does (DELETE-07).
      expect(
        await frame
          .locator("[data-testid=velero-backups] .TableRow:not(.TableHead) [data-testid^=velero-backup-delete]")
          .count(),
      ).toBe(0);
      await cluster.openWorkspace(frame, IN_PROGRESS_BACKUP, cluster.BACKUPS);
      expect(await frame.locator("[data-testid=velero-backup-delete]").isDisabled()).toBe(true);
      expect(await cluster.wordsOf(frame, "[data-testid=velero-backup-delete-note]")).toBe(
        deleteOffered("InProgress").words,
      );
      await cluster.closeWorkspace(frame);
      // Writes are on from the cases before: off here, before the command, which is offered with writes off as with
      // writes on (REQ-252); on again in the next case.
      if ((await cluster.writesState(frame)) === "on") {
        await frame.click("[data-testid=velero-writes-off]");
        await frame.waitForSelector("[data-testid=velero-writes][data-writes=off]", { timeout: 60_000 });
      }
      // The backup of the form, which no controller started: offered, with the words of a backup without a phase that
      // names its storage location.
      await cluster.openWorkspace(frame, DELETED, cluster.BACKUPS);
      expect(await frame.locator("[data-testid=velero-backup-delete]").isDisabled()).toBe(false);
      expect(await cluster.wordsOf(frame, "[data-testid=velero-backup-delete-note]")).toBe(
        deleteOffered(undefined, "views-available").words,
      );
      await frame.click("[data-testid=velero-backup-delete]");
      await frame.waitForSelector("[data-testid=velero-backup-delete-workspace]", { timeout: 30_000 });
      expect(await cluster.addressViews(frame)).toEqual([`backup/${DELETED}`, `backup-delete/${DELETED}`]);
      expect(await cluster.wordsOf(frame, deletion("writes-off"))).toBe(BACKUP_DELETE_VIEW_WORDS.writesOff);
      expect(await frame.locator(deletion("ask")).count()).toBe(0);
      // The way to the writes of the target bar.
      await frame.click(deletion("to-target"));
      expect(await cluster.focusOn(frame, "velero-writes-on")).toBe("velero-writes-on");
      await frame.waitForTimeout(NOTHING);
      expect(everyWrite(earlier)).toEqual({});
    },
    TIMEOUT,
  );

  it(
    "shows in its review the request of the backup and what it means, enables Delete backup only once the name is typed as it is written, sends nothing for Enter on a name that is not, and writes nothing for a review that is left",
    async () => {
      await writesOn();
      const earlier = cluster.apiRequests();
      const backup = read<BackupRead & { spec: { storageLocation?: string } }>(
        "backups.velero.io",
        DELETED,
        cluster.E2E_VIEWS_NAMESPACE,
      );

      expect([backup.spec.storageLocation, backup.status?.phase]).toEqual(["views-available", undefined]);
      await frame.click(deletion("ask"));
      await frame.waitForSelector(deletion("review"), { timeout: 30_000 });
      expect(await frame.locator(deletion("text")).textContent()).toBe(
        deleteRequestText(deleteRequestOf(cluster.E2E_VIEWS_NAMESPACE, { name: DELETED, uid: backup.metadata.uid })),
      );
      // What it means: the backup without a phase, its location Available, and no other request of a backup of its
      // name.
      expect(await frame.locator(`${deletion("meaning")} li`).allTextContents()).toEqual(
        deleteMeaning(DELETED, { storageLocation: "views-available", location: { phase: "Available" }, others: 0 }).map(
          (meaning) => meaning.words,
        ),
      );
      // The parts by their names, written here and not taken from the words: a part dropped or added fails here.
      expect(
        await frame
          .locator(`${deletion("meaning")} li`)
          .evaluateAll((items) => items.map((item) => item.getAttribute("data-part"))),
      ).toEqual(["request", "phase", "order", "failure", "location", "installations", "undone"]);
      expect(await frame.locator(deletion("run")).isDisabled()).toBe(true);
      await frame.locator(deletionField("typed")).first().fill(DELETED.slice(0, -1));
      expect(await frame.locator(deletion("run")).isDisabled()).toBe(true);
      expect(await cluster.wordsOf(frame, deletion("typed-state"))).toBe(BACKUP_DELETE_VIEW_WORDS.notTyped(DELETED));
      // One character more, the name in capitals and the name after a space: Delete backup disabled each time, and
      // Enter in the field keeps the review and sends nothing (DELETE-04).
      for (const near of [`${DELETED}x`, DELETED.toUpperCase(), ` ${DELETED}`]) {
        await frame.locator(deletionField("typed")).first().fill(near);
        expect([near, await frame.locator(deletion("run")).isDisabled()]).toEqual([near, true]);
        await frame.locator(deletionField("typed")).first().press("Enter");
        await frame.waitForTimeout(NOTHING);
        expect([near, await frame.locator(deletion("review")).count()]).toEqual([near, 1]);
      }
      // Left by Escape: the command again, and a new review asks for the name again.
      await frame.locator(deletion("review")).focus();
      await started?.window.keyboard.press("Escape");
      await frame.waitForSelector(deletion("review"), { state: "detached", timeout: 30_000 });
      await frame.click(deletion("ask"));
      await frame.waitForSelector(deletion("review"), { timeout: 30_000 });
      expect(await frame.locator(deletionField("typed")).first().inputValue()).toBe("");
      await frame.click(deletion("back"));
      await frame.waitForSelector(deletion("review"), { state: "detached", timeout: 30_000 });
      await frame.waitForTimeout(NOTHING);
      expect(everyWrite(earlier)).toEqual({});
    },
    TIMEOUT,
  );

  it(
    "deletes it with exactly one POST of a DeleteBackupRequest, the text of its review, once the name is typed, and nothing else, no write of the backup, reads it with the backup for thirty seconds and says that Velero has not read it, and a new review says that request",
    async () => {
      const backup = read<BackupRead>("backups.velero.io", DELETED, cluster.E2E_VIEWS_NAMESPACE);
      const earlier = cluster.apiRequests();
      const codes = cluster.requestCodes("deletebackuprequests");
      const backupCodes = cluster.requestCodes("backups");

      await frame.click(deletion("ask"));
      await frame.waitForSelector(deletion("review"), { timeout: 30_000 });
      const text = String(await frame.locator(deletion("text")).textContent());

      await frame.locator(deletionField("typed")).first().fill(DELETED);
      expect(await cluster.wordsOf(frame, deletion("typed-state"))).toBe(BACKUP_DELETE_VIEW_WORDS.typed);
      // Known before it is asked: a request created whose result the view does not say is removed all the same.
      askedDeletions.push({ namespace: cluster.E2E_VIEWS_NAMESPACE, backupUid: backup.metadata.uid });
      await frame.click(deletion("run"));
      // Read with the backup every second for thirty seconds: no controller processes it here.
      await frame.waitForSelector(deletion("result"), { timeout: 90_000 });
      // The reads after the creation (REQ-282), as the API server counted them before the suite reads anything of
      // Velero: a read of the request and of the backup every second for thirty seconds makes about twenty-nine of
      // each. Ten of each hold while a read of both takes up to two seconds, and reads that stop at once make none of
      // the request and two of the backup, the review's and the run's.
      const reads = cluster.counted(earlier, cluster.apiRequests());

      expect(reads["GET deletebackuprequests resource"] ?? 0).toBeGreaterThanOrEqual(READS_AFTER);
      expect(reads["GET backups resource"] ?? 0).toBeGreaterThanOrEqual(READS_AFTER);
      expect(await frame.locator(deletion("result")).getAttribute("data-end")).toBe("unread");
      expect(await cluster.wordsOf(frame, deletion("result-0"))).toBe(deletedWords(DELETED, { end: "unread" })[0]);
      // One POST of a DeleteBackupRequest, answered 201, no write of the backup, and no other write of any kind of
      // Velero: no DELETE.
      const { "GET 200": _reads, ...codesOfWrites } = cluster.counted(
        codes,
        cluster.requestCodes("deletebackuprequests"),
      );
      const { "GET 200": _backupReads, ...backupWrites } = cluster.counted(
        backupCodes,
        cluster.requestCodes("backups"),
      );

      expect([codesOfWrites, backupWrites]).toEqual([{ "POST 201": 1 }, {}]);
      const written = everyWrite(earlier);

      expect([Object.keys(written).length, Object.values(written)]).toEqual([1, [1]]);
      expect(Object.keys(written)[0]).toMatch(/^POST deletebackuprequests /);
      // Every field of the text, with the same value in the request, its name generated from the prefix, and no other
      // field in its metadata but the ones the API server writes of every object; no phase, and the backup as it was.
      const sent = JSON.parse(text) as cluster.DeleteRequestRead;
      const every = cluster.deleteRequestsOf(cluster.E2E_VIEWS_NAMESPACE);
      const requests = cluster.deleteRequestsOf(cluster.E2E_VIEWS_NAMESPACE, backup.metadata.uid);

      // Each request of the backup is recorded: the one the label of its UID finds by the UID read here, as the
      // backups, the schedules and the restores are, and one that names it with another label by its name, when it was
      // created since the suite began.
      for (const request of every) {
        const labelled = requests.some((found) => found.metadata.uid === request.metadata.uid);

        if (labelled || (request.spec as { backupName?: string } | undefined)?.backupName === DELETED)
          createdRequests.push({
            namespace: cluster.E2E_VIEWS_NAMESPACE,
            name: request.metadata.name,
            ...(labelled ? { uid: request.metadata.uid } : {}),
          });
      }
      // The namespace held no request before the suite: it holds this one alone, the one the label of the UID of the
      // backup finds, so that a wrong label fails here, by its name.
      expect(every.map((request) => request.metadata.name)).toEqual(requests.map((request) => request.metadata.name));
      expect(requests.length).toBe(1);
      // The shape of the request on its own, as the cases of Create backup and of Restore pin theirs: a name generated
      // from the name of the backup, the namespace, the two labels of the backup and no other, no annotation, and the
      // name of the backup in the spec (REQ-279).
      expect(Object.keys(sent.metadata).sort()).toEqual(["generateName", "labels", "namespace"]);
      expect(sent.metadata.labels).toEqual({
        "velero.io/backup-name": DELETED,
        "velero.io/backup-uid": backup.metadata.uid,
      });
      expect([sent.metadata.generateName, sent.spec]).toEqual([`${DELETED}-`, { backupName: DELETED }]);
      const {
        name,
        uid: _uid,
        resourceVersion: _version,
        creationTimestamp: _created,
        generation: _generation,
        managedFields: _fields,
        ...metadata
      } = requests[0].metadata as unknown as Record<string, unknown>;

      expect(name).toMatch(new RegExp(`^${DELETED}-[a-z0-9]{5}$`));
      expect(metadata).toEqual(sent.metadata);
      expect(requests[0].spec).toEqual(sent.spec);
      expect(requests[0].status?.phase).toBeUndefined();
      expect(read<BackupRead>("backups.velero.io", DELETED, cluster.E2E_VIEWS_NAMESPACE).metadata.resourceVersion).toBe(
        backup.metadata.resourceVersion,
      );
      // The way to the backup takes the place of the workspace.
      await frame.click(deletion("open"));
      await frame.waitForSelector("[data-testid=velero-backup-delete-workspace]", {
        state: "detached",
        timeout: 30_000,
      });
      expect(await cluster.addressViews(frame)).toEqual([`backup/${DELETED}`]);
      // A new review of the backup says the request that is there now, which Velero deletes before it starts another,
      // and is left: nothing written.
      const again = cluster.apiRequests();

      await frame.click("[data-testid=velero-backup-delete]");
      await frame.waitForSelector(deletion("ask"), { timeout: 30_000 });
      await frame.click(deletion("ask"));
      await frame.waitForSelector(deletion("review"), { timeout: 30_000 });
      expect(await cluster.wordsOf(frame, `${deletion("meaning")} [data-part=others]`)).toBe(
        deleteMeaning(DELETED, { others: 1 }).find((meaning) => meaning.id === "others")?.words,
      );
      await frame.click(deletion("back"));
      await frame.waitForSelector(deletion("review"), { state: "detached", timeout: 30_000 });
      await cluster.closeWorkspace(frame);
      await frame.waitForTimeout(NOTHING);
      expect(everyWrite(again)).toEqual({});
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
        // The deletion of a backup, refused at the creation: the reader may read the backups, and may neither list nor
        // create a request to delete one, so that the review says that the other requests could not be read.
        const kept = read<BackupRead>("backups.velero.io", RESTORED, cluster.E2E_VIEWS_NAMESPACE);

        // Removed after the suite should the reader ever create one.
        askedDeletions.push({ namespace: cluster.E2E_VIEWS_NAMESPACE, backupUid: kept.metadata.uid });
        await cluster.showList(other);
        await cluster.openPage(other, cluster.BACKUPS);
        await cluster.waitForList(other, cluster.BACKUPS);
        await cluster.openWorkspace(other, RESTORED, cluster.BACKUPS);
        await other.click("[data-testid=velero-backup-delete]");
        await other.waitForSelector(deletion("ask"), { timeout: 30_000 });
        await other.click(deletion("ask"));
        await other.waitForSelector(deletion("review"), { timeout: 30_000 });
        expect(await cluster.wordsOf(other, `${deletion("meaning")} [data-part=others]`)).toBe(
          deleteMeaning(RESTORED, { others: "unread" }).find((meaning) => meaning.id === "others")?.words,
        );
        await other.locator(deletionField("typed")).first().fill(RESTORED);
        await other.click(deletion("run"));
        await other.waitForSelector(deletion("failure"), { timeout: 60_000 });
        expect([
          await other.locator(deletion("failure")).getAttribute("data-code"),
          await other.locator(deletion("failure")).getAttribute("data-stage"),
          await cluster.wordsOf(other, deletion("failure-text")),
        ]).toEqual(["forbidden", "creation", BACKUP_DELETE_WORDS.forbiddenCreate(cluster.E2E_VIEWS_NAMESPACE)]);
        // Nothing may have been created, and the deletion is offered again.
        expect([
          await other.locator(deletion("failure")).getAttribute("data-left"),
          await other.locator(deletion("failure-left")).count(),
          await other.locator(deletion("ask")).isDisabled(),
        ]).toEqual(["none", 0, false]);
        await other.waitForTimeout(NOTHING);
        expect(await cluster.writesState(other)).toBe("on");
        expect(cluster.deleteRequestsOf(cluster.E2E_VIEWS_NAMESPACE, kept.metadata.uid)).toEqual([]);
        expect(
          read<BackupRead>("backups.velero.io", RESTORED, cluster.E2E_VIEWS_NAMESPACE).metadata.resourceVersion,
        ).toBe(kept.metadata.resourceVersion);
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
    "leaves the objects of Velero as they were once its backups, its schedules, its restores and its requests to delete a backup are removed",
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
      for (const request of [...createdRequests]) {
        cluster.removeCreatedDeleteRequest(request.namespace, request.name, request.uid, began);
        createdRequests.splice(createdRequests.indexOf(request), 1);
      }
      for (const asked of [...askedDeletions]) {
        cluster.removeCreatedDeleteRequests(asked.namespace, asked.backupUid, began);
        askedDeletions.splice(askedDeletions.indexOf(asked), 1);
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
