import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { CHANNELS } from "../common/ipc";
import { registerHandlers, senderOf } from "./ipc";
import { WriteGate } from "./write-gate";

import type { DiagnosticObject } from "./diagnostic-kubernetes";
import type { IpcEvent, Registrar } from "./ipc";
import type { CatalogEntry } from "./write-gate";

const FRAME_A: IpcEvent = {
  senderFrame: { url: "https://cluster-a.renderer.freelens.app:1234/" },
  processId: 1,
  frameId: 4,
};
const FRAME_B: IpcEvent = {
  senderFrame: { url: "https://cluster-b.renderer.freelens.app:1234/" },
  processId: 1,
  frameId: 9,
};
const WINDOW: IpcEvent = {
  senderFrame: { url: "https://renderer.freelens.app:1234/catalog" },
  processId: 1,
  frameId: 1,
};

function fixture(options: { processed?: boolean } = {}) {
  const catalog: CatalogEntry[] = [
    { id: "cluster-a", name: "demo", kubeConfigPath: "/synthetic/a", contextName: "kind-a" },
    { id: "cluster-b", name: "other", kubeConfigPath: "/synthetic/b", contextName: "kind-b" },
  ];
  const handlers = new Map<string, (event: IpcEvent, payload: unknown) => Promise<unknown>>();
  const broadcasts: unknown[] = [];
  const registrar: Registrar = {
    handle: (channel, handler) => handlers.set(channel, handler),
    broadcast: (channel, ...args) => broadcasts.push([channel, ...args]),
  };
  const created: DiagnosticObject = {
    metadata: { name: "freelens-velero-x", namespace: "velero", uid: "uid" },
    spec: {},
  };
  const adapter = {
    assertCurrent: vi.fn(),
    createGenerated: vi.fn(async () => created),
    read: vi.fn(
      async (): Promise<DiagnosticObject> =>
        options.processed === false
          ? { ...created, status: {} }
          : {
              ...created,
              status: { phase: "Processed", serverVersion: "v1.18.2", processedTimestamp: "t", plugins: [] },
            },
    ),
  };
  const gate = new WriteGate({
    catalog: () => catalog,
    connection: () => ({ supported: true, credential: "token" }),
    adapter: () => adapter as never,
  });
  const dispose = registerHandlers(registrar, { catalog: () => catalog, gate, pollMs: 5 });
  const call = (channel: string, event: IpcEvent, payload: unknown) => {
    const handler = handlers.get(channel);

    if (!handler) throw new Error(`no handler for ${channel}`);
    return handler(event, payload);
  };
  const enable = () =>
    call(CHANNELS.gateEnable, FRAME_A, {
      cluster: "cluster-a",
      namespace: "velero",
      confirmation: { context: "kind-a", namespace: "velero" },
    });

  return { catalog, handlers, broadcasts, adapter, call, enable, dispose };
}

describe("the sender of a request", () => {
  it("is the frame of a cluster, keyed by its cluster, its process and its frame", () => {
    expect(senderOf(FRAME_A)).toEqual({ cluster: "cluster-a", key: "cluster-a:1:4" });
    expect(senderOf(FRAME_B)).toEqual({ cluster: "cluster-b", key: "cluster-b:1:9" });
  });

  it("is nothing for the window of the host and for an event that names no frame", () => {
    expect(senderOf(WINDOW)).toBeUndefined();
    expect(senderOf({ senderFrame: null, processId: 1, frameId: 1 })).toBeUndefined();
    expect(senderOf({ processId: 1, frameId: 1 })).toBeUndefined();
    expect(
      senderOf({ senderFrame: { url: "https://cluster-a.renderer.freelens.app/" }, processId: 1.5, frameId: 1 }),
    ).toBeUndefined();
  });
});

describe("the procedures of the main process", () => {
  it("registers every procedure of the contract", () => {
    const { handlers, dispose } = fixture();

    expect([...handlers.keys()].sort()).toEqual(
      [
        CHANNELS.gateState,
        CHANNELS.gateEnable,
        CHANNELS.gateDisable,
        CHANNELS.writeConfirm,
        CHANNELS.writeRun,
        CHANNELS.writeStatus,
        CHANNELS.writeCancel,
      ].sort(),
    );
    dispose();
  });

  it("answers the state of the gate of the frame, off at the start, and refuses another cluster and the window", async () => {
    const { call, dispose } = fixture();

    await expect(call(CHANNELS.gateState, FRAME_A, { cluster: "cluster-a" })).resolves.toEqual({
      ok: true,
      value: { cluster: { id: "cluster-a", name: "demo", context: "kind-a" }, writes: { on: false } },
    });
    await expect(call(CHANNELS.gateState, FRAME_B, { cluster: "cluster-a" })).resolves.toMatchObject({
      ok: false,
      code: "forbidden",
      stage: "frame",
    });
    await expect(call(CHANNELS.gateState, WINDOW, { cluster: "cluster-a" })).resolves.toMatchObject({
      ok: false,
      code: "forbidden",
      stage: "frame",
    });
    dispose();
  });

  it("refuses a request the contract does not know, without raising", async () => {
    const { call, dispose } = fixture();

    for (const payload of [undefined, null, "cluster-a", { cluster: "cluster-a", more: true }, { cluster: 1 }, []]) {
      await expect(call(CHANNELS.gateState, FRAME_A, payload)).resolves.toMatchObject({
        ok: false,
        code: "validation",
        stage: "request",
      });
    }
    dispose();
  });

  it("turns writes on with the confirmation, then confirms and runs a ServerStatusRequest for that frame", async () => {
    const { call, enable, adapter, dispose } = fixture();

    await expect(enable()).resolves.toMatchObject({ ok: true, value: { writes: { on: true, namespace: "velero" } } });
    const confirmed = (await call(CHANNELS.writeConfirm, FRAME_A, {
      cluster: "cluster-a",
      namespace: "velero",
      kind: "ServerStatusRequest",
    })) as { ok: true; value: { token: string } };

    expect(confirmed.ok).toBe(true);
    const request = randomUUID();
    const run = {
      cluster: "cluster-a",
      namespace: "velero",
      kind: "ServerStatusRequest",
      token: confirmed.value.token,
      request,
    };

    await expect(call(CHANNELS.writeRun, FRAME_A, run)).resolves.toEqual({
      ok: true,
      value: { version: "v1.18.2", processed: "t", plugins: [], request: { name: "freelens-velero-x", uid: "uid" } },
    });
    expect(adapter.createGenerated).toHaveBeenCalledOnce();
    await expect(call(CHANNELS.writeStatus, FRAME_A, { cluster: "cluster-a", request })).resolves.toEqual({
      ok: true,
      value: { step: "done" },
    });
    await expect(call(CHANNELS.writeStatus, FRAME_B, { cluster: "cluster-b", request })).resolves.toMatchObject({
      ok: false,
      code: "forbidden",
    });
    // The token was used: a second run with it is refused, and creates nothing.
    await expect(call(CHANNELS.writeRun, FRAME_A, { ...run, request: randomUUID() })).resolves.toMatchObject({
      ok: false,
      code: "forbidden",
      stage: "confirmation",
    });
    expect(adapter.createGenerated).toHaveBeenCalledOnce();
    dispose();
  });

  it("refuses a write while writes are off, and one of a kind this version does not run", async () => {
    const { call, enable, adapter, dispose } = fixture();

    await expect(
      call(CHANNELS.writeConfirm, FRAME_A, { cluster: "cluster-a", namespace: "velero", kind: "ServerStatusRequest" }),
    ).resolves.toMatchObject({ ok: false, code: "forbidden", stage: "gate" });
    await enable();
    await expect(
      call(CHANNELS.writeRun, FRAME_A, {
        cluster: "cluster-a",
        namespace: "velero",
        kind: "DownloadRequest",
        target: { kind: "Backup", name: "nightly", uid: "uid" },
        artifact: "BackupLog",
        token: randomUUID(),
        request: randomUUID(),
      }),
    ).resolves.toMatchObject({ ok: false, code: "validation", stage: "kind" });
    expect(adapter.createGenerated).not.toHaveBeenCalled();
    dispose();
  });

  it("says that the server did not answer, and leaves the request, when it is not processed in time", async () => {
    const { call, enable, adapter, dispose } = fixture({ processed: false });

    await enable();
    const confirmed = (await call(CHANNELS.writeConfirm, FRAME_A, {
      cluster: "cluster-a",
      namespace: "velero",
      kind: "ServerStatusRequest",
    })) as { ok: true; value: { token: string } };
    const request = randomUUID();
    // The wait of the server status is ten seconds: the request is cancelled from the frame instead.
    const running = call(CHANNELS.writeRun, FRAME_A, {
      cluster: "cluster-a",
      namespace: "velero",
      kind: "ServerStatusRequest",
      token: confirmed.value.token,
      request,
    });

    await vi.waitFor(() => expect(adapter.read).toHaveBeenCalled());
    await expect(call(CHANNELS.writeCancel, FRAME_B, { cluster: "cluster-b", request })).resolves.toMatchObject({
      ok: false,
      code: "forbidden",
    });
    await expect(call(CHANNELS.writeCancel, FRAME_A, { cluster: "cluster-a", request })).resolves.toEqual({
      ok: true,
      value: null,
    });
    await expect(running).resolves.toMatchObject({ ok: false, code: "cancelled", retry: true });
    expect(Object.keys(adapter)).not.toContain("delete");
    dispose();
  });

  it("turns writes off and tells the frame when the entry of the catalog goes", async () => {
    const { catalog, call, enable, broadcasts, dispose } = fixture();

    await enable();
    catalog.splice(0, 1);
    await vi.waitFor(() => expect(broadcasts).toContainEqual([CHANNELS.gateChanged, { cluster: "cluster-a" }]));
    await expect(call(CHANNELS.gateState, FRAME_A, { cluster: "cluster-a" })).resolves.toMatchObject({
      ok: false,
      code: "target-changed",
    });
    dispose();
  });

  it("answers a failure of the handler as a result, never as a raised error", async () => {
    const catalog: CatalogEntry[] = [
      { id: "cluster-a", name: "demo", kubeConfigPath: "/synthetic/a", contextName: "kind-a" },
    ];
    const handlers = new Map<string, (event: IpcEvent, payload: unknown) => Promise<unknown>>();
    const gate = new WriteGate({
      catalog: () => catalog,
      adapter: () => ({ assertCurrent: () => undefined }),
    });

    // A gate that fails in a way the contract does not foresee.
    gate.state = () => {
      throw new Error("PRIVATE-SENTINEL");
    };
    const dispose = registerHandlers(
      { handle: (channel, handler) => handlers.set(channel, handler), broadcast: () => undefined },
      { catalog: () => catalog, gate: gate as never },
    );
    const handler = handlers.get(CHANNELS.gateState);
    const answer = await handler?.(FRAME_A, { cluster: "cluster-a" });

    expect(answer).toMatchObject({ ok: false, code: "request-failed", stage: "handler" });
    expect(JSON.stringify(answer)).not.toContain("PRIVATE-SENTINEL");
    dispose();
  });
});
