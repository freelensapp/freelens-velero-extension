# SPEC-0002: Installation Discovery And Target Isolation

- **Status:** Approved
- **Date:** 2026-09-18
- **Milestone / tasks:** M1 / T1.1
- **Reviewed Velero:** v1.18.2, `c253c7fe37d78c9b7e55c68544f7c5b2608712d8`
- **Reviewed main:** `60163e0827e72658bb6546165a727300170e628b`
- **Freelens validation target:** v1.10.3, `3da74415bff57a77c6e08cb5f538191ce87bac17`
- **Dependencies:** [foundation](SPEC-0001-local-foundation.md), required checks verified before implementation
- **Approval:** Approved by the lead maintainer on 2026-09-27, as drafted

## Goal

Let an operator select the correct Velero installation and understand whether its
resources are available, absent or restricted, without any cluster writes.

## Scope Baseline

The [recon](../development/RECON-T0.1.md) confirms 13 namespaced API kinds and a
server watch scope tied to its installation namespace. This slice establishes
discovery and target isolation for the five primary resource families; it does not
implement their pages, the health overview, diagnostics or actions.

Included: lazy selected-cluster discovery, namespace suggestions/configuration,
permission-aware states, target selection, navigation registration and scoped state.
Excluded pages are added by their later P1 tasks, not shipped as empty placeholders.
No automatic creation of DownloadRequest, ServerStatusRequest or access-review objects.

## User Scenarios

1. **P1, correct installation:** Given several installations in the selected cluster,
   when the operator opens Velero, then available namespaces are offered and no
   arbitrary first installation is chosen; selecting one scopes all following reads.
2. **P1, restricted access:** Given denied cluster-wide CRD/BSL listing but access to
   a known namespace, when that namespace is configured, then permitted resources
   can be read without reporting Velero absent or demanding global permissions.
3. **P1, target switch:** Given an in-flight read in installation A, when the operator
   selects B, then A's late result cannot populate B's view or authorize an action.
4. **P2, incomplete installation:** Given available Velero APIs but no BSL objects,
   when discovery completes, then the UI reports the actual missing evidence and
   accepts a namespace selection instead of claiming a healthy or absent controller.

## Requirements

| ID | Contract | Acceptance check |
| --- | --- | --- |
| REQ-013 | Discovery starts only when Velero is opened or refreshed for the explicitly selected cluster; never scan the whole catalog | DISC-01 |
| REQ-014 | Not installed requires successful authoritative API discovery; forbidden, partial APIs and generic errors remain distinct states | DISC-02 |
| REQ-015 | Suggest namespaces from permitted BSL data and accept validated explicit namespace configuration when discovery is restricted or empty | DISC-03 |
| REQ-016 | With multiple installations require an explicit or previously valid selection; never silently replace a removed/inaccessible selection | DISC-04 |
| REQ-017 | Key requests/stores by cluster and namespace, reject old selection generations and recreated target identities, and reset pending write state on change | DISC-05 |
| REQ-018 | Track read state per resource family so one denial does not erase usable data or convert unavailable counts to zero | DISC-06 |
| REQ-019 | Discovery and namespace selection perform no create, update, patch, delete, diagnostic request or access-review request | DISC-07 |
| REQ-020 | Register a Velero navigation entry and installation selector with links only to implemented views; cluster and install namespace remain unambiguous | DISC-08 |
| REQ-021 | Preserve last-successful data with stale/error evidence on refresh; do not infer HTTP status from localized or generic host error text | DISC-09 |
| REQ-022 | Persist only explicit non-secret selection/preferences locally; never persist credentials, raw cluster data or an enabled write session | DISC-10 |
| REQ-023 | Support both themes, keyboard selection, long namespace names and narrow windows without overlap or unreadable target identity | DISC-11 |

## Design

Follow [ARCHITECTURE.md](../development/ARCHITECTURE.md) for discovery evidence,
main-only precise error handling where necessary, and identity/caching. The user may
have namespaced access without permission to list CRDs. A failed global request must
not prevent a user-configured namespaced GET/list from being attempted.

Keep API availability, selected namespace and data access as separate facts. CRDs
exist cluster-wide and do not prove a running server in each namespace. Installation
selection does not fetch credentials, detect server version through a write, or
enable mutations. Namespace names are validated locally before use.

Use the native selector and host cluster label as proposed in
[DESIGN.md](../development/DESIGN.md). The scope is the Velero install namespace,
not the backup's workload filters. Discovery states occupy the content area without
a landing page. An incomplete API family names the affected view; retries are
explicit and bounded by the read adapter's contract.

On activation with no selected Velero view, no scan runs. On a switch, increment
the selection generation, dispose old subscriptions where supported, clear active
confirmation/write state and prevent late responses from repopulating the new view.
Do not depend on cancellation alone for race safety.

## Tests

Planned homes: discovery/selection pure and component tests, host-bound main adapter
tests, and the existing integration journey file using local fixtures. Use two
installation namespaces; use separate local kind targets only when authorized for
cross-cluster routing verification. No external context is needed.

| Check | Layer | Requirements | Scenario and expected evidence |
| --- | --- | --- | --- |
| DISC-01 | Component/packaged | REQ-013 | Activation sends zero discovery reads; open sends reads only for the chosen cluster; refresh stays scoped |
| DISC-02 | Unit/local RBAC | REQ-014 | Authoritative absence, partial API registration, 403 and unknown error produce different states |
| DISC-03 | Local RBAC/packaged | REQ-015 | Deny CRD/global BSL listing, permit one namespace; configuring it enables reads without elevated credentials |
| DISC-04 | Component/packaged | REQ-016 | Two namespace suggestions require selection; removing the chosen namespace does not auto-select the other |
| DISC-05 | Unit/local routing | REQ-017 | Equal names across scopes, delayed A response after B selection, recreated UID and wrong sender cannot cross boundaries |
| DISC-06 | Component/local RBAC | REQ-018 | Deny Restore listing while Backup reads succeed; preserve Backup data and mark Restore unavailable |
| DISC-07 | Adapter spy/local audit | REQ-019 | Open, refresh, filter and configure namespace produce only read requests; fail on any mutation method |
| DISC-08 | Packaged app | REQ-020 | Menu/selector open correctly, route retains target and no link points to an unimplemented page |
| DISC-09 | Component/fake clock | REQ-021 | Good read followed by failure retains values and last-success time; generic errors never become guessed absence |
| DISC-10 | Store contract | REQ-022 | Reload retains preference only; no resource bodies, kubeconfig, secret or enabled write flag is stored |
| DISC-11 | Packaged/pre-review | REQ-023 | Both themes, 900x650, 1440x900, 200% zoom and keyboard selection remain legible and non-overlapping |

## Success Criteria

All 11 checks pass. Opening or refreshing Velero performs zero mutations and never
contacts an unselected cluster. Namespace-restricted access remains useful without
global permissions. All target-switch race cases return zero cross-scope results.
Every unavailable capability remains visible as unavailable, not zero or healthy.

Manual review: with the supplied synthetic demo, use only the keyboard to choose an
installation, refresh and return through host navigation. Expected: target remains
visible, focus is predictable, and no unfinished page is exposed. Record role/date.

## Assumptions And Decisions

Default to no selected installation when several are discovered and no valid saved
choice exists. Selecting the sole confirmed installation is allowed if the target
remains visible. The operator can configure a namespace without changing kubeconfig.
No API fact identifies every incomplete installation, so discovery must state its
coverage rather than claim exhaustive detection.

## Evidence And Deviations

Approved on 2026-09-27. The upstream drift watch of the start of the milestone is
in the [recon](../development/RECON-T0.1.md#upstream-drift-watch): the release
after the reviewed one changes nothing this spec reads.

T1.1 is implemented in what every view starts with. The
[rules](../../src/common/discovery.ts) are pure functions on the answers of the
cluster; the [state of an installation](../../src/renderer/state/installation.ts)
asks and keeps; the [target bar](../../src/renderer/components/target-bar.tsx) and
the [states before a view](../../src/renderer/components/entry-state.tsx) show. The
page and the entries of the sidebar came with the first view, the Backups, so that
nothing led to a page that was not there. The status of the spec follows the
suites of the views in a packaged Freelens.

| Check | Part covered by T1.1 | Evidence |
| --- | --- | --- |
| DISC-01 | The component; the packaged app comes with the suites | Component: the activation asks nothing of the host but its store; a view that opens asks the two paths of the discovery, and the families of a namespace only after one is chosen |
| DISC-02 | The unit | Unit: an answer of 404, the kinds that are missing, 401 and 403, an answer without a status. Component: the six states, each with its words |
| DISC-03 | The component; the identity on the cluster comes with the suites | Component: with the lists of the cluster denied, the namespace that is named is read |
| DISC-04 | The component | Component: two suggestions and no choice made for the operator; a namespace that is not found any more stays selected |
| DISC-05 | The unit | Unit: a late answer of the target before, equal names in two namespaces, objects of another namespace in an answer. No request crosses the two processes in this slice: there is no sender to tell from another |
| DISC-06 | The component | Component: a family that is denied is said so, and the ones that were read stay |
| DISC-07 | The adapter | Adapter: the reader sends `GET` and nothing else |
| DISC-08 | The registration; the packaged app comes with the suites | Unit: the sidebar has Velero and, under it, Backups, and every entry leads to a page that exists |
| DISC-09 | All of it | Component, with the clock as a dependency: a read that fails after one that succeeded keeps what was read and says when it was read; a failure without a status is not an absence |
| DISC-10 | The content; the restart comes with the suites | Unit: what is kept is two maps of namespaces by cluster, and what is read of a stored value is the names that are names |
| DISC-11 | None: it is of the packaged app | |

What the implementation adds to the text of the spec, inside its requirements:

- Where a view is shown, the form that names a namespace is behind a command of
  the target bar, "Other namespace". It is how a namespace that nothing suggests
  is read from a view that is already open, and where a namespace that was named
  is taken back.
- The discovery of the installations is the list of the backup storage locations
  of the cluster, as the design says. It is asked again with every read again.
- The views read again every 15 seconds while one is open, and do not watch: a
  list that fails is shown as such, with what was read before and when.
- There is no write state in this slice to reset when the target changes
  (REQ-017): it comes with the write gate.
