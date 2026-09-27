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

The foundation is in place and the first milestone is under way. Scope and progress
toward v1.0.0 are in `docs/development/ROADMAP.md`.

- **Language**: TypeScript 5.9.3
- **Runtime**: Node.js >= 22.12.0, Freelens >= 1.10.3
- **Package manager**: pnpm 10.x (locked)
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
- The validation target is Freelens v1.10.3 with SDK v1.10.3, the version the
  tests build against. `engines.freelens` is `^1.10.3`. Another major version of
  Freelens needs its own spec and its own verification.
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
  milestone review gate).
- `docs/development/ROADMAP.md`: scope and progress toward v1.0.0. It is the
  single source of truth for both.
- `docs/development/ARCHITECTURE.md`: process ownership, target identity, the
  create-only adapter, errors, transport and security contracts.
- `docs/development/DESIGN.md`: operator journeys, native and purpose-built
  presentation, status semantics, non-happy states; no UI work without reading it.
- `docs/development/TESTING.md`: required test layers, fixture ownership and the
  evidence gates.
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
pnpm type:check

# Linting & formatting
pnpm biome:check          # TypeScript, JS, JSON (biome)
pnpm biome:fix            # Auto-fix the formats above
pnpm trunk:check          # Markdown, YAML, TOML and workflows, on the changed files
pnpm trunk:check:all      # The same on every file
pnpm trunk:fix            # Auto-fix Markdown, YAML, etc.
pnpm lint:check           # Alias for biome:check
pnpm lint:fix             # Alias for biome:fix

# Dependencies
pnpm knip:check           # Run after a build with separate modules

# Tests
pnpm test:unit            # Builds first, then vitest
pnpm e2e:cluster:up       # Disposable kind cluster with Velero and S3 (needs Docker)
pnpm e2e                  # Fixtures and transport proof against that cluster
pnpm e2e:cluster:down     # Removes the cluster, its network and its state
pnpm demo:up              # The cluster with the fixtures left in place

# Build
pnpm build                # Type check, then electron-vite, separate modules
pnpm build:production     # Production build, single file per entry point

# Pack for testing
pnpm pack:dev             # Bump prerelease version, production build, and create .tgz for install in Freelens app
pnpm build:production && pnpm clean:tgz && pnpm pack   # The same without the bump

# Clean
pnpm clean                # Clean out/
pnpm clean:all            # Clean everything (node_modules, out, tgz)
```

## Architecture

```text
src/
  main/index.ts             # Extension entry point (main process, Node.js)
  main/diagnostic-*.ts      # Create-only Kubernetes adapter, DownloadRequest service, transport, pod tunnel
  renderer/index.tsx        # Extension entry point (renderer process, Chromium): pages, sidebar, details
  renderer/api/             # The kinds of Velero, and the reader: the only place that reaches the cluster
  renderer/state/           # What the views of a cluster know of an installation, and the store of the list
  renderer/components/      # Target bar, states before a view, status, styles
  renderer/pages/           # The Backups and the workspace of a backup
  renderer/details/         # What is added to the details the host shows of a kind
  common/                   # Pure helpers on plain data, and the store of the preferences
build/host-globals.ts       # Maps what the host provides to the globals it provides it under
integration/                # Playwright tests against a pinned Freelens build
test/                       # Vitest stubs for the host and its components, build and environment tests
e2e/scripts/                # Disposable kind cluster with Velero and S3, fixtures, transport proof
docs/                       # Development docs and one spec per feature
```

Build output goes to `out/`.

## Host Facts That Cost A Run To Find

- The views reach the cluster through `src/renderer/api/reader.ts` and through
  nothing else. It sends `GET`. A state of a view comes from the status of an
  answer, never from the text of an error.
- A subclass of `KubeApi` does not keep its methods at run time. Do not add
  methods to the `Api` classes: write a function.
- The host writes the store of an extension from its main process. A store that
  must be kept is opened in both processes, in `onActivate`.
- An object built for a list of the host needs `metadata.selfLink`.
- Do not hide a list of the host with `display: none`: it loses its scroll. The
  list behind a workspace is hidden with `visibility`.
- `pnpm exec biome` does not exist here: `pnpm biome:fix` and `pnpm biome:check`.

## Architecture And UI

- Use renderer APIs for CRD lists/details/forms and main for privileged operations,
  signed-URL downloads, cancellation, and any approved port-forwarding.
- Use the host's Kubernetes connection for ordinary object access. Direct tunnels
  need the explicitly selected cluster's original kubeconfig and context; failure
  must not fall back to another cluster or default kubeconfig.
- Validate IPC at runtime and bind operations, results, and cancellation to their
  initiating cluster, namespace, object, and renderer request.
- Use host-provided React, MobX, extension APIs, icons, and theme tokens. Follow the
  host's actual React version, not APIs requiring a newer runtime.
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

K8s object classes MUST use `static readonly` properties for metadata. **Instance methods do NOT work and MUST NOT be used.** The Freelens host reads properties from the class constructor statically, instance methods are not available at runtime because the host creates plain object copies of the K8s resource data, not instances of the extension's class. This means:

- **Allowed**: `object.spec?.someField`, `object.status?.phase`, direct property access on typed `spec`/`status` interfaces
- **Allowed**: pure helper functions that take the object or its fields
- **Forbidden**: `object.someMethod()`, instance methods will never exist at runtime
- **Forbidden**: `typeof (object as any).someMethod === "function" ? ...`, anti-pattern that always falls through to the fallback path
- **Forbidden**: `as any`, use typed `Spec`/`Status` interfaces

```typescript
export class Backup extends Renderer.K8sApi.LensExtensionKubeObject<
  Renderer.K8sApi.KubeObjectMetadata,
  BackupStatus,
  BackupSpec
> {
  static readonly kind = "Backup";
  static readonly namespaced = true;
  static readonly apiBase = "/apis/velero.io/v1/backups";
  static readonly crd: BackupKubeObjectCRD = {
    apiVersions: ["velero.io/v1"],
    plural: "backups",
    singular: "backup",
    shortNames: [],
    title: "Backups",
  };
}

// Also export Api and Store classes (always needed):
export class BackupApi extends Renderer.K8sApi.KubeApi<Backup> {}
export class BackupStore extends Renderer.K8sApi.KubeObjectStore<Backup, BackupApi> {}
```

Each CRD file exports three classes: the KubeObject, the KubeApi, and the KubeObjectStore.

## Key Dependencies (provided by Freelens host at runtime)

`@freelensapp/extensions` is NOT bundled: `build/host-globals.ts` maps it to
`global.LensExtensions`. MobX is mapped to `global.Mobx` in both processes;
React, its DOM, its JSX runtime and the bindings of MobX for React are mapped in
the renderer. They are development dependencies pinned at the versions of the
host, and a build test fails when one of them is found in the output. A library
of the host that no source imports yet gets its mapping when one does.

Other dependencies ARE bundled into the extension output. Today the main
bundle carries `@kubernetes/client-node` and `ws`.

- Import the Kubernetes client by its files (`dist/config.js`,
  `dist/web-socket-handler.js`), never from its root: the root bundles every
  generated API client. These imports are tied to the pinned version: run the
  adapter and tunnel tests before changing it.
- undici never enters the main bundle: `build/undici-stub.ts` stands in for it.
  The real module installs a dispatcher for the whole process when it loads,
  which inside Freelens is the process of the host. A build test guards this.

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

## Electron Multi-Process

Extensions run in the same multi-process model as the Freelens host:

- **Main process** (`src/main/`), Node.js environment, extension lifecycle, privileged operations
- **Renderer process** (`src/renderer/`), Chromium browser, UI components

Code shared between both processes goes to `src/common/`.

## Troubleshooting

### Changes Not Appearing

1. Check that files are not in ignored output directories (`out/`, `node_modules/`)
2. Clean and rebuild: `pnpm clean && pnpm build`
3. Reinstall the extension in Freelens (or restart the app in dev mode)

### Build Failures

1. Check for TypeScript errors: `pnpm type:check`
2. Check for linting errors: `pnpm lint:check`
3. Verify dependencies: `pnpm install`
4. Check Node.js version matches `.nvmrc`

### Runtime Errors

1. Open Freelens DevTools and check the Console tab for renderer errors
2. Check the terminal where Freelens was launched for main process errors
3. Look for stack traces with file:line numbers
4. Validate both with `pnpm type:check` **and** `pnpm build:production`, runtime failures can appear only in bundled `out/` code

## Best Practices

1. **Follow existing patterns**, grep for similar implementations before creating new ones
2. **Test changes** before committing
3. **Run validation before committing:** `pnpm lint:fix && pnpm type:check && pnpm test:unit`
4. **For Markdown and YAML:** run `pnpm trunk:fix`
5. **Check both build forms** when the main bundle changes: `pnpm test:unit` and `VITE_PRESERVE_MODULES=false pnpm test:unit`

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
  (3–6 words maximum, omit articles and filler words)

Do **not** use auto-generated timestamp suffixes (e.g.
`claude/issue-1957-20260612-2108`), these are not human-readable and make
branch lists hard to scan.
