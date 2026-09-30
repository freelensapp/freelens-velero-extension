import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { CONFIRMATIONS_BOUND, TOKEN_LIFETIME, WRITES_BOUND, WriteGate } from "./write-gate";

import type { Connection } from "../common/ipc";
import type { CatalogEntry } from "./write-gate";

function fixture(options: { connection?: Connection; adapterFails?: boolean } = {}) {
  let now = 1_700_000_000_000;
  const catalog: CatalogEntry[] = [
    { id: "cluster-a", name: "demo", kubeConfigPath: "/synthetic/a", contextName: "kind-a" },
    { id: "cluster-b", name: "other", kubeConfigPath: "/synthetic/b", contextName: "kind-b" },
  ];
  let current = true;
  const adapters: { entry: CatalogEntry; isCurrent: () => boolean }[] = [];
  const gate = new WriteGate({
    catalog: () => catalog,
    connection: () => options.connection ?? { supported: true, credential: "token" },
    adapter: (entry, isCurrent) => {
      if (options.adapterFails) throw new Error("no adapter");
      adapters.push({ entry, isCurrent });
      return {
        assertCurrent: () => {
          if (!current) throw new Error("changed");
        },
      };
    },
    now: () => now,
  });
  const confirmation = { context: "kind-a", namespace: "velero" };

  return {
    gate,
    catalog,
    adapters,
    confirmation,
    tick: (milliseconds: number) => {
      now += milliseconds;
    },
    change: () => {
      current = false;
    },
  };
}

describe("the write gate", () => {
  it("is off when the session starts, and says so for a cluster of the catalog", () => {
    const { gate } = fixture();

    expect(gate.state("cluster-a")).toEqual({
      ok: true,
      value: { cluster: { id: "cluster-a", name: "demo", context: "kind-a" }, writes: { on: false } },
    });
    expect(gate.state("absent")).toMatchObject({ ok: false, code: "target-changed", stage: "catalog" });
  });

  it("turns writes on for one namespace with a confirmation that names the context and the namespace", () => {
    const { gate, confirmation, adapters } = fixture();

    expect(gate.enable("cluster-a", "velero", { context: "kind-b", namespace: "velero" })).toMatchObject({
      ok: false,
      code: "forbidden",
      stage: "confirmation",
    });
    expect(gate.enable("cluster-a", "velero", { context: "kind-a", namespace: "other" })).toMatchObject({
      ok: false,
      code: "forbidden",
    });
    expect(gate.enable("cluster-a", "velero", confirmation)).toEqual({
      ok: true,
      value: {
        cluster: { id: "cluster-a", name: "demo", context: "kind-a" },
        writes: { on: true, namespace: "velero", since: 1_700_000_000_000 },
        connection: { supported: true, credential: "token" },
      },
    });
    expect(adapters).toHaveLength(1);
    expect(adapters[0].entry.id).toBe("cluster-a");
    expect(gate.state("cluster-b")).toMatchObject({ ok: true, value: { writes: { on: false } } });
  });

  it("refuses a confirmation and a write while writes are off, or on for another namespace", () => {
    const { gate, confirmation } = fixture();

    expect(gate.confirm("s", "cluster-a", "velero", "ServerStatusRequest", undefined)).toMatchObject({
      ok: false,
      code: "forbidden",
      stage: "gate",
    });
    gate.enable("cluster-a", "velero", confirmation);
    expect(gate.confirm("s", "cluster-a", "other", "ServerStatusRequest", undefined)).toMatchObject({
      ok: false,
      code: "forbidden",
      stage: "gate",
    });
    expect(gate.confirm("s", "cluster-b", "velero", "ServerStatusRequest", undefined)).toMatchObject({
      ok: false,
      code: "forbidden",
      stage: "gate",
    });
  });

  it("gives a token for one target, for one sender, for one use, for thirty seconds", () => {
    const { gate, confirmation, tick } = fixture();
    const target = { kind: "Backup" as const, name: "nightly", uid: "uid-1" };

    gate.enable("cluster-a", "velero", confirmation);
    const confirmed = gate.confirm("frame-1", "cluster-a", "velero", "DownloadRequest", target);

    expect(confirmed).toMatchObject({ ok: true, value: { expires: 1_700_000_000_000 + TOKEN_LIFETIME } });
    if (!confirmed.ok) return;
    const { token } = confirmed.value;
    const request = randomUUID();

    expect(gate.take("frame-2", "cluster-a", "velero", "DownloadRequest", target, token, request)).toMatchObject({
      ok: false,
      code: "forbidden",
      stage: "confirmation",
    });
    expect(
      gate.take("frame-1", "cluster-a", "velero", "DownloadRequest", { ...target, uid: "uid-2" }, token, request),
    ).toMatchObject({ ok: false, code: "forbidden" });
    expect(gate.take("frame-1", "cluster-a", "velero", "ServerStatusRequest", undefined, token, request)).toMatchObject(
      {
        ok: false,
        code: "forbidden",
      },
    );
    expect(gate.take("frame-1", "cluster-a", "velero", "DownloadRequest", target, token, request)).toMatchObject({
      ok: true,
      value: { write: { sender: "frame-1", kind: "DownloadRequest", status: { step: "confirmed" } } },
    });
    expect(gate.take("frame-1", "cluster-a", "velero", "DownloadRequest", target, token, randomUUID())).toMatchObject({
      ok: false,
      code: "forbidden",
    });
    const later = gate.confirm("frame-1", "cluster-a", "velero", "DownloadRequest", target);

    tick(TOKEN_LIFETIME);
    expect(
      gate.take(
        "frame-1",
        "cluster-a",
        "velero",
        "DownloadRequest",
        target,
        later.ok ? later.value.token : "",
        randomUUID(),
      ),
    ).toMatchObject({ ok: false, code: "forbidden" });
  });

  it("bounds the confirmations that wait and the writes that run for a cluster", () => {
    const { gate, confirmation } = fixture();

    gate.enable("cluster-a", "velero", confirmation);
    const tokens: string[] = [];

    for (let index = 0; index < CONFIRMATIONS_BOUND; index++) {
      const confirmed = gate.confirm("s", "cluster-a", "velero", "ServerStatusRequest", undefined);

      expect(confirmed.ok).toBe(true);
      if (confirmed.ok) tokens.push(confirmed.value.token);
    }
    expect(gate.confirm("s", "cluster-a", "velero", "ServerStatusRequest", undefined)).toMatchObject({
      ok: false,
      code: "forbidden",
      retry: true,
    });
    for (let index = 0; index < WRITES_BOUND; index++) {
      expect(
        gate.take("s", "cluster-a", "velero", "ServerStatusRequest", undefined, tokens[index], randomUUID()).ok,
      ).toBe(true);
    }
    expect(
      gate.take("s", "cluster-a", "velero", "ServerStatusRequest", undefined, tokens[WRITES_BOUND], randomUUID()),
    ).toMatchObject({ ok: false, code: "forbidden", stage: "writes" });
  });

  it("gives the status and the cancellation of a write to the frame that asked it and to no other", () => {
    const { gate, confirmation } = fixture();

    gate.enable("cluster-a", "velero", confirmation);
    const confirmed = gate.confirm("frame-1", "cluster-a", "velero", "ServerStatusRequest", undefined);
    const request = randomUUID();
    const taken = gate.take(
      "frame-1",
      "cluster-a",
      "velero",
      "ServerStatusRequest",
      undefined,
      confirmed.ok ? confirmed.value.token : "",
      request,
    );

    expect(taken.ok).toBe(true);
    if (!taken.ok) return;
    taken.value.write.status = { step: "waiting", count: 2 };
    expect(gate.status("frame-1", "cluster-a", request)).toEqual({ ok: true, value: { step: "waiting", count: 2 } });
    expect(gate.status("frame-2", "cluster-a", request)).toMatchObject({ ok: false, code: "forbidden" });
    expect(gate.cancel("frame-2", "cluster-a", request)).toMatchObject({ ok: false, code: "forbidden" });
    expect(taken.value.write.controller.signal.aborted).toBe(false);
    expect(gate.cancel("frame-1", "cluster-a", request)).toEqual({ ok: true, value: null });
    expect(taken.value.write.controller.signal.aborted).toBe(true);
    gate.finish("cluster-a", request);
    expect(gate.status("frame-1", "cluster-a", request)).toEqual({ ok: true, value: { step: "waiting", count: 2 } });
  });

  it("turns writes off, clears the confirmations and aborts the writes when the target changes", () => {
    const { gate, confirmation } = fixture();

    gate.enable("cluster-a", "velero", confirmation);
    const confirmed = gate.confirm("s", "cluster-a", "velero", "ServerStatusRequest", undefined);
    const request = randomUUID();
    const taken = gate.take(
      "s",
      "cluster-a",
      "velero",
      "ServerStatusRequest",
      undefined,
      confirmed.ok ? confirmed.value.token : "",
      request,
    );
    const second = gate.confirm("s", "cluster-a", "velero", "ServerStatusRequest", undefined);

    expect(gate.enable("cluster-a", "other", { context: "kind-a", namespace: "other" })).toMatchObject({
      ok: true,
      value: { writes: { on: true, namespace: "other" } },
    });
    expect(taken.ok && taken.value.write.controller.signal.aborted).toBe(true);
    expect(
      gate.take(
        "s",
        "cluster-a",
        "other",
        "ServerStatusRequest",
        undefined,
        second.ok ? second.value.token : "",
        randomUUID(),
      ),
    ).toMatchObject({ ok: false, code: "forbidden" });
    expect(gate.disable("cluster-a")).toMatchObject({ ok: true, value: { writes: { on: false } } });
    expect(gate.confirm("s", "cluster-a", "other", "ServerStatusRequest", undefined)).toMatchObject({
      ok: false,
      code: "forbidden",
    });
  });

  it("turns writes off when the entry of the catalog goes or changes, and tells", () => {
    const { gate, confirmation, catalog } = fixture();
    const told: string[] = [];

    gate.onChanged((cluster) => told.push(cluster));
    gate.enable("cluster-a", "velero", confirmation);
    gate.enable("cluster-b", "velero", { context: "kind-b", namespace: "velero" });
    catalog[0] = { ...catalog[0], kubeConfigPath: "/synthetic/moved" };
    catalog.pop();
    gate.reconcile();
    expect(told.sort()).toEqual(["cluster-a", "cluster-b"]);
    expect(gate.state("cluster-a")).toMatchObject({ ok: true, value: { writes: { on: false } } });
    expect(gate.state("cluster-b")).toMatchObject({ ok: false, code: "target-changed" });
    expect(gate.confirm("s", "cluster-a", "velero", "ServerStatusRequest", undefined)).toMatchObject({
      ok: false,
      code: "forbidden",
    });
  });

  it("turns writes on for a connection the adapter does not take, and refuses every write with the reason", () => {
    const { gate, confirmation, adapters } = fixture({ connection: { supported: false, reason: "proxy" } });

    expect(gate.enable("cluster-a", "velero", confirmation)).toMatchObject({
      ok: true,
      value: { writes: { on: true }, connection: { supported: false, reason: "proxy" } },
    });
    expect(adapters).toHaveLength(0);
    expect(gate.confirm("s", "cluster-a", "velero", "ServerStatusRequest", undefined)).toMatchObject({
      ok: false,
      code: "connection-unsupported",
      stage: "connection",
    });
  });

  it("says the connection is not usable when the adapter cannot be made", () => {
    const { gate, confirmation } = fixture({ adapterFails: true });

    expect(gate.enable("cluster-a", "velero", confirmation)).toMatchObject({
      ok: true,
      value: { connection: { supported: false, reason: "context" } },
    });
  });

  it("turns writes off when the connection of the cluster changed under a confirmation", () => {
    const { gate, confirmation, change } = fixture();

    gate.enable("cluster-a", "velero", confirmation);
    change();
    expect(gate.confirm("s", "cluster-a", "velero", "ServerStatusRequest", undefined)).toMatchObject({
      ok: false,
      code: "target-changed",
    });
    expect(gate.state("cluster-a")).toMatchObject({ ok: true, value: { writes: { on: false } } });
  });

  it("leaves nothing on when it is disposed", () => {
    const { gate, confirmation } = fixture();

    gate.enable("cluster-a", "velero", confirmation);
    gate.dispose();
    expect(gate.state("cluster-a")).toMatchObject({ ok: true, value: { writes: { on: false } } });
  });
});
