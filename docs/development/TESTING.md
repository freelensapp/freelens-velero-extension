# Testing Strategy

Date: 2026-10-25

Status: T0.3-T0.6 scaffold, environment, fixture and compiled-main transport checks
pass. The [integration test](#integration-tests) covers the activation in Freelens.
The [end-to-end tests](#end-to-end-tests) bring the environment up on the hosted
runner and on the machines of the contributors. Since T0.7 every packaged layer runs
on Freelens v2, at the validation target of
[SPEC-0015](../specs/SPEC-0015-freelens-v2-host.md): the nightly
v2.0.0-0-nightly-2026-10-25 on the machines of the contributors, and Freelens built
from source at its commit, `7801fb10a5f20af308093b39e5f79cd6e8c3461d`, in CI.

This is a desktop Electron extension with renderer UI, main-process Kubernetes
operations and object-storage transport. The binding safety/privacy rules are in
[AGENTS.md](../../AGENTS.md); domain evidence is in [RECON-T0.1.md](RECON-T0.1.md).
The [roadmap](ROADMAP.md) is the single source of truth for progress, not this
strategy document. The sections named after a task (T0.4, T0.5, T0.6) are dated
evidence of the runs of the foundation phase, on one Linux machine. Where they
name a command or a limit that [SPEC-0004](../specs/SPEC-0004-test-environment-every-platform.md)
changed, the section of the end-to-end tests is the current one.

## Prerequisite Evidence

Non-mutating checks on 2026-09-18 established Node.js v22.23.2, a responsive Docker
daemon through the explicitly local Unix socket, and available corepack, pnpm, kind
and kubectl CLIs. No Docker context listing, Kubernetes request, install, service
start, or container creation was performed. T0.3 must select the toolchain required
by the pinned SDK/build; these checks do not prove a full build environment.

T0.3 used Node v24.15.0, pnpm v10.34.4 and the SDK of Freelens 1, and the
manifest of the extension accepted the hosts compatible with Freelens 1. Electron/Playwright host launch, app
installation, display support, fixture images and runtime authentication were then
unverified and separately gated. No Kubernetes access occurred during scaffold
checks. Since T0.7 the toolchain is Node 24.21.0 of `.nvmrc`, pnpm 12.14.0 and the
SDK `@freelensapp/extensions` 2.0.0-0-nightly-2026-10-25, and the manifest declares
`engines.freelens` as `^2.0.0`.

T0.4 preflight confirmed the explicitly local Docker daemon and existing kind
v0.29.0/kubectl v1.33.4, with sufficient capacity and an unused dedicated demo name.
Local-kind identity, generated-kubeconfig, network-overlap and ownership guards now
have synthetic unit tests. Their presence alone does not prove environment readiness.
Setup scripts use Node's built-in TypeScript stripping; no new runtime dependency
or global CLI upgrade is required.
Their environment guard also removes inherited cloud credentials/profiles and
disables AWS ambient credential/metadata lookup. No AWS/Azure account or online
service access is authorized by this local setup; explicit target/operation approval
would be required under the canonical directives.

T0.4 resumed on 2026-09-24 with official [SeaweedFS 4.47](LOCAL-STORAGE.md).
The dedicated kind cluster, Velero server/node-agent, storage and BSL are now ready.
Runtime authentication, network isolation and temporary-resource cleanup pass.
At that stage no backup or restore was run. T0.5, authorized on 2026-09-25, now
verifies real ConfigMap recovery, multipart metadata, diagnostic artifacts, static
isolation and restricted permissions. Current setup/fixture coverage is 52 tests.
No extension download service, upstream rebuild or scanner was used.

There is no legacy Velero extension test baseline. The official extension and host
integration conventions are reference assets, not pre-existing Velero coverage.
The integration test and the suites of the views run from this repository, under
its Vitest, with their helpers in [`integration/helpers`](../../integration/helpers/),
in the Freelens that `FREELENS_APP` names: nothing is copied into a checkout of
Freelens, and no test of Freelens is run or replaced.

## Primary Validation Stack

| Layer | Planned tooling and dependencies | Proves |
| --- | --- | --- |
| Unit/domain | Vitest; synthetic objects, fake clock, table-driven phases | Classification, durations, progress, relationships, policy and schema validation |
| Component | Vitest, Testing Library 16 on React 19, the stub of the SDK and the doubles of the components of the host | States, accessible interactions, forms, tabs and no implicit diagnostic writes |
| Main contract | Vitest with injected Kubernetes adapter and loopback HTTP/TLS test servers | IPC validation, create-only behavior, retry policy, abort, size limits and sanitized errors |
| Kubernetes integration | Real local kind, pinned Velero/plugin and authenticated local S3 backend | API schema acceptance, generated names, controller outcomes, artifacts and permissions |
| Packaged application | Freelens v2 at the validation target, started by `_electron.launch` of Playwright in an isolated profile | Tarball installation/activation, host APIs, navigation and actual UI behavior |
| Pre-review | Same local app plus deterministic DOM checks and synthetic screenshots | Both-theme layout, links, focus, menu safety and regressions before manual judgment |

Unit/component and main-contract tests are reachable through the canonical
`pnpm test:unit` script. It builds, runs the tests, and once they ended runs the
measures, the files `test/**/*.measure.ts`, by a configuration of their own, one
file at a time, so that nothing of the tests runs beside what is timed. Do not add
another runner that bypasses that gate.
The host packaged integration runner remains a separate documented runtime gate;
Vitest alone is not a packaged-app result.

## Integration Tests

The integration tests run from this repository, under its Vitest
(`vitest.integration.config.ts`, one file at a time, no retry), in the Freelens
that `FREELENS_APP` names, started by `_electron.launch` of Playwright in an
isolated profile, as the [suites of the views](#suites-of-the-views) start it.
`pnpm e2e:integration` builds and packs the extension and runs them against the
disposable environment of this repository, checking its target before and after;
the [workflow](../../.github/workflows/integration-tests.yaml) builds Freelens from
source at the commit of the validation target, cached by that commit, brings the
environment up with `pnpm e2e:cluster:up`, which installs Velero and the CRDs of
the reviewed release and places no fixture, runs them, uploads the screenshots of
a failure as `integration` and always takes the environment down.

FND-10, the [test of the installation](../../integration/__tests__/extensions.tests.ts),
installs the tarball from the Extensions page of an isolated profile and checks
that:

- the extension is listed as Enabled, in a Freelens whose major version is 2;
- the host imported the main entry, `dist/main.js` of the build it manages in the
  profile, and the renderer entry from its own scheme, both extending the classes
  of the host, and linked the one stylesheet, `dist/renderer.css`, in the head of
  the window; the case proves that it reads the module of the host and not a copy
  by the scripts the debugger of the process lists before and after;
- the dispatcher of the host process is as it was before the installation;
- the bundled transport downloads and decodes an artifact inside the main process,
  keeps the signed query and the Host header, turns a 404 into a missing artifact
  without the URL in its message, and refuses a URL of another origin;
- the files of the log of the host hold the activation of the extension, and no
  line at the level of an error, nor does what either process wrote.

No cluster takes part in FND-10. Beside it, the integration test of the template
has a session for each of the five kinds of the first milestones (the three of
SPEC-0014 get theirs with their fixtures, in a later pull request of T5.1, as the
amendment of 2026-10-27 of SPEC-0015 says), each a file of its own,
[`backups`](../../integration/__tests__/backups.tests.ts),
[`restores`](../../integration/__tests__/restores.tests.ts),
[`schedules`](../../integration/__tests__/schedules.tests.ts),
[`storage-locations`](../../integration/__tests__/storage-locations.tests.ts) and
[`snapshot-locations`](../../integration/__tests__/snapshot-locations.tests.ts),
made from [one helper](../../integration/helpers/velero-kinds.ts). A session places
one synthetic object of its kind, which the CRD of the reviewed release accepts, in
a namespace of its own, `velero-integration-<list>`, which no server of Velero reads,
both labelled `freelensapp.io/velero-integration-session`, after it removed what an
earlier run left; it starts Freelens with the isolation of the suites, with the
kubeconfig of the environment as the one cluster of the catalog, and checks three
cases: the page of the kind, reached from the sidebar, lists the object; the details
of the host, opened from the list of the host for the kind, which is reached by its
address while `customResources` keeps the kind out of the Custom Resources tree,
show the section of the extension, with the installation, the way to the view and
no error page; the menu of the object holds the commands of the host, Edit and
Delete, and no item of the extension, which registers none. A session fails on an
error of either process or of the files of the log, and on its namespace left: the
runner refuses any labelled namespace that is still there at the end. The views are
driven by their own [suites](#suites-of-the-views), against the fixtures of the
environment.

## End-To-End Tests

The [scripts](../../e2e/scripts/) create a dedicated kind cluster,
`freelens-velero-dev`, with Velero, its AWS plugin and SeaweedFS, every image an
official release pinned by digest. The contract is
[SPEC-0004](../specs/SPEC-0004-test-environment-every-platform.md).

| Command | What it does |
| --- | --- |
| `pnpm e2e:cluster:up` | Installs the pinned kind and kubectl, pulls the images, creates the cluster, installs the storage and Velero, verifies the environment. Run again, it resumes the environment it owns |
| `pnpm e2e` | Builds the extension, then runs the fixtures and the transport proof: real backups and restores of synthetic data, their artifacts fetched through the compiled main |
| `pnpm e2e:cluster:down` | Deletes the node, the network and the state the journal owns, after the identity check. The installed binaries stay |
| `pnpm demo:up` | Brings the environment up and leaves the fixtures in place, to look at them in Freelens |
| `pnpm demo:down` | The same as `pnpm e2e:cluster:down` |

What a machine needs: Docker with four processors and 6 GiB of memory or more,
and Node.js of `.nvmrc`. kind and kubectl are downloaded from their official
releases, checked against the checksums pinned in
[local-platform.mts](../../e2e/scripts/local-platform.mts) and kept under the
private state: the binaries of the host are neither used nor changed.

| Platform | Host | Network shape |
| --- | --- | --- |
| Linux x64 and ARM64 | developer machine, hosted runner | internal bridge |
| macOS x64 and ARM64 | developer machine with Docker Desktop | published loopback |

The platform of the images comes from the Docker daemon. The registry is asked
only for what the machine does not have: an image that is already here with its
pinned digest is not pulled again, and the index of a pin is read once, from the
engine when it holds it. The pins that were read are remembered beside the
installed binaries and outlive the environment. On the internal bridge
Docker gives the network no route outside and the host reaches the API server at
the address of the node. Where the host cannot reach that address the bridge is
not internal, the API server is published on `127.0.0.1` only, and the egress
rules of the node, installed before the first workload, are what holds the node
back. The identity check accepts these two shapes and nothing else. On both, the
resolver of Docker is refused to the node and to its pods: no name outside the
cluster is resolved.

The private state is `~/.local/state/freelens-velero-dev`: the ownership journal,
the generated credentials, the kubeconfig of the environment, the log of the
operations. The default kubeconfig of the user is never written: its hash is
compared before and after every run. The log withholds the body of every Secret
and every token, and every command ends by searching it for the generated
secrets, as they are and encoded. A run killed halfway leaves `run.lock` in the
state: the next command names it, and after removing it `pnpm e2e:cluster:up`
resumes from the phase of the journal. When the creation of the node itself was
interrupted or failed, the command says so, with the reason of the failure:
`pnpm e2e:cluster:down`, then `pnpm e2e:cluster:up`. The removal finishes what an earlier removal left halfway,
and the verification removes what an earlier verification left of its temporary
check, by the label of its owner and by its uid.

The [workflow](../../.github/workflows/e2e-tests.yaml) runs the three commands on
the hosted runner for every pull request. It uploads nothing of the private
state.

Renovate follows the pins. kind, its node image and kubectl move in one pull
request, Velero and its plugin in another. The checksums of kind and kubectl are
replaced by hand with the ones of the release. `.nvmrc` follows the Node of
Freelens, with the configuration of the template, and its pull request says that
the image of the helper moves with it by hand: its tag, its digest and the version
the direct proof checks, then the transport proof run in its four modes. Each pull
request of a pin of the environment asks for the
[upstream drift watch](PROCESS.md#upstream-drift-watch) before the merge.

## Suites Of The Views

The [suites](../../e2e/__tests__/) drive the views in a packaged Freelens v2, with
the packed build of the extension installed in an isolated profile, against the
test environment with its fixtures left in place. They run from this repository,
under its Vitest (`pnpm test:integration`, the configuration of the template, one
file at a time, no retry), with the helpers of
[`integration/helpers`](../../integration/helpers/), and start the Freelens that
`FREELENS_APP` names, through `_electron.launch` of Playwright, which reaches the
main process of the application as well as its window: a bundle, a folder or an
executable, and never one installed in `/Applications`. On a machine of a
developer it is the nightly of the validation target, v2.0.0-0-nightly-2026-10-25,
built from `7801fb10`, its download checked against the checksum the release
publishes beside it; in CI it is Freelens built from source at that commit, as the
[views workflow](../../.github/workflows/views-tests.yaml) builds it, cached by the
commit. On a Linux without a display the runner starts them under `xvfb-run`.

| Command | What it does |
| --- | --- |
| `pnpm demo:up` | The environment with the fixtures left in place, once |
| `pnpm demo:views` | The fixtures of the views and of their tabs, and for who looks at the demo by hand the kubeconfigs of its two readers and what each artifact of the tabs holds: see [TRY-IT.md](TRY-IT.md) |
| `pnpm e2e:views` | Builds and packs the extension, puts the fixtures of the views and of their tabs in place, waits for the server to remove the requests to Velero it removes, tells the suites what the artifacts of the tabs hold, makes for the run the identity of the views that may not port-forward and the one whose token an `exec` plugin gives, and gives the suites the kubeconfig of the first in `E2E_NO_PORT_FORWARD_KUBECONFIG`, the one of the second in `E2E_EXEC_PLUGIN_KUBECONFIG`, and in `E2E_EXEC_PLUGIN_RUNS` the file of the private state where its plugin, [`local-exec-credential.sh`](../../e2e/scripts/local-exec-credential.sh), names the executable of the process of each of its runs, runs the suites, then removes the two identities, their kubeconfigs, the token of the plugin and that file |
| `E2E_TEST_PATTERN=velero-e2e-journey pnpm e2e:views` | The same for one suite. The pattern is a part of the names of the files, or several separated by spaces: CI runs `velero-e2e pre-review extensions`, every suite, the pre-review and FND-10, in one run |
| `pnpm pre-review` | The pass before the review of a milestone |

| Suite | What it proves |
| --- | --- |
| `velero-e2e-journey` | Nothing is asked before a view opens; the choice among the installations; the list of every phase; the workspace, which opens at its summary, the first of five tabs, with the ways of the summary and no field; the references that lead somewhere and the ones that do not; equal names in two installations; no way to select, edit or delete; the section in the details of the host, whose link leads to the view with the drawer gone and no error in the files of the log. On v2 as well: the identifier of the cluster the same in the address of its frame and in the catalogs of both processes, and the reads of the views leaving from the frame, the same ones the API server counts; every page with the tabs of the group, and its kinds out of the Custom Resources tree of the host until the extension is disabled, eight since the first pull request of T5.1, with the nine entries under Velero; the search of the host with the focus when a list opens, and given it back at Ctrl or Cmd with F; a view opened from a row under the details of the host, which stay over it and over what its ways open until they are closed, since the click of a way draws its target again before it reaches the window, where the suite reads it; no action of the extension that opens the details of the host, but the links of the host to the pod and the node of an operation of the volumes, which the views of the suite do not show; and a section of the details that throws, kept in its place with the error page of the extension, the rest of the drawer and of the cluster view left, and the error in the log of the frame with the name of the extension. 19 cases |
| `velero-e2e-overview` | The Overview as the first entry under Velero, with what the API server counted when it opens; what was read of the five families; what needs attention by its rules, in its order, with the reason of each; what is in flight; the newest completed backup; the three windows, on the line of time and in the list; ten lines of twelve schedules; every way of the page followed, and the way back; the installation of the demo as the fixtures of the tabs leave it, with what ended with a failure inside the window computed from the times the cluster holds, the backups synced from the store at their start, the count of the items and the newest completed backup by the time each completed; no value of the whole in any installation; two thousand operations within the budget, and the scroll after a read; since the second pull request of T3.3 the adherence of the schedules: the summary and the line before the items of the schedules whose adherence is not known, by reason, with its way to their list, in each installation, the count computed from the fixtures; rule A11 in the installation of the views exactly when its schedule that names its zone is overdue, computed by the suite from its creation and the clock through Intl; the next run and the adherence on the lines of the schedules, and, in a window of 1440 by 900, the band of the schedules alone on its row and the storage under it, each table of lines with all its columns in the room of its band and none reached by scrolling it, no words of the lines clipped with no ellipsis and no tip and none off the line of their row, at the zoom of 1 and at twice it, what each table shows, cuts and leaves behind the scroll of its band written in the report `overview-lines.json`; since the third pull request, the schedule the controller validated in the installation of the demo, with its line, awaited, and no item; the interval of the views overdue, an item of rule A11 at every hour, so that every rule gives an item; and the schedule that names its zone with a line among the ten when a rule names it; since the first pull request of T5.1, the nine entries under Velero and the tabs of the group, and, the installation chosen, its six families read in its namespace, the backup repositories among them, and none of the pod volume operations |
| `velero-e2e-preferences` | What is kept between two starts of the application, which is the two maps of the namespaces, the window of the recent operations and what the operator allowed the downloads to do, and nothing else; a namespace that is not there any more stays selected; what the file says was allowed is shown in the target bar, one is taken back through the main process, the one that is left is found at the next start, and once the last is taken back nothing is allowed at the start after it |
| `velero-e2e-restores` | The list of every phase of a restore; a restore as Velero keeps it, with where it restores into and the scope it carries, which opens at its summary under the five tabs, with the ways of the summary and no field; one that failed its validation, with no time and no backup made up; a source that is not there; the way between a restore and its backup in both directions, over the list the first view was opened from; no way to select, edit or delete; the section in the details of the host, whose link leads to the view with the drawer gone and no error in the files of the log |
| `velero-e2e-restricted` | The views for an identity that reads three kinds of one namespace: what is denied is said, and is neither absent nor empty; a location shown with the Secrets it names, to an identity the API server refuses the Secrets to; the Overview, which says what the rules did not look at and, since the second pull request of T3.3, of how many schedules the adherence is not known; since the fourth, the interval of the views overdue and the schedule of five fields not known for want of an offset; since the first pull request of T5.1, the lists of the backup repositories, the pod volume backups and the pod volume restores denied, with no row and no count, and no notice of the backup repositories over the view of a backup, which shows nothing of them, as decided while implementing, on 2026-10-26 |
| `velero-e2e-restricted-restores` | The views for an identity that reads the restores and the schedules and not the backups: the source of a restore, the history of a schedule, the backups that name a location and the newest completed backup of the Overview are said denied or not known, and are neither absent nor empty; since the fourth pull request of T3.3, the interval of the views overdue with the words that whether a backup holds the submissions is not known, in its row and in its band, the schedule of five fields not known since the backups are denied, and the count by reason of what is not known on the Overview; since the first pull request of T5.1, no notice of the backup repositories over the view of a restore or of a schedule, which show nothing of them, as decided while implementing, on 2026-10-26 |
| `velero-e2e-schedules` | The schedules Velero took, refused and has not read, with paused and validation as two facts; the last submission beside the newest backup; the history of a schedule, from the newest, on its line of time and in its list, with the backup that never started at the time it was created; the template and where its backups go; the way between a schedule and its backups in both directions; no way to edit, pause or run; the section in the details of the host, whose link leads to the view with the drawer gone and no error in the files of the log; since the first pull request of T3.3 the next run and the adherence of each schedule: a run said of the schedule that names its zone, computed by the suite from its creation and the clock through Intl, never by the code of the extension, and none of the paused, refused and not read ones, the ones of five fields not known for want of the zone of the server; the band of a schedule line by line; the items of the details agreeing with the row; the order by the next run and by adherence both ways, a search by the word of a state; and the columns at each edge of the room of the list and in a window of 1440 by 900, before the case that resizes a column, with no words clipped with no ellipsis and no tip and none off the line of their row, the width of the window and the zoom of each room written in the report `schedules-rooms.json`; SCHED-03 restated outside the cells, the band and the items; since the third pull request, twelve schedules in the installation of the views, the interval that submitted two days back overdue and first in both orders, and the one of five fields that submitted not known for want of the zone of the server; since the first pull request of T5.1, the nine entries under Velero and the tabs of the group |
| `velero-e2e-adherence` | The adherence of the schedules on its fixtures, placed by the clock in the three installations the operator names, and on the schedule the controller of the demo validated, each expectation computed by the helper of the suites, [`velero-adherence.ts`](../../integration/helpers/velero-adherence.ts), from the objects as the cluster holds them and from the clock, by the rules of the controller and never by the code of the extension, at the clock before a read of the page less twenty seconds and after it plus a second, with every duration read back into its span: first the nineteen cases of the helper, of the words the suite expects and of the counters it reads, which start no application; then the list of the installation of the states, its eight schedules with their next run, their state, their mark and their words, a tip on each cell, shown only when the cell is pointed at, and the note that the clock of the cluster is ahead, within a second of this machine by the time of its API server; the orders by the next run and by adherence both ways and a search by the word of a state; the band of each schedule line by line; the way to the held backup and back over the list, which is where it was; the installation of two offsets, the older submission before the newer and the change said; the details of the host of a schedule of five states, and of a schedule of another installation, not known for want of the offset of its server; the Overview with the items of rule A11 in the order of the page and the count by reason of the installation of the views; the real schedule, Enabled, nothing submitted, its next run a year after its creation in its row, its band and its line; ADH-16 in the packaged application, ten searches and ten orders of the list of three hundred schedules and twenty changes of the window of their Overview, in the reports `adh-16-list-performance.json` and `adh-16-overview-performance.json`; and the guard, with the PATCH the controller sends the schedule it validated at each look, of that schedule by its name, left out and bounded, of no other scope, no POST of a backup, and only reads with the Schedules and then the Overview open for a period of the reads each. 30 cases |
| `velero-e2e-locations` | The storage locations with availability, access mode and default as three facts; the location the controller validates, which is not late, and the backups that name it, by how each ended; the synthetic ones, which are late; none and two marked default; a message of many lines; where a location points and the Secrets it names, by their names; what uses a location, and the way to it and back; the way from a backup, a restore and a schedule to their locations; the snapshot locations, with a phase that has the mark of what is not known, and one a synced backup names that the installation does not have, said absent by the list and by the workspace of the backup; no way to select, edit, delete or set as default; the sections in the details of the host, the link of each of the two kinds leading to its view with the drawer gone and no error in the files of the log; since the first pull request of T5.1, the nine entries under Velero and the tabs of the group |
| `velero-e2e-volumes` | The backup repositories, the pod volume backups and the pod volume restores, on the fixtures that exist, where none of them is: the three lists empty in the installation of the views, each saying of what it is the list; the repositories of the installation of the demo, none since no backup of the file system ran; the reads of the pod volume operations counted on the API server, one list of a family at each read while its list is shown, and none while the list of the backups or the Overview is; nothing written. 4 cases, 312 seconds alone in the packaged application on 2026-10-27, 273 of them the waits of the reads it counts, and 312 seconds in the run of the pattern of the hosted job that day; on the hosted runner, 289.88 seconds in the first run of the job, on 2026-10-27, and 290.73 in the second, as the reporter of the job prints them |
| `velero-e2e-scale` | A thousand backups and a thousand restores: the rows that are mounted, the time of the interactions, the state of each list when an object is opened and closed |
| `velero-e2e-gate` | The gate of the writes: off when the session starts, on every page of the group; on through the dialog of the host, which names the cluster, its context and the namespace, and not before the dialog is answered; off when another installation is selected, when the dialog is left, and when the application is started again; each frame of a cluster with a gate of its own; on v2, every request bound to the frame it comes from by the address of the frame that a handler of the main process reads, a request of the second frame for the first cluster refused; nothing of it in the store, and nothing written to the cluster |
| `velero-e2e-server` | The band of the server in the Overview: nothing asked of the cluster when the page opens, nor for a command that is not confirmed; the object shown before it is created, reached with the keyboard alone and left with Escape; the version and the plugins of the real server of the environment, against what the server wrote into the request, each plugin once; kept through a read and a visit to another page, and dropped with the installation; the answer and the confirmation in both themes, at every size; a request no server answers, said not answered after ten seconds and left as it was created; the refusal of the cluster to the reader of a part, with writes left on; what the API server counted of the requests, by verb and by code; the request the server processed, removed by the server five minutes after |
| `velero-e2e-artifacts` | The tabs in the workspace of a backup and of a restore, on the real backup and the real restore of the installation and on the fixtures of the tabs. On the real operations: the five tabs in their order, as a list of tabs, with the tab in the address; nothing of a DownloadRequest created or read when a tab opens, by a click or by its address, nor for a confirmation that is left; the first state with writes off and on, and the confirmation with the object, reached and left with the keyboard alone; the four artifacts of each, loaded through a request of their own, which the cluster holds by the name the tab gave it, with the steps of a load, a load again as another request and a load cancelled as soon as its command is offered; the log in its lines, its levels, its search, its lines wrapped, a line copied and a hundred rows mounted at most, against the file the suite saved of it; the results against the counters of the status; the resource list, with the actions of a restore and the filter; the volume information of no volume; the log saved into a file through the dialog of the host, and nothing written when the dialog is left; the keys of the strip; the section in the details of the host; the tabs in both themes, at 900 by 650 and at twice the zoom, checked for what lies over something else, is wider than its room or is cut; what the API server counted of the requests, and each removed by the server before the suite ends. On the fixtures of the tabs: the log of the backup synced without one, a file the store does not have, said by the phase of a backup that ended, with no command to try again, and its results, resource list and volume information, which are the empty forms, said in the words of each viewer; the logs of the backup and of the restore that failed their validation, nothing written, through a request each; the results, the resources and the volumes of the backup synced with the artifacts made for the tabs, each message in its parts, the resources sorted with their counts and the filter, each volume with its details by the names the release writes; the load of its log cancelled once its request is in the cluster and asked again, with the steps in their order and the pages rising to the last; the log of 200,000 lines saved with the digest the fixtures counted, its levels, its searches, its long lines and the one across two pages, a hundred rows mounted at most; the measures of ten searches, ten filters and twenty scroll gestures on it, within their budgets, once sixty idle frames of the window say that a frame can be timed; another installation, where writes are off and nothing of the tabs is held, and in the installation of the views, with writes on for it, the backup whose storage location is not there, said before any request; the restore asked from a schedule that has no backup, nothing to ask for; and the reader of a part, as a second entry of the catalog, refused the creation. On v2 as well: every load that ended with its text came through the tunnel, the kubectl the host prepared for the version of the cluster; the identity of the views that may not port-forward, as a third entry of the catalog, refused at the port-forward with the words that name `create` on `pods/portforward`, its request left in the cluster and no kubectl left; the identity whose token an `exec` plugin of the test environment gives, with what the documentation lists for the writes and for a download through the cluster, as a fourth entry of the catalog: the log of the real backup loaded through the tunnel, one creation counted, no kubectl left, and the plugin run by the proxy of the host alone, `freelens-k8s-proxy`, and neither by its main process, where the extension runs, nor by the kubectl of the tunnel; a disable and an enable from the Extensions page, after which the procedures are registered once each, writes are off until they are turned on, the file of the store is saved once for one change, and a load is one creation, one kubectl and one answer; the cluster disconnected in the catalog with a load in flight, its kubectl ended, nothing of the extension counted on its API server for a minute, the cluster still disconnected, and connected again, a new frame with writes off; no kubectl of the application after the refused port-forward, after the disable, after the disconnection and at the end; and the memory of the frame with the log of 200,000 lines placed whole. Twenty-five second gestures over the suite, each a request but a cancel that lands before the creation, each told to the guard by its name, written into once by the server and removed by it before the suite ends, and at the end what a failed case left in the installation of the views, which no server reads, removed with the one helper of the suites that deletes; what each tab is to show the suite reads in `tab-fixtures.json`, beside the reports. 52 cases |
| `pre-review` | Every view, 39 of them, in both themes, at 1440x900, at 900x650 and at twice the zoom, checked for what lies over something else, does not fit, or is cut by what holds the page, and the eight views of the tabs by the check of a tab as well: a diagnostic tab with writes off, its confirmation, the log of the backup that failed its validation, which the store does not have, the resources of the real restore with their actions, the log of the synced backup loaded, searched and with a level chosen, the same with its lines wrapped, its results, and its volumes with a detail open; a page that stands still at the widths where its target bar goes to a second line, and at the ones where the bar of the log does; the journeys with the keyboard alone: the tabs from the way back, with the arrows, Home and End, Enter and the address, the command, the confirmation and the command that creates, the focus after a load, after a cancelled load and after a failure with no command to ask again, and the search by its label, with its count told to who does not see, against `tab-fixtures.json`, which it reads beside its reports. It tells its guard the requests it asks for, five, or six when its cancel lands after the creation, and waits for the server to remove them before its last case. Its reports are `pre-review-layout.json`, every layout with what the two checks found, and `pre-review-tabs.json`, the views with their requests, the facts of the journeys, the ledger and the items left to human judgment. Since the fourth pull request of T3.3, the list of the installation of the states of the adherence, the band of its held schedule, the band of its schedule with a name of 63 characters and its Overview, every mark of the adherence hidden from who does not see it with its word beside it, and the band read with the keyboard alone, from the list to the schedule, to the backup that holds it and back on the way back and on the row. 35 cases |

The check of the layout, which every suite asks of the pages it shows, looks at
the page and at what holds it, up to the frame of the cluster: what is wider
than its room, what lies over something else, and what holds more than its
height without being scrolled by who reads. The last is what the keyboard
scrolls when it brings what it reaches into view, and what the host cuts in a
room that is too short. The suite of the tabs asks as well a check of the parts of
a tab, which the one of a page does not know: no tab of the strip, part or command
of the panel, part of a viewer, part of the bar of a log or of the filter of a
resource list over another, the panel and the viewer no wider than their room, a
view with the room of a list at least, and a list no taller than the room it is
read in; the strip of the tabs no wider than its room, a rule that finds a strip
that overflows sideways, cut or pushing the view, and not one the host wrapped to
a second line, which is no wider than its room and is left to human judgment, as
the pre-review saw it at twice the zoom, and the one rule of the check this pull
request adds that was not seen failing, no change being made for it; and the rows
of the results, of the resources and of the volumes, twenty each, as the check of
a page looks at the rows of a list: no cell over the one before it, no message
wider than its room, no part of a detail over another. The pre-review asks the
check of a tab of the eight views of the tabs, beside the check of the page.

The suites read the application and the cluster, and write to neither, but for
two, each of which asks the extension for the write it proves. The suite of the
band of the server asks the extension to create a ServerStatusRequest, in the
namespace of the installation, in a namespace of the fixtures and, refused, as the
reader of a part. It leaves nothing behind. It waits for the server to remove the
request it processed, which the release does when it looks at it again, five
minutes after; and it removes the one no server looks at, with the one helper of
the suites that deletes, which takes the requests of one kind, ServerStatusRequests
or DownloadRequests, that carry the label of the extension in a namespace of the
fixtures, and nothing else. The suite of
the tabs asks the extension to create DownloadRequests, of the artifacts of the
real backup and of the real restore and of the fixtures of the tabs, in the
namespace of the installation: twenty-four, each after its confirmation, the four
of the restore, the four of the backup and the log of the backup a second time, the
four of the backup synced without a log, one each for the backup and the restore
that failed their validation, the three of the synced backup and the two of its
log, the first of them cancelled once its request is in the cluster, and four of
the checks of Freelens v2: the log of the backup asked by the identity that may not
port-forward and by the one whose token an `exec` plugin gives, the large log after
a disable and an enable, and the one whose cluster is disconnected while it loads;
and it
cancels one load of the real backup as soon as its command is offered, which in
the local runs ended before it created one. The pre-review asks for five, or six
when its cancel lands after the creation, and tells them to its guard the same
way. Each tells its guard the name the tab gave each request, and expects the API
server to count as many creations and as many removals as the guard knows, the
reads of each by its name, at least as many, the writes of the server into them,
one for each request, and no write of another kind of Velero. In the installation
it deletes none, and neither does the extension: the server of the installation
removes a request once the ten minutes it wrote into it have passed, as the
[recon](RECON-T0.1.md#start-of-the-third-milestone-2026-09-30) records, and the
suite waits for that before it ends, which makes it the longest of the suites: 769
to 828 seconds alone in the nine runs of 2026-10-07 with the case of the
measures, 777.9 in the last of them on the final code of the measures and 796.4 in
the one on the final head, of which 568 to 624 the wait of its last case for the
server, which ended 600 to 657 seconds after its last load; in the run of
the twelve suites of the final runs of the same day, 789.8 seconds of the 1,862.7
of the run, with a wait of 588 seconds, 617 after its last load, and the
pre-review 714.5 seconds alone in those runs. After that wait, the suite removes
with the one helper of the suites that deletes the DownloadRequests of the
extension a failed case left in the installation of the views, which no server
reads, and says what it removed: nothing, in a run where every case passed. It
saves the log of the backup and the one of 200,000 lines into a
folder of the profile of its run, which goes with the run, through the dialog of
the host, which it replaces in the main process of the application with one that
answers what the case asks. The helper that runs
`kubectl` for the suites refuses every verb but `get`. Each suite compares what
the API server holds of Velero before and after: the version of every synthetic
object, the identity of the objects of the real installation, the version and the
status of the schedule its controller validated, and the absence of any request to
Velero. A request is listed by its namespace, its kind and its name, and never
read whole: the status of a DownloadRequest the server processed carries the URL it
signed.

What is asked of the cluster is counted by the API server, not by the driver of
the test: on v2 the reads of a frame of a cluster, the host's and the views' alike,
leave from the frame through Chromium, to
`https://<clusterId>.renderer.freelens.app:<port>/api-kube/...`, where the driver
sees them, and the requests of the main processes of the host and of the extension
leave where it does not; the API server counts them all. The suites read
`apiserver_request_total` for the group of Velero. A list of backup storage locations in the whole cluster is what the
discovery of the extension asks: the controllers of Velero ask for their own
namespace, and what the control plane of the cluster asks of every kind is a
watch, which the suites leave out. The count of that list says when the
extension asked, and how many times.

The requests of one kind are counted by their verb and by the code of the answer
as well, without the lists and the watches, which the server of the installation
asks on its own. A request the API server refuses to the identity is not among
what it counts: the creation the reader of a part is refused leaves the counters
as they were, and is proven by the words of the band, by the namespace, which
holds no request, and by no creation counted.

The server of the test environment is the reviewed release as it is, and not as
a fixture would make it: it lists every BackupItemAction and RestoreItemAction
twice in a ServerStatusRequest. The suite expects of it what the release does,
and a release that lists them otherwise is one to read again.

The application reads the kubeconfig of the user when nothing tells it otherwise.
The profile of the suites is a folder under the temporary folder of the system,
the one place where the host takes `<profile>/Freelens/home` as its home, and its
store is written before the first start with the kubeconfig of the environment as
the one file to sync, or the one of a reader for the suites of the readers: the
catalog holds the test cluster alone, which the suites assert before they open it,
at every start. On macOS the application is started with `CFFIXED_USER_HOME` in
the profile, so that its logs are written there and not in the folder of the logs
of the user. The screenshots are of the frame of that cluster, never of the window
around it, and show synthetic data. The profile names the theme too: left to
itself the application takes the one of the system, which is not the same on every
machine. The files of the log of the host stay in the profile, and go with it.

What collects the errors of a run reads the lines the host writes at the level of
an error on the output of its process, and the console of the window; FND-10 and
the checks of the host read the files of the log as well. Every such line fails
the suite but a few, each said by its address or proven by its case: the record of
a request of the proxy of the host that its client gave up on, which closing a
drawer makes; the record of the check of the host for its own latest version, which
its welcome page asks of the npm registry with a limit of five seconds, when the
network of the machine gives no answer in time; a resource of the build of the
host itself that the window failed to load, which a loaded machine was seen to make at a start; an answer 401, 403 or 404
to a read of a frame of a cluster, which on
v2 the browser writes in the console of the frame when an identity is refused a
read, the host's own reads among them. A load of a frame that a disconnection
aborts, with the code -3, when it takes the frame of the cluster out, the host logs
at the level of debugging, and the suite of the tabs reads in Electron that each
is of a frame. It leaves out every answer 401, 403 or 404 to a read of a frame
of a cluster, the reads of the views among them: a view that reads a wrong path is
no error for the collector, and fails only the suite that asserts its state.

When a suite closes the application it ends what the application started and
left behind, the proxy of every cluster it opened among it: a machine that runs
the suites many times is left as it was.

Every step of a start has its time and its name: the end of the application, its
start, the way to the catalog, the row of the cluster, its frame, its sidebar. A
step that does not end says which one it was, with a picture of the window.

The host gives its loader ten seconds to see an extension it unpacked among the
ones it loaded, and on a busy machine it gives up, with a notification that the
installation failed: the extension never appears as installed, or appears and
stays disabled, and a second attempt in the same application gives up as well. Every
suite starts the application through `startWithExtension`, which closes an
application the host gave up in, removes its profile and starts another one in a
new profile, once. The second start is proven on purpose, not assumed: a file
`e2e-artifacts/stall-the-host-once` makes the helper hold the main process of the
application for thirteen seconds right after the install is asked, the host gives
up, and the suite passes on its second start. The file goes when it is read.

| Fixture of the views | Namespace | Purpose |
| --- | --- | --- |
| References | `velero-views-<run>` | A backup with a schedule, a storage location, a snapshot location and its restores; backups that name a schedule and a location that are not there; a name of 63 characters; a backup that reports nothing; a name that the namespace of the phases has too |
| Restores | `velero-views-<run>` | A restore as Velero keeps one it took: into two namespaces, in flight with a failure, with the schedule of its backup written beside the backup, the resources Velero excludes and the timeout it fills; one asked from a schedule that has no backup, which failed its validation; one of a backup that is not there any more |
| Reader | `velero-views-<run>` | A service account that reads backups, schedules and storage locations of its namespace. Its token lasts two hours and its kubeconfig is in the private state for as long as the suites run |
| Schedules | `velero-views-<run>` | One with a history: a backup a day for six days, two of them an hour from each other, and the newest that failed its validation and never started; one that names its time zone; three whose backups go to a location that is not there, to one that is read-only, and to the one marked default; two that Velero has not read, one of them created paused; one in the phase New, which the API has and the release does not write; one that was read, then paused and asked to skip; and, since the third pull request of T3.3 of SPEC-0013, two that submitted two days before the fixtures were started and have no backup, one of five fields, whose zone is not known for want of a submission with its backup in the installation, and an interval of six hours, overdue at every age of the environment. The ones Velero read carry `skipImmediately`, which it writes into every schedule it reads, and the last submission of the one with a history is the time its newest backup was created |
| Second reader | `velero-views-<run>` | A service account that reads restores, schedules, storage locations and snapshot locations of its namespace, and not the backups |
| Locations | `velero-views-<run>` | Storage locations: one that names its frequency and one that names none, each with a validation that is days old; one whose name and bucket have 63 characters and whose prefix has many parts; one without a status; one unavailable, with a message of three lines; one that names the Secret of its credential and the one of its certificate, with the validation and the sync turned off and an address that carries a query. A snapshot location with a phase, and one without a status that names the Secret of its credential. No Secret is among the fixtures |
| Defaults | `velero-defaults-<run>` | Two storage locations marked default, the one that is read-only created first. The one the release would keep is the one created last; of two created in the same second it is not settled which. The suite reads when each was created, and expects what the view says of that |
| Overview | `velero-overview-<run>` | An installation no controller reads, placed by the clock: a default storage location validated two days before, one that is unavailable, one that reports nothing; twelve schedules, of which one was refused, one was not read and names the location that is unavailable, one is paused, and two carry the time of the last backup the release asked for them; backups and restores that ended one hour to forty days before, some with a failure; operations in flight, at work, waiting with its place in the queue, and with a failure; a backup a client asked from the schedule that was refused, and a restore, which failed their validation and never started |
| Long lists | `velero-scale-<run>` | A thousand backups and a thousand restores in every phase, spread over the thirty days before they were placed, each restore of one of the backups, and no storage location: nothing suggests the namespace, the operator names it |
| Tabs | `velero-demo` | Two backups the server syncs from files the store is given: one that failed in part, with the four artifacts made for the tabs, and one that completed with no log. A backup and a restore the server refuses for naming both kinds of selector, and a restore asked from a schedule that has no backup. See [the fixtures of the tabs](#the-fixtures-of-the-tabs) |
| Adherence | `velero-adherence-<run>` | An installation no controller reads and nothing suggests, placed by the clock in two phases: eight schedules, awaited, overdue by a day and more with no backup of its submission, held beyond the grace by a backup in progress asked by hand, submitted at every look, its zone derived from the backup of its own submission, with no submission and the offset of that one, with its last submission a day after the placement, and one with a name of 63 characters and an expression that names its zone. See [the fixtures of the adherence](#the-fixtures-of-the-adherence) |
| Two offsets | `velero-adherence-split-<run>` | Two schedules of five fields whose submissions were named two hours east of UTC and at UTC, the older twenty seconds before the newer, placed by the clock in two phases |
| Budget of the adherence | `velero-adherence-scale-<run>` | Three hundred schedules of the expressions of the measure of the unit run, each with the backup of its submission named two hours east of UTC, placed by the clock in two phases, and no storage location |
| Real schedule | `velero-demo` | One schedule the controller of the installation validates, `@every 8760h`, whose next run is a year after its creation, with the spec of the real backup as its template and no `skipImmediately`, which the controller writes. See [the fixtures of the adherence](#the-fixtures-of-the-adherence) |

They are put in place by `pnpm e2e:views`, once: a second run finds them. The
times of the history of a schedule are counted back from when the fixtures were
started, which the environment keeps: a second run asks for the same objects. No
controller of Velero watches these namespaces, but `velero-demo`, where the
fixtures of the tabs are, and the schedule its controller validates. They go with
`pnpm e2e:cluster:down`, or with the cleanup of the fixtures.

The fixtures of the Overview, of the long lists and of the adherence are placed
by the clock: their times are counted back from the moment they are put in place,
which each object says in an annotation, so that a window of the last day holds
some of them. They are good for twelve hours. Each says as well what it was made
as, which is a digest of the fixtures of its namespace. A run that finds them
older, finds them placed at a time that is after its own, finds that one is
missing, or finds that they are not made as it would make them, removes the
objects of its own run from that namespace and creates the ones of now; it removes
nothing when it finds there what is not of its run, and places nothing by the
clock in another namespace, the others of the run among them. The ones of the
adherence are placed in two phases, by the clock of this machine read when their
placement starts, as [their section](#the-fixtures-of-the-adherence) says.
What the suites expect of them holds for the twelve hours: an operation of three
hours before is of the last day until the fixtures are placed again. The
operations that never started are at the time they were created, which is the
one of the placement to a second or two: the suites expect them first, in any
order among themselves.

No controller validates a synthetic location: what one reports is of a
validation that is days old, whatever the age of the environment, and the views
say that it may be out of date. The validation that is fresh is the one of the
location of the installation, which its controller validates every minute. The
locations of the namespace of the phases have a phase and no validation time,
which the release writes together: they are what a view shows of a status that
carries one without the other.

The backup the controller of the environment runs is kept for thirty days, the
retention the release gives when none is asked: the release deletes a backup that
expired, and its restores with it, and the views of the installation would have
nothing to show an hour after the environment came up.

The line of time of that history goes from its oldest backup to now, so what is
drawn depends on how old the environment is. What holds at every age is checked
at every age: each backup is on the line, from the oldest, and no mark is drawn
over another. What is expected of the days, each with its mark, is expected while
a day is wider than two marks on the line: in an environment older than that the
suites stop and say to create it again, which a hosted run always does.

The status of a synthetic operation is what the reviewed release would have
written into it in its phase, and nothing else. One that did not start, which is
one that is New, Queued or ReadyToStart or that failed its validation, has no
start time, no end time, no progress and no counters: the release writes the
start time when the validation passes. The release writes as well the version of
its format and its expiration into a backup it takes, before it validates it: the
synthetic backups do not carry them, and a view shows their expiration as not
reported. One that started has no counter of zero,
which the release does not write, and no counter at all while it is at work; once
the work ended all its items are done. The one that failed is one the release
stopped at work: a reason, and no counter. The spec of a synthetic restore the
release took carries the resources the release excludes and the timeout it
fills; one in the phase New is as it was submitted. A fixture that gave an
operation what no installation shows would make the views pass on it: the
[facts](RECON-T0.1.md#start-of-the-second-milestone-2026-09-28) are the ones
read in the source, and the restore the controller of the environment ran is
read by the suites as well.

What the suites ask of the cluster they read on the API server, which counts
every request by its verb, its kind and its scope. A view that asks nothing is
opened in the time between two reads of the installation, with the counters read
before and after; the same counters count the reads of a read that is asked.
What must not happen, a menu or a dialog, is waited for and expected not to have
happened, and the same gesture is made where it does happen. A state that comes
with a read is waited for; a value of a row is read in the cell of its column.

The time of an interaction is taken inside the page, from the event to the frame
that shows what it changed. For a search two times are recorded: the one from the
key, and the one from the moment the host gives the list what was typed, which
comes 250 ms after the last key. The budget of 250 ms is for what the list takes
to answer, the second; the first is in the report beside it, and is what the
operator waits from the key.

The measures of the tabs, in the suite of the tabs, time a search, a filter and a
scroll of the log of 200,000 lines the same way, from the event to the frame after
the one that shows what the fixtures counted. The search of a log has no wait of
its own: the field of the viewer gives the list its words at each key, so that one
time is recorded for it, from the key. Their report, `view-10-log-performance`, is
written beside the reports of the suite before anything is asserted, with the
budgets, the baseline of sixty idle frames of the window, the rows mounted and
every time with its interaction, and once more as one line of the output,
`VIEW-10 <json>`. The case reads the file of the log the case before it saved
under the profile of the run and `tab-fixtures.json`, counts the texts it searches
in the file before anything is timed, and reads the height of one mounted row
against the one the helpers assume, so that a line height the product changed
fails by its name, which passed in the run of the suite alone on the final head on
2026-10-07. The budgets are asserted wherever the suite runs, the hosted
runner included: when the baseline says that the window cannot time a frame, its
median over 25 ms, the case fails by name and never passes for that reason, and a
second run of the job is a decision of a person, with both reports kept. The
numbers of a run go into the evidence of SPEC-0011 with the machine and the run
they are of, and a hosted number is copied from its run, never assumed: on the
machine of the runs of 2026-10-07 the case took about 4.6 s, the answers 51.1 ms
at the 95th percentile of 250, the longest frame of a gesture 15.9 and 15.4 of 50
in the two runs of the final code, 32 rows mounted of 100, an idle frame of 16.6
ms at the median. On Freelens v2, with the lists of lines on react-window 2, in the
run of the suite of T0.7 on the nightly of the validation target, on 2026-10-17:
the answers 50.4 ms at the 95th percentile, the longest frame of a gesture 21.3 of
50, 31 rows mounted, an idle frame of 16.7 ms at the median.

Their [workflow](../../.github/workflows/views-tests.yaml) builds Freelens from
source at the commit of the validation target, or takes the build the cache keeps
for that commit, and runs every suite, the pre-review and FND-10 on the hosted
runner for every pull request, in one run of the runner of `pnpm e2e:views`, within
two hours; then, whatever the suites found, once the environment came up, it
removes the fixtures of the tabs with the cleanup of the fixtures and verifies the
installation they leave. It uploads the directory of their screenshots and reports,
`e2e-artifacts/`, as `views`, and nothing else:
the private state of the environment is elsewhere, and a test of the workflow
fails if a path of it is ever named there. Since the pin moved to a commit of the
host with the fix of its list layout, the scale suite holds BACK-12 and REST-11 to
their budget, the known exception of
[SPEC-0015](../specs/SPEC-0015-freelens-v2-host.md#evidence-and-deviations) at the
target before it, and a run of the job is read as a whole: the pull request of T0.7
is merged only with every check green on v2.

### The Fixtures Of The Tabs

The tabs of an operation read what Velero wrote of it into the store. Their
fixtures are in the namespace of the installation, `velero-demo`, which its server
reads: the files of two backups the store is given, from which the sync of the
server creates the backups, and three operations the server refuses. They go with
the fixtures of the views: `pnpm demo:views` and `pnpm e2e:views` give the store
the files first, place the objects of the views and the refused operations
meanwhile, and wait for the server last, at most a minute or two, once for an
environment. A second placement finds what the first did: it gives the store
nothing, applies no refused operation again and waits for no sync. What each
holds, and where the synced backups are not what the release writes, is in the
[evidence](../specs/SPEC-0011-artifact-viewers.md#the-fixtures-of-the-tabs-the-second-pull-request-of-t23)
of their spec.

| Key of a synced backup, under `backups/<name>/` in the bucket | First | Second |
| --- | --- | --- |
| `<name>.tar.gz`, the contents: an empty archive, in gzip | Yes | Yes |
| `<name>-logs.gz` | Yes | No |
| `<name>-results.gz` | Yes | The empty form |
| `<name>-resource-list.json.gz` | Yes | The empty form |
| `<name>-volumeinfo.json.gz` | Yes | The empty form |
| `velero-backup.json`, the metadata, written last | Yes | Yes |

A folder holds none of the three lists the release writes beside these keys, of
the native snapshots, of the operations of its plugins and of the pod volume
backups: from the list of the pod volume backups the sync creates objects, and for
each native snapshot listed the deletion calls a plugin.

The client of the fixtures reaches the store through the client of the node, as
the identity that writes to the bucket of the environment alone. It may ask
whether a key of the run is there; read the artifacts the server wrote for the
real operations, and never the contents of the real backup; and write the eleven
keys above, and never read them back. It deletes nothing. A body goes with a key
of the tabs and with nothing else, while the placement is recorded as storing, or
while a removal puts back the contents it recorded; any other request with a body
is refused before the cluster is asked where the store is. The node keeps a body
in one file, which is read back by its digest before it is sent and removed
whatever happens, and sends it in one of three ways, tried in their order only
while none has passed: the file as an upload, the file as the data of the request,
and a request signed in the scripts over the digest of the body. The way that
passed is recorded, and is the way of every file after it: the store the
environment pins takes all three, and the files are sent in the first. The log of
the operations tells each request by one line, `store <verb> <key>: <code>`, with
the length and the way of a body and the length the store holds of a key it was
asked for, or with `no answer` when the client gave none of the store, and nothing
of a body and no setting of the client. An answer to whether the store holds a key
that says neither that it does nor that it does not stops the step that asked,
with what is not known: run the command again.

What the placement reached is recorded in the journal of the environment before
anything is written: `storing` while the files are written, `stored` once the
store holds every one of them with its length, and `synced` once the server
created the two backups as they were stored, which the journal then holds with the
identity the cluster gave them. Their removal is recorded as `clearing`, then
`cleared`, and no placement goes on from either. The metadata as it was stored is
in `fixture-tab-metadata.json` of the private state, written whole at mode 0600,
and ends with the record. What each artifact of the tabs holds, counted outside
the extension, is in `tab-fixtures.json`: `pnpm demo:views` writes it into the
private state, whole at mode 0600, where it ends with the record, for who looks at
the tabs by hand; `pnpm e2e:views` writes it beside the reports of the suites
instead, where the suite of the tabs and the pre-review read what a tab is to
show: synthetic facts of a disposable cluster, with no credential and no URL. A
placement that was stopped goes on at the next one, which writes the files the
store does not hold whole.

The wait for the sync reads the installation every two seconds, and counts the
passes of the sync by the time the location says its last one ended at. It stops,
with words of its own, after two passes that ended with a backup missing, which is
a server that read the store and created nothing, and after five minutes with no
pass, saying whether the location is available: the sync passes over one that is
not. A backup that is missing, and whose metadata the store does not hold any
more, was deleted through the server, which removes the files of a backup with it:
the way on is to clean the run and to make a new one. What the server created is
read back against what was stored.

The cleanup of the fixtures,
`node e2e/scripts/local-demo.mts fixtures-cleanup --context kind-freelens-velero-dev`,
removes the fixtures of the tabs first, through the server: it has the server
delete each synced backup through a DeleteBackupRequest of the run, one at a time,
the removal recorded before the first, and waits for a pass of the sync after
them. A request the server ended is replaced; one it has not ended is waited for,
three minutes, with nothing applied over it; one it began and left is replaced,
once for a backup. When the server ended a deletion and left the backup in it,
contents the store holds that are not the empty archive the fixtures make are
replaced by it, recorded before it is written. While the placement is recorded as
storing, a folder a stopped placement left without its metadata is given its
contents, when the store does not hold them whole, and its metadata, before
anything is asked to be deleted, so that the server makes the backup it deletes
the folder with. The real backup and the refused one are deleted by the same
rules, the restore without a backup by its identity, and so is the schedule the
controller validated, which the journal then forgets: the verification of the
installation refuses one that holds a schedule. Before the namespaces of the run
are removed, one check: none of the eleven operations of the run is in the
installation, each looked for by its name, nor the schedule, nor a backup that
carries its label, which would be a submission nothing here removes; and the store
holds none of the twenty keys the client may ask of the run, nine of the fourteen
the server wrote for the real backup and the real restore and the eleven of the
tabs. A cleanup stopped at
any point is taken up by the next from what that one finds. A run placed with the
fixtures of the adherence is cleaned by scripts that know them: scripts older than
them know neither the three namespaces of the adherence nor the schedule the
controller validated, would call the run cleaned with that schedule left in
`velero-demo`, and the verification would then refuse the installation. Nothing in the scripts
removes a key of the store: when files of the tabs are in the store and no backup
comes of them, or a key is left, the cleanup stops and names them, and the way out
is `pnpm demo:down`. The hosted job of the views places the fixtures of the tabs
on every run and, after the pre-review, runs this cleanup and then the
verification of the installation it leaves, before it uploads the reports and
takes the environment down: the removal of the namespaces of the views runs on the
hosted runner for the first time with the pull request that added the step. In
the final runs of that pull request, on 2026-10-07, after the twelve suites and
the pre-review, the cleanup took 118 seconds, 42 of them the two deletions the
server carried out, and the verification 22; on the hosted runner, on 2026-10-13,
the step took 112 seconds for the cleanup and 9 for the verification. After this
cleanup, or after `pnpm e2e`, the fixtures of the demo are gone with the fixtures
of the tabs: `pnpm e2e:views` refuses by name, in a few seconds, until the two
fixture steps of `pnpm demo:up` put them back, which takes about a hundred
seconds.

The runner says of a placement what it did, a line each: the files of the tabs
written by this run, with the way they were sent, or none; the time the wait for
the two backups took once the fixtures of the views and of the adherence, the
refused operations and the schedule its controller validates were placed, which is none when a pass of the sync came meanwhile, with the passes
that ended without both; the refused operations placed by this run, or each found
refused; the objects of the adherence in its three installations; the schedule the
controller validated, applied by this run or found validated; and, only when the
fixtures placed by the clock were there before, that they were put in place again,
each namespace named. A second placement says that none was written and that each
was found refused or validated. Of a removal of the tabs it says the backups the
server deleted, the deletions it waited for, the files it gave the store first, or
none, and the time it took.

Before a cleanup removes anything, and before the suites start, the requests to
Velero are read by their kind, their namespace, their name and their expiration,
with the output withheld: the status of a request for a download that was
processed holds a signed URL. A suite that was stopped, or a review by hand, may
have left some, and nothing in the scripts removes one:

- In `velero-demo` the server removes a request for a download at its pass after
  the ten minutes the request lasts, and one for its status sooner: the runner
  waits for them, twelve minutes at most. One that tells no expiration a minute
  after it was first read is one the server did not look at, which it never
  removes: the runner stops on it.
- A request to delete a backup that the server ended with an error stays a day.
  Such a request holds no URL: when `velero-demo` holds requests to delete a
  backup, the wait before the suites reads them whole, as the removal of a backup
  and the end check of a cleanup read them, and the private log of the operations
  keeps that read; it stops at once, by its name, on one the server ended with an
  error. The cleanup leaves the requests to delete a backup to the removal of the
  backups.
- One in a namespace no server reads stays for good: before the suites it is named
  in a warning, since the suites that expect no request fail in their last case
  while it is there, and it stops a cleanup before anything is removed.

The way out of each is `pnpm demo:down`.

Nothing but the suite reads the cluster while a suite of the views runs: the guard
of a suite counts on the API server the reads of the kinds of Velero in the whole
cluster, whoever sends them. A read of the requests of every namespace once a
minute, made beside the suites to watch them, failed the guard of the suite of the
schedules.

Every suite starts only when the cluster holds the fixtures it needs, each probed
by its name, the five of the tabs and the schedule the controller validated among
them by the names of the run, which `pnpm e2e:views` gives the suites, and a
schedule of each installation of the adherence, which is created after the backups
of its submissions. A suite that does not find them stops before it starts the
application, and says where each part of the fixtures comes from.

`fixtures-artifacts`, a command of the runner for the fixtures of the foundation,
moves a run out of the phase the placement of the views asks for, which then
refuses it: it is not for a demo.

In the local runs of 2026-10-06 that first placed them, on the code before the
review of the whole pull request, a first placement took 130 to 132 seconds in
all, a placement after it 75 to 93, and a cleanup after a placement 99 to 158, of
which about sixty went to the namespaces of the views after a whole placement. On
the final code, the same evening, `pnpm e2e:views` placed them on an environment
just brought up in 119 seconds, with a wait for the two backups of no time, since
a pass of the sync came while the views were placed, and the cleanup after the
suites took 104 seconds, 26 of them for the fixtures of the tabs. In the final
runs of the third pull request, on 2026-10-07, on an environment brought up in 228
seconds, `pnpm e2e:views` sent the eleven files in the first way, waited no time
for the two backups and placed the three refused operations, the build, the pack
and the placement taking about two minutes and a half before the first suite; the
cleanup after the twelve suites and the pre-review took 118 seconds, 42 of them
the two deletions the server carried out, with the seven namespaces of the run
removed, and the verification after it 22 seconds.

### The Fixtures Of The Adherence

The adherence of a schedule (SPEC-0013) is proven on fixtures placed by the clock,
in three installations that no controller reads and nothing suggests: they hold no
storage location, and the operator names them, as the long lists. Their schedules
ask for backups that name no location. The installation of the states holds eight
schedules whose times are counted from the placement and two backups; the one of
two offsets two schedules of five fields whose submissions were named two hours
east of UTC and at UTC; the one of the budget three hundred schedules of the
expressions the measure of the unit run computes as well, each with the backup of
its submission named two hours east of UTC. Due is not placed: it lasts five
minutes after an instant a placement cannot choose.

A backup of a submission is named as the controller names one, by the name of its
schedule and the wall clock of the server at the submission, and the views take
the offset of the server from the digits of the name less the creation of the
backup, within a minute. The creation is the cluster's, so these installations are
placed in two phases, after the files of the tabs and the fixtures of the views, by
the clock of this machine read when their placement starts, not by the clock of
the start of the runner, which is minutes older. First the backups, fifty at a
time, each group named by the clock read just before it is created, and each
creation read back: one that is more than thirty seconds from the clock of its name
stops the placement with words that name the clock of the Docker machine, which a
sleep of the machine can leave behind or ahead, and a slow cluster; the way on is to
set the clock of the Docker machine again when it is the cause, which a restart of
Docker does, and to run the command again, which places the namespace again. Then
the schedules, each with the creation of its backup as its last submission, or
twenty seconds before that creation for the older of the two offsets, and the other
times counted from the clock of the placement, which every object says in its
annotation. The backup of the older of the two offsets created twenty seconds or
more after the one of the newer stops the placement, since its submission would
then be the newest and the views would take its offset; the next run places the
namespace again. The phase and the last submission of each schedule are read back
with the rest, and a schedule the cluster holds with another, or with no phase at
a later run, stops the placement: the definitions of the cluster keep the status a
client writes with the object, which the views read. The installations of the
adherence are placed in two phases and no other namespace is, each backup of them
of one schedule, and the clock that names the first group is read once the objects
of the run are removed, however long that took.

One schedule is real: `fixture-yearly-<run>`, in `velero-demo`, `@every 8760h`, with
the spec of the real backup as its template, so that its next run is a year after
its creation and it submits nothing for the life of an environment. It names no
`skipImmediately`: the controller writes the setting of its server into it when it
validates it, which says that the controller read it. It is applied through the
journal after the operations the server refuses, and the controller validates it
while the server syncs the backups of the tabs; its wait comes after the one of the
sync, two minutes at most, and ends once it is Enabled with `skipImmediately`
written. The placement stops by name on a schedule of another run, on one of this run
whose expression, pause or template are not the ones the scripts make, as other
scripts may leave on an environment kept for days, on one the controller refused, on one that carries a last submission or whose label a backup
carries, and on one whose next run is less than a day away, which says to create
the environment again. The cleanup of the fixtures removes it by its identity, and
its end check names it when it is left. Before a suite takes its first snapshot,
the helpers stop it when the schedule submitted since its placement, by its last
submission or a backup that carries its label: the suite would take that backup
into what it compares with.

The controller looks at the schedule once a minute. Whether it sends a PATCH of
it at each look with nothing changed, which every suite would count as a write,
is measured on the test environment from the counters of the API server, over
three minutes: on 2026-10-26 it did, a PATCH of the schedule by name once a
minute, 19 to 22 in three minutes, with its version and its status unchanged and
no POST of a backup. The helpers of the suites say the answer in a constant,
`SCHEDULE_PATCHED_AT_EVERY_LOOK`: when it is true, the writes a suite counts
between two readings of the counters leave out the PATCH of a schedule by name,
as they leave out the one the controller of the storage locations writes at each
validation, but no more of them than the whole minutes between the two readings
and two; the ones above that bound, and a PATCH of a schedule of another scope,
are writes. Within the bound, the version and the status of the schedule in the
snapshot of every suite prove that nothing changed it, and a PATCH that changes
nothing, or that the server refuses, is not seen; a submission would add a
backup to the identities of the installation, and, in the suites that count the
writes, a POST of a backup to what they count.

On 2026-10-26, on the machine of the runs, a first placement of the three
installations of the adherence, 614 objects, took 4 minutes 58 seconds as the
whole of a first `pnpm demo:views` on an environment just up, with the views, the
long lists, the files of the tabs and the real schedule; a placement after it,
which finds them good, 1 minute 32 seconds; a placement that places the
installation of the budget again, its six hundred objects removed and created,
after one of its schedules was removed, 1 minute 47 seconds, every backup created
within a second of the clock its name was read from; and the cleanup after the
suites, with the three namespaces of the adherence and the schedule, 3 minutes 0
seconds for `fixtures-cleanup`, 73 of them the wait for a pass of the sync, the
namespace of six hundred objects gone within the 90 seconds of its wait, then 29
seconds for `verify`.

The suite of the adherence, `velero-e2e-adherence`, expects of each of these
fixtures what the helper of the suites,
[`velero-adherence.ts`](../../integration/helpers/velero-adherence.ts), computes
from the objects as the cluster holds them and from the clock, by the rules of
the controller as SPEC-0013 states them, and never with the code of the
extension. It knows the forms of the expressions of the fixtures, an interval of
whole hours, a daily `M H * * *` at the offset of the server, the 02:30 of Rome,
the new year of Buenos Aires and `0 0 30 2 *`, and refuses any other: it is not
a parser. The clock of the page is a tick of up to five seconds before a read of
it, and the read up to fifteen seconds old, so each expectation is computed at
the clock before the read less twenty seconds and after it plus one second, and
a state, a count or a duration is expected among the two: a schedule near an
edge of the grace, of 01:00 UTC or of an hour of the count is expected on either
side. The schedules of five fields that name no zone, at UTC+02:00, are due at
01:00 UTC and overdue five minutes after, inside the twelve hours of a placement
made after 13:00 UTC; the count of the hourly one grows by one each hour from
twenty-five; the clock ahead shrinks with the age; the next run of the real
schedule is a year less the age. The forms of the sentences are copied as they
are written in the module of the signal, and every duration they hold is read
back into its span by its two units and expected to overlap the one computed.
The helper, the words the suite expects of a band and of a next run, and the
counters it reads have nineteen cases of their own, first in the file and
starting no application, which run alone with `pnpm exec vitest run --config
vitest.integration.config.ts e2e/__tests__/velero-e2e-adherence.tests.ts -t
"what the suite of the adherence expects, computed by the rules of the
controller"`. The suite reads the cluster only with `kubectl get` in a namespace
and the counters of the API server, never inside a measure, and runs in the run
of the pattern `velero-e2e`, as the hosted job runs it (LM6 of SPEC-0013). It
took 137.97 and 132.81 seconds alone on the machine of the runs on 2026-10-26, 4
minutes 11 seconds and 4 minutes 1 second with the build, the pack and the start
of its runner, 133.85 seconds in the run of the pattern on 2026-10-27, and
104.71 seconds on the hosted runner that day, as the reporter of the job prints
it; the run of the pattern `velero-e2e pre-review extensions` took 51 minutes 21
seconds on the machine of the runs on 2026-10-27, its suites 49 minutes 29
seconds, and 42 minutes 28 seconds on the hosted runner that day, its suites 41
minutes 16 seconds, in a job of 47 minutes 48 seconds, against the two hours the
runner of the suites gives them in one start, the two hours the kubeconfigs of
the readers last, and the 150 minutes of the job. With the suite of the volumes,
the first pull request of T5.1 brings the run of the pattern to 55 minutes 18
seconds on the machine of the runs on 2026-10-27, its suites 53 minutes 31
seconds, 16 files and 252 cases; on the hosted runner, in the first run of the
job that day, 47 minutes 10 seconds, its suites 46 minutes 2 seconds, 16 files
and 252 cases, in a job of 52 minutes 48 seconds of its 150.

## Critical Journeys

1. Open Velero in a selected local test cluster; distinguish installed, absent,
   restricted and configured-namespace cases, then switch installations while a
   previous request is pending without showing or acting on its data.
2. Filter Backups, open a running or failed operation and follow its related objects;
   all pinned phases, unknown mocked phases and incomplete progress remain truthful.
3. Confirm a diagnostic request, retrieve a real local artifact, and exercise missing
   file, denied permission, timeout, TLS failure, excessive payload and cancellation.
4. Compare schedule submission evidence with expected firing under pauses, skipped
   runs, timezone/DST, incomplete history and in-flight backups without false alarms.
5. Confirm each action on local kind, inspect the resulting object/controller state,
   and verify duplicate, wrong-target and disabled-write refusal. A cancelled UI wait
   does not claim to cancel the server-side backup or restore.
6. Install the exact tarball into the pinned app, traverse every shipped view in both
   themes and test toolbar, row, drawer and selection paths for unintended deletion.

Each journey follows setup -> action -> assertions -> owned-fixture cleanup. Mocked
and synthetic-status outcomes supplement, not replace, real-controller proof.

## Local Environment And Fixture Ownership

- Verified T0.4 target: a dedicated local kind cluster for this extension, with an
  isolated one-target kubeconfig. The persistent `kind-kind` remains untouched.
  Capacity, current routes, identity and official image pins were checked before
  installation. Revalidate on subsequent runs. The cluster is deleted by
  `pnpm e2e:cluster:down` only, which deletes what the journal owns and refuses
  everything else.
- Never change global Docker/Kubernetes contexts or use a remote daemon. Match the
  exact expected context and verify local kind ownership before every test session;
  an unknown or mismatched target stops the run before any Kubernetes request.
- Install pinned Velero v1.18.4 and the compatible AWS plugin v1.14.4 with the accepted
  local S3 backend. The proposed SeaweedFS release and digest are recorded in
  [LOCAL-STORAGE.md](LOCAL-STORAGE.md); installation passed on 2026-09-24.
  Test volumes use only disposable synthetic data, with no external storage fallback.
- Separate the live installation namespace from static-phase fixtures outside the
  installed controllers' watch scope. Verify both server and node-agent behavior;
  use a second isolated local kind environment only if separation cannot be proven.
- Fixture factories preserve the base-manifest followed by ordinary status-patch
  sequence. Typed factories generate fresh run labels/namespaces and payloads instead
  of checking large generated manifests into the repository. The pinned CRDs have
  no `/status`; exact readback and unchanged schemas are required. Do not weaken
  enums or schemas to make synthetic cases pass.
- Generate fixture/run identifiers locally and label resources with ownership.
  Record a private local ownership journal before writes. Refuse collisions with
  pre-existing resources. Never run a broad namespace or cluster cleanup without
  checking ownership and the expected local target.
- Cleanup removes test-created operations, workload namespaces, data and networks
  while preserving unrelated resources, add-ons and the user-owned cluster. Reusable
  demo infrastructure has an explicit lifetime and teardown command, not a trap that
  deletes a cluster. Report cleanup failure instead of declaring a clean run.
- Multi-cluster tests use another local kind target only with that setup step's
  authorization; mocked cluster switches alone do not prove two-cluster routing.

## Fixture Matrix

| Family | Required cases | Evidence type |
| --- | --- | --- |
| Real operations | Completed backup/restore with known synthetic resources and retrievable artifacts | Live Velero controller |
| Primary states | Every Backup/Restore phase; active/paused/invalid Schedule; ReadOnly/Unavailable BSL; unreported VSL health | Validated static objects plus selected real outcomes |
| Validation failures | Missing BSL and invalid inputs; distinguish actual controller result from forced presentation | Live where reproducible; otherwise labelled synthetic |
| Future/bad data | Unknown enum, impossible timestamps, negative counts, contradictory phase/progress | Unit/component mocks, not schema-invalid cluster fixtures |
| Isolation | Equal names in two namespaces/clusters, recreated UID, removed selection and late completion | Unit plus authorized local integration |
| Permissions | CRD list denied, namespace-only reads, one-kind list denied, diagnostic create denied, certificate Secret denied | Restricted local credentials and injected typed failures |
| Network | Authenticated direct/in-cluster S3, Host/path/query/SNI, negative signature/expiry, CRC32/multipart integrity, CA inline/reference, redirects, DNS policy, timeout/cancel and byte limits | Local runtime and loopback contract servers |
| Safety/privacy | BackupContents, generic delete/bulk, write-gate bypass, sensitive URL/Secret sentinel in diagnostics | Main/component plus packaged-app tests |

Local test identities and credential files stay outside repositories with restrictive
permissions. Do not commit certificates with private keys, tokens or kubeconfigs.
Screenshots, recorded video, docs and fixtures use independently created synthetic
resources only. No real environment is required for the release gate.

## Test Implementation Contract

The scaffold has [source lifecycle tests](../../src/entrypoints.test.ts),
[compiled-entry contracts](../../test/build.test.ts), and the
[stub of the SDK](../../test/freelens-extensions.ts) of the template, written from
the source of the host at the validation target, which has a double for each name
the tests reach and refuses any other, and records it. Vitest 5.0.5 fails when no
tests are selected; it does not import the host implementation in Node.
The canonical command builds first and covers every test of the unit run, which
the [architecture](ARCHITECTURE.md#dependencies) counts, among them the
[environment checks](../../test/environment.test.ts), the
diagnostic contracts, the [operation states](../../src/common/operation.test.ts)
and their [references](../../src/common/references.test.ts).
The environment tests
include child-process refusal checks with an empty executable path, proving that
wrong targets and malformed journals stop without external tools. Co-locate future pure/main
tests with their modules and reuse the integration directory convention for packaged
journeys. No actual Electron installation result is implied by stubbed bundle tests.

Mock the host boundary for unit tests; use a transport interface for Kubernetes
status codes and cancellation. Small local HTTP/TLS servers exercise streaming and
backpressure independently of kind. The real kind tier then verifies that mocks
match the pinned API, CRD schemas and controller artifacts. Do not use private host
imports to make an unsupported public call appear valid.

The components of the host the views draw with are stood in for by
[doubles](../../test/host-components.tsx), and its address by one in the
[stubs](../../test/host-address.ts), written from the source of the host at the
commit of the validation target, each naming the file and the lines it follows:
the [directives](../../AGENTS.md#host-facts-that-cost-a-run-to-find) record the
facts of the host and how each was found. A double does what the host does wherever a view
depends on it: the address is one search, changed once for each parameter that is
set; the input leaves the focus at Enter unless it is told not to; the tabs give a
tab its role and make it a stop of the Tab key; the table draws its head and its
rows and drops what is not a row, and a cell shows its title in place of what it
holds; the list of the host draws its rows in a room that holds them, as the host
draws them in its own tests. A double that is kinder than the host hides a defect
from every test that uses it, and one refuses what it does not model where the
extension would change what the host draws, with words that say to write it from
the source of the host first; a component the host no longer gives, as the virtual
list of v1, is refused by the stub. The tests of a component replace the
components beside it; the tests of the
[tabs with their viewers](../../src/renderer/pages/operation-artifacts.test.tsx)
mount the pages with nothing of the extension replaced.

Each implementation slice starts with its focused failing/discriminating check and
ends with passing targeted tests. Wire new cases into the canonical command and
record exit code plus pass/fail/skip counts. A nonzero exit code is a failed gate,
even if some assertions passed. Do not defer regressions to the release stage.

Established T0.3 commands, executed locally:

- `pnpm type:check`, `pnpm lint:check`, `pnpm knip:check`, `pnpm test:unit`, and
  documentation checks using the established Trunk convention.
- `pnpm build && pnpm clean:tgz && pnpm pack`, without a version bump;
  `pnpm pack:dev` bumps a prerelease so that Freelens takes the rebuild. Since
  T0.7 the build has one form, the one that is packed.
- `pnpm exec vitest run src/entrypoints.test.ts` is the focused source check.

The measure of the unit tests,
[`artifact-log.measure.ts`](../../test/artifact-log.measure.ts), times the code of
a log on 500,000 lines of the brief form of the log of the fixtures of the tabs:
the parser, the search, the filter by level, the search among the lines a filter
leaves, the rows of a list of the lines and the lines of a text read without its
levels, each twenty calls after five, within 250 milliseconds at the 95th
percentile, every answer checked. It prints its times as one line, `VIEW-10 unit`,
before anything is asserted, and it imports the source; the hosted unit job asserts
the same budget, in both forms of the build until T0.7 and in the one since. Of 34
changes made on purpose, one at a time, while the measure was written, to the
parsers, to the generators, to the keys and the counters of the fixtures and to
the measure, 32 made a test fail: a search made to read its text twice, or three
times, stays within the budget, which a search four times as slow, and a parser
that copies every line, exceed. The 10 changes made once the measure took the
filter, the rows and the lines of a text, 8 to the code it times and 2 to the
choices it makes, each made it fail. On the final code, on 2026-10-06, every
series stayed within the budget in both forms, with three workers of the runner of
the tests and with the ones it chooses on a busier machine; the hosted unit job of
the pull request of the fixtures of the tabs, run 37520156275 of the workflow of
the unit tests on the image ubuntu-24.04-arm, on 2026-10-06, ran it in both forms
after the 73 files of the tests, and its slowest series was the parser, 79.4 ms at
the 95th percentile on the separate modules and 82.6 on the production build, of
250, as the evidence of SPEC-0011 records whole. On the final head of the third
pull request, on 2026-10-07, under the load the unit run itself raised, the parser
took 142.1 ms at the 95th percentile on the separate modules and 124.2 on the
production build, every series within the budget in both forms.

The unit layer of the adherence of a schedule (SPEC-0013, T3.1) is the module
[`schedule-adherence.ts`](../../src/common/schedule-adherence.ts) and its
[tests](../../src/common/schedule-adherence.test.ts), with the clock as an argument
and the zone of the machine of the tests set to one fourteen hours east of UTC,
which no row is computed in: the table of ADH-01, each row with the file and the
line of the tests of go-cron v0.15.0 or of Velero v1.18.4 it is taken from, and
marked when the library of v1.18.2 read it otherwise, the accepted expressions with
their next runs in UTC, in Rome and in New York across the changes of daylight
saving time of 2026, and the refused ones with the words the controller writes; the
anchors, the due instant, the counts and their bound of ADH-02, with the daily and
the interval cases of the tests of the release; the zones an expression names, of
ADH-03; the backup of the last submission, of ADH-08. The measure of the adherence,
[`schedule-adherence.measure.ts`](../../test/schedule-adherence.measure.ts), times
the signals of 1,000 schedules of 898 expressions, every so many minutes or hours,
five fields with and without a zone name, the calendar descriptors and ten with no
instant, which a module of the scripts of the environment,
`e2e/scripts/local-expressions.mts`, writes once for the measure and for the
fixtures of the budget of the adherence, twenty calls after five, within 250 milliseconds at the 95th percentile,
and the signal of one schedule within 2, with the parse kept for the text of the
expression and the count bounded at one hundred asserted beside the times; it prints
its numbers as one line, `ADH-16 unit`, before anything is asserted, and it imports
the source, as the measure of the log does. In the unit run on the machine of the
runs, on 2026-10-14, the expected runs of T3.1 alone took 14.1 ms at the 95th
percentile and 11.9 at the median, 64.2 on the first call, which parses the
expressions and reads the zones, and the one schedule 0.03 ms. Since T3.2 each
signal is the whole one, with its words, as a list computes it for a read and a
clock: the offset of the server derived from the 1,010 backups of the read, the one
of the submission of each schedule named two hours east of UTC and ten in progress
that hold their schedules, what the installation shares for the read, then the
signal of every schedule, none of them not known. In the unit run on the machine of
the runs, on 2026-10-15, on the final code of the slice with Vitest 5.0.5, the
thousand took 42.7 ms at the 95th percentile and 31.5 at the median, 102 on the
first call, and the one schedule 0.04 ms.

In the packaged application ADH-16 is measured by the suite of the adherence, on
the installation of the three hundred schedules of the same expressions, each
with the backup of its submission: three interactions that warm the list, then
ten searches of texts it is not searched by and ten orders, each a column and a
direction, asked once untimed from the same start as the timed ones, each
awaited until the first forty rows change, which proves that each changes them;
the 95th percentile of what the list takes to answer within 250 milliseconds,
with the time from the key beside it, and at most a hundred rows mounted; then
twenty changes of the window of the Overview of the same installation after
three, within 250 milliseconds, as OVER-12 measures them, with the window after
each change, a time for each, the schedules and the backups the page read, and
no value of the whole. An order is timed by `measureOrder`, a click on the head
of a column that ends when the first forty rows change, with no wait of the
host. Each report is written before anything of the measure is asserted, and
printed as one line, `ADH-16` with the measure it is of. On the machine of the
runs, an Intel Core i7-9750H of twelve threads and 16 GB with macOS and kind in
Docker Desktop, in the nightly v2.0.0-0-nightly-2026-10-25, on 2026-10-26 in two
runs of the suite alone on the same placement: the list answered in 176 and 156
ms at the 95th percentile, 104 and 106 at the median, the slowest 309 and 173,
and 414 and 393 from the key, with 27 rows mounted; each order in 100 to 113 ms;
the Overview in 33 and 62 ms at the 95th percentile, each window holding
operations and ten of them listed. On 2026-10-27, in the run of the pattern of
the hosted job on the same machine: 134 ms at the 95th percentile, 110 at the
median, the slowest 172, and 385 from the key, with 27 rows mounted; each order
in 98 to 119 ms; the Overview in 37 ms. On the hosted runner, on 2026-10-27: 100
ms at the 95th percentile, 77 at the median, the slowest 103, and 343 from the
key, with 27 rows mounted; each order in 71 to 82 ms; the Overview in 27 ms.

The second slice of the adherence (SPEC-0013, T3.2) is the module
[`schedule-signal.ts`](../../src/common/schedule-signal.ts) and its
[tests](../../src/common/schedule-signal.test.ts), with the clock as an argument
and the zone of the machine of the tests set fourteen hours east of UTC as well:
the offset of the zone of the server read in the name of the backup of a
submission, east, west and at UTC, with a remainder under a minute and one of a
minute and a half, the digits read against the creation of the backup and not
against the submission, a name of thirteen digits, a backup two minutes from its
submission, one asked by hand in the same minute, none at all, the newest
submission of the installation for every schedule, two offsets among the
submissions and the offset kept once its backup is gone, the newest submission said
with its schedule when it is another, an interval with no zone and one written in
the zone it names, the runs of the hour a zone repeats in the words of the awaited
state, in Rome and in New York, from the first of each occurrence when there are
more, and nothing of them once the second passed, and the same signals with the
machine set to another zone, of ADH-03; awaited, due at four minutes and overdue
at six with the instant, the anchor of each of the three kinds and the count to its
bound, under a second said so, held by a backup of each phase that holds and by
none of the others, within and beyond the grace, and an expression with no instant,
of ADH-04; paused with a run due and with none, with skip immediately set, unset and
not written, as the schedule is now, Velero refused, not read and a phase not
known, gated before the expression, the anchor, the backups and the offset are
read, which a schedule and a context that throw when they are read prove, of
ADH-05; each state of what is not known with its mark and its
words, a read of before, the derived offset said approximate, and the backups not
read beside an interval, which keeps its state, and five fields, which are not
known, of ADH-06; a creation, a submission, a skip and a start after the clock of
this machine, none, one under a second, and the time of the API server ahead,
behind and within a second, with the words of the two cases; a schedule late by
this machine said overdue beside an object ahead of it, which bounds nothing, and
the lateness counted by the clock of the cluster when its API server gives its
time, ahead and behind, of ADH-07; the last observed run in words, its backup
found and not, not known from a read of the backups made before the submission or
failing since, a newer backup said not a submission, and no word of a missed run,
of ADH-08; the weights of the
order of REQ-168, two of one weight by their measure and two by name; the words of a
time in the zone of the expression. Every word a test asserts is read from the
words of the module, as the tests of the view of a schedule do.

The first pull request of the third slice of the adherence (SPEC-0013, T3.3) puts
the signal in the list, the view and the details of the host. Its component tests
run with the zone of the machine set fourteen hours east of UTC, as the tests of the
signal do, with the clock of the views faked where a tick matters, and every word
they assert read from the words of the module; the schedules and the backups of the
states are built by [the builders](../../test/adherence-builders.ts) shared by the
tests of the views, with every time an argument. The
[tests of the list](../../src/renderer/pages/schedules-page.test.tsx) hold the
columns with their classes, IDs and keys of order; the cells and their tips for a
schedule of each of the eight states, the tips read by pointing at the double of the
host, which shows them as the host does; the order by the next run and by adherence
through the callbacks and the order of the host, both ways, the runs of each state
from the earliest, two of one instant by name, before Not known and None; the search,
which holds the word of the state, the text of the next run and the notes, and not
the sentence; the cells empty until the backups were answered once, and said, with
why, when the backups are refused; a schedule due that is
overdue at a tick with no read; the reads of the schedules and of the backups
failing each apart, said with when; the rows of the next installation computed with
nothing of the one before, its offset, the time of its API server and its late
answer; no timer left by the list, the view and the details; the words of the clocks
over the list only when an object is ahead, and in the band always, with and without
the time of the API server; the items of the details agreeing with the row for every
state, with the date of the host beside an instant, asking nothing, saying the age
of the read they computed with once no view of the extension asks again or when it
is older than the period of the reads, and a schedule of another namespace computed
with nothing of the installation the views read, an offset derived there among
it. [The tests of the band](../../src/renderer/components/adherence.test.tsx)
hold each line present and absent for each state, the grace under the states it
applies to, each sentence of what holds the submissions once, a hold not known
among them, and the ways to the backup of the submission, to the newer one, to the
newest one and to the one that holds; the line
of time of the history is the one of the tests of the view, unchanged.
[The test of the stylesheet](../../src/renderer/components/views.module.test.ts)
reads the rules of the room of a list and holds the columns each gives up at 1,200,
1,000, 760 and 640 pixels, none of the name, paused, the next run, the adherence and
the validation at any width, and a width of their own for paused, the next run, the
adherence, the last submission and the age from 1,000 pixels. The reader is held to
the header Date, read with the middle of the request, absent, not a date and on a
refused answer, and to no path that is not of the kinds of Velero, a Deployment
among them; the state, to the offset kept, carried and dropped with the installation
and the time of the API server taken from the newest answer that listed.

The second pull request of the third slice of the adherence puts the signal in the
Overview, with the clock as an argument and the zone of the machine of the tests set
fourteen hours east of UTC, and every word the tests assert read from the words of
the modules. [The tests of the rules](../../src/common/overview.test.ts) keep the
cases of A1 to A10 as they were, and hold rule A11 with a case that gives an item and
one that gives none for overdue, held within the grace and beyond it, at every look
with a last submission and with none, due, awaited, paused, refused, not read, New,
the zone not known, a zone this machine does not know, an expression this version
cannot read, a phase it does not know and no time to count from; the reason of an
item, which is the sentence of its state with the words of the derived offset, of
the schedule itself or of another, and that whether a backup holds the submissions
is not known when the backups are denied; its time, the expected run or the last
submission of a schedule at every look; the backup that holds it; its order among
the items of A5 and A6; an item at a tick of the clock with no read; an item of an
earlier read of the schedules or of the backups; the count of what is not known by
reason, of the schedules that were read and of no other, in the order the signal
names the reasons, and none when the schedules were not read; the summary beside the
items, beside none, beside what was not read and what was read before; the lines
with the signal of their schedule, A11 among the rules that put a line first; and
nothing of the adherence without what the views share of it.
[The tests of the page](../../src/renderer/pages/overview-page.test.tsx) hold the
items of A11 in the order of the page with their reasons, times and ways; the line of
the count after what was not checked and before the items, with its way to the list
of the schedules; the summary of a page with nothing to report and a count; the two
cells of each line, from the signal of the row of the list, with their tips; nothing
of the adherence until the backups were answered once; an item at a tick of the
clock with no read, and no timer left; nothing of the installation selected before,
its late answer included; the items of an earlier read of the backups and of the
schedules; and the backups denied. The test of the signal holds the words of the
derived offset apart from what else is said beside a state.

The [local runner](../../e2e/scripts/local-demo.mts) and
[image helper](../../e2e/scripts/local-images.mts) provide official-image setup and
live readiness/authentication/isolation/ownership checks. Real backup/restore and
status fixtures plus restricted identities and cleanup are implemented in
[local-fixtures.mts](../../e2e/scripts/local-fixtures.mts) and the runner. The T0.6
[download proof](../../e2e/scripts/local-download-proof.mts) exercises the main
bundle, with the [stand-ins of the host](../../e2e/scripts/local-host.mts) since
T0.7; the packaged application is started by the helpers of
[`integration/helpers`](../../integration/helpers/). Knip ignores the binaries no
dependency provides: `yq`, which the workflows call, from mise, and `pgrep`, with
which the helpers of the suites find what the application started.
What the package bundles is in [the dependencies](DEPENDENCY-AUDIT.md).

Build after tools that remove generated output. Before manual review, provide the
actual absolute tarball path and tested host version. Inspect the tarball's file
list for source-only docs, local evidence, credentials or unintended bundled host
dependencies. Packaging is not authorization to publish.

## T0.4 Attempt And Recovery Gate

Completed locally on 2026-09-24. Official release
artifacts only: kind 0.33.0, Kubernetes node 1.34.11, Velero 1.18.2, AWS plugin
1.14.2 and SeaweedFS 4.47. Node.js is 24.15.0 and kubectl remains 1.33.4.
Exact image references are in [local-manifests.mts](../../e2e/scripts/local-manifests.mts).
The retired rebuild/scanner commands and derived images were not used or deleted.

Private state is under `$HOME/.local/state/freelens-velero-dev`, with directory mode
0700 and credential/kubeconfig/journal/log files at 0600. It holds generated local
credentials, the immutable node/network identities, operation logs and the latest
generic result in `readiness.json`. CLI working directories and kubectl caches are
also private. The default kubeconfig is unchanged. An accidentally generated demo
discovery cache was verified as synthetic and moved out of the project, not deleted.

Run from the extension root, only for the explicitly approved local target:

```sh
node e2e/scripts/local-images.mts pull
node e2e/scripts/local-demo.mts cluster --context kind-freelens-velero-dev
node e2e/scripts/local-demo.mts storage --context kind-freelens-velero-dev
node e2e/scripts/local-demo.mts bucket --context kind-freelens-velero-dev
node e2e/scripts/local-demo.mts velero --context kind-freelens-velero-dev
node e2e/scripts/local-demo.mts verify --context kind-freelens-velero-dev
```

The official kind binary is installed privately at the journal directory's
`bin/kind`; its existing checksum-verified release is used without a global CLI
upgrade. No script of the repository installs it any more: the installer went with
the scripts that rebuilt third-party images, and the test environment for every
platform brings its own (see the [roadmap](ROADMAP.md)). Images are pulled on the host, not by workloads. Kind imports official
version tags whose Docker/CRI image IDs must equal those of the exact digest pins;
workloads use `imagePullPolicy: Never`. Missing or changed image content stops setup.

The `verify` command is a foundation check for a fixture-free installation. It
intentionally expects zero Backups, Restores, Schedules, DownloadRequests and
ServerStatusRequests; later fixture tests need their own lifecycle checks. Its
temporary ConfigMaps and local listener are removed on completion, including the
simulated interrupted-check path. Persistent demo infrastructure and the empty
bucket are retained for T0.5, not automatically torn down.

The node remains running with 4 CPU/8 GiB limits and Docker restart policy `no`.
To pause only this owned demo, use
`node e2e/scripts/local-demo.mts stop --context kind-freelens-velero-dev`.
This retains data and the initialized cluster. A stopped or changed node must be
revalidated before reuse; T0.5 adds the explicit guarded `start` command described
below. The runner never silently selects or recreates another cluster.
`remove-failed-node` refuses initialized or running nodes. Preserve
`kind-kind`, unrelated add-ons and the private ownership journal.

| Check | Exit / result | Evidence boundary |
| --- | --- | --- |
| Canonical `pnpm test:unit` | 0; 67 passed, 0 failed, 0 skipped | Build, source, consumer and 46 setup/guard tests |
| Type-check, touched-file Biome, both Knip modes | 0; pass | Repository lint exits 0 with one existing warning in the retired remediation script |
| `cluster` | 0; Ready, repeated successfully | Exact local node/network, current route check, verified TLS kubeconfig and official image content |
| `storage` and `velero` | 0; ready | Storage Deployment, Velero Deployment/node-agent, 13 unchanged CRD schemas, BSL Available |
| `bucket` | 0; four assertions pass | Signed list returns 200; anonymous, wrong-secret and out-of-scope bucket requests return 403 |
| `verify`: control ports | 0; pass | Master/filer/volume loopback listeners; native S3 gRPC rejected outside its pod; S3 HTTP remains reachable |
| `verify`: egress | 0; pass | Local listener positive control, then node/pod connection rejection with firewall counter increases; listener closed |
| `verify`: ownership/cleanup | 0; pass | Existing sentinel collision refused; owned reapply preserves UID; interrupted check deletes with UID preconditions; sentinel survives until its explicit cleanup |
| Real backup/restore, status fixtures, multipart and signed download | Not run | T0.5/T0.6, no substitute from BSL readiness |
| Actual Freelens/Playwright | Not run | Later packaged-app gate; no feature UI changed in T0.4 |

Configuration issues resolved in this extension's setup code, without upstream edits:

- The initial node needed a private `host.docker.internal` mapping on the internal
  network. Its failed predecessor was removed only with explicit permission.
- Docker does not publish the API port on this internal network. The official
  `kind get kubeconfig --internal` output is normalized from container hostname to
  the exact journal-owned node IP. CA/client certificates remain unchanged and TLS
  is verified. No default or remote kubeconfig fallback is permitted.
- The node has no default route; an explicit service-CIDR route enables kube-proxy
  Service translation while outside traffic stays rejected. CoreDNS is cluster-only.
- Docker archive import did not preserve digest names. Loading verified official
  tags and comparing image config IDs fixes offline `ErrImageNeverPull` without
  enabling workload downloads or selecting derived images.
- The official installer needs a kubeconfig even in dry-run mode. It receives only
  the verified private config read-only, with an explicit context and no network.
- Official SeaweedFS always starts S3 gRPC 18333. Node OUTPUT/FORWARD rules isolate
  that port outside the pod; no upstream code was changed to remove the listener.

No cloud account, real cluster, external endpoint probe, vulnerability scan or
third-party source build was used for these checks. This is infrastructure readiness
evidence, not proof of backup recovery, full S3 compatibility or product completion.
Overall T0.4 verdict: **PASS**. T0.5 was subsequently authorized and verified below.

## T0.5 Fixture Verification

Completed on 2026-09-25 using the existing official-image laboratory. The node had
been stopped; the new `start` action verified its journal ID, network, kubeconfig
hash and current routes before resuming it. Authenticated local API liveness and
isolation were rechecked. No node was recreated and no initialized cluster deleted.

Run from the extension root, only for the approved local target:

```sh
node e2e/scripts/local-demo.mts start --context kind-freelens-velero-dev
node e2e/scripts/local-demo.mts fixtures --context kind-freelens-velero-dev
```

The first command also revalidates an already running owned node. The second starts
a fresh fixture run only when the previous run is cleaned, and performs:

1. Base creation and ordinary merge patches for isolated synthetic states, checking
  installed enums and exact status readback without any `/status` request.
2. Real Backup and Restore of labelled ConfigMaps, with an explicit source namespace,
  separate pre-created destination, no cluster resources/PV snapshots and restore
  policy `none`. Hashes of all restored binary payloads and the small map contents
  must match. No controller status is forced for the live operations.
3. Multipart verification from archive HEAD metadata and bounded reads of four gzip
  log/results objects. The harness cannot GET the backup archive. Restores themselves
  naturally consume stored data inside Velero; no archive is exported to the user.
4. A temporary ServiceAccount credential for real allowed/denied API operations,
  with no fallback to the privileged kubeconfig after a denial.
5. Cleanup in `finally`, followed by the fixture-free environment verifier. Real
  backup deletion uses DeleteBackupRequest; associated Restore/files are removed
  by the official controller. Namespace inventories must contain only run-owned
  resources plus standard default ServiceAccount/root-CA objects before deletion
  with a UID precondition.

The static namespace is outside both configured controller namespaces. The main
matrix contains 29 objects: 13 Backup phases, 10 Restore phases, three Schedule
cases (enabled, paused, invalid), two BSL cases (Available/ReadOnly and Unavailable)
and one VSL with unreported health. A further Backup has a missing BSL reference,
for 30 labelled synthetic domain objects. They cover incomplete progress, missing
timestamps, validation errors and 100% item counts while still Finalizing. Their
UIDs, resourceVersions and statuses remain unchanged across live controller work
and permission checks. PartiallyFailed/FailedValidation presentations are synthetic,
not claimed as induced live failure outcomes. Unknown future enum values remain
mock-only cases; the real schemas were not relaxed.

The restricted identity allows namespaced Backup reads. The seven actual API
denials cover cluster-wide Backups, CRD listing, installation credential Secret,
same-namespace certificate fixture Secret, one-kind VSL listing, Backup creation
and DownloadRequest creation. The last request is forbidden and creates no object;
it does not perform the T0.6 request protocol. The private token kubeconfig is
removed, and namespace cleanup removes its ServiceAccount/Role/RoleBinding.

| Check | Exit / result | Evidence and boundary |
| --- | --- | --- |
| `pnpm test:unit` | 0; 73 passed, 0 failed, 0 skipped | Includes 52 setup/fixture tests; no hidden second unit runner |
| Type-check, touched-file Biome, both Knip modes | 0; pass | One pre-existing repository-lint warning remains in the disabled remediation script |
| Full `fixtures` command | 0; pass | Repeated complete run, including cleanup and environment revalidation |
| Live Backup/Restore | Completed, no reported errors | 13 ConfigMaps; 9,437,184 binary payload bytes plus a small text map match |
| Multipart object | 4 parts in the last run | 18,967,925 stored bytes from HEAD metadata; default plugin checksum behavior unchanged |
| Diagnostic fixtures | 4 gzip artifacts retrieved | Backup/Restore logs and results; JSON results parse; max 16 MiB transferred and 4 MiB decoded per artifact |
| Static fixtures | 30 domain objects unchanged | Ordinary status patches, schema readback and post-controller UID/resourceVersion/status comparison |
| Restricted credential | 1 allowed read, 7 forbidden operations | Real server authorization responses; no privileged retry |
| Cleanup | Pass | Real Backup/Restore/deletion request gone, five expected object keys return 404, three fixture namespaces gone |
| Retained environment | Pass | Official image identities, BSL Available, authentication, egress/control ports and sentinel cleanup revalidated |

Generated names and payloads vary by run, so stored archive size can vary. The test
requires data integrity and multipart evidence rather than this exact byte count.
Canonical fixture shapes live in [the typed factories](../../e2e/scripts/local-fixtures.mts);
no payload, token or cluster capture is committed to the project.

Private state under `$HOME/.local/state/freelens-velero-dev` records the active run
in `ownership.json`, per-run evidence in `fixture-runs/<run>.json`, and synthetic
diagnostic captures in `fixture-artifacts/<run>/`. Directories are private and
files use mode 0600. Reports are retained outside repository/package contents.
The runner refuses an unfinished prior run; the explicit `fixtures-cleanup` action
can retry only its journal-bound cleanup. It refuses active backups or unrelated
namespace resources rather than force deletion. Do not discard the journal to
bypass a failure. No fixture is intentionally retained after successful tests.

The artifact paths follow the pinned
[official object-store layout](https://github.com/velero-io/velero/blob/c253c7fe37d78c9b7e55c68544f7c5b2608712d8/pkg/persistence/object_store_layout.go):
restore log/results filenames have an additional `restore-` prefix. Fixture-only
SigV4 requests use generated local credentials and explicit local Service routing.
They are not a renderer/main implementation and do not authorize the extension to
read storage credentials when consuming server-signed URLs.

This step does not prove PV/CSI data recovery, live scheduling/adherence, every
failure phase, UI integration or main-process download/TLS/cancellation behavior.
No external account, real cluster, upstream patch/rebuild, vulnerability scanner,
DownloadRequest execution or ServerStatusRequest was used. Overall T0.5 verdict:
**PASS**. T0.6 was subsequently authorized and verified below.

## T0.6 Main Transport Proof

Authorized and completed on 2026-09-25 against the existing official-image local
lab. The implementation is main-only and activation stays inert. The runner loaded
the actual compiled CommonJS main under Node with minimal host globals; this is
not an actual Electron/IPC/catalog integration result.

Since T0.7 the runner loads the main bundle of the extension for Freelens v2,
`dist/main.js`, an ES
module, under Node, with the [stand-ins of the host](../../e2e/scripts/local-host.mts)
of D9 of SPEC-0015 for `Main.K8sApi` and `Main.Shell`, made from the isolated
kubeconfig of the environment: the client of the stand-in takes the requests of
the adapter to the API server, and the tunnel runs the pinned kubectl of the
environment as `Main.Shell` would give the kubectl of the host. What the host adds,
its proxy, its catalog and the kubectl it prepares for the cluster, is proven by the
packaged suites. The direct worker runs in the Node container, where no kubectl is:
it has the client of the stand-in and asks for no tunnel. The proof passed in its
four modes on 2026-10-17, on Node 24.15.0 and again on Node 24.21.0.

Since the slice of the request through the gate the proof calls the procedures of the
main process as a frame of a cluster does, on a registrar of its own: it turns writes
on for the namespace of the fixtures, confirms each artifact of each target, runs it
with the token, reads the text page by page and lets it go. The cluster is the one
entry of a catalog of the proof, and the requests carry the labels of the environment
beside the ones of the extension. What follows is the record of the first run, whose
service held the confirmations the gate holds now, and whose route was the one the
script gave.

Since the slice of the transport the proof asks the server and the store for what is
not there as well. After the real backup and the real restore it applies three
operations the server refuses, and waits until each failed its validation for the
reason it is made for, through the phases an operation has before its controller
validates it, the queue of a backup among them: a backup and a restore that name both
kinds of selector, whose storage location and whose backup are valid, and a restore
asked from a schedule that has no backup, which keeps no name of a backup. Through the
tunnel over HTTP it asks for the log of each. For the first two the server signs a URL
and the store answers that it has no such file: the run ends as a file the store does
not have, at the step of the download, and its request is in the cluster. For the
third the run ends before any creation, at the step of the backup, and no request of
its name is in the cluster. The cleanup removes the backup that failed its validation
as it removes the real one, through a deletion request the controller carries out, the
restore that names the real backup with that backup, and the restore without a backup
by the identity the cluster gives of it. A backup a cleanup that was interrupted left
while it was deleted is waited for with the same request.

Since the slice of the route the proof gives the main process no route: the procedures
find it by themselves, from the URL the server signed and from the objects of the
cluster, and the proof checks the one each download was given. Through the tunnel the
host of the URL is the Service of the storage, which is read with its endpoint slices
and its Pod. Directly, the storage location is given a public URL with a name no
resolver knows, over which the server signs, and the proof answers for the resolver of
the machine with the address of the Pod of the storage: a private one, which the first
run refuses, saying that the operator may allow it and for which origin, and which the
downloads reach once the allowance is given through the procedure, as a frame gives
it.

The proof then runs as four identities of its own, each an account of the namespace of
the installation with a credential of ten minutes. One reads and may not create the
request: it ends as forbidden at the creation. One creates the request and may read no
Service and no Secret: it ends at the Service, with its request in the cluster, and,
once the location refers to a Secret, at the certificate, with no request. The
router has neither verb of `pods/portforward`: it ends at the port-forward, with its
request in the cluster for the server to remove, and the last words of kubectl name
`create`. The downloader has what the architecture lists for a download through the
cluster, with `create` alone on `pods/portforward`, which forwards through the
fallback of kubectl: it downloads the log. Until T0.7 the router had `create` alone
and the downloader both verbs, as the WebSocket of the client of the extension
needed them; the identities follow the kubectl of the host since the amendment of
2026-10-16 of SPEC-0015. The accounts and their roles are removed with the run.

```sh
pnpm test:unit
node e2e/scripts/local-demo.mts transport-proof --context kind-freelens-velero-dev
```

The direct worker requires the unmodified official image
`docker.io/library/node:24.21.0-bookworm-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20`,
the Node of `.nvmrc`, verified locally before use. Pulling this public artifact does not authorize a
cloud environment. The guarded runner checks its content and the owned node before
starting a short-lived, capability-free, read-only-mounted container in that node's
network namespace. It creates no relay Pod, host route or derived image. Existing
node egress controls stay active and `--rm` plus owned fallback cleanup remove it.

The command creates fresh T0.5 Backup/Restore inputs, then runs four real downloads
in each mode. All retain the cluster-internal signed hostname and unchanged BSL
publicUrl. The downloader never reads object-store credentials.

| Mode | Real artifacts | Additional real checks |
| --- | --- | --- |
| HTTP through explicit Pod tunnel | BackupLog, BackupResults, RestoreLog, RestoreResults | Altered signature and Host rejected by storage; HTTP is explicitly permitted for this local fixture |
| HTTPS tunnel, inline CA | Same four | Altered signature and missing private CA rejected |
| HTTPS tunnel, referenced CA | Same four | Named same-namespace certificate Secret/key, altered signature and missing CA rejection |
| Direct HTTPS, referenced CA | Same four | Same signing/TLS checks from the isolated official Node worker |

Every mode also verifies in-flight request-ID deduplication, a real create-only
409 with the original UID unchanged, and a generated-name ServerStatusRequest
that reaches Processed with a version. Each result contains content/request identity,
never its signed URL. Nonempty payloads and JSON result parsing are checked; these
four artifact kinds do not qualify resource-list or volume-info formats.

| Check | Exit / result | Evidence boundary |
| --- | --- | --- |
| Canonical normal and compact production suite | 0; 118 passed in each mode, 0 failed/skipped | 21 scaffold/consumer, 52 setup/fixture and 45 diagnostic checks |
| Transport contracts | 20 passed | Raw encoded path/query and Host, SNI/CA, TLS rejection, redirects/metadata/private policy, 404, invalid gzip, compressed/decoded limits, deadlines and active socket cancellation |
| Kubernetes adapter contracts | 7 passed | Explicit config/context, POST/generateName, 409, malformed/lost response, same-namespace CA only, target mismatch and cancellation of actual API I/O |
| Service contracts | 11 passed | Write/confirmation/sender binding, duplicate/replay, global concurrency, target invalidation, New/Processed/Failed, expiry/deadline, ambiguous submission and sanitized cleanup errors |
| Tunnel contracts | 7 passed | Source/compiled forwarding, identity/port refusal, listener/handshake/pod-lookup cancellation and closed sockets/listener |
| Full local `transport-proof` | 0; 16 real artifact downloads | Actual controller-created signed URLs; four modes above; no external target |
| Cleanup and restored environment | 0; pass | Original storage Deployment/Service/BSL restored, BSL Available, owned requests/Secrets/certificates/container removed, controller cleans Backup/Restore/artifacts and three namespaces |
| Final type/build, Biome, both Knip modes and Trunk | 0; pass | Trunk checks 23 files; repository lint retains one existing warning in the disabled remediation script |
| Archive and private-data checks | 0; pass | 2,037 allowlisted files, 980 relative source maps, isolated main/renderer load and packaged startup cancellation; no generated credentials in 58 project candidates or the package, no signed URLs in proof output |
| Actual Freelens installation/IPC | Not run | FND-10 remains open; compiled Node stubs are not an Electron result |

The final local archive is `freelensapp-velero-extension-0.1.0-alpha.0.tgz`,
2,040,093 bytes, with unchanged version, private publication flag and exact host/SDK
1.10.3. SHA-256: `efbe94bb10a988eafb973f3284b9699884da74a777a211a7343751bc00dca4f2`.
The extraction was checked outside the workspace with every non-builtin module
required to resolve inside that extraction, then removed. Bundled main libraries
are included; host SDK implementation, tests, credentials and absolute source-map
paths are excluded. This supersedes the historical scaffold archive, not the
unverified actual-host gate. Editor diagnostics report no errors in the touched code.

The service defaults to 250 ms polling, 30 seconds for URL availability, 120 seconds
overall including queued work, and two global operations. Download bounds are
10-second connect/TLS, 15-second idle, 16 MiB compressed and 64 MiB decoded. Tests
shrink these budgets; they cannot increase them. Cancellation does not delete a
Kubernetes request in product code. Local fixture cleanup has separate authorization.

The startup-cancellation regression covers abort after Pod lookup but before the
listener's `listening` event. Without an abortable event wait that promise remained
pending even after the listener closed. The fixed source and canonical bundle tests
pass. Empty Kubernetes error-channel initialization is allowed; actual error data
closes the tunnel. The pinned distributed WebSocket handler and supported native-
accelerator build switches require no upstream modification.

The proof adapter supports explicit client certificates/tokens only. Exec/auth-provider
plugins, proxy configurations and insecure TLS are refused, not silently retried.
Production catalog/sender wiring, DNS/destination resolution and automatic
Service/Pod selection remain P1/P2 integration work. Direct routes require a trusted
main-supplied numeric address; the proof does not implement public DNS resolution.
Release New/Processed and future Failed are contract-tested without changing the
pinned schemas. Expired status/404/timeout/size failures are synthetic contract
cases, not a claim that all were induced in the live store. No PV/CSI recovery,
real cloud, upstream rebuild or vulnerability scan was performed.

Private state remains under `$HOME/.local/state/freelens-velero-dev`. The data-free
`transport-proof.json` starts as running and becomes pass only after cleanup and
the fixture-free environment verifier succeed. `transport-requests.json` contains
request identities only. Signed URLs are never recorded; request-list cleanup uses
metadata-only output and suppresses DELETE bodies. Temporary CA/key files and
mounted direct-worker inputs are removed; retained reports are private mode 0600.
The default kubeconfig and original official image contents remain unchanged.

The [transport support decision](ARCHITECTURE.md#t06-transport-support-decision)
retains both authorized direct access and explicit Pod forwarding. Automatic
endpoint resolution and actual-host authentication still needed qualification, not
an implicit fallback. Overall T0.6 verdict: **PASS**. The actual-host acceptance
check was left to the integration test, FND-10, which covers it, on Freelens v2
since T0.7; the route of the main process and the connection of the host were
qualified later by SPEC-0010 and SPEC-0015.

## Capability Failures

| Missing capability | Work still possible | Required gap / next action |
| --- | --- | --- |
| Local Docker/kind | Unit/component and loopback contracts; packaged tests only where no cluster is required | Real-controller and cluster UI scenarios blocked; repair locally, never use a remote cluster |
| Node/toolchain | Documentation/source review and existing local infrastructure checks within scope | Build and UI tests blocked; select/install the approved toolchain in its step |
| Electron/Playwright/display | Unit, contracts, and local kind integration | Packaged UI and visual evidence blocked; no jsdom substitute for acceptance |
| Required image/download unavailable | Already available local tiers | Record exact missing pin; do not silently change versions or weaken the gate |

Do not discard a working tier because an independent prerequisite failed. A fallback
is partial evidence, never a full release pass. External writes are never a
fallback. Authorized external reads, if ever separately requested, must
obey the private-data isolation rules and are not necessary for these milestones.

## Pre-Review And Completion

At every milestone, exercise both themes at 900x650 and 1440x900, keyboard workflows,
200% zoom, long labels, empty/error/stale states and every reference link. Check
nonblank custom views, focus restoration, clipping, unstable layout, console errors,
and direct-delete paths. Measure responsiveness with a synthetic 1,000-object list:
at most 100 mounted data rows and p95 filter/selection response below 250 ms across
20 warm interactions on the recorded local environment. These are proposed budgets,
not measurements; investigate failures instead of reducing dataset size silently.

Evidence per run includes spec/requirement IDs, exact revision/version pins, command,
exit code, counts, artifact checksum, fixture mode, cleanup status, blockers and
unverified cases. Record only synthetic or generic data-free evidence. Keep large
logs/screenshots local outside the package; publishable extracts require a privacy
review. A pre-review inspection result must graduate into regression tests where
the behavior is automatable.

Spec lifecycle: Draft, Approved, Implemented, Verified (see [PROCESS.md](PROCESS.md)).
Approval of a design is not a successful test, and completion of this document is
not application verification. Record role/date/verdict without personal names.
Resolve blocking findings before reusing the affected patterns in the next milestone.
