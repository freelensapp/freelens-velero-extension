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

The review of the Schedules, on the same day, asked for the source of what the
views say of a schedule. These facts were read in the source of the reviewed
release and of the library it parses an expression with, at the version the
release names in its modules.

| Fact | Source |
| --- | --- |
| An expression is parsed by the library `robfig/cron` at `v3.0.1`. A prefix `TZ=` or `CRON_TZ=` names the time zone: the name is what is between the sign of equality and the first space. With no prefix the time zone is the local one of the server. A name that is empty is loaded as UTC, and the name `Local` is the local one of the server. A prefix with no space after it makes the library fail, which the controller turns into a validation error | [The modules](https://github.com/velero-io/velero/blob/c253c7fe37d78c9b7e55c68544f7c5b2608712d8/go.mod#L38), [the parser](https://github.com/robfig/cron/blob/v3.0.1/parser.go#L93-L103), [the time zones of Go](https://pkg.go.dev/time#LoadLocation), [the controller](https://github.com/velero-io/velero/blob/c253c7fe37d78c9b7e55c68544f7c5b2608712d8/pkg/controller/schedule_controller.go#L174-L212) |
| `status.lastBackup` is written when a backup is submitted, with the time the backup is created at, which is in the name of the backup as well. It says nothing of how the backup ended | [Schedule controller](https://github.com/velero-io/velero/blob/c253c7fe37d78c9b7e55c68544f7c5b2608712d8/pkg/controller/schedule_controller.go#L254-L273), [the backup](https://github.com/velero-io/velero/blob/c253c7fe37d78c9b7e55c68544f7c5b2608712d8/pkg/controller/schedule_controller.go#L291-L297) |
| The next run is counted from the last submission, or from the creation of the schedule when there is none, and from the last skipped time when it is later. `status.lastSkipped` is written whenever `spec.skipImmediately` is found true, whether a run was due or not | [The next run](https://github.com/velero-io/velero/blob/c253c7fe37d78c9b7e55c68544f7c5b2608712d8/pkg/controller/schedule_controller.go#L275-L289), [the skip](https://github.com/velero-io/velero/blob/c253c7fe37d78c9b7e55c68544f7c5b2608712d8/pkg/controller/schedule_controller.go#L113-L119) |
| The check that holds the submissions looks at every backup that carries the name of the schedule in its label, not at the newest one | [Schedule controller](https://github.com/velero-io/velero/blob/c253c7fe37d78c9b7e55c68544f7c5b2608712d8/pkg/controller/schedule_controller.go#L215-L239) |
| A backup of a schedule gets the template as its spec, the name of the schedule in the label `velero.io/schedule-name`, the labels of the template when it has some and the ones of the schedule when it has none, and the annotations of the schedule. It is owned by the schedule only when `spec.useOwnerReferencesInBackup` is true | [The builder](https://github.com/velero-io/velero/blob/c253c7fe37d78c9b7e55c68544f7c5b2608712d8/pkg/builder/backup_builder.go#L85-L125) |
| With more than one storage location marked default, a backup that names none goes to the first marked one of the list the controller is answered with | [Backup controller](https://github.com/velero-io/velero/blob/c253c7fe37d78c9b7e55c68544f7c5b2608712d8/pkg/controller/backup_controller.go#L428-L445) |
| A backup sent to a storage location that is not there fails its validation | [Backup controller](https://github.com/velero-io/velero/blob/c253c7fe37d78c9b7e55c68544f7c5b2608712d8/pkg/controller/backup_controller.go#L447-L464) |
| A backup that includes no namespace by name includes every namespace: the controller writes `*` into the included namespaces of the backup it takes, and the ones that are excluded stay excluded | [Backup controller](https://github.com/velero-io/velero/blob/c253c7fe37d78c9b7e55c68544f7c5b2608712d8/pkg/controller/backup_controller.go#L573-L578) |
| Before its validation is decided a backup gets the version of its format, its expiration and the label of its storage location, and its spec gets the retention and the timeouts of the server where it names none: a backup in FailedValidation carries them, with no start time | [What is filled](https://github.com/velero-io/velero/blob/c253c7fe37d78c9b7e55c68544f7c5b2608712d8/pkg/controller/backup_controller.go#L385-L411), [the label](https://github.com/velero-io/velero/blob/c253c7fe37d78c9b7e55c68544f7c5b2608712d8/pkg/controller/backup_controller.go#L479-L483), [the phase](https://github.com/velero-io/velero/blob/c253c7fe37d78c9b7e55c68544f7c5b2608712d8/pkg/controller/backup_controller.go#L293-L298) |
| The key `insecureSkipTLSVerify` of the configuration of a storage location is parsed as Go parses a boolean: `1`, `t`, `T`, `TRUE`, `true` and `True` are true. The release reads it for what it moves with restic, whatever the provider, and for its unified repository when the backend is the one of AWS | [Restic](https://github.com/velero-io/velero/blob/c253c7fe37d78c9b7e55c68544f7c5b2608712d8/pkg/restic/common.go#L141-L158), [where it is used](https://github.com/velero-io/velero/blob/c253c7fe37d78c9b7e55c68544f7c5b2608712d8/pkg/uploader/provider/restic.go#L103-L109), [the unified repository](https://github.com/velero-io/velero/blob/c253c7fe37d78c9b7e55c68544f7c5b2608712d8/pkg/repository/provider/unified_repo.go#L592-L600), [the parsing](https://github.com/velero-io/velero/blob/c253c7fe37d78c9b7e55c68544f7c5b2608712d8/pkg/repository/udmrepo/kopialib/backend/utils.go#L40-L54) |
| The backend of AWS is the provider `aws`, with the group `velero.io` or without it, and every provider that is not one the release knows whose configuration names an `s3Url` | [The backend](https://github.com/velero-io/velero/blob/c253c7fe37d78c9b7e55c68544f7c5b2608712d8/pkg/repository/config/config.go#L93-L110) |
| A backup sync period below zero is not taken: the release uses the one of its server. One of zero turns the sync of the location off | [Sync controller](https://github.com/velero-io/velero/blob/c253c7fe37d78c9b7e55c68544f7c5b2608712d8/pkg/controller/backup_sync_controller.go#L386-L398) |
| The controller looks every ten seconds for the storage locations whose validation is due | [Storage location controller](https://github.com/velero-io/velero/blob/c253c7fe37d78c9b7e55c68544f7c5b2608712d8/pkg/controller/backup_storage_location_controller.go#L43-L48) |
| Of several storage locations marked default the controller keeps the one whose time of creation is after the ones before it in the list it is answered with: of two created in the same second it keeps the first of that list, which it does not put in order | [Storage location controller](https://github.com/velero-io/velero/blob/c253c7fe37d78c9b7e55c68544f7c5b2608712d8/pkg/controller/backup_storage_location_controller.go#L341-L357) |
| The installer creates the storage location of an installation marked default, with no access mode and no validation frequency | [The installer](https://github.com/velero-io/velero/blob/c253c7fe37d78c9b7e55c68544f7c5b2608712d8/pkg/install/resources.go#L173-L193) |
| The phase New of a schedule is of the API and of the command line, which prints it for a schedule that reports none. No controller writes it | [The printer](https://github.com/velero-io/velero/blob/c253c7fe37d78c9b7e55c68544f7c5b2608712d8/pkg/cmd/util/output/schedule_printer.go#L57-L60), [the controller](https://github.com/velero-io/velero/blob/c253c7fe37d78c9b7e55c68544f7c5b2608712d8/pkg/controller/schedule_controller.go#L121-L132) |

### Start Of The Third Milestone, 2026-09-30

| Component | Latest release | Compared with |
| --- | --- | --- |
| Velero | `v1.18.4`, `4ee1e79a7aed367fd9b767b8219ec65bd0c96892`, released 2026-09-28 | `v1.18.2`, the reviewed one |
| AWS object-store plugin | `v1.14.4`, `7373ae03525ce743a4f95f13a8fa9f56c7b8f551`, released 2026-09-28 | `v1.14.2`, the reviewed one |

Between the reviewed release and `v1.18.4`, of what the third milestone rests on:

| Where | Change | Effect on the extension |
| --- | --- | --- |
| The controller of the download requests, the one of the server status requests, the persistence of the store, the download helper of the command line, the resolver of the certificate | One line each: the package of the errors | None |
| The volume information | The package of the errors, and a log line that no longer reads a nil name | None: the types and their fields are the same |
| The request of a restore | A field for the resource policies, beside `spec.resourcePolicy` of the first watch | None on the artifacts |
| The schemas of DownloadRequest and ServerStatusRequest | None | None |

The release notes of `v1.18.4` name one change, a backup queue that stayed
stuck. The main branch of Velero, `e5d9354ddf7607e0bad3ebc7744a4964c24b489a` on
this date, gives a DownloadRequest a third phase, Failed, which no release has:
the extension stops when it sees it and does not wait for it.

What the specs of the milestone say of the behavior of Velero was read in the
source of the reviewed release and of the reviewed plugin, and reviewed a second
time against the whole tree. Nothing was run.

| Fact | Source |
| --- | --- |
| A DownloadRequest names a target, a kind among fourteen and the name of a backup or of a restore, and has two phases, New and Processed. Its status carries the signed URL and an expiration. Neither the command line nor the extension writes a phase into it: the controller reads none as New | [The type](https://github.com/velero-io/velero/blob/c253c7fe37d78c9b7e55c68544f7c5b2608712d8/pkg/apis/velero/v1/download_request_types.go#L59-L86), [the builder](https://github.com/velero-io/velero/blob/c253c7fe37d78c9b7e55c68544f7c5b2608712d8/pkg/builder/download_request_builder.go#L31-L44), [the controller](https://github.com/velero-io/velero/blob/c253c7fe37d78c9b7e55c68544f7c5b2608712d8/pkg/controller/download_request_controller.go#L121) |
| The controller writes an expiration ten minutes ahead into every new request before it looks at anything, and patches the object whatever happens next; for a target of a restore it reads the restore and takes the name of its backup; a restore, a backup or a storage location that is not there is logged and leaves the request with no phase, its expiration and no URL, and the controller does not come back to it; a store that cannot be opened, for its settings or its credential, leaves it the same way; a signing that fails is retried; when a URL is signed the phase becomes Processed and the expiration is written again, ten minutes ahead | [Expiration and patch](https://github.com/velero-io/velero/blob/c253c7fe37d78c9b7e55c68544f7c5b2608712d8/pkg/controller/download_request_controller.go#L124-L133), [restore](https://github.com/velero-io/velero/blob/c253c7fe37d78c9b7e55c68544f7c5b2608712d8/pkg/controller/download_request_controller.go#L135-L157), [backup](https://github.com/velero-io/velero/blob/c253c7fe37d78c9b7e55c68544f7c5b2608712d8/pkg/controller/download_request_controller.go#L159-L169), [location](https://github.com/velero-io/velero/blob/c253c7fe37d78c9b7e55c68544f7c5b2608712d8/pkg/controller/download_request_controller.go#L171-L181), [store](https://github.com/velero-io/velero/blob/c253c7fe37d78c9b7e55c68544f7c5b2608712d8/pkg/controller/download_request_controller.go#L184-L190), [URL](https://github.com/velero-io/velero/blob/c253c7fe37d78c9b7e55c68544f7c5b2608712d8/pkg/controller/download_request_controller.go#L207-L216) |
| A request whose expiration has passed is deleted by the controller, whatever its phase, at its next pass: the controller looks for the expired ones every minute, and for no other. A request the server never saw carries no expiration and stays | [Deletion](https://github.com/velero-io/velero/blob/c253c7fe37d78c9b7e55c68544f7c5b2608712d8/pkg/controller/download_request_controller.go#L101-L115), [the pass](https://github.com/velero-io/velero/blob/c253c7fe37d78c9b7e55c68544f7c5b2608712d8/pkg/controller/download_request_controller.go#L222-L232), [the period](https://github.com/velero-io/velero/blob/c253c7fe37d78c9b7e55c68544f7c5b2608712d8/pkg/controller/download_request_controller.go#L41) |
| A signed URL is good for ten minutes. Each target kind is one key of the store: the log of a backup is `backups/<name>/<name>-logs.gz`, its results `<name>-results.gz`, its resource list `<name>-resource-list.json.gz`, its volume information `<name>-volumeinfo.json.gz`; of a restore, `restores/<name>/restore-<name>-logs.gz`, `restore-<name>-results.gz`, `restore-<name>-resource-list.json.gz` and `<name>-volumeinfo.json.gz`, under the prefix of the location; the metadata of a backup is `backups/<name>/velero-backup.json` and its contents `backups/<name>/<name>.tar.gz` | [The lifetime](https://github.com/velero-io/velero/blob/c253c7fe37d78c9b7e55c68544f7c5b2608712d8/pkg/persistence/object_store.go#L96), [the keys](https://github.com/velero-io/velero/blob/c253c7fe37d78c9b7e55c68544f7c5b2608712d8/pkg/persistence/object_store_layout.go#L72-L138), [the signing](https://github.com/velero-io/velero/blob/c253c7fe37d78c9b7e55c68544f7c5b2608712d8/pkg/persistence/object_store.go#L631-L662) |
| The command line names a request `<name of the target>-<uuid>`, asks for it every 25 milliseconds until a URL is there or its own timeout passes, a minute for the logs, sends a GET, reads 404 as a file that is not there, and decompresses gzip for every kind but the contents of a backup. It trusts the pool of the system with the certificate of the location added | [The name](https://github.com/velero-io/velero/blob/c253c7fe37d78c9b7e55c68544f7c5b2608712d8/pkg/cmd/util/downloadrequest/downloadrequest.go#L96), [the wait](https://github.com/velero-io/velero/blob/c253c7fe37d78c9b7e55c68544f7c5b2608712d8/pkg/cmd/util/downloadrequest/downloadrequest.go#L108), [the timeout](https://github.com/velero-io/velero/blob/c253c7fe37d78c9b7e55c68544f7c5b2608712d8/pkg/cmd/cli/backup/logs.go#L52), [404](https://github.com/velero-io/velero/blob/c253c7fe37d78c9b7e55c68544f7c5b2608712d8/pkg/cmd/util/downloadrequest/downloadrequest.go#L198), [gzip](https://github.com/velero-io/velero/blob/c253c7fe37d78c9b7e55c68544f7c5b2608712d8/pkg/cmd/util/downloadrequest/downloadrequest.go#L206), [trust](https://github.com/velero-io/velero/blob/c253c7fe37d78c9b7e55c68544f7c5b2608712d8/pkg/cmd/util/downloadrequest/downloadrequest.go#L134) |
| A backup that failed its validation runs nothing and writes nothing into the store. One that ran, and one that failed at work, are written into the store when the work ends: the log first, whose upload is best effort and whose failure does not fail the backup; then the metadata, without which nothing else is written; the contents; then the results, the resource list and the volume information, the last as an empty list when there is no volume. A backup that failed before the store was written, for a name the store already had or a store that could not be reached, writes nothing; when one of the files cannot be encoded only the log is written; when a later upload fails the metadata and the contents are deleted | [Validation](https://github.com/velero-io/velero/blob/c253c7fe37d78c9b7e55c68544f7c5b2608712d8/pkg/controller/backup_controller.go#L320-L326), [failed at work](https://github.com/velero-io/velero/blob/c253c7fe37d78c9b7e55c68544f7c5b2608712d8/pkg/controller/backup_controller.go#L806-L857), [before the store](https://github.com/velero-io/velero/blob/c253c7fe37d78c9b7e55c68544f7c5b2608712d8/pkg/controller/backup_controller.go#L757-L765), [the encoding](https://github.com/velero-io/velero/blob/c253c7fe37d78c9b7e55c68544f7c5b2608712d8/pkg/controller/backup_controller.go#L947-L981), [the order of the files](https://github.com/velero-io/velero/blob/c253c7fe37d78c9b7e55c68544f7c5b2608712d8/pkg/persistence/object_store.go#L268-L308) |
| The log of a restore is written into the store when its work ends, then its results, its resource list and its volume information, the last as an empty list when there is no volume. A restore that failed its validation writes nothing; one asked from a schedule that has no completed backup is refused without a backup name, and the controller of the download requests would find no backup for it | [The log](https://github.com/velero-io/velero/blob/c253c7fe37d78c9b7e55c68544f7c5b2608712d8/pkg/controller/restore_controller.go#L635-L642), [the rest](https://github.com/velero-io/velero/blob/c253c7fe37d78c9b7e55c68544f7c5b2608712d8/pkg/controller/restore_controller.go#L660-L676), [the schedule](https://github.com/velero-io/velero/blob/c253c7fe37d78c9b7e55c68544f7c5b2608712d8/pkg/controller/restore_controller.go#L369-L395) |
| The results of a backup and of a restore are one JSON object with the keys `warnings` and `errors`, each a Result: `velero`, a list of messages of Velero itself; `cluster`, of the cluster-scoped resources; `namespaces`, a map from a namespace to its messages. Each list is left out when it is empty. Of a backup they are the entries of its log at those two levels, each written by the hook of the server as `resource: /<resource> name: /<name> message: /<message> error: /<error>`, each part after a space and only the parts the entry has, and filed under the namespace of the entry, under the cluster when the entry names an empty one, or under Velero when it names none; its status counts the same entries. The errors of a backup grow later with the operations of its plugins, which write the status and not the file; the results of a restore are written again when it is finalized | [The results](https://github.com/velero-io/velero/blob/c253c7fe37d78c9b7e55c68544f7c5b2608712d8/pkg/util/results/result.go#L22-L39), [the hook](https://github.com/velero-io/velero/blob/c253c7fe37d78c9b7e55c68544f7c5b2608712d8/pkg/util/logging/log_counter_hook.go#L52-L92), [of a backup](https://github.com/velero-io/velero/blob/c253c7fe37d78c9b7e55c68544f7c5b2608712d8/pkg/controller/backup_controller.go#L803-L811), [the operations](https://github.com/velero-io/velero/blob/c253c7fe37d78c9b7e55c68544f7c5b2608712d8/pkg/controller/backup_operations_controller.go#L186), [of a restore](https://github.com/velero-io/velero/blob/c253c7fe37d78c9b7e55c68544f7c5b2608712d8/pkg/controller/restore_controller.go#L758-L776), [the finalizer](https://github.com/velero-io/velero/blob/c253c7fe37d78c9b7e55c68544f7c5b2608712d8/pkg/controller/restore_finalizer_controller.go#L221-L240) |
| The resource list of a backup is a JSON map from a resource, written as its API version and its kind, `v1/Pod` or `apps/v1/Deployment`, to its items, `namespace/name` or `name` for a cluster-scoped one, each list sorted. The one of a restore is the same map, each item with the action of the restore in parentheses after it: `created`, `updated`, `failed` or `skipped`, and every item has one | [The key of a backup](https://github.com/velero-io/velero/blob/c253c7fe37d78c9b7e55c68544f7c5b2608712d8/pkg/backup/item_backupper.go#L814-L819), [the map](https://github.com/velero-io/velero/blob/c253c7fe37d78c9b7e55c68544f7c5b2608712d8/pkg/backup/backed_up_items_map.go#L53-L72), [the key of a restore](https://github.com/velero-io/velero/blob/c253c7fe37d78c9b7e55c68544f7c5b2608712d8/pkg/restore/request.go#L48-L51), [its map](https://github.com/velero-io/velero/blob/c253c7fe37d78c9b7e55c68544f7c5b2608712d8/pkg/restore/request.go#L88-L111), [the actions](https://github.com/velero-io/velero/blob/c253c7fe37d78c9b7e55c68544f7c5b2608712d8/pkg/restore/request.go#L35-L40) |
| The volume information of a backup is a JSON list, one entry for each volume: the claim, its namespace, the volume, the method (`NativeSnapshot`, `PodVolumeBackup`, `CSISnapshot`), whether the data was moved, whether the local snapshot was kept, whether the volume was skipped and why, the start and the end, the result (`succeeded`, `failed`), and the details: of the CSI snapshot, of the data movement, of the native snapshot, of the pod volume, and of the volume itself. The size is in the details, not in the entry. Two fields of the details are written without a JSON name, `ReadyToUse` and `Phase`, and appear with that name. The one of a restore is a list of the claim, its namespace, the volume, the method (`PodVolumeRestore` among them), whether the data was moved, and the details | [Backup](https://github.com/velero-io/velero/blob/c253c7fe37d78c9b7e55c68544f7c5b2608712d8/internal/volume/volumes_information.go#L55-L98), [restore](https://github.com/velero-io/velero/blob/c253c7fe37d78c9b7e55c68544f7c5b2608712d8/internal/volume/volumes_information.go#L106-L129), [the methods](https://github.com/velero-io/velero/blob/c253c7fe37d78c9b7e55c68544f7c5b2608712d8/internal/volume/volumes_information.go#L41-L48), [the results](https://github.com/velero-io/velero/blob/c253c7fe37d78c9b7e55c68544f7c5b2608712d8/internal/volume/volumes_information.go#L99-L104), [the details](https://github.com/velero-io/velero/blob/c253c7fe37d78c9b7e55c68544f7c5b2608712d8/internal/volume/volumes_information.go#L131-L268) |
| The log of an operation is text unless the server is started with the JSON format, which holds for every log of the server; each entry carries its time, its level, its message and its fields, `backup=<namespace>/<name>` or `restore=<namespace>/<name>`, the source file and line that wrote it from the hook of the server, and for an error its text, its file and its function; in JSON the error is `error.message`. The level of a warning is written `warning` by the logging library | [The formats](https://github.com/velero-io/velero/blob/c253c7fe37d78c9b7e55c68544f7c5b2608712d8/pkg/util/logging/format_flag.go#L24-L33), [the flag](https://github.com/velero-io/velero/blob/c253c7fe37d78c9b7e55c68544f7c5b2608712d8/pkg/cmd/server/config/config.go#L224), [the field of a backup](https://github.com/velero-io/velero/blob/c253c7fe37d78c9b7e55c68544f7c5b2608712d8/pkg/controller/backup_controller.go#L725), [of a restore](https://github.com/velero-io/velero/blob/c253c7fe37d78c9b7e55c68544f7c5b2608712d8/pkg/controller/restore_controller.go#L502), [the source](https://github.com/velero-io/velero/blob/c253c7fe37d78c9b7e55c68544f7c5b2608712d8/pkg/util/logging/log_location_hook.go#L28), [the error](https://github.com/velero-io/velero/blob/c253c7fe37d78c9b7e55c68544f7c5b2608712d8/pkg/util/logging/error_location_hook.go#L29-L30), [in JSON](https://github.com/velero-io/velero/blob/c253c7fe37d78c9b7e55c68544f7c5b2608712d8/pkg/util/logging/default_logger.go#L56-L75) |
| A ServerStatusRequest has an empty spec and two phases, New and Processed, and is created without one. The controller writes into a new one the version of the server, the plugins it loaded, each with its name and its kind, in no order, and the time; a processed request may be deleted a minute after that time, and is, when the controller looks at it again, which it does five minutes after it processed it. The command line never deletes it | [The type](https://github.com/velero-io/velero/blob/c253c7fe37d78c9b7e55c68544f7c5b2608712d8/pkg/apis/velero/v1/server_status_request_types.go#L47-L88), [processing](https://github.com/velero-io/velero/blob/c253c7fe37d78c9b7e55c68544f7c5b2608712d8/pkg/controller/server_status_request_controller.go#L104-L116), [deletion](https://github.com/velero-io/velero/blob/c253c7fe37d78c9b7e55c68544f7c5b2608712d8/pkg/controller/server_status_request_controller.go#L117-L136), [the two times](https://github.com/velero-io/velero/blob/c253c7fe37d78c9b7e55c68544f7c5b2608712d8/pkg/controller/server_status_request_controller.go#L41-L42), [the plugins](https://github.com/velero-io/velero/blob/c253c7fe37d78c9b7e55c68544f7c5b2608712d8/internal/velero/serverstatusrequest.go#L31-L44) |
| The command line creates the request with a generated name, `velero-cli-` and a suffix, and asks for it every 250 milliseconds until it is Processed or its timeout passes, five seconds for the version. The kinds of the plugins a request lists are ObjectStore, VolumeSnapshotter, BackupItemAction, BackupItemActionV2, RestoreItemAction, RestoreItemActionV2, DeleteItemAction and ItemBlockAction; the ninth kind of the release, PluginLister, is never listed. The command line compares the major and the minor of its version with the ones of the server, and not the patch | [The name](https://github.com/velero-io/velero/blob/c253c7fe37d78c9b7e55c68544f7c5b2608712d8/pkg/cmd/cli/serverstatus/server_status.go#L42), [the wait](https://github.com/velero-io/velero/blob/c253c7fe37d78c9b7e55c68544f7c5b2608712d8/pkg/cmd/cli/serverstatus/server_status.go#L70), [the timeout](https://github.com/velero-io/velero/blob/c253c7fe37d78c9b7e55c68544f7c5b2608712d8/pkg/cmd/cli/version/version.go#L38), [the kinds](https://github.com/velero-io/velero/blob/c253c7fe37d78c9b7e55c68544f7c5b2608712d8/pkg/plugin/framework/common/plugin_kinds.go#L28-L77), [the comparison](https://github.com/velero-io/velero/blob/c253c7fe37d78c9b7e55c68544f7c5b2608712d8/pkg/cmd/cli/version/version.go#L86-L95) |
| A plugin is named from the provider of a location by the rule of the release: a provider without a slash gets `velero.io/` before it | [The rule](https://github.com/velero-io/velero/blob/c253c7fe37d78c9b7e55c68544f7c5b2608712d8/pkg/plugin/clientmgmt/manager.go#L424-L431), [where it is used](https://github.com/velero-io/velero/blob/c253c7fe37d78c9b7e55c68544f7c5b2608712d8/pkg/persistence/object_store.go#L197) |
| A storage location names its certificate as a Secret and a key in its own namespace, `caCertRef`, or inline, `caCert`, which is deprecated. The server and the command line prefer the reference, and read the inline one only when there is no reference | [The type](https://github.com/velero-io/velero/blob/c253c7fe37d78c9b7e55c68544f7c5b2608712d8/pkg/apis/velero/v1/backupstoragelocation_types.go#L149-L160), [the server](https://github.com/velero-io/velero/blob/c253c7fe37d78c9b7e55c68544f7c5b2608712d8/pkg/persistence/object_store.go#L172-L184), [the command line](https://github.com/velero-io/velero/blob/c253c7fe37d78c9b7e55c68544f7c5b2608712d8/pkg/cmd/util/cacert/bsl_cacert.go#L81-L116) |
| The sync of the backups creates, at every pass of a minute, a Backup for every `velero-backup.json` of an available location whose name is not in the cluster and whose metadata decodes, unless the backup is in a phase that waits or finalizes and has not expired; it writes the namespace and the label of the location and keeps the other labels of the metadata. The garbage collection asks the deletion of a backup whose expiration has passed through a DeleteBackupRequest. The deletion of a backup needs its location available and not read-only, downloads the contents of the backup first, treats one that is not there as final, then removes the files of the backup from the store, its restores, its object and its requests | [The sync](https://github.com/velero-io/velero/blob/c253c7fe37d78c9b7e55c68544f7c5b2608712d8/pkg/controller/backup_sync_controller.go#L94-L191), [the period](https://github.com/velero-io/velero/blob/c253c7fe37d78c9b7e55c68544f7c5b2608712d8/pkg/cmd/server/config/config.go#L26), [the garbage collection](https://github.com/velero-io/velero/blob/c253c7fe37d78c9b7e55c68544f7c5b2608712d8/pkg/controller/gc_controller.go#L128-L133), [the deletion](https://github.com/velero-io/velero/blob/c253c7fe37d78c9b7e55c68544f7c5b2608712d8/pkg/controller/backup_deletion_controller.go#L198-L207), [the contents](https://github.com/velero-io/velero/blob/c253c7fe37d78c9b7e55c68544f7c5b2608712d8/pkg/controller/backup_deletion_controller.go#L262-L283), [the files](https://github.com/velero-io/velero/blob/c253c7fe37d78c9b7e55c68544f7c5b2608712d8/pkg/controller/backup_deletion_controller.go#L364-L368) |
| A label of a name longer than 63 characters is cut to 57 and six characters of its digest | [The label](https://github.com/velero-io/velero/blob/c253c7fe37d78c9b7e55c68544f7c5b2608712d8/pkg/label/label.go#L37-L51) |
| The AWS plugin signs a URL with the presign client of the SDK, over the endpoint `publicUrl` of the configuration when it is set and over `s3Url` otherwise; with neither, over the endpoint of the region of the bucket, which it looks up. The plugin forces the bucket into the path only when `s3ForcePathStyle` is true, and leaves the addressing to the SDK otherwise, which is a label of the host; it sets no other option of the endpoint. The signature of the SDK covers the host, the path and the query, which the proof of T0.6 saw a storage refuse when the host was changed | [The signing](https://github.com/velero-io/velero-plugin-for-aws/blob/5463822fd77bc1c2a1151ee76c830ad979ff2781/velero-plugin-for-aws/object_store.go#L485-L497), [the endpoint of the signing](https://github.com/velero-io/velero-plugin-for-aws/blob/5463822fd77bc1c2a1151ee76c830ad979ff2781/velero-plugin-for-aws/object_store.go#L227-L235), [the region](https://github.com/velero-io/velero-plugin-for-aws/blob/5463822fd77bc1c2a1151ee76c830ad979ff2781/velero-plugin-for-aws/object_store.go#L164-L178), [the client](https://github.com/velero-io/velero-plugin-for-aws/blob/5463822fd77bc1c2a1151ee76c830ad979ff2781/velero-plugin-for-aws/config.go#L91-L107), [the style of the path](https://github.com/velero-io/velero-plugin-for-aws/blob/5463822fd77bc1c2a1151ee76c830ad979ff2781/backupstoragelocation.md), [the signer](https://github.com/aws/aws-sdk-go-v2/blob/v1.41.12/aws/signer/v4/v4.go) |

### While The Third Milestone Was Implemented, 2026-10-04

What the server of the test environment, which is the reviewed release, answered
to a ServerStatusRequest, and where the source of that release says why:

| Fact | Source |
| --- | --- |
| The server lists a BackupItemAction and a RestoreItemAction twice in a ServerStatusRequest, each time with its own kind. Its registry puts a plugin of a kind that a newer kind adapts, BackupItemAction for BackupItemActionV2 and RestoreItemAction for RestoreItemActionV2, in the list of the newer kind as well, and the request is filled from the list of every kind, with the kind of each entry. The registry holds one plugin for a kind and a name: an entry of a request that repeats both repeats a plugin. The server of the test environment answered with 57 entries for 36 plugins | [The registration](https://github.com/velero-io/velero/blob/c253c7fe37d78c9b7e55c68544f7c5b2608712d8/pkg/plugin/clientmgmt/process/registry.go#L211-L235), [the kinds that are adapted](https://github.com/velero-io/velero/blob/c253c7fe37d78c9b7e55c68544f7c5b2608712d8/pkg/plugin/framework/common/plugin_kinds.go#L57-L63), [the plugins of a request](https://github.com/velero-io/velero/blob/c253c7fe37d78c9b7e55c68544f7c5b2608712d8/internal/velero/serverstatusrequest.go#L31-L44) |

What the server of the test environment did with the operations the transport
proof asks it to refuse, and where the source says why:

| Fact | Source |
| --- | --- |
| A backup, and a restore, that name both `labelSelector` and `orLabelSelectors` fail their validation, each with a sentence that names both keys. Nothing else of them needs to be wrong: the backup keeps a valid storage location, and the restore a valid backup, so that the server signs a URL for their artifacts, which the store does not have | [Backup](https://github.com/velero-io/velero/blob/c253c7fe37d78c9b7e55c68544f7c5b2608712d8/pkg/controller/backup_controller.go#L593-L596), [restore](https://github.com/velero-io/velero/blob/c253c7fe37d78c9b7e55c68544f7c5b2608712d8/pkg/controller/restore_controller.go#L333-L336) |
| A restore that names a schedule takes the most recent completed backup that carries the label of that schedule. With no backup of the schedule it fails its validation, with `No backups found for schedule` and `No completed backups found for schedule`, and its spec keeps no name of a backup: the Schedule itself is not read | [Restore from a schedule](https://github.com/velero-io/velero/blob/c253c7fe37d78c9b7e55c68544f7c5b2608712d8/pkg/controller/restore_controller.go#L367-L389) |
| A request to delete a backup that failed its validation is carried out. The controller refuses a backup that is still in progress and a storage location that is not there, is read-only or is unavailable, and nothing by the phase of the backup; a tarball the store does not have does not stop the deletion; the restores whose spec names the backup are deleted with it | [In progress](https://github.com/velero-io/velero/blob/c253c7fe37d78c9b7e55c68544f7c5b2608712d8/pkg/controller/backup_deletion_controller.go#L168-L172), [the location](https://github.com/velero-io/velero/blob/c253c7fe37d78c9b7e55c68544f7c5b2608712d8/pkg/controller/backup_deletion_controller.go#L187-L208), [the tarball](https://github.com/velero-io/velero/blob/c253c7fe37d78c9b7e55c68544f7c5b2608712d8/pkg/controller/backup_deletion_controller.go#L265-L281), [the restores](https://github.com/velero-io/velero/blob/c253c7fe37d78c9b7e55c68544f7c5b2608712d8/pkg/controller/backup_deletion_controller.go#L372-L393) |

How the server reads the bucket and the prefix of a storage location, which is what
the key of an artifact in a signed URL is made of:

| Fact | Source |
| --- | --- |
| The slashes before and after the bucket and the prefix of a location are taken off. A bucket that still has a slash inside is refused: the location is not opened, and nothing is signed for it. The folders of the store are the prefix joined to their names as a path, which drops an empty folder and the folder itself, and takes the folder above out with the one before it; the key of an artifact is joined to them the same way | [The bucket and the prefix](https://github.com/velero-io/velero/blob/c253c7fe37d78c9b7e55c68544f7c5b2608712d8/pkg/persistence/object_store.go#L145-L154), [the layout](https://github.com/velero-io/velero/blob/c253c7fe37d78c9b7e55c68544f7c5b2608712d8/pkg/persistence/object_store_layout.go#L32-L50), [a key](https://github.com/velero-io/velero/blob/c253c7fe37d78c9b7e55c68544f7c5b2608712d8/pkg/persistence/object_store_layout.go#L80-L82) |

What the API server asks of the identity that forwards a port, which is what a
download through the cluster does with the WebSocket handler of the client:

| Fact | Source |
| --- | --- |
| A port-forward over a WebSocket begins with an HTTP `GET`, which the API server authorizes as the verb `get` on `pods/portforward`; the older protocol posts, and is authorized as `create`. From Kubernetes 1.35 the gate `AuthorizePodWebsocketUpgradeCreatePermission`, beta and on by default, checks the verb `create` for the upgrade as well. An identity needs both verbs to forward a port on either side of that release. In the test environment, at 1.34, an identity with `create` alone is refused at the port-forward, and one with both downloads | [The description of the gate](https://github.com/kubernetes/website/blob/main/content/en/docs/reference/command-line-tools-reference/feature-gates/AuthorizePodWebsocketUpgradeCreatePermission.md), read on 2026-10-04; the identities of the transport proof |

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
