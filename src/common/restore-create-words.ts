// The words of a restore of a backup (SPEC-0017, REQ-265 to REQ-273): what the workspace says, whether a backup is
// offered and why not, what the review says beside the text, and what the result says. Pure functions of the body, of
// what was read of the installation and of the clock, which are arguments.

import { NON_RESTORABLE, RESTORE_NAME_WORDS, type RestoreForm, type RestoreFromForm } from "./restore-form";

import type { MeaningPart } from "./backup-from-schedule";

// The label and the note of each field of the form.
export const RESTORE_FIELD_WORDS: Record<
  Exclude<keyof RestoreForm, "existingResourcePolicy" | "clusterResources" | "restorePVs">,
  { label: string; notSet: string }
> & {
  clusterResources: { label: string; choices: Record<"every" | "none" | "needed", string> };
  restorePVs: { label: string; choices: Record<"unset" | "true" | "false", string> };
  existingResourcePolicy: { label: string; choices: Record<"none" | "update", string> };
} = {
  includedNamespaces: {
    label: "Included namespaces",
    notSet: "Every namespace the backup holds.",
  },
  excludedNamespaces: { label: "Excluded namespaces", notSet: "None." },
  namespaceMapping: {
    label: "Mapping of the namespaces",
    notSet: "Each namespace is restored into the namespace of its name.",
  },
  includedResources: { label: "Included resources", notSet: "Every resource the backup holds that Velero restores." },
  excludedResources: { label: "Excluded resources", notSet: "None but the ones Velero never restores." },
  labelSelector: { label: "Label selector", notSet: "Every object, whatever its labels." },
  orLabelSelectors: { label: "Any of the label selectors", notSet: "Not set." },
  clusterResources: {
    label: "Cluster-scoped resources",
    choices: {
      every: "Every one the backup holds",
      none: "None",
      needed: "The ones the restored resources need",
    },
  },
  restorePVs: {
    label: "Restore the volumes",
    choices: { unset: "Not set", true: "Yes", false: "No" },
  },
  existingResourcePolicy: {
    label: "Resources that exist",
    choices: { none: "Leave them as they are", update: "Update them" },
  },
};

// The fields of a restore this version does not offer (REQ-273, D9).
export const NOT_OFFERED_OF_A_RESTORE =
  "This version does not offer the hooks, the resource modifier, the resource policy, the filters of the status of the resources, the uploader configuration, preserveNodePorts and the timeout of the item operations: the release takes its defaults for each, and a restore that needs one is asked from the command line.";

// Whether a backup is offered for a restore, and why not (REQ-267, D13): Velero restores all a backup Completed holds,
// and what a backup PartiallyFailed holds, some of its items missing; the controller does not check the phase of the
// backup it is given, and one that has not ended has no files in the store yet, or not all its data.
export function backupOffered(phase: string | undefined): { offered: boolean; words?: string } {
  switch (phase) {
    case "Completed":
      return { offered: true };
    case "PartiallyFailed":
      return {
        offered: true,
        words:
          "The backup PartiallyFailed: Velero restores what it holds, and some of its items may be missing; its view says its errors.",
      };
    case "Failed":
    case "FailedValidation":
      return {
        offered: false,
        words: `The backup is ${phase}: it holds nothing Velero restores whole, and a restore is not offered of it.`,
      };
    case "Deleting":
      return {
        offered: false,
        words: "The backup is Deleting: Velero is deleting its data, and a restore is not offered of it.",
      };
    default:
      return {
        offered: false,
        words: `The backup is ${phase ?? "without a phase"}: it has not ended, so its files are not in the store yet, or not all its data, and a restore is offered once it is Completed or PartiallyFailed.`,
      };
  }
}

// What the workspace says, by its parts.
export const RESTORE_CREATE_VIEW_WORDS = {
  what: (namespace: string) =>
    `A restore of a backup in ${namespace}: Velero writes into the namespaces of the cluster what the backup holds, as the fields below choose. The main process reads the backup again when the review is asked, and again when the restore is created.`,
  nameRule: `${RESTORE_NAME_WORDS.rule} The form proposes a name as the command line forms one, the backup and the time, with the time in UTC. Escape gives the proposal back.`,
  nameTaken: (name: string) =>
    `A restore named ${name} is among the ones the installation read: the creation would be a conflict, and nothing would be created.`,
  from: "Backup",
  fromSchedule: (schedule: string) =>
    `The backups of the schedule ${schedule} that a restore is offered of, Completed or PartiallyFailed, the newest Completed first.`,
  noBackup: (schedule: string) =>
    `The schedule ${schedule} has no backup Completed or PartiallyFailed among the ones the installation read: there is no backup to restore.`,
  backupNotRead:
    "The backups of this installation are not read yet: the review opens once the backup the restore is of is read.",
  backupsForbidden:
    "The identity of this cluster may not read the backups of this installation: the backup a restore is of cannot be read, and no review is asked.",
  backupsFailed:
    "The backups of this installation could not be read: the review opens once they are read again, at the next read of the views.",
  backupMissing: (backup: string, namespace: string) =>
    `The backup ${backup} is not among the backups of ${namespace} the installation read: there is no backup to restore.`,
  backupsReading: "The backups of the schedule are being read: Restore is offered once they are.",
  olderBackups: (count: number) =>
    `${count} older ${count === 1 ? "backup" : "backups"} of the schedule ${count === 1 ? "is" : "are"} not listed here: a restore of one of them is asked from its view.`,
  backupResources: (backup: string) => `The resources of the backup ${backup}`,
  lookFor: (name: string) => `Open the restore ${name}, which says whether it is there`,
  mappingSource: "Namespace of the backup",
  mappingTarget: "Restored into",
  mappingSourceOf: (place: number, count: number) => `Namespace of the backup, mapping ${place} of ${count}`,
  mappingTargetOf: (place: number, count: number) => `Restored into, mapping ${place} of ${count}`,
  mappingAdd: "Add a mapping",
  mappingRemove: (source: string) => `Remove the mapping of ${source || "this namespace"}`,
  writesOff:
    "Writes are off for this installation: the form can be filled, and the review asks for writes on, which are turned on in the target bar.",
  held: "The review waits for what is said at the name and at the fields above.",
  heldName: "The review needs the name of the restore.",
  heldClusterResources: "The review needs a choice of the cluster-scoped resources.",
  asking: "Asking the main process for the review: it reads the backup again and writes the restore it would create.",
  running: (name: string) =>
    `Creating the restore ${name}, then reading it every second for thirty seconds at most, until Velero writes its phase.`,
  review: "This Restore will be created when you confirm, and not before:",
  meaning: "What it means",
  text: "What is sent, as it is sent",
  typeBackup: (backup: string) =>
    `A restore writes into the cluster: type the name of the backup, ${backup}, to create it. The name is compared again when it is created.`,
  typed: "The name is typed as it is written: Create restore is enabled.",
  notTyped: (backup: string) => `Create restore is enabled once ${backup} is typed as it is written.`,
  replaced:
    "The confirmation had expired, and the main process, asked again, wrote another text: this review takes the place of the one before, and nothing was created. Read it again before you confirm.",
  created: (name: string, namespace: string) => `The restore ${name} was created in ${namespace}.`,
  found:
    "The answer of the creation was lost on the way: the restore was found by its name, of the backup of the review, created since the confirmation.",
  unknownLeft:
    "Look for it among the restores before asking again: if it was created, its name is taken, and asking again needs another name.",
  errorsLeft: (count: number) =>
    `Velero wrote ${count} more ${count === 1 ? "error" : "errors"}, which the view of the restore shows.`,
  listed:
    "The list of the restores shows it at its next read, within the fifteen seconds of the reads of the views; its view goes on reading it.",
};

// What the result says of what Velero wrote of the restore after its creation (REQ-272).
export function restoreResultWords(phase: string | undefined): string {
  switch (phase) {
    case undefined:
      return "Velero has not read it yet: it had no phase after thirty seconds of reads. Its view goes on reading it.";
    case "New":
      return "Velero wrote its phase: New. It has not started it yet.";
    case "InProgress":
      return "Velero wrote its phase: InProgress. It is restoring what the backup holds: its view goes on reading it.";
    case "FailedValidation":
      return "Velero wrote its phase: FailedValidation. It refused the restore, which writes nothing: each error is as it wrote it.";
    case "Completed":
      return "Velero wrote its phase: Completed. It restored what the fields chose; its view says the warnings and the errors it counted.";
    case "PartiallyFailed":
      return "Velero wrote its phase: PartiallyFailed. It restored some of what the fields chose; its view says the errors.";
    case "Failed":
      return "Velero wrote its phase: Failed. Its view says why.";
    default:
      return `Velero wrote its phase: ${phase}. Its view goes on reading it.`;
  }
}

// The reads of the installation the review is said with: the namespaces the host lists for the cluster, the phase of
// the backup, its storage location, and the warnings of the form.
export interface RestoreReviewContext {
  listed?: readonly string[];
  backupPhase?: string;
  storageLocation?: string;
  warnings?: readonly string[];
}

// Whether a name is one of the patterns of the release: a namespace with a wildcard is not one the host lists.
function isPattern(name: string): boolean {
  return /[*?[\]]/.test(name);
}

// Whether the host lists a namespace a restore writes into, in words that end a sentence, or nothing when the list is
// not known.
function listedWords(namespace: string, listed: readonly string[] | undefined): string | undefined {
  if (!listed) return undefined;
  return listed.includes(namespace)
    ? "which the host lists in the cluster: Velero restores into it as it is, and never changes the namespace itself."
    : "which the host does not list in the cluster: Velero creates it from the namespace of the backup.";
}

// The words of a list of the form, set or not.
function listWords(field: keyof typeof RESTORE_FIELD_WORDS, value: unknown): string {
  const words = RESTORE_FIELD_WORDS[field] as { label: string; notSet?: string };

  if (!Array.isArray(value) || value.length === 0) return `${words.label}: not set. ${words.notSet ?? ""}`.trim();
  return `${words.label}: ${value.join(", ")}.`;
}

// The cluster-scoped resources as chosen (REQ-270, D15).
function clusterWords(spec: Record<string, unknown>): string {
  switch (spec.includeClusterResources) {
    case true:
      return "Cluster-scoped resources: every one the backup holds, written true. Velero creates each that is not in the cluster, roles and their bindings among them.";
    case false:
      return "Cluster-scoped resources: none, written false. The volume of a claim backed up by a native snapshot or by a file system backup does not come back; a CSI snapshot of it is restored all the same, as a content under a new name from which the claim gets a new volume, unless the volumes are not restored.";
    default:
      return "Cluster-scoped resources: the ones the restored resources need, left out. Velero adds the volume of a bound claim, restored under a new name when one of its name exists and its namespace is mapped, the priority class of a pod and the content of a CSI snapshot; when the restore takes every namespace, it takes every cluster-scoped resource of the backup.";
  }
}

// What the policy for the resources that exist does (REQ-269).
function policyWords(policy: unknown): string {
  const always =
    "With either policy, a ServiceAccount that exists is merged with the one of the backup, and the namespaces themselves are never changed.";

  return policy === "update"
    ? `Resources that exist: update. Velero applies to a resource of the backup that exists in the cluster and differs a merge patch from the copy in the cluster to the object of the backup, so that a field only the cluster has is removed; it writes the two labels of the restore on one that is the same, and reports as a warning what it could not update. ${always}`
    : `Resources that exist: none. Velero leaves a resource of the backup that exists in the cluster as it is, and reports it as a warning when it differs. ${always}`;
}

// What the review of a restore says beside its text, in the order it is read (REQ-268 to REQ-270, REQ-273): the backup
// and its location; the namespaces, the mappings with their targets, and the namespaces restored without a mapping; the
// resources; the cluster-scoped resources; the volumes; the policy; what Velero never restores and does not restore;
// the labels it writes; what Velero writes into the spec when it starts the restore; what is not known; and the
// warnings.
export function restoreCreateMeaning(body: RestoreFromForm, context: RestoreReviewContext = {}): MeaningPart[] {
  const spec = body.spec as Record<string, unknown>;
  const backup = body.spec.backupName;
  const parts: MeaningPart[] = [
    {
      id: "source",
      words: `The restore takes the backup ${backup}${
        context.storageLocation ? `, from the storage location ${context.storageLocation}` : ""
      }: Velero refuses the restore when the storage location of the backup is not Available.`,
    },
  ];
  const offered = backupOffered(context.backupPhase);

  if (offered.offered && offered.words) parts.push({ id: "partially-failed", words: offered.words });
  parts.push(
    { id: "includedNamespaces", words: listWords("includedNamespaces", spec.includedNamespaces) },
    { id: "excludedNamespaces", words: listWords("excludedNamespaces", spec.excludedNamespaces) },
  );
  const mapping = (spec.namespaceMapping ?? {}) as Record<string, string>;
  const mapped = Object.entries(mapping);

  if (mapped.length === 0)
    parts.push({
      id: "namespaceMapping",
      words: `${RESTORE_FIELD_WORDS.namespaceMapping.label}: not set. ${RESTORE_FIELD_WORDS.namespaceMapping.notSet}`,
    });
  for (const [source, target] of mapped) {
    const listed = listedWords(target, context.listed);

    parts.push({
      id: `mapping-${source}`,
      words: `${source} is restored into ${target}${listed ? `, ${listed}` : ". Whether the host lists it is not known."}`,
    });
  }
  // The namespaces restored without a mapping, by name: whether the host lists each.
  for (const namespace of (spec.includedNamespaces as string[] | undefined) ?? []) {
    if (isPattern(namespace) || namespace in mapping) continue;
    const listed = listedWords(namespace, context.listed);

    if (listed)
      parts.push({ id: `unmapped-${namespace}`, words: `${namespace} is restored into ${namespace}, ${listed}` });
  }
  parts.push(
    { id: "includedResources", words: listWords("includedResources", spec.includedResources) },
    { id: "excludedResources", words: listWords("excludedResources", spec.excludedResources) },
    {
      id: "selector",
      words:
        spec.labelSelector !== undefined
          ? `Label selector: ${JSON.stringify(spec.labelSelector)}. Velero restores the objects it selects.`
          : spec.orLabelSelectors !== undefined
            ? `Any of the label selectors: ${JSON.stringify(spec.orLabelSelectors)}. Velero restores the objects any of them selects.`
            : `Label selector: not set. ${RESTORE_FIELD_WORDS.labelSelector.notSet}`,
    },
    { id: "clusterResources", words: clusterWords(spec) },
    {
      id: "restorePVs",
      words:
        spec.restorePVs === true
          ? "Restore the volumes: true. Velero creates the volumes of the backup from their snapshots, native or CSI, and restores the file system backups of the pods."
          : spec.restorePVs === false
            ? "Restore the volumes: false. Velero creates no volume from a snapshot. A volume backed up with a snapshot of its provider is restored as the backup holds it, naming the disk it named, and its claim is bound to it; a claim of a CSI snapshot gets a new empty volume of its storage class. The file system backups of the pods are restored all the same."
            : "Restore the volumes: not set. Velero restores them as when it is true.",
    },
    { id: "existingResourcePolicy", words: policyWords(spec.existingResourcePolicy) },
    {
      id: "never",
      words: `Velero never restores ${NON_RESTORABLE.join(", ")}, nor mirror pods, the pods that succeeded or failed, and the jobs that completed.`,
    },
    {
      id: "status",
      words:
        "The status of an object is not restored, unless the object carries the annotation velero.io/restore-status set to true.",
    },
    {
      id: "labels",
      words:
        "Every object Velero restores carries the labels velero.io/backup-name and velero.io/restore-name, but the namespaces it creates.",
    },
    {
      id: "resolved",
      words:
        "When it starts the restore, Velero writes into its spec the schedule of the backup, when it has one, which the view of the restore then names, and the timeout of the item operations, and adds to the excluded resources the ones it never restores.",
    },
    {
      id: "not-known",
      words:
        "The extension does not read what the backup holds: which objects Velero will create, leave or update is not known here. The tab of the resources of the backup lists what it holds.",
    },
    { id: "not-offered", words: NOT_OFFERED_OF_A_RESTORE },
  );
  for (const [at, warning] of (context.warnings ?? []).entries()) parts.push({ id: `warning-${at}`, words: warning });
  return parts;
}
