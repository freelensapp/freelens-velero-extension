// What the server says of itself, read against the release the extension was reviewed against: the
// version compared by its major and its minor, as the command line of Velero compares it; the plugins by
// kind; and the object store plugin each provider of a storage location needs. Pure functions on plain
// data.

import type { BackupStorageLocationResource } from "./types";

// The kinds of plugins a ServerStatusRequest lists in the reviewed release, in the order of the release.
// The ninth kind of the release, PluginLister, is never listed.
export const PLUGIN_KINDS = [
  "ObjectStore",
  "VolumeSnapshotter",
  "BackupItemAction",
  "BackupItemActionV2",
  "RestoreItemAction",
  "RestoreItemActionV2",
  "DeleteItemAction",
  "ItemBlockAction",
] as const;

export interface Plugin {
  name: string;
  kind: string;
}

// The form `vMAJOR.MINOR.PATCH`, with an optional suffix of a prerelease or of a build.
const VERSION = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)([-+][0-9A-Za-z.+-]*)?$/;

function parse(version: string): { major: number; minor: number } | undefined {
  const found = VERSION.exec(version);

  return found ? { major: Number(found[1]), minor: Number(found[2]) } : undefined;
}

export type VersionComparison =
  | { relation: "same"; version: string }
  | { relation: "series"; version: string; series: string; reviewed: string }
  | { relation: "other"; version: string; newer: boolean; reviewed: string }
  | { relation: "unknown"; version: string };

// The version of the server against the reviewed release. The same text is the same release; the same
// major and minor is the same series, whatever the patch and the suffix; a text that is not of the form
// is not compared.
export function compareVersion(version: string, reviewed: string): VersionComparison {
  const server = parse(version);
  const release = parse(reviewed);

  if (!server || !release) return { relation: "unknown", version };
  if (version === reviewed) return { relation: "same", version };
  if (server.major === release.major && server.minor === release.minor)
    return { relation: "series", version, series: `v${release.major}.${release.minor}`, reviewed };
  const newer = server.major !== release.major ? server.major > release.major : server.minor > release.minor;

  return { relation: "other", version, newer, reviewed };
}

// What the band says beside the version.
export function versionNote(found: VersionComparison): string {
  switch (found.relation) {
    case "same":
      return "This is the release the extension was reviewed against.";
    case "series":
      return `This is the series ${found.series} the extension was reviewed against, in ${found.reviewed}; this server runs the patch ${found.version}.`;
    case "other":
      return `This server runs ${found.newer ? "a newer" : "an older"} series than the release the extension was reviewed against, ${found.reviewed}: what its views say of the behavior of Velero was read in ${found.reviewed}.`;
    default:
      return "This is not a version of the form vMAJOR.MINOR.PATCH: it is shown as the server wrote it, with no comparison.";
  }
}

export interface PluginGroup {
  kind: string;
  // The kind is one the reviewed release names.
  known: boolean;
  names: string[];
  count: number;
}

function byText(one: string, other: string): number {
  return one < other ? -1 : one > other ? 1 : 0;
}

// The plugins by kind: the kinds of the release in its order, each one even when it has none, then the
// kinds the release does not name, by their text. The names are sorted: the object lists them in no order.
export function pluginGroups(plugins: Plugin[]): { groups: PluginGroup[]; total: number } {
  const names = new Map<string, string[]>();

  for (const plugin of plugins) names.set(plugin.kind, [...(names.get(plugin.kind) ?? []), plugin.name]);
  const known: readonly string[] = PLUGIN_KINDS;
  const others = [...names.keys()].filter((kind) => !known.includes(kind)).sort(byText);
  const groups = [...known, ...others].map((kind) => {
    const sorted = [...(names.get(kind) ?? [])].sort(byText);

    return { kind, known: known.includes(kind), names: sorted, count: sorted.length };
  });

  return { groups, total: plugins.length };
}

// The name of the object store plugin of a provider, by the rule of the release: a provider without a
// slash is of the group of Velero.
export function objectStorePluginName(provider: string): string {
  return provider.includes("/") ? provider : `velero.io/${provider}`;
}

export interface ProviderPlugin {
  provider: string;
  plugin: string;
  // An object store plugin of that name is loaded.
  loaded: boolean;
  // The storage locations of that provider.
  locations: string[];
}

// The providers of the storage locations, each with the object store plugin it needs and whether the
// server loaded it. A provider is compared as written: `aws` and `velero.io/aws` are two lines, which need
// the same plugin. A location that names no provider names no plugin.
export function providerPlugins(locations: BackupStorageLocationResource[], plugins: Plugin[]): ProviderPlugin[] {
  const stores = new Set(plugins.filter((plugin) => plugin.kind === "ObjectStore").map((plugin) => plugin.name));
  const named = new Map<string, string[]>();

  for (const location of locations) {
    const provider = location.spec?.provider;

    if (typeof provider !== "string" || provider === "") continue;
    named.set(provider, [...(named.get(provider) ?? []), location.metadata.name]);
  }
  return [...named.keys()].sort(byText).map((provider) => {
    const plugin = objectStorePluginName(provider);

    return { provider, plugin, loaded: stores.has(plugin), locations: [...(named.get(provider) ?? [])].sort(byText) };
  });
}
