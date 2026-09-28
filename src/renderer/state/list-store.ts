import { computed, makeObservable } from "mobx";

import type { Renderer } from "@freelensapp/extensions";

import type { Family } from "../../common/discovery";
import type { VeleroCrd } from "../api/kinds";
import type { Installation, Resource } from "./installation";

type HostObject = Renderer.K8sApi.KubeObject;

// A kind of Velero as the host knows it: what its class says of it, and how an object of it is made.
export interface VeleroKind<Item extends HostObject> {
  new (data: never): Item;
  readonly kind: string;
  readonly apiBase: string;
  readonly crd: VeleroCrd;
}

// Each class types what it is made from by its own kind. The store makes the objects of any kind from what
// was read of the family of that kind, which is the plain data of the API the class is made from.
type Made<Item> = new (
  data: Omit<Resource, "metadata"> & {
    apiVersion: string;
    kind: string;
    metadata: Resource["metadata"] & { selfLink: string };
  },
) => Item;

// What the native list of the host asks of a store, answered from what the extension read of the selected
// installation. It selects nothing and removes nothing: the list is of a view that only reads.
export class FamilyListStore<Item extends HostObject> {
  readonly api: { isNamespaced: boolean; apiBase: string; kind: string; apiVersionWithGroup: string };
  readonly selectedItems: Item[] = [];
  private readonly installation: Installation;
  private readonly family: Family;
  private readonly object: VeleroKind<Item>;
  private readonly objects = new Map<string, Item>();

  constructor(installation: Installation, family: Family, object: VeleroKind<Item>) {
    this.installation = installation;
    this.family = family;
    this.object = object;
    this.api = {
      isNamespaced: true,
      apiBase: object.apiBase,
      kind: object.kind,
      apiVersionWithGroup: object.crd.apiVersions[0],
    };
    makeObservable(this, { items: computed, isLoaded: computed, failedLoading: computed });
  }

  // One object of the host for each object that was read, the same one until the object changes.
  get items(): Item[] {
    const { apiBase, kind, crd } = this.object;
    const seen = new Set<string>();
    const items = (this.installation.read(this.family).items as Resource[]).map((resource) => {
      const key = `${resource.metadata.uid}/${resource.metadata.resourceVersion}`;
      let object = this.objects.get(key);

      if (!object) {
        // The API does not give the link of an object any more, and the host asks for one to make an object.
        object = new (this.object as unknown as Made<Item>)({
          ...resource,
          apiVersion: resource.apiVersion ?? crd.apiVersions[0],
          kind: resource.kind ?? kind,
          metadata: {
            ...resource.metadata,
            selfLink: `${apiBase.slice(0, -crd.plural.length - 1)}/namespaces/${resource.metadata.namespace}/${crd.plural}/${resource.metadata.name}`,
          },
        });
        this.objects.set(key, object);
      }
      seen.add(key);
      return object;
    });

    for (const key of this.objects.keys()) if (!seen.has(key)) this.objects.delete(key);
    return items;
  }

  get contextItems(): Item[] {
    return this.items;
  }

  get isLoaded(): boolean {
    const status = this.installation.read(this.family).status;

    return status !== "idle" && status !== "loading";
  }

  get failedLoading(): boolean {
    return false;
  }

  getTotalCount = (): number => this.items.length;
  getByPath = (path: string): Item | undefined => this.items.find((item) => item.selfLink === path);
  isSelected = (): boolean => false;
  isSelectedAll = (): boolean => false;
  pickOnlySelected = (): Item[] => [];
  toggleSelection = (): void => undefined;
  toggleSelectionAll = (): void => undefined;
  // The list of the host asks for these to exist. None of them reaches the cluster.
  removeItems = async (): Promise<void> => undefined;
  loadAll = async (): Promise<void> => undefined;
  subscribe = (): (() => void) => () => undefined;
}
