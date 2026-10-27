// The objects of the backup repositories and of the pod volume operations, and of their owners, as the reviewed
// release writes them (SPEC-0014, what the release does), for the tests of every layer. Every name, namespace,
// node and identifier is synthetic.

import type { FamilyRead, ReadStatus } from "../src/common/read-state";
import type {
  BackupRepositoryResource,
  BackupRepositorySpec,
  BackupRepositoryStatus,
  BackupResource,
  PodVolumeBackupResource,
  PodVolumeBackupSpec,
  PodVolumeBackupStatus,
  PodVolumeRestoreResource,
  PodVolumeRestoreSpec,
  PodVolumeRestoreStatus,
  RestoreResource,
} from "../src/common/types";

export const INSTALLATION = "velero";
export const NOW = Date.parse("2026-10-26T12:00:00Z");
export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

// A time of the API, so long before the clock of the tests.
export function before(milliseconds: number): string {
  return new Date(NOW - milliseconds).toISOString().replace(".000Z", "Z");
}

interface Made {
  namespace?: string;
  uid?: string;
  created?: string;
  labels?: Record<string, string>;
  annotations?: Record<string, string>;
  ownerReferences?: { apiVersion?: string; kind?: string; name?: string; uid?: string; controller?: boolean }[];
}

function metadata(kind: string, name: string, made: Made) {
  const namespace = made.namespace ?? INSTALLATION;

  return {
    name,
    namespace,
    uid: made.uid ?? `${kind.toLowerCase()}-${name}`,
    resourceVersion: "1",
    creationTimestamp: made.created ?? before(DAY),
    ...(made.labels ? { labels: made.labels } : {}),
    ...(made.annotations ? { annotations: made.annotations } : {}),
    ...(made.ownerReferences ? { ownerReferences: made.ownerReferences } : {}),
  };
}

export function backup(name: string, phase = "Completed", made: Made = {}): BackupResource {
  return { apiVersion: "velero.io/v1", kind: "Backup", metadata: metadata("Backup", name, made), status: { phase } };
}

export function restore(name: string, phase = "Completed", made: Made = {}): RestoreResource {
  return {
    apiVersion: "velero.io/v1",
    kind: "Restore",
    metadata: metadata("Restore", name, made),
    spec: { backupName: "nightly" },
    status: { phase },
  };
}

// The labels and the owner reference the release writes on an operation of a backup or a restore.
export function ownedBy(kind: "Backup" | "Restore", owner: { metadata: { name: string; uid?: string } }): Made {
  const label = kind === "Backup" ? "backup" : "restore";

  return {
    labels: {
      [`velero.io/${label}-name`]: owner.metadata.name,
      [`velero.io/${label}-uid`]: owner.metadata.uid ?? "",
    },
    ownerReferences: [
      { apiVersion: "velero.io/v1", kind, name: owner.metadata.name, uid: owner.metadata.uid, controller: true },
    ],
  };
}

export function podVolumeBackup(
  name: string,
  status: PodVolumeBackupStatus | undefined,
  made: Made & { spec?: Partial<PodVolumeBackupSpec> } = {},
): PodVolumeBackupResource {
  return {
    apiVersion: "velero.io/v1",
    kind: "PodVolumeBackup",
    metadata: metadata("PodVolumeBackup", name, made),
    spec: {
      node: "worker-1",
      pod: { kind: "Pod", namespace: "shop", name: "cart-0", uid: "pod-cart-0" },
      volume: "data",
      backupStorageLocation: "default",
      uploaderType: "kopia",
      tags: { backup: "nightly", ns: "shop", pod: "cart-0", volume: "data" },
      ...made.spec,
    },
    ...(status ? { status } : {}),
  };
}

export function podVolumeRestore(
  name: string,
  status: PodVolumeRestoreStatus | undefined,
  made: Made & { spec?: Partial<PodVolumeRestoreSpec> } = {},
): PodVolumeRestoreResource {
  return {
    apiVersion: "velero.io/v1",
    kind: "PodVolumeRestore",
    metadata: metadata("PodVolumeRestore", name, made),
    spec: {
      pod: { kind: "Pod", namespace: "shop-restored", name: "cart-0", uid: "pod-restored-cart-0" },
      volume: "data",
      backupStorageLocation: "default",
      uploaderType: "kopia",
      snapshotID: "f3c1d2e4a5b6c7d8",
      snapshotSize: 1_048_576,
      sourceNamespace: "shop",
      ...made.spec,
    },
    ...(status ? { status } : {}),
  };
}

// A repository with the three labels the release names one with.
export function repository(
  name: string,
  status: BackupRepositoryStatus | undefined,
  made: Made & { spec?: Partial<BackupRepositorySpec> } = {},
): BackupRepositoryResource {
  const spec = {
    volumeNamespace: "shop",
    backupStorageLocation: "default",
    repositoryType: "kopia",
    maintenanceFrequency: "168h0m0s",
    ...made.spec,
  };

  return {
    apiVersion: "velero.io/v1",
    kind: "BackupRepository",
    metadata: metadata("BackupRepository", name, {
      ...made,
      labels: made.labels ?? {
        "velero.io/volume-namespace": spec.volumeNamespace ?? "",
        "velero.io/storage-location": spec.backupStorageLocation ?? "",
        "velero.io/repository-type": spec.repositoryType ?? "",
      },
    }),
    spec,
    ...(status ? { status } : {}),
  };
}

// What was read of a family: its items and its status, with the time a read that succeeded leaves.
export function read<Item>(items: Item[], status: ReadStatus = "ready", lastSuccess?: number): FamilyRead<Item> {
  return {
    status,
    items,
    ...(status === "ready" ? { lastSuccess: lastSuccess ?? NOW } : lastSuccess === undefined ? {} : { lastSuccess }),
  };
}
