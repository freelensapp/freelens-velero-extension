// The artifacts the tabs of a backup read, made for the test environment: the log, the results, the list
// of the resources and the volumes of a backup the store is given, each as the reviewed release writes it,
// and the empty forms of a second backup. Every function is of its arguments alone: no clock, no randomness
// and nothing of the machine, every order is the order of the code units, and what a suite expects of the
// log is counted here while the log is written.
//
// Nothing of the runner is imported: the tests of the parsers read what is written here.
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";

// The backup of the store began this long before the run started, and worked for this long: its times are
// outside every window of the views, however old the environment is.
export const SYNCED_AGE = 400 * 24 * 3_600_000;
export const SYNCED_WORK = 50 * 60_000;

// How many lines the log has, and how far apart two of them are: together they are the work of the backup.
const LINES = 200_000;
const LINE_STEP = SYNCED_WORK / LINES;
// A page of the text of an artifact, as the main process gives it to the views.
const PAGE = 4 * 1024 ** 2;
// What the numbers of the log are drawn from. Another seed is another log, with other digests.
const SEED = 20_260_930;

export const LOG_LEVELS = ["error", "warning", "info", "debug", "other"] as const;
type LogLevel = (typeof LOG_LEVELS)[number];

// What every entry of the log carries, in the order the text format writes it: the head of the line, then
// the fields in the order of their keys.
export const ENTRY_KEYS = ["time", "level", "msg", "backup", "logSource"] as const;

function required(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

// An instant as the release writes it: to the second, in UTC.
const instant = (at: number) => `${new Date(at).toISOString().slice(0, 19)}Z`;

// Numbers that look drawn and are the same at every call: a generator of 32 bits, seeded by a constant.
function drawn(seed: number): (below: number) => number {
  let state = seed >>> 0;

  return (below) => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = Math.imul(state ^ (state >>> 15), state | 1);

    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) % below;
  };
}

// The words of a message: two thousand and forty-eight, each made of two parts. With no vocabulary the log
// does not compress far enough under the bound of a download; none of them is a word a suite searches for.
const HEADS = [
  ["item", "block", "queue", "batch", "chunk", "shard", "index", "cache"],
  ["frame", "trace", "probe", "relay", "route", "stage", "phase", "group"],
  ["entry", "field", "label", "scope", "range", "bound", "limit", "quota"],
  ["token", "lease", "watch", "event", "state", "layer", "store", "table"],
  ["claim", "mount", "path", "node", "zone", "pool", "disk", "file"],
  ["page", "part", "list", "tree", "edge", "link", "port", "peer"],
  ["host", "task", "step", "plan", "rule", "hook", "pipe", "sink"],
  ["seed", "hash", "sum", "tag", "key", "ref", "map", "set"],
].flat();
const TAILS = [
  ["sync", "scan", "load", "save", "read", "copy", "move", "push"],
  ["pull", "lock", "mark", "wait", "skip", "drop", "keep", "send"],
  ["open", "seal", "pack", "walk", "fill", "trim", "sort", "join"],
  ["split", "merge", "check", "match", "count", "apply", "retry", "flush"],
].flat();
const WORDS = HEADS.flatMap((head) => TAILS.map((tail) => head + tail));
// What a message begins with: one of 64 sayings of four words, as the entries of a server say the same
// things of other items. The words of its own come after.
const SAYINGS = Array.from({ length: 64 }, (_, saying) =>
  [0, 1, 2, 3].map((word) => WORDS[(saying * 389 + word * 911 + 17) % WORDS.length]).join(" "),
);

// Characters of two and of three bytes, all of the basic plane: one unit of the text everywhere, and no
// change of length when a search folds their case. They are in the lines with no level alone, which are
// free text: how the text format quotes one inside a message was not read in the release.
const WIDE = ["5\u00b5s", "90\u00b0", "\u00b12", "\u03bb", "\u2192", "\u2026", "\u20ac", "\u2260"];

// Where the entries say they were written from: four lines of each of these files.
const SOURCES = [
  ["actions", "archive", "backup", "collector", "discovery", "finalizer", "hooks", "item_backup"],
  ["item_block", "item_collector", "labels", "namespaces", "operations", "plan", "policies", "progress"],
  ["queue", "requests", "resources", "results", "selectors", "snapshots", "status", "store"],
  ["tarball", "tracker", "uploader", "versions", "volume_worker", "volumes", "worker", "writer"],
].flat();
const SITES = SOURCES.flatMap((file, index) =>
  Array.from({ length: 4 }, (_, line) => `pkg/synthetic/${file}.go:${20 + ((index * 97 + line * 181) % 1480)}`),
);
// The one a suite searches for.
const SEARCHED_SOURCE = "pkg/synthetic/volume_worker.go";
const siteOf = (file: string) => SITES[SOURCES.indexOf(file) * 4];

// How many namespaces the backup holds, and what it holds in each: a resource as its API version and its
// kind, the word its items are named with, and how many of them a namespace has, 240 in all.
const NAMESPACES = 24;
const NAMESPACED: [resource: string, word: string, count: number][] = [
  ["v1/Pod", "pod", 40],
  ["v1/ConfigMap", "config", 24],
  ["v1/Secret", "secret", 24],
  ["v1/Service", "service", 12],
  ["v1/Endpoints", "endpoints", 12],
  ["v1/ServiceAccount", "account", 6],
  ["v1/PersistentVolumeClaim", "claim", 6],
  ["v1/Event", "event", 21],
  ["v1/LimitRange", "limits", 1],
  ["v1/ResourceQuota", "quota", 1],
  ["v1/PodTemplate", "template", 2],
  ["v1/ReplicationController", "controller", 1],
  ["apps/v1/Deployment", "deployment", 10],
  ["apps/v1/ReplicaSet", "replicaset", 20],
  ["apps/v1/StatefulSet", "statefulset", 3],
  ["apps/v1/DaemonSet", "daemonset", 1],
  ["apps/v1/ControllerRevision", "revision", 6],
  ["batch/v1/Job", "job", 8],
  ["batch/v1/CronJob", "cronjob", 2],
  ["networking.k8s.io/v1/Ingress", "ingress", 2],
  ["networking.k8s.io/v1/NetworkPolicy", "policy", 3],
  ["rbac.authorization.k8s.io/v1/Role", "role", 4],
  ["rbac.authorization.k8s.io/v1/RoleBinding", "binding", 4],
  ["policy/v1/PodDisruptionBudget", "budget", 2],
  ["autoscaling/v2/HorizontalPodAutoscaler", "autoscaler", 2],
  ["discovery.k8s.io/v1/EndpointSlice", "slice", 12],
  ["coordination.k8s.io/v1/Lease", "lease", 2],
  ["gateway.networking.k8s.io/v1/Gateway", "gateway", 1],
  ["gateway.networking.k8s.io/v1/HTTPRoute", "route", 1],
  ["storage.k8s.io/v1/CSIStorageCapacity", "capacity", 1],
  ["fixtures.synthetic.example/v1/WidgetSet", "widgetset", 2],
  ["fixtures.synthetic.example/v1/Widgetry", "widgetry", 2],
  ["fixtures.synthetic.example/v1alpha1/Gadget", "gadget", 2],
];
// What it holds of the cluster-scoped resources beside the namespaces themselves, the definitions of the
// synthetic kinds and the content of its one snapshot: 211 items, which with those are 239.
const CLUSTER: [resource: string, word: string, count: number][] = [
  ["v1/PersistentVolume", "volume", 144],
  ["rbac.authorization.k8s.io/v1/ClusterRole", "cluster-role", 26],
  ["rbac.authorization.k8s.io/v1/ClusterRoleBinding", "cluster-binding", 26],
  ["storage.k8s.io/v1/StorageClass", "class", 3],
  ["scheduling.k8s.io/v1/PriorityClass", "priority", 3],
  ["networking.k8s.io/v1/IngressClass", "ingress-class", 2],
  ["admissionregistration.k8s.io/v1/ValidatingWebhookConfiguration", "validating", 2],
  ["admissionregistration.k8s.io/v1/MutatingWebhookConfiguration", "mutating", 2],
  ["snapshot.storage.k8s.io/v1/VolumeSnapshotClass", "snapshot-class", 1],
  ["node.k8s.io/v1/RuntimeClass", "runtime", 1],
  ["gateway.networking.k8s.io/v1/GatewayClass", "gateway-class", 1],
];
const DEFINITIONS = ["gadgets", "widgetries", "widgetsets"].map((plural) => `${plural}.fixtures.synthetic.example`);
// The snapshot the backup took of its one CSI volume, in the namespace of the claim of that volume, and the
// content of that snapshot. The release never collects the snapshots of a CSI driver and their contents: a
// list of the resources holds the ones the backup took itself, which are the ones of the volume information
// and the ones the status counts.
const SNAPSHOT = { namespace: "synthetic-ns-9", name: "synthetic-snapshot-1", content: "synthetic-content-9" };

// The items the entries of the log name: a resource as the release writes it in a field, the word its items
// are named with, and how many of them a namespace has in the list of the resources.
const LOGGED: [resource: string, word: string, count: number][] = [
  ["pods", "pod", 40],
  ["configmaps", "config", 24],
  ["secrets", "secret", 24],
  ["services", "service", 12],
  ["serviceaccounts", "account", 6],
  ["persistentvolumeclaims", "claim", 6],
  ["deployments.apps", "deployment", 10],
  ["replicasets.apps", "replicaset", 20],
  ["statefulsets.apps", "statefulset", 3],
  ["jobs.batch", "job", 8],
  ["cronjobs.batch", "cronjob", 2],
  ["endpointslices.discovery.k8s.io", "slice", 12],
];

// The name of an item. The names of the objects of the access rules take capitals and colons: a third of
// them has the first, a third the second, so that a list sorted by code unit is not one sorted by a
// language, in which a capital goes beside its small letter.
function itemName(resource: string, word: string, number: number): string {
  if (!resource.startsWith("rbac.") || number % 3 === 2) return `synthetic-${word}-${number}`;
  return number % 3 === 0
    ? `Synthetic-${word[0].toUpperCase()}${word.slice(1)}-${number}`
    : `synthetic:${word}:${number}`;
}

// The list of the resources: every resource with its items, `namespace/name` or `name`, the resources and
// the items of each in the order of the code units, which for these names is the order of the bytes the
// release sorts by.
function listed(): Record<string, string[]> {
  const namespaces = Array.from({ length: NAMESPACES }, (_, index) => `synthetic-ns-${index + 1}`);
  const numbered = (resource: string, word: string, count: number) =>
    Array.from({ length: count }, (_, index) => itemName(resource, word, index + 1));
  const list: Record<string, string[]> = {
    "v1/Namespace": namespaces,
    "apiextensions.k8s.io/v1/CustomResourceDefinition": DEFINITIONS,
    "snapshot.storage.k8s.io/v1/VolumeSnapshot": [`${SNAPSHOT.namespace}/${SNAPSHOT.name}`],
    "snapshot.storage.k8s.io/v1/VolumeSnapshotContent": [SNAPSHOT.content],
  };

  for (const [resource, word, count] of CLUSTER) list[resource] = numbered(resource, word, count);
  for (const [resource, word, count] of NAMESPACED) {
    list[resource] = namespaces.flatMap((namespace) =>
      numbered(resource, word, count).map((name) => `${namespace}/${name}`),
    );
  }
  return Object.fromEntries(
    Object.keys(list)
      .sort()
      .map((resource) => [resource, [...list[resource]].sort()]),
  );
}

// The entries of the log at error and at warning, which are the messages of the results: where each is in
// the log, as a share of its lines or, below zero, as so many lines before its end, and the fields the hook
// of the server reads of it. An entry with no namespace field is of Velero, one with an empty one is of the
// cluster.
//
// Two of the errors are the ones the release writes, with the fields it gives them. It says that an item was
// not backed up with the logger of the backup, which carries the name of the item and its error and no
// namespace: the hook files it under Velero. That one is the hard one: the text of its error carries a colon
// before a slash and the word of a mark, and none of the four marks. And it says that a pod volume failed in
// a message alone, once the items are done: the volumes have one that failed. The other entries say that
// they are synthetic: no logger of the release gives their messages, and each is filed by the namespace
// field it carries. No entry says that a hook failed: the status of the backup counts the hooks, and none.
interface Reported {
  at: number;
  level: "error" | "warning";
  source: string;
  namespace?: string;
  resource?: string;
  name?: string;
  message: string;
  error?: string;
  // Where the release says the error was made, which it adds to an entry whose error carries its trace.
  traced?: [file: string, where: string];
}
const REPORTED: Reported[] = [
  {
    at: 0.02,
    level: "warning",
    source: "uploader",
    message: "Synthetic warning: the configuration of the uploader was read with its defaults",
    error: "synthetic configuration not found",
  },
  {
    at: 0.12,
    level: "warning",
    source: "volumes",
    namespace: "",
    resource: "persistentvolumes",
    name: "synthetic-volume-41",
    message: "Synthetic warning: no snapshot was taken of the volume",
  },
  {
    at: 0.34,
    level: "error",
    source: "item_backup",
    namespace: "synthetic-ns-3",
    resource: "pods",
    name: "synthetic-pod-12",
    message: "Synthetic error: the pod was not written into the backup",
    error: "synthetic failure: the read of the pod did not end in time",
    traced: ["/synthetic/src/internal/reader.go:118", "synthetic.(*itemReader).read"],
  },
  {
    at: 0.61,
    level: "error",
    source: "backup",
    name: "synthetic-pod-27",
    message: "Error backing up item",
    error:
      'synthetic failure of a plugin: rpc error: code = Unknown desc = open "synthetic-file-7": /synthetic/path: permission denied',
    traced: ["/synthetic/src/internal/plugin.go:214", "synthetic.(*pluginWorker).run"],
  },
  {
    at: 0.83,
    level: "error",
    source: "item_collector",
    namespace: "synthetic-ns-17",
    message: "Synthetic error: the items of the namespace were not listed in time",
  },
  {
    at: -12,
    level: "error",
    source: "uploader",
    message: "pod volume backup failed: synthetic failure: the files of the volume were not read",
  },
];

// The message the hook of the server makes of an entry: each part after a space, and only the parts the
// entry has, the message always.
function hooked(entry: Reported): string {
  return [
    entry.resource === undefined ? "" : ` resource: /${entry.resource}`,
    entry.name === undefined ? "" : ` name: /${entry.name}`,
    ` message: /${entry.message}`,
    entry.error === undefined ? "" : ` error: /${entry.error}`,
  ].join("");
}

// Where the release files an entry.
const placeOf = (entry: Reported) =>
  entry.namespace === undefined ? "velero" : entry.namespace === "" ? "cluster" : "namespace";

// A value as the text format writes it: as it is when it has only letters, digits and the marks below, and
// in quotes otherwise, its quotes and its backslashes escaped, as the documents of the release show both.
// An empty value is written as nothing, as the log of a backup of the release writes its progress. The last
// three of the marks do not matter here: no value of this log holds one of them.
function written(value: string): string {
  return /^[\w\-./@^+]*$/.test(value) ? value : `"${value.replace(/[\\"]/g, "\\$&")}"`;
}

// An entry as the text format writes it: its time, its level and its message, then its fields in the order
// of their keys.
function entryText(time: string, level: string, message: string, fields: Record<string, string>): string {
  return [
    `time="${time}"`,
    `level=${level}`,
    `msg=${written(message)}`,
    ...Object.keys(fields)
      .sort()
      .map((key) => `${key}=${written(fields[key])}`),
  ].join(" ");
}

// The fields of an entry of the text format, in the order they are written, each with its value without its
// quotes and without the backslash before a quote or a backslash inside them. It is for the keys of an
// entry, and for the values of the entries written here, which hold no other escape: the one of a new line
// or of a tab, which a value of a log of the server may hold, is not undone. It reads an entry: a line of
// free text has no fields to give.
export function entryFields(line: string): [key: string, value: string][] {
  const fields: [string, string][] = [];

  for (let at = 0; at < line.length; ) {
    const equals = line.indexOf("=", at);

    if (equals < 0) break;
    let end = equals + 1;
    let value = "";

    if (line[end] === '"') {
      for (end += 1; end < line.length && line[end] !== '"'; end += 1) {
        if (line[end] === "\\") end += 1;
        value += line[end] ?? "";
      }
      end += 1;
    } else {
      end = line.indexOf(" ", end);
      if (end < 0) end = line.length;
      value = line.slice(equals + 1, end);
    }
    fields.push([line.slice(at, equals), value]);
    at = end + 1;
  }
  return fields;
}

// The level of a line of the text format: the word after `level=` where an entry begins, after its time
// when it has one. A line that does not begin so has no level, whatever its words say, and a level the
// tabs have no name for is counted with those.
function levelOf(line: string): LogLevel {
  let at = 0;

  if (line.startsWith('time="')) {
    const closed = line.indexOf('" ', 6);

    if (closed < 0) return "other";
    at = closed + 2;
  }
  if (!line.startsWith("level=", at)) return "other";
  const end = line.indexOf(" ", at);
  const word = line.slice(at + 6, end < 0 ? undefined : end);

  return word === "error" || word === "warning" || word === "info" || word === "debug" ? word : "other";
}

// What a plain count finds in the text of a log: its lines, its bytes, its characters, its digest, the
// lines of each level, and for each text that is asked for the lines that hold it and how many times they
// do, whatever the case of its letters. A text is counted again where the one counted before it ended, as
// a search that goes on after a match: no text the tabs are checked with overlaps itself. It is what the
// runner counts in the logs the server wrote.
export function logFacts(text: string, searches: string[] = []) {
  const lines = text.split("\n");
  const levels = { error: 0, warning: 0, info: 0, debug: 0, other: 0 };
  const found = searches.map((search) => ({ text: search, lines: 0, occurrences: 0 }));
  const wanted = searches.map((search) => search.toLowerCase());

  // A newline ends a line: what follows the last one is a line only when there is something of it.
  if (lines.at(-1) === "") lines.pop();
  for (const line of lines) {
    const folded = wanted.length > 0 ? line.toLowerCase() : "";

    levels[levelOf(line)] += 1;
    wanted.forEach((search, index) => {
      let times = 0;

      if (search === "") return;
      for (let at = folded.indexOf(search); at >= 0; at = folded.indexOf(search, at + search.length)) times += 1;
      found[index].occurrences += times;
      if (times > 0) found[index].lines += 1;
    });
  }
  return {
    lines: lines.length,
    bytes: Buffer.byteLength(text),
    characters: text.length,
    sha256: sha256(text),
    levels,
    found,
  };
}

// The texts a suite searches the log for, of every shape a search meets: in no line, in one line far down,
// in a few tens, in hundreds, in thousands, in most of the lines, and one that the log holds in the three
// cases of its letters. Each is in a line once at most, so that its matches and its lines are one number.
// Four are for the case of the content, two warm the measures and ten are measured. The one with no text
// here is the field of the backup, which every entry carries.
const SEARCHES = [
  ["error", "content", "level=error"],
  ["checkpoint", "content", "CHECKPOINT WRITTEN"],
  ["absent", "content", "no line of the log holds this text"],
  ["total", "content", "Backed up a total of"],
  ["warning", "warm", "level=warning"],
  ["throttled", "warm", "throttled"],
  ["info", "measured", "level=info"],
  ["debug", "measured", "level=debug"],
  ["target", "measured", ""],
  ["source", "measured", SEARCHED_SOURCE],
  ["backoff", "measured", "backoff budget"],
  ["pods", "measured", "resource=pods"],
  ["quiesced", "measured", "quiesced"],
  ["released", "measured", "SNAPSHOT HANDLE RELEASED"],
  ["nowhere", "measured", "a text that is nowhere in the log"],
  ["drained", "measured", "work queue drained"],
] as const;
type Search = (typeof SEARCHES)[number][0];

// The words a search finds in a share of the entries: they go after the message of the entry whose place
// in the log leaves this remainder when it is divided by this period, in the next of their forms each time.
const MARKS: { search: Search; every: number; at: number; forms: string[] }[] = [
  { search: "throttled", every: 47, at: 5, forms: ["throttled"] },
  { search: "backoff", every: 131, at: 17, forms: ["backoff budget"] },
  { search: "released", every: 389, at: 77, forms: ["snapshot handle released"] },
  {
    search: "checkpoint",
    every: 613,
    at: 101,
    forms: ["checkpoint written", "Checkpoint Written", "CHECKPOINT WRITTEN"],
  },
  { search: "quiesced", every: 5407, at: 1234, forms: ["quiesced"] },
];

// How a line with no level begins: free text, which is not an entry. The release writes a log through its
// logger and through nothing else, so a log it wrote has no such line: these are here for the lines the tabs
// count apart, with no level, and say what they are.
const FREE = "synthetic line that is not an entry of the log: ";

interface Line {
  text: string;
  level: LogLevel;
  // The search texts the words and the fields of the line hold, each once.
  found: Search[];
  // Its characters of two and of three bytes.
  two: number;
  three: number;
  // What the facts keep of the line, by its number.
  note?: (line: number) => void;
}

function freeLine(text: string, found: Search[] = [], note?: Line["note"]): Line {
  let two = 0;
  let three = 0;

  for (let at = 0; at < text.length; at += 1) {
    const unit = text.charCodeAt(at);

    if (unit >= 0x800) three += 1;
    else if (unit >= 0x80) two += 1;
  }
  return { text, level: "other", found, two, three, note };
}

// A line of free text of exactly this many characters, some of them of more than one byte.
function longLine(characters: number): string {
  let text = `${FREE}one line of ${characters} characters: `;

  for (let word = 0; text.length < characters; word += 1) {
    text += `${word % 7 === 3 ? WIDE[word % WIDE.length] : WORDS[(word * 37) % WORDS.length]} `;
  }
  return `${text.slice(0, characters - 1)}.`;
}

// The log of the backup, in the text format of the server: one entry a line with its time, its level, its
// message and its fields, the lines 15 milliseconds apart from the start of the backup, and a newline after
// the last. Its facts are counted while it is written:
//
// - the entries at error and at warning are the messages of the results, and no other line has those
//   levels; about one line in four hundred has no level;
// - some entries at info name another level in their message, and some lines with no level name one in
//   their words: a level is read where an entry begins, and nowhere else;
// - one line has twenty thousand characters, one ten thousand and the next ten thousand and one, and about
//   one entry in two hundred has a long message;
// - the first page of the text ends inside a character of three bytes.
//
// The brief form has short messages and no field of an item: more lines within the bound of an artifact.
export function syntheticLog(options: {
  backup: string;
  namespace: string;
  started: number;
  lines?: number;
  brief?: boolean;
}) {
  const { backup, namespace, started, lines = LINES, brief = false } = options;
  const named = /^[a-z0-9][a-z0-9.-]*$/;

  required(named.test(backup) && named.test(namespace), "A synthetic log needs the names of a backup and a namespace");
  required(Number.isFinite(started), "The time the fixtures were started is required");
  required(Number.isInteger(lines) && lines >= 1000, "A synthetic log has a thousand lines at least");
  const draw = drawn(SEED);
  const origin = started - SYNCED_AGE;
  const items = Object.values(listed()).reduce((total, list) => total + list.length, 0);
  const words = (count: number) => Array.from({ length: count }, () => WORDS[draw(WORDS.length)]).join(" ");
  const entry = (
    time: string,
    level: Exclude<LogLevel, "other">,
    message: string,
    site: string,
    fields: Record<string, string> = {},
    found: Search[] = [],
    note?: Line["note"],
  ): Line => ({
    text: entryText(time, level, message, { ...fields, backup: `${namespace}/${backup}`, logSource: site }),
    level,
    found,
    two: 0,
    three: 0,
    note,
  });

  const facts = {
    levels: { error: 0, warning: 0, info: 0, debug: 0, other: 0 },
    entries: [] as {
      line: number;
      level: "error" | "warning";
      place: "velero" | "cluster" | "namespace";
      namespace?: string;
      resource?: string;
      name?: string;
      message: string;
      error?: string;
      text: string;
    }[],
    long: { twentyThousand: 0, tenThousand: 0, tenThousandAndOne: 0 },
    levelInMessage: { lines: 0, line: 0 },
    levelInFreeText: { lines: 0, line: 0 },
    twoByteCharacters: 0,
    threeByteCharacters: 0,
    boundaryLine: 0,
  };
  const matches = Object.fromEntries(SEARCHES.map(([search]) => [search, 0])) as Record<Search, number>;

  // The lines that are placed, each at the first line that is free from its place on.
  const placed: { at: number; line: (time: string) => Line }[] = [];
  const place = (at: number, line: (time: string) => Line) => placed.push({ at: Math.floor(at), line });

  for (const reported of REPORTED) {
    const { at, level, source, message, error, traced, ...item } = reported;

    place(at < 0 ? lines + at : lines * at, (time) =>
      entry(
        time,
        level,
        message,
        siteOf(source),
        {
          ...item,
          ...(error === undefined ? {} : { error }),
          ...(traced ? { "error.file": traced[0], "error.function": traced[1] } : {}),
        },
        item.resource === "pods" ? ["pods"] : [],
        (line) =>
          facts.entries.push({
            line,
            level,
            place: placeOf(reported),
            ...item,
            message,
            ...(error === undefined ? {} : { error }),
            text: hooked(reported),
          }),
      ),
    );
  }
  // Forty entries at info whose message names the level of an error.
  for (let trap = 0; trap < 40; trap += 1) {
    place((lines * (2 * trap + 1)) / 80 + 7, (time) =>
      entry(
        time,
        "info",
        `synthetic plugin wrote level=error in its own output ${words(2)}`,
        siteOf("actions"),
        {},
        ["error"],
        (line) => {
          facts.levelInMessage.lines += 1;
          facts.levelInMessage.line ||= line;
        },
      ),
    );
  }
  // Twenty-four lines with no level whose words name one: an error and a warning in turn.
  for (let trap = 0; trap < 24; trap += 1) {
    const level = trap % 2 === 0 ? "error" : "warning";

    place((lines * (2 * trap + 1)) / 48 + 11, () =>
      freeLine(`${FREE}level=${level} ${words(3)}`, [level], (line) => {
        facts.levelInFreeText.lines += 1;
        facts.levelInFreeText.line ||= line;
      }),
    );
  }
  place(lines * 0.45, () =>
    freeLine(longLine(20_000), [], (line) => {
      facts.long.twentyThousand = line;
    }),
  );
  place(lines * 0.7, () =>
    freeLine(longLine(10_000), [], (line) => {
      facts.long.tenThousand = line;
    }),
  );
  place(lines * 0.7 + 1, () =>
    freeLine(longLine(10_001), [], (line) => {
      facts.long.tenThousandAndOne = line;
    }),
  );
  place(lines * 0.97, (time) =>
    entry(time, "info", `work queue drained ${words(2)}`, siteOf("queue"), {}, ["drained"]),
  );
  // What the release says once, when the items are done: as many as the list of the resources has, with the
  // progress of the backup, a field with nothing in it.
  place(lines - 10, (time) =>
    entry(time, "info", `Backed up a total of ${items} items`, siteOf("backup"), { progress: "" }, ["total"]),
  );
  placed.sort((one, other) => one.at - other.at);

  const drawnLine = (index: number, time: string): Line => {
    const roll = draw(2000);

    if (roll < 5) {
      const count = 3 + draw(6);

      return freeLine(
        FREE +
          Array.from({ length: count }, () =>
            draw(4) === 0 ? WIDE[draw(WIDE.length)] : WORDS[draw(WORDS.length)],
          ).join(" "),
      );
    }
    const found: Search[] = [];
    const fields: Record<string, string> = {};
    let message = brief
      ? words(2)
      : `${SAYINGS[draw(SAYINGS.length)]} ${words(draw(200) === 0 ? 40 + draw(121) : 1 + draw(5))}`;

    for (const mark of MARKS) {
      if (index % mark.every !== mark.at) continue;
      message += ` ${mark.forms[Math.floor(index / mark.every) % mark.forms.length]}`;
      found.push(mark.search);
    }
    const site = SITES[draw(SITES.length)];

    if (site.startsWith(SEARCHED_SOURCE)) found.push("source");
    if (!brief && draw(100) < 45) {
      const [resource, word, count] = LOGGED[draw(LOGGED.length)];

      fields.name = `synthetic-${word}-${1 + draw(count)}`;
      fields.namespace = `synthetic-ns-${1 + draw(NAMESPACES)}`;
      fields.resource = resource;
      if (resource === "pods") found.push("pods");
      // The release says at info that it processes an item with the progress of the backup, a field it
      // writes with nothing in it, and says other things of an item without it.
      if (roll >= 305 && index % 2 === 0) fields.progress = "";
    }
    return entry(time, roll < 305 ? "debug" : "info", message, site, fields, found);
  };
  // The line the first page of the text ends inside: a character of three bytes that begins one byte before
  // the page ends.
  const across = (room: number): Line =>
    freeLine(
      `${FREE.repeat(Math.ceil(room / FREE.length)).slice(0, room - 1)}\u2192 is a character of three bytes, across the end of the first page`,
      [],
      (line) => {
        facts.boundaryLine = line;
      },
    );
  const size = (line: Line) => line.text.length + line.two + 2 * line.three + 1;

  const text: string[] = [];
  let bytes = 0;
  let characters = 0;
  let next = 0;
  let second = Number.NaN;
  let time = "";

  for (let index = 0; index < lines; index += 1) {
    const now = origin + index * LINE_STEP;

    if (Math.floor(now / 1000) !== second) {
      second = Math.floor(now / 1000);
      time = instant(now);
    }
    let due = next < placed.length && placed[next].at <= index;
    let line = due ? placed[next].line(time) : drawnLine(index, time);

    // The line that would reach the end of the first page gives its place to the one the page ends inside.
    // A line that is placed waits for the next place.
    if (bytes < PAGE && bytes + size(line) >= PAGE) {
      if (due) line = drawnLine(index, time);
      due = false;
      if (bytes + size(line) >= PAGE) line = across(PAGE - bytes);
    }
    if (due) next += 1;
    text.push(line.text);
    bytes += size(line);
    characters += line.text.length + 1;
    facts.levels[line.level] += 1;
    facts.twoByteCharacters += line.two;
    facts.threeByteCharacters += line.three;
    if (line.level !== "other") {
      matches[line.level] += 1;
      matches.target += 1;
    }
    for (const search of line.found) matches[search] += 1;
    line.note?.(index + 1);
  }
  const whole = `${text.join("\n")}\n`;

  return {
    text: whole,
    facts: {
      lines,
      bytes,
      characters,
      sha256: sha256(whole),
      // The pages the bytes fill. The main process ends a page a byte or two earlier where it would end
      // inside a character, which moves the pages after it and does not add one to these logs.
      pages: Math.ceil(bytes / PAGE),
      ...facts,
      searches: SEARCHES.map(([search, use, wanted]) => ({
        text: search === "target" ? `backup=${namespace}/${backup}` : wanted,
        matches: matches[search],
        use,
      })),
    },
  };
}

// The results of a backup as the release keeps them: the entries of its log at error and at warning, each
// as the message the hook of the server makes of it, by Velero, by the cluster and by namespace.
interface Result {
  velero?: string[];
  cluster?: string[];
  namespaces?: Record<string, string[]>;
}

// A JSON artifact: its value, and its text as the release encodes it, one value and a newline. The texts
// hold no character the encoder of the release writes otherwise than this one does.
function encoded<Value>(value: Value): { value: Value; text: string } {
  return { value, text: `${JSON.stringify(value)}\n` };
}

// The results of the backup: four errors, two of Velero and two of two namespaces, a warning of Velero and a
// warning of the cluster. The release writes the two keys in their order, and the lists of each in the order
// of its type: of Velero, of the cluster, of the namespaces by name. The empty form is the one of a backup
// with neither: both keys are always there, and a list is left out when it is empty.
export function syntheticResults(form: "full" | "empty" = "full") {
  const result = (level: Reported["level"]): Result => {
    const entries = form === "full" ? REPORTED.filter((entry) => entry.level === level) : [];
    const of = (place: ReturnType<typeof placeOf>) => entries.filter((entry) => placeOf(entry) === place);
    const namespaces = [...new Set(of("namespace").map((entry) => entry.namespace as string))].sort();

    return {
      ...(of("velero").length > 0 ? { velero: of("velero").map(hooked) } : {}),
      ...(of("cluster").length > 0 ? { cluster: of("cluster").map(hooked) } : {}),
      ...(namespaces.length > 0
        ? {
            namespaces: Object.fromEntries(
              namespaces.map((namespace) => [
                namespace,
                of("namespace")
                  .filter((entry) => entry.namespace === namespace)
                  .map(hooked),
              ]),
            ),
          }
        : {}),
    };
  };

  return encoded({ errors: result("error"), warnings: result("warning") });
}

// The list of the resources of the backup: 48 resources and 6,000 items in 24 namespaces and in the
// cluster. The empty form is the one of a backup of no item.
export function syntheticResourceList(form: "full" | "empty" = "full") {
  return encoded(form === "full" ? listed() : {});
}

// An entry of the volume information of a backup, with the keys the release writes and in its order.
// Whether the data was moved, whether the local snapshot was kept and whether the volume was skipped are in
// every entry; `ReadyToUse` and `Phase` are written under the names of their fields.
interface Volume {
  pvcName: string;
  pvcNamespace: string;
  pvName: string;
  backupMethod?: "NativeSnapshot" | "PodVolumeBackup" | "CSISnapshot";
  snapshotDataMoved: boolean;
  preserveLocalSnapshot: boolean;
  skipped: boolean;
  skippedReason?: string;
  startTimestamp?: string;
  completionTimestamp?: string;
  result?: "succeeded" | "failed";
  csiSnapshotInfo?: {
    snapshotHandle: string;
    size: number;
    driver: string;
    vscName: string;
    operationID: string;
    ReadyToUse: boolean;
  };
  nativeSnapshotInfo?: { snapshotHandle: string; volumeType: string; volumeAZ: string; iops: string; Phase: string };
  pvbInfo?: {
    snapshotHandle?: string;
    size: number;
    incrementalSize?: number;
    uploaderType: string;
    volumeName: string;
    podName: string;
    podNamespace: string;
    nodeName: string;
    Phase: string;
  };
  pvInfo: { reclaimPolicy: string; labels: Record<string, string> | null };
}

// The volumes of the backup, one of each case, in the order the release lists them: a volume it skipped,
// with its reason and no method; a native snapshot, which has no size and no times; a CSI snapshot kept
// locally, as it is once the backup is finalized, with the end and the result its operation gave it; a pod
// volume that was backed up and one that failed, the second with no snapshot. A volume with no label has
// none where the others have theirs. The empty form is the one of a backup with no volume.
//
// The end of the CSI snapshot is the moment its operation was found complete, and the release asks the
// operations when the items are done: it is the end of the backup here, after the last line of the log. A
// pod volume ends while the items are backed up.
export function syntheticVolumeInfo(started: number, form: "full" | "empty" = "full") {
  required(Number.isFinite(started), "The time the fixtures were started is required");
  const after = (minutes: number) => instant(started - SYNCED_AGE + minutes * 60_000);
  const labels = { "fixtures.synthetic.example/tier": "synthetic" };
  const volumes: Volume[] = [
    {
      pvcName: "synthetic-claim-4",
      pvcNamespace: "synthetic-ns-5",
      pvName: "synthetic-volume-41",
      snapshotDataMoved: false,
      preserveLocalSnapshot: false,
      skipped: true,
      skippedReason: "volumeSnapshot: no applicable volumesnapshotter found;",
      pvInfo: { reclaimPolicy: "Retain", labels },
    },
    {
      pvcName: "synthetic-claim-1",
      pvcNamespace: "synthetic-ns-3",
      pvName: "synthetic-volume-7",
      backupMethod: "NativeSnapshot",
      snapshotDataMoved: false,
      preserveLocalSnapshot: false,
      skipped: false,
      result: "succeeded",
      nativeSnapshotInfo: {
        snapshotHandle: "synthetic-native-snapshot-7",
        volumeType: "synthetic-type",
        volumeAZ: "synthetic-zone-a",
        iops: "3000",
        Phase: "Completed",
      },
      pvInfo: { reclaimPolicy: "Delete", labels: null },
    },
    {
      pvcName: "synthetic-claim-2",
      pvcNamespace: SNAPSHOT.namespace,
      pvName: "synthetic-volume-58",
      backupMethod: "CSISnapshot",
      snapshotDataMoved: false,
      preserveLocalSnapshot: true,
      skipped: false,
      startTimestamp: after(20),
      completionTimestamp: after(SYNCED_WORK / 60_000),
      result: "succeeded",
      csiSnapshotInfo: {
        snapshotHandle: "synthetic-csi-snapshot-58",
        size: 10 * 1024 ** 3,
        driver: "csi.fixtures.synthetic.example",
        vscName: SNAPSHOT.content,
        operationID: `${SNAPSHOT.namespace}/${SNAPSHOT.name}/${after(20)}`,
        ReadyToUse: true,
      },
      pvInfo: { reclaimPolicy: "Delete", labels },
    },
    {
      pvcName: "synthetic-claim-3",
      pvcNamespace: "synthetic-ns-17",
      pvName: "synthetic-volume-90",
      backupMethod: "PodVolumeBackup",
      snapshotDataMoved: false,
      preserveLocalSnapshot: false,
      skipped: false,
      startTimestamp: after(5),
      completionTimestamp: after(12),
      result: "succeeded",
      pvbInfo: {
        snapshotHandle: "synthetic-pod-volume-snapshot-90",
        size: 5 * 1024 ** 3,
        incrementalSize: 1024 ** 3,
        uploaderType: "kopia",
        volumeName: "data",
        podName: "synthetic-pod-22",
        podNamespace: "synthetic-ns-17",
        nodeName: "synthetic-node-2",
        Phase: "Completed",
      },
      pvInfo: { reclaimPolicy: "Delete", labels },
    },
    {
      pvcName: "synthetic-claim-5",
      pvcNamespace: "synthetic-ns-3",
      pvName: "synthetic-volume-91",
      backupMethod: "PodVolumeBackup",
      snapshotDataMoved: false,
      preserveLocalSnapshot: false,
      skipped: false,
      startTimestamp: after(13),
      completionTimestamp: after(14),
      result: "failed",
      pvbInfo: {
        size: 2 * 1024 ** 3,
        uploaderType: "kopia",
        volumeName: "data",
        podName: "synthetic-pod-31",
        podNamespace: "synthetic-ns-3",
        nodeName: "synthetic-node-1",
        Phase: "Failed",
      },
      pvInfo: { reclaimPolicy: "Delete", labels },
    },
  ];

  return encoded(form === "full" ? volumes : []);
}

// Bytes as the store keeps an artifact. What gzip writes of the same bytes is not the same on every
// machine: an artifact is compared by its text, never by what is stored of it. How far it packs is left to
// the library: nothing rests on it but the bound of a download, which the log is far from.
export function gz(content: string | Uint8Array): Buffer {
  return gzipSync(content);
}

// The contents the store is given for a backup: an empty tar, which is two blocks of zeros, in gzip. It is
// not what the release writes for a backup of no item, whose contents hold the version of their format: it
// is what the deletion of a backup accepts. The deletion reads the contents before it removes anything,
// takes an archive with no directory of resources as a backup of no item, and does not end on what it
// cannot read.
export function emptyArchive(): Buffer {
  return gz(Buffer.alloc(1024));
}

// Everything the tabs read of the two backups the store is given: the four artifacts of the first, and the
// three of the second, which has no log, with what they were made for: the backup, its namespace and the
// moment the fixtures were started, which the times of the log and of the volumes are counted from.
export function tabArtifacts(options: { backup: string; namespace: string; started: number }) {
  return {
    backup: options.backup,
    namespace: options.namespace,
    started: options.started,
    log: syntheticLog(options),
    results: syntheticResults(),
    resourceList: syntheticResourceList(),
    volumeInfo: syntheticVolumeInfo(options.started),
    empty: {
      results: syntheticResults("empty"),
      resourceList: syntheticResourceList("empty"),
      volumeInfo: syntheticVolumeInfo(options.started, "empty"),
    },
  };
}

// What the suites are told of the artifacts, as plain data: the facts of the log, what the three others
// hold and their values, the size and the digest of each text, and one digest of them all, by which a
// placement is known to be the one of these functions.
export function tabExpectations(artifacts: ReturnType<typeof tabArtifacts>) {
  const { backup, namespace, started, log, results, resourceList, volumeInfo, empty } = artifacts;
  const of = (text: string) => ({ bytes: Buffer.byteLength(text), sha256: sha256(text) });
  const count = (result: Result) =>
    [result.velero ?? [], result.cluster ?? [], ...Object.values(result.namespaces ?? {})].reduce(
      (total, messages) => total + messages.length,
      0,
    );
  const texts = {
    log: { sha256: log.facts.sha256 },
    results: of(results.text),
    resourceList: of(resourceList.text),
    volumeInfo: of(volumeInfo.text),
    emptyResults: of(empty.results.text),
    emptyResourceList: of(empty.resourceList.text),
    emptyVolumeInfo: of(empty.volumeInfo.text),
  };

  return {
    backup,
    namespace,
    started,
    digest: sha256(
      Object.entries(texts)
        .map(([name, text]) => `${name} ${text.sha256}\n`)
        .join(""),
    ),
    log: log.facts,
    results: {
      ...texts.results,
      errors: count(results.value.errors),
      warnings: count(results.value.warnings),
      value: results.value,
    },
    resourceList: {
      ...texts.resourceList,
      resources: Object.keys(resourceList.value).length,
      items: Object.values(resourceList.value).reduce((total, list) => total + list.length, 0),
      value: resourceList.value,
    },
    volumeInfo: { ...texts.volumeInfo, volumes: volumeInfo.value.length, value: volumeInfo.value },
    empty: {
      results: texts.emptyResults,
      resourceList: texts.emptyResourceList,
      volumeInfo: texts.emptyVolumeInfo,
    },
  };
}
