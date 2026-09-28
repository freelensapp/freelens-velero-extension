import { operationDuration, timestamp } from "./duration";
import { counts, operationEvidence } from "./evidence";
import {
  durationText,
  lifecycleText,
  NOT_REPORTED,
  phaseText,
  progressText,
  signalText,
  timeText,
} from "./operation-text";
import { operationState } from "./phases";
import { itemProgress } from "./progress";

import type { OperationDuration } from "./duration";
import type { Count, OperationEvidence } from "./evidence";
import type { OperationState } from "./phases";
import type { ItemProgress } from "./progress";
import type { LabelSelector, RestoreResource, TypedLocalObjectReference } from "./types";

// What the list and the workspace show of a restore, and the section of the details of the host: one
// reading of the object, wherever the restore is shown. The object is what Velero keeps of a restore,
// which is not only what was submitted.
export interface RestoreView {
  name: string;
  namespace: string;
  uid?: string;
  state: OperationState;
  evidence: OperationEvidence;
  progress: ItemProgress;
  duration: OperationDuration;
  started?: number;
  completed?: number;
  created?: number;
  // The source as the object names it: one of the two, both, or neither.
  backup?: string;
  schedule?: string;
  // The object has a time of deletion: Velero removes what it keeps of the restore, then the object.
  deleting: boolean;
  hooks: { attempted: Count; failed: Count };
  operations: { attempted: Count; completed: Count; failed: Count };
}

function named(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

export function restoreView(restore: RestoreResource, now: number): RestoreView {
  const state = operationState("Restore", restore.status?.phase);

  return {
    name: restore.metadata.name,
    namespace: restore.metadata.namespace ?? "",
    uid: restore.metadata.uid,
    state,
    evidence: operationEvidence(state, restore.status),
    progress: itemProgress("Restore", restore.status?.progress),
    duration: operationDuration(state, restore.status, now),
    started: timestamp(restore.status?.startTimestamp),
    completed: timestamp(restore.status?.completionTimestamp),
    created: timestamp(restore.metadata.creationTimestamp),
    backup: named(restore.spec?.backupName),
    schedule: named(restore.spec?.scheduleName),
    deleting: named(restore.metadata.deletionTimestamp) !== undefined,
    // The release counts the hooks of a restore when it finalizes it, after the phases that follow the
    // work: they are counted when their status is in the object, whatever the phase.
    hooks: counts(
      {
        attempted: restore.status?.hookStatus?.hooksAttempted,
        failed: restore.status?.hookStatus?.hooksFailed,
      },
      typeof restore.status?.hookStatus === "object" && restore.status.hookStatus !== null,
    ),
    operations: counts(
      {
        attempted: restore.status?.restoreItemOperationsAttempted,
        completed: restore.status?.restoreItemOperationsCompleted,
        failed: restore.status?.restoreItemOperationsFailed,
      },
      state.counted,
    ),
  };
}

// The source in one line, for a column: the backup, then the schedule when the object names one.
export function sourceText(view: Pick<RestoreView, "backup" | "schedule">): string {
  if (view.backup) return view.schedule ? `${view.backup}, schedule ${view.schedule}` : view.backup;
  return view.schedule ? `Schedule ${view.schedule}` : NOT_REPORTED;
}

// What the object says of where the restore comes from, and what it cannot say. Velero writes the backup
// it chose into a restore asked from a schedule, and the schedule of the backup into one asked from a
// backup: with both names in the object, which one was submitted is not in it. A restore that failed its
// validation with both names is one that was submitted with both, which Velero refuses, or one Velero
// refused after it wrote the second name: its validation errors say what was refused.
export function sourceNote(view: Pick<RestoreView, "backup" | "schedule" | "state">): string {
  if (view.backup && view.schedule && view.state.failure === "validation") {
    return "The object names both, and it failed its validation: what Velero refused is in its validation errors.";
  }
  if (view.backup && view.schedule) {
    return "The object names both. Velero writes the backup it chose into a restore asked from a schedule, and the schedule of a backup into a restore asked from that backup: the object does not say which of the two was submitted.";
  }
  if (view.schedule) return "The object names no backup: Velero has written none for this schedule into it.";
  if (view.backup) return "";
  return "The object names neither a backup nor a schedule: no source is known.";
}

export function countText(value: Count): string {
  return value.reported ? String(value.value) : NOT_REPORTED;
}

// What the search of the list looks into: what every column shows, and the words of the status.
export function restoreSearchFields(view: RestoreView): string[] {
  return [
    view.name,
    view.namespace,
    view.backup ?? "",
    view.schedule ?? "",
    sourceText(view),
    view.state.reported ?? "",
    view.state.label,
    lifecycleText(view.state),
    signalText(view.evidence),
    progressText(view.progress),
    timeText(view.started),
    durationText(view.duration),
    ...view.evidence.validationErrors,
  ].filter(Boolean);
}

// An order for each column. What is not reported has the lowest value of its column: it is first in the
// ascending order and last in the descending one.
export const RESTORE_SORTING = {
  name: (view: RestoreView) => view.name,
  namespace: (view: RestoreView) => view.namespace,
  source: (view: RestoreView) => sourceText(view),
  phase: (view: RestoreView) => phaseText(view.state),
  errors: (view: RestoreView) => (view.evidence.errors.reported ? view.evidence.errors.value : -1),
  progress: (view: RestoreView) => view.progress.percentage ?? -1,
  started: (view: RestoreView) => view.started ?? 0,
  duration: (view: RestoreView) => (view.duration.state === "unavailable" ? -1 : view.duration.milliseconds),
};

export const NOT_SET = "Not set";

// One fact of what a restore was asked: its value as the object carries it, and what is to be known of it.
export interface ScopeFact {
  id: string;
  name: string;
  value: string;
  note?: string;
}

function names(value: unknown): string | undefined {
  const list = Array.isArray(value) ? value.filter((entry): entry is string => named(entry) !== undefined) : [];

  return list.length ? list.join(", ") : undefined;
}

function flag(value: unknown): string | undefined {
  return typeof value === "boolean" ? (value ? "Yes" : "No") : undefined;
}

// A selector as it is written for the command line: the labels as pairs, the expressions as the key, the
// operator and the values the object carries.
export function selectorText(selector: LabelSelector | null | undefined): string | undefined {
  const pairs = Object.entries(selector?.matchLabels ?? {}).map(([key, value]) => `${key}=${value}`);
  const expressions = (Array.isArray(selector?.matchExpressions) ? selector.matchExpressions : []).map((expression) => {
    const values = names(expression?.values);

    return [named(expression?.key) ?? "(no key)", named(expression?.operator) ?? "(no operator)"]
      .concat(values ? [`(${values})`] : [])
      .join(" ");
  });
  const parts = [...pairs, ...expressions];

  return parts.length ? parts.join(", ") : undefined;
}

function referenceText(reference: TypedLocalObjectReference | null | undefined): string | undefined {
  const kind = named(reference?.kind);
  const name = named(reference?.name);

  return kind && name ? `${kind} ${name}` : name;
}

function fact(id: string, name: string, value: string | undefined, unset?: string, note?: string): ScopeFact {
  // What is not set is said not set. What the release does with a field that is not set is beside it, as
  // what the release does: it is not a value of the object.
  if (value === undefined) return { id, name, value: NOT_SET, ...(unset ? { note: unset } : {}) };
  return { id, name, value, ...(note ? { note } : {}) };
}

export const NO_DESTINATION = "(no destination)";

// The pairs of the namespaces a restore maps, from the source to where it is restored into. A pair the
// object carries is shown, whatever it holds: one without a destination is said so.
export function namespaceMappings(restore: RestoreResource): { from: string; into: string }[] {
  const mapping = restore.spec?.namespaceMapping;

  if (!mapping || typeof mapping !== "object" || Array.isArray(mapping)) return [];
  return Object.entries(mapping)
    .filter(([from]) => from !== "")
    .map(([from, into]) => ({ from, into: named(into) ?? NO_DESTINATION }))
    .sort((one, other) => one.from.localeCompare(other.from));
}

export const MAPPING_NOT_SET = "Not set: what is restored of a namespace goes into the namespace of the same name.";
export const MAPPING_OF_THE_REST =
  "What is restored of a namespace that is not mapped goes into the namespace of the same name.";

// What a restore was asked, as the object carries it. Nothing here is a default of the view.
export function restoreScope(restore: RestoreResource): ScopeFact[] {
  const spec = restore.spec ?? {};
  const alternatives = Array.isArray(spec.orLabelSelectors)
    ? spec.orLabelSelectors.map(selectorText).filter((text): text is string => text !== undefined)
    : [];
  const hooks = Array.isArray(spec.hooks?.resources) ? spec.hooks.resources : [];
  const hookNames = hooks.map((hook) => named(hook?.name)).filter((name): name is string => name !== undefined);
  const status = spec.restoreStatus;
  const uploader = spec.uploaderConfig;
  const parallel = uploader?.parallelFilesDownload;

  return [
    fact(
      "included-namespaces",
      "Included namespaces",
      names(spec.includedNamespaces),
      "The release includes every namespace of the backup.",
    ),
    fact("excluded-namespaces", "Excluded namespaces", names(spec.excludedNamespaces)),
    fact(
      "included-resources",
      "Included resources",
      names(spec.includedResources),
      "The release includes every resource of the backup.",
    ),
    fact(
      "excluded-resources",
      "Excluded resources",
      names(spec.excludedResources),
      undefined,
      "Velero adds its own entries when it takes a restore: these are not only what was submitted.",
    ),
    fact("label-selector", "Label selector", selectorText(spec.labelSelector)),
    fact(
      "alternative-selectors",
      "Alternative selectors",
      alternatives.length ? alternatives.map((text) => `(${text})`).join(" or ") : undefined,
    ),
    fact(
      "cluster-resources",
      "Cluster resources",
      flag(spec.includeClusterResources),
      "The release restores the cluster-scoped resources when the restore includes every namespace and excludes none; otherwise it skips them, but the ones a restored item brings with it.",
    ),
    fact("persistent-volumes", "Restore of persistent volumes", flag(spec.restorePVs)),
    fact("node-ports", "Node ports kept", flag(spec.preserveNodePorts)),
    fact("existing-resources", "Existing resource policy", named(spec.existingResourcePolicy)),
    fact(
      "item-operation-timeout",
      "Item operation timeout",
      named(spec.itemOperationTimeout),
      undefined,
      "Velero fills it when it takes a restore that does not set it.",
    ),
    fact(
      "restored-status",
      "Status restored of",
      status && typeof status === "object"
        ? [
            names(status.includedResources) ?? "",
            names(status.excludedResources) ? `without ${names(status.excludedResources)}` : "",
          ]
            .filter(Boolean)
            .join(", ") || "Set, and it names no resource"
        : undefined,
      "The release restores the status of the objects annotated velero.io/restore-status true, and of no other.",
      names(status?.includedResources)
        ? "An object annotated velero.io/restore-status says for itself, whatever is named here."
        : "The release takes a filter that includes none by name as one of every resource. An object annotated velero.io/restore-status says for itself.",
    ),
    fact(
      "uploader",
      "Uploader",
      uploader
        ? [
            typeof parallel === "number" ? `${parallel} files at a time` : "",
            typeof uploader.writeSparseFiles === "boolean"
              ? `sparse files ${uploader.writeSparseFiles ? "written" : "not written"}`
              : "",
          ]
            .filter(Boolean)
            .join(", ") || undefined
        : undefined,
    ),
    fact(
      "hooks",
      "Hook specifications",
      hooks.length ? `${hooks.length}${hookNames.length ? `: ${hookNames.join(", ")}` : ""}` : undefined,
      undefined,
      "What a hook does is not shown here.",
    ),
    fact("resource-modifier", "Resource modifier", referenceText(spec.resourceModifier)),
    // A field of the release after the reviewed one: shown when the object carries it, and only then.
    ...(referenceText(spec.resourcePolicy)
      ? [fact("resource-policy", "Resource policy", referenceText(spec.resourcePolicy))]
      : []),
  ];
}
