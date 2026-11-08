// The pause and the resume of a schedule (SPEC-0017, REQ-275, D6, D7): each is one JSON patch of the Schedule, whose
// tests are the check of what the review read. A pause tests the UID and adds `spec.paused` true: a schedule that is not
// paused may carry no `paused` at all, and a test cannot test what is absent, so a pause that finds the schedule paused
// already leaves it as it was. A resume tests the UID, that the schedule is paused and that its expression is the one
// the review read, then replaces `paused` with false and adds `skipImmediately` with the value chosen. The main process
// builds the patch at the confirmation; the review shows the text it writes, and the run sends that text.

import { bodyText } from "./backup-from-schedule";

// The two actions on a schedule, as the contract names them.
export type ScheduleAction = "schedule-pause" | "schedule-resume";

// What a resume writes beside the tests: the expression the review read, which the patch tests, and the value of
// `skipImmediately` the operator chose.
export interface ResumeParameters {
  expression: string;
  skipImmediately: boolean;
}

export type PatchOperation =
  | { op: "test"; path: string; value: unknown }
  | { op: "add"; path: string; value: unknown }
  | { op: "replace"; path: string; value: unknown };

// The patch of a pause of the schedule of this UID.
export function pausePatch(uid: string): PatchOperation[] {
  return [
    { op: "test", path: "/metadata/uid", value: uid },
    { op: "add", path: "/spec/paused", value: true },
  ];
}

// The patch of a resume of the schedule of this UID, paused, with the expression the review read.
export function resumePatch(uid: string, resume: ResumeParameters): PatchOperation[] {
  return [
    { op: "test", path: "/metadata/uid", value: uid },
    { op: "test", path: "/spec/paused", value: true },
    { op: "test", path: "/spec/schedule", value: resume.expression },
    { op: "replace", path: "/spec/paused", value: false },
    { op: "add", path: "/spec/skipImmediately", value: resume.skipImmediately },
  ];
}

// The text of a patch, as it is sent: the one writer of every text of the extension.
export function patchText(patch: PatchOperation[]): string {
  return bodyText(patch);
}

// What a text of a patch is, read back: the action and what it tests and writes, or nothing when it is not exactly the
// patch of a pause or of a resume.
export function readSchedulePatch(
  text: string,
):
  | { action: "schedule-pause"; uid: string }
  | ({ action: "schedule-resume"; uid: string } & ResumeParameters)
  | undefined {
  let patch: unknown;

  try {
    patch = JSON.parse(text);
  } catch {
    return undefined;
  }
  // The text of what is read is compared whole with the text of the patch it would be: nothing else passes.
  if (!Array.isArray(patch)) return undefined;
  const uid = (patch[0] as PatchOperation | undefined)?.value;

  if (typeof uid !== "string" || uid === "") return undefined;
  if (patch.length === 2 && patchText(patch) === patchText(pausePatch(uid))) return { action: "schedule-pause", uid };
  const expression = (patch[2] as PatchOperation | undefined)?.value;
  const skipImmediately = (patch[4] as PatchOperation | undefined)?.value;

  if (patch.length !== 5 || typeof expression !== "string" || typeof skipImmediately !== "boolean") return undefined;
  const resume = { expression, skipImmediately };

  return patchText(patch) === patchText(resumePatch(uid, resume))
    ? { action: "schedule-resume", uid, ...resume }
    : undefined;
}
