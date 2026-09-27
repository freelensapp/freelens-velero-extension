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

// The identity the views are read with when access is restricted, and how many backups the long list has.
export const VIEW_READER = "views-reader";
export const SCALE_BACKUPS = 1000;

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

const FINISHED = new Set(["Completed", "PartiallyFailed", "Failed", "FailedValidation"]);

// The status of a synthetic operation in a phase: what the controller would have written, and did not.
function syntheticStatus(phase: string, progressField: string, started = Date.parse("2026-09-01T10:00:00Z")) {
  const time = (offset: number) => new Date(started + offset).toISOString().replace(".000Z", "Z");

  return {
    phase,
    ...(phase === "New" ? {} : { startTimestamp: time(0) }),
    ...(FINISHED.has(phase) ? { completionTimestamp: time(60_000) } : {}),
    progress: { totalItems: 10, [progressField]: phase === "Completed" || phase.startsWith("Finalizing") ? 10 : 4 },
    errors: phase.includes("Failed") ? 1 : 0,
    warnings: phase === "PartiallyFailed" ? 1 : 0,
    ...(phase === "FailedValidation"
      ? { validationErrors: ["Synthetic validation error; no operation was executed"] }
      : {}),
  };
}

// A name as long as Velero accepts one: it is the value of a label, which has 63 characters at most.
export const LONG_BACKUP_NAME = "backup-with-a-name-as-long-as-the-value-of-a-label-is-allowed-1";

// What the views need beside the phases: an installation with references that lead somewhere and references
// that do not, a name that fills its column, an object that reports nothing, and an identity that reads a
// part of it. Its namespace is outside the reach of the controllers, like the one of the phases.
export function viewFixtures(owner: string, run: string): KubeResource[] {
  requireCondition(owner, "Fixture ownership is required");
  const names = fixtureNames(run);
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
      spec: { schedule: "0 3 * * *", paused: false, template: spec },
      status: { phase: "Enabled" },
    },
    backup("views-daily-20260901030000", "Completed", {
      labels: { "velero.io/schedule-name": "views-daily" },
      status: { warnings: 2 },
    }),
    backup("backup-missing-schedule", "Completed", { labels: { "velero.io/schedule-name": "views-removed" } }),
    backup("backup-missing-location", "FailedValidation", {
      spec: { storageLocation: "views-removed", volumeSnapshotLocations: ["views-removed"] },
    }),
    backup(LONG_BACKUP_NAME, "InProgress"),
    // The name of a backup of the namespace of the phases, for another backup: a name is of its installation.
    backup("backup-inprogress", "InProgress", { status: { progress: { totalItems: 10, itemsBackedUp: 7 } } }),
    backup("backup-unreported", undefined),
    ...["Completed", "PartiallyFailed"].map((phase) => ({
      apiVersion: "velero.io/v1",
      kind: "Restore",
      metadata: metadata(`restore-of-daily-${phase.toLowerCase()}`),
      spec: {
        backupName: "views-daily-20260901030000",
        includedNamespaces: [names.source],
        namespaceMapping: { [names.source]: names.restored },
        includeClusterResources: false,
        restorePVs: false,
        existingResourcePolicy: "none",
      },
      status: syntheticStatus(phase, "itemsRestored"),
    })),
    {
      apiVersion: "v1",
      kind: "ServiceAccount",
      metadata: metadata(VIEW_READER),
      automountServiceAccountToken: false,
    },
    {
      apiVersion: "rbac.authorization.k8s.io/v1",
      kind: "Role",
      metadata: metadata(VIEW_READER),
      // The restores and the snapshot locations are left out: what the views show of a family that is denied.
      rules: [
        {
          apiGroups: ["velero.io"],
          resources: ["backups", "schedules", "backupstoragelocations"],
          verbs: ["get", "list", "watch"],
        },
      ],
    },
    {
      apiVersion: "rbac.authorization.k8s.io/v1",
      kind: "RoleBinding",
      metadata: metadata(VIEW_READER),
      roleRef: { apiGroup: "rbac.authorization.k8s.io", kind: "Role", name: VIEW_READER },
      subjects: [{ kind: "ServiceAccount", name: VIEW_READER, namespace: names.views }],
    },
  ];
}

// The long list: a namespace with no storage location, which no discovery suggests, and a thousand backups
// in every phase. They are created in one request of the client and deleted with their namespace.
export function scaleFixtures(owner: string, run: string): { namespace: KubeResource; backups: KubeResource[] } {
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
      spec: {
        backupName: "backup-completed",
        includedNamespaces: [names.source],
        namespaceMapping: { [names.source]: names.restored },
        includeClusterResources: false,
        restorePVs: false,
        existingResourcePolicy: "none",
      },
      status: status(phase, "itemsRestored"),
    })),
    {
      apiVersion: "velero.io/v1",
      kind: "Schedule",
      metadata: metadata("schedule-enabled"),
      spec: { schedule: "0 0 1 1 *", paused: false, template: backupSpec },
      status: { phase: "Enabled" },
    },
    {
      apiVersion: "velero.io/v1",
      kind: "Schedule",
      metadata: metadata("schedule-paused"),
      spec: { schedule: "0 0 1 1 *", paused: true, template: backupSpec },
      status: { phase: "Enabled" },
    },
    {
      apiVersion: "velero.io/v1",
      kind: "Schedule",
      metadata: metadata("schedule-invalid"),
      spec: { schedule: "invalid-synthetic-cron", paused: true, template: backupSpec },
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
export function createViewFixtures(runtime: FixtureRuntime, run: string): { views: number; scale: number } {
  const names = fixtureNames(run);
  const views = createWithStatus(runtime, viewFixtures(runtime.owner, run));
  const scale = scaleFixtures(runtime.owner, run);
  const listed = () =>
    (
      JSON.parse(
        runtime.kubectl(
          ["get", "backups.velero.io", "--namespace", names.scale, "-o", "json"],
          undefined,
          undefined,
          false,
        ),
      ) as { items: (KubeResource & { status?: { phase?: string } })[] }
    ).items;

  runtime.apply(scale.namespace);
  if (!listed().length) {
    runtime.kubectl(
      ["create", "-f", "-", "-o", "name"],
      JSON.stringify({ apiVersion: "v1", kind: "List", items: scale.backups }),
      600_000,
      false,
    );
  }
  const found = listed();

  requireCondition(
    found.length === scale.backups.length &&
      found.every(
        (item) =>
          item.metadata.labels?.[OWNER_LABEL] === runtime.owner &&
          item.metadata.labels?.[FIXTURE_LABEL] === run &&
          item.status?.phase,
      ),
    "The backups of the long list are not the ones of this run",
  );
  return { views: views.length, scale: found.length };
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
      ttl: "1h0m0s",
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
