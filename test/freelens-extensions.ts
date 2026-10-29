// What stands for the host in the tests: the API of `@freelensapp/extensions` as the host gives it on its global,
// written from its source at the validation target, freelensapp/freelens at
// b9b53e16056578c5407312eba5823a089972f6d5, with a record of what was asked of it. Every part names the file
// and the lines it follows. A namespace has the names it has a double for and refuses any other, recorded with
// what the scaffold must not reach: a name the SDK of v2 does not export has no double, since a double of such a
// name does not compile (the `satisfies` of each namespace below), so a component or a function the host
// removed fails a test. The components are in `host-components.tsx`, the address of the frame in
// `host-address.ts`, and the client of the proxy of a cluster in `host-client.ts`.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { reaction, toJS } from "mobx";
import { addressChanges, addressPath, addressSearch, createPageParam, navigate, resetAddress } from "./host-address";
import { hostComponents } from "./host-components";

import type * as Sdk from "@freelensapp/extensions";

export { addressChanges, addressPath, addressSearch, resetAddress };

export const forbiddenAccesses: string[] = [];
// What the extension asked of the host: the APIs it created, the requests it made, the stores it opened.
export const hostCalls: string[] = [];
// What the host logged, in order: what an extension logs through `Common.logger` (packages/core/src/extensions/
// common-api/index.ts line 37), each level given a message and what follows it, which the host writes as they
// were given (packages/logger/src/logger.injectable.ts lines 11 to 49), and what the host logs of the extension
// with the same logger.
export const hostLog: { level: string; message: string; data: unknown[] }[] = [];

function logAt(level: string) {
  return (message: string, ...data: unknown[]): void => {
    hostLog.push({ level, message, data });
  };
}

const logger = {
  debug: logAt("debug"),
  info: logAt("info"),
  warn: logAt("warn"),
  error: logAt("error"),
  silly: logAt("silly"),
};

// The names a namespace of the SDK exports as values: a double of another name does not compile.
type Exported<Namespace> = { [Name in keyof Namespace]?: unknown };

// A namespace of the API, with its doubles. A name it has no double for is refused and recorded. A symbol is no
// name of the API, and neither is `then`, which a promise asks of what it is given.
function namespace<Members extends object>(path: string, members: Members): Members {
  return new Proxy(members, {
    get(target, name, receiver) {
      if (typeof name === "symbol" || name === "then" || name in target) return Reflect.get(target, name, receiver);
      const access = `${path}.${name}`;

      forbiddenAccesses.push(access);
      throw new Error(
        `${access} has no double in the stub of the host: the SDK of v2 does not export it, or its double is to be written from the source of the host`,
      );
    },
  });
}

// What an extension must not reach at all: any access throws and is recorded.
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

// What an extension was given, which the host takes back when it disables it, after its onDeactivate
// (packages/core/src/extensions/lens-extension.ts lines 15 and 47): every one, in the order it was given, once
// (packages/utility-features/utilities/src/disposer.ts lines 21 to 41).
export const Disposers = Symbol("disposers");

export interface ExtendableDisposer {
  (): void;
  push(...disposers: (() => void)[]): void;
}

function disposer(): ExtendableDisposer {
  const items: (() => void)[] = [];

  return Object.assign(
    () => {
      for (const item of items) item();
      items.length = 0;
    },
    { push: (...more: (() => void)[]) => void items.push(...more) },
  );
}

// The installation of this extension, as the host gives it to the class it makes the extension of
// (packages/core/src/extensions/installed-extension.ts lines 16 to 52): its identifier is the name of its
// manifest, and its files are in a folder of the version and the digest of the tarball it was installed from.
const manifest = JSON.parse(readFileSync(resolve("package.json"), "utf8")) as {
  name: string;
  version: string;
};
const FOLDER = `/synthetic/user-data/extensions/freelensapp--velero-extension/${manifest.version}-0f1e2d3c`;

export const INSTALLED = {
  id: manifest.name,
  absolutePath: FOLDER,
  manifestPath: `${FOLDER}/package.json`,
  manifest: { name: manifest.name, version: manifest.version },
  isCompatible: true,
  isManaged: true,
  isVerified: false,
  isEnabled: true,
};

// `LensExtension` (packages/core/src/extensions/lens-extension.ts lines 22 to 123): its name and its version from
// its manifest; `activate` runs its onActivate, which the loader of the host awaits before it enables it; a
// disable of an extension that is enabled runs its onDeactivate, awaited, then gives back what it was given,
// and logs an error of either instead of throwing it.
class LensExtensionStub {
  readonly id: string;
  readonly manifest: { name: string; version: string; description?: string; storeName?: string };
  readonly manifestPath: string;
  protocolHandlers: unknown[] = [];
  readonly [Disposers] = disposer();
  #enabled = false;

  constructor({ id, manifest, manifestPath } = INSTALLED) {
    this.id = id;
    this.manifest = manifest;
    this.manifestPath = manifestPath;
  }

  get sanitizedExtensionId(): string {
    return this.name.replace("@", "").replace("/", "--");
  }

  get name(): string {
    return this.manifest.name;
  }

  get version(): string {
    return this.manifest.version;
  }

  get description(): string | undefined {
    return this.manifest.description;
  }

  get storeName(): string {
    return this.manifest.storeName || this.name;
  }

  get isEnabled(): boolean {
    return this.#enabled;
  }

  async enable(): Promise<void> {
    if (this.#enabled) return;
    this.#enabled = true;
    logger.info(`[EXTENSION]: enabled ${this.name}@${this.version}`);
  }

  async disable(): Promise<void> {
    if (!this.#enabled) return;
    this.#enabled = false;
    try {
      await this.onDeactivate();
      this[Disposers]();
      logger.info(`[EXTENSION]: disabled ${this.name}@${this.version}`);
    } catch (error) {
      logger.error(`[EXTENSION]: disabling ${this.name}@${this.version} threw an error: ${error}`);
    }
  }

  async activate(): Promise<void> {
    return this.onActivate();
  }

  protected onActivate(): Promise<void> | void {
    return;
  }

  protected onDeactivate(): Promise<void> | void {
    return;
  }
}

// `LensMainExtension` (packages/core/src/extensions/lens-main-extension.ts lines 29 to 77): it registers nothing.
class MainExtensionStub extends LensExtensionStub {}

// `LensRendererExtension` (packages/core/src/extensions/lens-renderer-extension.ts lines 59 to 85): what an extension
// registers in a frame, each empty until the extension fills it.
class RendererExtensionStub extends LensExtensionStub {
  globalPages: unknown[] = [];
  clusterPages: unknown[] = [];
  clusterPageMenus: unknown[] = [];
  clusterFrameComponents: unknown[] = [];
  appPreferences: unknown[] = [];
  appPreferenceTabs: unknown[] = [];
  entitySettings: unknown[] = [];
  statusBarItems: unknown[] = [];
  kubeObjectDetailItems: unknown[] = [];
  kubeObjectMenuItems: unknown[] = [];
  kubeWorkloadsOverviewItems: unknown[] = [];
  commands: unknown[] = [];
  welcomeMenus: unknown[] = [];
  catalogEntityDetailItems: unknown[] = [];
  topBarItems: unknown[] = [];
  additionalCategoryColumns: unknown[] = [];
  customCategoryViews: unknown[] = [];
  kubeObjectHandlers: unknown[] = [];
  customResources: unknown[] = [];
}

// An extension as the tests read it, in either process.
export type HostExtensionStub = RendererExtensionStub;

// An extension of a process as the host makes it, for a test that makes the way between the processes with the
// extension it is of, as the extension does in its onActivate.
export function anExtension(process: "main" | "renderer"): HostExtensionStub {
  return (process === "main" ? new MainExtensionStub() : new RendererExtensionStub()) as HostExtensionStub;
}

// As the loader of the host runs an extension it made: its onActivate, awaited, then the extension enabled
// (packages/core/src/extensions/extension-loader/extension-loader.ts lines 737 to 767 and 776 to 833).
export async function loaded<Extension extends LensExtensionStub>(extension: Extension): Promise<Extension> {
  await extension.activate();
  await extension.enable();
  return extension;
}

// `Singleton` (packages/core/src/common/utils/singleton.ts lines 14 to 82): one instance for each class, made by
// `createInstance` alone, whose later calls give the same instance whatever they are given.
const singletons = new Map<unknown, unknown>();
let creating = "";

class SingletonStub {
  constructor() {
    if (creating.length === 0) throw new TypeError("A singleton class must be created by createInstance()");
  }

  static createInstance<T, A extends unknown[]>(this: new (...args: A) => T, ...args: A): T {
    // biome-ignore lint/complexity/noThisInStatic: the class the method is called on, as in the host
    if (!singletons.has(this)) {
      if (creating.length > 0)
        // biome-ignore lint/complexity/noThisInStatic: the class the method is called on, as in the host
        throw new TypeError(`Cannot create a second singleton (${this.name}) while creating a first (${creating})`);
      try {
        // biome-ignore lint/complexity/noThisInStatic: the class the method is called on, as in the host
        creating = this.name;
        // biome-ignore lint/complexity/noThisInStatic: the class the method is called on, as in the host
        singletons.set(this, new this(...args));
      } finally {
        creating = "";
      }
    }
    // biome-ignore lint/complexity/noThisInStatic: the class the method is called on, as in the host
    return singletons.get(this) as T;
  }

  static getInstance<T>(this: new (...args: never[]) => T, strict = true): T | undefined {
    // biome-ignore lint/complexity/noThisInStatic: the class the method is called on, as in the host
    if (!singletons.has(this) && strict) throw new TypeError(`instance of ${this.name} is not created`);
    // biome-ignore lint/complexity/noThisInStatic: the class the method is called on, as in the host
    return singletons.get(this) as T | undefined;
  }

  static resetInstance(): void {
    // biome-ignore lint/complexity/noThisInStatic: the class the method is called on, as in the host
    singletons.delete(this);
  }
}

// The way between the processes, as the tests see both: what the main process registered, what was broadcast,
// and the frame a request of the tests comes from. The host prefixes each channel with the digest of the
// identifier of the extension, the same in both of its processes (packages/core/src/extensions/ipc/
// ipc-registrar.ts line 20, ipc-main.ts line 73, ipc-renderer.ts line 41): the channels are kept here by the
// names the extension gives them, which is all the extension sees.
export const ipcHandlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
export const ipcBroadcasts: { channel: string; args: unknown[] }[] = [];
const mainListeners = new Map<string, Set<(event: unknown, ...args: unknown[]) => void>>();
const rendererListeners = new Map<string, Set<(event: unknown, ...args: unknown[]) => void>>();
export const ipcFrame = {
  current: { senderFrame: { url: "https://synthetic-cluster.renderer.freelens.app:1234/" }, processId: 1, frameId: 4 },
};

// How many listeners of the renderer hear a channel: the frames of the tests.
export function ipcListenerCount(channel: string): number {
  return rendererListeners.get(channel)?.size ?? 0;
}

export function resetIpc(): void {
  ipcHandlers.clear();
  ipcBroadcasts.length = 0;
  mainListeners.clear();
  rendererListeners.clear();
  singletons.clear();
  ipcFrame.current = {
    senderFrame: { url: "https://synthetic-cluster.renderer.freelens.app:1234/" },
    processId: 1,
    frameId: 4,
  };
}

// What crosses between the processes: what the host takes the observables out of (packages/core/src/common/ipc/
// ipc.ts lines 124 to 130), copied as Electron copies it, with the algorithm of structured clone.
function crossed<T>(value: T): T {
  return structuredClone(toJS(value));
}

function listenOn(
  listeners: Map<string, Set<(event: unknown, ...args: unknown[]) => void>>,
  channel: string,
  listener: (event: unknown, ...args: unknown[]) => void,
  extension: LensExtensionStub,
): () => void {
  const set = listeners.get(channel) ?? new Set();
  let listening = true;
  const cleanup = () => {
    if (!listening) return;
    listening = false;
    set.delete(listener);
  };

  set.add(listener);
  listeners.set(channel, set);
  extension[Disposers].push(cleanup);
  return cleanup;
}

// `IpcRegistrar` (packages/core/src/extensions/ipc/ipc-registrar.ts lines 15 to 31), a singleton of the extension
// it is made with, whose identifier its channels are told apart by. A broadcast (packages/core/src/common/ipc/
// ipc.ts lines 33 to 99) is heard by the listeners of the main process at once, with an event of no frame, and by
// the frames once the broadcast returned, as Electron sends it to them, each with a copy of what was sent.
class IpcRegistrarStub extends SingletonStub {
  constructor(protected readonly extension: LensExtensionStub) {
    super();
    createHash("sha256").update(extension.id);
  }

  broadcast(channel: string, ...args: unknown[]): void {
    ipcBroadcasts.push({ channel, args });
    for (const listener of mainListeners.get(channel) ?? [])
      listener({ processId: undefined, frameId: undefined, sender: undefined, senderFrame: undefined }, ...args);
    const sent = crossed(args);

    queueMicrotask(() => {
      for (const listener of rendererListeners.get(channel) ?? []) listener({}, ...sent);
    });
  }
}

// `Main.Ipc` (packages/core/src/extensions/ipc/ipc-main.ts lines 24 to 89): its reset, a listener and a handler are
// given back to the host with the extension. A handler is the one of Electron's `ipcMain.handle`, which refuses
// a second handler for a channel, and answers with what the host takes the observables out of
// (packages/core/src/common/ipc/ipc.ts lines 23 to 31).
class IpcMainStub extends IpcRegistrarStub {
  constructor(extension: LensExtensionStub) {
    super(extension);
    hostCalls.push("Ipc.constructor");
    extension[Disposers].push(() => (this.constructor as typeof IpcMainStub).resetInstance());
  }

  listen(channel: string, listener: (event: unknown, ...args: unknown[]) => unknown): () => void {
    return listenOn(mainListeners, channel, listener, this.extension);
  }

  handle(channel: string, handler: (event: unknown, ...args: unknown[]) => unknown): void {
    hostCalls.push(`Ipc.handle ${channel}`);
    if (ipcHandlers.has(channel)) throw new Error(`Attempted to register a second handler for '${channel}'`);
    ipcHandlers.set(channel, async (event, ...args) => toJS(await handler(event, ...args)));
    this.extension[Disposers].push(() => ipcHandlers.delete(channel));
  }
}

// `Renderer.Ipc` (packages/core/src/extensions/ipc/ipc-renderer.ts lines 16 to 74): its reset and a listener are
// given back to the host with the extension; a call reaches the handler of the main process after it returned,
// with the frame of the tests as its event and a copy of what it was given, and is answered with a copy of what
// the handler gave, or refused as Electron refuses a call whose handler threw, or that has no handler.
class IpcRendererStub extends IpcRegistrarStub {
  constructor(extension: LensExtensionStub) {
    super(extension);
    hostCalls.push("Ipc.constructor");
    extension[Disposers].push(() => (this.constructor as typeof IpcRendererStub).resetInstance());
  }

  listen(channel: string, listener: (event: unknown, ...args: unknown[]) => unknown): () => void {
    return listenOn(rendererListeners, channel, listener, this.extension);
  }

  async invoke(channel: string, ...args: unknown[]): Promise<unknown> {
    const sent = crossed(args);

    await null;
    const handler = ipcHandlers.get(channel);

    if (!handler)
      throw new Error(`Error invoking remote method '${channel}': Error: No handler registered for '${channel}'`);
    try {
      return crossed(await handler(ipcFrame.current, ...sent));
    } catch (error) {
      throw new Error(`Error invoking remote method '${channel}': ${error}`);
    }
  }
}

// `KubeCreationError` and `KubeObject` (packages/kube-object/src/kube-object.ts lines 33 to 149): an object of the
// host is made of data with metadata, a name and a link, every method bound to it; its identifier is its uid, or
// its link without one; it is in no namespace when its namespace is empty.
class KubeCreationError extends Error {
  constructor(
    message: string,
    readonly data: unknown,
  ) {
    super(message);
  }
}

interface Metadata {
  name: string;
  namespace?: string;
  uid?: string;
  resourceVersion?: string;
  selfLink: string;
  creationTimestamp?: string;
}

class KubeObjectStub {
  declare static readonly kind?: string;
  declare static readonly namespaced?: boolean;
  declare static readonly apiBase?: string;
  declare apiVersion: string;
  declare kind: string;
  declare metadata: Metadata;
  declare status?: unknown;
  declare spec: unknown;

  constructor(data: unknown) {
    const given = data as { metadata?: { name?: unknown; selfLink?: unknown } } | null;

    if (typeof given !== "object" || given === null)
      throw new TypeError(`Cannot create a KubeObject from ${typeof data}`);
    if (typeof given.metadata !== "object" || given.metadata === null)
      throw new KubeCreationError("Cannot create a KubeObject from an object without metadata", data);
    if (typeof given.metadata.name !== "string")
      throw new KubeCreationError(
        "Cannot create a KubeObject from an object without metadata.name being a string",
        data,
      );
    if (typeof given.metadata.selfLink !== "string")
      throw new KubeCreationError(
        "Cannot create a KubeObject from an object without metadata.selfLink being a string",
        data,
      );
    Object.assign(this, data);
    for (const name of ["getId", "getResourceVersion", "getScopedName", "getName", "getNs"] as const)
      Object.assign(this, { [name]: this[name].bind(this) });
  }

  get selfLink(): string {
    return this.metadata.selfLink;
  }

  getId(): string {
    return this.metadata.uid ?? this.metadata.selfLink;
  }

  getResourceVersion(): string {
    return this.metadata.resourceVersion ?? "";
  }

  getScopedName(): string {
    return [this.getNs(), this.getName()].filter(Boolean).join("/");
  }

  getName(): string {
    return this.metadata.name;
  }

  getNs(): string | undefined {
    return this.metadata.namespace || undefined;
  }
}

// `LensExtensionKubeObject` (packages/core/src/extensions/common-api/k8s-api.ts lines 274 to 329): the API and the
// store of a kind are the ones the host registered for one of its versions, which it has none of in the tests.
class LensExtensionKubeObjectStub extends KubeObjectStub {
  declare static readonly crd?: { apiVersions: string[] };

  static getApi(): never {
    // biome-ignore lint/complexity/noThisInStatic: the class the method is called on, as in the host
    if (!this.crd)
      // biome-ignore lint/complexity/noThisInStatic: the class the method is called on, as in the host
      throw new Error(`API for ${this.name} is not for CRD and misses metainfo. Extension won't work correctly.`);
    // biome-ignore lint/complexity/noThisInStatic: the class the method is called on, as in the host
    throw new Error(`API for ${this.name} is not registered. Extension won't work correctly.`);
  }

  static getStore(): never {
    // biome-ignore lint/complexity/noThisInStatic: the class the method is called on, as in the host
    return this.getApi();
  }
}

// An object of the host made from the data of the API as the API of the host makes it: with the link it gives an
// object the API server gave none (packages/utility-features/kube-api/src/kube-api.ts lines 617 to 627), from the
// base of its kind, its namespace and its name.
export function hostObject<Kind>(
  kind: (abstract new (...args: never[]) => Kind) & { apiBase?: string },
  data: object,
): Kind {
  const { metadata } = data as { metadata: { name: string; namespace?: string; selfLink?: string } };
  const [, prefix, plural] = /^(.*)\/([^/]+)$/.exec(kind.apiBase ?? "") ?? [];
  const selfLink =
    metadata.selfLink ??
    `${prefix}${metadata.namespace ? `/namespaces/${metadata.namespace}` : ""}/${plural}/${metadata.name}`;

  return Reflect.construct(kind, [{ ...data, metadata: { ...metadata, selfLink } }]) as Kind;
}

// A `KubeApi` an extension creates registers itself with the host (packages/core/src/extensions/common-api/
// k8s-api.ts lines 82 to 96), and a store of the host is made over one: each one created, and each registration
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

const apiManager = namespace("Renderer.K8sApi.apiManager", {
  registerApi: (): void => {
    hostCalls.push("apiManager.registerApi");
  },
  registerStore: (): void => {
    hostCalls.push("apiManager.registerStore");
  },
});

// What a registration helper of the host made each registration with, by the component it was given: the
// registration itself is copied by the boundary of the extension around that component.
export const registeredWith = new WeakMap<object, "detailsFor" | "menuItemFor">();

// The registration helpers of the host, as packages/core/src/extensions/renderer-api/kube-object-registrations.ts
// makes them at the validation target (lines 47 to 163): the kind of the class, the versions given or the ones of
// its definition, and the component with the options given. A class with neither is refused, as the host
// refuses a class with no kind or no versions; the version the host would read from the `apiBase` of a class
// without a definition is not taken here.
type Registered = { name: string; kind?: string; apiBase?: string; crd?: { apiVersions: readonly string[] } };

function kindAndVersions(helper: string, kubeObjectClass: Registered, apiVersions?: readonly string[]) {
  const described = `${helper}(${kubeObjectClass.name || "<anonymous class>"})`;

  if (!kubeObjectClass.kind) throw new Error(`${described}: the class has no static "kind"`);
  const resolved = apiVersions ?? kubeObjectClass.crd?.apiVersions;

  if (!resolved)
    throw new Error(
      `${described}: no "apiVersions" given, and the class has neither "crd.apiVersions" nor a parseable static "apiBase"`,
    );
  if (resolved.length === 0)
    throw new Error(`${described}: ${apiVersions ? '"apiVersions"' : '"crd.apiVersions"'} is empty`);
  return { kind: kubeObjectClass.kind, apiVersions: [...resolved] };
}

function detailsFor(
  kubeObjectClass: Registered,
  {
    Details,
    apiVersions,
    priority,
    visible,
  }: { Details: unknown; apiVersions?: string[]; priority?: number; visible?: unknown },
) {
  registeredWith.set(Details as object, "detailsFor");
  return {
    ...kindAndVersions("detailsFor", kubeObjectClass, apiVersions),
    components: { Details },
    ...(priority === undefined ? {} : { priority }),
    ...(visible === undefined ? {} : { visible }),
  };
}

function menuItemFor(
  kubeObjectClass: Registered,
  { MenuItem, apiVersions, visible }: { MenuItem: unknown; apiVersions?: string[]; visible?: unknown },
) {
  registeredWith.set(MenuItem as object, "menuItemFor");
  return {
    ...kindAndVersions("menuItemFor", kubeObjectClass, apiVersions),
    components: { MenuItem },
    ...(visible === undefined ? {} : { visible }),
  };
}

// What the host gives the renderer for the cluster of a frame, as a test sets it: the client of its proxy,
// `Renderer.K8sApi.KubeJsonApi.forCluster` (common-api/k8s-api.ts lines 153 to 170). Asked before a test sets it,
// it is what the scaffold must not reach.
export const hostViews: { forCluster?: (clusterId: string) => unknown } = {};

// The clusters the catalog of the host gives the renderer (packages/core/src/extensions/renderer-api/catalog.ts
// lines 62 to 128), as a test sets them: the cluster shown in the frame, and an entry of each by its identifier,
// with its fields (common-api/cluster-types.ts lines 57 to 67), of which a test gives the ones the views read.
export const rendererCatalog: {
  active?: { id: string; name: string };
  clusters: { id: string; name: string; kubeConfigPath?: string; contextName?: string; status?: string }[];
} = {
  active: { id: "synthetic-cluster", name: "synthetic-cluster" },
  clusters: [
    {
      id: "synthetic-cluster",
      name: "synthetic-cluster",
      kubeConfigPath: "/synthetic/kubeconfig",
      contextName: "synthetic",
      status: "connected",
    },
  ],
};

const stores = new Map<unknown, ExtensionStoreStub>();

// The stores that save into their file now, each with the store it is of: one for each load of a store that
// was not stopped since.
export const savingStores: { store: object }[] = [];
// What the stores wrote into their files, by the name of the file, and each write.
export const storeFiles = new Map<string, unknown>();
export const storeWrites: { configName: string; model: unknown }[] = [];

// The store of an extension (packages/core/src/extensions/base-extension-store.ts lines 33 to 129): one for each
// class, which outlives a disable, as the module of the extension does. Its load reads its file, the defaults with
// what was saved over them, through `fromStore`, then saves every change of `toJSON` into the file, until the
// next load or until the host takes it back with the extension (features/persistent-storage/common/
// create.injectable.ts lines 99 to 190). What the host sends between its processes is not modeled: the tests
// run both in one.
class ExtensionStoreStub<Model extends object = object> {
  private saving?: { store: object; stop(): void };

  static createInstance<S>(this: new (...args: unknown[]) => S, ...args: unknown[]): S {
    // biome-ignore lint/complexity/noThisInStatic: the class the method is called on, as in the host
    if (!stores.has(this)) stores.set(this, new this(...args) as ExtensionStoreStub);
    // biome-ignore lint/complexity/noThisInStatic: the class the method is called on, as in the host
    return stores.get(this) as S;
  }

  static getInstance<S>(this: new (...args: unknown[]) => S, strict = true): S | undefined {
    // biome-ignore lint/complexity/noThisInStatic: the class the method is called on, as in the host
    if (!stores.has(this) && strict) throw new TypeError(`instance of ${this.name} is not created`);
    // biome-ignore lint/complexity/noThisInStatic: the class the method is called on, as in the host
    return stores.get(this) as S | undefined;
  }

  static getInstanceOrCreate<S>(this: new (...args: unknown[]) => S, ...args: unknown[]): S {
    // biome-ignore lint/complexity/noThisInStatic: the class the method is called on, as in the host
    if (!stores.has(this)) stores.set(this, new this(...args) as ExtensionStoreStub);
    // biome-ignore lint/complexity/noThisInStatic: the class the method is called on, as in the host
    return stores.get(this) as S;
  }

  static resetInstance(): void {
    // biome-ignore lint/complexity/noThisInStatic: the class the method is called on, as in the host
    stores.delete(this);
  }

  constructor(protected readonly rawParams: { configName: string; defaults?: Model }) {}

  fromStore(_data: Partial<Model>): void {
    return;
  }

  toJSON(): Model {
    return {} as Model;
  }

  loadExtension(extension: LensExtensionStub): void {
    hostCalls.push("ExtensionStore.loadExtension");
    this.saving?.stop();
    const { configName, defaults } = this.rawParams;
    const name = configName
      .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
      .replace(/[_\s]+/g, "-")
      .toUpperCase();

    logger.info(`[${name}]: LOADING ...`);
    this.fromStore({ ...defaults, ...(storeFiles.get(configName) as Partial<Model> | undefined) } as Partial<Model>);
    logger.info(
      `[${name}]: LOADED from /synthetic/user-data/extension-store/${extension.storeName}/${configName}.json`,
    );
    const stopReaction = reaction(
      () => this.toJSON(),
      (model) => {
        storeFiles.set(configName, model);
        storeWrites.push({ configName, model });
      },
    );
    const saving = {
      store: this,
      stop: () => {
        stopReaction();
        const index = savingStores.indexOf(saving);

        if (index >= 0) savingStores.splice(index, 1);
      },
    };

    savingStores.push(saving);
    this.saving = saving;
    extension[Disposers].push(() => saving.stop());
  }
}

// The clusters the catalog of the host gives the main process (packages/core/src/extensions/main-api/catalog.ts
// lines 56 to 96), as a test sets them, each with its state: connecting, connected, disconnected or
// disconnecting (common-api/cluster-types.ts lines 13 to 18 and 57 to 67). Asked before a test sets them, the
// catalog is what the scaffold must not reach. A test that follows a change sets an observable list, as the
// catalog of the host is observable.
export const hostCatalog: {
  clusters?: { id: string; name: string; kubeConfigPath: string; contextName: string; status: string }[];
} = {};

// What the host gives the main process for a cluster beside its catalog, as a test sets it: the client of its
// proxy, `Main.K8sApi.KubeJsonApi.forCluster` (common-api/k8s-api.ts lines 153 to 170), and the kubectl and the
// environment of `Main.Shell` (main-api/shell.ts lines 54 to 84 and 118 to 152), which a test gives with the
// refusal the host gives for a cluster that is not there or not connected. Asked before a test sets them, they
// are what the scaffold must not reach.
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

// A client of the proxy of a cluster, `KubeJsonApi` with its `forCluster` (common-api/k8s-api.ts lines 153 to
// 170): the extension makes none of its own.
function kubeJsonApi(process: "Main" | "Renderer", forCluster: (clusterId: string) => unknown) {
  return Object.assign(
    function KubeJsonApi(): never {
      forbiddenAccesses.push(`${process}.K8sApi.KubeJsonApi`);
      throw new Error(`Unexpected scaffold access: ${process}.K8sApi.KubeJsonApi`);
    },
    { forCluster },
  );
}

export const Main = namespace("Main", {
  LensExtension: MainExtensionStub,
  K8s: blockedNamespace("Main.K8s"),
  K8sApi: namespace("Main.K8sApi", {
    KubeJsonApi: kubeJsonApi("Main", (clusterId: string) =>
      ofTheHost("forCluster", "Main.K8sApi.KubeJsonApi.forCluster")(clusterId),
    ),
  } satisfies Exported<typeof Sdk.Main.K8sApi>),
  Shell: namespace("Main.Shell", {
    getKubectlPath: (clusterId: string) => ofTheHost("kubectl", "Main.Shell.getKubectlPath")(clusterId),
    getEnvironment: (clusterId: string) => ofTheHost("environment", "Main.Shell.getEnvironment")(clusterId),
  } satisfies Exported<typeof Sdk.Main.Shell>),
  Catalog: namespace("Main.Catalog", {
    getAllClusters: () => catalogClusters("Main.Catalog.getAllClusters"),
    getClusterById: (clusterId: string) =>
      catalogClusters("Main.Catalog.getClusterById").find((cluster) => cluster.id === clusterId),
  } satisfies Exported<typeof Sdk.Main.Catalog>),
  Ipc: IpcMainStub,
} satisfies Exported<typeof Sdk.Main>);

export const Renderer = namespace("Renderer", {
  LensExtension: RendererExtensionStub,
  K8s: blockedNamespace("Renderer.K8s"),
  K8sApi: namespace("Renderer.K8sApi", {
    LensExtensionKubeObject: LensExtensionKubeObjectStub,
    KubeApi: KubeApiStub,
    KubeObjectStore: KubeObjectStoreStub,
    KubeJsonApi: kubeJsonApi("Renderer", (clusterId: string) => {
      if (!hostViews.forCluster) {
        forbiddenAccesses.push("Renderer.K8sApi.KubeJsonApi.forCluster");
        throw new Error("Unexpected scaffold access: Renderer.K8sApi.KubeJsonApi.forCluster");
      }
      return hostViews.forCluster(clusterId);
    }),
    apiManager,
    detailsFor,
    menuItemFor,
  } satisfies Exported<typeof Sdk.Renderer.K8sApi>),
  Component: namespace("Renderer.Component", hostComponents),
  // `createPageParam` and `navigate` of the host (packages/core/src/extensions/renderer-api/navigation.ts lines 55
  // and 57), on the address of `host-address.ts`.
  Navigation: namespace("Renderer.Navigation", { createPageParam, navigate } satisfies Exported<
    typeof Sdk.Renderer.Navigation
  >),
  Catalog: namespace("Renderer.Catalog", {
    // The cluster shown in the frame, as a computed value of the catalog: an entity, with its identifier and its
    // name, or nothing outside the frame of a cluster.
    activeCluster: {
      get: () =>
        rendererCatalog.active && {
          getId: () => rendererCatalog.active?.id,
          getName: () => rendererCatalog.active?.name,
        },
    },
    getClusterById: (clusterId: string) => rendererCatalog.clusters.find((cluster) => cluster.id === clusterId),
  } satisfies Exported<typeof Sdk.Renderer.Catalog>),
  Ipc: IpcRendererStub,
} satisfies Exported<typeof Sdk.Renderer>);

export const Common = namespace("Common", {
  logger,
  Store: namespace("Common.Store", { ExtensionStore: ExtensionStoreStub } satisfies Exported<typeof Sdk.Common.Store>),
} satisfies Exported<typeof Sdk.Common>);
