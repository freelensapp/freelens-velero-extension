import { describe, expect, it, vi } from "vitest";
import { emptyPreferences, heldPreferences, RESOURCES } from "../../common/discovery";
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
  const client: GateClient = {
    state: vi.fn(async () => {
      asked.push("state");
      return refuse ?? { ok: true as const, value: state };
    }),
    enable: vi.fn(async (_cluster, namespace, confirmation) => {
      asked.push(`enable ${namespace} ${confirmation.context}`);
      if (refuse) return refuse;
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
  };
}

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

  it("keeps the words of a refusal, and asks again when the main process says the gate changed", async () => {
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
    expect(await state.enableWrites({ context: "kind-local-demo", namespace: "velero-a" })).toBe(false);
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
