// The procedures the renderer calls of the main process, and what binds them: every request is validated,
// every sender is the frame of one cluster, and every answer is a result. Nothing is raised to the
// renderer, nothing is broadcast of a write, and the catalog of the host is where a cluster is resolved.

import { Main } from "@freelensapp/extensions";
import { type DownloadContext, downloadFailure } from "../common/diagnostic-text";
import { clusterOfAddress, senderKey } from "../common/frame";
import {
  type Answer,
  type ArtifactPage,
  type ArtifactTarget,
  type ArtifactValue,
  CHANNELS,
  type Failure,
  failure,
  REQUEST_LABELS,
  readArtifactPageRequest,
  readArtifactReleaseRequest,
  readGateDisableRequest,
  readGateEnableRequest,
  readGateStateRequest,
  readWriteCancelRequest,
  readWriteConfirmRequest,
  readWriteRunRequest,
  readWriteStatusRequest,
  type ServerStatusValue,
  type WriteRunRequest,
  type WriteTarget,
} from "../common/ipc";
import { ArtifactHolder } from "./artifact-holder";
import { CredentialPluginError, PLUGIN_TIMEOUT } from "./context-identity";
import { DiagnosticKubernetes } from "./diagnostic-kubernetes";
import { type DiagnosticOptions, runDownload } from "./diagnostic-service";
import { DiagnosticError } from "./diagnostic-transport";
import { readServerStatus, serverStatusFailure } from "./server-status";
import { type CatalogEntry, signatureOf, WriteGate } from "./write-gate";

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
  // The route to the store for a signed URL. Without one no DownloadRequest is created: the route of
  // the main process comes with its own slice, and the proof of the transport gives its own.
  route?: DiagnosticOptions["route"];
  // The bounds of the way of a download, which a test makes shorter, and what downloads for it.
  download?: Pick<DiagnosticOptions, "download" | "pollMs" | "urlTimeoutMs" | "totalMs" | "closeMs">;
  // What holds the texts of the artifacts, when a test looks into it.
  holder?: ArtifactHolder;
}

// The words of how a download ended, from what was raised: the code and the step of a failure of the
// way, the plugin of the context by its command, and nothing of what any of them carried.
export function downloadFailureOf(error: unknown, context: DownloadContext): Failure {
  if (error instanceof CredentialPluginError)
    return downloadFailure("request-failed", error.stage ?? "creation", {
      ...context,
      plugin: { command: error.command, reason: error.reason, seconds: PLUGIN_TIMEOUT / 1000 },
    });
  if (error instanceof DiagnosticError)
    return downloadFailure(
      error.code,
      error.stage ?? "request",
      error.verdict ? { ...context, verdict: error.verdict } : context,
    );
  return downloadFailure("request-failed", "handler", context);
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
  const holder = dependencies.holder ?? new ArtifactHolder();
  // The downloads that run, by their cluster and the identifier of their request: a request with the
  // identifier of one in flight joins it, and creates nothing.
  const downloads = new Map<string, { fingerprint: string; promise: Promise<Answer<ArtifactValue>> }>();
  // When the gate of a cluster changes for a reason of its own, its entry, its connection or the frame
  // that turned writes on, the frames are told when writes were on, and the texts held for that cluster
  // are let go whether they were or not: they were read from what the cluster was.
  const stopChanged = gate.onChanged((cluster) => registrar.broadcast(CHANNELS.gateChanged, { cluster }));
  const stopLetGo = gate.onLetGo((cluster) => holder.drop(cluster));

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
    gate.confirm(sender.key, request.cluster, request.namespace, request.kind, request.target, request.artifact),
  );
  procedure(CHANNELS.writeStatus, readWriteStatusRequest, (sender, request) =>
    gate.status(sender.key, request.cluster, request.request),
  );
  procedure(CHANNELS.writeCancel, readWriteCancelRequest, (sender, request) =>
    gate.cancel(sender.key, request.cluster, request.request),
  );
  // While a write runs its frame is watched: a frame that goes aborts it, so that nothing is submitted
  // for it after a wait, as the one for a plugin that gives the credential.
  const watchFrame = (still: () => boolean, controller: AbortController) =>
    setInterval(
      () => {
        if (!still()) controller.abort();
      },
      Math.min(dependencies.pollMs ?? FRAME_WATCH, FRAME_WATCH),
    );

  const serverStatus = async (
    sender: Sender,
    request: WriteRunRequest,
    still: () => boolean,
  ): Promise<Answer<ServerStatusValue>> => {
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
    const watching = watchFrame(still, write.controller);

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
  };

  // The way of a DownloadRequest, for the artifact of the target that was confirmed: the text is held
  // here, and what is answered is how much there is of it and the route it came by. The signed URL
  // stays in the way.
  const download = async (
    sender: Sender,
    request: WriteRunRequest,
    still: () => boolean,
    route: DiagnosticOptions["route"],
  ): Promise<Answer<ArtifactValue>> => {
    const target = request.target as WriteTarget;
    const artifact = request.artifact as ArtifactTarget;
    const taken = gate.take(
      sender.key,
      request.cluster,
      request.namespace,
      request.kind,
      target,
      request.token,
      request.request,
      artifact,
    );

    if (!taken.ok) return taken;
    const { adapter, write } = taken.value;
    // The name the request has in the cluster, once it is there.
    const context: DownloadContext = {
      artifact,
      name: target.name,
      namespace: request.namespace,
      request: `${target.name}-${request.request}`,
    };
    const watching = watchFrame(still, write.controller);

    try {
      const result = await runDownload(
        adapter,
        {
          requestId: request.request,
          namespace: request.namespace,
          target: artifact,
          name: target.name,
          uid: target.uid,
        },
        write.controller.signal,
        {
          ...dependencies.download,
          route,
          onStep: (stage, count) => {
            // The frame is checked again before the object is submitted.
            if (stage === "creation" && !still()) throw new SenderGone();
            write.status = count === undefined ? { step: stage } : { step: stage, count };
          },
        },
      );

      // And again before the text is held for it. A write the gate aborted, because writes went off or it
      // was cancelled, has no result: the way delivers nothing of an operation that was stopped.
      if (!still()) throw new SenderGone();
      const held = holder.hold(request.cluster, sender.key, request.request, result.content);

      write.status = { step: "done" };
      return {
        ok: true,
        value: {
          request: result.request,
          size: held.size,
          pages: held.pages,
          route: {
            mode: result.route.mode === "tunnel" ? "tunnel" : "direct",
            encrypted: result.route.encrypted,
            origin: result.route.origin,
          },
        },
      };
    } catch (error) {
      const failed: Failure =
        error instanceof SenderGone || !still() ? SENDER_GONE() : downloadFailureOf(error, context);

      write.status = { step: `failed: ${failed.code}` };
      return failed;
    } finally {
      clearInterval(watching);
      gate.finish(request.cluster, request.request);
    }
  };

  procedure<WriteRunRequest, ServerStatusValue | ArtifactValue>(
    CHANNELS.writeRun,
    readWriteRunRequest,
    (sender, request, still) => {
      if (request.kind === "ServerStatusRequest") return serverStatus(sender, request, still);
      const route = dependencies.route;

      // Nothing is created for an artifact while the main process has no route to its store.
      if (!route)
        return failure(
          "validation",
          "kind",
          false,
          "The log, the results, the resources and the volumes of an operation come with a later version of the extension.",
        );
      const key = `${request.cluster}/${request.request}`;
      const fingerprint = JSON.stringify([
        sender.key,
        signatureOf(request.namespace, request.kind, request.target, request.artifact),
        request.token,
      ]);
      const running = downloads.get(key);

      // The same request of the same frame, sent again while it runs, is given the same answer.
      if (running)
        return running.fingerprint === fingerprint
          ? running.promise
          : failure("forbidden", "request", false, "No write of this frame has this identifier.");
      const promise = download(sender, request, still, route).finally(() => downloads.delete(key));

      downloads.set(key, { fingerprint, promise });
      return promise;
    },
  );
  procedure<{ cluster: string; request: string; page: number }, ArtifactPage>(
    CHANNELS.artifactPage,
    readArtifactPageRequest,
    (sender, request) => {
      const page = holder.page(request.cluster, sender.key, request.request, request.page);

      return page
        ? { ok: true, value: page }
        : failure(
            "not-found",
            "delivery",
            false,
            "The text of this artifact is not held for this frame: it was let go, or it has no such page.",
          );
    },
  );
  procedure<{ cluster: string; request: string }, null>(
    CHANNELS.artifactRelease,
    readArtifactReleaseRequest,
    (sender, request) => {
      holder.release(request.cluster, sender.key, request.request);
      return { ok: true, value: null };
    },
  );

  return () => {
    if (poll) clearInterval(poll);
    poll = undefined;
    stopChanged();
    stopLetGo();
    holder.dispose();
    gate.dispose();
  };
}

// The IPC of the extension in the main process. One for the extension, made when it is activated.
export class VeleroIpc extends Main.Ipc {
  private dispose?: () => void;

  // `more` is what the procedures are given beside the catalog: the route to the store, when there is one.
  register(catalog: () => CatalogEntry[], more: Omit<HandlersDependencies, "catalog"> = {}): void {
    this.dispose?.();
    this.dispose = registerHandlers(
      {
        handle: (channel, handler) => this.handle(channel, (event, payload) => handler(event as IpcEvent, payload)),
        broadcast: (channel, ...args) => this.broadcast(channel, ...args),
      },
      { ...more, catalog },
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
