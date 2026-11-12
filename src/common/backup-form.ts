// The backup the form asks for (SPEC-0017, REQ-260 to REQ-262): a `velero.io/v1` Backup with its name and its namespace
// and no other metadata, no label and no annotation, and a spec of the fields of the template that the operator set.
// The main process builds it at the confirmation, from the parameters of the request, and the review shows the text it
// writes; the run sends that text.

import { backupNameProblem, bodyText } from "./backup-from-schedule";
import { type BackupTemplate, templateSpec } from "./backup-template";

export interface BackupFromForm {
  apiVersion: "velero.io/v1";
  kind: "Backup";
  metadata: { name: string; namespace: string };
  spec: Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// The backup of the form, or nothing when its name or its template is refused.
export function backupFromForm(namespace: string, name: string, template: BackupTemplate): BackupFromForm | undefined {
  if (backupNameProblem(name) !== undefined) return undefined;
  const spec = templateSpec(template);

  return spec ? { apiVersion: "velero.io/v1", kind: "Backup", metadata: { name, namespace }, spec } : undefined;
}

// The text of the backup of the form, as it is sent.
export function formBodyText(body: BackupFromForm): string {
  return bodyText(body);
}

// The body a text writes, read back: the locations it names are read again at the run. Nothing when the text is not
// the body of a Backup of the form.
export function readFormBody(text: string): BackupFromForm | undefined {
  try {
    const body = JSON.parse(text) as BackupFromForm;

    return isRecord(body) && body.kind === "Backup" && isRecord(body.metadata) && isRecord(body.spec)
      ? body
      : undefined;
  } catch {
    return undefined;
  }
}
