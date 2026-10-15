import { timestamp } from "./duration";

import type { ScheduleResource } from "./types";

// The phases of a schedule in Velero v1.18.4. The controller writes Enabled or FailedValidation into a
// schedule it reads, and nothing into one it does not read: a schedule that is paused.
export const SCHEDULE_PHASES = ["New", "Enabled", "FailedValidation"] as const;

export type Validation =
  // Velero read the expression and took it.
  | "valid"
  | "invalid"
  // Velero has not said: the schedule is new, or reports no phase.
  | "not-validated"
  // A phase this version does not know.
  | "unknown";

export interface ScheduleState {
  // The text the object reports, kept as it is; absent when the object reports none.
  reported?: string;
  recognized: boolean;
  validation: Validation;
  label: string;
}

const STATES: Record<string, { validation: Validation; label: string }> = {
  New: { validation: "not-validated", label: "New" },
  Enabled: { validation: "valid", label: "Enabled" },
  FailedValidation: { validation: "invalid", label: "Failed validation" },
};

export function scheduleState(phase: unknown): ScheduleState {
  if (typeof phase !== "string" || phase === "") {
    return { recognized: false, validation: "not-validated", label: "Not reported" };
  }
  const state = STATES[phase];

  if (!state) return { reported: phase, recognized: false, validation: "unknown", label: `Unknown: ${phase}` };
  return { reported: phase, recognized: true, ...state };
}

// The time zone an expression is read in. The expression names it with a prefix, or names none: it is then
// the one of the server of Velero, which no object of the views holds. It is never the one of the desktop.
// The name is what is between the prefix and the first space, with matching quotes taken off, as the release
// takes it: it may be empty, which the reviewed release refuses, and it may be Local, the zone of the server.
export type Zone = { of: "expression"; prefix: "TZ" | "CRON_TZ"; name: string } | { of: "server" } | { of: "none" };

export interface Expression {
  // As it is written in the object. The view of a schedule computes nothing from it: the runs it is expected
  // at are the signal of schedule-signal.ts.
  written?: string;
  zone: Zone;
}

export function expression(value: unknown): Expression {
  if (typeof value !== "string" || value.trim() === "") return { zone: { of: "none" } };
  const prefix = /^(TZ|CRON_TZ)=/.exec(value);

  if (!prefix) return { written: value, zone: { of: "server" } };
  const space = value.indexOf(" ");

  // A prefix with nothing after it is an expression the release refuses: it names no zone to read it in.
  if (space === -1) return { written: value, zone: { of: "none" } };
  let name = value.slice(prefix[0].length, space);
  // The parser of the reviewed release takes off quotes that match around the name before it reads it
  // (go-cron v0.15.0, parser.go L341-L349): TZ="" names no zone, which it refuses, and TZ='UTC' names UTC.
  const quoted = name.length >= 2 && (name[0] === '"' || name[0] === "'") && name[name.length - 1] === name[0];

  if (quoted) name = name.slice(1, -1);
  return { written: value, zone: { of: "expression", prefix: prefix[1] as "TZ" | "CRON_TZ", name } };
}

// The words of the time zone of an expression. The zone of the server is not read: the adherence of a
// schedule derives it from the backups, or says that it is not known.
export const ZONE_WORDS = {
  named: (name: string) => `${name}, named by the expression`,
  // The reviewed release refuses a name that is empty (go-cron v0.15.0, parser.go L1398-L1402).
  empty: "None: the expression names a time zone with no name, which the reviewed release refuses",
  local: "The one of the Velero server, which the expression names Local and this view does not read",
  server: "The one of the Velero server, which this view does not read",
  none: "Not reported",
};

export function zoneText(zone: Zone): string {
  switch (zone.of) {
    case "expression":
      if (zone.name === "") return ZONE_WORDS.empty;
      if (zone.name === "Local") return ZONE_WORDS.local;
      return ZONE_WORDS.named(zone.name);
    case "server":
      return ZONE_WORDS.server;
    default:
      return ZONE_WORDS.none;
  }
}

export type Paused = "paused" | "not-paused";

// What the list and the workspace show of a schedule, and the section of the details of the host, as the
// object says it. Nothing here is computed from the expression: the next run, the expected run and what is
// overdue are the signal of schedule-signal.ts, beside this view.
export interface ScheduleView {
  name: string;
  namespace: string;
  uid?: string;
  created?: number;
  state: ScheduleState;
  paused: Paused;
  expression: Expression;
  validationErrors: string[];
  // When Velero last submitted a backup of the schedule. It is not when a backup last completed.
  lastSubmission?: number;
  lastSkipped?: number;
  skipImmediately?: boolean;
  // Whether the backups are owned by the schedule, as written; absent when it is not set.
  owned?: boolean;
  // What is to be known of the state, in words.
  notes: string[];
}

export const NOTES = {
  paused:
    "Velero does not read a schedule while it is paused: its validation and its errors are the ones written before the pause.",
  notRead: "Velero has not read this schedule yet.",
  notReadPaused: "Velero has not read this schedule, and will not until it is resumed.",
  skip: "When Velero reads the schedule again it writes the time of that reading as the last skipped, sets skip immediately back to no, and counts the next run from that time.",
  submission: "A submission is a backup that Velero asked for. How the backup ended is in the history.",
};

function texts(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string" && entry !== "")
    : [];
}

export function scheduleView(schedule: ScheduleResource): ScheduleView {
  const state = scheduleState(schedule.status?.phase);
  const paused: Paused = schedule.spec?.paused === true ? "paused" : "not-paused";
  const skip = typeof schedule.spec?.skipImmediately === "boolean" ? schedule.spec.skipImmediately : undefined;
  const owned =
    typeof schedule.spec?.useOwnerReferencesInBackup === "boolean"
      ? schedule.spec.useOwnerReferencesInBackup
      : undefined;
  const silent = state.reported === undefined;

  return {
    name: schedule.metadata.name,
    namespace: schedule.metadata.namespace ?? "",
    uid: schedule.metadata.uid,
    created: timestamp(schedule.metadata.creationTimestamp),
    state,
    paused,
    expression: expression(schedule.spec?.schedule),
    validationErrors: texts(schedule.status?.validationErrors),
    lastSubmission: timestamp(schedule.status?.lastBackup),
    lastSkipped: timestamp(schedule.status?.lastSkipped),
    ...(skip === undefined ? {} : { skipImmediately: skip }),
    ...(owned === undefined ? {} : { owned }),
    notes: [
      ...(silent ? [paused === "paused" ? NOTES.notReadPaused : NOTES.notRead] : []),
      ...(!silent && paused === "paused" ? [NOTES.paused] : []),
      ...(skip === true ? [NOTES.skip] : []),
    ],
  };
}

export function pausedText(paused: Paused): string {
  return paused === "paused" ? "Paused" : "Not paused";
}

export function ownedText(owned: boolean | undefined): string {
  if (owned === undefined) return "Not set";
  return owned ? "Yes" : "No";
}
