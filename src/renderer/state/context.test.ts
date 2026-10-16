// The cluster of the frame the views are in: the identifier the host writes in the address of the frame,
// which the reader asks the client of the host for, which every request to the main process names, and
// which the main process binds the request to by the same rule.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  forbiddenAccesses,
  hostCatalog,
  hostViews,
  ipcFrame,
  rendererCatalog,
  resetIpc,
} from "../../../test/freelens-extensions";
import { catalogEntries } from "../../main/host";
import { VeleroIpc } from "../../main/ipc";
import { VeleroIpcRenderer } from "../api/ipc";
import { currentInstallation, frameCluster, releaseInstallation } from "./context";

const ID = "86a008d2588de4178aa2ac8a245ac1f4";

beforeEach(() => {
  resetIpc();
  forbiddenAccesses.length = 0;
  rendererCatalog.clusters = [
    { id: ID, name: "demo" },
    { id: "synthetic-cluster", name: "synthetic-cluster" },
  ];
});

afterEach(() => {
  releaseInstallation();
  vi.unstubAllGlobals();
  hostViews.forCluster = undefined;
  hostCatalog.clusters = undefined;
  rendererCatalog.clusters = [{ id: "synthetic-cluster", name: "synthetic-cluster" }];
  resetIpc();
});

describe("the cluster of the frame of the views", () => {
  it("is the identifier the host writes in the address of the frame, with the name the catalog gives it", () => {
    vi.stubGlobal("location", new URL(`https://${ID}.renderer.freelens.app/extension/freelensapp--velero-extension`));
    expect(frameCluster()).toEqual({ id: ID, name: "demo" });
    vi.stubGlobal("location", new URL(`http://${ID}.localhost:9191/extension/freelensapp--velero-extension`));
    expect(frameCluster()).toEqual({ id: ID, name: "demo" });
  });

  it("is the address's and not the one the catalog shows, when the two differ", () => {
    // The stub of the catalog shows synthetic-cluster: the frame is of another, and its requests are of it.
    vi.stubGlobal("location", new URL(`https://${ID}.renderer.freelens.app/`));
    expect(frameCluster().id).toBe(ID);
  });

  it("is the one the catalog shows where the address names none, as outside a frame of a cluster", () => {
    vi.stubGlobal("location", new URL("http://localhost:9191/"));
    expect(frameCluster()).toEqual({ id: "synthetic-cluster", name: "synthetic-cluster" });
    vi.stubGlobal("location", undefined);
    expect(frameCluster()).toEqual({ id: "synthetic-cluster", name: "synthetic-cluster" });
  });

  it("is the cluster the views read through the client of the host, and the one the main process binds their requests to", async () => {
    vi.stubGlobal("location", new URL(`https://${ID}.renderer.freelens.app/extension/freelensapp--velero-extension`));
    const taken: string[] = [];

    hostViews.forCluster = (cluster) => {
      taken.push(cluster);
      return { getResponse: async () => ({ status: 404, text: async () => "404 page not found\n" }) };
    };
    // The main process, its catalog and the frame of the request, as the host gives them: the frame is the one
    // whose address the views are at.
    hostCatalog.clusters = [
      { id: ID, name: "demo", kubeConfigPath: "/synthetic/kubeconfig", contextName: "kind-demo", status: "connected" },
    ];
    const main = VeleroIpc.createInstance({} as never);

    main.register(catalogEntries);
    ipcFrame.current = { senderFrame: { url: globalThis.location.href }, processId: 1, frameId: 4 };
    VeleroIpcRenderer.createInstance({} as never);
    const installation = currentInstallation();

    expect(installation.cluster).toEqual({ id: ID, name: "demo" });
    await installation.refresh();
    // One client of the host, for the cluster of the frame, and nothing asked of another.
    expect(taken).toEqual([ID]);
    await installation.openGate();
    expect(installation.gate).toEqual({
      cluster: { id: ID, name: "demo", context: "kind-demo" },
      writes: { on: false },
    });
    expect(forbiddenAccesses).toEqual([]);
    main.release();
  });
});
