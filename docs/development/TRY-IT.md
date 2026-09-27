# Try it: the views on the demo cluster

This is the path of the review of a milestone
([PROCESS.md](PROCESS.md#milestone-manual-review-gate)) and the quickest way to
look at the extension: the kind cluster of the test environment, with a real
Velero that made a real backup and a real restore of synthetic data, and beside
them the synthetic objects that show what a real installation shows once in a
while: every phase, references that lead nowhere, a list of a thousand backups.

Everything here is local and synthetic. The extension reads the cluster the
views are opened for and no other, and in this milestone it only reads.

## What you need

- Docker with four processors and 6 GiB of memory, Node.js of `.nvmrc` and
  `corepack pnpm`. kind and kubectl are installed by the first command, under
  the private state of the environment.
- Freelens 1.10.3.

## 1. Bring the demo up

```sh
pnpm install
pnpm demo:up
pnpm demo:views
```

The first command takes about ten minutes the first time: the images are pulled,
the cluster is created, the storage and Velero are installed, a backup and a
restore are run. The second adds what the views need and ends by saying where
the two kubeconfigs are, both under `~/.local/state/freelens-velero-dev`:

| Kubeconfig | Identity | What it reads |
| --- | --- | --- |
| `kubeconfig` | The administrator of the demo cluster | Everything |
| `views-reader.json` | A service account, with a credential that lasts eight hours | The backups, the schedules and the storage locations of one namespace |

| Namespace | What is in it |
| --- | --- |
| `velero-demo` | The installation: Velero, its storage location, the real backup and its restore |
| `velero-static-<run>` | A backup and a restore for every phase, three schedules, storage locations that are available and not |
| `velero-views-<run>` | A backup with every reference in place, backups that name what is not there, a name of 63 characters, a backup that reports nothing |
| `velero-scale-<run>` | A thousand backups and no storage location |

`<run>` is the identifier of the fixtures, eight characters the second command
prints.

## 2. Install the extension in Freelens

```sh
pnpm build:production && pnpm clean:tgz && pnpm pack
```

In Freelens, Extensions, give the path of the tarball that is now in the
repository and install it. Then add the kubeconfig of the demo: in the catalog,
the button that adds, "Sync file(s)", and the file `kubeconfig` of the private
state. The cluster is `kind-freelens-velero-dev`.

## 3. Walk through it

Open the cluster and, in its sidebar, Velero.

| Step | What to look at |
| --- | --- |
| The first time | Three namespaces hold a storage location: the view asks which one, and chooses none |
| Choose `velero-static-<run>` | Thirteen backups, one for each phase. The phase says where the operation is, the failure is beside it: a backup that is finalizing with an error is neither finished nor healthy |
| Open `backup-finalizingpartiallyfailed` | All its items are done and it is in flight, with its error. The way back, and Escape, return to the list where it was |
| Open `backup-failedvalidation` | Why it failed, what it was asked to include, where it would have gone |
| Select `velero-views-<run>` in the target bar | Another installation: nothing of the one before is left. `backup-inprogress` is a name the two installations share, for two different backups |
| Open `views-daily-20260901030000` | Its schedule, its storage location, its snapshot location and its two restores |
| Open `backup-missing-location` and `backup-missing-schedule` | References to what is not there: a name with its reason, and no link |
| Other namespace, `velero-scale-<run>` | A namespace nothing suggests, read because it was named. A thousand backups: search, sort, drag the edge of a column, scroll, open one and come back |
| Custom Resources, `velero.io`, Backups | The page of the host. In the details of a backup the section of Velero reads it as the views do, and leads to the workspace when the backup is of the installation selected |
| Close Freelens and open it again | The namespace that was selected is the one shown |

With the keyboard alone: Tab reaches the choices, the search and the names of the
backups, Enter opens, Escape comes back and the focus is on the backup that was
open.

For the restricted access, add `views-reader.json` in the same way. It has the
same name as the first in the catalog: it is the one whose Velero asks for a
namespace instead of offering three. Name `velero-views-<run>`: the backups are
read, and the workspace of one says which of its references cannot be.

## 4. The pass that precedes a review

```sh
pnpm e2e:views
pnpm pre-review
```

They need a Freelens that was built: see
[TESTING.md](TESTING.md#suites-of-the-views). The first runs the suites of the
views, the second every view in both themes, at two sizes of the window and at
twice the zoom, and the journey with the keyboard. Their screenshots and their
measures are in `e2e-artifacts/`.

## 5. Take it down

```sh
pnpm demo:down
```

It removes the cluster, its network and the private state, with the two
kubeconfigs. Remove the two clusters from the catalog of Freelens.
