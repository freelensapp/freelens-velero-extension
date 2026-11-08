// The write of a schedule of the form (SPEC-0016, REQ-222 to REQ-229, REQ-238, REQ-239, REQ-243). The confirmation
// refuses a name, an expression or a template the main process refuses, with its words, reads the storage location and
// each snapshot location the template names, builds the Schedule and writes its text once, which the review shows and
// the token keeps. The run reads the locations again and sends that text, then reads the schedule every second until
// Velero writes its phase, or once when it is paused, since Velero does not read a paused schedule. A creation whose
// answer is not known is never sent again: the schedule is looked for by its name.

import { templateProblems } from "../common/backup-template";
import {
  type Answer,
  carriedErrors,
  failure,
  type ScheduleCreated,
  textWithinBound,
  type WriteConfirmAnswer,
  type WriteConfirmRequest,
  type WriteRunRequest,
} from "../common/ipc";
import {
  expressionProblem,
  readScheduleBody,
  type ScheduleFromForm,
  scheduleBodyText,
  scheduleFromForm,
  scheduleNameProblem,
} from "../common/schedule-form";
import { readLocations } from "./backup-create";
import { type CreationDependencies, canonical, createKept } from "./creation";
import { DiagnosticError } from "./diagnostic-transport";

import type { DiagnosticKubernetes, DiagnosticObject } from "./diagnostic-kubernetes";
import type { Write } from "./write-gate";

export const SCHEDULE_CREATE_WORDS = {
  notAForm:
    "A schedule of the form is asked with its name and, at the confirmation, its expression, its three flags and its template, of no other object.",
  name: (problem: string) => `The name is refused, and nothing was sent: ${problem}`,
  expression: (problem: string) => `The expression is refused, and nothing was sent: ${problem}`,
  refused: (problems: string[]) => `The template is refused, and nothing was sent: ${problems.join(" ")}`,
  unbuilt: "The schedule could not be written from the form: nothing was sent.",
  tooLarge: (characters: number) =>
    `The schedule of this form is written in ${characters} characters, more than a review carries: nothing was confirmed.`,
  reviewChanged:
    "The schedule the run would send is not the one the review showed: nothing was sent. Ask for a new review.",
  notServed: (namespace: string) =>
    `The API server answered that what the schedule needs is not there, the namespace ${namespace} or the kind Schedule of Velero: nothing was created.`,
  // A schedule of that name is there, and the creation changed nothing of it (REQ-227).
  exists: (name: string, namespace: string) =>
    `A schedule named ${name} is already in ${namespace}, and was not changed: nothing was created. Ask for a new review with another name.`,
  forbiddenCreate: (namespace: string) =>
    `The identity of this cluster may not create schedules in ${namespace}: nothing was created.`,
  credential:
    "The cluster did not take the credential of the context: it may have expired. Sign in again, then ask again. Nothing was created.",
  rejected: "The API server refused the schedule as written: nothing was created.",
  unsent: "The schedule could not be written for the cluster: nothing was sent.",
  declined: "The API server did not take the creation, for a reason the extension does not name: nothing was created.",
  changed: "The cluster changed: nothing was sent to it.",
  cancelled: "The write was cancelled: nothing was sent.",
  unreachable: "The API server could not be reached: nothing was sent. Asking again is safe.",
  frameGone: "The frame that asked for the write is not there any more: nothing was sent.",
  frameGoneAfter: "The frame that asked for the write is not there any more.",
  changedAfter: (name: string) =>
    `The cluster changed while it answered the creation: its answer is not used, and the schedule ${name} may have been created. It is not sent again by itself: look for it among the schedules.`,
  // The answers of a look for the schedule by its name, after a creation whose answer is not known (REQ-228).
  notDone: (name: string) =>
    `The API server did not answer the creation, and the schedule ${name} is not there as far as the read shows. Asking again is a new review.`,
  other: (name: string, namespace: string) =>
    `The API server did not answer the creation, and a schedule named ${name} is in ${namespace} that is not known to be this one: its spec is not the one of the review, or it is older than the confirmation. It was not changed.`,
  unknown: (name: string) =>
    `The API server did not answer the creation, and the schedule ${name} could not be read: it may have been created. It is not sent again by itself: look for it among the schedules.`,
  failed: "The schedule could not be asked: nothing is known to have been created.",
};

// The errors of the validation Velero refused the expression with, as written, within the bounds of the contract: the
// others are counted, and read in the view of the schedule.
function errorsOf(object: DiagnosticObject): { errors?: string[]; errorsLeft?: number } {
  return carriedErrors((object as { status?: { validationErrors?: unknown } }).status?.validationErrors);
}

// The end of the creation, in the words of this write, with whether asking again is safe: it is where nothing was sent
// and what stopped it may pass. A creation the API server answered and the adapter did not take, because the cluster
// changed meanwhile, may have made the schedule.
function endOf(error: unknown, namespace: string, name: string): Answer<never> {
  const stage = "creation";

  if (!(error instanceof DiagnosticError)) return failure("request-failed", stage, false, SCHEDULE_CREATE_WORDS.failed);
  switch (error.code) {
    case "not-found":
      return failure("not-found", stage, false, SCHEDULE_CREATE_WORDS.notServed(namespace));
    case "forbidden":
      // A credential the cluster does not take says nothing of what the identity may do.
      if (error.verdict === "credential")
        return failure("request-failed", stage, true, SCHEDULE_CREATE_WORDS.credential);
      return failure("forbidden", stage, false, SCHEDULE_CREATE_WORDS.forbiddenCreate(namespace));
    case "conflict":
      return failure("conflict", stage, false, SCHEDULE_CREATE_WORDS.exists(name, namespace));
    case "validation":
      // The API server refused the body; or the adapter refused to send it, and nothing reached the cluster.
      return failure(
        "validation",
        stage,
        false,
        error.verdict === "refused" ? SCHEDULE_CREATE_WORDS.rejected : SCHEDULE_CREATE_WORDS.unsent,
      );
    case "target-changed":
      if (error.verdict === "answered")
        return failure("submission-unknown", stage, false, SCHEDULE_CREATE_WORDS.changedAfter(name));
      return failure("target-changed", stage, false, SCHEDULE_CREATE_WORDS.changed);
    case "cancelled":
      return failure("cancelled", stage, true, SCHEDULE_CREATE_WORDS.cancelled);
    case "transport-unreachable":
      return failure("transport-unreachable", stage, true, SCHEDULE_CREATE_WORDS.unreachable);
    case "request-failed":
      return failure("request-failed", stage, false, SCHEDULE_CREATE_WORDS.declined);
    default:
      return failure(error.code, stage, false, SCHEDULE_CREATE_WORDS.failed);
  }
}

// The locations the template of a schedule names.
function locationsOf(body: ScheduleFromForm): { storage: string; snapshots: string[] } {
  const template = body.spec.template;

  return {
    storage: String(template.storageLocation),
    snapshots: (template.volumeSnapshotLocations as string[] | undefined) ?? [],
  };
}

// The confirmation: the name, the expression and the template are ones the main process takes, the gate is open for
// the namespace, the locations the template names are there, and the schedule is written as the text that the review
// shows and the run sends.
export async function confirmScheduleCreate(
  dependencies: CreationDependencies,
  sender: string,
  request: WriteConfirmRequest,
  signal: AbortSignal,
): Promise<Answer<WriteConfirmAnswer>> {
  const { schedule: name, wrapper, template } = request;

  if (request.target || request.backup !== undefined || name === undefined || !wrapper || !template)
    return failure("validation", "request", false, SCHEDULE_CREATE_WORDS.notAForm);
  const named = scheduleNameProblem(name);

  if (named) return failure("validation", "request", false, SCHEDULE_CREATE_WORDS.name(named));
  const now = dependencies.now();
  const expression = expressionProblem(wrapper.expression, now);

  if (expression) return failure("validation", "request", false, SCHEDULE_CREATE_WORDS.expression(expression));
  const problems = Object.values(templateProblems(template, "schedule")).flat();

  if (problems.length > 0) return failure("validation", "request", false, SCHEDULE_CREATE_WORDS.refused(problems));
  const body = scheduleFromForm(request.namespace, name, wrapper, template, now);

  if (!body) return failure("validation", "request", false, SCHEDULE_CREATE_WORDS.unbuilt);
  const opened = dependencies.gate.opened(request.cluster, request.namespace);

  if (!opened.ok) return opened;
  const { storage, snapshots } = locationsOf(body);
  const read = await readLocations(opened.value, request.namespace, storage, snapshots, signal);

  if (!read.ok) return read;
  const text = scheduleBodyText(body);

  // The text travels in the answer of the confirmation: one the answer cannot carry is not confirmed, and no token is
  // given for it.
  if (!textWithinBound(text))
    return failure("validation", "review", false, SCHEDULE_CREATE_WORDS.tooLarge(text.length));
  const confirmed = dependencies.gate.confirm(
    sender,
    request.cluster,
    request.namespace,
    request.kind,
    undefined,
    undefined,
    { name, text },
  );

  return confirmed.ok ? { ok: true, value: { ...confirmed.value, text } } : confirmed;
}

// Whether a schedule found by its name has the spec the text sent, `skipImmediately` aside, which the controller sets
// to false at its first reading (REQ-228).
function sameSpec(text: string, found: DiagnosticObject): boolean {
  const body = readScheduleBody(text);
  const carried = (found as { spec?: unknown }).spec;

  if (!body || !carried || typeof carried !== "object") return false;
  const { skipImmediately: _sent, ...sent } = body.spec;
  const { skipImmediately: _carried, ...rest } = carried as Record<string, unknown>;

  return canonical(sent) === canonical(rest);
}

// The run: the token of the confirmation, the locations of the text it kept read again, the frame that asked still
// there, the text sent byte for byte, and the reads after the creation. The caller watches the frame and ends the
// write.
export async function runScheduleCreate(
  dependencies: CreationDependencies,
  sender: string,
  request: WriteRunRequest,
  watch: (write: Write) => () => void,
  still: () => boolean = () => true,
): Promise<Answer<ScheduleCreated>> {
  const { schedule: name } = request;

  if (request.target || request.backup !== undefined || name === undefined)
    return failure("validation", "request", false, SCHEDULE_CREATE_WORDS.notAForm);
  const taken = dependencies.gate.take(
    sender,
    request.cluster,
    request.namespace,
    request.kind,
    undefined,
    request.token,
    request.request,
    undefined,
    name,
  );

  if (!taken.ok) return taken;
  const { adapter, write, text, confirmedAt } = taken.value;
  const stop = watch(write);

  try {
    const body = text === undefined ? undefined : readScheduleBody(text);

    // The text kept with the token is the schedule of this name and of this namespace, or nothing is sent.
    if (!text || !body || body.metadata.name !== name || body.metadata.namespace !== request.namespace)
      return failure("conflict", "read", false, SCHEDULE_CREATE_WORDS.reviewChanged);
    write.status = { step: "reading the locations" };
    const { storage, snapshots } = locationsOf(body);
    const read = await readLocations(adapter, request.namespace, storage, snapshots, write.controller.signal);

    if (!read.ok) return read;
    return await createScheduleKept(dependencies, adapter, request, text, body.spec.paused, confirmedAt, write, still);
  } finally {
    stop();
    dependencies.gate.finish(request.cluster, request.request);
  }
}

// The creation of the schedule whose text the confirmation kept, once the locations were read again: the POST of that
// text, the reads after it, once for a paused schedule, which Velero does not read until it is resumed (REQ-238), and,
// when its answer is not known, the look for the schedule by its name, where it is the one created when it has the
// spec that was sent; another one of that name is a conflict, which the creation did not change (REQ-228). Every end
// of a request that was sent is kept for the cluster (REQ-243).
function createScheduleKept(
  dependencies: CreationDependencies,
  adapter: DiagnosticKubernetes,
  request: WriteRunRequest,
  text: string,
  paused: boolean,
  confirmedAt: number,
  write: Write,
  still: () => boolean,
): Promise<Answer<ScheduleCreated>> {
  const name = String(request.schedule);

  return createKept(
    {
      kind: "Schedule",
      noun: "schedule",
      name,
      create: (to, namespace, body, signal) => to.createSchedule(namespace, body, signal),
      endOf: (error) => endOf(error, request.namespace, name),
      same: (found) => sameSpec(text, found),
      once: paused,
      value: (read, phase, found) => ({
        name: read.metadata.name,
        uid: read.metadata.uid,
        ...(phase ? { phase } : {}),
        ...errorsOf(read),
        ...(paused ? { paused: true } : {}),
        ...(found ? { found: true } : {}),
      }),
      words: {
        cancelled: SCHEDULE_CREATE_WORDS.cancelled,
        frameGone: SCHEDULE_CREATE_WORDS.frameGone,
        frameGoneAfter: SCHEDULE_CREATE_WORDS.frameGoneAfter,
        notDone: SCHEDULE_CREATE_WORDS.notDone(name),
        unknown: SCHEDULE_CREATE_WORDS.unknown(name),
      },
      other: failure("conflict", "creation", false, SCHEDULE_CREATE_WORDS.other(name, request.namespace)),
    },
    dependencies,
    adapter,
    request,
    text,
    confirmedAt,
    write,
    still,
  );
}
