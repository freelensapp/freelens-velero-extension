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

export class HostExtensionStub {
  name = "@freelensapp/velero-extension";
  clusterPages: unknown[] = [];
  clusterPageMenus: unknown[] = [];
  kubeObjectDetailItems: unknown[] = [];
  kubeObjectMenuItems: unknown[] = [];
  kubeObjectHandlers: unknown[] = [];

  activate(): void {
    this.onActivate();
  }

  disable(): void {
    this.onDeactivate();
  }

  protected onActivate(): void {
    return;
  }

  protected onDeactivate(): void {
    return;
  }
}

class MainExtensionStub extends HostExtensionStub {}
class RendererExtensionStub extends HostExtensionStub {}

// The IPC of the host, in both processes: what the main process registered, what was broadcast, and the
// frame a request of the tests comes from. A call of the renderer reaches the handler the main process
// registered under the channel, with that frame as its event.
export const ipcHandlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
export const ipcBroadcasts: { channel: string; args: unknown[] }[] = [];
const ipcListeners = new Map<string, Set<(event: unknown, ...args: unknown[]) => void>>();
export const ipcFrame = {
  current: { senderFrame: { url: "https://synthetic-cluster.renderer.freelens.app:1234/" }, processId: 1, frameId: 4 },
};

export function resetIpc(): void {
  ipcHandlers.clear();
  ipcBroadcasts.length = 0;
  ipcListeners.clear();
  ipcFrame.current = {
    senderFrame: { url: "https://synthetic-cluster.renderer.freelens.app:1234/" },
    processId: 1,
    frameId: 4,
  };
}

class IpcStub {
  private static instances = new Map<unknown, IpcStub>();

  constructor(protected readonly extension: unknown) {
    hostCalls.push("Ipc.constructor");
  }

  static createInstance<Stub extends IpcStub>(this: new (extension: unknown) => Stub, extension: unknown): Stub {
    const instance = new this(extension);

    // biome-ignore lint/complexity/noThisInStatic: see above
    IpcStub.instances.set(this, instance);
    return instance;
  }

  static getInstance<Stub extends IpcStub>(this: new (extension: unknown) => Stub, strict = true): Stub | undefined {
    // biome-ignore lint/complexity/noThisInStatic: see above
    const instance = IpcStub.instances.get(this) as Stub | undefined;

    if (!instance && strict) throw new Error("The IPC of the extension was not created");
    return instance;
  }

  static resetInstance(): void {
    // biome-ignore lint/complexity/noThisInStatic: see above
    IpcStub.instances.delete(this);
  }

  handle(channel: string, handler: (event: unknown, ...args: unknown[]) => unknown): void {
    hostCalls.push(`Ipc.handle ${channel}`);
    ipcHandlers.set(channel, handler);
  }

  listen(channel: string, listener: (event: unknown, ...args: unknown[]) => void): () => void {
    const listeners = ipcListeners.get(channel) ?? new Set();

    listeners.add(listener);
    ipcListeners.set(channel, listeners);
    return () => listeners.delete(listener);
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

class KubeApiStub {
  readonly request = {
    getResponse: async (path: string, _params?: unknown, init?: { method?: string }) => {
      hostCalls.push(`${init?.method ?? "GET"} ${path}`);
      return { status: 404, text: async () => "404 page not found\n" };
    },
  };

  constructor(options: { objectConstructor: { kind: string } }) {
    hostCalls.push(`KubeApi ${options.objectConstructor.kind}`);
  }
}

class KubeObjectStoreStub {}

const stores = new Map<unknown, ExtensionStoreStub>();

// The store of the host is one for each class that extends it: the class is what it is asked by.
class ExtensionStoreStub {
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

  loadExtension(): void {
    hostCalls.push("ExtensionStore.loadExtension");
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

// The clusters the catalog of the host gives the main process, as a test sets them. Asked before a test
// sets them, the catalog is what the scaffold must not reach.
export const hostCatalog: { clusters?: { id: string; name: string; kubeConfigPath: string; contextName: string }[] } =
  {};

export const Main = {
  LensExtension: MainExtensionStub,
  K8s: blockedNamespace("Main.K8s"),
  Catalog: {
    getAllClusters: () => {
      if (!hostCatalog.clusters) {
        forbiddenAccesses.push("Main.Catalog.getAllClusters");
        throw new Error("Unexpected scaffold access: Main.Catalog.getAllClusters");
      }
      hostCalls.push("Catalog.getAllClusters");
      return hostCatalog.clusters;
    },
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
  },
  Component: components,
  Navigation: { createPageParam: param, navigate },
  Catalog: { activeCluster: { get: () => ({ getId: () => "synthetic-cluster", getName: () => "synthetic-cluster" }) } },
  Ipc: IpcStub,
};

export const Common = {
  Store: { ExtensionStore: ExtensionStoreStub },
};
