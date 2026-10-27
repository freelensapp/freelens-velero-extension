# Specifications

Date: 2026-10-27

Status: SPEC-0001 is Approved; SPEC-0002 to SPEC-0012 are Verified, SPEC-0009 to
SPEC-0012 since 2026-10-14, when the lead maintainer approved the review of the
third milestone, held on 2026-10-13; SPEC-0013, Approved on 2026-10-14, is
Implemented with the fourth pull request of T3.3, its manual review and three
items waiting for the lead maintainer at the review of the fourth milestone;
SPEC-0014 is Approved since 2026-10-14, with the evidence of the first pull
request of T5.1; SPEC-0015, Approved on 2026-10-16, is
Implemented since 2026-10-22, when the lead maintainer approved the review of
T0.8, and amended on 2026-10-27 for the eight kinds of the extension; SPEC-0016,
drafted on 2026-10-23, is Approved since 2026-10-25.

The [roadmap](../development/ROADMAP.md) owns scope and progress; the
[process](../development/PROCESS.md) owns approvals and review gates.
[AGENTS.md](../../AGENTS.md) owns binding directives, privacy and safety. Use the
[template](TEMPLATE.md) before implementation and retain one independently testable
slice per task even when a spec covers several closely related tasks.

## Spec Index

| Specification | Tasks | Requirement IDs | Status | Runtime evidence |
| --- | --- | --- | --- | --- |
| [SPEC-0001: Local foundation](SPEC-0001-local-foundation.md) | T0.3, T0.4, T0.5, T0.6 separately | REQ-001 through REQ-012 | Approved | 400 of the 2291 tests; local setup, recovery, RBAC and compiled-main transport/cleanup pass; activation in Freelens as an integration test |
| [SPEC-0002: Installation discovery](SPEC-0002-installation-discovery.md) | T1.1 | REQ-013 through REQ-023 | Verified | 100 tests of the rules, of the state and of the components; the suites of the views in a packaged Freelens, with the reader of a part and across three starts |
| [SPEC-0003: States and read-only Backups](SPEC-0003-backup-read-only.md) | T1.2, T1.3 separately | REQ-024 through REQ-037 | Verified | 151 unit tests of the states and of the stages, 70 of what the views show of a backup and of the components; the suites of the views in a packaged Freelens, with a list of a thousand backups; the pre-review |
| [SPEC-0004: Test environment on every platform](SPEC-0004-test-environment-every-platform.md) | Foundation | REQ-038 through REQ-049 | Verified | 215 tests of the environment and of its fixtures; runs on macOS x64 and on the hosted runner, Linux ARM64 |
| [SPEC-0005: Read-only Restores](SPEC-0005-restore-read-only.md) | T1.4 | REQ-050 through REQ-063 | Verified | 122 tests: 59 of what the views show of a restore and of what it refers to, 21 of the views in the address, 42 of the components; the suites of the views in a packaged Freelens, with the reader of the restores and a list of a thousand; the pre-review |
| [SPEC-0006: Read-only Schedules](SPEC-0006-schedule-read-only.md) | T1.5 | REQ-064 through REQ-077 | Verified | 120 tests: 75 of what the views show of a schedule, of its history, of its line of time and of what it refers to, 45 of the components; the suites of the views in a packaged Freelens, with the reader to which the history is denied; the pre-review. REQ-064, REQ-066, SCHED-03 and the Success Criteria restated with the first pull request of T3.3 of SPEC-0013 |
| [SPEC-0007: Read-only storage and snapshot locations](SPEC-0007-locations-read-only.md) | T1.6 | REQ-078 through REQ-092 | Verified | 196 tests: 141 of what the views show of a location, of its durations and of what uses it, 55 of the components; the suites of the views in a packaged Freelens, with the two readers and the location the controller validates; the pre-review |
| [SPEC-0008: Overview of an installation](SPEC-0008-overview.md) | T1.7 | REQ-093 through REQ-107 | Verified | 88 tests: 42 of what the page says of an installation, of its window and of the line of time, 46 of the components; the suites of the views in a packaged Freelens, with the two readers and the long lists; the pre-review. REQ-096 with rule A11, OVER-04, OVER-10, the scope and the assumption on expectations restated with the second pull request of T3.3 of SPEC-0013 |
| [SPEC-0009: The write gate and the way between the processes](SPEC-0009-write-gate.md) | T4.1 | REQ-108 through REQ-119 | Verified | 115 tests: 16 of the contract and of the frame, 61 of the gate, of the procedures, of their wiring with the host, of the identity of a context and of the version of the server, 16 of the adapter, 22 of the state of the views and of the target bar; the suite of the gate in a packaged Freelens, with two frames of one window and a second start, and the confirmation of one write and the counts of its creations in the suite of the band of the server |
| [SPEC-0010: The diagnostic request and its transport](SPEC-0010-diagnostic-request-and-transport.md) | T2.1, T2.2, T2.4 separately | REQ-120 through REQ-137 | Verified | T2.1, the request through the gate: 127 tests, 103 of the way of a request, of its words, of its text in pages, of its procedures and of the object the cluster is sent through both processes, 15 of the adapter, 8 of the contract and of the gate, 1 of the words the band shares; the transport proof of T0.6, which calls the procedures as a frame does. T2.2, the transport: 360 tests, 244 of the rules on the addresses, 108 of the transport and of its tunnel, 1 of the adapter, 3 of the words and of the way of a request, 4 of the fixtures of the proof; the transport proof, which asks the server and the store for what is not there as well. T2.4, the route: 71 tests, 59 of the origin and of the path of a signed URL, of the route, of what the operator allows and of the store that keeps it, 5 of the words and of the way of a request, 3 of the adapter and of the tunnel, 3 of the contract and of the preferences, 1 of the identities of the proof; the transport proof by the route the main process finds, with the allowance of its direct mode and its four identities; the suite of the preferences in a packaged Freelens, with an allowance taken back and two starts after it. The tabs of SPEC-0011 bring the rest of the packaged checks |
| [SPEC-0011: The log, the results, the resources and the volumes of an operation](SPEC-0011-artifact-viewers.md) | T2.3 | REQ-138 through REQ-151 | Verified | The first of the three pull requests of the task, the tabs: 396 tests, 115 of the four parsers and of the words of the tabs, 1 of the steps a request ends at before it is created, 40 of the load of an artifact and of the loads of the view that is shown, 7 of the tab in the address, 180 of the strip, of the panel, of the lists of lines, of the four viewers, of Escape in a text field and of the name a confirmation shows in words, 29 of the two workspaces with their tabs and of the section in the details of the host, 20 of the saving, of the bytes of a download and of its bound in the main process, 3 of the contract, 1 of the counters the status writes; the suite of the tabs in a packaged Freelens, on the real backup and the real restore of the test environment, with what the API server counted of their requests, in both themes and at the sizes of the window and the zoom of the pre-review. The second, the fixtures of the tabs: 105 tests, 16 of the artifacts the generators make, 75 of the environment that places the fixtures, waits for the server and removes them, 14 of the four parsers on what the fixtures give the store; the measure of the code of a log, alone after the tests; the fixtures placed, synced and removed on the cluster of the test environment, and the suites of the views restated on what its installation holds with them. The third, the suites on the fixtures: the suite of the tabs on the backups synced from the store and on the operations the server refused, 47 cases, twenty requests each removed by the server, with the measures of a search, a filter and a scroll on the log of 200,000 lines in the packaged application; the pre-review with the tabs open, 35 views in 33 cases, with the journeys with the keyboard alone; the cleanup of the fixtures in the hosted job of the views; and the words of a storage location that is not there, said once, with their unit tests. The third adds no test to the count of the unit run, 73 files and 2,291 tests and the measure after them: the words changed assertions in two files, and three tests of earlier pull requests were hardened under the load of the whole run. Its measures in the packaged application answered in 51.1 ms at the 95th percentile and drew the longest frame of a gesture in 15.9, of 250 and of 50, on the machine of the runs |
| [SPEC-0012: The version of the server and its plugins](SPEC-0012-server-status.md) | T5.3 | REQ-152 through REQ-159 | Verified | 95 tests: 12 of the comparison of the version, of the plugins and of the providers, 32 of the state of the request and of what a write that failed left, 47 of the band and of the confirmation of one write, 4 of the object the cluster is sent, through both processes; the suite of the band in a packaged Freelens, on the real server of the test environment, on a synthetic installation and with the reader of a part |
| [SPEC-0013: The adherence of a schedule](SPEC-0013-schedule-adherence.md) | T3.1, T3.2, T3.3 | REQ-160 through REQ-176 | Implemented | T3.1, the grammar and the computation: 177 tests, 159 of the grammar of the parser of the reviewed release, of which 112 accepted expressions with their next runs in UTC, in Rome and in New York across the changes of daylight saving time of 2026 (22 of the five fields, 9 of the two day fields both restricted, 22 of the names, of Sunday as 7 and of the ranges that wrap, 15 of the descriptors, 44 of the zones and of the changes, the midnight a zone skips among them), 8 of the expressions with no instant and of a zone that is not known, 34 refusals with the words the controller writes, 5 of the sources of the rows, of the length, of the sets and of the parse kept by text; 9 of the expected run, of its anchor, of due and of the count with its bound, with the daily and the interval cases of the tests of the release; 4 of the zone an expression names, used whatever zone is given beside it; 4 of the backup of the last submission; 1 of the plain values; the measure of the signals of a thousand schedules, alone after the tests, 14.2 ms at the 95th percentile of 250 and one schedule in 0.03 of 2 on the machine of the runs. T3.2, the states and their words: 79 tests with the clock as an argument and the zone of the machine fourteen hours east of UTC, 22 of the offset of the server read in the name of the backup of a submission and kept for the session, and of the clocks of this machine and of the cluster, 57 of the states by the clock the lateness is counted by, the one of the cluster when its API server gives its time, of the pause, the refusal and the phases Velero has not read, gated before the expression as reads that throw prove, of each state of what is not known with its mark and its words, of a cluster ahead that never keeps a schedule from being said overdue, of the last observed run and of the order by adherence, every word read from the words of the module; changes made on purpose to the module, fifteen before the independent review and sixteen after it, each made a test fail; REQ-166 amended so that a cluster ahead bounds nothing that is said overdue; a zone with an empty name, quoted or not, said refused, with REQ-066 and SCHED-03 of SPEC-0006 restated; the measure of the whole signals with their words of a thousand schedules, 42.7 ms at the 95th percentile of 250 and one schedule in 0.04 of 2 on the machine of the runs. The four surfaces are T3.3, in four pull requests; the first, the list, the view and the details of the host, with the time of the API server read and kept: 40 tests more, 12 of the reader, 4 of the state, 16 of the list, the view and the details, 6 of the band and 2 of the stylesheet, with REQ-064, REQ-066, SCHED-03 and the Success Criteria of SPEC-0006 restated and a precision of REQ-170, the age of the read the details of the host compute with, to confirm at the review of the milestone; one test more of the stylesheet, the columns that have a width of their own from 1,000 pixels; the suite of the schedules restated, 17 cases, run in the packaged application on 2026-10-25 with every suite of the views, 174 cases in 12 files, and the pre-review, 33 cases, all green, and on the hosted runner, after three faults of the list it found were corrected: at every width the words of the next run and of the adherence off the line of their row and paused clipped with no ellipsis and no tip, and how the newest backup ended clipped where its column is narrow. The second, the Overview: 21 tests more, 1 of the words of the derived offset apart from what else is said beside a state, 11 of the rules, rule A11 for each state, its reason, time and backup, a schedule at every look led to its backup in progress and one held by two backups, the count of what is not known by reason and the summary, and 9 of the page, the items and the line of the count before them, the two cells of a line with their tips, the loading, a tick of the clock, a late answer and the backups denied, with REQ-096, OVER-04 and OVER-10 of SPEC-0008 restated; the suites of the Overview and of the first reader restated and run green in the packaged application on 2026-10-25, with every suite of the views, 174 cases in 12 files, and the pre-review, 33 cases, and again after the corrections of the independent review; in the window of 1440 by 900 the band of the schedules alone on its row, as the lead maintainer decided, each table of lines with all its columns; the third, the fixtures of the adherence placed by the clock in two phases, in three installations the operator names, and a schedule the controller of the installation validates, removed by the cleanup: 14 tests more of the environment, 1 of the two schedules the views gain, 8 of the installations of the adherence and of their placement, the names from the clock read just before each group and the last submissions from the creations read back, and 5 of the real schedule, its placement, its wait and its removal; the suites of the schedules, of the Overview and of the first reader restated and run green in the packaged application on 2026-10-26, 17, 15 and 8 cases, with the second reader, 7, every suite of the views, 174 cases in 12 files, and the pre-review, 33 cases; the placements, the real schedule and the cleanup proved on the test environment, where the controller was measured to send a PATCH of the real schedule at every look, of which the writes the suites count leave out no more than the whole minutes between two readings of the counters and two, a bound decided after the runs and proven by the test of the guard; the fourth, the adherence proven on its fixtures: one test more in the unit run, of the stylesheet, the mark of a line of the Overview at the top of its cell, a helper of the suites that computes what each fixture is to show by the rules of the controller, proven with the words the suite expects and the counters it reads by nineteen cases of their own with no application, the changes made on purpose to them each failing one; the suite of the adherence, 30 cases, the two restricted suites with the adherence of the interval and of five fields, and the pre-review, 39 views in 35 cases, run in the packaged application on 2026-10-26: the suite of the adherence alone twice, 30 of 30 each time, the two restricted suites 17 of 17 and the pre-review 34 of 35, the words of the marks of the lines of the Overview a pixel under their rows at twice the zoom, a defect of the views on main, then on 2026-10-27, with the mark of a line at the top of its cell, every suite, the pre-review and FND-10 as the hosted job runs them, 247 of 247, the pre-review 35 of 35; ADH-16 in the packaged application, the list of three hundred schedules within 176, 156 and 134 ms at the 95th percentile and its Overview within 33, 62 and 37 ms, of 250; the amendment of REQ-166, the precisions of REQ-170 and REQ-171 and the manual review waiting for the lead maintainer |
| [SPEC-0014: Read-only repositories, pod volume operations and data movement](SPEC-0014-repositories-and-data-movement.md) | T5.1, T5.2 | REQ-177 through REQ-195 | Approved | T5.1 is five pull requests; the first, the backup repositories, the pod volume backups and the pod volume restores in their lists, their views and the details of the host, with the two families of the pod volume operations read only while a view that shows them is open: 180 tests more (of the phases, the times, the bytes, the references, the repositories and the words of the states, table-driven and with a controlled clock, of the reads on demand and their holders, and of the three lists, the two views and the two sections, with the room of each list), with DISC-08 of SPEC-0002 and REQ-210 and HOST-15 of SPEC-0015 restated and two precisions, of REQ-177 and REQ-179; the new suite of the volumes and the suites that count the reads restated, run green in the packaged application on 2026-10-27, the journey, 19 cases, and the suite of the volumes, 4, alone, then every suite of the views, the pre-review and FND-10 as the hosted job runs them, 252 cases in 16 files |
| [SPEC-0015: The Freelens v2 host](SPEC-0015-freelens-v2-host.md) | T0.7, T0.8 | REQ-196 through REQ-220 | Implemented | T0.7 and T0.8 on main: CI on main at `b5834444` green in every job, on Freelens built at the validation target, the unit run of 83 files and 2,591 tests, the packaged suites, the pre-review and FND-10, the five sessions of the integration test and the transport proof in its four modes (HOST-02); the headers and the evidence of the specs of M1 to M3 and SPEC-0013 on v2 with #89 (HOST-24); the review of the lead maintainer on 2026-10-22 (HOST-25); HOST-01 on the nightly of the validation target and once on Freelens 1.10.3; HOST-21 at the first prerelease |
| [SPEC-0016: Create a Schedule](SPEC-0016-create-a-schedule.md) | T4.7 | REQ-221 through REQ-243 | Approved | None yet |

Next unallocated requirement ID: REQ-244. IDs are unique across this project;
references in test tables do not redefine a requirement. Do not allocate IDs to
unwritten future specs or reuse an ID for a different requirement after approval.

## Remaining Scope

These are existing v1.0.0 commitments from the roadmap, not additional approved
specifications. Draft each at its next design gate, informed by the local proof.

| Scope | Roadmap owner | Dependency |
| --- | --- | --- |
| Schedule adherence | T3.1 through T3.3 | SPEC-0013, implemented: the grammar of the cron library of the reviewed release and the observed history |
| Individual actions | T4.2 through T4.7 | The write gate of SPEC-0009, exact previews and per-action tests; SPEC-0016, approved, for T4.7 |
| Secondary kinds | T5.1, T5.2 | SPEC-0014, approved: the same evidence and permission contracts, read only |
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
T5.3, then T2.1, T2.2 and T2.4, each its own pull request, then T2.3, which is three:
the tabs, their fixtures, and the suites on those fixtures.

The review of the third milestone was held on 2026-10-13: the lead maintainer kept
the decisions taken while implementing, chose the percentile for the frames of a
scroll, which REQ-147 and VIEW-10 of SPEC-0011 say since, reworded VIEW-08 to the
methods a backup writes, and confirmed the deviation of REQ-154 of SPEC-0012 and
what the decision on the requests covers. They are Verified since 2026-10-14, when
the lead maintainer approved the review of the milestone on the report and the
screenshots of the pre-review pass, with what the pre-review of the tabs had left
to human judgment accepted as recorded.

SPEC-0013 and SPEC-0014 are drafted on 2026-10-13 for the fourth milestone, against
Velero v1.18.4, with an independent review of the drafts applied: T3.1, T3.2 and T3.3,
the adherence of a schedule, and T5.1 and T5.2, the repositories, the pod volume
operations and the data movement, each read only. Their approval was recorded on
2026-10-14, as drafted, with the one disagreement of the review decided: two offsets
of one installation are a change of daylight saving time. They are the fourth
milestone: T3.1, then T3.2 and T3.3, then T5.1, then T5.2, each its own pull request.

## Document Review

This is document coverage, not test execution:

| Criterion | Initial draft coverage |
| --- | --- |
| Scope and exclusions | Each spec names its roadmap tasks and deferred owners |
| User outcomes | Prioritized Given/When/Then journeys and observable success criteria |
| Requirement identity | 37 unique sequential IDs across the three drafts; the four drafts of the second milestone add 58, REQ-050 to REQ-107, and the four of the third 52, REQ-108 to REQ-159, and the two of the fourth 36, REQ-160 to REQ-195, and the draft of the Freelens v2 host 25, REQ-196 to REQ-220, and the draft of the creation of a Schedule 23, REQ-221 to REQ-243, each with one check |
| Test traceability | Every requirement has a named acceptance check and test layer |
| Safety and privacy | Local-only writes, exact targets, no implicit requests, synthetic evidence |
| UI decisions | Native lists plus dedicated operation workspace, with non-happy and accessible states |
| Source grounding | Every draft carries exact reviewed revisions and recon dependencies |
| Honest status | SPEC-0001 is Approved with setup, fixture and compiled-main transport evidence; SPEC-0002 to SPEC-0008 are Verified; SPEC-0009 to SPEC-0012 are Verified since 2026-10-14, SPEC-0011 with the three pull requests of its task; SPEC-0013, Approved on 2026-10-14, is Implemented with the fourth pull request of T3.3, its manual review and three items waiting for the lead maintainer at the review of the fourth milestone, and SPEC-0014 is Approved since 2026-10-14, with the evidence of the first pull request of T5.1, which restates DISC-08 of SPEC-0002; REQ-166 of SPEC-0013 is amended by the pull request of its second slice, for the review of the milestone to confirm; the first pull request of its third slice restates REQ-064, REQ-066, SCHED-03 and the Success Criteria of SPEC-0006, and the second REQ-096 with rule A11, OVER-04 and OVER-10 of SPEC-0008; SPEC-0015 is Implemented since 2026-10-22, after T0.7 and the review of T0.8; with the pull request of T0.7 it amends REQ-114 of SPEC-0009 and supersedes its REQ-115 and REQ-116, amends REQ-129, REQ-136 and REQ-137 of SPEC-0010, and changes how the lists of lines of SPEC-0011 are drawn, each recorded under the amendments of its spec, with the date 2026-10-16, and its REQ-210, D7 and HOST-15 say the eight kinds of the extension since the first pull request of T5.1, with an amendment of 2026-10-27; SPEC-0016 is Approved since 2026-10-25, as drafted, with D11 decided as the draft proposed; the amendments of SCHED-11 of SPEC-0006 and of the procedures of SPEC-0009 it brings are approved with it and recorded with the pull request of T4.7 |

No blocking product preference is required to review these drafts. Fixture isolation
and main transport have scoped local evidence. Actual-host authentication, IPC
sender/catalog integration and automatic route resolution remain unverified, not
assumptions promoted to supported product behavior.
