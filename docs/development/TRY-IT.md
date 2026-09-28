# Try it: the views on the demo cluster

This is the path of the review of a milestone
([PROCESS.md](PROCESS.md#milestone-manual-review-gate)) and the quickest way to
look at the extension: the kind cluster of the test environment, with a real
Velero that made a real backup and a real restore of synthetic data, and beside
them the synthetic objects that show what a real installation shows once in a
while: every phase, references that lead nowhere, a list of a thousand backups.

Everything here is local and synthetic. The extension reads the cluster the
views are opened for and no other, and it only reads.

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
the three kubeconfigs are, all under `~/.local/state/freelens-velero-dev`:

| Kubeconfig | Identity | What it reads |
| --- | --- | --- |
| `kubeconfig` | The administrator of the demo cluster | Everything |
| `views-reader.json` | A service account, with a credential that lasts eight hours | The backups, the schedules and the storage locations of one namespace |
| `views-reader-of-restores.json` | A second service account, with a credential that lasts eight hours | The restores, the schedules and the locations of the same namespace, and not the backups |

An environment that was brought up before the fixtures changed keeps the ones it
has: what a fixture does not carry any more is not taken away from the object
that is on the cluster, and the command stops on a status that is not the one it
wrote. Take the environment down first, with `pnpm demo:down`.

| Namespace | What is in it |
| --- | --- |
| `velero-demo` | The installation: Velero, its storage location, the real backup and its restore |
| `velero-static-<run>` | A backup and a restore for every phase, three schedules, storage locations that are available and not |
| `velero-views-<run>` | A backup with every reference in place, backups that name what is not there, a name of 63 characters, a backup that reports nothing; a restore into two namespaces, one that failed its validation, one of a backup that is not there; a schedule with the history of a week, and the schedules Velero has not read |
| `velero-scale-<run>` | A thousand backups, a thousand restores and no storage location |

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

Open the cluster and, in its sidebar, Velero. Every page of Velero has the tabs
of the group over it, as the pages of the host have.

| Step | What to look at |
| --- | --- |
| The first time | Three namespaces hold a storage location: the view asks which one, and chooses none |
| Choose `velero-static-<run>` | Thirteen backups, one for each phase. The phase says where the operation is, the failure is beside it: a backup that is finalizing with an error is neither finished nor healthy. That nothing went wrong is marked of the backups Velero counted: one that waits, one that is at work and one that failed before it was counted say that no failure is reported, or the failure |
| Open `backup-finalizingpartiallyfailed` | All its items are done and it is in flight, with its error. The way back, and Escape, return to the list where it was |
| Open `backup-failedvalidation` | Why it failed, what it was asked to include, where it would have gone |
| Select `velero-views-<run>` in the target bar | Another installation: nothing of the one before is left. `backup-inprogress` is a name the two installations share, for two different backups |
| Open `views-daily-20260901030000` | Its schedule, its storage location, its snapshot location and its three restores |
| Open `backup-missing-location` and `backup-missing-schedule` | References to what is not there: a name with its reason, and no link |
| Other namespace, `velero-scale-<run>` | A namespace nothing suggests, read because it was named. A thousand backups: search, sort, drag the edge of a column, scroll, open one and come back |
| Custom Resources, `velero.io`, Backups | The page of the host. In the details of a backup the section of Velero reads it as the views do, and leads to the workspace when the backup is of the installation selected |
| Close Freelens and open it again | The namespace that was selected is the one shown |

Then the Restores, under Velero in the sidebar:

| Step | What to look at |
| --- | --- |
| Select `velero-static-<run>` | Ten restores, one for each phase. `restore-failedvalidation` never started: its start is not reported, and no time is made up for it |
| Select `velero-demo`, open the restore | The restore the controller ran. Its object carries no counter: Velero writes none when it counts none, and the view says whose zero its zero is |
| Select `velero-views-<run>`, open `restore-mapped` | A restore as Velero keeps one it took. It waits for an operation of a plugin with an error: all its items are done, it is in flight, and it failed in part. Under Into, each namespace of the backup beside the one it is restored into |
| Open `restore-of-daily-partiallyfailed` | It was finalized: its hooks were counted, two of which one failed |
| Its source | The backup and the schedule, both named by the object: Velero wrote one of the two, and the view says that the object does not tell which |
| Its scope | What is not set is said not set. Beside the excluded resources and the timeout, that Velero fills them |
| Follow the backup | The workspace of the backup opens over the list of the restores. The way back names where it leads, the restore, and from there the list |
| Backups, open `views-daily-20260901030000` | Its restores are ways to their views, and each view comes back to the backup |
| Open `restore-of-schedule` | It was asked from a schedule that has no backup: why it failed, and no backup made up for it |
| Open `restore-of-removed` | Its backup is not there any more: a name with its reason, and no way. It completed: the view says that completed is what Velero reports, and nothing of what was restored |
| Open the restore with the longest name | Its name, the one of its backup and the ones of the namespaces it maps have 63 characters each: all are read whole |
| Make the window wider than 1,600 pixels | The list shows the installation beside the name: in a narrower one the column gives its room to the ones that say what happened |
| Name `velero-scale-<run>` | A thousand restores: search by the name of a backup, sort, scroll, open one and come back |

Then the Schedules:

| Step | What to look at |
| --- | --- |
| Select `velero-static-<run>` | Three schedules. Paused and validation are two columns: `schedule-paused` is paused and Enabled, `schedule-invalid` is paused and refused. Open the second: its expression as it is written, and why Velero refused it |
| Select `velero-views-<run>` | Ten schedules. The last submission and the newest backup are side by side: `views-history` submitted a backup when the fixtures were put in place, and that backup failed its validation |
| Open `views-history` | Its history. The line of time goes from the oldest backup that exists to now: a mark for each backup, one for the two that are an hour apart, and nothing where no backup is. In an environment that is some weeks old the days are close on the line, and a mark holds more than one. The newest never started: it is at the time it was created, which is the last submission of the schedule, and says so |
| Click the mark with a 2 | The two backups of the mark are shown alone in the list. Show all brings the others back |
| Click another mark, or a name of the list | The workspace of the backup, over the list of the schedules. Its schedule is the way back |
| The template | What every backup is asked, as the schedule carries it, and where it goes |
| Open `views-to-archive` and `views-to-removed` | The backups go to a location that is read-only, and to one that is not there: the view says that the release refuses them |
| Open `views-to-default` | The template names no location: the view says which one is marked default |
| Open `views-zoned` | The time zone the expression names. The others are read in the time zone of the server, which the view does not read: no view says when a schedule runs next |
| Open `schedule-unread`, `schedule-unread-paused`, `schedule-skipping` | What Velero has not read, and what it will do when it reads it. A schedule Velero read says whether the run that is due is skipped, which Velero wrote into it |

With the keyboard alone: Tab reaches the choices, the search and the names of the
rows, Enter opens, Tab reaches the ways to the other views and the marks of a line
of time, Escape comes back and the focus is on the row that was open.

For the restricted access, add `views-reader.json` in the same way. It has the
same name as the first in the catalog: it is the one whose Velero asks for a
namespace instead of offering three. Name `velero-views-<run>`: the backups are
read, and the workspace of one says which of its references cannot be. With
`views-reader-of-restores.json` it is the other way round: the restores are read,
and the source of one is said denied, which is not said absent; the schedules are
read, and the history of one is said not known, which is not said empty.

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

It removes the cluster, its network and the private state, with the three
kubeconfigs. Remove the three clusters from the catalog of Freelens.
