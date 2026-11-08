// The pause and the resume of a schedule (SPEC-0017, REQ-275, REQ-277, D6, D7). The confirmation writes the JSON patch
// of the action once, from the schedule of the review by its name and its UID and, for a resume, the expression the
// review read and the value of `skipImmediately` chosen: the review shows that text and the token keeps it. The run
// sends the text byte for byte, once, with the method in capitals and the media type of a JSON patch, then reads the
// schedule once and answers what the patch wrote, as the read shows it. The tests of the patch are the check of what the
// review read: the API server answers a failed test with 422, and the schedule is read then, so that one that changed
// since the review is said as a conflict. A patch whose answer is not known is never sent again: the schedule is read by
// the fields the patch wrote, and what it shows is said (REQ-250).

import { type Answer, failure, type ScheduleChanged, textWithinBound, type WriteConfirmAnswer } from "../common/ipc";
import { patchText, pausePatch, readSchedulePatch, resumePatch } from "../common/schedule-patch";
import { CREATION_MARGIN, type CreationDependencies, sent } from "./creation";
import { DiagnosticError } from "./diagnostic-transport";

import type { WriteConfirmRequest, WriteRunRequest } from "../common/ipc";
import type { SchedulePatch } from "../common/schedule-patch";
import type { DiagnosticKubernetes, DiagnosticObject } from "./diagnostic-kubernetes";
import type { Write } from "./write-gate";

// How long the read of the schedule after a patch, or after a patch whose answer is not known, may last.
const READ_AFTER_MS = 10_000;

// The characters of an expression that the API server writes in another form than the text of the patch: `<`, `>` and
// `&`, which Go escapes, the line and the paragraph separators, which it always escapes, and the backspace and the form
// feed, which it escapes in one form or in another by its version. The test of the expression compares the two forms
// byte for byte, and would never pass (json-patch v4.12.0 of the API server, `lazyNode.equal`).
const UNTESTABLE = new Set(["<", ">", "&", "\u2028", "\u2029", "\b", "\f"]);

export const SCHEDULE_PATCH_WORDS = {
  notAPatch:
    "The request is not one of a pause or of a resume: each is asked of one schedule, by its name, and a resume with the expression its review read and the choice of skipping a run. Nothing was sent.",
  untestable:
    "The expression of the schedule holds a character that the API server writes in another form than this extension, so the test of the expression in the patch would never pass: nothing was confirmed. The velero command line resumes it with an update of the whole schedule.",
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
    `The identity of this cluster may not patch schedules in ${namespace}: nothing was patched. The velero command line replaces the whole schedule, with the verb update; this extension patches it, and needs the verb patch.`,
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
  // The API server answered the patch with another schedule: its answer is not used.
  strange: (schedule: string) =>
    `The API server answered the patch with another schedule than ${schedule}: its answer is not used, and the schedule may have been patched. It is not sent again by itself: its view says whether it is paused.`,
  // The patch was applied, and the read after it shows the schedule otherwise.
  changedSince: (schedule: string, pause: boolean) =>
    `The API server applied the ${pause ? "pause" : "resume"}, and the read after it shows the schedule ${schedule} ${pause ? "not paused" : "otherwise than the patch wrote it"}: it was changed since. Go back to its view, which reads it again.`,
  // The answer of the patch was lost, and the schedule is read by the fields the patch wrote: not done as far as the read
  // shows, something else, or a read that does not say (REQ-250). Done is said as the end of the action.
  notDone: (schedule: string, pause: boolean) =>
    `The API server did not answer the ${pause ? "pause" : "resume"}, and the schedule ${schedule} is ${pause ? "not paused" : "still paused"} as far as the read shows. It is not sent again by itself: asking again is a new review.`,
  other: (schedule: string) =>
    `The API server did not answer the resume, and the schedule ${schedule} is not paused, but does not hold what the patch wrote: whether this patch resumed it is not known. It is not sent again by itself: its view says what it holds.`,
  replaced: (schedule: string) =>
    `The API server did not answer the patch, and the schedule named ${schedule} is another one now, created again under its name: the patch, which tests that the schedule is the one reviewed, did not change it.`,
  goneAfter: (schedule: string, namespace: string) =>
    `The API server did not answer the patch, and the schedule ${schedule} is not in ${namespace} any more.`,
  unknown: (schedule: string) =>
    `The API server did not answer the patch, and the schedule ${schedule} could not be read: it may have been patched. It is not sent again by itself: its view says whether it is paused.`,
  failed: "The pause or the resume could not be asked: nothing is known to have been patched.",
};

// The time Velero wrote that it skipped a run of the schedule, when it is not earlier than a minute before the
// confirmation, the margin of SPEC-0016 for the clocks: an older one is of another resume.
function skippedSince(schedule: DiagnosticObject, confirmedAt: number): string | undefined {
  const lastSkipped = (schedule.status as { lastSkipped?: unknown } | undefined)?.lastSkipped;

  if (typeof lastSkipped !== "string" || lastSkipped.length > 64) return undefined;
  return Date.parse(lastSkipped) >= confirmedAt - CREATION_MARGIN ? lastSkipped : undefined;
}

// What the schedule holds of what the patch wrote, when it holds it (REQ-250, REQ-277): paused, for a pause; for a
// resume, not paused, with `skipImmediately` as written or, when it was written true, set back to false by Velero,
// which wrote then that it skipped the run, since the confirmation. Nothing, when the schedule holds something else.
function writtenOf(schedule: DiagnosticObject, patch: SchedulePatch, confirmedAt: number): ScheduleChanged | undefined {
  const spec = (schedule.spec ?? {}) as { paused?: unknown; skipImmediately?: unknown };
  const { name, uid } = schedule.metadata;

  if (patch.action === "schedule-pause") return spec.paused === true ? { name, uid, paused: true } : undefined;
  if (spec.paused !== false) return undefined;
  if (spec.skipImmediately === patch.skipImmediately)
    return { name, uid, paused: false, skipImmediately: patch.skipImmediately };
  // Written true, and set back to false: Velero read the schedule and skipped the run.
  const lastSkipped = skippedSince(schedule, confirmedAt);

  return spec.skipImmediately === false && lastSkipped !== undefined
    ? { name, uid, paused: false, skipImmediately: false, lastSkipped }
    : undefined;
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

// What a patch whose answer is not known ended as, by the read of its schedule (REQ-250): done as reviewed, when the
// schedule holds what the patch wrote; not done as far as the read shows, when it is not paused after a pause, or still
// paused after a resume; or something else: another schedule of its name, none, or a resume it does not hold.
function lostOf(
  looked: { read: DiagnosticObject } | { error: unknown },
  patch: SchedulePatch,
  namespace: string,
  schedule: string,
  confirmedAt: number,
): Answer<ScheduleChanged> {
  if ("error" in looked)
    return failure(
      "submission-unknown",
      "patch",
      false,
      looked.error instanceof DiagnosticError && looked.error.code === "not-found"
        ? SCHEDULE_PATCH_WORDS.goneAfter(schedule, namespace)
        : SCHEDULE_PATCH_WORDS.unknown(schedule),
    );
  if (looked.read.metadata.uid !== patch.uid)
    return failure("submission-unknown", "patch", false, SCHEDULE_PATCH_WORDS.replaced(schedule));
  const written = writtenOf(looked.read, patch, confirmedAt);

  if (written) return { ok: true, value: { ...written, found: true } };
  const pause = patch.action === "schedule-pause";
  const paused = (looked.read.spec as { paused?: unknown } | undefined)?.paused === true;

  return failure(
    "submission-unknown",
    "patch",
    false,
    pause === paused ? SCHEDULE_PATCH_WORDS.other(schedule) : SCHEDULE_PATCH_WORDS.notDone(schedule, pause),
  );
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
  if (resume && [...resume.expression].some((character) => UNTESTABLE.has(character)))
    return failure("validation", "request", false, SCHEDULE_PATCH_WORDS.untestable);
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
  const { adapter, write, text, confirmedAt } = taken.value;
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
    const pause = patch.action === "schedule-pause";

    write.status = { step: pause ? "pausing the schedule" : "resuming the schedule" };
    let patched: DiagnosticObject;

    try {
      patched = await adapter.patchSchedule(request.namespace, target.name, text, signal);
    } catch (error) {
      // No answer, or one dropped on this side once the request had left: the schedule is read by the fields the patch
      // wrote, and what it shows is said; nothing is sent again.
      if (error instanceof DiagnosticError && (error.code === "submission-unknown" || error.code === "cancelled")) {
        write.status = { step: "reading the schedule" };
        return ended(
          lostOf(
            await readOnce(adapter, request.namespace, target.name),
            patch,
            request.namespace,
            target.name,
            confirmedAt,
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
      return ended(failure("submission-unknown", "patch", false, SCHEDULE_PATCH_WORDS.strange(target.name)));
    // The read after a 200 of a patch (REQ-248, REQ-277): the schedule once, by its UID, and what the patch wrote as it
    // reads; the answer of the patch when the read does not answer, or is of another schedule of its name. A schedule
    // that does not hold what the patch wrote was changed since.
    write.status = { step: "reading the schedule" };
    const looked = await readOnce(adapter, request.namespace, target.name);
    const written = writtenOf(
      "read" in looked && looked.read.metadata.uid === target.uid ? looked.read : patched,
      patch,
      confirmedAt,
    );

    return ended(
      written
        ? { ok: true, value: written }
        : failure("conflict", "patch", false, SCHEDULE_PATCH_WORDS.changedSince(target.name, pause)),
    );
  } finally {
    stop();
    dependencies.gate.finish(request.cluster, request.request);
  }
}
