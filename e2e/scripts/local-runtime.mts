import { createHash } from "node:crypto";
import { readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { assertStoreRequest, type FixtureRuntime, type Recorded, type TabPlacement } from "./local-fixtures.mts";
import { assertOwnedResource, DEMO_NAMESPACE, requireCondition, SUBNETS, subnetsOverlap } from "./local-kind.mts";
import { STORE_BODY_FILE, type StoreAnswer, type StoreBody, storeLogLine, storeSettings } from "./local-store.mts";

import type { Credentials, KubeResource } from "./local-manifests.mts";

// What the runner knows of a fixture run, as far as the store goes: who owns the environment, the objects it
// recorded, and the run with what the placement of the tabs has reached.
export interface RunJournal {
  owner: string;
  resources: Recorded[];
  fixtureRun?: { id: string; tabs?: Omit<TabPlacement, "metadata"> };
}

// How a request to the store reaches the environment, and where it is told.
export interface StoreReach {
  // The client of the cluster of the runner, which checks its target before every command.
  kubectl(args: string[]): string;
  // A command inside the node the runner owns, with what it is given on its standard input. A command that
  // is given a body answers with it: its answer is not read.
  inNode(args: string[], input?: Uint8Array): string;
  // The client of the node, told its settings on its standard input, with the time its process is given.
  client(settings: string, timeout: number): Buffer;
  // What is added to the private log of the operations.
  log(text: string): void;
  // The moment a request that is signed here is signed at.
  now(): Date;
}

// Keeps the body of a request in the node and reads it back by its digest: what the client is told to send
// is what was made.
function keepBody(reach: StoreReach, bytes: Uint8Array, digest: string): void {
  let kept: string;

  try {
    reach.inNode(["tee", STORE_BODY_FILE], bytes);
    kept = reach.inNode(["sha256sum", STORE_BODY_FILE]);
  } catch (error) {
    reach.log(
      `The body of a local storage request was not kept in the node\n${String((error as { stderr?: Buffer }).stderr ?? "")}\n`,
    );
    throw new Error(
      "The node did not keep the body of a local storage request; details retained in the private operations log",
    );
  }
  requireCondition(
    kept.split(/\s+/)[0] === digest,
    "The node does not hold the body of a local storage request as it was made",
  );
}

// A request to the store of the environment, sent by the client of the node, which is given its settings,
// the credentials among them, on its standard input.
//
// What is refused is refused first: before the cluster is asked where the store is, and before anything is
// kept in the node or sent. What says whether a body may be written is the record of the tabs as the journal
// holds it at that moment. A body goes another way than the settings: the node keeps it in one file, written
// through a standard input that carries no credential, the file is read back by its digest before the
// client is told to send it, and it is removed whatever happens.
//
// Every request the client was told to send is in the log of the operations by one line: its verb, its key,
// what the store answered, and for a body its way and its length. A request the client failed, or gave no
// answer of the store for, is told by the same line with no answer, and nothing of what the client gave.
// Nothing of a body, and no setting of the client, is logged.
export function storeRequest(
  reach: StoreReach,
  journal: RunJournal,
  method: "GET" | "PUT" | "HEAD",
  path: string,
  credentials?: Credentials,
  sent?: StoreBody,
): StoreAnswer & { body: string } {
  assertStoreRequest({
    method,
    path,
    run: journal.fixtureRun?.id,
    body: sent,
    placement: journal.fixtureRun?.tabs?.state,
    repaired: journal.fixtureRun?.tabs?.repaired,
  });
  const service = JSON.parse(
    reach.kubectl(["get", "service", "seaweedfs", "--namespace", DEMO_NAMESPACE, "-o", "json"]),
  ) as KubeResource & { spec: { clusterIP: string } };

  assertOwnedResource(
    journal.owner,
    service,
    journal.resources.find((item) => item.kind === "Service" && item.name === "seaweedfs")?.uid,
  );
  requireCondition(
    subnetsOverlap(SUBNETS.services, service.spec.clusterIP),
    "Storage service is outside the dedicated service subnet",
  );
  const digest = sent && createHash("sha256").update(sent.bytes).digest("hex");
  const settings = storeSettings({
    method,
    path,
    address: service.spec.clusterIP,
    credentials,
    body: sent && digest ? { way: sent.way, sha256: digest } : undefined,
    at: reach.now(),
  });
  const told = { method, path, body: sent && { way: sent.way, bytes: sent.bytes.length } };
  let output: Buffer;

  try {
    if (sent && digest) keepBody(reach, sent.bytes, digest);
    try {
      // A body has a minute to be sent, where a request without one has ten seconds.
      output = reach.client(`${settings.join("\n")}\n`, sent ? 75_000 : 15_000);
    } catch (error) {
      reach.log(`${storeLogLine(told)}${String((error as { stderr?: Buffer }).stderr ?? "")}\n`);
      throw new Error("Local storage request failed; details retained in the private operations log");
    }
  } finally {
    if (sent) {
      try {
        reach.inNode(["rm", "-f", STORE_BODY_FILE]);
      } catch {
        reach.log("The body of a local storage request was not removed from the node\n");
      }
    }
  }
  const marker = "\nFV_HTTP_META:";
  const separator = output.lastIndexOf(marker);
  let metadata: { code?: unknown; headers?: unknown } | null = null;

  try {
    if (separator >= 0) metadata = JSON.parse(output.subarray(separator + marker.length).toString("utf8"));
  } catch {
    metadata = null;
  }
  const { code, headers } = metadata ?? {};
  const answered =
    typeof code === "number" &&
    Number.isInteger(code) &&
    code >= 100 &&
    code <= 599 &&
    typeof headers === "object" &&
    headers !== null;

  if (!answered) reach.log(`${storeLogLine(told)}The client gave no answer of the store\n`);
  requireCondition(separator >= 0, "Missing local storage response metadata");
  requireCondition(answered, "Invalid local storage response");
  const answer = { code, headers: headers as Record<string, string[]> };
  const bytes = output.subarray(0, separator);

  reach.log(
    storeLogLine({
      ...told,
      code: answer.code,
      held: method === "HEAD" ? answer.headers["content-length"]?.[0] : undefined,
    }),
  );
  return { ...answer, bytes, body: bytes.toString("utf8") };
}

// Writes a file of the private state whole: under another name first, which it then takes, so that a run
// that is stopped leaves the file as it was or as it is to be, and never a part of it.
function writePrivate(file: string, text: string): void {
  const next = `${file}.next`;

  rmSync(next, { force: true });
  writeFileSync(next, text, { mode: 0o600 });
  renameSync(next, file);
}

// Where the placement of the tabs is recorded, in private, and what ends with it. What the placement has
// reached is in the journal of the runner. The metadata the store was given, which is what the server is
// expected to create, is in a file of its own, written before the journal tells of it: a journal that
// records a placement has the file of it. Beside it is what the tabs are to show of each artifact, for who
// looks at them by hand. Both files go when the record ends, the journal first.
export function tabRecord(
  journal: RunJournal,
  files: { metadata: string; facts: string },
  save: () => void,
): NonNullable<FixtureRuntime["tabs"]> & { tell(facts: unknown): void; end(): void } {
  return {
    read() {
      const recorded = journal.fixtureRun?.tabs;
      let kept: { shape?: unknown; metadata?: { synced?: unknown; withoutLog?: unknown } } | undefined;

      if (!recorded) return undefined;
      try {
        kept = JSON.parse(readFileSync(files.metadata, "utf8"));
      } catch {
        kept = undefined;
      }
      const { synced, withoutLog } = kept?.metadata ?? {};

      requireCondition(
        kept?.shape === recorded.shape && typeof synced === "string" && typeof withoutLog === "string",
        "The metadata the store was given for the tabs is not kept as the journal records it: what the server " +
          "was to create from the store is not known here. The way out is to take the environment down, with " +
          "`pnpm demo:down`.",
      );
      return { ...recorded, metadata: { synced, withoutLog } };
    },
    keep({ metadata, ...recorded }) {
      requireCondition(journal.fixtureRun, "No fixture run is recorded");
      writePrivate(files.metadata, JSON.stringify({ artifacts: recorded.artifacts, shape: recorded.shape, metadata }));
      journal.fixtureRun.tabs = recorded;
      save();
    },
    tell(facts) {
      writePrivate(files.facts, `${JSON.stringify(facts, null, 2)}\n`);
    },
    end() {
      if (journal.fixtureRun?.tabs) {
        delete journal.fixtureRun.tabs;
        save();
      }
      for (const file of [files.metadata, files.facts]) rmSync(file, { force: true });
    },
  };
}
