import { describe, expect, it } from "vitest";
import { durationOf, TEMPLATE_WORDS, templateProblems, templateSpec } from "./backup-template";

const LOCATED = { storageLocation: "default" };

describe("what the release refuses of a template, with its words", () => {
  it("asks for the storage location, which the form always writes", () => {
    expect(templateProblems({})).toEqual({ storageLocation: [TEMPLATE_WORDS.noStorageLocation] });
    expect(templateProblems(LOCATED)).toEqual({});
  });

  it("refuses the lists of the namespaces the release refuses, every namespace standing for none included", () => {
    expect(templateProblems({ ...LOCATED, includedNamespaces: ["*", "shop"] })).toEqual({
      includedNamespaces: [
        TEMPLATE_WORDS.namespaceLists("includes list must either contain '*' only, or a non-empty list of items"),
      ],
    });
    // No namespace included is every namespace, `*`, which the excluded ones may not hold.
    expect(templateProblems({ ...LOCATED, excludedNamespaces: ["*"] })).toEqual({
      excludedNamespaces: [
        TEMPLATE_WORDS.namespaceLists("excludes list cannot contain '*'"),
        TEMPLATE_WORDS.namespaceLists("excludes list cannot contain an item in the includes list: *"),
      ],
    });
    expect(templateProblems({ ...LOCATED, includedNamespaces: ["shop", "web"], excludedNamespaces: ["web"] })).toEqual({
      excludedNamespaces: [
        TEMPLATE_WORDS.namespaceLists("excludes list cannot contain an item in the includes list: web"),
      ],
    });
    expect(templateProblems({ ...LOCATED, includedNamespaces: ["*"], excludedNamespaces: ["kube-*"] })).toEqual({});
  });

  it("refuses the patterns of the namespaces the release refuses, and the names they are not", () => {
    const refused = (namespace: string) =>
      templateProblems({ ...LOCATED, includedNamespaces: [namespace] }).includedNamespaces;

    expect(refused("shop-*")).toBeUndefined();
    expect(refused("shop-[a-c]?")).toBeUndefined();
    expect(refused("a**")).toEqual([
      TEMPLATE_WORDS.namespaceLists("wildcard pattern contains consecutive asterisks (only single * allowed)"),
    ]);
    expect(refused("a|b")).toEqual([
      TEMPLATE_WORDS.namespaceLists("wildcard pattern contains unsupported characters: |, (, ), !, {, }, ,"),
    ]);
    expect(refused("a[]")).toEqual([
      TEMPLATE_WORDS.namespaceLists("wildcard pattern contains empty bracket pattern '[]'"),
    ]);
    expect(refused("a[b")).toEqual([TEMPLATE_WORDS.namespaceLists("wildcard pattern contains unclosed bracket '['")]);
    expect(refused("a]")).toEqual([
      TEMPLATE_WORDS.namespaceLists("wildcard pattern contains unmatched closing bracket ']'"),
    ]);
    expect(refused("Shop")).toEqual([
      TEMPLATE_WORDS.namespaceLists(
        `invalid namespace "Shop": a lowercase RFC 1123 label must consist of lower case alphanumeric characters or '-', and must start and end with an alphanumeric character (e.g. 'my-name',  or '123-abc', regex used for validation is '[a-z0-9]([-a-z0-9]*[a-z0-9])?')`,
      ),
    ]);
    expect(refused("a.b")).toEqual([TEMPLATE_WORDS.namespaceLists(`invalid namespace "a.b": must not contain dots`)]);
  });

  it("refuses the lists of the resources the release refuses, with no default for them", () => {
    expect(templateProblems({ ...LOCATED, excludedResources: ["secrets"] })).toEqual({});
    expect(templateProblems({ ...LOCATED, includedResources: ["*", "pods"], excludedResources: ["*"] })).toEqual({
      includedResources: [
        TEMPLATE_WORDS.resourceLists("includes list must either contain '*' only, or a non-empty list of items"),
      ],
      excludedResources: [
        TEMPLATE_WORDS.resourceLists("excludes list cannot contain '*'"),
        TEMPLATE_WORDS.resourceLists("excludes list cannot contain an item in the includes list: *"),
      ],
    });
  });

  it("takes one of the two selectors, each one Kubernetes reads", () => {
    expect(templateProblems({ ...LOCATED, labelSelector: "app=web", orLabelSelectors: ["tier=db"] })).toEqual({
      orLabelSelectors: [TEMPLATE_WORDS.bothSelectors],
    });
    expect(templateProblems({ ...LOCATED, orLabelSelectors: ["app=web", "app>1"] })).toEqual({
      orLabelSelectors: [TEMPLATE_WORDS.selector(`"gt" isn't supported in label selectors`)],
    });
    expect(templateProblems({ ...LOCATED, orLabelSelectors: [] })).toEqual({
      orLabelSelectors: [TEMPLATE_WORDS.emptySelector],
    });
  });

  it("refuses a duration Go does not read, and one that is not above zero", () => {
    expect(templateProblems({ ...LOCATED, ttl: "1d" })).toEqual({ ttl: [TEMPLATE_WORDS.duration("1d")] });
    expect(templateProblems({ ...LOCATED, csiSnapshotTimeout: "0s" })).toEqual({
      csiSnapshotTimeout: [TEMPLATE_WORDS.notAboveZero("0s")],
    });
    expect(templateProblems({ ...LOCATED, itemOperationTimeout: "-1h" })).toEqual({
      itemOperationTimeout: [TEMPLATE_WORDS.notAboveZero("-1h")],
    });
    expect(durationOf("1.5h")).toEqual({ written: "1h30m0s" });
  });

  it("refuses a location that is not a name, and takes a snapshot location named twice, as the release does", () => {
    expect(templateProblems({ storageLocation: "Default" }).storageLocation?.[0]).toMatch(
      /^The name of a storage location a lowercase RFC 1123 subdomain/,
    );
    expect(templateProblems({ ...LOCATED, volumeSnapshotLocations: ["Aws"] }).volumeSnapshotLocations?.[0]).toMatch(
      /^The name of the snapshot location Aws a lowercase RFC 1123 subdomain/,
    );
    expect(templateProblems({ ...LOCATED, volumeSnapshotLocations: ["aws", "aws"] })).toEqual({});
    expect(templateSpec({ ...LOCATED, volumeSnapshotLocations: ["aws", "aws"] })).toEqual({
      storageLocation: "default",
      volumeSnapshotLocations: ["aws"],
    });
  });

  it("refuses the names of the excluded namespaces as the release does", () => {
    expect(templateProblems({ ...LOCATED, excludedNamespaces: ["A_b", "a**"] }).excludedNamespaces).toEqual([
      TEMPLATE_WORDS.namespaceLists(
        `invalid namespace "A_b": a lowercase RFC 1123 label must consist of lower case alphanumeric characters or '-', and must start and end with an alphanumeric character (e.g. 'my-name',  or '123-abc', regex used for validation is '[a-z0-9]([-a-z0-9]*[a-z0-9])?')`,
      ),
      TEMPLATE_WORDS.namespaceLists("wildcard pattern contains consecutive asterisks (only single * allowed)"),
    ]);
  });

  it("says a field beyond the bounds the contract gives it, and a template too large to be asked", () => {
    const many = (count: number, length = 3) => Array.from({ length: count }, (_, at) => `n${at}`.padEnd(length, "x"));

    expect(templateProblems({ ...LOCATED, includedResources: many(256) })).toEqual({});
    expect(templateProblems({ ...LOCATED, includedResources: many(257) })).toEqual({
      includedResources: [TEMPLATE_WORDS.tooMany(256)],
    });
    expect(templateProblems({ ...LOCATED, includedResources: ["r".repeat(254)] })).toEqual({
      includedResources: [TEMPLATE_WORDS.tooLong(253)],
    });
    expect(templateProblems({ ...LOCATED, orLabelSelectors: Array.from({ length: 17 }, () => "a") })).toEqual({
      orLabelSelectors: [TEMPLATE_WORDS.tooMany(16)],
    });
    expect(templateProblems({ ...LOCATED, labelSelector: `a in (${"v,".repeat(600)}v)` }).labelSelector).toContain(
      TEMPLATE_WORDS.tooLong(1024),
    );
    const large = {
      ...LOCATED,
      includedResources: many(250, 240),
      excludedResources: many(10, 240).map((item) => `e${item}`),
    };

    expect(templateProblems(large)).toEqual({
      includedResources: [TEMPLATE_WORDS.tooLarge(JSON.stringify(large).length)],
    });
    // The template of a schedule says the schedule, which is created from the command line.
    expect(templateProblems(large, "schedule")).toEqual({
      includedResources: [TEMPLATE_WORDS.tooLarge(JSON.stringify(large).length, "schedule")],
    });
    expect(
      templateProblems(
        { ...LOCATED, includedResources: many(257), excludedResources: ["r".repeat(254)], ttl: `${"0s".repeat(32)}1h` },
        "schedule",
      ),
    ).toEqual({
      includedResources: [TEMPLATE_WORDS.tooMany(256, "schedule")],
      excludedResources: [TEMPLATE_WORDS.tooLong(253, "schedule")],
      ttl: [TEMPLATE_WORDS.tooLong(64, "schedule")],
    });
    expect([
      TEMPLATE_WORDS.tooMany(256, "schedule"),
      TEMPLATE_WORDS.tooLong(253, "schedule"),
      TEMPLATE_WORDS.tooLarge(70_000, "schedule"),
    ]).toEqual([
      "The form takes 256 at most here: a schedule that needs more is created from the command line.",
      "An item longer than 253 characters is not one the form takes: a schedule that needs it is created from the command line.",
      "The fields of the form are written in 70000 characters, more than the main process is asked with: a schedule this large is created from the command line.",
    ]);
  });
});

describe("the spec a template writes", () => {
  it("writes the fields that are set, and leaves the others out", () => {
    expect(templateSpec(LOCATED)).toEqual({ storageLocation: "default" });
    expect(
      templateSpec({
        ...LOCATED,
        includedNamespaces: ["shop", "web", "shop"],
        excludedResources: ["secrets"],
        includeClusterResources: false,
        labelSelector: "app=web,tier in (front)",
        volumeSnapshotLocations: ["aws"],
        snapshotVolumes: true,
        defaultVolumesToFsBackup: false,
        snapshotMoveData: true,
        ttl: "720h",
        csiSnapshotTimeout: "10m",
        itemOperationTimeout: "4h",
      }),
    ).toEqual({
      includedNamespaces: ["shop", "web"],
      excludedResources: ["secrets"],
      labelSelector: {
        matchLabels: { app: "web" },
        matchExpressions: [{ key: "tier", operator: "In", values: ["front"] }],
      },
      snapshotVolumes: true,
      ttl: "720h0m0s",
      includeClusterResources: false,
      storageLocation: "default",
      volumeSnapshotLocations: ["aws"],
      defaultVolumesToFsBackup: false,
      csiSnapshotTimeout: "10m0s",
      itemOperationTimeout: "4h0m0s",
      snapshotMoveData: true,
    });
  });

  it("writes several selectors as several, and empty lists as nothing", () => {
    expect(templateSpec({ ...LOCATED, orLabelSelectors: ["app=web", "!legacy"], includedResources: [] })).toEqual({
      orLabelSelectors: [
        { matchLabels: { app: "web" } },
        { matchExpressions: [{ key: "legacy", operator: "DoesNotExist" }] },
      ],
      storageLocation: "default",
    });
  });

  it("writes nothing for a template the release refuses", () => {
    expect(templateSpec({ ...LOCATED, excludedNamespaces: ["*"] })).toBeUndefined();
    expect(templateSpec({})).toBeUndefined();
  });
});
