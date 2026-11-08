// The restore of a backup the form asks for (SPEC-0017, REQ-265 to REQ-273): a `velero.io/v1` Restore with its name and
// its namespace and no other metadata, no label and no annotation; a spec that names its backup and never a schedule,
// the policy for the resources that exist always written, the cluster-scoped resources as the operator chose them, and
// the other fields only when they are set. What the restore controller of the reviewed release refuses of the lists,
// with its words, and what the form refuses beside it: a mapping Velero would use for nothing, a target that is not a
// name of a namespace, a source or a target twice. The main process builds the body at the confirmation; the review
// shows the text it writes, and the run sends that text.

import { BACKUP_NAME_LIMIT, bodyText } from "./backup-from-schedule";
import { listProblems, once, TEMPLATE_BOUNDS } from "./backup-template";
import { dnsLabelProblems, type LabelSelector, readLabelSelector } from "./label-selector";

// The cluster-scoped resources, as the form offers them (D15): every one of the backup, written true; none, written
// false; or the ones the restored resources need, left out. The form writes nothing until one is chosen.
export const CLUSTER_RESOURCES = ["every", "none", "needed"] as const;
export type ClusterResources = (typeof CLUSTER_RESOURCES)[number];

// The policy for the resources that exist in the cluster: none unless chosen, always written (D8).
export const EXISTING_RESOURCE_POLICIES = ["none", "update"] as const;
export type ExistingResourcePolicy = (typeof EXISTING_RESOURCE_POLICIES)[number];

// The fields of the form, as the operator sets them: the lists as items, the mapping as pairs in the order they were
// given, a selector as the text typed.
export interface RestoreForm {
  includedNamespaces?: string[];
  excludedNamespaces?: string[];
  namespaceMapping?: [string, string][];
  includedResources?: string[];
  excludedResources?: string[];
  clusterResources?: ClusterResources;
  labelSelector?: string;
  orLabelSelectors?: string[];
  restorePVs?: boolean;
  existingResourcePolicy: ExistingResourcePolicy;
}

export type RestoreField = keyof RestoreForm;

// The namespaces the spec of a backup names, which a mapping is matched against.
export interface BackupNamespaces {
  includedNamespaces?: string[];
  excludedNamespaces?: string[];
}

// The resources the restore controller adds to the excluded ones of every restore, and refuses among the included ones
// (restore_controller.go L66-L95, L307-L322).
export const NON_RESTORABLE = [
  "nodes",
  "events",
  "events.events.k8s.io",
  "backups.velero.io",
  "restores.velero.io",
  "resticrepositories.velero.io",
  "csinodes.storage.k8s.io",
  "volumeattachments.storage.k8s.io",
  "backuprepositories.velero.io",
] as const;

// The pairs of a mapping the contract carries, and the characters of a name in it.
export const MAPPING_BOUND = 64;

export const RESTORE_WORDS = {
  // The words the restore controller of the release writes into a restore it makes FailedValidation.
  nonRestorable: (resource: string) => `${resource} are non-restorable resources`,
  namespaceLists: (problem: string) => `Invalid included/excluded namespace lists: ${problem}`,
  resourceLists: (problem: string) => `Invalid included/excluded resource lists: ${problem}`,
  bothSelectors: "encountered labelSelector as well as orLabelSelectors in restore spec, only one can be specified",
  // The words of the form.
  selector: (problem: string) => `Kubernetes does not read this selector: ${problem}`,
  emptySelector: "A selector names one requirement at least: one that names none is not set.",
  noClusterResources:
    "Choose the cluster-scoped resources: every one of the backup, none, or the ones the restored resources need.",
  noSource: "A mapping names no namespace of the backup.",
  noTarget: (source: string) => `The mapping of ${source} names no namespace to restore it into.`,
  target: (target: string) =>
    `The namespace ${target}, which a mapping restores into, is not a name a namespace can have: lower-case letters, digits and "-", beginning and ending with a letter or a digit, 63 characters at most.`,
  sourceTwice: (source: string) => `The namespace ${source} of the backup is mapped twice: a namespace is mapped once.`,
  targetTwice: (target: string) =>
    `The namespace ${target} is the target of two mappings: the form does not restore two namespaces of the backup into one.`,
  usedForNothing: (source: string) =>
    `The backup does not hold the namespace ${source}: its spec does not include it, or excludes it. Velero would use this mapping for nothing.`,
  leftOut: (source: string) =>
    `The restore leaves out the namespace ${source}: its included namespaces do not take it, or its excluded ones do. Velero would use this mapping for nothing.`,
  everyNamespace: (source: string) =>
    `The backup took every namespace: whether it holds ${source} is not known here, and Velero uses the mapping for nothing when it does not.`,
  tooMany: (bound: number) =>
    `The form takes ${bound} at most here: a restore that needs more is asked from the command line.`,
  tooLong: (bound: number) =>
    `An item longer than ${bound} characters is not one the form takes: a restore that needs it is asked from the command line.`,
};

export type RestoreProblems = Partial<Record<RestoreField, string[]>>;

// A part of a pattern, as the glob package of the release reads it (gobwas/glob v0.2.3): any characters, one, a range of
// characters, a list of them, or one character as it is.
type GlobPart =
  | { any: true }
  | { one: true }
  | { lo: string; hi: string; not: boolean }
  | { list: string[]; not: boolean }
  | { text: string };

// A pattern read as the lexer and the parser of the glob package read it, with no separator: `*` any characters, `**`
// as well, `?` one, `[lo-hi]` one range or `[chars]` one list, each after a `!` that turns it, and `\` that takes the
// next character as it is. Nothing for a pattern the package does not compile, and for terms in braces, which the
// wildcard package of the release refuses in a pattern of a namespace (wildcard/expand.go L67-L86).
export function readGlob(pattern: string): GlobPart[] | undefined {
  const characters = Array.from(pattern);
  const parts: GlobPart[] = [];
  let index = 0;

  while (index < characters.length) {
    const character = characters[index];

    if (character === "*") {
      if (!("any" in (parts[parts.length - 1] ?? {}))) parts.push({ any: true });
      index += 1;
    } else if (character === "?") {
      parts.push({ one: true });
      index += 1;
    } else if (character === "{") return undefined;
    else if (character === "[") {
      index += 1;
      const not = characters[index] === "!";

      if (not) index += 1;
      if (index >= characters.length) return undefined;
      if (characters[index + 1] === "-") {
        const lo = characters[index];
        const hi = characters[index + 2];

        if (hi === undefined || characters[index + 3] !== "]" || hi < lo) return undefined;
        parts.push({ lo, hi, not });
        index += 4;
      } else {
        const list: string[] = [];

        while (index < characters.length && characters[index] !== "]") {
          if (characters[index] === "\\") index += 1;
          if (index < characters.length) list.push(characters[index]);
          index += 1;
        }
        if (index >= characters.length || list.length === 0) return undefined;
        parts.push({ list, not });
        index += 1;
      }
    } else {
      if (character === "\\") index += 1;
      if (index < characters.length) parts.push({ text: characters[index] });
      index += 1;
    }
  }
  return parts;
}

function matchesOne(part: GlobPart, character: string): boolean {
  if ("one" in part) return true;
  if ("text" in part) return part.text === character;
  if ("list" in part) return part.list.includes(character) !== part.not;
  if ("lo" in part) return (character >= part.lo && character <= part.hi) !== part.not;
  return false;
}

// Whether a name is matched by the parts of a pattern: each part one character, the parts of any characters taken back
// as little as they need, in a time bounded by the product of the two lengths whatever the pattern.
function globMatches(parts: GlobPart[], name: string): boolean {
  const characters = Array.from(name);
  let part = 0;
  let at = 0;
  let star = -1;
  let from = 0;

  while (at < characters.length) {
    if (part < parts.length && !("any" in parts[part]) && matchesOne(parts[part], characters[at])) {
      part += 1;
      at += 1;
    } else if (part < parts.length && "any" in parts[part]) {
      star = part;
      from = at;
      part += 1;
    } else if (star >= 0) {
      part = star + 1;
      from += 1;
      at = from;
    } else return false;
  }
  while (part < parts.length && "any" in parts[part]) part += 1;
  return part === parts.length;
}

// Whether a list of patterns matches a name, as the release matches it (collections/includes_excludes.go L47-L59): the
// patterns in their order, each once, and a pattern it does not compile ends the match with none.
function listMatches(patterns: readonly string[], name: string): boolean {
  for (const pattern of [...new Set(patterns)].sort()) {
    const parts = readGlob(pattern);

    if (!parts) return false;
    if (globMatches(parts, name)) return true;
  }
  return false;
}

// Whether a backup takes every namespace: none included, or `*`.
export function everyNamespace(backup: BackupNamespaces): boolean {
  const included = backup.includedNamespaces ?? [];

  return included.length === 0 || included.includes("*");
}

// Whether the lists of the restore take a namespace, as the restore matches them (restore.go L237-L239, L2579-L2582):
// not excluded, and included by a name or a pattern, `*` among them, or by no included namespace.
export function restoreTakes(form: RestoreForm, namespace: string): boolean {
  const included = form.includedNamespaces ?? [];

  if (listMatches(form.excludedNamespaces ?? [], namespace)) return false;
  return included.length === 0 || listMatches(included, namespace);
}

// Whether a namespace of the backup is among the ones it holds, as its spec says: included by a name or a pattern, and
// not excluded. Nothing is known of a backup that took every namespace.
export function backupHolds(backup: BackupNamespaces, namespace: string): boolean | undefined {
  if (listMatches(backup.excludedNamespaces ?? [], namespace)) return false;
  if (everyNamespace(backup)) return undefined;
  return listMatches(backup.includedNamespaces ?? [], namespace);
}

// What the restore controller refuses of a form, field by field, with its words, and what the form refuses beside it;
// the warnings of a mapping a backup of every namespace may hold are apart. The lists are checked as the controller
// checks them, the included namespaces not defaulted to every one.
export function restoreProblems(
  form: RestoreForm,
  backup: BackupNamespaces,
): { problems: RestoreProblems; warnings: string[] } {
  const problems: RestoreProblems = {};
  const warnings: string[] = [];
  const add = (field: RestoreField, ...words: string[]) => {
    if (words.length > 0) problems[field] = [...(problems[field] ?? []), ...words];
  };
  const namespaces = listProblems(once(form.includedNamespaces), once(form.excludedNamespaces));

  add("includedNamespaces", ...namespaces.included.map(RESTORE_WORDS.namespaceLists));
  add("excludedNamespaces", ...namespaces.excluded.map(RESTORE_WORDS.namespaceLists));
  const included = once(form.includedResources);
  const excluded = once(form.excludedResources);

  add(
    "includedResources",
    ...NON_RESTORABLE.filter((resource) => included.includes(resource)).map(RESTORE_WORDS.nonRestorable),
  );
  const resources = listProblems(included, excluded);

  add("includedResources", ...resources.included.map(RESTORE_WORDS.resourceLists));
  add("excludedResources", ...resources.excluded.map(RESTORE_WORDS.resourceLists));
  // The controller adds the resources it never restores to the excluded ones before it checks the lists: one of them
  // included, and not excluded by the operator, is in both lists as well (restore_controller.go L307-L322).
  add(
    "includedResources",
    ...NON_RESTORABLE.filter((resource) => included.includes(resource) && !excluded.includes(resource))
      .sort()
      .map((resource) =>
        RESTORE_WORDS.resourceLists(`excludes list cannot contain an item in the includes list: ${resource}`),
      ),
  );
  if (form.labelSelector !== undefined && form.orLabelSelectors !== undefined)
    add("orLabelSelectors", RESTORE_WORDS.bothSelectors);
  for (const [field, texts] of [
    ["labelSelector", form.labelSelector === undefined ? [] : [form.labelSelector]],
    ["orLabelSelectors", form.orLabelSelectors ?? []],
  ] as const) {
    for (const text of texts) {
      const read = readLabelSelector(text);

      if ("problem" in read) add(field, RESTORE_WORDS.selector(read.problem));
      if (text.length > TEMPLATE_BOUNDS.selector) add(field, RESTORE_WORDS.tooLong(TEMPLATE_BOUNDS.selector));
    }
  }
  if (form.orLabelSelectors?.length === 0) add("orLabelSelectors", RESTORE_WORDS.emptySelector);
  if ((form.orLabelSelectors?.length ?? 0) > TEMPLATE_BOUNDS.selectors)
    add("orLabelSelectors", RESTORE_WORDS.tooMany(TEMPLATE_BOUNDS.selectors));
  if (form.clusterResources === undefined) add("clusterResources", RESTORE_WORDS.noClusterResources);
  // The mapping: each target a name of a namespace, no source and no target twice, and no source Velero would use for
  // nothing.
  const pairs = form.namespaceMapping ?? [];
  const sources = new Set<string>();
  const targets = new Set<string>();

  for (const [source, target] of pairs) {
    // A pair with a side not typed says what it lacks; a target typed is a name of a namespace.
    if (source === "") add("namespaceMapping", RESTORE_WORDS.noSource);
    else if (target === "") add("namespaceMapping", RESTORE_WORDS.noTarget(source));
    if (target !== "" && dnsLabelProblems(target).length > 0) add("namespaceMapping", RESTORE_WORDS.target(target));
    if (source !== "" && sources.has(source)) add("namespaceMapping", RESTORE_WORDS.sourceTwice(source));
    if (target !== "" && targets.has(target)) add("namespaceMapping", RESTORE_WORDS.targetTwice(target));
    sources.add(source);
    targets.add(target);
    if (source === "") continue;
    // A name no namespace can have is in no backup; a namespace the lists of the restore leave out is not restored.
    const holds = dnsLabelProblems(source).length > 0 ? false : backupHolds(backup, source);

    if (holds === false) add("namespaceMapping", RESTORE_WORDS.usedForNothing(source));
    else if (!restoreTakes(form, source)) add("namespaceMapping", RESTORE_WORDS.leftOut(source));
    else if (holds === undefined) warnings.push(RESTORE_WORDS.everyNamespace(source));
  }
  if (pairs.length > MAPPING_BOUND) add("namespaceMapping", RESTORE_WORDS.tooMany(MAPPING_BOUND));
  for (const field of ["includedNamespaces", "excludedNamespaces", "includedResources", "excludedResources"] as const) {
    const items = form[field] ?? [];

    if (items.length > TEMPLATE_BOUNDS.items) add(field, RESTORE_WORDS.tooMany(TEMPLATE_BOUNDS.items));
    if (items.some((item) => item.length > TEMPLATE_BOUNDS.item))
      add(field, RESTORE_WORDS.tooLong(TEMPLATE_BOUNDS.item));
  }
  return { problems, warnings };
}

// The keys of the spec of a restore of the form: the backup, and the fields the form offers (REQ-273).
export const RESTORE_SPEC_KEYS = [
  "backupName",
  "includedNamespaces",
  "excludedNamespaces",
  "includedResources",
  "excludedResources",
  "namespaceMapping",
  "labelSelector",
  "orLabelSelectors",
  "restorePVs",
  "includeClusterResources",
  "existingResourcePolicy",
] as const;

export interface RestoreFromForm {
  apiVersion: "velero.io/v1";
  kind: "Restore";
  metadata: { name: string; namespace: string };
  spec: Record<string, unknown> & { backupName: string; existingResourcePolicy: ExistingResourcePolicy };
}

// The name the command line proposes for a restore of a backup: `<backup>-<yyyymmddhhmmss>`, the time of the machine in
// UTC (D14).
export function proposedRestoreName(backup: string, now: number): string {
  return `${backup}-${new Date(now).toISOString().slice(0, 19).replace(/[-:T]/g, "")}`;
}

// The restore of the form, or nothing when its name or its form is refused. The name follows the rules of the name of
// a backup, 216 characters at most, for the requests of the artifacts of the restore (SPEC-0010).
export function restoreFromForm(
  namespace: string,
  name: string,
  backupName: string,
  form: RestoreForm,
  backup: BackupNamespaces,
): RestoreFromForm | undefined {
  if (restoreNameProblem(name) !== undefined || backupName === "") return undefined;
  if (Object.keys(restoreProblems(form, backup).problems).length > 0) return undefined;
  const selector = (text: string): LabelSelector => {
    const read = readLabelSelector(text);

    if ("problem" in read) throw new Error(read.problem);
    return read.selector;
  };
  const list = (items: string[] | undefined) => (items && items.length > 0 ? once(items) : undefined);
  const mapping = form.namespaceMapping?.length ? Object.fromEntries(form.namespaceMapping) : undefined;
  const spec: Record<string, unknown> = {
    backupName,
    includedNamespaces: list(form.includedNamespaces),
    excludedNamespaces: list(form.excludedNamespaces),
    includedResources: list(form.includedResources),
    excludedResources: list(form.excludedResources),
    namespaceMapping: mapping,
    labelSelector: form.labelSelector === undefined ? undefined : selector(form.labelSelector),
    orLabelSelectors: form.orLabelSelectors?.map(selector),
    restorePVs: form.restorePVs,
    includeClusterResources:
      form.clusterResources === "every" ? true : form.clusterResources === "none" ? false : undefined,
    existingResourcePolicy: form.existingResourcePolicy,
  };

  return {
    apiVersion: "velero.io/v1",
    kind: "Restore",
    metadata: { name, namespace },
    spec: Object.fromEntries(
      Object.entries(spec).filter(([, value]) => value !== undefined),
    ) as RestoreFromForm["spec"],
  };
}

const SUBDOMAIN = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?(\.[a-z0-9]([-a-z0-9]*[a-z0-9])?)*$/;

export const RESTORE_NAME_WORDS = {
  rule: `A name of lower-case letters, digits, "-" and ".", beginning and ending with a letter or a digit, with no "." next to another "." or to a "-", of ${BACKUP_NAME_LIMIT} characters at most, so that the request of each of its artifacts keeps to the 253 characters of a name.`,
  empty: "The restore needs a name.",
  long: (length: number) =>
    `The name has ${length} characters, ${length - BACKUP_NAME_LIMIT} more than ${BACKUP_NAME_LIMIT}.`,
  form: "The name is not one the API server takes.",
};

// What is wrong with a name of a restore, in words, or nothing when the API server takes it.
export function restoreNameProblem(name: string): string | undefined {
  if (name === "") return RESTORE_NAME_WORDS.empty;
  if (name.length > BACKUP_NAME_LIMIT) return RESTORE_NAME_WORDS.long(name.length);
  return SUBDOMAIN.test(name) ? undefined : RESTORE_NAME_WORDS.form;
}

// The text of the restore of the form, as it is sent: the one writer of every text of the extension.
export function restoreBodyText(body: RestoreFromForm): string {
  return bodyText(body);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// The body a text writes, read back. Nothing when the text is not the body of a Restore of a backup.
export function readRestoreBody(text: string): RestoreFromForm | undefined {
  try {
    const body = JSON.parse(text) as RestoreFromForm;

    return isRecord(body) &&
      body.kind === "Restore" &&
      isRecord(body.metadata) &&
      isRecord(body.spec) &&
      typeof body.spec.backupName === "string" &&
      !("scheduleName" in body.spec)
      ? body
      : undefined;
  } catch {
    return undefined;
  }
}
