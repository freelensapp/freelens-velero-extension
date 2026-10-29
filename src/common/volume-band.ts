// The band of the volume operations of a backup and of a restore, what used a repository, and the ways of the rows
// of the Volumes tab (SPEC-0014, REQ-187 and REQ-188): each found in the index of the operations of the
// installation, never by a search of the items, and never by a name.

import { ownerKey, repositoryKey } from "./volume-index";
import { volumeOperationState } from "./volume-phases";
import { OWNER_KIND, operationOwner } from "./volume-references";
import { bandSentence, volumePhaseText } from "./volume-words";

import type { OperationKind, OperationState } from "./phases";
import type { FamilyRead } from "./read-state";
import type { Reference } from "./references";
import type { BackupRepositoryResource, BackupResource, ObjectMetadata, RestoreResource } from "./types";
import type { ViewKind } from "./views";
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

export interface VolumeBand extends VolumeHalf {
  // What the release does with the operations of this kind, by the phase of the backup or the restore.
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

function ownedBy(index: VolumeIndex, kind: OperationKind, metadata: ObjectMetadata): readonly VolumeOperation[] {
  if (!metadata.uid) return NONE;
  const key = ownerKey(metadata.namespace ?? "", metadata.uid);

  return (kind === "Backup" ? index.ofBackup.get(key) : index.ofRestore.get(key)) ?? NONE;
}

// The band of a backup: its pod volume backups, found by the label of its UID in its namespace (REQ-187).
export function backupBand(index: VolumeIndex, backup: BackupResource, state: OperationState): VolumeBand {
  return {
    ...half("PodVolumeBackup", "Backup", index.reads.podVolumeBackups, ownedBy(index, "Backup", backup.metadata)),
    sentence: bandSentence("Backup", state),
  };
}

// The band of a restore: its pod volume restores, the same way.
export function restoreBand(index: VolumeIndex, restore: RestoreResource, state: OperationState): VolumeBand {
  return {
    ...half("PodVolumeRestore", "Restore", index.reads.podVolumeRestores, ownedBy(index, "Restore", restore.metadata)),
    sentence: bandSentence("Restore", state),
  };
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

const ORDER_OF_KIND: Record<VolumeKind, OperationKind> = {
  PodVolumeBackup: "Backup",
  PodVolumeRestore: "Restore",
};

// The owners of the operations, once each, from the one of the newest operation: resolved as the view of an
// operation resolves its owner, by the labels and the owner reference.
function ownersOf(kind: VolumeKind, operations: readonly VolumeOperation[], reads: OwnerReads): Reference[] {
  const owners = new Map<string, Reference>();
  const read = kind === "PodVolumeBackup" ? reads.backups : reads.restores;

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

  return (
    [
      ["PodVolumeBackup", index.reads.podVolumeBackups],
      ["PodVolumeRestore", index.reads.podVolumeRestores],
    ] as const
  ).map(([kind, read]) => {
    const operations = found.filter((entry) => entry.kind === kind).map((entry) => entry.operation);

    return { ...half(kind, ORDER_OF_KIND[kind], read, operations), owners: ownersOf(kind, operations, reads) };
  });
}

// The kind of the view of an operation of each kind.
export const OPERATION_VIEW: Record<VolumeKind, ViewKind> = {
  PodVolumeBackup: "pod-volume-backup",
  PodVolumeRestore: "pod-volume-restore",
};
