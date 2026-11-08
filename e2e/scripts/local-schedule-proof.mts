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
// The instants of an expression of every two minutes, and how far from one the valid schedule is created: the
// controller reads its creation to the second, and one created a moment before an instant may be due at its first look.
const EVERY_TWO_MINUTES = 2 * 60 * 1000;
const CLEAR_OF_AN_INSTANT = 10_000;
// The margin of the clocks within which an object the proof finds by its name is taken for one it created.
const CLOCKS = 60_000;

interface Read {
  metadata: { name: string; uid: string; creationTimestamp?: string };
  spec?: Record<string, unknown>;
  status?: { phase?: string; lastSkipped?: string; validationErrors?: string[] };
}

// The kubectl of the environment, for what the proof reads of the cluster beside the procedures, and for the removal
// of the schedules it created, which the adapter of the extension cannot delete: the cluster of the environment
// checked before each call, as every call of the environment checks it, and its cache in the private state, never in
// the folder it runs in. A read of what is not there answers nothing.
function kubectlOf(
  context: ProofContext,
  args: string[],
  input?: string,
): { ok: boolean; out: string; missing: boolean; error: string } {
  const shell = context.shell;

  requireCondition(shell, "The proof of a schedule needs the kubectl of the environment");
  context.assertCurrent();
  const { status, stdout, stderr } = spawnSync(
    shell.kubectl,
    ["--kubeconfig", context.kubeconfig, "--context", DEMO_CONTEXT, ...args],
    {
      encoding: "utf8",
      env: { ...shell.environment, KUBECACHEDIR: join(shell.cache, "kubectl") },
      cwd: shell.cwd,
      timeout: 60_000,
      ...(input ? { input } : {}),
    },
  );

  return {
    ok: status === 0,
    out: stdout ?? "",
    missing: /\(NotFound\)/.test(stderr ?? ""),
    error: (stderr ?? "").trim(),
  };
}

function kubectl(context: ProofContext, args: string[], input?: string): string {
  const answer = kubectlOf(context, args, input);

  requireCondition(answer.ok, `kubectl ${args.slice(0, 3).join(" ")} failed: ${answer.error}`);
  return answer.out;
}

// An object of the namespace of the installation by its name, or nothing when it is not there.
function readOf(context: ProofContext, kind: string, name: string): Read | undefined {
  const answer = kubectlOf(context, ["get", kind, name, "-n", DEMO_NAMESPACE, "-o", "json"]);

  if (!answer.ok) {
    requireCondition(answer.missing, `kubectl get ${kind} ${name} failed: ${answer.error}`);
    return undefined;
  }
  return JSON.parse(answer.out) as Read;
}

// Whether an object was created since the proof began, within the margin of the clocks.
function createdSince(item: Read, began: number): boolean {
  return Date.parse(item.metadata.creationTimestamp ?? "") >= began - CLOCKS;
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
// instant falls inside the run, `*/2 * * * *`, created clear of an instant, is read Enabled with no backup at its first
// reading, and exactly one backup at the first look that finds one after its first instant, which ends Completed with
// the template of the schedule; one the controller refuses, sent through the procedure since the form refuses it (D11),
// is read FailedValidation with the error the controller writes, which is the one the views say; one paused with skip
// immediately true is read with no phase, skip immediately still true and no last skipped. No backup of the three is
// left. The proof removes the three schedules, one whose answer was lost by its name when it was created since the
// proof began, and every backup of them through a DeleteBackupRequest the server processes once it ended, whatever
// ended the proof, and says what it could not remove.
export async function runScheduleCreateProof(context: ProofContext): Promise<{
  enabled: boolean;
  backups: number;
  phase: string;
  refused: string;
  paused: boolean;
  removed: boolean;
}> {
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
  const began = Date.now();
  const every = `proof-schedule-${context.run}-every2`;
  const refusedName = `proof-schedule-${context.run}-refused`;
  const pausedName = `proof-schedule-${context.run}-paused`;
  // The schedules the proof asked for, each with its UID once the run answered it: one whose answer was lost is looked
  // for by its name when it is removed.
  const asked: { name: string; uid?: string }[] = [];
  // The backups the proof removed: every other backup of the three schedules is removed by the cleanup.
  const removedBackups = new Set<string>();
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
    const entry: (typeof asked)[number] = { name };

    asked.push(entry);
    const answer = await call<ScheduleCreated>("write.run", {
      cluster,
      namespace: DEMO_NAMESPACE,
      kind: "schedule",
      schedule: name,
      token: confirmed.token,
      request: randomUUID(),
    });

    requireCondition(answer.name === name && answer.uid, `The run answered another schedule than ${name}`);
    entry.uid = answer.uid;
    return answer;
  };
  const readSchedule = async (name: string) =>
    (await api.read("Schedule", DEMO_NAMESPACE, name, controller.signal)) as unknown as Read;

  const prove = async () => {
    await enable();
    // The valid one, created clear of an instant: Enabled at its first reading, and no backup then.
    const toInstant = EVERY_TWO_MINUTES - (Date.now() % EVERY_TWO_MINUTES);

    if (toInstant < CLEAR_OF_AN_INSTANT) await delay(toInstant + CLEAR_OF_AN_INSTANT / 2);
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
    const backup = { name: backups[0].metadata.name, uid: backups[0].metadata.uid };

    // Removed before its second instant: no other backup comes.
    removeSchedule(context, every, asked, began);
    const later = await readSchedule(pausedName);
    const stillPaused = later.spec?.skipImmediately === true && !later.status?.lastSkipped && !later.status?.phase;

    requireCondition(stillPaused, `The schedule ${pausedName} was changed while it was paused`);
    // The backup ends Completed, of the template of the schedule.
    const ended = await endOf(context, backup.name);
    const phase = ended?.status?.phase ?? "";
    const spec = ended?.spec ?? {};

    requireCondition(phase === "Completed", `The backup ${backup.name} of ${every} ended ${phase || "with no phase"}`);
    requireCondition(
      spec.storageLocation === template.storageLocation &&
        JSON.stringify(spec.includedNamespaces) === JSON.stringify(template.includedNamespaces) &&
        JSON.stringify(spec.includedResources) === JSON.stringify(template.includedResources),
      `The backup ${backup.name} is not of the template of the schedule ${every}`,
    );
    const removed = await removeBackup(context, api, backup, controller.signal);

    requireCondition(removed, `The backup ${backup.name} of the schedule ${every} was not deleted by the server`);
    removedBackups.add(backup.uid);
    for (const name of [every, refusedName, pausedName])
      requireCondition(backupsOf(context, name).length === 0, `A backup of the schedule ${name} is left`);
    return {
      enabled: valid.phase === "Enabled",
      backups: backups.length,
      phase,
      refused: refused.errors?.[0] ?? "",
      paused: stillPaused,
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
    for (const schedule of [...asked]) {
      try {
        removeSchedule(context, schedule.name, asked, began);
      } catch (error) {
        left.push(String(error));
      }
    }
    // Every backup of the three schedules the proof did not remove: one made since it began, once it ended.
    for (const name of [every, refusedName, pausedName]) {
      let found: Read[];

      try {
        found = backupsOf(context, name);
      } catch (error) {
        left.push(String(error));
        continue;
      }
      for (const item of found) {
        if (removedBackups.has(item.metadata.uid)) continue;
        if (!createdSince(item, began)) {
          left.push(`The backup ${item.metadata.name} is older than the proof, and was left`);
          continue;
        }
        const target = { name: item.metadata.name, uid: item.metadata.uid };
        const gone = await removeBackup(context, api, target, new AbortController().signal).catch(() => false);

        if (!gone) left.push(`The backup ${item.metadata.name} the proof made was not removed`);
      }
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

// A schedule the proof asked for, removed by its name with its UID as the precondition, and let go of: one whose
// answer was lost is read by its name, and removed when it was created since the proof began.
function removeSchedule(
  context: ProofContext,
  name: string,
  asked: { name: string; uid?: string }[],
  began: number,
): void {
  const at = asked.findIndex((schedule) => schedule.name === name);

  if (at < 0) return;
  let uid = asked[at].uid;

  if (!uid) {
    const found = readOf(context, "schedules.velero.io", name);

    if (!found) {
      asked.splice(at, 1);
      return;
    }
    requireCondition(createdSince(found, began), `The schedule ${name} is older than the proof, and was left`);
    uid = found.metadata.uid;
  }
  kubectl(
    context,
    ["delete", "--raw", `/apis/velero.io/v1/namespaces/${DEMO_NAMESPACE}/schedules/${name}`, "-f", "-"],
    JSON.stringify({ apiVersion: "v1", kind: "DeleteOptions", preconditions: { uid } }),
  );
  asked.splice(at, 1);
}

// A backup read until it ended, five minutes at most, or nothing when it is not there.
async function endOf(context: ProofContext, name: string): Promise<Read | undefined> {
  let found = readOf(context, "backups.velero.io", name);

  for (const until = Date.now() + WITHIN; found && !ENDED.includes(found.status?.phase ?? ""); ) {
    if (Date.now() >= until) break;
    await delay(2000);
    found = readOf(context, "backups.velero.io", name);
  }
  return found;
}

// A backup of a schedule of the proof: waited for until it ended, since the release deletes no backup in progress,
// and deleted through a DeleteBackupRequest the server processes.
async function removeBackup(
  context: ProofContext,
  api: ReturnType<typeof proofAdapter>,
  backup: { name: string; uid: string },
  signal: AbortSignal,
): Promise<boolean> {
  if ((await endOf(context, backup.name)) === undefined) return true;
  // The request as the deletion of the extension writes it, through the module the proof loaded once.
  const main = await compiledDiagnostics();

  await api.createDeleteBackupRequest(
    DEMO_NAMESPACE,
    main.deleteRequestText(main.deleteRequestOf(DEMO_NAMESPACE, backup)),
    signal,
  );
  for (const until = Date.now() + WITHIN; Date.now() < until; await delay(2000)) {
    if (readOf(context, "backups.velero.io", backup.name) === undefined) return true;
  }
  return false;
}
