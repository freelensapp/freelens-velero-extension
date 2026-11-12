// The DeleteBackupRequest of one backup, as `velero backup delete` of the reviewed release makes it (SPEC-0017, REQ-279,
// delete.go L123-L131, delete_backup_request_builder.go L31-L63): the name the API server generates from the prefix
// `<backup>-`, the label that names the backup, cut as the release cuts a label of a name, the label of its UID, and
// `spec.backupName`; no other label and no annotation. The main process writes it at the confirmation, the review shows
// its text, and the run sends that text.

import { bodyText } from "./backup-from-schedule";
import { labelOf } from "./name-label";

// The phases of a backup Velero refuses to delete: in progress, waiting for its plugins, or finalizing
// (backup_deletion_controller.go L155-L208, backup_tracker.go L94-L103). One with no phase, New, Queued or ReadyToStart
// it deletes before it starts. The command of the views and the main process read the same list (REQ-278).
export const IN_PROGRESS = [
  "InProgress",
  "WaitingForPluginOperations",
  "WaitingForPluginOperationsPartiallyFailed",
  "Finalizing",
  "FinalizingPartiallyFailed",
] as const;

// The labels of a request that name its backup, which the deletion controller and the views find it by.
export const BACKUP_NAME_LABEL = "velero.io/backup-name";
export const BACKUP_UID_LABEL = "velero.io/backup-uid";

export interface DeleteRequest {
  apiVersion: "velero.io/v1";
  kind: "DeleteBackupRequest";
  metadata: { namespace: string; generateName: string; labels: Record<string, string> };
  spec: { backupName: string };
}

// The request of the backup of this name and UID, in the namespace of its installation.
export function deleteRequestOf(namespace: string, backup: { name: string; uid: string }): DeleteRequest {
  return {
    apiVersion: "velero.io/v1",
    kind: "DeleteBackupRequest",
    metadata: {
      namespace,
      generateName: `${backup.name}-`,
      labels: { [BACKUP_NAME_LABEL]: labelOf(backup.name), [BACKUP_UID_LABEL]: backup.uid },
    },
    spec: { backupName: backup.name },
  };
}

// The text of a request, as it is sent: the one writer of every text of the extension.
export function deleteRequestText(request: DeleteRequest): string {
  return bodyText(request);
}

// What a text of a request is, read back: the backup it names and the namespace it is of, or nothing when it is not
// exactly the request of a backup, byte for byte, as `deleteRequestText` writes it: the text is compared whole with the
// text of the request it would be.
export function readDeleteRequest(
  text: string,
): { namespace: string; backup: { name: string; uid: string } } | undefined {
  let request: unknown;

  try {
    request = JSON.parse(text);
  } catch {
    return undefined;
  }
  const value = request as Partial<DeleteRequest> | null;
  const namespace = value?.metadata?.namespace;
  const name = value?.spec?.backupName;
  const uid = value?.metadata?.labels?.[BACKUP_UID_LABEL];

  if (typeof namespace !== "string" || typeof name !== "string" || typeof uid !== "string") return undefined;
  if (namespace === "" || name === "" || uid === "") return undefined;
  const backup = { name, uid };

  return text === deleteRequestText(deleteRequestOf(namespace, backup)) ? { namespace, backup } : undefined;
}
