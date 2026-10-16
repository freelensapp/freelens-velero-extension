// The procedures of the gate through the IPC and the catalog of the host, as the extension wires them
// when it is activated: the stub of the host stands for both processes, and a call of the renderer
// reaches the handler the main process registered.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  anExtension,
  hostCatalog,
  ipcBroadcasts,
  ipcFrame,
  ipcHandlers,
  resetIpc,
} from "../../test/freelens-extensions";
import { CLUSTER_WORDS } from "../common/diagnostic-text";
import { CHANNELS } from "../common/ipc";
import { VeleroIpcRenderer } from "../renderer/api/ipc";
import { catalogEntries } from "./host";
import { VeleroIpc } from "./ipc";

const CLUSTER = "synthetic-cluster";

let main: VeleroIpc;
let renderer: VeleroIpcRenderer;

beforeEach(() => {
  resetIpc();
  // No file is behind the paths of the catalog: the extension reads no kubeconfig.
  hostCatalog.clusters = [
    {
      id: CLUSTER,
      name: "synthetic",
      kubeConfigPath: "/synthetic/kubeconfig",
      contextName: "kind-synthetic",
      status: "connected",
    },
    {
      id: "other-cluster",
      name: "other",
      kubeConfigPath: "/synthetic/absent",
      contextName: "kind-other",
      status: "connected",
    },
  ];
  main = VeleroIpc.createInstance(anExtension("main") as never);
  main.register(catalogEntries);
  renderer = VeleroIpcRenderer.createInstance(anExtension("renderer") as never);
});

afterEach(() => {
  main.release();
  hostCatalog.clusters = undefined;
  resetIpc();
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
        CHANNELS.artifactPage,
        CHANNELS.artifactRelease,
        CHANNELS.artifactSave,
        CHANNELS.allowanceGrant,
        CHANNELS.allowanceRevoke,
      ].sort(),
    );
    expect(catalogEntries().map((entry) => [entry.id, entry.status])).toEqual([
      [CLUSTER, "connected"],
      ["other-cluster", "connected"],
    ]);
    expect(await renderer.state(CLUSTER)).toEqual({
      ok: true,
      value: { cluster: { id: CLUSTER, name: "synthetic", context: "kind-synthetic" }, writes: { on: false } },
    });
  });

  it("turns writes on with the adapter it makes from the entry of the catalog, and confirms a write", async () => {
    const enabled = await renderer.enable(CLUSTER, "velero", { context: "kind-synthetic", namespace: "velero" });

    expect(enabled).toEqual({
      ok: true,
      value: {
        cluster: { id: CLUSTER, name: "synthetic", context: "kind-synthetic" },
        writes: { on: true, namespace: "velero", since: expect.any(Number) },
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

  it("does not turn writes on for a cluster the catalog says is not connected, and says so", async () => {
    hostCatalog.clusters = hostCatalog.clusters?.map((cluster) => ({ ...cluster, status: "disconnected" }));
    expect(await renderer.enable(CLUSTER, "velero", { context: "kind-synthetic", namespace: "velero" })).toEqual({
      ok: false,
      code: "target-changed",
      stage: "catalog",
      retry: false,
      text: CLUSTER_WORDS.disconnected,
    });
  });

  it("refuses the frame of a cluster that asks for another, and the window of the host", async () => {
    expect(await renderer.state("other-cluster")).toMatchObject({ ok: false, code: "forbidden", stage: "frame" });
    ipcFrame.current = { senderFrame: { url: "https://renderer.freelens.app:1234/catalog" }, processId: 1, frameId: 1 };
    expect(await renderer.state(CLUSTER)).toMatchObject({ ok: false, code: "forbidden", stage: "frame" });
  });

  it("turns writes off when the extension is deactivated, and tells nothing of it", async () => {
    await renderer.enable(CLUSTER, "velero", { context: "kind-synthetic", namespace: "velero" });
    // As the extension is deactivated: the procedures are let go and the instance is reset, then the host
    // takes its handlers out. The next activation registers them on an instance of its own.
    main.release();
    VeleroIpc.resetInstance();
    ipcHandlers.clear();
    main = VeleroIpc.createInstance(anExtension("main") as never);
    main.register(catalogEntries);
    expect(await renderer.state(CLUSTER)).toMatchObject({ ok: true, value: { writes: { on: false } } });
    expect(ipcBroadcasts).toEqual([]);
  });

  it("refuses the cluster of a frame the catalog of the host does not give as connected", async () => {
    for (const status of ["connecting", "disconnected", "disconnecting"]) {
      hostCatalog.clusters = hostCatalog.clusters?.map((cluster) => ({ ...cluster, status }));
      expect(await renderer.state(CLUSTER)).toEqual({
        ok: false,
        code: "target-changed",
        stage: "catalog",
        retry: false,
        text: CLUSTER_WORDS.disconnected,
      });
    }
    hostCatalog.clusters = hostCatalog.clusters?.filter((cluster) => cluster.id !== CLUSTER);
    expect(await renderer.allow(CLUSTER, { what: "private", origin: "https://storage.example:9000" })).toEqual({
      ok: false,
      code: "target-changed",
      stage: "catalog",
      retry: false,
      text: CLUSTER_WORDS.absent,
    });
  });
});
