import { formatDuration, timestamp } from "./duration";
import { duration } from "./go-duration";

import type { Duration } from "./go-duration";
import type { BackupStorageLocationResource, SecretKeyReference, VolumeSnapshotLocationResource } from "./types";

// What the views show of a storage location and of a snapshot location: one reading of the object,
// wherever the location is shown. Availability, access mode and default are three facts.

export const NOT_REPORTED = "Not reported";
export const NOT_SET = "Not set";

export type Availability =
  | "available"
  | "unavailable"
  // The object has no phase: nothing was said of the location.
  | "not-reported"
  // A phase this version does not know.
  | "unknown";

export interface AvailabilityState {
  // The text the object reports, kept as it is; absent when the object reports none.
  reported?: string;
  availability: Availability;
  label: string;
}

const PHASES: Record<string, { availability: Availability; label: string }> = {
  Available: { availability: "available", label: "Available" },
  Unavailable: { availability: "unavailable", label: "Unavailable" },
};

// Nothing but a reported Available is available.
export function availabilityState(phase: unknown): AvailabilityState {
  if (typeof phase !== "string" || phase === "") return { availability: "not-reported", label: NOT_REPORTED };
  const known = PHASES[phase];

  return known
    ? { reported: phase, ...known }
    : { reported: phase, availability: "unknown", label: `Unknown: ${phase}` };
}

// After how long an availability is said possibly out of date. The release gives no threshold: these are
// the two the spec chose. A location that names its frequency is late after three validations that did not
// come; one that names none, or that turned the validation off, after one hour.
export const LATE_VALIDATIONS = 3;
export const LATE_WITHOUT_FREQUENCY = 3_600_000;
// The release looks every ten seconds for the locations that are due, and the views read every fifteen:
// under a minute a bound would say late of a location that is validated in time.
export const LATE_AT_LEAST = 60_000;

// Names are put in order by their characters, which is the same on every machine.
function byName(one: string, other: string): number {
  return one < other ? -1 : one > other ? 1 : 0;
}

export type Frequency =
  // The location names it, above zero.
  | { of: "location"; milliseconds: number; written: string }
  // The location names zero: the periodic validation is turned off.
  | { of: "off"; written: string }
  // The location names none, or one that is below zero or cannot be read: the release takes the one of
  // its server, which no object of the views holds.
  | { of: "server"; written?: string };

export function validationFrequency(value: unknown): Frequency {
  const read = duration(value);

  if (read.read && read.milliseconds > 0)
    return { of: "location", milliseconds: read.milliseconds, written: read.written };
  if (read.read && read.milliseconds === 0) return { of: "off", written: read.written };
  return "written" in read ? { of: "server", written: read.written } : { of: "server" };
}

export interface Validation {
  // When the location was last validated. Absent when the object reports no time.
  at?: number;
  // How long ago, at the clock of the caller. Absent with `at`, and never below zero.
  age?: number;
  frequency: Frequency;
  // The last validation is older than what the frequency allows: what the location says of its
  // availability may be out of date.
  late: boolean;
}

export function validation(location: BackupStorageLocationResource, now: number): Validation {
  const at = timestamp(location.status?.lastValidationTime);
  const frequency = validationFrequency(location.spec?.validationFrequency);

  if (at === undefined) return { frequency, late: false };
  const age = Math.max(0, now - at);
  return { at, age, frequency, late: age > lateAfter(frequency) };
}

// After how long a validation is late, in milliseconds.
export function lateAfter(frequency: Frequency): number {
  return frequency.of === "location"
    ? Math.max(LATE_VALIDATIONS * frequency.milliseconds, LATE_AT_LEAST)
    : LATE_WITHOUT_FREQUENCY;
}

// What is to be said of the frequency, which is what the last validation is read by.
export function frequencyText(frequency: Frequency): string {
  switch (frequency.of) {
    case "location":
      return `Every ${frequency.written}`;
    case "off":
      return "Turned off";
    default:
      return frequency.written === undefined ? NOT_SET : `Not read: ${frequency.written}`;
  }
}

export function frequencyNote(frequency: Frequency): string {
  switch (frequency.of) {
    case "location":
      return "";
    case "off":
      return "The periodic validation is turned off: the availability is the one of the last validation.";
    default:
      return frequency.written === undefined
        ? "The frequency is the one of the server of Velero, which this view does not read."
        : "This is not a frequency the release takes: it uses the one of its server, which this view does not read.";
  }
}

export const NEVER_VALIDATED = "Never validated";

// How long ago the last validation was, in words; nothing when the object reports no validation.
export function validationAge(state: Validation): string {
  return state.age === undefined ? "" : `${formatDuration(state.age)} ago`;
}

// What a list says of the last validation: how long ago it was, which is what is read at a glance, and
// that what the location reports may not hold any more. When it was is in the view of the location.
export const MAY_BE_OUT_OF_DATE = "may be out of date";

export function validationSummary(state: Validation): string {
  if (state.age === undefined) return NEVER_VALIDATED;
  return state.late ? `${validationAge(state)}, ${MAY_BE_OUT_OF_DATE}` : validationAge(state);
}

// What the status says of a location is as old as its last validation: a server of Velero that stopped
// leaves every availability as it was.
export function lateNote(state: Validation): string {
  if (!state.late) return "";
  const bound =
    state.frequency.of !== "location"
      ? "one hour"
      : LATE_VALIDATIONS * state.frequency.milliseconds < LATE_AT_LEAST
        ? "one minute"
        : `${LATE_VALIDATIONS} times the frequency`;

  // The age is counted by the clock of the machine that shows it, which may not be the one of the cluster.
  return `The availability may be out of date: the last validation is older than ${bound}, by the clock of this machine.`;
}

export type AccessMode = "ReadWrite" | "ReadOnly" | "not-set" | "unknown";

export interface Access {
  mode: AccessMode;
  written?: string;
  label: string;
}

// The access mode is the one of the spec, and nothing else.
export function accessMode(location: BackupStorageLocationResource): Access {
  const written = location.spec?.accessMode;

  if (typeof written !== "string" || written === "") return { mode: "not-set", label: NOT_SET };
  if (written === "ReadWrite") return { mode: "ReadWrite", written, label: "Read and write" };
  if (written === "ReadOnly") return { mode: "ReadOnly", written, label: "Read only" };
  return { mode: "unknown", written, label: `Unknown: ${written}` };
}

export function accessNote(access: Access, availability: AvailabilityState): string {
  switch (access.mode) {
    case "ReadOnly":
      return availability.availability === "available"
        ? "The location is available and read-only: it does not take new backups."
        : "The release refuses a backup sent to a location that is read-only.";
    case "not-set":
      return "The release refuses a backup for the access mode only when it is read-only.";
    case "unknown":
      return "The release refuses a backup for the access mode only when it is ReadOnly.";
    default:
      return "";
  }
}

export interface Reference {
  name: string;
  key?: string;
}

function reference(value: SecretKeyReference | null | undefined): Reference | undefined {
  const name = typeof value?.name === "string" && value.name !== "" ? value.name : undefined;
  const key = typeof value?.key === "string" && value.key !== "" ? value.key : undefined;

  if (name === undefined && key === undefined) return undefined;
  return { name: name ?? "", ...(key ? { key } : {}) };
}

export function referenceText(value: Reference | undefined): string {
  if (!value) return NOT_SET;
  const name = value.name === "" ? "a Secret that is not named" : `Secret ${value.name}`;

  return value.key ? `${name}, key ${value.key}` : name;
}

// How many bytes a certificate written in the object has. Its content is not read: the length of what
// encodes it says how long it is.
export function encodedBytes(value: unknown): number | undefined {
  if (typeof value !== "string" || value === "") return undefined;
  const text = value.replace(/\s+/g, "");

  if (!/^[A-Za-z0-9+/_-]*={0,2}$/.test(text)) return undefined;
  const padding = text.endsWith("==") ? 2 : text.endsWith("=") ? 1 : 0;
  const body = text.length - padding;

  return Math.floor((body * 3) / 4);
}

export interface ConfigEntry {
  key: string;
  // As it is shown: a URL without its user information and its query.
  value: string;
  // Something of the value was left out of what is shown.
  shortened: boolean;
  // What the key turns off, in words, when the release is known to read it so.
  mark?: string;
}

// A value that reads as a URL is shown without what a URL can carry of a credential: the user information
// before the host, and the query after the path. The configuration of a location is not meant to hold
// secrets, and nothing promises that it holds none.
export function shownValue(value: string): { value: string; shortened: boolean } {
  const scheme = /^(?:[a-z][a-z0-9+.-]*:)?\/\//i.exec(value)?.[0];

  if (scheme === undefined) return { value, shortened: false };
  let rest = value.slice(scheme.length);
  let shortened = false;
  const end = rest.search(/[/?#]/);
  const authority = end === -1 ? rest : rest.slice(0, end);
  // The user information is what is before the at sign of the authority. A password may hold a slash, a
  // question mark or a hash, which end the authority before its at sign: what is left is a name and a
  // colon, and everything before the last at sign goes with them.
  const user = authority.includes("@")
    ? authority.lastIndexOf("@")
    : authority.includes(":")
      ? rest.lastIndexOf("@")
      : -1;

  if (user !== -1) {
    shortened = true;
    rest = rest.slice(user + 1);
  }
  const cut = rest.search(/[?#]/);

  if (cut !== -1) {
    shortened = shortened || rest.length - cut > 1;
    rest = rest.slice(0, cut);
  }
  return { value: scheme + rest, shortened };
}

// A text that may quote an address, as what Velero says of a location it could not reach: every address
// in it is shown as a value that reads as one.
export function shownText(text: string): { value: string; shortened: boolean } {
  let shortened = false;
  const value = text.replace(/[a-z][a-z0-9+.-]*:\/\/[^\s"'<>]+/gi, (address) => {
    const shown = shownValue(address);

    shortened = shortened || shown.shortened;
    return shown.value;
  });

  return { value, shortened };
}

export const LEFT_OUT = "What a URL carries before its host and after its path is left out of what is shown.";

// What the reviewed release reads as true in the text of a key: it parses it as Go parses a boolean.
const READ_AS_TRUE = new Set(["1", "t", "T", "TRUE", "true", "True"]);
const BACKENDS = ["velero.io/aws", "velero.io/azure", "velero.io/gcp", "velero.io/fs"];

// The release takes for the backend of AWS the provider of that name, with the group of Velero or without
// it, and every provider it does not know whose configuration names an address of S3.
export function awsBackend(provider: string | undefined, config: Record<string, unknown>): boolean {
  const name = provider === undefined || provider.includes("/") ? provider : `velero.io/${provider}`;

  if (name === "velero.io/aws") return true;
  return !BACKENDS.includes(name ?? "") && typeof config.s3Url === "string" && config.s3Url !== "";
}

export const TLS_NOT_VERIFIED = "The verification of TLS is turned off";
// With another backend the release reads the key for what it moves with restic, and for nothing else it
// was read in.
export const TLS_NOT_VERIFIED_BY_RESTIC =
  "The verification of TLS is turned off for the file system backups the release makes with restic";

// `of` is the kind of location the configuration is of: the key of the verification is one of the storage,
// and what it does to the snapshots was not read.
export function configEntries(
  config: unknown,
  provider: string | undefined,
  of: "storage" | "snapshot" = "storage",
): ConfigEntry[] {
  if (!config || typeof config !== "object" || Array.isArray(config)) return [];
  const entries = config as Record<string, unknown>;

  return Object.entries(entries)
    .map(([key, raw]) => {
      const written = typeof raw === "string" ? raw : JSON.stringify(raw);
      const shown = shownValue(written ?? "");
      const unverified = of === "storage" && key === "insecureSkipTLSVerify" && READ_AS_TRUE.has(written ?? "");

      return {
        key,
        ...shown,
        ...(unverified ? { mark: awsBackend(provider, entries) ? TLS_NOT_VERIFIED : TLS_NOT_VERIFIED_BY_RESTIC } : {}),
      };
    })
    .sort((one, other) => byName(one.key, other.key));
}

export interface Sync {
  period: Duration;
  // When the backups of the location were last synced into the cluster.
  last?: number;
  // How long ago, at the clock of the caller. Absent with `last`, and never below zero.
  age?: number;
}

export const NEVER_SYNCED = "Never synced";

// What a list says of the last sync: how long ago it was. When it was is in the view of the location.
export function syncSummary(sync: Sync): string {
  return sync.age === undefined ? NEVER_SYNCED : `${formatDuration(sync.age)} ago`;
}

export function syncText(sync: Sync): string {
  if (sync.period.read && sync.period.milliseconds === 0) return "Turned off";
  if (sync.period.read && sync.period.milliseconds > 0) return `Every ${sync.period.written}`;
  return "written" in sync.period ? `Not read: ${sync.period.written}` : NOT_SET;
}

// What the release does with the period, which is what the text beside it is read by.
export function syncNote(sync: Sync): string {
  if (sync.period.read && sync.period.milliseconds === 0) {
    return "The sync of the backups of this location is turned off.";
  }
  if (sync.period.read && sync.period.milliseconds > 0) return "";
  return "written" in sync.period
    ? "This is not a period the release takes: it uses the one of its server, which this view does not read."
    : "The period is the one of the server of Velero, which this view does not read.";
}

export interface StorageLocationView {
  name: string;
  namespace: string;
  uid?: string;
  created?: number;
  availability: AvailabilityState;
  // What Velero says beside the phase, with every address in it shown as a value that reads as one.
  message?: string;
  // Something of an address was left out of the message.
  messageShortened: boolean;
  validation: Validation;
  access: Access;
  // The location is marked default in its spec.
  marked: boolean;
  provider?: string;
  bucket?: string;
  prefix?: string;
  config: ConfigEntry[];
  sync: Sync;
  credential?: Reference;
  certificate: { reference?: Reference; inline?: { bytes?: number } };
}

function named(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

function sync(location: BackupStorageLocationResource, now: number): Sync {
  const last = timestamp(location.status?.lastSyncedTime);

  return {
    period: duration(location.spec?.backupSyncPeriod),
    ...(last === undefined ? {} : { last, age: Math.max(0, now - last) }),
  };
}

export function storageLocationView(location: BackupStorageLocationResource, now: number): StorageLocationView {
  const storage = location.spec?.objectStorage;
  const provider = named(location.spec?.provider);
  const inline = storage?.caCert;
  const message = named(location.status?.message);

  return {
    name: location.metadata.name,
    namespace: location.metadata.namespace ?? "",
    uid: location.metadata.uid,
    created: timestamp(location.metadata.creationTimestamp),
    availability: availabilityState(location.status?.phase),
    ...(message === undefined ? {} : { message: shownText(message).value }),
    messageShortened: message !== undefined && shownText(message).shortened,
    validation: validation(location, now),
    access: accessMode(location),
    marked: location.spec?.default === true,
    provider,
    bucket: named(storage?.bucket),
    prefix: named(storage?.prefix),
    config: configEntries(location.spec?.config, provider),
    sync: sync(location, now),
    credential: reference(location.spec?.credential),
    certificate: {
      reference: reference(storage?.caCertRef),
      ...(inline !== undefined && inline !== null && inline !== "" ? { inline: { bytes: encodedBytes(inline) } } : {}),
    },
  };
}

export interface SnapshotLocationView {
  name: string;
  namespace: string;
  uid?: string;
  created?: number;
  // The phase as it is written. The reviewed release neither writes nor checks it.
  phase: AvailabilityState;
  provider?: string;
  config: ConfigEntry[];
  credential?: Reference;
}

export const SNAPSHOT_PHASE_NOTE =
  "The reviewed release neither writes nor checks the phase of a volume snapshot location: what is here was written by something else, or by no one.";

export function snapshotLocationView(location: VolumeSnapshotLocationResource): SnapshotLocationView {
  const provider = named(location.spec?.provider);

  return {
    name: location.metadata.name,
    namespace: location.metadata.namespace ?? "",
    uid: location.metadata.uid,
    created: timestamp(location.metadata.creationTimestamp),
    phase: availabilityState(location.status?.phase),
    provider,
    config: configEntries(location.spec?.config, provider, "snapshot"),
    credential: reference(location.spec?.credential),
  };
}

// How a location is marked in a list. The phase of a snapshot location says nothing the release stands
// behind: whatever it is, it has the mark of what is not known.
export type AvailabilityMark = "available" | "unavailable" | "unknown";

export function availabilityMark(state: AvailabilityState, kind: "storage" | "snapshot"): AvailabilityMark {
  if (kind === "snapshot") return "unknown";
  if (state.availability === "available") return "available";
  return state.availability === "unavailable" ? "unavailable" : "unknown";
}

// Which locations of an installation are marked default. The view never picks one for the operator.
export type Defaults =
  | { state: "one"; names: string[] }
  | { state: "none"; names: string[] }
  // The release sends a backup to the first of them it finds, and keeps marked the one created last.
  // Created in the same second, the release keeps the first of the list it is answered with, which the
  // view does not know: `kept` is absent, and `tied` names the ones it is among.
  | { state: "many"; names: string[]; kept?: string; tied?: string[] };

export function defaults(locations: BackupStorageLocationResource[], namespace: string): Defaults {
  const marked = locations
    .filter((location) => location.metadata.namespace === namespace && location.spec?.default === true)
    .sort((one, other) => byName(one.metadata.name, other.metadata.name));
  const names = marked.map((location) => location.metadata.name);

  if (names.length === 1) return { state: "one", names };
  if (!names.length) return { state: "none", names };
  // The one created last. One whose time of creation cannot be read is older than every other.
  const created = (location: BackupStorageLocationResource) => timestamp(location.metadata.creationTimestamp) ?? 0;
  const newest = Math.max(...marked.map(created));
  const last = marked.filter((location) => created(location) === newest).map((location) => location.metadata.name);

  return { state: "many", names, ...(last.length === 1 ? { kept: last[0] } : { tied: last }) };
}

// What the release does with more than one location marked default, in words.
export function manyDefaultsText(found: Extract<Defaults, { state: "many" }>): string {
  const first = "The reviewed release sends a backup that names no location to the first of them it finds";

  return found.kept
    ? `${first}, and keeps marked the one created last, which is ${found.kept}.`
    : `${first}, and keeps marked the one created last: ${(found.tied ?? []).join(" and ")} were created in the same second, and which of them it keeps is not settled.`;
}

export function defaultsNote(found: Defaults): string {
  switch (found.state) {
    case "none":
      return "No storage location of this installation is marked default. The server of Velero may name one in its settings, which this view does not read.";
    case "many":
      return `${found.names.length} storage locations are marked default: ${found.names.join(", ")}. ${manyDefaultsText(found)}`;
    default:
      return "";
  }
}
