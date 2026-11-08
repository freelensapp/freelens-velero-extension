/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

// The actions of SPEC-0017 in a packaged Freelens, on the CRDs of the release alone, where no controller runs
// (REQ-254, ACT-11): Back up now from the view of a schedule (T4.2), and Create backup from the list of the Backups
// (T4.3). With writes off the command writes nothing; a
// review that is not confirmed, nothing; a confirmed one, exactly one POST of a Backup, whose every field is the one of
// the text the review showed, and no other write. The backup stays without a phase, as the result says, and the view
// of the schedule lists it at its next read (NOW-05). A name already taken is a conflict (NOW-04). The reader of a part
// is refused at the creation. What the suite created it removes, and the objects of Velero are as they were. The
// workspace in both themes, at every size and with the keyboard alone, is in the pre-review (ACT-10).

import { readFile, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as cluster from "../../integration/helpers/velero-cluster";
import * as velero from "../../integration/helpers/velero-extension";
import { BACKUP_CREATE_VIEW_WORDS } from "../../src/common/backup-create-words";
import { backupFromForm, formBodyText } from "../../src/common/backup-form";
import { backupFromSchedule, bodyText } from "../../src/common/backup-from-schedule";
import { BACKUP_NOW_VIEW_WORDS } from "../../src/common/backup-now-words";
import { BACKUP_NOW_WORDS } from "../../src/main/backup-now";

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
// A choice of the form: the host gives the identifier to its input, and the class Select to the element around it,
// and its options carry the identifier with -options.
const choiceOf = (id: string) => `.Select:has(#velero-backup-create-${id})`;
const optionsOf = (id: string) => `.velero-backup-create-${id}-options .Select__option`;
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
  let kubeconfig = "";
  const errors = velero.createErrorCollector();
  let before: cluster.ClusterSnapshot;
  // What the suite created, to remove it: each backup by its name from the moment it is asked, and by its UID once
  // the suite read it. One whose creation the view did not say, created all the same, is removed by its name when it
  // was created since the suite began, a minute before it for the clocks.
  const created: { namespace: string; name: string; uid?: string }[] = [];
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
  const nameInField = () => frame.locator(FIELD).first().inputValue();
  // The writes of the kinds of Velero since a reading of the counters, whoever made them.
  const writesSince = (earlier: Record<string, number>) => cluster.writes(earlier, cluster.apiRequests());

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

    // Each backup the suite created is removed, whatever became of the others.
    for (const backup of created) {
      try {
        cluster.removeCreatedBackup(backup.namespace, backup.name, backup.uid, began);
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
      // The namespaces the host lists are offered.
      expect(await frame.locator(create("includedNamespaces-default")).count()).toBe(1);
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

      expect(metadata).toEqual(sent.metadata);
      expect(backup.spec).toEqual(sent.spec);
      expect(backup.status?.phase).toBeUndefined();
      // The way to the backup takes the place of the workspace: its way back is the list.
      await frame.click(create("open"));
      await frame.waitForSelector("[data-testid=velero-backup-workspace]", { timeout: 30_000 });
      await cluster.closeWorkspace(frame);
      await frame.waitForSelector(create("workspace"), { state: "detached", timeout: 30_000 });
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
    "refuses the reader of a part at the creation, with the words of what it may not do, writes left on and nothing written",
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
        await other.click(create("create"));
        await other.waitForSelector(create("failure"), { timeout: 60_000 });
        expect([
          await other.locator(create("failure")).getAttribute("data-code"),
          await other.locator(create("failure")).getAttribute("data-stage"),
          await cluster.wordsOf(other, create("failure-text")),
        ]).toEqual(["forbidden", "creation", BACKUP_NOW_WORDS.forbiddenCreate(cluster.E2E_VIEWS_NAMESPACE)]);
        expect(
          cluster.kubectlE2E("get", "backups.velero.io", formName, "--namespace", cluster.E2E_VIEWS_NAMESPACE).status,
        ).not.toBe(0);
        expect(writesSince(earlier)).toEqual({});
      } finally {
        // The cases after this one look at the first entry of the catalog, which is shown again.
        await velero.navigateToCatalog(running.app);
        frame = await cluster.openClusterFromCatalog(running.window, kubeconfig);
      }
    },
    TIMEOUT,
  );

  it(
    "leaves the objects of Velero as they were once its backup is removed",
    async () => {
      // Each one is let go once it was removed: one whose removal failed is tried again after the suite.
      for (const backup of [...created]) {
        cluster.removeCreatedBackup(backup.namespace, backup.name, backup.uid, began);
        created.splice(created.indexOf(backup), 1);
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
