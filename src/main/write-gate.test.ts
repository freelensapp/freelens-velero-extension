import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { CONFIRMATIONS_BOUND, TOKEN_LIFETIME, WRITES_BOUND, WriteGate } from "./write-gate";

import type { Connection } from "../common/ipc";
import type { CatalogEntry } from "./write-gate";

function fixture(options: { connection?: Connection; adapterFails?: boolean; disposeFails?: boolean } = {}) {
  let now = 1_700_000_000_000;
  const catalog: CatalogEntry[] = [
    { id: "cluster-a", name: "demo", kubeConfigPath: "/synthetic/a", contextName: "kind-a" },
    { id: "cluster-b", name: "other", kubeConfigPath: "/synthetic/b", contextName: "kind-b" },
  ];
  let current = true;
  const adapters: { entry: CatalogEntry; isCurrent: () => boolean }[] = [];
  // The adapters the gate let go, by the cluster of each, in the order they were let go.
  const disposed: string[] = [];
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
        dispose: () => {
          disposed.push(entry.id);
          if (options.disposeFails) throw new Error("the adapter could not close");
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
    disposed,
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

  it("gives a token for one artifact of its target: the log that was confirmed is not the results", () => {
    const { gate, confirmation } = fixture();
    const target = { kind: "Backup" as const, name: "nightly", uid: "uid-1" };

    gate.enable("cluster-a", "velero", confirmation);
    const confirmed = gate.confirm("frame-1", "cluster-a", "velero", "DownloadRequest", target, "BackupLog");

    expect(confirmed).toMatchObject({ ok: true });
    if (!confirmed.ok) return;
    const { token } = confirmed.value;
    const take = (artifact?: "BackupLog" | "BackupResults") =>
      gate.take("frame-1", "cluster-a", "velero", "DownloadRequest", target, token, randomUUID(), artifact);

    // Another artifact of the same target, and no artifact at all, are not what was confirmed; the token
    // is still good for the one that was.
    expect(take("BackupResults")).toMatchObject({ ok: false, code: "forbidden", stage: "confirmation" });
    expect(take()).toMatchObject({ ok: false, code: "forbidden", stage: "confirmation" });
    expect(take("BackupLog")).toMatchObject({ ok: true, value: { write: { kind: "DownloadRequest" } } });
    expect(take("BackupLog")).toMatchObject({ ok: false, code: "forbidden", stage: "confirmation" });
    // A confirmation of no artifact is not one of an artifact.
    const bare = gate.confirm("frame-1", "cluster-a", "velero", "DownloadRequest", target);

    expect(
      gate.take(
        "frame-1",
        "cluster-a",
        "velero",
        "DownloadRequest",
        target,
        bare.ok ? bare.value.token : "",
        randomUUID(),
        "BackupLog",
      ),
    ).toMatchObject({ ok: false, code: "forbidden", stage: "confirmation" });
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

  it("refuses to turn writes on for a connection the adapter does not take, with the reason, and says it in the state", () => {
    const { gate, confirmation, adapters } = fixture({ connection: { supported: false, reason: "proxy" } });
    const refused = gate.enable("cluster-a", "velero", confirmation);

    expect(refused).toMatchObject({ ok: false, code: "connection-unsupported", stage: "connection", retry: false });
    expect(refused.ok ? "" : refused.text).toContain("proxy");
    expect(adapters).toHaveLength(0);
    expect(gate.state("cluster-a")).toMatchObject({
      ok: true,
      value: { writes: { on: false }, connection: { supported: false, reason: "proxy" } },
    });
    expect(gate.confirm("s", "cluster-a", "velero", "ServerStatusRequest", undefined)).toMatchObject({
      ok: false,
      code: "forbidden",
      stage: "gate",
    });
  });

  it("refuses to turn writes on as a target that changed when the file or the context is not there", () => {
    for (const reason of ["file", "context"] as const) {
      const { gate, confirmation } = fixture({ connection: { supported: false, reason } });

      expect(gate.enable("cluster-a", "velero", confirmation)).toMatchObject({
        ok: false,
        code: "target-changed",
        stage: reason,
      });
      expect(gate.state("cluster-a")).toMatchObject({ ok: true, value: { writes: { on: false } } });
    }
  });

  it("refuses to turn writes on when the adapter cannot be made, and says the connection is not usable", () => {
    const { gate, confirmation } = fixture({ adapterFails: true });

    expect(gate.enable("cluster-a", "velero", confirmation)).toMatchObject({
      ok: false,
      code: "connection-unsupported",
      stage: "connection",
    });
    expect(gate.state("cluster-a")).toMatchObject({
      ok: true,
      value: { writes: { on: false }, connection: { supported: false, reason: "unusable" } },
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

  it("lets the adapter go, with what it kept open, every time writes go off, and after the writes it carried were aborted", () => {
    const { gate, catalog, adapters, disposed, confirmation, change } = fixture();

    // Off on request.
    gate.enable("cluster-a", "velero", confirmation);
    expect(disposed).toEqual([]);
    gate.disable("cluster-a");
    expect(disposed).toEqual(["cluster-a"]);
    // On for another namespace: the adapter of the first is let go, and another is made.
    gate.enable("cluster-a", "velero", confirmation);
    const confirmed = gate.confirm("s", "cluster-a", "velero", "ServerStatusRequest", undefined);
    const taken = gate.take(
      "s",
      "cluster-a",
      "velero",
      "ServerStatusRequest",
      undefined,
      confirmed.ok ? confirmed.value.token : "",
      randomUUID(),
    );
    let abortedBefore: boolean | undefined;

    if (taken.ok)
      taken.value.adapter.dispose = () => {
        abortedBefore = taken.value.write.controller.signal.aborted;
        disposed.push("cluster-a");
      };
    gate.enable("cluster-a", "other", { context: "kind-a", namespace: "other" });
    expect(disposed).toEqual(["cluster-a", "cluster-a"]);
    expect(abortedBefore).toBe(true);
    expect(adapters).toHaveLength(3);
    // The connection changed under a confirmation.
    change();
    gate.confirm("s", "cluster-a", "other", "ServerStatusRequest", undefined);
    expect(disposed).toHaveLength(3);
    // The entry of the catalog changed, found when the gate looks at the catalog.
    gate.enable("cluster-b", "velero", { context: "kind-b", namespace: "velero" });
    catalog[1] = { ...catalog[1], kubeConfigPath: "/synthetic/other" };
    gate.reconcile();
    expect(disposed).toEqual(["cluster-a", "cluster-a", "cluster-a", "cluster-b"]);
  });

  it("lets every adapter go when it is disposed, and goes off for an adapter that cannot close", () => {
    const { gate, disposed, confirmation } = fixture({ disposeFails: true });

    gate.enable("cluster-a", "velero", confirmation);
    gate.enable("cluster-b", "velero", { context: "kind-b", namespace: "velero" });
    expect(gate.disable("cluster-a")).toMatchObject({ ok: true, value: { writes: { on: false } } });
    gate.dispose();
    expect(disposed).toEqual(["cluster-a", "cluster-b"]);
    expect(gate.state("cluster-b")).toMatchObject({ ok: true, value: { writes: { on: false } } });
  });

  it("leaves nothing on when it is disposed", () => {
    const { gate, confirmation } = fixture();

    gate.enable("cluster-a", "velero", confirmation);
    gate.dispose();
    expect(gate.state("cluster-a")).toMatchObject({ ok: true, value: { writes: { on: false } } });
  });
});

describe("the frame that turned writes on, and what the gate tells", () => {
  const owner = (state: { alive: boolean }) => ({ key: "cluster-a:1:4", alive: () => state.alive });

  it("turns writes off when the frame that turned them on is gone, aborts its writes and tells it", () => {
    const { gate, confirmation } = fixture();
    const frame = { alive: true };
    const told: string[] = [];

    gate.onChanged((cluster) => told.push(cluster));
    expect(gate.enable("cluster-a", "velero", confirmation, owner(frame))).toMatchObject({ ok: true });
    const confirmed = gate.confirm("cluster-a:1:4", "cluster-a", "velero", "ServerStatusRequest", undefined);

    if (!confirmed.ok) throw new Error("not confirmed");
    const taken = gate.take(
      "cluster-a:1:4",
      "cluster-a",
      "velero",
      "ServerStatusRequest",
      undefined,
      confirmed.value.token,
      randomUUID(),
    );

    if (!taken.ok) throw new Error("not taken");
    expect(taken.value.write.controller.signal.aborted).toBe(false);
    expect(told).toEqual([]);

    frame.alive = false;
    expect(gate.state("cluster-a")).toMatchObject({ ok: true, value: { writes: { on: false } } });
    expect(taken.value.write.controller.signal.aborted).toBe(true);
    expect(told).toEqual(["cluster-a"]);
    expect(gate.confirm("cluster-a:1:4", "cluster-a", "velero", "ServerStatusRequest", undefined)).toMatchObject({
      ok: false,
      code: "forbidden",
      stage: "gate",
    });
  });

  it("finds the frame gone when it reconciles, and treats a frame that cannot be asked as gone", () => {
    const { gate, confirmation } = fixture();
    const told: string[] = [];

    gate.onChanged((cluster) => told.push(cluster));
    gate.enable("cluster-a", "velero", confirmation, {
      key: "cluster-a:1:4",
      alive: () => {
        throw new Error("the frame was disposed");
      },
    });
    gate.reconcile();
    expect(told).toEqual(["cluster-a"]);
    expect(gate.state("cluster-a")).toMatchObject({ ok: true, value: { writes: { on: false } } });
  });

  it("keeps writes on while the frame is there, and for a gate turned on without a frame", () => {
    const { gate, confirmation } = fixture();
    const told: string[] = [];

    gate.onChanged((cluster) => told.push(cluster));
    gate.enable("cluster-a", "velero", confirmation, owner({ alive: true }));
    gate.reconcile();
    expect(gate.state("cluster-a")).toMatchObject({ ok: true, value: { writes: { on: true } } });
    expect(told).toEqual([]);
  });

  it("tells the frame when it turns writes off because the connection changed", () => {
    const { gate, confirmation, change } = fixture();
    const told: string[] = [];

    gate.onChanged((cluster) => told.push(cluster));
    gate.enable("cluster-a", "velero", confirmation);
    change();
    expect(gate.confirm("cluster-a:1:4", "cluster-a", "velero", "ServerStatusRequest", undefined)).toMatchObject({
      ok: false,
      code: "target-changed",
    });
    expect(told).toEqual(["cluster-a"]);
  });

  it("tells the frame when the entry of the catalog changed under a gate that was on", () => {
    const { gate, confirmation, catalog } = fixture();
    const told: string[] = [];

    gate.onChanged((cluster) => told.push(cluster));
    gate.enable("cluster-a", "velero", confirmation);
    catalog[0] = { ...catalog[0], contextName: "kind-renamed" };
    expect(gate.state("cluster-a")).toMatchObject({ ok: true, value: { writes: { on: false } } });
    expect(told).toEqual(["cluster-a"]);
  });

  it("says that what it held of a cluster is let go for a reason of its own, with writes on or off, and not on request", () => {
    const { gate, catalog, confirmation, change } = fixture();
    const told: string[] = [];
    const letGo: string[] = [];

    gate.onChanged((cluster) => told.push(cluster));
    const stop = gate.onLetGo((cluster) => letGo.push(cluster));

    // Writes turned on, then off on request, or on for another namespace: nothing is let go.
    gate.enable("cluster-a", "velero", confirmation);
    gate.disable("cluster-a");
    gate.enable("cluster-a", "velero", confirmation);
    gate.enable("cluster-a", "other", { context: "kind-a", namespace: "other" });
    gate.disable("cluster-a");
    expect(letGo).toEqual([]);
    // The entry changes after writes were turned off: the frames have nothing to be told, and what was
    // read from the cluster as it was is let go all the same.
    catalog[0] = { ...catalog[0], kubeConfigPath: "/synthetic/other" };
    gate.reconcile();
    expect(told).toEqual([]);
    expect(letGo).toEqual(["cluster-a"]);
    // With writes on, both are told: the connection that changed under a confirmation.
    gate.enable("cluster-b", "velero", { context: "kind-b", namespace: "velero" });
    change();
    gate.confirm("s", "cluster-b", "velero", "ServerStatusRequest", undefined);
    expect(told).toEqual(["cluster-b"]);
    expect(letGo).toEqual(["cluster-a", "cluster-b"]);
    // Who stopped listening is told nothing more.
    stop();
    gate.enable("cluster-b", "velero", { context: "kind-b", namespace: "velero" });
    catalog[1] = { ...catalog[1], contextName: "kind-other" };
    gate.reconcile();
    expect(letGo).toEqual(["cluster-a", "cluster-b"]);
  });

  it("tells nothing when writes are turned off on request, and nothing of a gate that was never on", () => {
    const { gate, confirmation, catalog } = fixture();
    const told: string[] = [];

    gate.onChanged((cluster) => told.push(cluster));
    gate.enable("cluster-a", "velero", confirmation);
    gate.disable("cluster-a");
    gate.enable("cluster-a", "velero", confirmation);
    gate.enable("cluster-a", "other", { context: "kind-a", namespace: "other" });
    expect(told).toEqual([]);
    // cluster-b was only asked its state: its entry goes, and there is nothing to tell.
    gate.state("cluster-b");
    catalog.splice(1, 1);
    gate.reconcile();
    expect(told).toEqual([]);
  });
});
