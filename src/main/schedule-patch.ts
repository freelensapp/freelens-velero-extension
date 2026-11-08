// The pause and the resume of a schedule (SPEC-0017, REQ-275, REQ-277, D6, D7). The confirmation writes the JSON patch
// of the action once, from the schedule of the review by its name and its UID and, for a resume, the expression the
// review read and the value of `skipImmediately` chosen: the review shows that text and the token keeps it. The run
// sends the text byte for byte, once, with the method in capitals and the media type of a JSON patch, then reads the
// schedule once and answers what the patch wrote. The tests of the patch are the check of what the review read: the API
// server answers a failed test with 422, and the schedule is read then, so that one that changed since the review is
// said as a conflict. A patch whose answer is not known is never sent again: the schedule is read, and its state said.

import { type Answer, failure, type ScheduleChanged, textWithinBound, type WriteConfirmAnswer } from "../common/ipc";
import { patchText, pausePatch, readSchedulePatch, resumePatch } from "../common/schedule-patch";
import { type CreationDependencies, sent } from "./creation";
import { DiagnosticError } from "./diagnostic-transport";

import type { WriteConfirmRequest, WriteRunRequest } from "../common/ipc";
import type { DiagnosticKubernetes, DiagnosticObject } from "./diagnostic-kubernetes";
import type { Write } from "./write-gate";

// How long the read of the schedule after a patch, or after a patch whose answer is not known, may last.
const READ_AFTER_MS = 10_000;

export const SCHEDULE_PATCH_WORDS = {
  notAPatch:
    "The request is not one of a pause or of a resume: each is asked of one schedule, by its name, and a resume with the expression its review read and the choice of skipping a run. Nothing was sent.",
  tooLarge: (characters: number) =>
    `The patch is written in ${characters} characters, more than a review carries: nothing was confirmed.`,
  reviewChanged:
    "The patch the run would send is not the one the review showed: nothing was sent. Ask for a new review.",
  // The API server refused a test of the patch: the schedule is not as the review read it.
  changed: (schedule: string) =>
    `The schedule ${schedule} changed since the review, and was not patched. Go back to its view, which reads it again.`,
  gone: (schedule: string, namespace: string) =>
    `The schedule ${schedule} is not in ${namespace} any more, or the API server does not serve the kind Schedule of Velero there: nothing was patched.`,
  forbidden: (namespace: string) =>
    `The identity of this cluster may not patch schedules in ${namespace}: nothing was patched. The command line of the release replaces the whole schedule, with the verb update; this extension patches it, and needs the verb patch.`,
  credential:
    "The cluster did not take the credential of the context: it may have expired. Sign in again, then ask again. Nothing was patched.",
  rejected: "The API server refused the patch as written: nothing was patched.",
  unsent: "The patch could not be written for the cluster: nothing was sent.",
  declined: "The API server did not take the patch, for a reason the extension does not name: nothing was patched.",
  conflict: (schedule: string) =>
    `The API server answered that the schedule ${schedule} was being changed: nothing was patched. Go back to its view, which reads it again.`,
  targetChanged: "The cluster changed: nothing was sent to it.",
  cancelled: "The write was cancelled: nothing was sent.",
  unreachable: "The API server could not be reached: nothing was sent. Asking again is safe.",
  frameGone: "The frame that asked for the write is not there any more: nothing was sent.",
  frameGoneAfter: "The frame that asked for the write is not there any more.",
  changedAfter: (schedule: string) =>
    `The cluster changed while it answered the patch: its answer is not used, and the schedule ${schedule} may have been patched. It is not sent again by itself: its view says whether it is paused.`,
  // The answer of the patch was lost: the schedule is read, and what the read shows is said.
  unknown: (schedule: string) =>
    `The API server did not answer the patch, and the schedule ${schedule} could not be read: it may have been patched. It is not sent again by itself: its view says whether it is paused.`,
  unknownRead: (schedule: string, paused: boolean) =>
    `The API server did not answer the patch, and the schedule ${schedule} is ${paused ? "paused" : "not paused"} as far as the read shows: whether this patch did it is not known. It is not sent again by itself.`,
  failed: "The pause or the resume could not be asked: nothing is known to have been patched.",
};

// The state of a schedule as a pause or a resume answers it: whether it is paused, what `skipImmediately` holds, and
// the time Velero wrote it skipped a run, once it read the schedule.
function changedOf(schedule: DiagnosticObject): ScheduleChanged {
  const spec = (schedule.spec ?? {}) as { paused?: unknown; skipImmediately?: unknown };
  const lastSkipped = (schedule.status as { lastSkipped?: unknown } | undefined)?.lastSkipped;

  return {
    name: schedule.metadata.name,
    uid: schedule.metadata.uid,
    paused: spec.paused === true,
    ...(typeof spec.skipImmediately === "boolean" ? { skipImmediately: spec.skipImmediately } : {}),
    ...(typeof lastSkipped === "string" && lastSkipped.length <= 64 ? { lastSkipped } : {}),
  };
}

// The end of a patch that failed, in the words of this write, with whether asking again is safe: it is where nothing
// was sent and what stopped it may pass.
function endOf(error: unknown, namespace: string, schedule: string): Answer<never> {
  if (!(error instanceof DiagnosticError))
    return failure("request-failed", "patch", false, SCHEDULE_PATCH_WORDS.failed);
  switch (error.code) {
    case "not-found":
      return failure("not-found", "patch", false, SCHEDULE_PATCH_WORDS.gone(schedule, namespace));
    case "forbidden":
      // A credential the cluster does not take says nothing of what the identity may do.
      if (error.verdict === "credential")
        return failure("request-failed", "patch", true, SCHEDULE_PATCH_WORDS.credential);
      return failure("forbidden", "patch", false, SCHEDULE_PATCH_WORDS.forbidden(namespace));
    case "conflict":
      return failure("conflict", "patch", false, SCHEDULE_PATCH_WORDS.conflict(schedule));
    case "validation":
      // The API server refused the patch, for another reason than a test; or the adapter refused to send it.
      return failure(
        "validation",
        "patch",
        false,
        error.verdict === "refused" ? SCHEDULE_PATCH_WORDS.rejected : SCHEDULE_PATCH_WORDS.unsent,
      );
    case "target-changed":
      if (error.verdict === "answered")
        return failure("submission-unknown", "patch", false, SCHEDULE_PATCH_WORDS.changedAfter(schedule));
      return failure("target-changed", "patch", false, SCHEDULE_PATCH_WORDS.targetChanged);
    case "cancelled":
      return failure("cancelled", "patch", true, SCHEDULE_PATCH_WORDS.cancelled);
    case "transport-unreachable":
      return failure("transport-unreachable", "patch", true, SCHEDULE_PATCH_WORDS.unreachable);
    case "request-failed":
      return failure("request-failed", "patch", false, SCHEDULE_PATCH_WORDS.declined);
    default:
      return failure(error.code, "patch", false, SCHEDULE_PATCH_WORDS.failed);
  }
}

// The schedule read once, with a signal of its own, which a write that stopped does not end: what is read, or the
// error of the read.
async function readOnce(
  adapter: DiagnosticKubernetes,
  namespace: string,
  schedule: string,
): Promise<{ read: DiagnosticObject } | { error: unknown }> {
  try {
    return { read: await adapter.read("Schedule", namespace, schedule, AbortSignal.timeout(READ_AFTER_MS)) };
  } catch (error) {
    return { error };
  }
}

// The confirmation: a pause or a resume of one schedule, the gate open for the namespace, and the patch written as the
// text the review shows and the run sends. Nothing is read: the tests of the patch are the check (REQ-275).
export async function confirmSchedulePatch(
  dependencies: CreationDependencies,
  sender: string,
  request: WriteConfirmRequest,
  _signal: AbortSignal,
): Promise<Answer<WriteConfirmAnswer>> {
  const { target, kind, resume } = request;

  if (
    target?.kind !== "Schedule" ||
    (kind !== "schedule-pause" && kind !== "schedule-resume") ||
    (kind === "schedule-resume") !== (resume !== undefined)
  )
    return failure("validation", "request", false, SCHEDULE_PATCH_WORDS.notAPatch);
  const opened = dependencies.gate.opened(request.cluster, request.namespace);

  if (!opened.ok) return opened;
  const text = patchText(resume ? resumePatch(target.uid, resume) : pausePatch(target.uid));

  if (!textWithinBound(text)) return failure("validation", "review", false, SCHEDULE_PATCH_WORDS.tooLarge(text.length));
  const confirmed = dependencies.gate.confirm(sender, request.cluster, request.namespace, kind, target, undefined, {
    name: target.name,
    text,
  });

  return confirmed.ok ? { ok: true, value: { ...confirmed.value, text } } : confirmed;
}

// The run: the token of the confirmation, the frame that asked still there, the text sent byte for byte, and the read
// after it. The caller watches the frame and ends the write.
export async function runSchedulePatch(
  dependencies: CreationDependencies,
  sender: string,
  request: WriteRunRequest,
  watch: (write: Write) => () => void,
  still: () => boolean = () => true,
): Promise<Answer<ScheduleChanged>> {
  const { target, kind } = request;

  if (target?.kind !== "Schedule" || (kind !== "schedule-pause" && kind !== "schedule-resume"))
    return failure("validation", "request", false, SCHEDULE_PATCH_WORDS.notAPatch);
  const taken = dependencies.gate.take(
    sender,
    request.cluster,
    request.namespace,
    kind,
    target,
    request.token,
    request.request,
    undefined,
    target.name,
  );

  if (!taken.ok) return taken;
  const { adapter, write, text } = taken.value;
  const stop = watch(write);
  const signal = write.controller.signal;
  // Every end of a request that was sent is kept for the cluster, and is answered to the frame that asked when it is
  // still there.
  const ended = (end: Answer<ScheduleChanged>): Answer<ScheduleChanged> => {
    try {
      dependencies.keep?.(request, end, adapter.binding?.contextName ?? "");
    } catch {
      /* the end is answered all the same */
    }
    return still() ? end : failure("forbidden", "frame", false, SCHEDULE_PATCH_WORDS.frameGoneAfter);
  };

  try {
    const patch = text === undefined ? undefined : readSchedulePatch(text);

    // The text kept with the token is the patch of this action, of the schedule of this UID, or nothing is sent.
    if (!text || !patch || patch.action !== kind || patch.uid !== target.uid)
      return failure("conflict", "review", false, SCHEDULE_PATCH_WORDS.reviewChanged);
    if (signal.aborted) return failure("cancelled", "patch", true, SCHEDULE_PATCH_WORDS.cancelled);
    if (!still()) return failure("forbidden", "frame", false, SCHEDULE_PATCH_WORDS.frameGone);
    write.status = { step: kind === "schedule-pause" ? "pausing the schedule" : "resuming the schedule" };
    let patched: DiagnosticObject;

    try {
      patched = await adapter.patchSchedule(request.namespace, target.name, text, signal);
    } catch (error) {
      // No answer, or one dropped on this side once the request had left: the schedule is read, and what it shows is
      // said; nothing is sent again.
      if (error instanceof DiagnosticError && (error.code === "submission-unknown" || error.code === "cancelled")) {
        write.status = { step: "reading the schedule" };
        const looked = await readOnce(adapter, request.namespace, target.name);

        return ended(
          failure(
            "submission-unknown",
            "patch",
            false,
            "read" in looked && looked.read.metadata.uid === target.uid
              ? SCHEDULE_PATCH_WORDS.unknownRead(target.name, changedOf(looked.read).paused)
              : SCHEDULE_PATCH_WORDS.unknown(target.name),
          ),
        );
      }
      // A 422 is a test that failed as well: the schedule is read, and one that is not as the patch tested changed
      // since the review.
      if (error instanceof DiagnosticError && error.code === "validation" && error.verdict === "refused") {
        write.status = { step: "reading the schedule" };
        const looked = await readOnce(adapter, request.namespace, target.name);

        if ("error" in looked) {
          const missing = looked.error instanceof DiagnosticError && looked.error.code === "not-found";

          return ended(
            missing
              ? failure("not-found", "patch", false, SCHEDULE_PATCH_WORDS.gone(target.name, request.namespace))
              : failure("validation", "patch", false, SCHEDULE_PATCH_WORDS.rejected),
          );
        }
        const spec = (looked.read.spec ?? {}) as { paused?: unknown; schedule?: unknown };
        const changed =
          looked.read.metadata.uid !== target.uid ||
          (patch.action === "schedule-resume" && (spec.paused !== true || spec.schedule !== patch.expression));

        return ended(
          changed
            ? failure("conflict", "patch", false, SCHEDULE_PATCH_WORDS.changed(target.name))
            : failure("validation", "patch", false, SCHEDULE_PATCH_WORDS.rejected),
        );
      }
      const end = endOf(error, request.namespace, target.name);

      return sent(error) ? ended(end) : end;
    }
    if (patched.metadata.name !== target.name || patched.metadata.uid !== target.uid)
      return ended(failure("submission-unknown", "patch", false, SCHEDULE_PATCH_WORDS.unknown(target.name)));
    // The read after a 200 of a patch (REQ-248, REQ-277): the schedule once, by its UID, and what the patch wrote as it
    // reads; the answer of the patch when the read does not answer.
    write.status = { step: "reading the schedule" };
    const looked = await readOnce(adapter, request.namespace, target.name);
    const read = "read" in looked && looked.read.metadata.uid === target.uid ? looked.read : patched;

    return ended({ ok: true, value: changedOf(read) });
  } finally {
    stop();
    dependencies.gate.finish(request.cluster, request.request);
  }
}
