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
- **An identity with the permissions of [Permissions](#permissions).** The
  extension works with the identity of the connection Freelens has to the
  cluster: the role that reads the views is enough to look, and the role of the
  actions to act.
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

## Permissions

The extension reaches the cluster with the identity of the connection Freelens
has to it: it reads no kubeconfig and holds no credential of its own. What each
feature asks of that identity is below, each verb one the extension sends. The
discovery of the group `velero.io`, which Kubernetes allows every authenticated
identity through the ClusterRole `system:discovery`, needs no rule of its own.

<!-- markdownlint-disable MD013 -->

| Feature | API group | Verbs on resources | Scope |
| --- | --- | --- | --- |
| The views | `velero.io` | `list` on `backups`, `restores`, `schedules`, `backupstoragelocations`, `volumesnapshotlocations`, `backuprepositories`, `podvolumebackups`, `podvolumerestores`, `datauploads` and `datadownloads` | The namespace of the installation |
| Where the installations are, optional | `velero.io` | `list` on `backupstoragelocations` | The whole cluster |
| The Log, Results, Resources and Volumes tabs | `velero.io` | `get` on `backups`, `restores` and `backupstoragelocations`; `create` and `get` on `downloadrequests` | The namespace of the installation |
| A download through the cluster | core and `discovery.k8s.io` | `get` on `services` and `pods`, and `create` on `pods/portforward`, of the core group; `list` on `endpointslices` | The namespace of the Service of the store, or the one a host of one or two labels names, as below |
| A certificate authority in a Secret, optional | core | `get` on `secrets`, for the Secret the storage location names | The namespace of the installation |
| The version of the server | `velero.io` | `create` and `get` on `serverstatusrequests` | The namespace of the installation |
| Back up now | `velero.io` | `get` on `schedules`; `create` on `backups`, and `get` on them, optional | The namespace of the installation |
| Create backup | `velero.io` | `get` on `backupstoragelocations` and `volumesnapshotlocations`; `create` on `backups`, and `get` on them, optional | The namespace of the installation |
| Create schedule | `velero.io` | `get` on `backupstoragelocations` and `volumesnapshotlocations`; `create` on `schedules`, and `get` on them, optional | The namespace of the installation |
| Restore | `velero.io` | `get` on `backups`; `create` on `restores`, and `get` on them, optional | The namespace of the installation |
| Pause and Resume | `velero.io` | `patch` on `schedules`, and `get` on them, optional | The namespace of the installation |
| Delete backup | `velero.io` | `get` on `backups`; `create` on `deletebackuprequests`, and `get` and `list` on them, optional | The namespace of the installation |

<!-- markdownlint-enable MD013 -->

What is optional, and what goes without it:

- `list` on `backupstoragelocations` in the whole cluster: without it the views
  do not suggest where Velero is installed, and you name the namespace in the
  target bar.
- `get` and `list` on `deletebackuprequests`: without them the review of Delete
  backup says that the other requests of the backup could not be read, and the
  deletion is followed by the backup alone.
- `get` on what an action creates or patches, for the reads after it:
  `backups` after Back up now and Create backup, `schedules` after Create
  schedule and after Pause and Resume, `restores` after Restore. Without it the
  action is made all the same: its workspace does not follow the phase Velero
  writes, a pause or a resume is shown as the answer of its patch, and a
  creation or a patch whose answer was lost cannot be looked for.
- `get` on `volumesnapshotlocations`: only for a template of Create backup or
  Create schedule that names a volume snapshot location. Without it the write
  of such a template ends at the read of the locations, and nothing is sent.
- The rules of a download through the cluster: when the URL the server signs
  names a Service of the cluster, in the namespace of that Service. A host of
  one label or two, as `minio` or `minio.storage`, is looked for as a Service
  first, whatever the store is: `get` on `services` is asked in the namespace
  its second label names, or in the one of the installation when it has one
  label, and a refusal ends the tab at the step of the Service. A store outside
  the cluster named that way is reached with a longer name, or with `get` on
  `services` where its second label points, through a ClusterRole when that
  label is no namespace.
- `get` on `pods/portforward`, which the roles below do not grant: kubectl 1.31
  and later asks for a port-forward with `get` first, over a WebSocket, and
  falls back to `create`. Grant `get` as well to keep the refused `get` out of
  the audit log of the cluster.
- `get` on `secrets`, which the roles below do not grant: only for a storage
  location that names a Secret for its certificate authority, in
  `spec.objectStorage.caCertRef`. Grant it for that Secret alone, by its name in
  `resourceNames`. Without it the tabs of the operations of that location stop
  at the step of the certificate, before anything is created.

A family the identity may not list is shown as denied, never as empty, and the
other families are shown all the same. A tab or an action the identity may not
use ends at the step that is refused, with the words of what the identity may
not do. Freelens itself asks for what its own views need beside this, among it
the list of the namespaces, which three forms use: Create backup and Create
schedule offer the namespaces to include or to exclude, and stop before its
review a template that includes one labelled `velero.io/exclude-from-backup`,
which Velero would fail; Restore offers the targets of its mapping and says
whether a target is listed. Without that list the namespaces are typed, such a
template is not stopped before Velero fails it, and the review of a restore says
that whether a target is listed is not known.

The two roles below are written for an installation in the namespace `velero`,
the one `velero install` uses unless told otherwise: put the namespace of yours
in its place. Each is a Role of that namespace, for what is namespaced, and a
ClusterRole for the one list of the whole cluster. The test environment of this
repository binds an identity to each and runs its checks with it.

### The role that reads the views

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: freelens-velero-reader
  namespace: velero
rules:
  - apiGroups: ["velero.io"]
    resources:
      - backups
      - restores
      - schedules
      - backupstoragelocations
      - volumesnapshotlocations
      - backuprepositories
      - podvolumebackups
      - podvolumerestores
      - datauploads
      - datadownloads
    verbs: ["list"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: freelens-velero-reader
rules:
  - apiGroups: ["velero.io"]
    resources:
      - backupstoragelocations
    verbs: ["list"]
```

### The role of the actions

For the views, the tabs, a download through the cluster, the version of the
server and every action:

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: freelens-velero-operator
  namespace: velero
rules:
  - apiGroups: ["velero.io"]
    resources:
      - backups
      - restores
    verbs: ["get", "list", "create"]
  - apiGroups: ["velero.io"]
    resources:
      - schedules
    verbs: ["get", "list", "create", "patch"]
  - apiGroups: ["velero.io"]
    resources:
      - backupstoragelocations
      - volumesnapshotlocations
    verbs: ["get", "list"]
  - apiGroups: ["velero.io"]
    resources:
      - backuprepositories
      - podvolumebackups
      - podvolumerestores
      - datauploads
      - datadownloads
    verbs: ["list"]
  - apiGroups: ["velero.io"]
    resources:
      - downloadrequests
      - serverstatusrequests
    verbs: ["create", "get"]
  - apiGroups: ["velero.io"]
    resources:
      - deletebackuprequests
    verbs: ["create", "get", "list"]
  - apiGroups: [""]
    resources:
      - services
      - pods
    verbs: ["get"]
  - apiGroups: [""]
    resources:
      - pods/portforward
    verbs: ["create"]
  - apiGroups: ["discovery.k8s.io"]
    resources:
      - endpointslices
    verbs: ["list"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: freelens-velero-operator
rules:
  - apiGroups: ["velero.io"]
    resources:
      - backupstoragelocations
    verbs: ["list"]
```

Bind each to the identity of the connection: its Role in the namespace of the
installation, its ClusterRole in the whole cluster. For a user, with the role of
the actions:

<!-- markdownlint-disable MD013 -->

```sh
kubectl create rolebinding freelens-velero-operator --role=freelens-velero-operator --user=<user> --namespace=velero
kubectl create clusterrolebinding freelens-velero-operator --clusterrole=freelens-velero-operator --user=<user>
```

<!-- markdownlint-enable MD013 -->

`--group` and `--serviceaccount` bind a group or a service account the same
way.

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
