# SPEC-0013: The Adherence Of A Schedule

- **Status:** Implemented
- **Date:** 2026-10-13
- **Milestone / tasks:** M4 / T3.1, T3.2, T3.3
- **Reviewed Velero:** v1.18.4, `4ee1e79a7aed367fd9b767b8219ec65bd0c96892`
- **Reviewed main:** `c111008912919e6a1a4127b2a0b8a641ee2dad80`
- **Freelens validation target:** Freelens v2, the validation target of [SPEC-0015](SPEC-0015-freelens-v2-host.md), freelensapp/freelens `7801fb10a5f20af308093b39e5f79cd6e8c3461d`, the base of the nightly v2.0.0-0-nightly-2026-10-25, which moves with the host drift watch until Freelens 2.0.0 is released; T3.1 and T3.2 were implemented against v1.10.3, `3da74415bff57a77c6e08cb5f538191ce87bac17`, and the evidence of their checks moved to v2 at T0.8, while T3.3 is implemented on v2
- **Dependencies:** [Schedules](SPEC-0006-schedule-read-only.md), [states and Backups](SPEC-0003-backup-read-only.md), [the Overview](SPEC-0008-overview.md), [target discovery](SPEC-0002-installation-discovery.md)
- **Approval:** Approved by the lead maintainer on 2026-10-14, as drafted, with the one disagreement of the independent review decided as the spec says: two offsets of one installation are a change of daylight saving time (REQ-162)

Governed by [AGENTS.md](../../AGENTS.md).

## Goal

Tell the operator, of each schedule, when Velero is expected to submit its next
backup, when it last did, and whether it is overdue, each with its reason in words;
and say, wherever the extension cannot know, that it does not know, so that an
unknown state never reads as a healthy one.

## Scope Baseline

The [Schedules](SPEC-0006-schedule-read-only.md) show what the objects say and the
backups that exist, and compute nothing from the cron expression: REQ-066 keeps
the expected run, the next run and the overdue state for this milestone. This spec
is that computation. The schedule controller of the reviewed release was read whole
for it, and its rules are the ones the extension reproduces: where the next run is
counted from, what withholds a submission, what the controller writes and what it
never writes. The facts are in the [design](#what-the-controller-does), each with
its line.

Three facts of the reviewed release bound what the extension can know:

- The controller parses an expression with the library
  [`netresearch/go-cron` at `v0.15.0`](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/go.mod#L32),
  imported by the
  [controller](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/controller/schedule_controller.go#L25)
  and by [its test](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/controller/schedule_controller_test.go#L23),
  and by nothing else of the tree. The [recon](../development/RECON-T0.1.md#actions-and-schedule-adherence)
  read `robfig/cron` at `v3.0.1` in the release it reviewed, v1.18.2: the library
  changed between the two patch releases, with the same two functions called,
  `ParseStandard` and `Next`. The release tree carries no vendor directory; the
  source of the module at that version was read for this draft, beside the source
  of the earlier library. Its grammar and the rules of its next instant are in
  REQ-160 and in the [facts of the parser](#what-the-parser-does), with what
  differs from the library of v1.18.2: the differences change instants the
  controller submits at, and validations it makes.
- An expression without a time zone prefix is read in the local time zone of the
  server process, which no object of Velero carries. The command line of the release
  tells its users that the expression is read
  [in UTC](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/cmd/cli/schedule/create.go#L43),
  its documentation that a zone can be
  [named in the expression](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/site/content/docs/main/backup-reference.md#L69-L88),
  and the installer sets no zone into the Deployment of the server (a search of
  `pkg/install` for `TZ`, `tzdata` and `zoneinfo` finds nothing). The extension does
  not read the Deployment: how it establishes the zone is REQ-162.
- `status.lastBackup` is the instant of a submission, written right after the
  Backup is created, and says nothing of how the backup ended; the backup created
  is named with the wall clock of the server at that instant. The history of a
  schedule is the backups that exist now: a backup that expired or was deleted is
  not in it, and a distance between two backups is never a missed run (REQ-069 of
  SPEC-0006).

Included: the computation of the expected runs, the states of the signal and
their words, the time zone policy, the grace, the clocks, the incomplete history,
the limited identities, and the four surfaces where the signal shows: the native
list, the workspace of a schedule, the section in the details of the host, and the
Overview. The checks SCHED-03 of SPEC-0006, which asserts that no time is computed
from an expression, and OVER-04 and OVER-10 of SPEC-0008, which list the rules and
the lines of the schedules, are restated with this slice, as DISC-08 was with the
entries of the sidebar.

Excluded, with their owners: pause, resume and backup now (M5, T4.2 and T4.5); the
backup repositories and the data movement (M4, T5.1 and T5.2); the metrics the
server exposes for each schedule, among them the counters its
[registry](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/metrics/metrics.go#L494-L527)
initializes by schedule name, which the extension does not read: it needs nothing
in the cluster beyond Velero itself; a setting of the extension that names the zone
of the server, which is a decision recorded below and not a slice; and any
judgment of whether a backup that was submitted protects anything.

## User Scenarios

1. **P1, overdue:** Given a schedule `0 3 * * *` whose expression names no zone,
   whose last submission was two days ago and whose backup of that submission
   exists, when the list is read at 14:00, then the schedule is overdue, the row
   says by how long and since which expected instant, how many expected runs passed
   with no submission, and that the times are computed with the offset the clock
   of the server showed at the last submission; the Overview lists it among what
   needs attention with the same reason.
2. **P1, on time:** Given a schedule `@every 6h` whose last submission was two
   hours ago, then the next run is in four hours, said relative and absolute, and
   nothing on the row reads as an alarm.
3. **P1, held:** Given a schedule whose expected instant passed an hour ago while
   one of its backups is InProgress, then the signal says that Velero submits
   nothing while that backup is in progress, names it, and leads to it.
4. **P1, the zone is not known:** Given a schedule `0 3 * * *` created today with
   no submission yet, in an installation where no schedule has a submission whose
   backup exists, then the next run is said not known, with the reason, that the
   expression names no zone and the one of the server is not read until a backup of
   a submission exists, and the way out, which is to name the zone in the
   expression; the row has the mark of what is not known and not the one of a
   schedule on time. Beside a schedule of the same installation that submitted an
   hour ago, the offset of that submission is used, and the words name the schedule
   it came from.
5. **P1, paused, invalid, not read:** Given the three, then no next run is
   computed for any of them: a paused schedule says that no run is expected until
   it is resumed, and whether Velero would submit at once when it is; an invalid
   one that Velero refused its expression; one with no phase that Velero has not
   read it. None is said overdue.
6. **P2, the backups cannot be read:** Given the identity that reads the
   schedules and not the backups, then an `@every` schedule still has its next run
   and its overdue state from the last submission, with the words that whether a
   backup holds the submissions is not known, and a schedule whose expression
   names no zone is said not known, since the zone is derived from the backups.
7. **P2, the clock of the cluster is ahead:** Given a schedule whose last
   submission is after the clock of this machine, then the view says that the
   clock of the cluster is ahead by at least that much, and that by its clock a
   run may be later still; a schedule this machine counts overdue is said overdue.
8. **P2, a large installation:** Given 300 schedules with their backups, when the
   list is searched and ordered by the next run, then it answers within the budget
   of the lists, and the Overview within its own.

## Requirements

| ID | Contract | Acceptance check |
| --- | --- | --- |
| REQ-160 | The extension computes the instants of an expression as the parser of the reviewed release does, `ParseStandard` and `Next` of `netresearch/go-cron` at `v0.15.0`, read in its source at that version, whose rules are the facts of the parser below, and the table of ADH-01 holds the expressions it accepts and refuses with their next runs. The grammar: five fields, minute, hour, day of the month, month and day of the week, each a list of values, ranges and steps, with the names of the months and of the days, `*` or `?` for every value, `N/step` for N to the end of the field; Sunday is `0` or `7`; a range may wrap, as `22-2` for the hours or `NOV-FEB`; a step must be smaller than its range, so that `*/60` in the minutes is refused; a day of the month and a day of the week that are both restricted must both match, where the library of v1.18.2 matched either; the descriptors `@yearly`, `@annually`, `@monthly`, `@weekly`, `@daily`, `@midnight` and `@hourly`; `@every` followed by a duration as Go reads one, of one second at least, truncated to the second; the descriptors `@triggered`, `@manual` and `@none`, which have no instant; the prefixes `TZ=` and `CRON_TZ=` with an IANA name read up to the first space, with matching quotes taken off, of 64 characters at most, of letters, digits, `/`, `_`, `-`, `+` and `:`, where an empty name, a name of other characters, a name the server does not know and a prefix with nothing after it are refused, and `Local` names the zone of the server; an expression of more than 1,024 characters is refused. The next instant: the first after the given time, from its upcoming second, in the zone of the expression; in the hour a daylight saving change skips, the run of that hour is at the first instant after the change; in the hour a change repeats, both occurrences are instants; the zero time when no instant satisfies the expression within five years of the given time, and always for the three descriptors without an instant. An empty expression is refused by the controller with `Schedule must be a non-empty valid Cron expression`, one the parser refuses with `invalid schedule:`, a space and the text of the error. The extension never validates an expression in the place of the controller: of a schedule Velero took whose expression this version cannot read, the signal is not known, with that reason, and never overdue. An empty zone name, which the parser of v1.18.2 read as UTC, is refused by the parser of the reviewed release: the words of SPEC-0006 change with this slice | ADH-01 |
| REQ-161 | The expected run is the one the controller counts: from the last submission, `status.lastBackup`; from the creation of the schedule when there is none; from `status.lastSkipped` when it is later than either; the next instant of the expression after that time is the expected run, and the controller submits when its clock is after it. The signal says which of the three the count starts from. The controller looks at every schedule once a minute, submits one backup when a run is due and does not catch up on the runs it missed: the signal counts the expected instants that passed since the anchor with no submission, up to one hundred, and says more than one hundred past that. An expression with no instant within five years of the anchor, as `0 0 30 2 *`, and the descriptors `@triggered`, `@manual` and `@none` give the zero time as the next instant, which the controller reads as a run that is due at every look: Velero submits a backup at each of them, once a minute, while none of the backups of the schedule reports no phase, New or InProgress. The signal of such a schedule is its own state, at every look, with the mark of what is not known for the expected run and the words that Velero submits a backup at every look; it is never awaited, due or overdue, and the count is not made | ADH-02 |
| REQ-162 | The zone an expression is read in is established by this rule and no other: the zone the expression names, by its IANA name as the runtime knows it, with `Local` read as no prefix and an empty name refused by the parser, so that the schedule is FailedValidation and REQ-164 applies; for an expression without a prefix, or with `Local`, the zone of the server, which the extension does not read and does not assume: it is derived, as a fixed offset, from the newest backup of a last submission in the installation, since one server process submits every schedule of it. The backup of a last submission is the one that carries the label of its schedule, whose name is the name of that schedule followed by fourteen digits and whose creation is within a minute of the `status.lastBackup` of that schedule; the digits read as a wall clock minus the creation, rounded to the quarter of an hour, with a remainder under a minute, is the offset. When the backups of the last submissions of the installation give two offsets, the zone of the server changes its offset, which a daylight saving rule does: the offset of the newest is taken, and the words say that the offset changed between the two submissions. The signal computed with a derived offset says so, with the offset, with the schedule it came from when it is another, and that across a daylight saving change the run may be an hour off. An `@every` expression needs no zone and is computed without one. Otherwise the next run is not known, with the reason, that the expression names no zone and the one of the server is not read, with why it could not be derived, and with the way out, which is to name the zone in the expression. A name the runtime does not know is not known. In a zone the expression names, on the day the zone repeats an hour, an expression with an instant in that hour has two expected runs in it, and the words say so. The zone of the desktop and the time zone preference of the host are never used for the computation | ADH-03 |
| REQ-163 | Of a schedule that is not paused, whose phase is Enabled, whose zone is established and whose expression has an instant, the signal is one of four states, by the clock of this machine, or of the cluster where REQ-166 counts the lateness by it: awaited, while the expected run is ahead; due, for five minutes after it; overdue, after those five minutes, with the duration since the expected run, the expected run itself, the anchor the count started from and the number of expected runs that passed with no submission; held, when a backup of the schedule in its namespace reports no phase, New or InProgress, which withholds every submission, with the name of that backup and the way to it, and with the duration since the expected run when it passed. The grace of five minutes is one constant, in one place with the bound of the count | ADH-04 |
| REQ-164 | No run is computed for a paused schedule, for one in FailedValidation, for one that reports no phase and for one whose phase this version does not know; each says why in words: no run is expected until it is resumed; Velero refused the expression; Velero has not read the schedule; the phase is not one this version knows. A paused schedule whose zone is established says as well whether Velero would submit a backup at once when it is resumed, since a run is already due, and that `skipImmediately` would move that run to the next instant | ADH-05 |
| REQ-165 | Each state of uncertainty is its own, with its words and the mark of what is not known, never the mark or the words of a schedule on time: the zone not known, with why; the expression this version cannot read; the schedule Velero submits at every look, of REQ-161, whose expected run is not known; the backups denied, not served, failed or not read yet, which make the hold not known and the zone not derivable, while the states that need only the last submission keep their value with the words that whether a backup holds the submissions is not known; a signal computed from a read that is stale, which says when the read was; a signal computed with a derived offset, which says that it is approximate across a daylight saving change | ADH-06 |
| REQ-166 | The signal is computed from the clock of this machine, taken once for a read as the views take it, and its words say by which clock the lateness is counted. When a time an object of the installation reports, a creation, a submission, a skip or the start of a backup, is after the clock of this machine at the read that brought it, the view says that the clock of the cluster is ahead of this machine by at least that difference, and that by the clock of the cluster a run may be later still: the controller counts the lateness by its own clock, so a cluster that is ahead makes it longer than the one this machine counts, never shorter, and bounds nothing that is said overdue. Where the reader can see the time of the API server in its answers, as the design says, the difference between the two clocks is measured at each read, and the lateness is counted by the clock of the cluster, the clock of this machine plus that difference, both ways, with its words | ADH-07 |
| REQ-167 | The last observed run is two facts kept apart: the last submission, `status.lastBackup`, which says that the controller submitted a backup and when; and the newest backup of the schedule among the ones that exist, as SPEC-0006 reads it. When the last submission has no backup created within a minute of it among the ones that exist, the view says that the backup of the last submission is not among the backups that exist, expired, deleted or not readable, and the signal stands, since the submission is written in the schedule. When a backup of the schedule is newer than the last submission, the view says that it is not a submission of the schedule, asked by hand from the schedule or synced from the store, and that it does not move the last submission. A gap between two backups is never named a missed run | ADH-08 |
| REQ-168 | The native list of the Schedules gains two columns with stable IDs: Next run, which shows the expected instant relative to now, with its absolute time in the tip as the host formats a date, None with why for a schedule that has none, paused, refused or submitted at every look, and Not known where it is not known, ordered by the instant with the ones that have none last; and Adherence, which shows the mark and the word of the state, ordered by the weight of the state, and inside a weight by its measure or by name: overdue by the longest first, held, due, at every look, not known, awaited by the soonest first, no run for a refused expression, no run for a paused schedule. Both are in the search. In a narrow room the installation gives its room under 1,200 pixels, the age under 1,000, the last submission and the newest backup under 760, the expression under 640: the name, paused, next run, adherence and validation stay | ADH-09 |
| REQ-169 | The workspace of a schedule has a band Adherence, after the status and before the history: the next run with its state, the zone it is read in and how the zone was established, the last observed run as REQ-167 says it, the anchor of the count, the held backup with its way when there is one, the grace in words, and the words of the clocks. The line of time of the history is unchanged: nothing is drawn where no backup is | ADH-10 |
| REQ-170 | The section in the details the host shows of a Schedule gains the items Next run and Adherence, in the same words, through the same helpers | ADH-11 |
| REQ-171 | The Overview gains rule A11: a schedule that is not paused and is Enabled, and that is overdue or held beyond the grace, with its zone established, or that Velero submits at every look, since its expression has no instant, is an item of the group of the schedules, with the reason of its state in words, the expected run as its time, or its last submission when it has no expected run, the held backup as its related object, and the words of the derived offset when there is one. The row A11 joins the table of REQ-096 of SPEC-0008 with the pull request of the slice, and OVER-04 is restated with it. The line of each schedule shows its next run and its adherence beside the facts its list shows, and OVER-10 is restated with the lines. Before the items, the page says of how many schedules the adherence is not known, by reason, among what the rules did not look at: a schedule whose adherence is not known is never an item and never counted as one that needs nothing | ADH-12 |
| REQ-172 | The slice only reads. No object is created, patched or deleted, which the API server counts; the reader asks no path that is not of the kinds of Velero, so no Deployment and no Secret is read for the zone or for anything else | ADH-13 |
| REQ-173 | A read that fails keeps what was read before and says when, for the schedules and for the backups separately; the signal is computed again from the last read at every tick of the clock of the views, and from the new read when one ends; late answers of another installation are not shown; a view that closes leaves no timer | ADH-14 |
| REQ-174 | Both themes, the keyboard alone, long names and long expressions, a window of 900 by 650 and twice the zoom; the marks of the states carry their meaning without the colour, and every word of a mark is there for who does not see it | ADH-15 |
| REQ-175 | The signal of one schedule is computed within 2 milliseconds, and the signals of 1,000 schedules of mixed expressions within 250 milliseconds at the 95th percentile of twenty calls after five, in the measure of the unit run; a parsed expression is kept for the text of the expression, and the count of REQ-161 is bounded. In the packaged application a list of 300 schedules with their backups answers a search and an order by the next run within 250 milliseconds at the 95th percentile across twenty warm interactions, and the Overview of that installation keeps the budget of REQ-104 | ADH-16 |
| REQ-176 | The packaged application proves the states on fixtures placed by the clock, which no controller reads: awaited, overdue with its count, held, at every look, the zone derived from the backup of the last submission of the schedule itself and, for a schedule with no submission, from the one of another schedule of the installation, an installation whose submissions give two offsets, the zone not known for want of any submission with its backup in the installation, the clock of the cluster ahead; the paused, invalid and not read schedules of the fixtures that exist; the two readers; and, in the installation the controllers of Velero are at work in, one schedule the real controller validated, `@every 8760h`, whose next run the extension counts from its creation and which submits nothing while the suites run. Due stays at the unit and component layers | ADH-17 |

## Design

- **Standard or ad hoc view, and why.** The list stays the native list of the host,
  with two columns more: an operator scans a hundred schedules for the ones that
  are overdue, and a sortable column answers that in one gesture. The signal of one
  schedule is a band of the workspace of the extension, which SPEC-0006 made the
  view of one schedule: the question an operator asks of one schedule, whether it
  is doing what it was asked, needs the expected run, the last observed run, the
  held backup and the zone side by side with their reasons, which a list of fields
  cannot carry and which the details of the host carry in short. The Overview
  gains a rule and two facts on its lines, since it is where the operator looks
  first. Nothing new is drawn: the line of time of the history draws the backups
  that exist, and the adherence is said in words and numbers beside it, because a
  mark for a run that did not happen would be read as a backup that was lost where
  the words can only say that no submission was made.
- **Safety.** The slice writes nothing. The computation is pure functions on the
  reads the installation already makes, the schedules and the backups, and on the
  clock; it asks the cluster nothing of its own. The suites count on the API
  server, for the kinds of Velero, no write and the same reads as every other view,
  as DISC-07 and SCHED-14 do; the unit test of the reader asserts that every path is
  under `/apis/velero.io/`, as LOC-09 does, so that the zone is never read from a
  Deployment and nothing is read from a Secret.

### What The Controller Does

The [schedule controller](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/controller/schedule_controller.go)
of the reviewed release, read whole. Nothing was run.

| Fact | Source |
| --- | --- |
| The controller looks at every schedule once a minute, through a source that lists them and enqueues the ones its predicate lets through, when a schedule is created and when its spec changes; a change of the status alone enqueues nothing | [The period](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/controller/schedule_controller.go#L44), [the source](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/controller/schedule_controller.go#L82-L88), [its ticker](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/util/kube/periodical_enqueue_source.go#L70-L115), [the spec predicate](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/util/kube/predicate.go#L34-L48) |
| A paused schedule is left out of every event, the periodic one included: nothing of its status changes while it is paused, and `spec.skipImmediately` is not consumed until it is resumed | [The predicate](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/controller/schedule_controller.go#L74-L81), [every event](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/util/kube/predicate.go#L51-L66) |
| When the object names no `spec.skipImmediately` the controller writes the setting of the server into it, `--schedule-skip-immediately`, false unless the server is told otherwise. When the value is true the controller sets it back to false and writes the time of that reading into `status.lastSkipped`, whether a run was due or not | [The default](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/controller/schedule_controller.go#L113-L115), [the skip](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/controller/schedule_controller.go#L116-L119), [the flag](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/cmd/server/config/config.go#L257), [its default](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/cmd/server/config/config.go#L219), [given to the controller](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/cmd/server/server.go#L892) |
| The expression is parsed at every reading, whatever the phase was: it passes, and the phase is Enabled with no validation error; it fails, and the phase is FailedValidation with the errors. The phase New is never written by the controller: it is of the API, and the command line prints it for a schedule that reports none | [The parse](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/controller/schedule_controller.go#L121-L132), [the phases](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/apis/velero/v1/schedule_types.go#L56-L71), [the printer](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/cmd/util/output/schedule_printer.go#L57-L60) |
| An empty expression is refused with `Schedule must be a non-empty valid Cron expression`; one the parser refuses, or panics on, with `invalid schedule:`, a space and the text of the error. The parser is `ParseStandard` of `netresearch/go-cron`, pinned at `v0.15.0`, whose rules are the facts of the parser below; a prefix with nothing after it, which made the library of v1.18.2 panic, is an error of this parser, and the recovery of the controller is for the earlier library | [Empty](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/controller/schedule_controller.go#L179-L181), [refused](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/controller/schedule_controller.go#L188-L205), [the import](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/controller/schedule_controller.go#L25), [the module](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/go.mod#L32), [its sum](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/go.sum#L342-L343) |
| The phase, `spec.skipImmediately` and `status.lastSkipped` are patched when one of them changed; a schedule that is not Enabled is left there | [The patch](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/controller/schedule_controller.go#L134-L154), [not Enabled](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/controller/schedule_controller.go#L156-L159) |
| The next run is counted from `status.lastBackup`, from the creation of the schedule when there is none, and from `status.lastSkipped` when it is later than that; it is the next instant of the expression after that time, and the schedule is due when the clock of the controller is after it, strictly. The test of the release has a daily expression counted from a last backup at 12:27 due at 9:01 the next day and, once that run is recorded, next at 9:00 the day after; an `@every` expression is due when its interval passed, the library rounding to the second | [The anchor](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/controller/schedule_controller.go#L275-L289), [due](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/controller/schedule_controller.go#L241-L251), [the daily test](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/controller/schedule_controller_test.go#L344-L377), [the interval test](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/controller/schedule_controller_test.go#L281-L295), [the rounding](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/controller/schedule_controller_test.go#L330-L331) |
| A due schedule submits nothing while one of the backups that carry its name in the label `velero.io/schedule-name`, in its namespace, reports no phase, New or InProgress, whichever backup it is, and nothing while those backups cannot be listed. Queued, ReadyToStart, the phases that wait and the ones that finalize do not hold it back | [The check](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/controller/schedule_controller.go#L165-L169), [the list by label](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/controller/schedule_controller.go#L215-L229), [the three phases](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/controller/schedule_controller.go#L231-L236), [the label](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/apis/velero/v1/labels_annotations.go#L30) |
| A submission creates one Backup, named with the name of the schedule and the wall clock of the server at that instant, `yyyymmddhhmmss`, with the template as its spec and the label of the schedule, and then writes that same instant into `status.lastBackup`. The controller does not catch up on missed or failed runs: one backup when it is time. Nothing of how the backup ends is ever written into the schedule | [The submission](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/controller/schedule_controller.go#L254-L273), [no catch up](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/controller/schedule_controller.go#L258-L260), [the backup](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/controller/schedule_controller.go#L291-L297), [the name](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/apis/velero/v1/schedule_types.go#L137-L140), [the builder](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/builder/backup_builder.go#L85-L126), [the documented name](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/site/content/docs/main/backup-reference.md#L55) |
| A backup asked by hand from a schedule carries the same label and the same form of name, written in UTC by the command line; it is not a submission of the schedule and moves nothing in it, as the documentation says | [The command line](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/cmd/cli/backup/create.go#L374-L378), [the documentation](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/site/content/docs/main/backup-reference.md#L61-L67) |
| The command line pauses and resumes a schedule by writing `spec.paused` and `spec.skipImmediately` together, the second as the flag `--skip-immediately` gives it or empty, so that the server setting applies; the flag reads `Skip the next scheduled backup immediately` | [Pause](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/cmd/cli/schedule/pause.go#L134-L145), [the flag](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/cmd/cli/schedule/skip_options.go#L17-L20), [the field](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/apis/velero/v1/schedule_types.go#L46-L51) |
| The type and its schema: `spec.schedule` and `spec.template` required, `spec.paused`, `spec.skipImmediately` and `spec.useOwnerReferencesInBackup` optional; `status.phase` one of New, Enabled, FailedValidation; `status.lastBackup` and `status.lastSkipped` nullable date-times; `status.validationErrors` a list of strings; no status subresource, so a client that writes a status writes the object. The printer columns are Status, Schedule, LastBackup, Age and Paused | [The spec](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/config/crd/v1/bases/velero.io_schedules.yaml#L60-L77), [required](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/config/crd/v1/bases/velero.io_schedules.yaml#L569-L571), [the status](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/config/crd/v1/bases/velero.io_schedules.yaml#L573-L602), [no subresource](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/config/crd/v1/bases/velero.io_schedules.yaml#L606), [the columns](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/config/crd/v1/bases/velero.io_schedules.yaml#L17-L35), [the type](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/apis/velero/v1/schedule_types.go#L26-L94) |
| What the release tells its users of the expression: five fields with their ranges, the `@every` form with hours, minutes and seconds, and that the expression is read in UTC; the documentation shows the five fields, the `CRON_TZ=<timezone> <cron>` form with IANA names, and warns that a run that falls in the hour a daylight saving change skips is not run, which is of the library of v1.18.2: the parser of the reviewed release submits that run at the first instant after the change, as the facts of the parser say, and the implementation records the stale sentence in the drift watch | [The help](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/cmd/cli/schedule/create.go#L43-L55), [the format](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/site/content/docs/main/backup-reference.md#L35-L47), [the zone](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/site/content/docs/main/backup-reference.md#L69-L88), [the skipped hour](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/site/content/docs/main/backup-reference.md#L74) |
| The server runs on the image `paketobuildpacks/run-jammy-tiny`; whether that image carries a zone of its own was not read, since it is not in the tree. The installer sets no `TZ` into the Deployment: a search of `pkg/install` for `TZ`, `tzdata` and `zoneinfo` finds nothing | [The image](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/Dockerfile#L76), [the installer](https://github.com/velero-io/velero/tree/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/install) |

### What The Parser Does

The parser of the reviewed release, [`netresearch/go-cron` at `v0.15.0`](https://github.com/netresearch/go-cron/tree/v0.15.0),
read whole in the files the controller calls, beside the library of v1.18.2,
[`robfig/cron` at `v3.0.1`](https://github.com/robfig/cron/tree/v3.0.1), for what
differs. Nothing was run.

| Fact | Source |
| --- | --- |
| `ParseStandard` is the standard parser of the module: minute, hour, day of the month, month and day of the week, and the descriptors. It is not given the option that restores the OR of the day fields: a day of the month and a day of the week that are both restricted must both match, as every other field must. The library of v1.18.2 matched either when both were restricted, and the module records the change as breaking. `0 3 1 * 1` is the first of a month that is a Monday on the reviewed release, and the first of every month and every Monday on v1.18.2 | [The parser](https://github.com/netresearch/go-cron/blob/v0.15.0/parser.go#L757-L759), [`ParseStandard`](https://github.com/netresearch/go-cron/blob/v0.15.0/parser.go#L808-L810), [the day rule](https://github.com/netresearch/go-cron/blob/v0.15.0/spec.go#L470-L506), [the earlier rule](https://github.com/robfig/cron/blob/v3.0.1/spec.go#L179-L188), [the change](https://github.com/netresearch/go-cron/blob/v0.15.0/CHANGELOG.md#L280-L286), [a test](https://github.com/netresearch/go-cron/blob/v0.15.0/spec_test.go#L106) |
| An empty expression is refused, and one longer than 1,024 characters | [Length](https://github.com/netresearch/go-cron/blob/v0.15.0/parser.go#L415-L421), [the limit](https://github.com/netresearch/go-cron/blob/v0.15.0/parser.go#L320-L322), [the change](https://github.com/netresearch/go-cron/blob/v0.15.0/CHANGELOG.md#L476) |
| A prefix `TZ=` or `CRON_TZ=` names the zone, read up to the first space; a prefix with no space after it is the error `missing fields after timezone`; matching single or double quotes around the name are taken off; the name is validated before it is loaded: an empty name is `empty timezone string`, a name of more than 64 characters and one with a character that is not a letter, a digit, `/`, `_`, `-`, `+` or `:` are refused, and a name Go does not know is `unknown time zone`; nothing but spaces after the name is refused. The library of v1.18.2 read the name up to the first space with no validation, loaded an empty name as UTC and panicked on a prefix with no space | [The prefix](https://github.com/netresearch/go-cron/blob/v0.15.0/parser.go#L328-L366), [the validation](https://github.com/netresearch/go-cron/blob/v0.15.0/parser.go#L1398-L1412), [the characters](https://github.com/netresearch/go-cron/blob/v0.15.0/parser.go#L1384-L1396), [the earlier prefix](https://github.com/robfig/cron/blob/v3.0.1/parser.go#L95-L103), [the change](https://github.com/netresearch/go-cron/blob/v0.15.0/CHANGELOG.md#L505), [the panic](https://github.com/netresearch/go-cron/blob/v0.15.0/CHANGELOG.md#L522), [the table](https://github.com/netresearch/go-cron/blob/v0.15.0/docs/MIGRATION.md#L46-L48) |
| `Local`, and no prefix, is the zone of the time `Next` is given, which for the controller is the clock of its process: the zone of the server | [`Local`](https://github.com/netresearch/go-cron/blob/v0.15.0/spec.go#L308-L318), [the controller](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/controller/schedule_controller.go#L286) |
| A field is a list of ranges, each a value or `first-last`, with `/step`; `*` and `?` are every value; `N/step` runs from N to the end of the field; a value below the minimum, above the maximum or a step of zero is refused; a step must be smaller than the size of its range, so that `*/60` in the minutes is refused where v1.18.2 took it; a range whose start is after its end wraps for every field but the year, as `22-2` for the hours and `NOV-FEB`, where v1.18.2 refused it; the months and the days have names; the day of the week runs 0 to 7, and `7` is Sunday, where v1.18.2 ran 0 to 6 | [The range](https://github.com/netresearch/go-cron/blob/v0.15.0/parser.go#L1185-L1225), [its bounds](https://github.com/netresearch/go-cron/blob/v0.15.0/parser.go#L1133-L1154), [its checks](https://github.com/netresearch/go-cron/blob/v0.15.0/parser.go#L1158-L1183), [wraparound](https://github.com/netresearch/go-cron/blob/v0.15.0/parser.go#L1219-L1222), [the bounds of the fields](https://github.com/netresearch/go-cron/blob/v0.15.0/spec.go#L89-L118), [Sunday as 7](https://github.com/netresearch/go-cron/blob/v0.15.0/spec.go#L127-L146), [applied to the field](https://github.com/netresearch/go-cron/blob/v0.15.0/parser.go#L559-L560), [the earlier bounds](https://github.com/robfig/cron/blob/v3.0.1/spec.go#L40), [the earlier checks](https://github.com/robfig/cron/blob/v3.0.1/parser.go#L304-L315), [the changes](https://github.com/netresearch/go-cron/blob/v0.15.0/CHANGELOG.md#L289-L293), [Sunday](https://github.com/netresearch/go-cron/blob/v0.15.0/CHANGELOG.md#L366), [the step](https://github.com/netresearch/go-cron/blob/v0.15.0/CHANGELOG.md#L514), [the example](https://github.com/netresearch/go-cron/blob/v0.15.0/CHANGELOG.md#L578) |
| The descriptors: `@yearly` and `@annually` at the first minute of the year, `@monthly` of the month, `@weekly` of Sunday, `@daily` and `@midnight` of the day, `@hourly` of the hour; `@every` followed by a duration as Go reads one, hours, minutes, seconds and fractions, refused below one second and truncated to the second, whose next instant is the given time, rounded down to the second, plus the duration; `@triggered`, `@manual` and `@none`, whose next instant is always the zero time. The library of v1.18.2 rounded a duration below a second up to a second and had none of the last three | [The descriptors](https://github.com/netresearch/go-cron/blob/v0.15.0/parser.go#L1490-L1537), [the three](https://github.com/netresearch/go-cron/blob/v0.15.0/parser.go#L1521-L1522), [`@every`](https://github.com/netresearch/go-cron/blob/v0.15.0/parser.go#L1525-L1533), [the minimum](https://github.com/netresearch/go-cron/blob/v0.15.0/parser.go#L141), [the truncation](https://github.com/netresearch/go-cron/blob/v0.15.0/constantdelay.go#L42-L55), [the next instant](https://github.com/netresearch/go-cron/blob/v0.15.0/constantdelay.go#L63-L74), [the zero time](https://github.com/netresearch/go-cron/blob/v0.15.0/triggered.go#L21-L24), [refused below a second](https://github.com/netresearch/go-cron/blob/v0.15.0/parser_test.go#L533-L536), [the earlier `@every`](https://github.com/robfig/cron/blob/v3.0.1/constantdelay.go#L14-L21), [the earlier descriptors](https://github.com/robfig/cron/blob/v3.0.1/parser.go#L365-L434) |
| The next instant of a five-field expression begins at the upcoming second of the given time, in the zone of the expression, and advances month, day, hour, minute and second until each matches; past five years it is the zero time, so `0 0 30 2 *` and `0 0 31 4 *` have none. In the hour a daylight saving change skips, the hour loop stops at the first instant after the change when the skipped hour is in the expression: `30 2 * * *` in New York is at 03:30 on the day of the change, and an hourly expression goes from 01:00 to 03:00. In the hour a change repeats, both occurrences are instants: `0 1 * * *` is at 01:00 before the change and at 01:00 after it, and so is an hourly expression. The runner of the module skips the second occurrence, but the controller calls `Next` alone and runs nothing of the module. The library of v1.18.2 had no rule for the skipped hour: the run of that hour was not run that day, which the documentation of the release still says | [`Next`](https://github.com/netresearch/go-cron/blob/v0.15.0/spec.go#L367-L468), [the upcoming second](https://github.com/netresearch/go-cron/blob/v0.15.0/spec.go#L319-L320), [five years](https://github.com/netresearch/go-cron/blob/v0.15.0/spec.go#L131-L135), [the zero time](https://github.com/netresearch/go-cron/blob/v0.15.0/spec.go#L383-L400), [the skipped hour](https://github.com/netresearch/go-cron/blob/v0.15.0/spec.go#L336-L345), [in the loop](https://github.com/netresearch/go-cron/blob/v0.15.0/spec.go#L439-L454), [the tests of the skipped hour](https://github.com/netresearch/go-cron/blob/v0.15.0/spec_test.go#L119-L127), [of the repeated hour](https://github.com/netresearch/go-cron/blob/v0.15.0/spec_test.go#L146-L155), [unsatisfiable](https://github.com/netresearch/go-cron/blob/v0.15.0/spec_test.go#L184-L186), [the guard of the runner](https://github.com/netresearch/go-cron/blob/v0.15.0/cron.go#L1033-L1037), [its use](https://github.com/netresearch/go-cron/blob/v0.15.0/cron.go#L1091), [the note](https://github.com/netresearch/go-cron/blob/v0.15.0/docs/DST_HANDLING.md#L47-L49), [once in the runner](https://github.com/netresearch/go-cron/blob/v0.15.0/docs/DST_HANDLING.md#L66-L73), [the earlier loop](https://github.com/robfig/cron/blob/v3.0.1/spec.go#L138-L148), [the table](https://github.com/netresearch/go-cron/blob/v0.15.0/README.md#L25-L30), [the migration](https://github.com/netresearch/go-cron/blob/v0.15.0/docs/MIGRATION.md#L99-L115), [the controller](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/controller/schedule_controller.go#L286) |
| The controller reads the zero time as a run that is due: every instant is after it. A schedule whose expression has no instant, or is one of the three descriptors, passes validation, is Enabled and submits a backup at every look of the controller, once a minute, while none of its backups reports no phase, New or InProgress | [Due](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/controller/schedule_controller.go#L275-L289), [the look](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/controller/schedule_controller.go#L165-L169) |

### The Computation

Everything is a pure function on plain data, in `src/common/schedule-adherence.ts`
beside the [view of a schedule](../../src/common/schedule-view.ts) and its
[history](../../src/common/schedule-history.ts), given the schedule, the read of
the backups and the clock: the views draw what it answers.

The anchor is the one of the controller: `status.lastBackup`, or the creation of
the schedule, or `status.lastSkipped` when later than the one chosen. The expected
run is the first instant of the expression after the anchor, in the zone REQ-162
establishes. The states, by `now`, the clock the lateness is counted by: the one of
this machine, or of the cluster where [the clocks](#the-clocks) count by it:

| State | When | Mark | Words, for one example |
| --- | --- | --- | --- |
| Awaited | `now` is not after the expected run | The mark of a run that is awaited, a hollow shape | Next run in 5 h 12 min, at 03:00 UTC. Counted from the last submission, 2026-10-12 03:00:41 |
| Due | After the expected run, by five minutes at most | The same mark | Due: expected at 03:00 UTC, 2 min ago. Velero looks at a schedule once a minute |
| Overdue | More than five minutes after the expected run | The mark of what is late, the one the last validation of a location has | Overdue by 2 h 14 min: expected at 03:00 UTC. No submission since 2026-10-12 03:00:41; 1 expected run passed. Velero may not be at work, or may not be able to list the backups |
| Held | A backup of the schedule reports no phase, New or InProgress | The mark of what is late once the grace passed, the awaited one before | Held: Velero submits nothing while the backup nightly-20261013030041 is InProgress. A run was expected at 03:00 UTC, 2 h 14 min ago |
| No run | Paused, or FailedValidation | The mark the list has for paused; the one of the validation for FailedValidation | Paused: no run is expected until it is resumed. Resumed now, Velero would submit a backup at once: a run was due at 03:00 UTC on 2026-10-13, unless skip immediately is set. Or: No run: Velero refused the expression |
| Not known | No phase, a phase this version does not know, the zone not known, the expression not readable | The mark of what is not known | Not known: the expression names no time zone, and the one of the Velero server is not read. It is derived from the backup of a last submission, of this schedule or of another of the installation, and none is among the backups that exist. Name the zone in the expression, as `CRON_TZ=Europe/Rome 0 3 * * *`, to have it read |
| At every look | The expression has no instant within five years of the anchor, or is `@triggered`, `@manual` or `@none` | The mark of what is not known | At every look: the expression has no instant, and Velero submits a backup at each of its looks, once a minute, while none of the backups of the schedule is New or InProgress. Last submission 2026-10-13 14:01:12 |

The count of the expected runs that passed is of the instants of the expression
after the anchor and before `now`, strictly, so that it is at least one exactly
when a run is due, one by one, stopped at one hundred: an
`@every 1m` schedule whose last submission is a year old says more than one
hundred, and the computation does not walk the year. The grace of five minutes is
five times the period at which the controller looks at the schedules: a daily
backup that is five minutes late is one the controller did not look at for five
minutes, which is a server that is not at work or a submission it withheld, and
both are what the operator wants to hear. The grace and the bound are two
constants in one place.

In a zone the expression names, on the day the zone repeats an hour, an
expression with an instant in that hour has two expected runs in it, since the
parser gives both occurrences and the controller submits at each: the words of the
awaited state say so on that day, and both occurrences count. A derived offset
cannot see a change of the zone: its words say that the run may be an hour off
across one. A schedule whose expression has no instant is at every look: the
controller reads the zero time the parser gives as a run that is due, and submits
a backup at each of its looks, which the words say with the last submission; the
count is not made, and the Overview lists it.

A held schedule beyond the grace is both held and late: the words lead with the
hold, since it is the reason, and the item of the Overview carries the backup.
Whether the controller could list the backups is not something the extension can
see: the words of an overdue schedule name it as a cause beside a server that is
not at work, and nothing more.

The words of every state are written once, as the [notes](../../src/common/schedule-view.ts)
of a schedule are, and the list, the band, the section of the details and the
Overview say the same sentence for the same state. A time inside a sentence is in
the zone the expression is read in, written with the name or the offset of that
zone, since that is how the operator wrote the expression; the tip of a cell, and
the band, give the same instant as the host formats a date, in the time zone the
operator chose in the host.

### The Zone

The extension cannot know the local time zone of the server process. The options
the brief asks to weigh, and what this spec chooses:

| Option | What it gives | Why it is taken or not |
| --- | --- | --- |
| The zone the expression names | The rules of a named zone, with its daylight saving, as the runtime knows them | Taken: it is what the release reads, and what its documentation recommends to settle disputes over daylight saving |
| The `TZ` of the Deployment of the server, read from the cluster | The zone when the operator set one in the Deployment, and nothing when the image decides, which is the common case, since the installer sets none | Not taken: it needs a read outside the kinds of Velero, which the reader refuses by a test, a permission the identities of the views do not have, and is not conclusive |
| UTC as a stated assumption | A value for every schedule from the first read, true for a server whose process has no zone, which is what the command line of the release tells its users | Not taken as an assumption: a wrong zone would show a schedule on time that is overdue, or the reverse, with nothing on the page that says it may be wrong; the recon asks that an unknown state never look like a healthy one |
| The offset derived from the backup of a last submission of the installation | The offset of the zone of the server at that instant, from evidence the release writes: the name of the backup carries the wall clock of the server, and `status.lastBackup` the same instant; one server process submits every schedule of the installation, so the backup of any schedule gives the offset of all | Taken: it is exact for the instants until the next daylight saving change of that zone, and the words say that; it covers a new schedule beside ones that have run; it is nothing until a submission exists whose backup exists, which the words say as well; and two offsets among the submissions show a zone that changes its offset, which one schedule alone cannot show |
| A setting of the extension, the zone of the server named by the operator for an installation | The rules of the zone for every schedule, from the moment it is set | Not taken in this slice: it is a form, a preference per installation and a way to be wrong by hand, where the release itself gives the operator a way to name the zone in the expression; recorded below as the option to add if the derived offset proves too little in use |

The derivation, in full: among the backups of the installation, take the ones
that carry the label of a schedule of the installation, whose name is the name of
that schedule, a hyphen and fourteen digits, and whose creation is within a minute
of the `status.lastBackup` of that schedule: the backups of the last submissions.
Read the digits of the newest as a wall clock, `yyyymmddhhmmss`, as if it were
UTC, and subtract the creation of the backup: the difference, rounded to the
nearest quarter of an hour, is the offset of the zone of the server at that
instant, since every zone in use is a whole number of quarters of an hour from
UTC; a remainder of a minute or more means the name is not the controller's and
gives nothing. The newest submission is taken for every schedule, the one of the
schedule itself when it is the newest: it is the best evidence of the offset of
the server now. When the backups of the last submissions give two offsets, the
zone of the server changed its offset between the two submissions, which a
daylight saving rule does and which the derived offset cannot follow: the words
say so, with the two submissions, and the offset of the newest stands; nothing
would otherwise be known of an installation in such a zone for the thirty days
its backups live. The offset is kept for the installation, in memory, for the
session, with the backup and the time it was derived from, so that the signal
stays computed once that backup expires, and the band says where the offset came
from, naming the schedule when it is another. A backup asked by hand is named in
UTC and is never within a minute of a submission in practice; where one were, its
remainder tells it apart only when the offset of the server is not a whole number
of quarters of an hour from UTC, which is never: the spec accepts that a backup
made by hand in the same minute as a submission can mislead the offset by the
offset of the server, and records it as such.

What the runtime knows of a zone is what the browser engine of the host knows, by
the IANA name, through `Intl`: a name it does not know is a zone that is not
known, with the name in the words. The zone of the desktop and the
[time zone the operator chose in the host](https://github.com/freelensapp/freelens/blob/3da74415bff57a77c6e08cb5f538191ce87bac17/packages/core/src/features/user-preferences/common/preference-descriptors.injectable.ts#L60-L63)
are never used to compute an instant: they are used only to show one, as the next
section says.

### The Clocks

The views take their clock once for a read, from the
[clock of the views](../../src/renderer/components/views-frame.tsx), which ticks
every five seconds; the installation reads every fifteen. The cluster writes its
own: the creation of an object, a submission, a skip, the start of a backup. A time
the cluster wrote that is after the clock of this machine at the read that brought
it says that the cluster is ahead by at least that much: the view says so, in the
band and over the list, with that by the clock of the cluster a run may be later
still. It bounds nothing that is said overdue: the controller writes a submission
and counts a run by its own clock
([L242](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/controller/schedule_controller.go#L242),
[L257](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/controller/schedule_controller.go#L257),
[L266](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/controller/schedule_controller.go#L266),
[L288](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/controller/schedule_controller.go#L288)),
so a cluster that is ahead makes the lateness it counts longer than the one this
machine counts, never shorter. The other direction leaves no trace in the objects.

The reader of the extension is given the
[answer of the host](../../src/renderer/api/reader.ts) as a `Response`, whose
headers may carry the `Date` of the API server. The host configures its proxy
[in the proxy of the host](https://github.com/freelensapp/freelens/blob/3da74415bff57a77c6e08cb5f538191ce87bac17/packages/core/src/main/lens-proxy/lens-proxy.ts#L190-L202)
and changes no header of the answer there; what the proxy of the cluster of the
host does with the header on the way was not read, and whether it reaches the
reader was not seen in a run: the implementation measures it first, in the
packaged application, and records the
answer in the evidence. Where it does, the difference between that time and the
clock of this machine, measured at each read, is added to the clock of this machine
to count the lateness by the clock of the cluster, in both directions, and the words
say that the clocks are compared through it; where it does not, the lateness is
counted by the clock of this machine, and the words say that only a cluster that is
ahead can be seen, and that by its clock a run may be later still.

The host formats a `Date` given to its tooltip with
[`LocaleDate`](https://github.com/freelensapp/freelens/blob/3da74415bff57a77c6e08cb5f538191ce87bac17/packages/core/src/renderer/components/with-tooltip/with-tooltip.tsx#L22-L23),
which writes it in the
[time zone the operator chose](https://github.com/freelensapp/freelens/blob/3da74415bff57a77c6e08cb5f538191ce87bac17/packages/core/src/renderer/components/locale-date/locale-date.tsx#L23-L25)
in the preferences of the host, the one of the machine unless changed; both
components are
[given to extensions](https://github.com/freelensapp/freelens/blob/3da74415bff57a77c6e08cb5f538191ce87bac17/packages/core/src/extensions/renderer-api/components.ts#L82) with the [tooltip](https://github.com/freelensapp/freelens/blob/3da74415bff57a77c6e08cb5f538191ce87bac17/packages/core/src/extensions/renderer-api/components.ts#L111),
and the age the host writes in a list uses the
[same tooltip](https://github.com/freelensapp/freelens/blob/3da74415bff57a77c6e08cb5f538191ce87bac17/packages/core/src/renderer/components/kube-object/age.tsx#L27-L34).
The absolute instant of an expected run is given to the host so, in the tip of a
cell and in the band, beside the wall clock in the zone of the expression; the
[words of a time](../../src/common/operation-text.ts) the views write themselves
stay in the language of the machine, as they are.

### The Last Observed Run And The History

The last submission and the newest backup that exists stay the two facts of
SPEC-0006, and the band puts them side by side as the last observed run. The
backup of the last submission is the one created within a minute of it; when none
is among the backups that exist, the band says that it expired, was deleted or
cannot be read, and the signal stands on the submission, which the schedule
carries. A backup newer than the last submission was not submitted by the
schedule: asked by hand, which the command line allows, or synced from the store
by the server, which keeps the labels of the metadata; the band says so and that
it moves nothing in the schedule. The hold of REQ-163 is read from every backup of
the schedule, whichever it is, as the controller reads it: a backup asked by hand
holds the submissions as much as one the schedule made.

What the history cannot say, it does not say: between two backups that exist no
run is called missed, since a backup may have expired or been deleted, as REQ-069
of SPEC-0006 holds. Since the last submission the schedule itself says that
nothing was submitted, and that is what the count of REQ-161 counts.

### Where The Signal Shows

The list, which is the [native list](../../src/renderer/pages/schedules-page.tsx)
of the host with the columns of SPEC-0006 and the two of REQ-168, in this order:
name, installation, schedule, paused, next run, adherence, last submission, newest
backup, validation, age. A row of a schedule whose zone is derived, whose read is
stale or whose hold is not known carries the words of that in the tip of its
adherence cell and in the search. The order by adherence is by the weight of the
state and, inside a state, by the lateness or by the instant; the order by the
next run is by the instant, the past first, which puts what is overdue at the top
when the operator asks for the next runs.

The band of the workspace of a schedule, after the status and before the history:

| Line | Content | Source |
| --- | --- | --- |
| Next run | The state with its mark and its words, the expected run as a wall clock in the zone of the expression and as the host formats it, the time until it or since it | The computation |
| Zone | The zone the expression is read in and how it was established: named by the expression, derived from a backup with the backup and the time, or not known with why and the way out | REQ-162 |
| Counted from | The anchor and which of the three it is, with its time | `status.lastBackup`, the creation, `status.lastSkipped` |
| Last observed run | The last submission with the backup of it, which leads to the backup, or that it is not among the backups that exist; the newest backup that exists when it is another, with that it is not a submission | REQ-167 |
| Held by | The backup that withholds the submissions, with its phase and its way; absent when none | The backups |
| Expected runs passed | The count of REQ-161, with the first and the last of them | The computation |
| Clocks | By which clock the times are compared, and what is known of the clock of the cluster | REQ-166 |

Under the band the history is what SPEC-0006 made it, line of time and list. The
[section](../../src/renderer/details/schedule-details.tsx) in the details of the
host gains Next run and Adherence, as two items, in the words of the list.

The Overview reads the same functions. Rule A11 joins the
[rules](SPEC-0008-overview.md#requirements) of REQ-096 with the pull request of the
slice, in the group of the schedules, and OVER-04 is restated with it: a schedule
that is not paused and is Enabled, overdue or held beyond the grace with its zone
established, or submitted at every look since its expression has no instant. Its
reason is the sentence of the state; its time is the expected run, or the last
submission of a schedule at every look, so that the items of the group keep their
order from the newest; its related object is the held backup when there is one. A schedule whose
adherence is not known is not an item: the page says, before the items and beside
what the rules did not look at, how many schedules have an adherence that is not
known and why, by reason, so that a page with no item does not read as one where
every schedule is on time. The line of a schedule in the band of the schedules
shows its next run and its adherence beside the facts its list shows, and the
rules that name it put it first as before, which restates OVER-10.

### The States Of The Views

The states are the ones of every view of the extension, each with its own words,
and none takes anything from the others:

| State | The list | The band | The Overview |
| --- | --- | --- | --- |
| Loading | The two columns say nothing until the schedules were answered once: a family that was never answered is loading, and a signal is not computed from a read that did not end | The band says that the schedules are being read | The line of the schedules as SPEC-0008 has it |
| Empty | No row | No band: there is no schedule | No item, no line, and nothing said of the adherence |
| Restricted | Schedules denied: the list is denied, as SPEC-0006 says. Backups denied: the hold is not known and the zone cannot be derived, said in the cells; the states that need only the last submission keep their value | The same, with the reason in the lines of the zone and of the hold | The schedules denied give the line of what was not looked at; the backups denied make the schedules whose adherence needs them not known, counted and said |
| Partial | The schedules read and the backups not, or the reverse: each column says what it could not use | Each line of the band says what it could not use | As above |
| Stale | A signal computed from a read that is not the last one says that it is of a read at that time; the clock of the views still moves, and the lateness grows with it | The same, in the band | The items of a stale read say that they were read before, as every item does |
| Unknown | The states of REQ-165, each with its words and the mark of what is not known | The same | Counted among what is not known, never an item |
| Failure | A read that failed keeps what was read before, with when; nothing is computed from a failure | The same | The same |

Both themes, the keyboard alone, a window of 900 by 650 and twice the zoom, long
names and long expressions, the marks with their words for who does not see them:
the pre-review of the milestone checks them as it checked the Schedules and the
Overview, and the words of a mark are read with `innerText` as the suites read
them.

### What Differs On Main

The main branch of Velero at `c111008912919e6a1a4127b2a0b8a641ee2dad80`, compared
with the reviewed release in this area. Behaviour present only on main is design
guidance, never a baseline capability.

| Where | On main | Effect on this spec |
| --- | --- | --- |
| The library | The same, `netresearch/go-cron` at `v0.15.0` | None |
| The server default of `skipImmediately` | The controller [copies](https://github.com/velero-io/velero/blob/c111008912919e6a1a4127b2a0b8a641ee2dad80/pkg/controller/schedule_controller.go#L116-L120) the setting of the server into a schedule that names none, where the release gives the schedule a pointer to its own field and the reset to false that follows [writes through it](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/controller/schedule_controller.go#L114-L117): on the reviewed release a server started with `--schedule-skip-immediately=true` loses that default for every later schedule, once it read one that named nothing, which the [test of main](https://github.com/velero-io/velero/blob/c111008912919e6a1a4127b2a0b8a641ee2dad80/pkg/controller/schedule_controller_test.go#L249-L295) guards against | None on the signal, which reads what the object carries: the words of SPEC-0006 on an empty `skipImmediately`, that it follows the setting of the server, stay. Recorded for the drift watch |
| The decision to patch | Compared by [value](https://github.com/velero-io/velero/blob/c111008912919e6a1a4127b2a0b8a641ee2dad80/pkg/controller/schedule_controller.go#L154) and by [deep equality](https://github.com/velero-io/velero/blob/c111008912919e6a1a4127b2a0b8a641ee2dad80/pkg/controller/schedule_controller.go#L159), where the release compares pointers | None: the release patches the same fields, since a skip always writes a new time |
| A metric of the expected interval | The controller [computes](https://github.com/velero-io/velero/blob/c111008912919e6a1a4127b2a0b8a641ee2dad80/pkg/controller/schedule_controller.go#L139-L144) the gap between the next two instants of a valid expression from its clock and [exposes it](https://github.com/velero-io/velero/blob/c111008912919e6a1a4127b2a0b8a641ee2dad80/pkg/metrics/metrics.go#L783-L786) as `schedule_expected_interval_seconds` | Guidance: Velero itself now counts expected instants, in the zone of the server. The extension reads no metric, and counts from the anchor of the controller, not from now |
| The short name of the kind | [`sched`](https://github.com/velero-io/velero/blob/c111008912919e6a1a4127b2a0b8a641ee2dad80/pkg/apis/velero/v1/schedule_types.go#L107) | None |
| The template | [`backupType`](https://github.com/velero-io/velero/blob/c111008912919e6a1a4127b2a0b8a641ee2dad80/config/crd/v1/bases/velero.io_schedules.yaml#L85-L91), Full or Incremental, and [annotations](https://github.com/velero-io/velero/blob/c111008912919e6a1a4127b2a0b8a641ee2dad80/config/crd/v1/bases/velero.io_schedules.yaml#L437-L441) of the template, which the [builder](https://github.com/velero-io/velero/blob/c111008912919e6a1a4127b2a0b8a641ee2dad80/pkg/builder/backup_builder.go#L112-L130) prefers to the ones of the schedule | None on the adherence: the label of the schedule is written as before. The template of SPEC-0006 shows a field it has no words for by its name |
| The status of a schedule, the anchor, the hold, the name of a backup | The same | None |

## Tests

Planned homes: unit tests of the parser and of the computation, with the clock as
an argument, in `src/common/schedule-adherence.test.ts` beside the module; a
measure of the unit run, `test/schedule-adherence.measure.ts`, as the one of the
log; component tests of the two columns, of the band, of the section and of the
rule and the lines of the Overview; the suite of the schedules and the one of the
Overview in the packaged application, on the fixtures below; the pre-review.

The layers and what each proves:

- **Unit, with a controlled clock.** The grammar, against a table of expressions the
  parser of the release accepts and refuses, taken from the tests of the module at
  `v0.15.0` and from the tests and the documentation of the release, each accepted
  expression with its next runs from given instants in given zones: UTC, a zone east
  and one west of it, across the daylight saving changes of 2026 in both directions,
  the hour a change skips among them, in which the parser gives the first instant
  after the change, and the hour a change repeats, in which it gives both instants;
  a day of the month and a day of the week both restricted, which must both match;
  Sunday as `7`; a range that wraps; `N/step`; a step equal to its range, refused;
  `?` for `*`; the names of the months and of the days; `@every` with hours,
  minutes, seconds and a fraction, from an anchor with a fraction of a second, and
  below a second, refused; the seven calendar descriptors; the three descriptors
  without an instant and an expression with none within five years, which give the
  zero time; the prefixes with a name, with a quoted name, with `Local`, with an
  empty name, with a name of 65 characters, with a space in the name and with
  nothing after the prefix, the last four refused with the words of the parser; an
  expression of 1,025 characters, refused. The computation: the three anchors, due
  strictly after the instant, the grace, the count and its bound, the state at every
  look with no count, the hold by each of the three phases and by none of the
  others, the derivation of the offset with its rounding and its remainder, from
  the submission of the schedule itself and from the one of another schedule, two
  offsets among the submissions, a backup asked by hand, the clock of the cluster
  ahead, every state of REQ-163 to REQ-165 and the words of each, the weights of the
  order. A real run cannot be waited for in any layer: what the controller would do
  at an instant is what the unit layer proves, from the lines of the controller and
  of the parser.
- **Component.** The two cells with their marks, words, tips and order; the band
  with each of its lines present and absent; the section of the details; rule A11
  and the count of what is not known in the Overview, with the lines of the
  schedules; the states of the views, each family denied, stale and failed while
  the other is read; the focus and the keyboard.
- **Local integration.** The fixtures placed by the clock, read back; the real
  schedule the controller validated.
- **Packaged application.** The states on the fixtures, the two readers, the real
  schedule, the budgets, the pre-review in both themes at the two sizes and the
  zoom.

The fixture families the environment needs, beside the ones that exist:

| Family | Namespace | Content | Why the environment can place it |
| --- | --- | --- | --- |
| Adherence, placed by the clock | `velero-adherence-<run>`, which no controller reads, good for twelve hours as the Overview's, named by the operator (LM3) | An awaited schedule, `@every 24h` with its last submission at the placement; an overdue one, `@every 1h` with its last submission 25 hours before and no backup, so that the backup of the last submission is not among the ones that exist; a held one, `@every 1h` with its last submission 3 hours before and a backup InProgress newer than it, which is as well a backup that is not a submission; one at every look, `0 0 30 2 *`, Enabled, with its last submission a minute before the placement and no backup; one whose zone is derived from its own submission, `0 3 * * *` with its last submission at the placement and the backup of it named with the wall clock of a server two hours east of UTC, created at the placement; one created with no submission, `0 3 * * *`, which takes the offset of the installation from that backup; one whose last submission is a day after the placement, for the clock of the cluster ahead (LM5); and one with a name of 63 characters and `CRON_TZ=America/Argentina/Buenos_Aires 0 0 1 1 *`, for the pre-review | A client writes the status of a Schedule with the object, since the kind has no status subresource; the creation of a Backup is the placement, which is why the backup of a submission can be matched only for a submission at the placement, and why the overdue case has no backup; a backup of a submission is created first, named by the clock of this machine read just before, and its schedule after it, with the creation read back as its last submission, which is refused more than thirty seconds from that clock; the times are counted back from the placement, which the objects say in an annotation, as the fixtures of the Overview do. A schedule at every look is never placed where a controller reads: it would create a backup a minute |
| Two offsets, placed by the clock | `velero-adherence-split-<run>`, named by the operator as the long lists are (LM3) | Two schedules `0 3 * * *`, one with its last submission at the placement and the backup of it named two hours east of UTC, the other with its last submission twenty seconds before (LM5) and the backup of it named at UTC, both created at the placement: the offset of the newest is taken, and the words say that the offset changed between the two submissions | The same |
| Budget of the adherence, placed by the clock | `velero-adherence-scale-<run>`, a namespace of its own, named by the operator as the long lists are (LM2) | The 300 schedules of the budget, of the mixed expressions of the measure of the unit run, `@every`, five fields, with and without a zone name, the calendar descriptors, each with its last submission at the placement and the backup of it named two hours east of UTC, so that the installation has one offset | The same, the backups created fifty at a time, each group named by the clock read just before it |
| Not known for want of an offset | `velero-views-<run>`, among the fixtures of the views, where no backup gives an offset | A schedule `0 3 * * *` with no submission, and one with a submission two days old and no backup: not known, each with its reason; beside them an interval, `@every 6h`, with a submission two days old and no backup: overdue at every age, an item of A11 in the Overview of the views at every hour, its state kept for the second reader, which reads no backup | Placed with the fixtures of the views, whose backups carry no name of fourteen digits within a minute of a submission; an interval names no zone, and its next run is counted from its last submission |
| The schedules that exist | `velero-views-<run>`, `velero-static-<run>` | Paused, invalid, no phase, New, paused with a skip, the one that names `Europe/Rome`, the one with a history | Already placed; the suite computes what it expects of the zoned one from its creation and the clock, at every age of the environment |
| The real schedule | `velero-demo`, the installation the controllers read | `@every 8760h`, naming no `skipImmediately` (LM4), its template the spec of the real backup, placed with the fixtures of the tabs and removed by their cleanup | The controller validates it within a minute and writes Enabled and `skipImmediately`, which the placement waits for; its next run is a year after its creation, so that it submits nothing while the suites run, which the guard counts: no Backup created (LM1) |
| The readers | `velero-views-<run>` | The reader of three kinds, which reads the backups, and the second reader, which does not | Already placed |

What the environment cannot produce is said as such: a submission at an instant the
suite chooses, a hold the controller itself observes, and a server in a zone other
than its own. These stay at the unit layer, from the lines of the controller.

| Check | Layer | Requirements | Scenario and expected evidence |
| --- | --- | --- | --- |
| ADH-01 | Table-driven unit | REQ-160 | The table of expressions: accepted, each with its next runs from given instants in UTC, in a zone east and one west, across both daylight saving changes of 2026, the skipped hour giving the first instant after the change and the repeated hour giving both occurrences; a day of the month and a day of the week both restricted, matching only a day that is both; Sunday as `7`; a wrapping range; `N/step`; `?`; the names; the seven calendar descriptors; `@every` with a fraction, truncated and rounded to the second; the three descriptors without an instant and `0 0 30 2 *`, which give the zero time. Refused, with the words of the parser: an empty zone name, a name of other characters, a name of 65 characters, a prefix with nothing after it, a step equal to its range, `@every` below a second, an expression of 1,025 characters; and the words the controller writes for an empty expression. One this version cannot read, which gives not known and never overdue. The table names the source of each row, the tests of the module at `v0.15.0` or the tests and the documentation of the release, and marks the rows the library of v1.18.2 read otherwise |
| ADH-02 | Fake-clock unit | REQ-161 | The anchor from the last submission, from the creation, from the last skipped time when later and not when earlier; due a second after the instant and not at it; the count at one, at three and beyond one hundred; the daily and the interval cases of the tests of the release reproduced; an expression with no instant and each of the three descriptors: the state at every look, no expected run, no count, and the words with the last submission |
| ADH-03 | Fake-clock unit/component/packaged | REQ-162 | A named zone, a quoted name, `Local`, a name the runtime does not know; an empty name as FailedValidation, with the words of REQ-164; the derivation from a backup two hours east, one west, at UTC, with a remainder of fifty seconds and one of ninety, a name of thirteen digits, a backup two minutes from the submission, a backup asked by hand in the same minute, and no backup; the offset of the newest submission of the installation for a schedule with no submission, said with the schedule it came from; two offsets among the submissions, the newest taken and the change said; `@every` with no zone; the offset kept once the backup is gone; the two runs of a repeated hour in a named zone, in the words of the awaited state; never the zone of the desktop, asserted with the clock of the test in another zone. Packaged: the derived schedule with its offset in the words, the new schedule beside it with the offset of the installation, the installation with two offsets, the two not known with their reasons, the zoned one |
| ADH-04 | Fake-clock unit/component/packaged | REQ-163 | Awaited, due at four minutes, overdue at six with its duration, its instant, its anchor and its count, held by a backup of each of the three phases and not by Queued, ReadyToStart, Completed or Failed, held beyond the grace; an expression with no instant, which is none of the four; the words of each. Packaged: awaited, overdue with its count, held, at every look, each as the fixture was placed, computed by the suite from the annotation of the placement and the clock |
| ADH-05 | Unit/component/packaged | REQ-164 | Paused with a run already due and with none, with and without the skip; FailedValidation; no phase; a phase that is not known: no instant computed for any, and the words of each. Packaged: the schedules that exist |
| ADH-06 | Unit/component/packaged | REQ-165 | Each state of uncertainty with its mark and its words, the schedule Velero submits at every look among them; a signal of a stale read; a derived offset said approximate; the backups denied with an `@every` schedule, which keeps its state with the words of the hold, and a five-field one, which is not known. Packaged: the second reader on both, and the schedule at every look |
| ADH-07 | Fake-clock unit/component/packaged | REQ-166 | A submission, a creation, a skip and a start after the clock, each said in the words of the clocks and none keeping a schedule from being said overdue; nothing after it; the lateness counted by the clock of the cluster with the time of the API server, ahead and behind, and by the clock of this machine without it; the words of the clocks with and without the time of the API server, which the unit test gives and withholds. Packaged: the schedule whose last submission is ahead, and the first measure of whether the header reaches the reader, recorded |
| ADH-08 | Unit/component/packaged | REQ-167 | The backup of the last submission found within a minute, not found, a backup newer than the submission said not a submission; a gap between two backups with no word of a missed run. Packaged: the overdue fixture, whose backup is not among the ones that exist, and the held one, whose backup is newer than the submission |
| ADH-09 | Component/packaged | REQ-168 | The two columns, their IDs, their words, their tips, their search, the order by adherence with a schedule of every weight, two of one weight by their measure and two by name, and the order by the next run with the past first and none last; the columns that give their room at 1,199, 999, 759 and 639 pixels. Packaged: a search by a word of a state, an order by each of the two columns read from the rows, a column made wider, a schedule opened and closed leaving the list where it was |
| ADH-10 | Component/packaged | REQ-169 | Every line of the band present and absent, the way to the held backup and back, the line of time unchanged with no mark where no backup is. Packaged: the band of each fixture, the way to the held backup and back over the list |
| ADH-11 | Component/packaged | REQ-170 | The two items of the section agree with the list and the band for a schedule of each state |
| ADH-12 | Table-driven unit/component/packaged | REQ-171 | Rule A11 with a case that gives an item and one that gives none for each of overdue, held within and beyond the grace, at every look, paused, invalid, not read, zone not known; the time and the related object of an item; the count of what is not known by reason, before the items; the lines of the schedules with the two facts, the ones a rule names first; the rules A1 to A10 of SPEC-0008 unchanged beside it. Packaged: the items of the adherence fixtures in the order of the page, the one at every look among them, the count of what is not known, the lines |
| ADH-13 | Adapter/packaged | REQ-172 | Unit: the reader refuses the path of a Deployment and of a Secret. Packaged: the evidence of DISC-07 taken again with the Schedules and the Overview open on the adherence fixtures, no write counted of the kinds of Velero |
| ADH-14 | Fake-clock component | REQ-173 | The schedules read and the backups failing, and the reverse; the signal computed again at a tick of the clock from the last read, and from a new read; a late answer of another installation; no timer left when the view closes |
| ADH-15 | Pre-review | REQ-174 | The list, the band and the Overview in both themes, at 1440 by 900, at 900 by 650 and at twice the zoom, a name of 63 characters and an expression with a zone name and five fields; the band read with the keyboard alone, the held backup reached and left; every mark with its words |
| ADH-16 | Unit measure/packaged performance | REQ-175 | The measure of the unit run on 1,000 schedules of mixed expressions, twenty calls after five, within 250 milliseconds at the 95th percentile, one schedule within 2 milliseconds, the parse cached and the count bounded, printed as one line before anything is asserted. Packaged: the list of 300 schedules, twenty warm interactions, ten searches and ten orders, within 250 milliseconds at the 95th percentile of what the list takes to answer, with the time from the key beside it; the Overview of the same installation within the budget of OVER-12 |
| ADH-17 | Local integration/packaged | REQ-176 | The fixtures placed by the clock read back with their annotation, the installation with two offsets among them; the real schedule Enabled with `skipImmediately` written by the controller, its next run a year after its creation in the words of the list, and no Backup created in the installation while the suites run, counted on the API server; the schedule at every look placed where no controller reads, and never in the installation of the controllers, which would create a backup a minute; every state of the fixtures as the cases above say |

## Success Criteria

All 17 checks pass before this spec is Verified. No view shows a next run for a
schedule that is paused, refused or not read; no five-field expression without a
zone name has a next run unless its offset was derived, and then the words say so;
no state of uncertainty has the mark or the words of a schedule on time; a clock
of the cluster seen ahead of this machine never keeps a schedule from being said
overdue, and with the time of the API server the lateness is the one the clock of
the cluster counts; the real schedule of the installation submits nothing while the
suites run; the API server counts no write of the kinds of Velero.

Budgets: the signal of one schedule within 2 milliseconds and of 1,000 within 250
milliseconds at the 95th percentile in the measure of the unit run, on the machine
of the runs and on the hosted runner, in both forms of the build; the list of 300
schedules within 250 milliseconds at the 95th percentile across twenty warm
interactions in the packaged application, as REQ-035 of SPEC-0003 measures it; the
Overview of the same installation within REQ-104 of SPEC-0008. A budget that is
not met is investigated, never met by fewer schedules.

Failure criteria: a next run, a count or an overdue said of an expression that has no instant; a computed instant that differs from the one the parser of the
release gives for the same expression, anchor and zone, in the table of ADH-01; a
count that walks more than one hundred instants; a zone taken from the desktop or
from the host; an item of rule A11 for a schedule whose adherence is not known.

Manual review: on the demo with the adherence fixtures in place, say in one minute
which schedule is overdue and since when, which is held and by what, and which has
a next run that is not known and what would make it known; follow the held backup
and come back; change the time zone in the preferences of the host and look at the
tips of the next runs. Expected: the three answers are on the list and on the band
without opening the objects; the way back ends on the row; the tips follow the
preference of the host and the computed instants do not move. Record role, date
and verdict.

## Assumptions And Decisions

- **The grace is five minutes.** The controller looks at every schedule once a
  minute and submits at the first look after the instant; the installation reads
  every fifteen seconds; the clocks of two machines differ by seconds. Five minutes
  is five times the period of the controller: a daily backup five minutes late is a
  server that did not look, or a submission it withheld, both worth the word
  overdue. A grace that grew with the interval would make a weekly schedule hours
  late before it said so, for no reason the controller gives. The lead maintainer
  confirms the value at approval.
- **The count stops at one hundred.** Past that, how many runs were missed is not
  what the operator needs, and an `@every 1m` schedule a year old would cost half a
  million steps.
- **The zone of the server is derived, not assumed, and not set.** The reasons are
  in the table of the design. The derivation rests on two lines of the release that
  write the same instant in two forms, and gives nothing until a submission has its
  backup, which the words say. It is of the installation and not of one schedule,
  since one server process submits every schedule of it: a new schedule beside ones
  that have run takes the offset of the newest submission, said with the schedule
  it came from. Two offsets among the submissions are a zone that changed its
  offset between them, said as such, and the newest is taken rather than nothing:
  an installation whose server runs in a zone with daylight saving would otherwise
  be not known for the thirty days its backups live. A setting per installation, the zone of the server
  named by the operator in the target bar and kept with the maps of the namespaces,
  is the option to add if the derived offset proves too little in use: it would
  give the rules of the zone, where the derivation gives an offset, and would stand
  below the expression and above the derivation. It is not in this slice, and the
  lead maintainer decides it at approval or after the review of the milestone.
- **The offset is matched within a minute and rounded to the quarter of an hour.**
  The controller creates the backup and writes the submission with one reading of
  its clock; a minute covers the API server and the patch. Every zone in use is a
  whole number of quarters of an hour from UTC. A backup asked by hand is named in
  UTC: one created in the same minute as a submission would give an offset of zero
  for a server that is not at UTC, with a remainder of zero as well. The spec
  accepts this, since the two cannot be told apart and the case needs a hand on
  the same minute as the controller.
- **The grammar is written in the repository from the source of the parser**, and
  no library is bundled for it. The expression must be read as the parser of the
  release reads it, at the pinned version; the parsers available as packages have
  grammars of their own, with seconds, symbols and day rules the release does not
  know, and none documents the AND of the day fields, the rule of the skipped hour
  or the zero time. The implementation writes the grammar as its own code from the
  rules of REQ-160 and the facts of the parser, with the table of ADH-01 taken from
  the tests of the module, and keeps the legal notice of the module if any of its
  text is kept; nothing of its code is copied wholesale, as the directives ask.
- **The library of the release changed between the reviewed releases**, and the
  rules that changed with it are recorded for the drift watch of the recon by the
  pull request of the slice, since this draft writes one file: the AND of the day
  fields; the run of the hour a daylight saving change skips, submitted at the
  first instant after the change, where the documentation of the release still says
  it is not run; the empty zone name refused; the prefix with nothing after it an
  error and not a panic, with texts that differ; Sunday as `7`; the wrapping
  ranges; the step smaller than its range; `@every` below a second refused; the
  limit of 1,024 characters; the quotes around a zone name; the descriptors
  `@triggered`, `@manual` and `@none`. The changelogs of the release do not record
  the change of library.
- **A schedule whose expression has no instant is an item of the Overview**, under
  rule A11, and a state of its own, at every look: the controller submits a backup
  at every look, once a minute, which fills the installation with backups until
  someone pauses or corrects the schedule, and the words say what happens and why.
  It is neither awaited nor overdue, since it has no expected run; its mark is the
  one of what is not known for the run, and the words carry the fault.
- **Due is proven at the unit and component layers.** It lasts five minutes after
  an instant the fixtures cannot choose, since a suite starts minutes after the
  fixtures are placed.
- **Overdue and held beyond the grace are items of the Overview; what is not known
  is counted and said, never an item; a paused schedule is no item**, as SPEC-0008
  decided: whether a pause is a problem is a judgment of the operator. A held
  schedule within the grace is no item either: the hold is what the controller
  does, and five minutes of it is not a fault.
- **The time of the API server is measured before it is relied on.** The host
  passes the headers of the cluster through its proxy by default, and the reader
  holds the answer; whether the `Date` header arrives in the renderer was not seen
  in a run. The implementation looks first, in the packaged application, and the
  requirement has its fallback either way.
- **A time inside a sentence is in the zone of the expression; the tip is the
  host's.** The operator wrote the expression in that zone and reads the run in it;
  the host shows every other date in the zone the operator chose in its
  preferences, and the tip joins them.
- **The weights of the order by adherence** are the states, and put what needs a
  hand first: overdue by the longest, held, due, at every look, not known, awaited
  by the soonest, no run for a refused expression, no run for a paused schedule,
  and by name inside a weight. Not known comes before awaited so that an unknown is
  never sorted below a healthy one.
- **The line of time is unchanged.** A mark where no backup is would read as a lost
  backup; the band says in words that no submission was made, and how many runs
  that is.
- **The last submission and the newest backup stay two columns**, and give their
  room under 760 pixels before the expression does: both are in the band, and the
  adherence column carries what they said of a schedule at a glance.
- **The words of REQ-066 of SPEC-0006 change with this slice.** That spec computes
  nothing from the expression; this one does, under REQ-160 to REQ-162, and the
  words that the view does not read the zone of the server stay true: it derives or
  asks. The check SCHED-03 is restated with the pull request, as the design says.
- **The fixtures of the adherence and the time of their suite, decided for the
  third and the fourth pull requests of T3.3.** Six decisions on the test
  environment, on what the guard of the suites counts and on where the suite of
  the adherence runs, approved by the lead maintainer on 2026-10-16, as
  recommended:
  - LM1: whether the controller sends a PATCH of a schedule at each of its looks,
    since the reviewed release decides to patch by comparing pointers, is
    measured on the test environment, from the counters of the API server, before
    any suite rests on the real schedule. If it does, the writes the suites count
    leave out the PATCH of the schedules, as they leave out the one of the storage
    locations, and every suite asserts instead that no Backup was created and that
    the version and the status of the real schedule did not change: the counters
    carry no namespace, and the versions of the synthetic schedules still catch a
    change of one.
  - LM2: the 300 schedules of the budget are in a namespace of their own,
    `velero-adherence-scale-<run>`, named by the operator as the long lists are,
    so that the installation of the states keeps eight schedules whose items and
    words a suite computes.
  - LM3: the installations of the adherence are named by the operator, the one of
    two offsets as well, and not found by the discovery: they hold no storage
    location, nothing changes in the suites that count the installations, and the
    Overview of each has one item of A4.
  - LM4: the real schedule names no `skipImmediately`, and the placement waits for
    the controller to write the phase and that field, which proves that the
    controller read it.
  - LM5: the clock of the cluster is said ahead by a day, not an hour: a last
    submission an hour after the placement is no longer ahead after the first hour
    of the twelve the fixtures are good for. The second submission of the
    installation of two offsets is twenty seconds before the first, not fifty:
    the remainder of the name of its backup is those seconds and the time the
    creation took, which the placement keeps within thirty, under the minute of
    the rule of REQ-162.
  - LM6: the suite of the adherence is `velero-e2e-adherence`, and runs in the run
    of the pattern `velero-e2e` of the hosted job of the views, which takes it
    with no change of the workflow; the times of its first hosted run are read and
    recorded before anything else is decided. A step of its own in the job, with
    its own bound, is a decision for the lead maintainer after those times.

No NEEDS CLARIFICATION marker: every decision above has a default with its reasons,
and the ones the lead maintainer may overturn at approval are named as such.

## Evidence And Deviations

Initially: no implementation, tests or runtime evidence. The facts of the reviewed
release above were read in its source, each at the line it links; nothing was run,
and no cluster was contacted for this draft.

What this draft could not verify, and what the implementation establishes first:

- The test environment ran v1.18.2 when this was drafted, whose parser is the
  library of the recon; it runs the reviewed v1.18.4 since the pull request that
  moved the reviewed release, so the parser of its controller is the one of REQ-160.
- The zone of the server process on the image of the release, which is outside the
  tree; the spec does not rely on it.
- Whether the `Date` header of the API server reaches the reader through the
  proxies of the host; REQ-166 holds either way.
- The reading of the recon that v1.18.2 named `robfig/cron`: the source of that
  library at `v3.0.1` was read for the differences, and the tree of v1.18.2 was not.

Later record command, exit code, counts, versions, the table of ADH-01 with its
source, the measure of ADH-16 with the machine and the run, the answer of the
header of ADH-07, the cleanup of the fixtures of the adherence and of the real
schedule, and every deviation with its approval before claiming Verified. Actual
environment data stay outside project files and agent output.

T3.1, the grammar of the cron library and the computation with a controlled clock, on 2026-10-14, on the
machine of the runs (macOS, Node 24.21.0, pnpm 10.34.7, TypeScript 7.0.2, Vitest 5.0.4, Biome 2.5.14, Knip
6.41.0, Trunk launcher 1.3.4), after the independent review of the branch. `pnpm type:check`, exit 0; `pnpm
lint:check`, exit 0, 220 files; `pnpm test:unit`, exit 0, 74 files and 2,468 tests, the 177 of
`src/common/schedule-adherence.test.ts` among them, then the two measures; `pnpm knip:check`, exit 0; `pnpm
trunk:check --all`, exit 0, 276 files. The table of ADH-01 is in the test file, 112 accepted expressions with
their next runs, 8 with no instant or a zone not known and 34 refused with the words the controller writes,
each row with the file and the line of the tests of go-cron v0.15.0 or of Velero v1.18.4 it is taken from, 52
rows marked as read otherwise by the library of v1.18.2; the tests run with the zone of the machine set
fourteen hours east of UTC, asserted. The next instant agreed with an oracle of the review, a transliteration
of `Next` and of the zone rule of Go, on 17,832 cases. The measure of ADH-16 printed `ADH-16 unit`: 1,000
schedules of 898 expressions, the thousand signals in 14.2 ms at the 95th percentile and 11.6 at the median,
of 250, 64.9 ms on the first call that parses them, one schedule in 0.03 ms of 2; the parse kept by text and
the count bounded at one hundred asserted, 72 schedules at the bound. Deviations of the slice, to amend in the
spec: REQ-160 (L128), the limits of the parser are in bytes, as the parser counts (`parser.go` L419, L1403),
where the text says characters; REQ-160 (L128) and ADH-01 (L524), a name the server does not know is not a
refusal of the extension, which cannot know the zones of the server, but a zone that is not known when the
runtime does not know it, and a name with a space is refused by the count of fields where the server refuses
it as an unknown zone; REQ-161 (L129) and the design (L232-L233), the count of the runs that passed is of the
instants strictly before the clock, so that it is at least one exactly when the run is due. The texts of the
refusals are kept verbatim with the notice of the library in the header of the module, as the assumption at
L616-L618 asks. The documentation of the release still says that a run in the hour a change skips is not run
(`backup-reference.md` L74), a sentence of the earlier library, recorded in the drift watch of the recon.

T3.2, the states of a schedule, their words, the zone of the server and the clocks, on 2026-10-15, on the machine
of the runs (macOS, Node 24.21.0, pnpm 10.34.7, TypeScript 7.0.2, Vitest 5.0.5, Biome 2.5.14, Knip 6.41.0, Trunk
launcher 1.3.4), after the independent review of the branch and its fixes, rebased on main. `pnpm type:check`,
exit 0; `pnpm lint:check`, exit 0, 222 files; `pnpm test:unit`, exit 0, 75 files and 2,547 tests, the 79 of
`src/common/schedule-signal.test.ts` among them, then the two measures; `pnpm knip:check`, exit 0; `pnpm
trunk:check --all`, exit 0, 280 files; each of the fourteen commits type-checks. The signal is
`src/common/schedule-signal.ts`, beside the module of T3.1: the offset of the server read in the name of the
backup of the newest submission of the installation, the digits as UTC minus the creation, rounded to the quarter
of an hour with a remainder under a minute, kept for the session as a plain value the views hold; the clocks, the
lateness counted by the clock of the cluster when the time of the API server is given and by the clock of this
machine when it is not, a time an object reports after the clock of this machine at the read that brought it said,
and bounding nothing; the states with their marks, weights and words, the pause and the phase read before the
expression; the last observed run; the order by adherence. The tests run with the zone of the machine set fourteen
hours east of UTC, asserted, and again with it set to Los Angeles for the same signals. The measure of ADH-16
printed `ADH-16 unit`: the whole signals with their words of 1,000 schedules of 898 expressions, the offset derived
from 1,010 backups, in 42.7 ms at the 95th percentile and 31.5 at the median, of 250, 102 ms on the first call, one
schedule in 0.04 ms of 2; none not known, ten held, ten at every look, 8,775 runs counted and 72 schedules at the
bound, as for T3.1. The independent review found REQ-166 the wrong way round for a cluster that is ahead, which
only makes the lateness the controller counts longer; the pull request amends
REQ-166, scenario 7, REQ-163, the table of the computation, the design of the clocks, ADH-07 and the Success
Criteria, an amendment of an approved requirement for the lead maintainer to confirm at the review of the
milestone. Deviations of the slice, to amend in the spec: REQ-165 (L133), the hold not known, a read of before and a
derived offset are words beside a state that keeps its mark, as REQ-165 says of the backups denied, ADH-06 (L529)
and the design (L384-L386) have it, and the mark of what is not known is of the states of uncertainty proper;
REQ-161 and REQ-163 (L129, L131), an expression with no instant is at every look whatever the zone, since it has
none in any; REQ-164 (L132), a paused schedule is paused whatever its phase, what Velero would do at its resume is
said of a phase Enabled only and of the schedule as it is now, and New is said not read as no phase is; REQ-162
(L130, L280-L289), the derived offset is bounded to the zones in use, and the times of an interval and of a zone
not known are written in UTC; REQ-167 (L135), the backup of a submission is said gone only from the last read of
the backups made after it, and not known from one made before it or failing since, whose newest backup is said of
that read; the durations are written as the views write every duration, "2h 14m", and one under a second as such,
where the examples of the design (L224-L230) write "2 h 14 min". SPEC-0006 keeps its Success Criteria (L157-L158),
which the views of T3.3 make untrue.

T0.8, the checks of T3.1 and T3.2 on Freelens v2, on 2026-10-22, in CI on main at `b5834444`, the merge of the pull
request of T0.7 of [SPEC-0015](SPEC-0015-freelens-v2-host.md) (#83), where every run passed: Unit tests
39816205144, on the hosted runner `ubuntu-24.04-arm`, its image 20261021.157.7, with Node 24.21.0, pnpm 12.14.0,
the SDK `@freelensapp/extensions` 2.0.0-0-nightly-2026-10-19, TypeScript 7.0.2 and Vitest 5.0.5: `pnpm test:unit`,
the build, then 83 files and 2,591 tests, every one passed, then the two measures. ADH-01 to ADH-08 at the unit
layer are green on v2: the `describe` blocks of `src/common/schedule-adherence.test.ts`, 177 tests, carry ADH-01,
ADH-02, ADH-03 and ADH-08, and the ones of `src/common/schedule-signal.test.ts`, 79 tests, carry ADH-03 to ADH-08,
and every test of both passed. The measure of the unit run of ADH-16, `test/schedule-adherence.measure.ts`, printed
`ADH-16 unit`: 1,000 schedules of 898 expressions, the offset derived from 1,010 backups, none not known, ten held
and ten at every look, the thousand signals with their words in 29.3 ms at the 95th percentile, of 250, 22.3 at the
median and 70.6 on the first call, one schedule in 0.03 ms, of 2, 8,775 runs counted and 72 schedules at the bound
of the count. T3.3 is not implemented: the component and packaged parts of ADH-03 to ADH-08, ADH-09 to ADH-15,
ADH-16 in the packaged application and ADH-17 stay as they are. The deviations of the two slices recorded above
hold on v2 as they are; v2 brings no other.

T3.3, the first of its four pull requests: the adherence in the list, the view of a schedule and the details of the
host, on Freelens v2 at the validation target, on 2026-10-23, on the machine of the runs (macOS, Node 24.21.0, pnpm
12.14.0, TypeScript 7.0.2, Vitest 5.0.5, Biome 2.5.15, Trunk launcher 1.3.4). `pnpm type:check`, exit 0; `pnpm
lint:check`, exit 0; `pnpm test:unit`, exit 0, 85 files and 2,631 tests, then the two measures, the one of ADH-16 as
before, the thousand signals in 41.3 ms at the 95th percentile of 250; the same with
`VITE_PRESERVE_MODULES=false`; `pnpm knip:check`, exit 0; `pnpm trunk:check --all`, exit 0. On 2026-10-25, with the
second phase, on the head rebased on main `018d7c2`: `pnpm type:check`, `pnpm lint:check`, `pnpm test:unit`, 85 files
and 2,632 tests, then the two measures, and `pnpm knip:check`, each exit 0. The pull request adds two files and 41
tests, 40 in the first phase and one in the second, to the 83 files and 2,591 tests of main, with the zone of the
machine fourteen hours east of UTC in the tests of the views as in the ones of the signal, and every word they assert
read from the words of the module: 12 of the reader, the header Date read with the middle of the request, absent, not a
date in each of seven forms, on a refused answer, beside a body that is no object and from headers that cannot be read,
with the Deployment of the server among the paths it refuses (ADH-07, ADH-13); 4 of the state, the offset kept when the
backups fail and once its backup is gone, carried with its change and dropped with the installation, and the time of the
API server from the newest answer that listed, kept when a read fails, of no late answer (ADH-07, ADH-14); 16 of the
list, the view and the details, the columns, the cells and their tips for a schedule of each of the eight states, the
order by the next run, the runs of each state from the earliest, and by adherence, through the order of the host both
ways, the search, the cells empty until the backups were answered once and said, with why, when the backups are refused,
a schedule due that is overdue at a tick with no read, the reads of the schedules and of the backups failing each apart,
the rows of the next installation computed with nothing of the one before, no timer left, the words of the clocks over
the list and in the band with and without the time of the API server, and the items of the details agreeing with the row
for each state, with the date of the host beside an instant, asking nothing, saying the age of the read they compute
with once no view of the extension asks again, and computing a schedule of another namespace with nothing of the
installation the views read (ADH-07, ADH-09 to ADH-11, ADH-14, SCHED-03 restated); 6 of the band, each line present and
absent for each state, the grace under the states it applies to, each sentence of what holds the submissions once, with
the ways to the backup of the submission, the newer one, the newest one and the one that holds (ADH-08, ADH-10); 3 of
the stylesheet, the columns each width gives up, the five that stay, and, since the second phase, the five that have a
width of their own from 1,000 pixels (ADH-09). ADH-15 at the component layer: each mark beside its word, the icon hidden
from who does not see it. Twenty changes were made on purpose to the code, on a copy of the tree, and nineteen each made
a test fail: the rank left out of the order by the next run; the offset kept when another installation is selected; the
time of the API server taken before the generation is checked, from an answer that refused the read, and both values
held as deep observables; the details of a schedule of another namespace given the context of the installation selected,
and their clock left running; the cells drawn while the backups load; the sentence in the search; the clocks said over a
list where no object is ahead; the band left in the restated check of the view; the line of the hold always drawn; the
way to the newer backup left out; the grace left out; the clock of an answer taken at its end; a header that is not
written as HTTP writes a date taken, and the header of a refused answer left out; the expression kept under 640 pixels;
and the last submission back under the class of a start. The twentieth, a cell of null while the backups load, is
refused by the type check: the host draws a cell of null as an empty cell under its column, as its double does, so no
test sees it. After the independent review of the branch eleven more were made, and each made a test fail: the instant
left out of the order by the next run; the details of another namespace given the context of an installation that reads
one; a refusal of the backups not counted as an answer; the note of a hold not known, and the sentences of the backup
that holds and of how many more do, said again under the next run; the grace said under every state; the age of the read
never said, and said only when no view is open; the state left saying that a view is open once the last one closed; the
date of the host left out of the details; and the header read where headers that throw lose the answer. The suite of the
schedules is restated, and run in the packaged application with the second phase of the pull request, on the nightly of
the validation target and the environment of the repository, on 2026-10-25: its 17 cases, every suite of the views with
them, 174 cases in 12 files, and the pre-review, 33 cases, green, and the same on the hosted runner. The header Date of
ADH-07 reaches the frame through the client of the host and through a plain fetch, with the headers the API server
writes beside it, `audit-id` and the ones of its priority and fairness, and it is the one of the API server, as
AGENTS.md says with the lines of the source of the proxies of the host: the band compares the clocks by the clock of the
cluster, within a second of the one of the machine there, the clock of the node of kind being 31 to 34 milliseconds from
it, and the suite asserts the form of that sentence. Each edge of the room of the list, from 1,201 to 640 pixels, was
reached at the zoom of 1, with a window 323 pixels wider than the room, from 1,524 to 963 pixels, on a Mac with a work
area of 1,792 by 1,003 pixels and on the hosted runner, 1,920 by 1,200; the report of the case keeps them for each run.
The case of the edges runs before the case that resizes a column, since the host keeps the width a resize gives every
column of the list. The run found three faults of the list: at every width the words of the next run and of the
adherence sat 1.7 pixels above the words of their row, since their badge was in a block, and Not paused was clipped with
no ellipsis and no tip, since a cell of the host clips a plain span where its room ends; and how the newest backup ended
was clipped where its column is narrow, in the window of 1440 by 900 and, with the name made wider by the case that
resizes it, from 761 pixels. The badge is in a flex box, paused is in the badge of the host, how the newest backup ended
is cut with its tip rather than clipped, and in a list of 1,000 pixels or more paused holds its words whole and the age
every age the host writes, the next run and the adherence keeping a width that holds their longest words, five years
either way; in a window of 1440 by 900 paused, the next run, the adherence, the last submission and the age are read
whole. The independent review of the second phase found the first floor of the age too narrow for the ages of two units,
which the suite had not seen at the age the fixtures had: the words of the age the suite measures are now the longest of
each form the host writes. Two checks of the suite, no words clipped and no words off the line of their row, at each
edge and at 1440 by 900, and a test of the stylesheet, the columns that have a width of their own from 1,000 pixels,
each fail on the stylesheet and the page before the correction. Precisions of the slice, none a change of what a
requirement asks: of REQ-168, the ones that have no next run are last in the first order a click gives and first in the
second, since the host reverses the whole order and no callback knows the direction, and Not known comes before None;
the cells and the items say nothing, and the band says that the backups of the installation are being read, until those
backups were answered once: the state Loading of the design names the schedules, and the views wait for the backups as
well; the details of a schedule of a namespace that is not the one the installation reads compute with nothing read of
its installation, no backup, no offset and no time of its API server, and never read the cluster; the search holds the
word of the state, the text of the next run and the notes, and not the sentence; the grace is one sentence under the
line of the next run, from its constant, said of the states whose run is expected or held. A precision of REQ-170, made
in this pull request, to be confirmed at the review of the fourth milestone: the host draws its details where no view of
the extension is, and the views ask the installation again only while one of them is open, so the details compute with
the last read of the views and, when no view is open or that read of the backups is older than the period of the reads,
say its age in a sentence of the module, as the stale words do, "Computed with the backups of the installation as they
were read 12m ago, when a view of Velero was last open."; beside an instant they give its date as the host writes one,
as the band does.

T3.3, the second of its four pull requests: the adherence in the Overview, on Freelens v2 at the validation target, on
2026-10-25, on the machine of the runs (macOS, Node 24.21.0, pnpm 12.14.0, TypeScript 7.0.2, Vitest 5.0.5, Biome 2.5.15,
Trunk launcher 1.3.4). `pnpm type:check`, exit 0; `pnpm lint:check`, exit 0; `pnpm test:unit`, exit 0, 85 files and
2,654 tests, then the two measures, the one of ADH-16 as before, the thousand signals in 44.3 ms at the 95th percentile
of 250; the same with `VITE_PRESERVE_MODULES=false`, 44.5 ms; `pnpm knip:check`, exit 0; Trunk on the files the pull
request changes, exit 0. The pull request adds 21 tests to the 85 files and 2,633 tests of main, the last after the
independent review, with the zone of the machine fourteen hours east of UTC in the tests of the Overview as in the ones
of the signal, and every word they assert read from the words of the modules: 1 of the signal, the words of the derived
offset as a field of plain data apart from the other notes, of a schedule that is not paused and of a paused one, and
none without a derived offset; 11 of the rules of the Overview, rule A11 with a case that gives an item and one that
gives none for overdue, held within the grace and beyond it, at every look with a last submission and with none, due,
awaited, paused, refused, not read, New, the zone not known, a zone this machine does not know, an expression this
version cannot read, a phase it does not know and no time to count from, the reason, the time and the backup of each
item, a schedule at every look led to its backup in progress and one held by two backups, the words of the derived
offset of the schedule itself and of another, an interval overdue when the backups are denied, said with the hold not
known, an item at a tick of the clock with no read, an item of an earlier read, the count by reason of the schedules
that were read and of no other, the summary, the lines with their signal, nothing without what the views share of the
adherence, and no value of the whole (ADH-12); 9 of the page, the items of A11 in the order of the page beside A5 to A8,
the line of the count before them with its way to the list of the schedules, the summary of a page with nothing to
report and a count, the two cells of each line with their tips, nothing of the adherence until the backups were answered
once, an item at a tick of the clock with no read and no timer left, nothing of the installation selected before, its
offset and its late answer included, the items of an earlier read of the backups and of the schedules, and the backups
denied (ADH-12, and ADH-14 for the Overview). Seven tests of the page are restated with the summary, the cells of the
lines and the line of the count, and the rules A1 to A10 keep their cases. Twenty-three changes were made on purpose to
the code, on a copy of the tree, and each made a test fail: A11 for a paused schedule whose run is due, and for one held
within the grace; a schedule at every look counted among what is not known; the summary silent on what is not known; the
line before the items without the words that this is not that they need nothing; the reasons in the order of their
names; a count, empty, when the schedules were not read; nothing counted of a read of the schedules that is not the last
one; the words of the derived offset, that what holds the submissions is not known, and the backup that holds them, each
left out of an item; the time of a schedule at every look taken from an expected run it has not; an item of A11 not said
of an earlier read of the backups; A11 left out of the rules that put a line first; the lines given no signal, and a
line without its two cells; the line of the count after the items, and given the attribute of what was not looked at;
the adherence said while the backups were never answered, and computed by the time of the read and not by the clock of
the views; the offset of the installation selected before kept for the next one; and the words of the derived offset
given every note of the signal, and left out of a paused schedule. The suites of the Overview and of the first reader
are restated on the fixtures that exist, and run in the packaged application with the second phase of the pull request:
on 2026-10-25, on the nightly of the validation target, the suites of the Overview, 15 cases, of the first reader, 15 in
its two files, and of the schedules, 17, every suite of the views, 174 cases in 12 files, and the pre-review, 33 cases,
green; `views-zoned`, placed that evening, was awaited, so that the case of A11 on the cluster took its branch with no
item. The independent review of the first phase found the adherence past the edge of the band of the lines in the window
of 1440 by 900, which the cells of a table of lines could not show to the checks of the lists of the host: the lead
maintainer decided that the band of the schedules is alone on its row there, with the storage under it, and the suite
measures what each band shows, each 1,053 pixels wide with all the columns of its table, and fails with the two bands on
one row; the suite of the Overview and the pre-review ran green again after the corrections. Decided while implementing,
on 2026-10-25, none a change of what a requirement asks: the Overview says nothing of the adherence while the backups of
the installation were never answered, no item of A11, no count and the two cells of a line empty, as the list says
nothing of it then, and the line of the backups says that the adherence was not checked; the reason of an item says,
when the backups were not read, that whether a backup holds the submissions is not known, from the hold of the signal,
since REQ-165 asks it of a state that keeps its value; an item of A11 is of the read of the backups as well, and says
that it was read before when that read is; a schedule Velero has not read is an item of A6, as SPEC-0008 has it, and its
adherence is counted as not known, which is two facts; the line of the count says how many schedules there are for each
reason, in the order the signal names the reasons, that this is not that they need nothing, and leads to the list of the
schedules, where the tip of each says why. A precision of REQ-171, made in this pull request, to be confirmed at the
review of the fourth milestone: "never an item" is read as never an item of rule A11, so that a schedule Velero has not
read stays an item of A6, as SPEC-0008 has it, while its adherence is counted as not known, since ADH-12 keeps the rules
A1 to A10 as they are and the Failure criteria name an item of rule A11 for a schedule whose adherence is not known.

T3.3, the third of its four pull requests: the fixtures of the adherence, placed by the clock, and a schedule the
controller validates, on 2026-10-26, on the machine of the runs (macOS, Node 24.21.0, pnpm 12.14.0, TypeScript 7.0.2,
Vitest 5.0.5, Biome 2.5.15, Trunk launcher 1.3.4), in its first phase, which writes and proves the environment on the
pretend cluster of its tests and runs nothing on Docker. `pnpm type:check`, exit 0; `pnpm lint:check`, exit 0; `pnpm
test:unit`, exit 0, 85 files and 2,668 tests, then the two measures, the one of ADH-16 as before, the thousand signals
of the same 898 expressions in 49.9 ms at the 95th percentile of 250, with other runs of the tests beside it on the
machine; the same with `VITE_PRESERVE_MODULES=false`, 53.3 ms; `pnpm knip:check`, exit 0; Trunk on the files the pull
request changes, exit 0; each commit type-checks alone. The pull request adds 14 tests to the 85 files and 2,654 tests
of main, all of the environment, whose pretend cluster gives its runtime a clock of this machine and stamps a creation
by it when a test asks: 1 of the two schedules the views gain, which submitted two days before the fixtures were started
and have no backup of their submission, one of five fields whose zone is not known and an interval of six hours overdue
at every age, placed once with the views; 8 of the three installations of the adherence and of their placement: their
names and namespaces, the eight schedules and the two backups of the states, the two offsets, the three hundred
schedules of the budget of the expressions of the measure of the unit run, the order of the two phases, the names taken
from the clock read just before each group of fifty, the last submissions from the creations read back, the offsets the
fixtures give by the rule of REQ-162, a placement again when one is older than twelve hours, placed after now, missing
an object or of another shape, the check of thirty seconds both ways and on a slow group, and nothing placed or removed
outside the installations of the adherence of the run; 5 of the real schedule, its spec, its placement once and its wait
through a pretend controller of the schedules, each refusal with its words, the bound of two minutes by the time that
went by, and its removal by its identity, with the journal. Seven tests are restated: the schedules of the views and
their placement, which places the two new ones once, the namespaces of a run in two tests, the order of a whole
placement with the words of the runner, the words of a placement, and the end check of a cleanup, which names the real
schedule and a backup that carries its label. Forty changes were made on purpose to the scripts of the environment, on a
copy of the tree, and each made a test of the environment fail: every group of backups named by the clock of the
placement and not by the clock read just before it; the last submission written from the clock of the name and not from
the creation read back; no check of the creation against the clock of its name, and the check one way only; one phase,
the backups and the schedules in one list with the clock of the call; the installations of the adherence placed by the
clock of the start of the runner; the three hundred backups of the budget in one group, and every backup created again
with each group; the installation of the budget left out of the namespaces placed by the clock, and every namespace of
the run placed by the clock; objects of another run removed; fixtures older than twelve hours, placed after now, of
another shape or with one missing kept; the backup of the derived schedule named at UTC; the clock of the cluster ahead
by an hour and the older submission of the split fifty seconds before, as the table had them before LM5; the older submission of
the split at the creation of its backup; the backup that holds completed; the real schedule naming `skipImmediately`;
its wait ended on the phase alone; a backup with its label, a last submission and a refusal of it not seen; no bound to
its wait; a real schedule near its run not seen; the real schedule applied again when it is there, applied before the
operations the server refuses, and waited for before the sync; its removal without its identity, not forgotten by the
journal, of another run, of another identity than the journal's, and with no wait until it is gone; the end check
without the real schedule and without the backups it submitted; the words of a placement silent on the installations of
the adherence placed again; the interval of the views of five fields; and the schedule of five fields of the views with
no submission. After an independent review of the first phase, the pull request adds one test of the environment and a
file of two tests of the guard of the suites, 86 files and 2,671 tests in all, and extends eight: the placement stops on
the backup of the older submission of the split created twenty seconds or more after the one of the newer, which would
make it the newest; reads back the phase and the last submission of each schedule it places in two phases, and stops on
a schedule found with no phase; places in two phases the installations of the adherence and no other namespace, each
backup of one schedule; reads the clock that names the first group once a removal of more than thirty seconds ended;
and says the seconds of a creation far from that clock rounded up, a slow cluster named only for a creation after it.
The wait for the real schedule stops on one whose labels change, and on one of the run whose expression, pause or
template are not the ones the scripts make, and counts its next run from its last skip when that is later; the cleanup
says when the schedule is of the run and not in its journal; a suite stops before its first snapshot when the real
schedule submitted since its placement; and the writes a suite counts are proven under both answers of LM1, in a module
of the helpers that reads nothing. Fifteen changes more were made on purpose, and each made one of these tests fail.
Decided while implementing, on 2026-10-26: the table of the fixtures names, beside the schedule not known for want of
an offset, the interval of the views, overdue at every age, which rule A11 and the second reader rest on (L514). The expressions of the measure of the unit run are written once, in a module of the scripts of the
environment that the measure imports, and the measure computes the same signals of the same 898 expressions. The suites
the new objects move are restated, and run on 2026-10-26: the schedules of the views are twelve, the interval overdue and
first in both orders and the schedule of five fields not known; the Overview of the installation of the demo has one
schedule, with its line, awaited, and no item; the Overview of the views counts six schedules not known for want of the
zone, lists the interval under rule A11 at every hour, and gives the schedule that names its zone a line only when a
rule names it; every rule, A11 among them, gives an item on the cluster; the first reader counts eight schedules not
known. Every suite compares the version and the status of the real schedule before and after it, and the writes it
counts leave out the PATCH of a schedule by name only when the measure of LM1 says that the controller sends one at
every look, a constant of the helpers that the measure sets, and then no more of them than the whole minutes between the
two readings of the counters and two: the ones above that bound, and a PATCH of a schedule of another scope, are writes,
and a PATCH within it that changes nothing, or that the server refuses, is not seen. Decided while implementing, on
2026-10-26: that bound, one PATCH a minute as measured and two more, enforced by the guard of the suites, which takes
the length of the window from the moments the two readings were asked, and proven by its test, which four changes made
on purpose to the guard each made fail; the suites ran before it, with every PATCH of a schedule left out. Decided while
implementing, on 2026-10-26, none a change
of what a requirement asks: the two phases are an option of the placement by the clock, with its rules of what is good,
and the clock of this machine a part of the runtime of the fixtures; the backups of the submissions are created fifty at
a time, each group named by the clock read just before it; the backup that holds, which is not a submission, is created
in the first phase with the others, named by the same clock; the schedules of the adherence ask for backups that name no
location, since their installations have none, and a backup of a submission starts at the clock of its name and,
completed, ends a minute after it; the template of the real schedule is the spec of the real backup, and it names no
pause; the wait for the real schedule comes after the wait for the sync, which the controller validates it during; the
placement stops on a real schedule whose next run is less than a day away, counted from its creation or from its last
skip when that is later; the end check of the cleanup names a backup that carries the label of the real schedule, which
nothing removes; the snapshot of the suites holds the version and the status of every schedule of the installation, and
one list of the namespaces of the fixtures serves the snapshot and the one helper that removes. Deviations of the table
of the fixtures, approved by the lead maintainer on 2026-10-16 and recorded under the assumptions: the three hundred
schedules of the budget in a namespace of their own (LM2, L513); the installation of two offsets named by the operator,
as the others (LM3, L511 and L512); the real schedule naming no `skipImmediately` (LM4, L516); the clock of the cluster
ahead by a day and the second submission of the split twenty seconds before the first (LM5, L511 and L512). Decided
while implementing, on 2026-10-26: the installation of the states gains a schedule with a name of 63 characters and an
expression that names its zone, which the pre-review of ADH-15 asks for (L511). The local integration on Docker, on
2026-10-26, at the validation target: the measure of LM1, the controller sends a PATCH of the schedule by name at every
look, once a minute over three minutes, with its version and its status unchanged and no backup created, so the
constant of the helpers says yes; the fixtures placed on the test environment and read back, every backup of a
submission created within a second of the clock its name was read from, less its offset, each last submission its
creation, twenty seconds before it for the older of the split, and the installation of the budget placed again after
one of its schedules was removed; the real schedule validated, `skipImmediately` and the phase written by the server in
the second of its creation, and no submission and no backup of it two hours later; the suites of the schedules, 17
cases, of the Overview, 15, and of the two readers, 8 and 7, then every suite, 174 cases in 12 files, and the
pre-review, 33 cases, all green; the cleanup of the fixtures, which removed the schedule by its identity and the ten
namespaces of the run, and the verification after it. The times of the placements and of the cleanup are in TESTING.

T3.3, the fourth of its four pull requests: the adherence proven on its fixtures in the packaged application, its
measures and the pre-review, on Freelens v2 at the validation target, written on 2026-10-26 on the machine of the runs
(macOS, Node 24.21.0, pnpm 12.14.0, TypeScript 7.0.2, Vitest 5.0.5, Biome 2.5.15, Trunk launcher 1.3.4), in a first
phase that writes the suite and proves its helper by its own cases with no application, and a second that runs it. The
pull request adds no test to the unit run: what the suite of the adherence expects of each fixture is computed by a
helper of the suites, `integration/helpers/velero-adherence.ts`, from the objects as the cluster holds them and from the
clock, by the rules of the controller as REQ-160 to REQ-163 and REQ-167 state them and never with the code of the
extension, for the forms of the expressions of the fixtures alone (an interval of whole hours, a daily expression at the
offset of the server, the 02:30 of Rome, the new year of Buenos Aires and `0 0 30 2 *`), and refusing any other; each
expectation is computed at the clock before a read of the page less twenty seconds and after it plus one, and a state, a
count or a duration is expected among the two; the words are matched in their own forms, with every duration read back
into its span by its two units. The helper is proven by ten cases of its own, first in the suite and starting no
application: the interval and its anchor, the count of twenty-five runs just after the placement and of thirty-seven
twelve hours later, the daily expression at UTC+02:00 on each side of 01:00 UTC, the 02:30 of Rome with both runs of the
hour it repeated on 2026-10-25, the new year of Buenos Aires on each side of it, a read across the edge of the grace,
the hold, the durations, the offset at remainders of fifty, sixty and sixty-one seconds with the newest submission
standing, and the orders. Eighteen changes were made on purpose to the helper, on a copy of the tree, and each made one
of its cases fail: the count off by one; the run of a daily expression computed at UTC; the span without its twenty
seconds; the remainder of the offset allowed to a minute; a duration compared as text; an interval not truncated to the
second; the oldest submission standing; a backup in progress not holding; the last skip never the anchor; the count past
one hundred not said to be more; the order by adherence without the expected run, and the order by the next run with
None before Not known; the new year of Buenos Aires at midnight UTC; late as soon as due; a backup of any distance taken
as the one of a submission; the clock after the read without its second; a daily expression computed without an offset;
and an expression the helper does not know taken as an interval. After the independent review of the first phase, nine
cases more, nineteen in all: the anchor kept when the last skip is earlier and no run counted at the very instant of the
clock; due at the very edge of the grace and overdue at the clock after the read by its second alone; a hold by a backup
with no phase, the newest that holds named and the nearest backup taken as the one of a submission, a dot in the name of
a schedule read as a dot; offsets of a half hour, of three quarters and west of UTC, and a run of the day of the clock
written without its date; the 02:30 of Rome on the day the hour is skipped, at the first instant after the change, which
the helper of the suites of the views did not compute before; a zone the page does not know; the words of the next run
when the run falls between the two clocks, either way, which the suite expected on one side only before; the last
observed run read before its submission, a newer backup that is not a submission and the last submission of a schedule
at every look; and the counters of the API server read by verb, kind and scope, a PATCH and a POST of one object with
the scope `resource`. Each was seen to fail with the change it proves taken back, on a copy of the tree.

The packaged evidence of each check, by the case of `velero-e2e-adherence` that gives it, from two runs of the suite
alone on 2026-10-26, 30 cases of 30 passed in each: the list of the installation of the states, its eight schedules with
the kind of their next run, their state, their mark and their reason and the words of the two cells, a tip on each, and
the note over the list that the clock of the cluster is ahead (ADH-04, ADH-06, ADH-07, ADH-09); the orders by the next
run and by adherence both ways and a search by the word of a state (ADH-09); the band of each schedule line by line,
awaited, overdue with its count and the backup of its submission not among the ones that exist, held beyond the grace by
a backup in progress that is not a submission, at every look, the zone derived of the schedule itself and of another,
the zone the long expression names and the clocks of every band naming the schedule ahead (ADH-03, ADH-04, ADH-07,
ADH-08, ADH-10); the way to the held backup and back, over the list, which is where it was (ADH-10); the installation of
two offsets, the older submission before the newer read with `kubectl` and the words that the offset changed (ADH-03);
the details of the host of a schedule of each of five states, awaited, overdue, held, at every look and derived, and of
the schedule of five fields of the installation of two offsets while another installation is selected, not known for
want of an offset (ADH-11, and the details of another namespace computed with nothing read); the Overview of the
installation of the states, its items of A11 in the order of the page, the one at every look among them, its lines, and
the count by reason in the installation of the views (ADH-12); the real schedule, Enabled with `skipImmediately` written
by the controller, no submission and no backup of it, its next run a year after its creation in its row, its band and
its line of the Overview (ADH-17); nothing written, the guard of LM1 and the evidence of DISC-07 with the Schedules and
the Overview open on the adherence fixtures (ADH-13, ADH-17). The restricted suites: with the reader of three kinds the
interval of the views overdue and the schedule of five fields not known for want of an offset; with the second reader
the interval overdue with the words that whether a backup holds the submissions is not known, in its row and in its
band, and the schedule of five fields not known since the backups are denied, and the count by reason of what is not
known on its Overview (ADH-03, ADH-06, scenario 6). The list of the schedules denied rests on SPEC-0006 and on the
component layer: neither reader is denied the schedules. ADH-05 in the packaged application rests on the suite of the
schedules, with the paused, refused and not read schedules of the installations of the views and of the static fixtures,
and on the count of the two schedules Velero has not read in the Overview of case 7; ADH-14 is of the component layer
alone. The pre-review, ADH-15: four views more, 39 in all, the list of the installation of the states, the band of the
held schedule, the band of the schedule with a name of 63 characters and the Overview of that installation, each in both
themes at 1440 by 900, 900 by 650 and twice the zoom, every mark of the adherence hidden from who does not see it with
its word beside it, every cell of the list and of the lines of the Overview whole, or cut with an ellipsis and a tip, or
wrapped, on the line of its row, and the band read with the keyboard alone, from the list to the schedule, to the backup
that holds it, and back on the way back and on the row, ADHERENCE-PR4-PENDING. The placement the runs read was made at
20:31:02 UTC on 2026-10-26: 01:00 UTC was inside its twelve hours and after the last of the runs, so the four schedules
of five fields at UTC+02:00 were read awaited, their run at 01:00 UTC ahead, and no run saw them turn due and then
overdue; the count of the hourly interval was twenty-five in every run, which all ended before the hour of its
twenty-sixth; the clock ahead was 23h 56m and 23h 52m in the two runs; the next run of the real schedule a year after
its creation, less the age. The `Intl` of the Electron of the nightly knows `America/Argentina/Buenos_Aires`: the
schedule of 63 characters was awaited, its next run at 00:00 of 2027-01-01 in that zone, in its row, its band and its
line, and no schedule of the installation of the states was not known.

ADH-16 in the packaged application, on the installation of the three hundred schedules, in two runs of the suite alone
on 2026-10-26 on the machine of the runs, an Intel Core i7-9750H of twelve threads and 16 GB with macOS and kind in
Docker Desktop, in the nightly v2.0.0-0-nightly-2026-10-25: the list answered in 176 and 156 ms at the 95th percentile,
414 and 393 from the key, each order in 100 to 113 ms, with 27 rows mounted, and the Overview in 33 and 62 ms, each of
250 ms; on the hosted runner, ADHERENCE-PR4-PENDING. Its measures are ten searches and ten orders of the list, each a
column and a direction asked once untimed from the same start to prove that it changes the first forty rows, after three
interactions that warm it, the 95th percentile of what the list takes to answer of 250 ms with the time from the key
beside it and the most rows mounted of 100; and twenty changes of the window of its Overview after three, of 250 ms, as
OVER-12, with the window after each change and the schedules and the backups the page read; each report written before
anything of the measure is asserted, as `adh-16-list-performance` and `adh-16-overview-performance`, with the machine
and the run. The measure of `measure()` gains an order among its interactions, a click on the head of a column, which
ends when the first forty rows change and has no wait of the host. The answer of the header of ADH-07, which the first
pull request found reaching the frame on the machine of the runs and on the hosted runner: it reached it in the runs of
2026-10-26 on the machine of the runs, where the note over the list and the line of the clocks of each band, which the
suite prints as `ADH-07` lines before it asserts them, said: "Times are compared by the clock of the cluster, which the
time its API server writes in its answers gives: it is within a second of the clock of this machine. The schedule
adherence-ahead reports its last submission 23h 56m after the clock of this machine, later than the clock of the API
server: by the clock that wrote it a run may be later still." On the hosted runner, ADHERENCE-PR4-PENDING. The suite
took 137.97 and 132.81 seconds alone on the machine of the runs, 4 minutes 11 seconds and 4 minutes 1 second with the
build, the pack and the start of its runner; the run of the pattern on that machine and the times of the hosted runner,
read before anything else is decided under LM6, ADHERENCE-PR4-PENDING.

Changes made on purpose to what only the packaged application shows, on 2026-10-26, each on a copy of the tree with the
suite of the adherence run once alone from it: the reader leaving out the header Date made case 1 fail on the note over
the list, which then compared the times by the clock of this machine, and case 3 on the line of the clocks; the details
of a schedule of another installation computed with the reads of the installation selected made case 6 fail on the
details of `split-newer`, awaited where not known for want of the offset of its own server is expected; the way of the
band to the held backup leading nowhere made case 4 fail, waiting for the view of that backup; and the order of the
measure ending at the first frame after its click, whether or not the rows changed, made no case fail: the ten orders
were timed as without it, since the host sorts and draws the list inside the click, so what proves that each order
changes the first forty rows is their run untimed before the timed ones, not the measure.

Decided while implementing, on 2026-10-26, none a change of what a requirement asks: the helper of the suites holds the
computation of what each fixture is to show, and the reader of the band, which the first pull request gave the helpers,
is reused; the suite reads the cluster only with `kubectl get` in a namespace and the counters of the API server, never
inside a measure; the Overview case asserts the count by reason of the installation of the views as well, which the
suite of the Overview asserts since the third pull request; the case of the guard counts the writes of the whole suite
and of each window of DISC-07 by the one rule of the guard of the suites, which the third pull request bounded (the
PATCH of a schedule by its name, which the API server counts with the scope of one object, `resource`, left out no more
than the whole minutes between the two readings and two, and one of any other scope a write), and asserts by name that
no POST of a backup was counted, of any scope; the suite expects the clock of the cluster within a second of the one of
this machine, as the time of its API server gives it on kind, and fails on the note over the list when it is further
off; the expectations take whether the application knows the zone of the long name as one constant of the suite, which
the packaged runs of 2026-10-26 settled: the nightly knows it; and the 02:30 of Rome on the day the hour is skipped is
computed at the first instant after the change, as REQ-160 states, by the helper the suites of the views share. The
three items that wait for the confirmation of the lead maintainer at the review of the fourth milestone are recorded
above and hold as they are: the amendment of REQ-166 (L776-L780), and the precisions of REQ-170 (L883-L889) and of
REQ-171 (L943-L946). The manual review of the Success Criteria (L567-L575) waits for the lead maintainer, with its steps
in [TRY-IT.md](../development/TRY-IT.md); Verified waits for it and for those three items.