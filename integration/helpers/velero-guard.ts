/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

// What the guard of the suites decides from what the helpers read of the cluster, with nothing read here: the
// requests that write, among the ones the API server counted, and whether the schedule the controller of the
// installation validated submitted a backup. Kept apart from the helpers that read, so that the unit tests prove
// it without a cluster.

/** The PATCH of a schedule by name, as the counters of the API server key it. */
const SCHEDULE_PATCH = "PATCH schedules resource";

/**
 * The requests that change something, or ask Velero for something, among the
 * ones counted over a window of `minutes`: every request of every kind of
 * `velero.io` that is not a read. One is left out, which the installation
 * under test makes by itself: its controller writes into the status of its
 * storage location every time it validates it. So is the PATCH of a schedule
 * by name, when `patchedAtEveryLook` says that its controller sends one at
 * every look, once a minute, but no more of them than the whole minutes of the
 * window and two: the ones above that bound, and a PATCH of a schedule of
 * another scope, are writes. The counters carry no namespace, and a PATCH of
 * a synthetic schedule within the bound is left out with the ones of the
 * controller, which the version of that schedule in the snapshot still
 * catches. When `repositoryWrittenAtEachPass` names the verb of the request
 * the server sends to the real repository at its pass, that verb of the
 * repositories is left out as the PATCH of the locations is, and the status of
 * the real repository and the versions of the synthetic ones in the snapshot
 * catch a write of a suite.
 */
export function writesOf(
  counts: Record<string, number>,
  patchedAtEveryLook: boolean,
  minutes: number,
  repositoryWrittenAtEachPass?: string,
): Record<string, number> {
  if (!Number.isFinite(minutes) || minutes < 0) {
    throw new Error(`The writes are counted over a window of minutes, and ${minutes} is not one`);
  }
  const looks = patchedAtEveryLook ? Math.floor(minutes) + 2 : 0;

  return Object.fromEntries(
    Object.entries(counts)
      .filter(([key]) => {
        const [verb, kind] = key.split(" ");

        return (
          !["GET", "LIST", "WATCH"].includes(verb) &&
          !(verb === "PATCH" && kind === "backupstoragelocations") &&
          !(verb === repositoryWrittenAtEachPass && kind === "backuprepositories")
        );
      })
      .map(([key, count]) => [key, key === SCHEDULE_PATCH ? Math.max(0, count - looks) : count] as const)
      .filter(([key, count]) => key !== SCHEDULE_PATCH || count > 0),
  );
}

/**
 * What the snapshot of a suite holds of an object of the namespace of the
 * installation beside its identity, which a write of the suite would change:
 * the version and the status of a schedule, the one the controller validated,
 * whose submission writes into its status; the version and the status of a
 * repository, or its status alone when the server writes the repository at
 * each of its passes (`repositoryWrittenAtEachPass`). Nothing of the other
 * kinds, which the server and the node agent write only while a backup or a
 * restore is at work, and no suite runs beside one.
 */
export function installedVersion(
  kind: string,
  item: { metadata: { resourceVersion: string }; status?: unknown },
  repositoryWrittenAtEachPass?: string,
): string | undefined {
  const status = JSON.stringify(item.status ?? {});

  if (kind === "schedules") return `${item.metadata.resourceVersion} ${status}`;
  if (kind === "backuprepositories")
    return repositoryWrittenAtEachPass ? status : `${item.metadata.resourceVersion} ${status}`;
  return undefined;
}

/** The kinds of the operations of a volume, which a view lists in a namespace only while it shows them. */
export const OPERATION_KINDS = ["podvolumebackups", "podvolumerestores", "datauploads", "datadownloads"];

/**
 * The lists of the kinds of the operations of a volume in a namespace, among
 * the ones counted over a window with a view open (`during`), by kind: every
 * one, when no controller of the installation lists them; when one does
 * (`listedByAController`), the ones above what a window of the same length
 * with no view open counted (`without`), which is then required. A kind that
 * was listed no more is not named.
 */
export function operationListsOf(
  during: Record<string, number>,
  listedByAController: boolean,
  without?: Record<string, number>,
): Record<string, number> {
  if (listedByAController && without === undefined) {
    throw new Error(
      "A controller of the installation lists the operations: the lists of a view are counted against a window of the same length with no view open",
    );
  }
  const lists = (counts: Record<string, number>) =>
    OPERATION_KINDS.map((kind) => [kind, counts[`LIST ${kind} namespace`] ?? 0] as const);
  const base = new Map(listedByAController ? lists(without ?? {}) : []);

  return Object.fromEntries(
    lists(during)
      .map(([kind, count]) => [kind, Math.max(0, count - (base.get(kind) ?? 0))] as const)
      .filter(([, count]) => count > 0),
  );
}

/** A schedule or a backup of the installation, as far as the guard reads it. */
export interface InstalledObject {
  kind?: string;
  metadata: { name: string; labels?: Record<string, string> };
  status?: { lastBackup?: string } | null;
}

/**
 * What a suite says before it starts when the schedule the controller
 * validated, `name`, submitted a backup since its placement found it with
 * none: its last submission, and each backup that carries its label, among
 * the schedules and the backups of the installation. Nothing when it
 * submitted none. Each suite compares the installation with itself, from its
 * first snapshot: a backup submitted before that snapshot would be in it, and
 * no suite would see it.
 */
export function realScheduleSubmission(name: string, items: InstalledObject[]): string | undefined {
  const schedule = items.find((item) => item.kind === "Schedule" && item.metadata.name === name);
  const backups = items
    .filter((item) => item.kind === "Backup" && item.metadata.labels?.["velero.io/schedule-name"] === name)
    .map((item) => item.metadata.name);
  const submitted = [
    ...(schedule?.status?.lastBackup ? [`its last submission is ${schedule.status.lastBackup}`] : []),
    ...backups.map((backup) => `the backup ${backup} carries its label`),
  ];

  return submitted.length
    ? `The schedule ${name} submitted a backup since its placement found it with none: ${submitted.join(", ")}. ` +
        "No suite expects one. Create the environment again with `pnpm demo:down` and `pnpm demo:up`."
    : undefined;
}
