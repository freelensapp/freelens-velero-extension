import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import {
  forbiddenAccesses,
  type HostExtensionStub,
  hostCalls,
  hostCatalog,
  ipcHandlers,
  ipcListenerCount,
  Main,
  Renderer,
  registeredWith,
  resetIpc,
  savingStores,
} from "../test/freelens-extensions";
import { CHANNELS } from "./common/ipc";
import VeleroMain from "./main";
import { KubectlTunnels } from "./main/diagnostic-tunnel";
import { catalogEntries } from "./main/host";
import { VeleroIpc } from "./main/ipc";
import VeleroRenderer from "./renderer";
import { VeleroIpcRenderer } from "./renderer/api/ipc";
import { Backup, BackupStorageLocation, Restore, Schedule, VolumeSnapshotLocation } from "./renderer/api/kinds";
import { BackupDetails } from "./renderer/details/backup-details";
import { RestoreDetails } from "./renderer/details/restore-details";
import { ScheduleDetails } from "./renderer/details/schedule-details";
import { SnapshotLocationDetails } from "./renderer/details/snapshot-location-details";
import { StorageLocationDetails } from "./renderer/details/storage-location-details";
import { PAGES } from "./renderer/navigation";
import { BackupsPage } from "./renderer/pages/backups-page";
import { OverviewPage } from "./renderer/pages/overview-page";
import { RestoresPage } from "./renderer/pages/restores-page";
import { SchedulesPage } from "./renderer/pages/schedules-page";
import { SnapshotLocationsPage } from "./renderer/pages/snapshot-locations-page";
import { StorageLocationsPage } from "./renderer/pages/storage-locations-page";
import { currentInstallation } from "./renderer/state/context";

import type React from "react";

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

// What the activation asks of the host: the store of the preferences in both processes, which the host
// writes from the main one; the way between the processes in both; and in the main process the
// procedures of the gate, registered and not called. Nothing of a cluster, and nothing of the catalog.
export const ACTIVATION_CALLS = {
  main: [
    "ExtensionStore.loadExtension",
    "Ipc.constructor",
    "Ipc.handle gate.state",
    "Ipc.handle gate.enable",
    "Ipc.handle gate.disable",
    "Ipc.handle write.confirm",
    "Ipc.handle write.status",
    "Ipc.handle write.cancel",
    "Ipc.handle write.run",
    "Ipc.handle artifact.page",
    "Ipc.handle artifact.release",
    "Ipc.handle artifact.save",
    "Ipc.handle allowance.grant",
    "Ipc.handle allowance.revoke",
  ],
  renderer: ["ExtensionStore.loadExtension", "Ipc.constructor"],
} as const;

describe.each([
  ["main", VeleroMain, Main.LensExtension],
  ["renderer", VeleroRenderer, Renderer.LensExtension],
] as const)("%s entry point", (name, Extension, HostExtension) => {
  it("extends the correct host process base class", () => {
    expect(Object.getPrototypeOf(Extension)).toBe(HostExtension);
  });

  it("activates and deactivates without cluster or catalog access, and asks nothing through the IPC", () => {
    const extension = Reflect.construct(Extension, []) as HostExtensionStub;

    extension.activate();
    extension.disable();

    expect(forbiddenAccesses).toEqual([]);
    // Neither an API nor a request: the activation asks nothing of a cluster, and calls no procedure.
    expect(hostCalls.filter((call) => !call.startsWith("ExtensionStore.") && !call.startsWith("Ipc."))).toEqual([]);
    expect(hostCalls).toEqual(ACTIVATION_CALLS[name]);
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

    expect(pages).toEqual(["overview", "backups", "restores", "schedules", "storage-locations", "snapshot-locations"]);
    // The Overview is the first entry under Velero, and the page the entry of Velero names: the host
    // opens a group from its entry, and marks the entry when the page it names is shown.
    expect(menus.map((menu) => [menu.id, menu.parentId, menu.target.pageId])).toEqual([
      ["velero-overview", "velero", "overview"],
      ["velero-backups", "velero", "backups"],
      ["velero-restores", "velero", "restores"],
      ["velero-schedules", "velero", "schedules"],
      ["velero-storage-locations", "velero", "storage-locations"],
      ["velero-snapshot-locations", "velero", "snapshot-locations"],
      ["velero", undefined, "overview"],
    ]);
    // The host takes the first entry that leads to a page to know whether the page is of a group, and
    // gives it the tabs of the group when it is: for every page that entry is one of the group.
    for (const page of pages) {
      expect([page, menus.find((menu) => menu.target.pageId === page)?.parentId]).toEqual([page, "velero"]);
    }
    // Every kind that has a view has the page of its list, which is where a link from outside opens it.
    expect([...Object.values(PAGES), "overview"].sort()).toEqual([...pages].sort());
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
      ["BackupStorageLocation", ["velero.io/v1"]],
      ["VolumeSnapshotLocation", ["velero.io/v1"]],
    ]);
  });

  it("is each kind of Velero as one class of the host, with its metadata on the class and the literals of its objects", () => {
    for (const [Kind, kind, plural, singular, shortNames, title] of KINDS) {
      expect(Object.getPrototypeOf(Kind)).toBe(Renderer.K8sApi.LensExtensionKubeObject);
      expect([kind, Kind.kind, Kind.namespaced, Kind.apiBase, Kind.crd]).toEqual([
        kind,
        kind,
        true,
        `/apis/velero.io/v1/${plural}`,
        { apiVersions: ["velero.io/v1"], plural, singular, shortNames, title },
      ]);
      // No method of an instance: the objects the host hands over are its own, without one.
      expect([kind, Object.getOwnPropertyNames(Kind.prototype)]).toEqual([kind, ["constructor"]]);
      // The literals of an object are declared and not defined: an object made by the constructor of the host
      // keeps the kind and the version of its data.
      const object = Reflect.construct(Kind, [
        { apiVersion: "velero.io/v1", kind, metadata: { name: "one", namespace: "velero", uid: "uid" } },
      ]) as { kind?: string; apiVersion?: string };

      expect([kind, object.kind, object.apiVersion]).toEqual([kind, kind, "velero.io/v1"]);
    }
    expectTypeOf<Backup["kind"]>().toEqualTypeOf<"Backup">();
    expectTypeOf<Restore["kind"]>().toEqualTypeOf<"Restore">();
    expectTypeOf<Schedule["kind"]>().toEqualTypeOf<"Schedule">();
    expectTypeOf<BackupStorageLocation["kind"]>().toEqualTypeOf<"BackupStorageLocation">();
    expectTypeOf<VolumeSnapshotLocation["kind"]>().toEqualTypeOf<"VolumeSnapshotLocation">();
    for (const version of [
      expectTypeOf<Backup["apiVersion"]>(),
      expectTypeOf<Restore["apiVersion"]>(),
      expectTypeOf<Schedule["apiVersion"]>(),
      expectTypeOf<BackupStorageLocation["apiVersion"]>(),
      expectTypeOf<VolumeSnapshotLocation["apiVersion"]>(),
    ])
      version.toEqualTypeOf<"velero.io/v1">();
  });

  it("is no API and no store of its own for a kind: the module of the kinds is the five classes", async () => {
    const kinds = await import("./renderer/api/kinds");

    expect(Object.keys(kinds).sort()).toEqual(
      ["Backup", "BackupStorageLocation", "Restore", "Schedule", "VolumeSnapshotLocation"].sort(),
    );
    for (const value of Object.values(kinds)) {
      expect(Object.getPrototypeOf(value)).toBe(Renderer.K8sApi.LensExtensionKubeObject);
      expect(value.prototype).not.toBeInstanceOf(Renderer.K8sApi.KubeApi);
      expect(value.prototype).not.toBeInstanceOf(Renderer.K8sApi.KubeObjectStore);
    }
  });

  it("is the five kinds as the custom resources the Custom Resources tree leaves out, and nothing else", () => {
    const extension = Reflect.construct(VeleroRenderer, []) as HostExtensionStub & { customResources: unknown[] };

    expect(extension.customResources).toHaveLength(KINDS.length);
    KINDS.forEach(([Kind], index) => {
      expect(extension.customResources[index]).toBe(Kind);
    });
  });

  it("is the five sections of the details, each made with detailsFor for its kind, rendered with the object alone", () => {
    const extension = Reflect.construct(VeleroRenderer, []) as HostExtensionStub;
    const items = extension.kubeObjectDetailItems as {
      kind: string;
      apiVersions: string[];
      priority?: number;
      components: { Details: (props: { object: unknown }) => React.ReactElement<Record<string, unknown>> };
    }[];

    expect(items.map((item) => registeredWith.get(item))).toEqual(Array(KINDS.length).fill("detailsFor"));
    expect(items.map((item) => [item.kind, item.apiVersions, item.priority])).toEqual(
      KINDS.map(([, kind]) => [kind, ["velero.io/v1"], 10]),
    );
    const object = { metadata: { name: "one", namespace: "velero" } };

    items.forEach((item, index) => {
      const element = item.components.Details({ object });

      // The host gives the object, and the registration gives the extension.
      expect([item.kind, element.type, element.props]).toEqual([item.kind, SECTIONS[index], { object, extension }]);
    });
  });

  it("is the pages taking the parameters the host gives alone, the extension given by the registration where a page needs it", () => {
    const extension = Reflect.construct(VeleroRenderer, []) as HostExtensionStub;
    const pages = extension.clusterPages as {
      id: string;
      components: { Page: (props: { params: object }) => React.ReactElement<Record<string, unknown>> };
    }[];

    expect(
      pages.map((page) => {
        const element = page.components.Page({ params: {} });

        return [page.id, element.type, element.props];
      }),
    ).toEqual([
      ["overview", OverviewPage, { extension }],
      ["backups", BackupsPage, {}],
      ["restores", RestoresPage, {}],
      ["schedules", SchedulesPage, {}],
      ["storage-locations", StorageLocationsPage, {}],
      ["snapshot-locations", SnapshotLocationsPage, {}],
    ]);
  });
});

// The five kinds of Velero, with their kind, plural, singular, short names and title.
const KINDS = [
  [Backup, "Backup", "backups", "backup", [], "Backups"],
  [Restore, "Restore", "restores", "restore", [], "Restores"],
  [Schedule, "Schedule", "schedules", "schedule", [], "Schedules"],
  [
    BackupStorageLocation,
    "BackupStorageLocation",
    "backupstoragelocations",
    "backupstoragelocation",
    ["bsl"],
    "Backup Storage Locations",
  ],
  [
    VolumeSnapshotLocation,
    "VolumeSnapshotLocation",
    "volumesnapshotlocations",
    "volumesnapshotlocation",
    ["vsl"],
    "Volume Snapshot Locations",
  ],
] as const;

// The sections of the details, in the order of the kinds.
const SECTIONS = [BackupDetails, RestoreDetails, ScheduleDetails, StorageLocationDetails, SnapshotLocationDetails];

// The channels the main process handles: every one of the contract but the broadcast of the gate.
const HANDLED = Object.values(CHANNELS)
  .filter((channel) => channel !== CHANNELS.gateChanged)
  .sort();
const CLUSTER = "synthetic-cluster";

// A disable and an enable of the extension in one session, as the host makes them: the module stays, a new
// instance of the extension is activated, and what the host gave the instance before was taken back by its
// disposers after its onDeactivate (packages/core/src/extensions/lens-extension.ts lines 95 to 110 and
// extension-loader/extension-loader.ts lines 547 to 600 at the validation target).
describe("activated, deactivated and activated again", () => {
  beforeEach(() => {
    resetIpc();
    savingStores.length = 0;
    hostCatalog.clusters = [
      {
        id: CLUSTER,
        name: "synthetic",
        kubeConfigPath: "/synthetic/kubeconfig",
        contextName: "kind-synthetic",
        status: "connected",
      },
    ];
  });

  afterEach(() => {
    hostCatalog.clusters = undefined;
    resetIpc();
    vi.restoreAllMocks();
  });

  it("leaves in the main process one handler for each channel, one store that saves, and no kubectl, confirmation or write of before", async () => {
    const closing = vi.spyOn(KubectlTunnels.prototype, "closeAll");
    const first = Reflect.construct(VeleroMain, []) as HostExtensionStub;

    first.activate();
    // The frame of the tests, which reaches the handlers the main process registered.
    const frame = VeleroIpcRenderer.createInstance({} as never);
    const made = VeleroIpc.getInstance();

    expect(await frame.enable(CLUSTER, "velero", { context: "kind-synthetic", namespace: "velero" })).toMatchObject({
      ok: true,
      value: { writes: { on: true } },
    });
    const confirmed = await frame.confirm(CLUSTER, "velero", "ServerStatusRequest");

    expect(confirmed.ok).toBe(true);
    // The host runs the disposers after onDeactivate: what this one, put first, sees is what onDeactivate left.
    const left: unknown[] = [];

    first.disposers.unshift(() => left.push(VeleroIpc.getInstance(false)));
    first.disable();
    expect(left).toEqual([undefined]);
    // Every kubectl of the procedures was let go with them, the host took the handlers out, and the store
    // stopped saving.
    expect(closing).toHaveBeenCalledTimes(1);
    expect(ipcHandlers.size).toBe(0);
    expect(savingStores).toEqual([]);

    // The host refuses a second handler for a channel: an activation that registered one twice would throw.
    const second = Reflect.construct(VeleroMain, []) as HostExtensionStub;

    second.activate();
    expect(VeleroIpc.getInstance()).not.toBe(made);
    expect([...ipcHandlers.keys()].sort()).toEqual(HANDLED);
    expect(savingStores).toHaveLength(1);
    // Nothing of before: writes are off, and the confirmation given before runs nothing.
    expect(await frame.state(CLUSTER)).toMatchObject({ ok: true, value: { writes: { on: false } } });
    if (confirmed.ok)
      expect(await frame.runServerStatus(CLUSTER, "velero", confirmed.value.token, randomUUID())).toMatchObject({
        ok: false,
        code: "forbidden",
        stage: "gate",
      });
    second.disable();
    expect(closing).toHaveBeenCalledTimes(2);
    expect(ipcHandlers.size).toBe(0);
  });

  it("leaves in the renderer one listener of the changes of the gate, one store that saves, and views that start from nothing", async () => {
    // The procedures of the main process, as an activation of the main process registers them.
    const main = VeleroIpc.createInstance({} as never);

    main.register(catalogEntries);
    const first = Reflect.construct(VeleroRenderer, []) as HostExtensionStub;

    first.activate();
    // The first view of the frame opens.
    const before = currentInstallation();

    await before.openGate();
    expect(before.gate?.writes).toEqual({ on: false });
    expect(ipcListenerCount(CHANNELS.gateChanged)).toBe(1);
    const left: unknown[] = [];

    first.disposers.unshift(() => left.push(VeleroIpcRenderer.getInstance(false)));
    first.disable();
    expect(left).toEqual([undefined]);
    expect(ipcListenerCount(CHANNELS.gateChanged)).toBe(0);
    expect(savingStores).toEqual([]);

    const second = Reflect.construct(VeleroRenderer, []) as HostExtensionStub;

    second.activate();
    expect(savingStores).toHaveLength(1);
    // The first view after the enable makes the state of the views again, which knows nothing of before and
    // hears the main process through the way of this activation, once.
    const after = currentInstallation();

    expect(after).not.toBe(before);
    expect(after.gate).toBeUndefined();
    expect(ipcListenerCount(CHANNELS.gateChanged)).toBe(1);
    const asking = vi.spyOn(after, "openGate").mockResolvedValue(undefined);

    main.broadcast(CHANNELS.gateChanged, { cluster: CLUSTER });
    expect(asking).toHaveBeenCalledTimes(1);
    second.disable();
    expect(ipcListenerCount(CHANNELS.gateChanged)).toBe(0);
    main.release();
  });
});
