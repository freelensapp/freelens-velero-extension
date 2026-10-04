import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  allowsFixtureArtifact,
  assertFixtureNamespaceContents,
  BACKUP_PHASES,
  createViewFixtures,
  FIXTURE_LABEL,
  FIXTURE_MODE,
  fixtureArtifactPaths,
  fixtureDeletionRequest,
  fixtureNames,
  fixtureNamespaces,
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
  RESTORE_PHASES,
  readerKubeconfig,
  restoreSpec,
  restrictedFixtures,
  SCALE_BACKUPS,
  SCALE_RESTORES,
  SHAPE_ANNOTATION,
  scaleFixtures,
  staticFixtures,
  syntheticStatus,
  UNAVAILABLE_MESSAGE,
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
import { assertOfficialImages, IMAGE_NAMES } from "../e2e/scripts/local-security.mts";

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
    const removed: string[] = [];
    // What was removed is listed for some reads more: the server removes an object after it said it would.
    const leaving: string[] = [];
    const paused: number[] = [];
    // The commands the cluster was asked, by their first words.
    const asked: string[] = [];
    let linger = 0;
    const key = (kind: string, namespace: unknown, name: unknown) =>
      `${kind.split(".")[0].toLowerCase().replace(/s$/, "")}/${String(namespace ?? "")}/${String(name)}`;
    const create = (resource: { kind: string; metadata: Record<string, unknown> }) => {
      const namespace = resource.metadata.namespace;

      if (namespace !== undefined && !objects.has(key("Namespace", undefined, namespace))) {
        throw new Error(`namespaces "${String(namespace)}" not found`);
      }
      created += 1;
      order.push(key(resource.kind, namespace, resource.metadata.name));
      objects.set(key(resource.kind, namespace, resource.metadata.name), {
        ...structuredClone(resource),
        metadata: {
          ...structuredClone(resource.metadata),
          uid: `uid-${created}`,
          resourceVersion: "1",
          // Each object at its own second, as the ones of a run are.
          creationTimestamp: new Date(from + created * 1000).toISOString().replace(".000Z", "Z"),
        },
      });
    };
    const flag = (args: string[], name: string) => args[args.indexOf(name) + 1];

    return {
      objects,
      order,
      changes: () => changes,
      removed,
      paused,
      asked,
      linger: (reads: number) => {
        linger = reads;
      },
      find: (kind: string, namespace: string | undefined, name: string) => objects.get(key(kind, namespace, name)),
      runtime: {
        owner,
        pause(milliseconds: number) {
          paused.push(milliseconds);
        },
        apply(resource: { kind: string; metadata: Record<string, unknown> }) {
          const found = objects.get(key(resource.kind, resource.metadata.namespace, resource.metadata.name));

          if (!found) return create(resource);
          const { status: _status, ...asked } = structuredClone(resource) as Record<string, unknown>;
          const next = { ...found, ...asked, metadata: { ...found.metadata, ...resource.metadata } };

          if (JSON.stringify(next) === JSON.stringify(found)) return;
          changes += 1;
          objects.set(key(resource.kind, resource.metadata.namespace, resource.metadata.name), next);
        },
        kubectl(args: string[], input?: string) {
          const namespace = args.includes("--namespace") ? flag(args, "--namespace") || undefined : undefined;

          asked.push(args[0]);
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
          // The objects of one or more kinds in a namespace, which a selector may choose among.
          const of = (kinds: string) => {
            const prefixes = kinds.split(",").map((kind) => key(kind, namespace, ""));

            return [...objects.entries()].filter(([name]) => prefixes.some((prefix) => name.startsWith(prefix)));
          };

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

            if (!found) throw new Error(`${args[1]} "${args[2]}" not found`);
            return JSON.stringify(found);
          }
          return JSON.stringify({ items: of(args[1]).map(([, found]) => found) });
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
      // What is placed by the clock was not there: it was put in place, and nothing was removed.
      again: [names.overview, names.scale],
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
    expect(() => assertFixtureNamespaceContents("synthetic-owner", run, "velero-demo", [resource])).toThrow();
    expect(() =>
      assertFixtureNamespaceContents("synthetic-owner", run, namespace, [
        { ...resource, metadata: { ...resource.metadata, labels: {} } },
      ]),
    ).toThrow();
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
