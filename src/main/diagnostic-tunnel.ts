// The tunnel to the Pod of the store: `kubectl port-forward --address 127.0.0.1 --namespace <namespace>
// pod/<pod> :<port>`, run by the main process with the kubectl the host runs for the cluster, the
// environment the host gives for it as its whole environment, and the folder of the extension as its working
// directory. The environment reaches the cluster through the proxy of Freelens, with the identity of the
// connection of the host: the extension runs no credential plugin of its own.
//
// kubectl reads the Pod and opens its stream to the API server before it writes its line of readiness,
// `Forwarding from 127.0.0.1:<port>`, whose port is the one the transport connects to. The wait for that line
// is counted once kubectl is prepared: the host may download the kubectl of the version of the cluster
// first, which counts toward the bound of the whole operation and not toward this one. A refusal of the API
// server ends kubectl before the line, and is read from what kubectl writes, which stays in the main process.
//
// No tunnel outlives what it was opened for: kubectl is killed when its operation ends or is cancelled, when
// the extension is deactivated, when the process exits, and when the cluster leaves the connected state. A
// kubectl that has not exited some seconds after it was told to is killed for good and said.

import { type ChildProcess, type SpawnOptions, spawn as spawnProcess } from "node:child_process";
import { type CatalogEntry, CONNECTED, refusalOf } from "./catalog";
import { DiagnosticError } from "./diagnostic-transport";

export interface PodTarget {
  namespace: string;
  name: string;
  uid: string;
  port: number;
}

export interface PodTunnel {
  address: string;
  port: number;
  // Kills kubectl and waits for it to exit: one that has not exited within its bound is said.
  close(): Promise<void>;
}

// What the tunnel asks of the host for a cluster.
export interface TunnelHost {
  // The kubectl the host runs for the cluster, `Main.Shell.getKubectlPath(clusterId)`.
  kubectl(clusterId: string): Promise<string>;
  // The environment the host gives for the cluster, `Main.Shell.getEnvironment(clusterId)`.
  environment(clusterId: string): Promise<Record<string, string>>;
  // The entry of the cluster in the catalog of the host, which says why the host gave no kubectl.
  entry(clusterId: string): CatalogEntry | undefined;
  // Told the state of the cluster now and whenever it changes, until what it returns is called: a reaction
  // on `Main.Catalog.getClusterById(clusterId)?.status`.
  watchStatus(clusterId: string, listener: (status: string | undefined) => void): () => void;
  // The folder of the extension, the working directory of kubectl.
  cwd(): string;
}

export type Spawn = (command: string, args: string[], options: SpawnOptions) => ChildProcess;

export const TUNNEL_BOUNDS = {
  // From the end of the preparation of kubectl to its line of readiness.
  readyMs: 15_000,
  // From the moment kubectl is told to end to the moment it is said not to have.
  exitMs: 5_000,
} as const;

const LOOPBACK = "127.0.0.1";
// The port is taken once what follows it is there: a line cut inside its port is not read as a shorter one.
const READY = /^Forwarding from 127\.0\.0\.1:(\d+) -> /m;
// The refusal of the API server, as kubectl writes it: a port-forward is asked with the verb create, or
// with get and create over a WebSocket.
const PORT_FORWARD_REFUSED = /cannot (?:create|get) resource "pods\/portforward"/;
// A credential the cluster did not take, which says nothing of what the identity may do.
const UNAUTHORIZED = /\bUnauthorized\b/;
// How much of what kubectl writes is kept to read its refusal: the end of it.
const KEPT = 16 * 1024;
const LABEL = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
const SUBDOMAIN = /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/;

function kept(text: string): string {
  return text.length > KEPT ? text.slice(text.length - KEPT) : text;
}

// How kubectl that ended before its line of readiness ended: a refusal of the port-forward, a credential
// the cluster did not take, or anything else. Nothing of what it wrote is in what is raised.
function endOf(written: string): DiagnosticError {
  if (PORT_FORWARD_REFUSED.test(written)) return new DiagnosticError("forbidden");
  if (UNAUTHORIZED.test(written)) return new DiagnosticError("forbidden", undefined, "credential");
  return new DiagnosticError("transport-unreachable");
}

function isPod(pod: PodTarget): boolean {
  return (
    typeof pod?.namespace === "string" &&
    pod.namespace.length <= 63 &&
    LABEL.test(pod.namespace) &&
    typeof pod.name === "string" &&
    pod.name.length <= 253 &&
    SUBDOMAIN.test(pod.name) &&
    Number.isInteger(pod.port) &&
    pod.port >= 1 &&
    pod.port <= 65535
  );
}

// The kubectl of the extension: one for each tunnel, and every one of them killed when the procedures are
// let go, when the extension is deactivated, and when the process exits.
export class KubectlTunnels {
  private readonly running = new Set<{ stop(): Promise<boolean> }>();
  private closed = false;
  private unhook?: () => void;

  constructor(
    private readonly host: TunnelHost,
    private readonly spawn: Spawn = spawnProcess,
    // Where the hook of the exit of the process is put, and what takes it away.
    private readonly onExit: (listener: () => void) => () => void = (listener) => {
      process.once("exit", listener);
      return () => process.removeListener("exit", listener);
    },
  ) {}

  // How many kubectl of the extension have not exited.
  get count(): number {
    return this.running.size;
  }

  // Every kubectl told to end, and no other started: the extension is deactivated. What does not end within
  // its bound is killed for good.
  closeAll(): void {
    this.closed = true;
    for (const run of [...this.running]) void run.stop();
    this.unhook?.();
    this.unhook = undefined;
  }

  async open(clusterId: string, pod: PodTarget, signal: AbortSignal): Promise<PodTunnel> {
    // An abort before kubectl runs starts nothing.
    if (signal.aborted || this.closed) throw new DiagnosticError("cancelled");
    if (!isPod(pod)) throw new DiagnosticError("validation");
    let kubectl: string;
    let environment: Record<string, string>;

    try {
      [kubectl, environment] = await Promise.all([this.host.kubectl(clusterId), this.host.environment(clusterId)]);
    } catch {
      // The host gives no kubectl for a cluster that is not there or not connected: a target that changed,
      // as the catalog says it now. Otherwise kubectl cannot be had.
      const refused = refusalOf(this.entryOf(clusterId));

      throw refused
        ? new DiagnosticError("target-changed", undefined, refused)
        : new DiagnosticError("transport-unreachable");
    }
    if (signal.aborted || this.closed) throw new DiagnosticError("cancelled");
    if (typeof kubectl !== "string" || !kubectl || typeof environment !== "object" || environment === null)
      throw new DiagnosticError("transport-unreachable");
    let child: ChildProcess;

    try {
      child = this.spawn(
        kubectl,
        ["port-forward", "--address", LOOPBACK, "--namespace", pod.namespace, `pod/${pod.name}`, `:${pod.port}`],
        { cwd: this.host.cwd(), env: environment, stdio: ["ignore", "pipe", "pipe"], windowsHide: true },
      );
    } catch {
      throw new DiagnosticError("transport-unreachable");
    }
    return this.follow(child, clusterId, signal);
  }

  private entryOf(clusterId: string): CatalogEntry | undefined {
    try {
      return this.host.entry(clusterId);
    } catch {
      return undefined;
    }
  }

  private hook(): void {
    if (this.unhook) return;
    this.unhook = this.onExit(() => {
      for (const run of this.running) void run.stop();
    });
  }

  // kubectl from its start to its end: ready on its line, or ended with what ended it; killed at every end.
  private follow(child: ChildProcess, clusterId: string, signal: AbortSignal): Promise<PodTunnel> {
    let exited = false;
    // kubectl exited, or never started.
    const ended = new Promise<void>((resolve) => {
      child.once("exit", () => {
        exited = true;
        resolve();
      });
      child.once("error", () => {
        if (child.pid !== undefined) return;
        exited = true;
        resolve();
      });
    });
    let stopping: Promise<boolean> | undefined;
    // Tells kubectl to end, and waits for it: what has not exited within its bound is killed for good, and is
    // said not to have exited.
    const stop = (): Promise<boolean> => {
      stopping ??= (async () => {
        if (exited) return true;
        try {
          child.kill("SIGTERM");
        } catch {
          // It ended already.
        }
        let late: ReturnType<typeof setTimeout> | undefined;
        const inTime = await Promise.race([
          ended.then(() => true),
          new Promise<false>((resolve) => {
            late = setTimeout(() => resolve(false), TUNNEL_BOUNDS.exitMs);
          }),
        ]);

        clearTimeout(late);
        if (!inTime)
          try {
            child.kill("SIGKILL");
          } catch {
            // Nothing more can be done of it.
          }
        return inTime;
      })();
      return stopping;
    };
    const run = { stop };
    let ready = false;
    let settled = false;
    let written = "";
    let stdout = "";
    const afterReady = () => void stop();
    let unwatch: () => void = () => undefined;

    this.running.add(run);
    this.hook();
    void ended.then(() => {
      this.running.delete(run);
      signal.removeEventListener("abort", afterReady);
      unwatch();
    });
    return new Promise<PodTunnel>((resolve, reject) => {
      // The first end is the one that is said; kubectl is killed at every one. The end is said before
      // kubectl is told to end, which may tell of its own end at once.
      const fail = (error: DiagnosticError) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          signal.removeEventListener("abort", aborted);
          reject(error);
        }
        void stop();
      };
      const aborted = () => fail(new DiagnosticError("cancelled"));
      // The wait for the line of readiness, from the moment kubectl was prepared and started.
      const timer = setTimeout(() => fail(new DiagnosticError("deadline")), TUNNEL_BOUNDS.readyMs);

      signal.addEventListener("abort", aborted, { once: true });
      // What kubectl writes is read for its line of readiness and for its refusal, and nothing else is done
      // with it: it is read to its end, so that kubectl never waits for room to write.
      child.stdout?.on("data", (chunk: Buffer | string) => {
        if (ready || settled) return;
        stdout = kept(stdout + String(chunk));
        const line = READY.exec(stdout);

        if (!line) return;
        const port = Number(line[1]);

        if (!Number.isInteger(port) || port < 1 || port > 65535) {
          fail(new DiagnosticError("transport-unreachable"));
          return;
        }
        ready = true;
        settled = true;
        stdout = "";
        written = "";
        clearTimeout(timer);
        signal.removeEventListener("abort", aborted);
        // Ready: the operation that ends, whatever the end, still kills it.
        signal.addEventListener("abort", afterReady, { once: true });
        resolve({
          address: LOOPBACK,
          port,
          close: async () => {
            if (!(await stop())) throw new DiagnosticError("transport-unreachable", "release");
          },
        });
      });
      child.stderr?.on("data", (chunk: Buffer | string) => {
        if (!ready) written = kept(written + String(chunk));
      });
      child.once("error", () => fail(new DiagnosticError("transport-unreachable")));
      // Ended before its line: by a refusal of the cluster, or for another reason. What it wrote is read
      // once it is all there.
      child.once("close", () =>
        fail(signal.aborted || this.closed ? new DiagnosticError("cancelled") : endOf(written)),
      );
      // The cluster leaves the connected state, or the catalog: kubectl is killed, whenever it is.
      try {
        unwatch = this.host.watchStatus(clusterId, (status) => {
          if (status === CONNECTED) return;
          fail(new DiagnosticError("target-changed", undefined, status === undefined ? "absent" : "disconnected"));
        });
      } catch {
        fail(new DiagnosticError("transport-unreachable"));
      }
      if (exited) unwatch();
    });
  }
}
