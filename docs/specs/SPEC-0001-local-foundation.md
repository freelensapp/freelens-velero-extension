# SPEC-0001: Local Foundation And Contract Proof

- **Status:** Approved
- **Date:** 2026-09-18
- **Milestone / tasks:** Foundation / T0.3, T0.4, T0.5, T0.6
- **Reviewed Velero:** v1.18.2, `c253c7fe37d78c9b7e55c68544f7c5b2608712d8`
- **Reviewed main:** `60163e0827e72658bb6546165a727300170e628b`
- **Freelens validation target:** v1.10.3, `3da74415bff57a77c6e08cb5f538191ce87bac17`
- **Dependencies:** [versioned recon](../development/RECON-T0.1.md)
- **Approval:** Foundation contract approved by the lead maintainer on 2026-09-18; T0.3/T0.4 complete; T0.5 and T0.6 completed on 2026-09-25
- **Backend revision:** Official SeaweedFS 4.47 accepted; upstream repairs/custom images retired on 2026-09-18; T0.4 setup verified on 2026-09-24

## Goal

Provide a repeatable local build, installable extension and isolated test environment
that can prove the dangerous API/transport contracts before feature implementation.

## Scope Baseline

The source audit identified 13 Velero CRDs and a two-process extension architecture.
This slice covers four foundation tasks: scaffold, local environment, fixtures,
and main-process request/download proof. All 13 schemas are installed unchanged for
validation; static phase fixtures initially cover Backup and Restore plus primary
storage/schedule states. Secondary-kind UI remains in P5.

Included: extension entry points and tooling, public-host compatibility, fixture
ownership, scoped credentials, diagnostics proof and packaged activation. Excluded:
feature pages, full diagnostic viewers, operator actions UI, adherence logic,
publication and any real-environment access. See the [roadmap](../development/ROADMAP.md).

## User Scenarios

1. **P1, reproducible development:** Given the selected local toolchain and lockfile,
   when the build and non-version-bumping pack commands run, then the resulting
   tarball installs and activates in the pinned host without bundled host runtimes.
2. **P1, safe local testing:** Given an explicit local kind target with tracked
   fixture ownership, when setup and cleanup run, then only owned fixtures change;
   a different or unverifiable target is rejected before Kubernetes access.
3. **P1, diagnostic proof:** Given synthetic local backup artifacts and an explicitly
   confirmed request, when the main adapter creates and polls a DownloadRequest,
   then it displays bounded content or a classified error without exposing its URL.
4. **P2, repeatability:** Given a kept demo environment, when another run uses new
   fixture identities, then stale objects are neither overwritten nor treated as
   evidence for the new run, and cleanup preserves unrelated resources.

## Requirements

| ID | Contract | Acceptance check |
| --- | --- | --- |
| REQ-001 | Scaffold only this extension with separate main/renderer entry points, host-provided runtimes, MIT project metadata and no example feature | FND-01 |
| REQ-002 | Establish the canonical type/lint/unit/build/pack gates with locked dependencies and an actual passing entry/contract smoke test; pack must not change version | FND-02 |
| REQ-003 | All test infrastructure is a disposable kind cluster created by the scripts; reject a missing, remote, ambiguous or wrong kind target before Kubernetes access, without changing user contexts | FND-03 |
| REQ-004 | Track fixture ownership, refuse pre-existing collisions, and clean up only owned resources; never delete a cluster automatically or disturb persistent add-ons | FND-04 |
| REQ-005 | Apply the pinned schemas unchanged and read back every declared Backup/Restore phase via ordinary objects, not a status subresource; isolate fixtures from active reconciliation | FND-05 |
| REQ-006 | Produce a real local completed backup and restore with independently authored synthetic data and retrievable artifacts; label forced outcomes separately | FND-06 |
| REQ-007 | Provide isolated local permission cases for namespace-only discovery, forbidden list/create and certificate access, with no privileged fallback | FND-07 |
| REQ-008 | Prove a main-owned create-only request adapter, generated-name behavior, collision refusal, request deduplication, target binding, ambiguous-submission handling and I/O cancellation | FND-08 |
| REQ-009 | Prove bounded direct and forwarded local artifact fetches with URL/failure/timeout exits, missing artifact, TLS/CA-reference behavior, preserved signing and denied unsafe destinations | FND-09 |
| REQ-010 | Install the actual tarball through an isolated pinned Freelens integration harness and verify activation/shutdown without editing the shared host repository | FND-10 |
| REQ-011 | Keep all credentials/private captures outside repositories; package and publishable evidence contain only authored code, public facts and synthetic data, never signed URLs or secrets | FND-11 |
| REQ-012 | Provide reproducible demo/pre-review procedures and per-task evidence with exit code, counts, versions, cleanup and gaps | FND-12 |

## Design

Use [ARCHITECTURE.md](../development/ARCHITECTURE.md) for the selected create-only
client and diagnostic boundaries. The proof lives behind the same validated main
contracts later used by the product, not a renderer fetch or private host import.
No request is issued on activation and no proof bypasses write confirmation.

T0.3 supplies the build and host-test stubs. T0.4 establishes the explicitly selected
local kind/S3 environment and image pins. The [SeaweedFS selection](../development/LOCAL-STORAGE.md)
was accepted; official artifact identity, bootstrap and readiness are verified for T0.4.
The [latest scope directive](../../AGENTS.md#official-artifacts-and-scope) forbids
upstream source repairs, derived images and autonomous infrastructure scan gates.
T0.5 supplies verified fixture factories and restricted local credentials.
T0.6 implements and exercises the compiled-main request/transport proof under Node.
The main modules remain inert on host activation and are not registered over IPC.
The proof uses explicit certificate/token kubeconfigs and main-authorized routes;
catalog/sender integration, authentication plugins and automatic endpoint resolution
remain unverified. See the [transport support decision](../development/ARCHITECTURE.md#t06-transport-support-decision).
Approval of
this spec does not combine those tasks into one execution authorization.

Use the [test strategy](../development/TESTING.md) for fixture structure and ownership.
Keep live outcomes and synthetic phase objects separate. Known invalid future enum
cases belong in mocks. The read-only extension UX is not required in this foundation
slice; its package must nevertheless install and activate without errors or writes.

The early download proof must cover both release New/Processed and newer Failed
responses through a contract server. Do not install unpinned main CRDs to manufacture
the newer response in the release environment. Direct/forwarded success needs real
local authenticated S3; mocks alone cannot prove the signature is preserved.

## Tests

Current scaffold tests: [source lifecycle](../../src/entrypoints.test.ts),
[compiled bundle contracts](../../test/build.test.ts), and
[guarded host stubs](../../test/freelens-extensions.ts). The
[setup/fixture tests](../../test/environment.test.ts) and
[local runner](../../e2e/scripts/local-demo.mts) cover the implemented T0.4/T0.5
boundaries. Main contracts are co-located with the
[transport](../../src/main/diagnostic-transport.test.ts),
[adapter](../../src/main/diagnostic-kubernetes.test.ts),
[service](../../src/main/diagnostic-service.test.ts) and
[tunnel](../../src/main/diagnostic-tunnel.test.ts).
The [compiled proof](../../e2e/scripts/local-download-proof.mts) adds local
controller/storage evidence; packaged-app helpers remain later work.

| Check | Layer | Requirements | Scenario and expected evidence |
| --- | --- | --- | --- |
| FND-01 | Build/package | REQ-001 | Inspect main/renderer outputs and package file list; host dependencies stay external and no example screens remain |
| FND-02 | Local commands | REQ-002 | Run every canonical gate, compare package version before/after pack, record real test counts |
| FND-03 | Unit/local guard | REQ-003 | Synthetic wrong identities stop before client creation; selected local kind identity is verified privately before fixture setup |
| FND-04 | Local integration | REQ-004 | An unrelated sentinel fixture survives; pre-existing names refuse overwrite; a failed run still removes only owned objects |
| FND-05 | Schema/local integration | REQ-005 | Read back 13 Backup and 10 Restore phases unchanged after the controller-isolation check; no status endpoint request occurs |
| FND-06 | Live controller | REQ-006 | Backup and restore synthetic resources into an isolated destination, verify expected objects/data and fetch produced artifacts |
| FND-07 | Restricted local identity | REQ-007 | Denied and namespace-limited operations preserve the exact capability/error state without escalating credentials |
| FND-08 | Unit/local integration | REQ-008 | POST only, generated names and 409; duplicate request ID; simulated lost response; wrong context, recreated UID and cancellation |
| FND-09 | Loopback/live local S3 | REQ-009 | Direct/tunneled success, rejected wrong Host/signature/expiry, both CA modes, bad TLS, 404, Failed, endless New, redirect/metadata denial, excessive gzip and cancelled sockets |
| FND-10 | Packaged app | REQ-010 | Install exact tarball, activate/deactivate and inspect main/renderer console results in an isolated app profile |
| FND-11 | Sentinel/package checks | REQ-011 | Synthetic secret/URL sentinels never appear in IPC errors/logs or the packed file list; no real dataset is used |
| FND-12 | Procedure review | REQ-012 | Repeat documented setup/run/cleanup; report commands, exit codes, counts and unexecuted checks without overstating coverage |

## Success Criteria

All 12 acceptance checks pass before the foundation is Verified. Each
numbered task reports only its subset of results; an installable package alone does
not close the environment or transport checks. A wrong target must cause zero
Kubernetes calls. Cleanup leaves unrelated sentinel resources intact. A successful
transport proof includes a real signature-verified local download and no retained
socket or unbounded timer after cancellation.

Manual review, after automated checks: install the supplied tarball in the pinned
host and confirm enable/disable works without error. Expected result: no feature
page or cluster request appears merely from activation. Record role/date/verdict.

## Assumptions And Decisions

- Use the dedicated local kind test environment; its first bootstrap failed and
  its node was later removed with explicit permission. Official-image recreation,
  server/node-agent/storage readiness and isolation passed on 2026-09-24.
  Existing kind-kind is preserved.
- Use the reviewed Velero/plugin versions. Record Kubernetes/storage image digests
  in T0.4 from verified public distributions; actual compatibility needs runtime proof.
- The [accepted storage selection](../development/LOCAL-STORAGE.md) requires an
  authenticated, isolated SeaweedFS service with telemetry disabled, using no cloud
  accounts. It does not reduce the original fixture, signature or safety requirements.
- Core domain/UI remains unimplemented until the environment and proof gates are
  met. No external target is needed or requested.

## Evidence And Deviations

Approved against the public-source recon and development directives on 2026-09-18.
The lead maintainer approved the final scoped dependency changes on 2026-09-18. T0.3 is
complete: scaffold, [dependency remediation](../development/DEPENDENCY-AUDIT.md) and
refreshed archive checks passed. SDK and host declaration are exactly 1.10.3; Node
is 24.15.0 and pnpm is 10.34.4. T0.4 resumed on 2026-09-24 under the
official-artifacts-only directive. T0.4 is complete: 46 setup/guard tests and live
readiness, authentication, isolation and interrupted-check cleanup pass. The API
uses the exact owned internal node IP with verified TLS; default kubeconfig is
unchanged. No custom image, upstream repair or scanner was used in this iteration.
T0.5 followed on 2026-09-25. That step is complete: real Backup and
Restore reached Completed with 13 ConfigMaps and 9 MiB of matching payload; multipart
metadata and four gzip artifacts passed. Thirty synthetic objects retained their
statuses outside the controllers' namespace, including all 13 Backup/10 Restore
phases and primary storage/schedule cases. A namespace-only identity passed one
read and was denied seven operations. Controller-mediated backup deletion and
UID-bound namespace cleanup removed the test run.
T0.6 followed on the same day. That task is complete:
the compiled main retrieved 16 real log/results artifacts over direct HTTPS and
HTTP/HTTPS pod tunnels. Inline/referenced CA, real signature/Host negatives,
generated ServerStatusRequest names/version and 409 preservation pass. Owned TLS,
request and fixture cleanup restores the original environment. The 118 normal and
production tests cover the remaining local failure, binding and cancellation cases.

| Evidence | Result |
| --- | --- |
| Type-check and normal/production CommonJS build | Pass |
| Canonical source, compiled-contract and consumer tests | 118 passed, 0 failed, 0 skipped with Vitest 4.1.11 in both normal and production modes |
| Biome, Knip development/production, Trunk | Pass |
| T0.3 lockfile reproducibility | Reinstallation preserved the then-current hash, scoped resolutions and active consumer patch; T0.6 legitimately adds three exact dependency pins |
| Historical T0.3 CVE assessments | Zero findings for the then-audited coordinates, patched consumers and full resolved graph; exit 0, no waiver; not a current T0.6 graph assessment |
| Decoder module compatibility | Actual query-string import/parse also passes on Node 22.12.0, the declared minimum |
| T0.3 package contents and version stability | Historical pass: 9 files, unchanged 0.1.0-alpha.0 and exact host/SDK 1.10.3; T0.6 additionally bundles its main runtime libraries |
| Current setup/fixture and diagnostic checks | 52 environment/fixture and 45 diagnostic tests plus 21 scaffold/consumer tests; type-check, build, touched-file Biome and both Knip modes pass; repository lint exits 0 with one pre-existing warning in the retired script |
| T0.4 pinned CLI and private hosts mapping probes | Pass in no-network containers; not full kind bootstrap or service proof |
| T0.4 environment | Pass: dedicated kind, 13 CRDs, server/node-agent, storage and BSL Available; [runtime evidence](../development/TESTING.md#t04-attempt-and-recovery-gate) |
| T0.4 authentication, isolation and ownership | Pass: valid access; three denied access cases; control-port and node/pod egress rejection; collision refusal and UID-bound cleanup after a simulated interruption; no temporary ConfigMaps remain |
| T0.5 ConfigMap recovery | Pass: Completed Backup/Restore, 13 ConfigMaps, 9,437,184 payload bytes compared by hash; four-part multipart metadata and four retrieved log/results artifacts |
| T0.5 schema/isolation and permissions | Pass: ordinary resource patches, exact status readback, 30 synthetic objects unchanged, namespace-limited read and seven actual API denials without fallback |
| T0.5 cleanup | Pass: DeleteBackupRequest, associated Restore and expected stored artifacts removed; three owned namespaces and temporary credential removed; retained environment revalidated |
| T0.6 API lifecycle | Pass: main-only POST, actual generated names/409, deduplication; synthetic ambiguity, malformed response, wrong target, cancellation and confirmation checks |
| T0.6 main signed transport | Pass: 16 real log/results downloads, direct HTTPS and HTTP/HTTPS tunnels, preserved signing, both CA sources; synthetic expiry/Failed/404/deadline/size/cancellation cases |
| T0.6 cleanup | Pass: original storage configuration restored, owned requests/Secrets/certificate files/direct container removed, controller fixture deletion and fixture-free environment verifier pass |
| Real Freelens installation and PV/CSI recovery | Not run; FND-10 actual-host acceptance remains open; no volume-recovery claim |

The historical T0.3 scaffold archive was 3,295 bytes. SHA-256:
`1ed8bc332e6e439b11a05ba7f50455323942d8aad75209c143f00d55ef2cb39f`.
That is not the current T0.6 artifact or hash. The current package adds bundled
Kubernetes/WebSocket runtime code, but still contains no feature UI and is not a
release candidate. [Current package/proof evidence](../development/TESTING.md#t06-main-transport-proof)
does not prove actual-host activation.

T0.3 verifies FND-01/FND-02 and the current package-content portion of FND-11.
T0.4 adds the environment portion of FND-03 and a live ConfigMap ownership/cleanup
case for FND-04. T0.5 exercises FND-05/FND-06/FND-07 with schema-valid states,
ConfigMap recovery/artifacts and a temporary restricted identity; it also extends
FND-04/FND-12 with a repeatable fully cleaned fixture run. See
[the detailed evidence and limits](../development/TESTING.md#t05-fixture-verification).
T0.6 closes the scoped FND-08/FND-09 main proof and extends FND-11/FND-12 with
URL-free evidence, bounded transport, cleanup and an explicit support decision.
The T0.5 credentialed fixture client was not substituted for this main service.
Only four of the eight allowed artifact formats have real content evidence; later
viewer work must qualify the others. API exec/auth-provider plugins, proxies,
production IPC/catalog binding and automatic DNS/Service resolution are not yet
supported by this proof. No TLS bypass or fallback was added to hide those limits.

T0.6 is complete, but FND-10 and actual-host privacy/lifecycle evidence remain open.
PV/CSI recovery is not claimed. This spec stays Approved, not Implemented or
Verified, until its full acceptance and manual-review requirements are met.

Deviation, approved by the lead maintainer on 2026-09-27: the wording of REQ-001,
REQ-003 and REQ-012 follows the [process](../development/PROCESS.md) of the
organization. The test infrastructure is a disposable kind cluster created by the
scripts, on a developer machine or on a CI runner; the review gate is at the end of
a milestone, not after each task; publication goes through the release workflow.
The acceptance checks are unchanged.

Evidence added on 2026-09-27, for FND-09 and FND-10:

- The forwarded fetch lost the end of a stream larger than the socket buffers when
  the pod side closed first, and did not hold the pod side back for frames under
  64 KiB. The transport reported it as an invalid artifact, never as content. The
  T0.6 artifacts were small enough to pass. The relay now delivers what the pod
  sent and bounds what waits for the local socket; three tunnel tests cover it,
  on the source and on the compiled main, and fail on the previous relay.
- Loading the main bundle installed the dispatcher of the bundled undici for the
  whole process. A build test now loads the compiled main in a process of its own
  and finds the dispatcher untouched.
- The packed production build was installed by hand in a packaged Freelens v1.10.3
  with an isolated profile: enabled, both entry points loaded by the host and
  loaded again after a restart, dispatcher untouched. FND-10 stays open until the
  integration test does it in CI.
