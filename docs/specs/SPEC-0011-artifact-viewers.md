# SPEC-0011: The Log, The Results, The Resources And The Volumes Of An Operation

- **Status:** Draft
- **Date:** 2026-09-30
- **Milestone / tasks:** M3 / T2.3
- **Reviewed Velero:** v1.18.2, `c253c7fe37d78c9b7e55c68544f7c5b2608712d8`; compared with v1.18.4, `4ee1e79a7aed367fd9b767b8219ec65bd0c96892`
- **Reviewed main:** `e5d9354ddf7607e0bad3ebc7744a4964c24b489a`
- **Freelens validation target:** v1.10.3, `3da74415bff57a77c6e08cb5f538191ce87bac17`
- **Dependencies:** [the write gate](SPEC-0009-write-gate.md), [the request and its transport](SPEC-0010-diagnostic-request-and-transport.md), [states and Backups](SPEC-0003-backup-read-only.md), [Restores](SPEC-0005-restore-read-only.md)
- **Approval:** Pending

Governed by [AGENTS.md](../../AGENTS.md).

## Goal

In the workspace of a backup and of a restore the operator reads what Velero
wrote of the operation into its storage, the log, the results, the list of the
resources and the volumes, each asked for on purpose, each with the search and
the filters its size asks for, and each state before, during and after the load
said in words.

## Scope Baseline

The formats are the ones of the reviewed release, read in its source and
recorded in the
[recon](../development/RECON-T0.1.md#start-of-the-third-milestone-2026-09-30):
the log is the text of the server, one entry a line with its time, its level,
its message and its fields, or JSON when the server is started so; the results
are one object of two keys, `errors` and `warnings`, each with the messages of
Velero, of the cluster and of each namespace, each message in the form the hook
of the server gives it; the resource list is a map from a resource, written as
its API version and its kind, to its items, with the action of the restore after
each item; the volume information is a list of the volumes with their method,
their result and their details. What is written when is there as well: nothing
for an operation that failed its validation, everything at the end of the work,
the log of a backup best effort, and for a backup that failed at work what was
written before it failed.

Included: four tabs in the workspace of a backup and in the one of a restore,
beside the summary that exists; the states of a tab; the words of a file the
store does not have, by the phase of the operation; the saving of an artifact
to a file the operator chooses. Excluded, with their owners: the contents of a
backup, never; the snapshots and the operations of the items, not in v1.0.0; the
details the host shows of a kind, which get no tab and lead to the workspace.

## User Scenarios

1. **P1, the log:** Given the real backup of the demo and writes on, when the
   operator opens the Log tab, confirms the request and the log arrives, then
   the lines are there with their numbers, a search finds its matches and moves
   among them, and the levels filter the lines, with the count of each.
2. **P1, the results:** Given a backup whose results carry errors of two
   namespaces and a warning of Velero, when the Results tab is loaded, then the
   errors come first, then the warnings, each by Velero, cluster and namespace,
   with the counts, and the tab says when the counts of the status differ.
3. **P1, the resources:** Given the real restore of the demo, when the
   Resources tab is loaded, then the resources are grouped by their API version
   and kind, each item with the action of the restore, the counts by action,
   and a filter narrows them.
4. **P1, the volumes:** Given a backup whose volume information has a native
   snapshot, a pod volume, a CSI snapshot and a skipped volume, when the
   Volumes tab is loaded, then each is a row with its method, its result, its
   size and its details, and a restore with no volume says that Velero
   recorded none.
5. **P1, nothing written:** Given a backup that failed its validation, when its
   Log tab is loaded, then the store has no such file and the tab says that
   Velero writes nothing for an operation that failed its validation; for a
   backup at work, that the log is written when the work ends; for a restore
   Velero refused without choosing a backup, that there is nothing to ask for.
6. **P1, before and during:** Given writes off, when a tab opens, then it says
   what it would create and how to turn writes on; with writes on, the command
   in the name of the kind, then the object to confirm, then the steps of the
   load with a way to cancel.
7. **P2, a large log:** Given a log of two hundred thousand lines, when it is
   searched and filtered, then the answer comes within the budget and the
   scroll does not stall.
8. **P2, keyboard and themes:** Given the tabs, when the operator moves among
   them with the arrows and searches with Enter and Shift with Enter, then the
   focus is where the words say, in both themes, at 900 by 650 and at twice the
   zoom.

## Requirements

| ID | Contract | Acceptance check |
| --- | --- | --- |
| REQ-138 | The workspace of a backup and the one of a restore have the tabs Summary, Log, Results, Resources and Volumes, in that order, Summary first and open. The tab that is open is in the address. Opening a tab creates nothing and asks nothing. Each tab keeps one artifact, the last it loaded, for as long as the view is open, and drops it when the view closes, when the installation changes or when it loads again; the summary is what it is today | VIEW-01 |
| REQ-139 | The first state of a diagnostic tab says what it would create, a DownloadRequest of that kind for that target in that namespace of that cluster, and the state of the gate. With writes off it shows the way to the target bar and no other command; with writes on, the command in the name of the kind; after it, the inline confirmation of SPEC-0009 with the object; after that, the load | VIEW-02 |
| REQ-140 | During the load the tab shows the step it is at, read from the main process every 250 milliseconds, the request created with its name, the wait for the URL, the download with the bytes so far, the decompression, the pages taken, and a command that cancels. After it, the content, when it was loaded, its size, the way it came by, in the words of SPEC-0010, and the command that loads it again, which is a new request | VIEW-03 |
| REQ-141 | Each way a load ends is said in the words of its code, with the command to try again where it is safe. A file the store does not have is said by the phase of the target: for FailedValidation, that Velero writes nothing for an operation that failed its validation; for an operation that did not start or is at work, that the file is written when the work ends; for one that ended, that the file is not in the storage, and for the log of a backup that its upload is best effort; for one that failed at work, that Velero may have written its files before it failed, or none if it failed before writing; for one being deleted, that its files are being removed. A restore that names no backup, and a backup whose storage location is not there, are said before any request, in the words of SPEC-0010. No state claims more than the phase says | VIEW-04 |
| REQ-142 | The Log tab shows the lines with their numbers, at most a hundred rows mounted, each line whole with a choice to wrap; a search that is not sensitive to case, with the count of the matches, the current one marked, and the way to the next and the previous; a filter by level, error, warning, info, debug and other, with the count of each, parsed at the start of the line from `level=` of the text, where the level of a warning is written `warning`, or from `level` of the JSON, a line without a level being other; no line hidden until a filter is chosen; a line longer than ten thousand characters cut in its row and whole in the copy | VIEW-05 |
| REQ-143 | The Results tab shows the errors then the warnings, each by Velero, cluster and namespace, the namespaces by name, each message as the hook of the server wrote it, its resource, its name, its message and its error told apart, with the count of each group and of the whole; an artifact with neither says that Velero recorded no error and no warning for the operation. When the count of the artifact differs from the counter of the status of the object, the tab says both, and why they can differ: the errors of a backup grow with the operations of its plugins after the file was written, and the results of a restore are written again when it is finalized | VIEW-06 |
| REQ-144 | The Resources tab shows the resources by their API version and kind, as `v1/Pod` or `apps/v1/Deployment`, sorted, each with its items sorted, the count of each and of the whole, a filter on the resource, the namespace and the name; for a cluster-scoped item the namespace column says cluster. For a restore the action after each item, created, updated, failed or skipped, is a column, with the count of each and a filter by action; an item without an action, or with one the release does not write, keeps its text and is counted as not stated | VIEW-07 |
| REQ-145 | The Volumes tab shows one row for each volume: the claim with its namespace, the volume, the method, the result of a backup or the way of a restore, whether the data was moved, whether the local snapshot was kept, whether it was skipped and why, the start and the end, and the size read from the detail the entry carries; and the details, of the CSI snapshot, of the data movement, of the native snapshot, of the pod volume, and of the volume itself, each field by its name, the ones the release writes without a JSON name, `ReadyToUse` and `Phase`, by that name. A method or a result the release does not write keeps its text with the mark of what is not known; an empty list says that Velero recorded no volume; a field the tab does not know is shown by its name and its value | VIEW-08 |
| REQ-146 | An artifact is text of 64 MiB at most, the bound of SPEC-0010, taken in pages and held once in the renderer. A JSON artifact is parsed by a pure function that checks the shape of the release; one that is not of that shape is shown as text, with the note that its shape is not the one the extension was written for, and nothing crashes. The parsing and the search are bounded in memory: the renderer holds one copy of the text, and the indexes it builds, and no other | VIEW-09 |
| REQ-147 | On a log of 200,000 lines, a search and a filter answer within 250 milliseconds at the 95th percentile of twenty warm interactions, and a scroll draws each frame within 50 milliseconds, measured in the packaged application on the synced backup of the fixtures; the parser and the search are measured as well on 500,000 lines made for the unit tests, within the same budget | VIEW-10 |
| REQ-148 | The tabs write nothing to the cluster but the request. The command that saves an artifact asks the main process, which opens the dialog of the host for a file the operator chooses and writes there the text it holds for the view, and nowhere else: a write to this machine, outside the gate of the cluster, and the only file the extension writes | VIEW-11 |
| REQ-149 | Both themes, a window of 900 by 650 and twice the zoom; the tabs a list of tabs, moved among with the arrows, Home and End, each tab saying whether it is selected; the search field labelled, its count told to who does not see, Enter and Shift with Enter for the next and the previous match; the focus on the first line of the content after a load, and back on the command after a failure | VIEW-12 |
| REQ-150 | The section the host shows in the details of a backup and of a restore does not load an artifact: it says that the log, the results, the resources and the volumes are in the workspace, and leads there | VIEW-13 |
| REQ-151 | The packaged application loads the four artifacts of the real backup and of the real restore of the demo, and the four of the backup synced from the store, whose artifacts are made for the tabs: a log of 200,000 lines of many levels and long lines, results with errors of two namespaces in the form of the hook, a resource list of many resources, volumes of every method; and the operations that failed their validation | VIEW-14 |

## Design

- **Standard or ad hoc view, and why.** The tabs have the shape of the ones the
  pages of the host have, in the workspace of the extension that exists: the
  operator who opened a backup to see why it failed finds its log one tab away,
  and the summary does not move. Each viewer is made for its format: a log is
  lines, and needs a search and the levels; the results are groups of messages,
  and need their counts and their places; the resources are a map, and need a
  filter; the volumes are a table with details. A raw JSON in a box would show
  the same bytes and answer none of the questions.
- **Safety.** The only write to the cluster is the request, through the gate of
  SPEC-0009 and the service of SPEC-0010. The tabs hold the text in the renderer
  for the life of the view, and nothing of it in the store. The command that
  saves is done by the main process, into the file the operator chose in the
  dialog of the host. The section in the details of the host writes nothing and
  loads nothing.

The tab strip is built on the tabs of the host, `Tabs` and `Tab` of its
components, which give a tab its role and its activation with Enter and Space;
the extension adds what they lack for a list of tabs, the role of the list,
whether a tab is selected, and the arrows, Home and End. The tab that is open
is one parameter of the address, `tab`, beside the views, so that a page opened
again shows the same tab, with its content not loaded until it is asked. The
state of a tab is one of: first, confirming, loading with its step, loaded,
failed with its code, and each has its words in one place,
`src/common/artifact-text.ts`, beside the words of SPEC-0010.

| Tab | Parser | What it computes once for a load |
| --- | --- | --- |
| Log | `src/common/artifact-log.ts` | The lines, with their offsets; the level of each, from the start of the line; the index of the search is built on demand and kept |
| Results | `src/common/artifact-results.ts` | The two groups, their places, each message in its parts, the counts |
| Resources | `src/common/artifact-resources.ts` | The resources and their items, the action of each item of a restore, the counts |
| Volumes | `src/common/artifact-volumes.ts` | The rows and their details, with what is not known marked |

The parsers are pure functions on the text, tested on the artifacts the
fixtures write and on artifacts made for each rule. The viewers are components
that take what the parsers give: the lines of the log in the virtual list of
the host, the results as headed lists, the resources and the volumes as tables
of the host.

The words of a file the store does not have come from the phase of the target
as the [states](../../src/common/phases.ts) read it: the tab reads the object it
is of, which the view already has.

The fixtures of the tabs are a backup synced from the store. The fixtures of
the views write into the bucket of the demo, with the credentials of the
environment, what the sync of the release needs to create a backup it does not
have: the metadata `velero-backup.json` of a backup in a phase that ended,
Completed, with an expiration far ahead, and its four artifacts made for the
rules above; and an empty, valid archive of its contents, because the deletion
of a backup downloads the archive before it removes anything and treats a
missing one as permanent only by its error. The sync of the release creates
the backup in the namespace of the installation at its next pass, within a
minute, when the location is available: it writes the namespace and the label
of the location and keeps the other labels of the metadata, which carry the
run. A second synced backup has no log, for the case of a best-effort upload
that was lost. A backup and a restore that fail their validation are created in
the namespace of the installation, for naming both kinds of selector, so that
their backup and their location stay valid and a URL is signed for them; a
restore asked from a schedule that has no backup is created there too, and is
refused without a backup name. These are the first fixtures in the namespace
of the installation: they are labelled with the run and removed by the cleanup
of the fixtures, the synced backups through their DeleteBackupRequest, which
removes their files from the store with them.

## Tests

Planned homes: unit tests of the four parsers and of the words; component tests
of the tab strip, of the states and of each viewer; the suites of the views in
the packaged application against the demo, with the fixtures above; the
pre-review with the tabs open. The guard of the suites, which compares the
objects of Velero before and after, learns the requests a suite asked for by
their names and expects no other write.

| Check | Layer | Requirements | Scenario and expected evidence |
| --- | --- | --- | --- |
| VIEW-01 | Component/packaged | REQ-138 | The five tabs in order; the tab in the address; opening a tab asks nothing, counted on the API server; one artifact kept for a tab while the view is open, dropped when it closes, when the installation changes and when the tab loads again |
| VIEW-02 | Component/packaged | REQ-139 | The first state with writes off and on; the command in the name of the kind; the inline confirmation with the object |
| VIEW-03 | Component/packaged | REQ-140 | Each step during the load, read from the main process, the cancel, the loaded state with its size and its way, the load again as a new request |
| VIEW-04 | Unit/component/packaged | REQ-141 | Each code with its words; a missing file for each phase; in the packaged application the backup and the restore that failed their validation, and the restore without a backup name |
| VIEW-05 | Unit/component/packaged | REQ-142 | The lines and the levels of a text log and of a JSON log, `warning` read as a warning, a message that carries `level=` in its words; a search with matches, none, the next and the previous; a line without a level; a line of twenty thousand characters; a hundred rows mounted at most on the synced log |
| VIEW-06 | Unit/component/packaged | REQ-143 | Errors and warnings of the three places, each message in the form of the hook and in its parts, the counts; both empty; a count that differs from the status, with its reason |
| VIEW-07 | Unit/component/packaged | REQ-144 | Resources of a backup and of a restore by API version and kind, the four actions, an item without one, cluster-scoped items, the filters |
| VIEW-08 | Unit/component/packaged | REQ-145 | The four methods with their details and the size read from each, a skipped volume with its reason, a kept local snapshot, the fields written without a JSON name, an unknown method, an empty list, an unknown field |
| VIEW-09 | Unit | REQ-146 | A JSON of another shape shown as text with the note; the pages assembled into one text and no second copy; the bound of the size |
| VIEW-10 | Unit/packaged | REQ-147 | The times of the search, of the filter and of the scroll on the synced log of 200,000 lines, twenty interactions after five warm; the parser and the search on 500,000 lines in the unit tests |
| VIEW-11 | Component/packaged | REQ-148 | The save asks the main process, which opens the dialog of the host and writes the file chosen; the API server counts no write but the request |
| VIEW-12 | Pre-review | REQ-149 | The tabs and the viewers in both themes, at the two sizes and at twice the zoom; the journeys with the keyboard alone; the list of tabs with its roles; the focus after a load and after a failure |
| VIEW-13 | Component/packaged | REQ-150 | The section of the host with its words and its way to the workspace, and no load |
| VIEW-14 | Packaged | REQ-151 | The four artifacts of each of the three operations loaded, and their content checked against what the fixtures wrote |

## Success Criteria

All 14 checks pass before this spec is Verified. The log of the real backup is
read in the packaged application on the demo with the search and the filters,
and no artifact is fetched that was not asked for.

Manual review: on the demo, open the real backup, load its log, search for
"completed", filter the warnings, then open its results and its resources;
open the backup that failed its validation and load its log. Expected: the
viewers answer the questions of the review of a failed backup without a
terminal, and the missing file is explained by the phase, not by a fault of the
storage. Record role, date and verdict.

## Assumptions And Decisions

- **The artifact is delivered to the renderer in pages and parsed there**, by
  pure functions, within the bound of 64 MiB: the main process stays a
  transport that holds one copy for the view, and no message between the
  processes carries the whole text. A viewer that asked the main process for
  lines and matches would keep the parsing there, which is the part the tests
  of the components exercise.
- **Nothing is hidden by default.** A filter by level is a choice of the
  operator; the log shows every line until then.
- **The counts of the status and of the artifact may differ**, and the tab says
  it when they do, with the reason the release gives, rather than choosing one.
- **The details the host shows get no tab.** They are a section of the host, in
  a drawer of the host with its own commands; the workspace is where the
  extension shows what it asked Velero for.
- **The synced backup is the fixture of the tabs**, because it is what a real
  installation shows of a backup made elsewhere: the store is the source, the
  object is what the sync wrote from it, and its artifacts are what the tabs
  read. The operations that fail their validation are real refusals of the real
  controller, for a reason that keeps their backup and their location valid.
- **One artifact for each tab.** Two workspaces of four tabs could otherwise
  hold eight texts of 64 MiB in the renderer; a tab that loads again drops what
  it had.

## Evidence And Deviations

Initially: no implementation, tests or runtime evidence.
