// What stands for the host in the tests: the classes an extension builds on, and a record of what was asked
// of them. What an extension must not reach, in either process, throws and is recorded.

import { observable, runInAction } from "mobx";
import { hostComponents } from "./host-components";

export const forbiddenAccesses: string[] = [];
// What the extension asked of the host: the APIs it created, the requests it made, the stores it opened.
export const hostCalls: string[] = [];

function blockedNamespace(name: string): object {
  return new Proxy(
    {},
    {
      get(_target, property) {
        const access = `${name}.${String(property)}`;

        forbiddenAccesses.push(access);
        throw new Error(`Unexpected scaffold access: ${access}`);
      },
    },
  );
}

// What an API of the host gave an extension pushes the way back to its disposers, which the host runs when
// the extension is disabled, after its onDeactivate (packages/core/src/extensions/lens-extension.ts lines 95
// to 110 at the validation target). An object a test gives in place of an extension has none.
function disposersOf(extension: unknown): (() => void)[] | undefined {
  const disposers = (extension as { disposers?: unknown } | null | undefined)?.disposers;

  return Array.isArray(disposers) ? disposers : undefined;
}

export class HostExtensionStub {
  name = "@freelensapp/velero-extension";
  // Where the host unpacked the extension: its folder is the working directory of what the main process runs.
  manifestPath = "/synthetic/extensions/velero-extension/package.json";
  clusterPages: unknown[] = [];
  clusterPageMenus: unknown[] = [];
  kubeObjectDetailItems: unknown[] = [];
  kubeObjectMenuItems: unknown[] = [];
  kubeObjectHandlers: unknown[] = [];
  // The disposers of the extension, in the order they were given.
  readonly disposers: (() => void)[] = [];

  activate(): void {
    this.onActivate();
  }

  // As the host disables an extension: its onDeactivate, then its disposers, each once.
  disable(): void {
    this.onDeactivate();
    for (const dispose of this.disposers.splice(0)) dispose();
  }

  protected onActivate(): void {
    return;
  }

  protected onDeactivate(): void {
    return;
  }
}

class MainExtensionStub extends HostExtensionStub {}
class RendererExtensionStub extends HostExtensionStub {
  customResources: unknown[] = [];
}

// The IPC of the host, in both processes: what the main process registered, what was broadcast, and the
// frame a request of the tests comes from. A call of the renderer reaches the handler the main process
// registered under the channel, with that frame as its event.
export const ipcHandlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
export const ipcBroadcasts: { channel: string; args: unknown[] }[] = [];
const ipcListeners = new Map<string, Set<(event: unknown, ...args: unknown[]) => void>>();
export const ipcFrame = {
  current: { senderFrame: { url: "https://synthetic-cluster.renderer.freelens.app:1234/" }, processId: 1, frameId: 4 },
};

// The instances of the IPC of the host, one for each class.
const ipcInstances = new Map<unknown, IpcStub>();

// How many listeners hear a channel of the IPC, in the renderer: the frames of the tests.
export function ipcListenerCount(channel: string): number {
  return ipcListeners.get(channel)?.size ?? 0;
}

export function resetIpc(): void {
  ipcHandlers.clear();
  ipcBroadcasts.length = 0;
  ipcListeners.clear();
  ipcInstances.clear();
  ipcFrame.current = {
    senderFrame: { url: "https://synthetic-cluster.renderer.freelens.app:1234/" },
    processId: 1,
    frameId: 4,
  };
}

// `Main.Ipc` and `Renderer.Ipc` as the host makes them (packages/core/src/extensions/ipc/ at the validation
// target): one instance for each class, made with the extension of its first call (Singleton,
// packages/core/src/common/utils/singleton.ts lines 36 to 82), whose reset the host gives the disposers of
// that extension (ipc-main.ts line 37, ipc-renderer.ts line 21); a handler and a listener are taken out by
// the same disposers (ipc-main.ts lines 72 to 88, ipc-renderer.ts lines 40 to 59). Electron refuses a second
// handler for a channel that has one.
class IpcStub {
  constructor(protected readonly extension: unknown) {
    hostCalls.push("Ipc.constructor");
    disposersOf(extension)?.push(() => (this.constructor as typeof IpcStub).resetInstance());
  }

  static createInstance<Stub extends IpcStub>(this: new (extension: unknown) => Stub, extension: unknown): Stub {
    // biome-ignore lint/complexity/noThisInStatic: see above
    let instance = ipcInstances.get(this) as Stub | undefined;

    if (!instance) {
      instance = new this(extension);
      // biome-ignore lint/complexity/noThisInStatic: see above
      ipcInstances.set(this, instance);
    }
    return instance;
  }

  static getInstance<Stub extends IpcStub>(this: new (extension: unknown) => Stub, strict = true): Stub | undefined {
    // biome-ignore lint/complexity/noThisInStatic: see above
    const instance = ipcInstances.get(this) as Stub | undefined;

    if (!instance && strict) throw new Error("The IPC of the extension was not created");
    return instance;
  }

  static resetInstance(): void {
    // biome-ignore lint/complexity/noThisInStatic: see above
    ipcInstances.delete(this);
  }

  handle(channel: string, handler: (event: unknown, ...args: unknown[]) => unknown): void {
    hostCalls.push(`Ipc.handle ${channel}`);
    if (ipcHandlers.has(channel)) throw new Error(`Attempted to register a second handler for '${channel}'`);
    ipcHandlers.set(channel, handler);
    disposersOf(this.extension)?.push(() => ipcHandlers.delete(channel));
  }

  listen(channel: string, listener: (event: unknown, ...args: unknown[]) => void): () => void {
    const listeners = ipcListeners.get(channel) ?? new Set();
    const stop = () => {
      listeners.delete(listener);
    };

    listeners.add(listener);
    ipcListeners.set(channel, listeners);
    disposersOf(this.extension)?.push(stop);
    return stop;
  }

  broadcast(channel: string, ...args: unknown[]): void {
    ipcBroadcasts.push({ channel, args });
    for (const listener of ipcListeners.get(channel) ?? []) listener({}, ...args);
  }

  invoke(channel: string, ...args: unknown[]): Promise<unknown> {
    const handler = ipcHandlers.get(channel);

    if (!handler) return Promise.reject(new Error(`No handler of the main process for ${channel}`));
    return Promise.resolve(handler(ipcFrame.current, ...args));
  }
}

// An object of the host: plain data, with the accessors the lists of the host call.
class KubeObjectStub {
  metadata: { name?: string; namespace?: string; uid?: string; selfLink?: string } = {};

  constructor(data: object) {
    Object.assign(this, data);
  }

  get selfLink(): string {
    return this.metadata.selfLink ?? "";
  }

  getName(): string {
    return this.metadata.name ?? "";
  }

  getNs(): string | undefined {
    return this.metadata.namespace;
  }

  getId(): string {
    return this.metadata.uid ?? "";
  }

  static getStore(): never {
    throw new Error("The host has no store for this kind");
  }
}

// A `KubeApi` an extension creates registers itself with the host (packages/core/src/extensions/
// common-api/k8s-api.ts lines 82 to 96 at the validation target): each one created, and each registration
// with the API manager, is recorded, and the extension is to make neither.
class KubeApiStub {
  constructor(options: { objectConstructor: { kind: string } }) {
    hostCalls.push(`KubeApi ${options.objectConstructor.kind}`);
  }
}

class KubeObjectStoreStub {
  constructor() {
    hostCalls.push("KubeObjectStore");
  }
}

const apiManager = {
  registerApi: (): void => {
    hostCalls.push("apiManager.registerApi");
  },
  registerStore: (): void => {
    hostCalls.push("apiManager.registerStore");
  },
};

// What a registration helper of the host made each registration with, by the registration it returned.
export const registeredWith = new WeakMap<object, "detailsFor" | "menuItemFor">();

// The registration helpers of the host, as packages/core/src/extensions/renderer-api/
// kube-object-registrations.ts makes them at the validation target (lines 121 to 162): the kind and the
// versions taken from the class, and the component with the options given.
function kindAndVersions(
  helper: string,
  kubeObjectClass: { name: string; kind?: string; apiBase?: string; crd?: { apiVersions: readonly string[] } },
  apiVersions?: readonly string[],
) {
  const versions = apiVersions ?? kubeObjectClass.crd?.apiVersions;

  if (!kubeObjectClass.kind) throw new Error(`${helper}(${kubeObjectClass.name}): the class has no static "kind"`);
  if (!versions?.length) throw new Error(`${helper}(${kubeObjectClass.name}): no versions`);
  return { kind: kubeObjectClass.kind, apiVersions: [...versions] };
}

function detailsFor(
  kubeObjectClass: { name: string; kind?: string; crd?: { apiVersions: readonly string[] } },
  {
    Details,
    apiVersions,
    priority,
    visible,
  }: { Details: unknown; apiVersions?: string[]; priority?: number; visible?: unknown },
) {
  const registration = {
    ...kindAndVersions("detailsFor", kubeObjectClass, apiVersions),
    components: { Details },
    ...(priority === undefined ? {} : { priority }),
    ...(visible === undefined ? {} : { visible }),
  };

  registeredWith.set(registration, "detailsFor");
  return registration;
}

function menuItemFor(
  kubeObjectClass: { name: string; kind?: string; crd?: { apiVersions: readonly string[] } },
  { MenuItem, apiVersions, visible }: { MenuItem: unknown; apiVersions?: string[]; visible?: unknown },
) {
  const registration = {
    ...kindAndVersions("menuItemFor", kubeObjectClass, apiVersions),
    components: { MenuItem },
    ...(visible === undefined ? {} : { visible }),
  };

  registeredWith.set(registration, "menuItemFor");
  return registration;
}

// What the host gives the renderer for the cluster of a frame, as a test sets it: the client of its proxy,
// `Renderer.K8sApi.KubeJsonApi.forCluster`. Asked before a test sets it, it is what the scaffold must not
// reach.
export const hostViews: { forCluster?: (clusterId: string) => unknown } = {};

// The clusters the catalog of the host gives the renderer by their identifier, as a test sets them.
export const rendererCatalog: { clusters: { id: string; name: string }[] } = {
  clusters: [{ id: "synthetic-cluster", name: "synthetic-cluster" }],
};

const stores = new Map<unknown, ExtensionStoreStub>();

// The stores that save into their file now, each with the store it is of: one for each load of a store
// that was not stopped since.
export const savingStores: { store: object }[] = [];

// The store of the host is one for each class that extends it: the class is what it is asked by. It
// outlives a disable, as the module of the extension does; a load stops the saving of the load before and
// starts its own, which the disposers of the extension stop (packages/core/src/extensions/
// base-extension-store.ts lines 82 to 109 at the validation target).
class ExtensionStoreStub {
  private saving?: { store: object };

  static getInstanceOrCreate(this: new () => ExtensionStoreStub): ExtensionStoreStub {
    // biome-ignore lint/complexity/noThisInStatic: see above
    let instance = stores.get(this);

    if (!instance) {
      instance = new this();
      // biome-ignore lint/complexity/noThisInStatic: see above
      stores.set(this, instance);
    }
    return instance;
  }

  static getInstance(this: unknown): ExtensionStoreStub | undefined {
    // biome-ignore lint/complexity/noThisInStatic: see above
    return stores.get(this);
  }

  loadExtension(extension?: unknown): void {
    hostCalls.push("ExtensionStore.loadExtension");
    const stop = (saving: { store: object }) => {
      const index = savingStores.indexOf(saving);

      if (index >= 0) savingStores.splice(index, 1);
    };

    if (this.saving) stop(this.saving);
    const saving = { store: this };

    savingStores.push(saving);
    this.saving = saving;
    disposersOf(extension)?.push(() => stop(saving));
  }
}

// The address of a page, as the host keeps it: one search, of which every parameter of a page reads and
// writes the values of its own name. A view that reads a parameter follows the address, as it does in the
// host. How many times the address was changed is counted: one change of what is shown is one change of
// the address.
export const addressChanges = { count: 0 };
const search = observable.box("", { deep: false });

// The search of the address as it is now, without its question mark.
export function addressSearch(): string {
  return search.get();
}

// The host goes to an address, which is one change of it, and leaves out of it every parameter that has
// no value: it goes then to the address without them, which is a second change.
function go(next: string): void {
  const kept = new URLSearchParams([...new URLSearchParams(next)].filter(([, value]) => value !== "")).toString();

  addressChanges.count += kept === new URLSearchParams(next).toString() ? 1 : 2;
  runInAction(() => search.set(kept));
}

// A parameter of the address, with what the host gives of one: its value, set with the other parameters
// kept, taken out, and the search the address would have with another value of it.
function param(init: { name?: string; defaultValue?: unknown } = {}) {
  const name = init.name ?? "";
  const many = Array.isArray(init.defaultValue);
  const get = () => {
    const values = new URLSearchParams(search.get()).getAll(name);

    return (many ? values : values[0]) ?? init.defaultValue;
  };
  const merged = (value: unknown) => {
    const params = new URLSearchParams(search.get());

    params.delete(name);
    for (const one of [value].flat()) params.append(name, String(one));
    return params.toString();
  };

  return {
    get,
    set: (next: unknown) => go(merged(next)),
    // A parameter that is not in the address is not taken out of it: nothing changes.
    clear: () => {
      if (new URLSearchParams(search.get()).has(name)) go(merged([]));
    },
    toString: ({ value }: { value?: unknown } = {}) => merged(value ?? get()),
  };
}

// The host is sent to an address, of which the views give the search alone. Sent to the address it is at,
// it goes there and comes back: two changes for nothing.
function navigate(location: { search: string }): void {
  const next = new URLSearchParams(location.search).toString();

  if (next === search.get()) addressChanges.count += 2;
  else go(next);
}

// Every component of the host, by any name. The ones a view is read through have their markup; the others
// render what they are given and nothing of their own.
const components = new Proxy(hostComponents as Record<string | symbol, unknown>, {
  get(target, name) {
    if (target[name]) return target[name];
    const Component = (props: { children?: unknown }) => props.children ?? null;

    Object.defineProperty(Component, "name", { value: String(name) });
    return Component;
  },
});

// The clusters the catalog of the host gives the main process, as a test sets them, each with its state:
// connecting, connected, disconnected or disconnecting (packages/core/src/extensions/common-api/
// cluster-types.ts at the validation target). Asked before a test sets them, the catalog is what the
// scaffold must not reach. A test that follows a change sets an observable list, as the catalog of the host
// is observable.
export const hostCatalog: {
  clusters?: { id: string; name: string; kubeConfigPath: string; contextName: string; status: string }[];
} = {};

// What the host gives the main process for a cluster beside its catalog, as a test sets it: the client of
// its proxy, `Main.K8sApi.KubeJsonApi.forCluster`, and the kubectl and the environment of `Main.Shell`.
// Asked before a test sets them, they are what the scaffold must not reach.
export const hostCluster: {
  forCluster?: (clusterId: string) => unknown;
  kubectl?: (clusterId: string) => Promise<string>;
  environment?: (clusterId: string) => Promise<Record<string, string>>;
} = {};

function catalogClusters(access: string) {
  if (!hostCatalog.clusters) {
    forbiddenAccesses.push(access);
    throw new Error(`Unexpected scaffold access: ${access}`);
  }
  hostCalls.push(access.replace(/^Main\./, ""));
  return hostCatalog.clusters;
}

function ofTheHost<Name extends keyof typeof hostCluster>(
  name: Name,
  access: string,
): NonNullable<(typeof hostCluster)[Name]> {
  const given = hostCluster[name];

  if (!given) {
    forbiddenAccesses.push(access);
    throw new Error(`Unexpected scaffold access: ${access}`);
  }
  return given as NonNullable<(typeof hostCluster)[Name]>;
}

export const Main = {
  LensExtension: MainExtensionStub,
  K8s: blockedNamespace("Main.K8s"),
  K8sApi: {
    KubeJsonApi: {
      forCluster: (clusterId: string) => ofTheHost("forCluster", "Main.K8sApi.KubeJsonApi.forCluster")(clusterId),
    },
  },
  Shell: {
    getKubectlPath: (clusterId: string) => ofTheHost("kubectl", "Main.Shell.getKubectlPath")(clusterId),
    getEnvironment: (clusterId: string) => ofTheHost("environment", "Main.Shell.getEnvironment")(clusterId),
  },
  Catalog: {
    getAllClusters: () => catalogClusters("Main.Catalog.getAllClusters"),
    getClusterById: (clusterId: string) =>
      catalogClusters("Main.Catalog.getClusterById").find((cluster) => cluster.id === clusterId),
  },
  Ipc: IpcStub,
};

export const Renderer = {
  LensExtension: RendererExtensionStub,
  K8s: blockedNamespace("Renderer.K8s"),
  K8sApi: {
    LensExtensionKubeObject: KubeObjectStub,
    KubeApi: KubeApiStub,
    KubeObjectStore: KubeObjectStoreStub,
    KubeJsonApi: {
      forCluster: (clusterId: string) => {
        if (!hostViews.forCluster) {
          forbiddenAccesses.push("Renderer.K8sApi.KubeJsonApi.forCluster");
          throw new Error("Unexpected scaffold access: Renderer.K8sApi.KubeJsonApi.forCluster");
        }
        return hostViews.forCluster(clusterId);
      },
    },
    apiManager,
    detailsFor,
    menuItemFor,
  },
  Component: components,
  Navigation: { createPageParam: param, navigate },
  Catalog: {
    activeCluster: { get: () => ({ getId: () => "synthetic-cluster", getName: () => "synthetic-cluster" }) },
    getClusterById: (clusterId: string) => rendererCatalog.clusters.find((cluster) => cluster.id === clusterId),
  },
  Ipc: IpcStub,
};

export const Common = {
  Store: { ExtensionStore: ExtensionStoreStub },
};
