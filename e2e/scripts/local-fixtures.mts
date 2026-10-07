import { createHash, randomBytes } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { isDeepStrictEqual } from "node:util";
import { gunzipSync } from "node:zlib";
import {
  ENTRY_KEYS,
  emptyArchive,
  entryFields,
  gz,
  logFacts,
  SYNCED_AGE,
  SYNCED_WORK,
  tabArtifacts,
  tabExpectations,
} from "./local-artifacts.mts";
import { DEMO_CONTEXT, DEMO_NAMESPACE, type KindConfig, OWNER_LABEL, requireCondition } from "./local-kind.mts";
import { BUCKET, type KubeResource, STORAGE_ENDPOINT } from "./local-manifests.mts";
import { STORE_WAYS, type StoreAnswer, type StoreBody, type StoreWay } from "./local-store.mts";

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
    defaults: `velero-defaults-${run}`,
    overview: `velero-overview-${run}`,
    scale: `velero-scale-${run}`,
    backup: `fixture-backup-${run}`,
    restore: `fixture-restore-${run}`,
    // The operations the server refuses, which the transport proof asks the artifacts of: a backup and a
    // restore that fail their validation, and a restore asked from a schedule that has no backup.
    invalidBackup: `fixture-invalid-backup-${run}`,
    invalidRestore: `fixture-invalid-restore-${run}`,
    orphanRestore: `fixture-orphan-restore-${run}`,
    emptySchedule: `fixture-empty-schedule-${run}`,
    // The backups the sync of the release creates from what the store is given, for the tabs of a backup:
    // one with its four artifacts, and one whose log is not there. Each has a folder of its own in the
    // store, and no backup of a run has a name another one begins with.
    syncedBackup: `fixture-synced-backup-${run}`,
    syncedBackupWithoutLog: `fixture-synced-backup-no-log-${run}`,
  };
}

export function fixtureNamespaces(run: string): string[] {
  const names = fixtureNames(run);

  return [names.source, names.restored, names.static, names.views, names.defaults, names.overview, names.scale];
}

// The path of the log or of the results of a backup or of a restore in the bucket of the environment, as
// the release lays the store out, for the operations of a run and for no other name.
export function fixtureArtifactPath(
  run: string,
  artifact: "BackupLog" | "BackupResults" | "RestoreLog" | "RestoreResults",
  name: string,
): string {
  const names = fixtureNames(run);
  const ofBackup = artifact.startsWith("Backup");

  requireCondition(
    (ofBackup
      ? [names.backup, names.invalidBackup]
      : [names.restore, names.invalidRestore, names.orphanRestore]
    ).includes(name),
    "An artifact of an operation outside this fixture run is not asked for",
  );
  const file = artifact.endsWith("Log") ? "logs" : "results";

  return ofBackup
    ? `/${BUCKET}/backups/${name}/${name}-${file}.gz`
    : `/${BUCKET}/restores/${name}/restore-${name}-${file}.gz`;
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

// The keys of the two backups the store is given for the tabs, as the release lays the store out, in the
// order they are stored in: the contents first and the metadata last, since a pass of the sync takes a
// folder as it is once it finds the metadata there. The second backup has no log. The files the release
// would act on are not among them: from the list of the pod volume backups the sync creates objects, and
// for each snapshot of the list of the native ones the deletion calls a plugin.
export function tabArtifactPaths(run: string) {
  const names = fixtureNames(run);
  const keys = (name: string) => {
    const folder = `/${BUCKET}/backups/${name}`;

    return {
      archive: `${folder}/${name}.tar.gz`,
      log: `${folder}/${name}-logs.gz`,
      results: `${folder}/${name}-results.gz`,
      resourceList: `${folder}/${name}-resource-list.json.gz`,
      volumeInfo: `${folder}/${name}-volumeinfo.json.gz`,
      metadata: `${folder}/velero-backup.json`,
    };
  };
  const { log: _lost, ...withoutLog } = keys(names.syncedBackupWithoutLog);

  return { synced: keys(names.syncedBackup), withoutLog };
}

// The keys of the real backup and of the real restore the tabs read beside their logs and their results:
// the list of the resources and the volume information of each. The release writes the volume information
// of a restore without the prefix it gives the other files of a restore.
export function realTabArtifactPaths(run: string) {
  const names = fixtureNames(run);
  const backup = `/${BUCKET}/backups/${names.backup}/${names.backup}`;
  const restore = `/${BUCKET}/restores/${names.restore}`;

  return {
    backupResourceList: `${backup}-resource-list.json.gz`,
    backupVolumeInfo: `${backup}-volumeinfo.json.gz`,
    restoreResourceList: `${restore}/restore-${names.restore}-resource-list.json.gz`,
    restoreVolumeInfo: `${restore}/${names.restore}-volumeinfo.json.gz`,
  };
}

// Every key of a run the client of the store may ask for: what the server wrote for the real operations, and
// what the store is given for the tabs. Once a run is cleaned the store holds none of them.
export function runArtifactPaths(run: string): string[] {
  const tabs = tabArtifactPaths(run);

  return [
    ...Object.values(fixtureArtifactPaths(run)),
    ...Object.values(realTabArtifactPaths(run)),
    ...Object.values(tabs.synced),
    ...Object.values(tabs.withoutLog),
  ];
}

// What the client of the store may ask of the bucket, by the exact key: whether a key of the run is there;
// the artifacts of the real operations, to read them, and never the contents of the real backup; the keys
// of the tabs, to write them, and never to read them back. Nothing is deleted through it: the controller
// removes the files of a backup with the backup.
export function allowsFixtureArtifact(method: string, path: string, run: string): boolean {
  const paths = fixtureArtifactPaths(run);
  const tabs = tabArtifactPaths(run);
  const read = [
    ...Object.values(paths).filter((key) => key !== paths.archive),
    ...Object.values(realTabArtifactPaths(run)),
  ];
  const written = [...Object.values(tabs.synced), ...Object.values(tabs.withoutLog)];

  if (method === "HEAD") return runArtifactPaths(run).includes(path);
  return (method === "GET" && read.includes(path)) || (method === "PUT" && written.includes(path));
}

// What a request to the store is, before anything of it is sent. The client reads, asks whether a key is
// there, and writes: it has no other verb, and deletes nothing. It asks the bucket of the environment,
// which it creates once, and the one it is denied, to be denied; of the keys, what it is allowed above.
//
// A key of the tabs is written with its body, and never without: a key written with none is a file of no
// bytes, which the deletion of a backup cannot read, and which leaves the backup where it is. Nothing else
// carries a body. And a body is sent while the placement of the tabs is recorded as storing: what the store
// holds of the tabs was recorded before it was written. Once their removal is recorded no file is written
// any more, but the contents of a backup the removal is recorded to put back, which the server could not
// read; and nothing is written at any other moment.
export function assertStoreRequest(request: {
  method: string;
  path: string;
  // The fixture run, when there is one.
  run?: string;
  body?: StoreBody;
  // The state the placement of the tabs is recorded in, when it is recorded.
  placement?: string;
  // The contents of a backup the removal of the tabs is recorded to put back.
  repaired?: string[];
}): void {
  const { method, path, run, body, placement, repaired } = request;
  const tabs = run === undefined ? undefined : tabArtifactPaths(run);
  const written =
    method === "PUT" && [...Object.values(tabs?.synced ?? {}), ...Object.values(tabs?.withoutLog ?? {})].includes(path);

  requireCondition(
    (path === `/${BUCKET}` && ["GET", "HEAD", "PUT"].includes(method)) ||
      (path === "/velero-denied" && method === "GET") ||
      (run !== undefined && allowsFixtureArtifact(method, path, run)),
    "Unexpected local bucket target",
  );
  requireCondition(!written || (body && body.bytes.length > 0), "A key of the tabs is not written without its body");
  requireCondition(written || !body, "Only a key of the tabs is sent with a body");
  requireCondition(!body || STORE_WAYS.includes(body.way), "A body is sent in a way the client of the store knows");
  requireCondition(
    !body ||
      placement !== "clearing" ||
      ([tabs?.synced.archive, tabs?.withoutLog.archive].includes(path) && repaired?.includes(path)),
    "While the fixtures of the tabs are removed nothing is written but the contents of a backup that are recorded to be put back",
  );
  requireCondition(
    !body || placement === "storing" || placement === "clearing",
    "A key of the tabs is written while the placement of the tabs is recorded as storing",
  );
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

    // What is not of the run is told by what it is, and left: the namespace is not removed with it inside.
    requireCondition(
      systemDefault ||
        (resource.metadata.labels?.[OWNER_LABEL] === owner && resource.metadata.labels?.[FIXTURE_LABEL] === run),
      `The namespace ${namespace} of the fixtures holds the ${resource.kind} ${resource.metadata.name}, which is ` +
        "not of this run: a cleanup removes no namespace with such an object in it, and nothing here removes the " +
        "object. The way out is to take the environment down, with `pnpm demo:down`.",
    );
  }
}

// The request that asks the controller to delete a backup of the fixtures: the real one, the one that
// failed its validation, or one of the two the sync created from the store. No other backup is deleted
// this way.
export function fixtureDeletionRequest(
  owner: string,
  run: string,
  backupUid: string,
  backupName = fixtureNames(run).backup,
): KubeResource {
  const names = fixtureNames(run);

  requireCondition(owner && backupUid, "Bound backup ownership is required for deletion");
  requireCondition(
    [names.backup, names.invalidBackup, names.syncedBackup, names.syncedBackupWithoutLog].includes(backupName),
    "Only a backup of the fixtures is deleted",
  );
  return {
    apiVersion: "velero.io/v1",
    kind: "DeleteBackupRequest",
    metadata: {
      name: `${backupName}-delete`,
      namespace: DEMO_NAMESPACE,
      labels: {
        [OWNER_LABEL]: owner,
        [FIXTURE_LABEL]: run,
        [FIXTURE_MODE]: "live",
        "velero.io/backup-name": backupName,
        "velero.io/backup-uid": backupUid,
      },
    },
    spec: { backupName },
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
// A location whose name and whose bucket are as long as they can be, 63 characters each, with a prefix of
// many parts.
export const LONG_LOCATION_NAME = "location-with-a-name-as-long-as-the-name-of-an-object-can-be-63";
export const LONG_BUCKET_NAME = "bucket-with-a-name-as-long-as-the-name-of-a-bucket-can-be-in-s3";
export const LONG_PREFIX = "clusters/production/europe/south/first/velero/backups/of/every/namespace/kept/for/a/year";

// What a synthetic location that cannot be used says, in more than one line.
export const UNAVAILABLE_MESSAGE = [
  "Synthetic storage failure; no endpoint was contacted.",
  "The bucket of the location was looked for and was not found,",
  "and the second attempt ended as the first.",
].join("\n");

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
  const at = (time: number) => new Date(time).toISOString().replace(".000Z", "Z");
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
    // No controller validates a synthetic location: what it reports is of a validation that is days old,
    // however young the environment is. This one names its frequency, and is late by it.
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
        validationFrequency: "1m0s",
        backupSyncPeriod: "1m0s",
      },
      status: { phase: "Available", lastValidationTime: at(day(1)), lastSyncedTime: at(day(1)) },
    },
    // A location that is there and takes no backup: what a template that names it is told. It names no
    // frequency: the one of the server is not known, and its validation is late by the hour.
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
      status: { phase: "Available", lastValidationTime: at(day(3)) },
    },
    {
      apiVersion: "velero.io/v1",
      kind: "BackupStorageLocation",
      metadata: metadata(LONG_LOCATION_NAME),
      spec: {
        provider: "aws",
        objectStorage: { bucket: LONG_BUCKET_NAME, prefix: LONG_PREFIX },
        config: { region: "us-east-1" },
        accessMode: "ReadWrite",
      },
      status: { phase: "Available", lastValidationTime: at(day(4)) },
    },
    // A location Velero has not read: it has no status.
    {
      apiVersion: "velero.io/v1",
      kind: "BackupStorageLocation",
      metadata: metadata("views-unreported"),
      spec: { provider: "aws", objectStorage: { bucket: BUCKET, prefix: "unreported" } },
    },
    // What Velero says of a location it cannot use, in the lines it says it in. Nothing was contacted.
    {
      apiVersion: "velero.io/v1",
      kind: "BackupStorageLocation",
      metadata: metadata("views-unavailable"),
      spec: {
        provider: "aws",
        objectStorage: { bucket: BUCKET, prefix: "unavailable" },
        config: { region: "us-east-1" },
        accessMode: "ReadWrite",
      },
      status: {
        phase: "Unavailable",
        message: UNAVAILABLE_MESSAGE,
        lastValidationTime: at(day(2)),
      },
    },
    // The Secrets a location names are not among the fixtures: the views show the names, and read none.
    // The periodic validation and the sync are turned off, and the address carries what a URL can hide.
    {
      apiVersion: "velero.io/v1",
      kind: "BackupStorageLocation",
      metadata: metadata("views-with-credential"),
      spec: {
        provider: "aws",
        objectStorage: {
          bucket: BUCKET,
          prefix: "with-credential",
          caCertRef: { name: "views-storage-ca", key: "ca.crt" },
        },
        config: {
          region: "us-east-1",
          insecureSkipTLSVerify: "true",
          s3Url: `${STORAGE_ENDPOINT}/?synthetic=left-out`,
        },
        credential: { name: "views-credential", key: "cloud" },
        accessMode: "ReadWrite",
        validationFrequency: "0s",
        backupSyncPeriod: "0s",
      },
      status: { phase: "Available", lastValidationTime: at(day(30)) },
    },
    {
      apiVersion: "velero.io/v1",
      kind: "VolumeSnapshotLocation",
      metadata: metadata("views-snapshots"),
      spec: { provider: "aws", config: { region: "us-east-1" } },
      status: { phase: "Available" },
    },
    // A snapshot location as the release leaves one: no status. It names the Secret of its credential.
    {
      apiVersion: "velero.io/v1",
      kind: "VolumeSnapshotLocation",
      metadata: metadata("views-snapshots-unreported"),
      spec: {
        provider: "csi",
        config: { region: "us-east-1" },
        credential: { name: "views-credential", key: "cloud" },
      },
    },
    // An installation with two locations marked default, which the release brings back to one when it
    // reads them: no controller reads these. The one it would keep is the one created last, which is the
    // second of the two. Created in the same second, which one it keeps is not settled: a suite reads when
    // each was created, and expects what the view says of that.
    { apiVersion: "v1", kind: "Namespace", metadata: { name: names.defaults, labels } },
    ...(["defaults-older", "defaults-newer"] as const).map((name) => ({
      apiVersion: "velero.io/v1",
      kind: "BackupStorageLocation",
      metadata: { name, namespace: names.defaults, labels },
      spec: {
        provider: "aws",
        objectStorage: { bucket: BUCKET, prefix: name },
        config: { region: "us-east-1" },
        accessMode: name === "defaults-older" ? "ReadOnly" : "ReadWrite",
        default: true,
      },
      status: { phase: "Available", lastValidationTime: at(day(1)) },
    })),
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
// What is placed by the clock: objects whose times are counted back from when they were put in place, so
// that a window of the last hours holds some of them. They say when that was, and are put in place again
// when it was longer ago than they are good for.
export const PLACED_ANNOTATION = "freelensapp.io/velero-fixture-placed";
export const PLACED_FOR = 12 * 3_600_000;
// What the fixtures are made of, as a digest of them: the ones that are in place are put in place again
// when the ones that would be made now are not the same, whatever their age.
export const SHAPE_ANNOTATION = "freelensapp.io/velero-fixture-shape";

const DAY = 86_400_000;

function placedAt(placed: number): { annotations: Record<string, string> } {
  requireCondition(Number.isFinite(placed), "The time the fixtures are placed at is required");
  return { annotations: { [PLACED_ANNOTATION]: new Date(placed).toISOString() } };
}

// A thousand backups and a thousand restores, spread over the thirty days before they were put in place:
// every window of the recent operations holds some of them.
export function scaleFixtures(
  owner: string,
  run: string,
  placed = Date.parse("2026-09-01T00:00:00Z"),
): { namespace: KubeResource; backups: KubeResource[]; restores: KubeResource[] } {
  requireCondition(owner, "Fixture ownership is required");
  const names = fixtureNames(run);
  const labels = { [OWNER_LABEL]: owner, [FIXTURE_LABEL]: run, [FIXTURE_MODE]: "synthetic" };
  const step = (30 * DAY) / SCALE_BACKUPS;
  // The last of them started a step before they were put in place: none is of a time that is to come.
  const first = Math.floor(placed / 1000) * 1000 - 30 * DAY;
  const at = placedAt(placed);

  return {
    namespace: { apiVersion: "v1", kind: "Namespace", metadata: { name: names.scale, labels } },
    backups: Array.from({ length: SCALE_BACKUPS }, (_, index) => ({
      apiVersion: "velero.io/v1",
      kind: "Backup",
      metadata: { name: `backup-${String(index + 1).padStart(4, "0")}`, namespace: names.scale, labels, ...at },
      spec: {
        includedNamespaces: [names.source],
        includeClusterResources: false,
        storageLocation: `scale-location-${(index % 3) + 1}`,
        snapshotVolumes: false,
        ttl: "720h0m0s",
      },
      status: syntheticStatus(BACKUP_PHASES[index % BACKUP_PHASES.length], "itemsBackedUp", first + index * step),
    })),
    restores: Array.from({ length: SCALE_RESTORES }, (_, index) => ({
      apiVersion: "velero.io/v1",
      kind: "Restore",
      metadata: { name: `restore-${String(index + 1).padStart(4, "0")}`, namespace: names.scale, labels, ...at },
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
        first + index * step + step / 2,
      ),
    })),
  };
}

export const OVERVIEW_SCHEDULES = 12;

// An installation for the Overview: storage locations a rule names, twelve schedules of which the rules
// name two, and backups and restores whose times are counted back from when they were put in place, so
// that each window of the recent operations holds some of them and leaves some out. No controller reads
// them.
export function overviewFixtures(owner: string, run: string, placed: number): KubeResource[] {
  requireCondition(owner, "Fixture ownership is required");
  const names = fixtureNames(run);
  const labels = { [OWNER_LABEL]: owner, [FIXTURE_LABEL]: run, [FIXTURE_MODE]: "synthetic" };
  const at = placedAt(placed);
  const HOUR = 3_600_000;
  const before = (time: number) => Math.floor(placed / 1000) * 1000 - time;
  const time = (value: number) => new Date(value).toISOString().replace(".000Z", "Z");
  const metadata = (name: string, more: Record<string, string> = {}) => ({
    name,
    namespace: names.overview,
    labels: { ...labels, ...more },
    ...at,
  });
  const location = (name: string, spec: object, status?: object): KubeResource => ({
    apiVersion: "velero.io/v1",
    kind: "BackupStorageLocation",
    metadata: metadata(name),
    spec: {
      provider: "aws",
      objectStorage: { bucket: BUCKET, prefix: name },
      config: { region: "us-east-1" },
      ...spec,
    },
    ...(status ? { status } : {}),
  });
  const schedule = (index: number): KubeResource => {
    const name = `overview-schedule-${String(index).padStart(2, "0")}`;
    const template = {
      includedNamespaces: [names.source],
      includeClusterResources: false,
      // The eleventh sends its backups to the location that is not available.
      storageLocation: index === 11 ? "overview-unavailable" : "overview-default",
      ttl: "720h0m0s",
    };

    // The release writes the time of the last backup it asked for a schedule into the schedule: the first
    // asked for one an hour before, and the seventh eight hours before, when its expression was one the
    // release took.
    const submitted = index === 1 ? HOUR : index === 7 ? 8 * HOUR : undefined;
    const last = submitted === undefined ? {} : { lastBackup: time(before(submitted)) };

    // The seventh was refused, the eleventh was not read, the fifth is paused.
    return {
      apiVersion: "velero.io/v1",
      kind: "Schedule",
      metadata: metadata(name),
      spec: {
        schedule: index === 7 ? "every night" : `0 ${index} * * *`,
        paused: index === 5,
        ...(index === 11 ? {} : { skipImmediately: false }),
        template,
      },
      ...(index === 11
        ? {}
        : {
            status:
              index === 7
                ? {
                    phase: "FailedValidation",
                    validationErrors: ["invalid schedule: expected exactly 5 fields, found 2: [every night]"],
                    ...last,
                  }
                : { phase: "Enabled", ...last },
          }),
    };
  };
  const backup = (name: string, phase: string, started: number, schedule?: string): KubeResource => ({
    apiVersion: "velero.io/v1",
    kind: "Backup",
    metadata: metadata(name, schedule ? { "velero.io/schedule-name": schedule } : {}),
    spec: {
      includedNamespaces: [names.source],
      includeClusterResources: false,
      storageLocation: "overview-default",
      snapshotVolumes: false,
      ttl: "720h0m0s",
    },
    // The release writes its place in the queue into a backup that waits.
    status: {
      ...syntheticStatus(phase, "itemsBackedUp", before(started)),
      ...(phase === "Queued" ? { queuePosition: 1 } : {}),
    },
  });
  const restore = (name: string, phase: string, started: number): KubeResource => ({
    apiVersion: "velero.io/v1",
    kind: "Restore",
    metadata: metadata(name),
    spec: restoreSpec(phase, {
      backupName: "recent-5d",
      includedNamespaces: [names.source],
      namespaceMapping: { [names.source]: names.restored },
      includeClusterResources: false,
      restorePVs: false,
      existingResourcePolicy: "none",
    }),
    status: syntheticStatus(phase, "itemsRestored", before(started)),
  });

  return [
    location(
      "overview-default",
      { default: true, accessMode: "ReadWrite" },
      { phase: "Available", lastValidationTime: time(before(2 * DAY)) },
    ),
    location(
      "overview-unavailable",
      { accessMode: "ReadWrite" },
      {
        phase: "Unavailable",
        message: "Synthetic storage failure; no endpoint was contacted",
        lastValidationTime: time(before(3 * DAY)),
      },
    ),
    location("overview-silent", {}),
    ...Array.from({ length: OVERVIEW_SCHEDULES }, (_, index) => schedule(index + 1)),
    // What ended, in every window and outside them. The ones of no schedule that ended with a failure are
    // items of the window they are in.
    backup("recent-1h", "Completed", HOUR, "overview-schedule-01"),
    backup("recent-3h", "Failed", 3 * HOUR),
    backup("recent-5h", "Completed", 5 * HOUR),
    backup("recent-2d", "PartiallyFailed", 2 * DAY),
    backup("recent-5d", "Completed", 5 * DAY),
    backup("recent-10d", "Completed", 10 * DAY),
    backup("recent-25d", "Failed", 25 * DAY),
    backup("recent-40d", "Completed", 40 * DAY),
    // The backups of the schedule that was refused: one the release asked for while it took the
    // expression, which completed, and after it the newest, which a client asked from the schedule as
    // the release lets one do, with the label of the schedule. It failed its validation: it never
    // started, and is at the time it was created.
    backup("scheduled-8h", "Completed", 8 * HOUR, "overview-schedule-07"),
    backup("scheduled-refused", "FailedValidation", 0, "overview-schedule-07"),
    // What is in flight: at work, waiting, and at work with a failure.
    backup("flying-running", "InProgress", 10 * 60_000),
    backup("flying-queued", "Queued", 0),
    backup("flying-failing", "WaitingForPluginOperationsPartiallyFailed", 2 * HOUR),
    restore("restored-3h", "Completed", 3 * HOUR),
    restore("restored-3d", "Failed", 3 * DAY),
    restore("restored-20d", "Completed", 20 * DAY),
    restore("restored-35d", "PartiallyFailed", 35 * DAY),
    // It failed its validation: it never started, and is at the time it was created.
    restore("restore-refused", "FailedValidation", 0),
    restore("restore-flying", "FinalizingPartiallyFailed", HOUR),
  ];
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
      // The release writes a phase and the time of the validation together. These two have a phase and
      // no time: they are what a view shows of a status that carries one without the other.
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

// What a placement of the fixtures of the tabs has reached. While it is `storing` its files are being
// written, and the store may hold some of them and not the others; once it is `stored` every one of them is
// in the store with the length it was sent with; once it is `synced` the server created the two backups
// from them, as they were stored.
export const TAB_STATES = ["storing", "stored", "synced"] as const;
// What their removal has reached, once it began. While it is `clearing` the deletion of a backup was asked
// of the server, or is about to be, and no folder of the store is finished any more; once it is `cleared`
// neither the store nor the cluster holds anything of the tabs. A placement does not go on from either.
export const CLEAR_STATES = ["clearing", "cleared"] as const;

// What is kept of a placement, where the next run finds it: its state; the digest of the artifacts and the
// one of the two backups made of them, by which the fixtures of today are known from the ones of before;
// the way the store took a body, once the first file found it; the contents of a backup the removal put
// back, each recorded before it was written; and the metadata of each backup as it is stored, which is what
// the server is expected to create, whatever becomes of the real backup.
export interface TabPlacement {
  state: (typeof TAB_STATES)[number] | (typeof CLEAR_STATES)[number];
  artifacts: string;
  shape: string;
  way?: StoreWay;
  repaired?: string[];
  metadata: { synced: string; withoutLog: string };
}

export interface FixtureRuntime {
  owner: string;
  kubectl(args: string[], input?: string, timeout?: number, recordOutput?: boolean): string;
  apply(resource: KubeResource): void;
  // Waits before the cluster is read again. Without it the process waits where it is.
  pause?(milliseconds: number): void;
  // Asks the store of the environment, as the identity that writes to its bucket alone. A body is the bytes
  // of a key of the tabs.
  store?(method: "GET" | "HEAD" | "PUT", path: string, body?: StoreBody): StoreAnswer;
  // The time since the runtime was made, in milliseconds: what a wait for the server is bounded by.
  elapsed?(): number;
  // Where the placement of the tabs is recorded: in private, and before anything of it is written.
  tabs?: { read(): TabPlacement | undefined; keep(placement: TabPlacement): void };
  // The objects the journal of the runner records, by which `apply` knows what it may write over, and what
  // keeps a change of them.
  journal?: { entries: Recorded[]; save(): void };
}

// How long what was removed is given to be gone, and how often the cluster is asked whether it is.
const REMOVAL_TIMEOUT = 300_000;
const REMOVAL_POLL = 1000;

function pause(runtime: FixtureRuntime, milliseconds: number): void {
  if (runtime.pause) runtime.pause(milliseconds);
  else Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
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

// What is placed by the clock is found by what it says of when it was placed. It is left as it is while it
// is good, and put in place again when it is not: the objects of the namespace that are of this run are
// removed, and the ones of now are created. Nothing else of the cluster is touched. What is answered says
// whether it was put in place again, over what was there, and not when nothing was.
export function placeByTheClock(
  runtime: FixtureRuntime,
  run: string,
  namespace: string,
  now: number,
  make: (placed: number) => KubeResource[],
): { placed: number; count: number; again: boolean } {
  const names = fixtureNames(run);

  // The other namespaces of the run hold fixtures whose times are fixed, with the labels of the run: they
  // would be removed with what is placed by the clock.
  requireCondition(
    [names.overview, names.scale].includes(namespace),
    "Refusing to place fixtures outside the namespaces that are placed by the clock",
  );
  requireCondition(
    make(now).every((resource) => resource.metadata.namespace === namespace),
    `Refusing to place in ${namespace} what is made for another namespace`,
  );
  // The digest is of the fixtures made for one moment, which is the same at every call.
  const shape = createHash("sha256")
    .update(JSON.stringify(make(0)))
    .digest("hex")
    .slice(0, 16);
  const made = () =>
    make(now).map((resource) => ({
      ...resource,
      metadata: {
        ...resource.metadata,
        annotations: { ...resource.metadata.annotations, [SHAPE_ANNOTATION]: shape },
      },
    }));
  const kinds = [...new Set(make(now).map((resource) => `${resource.kind}.velero.io`.toLowerCase()))].sort();
  const listed = () =>
    (
      JSON.parse(
        runtime.kubectl(["get", kinds.join(","), "--namespace", namespace, "-o", "json"], undefined, undefined, false),
      ) as { items: (KubeResource & { status?: { phase?: string } })[] }
    ).items;
  const times = (items: KubeResource[]) =>
    items.map((item) => Date.parse(item.metadata.annotations?.[PLACED_ANNOTATION] ?? ""));
  const before = listed();
  const good =
    before.length === make(now).length &&
    before.every((item) => item.metadata.annotations?.[SHAPE_ANNOTATION] === shape) &&
    times(before).every((time) => Number.isFinite(time) && time <= now && now - time <= PLACED_FOR);

  if (!good) {
    requireCondition(
      before.every(
        (item) =>
          item.metadata.namespace === namespace &&
          item.metadata.labels?.[OWNER_LABEL] === runtime.owner &&
          item.metadata.labels?.[FIXTURE_LABEL] === run,
      ),
      "The namespace holds what is not of this run; nothing is removed",
    );
    if (before.length) {
      // The client waits for what it removed one object at a time, which is minutes for two thousand:
      // it is asked not to, and the namespace is read until nothing of it is left.
      runtime.kubectl(
        [
          "delete",
          kinds.join(","),
          "--namespace",
          namespace,
          "--selector",
          `${OWNER_LABEL}=${runtime.owner},${FIXTURE_LABEL}=${run}`,
          "--wait=false",
        ],
        undefined,
        600_000,
        false,
      );
      const started = Date.now();

      for (let left = listed().length; left > 0; left = listed().length) {
        requireCondition(
          Date.now() - started < REMOVAL_TIMEOUT,
          `${left} fixtures of ${namespace} are still there after they were removed`,
        );
        pause(runtime, REMOVAL_POLL);
      }
    }
    runtime.kubectl(
      ["create", "-f", "-", "-o", "name"],
      JSON.stringify({ apiVersion: "v1", kind: "List", items: made() }),
      600_000,
      false,
    );
  }
  const found = listed();
  const placed = Math.min(...times(found));

  requireCondition(
    found.length === make(now).length &&
      found.every(
        (item) =>
          item.metadata.labels?.[OWNER_LABEL] === runtime.owner &&
          item.metadata.labels?.[FIXTURE_LABEL] === run &&
          (item.kind === "Schedule" || item.kind === "BackupStorageLocation" || item.status?.phase),
      ) &&
      Number.isFinite(placed) &&
      now - placed <= PLACED_FOR,
    `The fixtures of ${namespace} are not the ones of this run`,
  );
  return { placed, count: found.length, again: !good && before.length > 0 };
}

// The fixtures of the views. The ones whose times are fixed are put in place once: a second call finds
// them and changes nothing. The ones that are placed by the clock are put in place again when they are
// older than they are good for.
export function createViewFixtures(
  runtime: FixtureRuntime,
  run: string,
  started: number,
  now = started,
): { views: number; overview: number; scale: number; restores: number; again: string[] } {
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
  const labels = { [OWNER_LABEL]: runtime.owner, [FIXTURE_LABEL]: run, [FIXTURE_MODE]: "synthetic" };

  runtime.apply(scaleFixtures(runtime.owner, run, now).namespace);
  runtime.apply({ apiVersion: "v1", kind: "Namespace", metadata: { name: names.overview, labels } });
  const overview = placeByTheClock(runtime, run, names.overview, now, (placed) =>
    overviewFixtures(runtime.owner, run, placed),
  );
  const scale = placeByTheClock(runtime, run, names.scale, now, (placed) => {
    const made = scaleFixtures(runtime.owner, run, placed);

    return [...made.backups, ...made.restores];
  });

  return {
    views: views.length,
    overview: overview.count,
    scale: SCALE_BACKUPS,
    restores: scale.count - SCALE_BACKUPS,
    again: [...(overview.again ? [names.overview] : []), ...(scale.again ? [names.scale] : [])],
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

// How long the backups the store is given are kept: ten years. The release asks the deletion of a backup
// whose expiration has passed, and theirs is counted from a start of four hundred days before the run.
export const SYNCED_RETENTION = "87600h0m0s";
// The snapshot location they name: the one of the installation that took them, which the installation that
// finds them in the store does not have. The release writes the name of the one location of a provider into
// every backup it takes, whatever the backup holds.
export const SYNCED_SNAPSHOT_LOCATION = "synthetic-snapshot-location";
// What the second of them selects by: a label nothing carried. A backup of every namespace that selects by
// no label holds the namespaces at least, and this one holds no item.
export const SYNCED_SELECTOR = { matchLabels: { "fixtures.synthetic.example/selected": "nothing" } };

// What the metadata of the two backups takes from their artifacts, as the suites are told of them: what
// they were made for, the entries of the results, the items of the list of the resources, the volumes, and
// the digest by which a placement is known.
type TabFacts = Pick<
  ReturnType<typeof tabExpectations>,
  "backup" | "namespace" | "started" | "digest" | "results" | "resourceList" | "volumeInfo"
>;

// The keys by which the real backup narrows itself to the fixtures of its run beside its namespaces, with
// the one the release wrote into it for them: to a backup that names a resource filter of the first kind
// it adds what it never collects under the excluded resources, and to a backup that names none, under the
// two lists by scope. The other keys by which a backup narrows itself are left as well, were the real
// backup to name them one day: the other selectors, the resources it includes by scope, and the namespaces
// it excludes, which the release also writes for every namespace that carries the label that excludes it.
const NARROWED_BY = [
  "includedResources",
  "excludedResources",
  "labelSelector",
  "includeClusterResources",
  "snapshotVolumes",
  "orLabelSelectors",
  "includedClusterScopedResources",
  "includedNamespaceScopedResources",
  "excludedNamespaces",
];
// What the release never collects: the snapshots of a CSI driver and their contents, which it takes itself.
const NEVER_COLLECTED = {
  excludedClusterScopedResources: ["volumesnapshotcontents.snapshot.storage.k8s.io"],
  excludedNamespaceScopedResources: ["volumesnapshots.snapshot.storage.k8s.io"],
};
// What the release writes into the annotations of a backup it takes: the version of the cluster it was
// taken in, and how long its server waits for a resource.
const TAKEN_ANNOTATIONS = [
  "velero.io/source-cluster-k8s-gitversion",
  "velero.io/source-cluster-k8s-major-version",
  "velero.io/source-cluster-k8s-minor-version",
  "velero.io/resource-timeout",
];
// What it writes into the status of a backup it takes that is not of the work of that backup: the version
// of its format, in two forms. The status of the hooks is taken with them: the real backup has no hook to
// run, and carries it with nothing in it, as every backup whose work ended with none.
const TAKEN_STATUS = ["version", "formatVersion", "hookStatus"];

// The entries of an object whose keys are kept.
function only<Value>(from: Record<string, Value> | undefined, keep: (key: string) => boolean): Record<string, Value> {
  return Object.fromEntries(Object.entries(from ?? {}).filter(([key]) => keep(key)));
}

// A counter of zero is not written.
function counted(counters: Record<string, number>): Record<string, number> {
  return Object.fromEntries(Object.entries(counters).filter(([, count]) => count > 0));
}

// What a backup holds, as its status counts it.
interface Held {
  errors: number;
  warnings: number;
  items: number;
  volumes: TabFacts["volumeInfo"]["value"];
}

// What the release leaves in the status of a backup that ended, for what the backup holds. It counts the
// entries of the log at error and at warning, which are the entries of the results, and one error is a
// backup that failed in part. The items done and their total are the items of the list of the resources,
// and a backup of no item has a progress with no key. It counts the native snapshots, and the ones in the
// phase Completed; the CSI snapshots, each with one operation of a plugin, and the ones whose operation
// completed, which the volume information says succeeded. It is the count of a backup that keeps its
// snapshots where they are taken: one that moves their data is not counted here.
function countedStatus(held: Held): Record<string, unknown> {
  const native = held.volumes.filter((volume) => volume.backupMethod === "NativeSnapshot");
  const csi = held.volumes.filter((volume) => volume.backupMethod === "CSISnapshot");
  const completed = csi.filter((volume) => volume.result === "succeeded").length;

  return {
    phase: held.errors > 0 ? "PartiallyFailed" : "Completed",
    progress: counted({ totalItems: held.items, itemsBackedUp: held.items }),
    ...counted({
      errors: held.errors,
      warnings: held.warnings,
      volumeSnapshotsAttempted: native.length,
      volumeSnapshotsCompleted: native.filter((volume) => volume.nativeSnapshotInfo?.Phase === "Completed").length,
      csiVolumeSnapshotsAttempted: csi.length,
      csiVolumeSnapshotsCompleted: completed,
      backupItemOperationsAttempted: csi.length,
      backupItemOperationsCompleted: completed,
      backupItemOperationsFailed: csi.length - completed,
    }),
  };
}

// The metadata of the two backups the store is given, `velero-backup.json`: what the sync of the release
// reads to create a backup the cluster does not have. It creates what it reads, with the namespace, the
// storage location and the label of the location written over: the labels, the annotations, the spec and
// the status are kept, so each is a backup as the release leaves one that ended. A phase that ended, or
// the queue would take the backup and the controller would run it; an expiration that is ahead, or the
// garbage collection would ask its deletion; no label of a schedule, or a restore asked from that schedule
// would find a backup; and nothing the cluster gives an object, neither uid nor time of creation nor
// version.
//
// `like` is the real backup of the run as the cluster holds it: what the server fills in a backup it
// takes is copied from it, and the keys by which it narrows itself are left, so that the spec is the one
// of a backup of everything, taken where snapshots are taken, which names the snapshot location of that
// installation. `artifacts` is what the first backup holds: its status counts what its results, its list
// of the resources and its volumes say, and it failed in part, as a backup with an error in its results
// did. The second holds nothing, and completed: it is the same backup with a selector no object matched,
// which is the backup of no item the release writes. Both began four hundred days before the run and
// worked for fifty minutes, outside every window of the views.
//
// The annotation of the shape is a digest of the two and of their artifacts: the ones in place are the
// ones of today when they carry it.
export function syncedBackups(
  owner: string,
  run: string,
  started: number,
  like: KubeResource,
  artifacts: TabFacts,
): { synced: KubeResource; withoutLog: KubeResource } {
  const names = fixtureNames(run);
  const taken = {
    spec: like.spec as Record<string, unknown> | undefined,
    status: like.status as Record<string, unknown> | undefined,
  };

  requireCondition(owner, "Fixture ownership is required");
  requireCondition(Number.isFinite(started), "The time the fixtures were started is required");
  requireCondition(
    like.kind === "Backup" && like.metadata.name === names.backup && taken.status?.phase === "Completed",
    "The backup the server completed for this run is required: the synced backups are made like it",
  );
  requireCondition(
    artifacts.backup === names.syncedBackup &&
      artifacts.namespace === DEMO_NAMESPACE &&
      /^[a-f0-9]{64}$/.test(artifacts.digest),
    "The artifacts of the synced backup of this run are required",
  );
  // The times of the log and of the volumes are counted from the moment the artifacts were made for, and
  // the times of the status from this one: the work of the backup is one.
  requireCondition(
    artifacts.started === started,
    "The artifacts and the metadata of the synced backups are made for the same moment",
  );
  // The release writes a volume whose data was moved with the method of a CSI snapshot, in a backup that
  // moves the data of every volume, and counts no snapshot of them: the status below is not the one of
  // such a backup.
  requireCondition(
    artifacts.volumeInfo.value.every((volume) => !volume.snapshotDataMoved),
    "The volumes of the synced backup hold none whose data was moved",
  );
  const began = Math.floor((started - SYNCED_AGE) / 1000) * 1000;
  const time = (at: number) => new Date(at).toISOString().replace(".000Z", "Z");
  const backup = (name: string, held: Held, more: Record<string, unknown>) =>
    structuredClone({
      apiVersion: "velero.io/v1",
      kind: "Backup",
      metadata: {
        name,
        namespace: DEMO_NAMESPACE,
        labels: { [OWNER_LABEL]: owner, [FIXTURE_LABEL]: run, [FIXTURE_MODE]: "synced" },
        annotations: only(like.metadata.annotations, (key) => TAKEN_ANNOTATIONS.includes(key)),
      },
      spec: {
        ...only(taken.spec, (key) => !NARROWED_BY.includes(key)),
        includedNamespaces: ["*"],
        ...NEVER_COLLECTED,
        ttl: SYNCED_RETENTION,
        volumeSnapshotLocations: [SYNCED_SNAPSHOT_LOCATION],
        ...more,
      },
      status: {
        ...only(taken.status, (key) => TAKEN_STATUS.includes(key)),
        // The release counts the expiration from the moment it takes a backup, which is its start.
        expiration: time(began + Number.parseInt(SYNCED_RETENTION, 10) * 3_600_000),
        startTimestamp: time(began),
        completionTimestamp: time(began + SYNCED_WORK),
        ...countedStatus(held),
      },
    }) satisfies KubeResource;
  const made = {
    synced: backup(
      names.syncedBackup,
      {
        errors: artifacts.results.errors,
        warnings: artifacts.results.warnings,
        items: artifacts.resourceList.items,
        volumes: artifacts.volumeInfo.value,
      },
      {},
    ),
    withoutLog: backup(
      names.syncedBackupWithoutLog,
      { errors: 0, warnings: 0, items: 0, volumes: [] },
      { labelSelector: SYNCED_SELECTOR },
    ),
  };
  const shape = createHash("sha256")
    .update(JSON.stringify([made, artifacts.digest]))
    .digest("hex")
    .slice(0, 16);

  for (const resource of Object.values(made)) resource.metadata.annotations[SHAPE_ANNOTATION] = shape;
  return made;
}

// The keys by which a backup the store is given may differ from the real one. Of its spec: the ones by
// which the real backup narrows itself, what the release writes into a backup that names no filter, and
// the snapshot location of an installation that takes snapshots. Of its status: what the release counts of
// the work of one backup, each written when it is not zero.
const MAY_DIFFER: Record<"spec" | "status", string[]> = {
  spec: [...NARROWED_BY, ...Object.keys(NEVER_COLLECTED), "volumeSnapshotLocations"],
  status: [
    "errors",
    "warnings",
    "volumeSnapshotsAttempted",
    "volumeSnapshotsCompleted",
    "csiVolumeSnapshotsAttempted",
    "csiVolumeSnapshotsCompleted",
    "backupItemOperationsAttempted",
    "backupItemOperationsCompleted",
    "backupItemOperationsFailed",
  ],
};

// Where the metadata of a backup the store is given has not the keys of the backup the server took, outside
// the ones above: each key one of the two has alone, by its name and without its value. The metadata is
// written from what is known of the release, and the real backup is what the release wrote: a key it has
// and the metadata lacks is one the views show of every backup of this server but that one.
export function unlikeTheTakenBackup(like: KubeResource, metadata: KubeResource): string[] {
  return (["spec", "status"] as const).flatMap((part) => {
    const taken = Object.keys((like[part] as object | undefined) ?? {});
    const made = Object.keys((metadata[part] as object | undefined) ?? {});
    const alone = (keys: string[], other: string[]) =>
      keys.filter((key) => !other.includes(key) && !MAY_DIFFER[part].includes(key));

    return [
      ...alone(taken, made).map((key) => `${part}.${key} is in the backup the server took alone`),
      ...alone(made, taken).map((key) => `${part}.${key} is in the metadata alone`),
    ];
  });
}

// How often the cluster is read while the sync of the release is waited for, how long the wait goes on
// while no pass of the sync ends, and how many passes that ended say that the server creates nothing. A
// pass lists the store when it begins: the first one to end after the files were written may have listed
// it before them, and the one after it did not. The release looks at a location once a minute and passes
// when a minute went by since its last pass ended, which can be two minutes from one pass to the next.
const SYNC_POLL = 2000;
const SYNC_STALL = 300_000;
const SYNC_PASSES = 2;

type Store = NonNullable<FixtureRuntime["store"]>;

// How far a file the server wrote for a real operation of the fixtures is unpacked: the backup of the run
// is of thirteen items, and its log is far from this bound.
export const REAL_ARTIFACT_BOUND = 4 * 1024 ** 2;

// The text of a file the server wrote for a real operation, which the store holds in gzip: it is asked for,
// and is there, and unpacks within its bound, or the words say which of the three it is not.
function storedText(store: Store, what: string, path: string): string {
  const answer = store("GET", path);
  let unpacked: string | undefined;

  requireCondition(answer.code === 200, `The ${what} is not in the store, which answered ${answer.code}`);
  try {
    unpacked = gunzipSync(answer.bytes, { maxOutputLength: REAL_ARTIFACT_BOUND }).toString("utf8");
  } catch {
    unpacked = undefined;
  }
  requireCondition(unpacked !== undefined, `The ${what} is not a text in gzip of four mebibytes at most`);
  return unpacked;
}

// The length the store holds of a key, or nothing when it holds none: what every step that decides by what the
// store holds asks it, in this one way. Another answer than these two says neither, and nothing is concluded
// from it: the step stops, and its words say what is not known.
function heldLength(store: Store, path: string, unknown: string): number | undefined {
  const { code, headers } = store("HEAD", path);

  requireCondition(
    code === 200 || code === 404,
    `The store answered ${code} when it was asked whether it holds ${path}: ${unknown} is not known, and ` +
      "nothing is concluded from it. Run the command again.",
  );
  return code === 200 ? Number(headers["content-length"]?.[0]) : undefined;
}

// Gives the store one file of the tabs, and asks it the length it holds of it. The way that was found is the
// way of every file after it: no other is tried over a key. While none is found the ways are tried in their
// order, and the first the store keeps the file whole by is recorded. What is answered is whether the store
// kept the file, and what each way it did not keep it by met, were it kept by a later one.
function sendTabFile(
  store: Store,
  tabs: NonNullable<FixtureRuntime["tabs"]>,
  placement: TabPlacement,
  path: string,
  bytes: Uint8Array,
): { kept: boolean; met: string[] } {
  const met: string[] = [];
  const kept = (placement.way ? [placement.way] : STORE_WAYS).some((way) => {
    const answer = store("PUT", path, { bytes, way });
    const length = answer.code === 200 ? heldLength(store, path, "what it kept of the file it was given") : undefined;

    if (length !== bytes.length) {
      met.push(
        answer.code === 200
          ? `${way}: ${Number.isFinite(length) ? length : "no"} bytes kept of ${bytes.length}`
          : `${way}: answered ${answer.code}`,
      );
      return false;
    }
    if (!placement.way) {
      placement.way = way;
      tabs.keep(placement);
    }
    return true;
  });

  return { kept, met };
}

// Gives the store what the tabs of a backup read: the files of the two backups the sync of the release
// creates from them. It reads first. The backups of the installation: the real one, which the two are made
// like and without which nothing is stored, and the two themselves when they are there. The head of the log
// the server wrote for the real backup, which the log of the fixtures is written as. The keys of the real
// backup, which the metadata is to have. Then it records the placement, with the metadata as it is stored,
// and only then writes: for each backup its contents, its artifacts and its metadata last, since a pass of
// the sync takes a folder as it is once it finds the metadata there. The first file finds the way the
// store takes a body, and after each one the store is asked the length it holds.
//
// A second call finds what the first one did. With the two backups there, made as the fixtures of today
// make them, nothing is asked of the store. A placement that was interrupted is recorded as storing: it
// goes on, and writes the files the store does not hold with their length. Fixtures made otherwise than
// the ones in place stop it. Nothing here removes a key: what the store was given stays until the
// controller deletes the backup it belongs to, or the environment is taken down.
//
// What is answered: what the placement has reached, the keys this call wrote, the way the store takes a
// body, and what the ways that were tried before it met, when this call found it.
export function storeTabFixtures(
  runtime: FixtureRuntime,
  run: string,
  started: number,
  artifacts: ReturnType<typeof tabArtifacts> = tabArtifacts({
    backup: fixtureNames(run).syncedBackup,
    namespace: DEMO_NAMESPACE,
    started,
  }),
): { state: (typeof TAB_STATES)[number]; written: string[]; way?: StoreWay; met: string[] } {
  const names = fixtureNames(run);
  const { tabs } = runtime;
  const down = "take the environment down first, with `pnpm demo:down`";
  const placing = (state: string): state is (typeof TAB_STATES)[number] =>
    (TAB_STATES as readonly string[]).includes(state);

  requireCondition(
    runtime.store && tabs,
    "The fixtures of the tabs need the store of the environment, and where their placement is recorded",
  );
  const store = runtime.store.bind(runtime);
  const backups = (
    JSON.parse(runtime.kubectl(["get", "backups.velero.io", "--namespace", DEMO_NAMESPACE, "-o", "json"])) as {
      items: KubeResource[];
    }
  ).items;
  const named = (name: string) => backups.find((backup) => backup.metadata.name === name);
  const ofTheRun = (backup: KubeResource) =>
    backup.metadata.labels?.[OWNER_LABEL] === runtime.owner && backup.metadata.labels?.[FIXTURE_LABEL] === run;
  const like = named(names.backup);

  // The release deletes a backup that expired, and the two are made like the real one.
  requireCondition(
    like,
    `The backup ${names.backup} is not in ${DEMO_NAMESPACE}: the environment is older than its backup lasts. ` +
      "Create it again with `pnpm demo:down` and `pnpm demo:up`.",
  );
  requireCondition(ofTheRun(like), "Fixture ownership changed");
  const expected = tabExpectations(artifacts);
  const made = syncedBackups(runtime.owner, run, started, like, expected);
  const shape = made.synced.metadata.annotations?.[SHAPE_ANNOTATION] ?? "";
  const kept = tabs.read();
  const there = [names.syncedBackup, names.syncedBackupWithoutLog].flatMap((name) => named(name) ?? []);

  for (const backup of there) {
    requireCondition(
      kept && ofTheRun(backup) && backup.metadata.labels?.[FIXTURE_MODE] === "synced",
      `The backup ${backup.metadata.name} of ${DEMO_NAMESPACE} is not one this run is recorded to have stored: ${down}`,
    );
    requireCondition(
      backup.metadata.annotations?.[SHAPE_ANNOTATION] === shape,
      `The backup ${backup.metadata.name} is not made as the fixtures of today make it: ${down}`,
    );
  }
  if (kept) {
    const { state } = kept;

    requireCondition(
      placing(state),
      `The fixtures of the tabs are recorded as ${state}: a placement does not go on from there`,
    );
    // The digest of the two backups is of their artifacts as well.
    requireCondition(
      kept.shape === shape,
      `The fixtures of the tabs are not the ones this run began to store: ${down}`,
    );
    // Every file was written: what is left is of the server.
    if (state !== "storing") return { state, written: [], way: kept.way, met: [] };
    // So it was when the server made a backup of the second folder, whose metadata is the last file of all.
    if (there.length === 2) {
      tabs.keep({ ...kept, state: "stored" });
      return { state: "stored", written: [], way: kept.way, met: [] };
    }
  }
  const text = storedText(store, `log of the backup ${names.backup}`, fixtureArtifactPaths(run).backupLog);
  // The keys of an entry are told, and nothing an entry says: what is not a name is not repeated.
  const head = entryFields(text.split("\n", 1)[0]).map(([key]) => (/^[\w.@-]{1,40}$/.test(key) ? key : "(not a name)"));

  requireCondition(
    isDeepStrictEqual(head, [...ENTRY_KEYS]),
    `The log of the backup ${names.backup} begins with an entry of the keys ${head.join(", ") || "(none)"}, and ` +
      `the log of the fixtures is written with ${ENTRY_KEYS.join(", ")}: it would not be a log of this server`,
  );
  // The two are made of the same keys but for the ones that may differ: the first tells of both.
  const unlike = unlikeTheTakenBackup(like, made.synced);

  requireCondition(
    unlike.length === 0,
    `The metadata of ${made.synced.metadata.name} has not the keys of the backup the server took: ${unlike.join("; ")}`,
  );
  const placement: TabPlacement = kept ?? {
    state: "storing",
    artifacts: expected.digest,
    shape,
    metadata: { synced: JSON.stringify(made.synced), withoutLog: JSON.stringify(made.withoutLog) },
  };

  if (!kept) tabs.keep(placement);
  const paths = tabArtifactPaths(run);
  const synced: Record<keyof typeof paths.synced, Uint8Array> = {
    archive: emptyArchive(),
    log: gz(artifacts.log.text),
    results: gz(artifacts.results.text),
    resourceList: gz(artifacts.resourceList.text),
    volumeInfo: gz(artifacts.volumeInfo.text),
    metadata: Buffer.from(placement.metadata.synced),
  };
  const withoutLog: Record<keyof typeof paths.withoutLog, Uint8Array> = {
    archive: emptyArchive(),
    results: gz(artifacts.empty.results.text),
    resourceList: gz(artifacts.empty.resourceList.text),
    volumeInfo: gz(artifacts.empty.volumeInfo.text),
    metadata: Buffer.from(placement.metadata.withoutLog),
  };
  const files = [
    ...Object.entries(paths.synced).map(([file, path]) => [path, synced[file as keyof typeof synced]] as const),
    ...Object.entries(paths.withoutLog).map(
      ([file, path]) => [path, withoutLog[file as keyof typeof withoutLog]] as const,
    ),
  ];
  const written: string[] = [];
  const met: string[] = [];

  for (const [path, bytes] of files) {
    // A placement that goes on leaves the files the store holds with their length.
    if (kept && heldLength(store, path, "what it holds of the tabs") === bytes.length) continue;
    const sent = sendTabFile(store, tabs, placement, path, bytes);

    requireCondition(
      sent.kept,
      `The store did not keep ${path} (${sent.met.join("; ")}). What it holds of the tabs stays there, and ` +
        "nothing here removes a key: run the command again, or take the environment down with `pnpm demo:down`.",
    );
    met.push(...sent.met);
    written.push(path);
  }
  placement.state = "stored";
  tabs.keep(placement);
  return { state: "stored", written, way: placement.way, met };
}

// The command that cleans a fixture run: it has the server delete the backups it created for the tabs, with
// the files the store was given, whatever those backups say.
const CLEANUP = `\`node e2e/scripts/local-demo.mts fixtures-cleanup --context ${DEMO_CONTEXT}\``;

// What the server created of a backup the store was given is what was stored, or the fixture is refused:
// the labels of the run, which the sync keeps; the storage location it was found in, which the sync writes
// into the spec and into a label; the digest of the fixtures; every key of the spec as it was stored; and
// the whole status. The server writes a backup through its type: the spec it creates has keys the metadata
// does not, and a status of a key the type does not know, or of a counter of zero, comes back without it.
//
// What is refused is told with what stays and the way on. A backup that does not carry the labels of the
// run, or the one of its location, is one whose deletion the cleanup of the run does not ask: the way out is
// to take the environment down. Any other is deleted by the cleanup, which asks nothing of what a backup
// says. A key that differs is told by its name, and nothing of what it holds.
function assertSyncedAsStored(runtime: FixtureRuntime, run: string, stored: KubeResource, actual: KubeResource): void {
  const name = stored.metadata.name;
  const labels = actual.metadata.labels ?? {};
  const spec = { stored: (stored.spec ?? {}) as Record<string, unknown>, actual: (actual.spec ?? {}) as object };
  const changed = Object.keys(spec.stored).filter(
    (key) => !isDeepStrictEqual((spec.actual as Record<string, unknown>)[key], spec.stored[key]),
  );
  const status = {
    stored: (stored.status ?? {}) as Record<string, unknown>,
    actual: (actual.status ?? {}) as Record<string, unknown>,
  };
  const differs = [...new Set([...Object.keys(status.stored), ...Object.keys(status.actual)])].filter(
    (key) => !isDeepStrictEqual(status.actual[key], status.stored[key]),
  );
  const down =
    "It is left as it is, with the files the store was given: the way out is to take the environment down, " +
    "with `pnpm demo:down`.";
  const stays =
    "The two backups and the files the store was given for them are left as they are: clean the run with " +
    `${CLEANUP}, or take the environment down with \`pnpm demo:down\`.`;

  requireCondition(
    labels[OWNER_LABEL] === runtime.owner && labels[FIXTURE_LABEL] === run && labels[FIXTURE_MODE] === "synced",
    `The backup ${name} the server created does not carry the labels of this run. ${down}`,
  );
  requireCondition(
    labels["velero.io/storage-location"] === spec.stored.storageLocation,
    `The backup ${name} the server created is not of the storage location ${String(spec.stored.storageLocation)}. ${down}`,
  );
  requireCondition(
    actual.metadata.annotations?.[SHAPE_ANNOTATION] === stored.metadata.annotations?.[SHAPE_ANNOTATION],
    `The backup ${name} the server created does not say what it is made of. ${stays}`,
  );
  requireCondition(
    changed.length === 0,
    `The spec of the synced backup ${name} does not keep what was stored of ${changed.join(", ")}. ${stays}`,
  );
  requireCondition(
    differs.length === 0,
    `The status of the synced backup ${name} is not the one that was stored: it differs by ` +
      `${differs.join(", ")}. ${stays}`,
  );
}

// Reads the installation every two seconds until what it holds is what is waited for, or the sync of the
// release passed as many times as it is given, or no pass of it ended in five minutes. What is read is the
// storage location and the kinds that are asked for, and the bounds are of the time the runtime counts, not
// of the number of the reads: every read of the runner checks its target first. The passes are counted by
// the time the location says its last one ended at, which the release writes when a pass that listed the
// store ends, and at no other moment; the first read tells of no pass.
//
// What a pass did is in the cluster by the read after the one that saw the pass end: what is answered once
// the passes ended is that read. Of a wait in which no pass ended, what is answered says why in words,
// around the ones of what was waited for: with a location that is not available, which the sync passes
// over, or with one that is.
function awaitSync(
  runtime: FixtureRuntime,
  elapsed: () => number,
  location: string,
  kinds: string,
  found: (items: KubeResource[]) => boolean,
  ended: number,
): {
  items: KubeResource[];
  passes: number;
  stalled?: { words(waited: string): string; until: string };
} {
  let since = elapsed();
  let passes = 0;
  let last: string | undefined;

  for (let first = true; ; first = false) {
    const items = (
      JSON.parse(
        runtime.kubectl(
          ["get", `${kinds},backupstoragelocations.velero.io`, "--namespace", DEMO_NAMESPACE, "-o", "json"],
          undefined,
          undefined,
          false,
        ),
      ) as { items: KubeResource[] }
    ).items;

    if (found(items) || passes >= ended) return { items, passes };
    const status = items.find((item) => item.kind === "BackupStorageLocation" && item.metadata.name === location)
      ?.status as { phase?: string; lastSyncedTime?: string } | undefined;
    const now = elapsed();

    if (!first && status?.lastSyncedTime !== last) {
      passes += 1;
      since = now;
    }
    last = status?.lastSyncedTime;
    if (now - since >= SYNC_STALL) {
      const minutes = `${SYNC_STALL / 60_000} minutes`;
      const told = last ?? "no time it tells";

      return {
        items,
        passes,
        stalled:
          status?.phase === "Available"
            ? {
                words: (waited) =>
                  `No pass of the sync ended in ${minutes}, and ${waited}: the storage location ${location} is ` +
                  `Available and its last pass ended at ${told}.`,
                until: "the server syncs",
              }
            : {
                words: (waited) =>
                  `The storage location ${location} is ${status ? (status.phase ?? "in no phase") : "not there"}, ` +
                  `and the sync passes over a location that is not Available: no pass ended in ${minutes}, and ` +
                  `${waited}.`,
                until: "the location is Available",
              },
      };
    }
    pause(runtime, SYNC_POLL);
  }
}

// Waits until the sync of the release created the two backups from what the store was given, and reads them
// back against what was stored.
//
// It ends, with words of its own each time: when the two backups are there; when two passes ended after
// the files were stored and a backup is not there, which is a server that read the store and created
// nothing; and when no pass ended in five minutes, with a location that is not available, which the sync
// passes over, or with one that is.
//
// A backup that is not there is not always one the server did not create. One that was deleted through the
// server went with its files: before anything is said of what the server did, the store is asked whether it
// holds the metadata of each backup that is not there, and a backup whose metadata is gone is told as that,
// with the way on, which is to clean the run. Of a placement that was recorded as synced, the two backups
// were there: the store is asked at the first read that misses one, and nothing is waited for.
export function awaitTabFixtures(
  runtime: FixtureRuntime,
  run: string,
): { synced: KubeResource; withoutLog: KubeResource; passes: number; waited: number } {
  const names = fixtureNames(run);
  const { tabs } = runtime;

  requireCondition(
    runtime.store && tabs && runtime.elapsed,
    "The wait for the backups of the tabs needs the store of the environment, the clock of the runtime, and " +
      "where their placement is recorded",
  );
  const store = runtime.store.bind(runtime);
  const elapsed = runtime.elapsed.bind(runtime);
  const placement = tabs.read();

  requireCondition(
    placement && (placement.state === "stored" || placement.state === "synced"),
    "The files of the tabs are not all in the store: the server is not waited for",
  );
  const stored = [
    [names.syncedBackup, JSON.parse(placement.metadata.synced) as KubeResource],
    [names.syncedBackupWithoutLog, JSON.parse(placement.metadata.withoutLog) as KubeResource],
  ] as const;
  // The location the real backup is in, which the metadata of both was made with.
  const location = (stored[0][1].spec as { storageLocation?: string } | undefined)?.storageLocation;

  requireCondition(
    location && stored.every(([name, backup]) => (backup.metadata as { name?: string } | undefined)?.name === name),
    "The metadata that is recorded is not the one of the two backups of this run",
  );
  const began = elapsed();
  const backups = (items: KubeResource[]) =>
    stored.flatMap(([name]) => items.find((item) => item.kind === "Backup" && item.metadata.name === name) ?? []);
  const absent = (there: KubeResource[]) =>
    stored.map(([name]) => name).filter((name) => !there.some((backup) => backup.metadata.name === name));
  const paths = tabArtifactPaths(run);
  const metadata = {
    [names.syncedBackup]: paths.synced.metadata,
    [names.syncedBackupWithoutLog]: paths.withoutLog.metadata,
  };
  // The backups that are not there and whose metadata the store does not hold either stop the wait.
  const refuseDeleted = (missing: string[]) => {
    const gone = missing.filter(
      (name) => heldLength(store, metadata[name], `what became of the backup ${name}`) === undefined,
    );

    requireCondition(
      gone.length === 0,
      `${gone.join(" and ")} ${gone.length > 1 ? "are" : "is"} not in ${DEMO_NAMESPACE}, and the store does not ` +
        `hold the metadata the server makes ${gone.length > 1 ? "them" : "it"} from: a backup the server deleted ` +
        `goes with its files. The fixtures of the tabs are not whole any more: clean the run with ${CLEANUP}, ` +
        "and make a new one with `pnpm demo:up`.",
    );
  };
  // What was recorded as synced was there: of that record the store is asked at the first read.
  let asked = placement.state !== "synced";
  const { items, passes, stalled } = awaitSync(
    runtime,
    elapsed,
    location,
    "backups.velero.io",
    (read) => {
      const there = backups(read);

      if (!asked && there.length < stored.length) refuseDeleted(absent(there));
      asked = true;
      return there.length === stored.length;
    },
    SYNC_PASSES,
  );
  const found = backups(items);

  if (found.length < stored.length) {
    const missing = absent(found);
    const waited = `${missing.join(" and ")} ${missing.length > 1 ? "are" : "is"} not in ${DEMO_NAMESPACE}`;

    refuseDeleted(missing);
    const left = `What the store was given is left in it, under ${missing.map((name) => `/${BUCKET}/backups/${name}/`).join(" and ")}`;

    throw new Error(
      stalled
        ? `${stalled.words(waited)} ${left}: run the command again once ${stalled.until}.`
        : `${passes} passes of the sync ended after the files of the tabs were stored, and ${waited}: the server ` +
            `read the store and created no backup from it. ${left}, and nothing here removes a key: the way out is ` +
            "to take the environment down, with `pnpm demo:down`.",
    );
  }
  stored.forEach(([, backup], index) => {
    assertSyncedAsStored(runtime, run, backup, found[index]);
  });
  if (placement.state !== "synced") tabs.keep({ ...placement, state: "synced" });
  return { synced: found[0], withoutLog: found[1], passes, waited: elapsed() - began };
}

// The operations the server refuses. A backup and a restore that name both kinds of selector fail their
// validation, and nothing of them is written into the store, while the backup of the restore and the
// storage location of both are valid: a URL is signed for their artifacts, and the store has no such
// file. A restore asked from a schedule that has no backup fails its validation without the name of a
// backup: no URL is signed for it at all.
export function refusedFixtures(
  owner: string,
  run: string,
): { backup: KubeResource; restore: KubeResource; orphan: KubeResource } {
  const names = fixtureNames(run);
  const labels = { [OWNER_LABEL]: owner, [FIXTURE_LABEL]: run, [FIXTURE_MODE]: "live" };
  const selectors = {
    labelSelector: { matchLabels: { [FIXTURE_LABEL]: run } },
    orLabelSelectors: [{ matchLabels: { [FIXTURE_LABEL]: run } }],
  };

  requireCondition(owner, "Fixture ownership is required");
  return {
    backup: {
      apiVersion: "velero.io/v1",
      kind: "Backup",
      metadata: { name: names.invalidBackup, namespace: DEMO_NAMESPACE, labels },
      spec: {
        includedNamespaces: [names.source],
        includedResources: ["configmaps"],
        ...selectors,
        includeClusterResources: false,
        storageLocation: "default",
        snapshotVolumes: false,
        defaultVolumesToFsBackup: false,
        ttl: LIVE_RETENTION,
      },
    },
    restore: {
      apiVersion: "velero.io/v1",
      kind: "Restore",
      metadata: { name: names.invalidRestore, namespace: DEMO_NAMESPACE, labels },
      spec: {
        backupName: names.backup,
        includedNamespaces: [names.source],
        includedResources: ["configmaps"],
        ...selectors,
        namespaceMapping: { [names.source]: names.restored },
        includeClusterResources: false,
        restorePVs: false,
        existingResourcePolicy: "none",
      },
    },
    orphan: {
      apiVersion: "velero.io/v1",
      kind: "Restore",
      metadata: { name: names.orphanRestore, namespace: DEMO_NAMESPACE, labels },
      spec: {
        scheduleName: names.emptySchedule,
        includedNamespaces: [names.source],
        includedResources: ["configmaps"],
        namespaceMapping: { [names.source]: names.restored },
        includeClusterResources: false,
        restorePVs: false,
        existingResourcePolicy: "none",
      },
    },
  };
}

// The identities of the transport proof. Three may do what a download asks of the cluster up to one step,
// and are refused at the next: the reader at the creation of the request; the requester at the read of the
// Secret a location refers to, and at the read of the Service of the store; the router at the port-forward,
// for which it has the verb create alone. The downloader has what the documentation lists for a download
// through the cluster, and downloads. Each is an account of the namespace of the installation, of this
// run, with a role of that namespace.
export function proofIdentities(
  owner: string,
  run: string,
): Record<"reader" | "requester" | "router" | "downloader", KubeResource[]> {
  const labels = { [OWNER_LABEL]: owner, [FIXTURE_LABEL]: run, [FIXTURE_MODE]: "live" };
  // What a download reads of Velero before it creates its request.
  const reads = {
    apiGroups: ["velero.io"],
    resources: ["backups", "restores", "backupstoragelocations"],
    verbs: ["get"],
  };
  const requests = { apiGroups: ["velero.io"], resources: ["downloadrequests"], verbs: ["create", "get"] };
  // What the route through the cluster reads: the Service of the store, its endpoint slices and its Pod.
  const route = [
    { apiGroups: [""], resources: ["services", "pods"], verbs: ["get"] },
    { apiGroups: ["discovery.k8s.io"], resources: ["endpointslices"], verbs: ["list"] },
  ];
  const identity = (role: string, rules: unknown[]): KubeResource[] => {
    const name = `proof-${role}-${run}`;
    const metadata = { name, namespace: DEMO_NAMESPACE, labels };

    return [
      { apiVersion: "v1", kind: "ServiceAccount", metadata, automountServiceAccountToken: false },
      { apiVersion: "rbac.authorization.k8s.io/v1", kind: "Role", metadata, rules },
      {
        apiVersion: "rbac.authorization.k8s.io/v1",
        kind: "RoleBinding",
        metadata,
        roleRef: { apiGroup: "rbac.authorization.k8s.io", kind: "Role", name },
        subjects: [{ kind: "ServiceAccount", name, namespace: DEMO_NAMESPACE }],
      },
    ];
  };

  requireCondition(owner, "Fixture ownership is required");
  fixtureNames(run);
  return {
    reader: identity("reader", [reads]),
    requester: identity("requester", [reads, requests]),
    // A port-forward over a WebSocket is asked of the API server with the verb get; the releases that
    // check the verb create for it as well ask for both. The verb create alone, which is what the older
    // protocol asks with, is refused.
    router: identity("router", [
      reads,
      requests,
      ...route,
      { apiGroups: [""], resources: ["pods/portforward"], verbs: ["create"] },
    ]),
    downloader: identity("downloader", [
      reads,
      requests,
      ...route,
      { apiGroups: [""], resources: ["pods/portforward"], verbs: ["get", "create"] },
    ]),
  };
}

// What the release writes when it refuses each of them, as the controller of each says it.
export const REFUSALS = {
  backup: "encountered labelSelector as well as orLabelSelectors in backup spec, only one can be specified",
  restore: "encountered labelSelector as well as orLabelSelectors in restore spec, only one can be specified",
  orphan: "No backups found for schedule",
} as const;

// The phases an operation is in before its controller validates it: a restore is new, and a backup of this
// release goes through its queue first.
const BEFORE_VALIDATION = ["", "New", "Queued", "ReadyToStart"];

// Whether the server refused an operation for the reason the operation was made for. One its controller
// has not validated yet is not refused yet; one in any other phase, or refused for another reason, is not
// the fixture it was made to be.
export function isRefused(
  kind: string,
  status: { phase?: string; validationErrors?: string[] } | undefined,
  reason: string,
): boolean {
  if (status?.phase === "FailedValidation") {
    requireCondition(
      status.validationErrors?.includes(reason),
      `Refused ${kind} failed its validation for another reason`,
    );
    return true;
  }
  requireCondition(
    BEFORE_VALIDATION.includes(status?.phase ?? ""),
    `Refused ${kind} is ${status?.phase} where it was expected to fail its validation`,
  );
  return false;
}

// How long the server is given to refuse the operations it was asked, and how often the cluster is read
// meanwhile.
const REFUSAL_TIMEOUT = 120_000;
const REFUSAL_POLL = 1000;

// Places the three operations the server refuses in the namespace of the installation, and waits until the
// server refused each for the reason it is made for. It reads the backups and the restores of the
// installation first, and applies only what is not there: a second call finds the three and changes
// nothing. The real backup of the run is there as the server completed it, or nothing is applied: the
// restore that is refused for its selectors is asked of it, and of a backup that is valid. An operation
// that is there is of this run, and is refused for its reason or not validated yet: one in any other phase,
// or refused for another reason, stops the call before anything is applied.
//
// The wait is bounded by the time the runtime counts, not by the number of its reads: every read of the
// runner checks its target first. What it answers is each object as the cluster holds it, the names this
// call applied, and how long the server took.
export function placeRefusedFixtures(
  runtime: FixtureRuntime,
  run: string,
): { backup: KubeResource; restore: KubeResource; orphan: KubeResource; applied: string[]; waited: number } {
  const names = fixtureNames(run);
  const manifests = refusedFixtures(runtime.owner, run);
  const wanted = (["backup", "restore", "orphan"] as const).map((which) => ({
    manifest: manifests[which],
    reason: REFUSALS[which],
  }));

  requireCondition(runtime.elapsed, "The wait for the operations the server refuses needs the clock of the runtime");
  const elapsed = runtime.elapsed.bind(runtime);
  const ofTheRun = (resource: KubeResource) =>
    resource.metadata.labels?.[OWNER_LABEL] === runtime.owner && resource.metadata.labels?.[FIXTURE_LABEL] === run;
  const listed = () =>
    (
      JSON.parse(
        runtime.kubectl(["get", "backups.velero.io,restores.velero.io", "--namespace", DEMO_NAMESPACE, "-o", "json"]),
      ) as { items: KubeResource[] }
    ).items;
  // What the cluster holds of each of the three, and whether the server refused it.
  const read = (items: KubeResource[]) =>
    wanted.map(({ manifest, reason }) => {
      const found = items.find((item) => item.kind === manifest.kind && item.metadata.name === manifest.metadata.name);

      requireCondition(!found || ofTheRun(found), "Fixture ownership changed");
      return {
        manifest,
        found,
        refused: isRefused(manifest.kind, found?.status as Parameters<typeof isRefused>[1], reason),
      };
    });
  const before = listed();
  const real = before.find((item) => item.kind === "Backup" && item.metadata.name === names.backup);

  requireCondition(
    real && ofTheRun(real) && (real.status as { phase?: string } | undefined)?.phase === "Completed",
    `The backup ${names.backup} of this run is not in ${DEMO_NAMESPACE} as the server completed it, and the ` +
      "restore that is refused for its selectors is asked of it. Create the environment again with " +
      "`pnpm demo:down` and `pnpm demo:up`.",
  );
  let state = read(before);
  const applied: string[] = [];

  for (const { manifest, found } of state) {
    if (found) continue;
    runtime.apply(manifest);
    applied.push(manifest.metadata.name);
  }
  const began = elapsed();

  if (applied.length > 0) state = read(listed());
  for (; state.some(({ refused }) => !refused); state = read(listed())) {
    const waiting = state
      .filter(({ refused }) => !refused)
      .map(({ manifest, found }) => {
        const phase = (found?.status as { phase?: string } | undefined)?.phase;

        return (
          `the ${manifest.kind.toLowerCase()} ${manifest.metadata.name} ` +
          (found ? (phase ? `is ${phase}` : "has no phase") : "is not there")
        );
      });

    requireCondition(
      elapsed() - began < REFUSAL_TIMEOUT,
      `The server did not refuse in ${REFUSAL_TIMEOUT / 60_000} minutes what it was asked to: ${waiting.join(", ")}. ` +
        `What was applied is left in ${DEMO_NAMESPACE}, of this run: run the command again once the server ` +
        "validates it.",
    );
    pause(runtime, REFUSAL_POLL);
  }
  const [backup, restore, orphan] = state.flatMap(({ found }) => found ?? []);

  // The restore of a schedule without a backup carries no name of a backup: the server found none.
  requireCondition(
    !(orphan.spec as { backupName?: string }).backupName,
    "The restore of a schedule without a backup names a backup",
  );
  return { backup, restore, orphan, applied, waited: elapsed() - began };
}

// The fixtures of the views and of the tabs, in the order that costs a run the least. The files of the tabs
// go to the store first: the server takes a minute or two to create its backups of them, and the other
// fixtures are placed meanwhile, the objects of the views and then the operations the server refuses, which
// it validates in seconds. The wait for the backups of the store comes last. A second call finds everything:
// it asks the store nothing, applies nothing, and has nothing to wait for.
export function placeViewAndTabFixtures(
  runtime: FixtureRuntime,
  run: string,
  started: number,
  now: number,
  artifacts?: ReturnType<typeof tabArtifacts>,
): {
  stored: ReturnType<typeof storeTabFixtures>;
  views: ReturnType<typeof createViewFixtures>;
  refused: ReturnType<typeof placeRefusedFixtures>;
  synced: ReturnType<typeof awaitTabFixtures>;
} {
  const stored = storeTabFixtures(runtime, run, started, artifacts);
  const views = createViewFixtures(runtime, run, started, now);
  const refused = placeRefusedFixtures(runtime, run);
  const synced = awaitTabFixtures(runtime, run);

  return { stored, views, refused, synced };
}

// What the journal of the runner keeps of an object: what it is, and the identity the cluster gave it.
export interface Recorded {
  apiVersion: string;
  kind: string;
  name: string;
  namespace?: string;
  uid?: string;
}

// Enters in the journal the two backups the server created from the store, each with the identity the
// cluster gave it: the scripts did not create them, and the journal is where a backup of the fixtures is
// found by. The server creates a backup again when a pass of its sync removed it for a folder that pass did
// not list: its entry then takes the new identity, and what is answered is the names it changed for.
export function recordSyncedBackups(
  entries: Recorded[],
  run: string,
  created: { synced: KubeResource; withoutLog: KubeResource },
): string[] {
  const names = fixtureNames(run);
  const again: string[] = [];

  for (const [name, backup] of [
    [names.syncedBackup, created.synced],
    [names.syncedBackupWithoutLog, created.withoutLog],
  ] as const) {
    const { uid } = backup.metadata;

    requireCondition(
      backup.kind === "Backup" && backup.metadata.name === name && backup.metadata.namespace === DEMO_NAMESPACE && uid,
      `The backup ${name} the server created is entered in the journal with the identity the cluster gave it`,
    );
    const entry = entries.find(
      (item) => item.kind === "Backup" && item.name === name && item.namespace === DEMO_NAMESPACE,
    );

    if (!entry) {
      entries.push({ apiVersion: backup.apiVersion, kind: "Backup", name, namespace: DEMO_NAMESPACE, uid });
    } else if (entry.uid !== uid) {
      again.push(name);
      entry.uid = uid;
    }
  }
  return again;
}

// What the runner says of a placement of the fixtures of the views and of the tabs, a line each: the objects of
// the views and the ones placed by the clock, the files of the tabs and the backups the server created of
// them, the ones it created again since the journal was written, and the operations it refused.
//
// Each says what this call did, and nothing it did not. The files are told as written when this call wrote
// them, with the way they were sent, and as none when it wrote none. The time of the wait for the two backups
// is the one of the wait itself, which begins once the fixtures of the views and the refused operations were
// placed: the server may have created the backups meanwhile, and the wait then takes no time. The refused
// operations are told as placed when this call applied them, and as found refused when it applied none.
export function placementWords(
  names: ReturnType<typeof fixtureNames>,
  placed: ReturnType<typeof placeViewAndTabFixtures>,
  recreated: string[],
): string[] {
  const { views, stored, synced, refused } = placed;
  const counted = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;
  const seconds = (milliseconds: number) => counted(Math.round(milliseconds / 1000), "second");
  const written = stored.written.length
    ? `${counted(stored.written.length, "file")} written by this run, ${stored.written.length === 1 ? "sent" : "each sent"} as ${stored.way}${stored.met.length ? `, which the store took after ${stored.met.join("; ")}` : ""}`
    : "none written by this run";

  return [
    `PASS: ${views.views} objects of the views in ${names.views} and ${names.defaults}, ${views.overview} of the Overview in ${names.overview}, and ${views.scale} backups and ${views.restores} restores of the long lists in ${names.scale}, are in place, outside the reach of the controllers.`,
    ...(views.again.length
      ? [`NOTE: the fixtures that are placed by the clock were put in place again in ${views.again.join(" and ")}.`]
      : []),
    `PASS: the store holds the files of the tabs (${written}), and the server created ${names.syncedBackup} and ${names.syncedBackupWithoutLog} from them as they were stored: once the fixtures of the views and the refused operations were placed, the wait for the two took ${seconds(synced.waited)}${synced.passes ? `, in which ${counted(synced.passes, "pass", "passes")} of its sync ended without both` : ""}.`,
    ...(recreated.length
      ? [
          `NOTE: the server created ${recreated.join(" and ")} again since the journal was written: the journal has the new identity.`,
        ]
      : []),
    `PASS: the server refused ${names.invalidBackup}, ${names.invalidRestore} and ${names.orphanRestore} for the reasons they are made for (${refused.applied.length ? `${refused.applied.length} placed by this run, refused after ${seconds(refused.waited)}` : "none placed by this run, each found refused"}).`,
  ];
}

// The kinds a read of Velero is asked through, and what is read of each request to tell it: its kind, its
// namespace, its name, and of its status the time it expires at and nothing else, since the status of a
// request that was processed holds a signed URL. The last word of the answer is the kind of what was read,
// which is a list.
const REQUEST_KINDS = ["DownloadRequest", "ServerStatusRequest", "DeleteBackupRequest"];
const REQUESTS_QUERY =
  '{range .items[*]}{.kind}{"\\t"}{.metadata.namespace}{"\\t"}{.metadata.name}{"\\t"}{.status.expiration}{"\\n"}{end}{.kind}';
// How long the server is given to remove the requests of its namespace, and how often they are read
// meanwhile. It removes a download request at its pass after the ten minutes the request lasts, and it
// passes every minute; a request for its status goes sooner.
const REQUESTS_TIMEOUT = 720_000;
const REQUESTS_POLL = 5000;

// The requests to Velero the cluster holds, in every namespace, read with the output withheld: each by its
// kind, its namespace and its name, with the time it expires at when it tells one.
function readRequests(runtime: FixtureRuntime) {
  const lines = runtime
    .kubectl(
      [
        "get",
        REQUEST_KINDS.map((kind) => `${kind.toLowerCase()}s.velero.io`).join(","),
        "--all-namespaces",
        "-o",
        `jsonpath=${REQUESTS_QUERY}`,
      ],
      undefined,
      undefined,
      false,
    )
    .split("\n");
  const requests = lines.slice(0, -1).map((line) => {
    const [kind, namespace, name, expiration, ...more] = line.split("\t");

    return { kind, namespace, name, expiration, valid: more.length === 0 };
  });

  // What was read is told by its names alone, and only once they are known to be names.
  requireCondition(
    lines.at(-1) === "List" &&
      requests.every(
        ({ kind, namespace, name, expiration, valid }) =>
          valid &&
          REQUEST_KINDS.includes(kind) &&
          [namespace, name].every((part) => /^[a-z0-9]([-a-z0-9.]{0,251}[a-z0-9])?$/.test(part ?? "")) &&
          expiration !== undefined,
      ),
    "The requests to Velero were not read as a list of their kind, their namespace, their name and their expiration",
  );
  return requests.map(({ kind, namespace, name, expiration }) => {
    const dated = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(expiration);

    return {
      kind,
      namespace,
      told: `${kind} ${namespace}/${name}`,
      dated,
      expires: dated ? `expires at ${expiration}` : "tells no expiration",
    };
  });
}

// How long a download request the server looks at is without the time it expires at: the server writes that
// time at its first look, before anything else, and looks every minute at the requests that have none.
const REQUESTS_UNSEEN = 60_000;

// Waits until the server removed the requests of its namespace that are waited for, which `left` reads
// again every five seconds. The wait is bounded by the time the runtime counts: twelve minutes for the
// requests to be gone, and a minute for a request for a download to tell when it expires, counted for each
// from the read that first found it without that time. One that tells none by then is one the server did
// not look at, which it never removes: the wait stops on it without the twelve minutes. `why` is what the
// words of a stop end with: why no request is to be left, and the way out.
function awaitServed(
  runtime: FixtureRuntime,
  elapsed: () => number,
  first: ReturnType<typeof readRequests>,
  left: () => ReturnType<typeof readRequests>,
  why: string,
): number {
  const told = (requests: ReturnType<typeof readRequests>) =>
    requests.map((request) => `${request.told} (${request.expires})`).join(", ");
  const minutes = `${REQUESTS_TIMEOUT / 60_000} minutes`;
  const began = elapsed();
  // When each request for a download that tells no expiration was first read so.
  const found = new Map<string, number>();

  for (let waited = first; waited.length > 0; waited = left()) {
    const now = elapsed();
    const undated = waited.filter(({ kind, dated }) => kind === "DownloadRequest" && !dated);

    for (const request of undated) if (!found.has(request.told)) found.set(request.told, now);
    const unseen = undated.filter((request) => now - (found.get(request.told) ?? now) >= REQUESTS_UNSEEN);

    requireCondition(
      unseen.length === 0,
      `The server did not look at ${unseen.map((request) => request.told).join(", ")} in a minute: it writes when ` +
        `a request for a download expires at its first look, and removes none it did not look at. ${why}`,
    );
    requireCondition(
      now - began < REQUESTS_TIMEOUT,
      `The server did not remove in ${minutes} what was asked of it in ${DEMO_NAMESPACE}: ${told(waited)}. ${why}`,
    );
    pause(runtime, REQUESTS_POLL);
  }
  return elapsed() - began;
}

// Before the suites start: every suite expects no request to Velero in the cluster, and what an earlier
// suite, or a review by hand, asked the extension for may still be there. The requests of the cluster are
// read, with the output withheld, and the ones of the namespace of the installation and of the namespaces
// the views are looked at in are told.
//
// A request in the namespace of the installation is waited for: the server removes it. The wait says what it
// waits for when it begins, and stops with the names that are left when it ends without them gone, or on a
// request for a download the server did not look at in a minute. A request to delete a backup that the server
// ended with an error is one it removes a day after it was made: it is read whole, as the cleanup reads one,
// since it holds no URL, and the wait stops on it at once, by its name, before it waits and at every read. A
// request in a namespace no server reads never goes, and is not waited for: it is told in a warning, and does
// not stop the run, since the suites that ask the extension for a request there are the ones that remove it.
// Nothing here removes a request.
export function awaitRequestsRemoved(
  runtime: FixtureRuntime,
  run: string,
  say: (line: string) => void,
): { waited: number; removed: string[]; unserved: string[] } {
  const names = fixtureNames(run);
  const unread = [names.static, names.views, names.defaults, names.overview, names.scale];

  requireCondition(runtime.elapsed, "The wait for the requests to Velero needs the clock of the runtime");
  const elapsed = runtime.elapsed.bind(runtime);
  const down =
    "The suites expect no request to Velero when they start, and nothing here removes one: the way out is to " +
    "take the environment down, with `pnpm demo:down`.";
  // The requests to delete a backup of the namespace of the installation are read, when one is there, and the
  // one the server ended with an error stops the wait.
  const unended = (requests: ReturnType<typeof readRequests>) => {
    if (!requests.some(({ kind }) => kind === "DeleteBackupRequest")) return requests;
    const failed = (
      JSON.parse(
        runtime.kubectl(["get", "deletebackuprequests.velero.io", "--namespace", DEMO_NAMESPACE, "-o", "json"]),
      ) as { items: KubeResource[] }
    ).items
      .filter((item) => {
        const status = item.status as { phase?: string; errors?: string[] } | undefined;

        return status?.phase === "Processed" && (status.errors?.length ?? 0) > 0;
      })
      .map((item) => `DeleteBackupRequest ${DEMO_NAMESPACE}/${item.metadata.name}`);

    requireCondition(
      failed.length === 0,
      `The server ended ${failed.join(", ")} with an error, which the private log of the operations holds: it ` +
        `removes such a request a day after it was made. ${down}`,
    );
    return requests;
  };
  const served = () => unended(readRequests(runtime).filter(({ namespace }) => namespace === DEMO_NAMESPACE));
  const first = readRequests(runtime);
  const unserved = first.filter(({ namespace }) => unread.includes(namespace)).map(({ told }) => told);
  const waitedFor = first.filter(({ namespace }) => namespace === DEMO_NAMESPACE);

  if (unserved.length > 0) {
    say(
      `WARNING: no server reads the namespace of ${unserved.join(", ")}, and nothing removes a request there ` +
        "but the suite that asked the extension for it: the suites that expect no request to Velero when they " +
        "start fail in their last case while one is there. What stays goes with the environment, with " +
        "`pnpm demo:down`.",
    );
  }
  if (waitedFor.length === 0) return { waited: 0, removed: [], unserved };
  unended(waitedFor);
  say(
    `NOTE: waiting for the server to remove what was asked of it in ${DEMO_NAMESPACE}, ` +
      `${REQUESTS_TIMEOUT / 60_000} minutes at most: ` +
      `${waitedFor.map(({ told, expires }) => `${told} (${expires})`).join(", ")}. The suites expect no ` +
      "request to Velero when they start, and nothing here removes one.",
  );
  const waited = awaitServed(runtime, elapsed, waitedFor, served, down);

  say(`NOTE: the server removed what was waited for after ${Math.round(waited / 1000)} seconds.`);
  return { waited, removed: waitedFor.map(({ told }) => told), unserved };
}

// Before a cleanup removes anything: a run that is cleaned leaves no request to Velero behind, and what a
// suite that was stopped, or a review by hand, asked the extension for may still be in the cluster. Those
// requests are not of the run, and nothing here removes one. They are read as the wait before the suites
// reads them, with the output withheld.
//
// One in a namespace of the fixtures never goes, since no server reads it, and the cleanup removes no
// namespace that holds an object that is not of the run: the cleanup stops on it, by its name, before it
// removed anything. In the namespace of the installation the server removes a request for a download once
// it expired, and one for its status sooner: those are waited for, twelve minutes at most. A request for a
// download that tells no expiration a minute after it was first read is one the server did not look at,
// which it never removes: the wait stops on it. The requests to delete a backup are left to the removal of
// the backups: the server removes the ones of a backup with it.
export function awaitRequestsBeforeCleanup(
  runtime: FixtureRuntime,
  run: string,
  say: (line: string) => void,
): { waited: number; removed: string[] } {
  const unread = fixtureNamespaces(run);
  const down = "nothing here removes a request: the way out is to take the environment down, with `pnpm demo:down`";

  requireCondition(runtime.elapsed, "The wait for the requests to Velero needs the clock of the runtime");
  const elapsed = runtime.elapsed.bind(runtime);
  const read = () => {
    const requests = readRequests(runtime);
    const unserved = requests.filter(({ namespace }) => unread.includes(namespace));

    requireCondition(
      unserved.length === 0,
      `No server reads the namespace of ${unserved.map(({ told }) => told).join(", ")}, so nothing removes ` +
        `${unserved.length > 1 ? "them" : "it"} but who asked the extension for ${unserved.length > 1 ? "them" : "it"}, ` +
        "and a cleanup removes no namespace of the fixtures that holds an object that is not of the run. Nothing " +
        `was removed, and ${down}.`,
    );
    return requests.filter(({ kind, namespace }) => namespace === DEMO_NAMESPACE && kind !== "DeleteBackupRequest");
  };
  const first = read();

  if (first.length === 0) return { waited: 0, removed: [] };
  say(
    `NOTE: waiting for the server to remove what was asked of it in ${DEMO_NAMESPACE}, ` +
      `${REQUESTS_TIMEOUT / 60_000} minutes at most: ` +
      `${first.map((request) => `${request.told} (${request.expires})`).join(", ")}. A run that is cleaned leaves ` +
      "no request to Velero behind, and nothing here removes one.",
  );
  const waited = awaitServed(
    runtime,
    elapsed,
    first,
    read,
    `A run that is cleaned leaves no request to Velero behind, and ${down}.`,
  );

  say(`NOTE: the server removed what was waited for after ${Math.round(waited / 1000)} seconds.`);
  return { waited, removed: first.map((request) => request.told) };
}

// What the suites of the tabs are told, as plain data: nothing a suite expects of a tab is copied from the
// extension. Of the two backups the store was given, what the generators say of their artifacts. Of the
// real backup and of the real restore, what a plain count finds, at this moment, in the files the server
// wrote for them: in each log its lines, its bytes, its digest, the lines of each level, and two texts, the
// one the release writes once when the work ends and the field every entry carries; in the results, the
// entries by where the release files them; in the list of the resources, the resources and the items, and
// for a restore the items of each action; in the volume information, the volumes. And of every operation
// of the tabs, its status as the cluster holds it.
//
// The artifacts are read with what the client of the store may ask, and the facts are of a disposable
// cluster and of synthetic objects: no credential and no URL is among them.
export function tabFixtureFacts(runtime: FixtureRuntime, run: string, expected: ReturnType<typeof tabExpectations>) {
  const names = fixtureNames(run);
  const { tabs } = runtime;

  requireCondition(
    runtime.store && tabs,
    "What the suites are told of the tabs needs the store of the environment, and where the placement of the tabs is recorded",
  );
  const store = runtime.store.bind(runtime);
  const placement = tabs.read();

  // What a suite expects of the synced backup is what the store holds of it.
  requireCondition(
    placement?.state === "synced" && placement.artifacts === expected.digest && expected.backup === names.syncedBackup,
    "The suites are told of the artifacts the store was given for this run, once the server created its backups of them",
  );
  const items = (
    JSON.parse(
      runtime.kubectl(["get", "backups.velero.io,restores.velero.io", "--namespace", DEMO_NAMESPACE, "-o", "json"]),
    ) as { items: KubeResource[] }
  ).items;
  const status = (kind: "Backup" | "Restore", name: string) => {
    const found = items.find((item) => item.kind === kind && item.metadata.name === name);

    requireCondition(
      found?.metadata.labels?.[OWNER_LABEL] === runtime.owner && found.metadata.labels?.[FIXTURE_LABEL] === run,
      `The ${kind.toLowerCase()} ${name} of this run is not in ${DEMO_NAMESPACE}, where the tabs read it: the ` +
        "suites are told nothing, and what is left of the fixtures stays as it is. Clean the run with " +
        `${CLEANUP} and make a new one with \`pnpm demo:up\`, or take the environment down with ` +
        "`pnpm demo:down`.",
    );
    return (found.status ?? {}) as Record<string, unknown>;
  };
  // Every operation of the tabs is in the installation before a file of one of them is asked for.
  const held = {
    synced: status("Backup", names.syncedBackup),
    withoutLog: status("Backup", names.syncedBackupWithoutLog),
    backup: status("Backup", names.backup),
    restore: status("Restore", names.restore),
    invalidBackup: status("Backup", names.invalidBackup),
    invalidRestore: status("Restore", names.invalidRestore),
    orphanRestore: status("Restore", names.orphanRestore),
  };
  const text = (what: string, path: string) => storedText(store, what, path);
  // A JSON artifact, when it is of the form the release writes it in.
  const value = <Value,>(what: string, path: string, written: (value: unknown) => boolean) => {
    const content = text(what, path);
    let read: unknown;

    try {
      read = JSON.parse(content);
    } catch {
      read = undefined;
    }
    requireCondition(read !== undefined && written(read), `The ${what} is not written as the release writes it`);
    return {
      bytes: Buffer.byteLength(content),
      sha256: createHash("sha256").update(content).digest("hex"),
      value: read as Value,
    };
  };
  const map = (read: unknown): read is Record<string, unknown> =>
    typeof read === "object" && read !== null && !Array.isArray(read);
  const texts = (read: unknown) => Array.isArray(read) && read.every((entry) => typeof entry === "string");
  type Result = { velero?: string[]; cluster?: string[]; namespaces?: Record<string, string[]> };
  // Both keys are always there, and a list of each is left out when it is empty.
  const results = (what: string, path: string) => {
    const read = value<{ errors: Result; warnings: Result }>(
      what,
      path,
      (written) =>
        map(written) &&
        [written.errors, written.warnings].every(
          (result) =>
            map(result) &&
            [result.velero ?? [], result.cluster ?? []].every(texts) &&
            map(result.namespaces ?? {}) &&
            Object.values(result.namespaces ?? {}).every(texts),
        ),
    );
    // The entries of one of the two, by where the release files them, and all of them: the errors and the
    // warnings are told as the ones of the backups the store was given are, by their number.
    const grouped = ({ velero = [], cluster = [], namespaces = {} }: Result) => ({
      velero: velero.length,
      cluster: cluster.length,
      namespaces: Object.fromEntries(
        Object.entries(namespaces).map(([namespace, messages]) => [namespace, messages.length]),
      ),
    });
    const all = (groups: ReturnType<typeof grouped>) =>
      groups.velero + groups.cluster + Object.values(groups.namespaces).reduce((sum, count) => sum + count, 0);
    const groups = { errors: grouped(read.value.errors), warnings: grouped(read.value.warnings) };

    return { ...read, errors: all(groups.errors), warnings: all(groups.warnings), groups };
  };
  const resourceList = (what: string, path: string) => {
    const read = value<Record<string, string[]>>(
      what,
      path,
      (written) => map(written) && Object.values(written).every(texts),
    );

    return { ...read, resources: Object.keys(read.value).length, items: Object.values(read.value).flat().length };
  };
  const volumeInfo = (what: string, path: string) => {
    const read = value<unknown[]>(what, path, (written) => Array.isArray(written) && written.every(map));

    return { ...read, volumes: read.value.length };
  };
  // The text the release writes once in a log when the work ends, and the field every entry of it carries.
  const log = (what: string, path: string, once: string, field: string) => logFacts(text(what, path), [once, field]);
  const logs = fixtureArtifactPaths(run);
  const others = realTabArtifactPaths(run);
  const backup = `the backup ${names.backup}`;
  const restore = `the restore ${names.restore}`;
  const restored = resourceList(`list of the resources of ${restore}`, others.restoreResourceList);
  // The release writes each item of a restore with what it did of it, in brackets, after its name.
  const actions: Record<string, number> = {};

  for (const item of Object.values(restored.value).flat()) {
    const action = /\(([^()]*)\)$/.exec(item)?.[1] ?? "";

    actions[action] = (actions[action] ?? 0) + 1;
  }

  return {
    run,
    namespace: DEMO_NAMESPACE,
    synced: { ...expected, status: held.synced },
    withoutLog: {
      backup: names.syncedBackupWithoutLog,
      ...expected.empty,
      status: held.withoutLog,
    },
    real: {
      backup: {
        name: names.backup,
        status: held.backup,
        log: log(
          `log of ${backup}`,
          logs.backupLog,
          "Backed up a total of",
          `backup=${DEMO_NAMESPACE}/${names.backup}`,
        ),
        results: results(`results of ${backup}`, logs.backupResults),
        resourceList: resourceList(`list of the resources of ${backup}`, others.backupResourceList),
        volumeInfo: volumeInfo(`volume information of ${backup}`, others.backupVolumeInfo),
      },
      restore: {
        name: names.restore,
        status: held.restore,
        log: log(
          `log of ${restore}`,
          logs.restoreLog,
          "restore completed",
          `restore=${DEMO_NAMESPACE}/${names.restore}`,
        ),
        results: results(`results of ${restore}`, logs.restoreResults),
        resourceList: { ...restored, actions },
        volumeInfo: volumeInfo(`volume information of ${restore}`, others.restoreVolumeInfo),
      },
    },
    refused: {
      backup: { name: names.invalidBackup, status: held.invalidBackup },
      restore: { name: names.invalidRestore, status: held.invalidRestore },
      orphan: { name: names.orphanRestore, status: held.orphanRestore },
    },
  };
}

// How many times the deletion of one backup is asked of the server in one removal, how long the server is
// given to delete a backup it was asked to, or to have its storage location available, and how often the
// cluster is read meanwhile.
const CLEAR_ROUNDS = 3;
const DELETION_TIMEOUT = 180_000;
const DELETION_POLL = 1000;
// The phases of a backup the server deletes when it is asked to: the ones it ended in, and the one it was
// left in by a deletion that did not end, which is asked for again.
const DELETABLE = ["Completed", "PartiallyFailed", "Failed", "FailedValidation", "Deleting"];

// What the removal of a backup of the fixtures is made of, for the two backups the server created from the
// store and for the ones the scripts created. Nothing here deletes a backup: the server deletes one it is
// asked to through a request of its own, with its files and with the restores that name it. That request is
// of the run, and it is the one object that is removed here, by its identity, once the server will not look
// at it again: the server looks at a request once, and passes over one it ended and over one it began.
function backupRemoval(
  runtime: FixtureRuntime,
  run: string,
  elapsed: () => number,
  journal: NonNullable<FixtureRuntime["journal"]>,
) {
  const down = "the way out is to take the environment down, with `pnpm demo:down`";
  const request = (name: string) => `${name}-delete`;
  // What is read of the installation to decide by: the backups, the restores that may name one, the requests
  // to delete one, and the storage locations.
  const kinds = "backups.velero.io,restores.velero.io,deletebackuprequests.velero.io";
  const read = () =>
    (
      JSON.parse(
        runtime.kubectl([
          "get",
          `${kinds},backupstoragelocations.velero.io`,
          "--namespace",
          DEMO_NAMESPACE,
          "-o",
          "json",
        ]),
      ) as { items: KubeResource[] }
    ).items;
  const one = (items: KubeResource[], kind: string, name: string) =>
    items.find((item) => item.kind === kind && item.metadata.name === name);
  const phaseOf = (resource: KubeResource | undefined) => (resource?.status as { phase?: string } | undefined)?.phase;
  const ofTheRun = (resource: KubeResource) =>
    resource.metadata.labels?.[OWNER_LABEL] === runtime.owner && resource.metadata.labels?.[FIXTURE_LABEL] === run;
  const foreign = (name: string) =>
    `The request ${request(name)} of ${DEMO_NAMESPACE} is not one this run made: ${down}.`;
  const entry = (kind: string, name: string) =>
    journal.entries.findIndex((item) => item.kind === kind && item.name === name && item.namespace === DEMO_NAMESPACE);
  // The journal forgets an object the cluster no longer holds: nothing is created over an entry of it.
  const forget = (kind: string, name: string) => {
    const index = entry(kind, name);

    if (index < 0) return false;
    journal.entries.splice(index, 1);
    return true;
  };
  // A request of this run the server will not look at again is removed by the identity it was read with.
  const withdraw = (name: string, found: KubeResource) => {
    requireCondition(ofTheRun(found) && found.metadata.uid, foreign(name));
    runtime.kubectl(
      [
        "delete",
        "--raw",
        `/apis/velero.io/v1/namespaces/${DEMO_NAMESPACE}/deletebackuprequests/${request(name)}`,
        "-f",
        "-",
      ],
      JSON.stringify({ apiVersion: "v1", kind: "DeleteOptions", preconditions: { uid: found.metadata.uid } }),
    );
    if (forget("DeleteBackupRequest", request(name))) journal.save();
  };
  // What is asked to be deleted is known first: a backup that ended; one no restore of another owner names,
  // since the server deletes the restores of a backup with it; and whose request, when there is one, is of
  // this run.
  const deletable = (items: KubeResource[], backup: KubeResource) => {
    const { name } = backup.metadata;
    const phase = phaseOf(backup);
    const found = one(items, "DeleteBackupRequest", request(name));

    requireCondition(
      DELETABLE.includes(phase ?? ""),
      `The backup ${name} is ${phase ?? "in no phase"}, and the deletion of a backup that did not end is not ` +
        "asked: run the command again once it ended.",
    );
    for (const restore of items.filter(
      (item) => item.kind === "Restore" && (item.spec as { backupName?: string } | undefined)?.backupName === name,
    )) {
      requireCondition(
        ofTheRun(restore),
        `The restore ${restore.metadata.name} names the backup ${name} and is not of this run: the server would ` +
          `delete it with the backup, and the deletion is not asked. While it is there, ${down}.`,
      );
    }
    requireCondition(!found || ofTheRun(found), foreign(name));
  };
  // The server refuses to delete a backup of a location that is not available: the location is read again,
  // and nothing else is asked meanwhile, three minutes at most from when it was found so. What is answered
  // is the read the location is available in, which is the one that was given when it was available then.
  const available = (items: KubeResource[], location: string, backups: string[]) => {
    const since = elapsed();

    for (let now = items; ; now = read()) {
      const phase = phaseOf(one(now, "BackupStorageLocation", location));

      if (phase === "Available") return now;
      requireCondition(
        elapsed() - since < DELETION_TIMEOUT,
        `The storage location ${location} is ${phase ?? "in no phase, or not there"}, and the server deletes ` +
          `no backup of a location that is not Available: the deletion of ${backups.join(" and ")} was not ` +
          `asked in ${DELETION_TIMEOUT / 60_000} minutes. Run the command again once the location is Available.`,
      );
      pause(runtime, DELETION_POLL);
    }
  };
  // Has the server delete a backup that is there, and waits until that backup is gone, or until the one of
  // its name is another, which the server created since.
  //
  // A request the server ended is one it never looks at again, whatever it ended it with: it is removed, once
  // what `mend` puts right was put right, and the deletion is asked again. One the server has not ended is
  // the one that is waited for, and nothing is written over it: the server may end it, and remove it with the
  // backup, at any moment. An error the server ends the request with stops here, and the next removal takes
  // it up. The server is given three minutes. A request it began and did not end in them is one it left, as
  // a server that was stopped does, and it takes up none it began: that request is removed, once for a
  // backup in a removal, for the deletion to be asked again.
  const deletes = (
    items: KubeResource[],
    backup: KubeResource,
    replaced: Set<string>,
    mend?: (backup: KubeResource) => void,
  ) => {
    const { name, uid } = backup.metadata;
    const prior = one(items, "DeleteBackupRequest", request(name));
    const ended = phaseOf(prior) === "Processed";

    if (prior && ended) {
      mend?.(backup);
      withdraw(name, prior);
    } else if (!prior && forget("DeleteBackupRequest", request(name))) journal.save();
    if (!prior || ended) runtime.apply(fixtureDeletionRequest(runtime.owner, run, uid ?? "", name));
    const since = elapsed();
    let next = read();

    for (; one(next, "Backup", name)?.metadata.uid === uid; next = read()) {
      const again = one(next, "DeleteBackupRequest", request(name));
      const told = again?.status as { phase?: string; errors?: string[] } | undefined;

      requireCondition(
        !told?.errors?.length,
        `The controller reported a fixture backup-deletion error for ${name}, which the private log of the ` +
          `operations holds, and left the backup in ${DEMO_NAMESPACE} with its files. Run the command again: ` +
          (mend
            ? "when the contents the store holds of the backup are not the ones that were stored they are put " +
              "back, and the deletion is asked again. "
            : "the deletion is asked again. ") +
          `Otherwise ${down}.`,
      );
      if (elapsed() - since >= DELETION_TIMEOUT) {
        const waited =
          `The server did not delete the backup ${name} in ${DELETION_TIMEOUT / 60_000} minutes: the backup is ` +
          `${phaseOf(one(next, "Backup", name)) ?? "in no phase"}, and the request ${request(name)} is ` +
          `${again ? (told?.phase ?? "in no phase") : "not there"}.`;

        if (!again || told?.phase !== "InProgress") {
          throw new Error(`${waited} Run the command again once the server deleted it; otherwise ${down}.`);
        }
        requireCondition(
          !replaced.has(name),
          `${waited} The server takes up no request it began, and one is replaced once in a removal: run the ` +
            `command again; otherwise ${down}.`,
        );
        replaced.add(name);
        withdraw(name, again);
        return;
      }
      pause(runtime, DELETION_POLL);
    }
    // The journal forgets what the server removed: the backup, and the request it removes with it.
    const gone = [
      !one(next, "Backup", name) && forget("Backup", name),
      !one(next, "DeleteBackupRequest", request(name)) && forget("DeleteBackupRequest", request(name)),
    ];

    if (gone.some(Boolean)) journal.save();
  };
  // A request of the run for a backup that is not there. One the server ended, or began and left, is one it
  // never looks at again: it is removed by its identity. One it has not looked at is one it ends, with an
  // error since the backup is not there: it is left to the server.
  const settle = (items: KubeResource[], name: string) => {
    const found = one(items, "DeleteBackupRequest", request(name));
    const phase = phaseOf(found);

    if (!found) return;
    requireCondition(
      phase === "Processed" || phase === "InProgress",
      `The request ${request(name)} is ${phase ?? "in no phase"} and no backup ${name} is in ${DEMO_NAMESPACE} ` +
        "for the server to delete: run the command again once the server processed it.",
    );
    withdraw(name, found);
  };

  return { down, request, kinds, read, one, phaseOf, ofTheRun, entry, forget, deletable, available, deletes, settle };
}

// Removes the fixtures of the tabs: the two backups the server created from the store, and with them the
// files the store was given. Nothing here deletes a backup or a key. The server deletes a backup it is
// asked to through a request of its own, and removes the files of the folder before the object; a folder
// the server made no backup of is left, and told by its keys.
//
// It decides by what it finds, and the record of the placement says only what may still be written. It
// reads the backups of the two names whatever identity the cluster gave them, since the server may have
// created one again, and asks the store whether it holds each key of a folder once what is done depends on
// it. Then, as many times as it takes:
//
// - While the placement is recorded as storing, a folder that holds files and not its metadata is what a
//   placement that was stopped left, and the sync never takes it: it is given the contents of a backup and
//   then its metadata, as it was recorded, so that the server makes the backup it deletes the folder with.
//   This comes before any deletion is asked; at any other record such a folder is left as it is.
// - A backup that is there is of this run, ended, and named by no restore of another owner, or nothing is
//   asked for either of the two. Its deletion is asked once the storage location is available, one backup
//   at a time, on a read made then. The removal is recorded before the request is applied: from there no
//   folder is finished. A request the server ended is one it never looks at again, and is replaced; when
//   it left the backup in deletion, and the contents the store holds of that backup are not the ones that
//   were stored, they are put back first, recorded before they are written. A request the server has not
//   ended is the one that is waited for, with nothing applied over it. The server is given three minutes:
//   an error it ends the request with stops the removal, and the next one takes it up; a request it began
//   and left is replaced, once for a backup.
// - A folder that holds its metadata and has no backup is waited for, two passes of the sync at most, once.
// - With no backup and no key left, one pass of the sync that ended after the store was asked is waited
//   for: a backup that is there again is asked for again on that read, three times at most for a name.
//
// It ends when neither the cluster nor the store holds anything of the tabs: a request of the run the
// server left is removed by its identity, the journal has forgotten the four objects, and the record says
// cleared. Every step that changes the record or the journal keeps it before the next one, so a removal
// that was stopped is taken up by the next from what that one finds.
//
// What is answered: the backups whose deletion the server was waited for, each as many times as it was, the
// files the store was given, the passes of the sync that were counted, and the time it all took.
export function clearTabFixtures(
  runtime: FixtureRuntime,
  run: string,
): { deleted: string[]; written: string[]; passes: number; waited: number } {
  const names = fixtureNames(run);
  const { tabs, journal } = runtime;

  requireCondition(
    runtime.store && runtime.elapsed && tabs && journal,
    "The removal of the fixtures of the tabs needs the store of the environment, the clock of the runtime, the " +
      "journal of the objects of the run, and where the placement of the tabs is recorded",
  );
  const store = runtime.store.bind(runtime);
  const elapsed = runtime.elapsed.bind(runtime);
  const record = tabs.read();

  requireCondition(record, "No placement of the tabs is recorded for this run: nothing of them is removed");
  const paths = tabArtifactPaths(run);
  // Each backup with the keys of its folder, and its metadata as it was recorded.
  const folders: {
    name: string;
    keys: Record<string, string> & { archive: string; metadata: string };
    metadata: string;
  }[] = [
    { name: names.syncedBackup, keys: paths.synced, metadata: record.metadata.synced },
    { name: names.syncedBackupWithoutLog, keys: paths.withoutLog, metadata: record.metadata.withoutLog },
  ];
  const stored = folders.map(({ metadata }) => JSON.parse(metadata) as Partial<KubeResource>);
  // The location the two backups are of, which the metadata of both was made with.
  const location = (stored[0].spec as { storageLocation?: string } | undefined)?.storageLocation;

  requireCondition(
    location && stored.every((backup, index) => backup.metadata?.name === folders[index].name),
    "The metadata that is recorded is not the one of the two backups of this run",
  );
  const removal = backupRemoval(runtime, run, elapsed, journal);
  const { down, request, kinds, one, phaseOf, ofTheRun, entry, forget } = removal;
  // The length the store holds of a key, or nothing when it holds none. Another answer tells neither.
  const held = (path: string) => heldLength(store, path, "what is left of the tabs");
  const left = (keys: string[]) =>
    `What the store holds of the tabs with no backup the server would delete it with: ${keys.join(", ")}.`;
  const kept = `Nothing here removes a key: ${down}.`;
  const began = elapsed();
  const asked = new Map<string, number>();
  const awaited = new Set<string>();
  const replaced = new Set<string>();
  const deleted: string[] = [];
  const written: string[] = [];
  let passes = 0;
  // What a wait read last: what is decided next is decided on it as it was read then.
  let carried: KubeResource[] | undefined;
  // Neither the cluster nor the store holds anything of the tabs.
  const finish = (items: KubeResource[]) => {
    for (const { name } of folders) removal.settle(items, name);
    const forgotten = folders.flatMap(({ name }) => [
      forget("Backup", name),
      forget("DeleteBackupRequest", request(name)),
    ]);

    if (forgotten.some(Boolean)) journal.save();
    if (record.state !== "cleared") {
      record.state = "cleared";
      tabs.keep(record);
    }
    return { deleted, written, passes, waited: elapsed() - began };
  };
  // The server ended a deletion and left the backup in it, which it does on an error: the store is asked
  // what it holds of the contents of the backup, which the server reads before it removes anything. Contents
  // that are not the ones that were stored are put back, over a key that is there and never in the place of
  // one that is not.
  const mend = (archive: string) => (backup: KubeResource) => {
    const length = phaseOf(backup) === "Deleting" ? held(archive) : undefined;
    const contents = emptyArchive();

    if (length === undefined || length === contents.length) return;
    if (!record.repaired?.includes(archive)) {
      record.repaired = [...(record.repaired ?? []), archive];
      tabs.keep(record);
    }
    const sent = sendTabFile(store, tabs, record, archive, contents);

    requireCondition(
      sent.kept,
      `The store did not keep ${archive} (${sent.met.join("; ")}): the contents of the backup ${backup.metadata.name} are ` +
        `not the ones that were stored, and its deletion is not asked again. While it is in ${DEMO_NAMESPACE}, ` +
        `${down}.`,
    );
    written.push(archive);
  };

  for (;;) {
    const items = carried ?? removal.read();
    const there = folders.flatMap((folder) => {
      const backup = one(items, "Backup", folder.name);

      return backup ? [{ folder, backup }] : [];
    });

    carried = undefined;
    // What the store holds of each folder the cluster has no backup of, by the length of each key. It is
    // asked when what is done depends on it: while a folder may still be finished, and once no backup is
    // left to be deleted.
    const loose = folders
      .filter(({ name }) => (there.length === 0 || record.state === "storing") && !one(items, "Backup", name))
      .map((folder) => ({
        folder,
        holds: new Map(
          Object.values(folder.keys).flatMap((path) => {
            const length = held(path);

            return length === undefined ? [] : [[path, length] as const];
          }),
        ),
      }))
      .filter(({ holds }) => holds.size > 0);
    const keys = () => loose.flatMap(({ holds }) => [...holds.keys()]);

    // What is asked to be deleted is known first, for every backup that is there and before anything is
    // changed: a backup of this run that the server created from the store, in the location it was stored
    // in, and one the server deletes for what it is and for what names it.
    for (const { folder, backup } of there) {
      const labels = backup.metadata.labels ?? {};

      requireCondition(
        ofTheRun(backup) &&
          labels[FIXTURE_MODE] === "synced" &&
          labels["velero.io/storage-location"] === location &&
          backup.metadata.uid,
        `The backup ${folder.name} of ${DEMO_NAMESPACE} is not one the server created for this run from the ` +
          `store, and its deletion is not asked: ${down}.`,
      );
      removal.deletable(items, backup);
    }
    // A folder a placement that was interrupted left without its metadata is finished while the placement
    // is recorded as storing, and before anything is asked to be deleted.
    const unfinished = loose.filter(({ folder, holds }) => !holds.has(folder.keys.metadata));

    if (record.state === "storing") {
      for (const { folder, holds } of unfinished) {
        for (const [path, bytes] of [
          [folder.keys.archive, emptyArchive()],
          [folder.keys.metadata, Buffer.from(folder.metadata)],
        ] as const) {
          if (holds.get(path) === bytes.length) continue;
          const sent = sendTabFile(store, tabs, record, path, bytes);

          requireCondition(
            sent.kept,
            `The store did not keep ${path} (${sent.met.join("; ")}). ${left(keys())} ${kept}`,
          );
          holds.set(path, bytes.length);
          written.push(path);
        }
      }
    }
    if (there.length > 0) {
      // What is asked once the location is available is decided on a read made then.
      const now = removal.available(
        items,
        location,
        there.map(({ folder }) => folder.name),
      );

      if (now !== items) {
        carried = now;
        continue;
      }
      // One backup is asked for at a time: the cluster is read again for the other.
      const [{ folder, backup }] = there;
      const { name } = folder;
      const { uid } = backup.metadata;
      const count = asked.get(name) ?? 0;
      const index = entry("Backup", name);

      requireCondition(
        count < CLEAR_ROUNDS,
        `The backup ${name} is in ${DEMO_NAMESPACE} after its deletion was asked of the server ${CLEAR_ROUNDS} ` +
          `times: it is left there, and ${down}.`,
      );
      // From here no folder is finished: the record says so before anything is asked of the server.
      if (record.state !== "clearing") {
        record.state = "clearing";
        tabs.keep(record);
      }
      // The journal knows the backup by the identity the cluster gives it now.
      if (index < 0 || journal.entries[index].uid !== uid) {
        if (index < 0) {
          journal.entries.push({ apiVersion: backup.apiVersion, kind: "Backup", name, namespace: DEMO_NAMESPACE, uid });
        } else journal.entries[index].uid = uid;
        journal.save();
      }
      asked.set(name, count + 1);
      deleted.push(name);
      removal.deletes(items, backup, replaced, mend(folder.keys.archive));
      continue;
    }
    if (loose.length === 0) {
      // Nothing was written, or nothing was found by a removal that ended: no pass is waited for.
      if (record.state === "storing" || record.state === "cleared") return finish(items);
      const again = (now: KubeResource[]) => folders.some(({ name }) => one(now, "Backup", name));
      const wait = awaitSync(runtime, elapsed, location, kinds, again, 1);

      passes += wait.passes;
      if (wait.stalled) {
        throw new Error(
          `${wait.stalled.words("the removal of the fixtures of the tabs is not ended before one did")} Neither ` +
            `the cluster nor the store holds anything of the tabs: run the command again once ${wait.stalled.until}.`,
        );
      }
      if (!again(wait.items)) return finish(wait.items);
      // A backup is there again: its deletion is asked on what was just read.
      carried = wait.items;
      continue;
    }
    // No backup is there, and the store holds files of the tabs. A folder with its metadata is one the sync
    // of the server takes: the server is waited for, once for a folder.
    const stray = unfinished
      .filter(({ folder, holds }) => !holds.has(folder.keys.metadata))
      .map(({ folder }) => folder.name);
    const unmade = loose.map(({ folder }) => folder.name).filter((name) => !stray.includes(name));
    const pending = unmade.filter((name) => !awaited.has(name));

    // What is left is what the server deletes nothing of: a folder it made no backup of, and one without
    // the metadata it makes a backup from.
    requireCondition(
      pending.length > 0,
      [
        ...(unmade.length > 0
          ? [
              `The server was waited for, ${SYNC_PASSES} passes of its sync at most, and it made no backup of ` +
                `${unmade.join(" and ")} from the metadata the store holds.`,
            ]
          : []),
        ...(stray.length > 0
          ? [
              `The store holds no metadata of ${stray.join(" and ")}, which the server makes a backup from, and a ` +
                "folder is finished only while the placement of the tabs is recorded as storing: it is recorded " +
                `as ${record.state}.`,
            ]
          : []),
        left(keys()),
        kept,
      ].join(" "),
    );
    for (const name of pending) awaited.add(name);
    const wait = awaitSync(
      runtime,
      elapsed,
      location,
      "backups.velero.io",
      (now) => pending.every((name) => one(now, "Backup", name)),
      SYNC_PASSES,
    );

    passes += wait.passes;
    if (wait.stalled) {
      throw new Error(
        `${wait.stalled.words(
          `${pending.join(" and ")} ${pending.length > 1 ? "are" : "is"} not in ${DEMO_NAMESPACE}`,
        )} ${left(keys())} Run the command again once ${wait.stalled.until}.`,
      );
    }
  }
}

// What the runner says of a removal of the fixtures of the tabs: the backups the server deleted, as many
// deletions as were waited for, and the files the store was given first, or that nothing was left of them.
export function tabRemovalWords(cleared: ReturnType<typeof clearTabFixtures>): string {
  const counted = (count: number, one: string) => `${count} ${one}${count === 1 ? "" : "s"}`;
  const given = cleared.written.length ? counted(cleared.written.length, "file") : "no file";

  return cleared.deleted.length > 0 || cleared.written.length > 0
    ? `PASS: the server deleted ${[...new Set(cleared.deleted)].join(" and ")} with the files the store was given for the tabs, and none came back after a pass of its sync (${counted(cleared.deleted.length, "deletion")} waited for, ${given} given to the store first, ${counted(Math.round(cleared.waited / 1000), "second")}).`
    : "PASS: neither the cluster nor the store holds anything of the fixtures of the tabs.";
}

// Has the server delete a backup the scripts created for the run: the real one, with the files the server
// wrote for it and the restores that name it, or the one that failed its validation, of which the store
// holds nothing. The two backups the server created from the store are not removed this way: their removal
// knows what the store was given.
//
// The backup that is there is the one the journal knows, of this run, ended, and named by no restore of
// another owner, or its deletion is not asked. It is asked as the deletion of a backup of the tabs is: once
// the storage location is available, through a request of the run, with a request the server ended replaced
// and one it has not ended waited for, and three minutes for the server. Once the backup is gone, a request
// of the run the server left is removed by its identity, and the journal forgets both. A backup of that
// name the journal does not know is not asked for: the removal ends, or stops, at the turn after it asked.
export function removeFixtureBackup(
  runtime: FixtureRuntime,
  run: string,
  name: string,
): { asked: number; waited: number } {
  const names = fixtureNames(run);
  const { journal } = runtime;

  requireCondition(
    [names.backup, names.invalidBackup].includes(name),
    "Only a backup the scripts created for the run is removed this way",
  );
  requireCondition(
    runtime.elapsed && journal,
    "The removal of a backup of the fixtures needs the clock of the runtime, and the journal of the objects of the run",
  );
  const elapsed = runtime.elapsed.bind(runtime);
  const removal = backupRemoval(runtime, run, elapsed, journal);
  const { down, request, one, ofTheRun, entry, forget } = removal;
  const began = elapsed();
  const replaced = new Set<string>();
  let asked = 0;
  let carried: KubeResource[] | undefined;

  for (;;) {
    const items = carried ?? removal.read();
    const backup = one(items, "Backup", name);

    carried = undefined;
    if (!backup) {
      removal.settle(items, name);
      if ([forget("Backup", name), forget("DeleteBackupRequest", request(name))].some(Boolean)) journal.save();
      return { asked, waited: elapsed() - began };
    }
    const known = journal.entries[entry("Backup", name)];

    // The scripts created it: the journal has the identity the cluster gave it, unless its creation was
    // stopped before the journal learned it.
    requireCondition(
      ofTheRun(backup) && known && (!known.uid || known.uid === backup.metadata.uid),
      `The backup ${name} of ${DEMO_NAMESPACE} is not the one this run created, and its deletion is not asked: ` +
        `${down}.`,
    );
    removal.deletable(items, backup);
    const location = (backup.spec as { storageLocation?: string } | undefined)?.storageLocation ?? "";
    const now = removal.available(items, location, [name]);

    if (now !== items) {
      carried = now;
      continue;
    }
    asked += 1;
    removal.deletes(items, backup, replaced);
  }
}

// Once the operations of a run were removed, and before the run is called cleaned: the installation holds
// none of them, each looked for by its name whatever identity the cluster gave it, since the server may have
// created a backup again; and the store holds none of the keys of the run, the ones the server wrote for the
// real operations and the ones the store was given for the tabs. The journal forgets the operations as soon
// as the installation is read to hold none of them, before the store is asked: what it names is what the
// cluster holds, whatever the store answers, and a key that is left stops the run with no entry of an object
// that is gone. A store that does not say whether it holds a key says nothing: the run is not called cleaned
// on it, and the next cleanup asks it again.
export function assertFixtureOperationsRemoved(runtime: FixtureRuntime, run: string): { keys: number } {
  const names = fixtureNames(run);
  const { journal } = runtime;

  requireCondition(
    runtime.store && journal,
    "What is left of the operations of a run is asked of the store of the environment, and forgotten by the " +
      "journal of the objects of the run",
  );
  const store = runtime.store.bind(runtime);
  const deletions = [names.backup, names.invalidBackup, names.syncedBackup, names.syncedBackupWithoutLog];
  const operations = [
    ...deletions.map((name) => ["Backup", name] as const),
    ...[names.restore, names.invalidRestore, names.orphanRestore].map((name) => ["Restore", name] as const),
    ...deletions.map((name) => ["DeleteBackupRequest", `${name}-delete`] as const),
  ];
  const items = (
    JSON.parse(
      runtime.kubectl([
        "get",
        "backups.velero.io,restores.velero.io,deletebackuprequests.velero.io",
        "--namespace",
        DEMO_NAMESPACE,
        "-o",
        "json",
      ]),
    ) as { items: KubeResource[] }
  ).items;
  const there = operations
    .filter(([kind, name]) => items.some((item) => item.kind === kind && item.metadata.name === name))
    .map(([kind, name]) => `the ${kind} ${name}`);

  requireCondition(
    there.length === 0,
    `The server has not removed every operation of the run from ${DEMO_NAMESPACE}: ${there.join(", ")} ` +
      `${there.length > 1 ? "are" : "is"} there. Run the command again; for what is still there after it, the ` +
      "way out is to take the environment down, with `pnpm demo:down`.",
  );
  const forgotten = operations.map(([kind, name]) => {
    const index = journal.entries.findIndex(
      (item) => item.kind === kind && item.name === name && item.namespace === DEMO_NAMESPACE,
    );

    if (index >= 0) journal.entries.splice(index, 1);
    return index >= 0;
  });

  if (forgotten.some(Boolean)) journal.save();
  const keys = runArtifactPaths(run);
  const held = keys.filter((path) => heldLength(store, path, "what is left of the run") !== undefined);

  requireCondition(
    held.length === 0,
    `The store holds ${held.join(", ")} though no operation of the run is in ${DEMO_NAMESPACE}: the server ` +
      "deletes the files of a backup with the backup, and nothing here removes a key. The way out is to take the " +
      "environment down, with `pnpm demo:down`.",
  );
  return { keys: keys.length };
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
