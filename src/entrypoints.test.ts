import { beforeEach, describe, expect, it } from "vitest";
import { forbiddenAccesses, type HostExtensionStub, hostCalls, Main, Renderer } from "../test/freelens-extensions";
import VeleroMain from "./main";
import VeleroRenderer from "./renderer";
import { PAGES } from "./renderer/navigation";

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

describe("what the extension registers", () => {
  it("is nothing in the main process", () => {
    const extension = Reflect.construct(VeleroMain, []) as HostExtensionStub;

    expect(extension.clusterPages).toEqual([]);
    expect(extension.clusterPageMenus).toEqual([]);
    expect(extension.kubeObjectDetailItems).toEqual([]);
  });

  it("is the views that exist in the renderer, and no entry that leads to one that does not", () => {
    const extension = Reflect.construct(VeleroRenderer, []) as HostExtensionStub;
    const pages = (extension.clusterPages as { id: string }[]).map((page) => page.id);
    const menus = extension.clusterPageMenus as { id: string; parentId?: string; target: { pageId: string } }[];

    expect(pages).toEqual(["backups", "restores", "schedules"]);
    expect(menus.map((menu) => [menu.id, menu.parentId, menu.target.pageId])).toEqual([
      ["velero-backups", "velero", "backups"],
      ["velero-restores", "velero", "restores"],
      ["velero-schedules", "velero", "schedules"],
      ["velero", undefined, "backups"],
    ]);
    // The host takes the first entry that leads to a page to know whether the page is of a group, and
    // gives it the tabs of the group when it is: for every page that entry is one of the group.
    for (const page of pages) {
      expect([page, menus.find((menu) => menu.target.pageId === page)?.parentId]).toEqual([page, "velero"]);
    }
    // Every kind that has a view has the page of its list, which is where a link from outside opens it.
    expect(Object.values(PAGES).sort()).toEqual([...pages].sort());
    for (const menu of menus) expect(pages).toContain(menu.target.pageId);
    expect(
      (extension.kubeObjectDetailItems as { kind: string; apiVersions: string[] }[]).map((item) => [
        item.kind,
        item.apiVersions,
      ]),
    ).toEqual([
      ["Backup", ["velero.io/v1"]],
      ["Restore", ["velero.io/v1"]],
      ["Schedule", ["velero.io/v1"]],
    ]);
  });
});
