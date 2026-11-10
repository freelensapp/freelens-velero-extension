# SPEC-0018: Release Readiness

- **Status:** Approved
- **Date:** 2026-11-09
- **Milestone / tasks:** M6 / T6.1, T6.2, T6.3, T6.4, T6.5
- **Reviewed Velero:** v1.18.4, `4ee1e79a7aed367fd9b767b8219ec65bd0c96892`, with the AWS plugin v1.14.4, the reviewed pair of [RECON-T0.1](../development/RECON-T0.1.md): this spec reads no behavior of Velero beyond what the specs it depends on record. The [upstream drift watch](../development/PROCESS.md#upstream-drift-watch) was read on 2026-11-09: Velero v1.19.0-rc.1, published on 2026-11-06, and the AWS plugin v1.15.0-rc.1, published on 2026-11-07, are release candidates, and v1.18.4 and v1.14.4 are still the latest stable releases, so the reviewed pair does not move (D17)
- **Reviewed main:** not relevant: the subject of this spec is the release of the extension, its checks and its documents
- **Freelens validation target:** Freelens v2, the validation target of [SPEC-0015](SPEC-0015-freelens-v2-host.md), freelensapp/freelens `b9b53e16056578c5407312eba5823a089972f6d5`, the commit of the tag v2.0.0 of the release Freelens 2.0.0
- **Dependencies:** every spec of v1.0.0, SPEC-0001 to SPEC-0017; [D10 of SPEC-0015](SPEC-0015-freelens-v2-host.md#d10-the-version-and-the-release), the version line, with no prerelease before 1.0.0 since [the amendment](#2026-11-09-no-prerelease-before-100) of 2026-11-09; the fifth milestone, done and reviewed: its review gate passed with the lead maintainer on 2026-11-09
- **Approval:** Approved by the lead maintainer on 2026-11-09, with D1 to D19 as proposed; D11b is carried out with an owner of the npm scope `@freelensapp` when the first prerelease is asked for. Amended the same day, decided by the lead maintainer on 2026-11-09: the version, tag and release workflows are the template's of the organization; what the requirements below asked beyond it is not taken; and the README follows the template too, with no `CHANGELOG.md` and no Verify a release ([the amendment](#2026-11-09-the-release-flow-of-the-template)). Amended the same day as well, decided by the lead maintainer on 2026-11-09: the checks that go beyond the other extensions and were not made are not taken; the ones made, the HTTPS and the direct route of FND-10, the ceilings of the bundles and the identities of the roles, stay ([the amendment](#2026-11-09-the-checks-beyond-the-other-extensions)). Amended the same day once more, decided by the lead maintainer on 2026-11-09: there is no prerelease, and 1.0.0 is the first publication; what a prerelease was for, the proof of the assets, the check by version and the drift watch before it, is made for 1.0.0, and D11b is carried out when 1.0.0 is asked for ([the amendment](#2026-11-09-no-prerelease-before-100)). Amended the same day a fourth time, decided by the lead maintainer on 2026-11-09 and recorded on 2026-11-10: the environment `publishing` stays the template's, with no required reviewer, and the second step of D11b is not taken ([the amendment](#2026-11-09-the-environment-of-the-template)). Amended the same day a fifth time, decided by the lead maintainer on 2026-11-09 and recorded on 2026-11-10: the README has the sections of the other extensions, with no Troubleshooting ([the amendment](#2026-11-09-the-sections-of-the-other-extensions)). D8 is not taken, decided by the lead maintainer on 2026-11-09: the pre-review stays the visual one of the other extensions; the scan is not kept

Governed by [AGENTS.md](../../AGENTS.md). A completed draft is not approval to
implement.

## Goal

Make the extension ready to be released as 1.0.0 for Freelens 2.0.0: the checks
of every agreed feature kept as the regression of the release, the gaps that
matter for a release closed, the views passed for their looks and their
accessibility, a README that is the page of a public package, assets that can be
verified, and the release itself, 1.0.0 on `latest` as the first publication,
with no prerelease before it (amended on 2026-11-09, see
[the amendment](#2026-11-09-no-prerelease-before-100)), on the lead maintainer's
go.

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
spec takes (D16); the visual pass, and an accessibility scan, which is not taken
(D8); the README of 1.0.0, its screenshots, a video and the release notes; the
assets of the release, the workflow that makes them and their proof; the review
of the milestone, 1.0.0 as the first publication, with no prerelease 1.0.0-0
before it (amended on 2026-11-09, see [the amendment](#2026-11-09-no-prerelease-before-100)),
its check by version, and its listing in the marketplace of the organization
(D19).

Excluded, with their owners:

- Any new feature or view. Editing a Schedule and the panels of backup coverage
  stay after v1.0.0 ([roadmap](../development/ROADMAP.md#deferred-after-v100)).
- The gaps of the inventory this spec does not take, each with its reason in
  [what T6.1 defers](#what-t61-defers) (D16).
- Freelens 1, which v1.0.0 does not support (SPEC-0015).
- Any publication by this spec or by a slice of it: a version is published only
  by the release workflow, on the lead maintainer's go (T6.5).

## User Scenarios

1. **P1, a prerelease by its version,** amended on 2026-11-09
   ([the amendment](#2026-11-09-no-prerelease-before-100)) to the first release by
   its version: Given 1.0.0 on the npm tag `latest`, when an operator types
   `@freelensapp/velero-extension@1.0.0` on the Extensions page of Freelens 2.0.0,
   then the extension is installed and Enabled, and the views of a cluster with
   Velero load.
2. **P1, by name before 1.0.0,** amended on 2026-11-09
   ([the amendment](#2026-11-09-no-prerelease-before-100)): there is no prerelease
   on the registry; until 1.0.0 is published the registry has no version of the
   package, and the README says to install the extension from the source. Given
   1.0.0 on the registry, when the operator types the name alone, then Freelens
   installs 1.0.0.
3. **P1, a download verified,** amended on 2026-11-09
   ([the amendment](#2026-11-09-the-release-flow-of-the-template)): Given the
   assets of a GitHub release, when the operator gives Freelens the URL of the
   tarball, or its path with its `.sha256` beside it, as the README says, then
   Freelens checks the tarball against the `.sha256` and installs it when they
   match.
4. **P1, a role of the README:** Given an identity bound to the read-only role of
   the README, when the operator opens the views and asks an action, then the
   lists load and the action ends as forbidden with the words of what the identity
   may not do; bound to the role of the actions, the same action is confirmed and
   Velero acts on it.
5. **P1, the words of a failure:** Given an identity that may not forward a port,
   when the operator loads a log, then the tab says the words of the failure, and
   the section Permissions of the README names the verb to grant, as amended on
   2026-11-09 ([the amendment](#2026-11-09-the-sections-of-the-other-extensions)):
   the README has no Troubleshooting.
6. **P2, two clusters,** not taken on 2026-11-09
   ([the amendment](#2026-11-09-the-checks-beyond-the-other-extensions)): there is
   no second cluster in the environment, and the gate between frames stays proven
   by the second entry of SPEC-0009, the same cluster through another kubeconfig.
7. **P2, a build that does not load,** not taken on 2026-11-09
   ([the amendment](#2026-11-09-the-release-flow-of-the-template)): the release
   workflow has no job `package`, and FND-10 runs on the tarball the integration
   workflow packs, on every pull request and every push to main, not at a tag.
8. **P2, a control with no name:** Given a view whose button loses its accessible
   name, when the pre-review runs, then the scan fails the case with the rule and
   the element. Not taken with the scan (D8).

## Requirements

### Regression And Safety (T6.1)

| ID | Contract | Acceptance check |
| --- | --- | --- |
| REQ-285 | Amended on 2026-11-09, see [the amendment](#2026-11-09-the-environment-of-the-template): the gate of the publication is the merge of the pull request of the version, and the runs of the merge commit are read after the publication. The regression of 1.0.0 is every check of SPEC-0001 to SPEC-0017 and of this spec, each in its layer, run where [the table](#where-each-check-runs) says: on every pull request, on every push to main, every night on main and at a tag. No check of those specs is removed, skipped or loosened for the release. Before the pull request of a version is merged, the last runs on main of every workflow of the table that runs there, of a push and of the night, and the checks of that pull request are green; a run that passed only when run again is recorded with its first failure. The tag names the merge commit (REQ-315), whose runs start with the merge and end after the publication, which the tag starts with no approval to wait for: they are read and recorded with their counts once they end. A red run found after a publication is handled as [the way back](#the-way-back) says | REG-01 |
| REQ-286 | Amended on 2026-11-09, see [the amendment](#2026-11-09-the-release-flow-of-the-template): taken in its first half alone. The steps that build Freelens at the commit of the validation target are one composite action, `.github/actions/build-freelens`, which the workflows of the integration test and of the views call, each with the commit it names once. The rest is not taken: the release workflow is the template's, one job that checks the tag, builds, packs and publishes, with no job `package`, no FND-10 on the file it publishes and no run on a pull request or by hand, so G1.1, no check installs the file the release publishes, stays open | REG-02 |
| REQ-287 | Not taken on 2026-11-09, see [the amendment](#2026-11-09-the-checks-beyond-the-other-extensions): a second disposable kind cluster in the environment of the suites, for the isolation between clusters (G4.1) | REG-03 |
| REQ-314 | Not taken on 2026-11-09, see [the amendment](#2026-11-09-the-checks-beyond-the-other-extensions): two clusters at once in one packaged Freelens, their lists told apart by UID and their installations selected and kept apart (G4.1, G4.4). The gate of each frame and the count of the writes between frames stay proven by the suite of the second entry of SPEC-0009 (D4) | REG-08 |
| REQ-288 | The roles of the README, proven both ways (G5.1: no identity holds the verbs of the write actions; G5.2: nothing proves that the reading role is enough). Two identities of the test environment hold exactly the two example roles of the README (REQ-297): the operator, for the views, the tabs, the version of the server and every action, and the reader, for the views alone. They replace the administrator of the kind cluster for the session of the extension alone: the proofs take one kubeconfig today for the session and for what they place and remove (the real schedule, the namespace of a restore), which the operator may not do, so their context holds both. With the kubeconfig of the operator, the end to end proofs of the actions, Back up now, Create backup, Create schedule, Restore, Pause and Resume and Delete backup, the proof of the download through the cluster and a request of the version of the server end as they end with the administrator. With the kubeconfig of the reader, the restricted suite of the views passes; a creation of a Backup and the patch of a Schedule, the two ways the adapter writes, each end as forbidden at the step whose verb the reader lacks, with the words of what the identity may not do, and nothing is written, which the API server counts | REG-04 |
| REQ-289 | HTTPS in the main process of the host (G6.1: the bundled transport is not run over TLS in Electron). A case of FND-10 downloads an artifact over HTTPS inside the main process of the host, with the bundled transport, from a server on loopback whose certificate an authority made for the test signed, the authority given inline as a storage location gives it: the content is decoded. The same server with no authority given, and a certificate for another name, end as `tls-invalid`, with no URL in the words, and no connection is made without verification. The certificates are made outside the host by the helper the unit tests use, and no dependency is added | REG-05 |
| REQ-290 | The direct route in the main process of the host (G6.2: the resolution of a route is not run in Electron). A case of FND-10 resolves, inside the main process of the host, with `resolveRoute`, which the main bundle exports and the build test lists among its exports, the route of a storage location whose URL names an address literal of a private range on which nothing listens, from the ranges the extension counts as private (RFC 1918, or 198.18.0.0/15): without the allowance of private addresses for the cluster, the route is refused with the words of what may be allowed; with it, the route is direct to that address. No listener is opened beyond loopback, and nothing is connected to | REG-06 |
| REQ-291 | Not taken on 2026-11-09, see [the amendment](#2026-11-09-the-checks-beyond-the-other-extensions): Back up now and Delete backup asked in the packaged application against the real controller (G3.2, and the second part of G3.1). Each action keeps its proof in `pnpm e2e` against the server of the release, through the compiled main process, and its cases in the suite of the actions on the CRDs of the release alone | REG-07 |
| REQ-317 | A ceiling on the size of what ships (P7.2 of the inventory, for G7.2: nothing bounds the size of the bundles). The build test holds each of `dist/main.js`, `dist/renderer.js` and `dist/renderer.css` under a ceiling of bytes, set by its slice a quarter above the size of each at that commit, and a change that passes a ceiling fails until the ceiling is moved, with its reason, in the pull request that needs it | REG-09 |

### Visual And Accessibility Pass (T6.2)

| ID | Contract | Acceptance check |
| --- | --- | --- |
| REQ-292 | Amended on 2026-11-09, see [the amendment](#2026-11-09-no-prerelease-before-100): the release candidate is a commit of main. The visual pass of 1.0.0 is the pre-review of the release candidate: every view of the extension, the workspace of each action among them, in both themes, at 1440 by 900, at 900 by 650 and at twice the zoom, with the journeys by the keyboard alone and its checks of what lies over something else or does not fit, run green on the commit of main the review of the milestone reads, with its report and its gallery. The lead maintainer judges the gallery at the review of the milestone (REQ-312); each finding is an issue, and the blocking ones are fixed before 1.0.0 | VIS-01 |
| REQ-293 | Not taken, decided by the lead maintainer on 2026-11-09: the pre-review stays the visual one of the other extensions; the scan is not kept (D8). As approved: the pre-review scans every view it checks with axe-core and the rules of WCAG 2.1 at the levels A and AA (D8), in both themes, at 1440 by 900 and at 900 by 650, inside the root of the view of the extension: the sidebar, the top bar, the status bar, and the menus, dialogs and drawers of the host are left out, and a section of the extension in the details of the host is scanned alone. The report of the pre-review lists every violation with its rule, its impact, its element and where it comes from. A violation of impact serious or critical on an element the extension renders fails its case, unless the list of the exceptions, a file of the repository the suite reads, names its rule, its element and the choice of a spec that keeps it. What comes from a component of the host is reported and does not fail | VIS-02 |
| REQ-294 | Not taken, decided by the lead maintainer on 2026-11-09: the pre-review stays the visual one of the other extensions; the scan is not kept (D8). As approved: axe-core is a devDependency at an exact version, loaded only by the pre-review into the frame it scans. No bundle carries it, and DEPENDENCY-AUDIT.md lists it among what only tests | VIS-03 |

### Documentation (T6.3)

The README of 1.0.0 is the page of the package on npm and on GitHub, in the
layout of the other extensions of the organization (amended on 2026-11-09 at the
request of the lead maintainer, and again the same day, see
[the amendment](#2026-11-09-the-sections-of-the-other-extensions)). Its sections
come in this order: the title and the badges; Overview, with the entries of the
extension in the sidebar, the write mode, the video and the screenshots, and
under it Status, the state of the release the README is published with, and what
the version covers by milestone; Requirements, with Compatibility as its
subsection; Supported APIs, the kinds the extension reads by their API version;
Permissions; Install, from the registry, from a release tarball and from a
directory; Getting started; Features, with Write actions as its last subsection;
Limits; then Development, Build from the source, with the subsections of the
other extensions, and License. Installation, in the requirements below, is the
section Install, and Safety is the subsection Write actions of Features. A unit
case reads what can go stale without anyone seeing it, the range of Freelens, the
roles, the writes, the versions and the links; the other sections are read by the
checklist of the review of the milestone (REQ-312).

| ID | Contract | Acceptance check |
| --- | --- | --- |
| REQ-295 | Amended on 2026-11-09, see [the amendment](#2026-11-09-no-prerelease-before-100): with no tag `next`. Installation says how to install the extension from the Extensions page of Freelens: by name, `@freelensapp/velero-extension`, which Freelens resolves to the newest version that is not a prerelease, and which finds no version until 1.0.0, the first publication, is published; by a version; and from the tarball of a GitHub release, checked as Verify a release says, dragged into the window or given by its path. It names the package as `package.json` names it, and no npm tag: 1.0.0 is published on `latest`, with no prerelease on `next` before it | DOC-01 |
| REQ-296 | Amended on 2026-11-09, see [the amendment](#2026-11-09-no-prerelease-before-100): the end of Status. Requirements says what the extension needs and nothing more: Freelens 2.0.0 or a later 2.x, as `engines.freelens` declares, with Freelens 1 listing the package as Incompatible; a cluster with Velero, read through `velero.io/v1` and, for the data movement, `velero.io/v2alpha1`; an identity with the permissions of the section Permissions; nothing installed in the cluster beyond Velero, and no credential of the object store; Node.js only to build from source. The section Status says that 1.0.0, the first release, is being prepared, and that until it is published the extension is installed from the source; right before the pull request of the version of 1.0.0, it gives way to the version the README is published with | DOC-02 |
| REQ-297 | Permissions has a table, one row for each feature, the views, the tabs, a download through the cluster, the version of the server and each action, with the group, the resource, the verbs and the scope of each, every verb backed by a request the code makes, as #145 asks; and two example roles in YAML, one that reads the views and one for the views, the tabs, the version of the server and every action, a Role in the namespace of the installation for what is namespaced and a ClusterRole only for what is read in the whole cluster, with the verbs that are optional and what is lost without them. The two roles are the roles of the two identities of REQ-288, written in the form the case of DOC-03 renders them | DOC-03 |
| REQ-298 | Amended on 2026-11-09, see [the amendment](#2026-11-09-the-sections-of-the-other-extensions): in Features. The subsection Write actions of Features says what the extension writes to a cluster, every kind and verb the adapter of the main process allows and nothing else: the creation of a DownloadRequest and of a ServerStatusRequest, which loading a tab and reading the version of the server are; the creation of a Backup, a Schedule, a Restore and a DeleteBackupRequest; the patch of `spec.paused` and `spec.skipImmediately` of a Schedule; that each is refused unless writes are on for that cluster and namespace and its review is confirmed; that a restore and a deletion ask for the name of the backup typed; that a backup is deleted only through a DeleteBackupRequest, one at a time; and the three rules it keeps today, signed URLs never logged, stored or shown, TLS verified by default, and missing data shown as unknown | DOC-04 |
| REQ-299 | Compatibility is a table: Freelens 2.0.x, tested at 2.0.0, the commit of the validation target; Velero 1.18.x with its AWS plugin 1.14.x, tested at v1.18.4 and v1.14.4; Kubernetes, tested at 1.34.11, the node of the test clusters; the platforms the checks ran on (D13); and what was proven on synthetic objects only, the data movement and the phases of a failure other than FailedValidation. A version outside the table, Velero 1.19 among them (D17), is said to be untested, never to work or to fail | DOC-05 |
| REQ-300 | Not taken on 2026-11-09, see [the amendment](#2026-11-09-the-sections-of-the-other-extensions): the README has the sections of the other extensions and no Troubleshooting, and what one of its entries would say that an operator needs and no other section says is in Features or in Limits. As approved: Troubleshooting has an entry for each failure an operator meets first: a list or an action refused to the identity, a port-forward refused, a certificate the transport refuses, a cluster that is not connected, and a store that does not answer. Each entry quotes the words the extension shows, which SPEC-0002, SPEC-0010, SPEC-0015 and SPEC-0017 record and the modules of the words write, says what causes them and what to do, and leads to Permissions or Safety where they answer | DOC-06 |
| REQ-301 | The README shows the views in screenshots the pre-review of the release candidate took on the disposable kind cluster of the demo, with its synthetic objects alone: the Overview, the list of the Backups, the workspace of a backup with its log, the adherence of the schedules and the review of a restore, in the dark theme, and the Overview in the light theme as well. They are files under `docs/screenshots/`, outside the package, each with a text that says what it shows, and none shows anything of a real environment | DOC-07 |
| REQ-302 | A video of less than 60 seconds, recorded from the packaged Freelens on the disposable kind cluster of the demo with its synthetic data alone, shows the Overview, a backup with its log, the adherence of a schedule and an action with its review; the README links to it, and it is not in the package (D9). No frame shows a name, an address, a credential or anything of a real environment | DOC-08 |
| REQ-303 | Amended on 2026-11-09, see [the amendment](#2026-11-09-the-release-flow-of-the-template): not taken as written. The notes of each version are written in the body of its GitHub release, as the other extensions of the organization write them, with no `CHANGELOG.md` and no case of them (D12) | DOC-09 |
| REQ-304 | Every relative link and image of the README and of `CHANGELOG.md` names a file of the repository, and every anchor a heading of its document; every external link answers when the lead maintainer reviews them. Both are in English, ASCII, with no em dash, no emoji, no person named and no comparison with other software, as AGENTS.md asks of what is published | DOC-10 |

### Release Assets (T6.4)

| ID | Contract | Acceptance check |
| --- | --- | --- |
| REQ-305 | Not taken on 2026-11-09, see [the amendment](#2026-11-09-the-release-flow-of-the-template): the unit case of #144 that pinned the assets of the release in `release.yaml`; the file is the template's, byte for byte | ASSET-01 |
| REQ-306 | Not taken on 2026-11-09, see [the amendment](#2026-11-09-the-release-flow-of-the-template): the README installs a release tarball as the one of the template does, by the URL of its asset or by its path, and Freelens checks the tarball against the `.sha256` beside it itself; there is no Verify a release | ASSET-02 |
| REQ-307 | Amended on 2026-11-09, see [the amendment](#2026-11-09-the-release-flow-of-the-template): the bill of materials is the template's, of the repository at the tag: an SPDX JSON document that `anchore/sbom-action` makes of the folder of the repository after the publication, named after the tarball and attached to the GitHub release with its `.sha256`. The bill of materials of the packed file is not taken (D10) | ASSET-03 |
| REQ-308 | Amended on 2026-11-09, see [the amendment](#2026-11-09-the-release-flow-of-the-template): the provenance is the template's. The release workflow asks for it only through the trusted publisher, when no secret `NPM_TOKEN` reaches its job, and publishes with the token without it (D11a): 1.0.0, published with the granular token of D11b, carries none. Once it is published, the token is revoked on npm and deleted from the environment, and the trusted publisher is configured, so that every version after it is published through the trusted publisher with a provenance statement that names the release workflow, the tag and its commit | ASSET-04 |
| REQ-309 | Amended on 2026-11-09, see [the amendment](#2026-11-09-the-release-flow-of-the-template), and again the same day, see [the amendment](#2026-11-09-no-prerelease-before-100): the proof is made on 1.0.0, the first publication. Its GitHub release is not a prerelease, with the four assets; the `.sha256` of the tarball and of the bill of materials pass; the tarball of the registry is the asset, byte for byte; `npm audit signatures` verifies the signature of the registry, and the attestation where REQ-308 gives one, which names `release.yaml`, the tag and its commit; the bill of materials is the one of the repository at the tag (REQ-307); `latest` names 1.0.0, and `next` names nothing, recorded (HOST-21 as restated) | ASSET-05 |
| REQ-316 | Not taken on 2026-11-09, see [the amendment](#2026-11-09-the-release-flow-of-the-template): the list of the contents of the tarball in the release workflow, and the license notice of each library the bundles carry, in the package | ASSET-06 |

### Release (T6.5)

| ID | Contract | Acceptance check |
| --- | --- | --- |
| REQ-310 | Amended on 2026-11-09, see [the amendment](#2026-11-09-no-prerelease-before-100): there is no prerelease, and the first publication is 1.0.0, made on the lead maintainer's go as REQ-313 says, once what gates it in D15 is Done. What this requirement asked of the first publication is asked of 1.0.0: the drift watch read and recorded in RECON-T0.1 before the first release, and read again before 1.0.0 (REQ-313); the notes of 1.0.0 in the body of its GitHub release (REQ-303); the version workflow with the version `1.0.0`, its pull request merged after its checks and the runs of main green (REQ-285); the tag workflow at that merge (REQ-315); the one job of the release workflow, at the tag with no approval to wait for ([the environment of the template](#2026-11-09-the-environment-of-the-template)), which publishes on `latest` and creates a GitHub release that is not a prerelease (HOST-21 of SPEC-0015 as restated). Not taken: 1.0.0-0 on `next`, and a change of the code released as 1.0.0-N; a change after 1.0.0 is released as a later version the same way. Nothing is published from a workstation; what an owner of the scope does by hand is [the way back](#the-way-back) alone | REL-01 |
| REQ-315 | Amended on 2026-11-09, see [the amendment](#2026-11-09-the-release-flow-of-the-template): the tag workflow is the template's. At the merge of a pull request whose title starts with `Automated npm version`, or on the comment `/tag` on a closed issue or pull request of that title, it checks out main, reads the version of its `package.json`, and tags main as it is when the job runs, `v` and that version, when the version is `X.Y.Z` or `X.Y.Z-` followed by letters, digits, dots and hyphens. The tag on the merge commit and the check of the author of `/tag` are not taken | REL-05 |
| REQ-311 | Amended on 2026-11-09, see [the amendment](#2026-11-09-no-prerelease-before-100): on 1.0.0, with no prerelease before it. 1.0.0, once published, is checked by its version in the release Freelens 2.0.0 on macOS. The `.dmg` of Freelens 2.0.0 for the architecture of the machine is checked against the `.sha256` its release publishes, and its application copied to a folder outside `/Applications`, which the runner of the integration test refuses. Given the name and the version in place of a tarball (D14), the runner runs FND-10, which installs the version from npm through the Extensions page in a new profile, the host checking the download against the integrity the registry gives. The extension is listed Enabled, both entries load and the transport works in the main process of the host. The files of the log of the host hold no line of an error of the extension | REL-02 |
| REQ-312 | Amended on 2026-11-09, see [the amendment](#2026-11-09-no-prerelease-before-100): on the release candidate, with no prerelease. The review of the sixth milestone, as [PROCESS](../development/PROCESS.md#milestone-manual-review-gate) says, once the report of the pre-review of REQ-292 is in the lead maintainer's hands: the walk of [TRY-IT](../development/TRY-IT.md) on the environment of the demo, in the extension packed from the commit of main the pre-review ran on and installed from its tarball, as TRY-IT installs it; the gallery, with no scan (D8 is not taken); the README, its screenshots, the video and the notes of 1.0.0, with the checklist of the sections no case reads (DOC-01 and DOC-07; DOC-06 is not taken, see [the amendment](#2026-11-09-the-sections-of-the-other-extensions)). Its findings are issues, the blocking ones fixed on main before 1.0.0, which is checked as REQ-311 says; the outcome is recorded in this spec by role and date | REL-03 |
| REQ-313 | Amended on 2026-11-09, see [the amendment](#2026-11-09-no-prerelease-before-100): 1.0.0 is the first publication, installed by name in a new profile. 1.0.0 is published on `latest` on the lead maintainer's go, after the review of REQ-312, once what gates 1.0.0 in D15 is Done, M6 is done as D18 reads it, and every spec of v1.0.0 is Verified or waits only for a check of this milestone: the drift watch read again and recorded in RECON-T0.1 (D17), the version workflow with `1.0.0`, its pull request, the tag, the release workflow. Then `latest` names 1.0.0 and `next` names nothing, its GitHub release is not a prerelease, its assets pass the checks of REQ-309, Freelens 2.0.0 installs it by name in a new profile, Enabled, and the README and the roadmap say that 1.0.0 is released. The install over the last prerelease, with its preferences kept, is not taken: no version is published before 1.0.0 (G2.3) | REL-04 |

## Design

- **Standard or ad hoc view, and why.** Neither: the milestone adds no view and
  changes none. It checks the views that exist, and documents and releases them.
  A defect a check of this spec finds is fixed through the normal loop, with an
  amendment of the spec of its view.
- **Safety.** The checks write only to the disposable kind clusters of the
  environment: the actions of the two identities of REQ-288, removed by their
  run, with REQ-287 and REQ-291 not taken on 2026-11-09
  ([the amendment](#2026-11-09-the-checks-beyond-the-other-extensions)). No check
  opens a listener beyond loopback. The registry of npm and the releases of
  GitHub are written only by the release workflow of the template, at a tag the
  tag workflow makes on main at the merge of the pull request of the version or on
  `/tag`, in its one job in the environment `publishing`, which has no required
  reviewer, as amended on 2026-11-09
  ([the release flow](#2026-11-09-the-release-flow-of-the-template),
  [the environment](#2026-11-09-the-environment-of-the-template)). The README says
  what the extension writes (REQ-298), and its words are tied to the code by the
  checks of T6.3.

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
| No check, as amended on 2026-11-09: the build, the pack and the publication of the tag, and the assets of its GitHub release | `release.yaml` | No | No | No | Its one job |

The six parts of the views are the ones of `e2e/views-parts.json`: three on the
environment of the demo, with the server of the release, and three on the CRDs
alone. The new checks of T6.1 run in these layers, as amended on 2026-11-09: the
first half of REQ-286 in the unit tests and in the two workflows that build
Freelens; REQ-288 in the end to end tests and in the part of the restricted
suite; REQ-289 and REQ-290 wherever FND-10 runs; REQ-317 in the unit tests.

### The Release Flow

The flow of the template of the organization, as amended on 2026-11-09
([the amendment](#2026-11-09-the-release-flow-of-the-template)):

1. The drift watch, read and recorded in RECON-T0.1 before the first release, and
   read again before 1.0.0, the first publication, as amended on 2026-11-09
   ([the amendment](#2026-11-09-no-prerelease-before-100)) (REQ-310, REQ-313).
2. The version workflow, started by hand with the version, opens the pull
   request of the version; it is merged once its checks and the last runs of
   main are green (REQ-285).
3. The tag workflow tags main once that pull request is merged, `vX.Y.Z` or
   `vX.Y.Z-` followed by letters, digits, dots and hyphens (REQ-315).
4. The release workflow runs its one job in the environment `publishing` at the
   tag, with no approval to wait for
   ([the environment of the template](#2026-11-09-the-environment-of-the-template));
   the runs of the commit of the tag are read once they end (REQ-285). It checks
   that the tag is the version of
   `package.json`, builds and packs; publishes on `next` a version with a hyphen
   and on `latest` any other, with the token of D11b and no provenance while a
   secret `NPM_TOKEN` reaches the job, and otherwise through the trusted
   publisher with provenance (REQ-308); then makes the bill of materials of the
   repository (REQ-307) and the checksums, and creates the GitHub release with
   the four assets, marked as a prerelease for a version with a hyphen.
5. The notes of the version, written in the body of its GitHub release
   (REQ-303).
6. The proof of the assets (REQ-309) and the check by version (REQ-311).

Freelens 2.0.0 does not read the npm tag `latest` when it installs by name: it
takes the newest version that is not a prerelease, deprecated or not, and says
that it found none when there is none
([`attempt-install-by-info.injectable.tsx`](https://github.com/freelensapp/freelens/blob/b9b53e16056578c5407312eba5823a089972f6d5/packages/core/src/renderer/components/extensions/attempt-install-by-info.injectable.tsx#L105-L156));
a name followed by a version or a tag installs that version, or the version the
tag names.

### The Way Back

A version on the registry is never published again, and nothing of this flow
unpublishes one. A version found bad, by a red run of its merge commit or later,
is announced nowhere, or its announcement is withdrawn. As amended on 2026-11-09
([the amendment](#2026-11-09-no-prerelease-before-100)), there is no prerelease
1.0.0-N to deprecate and replace, and 1.0.0 is the first publication. A bad 1.0.0
is deprecated and followed by 1.0.1 through the same flow: Freelens installs by
name the newest version that is not a prerelease, deprecated or not, so only a
newer version replaces it for an operator; and `latest`, with no earlier version
to be moved back to, names 1.0.0 until 1.0.1 moves it. For a bad version after
1.0.0, `latest` may be moved back with `npm dist-tag` for the page of the package
and the command line, until the next version moves it. `npm deprecate` and
`npm dist-tag` are the only commands run by hand, by
an owner of the scope, on the lead maintainer's go, since the workflow publishes
through the trusted publisher and does not run them; each is recorded in the
evidence by role and date.

### The Amendments The Slices Bring

Each slice restates, with its own pull request and under the amendments of the
spec it touches, the part of that spec its change reaches, which the approval of
this spec covers.

| Spec or document | Now | Restated |
| --- | --- | --- |
| SPEC-0004, REQ-041 and REQ-044 (ENV-04, ENV-07), with REQ-287 | One kind cluster: a second node or a second network stops the command, and the removal deletes the cluster the journal owns | Nothing: REQ-287 is not taken on 2026-11-09 ([the amendment](#2026-11-09-the-checks-beyond-the-other-extensions)), and the environment keeps its one kind cluster |
| SPEC-0009, the decision on the frame of a second entry, with REQ-314 | The second entry is the same cluster through another kubeconfig | Kept, and with it the proof of the gate between frames and of the count of their writes, with no second cluster beside it: REQ-287 and REQ-314 are not taken on 2026-11-09 |
| SPEC-0015, HOST-21, with REQ-310 | The first prerelease leaves `latest` untouched | Amended on 2026-11-09, see [the amendment](#2026-11-09-no-prerelease-before-100): HOST-21 is read on 1.0.0, the first publication: its tag, `latest` naming 1.0.0 and `next` naming nothing, and its GitHub release not a prerelease, which SPEC-0015 records in an amendment of its own. Freelens and a command line both install 1.0.0 by the name alone |
| SPEC-0015, REQ-216, with D18 | 1.0.0 on `latest` only after M6 is done | M6 done read as T6.1 to T6.4 Done and the review of the milestone passed |
| TESTING.md, the identities, the fixture matrix and the integration tests | Isolation is "unit plus authorized local integration"; the actions run as the administrator of the kind cluster; FND-10 runs in the integration and views workflows | The two identities of REQ-288 for the session, the two cases of FND-10 of REQ-289 and REQ-290, and the scan of REQ-293, which is not taken (D8) |
| ARCHITECTURE.md and AGENTS.md, the paragraphs of a release and of the workflows | The release workflow builds, packs, publishes, then makes the bill of materials and the checksums, in one job; the tag workflow tags main; AGENTS.md says the views run in five parts | Six parts; the release and the tag stay those of the template, as amended on 2026-11-09 |
| PROCESS.md, the working agreements | Packages are published only by the release workflow, tags created only by the tag workflow | The same; and [the way back](#the-way-back), by an owner of the scope on the lead maintainer's go |
| DEPENDENCY-AUDIT.md, with REQ-294 | Testing Library and jsdom are for the tests alone | axe-core, which would have joined Testing Library and jsdom among what only tests, is not taken (D8) |
| RECON-T0.1.md, with REQ-310 and REQ-313 | The last entry of the drift watch at the start of a milestone is of 2026-10-13 | An entry before the first release, of 2026-11-09, and one before 1.0.0, the first publication, as amended on 2026-11-09 ([the amendment](#2026-11-09-no-prerelease-before-100)) |
| ROADMAP.md, with D16 | The row of T6.1 names the packaged integration and the performance | At the approval, the row narrowed to what D16 takes, and what it defers recorded under Deferred after v1.0.0; on 2026-11-09, narrowed again to what D16 takes as amended, and what the amendments do not take recorded there as well |

The files the slices change beside the specs and the documents above:

| File | Change | Requirements |
| --- | --- | --- |
| `.github/workflows/npm-version.yaml`, `tag.yaml` and `release.yaml` | The files of the template of the organization, byte for byte, as amended on 2026-11-09 | REQ-307, REQ-308, REQ-315 |
| `.trunk/trunk.yaml` | The definition of actionlint of the template, the version 1.17.0 from the fork it downloads it from, which knows the runner of the three workflows, as amended on 2026-11-09 | REQ-307, REQ-308, REQ-315 |
| `.github/workflows/integration-tests.yaml`, with a new reusable workflow or composite action under `.github/` | The steps that make the Freelens of the target, shared with the workflow of the views, with the line of its commit | REQ-286 |
| `e2e/scripts/local-demo.mts` | The runner by version of D14 | REQ-311 |
| `test/environment.test.ts`, or files of their own under `test/` | The case of the target extended to the action that builds Freelens (REG-02), beside the case of the tags (REL-05); the cases that read the README | REQ-286, REQ-296 to REQ-299, REQ-304, REQ-315 |
| `src/main/index.ts`, `test/build.test.ts` | `resolveRoute` exported by the main bundle and listed among the exports the build test pins; the ceilings of the bundles | REQ-290, REQ-317 |
| `integration/__tests__/extensions.tests.ts` | The cases of REQ-289 and REQ-290 | REQ-289, REQ-290 |
| `e2e/scripts/` and the fixtures | The two identities | REQ-288 |
| `e2e/__tests__/pre-review.tests.ts` and a file of the exceptions; `package.json` and the lockfile | The scan, and axe-core at an exact version: not taken (D8) | REQ-293, REQ-294 |
| `README.md`, `docs/screenshots/` (new) | The sections of T6.3, the screenshots | REQ-295 to REQ-302, REQ-304 |

## Tests

| Check | Layer | Requirements | Scenario and expected evidence |
| --- | --- | --- | --- |
| REG-01 | Workflow, manual | REQ-285 | Before the merge of the pull request of each version: the last runs on main of each workflow of [the table](#where-each-check-runs) that runs there, of a push and of the night, and the checks of that pull request, green, listed with their counts in the evidence; a run that passed when run again listed with its first failure. After the tag: the runs of the merge commit, listed with their counts once they end, after the publication, as amended on 2026-11-09 ([the amendment](#2026-11-09-the-environment-of-the-template)); the tag names that commit (REL-01) |
| REG-02 | Unit | REQ-286 | Amended on 2026-11-09, see [the amendment](#2026-11-09-the-release-flow-of-the-template): the part of the target alone, with the first half of REQ-286. The case of the target reads the composite action and holds every workflow that calls it, each naming the commit of the target in one line and giving it to the action once, as the evidence of that half records; the case of `release.yaml`, its run on a pull request and the log of `package` are not taken |
| REG-03 | Not taken | REQ-287 | Not taken on 2026-11-09, see [the amendment](#2026-11-09-the-checks-beyond-the-other-extensions) |
| REG-08 | Not taken | REQ-314 | Not taken on 2026-11-09, see [the amendment](#2026-11-09-the-checks-beyond-the-other-extensions) |
| REG-04 | End to end, packaged application | REQ-288 | With the kubeconfig of the operator for the session: the proofs of the actions, the proof of the download and a request of the version of the server, green. With the kubeconfig of the reader: the restricted suite, green; a creation of a Backup and the patch of a Schedule, each forbidden at its step with nothing counted |
| REG-05 | Packaged integration | REQ-289 | In FND-10: a download over HTTPS with the authority inline, decoded; no authority, and a certificate for another name, each `tls-invalid` with no URL in the words |
| REG-06 | Packaged integration, unit | REQ-290 | In FND-10: the route of a URL that names a private address literal nothing listens on, refused without the allowance with its words, then direct to that address with it, and no connection; the build test lists `resolveRoute` among the exports of the main bundle |
| REG-07 | Not taken | REQ-291 | Not taken on 2026-11-09, see [the amendment](#2026-11-09-the-checks-beyond-the-other-extensions) |
| REG-09 | Unit | REQ-317 | The build test finds each bundle under its ceiling; seen failing with a ceiling set below the size of its bundle |
| VIS-01 | Pre-review, manual | REQ-292 | Amended on 2026-11-09, see [the amendment](#2026-11-09-no-prerelease-before-100): the pre-review on the commit of main the review reads, the release candidate, every case green, its counts, report and gallery; the judgment of the lead maintainer at REL-03 |
| VIS-02 | Pre-review | REQ-293 | Not taken, decided by the lead maintainer on 2026-11-09: the pre-review stays the visual one of the other extensions; the scan is not kept (D8). As approved: the scan of every view in both themes at the two sizes, its report listing every violation, green with the exceptions of the file; seen failing when the case itself, in the DOM of the page it scans and never in the source of a view, removes the name of a button, removes the label of an input and lowers the contrast of a text below AA in one theme |
| VIS-03 | Unit | REQ-294 | Not taken, decided by the lead maintainer on 2026-11-09: the pre-review stays the visual one of the other extensions; the scan is not kept (D8). As approved: the build test finds no module of axe-core in either bundle and the manifest lists it among the devDependencies at an exact version; Knip finds it used |
| DOC-01 | Manual | REQ-295 | Amended on 2026-11-09, see [the amendment](#2026-11-09-no-prerelease-before-100): the checklist of REL-03 reads the section: the name of `package.json`, a version, the releases of the repository, and no tag `next`; each way tried on 1.0.0, at REL-02 and REL-04 |
| DOC-02 | Unit | REQ-296 | A case finds in the section the range of `engines.freelens` of `package.json` and the API versions of the kinds the extension reads, and no section that says there is no release |
| DOC-03 | Unit, end to end | REQ-297 | A case compares the two YAML blocks of the section, text for text, with a rendering of the roles of the two identities of REQ-288, with no YAML parser; it lands with #145, after the identities; each row of the table checked with `kubectl auth can-i` in the pull request of #145 |
| DOC-04 | Unit | REQ-298 | Amended on 2026-11-09, see [the amendment](#2026-11-09-the-sections-of-the-other-extensions): the section is Write actions, under Features. A case finds in the section each kind and verb the adapter allows (ACT-01 of SPEC-0017), no other kind of Velero said to be written, and the three rules, signed URLs, TLS and missing data, each by the words that say it |
| DOC-05 | Unit | REQ-299 | A case reads the table and finds the version and the commit of the target in the header of SPEC-0015 and the versions of the images in `e2e/scripts/local-manifests.mts`, so a move of a pin that leaves the README fails |
| DOC-06 | Not taken | REQ-300 | Not taken on 2026-11-09, see [the amendment](#2026-11-09-the-sections-of-the-other-extensions). As approved: the checklist of REL-03 compares each quoted message with what the function of its words returns for its case, which the slice lists beside the quote |
| DOC-07 | Manual | REQ-301 | The checklist of REL-03: each screenshot looked at by the lead maintainer, with its text; DOC-10 resolves its file under `docs/screenshots/`, and ASSET-06 finds none in the package |
| DOC-08 | Manual | REQ-302 | The length of the file under 60 seconds, every frame looked at by the lead maintainer at REL-03, the link of the README opened |
| DOC-09 | Not taken | REQ-303 | Not taken on 2026-11-09, see [the amendment](#2026-11-09-the-release-flow-of-the-template): there is no `CHANGELOG.md` and no case of the notes |
| DOC-10 | Unit, manual | REQ-304 | A case resolves each relative link, image and anchor of the two documents and finds no character outside ASCII and no em dash; the external links opened at REL-03 |
| ASSET-01 | Not taken | REQ-305 | Not taken on 2026-11-09, see [the amendment](#2026-11-09-the-release-flow-of-the-template) |
| ASSET-02 | Not taken | REQ-306 | Not taken on 2026-11-09, see [the amendment](#2026-11-09-the-release-flow-of-the-template) |
| ASSET-03 | Manual | REQ-307 | Amended on 2026-11-09, see [the amendment](#2026-11-09-the-release-flow-of-the-template): no case; the bill of materials attached to the GitHub release of the first version published, and its `.sha256`, read at ASSET-05, with the packages it lists recorded |
| ASSET-04 | Manual | REQ-308 | Amended on 2026-11-09, see [the amendment](#2026-11-09-the-release-flow-of-the-template): no case; 1.0.0 read from the registry with no attestation; the token revoked and deleted, and the trusted publisher configured, recorded by role and date; the attestation of the first version published through the trusted publisher read from the registry |
| ASSET-05 | Manual | REQ-309 | Amended on 2026-11-09, see [the amendment](#2026-11-09-no-prerelease-before-100): the steps of [the success criteria](#success-criteria) on 1.0.0, each result recorded in the evidence |
| ASSET-06 | Not taken | REQ-316 | Not taken on 2026-11-09, see [the amendment](#2026-11-09-the-release-flow-of-the-template) |
| REL-01 | Workflow, manual | REQ-310 | The entry of the drift watch in RECON-T0.1; the runs of REG-01; the tag and its commit, equal to the merge commit of the pull request of the version; the runs of the two jobs; the tags of the registry; recorded |
| REL-05 | Unit, manual | REQ-315 | Amended on 2026-11-09, see [the amendment](#2026-11-09-the-release-flow-of-the-template): the case of the tags reads the expression `tag.yaml` matches the version with, as bash reads it, `X.Y.Z` and `X.Y.Z-N` tagged and `1.0.0-`, `1.0` and `v1.0.0` not; the file is the template's, compared with `cmp` in the evidence of the amendment; the tag and its commit read at REL-01. The case of the merge commit is removed |
| REL-02 | Packaged integration | REQ-311 | Amended on 2026-11-09, see [the amendment](#2026-11-09-no-prerelease-before-100): on macOS, for 1.0.0: the `.dmg` of Freelens 2.0.0 checked against its `.sha256`; FND-10 run by the version, every case green, the version listed Enabled; the files of the log of the host with no line of an error of the extension |
| REL-03 | Manual | REQ-312 | The review recorded by role and date, with its checklist, its findings and their issues |
| REL-04 | Manual | REQ-313 | Amended on 2026-11-09, see [the amendment](#2026-11-09-no-prerelease-before-100): the entry of the drift watch; the steps of the success criteria on 1.0.0, with the install by name in a new profile |

The homes: the cases that read the README and the workflows beside the cases of
the workflows in `test/environment.test.ts`, or in a file of their own under
`test/`; the two cases of FND-10 in
`integration/__tests__/extensions.tests.ts`, the main bundle exporting
`resolveRoute` as it exports the transport, with the pin of its exports and the
ceilings in `test/build.test.ts`; the two identities among the fixtures; the scan
and its exceptions beside the pre-review and the parts of the views, which are not
taken (D8).

## Success Criteria

As amended on 2026-11-09
([the release flow of the template](#2026-11-09-the-release-flow-of-the-template),
[the checks beyond the other extensions](#2026-11-09-the-checks-beyond-the-other-extensions),
[no prerelease before 1.0.0](#2026-11-09-no-prerelease-before-100)
and [the environment of the template](#2026-11-09-the-environment-of-the-template)):

- Every check of the regression green before the merge of each version, the runs
  of the commit of its tag read once they end, after its publication, listed
  (REG-01), and
  every new check of T6.1 that stays, the identities of the roles, the HTTPS and
  the direct route of FND-10 and the ceilings of the bundles, green where it runs.
- The version, tag and release workflows the ones of the template of the
  organization, byte for byte.
- One tarball: the asset of the GitHub release is the tarball of the registry,
  byte for byte.
- The gallery of the pre-review judged at the review of the milestone. The scan of
  the views with its report, and no violation of impact serious or critical on an
  element of the extension but the exceptions a spec made, is not taken (D8).
- Each statement of the README that the code can change without anyone seeing it
  is read by a unit case: the range of Freelens, the roles, the writes, the
  versions and the links; the installation and the screenshots are read by the
  checklist of the review of the milestone.
- The review of the milestone recorded, and 1.0.0 on `latest`, the first
  publication, checked by FND-10 by its version and installed by name.
- Failure: a version published other than by the release workflow, or from a
  pull request of a version merged without the lead maintainer's go; a
  credential of npm left in
  `publishing` after the version it was made for; a README that says a write, a
  verb, a version or a message the code does not; anything of a real environment
  in a screenshot, the video, the notes or the package; a write of a check
  outside the disposable clusters, or a listener opened beyond loopback.

The steps of ASSET-05, on 1.0.0, as amended on 2026-11-09
([the amendment](#2026-11-09-no-prerelease-before-100)), each in an empty
directory, with the result recorded:

1. `gh release view v1.0.0 --repo freelensapp/freelens-velero-extension --json isPrerelease,assets`:
   not a prerelease, with the tarball, the bill of materials and their two
   `.sha256`.
2. The four assets downloaded; `sha256sum -c` of each `.sha256`, or
   `shasum -a 256 -c` on macOS: both OK.
3. `npm pack @freelensapp/velero-extension@1.0.0`, the registry asked again
   until it answers the version, for five minutes at most; `cmp` of that tarball
   with the asset: no difference.
4. In a new project, `npm install @freelensapp/velero-extension@1.0.0`, then
   `npm audit signatures`: the signature of the registry verified, and the
   attestation as REQ-308 says: none for a version published with the token, as
   1.0.0 is, and for one published through the trusted publisher an attestation
   that names `release.yaml`, `refs/tags/v1.0.0` and the commit of the tag.
5. The bill of materials, of the repository at the tag (REQ-307): the packages it
   lists recorded.
6. `npm view @freelensapp/velero-extension dist-tags`: `latest` is 1.0.0, and
   `next` names nothing.
7. The log of the run of the release workflow at the tag: the tag checked against
   the version, the publication on its npm tag, and the release with the four
   assets.

The steps of REL-04, on 1.0.0, as amended on 2026-11-09: the steps of ASSET-05,
made once on 1.0.0 for both checks; and in a new profile, the name typed alone on
the Extensions page installs 1.0.0, listed Enabled. The install over the last
prerelease, with the installation selected before still selected, is not taken:
no version is published before 1.0.0 (G2.3).

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
D8 bounds the risk by failing only on the elements of the extension. The scan ran
once, on 2026-11-09, and is not kept (D8): the risk is gone with it.

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
  Not taken on 2026-11-09
  ([the amendment](#2026-11-09-the-release-flow-of-the-template)): the release
  workflow is the template's, one job in the environment `publishing` that checks
  the tag, builds, packs and publishes at the tag, as the other extensions of the
  organization release theirs. FND-10 runs where [the table](#where-each-check-runs)
  says, on the tarball the integration workflow packs, and not on the file the
  release publishes, which G1.1 names.
- **D4, a second cluster of the CRDs alone, for what two API servers add.** Not
  taken on 2026-11-09
  ([the amendment](#2026-11-09-the-checks-beyond-the-other-extensions)): the
  decision of SPEC-0009 stands alone, the second entry, the same cluster through
  another kubeconfig, whose suite proves the gate of each frame and the count of
  the writes between frames. What only two API servers show, the lists told apart
  by UID and the selection of each frame kept for its cluster, is deferred (G4.1,
  G4.4), and no second local kind target is authorized for the tests.
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
- **D7, two actions with the real controller.** Not taken on 2026-11-09
  ([the amendment](#2026-11-09-the-checks-beyond-the-other-extensions)): no
  action is asked with the real controller in the packaged application. Each
  action keeps its proof in `pnpm e2e` against the server of the release, through
  the compiled main process, and its cases in the suite of the actions on the CRDs
  of the release alone; G3.2 and the second part of G3.1 are deferred.
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
  the host a list of findings with no bound before 1.0.0. Not taken, decided by the
  lead maintainer on 2026-11-09: the pre-review stays the visual one of the other
  extensions; the scan is not kept. It ran once, on 2026-11-09, and the views were
  fixed for what it found, as [the evidence of T6.2](#evidence-and-deviations)
  records.
- **D9, the README of a public package.** The sections in the order of T6.3, for
  an operator who installs first and reads last. The screenshots are files of the
  repository, outside the files of the package; the video is linked from the
  README as an attachment of the repository on GitHub, as the other extensions of
  the organization link theirs, so that neither the repository nor the package
  carries it. Not taken: the video in the repository.
- **D10, the bill of materials of what ships.** Amended on 2026-11-09
  ([the amendment](#2026-11-09-the-release-flow-of-the-template)): the bill of
  materials is the template's, of the repository at the tag. The release scans the
  folder of the repository after the installation, the build, the pack and the
  publication, so the document lists the devDependencies as well, which the
  tarball does not contain, as this decision read at the approval. The scan of
  the packed file installed in an empty directory, and the record of its list,
  are not taken.
- **D11a, provenance on both ways of the publication.** Not taken on 2026-11-09
  ([the amendment](#2026-11-09-the-release-flow-of-the-template)): the template
  asks for the provenance only through the trusted publisher, and publishes with a
  token without it, so 1.0.0, published with the token of D11b, carries none, and
  the versions published through the trusted publisher after it carry it.
- **D11b, for the lead maintainer and an owner of the npm scope, the credential of the first version.**
  The registry has no version of the package (it answered 404 on 2026-11-09), and
  npm configures a trusted publisher on a package that exists, as far as this
  draft read (the second open question). The environment `publishing` has no
  secret, no required reviewer and no wait timer, and its deployment policies are
  the tags `v*` and the branches `publish/v*`, read on 2026-11-09: anyone who may
  push such a ref may run a workflow in it. The plan, outside the repository, as
  amended on 2026-11-09 ([the amendment](#2026-11-09-no-prerelease-before-100)):
  the first version is 1.0.0.
  1. An owner of the scope `@freelensapp` creates a granular access token that may
     publish in the scope, with the shortest expiry npm allows, and puts it in
     `publishing` for 1.0.0 alone.
  2. Not taken on 2026-11-09
     ([the environment of the template](#2026-11-09-the-environment-of-the-template)):
     the lead maintainer as the required reviewer of `publishing` from before
     1.0.0 and for every publication after it, the job `publish` waiting for that
     approval, given once the runs of the merge commit are green (REQ-285), and the
     branches `publish/v*` out of its deployment policies. The environment stays
     the template's, and the go of REQ-310 and REQ-313 comes before the merge of
     the pull request of the version, which is the gate of the publication.
  3. Once 1.0.0 is published, the token is revoked on npm and deleted from the
     environment, each recorded by role and date.
  4. The owner configures the trusted publisher of the package with this
     repository, the file `release.yaml` and the environment `publishing`.
  5. Not taken on 2026-11-09
     ([the release flow](#2026-11-09-the-release-flow-of-the-template)): one
     prerelease after 1.0.0-0 published through the trusted publisher before
     1.0.0, so that a mistake in that setting shows on a prerelease. With no
     prerelease ([the amendment](#2026-11-09-no-prerelease-before-100)), the first
     version published through the trusted publisher is the one after 1.0.0.

  The date of 1.0.0, the first version, depends on the first step as well. Not
  taken: a token for every version, a credential that lives as long as the
  package; and 1.0.0 as the first publication through the trusted publisher,
  which would show a mistake of its setting at the last step.
- **D12, the notes in `CHANGELOG.md`.** Not taken on 2026-11-09
  ([the amendment](#2026-11-09-the-release-flow-of-the-template)): the README and
  the notes follow the template. There is no `CHANGELOG.md` and no case of the
  notes, and the notes of each version are written in the body of its GitHub
  release, as the other extensions of the organization write them.
- **D13, the platforms the README says were tested.** The hosted checks, the
  packaged suites among them, run on Linux ARM64, `ubuntu-24.04-arm`; REL-02 runs
  on macOS; the contributors run the suites on macOS as well, which is evidence for
  their pull requests and not a status. The bundles are JavaScript that does not
  depend on the platform, and their two parts that do, the port read from the line
  of kubectl and the path of a saved file, are tested with fakes only. The README
  says that Linux ARM64 and macOS were tested, and that any other platform, Windows
  among them, was not. Not taken: a README that says the extension runs wherever
  Freelens runs. What T6.1 defers of the platforms is in D16.
- **D14, the check of a prerelease is FND-10 by version.** Amended on 2026-11-09
  ([the amendment](#2026-11-09-no-prerelease-before-100)): the check is of 1.0.0,
  with no prerelease before it. The runner of the integration test takes a name
  and a version in place of a tarball, and FND-10 checks what Freelens installed
  from npm with all its cases, in the release Freelens 2.0.0 for macOS copied out
  of its checked image. Not taken: the steps by hand of the success criteria.
- **D15, the order of the slices, and what gates 1.0.0-0 and what gates 1.0.0.**
  Restated on 2026-11-09 with the amendments of that day
  ([the release flow](#2026-11-09-the-release-flow-of-the-template),
  [the checks](#2026-11-09-the-checks-beyond-the-other-extensions)), and amended
  the same day ([no prerelease](#2026-11-09-no-prerelease-before-100)): there is
  no prerelease, and everything below gates 1.0.0, the first publication.
  - Gated 1.0.0-0, and gates 1.0.0 since the amendment: the drift watch read
    (REQ-310); T6.4, the release workflow of the template, with REQ-307, REQ-308
    and the first two steps of D11b; the case of FND-10 of REQ-289; the rules of
    the tag, REQ-285 before the merge and REQ-315; and what 1.0.0 is installed
    with, REQ-295 and the end of the section Status of REQ-296, with the case of
    REQ-304 on them, since npm shows the README of the version. 1.0.0-0 (REQ-310),
    with its proof and its check by version, is not taken: the proof (REQ-309) and
    the check (REQ-311) are made on 1.0.0.
  - Gates 1.0.0: the rest of T6.1, REQ-288, REQ-290 and REQ-317; T6.2; the rest
    of T6.3, the Permissions of #145 (REQ-297) after the identities of REQ-288, so
    that the case of DOC-03 lands with the roles; the notes of 1.0.0; the review
    of the milestone (REQ-312); the drift watch read again, and 1.0.0 (REQ-313),
    its proof (REQ-309) and its check by version (REQ-311).
  - The order: T6.4 and the rules of the tag first, then the sections of the
    README 1.0.0 is installed with; then the identities of REQ-288 and #145, the
    case of REQ-290 and the ceilings of REQ-317, with T6.2 beside them; then the
    screenshots, the video and the notes of 1.0.0, the review of the milestone and
    1.0.0. The prereleases the order placed between them as approved, 1.0.0-0
    and a later one, are not taken.

  Not taken: 1.0.0-0 as soon as M5 is done, which proves the workflow before its
  changes, so that the proof of REQ-309 is made again on a later prerelease; and
  1.0.0-0 at the end of T6.1 to T6.3, which leaves the workflow and the page of the
  package unproven until the end of the milestone. Since the amendment there is no
  1.0.0-0 at all: the workflow and the page of the package are proven on 1.0.0
  itself, and a mistake in them is answered by [the way back](#the-way-back).
- **D16, what T6.1 takes and what it defers.** Restated on 2026-11-09 with the
  amendments of that day
  ([the release flow](#2026-11-09-the-release-flow-of-the-template),
  [the checks](#2026-11-09-the-checks-beyond-the-other-extensions)). The row of
  T6.1 in the roadmap names the regression, the packaged integration, the end to
  end tests with the real controller, the isolation between clusters, the
  permissions, the transport security and the performance. Of the 32 gaps of the
  inventory, this spec takes G5.1 with G5.2 (REQ-288), G6.1 (REQ-289) and G6.2
  (REQ-290), and of the performance P7.2, a ceiling on the bytes of each bundle
  (REQ-317), a few lines of the build test. At the approval it took as well G1.1
  (REQ-286), the second part of G3.1 with G3.2 (REQ-291) and G4.1 with G4.4
  (REQ-287, REQ-314), which the amendments do not take: they are deferred with
  the others. It defers the others, each with its reason in
  [what T6.1 defers](#what-t61-defers), and among them two areas of the row: the
  performance but that ceiling, G7.1 to G7.6, whose budgets of TESTING.md hold with
  the margins the evidence records; and the platforms, G2.1, one platform and one
  architecture in CI, with macOS checked by REL-02 and both said in the README
  (D13). The reason: each deferred gap keeps its release signal through a check
  that exists or a statement of the README, and each would bring a harness of its
  own into the milestone. Since the amendments, two more areas of the row are
  deferred, by their decision: the end to end tests with the real controller in
  the packaged application, and the isolation between two clusters. Not taken:
  P2.1, FND-10 on hosted macOS and Windows runners at each tag, each with the
  released Freelens of its platform, a job and a download of Freelens for each
  platform; and the whole area of the performance, guards relative to a baseline,
  ceilings of memory and of the start, and larger datasets. With the approval, the
  row of T6.1 in the roadmap is narrowed to what this decision takes, and what it
  defers is recorded under Deferred after v1.0.0, as the roadmap asks of anything
  that moves out of v1.0.0; with the amendments, the row is narrowed again and
  what they do not take is recorded there as well.
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

- G1.1, the file the release publishes installed by a check: not taken on
  2026-11-09 with the release workflow of the template
  ([the amendment](#2026-11-09-the-release-flow-of-the-template)); FND-10 installs
  the tarball the integration workflow packs, on every pull request and every push
  to main.
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
- G2.3, an install over an earlier one and by name: REL-02 installs 1.0.0 by
  version and REL-04 by name, in a new profile, as amended on 2026-11-09
  ([the amendment](#2026-11-09-no-prerelease-before-100)); an install over an
  earlier version, by hand or by an automated case, waits for a second released
  version, since none is published before 1.0.0.
- G2.4, no night run of the ten sessions: they run on every pull request and push
  to main, on the CRDs alone.
- The second part of G3.1, and G3.2, the actions with the real controller in the
  packaged application: not taken on 2026-11-09
  ([the amendment](#2026-11-09-the-checks-beyond-the-other-extensions)); each
  action keeps its proof in `pnpm e2e` against the server of the release, through
  the compiled main process, and its cases in the suite of the actions on the CRDs
  of the release alone.
- G3.3, the counterparts of what the controller writes checked by hand: read again
  at the next move of Velero, as SPEC-0015 says, and right for the reviewed
  release this version ships for.
- G3.4, induced failures and real data movement: a new family of fixtures; the
  README says what was proven on synthetic objects alone (REQ-299).
- G3.5, a zone in a schedule against a real firing: the parser is checked against
  the tables of the library of the release (SPEC-0013).
- G4.1 with G4.4, two clusters at once in one packaged Freelens: not taken on
  2026-11-09 ([the amendment](#2026-11-09-the-checks-beyond-the-other-extensions));
  the gate of each frame and the count of the writes between frames stay proven by
  the second entry of SPEC-0009, the same cluster through another kubeconfig.
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
before the approval. The amendment of 2026-11-09
([the release flow](#2026-11-09-the-release-flow-of-the-template)) closes the
last two, and the one of no prerelease
([the amendment](#2026-11-09-no-prerelease-before-100)) the first.

- **Whether the registry names `latest` at the first publication under `next`
  (REQ-309, REQ-310).** Closed by
  [the amendment](#2026-11-09-no-prerelease-before-100): the first publication is
  1.0.0, on `latest`, and nothing is published under `next` before it.
- **Whether npm configures a trusted publisher before the first version (REQ-308,
  D11b).** This draft read that it does not. If it does, no token is created, and
  1.0.0, the first version since
  [the amendment](#2026-11-09-no-prerelease-before-100), is the first publication
  through the trusted publisher; the owner of the scope establishes it before the
  first step of D11b.
- **Whether `pnpm publish <file>` of pnpm 12 hands the file to the registry
  unchanged (REQ-286).** Closed by the amendment: the release workflow of the
  template publishes with `pnpm publish -r` in the job that packs, and no file
  passes from one job to another; the third step of ASSET-05 compares the tarball
  of the registry with the asset.
- **What the scan of the installation of the packed file lists (REQ-307).**
  Closed by the amendment: the bill of materials is the template's, of the
  repository at the tag, and the packed file is not scanned.

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

Undone on 2026-11-09, by [the amendment](#2026-11-09-the-release-flow-of-the-template)
of that day: the lead maintainer decided that the release flow of this extension is
the one of the template of the organization, like the one of every other extension,
and that nothing beyond it is done now. `tag.yaml` is the template's again, which
tags main as the job finds it, at the merge of the pull request of the version or on
`/tag`, and the case of REL-05 is removed with it, as the evidence of the release
flow of the template records below. The evidence above is the record of #151.

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

T6.3, the first of its pull requests, on 2026-11-09: what the first published
version is installed with, since npm shows the README of the version it
publishes. The README in the layout of the other extensions of the organization,
with Status, Requirements and its Compatibility, Supported APIs, Install,
Getting started and Safety; the drift watch before the first release; and four
unit cases in [`test/documents.test.ts`](../../test/documents.test.ts).
Permissions (#145), Features, Limits and Troubleshooting are not written, and
nothing links to them.

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
- Verify a release: not written, by the later decision at the end of this block.
- Getting started, new: after Install. Safety: after Getting started.
- Troubleshooting, Features and Limits: with the slices that write them.
- Development, as it was; Build from the source, with the subsections of the other
  extensions: Prerequisites, Build extension, Development loop, Check the code,
  Integration tests, Testing the extension with unpublished Freelens; License.

The badges are the ones of the other extensions of the organization, as the lead
maintainer asked with the layout: the badges Home and GitHub draw an emoji their
address encodes, the files staying ASCII, and the badge DeepWiki names a service
outside the organization. Until 1.0.0 is published, the badge of the release and
the badge of npm show no version.

The evidence, by check:

- DOC-01: each way Install gives was read in the source of
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
  `freelens://app/extensions/install/%40freelensapp%2Fvelero-extension`, as the
  template of the organization writes it: the name from the path, and a version or
  a tag from `version` when a link has one
  (`renderer/protocol-handler/bind-protocol-add-route-handlers/bind-protocol-add-route-handlers.tsx`,
  lines 129 to 136; `common/protocol-handler/router.ts`, line 78 and lines 157 to
  160), the name not decoded (`packages/routing/src/match-path.ts`, lines 128 and
  129), so that the registry is asked for it percent-encoded, as by the links of
  the other extensions; the whole address sent by the main process to the renderer
  (`main/protocol-handler/lens-protocol-router-main/lens-protocol-router-main.ts`,
  lines 117 to 130); and a confirmation of the version before the install
  (`attempt-install-by-info.injectable.tsx`, lines 171 to 186). A path, typed or
  chosen with Browse:
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
  to 260). Each way is tried by hand on the first published version, and
  recorded, at the checks the slice of the release workflow restates for it.
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
- DOC-10: the case resolves each relative link, image and definition of a link of
  the README, out of its code, against the files Git holds for the repository,
  without the query of a link, and each anchor against the headings of its
  document by the slug GitHub makes; and finds in it no character outside ASCII,
  no em dash and no shortcode of an emoji in the prose. The external links are
  opened at REL-03.
- REL-01, its drift watch: the entry "Before The First Release, 2026-11-09" of
  [RECON-T0.1](../development/RECON-T0.1.md#before-the-first-release-2026-11-09):
  Velero v1.18.4 and the AWS plugin v1.14.4 still the latest stable releases, the
  release candidates v1.19.0-rc.1 and v1.15.0-rc.1 newer and not a baseline, with
  the breaking changes of the first that touch the kinds the extension reads, and
  the reviewed pair kept (D17); no release of Freelens after v2.0.0, and the target
  kept.

Each case was seen failing on changes made on purpose, one at a time, each failing
its case alone, and put back: DOC-02 on the range of Freelens changed in
Requirements, the version of the data movement changed in the code, a kind left
out of Supported APIs, the Status of before put back and its sentence written
elsewhere, and the tag `next` named again in Install; DOC-04 on a row of a
creation removed, a row of a write the adapter does not make, another kind of
Velero said to be written, the patch said of one field, a write of the adapter
changed from a POST to a PATCH, and each of the three rules reworded; DOC-05 on
the pin of Velero, of its plugin and of the node moved, the commit and the version
of the target moved in SPEC-0015, and the sentence of what is untested removed;
DOC-10 on a link to a file the repository does not hold, an anchor no heading of
the README has, an anchor no heading of TESTING.md has, a character outside
ASCII, an em dash and a shortcode of an emoji. Beside them, what the cases must
let pass passed: the range of Freelens wrapped to the next line, a constant
beside the classes of the kinds, the words "no release" in another section, cells
aligned with spaces, and a link with a query.

Decided while implementing, on 2026-11-09:

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
the tarball of the first published version is tried by hand, and recorded: if it
installs, the words come back to Install; if it does not, it is a defect of the
host, to report to Freelens.

The independent review of this pull request, read only, found no blocker, one
major, seven minors and ten nits, all applied: Safety lists every write the adapter
allows, with DOC-04; Compatibility is written, with DOC-05; DOC-02 takes the
harmless edits; the drift watch says what Node and the release candidate are; the
order of the merge was decided and ASSET-02 read the commands themselves, both
gone with the later decisions below; and the nits, among them the words of a
restore, one list of the gates, the package of the validation target, the version
put back after `pnpm pack:dev`, and no placeholder of a run after the first
publication.

The full unit run, `pnpm test:unit`, on a second Linux machine, at the head after
the review: 135 files and 3,818 tests passed, and the three measures. The checks
of its pull request, the unit tests, the check, Trunk and the integration test,
green before its merge; its files reach no part of the views and no end to end
run.

Decided by the lead maintainer on 2026-11-09, after the review of this pull
request: there is no prerelease, and 1.0.0 is the first publication, made once the
rest of the milestone is done. Status says that 1.0.0, the first release, is being
prepared, and that until it is published the extension is installed from the
source, which is true from the merge of this pull request; a later pull request,
right before the one of the version, turns it into the Status of the README of
1.0.0. Install gives the name, `@freelensapp/velero-extension`, which installs the
newest version that is not a prerelease, the one 1.0.0 will be, a version after
the name, the link of the template without a version, a release tarball and a
directory, and no tag `next`, on which DOC-02 fails. The drift watch of
RECON-T0.1 is the one before the first release, read again before 1.0.0
(REQ-313).

Decided by the lead maintainer on 2026-11-09, the same day: the release flow of
the extension is the one of the template of the organization,
freelensapp/freelens-example-extension, and the README stays as the template and
the other extensions have it, with nothing more. This slice follows it:
`CHANGELOG.md` is removed, its section of 1.0.0 kept outside the repository for
the body of the GitHub release, which is written as the other extensions write
theirs; Verify a release is removed, and From a release tarball says what the
template says, with the names of this package, but the drop, which the source of
the target does not support (the deviation above), and with the releases said to
be for Freelens 2.x where the template says that the major versions match;
Status names the releases of the repository on GitHub in place of the changelog;
DOC-09 and ASSET-02 are removed with what they read, and DOC-10 reads the README
alone. The row of T6.4 is Approved again: this pull request no longer carries its
REQ-306. The amendments of the requirements these decisions bring, REQ-303,
REQ-306 and the others of the release flow, among them REQ-295 of the tag `next`,
the end of Status of REQ-296, D15 and REQ-309 to REQ-311 and REQ-313, are made by
another pull request.

T6.1, the case of FND-10 of REQ-290 and the ceilings of REQ-317, on 2026-11-09: the
direct route in the main process of the host, and a ceiling on the bytes of each file
the host loads, in one pull request of two commits, the second after the independent
review of the first. The evidence, by check:

- REG-06, in FND-10
  ([`extensions.tests.ts`](../../integration/__tests__/extensions.tests.ts)), a case
  of its own after the download over HTTPS, which makes eight cases of FND-10. In the
  main process of the host, `resolveRoute` of the module the host loaded, which the
  main bundle now exports beside the transport, resolves the route of the log of a
  backup at its signed URL,
  `https://198.18.250.10:9000/fnd-10/backups/fnd-10/fnd-10-logs.gz?X-Amz-Signature=synthetic`,
  for a storage location of the plugin of AWS whose `s3Url` is that origin, with the
  bucket in the path: the origin is one the location gives, and the path is the key
  of the file asked. 198.18.250.10 is an address literal of 198.18.0.0/15, a range
  `classifyAddress` of `src/common/artifact-address.ts` counts as private; the case
  and a unit case of the environment read it from
  [`velero-route.ts`](../../integration/helpers/velero-route.ts).
  - Without the allowance of private addresses for the cluster, the route is
    refused: a `DiagnosticError` of the bundle, `destination-denied` at the step
    `route` by the rule `allowance`, with what the operator may allow,
    `{ what: "private", origin: "https://198.18.250.10:9000" }`. The words of that
    very error are made in the host by `downloadFailureOf`, with which the main
    process says to the views how a download failed, and which the main bundle now
    exports as well: a failure `destination-denied` at the step `route`, not to be
    asked again as it was, whose text says that the store of that origin is at a
    private address and that a connection to it is made only after it is allowed,
    which carries the same `needs` for the views to offer it, and which holds
    nothing of the path or the signature of the URL.
  - With the allowance, given for that origin as the operator gives it, the route is
    direct to that address: its origin, the path of the file, 198.18.250.10, the
    port 9000, `mode: "direct"`, `allowHttp: false` and `allowPrivate: true`.
  - Each time, the route asked the allowance of the cluster for that origin and the
    location `velero/default`, and nothing else: the stand-ins of the cluster, of the
    resolver of this machine and of kubectl, which record what they are asked and
    refuse it, were asked nothing. What is thrown that is not a `DiagnosticError` is
    kept with its message, which says what was asked.
  - Each resolution ends within eight seconds of its own, the two well within the 30
    of the evaluation, so that the case puts the classes of Node back before it gives
    up on the evaluation.
  - No listener and no connection. The case opens no listener. While the two routes
    are resolved, and for a turn of the loop and a tenth of a second after them, it
    records in the main process of the host, on `net.Socket.prototype.connect`, which
    the clients of Node go through, `net`, `tls`, `http`, `https`, `http2` and
    `fetch` among them, and on `net.Server.prototype.listen`, every connection and
    every listener whose stack, read with all its frames, names the build the host
    made of the extension, by its folder as a path or as a URL, and every connection
    to 198.18.250.10: none. What else the host opens in that time is neither recorded
    nor closed, since the case closes only what it recorded. Why the resolution
    cannot connect, besides: `resolveRoute` reaches outside the process only through
    the client of the cluster, the resolver and kubectl it is given, and through
    `lookup` of `node:dns/promises` when it is given no resolver and the host is a
    name; the rest of it, beside the allowances it is given, is the pure functions of
    common. The case gives all of them, and the host of its URL is an address.
- REG-06, in the build test ([`build.test.ts`](../../test/build.test.ts)): the exports
  of the main bundle loaded under Node list `resolveRoute` and `downloadFailureOf`,
  and FND-10 lists both among the exports of the module the host loaded.
- The address, in the environment test
  ([`environment.test.ts`](../../test/environment.test.ts)): 198.18.250.10 is an
  address `classifyAddress` counts as private, outside every subnet of `SUBNETS` of
  `e2e/scripts/local-kind.mts`, 198.18.64.0/24 for the network of Docker and
  198.19.0.0/18 and 198.19.64.0/24 for the pods and the services of the cluster,
  from which the second cluster of REQ-287 will take more.
- REG-09, in the build test: each file the host loads under a ceiling a quarter above
  its size at the head of the slice, rounded up to the byte, with that size and its
  date beside it. A file that passes its ceiling fails the case with its size and its
  ceiling, and with words that say to move the ceiling, with its reason, in the pull
  request that needs it.

  | File | Size, bytes | Ceiling, bytes |
  | --- | --- | --- |
  | `dist/main.js` | 265,505 | 331,882 |
  | `dist/renderer.js` | 932,411 | 1,165,514 |
  | `dist/renderer.css` | 61,044 | 76,305 |

  The sizes are of `pnpm build` with Node 24.21.0 and the lockfile; the bundles name
  no path of the machine that built them, and the build of the first commit in CI,
  on Linux ARM64, printed sizes that agree with those of the same commit here to the
  ten bytes Vite prints. The main bundle grew by 33 bytes with the two exports, from
  265,472 on main. A rebase onto a main whose bundles changed measures them again at
  the head that merges, the commit REQ-317 names.
- Seen failing, each change made on purpose and put back:
  - the build test: `resolveRoute`, then `downloadFailureOf`, taken out of the
    exports of the main entry and the bundle built again, each at the list of the
    exports of the case that loads the main bundle, the one case of the 13 that
    failed; and each ceiling set one byte below the size of its file, at the case of
    the ceilings, which named that file with its size and its ceiling and said to
    move the ceiling, the one case that failed. Every ceiling set to the size of its
    file passed;
  - the environment test: the address of the route moved into each of the three
    subnets, which the case named, and to a public address, 203.0.113.7, at the
    class of the address.
- The function the case evaluates in the host, run outside Electron: a probe, never
  committed, made of the module part of the test file and of the case as written,
  under a stand-in of the application whose `evaluate` calls the text of the function
  with its argument, as Playwright does, in a process of Node 24.21.0 with a
  stand-in of the API of the host, against the main bundle of the head. Vitest ran
  the assertions of the case as written: every one held. With the stand-in of the
  host connecting to a server of its own on the loopback while the case ran, the case
  passed, and that socket was neither recorded nor closed; with every connection
  recorded instead, the same run failed the record of the connections and closed
  that socket. It is a check of the slice outside Electron, and not the packaged run.
- The packaged run of FND-10: on the first commit, the integration test of its pull
  request,
  [run 42666045242](https://github.com/freelensapp/freelens-velero-extension/actions/runs/42666045242),
  green, FND-10 eight cases of eight in Freelens 2.0.0 on Linux ARM64; on the head:
  on a second Linux machine, in Freelens 2.0.0 built at the target with no
  cluster, eight cases of eight; on the hosted runner, the checks of its pull
  request, green before its merge.
- The gates of the slice, on its head: `pnpm type:check`, `pnpm lint:check`,
  `pnpm knip:check` and `pnpm build`, green; the unit files that hold or read its
  changes, `test/build.test.ts`, `test/environment.test.ts`,
  `src/entrypoints.test.ts`, `src/main/diagnostic-route.test.ts` and
  `src/main/ipc-download.test.ts`, 358 tests passed; Trunk on the changed files,
  green. The unit run of the head, `pnpm test:unit`, on the second machine: 134 files
  and 3,816 tests passed, and the three measures. The checks of its pull
  request, every part of the views among them, green before its merge.

Seven changes made on purpose, each one commit on the head on a branch of its own,
`mut-m6-route-1` to `mut-m6-route-7`, kept apart for the packaged runs, which the case
must see failing. The log of a packaged run shows the first assertion that fails, so
each change is named with the assertion the probe saw fail first, in the order of the
case:

- `mut-m6-route-1`, 198.18.0.0/15 counted as public: the refusal without the
  allowance, which is a direct route, with no allowance asked.
- `mut-m6-route-2`, the allowance of a private address ignored, the address refused
  whatever was allowed: the direct route with the allowance, which is the refusal.
- `mut-m6-route-3`, with the allowance, the store reached through the cluster, its
  Service read in the namespace of the installation, in place of directly: the
  direct route with the allowance, which is the refusal of the stand-in of the
  cluster, with its message.
- `mut-m6-route-4`, the refusal of a private address without what may be allowed:
  the refusal, with no `needs`, whose words are then "The address of the store is
  not one the extension connects to.".
- `mut-m6-route-5`, the address probed with a connection, closed before it is made,
  before the direct route is given: the connections recorded, one to
  198.18.250.10:9000, the only assertion it fails.
- `mut-m6-route-6`, the same probe asked at the next turn of the loop, once the
  direct route was given: the connections recorded, the same one, the only assertion
  it fails.
- `mut-m6-route-7`, a listener opened on the loopback and closed before the direct
  route is given: the listeners recorded, one on 127.0.0.1, the only assertion it
  fails, so that a server opened in the main process of the host is seen going
  through `net.Server.prototype.listen`.

The packaged runs of the seven branches, on the second machine in Freelens 2.0.0
with no cluster: each failed the new case alone, first at the assertion its line
names, and the seven other cases of FND-10 passed. On the first commit,
as its pull request records, in the packaged application on a second Linux machine
with no cluster, FND-10 passed on the head, eight cases of eight, and each of the
first five branches failed the new case alone, first at the assertion its line names,
the seven other cases passing. More changes, for the probe alone and with no branch,
were each seen failing first at the assertion named: the words of the allowance of a
private address without its origin and what may be allowed, the text of the words;
the failure of an allowance without its `needs`, and the words of `downloadFailureOf`
made without the `needs` of the error or at another step, what the failure carries;
the words with the folder of the file in the bucket, the words without the path; the
host of the URL resolved on this machine before its addresses are read, what the
route asked; the probe of the address asked at the next tick or 50 milliseconds after
the direct route, and a connection to the loopback asked at the next turn, found by
its stack alone, the connections recorded; and a resolution that never ends, the
direct route, which is the end of its eight seconds, the case ending in nine. A probe
asked half a second after the direct route was not seen: it is outside the window of
the case.

An independent review of the first commit, on 2026-11-09, found no blocker, no major,
three minors and five nits; the second commit takes them in. The minors: a connection
the route asked after it answered escaped the spies, which were put back in the
microtask after the second resolution; the window assumed that no code of the host
runs between the spies and their removal, which an evaluation that the inspector
starts inside a running task of the host breaks, so that a connection of the host
would fail the case and be closed by it, and a resolution that does not end would
leave the spies in the host after the case gave up; and the words were made in the
process of the test by a copy of `downloadFailureOf`, and not by the code that ships.
The nits: what is thrown that is not a `DiagnosticError` kept with its message, and
the label of a connection to a pipe; the sentence on the address, which now says what
holds, and the unit case of the environment; ARCHITECTURE.md brought along; the words
of the ceilings; and a branch that opens a listener.

Decided while implementing, on 2026-11-09:

- The address is 198.18.250.10, of 198.18.0.0/15: nothing of the tests listens there,
  and the runners do not route it. The environment of the tests takes its subnets from
  that range, and the unit case keeps the address outside every one of them.
- The URL is of HTTPS, so that the one allowance the route asks is the one of a
  private address: a URL of HTTP asks first the allowance of a connection that is not
  encrypted.
- The main bundle exports `downloadFailureOf` beside `resolveRoute`, as it exports
  `deleteRequestOf`, `deleteRequestText` and `expressionRefused` for the proofs: a
  function of an error and of the request it was for, which reaches nothing. The case
  gives it the very error `resolveRoute` threw, so that the class of the error is the
  one of the bundle, and the request of the views as the IPC gives it.
- The allowances of the cluster are a stand-in that answers as `isAllowed` of the
  store does for a private address, by its kind and its origin; the cluster, the
  resolver and kubectl are stand-ins that refuse what they are asked, since no
  cluster takes part in FND-10.
- Nothing connected is read on the classes of Node in the main process, since no
  store can count what is never sent to it: an address nothing listens on counts
  nothing, and a listener on it would be one beyond loopback. What is recorded is
  what the stack names the build of the extension in, with all its frames, and every
  connection to the address of the store, for a client whose connection the stack of
  the route does not reach. The folder of the build names the bundle, and the sources
  its map gives as well, so that a stack the host maps to the sources names it too.
  The spies stay a turn of the loop and a tenth of a second after the second
  resolution, and are put back however the case ends.
- The fifth, sixth and seventh branches close their socket or their server at once:
  Node makes the connection to an address at the next tick, and the server listens on
  the loopback, so nothing leaves the machine.
- The ceilings are one case that lists every file above its ceiling with its size and
  its ceiling, so that a change that passes two says both. Each is a quarter above the
  size, rounded up to the byte, with the size and the date beside it, and a ceiling is
  moved with its reason written in their place. The maps and what else the build
  writes have none: the host loads the three files alone.

T6.3, the second of its pull requests, on 2026-11-09: the rest of the README of
1.0.0 in the layout of the other extensions of the organization, Features and
Limits after Getting started, with what the section Safety said as the subsection
Write actions of Features. The branch starts from the one of the first pull
request of T6.3, which was not merged when this slice started, and was rebased on
its head at `08c9f01`, with its removals. Permissions, with
[#145](https://github.com/freelensapp/freelens-velero-extension/issues/145), is a
slice of its own: nothing of this slice links to it.

Decided by the lead maintainer on 2026-11-09: the README has the sections of the
other extensions, Overview, Requirements, Supported APIs, Permissions, Install,
Getting started, Features, Limits, Development, Build from the source and License,
and no other. REQ-300, the section Troubleshooting, and its check DOC-06 are not
taken: the section is not written, and what one of its entries would say that an
operator needs and no other section says is in Features or in Limits, as listed
below. REQ-298 is written in Features, as its subsection Write actions, which
DOC-04 reads. The amendments of the requirements this decision brings, REQ-298 and
REQ-300 with DOC-04 and DOC-06, the order of the sections the paragraph of the
Documentation gives, the words of the failures in the success criteria and in the
checklist of REL-03, and the words of the row of T6.3 in the roadmap, are made by
another pull request, with the ones of the decisions of the first pull request of
T6.3. The first commits of the branch wrote Troubleshooting, with a case that held
its quotes to the functions of the words, and two links to Permissions; its last
commit removes them.

The evidence, by check:

- The sections of the README of the branch, in their order: Overview, with
  Status; Requirements, with Compatibility; Supported APIs; Install; Getting
  started; Features; Limits; Development; Build from the source; License.
  Permissions comes after Supported APIs with #145.
- Features, each statement read in the spec that asks for it and in the code at the
  base of the branch:
  - the installations: the cluster that is opened and no other (REQ-013 of
    SPEC-0002); one installation read, several asked for with none chosen, one named
    when it cannot be found by looking (`selection` and `entry` of
    `src/common/discovery.ts`, REQ-015, REQ-016); the choice kept for each cluster
    across a restart (REQ-022 of SPEC-0002, REQ-314);
  - the Overview: REQ-093 to REQ-105 of SPEC-0008, its six families
    (`src/common/overview.ts`), its three windows (`src/common/window.ts`), and the
    band of the server of SPEC-0012;
  - the views of the ten kinds: the pages, the views over the lists and the ways
    between them of SPEC-0003, SPEC-0005, SPEC-0006, SPEC-0007 and SPEC-0014, the
    sections in the details of the host, a name that leads nowhere said with its
    reason, the phase and the failure as two facts, what is not reported
    (`NOT_REPORTED` of `src/common/operation-text.ts`), and the band of the volume
    operations of a backup and of a restore (`src/common/volume-band.ts`);
  - the workspace: REQ-138 to REQ-149 of SPEC-0011; the way a file comes from the
    store, through the cluster by a port-forward to its Pod when the URL names a
    Service of the cluster, and directly from this machine otherwise (REQ-128 and
    REQ-129 of SPEC-0010); a text saved for ten minutes at most (`savableUntil` of
    `src/common/artifact-text.ts`); a file the store does not have said by the
    phase (`missingFile`); the allowances of REQ-126, REQ-128, REQ-130 and REQ-132
    of SPEC-0010; and the request Velero removes about ten minutes after its URL
    (REQ-135, `wouldCreate`);
  - the server: REQ-152 to REQ-155 of SPEC-0012, and the wait of ten seconds
    (`serverStatusFailure` of `src/main/server-status.ts`);
  - the adherence: REQ-160 to REQ-171 of SPEC-0013;
  - Write actions: the writes off when Freelens starts and turned on for the
    installation that is selected, through a dialog that names it, its cluster and
    its context, and off when another installation is selected or the cluster is
    not connected (REQ-108 to REQ-111 and REQ-118 of SPEC-0009, REQ-201 of
    SPEC-0015, `writesDialogWords` of `src/renderer/components/target-bar.tsx`);
    the review of the exact request (REQ-246 of SPEC-0017, REQ-229 of SPEC-0016),
    and the request of a tab and of the band of the server shown before it is
    created (REQ-139 of SPEC-0011, REQ-152 of SPEC-0012); the six actions, each
    where REQ-252 puts it (REQ-244 to REQ-284 of SPEC-0017, REQ-221 to REQ-239 of
    SPEC-0016); the name of the backup typed for a restore and for a deletion
    (REQ-271, REQ-281); the deletion through one `DeleteBackupRequest` and never of
    the `Backup` (REQ-279, REQ-284); and the table of every write of the adapter
    and the three rules, as the section Safety wrote them (REQ-298).
- DOC-04: the case reads the subsection Write actions of Features in place of the
  section Safety, with the same assertions: a row for each write the adapter of
  the main process sends, read in `src/main/diagnostic-kubernetes.ts`, each POST a
  creation and the PATCH a patch, and for no other; the fields the patches of a
  pause and of a resume write; no other kind of Velero named in the subsection;
  and the three rules by their words (`test/documents.test.ts`).
- Limits, each with what records it: the synthetic objects and the platforms,
  Compatibility (REQ-299, D13); the drop of a tarball, the deviation of the first
  pull request of T6.3; what is not in 1.0.0, the roadmap under Deferred after
  v1.0.0, the exclusions of SPEC-0017, and the words of the fields the forms do not
  offer (`NOT_OFFERED` and `NOT_OFFERED_OF_A_SCHEDULE` of
  `src/common/backup-create-words.ts`, `NOT_OFFERED_OF_A_RESTORE` of
  `src/common/restore-create-words.ts`); the contents of a backup, REQ-120 of
  SPEC-0010; the bounds of a file and the two loads at a time, REQ-133 with the
  words of `payload-too-large` and of the step `queue`; TLS always verified,
  REQ-131, with the certificate of an authority in a Secret that
  `spec.objectStorage.caCertRef` names or in the inline `spec.objectStorage.caCert`,
  which the reviewed release keeps as the older form (`src/common/types.ts`); the
  zone of the server, REQ-162, REQ-165 and REQ-231; the plugin, REQ-126 with
  Compatibility; and a list said denied for a 401 as for a 403 (`failedStatus` of
  `src/common/read-state.ts`), where an action and a tab tell a credential the
  cluster did not take apart (REQ-249 of SPEC-0017, `downloadFailure` of
  `src/common/diagnostic-text.ts`).
- What the entries of Troubleshooting said that an operator needs and no other
  section says, moved: the way a file comes from the store, into the workspace of
  Features; how to give a storage location the certificate of its authority, into
  the limit of TLS; and a list said denied for a credential the cluster did not
  take, into a limit of its own. The rest went: the words of each failure, which
  the views and the tabs show; the verbs to grant, which Permissions lists; and
  what to look at for a store that does not answer, beside the way a file comes,
  which Features says.
- DOC-10: green. The README links to no anchor of Permissions, and Supported APIs
  links to Write actions.
- The plan of the views runs no part for the files of the slice (`partsToRun` of
  `e2e/scripts/views-plan.mts`), and they reach no end to end run.
- The gates of the slice, on its head: `pnpm type:check`, `pnpm lint:check`, with
  one information in a file the slice does not touch, `pnpm knip:check`, and Trunk
  on the changed files, green; `pnpm exec vitest run test/documents.test.ts`, 4
  cases of 4. The unit run of the head, with main merged, `pnpm test:unit`, on
  macOS with Node 24.21.0: 135 files and 3,820 tests passed, and the three
  measures. The checks of its pull request, green before its merge: the unit
  tests, the check, Trunk, the integration test and OSV-Scanner.
- An independent review of the accuracy of Features, Write actions and Limits
  against the code found eight statements to correct, none a blocker. Seven are
  corrected in the text: the direct way to the store, which is never an address
  of this machine, of the link or of a metadata service; what is allowed in a tab,
  kept after a restart until it is taken back; a `DownloadRequest` no server
  processes, which stays; the `ServerStatusRequest`, which stays until the server
  processes it; what Velero deletes with a backup, its restores included, which
  cannot be undone; the verification of TLS, never skipped; and the origin of a
  storage location of another plugin, which a tab always asks to allow. The
  eighth is of the code, not of the text: the band of the server says that the
  identity needs the verb create for a credential the cluster did not take as
  well, and this slice does not change it.

Seen failing, on changes made on purpose and put back each time, DOC-04 in its new
place, 11 in all, each failing the case alone but the heading renamed, which DOC-10
fails as well, by the link of Supported APIs: the row of the creation of a Restore
removed; a row of a write the adapter does not make; another kind of Velero named
in the subsection; the patch said of one field; each of the three rules reworded;
the subsection renamed; the subsection taken out of Features as a section of its
own; the table of the writes moved into Limits; and a creation of the adapter made
a PATCH in the code. Beside them, what the case must let pass passed: the cells of
the table aligned with spaces, and a rule wrapped at another place.

Decided while implementing, on 2026-11-09:

- Features and Limits come after Getting started, as the READMEs of the latest
  extensions of the organization have them. Write actions is the last subsection of
  Features, and the subsections Actions and Writes, off by default, which the first
  commits of the branch wrote, fold into it.
- The table of the writes and the three rules are the ones of the section Safety,
  with their link to AGENTS.md: DOC-04 reads them where they are now.
- The text of the slice names no product but Freelens, Velero, Kubernetes, npm and
  GitHub: Limits leads to Compatibility for the platforms.
- The row of T6.3 in the roadmap stays In PR.

T6.4 and T6.5, the release flow of the template, with the checks the amendments do
not take, on 2026-11-09: the version, tag and release workflows of the template of
the organization, the cases and the documents that described the ones before them,
and the restatement of this spec, of SPEC-0015 and of the roadmap, as the two
amendments of that day decide
([the release flow](#2026-11-09-the-release-flow-of-the-template),
[the checks](#2026-11-09-the-checks-beyond-the-other-extensions)). The evidence, by
check:

- The three workflows: `npm-version.yaml`, `tag.yaml` and `release.yaml` are the
  files of freelensapp/freelens-example-extension on its default branch, `main` at
  `e599f13f239bed97a8ded3c755bc5a4c5fe2d459`, read through the API of GitHub on
  2026-11-09, whose blobs are `f26a21bf`, `af6c46c0` and `c8533abf`: `cmp` of each
  with its file in this repository finds no difference. Against main before this
  change, `npm-version.yaml` and `release.yaml` moved their runner and the keys of
  their cache from `ubuntu-24.04-arm` to `ubuntu-26.04-arm`, and nothing else;
  `tag.yaml` is the one of the template again, which undoes the change of #151,
  the tag on the merge commit, the check of the author of `/tag` and the
  permissions of the token of the run, and moves its runner from `ubuntu-24.04` to
  `ubuntu-26.04-arm`.
- REL-05: the case "tags the merge commit of the pull request of the version, on
  its merge and on /tag from an owner, a member or a collaborator with write
  access", the 299 lines #151 added to `test/environment.test.ts`, is removed:
  each of its assertions pinned what the template does not have.
- The case of the tags, "tags X.Y.Z and its prereleases X.Y.Z-N, which the release
  publishes on next as prereleases, and X.Y.Z on latest", is changed in one
  assertion: of the versions it asks `tag.yaml` not to tag, `0.1.0-alpha.0`,
  `1.0.0-rc.1` and `1.0.0-1-2`, which only the form of T0.7 refused, are taken out,
  and `1.0.0-`, `1.0` and `v1.0.0`, which the expression of the template refuses as
  well, stay. The versions it asks to be tagged, the npm tag of the three
  publications and the prerelease of the GitHub release, which the template holds,
  are unchanged. With the expression of `tag.yaml` changed on purpose to take an
  empty prerelease, the case failed on `1.0.0-`; it passed once the file was put
  back, equal to the template's again under `cmp`.
- No other case reads the three workflows: under `test/` and `e2e/` they are named
  in `test/environment.test.ts` alone, and the case of the target, which reads
  every workflow, holds the ones that call the action that builds Freelens, which
  these three do not. No case is added.
- The documents: PROCESS.md, AGENTS.md and ARCHITECTURE.md say what the template
  does, the texts #151 changed back to their words of the approval with the form
  of a version the template tags; TESTING.md names none of the three workflows and
  is unchanged. The rows of T6.4 and T6.5 of the roadmap say what the template
  gives and what is left, T6.4 In PR with this change; the row of T6.1 is narrowed
  to the checks that stay, and what the amendments do not take is under Deferred
  after v1.0.0. SPEC-0015 records the form of the tag of the template in an
  amendment of its own.
- The gates of the change, on its head: `pnpm exec vitest run test/environment.test.ts test/build.test.ts test/documents.test.ts`,
  the files that read what it changes, 3 files and 289 tests passed, 273 of them
  in the first, one case fewer than before; `pnpm type:check`, `pnpm lint:check`
  and `pnpm knip:check`, green. Trunk on the changed files, green, with the
  definition of actionlint of the template taken in `.trunk/trunk.yaml`:
  actionlint 1.7.12, the version it pinned, does not know the label
  `ubuntu-26.04-arm` of the runner of the template and gave one issue of
  `actionlint/runner-label` on each of the three workflows; the template runs
  actionlint 1.17.0 from a maintained fork, whose Trunk Check on every file is
  green on `e599f13f`, and with it actionlint finds no issue in the seventeen
  workflows of this repository, while the label of the runner of `tag.yaml`,
  changed on purpose to one that does not exist, gave one issue of
  `actionlint/runner-label`. The unit run of the head, `pnpm test:unit`, on macOS
  with Node 24.21.0: 135 files and 3,817 tests passed, and the three measures.
  The checks of its pull request, green before its merge: the unit tests, the
  check, Trunk, the integration test and OSV-Scanner. Its files reach no part of
  the views and no end to end run.

Decided while implementing, on 2026-11-09:

- The rows of the requirements, the scenarios and the checks that are not taken
  stay, each with the words that it is not taken and a link to its amendment, so
  that their identifiers keep naming what they were; the text as approved is the
  one of this spec at `801dfc3`, which the amendments link.
- The definition of actionlint of the template is taken in `.trunk/trunk.yaml`,
  the version 1.17.0 from the fork the template downloads it from, since the three
  workflows of the template run on a runner the version pinned before does not
  know and Trunk Check is required on main; the rest of `.trunk/trunk.yaml` is
  unchanged.
- The case of the tags keeps the versions the template still refuses and loses the
  three only the form of T0.7 refused, rather than being removed whole, so that
  what the template holds stays checked.
- What follows from the amended requirements is rewritten in place where it states
  what is not taken: the scenarios 3, 6 and 7, REQ-309, the Safety of the Design,
  the layers of the new checks, the release flow, the rows of the amendments and
  of the files, the homes of the tests, the success criteria with the steps of
  ASSET-05 and of REL-04, D3, D4, D7, D10, D11a, D12, D15, D16, what T6.1 defers
  and the open questions. The rest of this spec is read with the amendments, as
  each of them says.
- The paragraph of the roadmap under the table of M6 is restated where it names
  what is not taken, the two jobs and what they made, the tag on the merge commit,
  the prerelease through the trusted publisher, the second cluster and the actions
  with the real controller, and keeps the rest, the prerelease 1.0.0-0 among it.

T6.2, the first of its pull requests, on 2026-11-09: the visual pass of REQ-292
stays the pre-review, and the views were fixed for what an accessibility scan found
the one time it ran. REQ-293 and REQ-294, with VIS-02 and VIS-03, are not taken,
decided by the lead maintainer on 2026-11-09: the pre-review stays the visual one of
the other extensions; the scan is not kept (D8). The evidence, by check:

- The scan that ran on 2026-11-09, which the pull request brought and then took
  away: axe-core 4.14.0, a devDependency at an exact version, loaded into the frame
  of the cluster by evaluating its file through the driver, since the
  Content-Security-Policy of the frame refuses a script written into its page; the
  rules of WCAG 2.1 at the levels A and AA by their tags, 62 rules, on the root of
  each view of the pre-review, in both themes at 1440 by 900 and at 900 by 650.
  - The first packaged run: the run 42650892637 of the views, of the pull request
    #156 at `b682b3e`, rebased on main at `b0607af`, the part `pre-review` red. It
    scanned 220 layouts of the 260, since a case that shows several views stopped at
    its first view with a violation, and found 492 violations, 428 of them failing.
    Of the extension, each failing: `color-contrast`, serious, 402, the links of
    `.link`, 170 buttons and 3 anchors, and the way back of a workspace, `.back`,
    58, in the light theme; the words of a status, `.statusText`, 151, 90 in the
    light theme and 61 in the dark one, the dark ones all the words of a failure; a
    `code` element, 17, and the words of a warning, `.warning`, 2, in the light
    theme; and the words of the row of a kind of resources, `.resourcesText`, 1, in
    the dark theme. `scrollable-region-focusable`, serious, 18: the text of the
    review of an action, `.reviewText`. `aria-required-children`, critical, 8: the
    list of the lines of a log, `.linesList`. Of the host, reported:
    `color-contrast`, serious, 36, the `primary` Button of the host, white on
    #00a7a0 in both themes, in nine views; `aria-required-children`, critical, 28,
    the virtual list of `KubeObjectListLayout`, in seven.
  - On the head with the fixes, `c7c82e6`: the run 42664477459 of the views, among
    the checks of #156, green. The 260 layouts were scanned, with no violation of
    the extension, and 120 of the host: `color-contrast`, serious, 40 on the
    `primary` Button in both themes, in eleven views, and 32 on the link of the host
    to the node of an operation, #00a7a0 on #ffffff, 2.98 to 1, in the cells of the
    lists of the pod volume backups, of the pod volume restores, of the data uploads
    and of the data downloads, in the light theme at 1440 by 900;
    `aria-required-children`, critical, 48 on the virtual list of
    `KubeObjectListLayout`, in twelve lists.
  - Seen failing, on a second machine on `c7c82e6`, the run
    `velero-out-20261109-182626`, with the file that broke three views on purpose,
    for their scan alone: 3 cases failed and 48 passed, the three that were broken,
    each by its rule on the element of its break, in the dark theme at 1440 by 900:
    `color-contrast`, serious, 1.42 to 1, on the name of the first backup of the
    list of the Backups; `button-name`, critical, on the way back of the workspace
    of a backup; and `label`, critical, on the first namespace of the form of
    Create backup. The unit run of `c7c82e6`, `pnpm test:unit`, on that machine:
    135 files and 3,831 tests.
  - The independent review of `c7c82e6` found the colors of the words undefined
    outside a page, where the sections of the details of the host and the error
    page are drawn, and below AA on the row of a dark list the pointer is on: both
    are fixed below. What it found of the scan went with the scan.

  Then the scan was taken away, with axe-core: the manifest and the lockfile are as
  on main, by `pnpm remove axe-core`, after which `pnpm install --frozen-lockfile`
  passed; its rule of Renovate, its two helpers and their unit cases, its report,
  the file of its exceptions and the breaks of VIS-02 in the pre-review, the cases
  of the build test for axe-core, and the scan in TESTING.md, AGENTS.md, TRY-IT.md
  and DEPENDENCY-AUDIT.md went with it. The pre-review is the visual one it was,
  with its 51 cases; the walk of a deletion reads the text of the request as the
  first stop after its review, which the region of the text makes.
- VIS-01, the visual pass (REQ-292): on the head, the part `pre-review` of the run
  of the views among the checks of its pull request, green before its merge, with
  its report and its gallery. The run the review of the milestone reads is the one on the
  release candidate, a later commit of main, as amended on 2026-11-09
  ([the amendment](#2026-11-09-no-prerelease-before-100)).
- The fixes, each read by a unit or a component test:
  - the colors of the words ([`views.module.test.ts`](../../src/renderer/components/views.module.test.ts),
    4 cases): the words of a link, a success, a warning and a failure, defined once
    on the body, which the pages, the sections of the details of the host and the
    error page are all under, and in no other block; at 4.5 to 1 or more in both
    themes on the background of the page, of a list, of the target bar, of the rows
    of a kind of resources, of a field and of the row of a list the pointer is on or
    that is selected, from the values of the two themes of the host at the target;
    no words written in a semantic color of the host but through them, any of its
    seven, whatever follows the value; and a code element in the light theme, and
    the rows of a kind of resources in both, at the same ratio, the color of the
    words read and never a `background-color`;
  - the text of a review: the component test of each of the six workspaces finds it
    by its role, a region, and its name, What is sent, as it is sent, and as a stop
    of the Tab key; the pre-review reads it as the first stop after the review of a
    deletion, and the field of the name as the second;
  - the lines of a log: the component tests of the lines and of the log read the
    group that is the stop of the Tab key, with its name, and the part that scrolls
    as the list of the rows, with nothing between them, out of the order of the Tab
    key.
- The fixes in a browser, by probes not kept in the repository, in a headless
  Chromium: the built stylesheet under the variables of each theme of the host, on
  the backgrounds the views use, the row the pointer is on among them, where
  axe-core found no word below AA in either theme. It measured the links at #0c7874
  in the light theme and at #33b9b3 in the dark one, the successes at #337b36 and
  #65ba69, the warnings at #976110 and #ff9800, the failures at #c73832 and #e4928f,
  the code of the light theme at #555555 and the rows of a kind of resources at
  #909ba6 in the dark one. The words of a failure in a section of the details, in
  the drawer of the host, and the message of the error page took the color of a
  failure in both themes, and the grey around them with the colors defined on the
  page alone, as the head of the review had them. On the markup the lines had, a
  list around the part that scrolls, axe-core said `Element has children which are
  not allowed: div[tabindex]`, the words of the first run; on the group around the
  list it said nothing, nor of the text of a review as a region with its name and
  its stop.
- Seen failing, each change made on purpose and put back:
  - the colors of the words, 16 changes, each of the 4 cases at least once: the
    links of the light theme and the failures of the dark one mixed with too little
    of the accent, the warnings of the light theme left as the host writes them, the
    color of the successes no longer defined, a link written in the primary color of
    the host, a code element of the light theme below AA, and the rows of a kind of
    resources in the words of the page; the colors defined on the page again, the
    light ones on the body of either theme, and a color defined again on the message
    of an error; the links, the successes and the failures of the dark theme as the
    head of the review had them, below AA on the row the pointer is on; and the
    words of a status in the info color of the host with `!important`, and in its
    soft error, which the earlier reading let through, and the color of a kind
    written after a `background-color`, which the earlier reading took for the
    background;
  - the text of a review, 3 changes, its role, its stop of the Tab key and its name
    each taken away, each failing the 6 workspaces;
  - the lines of a log, 3 changes: the group a list again, the role of a list taken
    from the part that scrolls, and the part that scrolls a stop of the Tab key.
- The gates of the slice, on its head: `pnpm type:check`, `pnpm lint:check`,
  `pnpm knip:check` and `pnpm build`, green; the unit files that hold or read its
  changes, 23 files and 698 tests passed: `test/environment.test.ts`,
  `test/build.test.ts`, `test/views-plan.test.ts` and `test/host-stub.test.ts`; the
  tests of the stylesheet, of the lines, of the log, of the panel and of the
  viewers of a tab, and of the workspace; the tests of the tabs, of the volumes and
  of the six workspaces of the actions. Trunk on the changed files, green. The unit
  run of the head, with main merged, `pnpm test:unit`, on macOS with Node 24.21.0:
  135 files and 3,823 tests passed, and the three measures. The checks of its pull
  request, green before its merge: the unit tests, the check, Trunk, the
  integration test, OSV-Scanner and the five parts of the views its files reach,
  by the stylesheet and the components of the views: `actions`, `artifacts`,
  `pre-review`, `static-views-1` and `static-views-2`. They reach no end to end
  run, which builds no file of the renderer.

Decided while implementing, on 2026-11-09:

- The colors of the words: each fix is in the stylesheet and the markup of the
  extension. The words of a link, a success, a warning and a failure are defined
  once, `--veleroTextLink`, `--veleroTextOk`, `--veleroTextWarning` and
  `--veleroTextError`, from the colors of the host they used, on the body, which the
  pages, the sections of the details of the host, drawn in its drawer outside any
  page, and the error page, drawn in place of either, are all under. The host sets
  the colors of its theme on the root of the document and gives the body the flag of
  the light theme, `body.theme-light`, for the styles of components
  (`apply-lens-theme.injectable.ts`, lines 27 and 31, at the target): the values of
  the light theme are written under the flag. A color of the host that does not
  reach 4.5 to 1 on every background the views write words on, the page, a list,
  the target bar, the rows of a kind of resources, a field and the row of a list
  the pointer is on or that is selected, `--tableBgcSelected` (`table/table.scss`,
  lines 30 to 35), is mixed with the strongest words of its theme,
  `--textColorAccent`, by the least share that reaches it with a margin of a tenth,
  which keeps its hue. In the dark theme the links go from #00a7a0 to #33b9b3, 20
  parts of the accent, the successes from #4caf50 to #65ba69, 14, and the failures
  from #ce3933 to #e4928f, 45; in the light theme the links go to #0c7874, 35
  parts, the successes from #399c3d to #337b36, 27, the warnings from #ff9800 to
  #976110, 47, and the failures to #c73832, 4; the warnings of the dark theme are
  the color of the host. A code element of the light theme is written in the words
  of the page, #555555, where the host writes #b4b5b4 in both themes; the rows of a
  kind of resources take the third grey of the host, #909ba6 in the dark theme,
  4.88 to 1 on the stripe of a table. What is not a word keeps the colors of the
  host: borders, outlines, the bar of a progress and the marks. DESIGN.md says the
  rule.
- The text of a review is a region the Tab key reaches whatever its length, named by
  its title, one part of the six workspaces; a review whose text does not scroll has
  one stop more. SPEC-0017 records it among its amendments, and its evidence of T4.6
  points to it.
- The lines of a log are a group, the stop of the Tab key with the name and the
  keys, and in it the list, which is the part that scrolls, with the role
  react-window writes on it; the keyboard does not change. SPEC-0011 records it
  among its amendments.

T6.1 and T6.3, the roles of the README proven both ways (REQ-288, with REQ-297 and
[#145](https://github.com/freelensapp/freelens-velero-extension/issues/145)), on
2026-11-09: two identities of the test environment hold the two roles of the
README; the session of the extension runs as the operator in the proof of the
download through the cluster, with its request of the version of the server, and in
the proofs of the actions; the reader runs a part of the restricted suite; the
README has its section Permissions, with the table of what each feature asks and the
two roles, and the sentence of Requirements that REQ-296 left for it; and the case of
DOC-03 keeps the README and the identities equal. Every request the code makes, by
its group, its resource, its verb and its scope, with the line of the code and the
requirement that asks for it, is listed in the pull request, as #145 asks, and not
in the README. The evidence, by check:

- REG-04, the identities. `readmeIdentity` of
  [`local-fixtures.mts`](../../e2e/scripts/local-fixtures.mts) makes the reader or
  the operator of a run: a service account of the namespace of an installation, the
  Role of that namespace with the rules of its role, `ROLE_RULES`, and the
  ClusterRole with `CLUSTER_RULES`, each bound to the account alone, all with the
  labels of the run. The reader lists the ten families of the installation, and the
  case checks them against the plurals the views read (`src/common/discovery.ts`);
  both list the storage locations of the whole cluster, the one path of the whole
  cluster the views ask (`PATHS.locations`). The operator reads by name, lists,
  creates and patches what the main process does: every write of the adapter of the
  main process, read in its source as the case of DOC-04 reads it, the creations of
  a `DownloadRequest`, a `ServerStatusRequest`, a `Backup`, a `Schedule`, a
  `Restore` and a `DeleteBackupRequest` and the patch of a `Schedule`, is a grant of
  the operator and of no rule of the reader. Neither role has a verb the code does
  not send, `watch` among them, nor a Secret, nor a word that names them all
  (`test/environment.test.ts`).
- REG-04, the end to end layer, for the coordinator's runs. The transport proof
  applies the operator in the namespace of the installation, with a credential of
  two hours, and its context holds the kubeconfig of the operator for the session
  and the kubeconfig of the environment for the kubectl of the proofs, which reads
  the metrics, the ConfigMaps and the namespace of a restore, makes the backups of
  the proof of a deletion, changes a schedule as another hand, and deletes. The
  proof adapter of a proof reads what the session created with the kubeconfig of the
  operator, which the role allows; its teardown, a backup removed through a
  `DeleteBackupRequest` as the extension writes it and read until it is gone, runs
  with the kubeconfig of the environment, so that it does not depend on the role the
  run proves. The proof over HTTP asks the version of the server as a frame does,
  through the procedures and the gate, beside the request it makes with a generated
  name. The modes over TLS and the direct mode keep the kubeconfig of the
  environment. `pnpm e2e` on the environment of the demo: green on a second Linux
  machine, with the line of the operator, at the head before the review in 739 s and
  at the head after it in 639 s, and in the end to end run of its pull request. The
  runner of the suites applies the reader in the installation of the views and gives
  its kubeconfig in `E2E_README_READER_KUBECONFIG`; the restricted suite starts an
  application of its own with it, in the part `static-views-1`: every namespace that
  holds a storage location suggested, the ten lists of the installation with their
  rows and nothing denied, the six cells of the Overview read; Back up now ends as
  forbidden at the read of the schedule, before any review, with the words of
  `BACKUP_NOW_WORDS.forbiddenRead`, and Pause at the patch, with the words of
  `SCHEDULE_PATCH_WORDS.forbidden`; writes stay on, no backup of the name is there,
  the schedule keeps its UID and its version, and the API server counts no write of
  any kind of Velero: on a second Linux machine at the head before the review, the
  two restricted suites passed 23 cases of 23, and on the head the part
  `static-views-1` of the views of its pull request passed. Each identity is removed
  with its run, its ClusterRole and its binding by the paths of the whole cluster
  (`accountPath`); the transport proof removes its identities first in its cleanup,
  before it restores the store, and a removal that fails is said at once and fails
  the run once the rest of the cleanup ran, unless a proof failed before it.
- DOC-03: the case "shows in Permissions the two roles the identities of the test
  environment hold, text for text as the fixtures render them"
  (`test/documents.test.ts`) renders the Role and the ClusterRole of each identity
  with `rolesAsWritten`, under the names and the namespace the README gives them,
  and compares the text with the two YAML blocks of the section, each under its own
  heading; nothing parses the YAML of the README. Each row of the table checked with
  `kubectl auth can-i`, granted and one verb not granted, for both identities, with
  the commands of the pull request: 71 checks, 42 granted and 29 refused, each as
  the table says, on a second Linux machine at the head before the review, whose
  roles the review did not change.
- DOC-02: the case of Requirements finds the sentence of the identity, a link to
  Permissions; DOC-10 resolves its anchor.
- The unit run of the head, `pnpm test:unit`, on a second machine: 135 files and
  3,825 tests passed at the head before the review, and 3,823 at the head after it,
  and the three measures; with main merged, on macOS with Node 24.21.0, 135 files
  and 3,828 tests passed, and the three measures.

Seen failing, on changes made on purpose and put back each time, 47 in all, each
failing its case: DOC-03 on a family left out of the reader of the README, a verb
added to the operator of the README, a verb added to the operator of the fixtures
and to their ClusterRole, a third YAML block in the section, each heading renamed,
the verbs written otherwise by the rendering, the namespace of the README changed,
and the two blocks in the other order; DOC-02 on the sentence of the identity
without its link; the case of the identities on an identity that shares the rules of
its role or of the cluster, the reader without a family, the operator without the
patch, the reader given the creation, the binding of the ClusterRole to another
account, the operator given `watch` and given a Secret, any namespace taken, and the
adapter patching another kind; the case of the rendering on the ClusterRole first,
no separator, any word, a role with no rule, an empty list, an empty resource, two
Roles and the namespace of the Role left out; the case of the paths on a
ClusterRole with a namespace, another kind, any name, any namespace and a binding
removed as a role; the case of the wiring on the session of the proofs and the proof
over HTTP given the kubeconfig of the environment, the modes over TLS given the
operator, the kubectl of each of the three proofs given the operator, the version of
the server not asked through the procedures, the operator not applied and its
kubeconfig left in the state, the reader in another namespace, not given to the
suites, not removed, and the restricted suite started as the reader of a part.

The changes the packaged runs and the end to end runs must see failing are one
commit each on the head, on branches of their own, for the coordinator: the reader
given `get` on `schedules`, `mut-m6-identities-1`, which shows the review of Back up
now and fails the case of the two writes; the reader given `patch` on `schedules`,
`mut-m6-identities-2`, which pauses the schedule; the reader without `list` on
`datadownloads`, `mut-m6-identities-3`, and without the ClusterRole of the storage
locations, `mut-m6-identities-4`, which fail the case of the views; and the operator
without `create` on `backups`, `mut-m6-identities-5`, without `patch` on
`schedules`, `mut-m6-identities-6`, without `create` on `pods/portforward`,
`mut-m6-identities-7`, and without `create` on `serverstatusrequests`,
`mut-m6-identities-8`, which fail `pnpm e2e` at the proof of Back up now, of the
pause, of the download over HTTP and of its request of the version of the server.
Each changes the fixtures alone, so DOC-03 fails on it as well: on a second Linux
machine, the branches 1 to 4, on the restricted suites, failed 1, 3, 1 and 2 cases
of 23, the cases from before the slice passing; the branches 5 to 8, made again on
the head after the review, each failed `pnpm e2e` at its proof, Back up now refused
at the creation, the pause refused at the patch, the download refused at the
port-forward, and the request of the version of the server refused, with the cleanup
of the fixtures passed after the failure and no identity left.

Decided while implementing, on 2026-11-09:

- The reader has `list` alone: the views list each family and read no object by its
  name, and never watch. The operator has `get`, `list`, `create` and `patch` where
  the code sends them, and no `watch`, `update` or `delete`; its rules are grouped
  by the verbs of each resource, nine in all. Both ClusterRoles hold the one list of
  the whole cluster. The roles grant `get` and `list` on `deletebackuprequests` and
  the list of the storage locations of the whole cluster, which the README calls
  optional with what goes without them.
- `get` on `secrets` is not in the role of the actions: it is needed only for a
  storage location whose certificate authority is in a Secret, and is granted for
  that Secret alone, by its name, which the README says. The mode of a referenced
  authority stays proven with the kubeconfig of the environment, as the decision of
  what T6.1 defers says of it. `get` on `pods/portforward` is not in the role
  either: the kubectl of the host falls back to `create`, and the README says what
  granting `get` changes.
- The identities are made by the runner for its run, the operator by the transport
  proof and the reader by the runner of the suites, and removed when it ends, as the
  identity of the views that may not port-forward is: their ClusterRole and its
  binding are of the whole cluster, which no removal of the namespaces of a run
  reaches. The removal of the accounts of a run takes each by the path of its kind,
  of its namespace or of the whole cluster.
- The README names the roles `freelens-velero-reader` and `freelens-velero-operator`
  and the namespace `velero`, the one of `velero install`; the identities of the
  environment are named by the run and bound in its namespaces. The rendering takes
  the rules from the identity, and the names and the namespace from the README.
- The session of the extension is the procedures, the client of the host they use
  and the tunnel; the reads of a proof that check what the session created stay on
  the kubeconfig of the operator, since they are in the role. The kubectl of the
  proofs goes through the kubeconfig of the environment, which the context of a
  proof holds as `environment`, and so, after the independent review, does the
  teardown of the proofs of the actions: the `DeleteBackupRequest` of a backup they
  made, sent as the extension writes it by an adapter of the environment, and the
  reads that wait for the backup to go.
- "The restricted suite of the views passes" with the reader is a second describe of
  `velero-e2e-restricted.tests.ts`, with an application started with the kubeconfig
  of the reader alone: the cases of the first describe prove what an identity that
  reads a part is shown, which a reader of every family cannot see, and stay as
  they are.
- The creation of a Backup the reader is refused is Back up now, in the view of the
  schedule with a history of the installation of the views: its confirmation reads
  the schedule by its name, the first step whose verb, `get`, the role lacks, so the
  refusal comes at the read and before any review. The refusal of the POST itself
  stays proven by the reader of a part in the suite of the actions, which reads what
  the confirmation reads.
- SPEC-0004 writes no identity: the amendment of the identities is the one of
  TESTING.md, which this slice restates; REQ-287, whose second cluster would have
  amended SPEC-0004, is not taken.

An independent review of the head of the slice, on 2026-11-09, found no blocker, one
major, three minors and seven nits. Taken in, as fixes of defects: the major, the
route of a download through the cluster for a host of one label or two, which the
section Permissions now says is looked for as a Service first, with `get` on
services asked in the namespace its second label names or in the one of the
installation, whatever the store is, and the way to reach a store outside the
cluster named that way, as SPEC-0010 says of REQ-129; the identities removed first
in the cleanup of the transport proof; the teardown of the proofs of the actions
with the kubeconfig of the environment; and four nits of the README, of TESTING.md
and of the restricted suite: the three forms that use the namespaces Freelens lists
and what goes without them, the reads after an action said optional with what goes
without them, what goes without the read of the snapshot locations, and the reader
said refused at the read of the schedule, before any creation. Left as observations
for the lead maintainer, as the rule of the lead maintainer of 2026-11-09 asks of a
proposal of a new check or of a hardening: a case that reads the table of
Permissions against the roles, which DOC-03 does not read; a rendering that refuses a
rule with keys other than its groups, its resources and its verbs; the absence of
the backup of the reader told by NotFound rather than by a status other than zero;
and the mode over TLS with an inline authority run as the operator. The changes seen
failing were made again on the head after the review, and the eight branches of one
change are on that head.

T6.3, the third of its pull requests, on 2026-11-09: the screenshots and the video
of the README (REQ-301, REQ-302), made again after the fixes of T6.2 with the
storyboard the lead maintainer approved that day, and the Status of 1.0.0
(REQ-296, as amended). The evidence, by check:

- The video: 57.47 seconds, H.264, 1920 by 1200, 30 frames a second, recorded from
  the packaged Freelens 2.0.0 for Linux on the disposable kind cluster of the demo,
  with the real server of Velero v1.18.4 and its AWS plugin v1.14.4, the extension
  built from `fdc1400`, whose tree is the one of main after T6.2. Its scenes: the
  title; the Overview with writes off, then the dialog that turns them on; the
  version of the server and its plugins through a reviewed ServerStatusRequest; a
  backup with its log loaded through a reviewed DownloadRequest and searched, then
  its resources; a restore into another namespace confirmed by the name of the
  backup; the adherence of a schedule with its history; Back up now with its
  review; the lists of the storage locations, the backup repositories and the data
  uploads; the end card. The README links to it, uploaded to GitHub as
  [its asset](https://github.com/user-attachments/assets/8a051d10-b46b-4ae6-ad96-2460de4464b5),
  whose media data are the ones of the file recorded, byte for byte: the upload
  adds a box of metadata of 5,893 bytes before them. It is not in the package,
  whose files are `dist/**/*`.
- The screenshots: six PNG files of 2880 by 1800 under `docs/screenshots/`, taken
  in the same session in a new profile: the Overview, the list of the Backups, the
  workspace of a backup with its log, the adherence of a schedule and the review of
  a restore, in the dark theme, and the Overview in the light theme, each with the
  text of what it shows. DOC-10 resolves each file; none is in the package.
- What the frames show of the environment: the cluster under the plain name
  `prod-eu-1`, the installation `velero`, namespaces of applications with
  realistic names, and the address of the store of the demo inside the cluster; no
  name of a person, no host of a real environment and no credential. The history
  of the schedules and the data uploads are objects of the test with realistic
  names; the backups of the day, the backup of the volumes with its repositories,
  the restore and the backup of Back up now were made by the real server.
- DOC-07 and DOC-08: each screenshot and every frame looked at by the lead
  maintainer at REL-03, on 2026-11-10, on a private page with the video and the
  six files; the length under 60 seconds.

Decided while implementing, on 2026-11-09:

- The screenshots are taken by the recorder of the video, in the same session and
  on the same cluster, as for the other extensions of the organization, not by the
  pre-review, which keeps its gallery for the review of the milestone: REQ-301 is
  read with it.
- The storyboard of the second take, approved by the lead maintainer on
  2026-11-09, shows beside what REQ-302 asks the writes turned on through their
  dialog, the server, the resources of a backup and the lists of three more kinds.
- Status gives way to the Status of 1.0.0 in this pull request, right before the
  one of the version, as REQ-296 says.

With this pull request as well, on 2026-11-10: the drift watch read again before
1.0.0, with nothing moved
([RECON-T0.1](../development/RECON-T0.1.md#before-100-2026-11-10)); and the
amendments of two decisions of 2026-11-09 that the spec did not say yet,
[the environment of the template](#2026-11-09-the-environment-of-the-template)
and [the sections of the other extensions](#2026-11-09-the-sections-of-the-other-extensions),
the second left to another pull request by the evidence of the second pull
request of T6.3.

The review of the sixth milestone (REQ-312, REL-03), on 2026-11-10: the lead
maintainer approved it, on the gallery of the pre-review of the release candidate,
the commit `854910e` of main, from the views of its push
([run 42699473749](https://github.com/freelensapp/freelens-velero-extension/actions/runs/42699473749)):
65 views in both themes, at 1440 by 900, at 900 by 650 and at twice the zoom,
390 screenshots, and no finding of the check of the layout; and on a private page
with the video, the six screenshots, the notes of 1.0.0 and the README of this
pull request as GitHub renders it. Decided by the lead maintainer on 2026-11-10:
the walk of TRY-IT by hand is not made, since the gallery is that walk, made by
the pre-review, which installs the extension packed from the release candidate
from its tarball, through the Extensions page as TRY-IT does, on the environment
of the demo. The checklist, by check:

- DOC-01: Install names `@freelensapp/velero-extension`, as `package.json` does,
  a version after the name, the tarball of a release by its URL or its path, and
  a directory, and no tag `next`; each way to 1.0.0 is tried at REL-02 and REL-04.
- DOC-07: each screenshot looked at, with its text; DOC-10 resolves each file
  under `docs/screenshots/`.
- DOC-08: the video, 57.47 seconds, every frame looked at; the link of the README
  LINK-CHECK-TO-FILL.
- DOC-10: the external links of the README opened on 2026-11-10, each answering,
  but DeepWiki, which answers 429 to a client that is not a browser, and the page
  of the package on npm, which answers 403 to one, and has no version to show
  before 1.0.0.
- DOC-06 is not taken, with REQ-300
  ([the amendment](#2026-11-09-the-sections-of-the-other-extensions)).

No finding, and no issue. The rows of T6.1, T6.2 and T6.3 of the roadmap are Done
with this pull request, the last of each. Decided while implementing, on
2026-11-10: with no prerelease, the proof of the assets of T6.4 (REQ-309) is made
on 1.0.0 itself, so D18 reads T6.4 as what gates 1.0.0 in D15, all in place on
main: the release workflow of the template, the bill of materials of REQ-307, the
provenance of REQ-308 and the token of the first step of D11b. Its row stays In PR
until the proof, which REQ-313 counts among the checks of this milestone that
1.0.0 may wait for; read otherwise, 1.0.0 would wait for itself, which D18 does
not take.

## Amendments

### 2026-11-09: The Release Flow Of The Template

Decided by the lead maintainer on 2026-11-09: the version, tag and release
workflows are the template's of the organization; what the requirements below
asked beyond it is not taken. The release of this extension is the one of
freelensapp/freelens-example-extension, like the one of every other extension of
the organization, and nothing beyond it is done now. Decided by the lead
maintainer the same day: the README follows the template too, with no
`CHANGELOG.md` and no Verify a release.

`npm-version.yaml`, `tag.yaml` and `release.yaml` are the files of the template on
its default branch, byte for byte, and [the release flow](#the-release-flow) says
what they do. The requirements, in the places above:

- REQ-286 is taken in its first half alone, the composite action that builds
  Freelens for the integration test and the views, on main since #152. The two
  jobs of the release workflow, FND-10 on the file it publishes and its runs on a
  pull request and by hand are not taken, and G1.1 is deferred; scenario 7 is not
  taken, and REG-02 is the part of the target alone.
- REQ-303 is not taken as written: the notes of each version are written in the
  body of its GitHub release, as the other extensions of the organization write
  them, with no `CHANGELOG.md` and no case of them; DOC-09 goes, and D12 with it.
- REQ-305, the case of #144 that pinned the assets in `release.yaml`, is not
  taken, with ASSET-01.
- REQ-306 is not taken: the README installs a release tarball as the one of the
  template does, and Freelens checks the tarball against the `.sha256` beside it
  itself; ASSET-02 goes, and scenario 3 says so. With REQ-305, #144 is not taken.
- REQ-307: the bill of materials is the template's, of the repository at the tag,
  and the one of the packed file is not taken (D10); ASSET-03 is read on the
  release.
- REQ-308 with D11a: the template asks for the provenance only through the
  trusted publisher, so 1.0.0, published with the token, carries none, and the
  versions published through the trusted publisher after it carry it; ASSET-04
  reads both on the registry.
- REQ-315: the tag is the one of the template, on main as the tag workflow finds
  it, of `X.Y.Z` or of `X.Y.Z-` followed by letters, digits, dots and hyphens. The
  change of #151, the tag on the merge commit, the check of the author of `/tag`
  and the permissions of the token of the run, is undone, with the case of REL-05
  it added; REL-05 is the case of the tags and REL-01.
- REQ-316, the list of the contents and the notice, is not taken, with ASSET-06.
- REQ-309 and the steps of ASSET-05 and of REL-04 read the assets of the template.

The rest of this spec is read with the amendment, and is not changed by it. Where
it names the job `package`, the job `publish` or the two jobs, it reads the one
job of the release workflow. Where it names the merge commit of the pull request
of the version as the commit of the tag (REQ-285, REQ-310, REG-01, REL-01, D11b,
the way back), it reads main as the tag workflow finds it at that merge. Where it
names `CHANGELOG.md`, the notes of a version in it, Verify a release or a download
checked as the README says (the Documentation of T6.3, REQ-295, REQ-304, DOC-10,
REQ-310), it reads the body of the GitHub release and the check Freelens makes of
a release tarball, and REQ-304 and DOC-10 read the README alone. The Scope
Baseline reads #144 as not taken. The token of D11b is the one REQ-308 names for
1.0.0, and its fifth step, a prerelease through the trusted publisher before
1.0.0, is not taken. The decision of the same day that there is no prerelease and
that 1.0.0 is the first publication, which the evidence of T6.3 records, is not
restated by this amendment: the places that plan a prerelease before 1.0.0,
among them REQ-295, REQ-296, REQ-309 to REQ-311, REQ-313, the steps of ASSET-05
and the prereleases of D15, keep it, until
[the amendment of no prerelease](#2026-11-09-no-prerelease-before-100) restates them.
The text as approved is the one of this
spec at
[`801dfc3`](https://github.com/freelensapp/freelens-velero-extension/blob/801dfc3c62d6fc97557c56e45388efe325185c84/docs/specs/SPEC-0018-release-readiness.md).

### 2026-11-09: The Checks Beyond The Other Extensions

Decided by the lead maintainer on 2026-11-09: the checks that go beyond the other
extensions and were not made are not taken; the ones made, the HTTPS and the
direct route of FND-10, the ceilings of the bundles and the identities of the
roles, stay. In the places above:

- REQ-287 and REQ-314, the second cluster of the environment and two clusters at
  once in one packaged Freelens, are not taken, with REG-03, REG-08, scenario 6
  and D4: the gate of each frame and the count of the writes between frames stay
  proven by the second entry of SPEC-0009, and SPEC-0004 keeps its one kind
  cluster. G4.1 and G4.4 are deferred.
- REQ-291, Back up now and Delete backup with the real controller in the packaged
  application, is not taken, with REG-07 and D7: each action keeps its proof in
  `pnpm e2e` against the server of the release and its cases on the CRDs alone.
  G3.2 and the second part of G3.1 are deferred.
- REQ-288, REQ-289, REQ-290 and REQ-317 stay.
- Restated with them: the Safety of the Design, the layers of the new checks under
  the table of where each check runs, the rows of the amendments of SPEC-0004,
  SPEC-0009, TESTING.md and the roadmap, the files and the homes of the tests, the
  success criteria, D15 with its order, D16 and what T6.1 defers. The row of T6.1
  in the roadmap is narrowed to the checks that stay, and what this amendment does
  not take is under Deferred after v1.0.0.

The rest of this spec is read with the amendment: the Scope Baseline reads the
second part of G3.1 as deferred.

### 2026-11-09: No Prerelease Before 1.0.0

Decided by the lead maintainer on 2026-11-09: there is no prerelease, and 1.0.0
is the first publication, made once the rest of the milestone is done, as the
evidence of T6.3 records. Nothing is published before 1.0.0, and until it is
published the README says to install the extension from the source. What a
prerelease was for is made on 1.0.0 where it still applies, in the places above:

- REQ-310, the first publication, is 1.0.0 through the flow of the template, with
  the drift watch read and recorded in RECON-T0.1 before the first release, as
  its entry of 2026-11-09 is, and read again before 1.0.0 (REQ-313). 1.0.0-0 on
  `next`, and a change of the code released as 1.0.0-N, are not taken.
- REQ-309, the proof of the assets, is made on the GitHub release of 1.0.0, which
  is not a prerelease, and the steps of ASSET-05 name 1.0.0: `latest` names it,
  and `next` names nothing.
- REQ-311, the check by version in the release Freelens 2.0.0 on macOS, with
  REL-02 and D14, is made on 1.0.0 once it is published.
- REQ-295 and DOC-01: Installation names no tag `next`, which 1.0.0 does not use.
  HOST-21 of SPEC-0015 is read on 1.0.0, its tag, `latest` naming it, `next`
  naming nothing and its GitHub release not a prerelease, in the row of the
  amendments of SPEC-0015 and in an amendment of SPEC-0015 of its own.
- REQ-296: Status says that 1.0.0, the first release, is being prepared, and that
  until it is published the extension is installed from the source; it gives way
  to the Status of 1.0.0 right before the pull request of its version.
- REQ-292, VIS-01 and REQ-312: the pre-review and the review of the milestone read
  the release candidate, a commit of main, and the walk of TRY-IT installs the
  extension packed from it, as TRY-IT does; a blocking finding is fixed on main
  before 1.0.0, which REQ-311 checks.
- REQ-313 and REL-04: 1.0.0 is installed by name in a new profile. The install
  over the last prerelease, with its preferences kept, is not taken, since no
  version comes before 1.0.0; with G2.3, it waits for a second released version.
- D11b: the token is made for 1.0.0 and revoked once 1.0.0 is published, and the
  trusted publisher is configured after it; its fifth step stays not taken. D15:
  what gated 1.0.0-0 gates 1.0.0, and the prereleases the lead maintainer could
  ask for early are not taken. The way back: there is no 1.0.0-N, and `latest`
  has no earlier version to be moved back to while 1.0.0 is the only one.
- Restated with them: the Goal, the Scope Baseline, scenarios 1 and 2, the
  dependency on D10 of SPEC-0015, the release flow, the row of RECON-T0.1 among
  the amendments, the success criteria with the steps of ASSET-05 and of REL-04,
  G2.3 of what T6.1 defers, and the first two open questions, of which this
  amendment closes the first.

What the prerelease was to prove first, the release workflow and the page of the
package, is proven on 1.0.0 itself, as D15 now says: a mistake in them is
answered by [the way back](#the-way-back), 1.0.1 through the same flow.

The rest of this spec is read with the amendment, and is not changed by it.
Where it plans the first prerelease or 1.0.0-0, it reads 1.0.0. The release flow
keeps what the workflows of the template do with a version with a hyphen, and
none is made before 1.0.0; the ways not taken of D17 and D19 keep their words of
the approval; and the evidence of the slices keeps what they planned when they
were written. The text as approved is the one of this spec at
[`801dfc3`](https://github.com/freelensapp/freelens-velero-extension/blob/801dfc3c62d6fc97557c56e45388efe325185c84/docs/specs/SPEC-0018-release-readiness.md),
and the text this amendment changes, with the two amendments before it, the one
at [`fe34704`](https://github.com/freelensapp/freelens-velero-extension/blob/fe347048c8e19dd5aba3a2a6552f41f5ff144f30/docs/specs/SPEC-0018-release-readiness.md).

### 2026-11-09: The Environment Of The Template

Decided by the lead maintainer on 2026-11-09, and recorded on 2026-11-10: the
settings of the repository are the ones of the template of the organization,
and the environment `publishing` with them, as it was read on both days: its
deployment policies are the tags `v*` and the branches `publish/v*`, and it has
no required reviewer and no wait timer. The secret `NPM_TOKEN` of the first step
of D11b is in it until 1.0.0 is published. In the places above:

- D11b: its second step, the lead maintainer as the required reviewer of
  `publishing` and the branches `publish/v*` out of its deployment policies, is
  not taken. The first, the third and the fourth stay.
- REQ-285 and REG-01: the gate of the publication is the merge of the pull
  request of the version, made on the lead maintainer's go once the last runs of
  main, of a push and of the night, and the checks of that pull request are
  green. The tag starts the publication with no approval to wait for, so the
  runs of the merge commit end after it: they are read and recorded with their
  counts once they end, and a red one is handled as [the way back](#the-way-back)
  says.
- REQ-310, the Safety of the Design, the fourth step of
  [the release flow](#the-release-flow) and the success criteria: the one job of
  the release workflow runs at the tag with no approval to wait for, and a
  version published from a pull request of a version merged without the lead
  maintainer's go is a failure.

The rest of this spec is read with the amendment. The text this amendment
changes is the one at
[`854910e`](https://github.com/freelensapp/freelens-velero-extension/blob/854910ec7ceb8c8662aa3f05729c4c28398a2293/docs/specs/SPEC-0018-release-readiness.md).

### 2026-11-09: The Sections Of The Other Extensions

Decided by the lead maintainer on 2026-11-09, and recorded on 2026-11-10: the
README has the sections of the other extensions of the organization, Overview,
Requirements, Supported APIs, Permissions, Install, Getting started, Features,
Limits, Development, Build from the source and License, and no other, as the
evidence of the second pull request of T6.3 records. The amendments the decision
brings, which that evidence left to another pull request, are these, in the
places above:

- The paragraph of the Documentation gives the sections in that order, with
  Write actions as the last subsection of Features, and no Safety, Verify a
  release or Troubleshooting of their own.
- REQ-298 is written in Features, as its subsection Write actions, which DOC-04
  reads.
- REQ-300, the section Troubleshooting, and its check DOC-06 are not taken: what
  one of its entries would say that an operator needs and no other section says
  is in Features or in Limits, and the verbs to grant are in Permissions.
- Scenario 5, the checklist of REL-03 in REQ-312, and the success criteria read
  the README without Troubleshooting: no quoted message is compared with the
  function of its words.
- The row of T6.3 in the roadmap names the sections the README has.

The rest of this spec is read with the amendment. The text this amendment
changes is the one at
[`854910e`](https://github.com/freelensapp/freelens-velero-extension/blob/854910ec7ceb8c8662aa3f05729c4c28398a2293/docs/specs/SPEC-0018-release-readiness.md).
