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

The prereleases of 1.0.0 are published on npm under the tag `next`, each with
a GitHub release marked as a prerelease, and 1.0.0 is not released yet: until it
is, install the extension by the tag `next` or by a version, as
[Install](#install) says. What each version brings is in the
[changelog](CHANGELOG.md). What 1.0.0 covers, by milestone:

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

## Supported APIs

The kinds of Velero the extension reads, each namespaced, with its page in the
sidebar, a view of each object, and a section in the details Freelens shows of
it. What the extension writes, once writes are on, is in [Safety](#safety).

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

Enter one of these and press Install:

<!-- markdownlint-disable MD013 -->

| Entered | What Freelens installs |
| --- | --- |
| `@freelensapp/velero-extension` | The newest version that is not a prerelease, whatever an npm tag names. Until 1.0.0 is published every version is a prerelease, and Freelens answers `No versions found for @freelensapp/velero-extension` |
| `@freelensapp/velero-extension@next` | The version the npm tag `next` names: the newest prerelease, which can be older than the newest release |
| `@freelensapp/velero-extension@<version>` | That version, for instance `@freelensapp/velero-extension@1.0.0-0` |

<!-- markdownlint-enable MD013 -->

Freelens reads the package from the registry its preferences name, the npm
registry unless they name another, checks the download against the integrity
the registry gives for that version, then installs the extension, enables it
and lists it as verified.

Alternatively, open the following URL in the browser to install the version the
tag `next` names directly, once Freelens has asked you to confirm it:

[freelens://app/extensions/install/@freelensapp/velero-extension?version=next](freelens://app/extensions/install/@freelensapp/velero-extension?version=next)

### From a release tarball

Each [release](https://github.com/freelensapp/freelens-velero-extension/releases)
has the extension as `freelensapp-velero-extension-<version>.tgz`, with its
checksum in `freelensapp-velero-extension-<version>.tgz.sha256`.

- Enter the URL of the `.tgz` asset and press Install. Freelens downloads the
  `.tgz.sha256` next to it and checks the tarball against it.
- Or download both files into one directory, check them as
  [Verify a release](#verify-a-release) says, and enter the path to the `.tgz`,
  or choose it with Browse, the folder icon of the field. Freelens checks it
  against the `.tgz.sha256` next to it.

Freelens refuses a tarball that does not match its `.tgz.sha256`, and lists one
that matches as verified. A tarball with no `.tgz.sha256` next to it is
installed with a notice that nothing vouches for its integrity, and listed as
unverified.

### From a directory

Build the extension (see [Build from the source](#build-from-the-source)),
then enter the path to your checkout, the directory with `package.json`, and
press Install. Once you confirm, Freelens runs the extension from that
directory, from the files in `dist/`, and lists it as development: nothing of
it is verified. This is how you work on the extension: see
[Development loop](#development-loop).

### Verify a release

The GitHub release of a version carries four files, where `<version>` is the
version, for instance `1.0.0-0`:

<!-- markdownlint-disable MD013 -->

| File | What it is |
| --- | --- |
| `freelensapp-velero-extension-<version>.tgz` | The package |
| `freelensapp-velero-extension-<version>.tgz.sha256` | The SHA-256 checksum of the package |
| `freelensapp-velero-extension-<version>-spdx.json` | The software bill of materials of the package, in SPDX JSON |
| `freelensapp-velero-extension-<version>-spdx.json.sha256` | The SHA-256 checksum of the bill of materials |

<!-- markdownlint-enable MD013 -->

Download a file and its `.sha256` into one directory, and check one against the
other in that directory. On Linux:

```sh
sha256sum -c freelensapp-velero-extension-<version>.tgz.sha256
```

On macOS:

```sh
shasum -a 256 -c freelensapp-velero-extension-<version>.tgz.sha256
```

Both print the name of the file followed by `OK` when it matches. On Windows,
in PowerShell, this line prints `True` when it matches:

<!-- markdownlint-disable MD013 -->

```powershell
(Get-FileHash -Algorithm SHA256 freelensapp-velero-extension-<version>.tgz).Hash -eq ((Get-Content freelensapp-velero-extension-<version>.tgz.sha256) -split '\s+')[0]
```

<!-- markdownlint-enable MD013 -->

The same commands check the bill of materials, with
`freelensapp-velero-extension-<version>-spdx.json.sha256` and
`freelensapp-velero-extension-<version>-spdx.json`.

The package on npm carries a provenance attestation, which states the workflow
of this repository that built and published it, its tag and its commit. Check it
in a new directory, with a project that installs the package:

```sh
npm init -y
npm install @freelensapp/velero-extension@<version>
npm audit signatures
```

`npm audit signatures` says how many of the installed packages have verified
registry signatures and how many have verified attestations, and lists any that
does not verify.

The bill of materials lists what the package carries: the extension, and the
libraries its bundles carry, react-window alone, at the versions of the lockfile
of the release. It lists no devDependency, since none is in the package, and no
peer dependency: react and react-dom, which react-window asks for, are the ones
of Freelens.

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

The rules the extension is built on, binding for every contributor in
[AGENTS.md](AGENTS.md):

- Reading comes first. Every write needs the write mode, which starts
  disabled, belongs to one cluster and one Velero namespace, and is enforced
  in the main process, and a confirmation that names the context and the
  namespace.
- Fetching a log or the server version creates a `DownloadRequest` or a
  `ServerStatusRequest` in the cluster: it is a write and it is treated as
  one.
- A backup is deleted through a `DeleteBackupRequest` only, one at a time,
  with a double confirmation.
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
local gates after every change:

```sh
pnpm type:check
pnpm lint:check     # biome (lint:fix to auto-format)
pnpm test:unit      # builds first, then the tests, then the measures alone
pnpm knip:check
pnpm trunk:check
```

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
developer, the nightly of the validation target, its download checked against
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
in [From a release tarball](#from-a-release-tarball).

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
pnpm test:unit
pnpm lint:check
pnpm knip:check
```

and, for the formats that Biome does not cover:

```sh
pnpm trunk:check
```

### Integration tests

The integration test, FND-10 and a session for each of the ten kinds, installs
the packed extension in the Freelens that `FREELENS_APP` names, against a
disposable kind cluster with the CRDs of the reviewed release of Velero alone.
With Docker, in the extension repository:

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
