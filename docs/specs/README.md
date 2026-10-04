# Specifications

Date: 2026-10-04

Status: SPEC-0001 is Approved; SPEC-0002 to SPEC-0008 are Verified; SPEC-0009
and SPEC-0012 are Implemented; SPEC-0010 is Approved, with the first of its three
slices implemented; SPEC-0011 is Approved.

The [roadmap](../development/ROADMAP.md) owns scope and progress; the
[process](../development/PROCESS.md) owns approvals and review gates.
[AGENTS.md](../../AGENTS.md) owns binding directives, privacy and safety. Use the
[template](TEMPLATE.md) before implementation and retain one independently testable
slice per task even when a spec covers several closely related tasks.

## Spec Index

| Specification | Tasks | Requirement IDs | Status | Runtime evidence |
| --- | --- | --- | --- | --- |
| [SPEC-0001: Local foundation](SPEC-0001-local-foundation.md) | T0.3, T0.4, T0.5, T0.6 separately | REQ-001 through REQ-012 | Approved | 188 of the 1359 tests; local setup, recovery, RBAC and compiled-main transport/cleanup pass; activation in Freelens as an integration test |
| [SPEC-0002: Installation discovery](SPEC-0002-installation-discovery.md) | T1.1 | REQ-013 through REQ-023 | Verified | 100 tests of the rules, of the state and of the components; the suites of the views in a packaged Freelens, with the reader of a part and across three starts |
| [SPEC-0003: States and read-only Backups](SPEC-0003-backup-read-only.md) | T1.2, T1.3 separately | REQ-024 through REQ-037 | Verified | 151 unit tests of the states and of the stages, 70 of what the views show of a backup and of the components; the suites of the views in a packaged Freelens, with a list of a thousand backups; the pre-review |
| [SPEC-0004: Test environment on every platform](SPEC-0004-test-environment-every-platform.md) | Foundation | REQ-038 through REQ-049 | Verified | 119 environment tests; runs on macOS x64 and on the hosted runner, Linux ARM64 |
| [SPEC-0005: Read-only Restores](SPEC-0005-restore-read-only.md) | T1.4 | REQ-050 through REQ-063 | Verified | 122 tests: 59 of what the views show of a restore and of what it refers to, 21 of the views in the address, 42 of the components; the suites of the views in a packaged Freelens, with the reader of the restores and a list of a thousand; the pre-review |
| [SPEC-0006: Read-only Schedules](SPEC-0006-schedule-read-only.md) | T1.5 | REQ-064 through REQ-077 | Verified | 120 tests: 75 of what the views show of a schedule, of its history, of its line of time and of what it refers to, 45 of the components; the suites of the views in a packaged Freelens, with the reader to which the history is denied; the pre-review |
| [SPEC-0007: Read-only storage and snapshot locations](SPEC-0007-locations-read-only.md) | T1.6 | REQ-078 through REQ-092 | Verified | 196 tests: 141 of what the views show of a location, of its durations and of what uses it, 55 of the components; the suites of the views in a packaged Freelens, with the two readers and the location the controller validates; the pre-review |
| [SPEC-0008: Overview of an installation](SPEC-0008-overview.md) | T1.7 | REQ-093 through REQ-107 | Verified | 88 tests: 42 of what the page says of an installation, of its window and of the line of time, 46 of the components; the suites of the views in a packaged Freelens, with the two readers and the long lists; the pre-review |
| [SPEC-0009: The write gate and the way between the processes](SPEC-0009-write-gate.md) | T4.1 | REQ-108 through REQ-119 | Implemented | 115 tests: 16 of the contract and of the frame, 61 of the gate, of the procedures, of their wiring with the host, of the identity of a context and of the version of the server, 16 of the adapter, 22 of the state of the views and of the target bar; the suite of the gate in a packaged Freelens, with two frames of one window and a second start, and the confirmation of one write and the counts of its creations in the suite of the band of the server |
| [SPEC-0010: The diagnostic request and its transport](SPEC-0010-diagnostic-request-and-transport.md) | T2.1, T2.2, T2.4 separately | REQ-120 through REQ-137 | Approved | T2.1, the request through the gate: 127 tests, 103 of the way of a request, of its words, of its text in pages, of its procedures and of the object the cluster is sent through both processes, 15 of the adapter, 8 of the contract and of the gate, 1 of the words the band shares; the transport proof of T0.6, which calls the procedures as a frame does. T2.2 and T2.4 not yet |
| [SPEC-0011: The log, the results, the resources and the volumes of an operation](SPEC-0011-artifact-viewers.md) | T2.3 | REQ-138 through REQ-151 | Approved | None yet |
| [SPEC-0012: The version of the server and its plugins](SPEC-0012-server-status.md) | T5.3 | REQ-152 through REQ-159 | Implemented | 95 tests: 12 of the comparison of the version, of the plugins and of the providers, 32 of the state of the request and of what a write that failed left, 47 of the band and of the confirmation of one write, 4 of the object the cluster is sent, through both processes; the suite of the band in a packaged Freelens, on the real server of the test environment, on a synthetic installation and with the reader of a part |

Next unallocated requirement ID: REQ-160. IDs are unique across this project;
references in test tables do not redefine a requirement. Do not allocate IDs to
unwritten future specs or reuse an ID for a different requirement after approval.

## Remaining Scope

These are existing v1.0.0 commitments from the roadmap, not additional approved
specifications. Draft each at its next design gate, informed by the local proof.

| Scope | Roadmap owner | Dependency |
| --- | --- | --- |
| Schedule adherence | T3.1 through T3.3 | Cron/timezone contract and observed backup history |
| Individual actions | T4.2 through T4.6 | The write gate of SPEC-0009, exact previews and per-action tests |
| Secondary kinds | T5.1, T5.2 | Same evidence/permission contracts |
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
the first milestone: T1.1, T1.2 and T1.3, each its own pull request. They are
Verified since 2026-09-28, when the lead maintainer approved the review of the
milestone on the report and the screenshots of the pre-review pass.

SPEC-0004 approval was recorded on 2026-09-27, with its one open question decided:
the published loopback is accepted on the machines of the developers. It is Verified
since 2026-09-28: the lead maintainer accepted the run on macOS beside another kind
cluster in place of a session by hand.

SPEC-0005, SPEC-0006, SPEC-0007 and SPEC-0008 approval was recorded on 2026-09-28,
as drafted. They are the second milestone: T1.4 to T1.7, each its own pull request,
in that order. They are Verified since 2026-09-30, when the lead maintainer approved
the review of the milestone on the report and the screenshots of the pre-review pass,
with the deviations recorded in the evidence of each spec.

SPEC-0009, SPEC-0010, SPEC-0011 and SPEC-0012 approval was recorded on 2026-09-30,
as drafted, with the one open question of SPEC-0009 decided: the adapter runs the
plugin a context names for its credential. They are the third milestone: T4.1, then
T5.3, then T2.1, T2.2 and T2.4, then T2.3, each its own pull request.

## Document Review

This is document coverage, not test execution:

| Criterion | Initial draft coverage |
| --- | --- |
| Scope and exclusions | Each spec names its roadmap tasks and deferred owners |
| User outcomes | Prioritized Given/When/Then journeys and observable success criteria |
| Requirement identity | 37 unique sequential IDs across the three drafts; the four drafts of the second milestone add 58, REQ-050 to REQ-107, and the four of the third 52, REQ-108 to REQ-159, each with one check |
| Test traceability | Every requirement has a named acceptance check and test layer |
| Safety and privacy | Local-only writes, exact targets, no implicit requests, synthetic evidence |
| UI decisions | Native lists plus dedicated operation workspace, with non-happy and accessible states |
| Source grounding | Every draft carries exact reviewed revisions and recon dependencies |
| Honest status | SPEC-0001 is Approved with setup, fixture and compiled-main transport evidence; SPEC-0002 to SPEC-0008 are Verified; SPEC-0009 and SPEC-0012 are Implemented; SPEC-0010 is Approved, with the first of its three slices implemented; SPEC-0011 is Approved |

No blocking product preference is required to review these drafts. Fixture isolation
and main transport have scoped local evidence. Actual-host authentication, IPC
sender/catalog integration and automatic route resolution remain unverified, not
assumptions promoted to supported product behavior.
