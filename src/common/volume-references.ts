// What an operation of the volumes refers to inside its installation: the backup or the restore it belongs to, its
// storage location, the backup repository it writes into or reads from, and the pod and the node it is of, which
// are names the extension does not read.

import { labelOf } from "./name-label";
import { resolveReference, unavailable } from "./references";
import { LABELS, PVC_NAME_ANNOTATION } from "./types";

import type { FamilyRead } from "./read-state";
import type { Reference, ReferenceState } from "./references";
import type {
  BackupRepositoryResource,
  BackupResource,
  BackupStorageLocationResource,
  ObjectMetadata,
  PodVolumeBackupResource,
  PodVolumeRestoreResource,
  RestoreResource,
} from "./types";
import type { VolumeKind } from "./volume-phases";

export type VolumeOperation = PodVolumeBackupResource | PodVolumeRestoreResource;

function named(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

// The objects of a read by their name, made once for the items of a read: a list of two thousand operations finds
// the owner of each row in one look, and a new read makes a new array, so a new map.
const byName = new WeakMap<readonly unknown[], Map<string, { metadata: ObjectMetadata }>>();
const byLabel = new WeakMap<readonly unknown[], Map<string, { metadata: ObjectMetadata }>>();

function indexed<Item extends { metadata: ObjectMetadata }>(items: readonly Item[]): Map<string, Item> {
  let found = byName.get(items) as Map<string, Item> | undefined;

  if (!found) {
    found = new Map(items.map((item) => [item.metadata.name, item]));
    byName.set(items, found);
  }
  return found;
}

// The items by the value of a label that names them, which is the name cut as the release cuts a long one.
function labelled<Item extends { metadata: ObjectMetadata }>(items: readonly Item[]): Map<string, Item> {
  let found = byLabel.get(items) as Map<string, Item> | undefined;

  if (!found) {
    found = new Map(items.map((item) => [labelOf(item.metadata.name), item]));
    byLabel.set(items, found);
  }
  return found;
}

export type OwnerKind = "Backup" | "Restore";

export const OWNER_KIND: Record<VolumeKind, OwnerKind> = {
  PodVolumeBackup: "Backup",
  PodVolumeRestore: "Restore",
};

export interface Owner {
  // How the owner was named: by the labels the release writes of its name and its UID, by the owner reference
  // alone, or not at all.
  by: "labels" | "owner-reference" | "none";
  reference?: Reference;
  // The name is of another object of the kind, created after the one the operation belongs to.
  replaced: boolean;
  // The labels and the owner reference name two objects: said beside the owner the labels name.
  disagreement?: string;
}

// The owner of an operation, as the release names it (SPEC-0014, the relationships): the labels of the name and the
// UID of the backup or the restore first, which is how the release lists the operations of one, then the owner
// reference. An object of that name is the owner only when its UID is the one named.
export function operationOwner(
  operation: VolumeOperation,
  kind: OwnerKind,
  read: FamilyRead<BackupResource> | FamilyRead<RestoreResource>,
): Owner {
  const labels = operation.metadata.labels ?? {};
  const fromLabels = {
    name: named(labels[kind === "Backup" ? LABELS.backup : LABELS.restore]),
    uid: named(labels[kind === "Backup" ? LABELS.backupUid : LABELS.restoreUid]),
  };
  const references = operation.metadata.ownerReferences ?? [];
  const owned =
    references.find((reference) => reference?.kind === kind && reference.controller) ??
    references.find((reference) => reference?.kind === kind);
  const fromOwner = { name: named(owned?.name), uid: named(owned?.uid) };
  const by = fromLabels.name ? "labels" : fromOwner.name ? "owner-reference" : "none";
  const { name, uid } = by === "labels" ? fromLabels : fromOwner;
  const noun = kind.toLowerCase();
  // The label of a name over 63 characters is the name cut as the release cuts it: the owner reference names
  // the same object when its name, cut that way, is the label.
  const disagreement =
    by === "labels" &&
    fromOwner.name !== undefined &&
    (labelOf(fromOwner.name) !== fromLabels.name || (fromLabels.uid !== undefined && fromOwner.uid !== fromLabels.uid))
      ? `Its owner reference names the ${noun} ${fromOwner.name}${fromOwner.uid ? ` of UID ${fromOwner.uid}` : ""}, which its labels do not name`
      : undefined;

  if (!name) return { by, replaced: false };
  const namespace = operation.metadata.namespace ?? "";
  const found =
    by === "labels"
      ? labelled<{ metadata: ObjectMetadata }>(read.items).get(name)
      : indexed<{ metadata: ObjectMetadata }>(read.items).get(name);
  const there = found && found.metadata.namespace === namespace ? found : undefined;
  // The whole name: the one of the object found, or the one of the owner reference that the label is the cut of.
  const whole =
    there?.metadata.name ??
    (by === "labels" && fromOwner.name !== undefined && labelOf(fromOwner.name) === name ? fromOwner.name : name);

  if (there && uid !== undefined && there.metadata.uid !== uid) {
    return {
      by,
      replaced: true,
      reference: {
        kind,
        name: whole,
        namespace,
        state: "absent",
        stale: false,
        reason: `The ${noun} of this name is another one, created after the one this operation belongs to`,
      },
      ...(disagreement ? { disagreement } : {}),
    };
  }
  // The one object of that name, found in the index, is resolved as every reference is.
  const reference = resolveReference(kind, whole, namespace, { ...read, items: there ? [there] : [] });

  return { by, replaced: false, reference, ...(disagreement ? { disagreement } : {}) };
}

// The storage location an operation names, among the ones of its installation.
export function operationLocation(
  operation: VolumeOperation,
  read: FamilyRead<BackupStorageLocationResource>,
): Reference | undefined {
  const name = named(operation.spec?.backupStorageLocation);

  return name ? resolveReference("BackupStorageLocation", name, operation.metadata.namespace ?? "", read) : undefined;
}

// The three labels the release names a repository with: the namespace of the volumes, the location and the type.
export interface RepositoryTriple {
  volumeNamespace: string;
  location: string;
  type: string;
}

function tripleKey(triple: RepositoryTriple): string {
  return `${triple.volumeNamespace}\u0000${triple.location}\u0000${triple.type}`;
}

// The type of repository of an uploader: kopia, or restic for restic and for an empty uploader (SPEC-0014, the
// relationships). Another uploader names no type the release knows.
export function repositoryType(uploader: unknown): string | undefined {
  if (uploader === "kopia") return "kopia";
  if (uploader === undefined || uploader === null || uploader === "" || uploader === "restic") return "restic";
  return undefined;
}

// The namespace of the volumes of an operation: the one of its pod for a pod volume backup, the source namespace for
// a pod volume restore.
export function volumeNamespace(kind: VolumeKind, operation: VolumeOperation): string | undefined {
  return kind === "PodVolumeBackup"
    ? named((operation as PodVolumeBackupResource).spec?.pod?.namespace)
    : named((operation as PodVolumeRestoreResource).spec?.sourceNamespace);
}

export type OperationRepository =
  | { state: "found"; reference: Reference }
  | { state: "none" | "many" | "no-triple"; reason: string; names: string[] }
  | { state: Exclude<ReferenceState, "resolved" | "absent">; reason: string; names: string[] };

const repositoryIndex = new WeakMap<readonly unknown[], Map<string, BackupRepositoryResource[]>>();

function byTriple(items: readonly BackupRepositoryResource[]): Map<string, BackupRepositoryResource[]> {
  let found = repositoryIndex.get(items);

  if (!found) {
    found = new Map();
    for (const repository of items) {
      const labels = repository.metadata.labels ?? {};
      const triple = {
        volumeNamespace: labels[LABELS.volumeNamespace],
        location: labels[LABELS.storageLocation],
        type: labels[LABELS.repositoryType],
      };

      if (!triple.volumeNamespace || !triple.location || !triple.type) continue;
      const key = tripleKey(triple);

      found.set(key, [...(found.get(key) ?? []), repository]);
    }
    repositoryIndex.set(items, found);
  }
  return found;
}

// The repository of an operation, by the three labels, as the release finds one, and never by its name: none, one,
// or more than one, which the release refuses.
export function operationRepository(
  kind: VolumeKind,
  operation: VolumeOperation,
  read: FamilyRead<BackupRepositoryResource>,
): OperationRepository {
  const namespace = volumeNamespace(kind, operation);
  const location = named(operation.spec?.backupStorageLocation);
  const type = repositoryType(operation.spec?.uploaderType);

  if (!namespace || !location || !type) {
    return {
      state: "no-triple",
      names: [],
      reason: !type
        ? `The uploader ${String(operation.spec?.uploaderType)} names no type of repository the reviewed release knows`
        : "The operation does not name the namespace of its volume and its storage location",
    };
  }
  if (read.status !== "ready" && read.lastSuccess === undefined) {
    return { ...unavailable("BackupRepository", read), names: [] } as OperationRepository;
  }
  // The labels hold the names cut as the release cuts a long one: the triple is compared cut the same way.
  const key = tripleKey({ volumeNamespace: labelOf(namespace), location: labelOf(location), type });
  const found = (byTriple(read.items).get(key) ?? []).filter(
    (repository) => repository.metadata.namespace === operation.metadata.namespace,
  );

  if (found.length === 1) {
    return {
      state: "found",
      reference: resolveReference("BackupRepository", found[0].metadata.name, found[0].metadata.namespace ?? "", {
        ...read,
        items: found,
      }),
    };
  }
  const names = found.map((repository) => repository.metadata.name).sort();

  return found.length
    ? {
        state: "many",
        names,
        reason: `${found.length} repositories name the volumes of ${namespace}, the location ${location} and the type ${type}: the release refuses more than one`,
      }
    : {
        state: "none",
        names,
        reason: `No repository of this installation names the volumes of ${namespace}, the location ${location} and the type ${type}`,
      };
}

// The pod of an operation, as names: the extension does not read it, and does not say whether it is there.
export interface PodOf {
  namespace?: string;
  name?: string;
  uid?: string;
}

export function operationPod(operation: VolumeOperation): PodOf {
  const pod = operation.spec?.pod;

  return {
    ...(named(pod?.namespace) ? { namespace: pod?.namespace } : {}),
    ...(named(pod?.name) ? { name: pod?.name } : {}),
    ...(named(pod?.uid) ? { uid: pod?.uid } : {}),
  };
}

// The node of an operation: `spec.node` of a pod volume backup, which has none in its status; `status.node` of a
// pod volume restore, which its node agent writes when it accepts it.
export function operationNode(kind: VolumeKind, operation: VolumeOperation): string | undefined {
  return kind === "PodVolumeBackup"
    ? named((operation as PodVolumeBackupResource).spec?.node)
    : named((operation as PodVolumeRestoreResource).status?.node);
}

// The claim of the volume of an operation, by its name and its UID, as text.
export function operationClaim(kind: VolumeKind, operation: VolumeOperation): { name?: string; uid?: string } {
  const uid = named(operation.metadata.labels?.[LABELS.pvcUid]);
  const name = kind === "PodVolumeBackup" ? named(operation.metadata.annotations?.[PVC_NAME_ANNOTATION]) : undefined;

  return { ...(name ? { name } : {}), ...(uid ? { uid } : {}) };
}
