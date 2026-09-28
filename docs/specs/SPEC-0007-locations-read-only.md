# SPEC-0007: Read-Only Storage And Snapshot Locations

- **Status:** Draft
- **Date:** 2026-09-28
- **Milestone / tasks:** M2 / T1.6
- **Reviewed Velero:** v1.18.2, `c253c7fe37d78c9b7e55c68544f7c5b2608712d8`; compared with v1.18.3, `cd3fd10b093dad32ee284e27fcba4e9073c9c94b`
- **Reviewed main:** `60163e0827e72658bb6546165a727300170e628b`
- **Freelens validation target:** v1.10.3, `3da74415bff57a77c6e08cb5f538191ce87bac17`
- **Dependencies:** [target discovery](SPEC-0002-installation-discovery.md), [states and Backups](SPEC-0003-backup-read-only.md)
- **Approval:** Pending

Governed by [AGENTS.md](../../AGENTS.md). A completed draft is not approval to
implement.

## Goal

Let operators see where the backups and the snapshots of an installation are kept and
what Velero says of each place, with availability, access mode and default as three
facts, and without a location that reports nothing being shown as a healthy one.

## Scope Baseline

The [recon](../development/RECON-T0.1.md#crd-and-phase-contracts) confirms that both
kinds admit Available and Unavailable and guarantee neither. In the reviewed release
a controller validates the backup storage locations and writes their status; nothing
writes or reads the status of a volume snapshot location. `spec.accessMode` is the
access mode; `status.accessMode` and `status.lastSyncedRevision` are deprecated and
unused.

Included: the two lists, the workspace of a location of each kind, the sections in
the details of the host, what uses a location, and the way from the views of the
other kinds to a location. Excluded, with their owners: the version of the server
and its plugins (M3, T5.3); the backup repositories (M4, T5.1); what the settings of
the server say, its default location and its validation frequency among them, which
no object of this slice holds. Creating or changing a location is not in the agreed
scope of v1.0.0.

## User Scenarios

1. **P1, unavailable:** Given a storage location that Velero reports Unavailable,
   when the list is read, then it says so, and the workspace shows the message of
   Velero, when the location was last validated, and what depends on it.
2. **P1, available and read-only:** Given a location that is Available and
   ReadOnly, when it is read, then the two facts are side by side, and the view
   says that new backups cannot go there.
3. **P1, nothing reported:** Given a storage location without a status, or a
   snapshot location, whose status nothing writes in the reviewed release, then the
   availability is said not reported, with no mark of health.
4. **P1, what is there:** Given a location that backups and schedules name, when
   it is opened, then they are listed with their state and lead to their views.
5. **P1, an old validation:** Given a location that is Available and was last
   validated days ago, as when the server of Velero stopped, then the view says
   that its availability may be out of date.
6. **P2, credentials:** Given a location that names a Secret for its credential
   and one for its certificate, then the names are shown, and the Secrets are
   never read.

## Requirements

| ID | Contract | Acceptance check |
| --- | --- | --- |
| REQ-078 | List the backup storage locations of the selected installation in the native list with the columns name, installation, availability, access mode, default, provider, last validation and last sync, each with a stable ID, an order and a part in the search | LOC-01 |
| REQ-079 | List the volume snapshot locations with the columns name, installation, provider, availability and age, under the same rules | LOC-02 |
| REQ-080 | Open a dedicated read-only workspace from a row of either list, and add a compact section to the details the host shows of each kind; all read through the same helpers | LOC-03 |
| REQ-081 | The availability of a storage location is `status.phase` as reported: Available, Unavailable with `status.message` beside it, or not reported when the object has none. A value the release does not know is kept and shown as unknown. Nothing but a reported Available is shown as available. The phase of a snapshot location is shown as written, with the mark of what is not known and the note that the reviewed release neither writes nor checks it | LOC-04 |
| REQ-082 | Show the availability of a storage location with the time and the age of its last validation. When the object names a validation frequency above zero and the last validation is older than three times that, say that the availability may be out of date. When the frequency is zero, say that the periodic validation is turned off and that the availability is the one of the last validation. When the object names none, say that the frequency is the one of the server, which the view does not read. In these two cases say that the availability may be out of date when the last validation is older than one hour. A phase with no validation time is said never validated | LOC-05 |
| REQ-083 | The access mode is `spec.accessMode` and nothing else: `status.accessMode` is never read for it. A mode that is not set is said not set, with the fact that the reviewed release refuses a backup for the access mode only when it is ReadOnly. An Available ReadOnly location is said not to take new backups | LOC-06 |
| REQ-084 | Default is `spec.default`. When no location of the installation is marked, the list says so and says that the server may name one in its settings, which the view does not read. When more than one is marked, the list shows each as marked and says that the reviewed release keeps the one created last. The view never picks a default for the operator | LOC-07 |
| REQ-085 | Show where a location points as the object carries it: provider, bucket, prefix and every key of `config`, the validation frequency and the sync period. A value that reads as a URL is shown without its user information and its query, and the view says that it left them out. For the provider `aws`, the key `insecureSkipTLSVerify` with the value `true` is marked in words as the verification of TLS turned off; for the other providers the keys are shown with no such mark. A sync period of zero is said sync turned off, and a location with no last sync is said never synced | LOC-08 |
| REQ-086 | Show a credential and a certificate reference as the name of the Secret and of its key. No Secret is read, in this slice, by any process. An inline certificate is said present, with its size, and deprecated; its content is not shown | LOC-09 |
| REQ-087 | Show what uses a location: the backups that name it, counted by state with the newest of them, and the schedules whose template names it. For a snapshot location the same, through the snapshot locations a backup or a template names. Beside a storage location that is not reported Available, say that the reviewed release refuses the backups sent to it and the restores of the backups it holds. What could not be read is unknown, not none | LOC-10 |
| REQ-088 | A location named in the view of a backup, of a restore or of a schedule leads to its workspace when it resolves; each view returns to the one it was opened from | LOC-11 |
| REQ-089 | No surface of the extension offers to edit, delete, select or set as default a location | LOC-12 |
| REQ-090 | A read that fails keeps what was read before and says when; late answers and objects created again are told apart; no timer is left | LOC-13 |
| REQ-091 | Both themes, the keyboard alone, long names, buckets, prefixes and messages of many lines, a window of 900x650 and twice the zoom | LOC-14 |
| REQ-092 | The slice only reads, and empty, loading, denied, not served, failed, stale and partly read are distinct for each list, each workspace and each part of what uses a location | LOC-15 |

## Design

The sidebar gets Backup Storage Locations and Volume Snapshot Locations under
Velero, after Schedules. The check DISC-08 is updated with the two entries.

- **Standard or ad hoc view, and why.** The lists are the native list of the host.
  The detail is the workspace of the extension, shorter than the one of an
  operation: the reason is the one of the [Schedules](SPEC-0006-schedule-read-only.md),
  and the operator finds every kind of Velero behind the same gesture. What uses a
  location is the part made for the purpose: the question of who opens a location
  that is unavailable is what depends on it. The details of the host get a section
  that only reads, and a link to the workspace when the location is of the
  installation selected.
- **Safety.** The slice writes nothing and reads no Secret. The reader is the only
  place of the renderer that reaches the cluster, and it is given no path to a
  Secret: a unit test asserts that every path it is given is under
  `/apis/velero.io/`. The counter the suites read on the API server is of the kinds
  of Velero and cannot count the Secrets, which the other components of the cluster
  read all the time: the proof is the one of the unit test, and the packaged
  application adds that the views are the same for an identity that may not read a
  Secret.

The workspace of a storage location, from the top:

| Band | Content | Source |
| --- | --- | --- |
| Way back and name | The list, or the view it was opened from | The address |
| Status | Availability and its message, last validation and what REQ-082 says of it, access mode, default, last sync, age | `status`, `spec` |
| Storage | Provider, bucket, prefix, configuration, validation frequency, sync period | `spec` |
| Credentials | The references of REQ-086 | `spec.credential`, `spec.objectStorage` |
| Used by | Backups by state with the newest, schedules, and what REQ-087 says of a location that is not available | The reads of the installation |

The workspace of a snapshot location has the same bands without the ones it has no
fields for: status with the phase alone, provider and configuration, the
credential reference, used by. Beside its phase, reported or not, it says that the
reviewed release neither writes nor checks it, so that the operator does not look
for a fault and does not read a confirmation.

The columns of availability use the marks of the states of the lists: a shape and
a word, not a colour alone. Not reported and unknown have the mark of what is not
known, never the one of what went well.

The durations of `validationFrequency` and `backupSyncPeriod` are read by a pure
function from the form the API gives them; one that cannot be read, or that is
below zero, is shown as written and is treated by REQ-082 as one that is not named.

The last validation is the only thing the objects of this milestone say of whether
the server of Velero is at work: a server that stopped leaves every availability as
it was. This is why REQ-082 gives a bound also to a location that names no
frequency.

## Tests

Planned homes: unit tests of the view of a location, of the durations and of what
uses a location; component tests of the pages and of the workspaces; the static
locations that exist, read-only, unavailable with a message, and the snapshot
location that reports nothing. Added to the static fixtures, where no controller
reads them: a storage location without a status, one with a credential and a
certificate reference, one with a validation frequency and an old validation, one
with no frequency and an old validation, one marked default that is read-only, two
marked default in a namespace of their own. The inline certificate is a case of the
unit and component tests. The second reader is the one of the
[Restores](SPEC-0005-restore-read-only.md#tests).

| Check | Layer | Requirements | Scenario and expected evidence |
| --- | --- | --- | --- |
| LOC-01 | Packaged app | REQ-078 | The columns, their order and the search; a location opened and closed leaves the list where it was |
| LOC-02 | Packaged app | REQ-079 | The same for the snapshot locations |
| LOC-03 | Component/packaged | REQ-080 | A row of each list opens its workspace; the details of the host agree on availability, access mode, default and last validation |
| LOC-04 | Table-driven unit/packaged | REQ-081 | Available, Unavailable with and without a message, no status, an unknown value: the words and the mark of each; a snapshot location that reports Available has the mark of what is not known |
| LOC-05 | Fake-clock unit/packaged | REQ-082 | A frequency and a fresh validation, an old one; a frequency of zero; none, with a fresh and an old validation; one that cannot be read; a phase with no validation time |
| LOC-06 | Unit/component | REQ-083 | ReadWrite, ReadOnly, not set, an unknown mode; a `status.accessMode` that disagrees with the one of `spec` is not shown as the mode |
| LOC-07 | Unit/component/packaged | REQ-084 | One default, none, two marked: what the list says of each |
| LOC-08 | Unit/component | REQ-085 | A configuration with many keys, none; the key of the verification for `aws` and for another provider; a URL with user information and a query; a sync period of zero; no last sync |
| LOC-09 | Unit/component/packaged | REQ-086 | Unit: every path given to the reader is under `/apis/velero.io/`; an inline certificate shown by its size. Packaged: with the reader of a part, which may not read a Secret, the references are shown by name and nothing of the view is denied |
| LOC-10 | Unit/local RBAC/packaged | REQ-087 | Backups and schedules that name the location, none that do, the backups denied to the second reader; the words beside a location that is unavailable |
| LOC-11 | Packaged app | REQ-088 | From a backup to its storage location and to its snapshot location, from a restore to the location of its backup, from a schedule to the location of its template, and each way back |
| LOC-12 | Component/packaged | REQ-089 | No control that writes, by pointer, menu or keyboard; the objects unchanged |
| LOC-13 | Unit/component | REQ-090 | A read that fails after one that succeeded; a late answer; no timer left |
| LOC-14 | Pre-review | REQ-091 | The lists and the workspaces in both themes, at the two sizes and at twice the zoom; a message of many lines |
| LOC-15 | Adapter/local RBAC/packaged | REQ-092 | Each state with its words; the evidence of DISC-07 taken again with the locations open |

## Success Criteria

All 15 checks pass before this spec is Verified. No location is shown as available
on anything but a reported Available, and no Secret is read.

Manual review: with the synthetic locations, tell which one takes new backups,
which one does not and why, and what depends on the one that is unavailable.
Expected: the three facts are not confused, and a location that reports nothing
does not read as a fault or as a success. Record role, date and verdict.

## Assumptions And Decisions

- **Three times the frequency, and one hour** when the object names no frequency
  or turns the validation off, are the distances after which an availability is
  said possibly out of date. They are choices of this spec for the lead maintainer
  to confirm or change: the release gives no threshold. The frequency of the
  server is one minute unless its settings say otherwise. They are two constants,
  in one place.
- The configuration of a location is not meant to hold secrets, and the release
  does not promise that it holds none: this is why a URL is shown without its user
  information and its query. The screenshots of the project are of synthetic
  locations only.
- The default the server may name in its own settings is outside what the views
  read. Reading the deployment of Velero is not part of this slice.

## Evidence And Deviations

No implementation, tests or runtime evidence yet. The two schemas are the same in
the reviewed release and in the one after it: see the
[recon](../development/RECON-T0.1.md#upstream-drift-watch), which holds the facts
of the reviewed release this spec rests on.
