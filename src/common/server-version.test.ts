import { describe, expect, it } from "vitest";
import {
  compareVersion,
  objectStorePluginName,
  PLUGIN_KINDS,
  pluginGroups,
  providerPlugins,
  versionNote,
} from "./server-version";
import { REVIEWED_RELEASE } from "./types";

import type { BackupStorageLocationResource } from "./types";

function location(name: string, provider?: string): BackupStorageLocationResource {
  return {
    metadata: { name, namespace: "velero" },
    ...(provider === undefined ? {} : { spec: { provider } }),
  } as BackupStorageLocationResource;
}

describe("the version of the server against the reviewed release", () => {
  it("knows the reviewed release, which is the one the specs name", () => {
    expect(REVIEWED_RELEASE).toBe("v1.18.2");
  });

  it("says that the same version is the reviewed release", () => {
    expect(compareVersion("v1.18.2", "v1.18.2")).toEqual({ relation: "same", version: "v1.18.2" });
    expect(versionNote(compareVersion("v1.18.2", "v1.18.2"))).toBe(
      "This is the release the extension was reviewed against.",
    );
  });

  it("says that another patch of the reviewed series is that series, with the patch", () => {
    const found = compareVersion("v1.18.4", "v1.18.2");

    expect(found).toEqual({ relation: "series", version: "v1.18.4", series: "v1.18", reviewed: "v1.18.2" });
    expect(versionNote(found)).toBe(
      "This server runs v1.18.4, of the series v1.18 the extension was reviewed against, in v1.18.2.",
    );
    expect(compareVersion("v1.18.0", "v1.18.2").relation).toBe("series");
  });

  it("says of a prerelease or a build with a suffix of the reviewed series that it is that series, as written", () => {
    expect(compareVersion("v1.18.2-rc.1", "v1.18.2")).toEqual({
      relation: "series",
      version: "v1.18.2-rc.1",
      series: "v1.18",
      reviewed: "v1.18.2",
    });
    // A prerelease of the reviewed patch is not another patch: the note says what the server runs, as written.
    expect(versionNote(compareVersion("v1.18.2-rc.1", "v1.18.2"))).toBe(
      "This server runs v1.18.2-rc.1, of the series v1.18 the extension was reviewed against, in v1.18.2.",
    );
    expect(versionNote(compareVersion("v1.18.3+build.7", "v1.18.2"))).toContain("runs v1.18.3+build.7, of the series");
  });

  it("says of a newer series and of an older one which release the extension was reviewed against", () => {
    const newer = compareVersion("v1.19.0", "v1.18.2");
    const older = compareVersion("v1.17.5", "v1.18.2");

    expect(newer).toEqual({ relation: "other", version: "v1.19.0", newer: true, reviewed: "v1.18.2" });
    expect(older).toEqual({ relation: "other", version: "v1.17.5", newer: false, reviewed: "v1.18.2" });
    expect(compareVersion("v2.0.0", "v1.18.2")).toMatchObject({ relation: "other", newer: true });
    expect(compareVersion("v0.99.0", "v1.18.2")).toMatchObject({ relation: "other", newer: false });
    // The minor is compared as a number, not as a text: 1.9 is older than 1.18.
    expect(compareVersion("v1.9.0", "v1.18.2")).toMatchObject({ relation: "other", newer: false });
    expect(compareVersion("v1.100.0-alpha", "v1.18.2")).toMatchObject({ relation: "other", newer: true });
    expect(versionNote(newer)).toBe(
      "This server runs a newer series than the release the extension was reviewed against, v1.18.2: what its views say of the behavior of Velero was read in v1.18.2.",
    );
    expect(versionNote(older)).toContain("an older series than the release the extension was reviewed against");
  });

  it("shows a text that is not a version as it is written, with no comparison", () => {
    for (const text of ["main", "1.18.2", "v1.18", "v1.18.x", "v1.18.2.1", "dev-abc123", " v1.18.2"]) {
      expect([text, compareVersion(text, "v1.18.2")]).toEqual([text, { relation: "unknown", version: text }]);
    }
    expect(versionNote(compareVersion("main", "v1.18.2"))).toBe(
      "This is not a version of the form vMAJOR.MINOR.PATCH: it is shown as the server wrote it, with no comparison.",
    );
  });
});

describe("the plugins by kind", () => {
  it("knows the eight kinds the release lists, in the order of the release", () => {
    expect(PLUGIN_KINDS).toEqual([
      "ObjectStore",
      "VolumeSnapshotter",
      "BackupItemAction",
      "BackupItemActionV2",
      "RestoreItemAction",
      "RestoreItemActionV2",
      "DeleteItemAction",
      "ItemBlockAction",
    ]);
  });

  it("groups the plugins in the order of the kinds, the names sorted in each, with the counts", () => {
    const found = pluginGroups([
      { name: "velero.io/pod", kind: "BackupItemAction" },
      { name: "velero.io/aws", kind: "VolumeSnapshotter" },
      { name: "velero.io/aws", kind: "ObjectStore" },
      { name: "velero.io/crd-remap-version", kind: "BackupItemAction" },
      { name: "velero.io/add-pvc-from-pod", kind: "RestoreItemAction" },
      { name: "velero.io/dataupload-delete-action", kind: "DeleteItemAction" },
      { name: "velero.io/csi-pvc-backupper", kind: "BackupItemActionV2" },
      { name: "velero.io/csi-pvc-restorer", kind: "RestoreItemActionV2" },
      { name: "velero.io/pvc", kind: "ItemBlockAction" },
      { name: "example.io/blob", kind: "ObjectStore" },
    ]);

    expect(found.total).toBe(10);
    expect(found.groups.map((group) => [group.kind, group.names, group.count, group.known])).toEqual([
      ["ObjectStore", ["example.io/blob", "velero.io/aws"], 2, true],
      ["VolumeSnapshotter", ["velero.io/aws"], 1, true],
      ["BackupItemAction", ["velero.io/crd-remap-version", "velero.io/pod"], 2, true],
      ["BackupItemActionV2", ["velero.io/csi-pvc-backupper"], 1, true],
      ["RestoreItemAction", ["velero.io/add-pvc-from-pod"], 1, true],
      ["RestoreItemActionV2", ["velero.io/csi-pvc-restorer"], 1, true],
      ["DeleteItemAction", ["velero.io/dataupload-delete-action"], 1, true],
      ["ItemBlockAction", ["velero.io/pvc"], 1, true],
    ]);
  });

  it("keeps a kind of the release with no plugin, with none, and a kind the release does not name after them", () => {
    const found = pluginGroups([
      { name: "velero.io/b", kind: "Unheard" },
      { name: "velero.io/a", kind: "Unheard" },
      { name: "velero.io/z", kind: "Another" },
      { name: "velero.io/aws", kind: "ObjectStore" },
    ]);

    expect(found.total).toBe(4);
    expect(found.groups.map((group) => [group.kind, group.count, group.known])).toEqual([
      ["ObjectStore", 1, true],
      ["VolumeSnapshotter", 0, true],
      ["BackupItemAction", 0, true],
      ["BackupItemActionV2", 0, true],
      ["RestoreItemAction", 0, true],
      ["RestoreItemActionV2", 0, true],
      ["DeleteItemAction", 0, true],
      ["ItemBlockAction", 0, true],
      ["Another", 1, false],
      ["Unheard", 2, false],
    ]);
    expect(found.groups.at(-1)?.names).toEqual(["velero.io/a", "velero.io/b"]);
    expect(pluginGroups([]).total).toBe(0);
  });
});

describe("the providers of the storage locations", () => {
  it("names the object store plugin of a provider by the rule of the release", () => {
    expect(objectStorePluginName("aws")).toBe("velero.io/aws");
    expect(objectStorePluginName("velero.io/aws")).toBe("velero.io/aws");
    expect(objectStorePluginName("example.io/blob")).toBe("example.io/blob");
  });

  it("marks the provider for which no object store plugin of that name is loaded", () => {
    const plugins = [
      { name: "velero.io/aws", kind: "ObjectStore" },
      { name: "velero.io/gcp", kind: "VolumeSnapshotter" },
      { name: "example.io/blob", kind: "ObjectStore" },
    ];
    const found = providerPlugins(
      [
        location("default", "aws"),
        location("archive", "velero.io/aws"),
        location("cold", "gcp"),
        location("other", "example.io/blob"),
        location("unnamed"),
        location("second", "aws"),
      ],
      plugins,
    );

    expect(found).toEqual([
      { provider: "aws", plugin: "velero.io/aws", loaded: true, locations: ["default", "second"] },
      { provider: "example.io/blob", plugin: "example.io/blob", loaded: true, locations: ["other"] },
      // A plugin of that name of another kind is not an object store.
      { provider: "gcp", plugin: "velero.io/gcp", loaded: false, locations: ["cold"] },
      { provider: "velero.io/aws", plugin: "velero.io/aws", loaded: true, locations: ["archive"] },
    ]);
    expect(providerPlugins([], plugins)).toEqual([]);
  });
});
