// The backup a schedule is asked for by hand, as `velero backup create --from-schedule` of the reviewed release makes
// it (SPEC-0017, REQ-255, REQ-256): the name the command line proposes, the rules of a name, and the body, built from
// the schedule as it was read, the way `builder.FromSchedule` builds it. The main process builds it at the
// confirmation and again at the run, from the schedule it reads each time; the review shows the text it writes.

// The label every backup of a schedule carries, with the name of the schedule as its value, uncut.
export const SCHEDULE_NAME_LABEL = "velero.io/schedule-name";

// The value of a label has 63 characters at most: the API server refuses a backup whose schedule has a longer name.
export const LABEL_VALUE_LIMIT = 63;

// A name of a backup leaves room for the request of each of its artifacts, `<name>-<identifier of the request>`,
// within the 253 characters of a name (SPEC-0010).
export const BACKUP_NAME_LIMIT = 216;

// A DNS-1123 subdomain: labels of lower-case letters, digits and `-`, each beginning and ending with a letter or a
// digit, joined by dots.
const SUBDOMAIN = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?(\.[a-z0-9]([-a-z0-9]*[a-z0-9])?)*$/;

export const BACKUP_NAME_WORDS = {
  rule: `A name of lower-case letters, digits, "-" and ".", beginning and ending with a letter or a digit, with no "." next to another "." or to a "-", of ${BACKUP_NAME_LIMIT} characters at most, so that the request of each of its artifacts keeps to the 253 characters of a name.`,
  empty: "The backup needs a name.",
  long: (length: number) =>
    `The name has ${length} characters, ${length - BACKUP_NAME_LIMIT} more than ${BACKUP_NAME_LIMIT}.`,
  form: "The name is not one the API server takes.",
  scheduleTooLong: (length: number) =>
    `The schedule has a name of ${length} characters: every backup of a schedule carries its name as the value of the label ${SCHEDULE_NAME_LABEL}, which the API server refuses above ${LABEL_VALUE_LIMIT} characters.`,
};

// The name the command line proposes for a backup of the schedule: `<schedule>-<yyyymmddhhmmss>`, the time in UTC
// (`Schedule.TimestampedName` of the reviewed release).
export function proposedBackupName(schedule: string, now: number): string {
  return `${schedule}-${new Date(now).toISOString().slice(0, 19).replace(/[-:T]/g, "")}`;
}

// What is wrong with a name of a backup, in words, or nothing when the API server takes it.
export function backupNameProblem(name: string): string | undefined {
  if (name === "") return BACKUP_NAME_WORDS.empty;
  if (name.length > BACKUP_NAME_LIMIT) return BACKUP_NAME_WORDS.long(name.length);
  return SUBDOMAIN.test(name) ? undefined : BACKUP_NAME_WORDS.form;
}

// Why a schedule cannot be asked for a backup by hand, or nothing when it can.
export function scheduleRefused(schedule: string): string | undefined {
  return schedule.length > LABEL_VALUE_LIMIT ? BACKUP_NAME_WORDS.scheduleTooLong(schedule.length) : undefined;
}

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

// The body of the backup, which the text of the review writes. Its parts are plain JSON, copied from the schedule.
export interface BackupFromSchedule {
  apiVersion: "velero.io/v1";
  kind: "Backup";
  metadata: {
    name: string;
    namespace: string;
    labels: Record<string, string>;
    annotations?: Record<string, string>;
    ownerReferences?: [{ apiVersion: "velero.io/v1"; kind: "Schedule"; name: string; uid: string; controller: true }];
  };
  spec: { [key: string]: Json };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function textMap(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) return undefined;
  const entries = Object.entries(value);

  return entries.every(([, text]) => typeof text === "string")
    ? Object.fromEntries(entries as [string, string][])
    : undefined;
}

// A copy of what the schedule holds, as plain JSON: what is not JSON is not in a body.
function copy(value: unknown): Json | undefined {
  if (value === null || typeof value === "boolean" || typeof value === "string") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (Array.isArray(value)) return value.map((item) => copy(item) ?? null);
  if (!isRecord(value)) return undefined;
  const result: { [key: string]: Json } = {};

  for (const [key, item] of Object.entries(value)) {
    const copied = copy(item);

    if (copied !== undefined) result[key] = copied;
  }
  return result;
}

// The backup the reviewed release makes from the schedule, named as given, in the namespace of the schedule:
// - its spec is the template of the schedule, whole, with a resource policy written as a reference of the kind
//   `configmap`, as the builder rewrites it;
// - its labels are the ones of the template when the template has a map of labels, even an empty one, else the ones
//   of the schedule, never both, with `velero.io/schedule-name` set to the name of the schedule; the builder sets it in
//   the map of the template, which the spec holds, so the labels of the spec take it too;
// - its annotations are the ones of the schedule, when it has any;
// - the schedule is its controlling owner only with `useOwnerReferencesInBackup` true.
// A schedule read without a name, a namespace or a UID makes no backup.
export function backupFromSchedule(schedule: unknown, name: string): BackupFromSchedule | undefined {
  if (!isRecord(schedule) || !isRecord(schedule.metadata)) return undefined;
  const { name: scheduleName, namespace, uid } = schedule.metadata;

  if (typeof scheduleName !== "string" || typeof namespace !== "string" || typeof uid !== "string") return undefined;
  if (!scheduleName || !namespace || !uid) return undefined;
  const spec = isRecord(schedule.spec) ? schedule.spec : {};
  const template = copy(isRecord(spec.template) ? spec.template : {}) as { [key: string]: Json };
  const templateLabels = isRecord(template.metadata) ? template.metadata.labels : undefined;
  const labels = {
    ...((templateLabels !== undefined && templateLabels !== null
      ? textMap(templateLabels)
      : textMap(schedule.metadata.labels)) ?? {}),
    [SCHEDULE_NAME_LABEL]: scheduleName,
  };
  const annotations = textMap(schedule.metadata.annotations);
  const policy = template.resourcePolicy;

  if (isRecord(template.metadata) && templateLabels !== undefined && templateLabels !== null) {
    template.metadata.labels = { ...labels };
  }

  if (isRecord(policy)) {
    template.resourcePolicy = { kind: "configmap", name: typeof policy.name === "string" ? policy.name : "" };
  }
  return {
    apiVersion: "velero.io/v1",
    kind: "Backup",
    metadata: {
      name,
      namespace,
      labels,
      ...(annotations && Object.keys(annotations).length ? { annotations } : {}),
      ...(spec.useOwnerReferencesInBackup === true
        ? {
            ownerReferences: [
              { apiVersion: "velero.io/v1", kind: "Schedule", name: scheduleName, uid, controller: true } as const,
            ] as [{ apiVersion: "velero.io/v1"; kind: "Schedule"; name: string; uid: string; controller: true }],
          }
        : {}),
    },
    spec: template,
  };
}

// The body a text writes, read back: what the review says beside the text is of what is sent. Nothing when the text is
// not the body of a Backup with its labels.
export function readBody(text: string): BackupFromSchedule | undefined {
  try {
    const body = JSON.parse(text) as BackupFromSchedule;

    return isRecord(body) && body.kind === "Backup" && isRecord(body.metadata) && isRecord(body.metadata.labels)
      ? body
      : undefined;
  } catch {
    return undefined;
  }
}

// The keys of an object in the order the text writes them: the ones of a Kubernetes object first, in their usual
// order, then the others by their characters.
const FIRST = [
  "apiVersion",
  "kind",
  "metadata",
  "spec",
  "name",
  "namespace",
  "labels",
  "annotations",
  "ownerReferences",
];

function ordered(value: Json): Json {
  if (Array.isArray(value)) return value.map(ordered);
  if (value === null || typeof value !== "object") return value;
  const keys = Object.keys(value).sort((one, other) => {
    const [first, second] = [FIRST.indexOf(one), FIRST.indexOf(other)];

    if (first >= 0 || second >= 0) return (first < 0 ? FIRST.length : first) - (second < 0 ? FIRST.length : second);
    return one < other ? -1 : one > other ? 1 : 0;
  });

  return Object.fromEntries(keys.map((key) => [key, ordered(value[key])]));
}

// The text of a body as it is sent, written once: two spaces of indentation and the keys in a fixed order, so that
// the same body is always the same text, byte for byte.
export function bodyText(body: BackupFromSchedule): string {
  return JSON.stringify(ordered(body as unknown as Json), null, 2);
}

// One part of what the review says, and what it is about.
export interface MeaningPart {
  id: string;
  words: string;
}

export const MEANING_WORDS = {
  byHand:
    "The backup is asked by hand and is not a submission of the schedule: it moves nothing in the schedule, whose next run stays where it is.",
  queue:
    "It waits in the queue of the server, Queued and then ReadyToStart, behind a backup that runs, and while an earlier backup takes some of its namespaces.",
  hold: "While it has no phase, or is New or InProgress, the schedule submits none of its own: a run that falls due meanwhile is submitted once, at the first look after it. Queued and ReadyToStart do not hold it.",
  restore:
    "A restore asked from the schedule may take this backup: the newest Completed one with the label of the schedule.",
  validation:
    "The template is validated when the backup starts: a template Velero refuses makes the backup FailedValidation.",
  paused: "The schedule is paused: the backup is made all the same, from its template.",
  refused:
    "The schedule failed its validation: the backup is made all the same, from its template, which Velero validates when the backup starts.",
  owner:
    "The schedule is the owner of the backup, by useOwnerReferencesInBackup: deleting the schedule deletes this backup, as it deletes the ones it submitted.",
  scheduleLabel: (schedule: string) =>
    `${SCHEDULE_NAME_LABEL}: ${schedule}. Velero finds the backups of the schedule by this label, for the hold of its submissions and for a restore from the schedule.`,
  label: (key: string, value: string, from: "template" | "schedule") =>
    `${key}: ${value}, from the labels of the ${from === "template" ? "template of the schedule" : "schedule"}.`,
  annotation: (key: string) => `The annotation ${key}, from the annotations of the schedule.`,
};

// What the review of a backup asked from a schedule says beside its text, in the order it is read: what Velero does
// with it and when, what the state of the schedule changes, the owner, and each label and annotation the backup takes
// from the schedule, by its key. The labels, the annotations and the owner are read in the body, which the main
// process built from the schedule as it read it; whether the schedule is paused or refused, in the schedule as the views
// read it.
export function backupFromScheduleMeaning(schedule: unknown, body: BackupFromSchedule): MeaningPart[] {
  const read = isRecord(schedule) ? schedule : {};
  const spec = isRecord(read.spec) ? read.spec : {};
  const status = isRecord(read.status) ? read.status : {};
  // The builder writes the labels into the template only when the template has a map of them, which they come from.
  const fromTemplate = isRecord(body.spec.metadata) && isRecord(body.spec.metadata.labels);
  const name = body.metadata.labels[SCHEDULE_NAME_LABEL];
  const parts: MeaningPart[] = [
    { id: "by-hand", words: MEANING_WORDS.byHand },
    { id: "queue", words: MEANING_WORDS.queue },
    { id: "hold", words: MEANING_WORDS.hold },
    { id: "restore", words: MEANING_WORDS.restore },
    { id: "validation", words: MEANING_WORDS.validation },
  ];

  if (spec.paused === true) parts.push({ id: "paused", words: MEANING_WORDS.paused });
  if (status.phase === "FailedValidation") parts.push({ id: "refused", words: MEANING_WORDS.refused });
  if (body.metadata.ownerReferences) parts.push({ id: "owner", words: MEANING_WORDS.owner });
  parts.push({ id: `label:${SCHEDULE_NAME_LABEL}`, words: MEANING_WORDS.scheduleLabel(name) });
  for (const [key, value] of Object.entries(body.metadata.labels).sort(([one], [other]) => (one < other ? -1 : 1))) {
    if (key !== SCHEDULE_NAME_LABEL) {
      parts.push({
        id: `label:${key}`,
        words: MEANING_WORDS.label(key, value, fromTemplate ? "template" : "schedule"),
      });
    }
  }
  for (const key of Object.keys(body.metadata.annotations ?? {}).sort()) {
    parts.push({ id: `annotation:${key}`, words: MEANING_WORDS.annotation(key) });
  }
  return parts;
}
