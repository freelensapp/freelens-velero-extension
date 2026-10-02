// The procedures of the gate through the IPC and the catalog of the host, as the extension wires them
// when it is activated: the stub of the host stands for both processes, and a call of the renderer
// reaches the handler the main process registered.
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { hostCatalog, ipcBroadcasts, ipcFrame, ipcHandlers, resetIpc } from "../../test/freelens-extensions";
import { CHANNELS } from "../common/ipc";
import { VeleroIpcRenderer } from "../renderer/api/ipc";
import { catalogEntries, VeleroIpc } from "./ipc";

const CLUSTER = "synthetic-cluster";
const KUBECONFIG = `apiVersion: v1
kind: Config
clusters:
  - name: synthetic
    cluster:
      server: https://127.0.0.1:6443
      certificate-authority-data: c3ludGhldGlj
contexts:
  - name: kind-synthetic
    context:
      cluster: synthetic
      user: synthetic
users:
  - name: synthetic
    user:
      token: synthetic-token
`;

let directory: string;
let main: VeleroIpc;
let renderer: VeleroIpcRenderer;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "velero-ipc-host-"));
  await writeFile(join(directory, "kubeconfig"), KUBECONFIG);
  resetIpc();
  hostCatalog.clusters = [
    { id: CLUSTER, name: "synthetic", kubeConfigPath: join(directory, "kubeconfig"), contextName: "kind-synthetic" },
    { id: "other-cluster", name: "other", kubeConfigPath: join(directory, "absent"), contextName: "kind-other" },
  ];
  main = VeleroIpc.createInstance({} as never);
  main.register(catalogEntries);
  renderer = VeleroIpcRenderer.createInstance({} as never);
});

afterEach(async () => {
  main.release();
  hostCatalog.clusters = undefined;
  resetIpc();
  await rm(directory, { recursive: true, force: true });
});

describe("the gate through the IPC and the catalog of the host", () => {
  it("registers every procedure with the host and reads the clusters from its catalog", async () => {
    expect([...ipcHandlers.keys()].sort()).toEqual(
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
    expect(catalogEntries().map((entry) => entry.id)).toEqual([CLUSTER, "other-cluster"]);
    expect(await renderer.state(CLUSTER)).toEqual({
      ok: true,
      value: { cluster: { id: CLUSTER, name: "synthetic", context: "kind-synthetic" }, writes: { on: false } },
    });
  });

  it("turns writes on with the adapter it makes from the entry of the catalog, and confirms a write", async () => {
    const enabled = await renderer.enable(CLUSTER, "velero", { context: "kind-synthetic", namespace: "velero" });

    expect(enabled).toMatchObject({
      ok: true,
      value: {
        writes: { on: true, namespace: "velero" },
        connection: { supported: true, credential: "token" },
      },
    });
    expect(await renderer.confirm(CLUSTER, "velero", "ServerStatusRequest")).toMatchObject({ ok: true });
    expect(await renderer.disable(CLUSTER)).toMatchObject({ ok: true, value: { writes: { on: false } } });
    expect(await renderer.confirm(CLUSTER, "velero", "ServerStatusRequest")).toMatchObject({
      ok: false,
      code: "forbidden",
      stage: "gate",
    });
  });

  it("refuses the frame of a cluster that asks for another, and the window of the host", async () => {
    expect(await renderer.state("other-cluster")).toMatchObject({ ok: false, code: "forbidden", stage: "frame" });
    ipcFrame.current = { senderFrame: { url: "https://renderer.freelens.app:1234/catalog" }, processId: 1, frameId: 1 };
    expect(await renderer.state(CLUSTER)).toMatchObject({ ok: false, code: "forbidden", stage: "frame" });
  });

  it("turns writes off when the extension is deactivated, and tells nothing of it", async () => {
    await renderer.enable(CLUSTER, "velero", { context: "kind-synthetic", namespace: "velero" });
    main.release();
    main.register(catalogEntries);
    expect(await renderer.state(CLUSTER)).toMatchObject({ ok: true, value: { writes: { on: false } } });
    expect(ipcBroadcasts).toEqual([]);
  });
});
