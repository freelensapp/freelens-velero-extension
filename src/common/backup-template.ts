// The template of a backup (SPEC-0016, the form; SPEC-0017, REQ-260 to REQ-262): the fields the creation of a backup
// (T4.3) and the creation of a schedule (T4.7) share, as the form gives them, what the reviewed release refuses of
// them, with its words, and the spec they write. A field that is not set is left out, never written empty; the
// fields of REQ-237 of SPEC-0016 have no place here. Both processes read the same functions: the form says what is
// wrong as it is typed, and the main process refuses it again before it builds a body.

import { goDurationNanoseconds, goDurationText } from "./go-duration";
import { dnsLabelProblems, dnsSubdomainProblems, type LabelSelector, readLabelSelector } from "./label-selector";

// The fields of the form, as the operator sets them: the lists as items, a selector as the text typed, a duration as
// the text typed. The booleans are set to true or to false, or not set.
export interface BackupTemplate {
  includedNamespaces?: string[];
  excludedNamespaces?: string[];
  includedResources?: string[];
  excludedResources?: string[];
  includeClusterResources?: boolean;
  labelSelector?: string;
  orLabelSelectors?: string[];
  storageLocation?: string;
  volumeSnapshotLocations?: string[];
  snapshotVolumes?: boolean;
  defaultVolumesToFsBackup?: boolean;
  snapshotMoveData?: boolean;
  ttl?: string;
  csiSnapshotTimeout?: string;
  itemOperationTimeout?: string;
}

export type TemplateField = keyof BackupTemplate;

// The fields that hold a list of names, a boolean, a duration.
export const LIST_FIELDS = [
  "includedNamespaces",
  "excludedNamespaces",
  "includedResources",
  "excludedResources",
  "volumeSnapshotLocations",
] as const;
export const BOOLEAN_FIELDS = [
  "includeClusterResources",
  "snapshotVolumes",
  "defaultVolumesToFsBackup",
  "snapshotMoveData",
] as const;
export const DURATION_FIELDS = ["ttl", "csiSnapshotTimeout", "itemOperationTimeout"] as const;

// The bounds the contract gives the fields, which the release does not have: the form says when a field goes beyond
// one, and the main process does not read a request beyond them. A template that needs more is asked from the command
// line.
export const TEMPLATE_BOUNDS = {
  // Items of a list, and the characters of an item: the name of an object of Kubernetes, or a pattern of one.
  items: 256,
  item: 253,
  // The selectors of `orLabelSelectors`, and the characters of a selector.
  selectors: 16,
  selector: 1024,
  // The characters of a duration as it is typed.
  duration: 64,
  // The characters of the whole template as the request carries it, within the bound of a request.
  total: 60_000,
} as const;

// The words of what the release refuses, as its backup controller writes them into a backup it makes
// FailedValidation, and of what the form refuses beside them.
export const TEMPLATE_WORDS = {
  namespaceLists: (problem: string) => `Invalid included/excluded namespace lists: ${problem}`,
  resourceLists: (problem: string) => `Invalid included/excluded resource lists: ${problem}`,
  bothSelectors: "encountered labelSelector as well as orLabelSelectors in backup spec, only one can be specified",
  selector: (problem: string) => `Kubernetes does not read this selector: ${problem}`,
  emptySelector: "A selector names one requirement at least: one that names none is not set.",
  storageLocation: (problem: string) => `The name of a storage location ${problem}`,
  noStorageLocation: "The storage location is chosen: the form always writes it.",
  snapshotLocation: (name: string, problem: string) => `The name of the snapshot location ${name} ${problem}`,
  tooMany: (bound: number, of: TemplateOf = "backup") =>
    `The form takes ${bound} at most here: ${of === "schedule" ? "a schedule that needs more is created" : "a backup that needs more is asked"} from the command line.`,
  tooLong: (bound: number, of: TemplateOf = "backup") =>
    `An item longer than ${bound} characters is not one the form takes: ${of === "schedule" ? "a schedule that needs it is created" : "a backup that needs it is asked"} from the command line.`,
  tooLarge: (characters: number, of: TemplateOf = "backup") =>
    `The fields of the form are written in ${characters} characters, more than the main process is asked with: ${of === "schedule" ? "a schedule this large is created" : "a backup this large is asked"} from the command line.`,
  duration: (text: string) =>
    `${text} is not a duration Go reads: a number with its unit, h, m, s, ms, us or ns, as 720h, 1h30m or 90s.`,
  notAboveZero: (text: string) => `${text} is not above zero: a duration of zero is the same as one that is not set.`,
};

// The rules of `wildcard.ValidateNamespaceName` of the release: what a pattern of a namespace may not hold.
function wildcardProblem(pattern: string): string | undefined {
  if (/[|()!{},]/.test(pattern)) return "wildcard pattern contains unsupported characters: |, (, ), !, {, }, ,";
  if (pattern.includes("**")) return "wildcard pattern contains consecutive asterisks (only single * allowed)";
  // The brackets of a class of characters, as `validateBracePatterns` reads them.
  for (let index = 0; index < pattern.length; index += 1) {
    if (pattern[index] === "[") {
      const start = index;
      let depth = 1;

      for (let next = index + 1; next < pattern.length && depth > 0; next += 1) {
        if (pattern[next] === "]") {
          depth -= 1;
          if (depth === 0) {
            if (pattern.slice(start + 1, next) === "") return "wildcard pattern contains empty bracket pattern '[]'";
            index = next;
            break;
          }
        }
      }
      if (depth > 0) return "wildcard pattern contains unclosed bracket '['";
    } else if (pattern[index] === "]") return "wildcard pattern contains unmatched closing bracket ']'";
  }
  return undefined;
}

// `validateNamespaceName` of the release: the pattern, then the name it is once its wildcards are replaced, which is a
// label of DNS.
function namespaceProblems(namespace: string): string[] {
  if (namespace === "") return [];
  const wildcard = wildcardProblem(namespace);

  if (wildcard) return [wildcard];
  return dnsLabelProblems(namespace.replace(/[*?[\]]/g, "x")).map(
    (problem) => `invalid namespace ${JSON.stringify(namespace)}: ${problem}`,
  );
}

// `ValidateIncludesExcludes` of the release: `*` alone or not at all among the included, never among the excluded,
// and no item in both lists. The restore of a backup checks its lists with it as well.
export function listProblems(included: string[], excluded: string[]): { included: string[]; excluded: string[] } {
  const includes = new Set(included);
  const excludes = new Set(excluded);
  const problems = { included: [] as string[], excluded: [] as string[] };

  if (includes.size > 1 && includes.has("*"))
    problems.included.push("includes list must either contain '*' only, or a non-empty list of items");
  if (excludes.has("*")) problems.excluded.push("excludes list cannot contain '*'");
  for (const item of [...excludes].sort()) {
    if (includes.has(item))
      problems.excluded.push(`excludes list cannot contain an item in the includes list: ${item}`);
  }
  return problems;
}

// A duration as the form writes it: the text Go prints for what the text typed reads, above zero.
export function durationOf(text: string): { written: string } | { problem: string } {
  const nanoseconds = goDurationNanoseconds(text);

  if (nanoseconds === undefined) return { problem: TEMPLATE_WORDS.duration(text) };
  if (nanoseconds <= 0n) return { problem: TEMPLATE_WORDS.notAboveZero(text) };
  return { written: goDurationText(nanoseconds) };
}

// The items of a list, each once, in the order they were given.
export function once(items: string[] | undefined): string[] {
  return [...new Set(items ?? [])];
}

export type TemplateProblems = Partial<Record<TemplateField, string[]>>;

// What the template is of: a backup of the form, or the backups of a schedule of the form, which the words of what the
// form does not take name.
export type TemplateOf = "backup" | "schedule";

// What the release refuses of a template, field by field, with its words, and what the form refuses beside it. The
// release takes no included namespace as every namespace, `*`, before it reads the lists. What depends on the cluster,
// a namespace labelled to be excluded and what the locations named are, is not here: the form reads what the host
// lists and what the installation read, and the main process reads the locations.
export function templateProblems(template: BackupTemplate, of: TemplateOf = "backup"): TemplateProblems {
  const problems: TemplateProblems = {};
  const add = (field: TemplateField, ...words: string[]) => {
    if (words.length > 0) problems[field] = [...(problems[field] ?? []), ...words];
  };
  const included = once(template.includedNamespaces);
  const excluded = once(template.excludedNamespaces);
  const namespaces = listProblems(included.length > 0 ? included : ["*"], excluded);

  add("includedNamespaces", ...namespaces.included.map(TEMPLATE_WORDS.namespaceLists));
  // The names are read as the release reads its sets: sorted.
  add(
    "includedNamespaces",
    ...[...included].sort().flatMap((namespace) => namespaceProblems(namespace).map(TEMPLATE_WORDS.namespaceLists)),
  );
  add("excludedNamespaces", ...namespaces.excluded.map(TEMPLATE_WORDS.namespaceLists));
  add(
    "excludedNamespaces",
    ...[...excluded].sort().flatMap((namespace) => namespaceProblems(namespace).map(TEMPLATE_WORDS.namespaceLists)),
  );
  const resources = listProblems(once(template.includedResources), once(template.excludedResources));

  add("includedResources", ...resources.included.map(TEMPLATE_WORDS.resourceLists));
  add("excludedResources", ...resources.excluded.map(TEMPLATE_WORDS.resourceLists));
  if (template.labelSelector !== undefined && template.orLabelSelectors !== undefined)
    add("orLabelSelectors", TEMPLATE_WORDS.bothSelectors);
  for (const [field, texts] of [
    ["labelSelector", template.labelSelector === undefined ? [] : [template.labelSelector]],
    ["orLabelSelectors", template.orLabelSelectors ?? []],
  ] as const) {
    for (const text of texts) {
      const read = readLabelSelector(text);

      if ("problem" in read) add(field, TEMPLATE_WORDS.selector(read.problem));
    }
  }
  if (template.orLabelSelectors?.length === 0) add("orLabelSelectors", TEMPLATE_WORDS.emptySelector);
  if (template.storageLocation === undefined) add("storageLocation", TEMPLATE_WORDS.noStorageLocation);
  else add("storageLocation", ...dnsSubdomainProblems(template.storageLocation).map(TEMPLATE_WORDS.storageLocation));
  // A location named twice is one location, as the release takes it.
  for (const location of once(template.volumeSnapshotLocations)) {
    add(
      "volumeSnapshotLocations",
      ...dnsSubdomainProblems(location).map((problem) => TEMPLATE_WORDS.snapshotLocation(location, problem)),
    );
  }
  for (const field of DURATION_FIELDS) {
    const text = template[field];

    if (text === undefined) continue;
    const read = durationOf(text);

    if ("problem" in read) add(field, read.problem);
    if (text.length > TEMPLATE_BOUNDS.duration) add(field, TEMPLATE_WORDS.tooLong(TEMPLATE_BOUNDS.duration, of));
  }
  // What the contract carries: a field beyond one of its bounds is said, and so is a template too large to be asked.
  for (const field of LIST_FIELDS) {
    const items = template[field] ?? [];

    if (items.length > TEMPLATE_BOUNDS.items) add(field, TEMPLATE_WORDS.tooMany(TEMPLATE_BOUNDS.items, of));
    if (items.some((item) => item.length > TEMPLATE_BOUNDS.item))
      add(field, TEMPLATE_WORDS.tooLong(TEMPLATE_BOUNDS.item, of));
  }
  if ((template.orLabelSelectors?.length ?? 0) > TEMPLATE_BOUNDS.selectors)
    add("orLabelSelectors", TEMPLATE_WORDS.tooMany(TEMPLATE_BOUNDS.selectors, of));
  for (const [field, texts] of [
    ["labelSelector", template.labelSelector === undefined ? [] : [template.labelSelector]],
    ["orLabelSelectors", template.orLabelSelectors ?? []],
  ] as const) {
    if (texts.some((text) => text.length > TEMPLATE_BOUNDS.selector))
      add(field, TEMPLATE_WORDS.tooLong(TEMPLATE_BOUNDS.selector, of));
  }
  const written = JSON.stringify(template).length;

  if (written > TEMPLATE_BOUNDS.total) {
    const largest = LIST_FIELDS.reduce((one, other) =>
      JSON.stringify(template[other] ?? []).length > JSON.stringify(template[one] ?? []).length ? other : one,
    );

    add(largest, TEMPLATE_WORDS.tooLarge(written, of));
  }
  return problems;
}

// The spec a template writes: only the fields that are set, a list with each item once, a selector as the API takes it,
// a duration as Go prints it; the text of the body orders its keys. Nothing when the template is refused.
export function templateSpec(template: BackupTemplate): Record<string, unknown> | undefined {
  if (Object.keys(templateProblems(template)).length > 0) return undefined;
  const selector = (text: string): LabelSelector => {
    const read = readLabelSelector(text);

    if ("problem" in read) throw new Error(read.problem);
    return read.selector;
  };
  const list = (items: string[] | undefined) => (items && items.length > 0 ? once(items) : undefined);
  const duration = (text: string | undefined) => {
    if (text === undefined) return undefined;
    const read = durationOf(text);

    return "written" in read ? read.written : undefined;
  };
  const spec: Record<string, unknown> = {
    includedNamespaces: list(template.includedNamespaces),
    excludedNamespaces: list(template.excludedNamespaces),
    includedResources: list(template.includedResources),
    excludedResources: list(template.excludedResources),
    labelSelector: template.labelSelector === undefined ? undefined : selector(template.labelSelector),
    orLabelSelectors: template.orLabelSelectors?.map(selector),
    snapshotVolumes: template.snapshotVolumes,
    ttl: duration(template.ttl),
    includeClusterResources: template.includeClusterResources,
    storageLocation: template.storageLocation,
    volumeSnapshotLocations: list(template.volumeSnapshotLocations),
    defaultVolumesToFsBackup: template.defaultVolumesToFsBackup,
    csiSnapshotTimeout: duration(template.csiSnapshotTimeout),
    itemOperationTimeout: duration(template.itemOperationTimeout),
    snapshotMoveData: template.snapshotMoveData,
  };

  return Object.fromEntries(Object.entries(spec).filter(([, value]) => value !== undefined));
}
