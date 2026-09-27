import { computed, makeObservable } from "mobx";
import { Backup } from "../api/kinds";

import type { BackupResource } from "../../common/types";
import type { Installation } from "./installation";

// What the native list of the host asks of a store, answered from what the extension read of the selected
// installation. It selects nothing and removes nothing: the list is of a view that only reads.
export class BackupListStore {
  readonly api = {
    isNamespaced: true,
    apiBase: Backup.apiBase,
    kind: Backup.kind,
    apiVersionWithGroup: Backup.crd.apiVersions[0],
  };
  readonly selectedItems: Backup[] = [];
  private readonly installation: Installation;
  private readonly objects = new Map<string, Backup>();

  constructor(installation: Installation) {
    this.installation = installation;
    makeObservable(this, { items: computed, isLoaded: computed, failedLoading: computed });
  }

  // One object of the host for each backup, the same one until the backup changes.
  get items(): Backup[] {
    const read = this.installation.read("backups");
    const seen = new Set<string>();
    const items = (read.items as BackupResource[]).map((resource) => {
      const key = `${resource.metadata.uid}/${resource.metadata.resourceVersion}`;
      let object = this.objects.get(key);

      if (!object) {
        // The API does not give the link of an object any more, and the host asks for one to make an object.
        object = new Backup({
          ...resource,
          apiVersion: resource.apiVersion ?? Backup.crd.apiVersions[0],
          kind: resource.kind ?? Backup.kind,
          metadata: {
            ...resource.metadata,
            selfLink: `${Backup.apiBase.replace(/\/backups$/, "")}/namespaces/${resource.metadata.namespace}/backups/${resource.metadata.name}`,
          },
        } as never);
        this.objects.set(key, object);
      }
      seen.add(key);
      return object;
    });

    for (const key of this.objects.keys()) if (!seen.has(key)) this.objects.delete(key);
    return items;
  }

  get contextItems(): Backup[] {
    return this.items;
  }

  get isLoaded(): boolean {
    const status = this.installation.read("backups").status;

    return status !== "idle" && status !== "loading";
  }

  get failedLoading(): boolean {
    return false;
  }

  getTotalCount = (): number => this.items.length;
  getByPath = (path: string): Backup | undefined => this.items.find((item) => item.selfLink === path);
  isSelected = (): boolean => false;
  isSelectedAll = (): boolean => false;
  pickOnlySelected = (): Backup[] => [];
  toggleSelection = (): void => undefined;
  toggleSelectionAll = (): void => undefined;
  // The list of the host asks for these to exist. None of them reaches the cluster.
  removeItems = async (): Promise<void> => undefined;
  loadAll = async (): Promise<void> => undefined;
  subscribe = (): (() => void) => () => undefined;
}
