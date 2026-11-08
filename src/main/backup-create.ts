// The write of a backup of the form (SPEC-0017, REQ-246, REQ-248 to REQ-250, REQ-260 to REQ-264). The confirmation
// refuses a template the release refuses, with its words, reads the storage location and each snapshot location the
// template names, builds the backup and writes its text once, which the review shows and the token keeps. The run reads
// the locations again and sends that text, then reads the backup every second until Velero writes its phase, as a
// backup asked from a schedule is created. A creation whose answer is not known is never sent again: the backup is
// looked for by its name.

import { backupFromForm, formBodyText, readFormBody } from "../common/backup-form";
import { templateProblems } from "../common/backup-template";
import {
  type Answer,
  type BackupCreated,
  failure,
  textWithinBound,
  type WriteConfirmAnswer,
  type WriteConfirmRequest,
  type WriteRunRequest,
} from "../common/ipc";
import { type BackupNowDependencies, createKept } from "./backup-now";
import { DiagnosticError } from "./diagnostic-transport";

import type { DiagnosticKubernetes, DiagnosticObject } from "./diagnostic-kubernetes";
import type { Write } from "./write-gate";

export const BACKUP_CREATE_WORDS = {
  notAForm: "A backup of the form is asked with its name and its template, of no other object.",
  refused: (problems: string[]) => `The template is refused, and nothing was sent: ${problems.join(" ")}`,
  unbuilt: "The backup could not be written from the template: nothing was sent.",
  tooLarge: (characters: number) =>
    `The backup of this template is written in ${characters} characters, more than a review carries: nothing was confirmed.`,
  reviewChanged:
    "The backup the run would send is not the one the review showed: nothing was sent. Ask for a new review.",
  locationGone: (location: string) => `The ${location} is not there: nothing was sent.`,
  forbiddenRead: (location: string, namespace: string) =>
    `The identity of this cluster may not read the ${location} in ${namespace}: nothing was sent.`,
  credential:
    "The cluster did not take the credential of the context: it may have expired. Sign in again, then ask again. Nothing was sent.",
  // The words the backup controller of the release writes when two snapshot locations named are of one provider.
  twoForProvider: (provider: string, name: string, other: string) =>
    `more than one VolumeSnapshotLocation name specified for provider ${provider}: ${name}; unexpected name was ${other}`,
  changed: "The cluster changed: nothing was sent to it.",
  cancelled: "The write was cancelled: nothing was sent.",
  slow: "The API server did not answer the read of a location in time: nothing was sent. Asking again is safe.",
  unreachable: "The API server could not be reached: nothing was sent. Asking again is safe.",
  failed: "The locations of the backup could not be read: nothing was sent.",
};

// A location the template names, as the words say it.
function locationWords(kind: "BackupStorageLocation" | "VolumeSnapshotLocation", name: string): string {
  return kind === "BackupStorageLocation" ? `storage location ${name}` : `snapshot location ${name}`;
}

// The end of a read of a location, in the words of this write: nothing was sent, and asking again is safe where what
// stopped it may pass.
function readEnd(error: unknown, location: string, namespace: string): Answer<never> {
  if (!(error instanceof DiagnosticError)) return failure("request-failed", "read", false, BACKUP_CREATE_WORDS.failed);
  switch (error.code) {
    case "not-found":
      return failure("not-found", "read", false, BACKUP_CREATE_WORDS.locationGone(location));
    case "forbidden":
      if (error.verdict === "credential")
        return failure("request-failed", "read", true, BACKUP_CREATE_WORDS.credential);
      return failure("forbidden", "read", false, BACKUP_CREATE_WORDS.forbiddenRead(location, namespace));
    case "target-changed":
      return failure("target-changed", "read", false, BACKUP_CREATE_WORDS.changed);
    case "cancelled":
      return failure("cancelled", "read", true, BACKUP_CREATE_WORDS.cancelled);
    case "deadline":
      return failure("deadline", "read", true, BACKUP_CREATE_WORDS.slow);
    case "transport-unreachable":
      return failure("transport-unreachable", "read", true, BACKUP_CREATE_WORDS.unreachable);
    default:
      return failure(error.code, "read", false, BACKUP_CREATE_WORDS.failed);
  }
}

// The storage location and each snapshot location named, read in the namespace of the installation: one that is not
// there ends the write before anything is sent, and so do two snapshot locations of one provider, which the release
// refuses (SPEC-0016, REQ-224; SPEC-0017, the contract).
async function readLocations(
  adapter: DiagnosticKubernetes,
  namespace: string,
  storage: string,
  snapshots: string[],
  signal: AbortSignal,
): Promise<Answer<null>> {
  const providers = new Map<string, string>();

  for (const [kind, name] of [
    ["BackupStorageLocation", storage],
    ...snapshots.map((snapshot) => ["VolumeSnapshotLocation", snapshot] as const),
  ] as const) {
    let read: DiagnosticObject;

    try {
      read = await adapter.read(kind, namespace, name, signal);
    } catch (error) {
      return readEnd(error, locationWords(kind, name), namespace);
    }
    if (kind !== "VolumeSnapshotLocation") continue;
    const provider = (read as { spec?: { provider?: unknown } }).spec?.provider;

    if (typeof provider !== "string") continue;
    const other = providers.get(provider);

    if (other !== undefined)
      return failure("validation", "read", false, BACKUP_CREATE_WORDS.twoForProvider(provider, name, other));
    providers.set(provider, name);
  }
  return { ok: true, value: null };
}

// The confirmation: the template is one the release takes, the gate is open for the namespace, the locations it names
// are there, and the backup is written as the text that the review shows and the run sends.
export async function confirmBackupCreate(
  dependencies: BackupNowDependencies,
  sender: string,
  request: WriteConfirmRequest,
  signal: AbortSignal,
): Promise<Answer<WriteConfirmAnswer>> {
  const { backup, template } = request;

  if (request.target || !backup || !template)
    return failure("validation", "request", false, BACKUP_CREATE_WORDS.notAForm);
  const problems = Object.values(templateProblems(template)).flat();

  if (problems.length > 0) return failure("validation", "request", false, BACKUP_CREATE_WORDS.refused(problems));
  const body = backupFromForm(request.namespace, backup, template);

  if (!body) return failure("validation", "request", false, BACKUP_CREATE_WORDS.unbuilt);
  const opened = dependencies.gate.opened(request.cluster, request.namespace);

  if (!opened.ok) return opened;
  const read = await readLocations(
    opened.value,
    request.namespace,
    String(body.spec.storageLocation),
    (body.spec.volumeSnapshotLocations as string[] | undefined) ?? [],
    signal,
  );

  if (!read.ok) return read;
  const text = formBodyText(body);

  // The text travels in the answer of the confirmation: one the answer cannot carry is not confirmed, and no token is
  // given for it.
  if (!textWithinBound(text)) return failure("validation", "review", false, BACKUP_CREATE_WORDS.tooLarge(text.length));
  const confirmed = dependencies.gate.confirm(
    sender,
    request.cluster,
    request.namespace,
    request.kind,
    undefined,
    undefined,
    { backup, text },
  );

  return confirmed.ok ? { ok: true, value: { ...confirmed.value, text } } : confirmed;
}

// The run: the token of the confirmation, the locations of the text it kept read again, the frame that asked still
// there, the text sent byte for byte, and the reads after the creation. The caller watches the frame and ends the
// write.
export async function runBackupCreate(
  dependencies: BackupNowDependencies,
  sender: string,
  request: WriteRunRequest,
  watch: (write: Write) => () => void,
  still: () => boolean = () => true,
): Promise<Answer<BackupCreated>> {
  const { backup } = request;

  if (request.target || !backup) return failure("validation", "request", false, BACKUP_CREATE_WORDS.notAForm);
  const taken = dependencies.gate.take(
    sender,
    request.cluster,
    request.namespace,
    request.kind,
    undefined,
    request.token,
    request.request,
    undefined,
    backup,
  );

  if (!taken.ok) return taken;
  const { adapter, write, text, confirmedAt } = taken.value;
  const stop = watch(write);

  try {
    const body = text === undefined ? undefined : readFormBody(text);

    // The text kept with the token is the backup of this name and of this namespace, or nothing is sent.
    if (!text || !body || body.metadata.name !== backup || body.metadata.namespace !== request.namespace)
      return failure("conflict", "read", false, BACKUP_CREATE_WORDS.reviewChanged);
    write.status = { step: "reading the locations" };
    const read = await readLocations(
      adapter,
      request.namespace,
      String(body.spec.storageLocation),
      (body.spec.volumeSnapshotLocations as string[] | undefined) ?? [],
      write.controller.signal,
    );

    if (!read.ok) return read;
    return await createKept(dependencies, adapter, request, text, confirmedAt, write, still);
  } finally {
    stop();
    dependencies.gate.finish(request.cluster, request.request);
  }
}
