# SPEC-0018: Release Readiness

- **Status:** Approved
- **Date:** 2026-11-09
- **Milestone / tasks:** M6 / T6.1, T6.2, T6.3, T6.4, T6.5
- **Reviewed Velero:** v1.18.4, `4ee1e79a7aed367fd9b767b8219ec65bd0c96892`, with the AWS plugin v1.14.4, the reviewed pair of [RECON-T0.1](../development/RECON-T0.1.md): this spec reads no behavior of Velero beyond what the specs it depends on record. The [upstream drift watch](../development/PROCESS.md#upstream-drift-watch) was read on 2026-11-09: Velero v1.19.0-rc.1, published on 2026-11-06, and the AWS plugin v1.15.0-rc.1, published on 2026-11-07, are release candidates, and v1.18.4 and v1.14.4 are still the latest stable releases, so the reviewed pair does not move (D17)
- **Reviewed main:** not relevant: the subject of this spec is the release of the extension, its checks and its documents
- **Freelens validation target:** Freelens v2, the validation target of [SPEC-0015](SPEC-0015-freelens-v2-host.md), freelensapp/freelens `b9b53e16056578c5407312eba5823a089972f6d5`, the commit of the tag v2.0.0 of the release Freelens 2.0.0
- **Dependencies:** every spec of v1.0.0, SPEC-0001 to SPEC-0017; [D10 of SPEC-0015](SPEC-0015-freelens-v2-host.md#d10-the-version-and-the-release), the version line and its prereleases; the fifth milestone, done and reviewed: its review gate passed with the lead maintainer on 2026-11-09
- **Approval:** Approved by the lead maintainer on 2026-11-09, with D1 to D19 as proposed; D11b is carried out with an owner of the npm scope `@freelensapp` when the first prerelease is asked for

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
security and the performance, and 32 gaps, named G1.1 to G7.6 by area. This spec
says in words what each gap it names is, in the requirement that takes it or in
the line that defers it, so it reads without the inventory: the names are labels,
and the slice that makes this spec Implemented removes them from the text unless
the inventory is committed under `docs/development/` by then. Each gap this spec
takes was read again in the code at `b7dd522`, the head of main of 2026-11-09,
with the files it names. The third pull request of T4.6 adds the end to end proof
of Delete backup through the procedures of the compiled main process
(`e2e/scripts/local-delete-proof.mts`): it closes the first part of G3.1, and this
spec takes the second, the deletion in the packaged application with the real
controller.

Two open issues are parts of M6: [#144](https://github.com/freelensapp/freelens-velero-extension/issues/144),
a unit case that pins the assets of the release and a section of the README that
says how to verify a release, part of T6.4, and
[#145](https://github.com/freelensapp/freelens-velero-extension/issues/145), a
section of the README on the permissions with two example roles, part of T6.3.

Included: the regression of 1.0.0 and the gaps of [the tests](#tests) that this
spec takes (D16); the visual pass and an accessibility scan; the README of 1.0.0,
its screenshots, a video and the release notes; the assets of the release, the
workflow that makes them and their proof; the prerelease 1.0.0-0, its check, the
review of the milestone, 1.0.0, and its listing in the marketplace of the
organization (D19).

Excluded, with their owners:

- Any new feature or view. Editing a Schedule and the panels of backup coverage
  stay after v1.0.0 ([roadmap](../development/ROADMAP.md#deferred-after-v100)).
- The gaps of the inventory this spec does not take, each with its reason in
  [what T6.1 defers](#what-t61-defers) (D16).
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
   operator checks the tarball against its `.sha256` with the command of the
   README for the system, then the check passes, and `npm audit signatures`, in a
   project that installs the package, verifies its provenance.
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
   then each frame lists its own backup, told apart by UID, and each shows its own
   installation again after a restart.
7. **P2, a build that does not load:** Given a change whose packed build does not
   activate in Freelens, when the job `package` of the release workflow runs, on
   the pull request of a change of that workflow or at a tag, then FND-10 fails on
   that tarball, and at a tag the job `publish` does not start: nothing is
   published and no GitHub release is created.
8. **P2, a control with no name:** Given a view whose button loses its accessible
   name, when the pre-review runs, then the scan fails the case with the rule and
   the element.

## Requirements

### Regression And Safety (T6.1)

| ID | Contract | Acceptance check |
| --- | --- | --- |
| REQ-285 | The regression of 1.0.0 is every check of SPEC-0001 to SPEC-0017 and of this spec, each in its layer, run where [the table](#where-each-check-runs) says: on every pull request, on every push to main, every night on main and at a tag. No check of those specs is removed, skipped or loosened for the release. Before the pull request of a version is merged, the last runs on main of every workflow of the table that runs there, of a push and of the night, and the checks of that pull request are green; a run that passed only when run again is recorded with its first failure. The tag names the merge commit (REQ-315), whose runs start with the merge and end after the tag: they are read and recorded with their counts, and the required reviewer of `publishing` (D11b) approves the job `publish` only once they are green, which makes that reading the gate of the publication. A red run found after a publication is handled as [the way back](#the-way-back) says | REG-01 |
| REQ-286 | The bytes that ship are the bytes a test installed (G1.1: no check installs the file the release publishes). The release workflow has two jobs. The job `package`, with the permission `contents: read` alone and no environment, checks at a tag that the tag is the version of `package.json`, builds, packs the tarball once and runs FND-10 on that file, in Freelens built at the commit of the validation target through the steps the integration workflow shares with it as one reusable workflow or one composite action, with no cluster: through a mode of the runner of the integration test that skips the checks of the target and of the namespaces, or through `xvfb-run pnpm test:integration integration/__tests__/extensions.tests.ts` with `FREELENS_APP` and `EXTENSION_PATH`. It then makes the bill of materials (REQ-307), the checksums of the tarball and of the bill of materials, the notes of the version (REQ-303) and the list of the contents (REQ-316), checks that the four files and the notes are there, and uploads them as an artifact of the run. The job `publish`, which needs `package`, runs in the environment `publishing` with `id-token: write` and `contents: write`, and runs nothing of the build: it downloads the artifact, verifies the sha256 of the tarball, publishes that very file with `pnpm publish <file>` (REQ-308), and creates the GitHub release with the four files and the notes. No step with a side effect runs before the publication, and when any step of `package` fails, nothing is published and no GitHub release is created. The job `package` runs as well, with no `publish`, on `workflow_dispatch` and on every pull request that changes `release.yaml`, `CHANGELOG.md` or the steps it shares, so that the workflow runs before its first tag | REG-02 |
| REQ-287 | A second cluster in the environment of the suites (G4.1: the isolation between clusters is proven on one API server). The environment can hold a second disposable kind cluster with the CRDs of the release alone, under a second name and on a network of its own, owned by the same journal, which the identity checks accept as they accept the first and nothing else; the scripts and the runner name the cluster, its journal entry, its network and its subnets through one parameter; the cleanup removes both | REG-03 |
| REQ-314 | Two clusters at once in one packaged Freelens (G4.1, with G4.4: the preferences of two frames are not read together). With both clusters in the catalog, and fixtures that place an installation in a namespace of the same name in each, with backups of the same names and other UIDs: each frame lists the objects of its own cluster, told apart by UID; and each selects its own installation, which the stored preferences keep under the identifier of its cluster, and shows it again after a restart. The gate of each frame and the count of the writes between frames stay proven by the suite of the second entry of SPEC-0009 (D4) | REG-08 |
| REQ-288 | The roles of the README, proven both ways (G5.1: no identity holds the verbs of the write actions; G5.2: nothing proves that the reading role is enough). Two identities of the test environment hold exactly the two example roles of the README (REQ-297): the operator, for the views, the tabs, the version of the server and every action, and the reader, for the views alone. They replace the administrator of the kind cluster for the session of the extension alone: the proofs take one kubeconfig today for the session and for what they place and remove (the real schedule, the namespace of a restore), which the operator may not do, so their context holds both. With the kubeconfig of the operator, the end to end proofs of the actions, Back up now, Create backup, Create schedule, Restore, Pause and Resume and Delete backup, the proof of the download through the cluster and a request of the version of the server end as they end with the administrator. With the kubeconfig of the reader, the restricted suite of the views passes; a creation of a Backup and the patch of a Schedule, the two ways the adapter writes, each end as forbidden at the step whose verb the reader lacks, with the words of what the identity may not do, and nothing is written, which the API server counts | REG-04 |
| REQ-289 | HTTPS in the main process of the host (G6.1: the bundled transport is not run over TLS in Electron). A case of FND-10 downloads an artifact over HTTPS inside the main process of the host, with the bundled transport, from a server on loopback whose certificate an authority made for the test signed, the authority given inline as a storage location gives it: the content is decoded. The same server with no authority given, and a certificate for another name, end as `tls-invalid`, with no URL in the words, and no connection is made without verification. The certificates are made outside the host by the helper the unit tests use, and no dependency is added | REG-05 |
| REQ-290 | The direct route in the main process of the host (G6.2: the resolution of a route is not run in Electron). A case of FND-10 resolves, inside the main process of the host, with `resolveRoute`, which the main bundle exports and the build test lists among its exports, the route of a storage location whose URL names an address literal of a private range on which nothing listens, from the ranges the extension counts as private (RFC 1918, or 198.18.0.0/15): without the allowance of private addresses for the cluster, the route is refused with the words of what may be allowed; with it, the route is direct to that address. No listener is opened beyond loopback, and nothing is connected to | REG-06 |
| REQ-291 | The actions with the real controller in the packaged application (G3.2: the packaged actions run on the CRDs alone, and the second part of G3.1). On the environment of the demo, with the server of the release, two cases of a suite of a part that exists ask, in the packaged application, Back up now in the view of the real schedule of the environment, then Delete backup of the backup it made, each through its workspace, with writes on and its review confirmed: the workspace and then the view of the backup show each phase Velero writes up to Completed, and the words that Velero has not read the backup are gone once a phase is read; the deletion is followed until the backup is gone, and the list of the Backups no longer shows it. The API server counts one creation of a Backup and one of a DeleteBackupRequest asked by the extension, and nothing of the run is left | REG-07 |
| REQ-317 | A ceiling on the size of what ships (P7.2 of the inventory, for G7.2: nothing bounds the size of the bundles). The build test holds each of `dist/main.js`, `dist/renderer.js` and `dist/renderer.css` under a ceiling of bytes, set by its slice a quarter above the size of each at that commit, and a change that passes a ceiling fails until the ceiling is moved, with its reason, in the pull request that needs it | REG-09 |

### Visual And Accessibility Pass (T6.2)

| ID | Contract | Acceptance check |
| --- | --- | --- |
| REQ-292 | The visual pass of 1.0.0 is the pre-review of the release candidate: every view of the extension, the workspace of each action among them, in both themes, at 1440 by 900, at 900 by 650 and at twice the zoom, with the journeys by the keyboard alone and its checks of what lies over something else or does not fit, run green on the commit of the prerelease the review of the milestone reads, with its report and its gallery. The lead maintainer judges the gallery at the review of the milestone (REQ-312); each finding is an issue, and the blocking ones are fixed before 1.0.0 | VIS-01 |
| REQ-293 | The pre-review scans every view it checks with axe-core and the rules of WCAG 2.1 at the levels A and AA (D8), in both themes, at 1440 by 900 and at 900 by 650, inside the root of the view of the extension: the sidebar, the top bar, the status bar, and the menus, dialogs and drawers of the host are left out, and a section of the extension in the details of the host is scanned alone. The report of the pre-review lists every violation with its rule, its impact, its element and where it comes from. A violation of impact serious or critical on an element the extension renders fails its case, unless the list of the exceptions, a file of the repository the suite reads, names its rule, its element and the choice of a spec that keeps it. What comes from a component of the host is reported and does not fail | VIS-02 |
| REQ-294 | axe-core is a devDependency at an exact version, loaded only by the pre-review into the frame it scans. No bundle carries it, and DEPENDENCY-AUDIT.md lists it among what only tests | VIS-03 |

### Documentation (T6.3)

The README of 1.0.0 is the page of the package on npm and on GitHub, in the
layout of the other extensions of the organization (amended on 2026-11-09 at the
request of the lead maintainer). Its sections come in this order: the title and
the badges; Overview, with the entries of the extension in the sidebar, the write
mode, the video and the screenshots, and under it Status, which says the line of
versions the README is published with, the prereleases of 1.0.0 on `next` and
1.0.0 not released, with no number of a version, and what the version covers by
milestone; Requirements, with Compatibility as its subsection; Supported APIs, the kinds the extension reads by
their API version; Permissions; Install, from the registry, from a release
tarball and from a directory, with Verify a release as its last subsection;
Getting started; Safety; then Development, Build from the source, with the
subsections of the other extensions, and License. Features, Limits and
Troubleshooting take their places with the slices that write them. Installation,
in the requirements below, is the section Install. A unit case reads what can go
stale without anyone seeing it, the range of Freelens, the roles, the writes, the
versions, the notes and the links; the other sections are read by the checklist
of the review of the milestone (REQ-312).

| ID | Contract | Acceptance check |
| --- | --- | --- |
| REQ-295 | Installation says how to install the extension from the Extensions page of Freelens: by name, `@freelensapp/velero-extension`, which Freelens resolves to the newest version that is not a prerelease, and which finds no version until 1.0.0 is published; by the tag `@freelensapp/velero-extension@next`, the newest prerelease, which can be older than the newest release; by a version; and from the tarball of a GitHub release, checked as Verify a release says, dragged into the window or given by its path. It names the package as `package.json` names it | DOC-01 |
| REQ-296 | Requirements says what the extension needs and nothing more: Freelens 2.0.0 or a later 2.x, as `engines.freelens` declares, with Freelens 1 listing the package as Incompatible; a cluster with Velero, read through `velero.io/v1` and, for the data movement, `velero.io/v2alpha1`; an identity with the permissions of the section Permissions; nothing installed in the cluster beyond Velero, and no credential of the object store; Node.js only to build from source. The section Status, which says that there is no release, gives way to the version the README is published with | DOC-02 |
| REQ-297 | Permissions has a table, one row for each feature, the views, the tabs, a download through the cluster, the version of the server and each action, with the group, the resource, the verbs and the scope of each, every verb backed by a request the code makes, as #145 asks; and two example roles in YAML, one that reads the views and one for the views, the tabs, the version of the server and every action, a Role in the namespace of the installation for what is namespaced and a ClusterRole only for what is read in the whole cluster, with the verbs that are optional and what is lost without them. The two roles are the roles of the two identities of REQ-288, written in the form the case of DOC-03 renders them | DOC-03 |
| REQ-298 | Safety says what the extension writes to a cluster, every kind and verb the adapter of the main process allows and nothing else: the creation of a DownloadRequest and of a ServerStatusRequest, which loading a tab and reading the version of the server are; the creation of a Backup, a Schedule, a Restore and a DeleteBackupRequest; the patch of `spec.paused` and `spec.skipImmediately` of a Schedule; that each is refused unless writes are on for that cluster and namespace and its review is confirmed; that a restore and a deletion ask for the name of the backup typed; that a backup is deleted only through a DeleteBackupRequest, one at a time; and the three rules it keeps today, signed URLs never logged, stored or shown, TLS verified by default, and missing data shown as unknown | DOC-04 |
| REQ-299 | Compatibility is a table: Freelens 2.0.x, tested at 2.0.0, the commit of the validation target; Velero 1.18.x with its AWS plugin 1.14.x, tested at v1.18.4 and v1.14.4; Kubernetes, tested at 1.34.11, the node of the test clusters; the platforms the checks ran on (D13); and what was proven on synthetic objects only, the data movement and the phases of a failure other than FailedValidation. A version outside the table, Velero 1.19 among them (D17), is said to be untested, never to work or to fail | DOC-05 |
| REQ-300 | Troubleshooting has an entry for each failure an operator meets first: a list or an action refused to the identity, a port-forward refused, a certificate the transport refuses, a cluster that is not connected, and a store that does not answer. Each entry quotes the words the extension shows, which SPEC-0002, SPEC-0010, SPEC-0015 and SPEC-0017 record and the modules of the words write, says what causes them and what to do, and leads to Permissions or Safety where they answer | DOC-06 |
| REQ-301 | The README shows the views in screenshots the pre-review of the release candidate took on the disposable kind cluster of the demo, with its synthetic objects alone: the Overview, the list of the Backups, the workspace of a backup with its log, the adherence of the schedules and the review of a restore, in the dark theme, and the Overview in the light theme as well. They are files under `docs/screenshots/`, outside the package, each with a text that says what it shows, and none shows anything of a real environment | DOC-07 |
| REQ-302 | A video of less than 60 seconds, recorded from the packaged Freelens on the disposable kind cluster of the demo with its synthetic data alone, shows the Overview, a backup with its log, the adherence of a schedule and an action with its review; the README links to it, and it is not in the package (D9). No frame shows a name, an address, a credential or anything of a real environment | DOC-08 |
| REQ-303 | The notes of each version are a section of `CHANGELOG.md` at the root of the repository, with the version and its date, written in a pull request before the one of the version: for 1.0.0, what the version covers by milestone, its requirements and compatibility, the safety rules in one paragraph, how to install and verify it, and its known limits; for a prerelease, what changed since the one before, and for 1.0.0-0 what it covers. A unit case fails the pull request of a version whose section is missing; the job `package` makes the notes from the section of the tag and fails when it is missing, before anything is published, and the GitHub release carries them as its body (D12) | DOC-09 |
| REQ-304 | Every relative link and image of the README and of `CHANGELOG.md` names a file of the repository, and every anchor a heading of its document; every external link answers when the lead maintainer reviews them. Both are in English, ASCII, with no em dash, no emoji, no person named and no comparison with other software, as AGENTS.md asks of what is published | DOC-10 |

### Release Assets (T6.4)

| ID | Contract | Acceptance check |
| --- | --- | --- |
| REQ-305 | A unit case pins the assets of the release in `release.yaml`, as #144 asks: the bill of materials in SPDX JSON named after the tarball, a `.sha256` of the tarball and of the bill of materials, the release with `fail_on_unmatched_files` and exactly the four patterns of the files, and their order. The case of #144 pins the order the workflow has when it lands, the bill of materials and the checksums made after the publication and before the release; with REQ-286 it pins the order of the two jobs instead, the bill of materials and the checksums made in `package`, before the publication, which amends that one phrase of #144. It is restated by each change of the workflow this spec brings (REQ-286, REQ-303, REQ-307, REQ-308, REQ-316) | ASSET-01 |
| REQ-306 | The README says how to verify a release, as #144 asks: the tarball against its `.sha256`, with `sha256sum -c` on Linux, `shasum -a 256 -c` on macOS, and `Get-FileHash -Algorithm SHA256` compared with the file on Windows; that the npm package carries a provenance attestation, checked with `npm audit signatures` in a project that installs it; that the bill of materials, an SPDX JSON file, is attached to each GitHub release with its own `.sha256`; and what it lists (REQ-307). Every command is one the workflow makes true | ASSET-02 |
| REQ-307 | The bill of materials is of what the package carries (D10): the extension and the libraries its bundles carry, react-window today, at the versions of the lockfile, and no devDependency and no peer: react and react-dom, the peers of react-window, are provided by the host and are not carried. The job `package` makes it from the packed file, installed in an empty directory with `npm install --omit=dev --omit=peer --ignore-scripts --no-package-lock <file>`, never from the registry, and the scan of that directory, with the same file name as today. The first slice records the list it gives | ASSET-03 |
| REQ-308 | Every version is published with a provenance statement that names the release workflow, the tag and its commit (D11a): the job `publish` asks for the provenance on both of its ways, with a token and through the trusted publisher. The first version, 1.0.0-0, is published with the granular token of D11b, created for it by an owner of the scope, since npm configures a trusted publisher on a package that exists, as far as this draft read (the second open question); no credential of npm exists for this package today. Before the next version the token is revoked on npm and deleted from the environment, the trusted publisher is configured, and one prerelease is published through it before 1.0.0 | ASSET-04 |
| REQ-309 | The proof on the first prerelease: its GitHub release is a prerelease with the four assets; the checksum of REQ-306 passes for the tarball and for the bill of materials; the tarball of the registry is the asset, byte for byte, and the one on which the log of `package` shows FND-10 green and whose sha256 `publish` verified; `npm audit signatures` verifies its attestation, which names `release.yaml`, the tag and its commit; the bill of materials lists the extension and react-window and nothing else; `next` names 1.0.0-0, and `latest` names nothing or 1.0.0-0, recorded (HOST-21 as restated) | ASSET-05 |
| REQ-316 | What the package contains, and the notice of what it bundles. The job `package` lists the files of the tarball and fails on a file outside `files` and what the packer always adds, the manifest, the README and the license, which the first run records; on an absolute path of the machine that built it in any file; and on the form of a credential the private-data rules of AGENTS.md name, a kubeconfig, a private key, a token of npm or of GitHub. The license notice of each library a bundle carries, the MIT notice of react-window today, travels in the package, which the list finds, and DEPENDENCY-AUDIT.md says where | ASSET-06 |

### Release (T6.5)

| ID | Contract | Acceptance check |
| --- | --- | --- |
| REQ-310 | The first prerelease, 1.0.0-0, is made when the lead maintainer asks for it (D10 of SPEC-0015), once what gates it in D15 is Done: the drift watch read and recorded in RECON-T0.1; the notes of 1.0.0-0 in `CHANGELOG.md`; the version workflow with the version `1.0.0-0`, its pull request merged after its checks and the runs of main green (REQ-285); the tag workflow on the merge commit of that pull request (REQ-315); the job `package`, then the job `publish`, approved by the required reviewer (D11b), which publishes on `next` and marks the GitHub release as a prerelease (HOST-21 of SPEC-0015 as restated). A change of the code after it is released as 1.0.0-N the same way. Nothing is published from a workstation; what an owner of the scope does by hand is [the way back](#the-way-back) alone | REL-01 |
| REQ-315 | The tag workflow tags the commit of the version. On the merge of the pull request of the version, it checks out, reads the version from and tags `github.event.pull_request.merge_commit_sha`, never `heads/main` as it is when the job runs. On the comment `/tag`, it acts only when the author of the comment is an owner, a member or a collaborator of the repository (`author_association` OWNER, MEMBER or COLLABORATOR) and the pull request of the version the comment is on was merged, and tags its merge commit the same way | REL-05 |
| REQ-311 | Each prerelease is checked by its version in the release Freelens 2.0.0 on macOS. The `.dmg` of Freelens 2.0.0 for the architecture of the machine is checked against the `.sha256` its release publishes, and its application copied to a folder outside `/Applications`, which the runner of the integration test refuses. Given the name and the version in place of a tarball (D14), the runner runs FND-10, which installs the version from npm through the Extensions page in a new profile, the host checking the download against the integrity the registry gives. The extension is listed Enabled, both entries load and the transport works in the main process of the host. The files of the log of the host hold no line of an error of the extension | REL-02 |
| REQ-312 | The review of the sixth milestone, as [PROCESS](../development/PROCESS.md#milestone-manual-review-gate) says, once the report of the pre-review of REQ-292 is in the lead maintainer's hands: the walk of [TRY-IT](../development/TRY-IT.md) on the environment of the demo, in the prerelease installed by its version; the gallery and the report of the scan; the README, its screenshots, the video and the notes of 1.0.0, with the checklist of the sections no case reads (DOC-01, DOC-06, DOC-07). Its findings are issues, the blocking ones fixed, each fix released as a new prerelease and checked as REQ-311 says; the outcome is recorded in this spec by role and date | REL-03 |
| REQ-313 | 1.0.0 is published on `latest` on the lead maintainer's go, after the review of REQ-312, once what gates 1.0.0 in D15 is Done, M6 is done as D18 reads it, and every spec of v1.0.0 is Verified or waits only for a check of this milestone: the drift watch read again and recorded in RECON-T0.1 (D17), the version workflow with `1.0.0`, its pull request, the tag, the release workflow. Then `latest` names 1.0.0, its GitHub release is not a prerelease, its assets pass the checks of REQ-309, Freelens 2.0.0 installs it by name in a profile where the last prerelease is installed, Enabled with its preferences kept, and the README and the roadmap say that 1.0.0 is released | REL-04 |

## Design

- **Standard or ad hoc view, and why.** Neither: the milestone adds no view and
  changes none. It checks the views that exist, and documents and releases them.
  A defect a check of this spec finds is fixed through the normal loop, with an
  amendment of the spec of its view.
- **Safety.** The checks write only to the disposable kind clusters of the
  environment: the second cluster of REQ-287, the actions of the two identities of
  REQ-288, the backup and its deletion of REQ-291, each removed by its run. No
  check opens a listener beyond loopback. The registry of npm and the releases of
  GitHub are written only by the job `publish` of the release workflow, at a tag
  the tag workflow makes on the merge commit of the pull request of the version,
  approved by the required reviewer of `publishing` (D11b); the job that builds and
  starts Freelens holds no credential. The README says what the extension writes
  (REQ-298), and its words are tied to the code by the checks of T6.3.

### Where Each Check Runs

| Layer | Workflow | Pull request | Push to main | Night, UTC | Tag |
| --- | --- | --- | --- | --- | --- |
| Unit, component and main contract, then the measures alone (`pnpm test:unit`) | `unit-tests.yaml` | Every one | Every one | No | No |
| The build, the type check, lint and Knip | `check.yaml` | Every one | Every one | No | No |
| Trunk on every file | `trunk-check.yaml` | Every one | Every one | No | No |
| FND-10 and a session for each of the ten kinds, on the CRDs of the release alone | `integration-tests.yaml` | Every one | Every one | No | No |
| The suites of the views, the pre-review and FND-10, in six parts | `views-tests.yaml` | The parts its files reach | Every part | Every part, 01:17 | No |
| The fixtures, the transport proof and the proofs of the actions, with the server of the release | `e2e-tests.yaml` | When its files reach them | Every one | 01:47 | No |
| OSV-Scanner | `osv-scanner.yaml` | Every one | Every one | Mondays, 20:38 | No |
| The job `package`, FND-10 on the tarball it packs, and the assets; then the job `publish` | `release.yaml` | `package`, when its files change | No | No | Both jobs |

The six parts of the views are the ones of `e2e/views-parts.json`: three on the
environment of the demo, with the server of the release, and three on the CRDs
alone. The job `package` runs as well when it is started by hand. The new checks
of T6.1 run in these layers: REQ-286 in the job `package`; REQ-287 and REQ-314 in
a part on the CRDs alone; REQ-288 in the end to end tests and in the part of the
restricted suite; REQ-289 and REQ-290 wherever FND-10 runs, the job `package`
included; REQ-291 in a part of the environment of the demo; REQ-317 in the unit
tests.

### The Release Flow

1. The drift watch, read and recorded in RECON-T0.1 before 1.0.0-0 and before
   1.0.0 (REQ-310, REQ-313).
2. The notes of the version in `CHANGELOG.md`, in a pull request (REQ-303).
3. The version workflow, started by hand with the version, opens the pull
   request of the version; it is merged once its checks and the last runs of
   main are green (REQ-285).
4. The tag workflow tags the merge commit of that pull request, `vX.Y.Z` or
   `vX.Y.Z-N` (REQ-315).
5. The job `package` of the release workflow, which holds no credential, checks
   that the tag is the version of `package.json`, builds, packs once, runs FND-10
   on that tarball (REQ-286), makes the bill of materials of the packed file
   (REQ-307), the checksums, the notes (REQ-303) and the list of the contents
   (REQ-316), checks them, and uploads them.
6. The job `publish`, in the environment `publishing`, waits for its required
   reviewer, who approves it once the runs of the merge commit are green (D11b);
   it verifies the sha256 of the tarball, publishes that file with provenance, on
   `next` for a version with a hyphen and on `latest` otherwise (REQ-308), and
   creates the GitHub release with the four assets and the notes as its body.
7. The proof of the assets (REQ-309) and the check by version (REQ-311).

On a pull request that changes the files of the job `package`, and when it is
started by hand, that job runs alone, and nothing is published.

Freelens 2.0.0 does not read the npm tag `latest` when it installs by name: it
takes the newest version that is not a prerelease, deprecated or not, and says
that it found none when there is none
([`attempt-install-by-info.injectable.tsx`](https://github.com/freelensapp/freelens/blob/b9b53e16056578c5407312eba5823a089972f6d5/packages/core/src/renderer/components/extensions/attempt-install-by-info.injectable.tsx#L105-L156));
a name followed by a version or a tag installs that version, or the version the
tag names.

### The Way Back

A version on the registry is never published again, and nothing of this flow
unpublishes one. A version found bad, by a red run of its merge commit or later,
is announced nowhere, or its announcement is withdrawn. A prerelease found bad is
deprecated with `npm deprecate` and replaced by the next number, 1.0.0-N. A bad
1.0.0 is deprecated and followed by 1.0.1 through the same flow: Freelens installs
by name the newest version that is not a prerelease, deprecated or not, so only a
newer version replaces it for an operator; `latest` may be moved back with
`npm dist-tag` for the page of the package and the command line, until 1.0.1
moves it. `npm deprecate` and `npm dist-tag` are the only commands run by hand, by
an owner of the scope, on the lead maintainer's go, since the workflow publishes
through the trusted publisher and does not run them; each is recorded in the
evidence by role and date.

### The Amendments The Slices Bring

Each slice restates, with its own pull request and under the amendments of the
spec it touches, the part of that spec its change reaches, which the approval of
this spec covers.

| Spec or document | Now | Restated |
| --- | --- | --- |
| SPEC-0004, REQ-041 and REQ-044 (ENV-04, ENV-07), with REQ-287 | One kind cluster: a second node or a second network stops the command, and the removal deletes the cluster the journal owns | A second cluster of the CRDs alone, under its own name and network, owned by the same journal and checked as the first, named through one parameter of the harness; the removal deletes both |
| SPEC-0009, the decision on the frame of a second entry, with REQ-314 | The second entry is the same cluster through another kubeconfig | Kept, and with it the proof of the gate between frames and of the count of their writes; the second cluster of REQ-287 beside it, for the lists and the selections |
| SPEC-0015, HOST-21, with REQ-310 | The first prerelease leaves `latest` untouched | `next` names 1.0.0-0, and `latest` names nothing or 1.0.0-0, as the registry does with the first version of a package, recorded at the first prerelease. Freelens finds no version by name either way; a command line that installs the name alone takes what `latest` names, so the README says to install `@next` or a version until 1.0.0 |
| SPEC-0015, REQ-216, with D18 | 1.0.0 on `latest` only after M6 is done | M6 done read as T6.1 to T6.4 Done and the review of the milestone passed |
| TESTING.md, the identities, the fixture matrix and the integration tests | Isolation is "unit plus authorized local integration"; the actions run as the administrator of the kind cluster; FND-10 runs in the integration and views workflows | The two clusters of REQ-287 and REQ-314, the two identities of REQ-288 for the session, the two cases of FND-10 of REQ-289 and REQ-290, FND-10 in the job `package`, the scan of REQ-293 |
| ARCHITECTURE.md and AGENTS.md, the paragraphs of a release and of the workflows | The release workflow builds, packs, publishes, then makes the bill of materials and the checksums, in one job; the tag workflow tags main; AGENTS.md says the views run in five parts | The flow of [the release](#the-release-flow), in two jobs, and the tag of the merge commit; six parts |
| PROCESS.md, the working agreements | Packages are published only by the release workflow, tags created only by the tag workflow | The same, the tag on the merge commit of the pull request of the version; and [the way back](#the-way-back), by an owner of the scope on the lead maintainer's go |
| DEPENDENCY-AUDIT.md, with REQ-294 and REQ-316 | Testing Library and jsdom are for the tests alone; nothing says where the notice of react-window travels | axe-core joins Testing Library and jsdom among what only tests; the notice of react-window travels in the package |
| RECON-T0.1.md, with REQ-310 and REQ-313 | The last entry of the drift watch at the start of a milestone is of 2026-10-13 | An entry before 1.0.0-0 and one before 1.0.0 |
| ROADMAP.md, with D16 | The row of T6.1 names the packaged integration and the performance | At the approval, the row narrowed to what D16 takes, and what it defers recorded under Deferred after v1.0.0 |

The files the slices change beside the specs and the documents above:

| File | Change | Requirements |
| --- | --- | --- |
| `.github/workflows/release.yaml` | The jobs `package` and `publish`; the triggers `workflow_dispatch` and the pull requests of its files; FND-10, the bill of materials, the checksums, the notes and the list of the contents in `package`; the check of the sha256 and `pnpm publish <file>`, with provenance on both ways, in `publish` | REQ-286, REQ-303, REQ-305, REQ-307, REQ-308, REQ-316 |
| `.github/workflows/integration-tests.yaml`, with a new reusable workflow or composite action under `.github/` | The steps that make the Freelens of the target, shared with `package`, with the line of its commit | REQ-286 |
| `e2e/scripts/local-demo.mts` | The mode of the runner without a cluster, if the slice takes it over `xvfb-run` of the file; the runner by version of D14 | REQ-286, REQ-311 |
| `.github/workflows/tag.yaml` | The merge commit of the pull request of the version; the association of the author of `/tag` | REQ-315 |
| `test/environment.test.ts`, or files of their own under `test/` | The cases of the workflows, REG-02, ASSET-01, ASSET-03, ASSET-04, ASSET-06 and REL-05, beside the case of the tags, with the case of the target extended to the workflow or action that builds Freelens; the cases of the environment of REQ-287; the cases that read the README and `CHANGELOG.md` | REQ-286, REQ-287, REQ-296 to REQ-299, REQ-303 to REQ-308, REQ-315, REQ-316 |
| `src/main/index.ts`, `test/build.test.ts` | `resolveRoute` exported by the main bundle and listed among the exports the build test pins; the ceilings of the bundles | REQ-290, REQ-317 |
| `integration/__tests__/extensions.tests.ts` | The cases of REQ-289 and REQ-290 | REQ-289, REQ-290 |
| `e2e/scripts/`, the fixtures and a suite of a part of the demo | The second cluster, the two identities, the two cases of REQ-291 | REQ-287, REQ-288, REQ-291, REQ-314 |
| `e2e/__tests__/pre-review.tests.ts` and a file of the exceptions; `package.json` and the lockfile | The scan, and axe-core at an exact version | REQ-293, REQ-294 |
| `README.md`, `CHANGELOG.md` (new), `docs/screenshots/` (new) | The sections of T6.3 and of REQ-306, the notes, the screenshots | REQ-295 to REQ-304, REQ-306 |
| The packed files, `dist/` or `files` of `package.json` | The notice of react-window | REQ-316 |

## Tests

| Check | Layer | Requirements | Scenario and expected evidence |
| --- | --- | --- | --- |
| REG-01 | Workflow, manual | REQ-285 | Before the merge of the pull request of each version: the last runs on main of each workflow of [the table](#where-each-check-runs) that runs there, of a push and of the night, and the checks of that pull request, green, listed with their counts in the evidence; a run that passed when run again listed with its first failure. After the tag: the runs of the merge commit, listed with their counts and green before the required reviewer approves the job `publish`; the tag names that commit (REL-01) |
| REG-02 | Unit, workflow, packaged integration | REQ-286 | A case reads `release.yaml` without its comments: two jobs; `package` with `contents: read` alone and no environment, one pack, FND-10 on its file, the bill of materials, the checksums, the notes and the list of the contents before the upload, and no publication and no release; `publish` that needs `package`, in `publishing`, with the download, the check of the sha256, `pnpm publish` of that file and then the release, and no build and no pack; the tag, `workflow_dispatch` and the pull requests of its files as triggers, with `publish` at a tag alone; and the Freelens of the target named by the line the case of the target checks. Seen failing when FND-10 is removed or moved into `publish`, when `publish` builds or packs, and when `package` is given the environment or a permission to write. The run of `package` on the pull request of the change, green, with FND-10 on its tarball; at the first prerelease, the log of `package` shows FND-10 green on the tarball whose sha256 `publish` verified and the asset carries (ASSET-05) |
| REG-03 | Unit, end to end | REQ-287 | The unit cases of the environment accept the second cluster the journal owns and refuse any other, each refusal seen failing; in the part, both clusters up and checked, and both removed at the end, which the verification of the environment proves |
| REG-08 | Packaged application | REQ-314 | In a part on the CRDs alone, both clusters open: the lists of each frame by UID; the selection of each frame, the stored file with the key of each cluster, and each frame with its own installation after a restart |
| REG-04 | End to end, packaged application | REQ-288 | With the kubeconfig of the operator for the session: the proofs of the actions, the proof of the download and a request of the version of the server, green. With the kubeconfig of the reader: the restricted suite, green; a creation of a Backup and the patch of a Schedule, each forbidden at its step with nothing counted |
| REG-05 | Packaged integration | REQ-289 | In FND-10: a download over HTTPS with the authority inline, decoded; no authority, and a certificate for another name, each `tls-invalid` with no URL in the words |
| REG-06 | Packaged integration, unit | REQ-290 | In FND-10: the route of a URL that names a private address literal nothing listens on, refused without the allowance with its words, then direct to that address with it, and no connection; the build test lists `resolveRoute` among the exports of the main bundle |
| REG-07 | Packaged application, end to end | REQ-291 | On the environment of the demo, two cases of a suite of a part that exists: Back up now on the real schedule, the phases read up to Completed in the workspace and in the view of the backup, the words of a backup not read yet gone; Delete backup followed until the backup is gone; one creation of each kind counted; nothing of the run left, which the verification of the environment after the part proves |
| REG-09 | Unit | REQ-317 | The build test finds each bundle under its ceiling; seen failing with a ceiling set below the size of its bundle |
| VIS-01 | Pre-review, manual | REQ-292 | The pre-review on the commit of the prerelease the review reads, every case green, its counts, report and gallery; the judgment of the lead maintainer at REL-03 |
| VIS-02 | Pre-review | REQ-293 | The scan of every view in both themes at the two sizes, its report listing every violation, green with the exceptions of the file; seen failing when the case itself, in the DOM of the page it scans and never in the source of a view, removes the name of a button, removes the label of an input and lowers the contrast of a text below AA in one theme |
| VIS-03 | Unit | REQ-294 | The build test finds no module of axe-core in either bundle and the manifest lists it among the devDependencies at an exact version; Knip finds it used |
| DOC-01 | Manual | REQ-295 | The checklist of REL-03 reads the section: the name of `package.json`, the tag `next`, a version, the releases of the repository; each way tried at REL-02 and REL-04 |
| DOC-02 | Unit | REQ-296 | A case finds in the section the range of `engines.freelens` of `package.json` and the API versions of the kinds the extension reads, and no section that says there is no release |
| DOC-03 | Unit, end to end | REQ-297 | A case compares the two YAML blocks of the section, text for text, with a rendering of the roles of the two identities of REQ-288, with no YAML parser; it lands with #145, after the identities; each row of the table checked with `kubectl auth can-i` in the pull request of #145 |
| DOC-04 | Unit | REQ-298 | A case finds in the section each kind and verb the adapter allows (ACT-01 of SPEC-0017), no other kind of Velero said to be written, and the three rules, signed URLs, TLS and missing data, each by the words that say it |
| DOC-05 | Unit | REQ-299 | A case reads the table and finds the version and the commit of the target in the header of SPEC-0015 and the versions of the images in `e2e/scripts/local-manifests.mts`, so a move of a pin that leaves the README fails |
| DOC-06 | Manual | REQ-300 | The checklist of REL-03 compares each quoted message with what the function of its words returns for its case, which the slice lists beside the quote |
| DOC-07 | Manual | REQ-301 | The checklist of REL-03: each screenshot looked at by the lead maintainer, with its text; DOC-10 resolves its file under `docs/screenshots/`, and ASSET-06 finds none in the package |
| DOC-08 | Manual | REQ-302 | The length of the file under 60 seconds, every frame looked at by the lead maintainer at REL-03, the link of the README opened |
| DOC-09 | Unit, manual | REQ-303 | A case finds in `CHANGELOG.md` a section for the version of `package.json` when that version is of the release form, seen failing on a version with no section, so the pull request of a version fails without its notes; the case of REG-02 finds the notes made in `package` and given to the release; the notes of 1.0.0 read at REL-03 |
| DOC-10 | Unit, manual | REQ-304 | A case resolves each relative link, image and anchor of the two documents and finds no character outside ASCII and no em dash; the external links opened at REL-03 |
| ASSET-01 | Unit | REQ-305 | The case of #144, seen failing on each of its four changes; restated with REQ-286 for the order of the two jobs, and with each change of REQ-303, REQ-307, REQ-308 and REQ-316, each seen failing on the step it pins |
| ASSET-02 | Unit, manual | REQ-306 | A case finds in the section the three commands of the checksum, `npm audit signatures` and the four assets of `release.yaml`; each command run on the assets of 1.0.0-0 (ASSET-05) |
| ASSET-03 | Unit, workflow, manual | REQ-307 | A case reads the step of the bill of materials: the packed file installed in an empty directory with the flags of REQ-307, and that directory scanned; the document of the run of `package` on its pull request, and the one of 1.0.0-0 (ASSET-05), list the extension and react-window and nothing else |
| ASSET-04 | Unit, manual | REQ-308 | A case finds the provenance asked on both ways of `publish`; the attestation of 1.0.0-0 read from the registry; the token revoked and deleted, recorded by role and date; the attestation of the first prerelease published through the trusted publisher read the same way, before 1.0.0 |
| ASSET-05 | Manual | REQ-309 | The steps of [the success criteria](#success-criteria) on 1.0.0-0, each result recorded in the evidence |
| ASSET-06 | Workflow, unit | REQ-316 | The step of `package` lists the tarball: the files of `files`, the manifest, the README, the license and the notice of react-window, and nothing else, with no absolute path of the runner and no form of a credential; a case pins the step; seen failing on a file added outside `dist/` and on the notice removed |
| REL-01 | Workflow, manual | REQ-310 | The entry of the drift watch in RECON-T0.1; the runs of REG-01; the tag and its commit, equal to the merge commit of the pull request of the version; the runs of the two jobs; the tags of the registry; recorded |
| REL-05 | Unit | REQ-315 | A case reads `tag.yaml` without its comments, next to the case of the tags: the checkout, the version and the tag of the merge commit of the pull request, no `heads/main`, and the three associations on the way of the comment; seen failing when `heads/main` is put back and when an association is dropped |
| REL-02 | Packaged integration | REQ-311 | On macOS, for each prerelease: the `.dmg` of Freelens 2.0.0 checked against its `.sha256`; FND-10 run by the version, every case green, the version listed Enabled; the files of the log of the host with no line of an error of the extension |
| REL-03 | Manual | REQ-312 | The review recorded by role and date, with its checklist, its findings and their issues |
| REL-04 | Manual | REQ-313 | The entry of the drift watch; the steps of the success criteria on 1.0.0, with the install by name over the prerelease |

The homes: the cases that read the README, `CHANGELOG.md` and the workflows
beside the cases of the workflows in `test/environment.test.ts`, or in a file of
their own under `test/`; the two cases of FND-10 in
`integration/__tests__/extensions.tests.ts`, the main bundle exporting
`resolveRoute` as it exports the transport, with the pin of its exports and the
ceilings in `test/build.test.ts`; the second cluster in the scripts of
`e2e/scripts/`; the two identities among the fixtures; the scan and its exceptions
beside the pre-review and the parts of the views; the bill of materials and the
list of the contents as steps of `package`.

## Success Criteria

- Every check of the regression green before the merge of each version, the runs
  of its merge commit green before its publication, listed (REG-01), and every new
  check of T6.1 green where it runs.
- The workflow run before its first tag: the job `package` green on the pull
  request of its change, and nothing published by it.
- One tarball: the one `package` packed, FND-10 installed and `publish` verified
  is the asset of the GitHub release and the tarball of the registry, byte for
  byte.
- The scan of the views run with its report, and no violation of impact serious
  or critical on an element of the extension but the exceptions a spec made; the
  gallery judged at the review of the milestone.
- Each statement of the README that the code can change without anyone seeing it
  is read by a unit case: the range of Freelens, the roles, the writes, the
  versions, the notes and the links; the installation, the words of the failures
  and the screenshots are read by the checklist of the review of the milestone.
- 1.0.0-0 checked by FND-10 by its version, one prerelease published through the
  trusted publisher, the review of the milestone recorded, and 1.0.0 on `latest`,
  installed by name.
- Failure: a version published other than by the job `publish`, or without the
  approval of its required reviewer; a tarball published that FND-10 did not
  install; a credential of npm left in `publishing` after 1.0.0-0; a README that
  says a write, a verb, a version or a message the code does not; anything of a
  real environment in a screenshot, the video, the notes or the package; a write
  of a check outside the disposable clusters, or a listener opened beyond
  loopback.

The steps of ASSET-05, on 1.0.0-0, each in an empty directory, with the result
recorded:

1. `gh release view v1.0.0-0 --repo freelensapp/freelens-velero-extension --json isPrerelease,assets`:
   a prerelease with the tarball, the bill of materials and their two `.sha256`.
2. The four assets downloaded; `sha256sum -c` of each `.sha256`, or
   `shasum -a 256 -c` on macOS: both OK.
3. `npm pack @freelensapp/velero-extension@1.0.0-0`, the registry asked again
   until it answers the version, for five minutes at most; `cmp` of that tarball
   with the asset: no difference.
4. In a new project, `npm install @freelensapp/velero-extension@1.0.0-0`, then
   `npm audit signatures`: the attestation of the package verified; the
   attestation the registry serves names `release.yaml`, `refs/tags/v1.0.0-0` and
   the commit of the tag.
5. The packages the bill of materials lists: the extension and react-window, at
   the versions of the lockfile, and nothing else.
6. `npm view @freelensapp/velero-extension dist-tags`: `next` is 1.0.0-0;
   `latest` recorded as it is, nothing or 1.0.0-0.
7. The log of the run: FND-10 green in `package` on the tarball whose sha256 is
   the one of the asset, and verified by `publish`.

The steps of REL-04, on 1.0.0: the steps 1 to 5 and 7 with the version 1.0.0 and
a release that is not a prerelease, the attestation of the trusted publisher;
`latest` is 1.0.0; in a profile where the last prerelease is installed, the name
typed alone on the Extensions page installs 1.0.0 over it, listed Enabled, with
the installation selected before still selected.

When D14 is not taken, the check of REL-02 is by hand: in the release Freelens
2.0.0 copied out of its checked `.dmg`, with a new profile, the version typed on
the Extensions page; the extension listed Enabled; Velero in the sidebar of the
cluster of the demo, its Overview loaded; the files of the log of the host without
an error of the extension.

## Assumptions And Decisions

One assumption, a risk to the time of T6.2: the views render components of the
host whose markup the extension does not change, and how many violations they
bring is not known before the first run of the scan. That run lists them in its
report, their exceptions follow it, and the review of the milestone reads them;
D8 bounds the risk by failing only on the elements of the extension.

Each decision was proposed by the draft, with its reason and the ways not taken,
and approved by the lead maintainer on 2026-11-09 as proposed. What a slice decides within these
requirements is recorded in its evidence as decided while implementing, with its
date.

- **D1, one spec for the milestone.** The five tasks share the release they
  prepare; one spec states the flow once, and each task is a section reviewed and
  tested on its own, each slice its own pull request. Five specs would state the
  flow five times.
- **D2, the regression is what runs today, where it runs.** Every check of
  SPEC-0001 to SPEC-0017 stays in its layer and its workflow. No night run is added
  to the unit tests or to the integration test: both run on every pull request and
  every push to main, and the end to end tests and the views, which depend on
  images and a cluster, already run every night. The way not taken, night runs of
  both, runs again a commit its pull request and its push to main already ran,
  with nothing changed but the clock and the runner.
- **D3, the release tests the tarball it ships, in a job that cannot publish.**
  FND-10 needs no cluster, so the job `package` runs it on its own tarball, in
  Freelens built at the commit of the target through the steps the integration
  workflow shares with it, and uploads that file. That job installs packages with
  `apt-get` and `sudo`, builds or restores a third-party application and starts
  it, so it holds `contents: read` alone and no environment: no code it runs can
  ask for the identity the trusted publisher accepts, read a credential of the
  environment, or change what the publication later runs. The job `publish` runs
  nothing of the build; it verifies the sha256 and publishes that very file, so
  the bytes are the same by construction, and ASSET-05 only confirms it.
  Everything without a side effect is made in `package`, so that a failure of the
  bill of materials, the checksums or the notes stops the run before the
  publication, and `package` runs on the pull request of a change of its files,
  so the workflow runs before its first tag. FND-10 proves what two builds of one
  commit could differ in: the activation, the two entries, the stylesheet and the
  transport. Not taken: FND-10 in the job that publishes, which would give that job
  the build and the start of Freelens to trust; every packaged suite in the
  release, an environment and six parts for a commit main already ran them on; and
  a comparison with the tarball of the integration job, which needs a build proven
  to be reproducible.
- **D4, a second cluster of the CRDs alone, for what two API servers add.** A
  second cluster shows what only two API servers can: lists told apart by UID, and
  the selection of each frame kept under the identifier of its cluster and after a
  restart, which is G4.4. The gate of each frame and the count of the writes
  between frames stay proven by the second entry SPEC-0009 decided, the same
  cluster through another kubeconfig, whose suite passes. A cluster of the CRDs
  alone is up in about a minute, and the harness is parameterized once by the name
  of the cluster. The approval of this spec is the authorization TESTING.md asks
  for a second local kind target. Not taken: the decision of SPEC-0009 alone; and
  every assertion of the gate again on the second cluster, which proves twice what
  the second entry proves.
- **D5, the roles of the README are the identities of the tests, proven both ways.**
  The operator runs the proofs of the actions, of the download and of the version
  of the server, and the reader runs a packaged suite of the views, so a verb the
  code starts to need fails a check before it reaches an operator, for the role
  that reads as for the role that acts. The reader is refused a creation and the
  patch, the two ways the adapter writes. A unit case keeps the README and the
  identities equal. Not taken: the roles checked with `kubectl auth can-i` alone,
  as #145 does once, which proves the bindings and not what the code asks; and the
  reader refused at each of the six actions, which repeats the two ways of the
  adapter.
- **D6, HTTPS and the direct route as cases of FND-10.** They run in the main
  process of the host, where the product runs, with no cluster: an HTTPS server on
  loopback and its authority made by the helper of the unit tests (REQ-289), and a
  route resolved for a private address literal nothing listens on, with no
  connection (REQ-290). The resolution is what Electron has never run; the
  download over TLS is the case of REQ-289. Not taken: a server on an address of
  the machine that is not loopback, which opens a listener on the network of the
  machine of a contributor, needs a certificate for that address and fails where
  there is none; and a store with TLS reached directly in the environment of the
  demo, whose address, on macOS, is published on loopback, which the route never
  connects to outside a tunnel.
- **D7, two actions with the real controller.** Back up now and Delete backup in
  the packaged application, on the real schedule of the demo, are the two whose
  result the workspace and the views follow across phases Velero writes later, and
  they need no fixture the environment does not have. The restore keeps its end to
  end proof through the compiled main process, which restores into a mapped
  namespace of the environment and removes it, and its suites on the CRDs; the
  pause and the resume keep theirs, which read the schedule once, with no phase to
  wait for. The reason is the cost: each would be a case more in the slowest part,
  for a result its proof already reads from the controller. Not taken: all five
  actions, and none.
- **D8, an accessibility scan in the pre-review.** axe-core as a devDependency,
  run on every view in both themes, with the rules of WCAG 2.1 A and AA and not its
  best practices, the markup of the host left out. For 1.0.0 it reports every
  violation and fails only on one of impact serious or critical on an element the
  extension renders, unless an exception names the choice of a spec that keeps
  it; what the components of the host bring is reported, and its exceptions are
  written after the first run. It catches what a screenshot does not show: a
  control with no name, a field with no label, a contrast below AA. Its license,
  MPL-2.0, binds what is distributed, and nothing of it is. Not taken: the human
  review of the gallery alone, which judges the looks and cannot read names,
  labels or ratios; and a scan that fails on every violation and on every
  exception that matches nothing from its first run, which makes the components of
  the host a list of findings with no bound before 1.0.0.
- **D9, the README of a public package.** The sections in the order of T6.3, for
  an operator who installs first and reads last. The screenshots are files of the
  repository, outside the files of the package; the video is linked from the
  README as an attachment of the repository on GitHub, as the other extensions of
  the organization link theirs, so that neither the repository nor the package
  carries it. Not taken: the video in the repository.
- **D10, the bill of materials of what ships.** Today the release scans the folder
  of the repository after the installation, so the document lists the
  devDependencies, which the tarball does not contain, and a scanner reads them as
  part of the package. The job `package` installs the packed file in an empty
  directory with `npm install --omit=dev --omit=peer --ignore-scripts --no-package-lock <file>`
  and scans that directory: the extension and react-window, which
  DEPENDENCY-AUDIT.md says the bundle carries. react and react-dom, the peers of
  react-window, are provided by the host and are not carried, so they are neither
  installed nor listed; no lockfile is written for a scanner to read them from.
  The file of the job is installed, not the registry, which answers a new version
  only after some minutes. The first slice runs it once and records the list. Not
  taken: two documents, one of the repository and one of the package, which keeps
  the devDependencies among the assets of the release; the document as it is with
  a sentence, which leaves the readers of scanners with the devDependencies; and
  the scan of the packed file with the libraries the build test lists added to it,
  which needs code of the repository to write the document.
- **D11a, provenance on both ways of the publication.** The job `publish` asks
  for the provenance with a token as it does through the trusted publisher: today
  the way of a token publishes with none, so asking it there gives 1.0.0-0 its
  attestation. A change of `release.yaml` alone. Not taken: the first prerelease
  without provenance, proven only on the next version.
- **D11b, for the lead maintainer and an owner of the npm scope, the credential of the first version.**
  The registry has no version of the package (it answered 404 on 2026-11-09), and
  npm configures a trusted publisher on a package that exists, as far as this
  draft read (the second open question). The environment `publishing` has no
  secret, no required reviewer and no wait timer, and its deployment policies are
  the tags `v*` and the branches `publish/v*`, read on 2026-11-09: anyone who may
  push such a ref may run a workflow in it. The plan, outside the repository:
  1. An owner of the scope `@freelensapp` creates a granular access token that may
     publish in the scope, with the shortest expiry npm allows, and puts it in
     `publishing` for 1.0.0-0 alone.
  2. The lead maintainer is the required reviewer of `publishing` from before
     1.0.0-0 and for every publication after it: the job `publish` waits for that
     approval, given once the runs of the merge commit are green (REQ-285), which
     is the go of REQ-310 and REQ-313 in a form the workflow enforces. The branches
     `publish/v*` leave the deployment policies, so that only a tag reaches the
     environment.
  3. Once 1.0.0-0 is published, the token is revoked on npm and deleted from the
     environment, each recorded by role and date.
  4. The owner configures the trusted publisher of the package with this
     repository, the file `release.yaml` and the environment `publishing`.
  5. One prerelease after 1.0.0-0 is published through the trusted publisher
     before 1.0.0, so that a mistake in that setting shows on a prerelease.

  The date of the first prerelease depends on the first step. Not taken: a token
  for every version, a credential that lives as long as the package; and 1.0.0 as
  the first publication through the trusted publisher, which would show a mistake
  of its setting at the last step.
- **D12, the notes in `CHANGELOG.md`.** Notes reviewed in a pull request like the
  code, a unit case that fails the pull request of a version without them, and a
  release the workflow makes alone, with its notes as the body. Not taken: the body
  written by hand on GitHub after the workflow, and a check of the notes only by
  the release workflow, which finds them missing after the tag, when the number is
  spent.
- **D13, the platforms the README says were tested.** The hosted checks, the
  packaged suites among them, run on Linux ARM64, `ubuntu-24.04-arm`; REL-02 runs
  on macOS; the contributors run the suites on macOS as well, which is evidence for
  their pull requests and not a status. The bundles are JavaScript that does not
  depend on the platform, and their two parts that do, the port read from the line
  of kubectl and the path of a saved file, are tested with fakes only. The README
  says that Linux ARM64 and macOS were tested, and that any other platform, Windows
  among them, was not. Not taken: a README that says the extension runs wherever
  Freelens runs. What T6.1 defers of the platforms is in D16.
- **D14, the check of a prerelease is FND-10 by version.** The runner of the
  integration test takes a name and a version in place of a tarball, and FND-10
  checks what Freelens installed from npm with all its cases, the same way for
  each prerelease, in the release Freelens 2.0.0 for macOS copied out of its
  checked image. Not taken: the steps by hand of the success criteria.
- **D15, the order of the slices, and what gates 1.0.0-0 and what gates 1.0.0.**
  The lead maintainer can ask for the prerelease early, once what gates it is
  Done; the rest gates 1.0.0.
  - Gates 1.0.0-0: the drift watch read (REQ-310); T6.4, REQ-305 with #144,
    REQ-306, REQ-307, REQ-308 with D11a and the first two steps of D11b, and
    REQ-316; the release workflow of REQ-286, with the case of FND-10 of REQ-289;
    REQ-303 for its unit case, the step of the notes and the section of 1.0.0-0;
    the rules of the tag, REQ-285 before the merge and REQ-315; and what a
    prerelease is installed with, REQ-295 and the end of the section Status of
    REQ-296, with the case of REQ-304 on them, since npm shows the README of the
    version. Then 1.0.0-0 (REQ-310), its proof (REQ-309) and its check by version
    (REQ-311).
  - Gates 1.0.0: the rest of T6.1, REQ-287 with REQ-314, REQ-288, REQ-290,
    REQ-291 and REQ-317; T6.2; the rest of T6.3, the Permissions of #145
    (REQ-297) after the identities of REQ-288, so that the case of DOC-03 lands
    with the roles; the notes of 1.0.0; the prerelease through the trusted
    publisher (REQ-308); the review of the milestone (REQ-312); the drift watch
    read again, and 1.0.0 (REQ-313).
  - The order: T6.4 and the rules of the tag first, then the sections of the
    README of a prerelease, then 1.0.0-0 when the lead maintainer asks for it;
    then the identities of REQ-288 and #145, the second cluster, the cases of
    REQ-290 and REQ-291 and the ceilings of REQ-317, with T6.2 beside them, and a
    prerelease when the lead maintainer asks for one; then the screenshots, the
    video and the notes of 1.0.0, the review of the milestone and 1.0.0.

  Not taken: 1.0.0-0 as soon as M5 is done, which proves the workflow before its
  changes, so that the proof of REQ-309 is made again on a later prerelease; and
  1.0.0-0 at the end of T6.1 to T6.3, which leaves the workflow and the page of the
  package unproven until the end of the milestone.
- **D16, what T6.1 takes and what it defers.** The row of T6.1 in the roadmap
  names the regression, the packaged integration, the end to end tests with the
  real controller, the isolation between clusters, the permissions, the transport
  security and the performance. Of the 32 gaps of the inventory, this spec takes
  G1.1 (REQ-286), the second part of G3.1 with G3.2 (REQ-291), G4.1 with G4.4
  (REQ-287, REQ-314), G5.1 with G5.2 (REQ-288), G6.1 (REQ-289) and G6.2 (REQ-290),
  and of the performance P7.2, a ceiling on the bytes of each bundle (REQ-317), a
  few lines of the build test. It defers the others, each with its reason in
  [what T6.1 defers](#what-t61-defers), and among them two areas of the row: the
  performance but that ceiling, G7.1 to G7.6, whose budgets of TESTING.md hold with
  the margins the evidence records; and the platforms, G2.1, one platform and one
  architecture in CI, with macOS checked by REL-02 and both said in the README
  (D13). The reason: each deferred gap keeps its release signal through a check
  that exists or a statement of the README, and each would bring a harness of its
  own into the milestone. Not taken: P2.1, FND-10 on hosted macOS and Windows
  runners at each tag, each with the released Freelens of its platform, a job and
  a download of Freelens for each platform; and the whole area of the performance,
  guards relative to a baseline, ceilings of memory and of the start, and larger
  datasets. With the approval, the row of T6.1 in the roadmap is narrowed to what
  this decision takes, and what it defers is recorded under Deferred after v1.0.0,
  as the roadmap asks of anything that moves out of v1.0.0.
- **D17, a Velero 1.19.0 released during M6.** The drift watch of 2026-11-09
  found Velero v1.19.0-rc.1 and its AWS plugin v1.15.0-rc.1, with v1.18.4 and
  v1.14.4 still the latest stable releases, so a 1.19.0 before 1.0.0 is plausible.
  If it comes, 1.0.0 still ships for 1.18.x: the reviewed release stays v1.18.4,
  the README says that 1.19 is untested (REQ-299), and a drift watch moves the
  reviewed release in a later version of the extension, with the review of the
  specs it reaches. Not taken: moving the reviewed release inside M6, which reopens
  the review of the specs, the goldens and the pins of the environment, and the
  proof of every prerelease made before it.
- **D18, what "M6 is done" means for 1.0.0.** REQ-216 of SPEC-0015 publishes
  1.0.0 on `latest` only after M6 is done, and T6.5 is that publication. This spec
  reads the condition as T6.1 to T6.4 Done and the review of the milestone passed
  (REQ-313): a reading of an approved requirement, which the approval of this spec
  records. Not taken: the words as they stand, under which 1.0.0 waits for itself.
- **D19, the marketplace of the organization after 1.0.0.** The organization
  lists extensions in freelensapp/freelens-marketplace, each with a manifest,
  `extensions/<name>/extension.yaml`, and an icon of 256 by 256 pixels, added by a
  pull request; Renovate moves the version after. Once 1.0.0 is on `latest`, a pull
  request there lists the extension with the version 1.0.0 and an icon made for
  it, checked like the screenshots, on the lead maintainer's go: a change of
  another repository, which closes T6.5 and gates nothing of 1.0.0. Not taken: a
  listing while the newest version is a prerelease; and no listing in M6.

### What T6.1 Defers

Each gap below stays out of 1.0.0 (D16), with its reason:

- G1.2, the goldens of the release tied to its pin: they change only with a move
  of Velero, whose pull request the upstream drift watch reviews before its merge;
  a case that ties them to the pin is after 1.0.0.
- G1.3, a record of the runs a machine reads: REG-01 lists the runs and their
  counts for each version.
- G1.4, a stored file of a released version: none was written yet; the file 1.0.0
  writes is the fixture of the first pull request after it.
- G2.1, one platform and one architecture: D13 says in the README what was
  tested, and D16 leaves P2.1 out.
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
- G7.1 to G7.6, the performance but the ceiling of REQ-317: the budgets of
  TESTING.md hold with the margins the evidence records; guards relative to a
  baseline, ceilings of memory and of the start, and larger datasets protect the
  versions after 1.0.0.

## Open Questions

Four questions of fact, each established by its slice; none needs an answer
before the approval.

- **Whether the registry names `latest` at the first publication under `next`
  (REQ-309, REQ-310).** The first publication of this package is 1.0.0-0 under
  `next`, and whether the registry names it under `latest` as well, for a package
  that has no version there yet, is not settled by what this draft read. HOST-21
  is restated for both outcomes ([the amendments](#the-amendments-the-slices-bring)),
  and an install from Freelens is the same either way; the first prerelease
  records which one happened.
- **Whether npm configures a trusted publisher before the first version (REQ-308,
  D11b).** This draft read that it does not. If it does, no token is created, and
  1.0.0-0 is the first publication through the trusted publisher; the owner of the
  scope establishes it before the first step of D11b.
- **Whether `pnpm publish <file>` of pnpm 12 hands the file to the registry
  unchanged (REQ-286).** If it does not, the job `publish` uses `npm publish <file>`
  of the npm the workflow installs, and the slice records which; the third step of
  ASSET-05 compares the bytes either way.
- **What the scan of the installation of the packed file lists (REQ-307).** The
  slice runs it once on the pull request of the change and records the list; if it
  lists more than the extension and react-window, the slice says why and the
  method is decided again before 1.0.0-0.

## Evidence And Deviations

The draft had no implementation, tests or runtime evidence. The facts
above were read at `b7dd522` of this repository, with the gaps of the inventory
read again in the code; the installer of the host at `b9b53e16`; issues #144 and
#145 read on 2026-11-09; the releases of Velero and of its AWS plugin, the
environment `publishing` and the secrets this repository can read, by name, on
2026-11-09; and the registry of npm, which answered 404 for the package on
2026-11-09. Nothing was run, and no cluster was contacted.

An independent review of the draft, on 2026-11-09, found no blocker, twelve
majors, fourteen minors and five nits; this text takes them in, with the release
workflow in two jobs, the rules of the tag, the credential of the first version as
a decision, the line between what gates 1.0.0-0 and what gates 1.0.0, and the
narrowing of T6.1 as a decision.

The evidence of the slices follows.

T6.5, the first of its pull requests, on 2026-11-09: the tag on the merge commit
of the pull request of the version (REQ-315), one of the rules of the tag that
gate 1.0.0-0 (D15). The evidence, by check:

- REL-05: the case "tags the merge commit of the pull request of the version, on
  its merge and on /tag from an owner, a member or a collaborator with write
  access", beside the case of the tags in `test/environment.test.ts`, reads
  `tag.yaml` without its comments and pins its text where it does not run it:
  - the condition of the job, read as the expression reads it whatever the style
    of its scalar: two ways and no other, each with exactly its terms. The merge
    of a pull request whose title starts with `Automated npm version`, from the
    branch `automated/npm-version` of this repository; and the comment `/tag` on
    a pull request, `github.event.issue.pull_request` set, of that title and
    closed, whose `author_association` is OWNER, MEMBER or COLLABORATOR, the list
    read as a set;
  - the steps in their order: the write access of the author of `/tag`, the
    merge commit, the checkout, the version, the check of its form and the tag.
    The checkout takes the output of the step of the merge commit, with
    `fetch-depth: 0` and `persist-credentials: false`; the version is read by the
    one line of `yq -r .version package.json`; the check of its form reads the
    version from its environment, and no step of bash has an expression in its
    text; the tag is only for a version of the release form;
  - the permissions of the token of the run, `contents: read` and
    `pull-requests: read` and no other, given once; one secret, `GH_TOKEN`, given
    to the step of the tag alone; and the environment `automated`.

  It then runs the three scripts of the job with their expressions replaced, as
  `actions/github-script` runs them, with stand-ins for the API, the context, the
  core library and the environment of the process, on both ways. The commit of
  the run and `GITHUB_SHA` name a third commit, and any request the stand-ins do
  not answer is answered with it. Each result is compared whole: the step that
  failed, the output of the step of the merge commit, and the requests in their
  order with their arguments.
  - On the merge: the merge commit of the event, and one request, the tag
    `refs/tags/v1.0.0-0` on that commit. With no merge commit, nothing.
  - On `/tag`, from an author whose permission is `admin` or `write`: the
    permission of that author, then the pull request, then the tag on its merge
    commit. From `read` or `none`, the permission alone, and the job stops there.
    For a pull request closed without a merge, merged into another branch, with
    no merge commit, from another branch or from another repository, the
    permission and the pull request, and the job stops there.
- Seen failing, on `tag.yaml` changed on purpose and put back each time: 65
  changes, and every assertion of the case at least once.
  - The insertions of the independent review of the pull request:
    `sha = context.sha;` and `sha = process.env.GITHUB_SHA;` before the output,
    the tip of main read through `getBranch` or `getCommit`, a second `sha` key
    in `createRef`, the head of the pull request taken on `/tag`, the version
    read from main before `yq`, and a term that turns the way of the merge off.
  - The changes of the first commit that still apply: the workflow of main as it
    was; `heads/main` put back as the commit of the tag, and read beside the merge
    commit; the checkout of main, of the ref of the event, and without
    `fetch-depth: 0`; the merge read from the commit of the run or from the head
    of the pull request; on the comment, the head of its pull request taken, a
    pull request closed without a merge or merged into another branch tagged, and
    the pull request not read through the API; the step of the merge commit on
    the merge alone, under another id, or giving the commit of the run; the way of
    the comment without its pull request, its title, its state or its body; each
    of the three associations dropped, CONTRIBUTOR added, and the associations
    dropped from the comment or moved to the merge; the way of the merge without
    `merged` or without its title; a third way; the tag with the token of the run,
    without its `v`, or for any form of a version; the environment removed; a
    second checkout, of main; and the checkout before the step of the merge
    commit, the version before the checkout, the tag before the version.
  - The changes of the review: the step of the write access removed, letting
    `read` through, reading the permission without checking it, run on the merge
    alone or on both ways, after the step of the merge commit, or asking the
    permission of the author of the pull request; the version given to bash in
    its text, or not through its environment; `id-token: write` or
    `contents: write` given back, and permissions of the job beside those of the
    workflow; the checkout keeping the token; the way of the merge without the
    branch of the version or the repository of its head, and the script of `/tag`
    without either; `GH_TOKEN` given to the step of the merge commit, and another
    secret for the tag; and the merge commit not checked as a commit.
- What the case does not run: the steps of bash and the checkout, whose text it
  pins; and the condition, whose terms it pins and whose expression actionlint
  parses under Trunk. GitHub's own evaluation of the condition is read by REL-01.
- The gates of the slice, on its head: the cases of the tags in
  `test/environment.test.ts`, `pnpm type:check`, `pnpm lint:check`,
  `pnpm knip:check`, and Trunk on the changed files, green. The unit run of the
  head, `pnpm test:unit`, on a second Linux machine: 134 files and 3,813 tests
  passed, and the three measures. The checks of its pull request, green before
  its merge: the unit tests, the check, Trunk, the integration test and
  OSV-Scanner. Its files reach no part of the views and no end to end run.
- The other amendments the table of the amendments lists for PROCESS.md,
  ARCHITECTURE.md and AGENTS.md, the release in two jobs, the six parts of the
  views and the way back, come with their own slices: this one restates the tag
  alone.
- The workflow at work is read by REL-01 at the merge of the pull request of
  1.0.0-0: the tag and its commit, equal to the merge commit of that pull request.

Decided while implementing, on 2026-11-09:

- One step finds the commit for both ways, and the checkout and the tag take its
  output: on the merge, the merge commit of the event, given to the step through
  its environment; on `/tag`, the pull request read with the token of the run.
  The token of the environment creates the tag alone, so that the tag starts the
  release workflow.
- On `/tag`, the pull request must have been merged into main from the branch
  `automated/npm-version` of this repository, as the way of the merge requires of
  its event: one closed without a merge, merged into another branch, or from
  another branch or repository fails the job with its words and tags nothing.
  The condition of the job keeps the closed state of the issue, so that a `/tag`
  on an open pull request starts no job.
- The step fails, and nothing is tagged, when the commit it found is not 40
  hexadecimal characters; the script of the tag names that output as it names the
  version, the output of a step that checked it.
- After the independent review of the pull request, the gate of `/tag` is the
  write access of the author of the comment: the first step asks the permission
  API for it and fails unless it is `admin` or `write`, which the API reports for
  maintain as well, as `claude.yaml` does. The list
  `contains(fromJSON('["OWNER","MEMBER","COLLABORATOR"]'), github.event.comment.author_association)`
  that REQ-315 names stays in the condition as a cheap pre-filter, as in
  `claude.yaml`: MEMBER is a member of the organization, and neither it nor
  COLLABORATOR implies write access. REQ-315 says that the workflow acts only
  when its author has one of the three associations, and this gate is narrower.
- An open point, which the first `/tag` from such an account settles: the
  pre-filter may skip, with no run, the `/tag` of a member of the organization
  whose membership is private, if the association of the event is read without
  that membership.
- After the review as well: the way of the merge requires the branch of the
  version of this repository; the token of the run has `contents: read` and
  `pull-requests: read`, and no OIDC token, and the checkout does not keep it;
  and the version reaches bash through the environment of its step.
- The condition of the job is a literal block of YAML, one term to a line, as
  `claude.yaml` writes a condition of several lines: the expression reads a new
  line as a space. A folded block was refolded by the formatter of Trunk at 300
  characters, in the middle of a term.

T6.1, the first half of REQ-286, on 2026-11-09: the steps that build Freelens at
the commit of the validation target, which the workflows of the integration tests
and of the views carried as two copies, are one composite action,
`.github/actions/build-freelens/action.yaml`, which both call with the commit each
names once; the job `package` of the release workflow calls it in the second half.
The evidence, by check:

- REG-02, the part of the target: the case of the target, "builds Freelens for the
  views and for the integration at the validation target of SPEC-0015, named
  once", reads the action as well. The two workflows are the only ones that call
  it, and the case holds every workflow that calls it, so that a new one is held
  by construction: each names the commit in one line, its one `freelens_ref`,
  gives it to the action once, and checks out, builds and caches nothing of
  Freelens itself; the job that calls the action runs on `ubuntu-24.04-arm`,
  turns the telemetry of Turborepo off with `DO_NOT_TRACK: "1"`, and sets up mise
  with `yq` before the call. The action names no commit and declares the one it
  is given required, with no default; its first step refuses anything but a full
  commit of 40 hexadecimal characters, an empty value among them, which a runner
  gives an input that is missing, and the case runs that step with bash on eight
  values; the value reaches the script through the environment, and no script of
  the action holds an expression. The action checks out freelensapp/freelens at
  that commit, restores the build under the key of that commit alone, with no
  partial match, and saves it under the key it restored, only after a build that
  did not fail; its caches are keyed for the runner of its callers and the build
  is for arm64 (`test/environment.test.ts`).
- The ids the action reads: every `steps.<id>` it names is the id of an earlier
  step of the action, each id is of one step, and every id is read
  (`test/environment.test.ts`). actionlint checks the steps of a job against the
  ids of the earlier ones, and not the steps of a composite action.
- The cases of the uploads of the two workflows read the steps of the action with
  the workflow: one upload, of `e2e-artifacts/`; the three caches saved, the
  binaries the build downloaded, the Electron it downloaded and the application,
  in that order; nothing of the state of the environment; the runner and the
  permission `contents: read` (`test/environment.test.ts`).
- The plan of the views runs every part for a change of the action, as for a
  change of the workflow of the views, and for each action of this repository
  that workflow uses (`test/views-plan.test.ts`).
- The two copies, compared before the move: the steps from "Checkout app" to "Let
  the sandbox of the application start", "Setup node for plugin" among them, were
  the same in both workflows but three lines of their comments, which named the
  tests or the suites and the other workflow that shares the key. The rest of the
  two jobs differs by what each runs, and in their common setup by one step: the
  integration builds the extension with two retries, the views with none, which
  this half leaves as it is. The move changed, beside the comments, the commit,
  from `env.freelens_ref` to the input `ref` in the checkout and in the key of the
  build; the path of the Turborepo cache, written from `github.workspace` instead
  of the variable `TURBOREPO_CACHE`, the same path; `shell: bash` on each `run`
  step, which a composite action requires; and the script of the sandbox,
  without its final newline, as the formatter of the repository writes the last
  block of a file. With the call of the action replaced by its steps, both jobs
  are the jobs of main, step by step, but for these and for the first step of the
  action, which checks the commit.
- The path of a miss, on its own before the pull request: on 2026-11-09, a
  throwaway branch of the first commit of this half, with one commit that changed
  only the prefix of the key of the build to
  `ubuntu-24.04-arm-electron-dist-probe-miss-`, and the integration workflow
  dispatched on it alone,
  [run 42627469903](https://github.com/freelensapp/freelens-velero-extension/actions/runs/42627469903),
  green in 6.5 minutes. The build of the target, the Electron download (key
  `ubuntu-24.04-arm-electron-44.10.0`), the Turborepo cache and the bundled
  binaries all missed, and Freelens was built from nothing, Turborepo 0 cached of
  6 tasks; the bundled binaries, the Electron download and the build were saved
  by the steps of the action, and the Turborepo cache by the post of its nested
  action; the Node.js of Freelens, 24.22.1, gave way again to the one of this
  repository, 24.21.0, the sandbox step set `FREELENS_APP`, and the integration
  test passed, 11 files. The branch and its four caches were removed after the
  run. The first step, which checks the commit, came after that run, and runs on
  every path.
- The runs of its pull request, green before its merge: the unit tests, the
  integration test and every part of the views, each with the check of the commit
  passed and the build of the target restored from the cache of main.

Each new case was seen failing on a change made on purpose, thirty-three in all.
The action checking out main, and a commit it names; the input of the commit
given a default; the build cached by the commit and the branch, by a version, and
restored by a partial match; the build saved under the key of the download of
Electron, and saved after a failed build as well; a cache of the action keyed for
another runner; the views giving the action main, and the integration another
commit; the integration checking Freelens out itself as well; another workflow
calling the action, and a third caller listed without the line of the commit; a
second `freelens_ref` in the env of the job of the views, and one in an env of the
call; the views without mise, the integration with mise and no `yq`, without
`DO_NOT_TRACK`, and on another runner; the action without its check of the commit,
the check with an expression in its script, taking any length, taking capitals,
and after the checkout; an expression in another script of the action; the slips
`install-pnpm-ap` in a retry and `electron-build-cach` in a condition, a step that
reads its own outcome, and an id no step reads; the action uploading the build,
and saving one more cache; and the action left out of the rules of the parts,
under the rule of `.github/`.

Decided while implementing, on 2026-11-09:

- The action takes the steps from the checkout of Freelens to the save of its
  build, and the two after them that both workflows had: the Node.js of this
  repository set up again, which the build replaces on a miss, and the sandbox of
  the application with its path in `FREELENS_APP`, which the tests read. It
  leaves the job on the Node.js of the repository, as it found it, with the
  application ready to start.
- The first step of the action refuses a value that is not a full commit: the
  runner gives an input that is missing an empty value and does not enforce
  `required`, and a branch, a tag or an empty value would build what moves under
  a key that does not. For the two callers it changes nothing.
- The OS dependencies of Playwright and their APT cache stay in the workflows:
  they are what the tests need to start an Electron under xvfb, they run the
  Playwright of the extension and are keyed by its lockfile, not by the commit of
  Freelens, and they run before the environment comes up, which a move into the
  action would put after it. The job `package` installs them beside the action.
- The variable `TURBOREPO_CACHE` leaves the environment of the two jobs: it only
  named the path of the Turborepo cache, as in the workflows of Freelens at the
  target, and no build reads it; the action writes that path from
  `github.workspace` and the folder of the checkout, the same string, so the
  cache is the same.
- Each `run` step of the action names `bash`, which a composite action requires:
  the steps that named no shell ran with `bash -e {0}`, and `bash` adds
  `--noprofile --norc -o pipefail`, which changes nothing in steps with no
  pipeline, and none of them has one.
- The action reads `yq` from the mise of the workflow that calls it, as the step
  of the version of Electron did, so that its version keeps one source; the case
  of the target holds every caller to it, with the runner and `DO_NOT_TRACK`.
- actionlint does not check the steps of a composite action, so a unit case
  checks the ids its conditions and keys read.
- The rules of the parts of the views name the action among the files that run
  every part, and keep it out of the rule of `.github/`, as they do for the
  workflow of the views: under that rule a change of the build of Freelens would
  run no part.

On a hit the action checks the commit, checks out Freelens, restores the build,
sets up the Node.js of the repository again and lets the sandbox start; every
other step is of a miss, which the run above proved.

T6.1, the case of FND-10 of REQ-289, on 2026-11-09: HTTPS in the main process of the
host, in two commits, the second after the independent review of the first. The
evidence, by check:

- REG-05, in FND-10
  ([`extensions.tests.ts`](../../integration/__tests__/extensions.tests.ts)), a case
  of its own after the download over HTTP, which makes seven cases of FND-10. The
  certificates are made by the case, outside the host, before the downloads, by the
  helper of the unit tests, [`tls-fixture.ts`](../../test/tls-fixture.ts): an
  authority made for the test, and the certificate it signed for two names and two
  addresses, `storage.example.invalid` and 127.0.0.1 among them. In the main process
  of the host, a store on 127.0.0.1 alone with that certificate, and three downloads
  of a log at its signed URL by the bundled transport of the module the host loaded,
  which the case of the main entry point proves. The authority given inline as a
  storage location gives it, its PEM in base64, read by the adapter of the bundle as
  the download of a log reads it: the file decoded whole. The same store with no
  authority given, and the authority given for `wrong.example.invalid`, a name the
  certificate is not for: each `tls-invalid`, with the verdict of a certificate
  refused, `untrusted`, and nothing of the URL, its host, its path, its signature or
  its scheme, in its message, its text, its fields, enumerable or not, its stack or
  its cause. The certificate is valid for 127.0.0.1, the address every download
  connects to, so the refusal of the other name shows the name of the URL checked,
  and not the address. The store counts three connections, records the name each
  ClientHello asks for, the name of the URL of each download in their order, and
  counts one request, the one of the store that was verified, with the Host and the
  server name of the URL: nothing was sent over a connection that was not verified,
  and nothing was asked again without the verification. The store is closed however
  the case ends, from the moment it listens. Each step has its own time, the
  certificates 45 seconds, removed when they end if they end later, the downloads 60
  and each of them 12, within the 150 of the case. The packaged run, in the
  integration test of `integration-tests.yaml` and in the part `static-views-1` of
  `views-tests.yaml`: on a second Linux machine, in Freelens 2.0.0 built at the
  target, FND-10 passed on the head, 7 cases of 7, and `pnpm test:unit` passed,
  134 files and 3,812 tests, and the three measures; on the hosted runner, the
  checks of its pull request, the integration test and the two parts of the
  views it reaches, green before its merge.
- The function the case evaluates in the host, taken from the test file as written
  and run in a process of Node 24.21.0 with a stand-in of the host, against the main
  bundle of the head: every assertion of the case held, after each of the two
  commits. It is a check of the slice outside Electron, and not the packaged run.
- The helper of the certificates, which FND-10 and the unit tests of the transport
  share, reads `openssl version` before it makes anything: with the LibreSSL of
  macOS first on the PATH, and with no `openssl` on it, it stopped with what it
  found and that an OpenSSL 3 is needed, and made nothing; with an OpenSSL 3 first,
  it made the certificates. The unit tests that use it, of the transport and of the
  adapter, pass with it.

Eight changes made on purpose, each one commit on the head on a branch of its own,
`mut-m6-https-1` to `mut-m6-https-8`, kept apart for the packaged runs, which the
case must see failing. The log of a packaged run shows the first assertion that
fails, so each change is named with the assertion the check outside Electron saw
fail first, in the order of the case:

- `mut-m6-https-1`, the authority of the location dropped from the connection: the
  trusted download, not decoded.
- `mut-m6-https-2`, the name of the certificate not verified: the refusal of the
  other name, which decodes.
- `mut-m6-https-3`, the verification of the certificate turned off: the refusal with
  no authority, which decodes.
- `mut-m6-https-4`, a download whose certificate was refused asked again without the
  verification: the refusal with no authority, which decodes, before the count of
  the connections, five, and of the requests, three, which the case does not reach.
- `mut-m6-https-5`, the inline authority of a location taken without its base64
  decoded: the authority, not read, `tls-invalid`.
- `mut-m6-https-6`, the signed URL kept on the failure of a certificate refused: the
  words of the refusal with no authority.
- `mut-m6-https-7`, a refused download probed again without the verification, with
  `tls.connect` and `rejectUnauthorized` false and no request, which still ends as
  `tls-invalid`: the connections, five.
- `mut-m6-https-8`, the verification moved after the request, the answer refused
  when the socket says it was not authorized, which still ends as `tls-invalid`: the
  requests the store saw, three.

The packaged runs, on the second Linux machine in Freelens 2.0.0: each of the eight
branches failed the new case alone, first at the assertion its line names, and the
six other cases of FND-10 passed. Two more changes, for the check outside Electron
alone and with no branch, were seen failing the two assertions the review asked for:
the error of the socket kept on the failure as a cause that is not enumerable, which
names the other name, fails the words of the refusal of the other name; and no
server name sent in the ClientHello fails the names the store recorded.

An independent review of the first commit, on 2026-11-09, found no blocker, no
major, one minor and eight nits. The minor: no change made on purpose was caught
first by the two assertions of no connection without verification, the count of the
connections and the request; the seventh and the eighth branches are. The nits,
which the second commit takes in: the certificate said with its two names and two
addresses, 127.0.0.1 among them; the name of each ClientHello recorded by the store
and asserted, where the case asserted three connections in all; the words read with
`util.inspect` as well, which reads the fields that are not enumerable, the stack
and the cause; the certificates said to be made by the case; the store closed from
the moment it listens; a fixture made after its time removed when it ends; a failure
of the authority with no code kept by its name and its message; and the helper of
the certificates stopping, before it makes anything, when the first `openssl` of the
PATH is not OpenSSL 3.

Decided while implementing, on 2026-11-09:

- The store is opened in the main process of the host, as the store of the case over
  HTTP is, on 127.0.0.1 alone, and closed by the case; the certificates are made in
  the process of the test, since the helper runs `openssl`, and given to the host as
  text.
- The authority is given as a storage location gives it inline,
  `spec.objectStorage.caCert`, its PEM in base64, and read by `certificate` of
  `DiagnosticKubernetes`, which the main bundle exports, as the download of a log
  reads it before it gives it to the transport: no export is added to the main
  bundle, and the build test is unchanged.
- A certificate for another name is the certificate of the same store, asked for by
  a URL whose host is a name the certificate is not for, with the authority given:
  one store and one authority for the three downloads, as the unit cases of the
  transport do it. The trusted download comes first, so that an authority kept from
  one download for the next would make the second one decode.
- The case reads the verdict beside the code: both refusals are a certificate
  refused, `untrusted`, which chooses the words of the views.
- No connection without verification is read as what the store can count: three TCP
  connections, the name each ClientHello asks for, so that nothing was asked again,
  and one request, so that nothing was sent over a connection that was not verified.
  Whether the store ends the handshake of a refused download is not asserted: under
  Node, the store ended none, and saw a failure of the client for each.
- The words of a refusal are its message, its text, its enumerable fields as JSON,
  and `util.inspect` with the hidden fields at a depth of four. The URL is looked
  for by its host, its path, its signature and its scheme followed by `//`, so that
  a module of Node named in a frame of the stack is not taken for a URL.
- FND-10 now runs `openssl`, the first on the PATH of the machine that runs it, as
  the unit tests of the transport do. The helper takes an OpenSSL whose major
  version is 3 or more, and stops on LibreSSL, on any other and on none, before it
  makes anything: on macOS `/usr/bin/openssl` is LibreSSL, which does not know
  `-copy_extensions`, so REL-02 runs with an OpenSSL 3 first on the PATH. TESTING.md
  says so.

T6.3, the first of its pull requests, with REQ-306 of T6.4, on 2026-11-09: what a
prerelease is installed and checked with, which D15 puts before 1.0.0-0 since npm
shows the README of the version it publishes. The README in the layout of the
other extensions of the organization, with Status, Requirements and its
Compatibility, Supported APIs, Install, its Verify a release, Getting started and
Safety; the notes of 1.0.0-0 in a new `CHANGELOG.md`; the drift watch before the
first prerelease; and six unit cases in
[`test/documents.test.ts`](../../test/documents.test.ts). Permissions (#145),
Features, Limits and Troubleshooting are not written, and nothing links to them.

Amended on 2026-11-09 at the request of the lead maintainer: the README follows the
layout of the other extensions of the organization, which replaces the order of the
sections the paragraph of the Documentation gave at the approval. The mapping:

- Overview, with what the version covers: the Overview, with the entries of the
  sidebar in bold and the write mode in one sentence, and under it Status, which
  holds the table of what 1.0.0 covers by milestone; the video and the
  screenshots come with REQ-301 and REQ-302.
- Installation: Install, with From the registry, From a release tarball and From a
  directory.
- Requirements: Requirements, with Compatibility (REQ-299) as its subsection.
- Supported APIs, new: the kinds the extension reads, by API version.
- Permissions: after Supported APIs, with #145.
- Verify a release: the last subsection of Install, where #144 asked for a section
  after Safety and before Development; ASSET-02 reads the subsection.
- Getting started, new: after Install. Safety: after Getting started.
- Troubleshooting, Features and Limits: with the slices that write them.
- Development, as it was; Build from the source, with the subsections of the other
  extensions: Prerequisites, Build extension, Development loop, Check the code,
  Integration tests, Testing the extension with unpublished Freelens; License.

The badges are the ones of the other extensions of the organization, as the lead
maintainer asked with the layout: the badges Home and GitHub draw an emoji their
address encodes, the files staying ASCII, and the badge DeepWiki names a service
outside the organization. The badge of the release leaves the prereleases out, and
the badge of npm shows what `latest` names: until 1.0.0 neither may show 1.0.0-0
(the first open question).

The evidence, by check:

- DOC-01, for a prerelease: each way Install gives was read in the source of
  Freelens at the validation target, `b9b53e16`, with `git show`, as the checklist
  of REL-03 reads the section. By name: the versions of the registry without a
  prerelease, the newest by its numbers, deprecated or not, the tag `latest` not
  read, and `No versions found for <name>` when there is none
  (`packages/core/src/renderer/components/extensions/attempt-install-by-info.injectable.tsx`,
  lines 140 to 156). By a version or a tag: the version itself, else the version
  the tag names, else the words that the extension has no such version or tag
  (lines 105 to 139), the download checked against the integrity of the registry
  (lines 197 to 210, and `attempt-install/attempt-install.injectable.tsx`, lines 73
  to 133); the field takes a name with an optional version or tag after an
  `http(s)` URL and a path that exists (`install-extension-from-input.injectable.tsx`,
  lines 26 to 75; `components/input/input_validators.ts`, line 194). The link
  `freelens://app/extensions/install/@freelensapp/velero-extension?version=next`:
  the name from the path and the version or the tag from `version`
  (`renderer/protocol-handler/bind-protocol-add-route-handlers/bind-protocol-add-route-handlers.tsx`,
  lines 129 to 136; `common/protocol-handler/router.ts`, line 78 and lines 157 to
  160), the whole address sent by the main process to the renderer
  (`main/protocol-handler/lens-protocol-router-main/lens-protocol-router-main.ts`,
  lines 117 to 130), and a confirmation of the version before the install
  (`attempt-install-by-info.injectable.tsx`, lines 171 to 186): a link with the
  name alone finds no version until 1.0.0. A path, typed or chosen with Browse:
  the tarball and the `.sha256` beside it, in the format `sha256sum` writes or as a
  bare digest, a `.sha256` that names another file counting as none
  (`attempt-install/install-from-file.injectable.tsx`, lines 40 to 75;
  `packages/core/src/features/extensions/installer/common/checksums.ts`, lines 95
  to 141; `install-from-select-file-dialog.injectable.ts`, lines 23 to 31;
  `attempt-installs.injectable.ts`, lines 27 to 35); FND-10 installs by the path in
  the field in every packaged run. A URL: the tarball and the `.sha256` at the same
  address with `.sha256` added, the name of the asset of a release
  (`attempt-install/install-from-url.injectable.tsx`, lines 41 to 86), downloaded
  by the `fetch` of undici in the main process, which follows a redirect
  (`main/fetch/proxy-fetch.injectable.ts`, lines 23 to 33;
  `main/fetch/download-binary.injectable.ts`, lines 44 to 71). Then a tarball that
  does not match is refused with the reason (`attempt-install.injectable.tsx`,
  lines 115 to 133), one with no checksum is installed with the notice that nothing
  vouches for its integrity (`attempt-install/unpack-extension.injectable.tsx`,
  lines 120 to 128), the extension is enabled once installed (lines 160 to 172),
  and the page lists it as verified, unverified or development
  (`installed-extensions.tsx`, lines 140 to 158). A directory is loaded in place
  after a confirmation, not verified, enabled, and listed as development, not as
  unverified as the template of the organization says
  (`attempt-install/install-from-directory.injectable.tsx`, lines 24 to 31, 135
  and 175 to 193); the host reloads a development install after a rebuild
  (`extensions/extension-discovery/extension-discovery.ts`, lines 72 to 93 and 253
  to 260). Each way is tried by hand, and recorded, at REL-02 and REL-04.
- DOC-02: the case finds in Requirements the range of `engines.freelens` of
  `package.json` and, as a set, the API versions of the classes of
  `src/renderer/api/kinds.ts` that have a `crd`, which the host reads; in Supported
  APIs a subsection for each of those versions and for no other, each with exactly
  the kinds of its version and the titles of their pages; and in Status no words
  "no release", nor the sentence of before anywhere. It reads the words with their
  white space as one space and the cells trimmed.
- DOC-04: the case finds in Safety a row for each write the adapter of the main
  process sends, read in `src/main/diagnostic-kubernetes.ts`, each POST a creation
  and the one PATCH a patch, with its kind, and for no other: the creations of a
  `DownloadRequest`, a `ServerStatusRequest`, a `Backup`, a `Schedule`, a `Restore`
  and a `DeleteBackupRequest`, and the patch of a `Schedule`, whose row names
  exactly the fields the patches of a pause and of a resume write
  (`src/common/schedule-patch.ts`), `spec.paused` and `spec.skipImmediately`; no
  other kind of Velero the code knows in the section; and the three rules by their
  words, the signed URLs never logged, stored or shown, TLS verified by default,
  and missing data shown as unknown, never as healthy. Safety also says that each
  write is refused unless writes are on for that cluster and namespace and its
  review is confirmed, that a restore and a deletion ask for the name of the
  backup typed, and that a backup is deleted only through a `DeleteBackupRequest`,
  one at a time.
- DOC-05: Compatibility is the table of REQ-299 with D13 and D17: Freelens 2.0.x,
  tested at 2.0.0 with the commit of the target; Velero 1.18.x with its AWS plugin
  1.14.x, tested at v1.18.4 and v1.14.4; Kubernetes tested at 1.34.11; Linux ARM64
  and macOS tested, any other platform, Windows among them, untested; the data
  movement and the phases of a failure other than FailedValidation proven on
  synthetic objects only; and a version outside the table, Velero 1.19 among them,
  untested, said neither to work nor to fail. The case reads the version and the
  commit of the target in the header of SPEC-0015 and the versions of the images
  of Velero, of its plugin and of the node in `e2e/scripts/local-manifests.mts`.
- ASSET-02: the case reads `release.yaml` without its comments: the checksums made
  by `sha256sum "$f" | tee "$f.sha256"` in a loop over files of the directory, by
  their names alone, which writes the digest, two spaces and the name, the line the
  two commands `-c` check in the directory of a download and whose first word the
  line of PowerShell compares. It reads the command lines of the blocks of
  Verify a release: `sha256sum -c` and `shasum -a 256 -c` each of exactly the
  `.sha256` of the tarball, the one line of PowerShell that compares the hash of
  the tarball with the first word of its `.sha256`, the install of the package by
  its name, and `npm audit signatures`. It finds a file named in Install for each
  pattern of the block `files` of the step of the release, and no file of the
  package the release does not attach; no name of a file of the package in the
  README but the one `pnpm pack` gives; and each library of `dependencies`, which
  the bill of materials lists beside the extension (REQ-307). `sha256sum -c` and
  `shasum -a 256 -c` were run on macOS on a synthetic file and its `.sha256`
  written as the workflow writes it: OK, then FAILED once the file changed. No
  PowerShell is on the machine of the slice: its line is run with the others on the
  assets of 1.0.0-0, at ASSET-05.
- DOC-09: `CHANGELOG.md`, with a preface and the section of 1.0.0-0 under
  `## v1.0.0-0 - 2026-11-10`, its notes under `### Added`, as the changelog of
  another extension of the organization writes them. The case finds each heading of
  a version of the form `## v<version> - <YYYY-MM-DD>`, the version of the form the
  tag workflow tags, read from `tag.yaml`, the date a real one, each version once,
  the newest first, each with notes beyond its headings; and the section of the
  version of `package.json` once it is of that form. Today the version is
  `0.1.0-alpha.0`, which the tag workflow does not tag, so the case asks for no
  section until the pull request of the version, where it asks for the section of
  `v1.0.0-0`; with the version set to `1.0.0-0` on purpose the case passed.
- DOC-10: the case resolves each relative link, image and definition of a link of
  the README and of `CHANGELOG.md`, out of their code, against the files Git holds
  for the repository, without the query of a link, and each anchor against the
  headings of its document by the slug GitHub makes; and finds in both no character
  outside ASCII, no em dash and no shortcode of an emoji in the prose. The external
  links are opened at REL-03.
- REL-01, its drift watch: the entry "Before The First Prerelease, 2026-11-09" of
  [RECON-T0.1](../development/RECON-T0.1.md#before-the-first-prerelease-2026-11-09):
  Velero v1.18.4 and the AWS plugin v1.14.4 still the latest stable releases, the
  release candidates v1.19.0-rc.1 and v1.15.0-rc.1 newer and not a baseline, with
  the breaking changes of the first that touch the kinds the extension reads, and
  the reviewed pair kept (D17); no release of Freelens after v2.0.0, and the target
  kept.

Each case was seen failing on changes made on purpose, one at a time, each failing
its case alone, and put back: DOC-02 on the range of Freelens changed in
Requirements, the version of the data movement changed in the code, a kind left
out of Supported APIs, the Status of before the first prerelease put back and its
sentence written elsewhere; DOC-04 on a row of a creation removed, a row of a
write the adapter does not make, another kind of Velero said to be written, the
patch said of one field, a write of the adapter changed from a POST to a PATCH,
and each of the three rules reworded; DOC-05 on the pin of Velero, of its plugin
and of the node moved, the commit and the version of the target moved in
SPEC-0015, and the sentence of what is untested removed; ASSET-02 on a wrong file
in the command of Linux, the line of PowerShell without its comparison or with the
second word, a name without the prefix in the prose, the command of macOS without
`-c`, the checksums written with a directory in the name of the file, a fifth file
attached by the release, the bill of materials named otherwise, and
`npm audit signatures` and react-window taken out; DOC-09 on the version of
`package.json` set to `1.0.0-1`, a heading without the `v` of the tag, an older
version above a newer one, a date that is not one, a section with no notes and
one with a heading alone; DOC-10 on a link to a file the repository does not hold,
an anchor no heading of the README has, an anchor no heading of TESTING.md has, a
link of the changelog to a missing file, a character outside ASCII, an em dash and
a shortcode of an emoji. Beside them, what the cases must let pass passed: the
range of Freelens wrapped to the next line, a constant beside the classes of the
kinds, the words "no release" in another section, cells aligned with spaces, a
link with a query, and the version of `package.json` set to `1.0.0-0`.

Decided while implementing, on 2026-11-09:

- The heading of a version is `## v<version> - <date>`, the tag of the version, and
  its notes are the lines after it up to the next line that starts with `##` and a
  space, which the preface of the file says. The step of the notes of the job
  `package` (REQ-303) can cut them with
  `awk -v tag="$GITHUB_REF_NAME" 'index($0, "## " tag " - ") == 1 { found = 1; next } found && /^## / { exit } found { print }' CHANGELOG.md`,
  and fail when they are empty.
- The section of 1.0.0-0 is dated 2026-11-10; the coordinator moves the date to the
  day of the pull request of the version when it differs.
- `CHANGELOG.md` is not in `files` of `package.json`: npm adds the manifest, the
  README and the license alone, and the notes of a version travel as the body of
  its GitHub release. The list of the contents of REQ-316 comes later.
- Status says the line of versions the README is published with, the prereleases
  of 1.0.0 on `next` and 1.0.0 not released, with no number the version workflow
  would have to change, which is how it says "the version the README is published
  with" of REQ-296.
- This pull request is merged after the one of the release workflow, which makes
  true what Verify a release and the preface of the changelog say of the bill of
  materials, the provenance and the notes, and right before the pull request of
  the version of 1.0.0-0, as the release flow orders them. Between that merge and
  the publication of 1.0.0-0, the page of the repository says that the prereleases
  are on `next` while the registry has none: a window of the length of that pull
  request, accepted.
- The sentence of the permissions of REQ-296 waits for the section Permissions,
  with #145.
- DOC-02 reads the API versions in Requirements and in Supported APIs, and the
  kinds in Supported APIs.
- The table of what 1.0.0 covers names Create schedule in M5, which it left out.

A deviation, for the coordinator: REQ-295 says the tarball of a release is
"dragged into the window or given by its path", and the template of the
organization says a dropped tarball is checked as a path is. The source of the
target does not support the drop: the page hands each dropped file to the
installer by its `path` (`install-on-drop.injectable.ts`, line 28, with the files
of the event, `components/input/drop-file-input.tsx`, line 70), a property of the
`File` of Electron that Electron 32 removed for `webUtils.getPathForFile`, which the
typings of the Electron 44.10.0 of the target say superseded it; the source calls
`webUtils` nowhere, and declares the property itself since its move to Electron 39
(`a09f0d866d52`). Install gives the path and Browse, and not the drop. A drop of
the tarball of 1.0.0-0 is tried by hand at REL-02, and recorded there: if it
installs, the words come back to Install; if it does not, it is a defect of the
host, to report to Freelens.

The independent review of this pull request, read only, found no blocker, one
major, seven minors and ten nits, all applied: Safety lists every write the adapter
allows, with DOC-04; Compatibility is written, with DOC-05; the order of the merge
and its window are decided above; ASSET-02 reads the commands themselves; DOC-02
takes the harmless edits; the drift watch says what Node and the release
candidate are; and the nits, among them `### Added`, the words of a restore, one
list of the gates, the package of the validation target, the version put back
after `pnpm pack:dev`, and no placeholder of a run after 1.0.0-0.

The full unit run, `pnpm test:unit`, on a second Linux machine: 135 files and
3,818 tests passed, and the three measures. The checks of its pull request, the
unit tests, the check, Trunk and the integration test, green before its merge;
its files reach no part of the views and no end to end run.
