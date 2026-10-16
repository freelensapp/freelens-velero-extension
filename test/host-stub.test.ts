// The stub of the host itself (REQ-214, HOST-19): it has a double only of a name the SDK of v2 exports and refuses
// any other, as a component the host removed, and its doubles do what the host does where the tests rest on it.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  anExtension,
  Common,
  Disposers,
  forbiddenAccesses,
  hostLog,
  hostObject,
  ipcHandlers,
  loaded,
  Main,
  Renderer,
  resetIpc,
} from "./freelens-extensions";

// The declaration of the SDK of the validation target, whose namespaces list the names they export.
const declaration = readFileSync(resolve("node_modules/@freelensapp/extensions/dist/extension-api.d.ts"), "utf8");

// The names a namespace of the declaration exports, by its path from the root of the package, `Renderer.Component`
// for one: each step is read from the list of the namespace before it, which names the namespace of the next.
function exported(path: string): string[] {
  const names = (list: string) =>
    list
      .split(",")
      .map((entry) => entry.trim().split(/\s+as\s+/))
      .filter(([local]) => local)
      .map(([local, name]) => [name ?? local, local] as const);
  const listOf = (id: string) =>
    new RegExp(`declare namespace ${id.replace("$", "\\$")} \\{\\s*export \\{([^}]*)\\};`).exec(declaration)?.[1];
  let list = /^export \{([^}]*)\};$/m.exec(declaration)?.[1] ?? "";

  for (const step of path.split(".")) {
    const local = names(list).find(([name]) => name === step)?.[1];
    const next = local === undefined ? undefined : listOf(local);

    if (next === undefined) throw new Error(`The declaration has no namespace ${path}`);
    list = next;
  }
  return names(list).map(([name]) => name);
}

const NAMESPACES = {
  Common,
  "Common.Store": Common.Store,
  Main,
  "Main.K8sApi": Main.K8sApi,
  "Main.Shell": Main.Shell,
  "Main.Catalog": Main.Catalog,
  Renderer,
  "Renderer.Component": Renderer.Component,
  "Renderer.K8sApi": Renderer.K8sApi,
  "Renderer.Navigation": Renderer.Navigation,
  "Renderer.Catalog": Renderer.Catalog,
};

beforeEach(() => {
  forbiddenAccesses.length = 0;
  hostLog.length = 0;
});

afterEach(() => {
  resetIpc();
});

describe("the names the stub gives", () => {
  it("are names the SDK of v2 exports, in every namespace", () => {
    for (const [path, members] of Object.entries(NAMESPACES)) {
      const known = exported(path);

      expect([path, Object.keys(members).filter((name) => !known.includes(name))]).toEqual([path, []]);
    }
    // The ones the extension reads, at least.
    expect(Object.keys(Renderer.Component).length).toBe(18);
  });

  it("refuse a component the host removed, the virtual list of v1, and record it", () => {
    expect(exported("Renderer.Component")).not.toContain("VirtualList");
    expect(() => Reflect.get(Renderer.Component, "VirtualList")).toThrow(
      "Renderer.Component.VirtualList has no double in the stub of the host",
    );
    expect(forbiddenAccesses).toEqual(["Renderer.Component.VirtualList"]);
  });

  it("refuse a name of the SDK the stub has no double for, in any namespace, as any other name", () => {
    expect(exported("Renderer")).toContain("Theme");
    for (const [namespace, name] of [
      [Renderer, "Theme"],
      [Renderer.Component, "Badge"],
      [Renderer.K8sApi, "podsStore"],
      [Main, "Power"],
      [Common, "EventBus"],
    ] as const)
      expect(() => Reflect.get(namespace, name)).toThrow("has no double in the stub of the host");
    expect(forbiddenAccesses).toEqual([
      "Renderer.Theme",
      "Renderer.Component.Badge",
      "Renderer.K8sApi.podsStore",
      "Main.Power",
      "Common.EventBus",
    ]);
  });
});

describe("the doubles of the host", () => {
  it("disable only an extension that is enabled, after its onDeactivate, giving back what it was given in order, once", async () => {
    const said: string[] = [];
    const extension = new (class extends Renderer.LensExtension {
      protected onDeactivate(): void {
        said.push("onDeactivate");
      }
    })();

    extension[Disposers].push(
      () => said.push("first"),
      () => said.push("second"),
    );
    await extension.disable();
    expect(said).toEqual([]);
    await loaded(extension);
    await extension.disable();
    await extension.disable();
    expect(said).toEqual(["onDeactivate", "first", "second"]);
    expect(extension.name).toBe(JSON.parse(readFileSync(resolve("package.json"), "utf8")).name);
  });

  it("log what a deactivation throws instead of throwing it", async () => {
    const extension = await loaded(
      new (class extends Main.LensExtension {
        protected onDeactivate(): void {
          throw new Error("a deactivation that throws");
        }
      })(),
    );

    await extension.disable();
    expect(hostLog.filter((entry) => entry.level === "error").map((entry) => entry.message)).toEqual([
      `[EXTENSION]: disabling ${extension.name}@${extension.version} threw an error: Error: a deactivation that throws`,
    ]);
  });

  it("make the way between the processes once for each class, with an extension, and refuse a second handler for a channel", () => {
    const extension = anExtension("main");
    const ipc = Main.Ipc.createInstance(extension);

    expect(Main.Ipc.createInstance(anExtension("main"))).toBe(ipc);
    expect(() => new Main.Ipc(extension)).toThrow("A singleton class must be created by createInstance()");
    expect(() => Renderer.Ipc.createInstance({} as never)).toThrow();
    ipc.handle("channel", () => "answer");
    expect(() => ipc.handle("channel", () => "another")).toThrow(
      "Attempted to register a second handler for 'channel'",
    );
    extension[Disposers]();
    expect([ipcHandlers.size, Main.Ipc.getInstance(false)]).toEqual([0, undefined]);
  });

  it("answer a call with a copy, after it returned, and refuse one whose handler threw as Electron does", async () => {
    const main = Main.Ipc.createInstance(anExtension("main"));
    const renderer = Renderer.Ipc.createInstance(anExtension("renderer"));
    const given = { words: ["one"] };
    let heard: unknown;

    main.handle("echo", (_event: unknown, value: unknown) => {
      heard = value;
      return given;
    });
    main.handle("throws", () => {
      throw new Error("a handler that throws");
    });
    const answer = renderer.invoke("echo", given);

    expect(heard).toBeUndefined();
    expect(await answer).toEqual(given);
    expect([heard === given, (await renderer.invoke("echo", given)) === given]).toEqual([false, false]);
    await expect(renderer.invoke("throws")).rejects.toThrow(
      "Error invoking remote method 'throws': Error: a handler that throws",
    );
    await expect(renderer.invoke("none")).rejects.toThrow("Error invoking remote method 'none'");
  });

  it("make an object of the host only of data with a name and a link, its identifier its uid or its link", () => {
    const { LensExtensionKubeObject } = Renderer.K8sApi;

    class Kind extends LensExtensionKubeObject {
      static readonly kind = "Kind";
      static readonly apiBase = "/apis/example.invalid/v1/kinds";
    }

    expect(() => new Kind({ metadata: { name: "one" } })).toThrow("without metadata.selfLink being a string");
    expect(() => new Kind({ metadata: { selfLink: "/one" } })).toThrow("without metadata.name being a string");
    const object = hostObject(Kind, { metadata: { name: "one", namespace: "" } }) as InstanceType<typeof Kind>;

    expect([object.selfLink, object.getId(), object.getNs()]).toEqual([
      "/apis/example.invalid/v1/kinds/one",
      "/apis/example.invalid/v1/kinds/one",
      undefined,
    ]);
    expect(() => Kind.getStore()).toThrow(
      "API for Kind is not for CRD and misses metainfo. Extension won't work correctly.",
    );
  });
});
