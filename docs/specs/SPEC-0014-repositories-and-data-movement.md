# SPEC-0014: Read-Only Repositories, Pod Volume Operations And Data Movement

- **Status:** Approved
- **Date:** 2026-10-13
- **Milestone / tasks:** M4 / T5.1, T5.2
- **Reviewed Velero:** v1.18.4, `4ee1e79a7aed367fd9b767b8219ec65bd0c96892`
- **Reviewed main:** `c111008912919e6a1a4127b2a0b8a641ee2dad80`
- **Freelens validation target:** Freelens v2, the validation target of [SPEC-0015](SPEC-0015-freelens-v2-host.md), freelensapp/freelens `b9b53e16056578c5407312eba5823a089972f6d5`, the commit of the tag v2.0.0 of the release Freelens 2.0.0, to which the host drift watch moved it; this spec was drafted against v1.10.3, `3da74415bff57a77c6e08cb5f538191ce87bac17`, where the facts of the host below were read, and they were read again at the target with the first pull request of T5.1
- **Dependencies:** [target discovery](SPEC-0002-installation-discovery.md), [states and Backups](SPEC-0003-backup-read-only.md), [Restores](SPEC-0005-restore-read-only.md), [locations](SPEC-0007-locations-read-only.md), [the volume information of an operation](SPEC-0011-artifact-viewers.md)
- **Approval:** Approved by the lead maintainer on 2026-10-14, as drafted

Governed by [AGENTS.md](../../AGENTS.md).

## Goal

Let the operator see how the volume data of a backup or of a restore went, volume
by volume: the pod volume backups and restores of the file system backup, the
data uploads and downloads of the data movement, each with its phase, its bytes
and the node that moved them; and the backup repositories they write into, with
whether Velero can use each one and when it was last maintained. The extension
writes nothing of it.

## Scope Baseline

The [recon](../development/RECON-T0.1.md#crd-and-phase-contracts) confirms 13
namespaced kinds. The views show five of them; two more, DownloadRequest and
ServerStatusRequest, are created by the extension and shown as the request of a
tab or of the band of the server, not as kinds. This slice adds the five kinds
Velero writes of its own that remain: BackupRepository, PodVolumeBackup and
PodVolumeRestore of `velero.io/v1`, DataUpload and DataDownload of
`velero.io/v2alpha1`. The last of the thirteen, DeleteBackupRequest, is of the
actions (M5). The extension types none of the five today:
[`src/common/types.ts`](../../src/common/types.ts) has no interface for them,
the [reader](../../src/renderer/api/reader.ts) accepts paths of `velero.io/v1`
alone, and the [families](../../src/common/discovery.ts) of an installation are
the five of the first two milestones.

What the slice rests on, read in the source of the reviewed release and detailed
in the Design:

- The server runs the controller of the repositories
  ([server](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/cmd/server/server.go#L760-L775)).
  The four controllers of the operations run in the node agent, on every node,
  and each caches the four kinds of the installation namespace alone
  ([node agent](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/cmd/cli/nodeagent/server.go#L188-L199),
  [the controllers](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/cmd/cli/nodeagent/server.go#L389-L489)).
- A backup creates one PodVolumeBackup for each volume it backs up with the file
  system backup, owned by the backup, and waits for them while it is InProgress
  ([creation](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/podvolume/backupper.go#L372-L392),
  [the wait](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/backup/backup.go#L703-L704));
  a restore one PodVolumeRestore for each volume it restores that way
  ([creation](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/podvolume/restorer.go#L174-L194));
  the CSI plugin one DataUpload for each snapshot whose data is moved, as an
  operation of the backup, and one DataDownload for each volume restored from one
  ([upload](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/backup/actions/csi/pvc_action.go#L540-L597),
  [download](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/restore/actions/csi/pvc_action.go#L405-L453)).
- The test environment installs the server and the node agent, with the volume
  snapshots off ([the install](../../e2e/scripts/local-demo.mts#L1092-L1094)),
  and its live backup is of ConfigMaps with `defaultVolumesToFsBackup: false`
  ([the backup](../../e2e/scripts/local-fixtures.mts#L1959-L1984)): no object of
  these five kinds exists in it today.

Included: the five lists, the five workspaces, the five sections in the details
of the host, the band of the volume operations in the workspace of a backup and
of a restore, what uses a repository, the ways between all of them and from the
Volumes tab, a cell and two rules of the Overview, and the fixtures that prove
them. Excluded, with their owners: cancelling an operation, which is the write
`spec.cancel`, not in the agreed scope of v1.0.0 (a decision of the lead
maintainer, to be recorded in the roadmap if taken, with the actions of M5);
deleting or editing anything (never offered); the maintenance Jobs of a
repository, which are `batch/v1`, and the pods the node agent launches, which are
not kinds of Velero and are not read; the Pods, Nodes, claims, volumes and
snapshots an operation names, which are shown by name and never read; the
requests (M3, M5); the adherence of the schedules (T3.1 to T3.3).

## User Scenarios

1. **P1, a backup at work on its volumes:** Given a backup InProgress whose pods
   have volumes backed up with the file system backup, when the backup is opened,
   then its summary lists its pod volume backups with the pod and the volume of
   each, the phase, the bytes done of the total and the node, and each leads to
   its view; the item progress of the backup is not taken for the progress of the
   data.
2. **P1, a volume that failed:** Given a pod volume backup Failed with a message,
   when its backup is opened, then the band counts one failed, shows the message,
   and the failure of the backup itself stays beside it as the release writes it.
3. **P1, a repository that is not ready:** Given a backup repository NotReady,
   when the list is read, then it is marked so with the message of Velero, its
   volume namespace and its location are named, the view lists the operations
   that used it, and the Overview lists it among what needs attention.
4. **P1, a data movement in flight:** Given a data upload Accepted, when it is
   opened, then the view says which node agent accepted it and when, that a pod
   is being made to reach the snapshot, that no byte moved yet, which snapshot,
   claim and location it is of, and that the node agent fails it after its
   preparing timeout; one Prepared names the node it is prepared on and says
   that the node agent of that node is about to start the data path; one
   InProgress shows the bytes done of the total, with the percentage.
5. **P1, where a restore put the data:** Given a restore with pod volume restores
   and data downloads, when it is opened, then the band lists both, by pod and
   volume and by target claim, each with its phase and its bytes, leading to its
   view; a data download leads back to the restore and to the data upload it
   restores from, when the installation holds it.
6. **P2, no node agent:** Given pod volume backups that stay New, when their list
   is read, then each says that it waits for the node agent of the node of its
   pod to accept it, which the extension does not read, and nothing says that it
   failed; a data upload New says that it waits for any node agent of the
   installation.
7. **P2, restricted:** Given an identity that reads the backups and not the pod
   volume backups, when a backup is opened, then the band says that they cannot
   be read and gives no count, and the Volumes tab offers no way to them.
8. **P2, maintenance:** Given a repository whose newest maintenance failed, when
   it is opened, then the recent maintenances are listed with their result and
   their times, the last successful one is the time the list shows, and the view
   says when the next one is due by the frequency the object names.

## Requirements

| ID | Contract | Acceptance check |
| --- | --- | --- |
| REQ-177 | Type the five kinds from the CRD schemas of the reviewed release and register each with the host as kind, API and store: BackupRepository, PodVolumeBackup and PodVolumeRestore under `velero.io/v1`, DataUpload and DataDownload under `velero.io/v2alpha1`; every field optional, no instance method. The reader and the paths accept the second version of the group for the two kinds served under it and nothing else; the discovery asks `/apis/velero.io/v2alpha1` beside `/apis/velero.io/v1`, and a version the API does not serve makes its families not served and changes nothing else | KIND-01 |
| REQ-178 | The five families are read as the others are, in the namespace of the installation, each with its own state: never asked, loading, ready, denied, not served, failed, stale; a family that is denied takes nothing from the others. The repositories are read with the five families of today. The four families of the operations are read only while a view that shows them is open: their lists, the workspace of a backup, of a restore or of a repository, and the Volumes tab; a read again reads what the views that are open need | KIND-02 |
| REQ-179 | List the backup repositories of the selected installation in the native list with the columns name, installation, volume namespace, storage location, type, readiness, last maintenance, maintenance frequency and age, each with a stable ID, an order and a part in the search. Readiness is `status.phase` as reported: Ready; NotReady, with `status.message`; none or New, said not initialized yet; another value kept as text with the mark of what is not known. Last maintenance is how long ago `status.lastMaintenanceTime` is, with the result of the newest entry of `status.recentMaintenance` beside it when that entry is Failed, and never maintained when the object has no time | KIND-03 |
| REQ-180 | List the pod volume backups, the pod volume restores, the data uploads and the data downloads of the installation, each kind in its native list, with the columns name, installation, phase, operation (the backup or the restore it belongs to), source (pod and volume for the pod volume kinds, source claim for a data upload, target claim for a data download), node, progress, started, duration, storage location, uploader or data mover, and age, each with a stable ID, an order and a part in the search; the secondary columns give their room in a narrow list in the order of the Design. The state of a list is kept when an object is opened and closed | KIND-04 |
| REQ-181 | Open a dedicated read-only workspace from a row of each of the five lists, and add a compact section to the details the host shows of each of the five kinds; all read through the same helpers, and a section leads to the workspace for an object of the installation selected | KIND-05 |
| REQ-182 | Read the phase of an operation of the four kinds on two axes, with the helpers of the states extended for them: none and New, Accepted and Prepared are in flight and not started; InProgress is in flight and running; Canceling is in flight and running, with the cancellation asked; Completed is terminal; Failed is terminal and carries a failure; Canceled is terminal and is a cancellation, which is neither a success nor a failure and has a mark of its own. `status.message`, which the release writes on a failure, on a cancellation and on an empty volume, is shown beside the phase whenever the object carries it. A phase, an uploader type, a repository type, a snapshot type, a data mover, a node OS or a maintenance result the release does not write is kept as its text with the mark of what is not known | KIND-06 |
| REQ-183 | Show of a repository what it is of and what Velero does with it: the volume namespace, the storage location with a way to its view when it resolves, the type, the restic identifier when the object carries one, shown as REQ-085 shows an address, the maintenance frequency as a duration, the keys of `repositoryConfig`, the phase and its message, the last maintenance time, and the recent maintenances, three at most, each with its result, its start, its completion and its message. Say that the next maintenance is due when the last one is older than the frequency, or when a Ready repository has no last maintenance time, counted by the clock of this machine, that the server looks every five minutes and runs none for a read-only location, and that the maintenance runs as a Job of the installation, which the extension does not read. Nothing of it is a verdict on the backups the repository holds | KIND-07 |
| REQ-184 | Show the progress of an operation as the release writes it: the bytes done of the total bytes of `status.progress`, with a percentage only when the total is above zero and the bytes done are not above it; a progress the object does not carry is not reported, and is not zero; on a terminal phase the bytes are shown as written, and nothing is said of what was not transferred. `status.incrementalBytes`, of a pod volume backup and of a data upload, the kinds that carry it, is shown when the object carries it and said not reported otherwise: the release writes no zero into it; a pod volume restore and a data download have no such field, and nothing is said of it for them. `spec.snapshotSize` of a pod volume restore and of a data download is the logical size of the snapshot, shown as such | KIND-08 |
| REQ-185 | Show the times as the release writes them: accepted, started and completed. The duration of a terminal operation goes from its start to its completion; the elapsed time of one InProgress or Canceling from its start; the waiting time of one Accepted from its acceptance, with the note that the node agent fails it after its preparing timeout, which the view does not read; the waiting time of one Prepared from its acceptance, with the note that the node agent of its node is about to start the data path; one New or without a phase has no time but its creation. A cancellation or a failure of an operation that never started writes a start into some of the kinds and not into others: a start equal to the completion is shown as written, with no duration said of it. A terminal operation without a completion, as one the preparing timeout failed, has no duration and no elapsed time, and the view says that the release wrote no time for it. The time of an operation, for its order, is its start when it reports one and its creation otherwise | KIND-09 |
| REQ-186 | Resolve what an operation refers to inside the installation. Its backup or restore, by the owner reference and by the labels of the name and of the UID: a way to the workspace when an object of that name and that UID is found; a name with its reason when the name is found with another UID, or is absent, denied or not read. Its storage location, by `spec.backupStorageLocation`. Its repository, by the three labels the release names one with: the volume namespace, which is the namespace of the pod for a pod volume backup and `spec.sourceNamespace` for the other three, the location, and the type, read from the uploader type for the pod volume kinds and kopia for a data movement. Its pod and its node are names: the pod from `spec.pod` with its namespace and UID; the node from `spec.node` of a pod volume backup and from `status.node` of the others, with `status.acceptedByNode` of a data movement when it differs; each with a way to the details the host shows of a Pod or of a Node, which the host resolves when it opens: the extension reads neither and does not say whether they exist. A data upload shows its snapshot, its snapshot class, its driver, its storage class, its source claim and namespace; a data download its target claim, volume and namespace, its snapshot ID, its source namespace, and a way to the data upload of the installation whose `status.snapshotID` is its `spec.snapshotID`, when one is found | KIND-10 |
| REQ-187 | The workspace of a backup has a band of its volume operations, after its status: its pod volume backups and its data uploads, found by the label of its UID in its namespace, counted by phase, each with its pod and volume or its source claim, its phase, its bytes and its node, ten at a time with the way to the others, each leading to its view; the workspace of a restore has the same of its pod volume restores and data downloads. The band says what the release does: the pod volume backups run while the backup is InProgress, the data uploads while it waits for its plugin operations; a backup synced from the store carries the pod volume backups the sync created from the store, in the phase they were stored in. A backup or a restore whose families were read and that holds none says that it has none; what was not read is not known, not none. The workspace of a repository shows what used it: the operations of the installation whose volume namespace, location and type name it, counted by kind and by phase with the newest of each kind, and the backups and the restores they belong to | KIND-11 |
| REQ-188 | In the Volumes tab of a backup and of a restore, the details of a row whose method is PodVolumeBackup or PodVolumeRestore, or whose data was moved, offer a way to the operation of the installation that matches it: a pod volume operation by the owner of the tab, the pod namespace, the pod name and the volume name the row carries; a data movement by the operation ID the row carries, which is the label `velero.io/async-operation-id` of the object. When none matches, nothing is offered and nothing is said absent: the rows are what the store holds, and the objects may be gone | KIND-12 |
| REQ-189 | The Overview adds a cell for the backup repositories to what was read, and two rules to what needs attention, after the A11 of SPEC-0013: A12, a repository reports NotReady, with its message; A13, the newest maintenance of a repository failed, with its message and its time. The cell and the two rows join the table of REQ-096 of SPEC-0008 with the pull request of the slice: OVER-02 is restated with the cell and OVER-04 with the rules. The Overview reads none of the four families of the operations | KIND-13 |
| REQ-190 | No surface of the extension writes: no cancel, no edit, no delete, no selection, by pointer, menu or keyboard; `spec.cancel` is never written; the lists are given no menu and no selection; nothing of a maintenance Job or of a pod of the node agent is read or created | KIND-14 |
| REQ-191 | A read that fails keeps what was read before and says when, for each family, in each list, each workspace and each band; late answers of another target are not shown; an object created again under the name that is open is told from the one that was, by its UID; a view that closes leaves no timer and ends the reads of the families only it needed | KIND-15 |
| REQ-192 | Loading, empty, restricted, partial, stale, unknown and failure are distinct for each list, each workspace, the band of a backup and of a restore, what uses a repository and each reference. A kind the API does not serve, as the two of `velero.io/v2alpha1` on an installation whose version is not served, is said not served and affects nothing else. An operation New or without a phase says what the release needs for it to go on, which the extension does not read: for a pod volume operation a node agent running on the node of its pod, for a data movement any node agent of the installation; a phase that is not reported is not a failure | KIND-16 |
| REQ-193 | Both themes, the keyboard alone, a window of 900 by 650 and twice the zoom; names of 63 characters, generated names of the length the release makes, messages of several lines; the marks of the phases and of the readiness carry their meaning without colour, a cancellation with a shape of its own | KIND-17 |
| REQ-194 | With 2,000 pod volume backups and 200 data uploads in the installation, beside the 1,000 backups and the 1,000 restores of the long lists, each list mounts at most 100 rows and answers within 250 ms at the 95th percentile across 20 warm interactions, measured as BACK-12 is; the band of a backup finds its operations in an index built once for a read, and the workspace of a backup of 200 operations opens within the same budget; the reads of the four families cost one request each for each cycle while a view that needs them is open, and none otherwise | KIND-18 |
| REQ-195 | The packaged application shows the real pod volume backup, the real repository and the real pod volume restore of the test environment, as its node agent and its server leave them, and the synthetic data uploads and data downloads, whose status the fixtures write | KIND-19 |

## Design

The sidebar gets five entries under Velero, after Volume Snapshot Locations:
Backup Repositories, Pod Volume Backups, Pod Volume Restores, Data Uploads, Data
Downloads. The check DISC-08 is updated with them; DISC-01 and DISC-02 of the
[discovery](SPEC-0002-installation-discovery.md) are restated with the second
version of the group the discovery asks, and LOC-09 of the
[locations](SPEC-0007-locations-read-only.md) with the paths the reader takes
and refuses.

- **Standard or ad hoc view, and why.** The lists are the native list of the
  host, as every kind has: they are scanned, searched and ordered, and an
  installation may hold thousands of pod volume backups, of which the list of the
  host mounts only the rows in and around its room. The detail of each kind is a workspace
  of the extension, the one every kind has since the
  [Schedules](SPEC-0006-schedule-read-only.md#design): the details of the host
  carry the edit and the delete the host gives to every kind. Two parts are made
  for the purpose. The band of the volume operations in the workspace of a
  backup and of a restore: the operator whose backup has been at work for an
  hour asks where its data is, which the item progress does not answer, since a
  pod volume backup is one item, and which the Volumes tab answers only once the
  backup wrote its store, after a request that is a write; the band reads what
  the installation read and asks nothing. What uses a repository, as what uses a
  location: who opens a repository that is not ready asks what depends on it.
  The details of the host get a section that only reads, and a link to the
  workspace when the object is of the installation selected.
- **Safety.** The slice writes nothing. The reader is the only place of the
  renderer that reaches the cluster, sends `GET` and no other verb, and accepts
  the paths of the kinds of Velero under their two versions and no other path:
  its unit test asserts both. The suites compare the version of every synthetic
  object before and after, and count on the API server, for the group of Velero,
  no write but the one the controller of the installation makes into its storage
  location, as today. The maintenance of a repository is a Job whose pod reads
  the repository and its location through the API server, in the group of
  Velero, which the guard of the suites would count: the environment installs
  the server with `--default-repo-maintain-frequency=168h`, so that no
  maintenance of the real repository runs while the suites run and the server
  patches no repository at its pass; the Tests say how a demo sees one. A suite
  runs while no backup or restore of the installation is at work, which is when
  the node agent writes into the operations.

### The Kinds And What Is Read

Every field is optional, as the schemas admit an object without it; the lines
below are the ones of the schemas of the reviewed release, which the types are
written from, with the type file beside. None of the five CRDs declares a status
subresource
([one](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/config/crd/v1/bases/velero.io_backuprepositories.yaml#L137),
[two](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/config/crd/v1/bases/velero.io_podvolumebackups.yaml#L252),
[three](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/config/crd/v1/bases/velero.io_podvolumerestores.yaml#L233),
[four](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/config/crd/v2alpha1/bases/velero.io_datauploads.yaml#L246),
[five](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/config/crd/v2alpha1/bases/velero.io_datadownloads.yaml#L210)):
the fixtures write a status with an ordinary patch, as the ones of the other
kinds do.

| Kind | Spec read | Status read | Schema and type |
| --- | --- | --- | --- |
| BackupRepository | `volumeNamespace`, `backupStorageLocation`, `repositoryType` (`kopia`, `restic`, empty), `resticIdentifier`, `maintenanceFrequency`, `repositoryConfig` | `phase` (`New`, `Ready`, `NotReady`), `message`, `lastMaintenanceTime`, `recentMaintenance[]` with `result` (`Succeeded`, `Failed`), `startTimestamp`, `completeTimestamp`, `message` | [spec](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/config/crd/v1/bases/velero.io_backuprepositories.yaml#L45-L85), [status](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/config/crd/v1/bases/velero.io_backuprepositories.yaml#L86-L133), [type](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/apis/velero/v1/backup_repository_types.go#L23-L112) |
| PodVolumeBackup | `node`, `pod` (an object reference: `kind`, `namespace`, `name`, `uid`), `volume`, `backupStorageLocation`, `repoIdentifier`, `uploaderType` (`kopia`, `restic`, empty), `tags`, `uploaderSettings`, `cancel` | `phase` (the eight below), `path`, `snapshotID`, `message`, `startTimestamp`, `completionTimestamp`, `progress.bytesDone`, `progress.totalBytes`, `incrementalBytes`, `acceptedTimestamp`. No `node`: the printer column Node of this release reads `.status.node`, which the type does not have | [spec](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/config/crd/v1/bases/velero.io_podvolumebackups.yaml#L80-L178), [status](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/config/crd/v1/bases/velero.io_podvolumebackups.yaml#L179-L248), [column](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/config/crd/v1/bases/velero.io_podvolumebackups.yaml#L51-L54), [type](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/apis/velero/v1/pod_volume_backup_types.go#L26-L130) |
| PodVolumeRestore | `pod`, `volume`, `backupStorageLocation`, `repoIdentifier`, `uploaderType`, `snapshotID`, `snapshotSize`, `sourceNamespace`, `uploaderSettings`, `cancel` | `phase`, `message`, `startTimestamp`, `completionTimestamp`, `progress`, `acceptedTimestamp`, `node` | [spec](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/config/crd/v1/bases/velero.io_podvolumerestores.yaml#L73-L171), [status](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/config/crd/v1/bases/velero.io_podvolumerestores.yaml#L172-L229), [type](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/apis/velero/v1/pod_volume_restore_type.go#L26-L120) |
| DataUpload | `snapshotType` (`CSI` is the one the release knows), `csiSnapshot` (`volumeSnapshot`, `storageClass`, `snapshotClass`, `driver`), `sourcePVC`, `sourceNamespace`, `datamover`, `backupStorageLocation`, `dataMoverConfig`, `operationTimeout`, `cancel` | `phase`, `path`, `snapshotID`, `dataMoverResult`, `message`, `startTimestamp`, `completionTimestamp`, `progress`, `incrementalBytes`, `node`, `nodeOS` (`auto`, `linux`, `windows`), `acceptedByNode`, `acceptedTimestamp` | [spec](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/config/crd/v2alpha1/bases/velero.io_datauploads.yaml#L78-L151), [status](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/config/crd/v2alpha1/bases/velero.io_datauploads.yaml#L152-L242), [type](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/apis/velero/v2alpha1/data_upload_types.go#L25-L179) |
| DataDownload | `targetVolume` (`pvc`, `pv`, `namespace`), `backupStorageLocation`, `datamover`, `snapshotID`, `sourceNamespace`, `dataMoverConfig`, `operationTimeout`, `nodeOS`, `snapshotSize`, `cancel` | `phase`, `message`, `startTimestamp`, `completionTimestamp`, `progress`, `node`, `acceptedByNode`, `acceptedTimestamp` | [spec](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/config/crd/v2alpha1/bases/velero.io_datadownloads.yaml#L71-L146), [status](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/config/crd/v2alpha1/bases/velero.io_datadownloads.yaml#L147-L206), [type](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/apis/velero/v2alpha1/data_download_types.go#L25-L136) |

The progress of the four operation kinds is one shared type, `totalBytes` and
`bytesDone`, both left out when zero
([shared](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/apis/velero/shared/data_move_operation_progress.go#L23-L29)).
`incrementalBytes` is left out when zero as well
([backup](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/apis/velero/v1/pod_volume_backup_types.go#L121-L123),
[upload](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/apis/velero/v2alpha1/data_upload_types.go#L158-L160)):
a missing count is not reported, never zero, as the
[deviation of the states](SPEC-0003-backup-read-only.md#evidence-and-deviations)
reads the counters of a backup.

The labels and annotations the views read, all of
[`labels_annotations.go`](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/apis/velero/v1/labels_annotations.go#L19-L127):
`velero.io/backup-name`, `velero.io/backup-uid`, `velero.io/restore-name`,
`velero.io/restore-uid`, `velero.io/pod-uid`, `velero.io/pvc-uid`,
`velero.io/storage-location`, `velero.io/volume-namespace`,
`velero.io/repository-type`, `velero.io/async-operation-id`, and the annotation
`velero.io/pvc-name` of a pod volume backup
([constant](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/podvolume/configs/configs.go#L6)).
The label `velero.io/expose-on-going`, which the node agent sets on an operation
it is exposing and removes when the exposure ends
([constant](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/exposer/types.go#L29),
[set](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/controller/pod_volume_backup_controller.go#L410-L413),
[removed](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/controller/pod_volume_backup_controller.go#L342)),
is not a relationship: the views do not read it.

### What The Release Does, And The Views Say

Read in the source of the reviewed release. Nothing was run.

| Fact | Source |
| --- | --- |
| A repository is one for each volume namespace, storage location and type, named `<volume namespace>-<location>-<type>` and labelled with the three; the release finds it by the labels and never by the name, and refuses more than one of the same labels. A repository is created by the first backup or restore that needs it, which waits for it to be Ready | [Name and labels](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/repository/backup_repo_op.go#L44-L107), [by labels](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/repository/ensurer.go#L65-L95), [the wait](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/repository/ensurer.go#L118-L145) |
| The controller of the repositories takes one with no phase or New, writes the restic identifier for a restic repository, fills a maintenance frequency that is not set with the one of the server or the default of the type, kopia one hour, restic seven days, connects or initializes the repository and writes Ready with the last maintenance time set to that moment, or NotReady with the error as the message | [Initialization](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/controller/backup_repository_controller.go#L323-L374), [the frequency](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/controller/backup_repository_controller.go#L376-L391), [kopia](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/repository/udmrepo/kopialib/lib_repo.go#L84), [restic](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/restic/common.go#L37-L39), [the flag](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/cmd/server/config/config.go#L247) |
| It looks at every repository every five minutes. A NotReady repository is checked again and becomes Ready when it connects. A repository whose storage location changes its bucket, prefix, certificate or configuration, or is deleted, is marked NotReady with the message `re-establish on BSL change, create or delete` | [The period](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/controller/backup_repository_controller.go#L53-L57), [NotReady checked](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/controller/backup_repository_controller.go#L264-L273), [invalidated](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/controller/backup_repository_controller.go#L139-L164), [what changes](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/controller/backup_repository_controller.go#L166-L227) |
| A maintenance is due when the last maintenance time is older than the frequency, or when there is none. For a Ready repository whose location is not read-only the controller starts a Job in the installation namespace, named `<repository>-maintain-job-<milliseconds>`, or `repo-maintain-job-<milliseconds>` when that name would be longer than 63 characters, whose pod runs the maintenance command of the release, which reads the repository and its location through the API server; the controller waits for it, and writes a successful one as the last maintenance time with an entry Succeeded, a failed one as an entry Failed with its message and no change of the time, and a Job that could not start as an entry Failed. The history keeps the three newest entries, and entries of Jobs that ended while the controller was not watching are recalled from the Jobs. The release keeps three Jobs for each repository by default | [Due](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/controller/backup_repository_controller.go#L575-L577), [read-only skipped](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/controller/backup_repository_controller.go#L274-L277), [the run](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/controller/backup_repository_controller.go#L496-L557), [the history](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/controller/backup_repository_controller.go#L559-L573), [recalled](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/controller/backup_repository_controller.go#L399-L426), [the Job name](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/repository/maintenance/maintenance.go#L62-L67), [the command it runs](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/repository/maintenance/maintenance.go#L637-L669), [what the command reads](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/cmd/cli/repomantenance/maintenance.go#L146-L163), [three kept](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/repository/maintenance/maintenance.go#L55) |
| The command line lists the repositories with the columns Name, Status, which is New when the object reports none, and Last Maintenance, which is `<never>` when the object has none; it describes no repository | [The printer](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/cmd/util/output/backup_repo_printer.go#L26-L69), [the command](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/cmd/cli/repo/get.go#L33-L74) |
| A backup backs up with the file system the volumes of a pod named in the annotation `backup.velero.io/backup-volumes`, or, when `spec.defaultVolumesToFsBackup` is true, every volume of the pod but the ones of the annotation `backup.velero.io/backup-volumes-excludes`, the hostPath, Secret, ConfigMap, projected and downward API volumes and the default token; the server fills the field with its own default when the backup names none. The pod must be running and a node agent must run on its node, or every volume of the pod is skipped with the reason; hostPath volumes, block volumes and volumes no container mounts are skipped | [The rule](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/util/podvolume/pod_volume.go#L177-L228), [the default](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/controller/backup_controller.go#L423-L424), [running and node agent](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/podvolume/backupper.go#L267-L276), [the node agent check](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/nodeagent/node_agent.go#L115-L154), [skipped volumes](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/podvolume/backupper.go#L342-L370) |
| A pod volume backup is created with the generated name `<backup>-`, owned by the backup with `controller: true`, labelled with the name and the UID of the backup and, for a claim, with the UID of the claim and the annotation `velero.io/pvc-name`; its spec carries the node of the pod, the pod with its UID, the volume, tags, the location of the backup, the repository identifier (only for restic) and the uploader type. The reviewed release accepts the uploader kopia alone: a backup with another refuses every volume, and the node agent ignores an object with another | [Creation](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/podvolume/backupper.go#L545-L606), [the identifier](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/podvolume/backupper.go#L311-L314), [the uploader](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/uploader/types.go#L42-L49), [refused](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/podvolume/backupper.go#L260-L265), [ignored](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/controller/pod_volume_backup_controller.go#L640-L660) |
| The backup waits for all its pod volume backups while it is InProgress; at its own timeout it asks the ones not ended to cancel, and takes a Failed or Canceled one as an error of the backup. The server, when it starts, fails the backups InProgress and asks their pod volume backups and data uploads that are New, Accepted, Prepared or InProgress to cancel | [The wait](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/podvolume/backupper.go#L397-L459), [in the backup](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/backup/backup.go#L703-L704), [the server start](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/cmd/server/server.go#L1008-L1009), [the phases cancelled](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/cmd/server/server.go#L1136-L1142) |
| The node agent of the node of the pod takes a pod volume backup with no phase or New: it writes Accepted with the accepted time, and exposes the volume through a pod of its own; when that pod runs, Prepared; then InProgress with the start time, when its data path begins; the progress as the data path reports it; then Completed with the path, the snapshot ID, the completion time and the incremental bytes, with the message `volume was empty so no snapshot was taken` for an empty volume; or Failed with the message and the completion time, and a start time when there was none; or Canceled, with a start when there was none and the completion. Canceling is written only for one InProgress whose cancellation is asked; one Accepted whose pod cannot run is asked to cancel, and one Accepted longer than the preparing timeout is Failed with `timeout on preparing PVB`, with no start and no completion | [New](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/controller/pod_volume_backup_controller.go#L226-L259), [Accepted](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/controller/pod_volume_backup_controller.go#L405-L417), [Prepared](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/controller/pod_volume_backup_controller.go#L713-L732), [InProgress](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/controller/pod_volume_backup_controller.go#L333-L345), [progress](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/controller/pod_volume_backup_controller.go#L627-L636), [Completed](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/controller/pod_volume_backup_controller.go#L540-L561), [Failed](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/controller/pod_volume_backup_controller.go#L772-L802), [Canceled](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/controller/pod_volume_backup_controller.go#L419-L448), [Canceling](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/controller/pod_volume_backup_controller.go#L368-L398), [an abnormal pod](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/controller/pod_volume_backup_controller.go#L733-L750), [the timeout](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/controller/pod_volume_backup_controller.go#L467-L497) |
| A pod volume restore is created with the generated name `<restore>-`, owned by the restore, labelled with the name and the UID of the restore and the UID of the pod, with the snapshot ID and the logical size taken from the pod volume backup, the location, the identifier, the uploader and the source namespace of the backup. The node agent of the node of the restored pod takes it when the init container `restore-wait` of that pod runs, writes Accepted with the accepted time and its own name as the node, then Prepared, InProgress with the start, the progress, and Completed, Failed or Canceled as a backup; a failure writes no start time, and one Accepted longer than the preparing timeout is Failed with `timeout on preparing PVR` and no time at all. One whose uploader is restic is taken by a legacy controller, which writes InProgress with the start and Completed with the completion, and no node | [Creation](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/podvolume/restorer.go#L261-L307), [snapshot and size](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/podvolume/util.go#L75-L118), [the init container](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/controller/pod_volume_restore_controller.go#L568-L592), [its name](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/restorehelper/util.go#L25), [Accepted with the node](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/controller/pod_volume_restore_controller.go#L417-L430), [Failed](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/controller/pod_volume_restore_controller.go#L545-L566), [the timeout](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/controller/pod_volume_restore_controller.go#L482-L512), [legacy](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/controller/pod_volume_restore_controller_legacy.go#L362-L364), [its phases](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/controller/pod_volume_restore_controller_legacy.go#L160-L161), [and its end](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/controller/pod_volume_restore_controller_legacy.go#L297-L298) |
| A data upload is created by the CSI plugin for a backup that moves the data of its snapshots, with the generated name `<backup>-`, owned by the backup, labelled with the name and the UID of the backup, the UID of the claim and the operation ID of the plugin operation, prefixed `du-`; its spec names the snapshot, the storage class, the driver, the class when the snapshot has one, the source claim and namespace, the data mover, the location and the timeout, which is the CSI snapshot timeout of the backup. A data mover that is empty or `velero` is the built-in one; the controller ignores any other. The backup is in its phases of the plugin operations while the data uploads run, and reads their phase and bytes as the progress of the operation | [Creation](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/backup/actions/csi/pvc_action.go#L540-L597), [the prefix](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/apis/velero/v1/labels_annotations.go#L129-L134), [built-in](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/datamover/util.go#L21-L31), [ignored](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/controller/data_upload_controller.go#L160-L163), [the progress read](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/backup/actions/csi/pvc_action.go#L491-L515) |
| Any node agent may accept a data upload with no phase or New: the first to write Accepted, with its own name as the accepted-by node and the accepted time, wins, and exposes the snapshot as a volume of a pod of its own, which the scheduler places; the node agent of that node writes Prepared with its name as the node, then InProgress with the start and the node OS, the progress, Completed with the path, the snapshot ID, the incremental bytes and the completion, with the message `volume was empty so no data was upload` for an empty one, Failed with the message, the completion and a start when there was none, or Canceled. One Accepted longer than the preparing timeout is Failed with `timeout on preparing data upload`, with no start and no completion | [Accepted](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/controller/data_upload_controller.go#L812-L844), [exposed](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/controller/data_upload_controller.go#L285-L299), [Prepared](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/controller/data_upload_controller.go#L762-L765), [InProgress](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/controller/data_upload_controller.go#L377-L395), [Completed](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/controller/data_upload_controller.go#L501-L518), [Failed](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/controller/data_upload_controller.go#L781-L810), [Canceled](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/controller/data_upload_controller.go#L541-L576), [the timeout](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/controller/data_upload_controller.go#L846-L889) |
| A data download is created by the CSI plugin for a restore of a volume whose data was moved, with the generated name `<restore>-`, owned by the restore, labelled with the name and the UID of the restore and the operation ID, prefixed `dd-`; its spec names the target claim and namespace, with no volume yet, the location, the data mover, the snapshot ID, the size and the source namespace of the data upload it restores from, the timeout and the node OS. The node agent waits for the target claim to exist, accepts, exposes, and writes Prepared with the node, InProgress with the start, the progress, Completed after it rebinds the volume to the target claim, Failed with the message and the completion and no start, or Canceled; one Accepted longer than the preparing timeout is Failed with `timeout on preparing data download` and no time at all | [Creation](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/restore/actions/csi/pvc_action.go#L405-L453), [the claim awaited](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/controller/data_download_controller.go#L260-L263), [Accepted](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/controller/data_download_controller.go#L762-L795), [Prepared](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/controller/data_download_controller.go#L726-L729), [InProgress](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/controller/data_download_controller.go#L368-L380), [Completed](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/controller/data_download_controller.go#L478-L505), [Failed](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/controller/data_download_controller.go#L738-L760), [the timeout](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/controller/data_download_controller.go#L797-L828) |
| An operation that is deleted while it is not in a final phase is asked to cancel first, and deleted once the node agent cleaned up: a finalizer holds it. When the node agent starts, it resumes the operations InProgress of its node and asks to cancel the ones it cannot resume | [Deletion](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/controller/pod_volume_backup_controller.go#L146-L204), [resume](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/controller/pod_volume_backup_controller.go#L939-L983) |
| The sync of a backup from the store creates its pod volume backups from the list the store holds, in the phase they were stored in, with the owner UID and the UID label rewritten to the synced backup and the location of the sync; the deletion of a backup forgets the snapshots its pod volume backups name in the repository, deletes its data uploads, and leaves the pod volume backups to go with their owner | [The sync](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/controller/backup_sync_controller.go#L226-L262), [the snapshots forgotten](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/controller/backup_deletion_controller.go#L334-L339), [found by the label](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/controller/backup_deletion_controller.go#L665-L681), [the data uploads](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/controller/backup_deletion_controller.go#L341-L365) |
| `backup describe` lists the pod volume backups of a backup by the label of its name, groups them by phase in the order Completed, Failed, Canceled, In Progress, Canceling, Prepared, Accepted, New, with none and New together, and with `--details` by pod, `namespace/name`, with each volume, its percentage while in progress when the total is known, and its size and incremental size once completed when they are above zero; `restore describe` lists the pod volume restores by the label of the restore and groups them in an order of its own, Completed, Canceled, Failed, In Progress, Prepared, Accepted, New, without Canceling, with the same details by pod, and describes a moved volume by its operation ID, data mover and uploader type | [The list](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/cmd/cli/backup/describe.go#L87-L94), [the groups](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/cmd/util/output/backup_describer.go#L822-L901), [by pod](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/cmd/util/output/backup_describer.go#L918-L947), [the restores](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/cmd/cli/restore/describe.go#L74-L81), [described](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/cmd/util/output/restore_describer.go#L372-L427), [a moved volume](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/cmd/util/output/restore_describer.go#L460-L470) |
| The volume information of a backup names, for each pod volume backup, the pod, its namespace, the volume, the node, the snapshot ID, the total bytes as the size and the incremental bytes, and for each data upload the operation ID and the phase; the one of a restore names the pod, its namespace and the volume of each pod volume restore, and the operation ID of each data download, from its label | [From a pod volume backup](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/internal/volume/volumes_information.go#L252-L264), [from a data upload](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/internal/volume/volumes_information.go#L634-L639), [from a pod volume restore](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/internal/volume/volumes_information.go#L266-L275), [from a data download](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/internal/volume/volumes_information.go#L852-L886) |
| The documentation of the release says that the data mover shows the progress as bytes done of an estimated total, that the two are equal upon completion, and that the incremental bytes are filled once the upload is done; that the preparing timeout of the node agent is thirty minutes and the timeout of an item operation four hours unless set otherwise; that a CSI driver with snapshots at the v1 API is a prerequisite of the data movement; and that restic is being deprecated | [Progress](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/site/content/docs/main/csi-snapshot-data-movement.md#L119), [timeouts](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/site/content/docs/main/csi-snapshot-data-movement.md#L254-L257), [prerequisites](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/site/content/docs/main/csi-snapshot-data-movement.md#L29-L39), [restic](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/site/content/docs/main/file-system-backup.md#L41), [one repository for each namespace](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/site/content/docs/main/file-system-backup.md#L70-L72) |

Of these, the views say in words, where they help: that a repository is created
by the first backup or restore of a namespace to a location and shared by them;
that a pod volume backup runs while its backup is InProgress and a data upload
while its backup waits for its plugin operations; that a pod volume operation New
waits for the node agent of the node of its pod and a data movement New for any
node agent of the installation; that the preparing timeout and the timeout of the
backup are settings of the installation the extension does not read; that the
bytes are what the data mover reports, and that an equal incremental size is
not written. The views never compute a speed or a time left: the release writes
neither.

### Phases

The two axes of the [states](SPEC-0003-backup-read-only.md#design), extended
with a third outcome, the cancellation, which the operations have and the
backups do not:

| Phase | Lifecycle | Execution | Outcome | The view says |
| --- | --- | --- | --- | --- |
| None, New | In flight | Not started | None | A pod volume operation waits for the node agent of the node of its pod to accept it; a data movement for any node agent of the installation |
| Accepted | In flight | Not started | None | Accepted by a node agent at a time; a pod is being made to reach the volume; the node agent fails it after its preparing timeout |
| Prepared | In flight | Not started | None | The pod runs on the node; the node agent of that node is about to start the data path |
| InProgress | In flight | Running | None | Bytes done of total, elapsed time |
| Canceling | In flight | Running | Cancellation asked | The data path is being stopped |
| Completed | Terminal | Ran | Completed | Bytes, snapshot ID, duration; the message of an empty volume when written |
| Failed | Terminal | Ran or not started | Failed | The message; a start equal to the completion is one the failure wrote; no time at all is one the preparing timeout wrote |
| Canceled | Terminal | Ran or not started | Cancelled | The message when written; neither a success nor a failure |
| Another value | Unknown | Unknown | Unknown | The text as written |

A repository has three: none or New, not initialized yet; Ready; NotReady, with
its message. The maintenance result is Succeeded or Failed, another value kept.

### Relationships

| From | To | By | Shown as |
| --- | --- | --- | --- |
| An operation | Its backup or restore | The owner reference and the labels `velero.io/backup-name` and `velero.io/backup-uid`, or of the restore; the object of the installation with that name and that UID | A way to the workspace; with another UID, a name and that another object took the name |
| An operation | Its storage location | `spec.backupStorageLocation` | A way, or a name with its reason, as REQ-088 |
| An operation | Its repository | The labels of the repositories: `velero.io/volume-namespace` is the namespace of `spec.pod` for a pod volume backup and `spec.sourceNamespace` for the others, `velero.io/storage-location` the location, `velero.io/repository-type` the type from the uploader (`kopia`, or `restic` for `restic` and for an empty uploader) and kopia for a data movement | A way to the workspace; none found, more than one found, denied and not read each said |
| An operation | Its pod, its node | `spec.pod` with its UID; `spec.node` of a pod volume backup, `status.node` of the others, `status.acceptedByNode` when it differs | Names, each with a way to the details the host shows of a Pod or a Node, which the host resolves when it opens; the extension reads neither |
| A pod volume operation | Its claim | The annotation `velero.io/pvc-name` and the label `velero.io/pvc-uid` of a pod volume backup, the label of a pod volume restore | The name and the UID, as text |
| A data upload | Its snapshot and claim | `spec.csiSnapshot`, `spec.sourcePVC`, `spec.sourceNamespace` | Names, as text |
| A data download | Its target and its source | `spec.targetVolume`, `spec.snapshotID`, `spec.sourceNamespace`; the data upload of the installation whose `status.snapshotID` is the snapshot ID | Names; a way to the data upload when one is found, and nothing said when none is |
| A backup, a restore | Its operations | The label of its UID in its namespace | The band of REQ-187 |
| A repository | What used it | The operations whose volume namespace, location and type name it; their backups and restores through them | The band of REQ-187 |
| A row of the Volumes tab | The operation | The pod namespace, pod name and volume name of `pvbInfo` or `pvrInfo` with the owner of the tab; the operation ID of `snapshotDataMovementInfo` | A way in the details of the row when one is found |

The way back from every view returns to the one it was opened from, over the
list it started on, as the [architecture](../development/ARCHITECTURE.md#the-lists-and-the-views-of-one-object)
rules; the five kinds join the kinds the address names.

### The Lists

The columns of the repositories, with their order and their part in the search:

| Column | Value | Order |
| --- | --- | --- |
| Name | `metadata.name` | By name |
| Installation | The namespace | By name |
| Volume namespace | `spec.volumeNamespace` | By name |
| Storage location | `spec.backupStorageLocation`, a way when it resolves | By name |
| Type | `spec.repositoryType`, empty said not set | By text |
| Readiness | The mark and the word of REQ-179, the message in the tip | Ready, NotReady, not initialized, unknown |
| Last maintenance | How long ago, with the mark of a newest maintenance Failed; when it was in the tip | By time, none last |
| Maintenance frequency | `spec.maintenanceFrequency` as written, read as a duration for the order | By duration |
| Age | The age the host writes | By creation |

The columns of the four operation kinds:

| Column | Value | Order |
| --- | --- | --- |
| Name | `metadata.name` | By name |
| Installation | The namespace | By name |
| Phase | The mark and the label of the phase, the message in the tip | By lifecycle, then by phase |
| Operation | The name of the backup or the restore of the labels, a way when it resolves | By name |
| Source | `namespace/pod` and the volume for a pod volume operation; `namespace/claim` for a data upload; the target `namespace/claim` for a data download | By text |
| Node | REQ-186 | By name, none last |
| Progress | Bytes done of total, with the percentage when it can be given; not reported when there is none | By percentage, then by bytes |
| Started | `status.startTimestamp`, in the time of the operator with the one of the host in the tip; not started when there is none | By start, none last |
| Duration | REQ-185 | By duration |
| Storage location | `spec.backupStorageLocation` | By name |
| Uploader | `spec.uploaderType` for the pod volume kinds, empty said not set, which the release reads as restic; `spec.datamover` for the data movement, empty said built-in | By text |
| Age | The age the host writes | By creation |

In a narrow room the secondary columns give their room in this order, by the
[rule of the design](../development/DESIGN.md#lists-and-details): the
installation under 1,200 pixels, the age under 1,000, the storage location, the
uploader and the duration under 760, the started and the node under 640; the
name, the phase, the operation, the source and the progress stay.

A list says over itself what no row says: that the pod volume backups are the
ones the installation holds now, which go with their backups; that an operation
of a kind the API does not serve is not shown, with the version it needs.

### The Workspaces

The workspace of an operation, from the top:

| Band | Content | Source |
| --- | --- | --- |
| Way back and name | The list, or the view it was opened from | The address |
| Status | Phase and its mark, the message, accepted, started, completed, elapsed or duration, bytes done of total with the percentage, incremental bytes, installation and cluster | `status` |
| Belongs to | The backup or the restore, with its state; the storage location; the repository | The labels, the owner, the spec, the reads of the installation |
| Volume | The pod and its namespace and UID, the volume, the node, the claim; for a data upload the snapshot, its class, its driver, the storage class, the source claim; for a data download the target claim, the volume when bound, the namespace, the snapshot ID, the source namespace and the data upload | `spec` |
| Settings | The uploader or the data mover, the uploader settings or the data mover configuration as keys, the repository identifier shown as an address is, the tags, the operation timeout, the node OS, the data mover result as keys, the path; whether a cancellation was asked, which the views read and never write | `spec`, `status` |

The workspace of a repository:

| Band | Content | Source |
| --- | --- | --- |
| Way back and name | The list, or the view it was opened from | The address |
| Status | Readiness and its message, last maintenance and when the next is due, installation and cluster | `status`, `spec.maintenanceFrequency` |
| Repository | Volume namespace, storage location, type, restic identifier, maintenance frequency, the keys of the configuration | `spec` |
| Maintenance | The recent maintenances, newest first, each with its result, start, completion, duration and message; what REQ-183 says of the Jobs and of a read-only location | `status.recentMaintenance` |
| Used by | REQ-187, by kind | The reads of the installation |

The band of the volume operations of a backup or of a restore lists its
operations by kind, the pod volume ones first, each from the newest by the time
of the operation, with the counts by phase over them, ten at a time; a row is
the pod and the volume, or the claim, the mark and the label of the phase, the
bytes done of the total, and the node. A row leads to the view of the operation,
which returns to the backup. The band says what the release does with the
phases of the backup, as the table above records it.

### What Is Not Known

| State | The lists | The workspaces and the bands |
| --- | --- | --- |
| Loading | No rows and no count, as every list | The band says that the operations are being read, once |
| Empty | The list says of what it is the list; the host says that it is empty | The band says that the backup has no volume operation among the ones the installation holds; the repository says that nothing of the installation used it |
| Restricted | The list is not shown, and says that access is denied and that how many there are is not known | The band says that the kind cannot be read; a reference says denied; the Volumes tab offers no way |
| Partial | A kind read and another denied: each list and each half of a band on its own | The repository counts the kinds it could read and says which it could not |
| Stale | The rows of the last read that succeeded, with when; the column of the operation marked when its family is of an earlier read, by the notice over the list that names the family and when it was read | The band says that its operations were read before, and when; the Volumes tab keeps the ways of that read, the notice over the view saying when it was |
| Unknown | A phase or a value the release does not write, as text with its mark; an operation New without a node agent read | A reference whose family failed is not known, with the reason |
| Failure | A read that failed keeps the last rows and says so | A failed operation shows its message; a failed maintenance its message |
| Not served | A kind the version of the API does not serve, said so by the list and by the band, with nothing else affected | The same |

### The Overview

The cell of the backup repositories is the sixth of what was read, with the
number of its objects or its state, and leads to the list. Two rules, after the
A11 of [SPEC-0013](SPEC-0013-schedule-adherence.md), whose task comes first in
the milestone:

| Rule | Needs attention when | Reason shown |
| --- | --- | --- |
| A12 | A backup repository reports NotReady | The message of Velero, the volume namespace and the location |
| A13 | The newest entry of the recent maintenance of a repository is Failed | Its message, its start time, and when the last maintenance succeeded |

They are items of the storage, by name, as the items of the locations are. The
cell and the two rows join the table of REQ-096 of
[SPEC-0008](SPEC-0008-overview.md) with the pull request of the slice: OVER-02
is restated with the cell and OVER-04 with the rules. The Overview reads none of
the four families of the operations: a backup in flight leads to its workspace,
where the band is.

### What The Host Gives

The lists are the list layout of the host, which the extension API exports with
its details, its drawer and its links to the details of an object
([components](https://github.com/freelensapp/freelens/blob/7801fb10a5f20af308093b39e5f79cd6e8c3461d/packages/core/src/extensions/renderer-api/components.ts#L59-L73)),
and which takes the header, the contents, the order and the search of a list,
and the menu of a row, which the extension gives nothing to; it takes its items
from the `items` it is given or from the `contextItems` of the store, and not from
the `getItems` it is given
([the items](https://github.com/freelensapp/freelens/blob/7801fb10a5f20af308093b39e5f79cd6e8c3461d/packages/core/src/renderer/components/kube-object-list-layout/kube-object-list-layout.tsx#L246),
[the menu and the details](https://github.com/freelensapp/freelens/blob/7801fb10a5f20af308093b39e5f79cd6e8c3461d/packages/core/src/renderer/components/kube-object-list-layout/kube-object-list-layout.tsx#L273-L280)).
The age is the one the host writes
([age](https://github.com/freelensapp/freelens/blob/7801fb10a5f20af308093b39e5f79cd6e8c3461d/packages/core/src/renderer/components/kube-object/age.tsx#L25)).
The pages, the entries of the sidebar and the sections in the details are
registered as the other kinds are
([registration](https://github.com/freelensapp/freelens/blob/7801fb10a5f20af308093b39e5f79cd6e8c3461d/packages/core/src/extensions/lens-renderer-extension.ts#L59-L85),
[the sections](https://github.com/freelensapp/freelens/blob/7801fb10a5f20af308093b39e5f79cd6e8c3461d/packages/core/src/extensions/renderer-api/kube-object-registrations.ts#L121-L134),
[the custom resources](https://github.com/freelensapp/freelens/blob/7801fb10a5f20af308093b39e5f79cd6e8c3461d/packages/core/src/renderer/components/custom-resource-definitions/custom-resource-registration.ts#L52-L94)).
The way to the details of a Pod or a Node is the link the host exports for each,
`LinkToPod` with the name and the namespace and `LinkToNode` with the name: a
link of the host to the details of the object by its path, which reads nothing
and draws nothing without a name
([pod](https://github.com/freelensapp/freelens/blob/7801fb10a5f20af308093b39e5f79cd6e8c3461d/packages/core/src/renderer/components/kube-object-link/link-to-pod.tsx#L27-L44),
[node](https://github.com/freelensapp/freelens/blob/7801fb10a5f20af308093b39e5f79cd6e8c3461d/packages/core/src/renderer/components/kube-object-link/link-to-node.tsx#L26-L42),
[the address of the details](https://github.com/freelensapp/freelens/blob/7801fb10a5f20af308093b39e5f79cd6e8c3461d/packages/core/src/renderer/components/kube-detail-params/get-maybe-details-url.injectable.ts#L13-L22));
the drawer of the details reads the object of its address when it opens
([the drawer](https://github.com/freelensapp/freelens/blob/7801fb10a5f20af308093b39e5f79cd6e8c3461d/packages/core/src/renderer/components/kube-object-details/current-kube-object-in-details.injectable.ts#L29-L44)).
These facts were read again at the validation target with the first pull request
of T5.1, where the draft had read them on v1.10.3: the way of the draft, a path
given to `showDetails`, is replaced by the two links, which the extension API
exports.

### What The Main Branch Changes

The schemas of the five kinds differ between the reviewed release and the main
branch. Guidance only: nothing of it is a baseline capability, and the types are
written from the release.

| Kind | On main | Matters to the views as |
| --- | --- | --- |
| All five | Short names `repo`, `pvb`, `pvr`, `du`, `dd` ([one](https://github.com/velero-io/velero/blob/c111008912919e6a1a4127b2a0b8a641ee2dad80/config/crd/v1/bases/velero.io_backuprepositories.yaml#L14-L15), [two](https://github.com/velero-io/velero/blob/c111008912919e6a1a4127b2a0b8a641ee2dad80/config/crd/v1/bases/velero.io_podvolumebackups.yaml#L14-L15), [three](https://github.com/velero-io/velero/blob/c111008912919e6a1a4127b2a0b8a641ee2dad80/config/crd/v1/bases/velero.io_podvolumerestores.yaml#L14-L15), [four](https://github.com/velero-io/velero/blob/c111008912919e6a1a4127b2a0b8a641ee2dad80/config/crd/v2alpha1/bases/velero.io_datauploads.yaml#L14-L15), [five](https://github.com/velero-io/velero/blob/c111008912919e6a1a4127b2a0b8a641ee2dad80/config/crd/v2alpha1/bases/velero.io_datadownloads.yaml#L14-L15)) | The kinds of the extension carry no short name, as the release has none |
| BackupRepository | `resticIdentifier` described as deprecated ([line](https://github.com/velero-io/velero/blob/c111008912919e6a1a4127b2a0b8a641ee2dad80/config/crd/v1/bases/velero.io_backuprepositories.yaml#L74)) | Shown when carried, as a field of a restic repository, with no claim of its future |
| PodVolumeBackup | The column Node reads `.spec.node` ([line](https://github.com/velero-io/velero/blob/c111008912919e6a1a4127b2a0b8a641ee2dad80/config/crd/v1/bases/velero.io_podvolumebackups.yaml#L54)); new `spec.parentSnapshot`, `status.activities`, `status.fallbackFull`, `status.sourceSize`, and `incrementalBytes` becomes a pointer whose zero means nothing changed ([parent](https://github.com/velero-io/velero/blob/c111008912919e6a1a4127b2a0b8a641ee2dad80/config/crd/v1/bases/velero.io_podvolumebackups.yaml#L99), [activities](https://github.com/velero-io/velero/blob/c111008912919e6a1a4127b2a0b8a641ee2dad80/config/crd/v1/bases/velero.io_podvolumebackups.yaml#L198), [fallback](https://github.com/velero-io/velero/blob/c111008912919e6a1a4127b2a0b8a641ee2dad80/config/crd/v1/bases/velero.io_podvolumebackups.yaml#L214), [incremental](https://github.com/velero-io/velero/blob/c111008912919e6a1a4127b2a0b8a641ee2dad80/config/crd/v1/bases/velero.io_podvolumebackups.yaml#L218), [source size](https://github.com/velero-io/velero/blob/c111008912919e6a1a4127b2a0b8a641ee2dad80/config/crd/v1/bases/velero.io_podvolumebackups.yaml#L264)) | The node of the release is `spec.node`, as the view reads it. A field the object carries and the type does not know is shown by its name in the Settings band, as the Volumes tab shows an unknown field; a written zero of the incremental bytes on main is a count, which the release never writes |
| PodVolumeRestore | New required `spec.restoreType`, `status.activities`, `status.fallbackFull`, `status.incrementalBytes`, and two columns ([type](https://github.com/velero-io/velero/blob/c111008912919e6a1a4127b2a0b8a641ee2dad80/config/crd/v1/bases/velero.io_podvolumerestores.yaml#L146), [activities](https://github.com/velero-io/velero/blob/c111008912919e6a1a4127b2a0b8a641ee2dad80/config/crd/v1/bases/velero.io_podvolumerestores.yaml#L199), [fallback](https://github.com/velero-io/velero/blob/c111008912919e6a1a4127b2a0b8a641ee2dad80/config/crd/v1/bases/velero.io_podvolumerestores.yaml#L214), [incremental](https://github.com/velero-io/velero/blob/c111008912919e6a1a4127b2a0b8a641ee2dad80/config/crd/v1/bases/velero.io_podvolumerestores.yaml#L218)) | The same rule: shown by name when carried, never required |
| DataUpload | New `spec.csiSnapshot.cleanUp` and `volumeSnapshotNamespace`, `spec.parentSnapshot`, `spec.sourceFSType`, `status.activities`, `status.fallbackFull`, `status.sourceSize`, the pointer semantics of `incrementalBytes` ([clean up](https://github.com/velero-io/velero/blob/c111008912919e6a1a4127b2a0b8a641ee2dad80/config/crd/v2alpha1/bases/velero.io_datauploads.yaml#L98), [namespace](https://github.com/velero-io/velero/blob/c111008912919e6a1a4127b2a0b8a641ee2dad80/config/crd/v2alpha1/bases/velero.io_datauploads.yaml#L117), [parent](https://github.com/velero-io/velero/blob/c111008912919e6a1a4127b2a0b8a641ee2dad80/config/crd/v2alpha1/bases/velero.io_datauploads.yaml#L142), [file system](https://github.com/velero-io/velero/blob/c111008912919e6a1a4127b2a0b8a641ee2dad80/config/crd/v2alpha1/bases/velero.io_datauploads.yaml#L153), [activities](https://github.com/velero-io/velero/blob/c111008912919e6a1a4127b2a0b8a641ee2dad80/config/crd/v2alpha1/bases/velero.io_datauploads.yaml#L186), [source size](https://github.com/velero-io/velero/blob/c111008912919e6a1a4127b2a0b8a641ee2dad80/config/crd/v2alpha1/bases/velero.io_datauploads.yaml#L269)) | The same rule |
| DataDownload | New `spec.csiSnapshot` for an incremental restore, required `spec.restoreType`, `spec.targetVolume.fsType`, `status.activities`, `status.fallbackFull`, `status.incrementalBytes`, and three columns ([snapshot](https://github.com/velero-io/velero/blob/c111008912919e6a1a4127b2a0b8a641ee2dad80/config/crd/v2alpha1/bases/velero.io_datadownloads.yaml#L102), [type](https://github.com/velero-io/velero/blob/c111008912919e6a1a4127b2a0b8a641ee2dad80/config/crd/v2alpha1/bases/velero.io_datadownloads.yaml#L157), [file system](https://github.com/velero-io/velero/blob/c111008912919e6a1a4127b2a0b8a641ee2dad80/config/crd/v2alpha1/bases/velero.io_datadownloads.yaml#L177), [activities](https://github.com/velero-io/velero/blob/c111008912919e6a1a4127b2a0b8a641ee2dad80/config/crd/v2alpha1/bases/velero.io_datadownloads.yaml#L217), [incremental](https://github.com/velero-io/velero/blob/c111008912919e6a1a4127b2a0b8a641ee2dad80/config/crd/v2alpha1/bases/velero.io_datadownloads.yaml#L236)) | The same rule |

The `message` of the four operation kinds is described on main as one written
when the operation reaches a terminal status; the release writes it on the way
as well, on a cancellation asked and on an abnormal pod: the view shows it
whenever the object carries it, in either case.

## Tests

Planned homes: unit tests of the states of the five kinds, of the progress, of
the times with a controlled clock, of the references and of the index of the
operations of a backup; component tests of the five pages, of the five
workspaces, of the band and of the two rules; the suites of the views in the
packaged application, on the real objects of the test environment and on the
fixtures; the pre-review. The reader gets the test that gives it the paths of
the second version and the paths outside the group, as LOC-09 gave it the
Secrets.

Fixture families, placed as [TESTING.md](../development/TESTING.md#suites-of-the-views)
places and removes the fixtures of the views:

| Family | Namespace | What it is | What it proves |
| --- | --- | --- | --- |
| Volumes | The namespaces of the live flow, and `velero-demo` for the objects Velero creates | A pod with a volume of the kind the file system backup supports, an `emptyDir`, annotated `backup.velero.io/backup-volumes`, backed up by a second live backup of the run, and restored by a second live restore into the destination namespace. Velero creates the repository `<source namespace>-default-kopia`, one pod volume backup Completed with its bytes, snapshot ID and node, and one pod volume restore Completed | The real objects as the node agent and the server leave them: the three kinds, the owner and the labels, the counts of the band, the Volumes tab that names the pod and the volume and leads to the pod volume backup, the repository Ready with its first maintenance time, which is the time of its initialization and stays so: the server is installed with `--default-repo-maintain-frequency=168h`, and no maintenance Job runs while the suites run. The restore helper the restored pod runs is the image of the server, read from its Deployment, which the environment preloads ([the image](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/restore/actions/pod_volume_restore_action.go#L63-L72), [used](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/restore/actions/pod_volume_restore_action.go#L149)) |
| Operations | `velero-views-<run>` | Pod volume backups, pod volume restores, data uploads and data downloads in every phase and without one, each with the status the release writes in that phase and nothing else, with their messages, a progress in flight, an empty volume, a cancellation that never started, a failure that never started, a failure that never started with neither start nor completion, a legacy restic pod volume restore, a pod volume backup with the empty uploader and a data upload whose data mover is not the built-in one, both of which the schemas admit; each owned by a backup or a restore of the namespace that the fixtures create first and read the UID of, with the labels; one whose UID label is of a backup created again; a data download whose data upload is in the namespace, and one whose is not; a repository of the triple of each | The phases, the words of each, the references both ways, the band of a synthetic backup, what uses a repository. The values the schemas refuse, a phase, an uploader, a repository type or a maintenance result the release does not write, are cases of the unit and component layers and of no cluster fixture. No controller reads the namespace: the node agent caches the installation namespace alone |
| Repositories | `velero-views-<run>` | Ready with three maintenances, the newest Failed; Ready with none; NotReady with a message of several lines; one without a status; restic with its identifier; one due, with a last maintenance older than its frequency; names of 63 characters | REQ-179, REQ-183, A12 and A13 |
| Long lists | `velero-scale-<run>` | 2,000 pod volume backups and 200 data uploads, owned by the backups of the long lists, spread over the thirty days before they are placed, in every phase | REQ-194 |
| Reader | The two readers of the second milestone | The first reads the backups and not the operations; the second the restores and not the backups | The band denied; a pod volume restore whose restore resolves and a pod volume backup whose backup is denied |
| Tabs | `velero-demo` | The synced backup of the tabs, whose volume information names a pod volume backup of a synthetic pod no object of the installation matches | The Volumes tab offers no way, and says nothing absent |

The data uploads and the data downloads are synthetic everywhere: a data
movement needs a CSI driver with snapshots at the v1 API, a snapshot class and
the snapshot controller, which the kind node of the test environment does not
have and the environment does not install. The synthetic ones are in a namespace
no node agent reads, so that none accepts them: a data upload New in the
installation namespace would be accepted, exposed and failed. The maintenance
of the real repository would run on the frequency of kopia, one hour, as a Job
in the installation namespace whose pod reads the repository and its location
through the API server, in the group of Velero, which the guard of the suites
counts whoever sends the request: the environment installs the server with
`--default-repo-maintain-frequency=168h`, which the installer passes to the
server and the controller takes as the frequency of every repository that names
none
([the flag](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/cmd/cli/install/install.go#L135),
[passed on](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/install/deployment.go#L311),
[taken](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/controller/backup_repository_controller.go#L376-L380)),
so that no maintenance runs while the suites run, the real repository keeps the
maintenance time its initialization wrote, and the server patches no repository
at its pass. A maintenance history is seen for real in a demo brought up with a
shorter frequency, a setting of the demo scripts that the suites never use; the
suites expect the first maintenance time alone. The guard keeps its rule: the
one write of the installation it expects is the validation of its location.

| Check | Layer | Requirements | Scenario and expected evidence |
| --- | --- | --- | --- |
| KIND-01 | Unit/host contract | REQ-177 | The five kinds registered with kind, version, plural; the reader takes the paths of the two versions and refuses the Secrets, a third version, a query; a discovery of `v2alpha1` that is served, denied and not served, each with the families it affects |
| KIND-02 | Unit/component | REQ-178 | The repositories read with the five families everywhere; the operations read while their list, a backup, a restore, a repository or the Volumes tab is open and not while the Overview or another list is; each family with its own state |
| KIND-03 | Component/packaged | REQ-179 | The columns and the search; Ready, NotReady, none, unknown with their marks; a last maintenance with the mark of a Failed newest entry, and never maintained; the real repository of the demo |
| KIND-04 | Component/packaged | REQ-180 | The columns of each of the four lists, their order and their search; the responsive order; a search, an order and a column made wider kept when an object is opened and closed |
| KIND-05 | Component/packaged | REQ-181 | A row of each list opens its workspace; the details of the host agree on phase, progress and owner, or on readiness and last maintenance, and lead to the workspace for the installation selected |
| KIND-06 | Table-driven unit/component/packaged | REQ-182 | The eight phases, none and an unknown one for each of the four kinds, with their axes and words; the message shown in every phase that carries one; the unknown values of each enum kept as text, at the unit and component layers, since the schemas refuse them on the cluster; on the cluster an empty uploader and a data mover that is not the built-in one, which the schemas admit, and one row for each phase |
| KIND-07 | Fake-clock unit/component/packaged | REQ-183 | The fields of a repository; a frequency as a duration and one that cannot be read; due and not due by the clock; the three maintenances in order with durations; the restic identifier shown as an address is; the real repository with its first maintenance time |
| KIND-08 | Unit/component | REQ-184 | A progress in flight with its percentage, one without a total, bytes above the total, none; incremental bytes present and absent; the snapshot size of a restore and of a download; no `NaN`, no zero that is not written |
| KIND-09 | Fake-clock unit/component | REQ-185 | Accepted, started and completed in every combination the controllers write, the waiting time, the elapsed time, the duration, a start equal to the completion, a failure without a start, a failure with neither start nor completion, with no duration and no timer; the order of a list by the time of the operation |
| KIND-10 | Unit/local RBAC/packaged | REQ-186 | The owner found, found with another UID, absent, denied, not read; the location; the repository by the three labels, with none and two found; the pod and the node as names with the way of the host; the snapshot and claim of a data upload, the target and the source of a data download, its data upload found and not found |
| KIND-11 | Unit/component/packaged | REQ-187 | The band of a backup with operations of both kinds in several phases, ten at a time, counted; a backup InProgress and one waiting for its plugin operations, with the words of each; a synced backup; a backup with none; the kinds denied; what uses a repository, by kind and phase, with the newest; on the real backup and the real restore of the volumes |
| KIND-12 | Unit/component/packaged | REQ-188 | A row that matches a pod volume backup, a pod volume restore, a data upload, a data download; one that matches nothing; the real backup of the volumes, whose row leads to its pod volume backup; the synced backup of the tabs, whose row leads nowhere and says nothing absent |
| KIND-13 | Table-driven unit/component/packaged | REQ-189 | The cell, with OVER-02 restated; A12 and A13 each with a case that gives an item and one that gives none, with OVER-04 restated; no read of the operations counted on the API server with the Overview open |
| KIND-14 | Component/packaged | REQ-190 | No control that writes, by pointer, menu or keyboard, on the five lists and workspaces and in the band; the objects unchanged; no request to Velero created; nothing of a Job or a pod read, counted on the API server; the one write of the installation counted is the validation of its location, no maintenance having run in the window of the suite by the frequency the environment installs |
| KIND-15 | Unit/component | REQ-191 | A read that fails after one that succeeded, for each family; a late answer; an object created again; no timer left, and the families only a closed view needed not read any more |
| KIND-16 | Component/local RBAC/packaged | REQ-192 | Each state with its words for each list and band; `v2alpha1` not served with the two lists said so and the three others untouched; an operation New of each of the four kinds with its words of the node agent; the readers |
| KIND-17 | Pre-review | REQ-193 | The five lists, the five workspaces, the band and what uses a repository in both themes, at the two sizes and at twice the zoom; names of 63 characters and generated names; a message of several lines; the marks read with the keyboard alone |
| KIND-18 | Packaged performance | REQ-194 | The long lists: the rows mounted at most, the 95th percentile of 20 warm interactions on the list of 2,000; the workspace of a backup of 200 operations opened within the budget; the requests of the four families counted while a list is open and not while the Overview is |
| KIND-19 | Packaged | REQ-195 | The real pod volume backup, repository and pod volume restore of the demo, with the values the suite reads on the cluster; the synthetic data uploads and downloads of the views |

What needs a real controller is proven on the test environment for the three
kinds its node agent and its server create. What the environment cannot
produce stays synthetic, and is said so where it is shown: a data movement in
any phase, a repository NotReady or with a maintenance history, a cancellation,
an operation accepted by one node and prepared on another, which a single node
never gives.

## Success Criteria

All 19 checks pass before this spec is Verified. No phase of an operation is
shown as a success or a failure that the release does not write as one, no
byte is shown that the object does not carry, and nothing of the slice writes.

Manual review: on the demo, open the backup of the volumes, read in the band
how its volume went and follow it to the pod volume backup, to its repository
and back; open the repository and tell when it was initialized and when its
maintenance is due; open a synthetic data upload Prepared and tell on which node
it waits and for what; open a repository NotReady and tell what depends on it.
Expected: the answers are on the pages, nothing reads as a verdict on the
backups, and the pod and the node are names that open the details of the host.
Record role, date and verdict.

## Assumptions And Decisions

- **The four families of the operations are read only where they are shown.**
  An installation may hold thousands of pod volume backups, each a list entry
  of some kilobytes: reading them every 15 seconds for the Overview or for the
  list of the schedules would cost every view what one view uses. The
  repositories are few and are read everywhere, since the Overview carries
  their rules. A list by a label selector, which would let a backup read its
  operations alone, was not chosen: the reader asks paths without a query, and
  one family has one source of truth.
- **The Overview does not read the operations.** Its signal is the two rules
  of the repositories and their cell; a backup in flight is one click from the
  band that shows its data. Counting bytes in the band of what is in flight
  would need the reads above.
- **Cancelling an operation is not offered.** `spec.cancel` is a write, which
  the gate of [SPEC-0009](SPEC-0009-write-gate.md) would carry, and it is not in
  the agreed scope of v1.0.0. Whether to add it to the actions of M5 is a
  decision of the lead maintainer; this spec records that nothing of it is
  here.
- **A cancellation is a third outcome.** The release ends an operation Canceled
  for its own reasons, when a backup times out, when the server or the node
  agent restarts, or when the pod cannot run: it is not the failure of a
  volume, and not a success. Its mark has a shape of its own, and its words say
  what the message says.
- **The pod and the node are names with the way of the host.** The reader asks
  nothing outside the group of Velero; the host resolves a Pod or a Node when
  its details open, and the extension does not say whether they exist: the pod
  of a backup is often gone by the time the operator looks.
- **The repository of an operation is found by the three labels**, as the
  release finds it, and never by the name, which the release says it may change.
  Two repositories of the same labels are said so, as the release refuses them.
- **A label that carries a name is compared as the release cuts it**: a name
  longer than 63 characters is cut to its first 57 and six characters of its
  SHA-256 ([RECON-T0.1](../development/RECON-T0.1.md), the labels), so the owner
  of an operation and the location of its repository are found by the name cut
  that way, as decided while implementing, on 2026-10-26. The extension cuts the
  labels of the requests it creates with the same function
  (`src/common/name-label.ts`). The reviewed release writes these labels through
  that cut, as read in its source: the name of the backup of a pod volume
  backup ([labels](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/podvolume/backupper.go#L559-L562)),
  the name of the restore of a pod volume restore
  ([labels](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/podvolume/restorer.go#L275-L279)),
  and the volume namespace, the location and the type of a repository, which it
  creates and looks up by them
  ([labels](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/repository/backup_repo_op.go#L44-L50),
  [looked up](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/repository/backup_repo_op.go#L59),
  [created](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/repository/backup_repo_op.go#L99)),
  each through one function
  ([the cut](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/label/label.go#L37-L51)).
- **Due is counted by the clock of this machine**, against the last maintenance
  time and the frequency the object names, with the five minutes of the pass of
  the server said beside it. The release gives no field for it. A frequency
  that is not set is one the server will fill: the view says so and computes
  nothing.
- **A repository that reports no phase is not initialized yet**, in the words
  of the view: the controller writes Ready or NotReady at its first pass, and
  the command line prints New for it.
- **The band of a backup is in its summary**, after its status, and not a tab:
  the tabs are the artifacts of the store, each behind a request; the band is
  what the installation read, and is there before the backup wrote anything.
- **The Volumes tab leads to an operation only when one matches.** The tab is
  what the store holds; the operations are what the cluster holds now, and a
  backup synced from another cluster has rows that match nothing. Nothing is
  said absent.
- **The fixture of the real volume is an `emptyDir`.** The file system backup
  takes every volume of a pod but the kinds its rule leaves out, and an
  `emptyDir` is not among them
  ([the rule](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/pkg/util/podvolume/pod_volume.go#L191-L226));
  the documentation of the release annotates one
  ([example](https://github.com/velero-io/velero/blob/4ee1e79a7aed367fd9b767b8219ec65bd0c96892/site/content/docs/main/file-system-backup.md#L314));
  and it asks nothing of a storage class: the environment proves the three
  kinds with no new dependency. A claim of a storage class is not needed for
  this slice.
- **The synthetic operations are owned by objects that exist.** The release
  always writes an owner reference, and Kubernetes removes a dependent whose
  owner is gone: the fixtures create the backup or the restore first and read
  its UID into the owner and the label. A backup created again is the case of
  a UID label that differs from the UID of the object of that name.
- **Five entries of the sidebar**, after the locations, in the order of the
  requirements: the host gives a group its entries, and a sub-group was not
  looked for. A shorter sidebar is a judgment of the review of the milestone.
- **The words for an operation New** say what the release needs, for a pod
  volume operation the node agent of the node of its pod and for a data movement
  any node agent of the installation, and never that one is missing: the
  extension does not read the pods of the installation.
- **The environment installs the server with a maintenance frequency of 168
  hours.** The maintenance of the real kopia repository would otherwise run
  every hour as a Job whose pod reads the kinds of Velero, which the guard of
  the suites counts whoever sends the request. The other way, a guard that
  tolerates the reads and the patch of one maintenance when the Jobs it lists
  show one ran in its window, was not chosen: it would read `batch/v1` beside
  the suites and make the counts depend on when a Job ran. A demo brought up
  with a shorter frequency shows a maintenance history for real; the suites run
  with the long one and expect the first maintenance time alone.

## Evidence And Deviations

Before T5.1: no implementation, tests or runtime evidence. The upstream drift watch of
this milestone is in the Design, under what the main branch changes: the five
schemas differ, and nothing of main is a baseline. The test environment moves
its pins to v1.18.4, the reviewed release, with a pull request in flight. The
schemas of the five kinds are the same in v1.18.2 and v1.18.4: of the thirteen
kinds the Restore alone changed between the two, which the drift watch of the
milestone records in the [recon](../development/RECON-T0.1.md#upstream-drift-watch);
an environment at either release serves the objects this spec reads alike.

T5.1, the first of its five pull requests: the backup repositories, the pod volume
backups and the pod volume restores in their lists, their views and the details of
the host, with the reads on demand, on 2026-10-26 and 2026-10-27. The gates on the
machine of the runs, on 2026-10-27, on the branch rebased on main at `94891de`, with
Node 24.21.0, pnpm 12.14.0, TypeScript 7.0.2, Vitest 5.0.5, Biome 2.5.15, Knip
6.41.0 and the launcher of Trunk 1.3.4: `pnpm type:check`, the nine programs, and
`pnpm lint:check`, 298 files, each with no error; `pnpm test:unit`, the build, then
95 files and 2,853 tests, all passed, then the two measures within their budgets,
and its second form with `VITE_PRESERVE_MODULES=false`, the same; `pnpm knip:check`,
both passes with no finding; Trunk on the files the branch changes, with no issue;
and each commit type-checked and linted alone, with no error at any. The unit and
component evidence, by check:

- KIND-01: the three classes, with their kind, their `declare` literals, the
  version `velero.io/v1`, their plural and no short name; `detailsFor` given the
  kind and the version of each; `customResources` of eight; nine pages and eight
  sections in the build test (`src/entrypoints.test.ts`, `test/build.test.ts`,
  `src/renderer/registrations.test.tsx`). The reader takes the plurals of the three
  kinds under `velero.io/v1` with no change: its expression takes any plural of the
  group, which its test proves on the three paths, and the second version is of
  T5.2 (`src/renderer/api/reader.test.ts`).
- KIND-02 and KIND-15: one union of eight families, the six read at every read
  (the five of before and the backup repositories) and the two of the pod volume
  operations read on demand; a holder that says what it needs in one call, the
  frame of a page among them with the families of its page and of the view that is
  open; a family needed and never read asked at once, alone, in the generation, and
  at every read while it is held; one no holder needs not asked at the read after,
  and dropped to idle then; two holders of one family; a holder that replaces what
  it needs never letting go of what both need; a change of namespace that keeps the
  holders and drops the reads; a family denied that takes nothing from the others;
  a late answer of another generation, or of a family no holder needs any more, not
  taken; a family asked at once, which is not a read of the installation, leaving the
  time of the last read and the time of the API server as they were; no timer added
  (`src/renderer/state/installation.test.ts`,
  `src/renderer/pages/volume-lists.test.tsx`, `src/renderer/pages/overview-page.test.tsx`).
  No family of the operations is asked by the view of a schedule, and none was by
  the view of a backup or of a restore in this pull request: the test of the reads
  of the view of a backup (`src/renderer/pages/volume-lists.test.tsx`), and the
  tests that count what opening a restore and a schedule asks, which fail when
  either view is given a family of the operations
  (`src/renderer/pages/restores-page.test.tsx`, "opens from a row and shows a
  restore that waits with a failure as in flight";
  `src/renderer/pages/schedules-page.test.tsx`, "shows what Velero says of the
  schedule, and computes from its expression only its band of the adherence"). The
  second pull request gives the views of a backup and of a restore their family,
  and restates the tests of the two (the paragraph of the second pull request,
  below).
- KIND-03 and KIND-04: the columns of the three lists, their stable identifiers
  and classes in the order of the Design, each cell in each state, the order of
  each column through the callbacks of the host both ways with none answering
  `undefined` or `NaN`, the search, the notes over the lists; the node, and an owner
  that is not named, in a badge that is a flex item of its cell, the link of the host
  a flex box there by a rule of the stylesheet; the column of an owner of an earlier
  read marked by the notice over the list, the owner still a way with why in its tip;
  the room of each list read from the rules of the stylesheet
  (`src/renderer/pages/volume-lists.test.tsx`,
  `src/common/repository-view.test.ts`, `src/common/volume-view.test.ts`,
  `src/renderer/components/views.module.test.ts`).
- KIND-05: the views of the three kinds, their bands, their ways and back, the
  object created again under the name; the sections of the details, which agree
  with the rows, draw a message on its lines as the views do, lead to the view for
  the installation selected, say the age of the read they found the owner in, ask
  nothing and keep no timer once closed
  (`src/renderer/pages/volume-workspaces.test.tsx`). The view of a repository had
  no band of what used it in this pull request: the second shows it, last in the
  view (the paragraph of the second pull request, below).
- KIND-06: the eight phases, none and an unknown one, for each of the two kinds,
  with their axes, their outcome and their words (`src/common/volume-phases.test.ts`);
  the message of Velero beside the phase, in the tip of a row and in the view, on a
  failure, on a cancellation and on a volume that was empty; an uploader, a type of
  repository and a result of a maintenance the release does not write, kept as their
  text with the mark of what is not known in the lists, the views and the section of
  a repository, and no mark on a value it writes or on one that is not set
  (`src/renderer/pages/volume-lists.test.tsx`,
  `src/renderer/pages/volume-workspaces.test.tsx`).
- KIND-07: the fields of a repository; the frequency as a duration and one that
  cannot be read; due and not due by a controlled clock, Ready with no time,
  not ready, a read-only location, a frequency not set; three maintenances newest
  first with their durations whatever their order in the object; the restic
  identifier shown as an address is; never maintained
  (`src/common/repository-view.test.ts`).
- KIND-08: the bytes in flight with their percentage, without a total, `{}` said
  as no total, over the total, none, not an integer; the incremental size present,
  absent and nothing of it for a pod volume restore; the snapshot size of a restore;
  no `NaN` (`src/common/volume-view.test.ts`).
- KIND-09: the accepted, the started and the completed times in each combination
  the controllers write, the waiting time, the elapsed time, the duration, a start
  equal to the completion, a failure without a start, a failure with neither; the
  order by the time of the operation; no timer (`src/common/volume-time.test.ts`).
- KIND-10: the owner by its labels and by its owner reference, found, found with
  another UID, absent, denied, not read, failed, and the two disagreeing, and labels
  with no UID told replaced by the UID of the owner reference that names their
  object; the location; the repository by its three labels, of kopia, of restic and
  of an empty uploader, none and two; the owner by names of 63, 64 and 78
  characters and the repository by a location of 63 and 64, which the release cuts
  in their labels, and an owner of 78 characters that is not in the read named
  whole from its owner reference; the pod and the node as names, the node of a pod
  volume backup from its spec and of a restore from its status, and the namespace
  of the pod a fact of the view (`src/common/volume-references.test.ts`,
  `src/renderer/pages/volume-workspaces.test.tsx`).
- KIND-14: no menu, no selection and no control but ways in the rows and in the
  views (`src/renderer/pages/volume-lists.test.tsx`,
  `src/renderer/pages/volume-workspaces.test.tsx`).
- KIND-16: the states of a family on the surfaces that show them: each of the
  three lists denied, not served and failed with nothing read before, empty, never
  answered, and read once and then failed, with its rows kept and the notice of
  when they were read; the views of a repository and of a pod volume backup of a
  name that is not there, denied, created again under its name and of an earlier
  read, and a pod volume backup opened before its family was first read, which
  waits for the read and says no absence; a reference not read, loading, denied,
  not served and failed, each with its words; and the words of an operation that
  waits for a node agent
  (`src/renderer/pages/volume-lists.test.tsx`,
  `src/renderer/pages/volume-workspaces.test.tsx`, `src/common/volume-words.test.ts`).
  The words of the band of a backup and of a restore, and of what used a
  repository, are written beside these in `src/common/volume-words.ts` by the
  second pull request, which draws them (the paragraph of the second pull request,
  below).

The packaged cases, on the fixtures that exist, where no object of the three kinds
is: the journey with nine entries under Velero and the eight kinds out of the Custom
Resources tree until the extension is disabled (DISC-08, HOST-15); the suite
`velero-e2e-volumes`, with the three lists empty in the installation of the views,
the list of the repositories of the demo empty, and the reads of the pod volume
operations counted on the API server, one list at each read while their list is shown
and none while the list of the backups or the Overview is (KIND-02); the first reader
denied the three lists, with their words (KIND-16); the reads of every suite that
counts them restated with the repositories, and the entries and the tabs of the group
with the nine pages in the suites of the Overview, of the locations and of the
schedules. On 2026-10-27, on the nightly v2.0.0-0-nightly-2026-10-25 of the
validation target, in the disposable environment of the repository, one run at a
time: the journey alone, 19 cases of 19 in 92 seconds; `velero-e2e-volumes` alone, 4
of 4 in 312 seconds, with three lists of the pod volume backups over the three reads
it waited for while their list was shown and three of the pod volume restores while
theirs was, none of the other family in either window and none of either while the
list of the backups or the Overview was shown, as its report
`kind-02-reads-of-the-pod-volume-operations.json` says; and every suite of the views,
the pre-review and FND-10 as the hosted job runs them, 252 cases of 252 in 16 files
in 55 minutes 18 seconds, the suites 53 minutes 31 seconds, the volumes 312 seconds
of it; a first run of the pattern, on the code before the entries and the tabs of
those three suites were restated, had failed their first cases, which compared them
with the six of before, and the cases that start from them, 18 of 252, every other
file passing. The heads of the three lists, empty, fit their room at 1440 by 900 and
at 900 by 650; their room with rows, at each edge of it and at twice the zoom, is
measured with their fixtures. What proves the cell of the node today is two tests of
the repository and one packaged check outside it: the test of the stylesheet, which
reads the rule of a link of the host in a cell
(`src/renderer/components/views.module.test.ts`), and the test of the cells of the
list on the double of `LinkToNode` (`test/host-components.tsx`,
`src/renderer/pages/volume-lists.test.tsx`); and one check of 2026-10-27, run once in
the packaged application from a temporary suite that is not kept in the repository,
on four synthetic pod volume backups placed in the namespace of the views for its run
and removed after it. It measured the cells of the list with rows: at 1440 by 900 the
words of every cell sat on the line of their row and none was clipped, the node and
the longer words cut with their ellipsis, and with the cell of the node as it was
before, the link of the host inside a block, the names of the nodes sat 1.7 pixels
above their rows and the column of the node was clipped; at 900 by 650 and at twice
the zoom the column of the node is not shown. The packaged proof with rows, kept in a
suite, comes with the fixtures of the lists, in a later pull request of T5.1. The job
of the views on the hosted runner, which runs the new suite with the others: in its
first run, on 2026-10-27, every suite, the pre-review and FND-10 passed, 252 of 252
in 16 files, the step of the suites in 47 minutes 10 seconds and the job in 52
minutes 48 seconds of its 150.

Two precisions of the plan of the fourth milestone, approved by the lead maintainer
on 2026-10-26 with it:

- REQ-177 (L120): on Freelens v2 the extension declares the class of each kind, and
  the host registers the API and the store of a served CRD, as SPEC-0015 records it
  (REQ-210, D7): the three classes are the pattern of D7, with no API and no store
  of the extension's own.
- REQ-179 (L122) gives no order in which the columns of the repositories give their
  room: the installation under 1,200 pixels, the age under 1,000, the type and the
  frequency under 760; the name, the volume namespace, the storage location, the
  readiness and the last maintenance stay, since scenario 3 names the volume
  namespace and the location in the list. The location has a class of its own,
  `location`: the class `storage` is hidden under 760 in every list. The source of an
  operation has the class `volume`, since the class `source` of the restores is
  hidden under 760 and the source of an operation stays.

Decided while implementing, on 2026-10-26:

- The two identities of the views the runner makes for the suite of the tabs read
  what the views read of the installation at every read: the backup repositories
  are added to their rules (`e2e/scripts/local-fixtures.mts`,
  `viewIdentityWithoutPortForward` and `viewIdentityOfAnExecPlugin`). The two
  readers of the restricted suites keep their kinds: the first never reads the
  three, and the second is given them with the fixtures of the fourth pull request.
- The records of the Overview, its kinds and its plurals, are keyed by the five
  families it reads, and not by every family: the sixth is the repositories, with
  the third pull request.
- The column of the backup or the restore of an operation is titled by the kind
  it names, Backup or Restore, with the stable identifier `operation`.
- An operation with no phase is labelled "No phase yet", beside the New of the
  release, and is read as one New is: waiting, and no failure.
- A progress with bytes done and no total is said with the bytes and no total,
  before it is compared with the total: the total of none is the estimate the data
  path did not give yet.
- The words of the states of a family for a list, a view and a reference are
  written once for every kind, in `src/common/volume-words.ts`, which the page of a
  list, the view of one object and the references of every kind read; the text of
  each is the one of before.
- The Settings band of the view of a pod volume backup or restore says whether a
  cancellation was asked, from `spec.cancel`, which the release reads to stop the
  data path: Asked or Not asked, with the note that a cancellation is asked by a
  write, which the views do not make (REQ-190). It is a field of the spec the
  table of the kinds names, read as the others are, and the views offer no way to
  write it (`src/renderer/pages/volume-operation-workspace.tsx`).

Decided while implementing, on 2026-10-27, for the review of the milestone to confirm:

- The states of REQ-178 are told by the status of the read of a family and by
  when it last succeeded, which every surface reads, and are proven on the lists,
  the views and the references that word them: no function names them apart, since
  a second name for each state would change nothing that is shown.
- The mark of an uploader or a type of repository the release does not write is
  the one of a phase and of a readiness it does not write, before the value as it
  is written, with its words for who does not see the mark, in the tip of a cell
  and in the note of a view; a result of a maintenance it does not write keeps the
  word Unknown before its text, as a phase does. An uploader or a type that is not
  set is said so, with no mark, and a result that is not reported has none either:
  neither is a value.
- Labels of an owner that carry its name and no UID take the UID of the owner
  reference that names the same object, so that an object created again under the
  name is told from the owner as the label of the UID tells it; the release writes
  both labels, and an object without the second is not one it made.
- The column of the backup or of the restore of an operation is marked, when its
  family is of an earlier read, by the notice over the list, which names the family
  and the time of its last read, as the lists of the schedules and of the
  repositories mark the columns they take from another family: the owner stays a
  way, with why in its tip, and no mark of its own is drawn in each row of a column
  whose every row is of the same read (the row Stale of What Is Not Known).
- A link of the host in a cell of a list, the one to the node of an operation, is
  a flex box inside the flex box of the cell, by one rule of the stylesheet for any
  link of the host there, so that the badge of its words sits on the line of its
  row and a long name is cut with its ellipsis; a node that is not reported, and an
  owner that is not named, are said in a badge of the cell as well.
- No packaged suite of the cell of the node is added by the first pull request: the
  lists of the pod volume operations have no rows in the test environment until
  their fixtures. The cell is proven by the test of the stylesheet and the test of
  the cells on the double of `LinkToNode`, and with rows by one packaged check run
  from a temporary suite that is not kept, whose result the packaged cases record;
  the packaged proof with rows comes with the fixtures of the lists, in a later pull
  request of T5.1.

T5.1, the second of its five pull requests: the band of the volume operations in
the summary of a backup and of a restore, what used a repository last in its view,
and the way from a row of the Volumes tab to the pod volume operation that matches
it, with the index of the operations made once for a read, on 2026-10-29. From it
the views of a backup and of a restore hold their family of the pod volume
operations, and the view of a repository both.

The gates of phase A, on 2026-10-29, on the branch made from main at `083d534`,
with Node 24.21.0, pnpm 12.14.0, TypeScript 7.0.2, Vitest 5.0.5, Biome 2.5.15, Knip
6.41.0 and the launcher of Trunk 1.3.4: `pnpm type:check`, the nine programs, and
`pnpm lint:check`, 307 files, each with no error; `pnpm test:unit`, the build, then
99 files and 2,898 tests, all passed, 4 files and 45 tests more than main, then the
three measures within their budgets; `pnpm knip:check`, both passes with no finding;
and Trunk on the 45 files the branch changes, with no issue; each commit
type-checked and linted alone, on a copy of each, with no error. The second form of
the unit run, with `VITE_PRESERVE_MODULES=false`, and the measures on a quiet
machine ran after the rebase, below.

The gates again after the review of the second pull request, on 2026-10-29, on the
same base and toolchain, with its fixes in three commits of code and suites and one
of documents: `pnpm type:check`, the nine programs, `pnpm lint:check`, 307 files,
and `pnpm knip:check`, each with no finding; `pnpm test:unit`, the build, then 99
files and 2,911 tests, all passed, 4 files and 58 tests more than main, then the
three measures within their budgets; Trunk on the 45 files the branch changes, with
no issue; each of the nine commits type-checked and linted alone. A rebase on a main
that moves the validation target runs them again with its toolchain, and is written
here.

The gates again after the rebase on main at `c16c159`, which moves the validation
target to Freelens 2.0.0, on 2026-10-29, with no conflict, with pnpm 12.15.0, the SDK
2.0.0 and Electron 44.10.0, and with the two commits of the ways of the Volumes tab
after it, the second after the review of the fixes: on the machine of the runs,
`pnpm type:check`, the nine programs, `pnpm lint:check`, 307 files, `pnpm build` and
`pnpm knip:check`, each with no finding; Trunk on the 45 files the branch changes,
with no issue; each commit type-checked and linted alone. On a second Linux machine,
Ubuntu 26.04 under WSL 2 on 16 processors, from a bundle of the same code:
`pnpm test:unit` with `VITE_PRESERVE_MODULES=false`, at a load of 0.50, then in its
normal form, each in 23 seconds: the build, then 99 files and 2,913 tests, all
passed, 4 files and 60 tests more than main, then the three measures within their
budgets.

The unit and component evidence, by check:

- KIND-02 and KIND-15: the view of a backup asks the pod volume backups at once,
  alone, and at every read, and not the pod volume restores, the view of a restore
  the converse, the view of a schedule neither, the repositories still asked at
  every read; the view of a repository asks both at once and at every read, and a
  pod volume backup opened from it keeps them; once the way closes, both are let go
  at the read after (`src/renderer/pages/volume-lists.test.tsx`). Opening a backup
  or a restore from its list asks the family of its band and nothing else
  (`src/renderer/pages/backups-page.test.tsx`,
  `src/renderer/pages/restores-page.test.tsx`), and the tabs of a backup count what
  they ask once that read ended (`src/renderer/pages/operation-tabs.test.tsx`). A
  backup and a pod volume backup opened from its band keep the family between them,
  let go at the read after the way closes; a backup, a pod volume backup from its
  band and the storage location of that operation keep it at every read, and the way
  back draws the operation and the band with no spinner of a family asked again; a
  repository, a pod volume backup of what used it and its storage location keep the
  pod volume restores, and a pod volume restore, its repository and its storage
  location the pod volume backups, each family read only by a view under the one on
  top (`src/renderer/pages/volume-band.test.tsx`). The notice of the pod volume backups
  denied is said over a backup and over a repository, and not over a restore or a
  schedule (`src/renderer/pages/volume-workspaces.test.tsx`). A read that fails
  keeps the rows of the band and says when they were read
  (`src/renderer/pages/volume-band.test.tsx`).
- KIND-11: the index finds the operations of a backup and of a restore by the label
  of the UID in their namespace, from the newest; an operation with no label of a
  UID, one of another namespace and one that names the UID of another backup of the
  same name are each left out of it; the operations of a restore are from the
  newest as well, whatever their names; and it is made in one pass over each family,
  each item read once (`src/common/volume-index.test.ts`). The counts are in the groups of
  `backup describe` for a backup and of `restore describe` for a restore, line by
  line in their order, none and New together, Canceling of a restore and a phase the
  release does not write each after them, no operation left out; the band of a
  backup holds its own from the newest and none of another backup, and a restore of
  the UID of a backup is not counted in it; a backup synced from the store holds the
  operations whose label the sync rewrote to its UID, with the sentence of a backup
  that ended; the sentence of each phase of a backup and of a restore; what used a
  repository counted by kind and by phase, from the newest, with the backups and the
  restores they belong to, a kind denied kept with its read and no count, and none
  of each kind when nothing names it (`src/common/volume-band.test.ts`); what used a
  repository found by its three labels through the cut of a location of 64
  characters and whole at 63, an operation of another type or of another location not
  counted, and a repository without the three labels named by none
  (`src/common/volume-index.test.ts`). In the views: a backup of 23 pod volume backups
  counted in its groups, ten rows from the newest then ten more twice, the focus on
  the first row added, each row the volume as a way to the view of the operation,
  which returns to the backup, the pod and the node as the links of the host, the
  phase with its mark and the bytes done of the total; scenario 1, the band says
  nothing of the items and the item progress keeps its fact; scenario 2, one Failed
  counted, with the message of Velero in the tip of its row, beside the failure of
  the backup in its status; a backup with none; a restore in the groups of
  `restore describe`, Canceling after them, its row a way to the pod volume restore;
  what used a repository last in its view, by kind and by phase, the newest of each
  and the backups and the restores they belong to, each a way, a kind denied named
  with why and the other counted, the backups of its operations ten at a time with
  the focus on the first added, and that no pod volume operation of the installation
  used it when both were read and none names it
  (`src/renderer/pages/volume-band.test.tsx`). An
  operation whose labels name its owner and carry no UID is left out of the band, as
  REQ-187 says, while `backup describe` lists the pod volume backups by the label of
  the name: the band follows the requirement, since the label of a long name is cut
  and another object may take the name.
- KIND-12: the namespace of the pod, the pod and the volume of a row of a pod volume
  backup and of a pod volume restore, read as texts from `pvbInfo` and `pvrInfo`,
  and none when one of the three is empty or not a text
  (`src/common/artifact-volumes.test.ts`); the ways of an owner by them, the newest
  when two name the same, none for another owner of the same pod and volume, none
  when the family is denied, even after a read that found them, while the band keeps
  them as of that read, and kept after a read that failed or of a kind no longer
  served, and while the family is asked again (`src/common/volume-band.test.ts`, the
  rows of the band kept after each of the three in
  `src/renderer/pages/volume-band.test.tsx`); the way in the details of a row of a
  pod volume backup and of a pod volume restore, which opens
  the view of the operation, and nothing offered and nothing said for a row that no
  operation matches, or with no ways
  (`src/renderer/components/volumes-viewer.test.tsx`); the ways the same object at a
  read that leads to the same operations, in whatever order, and a new one when they
  change, a row then leading to a newer operation of its pod and volume
  (`src/renderer/state/volumes.test.ts`); the viewer of the volumes given the ways
  and not drawn again at a read that changes none of them, and drawn again once, with
  them, at a read that does (`src/renderer/components/artifact-panel.test.tsx`).
- KIND-14: no control of the band writes: its rows are ways, and its one command
  pages them (`src/renderer/pages/volume-band.test.tsx`).
- KIND-15, the index of a read: one for each installation, the same object at every
  drawing and every tick until a family it is made of is read again, a new one when
  one is or when the availability of the API changes what a read is said to be, and
  none at a read of the backups (`src/renderer/state/volumes.test.ts`).
- KIND-16: the band in each state of the read of its family, each with its words:
  not read yet, being read, said once, denied and failed with no count, not served,
  none among the ones the installation holds, and of an earlier read with its rows
  and when, and what used a repository in each of those states, a kind of an
  earlier read saying so in place with its rows or with none, and that no pod volume
  operation used it said only when each kind was read now
  (`src/renderer/pages/volume-band.test.tsx`); when the next maintenance of
  a repository is due, being read while the storage locations were never answered,
  and computed once they are (`src/common/repository-view.test.ts`,
  `src/renderer/pages/volume-band.test.tsx`). Every sentence is asserted once as a
  literal and read from `src/common/volume-words.ts` elsewhere.
- KIND-18, the index: the unit measure `test/volume-index.measure.ts`, which
  `pnpm test:unit` runs after the other tests, of the index of 1,000 backups, 1,000
  restores and 2,000 pod volume backups made for a read, and of the band of a
  backup of 200 of them, twenty times after five that warm them: the index at
  8.64 ms at the 95th percentile of 250 and the band at 0.05 ms, a tick of the clock
  answering the index of the read, the band holding the 200 counted once each, in
  the unit run of phase A, on 2026-10-29, at a load of 3.3; on a quiet machine, the
  second Linux machine at a load of 0.50 after the rebase, the index at 3.49 ms at the
  95th percentile and 2.11 at the median, and the band at 0.04 ms.

The packaged cases, written in phase A and run in phase B: the suite of the tabs
with the bands of the real backup and of the real restore of the demo, each saying
that the installation holds none of its pod volume operations and what the release
does with them, with no row and no way, nothing written; the two rows of the backup
synced for the tabs that name a pod volume backup of a synthetic pod, which no
operation of the installation matches, whose details offer no way and say nothing
absent; the band of the real backup read, and not denied, through the two identities
of the suite; the suite of the volumes with one list of the pod volume backups at
each read while a backup is open and none of the pod volume restores, and the converse
while a restore is open (KIND-02), within the bound of the lists, which the run of
the pattern on 2026-10-29 met with one list at each read, three of three, with a
backup and with a restore open, and none of the other family (the report
`kind-02-reads-of-the-pod-volume-operations`); the suite of the restores with one
list of the pod volume restores when a restore opens and nothing else, and the band
of a restore with
none, with the sentence of one that waits for its plugin operations, and of one that
failed its validation; the notices of the two restricted suites over a backup and
over a restore with the families those views now read; the pictures of the
pre-review of the workspace of a backup and of a restore, taken once their band says
that the installation holds none. Their runs: on 2026-10-29, the pattern of the
views job, 16 files and 255 cases, passed whole on Freelens 2.0.0 built at
`b9b53e16`, on a second Linux machine and on the hosted runner, and the suite of the
volumes alone on the second machine (TESTING.md). The two rows of the
synced backup pass whatever the matching of a row does, since the installation of
the views holds no pod volume backup: the row that leads to its operation, the real
backup of the volumes of KIND-12, has its packaged case with the fixtures of the
fourth pull request.

The unit measure of the index is of the 1,000 backups, the 1,000 restores and the
2,000 pod volume backups of REQ-194, and of the band of a backup of 200 operations
made from it. The 200 data uploads REQ-194 names beside them join the measure with
the data movement, in T5.2, which reads them: until then the measure is of the pod
volume operations alone, a deviation of the population of REQ-194.

Decided while implementing, on 2026-10-29:

- The frame of a page holds the families read on demand of every view of the way
  that is open, not of the view on top alone: a backup, a pod volume backup opened
  from its band and the storage location of that operation keep the pod volume
  backups between them, and the way back draws the operation and the band from what
  was read, with no view that waits for its family again. The address names every
  view of the way as open, so a family is still read only while a view that needs
  it is open (REQ-194), at one list of it at each read while the way is
  (`src/renderer/components/views-frame.tsx`; the
  [architecture](../development/ARCHITECTURE.md#the-reads-of-the-first-views) and
  AGENTS.md restated).
- Each view reads the families it shows, by the rule decided while implementing, on
  2026-10-26: the view of a backup reads its family of the operations, the pod
  volume backups, and the view of a restore the pod volume restores, the band
  showing nothing of the repositories or of the other family; the view of a
  repository reads the two families of the pod volume operations, and the backups
  and the restores, which what used it counts and leads to. No read of the cluster
  changes for the backups and the restores, which are read at every read: what
  changes is the notices over the view of a repository for a reader denied them
  (`src/common/views.ts`).
- The two identities of the views the runner makes for the suite of the tabs are
  given `get`, `list` and `watch` of the pod volume backups and the pod volume
  restores, as their other rules (`e2e/scripts/local-fixtures.mts`,
  `viewIdentityWithoutPortForward` and `viewIdentityOfAnExecPlugin`, pinned in
  `test/environment.test.ts`): the views of a backup and of a restore ask their
  family when they open, and the suite of the tabs opens a backup with the first.
  The two readers of the restricted suites keep their kinds: the first never reads
  the two families, and the second is given them with the fixtures of the fourth
  pull request; until then the notices over a backup and over a restore name the
  family that is denied.
- When the next maintenance of a repository is due, on a first read where the
  repositories answer before the storage locations: the view says that the
  locations are being read, and that the server runs no maintenance of a repository
  of a read-only one, in place of the words of a location that is not known, which
  stay for one that is denied, failed, not served or absent
  (`src/common/repository-view.ts`, its words in `src/common/volume-words.ts`).
- The index of the operations is made of the two families of the pod volume
  operations alone, and its memo, one entry for each installation, is keyed by
  their reads as they are stored and by the availability of the API: the backups,
  the restores and the repositories are not in the key, since the index is not made
  of them, and a read of them makes no new index. It takes none of the maps of the
  first pull request: the operations of a backup and of a restore are keyed by the
  label of the UID, and what used a repository by its three labels through the cut,
  keyed as the repository of an operation is found (`tripleKey`, exported for it
  from `src/common/volume-references.ts` with no change of what it answers); the
  owners named in what used a repository are resolved as the view of an operation
  resolves its owner, through the maps of the reads of the backups and the restores
  made once for each array of items (`src/common/volume-index.ts`,
  `src/renderer/state/volumes.ts`).
- No map of the rows of the Volumes tab is made in the index: the ways of a tab
  are made from the operations of its owner, which the index holds from the newest,
  by the namespace of the pod, the pod and the volume, the newest when more than
  one names the same. A map of the rows of every owner would be made at each read
  for tabs that are not open (`src/common/volume-band.ts`).
- The ways given to the viewer of the volumes are the same object for as long as
  they lead to the same operations, in whatever order, kept when a new index gives
  the same ways: each
  read makes a new index, and ways made by a memo of the panel keyed by the index
  would draw the viewer again at each read (`src/renderer/state/volumes.ts`).
- The groups of the counts: an operation with no phase is counted with New, as
  `backup describe` counts it, for both kinds, its row keeping the label "No phase
  yet"; Canceling of a restore, which `restore describe` has no group for, and a
  phase the release does not write are each counted in a group of their own after
  the groups of the release, with their label and their mark, the second by its
  text: no operation is left out of the counts.
- The sentence of a backup that ended: no rule of the views tells a backup synced
  from the store, and the band guesses none. It says that the pod volume backups the
  installation holds of the backup are the ones its run made, or the ones a sync
  from the store made, in the phase they were stored in. The sentences of a restore
  say what the release does with its pod volume restores by its phase, the node
  agent of the node of each restored pod taking its own when the init container
  `restore-wait` of that pod runs. A restore has no sentence of its deletion: the
  release writes no phase Deleting for a restore, and one that reports it is said to
  report a phase the release does not write.
- An operation whose labels name its owner and carry no UID is left out of the
  band of that owner, which finds its operations by the label of the UID as REQ-187
  says, while its own view names its owner from the owner reference: the release
  writes both labels.
- Each half of the band has its own words: the half of the pod volume operations of
  a backup says that it has no pod volume backup among the ones the installation
  holds, and of a restore no pod volume restore, where What Is Not Known says it of
  the volume operations of the whole band; the half of the data movement says its
  own with the second slice. What used a repository reads the pod volume operations
  alone as well, and says that no pod volume operation of the installation used it,
  where the table of the states says that nothing of the installation used it, which
  holds once the data movement is read.
- A row of the Volumes tab has no way while the family of the operations of its
  owner is denied, even when a read before found its operation, as the table of the
  states says. A read that failed, or of a kind no longer served, keeps the ways of
  the read before, as the band keeps its rows (REQ-191): the notice over the view
  says that the family is of an earlier read, and when, and a way that a passing
  failure took away would take the focus with it. A read asked again keeps the ways
  until it ends (`src/common/volume-band.ts`). The way of a row of the band is named
  by its volume, then by the operation it opens, since the pods of one StatefulSet
  share the name of a volume.
- The rows of the band after the first ten, and the backups and the restores of
  what used a repository after the first ten, are given by "Show ten more", a
  command of the band, which gives the focus to the first it added; the list cannot
  be narrowed by owner. A row of the band shows no time, since the band names none
  for a row (the workspaces, above): a tick of the clock of the views moves nothing
  in it.
- The two restricted suites restate the notices over the view of a backup and of a
  restore with the families those views now read. The words of the band for a
  reader denied the pod volume backups, with no count, are proven at the component
  layer here, and in the packaged application by the fifth pull request (scenario
  7).
