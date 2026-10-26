// What the lists, the views and the sections of the details show of an operation of the volumes: one reading of the
// object and of what it refers to, wherever it is shown, with the clock the views share for a tick.

import { timestamp } from "./duration";
import { bytesProgress } from "./progress";
import { LIFECYCLE_RANK, phaseRank, volumeOperationState } from "./volume-phases";
import { OWNER_KIND, operationNode, operationOwner, operationPod } from "./volume-references";
import { spanValue, volumeTimes } from "./volume-time";
import { POD_NOT_NAMED, uploaderText, volumePhaseText } from "./volume-words";

import type { ItemProgress } from "./progress";
import type { FamilyRead } from "./read-state";
import type { BackupResource, PodVolumeBackupResource, PodVolumeRestoreResource, RestoreResource } from "./types";
import type { VolumeKind, VolumeOperationState } from "./volume-phases";
import type { Owner, PodOf, VolumeOperation } from "./volume-references";
import type { VolumeTimes } from "./volume-time";

export interface VolumeView {
  kind: VolumeKind;
  name: string;
  namespace: string;
  uid?: string;
  state: VolumeOperationState;
  // What the release wrote beside the phase: on a failure, a cancellation, an empty volume.
  message?: string;
  owner: Owner;
  pod: PodOf;
  volume?: string;
  // The pod and the volume, as the list shows them.
  source: string;
  node?: string;
  progress: ItemProgress;
  // Of a pod volume backup alone, which carries it: the value as the object carries it.
  incremental?: { value: unknown };
  // Of a pod volume restore alone: the logical size of its snapshot, as the object carries it.
  snapshotSize?: { value: unknown };
  times: VolumeTimes;
  location?: string;
  uploader?: string;
  created?: number;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

// The reads an operation is shown with: the family of the backups for a pod volume backup, of the restores for a
// pod volume restore.
export interface VolumeReads {
  backups: FamilyRead<BackupResource>;
  restores: FamilyRead<RestoreResource>;
}

export function volumeView(kind: VolumeKind, operation: VolumeOperation, now: number, reads: VolumeReads): VolumeView {
  const state = volumeOperationState(kind, operation.status?.phase);
  const pod = operationPod(operation);
  const volume = text(operation.spec?.volume);
  const node = operationNode(kind, operation);
  const owners = kind === "PodVolumeBackup" ? reads.backups : reads.restores;
  const created = timestamp(operation.metadata.creationTimestamp);
  const message = text(operation.status?.message);
  const location = text(operation.spec?.backupStorageLocation);
  const uploader = text(operation.spec?.uploaderType);

  return {
    kind,
    name: operation.metadata.name,
    namespace: operation.metadata.namespace ?? "",
    ...(operation.metadata.uid ? { uid: operation.metadata.uid } : {}),
    state,
    ...(message ? { message } : {}),
    owner: operationOwner(operation, OWNER_KIND[kind], owners),
    pod,
    ...(volume ? { volume } : {}),
    source: sourceText(pod, volume),
    ...(node ? { node } : {}),
    progress: bytesProgress(operation.status?.progress),
    ...(kind === "PodVolumeBackup"
      ? { incremental: { value: (operation as PodVolumeBackupResource).status?.incrementalBytes } }
      : { snapshotSize: { value: (operation as PodVolumeRestoreResource).spec?.snapshotSize } }),
    times: volumeTimes(state, operation.status, now),
    ...(location ? { location } : {}),
    ...(uploader ? { uploader } : {}),
    ...(created === undefined ? {} : { created }),
  };
}

// The pod by its namespace and name, and the volume of it.
export function sourceText(pod: PodOf, volume?: string): string {
  const of = pod.name ? `${pod.namespace ? `${pod.namespace}/` : ""}${pod.name}` : POD_NOT_NAMED;

  return volume ? `${of}, ${volume}` : of;
}

// What the search of a list looks into: what the columns show, and the message of Velero.
export function volumeSearch(view: VolumeView): string[] {
  return [
    view.name,
    view.namespace,
    view.state.reported ?? "",
    volumePhaseText(view.state),
    view.message ?? "",
    view.owner.reference?.name ?? "",
    view.source,
    view.node ?? "",
    view.location ?? "",
    uploaderText(view.uploader),
  ].filter(Boolean);
}

// An order for each column. None is undefined or NaN: what has no value is last in the first order a click gives,
// and first in the second.
export const VOLUME_SORTING = {
  name: (view: VolumeView) => view.name,
  namespace: (view: VolumeView) => view.namespace,
  phase: (view: VolumeView) => [LIFECYCLE_RANK[view.state.lifecycle], phaseRank(view.state), view.state.reported ?? ""],
  operation: (view: VolumeView) => view.owner.reference?.name ?? "",
  volume: (view: VolumeView) => view.source,
  node: (view: VolumeView) => (view.node === undefined ? [1, ""] : [0, view.node]),
  bytes: (view: VolumeView) => [view.progress.percentage ?? -1, view.progress.done ?? -1],
  started: (view: VolumeView) => (view.times.started === undefined ? [1, 0] : [0, view.times.started]),
  duration: (view: VolumeView) => spanValue(view.times.span),
  storage: (view: VolumeView) => view.location ?? "",
  uploader: (view: VolumeView) => uploaderText(view.uploader),
  age: (view: VolumeView) => -(view.created ?? 0),
};

// The fields of the schemas of the reviewed release, which the views read. A field another release writes is shown
// by its name, and nothing is said of what it holds.
const KNOWN: Record<VolumeKind, { spec: string[]; status: string[] }> = {
  PodVolumeBackup: {
    spec: [
      "node",
      "pod",
      "volume",
      "backupStorageLocation",
      "repoIdentifier",
      "uploaderType",
      "tags",
      "uploaderSettings",
      "cancel",
    ],
    status: [
      "phase",
      "path",
      "snapshotID",
      "message",
      "startTimestamp",
      "completionTimestamp",
      "progress",
      "incrementalBytes",
      "acceptedTimestamp",
    ],
  },
  PodVolumeRestore: {
    spec: [
      "pod",
      "volume",
      "backupStorageLocation",
      "repoIdentifier",
      "uploaderType",
      "snapshotID",
      "snapshotSize",
      "sourceNamespace",
      "uploaderSettings",
      "cancel",
    ],
    status: ["phase", "message", "startTimestamp", "completionTimestamp", "progress", "acceptedTimestamp", "node"],
  },
};

export function unknownFields(kind: VolumeKind, operation: VolumeOperation): string[] {
  const of = (part: "spec" | "status") => {
    const value = operation[part];

    return value && typeof value === "object"
      ? Object.keys(value)
          .filter((key) => !KNOWN[kind][part].includes(key))
          .map((key) => `${part}.${key}`)
      : [];
  };

  return [...of("spec"), ...of("status")].sort();
}

// The keys of a map of the object, as the views list them: by their characters.
export function mapEntries(value: unknown): { key: string; value: string }[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  return Object.entries(value)
    .map(([key, entry]) => ({ key, value: typeof entry === "string" ? entry : JSON.stringify(entry) }))
    .sort((one, other) => (one.key < other.key ? -1 : one.key > other.key ? 1 : 0));
}
