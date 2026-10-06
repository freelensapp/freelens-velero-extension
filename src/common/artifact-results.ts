// The results of an operation, as the release writes them: the errors and the warnings, each by where it
// happened, to Velero itself, to a resource of the cluster or in a namespace. A pure function on the text
// that was loaded: what is not of that shape is answered with nothing, and is shown as the text it is.
// After it, what the tab of the results says of them: their places in the order they are read, their
// counts, the messages that are shown of thousands, and the count of the file beside the one of the status.

import type { OperationKind } from "./phases";

export interface ResultMessage {
  // The message as it is written.
  text: string;
  // Its parts, when it is in the form the hook of the server writes for an entry of a log: only the ones
  // the entry had, the message always among them.
  parts?: { resource?: string; name?: string; message: string; error?: string };
}

export interface ResultGroup {
  velero: ResultMessage[];
  cluster: ResultMessage[];
  // The namespaces by their name.
  namespaces: { name: string; messages: ResultMessage[] }[];
  count: number;
}

export interface ParsedResults {
  errors: ResultGroup;
  warnings: ResultGroup;
  count: number;
}

// What the hook of the server writes for an entry: each part after a space, the value after a slash, in
// this order, the message always there and the others only when the entry has them. A part ends where
// the next begins; the error, which is last, is everything after it.
const RESOURCE = " resource: /";
const NAME = " name: /";
const MESSAGE = " message: /";
const ERROR = " error: /";

// A message in its parts, or as the text it is when it is not in the form of the hook. The text is read
// by where each part begins, once from its start to its end: the time it takes grows with its length,
// whatever a file that Velero did not write repeats in it. The resource, when the text begins with one,
// ends at the first name that has a message after it, or at the first message; a name begins the text, or
// follows the resource; the message ends at the first error.
function message(text: string): ResultMessage {
  const first = text.startsWith(RESOURCE) ? RESOURCE.length : 0;
  const said = text.indexOf(MESSAGE, first);

  if (said < 0) return { text };
  const named = first ? text.indexOf(NAME, first) : text.startsWith(NAME) ? 0 : -1;
  const name = named >= 0 && named < said;

  // Without a resource, and without a name, the message is what begins the text.
  if (!first && !name && said > 0) return { text };
  const words = said + MESSAGE.length;
  const failed = text.indexOf(ERROR, words);

  return {
    text,
    parts: {
      ...(first ? { resource: text.slice(first, name ? named : said) } : {}),
      ...(name ? { name: text.slice(named + NAME.length, said) } : {}),
      message: failed < 0 ? text.slice(words) : text.slice(words, failed),
      ...(failed < 0 ? {} : { error: text.slice(failed + ERROR.length) }),
    },
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// A list of texts, or nothing for what is not one. A list the release leaves out is an empty one.
function texts(value: unknown): ResultMessage[] | undefined {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) return undefined;
  return (value as string[]).map(message);
}

const PLACES = ["velero", "cluster", "namespaces"];

function group(value: unknown): ResultGroup | undefined {
  if (value === undefined) return { velero: [], cluster: [], namespaces: [], count: 0 };
  if (!isObject(value) || Object.keys(value).some((key) => !PLACES.includes(key))) return undefined;
  const velero = texts(value.velero);
  const cluster = texts(value.cluster);
  const written = value.namespaces ?? {};

  if (!velero || !cluster || !isObject(written)) return undefined;
  const namespaces: ResultGroup["namespaces"] = [];

  // The keys an object has of its own: a namespace may be named as anything.
  for (const name of Object.keys(written).sort()) {
    const messages = texts(written[name]);

    if (!messages || written[name] === undefined) return undefined;
    namespaces.push({ name, messages });
  }
  return {
    velero,
    cluster,
    namespaces,
    count: velero.length + cluster.length + namespaces.reduce((sum, place) => sum + place.messages.length, 0),
  };
}

const KINDS = ["errors", "warnings"];

// The results of an operation, or nothing for a text that is not of the shape the release writes: what is
// not JSON, what is not an object of the two keys, a key the release does not write, a list that is not of
// texts. Nothing of such a text would be shown in its place, so it is shown whole, as text.
export function parseResults(text: string): ParsedResults | undefined {
  let value: unknown;

  try {
    value = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (!isObject(value) || Object.keys(value).some((key) => !KINDS.includes(key))) return undefined;
  // A key that is written and holds nothing is not a group that was left out.
  if (KINDS.some((key) => key in (value as object) && !isObject((value as Record<string, unknown>)[key])))
    return undefined;
  const errors = group(value.errors);
  const warnings = group(value.warnings);

  if (!errors || !warnings) return undefined;
  return { errors, warnings, count: errors.count + warnings.count };
}

export type ResultKind = "errors" | "warnings";

// One place of the results that holds a message: Velero itself, the resources of the cluster, or a
// namespace, which alone has a name.
export interface ResultPlace {
  kind: ResultKind;
  where: "velero" | "cluster" | "namespace";
  namespace?: string;
  messages: ResultMessage[];
}

// The places of the results in the order they are read: the errors, then the warnings, each by Velero,
// the cluster and the namespaces by their name. A place that holds no message is no place of the results:
// the release leaves out a list that is empty.
export function resultPlaces(results: ParsedResults): ResultPlace[] {
  return (["errors", "warnings"] as const)
    .flatMap((kind): ResultPlace[] => [
      { kind, where: "velero", messages: results[kind].velero },
      { kind, where: "cluster", messages: results[kind].cluster },
      ...results[kind].namespaces.map(
        ({ name, messages }): ResultPlace => ({ kind, where: "namespace", namespace: name, messages }),
      ),
    ])
    .filter((place) => place.messages.length > 0);
}

const NOUNS: Record<ResultKind, string> = { errors: "error", warnings: "warning" };

// A count of errors or of warnings in words, none said as such.
function counted(count: number, kind: ResultKind): string {
  return count === 0 ? `no ${NOUNS[kind]}` : `${count} ${NOUNS[kind]}${count === 1 ? "" : "s"}`;
}

// What the results hold as a whole, and that Velero recorded neither when they hold nothing.
export function resultsSummary(results: ParsedResults, of: OperationKind): string {
  const each = `${counted(results.errors.count, "errors")} and ${counted(results.warnings.count, "warnings")}`;
  const operation = of.toLowerCase();

  if (results.count === 0) return `Velero recorded ${each} for this ${operation}.`;
  return `Velero recorded ${results.count} ${results.count === 1 ? "message" : "messages"} for this ${operation}: ${each}.`;
}

// The title of a group, with its count: a count is read in words, and not in a color.
export function groupTitle(kind: ResultKind, count: number): string {
  return `${kind === "errors" ? "Errors" : "Warnings"}: ${count === 0 ? "none" : count}`;
}

// How a place is named: in its title, and in a sentence.
function named(place: ResultPlace): { title: string; words: string } {
  if (place.where === "namespace")
    return { title: `Namespace ${place.namespace}`, words: `the namespace ${place.namespace}` };
  return place.where === "velero" ? { title: "Velero", words: "Velero" } : { title: "Cluster", words: "the cluster" };
}

// The title of a place, with its count.
export function placeTitle(place: ResultPlace): string {
  return `${named(place).title}: ${counted(place.messages.length, place.kind)}`;
}

const PARTS = [
  ["resource", "Resource"],
  ["name", "Name"],
  ["message", "Message"],
  ["error", "Error"],
] as const;

export interface ResultPart {
  key: (typeof PARTS)[number][0];
  name: string;
  value: string;
}

// The parts of a message the hook of the server wrote, each with its name, in the order the hook writes
// them. A message of another form has none: it is the text it is.
export function messageParts(message: ResultMessage): ResultPart[] | undefined {
  const { parts } = message;

  if (!parts) return undefined;
  return PARTS.flatMap(([key, name]) => (parts[key] === undefined ? [] : [{ key, name, value: parts[key] }]));
}

// What is said over results that are not of the shape of the release, which are shown as text.
export function otherShape(of: OperationKind): string {
  return `The results of this ${of.toLowerCase()} are not of the shape the extension was written for: they are shown as the text they are.`;
}

// How many messages are shown when the results arrive, and how many more each time it is asked: the
// results of an operation can hold thousands of messages, and they are not drawn whole to say what is
// first.
export const RESULTS_STEP = 200;

// How many messages of each place are shown at first: the first ones in the order of the page, up to the
// bound on the whole. A place after them shows none until it is asked.
export function shownAtFirst(places: ResultPlace[], bound = RESULTS_STEP): number[] {
  let left = bound;

  return places.map((place) => {
    const shown = Math.min(place.messages.length, left);

    left -= shown;
    return shown;
  });
}

// What is said under a place whose messages are not all shown.
export function shownText(place: ResultPlace, shown: number): string {
  return `${shown} of ${place.messages.length} shown.`;
}

// The command that shows the messages of a place after the ones that are shown, named with its place:
// one command is told from another by its name alone. Nothing when all are shown.
export function moreCommand(place: ResultPlace, shown: number): string | undefined {
  const more = Math.min(RESULTS_STEP, place.messages.length - shown);

  if (more <= 0) return undefined;
  return `Show ${more} more ${NOUNS[place.kind]}${more === 1 ? "" : "s"} of ${named(place).words}`;
}

// How many messages of the whole are shown, said while some are not.
export function shownOfAll(shown: number, results: ParsedResults): string | undefined {
  if (shown >= results.count) return undefined;
  return `${shown} of the ${results.count} messages are shown. The others are shown by the command of their place.`;
}

// Why the count of the file and the counter of the status can differ, as the source of the reviewed
// release has it, and in the one direction it explains each time. The status and the results of an
// operation are counted on the same messages when its work ends. After that the operations of its
// plugins add their errors to the status, of a backup and of a restore alike, and the release does not
// write them into the results: they explain a status that counts more errors, and nothing else. When a
// restore is finalized, what the finalization finds is added to its results first and to its status
// after: until the status is written, which is when the restore leaves its finalizing phase, the results
// can count more. The results of a backup are written once. Any other difference is said with no reason.
function grows(of: OperationKind): string {
  return `The operations of the plugins of a ${of.toLowerCase()} add their errors to its status after its results were written, and not to the results: the status can count more.`;
}
const FINALIZED =
  "When Velero finalizes a restore it adds what it finds to the results before it writes the status: the results can count more until the restore ends.";
const UNNAMED = "They differ for a reason the extension does not name.";
// The phases of a restore that is being finalized.
const FINALIZING: readonly unknown[] = ["Finalizing", "FinalizingPartiallyFailed"];

// What is said when the results count otherwise than the status of the object: both counts, and why they
// can differ, where the release explains it. The counters are the ones the status writes: nothing is said
// of a counter it does not write, nor of one that agrees. A reason is said once, after the counts it is
// of. The phase is the one the object reports with those counters.
export function countDifferences(
  results: ParsedResults,
  of: OperationKind,
  counters: { errors?: number; warnings?: number } = {},
  phase?: unknown,
): string[] {
  const said: { counts: string[]; reason: string }[] = [];
  const finalizing = of === "Restore" && FINALIZING.includes(phase);

  for (const kind of ["errors", "warnings"] as const) {
    const status = counters[kind];
    const file = results[kind].count;

    if (status === undefined || status === file) continue;
    const reason = kind === "errors" && status > file ? grows(of) : finalizing && file > status ? FINALIZED : UNNAMED;
    const counts = `The status of the ${of.toLowerCase()} reports ${counted(status, kind)}, and its results hold ${file || "none"}.`;
    const last = said[said.length - 1];

    if (last?.reason === reason) last.counts.push(counts);
    else said.push({ counts: [counts], reason });
  }
  return said.map(({ counts, reason }) => `${counts.join(" ")} ${reason}`);
}
