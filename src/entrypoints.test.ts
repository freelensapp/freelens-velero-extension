import { beforeEach, describe, expect, it } from "vitest";
import { forbiddenAccesses, type HostExtensionStub, Main, Renderer } from "../test/freelens-extensions";
import VeleroMain from "./main";
import VeleroRenderer from "./renderer";

const importAccesses = [...forbiddenAccesses];

beforeEach(() => {
  forbiddenAccesses.length = 0;
});

it("imports both entry points without contacting a cluster or registering IPC", () => {
  expect(importAccesses).toEqual([]);
});

describe.each([
  ["main", VeleroMain, Main.LensExtension],
  ["renderer", VeleroRenderer, Renderer.LensExtension],
] as const)("%s scaffold", (_name, Extension, HostExtension) => {
  it("extends the correct host process base class", () => {
    expect(Object.getPrototypeOf(Extension)).toBe(HostExtension);
  });

  it("activates and deactivates without cluster, catalog or IPC access", () => {
    const extension = Reflect.construct(Extension, []) as HostExtensionStub;

    extension.activate();
    extension.disable();

    expect(forbiddenAccesses).toEqual([]);
  });

  it("does not register unfinished pages or resource controls", () => {
    const extension = Reflect.construct(Extension, []) as HostExtensionStub;

    expect(extension.clusterPages).toEqual([]);
    expect(extension.clusterPageMenus).toEqual([]);
    expect(extension.kubeObjectDetailItems).toEqual([]);
    expect(extension.kubeObjectHandlers).toEqual([]);
  });
});
