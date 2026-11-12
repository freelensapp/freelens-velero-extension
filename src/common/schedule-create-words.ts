// The words of a schedule of the form (SPEC-0016, REQ-221 to REQ-240): what the workspace says, what the review says
// beside the text, the runs to come in the zone the schedule is read in, what each flag does, and what the result
// says. Pure functions of the body, of what was read of the installation and of the clock, which are arguments: no
// time is taken here, and no zone of the desktop or of the host is ever read.

import { fieldWords, providerWarnings, TEMPLATE_FIELD_WORDS } from "./backup-create-words";
import { goDurationText } from "./go-duration";
import { expressionZone, nextInstant, parseExpression, type Zone } from "./schedule-adherence";
import { SCHEDULE_FORM_WORDS } from "./schedule-form";
import {
  datedRunText,
  momentText,
  offsetText,
  repeatedHour,
  type ServerOffset,
  SIGNAL_WORDS,
  zonedRunText,
} from "./schedule-signal";

import type { MeaningPart } from "./backup-from-schedule";
import type { TemplateField } from "./backup-template";
import type { ScheduleFromForm } from "./schedule-form";

// How many runs the review lists (D9).
export const RUNS_SHOWN = 5;

// The label of each flag of the wrapper, as the table of the form names it.
export const FLAG_LABELS = {
  paused: "Paused",
  skipImmediately: "Skip immediately",
  useOwnerReferencesInBackup: "Backups owned by the schedule",
} as const;

// What each flag does when it is chosen, in short, beside it in the form: the review says it whole.
export const FLAG_NOTES = {
  paused: "Velero reads no paused schedule: no phase, no validation and no backup until it is resumed.",
  skipImmediately:
    "At its first reading Velero counts the next run from that reading, and skips an instant of the expression between the creation and it.",
  useOwnerReferencesInBackup:
    "Every backup of the schedule names it as its owner: deleting the Schedule deletes those Backup objects, and none of the data they hold in the storage.",
} as const;

export type ScheduleFlag = keyof typeof FLAG_LABELS;

// What the workspace says, by its parts.
export const SCHEDULE_CREATE_VIEW_WORDS = {
  what: (namespace: string) =>
    `A schedule made from the fields set below, in ${namespace}. The main process reads the storage location and the snapshot locations named when the review is asked, and again when the schedule is created.`,
  nameRule: `${SCHEDULE_FORM_WORDS.nameRule} The name is the operator's: the form proposes none. A schedule of that name already in the installation is a conflict, and nothing is created.`,
  nameTaken: (name: string) =>
    `A schedule named ${name} is among the ones the installation read: the creation would be a conflict, and nothing would be created.`,
  expressionRule:
    "Five fields, the minute, the hour, the day of the month, the month and the day of the week, as 0 3 * * *, or a descriptor, as @daily or @every 6h; the zone is named before them, as CRON_TZ=Europe/Rome 0 3 * * *.",
  expressionRefused: (reason: string) => `Velero would refuse this expression, with these words: ${reason}`,
  writesOff:
    "Writes are off for this installation: the form can be filled, and the review asks for writes on, which are turned on in the target bar.",
  held: "The review waits for what is said at the name, at the expression and at the fields above.",
  heldName: "The review needs the name of the schedule.",
  heldExpression: "The review needs the expression of the schedule.",
  asking:
    "Asking the main process for the review: it reads the locations named and writes the schedule it would create.",
  running: (name: string) =>
    `Creating the schedule ${name}, then reading it every second for thirty seconds at most, until Velero writes its phase.`,
  runningPaused: (name: string) => `Creating the schedule ${name}, then reading it once: Velero does not read it.`,
  review: "This Schedule will be created when you confirm, and not before:",
  meaning: "What it means",
  text: "What is sent, as it is sent",
  replaced:
    "The confirmation had expired, and the main process, asked again, wrote another text: this review takes the place of the one before, and nothing was created. Read it again before you confirm.",
  created: (name: string, namespace: string) => `The schedule ${name} was created in ${namespace}.`,
  found:
    "The answer of the creation was lost on the way: the schedule was found by its name, with the spec of the review, created since the confirmation.",
  unknownLeft:
    "Look for it among the schedules before asking again: if it was created, its name is taken, and asking again needs another name.",
  errorsLeft: (count: number) =>
    `Velero wrote ${count} more ${count === 1 ? "error" : "errors"}, which the view of the schedule shows.`,
  templateChecked:
    "Velero checks the template only on each backup the schedule creates: a backup whose template it refuses is FailedValidation, while the schedule stays Enabled.",
  listed:
    "The list of the schedules shows it at its next read, within the fifteen seconds of the reads of the views, and its view counts its next run as the one of a new schedule.",
};

// What the result says of what Velero wrote of the schedule after its creation (REQ-238).
export function scheduleResultWords(created: { phase?: string; paused?: true }): string {
  if (created.paused)
    return "It is paused: Velero does not read it, and writes no phase and no validation, until it is resumed.";
  switch (created.phase) {
    case undefined:
      return "Velero has not read it yet: it had no phase after thirty seconds of reads. Its view goes on reading it.";
    case "Enabled":
      return "Velero wrote its phase: Enabled. It took the expression, and submits a backup at its first look after an instant, while no backup of the schedule is New, InProgress or without a phase; the instants missed meanwhile give one backup, not one each.";
    case "FailedValidation":
      return "Velero wrote its phase: FailedValidation. It refused the expression, and submits no backup: each error is as it wrote it.";
    default:
      return `Velero wrote its phase: ${created.phase}.`;
  }
}

// The reads of the installation, and the clock, the review is said with: the offset of the server the views keep for
// the installation and why there is none, the access mode of the storage location named, the namespaces the host
// lists, and the snapshot locations of the installation with their providers.
export interface ScheduleReviewContext {
  now: number;
  offset?: ServerOffset;
  noOffset?: string;
  accessMode?: string;
  listed?: readonly string[];
  snapshotLocations?: readonly { name: string; provider: string }[];
}

// The zone the runs of a schedule of the form are computed in (REQ-231): the zone its expression names; for an
// expression with no zone, or Local, the offset of the server derived in the installation; else none. An interval
// needs no zone, but for the server to load the one it names.
export type ReviewZone =
  | { of: "named"; zone: Zone }
  | { of: "derived"; zone: Zone; offset: ServerOffset; local: boolean }
  | { of: "interval"; named?: string }
  | { of: "not-known"; local: boolean };

export function reviewZone(expression: string, offset: ServerOffset | undefined): ReviewZone | undefined {
  const parsed = parseExpression(expression);

  if (parsed.kind === "refused") return undefined;
  const named = expressionZone(parsed);

  if (parsed.kind === "every")
    return named?.of === "named" ? { of: "interval", named: named.name } : { of: "interval" };
  if (named) return { of: "named", zone: named };
  const local = parsed.zone.of === "local";

  if (offset) return { of: "derived", zone: { of: "fixed", minutes: offset.minutes }, offset, local };
  return { of: "not-known", local };
}

// The expression typed, with the zone named before its fields in place of none or of Local: the way out of a zone that
// is not known, with a placeholder for the zone.
export function withZonePlaceholder(expression: string): string {
  const fields = expression.replace(/^(CRON_TZ|TZ)=\S+\s+/, "");

  return `CRON_TZ=<zone> ${fields}`;
}

// The words of the zone the runs are said in, and of what the server must know of it; why the offset of the server is
// not derived, in words that go on a sentence, when it is not. The review of a resume says them as well.
export function zoneWords(zone: ReviewZone, expression: string, why: string): string {
  switch (zone.of) {
    case "named":
      return `The runs are in the zone ${zone.zone.of === "named" ? zone.zone.name : ""}, which the expression names. The server of the official image of the release knows the zones by their names; a server built otherwise must know this one, which the extension does not read.`;
    case "derived": {
      const { offset } = zone;
      const changed = offset.changed;
      const caveats = [
        ...(offset.shared ? [SIGNAL_WORDS.shared(offset.backup, offset.shared)] : []),
        ...(changed
          ? [
              SIGNAL_WORDS.changed(
                offsetText(changed.minutes),
                changed.backup,
                SIGNAL_WORDS.otherSchedule(changed.schedule),
                momentText({ of: "fixed", minutes: changed.minutes }, changed.submission),
              ),
              ...(changed.shared ? [SIGNAL_WORDS.shared(changed.backup, changed.shared)] : []),
            ]
          : []),
      ];

      return [
        `${zone.local ? "The expression names the zone Local, the one of the Velero server" : "The expression names no zone"}: the runs are in ${offsetText(offset.minutes)}, the offset of the clock of the Velero server when it submitted the backup ${offset.backup} of the schedule ${offset.schedule}, at ${momentText(zone.zone, offset.submission)}. The offset is derived, and across a change of daylight saving time a run may be an hour off.`,
        ...caveats,
      ].join(" ");
    }
    case "interval":
      return zone.named
        ? `An interval is counted without a zone: the zone ${zone.named} the expression names is still one the server loads when it reads the expression, or it refuses the expression.`
        : "An interval is counted without a zone.";
    default:
      return `The next runs are not known: the expression names ${zone.local ? "the zone Local, the one of the Velero server, which" : "no zone, and the zone of the Velero server"} is not known, since ${why}. Naming the zone in the expression gives them: ${withZonePlaceholder(expression)}.`;
  }
}

// The runs to come, from the time of the review, in the zone the schedule is read in (REQ-230): the first one is at
// the first instant after the creation, which is a moment later.
function runsWords(body: ScheduleFromForm, zone: ReviewZone, now: number): string | undefined {
  const parsed = parseExpression(body.spec.schedule);

  if (parsed.kind === "refused") return undefined;
  if (body.spec.paused)
    return "No run is upcoming while the schedule is paused. Once it is resumed, a run is due at once when an instant of the expression has passed since the creation, unless skip immediately is true then.";
  if (parsed.kind === "every") {
    const first = nextInstant(parsed, now, { of: "fixed", minutes: 0 });
    const interval = goDurationText(BigInt(parsed.seconds) * 1_000_000_000n);

    return `The first run is at its interval, ${interval}, after the creation, about ${first.kind === "instant" ? datedRunText({ of: "fixed", minutes: 0 }, first.at) : ""} counted from now; then each one is at its interval after the submission before it, which comes up to a minute after its instant.`;
  }
  if (zone.of !== "named" && zone.of !== "derived") return undefined;
  const runs: string[] = [];
  const repeated = new Set<string>();
  let next = nextInstant(parsed, now, zone.zone);

  if (next.kind === "zone-not-known")
    return `The next runs are not known here: this machine does not know the zone ${next.name}. The server of the official image of the release refuses a zone it cannot load: the schedule would be FailedValidation, and submit no backup, unless the server knows this one.`;
  while (next.kind === "instant" && runs.length < RUNS_SHOWN) {
    runs.push(zonedRunText(zone.zone, next.at));
    // A run in an hour the zone repeats is expected twice: the words of the views say it (REQ-162).
    const twice = repeatedHour(parsed, zone.zone, next.at);

    if (twice) repeated.add(twice);
    next = nextInstant(parsed, next.at, zone.zone);
  }
  return [
    `The next ${runs.length === 1 ? "run" : `${runs.length} runs`}, counted from now, the creation a moment later: ${runs.join("; ")}.`,
    ...repeated,
  ].join(" ");
}

// What each flag does, as written (REQ-232 to REQ-234).
function flagWords(body: ScheduleFromForm): MeaningPart[] {
  const { paused, skipImmediately, useOwnerReferencesInBackup } = body.spec;

  return [
    {
      id: "flag-paused",
      words: paused
        ? `${FLAG_LABELS.paused}: true. Velero does not read a paused schedule: it gets no phase and no validation of its expression, and no backup is submitted, until it is resumed. The run then counts from the creation, so that a schedule resumed after an instant of its expression submits a backup at once, unless skip immediately is true at that moment. Resuming is a change of the schedule of its own, which this form does not make.`
        : `${FLAG_LABELS.paused}: false. Velero reads the schedule when it is created, and validates its expression.`,
    },
    {
      id: "flag-skipImmediately",
      words: !skipImmediately
        ? `${FLAG_LABELS.skipImmediately}: false, written so that the setting of the server, which the extension does not read, does not decide it.`
        : paused
          ? `${FLAG_LABELS.skipImmediately}: true. Nothing happens while the schedule is paused: when it is resumed, Velero sets it back to false at its first reading and counts the next run from that reading, so that the run that is due then is skipped. It acts once.`
          : `${FLAG_LABELS.skipImmediately}: true. At its first reading Velero sets it back to false and writes the time of that reading as the last skipped, from which the next run is counted: the count moves from the creation to that reading, and an instant of the expression between the two is skipped. It acts once.`,
    },
    {
      id: "flag-useOwnerReferencesInBackup",
      words: useOwnerReferencesInBackup
        ? `${FLAG_LABELS.useOwnerReferencesInBackup}: true. Every backup the schedule creates names it as its controlling owner, so that deleting the Schedule makes Kubernetes delete those Backup objects, unless it is deleted with the orphan propagation of Kubernetes. This deletes no data a finished backup holds in the storage: Velero deletes the data of a backup only through a DeleteBackupRequest. While the storage location is Available, its sync brings the finished backups back into the cluster at its next pass, without the reference to the schedule, and they expire by their time to live; the ones that waited for plugins or were finalizing come back only once they expired, as PartiallyFailed. A location whose sync period is zero does not bring them back: their data stays in the storage with no Backup object, which no expiration removes. A backup in progress loses its object, and its pod volume backups and data uploads, which it owns, are deleted with it and cancelled. The server goes on with it and writes it to the storage, but writes no phase after that: the backup stays there as finalizing, which the sync brings into the cluster only once its time to live has passed, as PartiallyFailed, and the collector of expired backups then deletes it with its data.`
        : `${FLAG_LABELS.useOwnerReferencesInBackup}: false. Deleting the Schedule leaves its backups as they are.`,
    },
  ];
}

// What the review of a schedule of the form says beside its text, in the order it is read (REQ-229 to REQ-236): that
// no backup is made at the creation, and when the first one comes; the zone and the runs to come; what each flag does;
// where each backup goes and how long it is kept; that Velero checks the template on each backup; each field of the
// template set or not; and the warnings, each with its way out.
export function scheduleCreateMeaning(body: ScheduleFromForm, context: ScheduleReviewContext): MeaningPart[] {
  const template = body.spec.template;
  const zone = reviewZone(body.spec.schedule, context.offset);
  const parts: MeaningPart[] = [
    {
      id: "no-backup",
      words:
        "Velero submits no backup when the schedule is created: the first one is at the first instant of the expression after the creation, within the minute after it, since Velero looks at each schedule once a minute.",
    },
  ];

  if (zone) {
    parts.push({
      id: "zone",
      words: zoneWords(zone, body.spec.schedule, context.noOffset ?? "no backup among the ones that exist gives it"),
    });
    const runs = runsWords(body, zone, context.now);

    if (runs) parts.push({ id: "runs", words: runs });
  }
  parts.push(...flagWords(body));
  parts.push(
    {
      id: "location",
      words: `Each backup goes to the storage location ${String(template.storageLocation)}${
        context.accessMode ? `, whose access mode is ${context.accessMode}` : ""
      }.`,
    },
    {
      id: "ttl",
      words:
        template.ttl === undefined
          ? "Each backup is kept for the time to live the server sets, 720 hours unless it is started with another, from when Velero starts it."
          : `Each backup is kept for ${String(template.ttl)}, from when Velero starts it.`,
    },
    { id: "template-checked", words: SCHEDULE_CREATE_VIEW_WORDS.templateChecked },
  );
  for (const field of Object.keys(TEMPLATE_FIELD_WORDS) as TemplateField[]) {
    if (field === "storageLocation") continue;
    parts.push({ id: `field-${field}`, words: fieldWords(field, template[field]) });
  }
  // A provider with more than one location and none chosen needs a default of the server (REQ-236): each backup the
  // schedule creates is refused without one.
  parts.push(
    ...providerWarnings(
      (template.volumeSnapshotLocations as string[] | undefined) ?? [],
      context.snapshotLocations ?? [],
      "each backup",
    ),
  );
  const included = (template.includedNamespaces as string[] | undefined) ?? [];
  const listed = context.listed;
  const notListed = listed ? included.filter((namespace) => !listed.includes(namespace)) : [];

  if (notListed.length > 0)
    parts.push({
      id: "not-listed",
      words: `${notListed.join(", ")}: not among the namespaces the host lists. Velero matches each as a pattern, or by its name, when each backup starts.`,
    });
  parts.push({
    id: "labelled-later",
    words:
      "A namespace that is labelled velero.io/exclude-from-backup=true after the review is excluded by Velero when it starts each backup: one the template includes makes that backup FailedValidation.",
  });
  if (
    template.includedResources !== undefined ||
    template.excludedResources !== undefined ||
    template.includeClusterResources !== undefined
  )
    parts.push({
      id: "global-policy",
      words:
        "The resource filters and the cluster-scoped choice make each backup of the schedule FailedValidation when the server names a global volume policy with filters, a setting the extension does not read.",
    });
  return parts;
}
