// What the operator allowed the downloads of the artifacts to do beyond what the storage location says by
// itself: an origin the location does not give, a private address, a connection that is not encrypted.
// Each is for one cluster and one origin, with the time it was given, and the first for one storage
// location as well. It holds the origin and nothing after it: no path, no query, no credential. Pure
// functions on plain data: the store of the preferences keeps what they give, and the main process is
// what reads it before a connection is made.

// What an allowance is for:
//   origin: downloads from an origin the storage location does not give, for that location;
//   private: a connection to a private address the name of that origin resolves to;
//   http: a connection that is not encrypted, made directly from this machine.
export const ALLOWANCE_KINDS = ["origin", "private", "http"] as const;
export type AllowanceKind = (typeof ALLOWANCE_KINDS)[number];

export interface Allowance {
  what: AllowanceKind;
  // The scheme, the host and the port, as the runtime writes the origin of a URL.
  origin: string;
  // The storage location an origin is allowed for, as its namespace, a slash and its name: a cluster may
  // have two installations, each with a location of the same name. The two other kinds are of the origin
  // alone.
  location?: string;
  // When it was given, in milliseconds.
  since: number;
}

// The allowances of each cluster, by its identifier.
export type Allowances = Record<string, Allowance[]>;

// What a cluster keeps at most: an operator allows a handful, and a store that grew without bound would
// be read at every download.
export const ALLOWANCES_BOUND = 64;

// A storage location: the label that names its namespace, a slash, and its name.
const LOCATION = /^[a-z0-9]([-a-z0-9]{0,61}[a-z0-9])?\/[a-z0-9]([-a-z0-9.]{0,251}[a-z0-9])?$/;

// How an allowance names a storage location, and how the words say it.
export function locationOf(namespace: string, name: string): string {
  return `${namespace}/${name}`;
}

export function locationWords(location: string | undefined): string {
  const [namespace, name] = (location ?? "").split("/");

  return name ? `${name} of ${namespace}` : (location ?? "");
}

// An origin as the runtime writes it, and nothing else: what parses to another text is not one.
export function isOrigin(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 300 || !/^https?:\/\//.test(value)) return false;
  try {
    return new URL(value).origin === value;
  } catch {
    return false;
  }
}

function isAllowance(value: unknown): value is Allowance {
  if (!value || typeof value !== "object") return false;
  const entry = value as Record<string, unknown>;
  const keys = Object.keys(entry).sort().join(",");

  if (!(ALLOWANCE_KINDS as readonly unknown[]).includes(entry.what) || !isOrigin(entry.origin)) return false;
  if (!Number.isSafeInteger(entry.since) || (entry.since as number) < 0) return false;
  // An origin is allowed for one location; the two other kinds name none.
  return entry.what === "origin"
    ? keys === "location,origin,since,what" && typeof entry.location === "string" && LOCATION.test(entry.location)
    : keys === "origin,since,what";
}

// What an allowance is for, without its time: what a request allows or takes back, and what a failure
// says that the operator may allow.
export type AllowanceFor = Pick<Allowance, "what" | "origin" | "location">;

// That, read from what a process was sent: the three fields and no other, in the form an allowance has.
export function readAllowanceFor(value: unknown): AllowanceFor | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const { what, origin, location } = value as Record<string, unknown>;
  const entry = { what, origin, ...(location === undefined ? {} : { location }), since: 0 };

  if (Object.keys(value).some((key) => !["what", "origin", "location"].includes(key)) || !isAllowance(entry))
    return undefined;
  return {
    what: entry.what,
    origin: entry.origin,
    ...(entry.location === undefined ? {} : { location: entry.location }),
  };
}

function same(one: Allowance, other: AllowanceFor): boolean {
  return one.what === other.what && one.origin === other.origin && (one.location ?? "") === (other.location ?? "");
}

// The allowances as they were stored, with what is not one left out: the store is a file, and what the
// main process allows a connection by is read from it with no trust in its form.
export function readAllowances(stored: unknown): Allowances {
  const allowances: Allowances = {};

  if (!stored || typeof stored !== "object" || Array.isArray(stored)) return allowances;
  for (const [cluster, entries] of Object.entries(stored)) {
    // A key every object has is not the identifier of a cluster, and is not written as one.
    if (!cluster || cluster === "__proto__" || !Array.isArray(entries)) continue;
    const kept: Allowance[] = [];

    for (const entry of entries) {
      if (kept.length >= ALLOWANCES_BOUND) break;
      if (isAllowance(entry) && !kept.some((other) => same(other, entry)))
        kept.push({
          what: entry.what,
          origin: entry.origin,
          ...(entry.location === undefined ? {} : { location: entry.location }),
          since: entry.since,
        });
    }
    if (kept.length) allowances[cluster] = kept;
  }
  return allowances;
}

// Whether the operator allowed that, for that cluster and that origin, and for that location when it is
// an origin that is allowed.
export function isAllowed(
  allowances: Allowances,
  cluster: string,
  what: AllowanceKind,
  origin: string,
  location?: string,
): boolean {
  return (allowances[cluster] ?? []).some((entry) =>
    same(entry, { what, origin, ...(what === "origin" ? { location } : {}) }),
  );
}

// The allowances with one more, given now. Nothing changes for one that is there already, which keeps
// its time, for one that is not well formed, and for a cluster that holds as many as it may.
export function withAllowance(
  allowances: Allowances,
  cluster: string,
  given: Pick<Allowance, "what" | "origin" | "location">,
  now: number,
): Allowances {
  const entry = {
    what: given.what,
    origin: given.origin,
    ...(given.what === "origin" ? { location: given.location } : {}),
    since: now,
  };
  const held = allowances[cluster] ?? [];

  if (
    !cluster ||
    cluster === "__proto__" ||
    !isAllowance(entry) ||
    held.some((other) => same(other, entry)) ||
    held.length >= ALLOWANCES_BOUND
  )
    return allowances;
  return { ...allowances, [cluster]: [...held, entry] };
}

// The allowances without one, which the operator took back.
export function withoutAllowance(
  allowances: Allowances,
  cluster: string,
  taken: Pick<Allowance, "what" | "origin" | "location">,
): Allowances {
  const left = (allowances[cluster] ?? []).filter((entry) => !same(entry, taken));
  const { [cluster]: _removed, ...others } = allowances;

  return left.length ? { ...others, [cluster]: left } : others;
}
