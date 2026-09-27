# Velero Extension v1.0.0 Action Plan

Date: 2026-09-25

Status: Approved for stepwise execution

Authorization: SeaweedFS 4.47 accepted and T0.4 continuation approved on 2026-09-18.
Latest directive, 2026-09-18: official upstream repositories and release artifacts
only; no third-party bug fixes, source rebuilds or derived images. This supersedes
the earlier image-remediation authorization and the self-imposed zero-CVE image
gate. The authorized failed-node removal and subsequent official-image bootstrap
are complete.
On 2026-09-24 the user authorized resuming T0.4 setup/readiness under this directive,
without third-party remediation or deletion of retired private artifacts.
See [the binding scope rules](../../AGENTS.md#official-artifacts-and-scope).
T0.4 completed locally on 2026-09-24. On 2026-09-25 the user authorized T0.5 real
and synthetic fixtures, restricted local permission checks and owned cleanup.
T0.5 is complete. On 2026-09-25 the user authorized T0.6 main-process request/download
proof against local fixtures. T0.6 is complete: 118 tests and 16 real signed artifact
downloads pass, including direct/forwarded HTTPS and owned cleanup. SPEC-0001 remains
Approved because actual Freelens activation is unverified. Stop for P0 review and
the actual-host gate before SPEC-0002/T1.1 implementation. No cloud access or upstream
remediation is authorized.

Selected backend: [SeaweedFS 4.47 for the local S3 lab](LOCAL-STORAGE.md), with a
verified official image digest and scoped T0.4-T0.6 runtime evidence.

This is an approved roadmap, not an approved feature specification. It captures
the supplied technical brief and local development conventions. The binding
directives are in [AGENTS.md](../../AGENTS.md). The user approved execution on
2026-09-18 with a mandatory stop after each numbered task. Report results,
verification and limitations, current progress, remaining work, and the proposed
next step; ask for decisions or preferences when necessary. Wait for continuation
before starting another task. Feature specifications and milestone reviews remain
explicit local gates.

For the concise completed/remaining view, see [ROADMAP.md](ROADMAP.md). This plan
remains the authoritative checklist; update its derived roadmap in the same iteration
as any progress or scope change. Every end-of-step report must give an extremely
short summary of completed tasks, all remaining phases to v1.0.0, and the next step
with its approval state. Updating this overview never expands authorization.

## 1. Goal And Boundaries

- Deliver v1.0.0 of the Freelens extension for Velero, developed locally from
  scratch under MIT. Proposed package: `@freelensapp/velero-extension`.
- Compatibility reference and declared host version remain exactly Freelens v1.10.3,
  with SDK v1.10.3. Freelens v2 is outside the current target. Any widening requires
  explicit approval and new evidence.
- Deliver the complete agreed v1.0.0 as soon as possible, without compromising
  quality, scope, safety, usability, or required validation. Estimates support
  sequencing and do not impose a release window or justify scope reduction.
- Produce the best operational experience for backup protection, failures, progress,
  storage availability, and recovery actions inside Freelens. Prefer native
  components where they fit; use purpose-built UI/UX where it improves the workflow.
- No extra in-cluster application is required for the extension; an existing Velero
  installation is required. Diagnostic requests and actions still create Kubernetes
  objects. Do not describe those operations as strictly read-only.
- Development and execution stay on this machine; local kind is the only target
  for fixtures and mutations. Do not use remote execution environments or hosted CI.
- The only infrastructure-access exception is strictly read-only access to an
  explicitly user-authorized external target. All data read must remain private on
  this machine, outside extension files and repository worktrees, and must never
  reach public artifacts, packages, chat/agent context, or model-visible tool output.
  Publishable evidence uses synthetic data and generic, data-free verdicts only.
  See the private-data rules in [AGENTS.md](../../AGENTS.md).
- No remote activity that changes repositories, packages, issues, discussions, or
  releases is authorized. Prepare release material locally; publication is a later
  decision. Read-only upstream source research is part of P0 after approval.
- Do not put individuals' names or software comparisons in extension artifacts.
  The original handoff is not copied verbatim for this reason.
- Do not modify existing repositories or share in-progress scaffolding with parallel
  extension work. Use an isolated, pinned app test directory when harness staging
  would otherwise overwrite the workspace's Freelens tests.

## 2. Local Recon Digest

The following sources were read for the initial planning step. They establish local
practices. The completed upstream source/schema audit is recorded separately in
[RECON-T0.1.md](RECON-T0.1.md); it does not claim runtime validation.

| Local evidence | Adopted practice |
| --- | --- |
| [Example agent guide](https://github.com/freelensapp/freelens-example-extension/blob/main/AGENTS.md) and [manifest](https://github.com/freelensapp/freelens-example-extension/blob/main/package.json) | TypeScript, pnpm, electron-vite, host-provided runtime dependencies, separate main/renderer entry points |
| [KubeSwift agent guide](https://github.com/freelensapp/freelens-kubeswift-extension/blob/main/AGENTS.md), [agent entry point](https://github.com/freelensapp/freelens-kubeswift-extension/blob/main/CLAUDE.md), and [editor instructions](https://github.com/freelensapp/freelens-kubeswift-extension/blob/main/.github/copilot-instructions.md) | Spec-first development and native extension conventions |
| [Spec template](https://github.com/freelensapp/freelens-kubeswift-extension/blob/main/docs/specs/TEMPLATE.md) and [read-only views](https://github.com/freelensapp/freelens-kubeswift-extension/blob/main/docs/specs/SPEC-0001-swiftguest-read-only-views.md) | Explicit scope, reviewed upstream version, field-level design, failure states, tests |
| [E2E infrastructure](https://github.com/freelensapp/freelens-kubeswift-extension/blob/main/docs/specs/SPEC-0003-e2e-infrastructure.md), [demo environment](https://github.com/freelensapp/freelens-kubeswift-extension/blob/main/docs/specs/SPEC-0005-local-demo-cluster.md), [fixtures](https://github.com/freelensapp/freelens-kubeswift-extension/tree/main/e2e/fixtures), and [integration tests](https://github.com/freelensapp/freelens-kubeswift-extension/tree/main/integration) | Reproducible local environment, real CRD validation, synthetic status coverage, installation of the packaged extension |
| [Pre-review spec](https://github.com/freelensapp/freelens-kubeswift-extension/blob/main/docs/specs/SPEC-0006-pre-review-agent-pass.md) and [process](https://github.com/freelensapp/freelens-kubeswift-extension/blob/main/docs/development/PROCESS.md) | Automated view checks and screenshots before milestone review; findings become regression tests |
| [Pinned integration workflow](https://github.com/freelensapp/freelens-kubeswift-extension/blob/main/.github/workflows/integration-tests.yaml) | Freelens v1.10.3 as the initial host test baseline, subject to P0 compatibility confirmation |
| [Topology rendering reference](https://github.com/freelensapp/freelens-karpenter-extension/blob/main/src/renderer/components/Topology/TreemapView.tsx) | Purpose-built operational visualization with container-aware layout and adaptive detail density |
| [Kafka architecture](https://github.com/freelensapp/freelens-kafka-extension/blob/main/ARCHITECTURE.md), [safety policy](https://github.com/freelensapp/freelens-kafka-extension/blob/main/TESTING-SAFETY.md), [completion workflow](https://github.com/freelensapp/freelens-kafka-extension/blob/main/docs/SPEC-COMPLETION-WORKFLOW.md), and [browser runbook](https://github.com/freelensapp/freelens-kafka-extension/blob/main/docs/playwright-mcp-testing.md) | Main-process ownership, explicit test safety, synchronized spec/roadmap evidence, isolated exploratory browser testing |
| [Kafka main sources](https://github.com/freelensapp/freelens-kafka-extension/tree/main/src/main) | All 71 files were read, including 39 production files and 32 test files; reuse architectural lessons, not domain-specific services |

Important adaptations:

- CRD enumeration can itself be forbidden. A failed CRD list is not evidence that
  Velero is absent; support explicitly configured namespaces and truthful RBAC states.
- The existing forwarding helpers have permissive fallback and cleanup behavior.
  Do not copy those defaults into a multi-cluster recovery tool. Fail closed on
  target resolution and own every socket, timeout, cancellation, and partial failure.
- A promise timeout does not necessarily abort network I/O. Download deadlines must
  terminate the request, decompression, polling, and any tunnel they own.
- A signed URL points to object storage, not to a Velero HTTP service. No separate
  Velero service endpoint or extraction of S3 credentials is needed for downloads.
- Do not copy workflows that require pushes, delete a persistent cluster, or replace
  another checkout's tests. Track local verification separately from hosted CI.
- `pack:dev` changes package version. Prefer explicit build, cleanup, and `pnpm pack`
  for repeatable local test artifacts without unrelated version changes.

## 3. Proposed Architecture And UI

The T0.2 proposals are detailed in [ARCHITECTURE.md](ARCHITECTURE.md),
[DESIGN.md](DESIGN.md), and [TESTING.md](TESTING.md). The initial
[spec index](../specs/README.md) contains 37 requirements with acceptance-check
mappings. SPEC-0001 is now Approved; the other two specs remain Draft.

### Process Boundaries

- Renderer: namespaced CRD stores, native or purpose-built operator views, overview,
  filters, relationships, forms, and bounded diagnostic viewers.
- Common: typed contracts, pure phase/health classifiers, reference resolution,
  duration/progress helpers, and schedule-adherence calculations.
- Main: runtime-validated IPC, explicit cluster/namespace binding, capability checks,
  write gates, diagnostic request orchestration, signed-URL transport, and cleanup.
- Prefer public `Main.K8s` for supported ordinary reads. T0.6 proves main-only
  namespaced POST and cancellation with an explicit certificate/token kubeconfig,
  not apply/upsert or private host APIs. Direct forwarding uses the same binding.
  Actual catalog/IPC integration and exec/auth-provider support are still unverified;
  the proof does not authorize a renderer-supplied kubeconfig or URL.
- Cache only suitable non-secret data, keyed by cluster and installation namespace.
  Cancel or isolate stale results when either changes. Signed URLs are never cached.
- Keep the runtime compatible with the example's host-provided React 17 and MobX.
  Start from its pinned TypeScript/pnpm tooling; do not upgrade dependencies merely
  as a side effect of scaffolding.

### Operator Experience

- The first screen is an operational overview: recent backups, in-flight work,
  unsuccessful operations, schedule adherence, and storage availability. Show the
  coverage and freshness of health data; unreadable sections remain unknown.
- Sidebar: Overview, Backups, Restores, Schedules, Backup Storage Locations, and
  Volume Snapshot Locations; secondary kinds follow in P5.
- Keep cluster context and Velero installation namespace unambiguous. Support more
  than one installation and identical resource names in different namespaces.
- Base list columns on upstream CRD printer columns, augmented by actionable fields.
  Prefer native `KubeObjectListLayout` and detail drawers when they fit the task;
  do not force every workflow into them. Preserve sorting, filtering, namespace
  controls, navigation state, and readable detail in the chosen presentation.
- T0.2 proposes native Backup/Restore lists opening a dedicated operation workspace;
  concise related resources use native drawers. Views share status/reference helpers
  and preserve the list context when returning. These choices await spec approval.
- Evaluate purpose-built backup/restore timelines, schedule-to-backup-to-restore
  relationship views, and guided recovery workflows where they make decisions
  clearer or safer. These are design candidates within the agreed feature scope,
  not additional features or mandatory visualizations. Record the rationale and
  validate the chosen interaction with realistic operator tasks.
- Show lifecycle, health, progress, validation errors, duration, and relationships
  together. Never turn `Finalizing*` or `WaitingForPluginOperations*` into completion.
- Use tabs for substantial log/result/resource/volume content. Provide search and
  useful structured views, bounded rendering, cancellation, and clear fetch states.
- Status must remain legible without color. Use host icons and semantic tokens,
  both themes, keyboard focus, useful tooltips, stable dimensions, and readable
  narrow-window layouts. No decorative dashboard cards or landing page.
- Distinguish loading, empty, not installed, forbidden, failed, partial, stale, and
  unknown states. Dangling references render as explained text, not broken links.

## 4. Delivery Sequence

The roadmap below is approved for stepwise execution, not as a batch authorization.
Final SPEC numbers and REQ IDs are allocated after recon, not manufactured from
unverified handoff assertions. Expect roughly ten feature/spec groups, split further
where needed. Each primary kind and each write action has its own small
implementation and test slice.

Optimize sequencing, reuse, and feedback loops to minimize time to a complete,
verified release. Do not weaken acceptance criteria, skip gates, or defer agreed
features solely to shorten the schedule.

### P0. Verify Contracts And Establish The Test Environment

- [x] T0.1 Review `velero-io/velero` tag `v1.18.2` and a pinned main commit. Confirm
  release availability, CRD schemas, phase enums, printer columns, controller scope,
  CLI request construction, plugin compatibility, and all open questions in section 6.
  Source/schema results and explicitly pending runtime checks: [RECON-T0.1.md](RECON-T0.1.md).
- [x] T0.2 Write the recon digest, initial architecture/design/safety documents, spec
  template, roadmap, and first approval-ready specs. Use date/role-based review
  records without personal names. Keep one canonical directive source with small
  editor-specific pointers where the established tooling needs them. Choose native
  or custom UI per operator task and document the reasoning in the design/specs.
  Delivered: architecture, UX and testing proposals, canonical safety/privacy rules,
  thin editor pointers, template and [three Draft specs](../specs/README.md).
- [x] T0.3 Scaffold only this extension from the example; remove example features and
  stale metadata. Establish local lint/type/unit/build/pack gates and future CI
  configuration without executing remote workflows or publishing anything.
  [SPEC-0001](../specs/SPEC-0001-local-foundation.md) was approved on 2026-09-18.
  Completed on 2026-09-18: scaffold, type/build, 21 tests, lint, Knip, Trunk,
  reproducible patched lockfile and package content/version checks. The authorized
  [dependency remediation](DEPENDENCY-AUDIT.md) passes the full audit with zero
  findings. Later environment/proof tasks remain separately gated.
- [x] T0.4 Before feature code, prepare an isolated local kind environment with pinned
  Velero, compatible storage plugin, and an authenticated in-cluster S3 backend.
  The [revised SeaweedFS selection](LOCAL-STORAGE.md) was accepted on 2026-09-18.
  Completed on 2026-09-24 with official artifacts only: kind 0.33.0/node 1.34.11,
  Velero 1.18.2, AWS plugin 1.14.2 and SeaweedFS 4.47. Server/node-agent and 13 CRDs
  are ready; BSL is Available, bucket authentication and isolation pass. Owned
  collision/reapply/interrupted-cleanup checks pass; temporary resources are gone.
  There are 46 setup/guard tests and 67 canonical tests. Upstream remediation is retired.
  See [the runtime evidence](TESTING.md#t04-attempt-and-recovery-gate).
  Prefer a dedicated local
  test cluster and private kubeconfig; preserve the existing persistent `kind-kind`.
  Pin node/container versions, verify networking against VPN routes, and track
  ownership so cleanup removes only resources created by these tests.
- [x] T0.5 Add real backup/restore fixtures and separate deterministic status fixtures.
  The pinned CRDs do not expose `/status`; use ordinary object creation/patches and
  verify schema acceptance and status readback. Keep synthetic phases outside active
  controller reconciliation, using a separate fixture environment if namespace
  isolation is insufficient. Clearly label synthetic evidence.
  Completed on 2026-09-25: real Backup/Restore Completed with 13 ConfigMaps and
  9 MiB matching payload, four-part multipart evidence and four retrievable gzip
  artifacts. The 13 Backup/10 Restore phases plus other primary states and a
  missing-BSL case remain unchanged in an isolated namespace. Namespace-only RBAC
  permits one read and denies seven operations. DeleteBackupRequest and guarded
  namespace cleanup remove the entire test run; infrastructure remains ready.
  [Procedure and scoped evidence](TESTING.md#t05-fixture-verification).
- [x] T0.6 Run a small main-process download proof using local fixtures: request
  creation, polling, gzip, timeout/cancellation, 404, CA verification, and signed
  Host preservation through an object-store tunnel. Decide transport support before
  implementing the diagnostic UI. A reachability limitation requires an explicit
  recorded decision, not a silently dropped requirement.
  Completed on 2026-09-25: compiled-main direct HTTPS and HTTP/HTTPS pod tunnels
  retrieve 16 real log/results artifacts; inline/referenced CA, signature/Host
  rejection, generated names and create-only collisions pass. Contract tests cover
  expiry/Failed/404, bounds, ambiguity, target changes and active-I/O cancellation.
  All 118 tests pass in normal/production builds. Temporary TLS resources, requests
  and fixtures are removed, original storage restored and environment revalidated.
  [Evidence and transport support decision](TESTING.md#t06-main-transport-proof).
  This is compiled Node proof, not actual-host activation or production IPC routing.

Exit: reviewed and pinned contracts, working local test harness, reproducible demo,
initial installable package, and evidence for the high-risk download path. Present
the first read-only specs and proposed UI design for approval.
All six numbered P0 tasks are complete. FND-10 actual-host activation remains a
foundation acceptance gate before feature implementation; SPEC-0001 is not Verified
locally. Completing T0.6 does not authorize this gate or approve the Draft P1 specs.

### P1. Primary Read-Only Experience

- [ ] T1.1 Installation detection, namespace discovery/configuration, multi-install
  selection, permissions, sidebar, and missing/forbidden/empty states.
- [ ] T1.2 Exhaustively tested two-axis phase model, progress, validation errors,
  durations, unknown values, and namespaced relationship helpers.
- [ ] T1.3 Backup list/detail, including storage locations, schedule, related restores,
  failure information, and safe removal of generic direct-delete controls.
- [ ] T1.4 Restore list/detail, with source backup/schedule and recovery progress.
- [ ] T1.5 Schedule list/detail, including paused/skipped behavior and backup history.
- [ ] T1.6 BackupStorageLocation and VolumeSnapshotLocation lists/details, including
  default location, access mode, availability, validation/sync times, and errors.
- [ ] T1.7 Overview with truthful aggregate health and navigation into the underlying
  objects. No diagnostic CR creation or operational writes in read-only browsing.

Exit: five primary kinds usable in a packaged Freelens app, all phases covered,
missing data never shown as healthy, both-theme pre-review completed.

### P2. Logs And Detailed Diagnostics

- [ ] T2.1 Main-owned `DownloadRequest` workflow: explicit confirmation and permission
  checks, allowlisted target kinds, URL/Failed/timeout exits, cancellation, and cleanup.
- [ ] T2.2 Secure streaming transport with destination/redirect policy, inline CA and
  `caCertRef` support, explicit per-cluster TLS override, compressed/decompressed
  size limits, and URL redaction. Preserve signed path/query, HTTP Host, and TLS SNI
  when forwarding.
- [ ] T2.3 Backup/restore log, results, resource-list, and volume-info viewers with
  search, structured errors, and clear unavailable/expired/forbidden states. Confirm
  exact supported payloads against the pinned version; do not expose every target.
- [ ] T2.4 Validate direct object-store access and the chosen in-cluster strategy.
  Treat a known missing artifact/404 as no artifact produced; do not imply that all
  404s prove storage is healthy. Keep other storage/auth/network errors distinct.

Exit: real local artifacts displayed end to end without CORS dependence, signed URL
exposure, full backup downloads, or uncontrolled main-process requests.

### P3. Schedule Adherence

- [ ] T3.1 Compare the cron expression, `status.lastBackup`, and newest matching
  schedule-labelled Backup. Use a proven parser compatible with Velero semantics.
- [ ] T3.2 Define grace periods and behavior for paused/new/invalid schedules, timezone
  and daylight-saving transitions, skipped runs, clock skew, incomplete history, and
  RBAC-limited reads. Do not report a missed run from unavailable evidence.
- [ ] T3.3 Surface next expected run, last observed run, and overdue state consistently
  in the schedule list, details, and overview with a clear reason.

Exit: clock-controlled tests and packaged UI scenarios establish the signal's
accuracy, including its uncertainty states.

### P4. Explicitly Authorized Actions

- [ ] T4.1 Add main-enforced write capability checks and a disabled-by-default gate
  scoped to cluster and namespace. Confirm the exact context and namespace for
  every write; reject stale targets and unintended duplicate submissions.
- [ ] T4.2 Backup now from a schedule, using the verified CLI construction semantics.
- [ ] T4.3 Create backup form with validated scope, locations, retention, and applicable
  volume options, followed by a review of the exact submitted request.
- [ ] T4.4 Restore from backup or schedule, with namespace mappings and existing-resource
  policy. Use the safest verified defaults and explicit choices for broad scope.
  Preview the exact Restore request and known affected scope; do not present a
  speculative resource list as a guaranteed dry run. Surface unresolved scope.
- [ ] T4.5 Pause/resume through `Schedule.spec.paused` with conflict-aware updates
  and explicit `skipImmediately` behavior.
- [ ] T4.6 Delete one backup through `DeleteBackupRequest`, with double confirmation.
  Validate toolbar, row, drawer, and bulk paths so extension-owned UI never offers
  direct deletion of the Backup object.

Exit: each action tested separately on local kind with resulting objects/state
checked. No real-cluster writes, bulk backup deletion, or bypass of confirmation.

### P5. Secondary Resources And Server Information

- [ ] T5.1 Read-only BackupRepository and PodVolumeBackup/PodVolumeRestore views.
- [ ] T5.2 Read-only DataUpload/DataDownload views with progress and relationships.
- [ ] T5.3 Server version and installed plugins through the verified
  `ServerStatusRequest` protocol, explicitly acknowledging request creation as a
  write. Unsupported versions and denied permissions degrade truthfully.

Exit: secondary diagnostics integrated without expanding into new mutation flows.

### P6. v1.0.0 Release Readiness

- [ ] T6.1 Complete regression, packaged integration, real-controller end-to-end,
  multi-cluster isolation, permissions, transport-security, and performance checks.
- [ ] T6.2 Final visual/accessibility pass on both themes and narrow/large desktop
  windows. Review long names, large lists/logs, cancellation, refresh, and empty/error
  states. Run Linux automation and explicitly record any additional OS checks that
  need manual execution; do not claim untested platform coverage.
- [ ] T6.3 Finish installation, permissions, safety, compatibility, troubleshooting,
  screenshots, demonstration video, and release notes using only synthetic data and
  factual product descriptions. No individuals or software comparisons.
- [ ] T6.4 Build and inspect the v1.0.0 tarball, record its checksum, dependency/license
  checks and test evidence, and provide the actual absolute install path.
- [ ] T6.5 Present the local release candidate for acceptance. Package publication,
  repository upload, discussion updates, and announcements remain blocked until
  separately authorized.

## 5. Validation And Review Gates

- Run validation locally, with all mutating Kubernetes scenarios confined to local
  kind. Any separately authorized external read must use a private, isolated local
  capture path and expose no real data through tool output or extension artifacts.
  If that cannot be guaranteed, do not run it.
- Keep real-environment data out of every versioned or packaged file, including
  fixtures, logs, screenshots, and reports. Check artifact contents before packaging
  or sharing; Git ignore rules alone do not provide the required isolation.
- Per slice: the smallest discriminating unit/component check immediately after the
  implementation change, then relevant type/lint/build checks.
- Per milestone: `pnpm type:check`, `pnpm lint:check`, `pnpm knip:check`,
  `pnpm test:unit`, documentation checks, and `pnpm build`, with order adapted to
  tools that remove build output. These are planned commands, not commands run now.
- Pack: `pnpm build && pnpm clean:tgz && pnpm pack`; install the resulting tarball
  through the pinned Freelens v1.10.3 Electron integration harness. Confirm SDK/host
  compatibility first and stage the harness without altering shared repositories.
- Deterministic UI tests: every operation phase; missing/forbidden CRDs; several
  installations; identical object names; dangling links; partial/unknown health;
  disabled writes; stale-result/cross-cluster isolation; direct-delete prevention.
- Local runtime tests: actual backup, restore, storage artifacts, request failures,
  in-cluster access, and every action. Synthetic status fixtures supplement these
  tests; they cannot prove controller or transport behavior.
- Pre-review: automated DOM checks, navigation, screenshot evidence in both themes,
  console-error capture, and layout/keyboard checks. Convert findings into repeatable
  regressions before the milestone's human review.
- Custom views must also handle empty datasets, narrow or zero-sized containers,
  resizing, and large datasets. Validate keyboard access and accessible structured
  detail where a visualization alone cannot convey the information.
- Review record: tested versions, artifact, command, pass/fail/skip counts, cleanup
  outcome, residual limitations, and verdict. Use role/date labels without names.
- Spec lifecycle: Draft -> Approved -> Implemented -> Verified locally. Keep hosted
  CI/release status separate. Unexecuted tests or manual checks remain visibly open.
- Fix blocking review findings before repeating their patterns in later milestones.

## 6. Velero Contract Checklist

This section began as the handoff checklist. Source/schema evidence and corrections
are now recorded in [RECON-T0.1.md](RECON-T0.1.md). Runtime claims remain unverified
until their planned local kind checks. `main` alone is not a version pin.

### Resource And Phase Baseline

- Reviewed release: `v1.18.2` at `c253c7fe37d78c9b7e55c68544f7c5b2608712d8`;
  comparison main: `60163e0827e72658bb6546165a727300170e628b`. AWS plugin v1.14.2
  is in the documented compatible series. Actual image/runtime pins are verified
  in T0.4. Do not silently substitute another version or assume it includes main.
- Namespaced `velero.io/v1` kinds: `Backup`, `Restore`, `Schedule`,
  `BackupStorageLocation`, `VolumeSnapshotLocation`, `BackupRepository`,
  `PodVolumeBackup`, `PodVolumeRestore`, `DeleteBackupRequest`, `DownloadRequest`,
  `ServerStatusRequest`.
- Namespaced `velero.io/v2alpha1` kinds: `DataUpload`, `DataDownload`.
- Backup phases (13): `New`, `Queued`, `ReadyToStart`, `FailedValidation`,
  `InProgress`, `WaitingForPluginOperations`,
  `WaitingForPluginOperationsPartiallyFailed`, `Finalizing`,
  `FinalizingPartiallyFailed`, `Completed`, `PartiallyFailed`, `Failed`, `Deleting`.
- Restore phases (10): `New`, `FailedValidation`, `InProgress`,
  `WaitingForPluginOperations`, `WaitingForPluginOperationsPartiallyFailed`,
  `Finalizing`, `FinalizingPartiallyFailed`, `Completed`, `PartiallyFailed`, `Failed`.
- Classify terminal/in-flight independently from clean/carrying-failure/unknown.
  Unknown future values remain unknown. Confirm deletion and partial-failure
  semantics rather than inferring them from their names.
- Schedule phases: `New`, `Enabled`, `FailedValidation`; relevant fields:
  `spec.paused`, `spec.skipImmediately`, `spec.useOwnerReferencesInBackup`,
  `status.lastBackup`, `status.lastSkipped`.
- BSL: `spec.default`, `spec.accessMode`, `status.phase` (`Available`/`Unavailable`),
  `status.lastValidationTime`, `status.lastSyncedTime`. Do not use deprecated
  `status.accessMode`. An Available location with ReadOnly access cannot accept a
  new backup; expose availability and writability separately.

### Discovery And Relationships

- Discover namespaces from a cluster-wide BSL list when permitted. Fall back to
  explicit namespace configuration under namespace-scoped RBAC. An empty BSL list
  alone does not prove the absence of Velero or discover every incomplete install.
- Primary resources usually live in their installation namespace; support multiple
  installs and incomplete installation state without assuming the name `velero`.
- Relationships: `Restore.spec.backupName`, `Restore.spec.scheduleName`,
  `Backup.spec.storageLocation`, `Backup.spec.volumeSnapshotLocations`.
- Labels: `velero.io/schedule-name`, `velero.io/backup-name`,
  `velero.io/restore-name`, `velero.io/storage-location`. Do not require
  ownerReferences unless the schedule explicitly enables them. References are
  scoped by cluster and namespace and may dangle.

### Diagnostic And Action Protocols

- `ServerStatusRequest` source confirms generated-name creation, New/Processed,
  version/plugins/processedTimestamp, and controller expiry cleanup. Verify the
  runtime, permissions, deadline, and cleanup behavior on kind.
- v1.18.2 `DownloadRequest` has no Failed phase or status.message; the reviewed
  main has both. Support explicit failure when present and bounded waiting when not.
- Expected creation: `<target>-<uuid>` name plus `spec.target.kind/name`; poll for
  a download URL, explicit failure, or timeout; fetch promptly and decode gzip.
- Verify artifact formats, missing artifacts, expired URL behavior, and size bounds.
  A FailedValidation backup may have no log even when a URL was issued.
- Handoff target inventory: `BackupLog`, `BackupContents`, `BackupVolumeSnapshots`,
  `BackupItemOperations`, `BackupResourceList`, `BackupResults`, `RestoreLog`,
  `RestoreResults`, `RestoreResourceList`, `RestoreItemOperations`,
  `CSIBackupVolumeSnapshots`, `CSIBackupVolumeSnapshotContents`, `BackupVolumeInfos`,
  `RestoreVolumeInfo`. This inventory is not a feature allowlist: v1.0.0 exposes
  logs, results, resource lists, and approved volume info only; never BackupContents.
- BSL supports inline `caCert` and `caCertRef` already in v1.18.2; the latter refers
  to a same-namespace Secret/key. Host participation in S3 signing is confirmed.
  Verify certificate resolution, skip-verify, destination/redirect policy, and
  preserved Host/SNI with the selected in-cluster S3 backend at runtime.
- Verify create/restore/schedule actions from the CLI, including defaults, namespace
  mappings, existing-resource policy, schedule-template copying, and validation.
- Backup deletion creates `DeleteBackupRequest` with `generateName: <backup>-`,
  `spec.backupName`, `velero.io/backup-name`, and `velero.io/backup-uid` labels.
  Direct Backup deletion leaves stored data and may be undone by synchronization.
- Pinned host source exposes menu handlers, editable/removable flags, and list
  overrides. Verify every extension-owned Backup deletion path in packaged tests.
  Its public main K8s API lacks generic execute/create; choose and verify a
  create-only adapter instead of treating apply as generated-name creation.
- Source anchors for recon: upstream `pkg/cmd/cli/backup`, `pkg/cmd/cli/restore`,
  `pkg/cmd/cli/schedule`, `pkg/cmd/util/downloadrequest`, API types, CRD schemas,
  and the controllers handling diagnostic requests.

### Required Fixture Matrix

- Actual successful backup and restore with retrievable artifacts on the selected
  local S3 backend. Qualification gates are in [LOCAL-STORAGE.md](LOCAL-STORAGE.md).
- Completed, PartiallyFailed, and FailedValidation backup presentations, including a
  missing-BSL case. Record which are real controller outcomes and which are static.
- One active and one paused schedule; one ReadOnly and one Unavailable BSL.
- Static valid status fixtures for every backup and restore phase, incomplete
  progress, missing timestamps, and validation-error cases. Cover unknown/future
  enum values in unit/mocked tests without weakening the real CRD schemas.
- Missing CRDs, denied discovery/list/create, multiple namespaces, dangling
  references, old/new download failure behavior, 404, TLS errors, unreachable store,
  cancellation, oversized payload, and cluster switch while requests are pending.

## 7. Current State And Next Approval

- Completed: technical handoff read; required local reference practices reviewed;
  directives and this plan persisted; stepwise execution approved; T0.1 source/schema
  audit recorded in [RECON-T0.1.md](RECON-T0.1.md); T0.2 design documents, template,
  instruction pointers and initial specs; T0.3 scaffold/tooling, dependency
  remediation and refreshed local package; T0.4 official local environment and
  scoped readiness/isolation/cleanup verification; T0.5 real/static/permission
  fixture suite with controller-mediated backup cleanup.
- Direction clarified on 2026-09-18: fastest complete delivery without quality or
  goal reduction; native components are preferred where suitable, with custom UI/UX
  encouraged where it improves the operator experience.
- Safety clarified on 2026-09-18: local execution and local-kind-only mutations;
  explicitly authorized external read-only access is allowed only when all real
  environment data stay private on this machine and outside public/project artifacts
  and chat/agent context. No cluster has been accessed during the recon so far.
- Current state: T0.6 completed on 2026-09-25 after the separately authorized
  fixture step. Six numbered tasks are complete and 28 remain. The compiled main
  retrieves 16 signed local log/results artifacts through explicit direct/tunneled
  routes, with inline/referenced CA and preserved signing. Owned cleanup restores
  the original storage and removes requests, certificates, temporary container and
  fixtures. The dedicated environment remains ready. Actual Freelens activation,
  production catalog/IPC integration and PV/CSI recovery are not proven.
  SPEC-0001 remains Approved; SPEC-0002 and SPEC-0003 remain Draft.
- T0.2 verification: local document links, unique sequential IDs and all 37
  requirement-to-check mappings checked. Local Docker/Node/CLI prerequisites were
  probed without starting services or contacting Kubernetes; this is not runtime proof.
- T0.3 results: SDK/host 1.10.3, Node 24.15.0, pnpm 10.34.4; 21 source, CommonJS
  and consumer tests pass with zero failures/skips, as do type-check, normal/production
  builds, Biome, both Knip modes and Trunk. Reinstallation preserves the patched
  lockfile. Decoder interop also passes on Node 22.12.0. No hosted CI was run.
- Historical T0.3 archive: version 0.1.0-alpha.0, 9 files and 3,295 bytes; version
  stability, SDK exclusion and relative source maps verified. Checksum and evidence
  are recorded in [SPEC-0001](../specs/SPEC-0001-local-foundation.md). T0.6 adds
  bundled main dependencies; current package evidence is in [TESTING.md](TESTING.md#t06-main-transport-proof).
- Historical T0.3 security: the full resolved audit reported zero findings after the authorized tar
  and decoder updates plus a one-line consumer import patch; prior counts were 62
  then 13. No waiver was used. The added T0.6 dependency graph was not scanned;
  details and exact pins are in [DEPENDENCY-AUDIT.md](DEPENDENCY-AUDIT.md).
- Current code checks: 118 tests pass in normal and production modes, including
  52 setup/fixture and 45 diagnostic checks; type-check, touched-file Biome and both
  Knip modes pass. Repository lint exits 0
  with one pre-existing warning in the retired remediation script. Runtime readiness
  and the complete transport proof, including cleanup and retained-environment
  revalidation, also exit 0. Kubectl is declared as an external CLI in Knip.
- Not started: Velero feature UI, actual-host/production IPC integration or release
  work. No cloud account or real
  cluster was accessed. No new upstream scan, repair or image rebuild was performed.
- Next step, on continuation: P0 review and FND-10 actual-host activation, then
  SPEC-0002/T1.1 approval for installation discovery. No feature work is authorized.
  Do not revive upstream remediation or a zero-CVE laboratory gate.
- Approval record: 2026-09-18, user approved proceeding one step at a time with a
  results/progress/remaining-work report and a pause after each step; subsequently
  authorized T0.2, then approved SPEC-0001 and authorized T0.3 only. The user also
  reaffirmed continuous documentation updates and the Freelens v1.10.3 compatibility
  baseline, then approved the two scoped dependency fixes and their consumer tests.
  The user subsequently authorized T0.4, its local-storage review, then accepted
  SeaweedFS 4.47 and resumed T0.4. Later permission covered image remediation and
  removal/recreation of only the failed node; its removal completed. The latest
  explicit directive supersedes the remediation permission: official artifacts
  only, no third-party fixes, extension-focused work. On 2026-09-24 the user resumed
  T0.4 under these limits; it completed locally. On 2026-09-25 the user authorized
  T0.5, then T0.6; both are complete. Further acceptance/feature work and deletion
  of retired custom artifacts remain unauthorized by these completion records.
