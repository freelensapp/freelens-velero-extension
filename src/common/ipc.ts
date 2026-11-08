// The way between the two processes of the extension: the procedures the renderer calls, what each is
// given and what each answers. Every request is validated by the process that receives it, every answer
// by the one that receives it, and neither trusts the other. No raw error, URL, header, body or path of a
// file is in any of them: a failure is a code, a stage, whether it is safe to try again and words.

import { type AllowanceFor, readAllowanceFor } from "./allowances";
import { backupNameProblem, scheduleRefused } from "./backup-from-schedule";
import { type BackupTemplate, BOOLEAN_FIELDS, DURATION_FIELDS, LIST_FIELDS, TEMPLATE_BOUNDS } from "./backup-template";
import {
  CLUSTER_RESOURCES,
  EXISTING_RESOURCE_POLICIES,
  MAPPING_BOUND,
  type RestoreForm,
  restoreNameProblem,
} from "./restore-form";
import { EXPRESSION_BOUND, type ScheduleWrapper, scheduleNameProblem } from "./schedule-form";

import type { DiagnosticCode } from "./diagnostic-code";
import type { ResumeParameters } from "./schedule-patch";

export const CHANNELS = {
  gateState: "gate.state",
  gateEnable: "gate.enable",
  gateDisable: "gate.disable",
  gateChanged: "gate.changed",
  writeConfirm: "write.confirm",
  writeRun: "write.run",
  writeStatus: "write.status",
  writeCancel: "write.cancel",
  writeEnds: "write.ends",
  writeShown: "write.shown",
  artifactPage: "artifact.page",
  artifactRelease: "artifact.release",
  artifactSave: "artifact.save",
  allowanceGrant: "allowance.grant",
  allowanceRevoke: "allowance.revoke",
} as const;

// The writes of the extension: the two requests of the tabs and of the band of the server, and the actions of
// SPEC-0017, each named by what it does, as they land.
export const WRITE_KINDS = [
  "DownloadRequest",
  "ServerStatusRequest",
  "backup-from-schedule",
  "backup",
  "schedule",
  "restore",
  "schedule-pause",
  "schedule-resume",
  "delete-backup",
] as const;
export type WriteKind = (typeof WRITE_KINDS)[number];

// The artifacts of an operation a DownloadRequest is created for: eight of the fourteen kinds of target
// the API of the reviewed release has. The contents of a backup are not among them, and never will be:
// what is not one of the eight is refused where a request is read, before the gate is looked at.
export const ARTIFACT_TARGETS = [
  "BackupLog",
  "RestoreLog",
  "BackupResults",
  "RestoreResults",
  "BackupResourceList",
  "RestoreResourceList",
  "BackupVolumeInfos",
  "RestoreVolumeInfo",
] as const;
export type ArtifactTarget = (typeof ARTIFACT_TARGETS)[number];

export function isArtifactTarget(value: unknown): value is ArtifactTarget {
  return typeof value === "string" && (ARTIFACT_TARGETS as readonly string[]).includes(value);
}

// The kind of operation an artifact is of.
export function artifactKind(artifact: ArtifactTarget): "Backup" | "Restore" {
  return artifact.startsWith("Backup") ? "Backup" : "Restore";
}

// What a request of a generated name is created with, which the confirmation of the views shows: the
// prefix of its name, so that an operator who lists the requests knows what created them, and the labels
// that say the same. The main process creates with these and the views show these: they are written once.
export const REQUEST_PREFIX = "freelens-velero-";
export const REQUEST_LABELS: Readonly<Record<string, string>> = {
  "app.kubernetes.io/managed-by": "freelens-velero-extension",
};
// The label a DownloadRequest carries beside them, with the identifier of the request of the views it was
// created for: it is how the main process knows a request as its own when it reads it back.
export const DIAGNOSTIC_REQUEST_LABEL = "freelensapp.io/diagnostic-request";

// The name of a DownloadRequest: the one of its target, a dash and the identifier of the request of the
// views it was created for. The main process creates with it and the views say it: it is written once.
export function downloadRequestName(target: string, request: string): string {
  return `${target}-${request}`;
}

// Where the write of such a request failed, which the main process says and the views read what the
// request left in the cluster by: before the cluster answered its creation, and while the request was waited
// for, which is after it was created.
export const REQUEST_STAGES = { creation: "creation", wait: "wait" } as const;

// The steps of the way of a DownloadRequest, in their order: the wait for one of the two places of the
// process, the target read again, its backup when it is a restore, the storage location of the backup,
// its certificate, the creation of the request, the wait for its URL, the route to the store, with the
// reads a route through the cluster needs, of the Service of the store, of its endpoint slices and of
// its Pod, and the port-forward to that Pod, the download, the delivery of the text and the release of
// what was opened. A failure names the step it ended at.
export const DOWNLOAD_STAGES = [
  "queue",
  "target",
  "backup",
  "location",
  "certificate",
  "creation",
  "wait",
  "route",
  "service",
  "endpoints",
  "pod",
  "forward",
  "download",
  "delivery",
  "release",
] as const;
export type DownloadStage = (typeof DOWNLOAD_STAGES)[number];

// The largest page of the text of an artifact the main process gives the views, in bytes of its text.
export const PAGE_BOUND = 4 * 1024 * 1024;

// The largest text an artifact is, in bytes: what the main process decodes of a file at most, and so the
// most the views take of one, a text of so many bytes having no more units than that.
export const ARTIFACT_TEXT_BOUND = 64 * 1024 * 1024;

// For how long the main process holds the text of an artifact when no view lets it go, in milliseconds,
// from the moment it holds it. It saves a text from the copy it holds: the views say until when, and
// offer the saving no longer than that.
export const ARTIFACT_HOLD_MS = 10 * 60 * 1000;

// The largest request the processes accept of each other.
export const REQUEST_BOUND = 64 * 1024;

export type FailureCode = DiagnosticCode | "connection-unsupported";

export interface Failure {
  ok: false;
  code: FailureCode;
  // Where it failed: the gate, the catalog, the connection, the creation, the wait, and so on.
  stage: string;
  // Whether asking again, as it was asked, is safe.
  retry: boolean;
  // Words that are safe to show.
  text: string;
  // What the operator may allow for the request to go on, when that is what stopped it: an origin, a
  // private address or a connection that is not encrypted, for that origin. Never a URL.
  needs?: AllowanceFor;
}
export type Answer<Value> = { ok: true; value: Value } | Failure;

// What the main process says of the connection of a cluster it could not make the writes of the extension
// for. The writes go through the client of the host, which authenticates as the connection of the host does:
// the extension refuses no form of a kubeconfig, and reads none, so the one reason left is a client it could
// not make.
export interface Connection {
  supported: false;
  reason: ConnectionReason;
}

export const CONNECTION_REASON_NAMES = ["unusable"] as const;
export type ConnectionReason = (typeof CONNECTION_REASON_NAMES)[number];

// Why the writes of the extension cannot use the connection of a cluster. The main process says it when it
// refuses to turn writes on, and the views show it.
export const CONNECTION_REASONS: Record<ConnectionReason, string> = {
  unusable: "The connection of this cluster is not one the writes of the extension can use.",
};

// The state of the gate of one cluster, as the main process holds it.
export interface GateState {
  // The cluster, as the catalog of the host names it, and its context.
  cluster: { id: string; name: string; context: string };
  writes: { on: false } | { on: true; namespace: string; since: number };
  connection?: Connection;
}

export interface GateStateRequest {
  cluster: string;
}
export interface GateEnableRequest {
  cluster: string;
  namespace: string;
  // What the dialog named: it must be the context and the namespace the gate is turned on for.
  confirmation: { context: string; namespace: string };
}
export interface GateDisableRequest {
  cluster: string;
}

// The target of a write that is of one object, for the kinds that have one.
export interface WriteTarget {
  kind: "Backup" | "Restore" | "Schedule";
  name: string;
  uid: string;
}
export interface WriteConfirmRequest {
  cluster: string;
  namespace: string;
  kind: WriteKind;
  target?: WriteTarget;
  // What the kind of the write needs beside its target: the artifact a DownloadRequest is for. It is a
  // part of what is confirmed: a confirmation of the log of a backup is not one of its results.
  artifact?: ArtifactTarget;
  // The name of the backup a schedule is asked for by hand (SPEC-0017, REQ-255), or of the backup of the form
  // (REQ-262), a part of what is confirmed.
  backup?: string;
  // The fields of the form of the template of a backup of the form (SPEC-0017, REQ-260), or of a schedule of the form
  // (SPEC-0016, REQ-235): the body is built of them, and the run carries none of them.
  template?: BackupTemplate;
  // The name of the schedule of the form (SPEC-0016, REQ-225), a part of what is confirmed.
  schedule?: string;
  // The expression and the three flags of the schedule of the form (SPEC-0016, REQ-223), at the confirmation only, as
  // the template.
  wrapper?: ScheduleWrapper;
  // The name of the restore of the form, whose backup is the target (SPEC-0017, REQ-265), a part of what is confirmed.
  restore?: string;
  // The fields of the form of a restore (SPEC-0017, REQ-268 to REQ-270), at the confirmation only: the body is built of
  // them, and the run carries none of them.
  restoreForm?: RestoreForm;
  // The expression the review of a resume read and the value of `skipImmediately` chosen (SPEC-0017, REQ-275), at the
  // confirmation only: the patch is built of them, and the run carries none of them.
  resume?: ResumeParameters;
}
export interface WriteConfirmAnswer {
  token: string;
  expires: number;
  // The text the main process will send, written once, for a write whose body the review shows (SPEC-0017,
  // REQ-246): the run sends it byte for byte, and carries nothing of it.
  text?: string;
}
export interface WriteRunRequest {
  cluster: string;
  namespace: string;
  kind: WriteKind;
  target?: WriteTarget;
  artifact?: ArtifactTarget;
  backup?: string;
  schedule?: string;
  restore?: string;
  // The name of the backup as the operator typed it, the second gesture of a restore (SPEC-0017, REQ-271): the main
  // process runs nothing for another name.
  typed?: string;
  token: string;
  request: string;
}

// What a backup asked from a schedule is once it was created: its name and its UID, and the phase Velero wrote,
// when it wrote one within the reads after the creation (SPEC-0017, REQ-248).
export interface BackupCreated {
  name: string;
  uid: string;
  phase?: string;
  // Where it is in the queue of the server while it is Queued, and the errors of a validation Velero refused it with,
  // as written, when they are within the bounds of the contract (SPEC-0017, REQ-264).
  position?: number;
  errors?: string[];
  // How many errors Velero wrote beyond the ones carried, which the view of the backup shows.
  errorsLeft?: number;
  // The answer of the creation was lost, and the backup was found by its name as the review wrote it (SPEC-0017,
  // REQ-250): what the reads found is said.
  found?: true;
}

// What a schedule of the form is once it was created: its name and its UID, and what Velero wrote of it within the
// reads after the creation (SPEC-0016, REQ-238): its phase, and the errors of a validation as written, within the
// bounds of the contract; that it is paused, which Velero does not read, so that it was read once; and that it was
// found by its name after an answer that was lost (REQ-228).
export interface ScheduleCreated {
  name: string;
  uid: string;
  phase?: string;
  errors?: string[];
  // How many errors Velero wrote beyond the ones carried, which the view of the schedule shows.
  errorsLeft?: number;
  paused?: true;
  found?: true;
}

// What a schedule paused or resumed is once the patch was applied, as the main process read it once after it (SPEC-0017,
// REQ-277): paused; or resumed, with what `skipImmediately` holds and the time Velero wrote it skipped the run, once it
// read the schedule; and that it was read so after an answer of the patch that was lost (REQ-250).
export interface ScheduleChanged {
  name: string;
  uid: string;
  paused: boolean;
  skipImmediately?: boolean;
  lastSkipped?: string;
  found?: true;
}

// What a restore of the form is once it was created: its name and its UID, and what Velero wrote of it within the reads
// after the creation (SPEC-0017, REQ-272): its phase, and the errors of a validation as written, within the bounds of
// the contract; and that it was found by its name after an answer that was lost (REQ-250).
export interface RestoreCreated {
  name: string;
  uid: string;
  phase?: string;
  errors?: string[];
  // How many errors Velero wrote beyond the ones carried, which the view of the restore shows.
  errorsLeft?: number;
  found?: true;
}

// What the reads after the creation of a DeleteBackupRequest showed of the request and of its backup together
// (SPEC-0017, REQ-282): the request gone with the backup, a deletion Velero completed; the request gone and the backup
// there, a request a later one for the same backup replaced; Processed with the error of a refusal and the backup in the
// phase it had, a deletion Velero refused; Processed with errors and the backup Deleting, a deletion that failed on the
// way; no phase, a request Velero has not read; InProgress, a deletion Velero is at.
export const DELETION_ENDS = ["completed", "replaced", "refused", "failed", "unread", "in-progress"] as const;
export type DeletionEnd = (typeof DELETION_ENDS)[number];

// What a deletion of a backup is once its request was created: the request by the name the API server gave it, the
// end the last reads showed, the phase of the backup when it is there, the errors of the request as Velero wrote them,
// within the bounds of the contract; that the request was looked for by the labels of its backup after an answer that
// was lost (REQ-250); and that the requests could not be read, and the backup alone was.
export interface BackupDeleted {
  request?: string;
  end: DeletionEnd;
  phase?: string;
  errors?: string[];
  errorsLeft?: number;
  found?: true;
  requestsUnread?: true;
}

// The errors of a validation an answer carries: a few, each as written, within a total that leaves the answer within
// its bound; the others are counted, and read in the view of the backup, or of the schedule.
export const ERRORS_BOUND = { items: 16, item: 4096, total: 32_768 } as const;

// The errors of a validation as an answer carries them: in the order Velero wrote them, each whole, until one does not
// fit; how many are left is said.
export function carriedErrors(errors: unknown): { errors?: string[]; errorsLeft?: number } {
  if (!Array.isArray(errors)) return {};
  const written = errors.filter((error): error is string => typeof error === "string" && error.length > 0);
  const carried: string[] = [];
  let total = 0;

  for (const error of written) {
    if (carried.length === ERRORS_BOUND.items || error.length > ERRORS_BOUND.item) break;
    if (total + error.length > ERRORS_BOUND.total) break;
    carried.push(error);
    total += error.length;
  }
  const left = written.length - carried.length;

  return { ...(carried.length ? { errors: carried } : {}), ...(left > 0 ? { errorsLeft: left } : {}) };
}
// How a write whose request was sent ended: the backup created, with the phase Velero wrote and whether it was found
// by its name after an answer that was lost; or the code and the words of the failure.
// What a write did: for a creation, the object created; for a pause and a resume, the patch applied, with nothing
// more, since the kind says which.
export type KeptOutcome =
  | { created: true; phase?: string; found?: true; paused?: true; deletion?: DeletionEnd }
  | { created: false; code: FailureCode; text: string };

// The end of a write whose request was sent, kept for its cluster until a frame of that cluster has shown it, or the
// extension is deactivated (SPEC-0017, REQ-250; SPEC-0016, REQ-243): what to look for and where, and how it ended.
export interface KeptEnd {
  // The identifier of the request of the write.
  request: string;
  kind:
    | "backup-from-schedule"
    | "backup"
    | "schedule"
    | "restore"
    | "schedule-pause"
    | "schedule-resume"
    | "delete-backup";
  namespace: string;
  // The context of the entry of the cluster in the catalog of the host.
  context: string;
  // What to look for: the backup, or the schedule of the form, by its name, and the schedule a backup was asked from,
  // for a backup asked from one.
  name: string;
  schedule?: string;
  // The backup a restore is of.
  backup?: string;
  outcome: KeptOutcome;
  // When it ended, by the clock of the main process.
  at: number;
}

// How many ends are kept for one cluster: the oldest go first.
export const KEPT_ENDS_BOUND = 16;

// The longest phase of an object the contract carries: a phase of the release is a short word, and a longer one is no
// phase Velero writes.
export const PHASE_BOUND = 64;

export interface WriteStatusRequest {
  cluster: string;
  request: string;
}
export interface WriteCancelRequest {
  cluster: string;
  request: string;
}

// What a write is at, for the frame that asked it.
export interface WriteStatus {
  step: string;
  // What the step counts, when it counts something: bytes, seconds.
  count?: number;
}

// The page of the text of an artifact a view asks for, of a write of its frame.
export interface ArtifactPageRequest {
  cluster: string;
  request: string;
  page: number;
}

// What the main process answers of an artifact it downloaded: the request it created, how much text
// there is and in how many pages, and the route the bytes came by, in words. The text is asked page by
// page; the signed URL is in none of it.
export interface ArtifactValue {
  request: { name: string; uid: string };
  // The decoded text, in bytes, and the pages it is given in.
  size: number;
  pages: number;
  route: {
    // Through a tunnel to the pod of the storage, or directly from this machine.
    mode: "tunnel" | "direct";
    // Whether the connection to the store was encrypted.
    encrypted: boolean;
    // The origin of the store, without a path and without a query.
    origin: string;
  };
}

export interface ArtifactPage {
  page: number;
  pages: number;
  text: string;
}

export interface ServerStatusValue {
  version: string;
  processed: string;
  plugins: { name: string; kind: string }[];
  request: { name: string; uid: string };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const CLUSTER = /^[a-z0-9][a-z0-9-]{0,63}$/i;
const LABEL = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
const SUBDOMAIN = /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// The keys of a request are exactly the ones its contract names: a field the contract does not know
// refuses the request, and so does one it names that is missing.
function hasKeys(value: Record<string, unknown>, required: string[], optional: string[] = []): boolean {
  const keys = Object.keys(value);

  return (
    required.every((key) => keys.includes(key)) && keys.every((key) => required.includes(key) || optional.includes(key))
  );
}

function isCluster(value: unknown): value is string {
  return typeof value === "string" && CLUSTER.test(value);
}

export function isNamespace(value: unknown): value is string {
  return typeof value === "string" && value.length <= 63 && LABEL.test(value);
}

function isName(value: unknown): value is string {
  return typeof value === "string" && value.length <= 253 && SUBDOMAIN.test(value);
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

// The characters of the text of a failure, and of the end of a write, the views take.
export const FAILURE_TEXT_BOUND = 1024;

function isText(value: unknown, bound = 256): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= bound;
}

function isWriteKind(value: unknown): value is WriteKind {
  return typeof value === "string" && (WRITE_KINDS as readonly string[]).includes(value);
}

function isTarget(value: unknown): value is WriteTarget {
  return (
    isRecord(value) &&
    hasKeys(value, ["kind", "name", "uid"]) &&
    (value.kind === "Backup" || value.kind === "Restore" || value.kind === "Schedule") &&
    isName(value.name) &&
    isText(value.uid)
  );
}

// A request is within its bound before anything of it is read.
function withinBound(value: unknown): boolean {
  try {
    return JSON.stringify(value).length <= REQUEST_BOUND;
  } catch {
    return false;
  }
}

export function readGateStateRequest(value: unknown): GateStateRequest | undefined {
  if (!withinBound(value) || !isRecord(value) || !hasKeys(value, ["cluster"]) || !isCluster(value.cluster)) return;
  return { cluster: value.cluster };
}

export function readGateEnableRequest(value: unknown): GateEnableRequest | undefined {
  if (!withinBound(value) || !isRecord(value) || !hasKeys(value, ["cluster", "namespace", "confirmation"])) return;
  const confirmation = value.confirmation;

  if (
    !isCluster(value.cluster) ||
    !isNamespace(value.namespace) ||
    !isRecord(confirmation) ||
    !hasKeys(confirmation, ["context", "namespace"]) ||
    !isText(confirmation.context) ||
    !isNamespace(confirmation.namespace)
  )
    return;
  return {
    cluster: value.cluster,
    namespace: value.namespace,
    confirmation: { context: confirmation.context, namespace: confirmation.namespace },
  };
}

export function readGateDisableRequest(value: unknown): GateDisableRequest | undefined {
  return readGateStateRequest(value);
}

// The fields of the form of a template as the contract carries them (SPEC-0017, REQ-260): each one it knows, of its type
// and within its bounds, and none it does not know. What the release refuses of them is not read here: the main
// process says it, with the words of the release, before it builds a body.
function readTemplate(value: unknown): BackupTemplate | undefined {
  const known = [
    ...LIST_FIELDS,
    ...BOOLEAN_FIELDS,
    ...DURATION_FIELDS,
    "labelSelector",
    "orLabelSelectors",
    "storageLocation",
  ];

  if (!isRecord(value) || !hasKeys(value, [], known)) return;
  const template: Record<string, unknown> = {};

  for (const field of LIST_FIELDS) {
    if (!(field in value)) continue;
    const items = value[field];

    if (!Array.isArray(items) || items.length > TEMPLATE_BOUNDS.items) return;
    if (!items.every((item) => isText(item, TEMPLATE_BOUNDS.item))) return;
    template[field] = [...items];
  }
  for (const field of BOOLEAN_FIELDS) {
    if (!(field in value)) continue;
    if (typeof value[field] !== "boolean") return;
    template[field] = value[field];
  }
  for (const field of DURATION_FIELDS) {
    if (!(field in value)) continue;
    if (!isText(value[field], TEMPLATE_BOUNDS.duration)) return;
    template[field] = value[field];
  }
  if ("labelSelector" in value) {
    if (!isText(value.labelSelector, TEMPLATE_BOUNDS.selector)) return;
    template.labelSelector = value.labelSelector;
  }
  if ("orLabelSelectors" in value) {
    const selectors = value.orLabelSelectors;

    if (!Array.isArray(selectors) || selectors.length > TEMPLATE_BOUNDS.selectors) return;
    if (!selectors.every((selector) => isText(selector, TEMPLATE_BOUNDS.selector))) return;
    template.orLabelSelectors = [...selectors];
  }
  if ("storageLocation" in value) {
    if (!isText(value.storageLocation, TEMPLATE_BOUNDS.item)) return;
    template.storageLocation = value.storageLocation;
  }
  return template as BackupTemplate;
}

// The fields of the form of a restore as the contract carries them (SPEC-0017, REQ-273): each one it knows, of its type
// and within the bounds of the form, the policy for the resources that exist always, and none it does not know, the
// hooks, the resource modifier and the resource policy among them. What the restore controller refuses of them is not
// read here: the main process says it, with its words, before it builds a body.
function readRestoreForm(value: unknown): RestoreForm | undefined {
  const lists = ["includedNamespaces", "excludedNamespaces", "includedResources", "excludedResources"] as const;
  const known = [
    ...lists,
    "namespaceMapping",
    "clusterResources",
    "labelSelector",
    "orLabelSelectors",
    "restorePVs",
    "existingResourcePolicy",
  ];

  if (!isRecord(value) || !hasKeys(value, ["existingResourcePolicy"], known)) return;
  if (!(EXISTING_RESOURCE_POLICIES as readonly unknown[]).includes(value.existingResourcePolicy)) return;
  const form: Record<string, unknown> = { existingResourcePolicy: value.existingResourcePolicy };

  for (const field of lists) {
    if (!(field in value)) continue;
    const items = value[field];

    if (!Array.isArray(items) || items.length > TEMPLATE_BOUNDS.items) return;
    if (!items.every((item) => isText(item, TEMPLATE_BOUNDS.item))) return;
    form[field] = [...items];
  }
  if ("namespaceMapping" in value) {
    const pairs = value.namespaceMapping;

    if (!Array.isArray(pairs) || pairs.length > MAPPING_BOUND) return;
    if (
      !pairs.every(
        (pair) =>
          Array.isArray(pair) &&
          pair.length === 2 &&
          typeof pair[0] === "string" &&
          typeof pair[1] === "string" &&
          pair[0].length <= TEMPLATE_BOUNDS.item &&
          pair[1].length <= TEMPLATE_BOUNDS.item,
      )
    )
      return;
    form.namespaceMapping = pairs.map(([source, target]) => [source, target]);
  }
  if ("clusterResources" in value) {
    if (!(CLUSTER_RESOURCES as readonly unknown[]).includes(value.clusterResources)) return;
    form.clusterResources = value.clusterResources;
  }
  if ("labelSelector" in value) {
    if (!isText(value.labelSelector, TEMPLATE_BOUNDS.selector)) return;
    form.labelSelector = value.labelSelector;
  }
  if ("orLabelSelectors" in value) {
    const selectors = value.orLabelSelectors;

    if (!Array.isArray(selectors) || selectors.length > TEMPLATE_BOUNDS.selectors) return;
    if (!selectors.every((selector) => isText(selector, TEMPLATE_BOUNDS.selector))) return;
    form.orLabelSelectors = [...selectors];
  }
  if ("restorePVs" in value) {
    if (typeof value.restorePVs !== "boolean") return;
    form.restorePVs = value.restorePVs;
  }
  return form as unknown as RestoreForm;
}

export function readWriteConfirmRequest(value: unknown): WriteConfirmRequest | undefined {
  return readWriteParameters(value, false);
}

// The characters of an expression the contract carries: the main process says, with its words, what it refuses of
// one within them (SPEC-0016, REQ-226).
const EXPRESSION_CARRIED = 4 * EXPRESSION_BOUND;

// The wrapper of a schedule of the form: the expression, and each of the three flags set to true or to false.
function readWrapper(value: unknown): ScheduleWrapper | undefined {
  if (
    !isRecord(value) ||
    !hasKeys(value, ["expression", "paused", "skipImmediately", "useOwnerReferencesInBackup"]) ||
    typeof value.expression !== "string" ||
    value.expression.length > EXPRESSION_CARRIED ||
    typeof value.paused !== "boolean" ||
    typeof value.skipImmediately !== "boolean" ||
    typeof value.useOwnerReferencesInBackup !== "boolean"
  )
    return;
  return {
    expression: value.expression,
    paused: value.paused,
    skipImmediately: value.skipImmediately,
    useOwnerReferencesInBackup: value.useOwnerReferencesInBackup,
  };
}

// The parameters of a write, as the confirmation carries them, or as the run does: the run of a backup or of a
// schedule of the form carries its name and none of the fields of its form, which the text kept with the token is made
// of, and its reader refuses them.
function readWriteParameters(value: unknown, run: boolean): WriteConfirmRequest | undefined {
  if (
    !withinBound(value) ||
    !isRecord(value) ||
    !hasKeys(
      value,
      ["cluster", "namespace", "kind"],
      ["target", "artifact", "backup", "template", "schedule", "wrapper", "restore", "restoreForm", "resume"],
    )
  )
    return;
  if (!isCluster(value.cluster) || !isNamespace(value.namespace) || !isWriteKind(value.kind)) return;
  if ("target" in value && !isTarget(value.target)) return;
  // A DownloadRequest is of a backup or of a restore, and for one artifact of it; a backup asked from a schedule
  // is of the schedule, with the name of the backup; a backup of the form is of no object, with its name and, at the
  // confirmation, its template; a schedule of the form is of none, with its name and, at the confirmation, its wrapper
  // and its template; a restore is of a backup, with its name and, at the confirmation, its form; a
  // ServerStatusRequest is of none.
  const ofSchedule = value.kind === "backup-from-schedule";
  const ofForm = value.kind === "backup";
  const newSchedule = value.kind === "schedule";
  const ofRestore = value.kind === "restore";
  // A pause and a resume are of a schedule, and a resume carries, at the confirmation, the expression its review read
  // and the value of `skipImmediately` chosen. A deletion is of a backup, and carries nothing else.
  const ofPatch = value.kind === "schedule-pause" || value.kind === "schedule-resume";
  const ofDelete = value.kind === "delete-backup";

  if ((value.kind === "DownloadRequest" || ofSchedule || ofRestore || ofPatch || ofDelete) !== "target" in value)
    return;
  if (ofDelete && (value.target as WriteTarget | undefined)?.kind !== "Backup") return;
  if (!run && (value.kind === "schedule-resume") !== "resume" in value) return;
  const resume = "resume" in value ? readResume(value.resume) : undefined;

  if ("resume" in value && !resume) return;
  if (ofRestore !== "restore" in value) return;
  if (!run && ofRestore !== "restoreForm" in value) return;
  if (ofRestore && (value.target as WriteTarget | undefined)?.kind !== "Backup") return;
  if (ofRestore && (typeof value.restore !== "string" || restoreNameProblem(value.restore) !== undefined)) return;
  const restoreForm = "restoreForm" in value ? readRestoreForm(value.restoreForm) : undefined;

  if ("restoreForm" in value && !restoreForm) return;
  if ((value.kind === "DownloadRequest") !== "artifact" in value) return;
  if ((ofSchedule || ofForm) !== "backup" in value) return;
  if (newSchedule !== "schedule" in value) return;
  if (!run && (ofForm || newSchedule) !== "template" in value) return;
  if (!run && newSchedule !== "wrapper" in value) return;
  if (newSchedule && (typeof value.schedule !== "string" || scheduleNameProblem(value.schedule) !== undefined)) return;
  const wrapper = "wrapper" in value ? readWrapper(value.wrapper) : undefined;

  if ("wrapper" in value && !wrapper) return;
  if ("target" in value && ((value.target as WriteTarget).kind === "Schedule") !== (ofSchedule || ofPatch)) return;
  if ((ofSchedule || ofForm) && (typeof value.backup !== "string" || backupNameProblem(value.backup) !== undefined))
    return;
  const template = "template" in value ? readTemplate(value.template) : undefined;

  if ("template" in value && !template) return;
  // A schedule whose name a label does not take is asked for no backup, here as in the confirmation.
  if (ofSchedule && scheduleRefused((value.target as WriteTarget).name) !== undefined) return;
  // One of the eight artifacts, and of the kind of its target: the log of a restore is not asked of a
  // backup. The contents of a backup, and every other target of the API, are refused here.
  if ("artifact" in value) {
    if (!isArtifactTarget(value.artifact)) return;
    if (artifactKind(value.artifact) !== (value.target as WriteTarget).kind) return;
  }
  return {
    cluster: value.cluster,
    namespace: value.namespace,
    kind: value.kind,
    ...(value.target ? { target: { ...(value.target as WriteTarget) } } : {}),
    ...(isArtifactTarget(value.artifact) ? { artifact: value.artifact } : {}),
    ...(typeof value.backup === "string" ? { backup: value.backup } : {}),
    ...(template ? { template } : {}),
    ...(typeof value.schedule === "string" ? { schedule: value.schedule } : {}),
    ...(wrapper ? { wrapper } : {}),
    ...(typeof value.restore === "string" ? { restore: value.restore } : {}),
    ...(restoreForm ? { restoreForm } : {}),
    ...(resume ? { resume } : {}),
  };
}

// What a resume writes beside its tests: an expression within the bound the contract carries, and true or false.
function readResume(value: unknown): ResumeParameters | undefined {
  if (
    !isRecord(value) ||
    !hasKeys(value, ["expression", "skipImmediately"]) ||
    typeof value.expression !== "string" ||
    value.expression.length === 0 ||
    value.expression.length > EXPRESSION_CARRIED ||
    typeof value.skipImmediately !== "boolean"
  )
    return;
  return { expression: value.expression, skipImmediately: value.skipImmediately };
}

// What a schedule is after its pause or its resume, as the main process answers it.
export function readScheduleChanged(value: unknown): ScheduleChanged | undefined {
  if (
    !isRecord(value) ||
    !hasKeys(value, ["name", "uid", "paused"], ["skipImmediately", "lastSkipped", "found"]) ||
    !isName(value.name) ||
    !isText(value.uid) ||
    typeof value.paused !== "boolean"
  )
    return;
  if ("skipImmediately" in value && typeof value.skipImmediately !== "boolean") return;
  if ("lastSkipped" in value && !isText(value.lastSkipped, 64)) return;
  if ("found" in value && value.found !== true) return;
  return {
    name: value.name,
    uid: value.uid,
    paused: value.paused,
    ...(typeof value.skipImmediately === "boolean" ? { skipImmediately: value.skipImmediately } : {}),
    ...(typeof value.lastSkipped === "string" ? { lastSkipped: value.lastSkipped } : {}),
    ...(value.found === true ? { found: true } : {}),
  };
}

export function readWriteRunRequest(value: unknown): WriteRunRequest | undefined {
  if (
    !withinBound(value) ||
    !isRecord(value) ||
    !hasKeys(
      value,
      ["cluster", "namespace", "kind", "token", "request"],
      ["target", "artifact", "backup", "schedule", "restore", "typed"],
    )
  )
    return;
  // What is run is what was confirmed, with the token of its confirmation and the identifier of the request.
  const confirm = readWriteParameters(
    {
      cluster: value.cluster,
      namespace: value.namespace,
      kind: value.kind,
      ...("target" in value ? { target: value.target } : {}),
      ...("artifact" in value ? { artifact: value.artifact } : {}),
      ...("backup" in value ? { backup: value.backup } : {}),
      ...("schedule" in value ? { schedule: value.schedule } : {}),
      ...("restore" in value ? { restore: value.restore } : {}),
    },
    true,
  );

  if (!confirm || !isUuid(value.token) || !isUuid(value.request)) return;
  // A restore and a deletion run with the name of their backup as it was typed, and no other write carries one.
  if ((confirm.kind === "restore" || confirm.kind === "delete-backup") !== "typed" in value) return;
  if ("typed" in value && (typeof value.typed !== "string" || value.typed.length > 253)) return;
  return {
    ...confirm,
    ...(typeof value.typed === "string" ? { typed: value.typed } : {}),
    token: value.token,
    request: value.request,
  };
}

export function readWriteStatusRequest(value: unknown): WriteStatusRequest | undefined {
  if (!withinBound(value) || !isRecord(value) || !hasKeys(value, ["cluster", "request"])) return;
  if (!isCluster(value.cluster) || !isUuid(value.request)) return;
  return { cluster: value.cluster, request: value.request };
}

// What the operator allows, or takes back, for the cluster of the frame that asks.
export interface AllowanceRequest extends AllowanceFor {
  cluster: string;
}

export function readAllowanceRequest(value: unknown): AllowanceRequest | undefined {
  if (!withinBound(value) || !isRecord(value) || !isCluster(value.cluster)) return;
  const { cluster, ...rest } = value;
  const allowed = readAllowanceFor(rest);

  return allowed ? { cluster, ...allowed } : undefined;
}

export const readWriteCancelRequest = readWriteStatusRequest;
// The ends kept for the cluster of the frame, and the one a frame of it has shown.
export const readWriteEndsRequest = readGateStateRequest;
export const readWriteShownRequest = readWriteStatusRequest;
export const readArtifactReleaseRequest = readWriteStatusRequest;
// The text a view asks to save is named as the one it lets go: by its cluster and its request, and by
// nothing of a file, which the operator chooses in a dialog of the host.
export const readArtifactSaveRequest = readWriteStatusRequest;

// Whether the text was saved: the operator may close the dialog, and nothing is written then.
export interface ArtifactSaved {
  saved: boolean;
}

export function readArtifactSaved(value: unknown): ArtifactSaved | undefined {
  if (!isRecord(value) || !hasKeys(value, ["saved"]) || typeof value.saved !== "boolean") return;
  return { saved: value.saved };
}

// The name a text is saved under, for the artifact it is of: the one of its file in the store, as text.
const SAVED: Record<ArtifactTarget, (name: string) => string> = {
  BackupLog: (name) => `${name}-logs.txt`,
  BackupResults: (name) => `${name}-results.json`,
  BackupResourceList: (name) => `${name}-resource-list.json`,
  BackupVolumeInfos: (name) => `${name}-volumeinfo.json`,
  RestoreLog: (name) => `restore-${name}-logs.txt`,
  RestoreResults: (name) => `restore-${name}-results.json`,
  RestoreResourceList: (name) => `restore-${name}-resource-list.json`,
  RestoreVolumeInfo: (name) => `restore-${name}-volumeinfo.json`,
};

// The name of the file a dialog suggests. What is not a letter, a digit, a dot, a dash or an underscore
// is not written into it.
export function savedFileName(artifact: ArtifactTarget, name: string): string {
  return SAVED[artifact](name).replace(/[^A-Za-z0-9._-]/g, "_");
}

export function readArtifactPageRequest(value: unknown): ArtifactPageRequest | undefined {
  if (!withinBound(value) || !isRecord(value) || !hasKeys(value, ["cluster", "request", "page"])) return;
  if (!isCluster(value.cluster) || !isUuid(value.request)) return;
  if (!Number.isSafeInteger(value.page) || (value.page as number) < 0) return;
  return { cluster: value.cluster, request: value.request, page: value.page as number };
}

// The answers, read by the renderer: what is not an answer of the contract is a failure of the way. An
// answer is within the bound of a request, but for the page of a text, which is as large as a page is:
// `bounded` says that the reader of the value bounds it itself. A failure is bounded by its fields, each
// of which has a length, and by having no other.
export function readAnswer<Value>(
  value: unknown,
  readValue: (inner: unknown) => Value | undefined,
  bounded = false,
): Answer<Value> {
  const broken: Failure = {
    ok: false,
    code: "validation",
    stage: "answer",
    retry: false,
    text: "The main process answered with what the views do not understand.",
  };

  if (!isRecord(value) || typeof value.ok !== "boolean") return broken;
  if (!bounded && !withinBound(value)) return broken;
  if (value.ok) {
    if (!hasKeys(value, ["ok", "value"])) return broken;
    const read = readValue(value.value);

    return read === undefined ? broken : { ok: true, value: read };
  }
  if (
    !hasKeys(value, ["ok", "code", "stage", "retry", "text"], ["needs"]) ||
    !isText(value.code, 64) ||
    !isText(value.stage, 64) ||
    typeof value.retry !== "boolean" ||
    !isText(value.text, FAILURE_TEXT_BOUND)
  )
    return broken;
  const read: Failure = {
    ok: false,
    code: value.code as FailureCode,
    stage: value.stage,
    retry: value.retry,
    text: value.text,
  };

  if (!("needs" in value)) return read;
  // What the operator may allow is of the form an allowance has, or the failure is not one of the contract.
  const needs = readAllowanceFor(value.needs);

  return needs ? { ...read, needs } : broken;
}

export function readGateState(value: unknown): GateState | undefined {
  if (!isRecord(value) || !hasKeys(value, ["cluster", "writes"], ["connection"])) return;
  const cluster = value.cluster;
  const writes = value.writes;

  if (
    !isRecord(cluster) ||
    !hasKeys(cluster, ["id", "name", "context"]) ||
    !isCluster(cluster.id) ||
    !isText(cluster.name) ||
    !isText(cluster.context)
  )
    return;
  if (!isRecord(writes) || typeof writes.on !== "boolean") return;
  if (writes.on && (!hasKeys(writes, ["on", "namespace", "since"]) || !isNamespace(writes.namespace))) return;
  if (writes.on && (typeof writes.since !== "number" || !Number.isFinite(writes.since))) return;
  if (!writes.on && !hasKeys(writes, ["on"])) return;
  let connection: Connection | undefined;

  if ("connection" in value) {
    const read = readConnection(value.connection);

    if (!read) return;
    connection = read;
  }
  return {
    cluster: { id: cluster.id, name: cluster.name, context: cluster.context },
    writes: writes.on
      ? { on: true, namespace: writes.namespace as string, since: writes.since as number }
      : { on: false },
    ...(connection ? { connection } : {}),
  };
}

const REASONS: readonly string[] = CONNECTION_REASON_NAMES;

export function readConnection(value: unknown): Connection | undefined {
  if (!isRecord(value) || value.supported !== false) return;
  if (!hasKeys(value, ["supported", "reason"]) || !REASONS.includes(value.reason as string)) return;
  return { supported: false, reason: value.reason as ConnectionReason };
}

// The text of a body travels in the answer of its confirmation, which is within the bound of a request: written as
// JSON, with what it escapes, it leaves a kilobyte of the bound to the rest of the answer.
export const TEXT_BOUND = REQUEST_BOUND - 1024;

export function textWithinBound(text: string): boolean {
  return JSON.stringify(text).length <= TEXT_BOUND;
}

export function readWriteConfirmAnswer(value: unknown): WriteConfirmAnswer | undefined {
  if (!isRecord(value) || !hasKeys(value, ["token", "expires"], ["text"]) || !isUuid(value.token)) return;
  if (typeof value.expires !== "number" || !Number.isFinite(value.expires)) return;
  if ("text" in value && (typeof value.text !== "string" || !value.text || !textWithinBound(value.text))) return;
  return {
    token: value.token,
    expires: value.expires,
    ...(typeof value.text === "string" ? { text: value.text } : {}),
  };
}

export function readBackupCreated(value: unknown): BackupCreated | undefined {
  if (
    !isRecord(value) ||
    !hasKeys(value, ["name", "uid"], ["phase", "position", "errors", "errorsLeft", "found"]) ||
    !isName(value.name) ||
    !isText(value.uid)
  )
    return;
  if ("phase" in value && !isText(value.phase, PHASE_BOUND)) return;
  if ("position" in value && (!Number.isSafeInteger(value.position) || (value.position as number) < 1)) return;
  if (
    "errors" in value &&
    (!Array.isArray(value.errors) ||
      value.errors.length === 0 ||
      value.errors.length > ERRORS_BOUND.items ||
      !value.errors.every((error) => isText(error, ERRORS_BOUND.item)) ||
      (value.errors as string[]).reduce((total, error) => total + error.length, 0) > ERRORS_BOUND.total)
  )
    return;
  if ("errorsLeft" in value && (!Number.isSafeInteger(value.errorsLeft) || (value.errorsLeft as number) < 1)) return;
  if ("found" in value && value.found !== true) return;
  return {
    name: value.name,
    uid: value.uid,
    ...(typeof value.phase === "string" ? { phase: value.phase } : {}),
    ...(typeof value.position === "number" ? { position: value.position } : {}),
    ...(Array.isArray(value.errors) ? { errors: [...(value.errors as string[])] } : {}),
    ...(typeof value.errorsLeft === "number" ? { errorsLeft: value.errorsLeft } : {}),
    ...(value.found === true ? { found: true } : {}),
  };
}

export function readScheduleCreated(value: unknown): ScheduleCreated | undefined {
  if (
    !isRecord(value) ||
    !hasKeys(value, ["name", "uid"], ["phase", "errors", "errorsLeft", "paused", "found"]) ||
    !isName(value.name) ||
    !isText(value.uid)
  )
    return;
  if ("phase" in value && !isText(value.phase, PHASE_BOUND)) return;
  if (
    "errors" in value &&
    (!Array.isArray(value.errors) ||
      value.errors.length === 0 ||
      value.errors.length > ERRORS_BOUND.items ||
      !value.errors.every((error) => isText(error, ERRORS_BOUND.item)) ||
      (value.errors as string[]).reduce((total, error) => total + error.length, 0) > ERRORS_BOUND.total)
  )
    return;
  if ("errorsLeft" in value && (!Number.isSafeInteger(value.errorsLeft) || (value.errorsLeft as number) < 1)) return;
  if ("paused" in value && value.paused !== true) return;
  if ("found" in value && value.found !== true) return;
  return {
    name: value.name,
    uid: value.uid,
    ...(typeof value.phase === "string" ? { phase: value.phase } : {}),
    ...(Array.isArray(value.errors) ? { errors: [...(value.errors as string[])] } : {}),
    ...(typeof value.errorsLeft === "number" ? { errorsLeft: value.errorsLeft } : {}),
    ...(value.paused === true ? { paused: true } : {}),
    ...(value.found === true ? { found: true } : {}),
  };
}

export function readRestoreCreated(value: unknown): RestoreCreated | undefined {
  if (
    !isRecord(value) ||
    !hasKeys(value, ["name", "uid"], ["phase", "errors", "errorsLeft", "found"]) ||
    !isName(value.name) ||
    !isText(value.uid)
  )
    return;
  if ("phase" in value && !isText(value.phase, PHASE_BOUND)) return;
  if (
    "errors" in value &&
    (!Array.isArray(value.errors) ||
      value.errors.length === 0 ||
      value.errors.length > ERRORS_BOUND.items ||
      !value.errors.every((error) => isText(error, ERRORS_BOUND.item)) ||
      (value.errors as string[]).reduce((total, error) => total + error.length, 0) > ERRORS_BOUND.total)
  )
    return;
  if ("errorsLeft" in value && (!Number.isSafeInteger(value.errorsLeft) || (value.errorsLeft as number) < 1)) return;
  if ("found" in value && value.found !== true) return;
  return {
    name: value.name,
    uid: value.uid,
    ...(typeof value.phase === "string" ? { phase: value.phase } : {}),
    ...(Array.isArray(value.errors) ? { errors: [...(value.errors as string[])] } : {}),
    ...(typeof value.errorsLeft === "number" ? { errorsLeft: value.errorsLeft } : {}),
    ...(value.found === true ? { found: true } : {}),
  };
}

// What a deletion is once its request was created, as the main process answers it.
export function readBackupDeleted(value: unknown): BackupDeleted | undefined {
  if (
    !isRecord(value) ||
    !hasKeys(value, ["end"], ["request", "phase", "errors", "errorsLeft", "found", "requestsUnread"]) ||
    !(DELETION_ENDS as readonly unknown[]).includes(value.end)
  )
    return;
  if ("request" in value && !isName(value.request)) return;
  if ("phase" in value && !isText(value.phase, PHASE_BOUND)) return;
  if (
    "errors" in value &&
    (!Array.isArray(value.errors) ||
      value.errors.length === 0 ||
      value.errors.length > ERRORS_BOUND.items ||
      !value.errors.every((error) => isText(error, ERRORS_BOUND.item)) ||
      (value.errors as string[]).reduce((total, error) => total + error.length, 0) > ERRORS_BOUND.total)
  )
    return;
  if ("errorsLeft" in value && (!Number.isSafeInteger(value.errorsLeft) || (value.errorsLeft as number) < 1)) return;
  if ("found" in value && value.found !== true) return;
  if ("requestsUnread" in value && value.requestsUnread !== true) return;
  return {
    end: value.end as DeletionEnd,
    ...(typeof value.request === "string" ? { request: value.request } : {}),
    ...(typeof value.phase === "string" ? { phase: value.phase } : {}),
    ...(Array.isArray(value.errors) ? { errors: [...(value.errors as string[])] } : {}),
    ...(typeof value.errorsLeft === "number" ? { errorsLeft: value.errorsLeft } : {}),
    ...(value.found === true ? { found: true } : {}),
    ...(value.requestsUnread === true ? { requestsUnread: true } : {}),
  };
}

function readKeptOutcome(value: unknown): KeptOutcome | undefined {
  if (!isRecord(value) || typeof value.created !== "boolean") return;
  if (value.created) {
    if (!hasKeys(value, ["created"], ["phase", "found", "paused", "deletion"])) return;
    if ("phase" in value && !isText(value.phase, PHASE_BOUND)) return;
    if ("found" in value && value.found !== true) return;
    if ("paused" in value && value.paused !== true) return;
    if ("deletion" in value && !(DELETION_ENDS as readonly unknown[]).includes(value.deletion)) return;
    return {
      created: true,
      ...(typeof value.phase === "string" ? { phase: value.phase } : {}),
      ...(value.found === true ? { found: true } : {}),
      ...(value.paused === true ? { paused: true } : {}),
      ...("deletion" in value ? { deletion: value.deletion as DeletionEnd } : {}),
    };
  }
  if (
    !hasKeys(value, ["created", "code", "text"]) ||
    !isText(value.code, 64) ||
    !isText(value.text, FAILURE_TEXT_BOUND)
  )
    return;
  return { created: false, code: value.code as FailureCode, text: value.text };
}

// The ends of a cluster, each read on its own: one the views cannot read is left out, and hides none of the others.
// One request is one end, the last.
export function readKeptEnds(value: unknown): KeptEnd[] | undefined {
  if (!Array.isArray(value) || value.length > KEPT_ENDS_BOUND) return;
  const ends = new Map<string, KeptEnd>();

  for (const item of value) {
    if (
      !isRecord(item) ||
      !hasKeys(item, ["request", "kind", "namespace", "context", "name", "outcome", "at"], ["schedule", "backup"]) ||
      !isUuid(item.request) ||
      (item.kind !== "backup-from-schedule" &&
        item.kind !== "backup" &&
        item.kind !== "schedule" &&
        item.kind !== "restore" &&
        item.kind !== "schedule-pause" &&
        item.kind !== "schedule-resume" &&
        item.kind !== "delete-backup") ||
      // A backup asked from a schedule names it, and one of the form names none; a restore names its backup.
      (item.kind === "backup-from-schedule") !== "schedule" in item ||
      ("schedule" in item && !isName(item.schedule)) ||
      (item.kind === "restore") !== "backup" in item ||
      ("backup" in item && !isName(item.backup)) ||
      !isNamespace(item.namespace) ||
      !isText(item.context) ||
      !isName(item.name) ||
      typeof item.at !== "number" ||
      !Number.isFinite(item.at)
    )
      continue;
    const outcome = readKeptOutcome(item.outcome);

    if (!outcome) continue;
    // A patch applied says nothing more of what was patched than whether it was read so after an answer that was lost:
    // the kind says it.
    if (
      (item.kind === "schedule-pause" || item.kind === "schedule-resume") &&
      outcome.created &&
      ("phase" in outcome || "paused" in outcome)
    )
      continue;
    // The request of a deletion is created whatever comes of it: what the reads after it showed is said, and nothing of a
    // creation; an end of another kind says no deletion.
    if (outcome.created && (item.kind === "delete-backup") !== "deletion" in outcome) continue;
    if (item.kind === "delete-backup" && outcome.created && ("phase" in outcome || "paused" in outcome)) continue;
    ends.delete(item.request);
    ends.set(item.request, {
      request: item.request,
      kind: item.kind,
      namespace: item.namespace,
      context: item.context,
      name: item.name,
      ...(typeof item.schedule === "string" ? { schedule: item.schedule } : {}),
      ...(typeof item.backup === "string" ? { backup: item.backup } : {}),
      outcome,
      at: item.at,
    });
  }
  return [...ends.values()];
}

export function readWriteStatus(value: unknown): WriteStatus | undefined {
  if (!isRecord(value) || !hasKeys(value, ["step"], ["count"]) || !isText(value.step, 64)) return;
  if ("count" in value && (typeof value.count !== "number" || !Number.isFinite(value.count))) return;
  return { step: value.step, ...(typeof value.count === "number" ? { count: value.count } : {}) };
}

const ORIGIN = /^https?:\/\/[^/?#@\s]{1,253}$/;

export function readArtifactValue(value: unknown): ArtifactValue | undefined {
  if (!isRecord(value) || !hasKeys(value, ["request", "size", "pages", "route"])) return;
  const request = value.request;
  const route = value.route;

  if (!isRecord(request) || !hasKeys(request, ["name", "uid"]) || !isName(request.name) || !isText(request.uid)) return;
  if (!Number.isSafeInteger(value.size) || (value.size as number) < 0) return;
  if (!Number.isSafeInteger(value.pages) || (value.pages as number) < 0) return;
  if (!isRecord(route) || !hasKeys(route, ["mode", "encrypted", "origin"])) return;
  if (route.mode !== "tunnel" && route.mode !== "direct") return;
  // The origin of the store and nothing after it: no path, no query, no user.
  if (typeof route.encrypted !== "boolean" || typeof route.origin !== "string" || !ORIGIN.test(route.origin)) return;
  return {
    request: { name: request.name, uid: request.uid },
    size: value.size as number,
    pages: value.pages as number,
    route: { mode: route.mode, encrypted: route.encrypted, origin: route.origin },
  };
}

// A page of the text of an artifact: as large as a page is, and no larger.
export function readArtifactPage(value: unknown): ArtifactPage | undefined {
  if (!isRecord(value) || !hasKeys(value, ["page", "pages", "text"])) return;
  if (!Number.isSafeInteger(value.page) || !Number.isSafeInteger(value.pages)) return;
  if ((value.page as number) < 0 || (value.page as number) >= (value.pages as number)) return;
  // The text of a page of bytes has no more units than the page has bytes.
  if (typeof value.text !== "string" || value.text.length > PAGE_BOUND) return;
  return { page: value.page as number, pages: value.pages as number, text: value.text };
}

export function readServerStatusValue(value: unknown): ServerStatusValue | undefined {
  if (!isRecord(value) || !hasKeys(value, ["version", "processed", "plugins", "request"])) return;
  if (!isText(value.version, 256) || !isText(value.processed, 64) || !Array.isArray(value.plugins)) return;
  const request = value.request;

  if (!isRecord(request) || !hasKeys(request, ["name", "uid"]) || !isName(request.name) || !isText(request.uid)) return;
  const plugins: { name: string; kind: string }[] = [];

  for (const plugin of value.plugins) {
    if (!isRecord(plugin) || !hasKeys(plugin, ["name", "kind"]) || !isText(plugin.name) || !isText(plugin.kind)) return;
    plugins.push({ name: plugin.name, kind: plugin.kind });
  }
  return {
    version: value.version,
    processed: value.processed,
    plugins,
    request: { name: request.name, uid: request.uid },
  };
}

// A failure, with the words of its code where the caller has none of its own.
export function failure(code: FailureCode, stage: string, retry: boolean, text: string): Failure {
  return { ok: false, code, stage, retry, text };
}

export const PROBLEMS_WORDS = {
  more: (count: number) => `And ${count} more.`,
  unsaid: (count: number) =>
    count === 1 ? "A problem too long to be said here." : `${count} problems too long to be said here.`,
};

// Problems said after the words that lead them, each a sentence that ends with its full stop, as many as the text of a
// failure carries, in their order, and how many more there are: a longer text is not one the views take, and would say
// nothing at all.
export function saidProblems(lead: string, problems: readonly string[]): string {
  const room = FAILURE_TEXT_BOUND - lead.length - ` ${PROBLEMS_WORDS.more(problems.length)}`.length;
  const said: string[] = [];
  let length = 0;

  for (const problem of problems) {
    const sentence = /[.!?]$/.test(problem) ? problem : `${problem}.`;
    const added = (said.length > 0 ? 1 : 0) + sentence.length;

    if (length + added > room) continue;
    said.push(sentence);
    length += added;
  }
  const unsaid = problems.length - said.length;

  if (said.length === 0) return `${lead}${PROBLEMS_WORDS.unsaid(unsaid)}`;
  return `${lead}${said.join(" ")}${unsaid > 0 ? ` ${PROBLEMS_WORDS.more(unsaid)}` : ""}`;
}
