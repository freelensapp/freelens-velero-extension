# Dependencies

Updated: 2026-09-27

What the extension ships, what it only builds with, and how both are kept
current. The rule on third-party software is the
[official-artifacts directive](../../AGENTS.md#official-artifacts-and-scope).

## Runtime Libraries Bundled In Main

Declared under `devDependencies` and bundled into `out/main`: a declaration there
does not make a bundled library development-only.

| Package | Pin | Use |
| --- | --- | --- |
| `@kubernetes/client-node` | 2.0.0 | Explicit kubeconfig/authentication and the WebSocket handler of the port-forward protocol |
| `ws` | 8.21.3 | Owned WebSocket handshake, cancellation and backpressure |
| `@types/ws` | 8.18.1 | Build-time declarations only |

- The client is imported by its files, `dist/config.js` and
  `dist/web-socket-handler.js`, never from its root, which would bundle every
  generated API client. The package has no `exports` map: a future one would break
  the build visibly. Run the adapter and tunnel tests before changing the version.
- undici is replaced by [a stub](../../build/undici-stub.ts) in the main build. The
  reasons are in [ARCHITECTURE.md](ARCHITECTURE.md#scaffold-progress).
- The build defines `WS_NO_BUFFER_UTIL` and `WS_NO_UTF_8_VALIDATE`: they disable
  the optional native accelerators of `ws`; no library is patched.
- The renderer bundles nothing.

The packed production build is about 0.6 MB.

## Development Graph

- The host SDK, `@freelensapp/extensions`, is a type and build input. The build
  maps it to the global the host provides and never bundles its implementation,
  nor anything the SDK depends on.
- Biome, Knip, Trunk and shx are not dependencies: the scripts run them through
  `pnpm dlx` at an exact version.
- There is no dependency override and no patch.
- OSV-Scanner reads the lockfile on every pull request and on main. It reports and
  does not fail the run: a finding in the development graph is information to
  explain in context.

### History

On 2026-09-18 the graph carried fifteen overrides and a patch of `query-string`,
which brought `pnpm audit` from 62 findings to none for the graph of that day.
They were dropped on 2026-09-27:

- thirteen touched the development graph only;
- the patch modified third-party code, which the directive forbids;
- an override carries its floor in its key, so nothing keeps it current;
- the Trunk launcher, whose `tar` carried the only critical finding, is no longer
  in the graph.

The lockfile kept the versions it had where the ranges allow them.

Without the overrides OSV-Scanner reports again, on 2026-09-27, 21 known
vulnerabilities in two packages, none of them critical or high:

| Package | Comes from | Bundled |
| --- | --- | --- |
| `dompurify` 3.1.7 | the editor the core of the host depends on, through the host SDK | No |
| `decode-uri-component` 0.2.2 | `query-string` of the core of the host, through the host SDK | No |

Both belong to the host and reach this graph through its SDK, which the build
never bundles. Their fix is a release of the host, not an override here.

## T0.4 Container Image Findings

Date: 2026-09-18. Historical: a scan of the images of the test environment, from a
workflow that was retired the same day. The findings concern the test
infrastructure, not the npm graph of the extension and not Freelens.

| Image | Critical | High | Medium | Low | Unknown |
| --- | --- | --- | --- | --- | --- |
| kindest/node v1.33.1 | 29 | 611 | 823 | 286 | 19 |
| Velero v1.18.2 | 0 | 46 | 26 | 10 | 2 |
| AWS plugin v1.14.2 | 0 | 21 | 4 | 0 | 0 |
| SeaweedFS 4.47 | 0 | 1 | 0 | 0 | 1 |

Counts are scanner occurrences across packages and binaries, not distinct
exploitable vulnerabilities. The node image of the environment is v1.34.11 since
2026-09-24 and was not scanned.

The environment uses verified official releases, pinned by digest in
[local-manifests.mts](../../e2e/scripts/local-manifests.mts), with the network
isolation described in [LOCAL-STORAGE.md](LOCAL-STORAGE.md). A finding of a scanner
on those images is not a gate and not a reason to rebuild them.
