// The write of a restore of the form (SPEC-0017, REQ-246, REQ-248 to REQ-250, REQ-265 to REQ-273). The confirmation
// refuses a name or a form the restore controller refuses, with its words, reads the backup by its name and checks that
// it is the one the view read and that it ended in a phase a restore is asked of, builds the restore of the namespaces
// its spec names, and writes its text once, which the review shows and the token keeps. The run takes the name of the
// backup as the operator typed it, reads the backup again, sends that text, then reads the restore every second until
// Velero writes its phase. A creation whose answer is not known is never sent again: the restore is looked for by its
// name.

import {
  type Answer,
  carriedErrors,
  failure,
  type RestoreCreated,
  saidProblems,
  textWithinBound,
  type WriteConfirmAnswer,
  type WriteConfirmRequest,
  type WriteRunRequest,
  type WriteTarget,
} from "../common/ipc";
import {
  type BackupNamespaces,
  NON_RESTORABLE,
  type RestoreFromForm,
  readRestoreBody,
  restoreBodyText,
  restoreFromForm,
  restoreNameProblem,
  restoreProblems,
} from "../common/restore-form";
import { type CreationDependencies, canonical, createKept, phaseOf } from "./creation";
import { DiagnosticError } from "./diagnostic-transport";

import type { DiagnosticKubernetes, DiagnosticObject } from "./diagnostic-kubernetes";
import type { Write } from "./write-gate";

// The phases of a backup a restore is asked of (REQ-267): Velero restores all it holds of one Completed, and some of
// what one PartiallyFailed holds.
export const RESTORABLE = ["Completed", "PartiallyFailed"] as const;

export const RESTORE_CREATE_WORDS = {
  notARestore:
    "The request is not one of a restore: a restore is asked of one backup, with its name and its form, and the name of the backup is typed before it is created. Nothing was sent.",
  name: (problem: string) => `The name is refused, and nothing was sent: ${problem}`,
  refused: (problems: readonly string[]) => saidProblems("The form is refused, and nothing was sent: ", problems),
  unbuilt: "The restore could not be written from the form: nothing was sent.",
  tooLarge: (characters: number) =>
    `The restore of this form is written in ${characters} characters, more than a review carries: nothing was confirmed.`,
  typed: (backup: string) =>
    `The name typed is not the name of the backup ${backup}: nothing was sent. Type it as it is written in the review.`,
  backupChanged:
    "The backup changed since the view read it: another one has its name now. Go back to the view, which reads it again.",
  notRestorable: (backup: string, phase: string | undefined) =>
    `The backup ${backup} is ${phase ? phase : "without a phase"} now, and a restore is asked only of one Completed or PartiallyFailed: nothing was sent. Go back to the view, which reads it again.`,
  reviewChanged:
    "The restore the run would send is not the one the review showed: nothing was sent. Ask for a new review.",
  backupGone: (backup: string) => `The backup ${backup} is not there any more: nothing was sent.`,
  notServed: (namespace: string) =>
    `The API server answered that what the restore needs is not there, the namespace ${namespace} or the kind Restore of Velero: nothing was created.`,
  // A restore of that name is there, and the creation changed nothing of it.
  exists: (name: string, namespace: string) =>
    `A restore named ${name} is already in ${namespace}, and was not changed: nothing was created. Ask for a new review with another name.`,
  forbiddenRead: (namespace: string) =>
    `The identity of this cluster may not read the backup in ${namespace}: nothing was sent.`,
  forbiddenCreate: (namespace: string) =>
    `The identity of this cluster may not create restores in ${namespace}: nothing was created.`,
  credential:
    "The cluster did not take the credential of the context: it may have expired. Sign in again, then ask again. Nothing was created.",
  rejected: "The API server refused the restore as written: nothing was created.",
  unsent: "The restore could not be written for the cluster: nothing was sent.",
  declined: "The API server did not take the creation, for a reason the extension does not name: nothing was created.",
  changed: "The cluster changed: nothing was sent to it.",
  cancelled: "The write was cancelled: nothing was sent.",
  unreachable: "The API server could not be reached: nothing was sent. Asking again is safe.",
  slow: "The API server did not answer the read of the backup in time: nothing was sent. Asking again is safe.",
  frameGone: "The frame that asked for the write is not there any more: nothing was sent.",
  frameGoneAfter: "The frame that asked for the write is not there any more.",
  changedAfter: (name: string) =>
    `The cluster changed while it answered the creation: its answer is not used, and the restore ${name} may have been created. It is not sent again by itself: look for it among the restores.`,
  // The answers of a look for the restore by its name, after a creation whose answer is not known (REQ-250).
  notDone: (name: string) =>
    `The API server did not answer the creation, and the restore ${name} is not there as far as the read shows. Asking again is a new review.`,
  other: (name: string, namespace: string) =>
    `The API server did not answer the creation, and a restore named ${name} is in ${namespace} that is not known to be this one: it is of another backup, or older than the confirmation.`,
  unknown: (name: string) =>
    `The API server did not answer the creation, and the restore ${name} could not be read: it may have been created. It is not sent again by itself: look for it among the restores.`,
  failed: "The restore could not be asked: nothing is known to have been created.",
};

// The namespaces the spec of a backup names, which the mapping of a restore is matched against.
function namespacesOf(backup: DiagnosticObject): BackupNamespaces {
  const spec = (backup as { spec?: { includedNamespaces?: unknown; excludedNamespaces?: unknown } }).spec;
  const names = (value: unknown) =>
    Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : undefined;
  const included = names(spec?.includedNamespaces);
  const excluded = names(spec?.excludedNamespaces);

  return {
    ...(included ? { includedNamespaces: included } : {}),
    ...(excluded ? { excludedNamespaces: excluded } : {}),
  };
}

// The label of a backup that names the schedule it was made by, which the restore controller copies into the spec of a
// restore of it.
const SCHEDULE_LABEL = "velero.io/schedule-name";

// Whether a restore found by its name is the restore of the text, once Velero may have started it (REQ-250): every
// field the text writes has its value in it, the excluded resources apart, and nothing more than what the restore
// controller writes into the spec of a restore it starts (restore_controller.go L249-L252, L307-L314, L403-L406): the
// resources it never restores after the excluded ones, each one not among them, the schedule of the backup from its
// label, and the default timeout of the operations of the items.
export function sameRestore(
  found: DiagnosticObject,
  sent: RestoreFromForm,
  scheduleOfBackup: string | undefined,
): boolean {
  const spec = (found as { spec?: unknown }).spec;

  if (!spec || typeof spec !== "object" || Array.isArray(spec)) return false;
  const read = spec as Record<string, unknown>;

  for (const [key, value] of Object.entries(sent.spec)) {
    if (key !== "excludedResources" && canonical(read[key]) !== canonical(value)) return false;
  }
  const excluded = (sent.spec.excludedResources as string[] | undefined) ?? [];
  const completed = [...excluded, ...NON_RESTORABLE.filter((resource) => !excluded.includes(resource))];
  const readExcluded = canonical(read.excludedResources ?? []);

  if (readExcluded !== canonical(excluded) && readExcluded !== canonical(completed)) return false;
  if ("scheduleName" in read && !("scheduleName" in sent.spec) && read.scheduleName !== scheduleOfBackup) return false;
  const written = new Set([...Object.keys(sent.spec), "excludedResources", "scheduleName", "itemOperationTimeout"]);

  return Object.keys(read).every((key) => written.has(key));
}

// The end of a read of the backup or of the creation, in the words of this write, with whether asking again is safe:
// it is where nothing was sent and what stopped it may pass. A creation the API server answered and the adapter did not
// take, because the cluster changed meanwhile, may have made the restore.
function endOf(error: unknown, stage: "read" | "creation", namespace: string, backup: string, name: string) {
  const creation = stage === "creation";

  if (!(error instanceof DiagnosticError)) return failure("request-failed", stage, false, RESTORE_CREATE_WORDS.failed);
  switch (error.code) {
    case "not-found":
      return failure(
        "not-found",
        stage,
        false,
        creation ? RESTORE_CREATE_WORDS.notServed(namespace) : RESTORE_CREATE_WORDS.backupGone(backup),
      );
    case "forbidden":
      // A credential the cluster does not take says nothing of what the identity may do.
      if (error.verdict === "credential")
        return failure("request-failed", stage, true, RESTORE_CREATE_WORDS.credential);
      return failure(
        "forbidden",
        stage,
        false,
        creation ? RESTORE_CREATE_WORDS.forbiddenCreate(namespace) : RESTORE_CREATE_WORDS.forbiddenRead(namespace),
      );
    case "conflict":
      return failure("conflict", stage, false, RESTORE_CREATE_WORDS.exists(name, namespace));
    case "validation":
      // The API server refused the body; or the adapter refused to send it, and nothing reached the cluster.
      return failure(
        "validation",
        stage,
        false,
        error.verdict === "refused" ? RESTORE_CREATE_WORDS.rejected : RESTORE_CREATE_WORDS.unsent,
      );
    case "target-changed":
      if (error.verdict === "answered")
        return failure("submission-unknown", stage, false, RESTORE_CREATE_WORDS.changedAfter(name));
      return failure("target-changed", stage, false, RESTORE_CREATE_WORDS.changed);
    case "cancelled":
      return failure("cancelled", stage, true, RESTORE_CREATE_WORDS.cancelled);
    case "deadline":
      return failure("deadline", stage, true, RESTORE_CREATE_WORDS.slow);
    case "transport-unreachable":
      return failure("transport-unreachable", stage, true, RESTORE_CREATE_WORDS.unreachable);
    case "request-failed":
      return failure(
        "request-failed",
        stage,
        false,
        creation ? RESTORE_CREATE_WORDS.declined : RESTORE_CREATE_WORDS.failed,
      );
    default:
      return failure(error.code, stage, false, RESTORE_CREATE_WORDS.failed);
  }
}

// The backup of the review, read by its name in the namespace of the installation: the one the view read, by its UID,
// and in a phase a restore is asked of, or nothing is sent (REQ-266, REQ-267).
async function readBackup(
  adapter: DiagnosticKubernetes,
  namespace: string,
  target: WriteTarget,
  name: string,
  signal: AbortSignal,
): Promise<Answer<DiagnosticObject>> {
  let backup: DiagnosticObject;

  try {
    backup = await adapter.read("Backup", namespace, target.name, signal);
  } catch (error) {
    return endOf(error, "read", namespace, target.name, name);
  }
  if (backup.metadata.uid !== target.uid) return failure("conflict", "read", false, RESTORE_CREATE_WORDS.backupChanged);
  const phase = phaseOf(backup);

  if (!(RESTORABLE as readonly (string | undefined)[]).includes(phase))
    return failure("conflict", "read", false, RESTORE_CREATE_WORDS.notRestorable(target.name, phase));
  return { ok: true, value: backup };
}

// The confirmation: the name and the form are ones the main process takes, the gate is open for the namespace, the
// backup is the one the view read and ended, and the restore of the namespaces it names is written as the text that the
// review shows and the run sends.
export async function confirmRestoreCreate(
  dependencies: CreationDependencies,
  sender: string,
  request: WriteConfirmRequest,
  signal: AbortSignal,
): Promise<Answer<WriteConfirmAnswer>> {
  const { target, restore: name, restoreForm: form } = request;

  if (target?.kind !== "Backup" || name === undefined || !form)
    return failure("validation", "request", false, RESTORE_CREATE_WORDS.notARestore);
  const named = restoreNameProblem(name);

  if (named) return failure("validation", "request", false, RESTORE_CREATE_WORDS.name(named));
  const opened = dependencies.gate.opened(request.cluster, request.namespace);

  if (!opened.ok) return opened;
  const read = await readBackup(opened.value, request.namespace, target, name, signal);

  if (!read.ok) return read;
  const namespaces = namespacesOf(read.value);
  const problems = Object.values(restoreProblems(form, namespaces).problems).flat();

  if (problems.length > 0) return failure("validation", "request", false, RESTORE_CREATE_WORDS.refused(problems));
  const body = restoreFromForm(request.namespace, name, target.name, form, namespaces);

  if (!body) return failure("validation", "request", false, RESTORE_CREATE_WORDS.unbuilt);
  const text = restoreBodyText(body);

  // The text travels in the answer of the confirmation: one the answer cannot carry is not confirmed, and no token is
  // given for it.
  if (!textWithinBound(text)) return failure("validation", "review", false, RESTORE_CREATE_WORDS.tooLarge(text.length));
  const confirmed = dependencies.gate.confirm(
    sender,
    request.cluster,
    request.namespace,
    request.kind,
    target,
    undefined,
    { name, text },
  );

  return confirmed.ok ? { ok: true, value: { ...confirmed.value, text } } : confirmed;
}

// The run: the name of the backup typed as it is written, the token of the confirmation, the backup read again, the
// frame that asked still there, the text sent byte for byte, and the reads after the creation. The caller watches the
// frame and ends the write.
export async function runRestoreCreate(
  dependencies: CreationDependencies,
  sender: string,
  request: WriteRunRequest,
  watch: (write: Write) => () => void,
  still: () => boolean = () => true,
): Promise<Answer<RestoreCreated>> {
  const { target, restore: name } = request;

  if (target?.kind !== "Backup" || name === undefined || request.typed === undefined)
    return failure("validation", "request", false, RESTORE_CREATE_WORDS.notARestore);
  // The second gesture is looked at before the token is taken: another name typed leaves the review as it is.
  if (request.typed !== target.name)
    return failure("validation", "request", false, RESTORE_CREATE_WORDS.typed(target.name));
  const taken = dependencies.gate.take(
    sender,
    request.cluster,
    request.namespace,
    request.kind,
    target,
    request.token,
    request.request,
    undefined,
    name,
  );

  if (!taken.ok) return taken;
  const { adapter, write, text, confirmedAt } = taken.value;
  const stop = watch(write);

  try {
    const body = text === undefined ? undefined : readRestoreBody(text);

    // The text kept with the token is the restore of this name, of this namespace and of this backup, or nothing is
    // sent.
    if (
      !text ||
      !body ||
      body.metadata.name !== name ||
      body.metadata.namespace !== request.namespace ||
      body.spec.backupName !== target.name
    )
      return failure("conflict", "read", false, RESTORE_CREATE_WORDS.reviewChanged);
    write.status = { step: "reading the backup" };
    const read = await readBackup(adapter, request.namespace, target, name, write.controller.signal);

    if (!read.ok) return read;
    const scheduleOfBackup = read.value.metadata.labels?.[SCHEDULE_LABEL];

    return await createKept(
      {
        kind: "Restore",
        noun: "restore",
        name,
        create: (to, namespace, sent, signal) => to.createRestore(namespace, sent, signal),
        endOf: (error) => endOf(error, "creation", request.namespace, target.name, name),
        // A restore of the form has no label: it is the one created when its spec is the one of the text, with what
        // Velero writes into it when it starts it.
        same: (found) => sameRestore(found, body, scheduleOfBackup),
        value: (restore, phase, found) => ({
          name: restore.metadata.name,
          uid: restore.metadata.uid,
          ...(phase ? { phase } : {}),
          ...carriedErrors((restore as { status?: { validationErrors?: unknown } }).status?.validationErrors),
          ...(found ? { found: true } : {}),
        }),
        words: {
          cancelled: RESTORE_CREATE_WORDS.cancelled,
          frameGone: RESTORE_CREATE_WORDS.frameGone,
          frameGoneAfter: RESTORE_CREATE_WORDS.frameGoneAfter,
          notDone: RESTORE_CREATE_WORDS.notDone(name),
          unknown: RESTORE_CREATE_WORDS.unknown(name),
        },
        other: failure("submission-unknown", "creation", false, RESTORE_CREATE_WORDS.other(name, request.namespace)),
      },
      dependencies,
      adapter,
      request,
      text,
      confirmedAt,
      write,
      still,
    );
  } finally {
    stop();
    dependencies.gate.finish(request.cluster, request.request);
  }
}
