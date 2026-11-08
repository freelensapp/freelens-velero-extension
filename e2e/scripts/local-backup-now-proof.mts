import { randomUUID } from "node:crypto";
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

import type { BackupCreated, WriteConfirmAnswer } from "../../src/common/ipc.ts";

// The phases a backup ends in, in the release.
const ENDED = ["Completed", "PartiallyFailed", "Failed", "FailedValidation"];
// How long the server is given to end the backup of the yearly schedule, and to delete it.
const ENDS_WITHIN = 5 * 60 * 1000;

// The name the command line proposes for a backup of a schedule: its name and the time in UTC to the second.
function proposedName(schedule: string): string {
  return `${schedule}-${new Date().toISOString().slice(0, 19).replace(/[-:T]/g, "")}`;
}

// Back up now, end to end (SPEC-0017, ACT-11): the procedures of the compiled main process, called as a frame calls
// them, confirm a backup of the real schedule of the run and create it, with the server of the release running; the
// backup ends Completed, carries the labels of the text the confirmation answered, and is deleted through a
// DeleteBackupRequest, which the server processes. A backup the proof created is waited for until it ended, since the
// release deletes no backup in progress, and then deleted; one it could not remove is named in its failure.
export async function runBackupNowProof(
  context: Pick<DownloadProofContext, "owner" | "run" | "kubeconfig" | "shell" | "assertCurrent">,
): Promise<{ phase: string; labelled: boolean; removed: boolean }> {
  const main = await compiledDiagnostics();
  const host = await startProofHost(context.kubeconfig, DEMO_CONTEXT, context.shell);
  // The requests of the proof carry the labels of the environment, which knows them as its own.
  const api = proofAdapter(main, proofEntry(context.owner, context.kubeconfig), host, context.assertCurrent, {
    "app.kubernetes.io/managed-by": "freelens-velero-extension",
    [OWNER_LABEL]: context.owner,
    [FIXTURE_LABEL]: context.run,
  });
  const { cluster, call, enable, release } = proofProcedures(main, context, context.kubeconfig, host, {});
  const controller = new AbortController();
  const schedule = fixtureNames(context.run).realSchedule;
  const name = proposedName(schedule);
  // A minute before the proof began, for the clocks: a backup of the name it asked, created since, is the one it asked.
  const began = Date.now() - 60_000;
  let created: { name: string; uid: string } | undefined;
  let removed = false;

  type Read = {
    metadata: { uid: string; creationTimestamp?: string; labels?: Record<string, string> };
    status?: { phase?: string };
  };
  // The backup, or nothing once it is gone.
  const readBackup = async (name: string): Promise<Read | undefined> => {
    try {
      return (await api.read("Backup", DEMO_NAMESPACE, name, controller.signal)) as Read;
    } catch (error) {
      if ((error as { code?: string }).code === "not-found") return undefined;
      throw error;
    }
  };
  // Read every two seconds until it ended or is gone, for five minutes at most: what was read last.
  const untilEnded = async (name: string): Promise<Read | undefined> => {
    let read = await readBackup(name);

    for (
      const until = Date.now() + ENDS_WITHIN;
      read && !ENDED.includes(read.status?.phase ?? "") && Date.now() < until;
    ) {
      await delay(2000);
      read = await readBackup(name);
    }
    return read;
  };
  const remove = async (backup: { name: string; uid: string }) => {
    await api.createGenerated("DeleteBackupRequest", DEMO_NAMESPACE, "proof-delete-", controller.signal, backup);
    for (const until = Date.now() + ENDS_WITHIN; Date.now() < until; await delay(2000)) {
      if ((await readBackup(backup.name)) === undefined) return true;
    }
    return false;
  };

  const prove = async () => {
    await enable();
    const read = await api.read("Schedule", DEMO_NAMESPACE, schedule, controller.signal);
    const target = { kind: "Schedule", name: schedule, uid: read.metadata.uid };
    const confirmed = await call<WriteConfirmAnswer>("write.confirm", {
      cluster,
      namespace: DEMO_NAMESPACE,
      kind: "backup-from-schedule",
      target,
      backup: name,
    });

    requireCondition(confirmed.text, "The confirmation of a backup asked from a schedule answered no text");
    const text = JSON.parse(confirmed.text) as { metadata: { name: string; labels: Record<string, string> } };

    requireCondition(text.metadata.name === name, "The text of the confirmation is not of the backup asked");
    const answer = await call<BackupCreated>("write.run", {
      cluster,
      namespace: DEMO_NAMESPACE,
      kind: "backup-from-schedule",
      target,
      backup: name,
      token: confirmed.token,
      request: randomUUID(),
    });

    created = { name: answer.name, uid: answer.uid };
    requireCondition(answer.name === name && answer.uid, "The run answered another backup");
    const backup = await untilEnded(name);

    requireCondition(backup, `The backup ${name} the run created is not there`);
    const phase = backup.status?.phase;
    const labelled = Object.entries(text.metadata.labels).every(
      ([key, value]) => backup.metadata.labels?.[key] === value,
    );

    requireCondition(backup.metadata.uid === answer.uid, "The backup read is not the one created");
    requireCondition(phase === "Completed", `The backup asked from the schedule ended ${phase ?? "with no phase"}`);
    requireCondition(labelled, "The backup does not carry the labels of the text of its confirmation");
    requireCondition(
      backup.metadata.labels?.[OWNER_LABEL] === context.owner,
      "The backup does not carry the labels of the schedule of the run",
    );
    removed = await remove(created);
    requireCondition(removed, "The backup asked from the schedule was not deleted by the server");
    return { phase, labelled, removed };
  };
  // A backup created and not removed yet is removed all the same, whatever ended the proof, once it ended: the one the
  // run answered, or one of the name it asked, whose answer did not come back, when it carries the labels of the
  // schedule of the run and was created since the proof began. What is answered is the words of one it left.
  const removeLeft = async (): Promise<string | undefined> => {
    const found = created ? undefined : await readBackup(name).catch(() => undefined);
    const ours =
      found &&
      found.metadata.labels?.[OWNER_LABEL] === context.owner &&
      found.metadata.labels?.["velero.io/schedule-name"] === schedule &&
      Date.parse(found.metadata.creationTimestamp ?? "") >= began
        ? { name, uid: found.metadata.uid }
        : undefined;
    const left = created ?? ours;

    if (!left) return undefined;
    const ended = await untilEnded(left.name).catch(() => undefined);
    const gone =
      ended === undefined
        ? (await readBackup(left.name).catch(() => ({}) as Read)) === undefined
        : await remove(left).catch(() => false);

    return gone
      ? undefined
      : `The backup ${left.name} the proof created was not removed: the cleanup of the run refuses to end while it is there`;
  };
  let proved: Awaited<ReturnType<typeof prove>> | undefined;
  let failure: unknown;

  try {
    proved = await prove();
  } catch (error) {
    failure = error;
  }
  let left: string | undefined;

  try {
    left = removed ? undefined : await removeLeft();
  } finally {
    controller.abort();
    release();
    await host.close();
  }
  // The failure of the proof is said first, and a backup it left beside it.
  if (failure !== undefined) {
    if (left) console.error(`${left}.`);
    throw failure;
  }
  if (left || !proved) throw new Error(left ?? "The proof of Back up now answered nothing");
  return proved;
}
