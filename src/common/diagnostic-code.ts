// The codes a failure of the main process is said with, which both processes read: the main process ends
// an operation with one, and the renderer says it. Each is a kind of failure and nothing of what caused it.
export type DiagnosticCode =
  | "validation"
  | "forbidden"
  | "not-found"
  | "conflict"
  | "cancelled"
  | "deadline"
  | "submission-unknown"
  | "artifact-missing"
  | "artifact-invalid"
  | "transport-unreachable"
  | "tls-invalid"
  | "destination-denied"
  | "payload-too-large"
  | "request-failed"
  | "target-changed";
