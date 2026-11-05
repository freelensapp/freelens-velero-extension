/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

// What the suites of the backup repositories and of the pod volume operations expect a view to show, computed
// from the object as the cluster holds it and from the clock, by the rules of the reviewed release that SPEC-0014
// records, and never by the code of the extension. The words are the ones the module of the words writes, copied
// here as they are written; a time and a duration are written here in the form of the views.

/** The words of the views of a repository, as the module of the words writes them. */
export const REPOSITORY_WORDS = {
  notSet: "Not set",
  neverMaintained: "Never maintained",
  newestFailed: "the newest maintenance failed",
};

/** The readiness of a repository, by the phase the release writes into its status. */
export const READINESS = {
  ready: { word: "Ready", rank: 0 },
  notReady: { word: "Not ready", rank: 1 },
  notInitialized: { word: "Not initialized yet", rank: 2 },
} as const;

/** A BackupRepository as the cluster holds it, with what the views read of it. */
export interface RepositoryObject {
  metadata: { name: string; namespace: string; creationTimestamp?: string };
  spec?: {
    volumeNamespace?: string;
    backupStorageLocation?: string;
    repositoryType?: string;
    maintenanceFrequency?: string;
  };
  status?: {
    phase?: string;
    message?: string;
    lastMaintenanceTime?: string;
    recentMaintenance?: { startTimestamp?: string; completeTimestamp?: string; result?: string; message?: string }[];
  };
}

/**
 * The readiness of a repository: none until the release initializes it, which writes `New` first and then
 * `Ready` or `NotReady`.
 */
export function readinessOf(repository: RepositoryObject): (typeof READINESS)[keyof typeof READINESS] {
  switch (repository.status?.phase) {
    case "Ready":
      return READINESS.ready;
    case "NotReady":
      return READINESS.notReady;
    default:
      return READINESS.notInitialized;
  }
}

/**
 * Whether the newest maintenance of a repository failed: the newest of its recent maintenances by their start,
 * which the release keeps newest last, whose result is Failed. Its last maintenance is then the one before.
 */
export function newestMaintenanceFailed(repository: RepositoryObject): boolean {
  const recent = [...(repository.status?.recentMaintenance ?? [])].sort(
    (one, other) => Date.parse(one.startTimestamp ?? "") - Date.parse(other.startTimestamp ?? ""),
  );

  return recent.at(-1)?.result === "Failed";
}

/** A duration as the views write it: its two largest units that are not zero, from days to seconds. */
function durationText(milliseconds: number): string {
  const seconds = Math.floor(milliseconds / 1000);
  const parts: [number, string][] = [
    [Math.floor(seconds / 86_400), "d"],
    [Math.floor((seconds % 86_400) / 3600), "h"],
    [Math.floor((seconds % 3600) / 60), "m"],
    [seconds % 60, "s"],
  ];
  const first = parts.findIndex(([value]) => value > 0);

  if (first === -1) return "0s";
  return parts
    .slice(first, first + 2)
    .filter(([value]) => value > 0)
    .map(([value, unit]) => `${value}${unit}`)
    .join(" ");
}

/**
 * What the cell of the last maintenance of a repository may say when it is read between two readings of the
 * clock: how long ago the last maintenance was at either of them, with the words of a newest one that failed,
 * or that there was none.
 */
export function maintainedTexts(repository: RepositoryObject, readFrom: number, readTo: number): string[] {
  const last = repository.status?.lastMaintenanceTime;
  const failed = newestMaintenanceFailed(repository) ? `, ${REPOSITORY_WORDS.newestFailed}` : "";

  if (!last) return [`${REPOSITORY_WORDS.neverMaintained}${failed}`];
  const at = Date.parse(last);

  return [...new Set([readFrom, readTo].map((now) => `${durationText(now - at)} ago${failed}`))];
}

/** What the cells of the row of a repository show that does not depend on the clock, by their columns. */
export function repositoryCells(repository: RepositoryObject): Record<string, string> {
  return {
    name: repository.metadata.name,
    installation: repository.metadata.namespace,
    "volume-namespace": repository.spec?.volumeNamespace ?? REPOSITORY_WORDS.notSet,
    location: repository.spec?.backupStorageLocation ?? REPOSITORY_WORDS.notSet,
    "repository-type": repository.spec?.repositoryType || REPOSITORY_WORDS.notSet,
    readiness: readinessOf(repository).word,
    frequency: repository.spec?.maintenanceFrequency ?? REPOSITORY_WORDS.notSet,
  };
}
