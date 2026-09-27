import { Renderer } from "@freelensapp/extensions";
import { emptyPreferences } from "../../common/discovery";
import { PreferencesStore } from "../../common/preferences-store";
import { readCluster } from "../api/reader";
import { Installation } from "./installation";

import type { PreferenceStorage } from "../../common/discovery";

let installation: Installation | undefined;

// Without the store of the host the choices hold for the session and are not kept.
function storage(): PreferenceStorage {
  const store = PreferencesStore.getInstance<PreferencesStore>(false);

  if (store) return store;
  let preferences = emptyPreferences();

  return {
    read: () => preferences,
    write: (next) => {
      preferences = next;
    },
  };
}

// The state of the views of this frame, which is the frame of one cluster: the one the host shows in it.
// It is created when the first view opens, and asks nothing before.
export function currentInstallation(): Installation {
  if (!installation) {
    const cluster = Renderer.Catalog.activeCluster.get();

    installation = new Installation({
      cluster: { id: cluster?.getId() ?? window.location.hostname, name: cluster?.getName() ?? "Unknown cluster" },
      read: readCluster,
      now: () => Date.now(),
      storage: storage(),
    });
  }
  return installation;
}
