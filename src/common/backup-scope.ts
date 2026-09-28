import { selectorText } from "./restore-view";

import type { ScopeFact } from "./restore-view";
import type { BackupSpec, TypedLocalObjectReference } from "./types";

const NOT_SET = "Not set";

function named(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

function names(value: unknown): string | undefined {
  const list = Array.isArray(value) ? value.filter((entry): entry is string => named(entry) !== undefined) : [];

  return list.length ? list.join(", ") : undefined;
}

function flag(value: unknown): string | undefined {
  return typeof value === "boolean" ? (value ? "Yes" : "No") : undefined;
}

function referenceText(reference: TypedLocalObjectReference | null | undefined): string | undefined {
  const kind = named(reference?.kind);
  const name = named(reference?.name);

  return kind && name ? `${kind} ${name}` : name;
}

function fact(id: string, name: string, value: string | undefined, unset?: string): ScopeFact {
  return value === undefined ? { id, name, value: NOT_SET, ...(unset ? { note: unset } : {}) } : { id, name, value };
}

// A fact that has a line only when the object carries it.
function carried(id: string, name: string, value: string | undefined, note?: string): ScopeFact[] {
  return value === undefined ? [] : [{ id, name, value, ...(note ? { note } : {}) }];
}

// What is written where it is said, and what has a band of its own in the view: the locations the backups
// go to.
const SHOWN = new Set([
  "includedNamespaces",
  "excludedNamespaces",
  "includedResources",
  "excludedResources",
  "includedClusterScopedResources",
  "excludedClusterScopedResources",
  "includedNamespaceScopedResources",
  "excludedNamespaceScopedResources",
  "labelSelector",
  "orLabelSelectors",
  "includeClusterResources",
  "snapshotVolumes",
  "defaultVolumesToFsBackup",
  "snapshotMoveData",
  "ttl",
  "hooks",
  "orderedResources",
  "resourcePolicy",
  "csiSnapshotTimeout",
  "itemOperationTimeout",
  "datamover",
  "uploaderConfig",
  "volumeGroupSnapshotLabelKey",
  "storageLocation",
  "volumeSnapshotLocations",
  "metadata",
]);

// What a backup is asked, as the object that asks it carries it: the template of a schedule, which every
// backup of the schedule is made from. A field that is not set is said not set, and what the release does
// with it is beside it, as what the release does. The fields an operator sets most have their line always;
// the others have theirs when the object carries them, and so has a field this version does not know: what
// a backup is asked is not said without a part of it.
export function backupScope(spec: BackupSpec | null | undefined): ScopeFact[] {
  const asked = spec ?? {};
  const alternatives = Array.isArray(asked.orLabelSelectors)
    ? asked.orLabelSelectors.map(selectorText).filter((text): text is string => text !== undefined)
    : [];
  const hooks = Array.isArray(asked.hooks?.resources) ? asked.hooks.resources : [];
  const hookNames = hooks.map((hook) => named(hook?.name)).filter((name): name is string => name !== undefined);
  const ordered =
    asked.orderedResources && typeof asked.orderedResources === "object" && !Array.isArray(asked.orderedResources)
      ? Object.entries(asked.orderedResources).map(([resource, order]) => `${resource}: ${String(order)}`)
      : [];
  const parallel = asked.uploaderConfig?.parallelFilesUpload;
  const labels = (asked as { metadata?: { labels?: Record<string, string> | null } | null }).metadata?.labels;
  const others = Object.entries(asked as Record<string, unknown>)
    .filter(([key, value]) => !SHOWN.has(key) && value !== undefined && value !== null)
    .sort(([one], [other]) => one.localeCompare(other));

  return [
    fact(
      "included-namespaces",
      "Included namespaces",
      names(asked.includedNamespaces),
      "The release includes every namespace, but the ones that are excluded.",
    ),
    fact("excluded-namespaces", "Excluded namespaces", names(asked.excludedNamespaces)),
    fact("included-resources", "Included resources", names(asked.includedResources)),
    fact("excluded-resources", "Excluded resources", names(asked.excludedResources)),
    ...carried(
      "included-cluster-scoped-resources",
      "Included cluster-scoped resources",
      names(asked.includedClusterScopedResources),
    ),
    ...carried(
      "excluded-cluster-scoped-resources",
      "Excluded cluster-scoped resources",
      names(asked.excludedClusterScopedResources),
    ),
    ...carried(
      "included-namespace-scoped-resources",
      "Included namespace-scoped resources",
      names(asked.includedNamespaceScopedResources),
    ),
    ...carried(
      "excluded-namespace-scoped-resources",
      "Excluded namespace-scoped resources",
      names(asked.excludedNamespaceScopedResources),
    ),
    fact("label-selector", "Label selector", selectorText(asked.labelSelector)),
    fact(
      "alternative-selectors",
      "Alternative selectors",
      alternatives.length ? alternatives.map((text) => `(${text})`).join(" or ") : undefined,
    ),
    fact("cluster-resources", "Cluster resources", flag(asked.includeClusterResources)),
    fact("volume-snapshots", "Volume snapshots", flag(asked.snapshotVolumes)),
    fact("file-system-backup", "File system backup of the volumes", flag(asked.defaultVolumesToFsBackup)),
    fact("snapshot-data-moved", "Snapshot data moved", flag(asked.snapshotMoveData)),
    fact("retention", "Retention", named(asked.ttl)),
    ...carried(
      "hooks",
      "Hook specifications",
      hooks.length ? `${hooks.length}${hookNames.length ? `: ${hookNames.join(", ")}` : ""}` : undefined,
      "What a hook does is not shown here.",
    ),
    ...carried("ordered-resources", "Ordered resources", ordered.length ? ordered.join("; ") : undefined),
    ...carried("resource-policy", "Resource policy", referenceText(asked.resourcePolicy)),
    ...carried("csi-snapshot-timeout", "CSI snapshot timeout", named(asked.csiSnapshotTimeout)),
    ...carried("item-operation-timeout", "Item operation timeout", named(asked.itemOperationTimeout)),
    ...carried("data-mover", "Data mover", named(asked.datamover)),
    ...carried("uploader", "Uploader", typeof parallel === "number" ? `${parallel} files at a time` : undefined),
    ...carried(
      "volume-group-snapshot-label",
      "Label of the volume group snapshots",
      named(asked.volumeGroupSnapshotLabelKey),
    ),
    ...carried(
      "labels",
      "Labels of the backups",
      labels && typeof labels === "object"
        ? Object.entries(labels)
            .map(([key, value]) => `${key}=${String(value)}`)
            .join(", ") || undefined
        : undefined,
      "The release gives a backup these labels, and not the ones of the schedule.",
    ),
    // What this version has no words for is shown by the name the object gives it, as it is written.
    ...others.map(([key, value]) => ({
      id: `field-${key}`,
      name: key,
      value: typeof value === "string" ? value : JSON.stringify(value),
      note: "A field this view has no words for: it is shown as the object carries it.",
    })),
  ];
}
