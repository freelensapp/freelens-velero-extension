import { describe, expect, it } from "vitest";
import { emptyPreferences, heldPreferences, RESOURCES } from "../../common/discovery";
import { Installation } from "./installation";
import { requestLeft, ServerStatus } from "./server-status";

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

const GATE_OFF: Failure = {
  ok: false,
  code: "forbidden",
  stage: "gate",
  retry: false,
  text: "Writes are off for this installation: turn them on in the target bar.",
};

const LOST: Failure = {
  ok: false,
  code: "request-failed",
  stage: "way",
  retry: true,
  text: "The main process did not answer.",
};

const CANCELLED: Failure = {
  ok: false,
  code: "cancelled",
  stage: "wait",
  retry: true,
  text: "The wait was cancelled. The request stays until the server processes it.",
};

// The main process, as the views see it: the gate, which turns writes on for what it is asked, and the
// writes, whose confirmations and runs wait until the test lets them go when it holds them.
function mainProcess() {
  let state: GateState = {
    cluster: { id: "cluster-a", name: "local-demo", context: "kind-local-demo" },
    writes: { on: false },
  };
  const asked: string[] = [];
  const runs: { resolve: (answer: IpcAnswer<ServerStatusValue>) => void }[] = [];
  const confirmations: { resolve: (answer: IpcAnswer<WriteConfirmAnswer>) => void }[] = [];
  let tokens = 0;
  let refuseConfirm: Failure | undefined;
  let holdConfirmations = false;
  const confirmation = (): IpcAnswer<WriteConfirmAnswer> => {
    if (refuseConfirm) return refuseConfirm;
    tokens += 1;
    return {
      ok: true,
      value: { token: `00000000-0000-4000-8000-${String(tokens).padStart(12, "0")}`, expires: 1000 + 30_000 },
    };
  };
  const gate: GateClient = {
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
  const writer: WriteClient = {
    confirm: (cluster, namespace, kind, target) => {
      asked.push(`confirm ${cluster} ${namespace} ${kind} ${target === undefined ? "no-target" : "target"}`);
      if (!holdConfirmations) return Promise.resolve(confirmation());
      return new Promise((resolve) => confirmations.push({ resolve }));
    },
    runServerStatus: (cluster, namespace, token, request) => {
      asked.push(`run ${cluster} ${namespace} ${token.slice(-2)} ${request}`);
      return new Promise((resolve) => runs.push({ resolve }));
    },
    status: async () => ({ ok: true, value: { step: "waiting" } }),
    cancel: async () => ({ ok: true, value: null }),
  };
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

  return {
    gate,
    writer,
    asked,
    runs: () => asked.filter((call) => call.startsWith("run")),
    // Lets the oldest run that waits answer, and gives the views the time to take it.
    answer: async (answer: IpcAnswer<ServerStatusValue>) => {
      const run = runs.shift();

      if (!run) throw new Error("No run waits");
      run.resolve(answer);
      await settle();
    },
    refuseConfirmWith: (failure?: Failure) => {
      refuseConfirm = failure;
    },
    // From now on a confirmation waits until the test lets it go.
    holdConfirmations: () => {
      holdConfirmations = true;
    },
    confirm: async () => {
      const held = confirmations.shift();

      if (!held) throw new Error("No confirmation waits");
      held.resolve(confirmation());
      await settle();
    },
    // The main process turns writes off for a reason of its own, and tells nobody.
    turnOffSilently: () => {
      state = { ...state, writes: { on: false } };
    },
  };
}

async function setUp(options: { writes?: boolean; writer?: boolean } = {}) {
  const main = mainProcess();
  const clock = { now: 1000 };
  let requests = 0;
  const installation = new Installation({
    cluster: { id: "cluster-a", name: "local-demo" },
    read: async (asked) => answers[asked] ?? { status: 404 },
    now: () => clock.now,
    storage: heldPreferences({ ...emptyPreferences(), selected: { "cluster-a": "velero-a" } }),
    gate: main.gate,
    ...(options.writer === false ? {} : { writer: main.writer }),
    requestId: () => {
      requests += 1;
      return `11111111-1111-4111-8111-${String(requests).padStart(12, "0")}`;
    },
  });

  await installation.open();
  await installation.openGate();
  if (options.writes !== false) await installation.enableWrites({ context: "kind-local-demo", namespace: "velero-a" });
  main.asked.length = 0;
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
    server.leave();
    expect(server.step).toEqual({ state: "idle" });
    await server.run();
    expect(main.asked).toHaveLength(1);
  });

  it("asks once for a command that is given twice, while it is asked, shown or run", async () => {
    const { server, main } = await setUp();

    main.holdConfirmations();
    const first = server.ask();

    await server.ask();
    expect(main.asked).toHaveLength(1);
    await main.confirm();
    await first;
    await server.ask();
    expect(main.asked).toHaveLength(1);
    expect(server.step).toMatchObject({ state: "confirming" });
    const running = server.run();

    await server.ask();
    await server.run();
    expect(main.asked).toEqual([
      "confirm cluster-a velero-a ServerStatusRequest no-target",
      "run cluster-a velero-a 01 11111111-1111-4111-8111-000000000001",
    ]);
    await main.answer({ ok: true, value: VALUE });
    await running;
  });

  it("runs the request with the token of its confirmation, and keeps the answer", async () => {
    const { server, main } = await setUp();

    await server.ask();
    const running = server.run();

    expect(server.step).toEqual({ state: "running" });
    expect(main.asked.at(-1)).toBe("run cluster-a velero-a 01 11111111-1111-4111-8111-000000000001");
    await main.answer({ ok: true, value: VALUE });
    await running;
    expect(server.step).toEqual({ state: "idle" });
    expect(server.last).toEqual(VALUE);
    // What was answered asks the gate nothing.
    expect(main.asked).not.toContain("state");
  });

  it("creates nothing while writes are off", async () => {
    const { server, main } = await setUp({ writes: false });

    await server.ask();
    await server.run();
    expect(server.step).toEqual({ state: "idle" });
    expect(main.asked).toEqual([]);
  });

  it("says that there is no way to the main process when the views have none for the writes", async () => {
    const { server, main } = await setUp({ writer: false });

    await server.ask();
    expect(server.step).toMatchObject({ state: "failed", failure: { code: "request-failed", stage: "way" } });
    await server.run();
    expect(main.asked).toEqual([]);
  });

  it("keeps what was read through the reads of the installation, and reads again as a new request", async () => {
    const { installation, server, main } = await setUp();

    await server.ask();
    const first = server.run();

    await main.answer({ ok: true, value: VALUE });
    await first;
    await installation.refresh();
    expect(server.last).toEqual(VALUE);
    await server.ask();
    // What was read stays shown while the operator confirms, and while the new request runs.
    expect(server.last).toEqual(VALUE);
    const second = server.run();

    expect(server.last).toEqual(VALUE);
    const again = { ...VALUE, version: "v1.18.4", request: { name: "freelens-velero-fghij", uid: "other" } };

    await main.answer({ ok: true, value: again });
    await second;
    expect(server.last).toEqual(again);
    expect(main.runs()).toEqual([
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
    expect(main.runs()).toEqual([]);
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
  });

  it("does not take the answer of a request that was left for the one that runs now", async () => {
    const { installation, server, main } = await setUp();

    await server.ask();
    const left = server.run();

    // Another installation, and back: the request that runs now is another one, at the same step.
    installation.select("velero-b");
    installation.select("velero-a");
    await installation.enableWrites({ context: "kind-local-demo", namespace: "velero-a" });
    await server.ask();
    const now = server.run();

    expect(server.step).toEqual({ state: "running" });
    await main.answer({ ok: true, value: { ...VALUE, version: "v0.0.1" } });
    await left;
    expect(server.last).toBeUndefined();
    expect(server.step).toEqual({ state: "running" });
    await main.answer({ ok: true, value: VALUE });
    await now;
    expect(server.last).toEqual(VALUE);
  });

  it("leaves a confirmation that is still asked when the page that asked for it goes", async () => {
    const { server, main } = await setUp();

    main.holdConfirmations();
    const asking = server.ask();

    expect(server.step).toEqual({ state: "asking" });
    // What the page does when it goes.
    server.leave();
    expect(server.step).toEqual({ state: "idle" });
    await main.confirm();
    await asking;
    // It answered on no page: nothing is shown of it when the page is opened again.
    expect(server.step).toEqual({ state: "idle" });
    await server.run();
    expect(main.runs()).toEqual([]);
  });

  it("does not take the answer of a confirmation of the installation that was left", async () => {
    const { installation, server, main } = await setUp();

    main.holdConfirmations();
    const asking = server.ask();

    installation.select("velero-b");
    await main.confirm();
    await asking;
    expect(server.step).toEqual({ state: "idle" });
  });

  it("keeps the refusal of the API with its words, asks the gate again, and writes stay on", async () => {
    const { installation, server, main } = await setUp();

    await server.ask();
    const running = server.run();

    await main.answer(FORBIDDEN);
    await running;
    expect(server.step).toEqual({ state: "failed", failure: FORBIDDEN, request: "none" });
    // The main process is asked what it holds of the gate: it is the one that knows.
    expect(main.asked.at(-1)).toBe("state");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(installation.writes.on).toBe(true);
    expect(main.asked).not.toContain("disable");
    // The words stay while the gate is asked, and the command is offered again with a new confirmation.
    expect(server.step).toEqual({ state: "failed", failure: FORBIDDEN, request: "none" });
    await server.ask();
    expect(server.step).toMatchObject({ state: "confirming", token: "00000000-0000-4000-8000-000000000002" });
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
    expect(server.last).toEqual(VALUE);
  });

  it("says why a confirmation was refused, runs nothing, and shows the gate the main process holds", async () => {
    const { installation, server, main } = await setUp();

    // The main process turned writes off and the views were not told: their mirror still says on.
    main.turnOffSilently();
    main.refuseConfirmWith(GATE_OFF);
    expect(installation.writes.on).toBe(true);
    await server.ask();
    expect(server.step).toEqual({ state: "failed", failure: GATE_OFF, request: "none" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(installation.writes.on).toBe(false);
    // The words of the refusal stay beside the state of the gate.
    expect(server.step).toEqual({ state: "failed", failure: GATE_OFF, request: "none" });
    await server.run();
    await server.ask();
    expect(main.runs()).toEqual([]);
    expect(main.asked.filter((call) => call.startsWith("confirm"))).toHaveLength(1);
  });

  it("asks a new confirmation when the one that is shown expired, then runs with it", async () => {
    const { server, main, clock } = await setUp();

    await server.ask();
    clock.now = 1000 + 30_000;
    const running = server.run();

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(main.asked).toEqual([
      "confirm cluster-a velero-a ServerStatusRequest no-target",
      "confirm cluster-a velero-a ServerStatusRequest no-target",
      "run cluster-a velero-a 02 11111111-1111-4111-8111-000000000001",
    ]);
    await main.answer({ ok: true, value: VALUE });
    await running;
    expect(server.last).toEqual(VALUE);
  });

  it("runs with the confirmation that is shown until the moment it expires", async () => {
    const { server, main, clock } = await setUp();

    await server.ask();
    clock.now = 1000 + 29_999;
    const running = server.run();

    expect(main.asked.at(-1)).toBe("run cluster-a velero-a 01 11111111-1111-4111-8111-000000000001");
    await main.answer({ ok: true, value: VALUE });
    await running;
  });

  it("runs nothing when the confirmation that expired is refused again", async () => {
    const { server, main, clock } = await setUp();

    await server.ask();
    clock.now = 1000 + 31_000;
    main.refuseConfirmWith(GATE_OFF);
    await server.run();
    expect(server.step).toEqual({ state: "failed", failure: GATE_OFF, request: "none" });
    expect(main.runs()).toEqual([]);
  });

  it("does not run for a confirmation that expired when the installation was left while it was asked again", async () => {
    const { installation, server, main, clock } = await setUp();

    await server.ask();
    clock.now = 1000 + 31_000;
    main.holdConfirmations();
    const running = server.run();

    installation.select("velero-b");
    await main.confirm();
    await running;
    expect(main.runs()).toEqual([]);
    expect(server.step).toEqual({ state: "idle" });
  });

  it("leaves the confirmation that is shown when writes are turned off, and does not show it again when they are on", async () => {
    const { installation, server, main } = await setUp();

    await server.ask();
    expect(server.step).toMatchObject({ state: "confirming" });
    await installation.disableWrites();
    expect(server.step).toEqual({ state: "idle" });
    await installation.enableWrites({ context: "kind-local-demo", namespace: "velero-a" });
    expect(server.step).toEqual({ state: "idle" });
    // The token of the confirmation that was left is never sent.
    await server.run();
    expect(main.runs()).toEqual([]);
  });

  it("does not take a confirmation that arrives after writes were turned off", async () => {
    const { installation, server, main } = await setUp();

    main.holdConfirmations();
    const asking = server.ask();

    expect(server.step).toEqual({ state: "asking" });
    await installation.disableWrites();
    expect(server.step).toEqual({ state: "idle" });
    await installation.enableWrites({ context: "kind-local-demo", namespace: "velero-a" });
    // Asked again, with writes on again: the one of before arrives first, and is not the one of this step.
    const again = server.ask();

    await main.confirm();
    await asking;
    expect(server.step).toEqual({ state: "asking" });
    await main.confirm();
    await again;
    expect(server.step).toMatchObject({ state: "confirming", token: "00000000-0000-4000-8000-000000000002" });
  });

  it("leaves a confirmation when the main process says that writes are off for a reason of its own", async () => {
    const { installation, server, main } = await setUp();

    await server.ask();
    main.turnOffSilently();
    // The main process tells the frame that the gate changed, and the frame asks it.
    await installation.openGate();
    expect(installation.writes.on).toBe(false);
    expect(server.step).toEqual({ state: "idle" });
  });

  it("keeps a request that runs, and takes its answer, when the page that shows it is left", async () => {
    const { server, main } = await setUp();

    await server.ask();
    const running = server.run();

    // What the page does when it goes: it leaves a confirmation, and nothing else.
    server.leave();
    expect(server.step).toEqual({ state: "running" });
    await main.answer({ ok: true, value: VALUE });
    await running;
    expect(server.last).toEqual(VALUE);
  });

  it("keeps the words of a request that failed when the page that shows them is left", async () => {
    const { server, main } = await setUp();

    await server.ask();
    const running = server.run();

    await main.answer(CANCELLED);
    await running;
    server.leave();
    expect(server.step).toEqual({ state: "failed", failure: CANCELLED, request: "created" });
  });

  it("does not run a confirmation that is shown when writes are not on, whoever asks", async () => {
    // The state alone, with what it is given said by the test: writes that go off without the state
    // being told, which the installation never does.
    const main = mainProcess();
    let on = true;
    const server = new ServerStatus({
      client: main.writer,
      cluster: () => "cluster-a",
      namespace: () => "velero-a",
      writesOn: () => on,
      now: () => 1000,
      requestId: () => "11111111-1111-4111-8111-000000000001",
      refused: () => undefined,
    });

    await server.ask();
    expect(server.step).toMatchObject({ state: "confirming" });
    on = false;
    await server.run();
    expect(main.runs()).toEqual([]);
    expect(server.step).toMatchObject({ state: "confirming" });
    on = true;
    const running = server.run();

    expect(main.runs()).toHaveLength(1);
    await main.answer({ ok: true, value: VALUE });
    await running;
  });

  it("says that a confirmation that failed created nothing, and that a request whose answer was lost may be there", async () => {
    const { server, main } = await setUp();

    // The confirmation was lost on the way: the cluster was asked nothing.
    main.refuseConfirmWith(LOST);
    await server.ask();
    expect(server.step).toEqual({ state: "failed", failure: LOST, request: "none" });
    // The same words for a request that ran: the main process may have created it.
    main.refuseConfirmWith(undefined);
    await server.ask();
    const running = server.run();

    await main.answer(LOST);
    await running;
    expect(server.step).toEqual({ state: "failed", failure: LOST, request: "unknown" });
  });

  it("takes how a request that runs ended when writes are turned off under it", async () => {
    const { installation, server, main } = await setUp();

    await server.ask();
    const running = server.run();

    await installation.disableWrites();
    // The main process aborts it and says so: the request may be in the cluster.
    expect(server.step).toEqual({ state: "running" });
    await main.answer(CANCELLED);
    await running;
    expect(server.step).toEqual({ state: "failed", failure: CANCELLED, request: "created" });
    expect(installation.writes.on).toBe(false);
  });
});

describe("what a request that failed left in the cluster", () => {
  const failure = (code: string, stage: string): Failure => ({
    ok: false,
    code: code as Failure["code"],
    stage,
    retry: false,
    text: "Synthetic.",
  });

  it("is the request, when it failed while it was waited for, whatever the code", () => {
    for (const code of ["deadline", "cancelled", "forbidden", "target-changed", "request-failed", "tls-invalid"]) {
      expect([code, requestLeft(failure(code, "wait"))]).toEqual([code, "created"]);
    }
  });

  it("is nothing, when the cluster refused the creation or was not sent it", () => {
    for (const code of [
      "forbidden",
      "deadline",
      "transport-unreachable",
      "tls-invalid",
      "not-found",
      "conflict",
      "validation",
    ]) {
      expect([code, requestLeft(failure(code, "creation"))]).toEqual([code, "none"]);
    }
  });

  it("is not known, when the creation was stopped or its answer was lost", () => {
    for (const code of ["submission-unknown", "cancelled", "target-changed", "payload-too-large", "request-failed"]) {
      expect([code, requestLeft(failure(code, "creation"))]).toEqual([code, "unknown"]);
    }
    // What the main process did is not known either when its answer was lost, was not one of the contract,
    // or it raised while it answered.
    for (const stage of ["way", "answer", "handler"]) {
      expect([stage, requestLeft(failure("request-failed", stage))]).toEqual([stage, "unknown"]);
    }
  });

  it("is nothing, when the main process refused before it asked the cluster", () => {
    for (const [code, stage] of [
      ["forbidden", "gate"],
      ["forbidden", "confirmation"],
      ["forbidden", "frame"],
      ["forbidden", "writes"],
      ["connection-unsupported", "connection"],
      ["target-changed", "catalog"],
      ["target-changed", "connection"],
      ["conflict", "request"],
      ["validation", "request"],
      ["validation", "kind"],
      ["request-failed", "credential"],
    ]) {
      expect([code, stage, requestLeft(failure(code, stage))]).toEqual([code, stage, "none"]);
    }
  });
});
