import { spawnSync } from "node:child_process";
import { createHash, createHmac } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { describe, expect, it, vi } from "vitest";
import {
  ENTRY_KEYS,
  emptyArchive,
  gz,
  logFacts,
  SYNCED_AGE,
  SYNCED_WORK,
  syntheticLog,
  syntheticResourceList,
  syntheticResults,
  syntheticVolumeInfo,
  type tabArtifacts,
  tabExpectations,
} from "../e2e/scripts/local-artifacts.mts";
import {
  allowsFixtureArtifact,
  assertFixtureNamespaceContents,
  assertFixtureOperationsRemoved,
  assertStoreRequest,
  awaitRequestsBeforeCleanup,
  awaitRequestsRemoved,
  awaitTabFixtures,
  BACKUP_PHASES,
  CLEAR_STATES,
  clearTabFixtures,
  createViewFixtures,
  FIXTURE_LABEL,
  FIXTURE_MODE,
  fixtureArtifactPath,
  fixtureArtifactPaths,
  fixtureDeletionRequest,
  fixtureNames,
  fixtureNamespaces,
  isRefused,
  LIVE_RETENTION,
  LONG_BACKUP_NAME,
  LONG_BUCKET_NAME,
  LONG_LOCATION_NAME,
  LONG_PREFIX,
  LONG_RESTORE_NAME,
  liveBackup,
  liveRestore,
  NEWEST_OF_THE_HISTORY,
  NOT_COUNTED,
  NOT_STARTED,
  OVERVIEW_SCHEDULES,
  overviewFixtures,
  PLACED_ANNOTATION,
  PLACED_FOR,
  placeByTheClock,
  placementWords,
  placeRefusedFixtures,
  placeViewAndTabFixtures,
  proofIdentities,
  REFUSALS,
  RESTORE_PHASES,
  type Recorded,
  readerKubeconfig,
  realTabArtifactPaths,
  recordSyncedBackups,
  refusedFixtures,
  removeFixtureBackup,
  restoreSpec,
  restrictedFixtures,
  runArtifactPaths,
  SCALE_BACKUPS,
  SCALE_RESTORES,
  SHAPE_ANNOTATION,
  SYNCED_RETENTION,
  SYNCED_SELECTOR,
  SYNCED_SNAPSHOT_LOCATION,
  scaleFixtures,
  staticFixtures,
  storeTabFixtures,
  syncedBackups,
  syntheticStatus,
  TAB_STATES,
  type TabPlacement,
  tabArtifactPaths,
  tabFixtureFacts,
  tabRemovalWords,
  UNAVAILABLE_MESSAGE,
  unlikeTheTakenBackup,
  VIEW_READER,
  VIEW_READER_OF_RESTORES,
  viewFixtures,
} from "../e2e/scripts/local-fixtures.mts";
import {
  assertEgressRules,
  assertFailedNodeRemoval,
  assertLocalKind,
  assertOwnedNetwork,
  assertOwnedNode,
  assertOwnedResource,
  assertStoppedKind,
  DEMO_CLUSTER,
  DEMO_CONTEXT,
  DEMO_NETWORK,
  type DemoIdentity,
  DOCKER_HOST,
  egressChains,
  egressState,
  type KindConfig,
  type KindNetwork,
  type KindNode,
  localEnvironment,
  OWNER_LABEL,
  SUBNETS,
  subnetsOverlap,
} from "../e2e/scripts/local-kind.mts";
import {
  BUCKET,
  IMAGES,
  KIND_HOSTS,
  type KubeResource,
  kindConfiguration,
  preloadedImage,
  prepareVeleroResources,
  STORAGE_ENDPOINT,
  storageConfiguration,
  storageManifests,
} from "../e2e/scripts/local-manifests.mts";
import {
  assertBinary,
  assertIndexPlatforms,
  assertLogWithholds,
  BINARIES,
  binaryTarget,
  binaryUrl,
  childEnvironment,
  dockerSocket,
  engineIndex,
  failureSummary,
  imageArchitecture,
  imagePlatform,
  type NetworkShape,
  networkShape,
  nodeMemory,
  occupiedSubnets,
  platformManifest,
  verifiedPins,
  withhold,
} from "../e2e/scripts/local-platform.mts";
import { type RunJournal, type StoreReach, storeRequest, tabRecord } from "../e2e/scripts/local-runtime.mts";
import { assertOfficialImages, IMAGE_NAMES } from "../e2e/scripts/local-security.mts";
import {
  STORE_BODY_FILE,
  STORE_WAYS,
  type StoreBody,
  storeAuthorization,
  storeLogLine,
  storeSettings,
} from "../e2e/scripts/local-store.mts";
import { PINNED } from "./tab-pins";

const HOUR = 3_600_000;

describe("foundation fixture boundaries", () => {
  const run = "a1b2c3d4";

  it("covers every reviewed phase only in the synthetic namespace", () => {
    const resources = staticFixtures("synthetic-owner", run);

    expect(
      resources
        .filter((resource) => resource.kind === "Backup")
        .map((resource) => (resource.status as { phase: string }).phase),
    ).toEqual([...BACKUP_PHASES]);
    expect(
      resources
        .filter((resource) => resource.kind === "Restore")
        .map((resource) => (resource.status as { phase: string }).phase),
    ).toEqual([...RESTORE_PHASES]);
    expect(BACKUP_PHASES).toHaveLength(13);
    expect(RESTORE_PHASES).toHaveLength(10);
    expect(resources.every((resource) => resource.metadata.labels?.[FIXTURE_MODE] === "synthetic")).toBe(true);
    expect(
      resources
        .filter((resource) => resource.kind !== "Namespace")
        .every((resource) => resource.metadata.namespace === fixtureNames(run).static),
    ).toBe(true);
    expect(resources.find((resource) => resource.metadata.name === "backup-finalizing")?.status).toMatchObject({
      phase: "Finalizing",
      progress: { itemsBackedUp: 10, totalItems: 10 },
    });
    expect(resources.find((resource) => resource.metadata.name === "backup-new")?.status).not.toHaveProperty(
      "startTimestamp",
    );
  });

  it("gives an operation that did not start what the release writes into it, and nothing else", () => {
    const operations = staticFixtures("synthetic-owner", run).filter(
      (resource) => resource.kind === "Backup" || resource.kind === "Restore",
    );
    const status = (resource: (typeof operations)[number]) => resource.status as Record<string, unknown>;

    expect([...NOT_STARTED].sort()).toEqual(["FailedValidation", "New", "Queued", "ReadyToStart"]);
    for (const operation of operations) {
      const began = !NOT_STARTED.has(status(operation).phase as string);

      for (const field of ["startTimestamp", "progress"]) {
        expect([operation.metadata.name, field, field in status(operation)]).toEqual([
          operation.metadata.name,
          field,
          began,
        ]);
      }
      if (!began) {
        expect(Object.keys(status(operation)).sort()).toEqual(
          status(operation).phase === "FailedValidation" ? ["phase", "validationErrors"] : ["phase"],
        );
      }
    }
    // The release writes the validation errors of an operation that failed its validation, and no time:
    // it never started, and it did not end.
    for (const name of ["backup-failedvalidation", "restore-failedvalidation"]) {
      expect(status(operations.find((resource) => resource.metadata.name === name) as never)).toEqual({
        phase: "FailedValidation",
        validationErrors: ["Synthetic validation error; no operation was executed"],
      });
    }
    expect(
      operations
        .filter((operation) => "completionTimestamp" in status(operation))
        .map((operation) => status(operation).phase)
        .sort(),
    ).toEqual(["Completed", "Completed", "Deleting", "Failed", "Failed", "PartiallyFailed", "PartiallyFailed"]);
  });

  // The release writes no counter of zero, it counts when the work ends, and it leaves the work with
  // every item done: an object with a counter of zero, or with items to do after the work, is one that no
  // installation shows.
  it("gives an operation that began the counters and the items the release writes, and no zero", () => {
    const every = [
      ...staticFixtures("synthetic-owner", run),
      ...viewFixtures("synthetic-owner", run),
      ...scaleFixtures("synthetic-owner", run).backups,
      ...scaleFixtures("synthetic-owner", run).restores,
    ].filter((resource) => resource.kind === "Backup" || resource.kind === "Restore");
    const zeros = (value: unknown): string[] =>
      value && typeof value === "object"
        ? Object.entries(value).flatMap(([key, inner]) =>
            inner === 0 ? [key] : zeros(inner).map((name) => `${key}.${name}`),
          )
        : [];

    expect(every.length).toBeGreaterThan(2000);
    expect([...NOT_COUNTED].sort()).toEqual(["Failed", "InProgress"]);
    for (const operation of every) {
      const status = (operation.status ?? {}) as {
        phase?: string;
        progress?: { totalItems?: number; itemsBackedUp?: number; itemsRestored?: number };
        errors?: number;
        warnings?: number;
        failureReason?: string;
      };
      const name = `${operation.kind} ${operation.metadata.name}`;
      const phase = status.phase ?? "";
      const done = operation.kind === "Backup" ? status.progress?.itemsBackedUp : status.progress?.itemsRestored;

      expect([name, zeros(operation.status)]).toEqual([name, []]);
      if (!phase || NOT_STARTED.has(phase)) continue;
      if (NOT_COUNTED.has(phase)) {
        expect([name, "errors" in status, "warnings" in status]).toEqual([name, false, false]);
        expect([name, (done ?? 0) < (status.progress?.totalItems ?? 0)]).toEqual([name, true]);
      } else {
        expect([name, done]).toEqual([name, status.progress?.totalItems]);
        expect([name, status.errors]).toEqual([name, phase.includes("PartiallyFailed") ? 1 : undefined]);
      }
      expect([name, typeof status.failureReason]).toEqual([name, phase === "Failed" ? "string" : "undefined"]);
    }
    // As the restore the controller of the environment ran is left: no counter, and the status of the
    // hooks with nothing in it.
    expect(syntheticStatus("Completed", "itemsRestored")).toEqual({
      phase: "Completed",
      startTimestamp: "2026-09-01T10:00:00Z",
      completionTimestamp: "2026-09-01T10:01:00Z",
      progress: { totalItems: 10, itemsRestored: 10 },
      hookStatus: {},
    });
    // The hooks of a backup are counted at the end of its work, the ones of a restore when it is finalized.
    const hooked = (kind: "itemsBackedUp" | "itemsRestored") =>
      [...BACKUP_PHASES].filter((phase) => "hookStatus" in syntheticStatus(phase, kind)).sort();

    expect(hooked("itemsRestored")).toEqual(["Completed", "PartiallyFailed"]);
    expect(hooked("itemsBackedUp")).toEqual([
      "Completed",
      "Deleting",
      "Finalizing",
      "FinalizingPartiallyFailed",
      "PartiallyFailed",
      "WaitingForPluginOperations",
      "WaitingForPluginOperationsPartiallyFailed",
    ]);
    // An operation waits for its plugins when one of their operations did not end.
    expect(syntheticStatus("WaitingForPluginOperations", "itemsBackedUp").backupItemOperationsAttempted).toBe(1);
    expect(syntheticStatus("WaitingForPluginOperations", "itemsRestored").restoreItemOperationsAttempted).toBe(1);
    expect(syntheticStatus("Finalizing", "itemsRestored")).not.toHaveProperty("restoreItemOperationsAttempted");
  });

  it("gives a restore the release took what the release writes into it, and leaves one it did not take", () => {
    const restores = [
      ...staticFixtures("synthetic-owner", run),
      ...viewFixtures("synthetic-owner", run),
      ...scaleFixtures("synthetic-owner", run).restores,
    ].filter((resource) => resource.kind === "Restore");

    for (const restore of restores) {
      const spec = restore.spec as { excludedResources?: string[]; itemOperationTimeout?: string };
      const taken = (restore.status as { phase: string }).phase !== "New";
      const name = restore.metadata.name;

      expect([name, "itemOperationTimeout" in spec]).toEqual([name, taken]);
      expect([name, spec.excludedResources?.includes("restores.velero.io") ?? false]).toEqual([name, taken]);
      expect([name, new Set(spec.excludedResources).size]).toEqual([name, spec.excludedResources?.length ?? 0]);
    }
    // What was excluded when the restore was submitted stays first, and the release adds its own after it.
    expect(restoreSpec("InProgress", { excludedResources: ["secrets", "nodes"] }).excludedResources).toEqual([
      "secrets",
      "nodes",
      "events",
      "events.events.k8s.io",
      "backups.velero.io",
      "restores.velero.io",
      "resticrepositories.velero.io",
      "csinodes.storage.k8s.io",
      "volumeattachments.storage.k8s.io",
      "backuprepositories.velero.io",
    ]);
    expect(restoreSpec("New", { backupName: "one" }, "daily")).toEqual({ backupName: "one" });
    // The schedule of the backup is written once the backup was found and can be used: the synthetic
    // restores that failed their validation are of the ones that were refused before.
    expect(restoreSpec("FailedValidation", { backupName: "one" }, "daily")).not.toHaveProperty("scheduleName");
    expect(restoreSpec("Completed", { backupName: "one" }, "daily")).toMatchObject({ scheduleName: "daily" });
  });

  it("has a restore with names as long as they can be, of a backup that is there", () => {
    const views = viewFixtures("synthetic-owner", run);
    const long = views.find((resource) => resource.metadata.name === LONG_RESTORE_NAME);
    const spec = long?.spec as { backupName: string; namespaceMapping: Record<string, string> };

    expect(LONG_RESTORE_NAME).toHaveLength(63);
    expect(LONG_BACKUP_NAME).toHaveLength(63);
    expect(long?.kind).toBe("Restore");
    expect(spec.backupName).toBe(LONG_BACKUP_NAME);
    expect(views.some((resource) => resource.kind === "Backup" && resource.metadata.name === LONG_BACKUP_NAME)).toBe(
      true,
    );
    for (const [from, into] of Object.entries(spec.namespaceMapping)) {
      expect(from).toHaveLength(63);
      expect(into).toHaveLength(63);
      expect(from).toMatch(/^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/);
      expect(into).toMatch(/^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/);
    }
  });

  it("keeps live operations narrowly scoped and separate from forced status", () => {
    const names = fixtureNames(run);
    const backup = liveBackup("synthetic-owner", run);
    const restore = liveRestore("synthetic-owner", run);

    expect(backup).not.toHaveProperty("status");
    expect(restore).not.toHaveProperty("status");
    expect(backup.spec).toMatchObject({
      includedNamespaces: [names.source],
      includedResources: ["configmaps"],
      includeClusterResources: false,
      storageLocation: "default",
    });
    // The release deletes a backup that expired, and its restores with it: the one the views are looked
    // at with lasts for the days an environment is kept, not for the hour it takes to bring it up.
    expect((backup.spec as { ttl: string }).ttl).toBe(LIVE_RETENTION);
    expect(Number.parseInt(LIVE_RETENTION, 10)).toBeGreaterThanOrEqual(24 * 14);
    expect(restore.spec).toMatchObject({
      backupName: names.backup,
      namespaceMapping: { [names.source]: names.restored },
      existingResourcePolicy: "none",
    });
    expect(() => fixtureNames("personal-namespace")).toThrow();
    expect(() => staticFixtures("", run)).toThrow();
  });

  it("allows fixture logs/results but never an archive download or another run", () => {
    const paths = fixtureArtifactPaths(run);

    expect(paths.restoreLog).toBe(
      `/velero-demo/restores/fixture-restore-${run}/restore-fixture-restore-${run}-logs.gz`,
    );
    expect(allowsFixtureArtifact("GET", paths.backupLog, run)).toBe(true);
    expect(allowsFixtureArtifact("HEAD", paths.archive, run)).toBe(true);
    expect(allowsFixtureArtifact("GET", paths.archive, run)).toBe(false);
    expect(allowsFixtureArtifact("GET", paths.backupLog, "b1b2b3b4")).toBe(false);
    expect(allowsFixtureArtifact("DELETE", paths.backupLog, run)).toBe(false);
  });

  it("names the two backups the store is given for the tabs, each with a folder of its own", () => {
    const names = fixtureNames(run);

    expect([names.syncedBackup, names.syncedBackupWithoutLog]).toEqual([
      `fixture-synced-backup-${run}`,
      `fixture-synced-backup-no-log-${run}`,
    ]);
    // The release removes a backup from the store by the keys of its folder: no backup of a run has a name
    // that another one begins with, whatever the run.
    for (const id of [run, "00000000", "ffffffff", "0a1b2c3d"]) {
      const of = fixtureNames(id);
      const backups = [of.backup, of.invalidBackup, of.syncedBackup, of.syncedBackupWithoutLog];

      for (const one of backups)
        for (const other of backups.filter((name) => name !== one))
          expect([one, other, other.startsWith(one)]).toEqual([one, other, false]);
    }
    // The request that deletes one carries its name in a label, and is named after it.
    for (const name of [names.syncedBackup, names.syncedBackupWithoutLog]) {
      expect(`${name}-delete`.length).toBeLessThanOrEqual(63);
      expect(name).toMatch(/^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/);
    }
    // They are backups of the installation: no namespace is added for them.
    expect(fixtureNamespaces(run)).toEqual([
      names.source,
      names.restored,
      names.static,
      names.views,
      names.defaults,
      names.overview,
      names.scale,
    ]);
  });

  it("names the keys of the tabs as the release lays the store out, the second backup without its log", () => {
    const names = fixtureNames(run);
    const paths = tabArtifactPaths(run);
    const first = `/velero-demo/backups/fixture-synced-backup-${run}`;
    const second = `/velero-demo/backups/fixture-synced-backup-no-log-${run}`;

    // In the order they are stored in: the contents first, and the metadata last.
    expect(Object.entries(paths.synced)).toEqual([
      ["archive", `${first}/fixture-synced-backup-${run}.tar.gz`],
      ["log", `${first}/fixture-synced-backup-${run}-logs.gz`],
      ["results", `${first}/fixture-synced-backup-${run}-results.gz`],
      ["resourceList", `${first}/fixture-synced-backup-${run}-resource-list.json.gz`],
      ["volumeInfo", `${first}/fixture-synced-backup-${run}-volumeinfo.json.gz`],
      ["metadata", `${first}/velero-backup.json`],
    ]);
    expect(Object.entries(paths.withoutLog)).toEqual([
      ["archive", `${second}/fixture-synced-backup-no-log-${run}.tar.gz`],
      ["results", `${second}/fixture-synced-backup-no-log-${run}-results.gz`],
      ["resourceList", `${second}/fixture-synced-backup-no-log-${run}-resource-list.json.gz`],
      ["volumeInfo", `${second}/fixture-synced-backup-no-log-${run}-volumeinfo.json.gz`],
      ["metadata", `${second}/velero-backup.json`],
    ]);
    // The same layout the real backup is verified by.
    const real = fixtureArtifactPaths(run);
    const asReal = (path: string) => path.replaceAll(names.syncedBackup, names.backup);

    expect([asReal(paths.synced.archive), asReal(paths.synced.log), asReal(paths.synced.results)]).toEqual([
      real.archive,
      real.backupLog,
      real.backupResults,
    ]);
    // Nothing the sync would create objects from, and nothing the deletion would call a plugin for.
    expect(Object.values({ ...paths.synced, ...paths.withoutLog }).join(" ")).not.toMatch(
      /podvolumebackups|volumesnapshots|itemoperations|csi-/,
    );
    expect(() => tabArtifactPaths("personal-namespace")).toThrow();
  });

  it("names the keys of the real operations the tabs read beside their logs and their results", () => {
    expect(realTabArtifactPaths(run)).toEqual({
      backupResourceList: `/velero-demo/backups/fixture-backup-${run}/fixture-backup-${run}-resource-list.json.gz`,
      backupVolumeInfo: `/velero-demo/backups/fixture-backup-${run}/fixture-backup-${run}-volumeinfo.json.gz`,
      restoreResourceList: `/velero-demo/restores/fixture-restore-${run}/restore-fixture-restore-${run}-resource-list.json.gz`,
      // The release writes this one without the prefix of the other files of a restore.
      restoreVolumeInfo: `/velero-demo/restores/fixture-restore-${run}/fixture-restore-${run}-volumeinfo.json.gz`,
    });
    // The artifacts the real operations are verified by stay the five they were.
    expect(Object.keys(fixtureArtifactPaths(run))).toEqual([
      "archive",
      "backupLog",
      "backupResults",
      "restoreLog",
      "restoreResults",
    ]);
    expect(() => realTabArtifactPaths("personal-namespace")).toThrow();
  });

  it("lets the client of the store write the keys of the tabs and read the ones of the real operations, and nothing else", () => {
    const names = fixtureNames(run);
    const verified = fixtureArtifactPaths(run);
    const tabs = tabArtifactPaths(run);
    const stored = [...Object.values(tabs.synced), ...Object.values(tabs.withoutLog)];
    const read = Object.values(realTabArtifactPaths(run));
    const methods = ["GET", "HEAD", "PUT", "DELETE", "POST", "PATCH", "put", "head", ""];
    const allowed = (path: string) => methods.filter((method) => allowsFixtureArtifact(method, path, run));
    const folder = `/velero-demo/backups/${names.syncedBackup}`;

    expect(stored).toHaveLength(11);
    expect(new Set([...Object.values(verified), ...stored, ...read]).size).toBe(20);
    // The twenty are the keys of the run, which a cleanup asks the store for one by one: the client may
    // ask whether each is there, and may ask it of no other key.
    expect(runArtifactPaths(run)).toEqual([...Object.values(verified), ...read, ...stored]);
    expect(() => runArtifactPaths("personal-namespace")).toThrow();
    // What the store is given is written and asked for, never read back and never deleted.
    for (const path of stored) expect([path, allowed(path)]).toEqual([path, ["HEAD", "PUT"]]);
    // What the real operations wrote is read, and never written.
    for (const path of read) expect([path, allowed(path)]).toEqual([path, ["GET", "HEAD"]]);
    // What was allowed before is allowed as it was: the contents of the real backup are never read.
    for (const path of Object.values(verified))
      expect([path, allowed(path)]).toEqual([path, path === verified.archive ? ["HEAD"] : ["GET", "HEAD"]]);
    for (const path of [
      // The log the second backup does not have, and the files of a backup the release would act on.
      `/velero-demo/backups/${names.syncedBackupWithoutLog}/${names.syncedBackupWithoutLog}-logs.gz`,
      `${folder}/${names.syncedBackup}-podvolumebackups.json.gz`,
      `${folder}/${names.syncedBackup}-volumesnapshots.json.gz`,
      `${folder}/${names.syncedBackup}-itemoperations.json.gz`,
      `${folder}/${names.syncedBackup}-csi-volumesnapshots.json.gz`,
      // Another file of a folder the store is given, the folder itself, and what is under a key.
      `${folder}/another-file`,
      `${folder}/`,
      folder,
      `${tabs.synced.metadata}/`,
      `${tabs.synced.metadata}?versionId=1`,
      tabs.synced.metadata.replace("/backups/", "/backups/../backups/"),
      tabs.synced.metadata.slice(1),
      // The metadata of the backups the controller wrote or refused.
      `/velero-demo/backups/${names.backup}/velero-backup.json`,
      `/velero-demo/backups/${names.invalidBackup}/velero-backup.json`,
      // A key of another run.
      ...Object.values(tabArtifactPaths("b1b2b3b4").synced),
      ...Object.values(tabArtifactPaths("b1b2b3b4").withoutLog),
      ...Object.values(realTabArtifactPaths("b1b2b3b4")),
      // A key under the restores, another folder of the bucket, its root, and another bucket.
      `/velero-demo/restores/${names.syncedBackup}/restore-${names.syncedBackup}-logs.gz`,
      `/velero-demo/restores/${names.restore}/velero-backup.json`,
      `/velero-demo/plugins/${names.syncedBackup}/velero-backup.json`,
      `/velero-demo/${names.syncedBackup}/velero-backup.json`,
      `/velero-demo/${names.syncedBackup}`,
      "/velero-demo",
      `/velero-denied/backups/${names.syncedBackup}/velero-backup.json`,
    ])
      expect([path, allowed(path)]).toEqual([path, []]);
  });

  it("sends the store a body with a key of the tabs and with nothing else, never such a key without one, and no verb that removes", () => {
    const names = fixtureNames(run);
    const verified = fixtureArtifactPaths(run);
    const tabs = tabArtifactPaths(run);
    const stored = [...Object.values(tabs.synced), ...Object.values(tabs.withoutLog)];
    const body: StoreBody = { bytes: emptyArchive(), way: "upload" };
    const storing = { run, placement: "storing" };
    // What a request is refused with, or nothing when it is sent.
    const refused = (request: Parameters<typeof assertStoreRequest>[0]) => {
      try {
        assertStoreRequest(request);
        return "";
      } catch (error) {
        return (error as Error).message;
      }
    };
    const target = "Unexpected local bucket target";

    // Each of the eleven keys is written with its body, in each of the ways a body is sent, while the
    // placement of the tabs is recorded as storing.
    expect(STORE_WAYS).toEqual(["upload", "data", "signed"]);
    for (const path of stored)
      for (const way of STORE_WAYS)
        expect([path, way, refused({ method: "PUT", path, body: { ...body, way }, ...storing })]).toEqual([
          path,
          way,
          "",
        ]);
    // Never without a body, and never with one of no bytes: a key written so is a file the deletion of a
    // backup cannot read.
    for (const path of stored) {
      expect([path, refused({ method: "PUT", path, ...storing })]).toEqual([
        path,
        "A key of the tabs is not written without its body",
      ]);
      expect([path, refused({ method: "PUT", path, body: { ...body, bytes: new Uint8Array() }, ...storing })]).toEqual([
        path,
        "A key of the tabs is not written without its body",
      ]);
    }
    // A body goes with nothing else the client may ask: not with the question whether a key is there, not
    // with a read, not with the creation of the bucket.
    for (const [method, path] of [
      ["HEAD", stored[0]],
      ["HEAD", verified.archive],
      ["GET", verified.backupLog],
      ["GET", realTabArtifactPaths(run).backupResourceList],
      ["GET", "/velero-demo"],
      ["PUT", "/velero-demo"],
      ["GET", "/velero-denied"],
    ])
      expect([method, path, refused({ method, path, body, ...storing })]).toEqual([
        method,
        path,
        "Only a key of the tabs is sent with a body",
      ]);
    // What may not be written is not written with a body either: what the server wrote, a key of another
    // run, another file of a folder the store is given, and a bucket.
    for (const path of [
      verified.archive,
      verified.backupLog,
      realTabArtifactPaths(run).backupVolumeInfo,
      `/velero-demo/backups/${names.backup}/velero-backup.json`,
      tabArtifactPaths("b1b2b3b4").synced.metadata,
      `/velero-demo/backups/${names.syncedBackup}/${names.syncedBackup}-podvolumebackups.json.gz`,
      `/velero-demo/backups/${names.syncedBackupWithoutLog}/${names.syncedBackupWithoutLog}-logs.gz`,
      "/velero-denied",
      "/another-bucket",
    ])
      expect([path, refused({ method: "PUT", path, body, ...storing })]).toEqual([path, target]);
    // A way the client does not know, and a moment that is not the one of a placement that is recorded.
    expect(refused({ method: "PUT", path: stored[0], body: { ...body, way: "chunked" } as never, ...storing })).toBe(
      "A body is sent in a way the client of the store knows",
    );
    const moment = "A key of the tabs is written while the placement of the tabs is recorded as storing";

    for (const placement of [undefined, "", "stored", "synced", "cleared"])
      expect([placement, refused({ method: "PUT", path: stored[0], body, run, placement })]).toEqual([
        placement,
        moment,
      ]);
    // Once the removal of the tabs is recorded, the contents of a backup are written when they are recorded
    // to be put back, and only then: not while nothing is recorded of them, and not when the ones of the
    // other backup are.
    const clearing = { run, placement: "clearing" };
    const archives = [tabs.synced.archive, tabs.withoutLog.archive];
    const removal =
      "While the fixtures of the tabs are removed nothing is written but the contents of a backup that are recorded to be put back";

    expect(CLEAR_STATES).toEqual(["clearing", "cleared"]);
    for (const [archive, other] of [archives, [...archives].reverse()]) {
      expect(refused({ method: "PUT", path: archive, body, ...clearing, repaired: [archive] })).toBe("");
      expect(refused({ method: "PUT", path: archive, body, ...clearing, repaired: archives })).toBe("");
      for (const repaired of [undefined, [], [other]])
        expect([archive, repaired, refused({ method: "PUT", path: archive, body, ...clearing, repaired })]).toEqual([
          archive,
          repaired,
          removal,
        ]);
      // They are put back with their bytes, as every key of the tabs is written.
      expect(refused({ method: "PUT", path: archive, ...clearing, repaired: [archive] })).toBe(
        "A key of the tabs is not written without its body",
      );
      // And while the removal goes on, not once it ended, nor before it began.
      for (const placement of [undefined, "stored", "synced", "cleared"])
        expect([
          placement,
          refused({ method: "PUT", path: archive, body, run, placement, repaired: [archive] }),
        ]).toEqual([placement, moment]);
    }
    // No other file of a folder is written while the removal goes on, were it recorded as the contents are.
    for (const path of stored.filter((key) => !archives.includes(key)))
      for (const repaired of [undefined, [path], archives, [path, ...archives]])
        expect([path, repaired, refused({ method: "PUT", path, body, ...clearing, repaired })]).toEqual([
          path,
          repaired,
          removal,
        ]);
    // Without a fixture run no key is asked for: the bucket alone.
    expect(refused({ method: "PUT", path: stored[0], body, placement: "storing" })).toBe(target);
    expect(refused({ method: "HEAD", path: verified.archive })).toBe(target);
    // What was asked before the tabs is asked as it was: the bucket of the environment, which is created
    // once, and the one the identity is denied, which is read to be denied and never written.
    for (const method of ["GET", "HEAD", "PUT"]) {
      expect([method, refused({ method, path: "/velero-demo" })]).toEqual([method, ""]);
      expect([method, refused({ method, path: "/velero-demo", ...storing })]).toEqual([method, ""]);
    }
    expect(refused({ method: "GET", path: "/velero-denied" })).toBe("");
    for (const method of ["HEAD", "PUT"])
      expect([method, refused({ method, path: "/velero-denied" })]).toEqual([method, target]);
    // Nothing is deleted, and no other verb is sent: not for a key, and not for a bucket.
    for (const method of ["DELETE", "POST", "PATCH", "delete", "put", ""])
      for (const path of ["/velero-demo", "/velero-denied", stored[0], verified.backupLog, verified.archive])
        expect([method, path, refused({ method, path, ...storing })]).toEqual([method, path, target]);
  });

  // The real backup of the run as the cluster holds it once the server completed it: what was submitted,
  // with what the reviewed release writes into a backup it takes, and what the cluster gives an object.
  function takenBackup() {
    const submitted = liveBackup("synthetic-owner", run);

    return {
      ...submitted,
      metadata: {
        ...submitted.metadata,
        uid: "synthetic-backup-uid",
        resourceVersion: "4321",
        generation: 6,
        creationTimestamp: "2026-10-05T09:58:41Z",
        labels: { ...submitted.metadata.labels, "velero.io/storage-location": "default" },
        annotations: {
          "fixtures.synthetic.example/note": "not written by the release",
          "velero.io/resource-timeout": "10m0s",
          "velero.io/source-cluster-k8s-gitversion": "v1.34.11",
          "velero.io/source-cluster-k8s-major-version": "1",
          "velero.io/source-cluster-k8s-minor-version": "34",
        },
      },
      spec: {
        ...(submitted.spec as Record<string, unknown>),
        csiSnapshotTimeout: "10m0s",
        itemOperationTimeout: "4h0m0s",
        snapshotMoveData: false,
        volumeGroupSnapshotLabelKey: "velero.io/volume-group",
        // It names a resource filter of the first kind: what the release never collects is added here.
        excludedResources: [
          "volumesnapshots.snapshot.storage.k8s.io",
          "volumesnapshotcontents.snapshot.storage.k8s.io",
        ],
      },
      status: {
        version: 1,
        formatVersion: "1.1.0",
        expiration: "2026-11-04T09:58:43Z",
        phase: "Completed",
        startTimestamp: "2026-10-05T09:58:43Z",
        completionTimestamp: "2026-10-05T09:58:47Z",
        progress: { totalItems: 13, itemsBackedUp: 13 },
        hookStatus: {} as Record<string, number>,
      },
    };
  }

  // The artifacts of the two backups as the generators make them, with a log of a thousand lines, or of as
  // many as it is asked, in the place of the one the store is given.
  function briefArtifacts(started: number, lines = 1000): ReturnType<typeof tabArtifacts> {
    const options = { backup: fixtureNames(run).syncedBackup, namespace: "velero-demo", started };

    return {
      ...options,
      log: syntheticLog({ ...options, lines }),
      results: syntheticResults(),
      resourceList: syntheticResourceList(),
      volumeInfo: syntheticVolumeInfo(started),
      empty: {
        results: syntheticResults("empty"),
        resourceList: syntheticResourceList("empty"),
        volumeInfo: syntheticVolumeInfo(started, "empty"),
      },
    };
  }

  // What the suites are told of the artifacts of the two backups, made with a log of a thousand lines: the
  // metadata takes nothing of the log but its digest.
  function heldExpectations(started: number) {
    return tabExpectations(briefArtifacts(started));
  }

  // The fixtures are started at a moment that is not a whole second: a time of the release is.
  const SYNCED_STARTED = Date.parse("2026-10-05T10:00:00.789Z");

  it("makes the two backups the store is given with the names of their folders, the labels of the run and nothing the cluster gives", () => {
    const names = fixtureNames(run);
    const like = takenBackup();
    const made = syncedBackups("synthetic-owner", run, SYNCED_STARTED, like, heldExpectations(SYNCED_STARTED));

    expect(Object.keys(made)).toEqual(["synced", "withoutLog"]);
    for (const [backup, name] of [
      [made.synced, names.syncedBackup],
      [made.withoutLog, names.syncedBackupWithoutLog],
    ] as const) {
      // The metadata is decoded by its version and its kind.
      expect(Object.keys(backup)).toEqual(["apiVersion", "kind", "metadata", "spec", "status"]);
      expect([backup.apiVersion, backup.kind]).toEqual(["velero.io/v1", "Backup"]);
      // The sync keeps the labels and the annotations it reads: the run is known by them, and the mode is
      // the one of a backup no controller of this installation ran. Of the real backup they carry what the
      // release wrote into its annotations, and nothing else: not its labels, and not what another wrote.
      expect(backup.metadata).toEqual({
        name,
        namespace: "velero-demo",
        labels: { [OWNER_LABEL]: "synthetic-owner", [FIXTURE_LABEL]: run, [FIXTURE_MODE]: "synced" },
        annotations: {
          "velero.io/resource-timeout": "10m0s",
          "velero.io/source-cluster-k8s-gitversion": "v1.34.11",
          "velero.io/source-cluster-k8s-major-version": "1",
          "velero.io/source-cluster-k8s-minor-version": "34",
          [SHAPE_ANNOTATION]: expect.stringMatching(/^[a-f0-9]{16}$/),
        },
      });
      // Nothing the cluster gives an object is in what the store is given, at any depth, and no schedule:
      // a restore asked from a schedule takes the newest completed backup that carries its name.
      for (const absent of ["uid", "resourceVersion", "generation", "creationTimestamp", "ownerReferences"])
        expect([absent, JSON.stringify(backup).includes(`"${absent}"`)]).toEqual([absent, false]);
      expect(backup.metadata.labels).not.toHaveProperty(["velero.io/schedule-name"]);
    }
    // The real backup is read and left as it was, and nothing of it is shared: a change of one of the two
    // changes neither the other nor the real one.
    expect(like).toEqual(takenBackup());
    (made.synced.status as { hookStatus: Record<string, number> }).hookStatus.hooksAttempted = 1;
    expect(like.status.hookStatus).toEqual({});
    expect((made.withoutLog.status as { hookStatus: object }).hookStatus).toEqual({});
    // A real backup with no annotation gives the two the one of the shape alone.
    const bare = takenBackup();

    expect(
      Object.keys(
        syncedBackups(
          "synthetic-owner",
          run,
          SYNCED_STARTED,
          { ...bare, metadata: { ...bare.metadata, annotations: undefined } },
          heldExpectations(SYNCED_STARTED),
        ).synced.metadata.annotations ?? {},
      ),
    ).toEqual([SHAPE_ANNOTATION]);
  });

  it("gives them the spec of a backup of everything, with what the server filled in the real backup of the run", () => {
    const like = takenBackup();
    const held = heldExpectations(SYNCED_STARTED);
    const { synced, withoutLog } = syncedBackups("synthetic-owner", run, SYNCED_STARTED, like, held);
    const everything = {
      // As the real backup has them, submitted or filled by the server.
      storageLocation: "default",
      defaultVolumesToFsBackup: false,
      csiSnapshotTimeout: "10m0s",
      itemOperationTimeout: "4h0m0s",
      snapshotMoveData: false,
      volumeGroupSnapshotLabelKey: "velero.io/volume-group",
      // As the release writes them into a backup that names no namespace and no resource filter.
      includedNamespaces: ["*"],
      excludedClusterScopedResources: ["volumesnapshotcontents.snapshot.storage.k8s.io"],
      excludedNamespaceScopedResources: ["volumesnapshots.snapshot.storage.k8s.io"],
      ttl: "87600h0m0s",
      // Both were taken where snapshots are taken: an installation with one snapshot location writes its
      // name into every backup it takes, whatever the backup holds. It is not a location of the
      // installation that finds the two in its store.
      volumeSnapshotLocations: ["synthetic-snapshot-location"],
    };
    const nothing = { matchLabels: { "fixtures.synthetic.example/selected": "nothing" } };

    expect(synced.spec).toEqual(everything);
    // The second holds no item, which a backup of every namespace never does: it holds the namespaces at
    // least. The backup of no item the release writes selects by a label, which nothing carried.
    expect(withoutLog.spec).toEqual({ ...everything, labelSelector: nothing });
    expect([SYNCED_RETENTION, SYNCED_SNAPSHOT_LOCATION, SYNCED_SELECTOR]).toEqual([
      "87600h0m0s",
      "synthetic-snapshot-location",
      nothing,
    ]);
    // None of the keys by which the real backup narrows itself, nor the one the release wrote for them: the
    // selector of the second is its own.
    for (const key of [
      "includedResources",
      "excludedResources",
      "labelSelector",
      "includeClusterResources",
      "snapshotVolumes",
    ]) {
      expect(like.spec).toHaveProperty(key);
      expect([key, key in (synced.spec as object), key in (withoutLog.spec as object)]).toEqual([
        key,
        false,
        key === "labelSelector",
      ]);
    }
    expect(like.spec).toMatchObject({
      includedNamespaces: [fixtureNames(run).source],
      labelSelector: { matchLabels: { [FIXTURE_LABEL]: run } },
    });
    // Nor the keys of a real backup that narrows itself by the other filters the release has, with the
    // namespaces the server writes into a backup for the label that excludes them.
    const {
      includedResources: _resources,
      excludedResources: _excluded,
      includeClusterResources: _cluster,
      labelSelector: _selector,
      ...filled
    } = takenBackup().spec as Record<string, unknown>;
    const scoped = {
      ...takenBackup(),
      spec: {
        ...filled,
        excludedNamespaces: ["synthetic-excluded"],
        orLabelSelectors: [{ matchLabels: { [FIXTURE_LABEL]: run } }],
        includedNamespaceScopedResources: ["configmaps"],
        includedClusterScopedResources: ["persistentvolumes"],
        excludedNamespaceScopedResources: ["secrets", "volumesnapshots.snapshot.storage.k8s.io"],
        excludedClusterScopedResources: ["nodes", "volumesnapshotcontents.snapshot.storage.k8s.io"],
      },
    };
    const ofScoped = syncedBackups("synthetic-owner", run, SYNCED_STARTED, scoped, held);

    expect(ofScoped.synced.spec).toEqual(everything);
    expect(ofScoped.withoutLog.spec).toEqual({ ...everything, labelSelector: nothing });
    // What the server fills is taken from the real backup as it is there, a key this file does not name
    // among it, and a key the real backup does not have is not made up.
    const other = takenBackup();
    const { volumeGroupSnapshotLabelKey: _unset, ...otherSpec } = other.spec;

    expect(
      syncedBackups(
        "synthetic-owner",
        run,
        SYNCED_STARTED,
        { ...other, spec: { ...otherSpec, itemOperationTimeout: "1h0m0s", datamover: "synthetic-mover" } },
        held,
      ).withoutLog.spec,
    ).toEqual({
      storageLocation: "default",
      defaultVolumesToFsBackup: false,
      csiSnapshotTimeout: "10m0s",
      itemOperationTimeout: "1h0m0s",
      snapshotMoveData: false,
      datamover: "synthetic-mover",
      includedNamespaces: ["*"],
      excludedClusterScopedResources: ["volumesnapshotcontents.snapshot.storage.k8s.io"],
      excludedNamespaceScopedResources: ["volumesnapshots.snapshot.storage.k8s.io"],
      ttl: "87600h0m0s",
      volumeSnapshotLocations: ["synthetic-snapshot-location"],
      labelSelector: nothing,
    });
  });

  it("gives the first the status of a backup that failed in part, counted as its artifacts are, and the second the one of a backup of nothing", () => {
    const { synced, withoutLog } = syncedBackups(
      "synthetic-owner",
      run,
      SYNCED_STARTED,
      takenBackup(),
      heldExpectations(SYNCED_STARTED),
    );
    const ended = {
      // The version of the format and the status of the hooks, as the server wrote them into the real one.
      version: 1,
      formatVersion: "1.1.0",
      hookStatus: {},
      expiration: "2035-08-29T10:00:00Z",
      startTimestamp: "2025-08-31T10:00:00Z",
      completionTimestamp: "2025-08-31T10:50:00Z",
    };
    const status = synced.status as Record<string, number> & { progress: Record<string, number> };

    // One error is a backup that failed in part: a completed one has no error in its results.
    expect(synced.status).toEqual({
      ...ended,
      phase: "PartiallyFailed",
      errors: 4,
      warnings: 2,
      progress: { totalItems: 6000, itemsBackedUp: 6000 },
      volumeSnapshotsAttempted: 1,
      volumeSnapshotsCompleted: 1,
      csiVolumeSnapshotsAttempted: 1,
      csiVolumeSnapshotsCompleted: 1,
      backupItemOperationsAttempted: 1,
      backupItemOperationsCompleted: 1,
    });
    // The counters are what a plain count of the artifacts the store is given finds: the entries of the
    // results, the items of the list of the resources, the volumes by their method.
    const entries = (result: { velero?: string[]; cluster?: string[]; namespaces?: Record<string, string[]> }) =>
      [...(result.velero ?? []), ...(result.cluster ?? []), ...Object.values(result.namespaces ?? {}).flat()].length;
    const items = Object.values(syntheticResourceList().value).flat().length;
    const methods = syntheticVolumeInfo(SYNCED_STARTED).value.map((volume) => volume.backupMethod);
    const taken = (method: string) => methods.filter((found) => found === method).length;

    expect([status.errors, status.warnings]).toEqual([
      entries(syntheticResults().value.errors),
      entries(syntheticResults().value.warnings),
    ]);
    expect(status.progress).toEqual({ totalItems: items, itemsBackedUp: items });
    expect([status.volumeSnapshotsAttempted, status.csiVolumeSnapshotsAttempted]).toEqual([
      taken("NativeSnapshot"),
      taken("CSISnapshot"),
    ]);
    // The release counts the CSI snapshots a backup took, which are the only ones its list of the resources
    // holds: the counter and the list say the same number.
    expect(status.csiVolumeSnapshotsAttempted).toBe(
      syntheticResourceList().value["snapshot.storage.k8s.io/v1/VolumeSnapshot"].length,
    );
    // The second holds nothing: it completed, with no counter, and the progress of a backup of no item.
    expect(withoutLog.status).toEqual({ ...ended, phase: "Completed", progress: {} });
    // Nothing of the work of the real backup is in either: not what it counted, were it a warning, and not
    // its items. What the server wrote of the format is there as the real backup has it, or not at all.
    const worked = takenBackup();
    const { version: _deprecated, ...reported } = worked.status;
    const like = {
      ...worked,
      status: { ...reported, formatVersion: "1.2.0", warnings: 4, volumeSnapshotsAttempted: 2 },
    };
    const alike = syncedBackups("synthetic-owner", run, SYNCED_STARTED, like, heldExpectations(SYNCED_STARTED));
    const { version: _left, ...unversioned } = ended;

    expect(alike.withoutLog.status).toEqual({
      ...unversioned,
      formatVersion: "1.2.0",
      phase: "Completed",
      progress: {},
    });
    expect(alike.synced.status).toMatchObject({ warnings: 2, volumeSnapshotsAttempted: 1, formatVersion: "1.2.0" });
    expect(alike.synced.status).not.toHaveProperty("version");
    // The release writes no counter of zero.
    const zeros = (value: unknown): string[] =>
      value && typeof value === "object"
        ? Object.entries(value).flatMap(([key, inner]) =>
            inner === 0 ? [key] : zeros(inner).map((name) => `${key}.${name}`),
          )
        : [];

    for (const backup of [synced, withoutLog])
      expect([backup.metadata.name, zeros(backup)]).toEqual([backup.metadata.name, []]);
  });

  it("places both four hundred days before the run and keeps them for years, whatever the clock says", () => {
    const like = takenBackup();
    const held = heldExpectations(SYNCED_STARTED);
    const made = syncedBackups("synthetic-owner", run, SYNCED_STARTED, like, held);
    const times = (backup: KubeResource) => {
      const { startTimestamp, completionTimestamp, expiration } = backup.status as Record<string, string>;

      return { startTimestamp, completionTimestamp, expiration };
    };
    const second = Math.floor(SYNCED_STARTED / 1000) * 1000;

    // Both, the second as the first: a backup with no start would be timed by its creation, which is the
    // moment of the sync, and would be the newest of the installation.
    for (const backup of [made.synced, made.withoutLog])
      expect(times(backup)).toEqual({
        startTimestamp: "2025-08-31T10:00:00Z",
        completionTimestamp: "2025-08-31T10:50:00Z",
        expiration: "2035-08-29T10:00:00Z",
      });
    const { startTimestamp, completionTimestamp, expiration } = times(made.synced);

    // To the second, as the release writes a time; the times of the artifacts are counted from the same.
    expect(Date.parse(startTimestamp)).toBe(second - SYNCED_AGE);
    expect(Date.parse(completionTimestamp) - Date.parse(startTimestamp)).toBe(SYNCED_WORK);
    for (const volume of held.volumeInfo.value.filter((found) => found.startTimestamp)) {
      expect(Date.parse(volume.startTimestamp ?? "")).toBeGreaterThan(Date.parse(startTimestamp));
      expect(Date.parse(volume.completionTimestamp ?? "")).toBeLessThanOrEqual(Date.parse(completionTimestamp));
    }
    // The CSI snapshot ended when its operation was found complete, which is when the backup ended.
    expect(
      held.volumeInfo.value
        .filter((volume) => volume.backupMethod === "CSISnapshot")
        .map((volume) => volume.completionTimestamp),
    ).toEqual([completionTimestamp]);
    // The release counts the expiration from the moment it takes a backup, by the retention of its spec:
    // theirs is years after the run, and the garbage collection leaves them.
    expect(Date.parse(expiration) - Date.parse(startTimestamp)).toBe(Number.parseInt(SYNCED_RETENTION, 10) * HOUR);
    expect(Date.parse(expiration) - SYNCED_STARTED).toBeGreaterThan(8 * 365 * 24 * HOUR);
    // The clock is not read: years later the same arguments give the same two.
    vi.useFakeTimers({ toFake: ["Date"], now: Date.parse("2031-03-09T23:59:59.321Z") });
    try {
      expect(syncedBackups("synthetic-owner", run, SYNCED_STARTED, like, held)).toEqual(made);
    } finally {
      vi.useRealTimers();
    }
    expect(syncedBackups("synthetic-owner", run, SYNCED_STARTED, like, held)).toEqual(made);
    // Within the second the fixtures were started in their times are the same, and a second later they are
    // not.
    const later = (moment: number) =>
      syncedBackups("synthetic-owner", run, moment, like, heldExpectations(moment)).withoutLog;

    expect(times(later(second + 999))).toEqual(times(made.withoutLog));
    expect(times(later(second + 1000))).toEqual({
      startTimestamp: "2025-08-31T10:00:01Z",
      completionTimestamp: "2025-08-31T10:50:01Z",
      expiration: "2035-08-29T10:00:01Z",
    });
  });

  it("counts the snapshots and the operations of the plugins as the release does, with no counter of zero", () => {
    const held = heldExpectations(SYNCED_STARTED);
    const status = (artifacts: typeof held) =>
      syncedBackups("synthetic-owner", run, SYNCED_STARTED, takenBackup(), artifacts).synced.status as Record<
        string,
        unknown
      >;
    const counters = (value: typeof held.volumeInfo.value) =>
      Object.fromEntries(
        Object.entries(status({ ...held, volumeInfo: { ...held.volumeInfo, value } })).filter(([key]) =>
          /Attempted$|Completed$|Failed$/.test(key),
        ),
      );
    const [skipped, native, csi, podVolume, failedPodVolume] = held.volumeInfo.value;
    const unfinished = structuredClone(native);
    const refused = structuredClone(csi);

    expect(held.volumeInfo.value.map((volume) => [volume.backupMethod, volume.result])).toEqual([
      [undefined, undefined],
      ["NativeSnapshot", "succeeded"],
      ["CSISnapshot", "succeeded"],
      ["PodVolumeBackup", "succeeded"],
      ["PodVolumeBackup", "failed"],
    ]);
    // A native snapshot is counted as attempted, and as completed in the phase Completed alone.
    if (unfinished.nativeSnapshotInfo) unfinished.nativeSnapshotInfo.Phase = "Failed";
    expect(counters([native, unfinished, native])).toEqual({
      volumeSnapshotsAttempted: 3,
      volumeSnapshotsCompleted: 2,
    });
    expect(counters([unfinished])).toEqual({ volumeSnapshotsAttempted: 1 });
    // A CSI snapshot is one operation of a plugin: completed when the operation completed, failed when it
    // ended with an error, which is what the volume information says of its result.
    refused.result = "failed";
    expect(counters([csi, refused, csi])).toEqual({
      csiVolumeSnapshotsAttempted: 3,
      csiVolumeSnapshotsCompleted: 2,
      backupItemOperationsAttempted: 3,
      backupItemOperationsCompleted: 2,
      backupItemOperationsFailed: 1,
    });
    expect(counters([refused])).toEqual({
      csiVolumeSnapshotsAttempted: 1,
      backupItemOperationsAttempted: 1,
      backupItemOperationsFailed: 1,
    });
    // A pod volume and a volume that was skipped are counted by neither.
    expect(counters([skipped, podVolume, failedPodVolume])).toEqual({});
    expect(counters([])).toEqual({});
    // A volume whose data was moved is written with the method of a CSI snapshot as well, in a backup that
    // moves the data of every volume and counts no snapshot of them: the store is given none, and no status
    // is made up for one.
    const moved = { ...structuredClone(csi), snapshotDataMoved: true };

    for (const volumes of [[moved], [csi, moved, native]])
      expect(() => counters(volumes)).toThrow("The volumes of the synced backup hold none whose data was moved");
    // With no error in its results a backup completed; its warnings are counted all the same.
    const quiet = status({ ...held, results: { ...held.results, errors: 0 } });

    expect([quiet.phase, "errors" in quiet, quiet.warnings]).toEqual(["Completed", false, 2]);
    expect(status({ ...held, results: { ...held.results, errors: 1, warnings: 0 } })).toMatchObject({
      phase: "PartiallyFailed",
      errors: 1,
    });
    expect(status({ ...held, results: { ...held.results, errors: 1, warnings: 0 } })).not.toHaveProperty("warnings");
    // A backup of one item has the item done, and one of none has a progress with no key.
    expect(status({ ...held, resourceList: { ...held.resourceList, items: 1 } }).progress).toEqual({
      totalItems: 1,
      itemsBackedUp: 1,
    });
    expect(status({ ...held, resourceList: { ...held.resourceList, items: 0 } }).progress).toEqual({});
  });

  it("says in an annotation what the two backups of the store are made of, themselves and their artifacts", () => {
    const held = heldExpectations(SYNCED_STARTED);
    const shapes = (started: number, like: ReturnType<typeof takenBackup>, artifacts: typeof held) => {
      const made = syncedBackups("synthetic-owner", run, started, like, artifacts);

      return [made.synced, made.withoutLog].map((backup) => backup.metadata.annotations?.[SHAPE_ANNOTATION]);
    };
    const [shape, ofTheSecond] = shapes(SYNCED_STARTED, takenBackup(), held);

    // One digest for the two: they are placed together.
    expect(shape).toMatch(/^[a-f0-9]{16}$/);
    expect(ofTheSecond).toBe(shape);
    expect(shapes(SYNCED_STARTED, takenBackup(), held)).toEqual([shape, shape]);
    // Other artifacts are another shape, were the two backups the same: the log is in no other part of
    // them.
    const digest = held.digest.replace(/^./, held.digest.startsWith("0") ? "1" : "0");

    expect(shapes(SYNCED_STARTED, takenBackup(), { ...held, digest })[0]).not.toBe(shape);
    // So is what the status counts, what the server filled, and the moment the fixtures were started.
    expect(shapes(SYNCED_STARTED, takenBackup(), { ...held, results: { ...held.results, warnings: 3 } })[0]).not.toBe(
      shape,
    );
    const filled = takenBackup();

    filled.spec.itemOperationTimeout = "1h0m0s";
    expect(shapes(SYNCED_STARTED, filled, held)[0]).not.toBe(shape);
    expect(shapes(SYNCED_STARTED + 1000, takenBackup(), { ...held, started: SYNCED_STARTED + 1000 })[0]).not.toBe(
      shape,
    );
    // What is not taken from the real backup does not change it: what the cluster gave it, and its work.
    const again = takenBackup();

    again.metadata.uid = "another-synthetic-uid";
    again.metadata.resourceVersion = "9876";
    again.status.progress = { totalItems: 14, itemsBackedUp: 14 };
    again.status.startTimestamp = "2026-10-05T09:59:00Z";
    expect(shapes(SYNCED_STARTED, again, held)).toEqual([shape, shape]);
  });

  it("makes the two of the completed real backup of the run and of the artifacts of its synced backup, and of nothing else", () => {
    const names = fixtureNames(run);
    const like = takenBackup();
    const held = heldExpectations(SYNCED_STARTED);

    expect(() => syncedBackups("", run, SYNCED_STARTED, like, held)).toThrow("Fixture ownership is required");
    expect(() => syncedBackups("synthetic-owner", "personal-namespace", SYNCED_STARTED, like, held)).toThrow(
      "A generated local fixture run ID is required",
    );
    expect(() => syncedBackups("synthetic-owner", run, Number.NaN, like, held)).toThrow(
      "The time the fixtures were started is required",
    );
    // Another kind, another backup of the run, the real backup of another run, and one the server did not
    // complete or did not report.
    for (const other of [
      { ...like, kind: "Restore" },
      { ...like, metadata: { ...like.metadata, name: names.invalidBackup } },
      { ...like, metadata: { ...like.metadata, name: names.syncedBackup } },
      { ...like, metadata: { ...like.metadata, name: fixtureNames("b1b2b3b4").backup } },
      { ...like, status: { ...like.status, phase: "InProgress" } },
      { ...like, status: { ...like.status, phase: "PartiallyFailed" } },
      { ...like, status: undefined },
    ])
      expect(() => syncedBackups("synthetic-owner", run, SYNCED_STARTED, other, held)).toThrow(
        "The backup the server completed for this run is required: the synced backups are made like it",
      );
    // The artifacts of another backup, of another namespace, and what is not the digest of a placement.
    for (const other of [
      { ...held, backup: names.syncedBackupWithoutLog },
      { ...held, backup: fixtureNames("b1b2b3b4").syncedBackup },
      { ...held, namespace: names.views },
      { ...held, digest: "" },
      { ...held, digest: held.digest.slice(1) },
      { ...held, digest: held.digest.toUpperCase().replace(/^\d/, "A") },
    ])
      expect(() => syncedBackups("synthetic-owner", run, SYNCED_STARTED, like, other)).toThrow(
        "The artifacts of the synced backup of this run are required",
      );
    // The artifacts of another moment than the one the metadata is made for, a thousandth or a month away:
    // the times of their log and of their volumes would not be the ones of the work the status tells.
    for (const other of [
      heldExpectations(SYNCED_STARTED + 1),
      heldExpectations(SYNCED_STARTED - 1000),
      heldExpectations(SYNCED_STARTED + 30 * 24 * HOUR),
      { ...held, started: Number.NaN },
    ])
      expect(() => syncedBackups("synthetic-owner", run, SYNCED_STARTED, like, other)).toThrow(
        "The artifacts and the metadata of the synced backups are made for the same moment",
      );
    expect(held.started).toBe(SYNCED_STARTED);
  });

  it("makes the operations the server refuses: both kinds of selector, and a restore of a schedule without a backup", () => {
    const names = fixtureNames(run);
    const { backup, restore, orphan } = refusedFixtures("synthetic-owner", run);
    const labels = { [OWNER_LABEL]: "synthetic-owner", [FIXTURE_LABEL]: run, [FIXTURE_MODE]: "live" };

    // The three are of this run and of the namespace of the installation, and none carries a status: the
    // server is what refuses them.
    for (const resource of [backup, restore, orphan]) {
      expect(resource.metadata).toMatchObject({ namespace: "velero-demo", labels });
      expect(resource).not.toHaveProperty("status");
    }
    expect([backup.metadata.name, restore.metadata.name, orphan.metadata.name]).toEqual([
      `fixture-invalid-backup-${run}`,
      `fixture-invalid-restore-${run}`,
      `fixture-orphan-restore-${run}`,
    ]);
    // A backup and a restore that name both kinds of selector fail their validation, and nothing else of
    // them is wrong: the storage location of the backup is the one of the environment, and the restore is
    // of the real backup, so that a URL is signed for their artifacts.
    for (const resource of [backup, restore]) {
      expect(resource.spec).toMatchObject({
        labelSelector: { matchLabels: { [FIXTURE_LABEL]: run } },
        orLabelSelectors: [{ matchLabels: { [FIXTURE_LABEL]: run } }],
      });
    }
    expect(backup.spec).toMatchObject({ storageLocation: "default", includedNamespaces: [names.source] });
    expect(restore.spec).toMatchObject({ backupName: names.backup });
    // The restore of a schedule that has no backup names the schedule, and no backup and one kind of
    // selector at most: the server refuses it for the schedule alone.
    expect(orphan.spec).toMatchObject({ scheduleName: `fixture-empty-schedule-${run}` });
    expect(orphan.spec).not.toHaveProperty("backupName");
    expect(orphan.spec).not.toHaveProperty("orLabelSelectors");
    expect(orphan.spec).not.toHaveProperty("labelSelector");
    expect(() => refusedFixtures("", run)).toThrow();
    // What the release writes when it refuses each, as the proof expects it.
    expect(REFUSALS).toEqual({
      backup: "encountered labelSelector as well as orLabelSelectors in backup spec, only one can be specified",
      restore: "encountered labelSelector as well as orLabelSelectors in restore spec, only one can be specified",
      orphan: "No backups found for schedule",
    });
  });

  it("waits for a refusal through every phase an operation has before its controller validates it", () => {
    // A restore is new, and a backup of this release goes through its queue, before either is validated.
    expect(isRefused("Backup", undefined, REFUSALS.backup)).toBe(false);
    for (const phase of ["", "New", "Queued", "ReadyToStart"])
      expect([phase, isRefused("Backup", { phase }, REFUSALS.backup)]).toEqual([phase, false]);
    expect(
      isRefused(
        "Backup",
        { phase: "FailedValidation", validationErrors: ["another reason", REFUSALS.backup] },
        REFUSALS.backup,
      ),
    ).toBe(true);
    // Refused for another reason, or in a phase its controller gives to what it did not refuse: the
    // operation is not the fixture it was made to be.
    for (const validationErrors of [["another reason"], [], undefined])
      expect(() => isRefused("Backup", { phase: "FailedValidation", validationErrors }, REFUSALS.backup)).toThrow(
        "Refused Backup failed its validation for another reason",
      );
    for (const phase of ["InProgress", "Completed", "Failed", "PartiallyFailed", "Finalizing", "Deleting"])
      expect(() => isRefused("Restore", { phase }, REFUSALS.restore)).toThrow(
        `Refused Restore is ${phase} where it was expected to fail its validation`,
      );
  });

  it("makes the identities of the transport proof, each allowed a download up to one step, and one allowed all of it", () => {
    const identities = proofIdentities("synthetic-owner", run);
    const labels = { [OWNER_LABEL]: "synthetic-owner", [FIXTURE_LABEL]: run, [FIXTURE_MODE]: "live" };
    const rules = (name: keyof typeof identities) =>
      (identities[name].find((resource) => resource.kind === "Role") as unknown as { rules: unknown[] }).rules;
    const reads = {
      apiGroups: ["velero.io"],
      resources: ["backups", "restores", "backupstoragelocations"],
      verbs: ["get"],
    };
    const requests = { apiGroups: ["velero.io"], resources: ["downloadrequests"], verbs: ["create", "get"] };
    const route = [
      { apiGroups: [""], resources: ["services", "pods"], verbs: ["get"] },
      { apiGroups: ["discovery.k8s.io"], resources: ["endpointslices"], verbs: ["list"] },
    ];

    expect(Object.keys(identities)).toEqual(["reader", "requester", "router", "downloader"]);
    for (const [name, resources] of Object.entries(identities)) {
      const identity = `proof-${name}-${run}`;

      // Each is an account of the namespace of the installation, of this run, with a role of that namespace
      // and no role of the cluster, and no credential mounted anywhere.
      expect(resources.map((resource) => resource.kind)).toEqual(["ServiceAccount", "Role", "RoleBinding"]);
      for (const resource of resources)
        expect(resource.metadata).toEqual({ name: identity, namespace: "velero-demo", labels });
      expect(resources[0]).toMatchObject({ automountServiceAccountToken: false });
      expect(resources[2]).toMatchObject({
        roleRef: { apiGroup: "rbac.authorization.k8s.io", kind: "Role", name: identity },
        subjects: [{ kind: "ServiceAccount", name: identity, namespace: "velero-demo" }],
      });
    }
    // The reader reads what a download reads of Velero, and creates no request.
    expect(rules("reader")).toEqual([reads]);
    // The requester creates the request and reads it, and reads no Secret and no Service.
    expect(rules("requester")).toEqual([reads, requests]);
    // The router reads the Service, its endpoint slices and its Pod, and has the verb create alone for the
    // port-forward, which is not what a port-forward over a WebSocket is asked with: it is refused there.
    expect(rules("router")).toEqual([
      reads,
      requests,
      ...route,
      { apiGroups: [""], resources: ["pods/portforward"], verbs: ["create"] },
    ]);
    // The downloader has what the documentation lists for a download through the cluster, and no more: a
    // port-forward over a WebSocket is asked of the API server with the verb get, and the releases that
    // check the verb create as well ask for both.
    expect(rules("downloader")).toEqual([
      reads,
      requests,
      ...route,
      { apiGroups: [""], resources: ["pods/portforward"], verbs: ["get", "create"] },
    ]);
    // None may read a Secret, delete or change anything, or read every kind; the reader and the requester
    // have nothing of a port-forward.
    expect(JSON.stringify(identities)).not.toMatch(/secrets|delete|update|patch|"\*"/);
    for (const name of ["reader", "requester"] as const)
      expect(JSON.stringify(identities[name])).not.toContain("portforward");
    expect(() => proofIdentities("", run)).toThrow();
  });

  it("asks the controller to delete a backup of the fixtures, the real one, the refused one or one the store was given, and no other", () => {
    const names = fixtureNames(run);

    // The two the sync created from the store are deleted as the real one is, with the uid the cluster
    // gave each.
    for (const synced of [names.syncedBackup, names.syncedBackupWithoutLog])
      expect(fixtureDeletionRequest("synthetic-owner", run, "synced-uid", synced)).toEqual({
        apiVersion: "velero.io/v1",
        kind: "DeleteBackupRequest",
        metadata: {
          name: `${synced}-delete`,
          namespace: "velero-demo",
          labels: {
            [OWNER_LABEL]: "synthetic-owner",
            [FIXTURE_LABEL]: run,
            [FIXTURE_MODE]: "live",
            "velero.io/backup-name": synced,
            "velero.io/backup-uid": "synced-uid",
          },
        },
        spec: { backupName: synced },
      });
    for (const other of [
      fixtureNames("b1b2b3b4").syncedBackup,
      fixtureNames("b1b2b3b4").syncedBackupWithoutLog,
      `${names.syncedBackup}-delete`,
      names.syncedBackup.replace(run, ""),
      names.invalidRestore,
      names.orphanRestore,
      names.emptySchedule,
      names.source,
    ])
      expect(() => fixtureDeletionRequest("synthetic-owner", run, "uid", other)).toThrow(
        "Only a backup of the fixtures is deleted",
      );
    expect(() => fixtureDeletionRequest("synthetic-owner", run, "", names.syncedBackup)).toThrow(
      "Bound backup ownership is required for deletion",
    );

    expect(fixtureDeletionRequest("synthetic-owner", run, "backup-uid")).toMatchObject({
      metadata: { name: `${names.backup}-delete`, labels: { "velero.io/backup-name": names.backup } },
      spec: { backupName: names.backup },
    });
    expect(fixtureDeletionRequest("synthetic-owner", run, "invalid-uid", names.invalidBackup)).toMatchObject({
      kind: "DeleteBackupRequest",
      metadata: {
        name: `${names.invalidBackup}-delete`,
        namespace: "velero-demo",
        labels: {
          [OWNER_LABEL]: "synthetic-owner",
          [FIXTURE_LABEL]: run,
          "velero.io/backup-name": names.invalidBackup,
          "velero.io/backup-uid": "invalid-uid",
        },
      },
      spec: { backupName: names.invalidBackup },
    });
    for (const other of ["a-backup-of-the-operator", names.restore, fixtureNames("b1b2b3b4").backup, ""])
      expect(() => fixtureDeletionRequest("synthetic-owner", run, "uid", other)).toThrow();
    expect(() => fixtureDeletionRequest("synthetic-owner", run, "", names.invalidBackup)).toThrow();
  });

  it("names the path of an artifact of an operation of the run, and of no other operation", () => {
    const names = fixtureNames(run);
    const paths = fixtureArtifactPaths(run);

    // The same paths the real backup and the real restore are verified by.
    expect(fixtureArtifactPath(run, "BackupLog", names.backup)).toBe(paths.backupLog);
    expect(fixtureArtifactPath(run, "BackupResults", names.backup)).toBe(paths.backupResults);
    expect(fixtureArtifactPath(run, "RestoreLog", names.restore)).toBe(paths.restoreLog);
    expect(fixtureArtifactPath(run, "RestoreResults", names.restore)).toBe(paths.restoreResults);
    expect(fixtureArtifactPath(run, "BackupLog", names.invalidBackup)).toBe(
      `/velero-demo/backups/fixture-invalid-backup-${run}/fixture-invalid-backup-${run}-logs.gz`,
    );
    expect(fixtureArtifactPath(run, "RestoreLog", names.invalidRestore)).toBe(
      `/velero-demo/restores/fixture-invalid-restore-${run}/restore-fixture-invalid-restore-${run}-logs.gz`,
    );
    // A backup is not asked for the log of a restore, nor an operation of another run or of the operator.
    for (const [artifact, name] of [
      ["BackupLog", names.restore],
      ["RestoreLog", names.backup],
      ["BackupLog", fixtureNames("b1b2b3b4").backup],
      ["RestoreResults", "a-restore-of-the-operator"],
      ["BackupLog", "../../other"],
    ] as const)
      expect(() => fixtureArtifactPath(run, artifact, name)).toThrow();
  });

  it("grants only namespaced Velero reads and supplies a dangling-location case", () => {
    const resources = restrictedFixtures("synthetic-owner", run);
    const role = resources.find((resource) => resource.kind === "Role");

    expect(role?.rules).toEqual([
      {
        apiGroups: ["velero.io"],
        resources: ["backups", "restores", "schedules", "backupstoragelocations"],
        verbs: ["get", "list", "watch"],
      },
    ]);
    expect(resources.some((resource) => resource.kind === "ClusterRoleBinding")).toBe(false);
    expect(resources[0].spec).toMatchObject({ storageLocation: "fixture-missing-location" });
    expect(resources[0].metadata.labels?.[FIXTURE_MODE]).toBe("synthetic");
  });

  it("gives the views their references, a long name, a silent object and a reader of a part", () => {
    const names = fixtureNames(run);
    const resources = viewFixtures("synthetic-owner", run);
    const named = (name: string) => resources.find((resource) => resource.metadata.name === name);
    const role = resources.find((resource) => resource.kind === "Role");

    expect(resources[0]).toMatchObject({ kind: "Namespace", metadata: { name: names.views } });
    // Two namespaces, each before what is put into it, and nothing outside them. No Secret is among the
    // fixtures: no object carries data.
    expect(
      resources.filter((resource) => resource.kind === "Namespace").map((resource) => resource.metadata.name),
    ).toEqual([names.views, names.defaults]);
    expect(
      resources
        .filter((resource) => resource.kind !== "Namespace")
        .every(
          (resource) =>
            [names.views, names.defaults].includes(resource.metadata.namespace ?? "") &&
            resources.findIndex((other) => other.metadata.name === resource.metadata.namespace) <
              resources.indexOf(resource) &&
            resource.kind !== "Secret" &&
            !("data" in resource),
        ),
    ).toBe(true);
    expect(
      resources.every(
        (resource) =>
          resource.metadata.labels?.[OWNER_LABEL] === "synthetic-owner" &&
          resource.metadata.labels?.[FIXTURE_LABEL] === run &&
          resource.metadata.labels?.[FIXTURE_MODE] === "synthetic",
      ),
    ).toBe(true);
    // A reference that leads somewhere, and the ones that lead nowhere.
    expect(named("views-daily-20260901030000")).toMatchObject({
      metadata: { labels: { "velero.io/schedule-name": "views-daily" } },
      spec: { storageLocation: "views-available", volumeSnapshotLocations: ["views-snapshots"] },
      status: { phase: "Completed", warnings: 2 },
    });
    expect(named("views-daily-20260901030000")?.status).not.toHaveProperty("errors");
    for (const target of ["views-daily", "views-available", "views-snapshots"]) expect(named(target)).toBeDefined();
    expect(named("backup-missing-schedule")?.metadata.labels?.["velero.io/schedule-name"]).toBe("views-removed");
    expect(named("backup-missing-location")?.spec).toMatchObject({ storageLocation: "views-removed" });
    expect(named("views-removed")).toBeUndefined();
    expect(
      resources
        .filter((resource) => resource.kind === "Restore")
        .map((resource) => {
          const { backupName, scheduleName } = resource.spec as { backupName?: string; scheduleName?: string };

          return [resource.metadata.name, backupName, scheduleName];
        }),
    ).toEqual([
      // As Velero keeps a restore it took: the schedule of the backup written beside the backup.
      ["restore-of-daily-completed", "views-daily-20260901030000", "views-daily"],
      ["restore-of-daily-partiallyfailed", "views-daily-20260901030000", "views-daily"],
      ["restore-mapped", "views-daily-20260901030000", "views-daily"],
      // Asked from a schedule that has no backup, and of a backup that is not there any more.
      ["restore-of-schedule", undefined, "views-removed"],
      ["restore-of-removed", "views-removed", undefined],
      // Of a backup that was started by hand, which has no schedule.
      [LONG_RESTORE_NAME, LONG_BACKUP_NAME, undefined],
    ]);
    expect(named("restore-mapped")).toMatchObject({
      spec: {
        namespaceMapping: { [names.source]: names.restored, [`${names.source}-second`]: `${names.restored}-second` },
        existingResourcePolicy: "update",
        itemOperationTimeout: "4h0m0s",
      },
    });
    // It waits for an operation of a plugin, which did not end: no counter of zero, and no count of the
    // hooks, which the release makes when it finalizes a restore.
    expect(named("restore-mapped")?.status).toEqual({
      phase: "WaitingForPluginOperationsPartiallyFailed",
      startTimestamp: "2026-09-01T10:00:00Z",
      errors: 1,
      progress: { totalItems: 10, itemsRestored: 10 },
      restoreItemOperationsAttempted: 1,
    });
    expect(named("restore-of-daily-partiallyfailed")?.status).toMatchObject({
      phase: "PartiallyFailed",
      hookStatus: { hooksAttempted: 2, hooksFailed: 1 },
    });
    expect((named("restore-mapped")?.spec as { excludedResources?: string[] } | undefined)?.excludedResources).toEqual([
      "secrets",
      "nodes",
      "events",
      "events.events.k8s.io",
      "backups.velero.io",
      "restores.velero.io",
      "resticrepositories.velero.io",
      "csinodes.storage.k8s.io",
      "volumeattachments.storage.k8s.io",
      "backuprepositories.velero.io",
    ]);
    expect(named("restore-of-schedule")?.status).toEqual({
      phase: "FailedValidation",
      validationErrors: ["No backups found for schedule", "No completed backups found for schedule"],
    });
    expect(LONG_BACKUP_NAME).toHaveLength(63);
    expect(named(LONG_BACKUP_NAME)).toBeDefined();
    expect(named("backup-unreported")).not.toHaveProperty("status");
    // A name that another installation has too, for an object that is not the same.
    expect(staticFixtures("synthetic-owner", run).map((resource) => resource.metadata.name)).toContain(
      "backup-inprogress",
    );
    expect(named("backup-inprogress")).toMatchObject({
      spec: { storageLocation: "views-available" },
      status: { progress: { itemsBackedUp: 7 } },
    });
    // The reader reads three families in its namespace and nothing else: no restore, no snapshot location,
    // no secret, no write, nothing of the cluster.
    expect(role?.metadata.name).toBe(VIEW_READER);
    expect(role?.rules).toEqual([
      {
        apiGroups: ["velero.io"],
        resources: ["backups", "schedules", "backupstoragelocations"],
        verbs: ["get", "list", "watch"],
      },
    ]);
    // The second reader reads the restores and what they refer to, and not the backups.
    const roles = resources.filter((resource) => resource.kind === "Role");
    const bindings = resources.filter((resource) => resource.kind === "RoleBinding");

    expect(roles.map((found) => found.metadata.name)).toEqual([VIEW_READER, VIEW_READER_OF_RESTORES]);
    expect(roles[1].rules).toEqual([
      {
        apiGroups: ["velero.io"],
        resources: ["restores", "schedules", "backupstoragelocations", "volumesnapshotlocations"],
        verbs: ["get", "list", "watch"],
      },
    ]);
    expect(bindings.map((binding) => [binding.roleRef, binding.subjects])).toEqual(
      [VIEW_READER, VIEW_READER_OF_RESTORES].map((name) => [
        { apiGroup: "rbac.authorization.k8s.io", kind: "Role", name },
        [{ kind: "ServiceAccount", name, namespace: names.views }],
      ]),
    );
    expect(resources.some((resource) => /^Cluster/.test(resource.kind) || resource.kind === "Secret")).toBe(false);
    for (const identity of [VIEW_READER, VIEW_READER_OF_RESTORES]) {
      expect(
        resources.find((resource) => resource.kind === "ServiceAccount" && resource.metadata.name === identity),
      ).toMatchObject({ automountServiceAccountToken: false });
    }
    expect(() => viewFixtures("", run)).toThrow();
  });

  it("gives a schedule a history that is placed in time from when the fixtures were started", () => {
    const started = Date.parse("2026-09-28T07:31:17.123Z");
    const submitted = Date.parse("2026-09-28T07:43:09Z");
    const resources = viewFixtures("synthetic-owner", run, started, submitted);
    const history = resources.filter(
      (resource) => resource.metadata.labels?.["velero.io/schedule-name"] === "views-history",
    );
    const status = (name: string) =>
      history.find((resource) => resource.metadata.name === name)?.status as Record<string, string> | undefined;

    expect(history.map((resource) => [resource.metadata.name, (resource.status as { phase: string }).phase])).toEqual([
      ["views-history-6", "Completed"],
      ["views-history-5", "Completed"],
      ["views-history-4", "PartiallyFailed"],
      ["views-history-3", "Completed"],
      ["views-history-3-again", "Failed"],
      ["views-history-2", "Completed"],
      ["views-history-1", "Completed"],
      ["views-history-0", "FailedValidation"],
    ]);
    // A backup a day, from the hour the fixtures were started in, and two of them an hour from each other.
    expect(status("views-history-6")?.startTimestamp).toBe("2026-09-22T07:00:00Z");
    expect(status("views-history-1")?.startTimestamp).toBe("2026-09-27T07:00:00Z");
    expect(status("views-history-3")?.startTimestamp).toBe("2026-09-25T07:00:00Z");
    expect(status("views-history-3-again")?.startTimestamp).toBe("2026-09-25T08:00:00Z");
    // The newest failed its validation: it never started, and it has no start and no end.
    expect(status("views-history-0")).toEqual({
      phase: "FailedValidation",
      validationErrors: ["Synthetic validation error; no operation was executed"],
    });
    expect(resources.find((resource) => resource.metadata.name === "views-history")).toMatchObject({
      kind: "Schedule",
      spec: { schedule: "0 1 * * *", paused: false, useOwnerReferencesInBackup: false },
      // The last submission is the time the newest backup was created, as the release writes the two.
      status: { phase: "Enabled", lastBackup: "2026-09-28T07:43:09Z" },
    });
    // Without the time of that backup the last submission is the time the fixtures were started.
    expect(
      viewFixtures("synthetic-owner", run, started).find((resource) => resource.metadata.name === "views-history")
        ?.status,
    ).toEqual({ phase: "Enabled", lastBackup: "2026-09-28T07:31:17Z" });
    // The same times give the same objects: what is put in place once is found as it was.
    expect(viewFixtures("synthetic-owner", run, started, submitted)).toEqual(resources);
    expect(viewFixtures("synthetic-owner", run, started + 60_000, submitted)).toEqual(resources);
    expect(viewFixtures("synthetic-owner", run, started + 3_600_000, submitted)).not.toEqual(resources);
    expect(viewFixtures("synthetic-owner", run, started, submitted + 1000)).not.toEqual(resources);
    expect(() => viewFixtures("synthetic-owner", run, Number.NaN)).toThrow();
    expect(() => viewFixtures("synthetic-owner", run, started, Number.NaN)).toThrow();
  });

  // What the fixtures are put into: the objects by their kind, their namespace and their name, as an API
  // server keeps them. It refuses an object of a namespace that is not there, gives each object it creates
  // the time of its clock, and counts what changed an object.
  function cluster(owner: string, from: number) {
    const objects = new Map<string, Record<string, unknown> & { metadata: Record<string, unknown> }>();
    const order: string[] = [];
    let created = 0;
    let changes = 0;
    // What a controller of the release does to the cluster when the time of the runtime reaches its moment.
    const moves: { at: number; change: () => void }[] = [];
    const removed: string[] = [];
    // What was removed is listed for some reads more: the server removes an object after it said it would.
    const leaving: string[] = [];
    const paused: number[] = [];
    // The commands the cluster was asked, by their first words, and whether the answer of each was to be kept
    // in the log of the operations: it is, unless the client is told otherwise.
    const asked: string[] = [];
    const logged: boolean[] = [];
    // The objects the fixtures asked the cluster to hold, each time they did, were the object there or not.
    const applied: string[] = [];
    let linger = 0;
    const key = (kind: string, namespace: unknown, name: unknown) =>
      `${kind.split(".")[0].toLowerCase().replace(/s$/, "")}/${String(namespace ?? "")}/${String(name)}`;
    const create = (resource: { kind: string; metadata: Record<string, unknown> }) => {
      const namespace = resource.metadata.namespace;

      if (namespace !== undefined && !objects.has(key("Namespace", undefined, namespace))) {
        throw new Error(`namespaces "${String(namespace)}" not found`);
      }
      const name = key(resource.kind, namespace, resource.metadata.name);

      created += 1;
      order.push(name);
      objects.set(name, {
        ...structuredClone(resource),
        metadata: {
          ...structuredClone(resource.metadata),
          uid: `uid-${created}`,
          resourceVersion: "1",
          // Each object at its own second, as the ones of a run are.
          creationTimestamp: new Date(from + created * 1000).toISOString().replace(".000Z", "Z"),
        },
      });
      // The server acts on a request to delete a backup that is made in its namespace, a moment later.
      if (resource.kind === "DeleteBackupRequest" && namespace === "velero-demo") {
        moves.push({ at: clock + (told.deletes ?? 3000), change: () => deletion(name) });
      }
    };
    const flag = (args: string[], name: string) => args[args.indexOf(name) + 1];
    // The store of the environment: what each key holds, and every request it was sent, in their order.
    const store = new Map<string, Buffer>();
    const requests: { method: string; path: string; way?: string; bytes?: number }[] = [];
    // What the store is told to do in the place of what it would: to answer a request with a code, and to
    // keep other bytes than the ones it is sent.
    // And what the client of the cluster is told: to answer the one object it found as that object, where
    // the client of the environment answers a list of it.
    // And what the server is told: how long after a request to delete a backup was made it acts on it,
    // three seconds when it is told nothing; what happens in the cluster between the moment it removed
    // the files of a backup and the moment it removes the object; and where it leaves the deletions it
    // begins, one after the other, as a server that is stopped does: once it marked the request as begun,
    // once it marked the backup as being deleted as well, or once it removed the files and the backup and
    // did not end the request.
    const told: {
      answer?: (request: { method: string; path: string; way?: string }) => number | undefined;
      // The length the store says when it is asked for a key it does not hold, which is the one of its
      // answer: the length of a text of its own, when it is told nothing.
      missing?: (path: string) => number;
      keep?: (bytes: Uint8Array, way: string) => Uint8Array;
      unwrapped?: boolean;
      deletes?: number;
      between?: () => void;
      leaves?: ("begun" | "deleting" | "removed")[];
    } = {};
    // The placement of the tabs each time it was recorded, with the bodies the store had been sent by then.
    const recorded: (TabPlacement & { sent: number })[] = [];
    let placement: TabPlacement | undefined;
    // The time of the runtime: what it waited, and the cost of each command and of each request, which in
    // the runner begin by a check of their target.
    let clock = 0;
    let cost = 4000;
    type Synced = {
      apiVersion: string;
      kind: string;
      metadata: Record<string, unknown>;
      spec: Record<string, unknown>;
      status: Record<string, unknown>;
    };
    // The passes of the sync that end when the time of the runtime reaches theirs.
    const passes: { at: number; listed?: string[]; made?: (backup: Synced) => Synced; during?: boolean }[] = [];
    const orphaned: string[] = [];
    // What a pass of the sync lists when it begins: the folders the store holds under the backups.
    const folders = () => [
      ...new Set([...store.keys()].flatMap((path) => /^\/velero-demo\/backups\/([^/]+)\/./.exec(path)?.[1] ?? [])),
    ];
    // A backup as the release writes one it decoded into its type. The keys the type has, and no other. A
    // number of zero, an empty text and an empty list are left out, and a part that is optional is there as
    // it was read, were it empty. A time is written to the second. The parts of the spec that are not
    // optional in the type are written whatever was read: the retention and the two timeouts as a duration
    // of nothing, the hooks and the metadata of the items as nothing.
    const kept = (from: unknown, keys: string[]) =>
      Object.fromEntries(
        Object.entries((from ?? {}) as Record<string, unknown>).filter(
          ([name, value]) =>
            keys.includes(name) &&
            value !== 0 &&
            value !== "" &&
            value !== null &&
            !(Array.isArray(value) && value.length === 0),
        ),
      );
    const typed = (read: { metadata: Record<string, unknown>; spec?: unknown; status?: unknown }): Synced => {
      const status = kept(read.status, [
        "version",
        "formatVersion",
        "expiration",
        "phase",
        "queuePosition",
        "validationErrors",
        "startTimestamp",
        "completionTimestamp",
        "volumeSnapshotsAttempted",
        "volumeSnapshotsCompleted",
        "failureReason",
        "warnings",
        "errors",
        "progress",
        "csiVolumeSnapshotsAttempted",
        "csiVolumeSnapshotsCompleted",
        "backupItemOperationsAttempted",
        "backupItemOperationsCompleted",
        "backupItemOperationsFailed",
        "hookStatus",
      ]);

      for (const time of ["expiration", "startTimestamp", "completionTimestamp"]) {
        if (time in status) {
          status[time] = new Date(Math.floor(Date.parse(String(status[time])) / 1000) * 1000)
            .toISOString()
            .replace(".000Z", "Z");
        }
      }
      if ("progress" in status) status.progress = kept(status.progress, ["totalItems", "itemsBackedUp"]);
      if ("hookStatus" in status) status.hookStatus = kept(status.hookStatus, ["hooksAttempted", "hooksFailed"]);
      return {
        apiVersion: "velero.io/v1",
        kind: "Backup",
        metadata: kept(read.metadata, ["name", "namespace", "labels", "annotations"]),
        spec: {
          metadata: {},
          hooks: {},
          ttl: "0s",
          csiSnapshotTimeout: "0s",
          itemOperationTimeout: "0s",
          ...kept(read.spec, [
            "metadata",
            "includedNamespaces",
            "excludedNamespaces",
            "includedResources",
            "excludedResources",
            "includedClusterScopedResources",
            "excludedClusterScopedResources",
            "includedNamespaceScopedResources",
            "excludedNamespaceScopedResources",
            "labelSelector",
            "orLabelSelectors",
            "snapshotVolumes",
            "ttl",
            "volumeGroupSnapshotLabelKey",
            "includeClusterResources",
            "hooks",
            "storageLocation",
            "volumeSnapshotLocations",
            "defaultVolumesToRestic",
            "defaultVolumesToFsBackup",
            "orderedResources",
            "csiSnapshotTimeout",
            "itemOperationTimeout",
            "resourcePolicy",
            "snapshotMoveData",
            "datamover",
            "uploaderConfig",
          ]),
        },
        status,
      };
    };
    // A pass of the sync of the release over the storage location of the installation, with what it listed
    // of the store when it began. It passes over a location that is not available, and says nothing of
    // that pass. For a folder the cluster has no backup of, it asks for the metadata and leaves the folder
    // that has none; reads the metadata as a backup of its version, and leaves what is not one, and a
    // backup that waits for its plugins or is being finalized unless it expired; writes the namespace, the
    // location and its label over what it read; and creates the backup under the name the metadata gives
    // it, which the cluster refuses with a phase its schema does not list, or with a name that is taken.
    // Then it removes the backups of the location that ended, completed or in part, whose folder it did not
    // list, and says when it ended, to the second.
    const synchronise = (listed: string[], made?: (backup: Synced) => Synced) => {
      const location = objects.get(key("BackupStorageLocation", "velero-demo", "default"));
      const status = location?.status as { phase?: string; lastSyncedTime?: string } | undefined;

      if (status?.phase !== "Available") return;
      for (const folder of listed) {
        const stored = store.get(`/velero-demo/backups/${folder}/velero-backup.json`);
        let read: Parameters<typeof typed>[0] & { apiVersion?: string; kind?: string };

        if (objects.has(key("Backup", "velero-demo", folder)) || !stored) continue;
        try {
          read = JSON.parse(stored.toString("utf8"));
        } catch {
          continue;
        }
        if (read?.apiVersion !== "velero.io/v1" || read.kind !== "Backup" || !read.metadata) continue;
        // The release keeps some of the owners of a backup and the cluster keeps its finalizers: neither is
        // played, and no fixture names one.
        if ("ownerReferences" in read.metadata || "finalizers" in read.metadata) {
          throw new Error("The pretend cluster does not play the owners or the finalizers of a backup");
        }
        const backup = typed(read);
        const expires = Date.parse(String(backup.status.expiration));

        if (/^(WaitingForPluginOperations|Finalizing)/.test(String(backup.status.phase))) {
          if (!(expires <= from + clock)) continue;
          backup.status.phase = "PartiallyFailed";
        }
        backup.metadata.namespace = "velero-demo";
        backup.metadata.labels = {
          ...(backup.metadata.labels as Record<string, string> | undefined),
          "velero.io/storage-location": "default",
        };
        backup.spec = { ...backup.spec, storageLocation: "default" };
        if (
          !(BACKUP_PHASES as readonly string[]).includes(String(backup.status.phase ?? "New")) ||
          objects.has(key("Backup", "velero-demo", backup.metadata.name))
        )
          continue;
        // A backup that did not end is one the controllers of the release take: none of them is played.
        if (!["Completed", "PartiallyFailed", "Failed", "FailedValidation"].includes(String(backup.status.phase))) {
          throw new Error("The pretend cluster has no controller for a backup that did not end");
        }
        // Once it created a backup the release reads the list of its pod volume backups from the folder, and
        // creates each of them: that is not played either, and no fixture stores such a list.
        if (store.has(`/velero-demo/backups/${folder}/${folder}-podvolumebackups.json.gz`)) {
          throw new Error("The pretend cluster creates no pod volume backup from the folder of a backup");
        }
        create(made ? made(backup) : backup);
      }
      for (const [name, found] of [...objects.entries()]) {
        const labels = (found.metadata.labels ?? {}) as Record<string, string>;
        const phase = (found.status as { phase?: string } | undefined)?.phase;

        if (
          name.startsWith(key("Backup", "velero-demo", "")) &&
          labels["velero.io/storage-location"] === "default" &&
          (phase === "Completed" || phase === "PartiallyFailed") &&
          !listed.includes(String(found.metadata.name))
        ) {
          objects.delete(name);
          orphaned.push(name);
        }
      }
      status.lastSyncedTime = new Date(Math.floor((from + clock) / 1000) * 1000).toISOString().replace(".000Z", "Z");
    };
    // The deletion of a backup as the controller of the release carries it out for a request, which it looks
    // at once: one it began or ended is passed over. It removes the other requests that carry the name of
    // the backup. It ends the request with one error for a backup that is not there, and for a storage
    // location that is not there, is read-only or is not available, and leaves the backup as it was. It
    // marks the request as begun, writes the name and the identity of the backup into the labels that have
    // none, and marks the backup as being deleted. It reads the contents of the backup: contents that are
    // not in the store are not an error, and ones that are there and are not an archive in gzip end the
    // request with one error, the backup left in deletion with every file of it. Then it removes every key
    // of the folder of the backup, then the restores that name it, then the backup; ends the request; and
    // removes every request that carries the name and the identity of the backup.
    //
    // What is not played is refused: a backup in progress, native snapshots, pod volumes, data that was
    // moved, and contents that hold an item, for which the release calls its plugins.
    const deletion = (asked: string) => {
      const request = objects.get(asked);
      const requests = key("DeleteBackupRequest", "velero-demo", "");
      const marked = (found: { metadata: Record<string, unknown> }) =>
        (found.metadata.labels ?? {}) as Record<string, string>;
      const ended = (...errors: string[]) => {
        if (request) request.status = { phase: "Processed", ...(errors.length ? { errors } : {}) };
      };

      if (!request || ["Processed", "InProgress"].includes(String((request.status as { phase?: string })?.phase))) {
        return;
      }
      const name = (request.spec as { backupName?: string } | undefined)?.backupName;

      if (!name) return ended("spec.backupName is required");
      for (const [other, found] of [...objects.entries()]) {
        if (other !== asked && other.startsWith(requests) && marked(found)["velero.io/backup-name"] === name) {
          objects.delete(other);
        }
      }
      const backup = objects.get(key("Backup", "velero-demo", name));

      if (!backup) return ended("backup not found");
      const spec = backup.spec as { storageLocation?: string; snapshotMoveData?: boolean };
      const location = objects.get(key("BackupStorageLocation", "velero-demo", spec.storageLocation));

      if (
        !["Completed", "PartiallyFailed", "Failed", "FailedValidation", "Deleting"].includes(
          String((backup.status as { phase?: string } | undefined)?.phase),
        )
      ) {
        throw new Error("The pretend cluster has no controller for a backup that did not end");
      }

      if (!location) return ended(`backup storage location ${spec.storageLocation} not found`);
      if ((location.spec as { accessMode?: string } | undefined)?.accessMode === "ReadOnly") {
        return ended(
          `cannot delete backup because backup storage location ${spec.storageLocation} is currently in read-only mode`,
        );
      }
      if ((location.status as { phase?: string } | undefined)?.phase !== "Available") {
        return ended(
          `cannot delete backup because backup storage location ${spec.storageLocation} is currently in Unavailable state`,
        );
      }
      request.status = { phase: "InProgress" };
      request.metadata.labels = {
        ...marked(request),
        "velero.io/backup-name": marked(request)["velero.io/backup-name"] || name,
        "velero.io/backup-uid": marked(request)["velero.io/backup-uid"] || String(backup.metadata.uid),
      };
      // A server that is stopped leaves the deletion where it was: it takes up no request it began.
      const left = told.leaves?.shift();

      if (left === "begun") return;
      backup.status = { ...(backup.status as object), phase: "Deleting" };
      if (left === "deleting") return;
      const folder = `/velero-demo/backups/${name}/`;
      const contents = store.get(`${folder}${name}.tar.gz`);
      let archive: Buffer | undefined;

      if (contents) {
        try {
          archive = gunzipSync(contents);
        } catch {
          return ended("error invoking delete item actions");
        }
        // An archive ends with blocks of nothing, and one that holds nothing else is of no item. A part of
        // a block is an archive that was cut.
        if (archive.length % 512 !== 0) return ended("error invoking delete item actions");
        if (archive.some((byte) => byte !== 0)) {
          throw new Error("The pretend cluster calls no plugin for the items of a backup");
        }
      }
      if (
        store.has(`${folder}${name}-volumesnapshots.json.gz`) ||
        spec.snapshotMoveData ||
        [...objects.entries()].some(
          ([volume, found]) => volume.startsWith("podvolumebackup/") && marked(found)["velero.io/backup-name"] === name,
        )
      ) {
        throw new Error("The pretend cluster removes no snapshot of a backup");
      }
      for (const path of [...store.keys()]) if (path.startsWith(folder)) store.delete(path);
      told.between?.();
      for (const [restore, found] of [...objects.entries()]) {
        if (
          restore.startsWith(key("Restore", "velero-demo", "")) &&
          (found.spec as { backupName?: string } | undefined)?.backupName === name
        ) {
          objects.delete(restore);
        }
      }
      objects.delete(key("Backup", "velero-demo", name));
      if (left === "removed") return;
      ended();
      for (const [other, found] of [...objects.entries()]) {
        if (
          other.startsWith(requests) &&
          marked(found)["velero.io/backup-name"] === name &&
          marked(found)["velero.io/backup-uid"] === backup.metadata.uid
        ) {
          objects.delete(other);
        }
      }
    };
    // The time a command or a request takes goes by, and what the controllers did by then, and the passes of
    // the sync that ended by then, are run before the cluster or the store answers.
    const tick = () => {
      clock += cost;
      for (const move of moves.filter((next) => next.at <= clock).sort((first, second) => first.at - second.at)) {
        moves.splice(moves.indexOf(move), 1);
        move.change();
      }
      for (const pass of passes.filter((due) => due.at <= clock).sort((first, second) => first.at - second.at)) {
        passes.splice(passes.indexOf(pass), 1);
        synchronise(pass.listed ?? folders(), pass.made);
      }
    };
    // What the client of the cluster prints of what it read when it is asked for a template in the place of
    // the whole: a text in quotes, the value at a path, which is nothing when the path leads nowhere, and
    // the same for each item of a list. It prints a text or a number, and no part of an object whole.
    const printed = (template: string, read: unknown): string => {
      const parts = [...template.matchAll(/\{([^{}]*)\}/g)].map((part) => part[1]);
      const at = (path: string, from: unknown) =>
        path
          .split(".")
          .filter(Boolean)
          .reduce<unknown>((value, name) => (value as Record<string, unknown> | undefined)?.[name], from);
      const one = (part: string, from: unknown): string => {
        const value = part.startsWith('"') ? JSON.parse(part) : at(part, from);

        if (typeof value === "object" && value !== null) {
          throw new Error(`The pretend client prints no object whole: ${part}`);
        }
        return String(value ?? "");
      };
      let text = "";

      if (parts.map((part) => `{${part}}`).join("") !== template) {
        throw new Error(`Not a template the pretend client knows: ${template}`);
      }
      for (let index = 0; index < parts.length; index += 1) {
        if (parts[index].startsWith("range ")) {
          const end = parts.indexOf("end", index);
          const items = at(parts[index].slice(6).replace("[*]", ""), read);

          for (const item of Array.isArray(items) ? items : []) {
            text += parts
              .slice(index + 1, end)
              .map((part) => one(part, item))
              .join("");
          }
          index = end;
        } else text += one(parts[index], read);
      }
      return text;
    };

    return {
      objects,
      order,
      changes: () => changes,
      removed,
      paused,
      asked,
      logged,
      applied,
      // What a controller of the release does when the time of the runtime reaches `at`: it is done before
      // the cluster answers the command, or the store the request, that passes that moment.
      at: (at: number, change: () => void) => {
        moves.push({ at, change });
      },
      linger: (reads: number) => {
        linger = reads;
      },
      find: (kind: string, namespace: string | undefined, name: string) => objects.get(key(kind, namespace, name)),
      store,
      requests,
      told,
      recorded,
      orphaned,
      placement: () => structuredClone(placement),
      record: (next: TabPlacement | undefined) => {
        placement = structuredClone(next);
      },
      cost: (milliseconds: number) => {
        cost = milliseconds;
      },
      listing: folders,
      // A pass of the sync now, or one that ends when the time of the runtime reaches `at`. `listed` is
      // what it listed of the store when it began, where that was before now; `made` is what a server
      // creates in the place of what it read; and a pass that ends `during` a read ends between the
      // backups and the storage location the read answers.
      sync: (options: { listed?: string[]; made?: (backup: Synced) => Synced } = {}) => {
        synchronise(options.listed ?? folders(), options.made);
      },
      pass: (at: number, options: { listed?: string[]; made?: (backup: Synced) => Synced; during?: boolean } = {}) => {
        passes.push({ at, ...options });
      },
      runtime: {
        owner,
        pause(milliseconds: number) {
          // A wait that never ends would never give the test back its turn.
          if (paused.length > 5000) throw new Error("The pretend cluster was made to wait without end");
          paused.push(milliseconds);
          clock += milliseconds;
        },
        elapsed: () => clock,
        // The store answers what the runner would let it be asked, and nothing else.
        store(method: "GET" | "HEAD" | "PUT", path: string, body?: StoreBody) {
          assertStoreRequest({ method, path, run, body, placement: placement?.state, repaired: placement?.repaired });
          tick();
          requests.push({ method, path, ...(body ? { way: body.way, bytes: body.bytes.length } : {}) });
          const code = told.answer?.({ method, path, way: body?.way });
          const found = store.get(path);

          if (code !== undefined) return { code, headers: {}, bytes: Buffer.alloc(0) };
          if (method === "PUT") {
            if (body) store.set(path, Buffer.from(told.keep ? told.keep(body.bytes, body.way) : body.bytes));
            return { code: 200, headers: {}, bytes: Buffer.alloc(0) };
          }
          // For a key it does not hold the store of the environment answers with a text of its own, and
          // says the length of that text, which is not a length of the key.
          if (!found) {
            const refusal = Buffer.from(`<Error><Code>NoSuchKey</Code><Key>${path.slice(1)}</Key></Error>`);

            return {
              code: 404,
              headers: { "content-length": [String(told.missing?.(path) ?? refusal.length)] },
              bytes: method === "GET" ? refusal : Buffer.alloc(0),
            };
          }
          return {
            code: 200,
            headers: { "content-length": [String(found.length)] },
            bytes: method === "GET" ? found : Buffer.alloc(0),
          };
        },
        tabs: {
          read: () => structuredClone(placement),
          keep(next: TabPlacement) {
            placement = structuredClone(next);
            recorded.push({ ...structuredClone(next), sent: requests.filter((request) => request.bytes).length });
          },
        },
        apply(resource: { kind: string; metadata: Record<string, unknown> }) {
          const found = objects.get(key(resource.kind, resource.metadata.namespace, resource.metadata.name));

          applied.push(key(resource.kind, resource.metadata.namespace, resource.metadata.name));
          if (!found) return create(resource);
          const { status: _status, ...asked } = structuredClone(resource) as Record<string, unknown>;
          const next = { ...found, ...asked, metadata: { ...found.metadata, ...resource.metadata } };

          if (JSON.stringify(next) === JSON.stringify(found)) return;
          changes += 1;
          objects.set(key(resource.kind, resource.metadata.namespace, resource.metadata.name), next);
        },
        kubectl(args: string[], input?: string, _timeout?: number, recorded?: boolean) {
          const namespace = args.includes("--namespace") ? flag(args, "--namespace") || undefined : undefined;
          // A pass of the sync that ends during this read ends once the cluster has answered its backups.
          const before = passes.some((due) => due.at <= clock + cost && due.during)
            ? [...objects.entries()]
                .filter(([name]) => name.startsWith(key("Backup", namespace, "")))
                .map(([, found]) => structuredClone(found))
            : undefined;

          asked.push(args[0]);
          logged.push(recorded !== false);
          tick();
          if (args[0] === "create") {
            for (const item of (JSON.parse(input ?? "{}") as { items: Parameters<typeof create>[0][] }).items) {
              // An API server refuses an object of a name that is taken, the one that is leaving as well.
              if (objects.has(key(item.kind, item.metadata.namespace, item.metadata.name))) {
                throw new Error(`${item.kind} "${String(item.metadata.name)}" already exists`);
              }
              create(item);
            }
            return "";
          }
          if (args[0] === "patch") {
            const found = objects.get(key(args[1], namespace, args[2]));
            const patch = JSON.parse(flag(args, "--patch")) as { metadata: { uid: string }; status: object };

            if (!found || found.metadata.uid !== patch.metadata.uid) throw new Error("The object is another one");
            changes += 1;
            found.status = patch.status;
            return "";
          }
          // The objects of one or more kinds in a namespace, or in all of them, which a selector may choose
          // among.
          const of = (kinds: string) => {
            const prefixes = kinds
              .split(",")
              .map((kind) =>
                args.includes("--all-namespaces") ? `${key(kind, "", "").split("/")[0]}/` : key(kind, namespace, ""),
              );

            return [...objects.entries()].filter(([name]) => prefixes.some((prefix) => name.startsWith(prefix)));
          };

          // One object by its path, and by the identity it must have: the API server removes no other.
          if (args[0] === "delete" && args[1] === "--raw") {
            const [, group, inside, plural, name] =
              /^\/apis\/([a-z.]+)\/v1\/namespaces\/([a-z0-9-]+)\/([a-z]+)\/([a-z0-9.-]+)$/.exec(args[2]) ?? [];
            const options = JSON.parse(input ?? "{}") as { kind?: string; preconditions?: { uid?: string } };
            const found = objects.get(key(`${plural}.${group}`, inside, name));

            if (!plural || args[3] !== "-f" || options.kind !== "DeleteOptions" || !options.preconditions?.uid) {
              throw new Error("A delete by its path names what it removes and the identity it removes it by");
            }
            if (!found) throw new Error(`${plural}.${group} "${name}" not found`);
            if (found.metadata.uid !== options.preconditions.uid) throw new Error("The object is another one");
            objects.delete(key(`${plural}.${group}`, inside, name));
            removed.push(key(`${plural}.${group}`, inside, name));
            return "";
          }
          if (args[0] === "delete") {
            const wanted = Object.fromEntries(
              flag(args, "--selector")
                .split(",")
                .map((pair) => pair.split("=")),
            ) as Record<string, string>;

            if (!namespace || !args.includes("--selector"))
              throw new Error("A delete names its namespace and its labels");
            // The client waits for each object it removed, one at a time: two thousand take minutes.
            if (!args.includes("--wait=false")) throw new Error("A delete does not wait for each object");
            for (const [name, found] of of(args[1])) {
              const labels = (found.metadata.labels ?? {}) as Record<string, string>;

              if (Object.entries(wanted).every(([label, value]) => labels[label] === value)) {
                if (linger > 0) leaving.push(name);
                else objects.delete(name);
                removed.push(name);
              }
            }
            return "";
          }
          if (args[0] !== "get") throw new Error(`Not a command of the fixtures: ${args[0]}`);
          if (leaving.length) {
            if (linger > 0) {
              linger -= 1;
            } else {
              for (const name of leaving.splice(0)) objects.delete(name);
            }
          }
          if (args[2] && !args[2].startsWith("-")) {
            const found = objects.get(key(args[1], namespace, args[2]));

            // The client answers nothing for an object that is not there when it is told that it may not be.
            if (!found && args.includes("--ignore-not-found")) return "";
            if (!found) throw new Error(`${args[1]} "${args[2]}" not found`);
            return JSON.stringify(found);
          }
          const items = of(args[1]).map(([, found]) => found);
          const template = args.includes("-o") ? flag(args, "-o") : "json";

          if (template.startsWith("jsonpath=")) {
            return printed(
              template.slice("jsonpath=".length),
              told.unwrapped && items.length === 1 ? items[0] : { kind: "List", items },
            );
          }
          return JSON.stringify({
            items: before ? [...before, ...items.filter((item) => item.kind !== "Backup")] : items,
          });
        },
      },
    };
  }

  it("puts the fixtures of the views in place in the order they need, and finds them at a second call", () => {
    const names = fixtureNames(run);
    const started = Date.parse("2026-09-28T07:31:17.123Z");
    const target = cluster("synthetic-owner", Date.parse("2026-09-28T07:43:00Z"));
    const now = Date.parse("2026-09-28T07:45:00Z");
    const placed = createViewFixtures(target.runtime as never, run, started, now);

    expect(placed).toEqual({
      views: viewFixtures("synthetic-owner", run).filter((resource) => resource.kind !== "Namespace").length,
      overview: overviewFixtures("synthetic-owner", run, now).length,
      scale: SCALE_BACKUPS,
      restores: SCALE_RESTORES,
      // What is placed by the clock was not there: it was put in place, not again, and nothing was removed.
      again: [],
    });
    expect(target.removed).toEqual([]);
    // A namespace is there before what is put into it: the cluster refuses an object of one that is not.
    const newest = target.find("Backup", names.views, NEWEST_OF_THE_HISTORY);
    const schedule = target.find("Schedule", names.views, "views-history");

    expect(target.order.indexOf(`namespace//${names.views}`)).toBeLessThan(
      target.order.indexOf(`backup/${names.views}/${NEWEST_OF_THE_HISTORY}`),
    );
    // The last submission of the schedule is the time its newest backup was created, to the second, and
    // not the one the fixtures were started at.
    expect(newest?.metadata.creationTimestamp).toMatch(/^2026-09-28T07:43:\d\dZ$/);
    expect((schedule?.status as { lastBackup?: string } | undefined)?.lastBackup).toBe(
      newest?.metadata.creationTimestamp,
    );
    expect(newest?.status).toEqual({
      phase: "FailedValidation",
      validationErrors: ["Synthetic validation error; no operation was executed"],
    });
    // A second call, later, finds every object and changes none.
    const objects = structuredClone([...target.objects.entries()]);
    const changes = target.changes();

    expect(createViewFixtures(target.runtime as never, run, started + 60_000, now + HOUR)).toEqual({
      ...placed,
      again: [],
    });
    expect(target.changes()).toBe(changes);
    expect(target.removed).toEqual([]);
    expect([...target.objects.entries()]).toEqual(objects);
  });

  it("puts in place again what is placed by the clock when it is older than it is good for, and nothing else", () => {
    const names = fixtureNames(run);
    const started = Date.parse("2026-09-28T07:31:17.123Z");
    const target = cluster("synthetic-owner", Date.parse("2026-09-28T07:43:00Z"));
    const now = Date.parse("2026-09-28T07:45:00Z");
    const placedAt = (namespace: string, kind: string, name: string) =>
      (target.find(kind, namespace, name)?.metadata.annotations as Record<string, string> | undefined)?.[
        PLACED_ANNOTATION
      ];
    const started1h = (name: string) =>
      (target.find("Backup", names.overview, name)?.status as { startTimestamp?: string } | undefined)?.startTimestamp;

    createViewFixtures(target.runtime as never, run, started, now);
    expect(PLACED_FOR).toBe(12 * HOUR);
    expect(placedAt(names.overview, "Backup", "recent-1h")).toBe("2026-09-28T07:45:00.000Z");
    expect(placedAt(names.scale, "Backup", "backup-0001")).toBe("2026-09-28T07:45:00.000Z");
    expect(started1h("recent-1h")).toBe("2026-09-28T06:45:00Z");
    const fixed = structuredClone(
      [...target.objects.entries()].filter(
        ([name]) => !name.includes(`/${names.overview}/`) && !name.includes(`/${names.scale}/`),
      ),
    );
    // Within the time they are good for they are found as they are.
    const later = createViewFixtures(target.runtime as never, run, started, now + PLACED_FOR);

    expect(later.again).toEqual([]);
    expect(target.removed).toEqual([]);
    // A second after it they are removed, and the ones of now are created: the times are counted again.
    const after = now + PLACED_FOR + 1000;
    const again = createViewFixtures(target.runtime as never, run, started, after);
    const overview = overviewFixtures("synthetic-owner", run, after).length;

    expect(again).toMatchObject({ again: [names.overview, names.scale], overview, scale: SCALE_BACKUPS });
    expect(target.removed).toHaveLength(overview + SCALE_BACKUPS + SCALE_RESTORES);
    expect(
      target.removed.every((name) => name.includes(`/${names.overview}/`) || name.includes(`/${names.scale}/`)),
    ).toBe(true);
    expect(placedAt(names.overview, "Backup", "recent-1h")).toBe(new Date(after).toISOString());
    expect(started1h("recent-1h")).toBe(new Date(after - HOUR).toISOString().replace(".000Z", "Z"));
    // The fixtures whose times are fixed are as they were: the same objects, with the same versions.
    expect(
      [...target.objects.entries()].filter(
        ([name]) => !name.includes(`/${names.overview}/`) && !name.includes(`/${names.scale}/`),
      ),
    ).toEqual(fixed);
    // Nothing waited: what was removed was gone at once.
    expect(target.paused).toEqual([]);
    // What was removed may be there for a while: the namespace is read until it is not, and the ones of
    // now are created after that. An object created while the one of its name is there would be refused.
    target.linger(2);
    const third = after + PLACED_FOR + 1000;

    expect(createViewFixtures(target.runtime as never, run, started, third)).toMatchObject({
      again: [names.overview, names.scale],
    });
    // Each of the two namespaces was read twice more than it would have been.
    expect(target.paused).toEqual([1000, 1000]);
    expect(placedAt(names.overview, "Backup", "recent-1h")).toBe(new Date(third).toISOString());
    expect(placedAt(names.scale, "Backup", "backup-0001")).toBe(new Date(third).toISOString());
    // What is there of another run is not removed: nothing is, and the placement stops.
    const foreign = target.find("Backup", names.overview, "recent-1h");

    if (!foreign) throw new Error("The backup is there");
    (foreign.metadata.labels as Record<string, string>)[FIXTURE_LABEL] = "b1b2b3b4";
    const removed = target.removed.length;

    expect(() => createViewFixtures(target.runtime as never, run, started, third + 2 * PLACED_FOR)).toThrow(
      "The namespace holds what is not of this run; nothing is removed",
    );
    expect(target.removed).toHaveLength(removed);
  });

  it("puts in place again what is not made as it would be made now, whatever its age", () => {
    const names = fixtureNames(run);
    const started = Date.parse("2026-09-28T07:31:17.123Z");
    const target = cluster("synthetic-owner", Date.parse("2026-09-28T07:43:00Z"));
    const now = Date.parse("2026-09-28T07:45:00Z");
    const shape = (namespace: string, kind: string, name: string) =>
      (target.find(kind, namespace, name)?.metadata.annotations as Record<string, string> | undefined)?.[
        SHAPE_ANNOTATION
      ];

    createViewFixtures(target.runtime as never, run, started, now);
    const overview = shape(names.overview, "Backup", "recent-1h");
    const scale = shape(names.scale, "Backup", "backup-0001");

    // Every object says what it was made as, and the ones of a namespace say the same.
    expect(overview).toMatch(/^[0-9a-f]{16}$/);
    expect(scale).toMatch(/^[0-9a-f]{16}$/);
    expect(scale).not.toBe(overview);
    expect(shape(names.overview, "Schedule", "overview-schedule-12")).toBe(overview);
    // A minute later they are what would be made, and are left as they are.
    expect(createViewFixtures(target.runtime as never, run, started, now + 60_000).again).toEqual([]);
    // One that was made by the fixtures of before is not what would be made now: its namespace is put in
    // place again, and the other is left as it is.
    const old = target.find("Restore", names.overview, "restored-3h");

    if (!old) throw new Error("The restore is there");
    (old.metadata.annotations as Record<string, string>)[SHAPE_ANNOTATION] = "0000000000000000";
    expect(createViewFixtures(target.runtime as never, run, started, now + 120_000).again).toEqual([names.overview]);
    expect(shape(names.overview, "Restore", "restored-3h")).toBe(overview);
    expect(target.removed.every((name) => name.includes(`/${names.overview}/`))).toBe(true);
  });

  it("puts in place again what says that it was placed after now", () => {
    const names = fixtureNames(run);
    const started = Date.parse("2026-09-28T07:31:17.123Z");
    const target = cluster("synthetic-owner", Date.parse("2026-09-28T07:43:00Z"));
    const now = Date.parse("2026-09-28T07:45:00Z");
    const placedAt = (namespace: string, name: string) =>
      (target.find("Backup", namespace, name)?.metadata.annotations as Record<string, string> | undefined)?.[
        PLACED_ANNOTATION
      ];

    createViewFixtures(target.runtime as never, run, started, now);
    // The clock of the machine went back an hour: the times of what is in place are counted from a moment
    // that is not yet, and an operation of an hour ago would be one of now.
    const before = now - HOUR;

    expect(createViewFixtures(target.runtime as never, run, started, before).again).toEqual([
      names.overview,
      names.scale,
    ]);
    // What was in place was removed before the ones of now were created, and nothing else was.
    expect(target.removed).toHaveLength(
      overviewFixtures("synthetic-owner", run, before).length + SCALE_BACKUPS + SCALE_RESTORES,
    );
    expect(
      target.removed.every((name) => name.includes(`/${names.overview}/`) || name.includes(`/${names.scale}/`)),
    ).toBe(true);
    expect(placedAt(names.overview, "recent-1h")).toBe(new Date(before).toISOString());
    expect(placedAt(names.scale, "backup-0001")).toBe(new Date(before).toISOString());
  });

  it("stops when what it placed is not what the cluster holds", () => {
    const names = fixtureNames(run);
    const started = Date.parse("2026-09-28T07:31:17.123Z");
    const target = cluster("synthetic-owner", Date.parse("2026-09-28T07:43:00Z"));
    const now = Date.parse("2026-09-28T07:45:00Z");
    type Made = { kind: string; metadata: { name: string; annotations?: Record<string, string> }; status?: object };
    // A cluster that keeps what it is asked to create as `kept` says.
    const keeping = (from: ReturnType<typeof cluster>, kept: (items: Made[]) => Made[]) => ({
      ...from.runtime,
      kubectl: (args: string[], input?: string) => {
        if (args[0] !== "create") return from.runtime.kubectl(args, input);
        const list = JSON.parse(input ?? "{}") as { items: Made[] };

        return from.runtime.kubectl(args, JSON.stringify({ ...list, items: kept(list.items) }));
      },
    });
    const refused = `The fixtures of ${names.overview} are not the ones of this run`;

    // One that keeps no status of the restores: an operation with no phase is one the views would show as
    // not reported, and no suite would find what it looks for.
    expect(() =>
      createViewFixtures(
        keeping(target, (items) =>
          items.map(({ status, ...item }) => (item.kind === "Restore" ? item : { ...item, status })),
        ) as never,
        run,
        started,
        now,
      ),
    ).toThrow(refused);
    // One that keeps one object less than it was given.
    expect(() =>
      createViewFixtures(
        keeping(cluster("synthetic-owner", Date.parse("2026-09-28T07:43:00Z")), (items) =>
          items.filter((item) => item.metadata.name !== "recent-1h"),
        ) as never,
        run,
        started,
        now,
      ),
    ).toThrow(refused);
    // One that does not keep when an object was placed.
    expect(() =>
      createViewFixtures(
        keeping(cluster("synthetic-owner", Date.parse("2026-09-28T07:43:00Z")), (items) =>
          items.map((item) => ({
            ...item,
            metadata: {
              ...item.metadata,
              annotations: Object.fromEntries(
                Object.entries(item.metadata.annotations ?? {}).filter(([name]) => name !== PLACED_ANNOTATION),
              ),
            },
          })),
        ) as never,
        run,
        started,
        now,
      ),
    ).toThrow(refused);
    // Nothing made, which leaves nothing to say when it was placed: the suites would find nothing.
    expect(() =>
      placeByTheClock(
        cluster("synthetic-owner", Date.parse("2026-09-28T07:43:00Z")).runtime as never,
        run,
        names.overview,
        now,
        () => [],
      ),
    ).toThrow(refused);
    // What is in place, of the age and of the shape it is good with, and says that it is of another run:
    // it is left as it is, and the placing stops.
    const good = cluster("synthetic-owner", Date.parse("2026-09-28T07:43:00Z"));

    createViewFixtures(good.runtime as never, run, started, now);
    const foreign = good.find("Backup", names.overview, "recent-1h");

    if (!foreign) throw new Error("The backup is there");
    (foreign.metadata.labels as Record<string, string>)[FIXTURE_LABEL] = "b1b2b3b4";
    expect(() => createViewFixtures(good.runtime as never, run, started, now + HOUR)).toThrow(refused);
    expect(good.removed).toEqual([]);
  });

  it("places nothing by the clock in a namespace that is not of the run", () => {
    const names = fixtureNames(run);
    const started = Date.parse("2026-09-28T07:31:17.123Z");
    const target = cluster("synthetic-owner", Date.parse("2026-09-28T07:43:00Z"));
    const now = Date.parse("2026-09-28T07:45:00Z");

    createViewFixtures(target.runtime as never, run, started, now);
    const objects = structuredClone([...target.objects.entries()]);
    const created = target.order.length;
    const asked = target.asked.length;
    const later = now + 2 * PLACED_FOR;

    // The one of Velero, one of the cluster, one of another run, one that begins as one of this run, and
    // the one of this run whose fixtures have fixed times: they carry the labels of the run, and would be
    // removed with what is placed by the clock.
    for (const namespace of [
      "velero",
      "default",
      fixtureNames("b1b2b3b4").overview,
      `${names.overview}-more`,
      names.views,
    ]) {
      expect(() =>
        placeByTheClock(target.runtime as never, run, namespace, later, (placed) =>
          overviewFixtures("synthetic-owner", run, placed).map((resource) => ({
            ...resource,
            metadata: { ...resource.metadata, namespace },
          })),
        ),
      ).toThrow("Refusing to place fixtures outside the namespaces that are placed by the clock");
    }
    // What is made for another namespace is not placed by way of one that is placed by the clock.
    expect(() =>
      placeByTheClock(target.runtime as never, run, names.overview, later, (placed) => {
        const made = scaleFixtures("synthetic-owner", run, placed);

        return [...overviewFixtures("synthetic-owner", run, placed), made.backups[0]];
      }),
    ).toThrow(`Refusing to place in ${names.overview} what is made for another namespace`);
    // Nothing was asked of the cluster: what is there is what was there.
    expect(target.asked).toHaveLength(asked);
    expect(target.removed).toEqual([]);
    expect(target.order).toHaveLength(created);
    expect([...target.objects.entries()]).toEqual(objects);
  });

  it("gives the fixtures of the Overview what the release writes into the objects it takes", () => {
    const placed = Date.parse("2026-09-28T07:45:30.250Z");
    const resources = overviewFixtures("synthetic-owner", run, placed);
    const status = (name: string) =>
      resources.find((resource) => resource.metadata.name === name)?.status as Record<string, unknown> | undefined;
    const ago = (time: number) =>
      new Date(Date.parse("2026-09-28T07:45:30Z") - time).toISOString().replace(".000Z", "Z");

    // The time of the last backup the release asked for a schedule is in the schedule, with the time its
    // backup started at; a schedule with no backup has none.
    expect(status("overview-schedule-01")).toEqual({ phase: "Enabled", lastBackup: ago(HOUR) });
    expect(status("recent-1h")).toMatchObject({ startTimestamp: ago(HOUR) });
    expect(status("overview-schedule-07")).toMatchObject({ phase: "FailedValidation", lastBackup: ago(8 * HOUR) });
    expect(status("scheduled-8h")).toMatchObject({ startTimestamp: ago(8 * HOUR) });
    expect(status("overview-schedule-02")).toEqual({ phase: "Enabled" });
    // A backup that waits has its place in the queue, and no other has one.
    expect(status("flying-queued")).toEqual({ phase: "Queued", queuePosition: 1 });
    expect(
      resources.filter((resource) => "queuePosition" in ((resource.status as object | undefined) ?? {})),
    ).toHaveLength(1);
  });

  it("stops when what it removed is still there after the time it is given", () => {
    const started = Date.parse("2026-09-28T07:31:17.123Z");
    const target = cluster("synthetic-owner", Date.parse("2026-09-28T07:43:00Z"));
    const now = Date.parse("2026-09-28T07:45:00Z");

    createViewFixtures(target.runtime as never, run, started, now);
    vi.useFakeTimers({ toFake: ["Date"], now });
    try {
      // The time goes by while the placement waits, and what was removed never goes.
      const runtime = {
        ...target.runtime,
        pause: (milliseconds: number) => {
          target.paused.push(milliseconds);
          vi.setSystemTime(Date.now() + milliseconds);
        },
      };

      target.linger(10_000);
      expect(() => createViewFixtures(runtime as never, run, started, now + PLACED_FOR + 1000)).toThrow(
        `fixtures of ${fixtureNames(run).overview} are still there after they were removed`,
      );
      // Five minutes, a second at a time, and nothing was created over what is still there.
      expect(target.paused).toHaveLength(300);
      expect(target.find("Backup", fixtureNames(run).overview, "recent-1h")?.metadata.annotations).toMatchObject({
        [PLACED_ANNOTATION]: new Date(now).toISOString(),
      });
    } finally {
      vi.useRealTimers();
    }
  });

  // The log the server wrote for the real backup of the run, which begins as the log of every backup of the
  // release does.
  const REAL_LOG = [
    'time="2026-10-05T09:58:43Z" level=info msg="Setting up backup temp file" backup=velero-demo/fixture-backup-a1b2c3d4 logSource="pkg/controller/backup_controller.go:731"',
    'time="2026-10-05T09:58:43Z" level=info msg="Setting up plugin manager" backup=velero-demo/fixture-backup-a1b2c3d4 logSource="pkg/controller/backup_controller.go:738"',
    "",
  ].join("\n");

  // The installation of the demo as the placement of the tabs finds it: its namespace; its storage location,
  // available, whose last pass ended a while ago; the real backup of the run; and, in the store, the log of
  // that backup.
  function installation() {
    const target = cluster("synthetic-owner", Date.parse("2026-10-05T10:05:00Z"));
    const labels = { [OWNER_LABEL]: "synthetic-owner" };

    for (const resource of [
      { apiVersion: "v1", kind: "Namespace", metadata: { name: "velero-demo", labels } },
      {
        apiVersion: "velero.io/v1",
        kind: "BackupStorageLocation",
        metadata: { name: "default", namespace: "velero-demo", labels },
        spec: { provider: "aws", default: true, objectStorage: { bucket: BUCKET } },
        status: {
          phase: "Available",
          lastSyncedTime: "2026-10-05T10:04:20Z",
          lastValidationTime: "2026-10-05T10:04:50Z",
        },
      },
      takenBackup(),
    ])
      target.runtime.apply(resource);
    target.store.set(fixtureArtifactPaths(run).backupLog, gz(REAL_LOG));
    return target;
  }

  type Installation = ReturnType<typeof installation>;
  // A backup as the pretend server is about to create it.
  type Created = {
    metadata: { name?: string; labels: Record<string, string>; annotations: Record<string, string> };
    spec: Record<string, unknown>;
    status: Record<string, unknown>;
  };
  // The artifacts a placement of these cases stores when it is given no other: made once, and changed by none.
  let brief: ReturnType<typeof tabArtifacts> | undefined;
  const place = (target: Installation, artifacts?: ReturnType<typeof tabArtifacts>) => {
    brief ??= briefArtifacts(SYNCED_STARTED);
    return storeTabFixtures(target.runtime as never, run, SYNCED_STARTED, artifacts ?? brief);
  };
  const awaited = (target: Installation) => awaitTabFixtures(target.runtime as never, run);
  const tabKeys = () => {
    const paths = tabArtifactPaths(run);

    return [...Object.values(paths.synced), ...Object.values(paths.withoutLog)];
  };

  it("gives the store the files of the two backups, each folder with its metadata last, after it read the installation and recorded the placement", () => {
    const target = installation();
    const paths = tabArtifactPaths(run);
    const order = tabKeys();
    const artifacts = briefArtifacts(SYNCED_STARTED);
    const made = syncedBackups("synthetic-owner", run, SYNCED_STARTED, takenBackup(), tabExpectations(artifacts));
    const objects = structuredClone([...target.objects.entries()]);

    expect(place(target, artifacts)).toEqual({ state: "stored", written: order, way: "upload", met: [] });
    // It read the backups of the installation, once, and then the log the server wrote for the real one.
    expect(target.asked).toEqual(["get"]);
    expect(target.requests[0]).toEqual({ method: "GET", path: fixtureArtifactPaths(run).backupLog });
    // Then each file with its body, in the order of its folder, and after each the length the store holds.
    expect(target.requests.slice(1)).toEqual(
      order.flatMap((path) => [
        { method: "PUT", path, way: "upload", bytes: target.store.get(path)?.length },
        { method: "HEAD", path },
      ]),
    );
    expect([order.indexOf(paths.synced.metadata), order.indexOf(paths.withoutLog.metadata)]).toEqual([5, 10]);
    // The placement was recorded before the first of them was sent, with the metadata as it is stored; then
    // the way the first file found; and, after the last, that every file is in the store.
    expect(TAB_STATES).toEqual(["storing", "stored", "synced"]);
    expect(target.recorded.map(({ state, way, sent }) => [state, way, sent])).toEqual([
      ["storing", undefined, 0],
      ["storing", "upload", 1],
      ["stored", "upload", 11],
    ]);
    for (const record of target.recorded)
      expect(record).toMatchObject({
        artifacts: tabExpectations(artifacts).digest,
        shape: made.synced.metadata.annotations?.[SHAPE_ANNOTATION],
        metadata: { synced: JSON.stringify(made.synced), withoutLog: JSON.stringify(made.withoutLog) },
      });
    // What the store holds is what the generators made: each artifact in gzip, the contents of a backup of
    // no item, and the metadata as the plain JSON the release reads it as.
    const held = (path: string) => target.store.get(path) ?? Buffer.alloc(0);
    const text = (path: string) => gunzipSync(held(path)).toString("utf8");

    expect(text(paths.synced.log) === artifacts.log.text).toBe(true);
    expect([text(paths.synced.results), text(paths.synced.resourceList), text(paths.synced.volumeInfo)]).toEqual([
      artifacts.results.text,
      artifacts.resourceList.text,
      artifacts.volumeInfo.text,
    ]);
    expect([
      text(paths.withoutLog.results),
      text(paths.withoutLog.resourceList),
      text(paths.withoutLog.volumeInfo),
    ]).toEqual(['{"errors":{},"warnings":{}}\n', "{}\n", "[]\n"]);
    for (const archive of [paths.synced.archive, paths.withoutLog.archive])
      expect(gunzipSync(held(archive))).toEqual(Buffer.alloc(1024));
    expect(JSON.parse(held(paths.synced.metadata).toString("utf8"))).toEqual(made.synced);
    expect(JSON.parse(held(paths.withoutLog.metadata).toString("utf8"))).toEqual(made.withoutLog);
    // Eleven keys beside the log of the real backup, and nothing of the cluster was changed.
    expect([...target.store.keys()]).toEqual([fixtureArtifactPaths(run).backupLog, ...order]);
    expect([...target.objects.entries()]).toEqual(objects);
    expect(target.changes()).toBe(0);
    // The store of these cases is asked through what the runner refuses a request by: once the placement is
    // recorded as stored it takes no body, and it counts no request it did not take.
    const requests = target.requests.length;

    expect(() => target.runtime.store("PUT", paths.synced.archive, { bytes: emptyArchive(), way: "upload" })).toThrow(
      "A key of the tabs is written while the placement of the tabs is recorded as storing",
    );
    expect(() => target.runtime.store("PUT", paths.synced.archive)).toThrow(
      "A key of the tabs is not written without its body",
    );
    expect(() => target.runtime.store("GET", paths.synced.log)).toThrow("Unexpected local bucket target");
    expect(target.requests).toHaveLength(requests);
  });

  // The log is long and the machine may be busy: the case has a minute.
  it("stores the log of two hundred thousand lines the generators make for the run when it is given no other", () => {
    const target = installation();
    const started = Date.parse("2026-10-05T10:00:00.000Z");
    const placed = storeTabFixtures(target.runtime as never, run, started);
    const log = gunzipSync(target.store.get(tabArtifactPaths(run).synced.log) ?? Buffer.alloc(0));

    // The digests the generators are pinned to, for this run and this moment.
    expect(placed.written).toHaveLength(11);
    expect(createHash("sha256").update(log).digest("hex")).toBe(PINNED.log);
    expect(target.placement()?.artifacts).toBe(PINNED.all);
    // The times of the metadata are counted from the same moment as the ones of the artifacts.
    expect(JSON.parse(target.placement()?.metadata.synced ?? "{}").status).toMatchObject({
      startTimestamp: "2025-08-31T10:00:00Z",
      completionTimestamp: "2025-08-31T10:50:00Z",
    });
  }, 60_000);

  it("leaves a folder of the store without its metadata until every other file of it is there", () => {
    const names = fixtureNames(run);
    const target = installation();
    const paths = tabArtifactPaths(run);
    // What the store held of the tabs each time the server created a backup.
    const created: [name: unknown, held: string[]][] = [];

    // A pass of the sync ends before each request the store is sent.
    target.told.answer = () => {
      target.sync({
        made: (backup) => {
          created.push([backup.metadata.name, [...target.store.keys()].slice(1)]);
          return backup;
        },
      });
      return undefined;
    };
    expect(place(target).state).toBe("stored");
    // Each backup was created from a folder that held every file of it, and not before.
    expect(created).toEqual([
      [names.syncedBackup, Object.values(paths.synced)],
      [names.syncedBackupWithoutLog, tabKeys()],
    ]);
    // The backup the server took is left by every pass: its folder is in the store.
    expect(target.orphaned).toEqual([]);
    expect(target.find("Backup", "velero-demo", names.backup)).toBeDefined();
  });

  it("finds the way the store takes a body with the first file, and sends every other file that way and no other", () => {
    const paths = tabArtifactPaths(run);
    const order = tabKeys();
    const archive = emptyArchive().length;
    const left =
      "What it holds of the tabs stays there, and nothing here removes a key: run the command again, or take the " +
      "environment down with `pnpm demo:down`.";
    const ways = (target: Installation) =>
      target.requests.filter((request) => request.method === "PUT").map(({ path, way }) => [path, way]);

    // A store that refuses the first way: the second is tried over the same key, and is the way of the rest.
    const first = installation();

    first.told.answer = ({ method, way }) => (method === "PUT" && way === "upload" ? 403 : undefined);
    // What the way that did not pass met is answered, with the way that did.
    expect(place(first)).toEqual({ state: "stored", written: order, way: "data", met: ["upload: answered 403"] });
    expect(first.requests.slice(1, 4)).toEqual([
      { method: "PUT", path: paths.synced.archive, way: "upload", bytes: archive },
      { method: "PUT", path: paths.synced.archive, way: "data", bytes: archive },
      { method: "HEAD", path: paths.synced.archive },
    ]);
    expect(ways(first).slice(2)).toEqual(order.slice(1).map((path) => [path, "data"]));
    expect(first.recorded.map(({ state, way, sent }) => [state, way, sent])).toEqual([
      ["storing", undefined, 0],
      ["storing", "data", 2],
      ["stored", "data", 12],
    ]);
    // A way the store answers and does not keep whole is not the way either: the length it holds says so.
    const second = installation();

    second.told.answer = ({ method, way }) => (method === "PUT" && way === "upload" ? 400 : undefined);
    second.told.keep = (bytes, way) => (way === "data" ? bytes.subarray(1) : bytes);
    expect(place(second)).toEqual({
      state: "stored",
      written: order,
      way: "signed",
      met: ["upload: answered 400", `data: ${archive - 1} bytes kept of ${archive}`],
    });
    expect(ways(second).slice(0, 4)).toEqual([
      [paths.synced.archive, "upload"],
      [paths.synced.archive, "data"],
      [paths.synced.archive, "signed"],
      [paths.synced.log, "signed"],
    ]);
    expect(second.store.get(paths.synced.archive)).toEqual(emptyArchive());
    // No way: the placement stops on the first file, says what each way met, and sends no other file.
    const third = installation();

    third.told.answer = ({ method }) => (method === "PUT" ? 403 : undefined);
    expect(() => place(third)).toThrow(
      `The store did not keep ${paths.synced.archive} (upload: answered 403; data: answered 403; signed: answered 403). ${left}`,
    );
    expect(ways(third)).toEqual(STORE_WAYS.map((way) => [paths.synced.archive, way]));
    expect(third.placement()).toMatchObject({ state: "storing" });
    expect(third.placement()?.way).toBeUndefined();
    // Nor a store that keeps a part of what it is sent, or nothing of it.
    const fourth = installation();

    fourth.told.keep = (bytes) => bytes.subarray(0, 7);
    expect(() => place(fourth)).toThrow(
      `(upload: 7 bytes kept of ${archive}; data: 7 bytes kept of ${archive}; signed: 7 bytes kept of ${archive})`,
    );
    const fifth = installation();

    fifth.told.answer = ({ method }) => (method === "HEAD" ? 404 : undefined);
    expect(() => place(fifth)).toThrow(
      `(upload: no bytes kept of ${archive}; data: no bytes kept of ${archive}; signed: no bytes kept of ${archive})`,
    );
    // The way that was found is not left for another when a later file is refused: the placement stops
    // there, and the metadata of the folder is not written.
    const sixth = installation();

    sixth.told.answer = ({ method, path }) => (method === "PUT" && path === paths.synced.results ? 500 : undefined);
    expect(() => place(sixth)).toThrow(
      `The store did not keep ${paths.synced.results} (upload: answered 500). ${left}`,
    );
    expect(ways(sixth)).toEqual(order.slice(0, 3).map((path) => [path, "upload"]));
    expect(sixth.store.has(paths.synced.metadata)).toBe(false);
    expect(sixth.placement()).toMatchObject({ state: "storing", way: "upload" });
  });

  it("finds at a second call what the first one did, asks the store nothing and changes nothing", () => {
    const target = installation();

    place(target);
    const requests = target.requests.length;

    // Between the files and the sync every file is in the store: nothing more is written.
    expect(place(target)).toEqual({ state: "stored", written: [], way: "upload", met: [] });
    expect(target.requests).toHaveLength(requests);
    target.sync();
    awaited(target);
    const objects = structuredClone([...target.objects.entries()]);
    const recorded = target.recorded.length;
    const asked = target.asked.length;
    const paused = target.paused.length;

    // With the two backups there, made as the fixtures of today make them: one read of the cluster.
    expect(place(target)).toEqual({ state: "synced", written: [], way: "upload", met: [] });
    expect(target.asked.slice(asked)).toEqual(["get"]);
    // And the wait after it finds them at its first read.
    expect(awaited(target)).toMatchObject({ passes: 0 });
    expect(target.asked.slice(asked)).toEqual(["get", "get"]);
    expect(target.paused).toHaveLength(paused);
    expect(target.requests).toHaveLength(requests);
    expect(target.recorded).toHaveLength(recorded);
    expect([...target.objects.entries()]).toEqual(objects);
    expect(target.changes()).toBe(0);
  });

  it("stops on fixtures that are not the ones in place, and writes nothing beside them", () => {
    const names = fixtureNames(run);
    const down = "take the environment down first, with `pnpm demo:down`";
    const synced = () => {
      const target = installation();

      place(target);
      target.sync();
      awaited(target);
      return target;
    };
    // The placement stops with these words, having asked the store nothing and recorded nothing.
    const stops = (target: Installation, words: string, artifacts = briefArtifacts(SYNCED_STARTED)) => {
      const before = [target.requests.length, target.recorded.length];

      expect(() => place(target, artifacts)).toThrow(words);
      expect([target.requests.length, target.recorded.length]).toEqual(before);
    };
    const labels = (target: Installation, name: string) =>
      target.find("Backup", "velero-demo", name)?.metadata.labels as Record<string, string>;

    // The two backups are in place, and the fixtures of today make them of another log, of one line more.
    stops(
      synced(),
      `The backup ${names.syncedBackup} is not made as the fixtures of today make it: ${down}`,
      briefArtifacts(SYNCED_STARTED, 1001),
    );
    // One of the two says that it is made of something else, while the record is the one of today.
    const other = synced();

    (other.find("Backup", "velero-demo", names.syncedBackupWithoutLog)?.metadata.annotations as Record<string, string>)[
      SHAPE_ANNOTATION
    ] = "0000000000000000";
    stops(other, `The backup ${names.syncedBackupWithoutLog} is not made as the fixtures of today make it: ${down}`);
    // The files are in the store and the server has not made the backups yet: the record says what of.
    const stored = installation();

    place(stored);
    stops(
      stored,
      `The fixtures of the tabs are not the ones this run began to store: ${down}`,
      briefArtifacts(SYNCED_STARTED, 1001),
    );
    // So does a real backup the server filled otherwise than the one the metadata was made like.
    (stored.find("Backup", "velero-demo", names.backup)?.spec as Record<string, unknown>).itemOperationTimeout =
      "1h0m0s";
    stops(stored, `The fixtures of the tabs are not the ones this run began to store: ${down}`);
    // A backup of one of the two names that this run is not recorded to have stored: of another run, of
    // another owner, not one the store was given, or there with no placement on record.
    for (const change of [
      (target: Installation) => {
        labels(target, names.syncedBackupWithoutLog)[FIXTURE_LABEL] = "b1b2b3b4";
      },
      (target: Installation) => {
        labels(target, names.syncedBackupWithoutLog)[OWNER_LABEL] = "another-owner";
      },
      (target: Installation) => {
        labels(target, names.syncedBackupWithoutLog)[FIXTURE_MODE] = "live";
      },
      (target: Installation) => {
        target.objects.delete(`backup/velero-demo/${names.syncedBackup}`);
        target.record(undefined);
      },
    ]) {
      const target = synced();

      change(target);
      stops(
        target,
        `The backup ${names.syncedBackupWithoutLog} of velero-demo is not one this run is recorded to have stored: ${down}`,
      );
    }
    // A placement that is recorded in a state no placement leaves it in.
    const leaving = installation();

    place(leaving);
    leaving.record({ ...leaving.placement(), state: "clearing" } as never);
    stops(leaving, "The fixtures of the tabs are recorded as clearing: a placement does not go on from there");
    expect(() => awaited(leaving)).toThrow(
      "The files of the tabs are not all in the store: the server is not waited for",
    );
  });

  it("reads the installation before it writes: the real backup, the head of its log and its keys, and stores nothing when one of them is not as expected", () => {
    const names = fixtureNames(run);
    const log = fixtureArtifactPaths(run).backupLog;
    // The placement stops with these words: nothing was recorded, and the store was sent no body.
    const stops = (target: Installation, words: string) => {
      expect(() => place(target)).toThrow(words);
      expect(target.recorded).toEqual([]);
      expect(target.requests.filter((request) => request.method !== "GET")).toEqual([]);
    };
    const real = (target: Installation) => target.find("Backup", "velero-demo", names.backup);

    // The real backup expired, and the release deleted it: the two are made like it.
    const expired = installation();

    expired.objects.delete(`backup/velero-demo/${names.backup}`);
    stops(
      expired,
      `The backup ${names.backup} is not in velero-demo: the environment is older than its backup lasts. ` +
        "Create it again with `pnpm demo:down` and `pnpm demo:up`.",
    );
    expect(expired.requests).toEqual([]);
    // One of that name that is not of this run.
    const foreign = installation();

    (real(foreign)?.metadata.labels as Record<string, string>)[FIXTURE_LABEL] = "b1b2b3b4";
    stops(foreign, "Fixture ownership changed");
    expect(foreign.requests).toEqual([]);
    // The log of the real backup is not in the store.
    const silent = installation();

    silent.store.delete(log);
    stops(silent, `The log of the backup ${names.backup} is not in the store, which answered 404`);
    // What the store holds under its key is not in gzip, or unpacks to more than a log of that backup is.
    for (const held of [Buffer.from(REAL_LOG), gz(`${REAL_LOG}${"synthetic line\n".repeat(300_000)}`)]) {
      const other = installation();

      other.store.set(log, held);
      stops(other, `The log of the backup ${names.backup} is not a text in gzip of four mebibytes at most`);
    }
    // One of four mebibytes less a line is unpacked, and read by its first line.
    const large = installation();

    large.store.set(log, gz(`${REAL_LOG}${"synthetic line\n".repeat(279_000)}`));
    expect(place(large).state).toBe("stored");
    // Its first line is not an entry of the keys the fixtures write: the keys are told, and nothing an
    // entry says.
    expect(ENTRY_KEYS).toEqual(["time", "level", "msg", "backup", "logSource"]);
    for (const [line, keys] of [
      [
        '{"backup":"velero-demo/told-nowhere","level":"info","logSource":"pkg/told-nowhere.go:1","msg":"told-nowhere","time":"2026-10-05T09:58:43Z"}',
        "(none)",
      ],
      [
        'time="2026-10-05T09:58:43Z" level=info msg="told-nowhere" backup=velero-demo/told-nowhere cmd=told-nowhere logSource="pkg/told-nowhere.go:1"',
        "time, level, msg, backup, cmd, logSource",
      ],
      [
        'level=info time="2026-10-05T09:58:43Z" msg=told-nowhere backup=velero-demo/told-nowhere logSource="pkg/told-nowhere.go:1"',
        "level, time, msg, backup, logSource",
      ],
      [
        'time="2026-10-05T09:58:43Z" level=info msg="told-nowhere" backup=velero-demo/told-nowhere',
        "time, level, msg, backup",
      ],
      ["Words told-nowhere, and a mark: synthetic=told-nowhere", "(not a name)"],
      // A key is told while it is a name of forty characters at most.
      [
        `time="2026-10-05T09:58:43Z" level=info msg="told-nowhere" ${"k".repeat(40)}=told-nowhere`,
        `time, level, msg, ${"k".repeat(40)}`,
      ],
      [
        `time="2026-10-05T09:58:43Z" level=info msg="told-nowhere" ${"k".repeat(41)}=told-nowhere`,
        "time, level, msg, (not a name)",
      ],
      ["", "(none)"],
    ]) {
      const target = installation();
      let words = "";

      target.store.set(log, gz(`${line}\n${REAL_LOG}`));
      try {
        place(target);
      } catch (error) {
        words = (error as Error).message;
      }
      expect(words).toBe(
        `The log of the backup ${names.backup} begins with an entry of the keys ${keys}, and the log of the ` +
          "fixtures is written with time, level, msg, backup, logSource: it would not be a log of this server",
      );
      expect(target.recorded).toEqual([]);
      expect(target.requests).toEqual([{ method: "GET", path: log }]);
    }
    // The server wrote into the real backup a key the metadata has not.
    const more = installation();

    (real(more)?.status as Record<string, unknown>).syntheticCounter = 1;
    stops(
      more,
      `The metadata of ${names.syncedBackup} has not the keys of the backup the server took: ` +
        "status.syntheticCounter is in the backup the server took alone",
    );
    // The keys one of the two has alone are told by their names, whichever has them, outside the ones by
    // which a backup of everything that failed in part is known to differ from the real one.
    const like = takenBackup();
    const made = syncedBackups("synthetic-owner", run, SYNCED_STARTED, like, heldExpectations(SYNCED_STARTED));
    const { phase: _phase, ...unphased } = made.synced.status as Record<string, unknown>;
    const { storageLocation: _location, ...unplaced } = made.withoutLog.spec as Record<string, unknown>;

    expect([unlikeTheTakenBackup(like, made.synced), unlikeTheTakenBackup(like, made.withoutLog)]).toEqual([[], []]);
    expect(unlikeTheTakenBackup(like, { ...made.synced, status: unphased })).toEqual([
      "status.phase is in the backup the server took alone",
    ]);
    expect(
      unlikeTheTakenBackup(like, {
        ...made.withoutLog,
        spec: { ...unplaced, synthetic: "told-nowhere" },
        status: { ...(made.withoutLog.status as object), failureReason: "told-nowhere" },
      }),
    ).toEqual([
      "spec.storageLocation is in the backup the server took alone",
      "spec.synthetic is in the metadata alone",
      "status.failureReason is in the metadata alone",
    ]);
    // What the release counts of the work of one backup differs freely, and so do the filters of the real
    // backup: neither is told.
    expect(
      unlikeTheTakenBackup(
        {
          ...like,
          spec: {
            ...like.spec,
            orLabelSelectors: [],
            excludedNamespaces: ["synthetic-excluded"],
            includedClusterScopedResources: ["persistentvolumes"],
            includedNamespaceScopedResources: ["configmaps"],
          },
          status: { ...like.status, warnings: 3, backupItemOperationsAttempted: 1, backupItemOperationsFailed: 1 },
        },
        made.withoutLog,
      ),
    ).toEqual([]);
    expect(unlikeTheTakenBackup({ ...like, spec: undefined, status: undefined }, made.synced)).toEqual([
      ...Object.keys(made.synced.spec as object)
        .filter(
          (key) =>
            !["excludedClusterScopedResources", "excludedNamespaceScopedResources", "volumeSnapshotLocations"].includes(
              key,
            ),
        )
        .map((key) => `spec.${key} is in the metadata alone`),
      ...[
        "version",
        "formatVersion",
        "hookStatus",
        "expiration",
        "startTimestamp",
        "completionTimestamp",
        "phase",
        "progress",
      ].map((key) => `status.${key} is in the metadata alone`),
    ]);
  });

  it("goes on from a placement that was interrupted, and writes the files the store does not hold whole", () => {
    const names = fixtureNames(run);
    const paths = tabArtifactPaths(run);
    const order = tabKeys();
    const log = fixtureArtifactPaths(run).backupLog;
    // The runner is stopped while it sends one of the files.
    const interrupted = (path: string) => {
      const target = installation();

      target.told.answer = (request) => {
        if (request.method === "PUT" && request.path === path) throw new Error("Synthetic interruption");
        return undefined;
      };
      expect(() => place(target)).toThrow("Synthetic interruption");
      target.told.answer = undefined;
      return target;
    };
    const target = interrupted(order[3]);

    expect(target.placement()).toMatchObject({ state: "storing", way: "upload" });
    expect([...target.store.keys()].slice(1)).toEqual(order.slice(0, 3));
    // One of the three files that were written is not whole. And the metadata that was recorded is told
    // from the one that would be made now by a line that ends it.
    target.store.set(order[1], (target.store.get(order[1]) ?? Buffer.alloc(0)).subarray(0, 10));
    const began = target.placement() as TabPlacement;
    const metadata = { synced: `${began.metadata.synced}\n`, withoutLog: `${began.metadata.withoutLog}\n` };

    target.record({ ...began, metadata });
    const requests = target.requests.length;

    expect(place(target)).toEqual({
      state: "stored",
      written: [order[1], ...order.slice(3)],
      way: "upload",
      met: [],
    });
    // Each key is asked for first: the ones the store holds with their length are left, and the others
    // are written, the way that was found before.
    expect(target.requests.slice(requests)).toEqual([
      { method: "GET", path: log },
      ...order.flatMap((path, index) => [
        { method: "HEAD", path },
        ...(index === 0 || index === 2
          ? []
          : [
              { method: "PUT", path, way: "upload", bytes: target.store.get(path)?.length },
              { method: "HEAD", path },
            ]),
      ]),
    ]);
    // The metadata that is written is the one that was recorded when the placement began.
    expect([
      target.store.get(paths.synced.metadata)?.toString("utf8"),
      target.store.get(paths.withoutLog.metadata)?.toString("utf8"),
    ]).toEqual([metadata.synced, metadata.withoutLog]);
    expect(target.placement()).toEqual({ ...began, metadata, state: "stored", way: "upload" });
    expect(target.recorded.map(({ state, way }) => [state, way])).toEqual([
      ["storing", undefined],
      ["storing", "upload"],
      ["stored", "upload"],
    ]);
    // The store says a length for a key it does not hold as well, the one of its own answer: a file is left
    // for the length of a key that is there, and never for that one, were the two the same number.
    const lengths = new Map([...target.store.entries()].map(([path, bytes]) => [path, bytes.length]));
    const echoed = interrupted(order[3]);

    echoed.told.missing = (path) => lengths.get(path) ?? 0;
    expect(place(echoed).written).toEqual(order.slice(3));
    expect([...echoed.store.keys()].slice(1)).toEqual(order);
    // Stopped on the first file, before a way was found: the next call finds it.
    const early = interrupted(order[0]);

    expect(early.placement()?.way).toBeUndefined();
    expect(place(early)).toEqual({ state: "stored", written: order, way: "upload", met: [] });
    // Stopped in the second folder, with the first one whole: the server makes a backup of the first, and
    // the placement goes on with the second.
    const half = interrupted(paths.withoutLog.results);

    half.sync();
    expect(half.find("Backup", "velero-demo", names.syncedBackup)).toBeDefined();
    expect(half.find("Backup", "velero-demo", names.syncedBackupWithoutLog)).toBeUndefined();
    expect(place(half)).toEqual({ state: "stored", written: order.slice(7), way: "upload", met: [] });
    half.sync();
    expect(awaited(half).withoutLog.metadata.name).toBe(names.syncedBackupWithoutLog);
    // Stopped after the last file and before it was recorded that every file is there, and the server made
    // the two backups since: the metadata of the second is the last file of all, and nothing is asked.
    const late = installation();

    place(late);
    late.record({ ...(late.placement() as TabPlacement), state: "storing" });
    late.sync();
    const before = late.requests.length;

    expect(place(late)).toEqual({ state: "stored", written: [], way: "upload", met: [] });
    expect(late.requests).toHaveLength(before);
    expect(late.placement()?.state).toBe("stored");
  });

  it("concludes nothing from an answer of the store that says neither that it holds a key nor that it does not, and writes nothing on it", () => {
    const paths = tabArtifactPaths(run);
    const order = tabKeys();
    const archive = emptyArchive().length;
    const unknown = (path: string, what: string) =>
      `The store answered 503 when it was asked whether it holds ${path}: ${what} is not known, and nothing is ` +
      "concluded from it. Run the command again.";
    const puts = (target: Installation) => target.requests.filter((request) => request.method === "PUT").length;
    // A placement that goes on asks first whether the store holds each key: a key it says neither of is not
    // written over, and the placement stops on it, recorded as it was.
    const resumed = installation();

    resumed.told.answer = (request) => {
      if (request.method === "PUT" && request.path === order[3]) throw new Error("Synthetic interruption");
      return undefined;
    };
    expect(() => place(resumed)).toThrow("Synthetic interruption");
    resumed.told.answer = ({ method, path }) => (method === "HEAD" && path === order[1] ? 503 : undefined);
    const sent = puts(resumed);

    expect(() => place(resumed)).toThrow(unknown(order[1], "what it holds of the tabs"));
    expect(puts(resumed)).toBe(sent);
    expect(resumed.placement()).toMatchObject({ state: "storing", way: "upload" });
    // The length the store holds of a file it was just given is asked in the same way: no other way is tried
    // over the key, and no file is written after it.
    const first = installation();

    first.told.answer = ({ method }) => (method === "HEAD" ? 503 : undefined);
    expect(() => place(first)).toThrow(unknown(paths.synced.archive, "what it kept of the file it was given"));
    expect(first.requests.slice(1)).toEqual([
      { method: "PUT", path: paths.synced.archive, way: "upload", bytes: archive },
      { method: "HEAD", path: paths.synced.archive },
    ]);
    expect(first.placement()).toMatchObject({ state: "storing" });
    expect(first.placement()?.way).toBeUndefined();
  });

  it("waits for the sync of the server and reads back the two backups as they were stored", () => {
    const names = fixtureNames(run);
    const target = installation();

    place(target);
    const stored = target.placement() as TabPlacement;
    const began = target.runtime.elapsed();
    const requests = target.requests.length;

    // The next pass of the sync ends a minute and a half later.
    target.pass(began + 90_000);
    const reads = target.logged.length;
    const found = awaited(target);

    // A read every two seconds for minutes: none is kept in the log of the operations.
    expect(target.logged.length - reads).toBeGreaterThan(10);
    expect(new Set(target.logged.slice(reads))).toEqual(new Set([false]));

    // The two objects as the cluster holds them, with what it gave them.
    expect(found.synced).toEqual(target.find("Backup", "velero-demo", names.syncedBackup));
    expect(found.withoutLog).toEqual(target.find("Backup", "velero-demo", names.syncedBackupWithoutLog));
    expect([found.synced.metadata.uid, found.withoutLog.metadata.uid]).toEqual([
      expect.stringMatching(/^uid-\d+$/),
      expect.stringMatching(/^uid-\d+$/),
    ]);
    // The labels of the run, with the one the sync writes; the spec that was stored, with what the server
    // writes of its type beside it; and the status as it was stored, the one of a backup of nothing too.
    expect(found.synced.metadata.labels).toEqual({
      [OWNER_LABEL]: "synthetic-owner",
      [FIXTURE_LABEL]: run,
      [FIXTURE_MODE]: "synced",
      "velero.io/storage-location": "default",
    });
    expect(found.synced.spec).toEqual({ ...JSON.parse(stored.metadata.synced).spec, hooks: {}, metadata: {} });
    expect(found.synced.status).toEqual(JSON.parse(stored.metadata.synced).status);
    expect(found.withoutLog.status).toEqual(JSON.parse(stored.metadata.withoutLog).status);
    expect(found.withoutLog.status).toMatchObject({ phase: "Completed", progress: {} });
    // It read the cluster every two seconds until the read after the pass, and asked the store nothing.
    expect(new Set(target.paused)).toEqual(new Set([2000]));
    expect(found.passes).toBe(0);
    expect(found.waited).toBe(target.runtime.elapsed() - began);
    expect(found.waited).toBeGreaterThanOrEqual(90_000);
    expect(found.waited).toBeLessThan(96_000);
    expect(target.requests).toHaveLength(requests);
    // The placement is recorded as synced, once.
    expect(target.placement()).toEqual({ ...stored, state: "synced" });
    expect(target.recorded.map(({ state }) => state)).toEqual(["storing", "storing", "stored", "synced"]);
    // An object of the name of a backup that is not a backup is not taken for it: a storage location of
    // that name, read before the backups the server then creates, is passed over.
    const namesake = installation();

    place(namesake);
    held(namesake, {
      apiVersion: "velero.io/v1",
      kind: "BackupStorageLocation",
      metadata: { name: names.syncedBackup, namespace: "velero-demo" },
      status: { phase: "Unavailable" },
    });
    namesake.pass(namesake.runtime.elapsed() + 30_000);
    expect(awaited(namesake).synced).toEqual(namesake.find("Backup", "velero-demo", names.syncedBackup));
  });

  it("does not take the first pass that ends after the files for a server that creates nothing: it may have listed the store before them", () => {
    const names = fixtureNames(run);
    const target = installation();
    // A pass of the sync begins: it lists the store, which holds nothing of the tabs yet.
    const listed = target.listing();

    expect(listed).toEqual([names.backup]);
    place(target);
    const began = target.runtime.elapsed();

    // It ends after the files were written, and created nothing. The next one, two minutes later, lists them.
    target.pass(began + 20_000, { listed });
    target.pass(began + 140_000);
    const found = awaited(target);

    expect(found.passes).toBe(1);
    expect(found.waited).toBeGreaterThanOrEqual(140_000);
    expect(found.waited).toBeLessThan(146_000);
    expect(target.placement()?.state).toBe("synced");
    // A pass that ends while the cluster answers a read is seen by that read, and what it created by the
    // next one: the wait does not conclude from the first of the two.
    const torn = installation();
    const before = torn.listing();

    place(torn);
    const from = torn.runtime.elapsed();

    torn.pass(from + 20_000, { listed: before });
    torn.pass(from + 140_000, { during: true });
    expect(awaited(torn)).toMatchObject({ passes: 2 });
    expect(torn.placement()?.state).toBe("synced");
  });

  it("stops when two passes of the sync ended after the files and a backup is not there, and says that the server created none", () => {
    const names = fixtureNames(run);
    const paths = tabArtifactPaths(run);
    const folder = (name: string) => `/velero-demo/backups/${name}/`;
    const target = installation();

    place(target);
    // What the store holds under the key of the metadata of the second backup is not a backup the server
    // reads.
    target.store.set(paths.withoutLog.metadata, gz("{}"));
    const began = target.runtime.elapsed();
    const keys = [...target.store.keys()];
    const requests = target.requests.length;

    for (const minutes of [1, 3, 5]) target.pass(began + minutes * 60_000);
    expect(() => awaited(target)).toThrow(
      `2 passes of the sync ended after the files of the tabs were stored, and ${names.syncedBackupWithoutLog} is ` +
        "not in velero-demo: the server read the store and created no backup from it. What the store was given is " +
        `left in it, under ${folder(names.syncedBackupWithoutLog)}, and nothing here removes a key: the way out is ` +
        "to take the environment down, with `pnpm demo:down`.",
    );
    // It stopped at the read after the one that saw the second pass end, once the store said that it holds
    // the metadata of the backup that is not there.
    expect(target.requests.slice(requests)).toEqual([{ method: "HEAD", path: paths.withoutLog.metadata }]);
    expect(target.runtime.elapsed() - began).toBeGreaterThanOrEqual(180_000);
    expect(target.runtime.elapsed() - began).toBeLessThan(196_000);
    // The first backup is there, the placement is not recorded as synced, and the store holds what it held.
    expect(target.find("Backup", "velero-demo", names.syncedBackup)).toBeDefined();
    expect(target.placement()?.state).toBe("stored");
    expect([...target.store.keys()]).toEqual(keys);
    // Neither of the two: both are named, each with its folder.
    const neither = installation();

    place(neither);
    neither.store.set(paths.synced.metadata, Buffer.from("not a backup"));
    neither.store.set(
      paths.withoutLog.metadata,
      Buffer.from(JSON.stringify({ apiVersion: "velero.io/v1", kind: "Restore", metadata: {} })),
    );
    for (const minutes of [1, 3]) neither.pass(neither.runtime.elapsed() + minutes * 60_000);
    expect(() => awaited(neither)).toThrow(
      `2 passes of the sync ended after the files of the tabs were stored, and ${names.syncedBackup} and ` +
        `${names.syncedBackupWithoutLog} are not in velero-demo: the server read the store and created no backup ` +
        `from it. What the store was given is left in it, under ${folder(names.syncedBackup)} and ` +
        `${folder(names.syncedBackupWithoutLog)}, and nothing here removes a key`,
    );
  });

  it("stops when no pass of the sync ends in five minutes, by the time that went by and not by the number of its reads", () => {
    const names = fixtureNames(run);
    const waited = `${names.syncedBackup} and ${names.syncedBackupWithoutLog} are not in velero-demo`;
    const left =
      `What the store was given is left in it, under /velero-demo/backups/${names.syncedBackup}/ and ` +
      `/velero-demo/backups/${names.syncedBackupWithoutLog}/`;
    const stalled = (cost: number, prepare: (target: Installation, began: number) => void = () => {}) => {
      const target = installation();

      place(target);
      target.cost(cost);
      const began = target.runtime.elapsed();
      const asked = target.asked.length;
      let words = "";

      prepare(target, began);
      try {
        awaited(target);
      } catch (error) {
        words = (error as Error).message;
      }
      expect(target.placement()?.state).toBe("stored");
      expect(new Set(target.paused)).toEqual(new Set([2000]));
      return { words, waited: target.runtime.elapsed() - began, reads: target.asked.length - asked };
    };
    const never =
      `No pass of the sync ended in 5 minutes, and ${waited}: the storage location default is Available and ` +
      `its last pass ended at 2026-10-05T10:04:20Z. ${left}: run the command again once the server syncs.`;

    // A read of four seconds, and one of thirty: the wait is of the same five minutes, in fewer reads, and
    // the store is then asked for the metadata of each backup, which costs what a read does.
    expect(stalled(4000)).toEqual({ words: never, waited: 304_000 + 2 * 4000, reads: 51 });
    expect(stalled(30_000)).toEqual({ words: never, waited: 318_000 + 2 * 30_000, reads: 10 });
    // The five minutes are counted from the last pass that ended: one that created nothing, three minutes
    // in, is followed by five minutes more.
    const once = stalled(4000, (target, began) => {
      for (const metadata of [tabArtifactPaths(run).synced.metadata, tabArtifactPaths(run).withoutLog.metadata])
        target.store.set(metadata, Buffer.from("not a backup"));
      target.pass(began + 180_000);
    });

    expect(once.words).toContain("No pass of the sync ended in 5 minutes");
    expect(once.words).toContain("its last pass ended at 2026-10-05T10:09:");
    expect(once.waited).toBeGreaterThanOrEqual(480_000);
    expect(once.waited).toBeLessThan(492_000 + 2 * 4000);
    // A location that never told of a pass.
    const untold = stalled(4000, (target) => {
      const status = target.find("BackupStorageLocation", "velero-demo", "default")?.status as
        | { lastSyncedTime?: string }
        | undefined;

      delete status?.lastSyncedTime;
    });

    expect(untold.words).toContain("is Available and its last pass ended at no time it tells");
    // A location that is not available is passed over by the sync, which looks at it every minute: the
    // words say so. So do they of one that is in no phase, and of one that is not there.
    const passedOver = (phase: string | undefined) =>
      stalled(4000, (target, began) => {
        const location = target.find("BackupStorageLocation", "velero-demo", "default");

        if (phase === "gone") target.objects.delete("backupstoragelocation/velero-demo/default");
        else (location?.status as { phase?: string }).phase = phase;
        for (let minute = 1; minute < 8; minute += 1) target.pass(began + minute * 60_000);
      });
    const over = (told: string) =>
      `The storage location default is ${told}, and the sync passes over a location that is not Available: no ` +
      `pass ended in 5 minutes, and ${waited}. ${left}: run the command again once the location is Available.`;

    expect(passedOver("Unavailable")).toEqual({ words: over("Unavailable"), waited: 304_000 + 2 * 4000, reads: 51 });
    expect(passedOver(undefined).words).toBe(over("in no phase"));
    expect(passedOver("gone").words).toBe(over("not there"));
  });

  it("goes on waiting while the storage location is not available, and finds the backups once the sync passes again", () => {
    const target = installation();

    place(target);
    const began = target.runtime.elapsed();
    const status = target.find("BackupStorageLocation", "velero-demo", "default")?.status as { phase: string };

    // The location is not available for two minutes, and the sync passes over it; then it is, and the pass
    // after that creates the two backups.
    status.phase = "Unavailable";
    for (const minutes of [1, 2, 3]) target.pass(began + minutes * 60_000);
    const found = awaitTabFixtures(
      {
        ...target.runtime,
        pause(milliseconds: number) {
          target.runtime.pause(milliseconds);
          if (target.runtime.elapsed() - began > 130_000) status.phase = "Available";
        },
      } as never,
      run,
    );

    expect(found.waited).toBeGreaterThanOrEqual(180_000);
    expect(found.waited).toBeLessThan(186_000);
    expect(target.placement()?.state).toBe("synced");
  });

  it("refuses a backup the server did not create as it was stored", () => {
    const names = fixtureNames(run);
    // The server creates what `change` makes of the backup of that name, and the readback stops with these
    // words: the placement is not recorded as synced.
    const refuses = (name: string, change: (backup: Created) => void, words: string) => {
      const target = installation();

      place(target);
      target.sync({
        made: (backup) => {
          if (backup.metadata.name === name) change(backup as unknown as Created);
          return backup;
        },
      });
      expect([words, stopped(() => awaited(target))]).toEqual([words, words]);
      expect(target.placement()?.state).toBe("stored");
    };
    const first = names.syncedBackup;
    const second = names.syncedBackupWithoutLog;
    // What stays, and the way on. The removal of the tabs asks nothing of what a backup says, and has the
    // server delete it with its files; it does not ask the deletion of a backup that is not of this run.
    const stays =
      "The two backups and the files the store was given for them are left as they are: clean the run with " +
      "`node e2e/scripts/local-demo.mts fixtures-cleanup --context kind-freelens-velero-dev`, or take the " +
      "environment down with `pnpm demo:down`.";
    const down =
      "It is left as it is, with the files the store was given: the way out is to take the environment down, " +
      "with `pnpm demo:down`.";

    for (const label of [OWNER_LABEL, FIXTURE_LABEL, FIXTURE_MODE]) {
      refuses(
        first,
        (backup) => {
          delete backup.metadata.labels[label];
        },
        `The backup ${first} the server created does not carry the labels of this run. ${down}`,
      );
      refuses(
        second,
        (backup) => {
          backup.metadata.labels[label] = "another";
        },
        `The backup ${second} the server created does not carry the labels of this run. ${down}`,
      );
    }
    // The location it was found in: the label the sync writes, and the spec.
    refuses(
      second,
      (backup) => {
        backup.metadata.labels["velero.io/storage-location"] = "another";
      },
      `The backup ${second} the server created is not of the storage location default. ${down}`,
    );
    refuses(
      first,
      (backup) => {
        backup.spec.storageLocation = "another";
      },
      `The spec of the synced backup ${first} does not keep what was stored of storageLocation. ${stays}`,
    );
    refuses(
      first,
      (backup) => {
        delete backup.metadata.annotations[SHAPE_ANNOTATION];
      },
      `The backup ${first} the server created does not say what it is made of. ${stays}`,
    );
    // A key of the spec the server did not keep, or kept with another value.
    refuses(
      first,
      (backup) => {
        delete backup.spec.volumeSnapshotLocations;
        backup.spec.ttl = "720h0m0s";
      },
      `The spec of the synced backup ${first} does not keep what was stored of ttl, volumeSnapshotLocations. ${stays}`,
    );
    refuses(
      second,
      (backup) => {
        backup.spec.labelSelector = {};
      },
      `The spec of the synced backup ${second} does not keep what was stored of labelSelector. ${stays}`,
    );
    // A status with a counter less, with one more, with another progress, and the one of a backup a
    // controller took and failed: the keys that are not as they were stored are told by their names, and
    // nothing of what they hold.
    for (const [name, change, keys] of [
      [
        first,
        (backup: Created) => {
          delete backup.status.warnings;
        },
        "warnings",
      ],
      [
        first,
        (backup: Created) => {
          backup.status.backupItemOperationsFailed = 1;
        },
        "backupItemOperationsFailed",
      ],
      [
        second,
        (backup: Created) => {
          delete backup.status.progress;
        },
        "progress",
      ],
      [
        second,
        (backup: Created) => {
          backup.status.progress = { totalItems: 1, itemsBackedUp: 1 };
        },
        "progress",
      ],
      [
        second,
        (backup: Created) => {
          backup.status.phase = "Failed";
          backup.status.failureReason = "a synthetic reason, which is not repeated";
          delete backup.status.completionTimestamp;
        },
        "completionTimestamp, phase, failureReason",
      ],
    ] as const) {
      refuses(
        name,
        change,
        `The status of the synced backup ${name} is not the one that was stored: it differs by ${keys}. ${stays}`,
      );
    }
  });

  it("tells a backup of the tabs that went with its files from one the server did not create, and says the way on", () => {
    const names = fixtureNames(run);
    const paths = tabArtifactPaths(run);
    const clean = "`node e2e/scripts/local-demo.mts fixtures-cleanup --context kind-freelens-velero-dev`";
    const went = (backups: string, both = false) =>
      `${backups} ${both ? "are" : "is"} not in velero-demo, and the store does not hold the metadata the server ` +
      `makes ${both ? "them" : "it"} from: a backup the server deleted goes with its files. The fixtures of the ` +
      `tabs are not whole any more: clean the run with ${clean}, and make a new one with \`pnpm demo:up\`.`;
    // The two backups were synced, and the first was then deleted through the server: the object and the
    // six files of its folder are gone.
    const deleted = () => {
      const target = installation();

      place(target);
      target.sync();
      awaited(target);
      target.objects.delete(`backup/velero-demo/${names.syncedBackup}`);
      for (const path of Object.values(paths.synced)) target.store.delete(path);
      return target;
    };
    const target = deleted();
    const requests = target.requests.length;
    const began = target.runtime.elapsed();

    // The placement finds its record and asks the store nothing. The wait reads the cluster once, asks the
    // store whether it holds the metadata of the backup that is not there, and stops at once: it does not
    // wait two passes for a server that has nothing to create a backup from.
    expect(place(target)).toMatchObject({ state: "synced", written: [] });
    expect(stopped(() => awaited(target))).toBe(went(names.syncedBackup));
    expect(target.requests.slice(requests)).toEqual([{ method: "HEAD", path: paths.synced.metadata }]);
    expect(target.paused).toEqual([]);
    expect(target.runtime.elapsed() - began).toBe(12_000);
    expect(target.placement()?.state).toBe("synced");
    // Both, told together.
    const both = deleted();

    both.objects.delete(`backup/velero-demo/${names.syncedBackupWithoutLog}`);
    for (const path of Object.values(paths.withoutLog)) both.store.delete(path);
    expect(stopped(() => awaited(both))).toBe(went(`${names.syncedBackup} and ${names.syncedBackupWithoutLog}`, true));
    // A backup that was removed from the cluster alone, with its files left, is one the server creates
    // again: the store is asked once, and the server is waited for.
    const again = installation();

    place(again);
    again.sync();
    awaited(again);
    again.objects.delete(`backup/velero-demo/${names.syncedBackup}`);
    const asked = again.requests.length;

    again.pass(again.runtime.elapsed() + 90_000);
    expect(awaited(again).synced.metadata.name).toBe(names.syncedBackup);
    expect(again.requests.slice(asked)).toEqual([{ method: "HEAD", path: paths.synced.metadata }]);
    // Files that were stored and went before the server made a backup of them: the wait is the one of a
    // first placement, and its verdict asks the store before it says what the server did.
    const lost = installation();

    place(lost);
    for (const path of Object.values(paths.withoutLog)) lost.store.delete(path);
    for (const minutes of [1, 2, 3]) lost.pass(lost.runtime.elapsed() + minutes * 60_000);
    const before = lost.requests.length;

    expect(stopped(() => awaited(lost))).toBe(went(names.syncedBackupWithoutLog));
    expect(lost.requests.slice(before)).toEqual([{ method: "HEAD", path: paths.withoutLog.metadata }]);
    expect(lost.runtime.elapsed()).toBeGreaterThan(120_000);
    // A metadata that is there, and no backup of it after two passes: the words are of a server that read
    // the store and created nothing, as they were.
    const unread = installation();

    place(unread);
    unread.store.set(paths.withoutLog.metadata, Buffer.from("not a backup"));
    for (const minutes of [1, 2, 3]) unread.pass(unread.runtime.elapsed() + minutes * 60_000);
    expect(stopped(() => awaited(unread))).toBe(
      `2 passes of the sync ended after the files of the tabs were stored, and ${names.syncedBackupWithoutLog} ` +
        "is not in velero-demo: the server read the store and created no backup from it. What the store was " +
        `given is left in it, under /velero-demo/backups/${names.syncedBackupWithoutLog}/, and nothing here ` +
        "removes a key: the way out is to take the environment down, with `pnpm demo:down`.",
    );
    // A store that does not say whether it holds the metadata says nothing of what became of the backup.
    const silent = deleted();

    silent.told.answer = ({ method }) => (method === "HEAD" ? 503 : undefined);
    expect(stopped(() => awaited(silent))).toBe(
      `The store answered 503 when it was asked whether it holds ${paths.synced.metadata}: what became of the ` +
        `backup ${names.syncedBackup} is not known, and nothing is concluded from it. Run the command again.`,
    );
  });

  it("waits for no server before every file is in the store, and needs the clock and the record of the runtime", () => {
    const target = installation();
    const words = "The files of the tabs are not all in the store: the server is not waited for";

    // Nothing was placed, and then a placement was interrupted before its last file.
    expect(() => awaited(target)).toThrow(words);
    target.told.answer = ({ method, path }) => {
      if (method === "PUT" && path === tabArtifactPaths(run).withoutLog.metadata) throw new Error("Synthetic stop");
      return undefined;
    };
    expect(() => place(target)).toThrow("Synthetic stop");
    expect(target.placement()?.state).toBe("storing");
    expect(() => awaited(target)).toThrow(words);
    expect(target.paused).toEqual([]);
    // A runtime that has no clock, no record of the placement, or no store.
    const { elapsed: _elapsed, ...clockless } = target.runtime;
    const { tabs: _tabs, ...unrecorded } = target.runtime;
    const { store: _store, ...storeless } = target.runtime;
    const needs =
      "The wait for the backups of the tabs needs the store of the environment, the clock of the runtime, and " +
      "where their placement is recorded";
    const stores = "The fixtures of the tabs need the store of the environment, and where their placement is recorded";

    for (const runtime of [clockless, unrecorded, storeless])
      expect(stopped(() => awaitTabFixtures(runtime as never, run))).toBe(needs);
    for (const runtime of [unrecorded, storeless])
      expect(() => storeTabFixtures(runtime as never, run, SYNCED_STARTED, briefArtifacts(SYNCED_STARTED))).toThrow(
        stores,
      );
    // A record whose metadata is not of the two backups of this run: the second of another name, or of no
    // name, and the first of no storage location.
    const other = installation();

    place(other);
    const recorded = other.placement() as TabPlacement;
    const { storageLocation: _location, ...unplaced } = JSON.parse(recorded.metadata.synced).spec;

    for (const metadata of [
      { ...recorded.metadata, withoutLog: recorded.metadata.synced },
      { ...recorded.metadata, withoutLog: "{}" },
      { ...recorded.metadata, synced: JSON.stringify({ ...JSON.parse(recorded.metadata.synced), spec: unplaced }) },
    ]) {
      other.record({ ...recorded, metadata });
      expect(() => awaited(other)).toThrow(
        "The metadata that is recorded is not the one of the two backups of this run",
      );
    }
    expect(other.paused).toEqual([]);
  });

  it("has a pretend server that syncs as the release does: a backup from a metadata file, and from nothing else", () => {
    const names = fixtureNames(run);
    const target = installation();
    const key = (name: string) => `/velero-demo/backups/${name}/velero-backup.json`;
    // A metadata file with what the cluster of another installation gave the backup, a status as no
    // release writes it, and keys the type of a backup does not have.
    const metadata = (name: string, more: object = {}) =>
      Buffer.from(
        JSON.stringify({
          apiVersion: "velero.io/v1",
          kind: "Backup",
          metadata: {
            name,
            namespace: "another-namespace",
            uid: "uid-of-another-cluster",
            resourceVersion: "77",
            generation: 4,
            creationTimestamp: "2020-01-01T00:00:00Z",
            labels: { "fixtures.synthetic.example/kept": "yes", "velero.io/storage-location": "another-location" },
            annotations: { "fixtures.synthetic.example/kept": "yes" },
          },
          spec: { storageLocation: "another-location", includedNamespaces: ["*"], ttl: "720h0m0s", untyped: true },
          status: {
            phase: "Completed",
            expiration: "2099-01-01T00:00:00.789Z",
            startTimestamp: "2026-01-01T01:00:00+01:00",
            errors: 0,
            warnings: 3,
            failureReason: "",
            validationErrors: [],
            progress: { totalItems: 0 },
            hookStatus: {},
            untyped: 1,
          },
          ...more,
        }),
      );
    const backup = (name: string) => target.find("Backup", "velero-demo", name);
    const location = () =>
      target.find("BackupStorageLocation", "velero-demo", "default")?.status as {
        phase: string;
        lastSyncedTime: string;
      };

    // A folder that holds files and no metadata is left, and the pass that listed it says when it ended.
    target.store.set("/velero-demo/backups/synthetic-a/synthetic-a.tar.gz", emptyArchive());
    target.sync();
    expect(backup("synthetic-a")).toBeUndefined();
    expect(location().lastSyncedTime).toBe("2026-10-05T10:05:00Z");
    // With its metadata the backup is created, through the type of the release: in the namespace of the
    // installation and of its storage location, with what the cluster gives an object, its labels and its
    // annotations kept, no key the type has not, no number of zero, a time to the second.
    target.store.set(key("synthetic-a"), metadata("synthetic-a"));
    target.runtime.pause(61_500);
    target.sync();
    expect(backup("synthetic-a")).toEqual({
      apiVersion: "velero.io/v1",
      kind: "Backup",
      metadata: {
        name: "synthetic-a",
        namespace: "velero-demo",
        uid: expect.stringMatching(/^uid-\d+$/),
        resourceVersion: "1",
        creationTimestamp: expect.stringMatching(/^2026-10-05T10:05:\d\dZ$/),
        labels: { "fixtures.synthetic.example/kept": "yes", "velero.io/storage-location": "default" },
        annotations: { "fixtures.synthetic.example/kept": "yes" },
      },
      spec: {
        metadata: {},
        hooks: {},
        csiSnapshotTimeout: "0s",
        itemOperationTimeout: "0s",
        ttl: "720h0m0s",
        includedNamespaces: ["*"],
        storageLocation: "default",
      },
      status: {
        phase: "Completed",
        expiration: "2099-01-01T00:00:00Z",
        startTimestamp: "2026-01-01T00:00:00Z",
        warnings: 3,
        progress: {},
        hookStatus: {},
      },
    });
    expect(location().lastSyncedTime).toBe("2026-10-05T10:06:01Z");
    // A backup the cluster has is left as it is by the passes after.
    const uid = backup("synthetic-a")?.metadata.uid;

    target.sync();
    expect(backup("synthetic-a")?.metadata.uid).toBe(uid);
    // Nor is its folder read again, whatever the metadata in it names; and the metadata of another folder
    // that gives its name creates nothing over it.
    target.store.set(key(names.backup), metadata("synthetic-other"));
    target.store.set(key("synthetic-twin"), metadata("synthetic-a"));
    target.sync();
    expect(target.order).not.toContain("backup/velero-demo/synthetic-other");
    expect(backup("synthetic-a")?.metadata.uid).toBe(uid);
    target.store.delete(key("synthetic-twin"));
    // What is not a backup of its version is left: a file in gzip, another kind, another version, an object
    // of no kind; and so is what the cluster refuses, and a backup the server is still working on.
    const left: [string, Buffer][] = [
      ["synthetic-gzip", gz(metadata("synthetic-gzip"))],
      ["synthetic-restore", metadata("synthetic-restore", { kind: "Restore" })],
      ["synthetic-version", metadata("synthetic-version", { apiVersion: "velero.io/v2" })],
      ["synthetic-untyped", metadata("synthetic-untyped", { apiVersion: undefined, kind: undefined })],
      ["synthetic-phase", metadata("synthetic-phase", { status: { phase: "Finished" } })],
      [
        "synthetic-waiting",
        metadata("synthetic-waiting", {
          status: { phase: "WaitingForPluginOperations", expiration: "2099-01-01T00:00:00Z" },
        }),
      ],
      ["synthetic-finalizing", metadata("synthetic-finalizing", { status: { phase: "FinalizingPartiallyFailed" } })],
    ];

    for (const [name, bytes] of left) target.store.set(key(name), bytes);
    target.sync();
    expect(left.map(([name]) => backup(name))).toEqual(left.map(() => undefined));
    // One the server was working on that expired is created as a backup that failed in part.
    target.store.set(
      key("synthetic-expired"),
      metadata("synthetic-expired", { status: { phase: "Finalizing", expiration: "2026-10-05T10:00:00Z" } }),
    );
    target.sync();
    expect(backup("synthetic-expired")?.status).toEqual({
      phase: "PartiallyFailed",
      expiration: "2026-10-05T10:00:00Z",
    });
    // A backup is created under the name its metadata gives it, not the one of its folder: it is a backup
    // of no folder, which the same pass removes.
    target.store.set(key("synthetic-folder"), metadata("synthetic-named"));
    target.sync();
    expect(target.order).toContain("backup/velero-demo/synthetic-named");
    expect(target.order).not.toContain("backup/velero-demo/synthetic-folder");
    expect(target.orphaned).toEqual(["backup/velero-demo/synthetic-named"]);
    // A backup of the location that ended, completed or in part, whose folder is gone is removed. The ones
    // whose folder is there are left, the real one among them; and so are one that failed and one that is
    // of no location, though no folder is theirs.
    target.store.set(key("synthetic-failed"), metadata("synthetic-failed", { status: { phase: "Failed" } }));
    target.sync();
    target.runtime.apply({
      kind: "Backup",
      metadata: { name: "synthetic-unlabelled", namespace: "velero-demo" },
      status: { phase: "Completed" },
    } as never);
    for (const gone of [
      key("synthetic-a"),
      "/velero-demo/backups/synthetic-a/synthetic-a.tar.gz",
      key("synthetic-failed"),
    ])
      target.store.delete(gone);
    const removed = target.orphaned.length;

    target.sync();
    expect(backup("synthetic-a")).toBeUndefined();
    expect(target.orphaned.slice(removed)).toEqual([
      "backup/velero-demo/synthetic-a",
      "backup/velero-demo/synthetic-named",
    ]);
    expect(
      [names.backup, "synthetic-expired", "synthetic-failed", "synthetic-unlabelled"].map((name) =>
        Boolean(backup(name)),
      ),
    ).toEqual([true, true, true, true]);
    // A location that is not available is passed over: nothing is created, and it tells of no pass.
    const told = location().lastSyncedTime;

    location().phase = "Unavailable";
    target.store.set(key("synthetic-b"), metadata("synthetic-b"));
    target.runtime.pause(61_500);
    target.sync();
    expect([backup("synthetic-b"), location().lastSyncedTime]).toEqual([undefined, told]);
    location().phase = "Available";
    target.sync();
    expect(backup("synthetic-b")).toBeDefined();
    expect(location().lastSyncedTime).not.toBe(told);
    // A backup that did not end is one a controller of the release takes: the pretend server has none. Nor
    // does it play what the release and the cluster do with the owners and the finalizers of a backup.
    target.store.set(key("synthetic-new"), metadata("synthetic-new", { status: {} }));
    expect(() => target.sync()).toThrow("The pretend cluster has no controller for a backup that did not end");
    target.store.delete(key("synthetic-new"));
    for (const more of [{ ownerReferences: [] }, { finalizers: ["fixtures.synthetic.example/kept"] }]) {
      target.store.set(
        key("synthetic-owned"),
        metadata("synthetic-owned", { metadata: { name: "synthetic-owned", ...more } }),
      );
      expect(() => target.sync()).toThrow("The pretend cluster does not play the owners or the finalizers of a backup");
    }
    target.store.delete(key("synthetic-owned"));
    // Nor the pod volume backups the release creates from the list a folder holds, once it created the
    // backup of that folder: a list in the folder of a backup the cluster has is not read.
    target.store.set(key("synthetic-volumes"), metadata("synthetic-volumes"));
    target.store.set("/velero-demo/backups/synthetic-volumes/synthetic-volumes-podvolumebackups.json.gz", gz("[]"));
    target.store.set("/velero-demo/backups/synthetic-b/synthetic-b-podvolumebackups.json.gz", gz("[]"));
    expect(() => target.sync()).toThrow("The pretend cluster creates no pod volume backup from the folder of a backup");
    expect(backup("synthetic-volumes")).toBeUndefined();
    target.store.delete("/velero-demo/backups/synthetic-volumes/synthetic-volumes-podvolumebackups.json.gz");
    target.sync();
    expect(backup("synthetic-volumes")).toBeDefined();
  });

  // What the controllers of the release write into the three operations the server refuses: the reason each
  // is made for, and for the restore of a schedule without a backup the two things the release says of it.
  const REFUSED = {
    backup: { phase: "FailedValidation", validationErrors: [REFUSALS.backup] },
    restore: { phase: "FailedValidation", validationErrors: [REFUSALS.restore] },
    orphan: {
      phase: "FailedValidation",
      validationErrors: [REFUSALS.orphan, "No completed backups found for schedule"],
    },
  };
  // A controller writes a status into an operation of the installation when the time of the runtime reaches
  // a moment, if the operation is there by then.
  const writes = (target: Installation, at: number, kind: string, name: string, status: object) =>
    target.at(at, () => {
      const found = target.find(kind, "velero-demo", name);

      if (found) found.status = structuredClone(status);
    });
  const refused = (target: Installation, runtime: object = target.runtime) =>
    placeRefusedFixtures(runtime as never, run);

  it("places the operations the server refuses once, and waits until each is refused for its reason, a backup through its queue", () => {
    const names = fixtureNames(run);
    const target = installation();
    const before = target.applied.length;
    const keys = [
      `backup/velero-demo/${names.invalidBackup}`,
      `restore/velero-demo/${names.invalidRestore}`,
      `restore/velero-demo/${names.orphanRestore}`,
    ];

    // The restore is refused at once. The backup goes through the queue of the release first, and the
    // restore of a schedule without a backup is the last the server looks at.
    writes(target, 6000, "Restore", names.invalidRestore, REFUSED.restore);
    writes(target, 10_000, "Backup", names.invalidBackup, { phase: "Queued", queuePosition: 1 });
    writes(target, 15_000, "Backup", names.invalidBackup, { phase: "ReadyToStart" });
    writes(target, 20_000, "Backup", names.invalidBackup, REFUSED.backup);
    writes(target, 30_000, "Restore", names.orphanRestore, REFUSED.orphan);
    const placed = refused(target);

    // It read the backups and the restores of the installation, applied the three, and read again every
    // second until the read that found the last of them refused.
    expect(placed.applied).toEqual([names.invalidBackup, names.invalidRestore, names.orphanRestore]);
    expect(target.applied.slice(before)).toEqual(keys);
    expect(target.asked).toEqual(Array(7).fill("get"));
    expect(target.paused).toEqual(Array(5).fill(1000));
    // Every read is in the log of the operations: a refusal for another reason is read there.
    expect(target.logged).toEqual(Array(7).fill(true));
    // The time the server took is the one of the runtime, from the moment the three were applied.
    expect(placed.waited).toBe(29_000);
    // Each as the cluster holds it, with the identity it gave it and what the server wrote.
    expect([placed.backup, placed.restore, placed.orphan]).toEqual(keys.map((key) => target.objects.get(key)));
    expect([placed.backup.metadata.uid, placed.restore.metadata.uid, placed.orphan.metadata.uid]).toEqual([
      expect.stringMatching(/^uid-\d+$/),
      expect.stringMatching(/^uid-\d+$/),
      expect.stringMatching(/^uid-\d+$/),
    ]);
    expect([placed.backup.status, placed.restore.status, placed.orphan.status]).toEqual([
      REFUSED.backup,
      REFUSED.restore,
      REFUSED.orphan,
    ]);
    // A second call reads once, finds the three refused, applies nothing and waits for nothing.
    const objects = structuredClone([...target.objects.entries()]);

    expect(refused(target)).toEqual({ ...placed, applied: [], waited: 0 });
    expect(target.applied.slice(before)).toEqual(keys);
    expect(target.asked).toHaveLength(8);
    expect(target.paused).toHaveLength(5);
    expect(target.changes()).toBe(0);
    expect([...target.objects.entries()]).toEqual(objects);
    // A call that was interrupted left one of the three, which the server has not validated yet: it is not
    // applied again, and it is waited for with the two that were not there.
    const interrupted = installation();

    interrupted.runtime.apply(refusedFixtures("synthetic-owner", run).backup);
    writes(interrupted, 6000, "Backup", names.invalidBackup, { phase: "Queued", queuePosition: 1 });
    writes(interrupted, 12_000, "Backup", names.invalidBackup, REFUSED.backup);
    writes(interrupted, 12_000, "Restore", names.invalidRestore, REFUSED.restore);
    writes(interrupted, 12_000, "Restore", names.orphanRestore, REFUSED.orphan);
    expect(refused(interrupted)).toMatchObject({ applied: [names.invalidRestore, names.orphanRestore], waited: 9000 });
    expect(interrupted.applied.slice(before + 1)).toEqual(keys.slice(1));
  });

  it("applies none of the operations the server refuses when one that is there is not the fixture it was made to be", () => {
    const names = fixtureNames(run);
    const manifests = refusedFixtures("synthetic-owner", run);
    // The installation with one of the three in it, as `made` gives it: the call stops with these words
    // after its one read, and applies nothing.
    const stops = (made: KubeResource & { status?: object }, words: string) => {
      const target = installation();

      target.objects.set(`${made.kind.toLowerCase()}/velero-demo/${made.metadata.name}`, {
        ...structuredClone(made),
        metadata: { ...structuredClone(made.metadata), uid: "synthetic-uid", resourceVersion: "7" },
      });
      const applied = target.applied.length;
      const objects = structuredClone([...target.objects.entries()]);

      expect(() => refused(target)).toThrow(words);
      expect(target.applied).toHaveLength(applied);
      expect(target.asked).toEqual(["get"]);
      expect(target.paused).toEqual([]);
      expect([...target.objects.entries()]).toEqual(objects);
    };
    const labelled = (resource: KubeResource, labels: Record<string, string>) => ({
      ...resource,
      metadata: { ...resource.metadata, labels: { ...resource.metadata.labels, ...labels } },
      status: REFUSED.backup,
    });

    // Refused for another reason, or in a phase the server gives to what it did not refuse.
    stops(
      { ...manifests.backup, status: { phase: "FailedValidation", validationErrors: ["another reason"] } },
      "Refused Backup failed its validation for another reason",
    );
    stops(
      { ...manifests.restore, status: { phase: "Completed" } },
      "Refused Restore is Completed where it was expected to fail its validation",
    );
    stops(
      { ...manifests.orphan, status: { phase: "InProgress" } },
      "Refused Restore is InProgress where it was expected to fail its validation",
    );
    // Of another owner, or of another run of this one: an object the run did not make is not taken for its own.
    stops(labelled(manifests.backup, { [OWNER_LABEL]: "another-owner" }), "Fixture ownership changed");
    stops(labelled(manifests.backup, { [FIXTURE_LABEL]: "0f0f0f0f" }), "Fixture ownership changed");
    // The restore that is refused for its selectors is asked of the real backup, which is to be valid: without
    // it as the server completed it, of this run, nothing is applied.
    const without = (change: (target: Installation) => void) => {
      const target = installation();
      const applied = target.applied.length;

      change(target);
      expect(() => refused(target)).toThrow(
        `The backup ${names.backup} of this run is not in velero-demo as the server completed it, and the restore ` +
          "that is refused for its selectors is asked of it. Create the environment again with `pnpm demo:down` " +
          "and `pnpm demo:up`.",
      );
      expect(target.applied).toHaveLength(applied);
      expect(target.asked).toEqual(["get"]);
    };
    const real = (target: Installation) =>
      target.find("Backup", "velero-demo", names.backup) as {
        metadata: { labels: Record<string, string> };
        status: { phase: string };
      };

    without((target) => target.objects.delete(`backup/velero-demo/${names.backup}`));
    // A restore of its name, of this run and completed, is not that backup.
    without((target) => {
      const backup = real(target);

      target.objects.delete(`backup/velero-demo/${names.backup}`);
      target.objects.set(`restore/velero-demo/${names.backup}`, { ...backup, kind: "Restore" } as never);
    });
    without((target) => {
      real(target).status.phase = "Deleting";
    });
    without((target) => {
      real(target).metadata.labels[OWNER_LABEL] = "another-owner";
    });
    without((target) => {
      real(target).metadata.labels[FIXTURE_LABEL] = "0f0f0f0f";
    });
    // The wait is of the time the runtime counts: without its clock nothing is read and nothing applied.
    const clockless = installation();

    expect(() => refused(clockless, { ...clockless.runtime, elapsed: undefined })).toThrow(
      "The wait for the operations the server refuses needs the clock of the runtime",
    );
    expect(clockless.asked).toEqual([]);
    // A restore of a schedule without a backup that the server gave a backup is not that restore.
    const named = installation();

    writes(named, 6000, "Backup", names.invalidBackup, REFUSED.backup);
    writes(named, 6000, "Restore", names.invalidRestore, REFUSED.restore);
    named.at(6000, () => {
      const orphan = named.find("Restore", "velero-demo", names.orphanRestore);

      if (!orphan) return;
      orphan.spec = { ...(orphan.spec as object), backupName: names.backup };
      orphan.status = REFUSED.orphan;
    });
    expect(() => refused(named)).toThrow("The restore of a schedule without a backup names a backup");
  });

  it("stops when the server does not refuse an operation in two minutes, by the time that went by, and says which and where each is", () => {
    const names = fixtureNames(run);
    const left =
      "What was applied is left in velero-demo, of this run: run the command again once the server validates it.";
    const stalled = (cost: number, prepare: (target: Installation) => void = () => {}) => {
      const target = installation();
      let words = "";

      target.cost(cost);
      prepare(target);
      try {
        refused(target);
      } catch (error) {
        words = (error as Error).message;
      }
      expect(new Set(target.paused)).toEqual(new Set([1000]));
      return { words, elapsed: target.runtime.elapsed(), reads: target.asked.length };
    };
    const never =
      `The server did not refuse in 2 minutes what it was asked to: the backup ${names.invalidBackup} has no ` +
      `phase, the restore ${names.invalidRestore} has no phase, the restore ${names.orphanRestore} has no phase. ${left}`;

    // A read of four seconds, and one of thirty: the wait is of the same two minutes, in fewer reads.
    expect(stalled(4000)).toEqual({ words: never, elapsed: 128_000, reads: 26 });
    expect(stalled(30_000)).toEqual({ words: never, elapsed: 153_000, reads: 5 });
    // The ones the server refused are not named, and each of the others is told by where it is: in the
    // queue of the release, or gone from the cluster.
    const some = stalled(4000, (target) => {
      writes(target, 6000, "Restore", names.invalidRestore, REFUSED.restore);
      writes(target, 10_000, "Backup", names.invalidBackup, { phase: "Queued", queuePosition: 1 });
      target.at(10_000, () => target.objects.delete(`restore/velero-demo/${names.orphanRestore}`));
    });

    expect(some.words).toBe(
      `The server did not refuse in 2 minutes what it was asked to: the backup ${names.invalidBackup} is Queued, ` +
        `the restore ${names.orphanRestore} is not there. ${left}`,
    );
  });

  it("stores the files of the tabs first, places the fixtures of the views and the operations the server refuses meanwhile, and waits for the server last", () => {
    const names = fixtureNames(run);
    const target = installation();
    const now = Date.parse("2026-10-05T10:06:00Z");
    const three = [names.invalidBackup, names.invalidRestore, names.orphanRestore];
    // Every file the store is sent, every object the cluster is asked to hold and every read of the wait
    // for the sync, in their order.
    const events: string[] = [];
    // The server refuses each of the three operations three seconds after it is applied, and its sync
    // passes once, a minute and a half after the last of them, or after the first read of the wait when
    // that comes before.
    let passing = false;
    const pass = () => {
      if (!passing) target.pass(target.runtime.elapsed() + 90_000);
      passing = true;
    };
    const runtime = {
      ...target.runtime,
      store(method: "GET" | "HEAD" | "PUT", path: string, body?: StoreBody) {
        if (method === "PUT") events.push(`store ${path}`);
        return target.runtime.store(method, path, body);
      },
      apply(resource: KubeResource) {
        const which = three.indexOf(resource.metadata.name);
        const moment = target.runtime.elapsed();

        events.push(`apply ${resource.kind} ${resource.metadata.name}`);
        target.runtime.apply(resource);
        if (which < 0) return;
        writes(target, moment + 3000, resource.kind, three[which], Object.values(REFUSED)[which]);
        if (which === 2) pass();
      },
      kubectl(args: string[], input?: string) {
        if (args[1] === "backups.velero.io,backupstoragelocations.velero.io") {
          events.push("wait");
          pass();
        }
        return target.runtime.kubectl(args, input);
      },
    };
    const artifacts = briefArtifacts(SYNCED_STARTED);
    const place = (at: number) => placeViewAndTabFixtures(runtime as never, run, SYNCED_STARTED, at, artifacts);
    const placed = place(now);
    const applies = events.filter((event) => event.startsWith("apply "));

    // The eleven files, each folder with its metadata last, before anything else is placed: the server has
    // the time the other fixtures take to create its backups of them. They are the artifacts it was given.
    expect(events.slice(0, 11)).toEqual(tabKeys().map((path) => `store ${path}`));
    expect(
      gunzipSync(target.store.get(tabArtifactPaths(run).synced.log) ?? Buffer.alloc(0)).toString("utf8") ===
        artifacts.log.text,
    ).toBe(true);
    expect(events[11]).toMatch(/^apply Namespace /);
    // The objects of the views, then the three operations, and only then the reads of the wait.
    expect(applies.length).toBeGreaterThan(3);
    expect(applies.slice(-3)).toEqual([
      `apply Backup ${names.invalidBackup}`,
      `apply Restore ${names.invalidRestore}`,
      `apply Restore ${names.orphanRestore}`,
    ]);
    expect(events.indexOf("wait")).toBe(events.lastIndexOf(applies[applies.length - 1]) + 1);
    expect(new Set(events.slice(events.indexOf("wait")))).toEqual(new Set(["wait"]));
    // What each part answers: the files written, the fixtures of the views, the three refused within the
    // read after the server looked at them, and the two backups found once the sync passed.
    expect(placed.stored).toEqual({ state: "stored", written: tabKeys(), way: "upload", met: [] });
    expect(placed.views).toMatchObject({ scale: SCALE_BACKUPS, restores: SCALE_RESTORES, again: [] });
    expect(placed.refused).toMatchObject({ applied: three, waited: 4000 });
    expect([placed.refused.backup.status, placed.refused.restore.status, placed.refused.orphan.status]).toEqual(
      Object.values(REFUSED),
    );
    expect(placed.synced).toMatchObject({ passes: 0, waited: 88_000 });
    expect(placed.synced.synced).toEqual(target.find("Backup", "velero-demo", names.syncedBackup));
    // What the runner says of it is what it did: the files it wrote, the way it sent them, the time the wait
    // for the backups took once the other fixtures were placed, and the operations it placed.
    const views = (placement: typeof placed) =>
      `PASS: ${placement.views.views} objects of the views in ${names.views} and ${names.defaults}, ` +
      `${placement.views.overview} of the Overview in ${names.overview}, and ${SCALE_BACKUPS} backups and ` +
      `${SCALE_RESTORES} restores of the long lists in ${names.scale}, are in place, outside the reach of the ` +
      "controllers.";
    const created =
      `the server created ${names.syncedBackup} and ${names.syncedBackupWithoutLog} from them as they were ` +
      "stored: once the fixtures of the views and the refused operations were placed, the wait for the two took";
    const refused = `PASS: the server refused ${three.join(", ").replace(/, (?=[^,]*$)/, " and ")} for the reasons they are made for`;

    expect(placementWords(names, placed, [])).toEqual([
      views(placed),
      `PASS: the store holds the files of the tabs (11 files written by this run, each sent as upload), and ${created} 88 seconds.`,
      `${refused} (3 placed by this run, refused after 4 seconds).`,
    ]);
    expect(placed.synced.withoutLog).toEqual(target.find("Backup", "velero-demo", names.syncedBackupWithoutLog));
    expect(target.placement()?.state).toBe("synced");
    // A second placement finds everything: it sends the store nothing, applies none of the three again,
    // changes no object, and waits for nothing.
    const objects = structuredClone([...target.objects.entries()]);
    const told = events.length;
    const before = {
      requests: target.requests.length,
      paused: target.paused.length,
      changes: target.changes(),
      recorded: target.recorded.length,
    };
    const again = place(now + 60_000);
    const since = events.slice(told);

    expect(again.stored).toEqual({ state: "synced", written: [], way: "upload", met: [] });
    expect(again.views).toEqual({ ...placed.views, again: [] });
    expect(again.refused).toEqual({ ...placed.refused, applied: [], waited: 0 });
    expect(again.synced).toEqual({ ...placed.synced, passes: 0, waited: 4000 });
    // It says that it wrote nothing, with no way, and that it placed none of the operations, which it found
    // refused.
    expect(placementWords(names, again, [])).toEqual([
      views(again),
      `PASS: the store holds the files of the tabs (none written by this run), and ${created} 4 seconds.`,
      `${refused} (none placed by this run, each found refused).`,
    ]);
    expect(
      since.filter((event) => event.startsWith("store ") || three.some((name) => event.endsWith(` ${name}`))),
    ).toEqual([]);
    expect(since.filter((event) => event === "wait")).toHaveLength(1);
    expect({
      requests: target.requests.length,
      paused: target.paused.length,
      changes: target.changes(),
      recorded: target.recorded.length,
    }).toEqual(before);
    expect([...target.objects.entries()]).toEqual(objects);
    // The fixtures that are placed by the clock are placed by the moment of the placement: half a day
    // later they are put in place again, and nothing of the tabs is.
    const later = place(now + PLACED_FOR + HOUR);

    expect(later.views.again).toEqual([names.overview, names.scale]);
    expect(placementWords(names, later, [])).toContain(
      `NOTE: the fixtures that are placed by the clock were put in place again in ${names.overview} and ${names.scale}.`,
    );
    expect(later.stored).toEqual(again.stored);
    expect(later.refused).toEqual(again.refused);
    expect(target.requests).toHaveLength(before.requests);
  });

  it("says of a placement and of a removal of the tabs what each did, a thing that was done once as one", () => {
    const names = fixtureNames(run);
    const paths = tabArtifactPaths(run);
    const placed = {
      stored: { state: "stored", written: [paths.synced.archive], way: "data", met: ["upload: answered 403"] },
      views: { views: 60, overview: 31, scale: SCALE_BACKUPS, restores: SCALE_RESTORES, again: [names.overview] },
      refused: { applied: [names.orphanRestore], waited: 1400 },
      synced: { passes: 1, waited: 1400 },
    } as unknown as Parameters<typeof placementWords>[1];
    const words = placementWords(names, placed, [names.syncedBackup]);

    expect(words.slice(1)).toEqual([
      `NOTE: the fixtures that are placed by the clock were put in place again in ${names.overview}.`,
      "PASS: the store holds the files of the tabs (1 file written by this run, sent as data, which the store " +
        `took after upload: answered 403), and the server created ${names.syncedBackup} and ` +
        `${names.syncedBackupWithoutLog} from them as they were stored: once the fixtures of the views and the ` +
        "refused operations were placed, the wait for the two took 1 second, in which 1 pass of its sync ended " +
        "without both.",
      `NOTE: the server created ${names.syncedBackup} again since the journal was written: the journal has the ` +
        "new identity.",
      `PASS: the server refused ${names.invalidBackup}, ${names.invalidRestore} and ${names.orphanRestore} for ` +
        "the reasons they are made for (1 placed by this run, refused after 1 second).",
    ]);
    expect(
      placementWords(names, { ...placed, synced: { ...placed.synced, passes: 2, waited: 125_400 } }, []).find((line) =>
        line.startsWith("PASS: the store"),
      ),
    ).toMatch(/ took 125 seconds, in which 2 passes of its sync ended without both\.$/);
    // A removal: the backups once each, the deletions as many as were waited for, and the files given first.
    const removed = (deleted: string[], written: string[], waited: number) =>
      tabRemovalWords({ deleted, written, passes: 1, waited });

    expect(removed([names.syncedBackup, names.syncedBackupWithoutLog], [], 31_400)).toBe(
      `PASS: the server deleted ${names.syncedBackup} and ${names.syncedBackupWithoutLog} with the files the ` +
        "store was given for the tabs, and none came back after a pass of its sync (2 deletions waited for, no " +
        "file given to the store first, 31 seconds).",
    );
    expect(removed([names.syncedBackup], [paths.synced.metadata], 1000)).toMatch(
      / \(1 deletion waited for, 1 file given to the store first, 1 second\)\.$/,
    );
    expect(
      removed([names.syncedBackup, names.syncedBackup, names.syncedBackupWithoutLog], tabKeys().slice(0, 2), 158_000),
    ).toBe(
      `PASS: the server deleted ${names.syncedBackup} and ${names.syncedBackupWithoutLog} with the files the ` +
        "store was given for the tabs, and none came back after a pass of its sync (3 deletions waited for, 2 " +
        "files given to the store first, 158 seconds).",
    );
    expect(removed([], [], 2000)).toBe(
      "PASS: neither the cluster nor the store holds anything of the fixtures of the tabs.",
    );
  });

  // What the pretend cluster prints when it is asked for a template is what the cases of the requests rest
  // on: the texts and the values of the template for each item of the list it found, nothing for a value
  // that is not there, and the kind of the list itself.
  it("has a pretend client that prints a template for each item of a list, and nothing for what an item has not", () => {
    const target = installation();
    const names = fixtureNames(run);
    const read = (kinds: string, template: string, ...more: string[]) =>
      target.runtime.kubectl(["get", kinds, ...more, "-o", `jsonpath=${template}`]);

    expect(read("backups.velero.io", "{.kind}", "--namespace", "velero-demo")).toBe("List");
    expect(
      read(
        "backups.velero.io,backupstoragelocations.velero.io",
        '{range .items[*]}{.kind}{" "}{.metadata.name}{" "}{.status.phase}{.status.nothing.at.all}{"\\n"}{end}{.kind}',
        "--all-namespaces",
      ),
    ).toBe(`BackupStorageLocation default Available\nBackup ${names.backup} Completed\nList`);
    // In one namespace, and in none that holds the kind.
    expect(read("backups.velero.io", "{range .items[*]}{.metadata.name}{end}", "--namespace", "velero-demo")).toBe(
      names.backup,
    );
    expect(read("backups.velero.io", "{range .items[*]}{.metadata.name}{end}", "--namespace", "another")).toBe("");
    // It prints no object whole, and no template it does not know how to print.
    expect(() => read("backups.velero.io", "{range .items[*]}{.status}{end}", "--all-namespaces")).toThrow(
      "The pretend client prints no object whole: .status",
    );
    expect(() => read("backups.velero.io", "{.kind} and more", "--all-namespaces")).toThrow(
      "Not a template the pretend client knows",
    );
    // A client that answers one object where one is found gives the template that object, and not a list.
    target.told.unwrapped = true;
    expect(read("backups.velero.io", "{range .items[*]}{.metadata.name}{end}{.kind}", "--all-namespaces")).toBe(
      "Backup",
    );
    expect(
      read("backups.velero.io,backupstoragelocations.velero.io", "{range .items[*]}{.kind}{end}", "--all-namespaces"),
    ).toBe("BackupStorageLocationBackup");
  });

  it("enters in the journal the two backups the server created, each with the identity the cluster gave it", () => {
    const names = fixtureNames(run);
    const created = (first: string, second: string, change: (backup: KubeResource) => void = () => {}) => {
      const backup = (name: string, uid: string): KubeResource => ({
        apiVersion: "velero.io/v1",
        kind: "Backup",
        metadata: { name, namespace: "velero-demo", uid },
      });
      const found = {
        synced: backup(names.syncedBackup, first),
        withoutLog: backup(names.syncedBackupWithoutLog, second),
      };

      change(found.withoutLog);
      return found;
    };
    const entry = (name: string, uid: string) => ({
      apiVersion: "velero.io/v1",
      kind: "Backup",
      name,
      namespace: "velero-demo",
      uid,
    });
    // The journal of a run: its real backup, and two objects that are not the backups the server created,
    // though each has the name of one.
    const journal: Recorded[] = [
      entry(names.backup, "uid-real"),
      { ...entry(names.syncedBackup, "uid-elsewhere"), namespace: "velero-static-a1b2c3d4" },
      { ...entry(names.syncedBackup, "uid-request"), kind: "DeleteBackupRequest" },
    ];
    const other = structuredClone(journal);

    expect(recordSyncedBackups(journal, run, created("uid-1", "uid-2"))).toEqual([]);
    expect(journal).toEqual([
      ...other,
      entry(names.syncedBackup, "uid-1"),
      entry(names.syncedBackupWithoutLog, "uid-2"),
    ]);
    // A second placement finds the two as they are entered.
    expect(recordSyncedBackups(journal, run, created("uid-1", "uid-2"))).toEqual([]);
    expect(journal).toHaveLength(5);
    // A backup the server created again has another identity: its entry takes it, and the name is answered.
    expect(recordSyncedBackups(journal, run, created("uid-1", "uid-9"))).toEqual([names.syncedBackupWithoutLog]);
    expect(journal).toEqual([
      ...other,
      entry(names.syncedBackup, "uid-1"),
      entry(names.syncedBackupWithoutLog, "uid-9"),
    ]);
    // What is not one of the two, as the cluster holds it, is not entered, and neither is the other of them.
    const kept = structuredClone(journal);
    const refuses = (change: (backup: KubeResource) => void) => {
      expect(() => recordSyncedBackups(journal, run, created("uid-1", "uid-9", change))).toThrow(
        `The backup ${names.syncedBackupWithoutLog} the server created is entered in the journal with the identity ` +
          "the cluster gave it",
      );
      expect(journal).toEqual(kept);
    };

    refuses((backup) => {
      delete backup.metadata.uid;
    });
    refuses((backup) => {
      backup.metadata.name = names.backup;
    });
    refuses((backup) => {
      backup.metadata.namespace = "velero-static-a1b2c3d4";
    });
    refuses((backup) => {
      backup.kind = "Restore";
    });
  });

  // The requests to Velero as the extension leaves them. One for a download that the server processed
  // holds the URL it signed, and the time it expires at; one for the status of the server holds neither.
  const SIGNED = "https://storage.synthetic.example/velero-demo/backups/synthetic?X-Amz-Signature=synthetic";
  const asks = (target: Installation, kind: string, namespace: string, name: string, status?: object) => {
    const request = { apiVersion: "velero.io/v1", kind, metadata: { name, namespace }, ...(status ? { status } : {}) };

    target.runtime.apply(request);
  };
  // What the wait says, and every answer the client of the cluster gave it, with whether it was to be
  // recorded.
  const requestsRemoved = (
    target: Installation,
    wait: typeof awaitRequestsRemoved | typeof awaitRequestsBeforeCleanup = awaitRequestsRemoved,
  ) => {
    const said: string[] = [];
    const answers: { args: string[]; recorded: unknown; output: string }[] = [];
    const runtime = {
      ...target.runtime,
      kubectl(args: string[], ...more: [input?: string, timeout?: number, recorded?: boolean]) {
        const output = target.runtime.kubectl(args, more[0]);

        answers.push({ args, recorded: more[2], output });
        return output;
      },
    };
    let words = "";
    let result: ReturnType<typeof wait> | undefined;

    try {
      result = wait(runtime as never, run, (line) => said.push(line));
    } catch (error) {
      words = (error as Error).message;
    }
    return { said, answers, words, result };
  };

  it("waits before the suites start for the server to remove the requests of its namespace, and reads of a request its names and its expiration alone", () => {
    const names = fixtureNames(run);
    const download = `${names.backup}-0b5c3d2e-8f1a-4c6b-9d7e-2a3b4c5d6e7f`;
    const status = "velero-status-7a6b5c4d-3e2f-4a1b-8c9d-0e1f2a3b4c5d";
    const target = installation();

    // With no request in the cluster it reads once, says nothing and waits for nothing.
    const none = requestsRemoved(target);

    expect(none).toMatchObject({ said: [], words: "", result: { waited: 0, removed: [], unserved: [] } });
    expect(none.answers).toEqual([
      {
        args: [
          "get",
          "downloadrequests.velero.io,serverstatusrequests.velero.io,deletebackuprequests.velero.io",
          "--all-namespaces",
          "-o",
          'jsonpath={range .items[*]}{.kind}{"\\t"}{.metadata.namespace}{"\\t"}{.metadata.name}{"\\t"}{.status.expiration}{"\\n"}{end}{.kind}',
        ],
        // The answer is not kept in the log of the operations.
        recorded: false,
        output: "List",
      },
    ]);
    expect(target.paused).toEqual([]);
    // Two requests the server processed in its namespace: it removes the one for its status first, and the
    // one for a download once it expired.
    asks(target, "DownloadRequest", "velero-demo", download, {
      phase: "Processed",
      downloadURL: SIGNED,
      expiration: "2026-10-05T10:14:10Z",
    });
    asks(target, "ServerStatusRequest", "velero-demo", status, {
      phase: "Processed",
      processedTimestamp: "2026-10-05T10:04:10Z",
      serverVersion: "v1.18.2",
    });
    const began = target.runtime.elapsed();

    target.at(began + 20_000, () => target.objects.delete(`serverstatusrequest/velero-demo/${status}`));
    target.at(began + 61_000, () => target.objects.delete(`downloadrequest/velero-demo/${download}`));
    const waited = requestsRemoved(target);

    // It says what it waits for before it waits, each request by its kind and its name, with the time it
    // expires at when it tells one; then how long the server took.
    expect(waited.said).toEqual([
      "NOTE: waiting for the server to remove what was asked of it in velero-demo, 12 minutes at most: " +
        `DownloadRequest velero-demo/${download} (expires at 2026-10-05T10:14:10Z), ServerStatusRequest ` +
        `velero-demo/${status} (tells no expiration). The suites expect no request to Velero when they start, and ` +
        "nothing here removes one.",
      "NOTE: the server removed what was waited for after 63 seconds.",
    ]);
    expect(waited.result).toEqual({
      waited: 63_000,
      removed: [`DownloadRequest velero-demo/${download}`, `ServerStatusRequest velero-demo/${status}`],
      unserved: [],
    });
    // It read every five seconds, until the read that found neither.
    expect(target.paused).toEqual(Array(7).fill(5000));
    expect(waited.answers).toHaveLength(8);
    expect(waited.answers[0].output).toBe(
      `DownloadRequest\tvelero-demo\t${download}\t2026-10-05T10:14:10Z\n` +
        `ServerStatusRequest\tvelero-demo\t${status}\t\nList`,
    );
    // Nothing it read holds the URL the server signed, and no answer was to be recorded.
    expect(waited.answers.every(({ recorded }) => recorded === false)).toBe(true);
    expect(waited.answers.map(({ output }) => output).join("\n")).not.toContain("synthetic.example");
    // It removed nothing itself, and applied nothing.
    expect(target.removed).toEqual([]);
    expect(new Set(target.asked)).toEqual(new Set(["get"]));
  });

  it("warns of a request to Velero in a namespace no server reads, and neither waits for it nor stops", () => {
    const names = fixtureNames(run);
    const target = installation();
    const warned = (requests: string[]) =>
      `WARNING: no server reads the namespace of ${requests.join(", ")}, and nothing removes a request there but ` +
      "the suite that asked the extension for it: the suites that expect no request to Velero when they start " +
      "fail in their last case while one is there. What stays goes with the environment, with `pnpm demo:down`.";

    // Each of the five namespaces the suites count the requests of, and neither of the two they do not read.
    for (const namespace of fixtureNamespaces(run)) {
      const one = installation();
      const read = [names.static, names.views, names.defaults, names.overview, names.scale].includes(namespace);

      one.runtime.apply({ kind: "Namespace", metadata: { name: namespace } });
      asks(one, "DownloadRequest", namespace, "synthetic-download");
      expect([namespace, requestsRemoved(one)]).toEqual([
        namespace,
        expect.objectContaining({
          words: "",
          said: read ? [warned([`DownloadRequest ${namespace}/synthetic-download`])] : [],
          result: {
            waited: 0,
            removed: [],
            unserved: read ? [`DownloadRequest ${namespace}/synthetic-download`] : [],
          },
        }),
      ]);
      expect(one.paused).toEqual([]);
    }
    expect([names.source, names.restored].every((namespace) => fixtureNamespaces(run).includes(namespace))).toBe(true);

    for (const name of [names.views, names.static, names.source])
      target.runtime.apply({ kind: "Namespace", metadata: { name } });
    // One the extension asked for where no server looks: it has no status, and never will.
    asks(target, "DownloadRequest", names.views, "backup-completed-11111111-2222-4333-8444-555555555555");
    asks(target, "ServerStatusRequest", names.static, "velero-status-66666666-7777-4888-9999-000000000000");
    // A namespace of the run the views are not looked at in is not one the suites read.
    asks(target, "DeleteBackupRequest", names.source, "synthetic-delete");
    const found = requestsRemoved(target);
    const told = [
      `DownloadRequest ${names.views}/backup-completed-11111111-2222-4333-8444-555555555555`,
      `ServerStatusRequest ${names.static}/velero-status-66666666-7777-4888-9999-000000000000`,
    ];

    expect(found.words).toBe("");
    expect(found.said).toEqual([warned(told)]);
    expect(found.result).toEqual({ waited: 0, removed: [], unserved: told });
    expect(found.answers).toHaveLength(1);
    expect(target.paused).toEqual([]);
    // With one in the namespace of the installation beside them, both are said, and that one alone is
    // waited for.
    asks(target, "DeleteBackupRequest", "velero-demo", "synthetic-delete", { phase: "InProgress" });
    target.at(target.runtime.elapsed() + 10_000, () =>
      target.objects.delete("deletebackuprequest/velero-demo/synthetic-delete"),
    );
    const both = requestsRemoved(target);

    expect(both.said).toEqual([
      found.said[0],
      "NOTE: waiting for the server to remove what was asked of it in velero-demo, 12 minutes at most: " +
        "DeleteBackupRequest velero-demo/synthetic-delete (tells no expiration). The suites expect no request to " +
        "Velero when they start, and nothing here removes one.",
      "NOTE: the server removed what was waited for after 9 seconds.",
    ]);
    expect(both.result).toEqual({
      waited: 9000,
      removed: ["DeleteBackupRequest velero-demo/synthetic-delete"],
      unserved: told,
    });
  });

  it("stops when the server did not remove a request of its namespace in twelve minutes, by the time that went by, and when the requests were not read as a list", () => {
    const down =
      "The suites expect no request to Velero when they start, and nothing here removes one: the way out is to " +
      "take the environment down, with `pnpm demo:down`.";
    const stalled = (cost: number, expiration?: string) => {
      const target = installation();

      asks(target, "DownloadRequest", "velero-demo", "synthetic-download", expiration ? { expiration } : undefined);
      asks(target, "ServerStatusRequest", "velero-demo", "synthetic-status", { phase: "Processed" });
      target.cost(cost);
      const { words, said } = requestsRemoved(target);

      expect(said).toHaveLength(1);
      expect(new Set(target.paused)).toEqual(new Set([5000]));
      return { words, elapsed: target.runtime.elapsed(), reads: target.asked.length };
    };
    const left =
      "The server did not remove in 12 minutes what was asked of it in velero-demo: DownloadRequest " +
      "velero-demo/synthetic-download (expires at 2026-10-05T10:15:20Z), ServerStatusRequest " +
      `velero-demo/synthetic-status (tells no expiration). ${down}`;
    const unseen =
      "The server did not look at DownloadRequest velero-demo/synthetic-download in a minute: it writes when a " +
      `request for a download expires at its first look, and removes none it did not look at. ${down}`;

    // A read of four seconds, and one of a minute: the wait is of the same twelve minutes, in fewer reads.
    expect(stalled(4000, "2026-10-05T10:15:20Z")).toEqual({ words: left, elapsed: 724_000, reads: 81 });
    expect(stalled(60_000, "2026-10-05T10:15:20Z")).toEqual({ words: left, elapsed: 840_000, reads: 13 });
    // A request for a download that tells no expiration a minute after it was read is one the server did
    // not look at, and never removes: the wait does not go on for twelve minutes, as the one before a
    // cleanup does not.
    expect(stalled(4000)).toEqual({ words: unseen, elapsed: 67_000, reads: 8 });
    expect(stalled(60_000)).toEqual({ words: unseen, elapsed: 125_000, reads: 2 });
    // The minute is of each request, from the read that first found it: one that is asked for while another
    // is waited for is given its minute, and the server, which looks at it meanwhile, removes both.
    const later = installation();

    asks(later, "ServerStatusRequest", "velero-demo", "synthetic-status", { phase: "Processed" });
    later.at(100_000, () => asks(later, "DownloadRequest", "velero-demo", "synthetic-download"));
    later.at(130_000, () => {
      (later.find("DownloadRequest", "velero-demo", "synthetic-download") as { status?: object }).status = {
        expiration: "2026-10-05T10:17:10Z",
      };
    });
    later.at(200_000, () => {
      later.objects.delete("downloadrequest/velero-demo/synthetic-download");
      later.objects.delete("serverstatusrequest/velero-demo/synthetic-status");
    });
    expect(requestsRemoved(later)).toMatchObject({ words: "", result: { waited: 198_000 } });
    // One the server never looks at stops the wait a minute after the read that found it, and not at that
    // read.
    const ignored = installation();

    asks(ignored, "ServerStatusRequest", "velero-demo", "synthetic-status", { phase: "Processed" });
    ignored.at(100_000, () => asks(ignored, "DownloadRequest", "velero-demo", "synthetic-download"));
    expect(requestsRemoved(ignored).words).toBe(unseen);
    expect(ignored.runtime.elapsed()).toBeGreaterThanOrEqual(160_000);
    expect(ignored.runtime.elapsed()).toBeLessThan(175_000);
    // An answer that is not the list that was asked for says nothing of what the cluster holds: it is not
    // taken for a cluster with no request.
    const unread =
      "The requests to Velero were not read as a list of their kind, their namespace, their name and their expiration";
    const single = installation();

    asks(single, "DownloadRequest", "velero-demo", "synthetic-download");
    single.told.unwrapped = true;
    expect(requestsRemoved(single)).toMatchObject({ words: unread, said: [] });
    // Nor is one whose lines are not the four parts of a request, or tell another kind or what is not a name.
    for (const [kind, namespace, name] of [
      ["DownloadRequest", "velero-demo", "synthetic\tdownload"],
      ["DownloadRequest", "velero-demo", "Synthetic Download"],
      ["DownloadRequest", "velero-demo", ""],
      ["DownloadRequest", "", "synthetic-download"],
      ["Backup", "velero-demo", "synthetic-download"],
    ]) {
      const target = installation();

      target.runtime.kubectl = () => `${kind}\t${namespace}\t${name}\t\nList`;
      expect([kind, namespace, name, requestsRemoved(target).words]).toEqual([kind, namespace, name, unread]);
    }
    const short = installation();

    short.runtime.kubectl = () => "DownloadRequest\tvelero-demo\tsynthetic-download\nList";
    expect(requestsRemoved(short).words).toBe(unread);
    // The wait is of the time the runtime counts.
    const clockless = installation();

    expect(() =>
      awaitRequestsRemoved({ ...clockless.runtime, elapsed: undefined } as never, run, () => undefined),
    ).toThrow("The wait for the requests to Velero needs the clock of the runtime");
    expect(clockless.asked).toEqual([]);
  });

  it("stops at once before the suites start on a request to delete a backup the server ended with an error, which it removes a day after it was made", () => {
    const down =
      "The suites expect no request to Velero when they start, and nothing here removes one: the way out is to " +
      "take the environment down, with `pnpm demo:down`.";
    const failed =
      "The server ended DeleteBackupRequest velero-demo/synthetic-delete with an error, which the private log of " +
      `the operations holds: it removes such a request a day after it was made. ${down}`;
    const listed = requestsRemoved(installation()).answers[0].args;
    const whole = ["get", "deletebackuprequests.velero.io", "--namespace", "velero-demo", "-o", "json"];
    const ended = (target: Installation, error: string) => {
      (target.find("DeleteBackupRequest", "velero-demo", "synthetic-delete") as { status?: object }).status = {
        phase: "Processed",
        errors: [error],
      };
    };
    // Ended before the wait: no wait is said or made. The request is read whole, as the cleanup reads one, into
    // the log of the operations, since it holds no URL, and the wait stops on it by its name.
    const before = installation();

    asks(before, "DeleteBackupRequest", "velero-demo", "synthetic-delete", {
      phase: "Processed",
      errors: ["backup not found"],
    });
    const stopped = requestsRemoved(before);

    expect(stopped).toMatchObject({ words: failed, said: [] });
    expect(stopped.answers.map(({ args, recorded }) => [args, recorded])).toEqual([
      [listed, false],
      [whole, undefined],
    ]);
    expect(before.paused).toEqual([]);
    expect(before.removed).toEqual([]);
    // Ended while it is waited for: the wait stops at the read after, and not twelve minutes later.
    const during = installation();

    asks(during, "DeleteBackupRequest", "velero-demo", "synthetic-delete", { phase: "InProgress" });
    during.at(20_000, () => ended(during, "error invoking delete item actions"));
    const late = requestsRemoved(during);

    expect(late.words).toBe(failed);
    expect(late.said).toHaveLength(1);
    expect(during.runtime.elapsed()).toBeLessThan(30_000);
    expect(during.removed).toEqual([]);
    // Ended with no error, the server removes it with its backup: it is waited for as before.
    const removed = installation();

    asks(removed, "DeleteBackupRequest", "velero-demo", "synthetic-delete", { phase: "Processed" });
    removed.at(10_000, () => removed.objects.delete("deletebackuprequest/velero-demo/synthetic-delete"));
    expect(requestsRemoved(removed)).toMatchObject({
      words: "",
      result: { removed: ["DeleteBackupRequest velero-demo/synthetic-delete"] },
    });
    // One in a namespace no server reads is told and not waited for, ended with an error or not.
    const unread = installation();
    const views = fixtureNames(run).views;

    unread.runtime.apply({ kind: "Namespace", metadata: { name: views } });
    asks(unread, "DeleteBackupRequest", views, "synthetic-delete", {
      phase: "Processed",
      errors: ["backup not found"],
    });
    expect(requestsRemoved(unread)).toMatchObject({
      words: "",
      result: { waited: 0, unserved: [`DeleteBackupRequest ${views}/synthetic-delete`] },
    });
  });

  it("waits before a cleanup for the server to remove the requests of its namespace, and leaves the requests to delete a backup to the removal of the backups", () => {
    const names = fixtureNames(run);
    const download = `${names.backup}-0b5c3d2e-8f1a-4c6b-9d7e-2a3b4c5d6e7f`;
    const status = "velero-status-7a6b5c4d-3e2f-4a1b-8c9d-0e1f2a3b4c5d";
    const target = installation();
    const before = (from: Installation) => requestsRemoved(from, awaitRequestsBeforeCleanup);

    // With no request in the cluster it reads once, says nothing and waits for nothing.
    const none = before(target);

    expect(none).toMatchObject({ said: [], words: "", result: { waited: 0, removed: [] } });
    expect(none.answers).toEqual([
      {
        args: [
          "get",
          "downloadrequests.velero.io,serverstatusrequests.velero.io,deletebackuprequests.velero.io",
          "--all-namespaces",
          "-o",
          'jsonpath={range .items[*]}{.kind}{"\\t"}{.metadata.namespace}{"\\t"}{.metadata.name}{"\\t"}{.status.expiration}{"\\n"}{end}{.kind}',
        ],
        recorded: false,
        output: "List",
      },
    ]);
    // A request to delete a backup is not waited for, whatever the server made of it: the server removes
    // the ones of a backup with the backup, and the removal of the backups replaces the ones it ended. Nor
    // is a request of a namespace that is neither the installation nor of the fixtures.
    target.told.deletes = Number.POSITIVE_INFINITY;
    asks(target, "DeleteBackupRequest", "velero-demo", `${names.backup}-delete`, {
      phase: "Processed",
      errors: ["a synthetic error"],
    });
    asks(target, "DeleteBackupRequest", "velero-demo", "synthetic-delete");
    target.runtime.apply({ kind: "Namespace", metadata: { name: "another-namespace" } });
    asks(target, "DownloadRequest", "another-namespace", "synthetic-download");
    expect(before(target)).toMatchObject({ said: [], words: "", result: { waited: 0, removed: [] } });
    expect(target.paused).toEqual([]);
    // Two requests the server processed in its namespace: it removes the one for its status first, and the
    // one for a download once it expired.
    asks(target, "DownloadRequest", "velero-demo", download, {
      phase: "Processed",
      downloadURL: SIGNED,
      expiration: "2026-10-05T10:14:10Z",
    });
    asks(target, "ServerStatusRequest", "velero-demo", status, { phase: "Processed" });
    const began = target.runtime.elapsed();

    target.at(began + 20_000, () => target.objects.delete(`serverstatusrequest/velero-demo/${status}`));
    target.at(began + 61_000, () => target.objects.delete(`downloadrequest/velero-demo/${download}`));
    const waited = before(target);

    expect(waited.words).toBe("");
    expect(waited.said).toEqual([
      "NOTE: waiting for the server to remove what was asked of it in velero-demo, 12 minutes at most: " +
        `DownloadRequest velero-demo/${download} (expires at 2026-10-05T10:14:10Z), ServerStatusRequest ` +
        `velero-demo/${status} (tells no expiration). A run that is cleaned leaves no request to Velero behind, ` +
        "and nothing here removes one.",
      "NOTE: the server removed what was waited for after 63 seconds.",
    ]);
    expect(waited.result).toEqual({
      waited: 63_000,
      removed: [`DownloadRequest velero-demo/${download}`, `ServerStatusRequest velero-demo/${status}`],
    });
    // It read every five seconds, until the read that found neither; nothing it read holds the URL the
    // server signed, no answer was to be recorded, and it removed nothing itself.
    expect(target.paused).toEqual(Array(7).fill(5000));
    expect(waited.answers).toHaveLength(8);
    expect(waited.answers.every(({ recorded }) => recorded === false)).toBe(true);
    expect(waited.answers.map(({ output }) => output).join("\n")).not.toContain("synthetic.example");
    expect(target.removed).toEqual([]);
    expect(new Set(target.asked)).toEqual(new Set(["get"]));
  });

  it("stops before a cleanup on a request to Velero the server never removes: one it did not look at in a minute, one it did not remove in twelve, and one in a namespace of the fixtures", () => {
    const names = fixtureNames(run);
    const before = (from: Installation) => requestsRemoved(from, awaitRequestsBeforeCleanup);
    const down =
      "A run that is cleaned leaves no request to Velero behind, and nothing here removes a request: the way out " +
      "is to take the environment down, with `pnpm demo:down`.";
    const unseen =
      "The server did not look at DownloadRequest velero-demo/synthetic-download in a minute: it writes when a " +
      `request for a download expires at its first look, and removes none it did not look at. ${down}`;
    // A request for a download that tells no expiration: by the time that went by, whatever a read costs.
    const unlooked = (cost: number) => {
      const target = installation();

      asks(target, "DownloadRequest", "velero-demo", "synthetic-download");
      asks(target, "ServerStatusRequest", "velero-demo", "synthetic-status");
      target.cost(cost);
      const { words, said } = before(target);

      expect(said).toHaveLength(1);
      return { words, elapsed: target.runtime.elapsed(), reads: target.asked.length };
    };

    expect(unlooked(4000)).toEqual({ words: unseen, elapsed: 67_000, reads: 8 });
    expect(unlooked(60_000)).toEqual({ words: unseen, elapsed: 125_000, reads: 2 });
    // One the server looked at within the minute is waited for as long as the server takes, and a request
    // for the status of the server, which never tells an expiration, is not taken for one it did not see.
    const seen = installation();

    asks(seen, "DownloadRequest", "velero-demo", "synthetic-download");
    asks(seen, "ServerStatusRequest", "velero-demo", "synthetic-status");
    seen.at(20_000, () => {
      (seen.find("DownloadRequest", "velero-demo", "synthetic-download") as { status?: object }).status = {
        expiration: "2026-10-05T10:15:20Z",
      };
    });
    seen.at(200_000, () => {
      seen.objects.delete("downloadrequest/velero-demo/synthetic-download");
      seen.objects.delete("serverstatusrequest/velero-demo/synthetic-status");
    });
    expect(before(seen)).toMatchObject({ words: "", result: { waited: 198_000 } });
    // The minute is of each request, from the read that first found it: one that is asked for while another
    // is waited for is given its minute, and the server, which looks at it meanwhile, removes both.
    const later = installation();

    asks(later, "ServerStatusRequest", "velero-demo", "synthetic-status", { phase: "Processed" });
    later.at(100_000, () => asks(later, "DownloadRequest", "velero-demo", "synthetic-download"));
    later.at(130_000, () => {
      (later.find("DownloadRequest", "velero-demo", "synthetic-download") as { status?: object }).status = {
        expiration: "2026-10-05T10:17:10Z",
      };
    });
    later.at(200_000, () => {
      later.objects.delete("downloadrequest/velero-demo/synthetic-download");
      later.objects.delete("serverstatusrequest/velero-demo/synthetic-status");
    });
    expect(before(later)).toMatchObject({ words: "", result: { waited: 198_000 } });
    // One the server never looks at stops the wait a minute after the read that found it, and not at that
    // read.
    const ignored = installation();

    asks(ignored, "ServerStatusRequest", "velero-demo", "synthetic-status", { phase: "Processed" });
    ignored.at(100_000, () => asks(ignored, "DownloadRequest", "velero-demo", "synthetic-download"));
    expect(before(ignored).words).toBe(unseen);
    expect(ignored.runtime.elapsed()).toBeGreaterThanOrEqual(160_000);
    expect(ignored.runtime.elapsed()).toBeLessThan(175_000);
    // Twelve minutes for what the server looked at and did not remove.
    const kept = (cost: number) => {
      const target = installation();

      asks(target, "DownloadRequest", "velero-demo", "synthetic-download", { expiration: "2026-10-05T10:15:20Z" });
      asks(target, "ServerStatusRequest", "velero-demo", "synthetic-status", { phase: "Processed" });
      target.cost(cost);
      return { words: before(target).words, elapsed: target.runtime.elapsed(), reads: target.asked.length };
    };
    const left =
      "The server did not remove in 12 minutes what was asked of it in velero-demo: DownloadRequest " +
      "velero-demo/synthetic-download (expires at 2026-10-05T10:15:20Z), ServerStatusRequest " +
      `velero-demo/synthetic-status (tells no expiration). ${down}`;

    expect(kept(4000)).toEqual({ words: left, elapsed: 724_000, reads: 81 });
    expect(kept(60_000)).toEqual({ words: left, elapsed: 840_000, reads: 13 });
    // A request in a namespace of the fixtures, any of the seven: the cleanup would refuse that namespace
    // once everything else is removed, so it stops on it first, by its name, and waits for nothing.
    const unread = (requests: [kind: string, namespace: string, name: string][]) =>
      `No server reads the namespace of ${requests.map(([kind, namespace, name]) => `${kind} ${namespace}/${name}`).join(", ")}, ` +
      `so nothing removes ${requests.length > 1 ? "them" : "it"} but who asked the extension for ` +
      `${requests.length > 1 ? "them" : "it"}, and a cleanup removes no namespace of the fixtures that holds an ` +
      "object that is not of the run. Nothing was removed, and nothing here removes a request: the way out is to " +
      "take the environment down, with `pnpm demo:down`.";

    for (const namespace of fixtureNamespaces(run)) {
      const target = installation();

      target.runtime.apply({ kind: "Namespace", metadata: { name: namespace } });
      asks(target, "DownloadRequest", namespace, "synthetic-download");
      // One in the installation the server would remove is beside it: it is not waited for either.
      asks(target, "ServerStatusRequest", "velero-demo", "synthetic-status", { phase: "Processed" });
      expect([namespace, before(target)]).toEqual([
        namespace,
        expect.objectContaining({ words: unread([["DownloadRequest", namespace, "synthetic-download"]]), said: [] }),
      ]);
      expect(target.asked).toEqual(["get"]);
      expect(target.paused).toEqual([]);
    }
    const several = installation();

    for (const namespace of [names.views, names.static])
      several.runtime.apply({ kind: "Namespace", metadata: { name: namespace } });
    asks(several, "ServerStatusRequest", names.static, "synthetic-status");
    asks(several, "DeleteBackupRequest", names.views, "synthetic-delete");
    expect(before(several).words).toBe(
      unread([
        ["ServerStatusRequest", names.static, "synthetic-status"],
        ["DeleteBackupRequest", names.views, "synthetic-delete"],
      ]),
    );
    // One that is asked for there while the server is waited for stops the wait.
    const meanwhile = installation();

    meanwhile.runtime.apply({ kind: "Namespace", metadata: { name: names.views } });
    asks(meanwhile, "ServerStatusRequest", "velero-demo", "synthetic-status", { phase: "Processed" });
    meanwhile.at(30_000, () => asks(meanwhile, "DownloadRequest", names.views, "synthetic-download"));
    expect(before(meanwhile)).toMatchObject({
      words: unread([["DownloadRequest", names.views, "synthetic-download"]]),
      said: [expect.stringContaining("NOTE: waiting for the server")],
    });
    // An answer that is not the list that was asked for is not taken for a cluster with no request, and
    // the wait is of the time the runtime counts.
    const single = installation();

    asks(single, "DownloadRequest", "velero-demo", "synthetic-download");
    single.told.unwrapped = true;
    expect(before(single)).toMatchObject({
      words:
        "The requests to Velero were not read as a list of their kind, their namespace, their name and their expiration",
      said: [],
    });
    const clockless = installation();

    expect(() =>
      awaitRequestsBeforeCleanup({ ...clockless.runtime, elapsed: undefined } as never, run, () => undefined),
    ).toThrow("The wait for the requests to Velero needs the clock of the runtime");
    expect(clockless.asked).toEqual([]);
  });

  // The files the server wrote for the real backup and for the real restore of the run, as the store of the
  // demo holds them: two logs, each with the line the release ends the work with, the results, the lists
  // of the resources and the volume information of each.
  const REAL = {
    backupLog: [
      'time="2026-10-05T09:58:43Z" level=info msg="Setting up backup temp file" backup=velero-demo/fixture-backup-a1b2c3d4 logSource="pkg/controller/backup_controller.go:731"',
      'time="2026-10-05T09:58:44Z" level=debug msg="Getting namespace" backup=velero-demo/fixture-backup-a1b2c3d4 logSource="pkg/backup/item_collector.go:300" namespace=velero-source-a1b2c3d4',
      'time="2026-10-05T09:58:45Z" level=warning msg="Synthetic warning of a backup" backup=velero-demo/fixture-backup-a1b2c3d4 logSource="pkg/backup/backup.go:500"',
      'time="2026-10-05T09:58:46Z" level=info msg="Backed up a total of 13 items" backup=velero-demo/fixture-backup-a1b2c3d4 logSource="pkg/backup/backup.go:684" progress=',
      "",
    ].join("\n"),
    backupResults: '{"errors":{},"warnings":{}}\n',
    backupResourceList: `${JSON.stringify({
      "v1/ConfigMap": ["velero-source-a1b2c3d4/payload-00", "velero-source-a1b2c3d4/small-fixture"],
      "v1/Namespace": ["velero-source-a1b2c3d4"],
    })}\n`,
    backupVolumeInfo: "[]\n",
    restoreLog: [
      'time="2026-10-05T09:59:01Z" level=info msg="starting restore" logSource="pkg/controller/restore_controller.go:518" restore=velero-demo/fixture-restore-a1b2c3d4',
      'time="2026-10-05T09:59:02Z" level=info msg="Starting restore of backup velero-demo/fixture-backup-a1b2c3d4" logSource="pkg/restore/restore.go:468" restore=velero-demo/fixture-restore-a1b2c3d4',
      'time="2026-10-05T09:59:03Z" level=info msg="restore completed" logSource="pkg/controller/restore_controller.go:624" restore=velero-demo/fixture-restore-a1b2c3d4',
      "",
    ].join("\n"),
    restoreResults: `${JSON.stringify({
      // A character of two bytes: the size of a file is of its bytes.
      errors: { velero: ["synthetic error of a restore, after 5 \u00b5s"] },
      warnings: {
        cluster: ["synthetic warning of the cluster"],
        namespaces: { "velero-restored-a1b2c3d4": ["synthetic warning", "another synthetic warning"] },
      },
    })}\n`,
    restoreResourceList: `${JSON.stringify({
      "v1/ConfigMap": [
        "velero-restored-a1b2c3d4/payload-00(created)",
        "velero-restored-a1b2c3d4/small-fixture(skipped)",
      ],
      "v1/Namespace": ["velero-restored-a1b2c3d4(created)"],
    })}\n`,
    restoreVolumeInfo: "[]\n",
  };

  // The demo as the suites of the tabs find it: the two backups the server created from the store, the real
  // restore beside the real backup, the three operations the server refused, and in the store the files of
  // the real operations.
  function demo() {
    const names = fixtureNames(run);
    const target = installation();
    const artifacts = briefArtifacts(SYNCED_STARTED);
    const restore = {
      ...liveRestore("synthetic-owner", run),
      status: {
        phase: "Completed",
        startTimestamp: "2026-10-05T09:59:01Z",
        completionTimestamp: "2026-10-05T09:59:03Z",
        progress: { totalItems: 3, itemsRestored: 3 },
        hookStatus: {},
      },
    };
    const manifests = refusedFixtures("synthetic-owner", run);

    place(target, artifacts);
    target.sync();
    awaited(target);
    for (const operation of [
      restore,
      { ...manifests.backup, status: REFUSED.backup },
      { ...manifests.restore, status: REFUSED.restore },
      { ...manifests.orphan, status: REFUSED.orphan },
    ])
      target.runtime.apply(operation);
    const keys = { ...fixtureArtifactPaths(run), ...realTabArtifactPaths(run) };

    for (const [file, text] of Object.entries(REAL)) target.store.set(keys[file as keyof typeof REAL], gz(text));
    return { names, target, expected: tabExpectations(artifacts), keys, restore };
  }

  const told = (from: ReturnType<typeof demo>, runtime: object = from.target.runtime) =>
    tabFixtureFacts(runtime as never, run, from.expected);

  it("tells the suites what the artifacts of the tabs hold: what the generators made for the store, and what a plain count finds in the files the server wrote", () => {
    const from = demo();
    const { names, target, expected, keys } = from;
    const requests = target.requests.length;
    const asked = target.asked.length;
    const objects = structuredClone([...target.objects.entries()]);
    const facts = told(from);
    const of = (text: string) => ({
      bytes: Buffer.byteLength(text),
      sha256: createHash("sha256").update(text).digest("hex"),
    });
    const status = (kind: string, name: string) => target.find(kind, "velero-demo", name)?.status;

    // Of the two backups the store was given: what the generators say of their artifacts, and the status
    // the server created each with.
    expect(facts.run).toBe(run);
    expect(facts.namespace).toBe("velero-demo");
    expect(facts.synced).toEqual({ ...expected, status: status("Backup", names.syncedBackup) });
    expect(facts.synced.backup).toBe(names.syncedBackup);
    expect(facts.synced.status).toMatchObject({ phase: "PartiallyFailed", errors: 4, warnings: 2 });
    expect(facts.withoutLog).toEqual({
      backup: names.syncedBackupWithoutLog,
      results: of('{"errors":{},"warnings":{}}\n'),
      resourceList: of("{}\n"),
      volumeInfo: of("[]\n"),
      status: status("Backup", names.syncedBackupWithoutLog),
    });
    expect(facts.withoutLog.status).toMatchObject({ phase: "Completed", progress: {} });
    // Of the real backup: its status as the cluster holds it, and what its files hold. The log by a plain
    // count, with the line the release writes once when the items are done and the field of every entry.
    expect(facts.real.backup).toEqual({
      name: names.backup,
      status: takenBackup().status,
      log: {
        ...of(REAL.backupLog),
        lines: 4,
        characters: REAL.backupLog.length,
        levels: { error: 0, warning: 1, info: 2, debug: 1, other: 0 },
        found: [
          { text: "Backed up a total of", lines: 1, occurrences: 1 },
          { text: `backup=velero-demo/${names.backup}`, lines: 4, occurrences: 4 },
        ],
      },
      results: {
        ...of(REAL.backupResults),
        value: { errors: {}, warnings: {} },
        errors: 0,
        warnings: 0,
        groups: {
          errors: { velero: 0, cluster: 0, namespaces: {} },
          warnings: { velero: 0, cluster: 0, namespaces: {} },
        },
      },
      resourceList: {
        ...of(REAL.backupResourceList),
        value: JSON.parse(REAL.backupResourceList),
        resources: 2,
        items: 3,
      },
      volumeInfo: { ...of(REAL.backupVolumeInfo), value: [], volumes: 0 },
    });
    // Of the real restore: the same, its log by the line the release ends a restore with, its results by
    // where the release files each entry, and its items by what the release did of each.
    expect(facts.real.restore).toEqual({
      name: names.restore,
      status: from.restore.status,
      log: {
        ...of(REAL.restoreLog),
        lines: 3,
        characters: REAL.restoreLog.length,
        levels: { error: 0, warning: 0, info: 3, debug: 0, other: 0 },
        found: [
          { text: "restore completed", lines: 1, occurrences: 1 },
          { text: `restore=velero-demo/${names.restore}`, lines: 3, occurrences: 3 },
        ],
      },
      results: {
        ...of(REAL.restoreResults),
        value: JSON.parse(REAL.restoreResults),
        // The errors and the warnings by their number, as the ones of the synced backup are told.
        errors: 1,
        warnings: 3,
        groups: {
          errors: { velero: 1, cluster: 0, namespaces: {} },
          warnings: { velero: 0, cluster: 1, namespaces: { [names.restored]: 2 } },
        },
      },
      resourceList: {
        ...of(REAL.restoreResourceList),
        value: JSON.parse(REAL.restoreResourceList),
        resources: 2,
        items: 3,
        actions: { created: 2, skipped: 1 },
      },
      volumeInfo: { ...of(REAL.restoreVolumeInfo), value: [], volumes: 0 },
    });
    // Of the three operations the server refused: the status it gave each.
    expect(facts.refused).toEqual({
      backup: { name: names.invalidBackup, status: REFUSED.backup },
      restore: { name: names.invalidRestore, status: REFUSED.restore },
      orphan: { name: names.orphanRestore, status: REFUSED.orphan },
    });
    // It is plain data, as a file keeps it.
    expect(JSON.parse(JSON.stringify(facts))).toEqual(facts);
    // It read the operations of the installation once, and the eight files of the real ones with what the
    // client of the store may ask: it wrote nothing, and changed nothing.
    expect(target.asked.slice(asked)).toEqual(["get"]);
    expect(
      target.requests
        .slice(requests)
        .map(({ method, path }) => `${method} ${path}`)
        .sort(),
    ).toEqual(
      Object.keys(REAL)
        .map((file) => `GET ${keys[file as keyof typeof REAL]}`)
        .sort(),
    );
    expect(target.changes()).toBe(0);
    expect([...target.objects.entries()]).toEqual(objects);
  });

  it("tells the suites nothing when the store, the cluster or a file of the server is not as the facts need it", () => {
    const names = fixtureNames(run);
    const whole = demo();
    // The demo with one thing changed: the facts stop with these words. What was changed is put back, so
    // that each stop is of its one change.
    const refuses = (change: (from: ReturnType<typeof demo>) => void, words: string) => {
      const { target, expected } = whole;
      const before = {
        store: [...target.store.entries()],
        objects: structuredClone([...target.objects.entries()]),
        placement: target.placement(),
      };

      change(whole);
      expect(() => told(whole)).toThrow(words);
      target.store.clear();
      for (const [key, bytes] of before.store) target.store.set(key, bytes);
      target.objects.clear();
      for (const [key, found] of before.objects) target.objects.set(key, found);
      target.record(before.placement);
      whole.expected = expected;
    };
    const recorded =
      "The suites are told of the artifacts the store was given for this run, once the server created its backups of them";

    // What a suite expects of the synced backup is what the store holds of it: the placement is recorded as
    // synced, with the artifacts the suites are told of.
    refuses(({ target }) => target.record({ ...(target.placement() as TabPlacement), state: "stored" }), recorded);
    refuses(({ target }) => target.record(undefined), recorded);
    refuses((from) => {
      from.expected = { ...from.expected, digest: "0".repeat(64) };
    }, recorded);
    refuses((from) => {
      from.expected = { ...from.expected, backup: names.syncedBackupWithoutLog };
    }, recorded);
    // Each of the seven operations is in the installation, of this run, before a file of any is asked for.
    const requests = whole.target.requests.length;

    for (const [kind, name] of [
      ["Backup", names.syncedBackup],
      ["Backup", names.syncedBackupWithoutLog],
      ["Backup", names.backup],
      ["Restore", names.restore],
      ["Backup", names.invalidBackup],
      ["Restore", names.invalidRestore],
      ["Restore", names.orphanRestore],
    ]) {
      // What stays and the way on are said with it.
      const words =
        `The ${kind.toLowerCase()} ${name} of this run is not in velero-demo, where the tabs read it: the suites ` +
        "are told nothing, and what is left of the fixtures stays as it is. Clean the run with " +
        "`node e2e/scripts/local-demo.mts fixtures-cleanup --context kind-freelens-velero-dev` and make a new " +
        "one with `pnpm demo:up`, or take the environment down with `pnpm demo:down`.";
      const labels = (from: ReturnType<typeof demo>) =>
        from.target.find(kind, "velero-demo", name)?.metadata.labels as Record<string, string>;

      refuses(({ target }) => target.objects.delete(`${kind.toLowerCase()}/velero-demo/${name}`), words);
      refuses((from) => {
        labels(from)[OWNER_LABEL] = "another-owner";
      }, words);
      refuses((from) => {
        labels(from)[FIXTURE_LABEL] = "0f0f0f0f";
      }, words);
    }
    // An object of the name of an operation and of the other kind is not that operation.
    refuses(({ target }) => {
      const restore = target.find("Restore", "velero-demo", names.restore);

      target.objects.delete(`restore/velero-demo/${names.restore}`);
      target.objects.set(`backup/velero-demo/${names.restore}`, {
        ...restore,
        kind: "Backup",
        metadata: { ...restore?.metadata },
      });
    }, `The restore ${names.restore} of this run is not in velero-demo`);
    expect(whole.target.requests).toHaveLength(requests);
    // A file of a real operation that the store does not have, or that is not what the release writes
    // there, is told by what it is of, and nothing of what it holds is repeated.
    const backup = `the backup ${names.backup}`;
    const restore = `the restore ${names.restore}`;
    const files: [file: keyof typeof REAL, what: string][] = [
      ["backupLog", `log of ${backup}`],
      ["backupResults", `results of ${backup}`],
      ["backupResourceList", `list of the resources of ${backup}`],
      ["backupVolumeInfo", `volume information of ${backup}`],
      ["restoreLog", `log of ${restore}`],
      ["restoreResults", `results of ${restore}`],
      ["restoreResourceList", `list of the resources of ${restore}`],
      ["restoreVolumeInfo", `volume information of ${restore}`],
    ];

    for (const [file, what] of files) {
      refuses(
        ({ target, keys }) => target.store.delete(keys[file]),
        `The ${what} is not in the store, which answered 404`,
      );
      refuses(
        ({ target, keys }) => target.store.set(keys[file], Buffer.from("not in gzip")),
        `The ${what} is not a text in gzip of four mebibytes at most`,
      );
      refuses(
        ({ target, keys }) => target.store.set(keys[file], gz(Buffer.alloc(4 * 1024 ** 2 + 1, "a"))),
        `The ${what} is not a text in gzip of four mebibytes at most`,
      );
      if (file.endsWith("Log")) continue;
      for (const text of ["not JSON", "null\n", '"a text"\n'])
        refuses(
          ({ target, keys }) => target.store.set(keys[file], gz(text)),
          `The ${what} is not written as the release writes it`,
        );
    }
    // The results hold both keys, each with lists of texts by where the release files them; a list of the
    // resources holds lists of texts by resource; the volume information is a list of volumes.
    const shapes: [file: keyof typeof REAL, what: string, values: unknown[]][] = [
      [
        "backupResults",
        `results of ${backup}`,
        [
          { errors: {} },
          { warnings: {} },
          { errors: {}, warnings: [] },
          { errors: { velero: "a text" }, warnings: {} },
          { errors: {}, warnings: { cluster: [1] } },
          { errors: { namespaces: ["a text"] }, warnings: {} },
          { errors: { namespaces: [["a text"]] }, warnings: {} },
          { errors: {}, warnings: { namespaces: { "synthetic-ns-1": "a text" } } },
        ],
      ],
      [
        "restoreResourceList",
        `list of the resources of ${restore}`,
        [[], { "v1/ConfigMap": "a text" }, { "v1/ConfigMap": [1] }],
      ],
      ["backupVolumeInfo", `volume information of ${backup}`, [{}, ["a text"], [null]]],
    ];

    for (const [file, what, values] of shapes)
      for (const value of values)
        refuses(
          ({ target, keys }) => target.store.set(keys[file], gz(`${JSON.stringify(value)}\n`)),
          `The ${what} is not written as the release writes it`,
        );
    // The facts need the store of the environment and the record of the placement.
    for (const missing of [{ store: undefined }, { tabs: undefined }])
      expect(() => told(whole, { ...whole.target.runtime, ...missing })).toThrow(
        "What the suites are told of the tabs needs the store of the environment, and where the placement of the tabs is recorded",
      );
    // With everything put back, the suites are told again. An item of a restore the release wrote with no
    // action is counted under no name, and the action of an item is what its last brackets hold, whatever
    // its name holds before them.
    whole.target.store.set(
      whole.keys.restoreResourceList,
      gz(
        `${JSON.stringify({
          "v1/ConfigMap": ["synthetic-ns-1/first(created)", "synthetic-ns-1/second", "third()"],
          "rbac.authorization.k8s.io/v1/ClusterRole": ["synthetic(role)(skipped)"],
        })}\n`,
      ),
    );
    expect(told(whole).real.restore.resourceList.actions).toEqual({ created: 1, "": 2, skipped: 1 });
  });

  // What the runner does through its runtime, one call at a time: a command of the cluster, a request to the
  // store, an object the cluster is asked to hold, the record of the tabs that is kept, the journal that is
  // saved.
  type Effect = <Given extends unknown[], Answer>(
    what: "kubectl" | "store" | "apply" | "keep" | "save",
    call: (...given: Given) => Answer,
  ) => (...given: Given) => Answer;

  // The runner beside the cluster: its journal, in which it enters an object before it creates it and the
  // identity the cluster gave it after, by which it creates nothing over an entry of what is gone and writes
  // over nothing it did not enter. What it saved last is what a run that was stopped leaves the next one.
  function runner(target: Installation, kept: Recorded[] = [], effect: Effect = (_what, call) => call) {
    const { runtime } = target;
    const entries = structuredClone(kept);
    const saved = [structuredClone(kept)];
    const save = effect("save", () => {
      saved.push(structuredClone(entries));
    });
    const create = effect("apply", (resource: KubeResource) => runtime.apply(resource));
    const read = effect("kubectl", runtime.kubectl);

    return {
      entries,
      left: () => structuredClone(saved[saved.length - 1]),
      runtime: {
        owner: runtime.owner,
        pause: runtime.pause,
        elapsed: runtime.elapsed,
        kubectl: read,
        store: effect("store", runtime.store),
        tabs: { read: runtime.tabs.read, keep: effect("keep", runtime.tabs.keep) },
        journal: { entries, save },
        apply(resource: KubeResource) {
          const { name, namespace } = resource.metadata;
          const group = resource.apiVersion.includes("/") ? `.${resource.apiVersion.split("/")[0]}` : "";
          // It reads the object first, with a command of its own: what the server did since the fixtures
          // read the cluster is found then.
          const found = read([
            "get",
            `${resource.kind}${group}`,
            name,
            ...(namespace ? ["--namespace", namespace] : []),
            "--ignore-not-found",
            "-o",
            "json",
          ]).trim();
          let entry = entries.find(
            (item) =>
              item.apiVersion === resource.apiVersion &&
              item.kind === resource.kind &&
              item.name === name &&
              item.namespace === namespace,
          );

          if (resource.metadata.labels?.[OWNER_LABEL] !== runtime.owner)
            throw new Error("Manifest ownership is missing");
          if (found) {
            if (!entry) throw new Error("Refusing an existing resource not recorded by this setup");
            assertOwnedResource(runtime.owner, JSON.parse(found), entry.uid);
          } else if (entry?.uid) throw new Error("An owned resource disappeared; refusing silent replacement");
          if (!entry) {
            entry = { apiVersion: resource.apiVersion, kind: resource.kind, name, namespace };
            entries.push(entry);
            save();
          }
          create(resource);
          entry.uid = String(target.find(resource.kind, namespace, name)?.metadata.uid);
          save();
        },
      },
    };
  }

  // What a removal did, in its order: each command of the cluster by its verb, a removal with what it
  // removes; each request to the store; each object it asked the cluster to hold; each state it recorded;
  // and each time it saved its journal. The reads that follow one another are told once.
  const traced = (events: string[]): Effect => {
    return (what, call) =>
      (...given) => {
        const [first, second] = given as unknown[];
        const told =
          what === "kubectl"
            ? (first as string[])[1] === "--raw"
              ? `${(first as string[])[0]} ${(first as string[])[2]}`
              : (first as string[])[0]
            : what === "store"
              ? `${String(first)} ${String(second)}`
              : what === "apply"
                ? `apply ${(first as KubeResource).metadata.name}`
                : what === "keep"
                  ? `keep ${(first as TabPlacement).state}`
                  : what;

        if (told !== "get" || events.at(-1) !== "get") events.push(told);
        return call(...given);
      };
  };

  // The artifacts of the scenes of a removal, which reads none of them: the ones of the other cases with a
  // log of one line and a list of no resource, which take no time to pack.
  let light: ReturnType<typeof tabArtifacts> | undefined;
  const slight = () => {
    if (!light) {
      const whole = briefArtifacts(SYNCED_STARTED);
      const text = `${whole.log.text.split("\n", 1)[0]}\n`;

      light = {
        ...whole,
        log: { text, facts: { ...whole.log.facts, ...logFacts(text) } },
        resourceList: syntheticResourceList("empty"),
      };
    }
    return light;
  };

  // The demo once the server created the two backups of the tabs from the store, with the journal that
  // knows them, and a server whose sync passes every minute from then on when it is asked to.
  function tabsInPlace(passing = true) {
    const target = installation();
    const entries: Recorded[] = [];

    place(target, slight());
    target.sync();
    recordSyncedBackups(entries, run, awaited(target));
    const began = target.runtime.elapsed();

    for (let minute = 1; passing && minute <= 40; minute += 1) target.pass(began + minute * 60_000);
    return { target, entries, began };
  }

  // What is left of the tabs: in the cluster, in the store, in the journal, and what the record says.
  const remains = (target: Installation, entries: Recorded[]) => {
    const names = fixtureNames(run);
    const ours = [names.syncedBackup, names.syncedBackupWithoutLog].flatMap((name) => [name, `${name}-delete`]);

    return {
      objects: [...target.objects.keys()].filter((name) => ours.some((one) => name.endsWith(`/${one}`))),
      keys: tabKeys().filter((path) => target.store.has(path)),
      entries: entries.filter((entry) => ours.includes(entry.name)).map((entry) => `${entry.kind}/${entry.name}`),
      state: target.placement()?.state,
    };
  };
  const NOTHING_LEFT = { objects: [], keys: [], entries: [], state: "cleared" };
  // An object the cluster is made to hold, as a test sets a scene: the runner is not asked.
  const held = (target: Installation, resource: KubeResource) => target.runtime.apply(resource);
  // The words a removal stops with, or nothing when it ended.
  const stopped = (act: () => unknown) => {
    try {
      act();
      return "";
    } catch (error) {
      return (error as Error).message;
    }
  };
  const DOWN = "the way out is to take the environment down, with `pnpm demo:down`";

  it("has a pretend runner that enters an object in its journal before it creates it, and writes over nothing it did not enter", () => {
    const target = installation();
    const events: string[] = [];
    const from = runner(target, [], traced(events));
    const labels = { [OWNER_LABEL]: "synthetic-owner", [FIXTURE_LABEL]: run };
    const asked = fixtureDeletionRequest("synthetic-owner", run, "uid-of-a-backup", fixtureNames(run).backup);
    const entered = {
      apiVersion: "velero.io/v1",
      kind: "DeleteBackupRequest",
      name: asked.metadata.name,
      namespace: "velero-demo",
    };

    target.told.deletes = Number.POSITIVE_INFINITY;
    from.runtime.apply(asked);
    const uid = String(target.find("DeleteBackupRequest", "velero-demo", asked.metadata.name)?.metadata.uid);

    // It reads the object first; the entry is saved before the object is created, and its identity after.
    expect(events).toEqual(["get", "save", `apply ${asked.metadata.name}`, "save"]);
    expect(from.entries).toEqual([{ ...entered, uid }]);
    expect(from.left()).toEqual([{ ...entered, uid }]);
    // Over the object it entered it writes again, and enters nothing more.
    from.runtime.apply(asked);
    expect(from.entries).toEqual([{ ...entered, uid }]);
    // Nothing is created over an entry of what is gone, nor written over what is another object now, over
    // what was not entered, or for another owner.
    target.objects.delete(`deletebackuprequest/velero-demo/${asked.metadata.name}`);
    expect(stopped(() => from.runtime.apply(asked))).toBe("An owned resource disappeared; refusing silent replacement");
    held(target, asked);
    expect(stopped(() => from.runtime.apply(asked))).toBe("Resource identity changed");
    expect(stopped(() => runner(target).runtime.apply(asked))).toBe(
      "Refusing an existing resource not recorded by this setup",
    );
    expect(
      stopped(() =>
        runner(target).runtime.apply({
          ...asked,
          metadata: { ...asked.metadata, name: "another", labels: { ...labels, [OWNER_LABEL]: "another-owner" } },
        }),
      ),
    ).toBe("Manifest ownership is missing");
    // An entry that was saved without an identity is of a creation that was stopped: the object is taken.
    const taken = runner(target, [entered]);

    taken.runtime.apply(asked);
    expect(taken.entries[0].uid).toMatch(/^uid-\d+$/);
    expect(taken.entries[0].uid).not.toBe(uid);
  });

  it("has a pretend server that deletes a backup as the release does: its files, then the object, then the requests of it", () => {
    const names = fixtureNames(run);
    const paths = tabArtifactPaths(run);
    const labels = { [OWNER_LABEL]: "synthetic-owner", [FIXTURE_LABEL]: run };
    const asks = (target: Installation, name: string, backup: string, more: object = {}) =>
      held(target, {
        apiVersion: "velero.io/v1",
        kind: "DeleteBackupRequest",
        metadata: { name, namespace: "velero-demo", labels },
        spec: { backupName: backup },
        ...more,
      });
    // A command of the cluster takes four seconds, in which the server does what was due.
    const later = (target: Installation) => {
      target.runtime.kubectl(["get", "backups.velero.io", "--namespace", "velero-demo", "-o", "json"]);
    };
    const request = (target: Installation, name: string) => target.find("DeleteBackupRequest", "velero-demo", name);
    const backup = (target: Installation, name = names.syncedBackup) => target.find("Backup", "velero-demo", name);
    const folder = (target: Installation, name = names.syncedBackup) =>
      [...target.store.keys()].filter((path) => path.startsWith(`/velero-demo/backups/${name}/`));
    const whole = tabsInPlace(false);
    const { target } = whole;
    const uid = backup(target)?.metadata.uid;
    const between: unknown[] = [];

    // A request the server processed for the same backup, one of another backup, and a restore that names
    // the backup, beside the one that is asked now.
    asks(target, "an-earlier-request", names.syncedBackup, {
      metadata: {
        name: "an-earlier-request",
        namespace: "velero-demo",
        labels: { ...labels, "velero.io/backup-name": names.syncedBackup, "velero.io/backup-uid": "uid-of-before" },
      },
      status: { phase: "Processed", errors: ["a synthetic error"] },
    });
    asks(target, "of-another-backup", names.backup, {
      metadata: {
        name: "of-another-backup",
        namespace: "velero-demo",
        labels: { ...labels, "velero.io/backup-name": names.backup },
      },
      status: { phase: "InProgress" },
    });
    held(target, {
      apiVersion: "velero.io/v1",
      kind: "Restore",
      metadata: { name: "synthetic-restore", namespace: "velero-demo", labels },
      spec: { backupName: names.syncedBackup },
    });
    later(target);
    asks(target, "the-request", names.syncedBackup);
    // Between the files and the object the backup is being deleted and its folder is empty: a pass of the
    // sync that listed the folder before creates nothing over it, and one that does not list it leaves the
    // backup, which is neither completed nor failed in part.
    target.told.between = () => {
      between.push(folder(target), backup(target)?.status, request(target, "the-request")?.status);
      target.sync({ listed: [names.backup, names.syncedBackup, names.syncedBackupWithoutLog] });
      target.sync({ listed: [names.backup, names.syncedBackupWithoutLog] });
      between.push(backup(target)?.metadata.uid, target.orphaned);
    };
    expect(folder(target)).toEqual(Object.values(paths.synced));
    later(target);
    expect(between).toEqual([
      [],
      { ...JSON.parse(target.placement()?.metadata.synced ?? "{}").status, phase: "Deleting" },
      { phase: "InProgress" },
      uid,
      [],
    ]);
    // Then the restore went, the backup, and every request of that backup: the one that was asked, which the
    // server gave the name and the identity of the backup, and before anything else the one of before.
    expect(folder(target)).toEqual([]);
    expect(backup(target)).toBeUndefined();
    expect(target.find("Restore", "velero-demo", "synthetic-restore")).toBeUndefined();
    expect(request(target, "the-request")).toBeUndefined();
    expect(request(target, "an-earlier-request")).toBeUndefined();
    // What is of another backup is left, and so is every file of the other folders.
    expect(request(target, "of-another-backup")?.status).toEqual({ phase: "InProgress" });
    expect(backup(target, names.syncedBackupWithoutLog)?.status).toMatchObject({ phase: "Completed" });
    expect(folder(target, names.syncedBackupWithoutLog)).toEqual(Object.values(paths.withoutLog));
    expect(folder(target, names.backup)).toEqual([fixtureArtifactPaths(run).backupLog]);
    // A pass of the sync that listed the folder before its files went creates nothing: the metadata is gone.
    target.told.between = undefined;
    target.sync({ listed: [names.backup, names.syncedBackup, names.syncedBackupWithoutLog] });
    expect(backup(target)).toBeUndefined();
    // A request the server ended or began is not looked at again, and one whose backup is not there ends
    // with one error and stays.
    asks(target, "ended", names.syncedBackupWithoutLog, { status: { phase: "Processed" } });
    asks(target, "begun", names.syncedBackupWithoutLog, { status: { phase: "InProgress" } });
    asks(target, "of-no-backup", names.syncedBackup);
    asks(target, "of-no-name", "");
    later(target);
    expect(backup(target, names.syncedBackupWithoutLog)?.status).toMatchObject({ phase: "Completed" });
    expect(request(target, "ended")?.status).toEqual({ phase: "Processed" });
    expect(request(target, "begun")?.status).toEqual({ phase: "InProgress" });
    expect(request(target, "of-no-backup")?.status).toEqual({ phase: "Processed", errors: ["backup not found"] });
    expect(request(target, "of-no-name")?.status).toEqual({
      phase: "Processed",
      errors: ["spec.backupName is required"],
    });
    // The server acts a moment after the request, not at once, and never on one of a namespace it does not
    // read.
    held(target, { apiVersion: "v1", kind: "Namespace", metadata: { name: names.views } });
    held(target, {
      apiVersion: "velero.io/v1",
      kind: "DeleteBackupRequest",
      metadata: { name: "unread", namespace: names.views, labels },
      spec: { backupName: names.syncedBackupWithoutLog },
    });
    target.told.deletes = 10_000;
    asks(target, "slow", names.syncedBackupWithoutLog);
    later(target);
    later(target);
    expect(request(target, "slow")?.status).toBeUndefined();
    expect(backup(target, names.syncedBackupWithoutLog)?.status).toMatchObject({ phase: "Completed" });
    later(target);
    expect(backup(target, names.syncedBackupWithoutLog)).toBeUndefined();
    expect(target.find("DeleteBackupRequest", names.views, "unread")?.status).toBeUndefined();
    // The storage location: one that is read-only, not available or not there ends the request with one
    // error, and the backup is left as it was, with its files.
    for (const [change, error] of [
      [
        (location: { spec: Record<string, unknown> }) => {
          location.spec.accessMode = "ReadOnly";
        },
        "cannot delete backup because backup storage location default is currently in read-only mode",
      ],
      [
        (location: { status: Record<string, unknown> }) => {
          location.status.phase = "Unavailable";
        },
        "cannot delete backup because backup storage location default is currently in Unavailable state",
      ],
      [undefined, "backup storage location default not found"],
    ] as const) {
      const refusing = tabsInPlace(false).target;
      const location = refusing.find("BackupStorageLocation", "velero-demo", "default");

      if (change) change(location as never);
      else refusing.objects.delete("backupstoragelocation/velero-demo/default");
      asks(refusing, "refused", names.syncedBackup);
      later(refusing);
      expect([error, request(refusing, "refused")?.status]).toEqual([error, { phase: "Processed", errors: [error] }]);
      expect(backup(refusing)?.status).toMatchObject({ phase: "PartiallyFailed" });
      expect(folder(refusing)).toEqual(Object.values(paths.synced));
      expect(request(refusing, "refused")?.metadata.labels).toEqual(labels);
    }
    // The contents of the backup: ones that are there and are not an archive in gzip end the request with
    // one error, and the backup is left in deletion with every file of it. A second request is taken for a
    // backup in deletion: with the contents of a backup of no item, or with none in the store, it deletes.
    for (const contents of [
      Buffer.alloc(0),
      Buffer.from("not an archive"),
      emptyArchive().subarray(0, 20),
      gz(Buffer.alloc(700)),
    ]) {
      for (const way of ["put back", "removed"]) {
        const failing = tabsInPlace(false).target;

        failing.store.set(paths.synced.archive, contents);
        asks(failing, "first", names.syncedBackup);
        later(failing);
        expect(request(failing, "first")?.status).toEqual({
          phase: "Processed",
          errors: ["error invoking delete item actions"],
        });
        expect(request(failing, "first")?.metadata.labels).toEqual({
          ...labels,
          "velero.io/backup-name": names.syncedBackup,
          "velero.io/backup-uid": backup(failing)?.metadata.uid,
        });
        expect(backup(failing)?.status).toMatchObject({ phase: "Deleting", errors: 4 });
        expect(folder(failing)).toEqual(Object.values(paths.synced));
        // The request that failed is not looked at again, whatever the store holds since.
        if (way === "put back") failing.store.set(paths.synced.archive, emptyArchive());
        else failing.store.delete(paths.synced.archive);
        later(failing);
        expect(backup(failing)?.status).toMatchObject({ phase: "Deleting" });
        asks(failing, "second", names.syncedBackup);
        later(failing);
        expect([way, backup(failing), folder(failing)]).toEqual([way, undefined, []]);
        expect([request(failing, "first"), request(failing, "second")]).toEqual([undefined, undefined]);
      }
    }
    // A request that says another identity of its backup than the one the cluster gave it deletes the
    // backup all the same, and is not among the requests the server removes after.
    const mismatched = tabsInPlace(false).target;

    asks(mismatched, "of-another-identity", names.syncedBackup, {
      metadata: {
        name: "of-another-identity",
        namespace: "velero-demo",
        labels: { ...labels, "velero.io/backup-uid": "uid-of-before" },
      },
    });
    later(mismatched);
    expect(backup(mismatched)).toBeUndefined();
    expect(request(mismatched, "of-another-identity")?.status).toEqual({ phase: "Processed" });
    // What the release does and the pretend server does not is refused, and not left out in silence.
    for (const [prepare, words] of [
      [
        (unplayed: Installation) => unplayed.store.set(paths.synced.archive, gz(Buffer.alloc(512, 1))),
        "The pretend cluster calls no plugin for the items of a backup",
      ],
      [
        (unplayed: Installation) =>
          unplayed.store.set(paths.synced.archive.replace(".tar.gz", "-volumesnapshots.json.gz"), gz("[]")),
        "The pretend cluster removes no snapshot of a backup",
      ],
      [
        (unplayed: Installation) => {
          (backup(unplayed)?.status as { phase: string }).phase = "InProgress";
        },
        "The pretend cluster has no controller for a backup that did not end",
      ],
    ] as const) {
      const unplayed = tabsInPlace(false).target;

      prepare(unplayed);
      asks(unplayed, "unplayed", names.syncedBackup);
      expect([words, stopped(() => later(unplayed))]).toEqual([words, words]);
    }
    // The client removes one object by its path, and by the identity it must have.
    const removing = tabsInPlace(false).target;
    const byPath = (name: string, options: object | undefined, more: string[] = ["-f", "-"]) =>
      stopped(() =>
        removing.runtime.kubectl(
          ["delete", "--raw", `/apis/velero.io/v1/namespaces/velero-demo/deletebackuprequests/${name}`, ...more],
          options && JSON.stringify(options),
        ),
      );

    removing.told.deletes = Number.POSITIVE_INFINITY;
    asks(removing, "kept", names.syncedBackup);
    const identity = String(request(removing, "kept")?.metadata.uid);

    expect(byPath("kept", { kind: "DeleteOptions", preconditions: { uid: "another" } })).toBe(
      "The object is another one",
    );
    expect(byPath("gone", { kind: "DeleteOptions", preconditions: { uid: identity } })).toBe(
      'deletebackuprequests.velero.io "gone" not found',
    );
    for (const options of [undefined, {}, { kind: "DeleteOptions" }, { preconditions: { uid: identity } }])
      expect([options, byPath("kept", options)]).toEqual([
        options,
        "A delete by its path names what it removes and the identity it removes it by",
      ]);
    expect(byPath("kept", { kind: "DeleteOptions", preconditions: { uid: identity } }, [])).toBe(
      "A delete by its path names what it removes and the identity it removes it by",
    );
    expect(request(removing, "kept")).toBeDefined();
    expect(byPath("kept", { kind: "DeleteOptions", preconditions: { uid: identity } })).toBe("");
    expect(request(removing, "kept")).toBeUndefined();
    expect(removing.removed).toEqual(["deletebackuprequest/velero-demo/kept"]);
    expect(backup(removing)?.status).toMatchObject({ phase: "PartiallyFailed" });
  });

  const removed = (from: ReturnType<typeof runner>) => clearTabFixtures(from.runtime as never, run);
  // The sync of the server passes every minute from now on.
  const passing = (target: Installation) => {
    const from = target.runtime.elapsed();

    for (let minute = 1; minute <= 40; minute += 1) target.pass(from + minute * 60_000);
  };
  // A placement of the tabs that was stopped while it sent one of its files.
  const stoppedPlacement = (path: string) => {
    const target = installation();

    target.told.answer = (request) => {
      if (request.method === "PUT" && request.path === path) throw new Error("Synthetic interruption");
      return undefined;
    };
    expect(() => place(target, slight())).toThrow("Synthetic interruption");
    target.told.answer = undefined;
    return target;
  };
  const leftWith = (keys: string[]) =>
    `What the store holds of the tabs with no backup the server would delete it with: ${keys.join(", ")}. ` +
    `Nothing here removes a key: ${DOWN}.`;

  it("removes the fixtures of the tabs through the server: a request for each backup, the removal recorded before the first, and the store asked once the backups are gone", () => {
    const names = fixtureNames(run);
    const { target, entries, began } = tabsInPlace();
    const backups = [names.syncedBackup, names.syncedBackupWithoutLog];
    const identities = backups.map((name) => String(target.find("Backup", "velero-demo", name)?.metadata.uid));
    const events: string[] = [];
    const requested: unknown[] = [];
    const asked: number[] = [];
    const from = runner(target, entries, (what, call) =>
      traced(events)(what, (...given) => {
        if (what === "apply") requested.push(structuredClone(given[0]));
        if (what === "store") asked.push(target.runtime.elapsed());
        return call(...given);
      }),
    );
    const sent = target.requests.length;

    expect(remains(target, entries)).toEqual({
      objects: backups.map((name) => `backup/velero-demo/${name}`),
      keys: tabKeys(),
      entries: backups.map((name) => `Backup/${name}`),
      state: "synced",
    });
    const reads = target.logged.length;
    const result = removed(from);
    const ended = target.runtime.elapsed();

    // What it did, in its order. It read the installation and found the two backups; recorded the removal
    // before it asked anything of the server; asked the deletion of the first, the request read by the
    // runner, entered in the journal before it is created and with its identity after; read until the backup
    // was gone, and had the journal forget it and its request; read again and did the same for the second;
    // then, with no backup left, asked the store for each of the eleven keys, waited for a pass of the sync,
    // and recorded that nothing is left.
    expect(events).toEqual([
      "get",
      "keep clearing",
      "get",
      "save",
      `apply ${names.syncedBackup}-delete`,
      "save",
      "get",
      "save",
      "get",
      "save",
      `apply ${names.syncedBackupWithoutLog}-delete`,
      "save",
      "get",
      "save",
      "get",
      ...tabKeys().map((path) => `HEAD ${path}`),
      "get",
      "keep cleared",
    ]);
    // Each request is the one of the fixtures for that backup, bound to the identity the cluster gave it.
    expect(requested).toEqual(
      backups.map((name, index) => fixtureDeletionRequest("synthetic-owner", run, identities[index], name)),
    );
    expect(result).toEqual({ deleted: backups, written: [], passes: 1, waited: ended - began });
    // What it read of the installation while the server deleted is in the log of the operations, which a
    // deletion that ends with an error is to be read in; the reads that wait for the sync are not.
    expect(
      target.logged
        .slice(reads)
        .map((kept) => (kept ? "kept" : "withheld"))
        .join(" "),
    ).toMatch(/^(kept )+(withheld ?)+$/);
    expect(target.logged.slice(reads).filter((kept) => !kept).length).toBeLessThan(target.logged.length - reads - 6);
    // Nothing of the tabs is left: in the cluster, in the store, in the journal as it was saved.
    expect(remains(target, from.entries)).toEqual(NOTHING_LEFT);
    expect(from.left()).toEqual([]);
    expect(target.recorded.map(({ state }) => state).slice(-3)).toEqual(["synced", "clearing", "cleared"]);
    // The store was asked whether it holds each key and given nothing; the client removed nothing itself;
    // and what is not of the tabs is where it was.
    expect(target.requests.slice(sent).map(({ method }) => method)).toEqual(Array(11).fill("HEAD"));
    expect(target.removed).toEqual([]);
    expect(target.find("Backup", "velero-demo", names.backup)?.status).toMatchObject({ phase: "Completed" });
    expect([...target.store.keys()]).toEqual([fixtureArtifactPaths(run).backupLog]);
    // The pass that was waited for ended after the store was last asked, and the removal ended at the read
    // after the one that saw it end.
    const pass = began + Math.ceil(((asked.at(-1) ?? 0) + 4000 - began) / 60_000) * 60_000;

    expect(ended).toBeGreaterThanOrEqual(pass + 6000);
    expect(ended).toBeLessThan(pass + 12_000);
    // A second removal finds what the first one did: it reads once, asks the store for each key, and
    // neither waits nor changes anything.
    const again: string[] = [];
    const second = runner(target, from.left(), traced(again));
    const paused = target.paused.length;
    const recorded = target.recorded.length;

    expect(removed(second)).toEqual({ deleted: [], written: [], passes: 0, waited: 48_000 });
    expect(again).toEqual(["get", ...tabKeys().map((path) => `HEAD ${path}`)]);
    expect(target.paused).toHaveLength(paused);
    expect(target.recorded).toHaveLength(recorded);
    expect(remains(target, second.entries)).toEqual(NOTHING_LEFT);
  });

  it("calls the tabs removed when nothing of them was written, without a request to the server and without waiting for it", () => {
    const names = fixtureNames(run);
    // The placement was stopped at its first file, which the store did not keep.
    const target = stoppedPlacement(tabKeys()[0]);
    const events: string[] = [];
    const from = runner(target, [], traced(events));
    const sent = target.requests.length;

    expect(target.placement()).toMatchObject({ state: "storing" });
    expect(removed(from)).toEqual({ deleted: [], written: [], passes: 0, waited: 48_000 });
    // One read, each key asked for, and the record: nothing is given to the store in order to be deleted.
    expect(events).toEqual(["get", ...tabKeys().map((path) => `HEAD ${path}`), "keep cleared"]);
    expect(target.requests.slice(sent).map(({ method }) => method)).toEqual(Array(11).fill("HEAD"));
    expect(target.paused).toEqual([]);
    expect(remains(target, from.entries)).toEqual(NOTHING_LEFT);
    expect(target.find("Backup", "velero-demo", names.backup)).toBeDefined();
  });

  it("waits for the server to make its backups of the files the store holds before it asks their deletion", () => {
    const names = fixtureNames(run);
    // Every file is in the store, and the sync has not passed since.
    const target = installation();
    const events: string[] = [];

    place(target, slight());
    passing(target);
    const from = runner(target, [], traced(events));

    expect(target.placement()?.state).toBe("stored");
    expect(removed(from)).toMatchObject({
      deleted: [names.syncedBackup, names.syncedBackupWithoutLog],
      written: [],
      passes: 1,
    });
    // The record stays as it was while the server is waited for, and says the removal before the first
    // request. The journal learns each backup, which no placement entered, when its deletion is asked, and
    // forgets it with its request once the server removed both.
    expect(events).toEqual([
      "get",
      ...tabKeys().map((path) => `HEAD ${path}`),
      "get",
      "keep clearing",
      "save",
      "get",
      "save",
      `apply ${names.syncedBackup}-delete`,
      "save",
      "get",
      "save",
      "get",
      "save",
      "get",
      "save",
      `apply ${names.syncedBackupWithoutLog}-delete`,
      "save",
      "get",
      "save",
      "get",
      ...tabKeys().map((path) => `HEAD ${path}`),
      "get",
      "keep cleared",
    ]);
    expect(remains(target, from.entries)).toEqual(NOTHING_LEFT);
    // A pass of the sync that listed the store before the files were written, and ends after, creates no
    // backup: the server is not taken for one that makes none before the pass after it ended.
    const early = installation();
    const listed = early.listing();

    place(early, slight());
    early.pass(early.runtime.elapsed() + 70_000, { listed });
    for (const minutes of [3, 5, 7]) early.pass(early.runtime.elapsed() + minutes * 60_000);
    const late = runner(early);

    expect(listed).toEqual([names.backup]);
    expect(removed(late)).toMatchObject({ deleted: [names.syncedBackup, names.syncedBackupWithoutLog], passes: 2 });
    expect(remains(early, late.entries)).toEqual(NOTHING_LEFT);
    // A backup someone removed from the cluster alone, with its files left in the store, is one the server
    // creates again: the journal takes the identity it has now, and the deletion is asked of that one.
    const { target: again, entries } = tabsInPlace();
    const before = entries.find((entry) => entry.name === names.syncedBackup)?.uid;
    const requested: KubeResource[] = [];

    again.objects.delete(`backup/velero-demo/${names.syncedBackup}`);
    const second = runner(again, entries, (what, call) => (...given) => {
      if (what === "apply") requested.push(structuredClone(given[0] as KubeResource));
      return call(...given);
    });

    expect(removed(second).deleted).toEqual([names.syncedBackupWithoutLog, names.syncedBackup]);
    expect(requested[1].metadata.labels?.["velero.io/backup-uid"]).toMatch(/^uid-\d+$/);
    expect(requested[1].metadata.labels?.["velero.io/backup-uid"]).not.toBe(before);
    expect(remains(again, second.entries)).toEqual(NOTHING_LEFT);
    // What the journal says of a backup while its deletion is asked is the identity the cluster gives it:
    // of one the server created again, and of one no placement entered. A removal that stops there leaves
    // it so.
    for (const known of [true, false]) {
      const scene = tabsInPlace();
      const identity = () => scene.target.find("Backup", "velero-demo", names.syncedBackup)?.metadata.uid;
      const earlier = identity();

      scene.target.told.deletes = Number.POSITIVE_INFINITY;
      scene.target.objects.delete(`backup/velero-demo/${names.syncedBackup}`);
      scene.target.objects.delete(`backup/velero-demo/${names.syncedBackupWithoutLog}`);
      const third = runner(scene.target, known ? scene.entries : []);

      expect(stopped(() => removed(third))).toContain(`The server did not delete the backup ${names.syncedBackup}`);
      expect(identity()).not.toBe(earlier);
      expect(third.left().filter((entry) => entry.name === names.syncedBackup)).toEqual([
        {
          apiVersion: "velero.io/v1",
          kind: "Backup",
          name: names.syncedBackup,
          namespace: "velero-demo",
          uid: identity(),
        },
      ]);
    }
  });

  it("stops on files of the tabs the server makes no backup of, names them, and says that the way out is to take the environment down", () => {
    const names = fixtureNames(run);
    const paths = tabArtifactPaths(run);
    const waitedFor = (backups: string) =>
      `The server was waited for, 2 passes of its sync at most, and it made no backup of ${backups} from the ` +
      "metadata the store holds.";
    // The metadata of both folders is not a backup the server reads.
    const neither = installation();

    place(neither, slight());
    for (const metadata of [paths.synced.metadata, paths.withoutLog.metadata])
      neither.store.set(metadata, Buffer.from("not a backup"));
    passing(neither);
    const events: string[] = [];
    const first = runner(neither, [], traced(events));
    const began = neither.runtime.elapsed();
    const held = [...neither.store.entries()];

    expect(stopped(() => removed(first))).toBe(
      `${waitedFor(`${names.syncedBackup} and ${names.syncedBackupWithoutLog}`)} ${leftWith(tabKeys())}`,
    );
    // It waited two passes that ended, asked the store again, and changed nothing: no request, no file, and
    // the record as it was.
    expect(events).toEqual([
      "get",
      ...tabKeys().map((path) => `HEAD ${path}`),
      "get",
      ...tabKeys().map((path) => `HEAD ${path}`),
    ]);
    expect(neither.runtime.elapsed() - began).toBeGreaterThanOrEqual(120_000 + 44_000);
    expect(neither.runtime.elapsed() - began).toBeLessThan(180_000 + 44_000);
    expect(neither.placement()?.state).toBe("stored");
    expect([...neither.store.entries()]).toEqual(held);
    expect(first.left()).toEqual([]);
    // One of the two: the backup the server made is deleted, and what is named is what is left.
    const one = installation();

    place(one, slight());
    one.store.set(paths.withoutLog.metadata, gz("{}"));
    passing(one);
    const second = runner(one);

    expect(stopped(() => removed(second))).toBe(
      `${waitedFor(names.syncedBackupWithoutLog)} ${leftWith(Object.values(paths.withoutLog))}`,
    );
    expect(remains(one, second.entries)).toEqual({
      objects: [],
      keys: Object.values(paths.withoutLog),
      entries: [],
      state: "clearing",
    });
    // A second removal does not wait for more than the first did, and stops with the same words.
    expect(stopped(() => removed(runner(one, second.left())))).toBe(
      `${waitedFor(names.syncedBackupWithoutLog)} ${leftWith(Object.values(paths.withoutLog))}`,
    );
  });

  it("finishes the folder a placement that was stopped left, from what was recorded and while the placement is recorded as storing, so that the server deletes it", () => {
    const names = fixtureNames(run);
    const paths = tabArtifactPaths(run);
    const order = tabKeys();
    // Stopped at the fourth file of the first folder: the contents, the log and the results are there.
    const target = stoppedPlacement(order[3]);
    const began = target.placement() as TabPlacement;
    // The metadata that was recorded is told from the one that would be made now by a line that ends it.
    const metadata = { synced: `${began.metadata.synced}\n`, withoutLog: `${began.metadata.withoutLog}\n` };
    const written: string[] = [];
    const events: string[] = [];

    target.record({ ...began, metadata });
    // The real backup is gone, and its files: nothing of it is needed.
    target.objects.delete(`backup/velero-demo/${names.backup}`);
    target.store.delete(fixtureArtifactPaths(run).backupLog);
    passing(target);
    target.told.keep = (bytes) => {
      written.push(Buffer.from(bytes).toString("utf8"));
      return bytes;
    };
    const from = runner(target, [], traced(events));

    expect(removed(from)).toEqual({
      deleted: [names.syncedBackup],
      written: [paths.synced.metadata],
      passes: 1,
      waited: expect.any(Number),
    });
    // The store is asked for each key. The contents are there with their length, and are not sent again;
    // the metadata is sent last, as it was recorded, the way the placement found. Then the server is waited
    // for, and the removal is recorded before its deletion is asked.
    expect(events).toEqual([
      "get",
      ...order.map((path) => `HEAD ${path}`),
      `PUT ${paths.synced.metadata}`,
      `HEAD ${paths.synced.metadata}`,
      "get",
      ...Object.values(paths.withoutLog).map((path) => `HEAD ${path}`),
      "keep clearing",
      "save",
      "get",
      "save",
      `apply ${names.syncedBackup}-delete`,
      "save",
      "get",
      "save",
      "get",
      ...order.map((path) => `HEAD ${path}`),
      "get",
      "keep cleared",
    ]);
    expect(written).toEqual([metadata.synced]);
    expect(target.requests.filter((request) => request.way).at(-1)).toEqual({
      method: "PUT",
      path: paths.synced.metadata,
      way: "upload",
      bytes: Buffer.byteLength(metadata.synced),
    });
    expect(remains(target, from.entries)).toEqual(NOTHING_LEFT);
    // Contents the store does not hold whole are sent again before the metadata.
    const cut = stoppedPlacement(order[3]);
    const ways: string[] = [];

    cut.store.set(paths.synced.archive, emptyArchive().subarray(0, 20));
    passing(cut);
    const second = runner(cut, [], traced(ways));

    expect(removed(second).written).toEqual([paths.synced.archive, paths.synced.metadata]);
    expect(ways.slice(12, 16)).toEqual([
      `PUT ${paths.synced.archive}`,
      `HEAD ${paths.synced.archive}`,
      `PUT ${paths.synced.metadata}`,
      `HEAD ${paths.synced.metadata}`,
    ]);
    expect(remains(cut, second.entries)).toEqual(NOTHING_LEFT);
    // Stopped in the second folder, with a backup of the first in the cluster: the second folder is
    // finished before the deletion of the first is asked, since nothing is written once a removal began.
    const half = stoppedPlacement(paths.withoutLog.results);
    const halves: string[] = [];

    half.sync();
    passing(half);
    expect(half.find("Backup", "velero-demo", names.syncedBackup)).toBeDefined();
    const third = runner(half, [], traced(halves));

    expect(removed(third)).toMatchObject({
      deleted: [names.syncedBackup, names.syncedBackupWithoutLog],
      written: [paths.withoutLog.metadata],
    });
    expect(halves.slice(0, 9)).toEqual([
      "get",
      ...Object.values(paths.withoutLog).map((path) => `HEAD ${path}`),
      `PUT ${paths.withoutLog.metadata}`,
      `HEAD ${paths.withoutLog.metadata}`,
      "keep clearing",
    ]);
    expect(halves.filter((event) => event.startsWith("PUT"))).toHaveLength(1);
    expect(remains(half, third.entries)).toEqual(NOTHING_LEFT);
    // A store that does not keep the metadata: the removal stops with the keys that are left, and the
    // placement is still recorded as storing.
    const refusing = stoppedPlacement(order[3]);

    refusing.told.answer = ({ method }) => (method === "PUT" ? 403 : undefined);
    expect(stopped(() => removed(runner(refusing)))).toBe(
      `The store did not keep ${paths.synced.metadata} (upload: answered 403). ${leftWith(order.slice(0, 3))}`,
    );
    expect(refusing.placement()?.state).toBe("storing");
    expect(refusing.asked).toEqual(["get", "get"]);
    // A placement that was stopped before the way of the store was recorded finds it as a placement does.
    const wayless = stoppedPlacement(order[3]);
    const { way: _way, ...without } = wayless.placement() as TabPlacement;

    wayless.record(without);
    wayless.told.answer = ({ method, way }) => (method === "PUT" && way === "upload" ? 403 : undefined);
    passing(wayless);
    const fourth = runner(wayless);

    expect(removed(fourth).written).toEqual([paths.synced.metadata]);
    expect(wayless.placement()).toMatchObject({ state: "cleared", way: "data" });
    expect(remains(wayless, fourth.entries)).toEqual(NOTHING_LEFT);
  });

  it("finishes no folder once the placement of the tabs ended or their removal began: it deletes what the server made a backup of, and stops on the rest by its keys", () => {
    const names = fixtureNames(run);
    const paths = tabArtifactPaths(run);
    const strayOf = (backups: string, state: string) =>
      `The store holds no metadata of ${backups}, which the server makes a backup from, and a folder is ` +
      `finished only while the placement of the tabs is recorded as storing: it is recorded as ${state}.`;
    const rest = Object.values(paths.withoutLog).slice(0, -1);
    // Every file was stored, and the metadata of the second folder is gone since.
    const target = installation();

    place(target, slight());
    target.store.delete(paths.withoutLog.metadata);
    passing(target);
    const from = runner(target);
    const sent = target.requests.length;

    // The first backup is made by the server, and deleted; the second folder is left as it is.
    expect(stopped(() => removed(from))).toBe(`${strayOf(names.syncedBackupWithoutLog, "clearing")} ${leftWith(rest)}`);
    expect(remains(target, from.entries)).toEqual({ objects: [], keys: rest, entries: [], state: "clearing" });
    expect(target.requests.slice(sent).filter(({ method }) => method !== "HEAD")).toEqual([]);
    // With no backup to delete nothing is asked of the server at all, and the record stays what it was.
    for (const state of ["stored", "synced", "clearing", "cleared"] as const) {
      const stray = installation();

      place(stray, slight());
      for (const metadata of [paths.synced.metadata, paths.withoutLog.metadata]) stray.store.delete(metadata);
      stray.record({ ...(stray.placement() as TabPlacement), state });
      const before = stray.requests.length;
      const left = tabKeys().filter((path) => !path.endsWith("velero-backup.json"));

      expect([state, stopped(() => removed(runner(stray)))]).toEqual([
        state,
        `${strayOf(`${names.syncedBackup} and ${names.syncedBackupWithoutLog}`, state)} ${leftWith(left)}`,
      ]);
      expect(stray.placement()?.state).toBe(state);
      expect(stray.requests.slice(before).map(({ method }) => method)).toEqual(Array(11).fill("HEAD"));
      expect(stray.asked).toEqual(["get", "get"]);
    }
    // A key the server left behind a backup it deleted is told the same way.
    const { target: leaving, entries } = tabsInPlace();

    leaving.told.between = () => {
      if (!leaving.store.has(paths.synced.results)) leaving.store.set(paths.synced.results, Buffer.from("left"));
    };
    const second = runner(leaving, entries);

    expect(stopped(() => removed(second))).toBe(
      `${strayOf(names.syncedBackup, "clearing")} ${leftWith([paths.synced.results])}`,
    );
    expect(remains(leaving, second.entries)).toMatchObject({ objects: [], keys: [paths.synced.results] });
    // A folder the server made no backup of and one without its metadata are told together.
    const both = installation();

    place(both, slight());
    both.store.set(paths.synced.metadata, Buffer.from("not a backup"));
    both.store.delete(paths.withoutLog.metadata);
    passing(both);
    expect(stopped(() => removed(runner(both)))).toBe(
      `The server was waited for, 2 passes of its sync at most, and it made no backup of ${names.syncedBackup} ` +
        `from the metadata the store holds. ${strayOf(names.syncedBackupWithoutLog, "stored")} ` +
        `${leftWith([...Object.values(paths.synced), ...rest])}`,
    );
  });

  it("asks again for a backup the server created again after it deleted it, three times at most for a name, and stops on one that is there after them", () => {
    const names = fixtureNames(run);
    // What a server would create again from a metadata it read before the files went: the backup as it
    // was, under another identity and with no file behind it, by a pass that listed its folder.
    const comesBack = (target: Installation) => {
      const again = structuredClone(target.find("Backup", "velero-demo", names.syncedBackup)) as KubeResource;

      for (const given of ["uid", "resourceVersion", "creationTimestamp"] as const)
        delete (again.metadata as Record<string, unknown>)[given];
      return () => {
        if (!target.find("Backup", "velero-demo", names.syncedBackup)) held(target, again);
        target.sync({ listed: [names.backup, names.syncedBackup, names.syncedBackupWithoutLog] });
      };
    };
    const { target, entries, began } = tabsInPlace(false);
    const before = String(target.find("Backup", "velero-demo", names.syncedBackup)?.metadata.uid);
    const again = structuredClone(target.find("Backup", "velero-demo", names.syncedBackup)) as KubeResource;
    const requested: KubeResource[] = [];
    const events: string[] = [];
    const from = runner(target, entries, (what, call) =>
      traced(events)(what, (...given) => {
        if (what === "apply") requested.push(structuredClone(given[0] as KubeResource));
        return call(...given);
      }),
    );

    for (const given of ["uid", "resourceVersion", "creationTimestamp"] as const)
      delete (again.metadata as Record<string, unknown>)[given];
    // Once, while the removal waits for a pass of the sync after the files went, and before that pass
    // ended: the backup is asked for as soon as it is read. The pass after it creates nothing.
    target.at(began + 100_000, () => held(target, again));
    target.pass(began + 400_000);
    expect(removed(from)).toMatchObject({
      deleted: [names.syncedBackup, names.syncedBackupWithoutLog, names.syncedBackup],
      written: [],
      passes: 1,
    });
    // The second request for it is bound to the identity the backup has now: the journal learned the
    // backup again, and had forgotten the request the server removed with the first one.
    expect(requested.map((request) => request.metadata.name)).toEqual([
      `${names.syncedBackup}-delete`,
      `${names.syncedBackupWithoutLog}-delete`,
      `${names.syncedBackup}-delete`,
    ]);
    expect(requested[0].metadata.labels?.["velero.io/backup-uid"]).toBe(before);
    expect(requested[2].metadata.labels?.["velero.io/backup-uid"]).toMatch(/^uid-\d+$/);
    expect(requested[2].metadata.labels?.["velero.io/backup-uid"]).not.toBe(before);
    expect(events.slice(-33)).toEqual([
      ...tabKeys().map((path) => `HEAD ${path}`),
      "get",
      "save",
      "get",
      "save",
      `apply ${names.syncedBackup}-delete`,
      "save",
      "get",
      "save",
      "get",
      ...tabKeys().map((path) => `HEAD ${path}`),
      "get",
      "keep cleared",
    ]);
    expect(remains(target, from.entries)).toEqual(NOTHING_LEFT);
    // Every time: a server that creates the backup again within half a minute of each deletion.
    const stubborn = tabsInPlace(false);
    const everyTime = comesBack(stubborn.target);
    const asked: string[] = [];
    const second = runner(stubborn.target, stubborn.entries, traced(asked));

    for (let at = 30_000; at < 1_800_000; at += 20_000) stubborn.target.at(stubborn.began + at, everyTime);
    expect(stopped(() => removed(second))).toBe(
      `The backup ${names.syncedBackup} is in velero-demo after its deletion was asked of the server 3 times: ` +
        `it is left there, and ${DOWN}.`,
    );
    expect(asked.filter((event) => event === `apply ${names.syncedBackup}-delete`)).toHaveLength(3);
    expect(asked.filter((event) => event === `apply ${names.syncedBackupWithoutLog}-delete`)).toHaveLength(1);
    expect(remains(stubborn.target, second.entries)).toEqual({
      objects: [`backup/velero-demo/${names.syncedBackup}`],
      keys: [],
      entries: [],
      state: "clearing",
    });
    // Created again before the removal read the cluster once more: the backup of that name is another one,
    // whose deletion was not asked. The wait for the first ends, and the other is asked for.
    const quick = tabsInPlace();
    const earlier = String(quick.target.find("Backup", "velero-demo", names.syncedBackup)?.metadata.uid);
    const bound: unknown[] = [];
    const third = runner(quick.target, quick.entries, (what, call) => (...given) => {
      if (what === "apply") bound.push((given[0] as KubeResource).metadata.labels?.["velero.io/backup-uid"]);
      return call(...given);
    });

    // The request is made eight seconds in, after the read of the removal and the one of the runner, and the
    // server acts on it three seconds later.
    quick.target.at(quick.began + 11_500, comesBack(quick.target));
    expect(removed(third).deleted).toEqual([names.syncedBackup, names.syncedBackup, names.syncedBackupWithoutLog]);
    expect(bound[0]).toBe(earlier);
    expect(bound[1]).not.toBe(earlier);
    expect(quick.target.runtime.elapsed() - quick.began).toBeLessThan(180_000);
    expect(remains(quick.target, third.entries)).toEqual(NOTHING_LEFT);
    // There when the wait for the pass reads it, and gone a moment later, removed by a pass of the sync that
    // found no folder of it: its deletion is asked on the read that found it, and the request the server
    // then ends with an error, since the backup is not there, is removed at the end by its identity.
    const brief = tabsInPlace(false);
    const flicker = comesBack(brief.target);
    let came = false;
    let found = false;
    const fifth = runner(brief.target, brief.entries, (what, call) => (...given) => {
      const answer = call(...given);

      // The pass that removes it ends right after the read that found it, before anything else is read.
      if (what === "kubectl" && came && !found && brief.target.find("Backup", "velero-demo", names.syncedBackup)) {
        found = true;
        brief.target.at(brief.target.runtime.elapsed() + 1, () => brief.target.sync({ listed: [names.backup] }));
      }
      return answer;
    });

    brief.target.at(brief.began + 100_000, () => {
      if (!brief.target.find("Backup", "velero-demo", names.syncedBackup)) {
        flicker();
        came = true;
      }
    });
    brief.target.pass(brief.began + 300_000);
    expect(removed(fifth).deleted).toEqual([names.syncedBackup, names.syncedBackupWithoutLog, names.syncedBackup]);
    expect(brief.target.orphaned).toEqual([`backup/velero-demo/${names.syncedBackup}`]);
    expect(brief.target.removed).toEqual([`deletebackuprequest/velero-demo/${names.syncedBackup}-delete`]);
    expect(remains(brief.target, fifth.entries)).toEqual(NOTHING_LEFT);
    // A request of the run the server ended without an error, for a backup of that name that is there: the
    // server does not look at it again, whatever it ended with, and it is replaced.
    const ended = tabsInPlace();
    const earlierRequest = fixtureDeletionRequest("synthetic-owner", run, "uid-of-before", names.syncedBackup);
    const replaced: string[] = [];

    held(ended.target, { ...earlierRequest, status: { phase: "Processed" } });
    const fourth = runner(
      ended.target,
      [
        ...ended.entries,
        {
          apiVersion: "velero.io/v1",
          kind: "DeleteBackupRequest",
          name: earlierRequest.metadata.name,
          namespace: "velero-demo",
          uid: String(
            ended.target.find("DeleteBackupRequest", "velero-demo", earlierRequest.metadata.name)?.metadata.uid,
          ),
        },
      ],
      traced(replaced),
    );

    expect(removed(fourth).deleted).toEqual([names.syncedBackup, names.syncedBackupWithoutLog]);
    expect(replaced.slice(0, 7)).toEqual([
      "get",
      "keep clearing",
      `delete /apis/velero.io/v1/namespaces/velero-demo/deletebackuprequests/${earlierRequest.metadata.name}`,
      "save",
      "get",
      "save",
      `apply ${earlierRequest.metadata.name}`,
    ]);
    expect(ended.target.runtime.elapsed() - ended.began).toBeLessThan(180_000);
    expect(remains(ended.target, fourth.entries)).toEqual(NOTHING_LEFT);
  });

  it("puts back the contents of a backup the server could not read, recorded before they are written and over a key that is there, and asks the deletion again", () => {
    const names = fixtureNames(run);
    const paths = tabArtifactPaths(run);
    const { archive } = paths.synced;
    const request = `${names.syncedBackup}-delete`;
    const reported =
      `The controller reported a fixture backup-deletion error for ${names.syncedBackup}, which the private log ` +
      "of the operations holds, and left the backup in velero-demo with its files. Run the command again: when " +
      "the contents the store holds of the backup are not the ones that were stored they are put back, and the " +
      `deletion is asked again. Otherwise ${DOWN}.`;
    // The store holds a part of the contents of the first backup: the server cannot read them, ends the
    // request with an error and leaves the backup in deletion. The removal stops on that error.
    const failed = () => {
      const { target, entries } = tabsInPlace();

      target.store.set(archive, emptyArchive().subarray(0, 20));
      const sent = target.requests.length;
      const first = runner(target, entries);

      expect(stopped(() => removed(first))).toBe(reported);
      expect(target.find("Backup", "velero-demo", names.syncedBackup)?.status).toMatchObject({ phase: "Deleting" });
      expect(target.find("DeleteBackupRequest", "velero-demo", request)?.status).toEqual({
        phase: "Processed",
        errors: ["error invoking delete item actions"],
      });
      // Nothing was given to the store, the second backup was not asked for, and the record says the removal.
      expect(target.requests.slice(sent)).toEqual([]);
      expect(target.find("Backup", "velero-demo", names.syncedBackupWithoutLog)?.status).toMatchObject({
        phase: "Completed",
      });
      expect(target.placement()?.state).toBe("clearing");
      expect(target.placement()?.repaired).toBeUndefined();
      return { target, left: first.left() };
    };
    const { target, left } = failed();
    const events: string[] = [];
    const bodies = target.requests.filter(({ way }) => way).length;
    const second = runner(target, left, traced(events));

    // The removal called again asks the store what it holds of the contents, records that it puts them
    // back, writes them over the key and asks their length; then it removes the request the server ended,
    // by its identity, and asks the deletion again, which the server takes for a backup in deletion.
    expect(removed(second)).toMatchObject({
      deleted: [names.syncedBackup, names.syncedBackupWithoutLog],
      written: [archive],
    });
    expect(events.slice(0, 13)).toEqual([
      "get",
      `HEAD ${archive}`,
      "keep clearing",
      `PUT ${archive}`,
      `HEAD ${archive}`,
      `delete /apis/velero.io/v1/namespaces/velero-demo/deletebackuprequests/${request}`,
      "save",
      "get",
      "save",
      `apply ${request}`,
      "save",
      "get",
      "save",
    ]);
    expect(
      target.recorded.filter(({ repaired }) => repaired).map(({ state, repaired, sent }) => [state, repaired, sent])[0],
    ).toEqual(["clearing", [archive], bodies]);
    expect(target.requests.filter(({ way }) => way).slice(bodies)).toEqual([
      { method: "PUT", path: archive, way: "upload", bytes: emptyArchive().length },
    ]);
    expect(target.removed).toEqual([`deletebackuprequest/velero-demo/${request}`]);
    expect(remains(target, second.entries)).toEqual(NOTHING_LEFT);
    expect(target.placement()?.repaired).toEqual([archive]);
    // Contents that are the ones that were stored are not written again, and contents the store does not
    // hold are not created: the request is replaced, and nothing is given to the store.
    for (const mend of [
      (broken: Installation) => broken.store.set(archive, emptyArchive()),
      (broken: Installation) => broken.store.delete(archive),
    ]) {
      const broken = failed();
      const again: string[] = [];
      const third = runner(broken.target, broken.left, traced(again));

      mend(broken.target);
      expect(removed(third).written).toEqual([]);
      expect(again.slice(0, 4)).toEqual([
        "get",
        `HEAD ${archive}`,
        `delete /apis/velero.io/v1/namespaces/velero-demo/deletebackuprequests/${request}`,
        "save",
      ]);
      expect(again.filter((event) => event.startsWith("PUT"))).toEqual([]);
      expect(broken.target.placement()?.repaired).toBeUndefined();
      expect(remains(broken.target, third.entries)).toEqual(NOTHING_LEFT);
    }
    // A deletion the server ended with an error of the store, which the pretend server never meets: it
    // could not read the contents for a reason that is not theirs, with every file left, or could not
    // remove a key, with a part of the files gone, the contents among them. The backup is left in deletion
    // either way. The request is replaced, and nothing is given to the store.
    for (const lost of [[], [archive, paths.synced.log]]) {
      const { target: erred, entries: before } = tabsInPlace();
      const again: string[] = [];
      const found = erred.find("Backup", "velero-demo", names.syncedBackup)?.status as { phase: string };
      const asked = fixtureDeletionRequest(
        "synthetic-owner",
        run,
        String(erred.find("Backup", "velero-demo", names.syncedBackup)?.metadata.uid),
        names.syncedBackup,
      );

      erred.told.deletes = Number.POSITIVE_INFINITY;
      held(erred, { ...asked, status: { phase: "Processed", errors: ["a synthetic error of the store"] } });
      erred.told.deletes = undefined;
      found.phase = "Deleting";
      for (const path of lost) erred.store.delete(path);
      const bodies = erred.requests.filter(({ way }) => way).length;
      const seventh = runner(
        erred,
        [
          ...before,
          {
            apiVersion: "velero.io/v1",
            kind: "DeleteBackupRequest",
            name: request,
            namespace: "velero-demo",
            uid: String(erred.find("DeleteBackupRequest", "velero-demo", request)?.metadata.uid),
          },
        ],
        traced(again),
      );

      expect([lost, removed(seventh)]).toEqual([
        lost,
        expect.objectContaining({ deleted: [names.syncedBackup, names.syncedBackupWithoutLog], written: [] }),
      ]);
      expect(again.slice(0, 5)).toEqual([
        "get",
        "keep clearing",
        `HEAD ${archive}`,
        `delete /apis/velero.io/v1/namespaces/velero-demo/deletebackuprequests/${request}`,
        "save",
      ]);
      expect(erred.requests.filter(({ way }) => way)).toHaveLength(bodies);
      expect(erred.placement()?.repaired).toBeUndefined();
      expect(erred.removed).toEqual([`deletebackuprequest/velero-demo/${request}`]);
      expect(remains(erred, seventh.entries)).toEqual(NOTHING_LEFT);
    }
    // A request the server ended with an error for a backup it did not begin to delete is replaced, and
    // the store is not asked for the contents: the server did not read them.
    const refused = tabsInPlace();
    const location = refused.target.find("BackupStorageLocation", "velero-demo", "default")?.status as {
      phase: string;
    };
    const fourth: string[] = [];

    location.phase = "Unavailable";
    held(
      refused.target,
      fixtureDeletionRequest(
        "synthetic-owner",
        run,
        String(refused.target.find("Backup", "velero-demo", names.syncedBackup)?.metadata.uid),
        names.syncedBackup,
      ),
    );
    refused.target.runtime.kubectl(["get", "backups.velero.io", "--namespace", "velero-demo", "-o", "json"]);
    location.phase = "Available";
    expect(refused.target.find("DeleteBackupRequest", "velero-demo", request)?.status).toMatchObject({
      phase: "Processed",
      errors: [expect.stringContaining("Unavailable state")],
    });
    const known = [
      ...refused.entries,
      {
        apiVersion: "velero.io/v1",
        kind: "DeleteBackupRequest",
        name: request,
        namespace: "velero-demo",
        uid: String(refused.target.find("DeleteBackupRequest", "velero-demo", request)?.metadata.uid),
      },
    ];
    const fifth = runner(refused.target, known, traced(fourth));

    expect(removed(fifth).written).toEqual([]);
    expect(fourth.slice(0, 4)).toEqual([
      "get",
      "keep clearing",
      `delete /apis/velero.io/v1/namespaces/velero-demo/deletebackuprequests/${request}`,
      "save",
    ]);
    expect(remains(refused.target, fifth.entries)).toEqual(NOTHING_LEFT);
    // A store that does not keep the contents: the removal stops, the request is left, and the deletion is
    // not asked again.
    const unkept = failed();
    const sixth: string[] = [];

    unkept.target.told.answer = ({ method }) => (method === "PUT" ? 500 : undefined);
    expect(stopped(() => removed(runner(unkept.target, unkept.left, traced(sixth))))).toBe(
      `The store did not keep ${archive} (upload: answered 500): the contents of the backup ` +
        `${names.syncedBackup} are not the ones that were stored, and its deletion is not asked again. While it ` +
        `is in velero-demo, ${DOWN}.`,
    );
    expect(sixth).toEqual(["get", `HEAD ${archive}`, "keep clearing", `PUT ${archive}`]);
    expect(unkept.target.find("DeleteBackupRequest", "velero-demo", request)?.status).toMatchObject({
      phase: "Processed",
    });
    expect(unkept.target.placement()).toMatchObject({ state: "clearing", repaired: [archive] });
  });

  it("asks the deletion of no backup that is not one the server created for this run, that did not end, or that a restore of another owner names", () => {
    const names = fixtureNames(run);
    const second = names.syncedBackupWithoutLog;
    const other =
      `The backup ${second} of velero-demo is not one the server created for this run from the store, and its ` +
      `deletion is not asked: ${DOWN}.`;
    const labelled = (change: (labels: Record<string, string>) => void) => (target: Installation) =>
      change(target.find("Backup", "velero-demo", second)?.metadata.labels as Record<string, string>);
    const phased = (phase: string | undefined) => (target: Installation) => {
      const found = target.find("Backup", "velero-demo", second) as { status?: { phase?: string } };

      if (phase) (found.status as { phase: string }).phase = phase;
      else delete found.status;
    };
    const asking = (labels: Record<string, string>) => (target: Installation) =>
      held(target, {
        apiVersion: "velero.io/v1",
        kind: "DeleteBackupRequest",
        metadata: { name: `${second}-delete`, namespace: "velero-demo", labels },
        spec: { backupName: second },
        status: { phase: "InProgress" },
      });
    const restoring = (labels: Record<string, string>) => (target: Installation) =>
      held(target, {
        apiVersion: "velero.io/v1",
        kind: "Restore",
        metadata: { name: "synthetic-restore", namespace: "velero-demo", labels },
        spec: { backupName: second },
      });
    const ours = { [OWNER_LABEL]: "synthetic-owner", [FIXTURE_LABEL]: run };

    // The second of the two is not what it is taken for: nothing is asked for the first either.
    for (const [change, words] of [
      [labelled((labels) => Object.assign(labels, { [OWNER_LABEL]: "another-owner" })), other],
      [labelled((labels) => Object.assign(labels, { [FIXTURE_LABEL]: "b1b2b3b4" })), other],
      [labelled((labels) => Object.assign(labels, { [FIXTURE_MODE]: "live" })), other],
      [labelled((labels) => Object.assign(labels, { "velero.io/storage-location": "another" })), other],
      [
        labelled((labels) => {
          delete labels[OWNER_LABEL];
        }),
        other,
      ],
      // A request is bound to the identity of its backup: one that has none is not asked for.
      [
        (target: Installation) => {
          delete target.find("Backup", "velero-demo", second)?.metadata.uid;
        },
        other,
      ],
      [
        phased("InProgress"),
        `The backup ${second} is InProgress, and the deletion of a backup that did not end is not asked: run the ` +
          "command again once it ended.",
      ],
      [
        phased("ReadyToStart"),
        `The backup ${second} is ReadyToStart, and the deletion of a backup that did not end is not asked: run ` +
          "the command again once it ended.",
      ],
      [
        phased(undefined),
        `The backup ${second} is in no phase, and the deletion of a backup that did not end is not asked: run the ` +
          "command again once it ended.",
      ],
      [
        restoring({ ...ours, [FIXTURE_LABEL]: "b1b2b3b4" }),
        `The restore synthetic-restore names the backup ${second} and is not of this run: the server would ` +
          `delete it with the backup, and the deletion is not asked. While it is there, ${DOWN}.`,
      ],
      [
        restoring({}),
        `The restore synthetic-restore names the backup ${second} and is not of this run: the server would ` +
          `delete it with the backup, and the deletion is not asked. While it is there, ${DOWN}.`,
      ],
      [
        asking({ ...ours, [OWNER_LABEL]: "another-owner" }),
        `The request ${second}-delete of velero-demo is not one this run made: ${DOWN}.`,
      ],
      [asking({}), `The request ${second}-delete of velero-demo is not one this run made: ${DOWN}.`],
    ] as const) {
      const { target, entries } = tabsInPlace();
      const events: string[] = [];
      const from = runner(target, entries, traced(events));

      target.told.deletes = Number.POSITIVE_INFINITY;
      change(target);
      const objects = structuredClone([...target.objects.entries()]);

      expect([words, stopped(() => removed(from))]).toEqual([words, words]);
      // One read: nothing was recorded, nothing asked of the server or of the store, and nothing changed.
      expect(events).toEqual(["get"]);
      expect(target.placement()?.state).toBe("synced");
      expect([...target.objects.entries()]).toEqual(objects);
      expect(from.left()).toEqual(entries);
    }
    // What is of this run is not refused: a restore of the run that names the backup goes with it, and a
    // request of the run the server has not ended is the one that is waited for.
    for (const change of [restoring(ours), asking(ours)]) {
      const { target, entries } = tabsInPlace();

      change(target);
      const known = target.find("DeleteBackupRequest", "velero-demo", `${second}-delete`);
      const from = runner(target, [
        ...entries,
        ...(known
          ? [
              {
                apiVersion: "velero.io/v1",
                kind: "DeleteBackupRequest",
                name: `${second}-delete`,
                namespace: "velero-demo",
                uid: String(known.metadata.uid),
              },
            ]
          : []),
      ]);

      // The server began that request and does not look at it again: it is not this run that ends it.
      if (known) {
        target.at(target.runtime.elapsed() + 30_000, () => {
          target.objects.delete(`backup/velero-demo/${second}`);
          target.objects.delete(`deletebackuprequest/velero-demo/${second}-delete`);
          for (const path of Object.values(tabArtifactPaths(run).withoutLog)) target.store.delete(path);
        });
      }
      expect(removed(from).deleted).toEqual([names.syncedBackup, second]);
      expect(target.find("Restore", "velero-demo", "synthetic-restore")).toBeUndefined();
      expect(remains(target, from.entries)).toEqual(NOTHING_LEFT);
    }
  });

  it("gives the server three minutes to delete a backup and to have its location available, and five for a pass of its sync, by the time that went by", () => {
    const names = fixtureNames(run);
    const both = `${names.syncedBackup} and ${names.syncedBackupWithoutLog}`;
    // A server that never acts on a request: the bound is of the time, whatever a read costs.
    const unanswered = (cost: number) => {
      const { target, entries } = tabsInPlace();
      const from = runner(target, entries);

      target.told.deletes = Number.POSITIVE_INFINITY;
      target.cost(cost);
      const began = target.runtime.elapsed();
      const asked = target.asked.length;
      const words = stopped(() => removed(from));

      expect(new Set(target.paused.slice(-3))).toEqual(new Set([1000]));
      expect(target.placement()?.state).toBe("clearing");
      // The request is left, entered in the journal with its identity: the next removal finds it.
      expect(from.left().map((entry) => entry.name)).toContain(`${names.syncedBackup}-delete`);
      return { words, waited: target.runtime.elapsed() - began, reads: target.asked.length - asked };
    };
    const undeleted =
      `The server did not delete the backup ${names.syncedBackup} in 3 minutes: the backup is PartiallyFailed, ` +
      `and the request ${names.syncedBackup}-delete is in no phase. Run the command again once the server ` +
      `deleted it; otherwise ${DOWN}.`;

    expect(unanswered(4000)).toEqual({ words: undeleted, waited: 192_000, reads: 39 });
    expect(unanswered(30_000)).toEqual({ words: undeleted, waited: 245_000, reads: 8 });
    // A location that is not available: the deletion is not asked while it is not, and is asked once it is.
    const late = tabsInPlace();
    const status = late.target.find("BackupStorageLocation", "velero-demo", "default")?.status as { phase?: string };
    const moments: number[] = [];
    const from = runner(late.target, late.entries, (what, call) => (...given) => {
      if (what === "apply" || what === "keep") moments.push(late.target.runtime.elapsed() - late.began);
      return call(...given);
    });

    status.phase = "Unavailable";
    late.target.at(late.began + 50_000, () => {
      status.phase = "Available";
    });
    expect(removed(from).deleted).toEqual([names.syncedBackup, names.syncedBackupWithoutLog]);
    expect(moments[0]).toBeGreaterThanOrEqual(50_000);
    expect(remains(late.target, from.entries)).toEqual(NOTHING_LEFT);
    // What is asked once the location is available is decided on a read made then: a backup that went with
    // its files meanwhile is not asked for.
    const meanwhile = tabsInPlace();
    const site = meanwhile.target.find("BackupStorageLocation", "velero-demo", "default")?.status as {
      phase?: string;
    };
    const after = runner(meanwhile.target, meanwhile.entries);

    site.phase = "Unavailable";
    meanwhile.target.at(meanwhile.began + 20_000, () => {
      meanwhile.target.objects.delete(`backup/velero-demo/${names.syncedBackup}`);
      for (const path of Object.values(tabArtifactPaths(run).synced)) meanwhile.target.store.delete(path);
    });
    meanwhile.target.at(meanwhile.began + 50_000, () => {
      site.phase = "Available";
    });
    expect(removed(after).deleted).toEqual([names.syncedBackupWithoutLog]);
    expect(remains(meanwhile.target, after.entries)).toEqual(NOTHING_LEFT);
    // The three minutes are of one wait: a location that is not available twice, a while each time, with a
    // deletion in between, is waited for twice.
    const twice = tabsInPlace();
    const flapping = twice.target.find("BackupStorageLocation", "velero-demo", "default")?.status as {
      phase?: string;
    };
    const through = runner(twice.target, twice.entries);

    flapping.phase = "Unavailable";
    for (const [at, phase] of [
      [100_000, "Available"],
      [112_000, "Unavailable"],
      [212_000, "Available"],
    ] as const) {
      twice.target.at(twice.began + at, () => {
        flapping.phase = phase;
      });
    }
    expect(removed(through).deleted).toEqual([names.syncedBackup, names.syncedBackupWithoutLog]);
    expect(twice.target.runtime.elapsed() - twice.began).toBeGreaterThan(212_000);
    expect(remains(twice.target, through.entries)).toEqual(NOTHING_LEFT);
    // One that stays so: nothing is asked, nothing is recorded, and the words say what was waited for.
    for (const [phase, said] of [
      ["Unavailable", "Unavailable"],
      [undefined, "in no phase, or not there"],
    ] as const) {
      const never = tabsInPlace();
      const events: string[] = [];
      const location = never.target.find("BackupStorageLocation", "velero-demo", "default")?.status as {
        phase?: string;
      };

      location.phase = phase;
      expect(stopped(() => removed(runner(never.target, never.entries, traced(events))))).toBe(
        `The storage location default is ${said}, and the server deletes no backup of a location that is not ` +
          `Available: the deletion of ${both} was not asked in 3 minutes. Run the command again once the ` +
          "location is Available.",
      );
      expect(events).toEqual(["get"]);
      expect(never.target.runtime.elapsed() - never.began).toBeGreaterThanOrEqual(180_000);
      expect(never.target.runtime.elapsed() - never.began).toBeLessThan(190_000);
      expect(never.target.placement()?.state).toBe("synced");
    }
    // While the location is waited for nothing else is asked: a folder a placement left without its
    // metadata is finished at the first read, the store is asked for its keys that once, and the three
    // minutes are of the location alone.
    const paths = tabArtifactPaths(run);
    const half = stoppedPlacement(paths.withoutLog.results);
    const halves: string[] = [];

    half.sync();
    (half.find("BackupStorageLocation", "velero-demo", "default")?.status as { phase: string }).phase = "Unavailable";
    const halfBegan = half.runtime.elapsed();

    expect(stopped(() => removed(runner(half, [], traced(halves))))).toBe(
      "The storage location default is Unavailable, and the server deletes no backup of a location that is not " +
        `Available: the deletion of ${names.syncedBackup} was not asked in 3 minutes. Run the command again once ` +
        "the location is Available.",
    );
    expect(halves).toEqual([
      "get",
      ...Object.values(paths.withoutLog).map((path) => `HEAD ${path}`),
      `PUT ${paths.withoutLog.metadata}`,
      `HEAD ${paths.withoutLog.metadata}`,
      "get",
    ]);
    // A read, the seven requests to the store, and then the three minutes.
    expect(half.runtime.elapsed() - halfBegan).toBeGreaterThanOrEqual(32_000 + 180_000);
    expect(half.runtime.elapsed() - halfBegan).toBeLessThan(32_000 + 190_000);
    expect(half.placement()?.state).toBe("storing");
    // No pass of the sync once the backups and the files are gone: the removal is not called done, and the
    // next one, after a pass, is.
    const still = tabsInPlace(false);
    const last = (
      still.target.find("BackupStorageLocation", "velero-demo", "default")?.status as
        | { lastSyncedTime: string }
        | undefined
    )?.lastSyncedTime;
    const first = runner(still.target, still.entries);

    expect(stopped(() => removed(first))).toBe(
      "No pass of the sync ended in 5 minutes, and the removal of the fixtures of the tabs is not ended before " +
        `one did: the storage location default is Available and its last pass ended at ${last}. Neither the ` +
        "cluster nor the store holds anything of the tabs: run the command again once the server syncs.",
    );
    expect(remains(still.target, first.entries)).toEqual({ ...NOTHING_LEFT, state: "clearing" });
    still.target.pass(still.target.runtime.elapsed() + 90_000);
    const second = runner(still.target, first.left());

    expect(removed(second)).toMatchObject({ deleted: [], written: [], passes: 1 });
    expect(remains(still.target, second.entries)).toEqual(NOTHING_LEFT);
    // The same with a location the sync passes over.
    const over = tabsInPlace(false);

    over.target.at(over.began + 40_000, () => {
      (over.target.find("BackupStorageLocation", "velero-demo", "default")?.status as { phase: string }).phase =
        "Unavailable";
    });
    expect(stopped(() => removed(runner(over.target, over.entries)))).toBe(
      "The storage location default is Unavailable, and the sync passes over a location that is not Available: " +
        "no pass ended in 5 minutes, and the removal of the fixtures of the tabs is not ended before one did. " +
        "Neither the cluster nor the store holds anything of the tabs: run the command again once the location " +
        "is Available.",
    );
    // No pass while a folder waits for the server to make its backup: the keys are told, and nothing says
    // that the environment is to be taken down, since the server did not look yet.
    const unsynced = installation();

    place(unsynced, slight());
    expect(stopped(() => removed(runner(unsynced)))).toBe(
      `No pass of the sync ended in 5 minutes, and ${both} are not in velero-demo: the storage location default ` +
        "is Available and its last pass ended at 2026-10-05T10:04:20Z. What the store holds of the tabs with no " +
        `backup the server would delete it with: ${tabKeys().join(", ")}. Run the command again once the server ` +
        "syncs.",
    );
    expect(unsynced.placement()?.state).toBe("stored");
  });

  it("concludes nothing from a store that does not say whether it holds a key", () => {
    const keys = tabKeys();
    const unknown = (path: string, code: number) =>
      `The store answered ${code} when it was asked whether it holds ${path}: what is left of the tabs is not ` +
      "known, and nothing is concluded from it. Run the command again.";

    // Nothing was written, and the store answers an error for the last key: the tabs are not called removed.
    for (const code of [500, 403, 301]) {
      const target = stoppedPlacement(keys[0]);

      target.told.answer = ({ method, path }) => (method === "HEAD" && path === keys[10] ? code : undefined);
      expect([code, stopped(() => removed(runner(target)))]).toEqual([code, unknown(keys[10], code)]);
      expect(target.placement()?.state).toBe("storing");
    }
    // The backups are gone and the store answers an error: no pass is waited for, and nothing is recorded.
    const { target, entries } = tabsInPlace();
    const from = runner(target, entries);

    target.told.answer = ({ method, path }) => (method === "HEAD" && path === keys[4] ? 503 : undefined);
    expect(stopped(() => removed(from))).toBe(unknown(keys[4], 503));
    expect(remains(target, from.entries)).toEqual({ ...NOTHING_LEFT, state: "clearing" });
    expect(target.requests.slice(-5).map(({ path }) => path)).toEqual(keys.slice(0, 5));
  });

  it("removes by its identity a request of the run the server left with no backup to delete, and stops on one the server has not ended", () => {
    const names = fixtureNames(run);
    const paths = tabArtifactPaths(run);
    const request = `${names.syncedBackup}-delete`;
    const path = `/apis/velero.io/v1/namespaces/velero-demo/deletebackuprequests/${request}`;
    // The tabs were removed, and a request of the run for the first backup is in the cluster: the server
    // ends it with an error, since the backup is not there, and removes no request it ended so.
    const leftover = (state: "clearing" | "cleared", labels?: Record<string, string>, acts = true) => {
      const { target, entries } = tabsInPlace();
      const first = runner(target, entries);
      const asked = fixtureDeletionRequest("synthetic-owner", run, "uid-of-before", names.syncedBackup);

      removed(first);
      target.record({ ...(target.placement() as TabPlacement), state });
      if (!acts) target.told.deletes = Number.POSITIVE_INFINITY;
      held(target, labels ? { ...asked, metadata: { ...asked.metadata, labels } } : asked);
      return {
        target,
        entries: [
          {
            apiVersion: "velero.io/v1",
            kind: "DeleteBackupRequest",
            name: request,
            namespace: "velero-demo",
            uid: String(target.find("DeleteBackupRequest", "velero-demo", request)?.metadata.uid),
          },
        ],
      };
    };

    for (const state of ["clearing", "cleared"] as const) {
      const { target, entries } = leftover(state);
      const events: string[] = [];
      const from = runner(target, entries, traced(events));

      expect([state, removed(from)]).toEqual([
        state,
        { deleted: [], written: [], passes: state === "clearing" ? 1 : 0, waited: expect.any(Number) },
      ]);
      expect(events).toEqual([
        "get",
        ...tabKeys().map((key) => `HEAD ${key}`),
        ...(state === "clearing" ? ["get"] : []),
        `delete ${path}`,
        "save",
        ...(state === "clearing" ? ["keep cleared"] : []),
      ]);
      expect(target.removed).toEqual([`deletebackuprequest/velero-demo/${request}`]);
      expect(remains(target, from.entries)).toEqual(NOTHING_LEFT);
      expect(from.left()).toEqual([]);
    }
    // One the server began and left once the backup and its files were gone is one it takes up no more: it
    // is removed as one it ended is, and the removal ends.
    const begun = tabsInPlace();
    const acts: string[] = [];
    const taken = runner(begun.target, begun.entries, traced(acts));

    begun.target.told.leaves = ["removed"];
    expect(stopped(() => removed(taken))).toBe("");
    expect(acts.slice(-4)).toEqual(["get", `delete ${path}`, "save", "keep cleared"]);
    expect(begun.target.removed).toEqual([`deletebackuprequest/velero-demo/${request}`]);
    expect(remains(begun.target, taken.entries)).toEqual(NOTHING_LEFT);
    expect(taken.left()).toEqual([]);
    // One the server has not looked at is not removed: it may still be acted on.
    const unended = leftover("clearing", undefined, false);

    expect(stopped(() => removed(runner(unended.target, unended.entries)))).toBe(
      `The request ${request} is in no phase and no backup ${names.syncedBackup} is in velero-demo for the ` +
        "server to delete: run the command again once the server processed it.",
    );
    expect(unended.target.removed).toEqual([]);
    expect(unended.target.placement()?.state).toBe("clearing");
    // Nor is one that is not of this run, whatever the server made of it.
    const foreign = leftover("clearing", { [OWNER_LABEL]: "synthetic-owner", [FIXTURE_LABEL]: "b1b2b3b4" });

    expect(stopped(() => removed(runner(foreign.target, foreign.entries)))).toBe(
      `The request ${request} of velero-demo is not one this run made: ${DOWN}.`,
    );
    expect(foreign.target.removed).toEqual([]);
    // A backup a pass of the sync removed before the server acted on its request: the request ends with an
    // error and the files stay. The server makes the backup again from them, and the removal replaces the
    // request and has it deleted with its files.
    const { target, entries, began } = tabsInPlace(false);
    const events: string[] = [];
    const from = runner(target, entries, traced(events));

    target.told.deletes = 10_000;
    target.at(began + 6000, () => target.sync({ listed: [names.backup, names.syncedBackupWithoutLog] }));
    for (const minutes of [2, 3, 4, 5, 6]) target.pass(began + minutes * 60_000);
    expect(removed(from).deleted).toEqual([names.syncedBackup, names.syncedBackupWithoutLog, names.syncedBackup]);
    expect(target.orphaned).toEqual([`backup/velero-demo/${names.syncedBackup}`]);
    expect(events.filter((event) => event.startsWith("delete") || event.startsWith("apply"))).toEqual([
      `apply ${request}`,
      `apply ${names.syncedBackupWithoutLog}-delete`,
      `delete ${path}`,
      `apply ${request}`,
    ]);
    // The store was not asked for the contents of a backup the server did not begin to delete.
    expect(events.filter((event) => event === `HEAD ${paths.synced.archive}`)).toHaveLength(2);
    expect(events.filter((event) => event.startsWith("PUT"))).toEqual([]);
    expect(remains(target, from.entries)).toEqual(NOTHING_LEFT);
  });

  it("applies nothing over a request of the run the server has not ended, and waits for the server to end that one", () => {
    const names = fixtureNames(run);
    const request = `${names.syncedBackup}-delete`;
    // A removal that was stopped left its request for the first backup, and the server acts on it between
    // the read of the removal that takes it up and what that removal does next.
    const { target, entries } = tabsInPlace();
    const first = runner(target, entries);
    const events: string[] = [];

    target.told.deletes = 6000;
    first.runtime.apply(
      fixtureDeletionRequest(
        "synthetic-owner",
        run,
        String(target.find("Backup", "velero-demo", names.syncedBackup)?.metadata.uid),
        names.syncedBackup,
      ),
    );
    target.told.deletes = undefined;
    const second = runner(target, first.left(), traced(events));

    expect(first.left().map((entry) => entry.name)).toContain(request);
    expect(target.find("DeleteBackupRequest", "velero-demo", request)?.status).toBeUndefined();
    // The runner reads an object before it writes over it, and refuses one it entered that is gone: the
    // request that is there is not applied again, and the removal ends.
    expect([stopped(() => removed(second)), events.filter((event) => event.startsWith("apply"))]).toEqual([
      "",
      [`apply ${names.syncedBackupWithoutLog}-delete`],
    ]);
    expect(events.slice(0, 4)).toEqual(["get", "keep clearing", "get", "save"]);
    expect(remains(target, second.entries)).toEqual(NOTHING_LEFT);
    expect(second.left()).toEqual([]);
  });

  it("replaces, once in a removal, a request the server began and left, after the three minutes it is given, and stops on one it leaves again", () => {
    const names = fixtureNames(run);
    const request = `${names.syncedBackup}-delete`;
    const path = `/apis/velero.io/v1/namespaces/velero-demo/deletebackuprequests/${request}`;
    const acts = (events: string[]) =>
      events.filter((event) => event.startsWith("delete") || event.startsWith("apply"));

    // The server marked the request as begun, or the backup as being deleted as well, and was stopped: it
    // takes up no request it began. The removal gives it its three minutes, removes that request by its
    // identity and asks again, and the server, which is back, deletes the backup.
    for (const left of ["begun", "deleting"] as const) {
      const { target, entries, began } = tabsInPlace();
      const events: string[] = [];
      const moments: number[] = [];
      const from = runner(target, entries, (what, call) =>
        traced(events)(what, (...given) => {
          if (what === "apply") moments.push(target.runtime.elapsed() - began);
          return call(...given);
        }),
      );

      target.told.leaves = [left];
      expect([left, stopped(() => removed(from))]).toEqual([left, ""]);
      expect([left, acts(events)]).toEqual([
        left,
        [`apply ${request}`, `delete ${path}`, `apply ${request}`, `apply ${names.syncedBackupWithoutLog}-delete`],
      ]);
      expect(target.removed).toEqual([`deletebackuprequest/velero-demo/${request}`]);
      // The second request came three minutes after the first, and not before.
      expect(moments[1] - moments[0]).toBeGreaterThanOrEqual(180_000);
      expect(moments[1] - moments[0]).toBeLessThan(200_000);
      expect(remains(target, from.entries)).toEqual(NOTHING_LEFT);
      expect(from.left()).toEqual([]);
    }
    // A removal that finds the request so, left by the one before it: nothing is applied over it, it is
    // given the three minutes, and it is replaced.
    const found = tabsInPlace();
    const first = runner(found.target, found.entries);

    found.target.told.leaves = ["deleting"];
    first.runtime.apply(
      fixtureDeletionRequest(
        "synthetic-owner",
        run,
        String(found.target.find("Backup", "velero-demo", names.syncedBackup)?.metadata.uid),
        names.syncedBackup,
      ),
    );
    found.target.runtime.kubectl(["get", "backups.velero.io", "--namespace", "velero-demo", "-o", "json"]);
    expect(found.target.find("DeleteBackupRequest", "velero-demo", request)?.status).toEqual({ phase: "InProgress" });
    expect(found.target.find("Backup", "velero-demo", names.syncedBackup)?.status).toMatchObject({
      phase: "Deleting",
    });
    const taken: string[] = [];
    const second = runner(found.target, first.left(), traced(taken));
    const since = found.target.runtime.elapsed();

    expect(removed(second).deleted).toEqual([names.syncedBackup, names.syncedBackup, names.syncedBackupWithoutLog]);
    expect(taken.slice(0, 7)).toEqual(["get", "keep clearing", "get", `delete ${path}`, "save", "get", "save"]);
    expect(acts(taken)).toEqual([`delete ${path}`, `apply ${request}`, `apply ${names.syncedBackupWithoutLog}-delete`]);
    expect(found.target.runtime.elapsed() - since).toBeGreaterThanOrEqual(180_000);
    expect(remains(found.target, second.entries)).toEqual(NOTHING_LEFT);
    // A server that leaves every deletion it begins: the request is replaced once, and the removal stops on
    // the second, which the next removal finds with its identity in the journal.
    const never = tabsInPlace();
    const stuck: string[] = [];
    const third = runner(never.target, never.entries, traced(stuck));

    never.target.told.leaves = Array(5).fill("deleting");
    expect(stopped(() => removed(third))).toBe(
      `The server did not delete the backup ${names.syncedBackup} in 3 minutes: the backup is Deleting, and the ` +
        `request ${request} is InProgress. The server takes up no request it began, and one is replaced once in ` +
        `a removal: run the command again; otherwise ${DOWN}.`,
    );
    expect(acts(stuck)).toEqual([`apply ${request}`, `delete ${path}`, `apply ${request}`]);
    expect(never.target.runtime.elapsed() - never.began).toBeGreaterThanOrEqual(360_000);
    expect(never.target.runtime.elapsed() - never.began).toBeLessThan(400_000);
    expect(remains(never.target, third.left())).toEqual({
      objects: [
        `backup/velero-demo/${names.syncedBackup}`,
        `backup/velero-demo/${names.syncedBackupWithoutLog}`,
        `deletebackuprequest/velero-demo/${request}`,
      ],
      keys: tabKeys(),
      entries: [
        `Backup/${names.syncedBackup}`,
        `Backup/${names.syncedBackupWithoutLog}`,
        `DeleteBackupRequest/${request}`,
      ],
      state: "clearing",
    });
    // A request the server has not looked at is not one it left: it is not replaced, whatever the time.
    const unseen = tabsInPlace();
    const fourth: string[] = [];

    unseen.target.told.deletes = Number.POSITIVE_INFINITY;
    expect(stopped(() => removed(runner(unseen.target, unseen.entries, traced(fourth))))).toContain(
      `the request ${request} is in no phase. Run the command again once the server deleted it`,
    );
    expect(acts(fourth)).toEqual([`apply ${request}`]);
  });

  it("removes nothing of the tabs without the store, the clock, the journal and the record of the runtime, nor without a placement that is recorded", () => {
    const names = fixtureNames(run);
    const needs =
      "The removal of the fixtures of the tabs needs the store of the environment, the clock of the runtime, the " +
      "journal of the objects of the run, and where the placement of the tabs is recorded";

    for (const lacking of ["store", "elapsed", "tabs", "journal"]) {
      const { target, entries } = tabsInPlace();
      const from = runner(target, entries);
      const asked = target.asked.length;

      expect([
        lacking,
        stopped(() => clearTabFixtures({ ...from.runtime, [lacking]: undefined } as never, run)),
      ]).toEqual([lacking, needs]);
      expect(target.asked).toHaveLength(asked);
    }
    const unrecorded = tabsInPlace();
    const asked = unrecorded.target.asked.length;

    unrecorded.target.record(undefined);
    expect(stopped(() => removed(runner(unrecorded.target, unrecorded.entries)))).toBe(
      "No placement of the tabs is recorded for this run: nothing of them is removed",
    );
    // A record whose metadata is not of the two backups, or names no storage location, is not one to go by.
    const { synced, withoutLog } = (tabsInPlace().target.placement() as TabPlacement).metadata;
    const unlocated = JSON.parse(synced) as { spec: { storageLocation?: string } };

    delete unlocated.spec.storageLocation;
    for (const metadata of [
      { synced: withoutLog, withoutLog: synced },
      { synced, withoutLog: synced },
      { synced: JSON.stringify(unlocated), withoutLog },
      { synced: synced.replace(names.syncedBackup, names.backup), withoutLog },
    ]) {
      const other = tabsInPlace();

      other.target.record({ ...(other.target.placement() as TabPlacement), metadata });
      expect(stopped(() => removed(runner(other.target, other.entries)))).toBe(
        "The metadata that is recorded is not the one of the two backups of this run",
      );
      expect(other.target.asked).toHaveLength(asked);
    }
  });

  // A removal that is stopped at one of the things it does, before that took place or after it did, as a
  // process that is killed is. What the next removal starts from is the journal as it was last saved.
  const stoppedAt = (target: Installation, kept: Recorded[], nth: number, when: "before" | "after") => {
    let count = 0;
    const from = runner(target, kept, (_what, call) => (...given) => {
      count += 1;
      if (count === nth && when === "before") throw new Error("Synthetic interruption");
      const answer = call(...given);

      if (count === nth && when === "after") throw new Error("Synthetic interruption");
      return answer;
    });

    return { words: stopped(() => removed(from)), left: from.left() };
  };

  it("takes up a removal that was stopped at any point, before or after anything it does, and ends with nothing of the tabs left and no file written twice", () => {
    const names = fixtureNames(run);
    const paths = tabArtifactPaths(run);
    // Each scene with the files a removal of it gives the store.
    const scenes: Record<string, () => { target: Installation; entries: Recorded[]; written: string[] }> = {
      "two backups the server created": () => ({ ...tabsInPlace(), written: [] }),
      "a folder a placement left without its metadata": () => {
        const target = stoppedPlacement(tabKeys()[3]);

        passing(target);
        return { target, entries: [], written: [paths.synced.metadata] };
      },
      "contents the server could not read": () => {
        const { target, entries } = tabsInPlace();
        const first = runner(target, entries);

        target.store.set(paths.synced.archive, emptyArchive().subarray(0, 20));
        expect(stopped(() => removed(first))).toContain("The controller reported a fixture backup-deletion error");
        return { target, entries: first.left(), written: [paths.synced.archive] };
      },
      "a backup the server creates again once": () => {
        const { target, entries, began } = tabsInPlace();
        const again = structuredClone(target.find("Backup", "velero-demo", names.syncedBackup)) as KubeResource;

        for (const given of ["uid", "resourceVersion", "creationTimestamp"] as const)
          delete (again.metadata as Record<string, unknown>)[given];
        target.at(began + 100_000, () => {
          held(target, again);
          target.sync({ listed: [names.backup, names.syncedBackup] });
        });
        return { target, entries, written: [] };
      },
    };

    for (const [scene, make] of Object.entries(scenes)) {
      for (const when of ["before", "after"] as const) {
        let points = 0;

        for (let nth = 1; ; nth += 1) {
          const { target, entries, written } = make();
          const sent = target.requests.filter(({ way }) => way).length;
          const first = stoppedAt(target, entries, nth, when);
          const told = [scene, when, nth];

          // Past its last point the removal ends, and there is nothing to take up.
          if (first.words === "") break;
          points = nth;
          expect([...told, first.words]).toEqual([...told, "Synthetic interruption"]);
          const second = runner(target, first.left);

          expect([...told, stopped(() => removed(second))]).toEqual([...told, ""]);
          expect([...told, remains(target, second.entries)]).toEqual([...told, NOTHING_LEFT]);
          expect([...told, second.left()]).toEqual([...told, []]);
          // What the two removals gave the store between them is what one that is not stopped gives it, and
          // contents that were put back are recorded once.
          expect([
            ...told,
            target.requests
              .filter(({ way }) => way)
              .slice(sent)
              .map(({ path }) => path),
          ]).toEqual([...told, written]);
          expect([...told, target.placement()?.repaired ?? []]).toEqual([
            ...told,
            written.filter((path) => path === paths.synced.archive),
          ]);
        }
        expect([scene, when, points > 20]).toEqual([scene, when, true]);
      }
    }
  }, 60_000);

  // The operations the scripts created in the installation, as a cleanup finds them: the real backup with the
  // restore that names it, and the backup that failed its validation, each known to the journal by the
  // identity the cluster gave it. The store holds the log the server wrote for the real backup.
  function operations() {
    const names = fixtureNames(run);
    const target = installation();
    const manifests = refusedFixtures("synthetic-owner", run);

    held(target, { ...manifests.backup, status: REFUSED.backup });
    held(target, { ...liveRestore("synthetic-owner", run), status: { phase: "Completed" } });
    const known = (kind: string, name: string): Recorded => ({
      apiVersion: "velero.io/v1",
      kind,
      name,
      namespace: "velero-demo",
      uid: String(target.find(kind, "velero-demo", name)?.metadata.uid),
    });
    const entries = [
      known("Backup", names.backup),
      known("Backup", names.invalidBackup),
      known("Restore", names.restore),
    ];

    return { names, target, entries, known };
  }
  const deletedBy = (from: ReturnType<typeof runner>, name: string) =>
    removeFixtureBackup(from.runtime as never, run, name);

  it("has the server delete a backup the scripts created, through a request of the run, and waits until it is gone with what names it", () => {
    const { names, target, entries } = operations();
    const events: string[] = [];
    const requested: KubeResource[] = [];
    const from = runner(target, entries, (what, call) =>
      traced(events)(what, (...given) => {
        if (what === "apply") requested.push(structuredClone(given[0] as KubeResource));
        return call(...given);
      }),
    );
    const identity = String(target.find("Backup", "velero-demo", names.backup)?.metadata.uid);
    const reads = target.logged.length;

    // One read of the installation; the request, read by the runner, entered in the journal and created;
    // the reads until the backup is gone, the journal forgetting it and its request; and a read that finds
    // neither.
    expect(deletedBy(from, names.backup)).toEqual({ asked: 1, waited: 16_000 });
    expect(events).toEqual(["get", "save", `apply ${names.backup}-delete`, "save", "get", "save", "get"]);
    expect(requested).toEqual([fixtureDeletionRequest("synthetic-owner", run, identity, names.backup)]);
    // The server removed the files of the backup, the restore that names it, the backup and the request:
    // nothing was removed from here, and every read is in the log of the operations.
    expect(target.removed).toEqual([]);
    expect(target.find("Backup", "velero-demo", names.backup)).toBeUndefined();
    expect(target.find("Restore", "velero-demo", names.restore)).toBeUndefined();
    expect(target.find("DeleteBackupRequest", "velero-demo", `${names.backup}-delete`)).toBeUndefined();
    expect([...target.store.keys()]).toEqual([]);
    expect(target.logged.slice(reads)).toEqual(Array(4).fill(true));
    expect(from.left().map((entry) => `${entry.kind}/${entry.name}`)).toEqual([
      `Backup/${names.invalidBackup}`,
      `Restore/${names.restore}`,
    ]);
    // The one that failed its validation goes the same way, and a second removal of either finds nothing.
    const second = runner(target, from.left());

    expect(deletedBy(second, names.invalidBackup)).toMatchObject({ asked: 1 });
    expect(target.find("Backup", "velero-demo", names.invalidBackup)).toBeUndefined();
    expect(second.left().map((entry) => entry.name)).toEqual([names.restore]);
    const asked = target.asked.length;

    expect(deletedBy(second, names.backup)).toEqual({ asked: 0, waited: 4000 });
    expect(target.asked.slice(asked)).toEqual(["get"]);
    // The server deletes a backup in each phase it ends in, and one a deletion that did not end left.
    for (const phase of ["Completed", "PartiallyFailed", "Failed", "FailedValidation", "Deleting"]) {
      const scene = operations();

      (scene.target.find("Backup", "velero-demo", names.backup)?.status as { phase: string }).phase = phase;
      expect([phase, deletedBy(runner(scene.target, scene.entries), names.backup)]).toEqual([
        phase,
        expect.objectContaining({ asked: 1 }),
      ]);
      expect(scene.target.find("Backup", "velero-demo", names.backup)).toBeUndefined();
    }
    // An entry of the journal without an identity is of a creation that was stopped: the backup is taken.
    const unbound = operations();
    const third = runner(
      unbound.target,
      unbound.entries.map(({ uid, ...entry }) => (entry.name === names.backup ? entry : { ...entry, uid })),
    );

    expect(deletedBy(third, names.backup)).toMatchObject({ asked: 1 });
    expect(unbound.target.find("Backup", "velero-demo", names.backup)).toBeUndefined();
  });

  it("asks the deletion of no backup the scripts did not create for this run, that did not end, or that a restore of another owner names", () => {
    const names = fixtureNames(run);
    const other =
      `The backup ${names.backup} of velero-demo is not the one this run created, and its deletion is not ` +
      `asked: ${DOWN}.`;
    const labelled = (change: (labels: Record<string, string>) => void) => (scene: ReturnType<typeof operations>) =>
      change(scene.target.find("Backup", "velero-demo", names.backup)?.metadata.labels as Record<string, string>);
    const phased = (phase: string) => (scene: ReturnType<typeof operations>) => {
      (scene.target.find("Backup", "velero-demo", names.backup)?.status as { phase: string }).phase = phase;
    };
    const unended = (phase: string) =>
      `The backup ${names.backup} is ${phase}, and the deletion of a backup that did not end is not asked: run ` +
      "the command again once it ended.";

    for (const [change, words] of [
      [labelled((labels) => Object.assign(labels, { [OWNER_LABEL]: "another-owner" })), other],
      [labelled((labels) => Object.assign(labels, { [FIXTURE_LABEL]: "b1b2b3b4" })), other],
      // Another backup of that name than the one the journal knows, and one the journal does not know.
      [
        (scene: ReturnType<typeof operations>) => {
          scene.entries[0].uid = "uid-of-another";
        },
        other,
      ],
      [
        (scene: ReturnType<typeof operations>) => {
          scene.entries.shift();
        },
        other,
      ],
      [
        (scene: ReturnType<typeof operations>) => {
          delete scene.target.find("Backup", "velero-demo", names.backup)?.metadata.uid;
        },
        other,
      ],
      [phased("InProgress"), unended("InProgress")],
      [phased("Queued"), unended("Queued")],
      [phased("WaitingForPluginOperations"), unended("WaitingForPluginOperations")],
      [
        labelledRestore({ [OWNER_LABEL]: "synthetic-owner", [FIXTURE_LABEL]: "b1b2b3b4" }),
        `The restore ${names.restore} names the backup ${names.backup} and is not of this run: the server would ` +
          `delete it with the backup, and the deletion is not asked. While it is there, ${DOWN}.`,
      ],
      [
        requested({ [OWNER_LABEL]: "another-owner", [FIXTURE_LABEL]: run }),
        `The request ${names.backup}-delete of velero-demo is not one this run made: ${DOWN}.`,
      ],
    ] as const) {
      const scene = operations();

      scene.target.told.deletes = Number.POSITIVE_INFINITY;
      change(scene);
      const events: string[] = [];
      const from = runner(scene.target, scene.entries, traced(events));
      const objects = structuredClone([...scene.target.objects.entries()]);

      expect([words, stopped(() => deletedBy(from, names.backup))]).toEqual([words, words]);
      // One read: nothing was asked of the server, and nothing changed.
      expect(events).toEqual(["get"]);
      expect([...scene.target.objects.entries()]).toEqual(objects);
      expect(from.left()).toEqual(scene.entries);
    }
    // No other backup is removed this way, and the removal needs the clock and the journal of the runtime.
    const scene = operations();
    const from = runner(scene.target, scene.entries);

    for (const name of [names.syncedBackup, names.syncedBackupWithoutLog, "another-backup"]) {
      expect([name, stopped(() => deletedBy(from, name))]).toEqual([
        name,
        "Only a backup the scripts created for the run is removed this way",
      ]);
    }
    for (const lacking of ["elapsed", "journal"]) {
      expect([
        lacking,
        stopped(() => removeFixtureBackup({ ...from.runtime, [lacking]: undefined } as never, run, names.backup)),
      ]).toEqual([
        lacking,
        "The removal of a backup of the fixtures needs the clock of the runtime, and the journal of the objects of the run",
      ]);
    }
    expect(scene.target.asked).toEqual([]);

    function labelledRestore(labels: Record<string, string>) {
      return (made: ReturnType<typeof operations>) => {
        (made.target.find("Restore", "velero-demo", names.restore) as { metadata: object }).metadata = {
          ...made.target.find("Restore", "velero-demo", names.restore)?.metadata,
          labels,
        };
      };
    }
    function requested(labels: Record<string, string>) {
      return (made: ReturnType<typeof operations>) =>
        held(made.target, {
          apiVersion: "velero.io/v1",
          kind: "DeleteBackupRequest",
          metadata: { name: `${names.backup}-delete`, namespace: "velero-demo", labels },
          spec: { backupName: names.backup },
        });
    }
  });

  it("replaces a request the server ended for a backup the scripts created, whatever it ended it with, waits for one it has not ended, and replaces once one it began and left", () => {
    const names = fixtureNames(run);
    const request = `${names.backup}-delete`;
    const path = `/apis/velero.io/v1/namespaces/velero-demo/deletebackuprequests/${request}`;
    const acts = (events: string[]) =>
      events.filter((event) => event.startsWith("delete") || event.startsWith("apply"));
    // A request of the run for the real backup, as an earlier cleanup left it, known to the journal.
    const left = (status?: object) => {
      const scene = operations();
      const asked = fixtureDeletionRequest(
        "synthetic-owner",
        run,
        String(scene.target.find("Backup", "velero-demo", names.backup)?.metadata.uid),
        names.backup,
      );

      scene.target.told.deletes = Number.POSITIVE_INFINITY;
      held(scene.target, status ? { ...asked, status } : asked);
      scene.target.told.deletes = undefined;
      return { ...scene, entries: [...scene.entries, scene.known("DeleteBackupRequest", request)] };
    };

    // The server never looks again at a request it ended, with an error or without one: either is removed
    // by its identity, and the deletion is asked again.
    for (const status of [{ phase: "Processed", errors: ["a synthetic error"] }, { phase: "Processed" }]) {
      const scene = left(status);
      const events: string[] = [];
      const from = runner(scene.target, scene.entries, traced(events));

      expect([status, deletedBy(from, names.backup)]).toEqual([status, expect.objectContaining({ asked: 1 })]);
      expect(events.slice(0, 5)).toEqual(["get", `delete ${path}`, "save", "get", "save"]);
      expect(acts(events)).toEqual([`delete ${path}`, `apply ${request}`]);
      expect(scene.target.find("Backup", "velero-demo", names.backup)).toBeUndefined();
      expect(from.left().map((entry) => entry.name)).not.toContain(request);
    }
    // One the server has not ended is waited for: nothing is applied over it, and the server ends it.
    const waiting = left();
    const waited: string[] = [];
    const second = runner(waiting.target, waiting.entries, traced(waited));

    waiting.target.at(waiting.target.runtime.elapsed() + 30_000, () => {
      waiting.target.objects.delete(`backup/velero-demo/${names.backup}`);
      waiting.target.objects.delete(`deletebackuprequest/velero-demo/${request}`);
    });
    expect(deletedBy(second, names.backup)).toMatchObject({ asked: 1 });
    expect(waited).toEqual(["get", "save", "get"]);
    expect(second.left().map((entry) => entry.name)).not.toContain(request);
    // An error the server ends the request with stops the removal, and the next one replaces the request.
    const erring = operations();
    const third = runner(erring.target, erring.entries);

    erring.target.store.set(fixtureArtifactPaths(run).archive, Buffer.from("not an archive"));
    expect(stopped(() => deletedBy(third, names.backup))).toBe(
      `The controller reported a fixture backup-deletion error for ${names.backup}, which the private log of the ` +
        "operations holds, and left the backup in velero-demo with its files. Run the command again: the " +
        `deletion is asked again. Otherwise ${DOWN}.`,
    );
    erring.target.store.delete(fixtureArtifactPaths(run).archive);
    expect(deletedBy(runner(erring.target, third.left()), names.backup)).toMatchObject({ asked: 1 });
    expect(erring.target.find("Backup", "velero-demo", names.backup)).toBeUndefined();
    // One the server began and left is replaced after the three minutes it is given, once; a server that
    // leaves the second as well stops the removal, with the request in the journal for the next one.
    const leaving = operations();
    const begun: string[] = [];
    const fourth = runner(leaving.target, leaving.entries, traced(begun));
    const since = leaving.target.runtime.elapsed();

    leaving.target.told.leaves = ["deleting"];
    expect(deletedBy(fourth, names.backup)).toMatchObject({ asked: 2 });
    expect(acts(begun)).toEqual([`apply ${request}`, `delete ${path}`, `apply ${request}`]);
    expect(leaving.target.runtime.elapsed() - since).toBeGreaterThanOrEqual(180_000);
    expect(leaving.target.runtime.elapsed() - since).toBeLessThan(220_000);
    expect(fourth.left().map((entry) => entry.name)).toEqual([names.invalidBackup, names.restore]);
    const stuck = operations();
    const fifth = runner(stuck.target, stuck.entries);

    stuck.target.told.leaves = ["begun", "begun", "begun"];
    expect(stopped(() => deletedBy(fifth, names.backup))).toBe(
      `The server did not delete the backup ${names.backup} in 3 minutes: the backup is Completed, and the request ` +
        `${request} is InProgress. The server takes up no request it began, and one is replaced once in a ` +
        `removal: run the command again; otherwise ${DOWN}.`,
    );
    expect(fifth.left().map((entry) => entry.name)).toContain(request);
    // A server that does not act at all: three minutes, by the time that went by, and the request is left.
    const idle = operations();
    const sixth = runner(idle.target, idle.entries);

    idle.target.told.deletes = Number.POSITIVE_INFINITY;
    expect(stopped(() => deletedBy(sixth, names.backup))).toBe(
      `The server did not delete the backup ${names.backup} in 3 minutes: the backup is Completed, and the request ` +
        `${request} is in no phase. Run the command again once the server deleted it; otherwise ${DOWN}.`,
    );
    expect(idle.target.removed).toEqual([]);
    // A location that is not available is waited for, three minutes, and nothing is asked meanwhile.
    const away = operations();
    const none: string[] = [];

    (away.target.find("BackupStorageLocation", "velero-demo", "default")?.status as { phase: string }).phase =
      "Unavailable";
    expect(stopped(() => deletedBy(runner(away.target, away.entries, traced(none)), names.backup))).toBe(
      "The storage location default is Unavailable, and the server deletes no backup of a location that is not " +
        `Available: the deletion of ${names.backup} was not asked in 3 minutes. Run the command again once the ` +
        "location is Available.",
    );
    expect(none).toEqual(["get"]);
    // What is asked once the location is available is decided on a read made then: a backup that went
    // meanwhile is not asked for.
    const back = operations();
    const site = back.target.find("BackupStorageLocation", "velero-demo", "default")?.status as { phase: string };
    const seventh: string[] = [];
    const from = back.target.runtime.elapsed();

    site.phase = "Unavailable";
    back.target.at(from + 20_000, () => back.target.objects.delete(`backup/velero-demo/${names.backup}`));
    back.target.at(from + 50_000, () => {
      site.phase = "Available";
    });
    expect(deletedBy(runner(back.target, back.entries, traced(seventh)), names.backup)).toMatchObject({ asked: 0 });
    expect(seventh).toEqual(["get", "save"]);
    expect(back.target.runtime.elapsed() - from).toBeGreaterThanOrEqual(50_000);
    // With the backup gone, a request of the run the server ended, or began and left, is removed by its
    // identity; one it has not looked at is left to it, and one of another run is refused.
    for (const [status, labels, words] of [
      [{ phase: "Processed", errors: ["backup not found"] }, undefined, ""],
      [{ phase: "InProgress" }, undefined, ""],
      [
        undefined,
        undefined,
        `The request ${request} is in no phase and no backup ${names.backup} is in velero-demo for the server to ` +
          "delete: run the command again once the server processed it.",
      ],
      [
        { phase: "Processed" },
        { [OWNER_LABEL]: "synthetic-owner", [FIXTURE_LABEL]: "b1b2b3b4" },
        `The request ${request} of velero-demo is not one this run made: ${DOWN}.`,
      ],
    ] as const) {
      const scene = left(status);

      scene.target.objects.delete(`backup/velero-demo/${names.backup}`);
      if (labels) {
        (scene.target.find("DeleteBackupRequest", "velero-demo", request) as { metadata: object }).metadata = {
          ...scene.target.find("DeleteBackupRequest", "velero-demo", request)?.metadata,
          labels,
        };
      }
      const from = runner(scene.target, scene.entries);

      expect([status, labels, stopped(() => deletedBy(from, names.backup))]).toEqual([status, labels, words]);
      expect(scene.target.removed).toEqual(words ? [] : [`deletebackuprequest/velero-demo/${request}`]);
      if (!words) expect(from.left().map((entry) => entry.name)).toEqual([names.invalidBackup, names.restore]);
    }
  });

  it("calls the operations of a run removed once the installation holds none of them, by their names, and the store none of the keys of the run", () => {
    const names = fixtureNames(run);
    const deletions = [names.backup, names.invalidBackup, names.syncedBackup, names.syncedBackupWithoutLog];
    const named: [kind: string, name: string][] = [
      ...deletions.map((name): [string, string] => ["Backup", name]),
      ...[names.restore, names.invalidRestore, names.orphanRestore].map((name): [string, string] => ["Restore", name]),
      ...deletions.map((name): [string, string] => ["DeleteBackupRequest", `${name}-delete`]),
    ];
    const entry = (kind: string, name: string, namespace = "velero-demo"): Recorded => ({
      apiVersion: "velero.io/v1",
      kind,
      name,
      namespace,
      uid: "uid-of-before",
    });
    // The installation with nothing of the run left, and a journal that still names every operation, beside
    // objects that are not operations of the installation.
    const emptied = () => {
      const target = installation();
      const others = [
        entry("BackupStorageLocation", "default"),
        entry("Backup", names.backup, names.static),
        entry("Schedule", names.backup),
      ];

      target.objects.delete(`backup/velero-demo/${names.backup}`);
      target.store.clear();
      // An entry of another namespace comes before the one of the installation that has its name.
      return { target, others, from: runner(target, [...others, ...named.map(([kind, name]) => entry(kind, name))]) };
    };
    const ended = (from: ReturnType<typeof runner>) => assertFixtureOperationsRemoved(from.runtime as never, run);
    const clean = emptied();
    const events: string[] = [];
    const traces = runner(clean.target, clean.from.entries, traced(events));

    // One read of the installation, which is in the log of the operations; the journal forgets the eleven
    // operations and keeps the rest; and each of the twenty keys of the run is asked for.
    expect(ended(traces)).toEqual({ keys: 20 });
    expect(runArtifactPaths(run)).toHaveLength(20);
    expect(events).toEqual(["get", "save", ...runArtifactPaths(run).map((path) => `HEAD ${path}`)]);
    expect(clean.target.logged).toEqual([true]);
    expect(traces.left()).toEqual(clean.others);
    // An operation that is there is told by its kind and its name, whatever identity the cluster gave it and
    // whether the journal knows it or not: the journal forgets nothing, and the store is not asked.
    for (const [kind, name] of named) {
      for (const known of [true, false]) {
        const { target, from } = emptied();
        const journal = runner(target, known ? from.entries : []);

        held(target, { apiVersion: "velero.io/v1", kind, metadata: { name, namespace: "velero-demo" } });
        expect([kind, name, known, stopped(() => ended(journal))]).toEqual([
          kind,
          name,
          known,
          `The server has not removed every operation of the run from velero-demo: the ${kind} ${name} is there. ` +
            `Run the command again; for what is still there after it, ${DOWN}.`,
        ]);
        expect(journal.left()).toEqual(known ? from.entries : []);
        expect(target.requests).toEqual([]);
      }
    }
    const several = emptied();

    for (const [kind, name] of [named[0], named[5], named[10]]) {
      held(several.target, { apiVersion: "velero.io/v1", kind, metadata: { name, namespace: "velero-demo" } });
    }
    expect(stopped(() => ended(several.from))).toBe(
      `The server has not removed every operation of the run from velero-demo: the Backup ${names.backup}, the ` +
        `Restore ${names.invalidRestore}, the DeleteBackupRequest ${names.syncedBackupWithoutLog}-delete are ` +
        `there. Run the command again; for what is still there after it, ${DOWN}.`,
    );
    // An object of one of those names and of another kind, or in another namespace, is not an operation of
    // the run.
    const namesakes = emptied();

    namesakes.target.runtime.apply({ kind: "Namespace", metadata: { name: names.static } });
    held(namesakes.target, {
      apiVersion: "velero.io/v1",
      kind: "Restore",
      metadata: { name: names.backup, namespace: "velero-demo" },
    });
    held(namesakes.target, {
      apiVersion: "velero.io/v1",
      kind: "Backup",
      metadata: { name: names.backup, namespace: names.static },
    });
    expect(ended(namesakes.from)).toEqual({ keys: 20 });
    // A key of the run the store holds, any of the twenty, is told, and the run is not called cleaned. The
    // journal forgot the operations before the store was asked: it names none of what the cluster no longer
    // holds.
    for (const path of runArtifactPaths(run)) {
      const { target, others, from } = emptied();

      target.store.set(path, Buffer.from("left"));
      expect([path, stopped(() => ended(from))]).toEqual([
        path,
        `The store holds ${path} though no operation of the run is in velero-demo: the server deletes the files ` +
          `of a backup with the backup, and nothing here removes a key. The way out is to take the environment ` +
          "down, with `pnpm demo:down`.",
      ]);
      expect(target.requests).toHaveLength(20);
      expect(from.left()).toEqual(others);
    }
    // Nor on a store that does not say whether it holds a key.
    const silent = emptied();
    const asked = runArtifactPaths(run)[7];

    silent.target.told.answer = ({ path }) => (path === asked ? 503 : undefined);
    expect(stopped(() => ended(silent.from))).toBe(
      `The store answered 503 when it was asked whether it holds ${asked}: what is left of the run is not known, ` +
        "and nothing is concluded from it. Run the command again.",
    );
    // It needs the store and the journal of the runtime.
    for (const lacking of ["store", "journal"]) {
      const { target, from } = emptied();

      expect([
        lacking,
        stopped(() => assertFixtureOperationsRemoved({ ...from.runtime, [lacking]: undefined } as never, run)),
      ]).toEqual([
        lacking,
        "What is left of the operations of a run is asked of the store of the environment, and forgotten by the " +
          "journal of the objects of the run",
      ]);
      expect(target.asked).toEqual([]);
    }
  });

  it("gives the Overview an installation whose operations are counted back from when they were placed", () => {
    const names = fixtureNames(run);
    const placed = Date.parse("2026-09-28T07:45:30.250Z");
    const resources = overviewFixtures("synthetic-owner", run, placed);
    const named = (name: string) => resources.find((resource) => resource.metadata.name === name);
    const status = (name: string) => named(name)?.status as Record<string, string> | undefined;
    const ago = (time: number) =>
      new Date(Date.parse("2026-09-28T07:45:30Z") - time).toISOString().replace(".000Z", "Z");

    expect(
      resources.every(
        (resource) =>
          resource.metadata.namespace === names.overview &&
          resource.metadata.labels?.[OWNER_LABEL] === "synthetic-owner" &&
          resource.metadata.labels?.[FIXTURE_LABEL] === run &&
          resource.metadata.annotations?.[PLACED_ANNOTATION] === "2026-09-28T07:45:30.250Z" &&
          resource.kind !== "Secret",
      ),
    ).toBe(true);
    // Twelve schedules, of which the rules name two: one that was refused, one that was not read.
    const schedules = resources.filter((resource) => resource.kind === "Schedule");

    expect(OVERVIEW_SCHEDULES).toBe(12);
    expect(schedules.map((resource) => resource.metadata.name)).toEqual(
      Array.from({ length: 12 }, (_, index) => `overview-schedule-${String(index + 1).padStart(2, "0")}`),
    );
    expect(
      schedules
        .filter((resource) => (resource.status as { phase?: string } | undefined)?.phase !== "Enabled")
        .map((resource) => [resource.metadata.name, (resource.status as { phase?: string } | undefined)?.phase]),
    ).toEqual([
      ["overview-schedule-07", "FailedValidation"],
      ["overview-schedule-11", undefined],
    ]);
    // What Velero read carries what it writes into it, and what it did not read does not.
    expect(
      schedules
        .filter((resource) => !("skipImmediately" in (resource.spec as object)))
        .map((resource) => resource.metadata.name),
    ).toEqual(["overview-schedule-11"]);
    expect(
      schedules
        .filter((resource) => (resource.spec as { paused: boolean }).paused)
        .map((resource) => resource.metadata.name),
    ).toEqual(["overview-schedule-05"]);
    // Each window holds some operations and leaves some out, for as long as the fixtures are good for.
    const starts = resources
      .filter((resource) => resource.kind === "Backup" || resource.kind === "Restore")
      .map((resource) => [resource.metadata.name, (resource.status as { startTimestamp?: string }).startTimestamp]);
    const within = (window: number) =>
      starts
        .filter(([, start]) => start !== undefined && placed + PLACED_FOR - Date.parse(start) <= window)
        .map(([name]) => name);

    expect(within(24 * HOUR)).toEqual([
      "recent-1h",
      "recent-3h",
      "recent-5h",
      "scheduled-8h",
      "flying-running",
      "flying-failing",
      "restored-3h",
      "restore-flying",
    ]);
    expect(within(7 * 24 * HOUR).filter((name) => !within(24 * HOUR).includes(name))).toEqual([
      "recent-2d",
      "recent-5d",
      "restored-3d",
    ]);
    expect(within(30 * 24 * HOUR).filter((name) => !within(7 * 24 * HOUR).includes(name))).toEqual([
      "recent-10d",
      "recent-25d",
      "restored-20d",
    ]);
    expect(starts.filter(([name, start]) => start !== undefined && !within(30 * 24 * HOUR).includes(name))).toEqual([
      ["recent-40d", ago(40 * 24 * HOUR)],
      ["restored-35d", ago(35 * 24 * HOUR)],
    ]);
    // What did not start has no start: it is at the time it is created, which is when it is placed.
    expect(starts.filter(([, start]) => start === undefined).map(([name]) => name)).toEqual([
      "scheduled-refused",
      "flying-queued",
      "restore-refused",
    ]);
    // The newest backup of the schedule that was refused failed its validation, after one that completed.
    expect(
      resources
        .filter((resource) => resource.metadata.labels?.["velero.io/schedule-name"] === "overview-schedule-07")
        .map((resource) => [resource.metadata.name, (resource.status as { phase: string }).phase]),
    ).toEqual([
      ["scheduled-8h", "Completed"],
      ["scheduled-refused", "FailedValidation"],
    ]);
    // One schedule names the location that is not available, and it is the one that was not read.
    expect(
      schedules
        .filter(
          (resource) =>
            (resource.spec as { template: { storageLocation: string } }).template.storageLocation !==
            "overview-default",
        )
        .map((resource) => [
          resource.metadata.name,
          (resource.spec as { template: { storageLocation: string } }).template.storageLocation,
        ]),
    ).toEqual([["overview-schedule-11", "overview-unavailable"]]);
    expect(status("restore-refused")).toEqual({
      phase: "FailedValidation",
      validationErrors: ["Synthetic validation error; no operation was executed"],
    });
    expect(status("recent-1h")).toMatchObject({ phase: "Completed", startTimestamp: ago(HOUR) });
    expect(named("recent-1h")?.metadata.labels?.["velero.io/schedule-name"]).toBe("overview-schedule-01");
    // No counter of zero, as the release writes none.
    expect(JSON.stringify(resources)).not.toMatch(/"(errors|warnings)":0/);
    // The storage locations a rule names: one unavailable, one silent, and the default, validated days ago.
    expect(
      resources
        .filter((resource) => resource.kind === "BackupStorageLocation")
        .map((resource) => [
          resource.metadata.name,
          (resource.status as { phase?: string } | undefined)?.phase,
          (resource.status as { lastValidationTime?: string } | undefined)?.lastValidationTime,
        ]),
    ).toEqual([
      ["overview-default", "Available", ago(2 * 24 * HOUR)],
      ["overview-unavailable", "Unavailable", ago(3 * 24 * HOUR)],
      ["overview-silent", undefined, undefined],
    ]);
    expect(() => overviewFixtures("", run, placed)).toThrow();
    expect(() => overviewFixtures("synthetic-owner", run, Number.NaN)).toThrow();
  });

  it("spreads the long lists over the thirty days before they were placed", () => {
    const placed = Date.parse("2026-09-28T07:45:30Z");
    const { backups, restores } = scaleFixtures("synthetic-owner", run, placed);
    const starts = (items: typeof backups) =>
      items
        .map((item) => (item.status as { startTimestamp?: string }).startTimestamp)
        .filter((start): start is string => start !== undefined)
        .map((start) => Date.parse(start));

    for (const items of [backups, restores]) {
      expect(Math.min(...starts(items))).toBeGreaterThanOrEqual(placed - 30 * 24 * HOUR);
      expect(Math.max(...starts(items))).toBeLessThan(placed);
      // Every window holds some of them, and the ones of a day are not the ones of a month.
      const held = (window: number) => starts(items).filter((start) => placed - start <= window).length;

      expect(held(24 * HOUR)).toBeGreaterThan(10);
      expect(held(7 * 24 * HOUR)).toBeGreaterThan(held(24 * HOUR) * 5);
      expect(held(30 * 24 * HOUR)).toBeGreaterThan(held(7 * 24 * HOUR) * 3);
      expect(
        items.every((item) => item.metadata.annotations?.[PLACED_ANNOTATION] === new Date(placed).toISOString()),
      ).toBe(true);
    }
  });

  it("gives the views schedules whose backups go where none is taken, and one that names its time zone", () => {
    const resources = viewFixtures("synthetic-owner", run);
    const named = (name: string) => resources.find((resource) => resource.metadata.name === name);
    const template = (name: string) =>
      (named(name)?.spec as { template?: Record<string, unknown> } | undefined)?.template ?? {};

    expect(named("views-zoned")?.spec).toMatchObject({ schedule: "CRON_TZ=Europe/Rome 30 2 * * *" });
    expect(template("views-to-removed").storageLocation).toBe("views-removed");
    expect(named("views-removed")).toBeUndefined();
    expect(template("views-to-archive").storageLocation).toBe("views-archive");
    expect(named("views-archive")).toMatchObject({
      kind: "BackupStorageLocation",
      spec: { accessMode: "ReadOnly" },
      status: { phase: "Available" },
    });
    expect(template("views-to-default")).not.toHaveProperty("storageLocation");
    // One location of the installation is marked default, and it is the one that takes the backups.
    expect(
      resources
        .filter(
          (resource) =>
            resource.metadata.namespace === fixtureNames(run).views &&
            (resource.spec as { default?: boolean } | undefined)?.default === true,
        )
        .map((resource) => resource.metadata.name),
    ).toEqual(["views-available"]);
  });

  it("gives the views the locations of every state, none of them validated by a controller", () => {
    const names = fixtureNames(run);
    const started = Date.parse("2026-09-28T07:31:17.123Z");
    const resources = viewFixtures("synthetic-owner", run, started);
    const locations = Object.fromEntries(
      resources
        .filter((resource) => resource.kind === "BackupStorageLocation")
        .map((resource) => [resource.metadata.name, resource]),
    );
    const status = (name: string) => locations[name].status as Record<string, string> | undefined;
    const spec = (name: string) => locations[name].spec as Record<string, unknown>;

    expect(Object.keys(locations)).toEqual([
      "views-available",
      "views-archive",
      LONG_LOCATION_NAME,
      "views-unreported",
      "views-unavailable",
      "views-with-credential",
      "defaults-older",
      "defaults-newer",
    ]);
    // What a synthetic location reports is of a validation that is days old, however young the environment
    // is: later than three times its frequency, and than the hour of one that names none.
    expect(status("views-available")).toEqual({
      phase: "Available",
      lastValidationTime: "2026-09-27T07:00:00Z",
      lastSyncedTime: "2026-09-27T07:00:00Z",
    });
    expect(spec("views-available")).toMatchObject({ validationFrequency: "1m0s", backupSyncPeriod: "1m0s" });
    expect(status("views-archive")).toEqual({ phase: "Available", lastValidationTime: "2026-09-25T07:00:00Z" });
    expect(spec("views-archive")).not.toHaveProperty("validationFrequency");
    expect(locations["views-unreported"]).not.toHaveProperty("status");
    expect(status("views-unavailable")).toEqual({
      phase: "Unavailable",
      message: UNAVAILABLE_MESSAGE,
      lastValidationTime: "2026-09-26T07:00:00Z",
    });
    expect(UNAVAILABLE_MESSAGE.split("\n").length).toBeGreaterThanOrEqual(3);
    // The Secrets a location names are names: the fixtures hold none, and the address of the storage
    // carries a query, which a view leaves out.
    expect(spec("views-with-credential")).toMatchObject({
      credential: { name: "views-credential", key: "cloud" },
      objectStorage: { caCertRef: { name: "views-storage-ca", key: "ca.crt" } },
      validationFrequency: "0s",
      backupSyncPeriod: "0s",
    });
    expect((spec("views-with-credential").config as Record<string, string>).s3Url).toMatch(/\?synthetic=left-out$/);
    expect((spec("views-with-credential").config as Record<string, string>).s3Url).not.toContain("@");
    expect(resources.some((resource) => resource.kind === "Secret")).toBe(false);
    // Two locations marked default in a namespace of their own, the one that is read only first. The one
    // the release would keep is the one created last, which is the first by name too.
    const defaults = resources.filter((resource) => resource.metadata.namespace === names.defaults);

    expect(defaults.map((resource) => [resource.kind, resource.metadata.name])).toEqual([
      ["BackupStorageLocation", "defaults-older"],
      ["BackupStorageLocation", "defaults-newer"],
    ]);
    expect(defaults.map((resource) => resource.spec)).toMatchObject([
      { default: true, accessMode: "ReadOnly" },
      { default: true, accessMode: "ReadWrite" },
    ]);
    // The name, the bucket and the prefix that are as long as they can be.
    expect([LONG_LOCATION_NAME.length, LONG_BUCKET_NAME.length]).toEqual([63, 63]);
    expect(LONG_LOCATION_NAME).toMatch(/^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/);
    expect(spec(LONG_LOCATION_NAME).objectStorage).toEqual({ bucket: LONG_BUCKET_NAME, prefix: LONG_PREFIX });
    expect(LONG_PREFIX.split("/").length).toBeGreaterThan(10);
    // Every synthetic location with a validation has one that is days old.
    for (const location of Object.values(locations)) {
      const validated = (location.status as { lastValidationTime?: string } | undefined)?.lastValidationTime;

      if (validated !== undefined) expect(started - Date.parse(validated)).toBeGreaterThanOrEqual(86_400_000);
    }
    // The snapshot locations: one with a phase nothing of the release wrote, one as the release leaves it.
    expect(
      resources
        .filter((resource) => resource.kind === "VolumeSnapshotLocation")
        .map((resource) => [
          resource.metadata.name,
          resource.status,
          (resource.spec as { credential?: object }).credential,
        ]),
    ).toEqual([
      ["views-snapshots", { phase: "Available" }, undefined],
      ["views-snapshots-unreported", undefined, { name: "views-credential", key: "cloud" }],
    ]);
  });

  it("gives the views the schedules Velero has not read, and what it writes into the ones it read", () => {
    const schedules = Object.fromEntries(
      viewFixtures("synthetic-owner", run)
        .filter((resource) => resource.kind === "Schedule")
        .map((resource) => [resource.metadata.name, resource]),
    );
    const skips = (resources: typeof schedules) =>
      Object.fromEntries(
        Object.entries(resources).map(([name, resource]) => [
          name,
          (resource.spec as { skipImmediately?: boolean }).skipImmediately,
        ]),
      );

    expect(Object.keys(schedules)).toEqual([
      "views-daily",
      "views-history",
      "schedule-new",
      "schedule-unread",
      "schedule-unread-paused",
      "schedule-skipping",
      "views-zoned",
      "views-to-removed",
      "views-to-archive",
      "views-to-default",
    ]);
    // The release writes whether the run that is due is skipped into every schedule it reads, which are the
    // ones it gave a phase to: Enabled or FailedValidation. The phase New is of the API, and is not written
    // by the release.
    expect(skips(schedules)).toEqual({
      "views-daily": false,
      "views-history": false,
      "schedule-new": undefined,
      "schedule-unread": undefined,
      "schedule-unread-paused": undefined,
      "schedule-skipping": true,
      "views-zoned": false,
      "views-to-removed": false,
      "views-to-archive": false,
      "views-to-default": false,
    });
    expect(
      skips(
        Object.fromEntries(
          staticFixtures("synthetic-owner", run)
            .filter((resource) => resource.kind === "Schedule")
            .map((resource) => [resource.metadata.name, resource]),
        ),
      ),
    ).toEqual({ "schedule-enabled": false, "schedule-paused": false, "schedule-invalid": false });
    expect(schedules["schedule-new"].status).toEqual({ phase: "New" });
    expect(schedules["schedule-unread"]).not.toHaveProperty("status");
    expect(schedules["schedule-unread-paused"]).not.toHaveProperty("status");
    expect(schedules["schedule-unread-paused"].spec).toMatchObject({ paused: true });
    expect(schedules["schedule-skipping"]).toMatchObject({
      spec: { paused: true, skipImmediately: true },
      status: { phase: "Enabled", lastSkipped: "2026-08-15T09:30:00Z" },
    });
    // The namespace of the phases keeps the three schedules it had.
    expect(
      staticFixtures("synthetic-owner", run)
        .filter((resource) => resource.kind === "Schedule")
        .map((resource) => resource.metadata.name),
    ).toEqual(["schedule-enabled", "schedule-paused", "schedule-invalid"]);
  });

  it("fills the other long list with a thousand restores in every phase, each of a backup of the first", () => {
    const names = fixtureNames(run);
    const { backups, restores } = scaleFixtures("synthetic-owner", run);
    const phase = (restore: (typeof restores)[number]) => (restore.status as { phase: string }).phase;

    expect(restores).toHaveLength(SCALE_RESTORES);
    expect(new Set(restores.map((restore) => restore.metadata.name)).size).toBe(1000);
    expect(new Set(restores.map(phase))).toEqual(new Set(RESTORE_PHASES));
    expect(
      restores.every(
        (restore) =>
          restore.kind === "Restore" &&
          restore.metadata.namespace === names.scale &&
          restore.metadata.labels?.[OWNER_LABEL] === "synthetic-owner" &&
          restore.metadata.labels?.[FIXTURE_LABEL] === run &&
          backups.some((backup) => backup.metadata.name === (restore.spec as { backupName: string }).backupName),
      ),
    ).toBe(true);
    expect(
      restores
        .filter((restore) => "startTimestamp" in (restore.status as object))
        .map(phase)
        .sort(),
    ).toEqual(
      restores
        .map(phase)
        .filter((name) => !NOT_STARTED.has(name))
        .sort(),
    );
  });

  it("fills the long list with a thousand backups in every phase, none of them of an installation", () => {
    const names = fixtureNames(run);
    const { namespace, backups } = scaleFixtures("synthetic-owner", run);

    expect(namespace.metadata.name).toBe(names.scale);
    expect(backups).toHaveLength(SCALE_BACKUPS);
    expect(new Set(backups.map((backup) => backup.metadata.name)).size).toBe(1000);
    expect(new Set(backups.map((backup) => (backup.status as { phase: string }).phase))).toEqual(
      new Set(BACKUP_PHASES),
    );
    expect(new Set(backups.map((backup) => (backup.status as { startTimestamp?: string }).startTimestamp)).size).toBe(
      // One start for each backup that has one: the ones that did not start have none.
      backups.filter((backup) => !NOT_STARTED.has((backup.status as { phase: string }).phase)).length + 1,
    );
    expect(
      backups.every(
        (backup) =>
          backup.kind === "Backup" &&
          backup.metadata.namespace === names.scale &&
          backup.metadata.labels?.[OWNER_LABEL] === "synthetic-owner" &&
          backup.metadata.labels?.[FIXTURE_LABEL] === run,
      ),
    ).toBe(true);
    expect(fixtureNamespaces(run)).toEqual([
      names.source,
      names.restored,
      names.static,
      names.views,
      names.defaults,
      names.overview,
      names.scale,
    ]);
  });

  it("gives the reader the kubeconfig of the environment with its own credential and its namespace", () => {
    const config = {
      "current-context": "kind-synthetic",
      contexts: [{ name: "kind-synthetic", context: { cluster: "kind-synthetic", user: "kind-synthetic" } }],
      clusters: [{ name: "kind-synthetic", cluster: { server: "https://127.0.0.1:6443" } }],
      users: [{ name: "kind-synthetic", user: { "client-key-data": "synthetic", "client-certificate-data": "x" } }],
    };
    const token = "t".repeat(120);
    const reader = readerKubeconfig(config, token, "velero-views-a1a2a3a4");

    expect(reader.users).toEqual([{ name: "kind-synthetic", user: { token } }]);
    expect(reader.contexts[0].context).toEqual({
      cluster: "kind-synthetic",
      user: "kind-synthetic",
      namespace: "velero-views-a1a2a3a4",
    });
    expect(reader.clusters).toEqual(config.clusters);
    // The kubeconfig of the environment is left as it was.
    expect(config.users[0].user).toHaveProperty("client-key-data");
    expect(config.contexts[0].context).not.toHaveProperty("namespace");
    expect(() => readerKubeconfig(config, "short", "velero-views-a1a2a3a4")).toThrow();
    expect(() => readerKubeconfig({ ...config, users: [...config.users, ...config.users] }, token, "x")).toThrow();
  });

  it("refuses namespace cleanup with unrelated resources and binds backup deletion to its UID", () => {
    const namespace = fixtureNames(run).source;
    const resource = {
      apiVersion: "v1",
      kind: "ConfigMap",
      metadata: { name: "payload", namespace, labels: { [OWNER_LABEL]: "synthetic-owner", [FIXTURE_LABEL]: run } },
    };

    expect(() => assertFixtureNamespaceContents("synthetic-owner", run, namespace, [resource])).not.toThrow();
    expect(() => assertFixtureNamespaceContents("synthetic-owner", run, "velero-demo", [resource])).toThrow(
      "Refusing cleanup outside this fixture run",
    );
    // What is not of the run is told by its kind and its name, with the way out: an object without the
    // labels, one of another run, one of another owner, and a request the extension was asked for there.
    const unrelated = (kind: string, name: string) =>
      `The namespace ${namespace} of the fixtures holds the ${kind} ${name}, which is not of this run: a cleanup ` +
      "removes no namespace with such an object in it, and nothing here removes the object. The way out is to " +
      "take the environment down, with `pnpm demo:down`.";

    for (const labels of [
      {},
      { [OWNER_LABEL]: "synthetic-owner" },
      { [OWNER_LABEL]: "synthetic-owner", [FIXTURE_LABEL]: "b1b2b3b4" },
      { [OWNER_LABEL]: "another-owner", [FIXTURE_LABEL]: run },
    ] as Record<string, string>[])
      expect(() =>
        assertFixtureNamespaceContents("synthetic-owner", run, namespace, [
          resource,
          { ...resource, metadata: { ...resource.metadata, labels } },
        ]),
      ).toThrow(unrelated("ConfigMap", "payload"));
    expect(() =>
      assertFixtureNamespaceContents("synthetic-owner", run, namespace, [
        {
          apiVersion: "velero.io/v1",
          kind: "DownloadRequest",
          metadata: {
            name: "backup-completed-11111111-2222-4333-8444-555555555555",
            namespace,
            labels: { "app.kubernetes.io/managed-by": "freelens-velero-extension" },
          },
        },
      ]),
    ).toThrow(unrelated("DownloadRequest", "backup-completed-11111111-2222-4333-8444-555555555555"));
    // What every namespace holds of the cluster itself is not of the run, and is left out.
    expect(() =>
      assertFixtureNamespaceContents("synthetic-owner", run, namespace, [
        { apiVersion: "v1", kind: "ConfigMap", metadata: { name: "kube-root-ca.crt", namespace } },
        { apiVersion: "v1", kind: "ServiceAccount", metadata: { name: "default", namespace } },
      ]),
    ).not.toThrow();
    expect(() =>
      assertFixtureNamespaceContents("synthetic-owner", run, namespace, [
        { apiVersion: "v1", kind: "ServiceAccount", metadata: { name: "kube-root-ca.crt", namespace } },
      ]),
    ).toThrow(unrelated("ServiceAccount", "kube-root-ca.crt"));
    const request = fixtureDeletionRequest("synthetic-owner", run, "synthetic-backup-uid");

    expect(request.kind).toBe("DeleteBackupRequest");
    expect(request.metadata.labels?.["velero.io/backup-uid"]).toBe("synthetic-backup-uid");
    expect(() => fixtureDeletionRequest("synthetic-owner", run, "")).toThrow();
  });
});

const SHAPES = ["internal", "loopback"] as const;

function readdirNames(directory: string): string[] {
  return readdirSync(directory).sort();
}

function fixture(shape: NetworkShape = "internal") {
  const published = shape === "loopback";
  const identity: DemoIdentity = {
    owner: "synthetic-owner",
    nodeId: "synthetic-node",
    networkId: "synthetic-network",
    kubeconfigHash: "synthetic-hash",
    shape,
  };
  const network: KindNetwork = {
    Id: identity.networkId,
    Labels: { [OWNER_LABEL]: identity.owner },
    Internal: !published,
    Driver: "bridge",
    IPAM: { Config: [{ Subnet: SUBNETS.docker }] },
  };
  const node: KindNode = {
    Id: identity.nodeId,
    State: { Running: true },
    Config: { Labels: { "io.x-k8s.kind.cluster": DEMO_CLUSTER, "io.x-k8s.kind.role": "control-plane" } },
    NetworkSettings: {
      Networks: { [DEMO_NETWORK]: { NetworkID: identity.networkId, IPAddress: "198.18.64.2" } },
      Ports: { "6443/tcp": published ? [{ HostIp: "127.0.0.1", HostPort: "16443" }] : null },
    },
  };
  const config: KindConfig = {
    "current-context": DEMO_CONTEXT,
    contexts: [{ name: DEMO_CONTEXT, context: { cluster: DEMO_CONTEXT, user: DEMO_CONTEXT } }],
    clusters: [
      {
        name: DEMO_CONTEXT,
        cluster: {
          server: published ? "https://127.0.0.1:16443" : "https://198.18.64.2:6443",
          "certificate-authority-data": "synthetic-ca",
        },
      },
    ],
    users: [
      { name: DEMO_CONTEXT, user: { "client-certificate-data": "synthetic-cert", "client-key-data": "synthetic-key" } },
    ],
  };

  return { identity, network, nodes: [node], config };
}

describe("local kind safety boundary", () => {
  it("resumes only the unchanged, isolated, stopped initialized node", () => {
    const { identity, nodes, network } = fixture();

    expect(() => assertStoppedKind(identity, nodes, network, identity.kubeconfigHash)).toThrow();
    nodes[0].State.Running = false;
    expect(() => assertStoppedKind(identity, nodes, network, identity.kubeconfigHash)).not.toThrow();
    expect(() => assertStoppedKind(identity, nodes, network, "changed")).toThrow();
    expect(() =>
      assertStoppedKind({ ...identity, nodeId: "replacement" }, nodes, network, identity.kubeconfigHash),
    ).toThrow();
    expect(() =>
      assertStoppedKind(identity, nodes, { ...network, Internal: false }, identity.kubeconfigHash),
    ).toThrow();
  });

  it("checks retained network ownership before creating a replacement node", () => {
    const { identity, network } = fixture();

    expect(() => assertOwnedNetwork(identity, network)).not.toThrow();
    expect(() => assertOwnedNetwork({ ...identity, networkId: "replaced" }, network)).toThrow();
    expect(() => assertOwnedNetwork(identity, { ...network, Internal: false })).toThrow();
    expect(() => assertOwnedNetwork(identity, { ...network, Labels: {} })).toThrow();
    expect(() =>
      assertOwnedNetwork(identity, { ...network, IPAM: { Config: [{ Subnet: "192.0.2.0/24" }] } }),
    ).toThrow();
  });

  it.each(SHAPES)("accepts only the fully bound owned local target on the %s shape", (shape) => {
    const { identity, network, nodes, config } = fixture(shape);

    expect(() => assertLocalKind(identity, nodes, network, config, identity.kubeconfigHash)).not.toThrow();
  });

  it("reads a journal without a shape as the internal one", () => {
    const { identity, network, nodes, config } = fixture("internal");

    delete identity.shape;
    expect(() => assertLocalKind(identity, nodes, network, config, identity.kubeconfigHash)).not.toThrow();
    expect(() =>
      assertLocalKind(identity, nodes, { ...network, Internal: false }, config, identity.kubeconfigHash),
    ).toThrow();
  });

  it("allows an unpublished internal API only at the exact owned node address", () => {
    const { identity, nodes, network, config } = fixture("internal");

    expect(() => assertLocalKind(identity, nodes, network, config, identity.kubeconfigHash)).not.toThrow();
    config.clusters[0].cluster.server = "https://198.18.64.3:6443";
    expect(() => assertLocalKind(identity, nodes, network, config, identity.kubeconfigHash)).toThrow();
    config.clusters[0].cluster.server = "https://198.18.64.2:6443";
    nodes[0].NetworkSettings.Networks[DEMO_NETWORK].IPAddress = "192.0.2.2";
    config.clusters[0].cluster.server = "https://192.0.2.2:6443";
    expect(() => assertLocalKind(identity, nodes, network, config, identity.kubeconfigHash)).toThrow();
  });

  it.each([
    [
      "a port published on the internal shape",
      "internal",
      (value: ReturnType<typeof fixture>) => {
        // The kubeconfig stays right, so that only the published port can be the reason.
        value.nodes[0].NetworkSettings.Ports["6443/tcp"] = [{ HostIp: "127.0.0.1", HostPort: "16443" }];
      },
    ],
    [
      "a network that is not internal on the internal shape",
      "internal",
      (value: ReturnType<typeof fixture>) => {
        value.network.Internal = false;
      },
    ],
    [
      "an internal network on the loopback shape",
      "loopback",
      (value: ReturnType<typeof fixture>) => {
        value.network.Internal = true;
      },
    ],
    [
      "no published API on the loopback shape",
      "loopback",
      (value: ReturnType<typeof fixture>) => {
        value.nodes[0].NetworkSettings.Ports["6443/tcp"] = null;
        value.config.clusters[0].cluster.server = "https://198.18.64.2:6443";
      },
    ],
    [
      "a second published port",
      "loopback",
      (value: ReturnType<typeof fixture>) => {
        value.nodes[0].NetworkSettings.Ports["8333/tcp"] = [{ HostIp: "127.0.0.1", HostPort: "18333" }];
      },
    ],
    [
      "the API published twice",
      "loopback",
      (value: ReturnType<typeof fixture>) => {
        value.nodes[0].NetworkSettings.Ports["6443/tcp"]?.push({ HostIp: "127.0.0.1", HostPort: "26443" });
      },
    ],
    [
      "a wrong loopback port",
      "loopback",
      (value: ReturnType<typeof fixture>) => {
        value.config.clusters[0].cluster.server = "https://127.0.0.1:26443";
      },
    ],
    [
      "an API published on every address",
      "loopback",
      (value: ReturnType<typeof fixture>) => {
        const ports = value.nodes[0].NetworkSettings.Ports["6443/tcp"];
        if (ports) ports[0].HostIp = "0.0.0.0";
      },
    ],
    [
      "the address of the node in the kubeconfig of the loopback shape",
      "loopback",
      (value: ReturnType<typeof fixture>) => {
        value.config.clusters[0].cluster.server = "https://198.18.64.2:6443";
      },
    ],
  ] as const)("rejects %s", (name, shape, mutate) => {
    const value = fixture(shape);
    const reasons: Record<string, string> = {
      "a port published on the internal shape": "The internal shape publishes no port",
      "a network that is not internal on the internal shape": "does not have the shape the journal records",
      "an internal network on the loopback shape": "does not have the shape the journal records",
      "no published API on the loopback shape": "Only the API server may be published, and only on loopback",
      "a second published port": "Only the API server may be published, and only on loopback",
      "the API published twice": "Only the API server may be published, and only on loopback",
      "a wrong loopback port": "Kubeconfig does not address the owned node",
      "an API published on every address": "Only the API server may be published, and only on loopback",
      "the address of the node in the kubeconfig of the loopback shape": "Kubeconfig does not address the owned node",
    };

    expect(reasons[name]).toBeTruthy();
    expect(() =>
      assertLocalKind(value.identity, value.nodes, value.network, value.config, value.identity.kubeconfigHash),
    ).not.toThrow();
    mutate(value);
    expect(() =>
      assertLocalKind(value.identity, value.nodes, value.network, value.config, value.identity.kubeconfigHash),
    ).toThrow(reasons[name]);
  });

  it.each(SHAPES)("removes only the node the journal names, on the %s shape", (shape) => {
    const { identity, nodes, network } = fixture(shape);
    const stopped = [{ ...nodes[0], State: { Running: false } }];

    expect(() => assertOwnedNode(identity, nodes, network)).not.toThrow();
    expect(() => assertOwnedNode(identity, stopped, network)).not.toThrow();
    expect(() => assertOwnedNode({ ...identity, nodeId: "another-node" }, nodes, network)).toThrow(
      "A node exists that the journal does not own",
    );
    expect(() => assertOwnedNode(identity, [...nodes, ...nodes], network)).toThrow(
      "A node exists that the journal does not own",
    );
    expect(() => assertOwnedNode(identity, [], network)).toThrow("A node exists that the journal does not own");
    expect(() => assertOwnedNode({ ...identity, nodeId: "" }, nodes, network)).toThrow("Incomplete node ownership");
    expect(() =>
      assertOwnedNode(identity, [{ ...nodes[0], Config: { Labels: { "io.x-k8s.kind.cluster": "kind" } } }], network),
    ).toThrow("Wrong node identity");
    expect(() => assertOwnedNode(identity, nodes, { ...network, Labels: {} })).toThrow("Wrong network owner");
    expect(() => assertOwnedNode(identity, nodes, { ...network, Internal: shape !== "internal" })).toThrow(
      "does not have the shape the journal records",
    );
    const second = structuredClone(nodes);

    second[0].NetworkSettings.Networks.kind = { NetworkID: "another-network", IPAddress: "172.18.0.2" };
    expect(() => assertOwnedNode(identity, second, network)).toThrow("The node is not on the owned network alone");
    const moved = structuredClone(nodes);

    moved[0].NetworkSettings.Networks[DEMO_NETWORK].NetworkID = "another-network";
    expect(() => assertOwnedNode(identity, moved, network)).toThrow("The node is not on the owned network alone");
  });

  describe.each(SHAPES)("on the %s shape", (shape) => {
    it.each([
      [
        "another kind cluster",
        (value: ReturnType<typeof fixture>) => {
          value.nodes[0].Config.Labels["io.x-k8s.kind.cluster"] = "kind";
        },
      ],
      [
        "replaced node",
        (value: ReturnType<typeof fixture>) => {
          value.nodes[0].Id = "replacement";
        },
      ],
      [
        "stopped node",
        (value: ReturnType<typeof fixture>) => {
          value.nodes[0].State.Running = false;
        },
      ],
      [
        "another network owner",
        (value: ReturnType<typeof fixture>) => {
          value.network.Labels[OWNER_LABEL] = "different-owner";
        },
      ],
      [
        "unexpected subnet",
        (value: ReturnType<typeof fixture>) => {
          value.network.IPAM.Config[0].Subnet = "192.0.2.0/24";
        },
      ],
      [
        "extra network attachment",
        (value: ReturnType<typeof fixture>) => {
          value.nodes[0].NetworkSettings.Networks.other = { NetworkID: "other" };
        },
      ],
      [
        "remote endpoint",
        (value: ReturnType<typeof fixture>) => {
          value.config.clusters[0].cluster.server = "https://example.invalid:6443";
        },
      ],
      [
        "extra context",
        (value: ReturnType<typeof fixture>) => {
          value.config.contexts.push(structuredClone(value.config.contexts[0]));
        },
      ],
      [
        "unverified TLS",
        (value: ReturnType<typeof fixture>) => {
          value.config.clusters[0].cluster["insecure-skip-tls-verify"] = true;
        },
      ],
      [
        "exec credentials",
        (value: ReturnType<typeof fixture>) => {
          value.config.users[0].user.exec = { command: "unexpected" };
        },
      ],
      [
        "extra credentials",
        (value: ReturnType<typeof fixture>) => {
          value.config.users[0].user.token = "synthetic-token";
        },
      ],
      [
        "proxy configuration",
        (value: ReturnType<typeof fixture>) => {
          Object.assign(value.config.clusters[0].cluster, { "proxy-url": "https://example.invalid" });
        },
      ],
    ] as const)("rejects %s before a cluster request", (_name, mutate) => {
      const value = fixture(shape);

      mutate(value);
      expect(() =>
        assertLocalKind(value.identity, value.nodes, value.network, value.config, value.identity.kubeconfigHash),
      ).toThrow();
    });
  });

  it("rejects missing, ambiguous and changed local identities", () => {
    const { identity, network, nodes, config } = fixture();

    expect(() => assertLocalKind(identity, [], network, config, identity.kubeconfigHash)).toThrow();
    expect(() => assertLocalKind(identity, [...nodes, ...nodes], network, config, identity.kubeconfigHash)).toThrow();
    expect(() => assertLocalKind(identity, nodes, network, config, "changed-hash")).toThrow();
  });

  it("replaces inherited remote Docker and kubeconfig settings without changing the caller", () => {
    const original = {
      DOCKER_HOST: "ssh://example.invalid",
      DOCKER_CONTEXT: "other",
      KUBECONFIG: "personal",
      KUBERNETES_MASTER: "https://example.invalid",
    };
    const environment = localEnvironment(original, "/synthetic-private/kubeconfig");

    expect(environment.DOCKER_HOST).toBe(DOCKER_HOST);
    expect(environment.DOCKER_CONTEXT).toBeUndefined();
    expect(environment.KUBERNETES_MASTER).toBeUndefined();
    expect(environment.KUBECONFIG).toBe("/synthetic-private/kubeconfig");
    expect(original.KUBECONFIG).toBe("personal");
  });

  it("does not inherit cloud credentials or permit ambient metadata lookup", () => {
    const original = {
      AWS_ACCESS_KEY_ID: "synthetic-external-key",
      AWS_SECRET_ACCESS_KEY: "synthetic-external-secret",
      AWS_PROFILE: "synthetic-profile",
      AWS_CONFIG_FILE: "/synthetic-profile",
      AWS_SHARED_CREDENTIALS_FILE: "/synthetic-credentials",
      AWS_EC2_METADATA_DISABLED: "false",
      AZURE_CLIENT_SECRET: "synthetic-azure-secret",
      ARM_CLIENT_ID: "synthetic-identity",
      GOOGLE_APPLICATION_CREDENTIALS: "/synthetic-google-credentials",
    };
    const environment = localEnvironment(original, "/synthetic-private/kubeconfig");

    for (const key of [
      "AWS_ACCESS_KEY_ID",
      "AWS_SECRET_ACCESS_KEY",
      "AWS_PROFILE",
      "AZURE_CLIENT_SECRET",
      "ARM_CLIENT_ID",
      "GOOGLE_APPLICATION_CREDENTIALS",
    ]) {
      expect(environment[key]).toBeUndefined();
    }
    expect(environment.AWS_EC2_METADATA_DISABLED).toBe("true");
    expect(environment.AWS_CONFIG_FILE).toBe("/dev/null");
    expect(environment.AWS_SHARED_CREDENTIALS_FILE).toBe("/dev/null");
    expect(original.AWS_PROFILE).toBe("synthetic-profile");
  });

  it("passes to a child process only what the allowlist names", () => {
    const original = {
      PATH: "/synthetic/bin",
      LANG: "en_US.UTF-8",
      HOME: "/synthetic-home",
      GITHUB_TOKEN: "synthetic-token",
      NPM_TOKEN: "synthetic-token",
      SSH_AUTH_SOCK: "/synthetic/agent.sock",
      SOME_FUTURE_PROVIDER_KEY: "synthetic-key",
    };
    const environment = localEnvironment(original, "/synthetic-private/kubeconfig", "unix:///synthetic/docker.sock");

    expect(environment.PATH).toBe("/synthetic/bin");
    expect(environment.LANG).toBe("en_US.UTF-8");
    expect(environment.DOCKER_HOST).toBe("unix:///synthetic/docker.sock");
    for (const key of ["HOME", "GITHUB_TOKEN", "NPM_TOKEN", "SSH_AUTH_SOCK", "SOME_FUTURE_PROVIDER_KEY"])
      expect(environment[key]).toBeUndefined();
    expect(childEnvironment({ PATH: "/caller" }, { PATH: "/own" }).PATH).toBe("/own");
  });

  it("removes inherited storage, proxy and runtime overrides", () => {
    const overrides = {
      WEED_MASTER: "example.invalid:9333",
      VELERO_NAMESPACE: "personal-namespace",
      HTTPS_PROXY: "https://example.invalid",
      http_proxy: "http://example.invalid",
      ALL_PROXY: "socks5://example.invalid",
      no_proxy: "example.invalid",
      KUBERNETES_SERVICE_HOST: "example.invalid",
      KUBERNETES_SERVICE_PORT: "443",
      NODE_OPTIONS: "--require=unexpected-module",
      DOCKER_AUTH_CONFIG: "synthetic-registry-credentials",
      KIND_EXPERIMENTAL_CONTAINERD_SNAPSHOTTER: "unexpected",
      TRIVY_DB_REPOSITORY: "example.invalid/private-db",
    };
    const environment = localEnvironment(overrides, "/synthetic-private/kubeconfig");

    for (const key of Object.keys(overrides)) {
      expect(environment[key]).toBeUndefined();
    }
    expect(overrides.WEED_MASTER).toBe("example.invalid:9333");
  });
});

describe("platform of the test environment", () => {
  it("takes the platform of the images from the Docker daemon", () => {
    expect(imagePlatform({ OSType: "linux", Architecture: "x86_64" })).toBe("linux/amd64");
    expect(imagePlatform({ OSType: "linux", Architecture: "aarch64" })).toBe("linux/arm64");
    expect(imagePlatform({ OSType: "linux", Architecture: "arm64" })).toBe("linux/arm64");
    expect(imageArchitecture("linux/arm64")).toBe("arm64");
    expect(imageArchitecture("linux/amd64")).toBe("amd64");
    expect(() => imagePlatform({ OSType: "linux", Architecture: "riscv64" })).toThrow("Unsupported");
    expect(() => imagePlatform({ OSType: "windows", Architecture: "x86_64" })).toThrow();
  });

  it("accepts a pin only when its index serves both platforms", () => {
    const digest = (character: string) => `sha256:${character.repeat(64)}`;
    const index = {
      manifests: [
        { digest: digest("a"), platform: { os: "linux", architecture: "amd64" } },
        { digest: digest("b"), platform: { os: "linux", architecture: "arm64" } },
        { digest: digest("c"), platform: { os: "linux", architecture: "arm" } },
        { digest: digest("d"), platform: { os: "unknown", architecture: "unknown" } },
      ],
    };

    expect(() => assertIndexPlatforms("storage", index)).not.toThrow();
    expect(platformManifest("storage", index, "linux/arm64")).toBe(digest("b"));
    expect(() => assertIndexPlatforms("storage", { manifests: index.manifests.slice(0, 1) })).toThrow(
      "The pin of the storage image is not an index with linux/arm64",
    );
    expect(() => assertIndexPlatforms("plugin", { manifests: index.manifests.slice(1) })).toThrow(
      "The pin of the plugin image is not an index with linux/amd64",
    );
    // A single-platform manifest has no list, and two entries for one platform do not say which to trust.
    expect(() => assertIndexPlatforms("velero", {})).toThrow("velero");
    expect(() =>
      platformManifest("velero", { manifests: [index.manifests[0], index.manifests[0]] }, "linux/amd64"),
    ).toThrow();
    expect(() =>
      platformManifest(
        "velero",
        { manifests: [{ digest: "latest", platform: { os: "linux", architecture: "amd64" } }] },
        "linux/amd64",
      ),
    ).toThrow();
  });

  it("reads the index from the engine when it holds it, and remembers the pins it has read", () => {
    const digest = (character: string) => `sha256:${character.repeat(64)}`;
    const held = {
      Descriptor: { digest: digest("0") },
      Manifests: [
        { Kind: "image", Descriptor: { digest: digest("a"), platform: { os: "linux", architecture: "amd64" } } },
        { Kind: "image", Descriptor: { digest: digest("b"), platform: { os: "linux", architecture: "arm64" } } },
        {
          Kind: "attestation",
          Descriptor: { digest: digest("c"), platform: { os: "unknown", architecture: "unknown" } },
        },
      ],
    };
    const index = engineIndex(digest("0"), held);

    expect(index?.manifests?.map((manifest) => manifest.digest)).toEqual([digest("a"), digest("b")]);
    expect(() => assertIndexPlatforms("storage", index ?? {})).not.toThrow();
    // Another image under the name, the classic store that keeps no index, an engine that did not answer.
    expect(engineIndex(digest("1"), held)).toBeUndefined();
    expect(engineIndex(digest("0"), { Descriptor: held.Descriptor })).toBeUndefined();
    expect(engineIndex(digest("0"), { Descriptor: held.Descriptor, Manifests: [] })).toBeUndefined();
    expect(engineIndex(digest("0"), undefined)).toBeUndefined();
    // An index the engine holds without one of the two platforms is refused like one of the registry.
    expect(() =>
      assertIndexPlatforms(
        "storage",
        engineIndex(digest("0"), { ...held, Manifests: held.Manifests.slice(0, 1) }) ?? {},
      ),
    ).toThrow("The pin of the storage image is not an index with linux/arm64");
    expect(verifiedPins(JSON.stringify([digest("0"), "latest", 7, digest("1")]))).toEqual([digest("0"), digest("1")]);
    expect(verifiedPins(undefined)).toEqual([]);
    expect(verifiedPins("{")).toEqual([]);
    expect(verifiedPins('{"pins":[]}')).toEqual([]);
  });

  it("finds a generated secret or a token in the log of the operations", () => {
    const secret = "5".repeat(64);
    const token = ["eyJhbGciOiJSUzI1NiJ9", "eyJpc3MiOiJzeW50aGV0aWMifQ", "c2lnbmF0dXJl"].join(".");

    expect(() => assertLogWithholds("kubectl create token\noutput withheld\n", [secret])).not.toThrow();
    expect(() => assertLogWithholds(`kubectl get\n{"secretKey":"${secret}"}\n`, [secret])).toThrow(
      "holds a generated secret",
    );
    expect(() => assertLogWithholds(`kubectl create token\n${token}\n`, [secret])).toThrow("holds a token");
    expect(() => assertLogWithholds("", ["short"])).toThrow("too short");
    // The body of a Secret is the encoded text of a file, and the secret starts anywhere inside it.
    for (const before of ["", "k", "ke", "key", "[default]\naws_secret_access_key="]) {
      const body = Buffer.from(`${before}${secret}\n`).toString("base64");

      expect(() => assertLogWithholds(`kubectl get\n{"data":{"cloud":"${body}"}}\n`, [secret])).toThrow(
        "holds an encoded generated secret",
      );
    }
    expect(() =>
      assertLogWithholds(`kubectl get\n${Buffer.from("6".repeat(64)).toString("base64")}\n`, [secret]),
    ).not.toThrow();
  });

  it("says why a command failed without its traces and without anything that could be a secret", () => {
    const key = "k".repeat(48);
    const output = [
      "Creating cluster ...",
      'I0927 15:14:20.264560     198 round_trippers.go:632] "Response" verb="POST" status="" error: refused',
      `ERROR: failed to create cluster: failed to init node with kubeadm: exit status 1 ${key}`,
      "error: error execution phase wait-control-plane: could not bootstrap the admin user",
      "error: error execution phase wait-control-plane: could not bootstrap the admin user",
      "k8s.io/kubernetes/cmd/kubeadm/app.Run failed",
      "\tgithub.com/spf13/cobra@v1.9.1/command.go:1148",
      "[ERROR Port-6443]: Port 6443 is in use",
      "the node became ready",
    ].join("\n");

    expect(failureSummary(output)).toEqual([
      "ERROR: failed to create cluster: failed to init node with kubeadm: exit status 1 withheld",
      "error: error execution phase wait-control-plane: could not bootstrap the admin user",
      "[ERROR Port-6443]: Port 6443 is in use",
    ]);
    expect(failureSummary("")).toEqual([]);
    expect(
      failureSummary(Array.from({ length: 40 }, (_value, index) => `error: reason ${index}`).join("\n")),
    ).toHaveLength(12);
    expect(failureSummary(`error: ${"x".repeat(900)} y`)[0].length).toBeLessThanOrEqual(300);
  });

  it("records a Secret without its body and a kubeconfig without its credentials", () => {
    const secret = "7".repeat(64);
    const body = Buffer.from(`aws_secret_access_key=${secret}\n`).toString("base64");
    const list = {
      kind: "List",
      items: [
        {
          kind: "Secret",
          metadata: { name: "cloud-credentials" },
          data: { cloud: body },
          stringData: { cloud: secret },
        },
        { kind: "ConfigMap", metadata: { name: "kept" }, data: { payload: "synthetic" } },
        {
          kind: "Deployment",
          metadata: { annotations: { "kubectl.kubernetes.io/last-applied-configuration": `{"data":"${body}"}` } },
        },
      ],
    };
    const recorded = withhold(JSON.stringify(list));

    expect(recorded).not.toContain(body);
    expect(recorded).not.toContain(secret);
    expect(recorded).toContain("cloud-credentials");
    expect(JSON.parse(recorded).items[1].data.payload).toBe("synthetic");
    expect(() => assertLogWithholds(recorded, [secret])).not.toThrow();
    expect(() => assertLogWithholds(JSON.stringify(list), [secret])).toThrow();
    const { config } = fixture("loopback");
    const kubeconfig = withhold(JSON.stringify(config));

    expect(kubeconfig).not.toContain("synthetic-key");
    expect(kubeconfig).not.toContain("synthetic-cert");
    expect(kubeconfig).toContain("https://127.0.0.1:16443");
    // What is not a document is recorded as it is.
    expect(withhold("deployment.apps/seaweedfs condition met\n")).toBe("deployment.apps/seaweedfs condition met\n");
    expect(withhold("{ not a document")).toBe("{ not a document");
  });

  it("holds the node back with the expected rules, first in their parents", () => {
    const address = "198.18.64.2";
    const chains = egressChains(address);
    const listing = [
      "-P INPUT ACCEPT",
      "-P FORWARD ACCEPT",
      "-P OUTPUT ACCEPT",
      ...chains.map(({ chain }) => `-N ${chain}`),
      ...chains.map(({ parent, chain }) => `-A ${parent} -j ${chain}`),
      "-A INPUT -j KUBE-FIREWALL",
      '-A FORWARD -m comment --comment "kubernetes forwarding rules" -j KUBE-FORWARD',
      "-A OUTPUT -j KUBE-FIREWALL",
      ...chains.flatMap(({ chain, rules }) => rules.map((rule) => `-A ${chain} ${rule.join(" ")}`)),
    ];

    expect(chains.map(({ parent, chain }) => `${parent} ${chain}`)).toEqual([
      "OUTPUT FV_DEMO_OUT",
      "FORWARD FV_DEMO_FWD",
      "INPUT FV_DEMO_IN",
    ]);
    // As the node lists them: the listing of a real node was the model of these lines.
    expect(listing).toContain("-A FV_DEMO_OUT -m conntrack --ctstate RELATED,ESTABLISHED -j RETURN");
    expect(listing).toContain(
      "-A FV_DEMO_FWD -d 198.19.0.0/18 -p tcp -m tcp --dport 18333 -j REJECT --reject-with icmp-port-unreachable",
    );
    expect(listing).toContain("-A FV_DEMO_IN -d 127.0.0.11/32 -j REJECT --reject-with icmp-port-unreachable");
    expect(listing).toContain("-A FV_DEMO_OUT -d 198.18.64.2/32 -j RETURN");
    expect(listing.at(-1)).toBe("-A FV_DEMO_IN -d 127.0.0.11/32 -j REJECT --reject-with icmp-port-unreachable");
    expect(() => assertEgressRules(listing.join("\n"), address)).not.toThrow();
    // The resolver of Docker is refused before the loopback addresses are let through.
    const leaving = chains[0].rules.map((rule) => rule.join(" "));

    expect(leaving.indexOf("-d 127.0.0.11/32 -j REJECT --reject-with icmp-port-unreachable")).toBeLessThan(
      leaving.indexOf("-d 127.0.0.0/8 -j RETURN"),
    );
    expect(leaving.at(-1)).toBe("-j REJECT --reject-with icmp-net-unreachable");
    const without = (line: string) => listing.filter((other) => other !== line).join("\n");

    expect(egressState(without("-N FV_DEMO_OUT"), chains[0]).rules).toBe("absent");
    expect(egressState(without("-A FV_DEMO_OUT -j REJECT --reject-with icmp-net-unreachable"), chains[0]).rules).toBe(
      "different",
    );
    expect(() =>
      assertEgressRules(without("-A FV_DEMO_OUT -j REJECT --reject-with icmp-net-unreachable"), address),
    ).toThrow("The rules of FV_DEMO_OUT are not the expected ones");
    expect(() =>
      assertEgressRules(
        without("-A FV_DEMO_IN -d 127.0.0.11/32 -j REJECT --reject-with icmp-port-unreachable"),
        address,
      ),
    ).toThrow("The rules of FV_DEMO_IN are not the expected ones");
    expect(egressState(without("-A OUTPUT -j FV_DEMO_OUT"), chains[0]).jump).toBe(0);
    // The rules of the services of the node in front of ours, as after a restart.
    const behind = [
      ...listing.filter((line) => line !== "-A OUTPUT -j FV_DEMO_OUT" && line !== "-A OUTPUT -j KUBE-FIREWALL"),
      "-A OUTPUT -j KUBE-FIREWALL",
      "-A OUTPUT -j FV_DEMO_OUT",
    ].join("\n");

    expect(egressState(behind, chains[0])).toEqual({ rules: "complete", jump: 2 });
    expect(() => assertEgressRules(behind, address)).toThrow("FV_DEMO_OUT is not the first rule of OUTPUT");
    // Rules in another order, or for another node, are not the expected ones.
    const swapped = listing.map((line) =>
      line === "-A FV_DEMO_OUT -d 198.18.64.2/32 -j RETURN" ? "-A FV_DEMO_OUT -d 198.18.64.3/32 -j RETURN" : line,
    );

    expect(egressState(swapped.join("\n"), chains[0]).rules).toBe("different");
    expect(() => egressState([...listing, "-A OUTPUT -j FV_DEMO_OUT"].join("\n"), chains[0])).toThrow("is repeated");
    expect(() => egressChains("192.0.2.2")).toThrow("Invalid owned node address");
  });

  it("uploads nothing from the hosted run and always takes the environment down", () => {
    const workflow = readFileSync(new URL("../.github/workflows/e2e-tests.yaml", import.meta.url), "utf8");

    expect(workflow).not.toMatch(/upload-artifact|actions\/cache\/save|\.local\/state/);
    expect(workflow).toMatch(/if: always\(\)\n\s+run: pnpm --color=always e2e:cluster:down/);
    expect(workflow).toContain("runs-on: ubuntu-24.04-arm");
  });

  it("uploads from the run of the views their screenshots and reports, and nothing of the state", () => {
    // What the workflow does, without what it says of itself in its comments.
    const workflow = readFileSync(new URL("../.github/workflows/views-tests.yaml", import.meta.url), "utf8")
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("#"))
      .join("\n");
    const uploads = [...workflow.matchAll(/uses: actions\/upload-artifact@[^\n]+\n\s+with:\n((?:\s{10,}[^\n]+\n)+)/g)];
    const saved = [...workflow.matchAll(/uses: actions\/cache\/save@[^\n]+\n\s+with:\n\s+path: ([^\n]+)/g)];

    expect(uploads).toHaveLength(1);
    expect(uploads[0][1]).toMatch(/\n?\s+path: e2e-artifacts\/\n/);
    expect(uploads[0][1].match(/path:/g)).toHaveLength(1);
    // The only thing kept from a run is the application that was built, which holds nothing of a run.
    expect(saved.map((match) => match[1])).toEqual(["freelens/freelens/dist"]);
    expect(workflow).not.toMatch(/\.local\/state|kubeconfig|credentials|operations\.log/);
    expect(workflow).toMatch(/if: always\(\)\n\s+run: node e2e\/scripts\/local-demo\.mts down --context/);
    expect(workflow).toContain("runs-on: ubuntu-24.04-arm");
    expect(workflow).toMatch(/^permissions:\n {2}contents: read$/m);
  });

  it("keeps the internal network wherever the host reaches the address of the node", () => {
    expect(networkShape("linux", { OperatingSystem: "Ubuntu 24.04.3 LTS" })).toBe("internal");
    expect(networkShape("linux", {})).toBe("internal");
    expect(networkShape("linux", { OperatingSystem: "Docker Desktop" })).toBe("loopback");
    expect(networkShape("darwin", { OperatingSystem: "Docker Desktop" })).toBe("loopback");
    expect(networkShape("darwin", { OperatingSystem: "Alpine Linux" })).toBe("loopback");
  });

  it("limits the node to the memory the daemon has and asks for enough of it", () => {
    const gibibyte = 1024 ** 3;

    expect(nodeMemory({ NCPU: 4, MemTotal: 16 * gibibyte })).toBe(8192);
    expect(nodeMemory({ NCPU: 12, MemTotal: 8 * gibibyte - 300 * 1024 ** 2 })).toBe(7892);
    expect(() => nodeMemory({ NCPU: 4, MemTotal: 4 * gibibyte })).toThrow("6 GiB");
    expect(() => nodeMemory({ NCPU: 2, MemTotal: 16 * gibibyte })).toThrow("processors");
    expect(() => nodeMemory({ NCPU: 4, MemTotal: 0 })).toThrow();
  });

  it("names the official release of each binary for each host", () => {
    expect(binaryTarget("darwin", "x64")).toBe("darwin-amd64");
    expect(binaryTarget("linux", "arm64")).toBe("linux-arm64");
    expect(() => binaryTarget("win32", "x64")).toThrow("Unsupported host system");
    expect(() => binaryTarget("linux", "ia32")).toThrow("Unsupported host architecture");
    expect(binaryUrl("kind", "linux-arm64")).toBe(
      `https://github.com/kubernetes-sigs/kind/releases/download/v${BINARIES.kind.version}/kind-linux-arm64`,
    );
    expect(binaryUrl("kubectl", "darwin-amd64")).toBe(
      `https://dl.k8s.io/release/v${BINARIES.kubectl.version}/bin/darwin/amd64/kubectl`,
    );
    for (const binary of Object.values(BINARIES)) {
      expect(Object.keys(binary.checksums).sort()).toEqual([
        "darwin-amd64",
        "darwin-arm64",
        "linux-amd64",
        "linux-arm64",
      ]);
      expect(new Set(Object.values(binary.checksums)).size).toBe(4);
      for (const checksum of Object.values(binary.checksums)) expect(checksum).toMatch(/^[a-f0-9]{64}$/);
    }
  });

  it("refuses a download that does not match its pinned checksum", () => {
    expect(() => assertBinary("kind", "linux-amd64", new TextEncoder().encode("not the release"))).toThrow(
      "does not match its pinned checksum",
    );
    expect(() => assertBinary("kubectl", "darwin-arm64", new Uint8Array())).toThrow();
  });

  it("uses a local Docker socket and nothing else", () => {
    const sockets = new Set(["/synthetic/run/docker.sock"]);

    expect(dockerSocket(["/var/run/docker.sock", "/synthetic/run/docker.sock"], (path) => sockets.has(path))).toBe(
      "unix:///synthetic/run/docker.sock",
    );
    expect(() => dockerSocket(["/var/run/docker.sock"], () => false)).toThrow("No local Docker socket");
    expect(() => dockerSocket(["relative/docker.sock"], () => true)).toThrow();
  });

  it("compares the subnets with the Docker networks, and with the routes where the host lists them", () => {
    const networks = [
      { Id: "owned", IPAM: { Config: [{ Subnet: SUBNETS.docker }] } },
      { Id: "other", IPAM: { Config: [{ Subnet: "198.18.64.0/26" }, { Subnet: "fd00::/64" }] } },
      { Id: "empty", IPAM: { Config: null } },
    ];
    const owned = { networkId: "owned", bridge: "br-synthetic" };
    const routes = [
      { dst: "default", dev: "eth0" },
      { dst: "198.19.0.0/24", dev: "eth1" },
      { dst: SUBNETS.docker, dev: "br-synthetic" },
    ];

    expect(occupiedSubnets(networks, undefined, owned)).toEqual(["198.18.64.0/26"]);
    expect(occupiedSubnets(networks, routes, owned)).toEqual(["198.19.0.0/24", "198.18.64.0/26"]);
    expect(occupiedSubnets(networks, routes, { networkId: "", bridge: "br-synthetic" })).toEqual([
      "198.19.0.0/24",
      SUBNETS.docker,
      SUBNETS.docker,
      "198.18.64.0/26",
    ]);
  });
});

describe("authorized failed-node removal", () => {
  it("accepts only the stopped, owned, uninitialized node", () => {
    const value = fixture();

    value.identity.kubeconfigHash = "";
    value.nodes[0].State.Running = false;
    expect(() => assertFailedNodeRemoval(value.identity, value.nodes, value.network, 0, false)).not.toThrow();
    expect(() => assertFailedNodeRemoval(value.identity, value.nodes, value.network, 1, false)).toThrow();
    expect(() => assertFailedNodeRemoval(value.identity, value.nodes, value.network, 0, true)).toThrow();
    expect(() =>
      assertFailedNodeRemoval(
        { ...value.identity, kubeconfigHash: "initialized" },
        value.nodes,
        value.network,
        0,
        false,
      ),
    ).toThrow();
  });

  it.each(["running", "replaced", "other-cluster", "other-owner", "extra-network"])("rejects %s removal", (variant) => {
    const value = fixture();

    value.identity.kubeconfigHash = "";
    value.nodes[0].State.Running = false;
    if (variant === "running") value.nodes[0].State.Running = true;
    if (variant === "replaced") value.nodes[0].Id = "different";
    if (variant === "other-cluster") value.nodes[0].Config.Labels["io.x-k8s.kind.cluster"] = "kind";
    if (variant === "other-owner") value.network.Labels[OWNER_LABEL] = "different";
    if (variant === "extra-network") value.nodes[0].NetworkSettings.Networks.other = { NetworkID: "different" };
    expect(() => assertFailedNodeRemoval(value.identity, value.nodes, value.network, 0, false)).toThrow();
  });
});

describe("demo network and resource ownership", () => {
  it("detects overlapping routes in either containment direction", () => {
    expect(subnetsOverlap(SUBNETS.docker, "198.18.0.0/15")).toBe(true);
    expect(subnetsOverlap(SUBNETS.docker, "198.18.64.9")).toBe(true);
    expect(subnetsOverlap("198.18.64.9", SUBNETS.docker)).toBe(true);
    expect(subnetsOverlap(SUBNETS.docker, SUBNETS.pods)).toBe(false);
    expect(subnetsOverlap(SUBNETS.pods, SUBNETS.services)).toBe(false);
    expect(() => subnetsOverlap("invalid", SUBNETS.docker)).toThrow();
    expect(() => subnetsOverlap("198.18.64.0/", SUBNETS.docker)).toThrow();
  });

  it("allows updates or cleanup only for an owned, unchanged resource", () => {
    const resource = { metadata: { uid: "fixture-uid", labels: { [OWNER_LABEL]: "fixture-owner" } } };

    expect(() => assertOwnedResource("fixture-owner", resource, "fixture-uid")).not.toThrow();
    expect(() => assertOwnedResource("other-owner", resource)).toThrow();
    expect(() => assertOwnedResource("fixture-owner", resource, "old-uid")).toThrow();
    expect(() => assertOwnedResource("fixture-owner", {})).toThrow();
  });
});

describe("local storage setup contracts", () => {
  const admin = { accessKey: "A".repeat(24), secretKey: "B".repeat(48) };
  const velero = { accessKey: "C".repeat(24), secretKey: "D".repeat(48) };

  it("maps only known digest pins to their official offline tags", () => {
    // The tag of the pin, without its digest, whatever version the pin names: an update of the pin
    // changes the one place that names the version.
    expect(IMAGES.storage).toMatch(/^docker\.io\/chrislusf\/seaweedfs:\d+\.\d+@sha256:[a-f0-9]{64}$/);
    expect(preloadedImage(IMAGES.storage)).toMatch(/^docker\.io\/chrislusf\/seaweedfs:\d+\.\d+$/);
    expect(IMAGES.storage.startsWith(`${preloadedImage(IMAGES.storage)}@sha256:`)).toBe(true);
    expect(() => preloadedImage("freelens-velero-lab/storage:custom")).toThrow();
    expect(() => preloadedImage("docker.io/chrislusf/seaweedfs:latest")).toThrow();
  });

  it("preserves upstream CRD schemas and refuses external installer targets", () => {
    const definition = {
      apiVersion: "apiextensions.k8s.io/v1",
      kind: "CustomResourceDefinition",
      metadata: { name: "backups.velero.io" },
      spec: { synthetic: "unchanged" },
    };
    const location = {
      apiVersion: "velero.io/v1",
      kind: "BackupStorageLocation",
      metadata: { name: "default", namespace: "velero-demo" },
      spec: {
        provider: "aws",
        objectStorage: { bucket: BUCKET },
        config: { region: "us-east-1", s3Url: STORAGE_ENDPOINT, s3ForcePathStyle: "true" },
      },
    };
    const resources = prepareVeleroResources("synthetic-owner", { items: [definition, location] });

    expect(resources[0].spec).toEqual(definition.spec);
    expect(resources[1].metadata.labels?.[OWNER_LABEL]).toBe("synthetic-owner");
    expect(definition.metadata).not.toHaveProperty("labels");
    expect(() =>
      prepareVeleroResources("synthetic-owner", {
        items: [{ ...location, metadata: { ...location.metadata, namespace: "other" } }],
      }),
    ).toThrow();
    expect(() =>
      prepareVeleroResources("synthetic-owner", {
        items: [
          {
            ...location,
            spec: { ...location.spec, config: { ...location.spec.config, s3Url: "https://example.invalid" } },
          },
        ],
      }),
    ).toThrow();
  });

  it("keeps installer workloads offline and disables ambient metadata credentials", () => {
    const resource = {
      apiVersion: "apps/v1",
      kind: "Deployment",
      metadata: { name: "velero", namespace: "velero-demo" },
      spec: {
        template: {
          metadata: {},
          spec: {
            containers: [{ image: preloadedImage(IMAGES.velero) }],
            initContainers: [{ image: preloadedImage(IMAGES.plugin) }],
          },
        },
      },
    };
    const [prepared] = prepareVeleroResources("synthetic-owner", { items: [resource] });

    expect(prepared.spec).toMatchObject({
      template: {
        spec: {
          containers: [
            {
              imagePullPolicy: "Never",
              env: [
                { name: "AWS_EC2_METADATA_DISABLED", value: "true" },
                { name: "AWS_CONFIG_FILE", value: "/dev/null" },
              ],
            },
          ],
          initContainers: [{ imagePullPolicy: "Never" }],
        },
      },
    });
    resource.spec.template.spec.containers[0].image = "unapproved/image:latest";
    expect(() => prepareVeleroResources("synthetic-owner", { items: [resource] })).toThrow();
  });

  it("pins every image and the loopback-only kind API", () => {
    for (const image of Object.values(IMAGES)) expect(image).toMatch(/@sha256:[a-f0-9]{64}$/);
    const configuration = kindConfiguration("/synthetic-private/kind-hosts");

    expect(configuration.networking.apiServerAddress).toBe("127.0.0.1");
    expect(configuration.nodes).toHaveLength(1);
    expect(configuration.nodes[0].extraMounts).toEqual([
      { hostPath: "/synthetic-private/kind-hosts", containerPath: "/etc/hosts", readOnly: false },
    ]);
    expect(KIND_HOSTS).toContain("198.18.64.1 host.docker.internal");
    expect(() => kindConfiguration("relative-hosts")).toThrow();
  });

  it("tells the client of the node a request to the store as it always was, and one with a body by the file the node keeps", () => {
    const address = "198.19.64.7";
    const key = `/${BUCKET}/backups/fixture-synced-backup-a1b2c3d4/velero-backup.json`;
    const sha256 = createHash("sha256").update("synthetic body").digest("hex");
    const at = new Date("2026-10-05T10:00:00.789Z");
    // What every request says, in the order it was always said in.
    const asked = (method: string, path: string, seconds: number) => [
      "silent",
      "show-error",
      "connect-timeout = 3",
      `max-time = ${seconds}`,
      'proto = "=http"',
      `url = "http://seaweedfs.velero-demo.svc.cluster.local:8333${path}"`,
      'resolve = "seaweedfs.velero-demo.svc.cluster.local:8333:198.19.64.7"',
      ...(method === "HEAD" ? [] : ["max-filesize = 16777216"]),
      'write-out = "\\nFV_HTTP_META:{\\"code\\":%{response_code},\\"headers\\":%{header_json}}"',
      method === "HEAD" ? "head" : `request = "${method}"`,
    ];
    const signs = ['aws-sigv4 = "aws:amz:us-east-1:s3"', `user = "${"C".repeat(24)}:${"D".repeat(48)}"`];

    // Without a body: ten seconds, and the client signs when it is given an identity.
    expect(storeSettings({ method: "GET", path: `/${BUCKET}`, address })).toEqual(asked("GET", `/${BUCKET}`, 10));
    for (const method of ["GET", "HEAD", "PUT"] as const)
      expect(storeSettings({ method, path: `/${BUCKET}`, address, credentials: velero })).toEqual([
        ...asked(method, `/${BUCKET}`, 10),
        ...signs,
      ]);
    // With a body: a minute, and the file of the node, which is one and is named in no argument of a command
    // that carries a credential. The client uploads it, or sends it as the data of the request, and signs.
    const sent = (way: (typeof STORE_WAYS)[number]) =>
      storeSettings({ method: "PUT", path: key, address, credentials: velero, body: { way, sha256 }, at });

    expect(STORE_BODY_FILE).toBe("/tmp/velero-fixture-store-body");
    expect(sent("upload")).toEqual([
      ...asked("PUT", key, 60),
      'upload-file = "/tmp/velero-fixture-store-body"',
      ...signs,
    ]);
    expect(sent("data")).toEqual([
      ...asked("PUT", key, 60),
      'data-binary = "@/tmp/velero-fixture-store-body"',
      'header = "Content-Type: application/octet-stream"',
      ...signs,
    ]);
    // Or the request is signed here, over the digest of the body: the client is told the three headers and
    // is not asked to sign, and the key of the identity is in nothing it is told.
    const signed = storeAuthorization({ path: key, sha256, credentials: velero, at });

    expect(sent("signed")).toEqual([
      ...asked("PUT", key, 60),
      'upload-file = "/tmp/velero-fixture-store-body"',
      `header = "x-amz-content-sha256: ${sha256}"`,
      'header = "x-amz-date: 20261005T100000Z"',
      `header = "Authorization: ${signed.authorization}"`,
    ]);
    expect(sent("signed").join("\n")).not.toContain(velero.secretKey);
    // A body is written, by an identity, in a way the client knows, and signed at a moment.
    const body = { way: "upload", sha256 } as const;

    for (const refused of [
      { method: "PUT", path: key, address, body },
      { method: "GET", path: key, address, credentials: velero, body },
      { method: "HEAD", path: key, address, credentials: velero, body },
    ] as const)
      expect(() => storeSettings(refused)).toThrow("A body is written by an identity of the store");
    expect(() =>
      storeSettings({
        method: "PUT",
        path: key,
        address,
        credentials: velero,
        body: { way: "chunked", sha256 } as never,
      }),
    ).toThrow("A body is sent in a way the client of the store knows");
    expect(() =>
      storeSettings({ method: "PUT", path: key, address, credentials: velero, body: { way: "signed", sha256 } }),
    ).toThrow("The time a request is signed at is required");
  });

  it("signs a write to the store over the digest of its body, its host and its date, with the key of the identity", () => {
    const path = `/${BUCKET}/backups/fixture-synced-backup-a1b2c3d4/fixture-synced-backup-a1b2c3d4-logs.gz`;
    const sha256 = createHash("sha256").update("synthetic body").digest("hex");
    const at = new Date("2026-10-05T10:00:00.789Z");
    const request = { path, sha256, credentials: velero, at };
    // The request as the store writes it again from what it received, and what is signed of it.
    const received = [
      "PUT",
      path,
      "",
      "host:seaweedfs.velero-demo.svc.cluster.local:8333",
      `x-amz-content-sha256:${sha256}`,
      "x-amz-date:20261005T100000Z",
      "",
      "host;x-amz-content-sha256;x-amz-date",
      sha256,
    ].join("\n");
    const toSign = [
      "AWS4-HMAC-SHA256",
      "20261005T100000Z",
      "20261005/us-east-1/s3/aws4_request",
      createHash("sha256").update(received).digest("hex"),
    ].join("\n");
    const keyed = (key: string | Buffer, text: string) => createHmac("sha256", key).update(text).digest();
    const ofTheDay = keyed(`AWS4${velero.secretKey}`, "20261005");
    const ofTheRegion = keyed(ofTheDay, "us-east-1");
    const ofTheService = keyed(ofTheRegion, "s3");
    const signature = keyed(keyed(ofTheService, "aws4_request"), toSign).toString("hex");

    expect(storeAuthorization(request)).toEqual({
      date: "20261005T100000Z",
      authorization:
        `AWS4-HMAC-SHA256 Credential=${velero.accessKey}/20261005/us-east-1/s3/aws4_request, ` +
        `SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=${signature}`,
    });
    expect(STORAGE_ENDPOINT).toBe("http://seaweedfs.velero-demo.svc.cluster.local:8333");
    // The same request is signed the same, and another body, another key, another second, another day and
    // another identity are each signed otherwise. The key of the identity is not in what is sent.
    const signatures = [
      request,
      { ...request, sha256: createHash("sha256").update("another body").digest("hex") },
      { ...request, path: path.replace("-logs.gz", "-results.gz") },
      { ...request, at: new Date("2026-10-05T10:00:01.000Z") },
      { ...request, at: new Date("2026-10-06T10:00:00.789Z") },
      { ...request, credentials: { ...velero, secretKey: "E".repeat(48) } },
      { ...request, credentials: admin },
    ].map((signed) => storeAuthorization(signed).authorization.split("Signature=")[1]);

    expect(storeAuthorization(request)).toEqual(storeAuthorization({ ...request }));
    expect(new Set(signatures).size).toBe(signatures.length);
    for (const one of signatures) expect(one).toMatch(/^[a-f0-9]{64}$/);
    expect(storeAuthorization(request).authorization).not.toContain(velero.secretKey);
    // A key that is not sent as it is written is not signed here, and nothing is signed without a digest,
    // an identity or a moment.
    for (const [refused, words] of [
      [{ ...request, path: `${path}?versionId=1` }, "The key of a signed request is sent as it is written"],
      [{ ...request, path: "/velero-demo/backups/a b" }, "The key of a signed request is sent as it is written"],
      [{ ...request, path: path.slice(1) }, "The key of a signed request is sent as it is written"],
      [{ ...request, sha256: "" }, "The digest of the body of a signed request is required"],
      [{ ...request, sha256: sha256.toUpperCase() }, "The digest of the body of a signed request is required"],
      [{ ...request, credentials: { ...velero, secretKey: "" } }, "A signed request is of an identity of the store"],
      [{ ...request, credentials: { ...velero, accessKey: "" } }, "A signed request is of an identity of the store"],
      [{ ...request, at: new Date(Number.NaN) }, "The time a request is signed at is required"],
    ] as const)
      expect(() => storeAuthorization(refused)).toThrow(words);
  });

  it("tells the log of the operations a request to the store by its verb, its key and what the store answered", () => {
    const key = `/${BUCKET}/backups/fixture-synced-backup-a1b2c3d4/velero-backup.json`;

    expect(storeLogLine({ method: "GET", path: key, code: 200 })).toBe(`store GET ${key}: 200\n`);
    expect(storeLogLine({ method: "HEAD", path: key, code: 404 })).toBe(`store HEAD ${key}: 404\n`);
    // Of a key it does not hold the store says the length of its own answer, which is told of no key.
    expect(storeLogLine({ method: "HEAD", path: key, code: 404, held: "408" })).toBe(`store HEAD ${key}: 404\n`);
    expect(storeLogLine({ method: "HEAD", path: key, code: 403, held: "249" })).toBe(`store HEAD ${key}: 403\n`);
    // Of a key that was asked for, the length the store says it holds; of a body, its length and its way.
    expect(storeLogLine({ method: "HEAD", path: key, code: 200, held: "1345" })).toBe(
      `store HEAD ${key}: 200, 1345 bytes held\n`,
    );
    for (const way of STORE_WAYS) {
      expect(storeLogLine({ method: "PUT", path: key, code: 403, body: { way, bytes: 45 } })).toBe(
        `store PUT ${key}: 403, 45 bytes sent as ${way}\n`,
      );
    }
    // A request the store did not answer is told as that.
    expect(storeLogLine({ method: "PUT", path: key, body: { way: "data", bytes: 45 } })).toBe(
      `store PUT ${key}: no answer, 45 bytes sent as data\n`,
    );
    // What the store says of a length is repeated when it is a number, and not otherwise.
    for (const held of ["", "12 bytes", "-1", "1e3", "0x10"]) {
      expect([held, storeLogLine({ method: "HEAD", path: key, code: 200, held })]).toEqual([
        held,
        `store HEAD ${key}: 200\n`,
      ]);
    }
  });

  // The node and the cluster as a request to the store reaches them: the Service of the store, the one file
  // the node keeps a body in, a client that answers what the store would, and the log of the operations.
  // What it is told makes one of them fail, or answer otherwise.
  function reached() {
    const run = "a1b2c3d4";
    const calls: string[] = [];
    const log: string[] = [];
    const sent: { settings: string; timeout: number; body?: Buffer }[] = [];
    const node: { file?: Buffer } = {};
    const told: {
      service?: (service: { metadata: { uid: string; labels: Record<string, string> }; spec: object }) => void;
      fails?: "tee" | "sha256sum" | "client" | "rm";
      digest?: string;
      output?: Buffer;
      answer?: { code: number; headers?: Record<string, string[]>; bytes?: Buffer };
    } = {};
    const journal: RunJournal = {
      owner: "synthetic-owner",
      resources: [
        { apiVersion: "v1", kind: "Service", name: "seaweedfs", namespace: "velero-demo", uid: "uid-of-store" },
      ],
      fixtureRun: { id: run },
    };
    const failure = (what: string) => Object.assign(new Error(what), { stderr: Buffer.from(`${what} failed`) });
    const reach: StoreReach = {
      kubectl(args) {
        const service = {
          apiVersion: "v1",
          kind: "Service",
          metadata: {
            name: "seaweedfs",
            namespace: "velero-demo",
            uid: "uid-of-store",
            labels: { [OWNER_LABEL]: "synthetic-owner" },
          },
          spec: { clusterIP: "198.19.64.7" },
        };

        calls.push(`kubectl ${args.join(" ")}`);
        told.service?.(service);
        return JSON.stringify(service);
      },
      inNode(args, input) {
        calls.push(`node ${args.join(" ")}`);
        if (told.fails === args[0]) throw failure(args[0]);
        if (args[0] === "tee" && input) node.file = Buffer.from(input);
        if (args[0] === "sha256sum") {
          return `${
            told.digest ??
            createHash("sha256")
              .update(node.file ?? "")
              .digest("hex")
          }  ${args[1]}\n`;
        }
        if (args[0] === "rm") delete node.file;
        return "";
      },
      client(settings, timeout) {
        const { code, headers = {}, bytes = Buffer.alloc(0) } = told.answer ?? { code: 200 };

        calls.push("client");
        sent.push({ settings, timeout, body: node.file });
        if (told.fails === "client") throw failure("client");
        return (
          told.output ?? Buffer.concat([bytes, Buffer.from(`\nFV_HTTP_META:${JSON.stringify({ code, headers })}`)])
        );
      },
      log: (text) => {
        log.push(text);
      },
      now: () => new Date("2026-10-05T10:00:00.789Z"),
    };

    return { run, calls, log, sent, node, told, journal, reach };
  }
  const SERVICE = "kubectl get service seaweedfs --namespace velero-demo -o json";
  const asked = (words: () => unknown) => {
    try {
      words();
      return "";
    } catch (error) {
      return (error as Error).message;
    }
  };

  it("sends the store a request in its order: what is refused first, then where the store is, the body kept in the node and read back, the client, and the body removed", () => {
    const from = reached();
    const paths = tabArtifactPaths(from.run);
    const real = fixtureArtifactPaths(from.run).backupLog;
    const bytes = Buffer.from("synthetic body");
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const address = "198.19.64.7";
    const at = new Date("2026-10-05T10:00:00.789Z");

    // A read: the Service of the store, and the client with the settings of the request, in ten seconds and
    // five more for its process. What the store answered is told whole, and in the log by one line.
    from.told.answer = { code: 200, headers: { etag: ['"synthetic"'] }, bytes: Buffer.from("synthetic answer") };
    expect(storeRequest(from.reach, from.journal, "GET", real, velero)).toEqual({
      code: 200,
      headers: { etag: ['"synthetic"'] },
      bytes: Buffer.from("synthetic answer"),
      body: "synthetic answer",
    });
    expect(from.calls).toEqual([SERVICE, "client"]);
    expect(from.sent).toEqual([
      {
        settings: `${storeSettings({ method: "GET", path: real, address, credentials: velero, at }).join("\n")}\n`,
        timeout: 15_000,
        body: undefined,
      },
    ]);
    expect(from.log).toEqual([`store GET ${real}: 200\n`]);
    // Whether a key is there: the length the store says it holds is in the line.
    from.told.answer = { code: 200, headers: { "content-length": ["45"] } };
    storeRequest(from.reach, from.journal, "HEAD", real, velero);
    // The store of the environment answers for a key it does not hold with a text of its own, and says the
    // length of that text: the line tells of no length then.
    from.told.answer = { code: 404, headers: { "content-length": ["408"] } };
    storeRequest(from.reach, from.journal, "HEAD", real, velero);
    expect(from.log.slice(1)).toEqual([`store HEAD ${real}: 200, 45 bytes held\n`, `store HEAD ${real}: 404\n`]);
    // A write of a key of the tabs, while their placement is recorded as storing: the node keeps the body in
    // its one file, the file is read back by its digest, the client is told to send it, in each way, with a
    // minute and a quarter of one more for its process, and the file is removed.
    from.journal.fixtureRun = {
      id: from.run,
      tabs: { state: "storing", artifacts: "a".repeat(64), shape: "b".repeat(16) },
    };
    for (const way of STORE_WAYS) {
      const calls = from.calls.length;

      from.told.answer = { code: 200 };
      expect(storeRequest(from.reach, from.journal, "PUT", paths.synced.archive, velero, { bytes, way }).code).toBe(
        200,
      );
      expect([way, from.calls.slice(calls)]).toEqual([
        way,
        [
          SERVICE,
          `node tee ${STORE_BODY_FILE}`,
          `node sha256sum ${STORE_BODY_FILE}`,
          "client",
          `node rm -f ${STORE_BODY_FILE}`,
        ],
      ]);
      expect(from.sent.at(-1)).toEqual({
        settings: `${storeSettings({
          method: "PUT",
          path: paths.synced.archive,
          address,
          credentials: velero,
          body: { way, sha256 },
          at,
        }).join("\n")}\n`,
        timeout: 75_000,
        body: bytes,
      });
      expect(from.node.file).toBeUndefined();
      expect(from.log.at(-1)).toBe(`store PUT ${paths.synced.archive}: 200, 14 bytes sent as ${way}\n`);
    }
    // Nothing of the identity and nothing of a body is in the log, whatever was sent.
    expect(from.log.join("")).not.toMatch(/C{24}|D{48}|synthetic body|Signature|aws-sigv4/);
    expect(from.log).toHaveLength(6);
  });

  it("sends the store nothing of a request that is refused: the cluster is not asked, the node keeps nothing, and the log says nothing", () => {
    const paths = tabArtifactPaths("a1b2c3d4");
    const body: StoreBody = { bytes: Buffer.from("synthetic body"), way: "upload" };
    const recorded = (state: TabPlacement["state"], repaired?: string[]) => ({
      state,
      artifacts: "a".repeat(64),
      shape: "b".repeat(16),
      ...(repaired ? { repaired } : {}),
    });

    for (const [tabs, method, path, sent, words] of [
      // What is written is written while the journal says so, at the moment of the request.
      [
        undefined,
        "PUT",
        paths.synced.archive,
        body,
        "A key of the tabs is written while the placement of the tabs is recorded as storing",
      ],
      [
        recorded("stored"),
        "PUT",
        paths.synced.archive,
        body,
        "A key of the tabs is written while the placement of the tabs is recorded as storing",
      ],
      [
        recorded("synced"),
        "PUT",
        paths.synced.metadata,
        body,
        "A key of the tabs is written while the placement of the tabs is recorded as storing",
      ],
      [
        recorded("cleared"),
        "PUT",
        paths.synced.archive,
        body,
        "A key of the tabs is written while the placement of the tabs is recorded as storing",
      ],
      [
        recorded("clearing"),
        "PUT",
        paths.synced.archive,
        body,
        "While the fixtures of the tabs are removed nothing is written but the contents of a backup that are recorded to be put back",
      ],
      [
        recorded("clearing", [paths.withoutLog.archive]),
        "PUT",
        paths.synced.archive,
        body,
        "While the fixtures of the tabs are removed nothing is written but the contents of a backup that are recorded to be put back",
      ],
      [
        recorded("storing"),
        "PUT",
        paths.synced.archive,
        undefined,
        "A key of the tabs is not written without its body",
      ],
      [
        recorded("storing"),
        "GET",
        fixtureArtifactPaths("a1b2c3d4").backupLog,
        body,
        "Only a key of the tabs is sent with a body",
      ],
      [recorded("storing"), "GET", paths.synced.log, undefined, "Unexpected local bucket target"],
      [recorded("storing"), "DELETE", paths.synced.archive, undefined, "Unexpected local bucket target"],
      [recorded("storing"), "PUT", tabArtifactPaths("b1b2c3d4").synced.archive, body, "Unexpected local bucket target"],
    ] as const) {
      const from = reached();

      from.journal.fixtureRun = { id: from.run, ...(tabs ? { tabs } : {}) };
      expect([
        tabs?.state,
        method,
        path,
        asked(() => storeRequest(from.reach, from.journal, method as "PUT", path, velero, sent)),
      ]).toEqual([tabs?.state, method, path, words]);
      expect([from.calls, from.log, from.node.file]).toEqual([[], [], undefined]);
    }
    // A journal with no run allows no key of a run, and the contents that are recorded to be put back are
    // written while the removal goes on.
    const runless = reached();

    delete runless.journal.fixtureRun;
    expect(asked(() => storeRequest(runless.reach, runless.journal, "HEAD", paths.synced.archive, velero))).toBe(
      "Unexpected local bucket target",
    );
    expect(runless.calls).toEqual([]);
    const repairing = reached();

    repairing.journal.fixtureRun = { id: repairing.run, tabs: recorded("clearing", [paths.synced.archive]) };
    expect(storeRequest(repairing.reach, repairing.journal, "PUT", paths.synced.archive, velero, body).code).toBe(200);
    // A Service of the store that is not the one this environment made, or is outside its subnet: nothing is
    // kept in the node and the client is told nothing.
    for (const [change, words] of [
      [
        (service: { metadata: { labels: Record<string, string> } }) => {
          service.metadata.labels[OWNER_LABEL] = "another-owner";
        },
        "Resource is not owned by this demo",
      ],
      [
        (service: { metadata: { uid: string } }) => {
          service.metadata.uid = "uid-of-another";
        },
        "Resource identity changed",
      ],
      [
        (service: { spec: object }) => {
          service.spec = { clusterIP: "203.0.113.7" };
        },
        "Storage service is outside the dedicated service subnet",
      ],
    ] as const) {
      const from = reached();

      from.journal.fixtureRun = { id: from.run, tabs: recorded("storing") };
      from.told.service = change as never;
      expect(asked(() => storeRequest(from.reach, from.journal, "PUT", paths.synced.archive, velero, body))).toBe(
        words,
      );
      expect([from.calls, from.log, from.node.file]).toEqual([[SERVICE], [], undefined]);
    }
  });

  it("removes the body from the node whatever happens to a request, tells the log what failed, and sends no body the node does not hold as it was made", () => {
    const paths = tabArtifactPaths("a1b2c3d4");
    const body: StoreBody = { bytes: Buffer.from("synthetic body"), way: "data" };
    const writing = () => {
      const from = reached();

      from.journal.fixtureRun = {
        id: from.run,
        tabs: { state: "storing", artifacts: "a".repeat(64), shape: "b".repeat(16) },
      };
      return { from, put: () => storeRequest(from.reach, from.journal, "PUT", paths.synced.archive, velero, body) };
    };
    const kept = `node tee ${STORE_BODY_FILE}`;
    const read = `node sha256sum ${STORE_BODY_FILE}`;
    const removed = `node rm -f ${STORE_BODY_FILE}`;
    const notKept =
      "The node did not keep the body of a local storage request; details retained in the private operations log";

    // The node does not keep the body, or does not tell its digest: the client is told nothing.
    for (const fails of ["tee", "sha256sum"] as const) {
      const { from, put } = writing();

      from.told.fails = fails;
      expect([fails, asked(put)]).toEqual([fails, notKept]);
      expect(from.calls).toEqual([SERVICE, kept, ...(fails === "sha256sum" ? [read] : []), removed]);
      expect(from.log).toEqual([`The body of a local storage request was not kept in the node\n${fails} failed\n`]);
    }
    // What the node holds is not what was made: the client is told nothing, and the file is removed.
    const other = writing();

    other.from.told.digest = "0".repeat(64);
    expect(asked(other.put)).toBe("The node does not hold the body of a local storage request as it was made");
    expect(other.from.calls).toEqual([SERVICE, kept, read, removed]);
    expect([other.from.sent, other.from.node.file]).toEqual([[], undefined]);
    // The client fails: the log says which request, with what the client said and nothing of its settings.
    const failing = writing();

    failing.from.told.fails = "client";
    expect(asked(failing.put)).toBe("Local storage request failed; details retained in the private operations log");
    expect(failing.from.calls).toEqual([SERVICE, kept, read, "client", removed]);
    expect(failing.from.log).toEqual([
      `store PUT ${paths.synced.archive}: no answer, 14 bytes sent as data\nclient failed\n`,
    ]);
    expect(failing.from.node.file).toBeUndefined();
    // The file is not removed: the log says so, and what the store answered is answered all the same; and
    // what failed first is what is told when the removal fails after it.
    const left = writing();

    left.from.told.fails = "rm";
    expect(left.put().code).toBe(200);
    expect(left.from.log).toEqual([
      "The body of a local storage request was not removed from the node\n",
      `store PUT ${paths.synced.archive}: 200, 14 bytes sent as data\n`,
    ]);
    // An answer of the client that is not one of the store: with no metadata, with metadata that is no JSON,
    // with a code that is no code of an answer, or with no headers. The log says which request was sent and
    // that no answer of the store came, with nothing of what the client gave.
    for (const [output, words] of [
      [Buffer.from("synthetic answer"), "Missing local storage response metadata"],
      [Buffer.from("synthetic answer\nFV_HTTP_META:synthetic metadata"), "Invalid local storage response"],
      [Buffer.from('\nFV_HTTP_META:{"code":0,"headers":{}}'), "Invalid local storage response"],
      [Buffer.from('\nFV_HTTP_META:{"code":200.5,"headers":{}}'), "Invalid local storage response"],
      [Buffer.from('\nFV_HTTP_META:{"code":600,"headers":{}}'), "Invalid local storage response"],
      [Buffer.from('\nFV_HTTP_META:{"code":200}'), "Invalid local storage response"],
      [Buffer.from('\nFV_HTTP_META:{"code":200,"headers":null}'), "Invalid local storage response"],
    ] as const) {
      const { from, put } = writing();

      from.told.output = output;
      expect([output.toString("utf8"), asked(put)]).toEqual([output.toString("utf8"), words]);
      expect(from.calls.at(-1)).toBe(removed);
      expect([output.toString("utf8"), from.log]).toEqual([
        output.toString("utf8"),
        [
          `store PUT ${paths.synced.archive}: no answer, 14 bytes sent as data\nThe client gave no answer of the store\n`,
        ],
      ]);
    }
    // A read the client gave no answer of the store for is told the same way.
    const unanswered = reached();

    unanswered.told.output = Buffer.from("synthetic answer");
    expect(asked(() => storeRequest(unanswered.reach, unanswered.journal, "HEAD", `/${BUCKET}`, admin))).toBe(
      "Missing local storage response metadata",
    );
    expect(unanswered.log).toEqual([`store HEAD /${BUCKET}: no answer\nThe client gave no answer of the store\n`]);
    // A request without a body keeps nothing in the node and removes nothing from it.
    const reading = reached();

    reading.told.fails = "client";
    expect(asked(() => storeRequest(reading.reach, reading.journal, "HEAD", `/${BUCKET}`, admin))).toBe(
      "Local storage request failed; details retained in the private operations log",
    );
    expect(reading.calls).toEqual([SERVICE, "client"]);
    expect(reading.log).toEqual([`store HEAD /${BUCKET}: no answer\nclient failed\n`]);
  });

  it("keeps the record of the tabs in private: the metadata in a file written whole before the journal tells of it, and both ended with the record", () => {
    const directory = mkdtempSync(join(tmpdir(), "velero-tab-record-"));
    const files = {
      metadata: join(directory, "fixture-tab-metadata.json"),
      facts: join(directory, "tab-fixtures.json"),
    };
    const journal: RunJournal = { owner: "synthetic-owner", resources: [], fixtureRun: { id: "a1b2c3d4" } };
    const placement: TabPlacement = {
      state: "storing",
      artifacts: "a".repeat(64),
      shape: "b".repeat(16),
      metadata: { synced: '{"synthetic":"first"}', withoutLog: '{"synthetic":"second"}' },
    };
    // What the file held, and what the journal said, each time the journal was saved.
    const saved: { file: string | undefined; tabs: unknown }[] = [];
    const held = (file: string) => (existsSync(file) ? readFileSync(file, "utf8") : undefined);
    const record = tabRecord(journal, files, () => {
      saved.push({ file: held(files.metadata), tabs: structuredClone(journal.fixtureRun?.tabs) });
    });
    const mode = (file: string) => statSync(file).mode & 0o777;
    const unkept =
      "The metadata the store was given for the tabs is not kept as the journal records it: what the server was " +
      "to create from the store is not known here. The way out is to take the environment down, with " +
      "`pnpm demo:down`.";

    try {
      // Nothing is recorded: nothing is read, and no file is asked for.
      expect(record.read()).toBeUndefined();
      // A file an earlier write left under the other name, open to others, is not the one that is kept.
      writeFileSync(`${files.metadata}.next`, "left by a run that was stopped");
      chmodSync(`${files.metadata}.next`, 0o644);
      record.keep(placement);
      // The file is there, whole, when the journal is saved with the state; the journal holds everything of
      // the record but the metadata; and what is read back is what was kept.
      const text = JSON.stringify({
        artifacts: placement.artifacts,
        shape: placement.shape,
        metadata: placement.metadata,
      });

      expect(saved).toEqual([
        { file: text, tabs: { state: "storing", artifacts: placement.artifacts, shape: placement.shape } },
      ]);
      expect(mode(files.metadata)).toBe(0o600);
      expect(readdirSync(directory)).toEqual(["fixture-tab-metadata.json"]);
      expect(record.read()).toEqual(placement);
      // Each state after it is kept the same way, with the way of the store and what was put back. The file
      // takes the place of the one before it, which is not written over where it is: one that cannot be
      // written is replaced all the same, and what replaces it is for its owner alone.
      chmodSync(files.metadata, 0o400);
      record.keep({ ...placement, state: "clearing", way: "data", repaired: ["/synthetic/key"] });
      expect(mode(files.metadata)).toBe(0o600);
      expect(saved[1].tabs).toEqual({
        state: "clearing",
        artifacts: placement.artifacts,
        shape: placement.shape,
        way: "data",
        repaired: ["/synthetic/key"],
      });
      expect(record.read()).toEqual({ ...placement, state: "clearing", way: "data", repaired: ["/synthetic/key"] });
      // A file that was cut, that is of another placement, that holds no metadata, or that is not there, is
      // refused with the way out: what the server was to create is not made up.
      for (const content of [
        text.slice(0, 40),
        JSON.stringify({ shape: "c".repeat(16), metadata: placement.metadata }),
        JSON.stringify({ shape: placement.shape }),
        JSON.stringify({ shape: placement.shape, metadata: { synced: placement.metadata.synced } }),
        JSON.stringify({ shape: placement.shape, metadata: { synced: {}, withoutLog: placement.metadata.withoutLog } }),
        "null",
        undefined,
      ]) {
        if (content === undefined) rmSync(files.metadata);
        else writeFileSync(files.metadata, content);
        expect([content, asked(() => record.read())]).toEqual([content, unkept]);
      }
      // What the tabs are to show is told in a file of the private state, whole and for its owner alone.
      record.keep(placement);
      record.tell({ run: "a1b2c3d4", synthetic: true });
      expect(held(files.facts)).toBe('{\n  "run": "a1b2c3d4",\n  "synthetic": true\n}\n');
      expect(mode(files.facts)).toBe(0o600);
      // The record ends in the journal first, with the file still there, and both files go with it.
      const before = saved.length;

      record.end();
      expect(saved.slice(before)).toEqual([{ file: text, tabs: undefined }]);
      expect(journal.fixtureRun).toEqual({ id: "a1b2c3d4" });
      expect(readdirSync(directory)).toEqual([]);
      expect(record.read()).toBeUndefined();
      // With no record the files of a run before go all the same, and the journal is not saved again.
      record.tell({});
      record.end();
      expect(saved).toHaveLength(before + 1);
      expect(readdirSync(directory)).toEqual([]);
      // Nothing is kept without a run.
      delete journal.fixtureRun;
      expect(asked(() => record.keep(placement))).toBe("No fixture run is recorded");
      expect(readdirSync(directory)).toEqual([]);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("requires distinct identities and limits the Velero identity to its bucket", () => {
    expect(() => storageConfiguration({ accessKey: "", secretKey: "" }, velero)).toThrow();
    expect(() => storageConfiguration(admin, admin)).toThrow();
    expect(storageConfiguration(admin, velero).identities[1].actions).toEqual([
      `Read:${BUCKET}`,
      `Write:${BUCKET}`,
      `List:${BUCKET}`,
      `Tagging:${BUCKET}`,
    ]);
  });

  it("owns every resource and explicitly hardens storage before startup", () => {
    const resources = storageManifests("synthetic-owner", admin, velero);

    expect(resources.every((resource) => resource.metadata.labels?.[OWNER_LABEL] === "synthetic-owner")).toBe(true);
    const deployment = resources.find((resource) => resource.kind === "Deployment");
    const spec = deployment?.spec as {
      template: {
        spec: { automountServiceAccountToken: boolean; containers: { args: string[]; imagePullPolicy: string }[] };
      };
    };

    expect(spec.template.spec.automountServiceAccountToken).toBe(false);
    expect(spec.template.spec.containers[0].imagePullPolicy).toBe("Never");
    expect(spec.template.spec.containers[0].args).toEqual(
      expect.arrayContaining([
        "-master.telemetry=false",
        "-ip.bind=127.0.0.1",
        "-s3.iam=false",
        "-s3.port.iceberg=0",
        "-s3.port.lance=0",
      ]),
    );
    expect(resources.find((resource) => resource.kind === "Service")?.spec).toMatchObject({
      type: "ClusterIP",
      ports: [{ port: 8333 }],
    });
  });
});

describe("official image pins", () => {
  it("accepts official pinned artifacts and rejects every locally derived image", () => {
    expect(() => assertOfficialImages(IMAGES)).not.toThrow();
    for (const name of IMAGE_NAMES) {
      expect(() => assertOfficialImages({ ...IMAGES, [name]: `freelens-velero-lab/${name}:synthetic` })).toThrow(
        "official upstream repository",
      );
      expect(() => assertOfficialImages({ ...IMAGES, [name]: IMAGES[name].split("@")[0] })).toThrow(
        "immutable release pin",
      );
    }
    expect(() => assertOfficialImages({})).toThrow();
    expect(() => assertOfficialImages({ ...IMAGES, other: IMAGES.node })).toThrow();
  });
});

describe("local setup entrypoint refusal", () => {
  const runner = fileURLToPath(new URL("../e2e/scripts/local-demo.mts", import.meta.url));

  it("refuses an action the image helper does not have before external commands", () => {
    const home = mkdtempSync(join(tmpdir(), "velero-images-test-"));

    try {
      const entrypoint = fileURLToPath(new URL("../e2e/scripts/local-images.mts", import.meta.url));
      const result = spawnSync(process.execPath, [entrypoint, "install-scanner"], {
        env: { HOME: home, PATH: "" },
        encoding: "utf8",
        timeout: 10_000,
      });

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("Usage:");
      expect(existsSync(join(home, ".local"))).toBe(false);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it.each([
    { args: ["cluster", "--context", "kind-kind"] },
    { args: ["cluster"] },
    { args: ["delete", "--context", DEMO_CONTEXT] },
  ])("rejects unsafe arguments before creating state: $args", ({ args }) => {
    const home = mkdtempSync(join(tmpdir(), "velero-cli-test-"));

    try {
      const result = spawnSync(process.execPath, [runner, ...args], {
        env: { HOME: home, PATH: "" },
        encoding: "utf8",
        timeout: 10_000,
      });

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("Usage:");
      expect(existsSync(join(home, ".local"))).toBe(false);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  // A home with a journal of an earlier run, a default kubeconfig and a Docker that answers from files.
  function machine(
    shape: NetworkShape,
    docker: { nodes: string[]; networks: string[]; onStop?: (kubeconfig: string) => string },
    recorded: { nodeId?: string; networkId?: string } = {},
  ) {
    const home = mkdtempSync(join(realpathSync(tmpdir()), "velero-cli-test-"));
    const state = join(home, ".local", "state", DEMO_CLUSTER);
    const tools = join(home, "tools");
    const kubeconfig = join(home, ".kube", "config");
    const { identity, network, nodes, config } = fixture(shape);

    for (const directory of [join(state, "bin"), join(tools, "nodes"), join(tools, "networks"), join(home, ".kube")])
      mkdirSync(directory, { recursive: true });
    writeFileSync(kubeconfig, "apiVersion: v1\nkind: Config\n");
    writeFileSync(join(state, "kubeconfig"), JSON.stringify(config));
    for (const name of docker.nodes)
      writeFileSync(join(tools, "nodes", `${name}.json`), JSON.stringify({ ...nodes[0], Id: name }));
    for (const name of docker.networks)
      writeFileSync(
        join(tools, "networks", `${name}.json`),
        JSON.stringify({ ...network, Id: name, Labels: { [OWNER_LABEL]: "00000000-0000-4000-8000-000000000000" } }),
      );
    // It lists, inspects and removes what its two directories hold, and records what it was asked to remove.
    writeFileSync(
      join(tools, "docker"),
      [
        "#!/bin/sh",
        `nodes='${join(tools, "nodes")}'`,
        `networks='${join(tools, "networks")}'`,
        'list() { for file in "$1"/*.json; do [ -e "$file" ] && /usr/bin/basename "$file" .json; done; }',
        'show() { directory="$1"; shift; printf "["; separator=""; for name in "$@"; do printf "%s" "$separator"; /bin/cat "$directory/$name.json"; separator=","; done; printf "]"; }',
        'case "$*" in',
        '  "ps -aq --filter label=io.x-k8s.kind.cluster="*) list "$nodes" ;;',
        '  "network ls "*) list "$networks" ;;',
        '  "network inspect "*) show "$networks" synthetic-network ;;',
        '  "inspect "*) shift; show "$nodes" "$@" ;;',
        `  "stop "*) ${docker.onStop?.(kubeconfig) ?? ":"} ;;`,
        `  "rm --force --volumes "*) echo "$*" >> '${join(tools, "removed")}'; /bin/rm -f "$nodes/$4.json" ;;`,
        `  "network rm "*) echo "$*" >> '${join(tools, "removed")}'; /bin/rm -f "$networks/$3.json" ;;`,
        "esac",
        "exit 0",
        "",
      ].join("\n"),
      { mode: 0o755 },
    );
    writeFileSync(join(state, "bin", "kubectl"), `#!/bin/sh\n/bin/cat '${join(state, "kubeconfig")}'\n`, {
      mode: 0o755,
    });
    writeFileSync(join(state, "bin", "kind"), "#!/bin/sh\nexit 1\n", { mode: 0o755 });
    writeFileSync(
      join(state, "ownership.json"),
      JSON.stringify({
        version: 1,
        owner: "00000000-0000-4000-8000-000000000000",
        nodeId: recorded.nodeId ?? identity.nodeId,
        networkId: recorded.networkId ?? identity.networkId,
        kubeconfigHash: createHash("sha256")
          .update(readFileSync(join(state, "kubeconfig")))
          .digest("hex"),
        shape,
        // What a journal of the foundation stored once, from a file the user has changed since.
        defaultKubeconfigHash: "0".repeat(64),
        resources: [],
        phase: "verified",
      }),
    );
    const run = (action: string) =>
      spawnSync(process.execPath, [runner, action, "--context", DEMO_CONTEXT], {
        env: { HOME: home, PATH: tools },
        encoding: "utf8",
        timeout: 20_000,
      });
    const removed = () => (existsSync(join(tools, "removed")) ? readFileSync(join(tools, "removed"), "utf8") : "");

    return { home, state, kubeconfig, run, removed };
  }

  it.each(SHAPES)(
    "compares the default kubeconfig within one run only, on the %s shape",
    (shape) => {
      const { home, state, kubeconfig, run } = machine(shape, {
        nodes: ["synthetic-node"],
        networks: ["synthetic-network"],
      });

      try {
        const first = run("stop");

        expect(first.stderr).not.toContain("changed");
        expect(first.stdout).toContain("PASS: stopped only the owned demo node");
        expect(first.status).toBe(0);
        // Between two runs the file is of the user, who may change it.
        writeFileSync(kubeconfig, "apiVersion: v1\nkind: Config\ncurrent-context: another\n");
        const second = run("stop");

        expect(second.stdout).toContain("PASS: stopped only the owned demo node");
        expect(second.status).toBe(0);
        expect(readFileSync(kubeconfig, "utf8")).toBe("apiVersion: v1\nkind: Config\ncurrent-context: another\n");
        expect(JSON.parse(readFileSync(join(state, "ownership.json"), "utf8")).phase).toBe("stopped");
        expect(existsSync(join(state, "run.lock"))).toBe(false);
      } finally {
        rmSync(home, { recursive: true, force: true });
      }
    },
    60_000,
  );

  it("stops when the default kubeconfig changes during a run", () => {
    const { home, run } = machine("loopback", {
      nodes: ["synthetic-node"],
      networks: ["synthetic-network"],
      // A command of the environment that writes where none of them may.
      onStop: (kubeconfig) => `echo '# changed' >> '${kubeconfig}'`,
    });

    try {
      const result = run("stop");

      expect(result.stderr).toContain("The default kubeconfig changed during this run");
      expect(result.status).toBe(1);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  }, 60_000);

  it.each(SHAPES)(
    "takes down by identifier what the journal owns, on the %s shape",
    (shape) => {
      const { home, state, kubeconfig, run, removed } = machine(shape, {
        nodes: ["synthetic-node"],
        networks: ["synthetic-network"],
      });

      try {
        writeFileSync(join(state, "pins.json"), "[]");
        writeFileSync(join(state, "credentials.json"), "{}");
        const result = run("down");

        expect(result.stdout).toContain("PASS: removed the owned node, network and private state");
        expect(result.status).toBe(0);
        expect(removed()).toBe("rm --force --volumes synthetic-node\nnetwork rm synthetic-network\n");
        // The tools and the pins that were read stay: neither is of one environment.
        expect(readdirNames(state)).toEqual(["bin", "pins.json"]);
        expect(readFileSync(kubeconfig, "utf8")).toBe("apiVersion: v1\nkind: Config\n");
      } finally {
        rmSync(home, { recursive: true, force: true });
      }
    },
    60_000,
  );

  it("finishes a removal that an earlier run left halfway", () => {
    // Docker has neither the node nor the network the journal names.
    const { home, state, run, removed } = machine("loopback", { nodes: [], networks: [] });

    try {
      const result = run("down");

      expect(result.stdout).toContain("PASS: removed the owned node, network and private state");
      expect(result.status).toBe(0);
      expect(removed()).toBe("");
      expect(readdirNames(state)).toEqual(["bin"]);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  }, 60_000);

  it.each([
    {
      name: "a node with the name of the cluster",
      docker: { nodes: ["another-node"], networks: ["synthetic-network"] },
      reason: "A node exists that the journal does not own",
    },
    {
      name: "a second node beside the owned one",
      docker: { nodes: ["synthetic-node", "another-node"], networks: ["synthetic-network"] },
      reason: "A node exists that the journal does not own",
    },
    {
      name: "a network with the name of the environment",
      docker: { nodes: [], networks: ["another-network"] },
      reason: "A network exists that the journal does not own",
    },
    {
      name: "a node while the journal names none",
      docker: { nodes: ["another-node"], networks: ["synthetic-network"] },
      recorded: { nodeId: "" },
      reason: "A node exists that the journal does not own",
    },
    {
      name: "a network while the journal names none",
      docker: { nodes: [], networks: ["another-network"] },
      recorded: { nodeId: "", networkId: "" },
      reason: "A network exists that the journal does not own",
    },
  ])(
    "removes nothing when Docker has $name that the journal does not own",
    ({ docker, recorded, reason }) => {
      const { home, state, run, removed } = machine("internal", docker, recorded);

      try {
        const result = run("down");

        expect(result.stderr).toContain(reason);
        expect(result.status).toBe(1);
        expect(removed()).toBe("");
        expect(existsSync(join(state, "ownership.json"))).toBe(true);
        expect(existsSync(join(state, "run.lock"))).toBe(false);
      } finally {
        rmSync(home, { recursive: true, force: true });
      }
    },
    60_000,
  );

  it("cleans nothing when no fixture run is recorded, and says so before it asks anything of the environment", () => {
    const { home, state, run, removed } = machine("loopback", {
      nodes: ["synthetic-node"],
      networks: ["synthetic-network"],
    });
    const journal = join(state, "ownership.json");
    const before = readFileSync(journal, "utf8");

    try {
      const result = run("fixtures-cleanup");

      expect(result.stderr).toContain("No fixture run is recorded");
      expect(result.status).toBe(1);
      expect(readFileSync(journal, "utf8")).toBe(before);
      expect(removed()).toBe("");
      expect(existsSync(join(state, "run.lock"))).toBe(false);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  }, 60_000);

  it("releases its lock when initialization rejects a malformed journal", () => {
    // The temporary directory can sit behind a symlink, which the runner refuses for its state.
    const home = mkdtempSync(join(realpathSync(tmpdir()), "velero-cli-test-"));
    const state = join(home, ".local", "state", DEMO_CLUSTER);

    try {
      mkdirSync(state, { recursive: true });
      writeFileSync(join(state, "ownership.json"), JSON.stringify({ version: 0 }));
      const result = spawnSync(process.execPath, [runner, "cluster", "--context", DEMO_CONTEXT], {
        env: { HOME: home, PATH: "" },
        encoding: "utf8",
        timeout: 10_000,
      });

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("Invalid ownership journal");
      expect(existsSync(join(state, "run.lock"))).toBe(false);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
