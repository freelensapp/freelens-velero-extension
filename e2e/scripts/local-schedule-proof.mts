import { spawnSync } from "node:child_process";
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

import type { BackupTemplate } from "../../src/common/backup-template.ts";
import type { ScheduleCreated, WriteConfirmAnswer } from "../../src/common/ipc.ts";
import type { ScheduleWrapper } from "../../src/common/schedule-form.ts";

type ProofContext = Pick<DownloadProofContext, "owner" | "run" | "kubeconfig" | "shell" | "assertCurrent">;

// The phases a backup ends in, in the release.
const ENDED = ["Completed", "PartiallyFailed", "Failed", "FailedValidation"];
// How long the server is given to submit the backup of the first instant, to end it, and to delete it.
const WITHIN = 5 * 60 * 1000;
// The label every backup of a schedule carries.
const SCHEDULE_NAME_LABEL = "velero.io/schedule-name";

interface Read {
  metadata: { name: string; uid: string; creationTimestamp?: string };
  spec?: Record<string, unknown>;
  status?: { phase?: string; lastSkipped?: string; validationErrors?: string[] };
}

// The kubectl of the environment, for what the proof reads of the cluster beside the procedures, and for the removal
// of the schedules it created, which the adapter of the extension cannot delete.
function kubectl(context: ProofContext, args: string[], input?: string): string {
  const shell = context.shell;

  requireCondition(shell, "The proof of a schedule needs the kubectl of the environment");
  const { status, stdout, stderr } = spawnSync(
    shell.kubectl,
    ["--kubeconfig", context.kubeconfig, "--context", DEMO_CONTEXT, ...args],
    { encoding: "utf8", env: shell.environment, cwd: shell.cwd, timeout: 60_000, ...(input ? { input } : {}) },
  );

  requireCondition(status === 0, `kubectl ${args.slice(0, 3).join(" ")} failed: ${(stderr ?? "").trim()}`);
  return stdout;
}

// The backups of a schedule, by the label the controller gives them.
function backupsOf(context: ProofContext, schedule: string): Read[] {
  const read = JSON.parse(
    kubectl(context, [
      "get",
      "backups.velero.io",
      "-n",
      DEMO_NAMESPACE,
      "-l",
      `${SCHEDULE_NAME_LABEL}=${schedule}`,
      "-o",
      "json",
    ]),
  ) as { items: Read[] };

  return read.items;
}

// The creation of a schedule of the form, end to end (SPEC-0016, REQ-242, CRSCH-22): the procedures of the compiled
// main process, called as a frame calls them, with the controller of the release running. A valid schedule whose first
// instant falls inside the run, `*/2 * * * *`, is read Enabled with no backup at its first reading, and exactly one
// backup after its first instant; one the controller refuses, sent through the procedure since the form refuses it
// (D11), is read FailedValidation with the error the controller writes, which is the one the views say; one paused with
// skip immediately true is read with no phase, skip immediately still true and no last skipped. The proof removes the
// three schedules, and the backup of the valid one through a DeleteBackupRequest the server processes once it ended,
// whatever ended the proof, and says what it could not remove.
export async function runScheduleCreateProof(
  context: ProofContext,
): Promise<{ enabled: boolean; backups: number; refused: string; paused: boolean; removed: boolean }> {
  const main = await compiledDiagnostics();
  const host = await startProofHost(context.kubeconfig, DEMO_CONTEXT, context.shell);
  const api = proofAdapter(main, proofEntry(context.owner, context.kubeconfig), host, context.assertCurrent, {
    "app.kubernetes.io/managed-by": "freelens-velero-extension",
    [OWNER_LABEL]: context.owner,
    [FIXTURE_LABEL]: context.run,
  });
  const { cluster, call, enable, release } = proofProcedures(main, context, context.kubeconfig, host, {});
  const controller = new AbortController();
  const names = fixtureNames(context.run);
  const template: BackupTemplate = {
    includedNamespaces: [names.source],
    includedResources: ["configmaps"],
    includeClusterResources: false,
    labelSelector: `${FIXTURE_LABEL}=${context.run}`,
    storageLocation: "default",
    snapshotVolumes: false,
    defaultVolumesToFsBackup: false,
    ttl: "1h",
  };
  const flags = { paused: false, skipImmediately: false, useOwnerReferencesInBackup: false };
  const created: { name: string; uid: string }[] = [];
  const ask = async (name: string, wrapper: ScheduleWrapper): Promise<ScheduleCreated> => {
    const confirmed = await call<WriteConfirmAnswer>("write.confirm", {
      cluster,
      namespace: DEMO_NAMESPACE,
      kind: "schedule",
      schedule: name,
      wrapper,
      template,
    });

    requireCondition(confirmed.text, `The confirmation of the schedule ${name} answered no text`);
    const answer = await call<ScheduleCreated>("write.run", {
      cluster,
      namespace: DEMO_NAMESPACE,
      kind: "schedule",
      schedule: name,
      token: confirmed.token,
      request: randomUUID(),
    });

    requireCondition(answer.name === name && answer.uid, `The run answered another schedule than ${name}`);
    created.push({ name, uid: answer.uid });
    return answer;
  };
  const readSchedule = async (name: string) =>
    (await api.read("Schedule", DEMO_NAMESPACE, name, controller.signal)) as unknown as Read;
  // The backup of the valid schedule, and whether it was removed, for the cleanup.
  let backup: { name: string; uid: string } | undefined;
  let removed = false;

  const prove = async () => {
    await enable();
    const every = `proof-schedule-${context.run}-every2`;
    const refusedName = `proof-schedule-${context.run}-refused`;
    const pausedName = `proof-schedule-${context.run}-paused`;
    // The valid one: Enabled at its first reading, and no backup then.
    const valid = await ask(every, { expression: "*/2 * * * *", ...flags });

    requireCondition(valid.phase === "Enabled", `The schedule ${every} was read ${valid.phase ?? "with no phase"}`);
    requireCondition(backupsOf(context, every).length === 0, `The schedule ${every} had a backup at its creation`);
    // The one the controller refuses, with the words the form refuses it with, which the compiled main process says.
    const refusedExpression = "61 * * * *";
    const words = main.expressionRefused(refusedExpression);
    const refused = await ask(refusedName, { expression: refusedExpression, ...flags });

    requireCondition(refused.phase === "FailedValidation", `The schedule ${refusedName} was not refused`);
    requireCondition(
      words !== undefined && refused.errors?.[0] === words,
      `The controller refused ${refusedExpression} with other words than the views: ${refused.errors?.join("; ")}`,
    );
    // The paused one: Velero does not read it.
    const paused = await ask(pausedName, { expression: "*/2 * * * *", ...flags, paused: true, skipImmediately: true });

    requireCondition(paused.paused === true && paused.phase === undefined, `The schedule ${pausedName} was read`);
    // The backup of the first instant of the valid schedule, the only one before the second.
    const start = Date.now();
    let backups = backupsOf(context, every);

    while (backups.length === 0 && Date.now() - start < WITHIN) {
      await delay(5000);
      backups = backupsOf(context, every);
    }
    requireCondition(
      backups.length === 1,
      `The schedule ${every} has ${backups.length} backups after its first instant`,
    );
    backup = { name: backups[0].metadata.name, uid: backups[0].metadata.uid };
    // Removed before its second instant: no other backup comes.
    removeSchedule(context, every, created);
    const later = await readSchedule(pausedName);

    requireCondition(
      later.spec?.skipImmediately === true && !later.status?.lastSkipped && !later.status?.phase,
      `The schedule ${pausedName} was changed while it was paused`,
    );
    removed = await removeBackup(context, api, backup, controller.signal);
    requireCondition(removed, `The backup ${backup.name} of the schedule ${every} was not deleted by the server`);
    requireCondition(backupsOf(context, every).length === 0, `A backup of the schedule ${every} is left`);
    return {
      enabled: true,
      backups: backups.length,
      refused: refused.errors?.[0] ?? "",
      paused: true,
      removed,
    };
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
    for (const schedule of [...created]) {
      try {
        removeSchedule(context, schedule.name, created);
      } catch (error) {
        left.push(String(error));
      }
    }
    if (backup && !removed) {
      const gone = await removeBackup(context, api, backup, new AbortController().signal).catch(() => false);

      if (!gone) left.push(`The backup ${backup.name} the proof made was not removed`);
    }
  } finally {
    controller.abort();
    release();
    await host.close();
  }
  if (failure !== undefined) {
    if (left.length) console.error(`${left.join(". ")}.`);
    throw failure;
  }
  if (left.length || !proved) throw new Error(left.join(". ") || "The proof of the schedules answered nothing");
  return proved;
}

// A schedule the proof created, removed by its name with its UID as the precondition, and let go of.
function removeSchedule(context: ProofContext, name: string, created: { name: string; uid: string }[]): void {
  const at = created.findIndex((schedule) => schedule.name === name);

  if (at < 0) return;
  const { uid } = created[at];

  kubectl(
    context,
    ["delete", "--raw", `/apis/velero.io/v1/namespaces/${DEMO_NAMESPACE}/schedules/${name}`, "-f", "-"],
    JSON.stringify({ apiVersion: "v1", kind: "DeleteOptions", preconditions: { uid } }),
  );
  created.splice(at, 1);
}

// The backup of the valid schedule: waited for until it ended, since the release deletes no backup in progress, and
// deleted through a DeleteBackupRequest the server processes.
async function removeBackup(
  context: ProofContext,
  api: ReturnType<typeof proofAdapter>,
  backup: { name: string; uid: string },
  signal: AbortSignal,
): Promise<boolean> {
  const read = () => {
    const out = spawnSync(
      context.shell?.kubectl ?? "kubectl",
      [
        "--kubeconfig",
        context.kubeconfig,
        "--context",
        DEMO_CONTEXT,
        "get",
        "backups.velero.io",
        backup.name,
        "-n",
        DEMO_NAMESPACE,
        "-o",
        "json",
      ],
      { encoding: "utf8", env: context.shell?.environment, cwd: context.shell?.cwd, timeout: 60_000 },
    );

    if (out.status !== 0) return /\(NotFound\)/.test(out.stderr ?? "") ? undefined : ({} as Read);
    return JSON.parse(out.stdout) as Read;
  };

  for (const until = Date.now() + WITHIN; Date.now() < until; await delay(2000)) {
    const found = read();

    if (found === undefined) return true;
    if (ENDED.includes(found.status?.phase ?? "")) break;
  }
  await api.createGenerated("DeleteBackupRequest", DEMO_NAMESPACE, "proof-delete-", signal, backup);
  for (const until = Date.now() + WITHIN; Date.now() < until; await delay(2000)) {
    if (read() === undefined) return true;
  }
  return false;
}
