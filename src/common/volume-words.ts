// The words the views say of the backup repositories and of the operations of the volumes, and of the states of a
// family on each surface that shows one, written once: every view and every test reads them from here.

import { sizeText } from "./artifact-volumes";
import { formatDuration } from "./duration";

import type { OperationKind, OperationState } from "./phases";
import type { ItemProgress } from "./progress";
import type { VolumeKind, VolumeOperationState } from "./volume-phases";
import type { VolumeSpan } from "./volume-time";

// What a list says when it has nothing to show: what it holds no count of, and why.
export const LIST_WORDS = {
  notCounted: "Not read yet",
  empty: (noun: string, namespace: string, cluster: string) =>
    `No ${noun} is in the namespace ${namespace} of ${cluster}.`,
  notShown: (plural: string, namespace: string) => `The ${plural} of ${namespace} are not shown`,
  denied: (plural: string) => `Access to the ${plural} of this namespace is denied. How many there are is not known.`,
  "not-served": (plural: string) => `This cluster does not serve the ${plural} of Velero.`,
  failed: (plural: string) => `The ${plural} of this namespace could not be read. How many there are is not known.`,
};

// What a view of one object says when the object is not among the ones that were read.
export const WORKSPACE_WORDS = {
  missing: (noun: string, namespace: string) =>
    `No ${noun} of this name is in ${namespace}. It may have been deleted, or it is of another installation.`,
  denied: (plural: string, namespace: string) => `Access to the ${plural} of ${namespace} is denied`,
  "not-served": (plural: string) => `This cluster does not serve the ${plural} of Velero`,
  failed: (plural: string, namespace: string) => `The ${plural} of ${namespace} could not be read`,
  unknownAfter: ", so this one cannot be shown. It is not known to be absent.",
  stale: (plural: string) => `The ${plural} could not be read again: this is what was read at`,
};

// What a reference says of its target, when it is not a way to it.
export const REFERENCE_WORDS = {
  absent: (noun: string, namespace: string) => `No ${noun} of this name in ${namespace}`,
  stale: (plural: string) => `Read before the ${plural} stopped answering`,
  denied: (plural: string) => `The ${plural} of this installation cannot be read: access is denied`,
  "not-served": (plural: string) => `The cluster does not serve the ${plural}`,
  failed: (plural: string) => `The ${plural} of this installation could not be read`,
  "not-read": (plural: string) => `The ${plural} of this installation were not read yet`,
};

// The phase as the operator reads it: the label, and the text of the object when it is not one the release writes.
export function volumePhaseText(state: VolumeOperationState): string {
  return state.recognized ? state.label : `${state.label}: ${state.reported}`;
}

const LIFECYCLES: Record<VolumeOperationState["lifecycle"], string> = {
  "in-flight": "In flight",
  terminal: "Finished",
  unknown: "Unknown",
};
const EXECUTIONS: Record<VolumeOperationState["execution"], string> = {
  "not-started": "not started",
  running: "running",
  ran: "ran",
  "ran-or-not-started": "ran or not started, as its times say",
  unknown: "not known",
};
const OUTCOMES: Record<VolumeOperationState["outcome"], string> = {
  none: "no outcome yet",
  completed: "completed",
  failed: "failed",
  cancelled: "canceled, which is neither a success nor a failure",
  unknown: "outcome not known",
};

// The two axes of the phase and its outcome, in words: where the operation is, whether its data path ran, and how
// it ended.
export function axesText(state: VolumeOperationState): string {
  return [
    LIFECYCLES[state.lifecycle],
    EXECUTIONS[state.execution],
    state.cancelAsked ? "cancellation asked" : OUTCOMES[state.outcome],
  ].join(", ");
}

// What waits for what, when an operation has not started: the release needs a node agent where the volume is, which
// the extension does not read.
export const NODE_AGENT_WORDS: Record<VolumeKind, string> = {
  PodVolumeBackup:
    "It waits for the node agent of the node of its pod to accept it. Whether one runs there is not read by the extension, and waiting is not a failure.",
  PodVolumeRestore:
    "It waits for the node agent of the node of the restored pod, which takes it when the init container restore-wait of that pod runs. Whether one runs there is not read by the extension, and waiting is not a failure.",
};

// What the view says of each phase (SPEC-0014, the phases), beside the times and the bytes.
export function phaseSentence(state: VolumeOperationState): string {
  if (!state.recognized)
    return "The release does not write this phase: it is shown as written, and what it means is not known.";
  switch (state.reported) {
    case undefined:
    case "New":
      return NODE_AGENT_WORDS[state.kind];
    case "Accepted":
      return "A node agent accepted it, and a pod is being made to reach the volume. The node agent fails it after its preparing timeout, a setting of the installation the extension does not read.";
    case "Prepared":
      return "The pod that reaches the volume runs on the node: the node agent of that node is about to start the data path.";
    case "InProgress":
      return "The data path is moving the bytes of the volume.";
    case "Canceling":
      return "The cancellation was asked: the data path is being stopped.";
    case "Completed":
      return "The data path ended.";
    case "Failed":
      return "The operation failed: the message says why. A start equal to the completion is one the failure wrote; no time at all is one the preparing timeout wrote.";
    default:
      return "The operation was canceled: neither a success nor a failure. The release cancels one when its backup or restore times out, when the server or the node agent restarts, or when its pod cannot run.";
  }
}

// What is said of how long an operation took, or has been taking, by the clock of this machine.
export function spanText(span: VolumeSpan): string {
  switch (span.state) {
    case "waiting":
      return `Waiting ${formatDuration(span.milliseconds)}`;
    case "elapsed":
      return `${formatDuration(span.milliseconds)} so far`;
    case "duration":
      return formatDuration(span.milliseconds);
    case "instant":
      return "No duration: the start is the completion";
    case "no-start":
      return "No duration: no start was written";
    case "no-time":
      return "No time written";
    case "not-started":
      return VOLUME_WORDS.notStarted;
    default:
      return SPAN_GAPS[span.reason];
  }
}

const SPAN_GAPS: Record<Extract<VolumeSpan, { state: "unavailable" }>["reason"], string> = {
  "no-accepted": "Accepted time not reported",
  "no-start": "Start not reported",
  "no-end": "Completion not reported",
  unreadable: "Time not readable",
  reversed: "Completion before start",
  future: "Time in the future",
};

// What is said beside the times, of what they mean for this phase.
export function spanNote(state: VolumeOperationState, span: VolumeSpan): string | undefined {
  switch (span.state) {
    case "waiting":
      return state.reported === "Accepted"
        ? "Since a node agent accepted it. The node agent fails it after its preparing timeout, which the view does not read."
        : "Since a node agent accepted it. The node agent of its node is about to start the data path.";
    case "instant":
      return "The start is the completion: a time the failure or the cancellation wrote, not a duration of the work.";
    case "no-start":
      return "It ended before its data path began: no start was written.";
    case "no-time":
      return "The release wrote no time for it, as for one its preparing timeout failed.";
    case "not-started":
      return "It has no time but its creation.";
    default:
      return undefined;
  }
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

function carried(value: unknown): string {
  if (value === undefined || value === null) return "nothing";
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}

export const NOT_REPORTED = "Not reported";

// A pod an operation does not name.
export const POD_NOT_NAMED = "Pod not named";

// The bytes of an operation as the release writes them: done of total, with the percentage only when it can be
// given. A progress the object does not carry is not reported, and is not zero.
export function bytesText(progress: ItemProgress): string {
  if (progress.state === "measured") {
    return `${sizeText(progress.done ?? 0)} of ${sizeText(progress.total ?? 0)} (${progress.percentage}%)`;
  }
  switch (progress.reason) {
    case "not-reported":
      return NOT_REPORTED;
    case "no-total":
      return progress.done ? `${sizeText(progress.done)} done, no total` : "No total reported";
    case "over-total":
      return `${sizeText(progress.done ?? 0)} of ${sizeText(progress.total ?? 0)}, over the total`;
    default:
      return `Reported ${carried(progress.reported.done)} of ${carried(progress.reported.total)} bytes`;
  }
}

// The bytes in full, as they are counted: what is read by who points at them.
export function bytesTip(progress: ItemProgress): string | undefined {
  if (progress.done === undefined || progress.total === undefined) return undefined;
  return `${plural(progress.done, "byte")} of ${plural(progress.total, "byte")}`;
}

export const BYTES_NOTE =
  "The bytes are what the data path reports, of a total it estimates. Nothing is said of what was not moved.";

// The incremental bytes of a pod volume backup: the release writes no zero into them.
export function incrementalText(value: unknown): string {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) return sizeText(value);
  return value === undefined || value === null ? NOT_REPORTED : `Reported ${carried(value)}`;
}

export const INCREMENTAL_NOTE =
  "The release writes no incremental size of zero: one that is not written is not reported.";

export const SNAPSHOT_SIZE_NOTE = "The logical size of the snapshot, taken from the pod volume backup it restores.";

// The uploader of a pod volume operation: what it names, or that it names none, which the release reads as restic.
// Built-in is the data mover of the data movement, not an uploader.
export function uploaderText(value: string | undefined): string {
  return value ?? "Not set";
}

export const UPLOADER_NOT_SET_NOTE = "The release reads an uploader that is not set as restic.";

// What the mark of a value the reviewed release does not write says: beside the value as it is written, to who does
// not see the mark and in the tip of a cell, and in the note of a view.
export const NOT_WRITTEN = {
  mark: "a value the reviewed release does not write",
  note: "The reviewed release does not write this value: it is shown as written, and what it means is not known.",
};

// What a list of the operations says over itself, which no row says.
export const LIST_NOTES: Record<VolumeKind, string> = {
  PodVolumeBackup: "These are the pod volume backups the installation holds now: they go with their backups.",
  PodVolumeRestore: "These are the pod volume restores the installation holds now: they go with their restores.",
};

// The words of a backup repository.
export const REPOSITORY_WORDS = {
  notSet: "Not set",
  neverMaintained: "Never maintained",
  newestFailed: "the newest maintenance failed",
  // The tip of the mark of a newest maintenance that failed, which is read alone: a sentence, not the words that
  // follow the time for who does not see the mark.
  newestFailedTip: "The newest maintenance failed",
  // A repository is not a verdict on the backups it holds.
  what: "A repository is created by the first backup or restore of a namespace to a storage location, and is shared by the ones after it. Its readiness says whether Velero can use it, and nothing of the backups it holds.",
  pass: "The server looks at every repository every five minutes: a maintenance that is due starts at its next look.",
  job: "A maintenance runs as a Job of the installation, which the extension does not read.",
  readOnly: "The storage location is read-only: the server runs no maintenance of a repository of it.",
  accessUnknown:
    "Not known: the storage location of the repository is not known, and the server runs no maintenance of a repository of a read-only one.",
  locationsBeingRead:
    "Not known yet: the storage locations of the installation are being read, and the server runs no maintenance of a repository of a read-only one.",
  frequencyNotSet:
    "No frequency is set: the server fills it with its own, or with the one of the type, at its next look. Nothing is computed until it does.",
  frequencyUnreadable: (written: string) =>
    `The frequency ${written} is not a duration: when the next maintenance is due is not computed.`,
  notReadyNoMaintenance: "A repository that is not ready is not maintained.",
  dueNoTime: "Due now: the repository is ready and has no time of a last maintenance.",
  due: (late: string) =>
    `Due: the last maintenance is older than the frequency, by ${late}, by the clock of this machine.`,
  notDue: (left: string) => `Due in ${left}, by the clock of this machine.`,
  noMaintenance: "No maintenance is recorded.",
  noConfig: "The repository carries no configuration.",
  noDuration: "Not known",
  // The note of the last maintenance when the newest one failed, whole: it is not composed of other words.
  newestFailedNote: "The newest maintenance failed: this is the last that succeeded.",
};

// How long ago a time was, by the clock of this machine.
export function agoText(milliseconds: number): string {
  return milliseconds < 0 ? "In the future" : `${formatDuration(milliseconds)} ago`;
}

// The words of the view of an operation.
export const VOLUME_WORDS = {
  none: "None",
  notStarted: "Not started",
  noOwner: (noun: string) => `The operation names no ${noun}: neither its labels nor an owner reference do`,
  repositoryNote:
    "Found by the three labels the release names a repository with: the namespace of the volume, the storage location and the type of the uploader.",
  hostResolves:
    "The details of the host read the pod when they open: the extension does not read it, and does not say whether it is there.",
  nodeNote: {
    PodVolumeBackup:
      "The node of the pod, from the spec: the release writes no node into the status of a pod volume backup.",
    PodVolumeRestore: "The node whose node agent accepted it, from the status.",
  } satisfies Record<VolumeKind, string>,
  noClaim: "No claim named",
  cancelNote: "A cancellation is asked by a write, which the views do not make.",
  cancelAsked: "Asked",
  cancelNotAsked: "Not asked",
  readOfTheViews: (plural: string, ago: string, closed: boolean) =>
    `Found among the ${plural} of the installation as they were read ${ago}${closed ? ", when a view of Velero was last open" : ""}.`,
  otherInstallation: (plural: string) =>
    `The views read the ${plural} of another installation: whether this one is there is not known here.`,
  unknownFields: (names: string[]) =>
    `The object carries fields the reviewed release does not write, which are not read: ${names.join(", ")}.`,
};

// What the band of the volume operations of a backup or of a restore says of one kind of them, by the state of the
// read of its family (SPEC-0014, what is not known): what was not read is not known, and is not none.
export const BAND_WORDS = {
  title: "Volumes",
  loading: (plural: string) => `The ${plural} of the installation are being read.`,
  none: (owner: string, noun: string) => `This ${owner} has no ${noun} among the ones the installation holds.`,
  denied: (plural: string, owner: string) =>
    `The ${plural} of this installation cannot be read: access is denied. How many this ${owner} has is not known.`,
  "not-served": (plural: string) => `The cluster does not serve the ${plural} of Velero.`,
  failed: (plural: string, owner: string) =>
    `The ${plural} of this installation could not be read. How many this ${owner} has is not known.`,
  "not-read": (plural: string, owner: string) =>
    `The ${plural} of this installation were not read yet: how many this ${owner} has is not known.`,
  stale: (plural: string, at: string) => `The ${plural} could not be read again: these are the ones read at ${at}.`,
  count: (count: number, noun: string, plural: string) => `${count} ${count === 1 ? noun : plural}, from the newest`,
  groups: (plural: string) => `The ${plural} by phase`,
  more: "Show ten more",
  way: (noun: string, name: string) => `Open the ${noun} ${name}`,
  // The name of the way of a row: its volume first, which is what the column shows, then the operation it opens.
  rowWay: (volume: string, noun: string, name: string) => `${volume}: ${BAND_WORDS.way(noun, name)}`,
};

type BandSentence = "waiting" | "validation" | "running" | "plugins" | "finalizing" | "ended" | "unknown";

// A restore has no sentence of its deletion: the release writes no phase Deleting for a restore, and one that reports
// it reports a phase the release does not write.
const BAND_SENTENCES: { Backup: Record<BandSentence | "deleting", string>; Restore: Record<BandSentence, string> } = {
  Backup: {
    waiting: "The pod volume backups of a backup are made while it is InProgress: this one has not started.",
    validation:
      "The pod volume backups of a backup are made while it is InProgress: this one failed its validation, and did not run.",
    running:
      "The pod volume backups run while the backup is InProgress: it waits for all of them, and at its own timeout asks the ones that have not ended to cancel.",
    plugins:
      "The pod volume backups ran while the backup was InProgress. It waits for its plugin operations, which is when its data uploads run.",
    finalizing: "The pod volume backups ran while the backup was InProgress.",
    ended:
      "The pod volume backups the installation holds of this backup are the ones its run made, or the ones a sync from the store made, in the phase they were stored in.",
    deleting: "The backup is being deleted: its pod volume backups go with it.",
    unknown:
      "The backup reports a phase the release does not write: what the release does with its pod volume backups is not known.",
  },
  Restore: {
    waiting: "The pod volume restores of a restore are made while it is InProgress: this one has not started.",
    validation:
      "The pod volume restores of a restore are made while it is InProgress: this one failed its validation, and did not run.",
    running:
      "The node agent of the node of each restored pod takes its pod volume restore when the init container restore-wait of that pod runs.",
    plugins: "The restore waits for its plugin operations, which is when its data downloads run.",
    finalizing: "The pod volume restores the installation holds of this restore are the ones its run made.",
    ended: "The pod volume restores the installation holds of this restore are the ones its run made.",
    unknown:
      "The restore reports a phase the release does not write: what the release does with its pod volume restores is not known.",
  },
};

// What the release does with the pod volume operations of a backup or a restore, by the phase of the backup or the
// restore (SPEC-0014, what the release does). One that reports no phase is taken by the release as a new one.
export function bandSentence(kind: OperationKind, state: OperationState): string {
  const sentences: Record<BandSentence, string> & { deleting?: string } = BAND_SENTENCES[kind];

  if (state.reported === undefined) return sentences.waiting;
  if (!state.recognized) return sentences.unknown;
  if (state.lifecycle === "deleting" && sentences.deleting) return sentences.deleting;
  if (state.failure === "validation") return sentences.validation;
  if (state.execution === "not-started") return sentences.waiting;
  if (state.reported === "InProgress") return sentences.running;
  if (state.reported?.startsWith("WaitingForPluginOperations")) return sentences.plugins;
  if (state.reported?.startsWith("Finalizing")) return sentences.finalizing;
  return state.lifecycle === "terminal" ? sentences.ended : sentences.unknown;
}

// What the view of a repository says of what used it (SPEC-0014, REQ-187): the kinds it could read are counted, and
// the ones it could not are named. It reads the pod volume operations alone until the data movement is read, and
// says nothing of what it does not read.
export const USED_BY_WORDS = {
  title: "Used by",
  nothing: "No pod volume operation of the installation used it.",
  none: (plural: string) => `None of the ${plural} of the installation names it.`,
  loading: (plural: string) => `The ${plural} of the installation are being read.`,
  denied: (plural: string) =>
    `The ${plural} of this installation cannot be read: access is denied. What used it among them is not known.`,
  "not-served": (plural: string) =>
    `The cluster does not serve the ${plural} of Velero: what used it among them is not known.`,
  failed: (plural: string) =>
    `The ${plural} of this installation could not be read. What used it among them is not known.`,
  "not-read": (plural: string) =>
    `The ${plural} of this installation were not read yet: what used it among them is not known.`,
  count: (count: number, noun: string, plural: string) => `${count} ${count === 1 ? noun : plural}`,
  newest: "The newest",
  owners: (plural: string) => `Of the ${plural}`,
};

// The way from a row of the Volumes tab to the operation of the installation it was made by (REQ-188).
export const TAB_WAY_WORDS = {
  title: "Operation",
  open: (noun: string, name: string) => `Open the ${noun} ${name}`,
};
