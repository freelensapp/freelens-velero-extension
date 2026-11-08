// The words of a backup of the form (SPEC-0017, REQ-260 to REQ-264): the label of each field of the template and what
// the release does with it when it is not set, in the words of the table of the template of SPEC-0016; what the review
// says beside the text; and what the result says. Pure functions, which the unit tests read whole.

import { BACKUP_NAME_WORDS, type MeaningPart } from "./backup-from-schedule";

import type { BackupFromForm } from "./backup-form";
import type { TemplateField } from "./backup-template";
import type { ReadStatus } from "./read-state";

// The label of each field, as the table of the form names it, what the release does with it when it is not set, and,
// for a choice, what it does with each value.
export const TEMPLATE_FIELD_WORDS: Record<
  TemplateField,
  { label: string; notSet: string; true?: string; false?: string }
> = {
  includedNamespaces: { label: "Included namespaces", notSet: "Every namespace, *." },
  excludedNamespaces: {
    label: "Excluded namespaces",
    notSet: "None, beside the namespaces labelled velero.io/exclude-from-backup=true, which Velero adds.",
  },
  includedResources: { label: "Included resources", notSet: "Every resource." },
  // Velero adds the snapshots of CSI to the excluded resources of every backup whose lists it takes, and takes them out
  // of the included ones: it handles only the ones it makes during the backup (backup_controller.go L72-L83, L529-L540).
  excludedResources: {
    label: "Excluded resources",
    notSet:
      "None of the operator's: Velero excludes the snapshots of CSI, volumesnapshots.snapshot.storage.k8s.io and volumesnapshotcontents.snapshot.storage.k8s.io, from every backup, and handles only the ones it makes during the backup.",
  },
  includeClusterResources: {
    label: "Cluster-scoped resources",
    notSet:
      "Taken when every namespace is; with some namespaces, only the ones an action adds, as the volume of a claim.",
    true: "Taken, whether every namespace is included or some are.",
    false: "Left out, the ones an action adds included.",
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
  // A volume policy of the server decides first, and a volume backed up with the file system backup is not
  // snapshotted (volume_policy_helper.go L155-L215).
  snapshotVolumes: {
    label: "Snapshot volumes",
    notSet: "True: the volumes are snapshotted.",
    true: "The persistent volumes are snapshotted, but the ones a volume policy decides otherwise and the ones backed up with the file system backup.",
    false: "No persistent volume is snapshotted, but the ones a volume policy says to snapshot.",
  },
  // A pod opts its volumes in with its annotation, or out of the default (pod_volume.go L177-L215).
  defaultVolumesToFsBackup: {
    label: "File system backup of every volume",
    notSet: "The setting of the server, false unless it is started with it.",
    true: "Every volume of a pod is backed up with the file system backup, but the ones the pod opts out of with its annotation and the ones that hold nothing of their own, as the volumes of Secrets and ConfigMaps.",
    false: "Only the volumes a pod opts in with its annotation are backed up with the file system backup.",
  },
  snapshotMoveData: {
    label: "Move the data of snapshots",
    notSet: "The setting of the server, false unless it is started with it.",
    true: "The data of the snapshots of CSI is moved by the data mover into the storage of the backup.",
    false: "The data of the snapshots of CSI is not moved: it stays where the storage keeps the snapshots.",
  },
  ttl: { label: "Time to live", notSet: "The setting of the server, 720 hours unless it is started with another." },
  csiSnapshotTimeout: { label: "CSI snapshot timeout", notSet: "Ten minutes." },
  itemOperationTimeout: {
    label: "Item operation timeout",
    notSet: "The setting of the server, four hours unless it is started with another.",
  },
};

// The fields of REQ-237 of SPEC-0016, which this version does not offer, for a backup of the form and for the backups of
// a schedule of the form.
export const NOT_OFFERED =
  "This version does not offer the hooks, the ordered resources, the resource policy, the uploader configuration, the labels and the annotations of the backup, the scoped resource filters, the label of a volume group snapshot and the data mover: a backup that needs one is asked from the command line.";
export const NOT_OFFERED_OF_A_SCHEDULE =
  "This version does not offer the hooks, the ordered resources, the resource policy, the uploader configuration, the labels and the annotations of its backups, the scoped resource filters, the label of a volume group snapshot and the data mover: a schedule that needs one is created from the command line.";

// What the workspace says, by its parts.
export const BACKUP_CREATE_VIEW_WORDS = {
  what: (namespace: string) =>
    `A backup made from the fields set below, in ${namespace}. The main process reads the storage location and the snapshot locations named when the review is asked, and again when the backup is created.`,
  nameRule: `${BACKUP_NAME_WORDS.rule} The name is the operator's: the form proposes none. A backup of that name already in the installation is a conflict, and nothing is created.`,
  nameTaken: (name: string) =>
    `A backup named ${name} is among the ones the installation read: the creation would be a conflict, and nothing would be created.`,
  writesOff:
    "Writes are off for this installation: the form can be filled, and the review asks for writes on, which are turned on in the target bar.",
  gateUnknown: "Whether writes are on is not known: the target bar asks the main process again.",
  noLocation: "No storage location of this installation can be chosen: the review does not open.",
  chosenRefused: (reason: string) => `The location chosen cannot be chosen any more: ${reason} Choose another.`,
  chosenGone: (name: string) =>
    `The location chosen, ${name}, is not among the ones the installation read any more. Choose another.`,
  held: "The review waits for what is said at the name and at the fields above.",
  heldName: "The review needs the name of the backup.",
  unavailable: (name: string) => `${name}: not reported Available. Velero refuses every backup sent to it.`,
  readOnly: (name: string) => `${name}: ReadOnly. Velero refuses every backup sent to it.`,
  defaultLocation: (name: string) => `${name}, marked default`,
  notListed: (namespaces: string[]) =>
    `${namespaces.join(", ")}: not among the namespaces the host lists. Velero matches each as a pattern, or by its name, when the backup starts.`,
  labelledExcluded: (namespace: string) =>
    `The host lists ${namespace} with the label velero.io/exclude-from-backup=true: Velero adds it to the excluded namespaces, and a backup that includes it is FailedValidation.`,
  asking: "Asking the main process for the review: it reads the locations named and writes the backup it would create.",
  running: (name: string) =>
    `Creating the backup ${name}, then reading it every second for thirty seconds at most, until Velero writes its phase.`,
  review: "This Backup will be created when you confirm, and not before:",
  meaning: "What it means",
  text: "What is sent, as it is sent",
  created: (name: string) => `The backup ${name} was created.`,
  unread:
    "Velero had not written its phase when the reads after the creation ended, after thirty seconds at most. Its view goes on reading it.",
  errorsLeft: (count: number) =>
    `Velero wrote ${count} more ${count === 1 ? "error" : "errors"}, which the view of the backup shows.`,
  found:
    "The answer of the creation was lost on the way: the backup was found by its name, created since the confirmation.",
  unknownLeft:
    "Look for it among the backups before asking again: if it was created, its name is taken, and asking again needs another name.",
  replaced:
    "The confirmation had expired, and the main process, asked again, wrote another text: this review takes the place of the one before, and nothing was created. Read it again before you confirm.",
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
      return "Velero wrote its phase: ReadyToStart. Its queue let it go, and the backup controller starts it next.";
    case "InProgress":
      return "Velero wrote its phase: InProgress.";
    case "FailedValidation":
      return "Velero wrote its phase: FailedValidation. It refused the backup, which makes nothing: its view says each error.";
    default:
      return `Velero wrote its phase: ${phase}.`;
  }
}

// What a read of the locations of the installation is at, in words, while they are not known: a read that is denied,
// not served or failed is not an installation without locations.
export function locationsReadWords(status: ReadStatus, kind: "storage" | "snapshot"): string {
  const plural = kind === "storage" ? "storage locations" : "snapshot locations";
  const after =
    kind === "storage"
      ? "None can be chosen, and the review does not open."
      : "Whether the installation has some is not known: none is chosen, and each backup takes, for each provider, its only location or the default the server names.";

  switch (status) {
    case "forbidden":
      return `The ${plural} of this installation cannot be read: access is denied. ${after}`;
    case "not-served":
      return `The cluster does not serve the ${plural} of Velero. ${after}`;
    case "failed":
      return `The ${plural} of this installation could not be read. ${after}`;
    default:
      return kind === "storage"
        ? "The storage locations of this installation are not read yet: the review opens once one can be chosen."
        : "The snapshot locations of this installation are not read yet.";
  }
}

// The reads of the installation the review is said with: the access mode of the storage location named, when it is
// written, the namespaces the host lists, and the snapshot locations with their providers.
export interface ReviewContext {
  accessMode?: string;
  listed?: readonly string[];
  snapshotLocations?: readonly { name: string; provider: string }[];
}

// What a field of the template set says: its value and, for a choice, what it does.
export function fieldWords(field: TemplateField, value: unknown): string {
  const words = TEMPLATE_FIELD_WORDS[field];

  if (value === undefined) return `${words.label}: not set. ${words.notSet}`;
  const meaning = value === true ? words.true : value === false ? words.false : undefined;

  return `${words.label}: ${written(value)}.${meaning ? ` ${meaning}` : ""}`;
}

// A provider with more than one snapshot location and none chosen needs a default of the server (SPEC-0016, REQ-236):
// Velero refuses a backup without one, whether it snapshots volumes or not (backup_controller.go L681-L694).
export function providerWarnings(
  chosen: readonly string[],
  locations: readonly { name: string; provider: string }[],
  refused = "the backup",
): MeaningPart[] {
  const providers = [...new Set(locations.map((location) => location.provider))].sort();

  return providers.flatMap((provider) => {
    const ofProvider = locations.filter((location) => location.provider === provider);

    return ofProvider.length > 1 && !ofProvider.some((location) => chosen.includes(location.name))
      ? [
          {
            id: `provider-${provider}`,
            words: `The provider ${provider} has ${ofProvider.length} snapshot locations and none is chosen: Velero then needs a default of the server for that provider, which the extension does not read, and refuses ${refused} without one.`,
          },
        ]
      : [];
  });
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
    parts.push({ id: `field-${field}`, words: fieldWords(field, spec[field]) });
  }
  parts.push(
    ...providerWarnings((spec.volumeSnapshotLocations as string[] | undefined) ?? [], context.snapshotLocations ?? []),
  );
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
        "The resource filters and the cluster-scoped choice make the backup FailedValidation when the server names a global volume policy with filters, a setting the extension does not read.",
    });
  parts.push({ id: "resolved", words: BACKUP_CREATE_VIEW_WORDS.resolved });
  return parts;
}
