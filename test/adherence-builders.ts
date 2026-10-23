// What the tests of the views build the schedules and the backups of an installation with: the objects as the API
// gives them, with what the adherence of a schedule reads in them. Every time is an argument: no object is made
// with the clock of the machine that runs the tests.

import { LABELS } from "../src/common/types";

import type { BackupResource, ScheduleResource, ScheduleSpec, ScheduleStatus } from "../src/common/types";

export const MINUTE = 60_000;
export const HOUR = 3_600_000;

// A time as the API writes one: to the second.
export function iso(time: number): string {
  return new Date(time).toISOString().replace(/\.\d{3}Z$/, "Z");
}

export interface ScheduleOf {
  expression?: string;
  phase?: string;
  lastBackup?: number;
  lastSkipped?: number;
  paused?: boolean;
  skipImmediately?: boolean;
  created?: number;
  validationErrors?: string[];
}

// A schedule of a namespace, as the API gives it: Enabled with the expression of a daily run unless told
// otherwise, and created on the first of August.
export function scheduleObject(name: string, namespace: string, of: ScheduleOf = {}): ScheduleResource {
  const spec: ScheduleSpec = {
    schedule: of.expression ?? "0 3 * * *",
    template: { includedNamespaces: ["shop"], storageLocation: "default", ttl: "720h0m0s" },
    ...(of.paused === undefined ? {} : { paused: of.paused }),
    ...(of.skipImmediately === undefined ? {} : { skipImmediately: of.skipImmediately }),
  };
  const status: ScheduleStatus = {
    ...(of.phase === "" ? {} : { phase: of.phase ?? "Enabled" }),
    ...(of.lastBackup === undefined ? {} : { lastBackup: iso(of.lastBackup) }),
    ...(of.lastSkipped === undefined ? {} : { lastSkipped: iso(of.lastSkipped) }),
    ...(of.validationErrors ? { validationErrors: of.validationErrors } : {}),
  };

  return {
    apiVersion: "velero.io/v1",
    kind: "Schedule",
    metadata: {
      name,
      namespace,
      uid: `${namespace}-schedule-${name}`,
      resourceVersion: "1",
      creationTimestamp: iso(of.created ?? Date.parse("2026-08-01T00:00:00Z")),
    },
    spec,
    ...(Object.keys(status).length ? { status } : {}),
  };
}

export interface BackupOf {
  // The schedule whose label the backup carries; none when it is empty.
  schedule?: string;
  // The phase the backup reports; none when it is empty.
  phase?: string;
  start?: number;
}

// A backup of a namespace, created at a time, with the label of the schedule its name begins with unless told
// otherwise.
export function backupObject(name: string, namespace: string, created: number, of: BackupOf = {}): BackupResource {
  const schedule = of.schedule ?? name.replace(/-\d+$/, "");

  return {
    apiVersion: "velero.io/v1",
    kind: "Backup",
    metadata: {
      name,
      namespace,
      uid: `${namespace}-backup-${name}`,
      resourceVersion: "1",
      creationTimestamp: iso(created),
      labels: schedule === "" ? {} : { [LABELS.schedule]: schedule },
    },
    spec: { includedNamespaces: ["shop"], storageLocation: "default" },
    status: {
      ...(of.phase === "" ? {} : { phase: of.phase ?? "Completed" }),
      ...(of.start === undefined ? {} : { startTimestamp: iso(of.start) }),
    },
  };
}

// The fourteen digits of a wall clock, as the controller names a backup: the instant written as UTC.
export function digits(wall: number): string {
  return new Date(wall).toISOString().replace(/[-:T]/g, "").slice(0, 14);
}

// The backup the controller creates for a submission of a schedule, in a server whose zone is so many minutes
// east of UTC: named with the wall clock of the submission, and created a second after it.
export function submissionOf(
  schedule: string,
  namespace: string,
  submission: number,
  minutes: number,
  of: Omit<BackupOf, "schedule"> & { created?: number } = {},
): BackupResource {
  return backupObject(
    `${schedule}-${digits(submission + minutes * MINUTE)}`,
    namespace,
    of.created ?? submission + 1000,
    {
      schedule,
      ...(of.phase === undefined ? {} : { phase: of.phase }),
      ...(of.start === undefined ? {} : { start: of.start }),
    },
  );
}
