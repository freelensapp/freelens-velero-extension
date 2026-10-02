# SPEC-0012: The Version Of The Server And Its Plugins

- **Status:** Approved
- **Date:** 2026-09-30
- **Milestone / tasks:** M3 / T5.3
- **Reviewed Velero:** v1.18.2, `c253c7fe37d78c9b7e55c68544f7c5b2608712d8`; compared with v1.18.4, `4ee1e79a7aed367fd9b767b8219ec65bd0c96892`
- **Reviewed main:** `e5d9354ddf7607e0bad3ebc7744a4964c24b489a`
- **Freelens validation target:** v1.10.3, `3da74415bff57a77c6e08cb5f538191ce87bac17`
- **Dependencies:** [the write gate](SPEC-0009-write-gate.md), [the Overview](SPEC-0008-overview.md), [locations](SPEC-0007-locations-read-only.md)
- **Approval:** Approved by the lead maintainer on 2026-09-30, as drafted

Governed by [AGENTS.md](../../AGENTS.md).

## Goal

The operator learns from the server itself which Velero runs in the
installation and which plugins it loaded, when asked; and learns, from the same
request, when the server does not answer.

## Scope Baseline

A ServerStatusRequest has an empty spec and two phases; the controller writes
into a new one the version of the server, its plugins with their names and
kinds, and the time, and deletes it when it looks at it again, five minutes
after it processed it, as the
[recon](../development/RECON-T0.1.md#start-of-the-third-milestone-2026-09-30)
records. It is the only object of Velero that says whether the server is
running: the last validation of a location, which the Overview reads, is what a
stopped server leaves behind.

Included: a band of the Overview, the request through the gate, what is shown
of the answer, the note on the version the extension was reviewed against, and
what is said when the server does not answer. Excluded, with their owners: the
settings of the server, which no object holds; the metrics of Velero, which the
extension does not read; the backup repositories (M4).

## User Scenarios

1. **P1, the version:** Given the demo and writes on, when the operator asks for
   the version, confirms, and the server answers, then the band shows the
   version, when it was read, and the plugins by kind, and says that this is
   the release the extension was reviewed against.
2. **P1, no answer:** Given an installation without a server, when the operator
   asks, then after ten seconds the band says that the server did not answer,
   what it may mean, and that the request stays until the server processes it
   or someone removes it.
3. **P1, another release:** Given a server of another version, when it answers,
   then the band shows it and says that what the views say of Velero was read in
   the reviewed release.
4. **P2, refused:** Given an identity that may not create the request, then the
   band says so, with the permission it needs.
5. **P2, writes off:** Given writes off, then the band says what it would create
   and leads to the target bar, and creates nothing.
6. **P2, kept:** Given a version read, when the Overview is read again or another
   page is visited and the operator comes back, then the version is still there
   with its time, until the installation changes or the operator reads it again.

## Requirements

| ID | Contract | Acceptance check |
| --- | --- | --- |
| REQ-152 | The Overview has a band Server, after what was read, whose first state says that the version is not read and offers the command, in the name of the kind, with the state of the gate, as SPEC-0009 says; with writes off it leads to the target bar and creates nothing | SERV-01 |
| REQ-153 | The request is created with the generated name prefix `freelens-velero-`, an empty spec, no phase, which the release reads as New, and the label that names the extension, through the gate and its confirmation. It is read every 250 milliseconds, for ten seconds at most, until it is Processed; then the band shows the version, the time the server wrote, and the plugins. A request that is not Processed after ten seconds is said not answered, with what it may mean, a stopped or busy server, and the band says that the request stays until the server processes it, and that the server deletes a processed request when it looks at it again, five minutes after. No request is deleted by the extension | SERV-02 |
| REQ-154 | The plugins are grouped by kind, in the order of the kinds of the release, ObjectStore, VolumeSnapshotter, BackupItemAction, BackupItemActionV2, RestoreItemAction, RestoreItemActionV2, DeleteItemAction and ItemBlockAction, the names sorted in each, since the object lists them in no order, with the count of each and of the whole; a kind the release does not name keeps its text after them. Beside the object store plugins, the band names the providers of the storage locations of the installation and marks the one for which no object store plugin of that name is loaded, by the rule the release uses to name a plugin from a provider | SERV-03 |
| REQ-155 | The version is compared with the reviewed release: the same, and the band says that it is the release the extension was reviewed against; the same major and minor with another patch, and the band says that it is the series the extension was reviewed against, with the patch; another series, and the band says which release the extension was reviewed against and that what its views say of the behavior of Velero was read there; one that is not a version, shown as written with no comparison | SERV-04 |
| REQ-156 | What was read is kept for the installation for the session, with its time, through the reads of the Overview and the other pages, and dropped when the installation changes. The command reads again, which is a new request | SERV-05 |
| REQ-157 | An identity the API refuses the creation to is said so, with the kind and the verb it needs, and writes stay on; every other way the request ends is said in the words of its code | SERV-06 |
| REQ-158 | The band only reads apart from the request: no other object is created, patched or deleted, which the API server counts | SERV-07 |
| REQ-159 | The packaged application reads the version of the real server of the demo, sees a request in a synthetic installation stay New and be said not answered, and gets the refusal for the identity that may not create | SERV-08 |

## Design

- **Standard or ad hoc view, and why.** A band of the Overview, unframed as the
  others, because the version and the plugins are of the installation, not of
  one object, and because the Overview is where the operator looks at an
  installation first. It is not read when the page opens: a request is a
  write, and the page asks the cluster nothing of its own.
- **Safety.** The only write is the ServerStatusRequest, through the gate of
  SPEC-0009. The band reads the storage locations the installation already read
  for the providers. Nothing is deleted: the controller removes the request
  when it looks at it again, five minutes after it processed it; a request in
  an installation without a server stays, and the band says so.

The band, from the top: the version with its note, the time it was read, the
plugins by kind, and beside the object store plugins the providers of the
locations. The first state, the confirmation and the states of the load have
the words of SPEC-0009 and of SPEC-0010, through the same functions.

The request goes through the same procedures as a DownloadRequest,
`write.confirm` and `write.run`, with the kind ServerStatusRequest and no
target: the main process creates it with the
[adapter](../../src/main/diagnostic-kubernetes.ts) of T0.6, which already
creates a request with a generated name, and reads it back by the name the API
gave it. The result is the version, the time, the plugins and the name of the
request; nothing else of the object.

The comparison of the version is a pure function on the two strings, in
`src/common/server-version.ts`, which knows the form `vMAJOR.MINOR.PATCH` with
an optional suffix, and the name of a plugin from a provider is the rule of the
release, `velero.io/` before a name without a slash.

## Tests

Planned homes: unit tests of the comparison of the version, of the grouping of
the plugins and of the providers; tests of the main process with a fake adapter
for the polling and the ten seconds; component tests of the band and its
states; the suites of the views in the packaged application, on the real server
of the demo and on a synthetic installation, where no controller reads.

| Check | Layer | Requirements | Scenario and expected evidence |
| --- | --- | --- | --- |
| SERV-01 | Component/packaged | REQ-152 | The band after what was read; the first state with writes off and on; nothing created when the page opens, counted on the API server |
| SERV-02 | Fake-clock unit/packaged | REQ-153 | The prefix, the spec, the label; 250 ms and ten seconds; Processed with its fields; not answered after ten seconds; no delete sent |
| SERV-03 | Unit/component/packaged | REQ-154 | The eight kinds in order, an unknown kind, the names sorted from an object that lists them unsorted, the counts; the providers of the locations, one with its plugin and one without, and the rule of the name |
| SERV-04 | Unit/component | REQ-155 | The same version, the same series with another patch, a newer series, an older, a prerelease, a text that is not a version |
| SERV-05 | Component/packaged | REQ-156 | Kept through a read of the Overview and a visit to another page; dropped with the installation; read again as a new request |
| SERV-06 | Unit/packaged | REQ-157 | The refusal of the API with its words; each other code |
| SERV-07 | Packaged | REQ-158 | The counts of the API server: one creation, the reads of the request, nothing else |
| SERV-08 | Packaged | REQ-159 | The real server, the synthetic installation, the identity that may not create |

## Success Criteria

All 8 checks pass before this spec is Verified. On the demo the band shows the
version of the real server and its plugins, and in a synthetic installation
says that the server did not answer.

Manual review: on the demo, read the version; then select
`velero-overview-<run>` and read it there. Expected: the version and the
plugins of the demo, with the note of the reviewed release; in the synthetic
installation, after ten seconds, that the server did not answer, and no claim
that it is down. Record role, date and verdict.

## Assumptions And Decisions

- **Ten seconds** is the wait, twice the default of the command line: an idle
  server answers within a second, and a server that takes longer is one the
  operator should hear about.
- **The band is not an item of what needs attention.** The rules of the Overview
  are functions of what was read; this is a write the operator asked for, and
  its answer stays in its band.
- **The prefix of the generated name** is `freelens-velero-`, so that an
  operator who lists the requests knows what created them; the label says the
  same.
- **The providers are compared by the rule of the release**, which prefixes a
  provider without a slash with `velero.io/`: a location of the provider `aws`
  needs an object store plugin `velero.io/aws`. A provider with a slash is
  compared as written.
- **The same series is said so.** The command line of Velero compares the major
  and the minor of the client and of the server and not the patch: a server of
  the reviewed series with another patch is the series the extension was
  reviewed against, and the band says the patch beside it.

## Evidence And Deviations

Approved on 2026-09-30, as drafted. No implementation, tests or runtime evidence
yet.
