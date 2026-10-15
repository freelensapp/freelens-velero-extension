import { formatDuration, timestamp } from "./duration";
import { hasItems } from "./read-state";
import { submissionBackup } from "./schedule-adherence";

import type { FamilyRead } from "./read-state";
import type { BackupResource, ScheduleResource } from "./types";

// What the views of a schedule say of its adherence (SPEC-0013, T3.2): the offset of the zone of the server of
// Velero, derived from the backups of the submissions and kept for the session as a plain value the views hold,
// and the clocks of this machine and of the cluster. Everything is a pure function on what was read of one
// installation and on the clock, which are arguments: no time is taken here, and no zone of the desktop or of
// the host is ever read.

const MINUTE = 60_000;
const QUARTER = 15 * MINUTE;
// The zones in use are from twelve hours west of UTC to fourteen hours east of it.
const WEST = -12 * 60;
const EAST = 14 * 60;

// What the signals of one installation are computed from: its schedules and its backups as they were read.
export interface AdherenceReads {
  schedules: FamilyRead<ScheduleResource>;
  backups: FamilyRead<BackupResource>;
}

// --- The zone of the server ---

// The offset of the clock of the server of Velero at a submission, read in the name of its backup. The
// controller names the backup with the wall clock of its process and writes the same instant, in UTC, into
// status.lastBackup (schedule_controller.go L257-L266, L291-L297; schedule_types.go L137-L140): the digits of
// the name read as UTC, minus the creation of the backup, are the offset of the zone of the server at that
// instant, once rounded to the quarter of an hour.
export interface ServerOffset {
  // Minutes east of UTC.
  minutes: number;
  // The schedule of the submission, and the backup the server named with its clock.
  schedule: string;
  backup: string;
  // The instant of the submission, status.lastBackup, and the creation of the backup.
  submission: number;
  created: number;
  // The newest submission whose backup gives another offset: the zone of the server changed its offset
  // between the two, which a rule of daylight saving time does, and the newest stands.
  changed?: { minutes: number; schedule: string; backup: string; submission: number };
}

// The wall clock that fourteen digits name, yyyymmddhhmmss, read as UTC; nothing when they name none, as a
// thirteenth month or a 25th hour.
function wallOfDigits(digits: string): number | undefined {
  const [year, month, day, hour, minute, second] = [0, 4, 6, 8, 10, 12].map((at, index) =>
    Number(digits.slice(at, index ? at + 2 : 4)),
  );
  const wall = Date.UTC(year, month - 1, day, hour, minute, second);
  const read = new Date(wall);

  if (
    read.getUTCFullYear() !== year ||
    read.getUTCMonth() !== month - 1 ||
    read.getUTCDate() !== day ||
    read.getUTCHours() !== hour ||
    read.getUTCMinutes() !== minute ||
    read.getUTCSeconds() !== second
  ) {
    return undefined;
  }
  return wall;
}

// The offset one schedule gives: of the backup of its last submission, the one T3.1 matches by its label, its
// namespace, its name of fourteen digits and its creation within a minute of the submission (REQ-162). The
// difference is rounded to the nearest quarter of an hour; a remainder of a minute or more, or an offset no
// zone in use has, is a name that is not the controller's, and gives nothing. A backup asked by hand is named
// in UTC by the command line (cli/backup/create.go L374-L375): one created in the same minute as a submission
// is taken as the controller's, and gives an offset of zero, which the spec accepts.
function offsetOf(schedule: ScheduleResource, backups: BackupResource[]): ServerOffset | undefined {
  const found = submissionBackup(schedule, backups);

  if (found.kind !== "found") return undefined;
  const wall = wallOfDigits(found.backup.metadata.name.slice(-14));
  const created = timestamp(found.backup.metadata.creationTimestamp);
  const submission = timestamp(schedule.status?.lastBackup);

  if (wall === undefined || created === undefined || submission === undefined) return undefined;
  const difference = wall - created;
  const rounded = Math.round(difference / QUARTER) * QUARTER;
  // A zero west of UTC is a zero: no offset is written with a sign it does not have.
  const minutes = rounded / MINUTE + 0;

  if (Math.abs(difference - rounded) >= MINUTE || minutes < WEST || minutes > EAST) return undefined;
  return {
    minutes,
    schedule: schedule.metadata.name,
    backup: found.backup.metadata.name,
    submission,
    created,
  };
}

// The offset of the installation: the one of its newest submission whose backup gives one, for every schedule,
// since one server process submits every schedule of an installation; with the newest submission that gives
// another offset, when one does.
function derivedOffset(schedules: ScheduleResource[], backups: BackupResource[]): ServerOffset | undefined {
  const offsets = schedules
    .map((schedule) => offsetOf(schedule, backups))
    .filter((offset): offset is ServerOffset => offset !== undefined)
    // From the newest submission, by name when two are of the same instant.
    .sort(
      (one, other) =>
        other.submission - one.submission ||
        (one.schedule < other.schedule ? -1 : one.schedule > other.schedule ? 1 : 0),
    );
  const [newest] = offsets;

  if (!newest) return undefined;
  const other = offsets.find((offset) => offset.minutes !== newest.minutes);

  return other
    ? {
        ...newest,
        changed: {
          minutes: other.minutes,
          schedule: other.schedule,
          backup: other.backup,
          submission: other.submission,
        },
      }
    : newest;
}

function sameOffset(one: ServerOffset, other: ServerOffset): boolean {
  return (
    one.minutes === other.minutes &&
    one.schedule === other.schedule &&
    one.backup === other.backup &&
    one.submission === other.submission &&
    one.created === other.created &&
    one.changed?.minutes === other.changed?.minutes &&
    one.changed?.backup === other.changed?.backup &&
    one.changed?.submission === other.changed?.submission
  );
}

// The offset kept for an installation, for the session: the views hold one for each installation and give it
// back with each read, and the newest evidence stands, so that the offset stays known once the backup it was
// read in expired or was deleted (REQ-162). A read that gives nothing, as backups that cannot be read, keeps
// what was kept; an offset that changed since the one kept says so, with the submission it was read in before.
// What is kept is returned as it was when nothing changed, so that a view can tell that nothing did.
export function keepOffset(previous: ServerOffset | undefined, reads: AdherenceReads): ServerOffset | undefined {
  const found =
    hasItems(reads.schedules) && hasItems(reads.backups)
      ? derivedOffset(reads.schedules.items, reads.backups.items)
      : undefined;

  if (!found) return previous;
  if (!previous) return found;
  if (found.submission < previous.submission) return previous;
  let kept = found;

  if (!found.changed) {
    if (previous.minutes !== found.minutes) {
      kept = {
        ...found,
        changed: {
          minutes: previous.minutes,
          schedule: previous.schedule,
          backup: previous.backup,
          submission: previous.submission,
        },
      };
    } else if (previous.changed) {
      kept = { ...found, changed: previous.changed };
    }
  }
  return sameOffset(kept, previous) ? previous : kept;
}

// --- The clocks ---

// The time of the API server, from the Date header of one of its answers, and the clock of this machine when
// that answer came.
export interface ApiServerTime {
  date: number;
  at: number;
}

type Reported = "creation" | "submission" | "skip" | "start";

interface Latest {
  // How far after the clock of this machine at the read the time is.
  after: number;
  by: { kind: "schedule" | "backup"; name: string; time: Reported };
}

export interface Clocks {
  now: number;
  // By how much the clock of the cluster is ahead of this machine at least: by the time an object reports
  // after the clock of this machine at the read that brought it, a creation, a submission, a skip or the start
  // of a backup. Zero when none does: a clock of the cluster that is behind leaves no trace in the objects.
  ahead: number;
  by?: Latest["by"];
  // The time of the API server minus the clock of this machine, measured at a read, when it was given.
  server?: number;
  // No schedule of the installation is said overdue by less than this: the larger of the two.
  bound: number;
  words: string;
}

// The latest time the objects of a read report after the clock of this machine at that read: found once for a
// read, since the clock of the views ticks between two reads and a list asks at every tick.
const LATEST = new WeakMap<object, { reference: number; latest?: Latest }>();

function latestOf<Item extends { metadata: { name: string } }>(
  read: FamilyRead<Item>,
  kind: Latest["by"]["kind"],
  times: (item: Item) => [Reported, unknown][],
): Latest | undefined {
  // The clock of this machine when the read ended: an object read then cannot report a later time unless
  // the clock of the cluster is ahead, whatever the clock of the views says since.
  const reference = read.lastSuccess;

  if (!hasItems(read) || reference === undefined) return undefined;
  const known = LATEST.get(read.items);

  if (known?.reference === reference) return known.latest;
  let latest: Latest | undefined;

  for (const item of read.items) {
    for (const [time, value] of times(item)) {
      const at = timestamp(value);

      if (at !== undefined && at - reference > (latest?.after ?? 0)) {
        latest = { after: at - reference, by: { kind, name: item.metadata.name, time } };
      }
    }
  }
  LATEST.set(read.items, { reference, ...(latest ? { latest } : {}) });
  return latest;
}

const REPORTED: Record<Reported, string> = {
  creation: "its creation",
  submission: "its last submission",
  skip: "its last skip",
  start: "its start",
};

export const CLOCK_WORDS = {
  compared: "Times are compared by the clock of this machine.",
  // Without the time of the API server only a clock of the cluster that is ahead can be seen.
  aheadOnly: "Only a clock of the cluster that is ahead of it can be seen, by a time an object reports after it",
  noneAhead: "no object does.",
  ahead: (by: Latest["by"], after: number) =>
    `the clock of the cluster is ahead by at least ${formatDuration(after)}, since the ${by.kind} ${by.name} reports ${REPORTED[by.time]} that much after it.`,
  // With the time of the API server, the two clocks are compared through it, both ways.
  server: (difference: number) =>
    `The clock of the cluster is compared with it through the time its API server writes in its answers: ${
      Math.abs(difference) < 1000
        ? "the two agree within a second"
        : `the cluster is ${difference > 0 ? "ahead" : "behind"} by ${formatDuration(Math.abs(difference))}`
    }.`,
  object: (by: Latest["by"], after: number) =>
    `The ${by.kind} ${by.name} reports ${REPORTED[by.time]} ${formatDuration(after)} after the clock of this machine.`,
  bound: (bound: number) => `No schedule of the installation is said overdue by less than ${formatDuration(bound)}.`,
};

// The clocks of an installation for a read (REQ-166): the signals are computed by the clock of this machine,
// taken once for a read; a time the cluster wrote after it bounds what is said overdue, and so does the
// difference with the time of the API server, both ways, when the reader can see it.
export function clocksOf(reads: AdherenceReads, now: number, server?: ApiServerTime): Clocks {
  const latest = [
    latestOf(reads.schedules, "schedule", (schedule) => [
      ["creation", schedule.metadata.creationTimestamp],
      ["submission", schedule.status?.lastBackup],
      ["skip", schedule.status?.lastSkipped],
    ]),
    latestOf(reads.backups, "backup", (backup) => [
      ["creation", backup.metadata.creationTimestamp],
      ["start", backup.status?.startTimestamp],
    ]),
  ].reduce<Latest | undefined>((one, other) => (other && (!one || other.after > one.after) ? other : one), undefined);
  const ahead = latest?.after ?? 0;
  const difference = server ? server.date - server.at : undefined;
  const bound = Math.max(ahead, difference === undefined ? 0 : Math.abs(difference));
  const words =
    difference === undefined
      ? [
          CLOCK_WORDS.compared,
          `${CLOCK_WORDS.aheadOnly}: ${latest ? CLOCK_WORDS.ahead(latest.by, ahead) : CLOCK_WORDS.noneAhead}`,
        ]
      : [
          CLOCK_WORDS.compared,
          CLOCK_WORDS.server(difference),
          latest && ahead > Math.abs(difference) ? CLOCK_WORDS.object(latest.by, ahead) : "",
        ];

  if (bound >= 1000) words.push(CLOCK_WORDS.bound(bound));
  return {
    now,
    ahead,
    ...(latest ? { by: latest.by } : {}),
    ...(difference === undefined ? {} : { server: difference }),
    bound,
    words: words.filter(Boolean).join(" "),
  };
}
