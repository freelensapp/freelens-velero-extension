// The volume information of an operation, as the release writes it: a list, one entry for each volume,
// with what was done with it and the details of how. A pure function on the text that was loaded: what
// is not of that shape is answered with nothing, and is shown as the text it is.

export interface VolumeField {
  name: string;
  value: string;
}

export interface VolumeDetail {
  // The key of the entry the detail is under, and what the tab calls it.
  key: string;
  title: string;
  // Each field by the name it is written with, in the order it is written.
  fields: VolumeField[];
}

// A method or a result as it is written, and whether it is one the reviewed release writes.
export interface Stated {
  text: string;
  known: boolean;
}

export interface VolumeRow {
  claim?: string;
  namespace?: string;
  volume?: string;
  // How the volume was backed up, or restored.
  method?: Stated;
  // Of a backup: how it ended, whether the local snapshot was kept, whether the volume was skipped and why,
  // and when the work on it began and ended.
  result?: Stated;
  moved?: boolean;
  kept?: boolean;
  skipped?: boolean;
  reason?: string;
  start?: string;
  end?: string;
  // In bytes, from the detail that carries one.
  size?: number;
  details: VolumeDetail[];
  // The fields of the entry the tab does not know, each by its name and its value.
  others: VolumeField[];
}

const METHODS = {
  Backup: ["NativeSnapshot", "PodVolumeBackup", "CSISnapshot"],
  Restore: ["NativeSnapshot", "PodVolumeRestore", "CSISnapshot"],
};
const RESULTS = ["succeeded", "failed"];
// The details of an entry, in the order the tab shows them.
const DETAILS: Record<"Backup" | "Restore", [string, string][]> = {
  Backup: [
    ["csiSnapshotInfo", "CSI snapshot"],
    ["snapshotDataMovementInfo", "Data movement"],
    ["nativeSnapshotInfo", "Native snapshot"],
    ["pvbInfo", "Pod volume backup"],
    ["pvInfo", "Volume"],
  ],
  Restore: [
    ["csiSnapshotInfo", "CSI snapshot"],
    ["snapshotDataMovementInfo", "Data movement"],
    ["nativeSnapshotInfo", "Native snapshot"],
    ["pvrInfo", "Pod volume restore"],
  ],
};
// The details a size is read from, in the order they are asked: what was moved, then the snapshot, then
// the pod volume.
const SIZED = ["snapshotDataMovementInfo", "csiSnapshotInfo", "pvbInfo", "pvrInfo"];
const TEXTS: Record<"Backup" | "Restore", [string, "claim" | "namespace" | "volume" | "reason" | "start" | "end"][]> = {
  Backup: [
    ["pvcName", "claim"],
    ["pvcNamespace", "namespace"],
    ["pvName", "volume"],
    ["skippedReason", "reason"],
    ["startTimestamp", "start"],
    ["completionTimestamp", "end"],
  ],
  Restore: [
    ["pvcName", "claim"],
    ["pvcNamespace", "namespace"],
    ["pvName", "volume"],
  ],
};
const MARKS: Record<"Backup" | "Restore", [string, "moved" | "kept" | "skipped"][]> = {
  Backup: [
    ["snapshotDataMoved", "moved"],
    ["preserveLocalSnapshot", "kept"],
    ["skipped", "skipped"],
  ],
  Restore: [["snapshotDataMoved", "moved"]],
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// The value of a field as a text: a text as it is, a map of texts as its pairs, anything else as the JSON
// it is written as.
function shown(value: unknown): string {
  if (typeof value === "string") return value;
  if (isObject(value) && Object.values(value).every((entry) => typeof entry === "string"))
    return Object.entries(value)
      .map(([key, entry]) => `${key}=${entry}`)
      .join(", ");
  return JSON.stringify(value);
}

function row(entry: Record<string, unknown>, of: "Backup" | "Restore"): VolumeRow | undefined {
  const read: VolumeRow = { details: [], others: [] };
  const known = new Set<string>();
  const methodKey = of === "Backup" ? "backupMethod" : "restoreMethod";

  for (const [key, field] of TEXTS[of]) {
    known.add(key);
    if (entry[key] === undefined) continue;
    if (typeof entry[key] !== "string") return undefined;
    // What the release leaves out when it is empty is left out here when it is written empty.
    if (entry[key]) read[field] = entry[key];
  }
  for (const [key, field] of MARKS[of]) {
    known.add(key);
    if (entry[key] === undefined) continue;
    if (typeof entry[key] !== "boolean") return undefined;
    read[field] = entry[key];
  }
  for (const [key, field, written] of [
    [methodKey, "method", METHODS[of]],
    ...(of === "Backup" ? [["result", "result", RESULTS]] : []),
  ] as [string, "method" | "result", string[]][]) {
    known.add(key);
    if (entry[key] === undefined) continue;
    if (typeof entry[key] !== "string") return undefined;
    if (entry[key]) read[field] = { text: entry[key], known: written.includes(entry[key]) };
  }
  for (const [key, title] of DETAILS[of]) {
    known.add(key);
    const detail = entry[key];

    if (detail === undefined) continue;
    if (!isObject(detail)) return undefined;
    read.details.push({
      key,
      title,
      fields: Object.keys(detail).map((name) => ({ name, value: shown(detail[name]) })),
    });
  }
  for (const key of SIZED) {
    const size = (entry[key] as { size?: unknown } | undefined)?.size;

    // A size of zero is what the release writes for one it does not know.
    if (typeof size === "number" && Number.isFinite(size) && size > 0) {
      read.size = size;
      break;
    }
  }
  for (const name of Object.keys(entry)) if (!known.has(name)) read.others.push({ name, value: shown(entry[name]) });
  return read;
}

// The volumes of a backup or of a restore, one row for each, or nothing for a text that is not of the
// shape the release writes: what is not JSON, what is not a list of entries, a field the release writes as
// a text, a mark or an object and that is not one. An operation with no volume is an empty list. Nothing
// is raised, whatever the text: the viewer that calls this draws the text in the place of the rows.
export function parseVolumes(text: string, of: "Backup" | "Restore"): VolumeRow[] | undefined {
  let value: unknown;

  try {
    value = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (!Array.isArray(value)) return undefined;
  const rows: VolumeRow[] = [];

  // A value the runtime read may be one it cannot write back as the text of a field, as lists nested
  // too deep are: what a row raises for is not of the shape of the release, and is shown as text.
  try {
    for (const entry of value) {
      const read = isObject(entry) ? row(entry, of) : undefined;

      if (!read) return undefined;
      rows.push(read);
    }
  } catch {
    return undefined;
  }
  return rows;
}

// The words of the tab of the volumes, written once beside what they are said of.

// What a cell says of what an entry does not say. A cell is never left empty: an empty one reads as a no.
export const NOT_STATED = "Not stated";

// A mark of an entry in words: what it says, or that the entry does not say it.
export function markText(mark: boolean | undefined): string {
  if (mark === undefined) return NOT_STATED;
  return mark ? "Yes" : "No";
}

// A size in bytes in the unit that reads best: a size that would be written as 1024.0 of a unit is one of
// the unit above.
export function sizeText(size: number): string {
  if (size < 1024) return `${size} B`;
  const units = ["KiB", "MiB", "GiB", "TiB", "PiB"];
  let value = size / 1024;
  let unit = 0;

  while (Math.round(value * 10) >= 10240 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(1)} ${units[unit]}`;
}

// The bytes of a size as they are counted: what is read by who points at a size.
export function bytesText(size: number): string {
  return `${size} ${size === 1 ? "byte" : "bytes"}`;
}

// How many volumes Velero recorded for an operation, or that it recorded none: an operation with no
// volume has its file, with an empty list in it.
export function volumesCount(count: number, of: "Backup" | "Restore"): string {
  const operation = of.toLowerCase();

  if (!count) return `Velero recorded no volume for this ${operation}.`;
  return `Velero recorded ${count} ${count === 1 ? "volume" : "volumes"} for this ${operation}.`;
}

// What is said beside a method or a result the reviewed release does not write: its text is kept, and
// what it means is not known.
export function notWritten(what: "method" | "result"): string {
  return `Not a ${what} of the reviewed release`;
}

// The note over a text that is not of the shape the release writes, which is shown as the text it is.
export function otherShape(of: "Backup" | "Restore"): string {
  return `The volume information of this ${of.toLowerCase()} is not of the shape the extension was written for: it is shown as the text it is.`;
}

// What the command that opens the details of a row is called: by the volume, by its claim when the entry
// names no volume, or by the place of the row in the list when it names neither.
export function detailsOf(row: VolumeRow, index: number): string {
  if (row.volume) return `Details of the volume ${row.volume}`;
  if (row.claim) return `Details of the volume of the claim ${row.namespace ? `${row.namespace}/` : ""}${row.claim}`;
  return `Details of volume ${index + 1}`;
}

// What is said under a claim: the namespace it is in, or that the entry names a claim and not its
// namespace. An entry that names neither has nothing under what it says of the claim.
export function claimNamespace(row: VolumeRow): string | undefined {
  if (row.namespace) return `in ${row.namespace}`;
  return row.claim ? "Namespace not stated" : undefined;
}

// Why a volume was skipped: the reason the entry writes, wherever it writes one, or that an entry that
// says the volume was skipped states none.
export function skippedReason(row: VolumeRow): string | undefined {
  return row.reason ?? (row.skipped ? "No reason stated" : undefined);
}

// What the details of a row say when its entry carries none, and what a detail says when it is written
// with no field.
export const NO_DETAILS = "The entry of this volume carries no details.";
export const NO_FIELDS = "It is written with no field.";
// What the fields of an entry the tab does not know are shown under.
export const OTHER_FIELDS = "Other fields of the entry";
// What stands for the value of a field that is written empty.
export const EMPTY = "Empty";
