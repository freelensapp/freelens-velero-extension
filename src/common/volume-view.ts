// What the lists, the views and the sections of the details show of an operation of the volumes: one reading of the
// object and of what it refers to, wherever it is shown, with the clock the views share for a tick.

import { timestamp } from "./duration";
import { timeText } from "./operation-text";
import { bytesProgress } from "./progress";
import {
  builtInMover,
  dataMovement,
  LIFECYCLE_RANK,
  phaseRank,
  volumeOperationState,
  writtenType,
} from "./volume-phases";
import {
  acceptedBy,
  OWNER_KIND,
  operationClaim,
  operationNode,
  operationOwner,
  operationPod,
} from "./volume-references";
import { spanValue, volumeTimes } from "./volume-time";
import {
  bytesText,
  CLAIM_NOT_NAMED,
  moverText,
  POD_NOT_NAMED,
  spanText,
  uploaderText,
  VOLUME_WORDS,
  volumePhaseText,
} from "./volume-words";

import type { ItemProgress } from "./progress";
import type { FamilyRead } from "./read-state";
import type {
  BackupResource,
  DataDownloadResource,
  DataUploadResource,
  PodVolumeBackupResource,
  PodVolumeRestoreResource,
  RestoreResource,
} from "./types";
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
  // What the list shows of the volume: the pod and the volume of a pod volume operation, the source claim of a data
  // upload, the target claim of a data download.
  source: string;
  node?: string;
  // The node whose node agent accepted a data movement, when it is not its node.
  acceptedBy?: string;
  progress: ItemProgress;
  // Of a pod volume backup and of a data upload, which carry it: the value as the object carries it.
  incremental?: { value: unknown };
  // Of a pod volume restore and of a data download: the logical size of its snapshot, as the object carries it.
  snapshotSize?: { value: unknown };
  times: VolumeTimes;
  location?: string;
  // The uploader of a pod volume operation, or the data mover of a data movement, as the object carries it.
  uploader?: string;
  // What the list says of the uploader or of the data mover, and whether the reviewed release writes it.
  mover: { text: string; known: boolean };
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

// The uploader of a pod volume operation, or the data mover of a data movement.
function moverOf(kind: VolumeKind, operation: VolumeOperation): string | undefined {
  return dataMovement(kind)
    ? text((operation as DataUploadResource | DataDownloadResource).spec?.datamover)
    : text((operation as PodVolumeBackupResource | PodVolumeRestoreResource).spec?.uploaderType);
}

// The claim of a data movement by its namespace and its name: the source claim of a data upload, in the namespace it
// was backed up from; the target claim of a data download, in the namespace it is restored into.
export function claimSource(kind: "DataUpload" | "DataDownload", operation: VolumeOperation): string {
  const claim = operationClaim(kind, operation).name;
  const namespace =
    kind === "DataUpload"
      ? text((operation as DataUploadResource).spec?.sourceNamespace)
      : text((operation as DataDownloadResource).spec?.targetVolume?.namespace);

  return claim ? `${namespace ? `${namespace}/` : ""}${claim}` : CLAIM_NOT_NAMED;
}

export function volumeView(kind: VolumeKind, operation: VolumeOperation, now: number, reads: VolumeReads): VolumeView {
  const state = volumeOperationState(kind, operation.status?.phase);
  const pod = operationPod(operation);
  const volume = dataMovement(kind) ? undefined : text((operation as PodVolumeBackupResource).spec?.volume);
  const node = operationNode(kind, operation);
  const accepted = acceptedBy(kind, operation);
  const owners = OWNER_KIND[kind] === "Backup" ? reads.backups : reads.restores;
  const created = timestamp(operation.metadata.creationTimestamp);
  const message = text(operation.status?.message);
  const location = text(operation.spec?.backupStorageLocation);
  const uploader = moverOf(kind, operation);
  const backs = kind === "PodVolumeBackup" || kind === "DataUpload";

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
    source: dataMovement(kind) ? claimSource(kind, operation) : sourceText(pod, volume),
    ...(node ? { node } : {}),
    ...(accepted ? { acceptedBy: accepted } : {}),
    progress: bytesProgress(operation.status?.progress),
    ...(backs
      ? { incremental: { value: (operation as PodVolumeBackupResource | DataUploadResource).status?.incrementalBytes } }
      : { snapshotSize: { value: (operation as PodVolumeRestoreResource | DataDownloadResource).spec?.snapshotSize } }),
    times: volumeTimes(state, operation.status, now),
    ...(location ? { location } : {}),
    ...(uploader ? { uploader } : {}),
    mover: dataMovement(kind)
      ? { text: moverText(uploader), known: builtInMover(uploader) }
      : { text: uploaderText(uploader), known: writtenType(uploader) },
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
    bytesText(view.progress),
    view.times.started === undefined ? VOLUME_WORDS.notStarted : timeText(view.times.started),
    spanText(view.times.span),
    view.location ?? "",
    view.mover.text,
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
  uploader: (view: VolumeView) => view.mover.text,
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
  DataUpload: {
    spec: [
      "snapshotType",
      "csiSnapshot",
      "sourcePVC",
      "datamover",
      "backupStorageLocation",
      "sourceNamespace",
      "dataMoverConfig",
      "cancel",
      "operationTimeout",
    ],
    status: [
      "phase",
      "path",
      "snapshotID",
      "dataMoverResult",
      "message",
      "startTimestamp",
      "completionTimestamp",
      "progress",
      "incrementalBytes",
      "node",
      "nodeOS",
      "acceptedByNode",
      "acceptedTimestamp",
    ],
  },
  DataDownload: {
    spec: [
      "targetVolume",
      "backupStorageLocation",
      "datamover",
      "snapshotID",
      "sourceNamespace",
      "dataMoverConfig",
      "cancel",
      "operationTimeout",
      "nodeOS",
      "snapshotSize",
    ],
    status: [
      "phase",
      "message",
      "startTimestamp",
      "completionTimestamp",
      "progress",
      "node",
      "acceptedByNode",
      "acceptedTimestamp",
    ],
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
