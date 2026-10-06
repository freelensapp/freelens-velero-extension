import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emptyPreferences, heldPreferences, RESOURCES } from "../../common/discovery";
import { ArtifactLoads } from "./artifact-loads";
import { Installation } from "./installation";

import type { Answer, Family } from "../../common/discovery";
import type { ArtifactValue, Failure, GateState, Answer as IpcAnswer } from "../../common/ipc";
import type { ArtifactClient, GateClient, WriteClient } from "../api/ipc";

const VALUE: ArtifactValue = {
  request: { name: "nightly-request-1", uid: "request-uid" },
  size: 9,
  pages: 1,
  route: { mode: "tunnel", encrypted: false, origin: "http://seaweedfs.velero.svc:8333" },
};
const REFUSED: Failure = { ok: false, code: "forbidden", stage: "gate", retry: false, text: "Writes are off." };

// The main process, as the tabs see it: every call is recorded, a confirmation is given at once, and a
// download answers when the test says.
function mainProcess() {
  const calls: string[] = [];
  const runs: ((value: IpcAnswer<ArtifactValue>) => void)[] = [];
  const state = { confirm: undefined as Failure | undefined, tokens: 0 };
  const client: WriteClient & ArtifactClient = {
    confirm: async (cluster, namespace, kind, target, artifact) => {
      calls.push(`confirm ${cluster} ${namespace} ${kind} ${target?.kind}/${target?.name}/${target?.uid} ${artifact}`);
      if (state.confirm) return state.confirm;
      state.tokens += 1;
      return { ok: true, value: { token: `token-${state.tokens}`, expires: 60_000 } };
    },
    runServerStatus: async () => REFUSED,
    status: async () => ({ ok: true, value: { step: "wait" } }),
    cancel: async (cluster, request) => {
      calls.push(`cancel ${cluster} ${request}`);
      return { ok: true, value: null };
    },
    runDownload: (cluster, namespace, target, artifact, token, request) => {
      calls.push(`run ${cluster} ${namespace} ${target.name} ${artifact} ${token} ${request}`);
      return new Promise((resolve) => runs.push(resolve));
    },
    page: async (_cluster, _request, page) => ({ ok: true, value: { page, pages: 1, text: "a log line" } }),
    release: async (cluster, request) => {
      calls.push(`release ${cluster} ${request}`);
      return { ok: true, value: null };
    },
    save: async () => ({ ok: true, value: { saved: true } }),
  };

  return {
    client,
    calls,
    state,
    // The oldest download that waits answers, and the tab is given the time to take its pages.
    answer: async (value: IpcAnswer<ArtifactValue> = { ok: true, value: VALUE }) => {
      runs.shift()?.(value);
      await vi.advanceTimersByTimeAsync(0);
    },
  };
}

function fixture() {
  const main = mainProcess();
  const state = {
    writesOn: true,
    namespace: "velero" as string | undefined,
    objects: { "Backup/nightly": "backup-uid", "Restore/monday": "restore-uid" } as Record<string, string | undefined>,
    requests: 0,
    refused: 0,
  };
  const loads = new ArtifactLoads({
    client: main.client,
    cluster: () => "cluster-a",
    namespace: () => state.namespace,
    object: (kind, name) =>
      `${kind}/${name}` in state.objects ? { metadata: { name, uid: state.objects[`${kind}/${name}`] } } : undefined,
    writesOn: () => state.writesOn,
    now: () => 1_000,
    requestId: () => {
      state.requests += 1;
      return `request-${state.requests}`;
    },
    refused: () => {
      state.refused += 1;
    },
  });
  // A load that was asked, confirmed and answered: its text is held.
  const loaded = async (load: ReturnType<ArtifactLoads["load"]>) => {
    await load.ask();
    void load.run();
    await vi.advanceTimersByTimeAsync(0);
    await main.answer();
  };

  return { loads, main, state, loaded };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("the loads of the tabs of the view that is open", () => {
  it("makes the load of a tab when it is first asked for, asks nothing, and gives the same one while the view is open", async () => {
    const { loads, main } = fixture();
    const close = loads.open("Backup", "nightly");
    const log = loads.load("Backup", "nightly", "log");

    expect(log.step).toEqual({ state: "first" });
    expect(loads.load("Backup", "nightly", "log")).toBe(log);
    const four = (["log", "results", "resources", "volumes"] as const).map((tab) =>
      loads.load("Backup", "nightly", tab),
    );

    expect(new Set(four).size).toBe(4);
    expect(four[0]).toBe(log);
    // Opening a view, and making the loads of its tabs, asks nothing of the main process.
    expect(main.calls).toEqual([]);
    // Each is of the artifact of its tab, for the kind of its operation.
    for (const load of four) await load.ask();
    expect(main.calls.map((call) => call.split(" ").at(-1))).toEqual([
      "BackupLog",
      "BackupResults",
      "BackupResourceList",
      "BackupVolumeInfos",
    ]);
    close();
    loads.open("Restore", "monday");
    await loads.load("Restore", "monday", "volumes").ask();
    expect(main.calls.at(-1)).toBe(
      "confirm cluster-a velero DownloadRequest Restore/monday/restore-uid RestoreVolumeInfo",
    );
  });

  it("gives a load the object the installation last read as its target, and none while the object is not known", async () => {
    const { loads, main, state } = fixture();

    loads.open("Backup", "late");
    const load = loads.load("Backup", "late", "log");

    // The object was not read: nothing can be asked for it.
    await load.ask();
    expect(main.calls).toEqual([]);
    // Nor for one that carries no UID, which is what tells it from another of its name.
    state.objects["Backup/late"] = undefined;
    await load.ask();
    expect(main.calls).toEqual([]);
    state.objects["Backup/late"] = "first-uid";
    await load.ask();
    expect(main.calls).toEqual(["confirm cluster-a velero DownloadRequest Backup/late/first-uid BackupLog"]);
    // The object is read again each time: one created again under the name is the one that is asked.
    load.leave();
    state.objects["Backup/late"] = "second-uid";
    await load.ask();
    expect(main.calls.at(-1)).toBe("confirm cluster-a velero DownloadRequest Backup/late/second-uid BackupLog");
    // And nothing is asked with writes off, or without a namespace.
    load.leave();
    state.writesOn = false;
    await load.ask();
    state.writesOn = true;
    state.namespace = undefined;
    await load.ask();
    expect(main.calls).toHaveLength(2);
  });

  it("drops the loads of a view when it closes: what was loaded goes, here and in the main process", async () => {
    const { loads, main, loaded } = fixture();
    const close = loads.open("Backup", "nightly");
    const log = loads.load("Backup", "nightly", "log");
    const results = loads.load("Backup", "nightly", "results");

    await loaded(log);
    expect(log.step).toMatchObject({ state: "loaded", text: "a log line", at: 1_000 });
    // A request that still runs when the view closes is cancelled.
    await results.ask();
    void results.run();
    await vi.advanceTimersByTimeAsync(0);
    close();
    expect(log.step).toEqual({ state: "first" });
    expect(results.step).toEqual({ state: "first" });
    expect(main.calls.slice(-2).sort()).toEqual(["cancel cluster-a request-2", "release cluster-a request-1"]);
    // The view opened again begins from nothing: its loads are new ones.
    loads.open("Backup", "nightly");
    const again = loads.load("Backup", "nightly", "log");

    expect(again).not.toBe(log);
    expect(again.step).toEqual({ state: "first" });
    // Closed twice, nothing more is asked.
    const asked = main.calls.length;

    close();
    expect(main.calls).toHaveLength(asked);
    expect(loads.load("Backup", "nightly", "log")).toBe(again);
  });

  it("drops what it holds of an operation when another one is shown, and keeps the loads of the one that is", async () => {
    const { loads, main, loaded } = fixture();
    const closeBackup = loads.open("Backup", "nightly");
    const log = loads.load("Backup", "nightly", "log");

    await loaded(log);
    // The restore is shown over the backup: the view of the backup has not closed yet.
    const closeRestore = loads.open("Restore", "monday");

    expect(log.step).toEqual({ state: "first" });
    expect(main.calls.at(-1)).toBe("release cluster-a request-1");
    const restored = loads.load("Restore", "monday", "log");

    await loaded(restored);
    // The view of the backup closes after: nothing of the restore goes with it.
    closeBackup();
    expect(restored.step.state).toBe("loaded");
    expect(loads.load("Restore", "monday", "log")).toBe(restored);
    closeRestore();
    expect(restored.step).toEqual({ state: "first" });
    expect(main.calls.at(-1)).toBe("release cluster-a request-2");
  });

  it("keeps the loads a tab asked for before its view said that it opened, and through a view that opens twice", async () => {
    const { loads, loaded } = fixture();
    // A tab is drawn before its view says that it opened.
    const log = loads.load("Backup", "nightly", "log");
    const first = loads.open("Backup", "nightly");

    expect(loads.load("Backup", "nightly", "log")).toBe(log);
    await loaded(log);
    // The view opens again before the one before it closes: what closes late is not the view that is open.
    const second = loads.open("Backup", "nightly");

    first();
    expect(log.step.state).toBe("loaded");
    expect(loads.load("Backup", "nightly", "log")).toBe(log);
    second();
    expect(log.step).toEqual({ state: "first" });
  });

  it("leaves the confirmations that wait when writes are no longer on, and keeps what was loaded", async () => {
    const { loads, main, loaded } = fixture();

    loads.open("Backup", "nightly");
    const log = loads.load("Backup", "nightly", "log");
    const results = loads.load("Backup", "nightly", "results");
    const volumes = loads.load("Backup", "nightly", "volumes");

    await loaded(log);
    await results.ask();
    expect(results.step.state).toBe("confirming");
    await volumes.ask();
    void volumes.run();
    await vi.advanceTimersByTimeAsync(0);
    const asked = main.calls.length;

    loads.leave();
    expect(results.step).toEqual({ state: "first" });
    // What was loaded stays, and a request that runs is not left: it is cancelled, or it ends.
    expect(log.step.state).toBe("loaded");
    expect(volumes.step.state).toBe("loading");
    expect(main.calls).toHaveLength(asked);
  });

  it("drops everything when the installation changes: nothing of the one before is shown, or held", async () => {
    const { loads, main, loaded } = fixture();
    const close = loads.open("Backup", "nightly");
    const log = loads.load("Backup", "nightly", "log");
    const results = loads.load("Backup", "nightly", "results");

    await loaded(log);
    await results.ask();
    void results.run();
    await vi.advanceTimersByTimeAsync(0);
    loads.drop();
    expect(log.step).toEqual({ state: "first" });
    expect(results.step).toEqual({ state: "first" });
    expect(main.calls.slice(-2).sort()).toEqual(["cancel cluster-a request-2", "release cluster-a request-1"]);
    // What the download that was cancelled answers is not taken, and the main process is told to let it go.
    await main.answer();
    expect(results.step).toEqual({ state: "first" });
    expect(main.calls.at(-1)).toBe("release cluster-a request-2");
    // The loads of the tabs are new ones, and the view closes after with nothing left to drop.
    expect(loads.load("Backup", "nightly", "log")).not.toBe(log);
    const asked = main.calls.length;

    close();
    expect(main.calls).toHaveLength(asked);
  });
});

const DISCOVERY = "/apis/velero.io/v1";
const LOCATIONS = "/apis/velero.io/v1/backupstoragelocations";

function object(name: string, namespace: string, uid = `${namespace}-${name}`) {
  return { metadata: { name, namespace, uid } };
}

function list(...items: unknown[]): Answer {
  return { status: 200, body: { items } };
}

function path(family: Family, namespace: string): string {
  return `/apis/velero.io/v1/namespaces/${namespace}/${RESOURCES[family]}`;
}

// The gate of the main process: it turns writes on and off, and says how many times it was asked.
function gateClient() {
  let state: GateState = {
    cluster: { id: "cluster-a", name: "local-demo", context: "kind-local-demo" },
    writes: { on: false },
  };
  const asked: string[] = [];
  const client: GateClient = {
    state: async () => {
      asked.push("state");
      return { ok: true, value: state };
    },
    enable: async (_cluster, namespace) => {
      state = { ...state, writes: { on: true, namespace, since: 1 } };
      return { ok: true, value: state };
    },
    disable: async () => {
      asked.push("disable");
      state = { ...state, writes: { on: false } };
      return { ok: true, value: state };
    },
    onChanged: () => () => undefined,
  };

  return { client, asked };
}

async function installation(options: { writes?: boolean } = {}) {
  const main = mainProcess();
  const gate = gateClient();
  const clock = { now: 1_000 };
  const table: Record<string, Answer> = {
    [DISCOVERY]: { status: 200, body: { resources: Object.values(RESOURCES).map((name) => ({ name })) } },
    [LOCATIONS]: list(object("default", "velero-a"), object("default", "velero-b")),
    [path("backups", "velero-a")]: list(object("nightly", "velero-a")),
    [path("restores", "velero-a")]: list(object("monday", "velero-a")),
    [path("backups", "velero-b")]: list(object("nightly", "velero-b")),
  };
  let requests = 0;
  const state = new Installation({
    cluster: { id: "cluster-a", name: "local-demo" },
    read: async (asked) => table[asked] ?? list(),
    now: () => clock.now,
    storage: heldPreferences({ ...emptyPreferences(), selected: { "cluster-a": "velero-a" } }),
    gate: gate.client,
    writer: main.client,
    requestId: () => {
      requests += 1;
      return `11111111-1111-4111-8111-${String(requests).padStart(12, "0")}`;
    },
  });

  await state.open();
  await state.openGate();
  if (options.writes !== false) await state.enableWrites({ context: "kind-local-demo", namespace: "velero-a" });
  gate.asked.length = 0;
  return { state, main, gate, clock, table };
}

describe("the loads of the tabs, as the installation gives them", () => {
  it("are of the object it last read, in its namespace and its cluster, behind its gate, with its clock and its requests", async () => {
    const { state, main, clock } = await installation();

    state.artifacts.open("Backup", "nightly");
    const log = state.artifacts.load("Backup", "nightly", "log");

    await log.ask();
    expect(main.calls).toEqual([
      "confirm cluster-a velero-a DownloadRequest Backup/nightly/velero-a-nightly BackupLog",
    ]);
    void log.run();
    await vi.advanceTimersByTimeAsync(0);
    expect(main.calls.at(-1)).toBe(
      "run cluster-a velero-a nightly BackupLog token-1 11111111-1111-4111-8111-000000000001",
    );
    clock.now = 7_000;
    await main.answer();
    expect(log.step).toMatchObject({ state: "loaded", text: "a log line", at: 7_000 });
    // A restore is asked as a restore, and an object that was not read is not asked at all.
    state.artifacts.open("Restore", "monday");
    await state.artifacts.load("Restore", "monday", "results").ask();
    expect(main.calls.at(-1)).toBe(
      "confirm cluster-a velero-a DownloadRequest Restore/monday/velero-a-monday RestoreResults",
    );
    const asked = main.calls.length;

    await state.artifacts.load("Restore", "nightly", "log").ask();
    expect(main.calls).toHaveLength(asked);
  });

  it("ask nothing while writes are off, and leave a confirmation that waits when they go off", async () => {
    const { state, main } = await installation({ writes: false });

    state.artifacts.open("Backup", "nightly");
    const log = state.artifacts.load("Backup", "nightly", "log");

    await log.ask();
    expect(main.calls).toEqual([]);
    await state.enableWrites({ context: "kind-local-demo", namespace: "velero-a" });
    await log.ask();
    expect(log.step.state).toBe("confirming");
    await state.disableWrites();
    expect(log.step).toEqual({ state: "first" });
    expect(main.calls.filter((call) => call.startsWith("run"))).toEqual([]);
  });

  it("are dropped with what the installation holds of a target that changed", async () => {
    const { state, main } = await installation();

    state.artifacts.open("Backup", "nightly");
    const log = state.artifacts.load("Backup", "nightly", "log");

    await log.ask();
    void log.run();
    await vi.advanceTimersByTimeAsync(0);
    await main.answer();
    expect(log.step.state).toBe("loaded");
    state.select("velero-b");
    // The text of the backup of the other installation is not shown for the one of the same name here.
    expect(log.step).toEqual({ state: "first" });
    expect(main.calls.at(-1)).toBe("release cluster-a 11111111-1111-4111-8111-000000000001");
    await vi.waitFor(() => expect(state.read("backups").status).toBe("ready"));
    const here = state.artifacts.load("Backup", "nightly", "log");

    expect(here).not.toBe(log);
    expect(here.step).toEqual({ state: "first" });
  });

  it("ask the gate again when the main process refuses one", async () => {
    const { state, main, gate } = await installation();

    state.artifacts.open("Backup", "nightly");
    const log = state.artifacts.load("Backup", "nightly", "log");

    main.state.confirm = REFUSED;
    await log.ask();
    expect(log.step).toMatchObject({ state: "failed", failure: REFUSED });
    await vi.waitFor(() => expect(gate.asked).toEqual(["state"]));
  });
});
