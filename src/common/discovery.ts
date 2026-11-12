// What the extension knows of Velero in one cluster, from what the API answered and from nothing else.
// The availability of the API, the namespace that was chosen and the access to the data are three facts:
// the CRDs are of the whole cluster and say nothing of a server running in a namespace.

import { type Allowances, readAllowances } from "./allowances";
import { failedStatus } from "./read-state";
import { readWindow, WINDOWS } from "./window";

import type { ReadStatus } from "./read-state";
import type { Window } from "./window";

// The families of an installation, one union: the five of the first milestones, the backup repositories, and the
// families of the operations of the volumes, the two of the data movement last.
export const FAMILIES = [
  "backups",
  "restores",
  "schedules",
  "storageLocations",
  "snapshotLocations",
  "backupRepositories",
  "podVolumeBackups",
  "podVolumeRestores",
  "dataUploads",
  "dataDownloads",
] as const;
export type Family = (typeof FAMILIES)[number];

// The versions of the group the views read: the second serves the two kinds of the data movement, and the first every
// other kind (SPEC-0014, REQ-177). A kind is read under its version and under no other.
export const VERSIONS = ["v1", "v2alpha1"] as const;
export type Version = (typeof VERSIONS)[number];

// The families the second version serves.
export const SECOND_VERSION = ["dataUploads", "dataDownloads"] as const satisfies readonly Family[];

export function versionOf(family: Family): Version {
  return (SECOND_VERSION as readonly Family[]).includes(family) ? "v2alpha1" : "v1";
}

// The families a backup, a restore and a schedule are shown with: the three kinds and the two locations they name.
export const BACKUPS_AND_LOCATIONS = [
  "backups",
  "restores",
  "schedules",
  "storageLocations",
  "snapshotLocations",
] as const satisfies readonly Family[];

// The families read at every read of an installation, whatever view is open: the five of the first milestones, and
// the backup repositories, which are few (SPEC-0014, REQ-178).
export const ALWAYS = [...BACKUPS_AND_LOCATIONS, "backupRepositories"] as const satisfies readonly Family[];

// The families read only while a view that shows them is open: an installation may hold thousands of their
// objects, and a view that does not show them does not pay for them.
export const ON_DEMAND = [
  "podVolumeBackups",
  "podVolumeRestores",
  "dataUploads",
  "dataDownloads",
] as const satisfies readonly Family[];

// The plural of each family in the API, which is how the discovery of the API names it.
export const RESOURCES: Record<Family, string> = {
  backups: "backups",
  restores: "restores",
  schedules: "schedules",
  storageLocations: "backupstoragelocations",
  snapshotLocations: "volumesnapshotlocations",
  backupRepositories: "backuprepositories",
  podVolumeBackups: "podvolumebackups",
  podVolumeRestores: "podvolumerestores",
  dataUploads: "datauploads",
  dataDownloads: "datadownloads",
};

export const TITLES: Record<Family, string> = {
  backups: "Backups",
  restores: "Restores",
  schedules: "Schedules",
  storageLocations: "Backup Storage Locations",
  snapshotLocations: "Volume Snapshot Locations",
  backupRepositories: "Backup Repositories",
  podVolumeBackups: "Pod Volume Backups",
  podVolumeRestores: "Pod Volume Restores",
  dataUploads: "Data Uploads",
  dataDownloads: "Data Downloads",
};

// An answer of the API: its status and, when it has one, its body. `status` is absent when there was none.
// When the answer carried the time it was written at, `date` is that time and `at` the clock of this machine
// in the middle of the request: the two are given together, or neither is.
export interface Answer {
  status?: number;
  body?: unknown;
  date?: number;
  at?: number;
}

export type ApiAvailability =
  // The discovery was not asked yet.
  | { state: "unknown" }
  | { state: "asking" }
  // The API answered for the group: these are the kinds its first version serves, and the families it does not
  // serve under the version of each.
  | { state: "served"; resources: string[]; missing: Family[] }
  // The API answered that it does not know the group. It is the only evidence of an absence.
  | { state: "not-installed" }
  // The reader may not ask.
  | { state: "restricted" }
  // Anything else. Not an absence.
  | { state: "failed" };

function succeeded(answer: Answer): boolean {
  return typeof answer.status === "number" && answer.status >= 200 && answer.status < 300;
}

// The kinds an answer of the discovery of a version lists, or nothing when it is not a list of resources.
function listedResources(answer: Answer): string[] | undefined {
  const listed = (answer.body as { resources?: unknown } | undefined)?.resources;

  if (!Array.isArray(listed)) return undefined;
  return listed
    .map((resource) => (resource as { name?: unknown } | null)?.name)
    .filter((name): name is string => typeof name === "string" && !name.includes("/"));
}

// What the discovery of the second version says of its kinds: the ones it lists, or that the API does not serve the
// version, which is the only evidence of an absence. An answer that refused or failed, or was not given, says
// nothing: the families are read, and each read says what it is.
function secondVersion(answer: Answer | undefined): string[] | "not-served" | undefined {
  if (!answer) return undefined;
  if (succeeded(answer)) return listedResources(answer);
  return failedStatus(answer.status) === "not-served" ? "not-served" : undefined;
}

// The availability of the API, from the discovery of the first version, which says whether Velero is there, and of
// the second, which says only whether the kinds it serves are: a version the API does not serve makes its families
// not served, and changes nothing else.
export function apiAvailability(answer: Answer, second?: Answer): ApiAvailability {
  if (succeeded(answer)) {
    const resources = listedResources(answer);

    // An answer that is not a list of resources is not the discovery of the group.
    if (!resources) return { state: "failed" };
    const others = secondVersion(second);
    const missing = FAMILIES.filter((family) =>
      versionOf(family) === "v1"
        ? !resources.includes(RESOURCES[family])
        : others === "not-served" || (others !== undefined && !others.includes(RESOURCES[family])),
    );

    return { state: "served", resources, missing };
  }
  const status = failedStatus(answer.status);

  if (status === "not-served") return { state: "not-installed" };
  return { state: status === "forbidden" ? "restricted" : "failed" };
}

export type Suggestions =
  | { state: "unknown" }
  | { state: "asking" }
  // The storage locations of the cluster were read: these are their namespaces. None is a possible answer.
  | { state: "listed"; namespaces: string[] }
  // The list of the whole cluster is denied. A namespace can still be configured.
  | { state: "restricted" }
  | { state: "failed" };

// The namespaces where a storage location is: where an installation of Velero may be. An installation
// without a storage location is in none of them, so the list is a suggestion and not an inventory.
export function suggestions(answer: Answer): Suggestions {
  if (!succeeded(answer)) {
    const status = failedStatus(answer.status);

    return { state: status === "forbidden" ? "restricted" : "failed" };
  }
  const items = (answer.body as { items?: unknown } | undefined)?.items;

  if (!Array.isArray(items)) return { state: "failed" };
  const namespaces = items
    .map((item) => (item as { metadata?: { namespace?: unknown } } | null)?.metadata?.namespace)
    .filter((namespace): namespace is string => typeof namespace === "string" && validNamespace(namespace));

  return { state: "listed", namespaces: [...new Set(namespaces)].sort() };
}

// A name of a namespace as Kubernetes accepts it, checked here before it is part of a request.
export function validNamespace(value: unknown): value is string {
  return typeof value === "string" && value.length <= 63 && /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/.test(value);
}

export interface Preferences {
  // The namespace chosen for each cluster, by the identifier of the cluster.
  selected: Record<string, string>;
  // The namespaces the operator configured for each cluster, which no discovery suggested.
  configured: Record<string, string[]>;
  // The window of the recent operations of the Overview, when one was chosen.
  window?: Window;
  // What the operator allowed the downloads of the artifacts to do, for each cluster, when anything was.
  allowances?: Allowances;
}

// Where the preferences are kept between two sessions: the namespaces, the window, what the operator
// allowed, and nothing else.
export interface PreferenceStorage {
  read(): Preferences;
  write(preferences: Preferences): void;
}

export function emptyPreferences(): Preferences {
  return { selected: {}, configured: {} };
}

// What is kept for as long as it is held, and no longer: what the views have where the store of the host
// is not there, and what a test gives them. It answers what was last written, as the store does.
export function heldPreferences(
  initial: Preferences = emptyPreferences(),
  written?: (preferences: Preferences) => void,
): PreferenceStorage {
  let preferences = initial;

  return {
    read: () => preferences,
    write: (next) => {
      preferences = next;
      written?.(next);
    },
  };
}

// What is kept of a stored value: the names that are names, and nothing else that a file may hold.
export function readPreferences(stored: unknown): Preferences {
  const preferences = emptyPreferences();
  const value = (stored ?? {}) as {
    selected?: unknown;
    configured?: unknown;
    window?: unknown;
    allowances?: unknown;
  };

  if (value.selected && typeof value.selected === "object") {
    for (const [cluster, namespace] of Object.entries(value.selected)) {
      if (cluster && validNamespace(namespace)) preferences.selected[cluster] = namespace;
    }
  }
  if (value.configured && typeof value.configured === "object") {
    for (const [cluster, namespaces] of Object.entries(value.configured)) {
      const valid = Array.isArray(namespaces) ? [...new Set(namespaces.filter(validNamespace))].sort() : [];

      if (cluster && valid.length) preferences.configured[cluster] = valid;
    }
  }
  // A window that is not one of the three is not kept: the one that is taken is the one of no choice.
  if ((WINDOWS as readonly unknown[]).includes(value.window)) preferences.window = readWindow(value.window);
  // What was allowed is kept only when something was: a file of an operator who allowed nothing has no
  // such key.
  const allowances = readAllowances(value.allowances);

  if (Object.keys(allowances).length) preferences.allowances = allowances;
  return preferences;
}

export interface Choice {
  namespace: string;
  // Where the choice comes from: a storage location is there, or the operator configured it, or both.
  suggested: boolean;
  configured: boolean;
}

export type Selection =
  // Nothing can be chosen and nothing was: the operator configures a namespace, or Velero is not there.
  | { state: "none" }
  // Several installations and no choice that is still valid: the first is not taken for the operator.
  | { state: "required" }
  | { state: "selected"; namespace: string; reason: "saved" | "only" | "chosen" }
  // The namespace that was chosen is not among the ones that can be: it stays selected and visible,
  // and is not replaced by another.
  | { state: "stale"; namespace: string };

export function choices(found: Suggestions, configured: string[]): Choice[] {
  const suggested = found.state === "listed" ? found.namespaces : [];

  return [...new Set([...suggested, ...configured])].sort().map((namespace) => ({
    namespace,
    suggested: suggested.includes(namespace),
    configured: configured.includes(namespace),
  }));
}

// The namespace the views read, from what can be chosen and from what was chosen before.
export function selection(available: Choice[], saved: string | undefined, found: Suggestions): Selection {
  if (saved) {
    if (available.some((choice) => choice.namespace === saved)) {
      return { state: "selected", namespace: saved, reason: "saved" };
    }
    // While the namespaces are not known the saved one is neither valid nor stale: it is the one to read.
    return found.state === "listed"
      ? { state: "stale", namespace: saved }
      : { state: "selected", namespace: saved, reason: "saved" };
  }
  if (available.length === 1) return { state: "selected", namespace: available[0].namespace, reason: "only" };
  return available.length ? { state: "required" } : { state: "none" };
}

// What the content of a view is, before any data: one state, the first that applies.
export type Entry =
  | { state: "loading" }
  | { state: "not-installed" }
  | { state: "restricted"; configurable: true }
  | { state: "failed" }
  | { state: "choose"; choices: Choice[] }
  | { state: "configure"; reason: "no-suggestion" | "suggestions-restricted" | "suggestions-failed" }
  | { state: "ready"; namespace: string; stale: boolean; missing: Family[] };

export function entry(api: ApiAvailability, found: Suggestions, chosen: Selection, available: Choice[]): Entry {
  if (api.state === "unknown" || api.state === "asking") return { state: "loading" };
  if (api.state === "not-installed") return { state: "not-installed" };
  // A namespace that is selected is read whatever the discovery answered: the reader may have access
  // to it and to nothing else, and a failed discovery takes nothing away from that access.
  if (chosen.state === "selected" || chosen.state === "stale") {
    return {
      state: "ready",
      namespace: chosen.namespace,
      stale: chosen.state === "stale",
      missing: api.state === "served" ? api.missing : [],
    };
  }
  if (api.state === "failed") return { state: "failed" };
  if (found.state === "unknown" || found.state === "asking") return { state: "loading" };
  if (chosen.state === "required") return { state: "choose", choices: available };
  if (api.state === "restricted") return { state: "restricted", configurable: true };
  return {
    state: "configure",
    reason:
      found.state === "restricted"
        ? "suggestions-restricted"
        : found.state === "failed"
          ? "suggestions-failed"
          : "no-suggestion",
  };
}

// What a family of an installation is, when the discovery says that its kind is not served.
export function familyStatus(api: ApiAvailability, family: Family, read: ReadStatus): ReadStatus {
  return api.state === "served" && api.missing.includes(family) ? "not-served" : read;
}

// The generation of a selection: every change of the target makes a new one, and what was asked for
// an older one is not for the views any more. A cancelled request may still answer.
export interface Generation {
  cluster: string;
  namespace: string;
  number: number;
}

export function current(generation: Generation, asked: Generation): boolean {
  return (
    generation.number === asked.number &&
    generation.cluster === asked.cluster &&
    generation.namespace === asked.namespace
  );
}
