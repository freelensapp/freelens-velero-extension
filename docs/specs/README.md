# Specifications

Date: 2026-09-25

Status: SPEC-0001 approved for stepwise implementation; SPEC-0002 and SPEC-0003 remain Draft.

The [roadmap](../development/PLAN.md) owns task progress and step authorization.
[AGENTS.md](../../AGENTS.md) owns binding directives, privacy and safety. Use the
[template](TEMPLATE.md) before implementation and retain one independently testable
slice per task even when a spec covers several closely related tasks.

## Spec Index

| Specification | Tasks | Requirement IDs | Status | Runtime evidence |
| --- | --- | --- | --- | --- |
| [SPEC-0001: Local foundation](SPEC-0001-local-foundation.md) | T0.3, T0.4, T0.5, T0.6 separately | REQ-001 through REQ-012 | Approved | 118 tests; local setup, recovery, RBAC and compiled-main transport/cleanup pass; actual Freelens activation pending |
| [SPEC-0002: Installation discovery](SPEC-0002-installation-discovery.md) | T1.1 | REQ-013 through REQ-023 | Draft | None |
| [SPEC-0003: States and read-only Backups](SPEC-0003-backup-read-only.md) | T1.2, T1.3 separately | REQ-024 through REQ-037 | Draft | None |

Next unallocated requirement ID: REQ-038. IDs are unique across this project;
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
| Release readiness, docs and media | T6.1 through T6.5 | All agreed features verified locally; publication separately authorized |

## Shared Design

- [ARCHITECTURE.md](../development/ARCHITECTURE.md): process ownership, target model,
  create-only adapter, errors, transport/security and later action constraints.
- [DESIGN.md](../development/DESIGN.md): operator journeys, native/custom presentation,
  status semantics, navigation, accessibility and visual review targets.
- [TESTING.md](../development/TESTING.md): local tiers, fixture ownership, prerequisites,
  synthetic-data policy, performance budgets and evidence gates.
- [RECON-T0.1.md](../development/RECON-T0.1.md): source-confirmed contracts and version
  pins; not a runtime compatibility certificate.

The design documents are proposals pending the relevant spec approvals. Safety,
privacy and the user's stepwise authorization rules are already binding.

## Approval And Completion

Lifecycle: Draft -> Approved -> Implemented -> Verified locally; Superseded retains
a link to its replacement. A continuation to draft specifications does not approve
those specifications or authorize their implementation.

Record approval by role/date and exact scope, not individual names. Completing one
task does not close the whole spec if its other tasks or tests remain open. A spec
becomes Verified locally only when all acceptance checks pass with evidence and
required manual judgment is recorded. No push or hosted CI is needed or authorized.

SPEC-0001 approval was recorded on 2026-09-18. T0.3 through T0.6 were separately
authorized and are complete; T0.5/T0.6 completed on 2026-09-25. Stop for P0 review
and the FND-10 actual-host activation gate. The other drafts remain available for
review; SPEC-0002/T1.1 implementation needs explicit approval. The Node transport
proof does not close actual-host acceptance or authorize starting feature work.

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
| Honest status | SPEC-0001 is Approved with setup, fixture and compiled-main transport evidence; actual-host acceptance remains open; two specs remain Draft |

No blocking product preference is required to review these drafts. Fixture isolation
and main transport have scoped local evidence. Actual-host authentication, IPC
sender/catalog integration and automatic route resolution remain unverified, not
assumptions promoted to supported product behavior.
