# SPEC-0007: Read-Only Storage And Snapshot Locations

- **Status:** Verified
- **Date:** 2026-09-30
- **Milestone / tasks:** M2 / T1.6
- **Reviewed Velero:** v1.18.2, `c253c7fe37d78c9b7e55c68544f7c5b2608712d8`; compared with v1.18.3, `cd3fd10b093dad32ee284e27fcba4e9073c9c94b`
- **Reviewed main:** `60163e0827e72658bb6546165a727300170e628b`
- **Freelens validation target:** v1.10.3, `3da74415bff57a77c6e08cb5f538191ce87bac17`
- **Dependencies:** [target discovery](SPEC-0002-installation-discovery.md), [states and Backups](SPEC-0003-backup-read-only.md)
- **Approval:** Approved by the lead maintainer on 2026-09-28, as drafted

Governed by [AGENTS.md](../../AGENTS.md).

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
  said possibly out of date. They are choices of this spec, which the lead
  maintainer confirmed at approval: the release gives no threshold. The frequency of the
  server is one minute unless its settings say otherwise. They are two constants,
  in one place.
- The configuration of a location is not meant to hold secrets, and the release
  does not promise that it holds none: this is why a URL is shown without its user
  information and its query. The screenshots of the project are of synthetic
  locations only.
- The default the server may name in its own settings is outside what the views
  read. Reading the deployment of Velero is not part of this slice.

## Evidence And Deviations

Approved on 2026-09-28. The two schemas are the same in the reviewed release and
in the one after it: see the
[recon](../development/RECON-T0.1.md#upstream-drift-watch), which holds the facts
of the reviewed release this spec rests on.

What is [shown of a location](../../src/common/location-view.ts), the
[durations](../../src/common/go-duration.ts) the API writes and
[what uses a location](../../src/common/location-users.ts) are pure functions on
plain data; the lists of the
[storage locations](../../src/renderer/pages/storage-locations-page.tsx) and of
the [snapshot locations](../../src/renderer/pages/snapshot-locations-page.tsx)
are the native list of the host, given what the extension read; the workspaces
of a [storage location](../../src/renderer/pages/storage-location-workspace.tsx)
and of a [snapshot location](../../src/renderer/pages/snapshot-location-workspace.tsx)
are of the extension, with [parts](../../src/renderer/components/location-parts.tsx)
they share; the sections in the details of the host read a location through the
same helpers. The page, the frame of a view and the store of a list are the ones
written for every kind with the [Restores](SPEC-0005-restore-read-only.md).

| Check | Evidence |
| --- | --- |
| LOC-01 | Component: every column has its order and its part in the search, with the message of Velero. Packaged: the columns, a search by the access mode, by a name and by what is late, an order by the access mode read from the rows, a column made wider; a location opened and closed leaves them as they were |
| LOC-02 | Component: the columns of the snapshot locations, an order for each, the rows put in order by three of them, and the search. Packaged: the columns and a search by the provider |
| LOC-03 | Component and packaged: a row of each list opens its workspace; the details of the host show the same availability, access mode, default, last validation and last sync, and lead to the workspace for the installation selected. Packaged: the API server counts no read of the five families while a location is opened between two reads of the installation |
| LOC-04 | Unit: Available, Unavailable with and without a message, no status, a phase that is not known, each with its words and its mark. Component: a location that reports nothing and one that reports what is not known have the mark of what is not known. Packaged: the same for the one that reports nothing, the schema of the cluster admitting no other phase; the message of Velero is the tip of the mark. Component and packaged: a snapshot location that reports Available has the mark of what is not known, and the list says why |
| LOC-05 | Unit, with the clock given: a frequency with a fresh and an old validation, a frequency of seconds, a frequency of zero, none, one that cannot be read or is below zero, a phase with no validation time, a validation the clock of the desktop is behind of. Component: a validation later than three times the frequency, later than one hour, one that is not late, never validated, a frequency that is turned off, not set and not read, each with its words in the view; the mark and the words of a late validation in the list. Packaged: the location the controller of the environment validates every minute is not late, and the synthetic ones, which no controller validates, are |
| LOC-06 | Unit and component: ReadWrite, ReadOnly, not set and a mode that is not known; the mode of the status, which disagrees with the one of the spec, is not shown as the mode. Packaged: the location of the installation names no mode, which the suite reads on the cluster before it expects the view to say so |
| LOC-07 | Unit, component and packaged: one location marked default, none, and two in a namespace of their own: what the list says of each, which of the two the release keeps, and no choice made for the operator |
| LOC-08 | Unit and component: a configuration of many keys and none; the key of the verification with every value the release reads as true and with the ones it does not, for the backend of AWS by each of its names and for another one; a URL with its user information and its query, a password that holds a slash, a question mark or a hash, an address without its scheme, an address the message of Velero quotes; a sync period of zero and one below zero; no last sync. Packaged: the query of an address left out and said left out, the verification turned off said in words |
| LOC-09 | Unit: every path the views have is under `/apis/velero.io/`, and the reader asks the host for none that is not written as one of theirs: the paths of the Secrets, the ones that leave the group by dots, written as they are or as an address encodes them, a query, a name of an object; a certificate written in the object shown by its size. Component: every address a view asked is of the kinds of Velero. Packaged: the identity that reads a part, which the API server refuses the Secrets to, shows the two Secrets by their names with nothing of the view denied; the Secrets that are named are not in the cluster |
| LOC-10 | Unit: the backups and the schedules that name a location, a backup that carries its location in its label alone, the ones of another installation, none, what was not read, not served and denied; the schedules that name no location, beside a location marked default. Component and packaged: the counts with the newest backup, which leads to its view; none; the backups denied to the second reader, which are not none; what the release refuses beside a location that is unavailable, and beside one that reports nothing |
| LOC-11 | Component and packaged: from a backup to its storage location and to its snapshot location, from a restore to the location of its backup, from a schedule to the location of its template and to the one marked default when its template names none, and each way back; a location that is not there is a name with no way. Packaged: the changes of the address are counted, and each step is one |
| LOC-12 | Component: the lists are given no selection, no menu and no command; a view has the way back and the ways to the other views, and no other control. Packaged: no checkbox, no menu; a right click, Delete and Backspace are followed by a wait in which no menu and no dialog appears, on both lists, while the list the host shows of the same objects has the boxes and the menu that are looked for; the objects unchanged |
| LOC-13 | Component: the locations of each kind that were read kept when the next read fails, in the list and in the view, with when they were read; what uses a location kept and said of an earlier read; a late answer of the installation selected before; a location created again, said in words; no timer left when the view closes |
| LOC-14 | Pre-review: the two lists, the workspace of a storage location with a message of many lines, the one of a location whose name and bucket have 63 characters and whose prefix has many parts, its storage with its credentials, what uses it, and the workspace of a snapshot location, in both themes, at the two sizes and at twice the zoom; a location opened, followed to a backup and to a schedule and closed with the keyboard alone. Packaged: no column of the list has its words cut but the name that is as long as a name can be, which is whole in its tip |
| LOC-15 | Unit: the reader sends `GET` and nothing else. Component: for each of the two lists empty, not served, denied, not answered and stale, each with its words, and nothing said of a list before it is read; for the views absent, denied and stale; for each part of what uses a location listed, none, denied, failed and of an earlier read. Packaged: the second reader, to which the backups are denied, and the first, to which the snapshot locations are; the evidence of DISC-07 of the [discovery](SPEC-0002-installation-discovery.md#evidence-and-deviations) taken with the locations open |

Eighty-three changes made to the code on purpose, one for each rule above that a
view could get wrong, each made a unit or a component test fail. The pull request
of the task names them.

What was decided while implementing, inside the requirements:

- **The list shows how long ago a location was validated and synced**, and when
  it was is in the tip of the cell and in the view. An age is what is read at a
  glance. A validation that is late has its mark, which is a shape, its words for
  who does not see the mark, and the whole sentence in the tip.
- **What uses the location marked default** has one line more: the schedules
  whose template names no location, which send their backups there. With more
  than one marked it says that they go to the first the release finds.
- **An address is shown without what it may hide wherever it is written**: in a
  value of the configuration and in what Velero says of a location it could not
  reach. Where a password holds what ends an authority, everything before the
  last at sign goes.
- **What is said of a list as a whole is over the list**: that no location is
  marked default, that more than one is, and that the phase of a snapshot
  location is not one the release stands behind.
- **The fixtures of the locations are among the ones of the views**, which are put
  in place on an environment that is already up, and not among the static ones.
  No controller reads either. The two locations marked default are in a
  namespace of their own, which the discovery finds as an installation.
- **No controller validates a synthetic location.** What one reports is of a
  validation that is days old, whatever the age of the environment: the fresh
  validation of the packaged suites is the one of the location the controller of
  the environment validates.
- **The reader asks no path that is not of the kinds of Velero.** The views give
  it none: it refuses one all the same, whoever gives it, and a test gives it
  the paths of the Secrets.
- **A view says what is missing of the families it reads.** The view of a
  location shows the location, the backups and the schedules: what is denied of
  the restores is not said over it.
- **With more than one location marked default**, the list names the one the
  release would keep, which is the one created last, and says that it is not
  settled which one it keeps of two created in the same second. The view of a
  [schedule](SPEC-0006-schedule-read-only.md) reads the same rule, and said of
  such two that the release keeps the first by name: it is corrected with this
  slice.
- **The synthetic locations of the namespace of the phases have a phase and no
  validation time**, which the release writes together: they are what a view shows
  of a status that carries one without the other, and the view says never
  validated, as REQ-082 asks.

An independent review of the change, read only, found three things of weight and
fifteen smaller ones. They are corrected here, and the facts they rest on are in
the [recon](../development/RECON-T0.1.md#start-of-the-second-milestone-2026-09-28).

Two deviations from the requirements, approved by the lead maintainer at the
review of the milestone on 2026-09-30:

| Requirement | What it says | What the views do, and why |
| --- | --- | --- |
| REQ-085 | For the provider `aws`, the key `insecureSkipTLSVerify` with the value `true` is marked as the verification of TLS turned off; for the other providers the keys have no such mark | The key is marked with every value the release reads as true, which are six, and for the backend of AWS by each of its names. With another backend the mark says what the release turns off, which is the verification for what it moves with restic: the release reads the key there whatever the provider. A configuration that turns a verification off and has no mark is what the requirement wanted to avoid |
| REQ-082 | With a frequency above zero, the availability may be out of date when the last validation is older than three times the frequency | The bound is three times the frequency and one minute at least. The release looks every ten seconds for what is due and the views read every fifteen: with a frequency of seconds a location validated in time would be said late between two reads. The note says that the age is counted by the clock of the machine that shows it |

Review of the milestone, 2026-09-30. The steps of the manual review were run in
the packaged application by the pre-review pass, with the keyboard alone where the
criteria ask for it; the lead maintainer judged its report and its screenshots, in
both themes, and approved. Verdict: approved, with what was decided while
implementing accepted as it is and the two deviations above approved. No finding was recorded.
