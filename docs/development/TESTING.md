# Testing Strategy

Date: 2026-09-25

Status: T0.3-T0.6 scaffold, environment, fixture and compiled-main transport checks
pass. Actual Freelens activation has no automated test yet.

This is a desktop Electron extension with renderer UI, main-process Kubernetes
operations and object-storage transport. The binding safety/privacy rules are in
[AGENTS.md](../../AGENTS.md); domain evidence is in [RECON-T0.1.md](RECON-T0.1.md).
The [roadmap](ROADMAP.md) is the single source of truth for progress, not this
strategy document. The sections named after a task (T0.4, T0.5, T0.6) are dated
evidence of the runs of the foundation phase, on one Linux machine.

## Prerequisite Evidence

Non-mutating checks on 2026-09-18 established Node.js v22.23.2, a responsive Docker
daemon through the explicitly local Unix socket, and available corepack, pnpm, kind
and kubectl CLIs. No Docker context listing, Kubernetes request, install, service
start, or container creation was performed. T0.3 must select the toolchain required
by the pinned SDK/build; these checks do not prove a full build environment.

T0.3 uses Node v24.15.0, pnpm v10.34.4 and SDK v1.10.3. The manifest declares exactly
Freelens v1.10.3, not v2. Electron/Playwright host launch, app installation, display
support, fixture images and runtime authentication remain unverified and separately
gated. No Kubernetes access occurred during scaffold checks.

T0.4 preflight confirmed the explicitly local Docker daemon and existing kind
v0.29.0/kubectl v1.33.4, with sufficient capacity and an unused dedicated demo name.
Local-kind identity, generated-kubeconfig, network-overlap and ownership guards now
have synthetic unit tests. Their presence alone does not prove environment readiness.
Setup scripts use Node's built-in TypeScript stripping; no new runtime dependency
or global CLI upgrade is required.
Their environment guard also removes inherited cloud credentials/profiles and
disables AWS ambient credential/metadata lookup. No AWS/Azure account or online
service access is authorized by this local setup; explicit target/operation approval
would be required under the canonical directives.

T0.4 resumed on 2026-09-24 with official [SeaweedFS 4.47](LOCAL-STORAGE.md).
The dedicated kind cluster, Velero server/node-agent, storage and BSL are now ready.
Runtime authentication, network isolation and temporary-resource cleanup pass.
At that stage no backup or restore was run. T0.5, authorized on 2026-09-25, now
verifies real ConfigMap recovery, multipart metadata, diagnostic artifacts, static
isolation and restricted permissions. Current setup/fixture coverage is 52 tests.
No extension download service, upstream rebuild or scanner was used.

There is no legacy Velero extension test baseline. The official extension and host
integration conventions are reference assets, not pre-existing Velero coverage.
Reuse suitable installation/launch helpers in an isolated harness with new
Velero-specific journeys. The tests are copied into the Freelens checkout of the
harness under their own names; they never replace the tests of a checkout somebody
else works in.

## Primary Validation Stack

| Layer | Planned tooling and dependencies | Proves |
| --- | --- | --- |
| Unit/domain | Vitest; synthetic objects, fake clock, table-driven phases | Classification, durations, progress, relationships, policy and schema validation |
| Component | Vitest and host-compatible React testing utilities, stub host APIs | States, accessible interactions, forms, tabs and no implicit diagnostic writes |
| Main contract | Vitest with injected Kubernetes adapter and loopback HTTP/TLS test servers | IPC validation, create-only behavior, retry policy, abort, size limits and sanitized errors |
| Kubernetes integration | Real local kind, pinned Velero/plugin and authenticated local S3 backend | API schema acceptance, generated names, controller outcomes, artifacts and permissions |
| Packaged application | Pinned Freelens Electron integration harness driven by Playwright | Tarball installation/activation, host APIs, navigation and actual UI behavior |
| Pre-review | Same local app plus deterministic DOM checks and synthetic screenshots | Both-theme layout, links, focus, menu safety and regressions before manual judgment |

Unit/component and main-contract tests are reachable through the canonical
`pnpm test:unit` planned script. Do not add a second runner that bypasses that gate.
The host packaged integration runner remains a separate documented runtime gate;
Vitest alone is not a packaged-app result.

## Critical Journeys

1. Open Velero in a selected local test cluster; distinguish installed, absent,
   restricted and configured-namespace cases, then switch installations while a
   previous request is pending without showing or acting on its data.
2. Filter Backups, open a running or failed operation and follow its related objects;
   all pinned phases, unknown mocked phases and incomplete progress remain truthful.
3. Confirm a diagnostic request, retrieve a real local artifact, and exercise missing
   file, denied permission, timeout, TLS failure, excessive payload and cancellation.
4. Compare schedule submission evidence with expected firing under pauses, skipped
   runs, timezone/DST, incomplete history and in-flight backups without false alarms.
5. Confirm each action on local kind, inspect the resulting object/controller state,
   and verify duplicate, wrong-target and disabled-write refusal. A cancelled UI wait
   does not claim to cancel the server-side backup or restore.
6. Install the exact tarball into the pinned app, traverse every shipped view in both
   themes and test toolbar, row, drawer and selection paths for unintended deletion.

Each journey follows setup -> action -> assertions -> owned-fixture cleanup. Mocked
and synthetic-status outcomes supplement, not replace, real-controller proof.

## Local Environment And Fixture Ownership

- Verified T0.4 target: a dedicated local kind cluster for this extension, with an
  isolated one-target kubeconfig. The persistent `kind-kind` remains untouched.
  Capacity, current routes, identity and official image pins were checked before
  installation. Revalidate on subsequent runs; cluster deletion requires explicit
  approval even during teardown.
- Never change global Docker/Kubernetes contexts or use a remote daemon. Match the
  exact expected context and verify local kind ownership before every test session;
  an unknown or mismatched target stops the run before any Kubernetes request.
- Install pinned Velero v1.18.2 and the compatible AWS plugin v1.14.2 with the accepted
  local S3 backend. The proposed SeaweedFS release and digest are recorded in
  [LOCAL-STORAGE.md](LOCAL-STORAGE.md); installation passed on 2026-09-24.
  Test volumes use only disposable synthetic data, with no external storage fallback.
- Separate the live installation namespace from static-phase fixtures outside the
  installed controllers' watch scope. Verify both server and node-agent behavior;
  use a second isolated local kind environment only if separation cannot be proven.
- Fixture factories preserve the base-manifest followed by ordinary status-patch
  sequence. Typed factories generate fresh run labels/namespaces and payloads instead
  of checking large generated manifests into the repository. The pinned CRDs have
  no `/status`; exact readback and unchanged schemas are required. Do not weaken
  enums or schemas to make synthetic cases pass.
- Generate fixture/run identifiers locally and label resources with ownership.
  Record a private local ownership journal before writes. Refuse collisions with
  pre-existing resources. Never run a broad namespace or cluster cleanup without
  checking ownership and the expected local target.
- Cleanup removes test-created operations, workload namespaces, data and networks
  while preserving unrelated resources, add-ons and the user-owned cluster. Reusable
  demo infrastructure has an explicit lifetime and teardown command, not a trap that
  deletes a cluster. Report cleanup failure instead of declaring a clean run.
- Multi-cluster tests use another local kind target only with that setup step's
  authorization; mocked cluster switches alone do not prove two-cluster routing.

## Fixture Matrix

| Family | Required cases | Evidence type |
| --- | --- | --- |
| Real operations | Completed backup/restore with known synthetic resources and retrievable artifacts | Live Velero controller |
| Primary states | Every Backup/Restore phase; active/paused/invalid Schedule; ReadOnly/Unavailable BSL; unreported VSL health | Validated static objects plus selected real outcomes |
| Validation failures | Missing BSL and invalid inputs; distinguish actual controller result from forced presentation | Live where reproducible; otherwise labelled synthetic |
| Future/bad data | Unknown enum, impossible timestamps, negative counts, contradictory phase/progress | Unit/component mocks, not schema-invalid cluster fixtures |
| Isolation | Equal names in two namespaces/clusters, recreated UID, removed selection and late completion | Unit plus authorized local integration |
| Permissions | CRD list denied, namespace-only reads, one-kind list denied, diagnostic create denied, certificate Secret denied | Restricted local credentials and injected typed failures |
| Network | Authenticated direct/in-cluster S3, Host/path/query/SNI, negative signature/expiry, CRC32/multipart integrity, CA inline/reference, redirects, DNS policy, timeout/cancel and byte limits | Local runtime and loopback contract servers |
| Safety/privacy | BackupContents, generic delete/bulk, write-gate bypass, sensitive URL/Secret sentinel in diagnostics | Main/component plus packaged-app tests |

Local test identities and credential files stay outside repositories with restrictive
permissions. Do not commit certificates with private keys, tokens or kubeconfigs.
Screenshots, recorded video, docs and fixtures use independently created synthetic
resources only. No real environment is required for the release gate.

## Test Implementation Contract

The scaffold has [source lifecycle tests](../../src/entrypoints.test.ts),
[compiled-entry contracts](../../test/build.test.ts), and
[process-specific host stubs](../../test/freelens-extensions.ts). Vitest v4.1.11 fails
when no tests are selected; it does not import the host implementation in Node.
The canonical command builds first and covers 118 tests: 22 scaffold/consumer,
48 [environment checks](../../test/environment.test.ts) and 48 diagnostic contracts.
The environment tests
include child-process refusal checks with an empty executable path, proving that
wrong targets and malformed journals stop without external tools. Co-locate future pure/main
tests with their modules and reuse the integration directory convention for packaged
journeys. No actual Electron installation result is implied by stubbed bundle tests.

Eight tests exercise the actual Trunk tar dependency and the SDK's query-string
consumer before/after the authorized overrides. They use synthetic temporary archives
and URL strings, clean up their owned directories, and run in both normal and
production build checks. The ESM import repair is a reproducible pnpm consumer patch,
not a test alias that could conceal a runtime failure.

Mock the host boundary for unit tests; use a transport interface for Kubernetes
status codes and cancellation. Small local HTTP/TLS servers exercise streaming and
backpressure independently of kind. The real kind tier then verifies that mocks
match the pinned API, CRD schemas and controller artifacts. Do not use private host
imports to make an unsupported public call appear valid.

Each implementation slice starts with its focused failing/discriminating check and
ends with passing targeted tests. Wire new cases into the canonical command and
record exit code plus pass/fail/skip counts. A nonzero exit code is a failed gate,
even if some assertions passed. Do not defer regressions to the release stage.

Established T0.3 commands, executed locally:

- `pnpm type:check`, `pnpm lint:check`, `pnpm knip:check`, `pnpm test:unit`, and
  documentation checks using the established Trunk convention.
- `pnpm build && pnpm clean:tgz && pnpm pack`, without an incidental version bump.
- `VITE_PRESERVE_MODULES=false pnpm test:unit` checks the production bundle form;
  `pnpm exec vitest run src/entrypoints.test.ts` is the focused source check.

The [local runner](../../e2e/scripts/local-demo.mts) and
[image helper](../../e2e/scripts/local-images.mts) provide official-image setup and
live readiness/authentication/isolation/ownership checks. Real backup/restore and
status fixtures plus restricted identities and cleanup are implemented in
[local-fixtures.mts](../../e2e/scripts/local-fixtures.mts) and the runner. The T0.6
[download proof](../../e2e/scripts/local-download-proof.mts) exercises compiled main;
packaged-app launchers remain later work. Knip declares the existing
system `kubectl` as an external binary, not an npm dependency.
The [development audit](DEPENDENCY-AUDIT.md) records zero findings for the T0.3 graph,
not the newly expanded T0.6 graph. That dated result and the consumer tests do not
close actual-host acceptance. No new scanner or upstream remediation gate was added.

Build after tools that remove generated output. Before manual review, provide the
actual absolute tarball path and tested host version. Inspect the tarball's file
list for source-only docs, local evidence, credentials or unintended bundled host
dependencies. Packaging is not authorization to publish.

## T0.4 Attempt And Recovery Gate

Completed locally on 2026-09-24. Official release
artifacts only: kind 0.33.0, Kubernetes node 1.34.11, Velero 1.18.2, AWS plugin
1.14.2 and SeaweedFS 4.47. Node.js is 24.15.0 and kubectl remains 1.33.4.
Exact image references are in [local-manifests.mts](../../e2e/scripts/local-manifests.mts).
The retired rebuild/scanner commands and derived images were not used or deleted.

Private state is under `$HOME/.local/state/freelens-velero-dev`, with directory mode
0700 and credential/kubeconfig/journal/log files at 0600. It holds generated local
credentials, the immutable node/network identities, operation logs and the latest
generic result in `readiness.json`. CLI working directories and kubectl caches are
also private. The default kubeconfig is unchanged. An accidentally generated demo
discovery cache was verified as synthetic and moved out of the project, not deleted.

Run from the extension root, only for the explicitly approved local target:

```sh
node e2e/scripts/local-images.mts pull
node e2e/scripts/local-demo.mts cluster --context kind-freelens-velero-dev
node e2e/scripts/local-demo.mts storage --context kind-freelens-velero-dev
node e2e/scripts/local-demo.mts bucket --context kind-freelens-velero-dev
node e2e/scripts/local-demo.mts velero --context kind-freelens-velero-dev
node e2e/scripts/local-demo.mts verify --context kind-freelens-velero-dev
```

The official kind binary is installed privately at the journal directory's
`bin/kind`; its existing checksum-verified release is used without a global CLI
upgrade. No script of the repository installs it any more: the installer went with
the scripts that rebuilt third-party images, and the test environment for every
platform brings its own (see the [roadmap](ROADMAP.md)). Images are pulled on the host, not by workloads. Kind imports official
version tags whose Docker/CRI image IDs must equal those of the exact digest pins;
workloads use `imagePullPolicy: Never`. Missing or changed image content stops setup.

The `verify` command is a foundation check for a fixture-free installation. It
intentionally expects zero Backups, Restores, Schedules, DownloadRequests and
ServerStatusRequests; later fixture tests need their own lifecycle checks. Its
temporary ConfigMaps and local listener are removed on completion, including the
simulated interrupted-check path. Persistent demo infrastructure and the empty
bucket are retained for T0.5, not automatically torn down.

The node remains running with 4 CPU/8 GiB limits and Docker restart policy `no`.
To pause only this owned demo, use
`node e2e/scripts/local-demo.mts stop --context kind-freelens-velero-dev`.
This retains data and the initialized cluster. A stopped or changed node must be
revalidated before reuse; T0.5 adds the explicit guarded `start` command described
below. The runner never silently selects or recreates another cluster.
`remove-failed-node` refuses initialized or running nodes. Preserve
`kind-kind`, unrelated add-ons and the private ownership journal.

| Check | Exit / result | Evidence boundary |
| --- | --- | --- |
| Canonical `pnpm test:unit` | 0; 67 passed, 0 failed, 0 skipped | Build, source, consumer and 46 setup/guard tests |
| Type-check, touched-file Biome, both Knip modes | 0; pass | Repository lint exits 0 with one existing warning in the retired remediation script |
| `cluster` | 0; Ready, repeated successfully | Exact local node/network, current route check, verified TLS kubeconfig and official image content |
| `storage` and `velero` | 0; ready | Storage Deployment, Velero Deployment/node-agent, 13 unchanged CRD schemas, BSL Available |
| `bucket` | 0; four assertions pass | Signed list returns 200; anonymous, wrong-secret and out-of-scope bucket requests return 403 |
| `verify`: control ports | 0; pass | Master/filer/volume loopback listeners; native S3 gRPC rejected outside its pod; S3 HTTP remains reachable |
| `verify`: egress | 0; pass | Local listener positive control, then node/pod connection rejection with firewall counter increases; listener closed |
| `verify`: ownership/cleanup | 0; pass | Existing sentinel collision refused; owned reapply preserves UID; interrupted check deletes with UID preconditions; sentinel survives until its explicit cleanup |
| Real backup/restore, status fixtures, multipart and signed download | Not run | T0.5/T0.6, no substitute from BSL readiness |
| Actual Freelens/Playwright | Not run | Later packaged-app gate; no feature UI changed in T0.4 |

Configuration issues resolved in this extension's setup code, without upstream edits:

- The initial node needed a private `host.docker.internal` mapping on the internal
  network. Its failed predecessor was removed only with explicit permission.
- Docker does not publish the API port on this internal network. The official
  `kind get kubeconfig --internal` output is normalized from container hostname to
  the exact journal-owned node IP. CA/client certificates remain unchanged and TLS
  is verified. No default or remote kubeconfig fallback is permitted.
- The node has no default route; an explicit service-CIDR route enables kube-proxy
  Service translation while outside traffic stays rejected. CoreDNS is cluster-only.
- Docker archive import did not preserve digest names. Loading verified official
  tags and comparing image config IDs fixes offline `ErrImageNeverPull` without
  enabling workload downloads or selecting derived images.
- The official installer needs a kubeconfig even in dry-run mode. It receives only
  the verified private config read-only, with an explicit context and no network.
- Official SeaweedFS always starts S3 gRPC 18333. Node OUTPUT/FORWARD rules isolate
  that port outside the pod; no upstream code was changed to remove the listener.

No cloud account, real cluster, external endpoint probe, vulnerability scan or
third-party source build was used for these checks. This is infrastructure readiness
evidence, not proof of backup recovery, full S3 compatibility or product completion.
Overall T0.4 verdict: **PASS**. T0.5 was subsequently authorized and verified below.

## T0.5 Fixture Verification

Completed on 2026-09-25 using the existing official-image laboratory. The node had
been stopped; the new `start` action verified its journal ID, network, kubeconfig
hash and current routes before resuming it. Authenticated local API liveness and
isolation were rechecked. No node was recreated and no initialized cluster deleted.

Run from the extension root, only for the approved local target:

```sh
node e2e/scripts/local-demo.mts start --context kind-freelens-velero-dev
node e2e/scripts/local-demo.mts fixtures --context kind-freelens-velero-dev
```

The first command also revalidates an already running owned node. The second starts
a fresh fixture run only when the previous run is cleaned, and performs:

1. Base creation and ordinary merge patches for isolated synthetic states, checking
  installed enums and exact status readback without any `/status` request.
2. Real Backup and Restore of labelled ConfigMaps, with an explicit source namespace,
  separate pre-created destination, no cluster resources/PV snapshots and restore
  policy `none`. Hashes of all restored binary payloads and the small map contents
  must match. No controller status is forced for the live operations.
3. Multipart verification from archive HEAD metadata and bounded reads of four gzip
  log/results objects. The harness cannot GET the backup archive. Restores themselves
  naturally consume stored data inside Velero; no archive is exported to the user.
4. A temporary ServiceAccount credential for real allowed/denied API operations,
  with no fallback to the privileged kubeconfig after a denial.
5. Cleanup in `finally`, followed by the fixture-free environment verifier. Real
  backup deletion uses DeleteBackupRequest; associated Restore/files are removed
  by the official controller. Namespace inventories must contain only run-owned
  resources plus standard default ServiceAccount/root-CA objects before deletion
  with a UID precondition.

The static namespace is outside both configured controller namespaces. The main
matrix contains 29 objects: 13 Backup phases, 10 Restore phases, three Schedule
cases (enabled, paused, invalid), two BSL cases (Available/ReadOnly and Unavailable)
and one VSL with unreported health. A further Backup has a missing BSL reference,
for 30 labelled synthetic domain objects. They cover incomplete progress, missing
timestamps, validation errors and 100% item counts while still Finalizing. Their
UIDs, resourceVersions and statuses remain unchanged across live controller work
and permission checks. PartiallyFailed/FailedValidation presentations are synthetic,
not claimed as induced live failure outcomes. Unknown future enum values remain
mock-only cases; the real schemas were not relaxed.

The restricted identity allows namespaced Backup reads. The seven actual API
denials cover cluster-wide Backups, CRD listing, installation credential Secret,
same-namespace certificate fixture Secret, one-kind VSL listing, Backup creation
and DownloadRequest creation. The last request is forbidden and creates no object;
it does not perform the T0.6 request protocol. The private token kubeconfig is
removed, and namespace cleanup removes its ServiceAccount/Role/RoleBinding.

| Check | Exit / result | Evidence and boundary |
| --- | --- | --- |
| `pnpm test:unit` | 0; 73 passed, 0 failed, 0 skipped | Includes 52 setup/fixture tests; no hidden second unit runner |
| Type-check, touched-file Biome, both Knip modes | 0; pass | One pre-existing repository-lint warning remains in the disabled remediation script |
| Full `fixtures` command | 0; pass | Repeated complete run, including cleanup and environment revalidation |
| Live Backup/Restore | Completed, no reported errors | 13 ConfigMaps; 9,437,184 binary payload bytes plus a small text map match |
| Multipart object | 4 parts in the last run | 18,967,925 stored bytes from HEAD metadata; default plugin checksum behavior unchanged |
| Diagnostic fixtures | 4 gzip artifacts retrieved | Backup/Restore logs and results; JSON results parse; max 16 MiB transferred and 4 MiB decoded per artifact |
| Static fixtures | 30 domain objects unchanged | Ordinary status patches, schema readback and post-controller UID/resourceVersion/status comparison |
| Restricted credential | 1 allowed read, 7 forbidden operations | Real server authorization responses; no privileged retry |
| Cleanup | Pass | Real Backup/Restore/deletion request gone, five expected object keys return 404, three fixture namespaces gone |
| Retained environment | Pass | Official image identities, BSL Available, authentication, egress/control ports and sentinel cleanup revalidated |

Generated names and payloads vary by run, so stored archive size can vary. The test
requires data integrity and multipart evidence rather than this exact byte count.
Canonical fixture shapes live in [the typed factories](../../e2e/scripts/local-fixtures.mts);
no payload, token or cluster capture is committed to the project.

Private state under `$HOME/.local/state/freelens-velero-dev` records the active run
in `ownership.json`, per-run evidence in `fixture-runs/<run>.json`, and synthetic
diagnostic captures in `fixture-artifacts/<run>/`. Directories are private and
files use mode 0600. Reports are retained outside repository/package contents.
The runner refuses an unfinished prior run; the explicit `fixtures-cleanup` action
can retry only its journal-bound cleanup. It refuses active backups or unrelated
namespace resources rather than force deletion. Do not discard the journal to
bypass a failure. No fixture is intentionally retained after successful tests.

The artifact paths follow the pinned
[official object-store layout](https://github.com/velero-io/velero/blob/c253c7fe37d78c9b7e55c68544f7c5b2608712d8/pkg/persistence/object_store_layout.go):
restore log/results filenames have an additional `restore-` prefix. Fixture-only
SigV4 requests use generated local credentials and explicit local Service routing.
They are not a renderer/main implementation and do not authorize the extension to
read storage credentials when consuming server-signed URLs.

This step does not prove PV/CSI data recovery, live scheduling/adherence, every
failure phase, UI integration or main-process download/TLS/cancellation behavior.
No external account, real cluster, upstream patch/rebuild, vulnerability scanner,
DownloadRequest execution or ServerStatusRequest was used. Overall T0.5 verdict:
**PASS**. T0.6 was subsequently authorized and verified below.

## T0.6 Main Transport Proof

Authorized and completed on 2026-09-25 against the existing official-image local
lab. The implementation is main-only and activation stays inert. The runner loads
the actual compiled CommonJS main under Node with minimal host globals; this is
not an actual Electron/IPC/catalog integration result.

```sh
pnpm test:unit
VITE_PRESERVE_MODULES=false pnpm test:unit
node e2e/scripts/local-demo.mts transport-proof --context kind-freelens-velero-dev
```

The direct worker requires the unmodified official image
`docker.io/library/node:24.15.0-bookworm-slim@sha256:4e6b70dd6cbfc88c8157ba19aa3d9f9cce6ba4703576d55459e45efcbc9c5f5d`,
verified locally before use. Pulling this public artifact does not authorize a
cloud environment. The guarded runner checks its content and the owned node before
starting a short-lived, capability-free, read-only-mounted container in that node's
network namespace. It creates no relay Pod, host route or derived image. Existing
node egress controls stay active and `--rm` plus owned fallback cleanup remove it.

The command creates fresh T0.5 Backup/Restore inputs, then runs four real downloads
in each mode. All retain the cluster-internal signed hostname and unchanged BSL
publicUrl. The downloader never reads object-store credentials.

| Mode | Real artifacts | Additional real checks |
| --- | --- | --- |
| HTTP through explicit Pod tunnel | BackupLog, BackupResults, RestoreLog, RestoreResults | Altered signature and Host rejected by storage; HTTP is explicitly permitted for this local fixture |
| HTTPS tunnel, inline CA | Same four | Altered signature and missing private CA rejected |
| HTTPS tunnel, referenced CA | Same four | Named same-namespace certificate Secret/key, altered signature and missing CA rejection |
| Direct HTTPS, referenced CA | Same four | Same signing/TLS checks from the isolated official Node worker |

Every mode also verifies in-flight request-ID deduplication, a real create-only
409 with the original UID unchanged, and a generated-name ServerStatusRequest
that reaches Processed with a version. Each result contains content/request identity,
never its signed URL. Nonempty payloads and JSON result parsing are checked; these
four artifact kinds do not qualify resource-list or volume-info formats.

| Check | Exit / result | Evidence boundary |
| --- | --- | --- |
| Canonical normal and compact production suite | 0; 118 passed in each mode, 0 failed/skipped | 21 scaffold/consumer, 52 setup/fixture and 45 diagnostic checks |
| Transport contracts | 20 passed | Raw encoded path/query and Host, SNI/CA, TLS rejection, redirects/metadata/private policy, 404, invalid gzip, compressed/decoded limits, deadlines and active socket cancellation |
| Kubernetes adapter contracts | 7 passed | Explicit config/context, POST/generateName, 409, malformed/lost response, same-namespace CA only, target mismatch and cancellation of actual API I/O |
| Service contracts | 11 passed | Write/confirmation/sender binding, duplicate/replay, global concurrency, target invalidation, New/Processed/Failed, expiry/deadline, ambiguous submission and sanitized cleanup errors |
| Tunnel contracts | 7 passed | Source/compiled forwarding, identity/port refusal, listener/handshake/pod-lookup cancellation and closed sockets/listener |
| Full local `transport-proof` | 0; 16 real artifact downloads | Actual controller-created signed URLs; four modes above; no external target |
| Cleanup and restored environment | 0; pass | Original storage Deployment/Service/BSL restored, BSL Available, owned requests/Secrets/certificates/container removed, controller cleans Backup/Restore/artifacts and three namespaces |
| Final type/build, Biome, both Knip modes and Trunk | 0; pass | Trunk checks 23 files; repository lint retains one existing warning in the disabled remediation script |
| Archive and private-data checks | 0; pass | 2,037 allowlisted files, 980 relative source maps, isolated main/renderer load and packaged startup cancellation; no generated credentials in 58 project candidates or the package, no signed URLs in proof output |
| Actual Freelens installation/IPC | Not run | FND-10 remains open; compiled Node stubs are not an Electron result |

The final local archive is `freelensapp-velero-extension-0.1.0-alpha.0.tgz`,
2,040,093 bytes, with unchanged version, private publication flag and exact host/SDK
1.10.3. SHA-256: `efbe94bb10a988eafb973f3284b9699884da74a777a211a7343751bc00dca4f2`.
The extraction was checked outside the workspace with every non-builtin module
required to resolve inside that extraction, then removed. Bundled main libraries
are included; host SDK implementation, tests, credentials and absolute source-map
paths are excluded. This supersedes the historical scaffold archive, not the
unverified actual-host gate. Editor diagnostics report no errors in the touched code.

The service defaults to 250 ms polling, 30 seconds for URL availability, 120 seconds
overall including queued work, and two global operations. Download bounds are
10-second connect/TLS, 15-second idle, 16 MiB compressed and 64 MiB decoded. Tests
shrink these budgets; they cannot increase them. Cancellation does not delete a
Kubernetes request in product code. Local fixture cleanup has separate authorization.

The startup-cancellation regression covers abort after Pod lookup but before the
listener's `listening` event. Without an abortable event wait that promise remained
pending even after the listener closed. The fixed source and canonical bundle tests
pass. Empty Kubernetes error-channel initialization is allowed; actual error data
closes the tunnel. The pinned distributed WebSocket handler and supported native-
accelerator build switches require no upstream modification.

The proof adapter supports explicit client certificates/tokens only. Exec/auth-provider
plugins, proxy configurations and insecure TLS are refused, not silently retried.
Production catalog/sender wiring, DNS/destination resolution and automatic
Service/Pod selection remain P1/P2 integration work. Direct routes require a trusted
main-supplied numeric address; the proof does not implement public DNS resolution.
Release New/Processed and future Failed are contract-tested without changing the
pinned schemas. Expired status/404/timeout/size failures are synthetic contract
cases, not a claim that all were induced in the live store. No PV/CSI recovery,
real cloud, upstream rebuild or vulnerability scan was performed.

Private state remains under `$HOME/.local/state/freelens-velero-dev`. The data-free
`transport-proof.json` starts as running and becomes pass only after cleanup and
the fixture-free environment verifier succeed. `transport-requests.json` contains
request identities only. Signed URLs are never recorded; request-list cleanup uses
metadata-only output and suppresses DELETE bodies. Temporary CA/key files and
mounted direct-worker inputs are removed; retained reports are private mode 0600.
The default kubeconfig and original official image contents remain unchanged.

The [transport support decision](ARCHITECTURE.md#t06-transport-support-decision)
retains both authorized direct access and explicit Pod forwarding. Automatic
endpoint resolution and actual-host authentication still need qualification, not
an implicit fallback. Overall T0.6 verdict: **PASS**. The actual-host acceptance
check stays open until the integration test covers it.

## Capability Failures

| Missing capability | Work still possible | Required gap / next action |
| --- | --- | --- |
| Local Docker/kind | Unit/component and loopback contracts; packaged tests only where no cluster is required | Real-controller and cluster UI scenarios blocked; repair locally, never use a remote cluster |
| Node/toolchain | Documentation/source review and existing local infrastructure checks within scope | Build and UI tests blocked; select/install the approved toolchain in its step |
| Electron/Playwright/display | Unit, contracts, and local kind integration | Packaged UI and visual evidence blocked; no jsdom substitute for acceptance |
| Required image/download unavailable | Already available local tiers | Record exact missing pin; do not silently change versions or weaken the gate |

Do not discard a working tier because an independent prerequisite failed. A fallback
is partial evidence, never a full release pass. External writes are never a
fallback. Authorized external reads, if ever separately requested, must
obey the private-data isolation rules and are not necessary for these milestones.

## Pre-Review And Completion

At every milestone, exercise both themes at 900x650 and 1440x900, keyboard workflows,
200% zoom, long labels, empty/error/stale states and every reference link. Check
nonblank custom views, focus restoration, clipping, unstable layout, console errors,
and direct-delete paths. Measure responsiveness with a synthetic 1,000-object list:
at most 100 mounted data rows and p95 filter/selection response below 250 ms across
20 warm interactions on the recorded local environment. These are proposed budgets,
not measurements; investigate failures instead of reducing dataset size silently.

Evidence per run includes spec/requirement IDs, exact revision/version pins, command,
exit code, counts, artifact checksum, fixture mode, cleanup status, blockers and
unverified cases. Record only synthetic or generic data-free evidence. Keep large
logs/screenshots local outside the package; publishable extracts require a privacy
review. A pre-review inspection result must graduate into regression tests where
the behavior is automatable.

Spec lifecycle: Draft, Approved, Implemented, Verified (see [PROCESS.md](PROCESS.md)).
Approval of a design is not a successful test, and completion of this document is
not application verification. Record role/date/verdict without personal names.
Resolve blocking findings before reusing the affected patterns in the next milestone.
