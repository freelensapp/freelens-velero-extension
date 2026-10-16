import { writeFile } from "node:fs/promises";
import { Main } from "@freelensapp/extensions";
import { PreferencesStore } from "../common/preferences-store";
import { hostDialog, saveThroughDialog } from "./artifact-save";
import { catalogEntries, hostDependencies } from "./host";
import { VeleroIpc } from "./ipc";

export { DiagnosticKubernetes } from "./diagnostic-kubernetes";
export { DiagnosticError, downloadArtifact } from "./diagnostic-transport";
export { KubectlTunnels } from "./diagnostic-tunnel";
export { registerHandlers } from "./ipc";
export { WriteGate } from "./write-gate";

export default class VeleroMain extends Main.LensExtension {
  // The preferences are written by this process: the store is opened here for what the views change to be
  // kept. The procedures of the gate are registered on an instance of the IPC made for this activation, and
  // answer the frames when they ask. Nothing is asked of a cluster, or of the catalog, until a frame asks.
  // The host keeps the module of the extension from a disable to the next enable: the store is the same
  // instance, which the host makes save again, and the IPC is made again, since it was reset.
  protected onActivate(): void {
    const store = PreferencesStore.getInstanceOrCreate<PreferencesStore>();

    // What the operator allowed the downloads to do is kept with the preferences, by this process alone:
    // the procedures read it from the store before a connection, and write it when it is given or taken
    // back, and what a window sends of it is not taken.
    store.keepAllowances();
    store.loadExtension(this);
    VeleroIpc.createInstance(this).register(catalogEntries, {
      // A cluster is reached through the host alone: its catalog, the client of its proxy, and the kubectl
      // it runs for the cluster, in the folder of the extension.
      ...hostDependencies(() => this.manifestPath),
      allowances: {
        read: () => store.read().allowances ?? {},
        write: (allowances) => store.write({ ...store.read(), allowances }),
      },
      // The text of an artifact is saved into the file the operator chooses in the dialog of the host,
      // which is taken from the module of Electron at each save.
      save: (suggested, content, still) =>
        saveThroughDialog(hostDialog(), (file, bytes) => writeFile(file, bytes), suggested, content, still),
    });
  }

  // Everything off: the writes in flight are aborted on this side, no cluster keeps writes on, every
  // kubectl of the extension is killed, and the IPC is reset, so that the next activation makes its own. The
  // host then removes the handlers of the instance and resets it again, which finds nothing to reset.
  protected onDeactivate(): void {
    VeleroIpc.getInstance(false)?.release();
    VeleroIpc.resetInstance();
  }
}
