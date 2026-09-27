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
