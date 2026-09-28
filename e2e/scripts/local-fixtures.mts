import { createHash, randomBytes } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { isDeepStrictEqual } from "node:util";
import { DEMO_NAMESPACE, type KindConfig, OWNER_LABEL, requireCondition } from "./local-kind.mts";
import { BUCKET, type KubeResource, STORAGE_ENDPOINT } from "./local-manifests.mts";

export const FIXTURE_LABEL = "freelensapp.io/velero-fixture-run";
export const FIXTURE_MODE = "freelensapp.io/velero-fixture-mode";
export const BACKUP_PHASES = [
  "New",
  "Queued",
  "ReadyToStart",
  "FailedValidation",
  "InProgress",
  "WaitingForPluginOperations",
  "WaitingForPluginOperationsPartiallyFailed",
  "Finalizing",
  "FinalizingPartiallyFailed",
  "Completed",
  "PartiallyFailed",
  "Failed",
  "Deleting",
] as const;
export const RESTORE_PHASES = [
  "New",
  "FailedValidation",
  "InProgress",
  "WaitingForPluginOperations",
  "WaitingForPluginOperationsPartiallyFailed",
  "Finalizing",
  "FinalizingPartiallyFailed",
  "Completed",
  "PartiallyFailed",
  "Failed",
] as const;

// The identities the views are read with when access is restricted, and how long the long lists are. The
// first reader reads the backups and not the restores; the second one the restores and not the backups.
export const VIEW_READER = "views-reader";
export const VIEW_READER_OF_RESTORES = "views-reader-of-restores";
export const SCALE_BACKUPS = 1000;
export const SCALE_RESTORES = 1000;

export function fixtureNames(run: string) {
  requireCondition(/^[a-f0-9]{8}$/.test(run), "A generated local fixture run ID is required");
  return {
    source: `velero-source-${run}`,
    restored: `velero-restored-${run}`,
    static: `velero-static-${run}`,
    views: `velero-views-${run}`,
    scale: `velero-scale-${run}`,
    backup: `fixture-backup-${run}`,
    restore: `fixture-restore-${run}`,
  };
}

export function fixtureNamespaces(run: string): string[] {
  const names = fixtureNames(run);

  return [names.source, names.restored, names.static, names.views, names.scale];
}

export function fixtureArtifactPaths(run: string) {
  const names = fixtureNames(run);
  const backup = `/${BUCKET}/backups/${names.backup}/${names.backup}`;
  const restore = `/${BUCKET}/restores/${names.restore}/restore-${names.restore}`;

  return {
    archive: `${backup}.tar.gz`,
    backupLog: `${backup}-logs.gz`,
    backupResults: `${backup}-results.gz`,
    restoreLog: `${restore}-logs.gz`,
    restoreResults: `${restore}-results.gz`,
  };
}

export function allowsFixtureArtifact(method: string, path: string, run: string): boolean {
  const paths = fixtureArtifactPaths(run);

  return Object.values(paths).includes(path) && (method === "HEAD" || (method === "GET" && path !== paths.archive));
}

export function assertFixtureNamespaceContents(
  owner: string,
  run: string,
  namespace: string,
  resources: KubeResource[],
): void {
  requireCondition(fixtureNamespaces(run).includes(namespace), "Refusing cleanup outside this fixture run");
  for (const resource of resources) {
    requireCondition(resource.metadata.namespace === namespace, "Cleanup inventory contains another namespace");
    const systemDefault =
      (resource.kind === "ConfigMap" && resource.metadata.name === "kube-root-ca.crt") ||
      (resource.kind === "ServiceAccount" && resource.metadata.name === "default");

    requireCondition(
      systemDefault ||
        (resource.metadata.labels?.[OWNER_LABEL] === owner && resource.metadata.labels?.[FIXTURE_LABEL] === run),
      "Fixture namespace contains an unrelated resource; cleanup refused",
    );
  }
}

export function fixtureDeletionRequest(owner: string, run: string, backupUid: string): KubeResource {
  const names = fixtureNames(run);

  requireCondition(owner && backupUid, "Bound backup ownership is required for deletion");
  return {
    apiVersion: "velero.io/v1",
    kind: "DeleteBackupRequest",
    metadata: {
      name: `${names.backup}-delete`,
      namespace: DEMO_NAMESPACE,
      labels: {
        [OWNER_LABEL]: owner,
        [FIXTURE_LABEL]: run,
        [FIXTURE_MODE]: "live",
        "velero.io/backup-name": names.backup,
        "velero.io/backup-uid": backupUid,
      },
    },
    spec: { backupName: names.backup },
  };
}

export function restrictedFixtures(owner: string, run: string): KubeResource[] {
  const names = fixtureNames(run);
  const metadata = (name: string) => ({
    name,
    namespace: names.static,
    labels: { [OWNER_LABEL]: owner, [FIXTURE_LABEL]: run, [FIXTURE_MODE]: "synthetic" },
  });
  const missingLocation = staticFixtures(owner, run).find(
    (resource) => resource.kind === "Backup" && resource.metadata.name === "backup-failedvalidation",
  );

  requireCondition(missingLocation, "The validation fixture is missing");
  missingLocation.metadata = metadata("backup-missing-location");
  missingLocation.spec = {
    ...(missingLocation.spec as Record<string, unknown>),
    storageLocation: "fixture-missing-location",
  };
  return [
    missingLocation,
    {
      apiVersion: "v1",
      kind: "ServiceAccount",
      metadata: metadata("fixture-reader"),
      automountServiceAccountToken: false,
    },
    {
      apiVersion: "rbac.authorization.k8s.io/v1",
      kind: "Role",
      metadata: metadata("fixture-reader"),
      rules: [
        {
          apiGroups: ["velero.io"],
          resources: ["backups", "restores", "schedules", "backupstoragelocations"],
          verbs: ["get", "list", "watch"],
        },
      ],
    },
    {
      apiVersion: "rbac.authorization.k8s.io/v1",
      kind: "RoleBinding",
      metadata: metadata("fixture-reader"),
      roleRef: { apiGroup: "rbac.authorization.k8s.io", kind: "Role", name: "fixture-reader" },
      subjects: [{ kind: "ServiceAccount", name: "fixture-reader", namespace: names.static }],
    },
    {
      apiVersion: "v1",
      kind: "Secret",
      metadata: metadata("fixture-certificate"),
      type: "Opaque",
      stringData: { "ca.crt": "Synthetic certificate-access fixture; not a real certificate" },
    },
  ];
}

// The phases an operation has with the time it ended: the ones the release ends it in, and the one of a
// backup that ended and is being deleted.
const ENDED = new Set(["Completed", "PartiallyFailed", "Failed", "Deleting"]);
// The phases of an operation that did not start. The release writes the start time when the validation
// passes and the operation begins: one that waits, or that failed its validation, has no start time, no
// end time, no progress and no counters.
export const NOT_STARTED = new Set(["New", "Queued", "ReadyToStart", "FailedValidation"]);
// The phases of an operation that is at work, or that was when the release failed it: not every item is
// done, and nothing was counted.
export const NOT_COUNTED = new Set(["InProgress", "Failed"]);

// The phases the release gives to an operation that waits for the operations its plugins started on its
// items: it has one such operation at least.
const WAITING = new Set(["WaitingForPluginOperations", "WaitingForPluginOperationsPartiallyFailed"]);

// The status of a synthetic operation in a phase: what the controller would have written, and did not.
// The release writes no counter of zero, counts the errors and the warnings when the work ends, and leaves
// the work with every item done. The failed operation is one it stopped at work, with its reason. The
// hooks are counted at the end of the work of a backup, and when a restore is finalized: their status is
// in the object from then on, empty when none was run.
// How long the backup the controller runs is kept: the retention the release gives when none is asked.
export const LIVE_RETENTION = "720h0m0s";

// The newest backup of the schedule with a history, which the schedule has its last submission from.
export const NEWEST_OF_THE_HISTORY = "views-history-0";

export function syntheticStatus(
  phase: string,
  progressField: "itemsBackedUp" | "itemsRestored",
  started = Date.parse("2026-09-01T10:00:00Z"),
): Record<string, unknown> {
  const time = (offset: number) => new Date(started + offset).toISOString().replace(".000Z", "Z");
  const backup = progressField === "itemsBackedUp";
  const hooked = backup ? !NOT_COUNTED.has(phase) : phase === "Completed" || phase === "PartiallyFailed";

  if (NOT_STARTED.has(phase)) {
    return {
      phase,
      ...(phase === "FailedValidation"
        ? { validationErrors: ["Synthetic validation error; no operation was executed"] }
        : {}),
    };
  }
  const errors = phase.includes("PartiallyFailed") ? 1 : 0;
  const warnings = phase === "PartiallyFailed" ? 1 : 0;

  return {
    phase,
    startTimestamp: time(0),
    progress: { totalItems: 10, [progressField]: NOT_COUNTED.has(phase) ? 4 : 10 },
    ...(errors ? { errors } : {}),
    ...(warnings ? { warnings } : {}),
    ...(WAITING.has(phase) ? { [backup ? "backupItemOperationsAttempted" : "restoreItemOperationsAttempted"]: 1 } : {}),
    ...(hooked ? { hookStatus: {} } : {}),
    ...(phase === "Failed" ? { failureReason: "Synthetic failure reason; no operation was executed" } : {}),
    ...(ENDED.has(phase) ? { completionTimestamp: time(60_000) } : {}),
  };
}

// What Velero adds to the excluded resources of every restore it takes.
const EXCLUDED_BY_VELERO = [
  "nodes",
  "events",
  "events.events.k8s.io",
  "backups.velero.io",
  "restores.velero.io",
  "resticrepositories.velero.io",
  "csinodes.storage.k8s.io",
  "volumeattachments.storage.k8s.io",
  "backuprepositories.velero.io",
];

// The spec of a restore as the release keeps it. It completes a restore when it takes it, whether it then
// refuses it or not: the resources it never restores go after the ones that were excluded, and the timeout
// of the item operations is filled. A restore in the phase New was not taken, and is as it was submitted.
// The schedule of the backup is written beside the backup once the backup was found and can be used: a
// restore that failed its validation carries it or not by what it was refused for, and the synthetic ones
// do not.
export function restoreSpec(
  phase: string,
  submitted: Record<string, unknown>,
  schedule?: string,
): Record<string, unknown> {
  if (phase === "New") return submitted;
  const excluded = Array.isArray(submitted.excludedResources) ? (submitted.excludedResources as string[]) : [];

  return {
    ...submitted,
    ...(schedule && phase !== "FailedValidation" ? { scheduleName: schedule } : {}),
    excludedResources: [...excluded, ...EXCLUDED_BY_VELERO.filter((name) => !excluded.includes(name))],
    itemOperationTimeout: "4h0m0s",
  };
}

// A name as long as Velero accepts one: it is the value of a label, which has 63 characters at most.
export const LONG_BACKUP_NAME = "backup-with-a-name-as-long-as-the-value-of-a-label-is-allowed-1";
// A restore with a name as long as the longest name of a backup.
export const LONG_RESTORE_NAME = "restore-with-a-name-as-long-as-the-name-of-a-restore-can-be-one";
// Namespaces with names as long as a namespace can have one, for a mapping that fills its table.
export const LONG_NAMESPACE = "namespace-with-a-name-as-long-as-the-name-of-a-namespace-can-b";

// What the views need beside the phases: an installation with references that lead somewhere and references
// that do not, a name that fills its column, an object that reports nothing, and an identity that reads a
// part of it. Its namespace is outside the reach of the controllers, like the one of the phases.
// The history of a schedule is placed in time from when the fixtures were started: what a view shows of the
// last days holds something whenever the suites run.
// `submitted` is when the newest backup of the schedule with a history was created, which is known once it
// is there: the release writes the time of a submission into the schedule when it creates the backup.
export function viewFixtures(
  owner: string,
  run: string,
  started = Date.parse("2026-09-01T00:00:00Z"),
  submitted = started,
): KubeResource[] {
  requireCondition(owner, "Fixture ownership is required");
  requireCondition(Number.isFinite(started), "The time the fixtures were started is required");
  requireCondition(Number.isFinite(submitted), "The time of the last submission is required");
  const names = fixtureNames(run);
  const HOUR = 3_600_000;
  const day = (before: number, hours = 0) => Math.floor(started / HOUR) * HOUR - before * 24 * HOUR + hours * HOUR;
  const labels = { [OWNER_LABEL]: owner, [FIXTURE_LABEL]: run, [FIXTURE_MODE]: "synthetic" };
  const metadata = (name: string, more: Record<string, string> = {}) => ({
    name,
    namespace: names.views,
    labels: { ...labels, ...more },
  });
  const spec = {
    includedNamespaces: [names.source],
    includeClusterResources: false,
    storageLocation: "views-available",
    volumeSnapshotLocations: ["views-snapshots"],
    snapshotVolumes: false,
    ttl: "720h0m0s",
  };
  const backup = (
    name: string,
    phase: string | undefined,
    more: { labels?: Record<string, string>; spec?: Record<string, unknown>; status?: Record<string, unknown> } = {},
  ): KubeResource => ({
    apiVersion: "velero.io/v1",
    kind: "Backup",
    metadata: metadata(name, more.labels),
    spec: { ...spec, ...more.spec },
    ...(phase ? { status: { ...syntheticStatus(phase, "itemsBackedUp"), ...more.status } } : {}),
  });

  return [
    { apiVersion: "v1", kind: "Namespace", metadata: { name: names.views, labels } },
    {
      apiVersion: "velero.io/v1",
      kind: "BackupStorageLocation",
      metadata: metadata("views-available"),
      spec: {
        provider: "aws",
        objectStorage: { bucket: BUCKET },
        config: { region: "us-east-1", s3ForcePathStyle: "true", s3Url: STORAGE_ENDPOINT },
        accessMode: "ReadWrite",
        default: true,
      },
      status: { phase: "Available" },
    },
    // A location that is there and takes no backup: what a template that names it is told.
    {
      apiVersion: "velero.io/v1",
      kind: "BackupStorageLocation",
      metadata: metadata("views-archive"),
      spec: {
        provider: "aws",
        objectStorage: { bucket: BUCKET, prefix: "archive" },
        config: { region: "us-east-1", s3ForcePathStyle: "true", s3Url: STORAGE_ENDPOINT },
        accessMode: "ReadOnly",
      },
      status: { phase: "Available" },
    },
    {
      apiVersion: "velero.io/v1",
      kind: "VolumeSnapshotLocation",
      metadata: metadata("views-snapshots"),
      spec: { provider: "aws", config: { region: "us-east-1" } },
      status: { phase: "Available" },
    },
    {
      apiVersion: "velero.io/v1",
      kind: "Schedule",
      metadata: metadata("views-daily"),
      spec: { schedule: "0 3 * * *", paused: false, skipImmediately: false, template: spec },
      status: { phase: "Enabled" },
    },
    backup("views-daily-20260901030000", "Completed", {
      labels: { "velero.io/schedule-name": "views-daily" },
      status: { warnings: 2 },
    }),
    // A schedule with a history: a backup a day, two of them an hour from each other, how each one ended,
    // and the newest one that failed its validation, which has no start time. Its last submission is the
    // time that backup was created.
    {
      apiVersion: "velero.io/v1",
      kind: "Schedule",
      metadata: metadata("views-history"),
      spec: {
        schedule: "0 1 * * *",
        paused: false,
        skipImmediately: false,
        template: spec,
        useOwnerReferencesInBackup: false,
      },
      status: {
        phase: "Enabled",
        lastBackup: new Date(Math.floor(submitted / 1000) * 1000).toISOString().replace(".000Z", "Z"),
      },
    },
    ...(
      [
        ["views-history-6", "Completed", day(6)],
        ["views-history-5", "Completed", day(5)],
        ["views-history-4", "PartiallyFailed", day(4)],
        ["views-history-3", "Completed", day(3)],
        ["views-history-3-again", "Failed", day(3, 1)],
        ["views-history-2", "Completed", day(2)],
        ["views-history-1", "Completed", day(1)],
        ["views-history-0", "FailedValidation", 0],
      ] as const
    ).map(([name, phase, start]) => ({
      apiVersion: "velero.io/v1",
      kind: "Backup",
      metadata: metadata(name, { "velero.io/schedule-name": "views-history" }),
      spec,
      status: syntheticStatus(phase, "itemsBackedUp", start),
    })),
    // What Velero has not read: a schedule that reports nothing and one that was created paused. The
    // release writes `skipImmediately` into every schedule it reads, and these have none. The phase New is
    // of the API: the release writes Enabled or FailedValidation, and a view is given New all the same.
    // The last one was read, then paused and asked to skip the run that is due when it is resumed.
    {
      apiVersion: "velero.io/v1",
      kind: "Schedule",
      metadata: metadata("schedule-new"),
      spec: { schedule: "0 0 1 1 *", paused: false, template: spec },
      status: { phase: "New" },
    },
    {
      apiVersion: "velero.io/v1",
      kind: "Schedule",
      metadata: metadata("schedule-unread"),
      spec: { schedule: "0 0 1 1 *", paused: false, template: spec },
    },
    {
      apiVersion: "velero.io/v1",
      kind: "Schedule",
      metadata: metadata("schedule-unread-paused"),
      spec: { schedule: "0 0 1 1 *", paused: true, template: spec },
    },
    {
      apiVersion: "velero.io/v1",
      kind: "Schedule",
      metadata: metadata("schedule-skipping"),
      spec: { schedule: "0 0 1 1 *", paused: true, skipImmediately: true, template: spec },
      status: { phase: "Enabled", lastBackup: "2026-08-01T00:00:00Z", lastSkipped: "2026-08-15T09:30:00Z" },
    },
    // An expression that names its time zone, and schedules whose backups go where no backup is taken.
    {
      apiVersion: "velero.io/v1",
      kind: "Schedule",
      metadata: metadata("views-zoned"),
      spec: { schedule: "CRON_TZ=Europe/Rome 30 2 * * *", paused: false, skipImmediately: false, template: spec },
      status: { phase: "Enabled" },
    },
    {
      apiVersion: "velero.io/v1",
      kind: "Schedule",
      metadata: metadata("views-to-removed"),
      spec: {
        schedule: "0 5 * * *",
        paused: false,
        skipImmediately: false,
        template: { ...spec, storageLocation: "views-removed" },
      },
      status: { phase: "Enabled" },
    },
    {
      apiVersion: "velero.io/v1",
      kind: "Schedule",
      metadata: metadata("views-to-archive"),
      spec: {
        schedule: "0 6 * * *",
        paused: false,
        skipImmediately: false,
        template: { ...spec, storageLocation: "views-archive" },
      },
      status: { phase: "Enabled" },
    },
    {
      apiVersion: "velero.io/v1",
      kind: "Schedule",
      metadata: metadata("views-to-default"),
      spec: {
        schedule: "0 7 * * *",
        paused: false,
        skipImmediately: false,
        template: { includedNamespaces: [names.source], includeClusterResources: false, ttl: "720h0m0s" },
      },
      status: { phase: "Enabled" },
    },
    backup("backup-missing-schedule", "Completed", { labels: { "velero.io/schedule-name": "views-removed" } }),
    backup("backup-missing-location", "FailedValidation", {
      spec: { storageLocation: "views-removed", volumeSnapshotLocations: ["views-removed"] },
    }),
    backup(LONG_BACKUP_NAME, "InProgress"),
    // The name of a backup of the namespace of the phases, for another backup: a name is of its installation.
    backup("backup-inprogress", "InProgress", { status: { progress: { totalItems: 10, itemsBackedUp: 7 } } }),
    backup("backup-unreported", undefined),
    // The restore that failed in part ran two hooks, of which one failed: it was finalized, which is when
    // the release counts them.
    ...["Completed", "PartiallyFailed"].map((phase) => ({
      apiVersion: "velero.io/v1",
      kind: "Restore",
      metadata: metadata(`restore-of-daily-${phase.toLowerCase()}`),
      spec: restoreSpec(
        phase,
        {
          backupName: "views-daily-20260901030000",
          includedNamespaces: [names.source],
          namespaceMapping: { [names.source]: names.restored },
          includeClusterResources: false,
          restorePVs: false,
          existingResourcePolicy: "none",
        },
        "views-daily",
      ),
      status: {
        ...syntheticStatus(phase, "itemsRestored"),
        ...(phase === "PartiallyFailed" ? { hookStatus: { hooksAttempted: 2, hooksFailed: 1 } } : {}),
      },
    })),
    // A restore as Velero keeps it: into two namespaces, with the schedule of its backup written beside the
    // backup, the resources Velero excludes and the timeout it fills. It waits for an operation of a plugin.
    {
      apiVersion: "velero.io/v1",
      kind: "Restore",
      metadata: metadata("restore-mapped"),
      spec: restoreSpec(
        "WaitingForPluginOperationsPartiallyFailed",
        {
          backupName: "views-daily-20260901030000",
          includedNamespaces: [names.source, `${names.source}-second`],
          excludedResources: ["secrets"],
          namespaceMapping: {
            [names.source]: names.restored,
            [`${names.source}-second`]: `${names.restored}-second`,
          },
          includeClusterResources: false,
          restorePVs: false,
          existingResourcePolicy: "update",
        },
        "views-daily",
      ),
      status: syntheticStatus("WaitingForPluginOperationsPartiallyFailed", "itemsRestored"),
    },
    // A restore asked from a schedule that has no backup: it failed its validation, and names no backup.
    {
      apiVersion: "velero.io/v1",
      kind: "Restore",
      metadata: metadata("restore-of-schedule"),
      spec: restoreSpec("FailedValidation", { scheduleName: "views-removed" }),
      status: {
        phase: "FailedValidation",
        validationErrors: ["No backups found for schedule", "No completed backups found for schedule"],
      },
    },
    // A restore of a backup that is not there any more.
    {
      apiVersion: "velero.io/v1",
      kind: "Restore",
      metadata: metadata("restore-of-removed"),
      spec: restoreSpec("Completed", { backupName: "views-removed" }),
      status: syntheticStatus("Completed", "itemsRestored"),
    },
    // A restore with names as long as they can be: its own, the one of its backup, and the ones of the
    // namespaces it maps.
    {
      apiVersion: "velero.io/v1",
      kind: "Restore",
      metadata: metadata(LONG_RESTORE_NAME),
      spec: restoreSpec("InProgress", {
        backupName: LONG_BACKUP_NAME,
        includedNamespaces: [`${LONG_NAMESPACE}1`],
        namespaceMapping: { [`${LONG_NAMESPACE}1`]: `${LONG_NAMESPACE}2` },
      }),
      status: syntheticStatus("InProgress", "itemsRestored"),
    },
    ...reader(VIEW_READER, names.views, labels, ["backups", "schedules", "backupstoragelocations"]),
    ...reader(VIEW_READER_OF_RESTORES, names.views, labels, [
      "restores",
      "schedules",
      "backupstoragelocations",
      "volumesnapshotlocations",
    ]),
  ];
}

// An identity that reads some kinds of Velero in one namespace, and nothing else: what it is denied is what
// the views show of a family that cannot be read.
function reader(name: string, namespace: string, labels: Record<string, string>, resources: string[]): KubeResource[] {
  const metadata = { name, namespace, labels };

  return [
    { apiVersion: "v1", kind: "ServiceAccount", metadata, automountServiceAccountToken: false },
    {
      apiVersion: "rbac.authorization.k8s.io/v1",
      kind: "Role",
      metadata,
      rules: [{ apiGroups: ["velero.io"], resources, verbs: ["get", "list", "watch"] }],
    },
    {
      apiVersion: "rbac.authorization.k8s.io/v1",
      kind: "RoleBinding",
      metadata,
      roleRef: { apiGroup: "rbac.authorization.k8s.io", kind: "Role", name },
      subjects: [{ kind: "ServiceAccount", name, namespace }],
    },
  ];
}

// The long lists: a namespace with no storage location, which no discovery suggests, a thousand backups and
// a thousand restores in every phase. Each list is created in one request of the client, and they are
// deleted with their namespace.
export function scaleFixtures(
  owner: string,
  run: string,
): { namespace: KubeResource; backups: KubeResource[]; restores: KubeResource[] } {
  requireCondition(owner, "Fixture ownership is required");
  const names = fixtureNames(run);
  const labels = { [OWNER_LABEL]: owner, [FIXTURE_LABEL]: run, [FIXTURE_MODE]: "synthetic" };
  const first = Date.parse("2026-08-01T00:00:00Z");

  return {
    namespace: { apiVersion: "v1", kind: "Namespace", metadata: { name: names.scale, labels } },
    backups: Array.from({ length: SCALE_BACKUPS }, (_, index) => ({
      apiVersion: "velero.io/v1",
      kind: "Backup",
      metadata: { name: `backup-${String(index + 1).padStart(4, "0")}`, namespace: names.scale, labels },
      spec: {
        includedNamespaces: [names.source],
        includeClusterResources: false,
        storageLocation: `scale-location-${(index % 3) + 1}`,
        snapshotVolumes: false,
        ttl: "720h0m0s",
      },
      status: syntheticStatus(BACKUP_PHASES[index % BACKUP_PHASES.length], "itemsBackedUp", first + index * 3_600_000),
    })),
    restores: Array.from({ length: SCALE_RESTORES }, (_, index) => ({
      apiVersion: "velero.io/v1",
      kind: "Restore",
      metadata: { name: `restore-${String(index + 1).padStart(4, "0")}`, namespace: names.scale, labels },
      spec: restoreSpec(RESTORE_PHASES[index % RESTORE_PHASES.length], {
        backupName: `backup-${String((index % SCALE_BACKUPS) + 1).padStart(4, "0")}`,
        includedNamespaces: [names.source],
        namespaceMapping: { [names.source]: names.restored },
        includeClusterResources: false,
        restorePVs: false,
        existingResourcePolicy: "none",
      }),
      status: syntheticStatus(
        RESTORE_PHASES[index % RESTORE_PHASES.length],
        "itemsRestored",
        first + index * 3_600_000 + 1_800_000,
      ),
    })),
  };
}

export function staticFixtures(owner: string, run: string): KubeResource[] {
  requireCondition(owner, "Fixture ownership is required");
  const names = fixtureNames(run);
  const labels = { [OWNER_LABEL]: owner, [FIXTURE_LABEL]: run, [FIXTURE_MODE]: "synthetic" };
  const metadata = (name: string) => ({ name, namespace: names.static, labels });
  const status = syntheticStatus;
  const backupSpec = {
    includedNamespaces: [names.source],
    includeClusterResources: false,
    storageLocation: "fixture-unavailable",
    snapshotVolumes: false,
    ttl: "1h0m0s",
  };
  const locationSpec = {
    provider: "aws",
    objectStorage: { bucket: BUCKET },
    config: { region: "us-east-1", s3ForcePathStyle: "true", s3Url: STORAGE_ENDPOINT },
  };

  return [
    { apiVersion: "v1", kind: "Namespace", metadata: { name: names.static, labels } },
    ...BACKUP_PHASES.map((phase) => ({
      apiVersion: "velero.io/v1",
      kind: "Backup",
      metadata: metadata(`backup-${phase.toLowerCase()}`),
      spec: backupSpec,
      status: status(phase, "itemsBackedUp"),
    })),
    ...RESTORE_PHASES.map((phase) => ({
      apiVersion: "velero.io/v1",
      kind: "Restore",
      metadata: metadata(`restore-${phase.toLowerCase()}`),
      spec: restoreSpec(phase, {
        backupName: "backup-completed",
        includedNamespaces: [names.source],
        namespaceMapping: { [names.source]: names.restored },
        includeClusterResources: false,
        restorePVs: false,
        existingResourcePolicy: "none",
      }),
      status: status(phase, "itemsRestored"),
    })),
    {
      apiVersion: "velero.io/v1",
      kind: "Schedule",
      metadata: metadata("schedule-enabled"),
      // A schedule with a phase was read, and the release writes `skipImmediately` into what it reads.
      spec: { schedule: "0 0 1 1 *", paused: false, skipImmediately: false, template: backupSpec },
      status: { phase: "Enabled" },
    },
    {
      apiVersion: "velero.io/v1",
      kind: "Schedule",
      metadata: metadata("schedule-paused"),
      spec: { schedule: "0 0 1 1 *", paused: true, skipImmediately: false, template: backupSpec },
      status: { phase: "Enabled" },
    },
    {
      apiVersion: "velero.io/v1",
      kind: "Schedule",
      metadata: metadata("schedule-invalid"),
      spec: { schedule: "invalid-synthetic-cron", paused: true, skipImmediately: false, template: backupSpec },
      status: { phase: "FailedValidation", validationErrors: ["Synthetic invalid schedule"] },
    },
    {
      apiVersion: "velero.io/v1",
      kind: "BackupStorageLocation",
      metadata: metadata("fixture-readonly"),
      spec: { ...locationSpec, accessMode: "ReadOnly" },
      status: { phase: "Available" },
    },
    {
      apiVersion: "velero.io/v1",
      kind: "BackupStorageLocation",
      metadata: metadata("fixture-unavailable"),
      spec: { ...locationSpec, accessMode: "ReadWrite" },
      status: { phase: "Unavailable", message: "Synthetic storage failure; no endpoint was contacted" },
    },
    {
      apiVersion: "velero.io/v1",
      kind: "VolumeSnapshotLocation",
      metadata: metadata("fixture-unreported"),
      spec: { provider: "aws", config: { region: "us-east-1" } },
    },
  ];
}

export interface FixtureRuntime {
  owner: string;
  kubectl(args: string[], input?: string, timeout?: number, recordOutput?: boolean): string;
  apply(resource: KubeResource): void;
}

export function readFixture(runtime: FixtureRuntime, expected: KubeResource): KubeResource {
  const group = expected.apiVersion.includes("/") ? `.${expected.apiVersion.split("/")[0]}` : "";
  const namespace = expected.metadata.namespace ? ["--namespace", expected.metadata.namespace] : [];
  const actual = JSON.parse(
    runtime.kubectl(["get", `${expected.kind}${group}`, expected.metadata.name, ...namespace, "-o", "json"]),
  ) as KubeResource;

  requireCondition(
    actual.metadata.labels?.[OWNER_LABEL] === runtime.owner && actual.metadata.uid,
    "Fixture ownership changed",
  );
  return actual;
}

export function createStaticFixtures(runtime: FixtureRuntime, run: string): KubeResource[] {
  const schemas = JSON.parse(
    runtime.kubectl(["get", "customresourcedefinitions", "backups.velero.io", "restores.velero.io", "-o", "json"]),
  ) as {
    items: {
      spec: {
        names: { kind: string };
        versions: {
          name: string;
          subresources?: { status?: unknown };
          schema: { openAPIV3Schema: { properties: { status: { properties: { phase: { enum: string[] } } } } } };
        }[];
      };
    }[];
  };

  requireCondition(schemas.items.length === 2, "Backup/Restore schemas are missing");
  for (const schema of schemas.items) {
    const version = schema.spec.versions.find((item) => item.name === "v1");
    const expected = schema.spec.names.kind === "Backup" ? BACKUP_PHASES : RESTORE_PHASES;

    requireCondition(
      version &&
        !version.subresources?.status &&
        isDeepStrictEqual(
          [...version.schema.openAPIV3Schema.properties.status.properties.phase.enum].sort(),
          [...expected].sort(),
        ),
      "Installed phase/schema contract differs from the reviewed release",
    );
  }
  for (const name of ["deployment/velero", "daemonset/node-agent"]) {
    const workload = JSON.parse(
      runtime.kubectl(["get", name, "--namespace", DEMO_NAMESPACE, "-o", "json"]),
    ) as KubeResource & {
      spec: {
        template: {
          spec: {
            containers: { env: { name: string; value?: string; valueFrom?: { fieldRef?: { fieldPath: string } } }[] }[];
          };
        };
      };
    };
    const namespace = workload.spec.template.spec.containers[0].env.find((item) => item.name === "VELERO_NAMESPACE");

    requireCondition(
      workload.metadata.labels?.[OWNER_LABEL] === runtime.owner &&
        (namespace?.value === DEMO_NAMESPACE || namespace?.valueFrom?.fieldRef?.fieldPath === "metadata.namespace"),
      "Controller namespace scope is not explicit",
    );
  }
  return createWithStatus(runtime, staticFixtures(runtime.owner, run));
}

// An object is created without its status and gets it with a change that names its uid and its version:
// what is read back is what was asked, or the fixture is refused.
function createWithStatus(runtime: FixtureRuntime, manifests: KubeResource[]): KubeResource[] {
  const snapshots: KubeResource[] = [];

  for (const manifest of manifests) {
    const initial = structuredClone(manifest);

    delete initial.status;
    runtime.apply(initial);
    if (manifest.status && !isDeepStrictEqual(readFixture(runtime, initial).status, manifest.status)) {
      const created = readFixture(runtime, initial);

      runtime.kubectl([
        "patch",
        `${manifest.kind}.velero.io`,
        manifest.metadata.name,
        "--namespace",
        manifest.metadata.namespace ?? "",
        "--type=merge",
        "--patch",
        JSON.stringify({
          metadata: { uid: created.metadata.uid, resourceVersion: created.metadata.resourceVersion },
          status: manifest.status,
        }),
      ]);
    }
    const actual = readFixture(runtime, manifest);

    if (manifest.kind !== "Namespace") {
      requireCondition(
        isDeepStrictEqual(actual.status ?? {}, manifest.status ?? {}),
        `Synthetic ${manifest.kind} status was pruned or changed`,
      );
      snapshots.push(actual);
    }
  }
  return snapshots;
}

// The kubeconfig of the identity that reads a part of the views: the one of the environment with the
// credential replaced, and the namespace that identity can read as the one of its context.
export function readerKubeconfig(config: KindConfig, token: string, namespace: string): KindConfig {
  requireCondition(
    config.users.length === 1 && config.contexts.length === 1 && config.clusters.length === 1,
    "The kubeconfig of the environment has one target",
  );
  requireCondition(token.length > 100, "Local reader credential was not generated");
  const reader = structuredClone(config);

  reader.users[0].user = { token };
  reader.contexts[0].context = { ...reader.contexts[0].context, namespace };
  return reader;
}

// The fixtures of the views, put in place once: a second call finds them and changes nothing.
export function createViewFixtures(
  runtime: FixtureRuntime,
  run: string,
  started: number,
): { views: number; scale: number; restores: number } {
  const names = fixtureNames(run);
  // The newest backup of the schedule with a history goes first, after the namespaces: the time it was
  // created is the last submission of its schedule. A second call finds the backup, and asks for the
  // same schedule.
  const first = viewFixtures(runtime.owner, run, started).filter(
    (resource) =>
      resource.kind === "Namespace" || (resource.kind === "Backup" && resource.metadata.name === NEWEST_OF_THE_HISTORY),
  );
  const newest = createWithStatus(runtime, first);

  requireCondition(newest.length === 1, "The newest backup of the history is one");
  const submitted = Date.parse(String((newest[0].metadata as { creationTimestamp?: string }).creationTimestamp));

  requireCondition(Number.isFinite(submitted), "The newest backup of the history has the time it was created");
  const views = createWithStatus(runtime, viewFixtures(runtime.owner, run, started, submitted));
  const scale = scaleFixtures(runtime.owner, run);
  const place = (kind: string, items: KubeResource[]): number => {
    const listed = () =>
      (
        JSON.parse(
          runtime.kubectl(
            ["get", `${kind}.velero.io`, "--namespace", names.scale, "-o", "json"],
            undefined,
            undefined,
            false,
          ),
        ) as { items: (KubeResource & { status?: { phase?: string } })[] }
      ).items;

    if (!listed().length) {
      runtime.kubectl(
        ["create", "-f", "-", "-o", "name"],
        JSON.stringify({ apiVersion: "v1", kind: "List", items }),
        600_000,
        false,
      );
    }
    const found = listed();

    requireCondition(
      found.length === items.length &&
        found.every(
          (item) =>
            item.metadata.labels?.[OWNER_LABEL] === runtime.owner &&
            item.metadata.labels?.[FIXTURE_LABEL] === run &&
            item.status?.phase,
        ),
      `The ${kind} of the long list are not the ones of this run`,
    );
    return found.length;
  };

  runtime.apply(scale.namespace);
  return {
    views: views.length,
    scale: place("backups", scale.backups),
    restores: place("restores", scale.restores),
  };
}

export function verifyStaticFixtures(runtime: FixtureRuntime, snapshots: KubeResource[]): void {
  for (const snapshot of snapshots) {
    const actual = readFixture(runtime, snapshot);

    requireCondition(
      actual.metadata.uid === snapshot.metadata.uid &&
        actual.metadata.resourceVersion === snapshot.metadata.resourceVersion &&
        isDeepStrictEqual(actual.status, snapshot.status),
      "A controller changed an isolated synthetic fixture",
    );
  }
}

export function liveBackup(owner: string, run: string): KubeResource {
  const names = fixtureNames(run);

  requireCondition(owner, "Fixture ownership is required");
  return {
    apiVersion: "velero.io/v1",
    kind: "Backup",
    metadata: {
      name: names.backup,
      namespace: DEMO_NAMESPACE,
      labels: { [OWNER_LABEL]: owner, [FIXTURE_LABEL]: run, [FIXTURE_MODE]: "live" },
    },
    spec: {
      includedNamespaces: [names.source],
      includedResources: ["configmaps"],
      labelSelector: { matchLabels: { [FIXTURE_LABEL]: run } },
      includeClusterResources: false,
      storageLocation: "default",
      snapshotVolumes: false,
      defaultVolumesToFsBackup: false,
      // The release deletes a backup when it expires, and its restores with it: the backup the views are
      // looked at with lasts as long as the environment is kept, which is days.
      ttl: LIVE_RETENTION,
    },
  };
}

export function liveRestore(owner: string, run: string): KubeResource {
  const names = fixtureNames(run);

  requireCondition(owner, "Fixture ownership is required");
  return {
    apiVersion: "velero.io/v1",
    kind: "Restore",
    metadata: {
      name: names.restore,
      namespace: DEMO_NAMESPACE,
      labels: { [OWNER_LABEL]: owner, [FIXTURE_LABEL]: run, [FIXTURE_MODE]: "live" },
    },
    spec: {
      backupName: names.backup,
      includedNamespaces: [names.source],
      includedResources: ["configmaps"],
      namespaceMapping: { [names.source]: names.restored },
      includeClusterResources: false,
      restorePVs: false,
      existingResourcePolicy: "none",
    },
  };
}

async function waitCompleted(runtime: FixtureRuntime, expected: KubeResource): Promise<KubeResource> {
  const deadline = Date.now() + 180_000;

  while (Date.now() < deadline) {
    const actual = readFixture(runtime, expected);
    const status = actual.status as { phase?: string; errors?: number } | undefined;

    if (status?.phase === "Completed") {
      requireCondition(!status.errors, `Live ${expected.kind} reported errors`);
      return actual;
    }
    requireCondition(
      !["Failed", "FailedValidation", "PartiallyFailed"].includes(status?.phase ?? ""),
      `Live ${expected.kind} ended in ${status?.phase}`,
    );
    await delay(1000);
  }
  throw new Error(`Live ${expected.kind} did not complete within the fixture deadline`);
}

export async function runLiveFixtures(
  runtime: FixtureRuntime,
  run: string,
): Promise<{ configMaps: number; payloadBytes: number; backup: KubeResource; restore: KubeResource }> {
  const names = fixtureNames(run);
  const labels = { [OWNER_LABEL]: runtime.owner, [FIXTURE_LABEL]: run, [FIXTURE_MODE]: "live" };

  for (const namespace of [names.source, names.restored])
    runtime.apply({ apiVersion: "v1", kind: "Namespace", metadata: { name: namespace, labels } });
  const small: KubeResource = {
    apiVersion: "v1",
    kind: "ConfigMap",
    metadata: { name: "small-fixture", namespace: names.source, labels },
    data: { message: "Synthetic Velero foundation fixture", run },
  };

  runtime.apply(small);
  const expected = new Map<string, string>();
  const checksum = (value: Buffer) => createHash("sha256").update(value).digest("hex");
  let payloadBytes = 0;

  for (let index = 0; index < 12; index += 1) {
    const bytes = randomBytes(768 * 1024);
    const name = `payload-${String(index).padStart(2, "0")}`;
    const resource: KubeResource = {
      apiVersion: "v1",
      kind: "ConfigMap",
      metadata: { name, namespace: names.source, labels },
      binaryData: { payload: bytes.toString("base64") },
    };

    runtime.apply(resource);
    expected.set(name, checksum(bytes));
    payloadBytes += bytes.length;
  }
  const backupManifest = liveBackup(runtime.owner, run);

  runtime.apply(backupManifest);
  const backup = await waitCompleted(runtime, backupManifest);
  const restoreManifest = liveRestore(runtime.owner, run);

  runtime.apply(restoreManifest);
  const restore = await waitCompleted(runtime, restoreManifest);
  const restoredSmall = readFixture(runtime, { ...small, metadata: { ...small.metadata, namespace: names.restored } });

  requireCondition(isDeepStrictEqual(restoredSmall.data, small.data), "Small restored ConfigMap data differs");
  for (const [name, hash] of expected) {
    const actual = readFixture(runtime, {
      apiVersion: "v1",
      kind: "ConfigMap",
      metadata: { name, namespace: names.restored },
    });
    const bytes = (actual.binaryData as { payload?: string } | undefined)?.payload;

    requireCondition(
      bytes && checksum(Buffer.from(bytes, "base64")) === hash,
      "Large restored fixture content differs",
    );
  }
  return { configMaps: expected.size + 1, payloadBytes, backup, restore };
}
