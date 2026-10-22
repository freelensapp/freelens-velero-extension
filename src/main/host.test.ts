// What the main process takes of the host, through the stub of its API: the catalog with the state of each
// cluster, followed by reactions as the catalog of the host is observable, the client of its proxy for a
// cluster, and the kubectl and the environment it runs for one.

import { observable, runInAction } from "mobx";
import { afterEach, describe, expect, it, vi } from "vitest";
import { forbiddenAccesses, hostCatalog, hostCluster } from "../../test/freelens-extensions";
import { catalogEntries, catalogEntry, hostClient, hostDependencies, watchCatalog } from "./host";

type Cluster = NonNullable<typeof hostCatalog.clusters>[number];

const A: Cluster = {
  id: "cluster-a",
  name: "demo",
  kubeConfigPath: "/synthetic/a",
  contextName: "kind-a",
  status: "connected",
};
const B: Cluster = { ...A, id: "cluster-b", name: "other", kubeConfigPath: "/synthetic/b", contextName: "kind-b" };

// The catalog as the host keeps it: observable, a change of a field of a cluster among its changes.
function observableCatalog(clusters: Cluster[]) {
  const list = observable.array(clusters.map((cluster) => observable.object({ ...cluster })));

  hostCatalog.clusters = list;
  return list;
}

afterEach(() => {
  hostCatalog.clusters = undefined;
  hostCluster.forCluster = undefined;
  hostCluster.kubectl = undefined;
  hostCluster.environment = undefined;
  forbiddenAccesses.length = 0;
});

describe("what the main process takes of the host", () => {
  it("reads the entries of the catalog with the state of each, and one entry by its identifier", () => {
    observableCatalog([A, { ...B, status: "disconnected" }]);
    expect(catalogEntries()).toEqual([A, { ...B, status: "disconnected" }]);
    expect(catalogEntry("cluster-b")).toEqual({ ...B, status: "disconnected" });
    expect(catalogEntry("absent")).toBeUndefined();
  });

  it("gives the client of the host for the cluster it is asked for", () => {
    const forCluster = vi.fn((clusterId: string) => ({ getResponse: vi.fn(), clusterId }));

    hostCluster.forCluster = forCluster;
    expect(hostClient("cluster-a")).toMatchObject({ clusterId: "cluster-a" });
    expect(forCluster).toHaveBeenCalledWith("cluster-a");
  });

  it("asks nothing of the host when what the procedures take of it is made, and the folder of the extension then", () => {
    const manifest = vi.fn(() => "/synthetic/extensions/velero/package.json");
    const taken = hostDependencies(manifest);

    expect(forbiddenAccesses).toEqual([]);
    expect(manifest).not.toHaveBeenCalled();
    expect(taken.tunnel.cwd()).toBe("/synthetic/extensions/velero");
  });

  it("gives the kubectl and the environment the host runs for the cluster it is asked for", async () => {
    hostCluster.kubectl = vi.fn(async (clusterId: string) => `/synthetic/binaries/${clusterId}/kubectl`);
    hostCluster.environment = vi.fn(async (clusterId: string) => ({
      KUBECONFIG: `/synthetic/kubeconfigs/${clusterId}`,
    }));
    const { tunnel } = hostDependencies(() => "/synthetic/extensions/velero/package.json");

    expect(await tunnel.kubectl("cluster-a")).toBe("/synthetic/binaries/cluster-a/kubectl");
    expect(await tunnel.environment("cluster-a")).toEqual({ KUBECONFIG: "/synthetic/kubeconfigs/cluster-a" });
    observableCatalog([A]);
    expect(tunnel.entry("cluster-a")).toEqual(A);
  });

  it("follows the state of one cluster with a reaction: told it now, at each change, and when the cluster goes", () => {
    const list = observableCatalog([A, B]);
    const { tunnel } = hostDependencies(() => "/synthetic/extensions/velero/package.json");
    const told: (string | undefined)[] = [];
    const stop = tunnel.watchStatus("cluster-a", (status) => told.push(status));

    expect(told).toEqual(["connected"]);
    // A change of another cluster, or of another field, tells nothing.
    runInAction(() => {
      list[1].status = "disconnected";
      list[0].name = "renamed";
    });
    expect(told).toEqual(["connected"]);
    runInAction(() => {
      list[0].status = "disconnecting";
    });
    runInAction(() => {
      list[0].status = "disconnected";
    });
    runInAction(() => {
      list.splice(0, 1);
    });
    expect(told).toEqual(["connected", "disconnecting", "disconnected", undefined]);
    stop();
    runInAction(() => {
      list.push(observable.object({ ...A }));
    });
    expect(told).toEqual(["connected", "disconnecting", "disconnected", undefined]);
  });

  it("follows the catalog with a reaction: told when an entry comes, goes, or changes its kubeconfig, its context or its state", () => {
    const list = observableCatalog([A]);
    const told = vi.fn();
    const stop = watchCatalog(told);

    // Not told of the state it starts from.
    expect(told).not.toHaveBeenCalled();
    runInAction(() => {
      list[0].name = "renamed";
    });
    expect(told).toHaveBeenCalledTimes(0);
    for (const change of [
      () => list.push(observable.object({ ...B })),
      () => {
        list[0].kubeConfigPath = "/synthetic/moved";
      },
      () => {
        list[0].contextName = "kind-renamed";
      },
      () => {
        list[0].status = "disconnected";
      },
      () => list.splice(1, 1),
    ])
      runInAction(change);
    expect(told).toHaveBeenCalledTimes(5);
    stop();
    runInAction(() => {
      list[0].status = "connected";
    });
    expect(told).toHaveBeenCalledTimes(5);
  });
});
