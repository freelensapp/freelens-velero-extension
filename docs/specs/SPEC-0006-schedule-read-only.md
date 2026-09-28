# SPEC-0006: Read-Only Schedules

- **Status:** Approved
- **Date:** 2026-09-28
- **Milestone / tasks:** M2 / T1.5
- **Reviewed Velero:** v1.18.2, `c253c7fe37d78c9b7e55c68544f7c5b2608712d8`; compared with v1.18.3, `cd3fd10b093dad32ee284e27fcba4e9073c9c94b`
- **Reviewed main:** `60163e0827e72658bb6546165a727300170e628b`
- **Freelens validation target:** v1.10.3, `3da74415bff57a77c6e08cb5f538191ce87bac17`
- **Dependencies:** [target discovery](SPEC-0002-installation-discovery.md), [states and Backups](SPEC-0003-backup-read-only.md)
- **Approval:** Approved by the lead maintainer on 2026-09-28, as drafted

Governed by [AGENTS.md](../../AGENTS.md).

## Goal

Let operators see what each schedule is asked to do, whether it is enabled, paused or
invalid, when it last submitted a backup and how the backups it made ended, without
the view claiming that a run was missed or that a workload is protected.

## Scope Baseline

The [recon](../development/RECON-T0.1.md#actions-and-schedule-adherence) confirms
three Schedule phases, New, Enabled and FailedValidation, and that
`status.lastBackup` records a submission, not a completion. The adherence of a
schedule, which is its expected runs, its next run and what is overdue, is the
fourth milestone (T3.1 to T3.3): this slice shows what the objects say and the
backups that exist, and computes nothing from the cron expression.

Included: the list of the Schedules, the workspace of a schedule with the history
of its backups, the section in the details of the host, and the way between a
schedule and its backups in both directions. Excluded, with their owners: expected
and next runs, overdue and the reading of the time zone (M4); pause, resume and
backup now (M5).

## User Scenarios

1. **P1, paused:** Given a schedule that is paused and whose phase is Enabled, when
   the list is read, then paused is a fact of its own beside the phase, and nothing
   presents the schedule as running.
2. **P1, invalid:** Given a schedule in FailedValidation, when it is opened, then its
   validation errors and its expression as written are shown.
3. **P1, a submission is not a success:** Given a schedule whose last backup failed
   its validation, when the list is read, then the time of the last submission and
   the outcome of the newest backup are two values, and the second says failed.
4. **P1, history:** Given a schedule with backups, when it is opened, then its
   backups are there from the newest, each with its phase, its failure, its time
   and its duration, and each leads to its workspace and back.
5. **P2, history that cannot be read:** Given an identity that reads the schedules
   and not the backups, when a schedule is opened, then its history is said not
   readable, and is not an empty one.
6. **P2, a template that leads nowhere:** Given a schedule whose template names a
   storage location that is not there, or one that is read-only, then that is said
   where the template is shown.

## Requirements

| ID | Contract | Acceptance check |
| --- | --- | --- |
| REQ-064 | List the schedules of the selected installation in the native list with the columns name, installation, schedule, paused, last submission, newest backup, validation and age, each with a stable ID, an order and a part in the search; keep the state of the list when a schedule is opened and closed | SCHED-01 |
| REQ-065 | Open a dedicated read-only workspace from a row, and add a compact section to the details the host shows of a Schedule; both read through the same helpers | SCHED-02 |
| REQ-066 | Show the cron expression as it is written, with its time zone prefix when it has one; when it has none, say that the time zone is the one of the Velero server, which the view does not read. Compute no next run, no expected run and no overdue state | SCHED-03 |
| REQ-067 | Keep paused and phase as two facts. Say of a paused schedule that Velero does not read it while it is paused, so its phase and its validation errors are the ones written before the pause. Say of a schedule that reports no phase that Velero has not read it yet and, when it is paused, that it will not until it is resumed. Show `status.lastSkipped` when the object carries it. Say `skipImmediately` in words when it is true: when Velero reads the schedule again it skips the run that is due and records the time in last skipped | SCHED-04 |
| REQ-068 | Name `status.lastBackup` the last submission, never the last backup or the last success; show beside it the newest backup of the schedule that exists, with its phase and its failure | SCHED-05 |
| REQ-069 | The history of a schedule is the backups of the same namespace that carry its name in the label `velero.io/schedule-name`, each with the state and the evidence the helpers give. The time of an operation is its start time when the object reports one and its creation time when it does not: the reviewed release writes no start time into an operation that failed its validation or has not started, and the view says which of the two times it shows. The history goes from the newest by the time of the operation, equal times by name. It says that it holds the backups that exist now. A distance between two backups is never named a missed run | SCHED-06 |
| REQ-070 | Count the history by what it holds: completed, carrying a failure, in flight, unknown. The counts are of the backups that exist and are shown as such; a history that was not read has no counts | SCHED-07 |
| REQ-071 | Show the template as the object carries it, with the rules of the scope of a backup: a field that is not set is said not set. Show whether the backups are owned by the schedule, as written. Resolve the storage location and the snapshot locations the template names, and say when the storage location is absent, read-only or not reported Available. When the template names no storage location, say that Velero uses the one marked default, with its name, or the one the server names in its settings when none is marked | SCHED-08 |
| REQ-072 | List the restores that name the schedule, with their state, and say that Velero writes the name of the schedule also into a restore asked from one of its backups | SCHED-09 |
| REQ-073 | The schedule of a backup, in the workspace of the backup, leads to the workspace of the schedule; a backup of the history leads to its workspace; each view returns to the one it was opened from | SCHED-10 |
| REQ-074 | No surface of the extension offers to edit, delete, select, pause, resume or run a schedule | SCHED-11 |
| REQ-075 | A read that fails keeps what was read before and says when, for the schedule and for its history separately; late answers and objects created again are told apart; no timer is left | SCHED-12 |
| REQ-076 | Both themes, the keyboard alone, long names and long expressions, a window of 900x650 and twice the zoom; the marks of the history carry their meaning without the colour | SCHED-13 |
| REQ-077 | The slice only reads, and empty, loading, denied, not served, failed, stale and partly read are distinct for the list, the workspace, the history and each reference | SCHED-14 |

## Design

The sidebar gets Schedules under Velero, after Restores. The check DISC-08 is
updated with the entry.

- **Standard or ad hoc view, and why.** The list is the native list of the host.
  The detail is a workspace of the extension, and its history is a view made for
  the purpose: what an operator asks of a schedule is how its backups went over
  time, and a table of fields does not answer it. Until this milestone the
  [design](../development/DESIGN.md) proposed the drawer of the host for this kind:
  the first milestone found that the details of the host carry the edit and the
  delete the host gives to every kind, which the extension cannot take away, so a
  detail the extension owns is a view of its own. It is the same view for every
  kind of Velero: one way in, one way back. The details of the host get a section
  that only reads, and a link to the workspace when the schedule is of the
  installation selected.
- **Safety.** The slice writes nothing, and the tests prove it as for the Restores.

The workspace, from the top:

| Band | Content | Source |
| --- | --- | --- |
| Way back and name | Schedules, or the view it was opened from | The address |
| Status | Validation, paused, the expression and its time zone, last submission, last skipped, whether the backups are owned by the schedule, age, installation and cluster | `spec`, `status` |
| Validation errors | Each error as reported; absent when there is none | `status.validationErrors` |
| History | The strip and, under it, the list of the same backups | The backups read of the installation |
| Template | What each backup is asked to include, where it goes and how long it is kept | `spec.template` |
| Restores | The restores that name the schedule | The restores read of the installation |

The strip of the history places each backup that exists on a line of time, from
the oldest of them to now, by the time of the operation. A mark has the shape and
the icon of its state, which the phase marks of the lists already use, and its
name, time, duration and outcome when it is pointed at or reached with the
keyboard. A backup that did not start is at its creation time, and its mark says
that it did not start. Backups close to each other share a mark that says how many
they are, and that says so when one of them carries a failure. Nothing is drawn
where no backup is: not a missed run, not an expected one. The list under the
strip holds the same backups, 20 at a time from the newest, and is what a screen
reader and a narrow window use.

Three facts of the reviewed release are said where they help, in words:

- a schedule that is paused is not read by Velero until it is resumed;
- Velero submits no backup of a schedule while one of its backups reports no
  phase, New or InProgress; the other phases in flight do not hold it back;
- an expression without a time zone is read in the time zone of the server.

The newest backup of the list column is the first of the history. A schedule with
no backup among the ones that exist says so, and says nothing of whether it ever
ran.

## Tests

Planned homes: unit tests of the view of a schedule and of its history; component
tests of the page, of the workspace and of the strip; the static schedules, enabled,
paused and invalid, which exist. Added to the static fixtures, where no controller
reads them: a schedule in phase New, one with no phase, one paused with no phase,
one with `skipImmediately` true, one with a last skipped time. Added to the
fixtures of the views: a schedule with a history of backups in several phases,
whose times are taken from the clock of the run and whose newest backup failed its
validation and has no start time; one with a time zone prefix; one whose template
names a location that is not there, one a read-only location, one no location. The
second reader is the one of the [Restores](SPEC-0005-restore-read-only.md#tests).

| Check | Layer | Requirements | Scenario and expected evidence |
| --- | --- | --- | --- |
| SCHED-01 | Packaged app | REQ-064 | Search, order and resize; a schedule opened and closed leaves the list where it was |
| SCHED-02 | Component/packaged | REQ-065 | A row opens the workspace; the details of the host agree on paused, validation, expression and last submission |
| SCHED-03 | Unit/component | REQ-066 | Five fields, a descriptor, `TZ=` and `CRON_TZ=` prefixes, an empty and an invalid expression: shown as written, and no time computed from any |
| SCHED-04 | Unit/component/packaged | REQ-067 | Enabled, paused with Enabled, paused with FailedValidation, New, no phase, paused with no phase, an unknown phase: two facts each, and the words of each; `skipImmediately` true, false and not set; a last skipped time |
| SCHED-05 | Unit/component | REQ-068 | A last submission with a newest backup that failed, with one in flight, with none that exists |
| SCHED-06 | Unit/component/packaged | REQ-069 | Backups of two schedules and of none, equal times, a newest backup with no start time: it is the first, at its creation time, and said so; no word for the distances |
| SCHED-07 | Unit | REQ-070 | The counts of a history in every phase; no counts for a history that was denied |
| SCHED-08 | Unit/packaged | REQ-071 | A template with fields unset; a storage location that is absent, one read-only, one that reports nothing; no location named, with a default marked and with none; the owner references set and not set |
| SCHED-09 | Unit/component | REQ-072 | Restores that name the schedule, and none; the restores denied |
| SCHED-10 | Packaged app | REQ-073 | From a backup to its schedule, from the history to a backup, and each way back |
| SCHED-11 | Component/packaged | REQ-074 | No control that writes, by pointer, menu or keyboard; the objects unchanged |
| SCHED-12 | Unit/component | REQ-075 | The schedules read and the backups failing, and the other way round; a late answer; no timer left |
| SCHED-13 | Pre-review | REQ-076 | The list, the workspace and the strip in both themes, at the two sizes and at twice the zoom; the strip with the keyboard |
| SCHED-14 | Adapter/local RBAC/packaged | REQ-077 | Each state with its words; the second reader, to which the history is denied; the evidence of DISC-07 taken again with the Schedules open |

## Success Criteria

All 14 checks pass before this spec is Verified. No view of a schedule shows a time
that no object reports.

Manual review: with the synthetic schedules, tell which one is paused, which one is
invalid and how the last backups of one went; follow a backup and come back.
Expected: the answer is on the page, and nothing on it reads as a promise that the
schedule ran when it should. Record role, date and verdict.

## Assumptions And Decisions

- Backups expire and are deleted: the history is what the cluster holds now. How
  far back it goes is the oldest backup that exists, and the view says so.
- A schedule is matched to its backups by the label and the namespace, as the
  reviewed release does, and not by the name of the backup.
- The time of an operation, of REQ-069, is one rule for the milestone: the
  [Overview](SPEC-0008-overview.md) orders and places the operations by it. Without
  it a schedule whose backups all fail their validation would show an older
  completed backup as its newest.
- The strip groups the backups that would be drawn over each other. The groups
  depend on the width: the list under it never groups.
- This replaces the assumption of the [Backups](SPEC-0003-backup-read-only.md) on
  the drawers of the host for the related kinds.

## Evidence And Deviations

Approved on 2026-09-28. No implementation, tests or runtime evidence yet. The Schedule schema is the same
in the reviewed release and in the one after it: see the
[recon](../development/RECON-T0.1.md#upstream-drift-watch), which holds the facts
of the reviewed release this spec rests on.
