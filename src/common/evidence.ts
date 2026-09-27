import type { OperationState } from "./phases";

// A counter as the object reports it. One that is missing or not a count is not a zero.
export type Count = { reported: true; value: number } | { reported: false; raw?: unknown };

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

export function count(value: unknown): Count {
  if (value === undefined || value === null) return { reported: false };
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) return { reported: true, value };
  return { reported: false, raw: value };
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
  const errors = count(status?.errors);
  const warnings = count(status?.warnings);
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
  if (state.lifecycle === "terminal" && !errors.reported) gaps.push("The number of errors is not reported");
  if (state.lifecycle === "terminal" && !warnings.reported) gaps.push("The number of warnings is not reported");

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
