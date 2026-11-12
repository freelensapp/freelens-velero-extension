import { describe, expect, it } from "vitest";
import {
  ALWAYS,
  apiAvailability,
  choices,
  current,
  emptyPreferences,
  entry,
  FAMILIES,
  familyStatus,
  ON_DEMAND,
  RESOURCES,
  readPreferences,
  SECOND_VERSION,
  selection,
  suggestions,
  TITLES,
  validNamespace,
  versionOf,
} from "./discovery";

import type { ApiAvailability, Family, Suggestions } from "./discovery";

// The families of the first version of the group, and their kinds.
const FIRST = FAMILIES.filter((family) => versionOf(family) === "v1");

const served = {
  status: 200,
  body: {
    kind: "APIResourceList",
    resources: [
      ...FIRST.map((family) => ({ name: RESOURCES[family], namespaced: true })),
      { name: "downloadrequests" },
      { name: "backups/status" },
    ],
  },
};

// The discovery of the second version, as the reviewed release serves it.
const second = {
  status: 200,
  body: {
    kind: "APIResourceList",
    groupVersion: "velero.io/v2alpha1",
    resources: [
      { name: "datadownloads", namespaced: true },
      { name: "datauploads", namespaced: true },
    ],
  },
};

function locations(...namespaces: string[]) {
  return {
    status: 200,
    body: { items: namespaces.map((namespace) => ({ metadata: { name: "default", namespace } })) },
  };
}

describe("the families of an installation", () => {
  it("are one union of ten: six read at every read, and the four of the operations of the volumes on demand", () => {
    expect(FAMILIES).toEqual([
      "backups",
      "restores",
      "schedules",
      "storageLocations",
      "snapshotLocations",
      "backupRepositories",
      "podVolumeBackups",
      "podVolumeRestores",
      "dataUploads",
      "dataDownloads",
    ]);
    expect([...ALWAYS, ...ON_DEMAND].sort()).toEqual([...FAMILIES].sort());
    expect(ALWAYS.filter((family) => (ON_DEMAND as readonly string[]).includes(family))).toEqual([]);
    expect(ON_DEMAND).toEqual(["podVolumeBackups", "podVolumeRestores", "dataUploads", "dataDownloads"]);
    expect(
      [RESOURCES.backupRepositories, RESOURCES.podVolumeBackups, RESOURCES.podVolumeRestores].concat(
        RESOURCES.dataUploads,
        RESOURCES.dataDownloads,
      ),
    ).toEqual(["backuprepositories", "podvolumebackups", "podvolumerestores", "datauploads", "datadownloads"]);
    expect([
      TITLES.backupRepositories,
      TITLES.podVolumeBackups,
      TITLES.podVolumeRestores,
      TITLES.dataUploads,
      TITLES.dataDownloads,
    ]).toEqual(["Backup Repositories", "Pod Volume Backups", "Pod Volume Restores", "Data Uploads", "Data Downloads"]);
  });

  it("are each served under one version: the data movement under the second, every other kind under the first", () => {
    expect(SECOND_VERSION).toEqual(["dataUploads", "dataDownloads"]);
    expect(FAMILIES.map((family) => [family, versionOf(family)])).toEqual(
      FAMILIES.map((family) => [family, family === "dataUploads" || family === "dataDownloads" ? "v2alpha1" : "v1"]),
    );
  });
});

describe("availability of the API", () => {
  it("names the kinds the API serves, and the families that are not among them", () => {
    expect(apiAvailability(served, second)).toEqual({
      state: "served",
      resources: [...FIRST.map((family) => RESOURCES[family]), "downloadrequests"],
      missing: [],
    });
    expect(apiAvailability({ status: 200, body: { resources: [{ name: "backups" }, { name: "schedules" }] } })).toEqual(
      {
        state: "served",
        resources: ["backups", "schedules"],
        missing: [
          "restores",
          "storageLocations",
          "snapshotLocations",
          "backupRepositories",
          "podVolumeBackups",
          "podVolumeRestores",
        ],
      },
    );
    expect(apiAvailability({ status: 200, body: { resources: [] } })).toEqual({
      state: "served",
      resources: [],
      missing: FIRST,
    });
  });

  it("takes from the second version only whether the kinds of the data movement are served (SPEC-0014, REQ-177)", () => {
    const missing = (answer?: { status?: number; body?: unknown }) => {
      const api = apiAvailability(served, answer);

      return api.state === "served" ? api.missing : api.state;
    };

    // Served: nothing is missing, and the kinds of the second version are not among the ones of the first.
    expect(missing(second)).toEqual([]);
    // One kind of the two served: the other is not served, and nothing else is.
    expect(missing({ status: 200, body: { resources: [{ name: "datauploads" }] } })).toEqual(["dataDownloads"]);
    // The version not served: both kinds are not served, and the families of the first version are untouched.
    expect(missing({ status: 404, body: "404 page not found\n" })).toEqual(["dataUploads", "dataDownloads"]);
    // Denied, failed, not a list, or not asked: nothing is known of the version, and its families are read, each read
    // saying what it is.
    for (const answer of [{ status: 403 }, { status: 500 }, { status: 200, body: "not a list" }, {}, undefined]) {
      expect(missing(answer), JSON.stringify(answer)).toEqual([]);
    }
    // The second version never says anything of the first: Velero is not installed, or is denied, whatever it answers.
    expect(apiAvailability({ status: 404 }, second)).toEqual({ state: "not-installed" });
    expect(apiAvailability({ status: 403 }, { status: 404 })).toEqual({ state: "restricted" });
    // A family of the second version not served is said not served, and its read is not taken for anything else.
    const api = apiAvailability(served, { status: 404 });

    for (const family of FAMILIES) {
      expect([family, familyStatus(api, family, "ready")]).toEqual([
        family,
        (SECOND_VERSION as readonly Family[]).includes(family) ? "not-served" : "ready",
      ]);
    }
  });

  it("calls Velero not installed only when the API says that it does not know the group", () => {
    expect(apiAvailability({ status: 404, body: "404 page not found\n" })).toEqual({ state: "not-installed" });
    for (const status of [403, 401]) expect(apiAvailability({ status })).toEqual({ state: "restricted" });
    for (const answer of [
      { status: 500 },
      { status: 503, body: { message: "not found" } },
      { status: 0 },
      {},
      { body: { code: 404 } },
      { status: 200, body: "not a list" },
      { status: 200, body: { kind: "Status", message: "the server could not find the requested resource" } },
      { status: 200 },
    ]) {
      expect(apiAvailability(answer)).toEqual({ state: "failed" });
    }
  });

  it("does not read the status of an answer from its text", () => {
    expect(apiAvailability({ body: { message: "forbidden: User cannot get path" } })).toEqual({ state: "failed" });
    expect(apiAvailability({ status: 500, body: "404 page not found" })).toEqual({ state: "failed" });
    expect(suggestions({ body: { message: "Forbidden", code: 403 } })).toEqual({ state: "failed" });
  });
});

describe("suggested namespaces", () => {
  it("are the namespaces of the storage locations, each once", () => {
    expect(suggestions(locations("velero-demo", "velero-static-a1b2c3d4", "velero-demo"))).toEqual({
      state: "listed",
      namespaces: ["velero-demo", "velero-static-a1b2c3d4"],
    });
    expect(suggestions(locations())).toEqual({ state: "listed", namespaces: [] });
  });

  it("are unknown when the list of the cluster is denied or fails, and not an empty list", () => {
    expect(suggestions({ status: 403 })).toEqual({ state: "restricted" });
    expect(suggestions({ status: 500 })).toEqual({ state: "failed" });
    expect(suggestions({ status: 404 })).toEqual({ state: "failed" });
    expect(suggestions({ status: 200, body: { items: "many" } })).toEqual({ state: "failed" });
  });

  it("leave out what is not the name of a namespace", () => {
    expect(
      suggestions({
        status: 200,
        body: {
          items: [
            { metadata: { namespace: "velero" } },
            { metadata: { namespace: "Velero" } },
            { metadata: { namespace: "../etc" } },
            { metadata: { namespace: 7 } },
            { metadata: {} },
            null,
            "velero",
          ],
        },
      }),
    ).toEqual({ state: "listed", namespaces: ["velero"] });
  });
});

describe("name of a namespace", () => {
  it.each(["velero", "velero-demo", "a", "0", "a1-b2", "a".repeat(63)])("accepts %s", (name) => {
    expect(validNamespace(name)).toBe(true);
  });

  it.each([
    "",
    "Velero",
    "velero_demo",
    "-velero",
    "velero-",
    "velero.demo",
    "velero demo",
    "velero/backups",
    "../velero",
    "velero?watch=1",
    "a".repeat(64),
    7,
    null,
    undefined,
    ["velero"],
  ])("refuses %j", (name) => {
    expect(validNamespace(name)).toBe(false);
  });
});

describe("selection of the installation", () => {
  const listed = (...namespaces: string[]): Suggestions => ({ state: "listed", namespaces });

  it("offers what a storage location suggests and what the operator configured, each once", () => {
    expect(choices(listed("velero-demo", "velero-static"), ["velero-static", "velero-restricted"])).toEqual([
      { namespace: "velero-demo", suggested: true, configured: false },
      { namespace: "velero-restricted", suggested: false, configured: true },
      { namespace: "velero-static", suggested: true, configured: true },
    ]);
    expect(choices({ state: "restricted" }, ["velero-restricted"])).toEqual([
      { namespace: "velero-restricted", suggested: false, configured: true },
    ]);
    expect(choices({ state: "failed" }, [])).toEqual([]);
  });

  it("asks for a choice among several installations, and does not take the first", () => {
    const found = listed("velero-a", "velero-b");

    expect(selection(choices(found, []), undefined, found)).toEqual({ state: "required" });
  });

  it("takes the only installation there is", () => {
    const found = listed("velero-demo");

    expect(selection(choices(found, []), undefined, found)).toEqual({
      state: "selected",
      namespace: "velero-demo",
      reason: "only",
    });
  });

  it("keeps the choice made before while it can still be made", () => {
    const found = listed("velero-a", "velero-b");

    expect(selection(choices(found, []), "velero-b", found)).toEqual({
      state: "selected",
      namespace: "velero-b",
      reason: "saved",
    });
  });

  it("does not replace with another the namespace that is not there any more", () => {
    const found = listed("velero-b");

    expect(selection(choices(found, []), "velero-a", found)).toEqual({ state: "stale", namespace: "velero-a" });
    // Not even when only one is left, which alone would be taken.
    expect(selection(choices(found, []), "velero-a", found)).not.toMatchObject({ namespace: "velero-b" });
    expect(selection(choices(listed(), []), "velero-a", listed())).toEqual({ state: "stale", namespace: "velero-a" });
  });

  it("reads the namespace chosen before when the namespaces cannot be listed", () => {
    for (const found of [{ state: "restricted" }, { state: "failed" }, { state: "asking" }] as Suggestions[]) {
      expect(selection(choices(found, []), "velero-a", found)).toEqual({
        state: "selected",
        namespace: "velero-a",
        reason: "saved",
      });
    }
  });

  it("has nothing to select where nothing is suggested and nothing is configured", () => {
    expect(selection([], undefined, listed())).toEqual({ state: "none" });
    expect(selection([], undefined, { state: "restricted" })).toEqual({ state: "none" });
  });
});

describe("what a view shows before any data", () => {
  const api = apiAvailability(served);
  const found: Suggestions = { state: "listed", namespaces: ["velero-a", "velero-b"] };
  const state = (availability: ApiAvailability, suggested: Suggestions, saved?: string, configured: string[] = []) => {
    const available = choices(suggested, configured);

    return entry(availability, suggested, selection(available, saved, suggested), available);
  };

  it("waits for the discovery and then for the namespaces", () => {
    expect(state({ state: "unknown" }, { state: "unknown" })).toEqual({ state: "loading" });
    expect(state({ state: "asking" }, found)).toEqual({ state: "loading" });
    expect(state(api, { state: "asking" })).toEqual({ state: "loading" });
  });

  it("says that Velero is not installed only on the evidence of the API", () => {
    expect(state({ state: "not-installed" }, { state: "failed" })).toEqual({ state: "not-installed" });
    expect(state({ state: "failed" }, { state: "failed" })).toEqual({ state: "failed" });
    expect(state({ state: "restricted" }, { state: "restricted" })).toEqual({
      state: "restricted",
      configurable: true,
    });
  });

  it("asks to choose among several installations", () => {
    expect(state(api, found)).toMatchObject({ state: "choose", choices: [{ namespace: "velero-a" }, {}] });
  });

  it("asks for a namespace where none is suggested, and says why", () => {
    expect(state(api, { state: "listed", namespaces: [] })).toEqual({ state: "configure", reason: "no-suggestion" });
    expect(state(api, { state: "restricted" })).toEqual({ state: "configure", reason: "suggestions-restricted" });
    expect(state(api, { state: "failed" })).toEqual({ state: "configure", reason: "suggestions-failed" });
  });

  it("reads the namespace that was configured although the lists of the cluster are denied", () => {
    expect(state({ state: "restricted" }, { state: "restricted" }, undefined, ["velero-restricted"])).toEqual({
      state: "ready",
      namespace: "velero-restricted",
      stale: false,
      missing: [],
    });
    expect(state({ state: "failed" }, { state: "failed" }, "velero-a")).toMatchObject({
      state: "ready",
      namespace: "velero-a",
    });
  });

  it("names the families whose kind the API does not serve", () => {
    const partial = apiAvailability({ status: 200, body: { resources: [{ name: "backups" }] } });

    expect(state(partial, found, "velero-a")).toEqual({
      state: "ready",
      namespace: "velero-a",
      stale: false,
      missing: [
        "restores",
        "schedules",
        "storageLocations",
        "snapshotLocations",
        "backupRepositories",
        "podVolumeBackups",
        "podVolumeRestores",
      ],
    });
    expect(familyStatus(partial, "restores", "idle")).toBe("not-served");
    expect(familyStatus(partial, "podVolumeBackups", "idle")).toBe("not-served");
    expect(familyStatus(partial, "backups", "ready")).toBe("ready");
    expect(familyStatus({ state: "failed" }, "restores", "forbidden")).toBe("forbidden");
  });

  it("shows the namespace that is not there any more as the one selected, and stale", () => {
    expect(state(api, { state: "listed", namespaces: ["velero-b"] }, "velero-a")).toEqual({
      state: "ready",
      namespace: "velero-a",
      stale: true,
      missing: [],
    });
  });
});

describe("what is kept of the preferences", () => {
  it("is the namespaces, and nothing else a file may hold", () => {
    expect(
      readPreferences({
        selected: { "cluster-a": "velero-demo", "cluster-b": "Not A Namespace", "": "velero", "cluster-c": 7 },
        configured: {
          "cluster-a": ["velero-restricted", "velero-restricted", "../etc", 7, "velero-demo"],
          "cluster-b": [],
          "cluster-c": "velero",
        },
        token: "a synthetic secret",
        writes: true,
        backups: [{ metadata: { name: "a synthetic backup" } }],
      }),
    ).toEqual({
      selected: { "cluster-a": "velero-demo" },
      configured: { "cluster-a": ["velero-demo", "velero-restricted"] },
    });
  });

  it.each([undefined, null, "", 7, [], "{}", { selected: "velero", configured: 7 }])("is empty for %j", (stored) => {
    expect(readPreferences(stored)).toEqual(emptyPreferences());
  });

  it("keeps the window of the recent operations when it is one of the three, and no other", () => {
    for (const window of ["24h", "7d", "30d"]) {
      expect(readPreferences({ window })).toEqual({ selected: {}, configured: {}, window });
    }
    for (const window of ["1h", "7D", "", 7, null, ["24h"], { length: "24h" }, "30d "]) {
      expect(readPreferences({ window })).toEqual(emptyPreferences());
    }
    // No window is kept where none was chosen: the one that is taken is not a choice.
    expect("window" in readPreferences({ selected: { "cluster-a": "velero-demo" } })).toBe(false);
  });
});

describe("what is kept of what the operator allowed", () => {
  const allowed = { what: "private", origin: "https://storage.example:9000", since: 1000 };

  it("is kept with the namespaces, read with no trust in its form, and left out when there is none", () => {
    expect(
      readPreferences({
        selected: { "cluster-a": "velero-demo" },
        allowances: {
          "cluster-a": [
            allowed,
            { what: "http", origin: "https://storage.example/bucket?signature=synthetic", since: 1 },
          ],
          "cluster-b": "everything",
        },
      }),
    ).toEqual({
      selected: { "cluster-a": "velero-demo" },
      configured: {},
      allowances: { "cluster-a": [allowed] },
    });
    // An operator who allowed nothing keeps a file without the key.
    for (const allowances of [undefined, {}, { "cluster-a": [] }, "everything", { "cluster-a": [{ what: "all" }] }])
      expect("allowances" in readPreferences({ allowances })).toBe(false);
  });
});

describe("generation of a selection", () => {
  const asked = { cluster: "cluster-a", namespace: "velero-a", number: 3 };

  it("takes the answer of what was asked for the selection that is still the one", () => {
    expect(current({ ...asked }, asked)).toBe(true);
  });

  it.each([
    [{ ...asked, number: 4 }, "a later selection of the same namespace"],
    [{ ...asked, namespace: "velero-b", number: 4 }, "another namespace"],
    [{ ...asked, namespace: "velero-b" }, "another namespace with the same number"],
    [{ ...asked, cluster: "cluster-b" }, "the namespace of the same name in another cluster"],
  ])("refuses the answer of what was asked before %j (%s)", (generation) => {
    expect(current(generation, asked)).toBe(false);
  });
});
