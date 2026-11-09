# Roadmap to v1.0.0

Goal for v1.0.0: the operational experience of Velero inside Freelens, from
backup protection, failures and progress to storage availability and recovery
actions. It is written from scratch as a Freelens extension that needs nothing
installed in the cluster beyond Velero itself (see
[ARCHITECTURE.md](ARCHITECTURE.md) for the boundaries).

This file is the single source of truth for scope and progress. Update it in
every PR that starts, completes, or re-scopes a feature. The process is in
[PROCESS.md](PROCESS.md): specs are approved one by one, the review gate is at
the end of each milestone.

The compatibility reference is Freelens v2, at the validation target of
[SPEC-0015](../specs/SPEC-0015-freelens-v2-host.md): the release Freelens 2.0.0,
built from freelensapp/freelens `b9b53e16056578c5407312eba5823a089972f6d5`, its
tag v2.0.0, with `@freelensapp/extensions` taken by the range `^2.0.0` and
resolved to 2.0.0. The target moved with the
[host drift watch](PROCESS.md#host-drift-watch) until Freelens 2.0.0 was released;
the watch ended on 2026-11-07, with the row of M6 below, and the target moves with
the releases of Freelens.
Velero is v1.18.4 with the AWS plugin v1.14.4 (see [RECON-T0.1.md](RECON-T0.1.md)).
v1.0.0 ships for Freelens v2 and not for Freelens 1, which lists the package as
Incompatible and runs none of it. The checks of M1 to M3 and of T3.1 and T3.2
were made green on Freelens 1 first; T0.8 makes them green on v2.

## Releases

The version line is 1.0.0, decided by the lead maintainer on 2026-10-16 (D10 of
[SPEC-0015](../specs/SPEC-0015-freelens-v2-host.md#d10-the-version-and-the-release)),
and 1.0.0 is its first publication, with no prerelease before it, decided by the
lead maintainer on 2026-11-09
([the amendment of SPEC-0018](../specs/SPEC-0018-release-readiness.md#2026-11-09-no-prerelease-before-100)):

- **1.0.0-N**: the prereleases of the line, on the npm tag `next`, are not made.
  No 1.0.0-0 comes before 1.0.0; until 1.0.0 is published main keeps its version,
  and the extension is installed from the source.
- **1.0.0**: M1 to M6, the complete agreed scope, the first publication, through
  the pull request of the version workflow, tagged, published on `latest` and
  released on GitHub, only after Freelens 2.0.0 is released and M6 is done:
  installing by name takes the newest version that is not a prerelease, whatever
  Freelens it is for. The proof of its assets and its check by version in
  Freelens 2.0.0 are made on it. With Freelens 2.0.0 the pin of the SDK becomes a
  range of versions and the integration runs at the tag v2.0.0, as work of M6.
- No earlier release: the read-only release after M2 that was the lead
  maintainer's call is not made, since 1.0.0 is the first publication.

Every milestone keeps the whole agreed scope: nothing moves out of v1.0.0
without an explicit decision recorded here.

## Feature inventory and milestones

The task IDs (`T1.3`) are the ones the specs and the test evidence refer to.
Status values: `Planned`, `Draft` (the spec is written, not approved),
`Approved`, `In PR`, `Done`.

### Foundation

| Feature | Task | Spec | Status |
| --- | --- | --- | --- |
| Recon of the pinned Velero, plugin and Freelens versions | T0.1 | [RECON-T0.1.md](RECON-T0.1.md) | Done |
| Architecture, operator experience, testing strategy, spec template and first specs | T0.2 | [SPEC-0001](../specs/SPEC-0001-local-foundation.md) | Done |
| Scaffold and toolchain | T0.3 | [SPEC-0001](../specs/SPEC-0001-local-foundation.md) | Done |
| Disposable kind cluster with Velero and an authenticated S3 backend | T0.4 | [SPEC-0001](../specs/SPEC-0001-local-foundation.md) | Done |
| Real backup and restore fixtures, static status fixtures, restricted identity | T0.5 | [SPEC-0001](../specs/SPEC-0001-local-foundation.md) | Done |
| Main process request and download proof, direct and through a pod tunnel | T0.6 | [SPEC-0001](../specs/SPEC-0001-local-foundation.md) | Done |
| Directives and process aligned with the other extensions of the organization; README of the project | | | Done |
| Hosted checks: type check, lint, Knip, Trunk, unit tests, OSV-Scanner | | | Done |
| Tunnel delivers the whole stream; the bundle leaves the dispatcher of the host alone | | [SPEC-0001](../specs/SPEC-0001-local-foundation.md) | Done |
| Scripts that rebuilt third-party images and installed their tools removed | | | Done |
| Package manifest and tools as the other extensions; no dependency override | | | Done |
| Renovate and the automated maintenance workflows | | | Done |
| Activation of the packed extension in a packaged Freelens, as an integration test | FND-10 | [SPEC-0001](../specs/SPEC-0001-local-foundation.md) | Done |
| Test environment on Linux and macOS, x64 and ARM64, and in the hosted checks | | [SPEC-0004](../specs/SPEC-0004-test-environment-every-platform.md) | Done |
| Release workflows | | | Done |
| Move to the extension API of Freelens v2: manifest and build, the main process through the host, the way between the processes, registrations, components, tests and documents, in one pull request | T0.7 | [SPEC-0015](../specs/SPEC-0015-freelens-v2-host.md) | Done |
| Every check of M1 to M3 and of T3.1 and T3.2 green on Freelens v2 in CI on main, with the pre-review on both themes and a gallery for the review | T0.8 | [SPEC-0015](../specs/SPEC-0015-freelens-v2-host.md) | Done |

The T0.4 to T0.6 evidence is in [TESTING.md](TESTING.md). It covers the
scaffold, the readiness of the infrastructure, a workload of synthetic
ConfigMaps and the transport run in Node. It is not a claim about the full
product, about the recovery of persistent volumes or about all the eight
artifact formats.

The integration test, FND-10 and a session for each of the ten kinds,
installs the packed build in a Freelens built from source at the commit of the
validation target, on every pull request and on main; the suites of the views
run in the same build.

### M1 - Discovery and Backups (read-only)

| Feature | Task | Spec | Status |
| --- | --- | --- | --- |
| Installation detection, namespace discovery and configuration, selection among several installations, sidebar, missing, forbidden and empty states | T1.1 | [SPEC-0002](../specs/SPEC-0002-installation-discovery.md) | Done |
| Phase model on two axes, progress, validation errors, durations, unknown values, relationship helpers | T1.2 | [SPEC-0003](../specs/SPEC-0003-backup-read-only.md) | Done |
| Backup list and operation workspace, with storage location, schedule, related restores and failure information; no generic delete | T1.3 | [SPEC-0003](../specs/SPEC-0003-backup-read-only.md) | Done |
| End to end suite against the views, pre-review pass and [walkthrough of the demo](TRY-IT.md) | | | Done |

### M2 - Restores, Schedules, locations, Overview (read-only)

| Feature | Task | Spec | Status |
| --- | --- | --- | --- |
| Restore list and detail, with source backup or schedule and recovery progress | T1.4 | [SPEC-0005](../specs/SPEC-0005-restore-read-only.md) | Done |
| Schedule list and detail, with paused and skipped behavior and backup history | T1.5 | [SPEC-0006](../specs/SPEC-0006-schedule-read-only.md) | Done |
| BackupStorageLocation and VolumeSnapshotLocation lists and details: default, access mode, availability, validation and sync times, errors | T1.6 | [SPEC-0007](../specs/SPEC-0007-locations-read-only.md) | Done |
| Overview (ad hoc): what needs attention and what was read, with no single value for the installation; navigation into the objects | T1.7 | [SPEC-0008](../specs/SPEC-0008-overview.md) | Done |

The first milestone is on main and its two specs are Verified: the lead maintainer
approved the review of the milestone on 2026-09-28. The Overview was read at the
approval of its spec as what needs attention beside what was read, with no single
value for an installation: the row above has those words since then.

The second milestone is on main and its four specs are Verified: the lead
maintainer approved the review of the milestone on 2026-09-30, with the
deviations from their requirements, each recorded in the evidence of its spec.

Exit of M1 and M2: the five primary kinds usable in a packaged Freelens, every
phase covered, missing data never shown as healthy, pre-review on both themes.

### M3 - Logs and diagnostics

| Feature | Task | Spec | Status |
| --- | --- | --- | --- |
| Write gate enforced in main: off by default, scoped to cluster and namespace, confirmation that names both | T4.1 | [SPEC-0009](../specs/SPEC-0009-write-gate.md) | Done |
| `DownloadRequest` workflow owned by main: confirmation, allowlisted targets, URL, failure and timeout exits, cancellation, cleanup | T2.1 | [SPEC-0010](../specs/SPEC-0010-diagnostic-request-and-transport.md) | Done |
| Streaming transport: destination and redirect policy, inline CA and `caCertRef`, size limits, URL redaction, preserved signed path, Host and SNI | T2.2 | [SPEC-0010](../specs/SPEC-0010-diagnostic-request-and-transport.md) | Done |
| Log, results, resource list and volume info viewers, with search and clear unavailable, expired and forbidden states | T2.3 | [SPEC-0011](../specs/SPEC-0011-artifact-viewers.md) | Done |
| Direct access to the object store and the in-cluster strategy; a missing artifact is distinct from a failed storage | T2.4 | [SPEC-0010](../specs/SPEC-0010-diagnostic-request-and-transport.md) | Done |
| Server version and installed plugins through `ServerStatusRequest` | T5.3 | [SPEC-0012](../specs/SPEC-0012-server-status.md) | Done |

The write gate comes here and not with the actions of M5 because creating a
`DownloadRequest` or a `ServerStatusRequest` is a write. The known defects of
the diagnostic code that do not act at load time are fixed in this milestone,
with the spec that wires that code to the host.

The four specs of the milestone were approved on 2026-09-30, as drafted. The
order of the slices is the one of their dependencies: the gate, then the
version of the server, which is the smallest write and proves the way between
the processes end to end, then the request and its transport, then the viewers.

The viewers, T2.3, are three pull requests, in this order: the tabs, with their
unit and component tests and a first suite in the packaged application on the
real backup and the real restore of the test environment; the fixtures of the
tabs, which are the backups synced from the store, with artifacts made for the
rules of the viewers, and the operations the server refuses; and the suites on
those fixtures, the measures on the log of 200,000 lines in the packaged
application, the pre-review with the tabs open and the cleanup of the fixtures in
the hosted job of the views, with the evidence that makes SPEC-0011 Implemented.
The row of T2.3 was In PR from the first of them and is Done with the last, the
pull request that carries this text, whose evidence made SPEC-0011 Implemented on
2026-10-07.

Exit of M3: real local artifacts displayed end to end without dependence on
CORS, exposure of a signed URL, full backup downloads or requests of the main
process that nothing controls.

Where the milestone stands with the third pull request of T2.3: the artifacts of
the real backup and of the real restore of the test environment, and the ones of
the backups synced from its store, are read end to end in the packaged
application, through a tunnel to the store opened through the API server, with no
signed URL in any report, no download of the contents of a backup, and no request
the gate did not confirm, which the guard of the suites counts on the API server.
Every row of the milestone is Done with the third pull request of T2.3.
The review gate of the milestone, in
[PROCESS.md](PROCESS.md#milestone-manual-review-gate), was held on 2026-10-13: the
lead maintainer kept the decisions each of its four specs records, with the frames
of a scroll as a percentile, VIEW-08 reworded and the deviation of REQ-154
confirmed. The third milestone is on main and its four specs are Verified: the lead
maintainer approved the review of the milestone on 2026-10-14, with what the
pre-review of the tabs had left to human judgment accepted as recorded, and their
tests had run green in CI on main with the reviewed release moved to v1.18.4.

### M4 - Schedule adherence and secondary kinds (read-only)

| Feature | Task | Spec | Status |
| --- | --- | --- | --- |
| Expected runs from the cron expression, `status.lastBackup` and the newest matching Backup | T3.1 | [SPEC-0013](../specs/SPEC-0013-schedule-adherence.md) | Done |
| Grace periods, paused, new and invalid schedules, timezone and daylight saving, skipped runs, clock skew, incomplete history, limited RBAC | T3.2 | [SPEC-0013](../specs/SPEC-0013-schedule-adherence.md) | Done |
| Next expected run, last observed run and overdue state in list, detail and overview, with the reason | T3.3 | [SPEC-0013](../specs/SPEC-0013-schedule-adherence.md) | Done |
| BackupRepository, PodVolumeBackup and PodVolumeRestore views | T5.1 | [SPEC-0014](../specs/SPEC-0014-repositories-and-data-movement.md) | Done |
| DataUpload and DataDownload views with progress and relationships | T5.2 | [SPEC-0014](../specs/SPEC-0014-repositories-and-data-movement.md) | Done |

The two specs of the milestone were approved on 2026-10-14, as drafted. The order
of the slices: T3.1, the grammar of the cron library and the computation with a
controlled clock; then T3.2 and T3.3, the states and the four surfaces; then T5.1,
the repositories and the pod volume operations; then T5.2, the data movement.
T3.3 and the rest of the milestone resume on Freelens v2 after T0.8, as
[SPEC-0015](../specs/SPEC-0015-freelens-v2-host.md) says.

The four surfaces, T3.3, are four pull requests, in this order: the adherence of a
schedule in its list, its view and the details of the host, with the time of the
API server read and kept, their unit and component tests, and the suite of the
schedules restated on the fixtures that exist; the Overview, with the rule of
what is overdue, held or submitted at every look and the count of what is not
known; the fixtures of the adherence, placed by the clock, and a schedule the
controller validates; and the suite of the adherence on those fixtures, with the
measures and the pre-review, whose evidence makes SPEC-0013 Implemented. The row
of T3.3 is In PR from the first of them and is Done with the last.

The repositories and the pod volume operations, T5.1, are five pull requests, in
this order: the backup repositories, the pod volume backups and the pod volume
restores in their lists, their views and the details of the host, with the two
families of the operations read only while a view that shows them is open; the
band of the volume operations in the view of a backup and of a restore, what used
a repository, and the way from the Volumes tab; the cell of the repositories and
their two rules in the Overview; a pod volume backed up and restored in the test
environment, with the repositories and the operations of the views and of the long
lists placed; and the suites on those fixtures, with the measures and the
pre-review. The data movement, T5.2, is two more: the data uploads and the data
downloads, read under the second version of the group, in their lists, their
views, the details of the host and the bands; and their fixtures with their
suites, the measures and the pre-review, whose evidence makes SPEC-0014
Implemented. The row of T5.1 is In PR from the first of its pull requests and is
Done with the last, and so is the row of T5.2 with its two.

Exit of M4: tests with a controlled clock and packaged UI scenarios establish
the accuracy of the adherence signal, including its uncertainty states.

Every row of the milestone is Done with the second pull request of T5.2. The
review gate of the milestone, in
[PROCESS.md](PROCESS.md#milestone-manual-review-gate), was held on 2026-11-08: the
points it was to decide had been decided by the lead maintainer on 2026-10-26, as
recommended, the amendment of REQ-166 and the precisions of REQ-170 and REQ-171
confirmed, the last submission and the newest backup of the list of the Schedules
giving their room under 1,200 pixels, and the reasons of D1 and D2 of SPEC-0015
reworded. The fourth milestone is on main and its two specs are Verified: the lead
maintainer approved the review of the milestone on 2026-11-08, on the screenshots of
its views in both themes and at the sizes of the pre-review, and their tests run
green in CI on main.

### M5 - Actions

| Feature | Task | Spec | Status |
| --- | --- | --- | --- |
| Ground rules of the write actions | | [SPEC-0017](../specs/SPEC-0017-write-actions.md) | Done |
| Backup now from a schedule | T4.2 | [SPEC-0017](../specs/SPEC-0017-write-actions.md) | Done |
| Create backup form, followed by a review of the exact request | T4.3 | [SPEC-0017](../specs/SPEC-0017-write-actions.md) | Done |
| Create schedule form, followed by a review of the exact request | T4.7 | [SPEC-0016](../specs/SPEC-0016-create-a-schedule.md) | Done |
| Restore from backup or schedule, with namespace mappings and existing-resource policy | T4.4 | [SPEC-0017](../specs/SPEC-0017-write-actions.md) | Done |
| Pause and resume of a schedule, with explicit `skipImmediately` behavior | T4.5 | [SPEC-0017](../specs/SPEC-0017-write-actions.md) | Done |
| Delete one backup through `DeleteBackupRequest`, with double confirmation | T4.6 | [SPEC-0017](../specs/SPEC-0017-write-actions.md) | Done |

Creating a Schedule is in v1.0.0, decided by the lead maintainer on 2026-10-23:
T4.7, whose spec is [SPEC-0016](../specs/SPEC-0016-create-a-schedule.md), approved
by the lead maintainer on 2026-10-25. The order of the slices of the milestone is
T4.2, T4.3, T4.7, T4.4, T4.5, T4.6. T4.7 comes right after T4.3 because the template
of a Schedule is the spec of a Backup: the form of the template is shared, with two
wrappers, one for a Backup and one for a Schedule.

Editing a Schedule stays out of v1.0.0, decided by the lead maintainer on
2026-10-23, and is deferred to the next minor: the adapter is create-only
([ARCHITECTURE.md](ARCHITECTURE.md#create-only-adapter-decision)), and a patch of
the spec needs the review of a diff, which is a different review model from the one
of a creation. Pause and resume, T4.5, are the only patches of v1.0.0.

Exit of M5: each action tested separately on the disposable kind cluster, with
the resulting objects and state checked. No write on a real cluster, no bulk
deletion of backups, no way around the confirmation.

Every row of the milestone is Done with the third pull request of T4.6. Each action
has its review of the exact request, its cases in the suite of the actions on the
CRDs of the release alone, its views and its walk with the keyboard in the
pre-review, and its proof in `pnpm e2e` against the server of the release on the
disposable kind cluster. The review gate of the milestone, in
[PROCESS.md](PROCESS.md#milestone-manual-review-gate), was held on 2026-11-09: the
lead maintainer approved the review of the milestone on the screenshots of the
views of its actions in both themes and at the sizes of the pre-review, with Delete
backup kept offered for a backup Velero has not started that names no storage
location. The fifth milestone is on main and SPEC-0016 and SPEC-0017 are Verified,
their tests green in CI on main.

### M6 - Release readiness

| Feature | Task | Spec | Status |
| --- | --- | --- | --- |
| Regression; the roles of the README proven; HTTPS and the direct route in the host; a ceiling on the bundles. The rest is deferred, D16 | T6.1 | [SPEC-0018](../specs/SPEC-0018-release-readiness.md) | In PR |
| Visual pass on both themes and on narrow and large windows | T6.2 | [SPEC-0018](../specs/SPEC-0018-release-readiness.md) | In PR |
| Installation, permissions, safety, compatibility and troubleshooting documentation, screenshots, demonstration video, release notes | T6.3 | [SPEC-0018](../specs/SPEC-0018-release-readiness.md) | In PR |
| Tarball, checksums and software bill of materials from the release workflow of the template: on each GitHub release, the tarball and the bill of materials of the repository at the tag, each with its `.sha256`, and the provenance through the trusted publisher alone. Left: the token of the first publication and then the trusted publisher, and the proof of the assets on the first release | T6.4 | [SPEC-0018](../specs/SPEC-0018-release-readiness.md) | In PR |
| With Freelens 2.0.0: the pin of the SDK a range of versions, the integration at the tag v2.0.0, the host drift watch ended | | [SPEC-0015](../specs/SPEC-0015-freelens-v2-host.md#d10-the-version-and-the-release) | Done |
| Release through the organization's flow, on the lead maintainer's go: the version, tag and release workflows of the template, the tag on main once the pull request of the version is merged. Left: the review of the milestone, 1.0.0 published and checked, and its listing in the marketplace | T6.5 | [SPEC-0018](../specs/SPEC-0018-release-readiness.md) | In PR |

[SPEC-0018](../specs/SPEC-0018-release-readiness.md), approved by the lead
maintainer on 2026-11-09 with D1 to D19 as proposed, is the one spec of the
milestone; its first slice comes after M5, closed with its review the same day.
The order of the slices, its D15, as amended on 2026-11-09: there is no
prerelease, and 1.0.0 is the first publication, as the lead maintainer decided
that day
([the amendment](../specs/SPEC-0018-release-readiness.md#2026-11-09-no-prerelease-before-100)),
with the proof of its assets and its check by version in Freelens 2.0.0. First
T6.4 and the tag, which are the version, tag and release workflows of the
template of the organization, as the lead maintainer decided on 2026-11-09 with
the first amendment of the spec; then the sections of the README 1.0.0 is
installed with; then the identities of the actions, then
[#145](https://github.com/freelensapp/freelens-velero-extension/issues/145), the
case of FND-10 by the direct route and the ceilings of the bundles, with T6.2, the
visual pass of the pre-review, beside them; then the screenshots, the video
and the notes of 1.0.0, the review of the milestone, and 1.0.0 on `latest` on the
lead maintainer's go. Its D16 says what T6.1 takes and what it defers: the row of
T6.1 is narrowed to it, and what it defers is under Deferred after v1.0.0.
Each slice is its own pull request; the row of a task is In PR from its first and
Done with its last.

## Deferred after v1.0.0

Work that is decided out of v1.0.0, each item with its decision:

- **What T6.1 defers**, by D16 of [SPEC-0018](../specs/SPEC-0018-release-readiness.md#what-t61-defers),
  approved by the lead maintainer on 2026-11-09: the performance but the ceiling on
  the bytes of the bundles, that is guards relative to a baseline, ceilings of
  memory and of the start, and larger datasets; FND-10 on hosted macOS and Windows
  runners at each tag; and the other gaps of the inventory the spec lists, each
  with its reason and the check or the statement of the README that keeps its
  release signal.
- **What the amendments of SPEC-0018 do not take of T6.1**, decided by the lead
  maintainer on 2026-11-09 ([the amendments](../specs/SPEC-0018-release-readiness.md#amendments)):
  the checks that go beyond the other extensions of the organization and were not
  made, the isolation between two clusters in one packaged Freelens, and Back up
  now and Delete backup with the real controller in the packaged application;
  and, with the release workflow of the template, FND-10 on the tarball the
  release publishes. The spec lists each in what T6.1 defers, with the check that
  stays.
- **Editing a Schedule**, to the next minor: the adapter is create-only, and a
  patch of the spec needs the review of a diff, a different review model from the
  one of a creation. Decided by the lead maintainer on 2026-10-23.
- **Backup coverage panels**, which would show which namespaces and volumes the
  schedules and the backups of an installation cover. Deferred by the same
  decision.
