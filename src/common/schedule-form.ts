// The Schedule the form asks for (SPEC-0016, REQ-223, REQ-225, REQ-226): a `velero.io/v1` Schedule with its name and
// its namespace and no other metadata, no label and no annotation; a spec with the expression, the three flags always
// written, and the template of the form of a backup, of the fields the operator set. The main process builds it at the
// confirmation, from the parameters of the request, and the review shows the text it writes; the run sends that text.

import { bodyText, LABEL_VALUE_LIMIT, SCHEDULE_NAME_LABEL } from "./backup-from-schedule";
import { type BackupTemplate, templateSpec } from "./backup-template";
import { bytesOf, expressionZone, nextInstant, parseExpression, UTC } from "./schedule-adherence";

// The wrapper of the template, as the form gives it: the expression as it was typed, and the three flags, each set to
// true or to false.
export interface ScheduleWrapper {
  expression: string;
  paused: boolean;
  skipImmediately: boolean;
  useOwnerReferencesInBackup: boolean;
}

export interface ScheduleFromForm {
  apiVersion: "velero.io/v1";
  kind: "Schedule";
  metadata: { name: string; namespace: string };
  spec: {
    schedule: string;
    paused: boolean;
    skipImmediately: boolean;
    useOwnerReferencesInBackup: boolean;
    template: Record<string, unknown>;
  };
}

// The bytes of an expression, as the parser of the release counts them.
export const EXPRESSION_BOUND = 1024;

// A DNS-1123 subdomain: labels of lower-case letters, digits and `-`, each beginning and ending with a letter or a
// digit, joined by dots.
const SUBDOMAIN = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?(\.[a-z0-9]([-a-z0-9]*[a-z0-9])?)*$/;
// What the fmt package of Go prints as it is: letters, marks, numbers, punctuation and symbols, and the space of ASCII.
const PRINTABLE = /^[\p{L}\p{M}\p{N}\p{P}\p{S} ]*$/u;

export const SCHEDULE_FORM_WORDS = {
  nameRule: `A name of lower-case letters, digits, "-" and ".", beginning and ending with a letter or a digit, with no "." next to another "." or to a "-", of ${LABEL_VALUE_LIMIT} characters at most, since every backup of the schedule carries its name as the value of the label ${SCHEDULE_NAME_LABEL}.`,
  nameEmpty: "The schedule needs a name.",
  nameLong: (length: number) =>
    `The name has ${length} characters, ${length - LABEL_VALUE_LIMIT} more than ${LABEL_VALUE_LIMIT}: every backup of the schedule carries its name as the value of the label ${SCHEDULE_NAME_LABEL}, which the API server refuses above ${LABEL_VALUE_LIMIT} characters, so Velero would create none.`,
  nameForm: "The name is not one the API server takes.",
  expressionEmpty: "The schedule needs an expression.",
  expressionLong: (bytes: number) =>
    `The expression is written in ${bytes} bytes, more than the ${EXPRESSION_BOUND} the parser of Velero takes.`,
  expressionNotPrintable: "The expression holds a character that is not printable, as a tab or a line break.",
  noInstant:
    "The expression has no instant within five years: Velero would submit a backup at each of its looks, once a minute, whenever none of the backups of the schedule is New, InProgress or without a phase.",
};

// What is wrong with the name of a schedule, in words, or nothing when the API server takes it and every backup of the
// schedule can carry it in its label (SPEC-0016, REQ-225, D3).
export function scheduleNameProblem(name: string): string | undefined {
  if (name === "") return SCHEDULE_FORM_WORDS.nameEmpty;
  if (name.length > LABEL_VALUE_LIMIT) return SCHEDULE_FORM_WORDS.nameLong(name.length);
  return SUBDOMAIN.test(name) ? undefined : SCHEDULE_FORM_WORDS.nameForm;
}

// What the main process refuses of an expression (SPEC-0016, REQ-226, D7): an empty one, one longer than the parser
// takes, one with a character that is not printable, and one with no instant within five years of the time given, by
// the parser of SPEC-0013, as the controller counts from the creation. The rest of the grammar is left to Velero, which
// writes FailedValidation with its words for an expression its parser refuses: the form refuses those as they are
// typed (`expressionRefused`).
export function expressionProblem(expression: string, now: number): string | undefined {
  if (expression === "") return SCHEDULE_FORM_WORDS.expressionEmpty;
  if (bytesOf(expression) > EXPRESSION_BOUND) return SCHEDULE_FORM_WORDS.expressionLong(bytesOf(expression));
  if (!PRINTABLE.test(expression)) return SCHEDULE_FORM_WORDS.expressionNotPrintable;
  const parsed = parseExpression(expression);

  if (parsed.kind === "refused") return undefined;
  // Whether an instant comes hangs on the zone only within hours of the end of a year, since the five years of the
  // controller end with the year of the zone: a zone the runtime does not know is read as UTC.
  const zone = expressionZone(parsed) ?? UTC;
  let next = nextInstant(parsed, now, zone);

  if (next.kind === "zone-not-known") next = nextInstant(parsed, now, UTC);
  return next.kind === "none" ? SCHEDULE_FORM_WORDS.noInstant : undefined;
}

// The words the controller writes for an expression its parser refuses, or nothing when it takes it.
export function expressionRefused(expression: string): string | undefined {
  const parsed = parseExpression(expression);

  return parsed.kind === "refused" ? parsed.reason : undefined;
}

// The Schedule of the form, or nothing when its name, its expression at the time given or its template is refused.
export function scheduleFromForm(
  namespace: string,
  name: string,
  wrapper: ScheduleWrapper,
  template: BackupTemplate,
  now: number,
): ScheduleFromForm | undefined {
  if (scheduleNameProblem(name) !== undefined || expressionProblem(wrapper.expression, now) !== undefined)
    return undefined;
  const spec = templateSpec(template);

  return spec
    ? {
        apiVersion: "velero.io/v1",
        kind: "Schedule",
        metadata: { name, namespace },
        spec: {
          schedule: wrapper.expression,
          paused: wrapper.paused,
          skipImmediately: wrapper.skipImmediately,
          useOwnerReferencesInBackup: wrapper.useOwnerReferencesInBackup,
          template: spec,
        },
      }
    : undefined;
}

// The text of the Schedule of the form, as it is sent: the one writer of every text of the extension.
export function scheduleBodyText(body: ScheduleFromForm): string {
  return bodyText(body);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// The body a text writes, read back: the locations its template names are read again at the run. Nothing when the text
// is not the body of a Schedule of the form.
export function readScheduleBody(text: string): ScheduleFromForm | undefined {
  try {
    const body = JSON.parse(text) as ScheduleFromForm;

    return isRecord(body) &&
      body.kind === "Schedule" &&
      isRecord(body.metadata) &&
      isRecord(body.spec) &&
      isRecord(body.spec.template)
      ? body
      : undefined;
  } catch {
    return undefined;
  }
}
