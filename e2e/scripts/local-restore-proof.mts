import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { compiledDiagnostics, type DownloadProofContext, proofProcedures } from "./local-download-proof.mts";
import { FIXTURE_LABEL, fixtureNames } from "./local-fixtures.mts";
import { startProofHost } from "./local-host.mts";
import { DEMO_CONTEXT, DEMO_NAMESPACE, requireCondition } from "./local-kind.mts";

import type { RestoreCreated, WriteConfirmAnswer } from "../../src/common/ipc.ts";
import type { RestoreForm } from "../../src/common/restore-form.ts";

type ProofContext = Pick<DownloadProofContext, "owner" | "run" | "kubeconfig" | "shell" | "assertCurrent">;

// The phases a restore ends in, in the release.
const ENDED = ["Completed", "PartiallyFailed", "Failed", "FailedValidation"];
// How long the server is given to end the restore of the proof, and to remove it and its namespace.
const WITHIN = 5 * 60 * 1000;
// The labels Velero writes on what it restores.
const RESTORE_NAME_LABEL = "velero.io/restore-name";
const BACKUP_NAME_LABEL = "velero.io/backup-name";
// What a read of kubectl may answer: the ConfigMaps of the run carry megabytes of payload.
const OUTPUT_BOUND = 64 * 1024 * 1024;

interface Read {
  metadata: { name: string; uid: string; creationTimestamp?: string; labels?: Record<string, string> };
  spec?: Record<string, unknown>;
  status?: { phase?: string };
  data?: Record<string, string>;
  binaryData?: Record<string, string>;
}

// The time in UTC to the second, as the form ends the name of a restore with it.
function stamp(): string {
  return new Date().toISOString().slice(0, 19).replace(/[-:T]/g, "");
}

// The kubectl of the environment, for what the proof reads of the cluster beside the procedures, and for the removal of
// what it created, which the adapter of the extension cannot delete: the cluster of the environment checked before
// each call, as every call of the environment checks it, and its cache in the private state, never in the folder it
// runs in. A read of what is not there answers nothing.
function kubectl(
  context: ProofContext,
  args: string[],
  input?: string,
): { ok: boolean; out: string; missing: boolean; error: string } {
  const shell = context.shell;

  requireCondition(shell, "The proof of a restore needs the kubectl of the environment");
  context.assertCurrent();
  const { status, stdout, stderr } = spawnSync(
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
    error: (stderr ?? "").trim().split("\n").slice(-1)[0] ?? "",
  };
}

function read(context: ProofContext, args: string[]): Read | undefined {
  const answer = kubectl(context, [...args, "-o", "json"]);

  if (answer.missing) return undefined;
  requireCondition(answer.ok, `kubectl ${args.slice(0, 3).join(" ")} failed: ${answer.error}`);
  return JSON.parse(answer.out) as Read;
}

// The ConfigMaps of the run in a namespace, by the label of the run.
function configMaps(context: ProofContext, namespace: string): Read[] {
  const answer = kubectl(context, [
    "get",
    "configmaps",
    "--namespace",
    namespace,
    "-l",
    `${FIXTURE_LABEL}=${context.run}`,
    "-o",
    "json",
  ]);

  requireCondition(answer.ok, `The ConfigMaps of ${namespace} could not be listed: ${answer.error}`);
  return (JSON.parse(answer.out) as { items: Read[] }).items;
}

// What a ConfigMap holds, the same whatever namespace it is in.
function contentOf(item: Read): string {
  return JSON.stringify([item.data ?? {}, item.binaryData ?? {}]);
}

// Removes an object by its path with its UID as the precondition, and waits until it is gone.
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

// Restore, end to end (SPEC-0017, REQ-254, ACT-11, RESTORE-08): the backup of the fixtures of the run, Completed, is
// restored through the procedures of the compiled main process, as a frame calls them, with the server of the release
// running, into a namespace its mapping names, of the ConfigMaps of the run alone: the restore ends Completed, every
// ConfigMap of the run is in the namespace of the mapping with what it holds in the source, each with the labels Velero
// writes on what it restores, and the restore and the namespace it made are removed, whatever ended the proof.
export async function runRestoreCreateProof(
  context: ProofContext,
): Promise<{ phase: string; restored: number; bytes: number; removed: boolean }> {
  const main = await compiledDiagnostics();
  const host = await startProofHost(context.kubeconfig, DEMO_CONTEXT, context.shell);
  const { cluster, call, enable, release } = proofProcedures(main, context, context.kubeconfig, host, {});
  const names = fixtureNames(context.run);
  const mapped = `velero-mapped-${context.run}`;
  const began = Date.now() - 60_000;
  const name = `proof-restore-${context.run}-${stamp()}`;
  let restoreUid: string | undefined;
  let mappedAbsent = false;

  const prove = async () => {
    await enable();
    const backup = read(context, ["get", "backups.velero.io", names.backup, "--namespace", DEMO_NAMESPACE]);

    requireCondition(
      backup?.status?.phase === "Completed",
      `The backup ${names.backup} of the fixtures is not Completed`,
    );
    requireCondition(!read(context, ["get", "namespace", mapped]), `The namespace ${mapped} is there before the proof`);
    // Seen absent: a namespace of that name the cleanup finds is the one the restore made.
    mappedAbsent = true;
    const target = { kind: "Backup", name: names.backup, uid: backup.metadata.uid };
    const form: RestoreForm = {
      includedNamespaces: [names.source],
      includedResources: ["configmaps"],
      namespaceMapping: [[names.source, mapped]],
      labelSelector: `${FIXTURE_LABEL}=${context.run}`,
      clusterResources: "none",
      existingResourcePolicy: "none",
    };
    const confirmed = await call<WriteConfirmAnswer>("write.confirm", {
      cluster,
      namespace: DEMO_NAMESPACE,
      kind: "restore",
      target,
      restore: name,
      restoreForm: form,
    });

    requireCondition(confirmed.text, "The confirmation of a restore answered no text");
    const sent = JSON.parse(confirmed.text) as {
      metadata: { name: string; namespace: string };
      spec: Record<string, unknown>;
    };

    requireCondition(
      sent.metadata.name === name &&
        sent.metadata.namespace === DEMO_NAMESPACE &&
        sent.spec.backupName === names.backup,
      "The text of the confirmation is not of the restore asked",
    );
    const answer = await call<RestoreCreated>("write.run", {
      cluster,
      namespace: DEMO_NAMESPACE,
      kind: "restore",
      target,
      restore: name,
      typed: names.backup,
      token: confirmed.token,
      request: randomUUID(),
    });

    requireCondition(answer.name === name && answer.uid, `The run answered another restore than ${name}`);
    restoreUid = answer.uid;
    let restore = read(context, ["get", "restores.velero.io", name, "--namespace", DEMO_NAMESPACE]);

    for (const until = Date.now() + WITHIN; Date.now() < until && !ENDED.includes(restore?.status?.phase ?? ""); ) {
      await delay(2000);
      restore = read(context, ["get", "restores.velero.io", name, "--namespace", DEMO_NAMESPACE]);
    }
    const phase = restore?.status?.phase ?? "";

    requireCondition(restore?.metadata.uid === answer.uid, `The restore ${name} is not the one created`);
    requireCondition(phase === "Completed", `The restore ${name} ended ${phase || "without a phase"}`);
    // Every ConfigMap of the run the backup holds is in the namespace of the mapping, with the labels of the restore.
    const source = configMaps(context, names.source);
    const restored = configMaps(context, mapped);

    requireCondition(source.length > 0, `The source ${names.source} holds no ConfigMap of the run`);
    requireCondition(
      restored
        .map((item) => item.metadata.name)
        .sort()
        .join() ===
        source
          .map((item) => item.metadata.name)
          .sort()
          .join(),
      `The namespace ${mapped} holds ${restored.length} ConfigMaps of the run, and the source ${source.length}`,
    );
    requireCondition(
      restored.every(
        (item) =>
          item.metadata.labels?.[RESTORE_NAME_LABEL] === name &&
          item.metadata.labels?.[BACKUP_NAME_LABEL] === names.backup,
      ),
      "A restored ConfigMap does not carry the labels of the restore",
    );
    const held = new Map(source.map((item) => [item.metadata.name, contentOf(item)]));
    // The payload restored: the texts, and the binary data decoded.
    const bytes = restored.reduce(
      (sum, item) =>
        sum +
        Object.values(item.data ?? {}).reduce((size, value) => size + Buffer.byteLength(value), 0) +
        Object.values(item.binaryData ?? {}).reduce((size, value) => size + Buffer.from(value, "base64").length, 0),
      0,
    );

    requireCondition(
      restored.every((item) => held.get(item.metadata.name) === contentOf(item)),
      `A ConfigMap of ${mapped} does not hold what it holds in ${names.source}`,
    );
    return { phase, restored: restored.length, bytes };
  };
  let proved: Awaited<ReturnType<typeof prove>> | undefined;
  let failure: unknown;

  try {
    proved = await prove();
  } catch (error) {
    failure = error;
  }
  const left: string[] = [];
  // A read that fails is not taken for one that finds nothing: what it was waiting for is not there yet.
  const there = (args: string[]) => {
    try {
      return read(context, args) !== undefined;
    } catch {
      return true;
    }
  };

  try {
    // The restore, by its name and its UID, once it ended: the release deletes the restore with what it wrote of it.
    try {
      const restore = read(context, ["get", "restores.velero.io", name, "--namespace", DEMO_NAMESPACE]);

      if (restore) {
        const created = Date.parse(restore.metadata.creationTimestamp ?? "");

        if (restoreUid ? restore.metadata.uid !== restoreUid : !(created >= began))
          left.push(`The restore ${name} is not the one the proof created, and was left`);
        else {
          for (const until = Date.now() + WITHIN; Date.now() < until; await delay(2000)) {
            const current = (() => {
              try {
                return read(context, ["get", "restores.velero.io", name, "--namespace", DEMO_NAMESPACE]);
              } catch {
                return restore;
              }
            })();

            if (!current || ENDED.includes(current.status?.phase ?? "")) break;
          }
          const gone = await remove(
            context,
            `/apis/velero.io/v1/namespaces/${DEMO_NAMESPACE}/restores/${name}`,
            restore.metadata.uid,
            () => !there(["get", "restores.velero.io", name, "--namespace", DEMO_NAMESPACE]),
          );

          if (!gone) left.push(`The restore ${name} was not removed`);
        }
      }
    } catch (error) {
      left.push(`The restore ${name} could not be removed: ${String(error)}`);
    }
    // The namespace of the mapping, which the restore of the proof made: seen absent before it, and created since it
    // began.
    try {
      const namespace = read(context, ["get", "namespace", mapped]);

      if (namespace) {
        const created = Date.parse(namespace.metadata.creationTimestamp ?? "");

        if (!mappedAbsent || !(created >= began))
          left.push(`The namespace ${mapped} is not one the proof made, and was left`);
        else {
          const gone = await remove(
            context,
            `/api/v1/namespaces/${mapped}`,
            namespace.metadata.uid,
            () => !there(["get", "namespace", mapped]),
          );

          if (!gone) left.push(`The namespace ${mapped} was not removed`);
        }
      }
    } catch (error) {
      left.push(`The namespace ${mapped} could not be removed: ${String(error)}`);
    }
  } finally {
    release();
    await host.close();
  }
  if (failure !== undefined) {
    if (left.length) console.error(`${left.join(". ")}.`);
    throw failure;
  }
  if (left.length || !proved) throw new Error(left.join(". ") || "The proof of the restore answered nothing");
  return { ...proved, removed: true };
}
