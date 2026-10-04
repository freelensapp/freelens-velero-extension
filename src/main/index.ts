import { Main } from "@freelensapp/extensions";
import { PreferencesStore } from "../common/preferences-store";
import { catalogEntries, VeleroIpc } from "./ipc";

export { DiagnosticKubernetes } from "./diagnostic-kubernetes";
export { DiagnosticError, downloadArtifact } from "./diagnostic-transport";
export { openPodTunnel } from "./diagnostic-tunnel";
export { registerHandlers } from "./ipc";
export { WriteGate } from "./write-gate";

export default class VeleroMain extends Main.LensExtension {
  // The preferences are written by this process: the store is opened here for what the views change to be
  // kept. The procedures of the gate are registered, and answer the frames when they ask. Nothing is
  // asked of a cluster, or of the catalog, until a frame asks.
  protected onActivate(): void {
    PreferencesStore.getInstanceOrCreate<PreferencesStore>().loadExtension(this);
    VeleroIpc.createInstance(this).register(catalogEntries);
  }

  // Everything off: the writes in flight are aborted on this side, and no cluster keeps writes on.
  protected onDeactivate(): void {
    VeleroIpc.getInstance(false)?.release();
  }
}
