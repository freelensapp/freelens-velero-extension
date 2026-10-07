# Local S3 Test Backend

Reviewed: 2026-09-18

Status: official SeaweedFS 4.47 accepted for T0.4. The latest directive on 2026-09-18
permits official repositories and release artifacts only; custom rebuilds and
upstream repairs are retired. T0.4 installation, authentication and isolation were
verified on 2026-09-24. T0.5 ConfigMap backup/restore, multipart integrity and
artifact/cleanup checks passed on 2026-09-25. T0.6 signed-download compatibility
passed on the same day for the four log/results artifact kinds and explicit routes.
Actual Freelens activation, all S3 features and PV/CSI recovery remain unverified.
The environment pins SeaweedFS 4.48 since 2026-10-04, in
[local-manifests.mts](../../e2e/scripts/local-manifests.mts): the distribution
reviewed below is 4.47. On 2026-10-06 the store of 4.48 took a body in each of the
three ways the client of the fixtures sends one, and held its whole length.

## Purpose And Scope

Provide an authenticated S3 service inside the dedicated local kind environment for
Velero backups and artifact downloads. The test backend is not a runtime dependency
of the extension and does not constrain an operator's existing storage provider.
Freelens and SDK compatibility remain exactly v1.10.3. Velero v1.18.2 and AWS plugin
v1.14.2 remain the reviewed test pair; provider `aws` means use the S3 plugin, not
permission to contact an AWS account.

The lead maintainer accepted the backend choice and T0.4 resumed on 2026-09-24. T0.4
is complete; T0.5 and T0.6 were completed on 2026-09-25. The proof does not authorize
external access.
The source-only review did not run images. The subsequent setup attempt retrieved
the four pinned images and checked their CLI contracts without network access, but
kind bootstrap initially failed. The later resumed setup installed the official
server/plugin/storage and passed the scoped readiness checks without image rebuilding.

## Reviewed Distribution

| Item | Proposed pin / evidence |
| --- | --- |
| Release | [4.47](https://github.com/seaweedfs/seaweedfs/releases/tag/4.47), published 2026-09-14; not marked prerelease |
| Source commit | `c5073360007d28385a33426a42ac3e4ec504c5a3` |
| License | Apache-2.0, checked in the public repository metadata |
| Official image reference | `docker.io/chrislusf/seaweedfs:4.47` |
| Image index digest | `sha256:ce9e796f1fe6f06968f4c04bdaf8f678dad9c8acdfef3d244133d71bfa6bf882` |
| Linux amd64 manifest | `sha256:f83509b0721dfd8e2e07faf76c0a899f67a8a889c89abe2fa0a5227ba1320362` |
| Other observed image platforms | Linux arm64, arm and 386; not executed in this review |

The public registry returned the versioned image and platform descriptors. Use the
digest, not a floating latest tag, and verify the retrieved image at setup time.
Repository activity and releases establish maintenance at the review date, not an
absence of vulnerabilities. Historical findings remain in [the image audit](DEPENDENCY-AUDIT.md#t04-container-image-findings).
They are not a current autonomous remediation or zero-CVE setup gate. Report concrete
upstream compatibility/safety blockers and official options without patching third-party
code. Actual readiness still requires runtime proof. Do not place third-party source, binaries or images in the extension
package; preserve applicable notices for any separately used artifact.

## Local Shape

Use one pod/process running `weed server -s3` with its master, volume and filer
components, a dedicated data volume, and only its authenticated S3 endpoint exposed
through a ClusterIP Service. No storage operator or external metadata database is
needed for this single-node lab. This is a test topology, not a production or HA
recommendation.

The [pinned server command](https://github.com/seaweedfs/seaweedfs/blob/c5073360007d28385a33426a42ac3e4ec504c5a3/weed/command/server.go)
allows explicit component selection and a separate S3 bind address. Configure the
deployment deliberately instead of inheriting the image's quick-start defaults:

- Set `-master.telemetry=false` before the first start. The reviewed source defaults
  telemetry to enabled. Do not configure metrics push, cloud tiering, remote mounts,
  identity federation, external KMS or notification endpoints.
- Keep master/filer/volume control ports on pod loopback. The official S3 command
  also binds gRPC 18333 alongside HTTP 8333; owned-node firewall rules reject 18333
  from outside the pod. Only S3 HTTP is reachable through the Service. Do not use
  host networking, public NodePort/Ingress or external load
  balancers. Access from the desktop is through an owned loopback port-forward.
- Disable unused SFTP, WebDAV, messaging and IAM control-plane services; disable
  Iceberg/Lance catalog ports explicitly. No administration UI is needed. Fix volume
  size/count, memory/CPU and storage limits instead of unbounded auto-sizing.
- Require a generated test identity from a private mounted configuration at startup.
  The documented S3 default without identities permits anonymous access and is not
  acceptable, even for the signature test lab. Use only the demo bucket permissions
  after bootstrap and keep administrative credentials separate from Velero's identity.
- Keep all credential files, logs and local state outside repository worktrees.
  Never inherit personal cloud/WEED configuration. Maintain the existing local-kind
  identity/ownership guards and cloud-credential isolation.
- Block unnecessary outbound access with effective local network isolation, and
  verify that it is enforced; an unenforced Kubernetes NetworkPolicy is not evidence.
  Public image retrieval by the setup tools is distinct from application egress.

These controls passed the T0.4 local runtime check, including a reachable synthetic
off-cluster listener and verified firewall rejection from node and pod. Since
[SPEC-0004](../specs/SPEC-0004-test-environment-every-platform.md) the listener is
a helper container on the owned network, on every platform.
The dedicated local kind cluster and unrelated persistent infrastructure remain
subject to [AGENTS.md](../../AGENTS.md).

## Velero Contract

Use an explicit local `s3Url`, `s3ForcePathStyle=true`, generated local credentials
and a fixed signing region. No endpoint, credential or cloud account is auto-detected.
Pre-create only the owned bucket during setup and require positive authenticated
bucket/BSL readiness; a listening TCP port is not sufficient.

The [S3 API documentation](https://github.com/seaweedfs/seaweedfs/wiki/Amazon-S3-API)
lists object CRUD/list, multipart operations, tagging and presigned URLs. The pinned
[SigV4 implementation](https://github.com/seaweedfs/seaweedfs/blob/c5073360007d28385a33426a42ac3e4ec504c5a3/weed/s3api/auth_signature_v4.go)
verifies signatures and expiry and includes Host in the signed headers. T0.5
verifies the scoped ConfigMap workload; T0.6 verifies real signed log/results
downloads with the exact Velero/plugin pair, not full S3 compatibility.

The reviewed AWS plugin defaults to CRC32 checksums and uses its SDK uploader.
T0.5 retained that behavior, restored 13 ConfigMaps with 9 MiB matching payload,
and verified a four-part object through HEAD metadata. Four gzip log/results
objects were retrieved and parsed; no backup archive was downloaded by the fixture
client. Since the fixtures of the tabs the client also writes, and only the eleven
keys of the two backups the sync of the server creates from the store; it deletes
nothing, and the server removes those keys with their backups. Do not silently
disable checksums, authentication or signature validation merely to obtain a
successful backup.

For the unreachable-store case, preserve a cluster-internal hostname in generated
URLs. Do not rewrite BSL publicUrl to localhost, configure `s3.externalUrl` to mask
a changed Host, or add proxy headers to bypass the test. The client transport must
preserve signed authority/path/query and TLS SNI. Wrong Host, changed signature and
expired URL must fail, while the unchanged signed request succeeds.

## Qualification Gates

| Step | Required evidence before claiming success |
| --- | --- |
| T0.4 setup | Exact local target and pinned images; owned storage/bucket; ready Velero and BSL; authenticated access works; anonymous/wrong credentials fail; internal control ports and application egress are isolated; credentials and default kubeconfig remain private/untouched |
| T0.5 fixtures | Real backup/restore of synthetic resources; small/multipart byte integrity with the pinned plugin's checksum behavior; status fixtures remain distinct from controller outcomes; owned cleanup preserves unrelated resources |
| T0.6 transport | Real diagnostic artifacts, direct and forwarded access, unchanged Host/path/query/SNI, negative signature/expiry cases, inline/referenced CA, missing file, timeout, cancellation and size limits |

The initial storage subset does not certify every S3 feature, encryption policy,
snapshot provider or remote deployment. BSL Available alone does not prove backup,
restore or signed-download correctness. Failures of the required gates reopen the
backend decision instead of weakening acceptance criteria.

## Review Outcome

Maintenance, release/image availability, source-level S3 contracts and local startup
controls were checked from public sources. Subsequent CLI and offline hosts-lookup
probes pass. The initial failed node was removed with permission; official-image
bootstrap and installation now succeed. The BSL is Available, authenticated listing
works, and anonymous, wrong-secret and out-of-scope bucket requests return 403.
Control-port and egress isolation plus owned cleanup were verified. T0.5 also
verified real ConfigMap backup/restore, multipart upload and diagnostic artifacts,
then removed the run's operations, namespaces and expected stored objects.
T0.6 adds 16 compiled-main signed downloads: HTTP tunnel, HTTPS tunnel with inline
CA, HTTPS tunnel with referenced CA, and direct HTTPS with referenced CA, four
artifacts per mode. The signature and HTTP Host negative checks reach the storage
server; unknown CA fails TLS. Expiry, 404, bounds and cancellation have synthetic
contract coverage rather than every case being induced against live storage.

The proof enables SeaweedFS's supported HTTPS listener on 8443 using temporary
locally generated TLS resources. It does not change publicUrl, add forwarded-host
headers, disable checksums or patch the server. Its finalizer restores the original
Deployment, Service and BSL, waits for BSL Available, deletes only owned temporary
Secrets/requests and removes certificate files. Controller-mediated fixture cleanup
and the fixture-free verifier pass. The direct worker is an unmodified pinned
official Node image, not a new storage workload. See
[the procedure and limits](TESTING.md#t06-main-transport-proof).

PV/CSI recovery, actual Electron integration and performance benchmarks remain unverified.
Local derivative images are not selected. This is a local development lab only.

Publishable documentation records this proposal and its own technical constraints,
not product comparisons or real-environment data. [ROADMAP.md](ROADMAP.md) is the
single source of truth for scope and progress.
