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
// DeleteBackupRequest, which the server processes. Whatever happens, the backup created is not left behind.
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
  let created: { name: string; uid: string } | undefined;
  let removed = false;

  // The backup, read until the server writes how it ended or it is gone.
  const phaseOf = async (name: string): Promise<string | undefined> => {
    const backup = (await api.read("Backup", DEMO_NAMESPACE, name, controller.signal)) as {
      status?: { phase?: string };
    };

    return backup.status?.phase;
  };
  const gone = async (name: string): Promise<boolean> => {
    try {
      await api.read("Backup", DEMO_NAMESPACE, name, controller.signal);
      return false;
    } catch (error) {
      return (error as { code?: string }).code === "not-found";
    }
  };
  const remove = async (backup: { name: string; uid: string }) => {
    await api.createGenerated("DeleteBackupRequest", DEMO_NAMESPACE, "proof-delete-", controller.signal, backup);
    for (const until = Date.now() + ENDS_WITHIN; Date.now() < until; await delay(2000)) {
      if (await gone(backup.name)) return true;
    }
    return false;
  };

  try {
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
    let phase: string | undefined;

    for (const until = Date.now() + ENDS_WITHIN; Date.now() < until; await delay(2000)) {
      phase = await phaseOf(name);
      if (phase && ENDED.includes(phase)) break;
    }
    const backup = (await api.read("Backup", DEMO_NAMESPACE, name, controller.signal)) as {
      metadata: { uid: string; labels?: Record<string, string> };
    };
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
  } finally {
    // A backup created and not removed yet is removed all the same, whatever ended the proof: the one the run answered,
    // or one of the name it asked, whose answer did not come back.
    if (!removed) {
      const left =
        created ??
        (await api
          .read("Backup", DEMO_NAMESPACE, name, controller.signal)
          .then((found) => ({ name, uid: found.metadata.uid }))
          .catch(() => undefined));

      if (left) await remove(left).catch(() => false);
    }
    controller.abort();
    release();
    await host.close();
  }
}
