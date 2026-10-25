# SPEC-0016: Create A Schedule

- **Status:** Approved
- **Date:** 2026-10-23
- **Milestone / tasks:** M5 / T4.7
- **Reviewed Velero:** v1.18.4, `4ee1e79a7aed367fd9b767b8219ec65bd0c96892`
- **Reviewed main:** not relevant: the creation rests on the reviewed release alone, and behavior present only on the main branch of Velero is design guidance, never a baseline capability ([upstream drift watch](../development/PROCESS.md#upstream-drift-watch))
- **Freelens validation target:** Freelens v2, the validation target of [SPEC-0015](SPEC-0015-freelens-v2-host.md), freelensapp/freelens `7801fb10a5f20af308093b39e5f79cd6e8c3461d`, the base of the nightly v2.0.0-0-nightly-2026-10-25, which moves with the host drift watch until Freelens 2.0.0 is released
- **Dependencies:** [the write gate](SPEC-0009-write-gate.md), [the diagnostic request](SPEC-0010-diagnostic-request-and-transport.md), whose creation through the adapter is the pattern of this one, [Schedules](SPEC-0006-schedule-read-only.md), [locations](SPEC-0007-locations-read-only.md), [the adherence of a schedule](SPEC-0013-schedule-adherence.md), [the Freelens v2 host](SPEC-0015-freelens-v2-host.md); the spec of T4.3, not drafted yet, which owns the form of the template of a backup
- **Approval:** Approved by the lead maintainer on 2026-10-25, as drafted, with D11 decided as the draft proposed: the form refuses an expression the parser refuses; D3 to D8 confirmed, and the amendments of D12 approved with this spec

Governed by [AGENTS.md](../../AGENTS.md). A completed draft is not approval to
implement.

## Goal

Let the operator create a Schedule in the selected installation, after a review of
the exact object the extension will create and of what it means: that no backup is
made at the creation, when the next runs are in the zone of the expression, and
what each choice does; then show what Velero made of it, never a success read from
the answer of the creation alone.

## Scope Baseline

The roadmap plans in M5 backup now from a schedule (T4.2), the creation of a backup
(T4.3), restore (T4.4), pause and resume (T4.5) and the deletion of one backup
(T4.6): nothing of v1.0.0 created a Schedule. The lead maintainer decided on
2026-10-23 that creating a Schedule is in v1.0.0, as T4.7, the slice right after
T4.3, and that editing a Schedule is not
([roadmap](../development/ROADMAP.md#m5---actions)). This spec is T4.7 alone.

The schedule controller of the reviewed release was read for this draft, with the
builder of the backup it creates, the backup controller that validates that backup,
and the controllers that act when a backup is deleted. The facts are in the
[design](#what-velero-does-with-a-new-schedule), each with its lines. Nothing was
run, and no cluster was contacted.

The form of the template is the form of T4.3, shared, with two wrappers: one makes
a Backup, the other a Schedule. T4.7 starts once T4.3 is on main. The template
fields T4.7 needs are the ones of [the form](#the-form), so that the spec of T4.3
is drafted against the same list.

Included: the command and the workspace of the creation; the wrapper of a Schedule,
its name, its expression, `paused`, `skipImmediately` and
`useOwnerReferencesInBackup`; the template fields of v1.0.0; the review of the exact
object and of its meaning; the gate, the builder in the main process, the
namespaced POST, the name, the collision and the submission whose answer is not
known; the read of the created Schedule and of its phase; the tests.

Excluded, with their owners:

- Editing a Schedule: after v1.0.0, to the next minor
  ([roadmap](../development/ROADMAP.md#deferred-after-v100)). Pause and resume are
  T4.5, the only patches of v1.0.0; backup now is T4.2. Deleting a Schedule is not
  offered in v1.0.0: [REQ-074](SPEC-0006-schedule-read-only.md#requirements) keeps
  every surface free of it.
- The fields of the template the form does not write in v1.0.0, each said in the
  form: `hooks`, `orderedResources`, `resourcePolicy` and `uploaderConfig`, which
  the decision names; and `metadata` (the labels of the backups),
  `includedClusterScopedResources`, `excludedClusterScopedResources`,
  `includedNamespaceScopedResources`, `excludedNamespaceScopedResources`,
  `volumeGroupSnapshotLabelKey`, `datamover` and `defaultVolumesToRestic`, which it
  does not list. No task owns them in v1.0.0.
- Labels and annotations of the Schedule: none is written (D5).
- The backup coverage panels: after v1.0.0, by the same decision.

## User Scenarios

1. **P1, a daily schedule with its zone:** Given writes on for the namespace
   `velero` of the cluster, when the operator names a schedule `nightly-shop`, types
   `CRON_TZ=Europe/Rome 0 3 * * *`, includes the namespace `shop`, keeps the storage
   location `default`, marked as the default, and asks for the review, then the
   review names the context and the namespace, says that Velero makes no backup at
   the creation and that the first one is at the first 03:00 in Rome after it,
   lists the next five runs with their dates, says what `paused`, `skipImmediately` and
   `useOwnerReferencesInBackup` written false mean, and shows the object as the main
   process will send it. When the operator creates it, then one Schedule is in the
   cluster, equal to that object, and the workspace says Enabled once Velero wrote
   it, with the way to the view of the schedule.
2. **P1, writes off:** Given writes off, then the form can be filled, the review
   does not open, and the words say that writes are off for this cluster and lead to
   the target bar; nothing is created, which the API server counts.
3. **P1, the zone is not known:** Given `0 3 * * *` in an installation where no
   schedule has a submission whose backup exists, then the review says that the
   next runs are not known, since the expression names no zone and the zone of the
   server is not known, and that naming the zone in the expression, as
   `CRON_TZ=<zone> 0 3 * * *`, gives them; no time of this machine stands in.
4. **P1, the name is taken:** Given a schedule `nightly-shop` that exists, when the
   operator creates another of that name, then the creation ends as a conflict, the
   existing schedule is unchanged, and the words lead to it.
5. **P1, Velero refuses it:** Given an expression Velero refuses, then the workspace
   shows the phase FailedValidation and each error as Velero wrote it, and never
   the words of a schedule that runs. Given an expression the parser of SPEC-0013
   refuses, the form says why in the words of the controller before any review.
6. **P2, paused, with the run skipped:** Given `paused` and `skipImmediately`
   chosen, then the review says that Velero does not read a paused schedule, so it
   gets no phase and no validation until it is resumed; after the creation the
   workspace says that Velero has not read it and will not until then.
7. **P2, the answer is lost:** Given a creation whose answer does not come, then the
   workspace says that it is not known whether the schedule was created, reads it
   by its name, and says what it found; nothing is sent again by itself.
8. **P2, a restricted identity:** Given an identity that reads the schedules and may
   not create one, then the creation is refused as forbidden, with the words that
   the identity may not create schedules in that namespace; given one that may not
   read the storage locations, then no location can be chosen, with why, and the
   review does not open.
9. **P2, the target changes:** Given a review on screen, when the operator selects
   another installation or turns writes off, then the review is dropped with its
   confirmation, and nothing is created.

## Requirements

| ID | Contract | Acceptance check |
| --- | --- | --- |
| REQ-221 | The page of the Schedules has the command Create schedule in the header of its list. It opens the workspace of the creation over the list, named in the address as a view, and the list is as it was when the workspace closes. The workspace is the form, the review and the result, one after the other in the same place, for the installation it was opened for. The command is there with writes on or off: the form can be filled with writes off, and the review asks for writes on for the cluster and the namespace of the installation, with words that say so and lead to the target bar. The command is the only control of the page that writes: SCHED-11 of SPEC-0006 is restated as [the amendment](#the-amendment-of-spec-0006) says | CRSCH-01 |
| REQ-222 | The creation is a write of the gate of SPEC-0009: the main process refuses it unless writes are on for the cluster and the namespace of the installation, and runs it only with a token bound to the frame that asked, good for thirty seconds and for one use, for one exact object; the review is the confirmation, and it names the context of the entry of the catalog and the namespace. The words of the gate that list what the extension creates name the Schedule, as REQ-109 asks | CRSCH-02 |
| REQ-223 | The Schedule is built in the main process from a discriminated request of the contract that carries the parameters of the form and nothing else, validated at run time as REQ-112 says: a field the contract does not know refuses the request. The object is a `velero.io/v1` `Schedule` with `metadata.name` and `metadata.namespace` and no other metadata, no label and no annotation; its `spec` has `schedule`, `template`, `paused`, `skipImmediately` and `useOwnerReferencesInBackup`, always written; its template has only the fields the operator set, and a field that is not set is left out, never written empty. No status. The Schedule joins the kinds the adapter allowlists; the contract gains no generic creation | CRSCH-03 |
| REQ-224 | The creation is one namespaced POST to `/apis/velero.io/v1/namespaces/<namespace>/schedules`, the namespace of the installation the gate is on for, through the client of the host for the cluster of the request; never an apply, a PUT or a PATCH. Its body is the text the review showed, byte for byte. Before it the main process reads, in that namespace, the storage location and each snapshot location the template names, and ends as not-found, naming which, before anything is created, when one is not there | CRSCH-04 |
| REQ-225 | The name is the operator's, never generated: a DNS-1123 subdomain of 63 characters at most, checked as it is typed and again in the main process, with the rule in words. The form says when a schedule of that name is among the ones the installation read; the creation decides (REQ-227) | CRSCH-05 |
| REQ-226 | The expression is checked as it is typed with the grammar and the parser of SPEC-0013 (REQ-160). One the parser refuses is shown refused, with the words the controller writes for it, and the review does not open. One with no instant, the descriptors `@triggered`, `@manual` and `@none` and an expression with no instant within five years, is refused with the words that Velero would submit a backup at every look, once a minute, whenever none of its backups is in progress (REQ-161). The main process refuses an empty expression, one of more than 1,024 characters, one with a character that is not printable, and one with no instant, by the same parser | CRSCH-06 |
| REQ-227 | A creation the API server answers with 409 is a conflict: the existing Schedule is left as it is, with no update and no second request; the words say that a schedule of that name exists in that namespace and was not changed, and lead to it; the form keeps what was typed | CRSCH-07 |
| REQ-228 | A creation that got no answer, from a fetch that failed, the deadline, an answer that cannot be read or is too large, or a 5xx, is a submission that is not known and is never sent again by itself. The main process reads the named Schedule: when it is not there, the words say that it was not created as far as the read shows, and a new attempt is a new confirmation; when it is there with the spec that was sent, `skipImmediately` aside, which the controller sets to false at its first reading, and a creation time not earlier than one minute before the confirmation, the margin for the clocks of this machine and of the cluster, it is the one created or one equal to it, taken by its UID, and REQ-238 follows; when it is there with another spec or an earlier creation time, it is a conflict as REQ-227 says; when the read fails, it ends as submission-unknown with the name to look for | CRSCH-08 |
| REQ-229 | The review shows the exact object the main process sends, as the text it sends, verbatim: the text is the answer of the main process to the confirmation, built from the parameters, and the renderer shows it as it came. Beside it are the context, the namespace and the command Create schedule, which says that it creates a Schedule (REQ-117). A change of a field, of the installation, of the cluster or of its entry, and writes turned off, drop the review and its token. A token that expired while the review was read is asked again by the same command, and the main process gives it only for a text byte for byte the one shown; otherwise the new review replaces the one shown and nothing is created | CRSCH-09 |
| REQ-230 | The review says that Velero submits no backup when the schedule is created, and that the first one is at the first instant of the expression after the creation, within the minute after it, since the controller looks once a minute. It lists the next five runs, computed from the time of the review with the grammar and the parser of SPEC-0013, in the zone of REQ-231, each with its date, its time and the zone, with the words that they are counted from now and that the creation is a moment later. An `@every` expression is said as its first run at its interval after the creation, then each at its interval after the previous submission, which comes up to a minute after its instant. With `paused` true no run is listed as upcoming: the review says that there is none while the schedule is paused, and that once it is resumed a run is due at once when an instant has passed since the creation, unless `skipImmediately` is true then (REQ-232) | CRSCH-10 |
| REQ-231 | The zone of the runs is established by REQ-162 of SPEC-0013 and no other rule: the zone the expression names, with the words that the server must know it, which the extension does not read; for an expression without a zone, the offset derived in the installation, with the schedule it came from and the words of a derived offset; otherwise the review says that the next runs are not known, since the expression names no zone and the zone of the server is not known, and gives the way out, the zone named in the expression with `CRON_TZ=`, shown on the expression typed with a placeholder for the zone. The zone of the desktop and the time zone preference of the host are never used. An `@every` expression needs no zone | CRSCH-11 |
| REQ-232 | `paused` is a field of the form, false unless chosen, always written. With true, the review says that Velero does not read a paused schedule: it gets no phase and no validation of its expression, and no backup is submitted, until it is resumed; that the run then counts from the creation, so that a schedule resumed after an instant of its expression submits a backup at once, unless `skipImmediately` is true at that moment; and that pause and resume are T4.5 | CRSCH-12 |
| REQ-233 | `skipImmediately` is a field of the form, false unless chosen, always written, so that the setting of the server, which the extension does not read, never decides it. With true, the review says that at its first reading Velero sets it back to false and writes the time of that reading as the last skipped, from which the next run is counted: on a new schedule this moves the count from the creation to that reading, and skips an instant of the expression that falls between the two; on a paused schedule nothing happens until it is resumed, and the run that is due then is skipped. It acts once | CRSCH-13 |
| REQ-234 | `useOwnerReferencesInBackup` is a field of the form, false unless chosen, always written. With true, the review says that every backup the schedule creates names the schedule as its controlling owner, so that deleting the Schedule makes Kubernetes delete those Backup objects, unless it is deleted with the orphan propagation of Kubernetes; that this deletes no data a finished backup holds in the storage, since Velero deletes the data of a backup only through a DeleteBackupRequest; that the sync of the storage location brings the finished backups back into the cluster at its next pass while the location is Available, without the reference to the schedule, where they expire by their time to live, and the ones that waited for plugins or were finalizing only once they expired, as PartiallyFailed; that a location whose sync period is zero does not bring them back, and their data stays in the storage with no Backup object, which no expiration removes; and that a backup in progress loses its object, and its pod volume backups and data uploads, which it owns, are deleted with it and cancelled. What becomes of what a backup in progress had written is not established, as the [open questions](#open-questions) say | CRSCH-14 |
| REQ-235 | The template has the fields of [the form](#the-form), from the form of T4.3: the included and excluded namespaces, offered from the namespaces the host lists for the cluster, with free text for the patterns Velero matches; the included and excluded resources, as free text; `includeClusterResources`, not set, true or false; `labelSelector` or `orLabelSelectors`, one of the two; the storage and the snapshot locations of REQ-236; `snapshotVolumes`, `defaultVolumesToFsBackup` and `snapshotMoveData`, each not set, true or false; `ttl`, `csiSnapshotTimeout` and `itemOperationTimeout`, each a duration above zero or not set. For each field that is not set the review says what the release does, in the words of the table of [the template](#what-velero-does-with-the-template). The form refuses what that table says the release refuses of the lists and of the patterns, with its words, and an included namespace the host lists with the label `velero.io/exclude-from-backup=true`; the review warns of the two refusals the extension cannot see: a namespace labelled so after the review, and a global volume policy of the server beside the resource filters or `includeClusterResources`. The reader of the extension asks no path that is not of the kinds of Velero: the namespaces are the ones the host lists | CRSCH-15 |
| REQ-236 | The storage location is chosen among the BackupStorageLocations the installation read, as SPEC-0007 reads them, by name, and is always written. The default is marked, and chosen first when it can be chosen. A location that is not reported Available, or whose access mode is ReadOnly, is shown and cannot be chosen, with the reason: the release refuses every backup sent to it. When none can be chosen, or the locations are denied, not served or not read, the review does not open, with why. The snapshot locations are chosen among the VolumeSnapshotLocations read, at most one for each provider; when a provider has more than one and none is chosen, the review says that Velero then needs a default of the server for that provider, which the extension does not read, and refuses each backup without one | CRSCH-16 |
| REQ-237 | `hooks`, `orderedResources`, `resourcePolicy`, `uploaderConfig`, `metadata`, the four scoped resource filters, `volumeGroupSnapshotLabelKey`, `datamover` and `defaultVolumesToRestic` are never written: the contract has no field for them, and the form says, under the template, that this version does not offer them | CRSCH-17 |
| REQ-238 | The answer of the creation is not the success of the schedule. The main process reads the created Schedule by its namespace and name, checks the UID the creation answered, and reads it every second, for thirty seconds at most, until it reports a phase; a paused one is read once. The workspace shows what Velero wrote: Enabled; FailedValidation with each error as written; no phase yet, with the words that Velero has not read it; and, for a paused schedule, that Velero does not read it until it is resumed. It says that Velero checks the template only on each backup the schedule creates, which fails its validation when the template is refused, and leads to the view of the schedule of SPEC-0006, where SPEC-0013 counts it as a new schedule; the list shows it at its next read, within the fifteen seconds of the reads of the views | CRSCH-18 |
| REQ-239 | Every end of a creation is a code with a stage, whether it is safe to try again, and words, among the codes of the contract: validation, forbidden, with the words that the identity may not create schedules in that namespace, not-found, conflict, target-changed, cancelled, deadline, submission-unknown, and request-failed for any other answer; never the body of an answer. A change of the installation, of the cluster or of its entry, writes turned off and a frame that goes drop the review and abort a creation in flight on this side: one whose POST was not sent creates nothing, and one whose POST was sent ends as REQ-243 says; late answers are not shown. One creation runs at a time from a workspace: the command is disabled while it runs, and the identifier of the request rejoins it. A cancel before the confirmation creates nothing | CRSCH-19 |
| REQ-240 | Both themes, the keyboard alone, every field labelled with its error tied to it, Escape as [DESIGN.md](../development/DESIGN.md#visual-and-interaction-rules) says for a field and for a confirmation, the focus moved to what follows each step, long names and long expressions, a window of 900 by 650 and twice the zoom | CRSCH-20 |
| REQ-241 | The packaged application proves the creation in Freelens at the validation target, in the installation of the test environment, by what the API server counts: with writes off the command creates nothing; with writes on and a review that is not confirmed, nothing; with both, one POST of a Schedule and no PUT or PATCH of one, and every field of the text the review showed with the same value in the object read in the cluster, `skipImmediately` aside once the controller has read it; a name that exists ends as a conflict with the `resourceVersion` of the existing schedule unchanged; the restricted identity is refused, and nothing is in the cluster. The suite removes every schedule it created | CRSCH-21 |
| REQ-242 | On the disposable kind cluster, with the real controller of the reviewed release, the compiled main process creates through its procedures, as a frame does, one valid schedule whose first instant falls inside the run, `*/2 * * * *`, read Enabled with no backup at its first reading and exactly one backup after its first instant; one the controller refuses, read FailedValidation with the error the controller writes; and one paused with `skipImmediately` true, read with no phase, `skipImmediately` still true and no last skipped. The suite removes each of them, and the backup of the valid one through a DeleteBackupRequest once it ended, and checks that no backup of them is left. No write on a real cluster | CRSCH-22 |
| REQ-243 | A creation aborted on this side after its POST was sent, by a change of the installation, of the cluster or of its entry, writes turned off, a frame that goes or the deactivation of the extension, ends as submission-unknown, never as cancelled, and is never sent again. The main process keeps that end for the cluster, with the context, the namespace and the name, until a frame of that cluster has shown it or the extension is deactivated; the target bar of the cluster says it wherever the operator is in that cluster, with the name to look for, until the operator dismisses it. The views reconcile it by reading the named Schedule in that namespace, a read of a kind of Velero that needs no gate: found with the spec that was sent and a creation time as REQ-228 says, the words say that it was created, with the way to it; not found, that it was not created as far as the read shows; found otherwise, that a schedule of that name exists and is not known to be this one; a read that fails keeps it not known | CRSCH-23 |

## Design

- **Standard or ad hoc view, and why.** Ad hoc: a guided flow in a workspace over
  the native list of the Schedules, opened by a command of the list and named in
  the address as the views of one object are. Creating a schedule is a task of
  several decisions whose consequences are not visible in the fields: when the
  first backup comes, in which zone, what a flag does at the first reading of the
  controller, where every backup goes. The operator needs the form, then the exact
  object beside what it means, then what Velero made of it, in one place that stays
  while they read. The drawer of the host closes at a click outside it (AGENTS.md,
  the facts of the host), and a dialog has no room for the object and its meaning
  side by side; the workspace has the target bar with the state of the gate above
  it, the way back to the list, and the keyboard rules of the other views.
- **Safety.** The slice writes one kind of object, a Schedule, into the namespace
  of the selected installation, through the gate and the confirmation of the
  review, and nothing else: no Backup, no request, no patch. It reads the created
  Schedule, the storage and snapshot locations it names, and nothing that is not of
  the kinds of Velero; the namespaces come from the host. The packaged suite counts
  the creations on the API server (REQ-241), and the Kubernetes integration runs
  only on the disposable kind cluster (REQ-242).

### What Velero Does With A New Schedule

The [schedule controller](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/controller/schedule_controller.go)
of the reviewed release, with the builder of the backup it creates. SPEC-0013 has
the rest of the controller and the parser, in
[What The Controller Does](SPEC-0013-schedule-adherence.md#what-the-controller-does).
Nothing was run.

| Fact | Source |
| --- | --- |
| A new Schedule is read when it is created, since the event of a creation passes the predicates of the controller, and then once a minute. A paused one is left out of every event, the periodic one included, and the reading of a schedule never looks at `paused`: a schedule created paused gets no phase, no validation and no write of `skipImmediately` until it is resumed, which is a change of its spec | [The predicates](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/controller/schedule_controller.go#L73-L90), [every event](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/util/kube/predicate.go#L51-L66), [a change of the spec](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/util/kube/predicate.go#L34-L48), [the periodic source](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/util/kube/periodical_enqueue_source.go#L95-L101), [the period](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/controller/schedule_controller.go#L44) |
| At its first reading the controller writes the setting of the server, `--schedule-skip-immediately`, false unless the server is started with it, into an empty `spec.skipImmediately`; when the field is true it sets it back to false and writes the time of that reading into `status.lastSkipped`. One merge patch writes both: the kind has no status subresource | [The default](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/controller/schedule_controller.go#L113-L115), [the skip](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/controller/schedule_controller.go#L116-L119), [the patch](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/controller/schedule_controller.go#L134-L154), [the flag](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/cmd/server/config/config.go#L257), [its default](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/cmd/server/config/config.go#L219), [given to the controller](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/cmd/server/server.go#L891-L892), [no subresource](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/config/crd/v1/bases/velero.io_schedules.yaml#L606) |
| Read from the lines, and covered by no test of the release, which makes a controller for each case: an empty field is pointed at the setting the controller holds, and the skip writes false through that pointer, so a server started with the setting true skips for the first schedule it reads with the field empty, and holds false for every later one until the server restarts, since one controller is made for each process | [The setting held](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/controller/schedule_controller.go#L53), [kept](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/controller/schedule_controller.go#L69), [the receiver](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/controller/schedule_controller.go#L96), [the pointer](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/controller/schedule_controller.go#L114), [the write](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/controller/schedule_controller.go#L117), [a controller for each case](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/controller/schedule_controller_test.go#L170), [one for each process](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/cmd/server/server.go#L891-L892) |
| The expression is all the controller validates: an empty one, and one the parser refuses, make the phase FailedValidation with the errors, and otherwise the phase is Enabled. The template is not looked at | [The phase](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/controller/schedule_controller.go#L121-L132), [the errors](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/controller/schedule_controller.go#L174-L212) |
| A schedule with no submission counts its next run from its creation, or from `status.lastSkipped` when that is later, and is due when the clock of the controller is after the next instant of the expression, strictly: no backup is submitted when a schedule is created, and the first is at the first instant after the creation, at the first look after it. The test of the release names the case: the first run of an `@every 5m` schedule is not due, and its next run is five minutes after the creation. The help of the setting of the server says "Skip the first scheduled backup immediately after creating a schedule": the code has no such backup, and this spec follows the code | [The anchor](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/controller/schedule_controller.go#L275-L289), [due](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/controller/schedule_controller.go#L240-L251), [the case](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/controller/schedule_controller_test.go#L249-L266), [its creation](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/controller/schedule_controller_test.go#L311), [its check](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/controller/schedule_controller_test.go#L319-L331), [the help](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/cmd/server/config/config.go#L257) |
| A due schedule submits nothing while a backup in its namespace that carries its name in the label `velero.io/schedule-name` reports no phase, New or InProgress, whoever created that backup | [The check](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/controller/schedule_controller.go#L165-L169), [the backups](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/controller/schedule_controller.go#L214-L238), [the label](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/apis/velero/v1/labels_annotations.go#L30) |
| A submission creates a backup named `<schedule>-<yyyymmddhhmmss>` by the clock of the server, whose spec is the template as written; its labels are the ones of the template when it has some, else the ones of the Schedule, with `velero.io/schedule-name` set to the name of the schedule, not cut; its annotations are the ones of the Schedule; with `useOwnerReferencesInBackup` true it names the Schedule as its owner, with `controller: true` | [The name](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/apis/velero/v1/schedule_types.go#L137-L140), [the backup](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/controller/schedule_controller.go#L291-L297), [the labels](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/builder/backup_builder.go#L86-L107), [the spec](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/builder/backup_builder.go#L109), [the annotations](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/builder/backup_builder.go#L112-L114), [the owner](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/builder/backup_builder.go#L116-L126) |
| The name of the schedule is the value of a label of every backup, uncut, and the API server takes no label value of more than 63 characters: with a longer name every submission fails, with the error of the creation, and the phase stays Enabled. The release cuts the name of a storage location for its label, and not this one | [The label](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/builder/backup_builder.go#L107), [the failed submission](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/controller/schedule_controller.go#L165-L169), [the label of a location, cut](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/controller/backup_controller.go#L486) |
| The kind requires `spec.schedule` and `spec.template`; `paused` and `skipImmediately` are booleans and `useOwnerReferencesInBackup` a nullable boolean, all optional; the expression is a string with no pattern; `status.phase` is New, Enabled or FailedValidation | [The spec](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/config/crd/v1/bases/velero.io_schedules.yaml#L60-L77), [the owner field](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/config/crd/v1/bases/velero.io_schedules.yaml#L563-L568), [required](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/config/crd/v1/bases/velero.io_schedules.yaml#L569-L571), [the status](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/config/crd/v1/bases/velero.io_schedules.yaml#L573-L602), [the type](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/apis/velero/v1/schedule_types.go#L27-L94) |
| Velero puts no finalizer on a Backup, and no controller acts on the deletion of one: the backup controller, its queue and the collector of expired backups pass over that event, the controller of the operations of plugins takes no event of a Backup, and the one that finalizes a backup finds none and returns. The data of a backup is deleted only by the controller of a DeleteBackupRequest, which needs the Backup object to be there. The schedule controller has no finalizer either: a Schedule that is gone only drops its metrics | [The backup controller](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/controller/backup_controller.go#L187-L189), [the queue](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/controller/backup_queue_controller.go#L113-L115), [the collector](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/controller/gc_controller.go#L88-L90), [the operations](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/controller/backup_operations_controller.go#L99), [the finalizer](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/controller/backup_finalizer_controller.go#L98-L102), [the deletion](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/controller/backup_deletion_controller.go#L109-L116), [the backup it needs](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/controller/backup_deletion_controller.go#L174-L182), [the data](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/controller/backup_deletion_controller.go#L368-L371), [a schedule that is gone](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/controller/schedule_controller.go#L101-L106) |
| The object of a backup is kept in the store with its owner references. The sync of a storage location that is Available creates in the cluster, at each pass, a minute apart by default, the backups of the store that the cluster does not have, when they are Completed, PartiallyFailed or Failed, and the ones that wait for plugins or finalize once they expired; it takes off an owner reference to a schedule that is not there or has another UID. A location whose sync period is zero is not synced | [The object kept](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/controller/backup_controller.go#L933-L936), [Available](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/controller/backup_sync_controller.go#L94-L97), [the difference](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/controller/backup_sync_controller.go#L133-L138), [the phases](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/controller/backup_sync_controller.go#L172-L190), [the owner](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/controller/backup_sync_controller.go#L211), [the filter](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/controller/backup_sync_controller.go#L279-L299), [a period of zero](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/controller/backup_sync_controller.go#L405-L412) |
| The pod volume backups and the data uploads of a backup name the backup as their controlling owner, so the garbage collector of Kubernetes deletes them with it, and their controllers cancel the ones that are being deleted | [The pod volume backup](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/podvolume/backupper.go#L550-L556), [the data upload](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/backup/actions/csi/pvc_action.go#L555-L561), [its cancel](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/controller/data_upload_controller.go#L184-L200), [the cancel of the other](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/controller/pod_volume_backup_controller.go#L164-L176) |
| An expired backup is deleted through a DeleteBackupRequest the collector creates, when its storage location is Available and not ReadOnly | [Expired](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/controller/gc_controller.go#L127-L130), [Available](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/controller/gc_controller.go#L157-L160), [ReadOnly](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/controller/gc_controller.go#L162-L169), [the request](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/controller/gc_controller.go#L199-L205) |

Read together, the last four rows are what REQ-234 says: with
`useOwnerReferencesInBackup` true, deleting the Schedule deletes the Backup objects
it created, unless the deletion orphans them, a rule of Kubernetes and not of the
tree; it deletes no data a finished backup holds in the store; the finished backups
come back at the next sync while the location is Available, without the reference,
and expire by their time to live; the ones that waited for plugins or were
finalizing come back only once expired; with a sync period of zero none comes back,
and their data stays in the store with no object that expires; a backup in progress
loses its object, and its pod volume backups and data uploads are deleted and
cancelled. What the source does not show is what becomes of what such a backup had
already written: the second open question.

### What Velero Does With The Template

The schedule controller copies the template into each backup it creates, and the
backup controller validates that backup when it starts it: any error makes the
backup FailedValidation
([the phase](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/controller/backup_controller.go#L296-L297)),
while the schedule stays Enabled. The namespaces and the resources are matched as
glob patterns
([the match](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/util/collections/includes_excludes.go#L47-L58),
[the expansion of the namespaces](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/util/wildcard/expand.go#L11-L34)).
What the release does with each field of the form:

| Field | When it is not set | What makes each backup FailedValidation | Source |
| --- | --- | --- | --- |
| `includedNamespaces` | Every namespace, `*` | `*` beside another item; an excluded namespace among the included ones; a pattern with `**`, with one of `\|()!{},`, with an empty `[]`, an unclosed `[` or an unmatched `]`; a pattern that is not a valid name of a namespace once its wildcards are replaced, as one with a capital letter or `_`; a namespace labelled `velero.io/exclude-from-backup=true`, which the controller adds to the excluded ones before it validates | [Every namespace](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/controller/backup_controller.go#L579-L586), [the lists](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/util/collections/includes_excludes.go#L594-L607), [the namespaces](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/util/collections/includes_excludes.go#L615-L633), [the name](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/util/collections/includes_excludes.go#L664-L697), [the patterns](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/util/wildcard/expand.go#L67-L126), [the label](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/controller/backup_controller.go#L509-L518) |
| `excludedNamespaces` | None, beside the namespaces labelled `velero.io/exclude-from-backup=true`, which the controller adds | `*`; the rules of the patterns and of the names of the row above | [The label](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/controller/backup_controller.go#L509-L518), [the lists](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/util/collections/includes_excludes.go#L600-L602), [the patterns and the names](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/util/collections/includes_excludes.go#L626-L630) |
| `includedResources`, `excludedResources` | Every resource | `*` beside another item; `*` among the excluded; an item in both lists; these beside the scoped resource filters, which the form never writes; these, or `includeClusterResources` set, when the server names a global volume policy that has an include and exclude policy or filter policies, a setting the extension does not read | [Every resource](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/util/collections/includes_excludes.go#L243-L250), [the lists](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/controller/backup_controller.go#L529-L535), [their rules](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/util/collections/includes_excludes.go#L594-L607), [the mix](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/controller/backup_controller.go#L520-L527), [the global policy](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/controller/backup_controller.go#L601-L617), [the filters it refuses](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/util/collections/includes_excludes.go#L769-L776), [the setting](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/cmd/server/config/config.go#L286) |
| `includeClusterResources` | The cluster-scoped resources are taken when every namespace is; with some namespaces, only the ones an action adds, as the volume of a claim. False leaves them all out, those an action adds included | Set, with the global volume policy of the row above | [The rule](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/util/collections/includes_excludes.go#L334-L350), [what an action adds](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/backup/item_backupper.go#L129-L137), [excluded](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/util/collections/includes_excludes.go#L356-L381) |
| `labelSelector`, `orLabelSelectors` | No filter | Both present: the check is on presence; for a backup of a schedule an empty list of the second does not reach it, since the controller creates the backup from the types of Go, which leave an empty list out, and the form never writes one | [Both](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/controller/backup_controller.go#L596-L599), [left out](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/apis/velero/v1/backup_types.go#L102), [created](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/controller/schedule_controller.go#L260-L261) |
| `storageLocation` | The location marked default, else the one the server names | A location that is not there, one whose access mode is ReadOnly, one that is not reported Available | [The default](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/controller/backup_controller.go#L431-L448), [not there](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/controller/backup_controller.go#L455-L465), [ReadOnly and Available](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/controller/backup_controller.go#L469-L479), [Available](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/util/velero/velero.go#L130-L132) |
| `volumeSnapshotLocations` | For each provider, its only location, or the default the server names for it | A name that is not there; two for one provider; a provider with more than one and no default of the server | [Named](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/controller/backup_controller.go#L640-L656), [the defaults](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/controller/backup_controller.go#L688-L706), [the setting](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/cmd/server/config/config.go#L258) |
| `snapshotVolumes` | True | Nothing | [The rule](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/internal/volumehelper/volume_policy_helper.go#L211-L215) |
| `defaultVolumesToFsBackup` | The setting of the server, false unless it is started with it | Nothing | [The default](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/controller/backup_controller.go#L423-L425), [the setting](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/cmd/server/config/config.go#L250), [its value](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/podvolume/configs/configs.go#L10) |
| `snapshotMoveData` | The setting of the server, false unless it is started with it | Nothing | [The default](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/controller/backup_controller.go#L427-L429), [the setting](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/cmd/server/config/config.go#L255), [its value](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/cmd/server/config/config.go#L217) |
| `ttl` | The setting of the server, 720 hours unless it is started with another; zero is the same as not set | Nothing | [The default](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/controller/backup_controller.go#L394-L397), [its value](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/cmd/server/config/config.go#L44), [the setting](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/cmd/server/config/config.go#L245) |
| `csiSnapshotTimeout` | Ten minutes; zero is the same as not set | Nothing | [The default](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/controller/backup_controller.go#L403-L406), [its value](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/cmd/server/config/config.go#L46) |
| `itemOperationTimeout` | The setting of the server, four hours unless it is started with another; zero is the same as not set | Nothing | [The default](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/controller/backup_controller.go#L408-L411), [its value](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/cmd/server/config/config.go#L47), [the setting](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/cmd/server/config/config.go#L252) |

The JSON names and the types are the ones of `BackupSpec` and `ScheduleSpec`
([the backup](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/apis/velero/v1/backup_types.go#L29-L187),
[the schedule](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/apis/velero/v1/schedule_types.go#L27-L52)):
the three durations are strings of a Go duration, the four booleans of the template
and `useOwnerReferencesInBackup` are pointers that tell not set from false, and
`paused` is a plain boolean.

### The Form

Two parts: the wrapper of the Schedule, and below it the form of the template of
T4.3, the same component the creation of a backup uses. The words of the labels of
the template are the ones of the spec of T4.3.

| Part | Field | Written as | Choices from | Default of the form |
| --- | --- | --- | --- | --- |
| Schedule | Name | `metadata.name` | Typed: a DNS-1123 subdomain of 63 characters at most | None |
| Schedule | Expression | `spec.schedule` | Typed, checked with the parser of SPEC-0013 | None |
| Schedule | Paused | `spec.paused` | True or false | False, written |
| Schedule | Skip immediately | `spec.skipImmediately` | True or false | False, written |
| Schedule | Backups owned by the schedule | `spec.useOwnerReferencesInBackup` | True or false | False, written |
| Template | Included namespaces | `includedNamespaces` | The namespaces the host lists for the cluster, and free text for a pattern | Not set |
| Template | Excluded namespaces | `excludedNamespaces` | The same | Not set |
| Template | Included resources | `includedResources` | Free text | Not set |
| Template | Excluded resources | `excludedResources` | Free text | Not set |
| Template | Cluster-scoped resources | `includeClusterResources` | Not set, true or false | Not set |
| Template | Label selector, or any of several | `labelSelector` or `orLabelSelectors` | Typed in the selector syntax of Kubernetes, `key=value`, `key!=value`, `key in (a,b)`, `key notin (a,b)`, `key` and `!key`, and written as `matchLabels` and `matchExpressions` | Not set |
| Template | Storage location | `storageLocation` | The BackupStorageLocations of the installation, as SPEC-0007 reads them | The default, when it can be chosen |
| Template | Snapshot locations | `volumeSnapshotLocations` | The VolumeSnapshotLocations of the installation, at most one for each provider | Not set |
| Template | Snapshot volumes | `snapshotVolumes` | Not set, true or false | Not set |
| Template | File system backup of every volume | `defaultVolumesToFsBackup` | Not set, true or false | Not set |
| Template | Move the data of snapshots | `snapshotMoveData` | Not set, true or false | Not set |
| Template | Time to live | `ttl` | A Go duration above zero, written as Go prints it, `720h0m0s` | Not set |
| Template | CSI snapshot timeout | `csiSnapshotTimeout` | The same | Not set |
| Template | Item operation timeout | `itemOperationTimeout` | The same | Not set |

The namespaces come from the host, which lists them for its own views, so the
reader of the extension gains no path. A namespace typed that the host does not
list is kept, with the words that Velero matches it as a pattern or by its name
when the backup starts. The rules of the table of the template are refused in the
form, with the words of Velero: the patterns and the names of the namespaces, the
lists of the namespaces and of the resources, and an included namespace that the
host lists with the label `velero.io/exclude-from-backup=true`. The resources are
free text, matched by Velero against the discovery of the cluster when the backup
starts. Under the template, the form says that this
version does not offer the hooks, the ordered resources, the resource policy, the
uploader configuration, the labels of the backups and the other fields of
REQ-237.

### The Object And Its Way

The contract gains the kind `Schedule` for the confirmation and the run of a write,
`write.confirm` and `write.run`, and the parameters of a Schedule in the request of
the confirmation; nothing else. The main process, at the confirmation:

1. checks the gate, the frame and the cluster as for every write (SPEC-0009);
2. validates the parameters by their reader, every field of the kind and the bounds
   the contract gives it: the name, the expression with the checks of REQ-226, the
   lists, the selectors as the API takes them, the durations above zero;
3. reads, in the namespace of the installation, the storage location and each
   snapshot location named, through the adapter, and ends as not-found when one is
   not there;
4. builds the object, writes it once as the text it will send, with an indentation
   of two spaces and the keys in a fixed order, and keeps that text with the token;
5. answers the token, its expiry and the text, which the review shows as it came.

The run carries the token and the identifier of the request, and nothing of the
object: the main process checks the gate and the frame again, reads the locations
again, and sends the text it kept, by a namespaced POST through the adapter, with
its deadline of ten seconds. A 201 is followed by the reads of REQ-238; a 409 is the
conflict of REQ-227; a 403 is forbidden; a 422, the API server refusing the object,
is validation, in the words of the extension and with nothing of the body; no answer
is the submission of REQ-228. A synthetic example of a reviewed text:

```json
{
  "apiVersion": "velero.io/v1",
  "kind": "Schedule",
  "metadata": {
    "name": "nightly-shop",
    "namespace": "velero"
  },
  "spec": {
    "schedule": "CRON_TZ=Europe/Rome 0 3 * * *",
    "paused": false,
    "skipImmediately": false,
    "useOwnerReferencesInBackup": false,
    "template": {
      "includedNamespaces": [
        "shop"
      ],
      "storageLocation": "default"
    }
  }
}
```

### The Review

The review is in three parts: what it means and the exact object, side by side in
a workspace of 1,000 pixels or more and one under the other below that, the meaning
first, then the commands. What it means is in words: the context and the namespace;
that no backup is made at the creation and when the first one is; the next five runs
and their zone, or why they are not known (REQ-230, REQ-231); a line for each of the
three flags, with what it does (REQ-232 to REQ-234); for each field of the template
that is not set, what Velero does (REQ-235); and the warnings, each with its way
out: the zone not known, a provider with more than one snapshot location and none
chosen, a namespace typed that the host does not list, a namespace that may be
labelled to be excluded after the review, and resource filters or the cluster-scoped
choice beside a global volume policy the server may name, which refuses every
backup. The object is the text the
main process answered, in a block that keeps its spaces and can be copied. Then
the commands, Create schedule and Back to the form, so that the keyboard
passes the meaning and the object before it reaches them. The words of the review
are computed by pure functions in `src/common/`, from the parameters, the read of
the installation and the clock, so that the unit tests read them whole.

### After The Submission

The result takes the place of the review: the name and the namespace, the phase as
Velero wrote it with its errors, or the words that Velero has not read it yet, and
the way to the view of the schedule of SPEC-0006. The view and the list read it as
every other schedule; SPEC-0013 counts its next run from its creation, and says,
until a submission has its backup, what it says of a new schedule. The form is not
emptied by a conflict, a refusal or a submission that is not known, so the operator
corrects and asks for a new review.

### The Amendment Of SPEC-0006

T4.7 puts the first control that writes on the page of the Schedules, and SCHED-11
of SPEC-0006, Verified, checks that the page has none. REQ-074 does not name the
creation and stands. The pull request of the slice restates SCHED-11 in SPEC-0006,
under its amendments, with this smallest change, which the approval of this spec
covers; the pull request that introduces this spec leaves SPEC-0006 as it is:

| Check | Now | Restated |
| --- | --- | --- |
| SCHED-11 | No control that writes, by pointer, menu or keyboard; the objects unchanged | No control that writes, by pointer, menu or keyboard, but the command Create schedule in the header of the list, which opens the workspace of SPEC-0016 and writes nothing by itself; nothing selects, edits, deletes, pauses, resumes or runs a schedule; the objects unchanged |

The surface of the Schedules in DESIGN.md, a native table and a read-only workspace,
is reworded with the same pull request.

### The States Of The Workspace

| State | What the workspace does |
| --- | --- |
| Writes off, or on for another namespace | The form can be filled; the review does not open; the words say why and lead to the target bar |
| The locations denied, not served, failed or not read yet | No storage location can be chosen, with the state of the read in the words of SPEC-0007; the review does not open |
| No location can be chosen | Each location with the reason it cannot be; the review does not open |
| The namespaces of the host not known | The field takes free text alone, with the words that the host lists no namespace for the cluster |
| The installation, the cluster or its entry changed | The review and its token are dropped; a creation whose POST was not sent creates nothing, and one whose POST was sent ends as submission-unknown in the target bar, reconciled by a read of its name (REQ-243) |
| The token expired | The command asks for it again, for the same text only (REQ-229) |
| A creation in flight | The command is disabled and says what is being done |
| The answer of the creation is not known | The words of REQ-228, then the result of the read by name |

## Tests

| Check | Layer | Requirements | Scenario and expected evidence |
| --- | --- | --- | --- |
| CRSCH-01 | Component/packaged application | REQ-221 | The command in the header of the list opens the workspace over the list, named in the address; closing it leaves the list, its search and its scroll as they were; with writes off the form is filled and the review does not open; SCHED-11 of SPEC-0006 as restated, the command the only control that writes |
| CRSCH-02 | Main contract/packaged application | REQ-222 | With writes off, on for another namespace, without a token, with a token of another frame, an expired one and a used one, the creation is refused and nothing is sent; the words of the gate name the Schedule |
| CRSCH-03 | Unit/domain, main contract | REQ-223 | The builder, table-driven: every field of the form to its JSON name and type; a field not set is absent, never empty; the three flags always present; no label, no annotation, no status; a request with a field the contract does not know is refused |
| CRSCH-04 | Main contract | REQ-224 | The adapter is asked one POST to the path of the schedules of the namespace of the gate, with the body equal byte for byte to the text of the confirmation; no PUT, PATCH or apply exists for the kind; a location named that is not there ends as not-found before the POST |
| CRSCH-05 | Unit/domain, component | REQ-225 | Names of 1, 63 and 64 characters, capitals, a leading or trailing `-` or `.`, and a name among the schedules read, in both processes |
| CRSCH-06 | Unit/domain, component | REQ-226 | Every refusal of the table of ADH-01 shows the words the controller writes and keeps the review closed; `@triggered`, `@manual`, `@none` and `0 0 30 2 *` are refused with the words of a backup at every look, by the form and by the main process; 1,025 characters and a control character are refused by the main process |
| CRSCH-07 | Main contract/packaged application | REQ-227 | A 409 ends as conflict with the words and the way to the existing schedule; the adapter is asked nothing more; in the packaged suite the `resourceVersion` of the existing schedule is unchanged |
| CRSCH-08 | Main contract | REQ-228 | A fetch that fails, the deadline, an answer too large and a 503: never a second POST; the read by name finds nothing, the same spec with `skipImmediately` changed by the controller, the same spec created two minutes before the confirmation, another spec, and fails, each with its end |
| CRSCH-09 | Component/main contract | REQ-229 | The review shows the text of the confirmation unchanged; a change of a field, of the installation and writes turned off drop it; an expired token is asked again and the run goes on for the same text, and for another the new review replaces the old one and nothing is sent |
| CRSCH-10 | Unit/domain, fake clock | REQ-230 | The words of the first backup and the next five runs for daily, hourly, weekly and `@every` expressions, from a review at a fixed time, equal to the runs of the parser of SPEC-0013; the `@every` runs after the first counted from the previous submission; a paused schedule with no run listed, and the words of a resume after an instant |
| CRSCH-11 | Unit/domain with a fake clock, component | REQ-231 | A named zone, with the words of a zone the server must know; an expression with no zone and an offset derived from another schedule; the same with no derivable offset, the words of not known and the way out on the expression typed; the machine set fourteen hours east of UTC changes nothing |
| CRSCH-12 | Unit/domain, component | REQ-232 | The words of `paused` true and false, and of a resume after an instant |
| CRSCH-13 | Unit/domain, component | REQ-233 | The words of `skipImmediately` true on a schedule that is not paused and on a paused one, and of false |
| CRSCH-14 | Unit/domain, component | REQ-234 | The words of `useOwnerReferencesInBackup` true: the deletion of the objects, the data of the finished backups kept, the sync that brings them back while the location is Available, the unfinished ones once expired, a sync period of zero, and a backup in progress |
| CRSCH-15 | Unit/domain, component | REQ-235 | Each field of the template not set, with the words of the table of the template; the namespaces offered from the double of the host, a pattern typed and a pattern Velero refuses; the reader asked no path outside `/apis/velero.io/`, as LOC-09 asserts |
| CRSCH-16 | Unit/domain, component | REQ-236 | Locations Available, Unavailable, with no phase, ReadOnly, the default marked, none marked, two marked, denied and not served; snapshot locations of two providers, one with two locations and none chosen |
| CRSCH-17 | Unit/domain, main contract | REQ-237 | A request that carries any of the fields out of the form is refused; the form says which fields this version does not offer |
| CRSCH-18 | Unit/domain with a fake clock, component, packaged application | REQ-238 | The reads after a 201: Enabled, FailedValidation with two errors, no phase after thirty seconds, paused read once; the way to the view of the schedule; never the words of a running schedule before a phase is read |
| CRSCH-19 | Main contract/component | REQ-239 | Each code with its stage, its safety and its words, request-failed for a 400, a 401 and a 429, and no body of an answer in any of them; a change of target with a creation in flight; two commands give one creation; a cancel before the confirmation sends nothing |
| CRSCH-20 | Pre-review | REQ-240 | The workspace in both themes, at 900 by 650 and 1440 by 900 and at twice the zoom, with a name of 63 characters and an expression of 200; the journey by the keyboard alone, Escape in a field and in the confirmation |
| CRSCH-21 | Packaged application | REQ-241 | The suite counts on the API server the creations of the kinds of Velero: none with writes off, none for a review left, one POST of a Schedule and no PUT or PATCH for one confirmed, every field of the text reviewed with the same value in the object read; the conflict; the restricted identity refused by what the views say and by what is not in the cluster; every schedule removed |
| CRSCH-22 | Kubernetes integration | REQ-242 | On the kind cluster of the test environment, the procedures of the compiled main create the three schedules; the real controller writes Enabled, FailedValidation with its error, and nothing for the paused one, read with `skipImmediately` true and no last skipped; the valid one, `*/2 * * * *`, has no backup at its first reading and exactly one after its first instant, removed through a DeleteBackupRequest once it ended; each schedule removed, and no backup of them left |
| CRSCH-23 | Main contract/component/packaged application | REQ-243 | A change of the installation, writes turned off and a frame that goes, each before and each after the POST was sent: before, nothing is created and the API server counts no POST; after, the end is submission-unknown with the context, the namespace and the name in the target bar, nothing is sent again, and the read by name says created or not created |

The homes: the builder and the words in `src/common/`, with their tests beside them;
the procedures in `src/main/`, with the adapter double of the main contract; the
workspace in `src/renderer/`, with the doubles of the host; the packaged suite in
`e2e/__tests__/`; the Kubernetes integration among the scripts of `e2e/scripts/`,
beside the transport proof. The refused schedule of CRSCH-22 is sent through the
procedure, since the form does not let an expression the parser refuses through:
see D11.

## Success Criteria

- One confirmed command creates one Schedule and nothing else, and every field of
  the text the review showed has the same value in the object in the cluster,
  `skipImmediately` aside once the controller has read it: CRSCH-21 and
  CRSCH-22 green.
- No creation without writes on for that namespace and the confirmation, counted on
  the API server; no PUT and no PATCH of a Schedule anywhere.
- The runs the review lists are the runs of the parser of SPEC-0013 for the same
  expression, time and zone; no review uses the zone of this machine.
- The workspace never says that a schedule runs before Velero wrote Enabled.
- The words of each choice and of each warning are read whole by the unit tests;
  the lead maintainer judges them at the review of the milestone, on the screenshots
  of the pre-review.
- Failure: a second request after an answer that is not known, an update of an
  existing schedule, a field written empty, a label or an annotation of the
  extension on the Schedule, or a write outside the disposable kind cluster.

No step by hand is needed beyond the review of the milestone.

## Assumptions And Decisions

- **D1, two specs and one form.** T4.3 and T4.7 are two specs with a shared form,
  and not one spec with two tasks: the spec of T4.3 is reviewed and approved on its
  own, with the form of the template and the Backup it makes, and this one adds the
  wrapper of a Schedule and what a Schedule means. One spec would tie the approval
  of the creation of a backup to the questions of a schedule. T4.7 starts once T4.3
  is on main; the fields this spec needs are in [the form](#the-form), so that the
  spec of T4.3 is drafted against the same list. Where the spec of T4.3 decides a
  field of the template otherwise, this spec is amended in the pull request of
  T4.7, and the change is called out there.
- **D2, a workspace over the list.** The reasons are in the design: a drawer of the
  host closes at a click outside it, and a dialog has no room for the object beside
  its meaning.
- **D3, a name of 63 characters at most.** The name of the object may have 253
  characters, and the names of its backups allow 238, but the label of every backup
  carries the name uncut: a longer name makes a Schedule that never creates a
  backup.
- **D4, the three flags always written.** An empty `skipImmediately` takes the
  setting of the server, which the extension does not read, and the controller of
  the reviewed release, started with the setting true, applies it to the first
  schedule it reads with the field empty and to no later one until the server
  restarts, as the facts say.
  Written false or true, the review can say what happens.
- **D5, no label and no annotation of the extension on the Schedule.** The release
  copies the labels of a Schedule into every backup it creates when the template
  names none, and its annotations always: a label of the extension would say of
  every backup that the extension manages it, which it does not, and the Schedule is
  the operator's from its creation, since the extension neither edits nor deletes
  it. Its identity after the creation is its namespace, its name and its UID.
- **D6, the storage location always named.** An empty field sends each backup to the
  default of the moment it starts, which the review cannot name. The default is
  chosen first when it can be chosen.
- **D7, the expression in two places.** The form refuses what the parser of
  SPEC-0013 refuses, which spares a Schedule that Velero refuses and that the
  extension can neither edit nor delete; the main process refuses an expression
  with no instant, since Velero would submit a backup every minute, and leaves the
  rest of the grammar to Velero, which is the authority on it.
- **D8, the review is the confirmation.** The text the review shows is the answer
  of the confirmation, and the run sends that text: what was read is what is sent.
  Thirty seconds of a token are short for a review, so an expired token is asked
  again by the same command for the same text, never for another. For the kind
  Schedule the answer of `write.confirm` gains the text, which the main process keeps
  with the token, and the run sends that text and carries no parameter: today the
  answer of a confirmation is a token or a refusal, so this extends the procedures of
  SPEC-0009, recorded under its amendments with the pull request of T4.7.
- **D9, five runs.** Enough to show a weekly or a monthly rhythm and a coming
  change of daylight saving time, few enough to read.
- **D10, the reads after the creation.** Every second for thirty seconds: the
  controller reads a new schedule at its creation, so the phase comes within
  seconds, and the views go on reading it after.

- **D11, an expression the parser refuses, decided by the lead maintainer at the
  approval on 2026-10-25 (REQ-226, REQ-242).** The form refuses it (D7), so the
  schedule the controller refuses in the Kubernetes integration is sent through the
  procedure of the main process and not through the form; in the application, the
  refusal of Velero is reached by a zone the server does not know or by a server of
  another version. The other way is a form that lets the expression through with a
  warning, at the price of a Schedule the extension can neither edit nor delete,
  which the details of the host can; it was not taken.
- **D12, the amendments the slice brings.** SCHED-11 of SPEC-0006, as
  [the amendment](#the-amendment-of-spec-0006) says, and the procedures of SPEC-0009,
  as D8 says, each recorded under the amendments of its spec with the pull request
  of T4.7 and approved with this spec.

## Open Questions

Two questions of fact, which the source of the release does not settle; neither
needs a decision before the approval, and each has its first step in the slice.

- **The zones the server knows (REQ-231).** Does the server of the official image
  know the zones the expression may name? The release embeds no zone database: no
  file of its Go source imports `time/tzdata`, and its Dockerfile and build script
  set no tag for one. Whether the run image of the server carries the zones is
  outside the tree. If it does not, every expression that names a zone is
  FailedValidation on such a server, and the way out of REQ-231 is wrong. The slice
  establishes it first, on the test environment, by a Schedule with `CRON_TZ=Europe/Rome` and the phase the
  controller writes, and the words follow what it finds.
- **What a backup in progress had written (REQ-234).** When the Schedule is deleted
  with `useOwnerReferencesInBackup` true while one of its backups is in progress,
  the source shows the object of that backup deleted, and its pod volume backups and
  data uploads deleted and cancelled. It does not show what becomes of what the
  backup had already written to the store or to its repository, nor what the backup
  controller does when the object goes while it runs. The words of the review say
  that it is not known; the slice establishes it on the test environment, by a schedule whose
  backup is deleted in progress, before the words are final.

## Evidence And Deviations

None yet: no implementation, tests or runtime evidence. The facts of the reviewed
release above were read in its source, each at the lines it links; nothing was run,
and no cluster was contacted for this draft.

What this draft could not verify, and what the implementation establishes first:

- The zones the server of the official image knows, the first open question.
- What a backup in progress had written, once its object is deleted, the second
  open question.
- The API through which the host gives the namespaces of a cluster to an extension
  at the validation target, read in the source of the host before the slice; if
  it has none, the field takes free text alone, as the states say.
- The words of the labels of the template, which are the ones of the spec of T4.3.
