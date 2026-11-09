import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { isDeepStrictEqual } from "node:util";
import {
  compiledDiagnostics,
  type DownloadProofContext,
  proofAdapter,
  proofEntry,
  proofProcedures,
} from "./local-download-proof.mts";
import { FIXTURE_LABEL, fixtureNames } from "./local-fixtures.mts";
import { startProofHost } from "./local-host.mts";
import { DEMO_CONTEXT, DEMO_NAMESPACE, OWNER_LABEL, requireCondition } from "./local-kind.mts";

import type { BackupDeleted, WriteConfirmAnswer } from "../../src/common/ipc.ts";

type ProofContext = Pick<DownloadProofContext, "owner" | "run" | "kubeconfig" | "shell" | "assertCurrent">;

// The phases a backup ends in, in the release.
const ENDED = ["Completed", "PartiallyFailed", "Failed", "FailedValidation"];
// How long the server is given to end a backup of the proof, to delete it, and a location to be Available.
const WITHIN = 5 * 60 * 1000;
// What a read of kubectl may answer.
const OUTPUT_BOUND = 64 * 1024 * 1024;
// The resources the proof reads and removes.
const BACKUPS = "backups.velero.io";
const REQUESTS = "deletebackuprequests.velero.io";
// The labels of a request that name its backup, as the release writes them.
const BACKUP_NAME_LABEL = "velero.io/backup-name";
const BACKUP_UID_LABEL = "velero.io/backup-uid";
// The thirty seconds the run reads the request and the backup for after the creation (REQ-282), and what of them the
// run may not have used when it answered at their end: the read of the backup and the creation come before them.
const READ_WINDOW = 30_000;
const WINDOW_MARGIN = 5_000;
// How long after the main process read the backup gone the run says so at most: a read of the run every second, its
// two reads, and room for a loaded machine.
const SAID_WITHIN = 10_000;
// What the server writes of a backup the store did not keep: a write of the store that failed, or an answer of 5xx.
const STORE_FAILED = /error putting object|StatusCode: 5\d\d/;
// How long the store is given before the backup is made again.
const STORE_SETTLES = 30_000;

interface Read {
  metadata: { name: string; uid: string; creationTimestamp?: string; labels?: Record<string, string> };
  spec?: Record<string, unknown>;
  status?: { phase?: string; errors?: string[]; validationErrors?: string[]; failureReason?: string };
}

// The kubectl of the environment, for what the proof reads of the cluster beside the procedures, for the backups it
// makes, and for the removal of what Velero did not delete: the cluster of the environment checked before each call,
// and its cache in the private state.
function kubectl(
  context: ProofContext,
  args: string[],
  input?: string,
): { ok: boolean; out: string; missing: boolean; error: string } {
  const shell = context.shell;

  requireCondition(shell, "The proof of a deletion needs the kubectl of the environment");
  context.assertCurrent();
  const { status, stdout, stderr, error } = spawnSync(
    shell.kubectl,
    ["--kubeconfig", context.kubeconfig, "--context", DEMO_CONTEXT, ...args],
    {
      encoding: "utf8",
      env: { ...shell.environment, KUBECACHEDIR: join(shell.cache, "kubectl") },
      cwd: shell.cwd,
      timeout: 60_000,
      maxBuffer: OUTPUT_BOUND,
      ...(input ? { input } : {}),
    },
  );

  return {
    ok: status === 0,
    out: stdout ?? "",
    missing: /\(NotFound\)/.test(stderr ?? ""),
    error: (stderr ?? "").trim().split("\n").slice(-1)[0] || (error?.message ?? ""),
  };
}

// An object of the namespace of the installation by its name, or nothing when it is not there.
function readOf(context: ProofContext, resource: string, name: string): Read | undefined {
  const answer = kubectl(context, ["get", resource, name, "-n", DEMO_NAMESPACE, "-o", "json"]);

  if (!answer.ok) {
    requireCondition(answer.missing, `kubectl get ${resource} ${name} failed: ${answer.error}`);
    return undefined;
  }
  return JSON.parse(answer.out) as Read;
}

// Whether an object is there: a read that fails is not taken for one that finds nothing.
function there(context: ProofContext, resource: string, name: string): boolean {
  try {
    return readOf(context, resource, name) !== undefined;
  } catch {
    return true;
  }
}

// The requests to delete a backup, from the requests of the namespace whole: each one that names the backup in its
// spec, or carries the label of its UID. The labels the extension writes are not what finds them.
function requestsOf(context: ProofContext, backup: { name: string; uid?: string }): Read[] {
  const answer = kubectl(context, ["get", REQUESTS, "-n", DEMO_NAMESPACE, "-o", "json"]);

  requireCondition(answer.ok, `The requests to delete a backup could not be listed: ${answer.error}`);
  return (JSON.parse(answer.out) as { items: Read[] }).items.filter(
    (item) =>
      item.spec?.backupName === backup.name ||
      (backup.uid !== undefined && item.metadata.labels?.[BACKUP_UID_LABEL] === backup.uid),
  );
}

// What a request says of itself, for a failure.
function stateOf(requests: Read[]): string {
  return JSON.stringify(
    requests.map((item) => [item.metadata.name, item.status?.phase ?? "no phase", item.status?.errors ?? []]),
  );
}

// What a backup says of its end, for a failure: its phase, its validation errors and the reason it failed.
function endOf(read: Read | undefined): string {
  if (!read) return "gone";
  const { phase, validationErrors, failureReason } = read.status ?? {};

  return [phase ?? "without a phase", JSON.stringify(validationErrors ?? []), failureReason ?? ""].join(", ");
}

// Removes an object by its path with its UID as the precondition, one at a time, and waits until it is gone.
async function remove(context: ProofContext, path: string, uid: string, gone: () => boolean): Promise<boolean> {
  const answer = kubectl(
    context,
    ["delete", "--raw", path, "-f", "-"],
    JSON.stringify({ apiVersion: "v1", kind: "DeleteOptions", preconditions: { uid } }),
  );

  if (!answer.ok && !answer.missing) return false;
  for (const until = Date.now() + WITHIN; Date.now() < until; await delay(2000)) if (gone()) return true;
  return false;
}

// A backup of the ConfigMaps of the run, made for the proof with the labels of the environment, in the storage
// location it names. The proof makes it with kubectl, as the cluster of the environment would hold one: what it proves
// is the deletion.
function backupOf(context: ProofContext, name: string, location: string): Read {
  const names = fixtureNames(context.run);
  const answer = kubectl(
    context,
    ["create", "-f", "-", "-o", "json"],
    JSON.stringify({
      apiVersion: "velero.io/v1",
      kind: "Backup",
      metadata: {
        name,
        namespace: DEMO_NAMESPACE,
        labels: { [OWNER_LABEL]: context.owner, [FIXTURE_LABEL]: context.run },
      },
      spec: {
        includedNamespaces: [names.source],
        includedResources: ["configmaps"],
        labelSelector: { matchLabels: { [FIXTURE_LABEL]: context.run } },
        storageLocation: location,
        snapshotVolumes: false,
        ttl: "1h0m0s",
      },
    }),
  );

  requireCondition(answer.ok, `The backup ${name} of the proof could not be created: ${answer.error}`);
  return JSON.parse(answer.out) as Read;
}

// A backup read every two seconds until it ended or is gone, for five minutes at most: what was read last.
async function endedOf(context: ProofContext, name: string): Promise<Read | undefined> {
  let read = readOf(context, BACKUPS, name);

  for (const until = Date.now() + WITHIN; read && !ENDED.includes(read.status?.phase ?? "") && Date.now() < until; ) {
    await delay(2000);
    read = readOf(context, BACKUPS, name);
  }
  return read;
}

// A storage location read every two seconds until it is Available, for five minutes at most: the server deletes no
// backup of a location that is not, and refuses its request.
async function availableOf(context: ProofContext, name: string): Promise<void> {
  let read = readOf(context, "backupstoragelocations.velero.io", name);

  for (const until = Date.now() + WITHIN; read?.status?.phase !== "Available" && Date.now() < until; ) {
    await delay(2000);
    read = readOf(context, "backupstoragelocations.velero.io", name);
  }
  requireCondition(
    read?.status?.phase === "Available",
    `The storage location ${name} is ${read ? (read.status?.phase ?? "without a phase") : "not there"}: the server deletes no backup of a location that is not Available`,
  );
}

function seconds(milliseconds: number): string {
  return `${Math.round(milliseconds / 1000)} s`;
}

// The deletion of a backup, end to end (SPEC-0017, REQ-279 to REQ-282, DELETE-05): the procedures of the compiled main
// process, called as a frame calls them, with the server of the release running. A backup of the ConfigMaps of the
// run, Completed, is deleted with the name of the backup typed: the review is the request the release makes for that
// backup, with no other request of it, and the run says completed once its reads show the backup gone, or a deletion
// the server is at, or has not read, only when it used its thirty seconds before the server deleted the backup; the
// backup is then gone, and so is its request, which the server deletes with it. A backup of a storage location that is
// not there, FailedValidation, is deleted the same way: the server refuses the request with the one error of a refusal,
// the request it refused is the one the run created, and the backup keeps its phase. The proof removes what Velero did
// not delete, the backup it refused and its request first, whatever ended it, and says what it could not remove.
export async function runDeleteBackupProof(
  context: ProofContext,
): Promise<{ completed: string; refused: string; removed: boolean }> {
  const main = await compiledDiagnostics();
  const host = await startProofHost(context.kubeconfig, DEMO_CONTEXT, context.shell);
  const api = proofAdapter(main, proofEntry(context.owner, context.kubeconfig), host, context.assertCurrent, {
    [OWNER_LABEL]: context.owner,
    [FIXTURE_LABEL]: context.run,
  });
  const { cluster, call, enable, release } = proofProcedures(main, context, context.kubeconfig, host, {});
  const controller = new AbortController();
  const deletedName = `proof-delete-${context.run}`;
  // The name of the backup made again when the store did not keep the first one.
  const againName = `proof-delete-again-${context.run}`;
  const refusedName = `proof-refused-${context.run}`;
  const missing = `proof-missing-${context.run}`;
  // A minute before the proof began, for the clocks.
  const began = Date.now() - 60_000;
  // The names of the two backups, each seen absent before its creation, and the UID its creation answered.
  const absent = new Set<string>();
  const made = new Map<string, string>();

  // A backup of one of the names of the proof is one it made: the one its creation answered, or, when that answer was
  // lost, one of a name seen absent before the creation that carries the label of the run and was created since the
  // proof began.
  const ours = (read: Read) => {
    const uid = made.get(read.metadata.name);

    return uid !== undefined
      ? read.metadata.uid === uid
      : absent.has(read.metadata.name) &&
          read.metadata.labels?.[FIXTURE_LABEL] === context.run &&
          Date.parse(read.metadata.creationTimestamp ?? "") >= began;
  };
  // A backup made for the proof, once its name was seen absent.
  const make = (name: string, location: string) => {
    requireCondition(!readOf(context, BACKUPS, name), `The backup ${name} is there before the proof`);
    absent.add(name);
    const created = backupOf(context, name, location);

    made.set(name, created.metadata.uid);
    return created;
  };
  // The backup read through the main process, as the run reads it: nothing once it is gone, or replaced by another one.
  const readThroughMain = async (backup: { name: string; uid: string }): Promise<boolean> => {
    try {
      const read = await api.read("Backup", DEMO_NAMESPACE, backup.name, controller.signal);

      return read.metadata.uid === backup.uid;
    } catch (error) {
      if ((error as { code?: string }).code === "not-found") return false;
      throw error;
    }
  };

  // The deletion of a backup through the procedures, with its name typed: the review is the request the release makes
  // for that backup, with no other request of it, and the answer of the run is what the reads after the creation
  // showed, with how long the run took and when the main process first read the backup gone while it ran.
  const deletion = async (backup: { name: string; uid: string }) => {
    const target = { kind: "Backup", name: backup.name, uid: backup.uid };
    const confirmed = await call<WriteConfirmAnswer>("write.confirm", {
      cluster,
      namespace: DEMO_NAMESPACE,
      kind: "delete-backup",
      target,
    });
    const text = JSON.parse(confirmed.text ?? "{}") as {
      apiVersion?: string;
      kind?: string;
      metadata?: Record<string, unknown>;
      spec?: unknown;
    };

    requireCondition(
      confirmed.text === main.deleteRequestText(main.deleteRequestOf(DEMO_NAMESPACE, backup)),
      `The review of the deletion of ${backup.name} is not the request of that backup`,
    );
    // The request as the release writes it for `velero backup delete`, written here and not taken from the builder: a
    // name generated from the name of the backup, the two labels of the backup, whose names are shorter than 64
    // characters, and no other, and the name of the backup in the spec.
    requireCondition(
      text.apiVersion === "velero.io/v1" &&
        text.kind === "DeleteBackupRequest" &&
        isDeepStrictEqual(Object.keys(text.metadata ?? {}).sort(), ["generateName", "labels", "namespace"]) &&
        text.metadata?.generateName === `${backup.name}-` &&
        text.metadata?.namespace === DEMO_NAMESPACE &&
        isDeepStrictEqual(text.metadata?.labels, {
          [BACKUP_NAME_LABEL]: backup.name,
          [BACKUP_UID_LABEL]: backup.uid,
        }) &&
        isDeepStrictEqual(text.spec, { backupName: backup.name }),
      `The review of the deletion of ${backup.name} is not the request the release makes for it`,
    );
    // No other request of a backup of its name: counted by the main process, or, when it could not read them, by the
    // proof.
    requireCondition(
      confirmed.others === 0 || (confirmed.others === undefined && requestsOf(context, backup).length === 0),
      `The review of ${backup.name} counted ${confirmed.others ?? "no"} other requests`,
    );
    let goneAt: number | undefined;
    let running = true;
    const watched = (async () => {
      for (; running && goneAt === undefined; await delay(1000)) {
        try {
          if (!(await readThroughMain(backup))) goneAt = Date.now();
        } catch {
          // A read that fails says nothing of the backup.
        }
      }
    })();
    const asked = Date.now();
    const deleted = await call<BackupDeleted>("write.run", {
      cluster,
      namespace: DEMO_NAMESPACE,
      kind: "delete-backup",
      target,
      typed: backup.name,
      token: confirmed.token,
      request: randomUUID(),
    }).finally(() => {
      running = false;
    });
    const answered = Date.now();

    await watched;
    return { deleted, took: answered - asked, goneBefore: goneAt === undefined ? undefined : answered - goneAt };
  };
  // A backup of the default location deleted through the request of the action, once it ended, since the release
  // deletes no backup in progress, and is Deleting while it deletes one: whether the server deleted it in its time.
  const deleteThroughServer = async (backup: { name: string; uid: string }): Promise<boolean> => {
    const ended = await endedOf(context, backup.name);

    if (!ended || ended.metadata.uid !== backup.uid) return true;
    if (!ENDED.includes(ended.status?.phase ?? "") && ended.status?.phase !== "Deleting") return false;
    await api.createDeleteBackupRequest(
      DEMO_NAMESPACE,
      main.deleteRequestText(main.deleteRequestOf(DEMO_NAMESPACE, backup)),
      controller.signal,
    );
    for (const until = Date.now() + WITHIN; Date.now() < until; await delay(2000))
      if (!there(context, BACKUPS, backup.name)) return true;
    return false;
  };
  // What the proof made under one of its names, whatever ended it: the backup, when it is one the proof made, and every
  // request of it, each by its path with its UID as the precondition. A backup of the location that is not there holds
  // nothing in the store, and goes with a DELETE of its object, which the harness sends and the extension never does;
  // one of the default location goes through the request of the action, which the server processes. A removal that
  // fails is said, and the others are tried all the same.
  const removeMade = async (name: string, left: string[]) => {
    let uid = made.get(name);

    try {
      const read = readOf(context, BACKUPS, name);

      if (read && !ours(read)) left.push(`The backup ${name} is not one the proof made, and was left`);
      else if (read) {
        uid = read.metadata.uid;
        const gone =
          name === refusedName
            ? await remove(
                context,
                `/apis/velero.io/v1/namespaces/${DEMO_NAMESPACE}/backups/${name}`,
                uid,
                () => !there(context, BACKUPS, name),
              )
            : await deleteThroughServer({ name, uid });

        if (!gone) left.push(`The backup ${name} the proof made was not removed`);
      }
    } catch (error) {
      left.push(`The backup ${name} the proof made could not be removed: ${String(error)}`);
    }
    let requests: Read[] = [];

    try {
      requests = requestsOf(context, { name, ...(uid ? { uid } : {}) });
    } catch (error) {
      left.push(`The requests to delete ${name} could not be listed: ${String(error)}`);
    }
    for (const request of requests) {
      try {
        const gone = await remove(
          context,
          `/apis/velero.io/v1/namespaces/${DEMO_NAMESPACE}/deletebackuprequests/${request.metadata.name}`,
          request.metadata.uid,
          () => !there(context, REQUESTS, request.metadata.name),
        );

        if (!gone) left.push(`The request ${request.metadata.name} to delete ${name} was not removed`);
      } catch (error) {
        left.push(`The request ${request.metadata.name} to delete ${name} could not be removed: ${String(error)}`);
      }
    }
  };

  const prove = async () => {
    await enable();
    // A backup Completed, deleted: completed once the run reads it gone.
    // A backup the store did not keep, as a store whose master is choosing its leader again answers its writes with
    // 500, is made once more under another name, once the location is Available: the proof is of the deletion, not of
    // the store, and it says so.
    let name = deletedName;
    let deleted = make(name, "default");
    let ended = await endedOf(context, name);

    if (ended?.status?.phase === "Failed" && STORE_FAILED.test(ended.status.failureReason ?? "")) {
      console.log(
        `NOTE: the store did not keep the backup ${name}, ${endOf(ended)}; it is made again as ${againName} in thirty seconds, once the location is Available.`,
      );
      // The location may stay Available while the master of the store chooses its leader, about twenty seconds.
      await delay(STORE_SETTLES);
      await availableOf(context, "default");
      name = againName;
      deleted = make(name, "default");
      ended = await endedOf(context, name);
    }

    requireCondition(ended?.status?.phase === "Completed", `The backup ${name} ended ${endOf(ended)}`);
    await availableOf(context, "default");
    const backup = { name, uid: deleted.metadata.uid };
    const { deleted: completed, took, goneBefore } = await deletion(backup);
    // The run says completed once its reads show the backup gone, which they do within a read of the main process
    // reading it gone; a deletion the server is at, or has not read, only when the run used its thirty seconds and the
    // backup was there until their end.
    const said =
      completed.end === "completed"
        ? readOf(context, BACKUPS, name)?.metadata.uid !== backup.uid
        : (completed.end === "in-progress" || completed.end === "unread") &&
          took >= READ_WINDOW - WINDOW_MARGIN &&
          (goneBefore === undefined || goneBefore <= SAID_WITHIN);

    requireCondition(
      said,
      `The deletion of ${name} ended ${completed.end} after ${seconds(took)}, the backup ${completed.phase ?? "gone"}, ` +
        `${JSON.stringify(completed.errors ?? [])}` +
        (goneBefore === undefined ? "" : `, read gone through the main process ${seconds(goneBefore)} before`),
    );
    // The server deletes the backup, then the request once nothing failed: both are read until they are gone, the
    // request among the requests of the namespace whole.
    let backupThere = true;
    let requestsLeft: Read[] = [];

    for (const until = Date.now() + WITHIN; ; await delay(2000)) {
      backupThere = readOf(context, BACKUPS, name) !== undefined;
      requestsLeft = requestsOf(context, backup);
      if ((!backupThere && requestsLeft.length === 0) || Date.now() >= until) break;
    }
    requireCondition(!backupThere, `The backup ${name} is still there`);
    requireCondition(
      requestsLeft.length === 0,
      `A request to delete ${name} is still there, which the server deletes with the backup: ${stateOf(requestsLeft)}`,
    );
    // A backup of a storage location that is not there: refused, with the one error of a refusal, its phase kept.
    const refusedBackup = make(refusedName, missing);
    const failed = await endedOf(context, refusedName);

    requireCondition(
      failed?.status?.phase === "FailedValidation",
      `The backup ${refusedName} of a location that is not there ended ${endOf(failed)}`,
    );
    const refusal = `backup deletion failed: backup storage location ${missing} not found`;
    const { deleted: refused } = await deletion({ name: refusedName, uid: refusedBackup.metadata.uid });

    requireCondition(
      refused.end === "refused" &&
        refused.phase === "FailedValidation" &&
        refused.errors?.length === 1 &&
        refused.errors[0] === refusal,
      `The deletion of ${refusedName} ended ${refused.end}, ${JSON.stringify(refused.errors ?? [])}`,
    );
    // The request the server refused, read among the requests of the namespace whole: the one the run created, alone,
    // Processed with the one error of the refusal; it was sent once.
    const kept = requestsOf(context, { name: refusedName, uid: refusedBackup.metadata.uid });

    requireCondition(
      kept.length === 1 &&
        kept[0].metadata.name === refused.request &&
        kept[0].status?.phase === "Processed" &&
        isDeepStrictEqual(kept[0].status?.errors, [refusal]),
      `The requests to delete ${refusedName} are not the one the run created, refused: ${stateOf(kept)}`,
    );
    requireCondition(
      readOf(context, BACKUPS, refusedName)?.status?.phase === "FailedValidation",
      `The backup ${refusedName} did not keep its phase`,
    );
    return { completed: completed.end, refused: refused.end };
  };
  let proved: Awaited<ReturnType<typeof prove>> | undefined;
  let failure: unknown;

  try {
    proved = await prove();
  } catch (error) {
    failure = error;
  }
  const left: string[] = [];

  try {
    // The backup refused first, with its request, which the check before the suites stops at while it is there; then
    // the other.
    for (const name of [refusedName, deletedName, againName]) await removeMade(name, left);
  } finally {
    controller.abort();
    release();
    await host.close();
  }
  if (failure !== undefined) {
    if (left.length) console.error(`${left.join(". ")}.`);
    throw failure;
  }
  if (left.length || !proved) throw new Error(left.join(". ") || "The proof of the deletion answered nothing");
  return { ...proved, removed: true };
}
