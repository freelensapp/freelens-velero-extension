# SPEC-0017: The Write Actions

- **Status:** Approved
- **Date:** 2026-11-07
- **Milestone / tasks:** M5 / the ground rules of the write actions, T4.2, T4.3, T4.4, T4.5, T4.6
- **Reviewed Velero:** v1.18.4, `4ee1e79a7aed367fd9b767b8219ec65bd0c96892`
- **Reviewed main:** not relevant: the actions rest on the reviewed release alone, and behavior present only on the main branch of Velero is design guidance, never a baseline capability ([upstream drift watch](../development/PROCESS.md#upstream-drift-watch))
- **Freelens validation target:** Freelens v2, the validation target of [SPEC-0015](SPEC-0015-freelens-v2-host.md), freelensapp/freelens `b9b53e16056578c5407312eba5823a089972f6d5`, the commit of the tag v2.0.0 of the release Freelens 2.0.0
- **Dependencies:** [the write gate](SPEC-0009-write-gate.md); [Backups](SPEC-0003-backup-read-only.md), [Restores](SPEC-0005-restore-read-only.md), [Schedules](SPEC-0006-schedule-read-only.md) and [locations](SPEC-0007-locations-read-only.md), read only; [the adherence of a schedule](SPEC-0013-schedule-adherence.md); [the Freelens v2 host](SPEC-0015-freelens-v2-host.md); [create a schedule](SPEC-0016-create-a-schedule.md), whose review, whose ends and whose form of the template this spec shares
- **Approval:** Approved by the lead maintainer on 2026-11-07, with the plan of that day, which delegated the decisions of the fifth milestone to the choices this spec recommends: D1 to D15 as drafted, after two rounds of an independent review against the source of the reviewed release

Governed by [AGENTS.md](../../AGENTS.md). A completed draft is not approval to
implement.

## Goal

Let the operator act on Velero from the extension, on one object at a time, after
a review of the exact request the extension will send and of what Velero will do
with it: back up now from a schedule, create a backup, restore from a backup or
from a schedule, pause and resume a schedule, and delete one backup with what it
holds. Then show what Velero made of each, never a success read from the answer of
the API alone.

## Scope Baseline

The [roadmap](../development/ROADMAP.md#m5---actions) plans six actions in M5 and
a row of their ground rules. The creation of a Schedule, T4.7, has its own spec,
[SPEC-0016](SPEC-0016-create-a-schedule.md), approved on 2026-10-25. This spec is
the row of the ground rules and the five other actions: backup now from a schedule
(T4.2), the creation of a backup (T4.3), the restore (T4.4), the pause and the
resume of a schedule (T4.5) and the deletion of one backup (T4.6). D1 of SPEC-0016
asked that the creation of a backup be approved on its own: this spec amends it,
and the creation of a backup is a section of this spec, approved with it, whose
form of the template is the one SPEC-0016 lists.

The order of the slices stays the one of the roadmap, T4.2, T4.3, T4.7, T4.4, T4.5,
T4.6. The ground rules land with the first slice, T4.2: the workspace of an action,
the review that is the confirmation, the reads after the submission and the ends.
Each later slice adds its kind, its body and its words, and nothing to the rules.

The controllers of the reviewed release were read for this draft, with the
commands of its CLI that make the same objects. The facts are in the design of each
action, each with its lines. Nothing was run, and no cluster was contacted.

Included: the ground rules of every write action; the five actions, each with its
command, its form, its review, its body, its submission and its result; the
amendments the slices bring to the specs of the views; the tests.

Excluded, with their owners:

- Editing a Schedule: after v1.0.0, to the next minor
  ([roadmap](../development/ROADMAP.md#deferred-after-v100)). Deleting a Schedule
  is not offered in v1.0.0 ([REQ-074](SPEC-0006-schedule-read-only.md#requirements)).
- The deletion of more than one backup at once, which the exit of M5 excludes, and
  any action on more than one object, which this spec excludes: never in v1.0.0.
- Deleting or changing a Restore, a location, a repository or any other object of
  Velero: not offered in v1.0.0.
- The fields of a Backup the form of the template does not write, as REQ-237 of
  SPEC-0016 lists them; the fields of a Restore this spec does not offer, which
  [the form of a restore](#the-form-of-a-restore) lists and says.
- The real controller in the suites of the views: the suites prove the request the
  extension wrote; the controller proves what Velero does with it in the end to end
  tests and in T6.1, as [the tests](#tests) say.

## User Scenarios

1. **P1, backup now from a schedule:** Given writes on for the namespace `velero`
   and the schedule `nightly-shop` Enabled, when the operator asks Back up now in
   the view of the schedule, then the review shows the Backup the extension will
   create, made from the template of the schedule as the CLI of the release makes
   it, says that the schedule will not submit its own backup while this one has no
   phase or is InProgress, and after the confirmation the result shows the
   phase Velero writes, with the way to the view of the backup.
2. **P1, create a backup:** Given writes on, when the operator fills the form of a
   backup with the namespace `shop` and the storage location `default` and asks for
   the review, then the review shows the exact Backup and what each field set or not
   set does; after the confirmation one Backup is in the cluster, equal to the text
   reviewed.
3. **P1, restore with a mapping:** Given the completed backup `shop-1` with the
   namespace `shop`, when the operator restores it with the mapping of `shop` to
   `shop-restored`, keeps the policy for the resources that exist and chooses the
   cluster-scoped resources the restored ones need, then the review says that
   `shop-restored` does not exist and Velero will create it, that a volume of a claim
   whose name exists comes back under a new name, that the extension does not read
   what the backup holds and so cannot say which objects exist, with the way to the
   resources the backup holds, and shows the exact Restore; after the confirmation
   the result shows the phase Velero writes.
4. **P1, the policy that updates:** Given the same restore into `shop` with the
   policy `update`, then the review says what Velero does with a resource of the
   backup that exists, by the rule of the policy, and that which of them exist is not
   known, and the command creates the Restore only once the name of the backup is
   typed.
5. **P1, pause and resume:** Given the schedule `nightly-shop` Enabled, when the
   operator pauses it, then the review shows the patch of `spec.paused` and says that
   no backup is submitted until it is resumed; when they resume it with
   `skipImmediately` true, as the schedule carries it or as chosen, then the review
   says that the run due at that moment is skipped, and shows the patch.
6. **P1, delete one backup:** Given the completed backup `shop-1`, when the operator
   asks Delete backup, then the review shows the DeleteBackupRequest and says what
   Velero deletes with it; the command asks for the name of the backup typed, and
   after the confirmation the result follows the request until Velero processed it
   and the backup is gone, or shows each error as Velero wrote it.
7. **P1, writes off:** Given writes off, then every command opens its form, the
   review does not open, and the words lead to the target bar; nothing is written,
   which the API server counts.
8. **P2, the target changes:** Given a review on screen, when the operator selects
   another installation or turns writes off, then the review is dropped with its
   confirmation, and nothing is sent.
9. **P2, the answer is lost:** Given a submission whose answer does not come, then
   the result says that it is not known whether the object was created or changed,
   reads it, and says what it found; nothing is sent again by itself.
10. **P2, a restricted identity:** Given an identity that reads the views and may
    not write, then each action ends as forbidden, with the words of what the
    identity may not do, and nothing changes in the cluster.

## Requirements

### The Ground Rules

| ID | Contract | Acceptance check |
| --- | --- | --- |
| REQ-244 | The writes of the actions of v1.0.0 are these and no other, beside the requests of SPEC-0010 and SPEC-0012: the creation of a Backup, from a schedule (T4.2) or from the form (T4.3), of a Restore (T4.4), of a DeleteBackupRequest (T4.6) and of a Schedule (T4.7, SPEC-0016), each one namespaced POST; and the pause and the resume of a Schedule (T4.5), one PATCH of the fields this spec names. The adapter of the main process allowlists exactly these pairs of a kind and a verb, with the creations of those two requests; it has no PUT, no apply, no DELETE and no PATCH of another kind or of another field. A request for anything else is refused as invalid before the gate is looked at. Every action acts on one object, and no command acts on a selection | ACT-01 |
| REQ-245 | Every action is a write of the gate of SPEC-0009: the main process refuses it unless writes are on for the cluster and the namespace of the installation, and runs it only with a token bound to the frame that asked, good for thirty seconds and for one use, for one exact body. The words of the gate that list what the extension may write name, as each slice lands, the kinds and the changes of this spec (REQ-109) | ACT-02 |
| REQ-246 | The review is the confirmation, for every action, as D8 of SPEC-0016 says for a Schedule: the main process builds the body from a discriminated request of the contract that carries the parameters of the action and nothing else, validated at run time as REQ-112 says, writes it once as the text it will send, with an indentation of two spaces and the keys in a fixed order, and answers the token, its expiry and that text. The renderer shows the text as it came, beside what it means. The run carries the token and the identifier of the request, and nothing of the body: the main process checks the gate and the frame again, reads again what the body depends on, and sends the text it kept, byte for byte. A change of a field, of the installation, of the cluster or of its entry, and writes turned off, drop the review and its token. A token that expired while the review was read is asked again by the same command, and the main process gives it only for a text byte for byte the one shown | ACT-03 |
| REQ-247 | What an action means is said in words beside the body: the context and the namespace; what Velero does with the request and when; for each field set and for each field not set, what it does; and the warnings of the action, each with its way out. The words are computed by pure functions in `src/common/`, from the parameters, the reads of the installation and the clock, and the unit tests read them whole | ACT-04 |
| REQ-248 | The answer of the API is not the success of the action. After a creation the main process reads the object by its namespace and its name, checks the UID the creation answered, and reads it every second, for thirty seconds at most, until Velero reports a phase; after a patch it reads the Schedule once and checks the fields the patch wrote. The workspace shows what Velero wrote, each error as written, the words that Velero has not read it yet when it has not, and the way to the view of the object of SPEC-0003, SPEC-0005 or SPEC-0006, which goes on reading it. It never says that an operation runs, completed or was deleted before Velero wrote it | ACT-05 |
| REQ-249 | Every end of an action is a code with a stage, whether it is safe to try again, and words, among the codes of the contract: validation, forbidden, with the words of what the identity may not do, not-found, conflict, target-changed, cancelled, deadline, submission-unknown, and request-failed for any other answer; never the body of an answer. One action runs at a time from a workspace: the command is disabled while it runs, and the identifier of the request rejoins it. A cancel before the confirmation sends nothing | ACT-06 |
| REQ-250 | A submission that got no answer, from a fetch that failed, the deadline, an answer that cannot be read or is too large, or a 5xx, and one aborted on this side after its request was sent, is submission-unknown and is never sent again by itself. The main process reconciles it by reads of the kinds of Velero, which need no gate, by the rule of its kind. A Backup or a Restore is read by the name it named, and is the one created when its creation time is not earlier than one minute before the confirmation, the margin of SPEC-0016 for the clocks, and it carries the labels of the text, the label of the storage location Velero adds aside, and its source, the backup of a restore and the label of the schedule of a backup asked from one: Velero rewrites parts of the spec when it starts it, so the rest of the spec is not compared. A DeleteBackupRequest, whose name the API server generates, is read by the labels of its backup, with the backup beside it: a backup that is gone is a deletion done, and a request for it created since one minute before the confirmation may be this one or another, the one of the collector of expired backups included, which the words say. A patch is read by the fields it wrote: `paused` as written and, after a resume, `skipImmediately` as written or set back to false by the controller with a `status.lastSkipped` not earlier than one minute before the confirmation. What the reads find is said: done as reviewed, with the way to the object; not done as far as the reads show, where a new attempt is a new confirmation; or something else, not known to be this action. The end is kept for the cluster, with the context, the namespace and what to look for, until a frame of that cluster has shown it or the extension is deactivated, as REQ-243 of SPEC-0016 says for a Schedule | ACT-07 |
| REQ-251 | No action of this spec writes a label or an annotation of the extension on an object it creates or changes. An action writes the labels the CLI of the reviewed release writes for the same action, which Velero reads, and the review says what each of them does | ACT-08 |
| REQ-252 | The commands are where their object is: Create backup in the header of the list of the Backups, as Create schedule is in the list of the Schedules; Restore in the view of a backup and in the view of a schedule; Back up now, Pause and Resume in the view of a schedule; Delete backup in the view of a backup. Each opens the workspace of its action over the view it was asked from, named in the address as a view, and the view is as it was when the workspace closes. The workspace is the form, the review and the result, one after the other in the same place, for the installation it was opened for. The commands are there with writes on or off: the form can be filled with writes off, and the review asks for writes on, with words that say so and lead to the target bar | ACT-09 |
| REQ-253 | Both themes, the keyboard alone, every field labelled with its error tied to it, Escape as [DESIGN.md](../development/DESIGN.md#visual-and-interaction-rules) says for a field and for a confirmation, the focus moved to what follows each step, long names, a window of 900 by 650 and twice the zoom, for every workspace of this spec | ACT-10 |
| REQ-254 | The packaged application proves each action in Freelens at the validation target, by what the API server counts, on the environment of the suites: with writes off the command writes nothing; with writes on and a review that is not confirmed, nothing; with both, exactly one request of the kind and the verb of the action and no other write, and every field of the text the review showed with the same value in the object read in the cluster; the refusals of each action; the restricted identity refused, and nothing changed. On the CRDs of the release alone, with no controller, the suites prove the request the extension wrote; what the controller does with it is proven by the end to end tests on the disposable kind cluster with the server of the release, and again in T6.1. No write on a real cluster. Each suite removes what it created | ACT-11 |

### Back Up Now From A Schedule (T4.2)

| ID | Contract | Acceptance check |
| --- | --- | --- |
| REQ-255 | The workspace of a schedule offers Back up now (REQ-252), paused or not and in any phase. Its form has one field, the name of the backup, proposed as the CLI of the release proposes it, `<schedule>-<yyyymmddhhmmss>` with the time of the machine in UTC (D14), and editable: a DNS-1123 subdomain of 216 characters at most, so that the request of SPEC-0010 for each of its artifacts, named `<name>-<identifier of the request>`, keeps to the 253 characters of a name, checked as it is typed and again in the main process, with the rule in words. For a schedule whose name has more than 63 characters the command is disabled, with the words that the API server refuses its name as the value of the label every backup of the schedule carries | NOW-01 |
| REQ-256 | The Backup is the one `velero backup create --from-schedule` of the reviewed release makes from the Schedule as the main process reads it at the confirmation: its `spec` the template of the schedule; its labels the labels of the template when the template has a map of labels, even an empty one, else the labels of the Schedule, with `velero.io/schedule-name` set to the name of the schedule; its annotations the annotations of the Schedule; with `useOwnerReferencesInBackup` true, the Schedule as its controlling owner; and every other change the builder of the release makes, as [the facts](#what-velero-does-with-a-backup-asked-from-a-schedule) list them. No label and no annotation of the extension. At the run the main process reads the schedule again and builds the body again, and ends as a conflict, with nothing sent, when the UID or the body is not the one of the review | NOW-02 |
| REQ-257 | The review says that the backup is asked by hand and is not a submission of the schedule: it moves nothing in the schedule, whose next run stays where it is; that it waits in the queue of the server, Queued and then ReadyToStart, behind a backup that runs and while an earlier backup takes some of its namespaces; that while it has no phase, or is New or InProgress, the schedule submits none of its own, and a run that falls due meanwhile is submitted once, at the first look after it, as the hold of REQ-163 of SPEC-0013 says, while Queued and ReadyToStart do not hold it; that a restore asked from the schedule may take this backup, the newest Completed one with the label of the schedule; that the template is validated when the backup starts, and a template Velero refuses makes the backup FailedValidation; for a schedule that is paused or FailedValidation, that the backup is made all the same, from its template; with `useOwnerReferencesInBackup` true, that deleting the schedule deletes this backup as it deletes the ones it submitted, as REQ-234 of SPEC-0016 says; and each label and annotation the backup takes from the schedule, by its key, with what Velero does with `velero.io/schedule-name` | NOW-03 |
| REQ-258 | A name the API server answers with 409 is a conflict: the existing backup is left as it is, the words lead to it, and the form proposes the name of the next second | NOW-04 |
| REQ-259 | After the creation the workspace reads the backup as REQ-248 says and shows the phase Velero writes, then leads to the view of the backup of SPEC-0003; the view of the schedule shows it among its backups at its next read, and SPEC-0013 counts it as a backup asked by hand | NOW-05 |

### Create A Backup (T4.3)

| ID | Contract | Acceptance check |
| --- | --- | --- |
| REQ-260 | Create backup is in the header of the list of the Backups (REQ-252). Its workspace is the name of the backup and, below it, the form of the template of [SPEC-0016](SPEC-0016-create-a-schedule.md#the-form), the same component the creation of a Schedule uses, with the same fields and the labels of its table, the same choices, the same refusals with the words of Velero, and the same words for each field that is not set, from the table of [the template](SPEC-0016-create-a-schedule.md#what-velero-does-with-the-template). The storage location is chosen and always written as REQ-236 of SPEC-0016 says, and the fields of REQ-237 of SPEC-0016 are never written | CRBAK-01 |
| REQ-261 | The Backup is a `velero.io/v1` `Backup` with `metadata.name` and `metadata.namespace` and no other metadata, no label and no annotation; its `spec` has only the fields the operator set, and a field that is not set is left out, never written empty; no status. The kind joins the ones the adapter allowlists, with the creation of REQ-244 | CRBAK-02 |
| REQ-262 | The name is the operator's, never generated: a DNS-1123 subdomain of 216 characters at most, so that the request of SPEC-0010 for each of its artifacts, named `<name>-<identifier of the request>`, keeps to the 253 characters of a name, checked as it is typed and again in the main process, with the rule in words. The form says when a backup of that name is among the ones the installation read; a creation the API server answers with 409 is a conflict, the existing backup is left as it is, and the words lead to it | CRBAK-03 |
| REQ-263 | The review says that Velero validates the backup when it starts it, and that a backup it refuses is FailedValidation with its errors, and makes nothing; what each field set and each field not set does, in the words of the table of the template; where the backup goes, the storage location by name and its access mode; how long it is kept, the time to live set or the setting of the server, 720 hours unless the server is started with another; and the warnings of the template of SPEC-0016, a namespace typed that the host does not list, a namespace that may be labelled to be excluded after the review, and resource filters or the cluster-scoped choice beside a global volume policy the server may name | CRBAK-04 |
| REQ-264 | After the creation the workspace reads the backup as REQ-248 says, and shows the phase Velero writes: no phase yet, Queued with its position, ReadyToStart, InProgress, FailedValidation with each error, or a later phase when the backup ended within the thirty seconds; then it leads to the view of the backup of SPEC-0003, which goes on reading it. The result says that Velero writes into the spec, when it starts the backup, the values it resolved for the fields that were not set and what it adds to the lists that were, the namespaces labelled to be excluded and the snapshots of volumes, which the view then shows, and that the time to live counts from that start | CRBAK-05 |

### Restore From A Backup Or A Schedule (T4.4)

| ID | Contract | Acceptance check |
| --- | --- | --- |
| REQ-265 | The workspace of a backup offers Restore for that backup, and the workspace of a schedule offers Restore for the backups of the schedule, the newest Completed one by its start chosen first (D10). Its form is [the form of a restore](#the-form-of-a-restore); the name of the restore is proposed as the CLI of the release proposes it, `<backup>-<yyyymmddhhmmss>`, with the time of the machine in UTC (D14), and editable, a DNS-1123 subdomain of 216 characters at most, so that the request of SPEC-0010 for each of its artifacts, named `<name>-<identifier of the request>`, keeps to the 253 characters of a name, checked as it is typed and again in the main process | RESTORE-01 |
| REQ-266 | The Restore is a `velero.io/v1` `Restore` with `metadata.name` and `metadata.namespace` and no other metadata, no label and no annotation; its `spec` names its backup in `backupName` and never names a schedule, has `existingResourcePolicy` always written (D8), the cluster-scoped resources as the operator chose them (D15), and only the other fields the operator set, a field that is not set left out, never written empty; no status. At the run the main process reads the backup again by name and ends as a conflict, with nothing sent, when its UID is not the one of the review or its phase is no longer one the form offers | RESTORE-02 |
| REQ-267 | A backup is offered for a restore only when Velero would restore all it holds: Completed, or PartiallyFailed with the words that some of its items may be missing. For any other phase the command says why it is not offered: the controller does not check the phase of the backup it is given, and a backup that has not ended has no files in the store yet, or not all its data. From a schedule the form lists the backups of the schedule the installation read, Completed and PartiallyFailed; with none, the command says that the schedule has no backup to restore | RESTORE-03 |
| REQ-268 | The included and excluded namespaces and resources follow the rules the restore controller checks, which the form refuses with its words: `*` beside another item, `*` among the excluded, an item in both lists, and among the included resources one Velero never restores. The namespaces are the names they had in the backup: the form offers the ones the spec of the backup names, and free text for the others, which Velero matches in the backup. The mapping of the namespaces is a list of pairs, a namespace of the backup and the namespace it is restored into, each target a DNS-1123 label, no source twice and no target twice. Velero validates no mapping: a source that no namespace or pattern the backup includes matches, or that it excludes, is refused, with the words that Velero would use it for nothing; when the backup took every namespace, a source is kept, with those words as a warning. The review says, for each target, whether the host lists it in the cluster, in which case Velero restores into that namespace as it is and never changes it, or not, in which case Velero creates it from the namespace of the backup; and for each namespace restored without a mapping, whether the host lists it | RESTORE-04 |
| REQ-269 | The policy for the resources that exist is `none` or `update`, `none` unless chosen, always written. The review says what each does with a resource of the backup that exists in the cluster: with `none`, Velero leaves it as it is, and reports it as a warning when it differs; with `update`, Velero applies to one that differs a merge patch from the copy in the cluster to the object of the backup, so that a field only the cluster has is removed, by the rules of a merge patch, writes on one that is the same the two labels of the restore, and reports what it could not update; with both, that a ServiceAccount is merged whatever the policy, and that the namespaces themselves are never changed | RESTORE-05 |
| REQ-270 | The review says what the restore takes and how much of it is known: the backup by name and its storage location, with the words that Velero refuses the restore when that location is not Available; the namespaces, the mapped ones with their targets, and the resources, each field set or not set with what the release does with it; the cluster-scoped resources as chosen (D15): every one of the backup; none, so that the volume of a claim backed up by a native snapshot or by a file system backup does not come back, while a CSI snapshot of it is restored all the same, as a content under a new name from which the claim gets a new volume, unless the volumes are not restored; or the ones the restored resources need, the volume of a bound claim, restored under a new name when one of its name exists and its namespace is mapped, the priority class of a pod and the content of a CSI snapshot, with every cluster-scoped resource of the backup when the restore takes every namespace; whether the volumes are restored, as `restorePVs` set or not set decides; the resources Velero never restores, by name, with the pods and the jobs that finished and the mirror pods; that the status of an object is not restored, unless the object carries the annotation `velero.io/restore-status` set to true; and the labels Velero writes on the objects it restores, but the namespaces it creates. It says that the extension does not read what the backup holds, so it does not know which objects Velero will create, leave or update, and leads to the resources of the backup, the tab of SPEC-0011 that lists what the backup holds | RESTORE-06 |
| REQ-271 | The command Create restore is enabled only once the name of the backup is typed exactly in the field the review shows for it (D3). The run carries the name typed, and the main process refuses a run whose name is not the one of the backup of the text | RESTORE-07 |
| REQ-272 | After the creation the workspace reads the restore as REQ-248 says, and shows the phase Velero writes: no phase yet, InProgress, FailedValidation with each error, or a later phase when the restore ended within the thirty seconds; then it leads to the view of the restore of SPEC-0005, which goes on reading it | RESTORE-08 |
| REQ-273 | The fields of a restore the form does not offer are never written, and the form says, under its fields, that this version does not offer them: the hooks, the resource modifier, the resource policy, the filters of the status of the resources, the uploader configuration, `preserveNodePorts` and the timeout of the item operations; the release then takes its defaults, which the review names | RESTORE-09 |

### Pause And Resume A Schedule (T4.5)

| ID | Contract | Acceptance check |
| --- | --- | --- |
| REQ-274 | The workspace of a schedule offers Pause when `spec.paused` is not true, and Resume when it is (REQ-252). Each opens the workspace of its action over the view of the schedule, with the state it acts on, read with the schedule | PAUSE-01 |
| REQ-275 | Pause is one JSON patch of the Schedule, sent with the method in capitals and the media type of a JSON patch: a test of `/metadata/uid` with the UID of the review, then an add of `/spec/paused` with true; nothing else. A schedule that is not paused may have no `paused` at all, and a test cannot test what is absent; a pause that finds the schedule paused already leaves it as it was. Resume is a test of `/metadata/uid`, a test of `/spec/paused` with true, a test of `/spec/schedule` with the expression the review read, a replace of `/spec/paused` with false, and an add of `/spec/skipImmediately` with the value chosen; nothing else. The form proposes `skipImmediately` as the schedule carries it, true when it is true and false otherwise, and says when the choice replaces what the schedule carries. A 422 to a patch is followed by a read of the Schedule: when its UID, `paused` or its expression is not as the patch tested, it is a conflict, with the words that the schedule changed since the review and the way back to its view, which reads it again; otherwise it is validation. The action needs the verb patch on the schedules, which the CLI of the release does not use, since it updates the whole object: a refusal says that the identity may not patch schedules in that namespace | PAUSE-02 |
| REQ-276 | The review of a pause says that Velero does not read a paused schedule: it submits no backup, writes no phase and validates nothing until the schedule is resumed; that a backup the schedule already submitted goes on; and that the adherence of SPEC-0013 says the schedule is paused. The review of a resume says when the next backup is due, counted from the last backup of the schedule, or from its creation when it has none, or from `status.lastSkipped` when that is later: at once, at the first look of the controller after the resume, one backup and not one for each run missed, when an instant of the expression has passed since then, unless `skipImmediately` is true, and while a backup of the schedule has no phase or is InProgress, at the first look after it; with `skipImmediately` true, that Velero skips that run and counts the next one from the time it reads the schedule, and sets the field back to false; that Velero validates the expression again when it reads the schedule, and writes FailedValidation for one it refuses; and the next runs, as REQ-230 and REQ-231 of SPEC-0016 compute and say them, with the zone of the expression | PAUSE-03 |
| REQ-277 | After the patch the workspace reads the Schedule once, checks its UID and the fields the patch wrote, and shows them: paused, or resumed with what `skipImmediately` holds and, once Velero read it, `status.lastSkipped`; then it leads to the view of the schedule of SPEC-0006, where SPEC-0013 counts its adherence | PAUSE-04 |

### Delete One Backup (T4.6)

| ID | Contract | Acceptance check |
| --- | --- | --- |
| REQ-278 | The workspace of a backup offers Delete backup (REQ-252), for that backup alone. For a backup InProgress, waiting for its plugins or finalizing, which Velero refuses to delete, the command says so and is disabled; for one Deleting, it says that Velero is deleting it or that a deletion failed, which a new request tries again; for one with no phase, New, Queued or ReadyToStart, that Velero deletes it before it starts | DELETE-01 |
| REQ-279 | The request is a `velero.io/v1` `DeleteBackupRequest` as `velero backup delete` of the reviewed release makes it: the name generated by the API server from the prefix `<backup>-`, the labels that name the backup and its UID, with the name cut as the release cuts a label, and `spec.backupName`; no other label and no annotation. At the run the main process reads the backup again and ends as a conflict, with nothing sent, when its UID is not the one of the review. A 409 is the generated name meeting one that exists: nothing was created, which the words say, and a new attempt is a new confirmation | DELETE-02 |
| REQ-280 | The review says what Velero deletes with the backup, in the order it does it: what its plugins delete, its volume snapshots, the snapshots of its pod volume backups, the data it moved, the files of the backup in the store, every Restore of the backup with the files of each, and the Backup itself; that the files in the store and the Backup are deleted only when nothing failed before, while the restores are deleted even when a step after the one of the plugins failed; that a backup it cannot delete stays Deleting, with the errors of the request; that every installation that syncs the same storage location deletes, at its next sync, its own Backup object whose files are gone; and that this cannot be undone. It names the storage location of the backup, and says that Velero refuses the request when that location is not there, is ReadOnly or is not Available | DELETE-03 |
| REQ-281 | The command Delete backup is enabled only once the name of the backup is typed exactly in the field the review shows for it (D3). The run carries the name typed, and the main process refuses a run whose name is not the one of the backup of the text | DELETE-04 |
| REQ-282 | After the creation the workspace reads the request by the name the API server gave it, or by the labels of its backup when the answer was lost, as REQ-250 says, every second for thirty seconds at most, and the backup with it, and says what the two show together: the request gone with the backup, a deletion Velero completed, since it deletes its requests when nothing failed; the request gone and the backup there, a request that a later one for the same backup replaced; Processed with the error of a refusal and the backup in the phase it had, a deletion Velero refused, each error as written; Processed with errors and the backup Deleting, a deletion that failed on the way; no phase yet, that Velero has not read it; InProgress, that Velero is deleting it, with the way to the view of the backup. It never says that the backup was deleted before the read shows it gone. A read of the requests the identity may not make is said, and the result then reads the backup alone | DELETE-05 |
| REQ-283 | A request for a backup that has others is offered with the words that Velero, before it starts, deletes every other request that names the same backup, as [the facts](#what-velero-does-with-a-deletebackuprequest) say | DELETE-06 |
| REQ-284 | The deletion is never of more than one backup, never through a DELETE of the Backup, which leaves the files in the store and which the sync brings back, and never offered on a row or a selection of a list | DELETE-07 |

## Design

- **Standard or ad hoc view, and why.** Ad hoc: a guided flow in a workspace over
  the view the command was asked from, as the creation of a Schedule is in
  SPEC-0016, and for the same reasons. Each action is a decision whose consequences
  are not visible in the fields: what Velero takes from a schedule, what a restore
  overwrites, what a deletion takes from the store. The operator needs the form,
  then the exact request beside what it means, then what Velero made of it, in one
  place that stays while they read. The drawer of the host closes at a click outside
  it (AGENTS.md, the facts of the host), and a dialog has no room for the request
  and its meaning side by side. The workspace has the target bar with the state of
  the gate above it, the way back to the view, and the keyboard rules of the other
  views. The lists stay the native tables of the host: no action is offered on a
  row or on a selection.
- **Safety.** The actions write four kinds into the namespace of the selected
  installation, a Backup, a Restore, a DeleteBackupRequest and, with SPEC-0016, a
  Schedule, and change two fields of a Schedule, through the gate and the
  confirmation of the review, and nothing else. A Restore makes Velero write into
  the namespaces of the cluster, and a DeleteBackupRequest makes it delete the data
  of a backup in the store: the review of each says what, and both ask for a second
  gesture, the name of the backup typed, which the main process checks at the run
  (REQ-271, REQ-281). The packaged suites count the writes on the API server (REQ-254), and
  the controller of the release acts only on the disposable kind cluster.

### The Workspace Of An Action

One component for every action, from the first slice: the form of the action
above, the review in its place once asked, then the result. The parts that differ
by action are its form, its body and its words; the rest is shared:

- the state of the gate in words, with the way to the target bar when writes are
  off or on for another namespace;
- the review in three parts: what it means and the exact body, side by side in a
  workspace of 1,000 pixels or more and one under the other below that, the meaning
  first, then the commands, so that the keyboard passes the meaning and the body
  before it reaches them;
- the second gesture of REQ-271 and REQ-281, a field where the name of the backup
  is typed, which enables the command when it matches exactly and says so;
- the command, named for what it does: Create backup, Create restore, Pause
  schedule, Resume schedule, Delete backup, never a word that says load, read or
  apply alone (REQ-117);
- the result, which takes the place of the review: what Velero wrote, or that it
  has not read it yet, and the way to the view of the object;
- the end of a submission that is not known, in the workspace and in the target
  bar of the cluster (REQ-250).

The body is shown in a block that keeps its spaces and can be copied. The form is
not emptied by a refusal, a conflict or a submission that is not known, so the
operator corrects it and asks for a new review.

### The Contract

The kinds of `write.confirm` and `write.run` of SPEC-0009 gain one value for each
action: `backup-from-schedule`, `backup`, `restore`, `schedule-pause`,
`schedule-resume` and `delete-backup`, beside `schedule` of SPEC-0016. The request
of the confirmation of each carries the parameters of its action and nothing else;
the answer of the confirmation carries the token, its expiry and the text of the
body, as D8 of SPEC-0016 extends it for a Schedule; the run carries the token and
the identifier of the request. The contract gains no generic creation and no
generic patch: each kind names its verb and its path, built in the main process.

| Kind | Verb and path | Parameters | Read again at the run |
| --- | --- | --- | --- |
| `backup-from-schedule` | POST `/apis/velero.io/v1/namespaces/<namespace>/backups` | The name and the UID of the schedule | The schedule, whose UID and the body built from it again must be the ones of the review |
| `backup` | The same | The name and the fields of [the form of the template](SPEC-0016-create-a-schedule.md#the-form) | The storage and snapshot locations named |
| `restore` | POST `/apis/velero.io/v1/namespaces/<namespace>/restores` | The name, the backup by name and UID, and the fields of [the form of a restore](#the-form-of-a-restore) | The backup, by name and UID, and its phase |
| `schedule-pause` | PATCH `/apis/velero.io/v1/namespaces/<namespace>/schedules/<name>`, a JSON patch | The name and the UID of the schedule | Nothing: the tests of the patch are the check |
| `schedule-resume` | The same | The name, the UID and the expression of the schedule, and `skipImmediately` | The same |
| `delete-backup` | POST `/apis/velero.io/v1/namespaces/<namespace>/deletebackuprequests` | The name and the UID of the backup | The backup, by name and UID |

The run of `restore` and of `delete-backup` also carries the name of the backup as
the operator typed it, the second gesture of REQ-271 and REQ-281, which the main
process compares with the backup of the text it kept.

The method is written in capitals, as the client of the host types it since
freelensapp/freelens#2852, which the validation target contains: the fetch of
Chromium sends a method other than DELETE, GET, HEAD, OPTIONS, POST and PUT as it is
written, and the API server answers a `patch` in small letters with 405. The adapter
sends a patch with the media type of a JSON patch, never the strategic merge patch
the host takes by default, which a custom resource does not have, as the
[architecture](../development/ARCHITECTURE.md#create-only-adapter-decision) says.

### The Way Of A Write

At the confirmation, for every kind, the main process:

1. checks the gate, the frame and the cluster, as for every write (SPEC-0009);
2. validates the parameters by their reader, every field of the kind and the
   bounds the contract gives it;
3. reads, in the namespace of the installation, what the body depends on, as the
   table says, and ends as not-found, naming which, when one is not there, or as a
   conflict when its UID is not the one of the review;
4. builds the body, writes it once as the text it will send, and keeps that text
   with the token;
5. answers the token, its expiry and the text, which the review shows as it came.

At the run it checks the gate and the frame again, the name typed where the kind
asks for one, reads again what the table says, and sends the text it kept, through
the adapter, with its deadline of ten seconds. A 201 of a creation and a 200 of a
patch are followed by the reads of REQ-248; a 409 is a conflict; a 403 is forbidden;
a 404 is not-found; a 422, the API server refusing the body, is validation, in the
words of the extension and with nothing of the body of the answer, except after a
patch, which the API server answers with 422 also when one of its tests fails: the
main process reads the Schedule then, and a schedule that is no longer as the patch
tested is a conflict, with the words that it changed since the review; no answer is
submission-unknown (REQ-250).

### The States Of A Workspace

| State | What the workspace does |
| --- | --- |
| Writes off, or on for another namespace | The form can be filled; the review does not open; the words say why and lead to the target bar |
| What the form reads is denied, not served, failed or not read yet | The fields that need it say the state of the read in the words of the view that reads it; the review does not open while a field it needs is not known |
| The object of the action changed or went since the view read it | The review is refused as a conflict or as not-found, with the words of what changed, and the way back to the view, which reads it again |
| The installation, the cluster or its entry changed | The review and its token are dropped; a write whose request was not sent writes nothing, and one whose request was sent ends as submission-unknown, in the target bar, reconciled as REQ-250 says |
| The token expired | The command asks for it again, for the same text only |
| A write in flight | The command is disabled and says what is being done |
| The answer of the write is not known | The words of REQ-250, then what the read found |

### What Velero Does With A Backup Asked From A Schedule

The command line of the reviewed release and the schedule controller build the backup with the same builder. Nothing was run.

| Fact | Source |
| --- | --- |
| `velero backup create --from-schedule` reads the Schedule and names the backup `<schedule>-<yyyymmddhhmmss>` with the time in UTC when no name is given; the controller names its own with the time of the server | [The name](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/cmd/cli/backup/create.go#L374-L376), [the form](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/apis/velero/v1/schedule_types.go#L137-L140), [the controller](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/controller/schedule_controller.go#L257-L260) |
| The builder copies the template of the schedule as the spec; takes the labels of the template when the template has a map of labels, even an empty one, else the labels of the Schedule, never both, and adds `velero.io/schedule-name` with the name of the schedule, uncut; takes the annotations of the Schedule itself, since the template has none; names the Schedule as the controlling owner only with `useOwnerReferencesInBackup` true; and rewrites a resource policy of the template as a reference of the kind `configmap` | [The spec](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/builder/backup_builder.go#L109), [the labels](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/builder/backup_builder.go#L86-L107), [the annotations](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/builder/backup_builder.go#L112-L114), [the template](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/apis/velero/v1/backup_types.go#L24-L26), [the owner](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/builder/backup_builder.go#L116-L126), [the policy](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/builder/backup_builder.go#L128-L130) |
| Nothing refuses a backup from a schedule that is paused or FailedValidation: no line of the command, of the builder, of the queue or of the backup controller reads the state of the Schedule, and the schedule controller validates only the expression | [The command](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/cmd/cli/backup/create.go#L365-L427), [the queue](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/controller/backup_queue_controller.go#L248-L320), [the backup controller](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/controller/backup_controller.go#L281-L293), [what the schedule controller validates](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/controller/schedule_controller.go#L174-L212) |
| Only the controller writes `status.lastBackup`, after its own submission: a backup asked by hand moves nothing in the schedule | [The write](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/controller/schedule_controller.go#L265-L270) |
| A due schedule submits nothing while a backup with its label has no phase or is New or InProgress, whoever made it; a backup Queued or ReadyToStart does not hold it; the next run counts from `status.lastBackup`, which a held run does not move, so one backup comes at the first look after the hold | [The hold](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/controller/schedule_controller.go#L214-L238), [the phases](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/controller/schedule_controller.go#L232), [the anchor](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/controller/schedule_controller.go#L275-L289) |
| A new backup waits in a queue, Queued then ReadyToStart, one at a time by default, and while an earlier backup takes some of its namespaces | [The queue](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/controller/backup_queue_controller.go#L248-L320), [the overlap](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/controller/backup_queue_controller.go#L148-L198), [one at a time](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/cmd/server/config/config.go#L55) |
| A restore from a schedule takes, among every backup with its label, whoever made it, the newest Completed by its start | [The choice](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/controller/restore_controller.go#L368-L390), [the order](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/controller/restore_controller.go#L458-L481) |

### What Velero Does With A New Backup

The fields of the template, what the release does with each when it is not set and what makes a backup FailedValidation are in [the table of the template](SPEC-0016-create-a-schedule.md#what-velero-does-with-the-template) of SPEC-0016. What the start adds, read in the backup controller and the queue of the reviewed release. Nothing was run.

| Fact | Source |
| --- | --- |
| A new backup waits in the queue, Queued with its position and then ReadyToStart, one at a time by default, and while an earlier backup takes some of its namespaces; the backup controller starts only one ReadyToStart | [The queue](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/controller/backup_queue_controller.go#L248-L320), [the controller](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/controller/backup_controller.go#L281-L293), [one at a time](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/cmd/server/config/config.go#L55) |
| When it starts it, the controller writes into the spec the values it resolves for what was not set, the time to live, the storage location, the snapshot locations, the timeouts, every namespace when none is named, the namespaces labelled to be excluded and the snapshots of volumes, which it adds to the excluded resources, and patches them also into a backup it refuses | [The values](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/controller/backup_controller.go#L379-L622), [the snapshots](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/controller/backup_controller.go#L72-L84), [added](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/controller/backup_controller.go#L529-L543), [the patch](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/controller/backup_controller.go#L307) |
| The expiration is the time of that start plus the time to live: the time a backup waits in the queue does not count | [The expiration](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/controller/backup_controller.go#L414) |
| The controller adds the label of the storage location and the annotations of the version of the cluster and of the timeout of the resources | [The label](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/controller/backup_controller.go#L482-L486), [the annotations](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/controller/backup_controller.go#L500-L507) |

### What Velero Does With A Restore

The restore controller and the restore of the reviewed release, with the command line that makes the same object. Nothing was run.

| Fact | Source |
| --- | --- |
| The command line names a restore `<backup or schedule>-<yyyymmddhhmmss>` in the local time of its machine, writes the backup as `backupName` or the schedule as `scheduleName` and refuses both or neither | [The name](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/cmd/cli/restore/create.go#L173-L183), [the source](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/cmd/cli/restore/create.go#L195-L201), [the spec](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/cmd/cli/restore/create.go#L340-L341) |
| The controller refuses a restore with both sources or neither, a policy that is not exactly `none` or `update`, both selectors, invalid lists, a source it cannot find, a storage location that is not Available, and a schedule without a Completed backup, writing FailedValidation with each error; it never checks the phase of a backup it is given by name: the restore needs the files of the backup in the store, which a backup that has not ended may not have yet, or not with all its data | [The checks](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/controller/restore_controller.go#L307-L442), [both or neither](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/controller/restore_controller.go#L444-L456), [the policy](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/util/velero/restore/util.go#L7-L12), [the files](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/controller/restore_controller.go#L536-L539), [when they are written](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/controller/backup_controller.go#L828-L871), [the failure](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/controller/restore_controller.go#L271-L276) |
| A schedule is restored from the newest Completed backup with its label by its start; a PartiallyFailed one is never taken by the server | [The choice](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/controller/restore_controller.go#L368-L390), [the order](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/controller/restore_controller.go#L458-L481) |
| The included and excluded namespaces are the names of the backup; a mapped namespace is restored into its target, created from the namespace of the backup when it is not there, used as it is when it is, never patched, and waited for when it is being deleted; a mapping of a namespace the backup does not have is used for nothing, and nothing validates the mapping | [The names of the backup](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/restore/restore.go#L1417-L1427), [the target](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/restore/restore.go#L2633-L2636), [created](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/restore/restore.go#L1095-L1135), [used as it is](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/util/kube/utils.go#L115-L136), [never patched](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/restore/restore.go#L1044-L1047), [waited for](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/util/kube/utils.go#L121-L125) |
| A resource that exists and differs: with `none`, a warning; with `update`, a merge patch from the copy in the cluster to the object of the backup, and a warning when it fails; a ServiceAccount is merged whatever the policy; one that is the same is left as it is with `none`, and gets the two labels of the restore with `update` | [The policy](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/restore/restore.go#L1824-L1974), [update](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/restore/restore.go#L2923-L2950), [the same](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/restore/restore.go#L1960-L1970), [the ServiceAccount](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/restore/merge_service_account.go#L30-L112) |
| Every object Velero restores carries the labels `velero.io/backup-name` and `velero.io/restore-name`, but the namespaces it creates | [The labels](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/restore/restore.go#L2452-L2463), [the namespaces](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/restore/restore.go#L1007-L1043) |
| Velero never restores nodes, events, backups, restores, the repositories of Velero, CSI nodes and volume attachments, nor mirror pods, finished pods and finished jobs; the status of an object only when the restore asks for it or the object carries the annotation `velero.io/restore-status` set to true | [The list](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/controller/restore_controller.go#L66-L95), [the pods and the jobs](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/restore/restore.go#L1464-L1472), [the mirror pods](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/restore/restore.go#L1505-L1508), [the status](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/restore/restore.go#L3050-L3090) |
| With `includeClusterResources` false, no cluster-scoped item is restored, but the VolumeSnapshot and the VolumeSnapshotContent the actions of CSI mark to be restored whatever the filters: the content comes back under a new name, unless the volumes are not restored, and the claim gets a new volume from it. Not set, the restore takes the cluster-scoped resources of the backup only when it takes every namespace, while the actions add, whatever the filter, the volume of a bound claim and the priority class of a pod; under a mapping, a volume whose name exists comes back under a new name. True takes every one | [The rule](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/restore/restore.go#L2584-L2592), [every namespace](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/util/collections/includes_excludes.go#L264-L268), [false](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/restore/restore.go#L1428-L1432), [what the actions add](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/restore/restore.go#L1694-L1723), [the volume](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/restore/actions/pvc_action.go#L117-L128), [the priority class](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/restore/actions/pod_action.go#L90-L94), [the new name](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/restore/restore.go#L2131-L2167), [must include](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/restore/restore.go#L1408-L1410), [the snapshot](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/restore/actions/csi/pvc_action.go#L173-L186), [its content](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/restore/actions/csi/volumesnapshot_action.go#L294-L318), [the volumes](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/restore/actions/csi/volumesnapshotcontent_action.go#L62-L66), [the new volume](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/restore/actions/csi/pvc_action.go#L204-L213) |

### The Form Of A Restore

| Field | Written as | Choices from | Default of the form |
| --- | --- | --- | --- |
| Name | `metadata.name` | Typed: a DNS-1123 subdomain of 216 characters at most, for the requests of its artifacts | `<backup>-<yyyymmddhhmmss>`, the time of the machine in UTC |
| From | `spec.backupName` | The backup the workspace was opened for; from a schedule, one of its backups, Completed or PartiallyFailed | That backup; from a schedule, the newest Completed by its start |
| Included namespaces | `includedNamespaces` | The namespaces the spec of the backup names, and free text for a pattern, matched in the backup; the list rules of the controller refused | Not set |
| Excluded namespaces | `excludedNamespaces` | The same | Not set |
| Mapping of the namespaces | `namespaceMapping` | Pairs: a namespace of the backup, matched against what the backup includes, and a target, a DNS-1123 label; the targets the host lists for the cluster are offered, and a new name is typed | Not set |
| Included resources | `includedResources` | Free text; a resource Velero never restores, and the list rules of the controller, refused | Not set |
| Excluded resources | `excludedResources` | Free text | Not set |
| Cluster-scoped resources | `includeClusterResources` | Every one of the backup, written true; none, written false; or the ones the restored resources need, left out (D15) | None: the review does not open until one is chosen |
| Label selector, or any of several | `labelSelector` or `orLabelSelectors` | As in the form of the template of SPEC-0016 | Not set |
| Restore the volumes | `restorePVs` | Not set, true or false | Not set |
| Resources that exist | `existingResourcePolicy` | `none` or `update` | `none`, written |

The namespaces of the cluster come from the host, which lists them for its own
views, so the reader of the extension gains no path, as in SPEC-0016. Under the
fields, the form says that this version does not offer the hooks, the resource
modifier, the resource policy, the filters of the status of the resources, the
uploader configuration, `preserveNodePorts` and the timeout of the item operations
(REQ-273).

The review is the one of [the workspace](#the-workspace-of-an-action): what the
restore takes and does, field by field, the target of each mapping and whether it
exists, the cluster-scoped resources as chosen, the policy and what it does, the
resources Velero never restores, the labels Velero writes on what it restores, what
is not known, with the way to the resources the backup holds, and the field where
the name of the backup is typed (REQ-271).

### What Velero Does With A Pause And A Resume

The command line and the schedule controller of the reviewed release. SPEC-0016 has the reading of a new schedule. Nothing was run.

| Fact | Source |
| --- | --- |
| `velero schedule pause` and `unpause` set `spec.paused` and set `spec.skipImmediately` to the value of their flag, or clear it when the flag is not given, and replace the whole object with an update; they need the verb update, never patch | [The write](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/cmd/cli/schedule/pause.go#L134-L145), [the flag](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/cmd/cli/schedule/skip_options.go#L17-L20) |
| A paused schedule is left out of every event and of the look once a minute: nothing is validated, submitted or written while it is paused; a resume is a change of the spec, which the controller reads at once | [Left out](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/controller/schedule_controller.go#L73-L89), [a change of the spec](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/util/kube/predicate.go#L30-L48) |
| At a reading with `skipImmediately` true the controller writes it back to false and writes the time into `status.lastSkipped`; empty, the setting of the server decides, false unless the server is started with it | [The skip](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/controller/schedule_controller.go#L113-L154), [the setting](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/cmd/server/config/config.go#L219) |
| The next run counts from `status.lastBackup`, or from the creation, or from `status.lastSkipped` when it is later: a schedule resumed after an instant of its expression submits one backup at once, not one for each run it missed, unless the run is skipped | [The anchor](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/controller/schedule_controller.go#L275-L289), [one backup](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/controller/schedule_controller.go#L258-L259) |

### What Velero Does With A DeleteBackupRequest

The command line and the deletion controller of the reviewed release. Nothing was run.

| Fact | Source |
| --- | --- |
| `velero backup delete` reads the backup for its UID and creates one request with the name the API server generates from `<backup>-`, the labels `velero.io/backup-name`, the name cut to 63 characters with a hash as for every label of a name, and `velero.io/backup-uid`, and `spec.backupName` | [The request](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/cmd/cli/backup/delete.go#L123-L131), [the builder](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/builder/delete_backup_request_builder.go#L31-L63), [the cut](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/label/label.go#L32-L51) |
| Before it starts, the controller deletes every other request that names the same backup; it refuses a backup in progress, InProgress, waiting for its plugins or finalizing, but not one New, Queued or ReadyToStart; a backup that is not there; and a storage location that is not there, is ReadOnly or is not Available; each refusal is the phase Processed with one error, `backup deletion failed:` followed by the reason, and comes before the backup is Deleting, so the backup keeps its phase; a request goes from no phase to InProgress | [The other requests](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/controller/backup_deletion_controller.go#L162-L166), [the refusals](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/controller/backup_deletion_controller.go#L155-L208), [in progress](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/controller/backup_tracker.go#L94-L103), [the error](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/controller/backup_deletion_controller.go#L631-L637), [InProgress](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/controller/backup_deletion_controller.go#L210-L229) |
| Then the backup is Deleting, and the controller deletes, in this order, what the plugins delete, the volume snapshots, the snapshots of the pod volume backups, the data moved with its uploads, the files in the store only when nothing failed before, every Restore of the backup with its files, even when something failed, and the Backup only when nothing failed | [Deleting](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/controller/backup_deletion_controller.go#L231-L239), [the steps](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/controller/backup_deletion_controller.go#L263-L432), [the restores](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/controller/backup_deletion_controller.go#L377-L425) |
| At the end the request is Processed with its errors; when nothing failed, every request of the backup, this one included, is deleted with it, and when something failed the backup stays Deleting | [The end](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/controller/backup_deletion_controller.go#L440-L463) |
| A Backup deleted with a DELETE deletes nothing in the store: no controller acts on it, and the sync of an Available location brings a finished one back from the store at its next pass, a minute apart by default | [No controller](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/controller/backup_controller.go#L187-L189), [the sync](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/controller/backup_sync_controller.go#L110-L224), [the period](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/cmd/server/config/config.go#L26) |
| Every installation that syncs an Available location deletes its own Completed or PartiallyFailed Backup objects whose files are gone from the store | [Available](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/controller/backup_sync_controller.go#L93-L96), [the deletion](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/controller/backup_sync_controller.go#L333-L362) |

### The Amendments The Slices Bring

The specs of the views of the first milestone check that their surfaces write
nothing. Each slice of this spec restates, under the amendments of the spec it
touches and with its own pull request, the smallest part of those checks that its
command changes, which the approval of this spec covers; the pull request that
introduces this spec leaves them as they are.

| Spec | Requirement and check | Now | Restated |
| --- | --- | --- | --- |
| SPEC-0003 | REQ-030, BACK-07 | A read-only workspace of a backup, without placeholder controls | The workspace of a backup, which reads and offers two commands, Restore (T4.4) and Delete backup (T4.6), each opening the workspace of its action of SPEC-0017 and writing nothing by itself; no placeholder control |
| SPEC-0003 | REQ-032, BACK-09 | No generic edit or delete and no bulk deletion on a surface of a Backup | No generic edit or delete and no bulk deletion on a surface of a Backup; the one deletion is Delete backup, of one backup, through a DeleteBackupRequest, in the workspace of that backup |
| SPEC-0006 | REQ-074, SCHED-11 | No surface offers to edit, delete, select, pause, resume or run a schedule, with the command Create schedule of SPEC-0016 | No surface offers to edit, delete or select a schedule; the workspace of a schedule offers Back up now (T4.2), Pause or Resume (T4.5) and Restore (T4.4), each opening the workspace of its action of SPEC-0017 and writing nothing by itself; the list offers Create schedule of SPEC-0016 and nothing else that writes |
| SPEC-0003 | The evidence of BACK-09, with T4.3 | The list of the Backups has no command that adds | The list of the Backups has Create backup in its header, which opens the workspace of SPEC-0017 and writes nothing by itself, and no other command |
| SPEC-0005 | REQ-057, REST-08, with T4.6 | No surface offers to edit, delete or select a restore | No surface offers to edit, delete or select a restore by itself; Delete backup of SPEC-0017 deletes, through Velero, the restores of the backup it deletes, and its review says so |
| SPEC-0006 | REQ-065, SCHED-02, with T4.2 | A read-only workspace of a schedule | The workspace of a schedule, which reads and offers the commands of REQ-074 as restated here |
| SPEC-0009 | The procedures, with T4.2 | `write.confirm` answers a token or a refusal | For each kind of [the contract](#the-contract), the answer carries the text of the body, as D8 of SPEC-0016 extends it for a Schedule; this lands with T4.2, the first slice, and not with T4.7 as D8 and D12 of SPEC-0016 say |
| SPEC-0013 | The derivation of the offset (REQ-162), with T4.2 | A backup asked by hand is never within a minute of a submission in practice | Back up now makes a backup by hand one command away: one asked within the minute of a submission can mislead the offset derived from the backups of the schedule, a risk the band names when the backup of the last submission is not the only one of that minute |
| SPEC-0016 | D1, with this spec | The spec of T4.3 is reviewed and approved on its own | The spec of T4.3 is the section [Create A Backup](#create-a-backup-t43) of this spec, reviewed and approved with it |
| SPEC-0016 | The restatement of SCHED-11, with T4.2 | SCHED-11 restated with T4.7: nothing selects, edits, deletes, pauses, resumes or runs a schedule | Replaced by the restatement of REQ-074 and SCHED-11 of this table, which T4.2 brings first, T4.5 and T4.4 extend, and T4.7 completes with Create schedule |

The surfaces of the Backups and of the Schedules in DESIGN.md are reworded with the
same pull requests. The list of the Backups gains Create backup in its header, as
the list of the Schedules gains Create schedule. ARCHITECTURE.md, whose adapter is
create-only, gains the two patches of a Schedule with T4.5, as the decision of the
adapter already foresees for the patches of a custom resource, and its list of the
kinds the gate lets through gains each kind with its slice.

## Tests

| Check | Layer | Requirements | Scenario and expected evidence |
| --- | --- | --- | --- |
| ACT-01 | Main contract | REQ-244 | The adapter is asked, for each kind of the contract, the one verb and the one path of the table of [the contract](#the-contract), and nothing else exists: a request of another kind, a PUT, an apply, a DELETE, a PATCH of another kind and a JSON patch that touches a path the kind does not name are refused as invalid before the gate is read, each seen failing when its guard is removed |
| ACT-02 | Main contract/packaged application | REQ-245 | For each kind: with writes off, on for another namespace, without a token, with a token of another frame, an expired one and a used one, the write is refused and nothing is sent; the words of the gate name what the slices landed |
| ACT-03 | Component/main contract | REQ-246 | For each kind, the review shows the text of the confirmation unchanged, and the adapter is asked a body equal byte for byte to it; a change of a field, of the installation and writes turned off drop the review; an expired token is asked again and the run goes on for the same text, and for another the new review replaces the old one and nothing is sent; a request with a field the contract does not know is refused |
| ACT-04 | Unit/domain | REQ-247 | The words of each action read whole, from parameters, reads and a fixed clock, for each field set and not set and for each warning |
| ACT-05 | Unit/domain with a fake clock, component | REQ-248 | The reads after a 201: a phase written, each error as written, no phase after thirty seconds; after a 200 of a patch, the fields read back; the way to the view of the object; never the words of an operation that runs or ended before a phase is read |
| ACT-06 | Main contract/component | REQ-249 | Each code with its stage, its safety and its words, request-failed for a 400, a 401 and a 429, and no body of an answer in any of them; two commands give one write; a cancel before the confirmation sends nothing |
| ACT-07 | Main contract/component/packaged application | REQ-250 | For each kind, a fetch that fails, the deadline, an answer too large, a 503, and a change of the installation, writes turned off and a frame that goes after the request was sent: never a second request; the reads by the rule of each kind find the object as reviewed, created two minutes before the confirmation, with other labels, nothing, and, for a deletion, the backup gone and a request of the collector, each with its end and its words in the workspace and in the target bar |
| ACT-08 | Unit/domain, main contract | REQ-251 | The bodies carry no label and no annotation but the ones the CLI of the release writes for the same action, each named in the review |
| ACT-09 | Component/packaged application | REQ-252 | Each command where the requirement puts it, and nowhere else: no row and no selection of a list acts; each opens its workspace over its view, named in the address; closing it leaves the view as it was; with writes off the form is filled and the review does not open |
| ACT-10 | Pre-review | REQ-253 | Each workspace in both themes, at 900 by 650 and 1440 by 900 and at twice the zoom, with names of 63 characters; each journey by the keyboard alone, Escape in a field and in the confirmation |
| ACT-11 | Packaged application, end to end | REQ-254 | The suites count on the API server the writes of the kinds of Velero for each action, on the CRDs of the release alone: none with writes off, none for a review left, one request of the kind and the verb for one confirmed and no other write, every field of the text reviewed with the same value in the object read; the refusals; the restricted identity; everything created removed. The end to end tests, with the server of the release on the disposable kind cluster, run each action through the procedures of the compiled main process, as a frame does, and read what the controller wrote: a backup from a schedule and one from the form Completed, a restore Completed into its mapped namespace, a pause with no submission and a resume with and without `skipImmediately`, and a DeleteBackupRequest gone with its backup |
| NOW-01 | Component, unit/domain | REQ-255 | The command in the workspace of a schedule, Enabled, paused and FailedValidation, and disabled for a schedule whose name has 64 characters; the name proposed from a fixed clock in UTC, edited, and refused at 217 characters and with capitals, in both processes |
| NOW-02 | Unit/domain, main contract | REQ-256 | The builder against the objects `velero backup create --from-schedule <schedule> -o json` of the release prints on the kind cluster without creating them, kept as goldens: the template as the spec, the labels of the template, an empty map of labels in the template, the labels of the Schedule when the template has none, `velero.io/schedule-name`, the annotations of the Schedule, the owner with `useOwnerReferencesInBackup` true and none without; a schedule whose UID, template, labels or annotations changed after the review ends as a conflict and the adapter is asked no POST |
| NOW-03 | Unit/domain | REQ-257 | The words of the review read whole: asked by hand and moving nothing, the hold of the submissions, the template validated at the start, a paused and a refused schedule, the owner, each label and annotation taken |
| NOW-04 | Main contract | REQ-258 | A 409 ends as conflict with the way to the existing backup and the name of the next second proposed |
| NOW-05 | Component, packaged application | REQ-259 | The phase read after the creation and the way to the view of the backup; in the packaged suite, one POST of a Backup, equal to the text reviewed, with the label of the schedule, and the view of the schedule listing it at its next read; the band of SPEC-0013 naming the risk to the offset when two backups of the schedule share the minute of its last submission |
| CRBAK-01 | Component | REQ-260 | The command in the header of the list of the Backups; the form of the template shared with the creation of a Schedule, the same fields, refusals and words, the storage location always chosen and written |
| CRBAK-02 | Unit/domain, main contract | REQ-261 | The builder, table-driven: every field of the form to its JSON name and type, a field not set absent, no label, no annotation, no status; a field the contract does not know refused |
| CRBAK-03 | Unit/domain, main contract | REQ-262 | Names of 1, 63, 216 and 217 characters, capitals, a leading or trailing `-` or `.`, a name among the backups read, and a 409 that leaves the existing backup unchanged |
| CRBAK-04 | Unit/domain | REQ-263 | The words of the review for each field set and not set, the location, the time to live set and not set, and the three warnings of the template |
| CRBAK-05 | Component, packaged application | REQ-264 | The phases read after the creation, no phase, Queued, ReadyToStart, InProgress and FailedValidation with two errors, and the way to the view of the backup; the words of what Velero writes into the spec; in the packaged suite, one POST of a Backup equal to the text reviewed and no other write |
| RESTORE-01 | Component, unit/domain | REQ-265 | The command in the workspace of a backup and of a schedule; from a schedule its backups listed, the newest Completed chosen first; the name proposed from a fixed clock in UTC, edited and checked in both processes |
| RESTORE-02 | Unit/domain, main contract | REQ-266 | The builder: `backupName` always and `scheduleName` never, `existingResourcePolicy` always written, the cluster-scoped choice as made, a field not set absent, no label, no annotation, no status; a backup whose UID or phase changed after the review ends as a conflict, with no POST |
| RESTORE-03 | Unit/domain, component | REQ-267 | Backups in every phase of the release, each offered or not with its words; a schedule with Completed, PartiallyFailed and Failed backups lists the first two, the newest Completed first, and one with none says so |
| RESTORE-04 | Unit/domain, component | REQ-268 | The list rules of the controller and a resource Velero never restores, refused with its words; the namespaces of a backup that names them, of one with patterns and of one that takes every namespace; mappings with a source the backup includes, one it excludes, one no pattern matches and one under every namespace, a target the host lists and one it does not, a source twice and a target twice, each with its words |
| RESTORE-05 | Unit/domain | REQ-269 | The words of `none` and `update`, of a resource that is the same under each, of the ServiceAccounts and of the namespaces never changed |
| RESTORE-06 | Unit/domain | REQ-270 | The words of the review read whole: the three choices of the cluster-scoped resources, with the volume renamed under a mapping and the priority class, and every namespace; the storage location not Available; the resources never restored; the annotation of the status; the labels; what is not known, with the way to the resources of the backup |
| RESTORE-07 | Component | REQ-271 | The command disabled until the name is typed exactly, enabled then, disabled again by one character more, for every restore; the main process refuses a run with another name and a run with none |
| RESTORE-08 | Component, packaged application | REQ-272 | The phases read after the creation, no phase, InProgress and FailedValidation, and the way to the view of the restore; in the packaged suite, one POST of a Restore equal to the text reviewed and no other write, from a backup and from a backup of a schedule |
| RESTORE-09 | Unit/domain, main contract | REQ-273 | A request that carries any field the form does not offer, the resource policy among them, is refused; the form names them |
| PAUSE-01 | Component | REQ-274 | Pause on a schedule that is not paused, Resume on one that is, never both, in the workspace of the schedule alone |
| PAUSE-02 | Unit/domain, main contract | REQ-275 | The two patches, operation by operation, with the method in capitals and the media type of a JSON patch; `skipImmediately` proposed as the schedule carries it, true, false and absent; a 422 after which the read finds another UID, `paused` or expression ends as conflict, and one after which it finds the schedule as tested ends as validation; the adapter has no other patch |
| PAUSE-03 | Unit/domain with a fake clock | REQ-276 | The words of a pause; of a resume after an instant passed and before, with and without `skipImmediately`, with a `status.lastSkipped` later than the last backup, with a backup of the schedule InProgress, and with an expression the server refuses; the next runs, equal to the ones of the parser of SPEC-0013 |
| PAUSE-04 | Component, packaged application | REQ-277 | The fields read after the patch; in the packaged suite, one PATCH of the Schedule for each action and no other write, the object read paused and then resumed, with `skipImmediately` as chosen |
| DELETE-01 | Component | REQ-278 | The command in the workspace of a backup, for each phase of the release and for none, enabled or disabled with its words |
| DELETE-02 | Unit/domain, main contract | REQ-279 | The request against the one the builder of the release makes for `velero backup delete`, kept as a golden written from its source: the prefix of the generated name, the two labels with a name of 63 characters and one longer, cut as the release cuts it, `spec.backupName`; a backup whose UID changed ends as a conflict, with no POST; a 409 says that nothing was created |
| DELETE-03 | Unit/domain | REQ-280 | The words of what Velero deletes, in its order, of the restores deleted even after a failure, of the other installations that sync the location, of what stays when it fails, and of the refusals of the location |
| DELETE-04 | Component | REQ-281 | The command disabled until the name is typed exactly, enabled then, disabled again by one character more; the main process refuses a run with another name |
| DELETE-05 | Component, packaged application | REQ-282 | The six ends read after the creation, from the request and the backup together: gone with the backup, gone with the backup there, Processed with a refusal, Processed with errors and the backup Deleting, no phase, InProgress; in the packaged suite, one POST of a DeleteBackupRequest equal to the text reviewed and no other write, and no DELETE of anything |
| DELETE-06 | Unit/domain | REQ-283 | The words of a second request for a backup with one waiting |
| DELETE-07 | Component, main contract, packaged application | REQ-284 | No surface offers a deletion of more than one backup or on a row; the adapter has no DELETE |

The homes: the builders and the words in `src/common/`, with their tests beside
them; the procedures in `src/main/`, with the adapter double of the main contract;
the workspaces in `src/renderer/`, with the doubles of the host; the packaged suites
in `e2e/__tests__/`, on the static environment; the end to end proof among the
scripts of `e2e/scripts/`, beside the transport proof.

## Success Criteria

- Each confirmed command writes one object or one patch and nothing else, and every
  field of the text the review showed has the same value in the object in the
  cluster, the fields Velero rewrites when it starts set aside where its controller
  runs: ACT-11 green for each action, with the checks of its section.
- No write without writes on for that namespace and the confirmation, counted on
  the API server; no PUT, no apply, no DELETE of any object, and no PATCH but the
  two of a Schedule, anywhere.
- No deletion of a backup and no restore without the name of the backup typed and
  checked by the main process.
- No workspace says that an operation runs, completed or was deleted before Velero
  wrote it, and none says that a schedule is paused or resumed before the read of
  the Schedule shows it.
- The words of each action and of each warning are read whole by the unit tests;
  the lead maintainer judges them at the review of the milestone, on the screenshots
  of the pre-review.
- The end to end tests, with the server of the release on the disposable kind
  cluster, show for each action what the controller does with the request the
  extension wrote: a backup from a schedule and a backup from the form Completed, a
  restore Completed into its mapped namespace, a schedule paused with no submission
  and resumed with and without `skipImmediately`, and a DeleteBackupRequest Processed
  with its backup gone.
- Failure: a second request after an answer that is not known, a write of a field
  or of an object the review did not show, a label or an annotation of the
  extension, an action on more than one object, or a write outside the disposable
  kind cluster.

No step by hand is needed beyond the review of the milestone.

## Assumptions And Decisions

Each decision below is the one this draft recommends, with its reason and the way
not taken.

- **D1, one spec for the ground rules and five actions.** The actions share their
  workspace, their review, their ends and their reads after the submission; one
  spec states those once, and each action adds only what is its own, in a section
  that is reviewed and tested on its own. This amends D1 of SPEC-0016, which asked
  for a spec of the creation of a backup approved on its own, as
  [the amendments](#the-amendments-the-slices-bring) say. Six specs would repeat the
  rules six times and ask six approvals of the same rules. SPEC-0016 stays as it was
  approved, but for the amendments this spec lists, and its review, its ends and its
  form are the ones this spec generalizes.
- **D2, the review is the confirmation, for every action.** The text the review
  shows is the answer of the confirmation, and the run sends that text: what was
  read is what is sent, as D8 of SPEC-0016 decided for a Schedule.
- **D3, a second gesture for what changes or deletes what exists.** The deletion of
  a backup takes its data from the store; a restore writes into the cluster, and
  even with the policy `none` it merges the ServiceAccounts that exist, creates in
  namespaces that exist, and with the cluster-scoped resources of the backup creates
  objects such as roles and their bindings. The command of a deletion and of every
  restore is enabled only once the name of the backup is typed exactly, and the main
  process checks the name at the run. An exemption for a restore into new namespaces
  only was not taken: whether a namespace exists is what the host lists in the
  renderer, which the main process cannot check, and a list that is not known or is
  stale would let a restore into a namespace that exists through. The way not taken,
  a second dialog, adds a click and proves nothing about what was read.
- **D4, Back up now writes what the CLI of the release writes.** The Backup is made
  from the template of the schedule as `velero backup create --from-schedule` makes
  it: the same name, the same labels, among them `velero.io/schedule-name`, the same
  annotations and the same owner, so that Velero, the adherence of SPEC-0013 and
  the views count it as a backup of the schedule. A Backup made otherwise would be a
  backup the schedule does not know.
- **D5, names known before the request.** A Backup and a Restore have the name of
  the form, proposed as the CLI proposes it and editable, so that a submission that
  is not known is read back by name. A DeleteBackupRequest keeps the name the API
  server generates, as the [architecture](../development/ARCHITECTURE.md#create-only-adapter-decision)
  says, and is found by the labels of its backup.
- **D6, pause and resume as a JSON patch with tests.** The patch tests the UID of
  the schedule, and at a resume that it is still paused, then sets `spec.paused`,
  and at a resume `spec.skipImmediately`: it changes those fields and nothing else,
  and fails when the schedule changed what it tests. A pause tests no `paused`,
  which a schedule that is not paused may not carry, and pausing a paused schedule
  changes nothing. The CLI of
  the release replaces the whole object with an update, which the architecture
  forbids, and clears `skipImmediately` at a pause when its flag is not given; the
  resulting fields are the same for the fields the action names.
- **D7, `skipImmediately` written at every resume.** Proposed as the schedule
  carries it, true when it is true and false otherwise, so that a skip chosen at the
  creation, which REQ-233 of SPEC-0016 promised for the resume, is kept unless the
  operator changes it, and the setting of the server, which the extension does not
  read, never decides, as D4 of SPEC-0016 decided for a new schedule. A pause writes
  only `spec.paused`.
- **D8, the policy for the resources that exist always written.** `none` unless
  `update` is chosen, so that the review names it and the object says it.
- **D9, the fields of a restore in v1.0.0.** The ones of
  [the form of a restore](#the-form-of-a-restore): the scope, the mapping of the
  namespaces, the selectors, the cluster-scoped resources, the volumes and the
  policy. The hooks, the resource modifier, the resource policy, the status
  filters, the uploader configuration, `preserveNodePorts` and the timeout of the
  item operations are not offered, and the form says so; the release takes its
  defaults for each.
- **D10, a restore names its backup.** DESIGN.md asks the restore flow for a
  concrete source by default: a restore is always written with `backupName`, and
  from a schedule the form lists its backups with the newest Completed first. The
  CLI can write `scheduleName`, with which Velero chooses the backup when it starts
  the restore, so that what the review showed may not be what is restored; it is
  not offered.
- **D11, the tests prove the request, and the controller proves the action.** The
  suites of the views run on the CRDs of the release alone with no controller, as
  the direction of 2026-11-06 recorded in SPEC-0015 decided for the views: they
  prove the exact request the extension wrote. What the controller does with each
  request is proven by the end to end tests, with the server of the release on the
  disposable kind cluster, and again in T6.1.
- **D12, the amendments the slices bring.** The ones of
  [the amendments](#the-amendments-the-slices-bring), each recorded under the
  amendments of its spec with the pull request of its slice and approved with this
  spec.
- **D13, a restore only of a backup that ended well.** The controller accepts any
  backup it is given; a backup that has not ended has no files in the store yet, or
  not all of its data, so its restore fails or restores less than the backup will
  hold. The form offers a backup Completed, or PartiallyFailed with its words, and
  says why it does not offer another.
- **D14, the names in UTC.** The CLI of the release names a backup from a schedule
  with the time in UTC and a restore with the local time of its machine; the form
  proposes both with the time in UTC, so that two operators in two zones propose
  names that sort together.
- **D15, an explicit choice of the cluster-scoped resources.** DESIGN.md asks the
  restore flow for an explicit choice of the cluster scope. The form offers three,
  none chosen first: every cluster-scoped resource of the backup, none of them, or
  the ones the restored resources need, which is what Velero does when the field is
  not set; the review says what each takes. Not set, Velero takes every one of them
  when the restore takes every namespace, which a default could hide.

## Open Questions

Two questions of fact, which the source of the release does not settle; neither
needs a decision before the approval, and each has its first step in its slice.

- **The answer to a JSON patch whose test fails (REQ-275).** The tests of the patch
  are applied by the API server, outside the tree of Velero, which as far as is
  known answers a failed test with 422, as it answers a body it refuses. The design
  reads the Schedule after any 422 to a patch, so the end is right either way; the
  slice of T4.5 establishes the answer first, on the test environment, and records
  it.
- **The verbs of the identities of the test environment (REQ-254).** The restricted
  identity of the suites reads the views and may not write. The slice of each
  action establishes that it lacks the verb its action needs, `create` on the kind
  or `patch` on the schedules, and the suites prove the refusal with it.

## Evidence And Deviations

The draft had no implementation, tests or runtime evidence: the facts of the
reviewed release above were read in its source, each at the lines it links; nothing
was run, and no cluster was contacted for it. The evidence of the slices follows.

What this draft could not verify, and what the implementation establishes first:

- The two open questions.
- The namespaces the host lists for a cluster, as SPEC-0016 says for the form of
  the template, which the mapping of a restore offers as targets.
- The words of each action, which the lead maintainer judges at the review of the
  milestone.

T4.2, the first of its pull requests, on 2026-11-08: the backup asked from a
schedule in the main process, with the contract of its write and the words of its
review, and no surface of the renderer yet. The evidence, by check:

- NOW-01, the unit part: the name the command line proposes, `<schedule>-` and the
  time in UTC to the second; a name refused empty, at 217 characters, with capitals,
  and with a `-` or a `.` where a DNS-1123 subdomain has none, each with its words;
  the schedule of 64 characters refused with the words of the label, in both
  processes: the reader of the contract and the confirmation
  (`src/common/backup-from-schedule.test.ts`, `src/common/ipc.test.ts`,
  `src/main/ipc-backup-now.test.ts`).
- NOW-02, ACT-08: the builder against eight goldens that `velero backup create
  <name> --from-schedule <schedule> -o json` of v1.18.4 printed on the kind cluster
  of the suites, without creating them, from schedules placed there for it: a
  template with labels, one with an empty map of labels, one without, the labels of
  the schedule with `velero.io/schedule-name` of another value, its annotations, the
  owner with `useOwnerReferencesInBackup` true and false, and a resource policy;
  kept in `test/backup-from-schedule.goldens.json`. No label and no annotation of
  the extension; a schedule whose UID changed before the confirmation, or whose
  backup is another one at the run, ends as a conflict, and the adapter is asked no
  POST (`src/common/backup-from-schedule.test.ts`, `src/main/ipc-backup-now.test.ts`).
- NOW-03: the words of the review read whole, asked by hand and moving nothing, the
  queue, the hold of the submissions, a restore from the schedule, the validation at
  the start, a paused and a refused schedule, the owner, and each label and
  annotation by its key (`src/common/backup-from-schedule.test.ts`).
- ACT-02, ACT-03: the confirmation refused with writes off, reading nothing; its
  answer the text of the backup, which the adapter is asked byte for byte, once;
  a token that runs only for the name it was confirmed for, and only once, and not
  for another frame, once expired, for another namespace or with writes turned off
  after the confirmation; the same request of the same frame joining the run in
  flight, and no other frame or token given it; a text the answer of the
  confirmation cannot carry confirmed for no token; a request of the contract with
  a field it does not know refused (`src/main/ipc-backup-now.test.ts`,
  `src/common/ipc.test.ts`, `src/main/diagnostic-kubernetes.test.ts`).
- NOW-02 at the run: a schedule whose template, annotations, labels or UID changed
  since the review sends nothing.
- ACT-05, ACT-06, ACT-07, NOW-04: the phase read after the creation, the reads
  stopping at it, none after thirty seconds of reads, and no more read of a backup
  of that name with another UID; a backup of that name already there a conflict; at
  the read and at the creation, each code with its stage, whether asking again is
  safe, and its words: a 404 that is a schedule gone at the read and a namespace or
  a kind not served at the creation, a 403, a 401 said as a credential and as
  request-failed, a 422 of the API server told from a body the adapter would not
  send, a 400 or a 429 request-failed, the deadline, an API server that cannot be
  reached and a write cancelled before anything was sent; a frame that goes while
  the schedule is read again, and writes turned off then, send nothing, and a frame
  that goes after the creation is answered nothing; a creation with no answer, or
  dropped on this side once sent, never sent again, and looked for by its name:
  found as reviewed, with every label of the text, and said as found; not there;
  one of that name made before the confirmation, or without the labels of the
  text, not known to be this one; a creation the API server answered while the
  entry of the cluster changed said as one that may have been made; a creation
  answered with another name or no UID not taken for the backup
  (`src/main/ipc-backup-now.test.ts`, `src/main/diagnostic-kubernetes.test.ts`).

Each new case was seen failing on a change made on purpose: the text not compared at
the run, the UID not read at the confirmation, the name of the backup out of the
signature, any backup of that name taken for the one created, no read after the
creation, the run in flight not joined, and the labels of the template without the
label of the schedule. The independent review of the pull request ran 43 more
changes against the tests and found nine that none killed. The cases added after it
kill eight of them: the UID of the reads after the creation, the name and the UID of
the answer of the creation, the abort before the send, a cancel after it looked for
the backup, the join refused to another frame and another token, the words of a
refusal and of a cluster that changed, the reads stopping at the phase, and the UID
alone changed at the run; the ninth, the label of the schedule checked alone in the
reconciliation, went with the check, since every label of the text, that one among
them, is compared. Sixteen changes of what the review asked were seen failing as
well: the frame before the creation and before its answer, a creation answered while
the cluster changed, the bound of the text in the confirmation and in the reader,
every label of the text, a 422 told apart in the adapter, in the words of the backup
and in the words of a DownloadRequest, a 404 and a 401 by their stage, the safety of
a deadline, the rule of a name in the adapter, and the reader of a schedule of 64
characters and of a backup found.

Decided while implementing, on 2026-11-08:

- The body is the template of the schedule as the API server gives it, with the
  label of the schedule that the builder of the release also sets in the labels of
  the template, which the spec holds: the goldens show it. It leaves out what the
  types of the command line print where the schedule has nothing, the durations of
  `0s`, the empty objects and a null `apiGroup`, which the release reads as not set;
  NOW-02 compares the builder with the goldens without them.
- The text is written with two spaces, the keys of an object first in their usual
  order, then the others by their characters, so that the same body is the same
  text whatever the order the API server gave.
- A 422 of the API server is validation for every write, the DownloadRequests of the
  tabs included, as the way of a write says: before, it was request-failed.
- A creation dropped on this side after its request left, by the frame that went or
  the deadline, is looked for as one with no answer; one dropped before it left
  sends nothing and says so.
- The frame that asked is looked at right before the creation and before its answer,
  as for the other writes, and not only at the tick of its watch.
- The text of a body travels in the answer of its confirmation, which is within the
  bound of a request: the main process refuses, with words and before it gives a
  token, a text that answer cannot carry, written as JSON, with a kilobyte of the
  bound left to the rest of it.
- A creation the API server answered while the entry of the cluster changed is
  submission-unknown, with words that say it may have been made, and is not looked
  for: the adapter asks nothing more of a cluster that changed.
- A backup found by its name after a lost answer carries every label of the text,
  the label of the storage location that Velero adds aside, and is answered as
  found, which the views say.
- The reads of the backup looked for after a lost answer are not stopped by a
  cancel, writes turned off or the frame that went: they are reads, bounded by the
  time of each read and by the thirty seconds of the reads after the creation.
- The thirty seconds of the reads after the creation bound a read that hangs as
  well.
- A 401 says the credential and is request-failed, as ACT-06 asks; asking again is
  safe where nothing was sent, after the deadline, an API server that cannot be
  reached or a write cancelled before its creation.
- The durations of the template are sent as the API server gives them, `720h`
  where it gives `720h`, which the command line prints `720h0m0s`: Velero reads them
  alike, and NOW-02 compares the builder with goldens printed from schedules that
  wrote them whole.
- The cell of the last maintenance of a repository is checked by the packaged suites
  against every second of the window it was read in, and not only its two ends: a
  window of several seconds failed in CI on 2026-11-08 with a time between them.
- What the next pull requests of T4.2 bring: the workspace of the action, the command
  in the view of a schedule and the words of the gate (REQ-245, REQ-252, REQ-253,
  NOW-01 and NOW-04 in the renderer); the end kept for the cluster and said in the
  target bar (REQ-250); the packaged suites and the end to end proof (ACT-11,
  NOW-05).
