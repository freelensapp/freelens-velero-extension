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
it. What the extension writes, once writes are on, is in
[Write actions](#write-actions): it reads back the requests it creates there, a
`DownloadRequest`, a `ServerStatusRequest` and a `DeleteBackupRequest`, which
have no page.

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
signs a URL for the request, which the main process uses and never shows. The
file comes from the store at the address of that URL: through the cluster, by
a port-forward to the Pod of the store opened through the API server, when the
address names a Service of the cluster, and directly from this machine
otherwise, where the store must answer at that address, which is never one of
this machine, of the link or of a metadata service. The tab says which way the
file came, when it was loaded and its size.

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
reached only once you allow them, in the tab, for that cluster. What you allow
is kept, after a restart of Freelens too, until you take it back in the target
bar, which lists it. The extension deletes no request: Velero removes one about
ten minutes after it signed its URL, and one that no server of Velero processes
stays.

### The server and its plugins

**Server**, a band of the Overview, asks the server of the installation which
Velero it runs and which plugins it loaded, through a `ServerStatusRequest`
created once you confirm it, with writes on. It shows the version, and how it
compares with the release the extension was reviewed against; the plugins by
kind; and the provider of each storage location, marked when no object store
plugin of that provider is loaded. A server that does not process the request
in ten seconds is said not to have answered, which is not said to be down. The
request stays until the server processes it: the extension deletes none.

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

### Write actions

**Off until you turn them on.** Writes are off for every cluster when Freelens
starts, and the views only read. **Turn writes on**, in the target bar, turns
them on for the installation that is selected, the namespace of Velero in that
cluster, after a dialog that names it, its cluster and the context of the
cluster, and lists what the extension may then create. They go off with **Turn
writes off**, when another installation is selected, and when the cluster is
not connected any more. The main process refuses every write while writes are
off, and every write for another cluster or another namespace.

**One object at a time, after a review.** Each action opens its workspace over
the view it is asked from: its form, then the review of the exact request,
then what Velero made of it. The review shows the text the main process sends,
byte for byte, beside what it means; a restore and a deletion also ask for the
name of the backup, typed. After the confirmation, the workspace reads what
Velero made of the request and leads to the view of the object: the answer of
the API is never taken for a success.

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
- **Delete backup**, in the view of a backup: one `DeleteBackupRequest`, with
  what Velero deletes with the backup, which cannot be undone: its snapshots,
  the data it moved, its files in the store and its restores. A backup is
  deleted only this way, one at a time, and never by a deletion of the `Backup`
  itself.

What the extension writes to a cluster is this, through the main process, and
nothing else. A tab and the band of the server show the request they would
create, and create it once you confirm it, as an action does:

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

The rules the extension keeps beside them, binding for every contributor in
[AGENTS.md](AGENTS.md):

- Signed URLs stay in the main process and are never logged, stored or shown.
  The content of a backup is never downloaded.
- TLS is verified by default, with the certificate authority the storage
  location declares, and this version never skips the verification, on
  request or as a fallback.
- Missing or unreadable data is shown as unknown, never as healthy.

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
  all the same. Give the storage location the certificate of the authority
  that signed the certificate of its store instead: in a Secret of its
  namespace that `spec.objectStorage.caCertRef` names, or inline in
  `spec.objectStorage.caCert`, the older form.
- **The time zone of the server is not read.** A schedule whose expression
  names no time zone runs in the zone of the server of Velero, which the
  extension does not read: it derives an offset from the backup of the latest
  submission of a schedule of the installation, approximate across a change of
  daylight saving time, and says that the next run is not known without one. A
  zone named in the expression, with `CRON_TZ=`, makes it known.
- **One object store plugin tested.** The tabs were tested with the plugin of
  [Compatibility](#compatibility). With another one, a tab asks you once to
  allow downloads from the origin of the URLs it signs, for that storage
  location.
- **Denied, or a credential not taken.** A list says that access is denied
  both when the identity may not read it and when the cluster did not take the
  credential of the context, as a token that expired. An action, a tab and the
  band of the server tell the two apart, and say to sign in again for the
  second.

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
