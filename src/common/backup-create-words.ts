// The words of a backup of the form (SPEC-0017, REQ-260 to REQ-264): the label of each field of the template and what
// the release does with it when it is not set, in the words of the table of the template of SPEC-0016; what the review
// says beside the text; and what the result says. Pure functions, which the unit tests read whole.

import type { BackupFromForm } from "./backup-form";
import type { MeaningPart } from "./backup-from-schedule";
import type { TemplateField } from "./backup-template";

// The label of each field, as the table of the form names it, and what the release does with it when it is not set.
export const TEMPLATE_FIELD_WORDS: Record<TemplateField, { label: string; notSet: string }> = {
  includedNamespaces: { label: "Included namespaces", notSet: "Every namespace, *." },
  excludedNamespaces: {
    label: "Excluded namespaces",
    notSet: "None, beside the namespaces labelled velero.io/exclude-from-backup=true, which Velero adds.",
  },
  includedResources: { label: "Included resources", notSet: "Every resource." },
  excludedResources: { label: "Excluded resources", notSet: "None: every resource that is included." },
  includeClusterResources: {
    label: "Cluster-scoped resources",
    notSet:
      "Taken when every namespace is; with some namespaces, only the ones an action adds, as the volume of a claim.",
  },
  labelSelector: { label: "Label selector", notSet: "No filter." },
  orLabelSelectors: { label: "Any of several label selectors", notSet: "No filter." },
  storageLocation: {
    label: "Storage location",
    notSet: "The location marked default, else the one the server names: the form always writes one.",
  },
  volumeSnapshotLocations: {
    label: "Snapshot locations",
    notSet: "For each provider, its only location, or the default the server names for it.",
  },
  snapshotVolumes: { label: "Snapshot volumes", notSet: "True: the volumes are snapshotted." },
  defaultVolumesToFsBackup: {
    label: "File system backup of every volume",
    notSet: "The setting of the server, false unless it is started with it.",
  },
  snapshotMoveData: {
    label: "Move the data of snapshots",
    notSet: "The setting of the server, false unless it is started with it.",
  },
  ttl: { label: "Time to live", notSet: "The setting of the server, 720 hours unless it is started with another." },
  csiSnapshotTimeout: { label: "CSI snapshot timeout", notSet: "Ten minutes." },
  itemOperationTimeout: {
    label: "Item operation timeout",
    notSet: "The setting of the server, four hours unless it is started with another.",
  },
};

// The fields of REQ-237 of SPEC-0016, which this version does not offer.
export const NOT_OFFERED =
  "This version does not offer the hooks, the ordered resources, the resource policy, the uploader configuration, the labels and the annotations of the backup, the scoped resource filters, the label of a volume group snapshot and the data mover: a backup that needs one is asked from the command line.";

// What the workspace says, by its parts.
export const BACKUP_CREATE_VIEW_WORDS = {
  what: (namespace: string) =>
    `A backup made from the fields set below, in ${namespace}. The main process reads the storage location and the snapshot locations named when the review is asked, and again when the backup is created.`,
  nameRule:
    "A name of lower-case letters, digits, - and ., chosen by the operator: the form proposes none. A backup of that name already in the installation is a conflict, and nothing is created.",
  nameTaken: (name: string) =>
    `A backup named ${name} is among the ones the installation read: the creation would be a conflict, and nothing would be created.`,
  writesOff:
    "Writes are off for this installation: the form can be filled, and the review asks for writes on, which are turned on in the target bar.",
  gateUnknown: "Whether writes are on is not known: the target bar asks the main process again.",
  locationsUnknown: (state: string) =>
    `The storage locations are not known yet (${state}): the review opens once one can be chosen.`,
  noLocation: "No storage location of this installation can be chosen: the review does not open.",
  unavailable: (name: string) => `${name}: not reported Available. Velero refuses every backup sent to it.`,
  readOnly: (name: string) => `${name}: ReadOnly. Velero refuses every backup sent to it.`,
  defaultLocation: (name: string) => `${name}, marked default`,
  notListed: (namespaces: string[]) =>
    `${namespaces.join(", ")}: not among the namespaces the host lists. Velero matches each as a pattern, or by its name, when the backup starts.`,
  labelledExcluded: (namespace: string) =>
    `The host lists ${namespace} with the label velero.io/exclude-from-backup=true: Velero adds it to the excluded namespaces, and a backup that includes it is FailedValidation.`,
  oneProvider: (provider: string) => `${provider}: one location at most, or none for the default of the server.`,
  asking: "Asking the main process for the review: it reads the locations named and writes the backup it would create.",
  running: (name: string) =>
    `Creating the backup ${name}, then reading it every second for thirty seconds at most, until Velero writes its phase.`,
  review: "This Backup will be created when you confirm, and not before:",
  meaning: "What it means",
  text: "What is sent, as it is sent",
  created: (name: string) => `The backup ${name} was created.`,
  unread: "Velero has not read it yet: it had no phase after thirty seconds of reads. Its view goes on reading it.",
  found:
    "The answer of the creation was lost on the way: the backup was found by its name, created since the confirmation.",
  unknownLeft:
    "Look for it among the backups before asking again: if it was created, its name is taken, and asking again needs another name.",
  replaced:
    "The locations changed while the review was read: this review takes the place of the one before, and nothing was created. Read it again before you confirm.",
  resolved:
    "When it starts the backup, Velero writes into its spec the values it resolved for the fields that were not set, and what it adds to the lists that were set, the namespaces labelled to be excluded and the snapshots of volumes: the view of the backup then shows them. The time to live counts from that start.",
};

// What a phase Velero wrote of a new backup says (SPEC-0017, REQ-264).
export function phaseWords(phase: string, position?: number): string {
  switch (phase) {
    case "New":
      return "Velero wrote its phase: New. It has not put it in its queue yet.";
    case "Queued":
      return position === undefined
        ? "Velero wrote its phase: Queued. It waits for the backups before it."
        : `Velero wrote its phase: Queued, number ${position} in the queue.`;
    case "ReadyToStart":
      return "Velero wrote its phase: ReadyToStart. It starts it when no backup runs.";
    case "InProgress":
      return "Velero wrote its phase: InProgress.";
    case "FailedValidation":
      return "Velero wrote its phase: FailedValidation. It refused the backup, which makes nothing: its view says each error.";
    default:
      return `Velero wrote its phase: ${phase}.`;
  }
}

// The reads of the installation the review is said with: the access mode of the storage location named, the
// namespaces the host lists, and the ones it lists with the label that excludes them.
export interface ReviewContext {
  accessMode?: string;
  listed?: readonly string[];
}

function written(value: unknown): string {
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "object" && value !== null) return JSON.stringify(value);
  return String(value);
}

// What the review of a backup of the form says beside its text, in the order it is read (SPEC-0017, REQ-263): that
// Velero validates it when it starts it; where it goes and how long it is kept; for each field set and for each field
// not set, what it does; and the warnings.
export function backupCreateMeaning(body: BackupFromForm, context: ReviewContext = {}): MeaningPart[] {
  const spec = body.spec;
  const parts: MeaningPart[] = [
    {
      id: "validated",
      words:
        "Velero validates the backup when it starts it: a backup it refuses is FailedValidation, with its errors, and makes nothing.",
    },
    {
      id: "queue",
      words:
        "It waits in the queue of the server, Queued and then ReadyToStart, one at a time by default, and while an earlier backup takes some of its namespaces.",
    },
    {
      id: "location",
      words: `It goes to the storage location ${String(spec.storageLocation)}${
        context.accessMode ? `, whose access mode is ${context.accessMode}` : ""
      }.`,
    },
    {
      id: "ttl",
      words:
        spec.ttl === undefined
          ? "It is kept for the time to live the server sets, 720 hours unless it is started with another, from when Velero starts it."
          : `It is kept for ${String(spec.ttl)}, from when Velero starts it.`,
    },
  ];
  for (const field of Object.keys(TEMPLATE_FIELD_WORDS) as TemplateField[]) {
    if (field === "storageLocation") continue;
    const { label, notSet } = TEMPLATE_FIELD_WORDS[field];
    const value = spec[field];

    parts.push({
      id: `field-${field}`,
      words: value === undefined ? `${label}: not set. ${notSet}` : `${label}: ${written(value)}.`,
    });
  }
  const included = (spec.includedNamespaces as string[] | undefined) ?? [];
  const listed = context.listed;
  const notListed = listed ? included.filter((namespace) => !listed.includes(namespace)) : [];

  if (notListed.length > 0) parts.push({ id: "not-listed", words: BACKUP_CREATE_VIEW_WORDS.notListed(notListed) });
  parts.push({
    id: "labelled-later",
    words:
      "A namespace that is labelled velero.io/exclude-from-backup=true after the review is excluded by Velero when it starts the backup: one the backup includes makes it FailedValidation.",
  });
  if (
    spec.includedResources !== undefined ||
    spec.excludedResources !== undefined ||
    spec.includeClusterResources !== undefined
  )
    parts.push({
      id: "global-policy",
      words:
        "The resource filters and the cluster-scoped choice are refused, for every backup, when the server names a global volume policy with filters, a setting the extension does not read.",
    });
  parts.push({ id: "resolved", words: BACKUP_CREATE_VIEW_WORDS.resolved });
  return parts;
}
