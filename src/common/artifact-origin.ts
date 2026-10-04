// Where a signed URL may point, by the storage location Velero signed it for: its origin and its path.
// Both are checked before a byte is sent. The URL comes from an object of the cluster, and a request for
// the log of a backup must not become the fetch of something else, from somewhere else. Pure functions on
// plain data: what they are given of a location is what its object carries.

import { readsAsTrue } from "./go-boolean";
import { type ArtifactTarget, artifactKind } from "./ipc";
import { objectStorePluginName } from "./server-version";

// What the rules read of a storage location.
export interface StoreOfLocation {
  provider?: unknown;
  bucket?: unknown;
  prefix?: unknown;
  config?: Record<string, unknown> | null;
}

// Why an origin is refused whatever the operator allowed: the URL is not one, its scheme is not HTTP or
// HTTPS, it carries a user or a fragment, or the location signs over its public URL and this is the
// origin of the other.
export type OriginRule = "form" | "scheme" | "user" | "fragment" | "public-url";

export type OriginCheck =
  // An origin the location gives, and where the bucket is in a URL of it: the first label of the host, or
  // the first segment of the path.
  | { verdict: "known"; origin: string; bucket: "host" | "path" }
  // An origin the location does not give: allowed only after the operator allowed it for that location,
  // in words that show it. Where the bucket is, is not known.
  | { verdict: "allowance"; origin: string }
  | { verdict: "refused"; rule: OriginRule };

// The plugin the rules were written for: the origin of a location of any other is not known.
const AWS = "velero.io/aws";
// The endpoints of S3 in the two partitions of AWS the rules know, as the whole of a host: the one of a
// region, with its two stacks and its validated form, the older one written with a dash, and the one of
// no region. Any other host of those domains is another service, or a name someone else chose, and what
// it serves is not of the location whatever its path says.
// A region is named as its area, its part and its number, as eu-south-1 or us-gov-west-1.
const REGION = "[a-z]{2}(?:-[a-z]+)+-\\d+";
const S3_ENDPOINT = new RegExp(
  `^(?:s3(?:-fips)?(?:\\.dualstack)?\\.${REGION}\\.amazonaws\\.com(?:\\.cn)?|s3-${REGION}\\.amazonaws\\.com(?:\\.cn)?|s3\\.amazonaws\\.com)$`,
);
// The accelerated endpoint, which has the bucket before it and never in its path.
const S3_ACCELERATED = /^s3-accelerate(?:\.dualstack)?\.amazonaws\.com$/;
// A URL is not longer than this, and has no character outside the printable ones of ASCII.
const URL_BOUND = 8192;

function text(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

// The bucket of a location as the release reads it: with the slashes around it taken off. One with a
// slash inside is a location the release refuses to open, and is no bucket.
function bucketOf(location: StoreOfLocation): string | undefined {
  const bucket = text(location.bucket)?.replace(/^\/+|\/+$/g, "");

  return bucket && !bucket.includes("/") ? bucket : undefined;
}

// A URL of the configuration of a location, as its scheme, its host and its port; nothing for what is
// not a URL of HTTP or HTTPS.
function endpoint(value: unknown): URL | undefined {
  const written = text(value);

  if (!written) return undefined;
  try {
    const parsed = new URL(written);

    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed : undefined;
  } catch {
    return undefined;
  }
}

// The origin of a signed URL against the ones its storage location gives. A URL is parsed as the runtime
// parses it: the host in lower case, and the port of the scheme left out.
export function checkOrigin(url: string, location: StoreOfLocation): OriginCheck {
  let parsed: URL;

  // A character that is not printable, a space among them, is in no URL a plugin signs.
  if (typeof url !== "string" || url.length > URL_BOUND || /[^\x21-\x7e]/.test(url))
    return { verdict: "refused", rule: "form" };
  try {
    parsed = new URL(url);
  } catch {
    return { verdict: "refused", rule: "form" };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return { verdict: "refused", rule: "scheme" };
  if (parsed.username || parsed.password) return { verdict: "refused", rule: "user" };
  if (parsed.hash || url.includes("#")) return { verdict: "refused", rule: "fragment" };
  const origin = parsed.origin;
  const bucket = bucketOf(location);
  // A host is read in lower case: the name of a bucket is compared with it the same way.
  const label = bucket?.toLowerCase();

  if (!bucket || objectStorePluginName(text(location.provider) ?? "") !== AWS) return { verdict: "allowance", origin };
  const config = location.config ?? {};
  const publicUrl = endpoint(config.publicUrl);
  const s3Url = endpoint(config.s3Url);
  // The plugin signs over the public URL when the location has one, and over the URL of the store when it
  // has not.
  const signed = publicUrl ?? s3Url;

  if (signed) {
    if (origin === signed.origin) return { verdict: "known", origin, bucket: "path" };
    // The plugin forces the bucket into the path only when it is told to: otherwise the SDK addresses it
    // as a label of the host, with the same scheme and the same port.
    if (
      !readsAsTrue(config.s3ForcePathStyle) &&
      parsed.protocol === signed.protocol &&
      parsed.port === signed.port &&
      parsed.hostname === `${label}.${signed.hostname}`
    )
      return { verdict: "known", origin, bucket: "host" };
    // A location with a public URL does not sign over the URL of its store: a URL of that origin is not
    // one the plugin made.
    if (publicUrl && s3Url && origin === s3Url.origin) return { verdict: "refused", rule: "public-url" };
    return { verdict: "allowance", origin };
  }
  // No URL of its own: an endpoint of S3, in the two partitions the rules know, with the bucket before it
  // in the host, or as the first folder of the path of the endpoint itself.
  if (parsed.protocol === "https:" && !parsed.port) {
    const host = parsed.hostname;
    const after = host.startsWith(`${label}.`) ? host.slice(`${label}.`.length) : undefined;

    if (after !== undefined && (S3_ENDPOINT.test(after) || S3_ACCELERATED.test(after)))
      return { verdict: "known", origin, bucket: "host" };
    if (S3_ENDPOINT.test(host) && firstFolder(parsed.pathname) === bucket)
      return { verdict: "known", origin, bucket: "path" };
  }
  return { verdict: "allowance", origin };
}

// The first folder of a path, decoded; nothing for a path that has none, or whose first folder does not
// decode. The origin of a URL is known by it, whatever follows it.
function firstFolder(pathname: string): string | undefined {
  try {
    return decodeURIComponent(pathname.split("/")[1] ?? "") || undefined;
  } catch {
    return undefined;
  }
}

// The segments of a path as they are written once decoded; nothing for a path that does not decode, or
// that has a segment that names the folder it is in or the one above. An empty segment, and one that
// decodes to more than one, are segments as any other, which no folder of a key is.
function segments(pathname: string): string[] | undefined {
  if (!pathname.startsWith("/")) return undefined;
  const decoded: string[] = [];

  for (const segment of pathname.slice(1).split("/")) {
    let name: string;

    try {
      name = decodeURIComponent(segment);
    } catch {
      return undefined;
    }
    if (name === "." || name === "..") return undefined;
    decoded.push(name);
  }
  return decoded;
}

// The file of each artifact in the folder of its operation, as the release lays the store out.
const FILES: Record<ArtifactTarget, (name: string) => string> = {
  BackupLog: (name) => `${name}-logs.gz`,
  BackupResults: (name) => `${name}-results.gz`,
  BackupResourceList: (name) => `${name}-resource-list.json.gz`,
  BackupVolumeInfos: (name) => `${name}-volumeinfo.json.gz`,
  RestoreLog: (name) => `restore-${name}-logs.gz`,
  RestoreResults: (name) => `restore-${name}-results.gz`,
  RestoreResourceList: (name) => `restore-${name}-resource-list.json.gz`,
  RestoreVolumeInfo: (name) => `${name}-volumeinfo.json.gz`,
};

// The key of an artifact in the bucket, as its segments: the prefix of the location, the folder of the
// backups or of the restores, the one of the operation, and the file. The prefix is read as the release
// reads it, which takes the slashes around it off and joins it to the rest as a path: an empty folder and
// the folder itself go, and the folder above takes the one before it. Nothing for a prefix that climbs
// above the bucket, and for a name that is a path.
export function artifactKey(target: ArtifactTarget, name: string, prefix: unknown): string[] | undefined {
  const before: string[] = [];

  for (const folder of (typeof prefix === "string" ? prefix : "").split("/")) {
    if (!folder || folder === ".") continue;
    if (folder !== "..") before.push(folder);
    else if (!before.length) return undefined;
    else before.pop();
  }
  if (!name || name.includes("/") || name === "." || name === "..") return undefined;
  return [...before, artifactKind(target) === "Backup" ? "backups" : "restores", name, FILES[target](name)];
}

// Whether the path of a signed URL is the key of the artifact that was asked, for that target of that
// name, in that bucket: with the bucket before it when the bucket is in the path, alone when it is in the
// host, and either when the origin does not say where the bucket is.
export function isArtifactPath(
  pathname: string,
  target: ArtifactTarget,
  name: string,
  location: StoreOfLocation,
  bucket: "host" | "path" | "either",
): boolean {
  const key = artifactKey(target, name, location.prefix);
  const written = segments(pathname);
  const bucketName = bucketOf(location);

  if (!key || !written || !bucketName) return false;
  const same = (expected: string[]) =>
    expected.length === written.length && expected.every((segment, index) => segment === written[index]);

  return (bucket !== "path" && same(key)) || (bucket !== "host" && same([bucketName, ...key]));
}

// What the host of a signed URL names, by its form alone:
//   address: an address, which names nothing;
//   service: `<name>.<namespace>.svc`, with or without the domain of the cluster after it, which is a
//     Service of the cluster by its form and is never resolved on this machine;
//   candidate: a bare `<name>`, or `<name>.<namespace>`, which is a Service when one of that name is in
//     that namespace, or in the one of the installation for a bare name, and a name of this machine
//     otherwise; one that is both is refused as ambiguous;
//   name: any other name, which this machine resolves.
export type HostForm =
  | { form: "address" }
  | { form: "service"; name: string; namespace: string }
  | { form: "candidate"; name: string; namespace?: string }
  | { form: "name" };

// A label of a name of the cluster: what a Service and a namespace are named with.
const LABEL = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

// The form of the host of a URL, as the runtime gives it: in lower case, an IPv6 address in brackets.
export function hostForm(hostname: string): HostForm {
  // An IPv6 address is in brackets, and an IPv4 one is four numbers: the runtime gives a host that reads
  // as numbers in that form, whatever it was written as.
  if (hostname.startsWith("[") || /^\d+(\.\d+){3}$/.test(hostname)) return { form: "address" };
  const labels = (hostname.endsWith(".") ? hostname.slice(0, -1) : hostname).split(".");

  if (labels.length >= 3 && labels[2] === "svc" && LABEL.test(labels[0]) && LABEL.test(labels[1]))
    return { form: "service", name: labels[0], namespace: labels[1] };
  if (labels.length === 1 && LABEL.test(labels[0])) return { form: "candidate", name: labels[0] };
  if (labels.length === 2 && LABEL.test(labels[0]) && LABEL.test(labels[1]))
    return { form: "candidate", name: labels[0], namespace: labels[1] };
  return { form: "name" };
}
