import { formatDuration, timestamp } from "./duration";
import { unread } from "./location-users";
import { hasItems, isStale } from "./read-state";
import {
  anchorOf,
  COUNT_BOUND,
  expectedRun,
  expressionZone,
  GRACE,
  laterBackups,
  nextInstant,
  parseExpression,
  submissionBackup,
  UTC,
  zoneOffset,
} from "./schedule-adherence";
import { backupsOf } from "./schedule-history";
import { NOTES, scheduleState } from "./schedule-view";

import type { FamilyRead, ReadStatus } from "./read-state";
import type { Anchor, ParsedExpression, Zone } from "./schedule-adherence";
import type { ScheduleState } from "./schedule-view";
import type { BackupResource, ScheduleResource } from "./types";

// What the views of a schedule say of its adherence (SPEC-0013, T3.2): the state of a schedule with its mark, its
// weight in an order and its words, the offset of the zone of the server of Velero, derived from the backups of
// the submissions and kept for the session as a plain value the views hold, the backup that holds the
// submissions, the last observed run and the clocks of this machine and of the cluster. Everything is a pure
// function on what was read of one installation and on the clock, which are arguments: no time is taken here,
// and no zone of the desktop or of the host is ever read. A time inside a sentence is written in the zone the
// expression is read in, with the name or the offset of that zone, and a duration as the views write every
// duration.

const SECOND = 1000;
const MINUTE = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;
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
  // The clock the lateness is counted by: the one of the cluster, the clock of this machine plus the
  // difference with the time of the API server when it is given, and the clock of this machine when it is not.
  cluster: number;
  // By how much the clock of the cluster is ahead of this machine at least: by the time an object reports
  // after the clock of this machine at the read that brought it, a creation, a submission, a skip or the start
  // of a backup. Zero when none does, or by less than a second: a clock of the cluster that is behind leaves
  // no trace in the objects.
  ahead: number;
  by?: Latest["by"];
  // The time of the API server minus the clock of this machine, measured at a read, when it was given.
  server?: number;
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
  // Without the time of the API server: the lateness by the clock of this machine, beside which only a clock
  // of the cluster that is ahead can be seen.
  compared: "Times are compared by the clock of this machine.",
  aheadOnly: "Only a clock of the cluster that is ahead of it can be seen, by a time an object reports after it",
  noneAhead: "no object does.",
  ahead: (by: Latest["by"], after: number) =>
    `the clock of the cluster is ahead by at least ${formatDuration(after)}, since the ${by.kind} ${by.name} reports ${REPORTED[by.time]} that much after it.`,
  // The controller counts by its own clock: a cluster that is ahead makes the lateness longer, never shorter.
  laterStill: "By the clock of the cluster a run may be later still than this machine counts it.",
  // With the time of the API server: the lateness by the clock of the cluster, both ways.
  server: (difference: number) =>
    `Times are compared by the clock of the cluster, which the time its API server writes in its answers gives: ${
      Math.abs(difference) < SECOND
        ? "it is within a second of the clock of this machine"
        : `it is ${difference > 0 ? "ahead of" : "behind"} the clock of this machine by ${formatDuration(Math.abs(difference))}`
    }.`,
  object: (by: Latest["by"], after: number) =>
    `The ${by.kind} ${by.name} reports ${REPORTED[by.time]} ${formatDuration(after)} after the clock of this machine, later than the clock of the API server: by the clock that wrote it a run may be later still.`,
};

// The clocks of an installation for a read (REQ-166): the lateness is counted by the clock of this machine,
// taken once for a read, and by the clock of the cluster when the time of the API server is given, the clock
// of this machine plus the difference measured at the read, both ways. A time the cluster wrote after the
// clock of this machine says that the cluster is ahead by at least that much and bounds nothing that is said
// overdue: the controller decides that a run is due by its own clock (schedule_controller.go L242, L288), so
// a cluster that is ahead makes the lateness longer, never shorter. Less than a second is not said.
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
  const seen = latest && latest.after >= SECOND ? latest : undefined;
  const ahead = seen?.after ?? 0;
  const difference = server ? server.date - server.at : undefined;
  const words =
    difference === undefined
      ? [
          CLOCK_WORDS.compared,
          `${CLOCK_WORDS.aheadOnly}: ${seen ? CLOCK_WORDS.ahead(seen.by, ahead) : CLOCK_WORDS.noneAhead}`,
          seen ? CLOCK_WORDS.laterStill : "",
        ]
      : [
          CLOCK_WORDS.server(difference),
          // A clock that wrote an object is ahead of the one of the API server: the controller may be the one.
          seen && ahead - difference >= SECOND ? CLOCK_WORDS.object(seen.by, ahead) : "",
        ];

  return {
    now,
    cluster: now + (difference ?? 0),
    ahead,
    ...(seen ? { by: seen.by } : {}),
    ...(difference === undefined ? {} : { server: difference }),
    words: words.filter(Boolean).join(" "),
  };
}

// --- The installation, for a read and a clock ---

// What the signals of one installation share for a read and a clock: computed once, and given to the signal of
// each of its schedules.
export interface AdherenceContext {
  now: number;
  reads: AdherenceReads;
  // The offset kept for the installation, when one was derived.
  offset?: ServerOffset;
  // Why none was, in words that go on a sentence, when none was.
  noOffset?: string;
  clocks: Clocks;
}

export function adherenceContext(
  reads: AdherenceReads,
  now: number,
  offset?: ServerOffset,
  server?: ApiServerTime,
): AdherenceContext {
  return {
    now,
    reads,
    ...(offset
      ? { offset }
      : {
          noOffset: hasItems(reads.backups)
            ? SIGNAL_WORDS.noSubmissionBackup
            : lower(unread("backups", reads.backups).reason),
        }),
    clocks: clocksOf(reads, now, server),
  };
}

// --- The states, their marks, their weights and their words ---

export type SignalState =
  | "awaited"
  | "due"
  | "overdue"
  | "held"
  | "at-every-look"
  | "not-known"
  // FailedValidation: no run.
  | "refused"
  | "paused";

// Why a signal is not known.
export type NotKnownReason =
  // No phase, or New: Velero has not read the schedule.
  | "not-read"
  | "unknown-phase"
  // This version cannot read an expression Velero took.
  | "not-readable"
  | "no-anchor"
  // The expression names no zone, or Local, and no offset of the server is derived.
  | "no-offset"
  // The expression names a zone this machine does not know.
  | "unknown-zone";

// The marks the views already use: the hollow one of what is awaited, the one of what is late that the last
// validation of a location has, the one of what is not known, the one of the validation for an expression
// Velero refused, and the one of what is paused.
export type SignalMark = "awaited" | "late" | "not-known" | "refused" | "paused";

const MARKS: Record<SignalState, SignalMark> = {
  awaited: "awaited",
  due: "awaited",
  overdue: "late",
  // Late once the grace passed, which the signal says.
  held: "awaited",
  "at-every-look": "not-known",
  "not-known": "not-known",
  refused: "refused",
  paused: "paused",
};

// The order by adherence (REQ-168): what needs a hand first, and what is not known before what is on time.
export const SIGNAL_WEIGHTS: Record<SignalState, number> = {
  overdue: 0,
  held: 1,
  due: 2,
  "at-every-look": 3,
  "not-known": 4,
  awaited: 5,
  refused: 6,
  paused: 7,
};

// What holds the submissions: a backup of the schedule that reports no phase, New or InProgress.
type Holding = "none" | "New" | "InProgress";

const HOLDING: Record<Holding, string> = {
  none: "reports no phase",
  New: "is New",
  InProgress: "is InProgress",
};

const ANCHORS: Record<Anchor["of"], string> = {
  "last-submission": "the last submission",
  creation: "the creation of the schedule",
  "last-skipped": "the last skip",
};

function lower(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1);
}

function capital(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

// The words of the signal, written once: the list, the band, the section of the details and the Overview say
// the same sentence for the same state.
export const SIGNAL_WORDS = {
  // The word of each state, beside its mark: who does not see the mark reads it.
  label: {
    awaited: "Awaited",
    due: "Due",
    overdue: "Overdue",
    held: "Held",
    "at-every-look": "At every look",
    "not-known": "Not known",
    refused: "No run",
    paused: "Paused",
  } satisfies Record<SignalState, string>,
  // What the cell of the next run says.
  none: "None",
  notKnown: "Not known",
  inTime: (duration: string) => `in ${duration}`,
  ago: (duration: string) => `${duration} ago`,
  // Where the controller counts from, one of three times.
  from: (of: Anchor["of"], moment: string) => `${ANCHORS[of]}, ${moment}`,
  awaited: (inTime: string, run: string, from: string) => `Next run in ${inTime}, at ${run}. Counted from ${from}.`,
  repeated: (date: string, zone: string, back: string, to: string, first: string, second: string) =>
    `On ${date} the clock of ${zone} goes back from ${back} to ${to}: the runs of the expression in the hour it repeats are expected twice, at ${first} and again at ${second}.`,
  due: (run: string, ago: string) => `Due: expected at ${run}, ${ago} ago. Velero looks at a schedule once a minute.`,
  overdue: (by: string, run: string, from: string, passed: string) =>
    `Overdue by ${by}: expected at ${run}. Counted from ${from}, with no submission since; ${passed}. Velero may not be at work, or may not be able to list the backups.`,
  passed: (count: number, beyond: boolean) =>
    beyond ? `more than ${COUNT_BOUND} expected runs passed` : `${count} expected run${count === 1 ? "" : "s"} passed`,
  held: (backup: string, phase: Holding) =>
    `Held: Velero submits nothing while the backup ${backup} ${HOLDING[phase]}.`,
  heldMore: (count: number) =>
    count === 1
      ? "One more of its backups holds the submissions as well."
      : `${count} more of its backups hold the submissions as well.`,
  heldExpected: (run: string, ago: string) => `A run was expected at ${run}, ${ago} ago.`,
  heldNext: (run: string, inTime: string) => `The next run is at ${run}, ${inTime}.`,
  atEveryLook: (what: string, last: string) =>
    `At every look: ${what}, and Velero submits a backup at each of its looks, once a minute, while none of the backups of the schedule reports no phase, New or InProgress. ${last}`,
  noInstant: (descriptor: string) => `${descriptor} has no instant`,
  beyondFiveYears: "the expression has no instant within five years",
  lastSubmission: (moment: string) => `Last submission ${moment}.`,
  noSubmissionYet: "No submission is written in the schedule yet.",
  heldNow: (backup: string, phase: Holding) => `The backup ${backup} ${HOLDING[phase]} now.`,
  noOffset: (local: boolean, why: string) =>
    `Not known: ${
      local
        ? "the expression names the time zone Local, the one of the Velero server, which is not read"
        : "the expression names no time zone, and the one of the Velero server is not read"
    }. It is derived from the backup of a last submission, of this schedule or of another of the installation, and ${why}. Name the zone in the expression, as CRON_TZ=Europe/Rome 0 3 * * * does, to have it read.`,
  noSubmissionBackup: "none is among the backups that exist",
  // A name this machine does not know is not one the server refused: Velero took the expression, which it
  // does only with a zone its server knows.
  unknownZone: (name: string) =>
    `Not known: the expression names the time zone ${name}, which this machine does not know, and the run cannot be computed here. Velero took the expression: its server knows the zone.`,
  notReadable: (reason: string) => `Not known: this version cannot read the expression, which Velero took: ${reason}.`,
  notRead: `Not known: ${NOTES.notRead}`,
  unknownPhase: (phase: string) => `Not known: the phase ${phase} is not one this version knows.`,
  noAnchor:
    "Not known: the schedule reports neither its creation nor a submission, which the next run is counted from.",
  refused: "No run: Velero refused the expression.",
  paused: "Paused: no run is expected until it is resumed.",
  // What Velero would do if the schedule were resumed now, after the words of a pause.
  resume: {
    submit: (run: string) => `Resumed now, Velero would submit a backup at once: a run was due at ${run}.`,
    submitUnlessServer: (run: string) =>
      `Resumed now, Velero would submit a backup at once, unless its server is set to skip immediately, which this view does not read: a run was due at ${run}.`,
    skipMoves:
      "Skip immediately, set at the resume, would move that run: Velero would count the next run from the time it reads the schedule.",
    skip: "Resumed now, Velero would submit nothing at once: skip immediately is set, and it would count the next run from the time it reads the schedule.",
    skipDue: (run: string) => `A run was due at ${run}.`,
    wait: (run: string) => `Resumed now, Velero would submit nothing at once: the next run is at ${run}.`,
    hold: (backup: string, phase: Holding, run: string) =>
      `Resumed now, Velero would submit nothing while the backup ${backup} ${HOLDING[phase]}: a run was due at ${run}.`,
    everyLook: (what: string) => `Resumed now, Velero would submit a backup at each of its looks: ${what}.`,
    notKnown: (why: string) => `Whether Velero would submit a backup at once when it is resumed is not known: ${why}.`,
    refused: "Velero refused its expression when it last read it, which is before the pause.",
    notRead: NOTES.notReadPaused,
    unknownPhase: (phase: string) => `Its phase, ${phase}, is not one this version knows.`,
  },
  // Why what Velero would do at a resume is not known, in words that go on a sentence.
  why: {
    "not-readable": "this version cannot read the expression",
    "no-anchor": "the schedule reports no time the next run is counted from",
    "no-offset": "the time zone of the Velero server is not known",
    "unknown-zone": (name: string) => `this machine does not know the time zone ${name}`,
  },
  // What is said beside the words of a state.
  derived: (offset: string, backup: string, of: string, moment: string) =>
    `Computed with ${offset}, the offset of the clock of the Velero server when it submitted the backup ${backup} of ${of}, at ${moment}: across a change of daylight saving time the run may be an hour off.`,
  thisSchedule: "this schedule",
  otherSchedule: (name: string) => `the schedule ${name}`,
  changed: (offset: string, backup: string, of: string, moment: string) =>
    `The offset was ${offset} when the server submitted the backup ${backup} of ${of}, at ${moment}: it changed between the two submissions, and the newest stands.`,
  holdNotKnown: (reason: string) => `Whether a backup of the schedule holds the submissions is not known: ${reason}.`,
  schedulesStale: (ago: string, since: string) => `Computed from the schedules as they were read ${ago} ago: ${since}.`,
  backupsStale: (ago: string, since: string) =>
    `What holds the submissions is read in the backups as they were read ${ago} ago: ${since}.`,
  // What is said of a family whose items are of an earlier read, by what the last read answered.
  since: {
    forbidden: "access is denied since then",
    "not-served": "the cluster does not serve them since then",
    failed: "they could not be read since then",
    other: "they were not read again since then",
  },
  // The lines of the band of a schedule.
  zone: {
    named: (name: string) => `${name}, named by the expression`,
    namedNotKnown: (name: string) => `${name}, named by the expression, which this machine does not know`,
    interval: "None: an interval is counted without a time zone, and its times are written in UTC",
    derived: (offset: string, backup: string, of: string, moment: string) =>
      `${offset}, the offset of the clock of the Velero server when it submitted the backup ${backup} of ${of}, at ${moment}`,
    notKnown: (why: string) =>
      `Not known: the one of the Velero server, which is derived from the backup of a last submission of the installation, and ${why}. Name the zone in the expression to have it read`,
  },
  passedNone: "None yet: the expected run is ahead",
  passedOne: (run: string) => `1 expected run passed, at ${run}`,
  passedMany: (count: number, first: string, last: string) =>
    `${count} expected runs passed, the first at ${first} and the last at ${last}`,
  passedBeyond: (first: string) => `More than ${COUNT_BOUND} expected runs passed, the first at ${first}`,
  // The last observed run: the last submission with its backup, and the newest backup when it is another.
  observed: {
    found: (moment: string, backup: string) => `Last submission ${moment}: its backup is ${backup}.`,
    notFound: (moment: string) =>
      `Last submission ${moment}: its backup is not among the backups that exist; it expired, was deleted or cannot be read. The submission stands, since the schedule carries it.`,
    notKnown: (moment: string, reason: string) =>
      `Last submission ${moment}: whether its backup exists is not known: ${reason}.`,
    // Why, when the backups were read: before the submission, or not again since the last read.
    readBefore: (ago: string) => `the backups were last read ${ago} ago, before it`,
    readEarlier: (ago: string, since: string) => `the backups were last read ${ago} ago: ${since}`,
    none: "No submission is written in the schedule.",
    newer: (backup: string, moment: string) =>
      `The backup ${backup}, created ${moment}, is not a submission of the schedule: it was asked by hand or synced from the store, and it moves nothing in the schedule.`,
    newerMore: (count: number) =>
      count === 1 ? "One more of its backups is not either." : `${count} more of its backups are not either.`,
    newest: (backup: string) => `The newest backup of the schedule that exists is ${backup}.`,
  },
  // Why the adherence of a schedule is not known, as the Overview counts them.
  reasons: {
    "not-read": "not read by Velero yet",
    "unknown-phase": "a phase this version does not know",
    "not-readable": "an expression this version cannot read",
    "no-anchor": "no time to count the next run from",
    "no-offset": "the time zone of the Velero server not known",
    "unknown-zone": "a time zone this machine does not know",
  } satisfies Record<NotKnownReason, string>,
};

// --- The words of a time ---

function pad(value: number, length = 2): string {
  return String(value).padStart(length, "0");
}

// An offset from UTC, as the words write it.
function offsetText(minutes: number): string {
  if (minutes === 0) return "UTC";
  const size = Math.abs(minutes);

  return `UTC${minutes < 0 ? "-" : "+"}${pad(Math.floor(size / 60))}:${pad(Math.round(size % 60))}`;
}

// A zone as the words name it: by the name the expression gives it, or by its offset.
function zoneName(zone: Zone): string {
  return zone.of === "named" ? zone.name : offsetText(zone.minutes);
}

interface WallClock {
  date: string;
  minute: string;
  second: number;
  offset: number;
}

// The wall clock of an instant in a zone, from the offset the computation reads: never from the zone of the
// machine, whose clock the Date of the language would read.
function wallClock(zone: Zone, instant: number): WallClock {
  const offset = zoneOffset(zone, instant) ?? 0;
  const at = new Date(instant + offset * MINUTE);

  return {
    date: `${pad(at.getUTCFullYear(), 4)}-${pad(at.getUTCMonth() + 1)}-${pad(at.getUTCDate())}`,
    minute: `${pad(at.getUTCHours())}:${pad(at.getUTCMinutes())}`,
    second: at.getUTCSeconds(),
    offset,
  };
}

// A time the cluster wrote, a submission, a creation or a skip, in a zone: with its date and its seconds.
export function momentText(zone: Zone, instant: number): string {
  const wall = wallClock(zone, instant);

  return `${wall.date} ${wall.minute}:${pad(wall.second)} ${zoneName(zone)}`;
}

// A run in a zone: with its seconds when it has some, and with its date when it is not the day of the clock in
// that zone.
export function runText(zone: Zone, instant: number, now: number): string {
  const wall = wallClock(zone, instant);
  const time = `${wall.minute}${wall.second ? `:${pad(wall.second)}` : ""} ${zoneName(zone)}`;

  return wall.date === wallClock(zone, now).date ? time : `${time} on ${wall.date}`;
}

// A run in the hour a zone repeats, with the offset that tells the two occurrences apart.
function repeatedRunText(zone: Zone, instant: number): string {
  const wall = wallClock(zone, instant);

  return `${wall.minute} ${zoneName(zone)} (${offsetText(wall.offset)})`;
}

// --- The zone a schedule is read in ---

type ZoneOf =
  // The zone the expression names, which this machine knows or does not.
  | { of: "named"; zone: Zone; known: boolean }
  // The expression names none, or Local: the offset of the server, derived from the backups.
  | { of: "derived"; zone: Zone; offset: ServerOffset }
  // An interval names no zone and needs none.
  | { of: "interval" }
  // The expression names none, or Local, and no offset of the server is derived.
  | { of: "not-known"; local: boolean; why: string };

function zoneOf(parsed: ParsedExpression, context: AdherenceContext, at: number): ZoneOf {
  const named = expressionZone(parsed);

  if (named) return { of: "named", zone: named, known: zoneOffset(named, at) !== undefined };
  if (parsed.kind === "every") return { of: "interval" };
  if (context.offset) {
    return { of: "derived", zone: { of: "fixed", minutes: context.offset.minutes }, offset: context.offset };
  }
  return {
    of: "not-known",
    local: parsed.zone.of === "local",
    why: context.noOffset ?? SIGNAL_WORDS.noSubmissionBackup,
  };
}

// The zone the times of a schedule are written in: the one it is read in, and UTC when that one is not known
// or not needed, with its name.
function writtenIn(zone: ZoneOf): Zone {
  if (zone.of === "named") return zone.known ? zone.zone : UTC;
  return zone.of === "derived" ? zone.zone : UTC;
}

function whose(offset: { schedule: string }, schedule: string): string {
  return offset.schedule === schedule ? SIGNAL_WORDS.thisSchedule : SIGNAL_WORDS.otherSchedule(offset.schedule);
}

export interface ZoneLine {
  of: ZoneOf["of"];
  words: string;
}

function zoneLine(zone: ZoneOf, schedule: string): ZoneLine {
  switch (zone.of) {
    case "named":
      return {
        of: "named",
        words: (zone.known ? SIGNAL_WORDS.zone.named : SIGNAL_WORDS.zone.namedNotKnown)(zoneName(zone.zone)),
      };
    case "derived":
      return {
        of: "derived",
        words: SIGNAL_WORDS.zone.derived(
          offsetText(zone.offset.minutes),
          zone.offset.backup,
          whose(zone.offset, schedule),
          momentText(zone.zone, zone.offset.submission),
        ),
      };
    case "interval":
      return { of: "interval", words: SIGNAL_WORDS.zone.interval };
    default:
      return { of: "not-known", words: SIGNAL_WORDS.zone.notKnown(zone.why) };
  }
}

// The words that say a signal was computed with a derived offset, and that the offset changed when it did.
function derivedNotes(zone: ZoneOf, schedule: string): string[] {
  if (zone.of !== "derived") return [];
  const { offset } = zone;
  const changed = offset.changed;

  return [
    SIGNAL_WORDS.derived(
      offsetText(offset.minutes),
      offset.backup,
      whose(offset, schedule),
      momentText(zone.zone, offset.submission),
    ),
    ...(changed
      ? [
          SIGNAL_WORDS.changed(
            offsetText(changed.minutes),
            changed.backup,
            whose(changed, schedule),
            momentText({ of: "fixed", minutes: changed.minutes }, changed.submission),
          ),
        ]
      : []),
  ];
}

// --- What holds the submissions ---

export type Hold =
  | {
      state: "held";
      // The newest backup that holds the submissions, and how many more do.
      backup: string;
      phase: Holding;
      others: number;
      // The backups are of an earlier read, at that time: the last one did not succeed.
      stale?: number;
    }
  | { state: "none"; stale?: number }
  // The backups were not read: whether one holds the submissions is not known, which is not that none does.
  | { state: "not-known"; reason: string };

function holding(backup: BackupResource): Holding | undefined {
  const phase = backup.status?.phase;

  if (typeof phase !== "string" || phase === "") return "none";
  return phase === "New" || phase === "InProgress" ? phase : undefined;
}

// What the controller checks before it submits (schedule_controller.go L215-L238): the backups of the schedule
// in its namespace, by its label, whichever backup it is; one with no phase, New or InProgress holds every
// submission. The newest of them is named.
function holdOf(schedule: ScheduleResource, backups: FamilyRead<BackupResource>): Hold {
  if (!hasItems(backups)) return { state: "not-known", reason: lower(unread("backups", backups).reason) };
  const stale = isStale(backups) ? { stale: backups.lastSuccess ?? 0 } : {};
  let held: { backup: string; phase: Holding } | undefined;
  let others = 0;

  for (const backup of backupsOf(backups.items, schedule.metadata.namespace ?? "", schedule.metadata.name)) {
    const phase = holding(backup);

    if (phase === undefined) continue;
    if (held) others += 1;
    else held = { backup: backup.metadata.name, phase };
  }
  return held ? { state: "held", ...held, others, ...stale } : { state: "none", ...stale };
}

function holdNotes(hold: Hold, context: AdherenceContext): string[] {
  if (hold.state === "not-known") return [SIGNAL_WORDS.holdNotKnown(hold.reason)];
  if (hold.stale === undefined) return [];
  return [
    SIGNAL_WORDS.backupsStale(
      formatDuration(Math.max(0, context.now - hold.stale)),
      since(context.reads.backups.status),
    ),
  ];
}

// What the last read of a family answered, when its items are of a read before it.
function since(status: ReadStatus): string {
  return status === "forbidden" || status === "not-served" || status === "failed"
    ? SIGNAL_WORDS.since[status]
    : SIGNAL_WORDS.since.other;
}

// --- The signal of a schedule ---

export type NextRun =
  | { kind: "at"; at: number; text: string }
  | { kind: "none" | "not-known"; text: string; why: string };

export interface Expected {
  // The first instant of the expression after the anchor, and how long ago it was: below zero while it is ahead.
  at: number;
  lateness: number;
  // The expected instants that passed, at most the bound, the last of them, and whether more passed.
  passed: number;
  beyond: boolean;
  last?: number;
  words: string;
}

// What Velero would do if a paused schedule were resumed now, when it can be said.
export type Resume =
  // A run is due: it would submit at once, unless skip immediately is set at the resume, or by its server when
  // the schedule says nothing of it.
  | { would: "submit"; due: number; skip: false | "server" }
  // Skip immediately is set: it would count the next run from the time it reads the schedule.
  | { would: "skip"; due?: number }
  | { would: "wait"; next: number }
  | { would: "hold"; due: number; backup: string; phase: Holding }
  | { would: "every-look" }
  | { would: "not-known"; why: string };

export interface ScheduleSignal {
  state: SignalState;
  reason?: NotKnownReason;
  label: string;
  mark: SignalMark;
  weight: number;
  // What orders two signals of one weight: the expected run, the earliest first, which puts the latest first
  // among what is overdue and the soonest first among what is awaited.
  measure?: number;
  // The sentence of the state.
  words: string;
  // What is said beside it: the derived offset, the hold not known, a read of before.
  notes: string[];
  next: NextRun;
  // The lines of the band, for a schedule whose expression is read.
  zone?: ZoneLine;
  anchor?: Anchor & { words: string };
  expected?: Expected;
  hold?: Hold;
  resume?: Resume;
  // Overdue, or held beyond the grace, by the clock the lateness is counted by.
  late: boolean;
}

interface Parts {
  state: SignalState;
  reason?: NotKnownReason;
  words: string;
  notes?: string[];
  next: NextRun;
  zone?: ZoneLine;
  anchor?: Anchor & { words: string };
  expected?: Expected;
  hold?: Hold;
  resume?: Resume;
  late?: boolean;
}

function signalOf(parts: Parts, context: AdherenceContext): ScheduleSignal {
  const { state, notes = [], late = false, ...rest } = parts;
  const schedules = context.reads.schedules;
  const stale = isStale(schedules)
    ? [
        SIGNAL_WORDS.schedulesStale(
          formatDuration(Math.max(0, context.now - (schedules.lastSuccess ?? 0))),
          since(schedules.status),
        ),
      ]
    : [];

  return {
    state,
    ...rest,
    label: SIGNAL_WORDS.label[state],
    mark: state === "held" && late ? "late" : MARKS[state],
    weight: SIGNAL_WEIGHTS[state],
    ...(parts.expected && ["awaited", "due", "overdue", "held"].includes(state) ? { measure: parts.expected.at } : {}),
    notes: [...notes, ...stale],
    late,
  };
}

function noRun(why: string): NextRun {
  return { kind: "none", text: SIGNAL_WORDS.none, why };
}

function notKnown(reason: NotKnownReason, words: string, context: AdherenceContext, more: Partial<Parts> = {}) {
  return signalOf(
    {
      state: "not-known",
      reason,
      words,
      next: { kind: "not-known", text: SIGNAL_WORDS.notKnown, why: words },
      ...more,
    },
    context,
  );
}

// An expression with no instant at all has none in any zone, but within hours of the end of five years: Velero
// submits it at every look, whatever the zone of its server.
function withoutInstant(parsed: ParsedExpression, from: number): boolean {
  return parsed.kind === "no-instant" || (parsed.kind === "fields" && nextInstant(parsed, from, UTC).kind === "none");
}

function everyLookWhat(parsed: ParsedExpression): string {
  return parsed.kind === "no-instant" ? SIGNAL_WORDS.noInstant(parsed.descriptor) : SIGNAL_WORDS.beyondFiveYears;
}

// The day the zone the expression names repeats an hour, when it is the day of the run and the expression has
// a run in that hour: the words of the two runs (REQ-162). A change is found in the offsets the computation
// reads, with two hours of room on each side of the day.
function repeatedHour(parsed: ParsedExpression, zone: Zone, at: number): string | undefined {
  if (zone.of !== "named") return undefined;
  const run = wallClock(zone, at);
  const midnight = Date.UTC(Number(run.date.slice(0, 4)), Number(run.date.slice(5, 7)) - 1, Number(run.date.slice(8)));
  const from = midnight - run.offset * MINUTE - 2 * HOUR;
  const to = from + DAY + 4 * HOUR;
  const before = zoneOffset(zone, from);
  const after = zoneOffset(zone, to);

  if (before === undefined || after === undefined || after >= before) return undefined;
  let low = 0;
  let high = (to - from) / MINUTE;

  while (high - low > 1) {
    const middle = Math.floor((low + high) / 2);

    if (zoneOffset(zone, from + middle * MINUTE) === after) high = middle;
    else low = middle;
  }
  // The first instant at the later offset; the wall clock goes back from what it would show then at the
  // earlier offset to what it shows, and the instants of that length before the change are the first
  // occurrence of the hour it repeats.
  const change = from + high * MINUTE;

  if (wallClock(zone, change).date !== run.date) return undefined;
  const length = (before - after) * MINUTE;
  const shown = (offset: number) => {
    const wall = new Date(change + offset * MINUTE);

    return `${pad(wall.getUTCHours())}:${pad(wall.getUTCMinutes())}`;
  };
  const first = nextInstant(parsed, change - length - SECOND, zone);
  const second = nextInstant(parsed, change - SECOND, zone);

  if (first.kind !== "instant" || first.at >= change || second.kind !== "instant" || second.at >= change + length) {
    return undefined;
  }
  // Said on the day of the change, until the second of the two runs.
  if (at > second.at) return undefined;
  return SIGNAL_WORDS.repeated(
    run.date,
    zone.name,
    shown(before),
    shown(after),
    repeatedRunText(zone, first.at),
    repeatedRunText(zone, second.at),
  );
}

// The signal of a schedule (REQ-163 to REQ-166): the gates of the pause and of the phase first, and nothing
// computed before them; then, of a schedule Velero took, the expected run in the zone the expression is read
// in, the hold, and the state with the grace, by the clock of the cluster as far as this machine can see it.
export function scheduleSignal(schedule: ScheduleResource, context: AdherenceContext): ScheduleSignal {
  const phase = scheduleState(schedule.status?.phase);

  if (schedule.spec?.paused === true) return pausedSignal(schedule, phase, context);
  if (phase.validation === "invalid") {
    return signalOf({ state: "refused", words: SIGNAL_WORDS.refused, next: noRun(SIGNAL_WORDS.refused) }, context);
  }
  if (phase.validation === "not-validated") return notKnown("not-read", SIGNAL_WORDS.notRead, context);
  if (phase.validation === "unknown") {
    return notKnown("unknown-phase", SIGNAL_WORDS.unknownPhase(phase.reported ?? ""), context);
  }
  return enabledSignal(schedule, context);
}

function enabledSignal(schedule: ScheduleResource, context: AdherenceContext): ScheduleSignal {
  // The clock the controller counts by, as far as this machine can see it (REQ-166).
  const clock = context.clocks.cluster;
  const name = schedule.metadata.name;
  const parsed = parseExpression(schedule.spec?.schedule);

  if (parsed.kind === "refused") return notKnown("not-readable", SIGNAL_WORDS.notReadable(parsed.reason), context);
  const anchor = anchorOf(schedule);

  if (!anchor) return notKnown("no-anchor", SIGNAL_WORDS.noAnchor, context);
  const zone = zoneOf(parsed, context, anchor.at);
  const written = writtenIn(zone);
  const hold = holdOf(schedule, context.reads.backups);
  const line = zoneLine(zone, name);
  const anchored = { ...anchor, words: capital(SIGNAL_WORDS.from(anchor.of, momentText(written, anchor.at))) };
  const everyLook = () => {
    const last = timestamp(schedule.status?.lastBackup);
    const words = [
      SIGNAL_WORDS.atEveryLook(
        everyLookWhat(parsed),
        last === undefined ? SIGNAL_WORDS.noSubmissionYet : SIGNAL_WORDS.lastSubmission(momentText(written, last)),
      ),
      hold.state === "held" ? SIGNAL_WORDS.heldNow(hold.backup, hold.phase) : "",
    ]
      .filter(Boolean)
      .join(" ");

    return signalOf(
      {
        state: "at-every-look",
        words,
        notes: holdNotes(hold, context),
        next: noRun(words),
        zone: line,
        anchor: anchored,
        hold,
        late: false,
      },
      context,
    );
  };

  if (zone.of === "not-known" || (zone.of === "named" && !zone.known)) {
    if (withoutInstant(parsed, anchor.at)) return everyLook();
    return zone.of === "not-known"
      ? notKnown("no-offset", SIGNAL_WORDS.noOffset(zone.local, zone.why), context, { zone: line, anchor: anchored })
      : notKnown("unknown-zone", SIGNAL_WORDS.unknownZone(zoneName(zone.zone)), context, {
          zone: line,
          anchor: anchored,
        });
  }
  const run = expectedRun(schedule, parsed, zone.of === "interval" ? undefined : zone.zone, clock);

  if (run.kind === "at-every-look") return everyLook();
  if (run.kind !== "expected") return notKnown("no-anchor", SIGNAL_WORDS.noAnchor, context);
  const lateness = clock - run.at;
  const late = run.due && lateness > GRACE;
  const at = runText(written, run.at, clock);
  const from = SIGNAL_WORDS.from(anchor.of, momentText(written, anchor.at));
  const ahead = SIGNAL_WORDS.inTime(formatDuration(Math.max(0, -lateness)));
  const ago = formatDuration(Math.max(0, lateness));
  const expected: Expected = {
    at: run.at,
    lateness,
    passed: run.passed,
    beyond: run.beyond,
    ...(run.lastPassed === undefined ? {} : { last: run.lastPassed }),
    words:
      run.passed === 0
        ? SIGNAL_WORDS.passedNone
        : run.beyond
          ? SIGNAL_WORDS.passedBeyond(at)
          : run.passed === 1
            ? SIGNAL_WORDS.passedOne(at)
            : SIGNAL_WORDS.passedMany(run.passed, at, runText(written, run.lastPassed ?? run.at, clock)),
  };
  const next: NextRun = {
    kind: "at",
    at: run.at,
    text: run.due ? SIGNAL_WORDS.ago(ago) : ahead,
  };
  const notes = [...derivedNotes(zone, name), ...holdNotes(hold, context)];
  const common = { next, zone: line, anchor: anchored, expected, hold, notes };

  if (hold.state === "held") {
    const words = [
      SIGNAL_WORDS.held(hold.backup, hold.phase),
      hold.others ? SIGNAL_WORDS.heldMore(hold.others) : "",
      run.due ? SIGNAL_WORDS.heldExpected(at, ago) : SIGNAL_WORDS.heldNext(at, ahead),
    ]
      .filter(Boolean)
      .join(" ");

    return signalOf({ state: "held", words, ...common, late }, context);
  }
  if (!run.due) {
    const repeated = repeatedHour(parsed, zone.of === "named" ? zone.zone : UTC, run.at);
    const words = [SIGNAL_WORDS.awaited(formatDuration(-lateness), at, from), repeated ?? ""].filter(Boolean).join(" ");

    return signalOf({ state: "awaited", words, ...common }, context);
  }
  if (!late) return signalOf({ state: "due", words: SIGNAL_WORDS.due(at, ago), ...common }, context);
  return signalOf(
    {
      state: "overdue",
      words: SIGNAL_WORDS.overdue(ago, at, from, SIGNAL_WORDS.passed(run.passed, run.beyond)),
      ...common,
      late: true,
    },
    context,
  );
}

// A paused schedule: no run, and what Velero would do if it were resumed now, when Velero took the expression
// before the pause and the zone it is read in is known (REQ-164). The phase is the one written before the
// pause, which Velero writes again when it reads the schedule at the resume.
function pausedSignal(schedule: ScheduleResource, phase: ScheduleState, context: AdherenceContext): ScheduleSignal {
  if (phase.validation !== "valid") {
    const said =
      phase.validation === "invalid"
        ? SIGNAL_WORDS.resume.refused
        : phase.validation === "not-validated"
          ? SIGNAL_WORDS.resume.notRead
          : SIGNAL_WORDS.resume.unknownPhase(phase.reported ?? "");
    const words = `${SIGNAL_WORDS.paused} ${said}`;

    return signalOf({ state: "paused", words, next: noRun(words) }, context);
  }
  const clock = context.clocks.cluster;
  const parsed = parseExpression(schedule.spec?.schedule);
  const anchor = anchorOf(schedule);
  const done = (resume: Resume, said: string, more: Partial<Parts> = {}) => {
    const words = `${SIGNAL_WORDS.paused} ${said}`;

    return signalOf({ state: "paused", words, next: noRun(words), resume, ...more }, context);
  };
  const unknown = (why: string, more: Partial<Parts> = {}) =>
    done({ would: "not-known", why }, SIGNAL_WORDS.resume.notKnown(why), more);

  if (parsed.kind === "refused") return unknown(SIGNAL_WORDS.why["not-readable"]);
  if (!anchor) return unknown(SIGNAL_WORDS.why["no-anchor"]);
  const zone = zoneOf(parsed, context, anchor.at);
  const written = writtenIn(zone);
  const line = zoneLine(zone, schedule.metadata.name);
  const everyLook = () =>
    done({ would: "every-look" }, SIGNAL_WORDS.resume.everyLook(everyLookWhat(parsed)), { zone: line });

  if (zone.of === "not-known" || (zone.of === "named" && !zone.known)) {
    if (withoutInstant(parsed, anchor.at)) return everyLook();
    return unknown(
      zone.of === "not-known" ? SIGNAL_WORDS.why["no-offset"] : SIGNAL_WORDS.why["unknown-zone"](zoneName(zone.zone)),
      { zone: line },
    );
  }
  const run = expectedRun(schedule, parsed, zone.of === "interval" ? undefined : zone.zone, clock);

  if (run.kind === "at-every-look") return everyLook();
  if (run.kind !== "expected") return unknown(SIGNAL_WORDS.why["no-anchor"]);
  const notes = derivedNotes(zone, schedule.metadata.name);
  const at = runText(written, run.at, clock);
  const more = { zone: line, notes };

  if (schedule.spec?.skipImmediately === true) {
    return done(
      { would: "skip", ...(run.due ? { due: run.at } : {}) },
      [SIGNAL_WORDS.resume.skip, run.due ? SIGNAL_WORDS.resume.skipDue(at) : ""].filter(Boolean).join(" "),
      more,
    );
  }
  if (!run.due) return done({ would: "wait", next: run.at }, SIGNAL_WORDS.resume.wait(at), more);
  const hold = holdOf(schedule, context.reads.backups);

  if (hold.state === "held") {
    return done(
      { would: "hold", due: run.at, backup: hold.backup, phase: hold.phase },
      SIGNAL_WORDS.resume.hold(hold.backup, hold.phase, at),
      { ...more, hold },
    );
  }
  const skip = schedule.spec?.skipImmediately === false ? false : "server";

  return done(
    { would: "submit", due: run.at, skip },
    `${skip === false ? SIGNAL_WORDS.resume.submit(at) : SIGNAL_WORDS.resume.submitUnlessServer(at)} ${SIGNAL_WORDS.resume.skipMoves}`,
    { ...more, hold, notes: [...notes, ...holdNotes(hold, context)] },
  );
}

// The order by adherence of the list (REQ-168), as one text a column sorts: the weight of the state, then the
// expected run, the earliest first, then the name, by its characters.
export function adherenceOrder(signal: ScheduleSignal, name: string): string {
  const measure = Math.min(Math.max(0, Math.floor(signal.measure ?? 0)), 9_999_999_999_999);

  return `${signal.weight}${pad(measure, 13)}${name}`;
}

// --- The last observed run ---

export interface LastObserved {
  submission:
    | { state: "none" }
    // The backup created within a minute of the last submission, among the backups that exist.
    | { state: "found"; at: number; backup: string }
    // None of them: it expired, was deleted or cannot be read; the submission stands.
    | { state: "not-found"; at: number }
    // The backups were not read, were last read before the submission, or not again since a read that failed.
    | { state: "not-known"; at: number; reason: string };
  // The newest backup of the schedule created after its last submission, or any when it has none: not a
  // submission of the schedule, and how many such there are.
  newer?: { backup: string; created: number; count: number };
  // The newest backup of the schedule that exists, when it is another than the one of the submission and
  // older than the submission.
  newest?: string;
  words: string[];
}

// The last observed run (REQ-167): the last submission with the backup of it, and the newest backup when it is
// another, which is said not to be a submission when it is newer. A distance between two backups is never
// said to be a run that was missed.
export function lastObservedRun(schedule: ScheduleResource, context: AdherenceContext): LastObserved {
  const parsed = parseExpression(schedule.spec?.schedule);
  const written =
    parsed.kind === "refused" ? UTC : writtenIn(zoneOf(parsed, context, timestamp(schedule.status?.lastBackup) ?? 0));
  const at = timestamp(schedule.status?.lastBackup);
  const backups = context.reads.backups;

  if (!hasItems(backups)) {
    const reason = lower(unread("backups", backups).reason);

    return at === undefined
      ? { submission: { state: "none" }, words: [SIGNAL_WORDS.observed.none] }
      : {
          submission: { state: "not-known", at, reason },
          words: [SIGNAL_WORDS.observed.notKnown(momentText(written, at), reason)],
        };
  }
  const found = submissionBackup(schedule, backups.items);
  const later = laterBackups(schedule, backups.items);
  const own = found.kind === "found" ? found.backup : undefined;
  const newest = backupsOf(backups.items, schedule.metadata.namespace ?? "", schedule.metadata.name)[0];
  const words: string[] = [];
  let submission: LastObserved["submission"] = { state: "none" };

  if (at === undefined) {
    words.push(SIGNAL_WORDS.observed.none);
  } else if (own) {
    submission = { state: "found", at, backup: own.metadata.name };
    words.push(SIGNAL_WORDS.observed.found(momentText(written, at), own.metadata.name));
  } else {
    // That the backup is not among the backups that exist is said of a read that ended after the submission
    // and is the last one: a read made before it cannot hold it, and one that failed since says nothing of now.
    const read = backups.lastSuccess ?? 0;
    const ago = formatDuration(Math.max(0, context.now - read));
    const reason =
      at > read
        ? SIGNAL_WORDS.observed.readBefore(ago)
        : isStale(backups)
          ? SIGNAL_WORDS.observed.readEarlier(ago, since(backups.status))
          : undefined;

    submission = reason === undefined ? { state: "not-found", at } : { state: "not-known", at, reason };
    words.push(
      reason === undefined
        ? SIGNAL_WORDS.observed.notFound(momentText(written, at))
        : SIGNAL_WORDS.observed.notKnown(momentText(written, at), reason),
    );
  }
  const first = later[0];
  const created = first ? timestamp(first.metadata.creationTimestamp) : undefined;

  if (first && created !== undefined) {
    words.push(SIGNAL_WORDS.observed.newer(first.metadata.name, momentText(written, created)));
    if (later.length > 1) words.push(SIGNAL_WORDS.observed.newerMore(later.length - 1));
  }
  const older = newest && newest !== own && !later.includes(newest) ? newest.metadata.name : undefined;

  if (older) words.push(SIGNAL_WORDS.observed.newest(older));
  return {
    submission,
    ...(first && created !== undefined ? { newer: { backup: first.metadata.name, created, count: later.length } } : {}),
    ...(older ? { newest: older } : {}),
    words,
  };
}
