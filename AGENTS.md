# AGENTS.md

This file provides guidance to coding agents when working with code in this repository.

> **Tip**: If you find yourself correcting the agent during interactive work, suggest adding a new rule to this file so the lesson is captured for future sessions.

## Project Overview

This repository contains the Freelens extension for Velero (velero.io), the
backup and recovery tool for Kubernetes. It shows the Velero resources (Backup,
Restore, Schedule, BackupStorageLocation, VolumeSnapshotLocation and the other
kinds of `velero.io`) inside Freelens, with their logs and results, the
adherence of the schedules and guarded recovery actions. It was scaffolded from
freelens-example-extension and is developed spec by spec.

The foundation, the first milestone and the second milestone are in place and
reviewed. Scope and progress toward v1.0.0 are in `docs/development/ROADMAP.md`.

- **Language**: TypeScript 7.0.2
- **Runtime**: Freelens >= 2.0.0, the extension API v2 (`engines.freelens` `^2.0.0`)
- **Toolchain**: Node.js 24.21.0, yq and cosign (`mise.toml` with `mise.lock`; Node
  also in `.nvmrc`)
- **Package manager**: pnpm 12.x (`packageManager`, run through corepack), with
  strict peer dependencies
- **License**: MIT

## Licensing and provenance constraints (critical)

- This extension is MIT and written from scratch, on the structure of the
  official example extension.
- Do not import another project's implementation, branding, or prose wholesale.
  Preserve required legal notices for any permitted reused material.
- TypeScript types for the Velero kinds are written in this repository from the
  CRD schemas of the pinned Velero version, never imported or copied.
- The product name is "Freelens extension for Velero"; never present the
  extension as a Velero product.

## Official Artifacts And Scope

- The task is the extension, not repairing or maintaining third-party software.
  Use only official upstream repositories and official release images and
  binaries, with verified versions and immutable pins.
- Do not patch, fork or recompile upstream projects to fix their bugs or security
  findings. Do not build or select locally modified third-party images. Configure
  official artifacts through their supported interfaces; keep fixes in the
  extension and its own integration/setup code.
- Do not add scanners or remediation work for third-party container images or for
  the test infrastructure, and do not require zero CVEs across it. Upstream
  findings are information to explain in context, not permission to expand scope
  or impose a new release/setup gate. The organization's automation for this
  repository's own npm graph (OSV-Scanner, the automated npm audit, Renovate) is
  part of the normal process.
- If an official dependency blocks the extension, report the concrete impact and
  an official supported option. Ask before changing agreed compatibility or scope;
  do not start fixing upstream code as a fallback.
- Locally rebuilt images, scan reports and private toolchains of the early
  laboratory are not approved inputs: do not use them.

## Product And Editorial Rules

- Deliver the complete agreed v1.0.0 as soon as possible, without compromising
  quality, scope, safety, usability, or required validation. Calendar estimates
  must not delay a ready release or justify omitted requirements.
- The validation target is the one of
  [SPEC-0015](docs/specs/SPEC-0015-freelens-v2-host.md): Freelens v2 at
  freelensapp/freelens `2578fac5e9f6d2893129b6ba0d59b379fdf9d305`, the base of the
  nightly v2.0.0-0-nightly-2026-10-19, with the SDK `@freelensapp/extensions`
  2.0.0-0-nightly-2026-10-19 pinned exactly, the version the tests build against.
  `engines.freelens` is `^2.0.0`. Until Freelens 2.0.0 is released the target moves
  with the [host drift watch](docs/development/PROCESS.md#host-drift-watch), read
  before every slice and before every merge; then the pin of the SDK becomes a
  range. Another major version of Freelens needs its own spec and its own
  verification.
- Optimize for an excellent operational UI: truthful status, fast diagnosis,
  efficient navigation, and safe actions, integrated with Freelens.
- Do not mention individuals or include comparisons with other software in any
  extension files intended for publication, including documentation, comments,
  fixtures, screenshots, package metadata, and release material.
- Describe supported capabilities factually. Do not make priority, superiority,
  adoption, or competitive claims. Technical dependency and API references are
  permitted; comparisons are not.
- Keep project documentation and UI text in English.

## Text rules

- No emoji in Markdown, comments, UI strings, commit messages or PR text.
- No em dash anywhere: use commas, colons, parentheses or full stops.
- No Conventional Commits prefixes in commit subjects or PR titles.

## Development process (binding)

This repository is developed spec-first. Before implementing anything, read:

- `docs/development/PROCESS.md`: the spec-driven workflow (spec before code,
  docs updated in the same PR, manual-testing escalation to the lead maintainer,
  milestone review gate, the upstream drift watch of Velero and the host drift
  watch of Freelens and of the template).
- `docs/development/ROADMAP.md`: scope and progress toward v1.0.0. It is the
  single source of truth for both.
- `docs/development/ARCHITECTURE.md`: process ownership, target identity, the
  create-only adapter, errors, transport and security contracts.
- `docs/development/DESIGN.md`: operator journeys, native and purpose-built
  presentation, status semantics, non-happy states; no UI work without reading it.
- `docs/development/TESTING.md`: required test layers, fixture ownership and the
  evidence gates.
- `docs/development/TRY-IT.md`: the walkthrough of the views on the demo cluster,
  which is the path of the review of a milestone.
- `docs/development/RECON-T0.1.md`: the reviewed API facts of the pinned Velero
  version. Proposed designs and unexecuted proof gates must not be presented as
  verified behavior.
- `docs/development/DEPENDENCY-AUDIT.md` and `docs/development/LOCAL-STORAGE.md`:
  the bundled runtime libraries and the local S3 backend of the test environment.
- `docs/specs/`: one spec per feature, from `TEMPLATE.md`; `README.md` is the
  index and allocates the requirement IDs.

Rules that hold on top of the process:

- A Draft spec is not approval to implement. Approval is recorded in the spec
  (date, role) and in the pull request that introduces it.
- Record the exact Velero tag and upstream commit reviewed in each relevant spec;
  distinguish released behavior from changes present only on upstream main.
- Keep one small, testable slice per pull request. Do not silently reduce the
  v1.0.0 scope.
- A local run is evidence for a pull request, not a status. A CI result must
  never be fabricated or assumed.
- Exploratory browser checks do not replace deterministic or packaged Electron
  tests.
- Escalate material scope, safety, compatibility, or platform blockers instead of
  claiming unverified completion.

## Cluster And Data Safety

- Every mutating Kubernetes operation of development and tests runs against a
  disposable kind cluster created by this repository's scripts, on a developer
  machine or on a CI runner. Hosted CI runs the same suites on synthetic data
  only. Never use a shared, remote or real cluster as a test target.
- External environment access is permitted only for strictly read-only operations
  against a target explicitly identified and authorized by the user, and only when
  the private-data rules below can be enforced. Never infer permission from
  connectivity or existing kubeconfig entries; treat every other cluster as production.
- All writes remain confined to the disposable kind cluster, including temporary
  resources and cleanup. Never choose the first cluster or silently use the
  active/default context.
- AWS, Azure and any other online cloud account, subscription, tenant or service
  must not be accessed without prior explicit user authorization naming the target
  and permitted operation. This covers read-only queries, discovery, health probes,
  identity/permission checks, authentication, provisioning, modification and deletion.
  Local setup approval is not cloud access approval.
- Existing cloud credentials, CLI sessions, environment variables, profiles and
  reachable endpoints are never implicit authorization. Do not run cloud CLI/SDK
  discovery or account checks as a fallback for a local setup failure. Authorized
  external reads still obey the private-data rules; writes confined to the
  disposable kind cluster remain the default constraint and require an explicit
  scope change to override.
- Local test plugins must use only generated test credentials and explicit local
  service endpoints. Strip inherited cloud credential settings and disable ambient
  credential/metadata lookup. Public source/package/image downloads needed for the
  approved local work do not authorize access to an online cloud environment.
- Creating `DownloadRequest` or `ServerStatusRequest` is a Kubernetes write, even
  when the user-facing operation is viewing logs or version information. Real-cluster
  read-only permission does not authorize these operations.
- Use an isolated, single-target kubeconfig and verify target identity before reads
  and writes. Do not change the user's active kubeconfig context. Any authorized
  external read session must remain separate from the local mutating test session.
- Remove test-owned fixtures after tests. Scripts delete only the disposable
  cluster they created, identified by name and ownership journal. Never delete or
  modify any other cluster or unrelated add-ons.
- Product write mode starts disabled, is scoped to the selected cluster and Velero
  namespace, and is enforced in main. Every write requires confirmation naming
  context and namespace; diagnostic request creation must also be explicit.
- Backup deletion uses `DeleteBackupRequest` only, with double confirmation and
  no bulk operation. Never offer direct Backup deletion through extension controls.
- Restore previews must expose the target, submitted configuration, namespace
  mappings, existing-resource policy, and any uncertainty in affected resources.
- Never offer `BackupContents` or full backup tarball download in v1.0.0. Do not
  retrieve object-store credentials just to consume a server-signed URL.
- Keep signed URLs inside main, use them promptly, and never log, persist, cache,
  or expose them in diagnostics. Bound payload size, decompression, time, and work.
- Verify TLS by default; support BSL inline `caCert` and `caCertRef`. Resolve only
  the referenced certificate Secret/key in the selected namespace, in main, subject
  to RBAC. Skip verification is explicit, per cluster, and visibly unsafe, never an
  automatic retry fallback.

### Private Environment Data

- Data read from real environments must remain on the machine that read them. Keep
  any necessary captures in a private local directory outside this extension and all
  repository worktrees, with restrictive permissions. Ignoring a file in Git is not
  sufficient.
- Never put real environment data in source, fixtures, specs, documentation, logs,
  screenshots, videos, test reports, snapshots, package contents, or Git history.
  This includes identifiers, names, endpoints, object metadata, manifests, payloads,
  credentials, kubeconfigs, signed URLs, and diagnostic error messages containing them.
- Do not transmit those data to chat, agents, model-visible tool output, remote
  services, or hosted CI. A local check may expose only a generic, data-free verdict;
  raw output and errors stay private. Do not capture real-cluster UI through tools
  that send screenshots or DOM contents to an agent.
- Public upstream API facts and independently created synthetic fixtures may be
  used in the project. Do not turn a real dataset into a public fixture by merely
  renaming identifiers. Keep publishable evidence synthetic and data-free.
- Apply these rules to scripts, browser automation, and delegated work. If the
  isolation cannot be guaranteed, do not run the external read. Check repository
  and package candidates for private artifacts before sharing or packaging.
- The private state of the test environment (operation logs, generated
  credentials, kubeconfig) is never uploaded as a CI artifact.

## Common Commands

```bash
# Type checking
pnpm type:check           # The nine programs: main, renderer, tests, tooling, integration, scripts, environments

# Linting & formatting
pnpm biome:check          # TypeScript, JS, JSON (biome)
pnpm biome:fix            # Auto-fix the formats above
pnpm trunk:check          # Markdown, YAML, TOML and workflows, on the changed files
pnpm trunk:check:all      # The same on every file
pnpm trunk:fix            # Auto-fix Markdown, YAML, etc.
pnpm lint:check           # Alias for biome:check
pnpm lint:fix             # Alias for biome:fix

# Dependencies
pnpm knip:check           # Unused files, unused and unlisted dependencies (knip)

# Tests
pnpm test:unit            # Builds first, then vitest, then the measures alone
pnpm e2e:cluster:up       # Disposable kind cluster with Velero and S3 (needs Docker)
pnpm e2e                  # Fixtures and transport proof against that cluster
pnpm e2e:cluster:down     # Removes the cluster, its network and its state
pnpm demo:up              # The cluster with the fixtures left in place
pnpm demo:views           # What the views need beside them, and where the kubeconfigs of the demo are
pnpm e2e:views            # The suites of the views in the Freelens FREELENS_APP names, against the fixtures
pnpm pre-review           # Both themes, the sizes of the window, the zoom and the keyboard
pnpm e2e:integration      # FND-10 and a session for each of the five kinds, in the Freelens FREELENS_APP names

# Build
pnpm build                # Both Vite runs, renderer then main, without the type check
pnpm dev                  # Both Vite runs in watch mode, for a directory install

# Pack for testing
pnpm pack:dev             # Bump prerelease version, build, and create .tgz for install in Freelens app
pnpm build && pnpm clean:tgz && pnpm pack   # The same without the bump

# Clean
pnpm clean                # Clean dist/
pnpm clean:all            # Clean everything (dist, dts, node_modules, tgz)
```

## Architecture

```text
src/
  main/index.ts             # Extension entry point (main process, Node.js): the store, the procedures on Main.Ipc
  main/host.ts              # What the main process takes of the host: its catalog, the client of its proxy, its kubectl
  main/diagnostic-*.ts      # Create-only adapter on the client of the host, DownloadRequest service, transport, route, kubectl tunnel
  renderer/index.tsx        # Extension entry point (renderer process, Chromium): pages, sidebar, details, customResources
  renderer/api/             # The kinds of Velero, and the reader: the only place that reaches the cluster
  renderer/state/           # What the views of a cluster know of an installation, and the store of a list
  renderer/components/      # Target bar, states before a view, the page of a list, the frame of a view, error boundaries, styles
  renderer/pages/           # The list of each kind, and the view of one object of it
  renderer/details/         # What is added to the details the host shows of a kind
  renderer/navigation.ts    # The pages, the entries of the sidebar, and the views the address names
  common/                   # Pure helpers on plain data, and the store of the preferences
build/                      # Vite plugins of the template: modules of the host, standard decorators, CSS module declarations
environment-tests/          # Probes of the programs of each process, which fail on an API of another environment
integration/                # FND-10, a session for each of the five kinds, and the helpers of the suites of the views
test/                       # The stub of the SDK, the doubles of the host, the build and environment tests, the measures
e2e/scripts/                # Disposable kind cluster with Velero and S3, fixtures, transport proof, stand-ins of the host
e2e/__tests__/              # The suites of the views, run in the Freelens that FREELENS_APP names
docs/                       # Development docs and one spec per feature
```

Build output goes to `dist/`: `main.js`, `renderer.js` and `renderer.css`, with
source maps. `main` and `renderer` in `package.json` point at the two entries.

## Host Facts That Cost A Run To Find

The facts of the host here are of Freelens v2 at the validation target, each
proven there by the packaged suites, or read in the source of the host at that
commit where it says so; the others are facts of Velero, of Kubernetes, of the
test environment and of the process of this repository.

- The views reach the cluster through `src/renderer/api/reader.ts` and through
  nothing else: the client of the host for the cluster of the frame, with `GET`,
  to the paths of the kinds of Velero alone. A state of a view comes from the
  status of an answer, never from the text of an error. The suites see the reads
  of the views leave from the frame, and the API server counts the same ones.
- The reads of the frame of a cluster, the host's and the views' alike, leave from
  the frame through Chromium, to `https://<clusterId>.renderer.freelens.app:<port>/api-kube/...`:
  the driver of the suites sees them. The requests of the main process of the host
  and of the extension it does not see. Count them on the API server, as the
  suites do.
- The browser writes in the console of the frame, at the level of an error, every
  answer to a read of the frame that is not a success: a restricted identity that
  opens a cluster makes about ten of them from the host's own reads. What the host
  logs at the level of an error is a line that starts with `error:`, on the output
  of its process as in its files; its proxy logs so every request its client gave
  up on before the API server answered, which closing a drawer does. The collector
  of the suites leaves out a 401, a 403 or a 404 to a read of the frame, by its
  address, that record of the proxy, and a resource of the build of the host
  that the window failed to load, by its address.
- The host logs a load in its window that did not end by where it was: a load of
  the window itself at the level of an error, a load of a frame inside it at the
  level of debugging when it was aborted, with the code -3, and as a warning
  otherwise. A disconnection takes the frame of the cluster out by emptying its
  address, which aborts its load with the code -3, and a connection makes a new
  frame: the suite of the tabs reads in Electron that every load a disconnection
  ended is of a frame, aborted.
- The host writes the store of an extension from its main process, once for one
  change, and says `[BASE-STORE]: saving <file>` each time; after a disable and an
  enable it saves once for one change again. A store that must be kept is opened
  in both processes, in `onActivate`.
- A disable runs `onDeactivate` before the host takes the pages out, and an enable
  runs `onActivate` before it registers them: a page drawn again in between makes
  the state of the views again, with no way to the main process. `onActivate` of
  the renderer lets go of such a state first.
- An object built for a list of the host needs `metadata.selfLink`, read in the
  source at the target (`packages/kube-object/src/kube-object.ts`, lines 115 to
  120): the store of a list of the extension adds it, and the lists of the suites
  mount their rows with it.
- The list layout of the host computes its filtered items in a derivation of MobX,
  once for every change of what `getItems` and its filters read, and its rows read
  that one result, as read in the source at the target
  (`item-object-list/list-layout.tsx`, lines 279 to 297): what `getItems` reads is
  followed when it is observable, as the store of a list of the extension is,
  computed from the read of the installation. The scale suite holds a search of a
  list of a thousand rows to its budget.
- The application reads the kubeconfig of the user unless its profile says
  otherwise, and takes the theme of the system. Start it with `startIsolated()` of
  the helpers, never bare: its profile is under `os.tmpdir()`, the one place where
  the host takes `<profile>/Freelens/home` as its home, and its store names the
  kubeconfig of the environment alone and the theme. On macOS the host writes its
  logs to `~/Library/Logs/Freelens` unless `CFFIXED_USER_HOME` points elsewhere:
  the helpers point it into the profile.
- The host imports the main entry of an extension by its file URL, from the build
  it manages in the profile. A dynamic `import()` inside `app.evaluate` is refused
  by Node, and `process.mainModule.require` of the same file answers the module of
  the host, from the cache of its ES module loader: FND-10 reaches the bundle so,
  and proves it by the scripts the debugger of the process lists.
- What passes on a machine of a developer may not end on the hosted runner. Give
  every step of a suite its own time, shorter than the one of its case, so that
  the step that does not end is the one that is reported.
- The host gives its loader ten seconds to see an extension it unpacked, and on a
  busy machine it gives up, for that application: it says that the installation
  failed, and lists the extension Disabled. The suites start the application
  through `startWithExtension`, which starts it again in a new profile, once; the
  file `e2e-artifacts/stall-the-host-once` makes the host give up on purpose, by
  holding its main process thirteen seconds after the install is asked.
- An install from a tarball shows a notification that nothing vouches for its
  integrity, since no checksum was available for it, and installs it anyway: the
  helpers close it. A new profile has a Terminal tab in the dock of the host.
- The Extensions page names the command that enables a disabled extension
  "Enabled", and the menu of a row of the catalog opens from
  `icon-for-menu-actions-for-catalog-for-<id>`.
- The host registers the handlers of an extension in the map of Electron as
  `extensions@<digest>:<channel>`, and a handler reads the address of the frame
  that asked as `https://<clusterId>.renderer.freelens.app:<port>`, with the port
  of the proxy.
- The host prepares in the profile the kubectl of the version of the cluster at
  its first need, 1.34.12 for the cluster at 1.34.11 of the test environment, where
  the nightly bundles 1.37.1: the first load through the tunnel in a new profile
  waits for it.
- A list of the host hidden with `display: none` reads a scroll of 0 while it is
  hidden, and is back at its scroll when it is shown again. The list behind a
  workspace is hidden with `visibility`, which the scale suite proves keeps the
  scroll.
- A view opened from another one is shown over the same list, on the same page:
  the views that are open are one parameter of the address, changed once for each
  change of what is shown. Open one with `openView`, never by setting a parameter
  for each kind.
- The reviewed release writes no start time into an operation that did not start
  or that failed its validation, and it completes the object of an operation it
  takes. What a view orders by, and what it calls submitted, is checked against
  the source of the release, in `docs/development/RECON-T0.1.md`. What is called
  the newest operation, and what is placed on a line of time, goes by
  `operationTime`, never by the start alone. A column that shows the start is
  ordered by the start.
- The reviewed release writes no counter of zero, and counts when the work of an
  operation ends. A fixture with `errors: 0` is an object no installation shows:
  a view that passes on it may fail on every real one. Read the object the
  controller of the test environment wrote before trusting a synthetic one.
- No controller validates a synthetic storage location. Give it a validation
  that is days old, and take the fresh one from the location the controller of
  the test environment validates: what a suite expects must not depend on how
  old the environment is.
- A family that is asked again keeps the status of its last read, with
  `reading` beside it. Do not show a state from `loading` alone: it is the state
  of a family that was never answered.
- The host gives a page the tabs of its group, in a layout of its own, when the
  first entry of `clusterPageMenus` that leads to the page has a parent: the
  entries of the lists come before the entry of the group. A page does not render
  `TabLayout`: inside the one of the host it would have its margins twice.
- The drawer of the details of the host closes on a click that reaches the
  window, unless its default was prevented, the press began inside the drawer, the
  target is inside a drawer, or the target is not in the page any more, drawn
  again by the click before the click reached the window. A link of the host
  prevents the default, and so does the link of a section of the extension, which
  is the `MaybeLink` of the host, and the row of a list of the host opens its
  details with the default prevented: a click on a row under an open drawer opens
  the view of the row and leaves the drawer over it. A way of the view, and its
  way back, draw another view or the list in its place before their click reaches
  the window: the drawer stays over what they open, with the address that names
  its object, until it is closed, and the journey suite reads the target of such a
  click at the window. No action of the extension opens the details of the host.
- A fixture that a view of the milestone needs goes with the fixtures of the views,
  which `pnpm e2e:views` puts in place on an environment that is already up. The
  ones of the phases are put in place once, when the environment is created.
- A fixture whose time must be of the last hours is placed by the clock: its
  times are counted back from the moment it is put in place, which it says in an
  annotation, and `pnpm e2e:views` puts it in place again when it is older than
  it is good for. What a suite expects of it holds for as long as it is good.
  Objects that are created together may have the same creation time or not:
  expect no order among the ones that are placed by their creation alone.
- `kubectl delete` waits for each object it removed, one at a time: two thousand
  take minutes. Remove with `--wait=false`, then read the namespace until
  nothing is left.
- A page that is not a list is inside the frame of the pages,
  `src/renderer/components/views-frame.tsx`, which gives it the target bar, the
  view that is open over it and the focus given back. It reads a family through
  `installation.read`, which knows what the cluster does not serve, and never
  through the reads themselves.
- What is taken out of the flow inside a part that is scrolled, as the words for
  who does not see are, is placed in what holds the part unless the part is
  positioned: the holder becomes taller than its room, and the keyboard scrolls
  it, with the target bar, where nothing brings it back from. Give the part
  `position: relative`. The check of the layout of the suites finds it.
- The entry of a group of the sidebar opens the group, in the host: it leads to no
  page when it has entries under it. The page it names is the one it is marked
  with. A click on it closes a group that is open, and the host keeps a group
  open or closed across the starts of a profile (read in `sidebar-item.tsx` of the
  host at the target). The entries of the extension appear only once the host
  enables it for the cluster, so a suite reads the arrow of the group,
  `expand-icon-for-<id>`, once it is there, and clicks only a closed group: a
  click decided before the entries appear closed the group the host had opened as
  it was left, on a runner, after a restart.
- `innerText` reads the words as they are drawn, in capitals where the style
  writes them so, and `textContent` reads them with nothing between two parts.
  A suite reads the words of a part with `innerText` and its marks hidden, and
  the name of a family as it is written.
- `pnpm exec biome` does not exist here: `pnpm biome:fix` and `pnpm biome:check`.
- The reviewed release lists every BackupItemAction and RestoreItemAction twice in
  a ServerStatusRequest, each time with its own kind. A fixture with each plugin
  once is an object no server writes: a plugin is one kind and one name, shown
  and counted once.
- The API server does not count in `apiserver_request_total` a request it refuses
  to the identity. A suite proves such a refusal by what the views say and by what
  is not in the cluster, not by a count.
- Every suite expects no request to Velero in the cluster when it starts. A suite
  that asks the extension to create one leaves none when it ends: it waits for
  the server to remove what the server processed, and removes the rest.
- Nothing but the suite reads the cluster while a packaged suite runs, a read of
  the whole cluster least of all: the guard of a suite counts on the API server
  the reads of the kinds of Velero, whoever sends them. A read of the requests of
  every namespace, once a minute, made beside the suites to watch them, failed
  the guard of one.
- The sync of the reviewed release looks at a storage location once a minute, and
  passes over it until its period, a minute by default, went by since its last
  pass ended: a backup made from files given to the store comes at the first pass
  after them, within a minute or two. A wait for it counts the passes by the time
  the location says its last one ended at, and is bounded by the time that went
  by, not by a count of reads.
- The store of the test environment, SeaweedFS 4.48, takes a body in each of the
  three ways the client of the fixtures sends one, and holds its whole length. A
  way is tried only when the ones before it failed: the files are sent in the
  first.
- The source of the host is read at the commit of the validation target, in a
  clone of freelensapp/freelens, with `git show <commit>:<path>`: the doubles of
  `test/host-components.tsx`, the stub of `test/freelens-extensions.ts` and the
  address of `test/host-address.ts` follow it, each naming the file and the lines
  it follows. A double that is kinder than the host hides a defect from every test
  that uses it, and the stub refuses a name of the SDK it has no double for.
- The host changes the address once for each parameter it is asked to set, and
  sent to the address it is at it goes there and comes back, which is two
  changes. What a view shows by more than one parameter, as the views that are
  open and the tab of the last of them, is written into one search, and the host
  is sent there once and only when something changes. `openView`, `closeView`,
  `closeViews` and `showTab` of `src/renderer/navigation.ts` are the only
  writers. The suites count one change of the address for every step.
- The `Input` of the host leaves the focus at Enter unless it is given
  `blurOnEnter={false}`, and its `SearchInput` clears itself at Escape: both read
  in the source at the target, which the doubles follow. The `SearchInput` takes
  the focus when a list of the host is mounted, and takes Ctrl or Cmd with F for
  the whole window. A field of a view whose Enter is a command of its own is the
  `Input`, told to keep the focus and named by `aria-labelledby`.
- `Tabs` and `Tab` of the host give a tab its role, a stop of the Tab key and its
  choice by a click, Enter and Space. They give the strip no role, say of no tab
  that it is selected, move nothing with the arrows, and do not prevent what the
  browser does with Space by itself, as read in the source at the target.
  `src/renderer/components/workspace-tabs.tsx` adds what they lack, and prevents
  that: the suite of the tabs and the pre-review press its keys.
- The `Table` of the host draws its head and the rows it holds: what is not a
  `TableRow` is dropped, a fragment of rows as well, and its parts have no role.
  A `TableCell` that is given a `title` shows the title in place of what it
  holds.
- A list of the host orders its rows by the callback of the column: a value, or
  values it compares one after the other, each with `<` and then `===`, and it
  reverses every comparison in the second order a click gives. The first click on
  a column orders it `asc`, the next one on the same column `desc`. An `undefined`
  or a `NaN` compares as greater both ways and breaks the order: a callback never
  answers one, and none knows the direction it is asked for, so what is last in
  one order is first in the other. Read in the source at the target
  (`packages/core/src/renderer/components/table/sorting.ts`, lines 11 to 56;
  `table.tsx`, lines 226 to 236; `packages/utility-features/utilities/src/sort-compare.ts`,
  lines 22 to 49).
- `WithTooltip` of the host puts what it holds in the label of a flat badge that
  expands, and its tip, a date written by `LocaleDate` when it is given a `Date`,
  in the tooltip of the badge, which shows when the badge is pointed at, as read
  in the source at the target (`packages/core/src/renderer/components/with-tooltip/with-tooltip.tsx`,
  lines 19 to 37): a test reads a tip by pointing at it, and a cell that cuts its
  words at the end of its room holds the badge. How the badges of the next run and
  of the adherence lay out at the widths of their columns: ADHERENCE-PR1-PENDING.
- The renderer of the host reads the cluster with the `fetch` of Chromium, to the
  origin of the frame, as read in the source at the target
  (`packages/core/src/renderer/fetch/browser-fetch.injectable.ts`): an answer is of
  the same origin, and the reader reads its header Date. Whether the header of the
  API server reaches the frame through the proxies of the host, or one of them
  writes its own: ADHERENCE-PR1-PENDING.
- The `Icon` of the host holds the name of its icon as its text, which a font
  draws as the icon. Beside the words of a command it is given `aria-hidden`, or
  the name of the command carries the name of the icon.
- Escape leaves a view of one object from wherever the focus is in it, but for
  two places. A text field of a view takes the key with `escapeOfField`, clears
  what was typed and lets it go no further. The confirmation of a request takes
  it as well: it leaves the confirmation, and the view does not hear the key.
- The main process imports `electron`, with `await import("electron")`, for the
  dialog of the host at the moment a file is saved, never when its modules are
  loaded: the build test and the proofs of the test environment load the main
  bundle under Node, where there is no host. The suite of the tabs replaces the
  dialog in the main process of the application and saves through it.
- The panel of a tab names the request of a load from its confirmation on, and
  the main process reads the target and its storage location before it creates
  anything: a cancel clicked as soon as the panel names the request lands before
  the creation, at the step of the target, and creates nothing. To see a cancel
  after the creation, a suite clicks once the panel is at a step after it: the
  cancel then lands at the wait for the URL, and the request stays in the cluster
  until the server removes it.
- The `Input` of the host takes `keyboard.type` with a delay of 20 milliseconds
  between the keys and holds every character: the pre-review types into the
  search of a log so, and reads it whole with its count. For a controlled value it
  calls `onChange` at each key, and its one delay, of 500 milliseconds, sets a
  mark for the style, as read in the source at the target: a measure that starts
  at the key has nothing to split.
- A confirmation that is open, and the search, the level and the wrap of a loaded
  log, survive a change of theme through the preferences of the host: the
  pre-review carries them through its six layouts, two themes at three sizes,
  without asking for them again.
- The pages and the bytes of a load are read from the digits in the words of the
  step, which the extension writes from its own template and not in the language
  of the machine: no attribute carries them.
- The widths at which the bar of a log goes to a second line depend on what the
  bar shows, a search and its count in it or not. A scan of them expects at least
  one, and pins none.
- The window of the packaged host at 1440 by 900 gives the list of a log a room of
  208 pixels, ten lines and a part of one, where the viewer allows up to 1,560:
  31 rows are mounted at most while it scrolls, far under the bound of 100. A
  measure of the frames of a scroll there is of a short list, and its report says
  the room.
- The display of the machine of the runs draws at 60 Hz: an idle frame is 16.7
  milliseconds, and no frame can be timed finer. A budget of 50 milliseconds for a
  frame is three refreshes; the gestures of the green runs drew within one or two.
- The end of a scroll gesture is read from the rows mounted, both ends moved and
  every line of the place mounted, never from the count the list keeps ready
  around its room, and an end at an edge of the list that stays there has moved.
  A viewer made to keep two thousand rows ready on each side showed why: the last
  row kept ready was the last line before and after a notch near the end of the
  list, and the gesture never ended by the rule before that one.

## Architecture And UI

- Use renderer APIs for CRD lists/details/forms and main for privileged operations,
  signed-URL downloads, cancellation, and any approved port-forwarding.
- Use the host's Kubernetes connection for every object access, in both
  processes: the client of the host, `KubeJsonApi.forCluster` of the cluster of
  the frame or of the request, through the proxy of Freelens. The extension reads
  no kubeconfig, runs no credential plugin and keeps no client and no connection
  of its own to an API server. Ask nothing of a cluster whose entry in the catalog
  is not connected: the proxy would connect it.
- A direct tunnel is the kubectl the host gives for the explicitly selected
  cluster, `Main.Shell.getKubectlPath`, run by the main process with
  `Main.Shell.getEnvironment` as its whole environment and the folder of the
  extension as its working directory, for one operation, and killed when it ends,
  is cancelled, the extension is deactivated, the process exits or the cluster
  leaves the connected state. A failure never falls back to another cluster, a
  default kubeconfig or a client of the extension's own.
- Validate IPC at runtime and bind operations, results, and cancellation to their
  initiating cluster, namespace, object, and renderer request.
- Use the React 19, MobX 7, extension APIs, icons, and theme tokens the host
  provides, one copy of each: the build reads the libraries of the host from
  `globalThis.FreelensExtensionApi`. Follow the host's actual versions, not APIs
  requiring a newer runtime.
- Prefer native components where they fit the operator's task. Purpose-built views,
  visualizations, and interaction patterns are valid design choices when they improve
  comprehension, navigation, efficiency, or safety. Native layouts are not mandatory.
- CRD models use static metadata and typed spec/status properties. Do not introduce
  extension instance methods or `as any` workarounds for host object copies.
- Model operation lifecycle separately from failure state. An in-flight operation
  carrying errors is not completed. Missing or unreadable data is unknown, not green.
- Distinguish absent installation, empty data, forbidden access, loading, partial
  data, stale data, and network failure. Links must tolerate missing references.
- Choose the UI per operator task, record the rationale in its spec, and validate it
  with realistic workflows. Preserve host integration, both themes, keyboard access,
  accessibility, and narrow-window usability in native and custom views alike.
- Custom design must serve the operational experience. Do not build a marketing
  page or add visual complexity without a clear user benefit.

## CRD KubeObject Pattern

The kinds are the pattern of the template of the organization, as D7 of
[SPEC-0015](docs/specs/SPEC-0015-freelens-v2-host.md#d7-the-registrations) takes
it: one subclass of `Renderer.K8sApi.LensExtensionKubeObject` for each kind, in
[`src/renderer/api/kinds.ts`](src/renderer/api/kinds.ts). The host reads the
metadata of a kind from the class, through `static readonly` properties. The
objects it hands to the extension from its own store, in a section of the details
or a menu item, are instances of the host's `KubeObject`, not of the extension's
class, so the methods of `KubeObject` itself are there and a method the subclass
defines is not, and calling it throws; the lists of this repository are given the
objects the store of a list of the extension makes, and the views read them with
the same helpers. So:

- **Metadata**: `static readonly` `kind`, `namespaced`, `apiBase` and `crd`, with
  `crd.apiVersions` listing every version the cluster serves, `velero.io/v1` for
  the five kinds of today.
- **Instance type**: `declare kind` and `declare apiVersion`, with the kind and the
  version as literals, which tie a section of the details made with `detailsFor`,
  and a menu item made with `menuItemFor`, to its kind. `declare` emits nothing: a
  field would be defined after the constructor of the host gave the object its
  data, and would reset them.
- **Per-object logic**: a pure helper function that takes the object or its
  fields, in `src/common/`.
- **Fields**: read `object.spec` and `object.status` through the typed `Spec` and
  `Status` interfaces of `src/common/types.ts`.
- **Forbidden**: instance methods on the subclass; a fallback such as
  `typeof (object as any).someMethod === "function" ? ...`, which always takes the
  fallback; `as any`.
- **No `KubeApi` and no `KubeObjectStore` subclass**: the template exports them for
  the types of its list page; here no class extends them, since the views read the
  cluster through the reader and the lists of the host through the store of a list
  of the extension. A `KubeApi` the extension creates registers itself with the
  host. A store of the host, where one is needed, is the one it registers for a
  served version, read with `getStore()` in the render of an `observer`: the host
  registers the APIs of a CRD after the frame of the cluster has loaded the CRDs.

```typescript
export class Backup extends Renderer.K8sApi.LensExtensionKubeObject<Metadata, BackupStatus, BackupSpec> {
  declare kind: "Backup";
  declare apiVersion: "velero.io/v1";

  static readonly kind = "Backup";
  static readonly namespaced = true;
  static readonly apiBase = `/apis/${VELERO_API_VERSION}/backups`;
  static readonly crd: VeleroCrd = {
    apiVersions: [VELERO_API_VERSION],
    plural: "backups",
    singular: "backup",
    shortNames: [],
    title: "Backups",
  };
}
```

`src/renderer/index.tsx` registers the section of the details of each kind with
`Renderer.K8sApi.detailsFor(<class>, { priority, Details })`, which takes the kind
and the versions from the class and checks the section against it, and lists the
five classes in `customResources`: while the extension is enabled the Custom
Resources tree of the cluster leaves them out, where they would be listed a second
time beside the pages of the group of Velero, and lists them again once it is
disabled. A kind with a page of its own joins `customResources` with its page; a
kind the extension only decorates stays out of it.

## Renderer Components

- Every page and every section of the details renders inside an `ErrorBoundary`
  of [`src/renderer/components/error-boundary.tsx`](src/renderer/components/error-boundary.tsx),
  the template's: a class component of the React of the host with
  `getDerivedStateFromError` and `componentDidCatch`, which logs what its children
  throw while React draws them, with the name of the extension, and draws the
  error page of the extension in place of a page or a section, and nothing in
  place of a menu item. The host has no boundary around its drawer of the details
  or a menu item: an error there would replace the whole cluster view with the
  crash page of the host.
  - The boundary is applied where the registrations are made: `clusterPages` and
    `kubeObjectDetailItems` are mapped through `withPageErrorBoundary` and
    `withDetailsErrorBoundary`, each taking `this` and a registration, so that an
    entry added to a field is wrapped as well; a menu item a later spec adds goes
    through `withMenuItemErrorBoundary`. Each field is annotated with its type from
    `Renderer.LensExtension`, since the mapping refers to `this`.
  - A `try`/`catch` around the call of a component is not enough: a child throws
    when React draws it, and a callback of the list of the host throws when the
    host calls it from its own render.
  - The boundary has no decorator and no `observer`: it reads no observable.
- The host renders a cluster page with `params` alone: a page that needs the
  extension gets it from its registration, `Page: () => <OverviewPage extension={this} />`,
  and a section of the details gets the object alone, and the extension from its
  registration as well.
- An `observer` reads its props in its render. A callback the host calls from its
  own derivations, `getItems` or `customizeHeader` of the list, carries the values
  it needs from the render.
- The views import their CSS module for the class names only, and inject no
  `<style>`: the rules reach the page through `dist/renderer.css`, which the host
  links. The declarations of the CSS module are written by the renderer build and
  committed.

## Rules That Fail Silently

Each of these compiles when it is broken, and breaks the extension at run time or
not visibly at all.

- **The React and the MobX of the host, one copy each.** Import `react`,
  `react-dom`, `mobx` and `mobx-react` by their bare names: the build reads them
  from the host, and fails on the ways a second copy gets in. A second React throws
  `invalid hook call`; a second MobX throws nothing, and the host never reacts to
  its observables.
- **Standard decorators.** An observable field that is decorated is
  `@observable accessor`, and no class calls `makeObservable(this)` without its
  annotations; `observableRef` replaces `observable.ref`. A class whose instances
  are serialized, as the store of the preferences, keeps plain fields with an
  annotation map.
- **No Node or Electron in renderer and common code.** They are not there in the
  renderer. The build fails on an import, `pnpm type:check` on a global.
- **One stylesheet, `dist/renderer.css`.** Any other name, or a second one, leaves
  the extension unstyled.
- **One program of TypeScript for each environment.** Each has only the `lib` and
  the `types` of its runtime; the environment tests fail on a leak.
- **No instance method on a kind.** The objects of the host do not have it.
- **`this.props` of an `observer` class only in its render.** Read elsewhere, in
  a derivation of the host, it throws, and the host shows its crash page.
- **A memo over the items of a store is keyed on what changes with them.** The
  host keeps one observable array for a store and changes it in place, so a
  `useMemo` keyed on `store.items` is computed once, and a view keeps the objects
  it was opened with. An `observer` that reads the items in its render follows
  them; a memo needs a key such as the identifiers and the `resourceVersion` of the
  objects. The store of a list of the extension computes its items from the read
  of the installation, which a new read replaces whole.
- **Every page and section inside an error boundary.** Without it an error of a
  section replaces the whole cluster view.
- **A cluster page gets the extension from its registration.** The host passes
  `params` alone.
- **The test helpers of React only in the tests.** `React.act`, which
  `react-dom/test-utils` and Testing Library call, is not in the production build
  of React that the host runs, so the call throws in the host: the lint rule
  refuses them, and Vitest, outside the tests.

Neither `pnpm build` nor `pnpm dev` runs the type check: `pnpm type:check` does.

## Key Dependencies (provided by Freelens host at runtime)

The host publishes its singletons on `globalThis.FreelensExtensionApi`, each
process the ones it has: React, its DOM, its JSX runtime, MobX, the bindings of
MobX for React and the editor in the renderer, MobX alone in the main process.
[`build/vite-plugin-host-modules.mjs`](build/vite-plugin-host-modules.mjs), the
template's, replaces a bare import of one of them with a module that reads it from
that global, with the named exports of the copy installed as a devDependency, so
that an import of a name the version of the host lacks fails the build; it fails as
well on a module of the host the process does not publish, and on a subpath the
host does not publish. `@freelensapp/extensions` is a shim of three lines that
reads `Common`, `Main` and `Renderer` from the same global: it is bundled, and
must not be mapped.

The libraries of the host are devDependencies at the versions of the catalog of
the host, React and its DOM 19.3.1, MobX 7.0.6, the bindings 10.0.2, with their
types, and `electron` 43.8.0 for its types alone; `@freelensapp/extensions` is
pinned exactly to the nightly of the validation target. pnpm runs with
`strictPeerDependencies`: a library shared with the host outside the peer range of
the SDK fails the install.

What the code needs at run time and the host does not provide is bundled, since
the host installs nothing for an extension. The v2 rule of the template: a
third-party library a bundle carries is declared in `dependencies`, the modules of
the host in `devDependencies`. Today `dependencies` holds react-window alone, at
the version of the catalog of the host, which windows the lines of a log and the
resources viewer in the renderer. The main bundle carries no library: it reaches
the API server through the client of the host and opens the tunnel with the kubectl
of the host, and takes `electron` with `await import("electron")` at the moment a
file is saved. What the package bundles is in
[DEPENDENCY-AUDIT.md](docs/development/DEPENDENCY-AUDIT.md).

## Workflows

The hosted checks run on every pull request and on main, on synthetic data only:

- `check.yaml`: the build, the type check of the nine programs, lint and Knip.
- `trunk-check.yaml`: Trunk on every file.
- `unit-tests.yaml`: `pnpm test:unit`, the build first, then the tests and the
  measures alone.
- `integration-tests.yaml`: FND-10 and the five sessions of the integration test,
  in Freelens built from source at the commit of the validation target, on the
  disposable kind cluster `pnpm e2e:cluster:up` makes, taken down whatever happens.
- `views-tests.yaml`: every suite of the views, the pre-review and FND-10, in one
  run of the runner of `pnpm e2e:views`, in Freelens built at the same commit,
  against the fixtures of `pnpm demo:up`; then the cleanup of the fixtures and the
  verification of the environment.
- `e2e-tests.yaml`: the environment brought up, the fixtures and the transport
  proof, and the environment taken down.
- `osv-scanner.yaml`, and `mise-lock-check.yaml` for a pull request that changes
  `.nvmrc`, `mise.toml` or `mise.lock`.

The two workflows that build Freelens name the commit once, in `freelens_ref`,
and cache the build by it and by nothing else; a unit test ties that line to the
header of [SPEC-0015](docs/specs/SPEC-0015-freelens-v2-host.md), so the pin moves
in both places with the host drift watch. A release is `npm-version.yaml`, which
opens the pull request of the version, `tag.yaml`, which tags the version `X.Y.Z`
or `X.Y.Z-N` once that pull request is merged, and `release.yaml`, which builds
the tag and publishes a version with a hyphen on the npm tag `next`, released on
GitHub as a prerelease, and any other on `latest`. The daily maintenance workflows
and Renovate open their pull requests on branches named `automated/*`.

## Code Style

- **Biome** formats **TypeScript, JS, JSON**: double quotes, semicolons, trailing commas, 2-space indent, 120 char line width, use `pnpm biome:fix`. Its recommended rules stay on
- **Trunk** formats **Markdown, YAML** and checks the workflows, use `pnpm trunk:fix`
- `any` is an error (`noExplicitAny`)
- Import order (enforced by biome organizeImports): built-in modules, `@freelensapp/**`, packages, relative paths
- Biome, Knip and Trunk run through `pnpm dlx` at the versions the scripts name: they are not dependencies
- **No emoji** in Markdown files (`.md`), comments, or any source code

## Security

Never read, display, reference, or include the contents of the following files in any response or context, even if they are open in the editor:

- `.env`
- `.env.*`
- `.envrc`
- `.npmrc`
- `*.jks`
- `*.keystore`
- `*.p12`
- `*.pfx`
- `*.pem`
- `*.key`
- `*.kubeconfig`
- `credentials.json`
- `velero-credentials`

The same list is git-ignored in `.gitignore` and enforced for Claude Code by
the `permissions.deny` rules in `.claude/settings.json`, which block reading
and editing these files. Change all three together. The rules are native
permissions rather than a hook on purpose: a hook runs a process in the
working tree, which may be an untrusted pull request, and an interpreter such
as `python3 -c` imports modules from that tree before the hook's own code.

## Electron Multi-Process

Extensions run in the same multi-process model as the Freelens host:

- **Main process** (`src/main/`), Node.js environment, extension lifecycle, privileged operations
- **Renderer process** (`src/renderer/`), Chromium browser, UI components

Code shared between both processes goes to `src/common/`.

## Troubleshooting

### Changes Not Appearing

1. Check that files are not in ignored output directories (`dist/`, `node_modules/`)
2. Clean and rebuild: `pnpm clean && pnpm build`
3. Reinstall an extension installed from a tarball, or restart Freelens after a
   change to `main` or `renderer` in `package.json`

### Build Failures

1. Check for TypeScript errors: `pnpm type:check`
2. Check for linting errors: `pnpm lint:check`
3. Verify dependencies: `pnpm install`
4. Check Node.js version matches `.nvmrc`

### Runtime Errors

1. Open Freelens DevTools and check the Console tab for renderer errors
2. Check the terminal where Freelens was launched for main process errors
3. Look for stack traces with file:line numbers
4. Validate both with `pnpm type:check` **and** `pnpm build`, runtime failures can appear only in the bundled code of `dist/`, which the build test loads

## Best Practices

1. **Follow existing patterns**, grep for similar implementations before creating new ones
2. **Test changes** before committing
3. **Run validation before committing:** `pnpm lint:fix && pnpm type:check && pnpm test:unit`
4. **For Markdown and YAML:** run `pnpm trunk:fix`
5. **Read the host drift watch** before a slice and before a merge, until Freelens 2.0.0 is released: see `docs/development/PROCESS.md`

## GitHub Actions (Claude Code Action) Rules

This project has a Claude Code workflow (`.github/workflows/claude.yaml`) triggered
via `@claude` comments on issues, PR comments, and reviews. When operating via that
workflow, follow these rules:

### Code Review

When reviewing code and proposing fixes:

1. **Show the diff first**, present every proposed change as a unified diff
   block using the `diff` language tag:

   ```diff
   --- a/path/to/file.ts
   +++ b/path/to/file.ts
   @@ -10,7 +10,7 @@
    const oldLine = "before";
   -const changedLine = "after";
   +const changedLine = "the fix";
    const unchangedLine = "same";
   ```

   You can generate this from the terminal with:
   ```bash
   git diff -u -- path/to/file
   ```

   If the change spans multiple files, group them under a single commit
   subject and show each file's diff sequentially.

2. **Propose a commit subject first**, before any code change, output a
   single line with the proposed commit subject:

   ```text
   **Proposed commit:** <short description>
   ```

   Do **not** use Conventional Commits prefixes (e.g. `fix:`, `feat:`,
   `chore:`, `refactor:`, `docs:`, `test:`, `ci:`). This project prefers
   plain, descriptive commit messages and PR titles without any prefix.

   Wait for the user to confirm (or adjust) the subject before applying the
   change.

3. **Comment style:**
   - Keep review comments concise and actionable
   - Reference specific lines (file + line number) when pointing out issues
   - Offer a concrete fix suggestion rather than just flagging a problem
   - Do **not** use emoji in any Markdown, comments, commit messages, or
     PR descriptions. The only exception is emoji that already appears
     inside code strings (e.g. application logs, user-facing messages).
   - Use GitHub's `suggestion` block for small targeted fixes so the PR
     author can accept the change with a single click:

     ````suggestion
     <same unified-diff format as shown above>
     ````

   - For larger multi-file changes, use `diff -u` blocks in a regular
     comment instead, with the proposed commit subject shown first

### Making Changes to a PR

When asked to implement a change on a PR:

1. Propose the commit subject (as above)
2. Describe what will change and why
3. After confirmation, apply the changes with commits on the PR branch
4. **One commit per fix**, when a review surfaces more than one issue or
   the plan includes more than one fix, apply and commit each fix
   separately. Do not batch multiple independent fixes into a single
   commit. This keeps the history bisectable and makes each change easy
   to revert individually.

### Branch Naming Conventions

When creating a branch from an issue, use a human-readable name that includes
the issue number and a short slug derived from the issue title:

```text
claude/issue-<number>-<short-slug>
```

- `<number>` is the GitHub issue number
- `<short-slug>` is a kebab-case summary of the issue title, kept short
  (3 to 6 words maximum, omit articles and filler words)

Do **not** use auto-generated timestamp suffixes (e.g.
`claude/issue-1957-20260612-2108`), these are not human-readable and make
branch lists hard to scan.

### Fork PRs: Review Only

A PR from a fork (different owner than `freelensapp`) gets a review and
nothing else: no commits, no pushes, no branches. Its code is untrusted, and
the head of a fork PR can change between the moment a maintainer looks at it
and the moment the workflow checks it out, so nothing taken from the checkout
may reach `freelensapp/freelens-velero-extension`.

When a fork PR needs changes, a maintainer first copies the exact commit they
reviewed to a branch in this repository. From then on it is a
same-repository PR, which gets the full setup and the normal workflow. The
copy is made either locally (`gh pr checkout <N>`, then push the branch) or
by the Claude Task workflow, following "Copying a Fork PR" below.

### Copying a Fork PR

This applies to a Claude Task run whose prompt asks to copy a fork PR and
names the PR number and the full commit SHA to copy. It is a git-only task:
do not check out, read, build or run any of the PR's files, and do not
describe its changes, because they are untrusted input.

1. `git fetch origin refs/pull/<N>/head`.
2. Verify that `FETCH_HEAD` equals the given SHA. If it does not, or no full
   SHA was given, stop and report the actual head without pushing anything.
3. `git push origin <sha>:refs/heads/claude/pr-<N>`.
4. Open a PR from `claude/pr-<N>` to `main`. It MUST use the **exact same
   title** as the original PR, copied verbatim with no prefix, and its body
   is `Copy of #<N> at <sha>.` followed by the usual footer.
5. Comment on the original PR with a link to the new one.
