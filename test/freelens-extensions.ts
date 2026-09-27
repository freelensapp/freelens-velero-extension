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

class BlockedIpc {
  constructor() {
    forbiddenAccesses.push("Ipc.constructor");
    throw new Error("The scaffold must not register IPC handlers");
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
    // biome-ignore lint/complexity/noThisInStatic: the class that is asked is the one that extends this one
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

// A parameter of the address of a page: a view that reads it follows it, as it does in the host.
function param() {
  const value = observable.box("");

  return {
    get: () => value.get(),
    set: (next: string) => runInAction(() => value.set(next)),
    clear: () => runInAction(() => value.set("")),
  };
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

export const Main = {
  LensExtension: MainExtensionStub,
  K8s: blockedNamespace("Main.K8s"),
  Catalog: blockedNamespace("Main.Catalog"),
  Ipc: BlockedIpc,
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
  Navigation: { createPageParam: param },
  Catalog: { activeCluster: { get: () => ({ getId: () => "synthetic-cluster", getName: () => "synthetic-cluster" }) } },
  Ipc: BlockedIpc,
};

export const Common = {
  Store: { ExtensionStore: ExtensionStoreStub },
};
