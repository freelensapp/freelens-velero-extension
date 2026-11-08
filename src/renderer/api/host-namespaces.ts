import { Renderer } from "@freelensapp/extensions";

// The label a namespace carries for Velero to leave it out of every backup.
export const EXCLUDE_FROM_BACKUP_LABEL = "velero.io/exclude-from-backup";

// A namespace the host lists for the cluster of the frame, and whether it carries the label that excludes it.
export interface HostNamespace {
  name: string;
  excluded: boolean;
}

// Whether the store of the host has loaded the namespaces of the cluster: before it has, its list says nothing of what
// the cluster holds.
export function hostNamespacesKnown(): boolean {
  return Renderer.K8sApi.namespaceStore.isLoaded === true;
}

// The namespaces the host lists for its own views of the cluster, as its store holds them (SPEC-0016, the form): the
// extension reads them and asks the host nothing, so that its reader gains no path. A host that lists none yet says
// none.
export function hostNamespaces(): HostNamespace[] {
  const items = Renderer.K8sApi.namespaceStore.items as unknown as {
    getName(): string;
    metadata?: { labels?: Record<string, string> };
  }[];

  return items
    .map((item) => ({
      name: item.getName(),
      excluded: item.metadata?.labels?.[EXCLUDE_FROM_BACKUP_LABEL] === "true",
    }))
    .sort((one, other) => (one.name < other.name ? -1 : one.name > other.name ? 1 : 0));
}
