// The tunnel to the Pod of the store on a fake `spawn`: the kubectl and the environment the host gives, the
// line of readiness and its port, the bounds of time, every way kubectl is killed, and what a kubectl that
// ends before its line says, with nothing of what it wrote.

import { EventEmitter } from "node:events";
import { inspect } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import { downloadFailure } from "../common/diagnostic-text";
import { DiagnosticError } from "./diagnostic-transport";
import { KubectlTunnels, type PodTarget, TUNNEL_BOUNDS, type TunnelHost } from "./diagnostic-tunnel";
import type { ChildProcess, SpawnOptions } from "node:child_process";

const CLUSTER = "cluster-a";
const POD: PodTarget = { namespace: "velero", name: "seaweedfs-0", uid: "pod-uid", port: 8333 };
const KUBECTL = "/synthetic/freelens/binaries/kubectl";
const ENVIRONMENT = { KUBECONFIG: "/synthetic/freelens/kubeconfigs/cluster-a", PATH: "/synthetic/freelens/binaries" };
const FOLDER = "/synthetic/extensions/velero";
const SENTINEL = "PRIVATE-SENTINEL-OF-KUBECTL";
const REFUSED = `error: error upgrading connection: pods "seaweedfs-0" is forbidden: User "system:serviceaccount:velero:${SENTINEL}" cannot create resource "pods/portforward" in API group "" in the namespace "velero"\n`;

// A kubectl that writes what a test tells it to, and ends as a test tells it to: when it is told to, only
// when it is killed for good, or never.
class FakeKubectl extends EventEmitter {
  readonly stdout = new EventEmitter();
  readonly stderr = new EventEmitter();
  pid: number | undefined = 4242;
  readonly signals: string[] = [];
  ends: "term" | "kill" | "never" = "term";
  exited = false;

  kill(signal: NodeJS.Signals = "SIGTERM"): boolean {
    this.signals.push(signal);
    if (this.ends === "term" || (this.ends === "kill" && signal === "SIGKILL")) this.exit(null, signal);
    return true;
  }

  exit(code: number | null, signal: string | null = null): void {
    if (this.exited) return;
    this.exited = true;
    this.emit("exit", code, signal);
    this.emit("close", code, signal);
  }

  say(text: string): void {
    this.stdout.emit("data", Buffer.from(text));
  }

  complain(text: string): void {
    this.stderr.emit("data", Buffer.from(text));
  }

  // A command that cannot be started: no process, an error, and no exit.
  failToStart(): void {
    this.pid = undefined;
    this.emit("error", Object.assign(new Error(`spawn ${KUBECTL} ENOENT ${SENTINEL}`), { code: "ENOENT" }));
    this.emit("close", -2, null);
  }
}

function fixture(options: { prepare?: () => Promise<void>; shellRejects?: boolean; spawnThrows?: boolean } = {}) {
  const children: { command: string; args: string[]; options: SpawnOptions; child: FakeKubectl }[] = [];
  const spawn = vi.fn((command: string, args: string[], spawnOptions: SpawnOptions) => {
    if (options.spawnThrows) throw new Error(`spawn failed ${SENTINEL}`);
    const child = new FakeKubectl();

    children.push({ command, args, options: spawnOptions, child });
    return child as unknown as ChildProcess;
  });
  const state: { status: string | undefined } = { status: "connected" };
  const watchers = new Set<(status: string | undefined) => void>();
  const shell = async (value: unknown) => {
    await options.prepare?.();
    if (options.shellRejects) throw new Error(`The cluster ${CLUSTER} is not connected`);
    return value;
  };
  const host: TunnelHost = {
    kubectl: vi.fn((clusterId: string) => shell(KUBECTL).then((value) => (clusterId ? (value as string) : ""))),
    environment: vi.fn((clusterId: string) =>
      shell(ENVIRONMENT).then((value) => (clusterId ? (value as Record<string, string>) : {})),
    ),
    entry: (clusterId) =>
      state.status === undefined
        ? undefined
        : { id: clusterId, name: "demo", kubeConfigPath: "/synthetic/a", contextName: "kind-a", status: state.status },
    // As a reaction of MobX with fireImmediately: told the state now, then at each change.
    watchStatus: (_clusterId, listener) => {
      watchers.add(listener);
      listener(state.status);
      return () => watchers.delete(listener);
    },
    cwd: () => FOLDER,
  };
  const hooks: (() => void)[] = [];
  const unhooked: (() => void)[] = [];
  const tunnels = new KubectlTunnels(host, spawn, (listener) => {
    hooks.push(listener);
    return () => unhooked.push(listener);
  });
  const status = (next: string | undefined) => {
    state.status = next;
    for (const watcher of [...watchers]) watcher(next);
  };

  return { tunnels, host, spawn, children, status, watchers, hooks, unhooked };
}

// What a promise ended with, or that it has not ended.
async function outcome(promise: Promise<unknown>): Promise<unknown> {
  let result: unknown = "pending";

  promise.then(
    (value) => {
      result = value;
    },
    (error: unknown) => {
      result = error;
    },
  );
  for (let turn = 0; turn < 10; turn += 1) await Promise.resolve();
  return result;
}

// Lets what waits for a promise go on, without moving the clock.
async function flush(): Promise<void> {
  for (let turn = 0; turn < 20; turn += 1) await Promise.resolve();
}

// Lets the preparation and the spawn happen, without moving the clock.
async function started(value: ReturnType<typeof fixture>, count = 1): Promise<FakeKubectl> {
  await flush();
  expect(value.children).toHaveLength(count);
  return value.children[count - 1].child;
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("the tunnel to the Pod of the store", () => {
  it("runs the kubectl the host gives for the cluster, with its environment as a whole and the folder of the extension, for a port-forward to the Pod", async () => {
    const value = fixture();
    const opening = value.tunnels.open(CLUSTER, POD, new AbortController().signal);
    const child = await started(value);
    const [run] = value.children;

    expect(value.host.kubectl).toHaveBeenCalledWith(CLUSTER);
    expect(value.host.environment).toHaveBeenCalledWith(CLUSTER);
    expect(run.command).toBe(KUBECTL);
    expect(run.args).toEqual([
      "port-forward",
      "--address",
      "127.0.0.1",
      "--namespace",
      "velero",
      "pod/seaweedfs-0",
      ":8333",
    ]);
    // The environment of the host is the whole environment of kubectl, and nothing of the process is added.
    expect(run.options.env).toEqual(ENVIRONMENT);
    expect(run.options.cwd).toBe(FOLDER);
    expect(run.options.stdio).toEqual(["ignore", "pipe", "pipe"]);
    expect(run.options.shell).toBeUndefined();
    child.say("Forwarding from 127.0.0.1:41821 -> 8333\n");
    await expect(opening).resolves.toMatchObject({ address: "127.0.0.1", port: 41821 });
  });

  it("is ready on the line of kubectl for the loopback, and reads its port from that line", async () => {
    const value = fixture();
    const opening = value.tunnels.open(CLUSTER, POD, new AbortController().signal);
    const child = await started(value);

    // A line of another address, and a line cut in two: not ready until the line is whole.
    child.say("Forwarding from [::1]:41821 -> 8333\n");
    child.say("Forwarding from 127.0.0.1:");
    expect(await outcome(opening)).toBe("pending");
    child.say("39017 -> 8333\nHandling connection for 39017\n");
    await expect(opening).resolves.toMatchObject({ address: "127.0.0.1", port: 39017 });
    // A port that is no port is not taken.
    const other = fixture();
    const refused = other.tunnels.open(CLUSTER, POD, new AbortController().signal);

    (await started(other)).say("Forwarding from 127.0.0.1:70000 -> 8333\n");
    await expect(refused).rejects.toMatchObject({ code: "transport-unreachable" });
  });

  it("waits fifteen seconds for its line, counted from the end of the preparation and not before", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    // The host takes a minute to prepare the kubectl of the version of the cluster.
    const value = fixture({ prepare: () => new Promise((resolve) => setTimeout(resolve, 60_000)) });
    const opening = value.tunnels.open(CLUSTER, POD, new AbortController().signal);
    const ended = opening.catch((error: unknown) => error);

    await vi.advanceTimersByTimeAsync(60_000);
    const child = await started(value);

    await vi.advanceTimersByTimeAsync(TUNNEL_BOUNDS.readyMs - 1);
    expect(await outcome(opening)).toBe("pending");
    expect(child.signals).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(await ended).toMatchObject({ code: "deadline" });
    // It is killed at its bound.
    expect(child.signals).toEqual(["SIGTERM"]);
    expect(value.tunnels.count).toBe(0);
    expect(TUNNEL_BOUNDS.readyMs).toBe(15_000);
    expect(
      downloadFailure("deadline", "forward", {
        artifact: "BackupLog",
        name: "nightly",
        namespace: "velero",
        request: "r",
      }).text,
    ).toContain("was not ready in fifteen seconds");
  });

  it("starts nothing for an abort before kubectl runs, and kills it for an abort before its line", async () => {
    // Before the open: the host is asked nothing.
    const before = fixture();
    const controller = new AbortController();

    controller.abort();
    await expect(before.tunnels.open(CLUSTER, POD, controller.signal)).rejects.toMatchObject({ code: "cancelled" });
    expect(before.host.kubectl).not.toHaveBeenCalled();
    // While kubectl is prepared: it is not started once it is.
    let prepared: () => void = () => undefined;
    const preparation = new Promise<void>((resolve) => {
      prepared = resolve;
    });
    const preparing = fixture({ prepare: () => preparation });
    const stopped = new AbortController();
    const opening = preparing.tunnels.open(CLUSTER, POD, stopped.signal);

    await flush();
    expect(preparing.host.kubectl).toHaveBeenCalled();
    stopped.abort();
    prepared();
    await expect(opening).rejects.toMatchObject({ code: "cancelled" });
    expect(preparing.spawn).not.toHaveBeenCalled();
    // Once it runs, before its line: it is killed.
    const running = fixture();
    const third = new AbortController();
    const waiting = running.tunnels.open(CLUSTER, POD, third.signal);
    const child = await started(running);

    third.abort();
    await expect(waiting).rejects.toMatchObject({ code: "cancelled" });
    expect(child.signals).toEqual(["SIGTERM"]);
    await flush();
    expect(running.tunnels.count).toBe(0);
  });
});

describe("the end of kubectl", () => {
  it("kills kubectl when the tunnel is closed, and when its operation is stopped after the line", async () => {
    const value = fixture();
    const first = value.tunnels.open(CLUSTER, POD, new AbortController().signal);
    const one = await started(value);

    one.say("Forwarding from 127.0.0.1:41821 -> 8333\n");
    const tunnel = await first;

    expect(value.tunnels.count).toBe(1);
    await expect(tunnel.close()).resolves.toBeUndefined();
    expect(one.signals).toEqual(["SIGTERM"]);
    expect(value.tunnels.count).toBe(0);
    // Closed again: nothing more is sent to it.
    await tunnel.close();
    expect(one.signals).toEqual(["SIGTERM"]);
    // The operation stopped after the line, whatever stopped it.
    const operation = new AbortController();
    const second = value.tunnels.open(CLUSTER, POD, operation.signal);
    const two = await started(value, 2);

    two.say("Forwarding from 127.0.0.1:41822 -> 8333\n");
    await second;
    operation.abort();
    expect(two.signals).toEqual(["SIGTERM"]);
    await flush();
    expect(value.tunnels.count).toBe(0);
  });

  it("kills every kubectl when the procedures are let go, and starts none after", async () => {
    const value = fixture();
    const ready = value.tunnels.open(CLUSTER, POD, new AbortController().signal);
    const one = await started(value);

    one.say("Forwarding from 127.0.0.1:41821 -> 8333\n");
    await ready;
    const waiting = value.tunnels.open(CLUSTER, POD, new AbortController().signal).catch((error: unknown) => error);
    const two = await started(value, 2);

    expect(value.tunnels.count).toBe(2);
    value.tunnels.closeAll();
    expect([one.signals, two.signals]).toEqual([["SIGTERM"], ["SIGTERM"]]);
    expect(await waiting).toMatchObject({ code: "cancelled" });
    await flush();
    expect(value.tunnels.count).toBe(0);
    // The hook of the exit of the process goes with them, and nothing is started any more.
    expect(value.unhooked).toEqual(value.hooks);
    await expect(value.tunnels.open(CLUSTER, POD, new AbortController().signal)).rejects.toMatchObject({
      code: "cancelled",
    });
    expect(value.children).toHaveLength(2);
  });

  it("kills every kubectl that runs when the process exits, with a hook put once", async () => {
    const value = fixture();

    expect(value.hooks).toEqual([]);
    const first = value.tunnels.open(CLUSTER, POD, new AbortController().signal);
    const one = await started(value);

    one.say("Forwarding from 127.0.0.1:41821 -> 8333\n");
    await first;
    void value.tunnels.open(CLUSTER, POD, new AbortController().signal).catch(() => undefined);
    const two = await started(value, 2);

    expect(value.hooks).toHaveLength(1);
    value.hooks[0]();
    expect([one.signals, two.signals]).toEqual([["SIGTERM"], ["SIGTERM"]]);
    await flush();
    expect(value.tunnels.count).toBe(0);
  });

  it("kills kubectl when the cluster leaves the connected state, before its line and after it", async () => {
    // Before its line: the opening ends as a target that changed, said as such.
    const before = fixture();
    const opening = before.tunnels.open(CLUSTER, POD, new AbortController().signal);
    const one = await started(before);

    before.status("disconnecting");
    await expect(opening).rejects.toMatchObject({ code: "target-changed", verdict: "disconnected" });
    expect(one.signals).toEqual(["SIGTERM"]);
    // After its line: kubectl is killed, and the reaction is let go with it.
    const after = fixture();
    const ready = after.tunnels.open(CLUSTER, POD, new AbortController().signal);
    const two = await started(after);

    two.say("Forwarding from 127.0.0.1:41821 -> 8333\n");
    await ready;
    expect(after.watchers.size).toBe(1);
    after.status("connected");
    expect(two.signals).toEqual([]);
    after.status("disconnected");
    expect(two.signals).toEqual(["SIGTERM"]);
    await flush();
    expect(after.watchers.size).toBe(0);
    expect(after.tunnels.count).toBe(0);
    // A cluster that went from the catalog, and one that is not connected when kubectl starts.
    const gone = fixture();
    const third = gone.tunnels.open(CLUSTER, POD, new AbortController().signal);

    await started(gone);
    gone.status(undefined);
    await expect(third).rejects.toMatchObject({ code: "target-changed", verdict: "absent" });
    const late = fixture();
    const fourth = late.tunnels.open(CLUSTER, POD, new AbortController().signal);

    // The cluster leaves the connected state between the preparation and the start: kubectl is killed as
    // soon as it starts.
    late.status("connecting");
    await expect(fourth).rejects.toMatchObject({ code: "target-changed", verdict: "disconnected" });
    expect(late.children[0]?.child.signals).toEqual(["SIGTERM"]);
    await flush();
    expect(late.tunnels.count).toBe(0);
  });

  it("says a kubectl that has not exited five seconds after it was told to, and kills it for good", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    for (const ends of ["kill", "never"] as const) {
      const value = fixture();
      const opening = value.tunnels.open(CLUSTER, POD, new AbortController().signal);
      const child = await started(value);

      child.ends = ends;
      child.say("Forwarding from 127.0.0.1:41821 -> 8333\n");
      const tunnel = await opening;
      const closing = tunnel.close().catch((error: unknown) => error);

      await vi.advanceTimersByTimeAsync(TUNNEL_BOUNDS.exitMs - 1);
      expect(child.signals).toEqual(["SIGTERM"]);
      await vi.advanceTimersByTimeAsync(1);
      // Said as what was opened to reach the store that did not close in time.
      const said = await closing;

      expect(said).toBeInstanceOf(DiagnosticError);
      expect(said).toMatchObject({ code: "transport-unreachable", stage: "release" });
      expect(child.signals).toEqual(["SIGTERM", "SIGKILL"]);
      // One that ends when it is killed for good is not one of the extension any more; one that does not end
      // at all is still counted.
      await flush();
      expect(value.tunnels.count).toBe(ends === "kill" ? 0 : 1);
    }
    expect(TUNNEL_BOUNDS.exitMs).toBe(5_000);
  });
});

describe("a kubectl that ends before its line", () => {
  it("says a refusal of the port-forward as forbidden, with the verbs the identity needs and nothing of what kubectl wrote", async () => {
    for (const written of [REFUSED, REFUSED.replace("cannot create", "cannot get")]) {
      const value = fixture();
      const opening = value.tunnels.open(CLUSTER, POD, new AbortController().signal);
      const child = await started(value);

      child.complain(written.slice(0, 40));
      child.complain(written.slice(40));
      child.exit(1);
      const refused = await opening.catch((error: unknown) => error);

      expect(refused).toBeInstanceOf(DiagnosticError);
      expect(refused).toMatchObject({ code: "forbidden", verdict: undefined });
      expect(inspect(refused, { depth: 8, showHidden: true })).not.toContain(SENTINEL);
    }
    // At the step of the port-forward, the words name the resource and the verbs.
    const said = downloadFailure("forbidden", "forward", {
      artifact: "BackupLog",
      name: "nightly",
      namespace: "velero",
      request: "nightly-request",
    });

    expect(said.text).toContain("the verbs get and create on pods/portforward");
    expect(said.text).not.toContain(SENTINEL);
  });

  it("says a credential the cluster did not take as such, and any other end, or a kubectl that cannot be run, as a store that was not reached", async () => {
    const ends: unknown[] = [];

    for (const end of [
      (child: FakeKubectl) => {
        child.complain(`error: You must be logged in to the server (Unauthorized) ${SENTINEL}\n`);
        child.exit(1);
      },
      (child: FakeKubectl) => {
        child.complain(
          `error: unable to forward port because pod is not running. Current status=Pending ${SENTINEL}\n`,
        );
        child.exit(1);
      },
      (child: FakeKubectl) => child.exit(0),
      (child: FakeKubectl) => child.failToStart(),
    ]) {
      const value = fixture();
      const opening = value.tunnels.open(CLUSTER, POD, new AbortController().signal);

      end(await started(value));
      ends.push(await opening.catch((error: unknown) => error));
      await flush();
      expect(value.tunnels.count).toBe(0);
    }
    expect(ends).toMatchObject([
      { code: "forbidden", verdict: "credential" },
      { code: "transport-unreachable" },
      { code: "transport-unreachable" },
      { code: "transport-unreachable" },
    ]);
    // A spawn that raises at once.
    const raising = fixture({ spawnThrows: true });

    ends.push(await raising.tunnels.open(CLUSTER, POD, new AbortController().signal).catch((error: unknown) => error));
    expect(ends[4]).toMatchObject({ code: "transport-unreachable" });
    expect(inspect(ends, { depth: 8, showHidden: true })).not.toContain(SENTINEL);
    expect(
      downloadFailure("transport-unreachable", "forward", {
        artifact: "BackupLog",
        name: "nightly",
        namespace: "velero",
        request: "nightly-request",
      }).text,
    ).toContain("The port-forward to the Pod of the store could not be opened");
  });

  it("says a kubectl the host does not give, for a cluster not there or not connected, as a target that changed, and starts nothing", async () => {
    const ends: unknown[] = [];

    for (const status of [undefined, "disconnected", "connecting", "connected"]) {
      const value = fixture({ shellRejects: true });

      value.status(status);
      ends.push(await value.tunnels.open(CLUSTER, POD, new AbortController().signal).catch((error: unknown) => error));
      expect(value.spawn).not.toHaveBeenCalled();
    }
    // A cluster that is connected, for which the host still gives none, has no kubectl to run.
    expect(ends).toMatchObject([
      { code: "target-changed", verdict: "absent" },
      { code: "target-changed", verdict: "disconnected" },
      { code: "target-changed", verdict: "disconnected" },
      { code: "transport-unreachable" },
    ]);
  });

  it("refuses a Pod that is not one before anything is run", async () => {
    for (const pod of [
      { ...POD, name: "--address=0.0.0.0" },
      { ...POD, name: "Seaweedfs" },
      { ...POD, namespace: "-n" },
      { ...POD, port: 0 },
      { ...POD, port: 65_536 },
      { ...POD, port: 8333.5 },
    ]) {
      const value = fixture();

      await expect(value.tunnels.open(CLUSTER, pod, new AbortController().signal)).rejects.toMatchObject({
        code: "validation",
      });
      expect(value.host.kubectl).not.toHaveBeenCalled();
    }
  });

  it("keeps what kubectl writes in the main process, and reads it to its end", async () => {
    const consoles = (["log", "info", "warn", "error", "debug"] as const).map((name) =>
      vi.spyOn(console, name).mockImplementation(() => undefined),
    );
    const value = fixture();
    const opening = value.tunnels.open(CLUSTER, POD, new AbortController().signal);
    const child = await started(value);

    child.complain(`a warning of kubectl ${SENTINEL}\n`);
    child.say("Forwarding from 127.0.0.1:41821 -> 8333\n");
    const tunnel = await opening;

    // After its line kubectl is still read, so that it never waits for room to write.
    expect(child.stdout.listenerCount("data")).toBeGreaterThan(0);
    expect(child.stderr.listenerCount("data")).toBeGreaterThan(0);
    child.say(`Handling connection for 41821 ${SENTINEL}\n`);
    child.complain(`E1016 an error occurred forwarding 41821 -> 8333 ${SENTINEL}\n`);
    await tunnel.close();
    expect(inspect(tunnel, { depth: 8, showHidden: true })).not.toContain(SENTINEL);
    for (const spy of consoles) expect(spy).not.toHaveBeenCalled();
  });
});
