import { randomUUID } from "node:crypto";
import { describe, expect, expectTypeOf, it, vi } from "vitest";
import { CLUSTER_WORDS } from "../common/diagnostic-text";
import { CHANNELS } from "../common/ipc";
import { ArtifactHolder } from "./artifact-holder";
import { registerHandlers, senderOf } from "./ipc";
import { WriteGate } from "./write-gate";

import type { IpcMainInvokeEvent } from "electron";

import type { CatalogEntry } from "./catalog";
import type { DiagnosticKubernetes, DiagnosticObject } from "./diagnostic-kubernetes";
import type { IpcEvent, Registrar } from "./ipc";

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
    { id: "cluster-a", name: "demo", kubeConfigPath: "/synthetic/a", contextName: "kind-a", status: "connected" },
    { id: "cluster-b", name: "other", kubeConfigPath: "/synthetic/b", contextName: "kind-b", status: "connected" },
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
              status: { phase: "Processed", serverVersion: "v1.18.4", processedTimestamp: "t", plugins: [] },
            },
    ),
  };
  // What the write asks of the adapter is recorded: a write that asked for anything but its three calls,
  // as a deletion would be, is seen.
  const asked: string[] = [];
  const watched = new Proxy(adapter, {
    get: (target, property, receiver) => {
      asked.push(String(property));
      return Reflect.get(target, property, receiver);
    },
  });
  const gate = new WriteGate({
    catalog: () => catalog,
    adapter: () => watched as never,
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

  return { catalog, handlers, broadcasts, adapter, asked, call, enable, dispose };
}

describe("the sender of a request", () => {
  it("is the frame of a cluster, keyed by its cluster, its process and its frame", () => {
    expect(senderOf(FRAME_A)).toEqual({ cluster: "cluster-a", key: "cluster-a:1:4" });
    expect(senderOf(FRAME_B)).toEqual({ cluster: "cluster-b", key: "cluster-b:1:9" });
  });

  it("is read from the addresses of the frames of v2, of the packaged application and of development", () => {
    expect(
      senderOf({ senderFrame: { url: "https://cluster-a.renderer.freelens.app/" }, processId: 3, frameId: 7 }),
    ).toEqual({ cluster: "cluster-a", key: "cluster-a:3:7" });
    expect(
      senderOf({
        senderFrame: { url: "http://cluster-a.localhost:9191/extension/freelensapp--velero-extension/backups" },
        processId: 3,
        frameId: 8,
      }),
    ).toEqual({ cluster: "cluster-a", key: "cluster-a:3:8" });
    // The window of development, and a frame of an address the host never writes for a cluster.
    expect(
      senderOf({ senderFrame: { url: "http://localhost:9191/#/catalog" }, processId: 3, frameId: 1 }),
    ).toBeUndefined();
    expect(
      senderOf({ senderFrame: { url: "https://storage.example.invalid/" }, processId: 3, frameId: 9 }),
    ).toBeUndefined();
  });

  it("reads of the event of Electron what the compiler checks against its type, and nothing else", () => {
    // The event of a handler of the host is the IpcMainInvokeEvent of Electron: what the procedures read of
    // it is typed from that declaration, so that a field Electron renamed or retyped fails the type check.
    expectTypeOf<IpcMainInvokeEvent>().toExtend<IpcEvent>();
    expectTypeOf<IpcEvent["processId"]>().toEqualTypeOf<number>();
    expectTypeOf<IpcEvent["frameId"]>().toEqualTypeOf<number>();
    expectTypeOf<NonNullable<IpcEvent["senderFrame"]>["url"]>().toEqualTypeOf<string>();
    const read: string[] = [];
    const event = new Proxy(
      { senderFrame: { url: "https://cluster-a.renderer.freelens.app/" }, processId: 1, frameId: 4 },
      {
        get: (target, property, receiver) => {
          read.push(String(property));
          return Reflect.get(target, property, receiver);
        },
      },
    );

    expect(senderOf(event)).toEqual({ cluster: "cluster-a", key: "cluster-a:1:4" });
    expect([...new Set(read)].sort()).toEqual(["frameId", "processId", "senderFrame"]);
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
        CHANNELS.artifactPage,
        CHANNELS.artifactRelease,
        CHANNELS.artifactSave,
        CHANNELS.allowanceGrant,
        CHANNELS.allowanceRevoke,
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
      value: { version: "v1.18.4", processed: "t", plugins: [], request: { name: "freelens-velero-x", uid: "uid" } },
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

  it("refuses a write while writes are off, and the run of an artifact no confirmation gave a token for", async () => {
    const { call, enable, adapter, dispose } = fixture();

    await expect(
      call(CHANNELS.writeConfirm, FRAME_A, { cluster: "cluster-a", namespace: "velero", kind: "ServerStatusRequest" }),
    ).resolves.toMatchObject({ ok: false, code: "forbidden", stage: "gate" });
    await enable();
    // The run of a DownloadRequest goes its way from this version on: without a token of a confirmation
    // it is refused as every write is, and the cluster is not asked.
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
    ).resolves.toMatchObject({ ok: false, code: "forbidden", stage: "confirmation" });
    expect(adapter.createGenerated).not.toHaveBeenCalled();
    expect(adapter.read).not.toHaveBeenCalled();
    dispose();
  });

  it("says that the server did not answer, and leaves the request, when it is not processed in time", async () => {
    const { call, enable, adapter, asked, dispose } = fixture({ processed: false });

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
    // The request stays in the cluster: a cancelled write asks the adapter for nothing but what it ran.
    expect([...new Set(asked)].sort()).toEqual(["assertCurrent", "createGenerated", "read"]);
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
      { id: "cluster-a", name: "demo", kubeConfigPath: "/synthetic/a", contextName: "kind-a", status: "connected" },
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

describe("the frame of a write, checked again", () => {
  const run = (token: string) => ({
    cluster: "cluster-a",
    namespace: "velero",
    kind: "ServerStatusRequest",
    token,
    request: randomUUID(),
  });
  const confirmFrom = async (call: ReturnType<typeof fixture>["call"], event: IpcEvent) => {
    const confirmed = (await call(CHANNELS.writeConfirm, event, {
      cluster: "cluster-a",
      namespace: "velero",
      kind: "ServerStatusRequest",
    })) as { ok: true; value: { token: string } };

    return confirmed.value.token;
  };

  it("does not submit the object when the frame is another at the creation", async () => {
    const { call, adapter, dispose } = fixture();
    const frame = { url: "https://cluster-a.renderer.freelens.app:1234/" };
    const event: IpcEvent = { ...FRAME_A, senderFrame: frame };

    await call(CHANNELS.gateEnable, event, {
      cluster: "cluster-a",
      namespace: "velero",
      confirmation: { context: "kind-a", namespace: "velero" },
    });
    const token = await confirmFrom(call, event);
    // The request is accepted from the frame of the cluster; when the write reaches the creation the
    // frame shows the window of the host.
    let reads = 0;
    const leaving = { processId: 1, frameId: 4 } as IpcEvent;

    Object.defineProperty(leaving, "senderFrame", {
      get: () => (reads++ === 0 ? frame : { url: "https://renderer.freelens.app:1234/catalog" }),
    });
    expect(await call(CHANNELS.writeRun, leaving, run(token))).toMatchObject({
      ok: false,
      code: "forbidden",
      stage: "frame",
    });
    expect(adapter.createGenerated).not.toHaveBeenCalled();
    dispose();
  });

  it("aborts a write whose frame goes while the object waits to be submitted", async () => {
    const { call, adapter, enable, dispose } = fixture();
    // Writes were turned on from an event whose frame stays: only the event of the write loses its frame,
    // so it is the watch of the write that sees it, and not the gate that finds its owner gone.
    const event: IpcEvent = { ...FRAME_A, senderFrame: { url: "https://cluster-a.renderer.freelens.app:1234/" } };

    await enable();
    const token = await confirmFrom(call, event);
    let submitted = false;

    // The adapter is busy before it submits, as when a plugin gives the credential: it stops when the
    // write is aborted, and would submit otherwise.
    adapter.createGenerated.mockImplementationOnce(
      (...args: unknown[]) =>
        new Promise<DiagnosticObject>((resolve, reject) => {
          const signal = args[3] as AbortSignal;
          const late = setTimeout(() => {
            submitted = true;
            resolve({ metadata: { name: "freelens-velero-x", namespace: "velero", uid: "uid" }, spec: {} });
          }, 2_000);

          signal.addEventListener("abort", () => {
            clearTimeout(late);
            reject(new Error("aborted"));
          });
        }),
    );
    const answer = call(CHANNELS.writeRun, event, run(token));

    event.senderFrame = null;
    expect(await answer).toMatchObject({ ok: false, code: "forbidden", stage: "frame" });
    expect(submitted).toBe(false);
    dispose();
  });

  it("does not give the result to a frame that went while the write ran", async () => {
    const { call, adapter, dispose } = fixture();
    const event: IpcEvent = { ...FRAME_A, senderFrame: { url: "https://cluster-a.renderer.freelens.app:1234/" } };

    await call(CHANNELS.gateEnable, event, {
      cluster: "cluster-a",
      namespace: "velero",
      confirmation: { context: "kind-a", namespace: "velero" },
    });
    const token = await confirmFrom(call, event);

    adapter.read.mockImplementationOnce(async () => {
      event.senderFrame = { url: "https://renderer.freelens.app:1234/catalog" };
      return {
        metadata: { name: "freelens-velero-x", namespace: "velero", uid: "uid" },
        spec: {},
        status: { phase: "Processed", serverVersion: "v1.18.4", processedTimestamp: "t", plugins: [] },
      };
    });
    expect(await call(CHANNELS.writeRun, event, run(token))).toMatchObject({
      ok: false,
      code: "forbidden",
      stage: "frame",
    });
    expect(adapter.createGenerated).toHaveBeenCalledTimes(1);
    dispose();
  });

  it("turns writes off and tells every frame when the frame that turned them on is gone", async () => {
    const { call, broadcasts, dispose } = fixture();
    const event: IpcEvent = { ...FRAME_A, senderFrame: { url: "https://cluster-a.renderer.freelens.app:1234/" } };

    await call(CHANNELS.gateEnable, event, {
      cluster: "cluster-a",
      namespace: "velero",
      confirmation: { context: "kind-a", namespace: "velero" },
    });
    expect(await call(CHANNELS.gateState, FRAME_A, { cluster: "cluster-a" })).toMatchObject({
      ok: true,
      value: { writes: { on: true } },
    });
    event.senderFrame = null;
    await vi.waitFor(() => expect(broadcasts).toContainEqual([CHANNELS.gateChanged, { cluster: "cluster-a" }]));
    expect(await call(CHANNELS.gateState, FRAME_A, { cluster: "cluster-a" })).toMatchObject({
      ok: true,
      value: { writes: { on: false } },
    });
    dispose();
  });

  it("takes an event whose frame cannot be read as the frame of no cluster", () => {
    const event = { processId: 1, frameId: 4 } as IpcEvent;

    Object.defineProperty(event, "senderFrame", {
      get: () => {
        throw new Error("Render frame was disposed before WebFrameMain could be accessed");
      },
    });
    expect(senderOf(event)).toBeUndefined();
  });
});

// A request of each procedure, valid for the contract, for a cluster: what the binding is checked with.
const REQUEST = randomUUID();
const ORIGIN = "https://storage.example:9000";
const PAYLOADS: Record<string, (cluster: string) => unknown> = {
  [CHANNELS.gateState]: (cluster) => ({ cluster }),
  [CHANNELS.gateEnable]: (cluster) => ({
    cluster,
    namespace: "velero",
    confirmation: { context: "kind-a", namespace: "velero" },
  }),
  [CHANNELS.gateDisable]: (cluster) => ({ cluster }),
  [CHANNELS.writeConfirm]: (cluster) => ({ cluster, namespace: "velero", kind: "ServerStatusRequest" }),
  [CHANNELS.writeRun]: (cluster) => ({
    cluster,
    namespace: "velero",
    kind: "ServerStatusRequest",
    token: randomUUID(),
    request: REQUEST,
  }),
  [CHANNELS.writeStatus]: (cluster) => ({ cluster, request: REQUEST }),
  [CHANNELS.writeCancel]: (cluster) => ({ cluster, request: REQUEST }),
  [CHANNELS.artifactPage]: (cluster) => ({ cluster, request: REQUEST, page: 0 }),
  [CHANNELS.artifactRelease]: (cluster) => ({ cluster, request: REQUEST }),
  [CHANNELS.artifactSave]: (cluster) => ({ cluster, request: REQUEST }),
  [CHANNELS.allowanceGrant]: (cluster) => ({ cluster, what: "origin", origin: ORIGIN, location: "velero/default" }),
  [CHANNELS.allowanceRevoke]: (cluster) => ({ cluster, what: "origin", origin: ORIGIN, location: "velero/default" }),
};

// The procedures with everything they could act on watched: the gate, the texts held, the allowances kept and
// the dialog of a saving. A request the binding refuses reaches none of them.
function watchedFixture() {
  const catalog: CatalogEntry[] = [
    { id: "cluster-a", name: "demo", kubeConfigPath: "/synthetic/a", contextName: "kind-a", status: "connected" },
    { id: "cluster-b", name: "other", kubeConfigPath: "/synthetic/b", contextName: "kind-b", status: "connected" },
  ];
  const handlers = new Map<string, (event: IpcEvent, payload: unknown) => Promise<unknown>>();
  const gate = new WriteGate<DiagnosticKubernetes>({
    catalog: () => catalog,
    adapter: () => ({ assertCurrent: () => undefined }) as never,
  });
  const holder = new ArtifactHolder();
  const reached = [
    ...(["state", "enable", "disable", "confirm", "take", "status", "cancel"] as const).map((name) =>
      vi.spyOn(gate, name),
    ),
    ...(["page", "release", "content"] as const).map((name) => vi.spyOn(holder, name)),
  ];
  const allowances = { read: vi.fn(() => ({})), write: vi.fn() };
  const save = vi.fn(async () => true);
  const dispose = registerHandlers(
    { handle: (channel, handler) => handlers.set(channel, handler), broadcast: () => undefined },
    { catalog: () => catalog, gate, holder, allowances, save, pollMs: 5 },
  );
  const call = (channel: string, event: IpcEvent, payload: unknown) => {
    const handler = handlers.get(channel);

    if (!handler) throw new Error(`no handler for ${channel}`);
    return handler(event, payload);
  };
  const untouched = () => {
    for (const spy of reached) expect(spy).not.toHaveBeenCalled();
    expect(allowances.read).not.toHaveBeenCalled();
    expect(allowances.write).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  };

  return { catalog, handlers, call, untouched, dispose };
}

describe("the binding of a request to its frame and to its cluster", () => {
  it("is checked by every procedure there is", () => {
    const { handlers, dispose } = watchedFixture();

    expect(Object.keys(PAYLOADS).sort()).toEqual([...handlers.keys()].sort());
    dispose();
  });

  it("refuses, on every procedure, the frame of a cluster that names another, the window, and a frame of no cluster", async () => {
    const { call, untouched, dispose } = watchedFixture();
    const frames: IpcEvent[] = [
      FRAME_B,
      WINDOW,
      { senderFrame: { url: "http://localhost:9191/" }, processId: 1, frameId: 2 },
      { senderFrame: null, processId: 1, frameId: 3 },
    ];

    for (const [channel, payload] of Object.entries(PAYLOADS)) {
      for (const frame of frames) {
        expect([channel, await call(channel, frame, payload("cluster-a"))]).toEqual([
          channel,
          expect.objectContaining({ ok: false, code: "forbidden", stage: "frame" }),
        ]);
      }
    }
    untouched();
    dispose();
  });

  it("refuses the frame of an address that carries what is not an identifier, whatever its request names", async () => {
    const { call, untouched, dispose } = watchedFixture();
    // The host reads the label of such an address as it is; the contract refuses it where a request names it.
    const odd: IpcEvent = { senderFrame: { url: "https://_.renderer.freelens.app/" }, processId: 1, frameId: 5 };

    expect(senderOf(odd)).toEqual({ cluster: "_", key: "_:1:5" });
    for (const [channel, payload] of Object.entries(PAYLOADS)) {
      expect(await call(channel, odd, payload("cluster-a"))).toMatchObject({
        ok: false,
        code: "forbidden",
        stage: "frame",
      });
      expect(await call(channel, odd, payload("_"))).toMatchObject({ ok: false, code: "validation", stage: "request" });
    }
    untouched();
    dispose();
  });

  it("refuses, on every procedure, a cluster the catalog does not give, and one it gives in a state that is not connected, and does nothing for either", async () => {
    const { catalog, call, untouched, dispose } = watchedFixture();

    for (const status of ["connecting", "disconnected", "disconnecting"]) {
      catalog[0] = { ...catalog[0], status };
      for (const [channel, payload] of Object.entries(PAYLOADS)) {
        expect([status, channel, await call(channel, FRAME_A, payload("cluster-a"))]).toEqual([
          status,
          channel,
          { ok: false, code: "target-changed", stage: "catalog", retry: false, text: CLUSTER_WORDS.disconnected },
        ]);
      }
    }
    catalog.splice(0, 1);
    for (const [channel, payload] of Object.entries(PAYLOADS)) {
      expect([channel, await call(channel, FRAME_A, payload("cluster-a"))]).toEqual([
        channel,
        { ok: false, code: "target-changed", stage: "catalog", retry: false, text: CLUSTER_WORDS.absent },
      ]);
    }
    untouched();
    dispose();
  });

  it("takes the request of the frame of a cluster the catalog gives as connected", async () => {
    const { call, dispose } = watchedFixture();

    expect(await call(CHANNELS.gateState, FRAME_A, PAYLOADS[CHANNELS.gateState]("cluster-a"))).toEqual({
      ok: true,
      value: { cluster: { id: "cluster-a", name: "demo", context: "kind-a" }, writes: { on: false } },
    });
    expect(await call(CHANNELS.allowanceGrant, FRAME_A, PAYLOADS[CHANNELS.allowanceGrant]("cluster-a"))).toEqual({
      ok: true,
      value: null,
    });
    dispose();
  });
});
