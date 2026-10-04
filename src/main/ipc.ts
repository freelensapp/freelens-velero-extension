// The procedures the renderer calls of the main process, and what binds them: every request is validated,
// every sender is the frame of one cluster, and every answer is a result. Nothing is raised to the
// renderer, nothing is broadcast of a write, and the catalog of the host is where a cluster is resolved.

import { Main } from "@freelensapp/extensions";
import { clusterOfAddress, senderKey } from "../common/frame";
import {
  type Answer,
  CHANNELS,
  type Failure,
  failure,
  REQUEST_LABELS,
  readGateDisableRequest,
  readGateEnableRequest,
  readGateStateRequest,
  readWriteCancelRequest,
  readWriteConfirmRequest,
  readWriteRunRequest,
  readWriteStatusRequest,
} from "../common/ipc";
import { DiagnosticKubernetes } from "./diagnostic-kubernetes";
import { readServerStatus, serverStatusFailure } from "./server-status";
import { type CatalogEntry, WriteGate } from "./write-gate";

// What a handler is given of the event of the host: the frame that sent the request.
export interface IpcEvent {
  senderFrame?: { url: string } | null;
  processId: number;
  frameId: number;
}

export interface Sender {
  cluster: string;
  key: string;
}

// The frame of an event, as its cluster and its key; nothing for the window of the host and for what
// names no frame.
export function senderOf(event: IpcEvent): Sender | undefined {
  let address: unknown;

  // The host raises when the frame of an event was disposed: that is the frame of no cluster.
  try {
    address = event.senderFrame?.url;
  } catch {
    return;
  }
  if (typeof address !== "string" || !Number.isInteger(event.processId) || !Number.isInteger(event.frameId)) return;
  const cluster = clusterOfAddress(address);

  return cluster ? { cluster, key: senderKey(cluster, event.processId, event.frameId) } : undefined;
}

// The frame of a write went, or is not the frame of that cluster any more.
class SenderGone extends Error {}

const SENDER_GONE = () =>
  failure("forbidden", "frame", false, "The frame that asked for the write is not there any more.");

const CATALOG_POLL = 5_000;
// How often a write in flight looks whether its frame is still there.
const FRAME_WATCH = 250;

type Handler = (event: IpcEvent, payload: unknown) => Promise<unknown>;

// What registers the procedures: the IPC of the host, or a fake of the tests.
export interface Registrar {
  handle(channel: string, handler: Handler): void;
  broadcast(channel: string, ...args: unknown[]): void;
}

export interface HandlersDependencies {
  catalog(): CatalogEntry[];
  gate?: WriteGate<DiagnosticKubernetes>;
  pollMs?: number;
}

// The handlers, registered on what is given: the class below gives them the IPC of the host.
export function registerHandlers(registrar: Registrar, dependencies: HandlersDependencies): () => void {
  const gate =
    dependencies.gate ??
    new WriteGate<DiagnosticKubernetes>({
      catalog: dependencies.catalog,
      adapter: (entry, isCurrent) =>
        new DiagnosticKubernetes(
          { clusterId: entry.id, context: entry.contextName, kubeconfigPath: entry.kubeConfigPath },
          isCurrent,
          { ...REQUEST_LABELS },
        ),
    });
  let poll: ReturnType<typeof setInterval> | undefined;
  const watch = () => {
    if (!poll)
      poll = setInterval(() => {
        // What the catalog or a frame raises now is asked again at the next turn.
        try {
          gate.reconcile();
        } catch {
          /* the next turn */
        }
      }, dependencies.pollMs ?? CATALOG_POLL);
  };
  const stopChanged = gate.onChanged((cluster) => registrar.broadcast(CHANNELS.gateChanged, { cluster }));

  // A procedure: the request read by its reader, the sender bound to its frame, the answer a result.
  // `still` says whether the frame of the request is still the same frame of the same cluster.
  const procedure = <Request extends { cluster: string }, Value>(
    channel: string,
    read: (payload: unknown) => Request | undefined,
    answer: (sender: Sender, request: Request, still: () => boolean) => Promise<Answer<Value>> | Answer<Value>,
  ) => {
    registrar.handle(channel, async (event, payload) => {
      try {
        const sender = senderOf(event);

        if (!sender)
          return failure("forbidden", "frame", false, "The request does not come from the frame of a cluster.");
        const request = read(payload);

        if (!request)
          return failure("validation", "request", false, "The request is not one the main process understands.");
        if (request.cluster !== sender.cluster)
          return failure("forbidden", "frame", false, "The request names a cluster that is not the one of its frame.");
        return await answer(sender, request, () => senderOf(event)?.key === sender.key);
      } catch {
        return failure("request-failed", "handler", false, "The main process could not answer the request.");
      }
    });
  };

  procedure(CHANNELS.gateState, readGateStateRequest, (_sender, request) => gate.state(request.cluster));
  procedure(CHANNELS.gateEnable, readGateEnableRequest, (sender, request, still) => {
    const answer = gate.enable(request.cluster, request.namespace, request.confirmation, {
      key: sender.key,
      alive: still,
    });

    if (answer.ok) watch();
    return answer;
  });
  procedure(CHANNELS.gateDisable, readGateDisableRequest, (_sender, request) => gate.disable(request.cluster));
  procedure(CHANNELS.writeConfirm, readWriteConfirmRequest, (sender, request) =>
    gate.confirm(sender.key, request.cluster, request.namespace, request.kind, request.target),
  );
  procedure(CHANNELS.writeStatus, readWriteStatusRequest, (sender, request) =>
    gate.status(sender.key, request.cluster, request.request),
  );
  procedure(CHANNELS.writeCancel, readWriteCancelRequest, (sender, request) =>
    gate.cancel(sender.key, request.cluster, request.request),
  );
  procedure(CHANNELS.writeRun, readWriteRunRequest, async (sender, request, still) => {
    if (request.kind !== "ServerStatusRequest")
      return failure(
        "validation",
        "kind",
        false,
        "The log, the results, the resources and the volumes of an operation come with a later version of the extension.",
      );
    const taken = gate.take(
      sender.key,
      request.cluster,
      request.namespace,
      request.kind,
      request.target,
      request.token,
      request.request,
    );

    if (!taken.ok) return taken;
    const { adapter, write } = taken.value;
    let name: string | undefined;
    // While the write runs its frame is watched: a frame that goes aborts it, so that nothing is
    // submitted for it after a wait, as the one for a plugin that gives the credential.
    const watching = setInterval(
      () => {
        if (!still()) write.controller.abort();
      },
      Math.min(dependencies.pollMs ?? FRAME_WATCH, FRAME_WATCH),
    );

    try {
      const value = await readServerStatus(adapter, request.namespace, {
        signal: write.controller.signal,
        onStep: (step, count) => {
          // The frame is checked again before the object is submitted.
          if (step === "creating" && !still()) throw new SenderGone();
          write.status = count === undefined ? { step } : { step, count };
          if (step === "waiting" && count === 0) name = "created";
        },
      });

      // And again before the result is given.
      if (!still()) throw new SenderGone();
      write.status = { step: "done" };
      return { ok: true, value };
    } catch (error) {
      const failed: Failure =
        error instanceof SenderGone || !still() ? SENDER_GONE() : serverStatusFailure(error, name);

      write.status = { step: `failed: ${failed.code}` };
      return failed;
    } finally {
      clearInterval(watching);
      gate.finish(request.cluster, request.request);
    }
  });

  return () => {
    if (poll) clearInterval(poll);
    poll = undefined;
    stopChanged();
    gate.dispose();
  };
}

// The IPC of the extension in the main process. One for the extension, made when it is activated.
export class VeleroIpc extends Main.Ipc {
  private dispose?: () => void;

  register(catalog: () => CatalogEntry[]): void {
    this.dispose?.();
    this.dispose = registerHandlers(
      {
        handle: (channel, handler) => this.handle(channel, (event, payload) => handler(event as IpcEvent, payload)),
        broadcast: (channel, ...args) => this.broadcast(channel, ...args),
      },
      { catalog },
    );
  }

  release(): void {
    this.dispose?.();
    this.dispose = undefined;
  }
}

// The clusters of the catalog of the host, as the gate reads them.
export function catalogEntries(): CatalogEntry[] {
  return Main.Catalog.getAllClusters().map((cluster) => ({
    id: cluster.id,
    name: cluster.name,
    kubeConfigPath: cluster.kubeConfigPath,
    contextName: cluster.contextName,
  }));
}
