// The words of the tabs that show what Velero wrote of an operation into its storage: which tabs there
// are, what each would create before it creates it, the state of the gate, the commands, the steps of a
// load, what is said of a text that was loaded and of its saving, what a file the store does not have
// means for the phase of its operation, what is said before any request of an operation Velero signs no
// URL for, what is said after a load that ended without its text, and what the details of the host say of
// the tabs. They are written once, beside the words of the request itself, and claim nothing a phase does
// not say.

import { locationWords } from "./allowances";
import { downloadFailure } from "./diagnostic-text";
import { ARTIFACT_HOLD_MS, DIAGNOSTIC_REQUEST_LABEL, downloadRequestName, REQUEST_LABELS } from "./ipc";
import { operationState } from "./phases";

import type { AllowanceFor } from "./allowances";
import type { ArtifactTarget, ArtifactValue, Failure } from "./ipc";
import type { OperationKind, OperationState } from "./phases";
import type { FamilyRead } from "./read-state";
import type { BackupResource, BackupStorageLocationResource, ObjectMetadata } from "./types";

export type ArtifactTab = "log" | "results" | "resources" | "volumes";

// The tabs after the summary, in their order: the title of each, the name of what it shows in a sentence,
// whether that name is plural, and the kind of request it asks for, by the kind of its operation.
export const ARTIFACT_TABS: readonly {
  id: ArtifactTab;
  title: string;
  noun: string;
  plural: boolean;
  targets: Record<OperationKind, ArtifactTarget>;
}[] = [
  { id: "log", title: "Log", noun: "log", plural: false, targets: { Backup: "BackupLog", Restore: "RestoreLog" } },
  {
    id: "results",
    title: "Results",
    noun: "results",
    plural: true,
    targets: { Backup: "BackupResults", Restore: "RestoreResults" },
  },
  {
    id: "resources",
    title: "Resources",
    noun: "resource list",
    plural: false,
    targets: { Backup: "BackupResourceList", Restore: "RestoreResourceList" },
  },
  {
    id: "volumes",
    title: "Volumes",
    noun: "volume information",
    plural: false,
    targets: { Backup: "BackupVolumeInfos", Restore: "RestoreVolumeInfo" },
  },
];

function tabOf(tab: ArtifactTab) {
  return ARTIFACT_TABS.find((entry) => entry.id === tab) ?? ARTIFACT_TABS[0];
}

// The kind of request a tab asks for.
export function artifactOf(tab: ArtifactTab, kind: OperationKind): ArtifactTarget {
  return tabOf(tab).targets[kind];
}

// What a tab would create, said before anything is created: the request, its kind, its target, which is
// named once, and where; then what becomes of the request, and that nothing is created before the request
// is shown and confirmed, which holds whatever the gate is at. Nothing is said of the file: whether the
// storage holds it is what the load finds, and for an operation that failed its validation, or that did
// not end, the phase says that it does not.
export function wouldCreate(
  tab: ArtifactTab,
  of: { kind: OperationKind; name: string; namespace: string; cluster: string },
): string {
  const { noun } = tabOf(tab);
  const operation = of.kind.toLowerCase();

  return `Loading the ${noun} of the ${operation} ${of.name} creates a DownloadRequest of the kind ${artifactOf(tab, of.kind)} for that ${operation}, in ${of.namespace} of the cluster ${of.cluster}. Velero signs a URL for the request and removes it after ten minutes. Nothing else is written, and nothing is created before the request is shown and confirmed.`;
}

// What a file the store does not have means, by the phase of the operation it is of. The release writes
// nothing for an operation that failed its validation, and everything when the work ends: the log of a
// backup as best it can, and for an operation that failed at work what it wrote before it failed. The
// phase is the one the operation had when the store was asked, and so is what is said of the storage:
// given when that was, as the views write a time, the words say it in the past and with that time, since
// the operation may have gone on since. Without it they speak of now, which is before anything is asked.
export function missingFile(tab: ArtifactTab, kind: OperationKind, state: OperationState, when?: string): string {
  const { noun, plural } = tabOf(tab);
  const operation = kind.toLowerCase();
  const asked = when === undefined ? "" : ` when ${plural ? "they were" : "it was"} asked for, at ${when}`;
  const absent =
    when === undefined
      ? `The ${noun} of this ${operation} ${plural ? "are" : "is"} not in the storage`
      : `The ${noun} of this ${operation} ${plural ? "were" : "was"} not in the storage${asked}`;

  if (state.failure === "validation")
    return `Velero writes nothing into the storage for a ${operation} that failed its validation: there ${plural ? `are no ${noun}` : `is no ${noun}`} to read. What it refused is in the summary.`;
  if (state.lifecycle === "deleting")
    return `${absent}: the ${operation} is being deleted, and its files are being removed.`;
  if (state.execution === "not-started" || state.execution === "running")
    return `The ${noun} of a ${operation} ${plural ? "are" : "is"} written into the storage when its work ends: ${
      when === undefined
        ? `${plural ? "they are" : "it is"} not there yet`
        : `${plural ? "they were" : "it was"} not there${asked}`
    }.`;
  if (state.failure === "failed")
    return `${absent}. Velero may have written the files of a ${operation} that failed before it failed, or none if it failed before it wrote them.`;
  if (state.execution === "ran")
    return `${absent}: ${plural ? "they were" : "it was"} removed from it, or ${plural ? "they were" : "it was"} never written there.${
      tab === "log" && kind === "Backup"
        ? " Velero uploads the log of a backup as best it can, and a backup ends without it when the upload fails."
        : ""
    }`;
  return `${absent}. What its phase says of its files is not known.`;
}

// A count of bytes in the unit that reads best.
function bytes(count: number): string {
  if (count < 1024) return `${count} B`;
  const units = ["KiB", "MiB", "GiB"];
  let value = count / 1024;
  let unit = 0;

  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(1)} ${units[unit]}`;
}

const FINDING = "Finding the way to the store.";
// The first step is the one every load begins at, and the one the views show before the main process
// answers: its words are true of a load that waits for nothing, and say when one does wait.
const STEPS: Record<string, string> = {
  queue: "Starting the load. Two artifacts at most are loaded at the same time: a third one waits for its turn.",
  target: "Reading the object the artifact is of.",
  backup: "Reading the backup of the restore.",
  location: "Reading the storage location.",
  certificate: "Reading the certificate of the storage location.",
  route: FINDING,
  service: FINDING,
  endpoints: FINDING,
  pod: FINDING,
  forward: FINDING,
  delivery: "Checking that the object is still the one that was asked.",
};

// The step a load is at, in words: the ones the main process says while it runs the request, with what
// each counts, and the taking of the pages of the text, which the view counts itself. Without a count a
// step is said as it is, with nothing that moves while the load is at it: that is what is said to who does
// not see, once for a step, while the words that are seen follow its counter.
export function loadStep(step: string, count?: number, request?: string, pages?: number): string {
  const named = request ? `the DownloadRequest ${request}` : "the DownloadRequest";

  if (step === "creation") return `Creating ${named}.`;
  if (step === "wait")
    return `${named.replace(/^the/, "The")} is created. Waiting for Velero to sign its URL${
      count ? `: ${count} seconds so far, of thirty at most` : ""
    }.`;
  if (step === "download")
    return `Downloading and decompressing the file${count === undefined ? "" : `: ${bytes(count)} so far`}.`;
  if (step === "pages")
    return `Taking the text from the main process${count === undefined ? "" : `: page ${count} of ${pages ?? 0}`}.`;
  // A step is a name the main process gives: only one this file has words for is looked up.
  return Object.hasOwn(STEPS, step) ? STEPS[step] : `Loading: ${step}.`;
}

// What is said of a text the main process did not give as it said it held it: a page that is not the one
// that was asked, or of another count of pages, or more text than an artifact has. Nothing of it is shown.
// The request was created and ran: it stays in the cluster as any other.
export function notTheText(request: string, namespace: string): string {
  return `What the main process gave of the text is not what it said it held: a page that is not the one that was asked, or more text than an artifact has. Nothing of it is shown. The ${KIND} ${request} stays in ${namespace} until Velero removes it.`;
}

// What the view read of the operation a tab is of: the object, with the two names a request follows and
// the phase it reports, and what the installation read of the backups and of the storage locations.
export interface ArtifactSource {
  metadata: ObjectMetadata;
  spec?: { backupName?: string; storageLocation?: string };
  status?: { phase?: string };
}

export interface ArtifactReads {
  backups: FamilyRead<BackupResource>;
  storageLocations: FamilyRead<BackupStorageLocationResource>;
}

function named(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

// The release writes the storage location into a backup that names none when it starts the backup, and
// not before: a backup that waits for its turn names none yet, and Velero signs no URL for it until it
// does. That is where the backup is, and no fault of its storage.
const NAMED_AT_THE_START =
  "Velero names the storage location of a backup when it starts the backup, and signs no URL for a backup that names none: no request is offered until then.";

// What is said of a backup that names no storage location because the release has not started it: what
// its phase says of its files, or that it reports no phase, and when its location is named. Nothing for
// a backup the release took: it has the location it was given, and one that names none has none.
function notNamedYet(tab: ArtifactTab, object: ArtifactSource): string | undefined {
  const state = operationState("Backup", object.status?.phase);

  if (state.reported === undefined)
    return `This backup reports no phase, and names no storage location. ${NAMED_AT_THE_START}`;
  if (state.execution !== "not-started" || state.failure === "validation") return undefined;
  return `${missingFile(tab, "Backup", state)} ${NAMED_AT_THE_START}`;
}

// What is said before any request, of an operation Velero signs no URL for: a restore that names no
// backup, and a backup whose storage location is not there. They are the words the request itself ends
// with at that step, said from what the view already read: the cluster is asked nothing, and nothing is
// created. The request follows the names of the spec, and so does this. A location is said not to be
// there only by a read of the locations that succeeded: one that was denied, that failed or that is of an
// earlier read says nothing of it, and neither does a backup that is not among what was read. For those
// nothing is answered, and the request reads what the view did not. A backup that did not start and names
// no location yet is told by its phase: Velero signs no URL for it either, and no request is offered.
export function nothingToAsk(
  tab: ArtifactTab,
  kind: OperationKind,
  object: ArtifactSource,
  read: ArtifactReads,
): string | undefined {
  const namespace = object.metadata.namespace ?? "";
  const context = { artifact: artifactOf(tab, kind), name: object.metadata.name, namespace };
  const here = (item: { metadata: ObjectMetadata }, name: string) =>
    item.metadata.name === name && (item.metadata.namespace ?? "") === namespace;
  let backup: ArtifactSource | undefined = object;

  if (kind === "Restore") {
    const source = named(object.spec?.backupName);

    if (!source) return downloadFailure("not-found", "backup", context).text;
    backup = read.backups.items.find((item) => here(item, source));
    if (!backup) return undefined;
  }
  const location = named(backup.spec?.storageLocation);
  const waits = !location && kind === "Backup" ? notNamedYet(tab, object) : undefined;

  if (waits) return waits;
  const locations = read.storageLocations;
  const missing = !location || (locations.status === "ready" && !locations.items.some((item) => here(item, location)));

  return missing ? downloadFailure("not-found", "location", context).text : undefined;
}

// The state of the gate, said beside what a tab would create while writes are not on: where they are
// turned on, or that it is not known whether they are. The same words as wherever a write is offered.
export function writesOff(unknown = false): string {
  return unknown
    ? "Whether writes are on is not known: the target bar asks the main process again."
    : "Writes are off for this installation: they are turned on in the target bar.";
}

// The way to the target bar, which is the only command of a tab while writes are not on.
export const TO_THE_WRITES = "Go to the writes in the target bar";

const KIND = "DownloadRequest";

// The command that asks for an artifact, in the name of the kind it creates and of the kind of artifact it
// is for. A load that follows another one, loaded or not, is another request.
export function loadCommand(tab: ArtifactTab, kind: OperationKind, again = false): string {
  return `Create ${again ? "another" : "a"} ${KIND} of the kind ${artifactOf(tab, kind)}`;
}

// What loading again does, said of the command that does it: what is shown, a text, a table or a
// sentence, stays while the request is confirmed, and goes when the request is created.
export function againNote(tab: ArtifactTab): string {
  return `Loading the ${tabOf(tab).noun} again creates another ${KIND}, and what is shown goes when that request is created.`;
}

export const ASKING = "Asking the main process for the confirmation of the request.";
export const CANCEL_COMMAND = "Cancel the load";
// What is said while a load is cancelled, at whatever step it is: the main process stops a request that
// runs, a confirmation that is renewed creates nothing, and no more pages are taken of a text.
export const CANCELLING = "Cancelling: the load is stopped at the step it is at, and the tab says how it ended.";

// The identifier of a request is made when the request is confirmed: until then it is said in words.
const IDENTIFIER = "the identifier of the request";

// The request a tab would create, as its confirmation shows it: the name it will have, which ends with an
// identifier made when it is confirmed, the labels the main process creates it with, of which one carries
// that identifier, its spec in words, and the object it is of.
export function requestWords(
  tab: ArtifactTab,
  of: { kind: OperationKind; name: string },
): { name: string; labels: Readonly<Record<string, string>>; spec: string; target: string } {
  return {
    name: `${downloadRequestName(of.name, "")}, followed by ${IDENTIFIER}`,
    labels: { ...REQUEST_LABELS, [DIAGNOSTIC_REQUEST_LABEL]: IDENTIFIER },
    spec: `target.kind ${artifactOf(tab, of.kind)}, target.name ${of.name}`,
    target: `The ${of.kind.toLowerCase()} ${of.name}`,
  };
}

// What asking again does after a load that ended without its text, said before the command is given. A
// load that ended before anything was created left no request: the one that is asked is no other one.
export function askAgainNote(namespace: string, another = true): string {
  return `Asking again creates ${another ? "another" : "a"} ${KIND} in ${namespace}.`;
}

// What is said after a load the main process says is not to be asked again as it was asked: its own
// words say what there is to do first. The tab does not offer the same request again: it offers one
// command, which takes it back to where it was before the request and asks nothing.
export const NOT_AGAIN =
  "The main process says that asking again as it was asked is not safe after this. The command takes the tab back to where it was before the request, and asks nothing.";

// That command, in the name of where it leads: the first state of the tab, or the text the tab still
// shows when what failed was the confirmation of a load again.
export function beginAgain(text: boolean): string {
  return text ? "Go back to the text that is shown" : "Take the tab back to its first state";
}

// The command that allows what a download said it needs, in the name of what it allows: the origin is
// shown, and nothing of a URL after it.
export function allowCommand(needs: AllowanceFor): string {
  return needs.what === "origin"
    ? `Allow downloads from ${needs.origin} for the storage location ${locationWords(needs.location)}`
    : needs.what === "private"
      ? `Allow a connection to a private address of ${needs.origin}`
      : `Allow a connection to ${needs.origin} that is not encrypted, made directly from this machine`;
}

// What becomes of what is allowed, and what follows it, said before the command is given.
export function allowNote(tab: ArtifactTab): string {
  const { noun, plural } = tabOf(tab);

  return `What is allowed is kept for this cluster until it is taken back in the target bar. The ${noun} ${plural ? "are" : "is"} then asked again, which creates another ${KIND}.`;
}

// What is said over a text that was loaded: when, and how much of it there is. The time is given as the
// views write one.
export function loadedText(tab: ArtifactTab, value: Pick<ArtifactValue, "size">, when: string): string {
  const { noun, plural } = tabOf(tab);

  return `The ${noun} ${plural ? "were" : "was"} loaded at ${when} (${bytes(value.size)} of text).`;
}

// The request a text came through, said after the text with the way it came by: the sentence is of the
// file, on every tab, and the one of the way goes on from it.
export function cameThrough(request: string): string {
  return `The file came through the ${KIND} ${request}.`;
}

// The way a text came by, as the main process says it: through a tunnel to the Pod of the store or
// directly from this machine, encrypted or not, and from which origin. A connection that was not
// encrypted is said for what it was: inside the tunnel, or allowed by the operator for that origin.
export function cameBy(route: ArtifactValue["route"]): string {
  if (route.mode === "tunnel") {
    const through = `It came from ${route.origin} through a tunnel to the Pod of the store, opened through the API server of the cluster`;

    return route.encrypted
      ? `${through}, over TLS that was verified.`
      : `${through}. The connection to the store was not encrypted: its bytes travelled inside the connection to the API server, and inside the cluster.`;
  }
  const directly = `It came from ${route.origin}, directly from this machine`;

  return route.encrypted
    ? `${directly}, over TLS that was verified.`
    : `${directly}. The connection was not encrypted: that was allowed for this origin.`;
}

// The command that saves the text of a tab into a file.
export function saveCommand(tab: ArtifactTab): string {
  return `Save the ${tabOf(tab).noun} to a file`;
}

// What the dialog of a saving says is saved, which the main process gives the host with the name of the
// file: the artifact, the operation it is of, its installation and its cluster. A dialog stays open for as
// long as the operator leaves it, beside the window: one is told from another by these words.
export function saveTitle(artifact: ArtifactTarget, name: string, namespace: string, cluster: string): string {
  const tab = ARTIFACT_TABS.find((entry) => Object.values(entry.targets).includes(artifact)) ?? ARTIFACT_TABS[0];
  const kind = tab.targets.Restore === artifact ? "restore" : "backup";

  return `Save the ${tab.noun} of the ${kind} ${name}, of ${namespace} in the cluster ${cluster}`;
}

// Until when the text of a tab can be saved, which is what the command that saves it is described by: the
// time first, then why there is one. The main process writes the file from the copy it holds, and holds it
// for so many minutes from the load, or for less when it needs the room for the texts of other tabs:
// reading the text does not make it longer. The time is given as the views write one.
export function savableUntil(tab: ArtifactTab, when: string): string {
  const { noun } = tabOf(tab);

  return `The ${noun} can be saved to a file until ${when} at most: the main process keeps its copy for ${ARTIFACT_HOLD_MS / 60_000} minutes after a load, or less when it needs the room for other texts.`;
}

// What is said in the place of that command when the time has passed: the text that is shown stays, and
// saving it takes another load, which is another request.
export function savableNoMore(tab: ArtifactTab, when: string): string {
  const { noun, plural } = tabOf(tab);
  const it = plural ? "they are" : "it is";

  return `The main process kept its copy of the ${noun} until ${when}, and let it go. What is shown stays: ${it} saved only after ${it} loaded again, which creates another ${KIND}.`;
}

// What the saving of a text is at, in words, and nothing while none was asked: the dialog of the host that
// is open, the file that was written, the dialog that was closed, or why the file was not written, which
// the main process says. The file is on this machine and is the choice of the operator: nothing of it is
// named.
export function savingText(
  tab: ArtifactTab,
  saving: { state: "none" | "asked" | "saved" | "left" } | { state: "failed"; failure: Pick<Failure, "text"> },
): string | undefined {
  const { noun, plural } = tabOf(tab);

  switch (saving.state) {
    case "asked":
      return `Choose the file in the dialog of Freelens: the ${noun} ${plural ? "are" : "is"} written there, on this machine, and nothing is written to the cluster.`;
    case "saved":
      return `The ${noun} ${plural ? "were" : "was"} saved into the file that was chosen.`;
    case "left":
      return `No file was chosen: the ${noun} ${plural ? "were" : "was"} not saved, and nothing was written.`;
    case "failed":
      return saving.failure.text;
    default:
      return undefined;
  }
}

// What the details the host shows of an operation say of the tabs: where they are, and that the details
// load none of them.
export function inTheWorkspace(kind: OperationKind): string {
  const nouns = ARTIFACT_TABS.map((tab) => `the ${tab.noun}`);

  return `${capital(nouns.slice(0, -1).join(", "))} and ${nouns[nouns.length - 1]} of this ${kind.toLowerCase()} are in its workspace, each loaded there when it is asked for. None of them is loaded here.`;
}

function capital(words: string): string {
  return `${words.charAt(0).toUpperCase()}${words.slice(1)}`;
}
