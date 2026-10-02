// The gate every write of the extension passes, held by the main process: off when the session starts,
// on for one cluster and one namespace at a time, turned on with a confirmation that names the context
// and the namespace, and each write confirmed for one exact target, from the frame that asks it, with a
// token good for thirty seconds and for one use. The renderer shows a mirror of what is here and decides
// nothing.

import { randomUUID } from "node:crypto";
import {
  CONNECTION_REASONS,
  type Connection,
  type ConnectionReason,
  type Failure,
  failure,
  type GateState,
  type WriteKind,
  type WriteStatus,
  type WriteTarget,
} from "../common/ipc";
import { readContext } from "./context-identity";

// A cluster as the catalog of the host gives it to the main process.
export interface CatalogEntry {
  id: string;
  name: string;
  kubeConfigPath: string;
  contextName: string;
}

// What a write needs of the cluster: made when writes are turned on for a connection the adapter takes.
export interface GateAdapter {
  assertCurrent(): void;
}

export interface GateDependencies<Adapter extends GateAdapter> {
  // The clusters the catalog holds now.
  catalog(): CatalogEntry[];
  // The adapter of a cluster, for the entry of the catalog; `isCurrent` says whether the entry is still
  // the same in the catalog.
  adapter(entry: CatalogEntry, isCurrent: () => boolean): Adapter;
  // Reads the entry of the context of the kubeconfig, to say what its connection is.
  connection?(entry: CatalogEntry): Connection;
  now?(): number;
}

// The frame that turned writes on: when it goes, writes go off with it.
export interface GateOwner {
  // The key of the sender, as the procedures know it.
  key: string;
  // Whether the frame is still there, and still the frame of that cluster.
  alive(): boolean;
}

// The state the gate holds of one cluster.
interface ClusterGate<Adapter> {
  entry: CatalogEntry;
  namespace?: string;
  since?: number;
  owner?: GateOwner;
  connection?: Connection;
  adapter?: Adapter;
  confirmations: Map<string, { sender: string; signature: string; expires: number }>;
  writes: Map<string, Write>;
}

export interface Write {
  sender: string;
  kind: WriteKind;
  status: WriteStatus;
  controller: AbortController;
  done: boolean;
}

export const TOKEN_LIFETIME = 30_000;
export const CONFIRMATIONS_BOUND = 32;
export const WRITES_BOUND = 16;

function connectionOfEntry(entry: CatalogEntry): Connection {
  const read = readContext(entry.kubeConfigPath, entry.contextName);

  if ("missing" in read) return { supported: false, reason: read.missing === "file" ? "file" : "context" };
  return read.connection;
}

function sameEntry(one: CatalogEntry, other: CatalogEntry | undefined): boolean {
  return (
    !!other &&
    one.id === other.id &&
    one.kubeConfigPath === other.kubeConfigPath &&
    one.contextName === other.contextName
  );
}

// Why writes are not turned on for a connection: a file or a context that is not there is a target that
// changed, anything else is a connection the writes of the extension do not use.
function refusalOf(reason: ConnectionReason): Failure {
  return reason === "file" || reason === "context"
    ? failure("target-changed", reason, false, CONNECTION_REASONS[reason])
    : failure("connection-unsupported", "connection", false, CONNECTION_REASONS[reason]);
}

export function signatureOf(namespace: string, kind: WriteKind, target: WriteTarget | undefined): string {
  return JSON.stringify([namespace, kind, target ? [target.kind, target.name, target.uid] : null]);
}

export class WriteGate<Adapter extends GateAdapter> {
  private readonly clusters = new Map<string, ClusterGate<Adapter>>();
  private readonly listeners = new Set<(cluster: string) => void>();

  constructor(private readonly dependencies: GateDependencies<Adapter>) {}

  private now(): number {
    return this.dependencies.now?.() ?? Date.now();
  }

  // The entry of the catalog for a cluster, or the failure that says it is not there.
  private entryOf(cluster: string): CatalogEntry | Failure {
    const entry = this.dependencies.catalog().find((item) => item.id === cluster);

    if (!entry) return failure("target-changed", "catalog", false, "The cluster is not in the catalog any more.");
    return entry;
  }

  private gateOf(cluster: string): ClusterGate<Adapter> | Failure {
    const entry = this.entryOf(cluster);

    if ("ok" in entry) return entry;
    const held = this.clusters.get(cluster);

    // The entry changed its file or its context: what was held is of another cluster. The frame that
    // turned writes on went: they are off with it. Both are reasons of the gate itself, and are told.
    if (held && (!sameEntry(entry, held.entry) || this.ownerGone(held))) this.invalidate(cluster, true);
    const gate = this.clusters.get(cluster) ?? { entry, confirmations: new Map(), writes: new Map() };

    this.clusters.set(cluster, gate);
    return gate;
  }

  // Whether writes are on for a frame that is not there any more. A frame that cannot be asked is gone.
  private ownerGone(gate: ClusterGate<Adapter>): boolean {
    if (!gate.namespace || !gate.owner) return false;
    try {
      return !gate.owner.alive();
    } catch {
      return true;
    }
  }

  private stateOf(gate: ClusterGate<Adapter>): GateState {
    return {
      cluster: { id: gate.entry.id, name: gate.entry.name, context: gate.entry.contextName },
      writes:
        gate.namespace && gate.since !== undefined
          ? { on: true, namespace: gate.namespace, since: gate.since }
          : { on: false },
      ...(gate.connection ? { connection: gate.connection } : {}),
    };
  }

  state(cluster: string): { ok: true; value: GateState } | Failure {
    const gate = this.gateOf(cluster);

    if ("ok" in gate) return gate;
    return { ok: true, value: this.stateOf(gate) };
  }

  // Turns writes on for one namespace of one cluster. The confirmation must name the context of the
  // entry and the namespace, as the dialog showed them. The owner is the frame that asked: writes stay on
  // while it is there.
  enable(
    cluster: string,
    namespace: string,
    confirmation: { context: string; namespace: string },
    owner?: GateOwner,
  ): { ok: true; value: GateState } | Failure {
    const gate = this.gateOf(cluster);

    if ("ok" in gate) return gate;
    if (confirmation.context !== gate.entry.contextName || confirmation.namespace !== namespace)
      return failure(
        "forbidden",
        "confirmation",
        false,
        "The confirmation does not name this context and this namespace.",
      );
    // On for another namespace: off first, and what was confirmed or running for it goes.
    if (gate.namespace && gate.namespace !== namespace) this.invalidate(cluster);
    const held = this.gateOf(cluster);

    if ("ok" in held) return held;
    held.connection = (this.dependencies.connection ?? connectionOfEntry)(held.entry);
    if (held.connection.supported && !held.adapter) {
      try {
        held.adapter = this.dependencies.adapter(held.entry, () =>
          sameEntry(held.entry, this.entryOf(cluster) as CatalogEntry),
        );
      } catch {
        held.connection = { supported: false, reason: "unusable" };
      }
    }
    // A connection the adapter does not take: writes are not turned on, and what was on for it goes. The
    // state keeps what the adapter said of the connection.
    if (!held.connection.supported) {
      const connection = held.connection;

      this.invalidate(cluster);
      const off = this.gateOf(cluster);

      if (!("ok" in off)) off.connection = connection;
      return refusalOf(connection.reason);
    }
    held.namespace = namespace;
    held.since = this.now();
    held.owner = owner;
    return { ok: true, value: this.stateOf(held) };
  }

  disable(cluster: string): { ok: true; value: GateState } | Failure {
    const gate = this.gateOf(cluster);

    if ("ok" in gate) return gate;
    this.invalidate(cluster);
    const off = this.gateOf(cluster);

    return "ok" in off ? off : { ok: true, value: this.stateOf(off) };
  }

  // Writes off, the confirmations cleared, the writes in flight aborted on this side. When the reason is
  // one of the gate itself, and writes were on, the frames are told: their mirror asks the state again.
  invalidate(cluster: string, told = false): void {
    const gate = this.clusters.get(cluster);

    if (!gate) return;
    for (const write of gate.writes.values()) write.controller.abort();
    this.clusters.delete(cluster);
    if (told && gate.namespace) for (const listener of this.listeners) listener(cluster);
  }

  // A confirmation for one exact target, for the frame that asks it.
  confirm(
    sender: string,
    cluster: string,
    namespace: string,
    kind: WriteKind,
    target: WriteTarget | undefined,
  ): { ok: true; value: { token: string; expires: number } } | Failure {
    const gate = this.gateOf(cluster);

    if ("ok" in gate) return gate;
    const refused = this.open(gate, namespace);

    if (refused) return refused;
    for (const [token, held] of gate.confirmations) if (held.expires <= this.now()) gate.confirmations.delete(token);
    if (gate.confirmations.size >= CONFIRMATIONS_BOUND)
      return failure(
        "forbidden",
        "confirmation",
        true,
        "Too many writes wait for their confirmation: confirm or leave them first.",
      );
    const token = randomUUID();
    const expires = this.now() + TOKEN_LIFETIME;

    gate.confirmations.set(token, { sender, signature: signatureOf(namespace, kind, target), expires });
    return { ok: true, value: { token, expires } };
  }

  // Whether writes are on for this namespace, and the connection is one the adapter takes.
  private open(gate: ClusterGate<Adapter>, namespace: string): Failure | undefined {
    if (!gate.namespace || gate.namespace !== namespace)
      return failure(
        "forbidden",
        "gate",
        false,
        "Writes are off for this installation: turn them on in the target bar.",
      );
    if (!gate.connection?.supported || !gate.adapter)
      return failure(
        "connection-unsupported",
        "connection",
        false,
        "The connection of this cluster is not one the writes of the extension can use.",
      );
    try {
      gate.adapter.assertCurrent();
    } catch {
      this.invalidate(gate.entry.id, true);
      return failure("target-changed", "connection", false, "The connection of this cluster changed: writes are off.");
    }
    return undefined;
  }

  // Takes a token for a write: the write may run, with the adapter of the cluster, when the token is of
  // this sender, of this target, and has not expired or been used.
  take(
    sender: string,
    cluster: string,
    namespace: string,
    kind: WriteKind,
    target: WriteTarget | undefined,
    token: string,
    request: string,
  ): { ok: true; value: { adapter: Adapter; write: Write } } | Failure {
    const gate = this.gateOf(cluster);

    if ("ok" in gate) return gate;
    const refused = this.open(gate, namespace);

    if (refused) return refused;
    const held = gate.confirmations.get(token);

    if (
      !held ||
      held.sender !== sender ||
      held.signature !== signatureOf(namespace, kind, target) ||
      held.expires <= this.now()
    )
      return failure(
        "forbidden",
        "confirmation",
        false,
        "The write was not confirmed, or its confirmation expired: confirm it again.",
      );
    if (gate.writes.has(request))
      return failure("conflict", "request", false, "A write with this identifier is already running.");
    if ([...gate.writes.values()].filter((write) => !write.done).length >= WRITES_BOUND)
      return failure("forbidden", "writes", true, "Too many writes are running for this cluster: wait for one to end.");
    gate.confirmations.delete(token);
    const write: Write = {
      sender,
      kind,
      status: { step: "confirmed" },
      controller: new AbortController(),
      done: false,
    };

    gate.writes.set(request, write);
    return { ok: true, value: { adapter: gate.adapter as Adapter, write } };
  }

  // A write ended: it stays known for its status, and is forgotten among the last ones.
  finish(cluster: string, request: string): void {
    const gate = this.clusters.get(cluster);
    const write = gate?.writes.get(request);

    if (!gate || !write) return;
    write.done = true;
    const done = [...gate.writes.entries()].filter(([, item]) => item.done);

    for (const [key] of done.slice(0, Math.max(0, done.length - 256))) gate.writes.delete(key);
  }

  status(sender: string, cluster: string, request: string): { ok: true; value: WriteStatus } | Failure {
    const write = this.clusters.get(cluster)?.writes.get(request);

    if (!write || write.sender !== sender)
      return failure("forbidden", "request", false, "No write of this frame has this identifier.");
    return { ok: true, value: write.status };
  }

  cancel(sender: string, cluster: string, request: string): { ok: true; value: null } | Failure {
    const write = this.clusters.get(cluster)?.writes.get(request);

    if (!write || write.sender !== sender)
      return failure("forbidden", "request", false, "No write of this frame has this identifier.");
    write.controller.abort();
    return { ok: true, value: null };
  }

  // Every cluster whose entry went or changed in the catalog, or whose frame went, is turned off, and
  // told when writes were on.
  reconcile(): void {
    const catalog = this.dependencies.catalog();

    for (const [cluster, gate] of [...this.clusters]) {
      const changed = !sameEntry(
        gate.entry,
        catalog.find((item) => item.id === cluster),
      );

      if (changed || this.ownerGone(gate)) this.invalidate(cluster, true);
    }
  }

  onChanged(listener: (cluster: string) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  // Everything off: the extension is deactivated.
  dispose(): void {
    for (const cluster of [...this.clusters.keys()]) this.invalidate(cluster);
    this.listeners.clear();
  }
}
