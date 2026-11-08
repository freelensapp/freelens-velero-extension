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
import type { BackupCreated, WriteConfirmAnswer } from "../../src/common/ipc.ts";

// The phases a backup ends in, in the release.
const ENDED = ["Completed", "PartiallyFailed", "Failed", "FailedValidation"];
// How long the server is given to end a backup of the proof, and to delete it.
const ENDS_WITHIN = 5 * 60 * 1000;

type ProofContext = Pick<DownloadProofContext, "owner" | "run" | "kubeconfig" | "shell" | "assertCurrent">;

// A backup as the proof reads it.
type Read = {
  metadata: { uid: string; creationTimestamp?: string; labels?: Record<string, string> };
  spec?: Record<string, unknown>;
  status?: { phase?: string };
};

// The time in UTC to the second, as the command line ends the name of a backup with it.
function stamp(): string {
  return new Date().toISOString().slice(0, 19).replace(/[-:T]/g, "");
}

// What one proof of a creation asks and checks: the name of its backup; how it is asked of the procedures of the
// compiled main process, which answers the text the confirmation gave and the backup the run created; what is checked of
// the backup once it ended; and whether a backup found by its name, whose answer did not come back, is the one asked.
interface Creation<Checked> {
  name: string;
  what: string;
  ask(session: Session): Promise<{ text: string; answer: BackupCreated }>;
  check(text: string, backup: Read): Checked;
  owns(found: Read): boolean;
}

interface Session {
  cluster: string;
  call: <Value>(channel: string, request: unknown) => Promise<Value>;
  read(kind: "Schedule", name: string): Promise<{ metadata: { uid: string } }>;
}

// A creation, end to end (SPEC-0017, ACT-11): the procedures of the compiled main process, called as a frame calls
// them, confirm a backup and create it, with the server of the release running; the backup ends Completed, with what
// its proof checks, and is deleted through a DeleteBackupRequest, which the server processes. A backup the proof
// created is waited for until it ended, since the release deletes no backup in progress, and then deleted; one it
// could not remove is named in its failure.
async function proveCreation<Checked>(
  context: ProofContext,
  creation: Creation<Checked>,
): Promise<Checked & { phase: string; removed: boolean }> {
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
  const { name } = creation;
  let created: { name: string; uid: string } | undefined;
  let removed = false;

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
  const session: Session = {
    cluster,
    call,
    read: async (kind, name) =>
      (await api.read(kind, DEMO_NAMESPACE, name, controller.signal)) as { metadata: { uid: string } },
  };

  const prove = async () => {
    await enable();
    const { text, answer } = await creation.ask(session);

    created = { name: answer.name, uid: answer.uid };
    requireCondition(answer.name === name && answer.uid, "The run answered another backup");
    const backup = await untilEnded(name);

    requireCondition(backup, `The ${creation.what} ${name} the run created is not there`);
    const phase = backup.status?.phase;

    requireCondition(backup.metadata.uid === answer.uid, "The backup read is not the one created");
    requireCondition(phase === "Completed", `The ${creation.what} ended ${phase ?? "with no phase"}`);
    const checked = creation.check(text, backup);

    removed = await remove(created);
    requireCondition(removed, `The ${creation.what} was not deleted by the server`);
    return { ...checked, phase, removed };
  };
  // A backup created and not removed yet is removed all the same, whatever ended the proof, once it ended: the one the
  // run answered, or one of the name it asked, whose answer did not come back, when it is the one asked. What is
  // answered is the words of one it left.
  const removeLeft = async (): Promise<string | undefined> => {
    const found = created ? undefined : await readBackup(name).catch(() => undefined);
    const ours = found && creation.owns(found) ? { name, uid: found.metadata.uid } : undefined;
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
  let proved: (Checked & { phase: string; removed: boolean }) | undefined;
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
  if (left || !proved) throw new Error(left ?? `The proof of the ${creation.what} answered nothing`);
  return proved;
}

// A minute before the proof began, for the clocks: a backup of the name it asked, created since, may be the one asked.
function since(found: Read, began: number): boolean {
  return Date.parse(found.metadata.creationTimestamp ?? "") >= began;
}

// Back up now, end to end: a backup of the real schedule of the run, which carries the labels of the text of its
// confirmation, the label of the schedule and the labels of the schedule of the run among them.
export async function runBackupNowProof(
  context: ProofContext,
): Promise<{ phase: string; labelled: boolean; removed: boolean }> {
  const schedule = fixtureNames(context.run).realSchedule;
  const began = Date.now() - 60_000;
  const backup = `${schedule}-${stamp()}`;

  return proveCreation(context, {
    name: backup,
    what: "backup asked from the schedule",
    async ask(session) {
      const read = await session.read("Schedule", schedule);
      const target = { kind: "Schedule", name: schedule, uid: read.metadata.uid };
      const confirmed = await session.call<WriteConfirmAnswer>("write.confirm", {
        cluster: session.cluster,
        namespace: DEMO_NAMESPACE,
        kind: "backup-from-schedule",
        target,
        backup,
      });

      requireCondition(confirmed.text, "The confirmation of a backup asked from a schedule answered no text");
      requireCondition(
        (JSON.parse(confirmed.text) as { metadata: { name: string } }).metadata.name === backup,
        "The text of the confirmation is not of the backup asked",
      );
      const answer = await session.call<BackupCreated>("write.run", {
        cluster: session.cluster,
        namespace: DEMO_NAMESPACE,
        kind: "backup-from-schedule",
        target,
        backup,
        token: confirmed.token,
        request: randomUUID(),
      });

      return { text: confirmed.text, answer };
    },
    check(text, backup) {
      const labels = (JSON.parse(text) as { metadata: { labels: Record<string, string> } }).metadata.labels;
      const labelled = Object.entries(labels).every(([key, value]) => backup.metadata.labels?.[key] === value);

      requireCondition(labelled, "The backup does not carry the labels of the text of its confirmation");
      requireCondition(
        backup.metadata.labels?.[OWNER_LABEL] === context.owner,
        "The backup does not carry the labels of the schedule of the run",
      );
      return { labelled };
    },
    owns: (found) =>
      found.metadata.labels?.[OWNER_LABEL] === context.owner &&
      found.metadata.labels?.["velero.io/schedule-name"] === schedule &&
      since(found, began),
  });
}

// Create backup, end to end: a backup of the form of the ConfigMaps of the namespace of the run that carry its label,
// to the storage location of the installation, with no label of its own; the spec the server keeps carries every field
// of the text that Velero keeps as it was sent.
export async function runBackupCreateProof(
  context: ProofContext,
): Promise<{ phase: string; kept: boolean; removed: boolean }> {
  const names = fixtureNames(context.run);
  const began = Date.now() - 60_000;
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
  // The fields of the text the server keeps as they were sent.
  const kept = ["includedNamespaces", "includeClusterResources", "labelSelector", "storageLocation", "ttl"];
  const backup = `proof-form-${context.run}-${stamp()}`;

  return proveCreation(context, {
    name: backup,
    what: "backup of the form",
    async ask(session) {
      const confirmed = await session.call<WriteConfirmAnswer>("write.confirm", {
        cluster: session.cluster,
        namespace: DEMO_NAMESPACE,
        kind: "backup",
        backup,
        template,
      });

      requireCondition(confirmed.text, "The confirmation of a backup of the form answered no text");
      const answer = await session.call<BackupCreated>("write.run", {
        cluster: session.cluster,
        namespace: DEMO_NAMESPACE,
        kind: "backup",
        backup,
        token: confirmed.token,
        request: randomUUID(),
      });

      return { text: confirmed.text, answer };
    },
    check(text, backup) {
      const sent = JSON.parse(text) as { metadata: Record<string, unknown>; spec: Record<string, unknown> };

      requireCondition(
        Object.keys(sent.metadata).sort().join() === "name,namespace",
        "The text of a backup of the form carries more than its name and its namespace",
      );
      const keptAsSent = kept.every(
        (field) => JSON.stringify(backup.spec?.[field]) === JSON.stringify(sent.spec[field]),
      );

      requireCondition(keptAsSent, "The backup does not carry the fields of its text that Velero keeps as sent");
      return { kept: keptAsSent };
    },
    owns: (found) =>
      found.spec?.storageLocation === template.storageLocation &&
      JSON.stringify(found.spec?.includedNamespaces) === JSON.stringify(template.includedNamespaces) &&
      since(found, began),
  });
}
