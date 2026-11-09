# Development process (spec-driven)

This repository is developed spec-first. The process below is binding for
every contributor, human or agent (Claude, Copilot, or any other coding
agent). Agents discover it via [AGENTS.md](../../AGENTS.md) and
`.github/copilot-instructions.md`, which both point here.

## The loop

1. **Spec before code.** Every feature starts as a spec file in
   `docs/specs/`, numbered `SPEC-NNNN-short-slug.md`, written from
   [TEMPLATE.md](../specs/TEMPLATE.md). The [spec index](../specs/README.md)
   allocates the requirement IDs. No implementation PR without an approved
   spec.
2. **Approval.** The lead maintainer of this extension approves the spec,
   in the PR that introduces it or by saying so in the tracking issue.
3. **Implementation.** One PR per feature slice. The PR links the spec. The
   implementation must not silently diverge from the spec: if reality forces
   a change, update the spec in the same PR and call the change out in the
   PR description.
4. **Tests are part of the feature.** See [TESTING.md](TESTING.md). A
   feature without its non-regression tests is not done.
5. **Docs updated in the same PR.** ROADMAP.md status, the spec's status
   field, and ARCHITECTURE.md (when structure changed) are updated in the
   same PR as the code. A PR that leaves docs stale is incomplete.
6. **Verification.** After merge, the spec status moves to Verified only
   when the non-regression tests run green in CI on main, plus a manual
   check when the spec requires one.
7. **Post-merge closure (do not skip).** Merging a feature PR is not the
   end of the loop: whoever merges immediately checks the CI runs on main
   and then lands a small follow-up (PR or docs commit) that moves the
   ROADMAP rows from "In PR" to "Done" and the spec Status to Verified.
   A milestone is closed only when the docs on main say so. An
   implementation PR can only write "In PR" about itself, so this step
   can never be folded into the feature PR; it exists precisely because
   it is otherwise the easiest thing to forget.

## Spec statuses

`Draft`, then `Approved`, then `Implemented`, then `Verified`. Superseded
specs get status `Superseded` with a pointer to the replacement; nothing is
deleted.

A local run is evidence for a pull request, not a status. Record approvals
and reviews by role and date, never by personal name.

## The design question every spec answers

Freelens offers a standard vocabulary (list pages, detail drawers, menus)
and this extension uses it wherever a Kubernetes resource is the subject.
It is not the ceiling. For every task the user performs, the spec's Design
section states whether the view is **standard** (list plus drawer) or
**ad hoc** (an overview page, an operation workspace, a timeline, a guided
flow) and why the chosen one is the best possible experience for that task.
See [DESIGN.md](DESIGN.md), section "Purpose-Built Views".

## Manual testing escalation

Some behavior cannot be verified automatically (for example: the recovery
of persistent volumes on a production-like cluster, a large artifact over a
slow link, the lived experience of a guided restore). In that case:

1. The spec lists the manual test steps under "Success Criteria".
2. The agent or contributor asks the lead maintainer to run them, providing
   exact steps and expected outcomes.
3. The result is recorded in the spec (date, result, role of the tester)
   before the feature is marked Verified.

A manual test never sends the data of a real environment to an agent, to a
remote service or to hosted CI: see the private-data rules in
[AGENTS.md](../../AGENTS.md).

## Milestone manual review gate

Automated tests prove behavior; they do not prove the experience. At the
end of every milestone (after the post-merge closure step), the lead
maintainer runs a manual review session in a real Freelens before the next
milestone starts:

0. Precondition: the pre-review agent pass has run and its report is in
   the reviewer's hands (see [TESTING.md](TESTING.md)): the agent has
   already verified everything automatable, so the human session covers
   only judgment calls, the report's "for human judgment" list, and what
   cannot be automated.
1. Bring up the demo environment (procedure in [TRY-IT.md](TRY-IT.md)).
2. Walk through every view the milestone introduced, on both themes,
   asking of each one "is this the best possible view for the task?".
3. Record findings as issues (one per finding, or one umbrella issue per
   session) and the session outcome (date, role, verdict) in the specs
   involved.
4. Blocking findings are fixed before the next milestone begins; the fixes
   follow the normal loop.

The review is per milestone, not once at the end and not after every task:
feedback on `M(n)` must arrive before its patterns are replicated in
`M(n+1)`.

## Upstream drift watch

Velero and its object store plugins release on their own schedule, and the
`velero.io` API gains fields, phases and kinds with them. The extension is
written against the versions recorded in [RECON-T0.1.md](RECON-T0.1.md). At
the start of every milestone (and before every release of the extension):

1. Check the latest Velero release and its release notes, and the plugin
   version it is paired with.
2. Diff the CRD schemas of the release against the version the types were
   written from; record the reviewed tag and commit in the affected specs.
3. File an issue for any breaking change, any new phase the status model
   does not know, or any newly deprecated field the extension still shows
   as current.

Behavior present only on the upstream main branch is design guidance, never
a baseline capability.

## Host drift watch

Until Freelens 2.0.0 was released, the extension was built and tested against a
commit of the main branch of Freelens, the validation target that
[SPEC-0015](../specs/SPEC-0015-freelens-v2-host.md) names, and followed the
template of the organization, freelensapp/freelens-example-extension, which
moved with it. Before every slice and before every merge the watch read what the
main branch of both changed, took in first a change to what the extension uses,
moved the target with it and recorded the reading in the pull request. It moved
the target to the commit of the tag v2.0.0 of Freelens 2.0.0, released on
2026-10-28, and ended on 2026-11-07: the SDK is taken by the range `^2.0.0`, and
the workflows build the host at the commit of that tag.

Since then the target moves with the releases of Freelens, not with its main
branch. Renovate brings a release of the SDK in the pull request of the group
`Freelens dependencies`: the range `^2.0.0` stays, and the lockfile moves to the
release. The same group carries the libraries and the tools that follow the main
branch of Freelens, which the build test holds to the catalog of the commit of the
target: a pull request of the group that brings versions of the main branch before
a release waits for the release that brings them. `engines.freelens` stays
`^2.0.0`, the oldest release the extension runs on: Renovate proposes only a major
version of Freelens, which needs its own spec. Before a pull request of the group
that brings a release is merged:

1. Read what the release changed in the extension API, its documentation and the
   migration guide of the host, and what the template changed with it.
2. Move the target to the commit of the tag of the release in the same pull
   request, everywhere it is written: the header of SPEC-0015; the one line of
   each workflow that builds Freelens, which a unit test ties to that header;
   the version of the SDK in the build test, which a unit test ties to the same
   header; and every document that names the commit or the version, which a
   search of the repository for either finds. Take in first a change to what the
   extension uses. The move is recorded in SPEC-0015.
3. Record the reading in the pull request: the release, what changed for the
   extension, and what was taken in or why nothing was.

The main branch of the host is still read once a day for changes to the extension
API, its documentation and the loading of the extensions. When one that the
extension uses is coming in a release, the main branch is read again before every
slice and before every merge, and the reading is recorded in each pull request,
while the target stays at the release the extension is built for; the change is
taken in with the release that brings it, in the pull request that moves the
target.

## Working agreements

- Branch names: short kebab-case (`add-backup-views`, `bootstrap-e2e`);
  `claude/issue-N-slug` when starting from an issue.
- Plain commit messages, no conventional-commit prefixes, no emoji, no em
  dash.
- PRs against `main`, squash merge, CI green required.
- An automated pull request whose title carries `[skip ci]` ran no check: run
  Trunk Check on it before merging.
- Packages are published only by the release workflow, never from a
  workstation. Tags are created only by the tag workflow, on the merge commit
  of the pull request of the version, never on main as it is when the workflow
  runs: at the merge of that pull request, or, once it is merged, on the
  comment `/tag` of an owner, a member or a collaborator of the repository
  alone.
- The version changes through the pull request of the version workflow only,
  never by hand in another pull request. The tag workflow tags a release
  version, `X.Y.Z`, and a prerelease of a line, `X.Y.Z-N`, and no other form
  of a version. The release workflow publishes a version with a hyphen on the
  npm tag `next` and marks its GitHub release as a prerelease, and any other on
  `latest`.
- External contributions follow the same spec-first loop; maintainers help
  contributors write the spec when needed.

## Reuse beyond this repository

These practices are shared with the other freelensapp extensions and are
meant to be generalized into a common repository. Keep this file
self-contained (no references to details that only exist in this repo,
except in examples) so extraction stays cheap.
