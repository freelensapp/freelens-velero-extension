# Dependencies

Updated: 2026-10-17

What the extension ships, what it only builds with, and how both are kept
current, on Freelens v2 since T0.7
([SPEC-0015](../specs/SPEC-0015-freelens-v2-host.md)). The rule on third-party
software is the
[official-artifacts directive](../../AGENTS.md#official-artifacts-and-scope).

## What The Bundles Carry

The host installs nothing for an extension: what the code needs at run time and
the host does not provide is in the bundle. The rule of the template of the
organization applies: a third-party library a bundle carries is declared in
`dependencies`, and the modules of the host in `devDependencies`.

| Package | Pin | Bundle | Use |
| --- | --- | --- | --- |
| `react-window` | 2.3.4, the version of the catalog of the host | Renderer | The windowing of the lines of a log and of the rows of the resources viewer, in place of the virtual list the host no longer offers to an extension |

- The main bundle, `dist/main.js`, carries the code of the extension and the shim
  of the SDK, and no library. It reaches the API server through the client of the
  host, and opens the tunnel to the store with the kubectl the host runs for the
  cluster: no Kubernetes client, no WebSocket library and no undici are in the
  graph. The modules of Node and `electron` stay outside the bundle. `electron`
  is imported at the moment a text is saved, for the dialog in which the
  operator chooses the file, and never when the extension is loaded: the proofs
  of the test environment load the main bundle under Node, where there is no
  host. It is the module of the process the extension runs in, and no
  dependency of the package.
- The renderer bundle, `dist/renderer.js`, carries the code of the views, the
  shim of the SDK and react-window. React, its DOM, its JSX runtime, MobX and its
  bindings for React are read from `globalThis.FreelensExtensionApi`, which the
  host provides, by the plugin `build/vite-plugin-host-modules.mjs`; the main
  process reads MobX alone from it. The build test lists the sources each
  bundle carries, the code of the extension, the shim and react-window in the
  renderer, and fails on anything else, a copy of React or MobX among it.
- The shim of the SDK is the module of `@freelensapp/extensions` that reads
  `Common`, `Main` and `Renderer` from the same global: it is bundled, and the
  rest of the SDK is never reached.

The packed build is about 0.5 MB.

## Development Graph

- The host SDK, `@freelensapp/extensions`, is pinned exactly to the nightly of the
  validation target, 2.0.0-0-nightly-2026-10-19, until Freelens 2.0.0 is released,
  then to a range of versions. Its declarations are in the package itself.
- `react`, `react-dom` 19.3.1, `mobx` 7.0.6, `mobx-react` 10.0.2, their
  declarations and `electron` 43.8.0, for its types, are devDependencies at the
  versions of the catalog of the host: the build reads the names they export and
  the tests of the views run against them. pnpm 12 runs with
  `strictPeerDependencies`, so a library shared with the host outside the peer
  range of the SDK fails the install. `@testing-library/react` 16.3.3, with
  `@testing-library/dom` 10.4.2, and `jsdom` are for the tests alone.
- Biome, Knip, Trunk and shx are not dependencies: the scripts run them through
  `pnpm dlx` at an exact version.
- There is no dependency override and no patch.
- OSV-Scanner reads the lockfile on every pull request and on main. It reports and
  does not fail the run: a finding in the development graph is information to
  explain in context.
- Renovate follows the host, with the configuration of the template: custom
  datasources read the default catalog of Freelens on main for the libraries,
  the scripts of its root package for the tools run through `pnpm dlx`, and its
  `mise.toml` for Node and the tools of mise. A version arrives once Freelens
  took it, at that version, in one pull request, the group `Freelens
  dependencies`, with the nightly of the SDK. React, MobX, react-window and
  every other library follow the catalog. The pins of the test environment keep
  rules of their own: Velero and its plugin move together, kind, its node image
  and kubectl together, the checksums beside them by hand, and the image of the
  helper with `.nvmrc`, by hand. Two workflows run every day and open a pull
  request when they have something: one deduplicates the lockfile, one runs
  `pnpm audit fix`. The second can propose an override: whoever merges it takes
  on keeping it current.

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
never bundles. Their fix is a release of the host, not an override here. Since
T0.7 the SDK of Freelens v2 brings neither of them, nor the core of the host,
into the graph.

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
