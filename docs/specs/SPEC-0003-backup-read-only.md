# SPEC-0003: Operation States And Read-Only Backups

- **Status:** Approved
- **Date:** 2026-09-18
- **Milestone / tasks:** M1 / T1.2 and T1.3
- **Reviewed Velero:** v1.18.2, `c253c7fe37d78c9b7e55c68544f7c5b2608712d8`
- **Reviewed main:** `60163e0827e72658bb6546165a727300170e628b`
- **Freelens validation target:** v1.10.3, `3da74415bff57a77c6e08cb5f538191ce87bac17`
- **Dependencies:** [foundation](SPEC-0001-local-foundation.md), [target discovery](SPEC-0002-installation-discovery.md)
- **Approval:** Approved by the lead maintainer on 2026-09-27, as drafted

## Goal

Let operators inspect backups and identify their actual lifecycle, failures, progress
and relationships without confusing a running operation with a finished backup.

## Scope Baseline

The [recon](../development/RECON-T0.1.md) confirms 13 Backup and 10 Restore phases.
T1.2 implements their shared pure contracts; T1.3 delivers one primary resource UI,
Backup, with references to its schedule, locations and restores. Those related kinds'
full views are later P1 tasks, not part of this slice.

Included: typed models/stores, two-axis state, progress/duration, list, operation
workspace, compact host detail contribution, and read-only relationships. Excluded:
artifact fetching/viewers (P2), adherence (P3), every mutation (P4), secondary views
(P5), and recovery guarantees. No placeholder diagnostic tabs are delivered now.

## User Scenarios

1. **P1, ongoing failure:** Given a backup in FinalizingPartiallyFailed with all items
   counted, when opened, then it still shows an in-flight lifecycle and failure
   signal, not completed or successful.
2. **P1, diagnosis:** Given a FailedValidation backup, when opened, then validation
   errors, submitted scope and storage reference are visible even when no log exists;
   no diagnostic request is created.
3. **P1, safe navigation:** Given equal backup names in different installations, when
   a row or relationship is opened, then only the selected installation's object is
   shown, and a missing/unreadable reference is not a broken or misleading link.
4. **P2, efficient inspection:** Given a large synthetic list, when filtered and an
   operation opened and closed, then the list's sort/filter/scroll state is preserved
   and the interface stays responsive in both themes.

## Requirements

| ID | Contract | Acceptance check |
| --- | --- | --- |
| REQ-024 | Use static CRD metadata and typed spec/status fields with API/store registration; domain helpers work on plain resource data without extension instance methods | BACK-01 |
| REQ-025 | Classify all 13 Backup and 10 Restore phases on separate lifecycle/failure axes; only evidence-defined terminal phases finish, and unknown values remain unknown | BACK-02 |
| REQ-026 | Preserve phase, validation errors, reported error/warning counts and evidence gaps separately; warnings alone are not a failed operation or successful protection claim | BACK-03 |
| REQ-027 | Compute bounded item progress from valid counts, retain raw reported values, and never infer terminal state from 100%; missing/invalid values stay indeterminate | BACK-04 |
| REQ-028 | Compute elapsed/completed duration only from valid timestamps; terminal operations with missing end time do not keep an invented running timer | BACK-05 |
| REQ-029 | Provide the proposed Backup columns with stable IDs, meaningful sorting, search and installation scope; preserve list state across navigation | BACK-06 |
| REQ-030 | Open a dedicated read-only operation workspace from a Backup row and provide a consistent compact host detail contribution, without diagnostic prefetch or placeholder controls | BACK-07 |
| REQ-031 | Resolve schedule, BSL, VSL and restore relationships by fields/labels within the same cluster and namespace, tolerate dangling references and distinguish inaccessible from absent | BACK-08 |
| REQ-032 | Exclude generic edit/delete and bulk deletion from every extension-owned Backup surface, including context menu, drawer toolbar and keyboard paths | BACK-09 |
| REQ-033 | Refresh/watch updates retain truthful stale/partial state, reject old selection results and distinguish recreated UIDs; unmount disposes owned subscriptions/timers | BACK-10 |
| REQ-034 | Both themes, keyboard navigation, focus return, long labels, narrow windows and zoom satisfy the shared UI contract | BACK-11 |
| REQ-035 | A 1,000-object synthetic list mounts at most 100 data rows and meets the defined warm interaction budget without hiding records or reducing test data | BACK-12 |
| REQ-036 | Empty, loading, forbidden, network-failed and partially readable backup/detail/reference states remain distinct and do not fabricate counts or healthy data | BACK-13 |
| REQ-037 | This entire slice is read-only: row/details/navigation/refresh issue no Kubernetes mutations, diagnostic requests or implicit permission-review POSTs | BACK-14 |

## Design

The [architecture](../development/ARCHITECTURE.md) defines object identity and IPC;
[DESIGN.md](../development/DESIGN.md) owns layout and navigation. Choose a native
Backup table for repeated scanning and a full-width operation workspace for current
stage, scope, progress and errors. Reuse helpers for the compact host drawer rather
than maintaining an independent status interpretation.

Required read fields: metadata identity/timestamps/labels; spec namespaces/resources,
selectors, storageLocation, volumeSnapshotLocations and retention; status phase,
progress, startTimestamp, completionTimestamp, expiration, validationErrors, errors
and warnings. Omitted, deprecated and unrecognized values must not become fabricated
defaults. No write fields exist in this slice.

| Phase family | Lifecycle | Failure evidence |
| --- | --- | --- |
| New, Queued, ReadyToStart, InProgress | In flight | Preserve available counters/errors; do not claim final success |
| WaitingForPluginOperations, Finalizing | In flight | Same evidence rule; never terminal |
| WaitingForPluginOperationsPartiallyFailed, FinalizingPartiallyFailed | In flight | Carries failure |
| Completed | Terminal | Completed outcome; also surface contradictory reported errors or missing evidence |
| PartiallyFailed, Failed, FailedValidation | Terminal | Carries failure; distinguish validation from execution failure |
| Deleting (Backup only) | Deleting, not successful completion | Prior outcome cannot be inferred from deletion |
| Missing/unrecognized phase | Unknown | Preserve reported evidence without guessing lifecycle |

Restore uses the same rules for its actual phase set; it does not acquire Backup-only
Queued, ReadyToStart or Deleting values. Validation-error arrays and nonzero error
counts remain visible even if inconsistent with the phase. Missing counters are not
zero. Do not mutate stored objects to normalize their presentation.

Progress percentage is available only for finite nonnegative counts with a positive
total and completed count no greater than total. Otherwise retain the reported counts
and mark percentage unavailable/estimated. Never divide by zero, show NaN, or hide
an in-flight finalization because its item ratio is one.

Elapsed duration uses now minus a valid start for an in-flight object; terminal
duration uses valid start/end. Invalid, future or reversed evidence does not produce
a negative or continuously growing completed duration. Tests control the clock.

Related-object reads respect family-specific RBAC. Do not show zero related restores
when their list failed. Links upgrade only from reliable destination evidence; missing
or unavailable targets remain useful text with a reason. Stage display is current
state, not an invented stage-by-stage history.

## Tests

Planned homes: shared phase/progress/duration/reference unit tests; Backup page and
detail component tests; synthetic phase fixtures; packaged Backup navigation and
menu checks. Reuse test helpers and integration journey files from the foundation.

| Check | Layer | Requirements | Scenario and expected evidence |
| --- | --- | --- | --- |
| BACK-01 | Unit/host contract | REQ-024 | Plain host-style resource copies support all helpers and register the correct kind/version/plural |
| BACK-02 | Table-driven unit/static UI | REQ-025 | Exhaust all 13/10 phases, every partially-failed in-flight phase, Deleting, empty and unknown values |
| BACK-03 | Unit/component | REQ-026 | Missing/zero/nonzero errors, warnings and validation failures remain distinct, including inconsistent Completed data |
| BACK-04 | Unit/component | REQ-027 | Zero totals, missing/negative/out-of-range counts and 100% in-flight work never yield NaN or false completion |
| BACK-05 | Fake-clock unit | REQ-028 | Missing start/end, future/reversed timestamps, in-flight elapsed time and terminal duration have defined outputs |
| BACK-06 | Packaged app | REQ-029 | Search, sort and resize columns; open/back restores filters, selected scope and scroll |
| BACK-07 | Component/packaged | REQ-030 | Row opens workspace; host drawer agrees on phase/scope; neither creates diagnostic requests |
| BACK-08 | Unit/local RBAC/packaged | REQ-031 | Fields/labels without ownerReferences, equal names, absent BSL, forbidden Restore list and slow references resolve truthfully |
| BACK-09 | Packaged app/adapter spy | REQ-032 | Row, context menu, toolbar, drawer, bulk selection and supported keyboard paths expose no direct edit/delete or mutation |
| BACK-10 | Component/local watch | REQ-033 | Old-target response, recreated UID, failed refresh and unmount leave no cross-scope data or owned timer/subscription leak |
| BACK-11 | Pre-review | REQ-034 | Both themes at target window sizes and zoom; keyboard open/back returns focus; long values never overlap |
| BACK-12 | Packaged performance | REQ-035 | 1,000 synthetic objects, <=100 mounted data rows; p95 below 250 ms across 20 warm filter/selection interactions |
| BACK-13 | Component/packaged | REQ-036 | Empty, denied, failing, stale and partially readable resources each preserve the correct presentation |
| BACK-14 | Adapter spy/local audit | REQ-037 | Open/filter/detail/reference/refresh uses GET/list/watch only; fail on any create/update/patch/delete or access-review request |

## Success Criteria

All 14 checks pass before this spec is Verified. Every released phase has an
asserted lifecycle/failure interpretation and the packaged UI agrees with it. No
in-flight phase appears finished and no action in the read-only journey mutates the
cluster. List performance satisfies the shared budget on the recorded local machine.

Manual review: using synthetic Completed, FailedValidation and FinalizingPartiallyFailed
objects, identify outcome, stage, errors and source storage; follow a valid reference
and inspect a dangling one, then return to the filtered list. Expected: the state and
uncertainty are clear without consulting raw YAML, and navigation restores context.
Record judgment separately from automated tests with role/date/verdict.

## Assumptions And Decisions

The dedicated workspace is the proposed primary Backup detail view; native drawers
remain appropriate for concise related resources. The same structure later supports
Restore and diagnostics, but those features need their own approved slices. No
historical stage data or recovery guarantee can be inferred from these CRDs alone.

## Evidence And Deviations

Approved on 2026-09-27; no implementation or executed acceptance tests yet. T1.2
and T1.3 are separate pull requests. No deviations have been accepted. The upstream
drift watch of the start of the milestone is in the
[recon](../development/RECON-T0.1.md#upstream-drift-watch): the release after the
reviewed one has the same Backup schema and the same phases of Backup and Restore.
