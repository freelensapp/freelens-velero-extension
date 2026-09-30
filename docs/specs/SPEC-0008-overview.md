# SPEC-0008: Overview Of An Installation

- **Status:** Verified
- **Date:** 2026-09-30
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

Approved on 2026-09-28. Nothing this page reads changes between the reviewed
release and the one after it, but the field of the Restore the
[Restores](SPEC-0005-restore-read-only.md) cover.

What the page says of an installation is computed by
[pure functions](../../src/common/overview.ts) from the five reads of the
installation, the clock and the [window](../../src/common/window.ts): they are
given plain data and ask nothing. The [page](../../src/renderer/pages/overview-page.tsx)
shows what they answer, in bands. The line of time is the
[one](../../src/common/operation-line.ts) of the history of a schedule, drawn in
[two rows](../../src/renderer/components/operation-lines.tsx). What is around the
page, which is the target bar, what is missing of the installation and the view
that is open over it, is the [frame](../../src/renderer/components/views-frame.tsx)
the pages of the lists have.

| Check | Evidence |
| --- | --- |
| OVER-01 | Packaged: the Overview is the first entry under Velero and the first tab of the group, and the entry of Velero is marked while it is shown; the entry of Velero opens its group, leads to no page and asks the cluster nothing; before an installation is chosen the API server counted one list of the storage locations of the cluster and no read of a family; once one is chosen, a list of each of the five families in its namespace and nothing more of the cluster; the Overview opened from another page, between two reads of the installation, is counted no read at all |
| OVER-02 | Unit and component: a number for a family that was read, its state for one that is denied, not served, failed or not read yet, the time of the read for one that is stale; each cell leads to its list. Packaged: the five numbers of the installation of the fixtures are the ones the suite counts on the cluster; with the first reader the restores and the snapshot locations are said denied, with the second the backups, and none is a count of zero |
| OVER-03 | Unit: no function answers a value of the whole. Component: the words of a verdict, a percentage outside the progress of an operation and a meter are looked for in every state of the page. Packaged: the same in six installations, the one of the long lists among them, in what is shown and in what the marks say to who points at them |
| OVER-04 | Unit, table-driven: each of the ten rules with a case that gives an item and one that gives none; a paused schedule gives none for A6, A7 and A8; a schedule whose newest backup failed its validation gives A7, by the time the backup was created; an installation with no storage location; a backup whose schedule is not there any more; objects of the same name in another namespace and of another kind; the order of the groups and inside a group. Packaged: the fourteen items of the installation of the fixtures in the order of the page, ten shown and four asked for, with the reason of each rule in words; every rule gave an item on the cluster, in one installation or in another |
| OVER-05 | Unit and component: with the restores denied no item is of a restore, and one line says what the rules did not look at; the items of a read that is not the last one say that they were read before, and the page says beside their number that a part of what was read is of an earlier read. Packaged: the same line for the restores with the first reader and for the backups with the second, with no item of what was denied |
| OVER-06 | Unit and component: no item with everything read, and no item with a family denied, which the page says beside what was not read; with none of the four families the rules look at read, the page says that nothing was read, and not that nothing needs attention. Packaged: the installation the controllers of Velero are at work in has no item, and the page says that nothing in what was read needs attention |
| OVER-07 | Unit: the operations in flight in every phase, from the oldest, the ones with no time last. Component and packaged: with and without progress, with and without a start; one that waits is at the time it was created, which is said, and did not start; none in flight is said when both kinds were read; with one kind read and the other not, that none of the first is in flight and that the second is not known |
| OVER-08 | Unit and component: the newest completed backup by the time of its completion and not of its start, of the installation and of each schedule; one that completed and does not say when; none among the backups that exist; not known when the backups were not read or are not served, with the reason in words. Packaged: the one of the installation and the ones of three schedules, one of which has a newer backup that failed its validation; not known with the second reader |
| OVER-09 | Unit: the three windows, an operation at the edge of the window and one a millisecond before it, operations at the same time, one without a start, a store that holds what is not a window; a window chosen in the frame of a cluster kept when the frame of another keeps a namespace, and taken by the other at its next read. Component: the window kept, with no request for it; the operations of a mark forgotten when another window is chosen; the ones of a mark that was chosen counted as they are shown, after a read and when the window moves past them with no read, and said of many, of one and of none, to who does not see the page as well; the operations that report no time counted, and said of one and of many; what a mark says in words of what did not start and of a failure among many; the two rows on one line, which ends at the newest operation when the clock of the cluster is ahead. Packaged: the operations of each window in the list, from the newest, ten at a time, and the same on the line of time, each in the row of its kind; a mark of many shows its operations alone; the operation that did not start has its mark. The choice is in the store after it is made, and is the window of the next start |
| OVER-10 | Unit and component: ten lines at most of the schedules and of the storage locations, the ones a rule names first, then by name, with the number of the others and the way to their list. Packaged: ten of the twelve schedules, the two the rules name first, the number of the others and the way to the list, which has the twelve; the three storage locations, with the facts their list shows |
| OVER-11 | Component: the focus is on what a view was opened from at every return and not at the first alone, where the object is named in three places, from a mark, with the keyboard; a view that opens from the address gives it to where the object is named. Packaged: the five cells to their lists; an item to its object and to the other object its reason names; the newest completed backup, an operation in flight, one of the list, a line of a schedule and one of a storage location, a mark of the line, each to its view over the Overview, which is the way back; from a view to another one and back in two steps; the focus on what the view was opened from, at the first view and after ten. Component: the focus on the mark that was chosen when what it holds is not shown alone any more, and on the window when the mark is not there. Every way of the page names an object that the suite finds on the cluster, of a kind that has a view, and the page has no button that is not a way, a window, a mark or what shows more of a list |
| OVER-12 | Packaged performance: the measure below. Packaged: with what was asked of the bands shown, the page scrolled and the installation read again, by the command and by itself, the page is where it was and shows the same items |
| OVER-13 | Component: for each of the four families the bands made from it denied or failed, not served, and not read yet, while the others are read; an installation with nothing in it; what was read of a band, and of a row of the line of time, kept when its family stops answering, with the day and the time it was read |
| OVER-14 | Pre-review: the page, its recent operations, its schedules and its storage, and the page of an installation with nothing to report, in both themes, at 1440x900, at 900x650 and at twice the zoom; the bands of a row side by side at 1440 and one under the other at the two others; every mark of the line with a shape or a number, and its words, and the shape of a failure beside the ones that carry one and no other; a page that stands still, with no scrollbar, at the widths around the one its target bar goes to a second line at; a window chosen and the line of time read with the keyboard alone, a mark opened and the focus back on it |
| OVER-15 | Unit: the reader sends `GET` and nothing else. Component: a late answer of the installation selected before is not shown; no timer is left when the page closes. Packaged: the evidence of DISC-07 of the [discovery](SPEC-0002-installation-discovery.md#evidence-and-deviations) taken with the Overview open, and the lists of the cluster the API server counted are the one of the first opening and one for each read that was asked |

The measure of OVER-12, on 2026-09-29, in Freelens v1.10.3 on macOS 26 with an
Intel Core i7-9750H and 16 GiB, the test environment running on the same machine:

| Measure | Value |
| --- | --- |
| Operations read | 1,000 backups and 1,000 restores, spread over the 30 days before they were placed |
| Interactions, after three to warm | 20 changes of the window, among the three |
| Marks on the line, in the two rows | 46 with 24 hours, 61 with 7 days, 69 with 30 days |
| Operations listed | 10 in each window, and the others when they are asked for |
| Response, 95th percentile | 28 ms, against a budget of 250 ms |
| Response, median and slowest | 23 ms and 35 ms |

One hundred and thirty-two changes made to the code on purpose, one for each
rule above that the page could get wrong, each made a unit or a component test
fail. Nineteen made to the placing of the fixtures by the clock each made a test
of the environment fail. The pull request of the task names them.

What the suites found that the tests of the components did not, each corrected
with this slice:

- **A mark that holds many operations was wider than the gap between two
  marks**, and was drawn over the one beside it: with the long lists every mark
  holds ten operations or more. A mark is as wide as the gap lets it be, its
  number is written in three characters at most, the thousands from a thousand
  on, and how many it holds is in its words. The line of the history of a
  [schedule](SPEC-0006-schedule-read-only.md) is the same line, and has the same
  marks.
- **The words for who does not see, which are taken out of the flow, were
  placed in what holds the page**, which became taller than its room: the
  keyboard, which brings what it reaches into view, would have scrolled the
  target bar where nothing brings it back from. They are placed in the page.
  The check of the layout looks at what holds a page, for every page.
- **That check found that a page is cut in a room shorter than what it cannot
  give up**, which a window of 900 by 650 is for the choice of the installation
  and a window at twice the zoom is for every page: the host cuts what is
  taller than the room it gives. A page is scrolled there. It is of every page
  of the extension, the ones of the slices before among them.
- **A page that is scrolled was narrower with its scrollbar than without it**,
  by what the scrollbar is wide. At the widths where the target bar has one
  line without the scrollbar and two with it, the page took the scrollbar, sent
  the bar to a second line, gave the list less room, lost the scrollbar and
  began again, at every frame: nothing on it could be clicked. The hosted
  runner found it, where the time of a read is written with the half of the day
  and the bar is longer: on the machine the suites were written on the window
  of the suites is not of those widths. The room of the scrollbar is kept when
  there is none, the figures of the time of a read are as wide as each other,
  and the pre-review looks for a page that does not stand still around the
  width its bar goes to a second line at, whatever that width is.

What was decided while implementing, inside the requirements:

- **Every band shows ten items at a time**, and the ones after them when they
  are asked for. The requirement asks it of the list of the recent operations;
  what needs attention and what is in flight are shown in the same way. The
  installation of the long lists has hundreds of items: it is not drawn whole to
  say what is first. What was asked of a band stays shown when the installation
  is read again.
- **An installation with no storage location is an item of rule A4.** None is
  marked default where none is there, and the release refuses a backup sent to a
  location that is not there. The storage locations that could not be read are
  not an installation that has none: they are what the rules did not look at.
- **The items of the storage are by name**, where the design has every group
  from the newest. The time of such an item is the one of the last validation,
  which moves at every validation: by it, two locations that Velero validates
  every minute would change places while they are read, and the same design
  asks that the order does not change while the operator reads. The time is
  shown beside the name.
- **A backup that carries the name of a schedule that is not among the schedules
  is one of no schedule**, for rule A10: no schedule is there to be an item of,
  and its failure would be in no item. When the schedules were not read, whose
  backup it is cannot be said: the line of what was not checked says so.
- **The page says beside the number of its items what the rules did not look at
  and what they looked at as it was before.** With none of the four families
  read it says that nothing was read, and not that nothing needs attention.
- **A failure is a shape beside a mark of the line of time**, as well as a
  colour: a mark of many operations, and one of an operation in flight, are
  drawn the same with a failure and without. A mark of many names the five
  newest of its operations in its words, and says how many more it holds. The
  history of a [schedule](SPEC-0006-schedule-read-only.md) has the same marks.
- **What is shown of a mark that was chosen is counted as it is shown.** While
  its operations are shown alone one of them may expire, be deleted, or become
  older than the window, which moves with the clock: the number the page says is
  of the ones that are shown, one is said as one, and when none is left the page
  says that none is among the ones of the window that exist now, which is not
  that they do not exist. It says it to who does not see the page as well, and
  the way back to all of them leaves the focus on the mark, or on the window
  when the mark is not there any more. The history of a
  [schedule](SPEC-0006-schedule-read-only.md) says the same of its backups,
  where it said the number the mark held when it was chosen.
- **What is kept is changed from what the store holds**, and not from what the
  frame of a cluster read of it when it opened: the store is one for every
  cluster, and the window one for the extension. A window chosen in a frame is
  the one of the others at their next read.
- **What could not be checked is said before the items.** It is what the items
  that follow do not cover: read after them, the list would look complete.
- **What is in flight is two lines for each operation, and not a table.** Its
  band has half the page at 1440 pixels, where a table of its columns broke
  every phase of many words in three lines. When an operation started is what
  its elapsed time says to who points at it; in the list of the recent
  operations, which has the page, it is a column.
- **An operation that waits says that it did not start**, as its list does,
  where the elapsed time would be: it has no elapsed time. One that is at work
  and reports no start says that its start is not reported.
- **Rule A2 is of a location that reports no availability.** One that reports
  what this version does not know gives no item: its line has the mark of what
  is not known, with what it reports.
- **A location that is unavailable and was validated long ago gives two items**,
  one of rule A1 and one of rule A3: they are two facts, and each is read by its
  own rule.
- **The time of an item of rule A7 is the time of the operation of the backup**,
  which is its creation for one that failed its validation. The item leads to
  the schedule, and to the backup beside its reason.
- **The two rows of the line of time have the same ends**: the beginning of the
  window and now, or the newest operation of either row when the clock of the
  cluster is ahead of the one that draws the line.
- **The fixtures of the Overview are placed by the clock.** Their times are
  counted back from the moment they are put in place, and they are good for
  twelve hours: a run that finds them older, placed at a time that is after its
  own, which a clock that went back gives, or made as they would not be made
  now, puts them in place again, in their two namespaces and nowhere else: the
  other namespaces of the run hold fixtures of fixed times, and nothing is
  placed by the clock there. Each says when it was placed and what it was made
  as. They are in a namespace of their own, which the discovery finds as an
  installation: the suites that count the installations count five. The ones of
  the long lists are spread over the thirty days before they are placed.
- **Removing two thousand objects takes the client minutes when it waits for
  each**: the fixtures are removed without that wait, and their namespace is
  read until nothing of it is left, for five minutes at most.
- **What is around a page is written once**, for the pages of the lists and for
  the Overview: the page of a list is what it was, inside the frame.

One deviation, approved by the lead maintainer at the review of the milestone
on 2026-09-30:

| Requirement | What it says | What the extension does, and why |
| --- | --- | --- |
| REQ-093 | The Overview is the first entry under Velero and the page the entry of Velero opens | The Overview is the first entry under Velero, the first tab of the group and the page the entry of Velero names. In the host the entry of a group that has entries under it opens the group and leads to no page: the host follows the page an entry names when the entry has none under it, and marks the entry while that page is shown. What a click on a group does is of the host, for its own groups as for the ones of an extension |

Review of the milestone, 2026-09-30. The steps of the manual review were run in
the packaged application by the pre-review pass, with the keyboard alone where the
criteria ask for it; the lead maintainer judged its report and its screenshots, in
both themes, and approved. Verdict: approved, with what was decided while
implementing accepted as it is and the deviation above approved. No finding was recorded.
