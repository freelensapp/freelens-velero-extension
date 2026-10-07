import { describe, expect, it } from "vitest";
import { syntheticResourceList } from "../../e2e/scripts/local-artifacts.mts";
import {
  actionChoice,
  filterResources,
  itemsCount,
  NOT_STATED,
  otherShape,
  parseResources,
  RESTORE_ACTIONS,
  resourcesCount,
} from "./artifact-resources";

const BACKUP = JSON.stringify({
  "v1/Pod": ["shop/cart", "shop/pay", "billing/ledger"],
  "apps/v1/Deployment": ["shop/cart"],
  "v1/Namespace": ["shop", "billing"],
  "rbac.authorization.k8s.io/v1/ClusterRole": ["system:node"],
});
const RESTORE = JSON.stringify({
  "v1/Pod": ["shop/cart(created)", "shop/pay(failed)", "billing/ledger(skipped)"],
  "v1/ConfigMap": ["shop/settings(updated)", "shop/old", "shop/odd(replaced)", "shop/name(with)parts(created)"],
  "v1/Namespace": ["shop(created)"],
});

describe("the resource list of an operation", () => {
  it("reads the resources by their API version and kind, sorted, each with its items sorted and counted", () => {
    const list = parseResources(BACKUP, "Backup");

    expect(list?.count).toBe(7);
    expect(list?.resources.map((resource) => [resource.resource, resource.items.length])).toEqual([
      ["apps/v1/Deployment", 1],
      ["rbac.authorization.k8s.io/v1/ClusterRole", 1],
      ["v1/Namespace", 2],
      ["v1/Pod", 3],
    ]);
    expect(list?.resources[3].items).toEqual([
      { text: "billing/ledger", namespace: "billing", name: "ledger" },
      { text: "shop/cart", namespace: "shop", name: "cart" },
      { text: "shop/pay", namespace: "shop", name: "pay" },
    ]);
    // An item of the cluster has a name and no namespace, whatever its name carries.
    expect(list?.resources[2].items).toEqual([
      { text: "billing", name: "billing" },
      { text: "shop", name: "shop" },
    ]);
    expect(list?.resources[1].items).toEqual([{ text: "system:node", name: "system:node" }]);
    // A backup has no actions: nothing is counted of them.
    expect(list).not.toHaveProperty("actions");
  });

  it("reads the action of a restore after each item, and counts as not stated what has none the release writes", () => {
    const list = parseResources(RESTORE, "Restore");

    expect(list?.count).toBe(8);
    expect(list?.actions).toEqual({ created: 3, updated: 1, failed: 1, skipped: 1, "not stated": 2 });
    const configs = list?.resources.find((resource) => resource.resource === "v1/ConfigMap")?.items;

    expect(configs).toEqual([
      // The action is what the last parentheses hold: a name may carry others before them.
      { text: "shop/name(with)parts(created)", namespace: "shop", name: "name(with)parts", action: "created" },
      // An action the release does not write, and an item without one, keep their text.
      { text: "shop/odd(replaced)", namespace: "shop", name: "odd(replaced)" },
      { text: "shop/old", namespace: "shop", name: "old" },
      { text: "shop/settings(updated)", namespace: "shop", name: "settings", action: "updated" },
    ]);
    expect(list?.resources.find((resource) => resource.resource === "v1/Namespace")?.items).toEqual([
      { text: "shop(created)", name: "shop", action: "created" },
    ]);
    // The action is after the item, at its end: parentheses that are followed by something are of its name.
    const within = parseResources(
      JSON.stringify({ "batch/v1/Job": ["shop/sync(created)-copy", "shop/sync(failed) ", "shop/(skipped)x(updated)"] }),
      "Restore",
    );

    expect(within?.resources[0].items).toEqual([
      { text: "shop/(skipped)x(updated)", namespace: "shop", name: "(skipped)x", action: "updated" },
      { text: "shop/sync(created)-copy", namespace: "shop", name: "sync(created)-copy" },
      { text: "shop/sync(failed) ", namespace: "shop", name: "sync(failed) " },
    ]);
    expect(within?.actions).toEqual({ created: 0, updated: 1, failed: 0, skipped: 0, "not stated": 2 });
    // The same text read as the list of a backup has no action taken out of its names.
    expect(parseResources(RESTORE, "Backup")?.resources[1].items[0]).toEqual({
      text: "shop(created)",
      name: "shop(created)",
    });
  });

  it("reads a list with nothing in it, and a resource with no item", () => {
    expect(parseResources("{}", "Backup")).toEqual({ resources: [], count: 0 });
    expect(parseResources("{}", "Restore")).toEqual({
      resources: [],
      count: 0,
      actions: { created: 0, updated: 0, failed: 0, skipped: 0, "not stated": 0 },
    });
    expect(parseResources('{"v1/Pod":[]}', "Backup")).toEqual({
      resources: [{ resource: "v1/Pod", items: [] }],
      count: 0,
    });
  });

  it("answers nothing for what is not of the shape of the release, and raises nothing", () => {
    for (const written of [
      "",
      "not JSON",
      "[]",
      "null",
      "3",
      '{"v1/Pod":"shop/cart"}',
      '{"v1/Pod":[1]}',
      '{"v1/Pod":[null]}',
      '{"v1/Pod":{"shop":["cart"]}}',
      '{"v1/Pod":null}',
    ])
      expect([written, parseResources(written, "Backup")]).toEqual([written, undefined]);
  });

  it("reads a resource named as a key every object has", () => {
    const list = parseResources('{"__proto__":["a"],"constructor":["b"]}', "Backup");

    expect(list?.resources.map((resource) => resource.resource)).toEqual(["__proto__", "constructor"]);
    expect(list?.count).toBe(2);
  });
});

describe("the filter of a resource list", () => {
  const backup = parseResources(BACKUP, "Backup");
  const restore = parseResources(RESTORE, "Restore");

  if (!backup || !restore) throw new Error("The lists of the test are not read");

  it("narrows the items by the resource, the namespace and the name, whatever the capitals, with the counts of what is left", () => {
    expect(filterResources(backup, "").count).toBe(7);
    expect(filterResources(backup, "   ")).toEqual(backup);
    const pods = filterResources(backup, "POD");

    expect(pods.resources.map((resource) => [resource.resource, resource.items.length])).toEqual([["v1/Pod", 3]]);
    expect(pods.count).toBe(3);
    // The words of a namespace find its items, and the namespace itself where it is an item of the cluster.
    expect(
      filterResources(backup, "billing").resources.map((resource) => [
        resource.resource,
        resource.items.map((item) => item.text),
      ]),
    ).toEqual([
      ["v1/Namespace", ["billing"]],
      ["v1/Pod", ["billing/ledger"]],
    ]);
    expect(filterResources(backup, "cart").count).toBe(2);
    expect(filterResources(backup, "no such thing")).toEqual({ resources: [], count: 0 });
    // Several words are all asked of an item, each of any of its three parts.
    expect(filterResources(backup, "pod shop").resources[0].items.map((item) => item.text)).toEqual([
      "shop/cart",
      "shop/pay",
    ]);
    expect(filterResources(backup, "deployment billing").count).toBe(0);
    // The capitals of a name are no part of what is asked, as the ones of what is typed are not: the
    // names of some kinds are written with them.
    const capitals = parseResources(
      JSON.stringify({ "rbac.authorization.k8s.io/v1/ClusterRole": ["System:Node-Reader", "view"] }),
      "Backup",
    );

    if (!capitals) throw new Error("The list of the test is not read");
    for (const words of ["node-reader", "System:Node", "SYSTEM:NODE-READER"])
      expect([words, filterResources(capitals, words).resources[0]?.items.map((item) => item.text)]).toEqual([
        words,
        ["System:Node-Reader"],
      ]);
  });

  it("narrows the items of a restore by their action, and counts the actions of what is left", () => {
    expect(filterResources(restore, "", "created").count).toBe(3);
    expect(filterResources(restore, "", "created").actions).toEqual({
      created: 3,
      updated: 0,
      failed: 0,
      skipped: 0,
      "not stated": 0,
    });
    expect(
      filterResources(restore, "", "not stated").resources.map((resource) => resource.items.map((item) => item.text)),
    ).toEqual([["shop/odd(replaced)", "shop/old"]]);
    expect(filterResources(restore, "pod", "failed").resources).toEqual([
      { resource: "v1/Pod", items: [{ text: "shop/pay(failed)", namespace: "shop", name: "pay", action: "failed" }] },
    ]);
    expect(filterResources(restore, "shop").actions).toEqual({
      created: 3,
      updated: 1,
      failed: 1,
      skipped: 0,
      "not stated": 2,
    });
    // The words are asked of the name, and not of the action written after it.
    expect(filterResources(restore, "created").count).toBe(0);
  });
});

describe("the words of a resource list", () => {
  const backup = parseResources(BACKUP, "Backup");
  const restore = parseResources(RESTORE, "Restore");

  if (!backup || !restore) throw new Error("The lists of the test are not read");

  it("say how many items a list holds and of how many resources, one of each in the singular", () => {
    expect(resourcesCount(backup, backup, "")).toBe("7 items of 4 resources.");
    expect(resourcesCount(restore, restore, "  ")).toBe("8 items of 3 resources.");
    const one = parseResources('{"v1/Pod":["shop/cart"]}', "Backup");

    expect(one && resourcesCount(one, one, "")).toBe("1 item of 1 resource.");
  });

  it("say of how many when a filter is on, also when it leaves every item", () => {
    expect(resourcesCount(backup, filterResources(backup, "pod"), "pod")).toBe("3 of 7 items, of 1 of 4 resources.");
    expect(resourcesCount(backup, filterResources(backup, "ledger"), "ledger")).toBe(
      "1 of 7 items, of 1 of 4 resources.",
    );
    expect(resourcesCount(restore, filterResources(restore, "", "created"), "", "created")).toBe(
      "3 of 8 items, of 3 of 3 resources.",
    );
    expect(resourcesCount(backup, filterResources(backup, "/"), "/")).toBe("7 of 7 items, of 4 of 4 resources.");
  });

  it("say what a filter asked for when it left nothing: the words, the action, or both", () => {
    const typed = "carries what was typed in its resource, its namespace or its name";

    expect(resourcesCount(backup, filterResources(backup, "no such"), "no such")).toBe(`Of 7 items, none ${typed}.`);
    expect(resourcesCount(restore, filterResources(restore, "billing", "created"), "billing", "created")).toBe(
      `Of 8 items, none was created and ${typed}.`,
    );
    expect(resourcesCount(restore, filterResources(restore, "ledger", "failed"), "ledger", "failed")).toBe(
      `Of 8 items, none failed and ${typed}.`,
    );
    // An action alone leaves nothing of a list that has no item of it.
    const created = parseResources('{"v1/Pod":["shop/cart(created)"]}', "Restore");

    if (!created) throw new Error("The list of the test is not read");
    const none = (action: "updated" | "failed" | "skipped" | "not stated") =>
      resourcesCount(created, filterResources(created, "", action), "", action);

    expect(none("updated")).toBe("Of 1 item, none was updated.");
    expect(none("failed")).toBe("Of 1 item, none failed.");
    expect(none("skipped")).toBe("Of 1 item, none was skipped.");
    expect(none("not stated")).toBe("Of 1 item, none is without a stated action.");
  });

  it("say that a list holds no item, whatever is asked of it", () => {
    for (const written of ["{}", '{"v1/Pod":[]}']) {
      const empty = parseResources(written, "Restore");

      if (!empty) throw new Error("The list of the test is not read");
      expect(resourcesCount(empty, empty, "")).toBe("The resource list holds no item.");
      expect(resourcesCount(empty, filterResources(empty, "pod", "failed"), "pod", "failed")).toBe(
        "The resource list holds no item.",
      );
    }
  });

  it("say how many items a resource has, and of how many when a filter is on", () => {
    expect(itemsCount(3)).toBe("3 items");
    expect(itemsCount(1)).toBe("1 item");
    expect(itemsCount(0)).toBe("No item");
    expect(itemsCount(2, 3)).toBe("2 of 3 items");
    expect(itemsCount(1, 1)).toBe("1 of 1 item");
  });

  it("name each choice of the filter by action with what it would leave, and of how many", () => {
    expect(actionChoice(undefined, 8)).toBe("All: 8");
    expect(RESTORE_ACTIONS.map((action) => actionChoice(action, restore.actions?.[action] ?? -1))).toEqual([
      "Created: 3",
      "Updated: 1",
      "Failed: 1",
      "Skipped: 1",
    ]);
    expect(actionChoice(NOT_STATED, 2)).toBe("Not stated: 2");
    expect(actionChoice(undefined, 7, 8)).toBe("All: 7 of 8");
    expect(actionChoice("skipped", 0, 1)).toBe("Skipped: 0 of 1");
    expect(actionChoice(NOT_STATED, 2, 2)).toBe("Not stated: 2 of 2");
  });

  it("say of a text of another shape that it is shown as the text it is, for a backup and for a restore", () => {
    expect(otherShape("Backup")).toBe(
      "The resource list of this backup is not of the shape the extension was written for, a map from each resource to the list of its items: it is shown as the text it is.",
    );
    expect(otherShape("Restore")).toContain("The resource list of this restore is not of the shape");
  });
});

// The resource lists the fixtures give the store for the two backups its sync creates, as the fixtures make
// them: the same lists for every run and every moment.
describe("the resource lists of the backups the store is given for the tabs", () => {
  const full = syntheticResourceList();
  const written = Object.entries(full.value);
  const list = parseResources(full.text, "Backup");

  if (!list) throw new Error("The resource list the fixtures give the store is not read");

  it("reads every resource of the first with its items, in the order of the code units, and no action", () => {
    const items = list.resources.flatMap((resource) => resource.items);

    expect(list.resources.map(({ resource, items }) => [resource, items.map((item) => item.text)])).toEqual(written);
    expect([list.resources.length, list.count]).toEqual([written.length, written.flatMap(([, names]) => names).length]);
    expect(list).not.toHaveProperty("actions");
    // An item is its namespace and its name, or its name alone for an item of the cluster, and the namespaces
    // of the items are the ones the list holds.
    expect(
      items.filter(
        (item) =>
          item.action !== undefined ||
          (item.namespace === undefined ? item.name : `${item.namespace}/${item.name}`) !== item.text,
      ),
    ).toEqual([]);
    expect([...new Set(items.flatMap((item) => item.namespace ?? []))].sort()).toEqual(
      [...full.value["v1/Namespace"]].sort(),
    );
    expect(
      list.resources
        .filter((resource) => resource.items.every((item) => !item.namespace))
        .map(({ resource }) => resource),
    ).toEqual(written.filter(([, names]) => names.every((name) => !name.includes("/"))).map(([resource]) => resource));
    expect(resourcesCount(list, list, "")).toBe(
      `${written.flatMap(([, names]) => names).length} items of ${written.length} resources.`,
    );
  });

  it("leaves of the first, for the words of a namespace or of a name in any capitals, what a plain search of it finds", () => {
    for (const words of ["synthetic-ns-9", "SYNTHETIC-CLUSTER-ROLE", "Synthetic:Cluster-Binding"]) {
      const found = written
        .map(([resource, names]): [string, string[]] => [
          resource,
          names.filter((name) => `${resource} ${name}`.toLowerCase().includes(words.toLowerCase())),
        ])
        .filter(([, names]) => names.length > 0);

      expect(found.length).toBeGreaterThan(0);
      expect([
        words,
        filterResources(list, words).resources.map(({ resource, items }) => [resource, items.map((item) => item.text)]),
      ]).toEqual([words, found]);
    }
  });

  it("reads the list of the second as a list of no item", () => {
    const empty = parseResources(syntheticResourceList("empty").text, "Backup");

    expect(empty).toEqual({ resources: [], count: 0 });
    expect(empty && resourcesCount(empty, empty, "")).toBe("The resource list holds no item.");
  });
});
