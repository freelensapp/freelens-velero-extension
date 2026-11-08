// The creation of an object whose text a confirmation kept, the same for every kind an action creates by the name its
// review gave it (SPEC-0017, REQ-248 to REQ-250; SPEC-0016, REQ-228, REQ-238, REQ-243): the POST of that text, once;
// the reads after it, every second for thirty seconds at most, until Velero writes a phase of the object created, by
// its UID, or once for an object Velero does not read; and, when the answer of the POST is not known, a look for the
// object by its name, which never sends it again. Every end of a request that was sent is kept for the cluster.

import {
  type Answer,
  type BackupCreated,
  failure,
  PHASE_BOUND,
  type RestoreCreated,
  type ScheduleChanged,
  type ScheduleCreated,
  type WriteRunRequest,
} from "../common/ipc";
import { DiagnosticError } from "./diagnostic-transport";

import type { DiagnosticKubernetes, DiagnosticObject } from "./diagnostic-kubernetes";
import type { Write, WriteGate } from "./write-gate";

// How long after its creation the object is read for the phase Velero writes, and how often (SPEC-0017, REQ-248).
export const READ_AFTER = { everyMs: 1000, forMs: 30_000 };
// The margin of the clocks within which an object found by its name is taken for the one created (SPEC-0016).
export const CREATION_MARGIN = 60_000;

// What a creation answers once the object was created.
export type Created = BackupCreated | ScheduleCreated | RestoreCreated;
// What a write of an action answers once it was done: an object created, or a schedule paused or resumed.
export type Done = Created | ScheduleChanged;

// What the main process gives the procedures of the writes that create.
export interface CreationDependencies {
  gate: WriteGate<DiagnosticKubernetes>;
  now(): number;
  // Waits, or ends with the signal.
  sleep(milliseconds: number, signal: AbortSignal): Promise<void>;
  // Keeps the end of a run whose request was sent, for the cluster, until a frame of it has shown it (REQ-250), with
  // the context of the entry the request was sent to.
  keep?(request: WriteRunRequest, end: Answer<Done>, context: string): void;
}

// What differs from one kind to another: what is created and how, the words of its ends, what tells it from another
// object of its name, and what its answer says.
export interface Creation<Value extends Created> {
  kind: "Backup" | "Schedule" | "Restore";
  // The word the steps of the write say it with.
  noun: string;
  // The name the text gives it.
  name: string;
  // The POST of the text, through the method of the adapter that creates this kind.
  create(
    adapter: DiagnosticKubernetes,
    namespace: string,
    text: string,
    signal: AbortSignal,
  ): Promise<DiagnosticObject>;
  // The end of a POST that failed, in the words of the write.
  endOf(error: unknown): Answer<never>;
  // Whether an object found by its name, created since a minute before the confirmation, is the one created.
  same(found: DiagnosticObject): boolean;
  // Whether it is read once after its creation, and not until Velero writes its phase: Velero does not read it.
  once?: boolean;
  // What the answer says of the object last read.
  value(read: DiagnosticObject, phase: string | undefined, found: boolean): Value;
  words: {
    cancelled: string;
    frameGone: string;
    frameGoneAfter: string;
    // An answer that was lost, and no object of the name.
    notDone: string;
    // An answer that was lost or is not of the object, and a read that does not say whether it is there.
    unknown: string;
  };
  // An answer that was lost, and an object of the name that is not known to be this one.
  other: Answer<never>;
}

// Whether a creation that failed reached the API server: what the adapter refused to send, a cluster that changed
// before anything was sent and a client of the host that could not be had did not. A request that left and got no
// answer is not known, and is looked for.
export function sent(error: unknown): boolean {
  if (!(error instanceof DiagnosticError)) return true;
  if (error.code === "validation") return error.verdict === "refused";
  if (error.code === "target-changed") return error.verdict === "answered";
  return error.code !== "transport-unreachable";
}

// The phase Velero wrote, when it is one: a longer word is none the release writes, and is not carried.
export function phaseOf(object: DiagnosticObject): string | undefined {
  const phase = (object as { status?: { phase?: unknown } }).status?.phase;

  return typeof phase === "string" && phase && phase.length <= PHASE_BOUND ? phase : undefined;
}

// A value written with its keys in one order, whatever order a writer gave them.
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`)
      .join(",")}}`;
  return JSON.stringify(value) ?? "undefined";
}

// The reads after the creation: every second for thirty seconds at most, a read that hangs included, until Velero
// writes a phase of the object that was created, by its UID; or once, for an object Velero does not read. What is read
// is what is answered; a phase not written yet is none.
async function readAfter<Value extends Created>(
  creation: Creation<Value>,
  dependencies: CreationDependencies,
  adapter: DiagnosticKubernetes,
  namespace: string,
  created: DiagnosticObject,
  signal: AbortSignal,
  write: Write,
  found: boolean,
): Promise<Answer<Value>> {
  const uid = created.metadata.uid;
  let phase = phaseOf(created);
  let last = created;
  const until = dependencies.now() + READ_AFTER.forMs;
  const readOnce = async (): Promise<boolean> => {
    try {
      // A read that does not answer ends with the thirty seconds.
      const bounded = AbortSignal.any([signal, AbortSignal.timeout(Math.max(until - dependencies.now(), 1))]);
      const read = await adapter.read(creation.kind, namespace, created.metadata.name, bounded);

      // Another object of that name is not the one created: nothing more is read of it.
      if (read.metadata.uid !== uid) return false;
      last = read;
      phase = phaseOf(read);
      return true;
    } catch {
      return false;
    }
  };

  write.status = { step: creation.once ? `reading the ${creation.noun}` : "waiting for Velero" };
  if (creation.once) {
    if (!signal.aborted) await readOnce();
  } else {
    while (!phase && !signal.aborted && until - dependencies.now() >= READ_AFTER.everyMs) {
      try {
        await dependencies.sleep(READ_AFTER.everyMs, signal);
      } catch {
        break;
      }
      if (!(await readOnce())) break;
    }
  }
  return { ok: true, value: creation.value(last, phase, found) };
}

// A creation whose answer is not known: the object is read by its name, and is the one created when its creation is
// not earlier than a minute before the confirmation and the rule of its kind takes it; another one of that name is not
// known to be this one, and was not changed.
async function reconcile<Value extends Created>(
  creation: Creation<Value>,
  dependencies: CreationDependencies,
  adapter: DiagnosticKubernetes,
  namespace: string,
  confirmedAt: number,
  signal: AbortSignal,
  write: Write,
): Promise<Answer<Value>> {
  write.status = { step: `looking for the ${creation.noun}` };
  let found: DiagnosticObject;

  try {
    found = await adapter.read(creation.kind, namespace, creation.name, signal);
  } catch (error) {
    if (error instanceof DiagnosticError && error.code === "not-found")
      return failure("submission-unknown", "creation", false, creation.words.notDone);
    return failure("submission-unknown", "creation", false, creation.words.unknown);
  }
  const created = Date.parse(String((found.metadata as { creationTimestamp?: unknown }).creationTimestamp));

  if (!Number.isFinite(created) || created < confirmedAt - CREATION_MARGIN || !creation.same(found))
    return creation.other;
  return readAfter(creation, dependencies, adapter, namespace, found, signal, write, true);
}

// The creation of an object whose text the confirmation kept, once what it depends on was read again: the POST of
// that text, the reads after it, and, when its answer is not known, the look for the object by its name. Every end of
// a request that was sent is kept for the cluster.
export async function createKept<Value extends Created>(
  creation: Creation<Value>,
  dependencies: CreationDependencies,
  adapter: DiagnosticKubernetes,
  request: WriteRunRequest,
  text: string,
  confirmedAt: number,
  write: Write,
  still: () => boolean,
): Promise<Answer<Value>> {
  const signal = write.controller.signal;

  // A frame that went, or a write stopped, before anything was sent leaves nothing to look for: the frame is looked at
  // here, and not only at the tick of its watch.
  if (signal.aborted) return failure("cancelled", "creation", true, creation.words.cancelled);
  if (!still()) return failure("forbidden", "frame", false, creation.words.frameGone);
  write.status = { step: `creating the ${creation.noun}` };
  // Every end of a request that was sent is kept for the cluster, and is answered to the frame that asked when it is
  // still there: it says it showed the end, or the target bar of the cluster shows it.
  const ended = (end: Answer<Value>): Answer<Value> => {
    // What keeps the end does not end the run otherwise.
    try {
      dependencies.keep?.(request, end, adapter.binding?.contextName ?? "");
    } catch {
      /* the end is answered all the same */
    }
    return still() ? end : failure("forbidden", "frame", false, creation.words.frameGoneAfter);
  };
  let created: DiagnosticObject;

  try {
    created = await creation.create(adapter, request.namespace, text, signal);
  } catch (error) {
    // No answer, or one dropped on this side once the request had left: the object may be there. It is looked for,
    // with reads of their own, which the frame that went does not stop.
    if (error instanceof DiagnosticError && (error.code === "submission-unknown" || error.code === "cancelled"))
      return ended(
        await reconcile(
          creation,
          dependencies,
          adapter,
          request.namespace,
          confirmedAt,
          new AbortController().signal,
          write,
        ),
      );
    const end = creation.endOf(error);

    return sent(error) ? ended(end) : end;
  }
  if (created.metadata.name !== creation.name || !created.metadata.uid)
    return ended(failure("submission-unknown", "creation", false, creation.words.unknown));
  return ended(await readAfter(creation, dependencies, adapter, request.namespace, created, signal, write, false));
}
