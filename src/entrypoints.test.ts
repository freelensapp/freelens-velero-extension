import { beforeEach, describe, expect, it } from "vitest";
import { forbiddenAccesses, type HostExtensionStub, hostCalls, Main, Renderer } from "../test/freelens-extensions";
import VeleroMain from "./main";
import VeleroRenderer from "./renderer";

const importAccesses = [...forbiddenAccesses];
const importCalls = [...hostCalls];

beforeEach(() => {
  forbiddenAccesses.length = 0;
  hostCalls.length = 0;
});

it("imports both entry points without contacting a cluster or registering IPC", () => {
  expect(importAccesses).toEqual([]);
  expect(importCalls).toEqual([]);
});

describe.each([
  ["main", VeleroMain, Main.LensExtension],
  ["renderer", VeleroRenderer, Renderer.LensExtension],
] as const)("%s entry point", (_name, Extension, HostExtension) => {
  it("extends the correct host process base class", () => {
    expect(Object.getPrototypeOf(Extension)).toBe(HostExtension);
  });

  it("activates and deactivates without cluster, catalog or IPC access", () => {
    const extension = Reflect.construct(Extension, []) as HostExtensionStub;

    extension.activate();
    extension.disable();

    expect(forbiddenAccesses).toEqual([]);
    // Neither an API nor a request: the activation asks nothing of a cluster.
    expect(hostCalls.filter((call) => !call.startsWith("ExtensionStore."))).toEqual([]);
    // The store of the preferences is opened in both processes: the host writes it from the main one.
    expect(hostCalls).toEqual(["ExtensionStore.loadExtension"]);
  });

  it("adds no control to the objects of the cluster", () => {
    const extension = Reflect.construct(Extension, []) as HostExtensionStub;

    expect(extension.kubeObjectMenuItems).toEqual([]);
    expect(extension.kubeObjectHandlers).toEqual([]);
  });
});

describe.each([
  ["main", VeleroMain],
  ["renderer", VeleroRenderer],
] as const)("what the extension registers in the %s process", (_name, Extension) => {
  it("is nothing: no page, no entry of the sidebar, no section of the details", () => {
    const extension = Reflect.construct(Extension, []) as HostExtensionStub;

    expect(extension.clusterPages).toEqual([]);
    expect(extension.clusterPageMenus).toEqual([]);
    expect(extension.kubeObjectDetailItems).toEqual([]);
  });
});
