import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
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
// How long the server is given to end a backup of the proof, and to delete it.
const WITHIN = 5 * 60 * 1000;
// What a read of kubectl may answer.
const OUTPUT_BOUND = 64 * 1024 * 1024;
// The labels of a request that name its backup.
const BACKUP_UID_LABEL = "velero.io/backup-uid";

interface Read {
  metadata: { name: string; uid: string; labels?: Record<string, string> };
  spec?: Record<string, unknown>;
  status?: { phase?: string; errors?: string[] };
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
function readOf(context: ProofContext, kind: string, name: string): Read | undefined {
  const answer = kubectl(context, ["get", kind, name, "-n", DEMO_NAMESPACE, "-o", "json"]);

  if (!answer.ok) {
    requireCondition(answer.missing, `kubectl get ${kind} ${name} failed: ${answer.error}`);
    return undefined;
  }
  return JSON.parse(answer.out) as Read;
}

// The requests to delete a backup, by the label of its UID.
function requestsOf(context: ProofContext, uid: string): Read[] {
  const answer = kubectl(context, [
    "get",
    "deletebackuprequests.velero.io",
    "-n",
    DEMO_NAMESPACE,
    "-l",
    `${BACKUP_UID_LABEL}=${uid}`,
    "-o",
    "json",
  ]);

  requireCondition(answer.ok, `The requests to delete the backup of UID ${uid} could not be listed: ${answer.error}`);
  return (JSON.parse(answer.out) as { items: Read[] }).items;
}

// A backup of the ConfigMaps of the run, made for the proof with the labels of the environment, in the storage
// location it names.
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
  let read = readOf(context, "backups.velero.io", name);

  for (const until = Date.now() + WITHIN; read && !ENDED.includes(read.status?.phase ?? "") && Date.now() < until; ) {
    await delay(2000);
    read = readOf(context, "backups.velero.io", name);
  }
  return read;
}

// The deletion of a backup, end to end (SPEC-0017, REQ-279 to REQ-282, DELETE-05): the procedures of the compiled main
// process, called as a frame calls them, with the server of the release running. A backup of the ConfigMaps of the
// run, Completed, is deleted with the name of the backup typed: the review is the request of that backup, with no other
// request of it, and the reads after the creation show it gone with its request, which the server deleted with it, or
// a deletion the server is at, which ends with the backup gone. A backup of a storage location that is not there,
// FailedValidation, is deleted the same way: the server refuses the request with the one error of a refusal, and the
// backup keeps its phase. The proof removes what Velero did not delete, the backup it refused and its request, and
// says what it could not remove.
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
  const deletedName = `proof-delete-${context.run}`;
  const refusedName = `proof-refused-${context.run}`;
  const missing = `proof-missing-${context.run}`;
  const made: { name: string; uid: string }[] = [];
  const left: string[] = [];

  // The deletion of a backup through the procedures, with its name typed: the review is the request of that backup,
  // and the answer of the run is what the reads after the creation showed.
  const deletion = async (backup: { name: string; uid: string }) => {
    const target = { kind: "Backup", name: backup.name, uid: backup.uid };
    const confirmed = await call<WriteConfirmAnswer>("write.confirm", {
      cluster,
      namespace: DEMO_NAMESPACE,
      kind: "delete-backup",
      target,
    });

    requireCondition(
      confirmed.text === main.deleteRequestText(main.deleteRequestOf(DEMO_NAMESPACE, backup)),
      `The review of the deletion of ${backup.name} is not the request of that backup`,
    );
    requireCondition(confirmed.others === 0, `The review of ${backup.name} counted ${confirmed.others} other requests`);
    return call<BackupDeleted>("write.run", {
      cluster,
      namespace: DEMO_NAMESPACE,
      kind: "delete-backup",
      target,
      typed: backup.name,
      token: confirmed.token,
      request: randomUUID(),
    });
  };

  const prove = async () => {
    await enable();
    // A backup Completed, deleted: completed, or a deletion the server is at, which ends with the backup gone.
    const deleted = backupOf(context, deletedName, "default");

    made.push({ name: deletedName, uid: deleted.metadata.uid });
    const ended = await endedOf(context, deletedName);

    requireCondition(ended?.status?.phase === "Completed", `The backup ${deletedName} ended ${ended?.status?.phase}`);
    const completed = await deletion({ name: deletedName, uid: deleted.metadata.uid });

    requireCondition(
      completed.end === "completed" || completed.end === "in-progress",
      `The deletion of ${deletedName} ended ${completed.end}`,
    );
    for (const until = Date.now() + WITHIN; readOf(context, "backups.velero.io", deletedName) && Date.now() < until; )
      await delay(2000);
    requireCondition(!readOf(context, "backups.velero.io", deletedName), `The backup ${deletedName} is still there`);
    requireCondition(
      requestsOf(context, deleted.metadata.uid).length === 0,
      `A request to delete ${deletedName} is still there, which the server deletes with the backup`,
    );
    // A backup of a storage location that is not there: refused, with the one error of a refusal, its phase kept.
    const refusedBackup = backupOf(context, refusedName, missing);

    made.push({ name: refusedName, uid: refusedBackup.metadata.uid });
    const failed = await endedOf(context, refusedName);

    requireCondition(
      failed?.status?.phase === "FailedValidation",
      `The backup ${refusedName} of a location that is not there ended ${failed?.status?.phase}`,
    );
    const refused = await deletion({ name: refusedName, uid: refusedBackup.metadata.uid });

    requireCondition(
      refused.end === "refused" &&
        refused.phase === "FailedValidation" &&
        refused.errors?.length === 1 &&
        refused.errors[0] === `backup deletion failed: backup storage location ${missing} not found`,
      `The deletion of ${refusedName} ended ${refused.end}, ${JSON.stringify(refused.errors ?? [])}`,
    );
    requireCondition(
      readOf(context, "backups.velero.io", refusedName)?.status?.phase === "FailedValidation",
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
  } finally {
    // What Velero did not delete: a backup the proof made that is still there, and every request of one. A backup of
    // the location that is not there holds nothing in the store, and goes with a DELETE of its object; one of the
    // default location goes through the request of the action, which the server processes.
    for (const backup of made) {
      const read = readOf(context, "backups.velero.io", backup.name);

      if (read && read.metadata.uid === backup.uid) {
        if (backup.name === refusedName) {
          const answer = kubectl(context, ["delete", "backups.velero.io", backup.name, "-n", DEMO_NAMESPACE, "--wait"]);

          if (!answer.ok && !answer.missing) left.push(`The backup ${backup.name} the proof made was not removed`);
        } else {
          try {
            await api.createDeleteBackupRequest(
              DEMO_NAMESPACE,
              main.deleteRequestText(main.deleteRequestOf(DEMO_NAMESPACE, backup)),
              new AbortController().signal,
            );
            for (
              const until = Date.now() + WITHIN;
              readOf(context, "backups.velero.io", backup.name) && Date.now() < until;
            )
              await delay(2000);
          } catch {
            // Said below, as a backup left.
          }
          if (readOf(context, "backups.velero.io", backup.name))
            left.push(`The backup ${backup.name} the proof made was not deleted by the server`);
        }
      }
      const requests = kubectl(context, [
        "delete",
        "deletebackuprequests.velero.io",
        "-n",
        DEMO_NAMESPACE,
        "-l",
        `${BACKUP_UID_LABEL}=${backup.uid}`,
      ]);

      if (!requests.ok && !requests.missing) left.push(`The requests to delete ${backup.name} were not removed`);
    }
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
