# Roadmap To v1.0.0

Updated: 2026-09-25

Goal: deliver the complete agreed v1.0.0 as soon as possible without reducing scope,
quality, safety or verification. Compatibility reference: Freelens and SDK v1.10.3.

This is the concise progress view derived from [PLAN.md](PLAN.md), which remains
the authoritative task and authorization ledger. Update this summary whenever the
plan changes; do not maintain independent task states here.

## Current Position

- Completed: 6 of 34 numbered tasks. Remaining: 28 tasks.
- Current phase: P0 numbered tasks complete; actual-host acceptance still open.
- Last completed task: T0.6 on 2026-09-25. Compiled main retrieves 16 real artifacts
   by direct HTTPS and HTTP/HTTPS pod tunnels, with inline/referenced CA. The 118
   tests and owned cleanup pass. [Transport evidence](TESTING.md#t06-main-transport-proof).
   Next: P0 review and actual Freelens activation, then SPEC-0002/T1.1 approval.
- Counts describe task coverage, not percentage of effort or a delivery estimate.

## Completed

| Task | Result |
| --- | --- |
| T0.1 | Versioned source/schema recon and confirmed compatibility contracts |
| T0.2 | Architecture, UX, safety, testing strategy and initial specifications |
| T0.3 | Scaffold/toolchain, 21 passing tests, clean dependency audit and inspected local tarball |
| T0.4 | Official local kind/Velero/S3 environment; BSL Available, authentication, network isolation and ownership/cleanup verified |
| T0.5 | Real and synthetic fixtures, byte-integrity recovery, multipart/artifact evidence, restricted identity and full run cleanup |
| T0.6 | Create-only and bounded diagnostic proof; 16 real signed downloads, direct/tunneled TLS, cancellation regressions and cleanup |

## Remaining To v1.0.0

| Phase | Remaining tasks | Outcome |
| --- | --- | --- |
| P1 | T1.1-T1.7 | Discovery, state model, Backup/Restore/Schedule/BSL/VSL views, relationships and overview |
| P2 | T2.1-T2.4 | Secure downloads and log, results, resource-list and volume-info viewers |
| P3 | T3.1-T3.3 | Schedule adherence with timezone, missed-run and uncertainty handling |
| P4 | T4.1-T4.6 | Write gate, backup creation, guided restores, schedule pause/resume and safe backup deletion |
| P5 | T5.1-T5.3 | Secondary resources, server version and installed plugins |
| P6 | T6.1-T6.5 | Full regression, UI/accessibility review, documentation/media and accepted local v1.0.0 package |

Each numbered task remains a separate stop/report boundary unless the user explicitly
authorizes a batch. Feature specs and milestone reviews retain their approval gates.
Publication, repository uploads and announcements require separate authorization.
FND-10 actual-host activation is an outstanding foundation acceptance check, not
an extra numbered feature task or a completed verification claim.

## Evidence Boundary

T0.3 verifies the scaffold, T0.4 infrastructure readiness, T0.5 the synthetic
ConfigMap workload, and T0.6 the compiled-main transport proof. These are not
full-product, actual Electron activation or PV/CSI recovery claims. Current code
checks pass 118 tests: 21 scaffold/consumer, 52 setup/fixture and 45 diagnostic
contracts. Actual IPC sender/catalog routing, general kubeconfig authentication
plugins and all eight artifact formats are not yet runtime-qualified.
[SPEC-0001](../specs/SPEC-0001-local-foundation.md) remains
Approved until its actual-host and remaining acceptance evidence is complete;
other initial specs remain Draft.
See the [spec index](../specs/README.md) and [dependency audit](DEPENDENCY-AUDIT.md).

## Update And Reporting Rule

1. Update task state and evidence in the plan, specs and affected design documents.
2. Refresh this derived summary in the same iteration and check that completed and
   remaining task IDs exactly match the plan before reporting progress.
3. At every end-of-step pause, give an extremely short project-wide summary:
   **Completed**, **Remaining to v1.0.0**, **Next step / approval**. Include all
   remaining phases, not only the immediate next task. Add a brief verification or
   blocker note when needed; do not imply that task counts measure effort.
   Use "Restano per la v1.0.0" in Italian for future work, not current-step gaps.
