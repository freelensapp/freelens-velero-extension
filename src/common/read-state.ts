// What is known of one family of resources in one installation. Each family has its own: a list that
// is denied takes nothing away from the ones that were read, and does not become a count of zero.

export type ReadStatus =
  // Nothing was asked yet.
  | "idle"
  | "loading"
  | "ready"
  // The API answered that the reader may not.
  | "forbidden"
  // The API does not serve this kind.
  | "not-served"
  // Anything else, including an error without a status the extension can rely on.
  | "failed";

export interface FamilyRead<Item> {
  status: ReadStatus;
  // The items of the last read that succeeded. With any status but `ready` they are what was known then.
  items: Item[];
  // When that read succeeded, in milliseconds.
  lastSuccess?: number;
}

export function emptyRead<Item>(): FamilyRead<Item> {
  return { status: "idle", items: [] };
}

// The items are of an earlier read, and the last one did not succeed.
export function isStale(read: FamilyRead<unknown>): boolean {
  return read.status !== "ready" && read.lastSuccess !== undefined;
}

// A number of items can be shown as a number only when the list behind it was read, now or before.
export function hasItems(read: FamilyRead<unknown>): boolean {
  return read.status === "ready" || read.lastSuccess !== undefined;
}

// The status of a read as the API reports it, from the code of its answer and from nothing else:
// the text of an error is written for a person, in the language of the host.
export function failedStatus(code: unknown): Exclude<ReadStatus, "idle" | "loading" | "ready"> {
  if (code === 403 || code === 401) return "forbidden";
  if (code === 404) return "not-served";
  return "failed";
}

export function succeeded<Item>(items: Item[], now: number): FamilyRead<Item> {
  return { status: "ready", items, lastSuccess: now };
}

// A read that did not succeed keeps what the one before it had read.
export function failed<Item>(
  previous: FamilyRead<Item>,
  status: Exclude<ReadStatus, "idle" | "loading" | "ready">,
): FamilyRead<Item> {
  return { status, items: previous.items, lastSuccess: previous.lastSuccess };
}

export function loading<Item>(previous: FamilyRead<Item>): FamilyRead<Item> {
  return { status: "loading", items: previous.items, lastSuccess: previous.lastSuccess };
}
