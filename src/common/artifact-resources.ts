// The resource list of an operation, as the release writes it: a map from a resource, written as its API
// version and its kind, to its items, each a name with its namespace before it when it has one, and for
// a restore the action of the restore after it. A pure function on the text that was loaded: what is not
// of that shape is answered with nothing, and is shown as the text it is.

// The actions the reviewed release writes after an item of a restore.
export const RESTORE_ACTIONS = ["created", "updated", "failed", "skipped"] as const;
export type RestoreAction = (typeof RESTORE_ACTIONS)[number];
// What an item without one of them is counted as.
export const NOT_STATED = "not stated";
export type ActionCount = RestoreAction | typeof NOT_STATED;

export interface ResourceItem {
  // The item as it is written.
  text: string;
  // The namespace of an item that has one: an item of the cluster has none.
  namespace?: string;
  name: string;
  action?: RestoreAction;
}

export interface ResourceKind {
  resource: string;
  items: ResourceItem[];
}

export interface ParsedResources {
  resources: ResourceKind[];
  count: number;
  // Of a restore: how many items of each action, and how many with none the release writes.
  actions?: Record<ActionCount, number>;
}

// The action of a restore is what the last parentheses of an item hold.
const ACTION = /^(.*)\(([^()]*)\)$/s;

function item(text: string, restored: boolean): ResourceItem {
  const acted = restored ? ACTION.exec(text) : null;
  const action =
    acted && (RESTORE_ACTIONS as readonly string[]).includes(acted[2]) ? (acted[2] as RestoreAction) : undefined;
  // An action the release does not write is left where it is, in the text of the item.
  const named = action ? (acted as RegExpExecArray)[1] : text;
  const slash = named.indexOf("/");

  return {
    text,
    ...(slash < 0 ? { name: named } : { namespace: named.slice(0, slash), name: named.slice(slash + 1) }),
    ...(action ? { action } : {}),
  };
}

function counted(resources: ResourceKind[], restored: boolean): ParsedResources {
  const count = resources.reduce((sum, resource) => sum + resource.items.length, 0);

  if (!restored) return { resources, count };
  const actions = Object.fromEntries([...RESTORE_ACTIONS, NOT_STATED].map((action) => [action, 0])) as Record<
    ActionCount,
    number
  >;

  for (const resource of resources) for (const entry of resource.items) actions[entry.action ?? NOT_STATED] += 1;
  return { resources, count, actions };
}

// The resource list of a backup or of a restore, or nothing for a text that is not of the shape the
// release writes: what is not JSON, what is not a map, a resource whose items are not a list of texts.
export function parseResources(text: string, of: "Backup" | "Restore"): ParsedResources | undefined {
  let value: unknown;

  try {
    value = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const written = value as Record<string, unknown>;
  const resources: ResourceKind[] = [];

  for (const resource of Object.keys(written).sort()) {
    const items = written[resource];

    if (!Array.isArray(items) || items.some((entry) => typeof entry !== "string")) return undefined;
    resources.push({ resource, items: (items as string[]).map((entry) => item(entry, of === "Restore")).sort(byText) });
  }
  return counted(resources, of === "Restore");
}

function byText(one: ResourceItem, other: ResourceItem): number {
  return one.text < other.text ? -1 : one.text > other.text ? 1 : 0;
}

// The items a filter leaves: the ones whose resource, namespace or name carries each of the words that
// were typed, whatever their capitals, and, of a restore, the ones of the action that was chosen. The
// resources that are left with no item go, and the counts are the ones of what is left.
export function filterResources(list: ParsedResources, words: string, action?: ActionCount): ParsedResources {
  const asked = words.toLowerCase().split(/\s+/).filter(Boolean);

  if (!asked.length && !action) return list;
  const resources: ResourceKind[] = [];

  for (const resource of list.resources) {
    const kind = resource.resource.toLowerCase();
    const items = resource.items.filter(
      (entry) =>
        (!action || (entry.action ?? NOT_STATED) === action) &&
        asked.every(
          (word) =>
            kind.includes(word) ||
            entry.name.toLowerCase().includes(word) ||
            (entry.namespace ?? "").toLowerCase().includes(word),
        ),
    );

    if (items.length) resources.push({ resource: resource.resource, items });
  }
  return counted(resources, list.actions !== undefined);
}

// So many of a thing, in words: one of it in the singular.
function some(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

// What a filter by action asks of an item, in the words that follow "none".
const ASKED: Record<ActionCount, string> = {
  created: "was created",
  updated: "was updated",
  failed: "failed",
  skipped: "was skipped",
  [NOT_STATED]: "is without a stated action",
};

// What is said over a resource list: how many items it holds and of how many resources; with a filter on,
// how many it left and of how many; and, when it left nothing, what it asked for. A list that holds no
// item says so, whatever is asked of it.
export function resourcesCount(
  all: ParsedResources,
  left: ParsedResources,
  words: string,
  action?: ActionCount,
): string {
  const typed = /\S/.test(words);

  if (!all.count) return "The resource list holds no item.";
  if (!typed && !action) return `${some(all.count, "item")} of ${some(all.resources.length, "resource")}.`;
  if (left.count)
    return `${left.count} of ${some(all.count, "item")}, of ${left.resources.length} of ${some(all.resources.length, "resource")}.`;
  return `Of ${some(all.count, "item")}, none ${[
    action ? ASKED[action] : "",
    typed ? "carries what was typed in its resource, its namespace or its name" : "",
  ]
    .filter(Boolean)
    .join(" and ")}.`;
}

// How many items a resource has, and of how many when a filter is on.
export function itemsCount(left: number, all?: number): string {
  if (all !== undefined) return `${left} of ${some(all, "item")}`;
  return left ? some(left, "item") : "No item";
}

// The name of a choice of the filter by action, every action or one of them, with how many items it would
// leave, and of how many when the words that were typed left some of them.
export function actionChoice(action: ActionCount | undefined, left: number, all?: number): string {
  const name = action ? `${action[0].toUpperCase()}${action.slice(1)}` : "All";

  return `${name}: ${all === undefined ? left : `${left} of ${all}`}`;
}

// What is said over a text that is not of the shape of the release, which is shown as the text it is.
export function otherShape(of: "Backup" | "Restore"): string {
  return `The resource list of this ${of.toLowerCase()} is not of the shape the extension was written for, a map from each resource to the list of its items: it is shown as the text it is.`;
}
