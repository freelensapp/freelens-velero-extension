// @vitest-environment jsdom

import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { addressSearch, Renderer as Host } from "../../../test/freelens-extensions";
import { emptyPreferences, heldPreferences, RESOURCES } from "../../common/discovery";
import { Backup, BackupStorageLocation, Restore, Schedule, VolumeSnapshotLocation } from "../api/kinds";
import { BackupDetails } from "../details/backup-details";
import { RestoreDetails } from "../details/restore-details";
import { ScheduleDetails } from "../details/schedule-details";
import { SnapshotLocationDetails } from "../details/snapshot-location-details";
import { StorageLocationDetails } from "../details/storage-location-details";
import { closeViews, openView } from "../navigation";
import { BackupsPage } from "../pages/backups-page";
import { OverviewPage } from "../pages/overview-page";
import { RestoresPage } from "../pages/restores-page";
import { SchedulesPage } from "../pages/schedules-page";
import { SnapshotLocationsPage } from "../pages/snapshot-locations-page";
import { StorageLocationsPage } from "../pages/storage-locations-page";
import { Installation } from "../state/installation";
import { ArtifactLines } from "./artifact-lines";
import { LogViewer } from "./log-viewer";
import { ResourcesViewer } from "./resources-viewer";
import { ResultsViewer } from "./results-viewer";
import { VolumesViewer } from "./volumes-viewer";

import type { Renderer } from "@freelensapp/extensions";

import type { ReactNode } from "react";

import type { Answer, Family } from "../../common/discovery";
import type { ViewKind } from "../../common/views";

// The rules of the views are in the one stylesheet of the extension, which the build writes next to the
// renderer entry and the host links: no view carries a style element of its own, which would apply every
// rule a second time, and in a place the host does not take it out of when the extension is disabled.

const A = "velero";
const NOW = Date.parse("2026-10-05T09:30:00Z");
const extension = { name: "@freelensapp/velero-extension" } as unknown as Renderer.LensExtension;

function object(kind: string, name: string, spec: object, status: object) {
  return {
    apiVersion: "velero.io/v1",
    kind,
    metadata: {
      name,
      namespace: A,
      uid: `${kind}-${name}`,
      resourceVersion: "1",
      creationTimestamp: "2026-10-01T10:00:00Z",
    },
    spec,
    status,
  };
}

// One object of each kind, in the one installation of the cluster.
const OBJECTS: Record<Family, ReturnType<typeof object>> = {
  backups: object("Backup", "nightly", { storageLocation: "default" }, { phase: "Completed" }),
  restores: object("Restore", "monday", { backupName: "nightly" }, { phase: "Completed" }),
  schedules: object("Schedule", "daily", { schedule: "0 1 * * *", template: {} }, { phase: "Enabled" }),
  storageLocations: object(
    "BackupStorageLocation",
    "default",
    { provider: "aws", objectStorage: { bucket: "backups" } },
    { phase: "Available" },
  ),
  snapshotLocations: object("VolumeSnapshotLocation", "snapshots", { provider: "aws" }, {}),
};

function installation(): Installation {
  const answers: Record<string, Answer> = {
    "/apis/velero.io/v1": { status: 200, body: { resources: Object.values(RESOURCES).map((name) => ({ name })) } },
    "/apis/velero.io/v1/backupstoragelocations": { status: 200, body: { items: [OBJECTS.storageLocations] } },
    ...Object.fromEntries(
      (Object.keys(RESOURCES) as Family[]).map((family) => [
        `/apis/velero.io/v1/namespaces/${A}/${RESOURCES[family]}`,
        { status: 200, body: { items: [OBJECTS[family]] } },
      ]),
    ),
  };

  return new Installation({
    cluster: { id: "cluster-a", name: "local-demo" },
    read: async (address) => answers[address] ?? { status: 404 },
    now: () => NOW,
    storage: heldPreferences({ ...emptyPreferences(), selected: { "cluster-a": A } }),
  });
}

// What carries rules in the document: the style elements in it, and the style sheets it has.
const carried = () => ({
  elements: document.querySelectorAll("style").length,
  sheets: document.styleSheets.length,
});

afterEach(() => {
  act(() => closeViews());
  if (addressSearch()) act(() => Host.Navigation.navigate({ search: "" }));
  cleanup();
});

describe("the rules of the views", () => {
  it("are carried by no page and by no view opened over it", async () => {
    const pages: [string, (installation: Installation) => ReactNode, ViewKind | undefined, string][] = [
      ["overview", (installation) => <OverviewPage extension={extension} installation={installation} />, undefined, ""],
      ["backups", (installation) => <BackupsPage installation={installation} />, "backup", "nightly"],
      ["restores", (installation) => <RestoresPage installation={installation} />, "restore", "monday"],
      ["schedules", (installation) => <SchedulesPage installation={installation} />, "schedule", "daily"],
      [
        "storage-locations",
        (installation) => <StorageLocationsPage installation={installation} />,
        "storage-location",
        "default",
      ],
      [
        "snapshot-locations",
        (installation) => <SnapshotLocationsPage installation={installation} />,
        "snapshot-location",
        "snapshots",
      ],
    ];

    for (const [id, page, kind, name] of pages) {
      render(page(installation()));
      await screen.findByTestId(`velero-${id}-page`);
      expect([id, carried()]).toEqual([id, { elements: 0, sheets: 0 }]);
      if (kind) {
        act(() => openView({ kind, name }));
        await screen.findByTestId(`velero-${kind}-workspace`);
        expect([kind, carried()]).toEqual([kind, { elements: 0, sheets: 0 }]);
        act(() => closeViews());
      }
      cleanup();
    }
  });

  it("are carried by no viewer of an artifact and by no section of the details", () => {
    const shown = installation();

    render(
      <>
        <LogViewer id="log" text={'time="2026-10-04T18:08:23Z" level=info msg="one"'} of="Backup" />
        <ResultsViewer id="results" text='{"errors":{},"warnings":{}}' of="Backup" />
        <ResourcesViewer id="resources" text='{"v1/Pod":["shop/cart"]}' of="Restore" />
        <VolumesViewer id="volumes" text="[]" of="Backup" />
        <ArtifactLines id="lines" text={"one\ntwo"} note="As the text it is." />
        <BackupDetails object={new Backup(OBJECTS.backups as never)} extension={extension} installation={shown} />
        <RestoreDetails object={new Restore(OBJECTS.restores as never)} extension={extension} installation={shown} />
        <ScheduleDetails object={new Schedule(OBJECTS.schedules as never)} extension={extension} installation={shown} />
        <StorageLocationDetails
          object={new BackupStorageLocation(OBJECTS.storageLocations as never)}
          extension={extension}
          installation={shown}
        />
        <SnapshotLocationDetails
          object={new VolumeSnapshotLocation(OBJECTS.snapshotLocations as never)}
          extension={extension}
          installation={shown}
        />
      </>,
    );
    for (const id of ["log", "results", "resources", "volumes", "lines"]) expect(screen.getByTestId(id)).toBeTruthy();
    expect(document.querySelectorAll(".DrawerItem").length).toBeGreaterThan(0);
    expect(carried()).toEqual({ elements: 0, sheets: 0 });
  });
});
