import { createHash, randomBytes } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { isDeepStrictEqual } from "node:util";
import { DEMO_NAMESPACE, OWNER_LABEL, requireCondition } from "./local-kind.mts";
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

export function fixtureNames(run: string) {
  requireCondition(/^[a-f0-9]{8}$/.test(run), "A generated local fixture run ID is required");
  return {
    source: `velero-source-${run}`,
    restored: `velero-restored-${run}`,
    static: `velero-static-${run}`,
    backup: `fixture-backup-${run}`,
    restore: `fixture-restore-${run}`,
  };
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
  const names = fixtureNames(run);

  requireCondition(
    [names.source, names.restored, names.static].includes(namespace),
    "Refusing cleanup outside this fixture run",
  );
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

export function staticFixtures(owner: string, run: string): KubeResource[] {
  requireCondition(owner, "Fixture ownership is required");
  const names = fixtureNames(run);
  const labels = { [OWNER_LABEL]: owner, [FIXTURE_LABEL]: run, [FIXTURE_MODE]: "synthetic" };
  const metadata = (name: string) => ({ name, namespace: names.static, labels });
  const completed = new Set(["Completed", "PartiallyFailed", "Failed", "FailedValidation"]);
  const status = (phase: string, progressField: string) => ({
    phase,
    ...(phase === "New" ? {} : { startTimestamp: "2026-09-01T10:00:00Z" }),
    ...(completed.has(phase) ? { completionTimestamp: "2026-09-01T10:01:00Z" } : {}),
    progress: { totalItems: 10, [progressField]: phase === "Completed" || phase.startsWith("Finalizing") ? 10 : 4 },
    errors: phase.includes("Failed") ? 1 : 0,
    warnings: phase === "PartiallyFailed" ? 1 : 0,
    ...(phase === "FailedValidation"
      ? { validationErrors: ["Synthetic validation error; no operation was executed"] }
      : {}),
  });
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
  kubectl(args: string[], input?: string, timeout?: number): string;
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
  const manifests = staticFixtures(runtime.owner, run);
  const snapshots: KubeResource[] = [];

  for (const manifest of manifests) {
    const initial = structuredClone(manifest);

    delete initial.status;
    runtime.apply(initial);
    if (manifest.status) {
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
