import type { OperationState } from "./phases";

// A counter of the status. The release writes no counter of zero: one that is missing after the release
// counted is its zero, and is told from a zero that is written. One that is missing before the release
// counted, or that is not a count, is not a zero.
export type Count = { reported: true; value: number; written: boolean } | { reported: false; raw?: unknown };

export type FailureSignal = "failure" | "warnings" | "none" | "unknown";

export interface OperationEvidence {
  errors: Count;
  warnings: Count;
  validationErrors: string[];
  failureReason?: string;
  // What the object reports against its own phase. Shown, never resolved in favour of one side.
  contradictions: string[];
  // What would be needed to say more, and the object does not report.
  gaps: string[];
  signal: FailureSignal;
}

// `counted` says that the release counted what the counter is of: a counter that is missing is then the
// zero the release does not write.
export function count(value: unknown, counted = false): Count {
  if (value === undefined || value === null) {
    return counted ? { reported: true, value: 0, written: false } : { reported: false };
  }
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) {
    return { reported: true, value, written: true };
  }
  return { reported: false, raw: value };
}

// Counters the release writes together. Once it counted, or one of them is in the object as a count, the
// ones that are missing are the zeros it does not write.
export function counts<Name extends string>(values: Record<Name, unknown>, counted: boolean): Record<Name, Count> {
  const names = Object.keys(values) as Name[];
  const written = names.some((name) => count(values[name]).reported);

  return Object.fromEntries(names.map((name) => [name, count(values[name], counted || written)])) as Record<
    Name,
    Count
  >;
}

// Counters are worth a line when one of them counts something, or holds what is not a count.
export function counting(values: Record<string, Count>): boolean {
  return Object.values(values).some((value) => (value.reported ? value.value > 0 : value.raw !== undefined));
}

function texts(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string" && entry !== "")
    : [];
}

export function operationEvidence(
  state: OperationState,
  status:
    | { errors?: unknown; warnings?: unknown; validationErrors?: unknown; failureReason?: unknown }
    | null
    | undefined,
): OperationEvidence {
  // The release writes the two counters together: with one of them in the object, the other was counted.
  const { errors, warnings } = counts({ errors: status?.errors, warnings: status?.warnings }, state.counted);
  const validationErrors = texts(status?.validationErrors);
  const failureReason =
    typeof status?.failureReason === "string" && status.failureReason !== "" ? status.failureReason : undefined;
  const reportedErrors = errors.reported && errors.value > 0;
  const reportedWarnings = warnings.reported && warnings.value > 0;
  const contradictions: string[] = [];
  const gaps: string[] = [];

  if (state.failure === "none" && state.lifecycle === "terminal") {
    if (reportedErrors) contradictions.push("The phase is Completed and the object reports errors");
    if (validationErrors.length) contradictions.push("The phase is Completed and the object reports validation errors");
    if (failureReason) contradictions.push("The phase is Completed and the object reports a failure reason");
  }
  if (state.failure === "validation" && !validationErrors.length) {
    gaps.push("The phase is a failed validation and the object reports no validation error");
  }
  if ((state.failure === "failed" || state.failure === "partial") && !reportedErrors && !failureReason) {
    gaps.push("The phase carries a failure and the object reports neither errors nor a reason");
  }
  // A counter that holds what is not a count says nothing, and is said as it is.
  if (!errors.reported && errors.raw !== undefined) gaps.push("The number of errors is not a count");
  if (!warnings.reported && warnings.raw !== undefined) gaps.push("The number of warnings is not a count");

  const failing =
    state.failure === "partial" ||
    state.failure === "failed" ||
    state.failure === "validation" ||
    reportedErrors ||
    validationErrors.length > 0 ||
    failureReason !== undefined;
  // Without a recognized phase the absence of errors says nothing about the operation.
  const signal: FailureSignal = failing
    ? "failure"
    : state.lifecycle === "unknown" || state.failure === "unknown"
      ? "unknown"
      : reportedWarnings
        ? "warnings"
        : "none";

  return { errors, warnings, validationErrors, failureReason, contradictions, gaps, signal };
}
