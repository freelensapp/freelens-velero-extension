# T0.1: Versioned Contract Recon

Date: 2026-09-18

Status: Source and schema review complete; runtime validation not performed.

Scope: the first task of the [roadmap](ROADMAP.md), not scaffolding or feature
implementation. This report contains public upstream API facts only. No cluster was
contacted, no environment data were collected, and no upstream code was executed.

## Reviewed Revisions

| Component | Reviewed revision | Evidence |
| --- | --- | --- |
| Velero release | `v1.18.2`, `c253c7fe37d78c9b7e55c68544f7c5b2608712d8` | [Release](https://github.com/velero-io/velero/releases/tag/v1.18.2), [source](https://github.com/velero-io/velero/tree/c253c7fe37d78c9b7e55c68544f7c5b2608712d8) |
| Velero main comparison | `60163e0827e72658bb6546165a727300170e628b` | [Immutable comparison source](https://github.com/velero-io/velero/tree/60163e0827e72658bb6546165a727300170e628b) |
| AWS object-store plugin | `v1.14.2`, `5463822fd77bc1c2a1151ee76c830ad979ff2781` | [Release](https://github.com/velero-io/velero-plugin-for-aws/releases/tag/v1.14.2), [compatibility](https://github.com/velero-io/velero-plugin-for-aws/blob/5463822fd77bc1c2a1151ee76c830ad979ff2781/README.md) |
| Freelens host | `v1.10.3`, `3da74415bff57a77c6e08cb5f538191ce87bac17` | Local Git tag inspection; [versioned source](https://github.com/freelensapp/freelens/tree/3da74415bff57a77c6e08cb5f538191ce87bac17) |

The release endpoints reported Velero v1.18.2 and the AWS plugin v1.14.2 as the
latest stable releases at inspection time; both were published on 2026-06-26.
The plugin's versioned compatibility table pairs v1.14.x with Velero v1.18.x.

The [Velero release compatibility table](https://github.com/velero-io/velero/blob/c253c7fe37d78c9b7e55c68544f7c5b2608712d8/README.md)
lists Kubernetes 1.18 onward as expected compatibility, with 1.33.7, 1.34.1, and
1.35.0 tested upstream. That is not an extension test result. Choose and verify
the actual kind node image, plugin image digests, and S3 backend version in T0.4; do not
upgrade or replace the existing persistent kind cluster as a side effect.

## Corrections To The Initial Assumptions

| Topic | v1.18.2 evidence | Consequence |
| --- | --- | --- |
| Download failure | `DownloadRequest` has only `New` and `Processed`; no `status.message` | A client deadline is required; newer `Failed` responses must also be handled |
| New printer columns | Backup, Restore, and VolumeSnapshotLocation have no printer columns in this release; the reviewed main adds them | Author useful columns using release fields; main columns are design guidance, not a baseline capability |
| Status patching | None of the 13 release CRDs declares a status subresource | Static fixtures must use ordinary object creation/patching, not `/status`; verify readback on kind |
| TLS CA configuration | `spec.objectStorage.caCertRef` is already present; inline `caCert` is deprecated | Support both, with explicit Secret/key access in main and no bucket-credential extraction |
| Schedule adherence | `lastBackup` records submission, not successful completion; `lastSkipped` affects the next run | Separate firing, outcome, and uncertainty; do not infer protection from one timestamp |
| Pause/resume | CLI updates `paused` and `skipImmediately` | Specify immediate-run behavior explicitly in the action UX |
| Request creation in host | Public `Main.K8s` has apply/patch/delete, but does not export its internal generic `execute` helper | Select a supported create-only adapter; do not call an unexported API or silently upsert requests |

## CRD And Phase Contracts

The [release CRD schemas](https://github.com/velero-io/velero/tree/c253c7fe37d78c9b7e55c68544f7c5b2608712d8/config/crd)
were parsed with a locally available YAML parser. All 13 kinds are namespaced:

| API version | Kinds |
| --- | --- |
| `velero.io/v1` | Backup, Restore, Schedule, BackupStorageLocation, VolumeSnapshotLocation, BackupRepository, PodVolumeBackup, PodVolumeRestore, DeleteBackupRequest, DownloadRequest, ServerStatusRequest |
| `velero.io/v2alpha1` | DataUpload, DataDownload |

Backup phases, confirmed in the release and reviewed main:
`New`, `Queued`, `ReadyToStart`, `FailedValidation`, `InProgress`,
`WaitingForPluginOperations`, `WaitingForPluginOperationsPartiallyFailed`,
`Finalizing`, `FinalizingPartiallyFailed`, `Completed`, `PartiallyFailed`,
`Failed`, `Deleting`.

Restore phases, confirmed in both revisions:
`New`, `FailedValidation`, `InProgress`, `WaitingForPluginOperations`,
`WaitingForPluginOperationsPartiallyFailed`, `Finalizing`,
`FinalizingPartiallyFailed`, `Completed`, `PartiallyFailed`, `Failed`.

The CLI's wait logic treats Completed, PartiallyFailed, Failed, and
FailedValidation as finished. Waiting/finalizing phases remain in flight,
including their partially-failed variants. Deleting is not successful completion.
Keep lifecycle separate from failure state, and preserve an unknown state for
unrecognized values and missing data.

Backup progress uses `itemsBackedUp` and `totalItems`; Restore progress uses
`itemsRestored` and `totalItems`. Item progress reaching 100% is not evidence that
the entire operation is terminal. Start/completion timestamps, error/warning counts,
and validation errors must be interpreted alongside phase.

Schedule phases are New, Enabled, and FailedValidation. BSL and VSL schemas admit
Available/Unavailable, but their optional status fields do not guarantee a reported
health value. An absent field must not become a healthy badge.

BSL release printer columns are Phase, Last Validated, Age, and Default. Schedule
columns are Status, Schedule, LastBackup, Age, and Paused. Add access mode to the
BSL experience independently: `spec.accessMode` is authoritative, while
`status.accessMode` is explicitly unused/deprecated. An Available ReadOnly location
is not a writable backup destination.

Unknown future enum values belong in unit/mocked boundary tests, not invalid
fixtures forced into the pinned CRD schemas. Do not weaken those schemas for tests.

## Namespace And Relationship Contracts

The [server manager](https://github.com/velero-io/velero/blob/c253c7fe37d78c9b7e55c68544f7c5b2608712d8/pkg/cmd/server/server.go#L268)
limits its cache to the installation namespace. A cluster-wide BSL list can reveal
several installations when permitted, but an empty BSL list cannot discover an
incomplete installation or prove Velero absent. Namespace-scoped fallback and
separate absent/forbidden/unknown states remain required.

Resolve relationships by cluster, namespace, names, and labels:
`Restore.spec.backupName`, `Restore.spec.scheduleName`,
`Backup.spec.storageLocation`, `Backup.spec.volumeSnapshotLocations`, and the
`velero.io/schedule-name`, `velero.io/backup-name`, `velero.io/restore-name`, and
`velero.io/storage-location` labels. Do not require ownerReferences for the primary
relationships; tolerate removed or unreadable targets.

Static fixture namespaces can be kept outside the server's configured namespace,
but the actual installed controllers, including any node-agent, must be checked
in T0.4/T0.5 before assuming fixture status will remain unchanged.

## Download Protocol

Sources: [release API](https://github.com/velero-io/velero/blob/c253c7fe37d78c9b7e55c68544f7c5b2608712d8/pkg/apis/velero/v1/download_request_types.go),
[main API](https://github.com/velero-io/velero/blob/60163e0827e72658bb6546165a727300170e628b/pkg/apis/velero/v1/download_request_types.go),
[CLI download helper](https://github.com/velero-io/velero/blob/c253c7fe37d78c9b7e55c68544f7c5b2608712d8/pkg/cmd/util/downloadrequest/downloadrequest.go),
[release controller](https://github.com/velero-io/velero/blob/c253c7fe37d78c9b7e55c68544f7c5b2608712d8/pkg/controller/download_request_controller.go),
[object-store mapping](https://github.com/velero-io/velero/blob/c253c7fe37d78c9b7e55c68544f7c5b2608712d8/pkg/persistence/object_store.go#L95).

1. Create a namespaced DownloadRequest with name `<target>-<uuid>` and
   `spec.target.kind/name`. This is a write, not read-only browsing.
2. The release CLI polls every 25 ms until a URL exists or its context expires.
   The extension should define bounded polling/backoff instead of copying that rate.
   Accept a URL, stop on a newer server's Failed phase, or stop at the client deadline.
3. The controller resolves the associated Backup and BSL, then signs the object key.
   For restore targets it first resolves the Restore and its backup. Release errors
   can leave the request pending without a terminal failure field.
4. URLs have a ten-minute lifetime in the reviewed implementation. Use promptly;
   never cache, persist, log, or expose the URL through renderer diagnostics.
5. The CLI performs a GET and decompresses gzip for all targets except BackupContents.
   HTTP 404 is returned as a missing file, not evidence of a broken storage service.
   Processed means a URL was signed, not that the artifact exists. Other auth,
   expired-link, TLS, and transport failures must remain distinguishable.

The API supports 14 download target kinds: BackupLog, BackupContents,
BackupVolumeSnapshots, BackupItemOperations, BackupResourceList, BackupResults,
RestoreLog, RestoreResults, RestoreResourceList, RestoreItemOperations,
CSIBackupVolumeSnapshots, CSIBackupVolumeSnapshotContents, BackupVolumeInfos and
RestoreVolumeInfo. This inventory is not a feature allowlist. The v1.0.0 candidate
allowlist is limited to BackupLog, RestoreLog, BackupResults, RestoreResults, BackupResourceList,
RestoreResourceList, BackupVolumeInfos, and RestoreVolumeInfo. Payload rendering and
actual artifact availability need kind fixtures; the other API targets are not
implicitly enabled. BackupContents remains excluded.

Creating DownloadRequest grants access to signing functionality capable of exposing
full backup contents. Hiding that target in the UI does not narrow the Kubernetes
permission itself; the eventual RBAC documentation must state this boundary.

### TLS And In-Cluster Stores

The [BSL type](https://github.com/velero-io/velero/blob/c253c7fe37d78c9b7e55c68544f7c5b2608712d8/pkg/apis/velero/v1/backupstoragelocation_types.go)
supports inline CA bytes and `caCertRef` identifying a Secret/key in the same
namespace. Its validation rejects specifying both. The
[CLI CA resolver](https://github.com/velero-io/velero/blob/c253c7fe37d78c9b7e55c68544f7c5b2608712d8/pkg/cmd/util/cacert/bsl_cacert.go)
prefers the reference and reports missing Secret/key errors. The extension must
resolve only the requested certificate in main, respect RBAC, retain verified TLS
by default, and never automatically fall back to insecure verification.

The [pinned plugin configuration](https://github.com/velero-io/velero-plugin-for-aws/blob/5463822fd77bc1c2a1151ee76c830ad979ff2781/backupstoragelocation.md)
supports `s3Url`, `s3ForcePathStyle`, and `publicUrl`. An existing publicUrl is used
as the signing endpoint. The extension must not modify a BSL to make downloads work.
The [signing implementation](https://github.com/velero-io/velero-plugin-for-aws/blob/5463822fd77bc1c2a1151ee76c830ad979ff2781/velero-plugin-for-aws/object_store.go#L485)
returns the SDK's presigned GET URL, without requiring desktop bucket credentials.

The plugin pins AWS SDK Go v2 v1.41.12. Its
[SigV4 signer](https://github.com/aws/aws-sdk-go-v2/blob/v1.41.12/aws/signer/v4/v4.go)
includes Host, escaped path, and query in the canonical request. Replacing the
signed authority with localhost changes the signed request. A tunnel must preserve
the original HTTP Host, signed path/query, and TLS hostname/SNI while changing only
the connection destination. This requirement is source-confirmed; at the date of
this report a working forwarded download was not verified yet and belonged to T0.6.

The transport spec must also bound bytes and decompression, restrict destinations
and redirects, cancel underlying I/O, redact errors, and clean up owned sockets.
No endpoint or signed URL from a real environment was used in this investigation.

## Server Information

The [shared CLI getter](https://github.com/velero-io/velero/blob/c253c7fe37d78c9b7e55c68544f7c5b2608712d8/pkg/cmd/cli/serverstatus/server_status.go)
is used by version and plugin commands. It creates a ServerStatusRequest with an
empty spec and a generated name, and polls every 250 ms for Processed. Both CLI
commands default to a five-second timeout; this is not a mandated extension timeout.

The [controller](https://github.com/velero-io/velero/blob/c253c7fe37d78c9b7e55c68544f7c5b2608712d8/pkg/controller/server_status_request_controller.go)
sets `serverVersion`, `plugins` (name/kind), and `processedTimestamp`. The API has
New/Processed, without a terminal failure phase. Processed requests become eligible
for deletion after one minute; periodic reconciliation is five minutes, so this is
not a promise of immediate cleanup. Treat creation and any client cleanup as writes.

## Actions And Schedule Adherence

| Operation | Source-confirmed behavior | Required design consideration |
| --- | --- | --- |
| Create backup | [CLI builder](https://github.com/velero-io/velero/blob/c253c7fe37d78c9b7e55c68544f7c5b2608712d8/pkg/cmd/cli/backup/create.go#L365) populates scope, selectors, TTL, storage/snapshot locations and volume options | Preserve optional/unset booleans and server defaults; preview the submitted object |
| Backup from schedule | [FromSchedule](https://github.com/velero-io/velero/blob/c253c7fe37d78c9b7e55c68544f7c5b2608712d8/pkg/builder/backup_builder.go#L85) copies the template, prefers template labels, adds the schedule label, copies annotations and optionally sets the Schedule ownerReference | A template copy needs metadata handling, not just copying its spec |
| Restore | [CLI](https://github.com/velero-io/velero/blob/c253c7fe37d78c9b7e55c68544f7c5b2608712d8/pkg/cmd/cli/restore/create.go) requires backupName XOR scheduleName, uses singular `namespaceMapping`, and accepts existing-resource policy `none` or `update` | CLI namespace scope defaults broadly; use explicit safe UI choices and explain the actual submitted scope |
| Restore from schedule | [Controller selection](https://github.com/velero-io/velero/blob/c253c7fe37d78c9b7e55c68544f7c5b2608712d8/pkg/controller/restore_controller.go#L367) picks the most recent Completed backup by start time; the CLI can explicitly opt into PartiallyFailed by selecting a concrete backup | Do not silently choose a partial backup; address the difference between a previewed backup and later server-side selection |
| Pause/resume | [Shared pause implementation](https://github.com/velero-io/velero/blob/c253c7fe37d78c9b7e55c68544f7c5b2608712d8/pkg/cmd/cli/schedule/pause.go#L139) changes paused and skipImmediately through an object update | Define immediate-run behavior and use conflict-aware, namespace-bound operations |
| Delete backup | [CLI](https://github.com/velero-io/velero/blob/c253c7fe37d78c9b7e55c68544f7c5b2608712d8/pkg/cmd/cli/backup/delete.go#L124) creates DeleteBackupRequest with generateName, backupName, normalized backup-name label and backup-uid label | Double confirmation, one backup at a time, no direct Backup deletion; Processed does not replace checking request errors |

The [schedule controller](https://github.com/velero-io/velero/blob/c253c7fe37d78c9b7e55c68544f7c5b2608712d8/pkg/controller/schedule_controller.go)
uses robfig/cron v3.0.1
[ParseStandard](https://github.com/robfig/cron/blob/v3.0.1/parser.go): five fields,
descriptors including `@every`, and TZ/CRON_TZ prefixes. Without an explicit timezone
the parser uses the server's local timezone, not the desktop's timezone.

Next-run calculation starts from lastBackup, or schedule creation when absent,
then uses lastSkipped if it is later. Paused schedules are skipped. Submission is
also withheld when a previous matching backup is empty-phase, New, or InProgress,
or when that check cannot list backups. The controller does not replay every missed
run. Successful submission updates lastBackup; successful completion is separate.

The adherence spec therefore needs an explicit timezone policy, skipped-run and
in-flight explanations, grace/clock-skew handling, and unknown states for incomplete
history or permissions. A cron parser alone cannot establish the health signal.

## Freelens Integration Boundary

Versioned source confirms the following in the pinned host:

- [KubeObjectMenu](https://github.com/freelensapp/freelens/blob/3da74415bff57a77c6e08cb5f538191ce87bac17/packages/core/src/renderer/components/kube-object-menu/kube-object-menu.tsx)
  exposes editable/removable controls. The
  [kind/version menu handler](https://github.com/freelensapp/freelens/blob/3da74415bff57a77c6e08cb5f538191ce87bac17/packages/core/src/renderer/kube-object/handler.ts)
  can customize the menu items, including detail-toolbar actions.
- [List layout](https://github.com/freelensapp/freelens/blob/3da74415bff57a77c6e08cb5f538191ce87bac17/packages/core/src/renderer/components/kube-object-list-layout/kube-object-list-layout.tsx)
  permits overriding the item menu; inherited controls include selection and removal
  buttons. Disabling a row menu alone does not prove bulk deletion is unavailable.
- [Public main K8s exports](https://github.com/freelensapp/freelens/blob/3da74415bff57a77c6e08cb5f538191ce87bac17/packages/core/src/extensions/main-api/k8s.ts)
  include query/get/apply/patch/delete. The internal generic execute helper is not
  exported. [applyOnCluster](https://github.com/freelensapp/freelens/blob/3da74415bff57a77c6e08cb5f538191ce87bac17/packages/core/src/extensions/common-api/k8s-functions.ts)
  first looks up a name, then creates or updates. It is not a proven create-only
  contract for generated-name requests.

T0.2 must define the create adapter and error contract; T0.6 must verify generated
names, collisions, namespace/cluster binding, and cancellation. Do not solve this
by calling private host internals or modifying another repository. No API prototype
has been implemented in T0.1.

The extension's safety controls govern its own workflows; they are not a replacement
for Kubernetes RBAC or a guarantee against operations outside the extension.

## Upstream Drift Watch

The [process](PROCESS.md#upstream-drift-watch) asks for this comparison at the start
of every milestone. Public upstream sources only; nothing was run.

### Start Of The First Milestone, 2026-09-27

| Component | Latest release | Compared with |
| --- | --- | --- |
| Velero | `v1.18.3`, `cd3fd10b093dad32ee284e27fcba4e9073c9c94b`, released 2026-09-21 | `v1.18.2`, the reviewed one |
| AWS object-store plugin | `v1.14.3`, `d70da1cca708440aedeaabaed2f2b91277a02547`, released 2026-09-21 | `v1.14.2`, the reviewed one |

Between the two Velero releases, 86 commits and 300 files. Of the API and of the
CRD schemas:

| Change | Where | Effect on the extension |
| --- | --- | --- |
| New optional field `spec.resourcePolicy` of Restore, a reference to a ConfigMap of filter policies | `restore_types.go`, `velero.io_restores.yaml` | None on the first milestone. The Restore type and view of the second milestone read it |
| New annotation `velero.io/global-backup-volume-policy-configmap`, on a Backup that a cluster-wide volume policy contributed to | `labels_annotations.go` | None: the Backup views show the annotations they know and keep the others as they are |
| New annotation `restore.velero.io/must-include-additional-items`, set by plugins on restored items, removed before they are applied | `labels_annotations.go` | None: it is not on the objects the extension reads |

The Backup schema, the 13 Backup phases and the 10 Restore phases are the same. No
field was removed or deprecated, no kind was added. The pins of the test environment
stay on the reviewed releases: moving them changes the compatibility reference of
the [roadmap](ROADMAP.md) and is a decision of the lead maintainer.

Newer than these there are release candidates only, `v1.18.4-rc.1` and
`v1.14.4-rc.1`: not a baseline.

### Start Of The Second Milestone, 2026-09-28

The latest releases are the ones of the start of the first milestone, `v1.18.3` and
`v1.14.3`, and newer than them there are the same release candidates. The schemas
of the kinds of the second milestone, compared between the reviewed release and
`v1.18.3`:

| Kind | Change | Effect on the extension |
| --- | --- | --- |
| Restore | The optional `spec.resourcePolicy` of the table above | The view of a restore shows it when the object carries it: [SPEC-0005](../specs/SPEC-0005-restore-read-only.md) |
| Schedule | None | None |
| BackupStorageLocation | None | None |
| VolumeSnapshotLocation | None | None |

What the specs of the milestone say of the behavior of Velero was read in the
source of the reviewed release. Nothing was run.

| Fact | Source |
| --- | --- |
| A restore asked from a schedule gets the name of the newest completed backup of the schedule written into `spec.backupName`; a restore asked from a backup gets the schedule of that backup written into `spec.scheduleName`. A restore that names both or neither fails its validation | [Restore controller](https://github.com/velero-io/velero/blob/c253c7fe37d78c9b7e55c68544f7c5b2608712d8/pkg/controller/restore_controller.go#L338-L405) |
| When it takes a restore Velero adds nine resources of its own to `spec.excludedResources` and fills `spec.itemOperationTimeout` when it is not set: the object is not only what was submitted | [The resources](https://github.com/velero-io/velero/blob/c253c7fe37d78c9b7e55c68544f7c5b2608712d8/pkg/controller/restore_controller.go#L65-L94), [the addition](https://github.com/velero-io/velero/blob/c253c7fe37d78c9b7e55c68544f7c5b2608712d8/pkg/controller/restore_controller.go#L306-L313), [the timeout](https://github.com/velero-io/velero/blob/c253c7fe37d78c9b7e55c68544f7c5b2608712d8/pkg/controller/restore_controller.go#L248-L251) |
| `status.startTimestamp` is written when the validation passes and not otherwise: a backup or a restore in FailedValidation has no start time and no completion time, and one that has not started has no start time | [Restore controller](https://github.com/velero-io/velero/blob/c253c7fe37d78c9b7e55c68544f7c5b2608712d8/pkg/controller/restore_controller.go#L241-L282), [backup controller](https://github.com/velero-io/velero/blob/c253c7fe37d78c9b7e55c68544f7c5b2608712d8/pkg/controller/backup_controller.go#L293-L298) |
| A schedule that is paused is left out of every event the controller reads, so its status is the one written before the pause, and one created paused has none | [Schedule controller](https://github.com/velero-io/velero/blob/c253c7fe37d78c9b7e55c68544f7c5b2608712d8/pkg/controller/schedule_controller.go#L73-L90), [the predicate](https://github.com/velero-io/velero/blob/c253c7fe37d78c9b7e55c68544f7c5b2608712d8/pkg/util/kube/predicate.go#L51-L66) |
| The controller writes Enabled or FailedValidation into a schedule it reads, never New | [Schedule controller](https://github.com/velero-io/velero/blob/c253c7fe37d78c9b7e55c68544f7c5b2608712d8/pkg/controller/schedule_controller.go#L121-L132) |
| When the object names no `spec.skipImmediately` the controller writes the setting of the server into it. When the value is true the controller sets it back to false and `status.lastSkipped` takes the time of that reading | [Schedule controller](https://github.com/velero-io/velero/blob/c253c7fe37d78c9b7e55c68544f7c5b2608712d8/pkg/controller/schedule_controller.go#L113-L154) |
| No backup of a schedule is submitted while one of its backups has no phase, is New or is InProgress, or while its backups cannot be listed. The other phases in flight do not hold it back | [Schedule controller](https://github.com/velero-io/velero/blob/c253c7fe37d78c9b7e55c68544f7c5b2608712d8/pkg/controller/schedule_controller.go#L161-L238) |
| A backup that names no storage location goes to the one marked default, or to the one the server names in its settings when none is marked | [Backup controller](https://github.com/velero-io/velero/blob/c253c7fe37d78c9b7e55c68544f7c5b2608712d8/pkg/controller/backup_controller.go#L428-L445) |
| A backup is refused for the access mode of its storage location only when the mode is ReadOnly, and is refused as well when the location is not available | [Backup controller](https://github.com/velero-io/velero/blob/c253c7fe37d78c9b7e55c68544f7c5b2608712d8/pkg/controller/backup_controller.go#L466-L476) |
| A restore is refused when the storage location of its backup is not available | [Restore controller](https://github.com/velero-io/velero/blob/c253c7fe37d78c9b7e55c68544f7c5b2608712d8/pkg/controller/restore_controller.go#L397-L400) |
| A storage location is available when its phase is Available, and in no other case: one that reports no phase is not | [The check](https://github.com/velero-io/velero/blob/c253c7fe37d78c9b7e55c68544f7c5b2608712d8/pkg/util/velero/velero.go#L130-L132) |
| The phase, the message and the last validation time of a backup storage location are written by its controller at every validation | [Storage location controller](https://github.com/velero-io/velero/blob/c253c7fe37d78c9b7e55c68544f7c5b2608712d8/pkg/controller/backup_storage_location_controller.go#L222-L238) |
| A storage location is validated at the frequency it names, or at the one of the server when it names none or one below zero; a frequency of zero turns the periodic validation off, after the first. The frequency of the server is one minute unless its settings say otherwise | [The rule](https://github.com/velero-io/velero/blob/c253c7fe37d78c9b7e55c68544f7c5b2608712d8/internal/storage/storagelocation.go#L48-L75), [the setting](https://github.com/velero-io/velero/blob/c253c7fe37d78c9b7e55c68544f7c5b2608712d8/pkg/cmd/server/config/config.go#L27) |
| Several storage locations marked default are brought back to one by the controller, the one created last. With none marked the controller logs a warning | [Storage location controller](https://github.com/velero-io/velero/blob/c253c7fe37d78c9b7e55c68544f7c5b2608712d8/pkg/controller/backup_storage_location_controller.go#L299-L301), [the same](https://github.com/velero-io/velero/blob/c253c7fe37d78c9b7e55c68544f7c5b2608712d8/pkg/controller/backup_storage_location_controller.go#L327-L375) |
| The last synced time of a storage location is written by the controller that syncs the backups | [Sync controller](https://github.com/velero-io/velero/blob/c253c7fe37d78c9b7e55c68544f7c5b2608712d8/pkg/controller/backup_sync_controller.go#L250) |
| Nothing writes or reads the status of a volume snapshot location: a search of `pkg` and `internal` finds its type and no use of it. The backup controller checks that a location a backup names exists, and never its phase | [The type](https://github.com/velero-io/velero/blob/c253c7fe37d78c9b7e55c68544f7c5b2608712d8/pkg/apis/velero/v1/volume_snapshot_location_type.go#L73-L89), [the controllers](https://github.com/velero-io/velero/tree/c253c7fe37d78c9b7e55c68544f7c5b2608712d8/pkg/controller) |
| For the AWS plugin the key of the configuration that turns off the verification of TLS is `insecureSkipTLSVerify` | [Plugin document](https://github.com/velero-io/velero-plugin-for-aws/blob/5463822fd77bc1c2a1151ee76c830ad979ff2781/backupstoragelocation.md) |

The review of the Restores, on the same day, found what the first reading had
missed. These facts were read in the same source; the first one was seen as well
on the backup and on the restore that the controller of the test environment ran,
whose objects carry no counter and an empty `hookStatus`.

| Fact | Source |
| --- | --- |
| The counters of the status are written without a zero: `errors`, `warnings`, the items done and their total, the hooks attempted and failed, the item operations attempted, completed and failed are left out of the object when they count none. The schema gives them no default. A backup or a restore that ended without an error has no `errors` | [Restore](https://github.com/velero-io/velero/blob/c253c7fe37d78c9b7e55c68544f7c5b2608712d8/pkg/apis/velero/v1/restore_types.go#L333-L394), [backup](https://github.com/velero-io/velero/blob/c253c7fe37d78c9b7e55c68544f7c5b2608712d8/pkg/apis/velero/v1/backup_types.go#L425-L496) |
| The errors and the warnings are counted when the work of the operation ends, and the phase that follows the work is given after them: WaitingForPluginOperations, Finalizing, their partially failed forms, and after them Completed and PartiallyFailed, are phases of an operation that was counted. The controllers that give these phases later, the ones of the operations of the plugins and the ones that finalize, add to the counters or leave them; a backup that is synced from the storage keeps the status it was stored with, which was written after the count | [Backup controller](https://github.com/velero-io/velero/blob/c253c7fe37d78c9b7e55c68544f7c5b2608712d8/pkg/controller/backup_controller.go#L803-L833), [restore controller](https://github.com/velero-io/velero/blob/c253c7fe37d78c9b7e55c68544f7c5b2608712d8/pkg/controller/restore_controller.go#L646-L694), [operations of a backup](https://github.com/velero-io/velero/blob/c253c7fe37d78c9b7e55c68544f7c5b2608712d8/pkg/controller/backup_operations_controller.go#L145-L211), [of a restore](https://github.com/velero-io/velero/blob/c253c7fe37d78c9b7e55c68544f7c5b2608712d8/pkg/controller/restore_operations_controller.go#L134-L189), [the end of a backup](https://github.com/velero-io/velero/blob/c253c7fe37d78c9b7e55c68544f7c5b2608712d8/pkg/controller/backup_finalizer_controller.go#L205-L212), [of a restore](https://github.com/velero-io/velero/blob/c253c7fe37d78c9b7e55c68544f7c5b2608712d8/pkg/controller/restore_finalizer_controller.go#L192-L247), [the sync](https://github.com/velero-io/velero/blob/c253c7fe37d78c9b7e55c68544f7c5b2608712d8/pkg/controller/backup_sync_controller.go#L166-L176) |
| Failed is given as well to an operation that was not counted: one whose work returned an error before its end, and one found InProgress when the server starts, which is failed with a reason and the time of the start of the server | [Backup controller](https://github.com/velero-io/velero/blob/c253c7fe37d78c9b7e55c68544f7c5b2608712d8/pkg/controller/backup_controller.go#L335-L346), [an existing backup](https://github.com/velero-io/velero/blob/c253c7fe37d78c9b7e55c68544f7c5b2608712d8/pkg/controller/backup_controller.go#L758-L766), [restore controller](https://github.com/velero-io/velero/blob/c253c7fe37d78c9b7e55c68544f7c5b2608712d8/pkg/controller/restore_controller.go#L270-L274), [the start of the server](https://github.com/velero-io/velero/blob/c253c7fe37d78c9b7e55c68544f7c5b2608712d8/pkg/cmd/server/server.go#L977-L1030) |
| The total of the items of a backup is written before the first item is done. The progress of a restore is written as the restore goes, the items done with their total. The work of both ends with a last write of the progress, in which the items done are the total | [Backup, the first write](https://github.com/velero-io/velero/blob/c253c7fe37d78c9b7e55c68544f7c5b2608712d8/pkg/backup/backup.go#L399-L409), [the last](https://github.com/velero-io/velero/blob/c253c7fe37d78c9b7e55c68544f7c5b2608712d8/pkg/backup/backup.go#L657-L683), [restore, as it goes](https://github.com/velero-io/velero/blob/c253c7fe37d78c9b7e55c68544f7c5b2608712d8/pkg/restore/restore.go#L500-L522), [the last](https://github.com/velero-io/velero/blob/c253c7fe37d78c9b7e55c68544f7c5b2608712d8/pkg/restore/restore.go#L657-L664) |
| The hooks of a backup are counted at the end of its work, with the last write of its progress. The hooks of a restore are counted when the restore is finalized, after the phases that follow its work: a restore that waits or that is being finalized has no status of its hooks. The operations of the plugins on the items are counted at the end of the work, and an operation is in one of the two phases that wait only when one of them did not end | [Backup](https://github.com/velero-io/velero/blob/c253c7fe37d78c9b7e55c68544f7c5b2608712d8/pkg/backup/backup.go#L666-L671), [restore](https://github.com/velero-io/velero/blob/c253c7fe37d78c9b7e55c68544f7c5b2608712d8/pkg/controller/restore_finalizer_controller.go#L585-L601), [operations of a restore](https://github.com/velero-io/velero/blob/c253c7fe37d78c9b7e55c68544f7c5b2608712d8/pkg/controller/restore_controller.go#L597-L599), [the phases that wait](https://github.com/velero-io/velero/blob/c253c7fe37d78c9b7e55c68544f7c5b2608712d8/pkg/controller/restore_controller.go#L678-L694) |
| A restore that names no namespace and no resource to include takes every one of the backup: a filter that includes nothing by name includes everything it does not exclude. What is restored of a namespace goes into the namespace the mapping gives for it, and into the namespace of the same name when the mapping has none | [What a filter includes](https://github.com/velero-io/velero/blob/c253c7fe37d78c9b7e55c68544f7c5b2608712d8/pkg/util/collections/includes_excludes.go#L243-L250), [the namespace of what is restored](https://github.com/velero-io/velero/blob/c253c7fe37d78c9b7e55c68544f7c5b2608712d8/pkg/restore/restore.go#L2307-L2310) |
| The resources Velero excludes and the timeout of the item operations are written into a restore before its validation is decided: a restore in FailedValidation carries them too. One submitted with both names is refused before any name is written; one asked from a schedule can be refused after the backup was chosen and written, when the backup or its storage location cannot be used | [Restore controller](https://github.com/velero-io/velero/blob/c253c7fe37d78c9b7e55c68544f7c5b2608712d8/pkg/controller/restore_controller.go#L234-L256), [the validation](https://github.com/velero-io/velero/blob/c253c7fe37d78c9b7e55c68544f7c5b2608712d8/pkg/controller/restore_controller.go#L304-L405) |
| With `spec.includeClusterResources` not set, the cluster-scoped resources are restored when the restore includes every namespace and excludes none, and skipped otherwise. A cluster-scoped item that a restored item brings with it is skipped only when the field is false | [The pass over the resources](https://github.com/velero-io/velero/blob/c253c7fe37d78c9b7e55c68544f7c5b2608712d8/pkg/restore/restore.go#L2262-L2278), [every namespace](https://github.com/velero-io/velero/blob/c253c7fe37d78c9b7e55c68544f7c5b2608712d8/pkg/util/collections/includes_excludes.go#L264-L268), [an item brought by another](https://github.com/velero-io/velero/blob/c253c7fe37d78c9b7e55c68544f7c5b2608712d8/pkg/restore/restore.go#L1117-L1160) |
| With no `spec.restoreStatus` the status is restored of the objects annotated `velero.io/restore-status` with true, and of no other. With the field set, a filter that includes no resource by name takes every resource, and the annotation of an object decides for that object | [The decision](https://github.com/velero-io/velero/blob/c253c7fe37d78c9b7e55c68544f7c5b2608712d8/pkg/restore/restore.go#L2613-L2659), [the filter](https://github.com/velero-io/velero/blob/c253c7fe37d78c9b7e55c68544f7c5b2608712d8/pkg/restore/restore.go#L225-L233), [what a filter includes](https://github.com/velero-io/velero/blob/c253c7fe37d78c9b7e55c68544f7c5b2608712d8/pkg/util/collections/includes_excludes.go#L243-L250) |
| A restore that is deleted keeps its object, with a time of deletion, until its controller has removed what it keeps of it in the storage | [Restore controller](https://github.com/velero-io/velero/blob/c253c7fe37d78c9b7e55c68544f7c5b2608712d8/pkg/controller/restore_controller.go#L189-L208) |

## Verification And Remaining Work

Completed checks:

- Public release/tag resolution and immutable primary source pins.
- Structured parsing of the two CRD trees: 13 namespaced kinds, 13 Backup phases,
  10 Restore phases, progress fields, printer-column differences, and the
  DownloadRequest release/main distinction.
- Source inspection of CLI actions, controllers, certificate resolution, signing,
  plugin compatibility, and the pinned Freelens API surface.
- Local documentation checks and editor diagnostics. No application build, unit
  suite, packaged-app integration, cluster command, or runtime endpoint test was run.

Still open at the date of this report (T0.2 to T0.6 were completed afterwards, with
SeaweedFS as the S3 backend: see [TESTING.md](TESTING.md)):

- T0.2: approved foundation specs, UX choices, create-only adapter design, exact
  validation/RBAC/error contracts, and the demo/test plan.
- T0.4/T0.5: actual pinned kind/Velero/S3 setup, controller isolation, accepted
  fixtures and status readback, cleanup ownership, and real local artifacts.
- T0.6: direct and forwarded downloads, preserved Host/SNI, both CA modes, explicit
  failure/timeout/404 behavior, cancellation, byte limits and destination controls.
- Feature stages: packaged UI behavior, multi-install and RBAC cases, schedule
  adherence, safe actions, performance, and release readiness.

No product-scope change is needed to complete this source audit. No real target has
been authorized or accessed. This report does not approve any feature spec.
