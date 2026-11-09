# SPEC-0018: Release Readiness

- **Status:** Draft
- **Date:** 2026-11-09
- **Milestone / tasks:** M6 / T6.1, T6.2, T6.3, T6.4, T6.5
- **Reviewed Velero:** v1.18.4, `4ee1e79a7aed367fd9b767b8219ec65bd0c96892`, unchanged: this spec reads no behavior of Velero beyond what the specs it depends on record
- **Reviewed main:** not relevant: the subject of this spec is the release of the extension, its checks and its documents
- **Freelens validation target:** Freelens v2, the validation target of [SPEC-0015](SPEC-0015-freelens-v2-host.md), freelensapp/freelens `b9b53e16056578c5407312eba5823a089972f6d5`, the commit of the tag v2.0.0 of the release Freelens 2.0.0
- **Dependencies:** every spec of v1.0.0, SPEC-0001 to SPEC-0017; [D10 of SPEC-0015](SPEC-0015-freelens-v2-host.md#d10-the-version-and-the-release), the version line and its prereleases; the end of M5, T4.6 Done
- **Approval:** Pending: the lead maintainer approves the spec and decides D1 to D15, each Proposed below; the approval is recorded here by role and date

Governed by [AGENTS.md](../../AGENTS.md). A completed draft is not approval to
implement.

## Goal

Make the extension ready to be released as 1.0.0 for Freelens 2.0.0: the checks
of every agreed feature kept as the regression of the release, the gaps that
matter for a release closed, the views passed for their looks and their
accessibility, a README that is the page of a public package, assets that can be
verified, and the release itself, first as a prerelease and then on `latest`, on
the lead maintainer's go.

## Scope Baseline

The [roadmap](../development/ROADMAP.md#m6---release-readiness) plans five tasks
in M6, T6.1 to T6.5, beside the row of Freelens 2.0.0, Done with SPEC-0015. This
spec is the five, one section each, as SPEC-0017 is one spec for the actions of
the fifth.

An inventory of the checks of T6.1, made read only at `9a0fbc8` and kept by the
maintainers outside the repository, counts 61 checks in seven areas, the
regression, the packaged integration, the end to end tests with the real
controller, the isolation between clusters, the permissions, the transport
security and the performance, and 32 gaps, named G1.1 to G7.6 by area, which this
spec keeps as names. Each gap this spec takes was read again in the code at
`b7dd522`, the head of main of 2026-11-09, with the files it names. The third pull
request of T4.6, which is landing, adds the end to end proof of Delete backup
through the procedures of the compiled main process
(`e2e/scripts/local-delete-proof.mts`): it closes the first part of G3.1, and this
spec takes the second, the deletion in the packaged application with the real
controller.

Two open issues are parts of M6: [#144](https://github.com/freelensapp/freelens-velero-extension/issues/144),
a unit case that pins the assets of the release and a section of the README that
says how to verify a release, part of T6.4, and
[#145](https://github.com/freelensapp/freelens-velero-extension/issues/145), a
section of the README on the permissions with two example roles, part of T6.3.

Included: the regression of 1.0.0 and the gaps of [the tests](#tests) that this
spec takes; the visual pass and an accessibility scan; the README of 1.0.0, its
screenshots, a video and the release notes; the assets of the release and their
proof; the prerelease 1.0.0-0, its check, the review of the milestone and 1.0.0.

Excluded, with their owners:

- Any new feature or view. Editing a Schedule and the panels of backup coverage
  stay after v1.0.0 ([roadmap](../development/ROADMAP.md#deferred-after-v100)).
- The gaps of the inventory this spec does not take, each with its reason in
  [what this spec leaves out](#what-this-spec-leaves-out-of-the-inventory).
- Freelens 1, which v1.0.0 does not support (SPEC-0015).
- Any publication by this spec or by a slice of it: a version is published only
  by the release workflow, on the lead maintainer's go (T6.5).

## User Scenarios

1. **P1, a prerelease by its version:** Given 1.0.0-0 on the npm tag `next`, when
   an operator types `@freelensapp/velero-extension@1.0.0-0` on the Extensions page
   of Freelens 2.0.0, then the extension is installed and Enabled, and the views of
   a cluster with Velero load.
2. **P1, by name before 1.0.0:** Given only prereleases on the registry, when the
   operator types the name alone, then Freelens says that it found no version of
   the package, and the README says to install `@next` until 1.0.0.
3. **P1, a download verified:** Given the assets of a GitHub release, when the
   operator checks the tarball against its `.sha256`, then the check passes, and
   `npm audit signatures`, in a project that installs the package, verifies its
   provenance.
4. **P1, a role of the README:** Given an identity bound to the read-only role of
   the README, when the operator opens the views and asks an action, then the
   lists load and the action ends as forbidden with the words of what the identity
   may not do; bound to the role of the actions, the same action is confirmed and
   Velero acts on it.
5. **P1, the words of a failure:** Given an identity that may not forward a port,
   when the operator loads a log, then the tab says the words the section
   Troubleshooting of the README quotes, and that section names the verb to grant.
6. **P2, two clusters:** Given two clusters, each with an installation in the
   namespace `velero` and a backup `daily-1` with another UID, when both are open,
   then each frame lists its own backup, writes turned on in one are off in the
   other, and a write confirmed in one is not counted by the other.
7. **P2, a build that does not load:** Given a tag whose packed build does not
   activate in Freelens, when the release workflow runs, then FND-10 fails on that
   tarball and nothing is published.
8. **P2, a control with no name:** Given a view whose button loses its accessible
   name, when the pre-review runs, then the scan fails the case with the rule and
   the element.

## Requirements

### Regression And Safety (T6.1)

| ID | Contract | Acceptance check |
| --- | --- | --- |
| REQ-285 | The regression of 1.0.0 is every check of SPEC-0001 to SPEC-0017 and of this spec, each in its layer, run where [the table](#where-each-check-runs) says: on every pull request, on every push to main, every night on main and at a tag. No check of those specs is removed, skipped or loosened for the release. A version is tagged only on a commit of main whose runs of every workflow of the table are green; a run that passed only when run again is recorded with its first failure | REG-01 |
| REQ-286 | The bytes that ship are the bytes a test installed (G1.1). The release workflow packs the tarball once, runs FND-10 on that file in Freelens built at the commit of the validation target, as the integration workflow builds and caches it, and publishes that same file to npm, with no second pack; the checksum and the asset of the GitHub release are of that file. When FND-10 fails, nothing is published and no GitHub release is created | REG-02 |
| REQ-287 | Two clusters at once (G4.1, with G4.4). The environment of the suites can hold a second disposable kind cluster with the CRDs of the release alone, owned by the same journal under a second name, which the identity checks accept as they accept the first and nothing else. Its fixtures place an installation in a namespace of the same name as one of the first, with backups of the same names and other UIDs. In one packaged Freelens with both clusters in the catalog: each frame lists the objects of its own cluster, told apart by UID; selects its own installation, which the stored preferences keep under the identifier of each cluster, and shows it again after a restart; has its own gate, writes on in one and off in the other; and a write confirmed in the frame of one is counted by its API server alone. The cleanup removes both clusters | REG-03 |
| REQ-288 | An identity that holds the verbs of the write actions and one that does not (G5.1). Two identities of the test environment hold exactly the two example roles of the README (REQ-297): the operator, for the views, the tabs, the version of the server and every action, and the reader, for the views alone. The end to end proofs of the actions, Back up now, Create backup, Create schedule, Restore, Pause and Resume and Delete backup, run with the kubeconfig of the operator in place of the administrator of the kind cluster and end as they end today; each action asked with the reader ends as forbidden, at the step whose verb the reader lacks, with the words of what the identity may not do, and nothing is written, which the API server counts | REG-04 |
| REQ-289 | HTTPS in the main process of the host (G6.1). A case of FND-10 downloads an artifact over HTTPS inside the main process of the host, with the bundled transport, from a server on loopback whose certificate an authority made for the test signed, the authority given inline as a storage location gives it: the content is decoded. The same server with no authority given, and a certificate for another name, end as `tls-invalid`, with no URL in the words, and no connection is made without verification. The certificates are made outside the host by the helper the unit tests use, and no dependency is added | REG-05 |
| REQ-290 | The direct route in the main process of the host (G6.2). A case of FND-10 resolves, inside the main process of the host, with the bundled resolution of a route, the route of a storage location whose URL names an address of the machine that is not loopback, and downloads over HTTPS from a server listening there: without the allowance of private addresses for the cluster, the route is refused with the words of what may be allowed; with it, the connection is made directly to that address, whose certificate is checked for it, and the content is decoded. On a machine that has no such address the case fails and says so | REG-06 |
| REQ-291 | The actions with the real controller in the packaged application (G3.2, and the second part of G3.1). On the environment of the demo, with the server of the release, the packaged application asks Back up now in the view of the real schedule of the environment, then Delete backup of the backup it made, each through its workspace, with writes on and its review confirmed: the workspace and then the view of the backup show each phase Velero writes up to Completed, and the words that Velero has not read the backup are gone once a phase is read; the deletion is followed until the backup is gone, and the list of the Backups no longer shows it. The API server counts one creation of a Backup and one of a DeleteBackupRequest asked by the extension, and nothing of the run is left | REG-07 |

### Visual And Accessibility Pass (T6.2)

| ID | Contract | Acceptance check |
| --- | --- | --- |
| REQ-292 | The visual pass of 1.0.0 is the pre-review of the release candidate: every view of the extension, the workspace of each action among them, in both themes, at 1440 by 900, at 900 by 650 and at twice the zoom, with the journeys by the keyboard alone and its checks of what lies over something else or does not fit, run green on the commit of the prerelease the review of the milestone reads, with its report and its gallery. The lead maintainer judges the gallery at the review of the milestone (REQ-312); each finding is an issue, and the blocking ones are fixed before 1.0.0 | VIS-01 |
| REQ-293 | The pre-review scans every view it checks with axe-core and the rules of WCAG 2.1 at the levels A and AA (D8), in both themes, at 1440 by 900 and at 900 by 650, inside the root of the view of the extension: the sidebar, the top bar, the status bar, and the menus, dialogs and drawers of the host are left out, and a section of the extension in the details of the host is scanned alone. A violation fails its case unless the list of the exceptions, a file of the repository the suite reads, names its rule, its element, where it comes from, a component of the host the extension renders or a choice a spec made, and why it stays. An exception that matches no violation fails as well, and the report lists the exceptions met | VIS-02 |
| REQ-294 | axe-core is a devDependency at an exact version, loaded only by the pre-review into the frame it scans. No bundle carries it, and DEPENDENCY-AUDIT.md lists it among what only tests | VIS-03 |

### Documentation (T6.3)

The README of 1.0.0 is the page of the package on npm and on GitHub. Its sections
come in this order: Overview, with what the version covers, the video and the
screenshots; Installation;
Requirements; Permissions; Compatibility; Safety; Verify a release;
Troubleshooting; then Development, Build from the source and License, as they are.

| ID | Contract | Acceptance check |
| --- | --- | --- |
| REQ-295 | Installation says how to install the extension from the Extensions page of Freelens: by name, `@freelensapp/velero-extension`, which Freelens resolves to the newest version that is not a prerelease, and which finds no version until 1.0.0 is published; by the tag `@freelensapp/velero-extension@next`, the newest prerelease, which can be older than the newest release; by a version; and from the tarball of a GitHub release, checked as Verify a release says, dragged into the window or given by its path. It names the package as `package.json` names it | DOC-01 |
| REQ-296 | Requirements says what the extension needs and nothing more: Freelens 2.0.0 or a later 2.x, as `engines.freelens` declares, with Freelens 1 listing the package as Incompatible; a cluster with Velero, read through `velero.io/v1` and, for the data movement, `velero.io/v2alpha1`; an identity with the permissions of the section Permissions; nothing installed in the cluster beyond Velero, and no credential of the object store; Node.js only to build from source. The section Status, which says that there is no release, gives way to the version the README is published with | DOC-02 |
| REQ-297 | Permissions has a table, one row for each feature, the views, the tabs, a download through the cluster, the version of the server and each action, with the group, the resource, the verbs and the scope of each, every verb backed by a request the code makes, as #145 asks; and two example roles in YAML, one that reads the views and one for the views, the tabs, the version of the server and every action, a Role in the namespace of the installation for what is namespaced and a ClusterRole only for what is read in the whole cluster, with the verbs that are optional and what is lost without them. The two roles are the roles of the two identities of REQ-288 | DOC-03 |
| REQ-298 | Safety says what the extension writes to a cluster, every kind and verb the adapter of the main process allows and nothing else: the creation of a DownloadRequest and of a ServerStatusRequest, which loading a tab and reading the version of the server are; the creation of a Backup, a Schedule, a Restore and a DeleteBackupRequest; the patch of `spec.paused` and `spec.skipImmediately` of a Schedule; that each is refused unless writes are on for that cluster and namespace and its review is confirmed; that a restore and a deletion ask for the name of the backup typed; that a backup is deleted only through a DeleteBackupRequest, one at a time; and the rules on signed URLs, TLS and missing data it keeps today | DOC-04 |
| REQ-299 | Compatibility is a table: Freelens 2.0.x, tested at 2.0.0, the commit of the validation target; Velero 1.18.x with its AWS plugin 1.14.x, tested at v1.18.4 and v1.14.4; Kubernetes, tested at 1.34.11, the node of the test clusters; the platforms the checks ran on (D13); and what was proven on synthetic objects only, the data movement and the phases of a failure other than FailedValidation. A version outside the table is said to be untested, never to work or to fail | DOC-05 |
| REQ-300 | Troubleshooting has an entry for each failure an operator meets first: a list or an action refused to the identity, a port-forward refused, a certificate the transport refuses, a cluster that is not connected, and a store that does not answer. Each entry quotes the words the extension shows, which SPEC-0002, SPEC-0010, SPEC-0015 and SPEC-0017 record and the modules of the words write, says what causes them and what to do, and leads to Permissions or Safety where they answer | DOC-06 |
| REQ-301 | The README shows the views in screenshots the pre-review of the release candidate took on the disposable kind cluster of the demo, with its synthetic objects alone: the Overview, the list of the Backups, the workspace of a backup with its log, the adherence of the schedules and the review of a restore, in the dark theme. They are files under `docs/screenshots/`, outside the package, each with a text that says what it shows, and none shows anything of a real environment | DOC-07 |
| REQ-302 | A video of less than 60 seconds, recorded from the packaged Freelens on the disposable kind cluster of the demo with its synthetic data alone, shows the Overview, a backup with its log, the adherence of a schedule and an action with its review; the README links to it, and it is not in the package (D9). No frame shows a name, an address, a credential or anything of a real environment | DOC-08 |
| REQ-303 | The notes of each version are a section of `CHANGELOG.md` at the root of the repository, with the version and its date, written in a pull request before the one of the version: for 1.0.0, what the version covers by milestone, its requirements and compatibility, the safety rules in one paragraph, how to install and verify it, and its known limits; for a prerelease, what changed since the one before. The GitHub release of a version carries its section as its body, and the release workflow stops before the publication when the section is missing (D12) | DOC-09 |
| REQ-304 | Every relative link and image of the README and of `CHANGELOG.md` names a file of the repository, and every anchor a heading of its document; every external link answers when the lead maintainer reviews them. Both are in English, ASCII, with no em dash, no emoji, no person named and no comparison with other software, as AGENTS.md asks of what is published | DOC-10 |

### Release Assets (T6.4)

| ID | Contract | Acceptance check |
| --- | --- | --- |
| REQ-305 | A unit case pins the assets of the release in `release.yaml`, as #144 asks: the bill of materials in SPDX JSON named after the tarball, a `.sha256` of the tarball and of the bill of materials, the release with `fail_on_unmatched_files` and exactly the four patterns of the files, and the bill of materials and the checksums made after the publication and before the release; restated by each change of the workflow this spec brings (REQ-286, REQ-303, REQ-307, REQ-308) | ASSET-01 |
| REQ-306 | The README says how to verify a release, as #144 asks: the tarball against its `.sha256` with `sha256sum -c`; that the npm package carries a provenance attestation, checked with `npm audit signatures` in a project that installs it; that the bill of materials, an SPDX JSON file, is attached to each GitHub release with its own `.sha256`; and what it lists (REQ-307). Every command is one the workflow makes true | ASSET-02 |
| REQ-307 | The bill of materials is of what the package carries (D10): the extension and the libraries its bundles carry, react-window today, at the versions of the lockfile, and no devDependency. It is made from an installation of the production dependencies alone, with the same file name as today | ASSET-03 |
| REQ-308 | Every version is published with a provenance statement that names the release workflow, the tag and its commit (D11): the token of the environment `publishing` publishes the first version, since the package is not on the registry yet and a trusted publisher is configured for a package that is, and asks for the provenance as the trusted publisher does; then the trusted publisher is configured and the token removed, before the next version | ASSET-04 |
| REQ-309 | The proof on the first prerelease: its GitHub release is a prerelease with the four assets; `sha256sum -c` passes for the tarball and for the bill of materials; the tarball of the registry is the asset, byte for byte; `npm audit signatures` verifies its attestation, which names `release.yaml`, the tag and its commit; the bill of materials lists the extension and react-window and no devDependency; `next` names 1.0.0-0, and `latest` is what the first open question finds | ASSET-05 |

### Release (T6.5)

| ID | Contract | Acceptance check |
| --- | --- | --- |
| REQ-310 | The first prerelease, 1.0.0-0, is made when the lead maintainer asks for it (D10 of SPEC-0015), in the order of D15: the version workflow with the version `1.0.0-0`, its pull request merged after its checks, the tag on the merge commit of that pull request, whose runs are green (REQ-285), and the release workflow, which publishes on `next` and marks the GitHub release as a prerelease (HOST-21 of SPEC-0015). A change of the code after it is released as 1.0.0-N the same way. Nothing is published from a workstation | REL-01 |
| REQ-311 | Each prerelease is installed by its version from npm, `@freelensapp/velero-extension@1.0.0-N` typed on the Extensions page, in the release Freelens 2.0.0, its download checked against its published checksum, with a new profile, on macOS, and checked by FND-10, which the runner of the integration test runs on the version installed from npm when it is given one in place of a tarball (D14): Enabled, both entries loaded, the transport in the main process of the host, no error of the extension in the logs | REL-02 |
| REQ-312 | The review of the sixth milestone, as [PROCESS](../development/PROCESS.md#milestone-manual-review-gate) says, once the report of the pre-review of REQ-292 is in the lead maintainer's hands: the walk of [TRY-IT](../development/TRY-IT.md) on the environment of the demo, in the prerelease installed by its version; the gallery and the exceptions of the scan; the README, its screenshots, the video and the notes of 1.0.0. Its findings are issues, the blocking ones fixed, each fix released as a new prerelease and checked as REQ-311 says; the outcome is recorded in this spec by role and date | REL-03 |
| REQ-313 | 1.0.0 is published on `latest` on the lead maintainer's go, after the review of REQ-312, when every spec of v1.0.0 is Verified or waits only for a check of this milestone: the version workflow with `1.0.0`, its pull request, the tag, the release workflow. Then `latest` names 1.0.0, its GitHub release is not a prerelease, its assets pass the checks of REQ-309, Freelens 2.0.0 installs it by name in a profile where the last prerelease is installed, Enabled with its preferences kept, and the README and the roadmap say that 1.0.0 is released | REL-04 |

## Design

- **Standard or ad hoc view, and why.** Neither: the milestone adds no view and
  changes none. It checks the views that exist, and documents and releases them.
  A defect a check of this spec finds is fixed through the normal loop, with an
  amendment of the spec of its view.
- **Safety.** The checks write only to the disposable kind clusters of the
  environment: the second cluster of REQ-287, the actions of the two identities of
  REQ-288, the backup and its deletion of REQ-291, each removed by its run. The
  registry of npm and the releases of GitHub are written only by the release
  workflow, at a tag the tag workflow makes from the pull request of the version,
  on the lead maintainer's go. The README says what the extension writes
  (REQ-298), and its words are tied to the code by the checks of T6.3.

### Where Each Check Runs

| Layer | Workflow | Pull request | Push to main | Night, UTC | Tag |
| --- | --- | --- | --- | --- | --- |
| Unit, component and main contract, then the measures alone (`pnpm test:unit`) | `unit-tests.yaml` | Every one | Every one | No | No |
| The build, the type check, lint and Knip | `check.yaml` | Every one | Every one | No | No |
| Trunk on every file | `trunk-check.yaml` | Every one | Every one | No | No |
| FND-10 and a session for each of the ten kinds, on the CRDs of the release alone | `integration-tests.yaml` | Every one | Every one | No | FND-10, in the release workflow, on the tarball it ships (REQ-286) |
| The suites of the views, the pre-review and FND-10, in six parts | `views-tests.yaml` | The parts its files reach | Every part | Every part, 01:17 | No |
| The fixtures, the transport proof and the proofs of the actions, with the server of the release | `e2e-tests.yaml` | When its files reach them | Every one | 01:47 | No |
| OSV-Scanner | `osv-scanner.yaml` | Every one | Every one | Mondays, 20:38 | No |

The six parts of the views are the ones of `e2e/views-parts.json`: three on the
environment of the demo, with the server of the release, and three on the CRDs
alone. The new checks of T6.1 run in these layers: REQ-286 at the tag; REQ-287 in
the part of the suite of the gate; REQ-288 in the end to end tests; REQ-289 and
REQ-290 wherever FND-10 runs, the tag included; REQ-291 in a part of the
environment of the demo.

### The Release Flow

1. The notes of the version in `CHANGELOG.md`, in a pull request (REQ-303).
2. The version workflow, started by hand with the version, opens the pull
   request of the version; it is merged after its checks.
3. The tag workflow tags main at that merge, `vX.Y.Z` or `vX.Y.Z-N`.
4. The release workflow checks that the tag is the version of `package.json`,
   builds, packs once, runs FND-10 on that tarball (REQ-286), publishes it with
   provenance, on `next` for a version with a hyphen and on `latest` otherwise
   (REQ-308), makes the bill of materials of the production installation
   (REQ-307) and the checksums, and creates the GitHub release with the four
   assets and the notes as its body (REQ-303).
5. The proof of the assets (REQ-309) and the check by version (REQ-311).

The steps of 4 that this spec adds or changes are marked by their requirement.
Freelens 2.0.0 does not read the npm tag `latest` when it installs by name: it
takes the newest version that is not a prerelease, and says that it found none
when there is none
([`attempt-install-by-info.injectable.tsx`](https://github.com/freelensapp/freelens/blob/b9b53e16056578c5407312eba5823a089972f6d5/packages/core/src/renderer/components/extensions/attempt-install-by-info.injectable.tsx#L107-L155));
a name followed by a version or a tag installs that version, or the version the
tag names.

### The Amendments The Slices Bring

Each slice restates, with its own pull request and under the amendments of the
spec it touches, the part of that spec its change reaches, which the approval of
this spec covers.

| Spec or document | Now | Restated |
| --- | --- | --- |
| SPEC-0004, REQ-041 and REQ-044 (ENV-04, ENV-07), with REQ-287 | One kind cluster: a second node or a second network stops the command, and the removal deletes the cluster the journal owns | A second cluster of the CRDs alone, under its own name and network, owned by the same journal and checked as the first; the removal deletes both |
| SPEC-0009, the decision on the frame of a second entry, with REQ-287 | The second entry is the same cluster through another kubeconfig | Kept, with the second cluster of REQ-287 beside it |
| SPEC-0015, HOST-21, with REQ-310 | The first prerelease leaves `latest` untouched | As the first open question finds, said once the first prerelease is published |
| TESTING.md, the identities, the fixture matrix and the integration tests | Isolation is "unit plus authorized local integration"; the actions run as the administrator of the kind cluster | The two clusters of REQ-287, the two identities of REQ-288, the two cases of FND-10 of REQ-289 and REQ-290 |
| ARCHITECTURE.md and AGENTS.md, the paragraphs of a release | The release workflow builds, packs, publishes, then makes the bill of materials and the checksums | The flow of [the release](#the-release-flow) |
| DEPENDENCY-AUDIT.md, with REQ-294 | No library only tests the views | axe-core, among what only tests |

## Tests

| Check | Layer | Requirements | Scenario and expected evidence |
| --- | --- | --- | --- |
| REG-01 | Workflow, manual | REQ-285 | Before each version: the run of each workflow of [the table](#where-each-check-runs) on the commit the tag will name, green, listed with its counts in the evidence; a run that passed when run again listed with its first failure; the tag names that commit (REL-01) |
| REG-02 | Unit, workflow, packaged integration | REQ-286 | A case reads `release.yaml` without its comments: one pack, FND-10 on its file before the publication, the publication of that file and of no other, and the Freelens of the target named by the line the case of the target already checks in the two other workflows; seen failing when the step of FND-10 is removed or moved after the publication. At the first prerelease the log of the job shows FND-10 green on the tarball whose checksum the asset carries (ASSET-05) |
| REG-03 | Packaged application, end to end | REQ-287 | In the part of the suite of the gate: both clusters open; the lists by UID, the selection of each frame, the stored file with the key of each cluster and each frame with its own installation after a restart, the gate of each frame, one write counted on the API server of its cluster and none on the other; the unit cases of the environment accept the second cluster the journal owns and refuse any other, each refusal seen failing; both clusters removed at the end |
| REG-04 | End to end, unit | REQ-288 | The proofs of the six actions with the kubeconfig of the operator, green; each action with the reader, forbidden at its step, with nothing counted; a unit case finds the roles of the two identities equal to the two roles of the README |
| REG-05 | Packaged integration | REQ-289 | In FND-10: a download over HTTPS with the authority inline, decoded; no authority, and a certificate for another name, each `tls-invalid` with no URL in the words |
| REG-06 | Packaged integration | REQ-290 | In FND-10: the route of a URL that names an address of the machine that is not loopback, refused without the allowance with its words, then direct with it, and the download decoded; the case fails where the machine has no such address |
| REG-07 | Packaged application, end to end | REQ-291 | On the environment of the demo: Back up now on the real schedule, the phases read up to Completed in the workspace and in the view of the backup, the words of a backup not read yet gone; Delete backup followed until the backup is gone; one creation of each kind counted; nothing of the run left, which the verification of the environment after the part proves |
| VIS-01 | Pre-review, manual | REQ-292 | The pre-review on the commit of the prerelease the review reads, every case green, its counts, report and gallery; the judgment of the lead maintainer at REL-03 |
| VIS-02 | Pre-review | REQ-293 | The scan of every view in both themes at the two sizes, green with the exceptions of the file; seen failing on a view given a button with no name, an input with no label and a text below the contrast of AA in one theme; an exception that matches nothing fails |
| VIS-03 | Unit | REQ-294 | The build test finds no module of axe-core in either bundle and the manifest lists it among the devDependencies at an exact version; Knip finds it used |
| DOC-01 | Unit, manual | REQ-295 | A case reads the section: the name of `package.json`, the tag `next`, a version, the releases of the repository; each way tried at REL-02 and REL-04 |
| DOC-02 | Unit | REQ-296 | A case finds in the section the range of `engines.freelens` of `package.json` and the API versions of the kinds the extension reads, and no section that says there is no release |
| DOC-03 | Unit, end to end | REQ-297 | A case parses the two roles of the section and finds them equal to the roles of the two identities of REG-04; each row of the table checked with `kubectl auth can-i` in the pull request of #145 |
| DOC-04 | Unit | REQ-298 | A case finds in the section each kind and verb the adapter allows (ACT-01 of SPEC-0017), and no other kind of Velero said to be written |
| DOC-05 | Unit | REQ-299 | A case reads the table and finds the version and the commit of the target in the header of SPEC-0015 and the versions of the images in `e2e/scripts/local-manifests.mts`, so a move of a pin that leaves the README fails |
| DOC-06 | Unit | REQ-300 | A case reads each quoted message of the section and finds it equal to what the functions of the words return for its case, so a change of the words that leaves the README fails |
| DOC-07 | Unit, manual | REQ-301 | A case finds each image of the README in `docs/screenshots/`, with its text, and none in the files of the package; the lead maintainer looks at each at REL-03 |
| DOC-08 | Manual | REQ-302 | The length of the file under 60 seconds, every frame looked at by the lead maintainer at REL-03, the link of the README opened |
| DOC-09 | Unit, manual | REQ-303 | A case reads `release.yaml`: the body of the release is the section of the tag, and the job stops before the publication when it is missing; the notes of 1.0.0 read at REL-03 |
| DOC-10 | Unit, manual | REQ-304 | A case resolves each relative link, image and anchor of the two documents and finds no character outside ASCII and no em dash; the external links opened at REL-03 |
| ASSET-01 | Unit | REQ-305 | The case of #144, seen failing on each of its four changes, and on each change of the steps of REQ-286, REQ-303, REQ-307 and REQ-308 it pins |
| ASSET-02 | Unit, manual | REQ-306 | A case finds in the section `sha256sum -c`, `npm audit signatures` and the four assets of `release.yaml`; each command run on the assets of 1.0.0-0 (ASSET-05) |
| ASSET-03 | Unit, manual | REQ-307 | A case reads the step of the bill of materials: it scans the installation of the production dependencies; the document of 1.0.0-0 read (ASSET-05) |
| ASSET-04 | Unit, manual | REQ-308 | A case finds the provenance asked on both ways of the publication; the attestation of 1.0.0-0 and of 1.0.0 read from the registry |
| ASSET-05 | Manual | REQ-309 | The steps of [the success criteria](#success-criteria) on 1.0.0-0, each result recorded in the evidence |
| REL-01 | Workflow, manual | REQ-310 | The runs of the three workflows, the tag and its commit, equal to the merge commit of the pull request of the version, and the tags of the registry, recorded |
| REL-02 | Packaged integration | REQ-311 | FND-10 on the version installed from npm, in the release Freelens 2.0.0 on macOS, every case green, for each prerelease |
| REL-03 | Manual | REQ-312 | The review recorded by role and date, with its findings and their issues |
| REL-04 | Manual | REQ-313 | The steps of the success criteria on 1.0.0, with the install by name over the prerelease |

The homes: the cases that read the README, `CHANGELOG.md` and the workflows
beside the cases of the workflows in `test/environment.test.ts`, or in a file of
their own under `test/`; the two cases of FND-10 in
`integration/__tests__/extensions.tests.ts`, the main bundle exporting the
resolution of a route as it exports the transport; the second cluster in the
scripts of `e2e/scripts/`; the two identities among the fixtures; the scan and
its exceptions beside the pre-review and the parts of the views.

## Success Criteria

- Every check of the regression green on the commit of each version, the runs
  listed (REG-01), and every new check of T6.1 green where it runs.
- One tarball: the one FND-10 installed in the release job is the asset of the
  GitHub release and the tarball of the registry, byte for byte.
- The scan of the views green with its exceptions written, and the gallery
  judged at the review of the milestone.
- Each statement of the README that the code can contradict is read by a unit
  case: the name, the range of Freelens, the roles, the writes, the versions and
  the words of the failures.
- 1.0.0-0 checked by FND-10 by its version, the review of the milestone
  recorded, and 1.0.0 on `latest`, installed by name.
- Failure: a version published other than by the release workflow; a tarball
  published that FND-10 did not install; a README that says a write, a verb, a
  version or a message the code does not; anything of a real environment in a
  screenshot, the video or the notes; a write of a check outside the disposable
  clusters.

The steps of ASSET-05, on 1.0.0-0, each in an empty directory, with the result
recorded:

1. `gh release view v1.0.0-0 --repo freelensapp/freelens-velero-extension --json isPrerelease,assets`:
   a prerelease with the tarball, the bill of materials and their two `.sha256`.
2. The four assets downloaded; `sha256sum -c` of each `.sha256`: both OK.
3. `npm pack @freelensapp/velero-extension@1.0.0-0`, the registry asked again
   until it answers the version, for five minutes at most; `cmp` of that tarball
   with the asset: no difference.
4. In a new project, `npm install @freelensapp/velero-extension@1.0.0-0`, then
   `npm audit signatures`: the attestation of the package verified; the
   attestation the registry serves names `release.yaml`, `refs/tags/v1.0.0-0` and
   the commit of the tag.
5. The packages the bill of materials lists: the extension and react-window, at
   the versions of the lockfile, and nothing else.
6. `npm view @freelensapp/velero-extension dist-tags`: `next` is 1.0.0-0; `latest`
   recorded as it is.

The steps of REL-04, on 1.0.0: the steps 1 to 5 with the version 1.0.0 and a
release that is not a prerelease; `latest` is 1.0.0; in a profile where the last
prerelease is installed, the name typed alone on the Extensions page installs
1.0.0 over it, listed Enabled, with the installation selected before still
selected.

When D14 is not taken, the check of REL-02 is by hand: in the release Freelens
2.0.0 with a new profile, the version typed on the Extensions page; the extension
listed Enabled; Velero in the sidebar of the cluster of the demo, its Overview
loaded; the logs of the host without an error of the extension.

## Assumptions And Decisions

Each decision is Proposed: the draft recommends it, with its reason and the ways
not taken; the lead maintainer decides. What a slice decides within these
requirements is recorded in its evidence as decided while implementing, with its
date.

- **D1, Proposed, one spec for the milestone.** The five tasks share the release they
  prepare; one spec states the flow once, and each task is a section reviewed and
  tested on its own, each slice its own pull request. Five specs would state the
  flow five times.
- **D2, Proposed, the regression is what runs today, where it runs.** Every check of
  SPEC-0001 to SPEC-0017 stays in its layer and its workflow. No night run is added
  to the unit tests or to the integration test: both run on every pull request and
  every push to main, and the end to end tests and the views, which depend on
  images and a cluster, already run every night. The way not taken, night runs of
  both, runs again a commit its pull request and its push to main already ran,
  with nothing changed but the clock and the runner.
- **D3, Proposed, the release tests the tarball it ships.** FND-10 needs no cluster, so the
  release job runs it on its own tarball with the build of Freelens the integration
  workflow caches by the commit of the target, then publishes that file. FND-10
  proves what two builds of one commit could differ in: the activation, the two
  entries, the stylesheet and the transport. Not taken: every packaged suite in the
  release job, an environment and six parts for a commit main already ran them on;
  and a comparison with the tarball of the integration job, which needs a build
  proven to be reproducible.
- **D4, Proposed, a second cluster of the CRDs alone.** Two API servers are what a leak of a
  list, a UID or a gate between frames needs to show; the second entry of the same
  cluster, which SPEC-0009 decided, lists the same objects in both frames. A
  cluster of the CRDs alone is up in about a minute, and the suite of the gate runs
  on the CRDs already. The approval of this spec is the authorization TESTING.md
  asks for a second local kind target. The stored preferences of two frames, G4.4,
  are read in the same case. Not taken: the decision of SPEC-0009 alone.
- **D5, Proposed, the roles of the README are the identities of the tests.** The proofs of
  the actions run with the role the README gives an operator, so a verb the code
  starts to need fails a proof before it reaches an operator, and a unit case
  keeps the README and the identities equal. Not taken: the roles checked with
  `kubectl auth can-i` alone, as #145 does once, which proves the bindings and not
  what the code asks.
- **D6, Proposed, HTTPS and the direct route as cases of FND-10.** They run in the main
  process of the host, where the product runs, with no cluster: an HTTPS server and
  its authority made by the helper of the unit tests, and an address of the machine
  for the direct route. Not taken: a store with TLS reached directly in the
  environment of the demo, a second store whose address, on macOS, is published on
  loopback, which the route never connects to outside a tunnel.
- **D7, Proposed, two actions with the real controller.** Back up now and Delete backup in
  the packaged application, on the real schedule of the demo, are the two whose
  result the workspace and the views follow across phases Velero writes later, and
  they need no fixture the environment does not have. The restore and the pause
  and resume keep their proofs through the compiled main process and their suites
  on the CRDs: a restore writes a namespace into the cluster of the demo, and a
  pause and a resume read the schedule once, with no phase to wait for. Not taken:
  all five actions, and none.
- **D8, Proposed, an accessibility scan in the pre-review.** axe-core as a devDependency,
  run on every view in both themes, with the rules of WCAG 2.1 A and AA and not its
  best practices, the markup of the host left out, and every exception written with
  its reason. It catches what a screenshot does not show: a control with no name,
  a field with no label, a contrast below AA. Its license, MPL-2.0, binds what is
  distributed, and nothing of it is. Not taken: the human review of the gallery
  alone, which judges the looks and cannot read names, labels or ratios.
- **D9, Proposed, the README of a public package.** The sections in the order of T6.3, for
  an operator who installs first and reads last. The screenshots are files of the
  repository, outside the files of the package; the video is linked from the
  README as an attachment of the repository on GitHub, as the other extensions of
  the organization link theirs, so that neither the repository nor the package
  carries it. Not taken: the video in the repository.
- **D10, Proposed, the bill of materials of what ships.** Today the release scans the folder
  of the repository after the installation, so the document lists the
  devDependencies, which the tarball does not contain, and a scanner reads them as
  part of the package. Made from an installation of the production dependencies
  alone, it lists the extension and react-window, which DEPENDENCY-AUDIT.md says
  the bundle carries. Not taken: two documents, one of the repository and one of
  the package, which keeps the devDependencies among the assets of the release;
  and the document as it is with a sentence, which leaves the readers of scanners
  with the devDependencies.
- **D11, Proposed, provenance from the first version.** The registry has no version of the
  package (it answered 404 on 2026-11-09), and a trusted publisher is configured
  for a package that exists, so the first publication uses the token of the
  environment `publishing`. Today that way publishes with no provenance; asking it
  there as well gives 1.0.0-0 its attestation. Then the trusted publisher is
  configured and the token removed before the next version. Not taken: the first
  prerelease without provenance, proven only on the next version.
- **D12, Proposed, the notes in `CHANGELOG.md`.** Notes reviewed in a pull request like the
  code, and a release the workflow makes alone, with its notes as the body. Not
  taken: the body written by hand on GitHub after the workflow.
- **D13, Proposed, the platforms said as tested.** The bundles are JavaScript that does not
  depend on the platform, and their two parts that do, the port read from the line
  of kubectl and the path of a saved file, have unit tests. The hosted checks run
  on Linux ARM64, the packaged suites on macOS on the machines of the contributors,
  and REL-02 on macOS; Windows is said to be untested. Not taken: FND-10 on hosted
  macOS and Windows runners at each tag, with the released Freelens of each.
- **D14, Proposed, the check of a prerelease is FND-10 by version.** The runner of the
  integration test takes a name and a version in place of a tarball, and FND-10
  checks what Freelens installed from npm with all its cases, the same way for
  each prerelease. Not taken: the steps by hand of the success criteria.
- **D15, Proposed, the order of the slices.** First what the page of the package and its
  proof need: T6.4 with #144, then the bill of materials and the provenance; T6.3
  with #145, then the sections of REQ-295 to REQ-300. Then T6.1, with FND-10 in the
  release workflow first, and T6.2 beside it. Then 1.0.0-0, when the lead
  maintainer asks for it, so that its proof is the proof of the workflow 1.0.0
  will run and npm shows it with the README of a public package; then the
  screenshots, the video and the notes of 1.0.0, the review of the milestone and
  1.0.0. Not taken: 1.0.0-0 as soon as M5 is done, which proves the workflow before
  its changes, so that the proof of REQ-309 is made again on a later prerelease.

### What This Spec Leaves Out Of The Inventory

Each gap below stays out of 1.0.0, with its reason:

- G1.2, the goldens of the release tied to its pin: they change only with a move
  of Velero, whose pull request the upstream drift watch reviews before its merge;
  a case that ties them to the pin is after 1.0.0.
- G1.3, a record of the runs a machine reads: REG-01 lists the runs and their
  counts for each version.
- G1.4, a stored file of a released version: none was written yet; the file 1.0.0
  writes is the fixture of the first pull request after it.
- G2.1, one platform and one architecture: D13.
- G2.2, one Freelens: the target moves with each release of Freelens, as PROCESS
  says, and the README says what was tested.
- G2.3, an install over an earlier one and by name: REL-02 installs by version and
  REL-04 by name over the prerelease; an automated case waits for a second
  released version.
- G2.4, no night run of the ten sessions: they run on every pull request and push
  to main, on the CRDs alone.
- G3.3, the counterparts of what the controller writes checked by hand: read again
  at the next move of Velero, as SPEC-0015 says, and right for the reviewed
  release this version ships for.
- G3.4, induced failures and real data movement: a new family of fixtures; the
  README says what was proven on synthetic objects alone (REQ-299).
- G3.5, a zone in a schedule against a real firing: the parser is checked against
  the tables of the library of the release (SPEC-0013).
- G4.2, two entries with one context name: the gate, the kept ends and the
  allowances are keyed by the identifier of a cluster in the code; a unit case with
  two entries of one context name is after 1.0.0.
- G4.3, the other procedures forged in the packaged application: the unit tests
  bind the fourteen procedures to their frame for four senders, and the packaged
  case proves that the IPC of the host carries the binding.
- G4.5, the queue of the downloads shared by the clusters: by design, REQ-133 of
  SPEC-0010.
- G5.2, the verbs `get` and `watch` that the views do not use: the read-only role
  of the README grants what the code asks; a packaged suite with that role alone is
  a candidate after 1.0.0.
- G5.3, the Secret of a certificate by name: the mode of a referenced authority
  is proven with the administrator and refused to an identity without the rule.
- G5.4, the list of the permissions written as prose: REQ-288 and REQ-297 tie the
  README to the identities; a ledger of every request the code makes is after
  1.0.0.
- G6.3, the signed URL in the files of the log of the host: the transport writes
  no URL to a log, which its unit tests scan, and the packaged suites scan the
  views, the panel, the dialog and their reports; a scan of the files of the log is
  the first candidate after 1.0.0.
- G6.4, hostile payloads through the real IPC: both processes validate every
  field at run time, which the unit tests prove field by field.
- G7.1 to G7.6, the performance: the budgets of TESTING.md hold with the margins
  the evidence records; guards relative to a baseline, ceilings of size, memory
  and start, and larger datasets protect the versions after 1.0.0.

## Open Questions

Three questions of fact, each established by its slice; none needs an answer
before the approval.

- **Whether the registry names `latest` at the first publication under `next`
  (REQ-309, REQ-310).** The first publication of this package is 1.0.0-0 under
  `next`, and whether the registry names it under `latest` as well, for a package
  that has no version there yet, is not settled by what this draft read. Freelens
  does not read `latest` when it installs by name, as
  [the release flow](#the-release-flow) says, so an install from Freelens is the
  same either way; the page of the package on npm is not. The first prerelease
  records what the registry did, and HOST-21 of SPEC-0015 is restated with it.
- **The token of the first publication (REQ-308).** Only an owner of the scope
  `@freelensapp` on npm can give the environment `publishing` a token that creates
  a package; the date of the first prerelease depends on it.
- **What the scan finds in the components of the host (REQ-293).** The views
  render components of the host, whose markup the extension does not change; the
  first run of the scan establishes the exceptions they need, which the review of
  the milestone reads.

## Evidence And Deviations

None yet: the draft has no implementation, tests or runtime evidence. The facts
above were read at `b7dd522` of this repository, with the gaps of the inventory
read again in the code; the installer of the host at `b9b53e16`; issues #144 and
#145 read on 2026-11-09; and the registry of npm, which answered 404 for the
package on 2026-11-09. Nothing was run, and no cluster was contacted.
