// What the main process takes of the host to reach a cluster, and nothing else: the catalog of the host, the
// client of its proxy for the API server of a cluster, and the kubectl and the environment it runs for a
// cluster. The reactions are made with the MobX of the host, which is the one the catalog is observable
// with. Nothing here is asked of the host before a procedure needs it: the activation reads nothing.

import { dirname } from "node:path";
import { Main } from "@freelensapp/extensions";
import { reaction } from "mobx";

import type { CatalogEntry } from "./catalog";
import type { HostClient } from "./diagnostic-kubernetes";
import type { TunnelHost } from "./diagnostic-tunnel";
import type { HandlersDependencies } from "./ipc";

type HostCluster = ReturnType<typeof Main.Catalog.getAllClusters>[number];

function entryOf(cluster: HostCluster): CatalogEntry {
  return {
    id: cluster.id,
    name: cluster.name,
    kubeConfigPath: cluster.kubeConfigPath,
    contextName: cluster.contextName,
    status: String(cluster.status),
  };
}

// The clusters of the catalog of the host, as the gate reads them.
export function catalogEntries(): CatalogEntry[] {
  return Main.Catalog.getAllClusters().map(entryOf);
}

// The entry of one cluster of the catalog, as it is now.
export function catalogEntry(clusterId: string): CatalogEntry | undefined {
  const cluster = Main.Catalog.getClusterById(clusterId);

  return cluster ? entryOf(cluster) : undefined;
}

// The client of the host for the API server of a cluster, through the proxy of Freelens.
export function hostClient(clusterId: string): HostClient {
  return Main.K8sApi.KubeJsonApi.forCluster(clusterId);
}

// Told whenever an entry of the catalog is added, goes, or changes its kubeconfig, its context or its state.
export function watchCatalog(listener: () => void): () => void {
  return reaction(
    () =>
      JSON.stringify(
        Main.Catalog.getAllClusters().map((cluster) => [
          cluster.id,
          cluster.kubeConfigPath,
          cluster.contextName,
          String(cluster.status),
        ]),
      ),
    () => listener(),
  );
}

// Told the state of a cluster now, and whenever it changes.
function watchStatus(clusterId: string, listener: (status: string | undefined) => void): () => void {
  return reaction(
    () => {
      const status = Main.Catalog.getClusterById(clusterId)?.status;

      return status === undefined ? undefined : String(status);
    },
    (status) => listener(status),
    { fireImmediately: true },
  );
}

// What the procedures take of the host, for the extension whose package is at `manifest`: its folder is the
// working directory of kubectl, since the one of the application is not specified.
export function hostDependencies(
  manifest: () => string,
): Required<Pick<HandlersDependencies, "client" | "watchCatalog" | "tunnel">> {
  const tunnel: TunnelHost = {
    kubectl: (clusterId) => Main.Shell.getKubectlPath(clusterId),
    environment: (clusterId) => Main.Shell.getEnvironment(clusterId),
    entry: catalogEntry,
    watchStatus,
    cwd: () => dirname(manifest()),
  };

  return { client: hostClient, watchCatalog, tunnel };
}
