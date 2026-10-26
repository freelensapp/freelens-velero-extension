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
 * catches.
 */
export function writesOf(
  counts: Record<string, number>,
  patchedAtEveryLook: boolean,
  minutes: number,
): Record<string, number> {
  if (!Number.isFinite(minutes) || minutes < 0) {
    throw new Error(`The writes are counted over a window of minutes, and ${minutes} is not one`);
  }
  const looks = patchedAtEveryLook ? Math.floor(minutes) + 2 : 0;

  return Object.fromEntries(
    Object.entries(counts)
      .filter(([key]) => {
        const [verb, kind] = key.split(" ");

        return !["GET", "LIST", "WATCH"].includes(verb) && !(verb === "PATCH" && kind === "backupstoragelocations");
      })
      .map(([key, count]) => [key, key === SCHEDULE_PATCH ? Math.max(0, count - looks) : count] as const)
      .filter(([key, count]) => key !== SCHEDULE_PATCH || count > 0),
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
