import { describe, expect, it } from "vitest";
import {
  backupHolds,
  everyNamespace,
  NON_RESTORABLE,
  proposedRestoreName,
  RESTORE_NAME_WORDS,
  RESTORE_WORDS,
  type RestoreForm,
  readGlob,
  readRestoreBody,
  restoreBodyText,
  restoreFromForm,
  restoreNameProblem,
  restoreProblems,
} from "./restore-form";

const FORM: RestoreForm = { clusterResources: "needed", existingResourcePolicy: "none" };
const SHOP = { includedNamespaces: ["shop", "web-*"], excludedNamespaces: ["web-test"] };

describe("what the restore controller refuses of a form, with its words", () => {
  it("asks for the cluster-scoped resources, which the form writes nothing for until one is chosen", () => {
    expect(restoreProblems({ existingResourcePolicy: "none" }, SHOP).problems).toEqual({
      clusterResources: [RESTORE_WORDS.noClusterResources],
    });
    expect(restoreProblems(FORM, SHOP)).toEqual({ problems: {}, warnings: [] });
  });

  it("checks the lists as the restore controller checks them, the included namespaces not taken for every one", () => {
    // The backup controller takes no included namespace as `*` before it checks: the restore controller does not.
    expect(restoreProblems({ ...FORM, excludedNamespaces: ["*"] }, SHOP).problems).toEqual({
      excludedNamespaces: [RESTORE_WORDS.namespaceLists("excludes list cannot contain '*'")],
    });
    expect(
      restoreProblems({ ...FORM, includedNamespaces: ["*", "shop"], excludedResources: ["*"] }, SHOP).problems,
    ).toEqual({
      includedNamespaces: [
        RESTORE_WORDS.namespaceLists("includes list must either contain '*' only, or a non-empty list of items"),
      ],
      excludedResources: [RESTORE_WORDS.resourceLists("excludes list cannot contain '*'")],
    });
    expect(
      restoreProblems({ ...FORM, includedResources: ["pods"], excludedResources: ["pods"] }, SHOP).problems,
    ).toEqual({
      excludedResources: [
        RESTORE_WORDS.resourceLists("excludes list cannot contain an item in the includes list: pods"),
      ],
    });
  });

  it("refuses among the included resources the ones Velero never restores, with its words, and the conflict of the lists it makes of them", () => {
    // The resources of the release, in its order (restore_controller.go L66-L95).
    expect(NON_RESTORABLE).toEqual([
      "nodes",
      "events",
      "events.events.k8s.io",
      "backups.velero.io",
      "restores.velero.io",
      "resticrepositories.velero.io",
      "csinodes.storage.k8s.io",
      "volumeattachments.storage.k8s.io",
      "backuprepositories.velero.io",
    ]);
    // The controller adds them to the excluded ones before it checks the lists: each one included is in both.
    expect(
      restoreProblems({ ...FORM, includedResources: ["pods", "nodes", "backups.velero.io"] }, SHOP).problems,
    ).toEqual({
      includedResources: [
        "nodes are non-restorable resources",
        "backups.velero.io are non-restorable resources",
        "Invalid included/excluded resource lists: excludes list cannot contain an item in the includes list: backups.velero.io",
        "Invalid included/excluded resource lists: excludes list cannot contain an item in the includes list: nodes",
      ],
    });
    // One the operator excluded as well is in both lists once, with the excluded ones.
    expect(
      restoreProblems({ ...FORM, includedResources: ["events"], excludedResources: ["events"] }, SHOP).problems,
    ).toEqual({
      includedResources: ["events are non-restorable resources"],
      excludedResources: [
        "Invalid included/excluded resource lists: excludes list cannot contain an item in the includes list: events",
      ],
    });
    for (const resource of NON_RESTORABLE)
      expect(restoreProblems({ ...FORM, includedResources: [resource] }, SHOP).problems.includedResources?.[0]).toBe(
        `${resource} are non-restorable resources`,
      );
  });

  it("writes the words of the restore controller as the release writes them", () => {
    expect([
      RESTORE_WORDS.nonRestorable("nodes"),
      RESTORE_WORDS.namespaceLists("excludes list cannot contain '*'"),
      RESTORE_WORDS.resourceLists("excludes list cannot contain '*'"),
      RESTORE_WORDS.bothSelectors,
    ]).toEqual([
      "nodes are non-restorable resources",
      "Invalid included/excluded namespace lists: excludes list cannot contain '*'",
      "Invalid included/excluded resource lists: excludes list cannot contain '*'",
      "encountered labelSelector as well as orLabelSelectors in restore spec, only one can be specified",
    ]);
  });

  it("takes one of the two selectors, each one Kubernetes reads", () => {
    expect(
      restoreProblems({ ...FORM, labelSelector: "app=web", orLabelSelectors: ["tier=db"] }, SHOP).problems,
    ).toEqual({ orLabelSelectors: [RESTORE_WORDS.bothSelectors] });
    expect(restoreProblems({ ...FORM, labelSelector: "app>1" }, SHOP).problems.labelSelector).toEqual([
      RESTORE_WORDS.selector(`"gt" isn't supported in label selectors`),
    ]);
    // A list of selectors that names none is not set, and is refused.
    expect(restoreProblems({ ...FORM, orLabelSelectors: [] }, SHOP).problems).toEqual({
      orLabelSelectors: [RESTORE_WORDS.emptySelector],
    });
    expect(restoreProblems({ ...FORM, orLabelSelectors: ["app=web", "tier=db"] }, SHOP).problems).toEqual({});
  });

  it("refuses a mapping Velero would use for nothing, a target that is not a name, and a source or a target twice", () => {
    const mapped = (pairs: [string, string][]) => restoreProblems({ ...FORM, namespaceMapping: pairs }, SHOP);

    expect(
      mapped([
        ["shop", "shop-restored"],
        ["web-a", "web-restored"],
      ]),
    ).toEqual({ problems: {}, warnings: [] });
    expect(mapped([["web-test", "web-restored"]]).problems).toEqual({
      namespaceMapping: [RESTORE_WORDS.usedForNothing("web-test")],
    });
    expect(mapped([["other", "other-restored"]]).problems).toEqual({
      namespaceMapping: [RESTORE_WORDS.usedForNothing("other")],
    });
    // A target that is not a name of a namespace, said in the words of the form, once whatever is wrong with it.
    expect(mapped([["shop", "Shop"]]).problems).toEqual({ namespaceMapping: [RESTORE_WORDS.target("Shop")] });
    expect(mapped([["shop", `S.${"a".repeat(70)}`]]).problems).toEqual({
      namespaceMapping: [RESTORE_WORDS.target(`S.${"a".repeat(70)}`)],
    });
    expect(RESTORE_WORDS.target("Shop")).toBe(
      'The namespace Shop, which a mapping restores into, is not a name a namespace can have: lower-case letters, digits and "-", beginning and ending with a letter or a digit, 63 characters at most.',
    );
    // A namespace the lists of the restore leave out is not restored, whatever the backup holds (restore.go L2579).
    expect(
      restoreProblems({ ...FORM, includedNamespaces: ["web-a"], namespaceMapping: [["shop", "s"]] }, SHOP).problems,
    ).toEqual({
      namespaceMapping: [RESTORE_WORDS.leftOut("shop")],
    });
    expect(
      restoreProblems({ ...FORM, excludedNamespaces: ["sh*"], namespaceMapping: [["shop", "s"]] }, SHOP).problems,
    ).toEqual({
      namespaceMapping: [RESTORE_WORDS.leftOut("shop")],
    });
    expect(restoreProblems({ ...FORM, includedNamespaces: ["sh?p"], namespaceMapping: [["shop", "s"]] }, SHOP)).toEqual(
      {
        problems: {},
        warnings: [],
      },
    );
    expect(restoreProblems({ ...FORM, includedNamespaces: ["*"], namespaceMapping: [["shop", "s"]] }, SHOP)).toEqual({
      problems: {},
      warnings: [],
    });
    // Under a backup of every namespace as well: what the restore leaves out is refused, not warned of.
    expect(restoreProblems({ ...FORM, includedNamespaces: ["web-a"], namespaceMapping: [["shop", "s"]] }, {})).toEqual({
      problems: { namespaceMapping: [RESTORE_WORDS.leftOut("shop")] },
      warnings: [],
    });
    // A pair with a side not typed says what it lacks, once.
    expect(mapped([["", ""]]).problems).toEqual({ namespaceMapping: [RESTORE_WORDS.noSource] });
    expect(mapped([["", "shop-2"]]).problems).toEqual({ namespaceMapping: [RESTORE_WORDS.noSource] });
    expect(mapped([["shop", ""]]).problems).toEqual({ namespaceMapping: [RESTORE_WORDS.noTarget("shop")] });
    expect(
      mapped([
        ["", "one"],
        ["", "two"],
      ]).problems,
    ).toEqual({ namespaceMapping: [RESTORE_WORDS.noSource, RESTORE_WORDS.noSource] });
    expect(
      mapped([
        ["shop", "one"],
        ["shop", "two"],
      ]).problems,
    ).toEqual({
      namespaceMapping: [RESTORE_WORDS.sourceTwice("shop")],
    });
    expect(
      mapped([
        ["shop", "one"],
        ["web-a", "one"],
      ]).problems,
    ).toEqual({
      namespaceMapping: [RESTORE_WORDS.targetTwice("one")],
    });
  });

  it("keeps the mapping of a backup that took every namespace, with the words that it may be used for nothing", () => {
    expect(restoreProblems({ ...FORM, namespaceMapping: [["shop", "shop-2"]] }, {})).toEqual({
      problems: {},
      warnings: [RESTORE_WORDS.everyNamespace("shop")],
    });
    // A name no namespace can have is in no backup, even one of every namespace.
    expect(restoreProblems({ ...FORM, namespaceMapping: [["Shop", "shop-2"]] }, {}).problems).toEqual({
      namespaceMapping: [RESTORE_WORDS.usedForNothing("Shop")],
    });
    // A namespace the backup excludes is used for nothing, whatever it includes.
    expect(
      restoreProblems({ ...FORM, namespaceMapping: [["legacy", "legacy-2"]] }, { excludedNamespaces: ["leg*"] })
        .problems,
    ).toEqual({ namespaceMapping: [RESTORE_WORDS.usedForNothing("legacy")] });
  });

  it("takes a backup of `*` or of no included namespace for one of every namespace, whose mapping is a warning", () => {
    for (const backup of [{}, { includedNamespaces: [] }, { includedNamespaces: ["*"] }]) {
      expect(everyNamespace(backup)).toBe(true);
      expect(restoreProblems({ ...FORM, namespaceMapping: [["shop", "shop-2"]] }, backup)).toEqual({
        problems: {},
        warnings: [RESTORE_WORDS.everyNamespace("shop")],
      });
    }
    expect(everyNamespace({ includedNamespaces: ["shop"] })).toBe(false);
  });

  it("matches the namespaces of a backup as the glob package of the release does", () => {
    const backup = { includedNamespaces: ["web-?", "db-[ab]", "shop.*"] };

    expect(["web-1", "db-a", "shop.eu"].map((name) => backupHolds(backup, name))).toEqual([true, true, true]);
    expect(["web-12", "db-c", "shopXeu", "shop"].map((name) => backupHolds(backup, name))).toEqual([
      false,
      false,
      false,
      false,
    ]);
    const holds = (pattern: string, names: string[]) =>
      names.map((name) => backupHolds({ includedNamespaces: [pattern] }, name));

    // `*` takes no character as well, and as many as there are.
    expect(holds("prod*", ["prod", "prod-eu", "pro"])).toEqual([true, true, false]);
    expect(holds("*-eu", ["-eu", "shop-eu", "shop-us"])).toEqual([true, true, false]);
    expect(holds("a*b*c", ["abc", "axxbyyc", "acb"])).toEqual([true, true, false]);
    // One range, its ends included, or one list; `!` turns either; `^` is a character of a list.
    expect(holds("db-[a-c]", ["db-a", "db-c", "db-d"])).toEqual([true, true, false]);
    expect(holds("db-[!a-c]", ["db-a", "db-d"])).toEqual([false, true]);
    expect(holds("db-[!ab]", ["db-a", "db-c"])).toEqual([false, true]);
    expect(holds("db-[^a]", ["db-^", "db-a", "db-b"])).toEqual([true, true, false]);
    expect(holds("db-[-a]", ["db--", "db-a"])).toEqual([true, true]);
    // `\` takes the next character as it is.
    expect(holds("web\\*", ["web*", "web-1"])).toEqual([true, false]);
    // `**` is `*` when nothing separates the parts.
    expect(holds("web-**", ["web-a-b"])).toEqual([true]);
  });

  it("reads a pattern as the glob package reads it, and one it does not compile matches nothing, as the release matches a list", () => {
    for (const pattern of ["db-[a-c", "db-[a-]", "db-[c-a]", "db-[]", "db-[!]", "db-[a-c0-9]", "db-[ab", "{a,b}"])
      expect([pattern, readGlob(pattern)]).toEqual([pattern, undefined]);
    expect(readGlob("db-[a-c]x")).toEqual([
      { text: "d" },
      { text: "b" },
      { text: "-" },
      { lo: "a", hi: "c", not: false },
      { text: "x" },
    ]);
    // The release matches the patterns of a list in their order, and the first it does not compile ends the match.
    expect(backupHolds({ includedNamespaces: ["shop-[", "zz"] }, "zz")).toBe(false);
    expect(backupHolds({ includedNamespaces: ["aa", "shop-["] }, "aa")).toBe(true);
    // In the order of their characters, whatever the order of the list.
    expect(backupHolds({ includedNamespaces: ["zz", "shop-["] }, "zz")).toBe(false);
    expect(backupHolds({ includedNamespaces: ["shop"], excludedNamespaces: ["[", "shop"] }, "shop")).toBe(true);
  });

  it("matches a pattern of many stars in a time bounded by the lengths of the two", () => {
    const began = performance.now();

    expect(backupHolds({ includedNamespaces: ["*a".repeat(10)] }, "a".repeat(9).padEnd(50, "b"))).toBe(false);
    expect(backupHolds({ includedNamespaces: ["*a".repeat(10)] }, "ba".repeat(25))).toBe(true);
    expect(performance.now() - began).toBeLessThan(250);
  });
});

describe("the Restore of the form", () => {
  it("names its backup, writes the policy always, the cluster-scoped choice as made, and the fields set alone", () => {
    const body = restoreFromForm(
      "velero",
      "shop-20261108120000",
      "shop",
      {
        ...FORM,
        clusterResources: "none",
        includedNamespaces: ["shop", "shop"],
        namespaceMapping: [["shop", "shop-restored"]],
        labelSelector: "app=web",
        restorePVs: false,
        existingResourcePolicy: "update",
      },
      SHOP,
    );

    expect(body).toEqual({
      apiVersion: "velero.io/v1",
      kind: "Restore",
      metadata: { name: "shop-20261108120000", namespace: "velero" },
      spec: {
        backupName: "shop",
        includedNamespaces: ["shop"],
        namespaceMapping: { shop: "shop-restored" },
        labelSelector: { matchLabels: { app: "web" } },
        restorePVs: false,
        includeClusterResources: false,
        existingResourcePolicy: "update",
      },
    });
    expect(restoreFromForm("velero", "r", "shop", { ...FORM, clusterResources: "every" }, SHOP)?.spec).toEqual({
      backupName: "shop",
      includeClusterResources: true,
      existingResourcePolicy: "none",
    });
    // The resources the restored ones need: the field is left out, and the release adds what they need.
    expect(restoreFromForm("velero", "r", "shop", FORM, SHOP)?.spec).toEqual({
      backupName: "shop",
      existingResourcePolicy: "none",
    });
  });

  it.each([
    ["includedNamespaces", { includedNamespaces: ["shop", "web-a"] }, { includedNamespaces: ["shop", "web-a"] }],
    ["excludedNamespaces", { excludedNamespaces: ["web-test"] }, { excludedNamespaces: ["web-test"] }],
    [
      "includedResources",
      { includedResources: ["configmaps", "secrets"] },
      { includedResources: ["configmaps", "secrets"] },
    ],
    ["excludedResources", { excludedResources: ["pods"] }, { excludedResources: ["pods"] }],
    [
      "namespaceMapping",
      {
        namespaceMapping: [
          ["shop", "shop-2"],
          ["web-a", "web-2"],
        ],
      },
      { namespaceMapping: { shop: "shop-2", "web-a": "web-2" } },
    ],
    [
      "labelSelector",
      { labelSelector: "app=web,tier in (db)" },
      {
        labelSelector: {
          matchLabels: { app: "web" },
          matchExpressions: [{ key: "tier", operator: "In", values: ["db"] }],
        },
      },
    ],
    [
      "orLabelSelectors",
      { orLabelSelectors: ["app=web", "tier"] },
      {
        orLabelSelectors: [
          { matchLabels: { app: "web" } },
          { matchExpressions: [{ key: "tier", operator: "Exists" }] },
        ],
      },
    ],
    ["restorePVs true", { restorePVs: true }, { restorePVs: true }],
    ["restorePVs false", { restorePVs: false }, { restorePVs: false }],
    ["includeClusterResources every", { clusterResources: "every" }, { includeClusterResources: true }],
    ["includeClusterResources none", { clusterResources: "none" }, { includeClusterResources: false }],
    ["existingResourcePolicy update", { existingResourcePolicy: "update" }, { existingResourcePolicy: "update" }],
  ] as const)("writes %s as the form sets it, and nothing else", (_field, set, written) => {
    const body = restoreFromForm("velero", "r", "shop", { ...FORM, ...(set as Partial<RestoreForm>) }, SHOP);

    expect(body?.spec).toEqual({ backupName: "shop", existingResourcePolicy: "none", ...written });
  });

  it("writes nothing for a name, a backup or a form refused, and is read back from its text, of a backup and never of a schedule", () => {
    expect(restoreFromForm("velero", "Shop", "shop", FORM, SHOP)).toBeUndefined();
    expect(restoreFromForm("velero", "r", "", FORM, SHOP)).toBeUndefined();
    expect(restoreFromForm("velero", "r", "shop", { existingResourcePolicy: "none" }, SHOP)).toBeUndefined();
    const body = restoreFromForm("velero", "r", "shop", FORM, SHOP);

    if (!body) throw new Error("The form of the test is refused");
    const text = restoreBodyText(body);

    expect(text.split("\n").slice(0, 4)).toEqual([
      "{",
      '  "apiVersion": "velero.io/v1",',
      '  "kind": "Restore",',
      '  "metadata": {',
    ]);
    expect(readRestoreBody(text)).toEqual(body);
    expect(
      readRestoreBody('{"kind":"Restore","metadata":{},"spec":{"scheduleName":"daily","backupName":"x"}}'),
    ).toBeUndefined();
    expect(readRestoreBody('{"kind":"Backup","metadata":{},"spec":{"backupName":"x"}}')).toBeUndefined();
  });

  it("proposes the name the command line proposes, in UTC, and checks a name as the one of a backup", () => {
    expect(proposedRestoreName("nightly", Date.UTC(2026, 10, 8, 12, 0, 5))).toBe("nightly-20261108120005");
    expect(restoreNameProblem("a".repeat(216))).toBeUndefined();
    expect(restoreNameProblem("a".repeat(217))).toBe(RESTORE_NAME_WORDS.long(217));
    expect(restoreNameProblem("")).toBe(RESTORE_NAME_WORDS.empty);
    expect(restoreNameProblem("a..b")).toBe(RESTORE_NAME_WORDS.form);
  });
});
