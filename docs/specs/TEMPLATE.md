# SPEC-NNNN: Short Title

- **Status:** Draft
- **Date:** YYYY-MM-DD
- **Milestone / tasks:** Mn / Tn.n
- **Reviewed Velero:** exact release tag and commit
- **Reviewed main:** exact comparison commit, or not relevant with a reason
- **Freelens validation target:** exact version and commit
- **Dependencies:** approved specs or existing evidence
- **Approval:** Pending; later record role, date, scope, and verdict without names

Governed by [AGENTS.md](../../AGENTS.md). Use the [index](README.md) to allocate
unique REQ-XXX identifiers. A completed draft is not approval to implement.

## Goal

State the operator outcome and why it matters in one or two sentences.

## Scope Baseline

State discovery method and evidence links; count relevant resources/workflows and
identify this slice. List included items, explicit exclusions and their roadmap
owners. Do not silently remove part of the agreed v1.0.0 scope.

## User Scenarios

Describe independently testable journeys, ordered by priority. For each give a
concrete Given / When / Then and its expected observable result, including at least
one non-happy scenario. Include developer/operator actors only where relevant.

## Requirements

| ID | Contract | Acceptance check |
| --- | --- | --- |
| REQ-XXX | One testable requirement, with explicit success/failure behavior | Stable check ID from the test table |

Define every requirement exactly once. References in the tests must cover every ID.
Specify privacy, cluster isolation, lifecycle semantics and write/read boundaries
where applicable. Avoid unverifiable words such as fast, intuitive or robust alone.

## Design

State entities, fields read/written, extension points, main/renderer boundary,
permission/error contracts and UI presentation. Link shared decisions from
[ARCHITECTURE.md](../development/ARCHITECTURE.md) rather than duplicating them.
Explain the native or custom presentation using [DESIGN.md](../development/DESIGN.md).
Cover loading, empty, restricted, partial, stale, unknown and failure states; both
themes, keyboard navigation, cancellation and changed-target behavior as applicable.

## Tests

| Check | Layer | Requirements | Scenario and expected evidence |
| --- | --- | --- | --- |
| UNIQUE-01 | Unit, component, local integration, or packaged app | REQ-XXX | Concrete case and observable assertion |

Use [TESTING.md](../development/TESTING.md). Name planned test homes and fixture
families without creating empty test files. Keep unknown enum cases in mocks when
the real CRD schema rejects them. State what needs a real controller or packaged app.

## Success Criteria

Give measurable user outcomes, relevant performance/data-size budgets and explicit
failure criteria. Specify exact manual steps and expected result when automated
evidence cannot settle a requirement. Tests not run are unverified, not passed.

## Assumptions And Decisions

Document reasonable defaults, selected options and why they serve the agreed scope.
Separate pending approval from technical proof that belongs to a later step.
Use a NEEDS CLARIFICATION marker only for a decision with no reasonable default;
at most three such markers, each with a concrete question and affected requirement.

## Evidence And Deviations

Initially: no implementation, tests or runtime evidence. Later record command,
exit code, counts, versions, synthetic artifact reference, cleanup result and
remaining gaps. Keep actual environment data outside project files and agent output.
Document every deviation and its approval before claiming Verified.
