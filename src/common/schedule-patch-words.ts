// The words of the pause and of the resume of a schedule (SPEC-0017, REQ-274 to REQ-277): what the workspace says,
// what the review says beside the text, and what the result says. What a resume does is the one the adherence of
// SPEC-0013 computes for a paused schedule, with the value of `skipImmediately` the resume writes: the same anchor, the
// same zone and the same instants as the view of the schedule. Pure functions of the schedule, of the context of the
// adherence and of the choice, which are arguments: no time is taken here.

import { timeText } from "./operation-text";
import { anchorOf, nextInstant, parseExpression, UTC } from "./schedule-adherence";
import { FLAG_LABELS, RUNS_SHOWN, reviewZone, zoneWords } from "./schedule-create-words";
import {
  datedRunText,
  momentText,
  repeatedHour,
  runText,
  SIGNAL_WORDS,
  scheduleSignal,
  zonedRunText,
} from "./schedule-signal";

import type { MeaningPart } from "./backup-from-schedule";
import type { ScheduleChanged } from "./ipc";
import type { ParsedExpression, Zone } from "./schedule-adherence";
import type { ReviewZone } from "./schedule-create-words";
import type { AdherenceContext } from "./schedule-signal";
import type { ScheduleResource } from "./types";

// The two actions on a schedule, as the contract names them.
export type PatchAction = "schedule-pause" | "schedule-resume";

// What the workspace says, by its parts.
export const SCHEDULE_PATCH_VIEW_WORDS = {
  title: (action: PatchAction) => (action === "schedule-pause" ? "Pause schedule" : "Resume schedule"),
  what: (action: PatchAction, schedule: string, namespace: string) =>
    action === "schedule-pause"
      ? `A pause of the schedule ${schedule}, in ${namespace}: one patch of the Schedule, which writes paused true and nothing else.`
      : `A resume of the schedule ${schedule}, in ${namespace}: one patch of the Schedule, which writes paused false and the choice of skipping the run that is due, and nothing else.`,
  writesOff: (action: PatchAction) =>
    action === "schedule-pause"
      ? "Writes are off for this installation: the review asks for writes on, which are turned on in the target bar."
      : "Writes are off for this installation: the choice can be made, and the review asks for writes on, which are turned on in the target bar.",
  gateUnknown: "Whether writes are on is not known: the target bar asks the main process again.",
  another: (schedule: string) =>
    `A pause or a resume of the schedule ${schedule} is being sent: one is asked at a time, and this one can be asked when it ends.`,
  // The action the view offers is not the one the schedule calls for now: Velero or someone changed it.
  notNow: (action: PatchAction, schedule: string) =>
    action === "schedule-pause"
      ? `The schedule ${schedule} is paused already, as its last read says: there is nothing to pause. Its view offers Resume.`
      : `The schedule ${schedule} is not paused, as its last read says: there is nothing to resume. Its view offers Pause.`,
  // The expression is needed to test it at the resume: one the read does not report cannot be tested.
  noExpression: (schedule: string) =>
    `The read of the schedule ${schedule} reports no expression, which the resume tests: it cannot be resumed from here.`,
  skip: FLAG_LABELS.skipImmediately,
  skipNote:
    "Velero counts the next run from the time it reads the schedule at the resume, and skips a run that is due then: no backup at once.",
  // What the schedule carries, and what the choice writes in its place (REQ-275).
  carried: (carried: unknown, chosen: boolean) => {
    if (carried === undefined || carried === null)
      return `The schedule carries no skip immediately, which leaves it to the setting of the Velero server: the resume writes ${chosen}, and the setting does not decide.`;
    if (carried === chosen) return `The schedule carries skip immediately ${chosen}: the resume writes it again.`;
    return `The schedule carries skip immediately ${String(carried)}: the resume writes ${chosen} in its place.`;
  },
  asking: "Asking the main process for the review: it writes the patch it would send.",
  running: (action: PatchAction, schedule: string) =>
    `${action === "schedule-pause" ? "Pausing" : "Resuming"} the schedule ${schedule}, then reading it once.`,
  review: (action: PatchAction) =>
    `This patch will be sent to the Schedule when you confirm, and not before: its tests refuse it for a schedule that changed since the review, one created again under its name${action === "schedule-pause" ? "" : ", no longer paused or of another expression"}.`,
  meaning: "What it means",
  text: "What is sent, as it is sent",
  replaced:
    "The confirmation had expired, and the main process, asked again, wrote another patch: this review takes the place of the one before, and nothing was sent. Read it again before you confirm.",
  command: (action: PatchAction) => (action === "schedule-pause" ? "Pause the schedule" : "Resume the schedule"),
  leave: (action: PatchAction) => (action === "schedule-pause" ? "Do not pause it" : "Do not resume it"),
  ask: "Review the patch",
  paused: (schedule: string) => `The schedule ${schedule} is paused: Velero does not read it until it is resumed.`,
  resumed: (schedule: string) => `The schedule ${schedule} is resumed: Velero reads it at once.`,
  found:
    "The answer of the patch was lost on the way: the schedule read after it holds what the patch wrote, and is the one reviewed.",
  // What `skipImmediately` holds after a resume, and what Velero wrote of it once it read the schedule (REQ-277).
  skipAfter: (changed: ScheduleChanged) =>
    changed.lastSkipped !== undefined
      ? `Velero read the schedule, set skip immediately back to false, and wrote that it skipped at ${timeText(Date.parse(changed.lastSkipped))}: the next run is counted from that time.`
      : changed.skipImmediately
        ? "Skip immediately is true: Velero had not read the schedule when it was read after the patch, and sets it back to false when it does."
        : "Skip immediately is false: a run that is due is submitted.",
  open: (schedule: string) => `Open the schedule ${schedule}`,
  openNote: "Its view says when its next backup is due, and how its backups ended.",
  unknownLeft:
    "Its view says whether it is paused: the patch is not sent again by itself, and asking again is a new review.",
};

// The meaning of the patch of a pause, part by part (REQ-276): what Velero does with a paused schedule, the backup it
// submitted before, what the adherence says then, and what the patch writes.
export function pauseMeaning(schedule: ScheduleResource, context: AdherenceContext | undefined): MeaningPart[] {
  const signal = context ? scheduleSignal(schedule, context) : undefined;
  const hold = signal?.hold?.state === "held" ? signal.hold : undefined;

  return [
    {
      id: "reads",
      words:
        "Velero does not read a paused schedule: it submits no backup, writes no phase and validates nothing until the schedule is resumed.",
    },
    {
      id: "running",
      words: [
        "A backup the schedule already submitted goes on: a pause stops none.",
        hold ? SIGNAL_WORDS.heldNow(hold.backup, hold.phase) : "",
      ]
        .filter(Boolean)
        .join(" "),
    },
    {
      id: "adherence",
      words: `The views then say it paused, as its adherence does: no run is expected until it is resumed, and none is counted late.`,
    },
    {
      id: "only",
      words: `The patch writes paused true and nothing else: ${schedule.spec?.skipImmediately === undefined ? "the schedule keeps no skip immediately" : `skip immediately stays ${String(schedule.spec.skipImmediately)}`}, and the template and the expression stay as they are.`,
    },
  ];
}

// The schedule as it would be resumed with this choice: `paused` stays true for the computation of SPEC-0013, which
// says what a resume of a paused schedule would do.
function withSkip(schedule: ScheduleResource, skip: boolean): ScheduleResource {
  return { ...schedule, spec: { ...schedule.spec, paused: true, skipImmediately: skip } } as ScheduleResource;
}

// The zone the runs are computed in, as the review of a new schedule computes it (REQ-231): an interval is counted
// without one.
function zoneOfRuns(zone: ReviewZone): Zone | undefined {
  if (zone.of === "named" || zone.of === "derived") return zone.zone;
  return zone.of === "interval" ? UTC : undefined;
}

// The first instant of the expression after the time, in the zone.
function nextAfter(parsed: ParsedExpression, after: number, zone: Zone): number | undefined {
  const next = nextInstant(parsed, after, zone);

  return next.kind === "instant" ? next.at : undefined;
}

// The runs after the resume, as the review of a new schedule says them (REQ-230): the backup of a run that is due and
// not skipped, at once or once what holds the schedule ended, then the instants of the expression from the first one
// after the resume, with the hour a zone repeats. An interval says its first run alone, since each one is counted from
// the submission before it, and none after a backup that waits for others to end, whose time is not known.
function runsAfter(
  parsed: ParsedExpression,
  zone: Zone,
  first: number | undefined,
  opening: { words: string; held: boolean } | undefined,
  now: number,
): string | undefined {
  const interval =
    "each one is at its interval after the submission before it, which comes up to a minute after its instant.";

  if (parsed.kind === "every" && opening?.held) return `After the resume: ${opening.words}; then ${interval}`;
  const start = first ?? nextAfter(parsed, now, zone);

  if (start === undefined) return opening ? `After the resume: ${opening.words}.` : undefined;
  if (parsed.kind === "every")
    return `${opening ? `After the resume: ${opening.words}, then` : "The first run after the resume:"} ${datedRunText(zone, start)}; then ${interval}`;
  const instants = [start];

  while (instants.length < RUNS_SHOWN - (opening ? 1 : 0)) {
    const next = nextAfter(parsed, instants[instants.length - 1], zone);

    if (next === undefined) break;
    instants.push(next);
  }
  const said = [...(opening ? [opening.words] : []), ...instants.map((instant) => zonedRunText(zone, instant))];
  const repeated = new Set(instants.map((instant) => repeatedHour(parsed, zone, instant)).filter(Boolean));

  return [
    `The next ${said.length === 1 ? "run" : `${said.length} runs`} after the resume, counted from now: ${said.join("; ")}.`,
    ...repeated,
  ].join(" ");
}

// The words of a schedule Velero did not take before the pause, for which the computation says nothing of a run.
function untakenWords(schedule: ScheduleResource): string {
  const phase = schedule.status?.phase;

  if (phase === "FailedValidation")
    return "Velero refused the expression when it last read the schedule, before the pause: it is FailedValidation, and submits no backup while Velero refuses it.";
  if (phase === undefined || phase === "")
    return "Velero had not validated the schedule when it was paused: it validates it when it reads it at the resume, and once it takes the expression, a run is due at once when an instant of the expression has passed since the creation, unless skip immediately is true.";
  return `${SIGNAL_WORDS.resume.unknownPhase(phase)} Whether Velero submits a backup at the resume is not known.`;
}

// The meaning of the patch of a resume, part by part (REQ-276): when the next backup is due, as the adherence of
// SPEC-0013 counts it with the choice the resume writes, and where it counts from; the next runs in the zone of the
// expression; the validation Velero does again; what the choice replaces; and what the patch writes. The clock is the
// one of the cluster, which the adherence counts by.
export function resumeMeaning(
  schedule: ScheduleResource,
  skip: boolean,
  context: AdherenceContext | undefined,
): MeaningPart[] {
  const expression = typeof schedule.spec?.schedule === "string" ? schedule.spec.schedule : "";
  const parsed = parseExpression(expression);
  const now = context?.clocks.cluster ?? 0;
  // What a resume would do with skip immediately false: the choice is said over it, and what the computation says
  // beside it, but the derived offset, which the words of the zone say.
  const signal = context ? scheduleSignal(withSkip(schedule, false), context) : undefined;
  const resume = signal?.resume;
  const notes = (signal?.notes ?? []).filter((note) => !(signal?.derived ?? []).includes(note));
  const zone = reviewZone(expression, context?.offset);
  const runsZone = zone ? zoneOfRuns(zone) : undefined;
  const at = (instant: number) => runText(runsZone ?? UTC, instant, now);
  const anchor = anchorOf(schedule);
  const from =
    anchor && runsZone ? ` Counted from ${SIGNAL_WORDS.from(anchor.of, momentText(runsZone, anchor.at))}.` : "";
  const skipped = (due: number) =>
    `A run was due at ${at(due)}: with skip immediately true, Velero skips it when it reads the schedule at the resume, writes that time into status.lastSkipped, counts the next run from it and sets skip immediately back to false.`;
  let due: string;
  // The first run after the resume, when it is not the first instant after now, and the backup of a run that is due.
  let first: number | undefined;
  let opening: { words: string; held: boolean } | undefined;

  switch (resume?.would) {
    case "submit":
      due = skip
        ? skipped(resume.due)
        : `${SIGNAL_WORDS.resume.submit(at(resume.due))} One backup, and not one for each run that passed while it was paused.`;
      due += from;
      if (!skip) opening = { words: "a backup at once", held: false };
      break;
    case "hold": {
      const more = signal?.hold?.state === "held" && signal.hold.others > 0;
      const ends = more ? "the backups that hold it end" : `${resume.backup} ends`;

      due = skip
        ? `${skipped(resume.due)} ${SIGNAL_WORDS.heldNow(resume.backup, resume.phase)}`
        : `${SIGNAL_WORDS.resume.hold(resume.backup, resume.phase, at(resume.due))} It submits the run that is due at its first look after ${more ? "the backups that hold it end" : "that backup ends"}.`;
      due += from;
      if (!skip) opening = { words: `a backup at the first look after ${ends}`, held: true };
      break;
    }
    case "wait":
      // A skip at the resume counts an interval from the resume, and moves its next run; the next instant of a
      // calendar is the same either way.
      if (skip && parsed.kind === "every") {
        due =
          "No run is due. With skip immediately true, Velero counts the next run from the time it reads the schedule at the resume, writes that time into status.lastSkipped and sets skip immediately back to false.";
      } else {
        due = `${SIGNAL_WORDS.resume.wait(at(resume.next))}${from}${skip ? " Skip immediately skips no run, since none is due: Velero sets it back to false when it reads the schedule, and writes that time into status.lastSkipped." : ""}`;
        first = resume.next;
      }
      break;
    case "every-look":
      // The next run counted from a skip is the zero time as well, which is due at once.
      due = `${SIGNAL_WORDS.resume.everyLook(parsed.kind === "no-instant" ? SIGNAL_WORDS.noInstant(parsed.descriptor) : SIGNAL_WORDS.beyondFiveYears)}${skip ? " Skip immediately skips nothing here: Velero writes the time it reads the schedule into status.lastSkipped, and submits at that look all the same, since the expression has no instant to count the next run to." : ""}`;
      break;
    case "not-known": {
      // Whether the expression has an instant is not known when this version cannot read it: what a skip does with it
      // is said only for a zone that is not known.
      const ofZone = resume.why !== SIGNAL_WORDS.why["not-readable"] && resume.why !== SIGNAL_WORDS.why["no-anchor"];

      due = `${SIGNAL_WORDS.resume.notKnown(resume.why)}${skip && ofZone ? " With skip immediately true, Velero submits nothing at once: it counts the next run from the time it reads the schedule." : ""}`;
      break;
    }
    default:
      due = context
        ? untakenWords(schedule)
        : "Whether Velero submits a backup at the resume is not known: the backups of the installation were not read.";
  }
  if (notes.length) due = `${due} ${notes.join(" ")}`;
  const parts: MeaningPart[] = [{ id: "due", words: due }];
  const runs =
    runsZone &&
    parsed.kind !== "refused" &&
    (resume?.would === "submit" || resume?.would === "hold" || resume?.would === "wait")
      ? runsAfter(parsed, runsZone, first, opening, now)
      : undefined;

  if (runs && zone)
    parts.push({ id: "runs", words: `${runs} ${zoneWords(zone, expression, context?.noOffset ?? "")}` });
  else if (zone?.of === "not-known" && resume?.would === "not-known")
    parts.push({
      id: "runs",
      words: `The next runs are not known: ${zone.local ? "the expression names the zone Local, the one of the Velero server, which" : "the expression names no zone, and the zone of the Velero server"} is not known, since ${context?.noOffset ?? ""}.`,
    });
  parts.push(
    {
      id: "validation",
      words:
        "Velero validates the expression again when it reads the schedule at the resume, and writes FailedValidation for one it refuses: a schedule it refuses submits no backup.",
    },
    { id: "skip", words: SCHEDULE_PATCH_VIEW_WORDS.carried(schedule.spec?.skipImmediately, skip) },
    {
      id: "only",
      words:
        "The patch tests that the schedule is the one reviewed, still paused and of the same expression, then writes paused false and skip immediately, and nothing else: a schedule that changed since is not resumed.",
    },
  );
  return parts;
}

// What the result says of the schedule read after the patch (REQ-277).
export function patchResultWords(action: PatchAction, changed: ScheduleChanged): string[] {
  return action === "schedule-pause"
    ? [SCHEDULE_PATCH_VIEW_WORDS.paused(changed.name)]
    : [SCHEDULE_PATCH_VIEW_WORDS.resumed(changed.name), SCHEDULE_PATCH_VIEW_WORDS.skipAfter(changed)];
}
