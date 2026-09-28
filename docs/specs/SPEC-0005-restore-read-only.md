# SPEC-0005: Read-Only Restores

- **Status:** Implemented
- **Date:** 2026-09-28
- **Milestone / tasks:** M2 / T1.4
- **Reviewed Velero:** v1.18.2, `c253c7fe37d78c9b7e55c68544f7c5b2608712d8`; compared with v1.18.3, `cd3fd10b093dad32ee284e27fcba4e9073c9c94b`
- **Reviewed main:** `60163e0827e72658bb6546165a727300170e628b`
- **Freelens validation target:** v1.10.3, `3da74415bff57a77c6e08cb5f538191ce87bac17`
- **Dependencies:** [target discovery](SPEC-0002-installation-discovery.md), [states and Backups](SPEC-0003-backup-read-only.md)
- **Approval:** Approved by the lead maintainer on 2026-09-28, as drafted

Governed by [AGENTS.md](../../AGENTS.md).

## Goal

Let operators see where a restore is, what it was asked to restore, from what and
into where, and what failed, without taking a running restore for a finished one or
a finished one for a recovered workload.

## Scope Baseline

The [recon](../development/RECON-T0.1.md) confirms 10 Restore phases, and the
[states](SPEC-0003-backup-read-only.md) of the first milestone already read them on
two axes. The state of an installation already reads the restores of the selected
namespace with the other four families: this slice asks the cluster nothing more.

Included: the list of the Restores, the workspace of a restore, the section in the
details of the host, the references of a restore, and the way between a backup and
its restores in both directions. Excluded, with their owners: the log, the results,
the resource list and the volume information of a restore (M3); PodVolumeRestore and
DataDownload (M4); the creation of a restore (M5). No placeholder for any of them.

## User Scenarios

1. **P1, running with a failure:** Given a restore in
   WaitingForPluginOperationsPartiallyFailed with all its items counted, when it is
   opened, then it is in flight and carries a failure, and is neither finished nor
   healthy.
2. **P1, what went where:** Given a restore with two namespace mappings and an
   existing resource policy, when it is opened, then each source namespace is beside
   its destination, the policy is the one the object carries, and what is not set is
   said not set.
3. **P1, the source:** Given a restore whose backup is there, when its source is
   followed, then the workspace of that backup opens and the way back returns to the
   restore. Given a restore whose backup is not there any more, then the name of the
   backup is shown with the reason and is not a link.
4. **P1, failed validation:** Given a restore asked from a schedule that has no
   completed backup, when it is opened, then its validation errors are shown, its
   times are said not reported, and no source backup is made up for it.
5. **P2, efficient inspection:** Given a long list, when it is searched and ordered
   and a restore is opened and closed, then the list is where it was.
6. **P2, restricted:** Given an identity that may not read the restores, when the
   Restores are opened, then the view says that access is denied and gives no count.

## Requirements

| ID | Contract | Acceptance check |
| --- | --- | --- |
| REQ-050 | List the restores of the selected installation in the native list with the columns name, installation, source, phase, failure, item progress, started and duration, each with a stable ID, an order and a part in the search. The source is the backup, then the schedule when the object names one. Keep the search, the order, the widths and the scroll when a restore is opened and closed | REST-01 |
| REQ-051 | Open a dedicated read-only workspace from a row, and add a compact section to the details the host shows of a Restore; both read through the same helpers, neither asks Velero for a log or a result, and no empty tab is shown | REST-02 |
| REQ-052 | Show the source as the object carries it. Velero writes the backup it chose into a restore asked from a schedule, and the schedule of the backup into a restore asked from a backup: when the object names both, the view shows both and does not say which one was submitted. When it names none, none is inferred | REST-03 |
| REQ-053 | Show the scope as the object carries it, without defaults of the view: included and excluded namespaces and resources, selectors, namespace mappings as pairs of source and destination, cluster resources, restore of the persistent volumes, node ports, existing resource policy, item operation timeout, the filter of the restored status, the uploader settings, the number of hook specifications with their names, and the reference to a resource modifier. Say that Velero adds its own entries to the excluded resources and fills the item operation timeout when it takes a restore, so that these two are not only what was submitted. A field that is not set is said not set | REST-04 |
| REQ-054 | Read the status through the helpers of the states: phase on two axes, validation errors, failure reason, counts of errors and warnings, hooks attempted and failed, item operations attempted, completed and failed, item progress and durations. A restore that failed its validation or has not started reports no start time in the reviewed release: its times are said not reported. A Completed restore is said completed, never recovered, verified or healthy | REST-05 |
| REQ-055 | Resolve the source backup, the schedule and, through the backup, its storage location by name within the same cluster and namespace. A reference that resolves is a link to the view of its kind when that view exists; an absent, inaccessible, unknown or not yet read target stays a name with its reason | REST-06 |
| REQ-056 | The restores of a backup, in the workspace of the backup, lead to the workspace of each restore. A view opened from another one returns to it first, with Escape and with the way back, and the list under it is where it was | REST-07 |
| REQ-057 | No surface of the extension offers to edit, delete or select a restore, by pointer, menu or keyboard | REST-08 |
| REQ-058 | A read that fails keeps what was read before and says when; a late answer of another target and a restore created again with the same name are not shown as the one that was open; a view that closes leaves no timer | REST-09 |
| REQ-059 | Both themes, the keyboard alone, the focus back on the row that was open, names of 63 characters, a window of 900x650 and twice the zoom keep every value readable and nothing over something else | REST-10 |
| REQ-060 | With 1,000 synthetic restores the list mounts at most 100 rows and answers within 250 ms at the 95th percentile across 20 warm interactions, measured as BACK-12 is | REST-11 |
| REQ-061 | Empty, loading, denied, not served, failed, stale and partly read are distinct for the list, for the workspace and for each reference; none of them shows a count that was not read | REST-12 |
| REQ-062 | The slice only reads: the list, the workspace, the references and the read again send `GET` and nothing else, and create no request to Velero and no access review | REST-13 |
| REQ-063 | A field that a later release adds is read when the object carries it and never required: the reference `spec.resourcePolicy` of v1.18.3 is shown beside the resource modifier when it is there | REST-14 |

## Design

The [architecture](../development/ARCHITECTURE.md) owns the identity of a target and
the reads; [DESIGN.md](../development/DESIGN.md) owns layout and navigation. The
sidebar gets Restores under Velero, after Backups.

- **Standard or ad hoc view, and why.** The list is the native list of the host: it
  is scanned, searched and ordered like every other list. The detail is a workspace
  of the extension, the same one a backup has: a restore is an operation with a
  stage, a scope and failures, its mappings need the width of the page, and the log
  and the results of the third milestone will be read in the same place. The details
  of the host get a section that only reads, and a link to the workspace when the
  restore is of the installation selected.
- **Safety.** The slice writes nothing. The reader sends `GET` alone, which its unit
  test asserts; the suite in the packaged application compares the version of every
  object of Velero before and after, and counts on the API server that no write of
  a kind of Velero and no request to Velero was made.

The workspace, from the top:

| Band | Content | Source |
| --- | --- | --- |
| Way back and name | Restores, or the view the restore was opened from | The address |
| Status | Phase and what it means, failure, errors and warnings, started, elapsed or duration, completed, installation and cluster | `status`, through the helpers of the states |
| Current stage | New, In progress, Plugin operations, Finalizing, Finished, with the current one marked; item progress under it | `status.phase`, `status.progress` |
| Errors and evidence | Validation errors, failure reason, contradictions, what is not reported; hooks and item operations when they are reported | `status` |
| Source | Backup and schedule as the object names them, each with what is known of its target; the storage location of the backup | `spec.backupName`, `spec.scheduleName`, the reads of the installation |
| Into | The namespace mappings, one line for each source and its destination. When none is set: not set, what is restored of a namespace goes into the namespace of the same name | `spec.namespaceMapping` |
| Scope | The fields of REQ-053, with the note on the two that Velero fills | `spec` |

Required read fields: metadata identity, timestamps and labels; every field of
REQ-053 in `spec`; phase, progress, start and completion timestamps, validation
errors, failure reason, errors, warnings, hook status and the three counts of the
item operations in `status`. The content of a hook is not shown in this slice: how
many specifications there are, and their names. A ConfigMap a reference names is
not read.

The way between two views travels in the address: the restore that is open, and
the view it was opened from. An address that names a restore of another
installation opens none: the workspace says that no restore of that name is in the
namespace selected.

The list of the Restores and the list of the Backups are given the same store and
the same page, written once for the kinds of the milestone: the checks BACK-06 and
BACK-12 of the Backups are run again in the pull request that does it. The check
DISC-08 is updated with the entry this slice adds to the sidebar. Non-happy states
follow the ones of the Backups: a list that was never read shows no rows and no
count.

## Tests

Planned homes: unit tests of the view of a restore and of its references; component
tests of the page and of the workspace; the static fixtures of every Restore phase,
which exist. Changed in the fixtures: the static backup and restore in
FailedValidation carry no start and no completion time, as the reviewed release
leaves them. Added to the fixtures of the views: a restore with two mappings, one
that names a schedule alone, and a second reader, which reads the restores, the
schedules and the locations of its namespace and not the backups. Added to the long
list: 1,000 restores.

| Check | Layer | Requirements | Scenario and expected evidence |
| --- | --- | --- | --- |
| REST-01 | Packaged app | REQ-050 | Search, order, a column made wider and a scroll; a restore opened and closed leaves the list where it was; the source of a restore that names both |
| REST-02 | Component/packaged | REQ-051 | A row opens the workspace; the details of the host agree on phase, failure and progress; the API server counts no request to Velero |
| REST-03 | Unit/component | REQ-052 | Backup alone, schedule alone, both and neither: each shows what the object names and nothing more |
| REST-04 | Unit/component/packaged | REQ-053 | Two mappings, a policy, fields left unset, a selector with expressions: every value as the object carries it, no `undefined`, no default of the view, and the note on the two fields Velero fills |
| REST-05 | Table-driven unit/packaged | REQ-054 | The 10 phases, a phase of the other kind, an empty and an unknown one; a Completed restore that reports errors; a restore in FailedValidation with its times not reported; one row for each phase on the cluster |
| REST-06 | Unit/local RBAC/packaged | REQ-055 | For the backup, the schedule and the storage location: a target that is there, one that is not, one denied to the second reader, a list that failed. A link only for the first |
| REST-07 | Packaged app | REQ-056 | From a backup to its restore and back to the backup, then to the list, with the pointer and with the keyboard |
| REST-08 | Component/packaged | REQ-057 | No checkbox, no menu, nothing on a right click, nothing on Delete and Backspace; the objects unchanged |
| REST-09 | Unit/component | REQ-058 | A late answer, a restore created again, a read that fails, no timer left when the view closes |
| REST-10 | Pre-review | REQ-059 | The list and the workspace in both themes, at the two sizes and at twice the zoom; opened and closed with the keyboard |
| REST-11 | Packaged performance | REQ-060 | 1,000 restores, the rows mounted at most, the 95th percentile of 20 warm interactions |
| REST-12 | Component/packaged | REQ-061 | Empty, denied, failed, stale, not served and partly read, each with its words; the reader of a part sees the denial |
| REST-13 | Adapter/local audit | REQ-062 | The same evidence as DISC-07 of the [discovery](SPEC-0002-installation-discovery.md), taken again with the Restores open |
| REST-14 | Unit/component | REQ-063 | An object with `spec.resourcePolicy` shows it; one without shows nothing in its place. Mock only: the pinned schema does not keep the field |

## Success Criteria

All 14 checks pass before this spec is Verified. Every Restore phase on the cluster
has the state the helpers give it. No view of a restore mutates the cluster.

Manual review: with the synthetic restores, open one that is finalizing with a
failure, one that failed validation and one with mappings; follow the source of one
and come back. Expected: what was restored, from what and into where is clear
without the YAML, and nothing suggests that a completed restore was verified.
Record role, date and verdict.

## Assumptions And Decisions

- The object is what Velero keeps of a restore, not what was submitted: Velero
  completes it when it takes it. The view says so where it matters, for the source
  and for the two fields of the scope, and makes no claim on the rest.
- The hooks of a restore are counted and named, not shown: their content belongs
  with the results of the third milestone, where what they did can be read.
- Restores older than the ones the cluster still holds are not known to the view,
  and it does not say how many there were.
- The budget of REST-11 is measured as the one of BACK-12: on what the list takes
  to answer.

## Evidence And Deviations

Approved on 2026-09-28 and implemented the same day. The upstream drift watch of the
start of the milestone is in the
[recon](../development/RECON-T0.1.md#upstream-drift-watch), with the facts of the
reviewed release this spec rests on: between that release and the one after it the
Restore gains `spec.resourcePolicy`, which REQ-063 covers; its phases are the same.

What is [shown of a restore](../../src/common/restore-view.ts) and what it
[refers to](../../src/common/references.ts) are pure functions on plain data; the
[list](../../src/renderer/pages/restores-page.tsx) is the native list of the host,
given what the extension read; the
[workspace](../../src/renderer/pages/restore-workspace.tsx) is a view of its own;
the [section](../../src/renderer/details/restore-details.tsx) in the details of the
host reads a restore through the same helpers. The layers are the ones of
[TESTING.md](../development/TESTING.md): unit and component tests in Vitest, the
suites of the views in a packaged Freelens v1.10.3 against the test environment.

| Check | Evidence |
| --- | --- |
| REST-01 | Unit: every column has its order and its part in the search. Packaged, on the restores of the views: a search by the name, by the progress, by the duration and by what did not start; an order by source, read from the rows; a column made wider; a restore opened and closed leaves them as they were. On the list of a thousand: the search, an order by the start read from the rows and the scroll, kept through the view of a restore and the one of its backup. The source of a restore that names both is the backup, then the schedule |
| REST-02 | Component and packaged: a row opens the workspace; the details of the host show the same phase, failure, counters, progress and source. Component: opening asks nothing of the reader. Packaged: the API server counts no read of the five families while a restore is opened between two reads of the installation, and counts them when a read is asked |
| REST-03 | Unit and component: a backup alone, a schedule alone, both, neither, and names that are not names. With both, the view says that the object does not tell which one was submitted; with both and a failed validation, that what was refused is in the validation errors |
| REST-04 | Unit, component and packaged: two mappings, a mapping without a destination, a policy, fields that are not set, a selector with its expressions, a filter of the status that names nothing; every value as the object carries it, `undefined` and `NaN` nowhere, the note beside the two fields Velero fills, and what the release does with a field that is not set as the [recon](../development/RECON-T0.1.md#start-of-the-second-milestone-2026-09-28) records it |
| REST-05 | Unit, table-driven: the 10 phases, the phases of a backup, an empty and an unknown one; a Completed restore that reports errors; the counters the release does not write. Packaged: one row for each phase on the cluster, each value in the cell of its column; a restore in FailedValidation with its times not reported; the restore the controller of the test environment ran, read as the release left it |
| REST-06 | Unit: for the backup and the schedule, a target that is there, one that is not, one denied, one of a list that failed, one of an earlier read, and the same while the list is asked again. Component: the three reasons a storage location is not known. Packaged: a way to the backup that is there, a name with its reason for the one that is not; with the second reader, the backup denied and not absent, before and after a read that is asked |
| REST-07 | Component and packaged: from a backup to its restore and back, from a restore to its backup and back, over the list the first view was opened from, with the pointer and with the keyboard. Packaged: the changes of the address are counted in the frame for six steps, the way back and Escape among them, and each step is one |
| REST-08 | Component: the list is given no selection, no menu and no command that adds or removes; the view has the way back and the ways to the other views, and no other control. Packaged: no checkbox, no menu; a right click, Delete and Backspace are followed by a wait in which no menu and no dialog appears, while the same click on the list the host shows of the same objects opens its menu; the objects unchanged |
| REST-09 | Component: a late answer of the installation selected before, a restore created again with the same name, which is said in words, a read that fails, the views closed when another installation is selected, and no timer left when the view closes |
| REST-10 | Pre-review: the list and the workspace, with what it restores into and its scope, and the workspace of a restore whose name, source and mapped namespaces have 63 characters, in both themes, at the two sizes and at twice the zoom, each checked once the theme and the size are the ones that were set and left as a picture that was written; a restore opened, followed to its backup and closed with the keyboard alone, and closed with Escape after a click on a text |
| REST-11 | Packaged: see below |
| REST-12 | Component: empty, not read yet, read again, denied, failed, stale and not served, each with its words, and no count of a list that was not read. Packaged: the restores denied to the first reader, on their list, while a read is asked and after it; the backups denied to the second reader, on their list and as the source of a restore. Partly read is a restore whose source cannot be: it is shown, with what is not known of it |
| REST-13 | Unit: the reader sends `GET` and nothing else. Packaged, as DISC-07 of the [discovery](SPEC-0002-installation-discovery.md#evidence-and-deviations), taken with the Restores open: the version of every synthetic object, the identity of the ones of the real installation, no request to Velero, and no request that is not a read counted by the API server for any kind of `velero.io`, but the one its own controller writes into its storage location. The access reviews are not counted apart: the host asks them for its own lists, with the same identity |
| REST-14 | Unit: an object with `spec.resourcePolicy` shows it beside the resource modifier; one without shows nothing in its place. Component and packaged: an object without the field has no line for it |

Sixty-one changes made to the code on purpose, one for each rule a view or a
fixture could get wrong, each made a unit or a component test fail. Five more
were made in the packaged application, where the suites of the views and the
pre-review failed on each: a column too narrow for its words, one too narrow for
a date of another language, a view that reads the installation when it opens,
two changes of the address for one step, and the layout of the host inside
itself. The pull request of the task names them.

The measure of REST-11, on 2026-09-28, in Freelens v1.10.3 on macOS 26 with an
Intel Core i7-9750H and 16 GiB, the test environment running on the same machine:

| Measure | Value |
| --- | --- |
| Restores in the list | 1,000, as the list counts them |
| Rows mounted at once, at most | 28 |
| Interactions, after five to warm | 20: ten searches, five restores opened, five closed |
| Response, 95th percentile | 91 ms, against a budget of 250 ms |
| Response, median and slowest | 35 ms and 103 ms |
| From the key or the click, 95th percentile | 334 ms |

The list of the Backups, measured again in the same run on the list and the page
written for every kind: 1,000 backups, 28 rows mounted at most, a response of
103 ms at the 95th percentile.

What was decided while implementing, inside the requirements:

- **The views that are open are in the address, in the order they were opened.**
  The way back takes the last one away. A view opened from another one is shown
  over the same list, on the same page: the list is not drawn again, and it is
  where it was when the last view is closed. The rules are in the
  [architecture](../development/ARCHITECTURE.md#the-lists-and-the-views-of-one-object).
- **The list and the page are written once**, for every kind of the milestone, and
  the Backups use them: their checks of the first milestone ran again, in the
  suites of the views.
- **The status of a synthetic operation is what the release writes.** The ones
  that did not start had a start time, a progress and counters; the ones that
  started had counters of zero, and items to do after the work had ended: no
  installation shows any of these, and the fixtures of the first milestone were
  corrected. The spec of a synthetic restore the release took carries what the
  release adds to it. The rest of a synthetic object is what a test needs of it.
- **A restore that completed has a note**: completed is what Velero reports, and
  whether what was restored works is not in the object.
- **What the release does with a field that is not set is beside the field**, as
  what the release does: the value stays not set.
- **That nothing went wrong is marked only for an operation the release
  counted.** One that did not start, one that is at work and one that failed
  without a counter say that no failure is reported, or the failure, with the mark
  of what is not known and the reason beside the counters. It holds for the
  Backups too.
- **In the view of one object a phase is read whole.** It is cut in a list, where
  a row has one line.
- **The views that are open are of the installation they were opened in.** When
  another one is selected they close, with one change of the address: the way
  back would name what the other does not have.
- **A restore created again under the name that is open is said in words**, for as
  long as the view is open, and one that is being deleted is said so.
- **What is read again keeps what the last read said of it** until the read ends:
  the target bar says that the installation is being read.
- **In a list narrower than 1,200 pixels the installation gives its room** to the
  columns that say what happened: it is the same in every row, and the target bar
  says it. In a list of 1,000 pixels or more the failure, the progress, the start
  and the duration hold their words whole, in whatever way the language of the
  operator writes a date: the suites measure the longest of them in the cell of
  its column, and not only what the machine they run on shows. The name, the
  source, the phase and the storage share what is left. It holds for the Backups
  too.
- **An address of the first milestone**, which named the backup alone, opens the
  list: no release carried it.
- **Every page of the group has the tabs of the group.** The host gives them to a
  page when the first entry of the sidebar that leads to the page is an entry of
  the group: with the Restores the Backups would have been the only page without
  them, and the page of the Restores had the layout of the host inside itself,
  with its margins twice and a bar to scroll it sideways at twice the zoom. The
  pre-review did not see it, and does now.

One deviation, recorded with the one of the
[states](SPEC-0003-backup-read-only.md#evidence-and-deviations) it comes from, and
waiting for the approval of the lead maintainer at the review of the milestone.
REQ-054 reads the counts of the errors and of the warnings, of the hooks and of
the item operations through the helpers of the states, which said that a counter
that is missing is not zero. The reviewed release writes no counter of zero: on an
installation no restore that ended without an error carries one, and every one of
them would be said to report no count. A counter that is missing from an object
whose phase the release gives after it counted is read as the count of none it
stands for, and is told from a zero that is written; the view says whose zero it
is. Counters the release writes together are read together: with one of them in
the object, the others were counted. The hooks of a restore are counted when the
restore is finalized, whatever its phase says: they are read by their status
being in the object. Everywhere else a counter that is missing stays not
reported.
