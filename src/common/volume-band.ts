// The band of the volume operations of a backup and of a restore, what used a repository, and the ways of the rows
// of the Volumes tab (SPEC-0014, REQ-187 and REQ-188): each found in the index of the operations of the
// installation, never by a search of the items, and never by a name.

import { resolveReference } from "./references";
import { LABELS } from "./types";
import { ownerKey, READ_OF, repositoryKey, snapshotKey } from "./volume-index";
import { volumeOperationState } from "./volume-phases";
import { OWNER_KIND, operationOwner } from "./volume-references";
import { bandSentence, volumePhaseText } from "./volume-words";

import type { OperationKind, OperationState } from "./phases";
import type { FamilyRead } from "./read-state";
import type { Reference } from "./references";
import type {
  BackupRepositoryResource,
  BackupResource,
  DataDownloadResource,
  ObjectMetadata,
  RestoreResource,
} from "./types";
import type { ViewKind, ViewTarget } from "./views";
import type { VolumeIndex } from "./volume-index";
import type { VolumeKind, VolumeOperationState } from "./volume-phases";
import type { VolumeOperation } from "./volume-references";

// The groups of the phases in the order `backup describe` prints them for a backup and `restore describe` for a
// restore (SPEC-0014, what the release does): none and New together, and no Canceling for a restore.
const GROUPS: Record<OperationKind, readonly string[]> = {
  Backup: ["Completed", "Failed", "Canceled", "InProgress", "Canceling", "Prepared", "Accepted", "New"],
  Restore: ["Completed", "Canceled", "Failed", "InProgress", "Prepared", "Accepted", "New"],
};

export interface PhaseGroup {
  // The phase as the release writes it, New for an operation with none, or the text of one it does not write.
  phase: string;
  // The state of the phase, for its mark and its label.
  state: VolumeOperationState;
  label: string;
  count: number;
}

// The phase an operation is counted under: one with no phase is counted with New, as `backup describe` counts it.
function groupOf(operation: VolumeOperation): string {
  const phase = operation.status?.phase as unknown;

  if (phase === undefined || phase === null || phase === "") return "New";
  return typeof phase === "string" ? phase : JSON.stringify(phase);
}

// The operations counted by phase in the groups of the release, then each phase the groups do not name, in a group
// of its own after them with its label and its mark: no operation is left out of the counts.
export function phaseGroups(
  kind: VolumeKind,
  order: OperationKind,
  operations: readonly VolumeOperation[],
): PhaseGroup[] {
  const counts = new Map<string, number>();

  for (const operation of operations) {
    const phase = groupOf(operation);

    counts.set(phase, (counts.get(phase) ?? 0) + 1);
  }
  const named = GROUPS[order].filter((phase) => counts.has(phase));
  const others = [...counts.keys()].filter((phase) => !GROUPS[order].includes(phase)).sort();

  return [...named, ...others].map((phase) => {
    const state = volumeOperationState(kind, phase);

    return { phase, state, label: volumePhaseText(state), count: counts.get(phase) ?? 0 };
  });
}

// One kind of the operations of a backup, of a restore or of a repository: what was read of its family, its
// operations from the newest, and their counts by phase.
export interface VolumeHalf {
  kind: VolumeKind;
  // The read of the family, whose status and time say what is known of it.
  read: FamilyRead<unknown>;
  operations: readonly VolumeOperation[];
  groups: PhaseGroup[];
}

export interface VolumeBand {
  // The operations of the owner, one half for each kind: the pod volume operations first, then the data movement.
  halves: VolumeHalf[];
  // What the release does with the operations of the owner, by the phase of the backup or the restore.
  sentence: string;
}

const NONE: readonly VolumeOperation[] = [];

function half(
  kind: VolumeKind,
  order: OperationKind,
  read: FamilyRead<unknown>,
  operations: readonly VolumeOperation[] | undefined,
): VolumeHalf {
  const found = operations ?? NONE;

  return { kind, read, operations: found, groups: phaseGroups(kind, order, found) };
}

// The map of the operations of each kind by their owner.
const OWNED: Record<VolumeKind, "ofBackup" | "ofRestore" | "ofUpload" | "ofDownload"> = {
  PodVolumeBackup: "ofBackup",
  PodVolumeRestore: "ofRestore",
  DataUpload: "ofUpload",
  DataDownload: "ofDownload",
};

function ownedBy(index: VolumeIndex, kind: VolumeKind, metadata: ObjectMetadata): readonly VolumeOperation[] {
  if (!metadata.uid) return NONE;
  return (
    (index[OWNED[kind]] as ReadonlyMap<string, VolumeOperation[]>).get(
      ownerKey(metadata.namespace ?? "", metadata.uid),
    ) ?? NONE
  );
}

// The kinds of the operations of a backup and of a restore, in the order of the halves of the band.
export const BAND_KINDS: Record<OperationKind, readonly VolumeKind[]> = {
  Backup: ["PodVolumeBackup", "DataUpload"],
  Restore: ["PodVolumeRestore", "DataDownload"],
};

function band(
  index: VolumeIndex,
  order: OperationKind,
  owner: BackupResource | RestoreResource,
  state: OperationState,
): VolumeBand {
  return {
    halves: BAND_KINDS[order].map((kind) =>
      half(kind, order, index.reads[READ_OF[kind]] as FamilyRead<unknown>, ownedBy(index, kind, owner.metadata)),
    ),
    sentence: bandSentence(order, state),
  };
}

// The band of a backup: its pod volume backups and its data uploads, found by the label of its UID in its namespace
// (REQ-187).
export function backupBand(index: VolumeIndex, backup: BackupResource, state: OperationState): VolumeBand {
  return band(index, "Backup", backup, state);
}

// The band of a restore: its pod volume restores and its data downloads, the same way.
export function restoreBand(index: VolumeIndex, restore: RestoreResource, state: OperationState): VolumeBand {
  return band(index, "Restore", restore, state);
}

// How many rows a band shows at first, and how many more at each command of it.
export const PAGE = 10;

// What used a repository, for one kind: the operations of that kind whose volume namespace, location and type name
// it, counted by phase, the newest of them, and the backups or the restores they belong to, from the newest.
export interface RepositoryUse extends VolumeHalf {
  owners: Reference[];
}

export interface OwnerReads {
  backups: FamilyRead<BackupResource>;
  restores: FamilyRead<RestoreResource>;
}

// The owners of the operations, once each, from the one of the newest operation: resolved as the view of an
// operation resolves its owner, by the labels and the owner reference.
function ownersOf(kind: VolumeKind, operations: readonly VolumeOperation[], reads: OwnerReads): Reference[] {
  const owners = new Map<string, Reference>();
  const read = OWNER_KIND[kind] === "Backup" ? reads.backups : reads.restores;

  for (const operation of operations) {
    const owner = operationOwner(operation, OWNER_KIND[kind], read).reference;

    if (owner && !owners.has(owner.name)) owners.set(owner.name, owner);
  }
  return [...owners.values()];
}

// What used a repository, one entry for each kind of the operations (REQ-187): found by the three labels of the
// repository, through the cut of a long name, never by its name.
export function repositoryUses(
  index: VolumeIndex,
  repository: BackupRepositoryResource,
  reads: OwnerReads,
): RepositoryUse[] {
  const key = repositoryKey(repository);
  const found = key ? (index.usedBy.get(key) ?? []) : [];

  return (["PodVolumeBackup", "PodVolumeRestore", "DataUpload", "DataDownload"] as const).map((kind) => {
    const operations = found.filter((entry) => entry.kind === kind).map((entry) => entry.operation);

    return {
      ...half(kind, OWNER_KIND[kind], index.reads[READ_OF[kind]] as FamilyRead<unknown>, operations),
      owners: ownersOf(kind, operations, reads),
    };
  });
}

// The kind of the view of an operation of each kind.
export const OPERATION_VIEW: Record<VolumeKind, ViewKind> = {
  PodVolumeBackup: "pod-volume-backup",
  PodVolumeRestore: "pod-volume-restore",
  DataUpload: "data-upload",
  DataDownload: "data-download",
};

// The way of each row of the Volumes tab of a backup or a restore (REQ-188): by the namespace of its pod, its pod and
// its volume, among the pod volume operations of that owner; by its operation ID, among the data uploads or the data
// downloads of that owner, whose label carries it. The newest when more than one names the same. A row that no
// operation matches has none, and none has one while its family is denied, as the table of the states says. A read
// that failed, or of a kind no longer served, keeps the ways of the read before, as the band keeps its rows
// (REQ-191): the notice over the view says that the family is of an earlier read, and when.
export type VolumeWays = ReadonlyMap<string, ViewTarget>;

export function rowKey(podNamespace: string, pod: string, volume: string): string {
  return `${podNamespace}\u0000${pod}\u0000${volume}`;
}

// The key of a row of a moved volume, by the operation ID it carries: never the key of a pod volume, which has three
// parts.
export function movedKey(operationId: string): string {
  return `\u0001${operationId}`;
}

export function volumeWays(
  index: VolumeIndex,
  kind: OperationKind,
  owner: { namespace?: string; uid?: string },
): VolumeWays {
  const ways = new Map<string, ViewTarget>();
  const [pods, moved] = BAND_KINDS[kind];
  const of = { name: "", namespace: owner.namespace, uid: owner.uid };

  if (index.reads[READ_OF[pods]].status !== "forbidden") {
    for (const operation of ownedBy(index, pods, of)) {
      const pod = (operation as { spec?: { pod?: { namespace?: string; name?: string } | null } }).spec?.pod;
      const volume = (operation as { spec?: { volume?: string } }).spec?.volume;

      if (!pod?.namespace || !pod.name || !volume) continue;
      const key = rowKey(pod.namespace, pod.name, volume);

      if (!ways.has(key)) ways.set(key, { kind: OPERATION_VIEW[pods], name: operation.metadata.name });
    }
  }
  if (index.reads[READ_OF[moved]].status !== "forbidden") {
    for (const operation of ownedBy(index, moved, of)) {
      const id = operation.metadata.labels?.[LABELS.asyncOperationId];

      if (typeof id !== "string" || !id) continue;
      const key = movedKey(id);

      if (!ways.has(key)) ways.set(key, { kind: OPERATION_VIEW[moved], name: operation.metadata.name });
    }
  }
  return ways;
}

// The data upload whose snapshot a data download restores, among the ones of its installation (REQ-186): found in the
// index by the snapshot, the newest when more than one names it. Nothing when none does, or when the data uploads were
// not read: the data upload goes with its backup, and its absence says nothing of the data download.
export function uploadOf(index: VolumeIndex, download: DataDownloadResource): Reference | undefined {
  const snapshot = download.spec?.snapshotID;

  if (typeof snapshot !== "string" || !snapshot) return undefined;
  const namespace = download.metadata.namespace ?? "";
  const found = index.bySnapshot.get(snapshotKey(namespace, snapshot))?.[0];

  if (!found) return undefined;
  return resolveReference("DataUpload", found.metadata.name, namespace, { ...index.reads.dataUploads, items: [found] });
}
