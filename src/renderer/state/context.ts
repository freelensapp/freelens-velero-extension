import { Renderer } from "@freelensapp/extensions";
import { heldPreferences } from "../../common/discovery";
import { clusterOfAddress } from "../../common/frame";
import { PreferencesStore } from "../../common/preferences-store";
import { VeleroIpcRenderer } from "../api/ipc";
import { clusterReader } from "../api/reader";
import { Installation } from "./installation";

import type { PreferenceStorage } from "../../common/discovery";
import type { ClusterIdentity } from "./installation";

let installation: Installation | undefined;
// What stops the frame from hearing that the main process changed the gate on its own.
let stopListening: (() => void) | undefined;

// Without the store of the host the choices hold for the session and are not kept.
function storage(): PreferenceStorage {
  const store = PreferencesStore.getInstance<PreferencesStore>(false);

  return store ?? heldPreferences();
}

// The cluster of this frame. Its identifier is the one the host writes in the address of the frame, read by
// the rule of the host (src/common/frame.ts): it is the one the main process binds every request of this
// frame to, and the one the reader asks the client of the host for. The catalog of the host gives the same,
// with the name of the cluster. Where the address names no cluster, which the address of no frame of a
// cluster does, the catalog says which cluster is shown.
export function frameCluster(): ClusterIdentity {
  const address = globalThis.location?.href;
  const framed = typeof address === "string" ? clusterOfAddress(address) : undefined;
  const active = Renderer.Catalog.activeCluster.get();
  const id = framed ?? active?.getId() ?? "";
  const name = id
    ? (Renderer.Catalog.getClusterById(id)?.name ?? (active?.getId() === id ? active.getName() : undefined))
    : undefined;

  return { id, name: name ?? "Unknown cluster" };
}

// The state of the views of this frame, which is the frame of one cluster: the one the host shows in it.
// It is created when the first view opens, and asks nothing before.
export function currentInstallation(): Installation {
  if (!installation) {
    const cluster = frameCluster();
    const gate = VeleroIpcRenderer.getInstance(false);
    const created = new Installation({
      cluster,
      read: clusterReader(cluster.id),
      now: () => Date.now(),
      storage: storage(),
      gate,
      writer: gate,
      allowances: gate,
    });

    // When the main process turns writes off on its own, the frame of that cluster asks the state again.
    stopListening = gate?.onChanged((changed) => {
      if (changed === created.cluster.id) void created.openGate();
    });
    installation = created;
  }
  return installation;
}

// The extension is deactivated: the views of this frame let go of what they hold and stop hearing the main
// process. The host keeps the module until the extension is enabled again, and the views then start from
// nothing, with the IPC of that activation: no confirmation, no load and no listener of before.
export function releaseInstallation(): void {
  stopListening?.();
  stopListening = undefined;
  installation?.dispose();
  installation = undefined;
}
