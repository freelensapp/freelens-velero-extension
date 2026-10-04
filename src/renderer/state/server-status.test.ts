import { describe, expect, it } from "vitest";
import { emptyPreferences, heldPreferences, RESOURCES } from "../../common/discovery";
import { Installation } from "./installation";

import type { Answer, Family } from "../../common/discovery";
import type { Failure, GateState, Answer as IpcAnswer, ServerStatusValue, WriteConfirmAnswer } from "../../common/ipc";
import type { GateClient, WriteClient } from "../api/ipc";

const DISCOVERY = "/apis/velero.io/v1";
const LOCATIONS = "/apis/velero.io/v1/backupstoragelocations";

function object(name: string, namespace: string) {
  return { metadata: { name, namespace, uid: `${namespace}-${name}` } };
}

function list(...items: unknown[]): Answer {
  return { status: 200, body: { items } };
}

function path(family: Family, namespace: string): string {
  return `/apis/velero.io/v1/namespaces/${namespace}/${RESOURCES[family]}`;
}

const answers: Record<string, Answer> = {
  [DISCOVERY]: { status: 200, body: { resources: Object.values(RESOURCES).map((name) => ({ name })) } },
  [LOCATIONS]: list(object("default", "velero-a"), object("default", "velero-b")),
  ...Object.fromEntries(
    ["velero-a", "velero-b"].flatMap((namespace) => [
      [path("backups", namespace), list()],
      [path("restores", namespace), list()],
      [path("schedules", namespace), list()],
      [path("storageLocations", namespace), list(object("default", namespace))],
      [path("snapshotLocations", namespace), list()],
    ]),
  ),
};

const VALUE: ServerStatusValue = {
  version: "v1.18.2",
  processed: "2026-09-30T10:00:00Z",
  plugins: [{ name: "velero.io/aws", kind: "ObjectStore" }],
  request: { name: "freelens-velero-abcde", uid: "request-uid" },
};

const FORBIDDEN: Failure = {
  ok: false,
  code: "forbidden",
  stage: "creation",
  retry: false,
  text: "The cluster refused the creation of a ServerStatusRequest: the identity needs the verb create on serverstatusrequests of the namespace.",
};

// The main process, as the views see it: the gate, which turns writes on for what it is asked, and the
// writes, whose runs wait until the test lets them go.
function mainProcess() {
  let state: GateState = {
    cluster: { id: "cluster-a", name: "local-demo", context: "kind-local-demo" },
    writes: { on: false },
  };
  const asked: string[] = [];
  const runs: { resolve: (answer: IpcAnswer<ServerStatusValue>) => void }[] = [];
  let tokens = 0;
  let refuseConfirm: Failure | undefined;
  const gate: GateClient = {
    state: async () => ({ ok: true, value: state }),
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
  const writer: WriteClient = {
    confirm: async (cluster, namespace, kind, target) => {
      asked.push(`confirm ${cluster} ${namespace} ${kind} ${target === undefined ? "no-target" : "target"}`);
      if (refuseConfirm) return refuseConfirm;
      tokens += 1;
      const answer: WriteConfirmAnswer = {
        token: `00000000-0000-4000-8000-${String(tokens).padStart(12, "0")}`,
        expires: 1000 + 30_000,
      };

      return { ok: true, value: answer };
    },
    runServerStatus: (cluster, namespace, token, request) => {
      asked.push(`run ${cluster} ${namespace} ${token.slice(-2)} ${request}`);
      return new Promise((resolve) => runs.push({ resolve }));
    },
    status: async () => ({ ok: true, value: { step: "waiting" } }),
    cancel: async () => ({ ok: true, value: null }),
  };

  return {
    gate,
    writer,
    asked,
    // Lets the oldest run that waits answer, and gives the views the time to take it.
    answer: async (answer: IpcAnswer<ServerStatusValue>) => {
      const run = runs.shift();

      if (!run) throw new Error("No run waits");
      run.resolve(answer);
      await new Promise((resolve) => setTimeout(resolve, 0));
    },
    refuseConfirmWith: (failure?: Failure) => {
      refuseConfirm = failure;
    },
  };
}

async function setUp(options: { writes?: boolean } = {}) {
  const main = mainProcess();
  const clock = { now: 1000 };
  let requests = 0;
  const installation = new Installation({
    cluster: { id: "cluster-a", name: "local-demo" },
    read: async (asked) => answers[asked] ?? { status: 404 },
    now: () => clock.now,
    storage: heldPreferences({ ...emptyPreferences(), selected: { "cluster-a": "velero-a" } }),
    gate: main.gate,
    writer: main.writer,
    requestId: () => {
      requests += 1;
      return `11111111-1111-4111-8111-${String(requests).padStart(12, "0")}`;
    },
  });

  await installation.open();
  await installation.openGate();
  if (options.writes !== false) await installation.enableWrites({ context: "kind-local-demo", namespace: "velero-a" });
  return { installation, main, clock, server: installation.server };
}

describe("the version of the server, as the views hold it", () => {
  it("is not read before it is asked, and asks the main process nothing when the views open", async () => {
    const { server, main } = await setUp();

    expect(server.step).toEqual({ state: "idle" });
    expect(server.last).toBeUndefined();
    expect(main.asked).toEqual([]);
  });

  it("asks for the confirmation of a ServerStatusRequest of no target, and creates nothing before the second gesture", async () => {
    const { server, main } = await setUp();

    await server.ask();
    expect(main.asked).toEqual(["confirm cluster-a velero-a ServerStatusRequest no-target"]);
    expect(server.step).toMatchObject({ state: "confirming", token: "00000000-0000-4000-8000-000000000001" });
    server.back();
    expect(server.step).toEqual({ state: "idle" });
    expect(main.asked).toHaveLength(1);
  });

  it("runs the request with the token of its confirmation, and keeps the answer with the time it was taken", async () => {
    const { server, main, clock } = await setUp();

    await server.ask();
    clock.now = 2000;
    const running = server.run();

    expect(server.step).toEqual({ state: "running" });
    expect(main.asked.at(-1)).toBe("run cluster-a velero-a 01 11111111-1111-4111-8111-000000000001");
    await main.answer({ ok: true, value: VALUE });
    await running;
    expect(server.step).toEqual({ state: "idle" });
    expect(server.last).toEqual({ value: VALUE, at: 2000 });
  });

  it("creates nothing while writes are off", async () => {
    const { server, main } = await setUp({ writes: false });

    await server.ask();
    await server.run();
    expect(server.step).toEqual({ state: "idle" });
    expect(main.asked).toEqual([]);
  });

  it("keeps what was read through the reads of the installation, and reads again as a new request", async () => {
    const { installation, server, main, clock } = await setUp();

    await server.ask();
    const first = server.run();

    await main.answer({ ok: true, value: VALUE });
    await first;
    await installation.refresh();
    expect(server.last?.value).toEqual(VALUE);
    clock.now = 5000;
    await server.ask();
    // What was read stays shown while the operator confirms, and while the new request runs.
    expect(server.last?.value).toEqual(VALUE);
    const second = server.run();

    expect(server.last?.value).toEqual(VALUE);
    const again = { ...VALUE, version: "v1.18.4", request: { name: "freelens-velero-fghij", uid: "other" } };

    await main.answer({ ok: true, value: again });
    await second;
    expect(server.last).toEqual({ value: again, at: 5000 });
    expect(main.asked.filter((call) => call.startsWith("run"))).toEqual([
      "run cluster-a velero-a 01 11111111-1111-4111-8111-000000000001",
      "run cluster-a velero-a 02 11111111-1111-4111-8111-000000000002",
    ]);
  });

  it("drops what was read when the installation changes", async () => {
    const { installation, server, main } = await setUp();

    await server.ask();
    const running = server.run();

    await main.answer({ ok: true, value: VALUE });
    await running;
    installation.select("velero-b");
    expect(server.last).toBeUndefined();
    expect(server.step).toEqual({ state: "idle" });
  });

  it("drops a confirmation of the installation that was left", async () => {
    const { installation, server, main } = await setUp();

    await server.ask();
    installation.select("velero-b");
    expect(server.step).toEqual({ state: "idle" });
    await server.run();
    expect(main.asked.filter((call) => call.startsWith("run"))).toEqual([]);
  });

  it("does not take the answer of a request of the installation that was left", async () => {
    const { installation, server, main } = await setUp();

    await server.ask();
    const running = server.run();

    installation.select("velero-b");
    expect(server.step).toEqual({ state: "idle" });
    await main.answer({ ok: true, value: VALUE });
    await running;
    expect(server.last).toBeUndefined();
    expect(server.step).toEqual({ state: "idle" });
    // Nor when the operator came back to it before the answer arrived.
    await installation.enableWrites({ context: "kind-local-demo", namespace: "velero-b" });
    await server.ask();
    const other = server.run();

    installation.select("velero-a");
    installation.select("velero-b");
    await main.answer({ ok: true, value: VALUE });
    await other;
    expect(server.last).toBeUndefined();
  });

  it("does not take the answer of a confirmation of the installation that was left", async () => {
    const { installation, server } = await setUp();
    const asking = server.ask();

    installation.select("velero-b");
    await asking;
    expect(server.step).toEqual({ state: "idle" });
  });

  it("keeps the refusal of the API with its words, and writes stay on", async () => {
    const { installation, server, main } = await setUp();

    await server.ask();
    const running = server.run();

    await main.answer(FORBIDDEN);
    await running;
    expect(server.step).toEqual({ state: "failed", failure: FORBIDDEN });
    expect(installation.writes.on).toBe(true);
    expect(main.asked).not.toContain("disable");
    // The command is offered again, and asks a new confirmation.
    await server.ask();
    expect(server.step).toMatchObject({ state: "confirming" });
  });

  it("keeps what was read before beside a request that failed", async () => {
    const { server, main } = await setUp();

    await server.ask();
    const first = server.run();

    await main.answer({ ok: true, value: VALUE });
    await first;
    await server.ask();
    const second = server.run();

    await main.answer({ ...FORBIDDEN, code: "deadline", stage: "wait", retry: true, text: "Not answered." });
    await second;
    expect(server.step).toMatchObject({ state: "failed", failure: { code: "deadline" } });
    expect(server.last?.value).toEqual(VALUE);
  });

  it("says why a confirmation was refused, and runs nothing", async () => {
    const { server, main } = await setUp();
    const refused: Failure = { ...FORBIDDEN, stage: "gate", text: "Writes are off for this namespace." };

    main.refuseConfirmWith(refused);
    await server.ask();
    expect(server.step).toEqual({ state: "failed", failure: refused });
    await server.run();
    expect(main.asked.filter((call) => call.startsWith("run"))).toEqual([]);
  });

  it("asks a new confirmation when the one that is shown expired, then runs with it", async () => {
    const { server, main, clock } = await setUp();

    await server.ask();
    clock.now = 1000 + 31_000;
    const running = server.run();

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(main.asked).toEqual([
      "confirm cluster-a velero-a ServerStatusRequest no-target",
      "confirm cluster-a velero-a ServerStatusRequest no-target",
      "run cluster-a velero-a 02 11111111-1111-4111-8111-000000000001",
    ]);
    await main.answer({ ok: true, value: VALUE });
    await running;
    expect(server.last?.value).toEqual(VALUE);
  });
});
