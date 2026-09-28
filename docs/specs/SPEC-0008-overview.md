# SPEC-0008: Overview Of An Installation

- **Status:** Approved
- **Date:** 2026-09-28
- **Milestone / tasks:** M2 / T1.7
- **Reviewed Velero:** v1.18.2, `c253c7fe37d78c9b7e55c68544f7c5b2608712d8`; compared with v1.18.3, `cd3fd10b093dad32ee284e27fcba4e9073c9c94b`
- **Reviewed main:** `60163e0827e72658bb6546165a727300170e628b`
- **Freelens validation target:** v1.10.3, `3da74415bff57a77c6e08cb5f538191ce87bac17`
- **Dependencies:** [target discovery](SPEC-0002-installation-discovery.md), [states and Backups](SPEC-0003-backup-read-only.md), [Restores](SPEC-0005-restore-read-only.md), [Schedules](SPEC-0006-schedule-read-only.md), [locations](SPEC-0007-locations-read-only.md)
- **Approval:** Approved by the lead maintainer on 2026-09-28, as drafted

Governed by [AGENTS.md](../../AGENTS.md).

## Goal

Give the operator one page that says, of the selected installation, what needs
attention, what is in flight, how the last operations went and how much of all this
could be read, and that leads to each object. The page does not reduce an
installation to one colour or one number.

## Scope Baseline

The page is computed from the five lists the state of an installation already
reads: it asks the cluster nothing of its own. It is the last slice of the
milestone because every line of it leads to a view of the four slices before.

Included: the page, its rules and its history of the recent operations. Excluded,
with their owners: missed and expected runs (M4); the version of the server and its
plugins (M3); the secondary kinds (M4). The metrics of Velero are not read: the
extension needs nothing in the cluster beyond Velero itself. No claim is made about
whether a backup can be restored.

## User Scenarios

1. **P1, what needs attention:** Given an installation with a storage location
   that is unavailable, a schedule whose last backup failed its validation and a
   restore that is finalizing with a failure, when the Overview opens, then the
   three are listed with the reason of each, and each leads to its object.
2. **P1, nothing to report is not health:** Given an installation where no rule
   finds anything and the restores cannot be read, then the page says that nothing
   in what was read needs attention, and that the restores were not read.
3. **P1, in flight:** Given backups and restores in flight, then they are listed
   with their phase, their progress and their elapsed time.
4. **P1, the last operations:** Given the operations of the last seven days, when
   the history is read, then each is at its time with its outcome, and the same
   operations are in a list under it.
5. **P1, a server that stopped:** Given storage locations last validated days ago
   and a schedule that reports no phase, then both are listed: they are what the
   objects say of a Velero that is not at work.
6. **P2, a part that fails:** Given the schedules that stop answering while the
   page is open, then the band of the schedules shows what was read before and
   when, and the other bands are as they were.
7. **P2, a large installation:** Given 1,000 backups and 1,000 restores, when the
   window of the history is changed, then the page answers within the budget.

## Requirements

| ID | Contract | Acceptance check |
| --- | --- | --- |
| REQ-093 | The Overview is the first entry under Velero and the page the entry of Velero opens. Opening it asks the cluster what every other view asks, and nothing more | OVER-01 |
| REQ-094 | Say what was read: for each of the five families the number of its objects when it was read, its state when it was not, and the time of the read when it is stale. Each leads to its list | OVER-02 |
| REQ-095 | Give no value for the installation as a whole: no score, no percentage, no single mark. Every number says what it counts. The words healthy, protected and safe are not used | OVER-03 |
| REQ-096 | List what needs attention by the rules of the table below and by no other. Each item names its object, its reason in words and the time the reason refers to when there is one, and leads to the object, or to the list when the item is of no single object | OVER-04 |
| REQ-097 | A rule gives items only from families that were read. Items from a stale read say that they were read before. A family that was not read gives one line that says what could not be checked | OVER-05 |
| REQ-098 | When no rule gives an item, say that nothing in what was read needs attention, and list what was not read. Never say that all is well | OVER-06 |
| REQ-099 | List the backups and the restores in flight, with phase, failure, item progress and elapsed time, from the oldest by the time of the operation. The elapsed time of one that has no start time is said not reported | OVER-07 |
| REQ-100 | Show the newest completed backup of the installation, by completion time, with that time; and on the line of each schedule the newest completed one of its backups. Say none among the backups that exist when there is none, and unknown when the backups were not read. Say once that a completed backup is what Velero reports, not a test of a restore | OVER-08 |
| REQ-101 | Show on a line of time, in two rows, the backups and the restores whose time is in the window, each with the mark of its state. The time of an operation is the one of [REQ-069](SPEC-0006-schedule-read-only.md): an operation that did not start is at its creation time, with a mark that says so. The window is 24 hours, 7 days or 30 days, 7 when none was chosen, and the choice is kept as a preference. The same operations are in a list under it, from the newest, 10 at a time. Nothing is drawn where no operation is | OVER-09 |
| REQ-102 | Show one line for each schedule and for each storage location, with the facts their lists show, 10 at most: the ones a rule names first, then by name, with the number of the others and the way to the list | OVER-10 |
| REQ-103 | Every cell, item, mark and line leads to an object or to a list. Nothing leads to a view that does not exist | OVER-11 |
| REQ-104 | With 1,000 backups and 1,000 restores spread over the 30 days before, a change of the window answers within 250 ms at the 95th percentile across 20 warm interactions, and a read again does not move what the operator is looking at | OVER-12 |
| REQ-105 | Each band has its own empty, loading, denied, not served, failed, stale and partly read state: a band that cannot be shown takes nothing from the others | OVER-13 |
| REQ-106 | Both themes, the keyboard alone, a window of 900x650 and twice the zoom. The marks carry their meaning without the colour, and the line of time is read with the keyboard | OVER-14 |
| REQ-107 | The page only reads; late answers of another target are not shown; a page that closes leaves no timer | OVER-15 |

The rules of REQ-096, each one a pure function on what was read:

| Rule | Needs attention when | Reason shown |
| --- | --- | --- |
| A1 | A storage location reports Unavailable | The message of Velero, and the last validation |
| A2 | A storage location reports no availability | Velero has not reported on it |
| A3 | The availability of a storage location may be out of date, by the rule of [REQ-082](SPEC-0007-locations-read-only.md) | The last validation, and the frequency when the object names one |
| A4 | No storage location is marked default, or a location marked default is read-only or not reported Available | What is marked, and that the server may name a default in its settings |
| A5 | A schedule is in FailedValidation | Its validation errors; for a paused schedule, that they are the ones written before the pause |
| A6 | A schedule that is not paused reports no phase | Velero has not read it |
| A7 | The newest backup of a schedule that is not paused, by the time of the operation, ended with a failure | The backup, its phase and its failure |
| A8 | The template of a schedule that is not paused names a storage location that is absent, read-only or not reported Available | The location and what is known of it |
| A9 | A backup or a restore in flight carries a failure | Its phase and its failure |
| A10 | A restore, or a backup that is of no schedule, ended with a failure, and the time of the operation is in the window | Its phase and its failure |

## Design

- **Standard or ad hoc view, and why.** Ad hoc. The task is to decide where to
  look first, across five kinds: no list of one kind answers it. The page is made
  of bands without frames, in the typography and with the tokens of the host, and
  every band is a way into the views of the other specs.
- **Safety.** The page writes nothing and asks nothing of its own. The suite counts
  on the API server, for the kinds of Velero, no write and one list of the storage
  locations of the cluster for each read, with the Overview open as with any other
  view.

The page at 1440x900, from the top. At 900x650 the bands that share a row are one
under the other.

| Row | Band | Content | Source | A click leads to |
| --- | --- | --- | --- | --- |
| 1 | Target bar | The cluster and the installation | The state of the installation | The choice of the installation |
| 2 | What was read | Five cells: Backups, Restores, Schedules, Backup Storage Locations, Volume Snapshot Locations, each with its number or its state | The five reads | The list of the kind |
| 3, left | Needs attention | The items of the rules, in the order below | The rules A1 to A10 | The object, or the list |
| 3, right | Newest completed backup | Of the installation | The backups | The backup |
| 3, right | In flight | The operations in flight, the ones that wait among them | The backups and the restores | The operation |
| 4 | Recent operations | The line of time, the choice of the window, the list | The backups and the restores | The operation |
| 5, left | Schedules | One line for each, with its newest completed backup | The schedules and the backups | The schedule |
| 5, right | Storage | One line for each storage location | The storage locations | The location |

The line of time is the one of the history of a
[schedule](SPEC-0006-schedule-read-only.md#design), with two rows: the backups over
the restores. Operations that would be drawn over each other share a mark with
their number, and the mark of a group that holds a failure says so.

The order of the items that need attention is fixed: what is in flight, then the
storage, then the schedules, then what ended, each group from the newest, and by
name where there is no time. It does not change while the operator reads: an item
that a read again adds is added in its place, and the scroll stays.

A read again every 15 seconds is the one of every view. The page shows when it
last read, as the target bar does.

The checks of the first milestone that this slice changes are updated with it:
DISC-08, for the entries of the sidebar, and DISC-10, because the store of the
preferences holds the window beside the two maps of the namespaces.

## Tests

Planned homes: unit tests of every rule and of the aggregation, table-driven, on
plain data; component tests of each band; the fixtures of the other specs of the
milestone. Added to the fixtures of the views: backups and restores whose times
are taken from the clock of the run, so that each of the three windows holds some
and leaves some out, a restore that failed its validation among them; twelve
schedules in one installation. The 1,000 backups and the 1,000 restores of the
budget are spread over the 30 days before the run. A suite that finds fixtures
older than its windows puts them in place again.

| Check | Layer | Requirements | Scenario and expected evidence |
| --- | --- | --- | --- |
| OVER-01 | Packaged app | REQ-093 | Velero opens the Overview; the API server counts, for the kinds of Velero, one list of the cluster for each read and no write |
| OVER-02 | Component/local RBAC/packaged | REQ-094 | Five families read; one denied; one stale: a number, a state, a time |
| OVER-03 | Component/packaged | REQ-095 | The words and the marks of the page searched for a value of the whole, in every state of the fixtures: none |
| OVER-04 | Table-driven unit/packaged | REQ-096 | Each rule with a case that gives an item and one that gives none; a paused schedule gives none for A6, A7 and A8; a schedule whose newest backup failed its validation gives A7; the items of the fixtures on the cluster |
| OVER-05 | Unit/component | REQ-097 | The restores denied: no item of a restore, and the line that says so; the storage stale: its items marked |
| OVER-06 | Unit/component | REQ-098 | No item with everything read; no item with a family denied |
| OVER-07 | Unit/component/packaged | REQ-099 | Operations in flight in every phase, with and without progress, with and without a start time; none |
| OVER-08 | Unit/component | REQ-100 | A completed backup of a schedule and of none; none that completed; the backups denied |
| OVER-09 | Unit/component/packaged | REQ-101 | The three windows; operations at the same time, without a start, at the edge of the window; the choice kept across two starts |
| OVER-10 | Component/packaged | REQ-102 | Twelve schedules, two of them named by a rule: ten lines, those two first, the number of the others, the way to the list |
| OVER-11 | Packaged app | REQ-103 | Every kind of link of the page followed, and the way back to the Overview |
| OVER-12 | Packaged performance | REQ-104 | 2,000 operations: the 95th percentile of 20 changes of the window, each window holding operations; the scroll after a read again |
| OVER-13 | Component | REQ-105 | Each band in each state while the others are read |
| OVER-14 | Pre-review | REQ-106 | The page in both themes, at the two sizes and at twice the zoom; the line of time with the keyboard |
| OVER-15 | Adapter/unit/packaged | REQ-107 | The evidence of DISC-07 taken again; a late answer after a change of installation; no timer left |

## Success Criteria

All 15 checks pass before this spec is Verified. Every item that needs attention is
traced to one rule and to the objects it read. The page never says more than what
was read.

Manual review: on the demo, say in one minute what is wrong with the installation
and what is in flight, then reach each of those objects. Expected: the order of the
page is the order in which an operator would look, and nothing reads as a verdict
on the installation. Record role, date and verdict.

## Assumptions And Decisions

- **The aggregate health of the roadmap is what needs attention beside what was
  read**, not a value of the whole. One mark for an installation would show as
  well one whose restores cannot be read, or whose only failure is the one that
  matters. The lead maintainer approved this reading with the spec, and the row
  of the roadmap has its words.
- **The rules are the ones of the table.** A rule that needs an expectation, such
  as a backup that did not run, waits for the adherence of the fourth milestone.
- **A failure of a schedule that a later backup followed is history, not
  attention.** Rule A7 reads the newest backup of a schedule alone; the earlier
  ones are on the line of time.
- **A paused schedule gives no item for a phase it does not report, for its
  backups and for its template.** That it is paused is in its line: whether a
  pause is a problem is a judgment of the operator. Its validation errors stay an
  item, with the words of rule A5.
- **The window starts at seven days** and is one preference of the extension, not
  one for each cluster. The lead maintainer confirmed it at approval.

## Evidence And Deviations

Approved on 2026-09-28. No implementation, tests or runtime evidence yet. Nothing this page reads changes
between the reviewed release and the one after it, but the field of the Restore
the [Restores](SPEC-0005-restore-read-only.md) cover.
