// What the list, the view and the section of the details show of a backup repository: one reading of it, wherever it
// is shown. Due is counted by a clock that is an argument, the one the views share for a tick.

import { formatDuration, timestamp } from "./duration";
import { duration } from "./go-duration";
import { shownText } from "./location-view";
import { maintenanceResult, READINESS_RANK, repositoryReadiness } from "./volume-phases";
import { REPOSITORY_WORDS } from "./volume-words";

import type { Duration } from "./go-duration";
import type { BackupRepositoryResource } from "./types";
import type { MaintenanceResult, RepositoryReadiness } from "./volume-phases";

export interface Maintenance {
  result: MaintenanceResult;
  started?: number;
  completed?: number;
  // From the start to the completion, when both are written and in that order.
  milliseconds?: number;
  message?: { value: string; shortened: boolean };
}

export interface RepositoryView {
  name: string;
  namespace: string;
  uid?: string;
  volumeNamespace?: string;
  location?: string;
  type?: string;
  // The identifier of a restic repository, as an address is shown: without what a URL carries before its host and
  // after its path.
  resticIdentifier?: { value: string; shortened: boolean };
  frequency: Duration;
  config: { key: string; value: string }[];
  readiness: RepositoryReadiness;
  // What Velero says beside the phase, every address in it shown as an address is.
  message?: { value: string; shortened: boolean };
  // The time of the last maintenance that succeeded, which is what the release writes there.
  lastMaintenance?: number;
  // The recent maintenances, the newest first by their start, whatever their order in the object.
  maintenances: Maintenance[];
  // The newest of them failed: a mark beside the time of the last one that succeeded.
  newestFailed: boolean;
  created?: number;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

// Newest first, by the start; what has no start goes after what has one.
function newestFirst(one: Maintenance, other: Maintenance): number {
  if (one.started === undefined || other.started === undefined) {
    return one.started === other.started ? 0 : one.started === undefined ? 1 : -1;
  }
  return other.started - one.started;
}

export function repositoryView(repository: BackupRepositoryResource): RepositoryView {
  const { spec, status } = repository;
  const recent = Array.isArray(status?.recentMaintenance) ? status.recentMaintenance : [];
  const maintenances = recent
    .filter((entry) => entry !== null && typeof entry === "object")
    .map((entry): Maintenance => {
      const started = timestamp(entry.startTimestamp);
      const completed = timestamp(entry.completeTimestamp);

      return {
        result: maintenanceResult(entry.result),
        ...(started === undefined ? {} : { started }),
        ...(completed === undefined ? {} : { completed }),
        ...(started !== undefined && completed !== undefined && completed >= started
          ? { milliseconds: completed - started }
          : {}),
        ...(text(entry.message) ? { message: shownText(entry.message ?? "") } : {}),
      };
    })
    .sort(newestFirst);
  const config = spec?.repositoryConfig && typeof spec.repositoryConfig === "object" ? spec.repositoryConfig : {};
  const last = timestamp(status?.lastMaintenanceTime);
  const created = timestamp(repository.metadata.creationTimestamp);

  return {
    name: repository.metadata.name,
    namespace: repository.metadata.namespace ?? "",
    ...(repository.metadata.uid ? { uid: repository.metadata.uid } : {}),
    ...(text(spec?.volumeNamespace) ? { volumeNamespace: spec?.volumeNamespace } : {}),
    ...(text(spec?.backupStorageLocation) ? { location: spec?.backupStorageLocation } : {}),
    ...(text(spec?.repositoryType) ? { type: spec?.repositoryType } : {}),
    ...(text(spec?.resticIdentifier) ? { resticIdentifier: shownText(spec?.resticIdentifier ?? "") } : {}),
    frequency: duration(spec?.maintenanceFrequency),
    config: Object.entries(config)
      .map(([key, value]) => ({ key, value: typeof value === "string" ? value : JSON.stringify(value) }))
      .sort((one, other) => (one.key < other.key ? -1 : one.key > other.key ? 1 : 0)),
    readiness: repositoryReadiness(status?.phase),
    ...(text(status?.message) ? { message: shownText(status?.message ?? "") } : {}),
    ...(last === undefined ? {} : { lastMaintenance: last }),
    maintenances,
    newestFailed: maintenances[0]?.result.result === "failed",
    ...(created === undefined ? {} : { created }),
  };
}

// When the next maintenance of a repository is due, by the clock of this machine (SPEC-0014, REQ-183).
export type Due =
  // The last maintenance is older than the frequency, by `late`.
  | { state: "due"; late: number }
  // Ready, with no time of a last maintenance.
  | { state: "due-no-time" }
  | { state: "not-due"; at: number; left: number }
  // The server fills a frequency that is not set: nothing is computed until it does.
  | { state: "frequency-not-set" }
  | { state: "frequency-unreadable"; written: string }
  // The server maintains only a repository that is ready.
  | { state: "not-ready" }
  // The server runs no maintenance of a repository of a read-only location.
  | { state: "read-only" }
  // Whether the location is read-only is not known: it is not read, denied, or not there.
  | { state: "access-unknown" };

// `readOnly` is undefined when the location of the repository is not known.
export function maintenanceDue(view: RepositoryView, now: number, readOnly: boolean | undefined): Due {
  const { frequency } = view;

  if (!frequency.read) {
    return "written" in frequency && frequency.written !== undefined
      ? { state: "frequency-unreadable", written: frequency.written }
      : { state: "frequency-not-set" };
  }
  if (view.readiness.readiness !== "ready") return { state: "not-ready" };
  if (readOnly) return { state: "read-only" };
  if (readOnly === undefined) return { state: "access-unknown" };
  if (view.lastMaintenance === undefined) return { state: "due-no-time" };
  const at = view.lastMaintenance + frequency.milliseconds;

  return at <= now ? { state: "due", late: now - at } : { state: "not-due", at, left: at - now };
}

export function dueText(due: Due): string {
  switch (due.state) {
    case "due":
      return REPOSITORY_WORDS.due(formatDuration(due.late));
    case "due-no-time":
      return REPOSITORY_WORDS.dueNoTime;
    case "not-due":
      return REPOSITORY_WORDS.notDue(formatDuration(due.left));
    case "frequency-not-set":
      return REPOSITORY_WORDS.frequencyNotSet;
    case "frequency-unreadable":
      return REPOSITORY_WORDS.frequencyUnreadable(due.written);
    case "not-ready":
      return REPOSITORY_WORDS.notReadyNoMaintenance;
    case "access-unknown":
      return REPOSITORY_WORDS.accessUnknown;
    default:
      return REPOSITORY_WORDS.readOnly;
  }
}

// The frequency as the object writes it, or what it is when it writes none.
export function repositoryFrequencyText(frequency: Duration): string {
  return "written" in frequency && frequency.written !== undefined ? frequency.written : REPOSITORY_WORDS.notSet;
}

// What the search of the list looks into: what the columns show, and the message of Velero.
export function repositorySearch(view: RepositoryView): string[] {
  return [
    view.name,
    view.namespace,
    view.volumeNamespace ?? "",
    view.location ?? "",
    view.type ?? REPOSITORY_WORDS.notSet,
    view.readiness.reported ?? "",
    view.readiness.label,
    view.message?.value ?? "",
    repositoryFrequencyText(view.frequency),
  ].filter(Boolean);
}

// An order for each column. None is undefined or NaN: what has no value is last in the first order a click gives,
// and first in the second.
export const REPOSITORY_SORTING = {
  name: (view: RepositoryView) => view.name,
  namespace: (view: RepositoryView) => view.namespace,
  volumeNamespace: (view: RepositoryView) => view.volumeNamespace ?? "",
  location: (view: RepositoryView) => view.location ?? "",
  type: (view: RepositoryView) => view.type ?? "",
  readiness: (view: RepositoryView) => [READINESS_RANK[view.readiness.readiness], view.readiness.reported ?? ""],
  maintained: (view: RepositoryView) => (view.lastMaintenance === undefined ? [1, 0] : [0, view.lastMaintenance]),
  frequency: (view: RepositoryView) => (view.frequency.read ? view.frequency.milliseconds : -1),
  age: (view: RepositoryView) => -(view.created ?? 0),
};
