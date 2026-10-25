// A cluster as the catalog of the host gives it to the main process, and the one state in which the
// extension asks anything of it. The extension reads no kubeconfig: the path of the kubeconfig and the name
// of the context are what the catalog says of the cluster, and a change of either is a change of the
// cluster. The fields and the states are the ones of the host at the validation target, in
// packages/core/src/extensions/common-api/cluster-types.ts.

export interface CatalogEntry {
  id: string;
  name: string;
  kubeConfigPath: string;
  contextName: string;
  // connecting, connected, disconnected or disconnecting.
  status: string;
}

// The proxy of the host answers a request to a cluster that is not connected 503, since freelensapp/freelens
// cd07118f, but an upgrade, as the port-forward of the tunnel, still starts the proxy of that cluster, and with
// it an authentication the operator did not ask for. Nothing is asked of a cluster in any other state.
export const CONNECTED = "connected";

// Why nothing is asked of a cluster: its entry is not in the catalog, or it is not connected.
export type CatalogRefusal = "absent" | "disconnected";

export function refusalOf(entry: CatalogEntry | undefined): CatalogRefusal | undefined {
  if (!entry) return "absent";
  return entry.status === CONNECTED ? undefined : "disconnected";
}

// What makes the identity of a cluster: its identifier, the path of its kubeconfig and the name of its
// context, as the catalog names them.
export type EntryIdentity = Pick<CatalogEntry, "id" | "kubeConfigPath" | "contextName">;

// Whether two entries are of the same cluster: the same identifier, the same path of its kubeconfig and the
// same name of its context. Its state is not part of it.
export function sameEntry(one: EntryIdentity, other: EntryIdentity | undefined): boolean {
  return (
    !!other &&
    one.id === other.id &&
    one.kubeConfigPath === other.kubeConfigPath &&
    one.contextName === other.contextName
  );
}
