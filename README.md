# Freelens Extension For Velero

Local development toward v1.0.0. Current package: `0.1.0-alpha.0`.

Status: Local scaffold, development tooling and isolated kind/Velero/S3 environment
are implemented and checked. Local backup/restore, synthetic-state, permission and
compiled-main signed-download proofs pass. No Velero resource views, diagnostic UI,
operator actions or production IPC/catalog integration are implemented yet.
Actual installation in Freelens remains unverified.
Publication is disabled in the package manifest.

## Compatibility

The compatibility reference and declared host version are **Freelens v1.10.3**,
with extension SDK v1.10.3. Freelens v2 is not a target for this development phase.
Do not widen the manifest's host version without a new compatibility decision.

## Development

Use the pinned pnpm version and the Node version in [.nvmrc](.nvmrc).

```sh
pnpm install --frozen-lockfile
pnpm type:check
pnpm lint:check
pnpm test:unit
pnpm knip:check
pnpm trunk:check
pnpm build
pnpm clean:tgz
pnpm pack
```

The unit command explicitly type-checks and builds first, then runs source and
compiled-entry smoke tests. A focused source test can use
`pnpm exec vitest run src/entrypoints.test.ts`. Run Knip after a build: production
analysis inspects generated output. Trunk covers Markdown, YAML and workflow syntax.

The 122 tests cover host-global and dependency-consumer contracts, 52 setup/fixture
checks and 48 diagnostic contracts, not installation into a real Freelens process.
Normal and compact production builds pass. Completed checks and
remaining foundation work are recorded in
[SPEC-0001](docs/specs/SPEC-0001-local-foundation.md). The
[dependency audit](docs/development/DEPENDENCY-AUDIT.md) records zero findings in
the T0.3 graph on 2026-09-18; that dated result does not cover the added T0.6
Kubernetes/WebSocket dependencies. Retain the scoped overrides and consumer patch.

Packing does not bump the version or authorize publishing. The package includes
the main's bundled Kubernetes/WebSocket libraries, but no host SDK implementation,
local test evidence, credentials or cluster configuration.
The prepared CI workflow is manual and disabled by default; no hosted run was used.

## Local Environment

The [image helper](e2e/scripts/local-images.mts),
[cluster runner](e2e/scripts/local-demo.mts) and
[manifest definitions](e2e/scripts/local-manifests.mts) provide T0.4 setup and verification.
The selected backend is [SeaweedFS 4.47](docs/development/LOCAL-STORAGE.md).
On 2026-09-24 the dedicated cluster, Velero server/node-agent and local storage were
verified ready, including authenticated bucket access, negative authentication,
network isolation and owned temporary-resource cleanup. No backup or restore was
created in that setup step. Follow the [local procedure and evidence](docs/development/TESTING.md#t04-attempt-and-recovery-gate).
No cloud target or personal credentials are needed. The reusable demo remains
running with Docker restart disabled; setup does not delete initialized clusters.

T0.5 passed on 2026-09-25: 13 ConfigMaps including 9 MiB of generated payload were
backed up and restored with matching hashes; multipart metadata and four diagnostic
artifacts were verified. Thirty labelled synthetic objects remained isolated from
controllers. Restricted RBAC and cleanup checks passed; no fixture operations or
namespaces are retained. The [fixture procedure](docs/development/TESTING.md#t05-fixture-verification)
reruns the suite against the existing local environment.

T0.6 passed on 2026-09-25: the compiled main retrieved 16 real log/results artifacts
through direct HTTPS and HTTP/HTTPS pod tunnels. Signing, inline/referenced CA and
owned cleanup passed; expiry, limits and cancellation have contract coverage.
The [transport procedure and limits](docs/development/TESTING.md#t06-main-transport-proof)
distinguish this Node proof from actual Electron integration. The proof adapter
accepts explicit certificate/token kubeconfigs, not exec/auth-provider plugins,
proxies or insecure TLS; production connection integration remains future work.

Use only official upstream repositories and release artifacts. Third-party source
repairs, custom image rebuilds and autonomous infrastructure scanning are outside
scope. The previous rebuild/install commands are disabled and existing derivatives
are not selected. See [the binding directive](AGENTS.md#official-artifacts-and-scope).

## Project Documents

- [Directives and safety](AGENTS.md)
- [Roadmap to v1.0.0](docs/development/ROADMAP.md)
- [Development process](docs/development/PROCESS.md)
- [Architecture](docs/development/ARCHITECTURE.md)
- [Operator experience](docs/development/DESIGN.md)
- [Testing strategy](docs/development/TESTING.md)
- [Specifications](docs/specs/README.md)

Architecture, specs, test evidence, plan and roadmap summary are updated together.
Development runs locally; every Kubernetes mutation is restricted to local kind.
Real environment data never belong in this repository or its distributable package.
