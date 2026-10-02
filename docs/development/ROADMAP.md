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

The compatibility reference is Freelens v1.10.3 with SDK v1.10.3, and Velero
v1.18.2 with the AWS plugin v1.14.2 (see [RECON-T0.1.md](RECON-T0.1.md)).

## Releases

- **1.0.0**: M1 to M6, the complete agreed scope.
- An earlier read-only release after M2 is the lead maintainer's call.

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

The T0.4 to T0.6 evidence is in [TESTING.md](TESTING.md). It covers the
scaffold, the readiness of the infrastructure, a workload of synthetic
ConfigMaps and the transport run in Node. It is not a claim about the full
product, about the recovery of persistent volumes or about all the eight
artifact formats.

The integration test installs the packed production build in a Freelens
v1.10.3 built for the purpose, on every pull request and on main.

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
| Write gate enforced in main: off by default, scoped to cluster and namespace, confirmation that names both | T4.1 | [SPEC-0009](../specs/SPEC-0009-write-gate.md) | In PR |
| `DownloadRequest` workflow owned by main: confirmation, allowlisted targets, URL, failure and timeout exits, cancellation, cleanup | T2.1 | [SPEC-0010](../specs/SPEC-0010-diagnostic-request-and-transport.md) | Approved |
| Streaming transport: destination and redirect policy, inline CA and `caCertRef`, size limits, URL redaction, preserved signed path, Host and SNI | T2.2 | [SPEC-0010](../specs/SPEC-0010-diagnostic-request-and-transport.md) | Approved |
| Log, results, resource list and volume info viewers, with search and clear unavailable, expired and forbidden states | T2.3 | [SPEC-0011](../specs/SPEC-0011-artifact-viewers.md) | Approved |
| Direct access to the object store and the in-cluster strategy; a missing artifact is distinct from a failed storage | T2.4 | [SPEC-0010](../specs/SPEC-0010-diagnostic-request-and-transport.md) | Approved |
| Server version and installed plugins through `ServerStatusRequest` | T5.3 | [SPEC-0012](../specs/SPEC-0012-server-status.md) | Approved |

The write gate comes here and not with the actions of M5 because creating a
`DownloadRequest` or a `ServerStatusRequest` is a write. The known defects of
the diagnostic code that do not act at load time are fixed in this milestone,
with the spec that wires that code to the host.

The four specs of the milestone were approved on 2026-09-30, as drafted. The
order of the slices is the one of their dependencies: the gate, then the
version of the server, which is the smallest write and proves the way between
the processes end to end, then the request and its transport, then the viewers.

Exit of M3: real local artifacts displayed end to end without dependence on
CORS, exposure of a signed URL, full backup downloads or requests of the main
process that nothing controls.

### M4 - Schedule adherence and secondary kinds (read-only)

| Feature | Task | Spec | Status |
| --- | --- | --- | --- |
| Expected runs from the cron expression, `status.lastBackup` and the newest matching Backup | T3.1 | | Planned |
| Grace periods, paused, new and invalid schedules, timezone and daylight saving, skipped runs, clock skew, incomplete history, limited RBAC | T3.2 | | Planned |
| Next expected run, last observed run and overdue state in list, detail and overview, with the reason | T3.3 | | Planned |
| BackupRepository, PodVolumeBackup and PodVolumeRestore views | T5.1 | | Planned |
| DataUpload and DataDownload views with progress and relationships | T5.2 | | Planned |

Exit of M4: tests with a controlled clock and packaged UI scenarios establish
the accuracy of the adherence signal, including its uncertainty states.

### M5 - Actions

| Feature | Task | Spec | Status |
| --- | --- | --- | --- |
| Ground rules of the write actions | | | Planned |
| Backup now from a schedule | T4.2 | | Planned |
| Create backup form, followed by a review of the exact request | T4.3 | | Planned |
| Restore from backup or schedule, with namespace mappings and existing-resource policy | T4.4 | | Planned |
| Pause and resume of a schedule, with explicit `skipImmediately` behavior | T4.5 | | Planned |
| Delete one backup through `DeleteBackupRequest`, with double confirmation | T4.6 | | Planned |

Exit of M5: each action tested separately on the disposable kind cluster, with
the resulting objects and state checked. No write on a real cluster, no bulk
deletion of backups, no way around the confirmation.

### M6 - Release readiness

| Feature | Task | Spec | Status |
| --- | --- | --- | --- |
| Regression, packaged integration, end to end with the real controller, isolation between clusters, permissions, transport security, performance | T6.1 | | Planned |
| Visual and accessibility pass on both themes and on narrow and large windows | T6.2 | | Planned |
| Installation, permissions, safety, compatibility and troubleshooting documentation, screenshots, demonstration video, release notes | T6.3 | | Planned |
| Tarball, checksums and software bill of materials from the release workflow | T6.4 | | Planned |
| Release through the organization's flow, on the lead maintainer's go | T6.5 | | Planned |
