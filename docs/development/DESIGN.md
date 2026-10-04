# Operator Experience

Date: 2026-09-28

Status: Proposed in T0.2. The target bar, the states before a view, the list of the
Backups and the workspace of a backup are implemented as described here, with the
first milestone, and so are the Restores, the Schedules with their history and the
way between the views, with the second; their specs record what was decided while
implementing. The rest is textual design, not a rendered or approved UI.

See [directives](../../AGENTS.md), [architecture](ARCHITECTURE.md), and
[roadmap](ROADMAP.md). Optimize for correct operational decisions and efficient repeated
work. Native components are a preference where suitable, not a layout constraint.

## Primary Journeys

1. Identify the selected installation, inspect recent outcomes and locate an
   unsuccessful or running operation without confusing progress with completion.
2. Open a backup or restore, understand its scope, current stage and errors, then
   navigate to the related schedule, storage location or operation.
3. Deliberately request diagnostics, inspect structured results and log context,
   and distinguish missing artifacts, denied access, failure and cancellation.
4. Inspect schedule firing and storage availability without treating incomplete data
   or an Available ReadOnly destination as full protection.
5. Review and confirm a recovery or deletion against the exact cluster, namespace
   and source; see the resulting operation without losing the original navigation.

## Navigation And Layout

Use a Velero cluster section with Overview, Backups, Restores, Schedules, Backup
Storage Locations and Volume Snapshot Locations. Add secondary resources in P5,
not disabled placeholder pages. Keep the installation namespace distinct from the
workload namespace filters inside a backup or restore.

The target bar uses the host's cluster identity plus a namespace selector, and a
command that opens the form where a namespace is named or taken back. A single
installation still shows its namespace. With multiple installations and no prior
valid selection, require a choice rather than choosing the first. Remember per-cluster
selection locally; a stale or inaccessible selection is visible and never silently
replaced. Changing it clears write confirmation and isolates all subsequent data.

| Surface | Proposed presentation | Reason |
| --- | --- | --- |
| Backup/Restore lists | Native sortable, searchable, virtualized tables | Fast scanning and familiar selection/navigation |
| Backup/Restore operation | Dedicated full-width workspace with summary and diagnostic tabs | Enough room for scope, progress, structured failures and logs |
| Schedule/BSL/VSL | Native table and a read-only workspace of the extension, shorter than the one of an operation | The details of the host carry the edit and the delete of the host; one way in and one way back for every kind |
| Overview | Unframed summary bands and compact recent-operation history | Show attention items, coverage and ongoing work without a decorative dashboard |
| Recovery form | Guided source -> scope -> policy -> review flow | Keep consequential choices explicit and reviewable |

The Backups row opens its dedicated operation route. Provide a clear back link and
preserve search, sort, filters and scroll. Related resources open the workspace of
their kind, and a view opened from another returns to it; the host's generic CRD
route also receives a compact read-only Velero detail section. Both surfaces use the
same domain helpers and agree on safety and status. The presentation of the kinds of
the second milestone is the one of their specs, approved on 2026-09-28.

Initial operation workspace sketch, containing operational labels only:

```text
Backups / sample-backup                 Context: local-demo    Install: velero-demo
In progress       Errors: 0       Started: ...       Elapsed: ...

Summary | Logs | Results | Resources | Volumes

Current stage: Finalizing               Item progress: 240 / 240
Source schedule: ...                    Storage: ...   Access: ReadWrite
Included namespaces: ...                Expires: ...

Validation errors / operation errors    Related restores
```

These example identifiers are synthetic. Diagnostic tabs are introduced when their
milestone exists; no empty shell tabs or implicit downloads in the read-only slice.
Opening a diagnostic tab is not consent to create a request: show its load command
and write/permission state until the explicit confirmation occurs.

## Status And Evidence

- Keep original phase text available, with a concise operational label and a separate
  failure signal. Do not compress lifecycle and health into a single green/red badge.
- In-flight phases remain in flight even with errors or 100% item progress. Terminal
  partially-failed results are not success. Deleting is a distinct non-success state.
- A phase strip represents the current stage, not an invented audit history. Display
  only real start/completion timestamps; do not fabricate intermediate stage times.
- Preserve unknown phases as unknown and retain their text. Missing progress is
  indeterminate, not zero or complete. Invalid or reversed timestamps are unavailable.
- Show errors/warnings and validation messages near the status. Text and icons must
  carry the meaning without color. Use host semantic tokens in both themes.
- BSL availability and access mode are separate fields. VSL status can be absent;
  show that limitation instead of assuming a healthy provider.
- Overview health includes data coverage and last-success time. A failed read is not
  zero failures. A successful backup does not prove recoverability, full workload
  coverage, or absence of application-consistency problems.

## Lists And Details

Proposed primary columns, with responsive hiding only for secondary fields:

| Kind | Columns |
| --- | --- |
| Backup | Name, installation namespace, phase, errors/warnings, item progress, started, duration, storage, age |
| Restore | Name, installation namespace, source backup/schedule, phase, errors/warnings, item progress, started, duration |
| Schedule | Name, installation namespace, cron, paused, last submission, latest observed backup, validation state, age |
| BSL | Name, installation namespace, availability, access mode, default, provider, last validation, last sync |
| VSL | Name, installation namespace, provider, reported phase or unknown, age |

Use stable column IDs and native resize/sort behavior. Preserve the full value in
tooltips/details when truncating. In a narrow room the secondary columns give their
room, in this order: the installation namespace in a list narrower than 1,200
pixels, the age under 1,000, the storage, the source and the duration under 760,
the start under 640. Of the locations, the provider and the last sync go under
760 and the last validation under 640: availability, access mode and default
stay. The installation is the first to go because it is the same in
every row and the target bar says it. In a list of 1,000 pixels or more what an
operation says of a failure, its progress, its start and its duration have the
room of their words, in whatever way the language of the operator writes a date:
a window of 1440 by 900 shows them whole, and the name, the source, the phase and
the storage share what is left. The head of a list is its title, the number of its
items and its search: in a room narrower than 520 pixels the search goes under the
other two, and the page is not scrolled sideways.
The last validation and the last sync of a location are shown by how long ago
they were, with that a validation is late beside its age, and when they were is
in the tip and in the view of the location. What is said of a list as a whole is
over the list, in words: that no storage location is marked default, that more
than one is, that the phase of a snapshot location is not one the release stands
behind.
Prefer semantic missing values such as Unknown or Not reported over an unexplained
dash. Relative times have absolute timezone-aware values in tooltips; duration
updates stop only for terminal evidence.

That nothing went wrong is marked of an operation Velero counted, and of no
other. The reviewed release writes no counter of zero: an operation that ended
without an error carries none, and its zero is said to be a counter that is not
in the object. One that did not start, one that is at work and one that failed
before it was counted report no count, each with its reason beside the counters.

Details lead with status/scope, then references and resource-specific fields.
References resolve within the same installation and name/UID identity. A link is
offered only when its destination can be opened; missing, forbidden, and not-yet-read
targets remain distinguishable, with bounded loading rather than endless retries.

No extension-owned default edit, delete or bulk action appears in read-only views.
Backup deletion is never inherited from a generic CRD menu. In the actions milestone,
commands open the explicit Velero operation, not an unrestricted YAML editor.

## Purpose-Built Views

- Recent-operation history places actual operations by start time with known duration
  and outcome. Use a list fallback and accessible details; gaps are not labelled
  missed runs until the schedule-adherence contract can establish that fact.
- The Overview is bands without frames, in the order an operator would look: what
  was read, what needs attention beside the newest completed backup and what is in
  flight, the recent operations, the schedules beside the storage. At 1,000 pixels
  or more the bands of a row are side by side, under that one is under the other.
  After what was read is the band of the server, which reads nothing when the
  page opens: the version of the server and its plugins are asked of the server
  through a request, which is a write, by a command of the band, through the gate
  and an inline confirmation that shows the object.
  It has no value for the installation as a whole: no score, no percentage, no
  single mark, and none of the words that would read as a verdict. A band shows
  ten items and the way to the ones after them. Every cell, item, mark and line
  is a way to an object or to a list. What needs attention is in four groups,
  in this order: what is in flight, the storage, the schedules, what ended. The
  storage is by name, and the others from the newest: the order does not change
  while the operator reads. What is in flight has half the page, and is
  two lines for each operation: its name, its kind and for how long it has been
  at work, then where it is, what it carries and how many of its items are done.
  When it started is what the elapsed time says to who points at it. The recent
  operations have the page, and are a table.
- A compact relationship path can connect schedule, backup, storage and restore.
  It is not a freeform graph editor; missing references keep their explanation.
- Logs use bounded rendering, search and clear loading/error/cancel states. Results
  group warnings/errors without losing namespace/resource context. Resource and
  volume views show completeness and filters rather than unbounded JSON blobs.
- The restore flow reviews a concrete source by default, deliberate namespace
  mappings, existing-resource policy none, and an explicit choice for cluster scope.
  Display known scope and uncertainty; never promise a full dry-run result.
- Delete requires two confirmations, including typing the backup name, and names the
  exact target. Disable duplicate submission and show pending/unknown outcomes.

Detailed diagnostics, adherence and action specs will define these later slices.
Their design candidates do not add unapproved scope or justify delaying an already
complete feature for ornamental work.

## Non-Happy States

| State | Required behavior |
| --- | --- |
| Loading | Stable layout, bounded request, cancellable diagnostics |
| Empty | Exact queried scope and zero results; retain navigation and filters |
| Not installed | Neutral result only with authoritative discovery evidence |
| Restricted | Name the unavailable capability; no false absence or forced global privileges |
| Partial | Preserve usable sections and indicate missing coverage |
| Stale | Retain last-known data, timestamp and refresh failure |
| Failed | Actionable classified error with retry safety, no raw sensitive details |
| Missing reference/artifact | Distinguish object absence from forbidden or unknown access |
| Target changed | Cancel/detach local work, invalidate confirmation and reject stale results |

## Visual And Interaction Rules

- Use host typography, icons, spacing and semantic colors as the visual base.
  Custom layouts integrate with Freelens rather than introducing branding chrome.
- Use full-width bands or unframed sections; no nested cards, hero, decorative
  illustrations, glow backgrounds or unexplained status-only color fields.
- Icon buttons have accessible names and tooltips; commands with consequences use
  icon plus clear text. Selectors, tabs, checkboxes and numeric inputs keep their
  familiar roles. Do not replace settings with decorative text chips.
- Support keyboard activation, visible focus, labelled inputs, error associations,
  Escape/back behavior, and focus restoration after dialogs. Do not steal focus on
  refresh or reorder the user's selection under their cursor.
- Layout must work at 900x650 and 1440x900 desktop test windows in both themes,
  and remain coherent at 200% zoom. Use container-based constraints, not viewport
  font scaling or negative letter spacing. Long words must wrap or truncate safely.
- Native tables may scroll horizontally when necessary; toolbars wrap without
  overlapping. Custom visualization handles empty, zero-sized and resized containers.
- These are desktop extension targets, not a mobile-site promise. Accessibility and
  reduced available width still apply to every interactive control.

## Review Contract

Each UI spec states why its chosen presentation fits the task, its field sources,
non-happy states and keyboard flow. The milestone pre-review checks both themes,
navigation, reference behavior, direct-delete prevention, focus and console errors,
then captures only synthetic screenshots. Measured behavior and visual judgment
are recorded separately. See [TESTING.md](TESTING.md); no visual result is claimed
from this textual design.
