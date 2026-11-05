/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

// What the suites of the backup repositories and of the pod volume operations expect a view to show, computed
// from the object as the cluster holds it and from the clock, by the rules of the reviewed release that SPEC-0014
// records, and never by the code of the extension. The words are the ones the module of the words writes, copied
// here as they are written; a time and a duration are written here in the form of the views.

import type { Locator } from "playwright";

/**
 * The value of a fact of a view, by the name it is given: the text of the part beside its name, whitespace made one
 * space and the names of its icons left out. The facts of a view are drawn as a name and a value, the value right after the name.
 */
export async function factOf(view: Locator, name: string): Promise<string> {
  const value = view.locator(`xpath=.//div[normalize-space(.)="${name}"]/following-sibling::div[1]`).first();

  await value.waitFor({ state: "visible", timeout: 60_000 });
  // Without the names of its icons, which the font draws as marks: as the cells of a row are read.
  return value.evaluate((element) => {
    const copy = element.cloneNode(true) as HTMLElement;

    for (const icon of copy.querySelectorAll(".Icon")) icon.remove();
    return (copy.textContent ?? "").replace(/\s+/g, " ").trim();
  });
}

/** The words of the views of a repository, as the module of the words writes them. */
export const REPOSITORY_WORDS = {
  notSet: "Not set",
  neverMaintained: "Never maintained",
  newestFailed: "the newest maintenance failed",
  newestFailedNote: "The newest maintenance failed: this is the last that succeeded.",
  notReadyNoMaintenance: "A repository that is not ready is not maintained.",
  dueNoTime: "Due now: the repository is ready and has no time of a last maintenance.",
  due: (late: string) =>
    `Due: the last maintenance is older than the frequency, by ${late}, by the clock of this machine.`,
  notDue: (left: string) => `Due in ${left}, by the clock of this machine.`,
};

/**
 * The milliseconds of a duration the way the fixtures and the release write a frequency, hours, minutes and seconds,
 * as `168h0m0s`; undefined for another form, which no fixture writes.
 */
export function goDurationMilliseconds(written: string | undefined): number | undefined {
  const parts = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(written ?? "");

  if (!written || !parts) return undefined;
  const [, hours = "0", minutes = "0", seconds = "0"] = parts;

  return ((Number(hours) * 60 + Number(minutes)) * 60 + Number(seconds)) * 1000;
}

/**
 * What the next maintenance of a repository of a location that can be written may say when it is read between two
 * readings of the clock: that a repository that is not ready is not maintained; due now, with no time of a last
 * maintenance; due, late by how long; or due in how long. The server looks at a repository every five minutes, and
 * starts a maintenance that is due at its next look.
 */
export function dueTexts(repository: RepositoryObject, readFrom: number, readTo: number): string[] {
  const frequency = goDurationMilliseconds(repository.spec?.maintenanceFrequency);
  const last = repository.status?.lastMaintenanceTime;

  if (frequency === undefined) throw new Error(`The fixture ${repository.metadata.name} writes no frequency`);
  if (readinessOf(repository) !== READINESS.ready) return [REPOSITORY_WORDS.notReadyNoMaintenance];
  if (!last) return [REPOSITORY_WORDS.dueNoTime];
  const at = Date.parse(last) + frequency;

  return [
    ...new Set(
      [readFrom, readTo].map((now) =>
        at <= now ? REPOSITORY_WORDS.due(durationText(now - at)) : REPOSITORY_WORDS.notDue(durationText(at - now)),
      ),
    ),
  ];
}

/**
 * The recent maintenances of a repository as its view lists them, newest first: the result, the duration between
 * the start and the completion, and the message.
 */
export function maintenanceRows(repository: RepositoryObject): { result: string; duration: string; message: string }[] {
  return [...(repository.status?.recentMaintenance ?? [])]
    .sort((one, other) => Date.parse(other.startTimestamp ?? "") - Date.parse(one.startTimestamp ?? ""))
    .map((maintenance) => ({
      result: maintenance.result ?? "",
      duration: durationText(
        Date.parse(maintenance.completeTimestamp ?? "") - Date.parse(maintenance.startTimestamp ?? ""),
      ),
      message: maintenance.message ?? "",
    }));
}

/**
 * How much older than the moment a view is read its clock may be: the views take the clock again every five seconds,
 * with a second more for the frame that draws them. A suite reads the clock before and after it reads a view, and
 * moves the first reading back by this much.
 */
export const VIEW_CLOCK_LAG = 6000;

/** How long ago a time was, as a view writes it in parentheses after the time, at either of two readings of the clock. */
export function agoTexts(time: string, readFrom: number, readTo: number): string[] {
  const at = Date.parse(time);

  return [...new Set([readFrom, readTo].map((now) => `(${durationText(now - at)} ago)`))];
}

/** The readiness of a repository, by the phase the release writes into its status. */
export const READINESS = {
  ready: { word: "Ready", rank: 0 },
  notReady: { word: "Not ready", rank: 1 },
  notInitialized: { word: "Not initialized yet", rank: 2 },
} as const;

/** A BackupRepository as the cluster holds it, with what the views read of it. */
export interface RepositoryObject {
  metadata: { name: string; namespace: string; creationTimestamp?: string };
  spec?: {
    volumeNamespace?: string;
    backupStorageLocation?: string;
    repositoryType?: string;
    resticIdentifier?: string;
    maintenanceFrequency?: string;
  };
  status?: {
    phase?: string;
    message?: string;
    lastMaintenanceTime?: string;
    recentMaintenance?: { startTimestamp?: string; completeTimestamp?: string; result?: string; message?: string }[];
  };
}

/**
 * The readiness of a repository: none until the release initializes it, which writes `New` first and then
 * `Ready` or `NotReady`.
 */
export function readinessOf(repository: RepositoryObject): (typeof READINESS)[keyof typeof READINESS] {
  switch (repository.status?.phase) {
    case "Ready":
      return READINESS.ready;
    case "NotReady":
      return READINESS.notReady;
    default:
      return READINESS.notInitialized;
  }
}

/**
 * Whether the newest maintenance of a repository failed: the newest of its recent maintenances by their start,
 * which the release keeps newest last, whose result is Failed. Its last maintenance is then the one before.
 */
export function newestMaintenanceFailed(repository: RepositoryObject): boolean {
  const recent = [...(repository.status?.recentMaintenance ?? [])].sort(
    (one, other) => Date.parse(one.startTimestamp ?? "") - Date.parse(other.startTimestamp ?? ""),
  );

  return recent.at(-1)?.result === "Failed";
}

/** A duration as the views write it: its two largest units that are not zero, from days to seconds. */
function durationText(milliseconds: number): string {
  const seconds = Math.floor(milliseconds / 1000);
  const parts: [number, string][] = [
    [Math.floor(seconds / 86_400), "d"],
    [Math.floor((seconds % 86_400) / 3600), "h"],
    [Math.floor((seconds % 3600) / 60), "m"],
    [seconds % 60, "s"],
  ];
  const first = parts.findIndex(([value]) => value > 0);

  if (first === -1) return "0s";
  return parts
    .slice(first, first + 2)
    .filter(([value]) => value > 0)
    .map(([value, unit]) => `${value}${unit}`)
    .join(" ");
}

/**
 * What the cell of the last maintenance of a repository may say when it is read between two readings of the
 * clock: how long ago the last maintenance was at either of them, with the words of a newest one that failed,
 * or that there was none.
 */
export function maintainedTexts(repository: RepositoryObject, readFrom: number, readTo: number): string[] {
  const last = repository.status?.lastMaintenanceTime;
  const failed = newestMaintenanceFailed(repository) ? `, ${REPOSITORY_WORDS.newestFailed}` : "";

  if (!last) return [`${REPOSITORY_WORDS.neverMaintained}${failed}`];
  const at = Date.parse(last);

  return [...new Set([readFrom, readTo].map((now) => `${durationText(now - at)} ago${failed}`))];
}

/** What the cells of the row of a repository show that does not depend on the clock, by their columns. */
export function repositoryCells(repository: RepositoryObject): Record<string, string> {
  return {
    name: repository.metadata.name,
    installation: repository.metadata.namespace,
    "volume-namespace": repository.spec?.volumeNamespace ?? REPOSITORY_WORDS.notSet,
    location: repository.spec?.backupStorageLocation ?? REPOSITORY_WORDS.notSet,
    "repository-type": repository.spec?.repositoryType || REPOSITORY_WORDS.notSet,
    readiness: readinessOf(repository).word,
    frequency: repository.spec?.maintenanceFrequency ?? REPOSITORY_WORDS.notSet,
  };
}

/**
 * What the view of a pod volume backup says of each phase the release writes, as the module of the words writes it:
 * one with no phase is said as New, waiting for the node agent.
 */
export const BACKUP_PHASE_SENTENCES: Record<string, string> = {
  New: "It waits for the node agent of the node of its pod to accept it. Whether one runs there is not read by the extension, and waiting is not a failure.",
  Accepted:
    "A node agent accepted it, and a pod is being made to reach the volume. The node agent fails it after its preparing timeout, a setting of the installation the extension does not read.",
  Prepared:
    "The pod that reaches the volume runs on the node: the node agent of that node is about to start the data path.",
  InProgress: "The data path is moving the bytes of the volume.",
  Canceling: "The cancellation was asked: the data path is being stopped.",
  Completed: "The data path ended.",
  Failed:
    "The operation failed: the message says why. A start equal to the completion is one the failure wrote; no time at all is one the preparing timeout wrote.",
  Canceled:
    "The operation was canceled: neither a success nor a failure. The release cancels one when its backup or restore times out, when the server or the node agent restarts, or when its pod cannot run.",
};
