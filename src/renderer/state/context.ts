import { Renderer } from "@freelensapp/extensions";
import { heldPreferences } from "../../common/discovery";
import { PreferencesStore } from "../../common/preferences-store";
import { VeleroIpcRenderer } from "../api/ipc";
import { readCluster } from "../api/reader";
import { Installation } from "./installation";

import type { PreferenceStorage } from "../../common/discovery";

let installation: Installation | undefined;

// Without the store of the host the choices hold for the session and are not kept.
function storage(): PreferenceStorage {
  const store = PreferencesStore.getInstance<PreferencesStore>(false);

  return store ?? heldPreferences();
}

// The state of the views of this frame, which is the frame of one cluster: the one the host shows in it.
// It is created when the first view opens, and asks nothing before.
export function currentInstallation(): Installation {
  if (!installation) {
    const cluster = Renderer.Catalog.activeCluster.get();
    const gate = VeleroIpcRenderer.getInstance(false);
    const created = new Installation({
      cluster: { id: cluster?.getId() ?? window.location.hostname, name: cluster?.getName() ?? "Unknown cluster" },
      read: readCluster,
      now: () => Date.now(),
      storage: storage(),
      gate,
    });

    // When the main process turns writes off on its own, the frame of that cluster asks the state again.
    gate?.onChanged((changed) => {
      if (changed === created.cluster.id) void created.openGate();
    });
    installation = created;
  }
  return installation;
}
