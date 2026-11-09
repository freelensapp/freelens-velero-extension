# @freelensapp/velero-extension

<!-- markdownlint-disable MD013 -->

[![Home](https://img.shields.io/badge/%F0%9F%8F%A0-freelens.app-02a7a0)](https://freelens.app)
[![GitHub](https://img.shields.io/github/stars/freelensapp/freelens-velero-extension?style=flat&label=GitHub%20%E2%AD%90)](https://github.com/freelensapp/freelens-velero-extension)
[![DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/freelensapp/freelens-velero-extension)
[![Release](https://img.shields.io/github/v/release/freelensapp/freelens-velero-extension?display_name=tag&sort=semver)](https://github.com/freelensapp/freelens-velero-extension/releases)
[![Unit tests](https://github.com/freelensapp/freelens-velero-extension/actions/workflows/unit-tests.yaml/badge.svg?branch=main)](https://github.com/freelensapp/freelens-velero-extension/actions/workflows/unit-tests.yaml)
[![Integration tests](https://github.com/freelensapp/freelens-velero-extension/actions/workflows/integration-tests.yaml/badge.svg?branch=main)](https://github.com/freelensapp/freelens-velero-extension/actions/workflows/integration-tests.yaml)
[![E2E tests](https://github.com/freelensapp/freelens-velero-extension/actions/workflows/e2e-tests.yaml/badge.svg?branch=main)](https://github.com/freelensapp/freelens-velero-extension/actions/workflows/e2e-tests.yaml)
[![npm](https://img.shields.io/npm/v/@freelensapp/velero-extension.svg)](https://www.npmjs.com/package/@freelensapp/velero-extension)

<!-- markdownlint-enable MD013 -->

## Overview

[Freelens](https://freelens.app) extension for [Velero](https://velero.io),
the backup and recovery tool for Kubernetes: backups, restores, schedules and
storage locations, with their logs and results, inside the Freelens desktop
application and across every cluster it connects to.

The extension lives in the cluster sidebar under **Velero**: **Overview**,
**Backups**, **Restores**, **Schedules**, **Backup Storage Locations**,
**Volume Snapshot Locations**, **Backup Repositories**, **Pod Volume
Backups**, **Pod Volume Restores**, **Data Uploads** and **Data Downloads**.
It reaches the cluster through the connection Freelens already has, and it
writes nothing until writes are turned on for one installation of Velero,
after which each write is confirmed before it is sent.

The extension needs nothing installed in the cluster beyond Velero itself. It
is a from-scratch MIT implementation and it is not a Velero product.

### Status

1.0.0, the first release of the extension, is being prepared. Until it is
published, install the extension from the source, as
[Build from the source](#build-from-the-source) says. What each version brings is
in the [releases](https://github.com/freelensapp/freelens-velero-extension/releases)
of the repository on GitHub. What 1.0.0 covers, by milestone:

<!-- markdownlint-disable MD013 -->

| Milestone | Content |
| --- | --- |
| M1 | Discovery of the Velero installations of a cluster, Backup list and operation workspace |
| M2 | Restores, Schedules, Backup Storage Locations, Volume Snapshot Locations, Overview |
| M3 | Logs, results, resource lists and volume information of backups and restores; server version and plugins |
| M4 | Adherence of the schedules to their cron expression; repositories, pod volume and data movement kinds |
| M5 | Actions: backup now, create backup, create schedule, restore, pause and resume a schedule, delete a backup |
| M6 | Release readiness |

<!-- markdownlint-enable MD013 -->

M1, M2 and M4 only read. The scope of each milestone and its progress are in
the [roadmap](docs/development/ROADMAP.md).

## Requirements

- **Freelens 2.0.0 or a later 2.x release.** The manifest declares
  `engines.freelens` as `^2.0.0`. Freelens 1 lists the package as Incompatible
  and runs none of its code.
- **A Kubernetes cluster with Velero.** The extension reads the kinds of Velero
  through the API `velero.io/v1`, and the data uploads and the data downloads of
  the data movement through `velero.io/v2alpha1`.
- **Nothing else in the cluster.** Nothing is installed in the cluster beyond
  Velero itself, and no credential of the object store is needed.
- **Node.js**, only to build the extension from source: the package carries
  what it runs.

### Compatibility

<!-- markdownlint-disable MD013 -->

| Component | Versions |
| --- | --- |
| Freelens | 2.0.x, tested at 2.0.0, the release built from freelensapp/freelens `b9b53e16056578c5407312eba5823a089972f6d5` |
| Velero | 1.18.x with its AWS plugin 1.14.x, tested at Velero v1.18.4 and the AWS plugin v1.14.4 |
| Kubernetes | Tested at 1.34.11, the node of the test clusters |
| Platforms | Tested on Linux ARM64, where the hosted checks run, and on macOS; any other platform, Windows among them, is untested |
| Proven on synthetic objects only | The data movement, and the phases of a failure other than FailedValidation |

<!-- markdownlint-enable MD013 -->

A version outside this table, Velero 1.19 among them, is untested: the
extension is not said to work with it, nor to fail with it.

## Supported APIs

The kinds of Velero the extension reads, each namespaced, with its page in the
sidebar, a view of each object, and a section in the details Freelens shows of
it. What the extension writes, once writes are on, is in [Safety](#safety): it
reads back the requests it creates there, a `DownloadRequest`, a
`ServerStatusRequest` and a `DeleteBackupRequest`, which have no page.

### velero.io/v1

| Kind | Page |
| --- | --- |
| `Backup` | Backups |
| `Restore` | Restores |
| `Schedule` | Schedules |
| `BackupStorageLocation` | Backup Storage Locations |
| `VolumeSnapshotLocation` | Volume Snapshot Locations |
| `BackupRepository` | Backup Repositories |
| `PodVolumeBackup` | Pod Volume Backups |
| `PodVolumeRestore` | Pod Volume Restores |

### velero.io/v2alpha1

| Kind | Page |
| --- | --- |
| `DataUpload` | Data Uploads |
| `DataDownload` | Data Downloads |

## Install

Open Freelens and go to Extensions (`ctrl`+`shift`+`E` or
`cmd`+`shift`+`E`). The field at the top takes a package name, the URL of a
tarball, or the path to a tarball or a directory.

### From the registry

Enter `@freelensapp/velero-extension` and press Install. Freelens installs the
newest version that is not a prerelease, whatever an npm tag names. To install
another version, enter it after the name, for instance
`@freelensapp/velero-extension@1.0.0`.

Freelens reads the package from the registry its preferences name, the npm
registry unless they name another, checks the download against the integrity
the registry gives for that version, then installs the extension, enables it
and lists it as verified.

Alternatively, open the following URL in the browser to install directly, once
Freelens has asked you to confirm the version:

[freelens://app/extensions/install/%40freelensapp%2Fvelero-extension](freelens://app/extensions/install/%40freelensapp%2Fvelero-extension)

### From a release tarball

Each [release](https://github.com/freelensapp/freelens-velero-extension/releases)
has the extension as `freelensapp-velero-extension-<version>.tgz`, with its
checksum in `freelensapp-velero-extension-<version>.tgz.sha256`. Every release
is for Freelens 2.x.

- Enter the URL of the `.tgz` asset and press Install. Freelens downloads the
  `.tgz.sha256` next to it and checks the tarball against it.
- Or download both files into one directory and enter the path to the `.tgz`,
  or choose it with Browse, the folder icon of the field. Freelens checks it
  against the `.tgz.sha256` next to it.

### From a directory

Build the extension (see [Build from the source](#build-from-the-source)),
then enter the path to your checkout, the directory with `package.json`, and
press Install. Once you confirm, Freelens runs the extension from that
directory, from the files in `dist/`, and lists it as development: nothing of
it is verified. This is how you work on the extension: see
[Development loop](#development-loop).

## Getting started

1. Connect to a cluster where Velero is installed. The **Velero** entry appears
   in the cluster sidebar, with its **Overview** first.
2. When the cluster holds more than one installation of Velero, choose yours in
   the target bar at the top of the page: the views read that installation
   alone.
3. Writes are off. The views read until you turn writes on, in the target bar,
   for that installation, and each write is then confirmed before it is sent.
4. No cluster with Velero at hand? `pnpm demo:up` brings up a disposable kind
   cluster with Velero and synthetic backups on your machine: see
   [TRY-IT.md](docs/development/TRY-IT.md).

## Features

### Installations and the Overview

**One installation at a time.** When you open Velero in a cluster, the
extension asks that cluster, and no other, whether it serves the API of Velero
and where its backup storage locations are. With a single installation, it
reads that one; among several, it asks which one to read and chooses none for
you; one it cannot find, such as one without a storage location, is read by
the namespace you name. The target bar at the top of every page says which
installation of which cluster is read, and your choice is kept for that
cluster when Freelens restarts.

**The Overview**, the first page under Velero, is the page of the
installation: how many backups, restores, schedules, backup storage
locations, volume snapshot locations and backup repositories it read, or why
it could not; what needs attention, each item with its object, its reason in
words and the way to it; the backups and the restores in flight; the newest
completed backup; the operations of the last 24 hours, 7 days or 30 days on a
line of time; a line for each schedule and each storage location, ten at
most; and the band of the server. It gives the installation no single value,
no score and no percentage, and when nothing it read needs attention it says
so of what it read, never that all is well.

### The views of the ten kinds

**A page for each kind.** Backups, Restores, Schedules, Backup Storage
Locations, Volume Snapshot Locations, Backup Repositories, Pod Volume Backups,
Pod Volume Restores, Data Uploads and Data Downloads each have a list, searched
and sorted as the lists of Freelens are, with the view of an object over it. A
view leads to what its object names, such as its storage location, its
schedule, its backup or its restores, and back, and says why a name it shows
leads nowhere. The details Freelens shows of these objects gain a section of
Velero that reads them the same way.

**What Velero wrote, as it wrote it.** The phase of an operation and its
failure are two facts: a backup that is finalizing with an error is neither
finished nor healthy. What Velero does not report is said not reported, never
shown as healthy or as zero. The view of a backup counts its pod volume
backups and its data uploads by phase, and the view of a restore its pod
volume restores and its data downloads, each a way to its own view.

### The workspace of an operation

**Summary, Log, Results, Resources and Volumes.** The view of a backup or of a
restore is its workspace, in five tabs. Each tab after the summary shows a file
Velero wrote of the operation into its storage, and only when you ask for it:
opening the tab creates nothing, and shows the `DownloadRequest` its command
would create, which is created once you confirm it, with writes on. Velero
signs a URL for the request, which the main process uses and never shows; the
tab then says when the file was loaded, its size, and whether it came through
the cluster or directly from this machine.

- **Log**: the lines with their numbers, a search that counts its matches, a
  filter by level with the count of each, the choice to wrap long lines, and
  the copy of a line.
- **Results**: the errors, then the warnings, by Velero, cluster and
  namespace, with their counts.
- **Resources**: the resources by API version and kind, with their items and a
  filter; for a restore, what was done with each item.
- **Volumes**: a row for each volume, with its method, its result and its
  details.

A text can be saved to a file you choose, on this machine, for ten minutes at
most after it was loaded. A file Velero did not write is said with what the
phase of the operation means for it: an operation that failed its validation
has none. A store at a private address, a store reached from this machine
without encryption, and an origin the storage location does not give are
reached only once you allow them, in the tab, for that cluster; the target bar
lists what was allowed and takes it back. The extension deletes no request:
Velero removes each about ten minutes after it signed its URL.

### The server and its plugins

**Server**, a band of the Overview, asks the server of the installation which
Velero it runs and which plugins it loaded, through a `ServerStatusRequest`
created once you confirm it, with writes on. It shows the version, and how it
compares with the release the extension was reviewed against; the plugins by
kind; and the provider of each storage location, marked when no object store
plugin of that provider is loaded. A server that does not process the request
in ten seconds is said not to have answered, which is not said to be down.

### The adherence of the schedules

**Next run and Adherence.** For each schedule, the extension computes the run
Velero is to submit next, from the cron expression as the release reads it,
counted as its controller counts it, and says whether that run is awaited,
due, overdue, with since when and how many runs passed, or held by a backup in
progress, or whether, for an expression with no instant, Velero submits a
backup at every look, each with its reason in words. It says so in the list of
the Schedules, in the view of a schedule before the history of its backups, in
the details Freelens shows of it, and in the Overview. A paused schedule, or
one Velero refused, has no run, and says why. Where the extension cannot know,
as when the expression names no time zone and no backup of the installation
gives the one of the server, it says that it does not know, and why.

### Actions

**One object at a time, after a review.** Each action opens its workspace over
the view it is asked from: its form, then the review of the exact request,
then what Velero made of it.

- **Back up now**, in the view of a schedule: a backup made from the template
  of the schedule, as the command line of Velero makes it.
- **Create backup**, in the list of the Backups: a backup of the fields you
  set, with what Velero does with each field you leave unset.
- **Create schedule**, in the list of the Schedules: its cron expression
  checked as you type, and in the review its next five runs, or why they are
  not known.
- **Restore**, in the view of a backup or of the schedule that made it: the
  namespaces and the resources to take, each namespace of the backup mapped to
  another one if you choose, the cluster-scoped resources, and the policy for
  the resources that exist.
- **Pause** and **Resume**, in the view of a schedule, with whether the run
  that is due at the resume is skipped.
- **Delete backup**, in the view of a backup: a `DeleteBackupRequest`, with
  what Velero deletes with the backup.

The review shows the text the main process sends, byte for byte, beside what
it means; a restore and a deletion also ask for the name of the backup, typed.
Then the workspace reads what Velero made of the request and leads to the view
of the object: the answer of the API is never taken for a success.

### Writes, off by default

Writes are off for every cluster when Freelens starts, and the views only
read. **Turn writes on**, in the target bar, turns them on for the
installation that is selected, after a dialog that names it, its cluster and
the context of the cluster, and lists what the extension may then create. They
go off with **Turn writes off**, when another installation is selected, and
when the cluster is not connected any more. Each write is still confirmed
where it is asked for, and the main process refuses any write while writes are
off, or for another installation: [Safety](#safety) lists what the extension
writes.

## Limits

- **Proven on synthetic objects only.** The data movement, its data uploads
  and data downloads, and the phases of a failure other than FailedValidation
  were proven on objects made for the tests, not on objects a controller of
  Velero wrote, as [Compatibility](#compatibility) says.
- **Two platforms tested.** The checks ran on the two platforms
  [Compatibility](#compatibility) names; any other platform is untested.
- **No drop of a tarball.** As read in the source of Freelens 2.0.0, a tarball
  dropped on its window reaches the installer without the path of its file, so
  Install does not offer the drop: enter the path of the tarball, or choose it
  with Browse, as [From a release tarball](#from-a-release-tarball) says.
- **Not in 1.0.0.** Editing a schedule, planned for the next minor version;
  the panels that would show which namespaces and volumes the schedules and the
  backups cover; deleting a schedule, and deleting or changing a restore, a
  location or a repository; and any action on more than one object at a time.
  A backup, a schedule or a restore that needs a field its form does not
  offer, the hooks for instance, is made from the command line of Velero.
- **No contents of a backup.** The tabs load the log, the results, the
  resource list and the volume information of an operation; the contents of a
  backup are never downloaded.
- **Files of 16 MiB at most.** A tab loads a file of 16 MiB as it is stored
  and 64 MiB of text at most, and shows nothing of a larger one. Two files load
  at a time, and a third waits for its turn.
- **TLS always verified.** A storage location that asks, with
  `insecureSkipTLSVerify`, that its certificate is not verified is verified
  all the same: give it the certificate of its authority, as
  [A certificate is refused](#a-certificate-is-refused) says.
- **The time zone of the server is not read.** A schedule whose expression
  names no time zone runs in the zone of the server of Velero, which the
  extension does not read: it derives an offset from the backup of the latest
  submission of a schedule of the installation, approximate across a change of
  daylight saving time, and says that the next run is not known without one. A
  zone named in the expression, with `CRON_TZ=`, makes it known.
- **One object store plugin tested.** The tabs were tested with the plugin of
  [Compatibility](#compatibility). With another one, a tab may ask you once to
  allow downloads from the origin of the URLs it signs, for that storage
  location.

## Safety

The extension reads first. What it writes to a cluster is this, through the
main process, and nothing else:

<!-- markdownlint-disable MD013 -->

| Write | Kind | Asked from |
| --- | --- | --- |
| Create | `DownloadRequest` | The Log, Results, Resources and Volumes tabs of a backup or of a restore |
| Create | `ServerStatusRequest` | The version of the server and its plugins, in the Overview |
| Create | `Backup` | Back up now, in the view of a schedule, and Create backup, from the list of the Backups |
| Create | `Schedule` | Create schedule, from the list of the Schedules |
| Create | `Restore` | Restore, in the view of a backup or of the schedule that made it |
| Create | `DeleteBackupRequest` | Delete backup, in the view of a backup |
| Patch of `spec.paused` and `spec.skipImmediately` | `Schedule` | Pause and Resume, in the view of a schedule |

<!-- markdownlint-enable MD013 -->

The rules every write follows, and the ones the extension keeps, binding for
every contributor in [AGENTS.md](AGENTS.md):

- Each write is refused unless writes are on for that cluster and that Velero
  namespace, which they are not until they are turned on in the target bar, and
  its review is confirmed: the review shows the exact request before it is
  sent. The main process enforces both.
- A restore and a deletion ask for the name of the backup, typed.
- A backup is deleted only through a `DeleteBackupRequest`, one at a time, and
  never by a deletion of the `Backup` itself.
- Signed URLs stay in the main process and are never logged, stored or shown.
  The content of a backup is never downloaded.
- TLS is verified by default, with the certificate authority the storage
  location declares. Skipping the verification is never an automatic
  fallback.
- Missing or unreadable data is shown as unknown, never as healthy.

## Troubleshooting

The words quoted below are the ones the extension shows, where `<namespace>`
stands for the namespace of the installation and `<request>` for the name of a
`DownloadRequest`. A tab that ended without its file can ask for it again,
which creates another `DownloadRequest`.

### A list or an action is refused

The API server refused to the identity of the connection Freelens has to the
cluster what the extension asked. A list the identity may not read says so in
the place of its rows, the list of the Backups for instance:

> The backups of `<namespace>` are not shown
>
> Access to the backups of this namespace is denied. How many there are is not
> known.

The other lists, and what was read before, are shown all the same. An action,
a tab or the band of the server ends with what the identity may not do, and
writes nothing:

<!-- markdownlint-disable MD013 -->

| Asked from | The words |
| --- | --- |
| Back up now, Create backup | The identity of this cluster may not create a backup in `<namespace>`: nothing was created. |
| Restore | The identity of this cluster may not create restores in `<namespace>`: nothing was created. |
| Create schedule | The identity of this cluster may not create schedules in `<namespace>`: nothing was created. |
| Pause, Resume | The identity of this cluster may not patch schedules in `<namespace>`: nothing was patched. The velero command line replaces the whole schedule, with the verb update; this extension patches it, and needs the verb patch. |
| Delete backup | The identity of this cluster may not create a DeleteBackupRequest in `<namespace>`: nothing was created. |
| The Log, Results, Resources and Volumes tabs | The cluster refused the creation of a DownloadRequest: the identity needs the verb create on downloadrequests of the namespace. |
| Server, in the Overview | The cluster refused the creation of a ServerStatusRequest: the identity needs the verb create on serverstatusrequests of the namespace. |

<!-- markdownlint-enable MD013 -->

What to do: give the identity what it lacks, the verb the words name for an
action, in the namespace of the installation. [Permissions](#permissions)
lists the verbs of each feature, with a role that reads the views and a role
for the actions.

A list is said denied as well when the cluster did not take the credential of
the context, as a token that expired. An action tells it apart:

> The cluster did not take the credential of the context: it may have expired.
> Sign in again, then ask again. Nothing was created.

What to do then: renew the credential of the context, as its kubeconfig and
its provider say, and ask again.

### A port-forward is refused

When the URL Velero signs for a file names a Service of the cluster, as for a
store that runs in the cluster, the extension reaches the store through the
cluster: it reads the Service, its endpoint slices and the Pod behind it, then
opens a port-forward to that Pod through the API server, with the kubectl of
Freelens and the identity of the connection. When the identity may not, the
tab says:

> The cluster refused the port-forward to the Pod of the store: the route
> through the cluster needs the verb create on pods/portforward. The
> DownloadRequest `<request>` stays in `<namespace>` until Velero removes it.

A read before it that is refused is said the same way, with the verb it
needs: `get` on `services`, `list` on `endpointslices` or `get` on `pods`.

What to do: grant `create` on `pods/portforward` in the namespace of the Pod
of the store, as [Permissions](#permissions) says, then load the tab again.
kubectl 1.31 and later asks for `get` on `pods/portforward` first, and falls
back to `create` when it is refused: grant `get` as well to keep that refusal
out of the audit log of the cluster.

### A certificate is refused

The extension verifies TLS with the certificates Freelens trusts and the
certificate authority the storage location names, and never connects without
the verification. When the certificate of the store is not trusted, the tab
says:

> The certificate of the store is not trusted. The storage location can name
> the certificate of its authority; the verification is never turned off. The
> DownloadRequest `<request>` stays in `<namespace>` until Velero removes it.

When the storage location asks, with `insecureSkipTLSVerify` in its
configuration, that its certificate is not verified, the tab says instead:

> The certificate of the store is not trusted. The storage location asks, with
> insecureSkipTLSVerify, that the certificate is not verified: the extension
> verifies it all the same. The storage location can name the certificate of
> its authority. The DownloadRequest `<request>` stays in `<namespace>` until
> Velero removes it.

A handshake that failed with no certificate refused is told apart:

> The handshake of TLS with the store failed, and no certificate was refused:
> the store may not speak TLS at the port of its URL, or a version of it the
> extension does not, or the connection was closed while it was made. The
> DownloadRequest `<request>` stays in `<namespace>` until Velero removes it.

What to do: give the storage location the certificate of the authority that
signed the certificate of the store, in a Secret of its namespace that
`spec.objectStorage.caCertRef` names, which the identity needs `get` on, or in
the older inline `spec.objectStorage.caCert`; then load the tab again. For a
handshake that failed, check the scheme and the port of the URL of the store.
TLS is verified by default, as [Safety](#safety) says.

### The cluster is not connected

The extension reads the state of the cluster in Freelens before every
request, asks nothing of a cluster that is not connected, and never connects
one. A tab, the band of the server, an action or **Turn writes on** then ends
with these words, which a tab and the band may follow with what became of
their request:

> The cluster is not connected in Freelens: the extension asks nothing of a
> cluster that is not connected, and does not connect it.

Writes go off for that cluster. What to do: connect the cluster in Freelens,
turn writes on again if you need them, and ask again.

### The store does not answer

A file comes from the store of the storage location, at the address of the URL
Velero signs for it: directly from this machine, or through the cluster when
that address names a Service of the cluster. When the store does not answer
there, the tab says one of these:

> The store could not be reached. The DownloadRequest `<request>` stays in
> `<namespace>` until Velero removes it.
>
> The store did not answer in time. The DownloadRequest `<request>` stays in
> `<namespace>` until Velero removes it.

For a store that runs in the cluster with no Pod ready:

> The Service of the store has no Pod that is ready, among the ones it
> selects, to send the request to. The DownloadRequest `<request>` stays in
> `<namespace>` until Velero removes it.

Before the store is asked, Velero signs the URL, and a server that does not is
said apart:

> Velero did not sign a URL in thirty seconds: its server may be stopped or
> busy, or it could not open the storage location. The DownloadRequest
> `<request>` stays in `<namespace>` until Velero removes it.

What to do: open the view of the storage location, which says what Velero
reports of it and where it points; check that the store answers at that
address from this machine, or that its Pods are ready in the cluster, and that
the server of Velero runs, which the band Server of the Overview asks. Then
load the tab again.

## Development

The repository is developed spec-first, with the specs in the repository:

- [PROCESS.md](docs/development/PROCESS.md): the spec-driven workflow, the
  manual verification escalation and the milestone review gate.
- [ROADMAP.md](docs/development/ROADMAP.md): scope and progress.
- [ARCHITECTURE.md](docs/development/ARCHITECTURE.md): renderer and main
  process roles, target identity, the create-only adapter, the transport.
- [DESIGN.md](docs/development/DESIGN.md): operator journeys, presentation,
  status semantics.
- [TESTING.md](docs/development/TESTING.md): the test layers and the evidence
  of the foundation.
- [TRY-IT.md](docs/development/TRY-IT.md): the views on the demo cluster, step
  by step.
- [DEPENDENCY-AUDIT.md](docs/development/DEPENDENCY-AUDIT.md): what the
  package bundles.
- [docs/specs](docs/specs/): one spec per feature, with the
  [index](docs/specs/README.md) that allocates the requirement identifiers.

### Local gates

Node.js 24.21.0 (`.nvmrc` / `mise.toml`) and `corepack pnpm`, pnpm 12. Run the
gates of [Check the code](#check-the-code) after every change.

The build is one form, the one that gets packed: `pnpm build` writes
`dist/main.js`, `dist/renderer.js`, their source maps and `dist/renderer.css`,
and the build test of `pnpm test:unit` reads those files and loads both
bundles.

### Test environment

The scripts under [e2e/scripts](e2e/scripts/) create a dedicated kind cluster
with Velero, its AWS plugin and SeaweedFS as the S3 backend, every image an
official release pinned by digest. They run real backups and restores of
synthetic data and fetch their logs and results through the code of the main
process. They run on Linux and on macOS with Docker Desktop, x64 and ARM64,
and on the hosted runner on main, every night and for every pull request that
changes what they run.

```sh
pnpm e2e:cluster:up     # the cluster with Velero and the storage
pnpm e2e                # the fixtures and the transport proof
pnpm e2e:cluster:down   # removes what the first command created
```

Docker needs four processors and 6 GiB of memory. kind and kubectl are installed
by the first command under the private state of the environment, not on the
machine. The commands and the evidence are in
[TESTING.md](docs/development/TESTING.md#end-to-end-tests), the choice of the
backend in [LOCAL-STORAGE.md](docs/development/LOCAL-STORAGE.md).

The views are driven in a packaged Freelens against the same environment, with
its fixtures left in place, and the integration test against the CRDs of the
release alone:

<!-- markdownlint-disable MD013 -->

```sh
pnpm demo:up            # the environment with the fixtures left in place
pnpm e2e:views          # the suites of the views, in the Freelens FREELENS_APP names
pnpm pre-review         # both themes, the sizes of the window, the keyboard

pnpm e2e:cluster:up:definitions   # the cluster with the CRDs of the release alone
pnpm e2e:integration    # the integration test, a session for each of the ten kinds
```

<!-- markdownlint-enable MD013 -->

They start the Freelens that `FREELENS_APP` names: on a machine of a
developer, the package of the validation target, its download checked against
the checksum the release publishes; in CI, Freelens built from source at that
commit. See [TESTING.md](docs/development/TESTING.md#suites-of-the-views).

No cloud account and no personal credential is needed. Every write of
development and tests goes to that disposable cluster, never to another one.

## Build from the source

### Prerequisites

Use [NVM](https://github.com/nvm-sh/nvm),
[mise-en-place](https://mise.jdx.dev/), or
[windows-nvm](https://github.com/coreybutler/nvm-windows) to install the
Node.js version in `.nvmrc`.

From the root of this repository:

```sh
nvm install
# or
mise install
# or
winget install CoreyButler.NVMforWindows
nvm install "$(cat .nvmrc)"
nvm use "$(cat .nvmrc)"
```

Install pnpm:

```sh
corepack install
# or
curl -fsSL https://get.pnpm.io/install.sh | sh -
# or
winget install pnpm.pnpm
```

### Build extension

```sh
pnpm install
pnpm build
```

The extension is built into `dist/`. To pack it into a tarball:

```sh
pnpm pack
```

One script to bump a throwaway prerelease version, build and pack the
extension for testing:

```sh
pnpm pack:dev
```

The tarball, `freelensapp-velero-extension-<version>.tgz`, is placed in the
root of the repository. The version bump makes Freelens treat each rebuild as
an upgrade, so installing it again loads your changes. Install it as described
in [From a release tarball](#from-a-release-tarball), then put the version back
with `git checkout package.json`, so that the bump reaches no commit.

### Development loop

Install the extension from your checkout once, as described in
[From a directory](#from-a-directory), then run:

```sh
pnpm dev
```

It runs the build of the renderer and the build of the main process in watch
mode, and Freelens reloads the extension after each rebuild, without a restart
and without packing. Stop it with `ctrl`+`C`.

Neither `pnpm build` nor `pnpm dev` type-checks; run `pnpm type:check` for
that. A change to `main` or `renderer` in `package.json` needs Freelens
restarted once.

### Check the code

```sh
pnpm type:check
pnpm lint:check     # biome (lint:fix to auto-format)
pnpm test:unit      # builds first, then the tests, then the measures alone
pnpm knip:check
pnpm trunk:check    # the formats Biome does not cover, on the changed files
```

### Integration tests

The integration test runs in the packaged Freelens that `FREELENS_APP` names,
a bundle, a folder or an executable, never one installed in `/Applications`: on
a machine of a developer, the package of the validation target, its download
checked against the checksum its release publishes. Its first case installs the
packed extension from the Extensions page and checks that it is listed as
enabled, that both of its parts load and that its downloads work in the main
process of Freelens; then a session for each of the ten kinds checks its page,
its section in the details and its menu, against a disposable kind cluster with
the CRDs of the reviewed release of Velero alone. With Docker, in the extension
repository:

```sh
pnpm e2e:cluster:up:definitions
pnpm e2e:integration
pnpm e2e:cluster:down
```

`pnpm e2e:integration` builds and packs the extension first. The suites of the
views run the same way against the environment of `pnpm demo:up`: see
[Test environment](#test-environment) and
[TESTING.md](docs/development/TESTING.md#integration-tests).

### Testing the extension with unpublished Freelens

In the Freelens working repository:

```sh
rm -f *.tgz
pnpm i
pnpm build
pnpm pack -r
```

Then in the extension repository:

```sh
echo "overrides:" >> pnpm-workspace.yaml
for i in ../freelens/*.tgz; do
  name=$(tar zxOf $i package/package.json | yq -r .name)
  echo "  \"$name\": $i" >> pnpm-workspace.yaml
done

pnpm clean:node_modules
pnpm build
```

## License

Copyright (c) 2025-2026 Freelens Authors.

[MIT License](https://opensource.org/licenses/MIT)
