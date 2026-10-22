// @vitest-environment jsdom

// Every page and every section of the details the renderer registers, as the host draws it, with a page and a
// section that throw in place of the real ones (REQ-211, HOST-16 at the unit layer): the error page in the
// place of the part, the rest of the view of the cluster there, the log of the host with the name of the
// extension, and a section drawn again for another object. The registrations are the ones the extension gives
// the host, read from an instance of it; only the components they draw are replaced.

import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hostLog } from "../../test/freelens-extensions";
import VeleroRenderer from "./index";

import type { Renderer } from "@freelensapp/extensions";

vi.mock(import("./pages/overview-page"), async (original) => ({
  ...(await original()),
  OverviewPage: () => {
    throw new Error("the page of the overview");
  },
}));
vi.mock(import("./pages/backups-page"), async (original) => ({
  ...(await original()),
  BackupsPage: () => {
    throw new Error("the page of the backups");
  },
}));
vi.mock(import("./pages/restores-page"), async (original) => ({
  ...(await original()),
  RestoresPage: () => {
    throw new Error("the page of the restores");
  },
}));
vi.mock(import("./pages/schedules-page"), async (original) => ({
  ...(await original()),
  SchedulesPage: () => {
    throw new Error("the page of the schedules");
  },
}));
vi.mock(import("./pages/storage-locations-page"), async (original) => ({
  ...(await original()),
  StorageLocationsPage: () => {
    throw new Error("the page of the storage locations");
  },
}));
vi.mock(import("./pages/snapshot-locations-page"), async (original) => ({
  ...(await original()),
  SnapshotLocationsPage: () => {
    throw new Error("the page of the snapshot locations");
  },
}));

// A section that cannot read an object named `broken`, and says the name of any other. It is made before the
// modules are, as the mocks that use it are.
const { section } = vi.hoisted(() => ({
  section:
    (of: string) =>
    ({ object }: { object: { metadata: { name: string } } }) => {
      if (object.metadata.name === "broken") throw new Error(`the section of ${of}`);
      return <p>{`the section of ${of} for ${object.metadata.name}`}</p>;
    },
}));

vi.mock(import("./details/backup-details"), async (original) => ({
  ...(await original()),
  BackupDetails: section("a backup") as never,
}));
vi.mock(import("./details/restore-details"), async (original) => ({
  ...(await original()),
  RestoreDetails: section("a restore") as never,
}));
vi.mock(import("./details/schedule-details"), async (original) => ({
  ...(await original()),
  ScheduleDetails: section("a schedule") as never,
}));
vi.mock(import("./details/storage-location-details"), async (original) => ({
  ...(await original()),
  StorageLocationDetails: section("a storage location") as never,
}));
vi.mock(import("./details/snapshot-location-details"), async (original) => ({
  ...(await original()),
  SnapshotLocationDetails: section("a snapshot location") as never,
}));

const NAME = "@freelensapp/velero-extension";

const logged = (error: string) => ({
  level: "error",
  message: `[${NAME}]: Error: ${error}`,
  data: [expect.any(String)],
});

function object(name: string) {
  return { metadata: { name, namespace: "velero", uid: name, selfLink: `/apis/velero.io/v1/${name}` } };
}

beforeEach(() => {
  hostLog.length = 0;
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("what the renderer registers, drawn by the host", () => {
  it("keeps an error of each page in the page, with the rest of the view of the cluster", () => {
    const extension = Reflect.construct(VeleroRenderer, []) as Renderer.LensExtension;
    const pages: [string | undefined, string][] = [
      ["overview", "the page of the overview"],
      ["backups", "the page of the backups"],
      ["restores", "the page of the restores"],
      ["schedules", "the page of the schedules"],
      ["storage-locations", "the page of the storage locations"],
      ["snapshot-locations", "the page of the snapshot locations"],
    ];

    expect(extension.clusterPages.map((page) => page.id)).toEqual(pages.map(([id]) => id));
    for (const [index, { components }] of extension.clusterPages.entries()) {
      const { Page } = components;
      const [, error] = pages[index];

      hostLog.length = 0;
      render(
        <>
          <nav>the sidebar of the cluster</nav>
          <main>
            <Page params={{}} />
          </main>
        </>,
      );
      expect([error, within(screen.getByRole("main")).getByRole("alert").textContent]).toEqual([
        error,
        expect.stringContaining(`Error: ${error}`),
      ]);
      expect(screen.getByText("the sidebar of the cluster")).toBeTruthy();
      expect(hostLog).toEqual([logged(error)]);
      cleanup();
    }
  });

  it("keeps an error of each section of the details in the section, with the rest of the drawer, and draws it again for another object", () => {
    const extension = Reflect.construct(VeleroRenderer, []) as Renderer.LensExtension;
    const sections = ["a backup", "a restore", "a schedule", "a storage location", "a snapshot location"];

    expect(extension.kubeObjectDetailItems).toHaveLength(sections.length);
    for (const [index, { components }] of extension.kubeObjectDetailItems.entries()) {
      const { Details } = components;
      const of = sections[index];
      const drawer = (name: string) => (
        <div>
          <p>the details of the host</p>
          <Details object={object(name)} />
        </div>
      );

      hostLog.length = 0;
      const { rerender } = render(drawer("broken"));

      expect([of, screen.getByRole("alert").textContent]).toEqual([
        of,
        expect.stringContaining(`the section of ${of}`),
      ]);
      expect(screen.getByText("the details of the host")).toBeTruthy();
      expect(hostLog).toEqual([logged(`the section of ${of}`)]);
      rerender(drawer("nightly"));
      expect(screen.getByText(`the section of ${of} for nightly`)).toBeTruthy();
      expect(screen.queryByRole("alert")).toBeNull();
      cleanup();
    }
  });
});
