import { Main } from "@freelensapp/extensions";
import { PreferencesStore } from "../common/preferences-store";

export { DiagnosticKubernetes } from "./diagnostic-kubernetes";
export { DiagnosticService } from "./diagnostic-service";
export { DiagnosticError, downloadArtifact } from "./diagnostic-transport";
export { openPodTunnel } from "./diagnostic-tunnel";

export default class VeleroMain extends Main.LensExtension {
  // The preferences are written by this process: the store is opened here for what the views change to be
  // kept. Nothing is asked of a cluster.
  protected onActivate(): void {
    PreferencesStore.getInstanceOrCreate<PreferencesStore>().loadExtension(this);
  }
}
