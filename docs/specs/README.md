# Specifications

Date: 2026-09-25

Status: SPEC-0001, SPEC-0002 and SPEC-0003 are Approved; SPEC-0004 is Implemented.

The [roadmap](../development/ROADMAP.md) owns scope and progress; the
[process](../development/PROCESS.md) owns approvals and review gates.
[AGENTS.md](../../AGENTS.md) owns binding directives, privacy and safety. Use the
[template](TEMPLATE.md) before implementation and retain one independently testable
slice per task even when a spec covers several closely related tasks.

## Spec Index

| Specification | Tasks | Requirement IDs | Status | Runtime evidence |
| --- | --- | --- | --- | --- |
| [SPEC-0001: Local foundation](SPEC-0001-local-foundation.md) | T0.3, T0.4, T0.5, T0.6 separately | REQ-001 through REQ-012 | Approved | 158 tests; local setup, recovery, RBAC and compiled-main transport/cleanup pass; activation in Freelens as an integration test |
| [SPEC-0002: Installation discovery](SPEC-0002-installation-discovery.md) | T1.1 | REQ-013 through REQ-023 | Approved | None |
| [SPEC-0003: States and read-only Backups](SPEC-0003-backup-read-only.md) | T1.2, T1.3 separately | REQ-024 through REQ-037 | Approved | None |
| [SPEC-0004: Test environment on every platform](SPEC-0004-test-environment-every-platform.md) | Foundation | REQ-038 through REQ-049 | Implemented | 96 environment tests; runs on macOS x64 and on the hosted runner, Linux ARM64 |

Next unallocated requirement ID: REQ-050. IDs are unique across this project;
references in test tables do not redefine a requirement. Do not allocate IDs to
unwritten future specs or reuse an ID for a different requirement after approval.

## Remaining Scope

These are existing v1.0.0 commitments from the roadmap, not additional approved
specifications. Draft each at its next design gate, informed by the local proof.

| Scope | Roadmap owner | Dependency |
| --- | --- | --- |
| Restore, Schedule, BSL and VSL read-only views | T1.4, T1.5, T1.6 | Shared states, target discovery and each kind's fields/tests |
| Operational overview | T1.7 | Truthful primary-resource read coverage |
| Diagnostic service and viewers | T2.1 through T2.4 | Foundation transport proof; explicit request creation policy |
| Schedule adherence | T3.1 through T3.3 | Cron/timezone contract and observed backup history |
| Write gate and individual actions | T4.1 through T4.6 | Create-only adapter, exact previews and per-action tests |
| Secondary kinds and server information | T5.1 through T5.3 | Same evidence/permission contracts; request creation is a write |
| Release readiness, docs and media | T6.1 through T6.5 | All agreed features Verified; release on the lead maintainer's go |

## Shared Design

- [ARCHITECTURE.md](../development/ARCHITECTURE.md): process ownership, target model,
  create-only adapter, errors, transport/security and later action constraints.
- [DESIGN.md](../development/DESIGN.md): operator journeys, native/custom presentation,
  status semantics, navigation, accessibility and visual review targets.
- [TESTING.md](../development/TESTING.md): local tiers, fixture ownership, prerequisites,
  synthetic-data policy, performance budgets and evidence gates.
- [RECON-T0.1.md](../development/RECON-T0.1.md): source-confirmed contracts and version
  pins; not a runtime compatibility certificate.

The design documents are proposals pending the relevant spec approvals. Safety
and privacy rules are already binding.

## Approval And Completion

Lifecycle: Draft, Approved, Implemented, Verified; Superseded retains a link to its
replacement. A Draft spec is not approval to implement.

Record approval by role/date and exact scope, not individual names. Completing one
task does not close the whole spec if its other tasks or tests remain open. A spec
becomes Verified only when its non-regression tests run green in CI on main, all
acceptance checks pass with evidence and required manual judgment is recorded.

SPEC-0001 approval was recorded on 2026-09-18. T0.3 through T0.6 are complete;
T0.5/T0.6 completed on 2026-09-25. The FND-10 actual-host activation check is an
integration test since 2026-09-27. The Node transport proof does not close
actual-host acceptance.

SPEC-0002 and SPEC-0003 approval was recorded on 2026-09-27, as drafted. They are
the first milestone: T1.1, T1.2 and T1.3, each its own pull request.

SPEC-0004 approval was recorded on 2026-09-27, with its one open question decided:
the published loopback is accepted on the machines of the developers.

## Document Review

This is document coverage, not test execution:

| Criterion | Initial draft coverage |
| --- | --- |
| Scope and exclusions | Each spec names its roadmap tasks and deferred owners |
| User outcomes | Prioritized Given/When/Then journeys and observable success criteria |
| Requirement identity | 37 unique sequential IDs across the three drafts |
| Test traceability | Every requirement has a named acceptance check and test layer |
| Safety and privacy | Local-only writes, exact targets, no implicit requests, synthetic evidence |
| UI decisions | Native lists plus dedicated operation workspace, with non-happy and accessible states |
| Source grounding | Every draft carries exact reviewed revisions and recon dependencies |
| Honest status | SPEC-0001 is Approved with setup, fixture and compiled-main transport evidence; SPEC-0002 and SPEC-0003 are Approved without implementation; SPEC-0004 is Implemented |

No blocking product preference is required to review these drafts. Fixture isolation
and main transport have scoped local evidence. Actual-host authentication, IPC
sender/catalog integration and automatic route resolution remain unverified, not
assumptions promoted to supported product behavior.
