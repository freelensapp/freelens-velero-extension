# Development Directives

Date: 2026-09-25

## Authorization

- Status: Approved for stepwise execution of [the action plan](docs/development/PLAN.md)
  on 2026-09-18. T0.1 through T0.6 are complete. The user resumed T0.4 on 2026-09-24;
  the dedicated local kind environment, official Velero/plugin/SeaweedFS installation,
  readiness, authentication, isolation and temporary-resource cleanup were verified.
  The latest directive on 2026-09-18 supersedes earlier image-remediation approval:
  use official upstream artifacts only and stop third-party bug/security repairs.
  Existing locally rebuilt images are not approved for use and were not used or
  deleted. The demo remains running with restart disabled. No cloud access is authorized.
  SPEC-0001 remains Approved, not fully implemented; SPEC-0002 and SPEC-0003 remain
  Draft. T0.5 completed on 2026-09-25: real ConfigMap backup/restore, multipart
  evidence, isolated synthetic states, restricted RBAC and owned cleanup passed.
  All fixture resources are removed; the demo infrastructure is retained.
  On 2026-09-25 the user authorized T0.6 main-process request/download proof using
  local fixtures. T0.6 passed: 118 tests and 16 real signed artifact downloads
  through direct HTTPS and HTTP/HTTPS tunnels, with CA and cleanup checks.
  The compiled main runs in Node for this proof, not in a real Freelens process.
  Stop after T0.6 for P0 review; actual-host activation and SPEC-0002/T1.1 approval
  remain outstanding. No feature or IPC/catalog integration is authorized yet.
- A step is one numbered task unless the user explicitly authorizes a batch. At the
  end of every step, stop and report results, verification and limitations, current
  progress, remaining work, and the proposed next step. Ask for decisions or
  preferences when needed, then wait for the user's continuation before proceeding.
- Every end-of-step pause must include an extremely short project-wide summary:
  Completed, Remaining to v1.0.0, and Next step / approval. Cover all remaining
  phases, not only the next task; add verification limits or blockers briefly.
  In Italian use "Restano per la v1.0.0" for future tasks, distinguishing them from
  any unfinished acceptance check in the current step.
- Do not treat roadmap approval as permission to execute all steps in one turn.
  Feature specs and milestone reviews remain separate approval gates. T0.4 permits
  local setup scripts/guards, a dedicated kind environment, Velero and a pinned local S3 backend,
  readiness checks and infrastructure ownership/cleanup. T0.5 adds the completed
  fixture and restricted-identity checks. T0.6 adds the bounded main request/download
  proof; feature pages, production IPC/catalog routing and general authentication
  support remain later steps. Its explicit certificate/token adapter does not yet
  support kubeconfig exec/auth-provider plugins, proxies or insecure TLS.
- Work locally. Do not push, publish packages, create remote repositories, open
  issues or pull requests, or post announcements without separate authorization.
- Do not create commits, branches, tags, or remotes unless explicitly requested.
- Keep this extension independent of other work in the workspace. Existing
  repositories are read-only references; do not overwrite their code, test harnesses,
  lockfiles, branches, or configuration.
- Record approval and subsequent scope changes in the plan. Never infer approval
  from the existence of these documents.

## Official Artifacts And Scope

- Binding user directive, 2026-09-18: the task is the extension, not repairing or
  maintaining third-party software. Use only official upstream repositories and
  official release images/binaries, with verified versions and immutable pins.
- Do not patch, fork or recompile upstream projects to fix their bugs or security
  findings. Do not build or select locally modified third-party images. Configure
  official artifacts through their supported interfaces; keep fixes in the
  extension and its own integration/setup code.
- Do not autonomously add vulnerability scanners such as Trivy, infrastructure
  remediation campaigns, or a requirement for zero CVEs across the laboratory.
  Upstream findings are information to explain in context, not permission to
  expand scope or impose a new release/setup gate.
- If an official dependency blocks the extension, report the concrete impact and
  an official supported option. Ask before changing agreed compatibility or scope;
  do not start fixing upstream code as a fallback.
- Previous local rebuilds, scan reports and private toolchains are historical work,
  not approved inputs. Do not use or silently delete them. Preserve the existing
  cluster, privacy, host-version and per-task approval rules.

## Product And Editorial Rules

- Deliver the complete agreed v1.0.0 as soon as possible, without compromising
  quality, scope, safety, usability, or required validation. Calendar estimates
  must not delay a ready release or justify omitted requirements.
- Implement the extension from scratch under MIT, using the official example
  extension's structure and the established extension development conventions.
- Compatibility is pinned to Freelens v1.10.3 and SDK v1.10.3. Do not target Freelens
  v2 or widen the host version without explicit user approval and verification.
- Optimize for an excellent operational UI: truthful status, fast diagnosis,
  efficient navigation, and safe actions, integrated with Freelens.
- Do not mention individuals or include comparisons with other software in any
  extension files intended for publication, including documentation, comments,
  fixtures, screenshots, package metadata, and release material.
- Describe supported capabilities factually. Do not make priority, superiority,
  adoption, or competitive claims. Technical dependency and API references are
  permitted; comparisons are not.
- Do not copy the unfiltered handoff into the project. Preserve its technical
  requirements and uncertainty labels without its personal or comparative context.
- Do not import another project's implementation, branding, or prose wholesale.
  Preserve required legal notices for any permitted reused material.
- Keep project documentation and UI text in English, following the local extension
  conventions. Use ASCII in authored documentation and no emoji.

## Delivery Method

- Follow the local Kafka and KubeSwift practices documented in the plan: numbered
  specs, a recon digest, explicit approval, implementation, regression tests,
  packaged-app integration, and a pre-review pass for every milestone.
- The handoff is input, not an approved spec or independently verified evidence.
  Record the exact Velero tag and upstream commit reviewed in each relevant spec;
  distinguish released behavior from changes present only on upstream main.
- Keep one small, testable slice per task. Update its spec, test evidence, roadmap,
  and architecture together. Do not silently reduce v1.0.0 scope.
- Keep documentation synchronized throughout the work, not just at milestone end.
  Every behavioral, architectural, tooling or scope change must update the relevant
  architecture/design, specs, test procedure/evidence, README, plan and roadmap
  summary in the same iteration before reporting completion. Record the reason for deviations and obtain
  approval where required; distinguish implemented, proposed and unverified behavior.
- Reduce delivery time through early risk validation, proven tooling, and short
  feedback loops. Do not defer agreed features or weaken review gates to ship sooner.
- Adapt remote workflows to local execution. A push or hosted CI result is not a
  prerequisite for local completion and must never be fabricated. Distinguish
  `Verified locally` from later hosted verification and publication.
- Run focused tests after changes and the milestone gates before review. Exploratory
  browser checks do not replace deterministic or packaged Electron tests.
- Before requesting manual UI testing, build and pack the extension without an
  incidental version bump: `pnpm build && pnpm clean:tgz && pnpm pack`. Report the
  actual tarball's absolute path and the tested Freelens version to the user.
- Stop at approval gates and escalate material scope, safety, compatibility, or
  platform blockers instead of claiming unverified completion.

## Required Context

- [PLAN.md](docs/development/PLAN.md) is the single task-progress and authorization
  ledger. [ROADMAP.md](docs/development/ROADMAP.md) is its concise, reader-facing
  progress summary. Keep it updated from the plan, never as an independent source
  of state, and verify both agree before every end-of-step report.
- [Spec index](docs/specs/README.md) and [template](docs/specs/TEMPLATE.md) govern
  requirement IDs and spec approval. Read the applicable approved spec before code.
- [ARCHITECTURE.md](docs/development/ARCHITECTURE.md) covers process ownership,
  target identity, the proposed create-only adapter and security contracts.
- [DESIGN.md](docs/development/DESIGN.md) covers native/custom UI choices and operator
  workflows; [TESTING.md](docs/development/TESTING.md) defines validation and evidence.
- [RECON-T0.1.md](docs/development/RECON-T0.1.md) records reviewed API facts. Proposed
  designs and unexecuted proof gates must not be presented as verified behavior.
- [DEPENDENCY-AUDIT.md](docs/development/DEPENDENCY-AUDIT.md) records security fixes
  and unresolved compatibility-sensitive changes. Update it after dependency changes.
- [LOCAL-STORAGE.md](docs/development/LOCAL-STORAGE.md) records the selected local
  S3 backend, pinned review evidence, isolation requirements and unexecuted proof gates.

## Cluster And Data Safety

- Run development, application execution, and tests on this local machine, using
  local kind for Kubernetes fixtures and every mutating operation. Do not use remote
  execution environments or hosted CI as a validation fallback.
- External environment access is permitted only for strictly read-only operations
  against a target explicitly identified and authorized by the user, and only when
  the private-data rules below can be enforced. Never infer permission from
  connectivity or existing kubeconfig entries; treat every other cluster as production.
- All writes remain local-kind-only, including temporary resources and cleanup.
  Never choose the first cluster or silently use the active/default context.
- AWS, Azure and any other online cloud account, subscription, tenant or service
  must not be accessed without prior explicit user authorization naming the target
  and permitted operation. This covers read-only queries, discovery, health probes,
  identity/permission checks, authentication, provisioning, modification and deletion.
  Local setup approval is not cloud access approval.
- Existing cloud credentials, CLI sessions, environment variables, profiles and
  reachable endpoints are never implicit authorization. Do not run cloud CLI/SDK
  discovery or account checks as a fallback for a local setup failure. Authorized
  external reads still obey the private-data rules; local-kind-only writes remain
  the default constraint and require an explicit scope change to override.
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
- Remove test-owned fixtures after tests. Never delete the persistent `kind` /
  `kind-kind` cluster or unrelated add-ons. Cluster deletion needs explicit approval.
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

- Data read from real environments must remain on this machine. Keep any necessary
  captures in a private local directory outside this extension and all repository
  worktrees, with restrictive permissions. Ignoring a file in Git is not sufficient.
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
