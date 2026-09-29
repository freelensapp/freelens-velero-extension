// What the extension knows of Velero in one cluster, from what the API answered and from nothing else.
// The availability of the API, the namespace that was chosen and the access to the data are three facts:
// the CRDs are of the whole cluster and say nothing of a server running in a namespace.

import { failedStatus } from "./read-state";
import { readWindow, WINDOWS } from "./window";

import type { ReadStatus } from "./read-state";
import type { Window } from "./window";

export const FAMILIES = ["backups", "restores", "schedules", "storageLocations", "snapshotLocations"] as const;
export type Family = (typeof FAMILIES)[number];

// The plural of each family in the API, which is how the discovery of the API names it.
export const RESOURCES: Record<Family, string> = {
  backups: "backups",
  restores: "restores",
  schedules: "schedules",
  storageLocations: "backupstoragelocations",
  snapshotLocations: "volumesnapshotlocations",
};

export const TITLES: Record<Family, string> = {
  backups: "Backups",
  restores: "Restores",
  schedules: "Schedules",
  storageLocations: "Backup Storage Locations",
  snapshotLocations: "Volume Snapshot Locations",
};

// An answer of the API: its status and, when it has one, its body. `status` is absent when there was none.
export interface Answer {
  status?: number;
  body?: unknown;
}

export type ApiAvailability =
  // The discovery was not asked yet.
  | { state: "unknown" }
  | { state: "asking" }
  // The API answered for the group: these are the kinds it serves.
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

export function apiAvailability(answer: Answer): ApiAvailability {
  if (succeeded(answer)) {
    const listed = (answer.body as { resources?: unknown } | undefined)?.resources;

    // An answer that is not a list of resources is not the discovery of the group.
    if (!Array.isArray(listed)) return { state: "failed" };
    const resources = listed
      .map((resource) => (resource as { name?: unknown } | null)?.name)
      .filter((name): name is string => typeof name === "string" && !name.includes("/"));

    return { state: "served", resources, missing: FAMILIES.filter((family) => !resources.includes(RESOURCES[family])) };
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
}

// Where the preferences are kept between two sessions: the namespaces, the window, and nothing else.
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
  const value = (stored ?? {}) as { selected?: unknown; configured?: unknown; window?: unknown };

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
