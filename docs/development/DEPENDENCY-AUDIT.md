# Development Dependency Audit

Updated: 2026-09-25; audit date: 2026-09-18

Status: T0.3 remediation and consumer compatibility checks passed on 2026-09-18.
That resolved-graph audit reported zero findings; no waiver was used. The added
T0.6 Kubernetes/WebSocket dependencies are not covered by that historical result.

This status applies to the T0.3 npm graph only. The later
[T0.4 container scans](#t04-container-image-findings) are historical evidence from
a retired workflow, not a current zero-CVE laboratory gate. The latest
[official-artifacts directive](../../AGENTS.md#official-artifacts-and-scope)
forbids autonomous upstream remediation and custom images.

## Scope And Results

This audit covers the extension's resolved development dependencies, not the running
Freelens application. Host and SDK remain exactly v1.10.3. The build maps the SDK to
host globals and does not bundle its implementation; all declared npm dependencies
were development-only in the audited T0.3 graph. T0.6 adds runtime code bundled
from development declarations, as recorded below. A declaration under devDependencies
does not make a bundled library development-only or extend the old audit result.

| Check | Initial result | After compatible fixes | After authorized remediation |
| --- | --- | --- | --- |
| Direct-coordinate CVE assessment | One affected package, Vitest | No known CVEs for the 12 direct coordinates | Direct versions unchanged; targeted tar/decoder assessment also reports zero |
| Full `pnpm audit --json` | 62 findings: 1 critical, 24 high, 31 moderate, 6 low | 13 findings: 1 critical, 8 high, 4 moderate | Zero findings at every severity; exit 0 |
| `pnpm audit --prod --json` | Not used as a substitute for the full audit | Zero findings in declared production dependencies | No production dependency was introduced; full graph also clean |

The production-only result excludes development tools and the host runtime; it is
not a release security sign-off. The full-graph result is a dated dependency check,
not a guarantee of absence of unknown vulnerabilities. No dependency or file in
another repository was changed, and no runtime binary was installed or upgraded to
remediate this extension's development graph.

## Compatible Changes

Vitest is directly pinned to 4.1.11 to address
[CVE-2026-84373](https://github.com/advisories/GHSA-82fw-gwwq-j7x9). Its matching
mocker is resolved at 4.1.11. Narrow version-range overrides in
[pnpm-workspace.yaml](../../pnpm-workspace.yaml) apply the remaining same-major fixes.

| Package | Initially resolved | Patched resolution |
| --- | --- | --- |
| vitest / @vitest/mocker | 4.1.9 | 4.1.11 |
| dompurify | 3.1.7 and 3.4.12 | 3.4.13 |
| tar, 7.x branch only | 7.5.20 | 7.5.21 |
| fast-uri | 3.1.3 | 3.1.6 |
| brace-expansion | 1.1.16 | 1.1.18 |
| postcss | 8.5.19 | 8.5.23 |
| undici | 7.28.0 | 7.29.0 |
| ip-address | 10.2.0 | 10.3.1 |
| electron, development graph only | 41.10.2 | 41.10.3 |
| nanoid | 3.3.16 | 3.3.18 |
| js-yaml | 5.2.1 | 5.2.2 |
| browserslist | 4.28.6 | 4.28.7 |
| joi | 18.2.3 | 18.2.5 |
| baseline-browser-mapping | 2.10.43 | 2.11.0 |

Registry metadata confirmed these versions were available before installation.
Electron's npm metadata/types are in the development graph; its install script is
not allowlisted. This does not change or patch the actual Freelens v1.10.3 runtime.

## Authorized Compatibility Changes

The lead maintainer approved the two changes below on 2026-09-18, including consumer-specific
compatibility tests and completing T0.3 before any environment step. This approval
does not widen the Freelens/SDK pin or waive any audit finding. T0.4 remains gated.

| Dependency | Path | Verified change | Previously reported risk |
| --- | --- | --- | --- |
| tar 6.2.1 | @trunkio/launcher 1.3.4 -> tar | Parent-scoped override to 7.5.21 | 12 findings, including [critical archive extraction](https://github.com/advisories/GHSA-23hp-3jrh-7fpw) |
| decode-uri-component 0.2.2 | SDK -> core -> query-string -> decoder | Parent-scoped override to 0.5.0 plus a one-line consumer import patch | One [moderate advisory](https://github.com/advisories/GHSA-vcc3-ghjq-m6fr) |

The latest published Trunk npm launcher at inspection time is still 1.3.4 and
depends on tar 6. Merely updating within that range does not clear its findings.
The decoder's pre-1.0 minor change can be breaking. Following the lead maintainer's approval,
two parent-specific overrides target only `@trunkio/launcher@1.3.4>tar` and
`query-string@7.1.3>decode-uri-component`. No host/SDK upgrade or consumer change is
implied. Resolution, consumer compatibility and a new audit must prove the result.

Eight new tests in [the existing build contract suite](../../test/build.test.ts)
passed before the overrides: gzip extraction with the launcher's file/cwd/strip
options, executable-mode preservation, invalid archive rejection, query decoding
and round-trips, malformed encoding and prototype-like key isolation. They resolve
libraries from the actual consumers, not an unrelated top-level installation.
Fixtures are synthetic and removed from a private temporary directory after testing.

The first post-override check passed both tar tests but failed the six query-string
checks: decoder 0.5.0 exports an ESM default, while query-string expects a directly
callable CommonJS value. A one-line [pnpm patch](../../patches/query-string@7.1.3.patch)
adapts that import. It uses the selected local Node runtime's synchronous ESM loading;
the patched SDK implementation is not bundled into or installed over Freelens.
The unchanged consumer checks passed after the patch. The patched consumer also
passed a direct import/parse check on Node 22.12.0, the declared minimum, without
experimental flags. Keep the patch and its parent-specific override together.

Reinstallation preserved the exact lockfile hash and the active consumer patch.
Resolved versions were checked from each consumer: launcher -> tar 7.5.21 and
SDK -> query-string 7.1.3 -> decoder 0.5.0. Host and SDK pins remain 1.10.3.

## Verification And Gate

After the authorized changes, local type-check, normal/production CommonJS builds,
all 21 tests (13 scaffold plus 8 consumer checks, zero failures/skips), both Knip
modes, Biome and Trunk passed. The full resolved audit and targeted advisory scan
reported zero findings. All completed commands exited 0; the intermediate module
interop failure was repaired rather than waived or hidden by changing expectations.

The refreshed package passed its nine-file allowlist, unchanged version and exact
host/SDK checks. Its checksum and the completed T0.3 evidence are recorded in
[SPEC-0001](../specs/SPEC-0001-local-foundation.md). At T0.3, actual-host installation,
Kubernetes fixtures and transport were later proof gates. Their subsequent evidence
is recorded separately; this remediation result authorized no T0.4 or remote activity.

## T0.6 Dependency Scope

The approved main transport proof adds exact official npm packages:

| Package | Pin | Use |
| --- | --- | --- |
| `@kubernetes/client-node` | 2.0.0 | Explicit kubeconfig/authentication and Kubernetes port-forward protocol, bundled in main |
| `ws` | 8.21.3 | Owned WebSocket handshake, cancellation and backpressure, bundled in main |
| `@types/ws` | 8.18.1 | Build-time declarations only |

No host/SDK version or existing consumer override/patch changed. The new lockfile
SHA-256 is `695b3c108f021c3a4f29c889d8d2d282ae93c64c4f1a6d59679fee3b04e16ccd`.
The historical T0.3 reinstall hash is not a claim that this changed graph is identical.
Normal/production builds and 118 tests pass, including compiled WebSocket behavior.
The package loads outside the development workspace without installing these
dependencies or loading the host SDK. Supported build-time `WS_NO_BUFFER_UTIL` and
`WS_NO_UTF_8_VALIDATE` disable optional native accelerators; no library is patched.

The local direct-route proof additionally uses the unmodified official
`docker.io/library/node:24.15.0-bookworm-slim@sha256:4e6b70dd6cbfc88c8157ba19aa3d9f9cce6ba4703576d55459e45efcbc9c5f5d`.
It is a temporary test runner, not package content or a replacement for the host.
No new vulnerability scan or upstream remediation was performed. The old zero-
finding result is not a current-graph security sign-off, and no zero-CVE laboratory
gate has been added. Keep the [official-artifacts directive](../../AGENTS.md#official-artifacts-and-scope).

## T0.4 Container Image Findings

Date: 2026-09-18. Status: historical workflow, superseded by explicit user directive.
These findings concern local test infrastructure, not the extension's npm graph
or the installed Freelens application. The lead maintainer subsequently approved local
remediation, then explicitly stopped it and required official upstream artifacts
only. Custom builds from the intervening work are unused and not deleted. The
remediation commands are disabled; no new scan or upstream repair is authorized
by this report. Host and SDK stay exactly v1.10.3.

The image scan tool first required Trivy. The official Trivy 0.74.0 archive was
installed in user space without replacing an existing binary. Its published SHA256
was verified as `2ae6fe3ee734b7fdf11335663e18c75ea12dccc76062f09f164a3b0f8be4371a`;
the license and release metadata remain with the local tool installation.

The tool reported storage findings; an explicit CLI scan then captured JSON for
each [pinned image](../../e2e/scripts/local-manifests.mts), using only the local
Docker image source and the public Trivy database. The CLI environment excluded
account credentials and personal Docker configuration. Each scan exited 1 under
`--exit-code 1`; a report with findings is not a passing qualification gate.

| Image | Critical | High | Medium | Low | Unknown |
| --- | --- | --- | --- | --- | --- |
| kindest/node v1.33.1 | 29 | 611 | 823 | 286 | 19 |
| Velero v1.18.2 | 0 | 46 | 26 | 10 | 2 |
| AWS plugin v1.14.2 | 0 | 21 | 4 | 0 | 0 |
| SeaweedFS 4.47 | 0 | 1 | 0 | 0 | 1 |

Counts are scanner occurrences across packages/binaries, not distinct exploitable
vulnerabilities. Reachability, upstream fixes and possible version-detection issues
still need triage. Network isolation alone does not waive these findings.

SeaweedFS findings in the scanned `weed` binary:

- `CVE-2026-84445`, High: `google.golang.org/grpc` reported as `v1.85.0-dev`.
	The report lists fixes at `1.82.2`, `1.83.2` and
	`1.85.0-dev.0.20260825072537-93e31b48545e`. Verify the embedded source revision
	and choose a compatible patched distribution/build; do not blindly downgrade.
- `GO-2026-5932`, Unknown: `golang.org/x/crypto` `v0.56.0`.
	This scan lists no fixed version. That is not proof that no upstream fix exists.

Raw reports and scanner stderr remain outside all repository worktrees under
`$HOME/.local/state/freelens-velero-dev/scans`. No raw report is packaged. The scan
used `trivy image --image-src docker --scanners vuln --format json --exit-code 1`
for each exact digest, with `--db-repository ghcr.io/aquasecurity/trivy-db:2` and an
explicit local `DOCKER_HOST`. Keep the cleared environment when reproducing it.

Current direction: use verified official releases and supported configuration,
with functional/safety evidence for the extension's actual scope. Explain a
concrete upstream blocker and official options rather than repairing upstream
software or adding a new scanner gate. Do not label T0.4 complete from CLI probes
or unit tests; [bootstrap and runtime evidence](TESTING.md#t04-attempt-and-recovery-gate)
are still required. Historical findings are neither erased nor declared fixed by
this scope decision.

