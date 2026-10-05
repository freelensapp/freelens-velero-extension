// The procedures of what the operator allows the downloads to do: given and taken back by the frame of a
// cluster, for that cluster alone, and kept where the main process reads them before a connection.

import { describe, expect, it } from "vitest";
import { ALLOWANCES_BOUND, type Allowances } from "../common/allowances";
import { CHANNELS } from "../common/ipc";
import { registerHandlers } from "./ipc";

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
const WINDOW: IpcEvent = { senderFrame: { url: "https://renderer.freelens.app:1234/" }, processId: 1, frameId: 1 };
const ORIGIN = "https://storage.example:9000";

function fixture(initial: Allowances = {}) {
  const handlers = new Map<string, (event: IpcEvent, payload: unknown) => Promise<unknown>>();
  const registrar: Registrar = {
    handle: (channel, handler) => handlers.set(channel, handler),
    broadcast: () => undefined,
  };
  // The store of the test: what was last written, as the store of the preferences answers.
  const stored = { allowances: initial, writes: 0 };
  let now = 1_700_000_000_000;
  const dispose = registerHandlers(registrar, {
    catalog: () => [
      { id: "cluster-a", name: "demo", kubeConfigPath: "/synthetic/a", contextName: "kind-a" },
      { id: "cluster-b", name: "other", kubeConfigPath: "/synthetic/b", contextName: "kind-b" },
    ],
    allowances: {
      read: () => stored.allowances,
      write: (next) => {
        stored.allowances = next;
        stored.writes += 1;
      },
    },
    now: () => now,
  });
  const call = (channel: string, event: IpcEvent, payload: unknown) => {
    const handler = handlers.get(channel);

    if (!handler) throw new Error(`no handler for ${channel}`);
    return handler(event, payload) as Promise<{ ok: boolean; value?: unknown; code?: string; stage?: string }>;
  };

  return {
    stored,
    call,
    dispose,
    tick: (milliseconds: number) => {
      now += milliseconds;
    },
  };
}

describe("the procedures of what the operator allows", () => {
  it("keeps an allowance for the cluster of the frame that gave it, with the time, and answers nothing else", async () => {
    const { stored, call, tick, dispose } = fixture();

    await expect(
      call(CHANNELS.allowanceGrant, FRAME_A, {
        cluster: "cluster-a",
        what: "origin",
        origin: ORIGIN,
        location: "velero/default",
      }),
    ).resolves.toEqual({ ok: true, value: null });
    tick(5000);
    await expect(
      call(CHANNELS.allowanceGrant, FRAME_A, { cluster: "cluster-a", what: "private", origin: ORIGIN }),
    ).resolves.toEqual({ ok: true, value: null });
    expect(stored.allowances).toEqual({
      "cluster-a": [
        { what: "origin", origin: ORIGIN, location: "velero/default", since: 1_700_000_000_000 },
        { what: "private", origin: ORIGIN, since: 1_700_000_005_000 },
      ],
    });
    // Given again, it keeps its time, and nothing is written.
    const writes = stored.writes;

    tick(5000);
    await call(CHANNELS.allowanceGrant, FRAME_A, { cluster: "cluster-a", what: "private", origin: ORIGIN });
    expect(stored.allowances["cluster-a"]?.[1].since).toBe(1_700_000_005_000);
    expect(stored.writes).toBe(writes);
    dispose();
  });

  it("takes an allowance back for the cluster of the frame that asks, and leaves the others", async () => {
    const { stored, call, dispose } = fixture({
      "cluster-a": [
        { what: "origin", origin: ORIGIN, location: "velero/default", since: 1 },
        { what: "private", origin: ORIGIN, since: 2 },
      ],
      "cluster-b": [{ what: "private", origin: ORIGIN, since: 3 }],
    });

    await expect(
      call(CHANNELS.allowanceRevoke, FRAME_A, { cluster: "cluster-a", what: "private", origin: ORIGIN }),
    ).resolves.toEqual({ ok: true, value: null });
    expect(stored.allowances).toEqual({
      "cluster-a": [{ what: "origin", origin: ORIGIN, location: "velero/default", since: 1 }],
      "cluster-b": [{ what: "private", origin: ORIGIN, since: 3 }],
    });
    // One that is not there is taken back all the same: the answer is that it is not allowed any more.
    await expect(
      call(CHANNELS.allowanceRevoke, FRAME_A, { cluster: "cluster-a", what: "http", origin: ORIGIN }),
    ).resolves.toEqual({ ok: true, value: null });
    expect(stored.writes).toBe(1);
    dispose();
  });

  it("refuses the frame of another cluster, the window of the host and a request that is not one, and keeps nothing", async () => {
    const { stored, call, dispose } = fixture();

    for (const channel of [CHANNELS.allowanceGrant, CHANNELS.allowanceRevoke]) {
      await expect(
        call(channel, FRAME_B, { cluster: "cluster-a", what: "private", origin: ORIGIN }),
      ).resolves.toMatchObject({ ok: false, code: "forbidden", stage: "frame" });
      await expect(
        call(channel, WINDOW, { cluster: "cluster-a", what: "private", origin: ORIGIN }),
      ).resolves.toMatchObject({ ok: false, code: "forbidden", stage: "frame" });
      for (const broken of [
        { cluster: "cluster-a", what: "private", origin: `${ORIGIN}/bucket/key?X-Amz-Signature=synthetic` },
        { cluster: "cluster-a", what: "origin", origin: ORIGIN },
        { cluster: "cluster-a", what: "everything", origin: ORIGIN },
        { cluster: "cluster-a", what: "private", origin: ORIGIN, since: 1 },
      ])
        await expect(call(channel, FRAME_A, broken)).resolves.toMatchObject({
          ok: false,
          code: "validation",
          stage: "request",
        });
    }
    expect(stored).toEqual({ allowances: {}, writes: 0 });
    dispose();
  });

  it("says that a cluster holds as many as it may, and keeps no more", async () => {
    const { stored, call, dispose } = fixture({
      "cluster-a": Array.from({ length: ALLOWANCES_BOUND }, (_, index) => ({
        what: "private" as const,
        origin: `https://s${index}.example`,
        since: index,
      })),
    });

    await expect(
      call(CHANNELS.allowanceGrant, FRAME_A, { cluster: "cluster-a", what: "private", origin: ORIGIN }),
    ).resolves.toMatchObject({ ok: false, code: "forbidden", stage: "allowances", retry: false });
    expect(stored.allowances["cluster-a"]).toHaveLength(ALLOWANCES_BOUND);
    expect(stored.writes).toBe(0);
    dispose();
  });

  it("answers that nothing keeps an allowance where the store of the preferences is not there", async () => {
    const handlers = new Map<string, (event: IpcEvent, payload: unknown) => Promise<unknown>>();
    const dispose = registerHandlers(
      { handle: (channel, handler) => handlers.set(channel, handler), broadcast: () => undefined },
      { catalog: () => [] },
    );
    const grant = handlers.get(CHANNELS.allowanceGrant);

    await expect(grant?.(FRAME_A, { cluster: "cluster-a", what: "private", origin: ORIGIN })).resolves.toMatchObject({
      ok: false,
      code: "request-failed",
      stage: "allowances",
    });
    dispose();
  });
});
