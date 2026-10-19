# SPEC-0015: The Freelens v2 Host

- **Status:** Approved
- **Date:** 2026-10-16
- **Milestone / tasks:** Foundation / T0.7, T0.8
- **Reviewed Velero:** v1.18.4, `4ee1e79a7aed367fd9b767b8219ec65bd0c96892`, unchanged
- **Reviewed main:** not relevant: the subject of this spec is the host, and it reads or changes no behavior of Velero
- **Freelens validation target:** freelensapp/freelens `2578fac5e9f6d2893129b6ba0d59b379fdf9d305`, the base of the nightly v2.0.0-0-nightly-2026-10-19, with `@freelensapp/extensions` 2.0.0-0-nightly-2026-10-19; it moves with the host drift watch until Freelens 2.0.0 is released
- **Dependencies:** [local foundation](SPEC-0001-local-foundation.md); [test environment](SPEC-0004-test-environment-every-platform.md); [the write gate](SPEC-0009-write-gate.md); [the diagnostic request and its transport](SPEC-0010-diagnostic-request-and-transport.md); [the viewers](SPEC-0011-artifact-viewers.md); for the re-verification, the specs of M1 to M3, SPEC-0002 to SPEC-0012, and [the adherence of a schedule](SPEC-0013-schedule-adherence.md) for T3.1 and T3.2
- **Approval:** Approved by the lead maintainer on 2026-10-16, as drafted. The version and release plan, D10, was decided by the lead maintainer the same day

Governed by [AGENTS.md](../../AGENTS.md).

## Goal

The extension runs in Freelens v2 with every behavior agreed in M1 to M3 and in
T3.1 and T3.2 unchanged, and the rest of v1.0.0 is developed on v2. Nothing new
is offered to the operator. Freelens v1 is no longer supported by v1.0.0.

## Scope Baseline

The [directives](../../AGENTS.md#product-and-editorial-rules) say that another
major version of Freelens needs its own spec and its own verification. This is
that spec. The move was surveyed on 2026-10-16, read only, at `eb35d82`: every
use of the extension API of v1 in the source, the source and the documents of the
host at the validation target, the template of the organization,
freelensapp/freelens-example-extension, at `e9881f92d17683cec534a848ffd396db1fab6212`,
and a type check of the unchanged source against the SDK of the target. No
Freelens v2 was started for this draft.

The surface of v1 the extension uses: the SDK is reached from 41 source files, 38
of the renderer, 2 of the main process and 1 common. They hold six pages, seven
entries of the sidebar, five sections of the details, five kinds whose `KubeApi`
and `KubeObjectStore` subclasses are never used, nineteen components of the host
in 174 uses, thirteen channels between the processes, the catalog of the main
process, the store of the preferences and the dialog of Electron in the main
process. Of the 3,507 lines of the main process only `src/main/index.ts` and the
last thirty lines of `src/main/ipc.ts` touch the SDK; the rest is Node.

### The Surface Check

The unchanged source was type-checked in a scratch copy against
`@freelensapp/extensions` 2.0.0-0-nightly-2026-10-15, React 19.3.1, MobX 7.0.6,
mobx-react 10.0.2 and Electron 43.7.11 for its types, through the programs of the
template, one for each process. With the SDK of v1, in the program of this
repository, the same source has no error. The check found 64 sites, of five
classes:

| Class | Sites | Where | Change |
| --- | --- | --- | --- |
| The split of the processes | 24 | `src/common/ipc.ts:8` imports a type from `src/main/diagnostic-transport.ts`, which pulls the modules of Node into the programs of the renderer and of common. The declarations of the SDK of v1 brought the types of Node into every program and hid it | Mechanical: the type moves to common |
| React 19 | 13 | `useRef` without an argument and the six assignments that follow from it, a ref of an element that may be null, and the node a cell of the list of the host takes at `src/renderer/components/family-page.tsx:140` | Mechanical |
| MobX 7 | 11 | `observable.ref` in the annotations of `makeObservable`, in one common and three renderer files | Mechanical: `observableRef` |
| The programs of the template | 11 | Imports of the main process that name a `.ts` file, which the program of the template does not allow. They fail on the types of v1 as well | Mechanical: the extension goes from the import |
| A removed API | 5 | `Renderer.Component.VirtualList` and `VirtualListRef` in `src/renderer/components/artifact-lines.tsx` and `src/renderer/components/resources-viewer.tsx`, and two parameters that lose their type with them | Design: D8 |

59 sites are mechanical. The five of the virtual list are the only design case.
No API was renamed or moved, and no prop of a component of the host changed but
the React 19 one. Eleven negative controls, wrong props given to components of
the host, failed as they should: the compiler checks the components.

What the compiler does not show, and the decisions cover: the reader reaches a
protected member of `KubeApi` through a cast (D4); the event of a handler of
`Main.Ipc` is `any` in a program with the types of Node alone (D5); the address of
a frame and the contract of the bundle are strings (D5, D6); Testing Library 12
calls functions React 19 does not have, so twenty test files would fail when they
run (D9); `test/build.test.ts` pins v1 (D9); the adapter built from the kubeconfig
of the user compiles, and goes around the proxy of Freelens (D1).

Included: T0.7, the port, one pull request that keeps main working: the manifest,
the toolchain and the build, the mechanical migration, the main process, the way
between the processes, the stores and the registrations, the components and the
styles, the error boundaries, the unit tests, the packaged suites and the
integration test, CI and the documents. T0.8, the re-verification: every check of
SPEC-0002 to SPEC-0012 and the checks of SPEC-0013 that T3.1 and T3.2 made green,
green on v2 in CI on main; the validation target of those specs moved with the
evidence of v2; a pre-review on both themes on v2 with a gallery for the review
gate.

Excluded, with their owners: every new feature; T3.3 and the rest of M4, M5 and
M6, which resume on v2 after T0.8; a line of the extension for Freelens v1, of
which none is kept; the work of M6 at Freelens 2.0.0, which D10 names.

## User Scenarios

1. **P1, every page as before:** Given Freelens v2 at the validation target and
   the demo cluster, when the operator installs the tarball of the extension from
   the Extensions page and opens the cluster, then the extension is listed as
   Enabled, the sidebar has the group of Velero with its entries in the same
   order, and every page, workspace, tab, band and section of the details shows
   what it showed on v1, with the same words and the same states, while the API
   server counts the same requests of the views.
2. **P1, Freelens 1.10.3:** Given Freelens 1.10.3, when the operator installs the
   same tarball, then the Extensions page lists it as Incompatible, offers no
   command to enable it, and no code of the extension runs.
3. **P1, disable and enable:** Given the extension enabled, with writes on and a
   log loaded, when the operator disables it and enables it again from the
   Extensions page and loads the log again, then writes are off until turned on,
   the load creates one request, one kubectl runs for it and ends with it, and
   the store of the preferences is saved once for each change.
4. **P1, a cluster that is disconnected:** Given the views of a cluster with
   writes on and a log on its way through the tunnel, when the operator
   disconnects that cluster in the catalog, then kubectl ends, writes are off,
   and the cluster stays disconnected: no request of the extension reaches it
   until the operator connects it again.
5. **P1, no port-forward:** Given an identity that may create a DownloadRequest
   and read the route to the store, and may neither get nor create
   `pods/portforward`, when the operator loads a log, then the tab says that the
   cluster refused the port-forward and names `create` on `pods/portforward`, and
   no kubectl is left running.
6. **P1, a restricted reader:** Given the reader of three kinds and the reader of
   a part, as on v1, when each opens the pages, then each view shows the same
   denied, partial and not served states it showed on v1, from the status of the
   answers.
7. **P1, through the tunnel:** Given the demo, whose store is a Service of the
   cluster, when the operator loads the log of the real backup, then kubectl
   forwards a port of the loopback to the Pod of the store, the request reaches
   the store with the host, the server name, the path and the query the server
   signed, the store accepts the signature, the log arrives, and no part of the
   URL appears in any output.
8. **P2, an error in a section of the details:** Given a section of the details
   that throws while it renders, then the error page of the extension is shown in
   its place, the rest of the drawer and of the cluster view stays, and the log of
   the host has the error with the name of the extension.
9. **P2, a credential plugin:** Given a cluster whose kubeconfig takes its
   credential from an `exec` plugin, when writes are turned on and a log is
   loaded, then the proxy of Freelens runs the plugin and the extension runs none:
   the extension refuses no kind of authentication of its own.

## Requirements

| ID | Contract | Acceptance check |
| --- | --- | --- |
| REQ-196 | The manifest declares `engines.freelens` as `^2.0.0`. Freelens v2 at the validation target lists the installed extension as compatible and Enabled, and loads both entry points with no error in either log. Freelens 1.10.3 lists the same tarball as Incompatible, offers no command to enable it, and runs none of its code. No version of v1.0.0 declares a range that includes Freelens 1 | HOST-01 |
| REQ-197 | The behavior agreed in M1 to M3, T3.1 and T3.2 does not change: every page, view, section of the details, word, state, request to the cluster, write through the gate and bound stays as its spec says, but for what the requirements of this spec change and the amendments they name. Every check of SPEC-0002 to SPEC-0012, and the checks of SPEC-0013 that T3.1 and T3.2 made green, pass on Freelens v2 in CI on main | HOST-02 |
| REQ-198 | The manifest and the dependencies are the ones of the template of today: `"type": "module"`, `main` `dist/main.js`, `renderer` `dist/renderer.js`, `files` `dist/**/*`, the Node engine of the template; `@freelensapp/extensions` pinned exactly to the nightly of the validation target until Freelens 2.0.0 is released; React, its DOM, MobX, the bindings of MobX for React, their types, and Electron for its types, as devDependencies at the versions of the catalog of the host; react-window, the one library the bundle carries, in `dependencies` at the version of the catalog of the host, as the knip rule of the template asks; no other `@freelensapp` package; pnpm 12 with strict peer dependencies, so that a library shared with the host outside the peer range of the SDK fails the install | HOST-03 |
| REQ-199 | The build is the one of the template: Vite 8 in two runs, the renderer for the browser with nothing external and no module of Node or Electron, the main process for Node with `electron` and the modules of Node external. The libraries of the host are taken from `globalThis.FreelensExtensionApi` and never bundled; the shim of the SDK is bundled. The build writes exactly one stylesheet, `dist/renderer.css`, which the host links, and the extension injects none. `dist/main.js` loads under Node with a stand-in of the API of the host: the main process takes the dialog of Electron when a file is saved, never when it is loaded. There is one TypeScript program for each process and one for the tests, with the environment tests of the template, and a lint rule refuses `act`, `react-dom/test-utils` and Testing Library in code that is not a test | HOST-04 |
| REQ-200 | The main process reaches the API server through the host and through nothing else of its own: every request of the create-only adapter, the creation of a DownloadRequest or of a ServerStatusRequest and every read that goes with it, the target, its backup, its storage location, the Secret of its certificate, the Service, the endpoint slices and the Pod of the route, and the request read back and polled, goes through `Main.K8sApi.KubeJsonApi.forCluster` of the cluster of the request. The extension reads no kubeconfig, runs no credential plugin, and keeps no client and no connection of its own to an API server. The pull request of T0.7 amends, in the same pull request, REQ-114, REQ-115 and REQ-116 of SPEC-0009, and REQ-129, REQ-136 and REQ-137 of SPEC-0010, as D1 and D2 say | HOST-05 |
| REQ-201 | A cluster that is not connected is never connected by the extension. Before every request the main process reads the entry of the cluster in `Main.Catalog`: an entry that is not there, or whose state is not connected, refuses the request as a target that changed, with words that say which, before anything leaves. The gate turns writes off for a cluster whose entry goes, is no longer connected, or changes its kubeconfig path or its context name | HOST-06 |
| REQ-202 | Every answer of the cluster is read by its status: from the answer itself where the client of the host gives it, as `getResponse` does whatever the status, and otherwise from the shape the call rejects with, the `Status` body of a read refused with 403, an error the client parsed with its status, or the error of the fetch when no answer came, each taken by its shape and never as an `Error` it is not. Each ends in the code REQ-124 of SPEC-0010 gives it, and a creation that got no answer is reconciled by its name as REQ-135 says. Header names are lowercase. No query parameter is sent without a value. The bounds of the adapter stay: ten seconds for a request, through a signal of its own, since the client of the host has none, and 4 MiB of an answer, counted as its body arrives | HOST-07 |
| REQ-203 | The tunnel to the Pod of the store is a `kubectl port-forward --address 127.0.0.1` of that Pod and of the port the route found, which the main process runs with the kubectl `Main.Shell.getKubectlPath` gives for the cluster, the environment `Main.Shell.getEnvironment` gives for it, and the folder of the extension as its working directory. kubectl chooses the local port, and the tunnel is ready when kubectl writes its line `Forwarding from 127.0.0.1:<port>`, read for that port. The wait for that line is fifteen seconds, counted once kubectl is prepared; the preparation, which may download the kubectl of the version of the cluster, counts toward the bound of the whole operation of REQ-133 of SPEC-0010. An abort before kubectl runs starts nothing, and an abort before the line kills it. The bundle carries neither `@kubernetes/client-node` nor `ws` | HOST-08 |
| REQ-204 | No tunnel outlives what it was opened for. kubectl is killed when its operation ends, whatever the end, when the operator cancels, when the extension is deactivated, when the main process exits, and when the cluster is no longer connected, which a reaction on `Main.Catalog.getClusterById(id)?.status` tells. A kubectl that has not exited five seconds after it was told to is reported and holds no place, as REQ-133 of SPEC-0010 says of a route. After any of these, no kubectl of the extension runs | HOST-09 |
| REQ-205 | A port-forward the cluster refuses is said as such. kubectl that exits before its line of readiness because the API server refused `create` on `pods/portforward` ends the operation as forbidden at the step of the port-forward, with the resource and the verb the identity needs. kubectl that exits for any other reason before that line ends it as transport-unreachable at that step, and a kubectl `Main.Shell` does not give, for a cluster that is no longer there or no longer connected, ends it as a target that changed, at that step. What kubectl writes is read in the main process and crosses between the processes in no form. The permissions the documentation of v1.0.0 lists for the tunnel are the ones this kubectl needs, proven with the identities of the test environment | HOST-10 |
| REQ-206 | The transport keeps the contract of SPEC-0010: Node `http` and `https`, the origin, the path, the address and the scheme of REQ-126 to REQ-130, the trust of REQ-131 with the inline certificate and `caCertRef`, no redirect followed, the bounds of REQ-133 and the redaction of REQ-134. Through the tunnel the socket goes to the port of the loopback kubectl gives, and the request keeps the host, the server name, the path and the query the server signed. A direct download keeps Node `https` and not `Main.Util.fetch`: it follows neither the proxy preference nor the certificate preference of Freelens, as on v1, and the documentation of v1.0.0 says so | HOST-11 |
| REQ-207 | The views read the cluster through `Renderer.K8sApi.KubeJsonApi.forCluster(<the cluster of the frame>).getResponse`, with `GET` and the paths of the kinds of Velero only, and take the status and the body of the answer, which is not a `Response` of the DOM; the state of a view keeps coming from the status. The reader creates no `KubeApi` and registers nothing with the host. The identifier of the cluster of a frame is the one the host writes in the address of the frame, and the one the catalog of each process gives: the three agree | HOST-12 |
| REQ-208 | The procedures are a subclass of `Main.Ipc` in the main process and of `Renderer.Ipc` in the renderer, each created in `onActivate` and reset in `onDeactivate`, and the store of the preferences is opened in `onActivate` of each process. A disable and an enable of the extension in one session leave one handler for each channel, one listener of the changes of the gate, one store that saves, and no tunnel, no confirmation and no write of before | HOST-13 |
| REQ-209 | The main process binds every request to its frame as SPEC-0009 says: the event of a handler is typed as the `IpcMainInvokeEvent` of Electron, so that the compiler checks what is read of it; the cluster of the sender is read from the host of the address of its frame, `<clusterId>.renderer.freelens.app`, by the rule of the host; the identifier a request names must be that cluster and an entry of `Main.Catalog`. A listener of the renderer never reads the event it is given. The contract and its readers of REQ-112 of SPEC-0009 do not change. The architecture states the trust model of v2: the extensions are not isolated from one another, the container of the host is no security boundary, and the renderer has no isolation of its context | HOST-14 |
| REQ-210 | The registrations are the ones of the template. Each kind is one `LensExtensionKubeObject` with static metadata, `crd.apiVersions` listing every version the cluster serves, `velero.io/v1` for the five, and `declare kind` and `declare apiVersion` as literals; no subclass of `KubeApi` or `KubeObjectStore`, and no instance method. A store of the host is the one the host registers for a served version, read with `getStore()` in the render of an `observer`. The five kinds with pages of their own are `customResources`, so that the Custom Resources tree of the cluster leaves them out while the extension is enabled. The five sections of the details are made with `detailsFor`, and a menu item a later spec adds is made with `menuItemFor`. A page receives only its parameters and takes the extension from its registration. The entries of the sidebar keep their order | HOST-15 |
| REQ-211 | Every page, section of the details and menu item renders inside the error boundaries of the template. An error thrown while one renders stays in its place, with the error page of the extension or nothing for a menu item; the crash page of the host never replaces the cluster view because of the extension, and the log of the host has the error with the name of the extension | HOST-16 |
| REQ-212 | The extension runs on the React 19 and the MobX 7 of the host, one copy of each. `observableRef` replaces `observable.ref`; a decorated observable field is `@observable accessor`, and no class calls `makeObservable(this)` without its annotations; a class whose instances are serialized keeps plain fields with an annotation map. An `observer` reads its props in its render, and a callback the host calls from its own derivations, `getItems` or `customizeHeader` of the list, carries the values it needs from there. A change of a preference made through MobX reaches the views | HOST-17 |
| REQ-213 | The lines of a log and the resources viewer are windowed by react-window 2, bundled at the version of the catalog of the host, in place of the virtual list the host no longer offers. What SPEC-0011 says of the lists of lines stays: at most a hundred rows mounted, each line whole with its wrap, the search that brings its match into view, the focus on the first line after a load, and the keyboard. The budgets of REQ-147 of SPEC-0011, measured again in the packaged Freelens v2, are the acceptance | HOST-18 |
| REQ-214 | The unit and component tests run on the stub of `@freelensapp/extensions` of the template, grown as the tests need, with Testing Library 16 on React 19. The doubles of the host are written again from the source of the host at the commit of the validation target, each component with the behavior it has there and the file and line it was read at. The tests of the frames use the addresses of v2. The build test pins the manifest of REQ-196 and REQ-198 and loads the bundles as REQ-199 says | HOST-19 |
| REQ-215 | The suites of the views and FND-10 run in a Freelens built from source at the commit of the validation target, in CI on every pull request and on main, the build cached by that commit and not by a version. On a machine of a developer they run on the nightly application built from the same commit, its download checked against its published checksum. The integration test of the template runs beside them, with a session for each of the five kinds, on the disposable kind cluster of its job. The host facts of AGENTS.md that the suites rest on are proven again on v2, or removed | HOST-20 |
| REQ-216 | The version line is 1.0.0. Main takes a prerelease of it, `1.0.0-N`, from the pull request of the version workflow, never from a change by hand. A prerelease is tagged, published on the npm tag `next`, and released on GitHub as a prerelease. 1.0.0 is published on `latest` only after Freelens 2.0.0 is released and M6 is done, since installing by name takes the newest version that is not a prerelease, whatever its `engines`. With Freelens 2.0.0 the pin of the SDK becomes a range of versions and the integration runs at the tag v2.0.0, as work of M6 | HOST-21 |
| REQ-217 | The documents name Freelens v2 as the reference, with T0.7: ROADMAP, with the plan of D10 in its releases, ARCHITECTURE, TESTING, the README of the project, AGENTS.md with its section of the host facts written again for v2, RECON-T0.1, DEPENDENCY-AUDIT, LOCAL-STORAGE and TRY-IT. The headers of SPEC-0013 and SPEC-0014, approved and to be implemented on v2, name the v2 target. No document but the history of the evidence names Freelens 1.10.3 as the reference | HOST-22 |
| REQ-218 | PROCESS has a host drift watch: until Freelens 2.0.0 is released, the main branch of the host and the one of the template are read before every slice and before every merge. A change to what the extension uses is taken in before the slice goes on, with the pin of the validation target moved and recorded in this spec | HOST-23 |
| REQ-219 | The specs of M1 to M3 and SPEC-0013 name the v2 target and carry the evidence of v2: the header of each names the commit of the validation target, and its evidence names the run on v2 that made its checks green, with the counts and every deviation with its approval. A check that cannot pass on v2 as it is written is a deviation recorded with its reason, never a check left out | HOST-24 |
| REQ-220 | The pre-review runs on Freelens v2 in both themes, at the sizes of the window and the zoom TESTING names, with its report and a gallery of the views for the review gate. The lead maintainer reviews the move as the end of a milestone is reviewed, and the review is recorded by role and date before T3.3 resumes | HOST-25 |

## Design

- **Standard or ad hoc view, and why.** Nothing of this spec is a view. Every
  view stays the one its spec chose, native or purpose-built, for the reasons that
  spec gives. What the operator sees change is the Custom Resources tree of the
  host, which leaves out the five kinds that have pages in the group of Velero,
  and an error of a view, which stays in its view.
- **Safety.** The writes do not change: a DownloadRequest and a ServerStatusRequest,
  through the gate of SPEC-0009, with its confirmation, and nothing else. They
  reach the API server through the proxy of Freelens, as the identity of the
  connection of the host, in place of a client of the extension. The reads of the
  route and of the views are the ones of before. The tunnel is a kubectl the main
  process runs for one download, through the same proxy. The suites count on the
  API server, as they do on v1, what was created and what was read.

### What The Host And The Template Say

Read in the source of the host at the validation target and of the template at
`e9881f92d17683cec534a848ffd396db1fab6212`. Nothing was run.

| Fact | Source |
| --- | --- |
| `engines.freelens` is the only gate, checked at discovery before any code of an extension runs: its major and minor are read as `^major.minor` against the version of the host, which is the version of the core with its prerelease taken off. A range that does not include it is incompatible: the Extensions page says Incompatible and offers no command to enable it, and the loader loads only an extension that is compatible and enabled. Freelens 1.10.3 makes the same check and loads the same way | [The contract](https://github.com/freelensapp/freelens/blob/5e1870e97467edab81b856a4983483d0729db896/docs/extensions/api.md#L943-L975), [the check](https://github.com/freelensapp/freelens/blob/5e1870e97467edab81b856a4983483d0729db896/packages/core/src/extensions/extension-discovery/is-compatible-extension/is-compatible-extension.ts#L15-L42), [the version](https://github.com/freelensapp/freelens/blob/5e1870e97467edab81b856a4983483d0729db896/packages/core/src/common/vars/extension-api-version.injectable.ts#L11-L17), [the page](https://github.com/freelensapp/freelens/blob/5e1870e97467edab81b856a4983483d0729db896/packages/core/src/renderer/components/extensions/installed-extensions.tsx#L45-L51), [no command](https://github.com/freelensapp/freelens/blob/5e1870e97467edab81b856a4983483d0729db896/packages/core/src/renderer/components/extensions/installed-extensions.tsx#L158), [the loader](https://github.com/freelensapp/freelens/blob/5e1870e97467edab81b856a4983483d0729db896/packages/core/src/extensions/extension-loader/extension-loader.ts#L558), [the check of 1.10.3](https://github.com/freelensapp/freelens/blob/3da74415bff57a77c6e08cb5f538191ce87bac17/packages/core/src/extensions/extension-discovery/is-compatible-extension/is-compatible-extension.ts#L15-L42), [its page](https://github.com/freelensapp/freelens/blob/3da74415bff57a77c6e08cb5f538191ce87bac17/packages/core/src/renderer/components/extensions/installed-extensions.tsx#L52), [its loader](https://github.com/freelensapp/freelens/blob/3da74415bff57a77c6e08cb5f538191ce87bac17/packages/core/src/extensions/extension-loader/extension-loader.ts#L337) |
| Installing by name takes the version or the npm tag that is named, and with neither the newest version that is not a prerelease, without reading its `engines` | [Install by name](https://github.com/freelensapp/freelens/blob/5e1870e97467edab81b856a4983483d0729db896/packages/core/src/renderer/components/extensions/attempt-install-by-info.injectable.tsx#L105-L148) |
| The installer only extracts a tarball: what the code needs and the host does not provide is bundled. The SDK is a devDependency, and so is Electron, for its types. React, its DOM, its JSX runtime, MobX, the bindings of MobX for React and the editor are taken from `FreelensExtensionApi`, and the main process provides MobX alone | [The manifest](https://github.com/freelensapp/freelens/blob/5e1870e97467edab81b856a4983483d0729db896/docs/extensions/migrating-from-v1.md#L110-L125), [the libraries of the host](https://github.com/freelensapp/freelens/blob/5e1870e97467edab81b856a4983483d0729db896/docs/extensions/migrating-from-v1.md#L127-L184) |
| The template builds in two runs of Vite, the renderer for the browser with a plugin that fails on a module of Node or Electron, the main process for Node with Electron and Node external, and writes one stylesheet. pnpm refuses a library shared with the host outside the peer range of the SDK. A bundled library the code imports belongs in `dependencies`, which the production pass of knip counts; a devDependency the bundles import is reported there as unlisted. Biome refuses the test-only helpers of React outside the tests | [The runs](https://github.com/freelensapp/freelens-example-extension/blob/e9881f92d17683cec534a848ffd396db1fab6212/vite.config.mjs#L19-L60), [one stylesheet](https://github.com/freelensapp/freelens-example-extension/blob/e9881f92d17683cec534a848ffd396db1fab6212/vite.config.mjs#L94-L111), [strict peers](https://github.com/freelensapp/freelens-example-extension/blob/e9881f92d17683cec534a848ffd396db1fab6212/pnpm-workspace.yaml#L16-L19), [knip](https://github.com/freelensapp/freelens-example-extension/blob/e9881f92d17683cec534a848ffd396db1fab6212/AGENTS.md#L728-L733), [its configuration](https://github.com/freelensapp/freelens-example-extension/blob/e9881f92d17683cec534a848ffd396db1fab6212/knip.jsonc#L49-L60), [the skill](https://github.com/freelensapp/freelens-example-extension/blob/e9881f92d17683cec534a848ffd396db1fab6212/skills/create-freelens-extension/SKILL.md#L242-L244), [the lint rule](https://github.com/freelensapp/freelens-example-extension/blob/e9881f92d17683cec534a848ffd396db1fab6212/biome.jsonc#L113-L159), [the manifest](https://github.com/freelensapp/freelens-example-extension/blob/e9881f92d17683cec534a848ffd396db1fab6212/package.json#L10-L21) |
| A catalog cluster is reached through the host in both processes, `KubeJsonApi.forCluster` by path, through the proxy of Freelens, which authenticates with the kubeconfig of the cluster, credential plugins included, and applies the proxy setting of the cluster. A client built from `kubeConfigPath` goes around it. Header names must be lowercase. A failed call rejects with the `Status` body of a GET refused with 403, with a parsed error otherwise, and with the error of the fetch when no answer came, none of them an `Error` but the last. The proxy does not look at the state of the cluster: a request to a disconnected cluster starts its proxy and is answered, so the state is read first | [Reaching a catalog cluster](https://github.com/freelensapp/freelens/blob/5e1870e97467edab81b856a4983483d0729db896/docs/extensions/migrating-from-v1.md#L1148-L1313) |
| `getResponse` gives the answer whatever its status; the other calls parse it and reject when it is not 2xx. A query is written by `node:querystring`, which writes a key with no value for a value that is undefined: the API server reads it as true for a boolean, an open issue of the host (freelensapp/freelens#2759) | [The query](https://github.com/freelensapp/freelens/blob/5e1870e97467edab81b856a4983483d0729db896/packages/utility-features/json-api/src/json-api.ts#L7), [`getResponse`](https://github.com/freelensapp/freelens/blob/5e1870e97467edab81b856a4983483d0729db896/packages/utility-features/json-api/src/json-api.ts#L139-L157), [the other calls](https://github.com/freelensapp/freelens/blob/5e1870e97467edab81b856a4983483d0729db896/packages/utility-features/json-api/src/json-api.ts#L199-L254) |
| From the main process a request goes to the proxy of Freelens with the host `<clusterId>.<authority>`; from the renderer it goes, through Chromium, to `https://<clusterId>.<authority>`. Its answer is a structural `FetchResponse`, with its status, its headers and its body, and not a `Response` of the DOM | [Main](https://github.com/freelensapp/freelens/blob/5e1870e97467edab81b856a4983483d0729db896/packages/core/src/main/k8s/cluster-api-address.injectable.ts#L13-L23), [renderer](https://github.com/freelensapp/freelens/blob/5e1870e97467edab81b856a4983483d0729db896/packages/core/src/renderer/k8s/cluster-api-address.injectable.ts#L11-L23), [the types](https://github.com/freelensapp/freelens/blob/5e1870e97467edab81b856a4983483d0729db896/docs/extensions/migrating-from-v1.md#L1087-L1124) |
| `Main.Util.fetch` follows the proxy preference and the certificate preferences of Freelens, and drops a dispatcher it is given | [Its preferences](https://github.com/freelensapp/freelens/blob/5e1870e97467edab81b856a4983483d0729db896/docs/extensions/migrating-from-v1.md#L1045-L1050), [the dispatcher](https://github.com/freelensapp/freelens/blob/5e1870e97467edab81b856a4983483d0729db896/docs/extensions/migrating-from-v1.md#L1078-L1083) |
| `Main.Shell` gives, for a connected cluster, the kubectl Freelens runs for it, which it may download for the version of the cluster, and an environment whose `KUBECONFIG` reaches the cluster through Freelens, with the proxy setting of the cluster. It rejects a cluster that is not there or not connected; a disconnect removes the files of the environment, and a reaction on the state of the cluster tells it. A process an extension runs is given an explicit environment and an explicit working directory | [C15](https://github.com/freelensapp/freelens/blob/5e1870e97467edab81b856a4983483d0729db896/docs/extensions/api.md#L992-L1084), [`getKubectlPath`](https://github.com/freelensapp/freelens/blob/5e1870e97467edab81b856a4983483d0729db896/packages/core/src/extensions/main-api/shell.ts#L55-L84), [`getEnvironment`](https://github.com/freelensapp/freelens/blob/5e1870e97467edab81b856a4983483d0729db896/packages/core/src/extensions/main-api/shell.ts#L119-L152), [a process](https://github.com/freelensapp/freelens/blob/5e1870e97467edab81b856a4983483d0729db896/docs/extensions/binaries.md#L42-L54) |
| `getAllClusters()` and `getClusterById()` of the catalog are observable in both processes; an entry has its identifier, its name, its kubeconfig path, its context name and its state, connecting, connected, disconnected or disconnecting | [C5](https://github.com/freelensapp/freelens/blob/5e1870e97467edab81b856a4983483d0729db896/docs/extensions/api.md#L344-L390), [the entry](https://github.com/freelensapp/freelens/blob/5e1870e97467edab81b856a4983483d0729db896/packages/core/src/extensions/common-api/cluster-types.ts#L13-L18), [its fields](https://github.com/freelensapp/freelens/blob/5e1870e97467edab81b856a4983483d0729db896/packages/core/src/extensions/common-api/cluster-types.ts#L57-L67) |
| `Main.Ipc.handle` types the event of its handler as the `IpcMainInvokeEvent` of Electron, which an extension names by importing its type from `electron`. The listener of `Renderer.Ipc` gets an event typed `unknown`, which it leaves alone. The host resets the instance of either with the disposers of the extension, which a disable runs after `onDeactivate` | [`handle`](https://github.com/freelensapp/freelens/blob/5e1870e97467edab81b856a4983483d0729db896/packages/core/src/extensions/ipc/ipc-main.ts#L72-L88), [the type](https://github.com/freelensapp/freelens/blob/5e1870e97467edab81b856a4983483d0729db896/docs/extensions/migrating-from-v1.md#L1511-L1517), [`listen`](https://github.com/freelensapp/freelens/blob/5e1870e97467edab81b856a4983483d0729db896/packages/core/src/extensions/ipc/ipc-renderer.ts#L24-L59), [the event](https://github.com/freelensapp/freelens/blob/5e1870e97467edab81b856a4983483d0729db896/docs/extensions/migrating-from-v1.md#L1591-L1603), [reset in main](https://github.com/freelensapp/freelens/blob/5e1870e97467edab81b856a4983483d0729db896/packages/core/src/extensions/ipc/ipc-main.ts#L37), [in the renderer](https://github.com/freelensapp/freelens/blob/5e1870e97467edab81b856a4983483d0729db896/packages/core/src/extensions/ipc/ipc-renderer.ts#L21), [the disable](https://github.com/freelensapp/freelens/blob/5e1870e97467edab81b856a4983483d0729db896/packages/core/src/extensions/lens-extension.ts#L95-L110) |
| The frame of a cluster is its own origin, `https://<clusterId>.renderer.freelens.app`, which the packaged application writes with the port of its proxy, `https://<clusterId>.renderer.freelens.app:<port>`, and the host reads the identifier of the cluster from that host, once the port is taken off | [The origin](https://github.com/freelensapp/freelens/blob/5e1870e97467edab81b856a4983483d0729db896/packages/core/src/features/extensions/loader/main/register-scheme-as-privileged.injectable.ts#L27-L30), [the rule](https://github.com/freelensapp/freelens/blob/5e1870e97467edab81b856a4983483d0729db896/packages/core/src/common/utils/cluster-id-url-parsing.ts#L14-L27), [the window](https://github.com/freelensapp/freelens/blob/5e1870e97467edab81b856a4983483d0729db896/packages/core/src/main/start-main-application/lens-window/application-window/create-application-window.injectable.ts#L38), [the frame](https://github.com/freelensapp/freelens/blob/5e1870e97467edab81b856a4983483d0729db896/packages/core/src/common/utils/cluster-id-url-parsing.ts#L34-L36) |
| Renderer code has no guarantee of Node or Electron, which it reaches only because the renderer has no isolation of its context. The view of the container of the host kept for an extension is no security boundary. All the extensions share one origin, since an origin for each would promise an isolation the host does not give | [The renderer](https://github.com/freelensapp/freelens/blob/5e1870e97467edab81b856a4983483d0729db896/docs/extensions/api.md#L177-L185), [the container](https://github.com/freelensapp/freelens/blob/5e1870e97467edab81b856a4983483d0729db896/docs/extensions/api.md#L578-L585), [the origin](https://github.com/freelensapp/freelens/blob/5e1870e97467edab81b856a4983483d0729db896/docs/extensions/api.md#L1088-L1096) |
| A `KubeApi` an extension creates registers itself with the host unless told not to. The host registers an API and a store for every version of a CRD the cluster serves, after the frame of the cluster has loaded the CRDs, so a component that reads them is an `observer` | [The registration](https://github.com/freelensapp/freelens/blob/5e1870e97467edab81b856a4983483d0729db896/packages/core/src/extensions/common-api/k8s-api.ts#L69-L96), [the stores of the host](https://github.com/freelensapp/freelens/blob/5e1870e97467edab81b856a4983483d0729db896/docs/extensions/migrating-from-v1.md#L1406-L1447) |
| A registered component gets only the props the host renders it with: a page its parameters. `detailsFor` and `menuItemFor` tie a component to its kind, which the literals of `kind` and `apiVersion` make strict. `customResources` takes the kinds with pages of their own out of the Custom Resources tree while the extension is enabled, and nothing else | [The props](https://github.com/freelensapp/freelens/blob/5e1870e97467edab81b856a4983483d0729db896/docs/extensions/api.md#L407-L412), [the helpers](https://github.com/freelensapp/freelens/blob/5e1870e97467edab81b856a4983483d0729db896/docs/extensions/api.md#L422-L482), [`customResources`](https://github.com/freelensapp/freelens/blob/5e1870e97467edab81b856a4983483d0729db896/docs/extensions/api.md#L484-L508) |
| The host gives a page the tabs of its group when the first entry of the sidebar that leads to the page has a parent, as on v1. The address of a page is `/extension/<name>/<page>`, the name without `@` and with `/` as `--` | [The tabs](https://github.com/freelensapp/freelens/blob/5e1870e97467edab81b856a4983483d0729db896/packages/core/src/renderer/routes/extension-route-registrator.injectable.tsx#L86-L106), [the address](https://github.com/freelensapp/freelens/blob/5e1870e97467edab81b856a4983483d0729db896/packages/core/src/renderer/routes/for-extension.ts#L11-L19) |
| `Renderer.Component.VirtualList` is removed: an extension renders a plain list or bundles a virtualizer of its own, react-window included. The host itself is built with react-window 2.3.4 | [The removal](https://github.com/freelensapp/freelens/blob/5e1870e97467edab81b856a4983483d0729db896/docs/extensions/migrating-from-v1.md#L1499-L1507), [the catalog](https://github.com/freelensapp/freelens/blob/5e1870e97467edab81b856a4983483d0729db896/pnpm-workspace.yaml#L121) |
| MobX 7 takes standard decorators only: a decorated field is an `accessor`, `observable.ref` is `observableRef`, and a class whose instances are serialized keeps plain fields with an annotation map. The props of an `observer` class are read in its render only | [MobX 7](https://github.com/freelensapp/freelens/blob/5e1870e97467edab81b856a4983483d0729db896/docs/extensions/migrating-from-v1.md#L270-L387) |
| The host links the one stylesheet a build writes next to the renderer entry, so an extension needs no `<style>` of its own. The global classes of the components of the host are part of its API, and an extension may target them | [Styling](https://github.com/freelensapp/freelens/blob/5e1870e97467edab81b856a4983483d0729db896/docs/extensions/migrating-from-v1.md#L1842-L1890) |
| The store of an extension stops saving when the extension is disabled, and is used again when it is enabled | [The store](https://github.com/freelensapp/freelens/blob/5e1870e97467edab81b856a4983483d0729db896/packages/core/src/extensions/base-extension-store.ts#L82-L109) |
| The template wraps every page, section of the details and menu item in an error boundary of its own, since the host has none around the drawer of the details or a menu item | [The boundaries](https://github.com/freelensapp/freelens-example-extension/blob/e9881f92d17683cec534a848ffd396db1fab6212/src/renderer/components/error-boundary.tsx#L65-L131), [their use](https://github.com/freelensapp/freelens-example-extension/blob/e9881f92d17683cec534a848ffd396db1fab6212/src/renderer/index.tsx#L30-L89) |
| The template builds Freelens from source for its integration test, at `main`, and caches the build by the commit it was made from. Its unit tests run on a stub of the SDK, with Testing Library 16 | [The ref](https://github.com/freelensapp/freelens-example-extension/blob/e9881f92d17683cec534a848ffd396db1fab6212/.github/workflows/integration-tests.yaml#L26-L29), [the cache](https://github.com/freelensapp/freelens-example-extension/blob/e9881f92d17683cec534a848ffd396db1fab6212/.github/workflows/integration-tests.yaml#L115-L166), [the stub](https://github.com/freelensapp/freelens-example-extension/blob/e9881f92d17683cec534a848ffd396db1fab6212/vitest.config.ts#L29-L37), [Testing Library](https://github.com/freelensapp/freelens-example-extension/blob/e9881f92d17683cec534a848ffd396db1fab6212/package.json#L69-L70) |
| The tag workflow of the template tags a prerelease version too, and its release workflow marks the GitHub release of a prerelease as a prerelease. The tag workflow of this repository tags `X.Y.Z` alone; its release workflow already publishes a version with a hyphen on `next` | [Tag](https://github.com/freelensapp/freelens-example-extension/blob/e9881f92d17683cec534a848ffd396db1fab6212/.github/workflows/tag.yaml#L42), [release](https://github.com/freelensapp/freelens-example-extension/blob/e9881f92d17683cec534a848ffd396db1fab6212/.github/workflows/release.yaml#L164), [this tag](https://github.com/freelensapp/freelens-velero-extension/blob/224315ce6f7545c16cf2ba49718e416fa016dcbe/.github/workflows/tag.yaml#L42), [this release](https://github.com/freelensapp/freelens-velero-extension/blob/224315ce6f7545c16cf2ba49718e416fa016dcbe/.github/workflows/release.yaml#L85-L86) |

### D1: The API Server From The Main Process

**Decision.** Every request of the create-only adapter goes through
`Main.K8sApi.KubeJsonApi.forCluster(clusterId)`: the creation of a DownloadRequest
or of a ServerStatusRequest, and the reads that go with it, the target, its
backup, its storage location, the Secret of its certificate, the Service, the
endpoint slices and the Pod of the route, and the request read back and polled.
The extension deletes no request, as REQ-135 of SPEC-0010 and REQ-153 of SPEC-0012
say, so the adapter has no cleanup to send: the server removes what it processed.
Before every request the main process reads the entry of the cluster in
`Main.Catalog` and refuses one that is not connected. The adapter reads the
status of every answer, normalizes what a call rejects with, writes its header
names in lowercase, sends no query parameter without a value, and keeps its own
deadline and its bound on the size of an answer.

**Why.** The client the extension built from the kubeconfig of the user goes
around the proxy of Freelens: it ignores the proxy setting of the cluster, runs
credential plugins a second time and in a second process, and refuses kinds of
authentication the host takes. The reason the recon gave for it, that `Main.K8s`
of v1 had no creation, is gone: `KubeJsonApi.forCluster` posts any object, by
path, in the main process as in the renderer. A request to a cluster that is not
connected would start its proxy, and with it an authentication the operator did
not ask for. The client of the host has no deadline of its own, and parses an
answer whole before it gives it.

**What goes.** The [identity of a context](https://github.com/freelensapp/freelens-velero-extension/blob/224315ce6f7545c16cf2ba49718e416fa016dcbe/src/main/context-identity.ts):
the read of the kubeconfig, its digest, the credential plugins and the kinds of
authentication it refused. The HTTPS client of the
[adapter](../../src/main/diagnostic-kubernetes.ts), with its keep-alive agent.
The deep imports of `@kubernetes/client-node`, and the stub of undici that kept
the client from installing a dispatcher in the host.

**Amendments, made by the pull request of T0.7 in the same pull request:**

| Requirement | Today | With this spec |
| --- | --- | --- |
| REQ-114 of SPEC-0009 | The main process takes the path of the kubeconfig and the name of the context from the entry of the catalog; the adapter is made for them | The main process takes the identifier of the cluster and its state from the entry of the catalog; the adapter is the client of the host for that identifier. An entry that is not there or not connected refuses the request, and no default kubeconfig, current context or shown cluster is ever taken in its place, as before |
| REQ-115 of SPEC-0009 | The adapter runs the plugin a context names for its credential, and refuses an authentication provider, a proxy, a user name and a password, and TLS turned off | Superseded. The proxy of Freelens authenticates as the connection of the host does, plugins included; the extension runs no plugin and refuses no kind of authentication. Scenario 6 of SPEC-0009 and GATE-08 are restated as the scenario 9 of this spec |
| REQ-116 of SPEC-0009 | The identity of a cluster is the entry of its context, read from the file before every request and compared by its digest | Superseded. The identity is the entry of the catalog by its identifier, with its kubeconfig path and its context name as the catalog gives them, and its state; the file is not read. GATE-09 is restated: a change of the path or of the context name, or a state that is not connected, turns writes off |
| REQ-136 of SPEC-0010 | Items of the connection of the adapter: one keep-alive agent for each adapter, an API server at an IPv6 address, the identity of the context of SPEC-0009, a token no header takes and a certificate with a key that is not its own, and a creation refused before the connection said not sent | These items go with the connection of the adapter, and their tests with them. A creation that got no answer is reconciled by its name, as an unknown submission: the extension does not see the connection of the host, and cannot tell a creation that was not sent from one whose answer was lost |

### D2: The Tunnel To The Object Store

**Decision.** The tunnel of the route of REQ-129 of SPEC-0010 is
`kubectl port-forward --address 127.0.0.1 --namespace <namespace> pod/<pod> :<port>`,
run by the main process with `node:child_process`, with the kubectl
`Main.Shell.getKubectlPath(clusterId)` gives, the environment
`Main.Shell.getEnvironment(clusterId)` gives as its whole environment, and the
folder of the extension as its working directory. The route finds the Pod and its
port as before, from the Service, its endpoint slices and the Pod, read through
D1. kubectl is prepared first, then started; the tunnel is ready when kubectl
writes `Forwarding from 127.0.0.1:<port>`, and the port of that line is the port
of the socket of the transport. The wait for the line is fifteen seconds, counted
once kubectl is prepared, inside the bound of the whole operation. A signal aborts
the opening at every step. kubectl is killed when its operation ends, on a
cancel, in `onDeactivate`, when the main process exits, and when a reaction on the
state of the cluster in the catalog sees it leave the connected state. A refusal of
`create` on `pods/portforward` is its own state, forbidden at the step of the
port-forward.

**Why.** The environment of `Main.Shell` points kubectl at the proxy of Freelens,
so a credential plugin runs once, in that proxy, and never in the kubectl of the
extension, and the proxy setting of the cluster applies. kubectl is the one the
host runs for the cluster, prepared by the host. The port-forward of
`@kubernetes/client-node` and `ws` leave the bundle, and with them the last
client of the extension. kubectl reads the Pod and opens the stream to the API
server before it writes its line of readiness, which is why the line is the
signal and why a refusal of the API server ends kubectl before it. The
preparation may download a kubectl, which is why the wait for readiness starts
after it. The files of the environment exist only while the cluster is connected,
which is why the tunnel follows the state of the cluster.

**What the transport sees.** A port-forward carries the bytes of one TCP
connection and changes none: the host, the server name of TLS, the path and the
query of the signed URL reach the store as the transport writes them, as they did
through the listener of v1.

**What changes for the operator.** The listener of the loopback is kubectl's: it
takes every connection of this machine to its port while it is open, where the
listener of v1 took one. It is open for one download and closed after it. A
process of this machine that finds its port in that time reaches the store with
the permissions of the identity, which a process of the same user can have with
the kubeconfig of the user anyway. The first download of a kubectl for the
version of a cluster counts toward the 120 seconds of the operation: on a slow
link that first load may end at the step of the route, and the next finds the
kubectl in place.

**Amendments, made by the pull request of T0.7 in the same pull request:**

| Requirement | Today | With this spec |
| --- | --- | --- |
| REQ-129 of SPEC-0010 | A port-forward the extension opens through the API server to the Pod, with the identity of the kubeconfig, on a listener of the loopback for one connection, closed with the operation | The port-forward is the kubectl of D2, through the proxy of Freelens, with the identity of the connection of the host; its listener is kubectl's, on `127.0.0.1`, and is closed with the operation. The Service, the port, the endpoint slices and the Pod are found as before |
| REQ-137 of SPEC-0010 | The permissions of the tunnel, `get` on services and pods, `list` on endpointslices and `create` on `pods/portforward`, as the client of v1 asks them; the identities of the demo refused at their step | The permissions are the ones the kubectl of the host asks, proven with the identities of the test environment, and the list of the architecture follows them where they differ. The permission of the port-forward is `create` on `pods/portforward`, which every kubectl uses: kubectl 1.31 and later asks `get` first, over a WebSocket, and falls back to `create` when it is refused, so `get` is asked first and not needed. The permission the documentation lists for the tunnel is `create` on `pods/portforward`; with kubectl 1.31 and later a refused `get` may show in the audit log of the cluster before the fallback, and an operator who wants to avoid it grants `get` as well. The identities of the test environment: the downloader, with `create` alone, forwards; the router, with neither verb, is refused at the port-forward, where the last words of kubectl name `create`. The other identities are refused at the same steps |

### D3: The Transport

**Decision.** The contract of SPEC-0010 stays as it is: Node `http` and `https`,
the inline certificate and `caCertRef`, no redirect followed, the bounds of size
and of time, the redaction of the URL, the signed path, the host and the server
name kept. Through the tunnel the socket goes to the port kubectl gives. A direct
download keeps Node `https`, not `Main.Util.fetch`.

**Why.** The rules of REQ-128 resolve a name once, check every address in its
canonical form and connect to the address that is allowed, with the host and the
server name of the URL. Only a client that is given the address can do that, and
`Main.Util.fetch` drops a dispatcher and resolves names itself. The trust of
REQ-131 adds the certificate of one storage location to one request, a redirect is
refused, and the bytes are counted as they arrive and stopped at the bound: each is
a control of the request, which a client shared with the host does not give.

**Known limit, recorded.** A direct download follows neither the proxy preference
nor the certificate preferences of Freelens, as on v1: a store reached from this
machine only through a proxy is not reached, and its words say that the store was
not reached. A download through the tunnel is not concerned: it goes through the
proxy of Freelens, with the proxy setting of the cluster. The documentation of
v1.0.0 says so.

### D4: The Reads Of The Views

**Decision.** The [reader](../../src/renderer/api/reader.ts) asks through
`Renderer.K8sApi.KubeJsonApi.forCluster(clusterId).getResponse(path, undefined, { method: "GET", signal })`,
for the cluster of its frame, and reads `status` and `text()` of the answer. Its
rule on the paths, the kinds of Velero and nothing else, and its states, from the
status and never from a text, stay. It creates no `KubeApi`.

**Why.** The reader of v1 took the client of a `KubeApi` it created, a member the
SDK of v2 declares protected, through a cast. `KubeJsonApi.forCluster` is public
and answers whatever the status. The answer is a structural `FetchResponse`, not
a `Response` of the DOM, and its headers are read through `headers.get`, which
REQ-166 of SPEC-0013 may use for the time of the API server. A `KubeApi` the
extension creates registers itself with the host, and an API an extension
registered stays after its CRD is deleted.

**A host fact that changes.** On v1 the requests of the host left from its main
process. On v2 the reads of the views leave from the renderer, through Chromium,
to the origin of the frame. The guard of the suites counts them on the API
server, as it does today, and AGENTS.md says the new fact.

### D5: The Way Between The Processes

**Decision.** The thirteen channels stay, on a subclass of `Main.Ipc` and one of
`Renderer.Ipc`, each created in `onActivate` and reset in `onDeactivate`; the host
resets them again with the disposers of the extension, which is harmless. The
event of a handler is typed by importing `IpcMainInvokeEvent` from `electron` as a
type, and the binding of REQ-113 of SPEC-0009 reads its frame: the cluster is the
first label of the host of the address of the frame, `<clusterId>.renderer.freelens.app`
in the packaged application and `<clusterId>.localhost` in development, by the
rule of the host. The identifier a request names must be that cluster and an
entry of `Main.Catalog`, connected. A listener of the renderer reads the arguments
of a broadcast and never the event.

**Why.** The frame of a cluster has the same origin on v2 as on v1, and the event
of `Main.Ipc` is still the one of Electron, so the binding stands as it is. The
type of the event is `any` in a program that does not load the types of Electron,
which the import of the type closes. The event a listener of the renderer gets is
not a contract. A local HTTP server in the main process, which some extensions
use for streams, would add a token, an origin to check and a port to keep, for
procedures that are calls and answers: the text of an artifact is already given in
pages, and a cancel is already a procedure.

**The trust model, which ARCHITECTURE states.** The boundary of v2 is between the
extensions and the application, not between extensions. The renderer has no
isolation of its context, every extension shares one origin, and the view of the
container of the host is no security boundary. The binding proves that a request
came from the frame of that cluster, not that the code of this extension sent it.
The main process enforces what it can see: the frame, the cluster, the namespace,
the token of a confirmation, and the bounds. This was true on v1 as well; v2 says
it.

### D6: The Manifest And The Build

**Decision.** As the template of today: `engines.freelens` `^2.0.0`; `"type": "module"`;
the entries in `dist/`; the exact pin of the SDK until Freelens 2.0.0; the
libraries of the host as devDependencies at the versions of its catalog, for
their types; react-window in `dependencies`; Vite 8 in two runs with the plugins
of the template, the libraries of the host never bundled, one `dist/renderer.css`;
the programs of TypeScript of the template, one for each process, one for the
tests, and its environment tests; pnpm 12 with strict peer dependencies; the lint
rule on the test-only helpers of React; Renovate following the catalog of the host
as the configuration of the template does.

**What goes.** electron-vite and its preload target, the
[map of the globals of v1](https://github.com/freelensapp/freelens-velero-extension/blob/224315ce6f7545c16cf2ba49718e416fa016dcbe/build/host-globals.ts), the two forms of the
build and their two runs of the unit tests, the `<style>` the views inject, the
`paths` to the declarations of `@freelensapp/core`, and the rule that held React
at 17.

**What is written again.** The stylesheet is imported as a module for its class
names, and the host links it. Its 54 selectors on the classes of the components of
the host, which the host publishes as part of its API, and its 17 theme variables
are checked against v2 by the pre-review; the ones on the virtual list go with D8. The scripts of the test environment, which Node runs by stripping
their types and which name the files they import with `.ts`, keep a program of
their own, and the imports of the main process lose the extension.

**Why.** The host refuses a manifest of v1 before any code runs, and loads an ESM
renderer from its own scheme, with nothing on `global`. The template is what the
host is tested with, and what Renovate keeps in step with the host. `dependencies`
holds react-window because the production pass of knip in the template reads the
sources, counts only `dependencies`, and reports a devDependency the sources of a
bundle import as unlisted. This replaces the rule of this repository that
`dependencies` stays empty, which the build test pins today: its production pass
reads the compiled bundles, where a bundled library leaves no import. The
installer installs nothing, either way.

### D7: The Registrations

**Decision.** Each of the five kinds is one `LensExtensionKubeObject` with
`static readonly` metadata, `crd.apiVersions` `["velero.io/v1"]`, and
`declare kind` and `declare apiVersion` as literals. The unused `KubeApi` and
`KubeObjectStore` subclasses go. A store of the host is the one it registers for a
served version, read with `getStore()` inside the render of an `observer`; the
native lists keep the [store of a list](../../src/renderer/state/list-store.ts) of
the extension, which the reader fills, and which the structural type of v2 takes
as it is. `customResources` lists the five kinds. The five sections of the details
are made with `detailsFor`. Every page is registered as
`Page: () => <X extension={this} />` where it needs the extension. Every
registration goes through the error boundaries of the template. The entries of
the sidebar keep their order, the group last. MobX keeps its annotation maps, with
`observableRef`, and a decorated field, where one is added, is an `accessor`; an
`observer` reads its props in its render.

**Why.** Every item is a rule of the template that compiles when it is broken and
breaks at run time, or not visibly at all. `declare` keeps the literals out of the
emitted class, where a field would reset `kind` and `apiVersion` after the
constructor of the host set them. The host has no error boundary around the drawer
of the details, so an error of a section replaces the whole cluster view. The
store of the preferences is serialized by `toJSON`, which is why its fields stay
plain with an annotation map. The order of the sidebar is the one v1 needed for the
tabs of the group, and the rule of the host has not changed.

**What the operator sees change.** The Custom Resources tree of the cluster leaves
out Backups, Restores, Schedules, Backup Storage Locations and Volume Snapshot
Locations while the extension is enabled, and lists them again once it is
disabled. The definitions, the lists of the host and their addresses stay. The
kinds of T5.1 and T5.2 join `customResources` with their pages.

### D8: The Virtual List

**Decision.** The lines of a log and the resources viewer are windowed by
react-window 2, bundled at 2.3.4, the version of the catalog of the host. Its API
is not the one of the list of v1: the measure of a row, the scroll to a row, the
rows kept ready around the room and the focus are written again for it. The
selectors on the classes of the list of v1 and its double in the tests go with it.

**Why.** The host removed the list and names bundling react-window as the way.
The second major is the one the host runs, so Renovate keeps it in step with the
catalog, and its peers take React 19. The other options were weighed:

| Option | Why it is not taken |
| --- | --- |
| react-window 1.8 with the sizer the list of v1 used, and a copy of that list | It copies the implementation of the host, which the directives forbid wholesale, and keeps a major the host left |
| A windowing of the extension's own | More code to prove against the budgets of SPEC-0011, for what a maintained library does |
| The list given back by the host | The host removed it on purpose, so as not to make react-window part of its API, and v1.0.0 would wait on a release of the host |

**Acceptance.** The budgets of REQ-147 of SPEC-0011, measured again in the
packaged Freelens v2 on the log of 200,000 lines, and the measure of the unit run
on 500,000 lines, with the bound of a hundred rows of REQ-142.

### D9: The Tests

**Decision.** The unit and component tests run on the stub of the SDK of the
template, grown as the tests need, with Testing Library 16 and its DOM library on
React 19. The [stub](../../test/freelens-extensions.ts) and the
[doubles of the components](../../test/host-components.tsx) are written again from
the source of the host at the commit of the validation target, each with the file
and line it follows. The suites of the views and FND-10 run in a Freelens built
from source at that commit, in CI, with the build cached by the commit; on a
machine of a developer they run on the nightly application of the same commit,
checked against its published checksum. The integration test of the template runs
beside them, with a session for each of the five kinds. The transport proof of
T0.6 keeps its four modes, with stand-ins of the host for `Main.K8sApi` and
`Main.Shell` made from the isolated kubeconfig of the test environment: what the
host adds, its proxy and its kubectl, is proven by the packaged suites.

**FND-10 on v2.** It keeps what it proves: the tarball installed from the
Extensions page, the extension listed as Enabled, both entries loaded with no
error of the host, the bundle of the main process downloading an artifact inside the main
process of the host with the signed query and the host kept, a 404 said as a
missing artifact, another origin refused, and the dispatcher of the host
untouched. How it reaches the bundle inside the host is written again: the
introspection of the cache of modules of v1 has no counterpart for an ESM entry.

**Why.** The real SDK reads the global of a host that a test does not have.
Testing Library 12 calls functions React 19 does not have. The doubles of today
were read in the source map of v1.10.3; a double that keeps the behavior of v1
keeps the tests green while v2 differs. The ref of the host moves until 2.0.0, so
a build cached by a version would serve a stale build.

### D10: The Version And The Release

**Decision, by the lead maintainer on 2026-10-16.** The version line is 1.0.0.
Prereleases, `1.0.0-N`, are published on the npm tag `next` and released on
GitHub as prereleases. 1.0.0 is published on `latest` only after Freelens 2.0.0 is
released and M6 is done. At Freelens 2.0.0 the pin of the SDK becomes a range of
versions and the integration runs at the tag v2.0.0, as work of M6.

**What follows from it.** The tag workflow tags a prerelease version as the one
of the template does, and the release workflow marks the GitHub release of a
prerelease as a prerelease: the pull request of T0.7 carries both, and the sentence
of PROCESS that says that only `X.Y.Z` is tagged changes with them. Main moves to
the line through the pull request of the version workflow, as PROCESS asks of every
change of the version; once merged, that pull request tags the version and the
release workflow publishes it. It is opened when the lead maintainer asks for the
first prerelease; until then main keeps its version. A prerelease is installed by
its tag, `@freelensapp/velero-extension@next`, or by its version.

**Why.** Installing by name takes the newest version that is not a prerelease and
does not read `engines`: a 1.0.0 on `latest` before Freelens 2.0.0 would be
offered to every user of Freelens 1, where it is Incompatible. A prerelease on
`next` is installed only by those who ask for it.

### D11: The Documents And The Process

**Decision.** With T0.7 the reference of compatibility becomes Freelens v2 in the
ROADMAP, ARCHITECTURE, TESTING, the README of the project, AGENTS.md and RECON-T0.1,
and DEPENDENCY-AUDIT, LOCAL-STORAGE and TRY-IT follow. In AGENTS.md the validation
target, the CRD pattern, the dependencies the host provides, the rule on direct
tunnels and the section of the host facts are written again for v2; a host fact
that is not proven again on v2 is removed. PROCESS gains a host drift watch, beside
the upstream drift watch of Velero: until Freelens 2.0.0 is released, the main
branch of the host and the one of the template are read before every slice and
before every merge, and a change to what the extension uses is taken in first.

**Why.** Both move until Freelens 2.0.0. The template had 37 commits on its main
branch from 2026-10-09 to 2026-10-15, seven of them to its sources or its build,
and on 2026-10-15 the host removed `Renderer.Util.fetch` from its API, in its
commit `c4dd00e2`. A slice built on a stale reading of either is built on a host
that is gone.

### The Order Of T0.7

One pull request, so that main is never between v1 and v2. Its commits follow
this order, and each says which part it is:

1. The manifest, the toolchain and the build (D6).
2. The mechanical migration: the 59 sites of the surface check.
3. The main process: the client of the host (D1), the tunnel (D2), the dialog
   taken when a file is saved, the transport as it is (D3).
4. The way between the processes (D5).
5. The stores and the registrations, with the reader (D4, D7).
6. The components and the styles, with the virtual list (D8).
7. The error boundaries (D7).
8. The unit tests (D9).
9. The packaged suites and the integration test (D9).
10. CI: the workflows of the views and of the integration at the commit of the
    validation target, and the tag and release workflows of D10.
11. The documents (D11), with the amended requirements of D1.

The pull request is reviewed by an independent reviewer before it is opened, as
the slices of M3 and M4 were, and is merged with every check green on v2.

### T0.8

After the merge: every check of SPEC-0002 to SPEC-0012 and the checks of SPEC-0013
that T3.1 and T3.2 made green, which are ADH-01 to ADH-08 at the unit layer and the
measure of the unit run of ADH-16, green on v2 in CI on main; the header and the
evidence of each of those specs moved to v2; the pre-review on both themes with
its report and a gallery; the review of the lead maintainer, recorded by role and
date. T3.3 resumes on v2 after it.

## Tests

Planned homes: the build test, `test/build.test.ts`, and the test of the entry
points, `src/entrypoints.test.ts`, for the manifest, the bundles and the
registrations; the tests of the adapter, of the route, of the tunnel and of the
procedures in `src/main/`, on a fake client of the host and a fake `spawn`; the
test of the reader; the component tests of the lists of lines and of the error
boundaries; the transport proof, `pnpm e2e`; the suites of the views and FND-10 in
the packaged Freelens v2; the integration test of the template; the pre-review.

Fixtures, beside the ones that exist: an identity of the views that may create a
DownloadRequest and read the route, and may neither get nor create
`pods/portforward`; an identity of the views whose kubeconfig takes its token
from an `exec` plugin the test environment ships; for the integration test of
the template, the CRDs of the reviewed release and synthetic objects of the five
kinds, on the disposable kind cluster of its job. No real cluster takes part, and
no fixture holds real data.

| Check | Layer | Requirements | Scenario and expected evidence |
| --- | --- | --- | --- |
| HOST-01 | Packaged, and packaged once on 1.10.3 | REQ-196 | On v2: the tarball installed from the Extensions page is listed as Enabled, both entries load, and neither log of the host has an error of the extension. On Freelens 1.10.3 as released, once, recorded in the evidence: the same tarball is listed as Incompatible, with no command to enable it, and no line of the extension is logged |
| HOST-02 | All layers, CI on main | REQ-197 | The checks of SPEC-0002 to SPEC-0012 and ADH-01 to ADH-08 and the measure of ADH-16 at the unit layer, green on v2; the guard of every suite counting on the API server what it counted on v1 |
| HOST-03 | Build unit | REQ-198 | The build test reads the manifest: the range, the type, the entries, the files, the exact pin, the libraries of the host as devDependencies at the versions of the catalog, react-window alone in `dependencies`. An install with React one patch below the peer range of the SDK fails, seen once |
| HOST-04 | Build unit | REQ-199 | `dist/` holds the two entries, their source maps and `renderer.css`, and nothing else; no bare import of a library of the host and no copy of React or MobX in either bundle; no module of Node and no `require` in the renderer; `dist/main.js` loads under Node with a stand-in of the global of the host, and activates and deactivates; the environment tests fail on a module of Node in the renderer, and the lint rule on `act` in a source file, each seen failing once |
| HOST-05 | Unit/proof/packaged | REQ-200 | On a fake client of the host: every request of the way of a download and of a server status through `forCluster` of the cluster of the request, and nothing else; the bundle with no reader of a kubeconfig, no `@kubernetes/client-node` and no `ws`, and the main process running no process but kubectl. Packaged: a download and a server status counted on the API server as on v1; the identity of the `exec` plugin downloading, with the plugin run by the proxy |
| HOST-06 | Unit/packaged | REQ-201 | An entry that is not there and one in each state that is not connected: refused, with their words, and the fake client asked nothing; writes off when the entry goes, leaves the connected state, or changes its path or its context name. Packaged: the cluster disconnected with a load in flight, then nothing of the extension counted on its API server and the entry still disconnected after a minute |
| HOST-07 | Unit | REQ-202 | A 403 of a read with its `Status` body, a parsed error of 404, 409, 422 and 500, the error of a fetch with no answer: each to its code and stage, none read as an `Error` it is not; a creation with no answer reconciled by its name; every header name of a request in lowercase, which the test of the requests asserts; a query with an undefined value sent with no such key; a request stopped at ten seconds and an answer at 4 MiB |
| HOST-08 | Fake-spawn unit/proof/packaged | REQ-203 | The arguments, the environment and the working directory of kubectl; the port read from its line; the fifteen seconds counted from the end of the preparation and not before; an abort while preparing, and one before the line. Packaged: the loads of the suite of the tabs through the tunnel |
| HOST-09 | Fake-spawn unit/packaged | REQ-204 | kubectl killed at each end of a download, on a cancel, on a deactivation, at the exit of the process and on a disconnection; one that does not exit reported. Packaged: no process of kubectl of the application after the suite of the tabs, after a disable and after a disconnection |
| HOST-10 | Fake-spawn unit/packaged | REQ-205 | kubectl that exits with the refusal of `pods/portforward`, with another error, and that cannot be run: three codes at the step of the port-forward, with nothing of what kubectl wrote in any answer. Packaged: the identity with neither verb on `pods/portforward`, with the words of the tab and no kubectl left |
| HOST-11 | Unit/proof/packaged | REQ-206 | The tests of the transport of SPEC-0010, unchanged and green; the proof in its four modes; packaged: the log of the real backup through the tunnel, which the store would refuse with another host, path or query, and a sentinel of the URL in no output |
| HOST-12 | Unit/packaged | REQ-207 | The reader on a fake `forCluster`: the paths refused, the status and the body of an answer, nothing created and nothing registered with the host. Packaged: the two readers with the states of SPEC-0002 to SPEC-0008, and the identifier of the frame, of the catalog of the renderer and of the catalog of the main process equal |
| HOST-13 | Unit/packaged | REQ-208 | Activated, deactivated and activated again: one handler for each channel, the instances reset. Packaged: a disable and an enable from the Extensions page, then a load: one creation counted, one kubectl, one answer, and the file of the store written once for one change |
| HOST-14 | Unit/packaged | REQ-209 | The rule of the frame on addresses of v2, packaged and in development; an identifier that is not the one of the frame, and one that is not in the catalog, refused. Packaged: GATE-12 on v2, with two frames, and the address of a frame read by a handler of `Main.Ipc`. Review: the trust model in ARCHITECTURE |
| HOST-15 | Unit/packaged | REQ-210 | The test of the entry points: the five classes and their literals, `customResources`, the sections made with `detailsFor`, the pages taking their parameters alone, the order of the sidebar. Packaged: the Custom Resources tree without the five kinds while enabled and with them after a disable, and the tabs of the group on every page |
| HOST-16 | Component/packaged | REQ-211 | A component that throws inside each of the three boundaries, and a cell of the list of the host that throws: the error page in its place, nothing for a menu item, and the log with the name of the extension |
| HOST-17 | Component/packaged | REQ-212 | An `observer` that follows a change of the store of the preferences; the callbacks of the list reading no props outside the render. Packaged: an allowance taken back in the target bar gone from it at once, and a namespace chosen there followed by every page |
| HOST-18 | Component/unit measure/packaged | REQ-213 | At most a hundred rows mounted while a log scrolls, a line whole with its wrap, a match brought into view, the focus on the first line; the measure of the unit run on 500,000 lines; packaged: VIEW-10 on the log of 200,000 lines, within its budgets |
| HOST-19 | Unit | REQ-214 | The unit run on the stub with Testing Library 16, with its files and its count; each double naming the file and line of the host it follows; the build test pinning v2 |
| HOST-20 | CI | REQ-215 | The workflows of the views and of the integration building Freelens at the commit of the validation target, cached by that commit; the five sessions of the integration test of the template green; a local run on the nightly application recorded with its checksum |
| HOST-21 | Workflow | REQ-216 | The first prerelease after it is asked for: its tag, the npm tag `next`, the GitHub release marked as a prerelease, and `latest` untouched |
| HOST-22 | Review | REQ-217 | A search of the documents: Freelens 1.10.3 named as the reference nowhere but in the history of the evidence |
| HOST-23 | Review | REQ-218 | The section of PROCESS, and the watch recorded in every pull request until Freelens 2.0.0 |
| HOST-24 | Review | REQ-219 | The header and the evidence of each spec of M1 to M3 and of SPEC-0013 |
| HOST-25 | Pre-review/manual | REQ-220 | The report of the pre-review on v2, its gallery, and the review recorded by role and date |

## Success Criteria

All 25 checks pass before this spec is Verified. On the demo in Freelens v2 every
page of the group shows what it showed on v1; a log of the real backup arrives
through the tunnel; a disconnected cluster stays disconnected; a disable and an
enable leave one of each thing; Freelens 1.10.3 says Incompatible and runs
nothing.

Budgets: every budget of the specs of M1 to M3 and of SPEC-0013, measured again on
v2, the packaged ones in the packaged Freelens v2: among them the lists of REQ-035
of SPEC-0003, the Overview of REQ-104 of SPEC-0008, the log of REQ-147 of SPEC-0011
and the measure of the unit run of ADH-16 of SPEC-0013. A budget that is not met is
investigated, never met by less data.

Failure criteria: a view, a word or a state that differs from its spec without an
amendment of this spec; a request of the extension to a cluster that is not
connected; a kubectl of the extension left running; a client or a kubeconfig of
the extension's own in the main process; a second copy of React or MobX in a
bundle; a signed URL in any output; an error of the extension in a log of the
host during the suites.

Manual review, at the review gate of T0.8: on the demo in Freelens v2, walk
through every page in both themes; disable the extension and enable it again, then
load a log; disconnect the cluster while a log loads, and connect it again; install
the tarball in Freelens 1.10.3. Expected: the views as on v1, one load and one
kubectl after the enable, the load ended and the cluster left disconnected,
Incompatible on 1.10.3. Record role, date and verdict.

## Assumptions And Decisions

The decisions D1 to D11 are in the design, each with its reasons. The defaults
inside them, which the lead maintainer may change at approval:

- **The wait for kubectl is fifteen seconds after its preparation.** kubectl
  starts, reads the Pod and opens the stream before it says that it is ready,
  which is more than a connection; the bound of silence of REQ-133 of SPEC-0010 is
  fifteen seconds as well.
- **The preparation of kubectl counts toward the 120 seconds of the operation.**
  A load is one gesture with one bound; a first download on a slow link ends at the
  step of the route, and the next load finds the kubectl in place.
- **The loopback port of kubectl takes every local connection while it is open.**
  It is open for one download; a process of the same user can reach the store with
  the kubeconfig of the user anyway. A listener of one connection would need a relay
  in front of kubectl, for no protection a process of the same user cannot step
  around.
- **A port-forward refused is read from what kubectl writes.** kubectl gives no
  status: the main process reads the `Forbidden` of the API server in the error
  kubectl writes, which is the one place a state of the extension comes from a
  text, and the packaged suite proves it on the kubectl the host runs for the
  cluster of the test environment. An access review before the port-forward was
  weighed: it adds a request and does not prove that the port-forward works.
- **A creation with no answer is an unknown submission.** The extension does not
  see the connection of the host, so it reconciles every creation without an answer
  by its name, which REQ-135 of SPEC-0010 already does for a lost answer.
- **react-window is the one entry of `dependencies`.** The knip rule of the
  template asks it, as D6 says; the rule of this repository that kept
  `dependencies` empty came from its own configuration of knip, which goes with
  the build of v1.
- **No line of the extension for Freelens v1.** The lead maintainer decided that
  v1.0.0 ships for v2, and no branch of the extension is kept for v1.
- **The first prerelease is made when the lead maintainer asks for it**, after
  T0.8 at the earliest, so that nothing is published that was not verified on v2.
- **The integration of the template through the development build of Freelens**,
  over CDP, which the template merged on 2026-10-16 (`28c28e8`), is taken in its
  form and not in its way of starting Freelens. This repository takes its runner:
  the integration test and the suites run from the repository of the extension,
  under its own Vitest, `vitest.integration.config.ts` and `pnpm test:integration`,
  with a session for each kind made as the sessions of the template are. They start
  the packaged application otherwise, with `_electron.launch` of Playwright: the
  nightly of the validation target on a machine of a developer, and Freelens built
  from source at that commit in CI. REQ-215 asks the packaged application at the
  commit of the validation target, and the suites need its main process, which CDP
  does not reach: the menu of the application, the size and the zoom of the window,
  the dialog of a save, the bundle of FND-10 inside the main process, and the output
  of the process, where the host logs.

No NEEDS CLARIFICATION marker: every decision above has a default with its
reasons.

## Evidence And Deviations

Initially: no implementation, tests or runtime evidence. The facts of the host and
of the template above were read in their source at the commits this spec names.
The surface check was run on 2026-10-16 in a scratch copy of `eb35d82`, outside
the repository, and is the scope baseline; nothing of it is committed. No cluster
was contacted and no Freelens v2 was started for this draft.

What this draft could not verify, and what T0.7 establishes first, on the nightly
application of the validation target:

- The address of a frame as a handler of `Main.Ipc` reads it, and the identifiers
  of the catalogs against it. The source says that they are unchanged.
- `kubectl port-forward` run through `Main.Shell` to the Pod of the store of the
  demo, with the host and the server name of the URL kept on the loopback, which a
  TCP tunnel keeps by construction.
- The behavior of the eighteen other components of the host the views use, which
  accept the props of the views, and the classes the 54 selectors of the styles
  name.
- What the host reads of the kinds of Velero on its own on v2, before the guard of
  the suites trusts its counts.
- Whether the time of the API server reaches the reader through the proxy of the
  frame, which SPEC-0013 left to the packaged application.
- react-window 2 against the budgets of SPEC-0011.

Later record command, exit code, counts, versions, the runs of CI on main, the
measures with the machine and the run, the first prerelease, and every deviation
with its approval before claiming Verified. Actual environment data stay outside
project files and agent output.

**Amendment of 2026-10-16: the permission of the port-forward.** Step 9 of T0.7
found that kubectl asks a port-forward of the API server over a WebSocket first,
with the verb `get` on `pods/portforward` (API servers that check `create` for a
WebSocket as well ask both), and falls back to the older protocol, with the verb
`create`, when the upgrade is refused. The evidence, on the pinned kubectl of the
test environment, v1.33.4, against its cluster at v1.34.11: three temporary
accounts of the namespace of the demo, each with `get` on Pods and, on
`pods/portforward`, `create` alone, `get` alone or neither, ran
`kubectl port-forward` at verbosity 4 to the Pod of the store. With `create`
kubectl wrote at that verbosity that the upgrade was refused for `get`, fell back,
and forwarded; with `get` it forwarded over the WebSocket; with neither it exited
before its line of readiness,
its last words `cannot create resource "pods/portforward"`. So `create` alone
forwards and only an identity with neither verb is refused, which contradicted
"The identities are refused at the same steps" for the router of the transport
proof, which had `create` alone and downloaded. The lead maintainer approved the
amendment on 2026-10-16: the row of REQ-137 of SPEC-0010 in the table of D2, with
`create` as the permission the documentation lists and `get` asked first and not
needed; scenario 5 and HOST-10, whose identity has neither verb; and the fixtures
under Tests. The downloader of the transport proof has `create` alone, and the
router and the identity of the views that may not port-forward have neither.
With them the transport proof passed on 2026-10-17 in its four modes, with the
stand-ins of the host of D9: the downloader downloaded through the cluster with
`create` alone, and the router ended as forbidden at the port-forward, its
request left in the cluster for the server to remove.

At the default verbosity, the one the extension runs kubectl with, kubectl writes
nothing of the refusal of `get`: the fallback is a log of level 4 of the client of
Kubernetes, and what kubectl writes at last, when the older protocol is refused as
well, names `create`, as a kubectl before 1.31, which asks with `create` alone,
does. So the reading of a refused port-forward in
[`diagnostic-tunnel.ts`](../../src/main/diagnostic-tunnel.ts) takes the refusal of
`create` alone since the review of T0.7, on 2026-10-17, and its test with it: its
other form, a refusal of `get`, matched nothing kubectl writes there, and would
have said that the identity needs `create` for a refusal of `get`.

**T0.7, local evidence of its branch, 2026-10-16 to 2026-10-17.** Steps 1 to 10
were made in the order above, each in its own commits, and step 11 is the
documents. Local runs are evidence for the pull request, not a status: the runs of
CI of step 10 and of T0.8 are recorded when they are made.

- **The gates of the head of step 10**, on Node 24.21.0 and pnpm 12.11.2: the
  install frozen; the type check of the nine programs with no error; lint; the
  build, which writes the five files of `dist/`; the unit run, 83 files and 2,588
  tests with none failed, and the two measures after it within their budgets
  (VIEW-10 unit, the parser at 122.5 ms at the 95th percentile; ADH-16, the
  thousand schedules at 39.4 ms and one at 0.04 ms). Knip: its development pass
  finds nothing; its production pass, with the `--files` of the template,
  reports the two modules of T3.1 and T3.2, `schedule-adherence.ts` and
  `schedule-signal.ts` of `src/common/`, which no bundle reaches before T3.3.
  They are left out of the report of unused files alone, by `ignoreFiles` in
  `knip.jsonc`, until T3.3 imports them and removes that entry, so
  `pnpm knip:check` and the step of Knip of the check workflow pass.
- **HOST-03, seen failing once**, on 2026-10-16: in a copy of the manifest, the
  lockfile and the workspace with React and its DOM at 19.3.0, one patch below the
  peer range of the SDK, `pnpm install --lockfile-only --offline` exited 1 with
  `ERR_PNPM_PEER_DEP_ISSUES`, an unmet peer of `@freelensapp/extensions`
  2.0.0-0-nightly-2026-10-15 for each.
- **HOST-04, seen failing once**: on 2026-10-16, a file of `src/renderer` that
  imports `act` of React, `react-dom/test-utils` and Testing Library got three
  errors of the lint rule `noRestrictedImports`, and none once named as a test; on
  2026-10-17, a source of the renderer that imports `node:fs` failed the environment tests
  of the renderer, `tsc -p environment-tests/tsconfig.renderer.json`, with TS2591,
  and so did one that brings in the types of Node with a reference, on the four
  marked lines of `environment-tests/node-apis.ts`, with TS2578. Each probe was removed after.
- **HOST-01**: on the nightly v2.0.0-0-nightly-2026-10-16, its package checked
  against its published checksum, the tarball installed from the Extensions page
  is listed as Enabled, both entries load, and neither log has an error. On
  Freelens 1.10.3 as released, once, on 2026-10-16, its package checked against
  its published checksum: the same tarball is listed as Incompatible, its menu
  offers Uninstall alone, no module of the extension is loaded in either process,
  and no line of the extension is logged.
- **The packaged suites on the nightly**, every suite in its last whole run, one at
  a time, on 2026-10-17, at the head of step 9 on Node 24.15.0: overview 15 of 15, journey 19 of 19, restores 14 of 14,
  schedules 14 of 14, locations 13 of 13, gate 7 of 7, with the second start in a
  new profile, preferences 7 of 7, restricted 8 of 8, restricted-restores 7 of 7,
  server 8 of 8, artifacts 51 of 51, pre-review 33 of 33, and FND-10 6 of 6; scale
  5 of 7, by the exception below. After step 10, on Node 24.21.0: FND-10 with one
  suite in one run of the runner of the views, 13 of 13, and the five sessions of
  the integration test of the template, 3 of 3 each, and with FND-10, 6 files and
  21 tests in one run. No error
  of either process and no line at the level of an error in the files of the log,
  but the kinds the collector leaves out by their address or their case.
- **The checks proven packaged**: HOST-05 in the part of a server status, one
  creation through the host counted on the API server as on Freelens 1; HOST-06, a
  cluster disconnected with a load in flight, its kubectl ended, nothing of the
  extension counted on its API server for a minute and the entry still
  disconnected; HOST-08, every load that ended with its text through the tunnel,
  with the kubectl the host prepared for the version of the cluster; HOST-09, no
  kubectl of the application after a refused port-forward, a disable, a
  disconnection and every suite; HOST-10, the identity with neither verb refused at
  the port-forward with the words of the tab; HOST-12, the identifier of the frame,
  of the catalog of the renderer and of the catalog of the main process equal, and
  the reads of the views leaving from the frame, counted on the API server alike;
  HOST-13, a disable and an enable, then one handler for each procedure, one
  creation, one kubectl, one answer and one saving of the file of the store for one
  change; HOST-14, GATE-12 with two frames and the address a handler of `Main.Ipc`
  reads; HOST-15, the tabs of the group on every page, and the Custom Resources
  tree without the five kinds while enabled and with them after a disable; HOST-16,
  a section of the details that throws, kept in its place; HOST-18, VIEW-10 on the
  log of 200,000 lines within its budgets, the answers at 50.4 ms and the longest
  frame of a gesture at 21.3 ms at the 95th percentile, 31 rows mounted at most;
  HOST-17, an allowance taken back through the main process, in the suite of the
  preferences; HOST-11 in the suite of the tabs, the log of the real backup
  through the tunnel and no part of a signed URL in its reports, beside the proof.
- **The transport proof**, in its four modes, on 2026-10-17, on Node 24.15.0 and
  again on Node 24.21.0 with the image of its helper moved to it: 16 artifacts, and
  every identity at its step.
- **HOST-05 and scenario 9, the identity of an `exec` plugin**, on 2026-10-17, on
  Node 24.21.0, in the suite of the tabs on the nightly, 52 cases of 52 in 875.0
  seconds. The runner of the suites makes, for as long as they run, an account of
  the namespace of the installation with what the documentation lists for the
  writes and for a download through the cluster, whose kubeconfig takes its token
  from a script of the test environment,
  [`local-exec-credential.sh`](../../e2e/scripts/local-exec-credential.sh), run by
  the shell of the system: it prints an `ExecCredential` of
  `client.authentication.k8s.io/v1` with the token of the account, which the runner
  wrote in the private state of the environment and nowhere else, and adds to a
  file of that state, at each of its runs, the name of the executable of the
  process that ran it, and nothing of a token or of a kubeconfig. The account, its
  kubeconfig, its token and that file go when the suites end. Opened through that
  entry of the catalog, with writes on, the log of the real backup arrived with its
  text through the tunnel, one creation was counted on the API server, no kubectl
  of the application was left, and the plugin ran once, under
  `freelens-k8s-proxy`, the proxy of the host: never under the main process of
  the host, where the extension runs, nor under the kubectl of the tunnel, whose
  kubeconfig the host writes with a user of its proxy and no plugin. A unit test of
  the environment runs the script and finds its own process named in that file:
  a run by any other process is named the same way.
- **The gate of the head after the review of T0.7**, on 2026-10-17, on Node
  24.21.0 and pnpm 12.11.2: the install frozen; the type check of the nine
  programs with no error; lint; the build; the unit run, 83 files and 2,591 tests
  with none failed, and the two measures within their budgets (VIEW-10 unit, the
  parser at 127.1 ms at the 95th percentile; ADH-16, the thousand schedules at
  41.7 ms and one at 0.06 ms); knip, both passes with no finding. On the nightly,
  one at a time, after the changes of the collector of errors and of the reading of
  a refused port-forward: overview 15 of 15 in 85.7 seconds, journey 19 of 19 in
  72.4 seconds, and the suite of the tabs 52 of 52 in 875.0 seconds, with no error
  of either process.
- **Not yet proven**: what only CI proves of HOST-20, the build of Freelens from
  source at the commit of the validation target on the hosted runner and its
  cache; HOST-21 at the first prerelease; HOST-02, HOST-24 and HOST-25 with T0.8;
  HOST-22 and HOST-23, the reviews of the documents of step 11 and of the watch in
  the pull request. The header of SPEC-0013 names the v2 target with T0.7, as
  REQ-217 asks, and its evidence moves with T0.8, as REQ-219 says.
- **The host drift watch of this pull request** (REQ-218, HOST-23), read on
  2026-10-17: the main branch of the host at `f95000fc`, sixteen commits after the
  validation target, and the one of the template at `2eaedcd9`, three commits after
  `e9881f92`, the commit this spec read it at. What each changes for the extension:
  - `3295db4e` (freelensapp/freelens#2762): a failed load of a frame inside the
    window is logged as a frame, at the level of debugging for a load aborted with
    the code -3 and as a warning otherwise, and no longer as a window that failed
    to load. The record of a load aborted by a disconnection, which the collector
    of the suites leaves out, and what AGENTS.md and TESTING say of it no longer
    hold once the pin moves past it: they go with the move, and the case of the
    disconnection keeps proving, from Electron, that the loads it aborts are
    frames.
  - `f535e42f` (freelensapp/freelens#2767): the client of the host leaves a query
    value that is undefined out of the address, the behavior the row of the query
    in the facts of the host above records with freelensapp/freelens#2759. The
    adapter still sends no query parameter without a value (REQ-202); the comment
    of its `queryOf` and that row change with the move. The patch of the
    finalizers of a Pod is not used by the extension.
  - `c4d61d98` (freelensapp/freelens#2770): the classes of the objects of the
    extension API can be constructed with `new`, which the extension does not do,
    and the drawer of the details stays open after a click whose target was drawn
    again before the click reached the window. The fact of AGENTS.md on the drawer
    gains that exception with the move, and the comment of the viewer of the
    volumes and the checks of the clicks of the journey suite are read again with
    it.
  - `cb4b46ac` (freelensapp/freelens#2773): Electron 43.8.0 in the catalog of the
    host, to which REQ-198 pins the devDependency of its types. It moves with the
    pin, as do the versions this repository takes from the catalog of the host for
    its tests, Vitest 5.0.5 and jsdom 30.1.3 (`229590f6`, `fb3eec54`), and the pnpm
    of the host, 12.14.0 (`58a3c133`).
  - `90eec876` (freelensapp/freelens#2774): the binaries the host bundles are
    downloaded and checked against `freelens/binaries.lock.json` by a script of
    their own, `build:binaries`, which `build:resources` runs, outside the cache of
    Turborepo. Nothing of the extension changes. The workflows of the views and of
    the integration, which build Freelens from source when their cache by commit
    misses, download and check the binaries at that build, and take the cache the
    host keeps of them, or not, with the move.
  - The other eight, nothing for the extension: the instructions and the workflows
    of the agents of the host (`25781c83`, `f66ed5dd`, `f29254bd`), and
    dependencies of the host the extension does not take (`1ec9a4be` undici,
    `87c096a0` js-yaml, `5fb36ebe` and `6984f095` mise, `f95000fc` sass-embedded).
  - The template: `28c28e8` (freelensapp/freelens-example-extension#383) runs its
    integration test against Freelens dev over CDP, which the assumptions above
    take in their form; `ac8026b` (#386) describes the integration test as an
    optional pattern of its skills, and `2eaedcd` (#388) moves the template of the
    issue of a migration into the skill of the port: nothing for the extension.

  Decided while implementing, on 2026-10-17: these changes
  are taken in with one move of the pin, to the commit of the host that has the
  fix of its list layout, freelensapp/freelens#2776, open, which the merge of this
  pull request waits for, so that the validation target moves once. Until then the
  facts above stay as they are at the target.

- **The move of the pin, on 2026-10-19** (REQ-218, HOST-23). The validation target
  moved from `5e1870e9` to `2578fac5e9f6d2893129b6ba0d59b379fdf9d305`, the base of the
  nightly v2.0.0-0-nightly-2026-10-19, which its release names, seven commits after
  the fix of the list layout of the host, freelensapp/freelens#2776, merged as
  `aa03a84c`; the SDK `@freelensapp/extensions` 2.0.0-0-nightly-2026-10-19 is pinned
  exactly, and its declarations carry the stores of that commit. The pin moved in the
  header above, in the line `freelens_ref` of the workflows of the views and of the
  integration, in the manifest and its build test, and in every document that named
  the commit, the nightly or the SDK of before, but the history of the evidence. The
  facts of the host above were read again at the new commit: 48 of the 54 ranges
  their links cite, with the three of ARCHITECTURE, hold at the same lines; the
  command of the Extensions page and the loader hold the same text at other lines;
  the status of that page, read again, keeps its fact at its new lines; and of the
  client of the API, `getResponse` and the other calls keep theirs at new lines, and
  the query is written by a function of its own, which corrects the row of the
  query. The stub and the doubles of the tests, which name the file and the lines of
  the host they follow, were read again the same way: the client of the API, the
  loader, `kube-api.ts` and the list layout take new lines, the behavior they model
  unchanged, and every other file they cite is the same at both commits.

  What goes with the move, from the record of 2026-10-17, is taken in: Electron
  43.8.0 for its types, and the versions of the catalog of the host the tests take,
  Vitest 5.0.5 and jsdom 30.1.3, with pnpm 12.14.0, the one of the host (`cb4b46ac`,
  `229590f6`, `fb3eec54`, `58a3c133`); React and its DOM stay at 19.3.1, the peer
  range of the SDK. The collector of the suites no longer leaves out the record of a
  load aborted by a disconnection, which the host logs as a frame at the level of
  debugging since `3295db4e`, and AGENTS.md and TESTING say so; the case of the
  disconnection keeps reading in Electron that each of those loads is of a frame.
  The comment of `queryOf` and the row of the query say that the client of the host
  leaves a value that is undefined or null out of the address since `f535e42f`, and
  still writes an empty one as a key with no value: the adapter keeps its rule of
  REQ-202. The fact of AGENTS.md on the drawer gains the exception of `c4d61d98`, a
  click whose target the click drew again before it reached the window; the comment
  of the viewer of the volumes, read again, keeps its reason, a drawer that the host
  closes on a click outside it; the checks of the clicks of the journey suite are
  below. The workflows that build Freelens restore and save the binaries its build
  downloads and checks against its lock since `90eec876`, as the template does since
  `fc65fc3`: the binaries hold nothing of a run, and the tests of the workflows say
  so.

  The watch of the move, read on 2026-10-19: the main branch of the host from
  `f95000fc` to `2578fac5`, twelve commits, and `b5169cd5` after it, and the one of
  the template from `2eaedcd9` to `428be60c`, eight commits. What each changes for the
  extension:
  - `f2f53ee1` (freelensapp/freelens#2777): the main process is the only writer of
    `isEnabled` of an extension; a command of the Extensions page asks it, and the
    page follows the state it broadcasts. The helpers of the suites that install,
    disable and enable the extension wait for the status of its row, which then says
    what the main process applied, and the order of `onActivate`, `onDeactivate` and
    the registrations in each process is the one of before: nothing to change, and
    HOST-13, in the suite of the tabs, is the proof.
  - `aa03a84c` (freelensapp/freelens#2776): the list layout of the host computes its
    filtered items once for every change. BACK-12 and REST-11 pass, below. The fact
    of AGENTS.md says what the layout computes: the store of a list of the extension
    gives its items as a computed of the read of the installation, which the layout
    follows.
  - `a2dcf42c` (freelensapp/freelens#2788): the Extensions page says Failed to load
    for an enabled extension whose code did not load in the main process or in the
    window, and Enabled only for one whose code did. The checks of the suites on the
    status of the extension, the install, FND-10, the disable and the enable, read
    Enabled, Disabled or Incompatible, and each still says what it said; Enabled
    says more. The host logs a load that failed at the level of an error, which the
    collector of every suite fails on: nothing to change.
  - `c97abd41` (freelensapp/freelens#2783) and `2578fac5` (freelensapp/freelens#2793):
    the stores of the host apply the events of a watch once for each flush and
    declare their order once, in a protected `sorting`. No class of the extension
    extends `KubeObjectStore` or `ItemStore`, and the store of a list of the
    extension is no store of the host: nothing changes, and the nine programs check
    on the declarations of the new SDK.
  - `1f5fecaf` (freelensapp/freelens#2784) and `c4b0d56b` (freelensapp/freelens#2791):
    the proxy of Freelens keeps its connections to the process of the proxy of a
    cluster alive, and builds its target again when that process has a new port, as
    after a disconnection. Nothing of the extension changes; the suite of the tabs
    disconnects a cluster and connects it again.
  - `d77d2e13` (freelensapp/freelens#2780): the provenance of an installed extension,
    in colour, unverified for a tarball; no suite reads it. `d8c88d39`
    (freelensapp/freelens#2779): joi 18.3.0, with which the host validates the
    kubeconfigs of its catalog; the suite of the tabs opens the four of the suites,
    the one of an `exec` plugin among them.
  - `3d2a6f36` and `fa713481`: the build of the host builds its tools before
    `build:resources` and `build:binaries`, and makes the folder of its license; the
    workflows here build Freelens before its resources, as before. `fb074271`: mise
    2026.10.13 in the workflows of the host; the workflows here take the mise of the
    template.
  - After the target, `b5169cd5` (freelensapp/freelens#2795) starts the
    notifications of a page of settings below its close button: nothing for the
    extension or for the helpers, which close a notification by its own command.
  - The template: `232853d` adds to its AGENTS.md that a memo over the items of a
    store of the host is computed once, since the host changes its array in place.
    The extension reads no store of the host: its lists take their items from the
    store of a list of the extension, a computed of the read of the installation,
    which a read replaces whole; the two caches keyed on an array, of the backups of
    a schedule and of the latest time the objects of a read report, are keyed on the
    items of a read, which nothing changes in place; the memos of the viewers are
    keyed on the text of an artifact. No case was found, and the rule joins the
    rules of AGENTS.md that fail silently. `72e06af`
    (freelensapp/freelens-example-extension#390) takes the
    dependencies of the host, as this move does, and `540a1b5` pnpm 12.14.0;
    `eb8a673` mise 2026.10.12, `fc65fc3` the cache of the binaries and `de4759f` mise
    in the workflows of Claude are taken in the workflows this repository has from
    the template; `8192609` sets the install of the runner of Windows, where the
    workflow here installs nothing; `428be60c` is the version of the template.

  Decided while implementing, on 2026-10-19:
  - The journey suite recorded, as the source of the host had it, that a way of a
    view closes the drawer of the host as a click outside does. At the new target
    that case failed, the drawer and the address of its object left over the view of
    the schedule: a way draws the view it leads to in the place of the one it was in
    before its click reaches the window, where the drawer now leaves alone a click
    whose target is not in the page any more (`c4d61d98`). The case records the host
    as it is: it reads at the window the target of the click of a way and of the way
    back, out of the page and in no drawer, finds the drawer over what they opened,
    with the address that names its object, and closes it by its close command, as
    the pointer does: Escape would reach the view, which has the focus and leaves at
    Escape. The extension does not close the details of the host for a way: a way
    writes the parameters of the views alone, and the details are the host's.
  - The Node of the host moved to 24.22.0 with Electron 43.8.0 in `cb4b46ac`, in its
    `.nvmrc` and its `mise.toml`, which the record of 2026-10-17 does not name, and
    the template took it in `72e06af`. This repository follows that Node with the
    Renovate of the dependencies of Freelens, whose pull request moves the image of
    the helpers of the test environment by hand and runs the transport proof: it is
    not taken in this move, whose toolchain stays Node 24.21.0. The workflows build
    Freelens with the Node of its own `.nvmrc`.

  The evidence of the move, on Node 24.21.0 and pnpm 12.14.0: the install, then the
  install frozen; the type check of the nine programs with no error; lint; the
  build; the unit run, 83 files and 2,591 tests with none failed, and the two
  measures within their budgets (VIEW-10 unit, the parser at 124.2 ms at the 95th
  percentile; ADH-16, the thousand schedules at 43.1 ms and one at 0.05 ms); knip,
  both passes with no finding; Trunk on the 34 files of the move, the lockfile left
  out by its configuration, with no issue; and the pin of one workflow put back to
  `5e1870e9`, which the test of the environment failed, then moved again. On the
  nightly v2.0.0-0-nightly-2026-10-19, its package checked against its published
  checksum,
  one run of the runner of the views as CI runs it, every suite of the views, the
  pre-review and FND-10: 14 files and 210 cases in 2,541 seconds, every one passed
  but one case of the journey. The suite of the tabs 52 of 52, with HOST-13 and
  HOST-06; the pre-review 33 of 33; the overview 15, the restores 14, the schedules
  14, the locations 13, the server 8, the restricted 8, the restricted-restores 7,
  the gate 7, the preferences 7, the scale 7, FND-10 6, and the journey 18 of 19.
  The case that failed is the one of the drawer written for this move: it read at
  the window the target of the click of the way out of the page, and the drawer
  over the view, then closed the drawer with Escape, which the view heard as well;
  with the drawer closed by its command the journey alone passed 19 of 19, in 72.6
  seconds. VIEW-10 on the log of 200,000 lines: the answers at 55.7 ms and the
  longest frame of a gesture at 22.5 ms at the 95th percentile, 31 rows mounted,
  an idle frame of 16.9 ms at the median. FND-10 and the five sessions of the
  integration test: 6 files and 21 cases, nothing left in the cluster. The
  transport proof in its four modes: 16 artifacts, three identities refused at
  their steps and the one with the documented permissions downloading. HOST-03 on
  the new SDK: with React and its DOM at 19.3.0, in a copy of the manifest, the
  lockfile and the workspace, pnpm stopped with `ERR_PNPM_PEER_DEP_ISSUES`, an
  unmet peer of `@freelensapp/extensions` 2.0.0-0-nightly-2026-10-19 for each. A
  first run of the journey and of the scale suites at the new target, on the code
  before the move, had found the case of the drawer as it was written failing,
  the drawer and the address of its object left over the view of the schedule. No
  `freelens-k8s-proxy`, kubectl or Freelens of a run was left after it.

The known exception of the target before the move, which the move resolved:
BACK-12 and REST-11, the lists of a thousand backups and of a thousand restores,
were over the budget of 250 ms at `5e1870e9`, 940 and 1,003 ms at the 95th
percentile in its last run, with 27 rows mounted, where Freelens 1.10.3 measured
109 and 91 ms. The cause was in the host: its list layout computed its filtered
items again at every read, and read them for every row it drew, so that one search
filtered the whole list a hundred times and more; the items stopped being computed
in freelensapp/freelens#2254, and are computed once for every change since
freelensapp/freelens#2776, which the new target has. Neither the budgets, nor the
data, nor the suite were changed, and nothing works around the host. At the new
target BACK-12 answers in 104 ms and REST-11 in 91 ms at the 95th percentile, with
27 rows mounted, 342 and 333 ms from the key, which counts the 250 ms the search of
the host waits; a first run of the suite at the new target, before the changes of
the move, measured 97 and 93 ms.

Decided while implementing, on 2026-10-17, as the order of T0.7 asks: this pull request is merged only with
every check green on v2, so after the move of the pin to a commit of the host with
the fix of its list layout. Until the pin moved, on 2026-10-19, a run of the job of
the views was read case by case, its failed cases exactly BACK-12 and REST-11;
since then a run is read as a whole, and every case is to pass.

Decided while implementing, inside the requirements: the words of a refused
port-forward name the verb `create` on `pods/portforward`, which the amended
REQ-137 makes the one the identity needs (REQ-205); kubectl that ends before
its line of readiness having written `Unauthorized` ends the operation as
forbidden at the step of the port-forward, with the verdict of a credential and
the words that the cluster did not take the credential of the context, which may
have expired, where REQ-205 says transport-unreachable for any other end: the
cluster refused the credential of the connection of the host, which says nothing
of what the identity may do, and those words send the operator to that credential,
where the words of a store that was not reached would send to the store; it is
read, as the refusal of the port-forward is, from what kubectl writes, the one
place a state of the extension comes from a text (REQ-205); the tag workflow tags
`X.Y.Z` and `X.Y.Z-N` alone, stricter than the template's, so that a version
such as `0.1.0-alpha.0` is not tagged (REQ-216); the workflow of the type check of
the template is not added, since the check workflow already runs the type check of
every program, a failure of which fails a step of its own, and the check of
`mise.lock` of the template is added; the
cleanup and the verification of the environment of the views run after the suites
whatever the suites found; the collector of the suites leaves out the answers 401,
403 and 404 to the reads of a frame of a cluster, which the browser writes in the
console, by their address, and until the move of the pin it left out as well the
record of a load of a frame aborted by a disconnection, which the host logged then
as a window that failed to load; HOST-06 holds the kubectl of the load once it
is seen and lets it go after the disconnection, so that the load is in flight
whatever the speed of the machine; and a defect of the port found by HOST-13, the
state of the views made again between a disable and an enable with no way to the
main process, is fixed in `onActivate` of the renderer, with a unit test seen
failing without the fix (REQ-208).
