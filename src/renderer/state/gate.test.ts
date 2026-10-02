import { describe, expect, it, vi } from "vitest";
import { ipcHandlers, resetIpc, Main as StubMain } from "../../../test/freelens-extensions";
import { emptyPreferences, heldPreferences, RESOURCES } from "../../common/discovery";
import { CHANNELS } from "../../common/ipc";
import { VeleroIpcRenderer } from "../api/ipc";
import { currentInstallation } from "./context";
import { Installation } from "./installation";

import type { Answer, Family } from "../../common/discovery";
import type { Answer as GateAnswer, GateState } from "../../common/ipc";
import type { GateClient } from "../api/ipc";

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

// The main process, as the views see it: what it holds of the gate, and what it was asked.
function gateClient(initial?: Partial<GateState>) {
  let state: GateState = {
    cluster: { id: "cluster-a", name: "local-demo", context: "kind-local-demo" },
    writes: { on: false },
    ...initial,
  };
  const asked: string[] = [];
  const listeners = new Set<(cluster: string) => void>();
  let refuse: GateAnswer<GateState> | undefined;
  let refuseEnable: GateAnswer<GateState> | undefined;
  const client: GateClient = {
    state: vi.fn(async () => {
      asked.push("state");
      return refuse ?? { ok: true as const, value: state };
    }),
    enable: vi.fn(async (_cluster, namespace, confirmation) => {
      asked.push(`enable ${namespace} ${confirmation.context}`);
      if (refuse) return refuse;
      if (refuseEnable) return refuseEnable;
      state = { ...state, writes: { on: true, namespace, since: 1_700_000_000_000 } };
      return { ok: true as const, value: state };
    }),
    disable: vi.fn(async () => {
      asked.push("disable");
      state = { ...state, writes: { on: false } };
      return { ok: true as const, value: state };
    }),
    onChanged: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };

  return {
    client,
    asked,
    tell: (cluster: string) => {
      for (const listener of listeners) listener(cluster);
    },
    refuseWith: (failure: GateAnswer<GateState>) => {
      refuse = failure;
    },
    // Only turning writes on is refused: the state is still answered.
    refuseEnableWith: (failure: GateAnswer<GateState>) => {
      refuseEnable = failure;
    },
  };
}

// The main process, when the test says when each of its answers arrives: every call waits until it is let
// go, and what it does to the state of the main process is done then, in the order the test lets them go.
function heldGate() {
  let state: GateState = {
    cluster: { id: "cluster-a", name: "local-demo", context: "kind-local-demo" },
    writes: { on: false },
  };
  const waiting: { call: string; run: () => GateState; resolve: (answer: GateAnswer<GateState>) => void }[] = [];
  const hold = (call: string, run: () => GateState) =>
    new Promise<GateAnswer<GateState>>((resolve) => {
      waiting.push({ call, run, resolve });
    });
  const client: GateClient = {
    state: () => hold("state", () => state),
    enable: (_cluster, namespace) =>
      hold(`enable ${namespace}`, () => {
        state = { ...state, writes: { on: true, namespace, since: 1_700_000_000_000 } };
        return state;
      }),
    disable: () =>
      hold("disable", () => {
        state = { ...state, writes: { on: false } };
        return state;
      }),
    onChanged: () => () => undefined,
  };

  return {
    client,
    // What the main process holds now, whatever the views were told.
    held: () => state.writes,
    // The calls that wait, in the order they were made.
    waiting: () => waiting.map((entry) => entry.call),
    // Lets the first call of the name go, and gives the views the time to take its answer. With a failure,
    // the main process did what it was asked and the answer that arrives is the failure.
    answer: async (call: string, failure?: GateAnswer<GateState>) => {
      const index = waiting.findIndex((entry) => entry.call === call);

      if (index < 0) throw new Error(`No ${call} waits: ${waiting.map((entry) => entry.call).join(", ")}`);
      const [entry] = waiting.splice(index, 1);
      const value = entry.run();

      entry.resolve(failure ?? { ok: true, value });
      await new Promise((resolve) => setTimeout(resolve, 0));
    },
  };
}

const LOST: GateAnswer<GateState> = {
  ok: false,
  code: "request-failed",
  stage: "way",
  retry: true,
  text: "The main process did not answer.",
};

function installation(gate?: GateClient) {
  return new Installation({
    cluster: { id: "cluster-a", name: "local-demo" },
    read: async (asked) => answers[asked] ?? { status: 404 },
    now: () => 1000,
    storage: heldPreferences({ ...emptyPreferences(), selected: { "cluster-a": "velero-a" } }),
    gate,
  });
}

describe("what the views know of the gate", () => {
  it("shows writes off until the main process is asked, and what it answered after", async () => {
    const main = gateClient();
    const state = installation(main.client);

    await state.open();
    expect(state.writes).toEqual({ on: false });
    expect(state.gate).toBeUndefined();
    await state.openGate();
    expect(state.gate?.cluster).toEqual({ id: "cluster-a", name: "local-demo", context: "kind-local-demo" });
    expect(state.writes).toEqual({ on: false });
    expect(main.asked).toEqual(["state"]);
  });

  it("turns writes on with the confirmation of the namespace that is shown, and off again", async () => {
    const main = gateClient();
    const state = installation(main.client);

    await state.open();
    await state.openGate();
    expect(await state.enableWrites({ context: "kind-local-demo", namespace: "velero-b" })).toBe(false);
    expect(await state.enableWrites({ context: "kind-local-demo", namespace: "velero-a" })).toBe(true);
    expect(state.writes).toEqual({ on: true, namespace: "velero-a", since: 1_700_000_000_000 });
    await state.disableWrites();
    expect(state.writes).toEqual({ on: false });
    expect(main.asked).toEqual(["state", "enable velero-a kind-local-demo", "disable"]);
  });

  it("says that writes are off for the namespace that is shown when the main process holds them for another", async () => {
    const main = gateClient({ writes: { on: true, namespace: "velero-b", since: 1 } });
    const state = installation(main.client);

    await state.open();
    await state.openGate();
    expect(state.gate?.writes).toEqual({ on: true, namespace: "velero-b", since: 1 });
    expect(state.writes).toEqual({ on: false });
  });

  it("turns writes off at once when another installation is selected, and tells the main process", async () => {
    const main = gateClient();
    const state = installation(main.client);

    await state.open();
    await state.openGate();
    await state.enableWrites({ context: "kind-local-demo", namespace: "velero-a" });
    state.select("velero-b");
    expect(state.writes).toEqual({ on: false });
    expect(state.gate?.writes).toEqual({ on: false });
    await vi.waitFor(() => expect(main.asked).toContain("disable"));
  });

  it("keeps the words of a refusal, and turns nothing on while the state is not known", async () => {
    const main = gateClient();
    const state = installation(main.client);

    await state.open();
    main.refuseWith({
      ok: false,
      code: "target-changed",
      stage: "catalog",
      retry: false,
      text: "The cluster is not in the catalog any more.",
    });
    await state.openGate();
    expect(state.gate).toBeUndefined();
    expect(state.gateFailure).toBe("The cluster is not in the catalog any more.");
    expect(state.gateUnknown).toBe(true);
    expect(state.writes).toEqual({ on: false });
    expect(await state.enableWrites({ context: "kind-local-demo", namespace: "velero-a" })).toBe(false);
    // A refusal is an answer: the state is asked again, to show what the main process holds.
    expect(main.asked).toEqual(["state", "enable velero-a kind-local-demo", "state"]);
  });

  it("knows that writes are off, with the reason, when the main process refuses to turn them on", async () => {
    const main = gateClient();
    const state = installation(main.client);

    await state.open();
    await state.openGate();
    main.refuseEnableWith({
      ok: false,
      code: "connection-unsupported",
      stage: "connection",
      retry: false,
      text: "The connection of this cluster goes through a proxy, which the writes of the extension do not use.",
    });
    expect(await state.enableWrites({ context: "kind-local-demo", namespace: "velero-a" })).toBe(false);
    expect(state.gateUnknown).toBe(false);
    expect(state.writes).toEqual({ on: false });
    expect(state.gateFailure).toContain("proxy");
    expect(main.asked).toEqual(["state", "enable velero-a kind-local-demo", "state"]);
  });

  it("does not leave the main process on for an installation that was left while writes were turned on", async () => {
    const main = heldGate();
    const state = installation(main.client);

    await state.open();
    const opening = state.openGate();

    await main.answer("state");
    await opening;
    const enabling = state.enableWrites({ context: "kind-local-demo", namespace: "velero-a" });

    state.select("velero-b");
    expect(main.waiting()).toEqual(["enable velero-a", "disable"]);
    // The main process takes the disable first, then the enable: it is on for velero-a.
    await main.answer("disable");
    await main.answer("enable velero-a");
    expect(main.waiting()).toEqual(["disable"]);
    await main.answer("disable");
    expect(await enabling).toBe(false);
    expect(main.held()).toEqual({ on: false });
    expect(state.writes).toEqual({ on: false });
    expect(state.gate?.writes).toEqual({ on: false });
  });

  it("does not show writes on when the installation was left and chosen again while they were turned on", async () => {
    const main = heldGate();
    const state = installation(main.client);

    await state.open();
    const opening = state.openGate();

    await main.answer("state");
    await opening;
    const enabling = state.enableWrites({ context: "kind-local-demo", namespace: "velero-a" });

    state.select("velero-b");
    state.select("velero-a");
    await main.answer("disable");
    await main.answer("disable");
    await main.answer("enable velero-a");
    // Before the main process is told again, the views do not show what it answered for the old choice.
    expect(state.writes).toEqual({ on: false });
    await main.answer("disable");
    expect(await enabling).toBe(false);
    expect(main.held()).toEqual({ on: false });
    expect(state.writes).toEqual({ on: false });
  });

  it("tells the main process that writes are off when the target changes, whatever the views last knew", async () => {
    const main = gateClient();
    const state = installation(main.client);

    await state.open();
    await state.openGate();
    await state.enableWrites({ context: "kind-local-demo", namespace: "velero-a" });
    main.refuseWith(LOST);
    await state.openGate();
    expect(state.gate).toBeUndefined();
    state.select("velero-b");
    await vi.waitFor(() => expect(main.asked).toContain("disable"));
  });

  it("asks nothing of the main process when the first installation is chosen", async () => {
    const main = gateClient();
    const state = installation(main.client);

    await state.open();
    expect(state.namespace).toBe("velero-a");
    expect(main.asked).toEqual([]);
  });

  it("says that the state is not known, and why, when an answer of the main process is lost", async () => {
    const main = heldGate();
    const state = installation(main.client);

    await state.open();
    const opening = state.openGate();

    await main.answer("state");
    await opening;
    expect(state.gateUnknown).toBe(false);
    const enabling = state.enableWrites({ context: "kind-local-demo", namespace: "velero-a" });

    await main.answer("enable velero-a");
    expect(await enabling).toBe(true);
    const disabling = state.disableWrites();

    // The main process turned writes off, and the answer was lost: the views cannot say that they are off.
    await main.answer("disable", LOST);
    await disabling;
    expect(state.gateUnknown).toBe(true);
    expect(state.gateFailure).toBe("The main process did not answer.");
    expect(state.writes).toEqual({ on: false });
    // Asked again, the main process says what it holds, and the state is known again.
    const asking = state.openGate();

    await main.answer("state");
    await asking;
    expect(state.gateUnknown).toBe(false);
    expect(state.gateFailure).toBeUndefined();
    expect(state.gate?.writes).toEqual({ on: false });
  });

  it("says that the state is known while it was never asked, and when the views have no way to the main process", async () => {
    const state = installation();

    await state.open();
    expect(state.gateUnknown).toBe(false);
    await state.openGate();
    expect(state.gateFailure).toContain("no way to the main process");
    expect(state.gateUnknown).toBe(false);
  });

  it("says that writes cannot be turned on when the views have no way to the main process", async () => {
    const state = installation();

    await state.open();
    await state.openGate();
    expect(state.writes).toEqual({ on: false });
    expect(state.gateFailure).toContain("no way to the main process");
    expect(await state.enableWrites({ context: "kind-local-demo", namespace: "velero-a" })).toBe(false);
  });
});

describe("the frame of a cluster", () => {
  it("asks the gate again when the main process says that it changed for its cluster, and only then", async () => {
    resetIpc();
    let held: GateState = {
      cluster: { id: "synthetic-cluster", name: "synthetic-cluster", context: "kind-synthetic" },
      writes: { on: false },
    };
    const asked: unknown[] = [];

    ipcHandlers.set(CHANNELS.gateState, (_frame, request) => {
      asked.push(request);
      return { ok: true, value: held };
    });
    VeleroIpcRenderer.createInstance({} as never);
    // What the main process broadcasts with, as it does in production.
    const main = new StubMain.Ipc({});
    const state = currentInstallation();

    await state.openGate();
    expect(asked).toEqual([{ cluster: "synthetic-cluster" }]);
    expect(state.gate?.writes).toEqual({ on: false });
    held = { ...held, writes: { on: true, namespace: "velero", since: 1 } };
    main.broadcast(CHANNELS.gateChanged, { cluster: "another-cluster" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(asked).toHaveLength(1);
    main.broadcast(CHANNELS.gateChanged, { cluster: "synthetic-cluster" });
    await vi.waitFor(() => expect(state.gate?.writes).toEqual({ on: true, namespace: "velero", since: 1 }));
    expect(asked).toEqual([{ cluster: "synthetic-cluster" }, { cluster: "synthetic-cluster" }]);
  });
});
