# SPEC-0011: The Log, The Results, The Resources And The Volumes Of An Operation

- **Status:** Approved
- **Date:** 2026-09-30
- **Milestone / tasks:** M3 / T2.3, in three pull requests
- **Reviewed Velero:** v1.18.2, `c253c7fe37d78c9b7e55c68544f7c5b2608712d8`; compared with v1.18.4, `4ee1e79a7aed367fd9b767b8219ec65bd0c96892`
- **Reviewed main:** `e5d9354ddf7607e0bad3ebc7744a4964c24b489a`
- **Freelens validation target:** v1.10.3, `3da74415bff57a77c6e08cb5f538191ce87bac17`
- **Dependencies:** [the write gate](SPEC-0009-write-gate.md), [the request and its transport](SPEC-0010-diagnostic-request-and-transport.md), [states and Backups](SPEC-0003-backup-read-only.md), [Restores](SPEC-0005-restore-read-only.md)
- **Approval:** Approved by the lead maintainer on 2026-09-30, as drafted

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
[recon](../development/RECON-T0.1.md#start-of-the-third-milestone-2026-09-30),
and read again
[with the tabs](../development/RECON-T0.1.md#with-the-tabs-of-an-operation-2026-10-05):
the log is the text of the server, one entry a line with its time, its level,
its message and its fields, or JSON when the server is started so; the results
are one object of two keys, `errors` and `warnings`, each with the messages of
Velero, of the cluster and of each namespace, the messages of a backup each in
the form the hook of the server gives an entry of its log, the ones of a restore
as the texts the restore code writes; the resource list is a map from a
resource, written as its API version and its kind, to its items, with the action
of the restore after each item; the volume information is a list of the volumes
with their method, their result and their details. What is written when is there
as well: nothing for an operation that failed its validation, everything at the
end of the work, the log of a backup best effort, and for a backup that failed
at work what was written before it failed.

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
| REQ-143 | The Results tab shows the errors then the warnings, each by Velero, cluster and namespace, the namespaces by name, each message as it is written, and a message in the form the hook of the server gives, which the ones of a backup have, with its resource, its name, its message and its error told apart, with the count of each group and of the whole; an artifact with neither says that Velero recorded no error and no warning for the operation. When the count of the artifact differs from the counter of the status of the object, the tab says both, and why they can differ where the release explains it: the operations of the plugins of a backup or of a restore add their errors to its status after the file was written, so that the status can count more errors; and while a restore is finalized what the finalization finds is added to its results before its status is written, so that the results can count more. Of any other difference the tab says both counts and names no reason | VIEW-06 |
| REQ-144 | The Resources tab shows the resources by their API version and kind, as `v1/Pod` or `apps/v1/Deployment`, sorted, each with its items sorted, the count of each and of the whole, a filter on the resource, the namespace and the name; for a cluster-scoped item the namespace column says cluster. For a restore the action after each item, created, updated, failed or skipped, is a column, with the count of each and a filter by action; an item without an action, or with one the release does not write, keeps its text and is counted as not stated | VIEW-07 |
| REQ-145 | The Volumes tab shows one row for each volume: the claim with its namespace, the volume, the method, the result of a backup or the way of a restore, whether the data was moved, whether the local snapshot was kept, whether it was skipped and why, the start and the end, and the size read from the detail the entry carries; and the details, of the CSI snapshot, of the data movement, of the native snapshot, of the pod volume, and of the volume itself, each field by its name, the ones the release writes without a JSON name, `ReadyToUse` and `Phase`, by that name. A method or a result the release does not write keeps its text with the mark of what is not known; an empty list says that Velero recorded no volume; a field the tab does not know is shown by its name and its value | VIEW-08 |
| REQ-146 | An artifact is text of 64 MiB at most, the bound of SPEC-0010, taken in pages and held once in the renderer. A JSON artifact is parsed by a pure function that checks the shape of the release; one that is not of that shape is shown as text, with the note that its shape is not the one the extension was written for, and nothing crashes. The parsing and the search are bounded in memory: the renderer holds one copy of the text, and the indexes it builds, and no other | VIEW-09 |
| REQ-147 | On a log of 200,000 lines, a search and a filter answer within 250 milliseconds at the 95th percentile of twenty warm interactions, and a scroll draws each frame within 50 milliseconds, measured in the packaged application on the synced backup of the fixtures; the parser and the search are measured as well on 500,000 lines made for the unit tests, within the same budget | VIEW-10 |
| REQ-148 | The tabs write nothing to the cluster but the request. The command that saves an artifact asks the main process, which opens the dialog of the host for a file the operator chooses and writes there the text it holds for the view, and nowhere else: a write to this machine, outside the gate of the cluster, and the only file the extension writes | VIEW-11 |
| REQ-149 | Both themes, a window of 900 by 650 and twice the zoom; the tabs a list of tabs, moved among with the arrows, Home and End, each tab saying whether it is selected; the search field labelled, its count told to who does not see, Enter and Shift with Enter for the next and the previous match; the focus on the first line of the content after a load, and back on the command after a failure | VIEW-12 |
| REQ-150 | The section the host shows in the details of a backup and of a restore does not load an artifact: it says that the log, the results, the resources and the volumes are in the workspace, and leads there | VIEW-13 |
| REQ-151 | The packaged application loads the four artifacts of the real backup and of the real restore of the demo, and the four of the backup synced from the store, whose artifacts are made for the tabs: a log of 200,000 lines of many levels and long lines, results with errors of two namespaces in the form of the hook, a resource list of many resources, volumes of every method of a backup and one that was skipped; and the operations that failed their validation | VIEW-14 |

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

The fixtures of the tabs are two backups synced from the store. The fixtures of
the views write into the bucket of the demo, with the credentials of the
environment, what the sync of the release creates a backup from, and what its
deletion and the tabs read: for each backup an empty, valid archive of its
contents, its artifacts, and last the metadata `velero-backup.json` of a backup in
a phase that ended, with an expiration far ahead. The archive is there because the
deletion of a backup downloads it before it removes anything, treats a missing one
as permanent only by its error, and stops on one it cannot read. The first backup
failed in part, as a backup whose results hold errors does, and its four artifacts
are made for the rules above. The second completed, is the backup of no item, and
has no log, for the case of a best-effort upload that was lost. The sync of the
release creates each backup in the namespace of the installation at the first of
its passes, which are a minute or two apart, that comes after the files, when the
location is available: it writes the namespace and the location, into the spec
and into a label, and keeps the other labels of the metadata, which carry the run.
A backup and a restore that fail their validation are created in the namespace of
the installation, for naming both kinds of selector, so that their backup and
their location stay valid and a URL is signed for them; a restore asked from a
schedule that has no backup is created there too, and is refused without a backup
name. These are the first fixtures of the views in the namespace of the
installation, where the transport proof creates and removes its own: they are
labelled with the run and removed by the cleanup of the fixtures, the synced
backups through their DeleteBackupRequest, which removes their files from the
store with them.

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
| VIEW-06 | Unit/component/packaged | REQ-143 | Errors and warnings of the three places, a message in the form of the hook in its parts and one of a restore as the text it is, the counts; both empty; a status that counts more errors, of a backup and of a restore, with the reason of the plugins; a restore that is being finalized whose results count more, with its reason; a count that differs in another way, with no reason named |
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

Approved on 2026-09-30, as drafted. The task of the spec, T2.3, is three pull
requests, which the [roadmap](../development/ROADMAP.md#m3---logs-and-diagnostics)
names: the tabs, their fixtures, and the suites on those fixtures. Each has its
evidence here, and the spec is Implemented with the last of them.

### The Tabs, The First Pull Request Of T2.3

Implemented by 2026-10-05. The code of the tabs and its unit and component tests
had an independent review: what was applied of its findings is in the code and in
its tests, and what was left of them that is of the tabs is among the decisions,
the limits and the open points below. After that review the pictures the suite of
the tabs leaves were looked at, for the layout and the themes and for the words
and the states: what that changed of the words and of the states has its unit and
component tests, what it changed of the layout is measured by the suite in the
packaged application, where alone it is laid out, or seen in its pictures, and
what it left is among the limits and the open points below. The
[words](../../src/common/artifact-text.ts) of the tabs and the parsers of the
[log](../../src/common/artifact-log.ts), of the
[results](../../src/common/artifact-results.ts), of the
[resources](../../src/common/artifact-resources.ts) and of the
[volumes](../../src/common/artifact-volumes.ts) are pure functions; the
[load](../../src/renderer/state/artifact-load.ts) of one artifact and the
[loads](../../src/renderer/state/artifact-loads.ts) of the view that is shown are
held by the installation; the
[strip](../../src/renderer/components/workspace-tabs.tsx) is built on the tabs of
the host, and the tab that is open is written into the address by the
[navigation](../../src/renderer/navigation.ts); the
[panel](../../src/renderer/components/artifact-panel.tsx) shows where a load is
and gives its text to the viewer of the tab; the
[lines](../../src/renderer/components/artifact-lines.tsx) of a text are in the
virtual list of the host; the main process
[saves](../../src/main/artifact-save.ts) the text it holds, through a
[procedure](../../src/main/ipc.ts) of its own.

This pull request is the tabs, their unit and component tests, and a first suite
in the packaged application, on the real backup and the real restore of the test
environment. Every check whose packaged layer needs the fixtures is open at that
layer, and REQ-151 and the packaged part of REQ-147 are open.

The suite of the tabs is
[`velero-e2e-artifacts`](../../e2e/__tests__/velero-e2e-artifacts.tests.ts), 38
cases and 9 that are written as waiting. It turns writes on in the target bar, as
the operator does, and asks the extension for nine DownloadRequests in the
namespace of the installation, each through the gate after its confirmation: the
four artifacts of the restore, the four of the backup, and the log of the backup a
second time. A tenth load is cancelled. The guard of the suites is told the name
the tab gave each request, the suite reads each in the cluster by that name and
counts on the API server what was asked of them, and it deletes none: it waits,
before it ends, for the server to remove them, which the release does once the ten
minutes it writes into a request have passed, as the
[recon](../development/RECON-T0.1.md#start-of-the-third-milestone-2026-09-30)
records. What the tabs say in numbers and in names, as the request a load runs,
the bytes of a text and the counts of a log, of results and of a resource list,
they write as attributes beside their words, which the suite reads and the tests
of the components pin. What each case proved is in the table below, check by
check. The suite leaves pictures, of the tabs in both themes at 1440 by 900, and
of the four loaded tabs of the backup and of a confirmation at 900 by 650 and at
twice the zoom, and reports, of the layout, of the rooms at each size, of the
steps of the loads and of the requests, beside the ones of the other suites. In
two local runs of the twelve suites of the views on 2026-10-05, one after the
other, every case passed in both: 150 cases, beside 9 that wait, of which 38 and 9
are of the tabs. In both the suite of the tabs ran first, which proves that the
eleven others pass on the cluster it leaves, and not that it passes after another
suite that creates requests: it refuses to start, and names them, when the cluster
holds a request to Velero.

The real backup and the real restore of the test environment are small and plain.
In those runs the log of the backup was 271 lines, every one at the level info,
and the one of the restore 108 lines, at info and at warning; the results of both
held no error and no warning; the resource list of each was thirteen items of one
resource, `v1/ConfigMap`; and Velero recorded no volume for either. No load was
shown for as long as a second, and the cancel landed before anything was created.
What the suite proves on them is said check by check, and so is what it does not
prove: what needs the artifacts made for the tabs is left to the fixtures of the
second pull request and to the suites of the third, and the cases that wait are
said below by what they wait for.

| Check | Evidence of this pull request | Left |
| --- | --- | --- |
| VIEW-01 | Component: the five tabs in their order, as a list of tabs that says which one is selected, the summary first and open, with everything the workspace showed before under it; the tab that is chosen written into the address with one change of it, the summary as no tab in the address, a view that becomes the one shown at its summary, and the tab an address names shown with nothing of it loaded; a tab opened with writes off and with writes on asks the main process nothing and creates nothing; one load for each tab, the same one while the view is shown, dropped in both processes when the view closes, when another view is shown, when the installation changes, when another object took the place of the operation under its name, and when the tab creates its next request. Packaged, on the real backup and the real restore: the five tabs in their order, in a list of tabs named for the operation, each saying whether it is selected and which part it shows, the summary open and no tab in the address; each tab, once it is chosen, the one that is selected, the one the part is named by and the one the address names beside the view; a tab opened by its address, a page opened again at the tab it was at with nothing of it loaded, and a name that is no tab shown as the summary; every tab opened with writes on, by a click and by its address, and the view closed and opened again, with nothing of a DownloadRequest counted by the API server, created or read, and no read of a family for the tabs opened by a click; what each tab loaded kept while the other tabs were shown, and nothing of it held once the view was closed and opened again; a tab that loads again showing the text of its new request | Packaged: what a tab holds when the installation changes, in a case of the suite that waits and needs no fixture the environment does not have |
| VIEW-02 | Unit: what a tab would create, in words, with the kind of the request, its target, named once, its namespace and its cluster, and that nothing is created before the request is shown and confirmed. Component: the first state with writes off, with writes whose state is not known, with no way to the main process and when the main process refused to turn them on, each saying the state of the gate first and apart, then giving the way to the target bar and no other command, or none, then what the tab would create; with writes on, one command in the name of the kind of the request and of the artifact, which asks nothing until it is given; the inline confirmation with the object as it will be submitted, its name in words, its labels, its spec and its target, and nothing created before the second gesture; the confirmation left with its second command, with Escape, when writes go off and when its tab is left. Packaged, on the eight tabs of the real backup and the real restore: with writes off, the state of the gate, then the way to the target bar, which is the one command of the tab and leads to the command that turns writes on, then what the tab would create; with writes on, the one command in the name of the kind. On the Log tab of each: the confirmation reached with the keyboard alone and given the focus, with the object as it will be submitted, one press of the Tab key to the command that creates and one more to the one that leaves, and left with that command and with Escape, the focus back on the command of the tab and the view at its tab; nothing of a DownloadRequest counted for any of it | Nothing that waits for the fixtures |
| VIEW-03 | Unit, in the main process: the bytes of the text that arrived so far said at the step of the download, counted from the beginning of the text, and a download that goes on whatever hears of them. State and component: the request run with the token of its confirmation, a confirmation that expired asked again once at the second gesture, the step the main process is at asked every 250 milliseconds and said in words, beside the mark of the host that moves, the first step in words that claim no wait, the request named from its creation on, the seconds of the wait, the bytes of the download and the pages as they are taken; the load cancelled at every step it is offered at; nothing taken of an answer that arrives after the load was dropped, left or begun again; the text with, over it, when it was loaded and its size and the two commands, the one that loads it again and the one that saves it, and under it the request it came through, the way it came by, through the cluster or directly, encrypted or not, and from which origin, what loading again does and until when the text can be saved; a load again as another request, through its confirmation, with the text shown until that request is created and what that takes away said under it meanwhile. Packaged, on the nine loads of the suite: each a request of its own, created at the second gesture, which the cluster holds by the name the tab gave it, with the text, when it was loaded, its size, the request it came through and the way it came by, through the tunnel; on the two loads of the log of the backup, the confirmation, then the load, then the text, no text while the load runs, and the request known by the name it has in the cluster from the first step of the load; on the first of them, the wait for a place first and the pages last, and between them what the main process told, in its order; the wait for the URL, which only the main process tells, shown in every load of the suite, as its report of the steps says; the log loaded again as another request, the text of before shown under the confirmation and gone at the second gesture; a load cancelled as soon as the command was offered, ended as cancelled in the words of the step it was stopped at. No load was shown for a second, 353 to 445 milliseconds in the two runs, and in the last every load showed the wait for a place, the wait for its URL and the pages, and no other step: the creation with its name and the bytes of a download were not seen. The cancel landed at the step of the target in both runs, two milliseconds after the load began, before anything was created: the words of a cancel at the creation or after it did not run there | Packaged: the steps of a load long enough to be watched, and a cancel once the panel names the request, on the large log of the fixtures of the second pull request |
| VIEW-04 | Unit: the words of a file the store does not have for every phase of the release, of a backup and of a restore, each naming the file that was asked, and nothing claimed of a phase that is not known or of an object that reports none; what is said before any request of a restore that names no backup, of a backup whose storage location is not there and of a backup that did not start and names none yet, and nothing said from a list that was denied, that failed or that is of an earlier read; the steps a way ends at before anything is created. Component: the words of the main process for the way a load ended, a fault said as an alert and marked as one, a file the store does not have said as an alert with the mark of information, and a cancellation said as a status with a mark of its own, neither marked as a fault; with the command that asks again, through the confirmation, where that is safe and writes are on, which asks for a request after a load that ended before anything was created and for another one after any other, the command that allows what the download needs where it said so, and one command that takes the tab back where asking again is not safe; a file the store did not have said by the phase the operation had then, in the past and with that time, and of an operation with a time of deletion that its files are being removed. The words of each code are the ones of [SPEC-0010](SPEC-0010-diagnostic-request-and-transport.md#evidence-and-deviations), with their tests there. Packaged, on the results of the real backup: a load cancelled before anything was created, said in the words of that step, with no request in the cluster and none counted, marked as a cancellation and not as a fault, and with the command that asks for a request and not for another one, which has the focus | Packaged: the backup and the restore that failed their validation and the restore without a backup name, which are fixtures of the second pull request, in the suites of the third |
| VIEW-05 | Unit: the lines numbered whatever ends them; the level of an entry of the text format read at its start, with `warning` read as a warning and nothing read from a message that carries `level=` in its words; the level of an entry of the JSON format read from its own key; a line that is no entry, and an entry at another level, counted as other; no line hidden until a level is chosen; the search whatever the capitals, with the words taken as they are typed, among the lines a filter leaves, each line once; where the words it found are in what a row shows of a line, each place of them, and the parts they cut a piece of a wrapped line in; a line of twenty thousand characters cut at ten thousand in its row, with how much of it was left out, and whole where it is copied. Component: the lines with their numbers and the count of each level, the levels a command each that says whether it is chosen, after two words that say what choosing one does; the labelled search with its count, the words it found marked in every row that is mounted as the line writes them, the match it is at marked and brought into the room of the list, the next and the previous with Enter, with Shift and Enter and with the two commands, around the ends; the choice to wrap; the copy of a line; a hundred rows mounted at most of a log of two hundred thousand lines, whatever is searched, filtered and scrolled to, in the double of the list of the host. Packaged, on the two real logs: the lines numbered from one and every line shown, the counts of the levels adding up to the lines, and every line of the two logs read at a level from its start and none as other. On the log of the backup: no search, no level chosen and the lines not wrapped at first; the counts of the levels the ones the suite reads itself in the file it saved; a level that is chosen leaving its lines by their numbers, with its count, and a level no line is of leaving none, which is said in the place of the list; the search by the name of the backup, which more than one line carries, moved with Enter and with Shift and Enter around both ends, the row of the match marked and the field keeping the keyboard; its matches the lines of the saved file that carry the words, whatever the capitals typed, the words marked in every mounted row that carries them as the file writes them, and words no line carries said with no match and both arrows disabled; the lines wrapped at the columns of the room and on one line again, and pictures in which the levels and the wrap are drawn as checkboxes; a line copied whole to the clipboard of the machine; and a hundred rows mounted at most at the first line, at the last and wrapped. The log of the backup is all at info: a level that is chosen there leaves every line, and only a level no line is of shows a filter that leaves lines out. The bound of a hundred rows is not approached in a list that has the room of a dozen lines | Packaged, on the synced log of 200,000 lines, which is a fixture of the second pull request: a hundred rows mounted at most, the counts of many levels, the searches with their counts, the lines that are cut and the one across two pages |
| VIEW-06 | Unit: the errors and the warnings of the three places with their counts, the namespaces by name; a message in the form of the hook in its parts, each part ending where the next begins, read in a time that grows with its length; a message of another form, as the ones of a restore are, kept as the text it is; results with neither, as the release writes them and with a key left out; the count of the results beside a counter the status writes, with the reason of each case and none where the release explains none. Component: the two groups as headed lists with the counts of each group, of each place and of the whole; the sentence of results that hold neither; both counts and their reason when they differ, and nothing said of a counter the status does not write; the first two hundred messages of results of thousands, and the ones after them where they are asked for. Packaged, on the real results of the backup and of the restore: the errors and the warnings of the file equal to the counters of the status, a counter the status does not write being none, the sentence of results that hold neither, no group and nothing said of a difference. Both hold no error and no warning: no group, no place and no message is shown, and no difference is said | Packaged: errors of two namespaces and a warning of Velero in the form of the hook, on the synced backup of the fixtures |
| VIEW-07 | Unit: the resources by their API version and kind, sorted, each with its items sorted and counted; the action of a restore after each item, the four of them, and an item without one, or with one the release does not write, counted as not stated with its text kept; an item of the cluster; the filter by the words that are typed, in the resource, the namespace and the name, and by action, with the counts of what is left. Component: the rows of a backup and of a restore in the virtual list of the host under the head of its tables, the action as a column of a restore alone, `cluster` in the namespace column of an item of the cluster, the labelled filter, the choices by action with what each would leave, the rows given the room the view leaves, six at least and twenty at most, with nothing counted on the window, and the rows of the room and ten on each side mounted of fifty thousand items. Packaged, on the real backup and the real restore: the namespace and the name as columns, and the action as well for the restore alone; each resource written as its API version and its kind, with the count of its items; the items of the backup as many as its status counted; the four actions of the restore counting every item and none not stated, each choice saying what it would leave and leaving the items of its action, and one that leaves none saying so with no row; the list of the backup filtered by the resource of its first row and by words no item carries, which leave none and say so, and Escape in the filter clearing it with the view still open. Each list is of one resource, so a filter by the resource leaves every item | Packaged: a resource list of many resources, on the synced backup of the fixtures |
| VIEW-08 | Unit: one row for each volume in the order it is written, with the claim and its namespace, the volume, the method, the result, whether the data was moved, the local snapshot kept and the volume skipped, the reason and the times; the size read from the detail that carries one, and none for a native snapshot, whose detail has none in the release; the details each field by its name, `ReadyToUse` and `Phase` among them; the volumes of a restore, with the way each was restored and no result; a method and a result the release does not write kept as their text and marked; a field the tab does not know by its name and its value; an empty list; a text that is not of the shape, with nothing raised for any text. Component: a table of the host with a row for each volume and the details of a row under it, no cell left empty, the mark of what is not known in words, and the sentence that Velero recorded no volume, for a backup and for a restore. Packaged, on the real backup and the real restore, which have no volume: the sentence that Velero recorded none, with no table and no row, and, after the load of the backup, the focus on that sentence | Packaged: the volumes of the synced backup of the fixtures, with their methods and their details |
| VIEW-09 | Unit and component: each of the three parsers answers nothing for a text that is not of the shape of the release, a JSON of another shape and a text that is no JSON among them, and raises nothing; the parser of the volumes answers nothing as well for a value the runtime reads and cannot write back; the viewer shows such a text as its lines, under the note, with the real list of lines in the tests of the pages; the pages assembled into the one text the tab holds, and a page that is not the one that was asked, one of another count and a text beyond 64 MiB refused with nothing shown; a text parsed once however many times its viewer is drawn, and a line made of the text for a row that is mounted and for no other; in the main process, a text of 64 MiB taken and one of a byte more refused | Nothing. How "no other copy" is read is below |
| VIEW-10 | Unit: on 500,000 lines made for the test, entries of every level with long lines among them, what the parser, the filter by level, the search for words every line but the long ones carries, one line carries and none carries, the search among the lines of a level, the count of the rows of a list, wrapped and not, and the lines of a text read without its levels answer. Their times are taken by the unit measure, with the second pull request, below | Packaged: the times of the search, of the filter and of the scroll on the synced log of 200,000 lines, with the third pull request |
| VIEW-11 | Unit, in the main process and through both processes: the dialog of the host asked of the module of Electron at each save, with a title and a message that say what is saved and a name for the file; the text written into the file that was chosen and into no other; nothing written when the dialog is closed, when it gives no file, and for a text that was let go on purpose, or a frame that went, while it was open; one dialog for a text at a time; the answer of a saving nothing but whether a file was written, and nothing of a path in a failure; the procedure registered when the extension is activated. State and component: the command offered for a text that is loaded and held, one saving at a time, what became of it said beside the command, and no command for a text the main process holds no more. Packaged, with the dialog of the host replaced in the main process by the suite, which answers as the dialog would: left, nothing written and the words that nothing was saved, with the command still offered; chosen, one file, where the suite chose, with the bytes the tab says the text has and the lines it counts, its first and its last line the ones the list shows at Home and at End; for each of those two savings the dialog asked once, with a title that is its message and names what is saved, and a name for the file with no folder in it, and nothing asked of the cluster; the log saved once more, into a file of the same bytes, after Escape cleared its search. Over the whole suite the API server counted, in both runs, nine creations and nine removals of DownloadRequests, as many as the requests the guard was told, eighteen reads of them by their names and nine writes of the server into them, and no write of another kind of Velero; nothing was left in the cluster, and the objects of Velero were as they were before the suite. The dialog itself is shown in no run | Nothing that waits for the fixtures |
| VIEW-12 | The pre-review, which is the layer of the check, is not run with the tabs open: the one that existed passes with the tabs in the two workspaces, its journey with the keyboard going through the five tabs. Component, where nothing is laid out: the strip as a list of tabs, each tab saying whether it is selected, the arrows, Home and End around the ends, Enter and Space; the labelled search, its count told to who does not see, Enter and Shift with Enter; the focus on the first line of the content after a load, and on the command that follows a failure. Packaged, in the suite of the tabs: the tabs in both themes at 1440 by 900, at their first state, under a confirmation and loaded, and the four loaded tabs of the backup and a confirmation at 900 by 650 and at twice the zoom in both themes, each looked at by the checks of the layout, which found nothing that lies over something else, is wider than its room or holds more than its height with no scroll that reaches it: what the limits below say is out of sight at those sizes is reached by a scroll, and a name cut in its cell is shown whole to who points at it; at those two sizes a view with the room of a list at least, no list taller than the room it is read in, a list whole in that room once it is brought into it, and the two commands of a confirmation in it; at 1440 by 900 the view of the log and of the resources holding no more than its room; the arrows, Home and End around both ends, Enter and Space on the strip, and Space scrolling nothing at 900 by 650, where the view of a log holds more than its room; the focus on the first line of a log and on the sentence of an empty list after a load, and on the command after a cancel. What a view of a tab is at those two sizes is among the limits below | The whole check, with the third pull request: the tabs and the viewers in the pre-review, in both themes, at the two sizes and at twice the zoom, and the journeys with the keyboard alone |
| VIEW-13 | Component: the section the host shows in the details of a backup and of a restore says that the log, the results, the resource list and the volume information are in the workspace, leads there by the way that was there, and asks the main process nothing. Packaged, on the real backup and the real restore: the section in the details the host shows of each, with its sentence, no command and one way, which opens the view at its summary, with no tab in the address and the namespace of the installation as the target, and its four tabs at their first state; nothing of a DownloadRequest counted, and writes still on after the pages of the host | Nothing that waits for the fixtures |
| VIEW-14 | Packaged: the four artifacts of the real backup and of the real restore of the test environment loaded, each through a request of its own, and checked against what the operation and the suite know of them: the log of the backup against the file the suite saved of it, its bytes, its lines, its levels and the lines that carry some words, which the suite reads there itself; the results against the counters of the status; the resource list of the backup against the items its status counted, and the one of the restore with one of the four actions for each item; the volume information as a list of no volume | The four artifacts of the backup synced from the store, checked against what the fixtures wrote, and the operations that failed their validation: the second and the third pull request |

The unit run, a local run of 2026-10-06 on the head that carries the suite of the
tabs, is 72 files and 2186 tests, green on the build with separate modules and on
the production build; 396 of the tests are of this pull request, 374 in the 19
files it adds and 22 in files that were there, and the [index](README.md) and the
[architecture](../development/ARCHITECTURE.md#dependencies) say what they are of.
Seven hundred and eighty-eight changes made to that code on purpose, one at a
time, on a copy of the tree, each made a unit or a component test fail. The
twelve suites of the views pass on its code in the packaged application, as said
above, in local runs of 2026-10-05, and the pre-review passes after them, 20 of
20.

What was decided while implementing, inside the requirements:

- **A tab is of the view that is shown** (REQ-138). The tab is one parameter of
  the address beside the views, written with them in one change of the address.
  The summary is no tab in the address, and what is not the name of a tab is the
  summary. A view that becomes the one shown, opened over another or reached by
  the way back, is at its summary: the tab of one view is never the tab of another.
- **Another tab keeps the text and not its viewer** (REQ-138). The text a tab
  loaded is there when the tab is shown again, and is read again by its viewer:
  the search, the filter, the rows that were open and the place of the scroll
  start again. The loads go as well when another object took the place of the
  operation under its name: what was loaded was of the first.
- **A tab drops its text when its next request is created** (REQ-138, REQ-140),
  at the second gesture and after a confirmation that expired was asked again,
  and not when loading again is asked. Until then the text stays shown and held:
  under the confirmation, when the confirmation is left, and when the main
  process refused it. While the request is confirmed, the words under the text
  say what goes when it is created.
- **The first state says what loading creates, and nothing of the file**
  (REQ-139): whether the storage holds it is what the load finds, and for some
  phases the answer is no. It names the object the request is for once, and says
  that nothing is created before the request is shown and confirmed. With writes
  off the state of the gate is said first and apart, then the way to the target
  bar is given, then what loading would create is said. The command names the
  kind of the request and of the artifact, as "Create a DownloadRequest of the
  kind BackupLog", and says "another" over a text that is shown, and after a load
  that ended without its text at the creation of its request or after it. After a
  load that ended before anything was created it says "a", and so do the words
  that say what asking again creates: that load left no request in the cluster. A
  tab at its first state says "a", also when it was taken back there after a
  request was created, and when its view was opened again. Where writes are not on
  in a later state, the state of the gate and the way to the target bar take the
  place of every command that would create a request, and the command that saves
  stays.
- **The confirmation names the request in words** (REQ-139): its name ends with
  an identifier that is made when it is confirmed, and one of its labels carries
  the same identifier. The name the main process creates the request with and
  the name the views say are one function of the contract. While the main
  process is asked for the confirmation the tab says so: it is a state of its
  own, beside the five the design names.
- **The step of a load is said once to who does not see** (REQ-140, REQ-149).
  The words that are seen follow the seconds of a wait, the bytes of a download
  and the page that is taken, and are no part that is read aloud as it changes; a
  part beside them says the step, with no counter, when the load comes to it.
- **The first step of a load claims no wait** (REQ-140). Every load begins at the
  wait for a place, which the views show before the main process answers: its
  words are true of a load that waits for nothing, and say that two artifacts at
  most are loaded at the same time and that a third one waits for its turn. The
  mark of the host that moves is beside the words of every step.
- **A cancellation is taken at every step it is offered at** (REQ-140). While the
  main process runs the request, the gate cancels it and the tab says what the
  main process answers. While a confirmation that expired is asked again, nothing
  is created and the tab is where it was. While the pages are taken, no more of
  them is taken, the text is let go, and the load ends as cancelled at the
  delivery, safe to ask again, with the words that the request stays until Velero
  removes it.
- **After a load that is not safe to ask again the tab offers one command that
  asks nothing** (REQ-141, REQ-149). It takes the tab back to its first state, or
  to the text it still shows when what failed was the confirmation of a load
  again, and the focus goes to it. Whether asking again is safe is what SPEC-0009
  and SPEC-0010 say of each code. Where the download said what the operator may
  allow, the command allows it, and asks again only when the main process kept
  it.
- **A load that ended without its text is marked as what it ended as** (REQ-141).
  A fault has the mark and the line of a fault, and is said as an alert; a file
  the store does not have, which the phase of the operation accounts for, has the
  mark of information; a cancellation, which the operator asked for, has a mark
  of its own and is said as a status, not as an alert.
- **A file the store did not have is said in the past** (REQ-141), with the time
  the store was asked, by the phase the operation had when the failure was first
  shown: an operation that went on since was not asked again. An operation that
  carries a time of deletion is being deleted whatever its phase says, since a
  restore has no phase for it.
- **A backup that did not start and names no storage location is told by its
  phase** (REQ-141). The release names the location of a backup when its
  controller takes it, and signs no URL for a backup that names none, as the
  [recon](../development/RECON-T0.1.md#with-the-tabs-of-an-operation-2026-10-05)
  records: the tab says what the phase says of the files and when the location is
  named, says of a backup with no phase that it reports none, and offers no
  request. The words of SPEC-0010 are for a backup the release took, whose
  location is not there, and for a restore whose backup names none. Nothing is
  said from a read of the locations that was denied, that failed or that is of an
  earlier read, nor of a backup that is not among what was read: the request
  reads what the view did not.
- **A level is read at the start of an entry** (REQ-142): from `level=` after
  the time of the entry, or first on its line. Where in a line the logging
  library of the release writes the level was not read, since the library is not
  in the tree of the release: the tests of the release show the word,
  `level=warning`, and not its place, as the
  [recon](../development/RECON-T0.1.md#with-the-tabs-of-an-operation-2026-10-05)
  records. A line that does not begin as an entry, and an entry at a level that is
  none of the four, are other. On the two real logs of the test environment every
  line was read at a level there, and none as other (VIEW-05).
- **A match is a line** (REQ-142). The search counts the lines that carry the
  words, each once, runs as the words are typed, and hides no line. The words it
  found are marked in every row that is mounted, where the row shows them, as the
  line writes them and across the pieces of a wrapped line; the row of the match
  it is at is marked, and its words have a frame as well, so that it is told from
  the others by more than a color. The marks take no room. The counts of the
  levels are the ones of the whole log, and a line keeps its number under a
  filter.
- **The copy is a command of each row** (REQ-142), which takes the line whole and
  says that it was taken, or that the clipboard did not take it.
- **The list of lines has keys of its own** (REQ-142, REQ-149). It is one stop of
  the Tab key, and the command of the line it is at is another; the arrows, Page
  Up, Page Down, Home and End move it among its lines with the focus on the row. A
  page is the rows that fit the room less one line, and one row at least.
- **The lines are wrapped by their characters** (REQ-142): a line is cut into
  pieces of the columns the room has, so that the height of every row is known
  before it is drawn and the list of the host measures none. The lines are not
  wrapped until it is asked.
- **A message is shown in its parts and as it is written** (REQ-143): the parts
  the hook wrote each by its name, a part written empty said to be empty, and
  under them the text. A place that holds no message is not drawn, and a group
  that holds none beside one that holds some says none.
- **Only a counter the status writes is compared** (REQ-143). The requirement
  names the counter of the status, and a status that writes none has none to
  differ from: the zero the views count for an operation that ended without one
  is not in the object, and the tab says nothing of it.
- **Results of thousands of messages show the first two hundred** (REQ-143,
  REQ-146), in the order of the page, and two hundred more of a place at its
  command, with every count said from the start.
- **The resources and their items are one list** (REQ-144): a row for each
  resource with its count, then one for each of its items, in the room the view
  leaves under what is over them, six rows at least and twenty at most. Each
  choice of the filter by action says how many items it would leave of what the
  words left.
- **A list is counted on the room it is read in** (REQ-142, REQ-144, REQ-149).
  The view that shows a tab is a column: its panel takes what the title and the
  tabs leave of the room of the view, and the lines of a text take what the panel
  leaves, ten lines at least and at most the room that keeps a hundred rows
  mounted, as the rows of a resource list do, six rows at least and twenty at
  most. Nothing is counted on the window. Where the
  target bar leaves the view less than the room of a list, the view keeps that
  room and the page is scrolled, target bar and view, as it is at twice the zoom.
  The two commands of a confirmation that is taller than the room of its view are
  held at the lower edge of that room, and its object is scrolled under them.
- **The way of a restore is its method** (REQ-145). A restore has the columns of
  the claim, the volume, the method, whether the data was moved and the size; a
  backup has the result, the local snapshot kept, the skip and the two times as
  well. The details of a row are a row under it, opened by a command of the row.
  The size is read from the detail of the data movement, of the CSI snapshot or of
  the pod volume, in that order, and a size of zero is none.
- **What an entry writes empty is what it does not state** (REQ-145), and no cell
  is left empty: "Not stated" is not a no.
- **A text that is not of the shape is shown as lines with no level and no
  search** (REQ-146), under a note that has the words of the requirement.
- **The views check what the main process gives them** (REQ-146, with REQ-112 of
  SPEC-0009). A page that is not the one that was asked, a page of another count
  and a text beyond 64 MiB end the load as an artifact that cannot be read, at the
  delivery, with nothing shown. The bound is one constant of the contract, for the
  transport and for the views.
- **The parsers are bounded in time as well** (REQ-146): the parser of the volumes
  raises nothing for any text, and a message of the results is read in a time
  that grows with its length, whatever a file Velero did not write repeats in it.
- **The unit measure is the 95th percentile of twenty calls after five** (REQ-147),
  since the second pull request, as the measures of the packaged application take
  theirs. It is one file, [`artifact-log.measure.ts`](../../test/artifact-log.measure.ts),
  which `pnpm test:unit` runs by a configuration of its own once the other tests
  ended, one file at a time; it imports the source, which both forms of the unit
  run time alike. On 500,000 lines of the log of the fixtures in its brief form,
  within the 64 MiB of an artifact and with its long lines, it times the parser,
  the search, the filter by level, the search among the lines a filter leaves, the
  rows of a list of the lines, not wrapped and wrapped at 120 and at 40 columns,
  and the lines of a text read without its levels: each series within 250
  milliseconds, every answer checked against what the generator counted or against
  a plain reading of the text. The rows are counted when a filter, the wrap or the
  room of a list changes, and not while it is scrolled: their budget is the one of
  an interaction, and the 50 milliseconds of a frame are of the packaged
  application. No other unit test holds this code to that budget: the case of
  500,000 lines of the other tests asserts what the same functions answer and
  takes no time, and a text made to be slow to read is given there a bound of its
  own, as the parsers are bounded in time.
- **A text can be saved for as long as the main process holds it** (REQ-148, with
  REQ-133 of SPEC-0010): ten minutes from the load, or less when the process needs
  the room. The tab says until when under the text, the time first, in the words
  the command is described by, counted from the answer of the load; at that time
  the command goes, and the words say that the text is saved only after another
  load. Reading the text does not make the time longer.
- **What was loaded comes first** (REQ-140, REQ-148). Over the text one line says
  when it was loaded and how much of it there is, with the command that loads it
  again and the one that saves it beside the words where the line has the room of
  both, and under them where it does not. Under the text are the request it came
  through, the way it came by, what loading it again does and until when it can be
  saved, which are what the two commands are described by. The first line of the
  results, of the resources and of the volumes has the weight of a head.
- **A saving asks the dialog of the host at that moment** (REQ-148): of the
  module of Electron, each time, with a title and a message that name the
  artifact, the operation, its namespace and its cluster, and with a name for the
  file made of the name of the operation and of what the artifact is, as
  `nightly-logs.txt`. One dialog is open for a text at a time. When a file is
  chosen, nothing is written of a text that was let go on purpose meanwhile, by
  its view, with its cluster or with the extension, nor for a frame that went; a
  text whose time passed, or that gave its room to another, while the dialog was
  open is written, since it is what the operator asked to save. The answer is
  whether a file was written, and nothing of the file.
- **Every tab is a stop of the Tab key** (REQ-149), as in the strips of the host,
  and Space on a tab chooses it: the strip prevents what the browser does with
  the key by itself, which the tabs of the host do not. The suite of the tabs sees
  in the packaged application that Space on a tab scrolls nothing, at 900 by 650,
  where the view of a log holds more than its room.
- **The focus follows a gesture of the tab** (REQ-149): to the words that say
  what the tab is doing while the main process is asked; to the first line of the
  content when the text arrives, which a list of the host draws a moment after
  its viewer and which is waited for; to the confirmation; to the command that
  follows a failure, or to the words of the failure when no command follows. It
  stays where the operator moved it meanwhile.
- **The section of the host is one item** (REQ-150), "Diagnostics", with the
  sentence, before the item that was there, which is the way to the workspace. It
  leads to no tab.

What changed in a requirement, from what the release does:

- **REQ-143, why the counts differ.** The requirement said that the results of a
  restore are written again when it is finalized. The release adds what the
  finalization finds to the status and to the results alike, the file first, and
  what makes the two differ once an operation ended is the operations of its
  plugins, which add their errors to the status of a backup and of a restore and
  write nothing into the results, as the
  [recon](../development/RECON-T0.1.md#with-the-tabs-of-an-operation-2026-10-05)
  records with its source. The tab says the reason of the plugins of a status
  that counts more errors, of a backup and of a restore; of a restore in a
  finalizing phase whose results count more, that they are added to before the
  status is written; and of any other difference both counts, and that it names
  no reason. The requirement and its check say so since this pull request.
- **The Scope Baseline and REQ-143, the form of a message.** They said that each
  message is in the form the hook of the server gives it. That is the form of the
  messages of a backup: the logger of a restore has no hook, and the messages of
  a restore are the texts the restore code writes. The tab shows a message in the
  form of the hook in its parts, and any other as the text it is. The baseline,
  the requirement and its check say so since this pull request.

Deviations from the words of a requirement, for the review of the milestone:

| Requirement | What it says | What the tabs do, and why |
| --- | --- | --- |
| REQ-138 | Each tab keeps its artifact for as long as the view is open | For as long as the view is the one shown. A view opened over it, of whatever kind, takes its loads, and the way back finds its tabs at their first state. One view is shown at a time, so that four texts are held at most: two workspaces of four tabs could otherwise hold eight |
| REQ-140 | During the load the tab shows the download with the bytes so far, then the decompression | One step, with the bytes of the text that arrived so far. The main process decompresses the file as it arrives and says one step of both: the bytes it counts are the ones of the text, which are what the bound of 64 MiB is of |
| REQ-142 | The Log tab shows the lines, and none is hidden until a filter is chosen | A list holds the rows that fit a bound the code assumes: that the browser places nothing further down than thirty-three million pixels of its layout, which are fewer pixels of the page at twice the zoom or on a display of twice the scale. A list ends there, a notice over it says how many lines are after the ones it has the room of, the search counts them, and the file that is saved has every line. A log of 1,650,000 lines that are not wrapped reaches the bound at a ratio of one, and a wrapped log reaches it sooner. The number is an assumption: no source of the browser was read for it, and it is not measured in the packaged application, at any zoom |
| REQ-056 of [SPEC-0005](SPEC-0005-restore-read-only.md), with REQ-149 | A view returns to the one it was opened from with Escape | Not from inside a text field, and not from inside the confirmation of a request. In a field Escape clears what was typed and goes no further, as it does in the search field of the host, in every view of one object: the tabs bring the first text fields into a view, and leaving a view lets go of up to four texts, each of which costs a request and a confirmation to load again. In the confirmation Escape leaves the confirmation, creates nothing and goes no further, and the next Escape leaves the view: the confirmation of one write took the key for itself where it was first shown, in the band of the server, which is on a page, and the tabs show it in a view of one object for the first time. Anywhere else in the view Escape is the way back, as before |

What this pull request leaves of the spec, with the row of the
[roadmap](../development/ROADMAP.md#m3---logs-and-diagnostics) that carries it:

- **REQ-151**: the artifacts of the backup synced from the store, and the
  operations that failed their validation. The fixtures the design describes are
  the second pull request, and the suites on them the third.
- **REQ-147, in the packaged application**: the times of the search, of the filter
  and of the scroll on the synced log.
- **REQ-149, as VIEW-12 checks it**: the pre-review with the tabs open.
- **The packaged layer of VIEW-04 to VIEW-08**, where the table above says which
  fixture each waits for.
- **The cases of the suite of the tabs that wait.** Seven wait for the fixtures of
  the second pull request: the synced backup without a log; the logs of the backup
  and of the restore that failed their validation; the results, the resources and
  the volumes of the synced backup; the cancel and the steps of the large log; the
  log of 200,000 lines; its times; and the restore without a backup name. Two need
  no fixture the environment does not have, and are not written yet: the texts and
  the writes when another installation is selected, with a storage location that
  is not there, and the refusal of the creation to the reader of a part.

What the tabs do not do:

- They do not know whether a text is older than the status it is compared with.
  Results of a restore that were loaded before its finalization added to them,
  beside the status it has once it ended, are given the reason of the plugins for
  its errors and no reason for its warnings.
- A dialog left open while its tab loads again writes nothing when a file is
  chosen, and the tab says nothing of it: what was said of that saving went with
  the text.
- A text the main process let go for room, before its ten minutes, is still
  offered to be saved: the saving says then that the text is not held any more,
  and the command goes.
- A line is wrapped by its characters: a tab, or a character that is drawn wider
  than the others, makes a piece wider than its room, and a word is cut where the
  columns of the room end. A match in a line a list has no room for is counted,
  and cannot be shown. The search brings the row of the match it is at into the
  room of the list, and not its words into the columns in sight: in a row that is
  not wrapped they can be beyond its right edge, where the list is scrolled
  sideways to show them.
- In the middle of a resource of thousands of items no row says which resource it
  is.
- At 900 by 650 the target bar is four lines, and the view of a tab has a room of
  324 pixels, where a loaded log with what is over it and under it takes 767: the
  view scrolls, and the list in it scrolls by itself, two scrollbars side by side.
  No list is taller than its room, and one scroll of the view brings a list whole
  into sight, with the title, the tabs and the commands out of it. At twice the
  zoom the page scrolls as well, target bar and view, whose room is 280 pixels:
  three scrollbars, one in the other. The five tabs go to two lines there, the
  answer of the results and of the volumes is under the fold, and the namespace of
  an item of a resource list is cut, and shown whole only to who points at it. At
  both sizes the object of a confirmation is read cut under its two commands,
  which stay in the room: at 900 by 650 its labels end under them and its target
  is out of sight, and at twice the zoom a name stands over them with its value
  hidden. One scroll for a view would take the frame of the pages, which every
  workspace shares: the view is laid over the list of the host, which keeps its
  scroll under it.
- At 1440 by 900 the list of the log of the backup has the room of eleven whole
  lines, under the line of what was loaded, its commands and the bar of the log,
  and over four lines of small print that say how the file came, what loading it
  again does and until when it can be saved, which take about the height of five
  lines of the log. The commands over a text are at the end of its line in one tab
  and under it in another, as the line has the room of both or not, and a list of
  lines starts lower where they are under it. The resource list of the demo shows
  six of its thirteen items before it is scrolled.
- The icon of every command touches its first letter, as every command of the
  extension has it since the first milestone: a space between them is one change
  for every command, with a run of the pre-review, which scans the widths at which
  the target bar wraps. The mark of a cancellation, a cross in a circle, is not
  the one of a fault, and still reads a little like one.
- The table of the volumes of a backup is wider than a window of 900 by 650, and
  is scrolled sideways inside its own room; every row of it is mounted.
- They do not correct what the list of the host takes a row it has not reached to
  be: fifty pixels, where a line is twenty. Until its rows were reached, the thumb
  of the scrollbar of a long text is not where the text is. This is read in the
  source of the list, `react-window` at 1.8.11, to which the host gives no
  estimate, and was not seen: the measure of the scroll is with the third pull
  request.

Open, for the review of the milestone:

- **What changed in the text of REQ-143, of its check and of the Scope Baseline,
  and the four deviations above.**
- **The words of the manual review.** The Success Criteria ask to search the log
  of the real backup for "completed" and to filter its warnings. The
  [walk](../development/TRY-IT.md) of the demo searches that log for
  `Backed up a total`, the line the release writes when the work of a backup
  ends, and the log of the restore for `restore completed`; it chooses a level by
  the counts the tab shows, since the fixtures refuse a real backup that reports
  errors and ask nothing of its warnings. Whether a line of the log of a backup
  carries the word of the criteria was not established: the
  [recon](../development/RECON-T0.1.md#with-the-tabs-of-an-operation-2026-10-05)
  says what was searched and what was not. The criteria are as they were
  approved, and whether their words stay is for the lead maintainer.
- **"No other copy" in REQ-146.** The log holds the text and two numbers for each
  line. The viewers of the results, of the resources and of the volumes hold,
  beside the text, what they read of it, whose names and messages are texts of
  their own, for as long as their tab is shown. The tests prove that a text is
  parsed once, and nothing more of the copies.
- **The ten minutes of REQ-133 of SPEC-0010.** They are not made longer by a view
  that reads its text, and a view is not told when its text is let go for room.
  Either would change that requirement or the contract between the processes.
- **No screen reader was part of any run.** The lines are a list that is read
  with the keys of the page, which the list takes when the focus is on it. A
  reader that has a browse mode keeps those keys for itself in a list, and its
  focus mode is needed there: this is read from the roles of the list, and was
  not heard.
- **One scroll for a view in a short room, and the small print under a text.** At
  900 by 650 and at twice the zoom a view of a tab scrolls with a list in it, as
  the limits above say: one scroll is a change of the frame of the pages, which
  every workspace shares, and a decision of design. The four lines under a text
  could be closed until they are asked for, to give the list their room, which
  would change how REQ-140 shows the way a text came by.
- **The name of the command of a tab.** It is the request it creates, "Create a
  DownloadRequest of the kind BackupLog", as REQ-139 asks, and not what the
  operator gets: REQ-117 of [SPEC-0009](SPEC-0009-write-gate.md) asks a write to
  name its kind, and never "load" alone. Whether the command names the log as well
  is for the lead maintainer.
- **The main process in the words.** The steps of a load, what is said of a
  saving and the words of the gate name the main process, as the words of the
  target bar of SPEC-0009 do: whether the operator is told of a process of the
  extension, or of Freelens, is decided once for both.
- **Two looks for the choices of a filter.** A level of a log, and the wrap of its
  lines, are on or off by themselves and are drawn as checkboxes; an action of a
  resource list is one of several, and is drawn as the windows of the Overview
  are. Side by side they are two looks, which is for the lead maintainer to judge.
- **What was not seen in the packaged application.** The suite of the tabs saw the
  tabs on the real backup and the real restore, at the three sizes and in both
  themes, the lines of a log in the virtual list of the host with the focus on the
  first of them after a load, and the keys of the strip. What those two operations
  cannot show was not seen: every way a load ends but a cancel before the
  creation, a file the store does not have, every step of a load but the wait for
  a place, the wait for its URL and the pages, results with messages, a list of
  more than one resource, a volume, a log of other levels, of the JSON format or
  with a line that is cut, and a list near the bound of its rows. No load of the
  demo lasts long enough for its picture to show a step but its first. The
  pre-review with the tabs open, and the journeys with the keyboard alone through
  them, are the third pull request.

### The Fixtures Of The Tabs, The Second Pull Request Of T2.3

Implemented by 2026-10-06. This pull request brings the fixtures REQ-151 and the
Design ask for, placed, synced and removed on the cluster of the test environment;
VIEW-14, which loads them in the packaged application, is left to the third. The
artifacts the tabs read are made by
[generators](../../e2e/scripts/local-artifacts.mts) that are functions of their
arguments alone; what is written into the bucket of the demo, and how, by the
[client of the store](../../e2e/scripts/local-store.mts) through
[one request](../../e2e/scripts/local-runtime.mts); the operations the server
refuses, the wait for its sync and the cleanup, in the
[fixtures](../../e2e/scripts/local-fixtures.mts) and the
[runner](../../e2e/scripts/local-demo.mts). Beside them, the parsers are tested on
what the fixtures give the store, with a measure of REQ-147 at the unit layer, and
the suites of the views that expected the installation of the demo to hold its
real operations alone expect it as the fixtures leave it. The code had independent
reviews before it ran on a cluster and after, and one of the whole pull request:
what was applied of their findings is in the code and in its tests, and what was
left is among the decisions, the limits and the open points below. The spec stays
Approved: it is Implemented with the last of the three pull requests.

What the generators make for the backup synced from the store, each artifact in
the form the release writes, but for the departures listed after, with the facts
of the release they rest on in the recon,
[with the tabs](../development/RECON-T0.1.md#with-the-tabs-of-an-operation-2026-10-05)
and
[with their fixtures](../development/RECON-T0.1.md#with-the-fixtures-of-the-tabs-2026-10-06):

- **The log**: 200,000 lines of the text format of the server, fifteen
  milliseconds apart over the fifty minutes of the work. 4 are at error, 2 at
  warning, 169,231 at info and 30,217 at debug, and 546 are no entry, of which 24
  name a level in their words, beside 40 entries at info whose message names
  `level=error`. Three lines have 20,000, 10,000 and 10,001 characters. The text
  is 49,143,988 bytes in twelve pages, and the first page ends inside a character
  of three bytes. The progress of the backup is a field written with nothing in
  it, where the release writes it so. Sixteen texts the suites search for are
  counted while the log is written. Its digests are pinned in
  [`tab-pins.ts`](../../test/tab-pins.ts), for the run and the moment the tests
  make it for.
- **The results**: four errors, two under Velero, where the release files the
  error of an item that was not backed up and the failure of a pod volume, and two
  under two namespaces, one in the four parts of the hook and one a message alone;
  and two warnings, one of Velero and one of the cluster.
- **The resource list**: 48 resources and 6,000 items, in 24 namespaces and in the
  cluster, with the one snapshot and its content the CSI volume names.
- **The volume information**: five volumes, in the order of the release: one it
  skipped, with its reason and no method; a native snapshot, with no size and no
  times; a CSI snapshot kept where it was taken, with the end and the result its
  operation gave it once the backup was finalized; a pod volume that was backed up
  and one that failed.

The metadata of that backup is the one of a backup of every namespace that failed
in part, made like the real backup of the run, from which what the server fills is
copied: errors 4 and warnings 2, the progress of its 6,000 items, and a native
snapshot, a CSI snapshot and an operation of a plugin, each attempted and
completed. The second synced backup completed: it selects by a label nothing
carried and excludes no namespace, which makes it the backup of no item the
release writes; it has no log, and its results, resource list and volume
information are the empty forms. Both began four hundred days before the run,
worked fifty minutes and are kept for ten years, so that no window of the views
holds them and no expiration removes them. Both name the snapshot location of the
installation that took them, which this one does not have, as the release writes
into every backup it takes the snapshot location of each provider its installation
has one of. An annotation carries a digest of the two and of their artifacts,
which a placement compares with the backups it finds in place. The three
operations the server refuses are the ones the transport proof asked for: a backup
and a restore that name both kinds of selector, and a restore asked from a
schedule that has no backup, refused without a backup name.

Where the synced backups are not what the release writes, on purpose, each beside
the fact of the release it departs from:

- Lines that are no entry, and characters of two and of three bytes in them. A log
  the release wrote has one writer, its logger, and no such line, as the
  [recon](../development/RECON-T0.1.md#with-the-tabs-of-an-operation-2026-10-05)
  records: they are there for the lines the tabs count apart, with no level.
- The two errors of the namespaces and the two warnings carry messages no logger
  of the release gives: the approved scenario asks for errors of two namespaces,
  where the hook of the release files an entry by its namespace, and the error of
  an item and the failure of a pod volume under Velero, as the
  [recon](../development/RECON-T0.1.md#with-the-tabs-of-an-operation-2026-10-05)
  records.
- The contents are an empty tar in gzip, which the release never writes for a
  backup, whose contents begin with the version of their format: an archive with
  nothing in it is what the deletion takes as a backup with nothing for its
  actions, as the
  [recon](../development/RECON-T0.1.md#with-the-fixtures-of-the-tabs-2026-10-06)
  records.
- The folder of a backup holds six keys, five for the second, and not the three
  lists the release writes beside them, of the pod volume backups, of the native
  snapshots and of the operations of its plugins, though the status counts a
  native snapshot, a CSI snapshot and an operation: from the list of the pod
  volume backups the sync creates objects, and for each native snapshot listed the
  deletion calls the plugin of the snapshots. The release writes no list of CSI
  snapshots into the folder of a backup, as the
  [recon](../development/RECON-T0.1.md#with-the-fixtures-of-the-tabs-2026-10-06)
  records.
- A backup of every namespace whose resource list holds 24 namespaces made for it
  and none of the namespaces a cluster has, where the release takes every active
  namespace that such a backup does not exclude, as the
  [recon](../development/RECON-T0.1.md#with-the-fixtures-of-the-tabs-2026-10-06)
  records.
- A backup that completed with no log, which the release leaves only when the
  upload of the log, which is best effort, failed, as the
  [recon](../development/RECON-T0.1.md#start-of-the-third-milestone-2026-09-30)
  records.

None of them makes a tab pass on what a real backup would fail: each is what a
requirement or the Design asks of the fixture, or what keeps the deletion away
from the plugin of the snapshots and from the repository of the pod volumes.

What is written into the bucket, and how. The placement gives the store the eleven
keys of the two backups before it places anything else, each folder with its
metadata last, since a pass of the sync takes a folder as it is once it finds the
metadata there; then the objects of the views, then the three refused operations,
and last it waits for the server. It reads before it writes: the real backup,
which the two are made like and without which nothing is stored; the head of its
log, which must have the keys the log of the fixtures is written with; and the
keys of its spec and of its status, which the metadata must have. Then it records
the placement, in the journal of the environment and, with the metadata as it is
stored, in a file of the private state written whole, and only then writes. A body
is given the store in one of three ways, tried in their order only while none has
passed: a file the client of the node uploads, the same file as the data of the
request, and a request signed in the scripts over the digest of the body, which
the client sends as it is. The way that passed is recorded, and is the way of
every file after it, and the store is asked after each file how much of it it
holds. The store the environment pins, SeaweedFS 4.48, took all three ways on
2026-10-06, each with the whole length it was sent: the placements sent their
files in the first, and two placements, by a temporary change of the order of the
ways, in the two others. A second placement sent the store no file and asked it of
none, applied no refused operation again, and found the same identities and
versions; what the suites are told of the real artifacts is read again each time.
A request the record of the placement does not allow is refused before anything is
sent: the write of a key of the tabs, asked first thing by a temporary change
while the placement was recorded as synced, stopped in a second, with nothing
added to the log of the operations and nothing kept in the node.

The sync of the server created both backups at the first of its passes that came
after the files: at least seven seconds after the last of them in the first
placement of the day, and fifty-two in the last. Its passes were two minutes apart
in the first runs of the day and a minute apart in the later ones. The wait counts
the passes by the time the location says its last one ended at, and stops after
two passes that ended with a backup missing, or after five minutes with no pass,
which is what a location that is not available gives. What the server created is
read back against what was stored: the labels of the run, which it keeps; the
storage location, which it writes into the spec and into a label; every key of the
spec that was stored; and the whole status, the empty progress of the second
backup and the empty status of its hooks among it. The server added an empty
`hooks` and an empty `metadata` to the spec of both, which the real backup does
not carry. The two backups are entered in the journal with the identity the
cluster gave them.

The cleanup of the fixtures has the server delete the two synced backups: a
DeleteBackupRequest of the run for each, one backup at a time, the removal
recorded before the first request, and a pass of the sync waited for after them,
so that a backup that comes back is asked for again. The real backup and the
refused one are removed by the same rules. It ends when the cluster and the store
hold nothing of the run: the eleven operations of the run looked for by their
names, whatever the journal knows, and the twenty keys the client may ask of the
run, nine of the fourteen the server wrote for the real backup and the real
restore, which the
[recon](../development/RECON-T0.1.md#with-the-fixtures-of-the-tabs-2026-10-06)
lists, and the eleven the store was given, each answering that it is not there. On
the cluster of the test environment, on 2026-10-06, the cleanup removed the
fixtures of the tabs from each of these states, and ended from each but the
fourth, which was stopped on purpose after its end check and left the fifth:

- after a whole placement, with nothing back in two more passes of the sync, and
  run again on the run it had cleaned;
- stopped right after it created its first request;
- after a placement stopped between two files, with no metadata stored: it gave
  the store the metadata, and the server made the backup it then deleted;
- after a placement stopped once the first metadata was stored, started before the
  sync passed;
- stopped once the tabs were removed and before the record of their removal ended;
- after a placement of one backup of two, made in the second way;
- with the contents of the first backup cut to ten bytes, by a temporary change:
  the server ended the request with one error,
  `error invoking delete item actions`, and left the backup in deletion with every
  file; the cleanup stopped on it, and the next one put back the empty archive the
  fixtures make, recorded before it was written, replaced the request and had the
  server delete the backup.

A placement stopped between two files went on as well with the next placement,
which wrote the files the store did not hold whole. A cleanup after a placement
took 99 to 158 seconds in those runs, of which about sixty went to the namespaces
of the views after a whole placement, and a first placement 130 to 132 seconds in
all. `pnpm e2e`, whose cleanup removes the real backup and the refused one by the
same rules, passed end to end.

What no run on a cluster reached, and the tests of the environment prove on the
pretend cluster alone: a request the server began and left, which a server stopped
inside the second a deletion takes would leave; a synced backup deleted from
outside the scripts, followed by a placement; the waits for the requests a review
by hand or a suite that was stopped left; and contents that unpack to a part of a
block, which the pretend server takes as cut. What no run reached and no test
proves: the type the store keeps of a body sent in each way, and an environment
brought up before this pull request. Two facts were seen only in their end state.
The server deleted a synced backup within one to three seconds of its request: its
object was seen gone and the keys of its folder not there, and nothing came back
in the two passes after the first cleanup, nor at the pass each later removal
waited for; the steps of the deletion were not seen, and their order, the files
before the object, is read in the source. The refused backup had failed its
validation by the first read of each placement, so that its queue was not seen. No
hosted runner has run the placement, the wait for the sync or the cleanup.

Those runs were made on the code before the review of the whole pull request,
whose fixes changed the words of the runner; made the placement stop on an answer
of the store that says neither that it holds a key nor that it does not, which no
run met; made a request for which the client of the node gave no answer of the
store leave its line in the log of the operations, and refused an answer with no
headers; printed the note that the fixtures placed by the clock were put in place
again only when they were there before; and made the wait before the suites stop
at once on a request to delete a backup that the server ended with an error. On
the final code the closing runs below placed the fixtures again, ran the suites on
them and removed them.

When files of the tabs are in the store and no backup comes of them, or a key of
the run is left once its operations are gone, nothing in the scripts removes a
key: the cleanup stops and names the keys, and the way out is to take the
environment down, with `pnpm demo:down`, which removes the store with the node.

What the suites are told of the artifacts is counted outside the extension: of the
synced backups, what the generators counted; of the real backup and the real
restore, what a plain count finds in the files the server wrote for them, read at
each placement. `pnpm e2e:views` writes it, `tab-fixtures.json`, beside the
reports of the suites, for the suites on the fixtures, and `pnpm demo:views` into
the private state, for who looks at the tabs by hand. The suites start only when
the installation holds the two synced backups and the three refused operations,
probed by the names of the run.

The unit evidence. The parsers of the four tabs are tested on what the fixtures
give the store, in fourteen cases: the log read at the lines and the levels its
generator counted, with no level taken from the words of a line, the texts the
suites search for found in as many lines, the long lines cut in their rows and
whole for a copy, the line across the first page whole, and its entries in the
JSON format of the server, the error under `error.message`; the results where the
log filed each entry, in its parts, counted as the status counts them; the
resource list with every item in its order; the volumes with what each entry says
and the size of the detail that has one; and the second backup, with no log, which
the tab says by the phase the fixtures give it, and with its empty artifacts. The
generator counts while it writes, and a test of the generator checks its counts
against a plain reading of the text: the parsers are compared with what was
counted another way. The unit measure of REQ-147, as decided above, on 2026-10-06,
on a machine of a developer that ran the test environment beside it, with three
workers of the runner of the tests:

| Series, 95th percentile | Separate modules | Production build |
| --- | --- | --- |
| The parser | 122.4 ms | 134.2 ms |
| The search, twenty texts not searched before | 78.3 ms | 85.0 ms |
| The filter, twenty choices of levels not chosen before, each level alone among them | 3.6 ms | 3.2 ms |
| The search among the lines a choice of levels leaves | 83.2 ms | 80.8 ms |
| The rows, not wrapped, at 120 and at 40 columns | 46.9, 40.1 and 31.8 ms | 48.4, 40.1 and 30.7 ms |
| The lines of a text read without its levels | 47.4 ms | 47.6 ms |

The budget is 250 milliseconds for each, and the text is 65,529,500 bytes. In the
closing runs of the same evening, below, with the workers the runner chooses and
the machine busier, every series passed the same budget on both build forms: the
slowest at its 95th percentile was the parser on the separate modules, at 159.6
milliseconds. The unit run of that day is 73 files and 2,291 tests on both build
forms, and the measure 1 file and 1 test after them; 105 of the tests are of this
pull request: 16 of the artifacts the generators make, 75 of the environment that
places the fixtures, waits for the server and removes them, and 14 of the parsers
on what the fixtures give the store.

The tests were seen failing by changes made on purpose to the code, one at a time,
each step on the code of its day. On 2026-10-05, as the fixtures were written: 50
changes of the generators, by which every test of the generators was seen failing;
81 of the names and the keys of the fixtures, of what the client of the store may
ask, of the metadata of the two backups and of the request that deletes one, by
which every new test of them was seen failing; and 138 of the rules the review of
the placement, of the waits and of the removal changed or added, each seen failing
in the end. On 2026-10-06, while the measure was written, 34 changes of the
parsers, of the generators, of the keys and the counters of the fixtures and of
the measure, of which 32 made a test fail: a search made to read its text twice,
or three times, stays within the budget, which a search four times as slow, and a
parser that copies every line, exceed. After the review of the whole pull request,
21 more, each of which made a test fail: 8 of the code of a log the measure times
and 2 of the choices the measure makes, 5 of the same code against the case of
500,000 lines that takes no time, 2 of the parser of the results and 2 of the
counters of the metadata of the fixtures, and 2 of the order of the end check of a
cleanup.

The packaged evidence. The suites of the journey and of the restores see as well
that a workspace of a backup and of a restore opens at its summary, the first of
its five tabs, with the ways the summary had and no field (REQ-138), on a backup
and on two restores of the fixtures of the phases and of the views. The cases that
expected the installation of the demo with its real operations alone are restated
on what it holds, as the lead maintainer decided on 2026-10-06, and the
[Overview](SPEC-0008-overview.md#evidence-and-deviations) records what that
changes of it: the Overview and the locations of the installation, and the picture
the pre-review takes of its Overview. In local runs of 2026-10-06, on the code
before the fixes of the review of the whole pull request, each restated case
passed alone, and each old expectation the fixtures broke, put back alone, failed
its case at its line; the new expectations of the journey and of the restores were
not seen failing by a change made on purpose. A first run of the twelve suites
failed one case, the guard of the suite of the schedules, which counted the reads
of the requests of every namespace that a watch made beside the suites once a
minute: nothing but a suite reads the cluster while it runs, and the run without
the watch passed. The fixes of the review changed the words of the runner and of
the suites, the wait before the suites, what the placement concludes from an
answer of the store that says neither that it holds a key nor that it does not,
and the order of the newest completed backup in the case of the Overview; the
suite of the Overview passed alone after them, 15 of 15.

The closing runs, on the final code of this pull request, on the evening of
2026-10-06, one after the other: the checks of the repository and `pnpm test:unit`
on both build forms, as said above; then, on an environment brought up from
nothing by `pnpm demo:up` in 243 seconds, which places nothing of the tabs:

- `pnpm e2e:views` placed the fixtures of the views and of the tabs in 119
  seconds, the eleven files sent in the first way, and its wait for the two
  backups took no time, since a pass of the sync came while the views were placed;
  the twelve suites passed, 150 cases beside 9 that wait, in 1,713 seconds of the
  runner of the suites, within the hour a run of them is given, and the host gave
  up on none of their starts, where in the earlier runs of the twelve it gave up
  on the first start of some, each of which passed on its second;
- `pnpm pre-review` passed, 20 of 20, in 357 seconds of the runner of the suites,
  after a placement that wrote nothing and found the refused operations refused;
- the cleanup of the fixtures took 104 seconds, 26 of them to have the server
  delete the two synced backups, none of which came back after a pass of its sync;
- `pnpm e2e`, on the installation the cleanup left with nothing, passed in 11
  minutes and 37 seconds: its fixtures, the transport proof, and its cleanup
  through the one way the cleanup deletes a backup of the fixtures, after which no
  backup, restore or request to Velero was left.

What this pull request leaves to the third:

- VIEW-14, the four artifacts of each of the three operations loaded in the
  packaged application and checked against what the fixtures wrote, and the
  packaged layer of VIEW-04 to VIEW-08 on these fixtures;
- the nine cases of the suite of the tabs that wait: seven on these fixtures, and
  two that need none the environment does not have;
- the packaged measures of REQ-147, the search, the filter and the scroll on the
  synced log;
- the pre-review with the tabs open, which is VIEW-12;
- the cleanup of the fixtures in the hosted job of the views, which places them on
  every run and takes the environment down with them;
- the evidence that makes the spec Implemented.

Decided by the lead maintainer on 2026-10-06:

- **Nobody deletes a DownloadRequest the extension created**: the suites wait for
  the server to remove the ones they asked for, and no rule changes. Nor does a
  cleanup remove the ones a suite that was stopped, or a review by hand, left:
  before it removes anything it waits for the server to remove the requests for a
  download and for the status of the server in the namespace of the installation,
  twelve minutes at most, and it stops by name on a request for a download the
  server did not look at in a minute, or on one in a namespace of the fixtures,
  which no server reads. The way out is `pnpm demo:down`. What it costs is the
  time of the hosted job of the views, and of a run of the suites, which the
  runner gives an hour.
- **The installation of the demo is restated as the fixtures leave it**, and
  REQ-098 stays proven at the unit and component layers, which are the ones of its
  check, as the evidence of
  [SPEC-0008](SPEC-0008-overview.md#evidence-and-deviations) records.

Decided while implementing, each awaiting the review of the milestone:

- **The measures take the 95th percentile of twenty after five**, the form the
  check gives the search and the filter.
- **The budget of the unit measure is asserted wherever the unit tests run**, the
  hosted runners included, in both forms of the unit job. The hosted runner has
  not run it: its margin there is not known.
- **No key of the store is deleted by the scripts.** The way out of files from
  which no backup comes is `pnpm demo:down`.
- **The hosted job of the views has no cleanup step yet**: the cleanup of the
  synced backups has the local evidence above, and its step is the third pull
  request.
- **The runner waits for the server before the suites as well**: for the requests
  of the namespace of the installation, twelve minutes at most, and it stops on a
  request for a download the server did not look at in a minute. A request to
  delete a backup that the server ended with an error stops it at once, by its
  name, since the server removes such a request a day after it was made. A request
  in a namespace of the fixtures, which no server reads, is named in a warning,
  and the run goes on.
- **A request to delete a backup that the server ended is replaced, whatever it
  ended it with; one it began and left is replaced after three minutes, once for a
  backup in a removal; one left with no backup is removed at the end.** Each is a
  request of the run, removed by the identity it was read with: the server looks
  at a request once, and passes over one it ended or began until it is a day old.
- **The cleanup has one way to delete a backup of the fixtures**, for the synced
  ones and for the real and the refused one, so that `pnpm e2e` and its hosted job
  clean through it, and it ends on one check of the operations and of the keys of
  the run.
- **The third way of a body is a request signed in the scripts**, which the client
  of the node sends: no container is started to send it.
- **A storage location that is not available is waited for**, five minutes while
  the sync is waited for and three in a removal, since the sync passes over such a
  location and takes it up again once it is validated.
- **The requests to Velero are read, by the waits, by their kind, their namespace,
  their name and their expiration**, with the output withheld: the status of a
  request for a download that was processed holds a signed URL. A request to
  delete a backup holds none: in the namespace of the installation it is read
  whole, by the removal of a backup, by the end check of a cleanup and by the wait
  before the suites when one is there, and the private log of the operations keeps
  that read.

What changed in the text of a requirement and of the Design, from what the release
does:

- **REQ-151, the volumes.** It said volumes of every method. A backup writes three
  methods and entries with none for the volumes it skipped, and the method of a
  restore is in the volume information of a restore alone: the synced backup has a
  volume of each method of a backup and one that was skipped, and the method of a
  restore and a volume whose data was moved stay at the unit and component layers.
  The requirement says so since this pull request.
- **The Design, the fixtures of the tabs.** It said that they are a backup synced
  from the store, with a second one that has no log: they are two backups. It said
  that the synced backup completed, where a backup whose results hold an error
  failed in part: the first failed in part, and the second completed. It said
  nothing of what the second holds: it is the backup of no item, which selects by
  a label nothing carries. It said that the files are what the sync needs to
  create a backup: the sync creates a backup from its metadata alone, and the
  archive and the artifacts are what the deletion and the tabs read. It said
  nothing of the order of the files: the metadata of each folder is written last,
  since a pass of the sync takes a folder as it is once it finds the metadata
  there. It said that the sync creates a backup within a minute, where two of its
  passes are a minute or two apart. It said that the sync writes the label of the
  location: it writes the location into the spec and into a label. It said that
  the deletion takes a missing archive as permanent only by its error: it stops as
  well on one it cannot read. It said that the fixtures are the first in the
  namespace of the installation, where the transport proof creates and removes
  operations of its own: they are the first fixtures of the views there. The facts
  of the release are in the
  [recon](../development/RECON-T0.1.md#with-the-fixtures-of-the-tabs-2026-10-06),
  and the Design says so since this pull request.

Open, for the review of the milestone:

- **What changed in the text of REQ-151 and of the Design, and the decisions
  above.**
- **The frames of the scroll** (REQ-147). The requirement asks that a scroll draws
  each frame within 50 milliseconds. The packaged measure of the third pull
  request would take the longest frame of each of twenty gestures, at the 95th
  percentile, the form the check gives the search and the filter, where a strict
  maximum over every frame fails on one pause of the collector. That would change
  the words of the requirement, and is for the lead maintainer: nothing of it is
  built yet.
- **The words of VIEW-08.** Its check asks for the four methods with their details
  and the size read from each. A backup writes three methods, the method of a
  restore is in the volume information of a restore alone, and the release writes
  no size for a native snapshot: on the synced backup the packaged layer of the
  third pull request can show three methods and a volume that was skipped, and the
  size of the ones that carry one. Whether the check is reworded with the third
  pull request, or the difference is recorded there as a deviation, is for the
  lead maintainer.
- **The results of the synced backup** hold, beside the errors of two namespaces
  REQ-151 names and the warning of Velero the second scenario names, two errors of
  Velero and a warning of the cluster: whether the words name them is for the lead
  maintainer.
- **The cases that pin the installation of the demo** to the seven operations of
  the run, by name, as the old ones pinned one backup and one restore: a backup
  made by hand in that namespace during a review fails them, with a difference
  that names it. Their branches for an operation within five minutes of the edge
  of the window, for an environment older than its window and for backups in
  flight have not run: the environments of the runs were hours old.
