import { Renderer } from "@freelensapp/extensions";
import { PreferencesStore } from "../common/preferences-store";

export default class VeleroRenderer extends Renderer.LensExtension {
  // No view exists yet, and nothing is registered that would lead to one. What the activation does is to
  // open the store of the preferences. Nothing is asked of a cluster.
  protected onActivate(): void {
    PreferencesStore.getInstanceOrCreate<PreferencesStore>().loadExtension(this);
  }
}
