// @vitest-environment jsdom

// The boundaries every registration of the renderer is drawn inside (REQ-211, HOST-16 at the unit layer): an
// error thrown while a part draws stays in its place, with the error page of the extension or nothing for an
// item of a menu, the log of the host has it with the name of the extension, and the rest of the view stays.

import { Renderer } from "@freelensapp/extensions";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hostLog } from "../../../test/freelens-extensions";
import { emptyPreferences, heldPreferences, RESOURCES } from "../../common/discovery";
import { Backup } from "../api/kinds";
import { BackupDetails } from "../details/backup-details";
import VeleroRenderer from "../index";
import { closeViews } from "../navigation";
import { BACKUPS, BackupsPage } from "../pages/backups-page";
import { Installation } from "../state/installation";
import {
  ErrorBoundary,
  withDetailsErrorBoundary,
  withMenuItemErrorBoundary,
  withPageErrorBoundary,
} from "./error-boundary";
import { ErrorPage } from "./error-page";

import type { Answer, Family } from "../../common/discovery";

const NAME = "@freelensapp/velero-extension";
const A = "velero-a";

// The extension as the host makes it: the boundaries log with its name.
const extension = Reflect.construct(VeleroRenderer, []) as Renderer.LensExtension;

const Throws = ({ message = "a part that cannot be drawn" }: { message?: string }): React.JSX.Element => {
  throw new Error(message);
};

// A part that throws for some objects only, as a section does for an object it cannot read.
const ThrowsFor = ({ object }: { object: { broken: boolean } }) => {
  if (object.broken) throw new Error("an object that cannot be read");
  return <p>a part drawn</p>;
};

function path(family: Family, namespace: string): string {
  return `/apis/velero.io/v1/namespaces/${namespace}/${RESOURCES[family]}`;
}

function list(...items: unknown[]): Answer {
  return { status: 200, body: { items } };
}

function backup(name: string) {
  return {
    apiVersion: "velero.io/v1",
    kind: "Backup",
    metadata: {
      name,
      namespace: A,
      uid: `uid-${name}`,
      resourceVersion: "1",
      creationTimestamp: "2026-09-01T10:00:00Z",
    },
    spec: { storageLocation: "default" },
    status: { phase: "Completed", startTimestamp: "2026-09-01T10:00:00Z" },
  };
}

// An object of the host for a backup, as the host makes it from the data of the API, with its link.
function backupObject(name: string): Backup {
  const data = backup(name);

  return Reflect.construct(Backup, [
    { ...data, metadata: { ...data.metadata, selfLink: `/apis/velero.io/v1/namespaces/${A}/backups/${name}` } },
  ]) as Backup;
}

// The views of an installation whose backups are the ones given, with its namespace chosen.
function installationWith(...backups: unknown[]): Installation {
  const table: Record<string, Answer> = {
    "/apis/velero.io/v1": { status: 200, body: { resources: Object.values(RESOURCES).map((name) => ({ name })) } },
    "/apis/velero.io/v1/backupstoragelocations": list({ metadata: { name: "default", namespace: A } }),
    [path("backups", A)]: list(...backups),
    [path("restores", A)]: list(),
    [path("schedules", A)]: list(),
    [path("storageLocations", A)]: list({ metadata: { name: "default", namespace: A, uid: "location" } }),
    [path("snapshotLocations", A)]: list(),
  };

  return new Installation({
    cluster: { id: "cluster-a", name: "local-demo" },
    read: async (address) => table[address] ?? { status: 404 },
    now: () => Date.parse("2026-09-01T12:00:00Z"),
    storage: heldPreferences({ ...emptyPreferences(), selected: { "cluster-a": A } }),
  });
}

// What the host logged of an error a boundary kept.
const logged = (error: string) => ({
  level: "error",
  message: `[${NAME}]: Error: ${error}`,
  data: [expect.any(String)],
});

beforeEach(() => {
  hostLog.length = 0;
  // React says on the console what a boundary kept, beside the log of the host.
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  act(() => closeViews());
  cleanup();
  vi.restoreAllMocks();
});

describe("the boundary", () => {
  it("draws the error page in place of a part that throws, gives the error to the log of the host with the name of the extension, and leaves the rest", () => {
    render(
      <>
        <p>before</p>
        <ErrorBoundary extension={extension}>
          <p>inside</p>
          <Throws />
        </ErrorBoundary>
        <p>after</p>
      </>,
    );

    const page = screen.getByTestId("velero-error-page");

    expect(page.getAttribute("role")).toBe("alert");
    expect(within(page).getByText("Error: a part that cannot be drawn")).toBeTruthy();
    expect(screen.queryByText("inside")).toBeNull();
    expect(screen.getByText("before")).toBeTruthy();
    expect(screen.getByText("after")).toBeTruthy();
    expect(hostLog).toEqual([logged("a part that cannot be drawn")]);
  });

  it("draws nothing in place of what throws when it is to draw nothing, and logs it", () => {
    render(
      <ul>
        <li>Edit</li>
        <ErrorBoundary extension={extension} fallback="nothing">
          <li>Suspend</li>
          <Throws message="an item of a menu" />
        </ErrorBoundary>
        <li>Delete</li>
      </ul>,
    );

    expect(screen.getAllByRole("listitem").map((item) => item.textContent)).toEqual(["Edit", "Delete"]);
    expect(screen.queryByTestId("velero-error-page")).toBeNull();
    expect(hostLog).toEqual([logged("an item of a menu")]);
  });

  it("draws what it holds when nothing throws, and logs nothing", () => {
    render(
      <ErrorBoundary extension={extension}>
        <p>inside</p>
      </ErrorBoundary>,
    );

    expect(screen.getByText("inside")).toBeTruthy();
    expect(hostLog).toEqual([]);
  });

  it("draws what it holds again for another reset key, and keeps the error for the same one", () => {
    const broken = { broken: true };
    const fixed = { broken: false };
    const { rerender } = render(
      <ErrorBoundary extension={extension} resetKey={broken}>
        <ThrowsFor object={broken} />
      </ErrorBoundary>,
    );

    expect(screen.getByText("Error: an object that cannot be read")).toBeTruthy();
    rerender(
      <ErrorBoundary extension={extension} resetKey={broken}>
        <ThrowsFor object={fixed} />
      </ErrorBoundary>,
    );
    expect(screen.getByText("Error: an object that cannot be read")).toBeTruthy();
    rerender(
      <ErrorBoundary extension={extension} resetKey={fixed}>
        <ThrowsFor object={fixed} />
      </ErrorBoundary>,
    );
    expect(screen.getByText("a part drawn")).toBeTruthy();
    expect(screen.queryByTestId("velero-error-page")).toBeNull();
    expect(hostLog).toEqual([logged("an object that cannot be read")]);
  });
});

describe("the error page", () => {
  it("says that the extension could not show the part, the error, and where the error is kept", () => {
    render(<ErrorPage error={new Error("a part that cannot be drawn")} />);

    expect(screen.getByTestId("velero-error-page").textContent).toBe(
      "The extension for Velero could not show this" +
        "Error: a part that cannot be drawn" +
        "The log of Freelens has the error, with the name of the extension.",
    );
  });

  it("says no error it was not given, and draws what it holds", () => {
    render(
      <ErrorPage>
        <span>what it holds</span>
      </ErrorPage>,
    );

    expect(screen.getByTestId("velero-error-page").querySelectorAll("p")).toHaveLength(1);
    expect(screen.getByText("what it holds")).toBeTruthy();
  });
});

describe("the registrations drawn inside the boundary", () => {
  it("keep an error of a page in the page: the error page there, and the rest of the view of the cluster", () => {
    const { Page } = withPageErrorBoundary(extension, {
      id: "broken",
      components: { Page: () => <Throws message="a page that cannot be drawn" /> },
    }).components;

    render(
      <>
        <nav>the sidebar of the cluster</nav>
        <Page params={{}} />
      </>,
    );

    expect(
      within(screen.getByTestId("velero-error-page")).getByText("Error: a page that cannot be drawn"),
    ).toBeTruthy();
    expect(screen.getByText("the sidebar of the cluster")).toBeTruthy();
    expect(hostLog).toEqual([logged("a page that cannot be drawn")]);
  });

  // A `try` around the call of the page does not see this error: the host calls `renderTableContents` from the
  // render of its own list, a child of the page.
  it("keep in the page an error that a cell throws from the render of the list of the host", async () => {
    const cells = BACKUPS.cells;

    vi.spyOn(BACKUPS, "cells").mockImplementation((row, item) => {
      if (row.name === "nightly-2") throw new Error("a cell that cannot be drawn");
      return cells(row, item);
    });
    const installation = installationWith(backup("nightly-1"), backup("nightly-2"));
    const { Page } = withPageErrorBoundary(extension, {
      id: "backups",
      components: { Page: () => <BackupsPage installation={installation} /> },
    }).components;

    render(
      <>
        <nav>the sidebar of the cluster</nav>
        <Page params={{}} />
      </>,
    );

    const page = await screen.findByTestId("velero-error-page");

    expect(within(page).getByText("Error: a cell that cannot be drawn")).toBeTruthy();
    expect(screen.queryByTestId("velero-backups-page")).toBeNull();
    expect(screen.getByText("the sidebar of the cluster")).toBeTruthy();
    expect(hostLog).toEqual([logged("a cell that cannot be drawn")]);
    installation.dispose();
  });

  it("keep an error of a section of the details in the section, leave the rest of the drawer, and draw the section again for another object", async () => {
    const installation = installationWith();
    const { Details } = withDetailsErrorBoundary(
      extension,
      Renderer.K8sApi.detailsFor(Backup, {
        priority: 10,
        Details: (props) => <BackupDetails {...props} extension={extension} installation={installation} />,
      }),
    ).components;
    // An object whose status cannot be read, which the section reads first.
    const unreadable = {
      ...backup("nightly-1"),
      get status(): never {
        throw new Error("a status that cannot be read");
      },
    } as unknown as Backup;
    const readable = backupObject("nightly-2");
    const drawer = (object: Backup) => (
      <div>
        <p>the details of the host</p>
        <Details object={object} />
      </div>
    );
    const { rerender } = render(drawer(unreadable));

    expect(
      within(screen.getByTestId("velero-error-page")).getByText("Error: a status that cannot be read"),
    ).toBeTruthy();
    expect(screen.getByText("the details of the host")).toBeTruthy();
    expect(hostLog).toEqual([logged("a status that cannot be read")]);
    rerender(drawer(readable));
    await waitFor(() => expect(screen.getByTestId("velero-backup-details")).toBeTruthy());
    expect(screen.queryByTestId("velero-error-page")).toBeNull();
    expect(screen.getByText("the details of the host")).toBeTruthy();
    installation.dispose();
  });

  it("draw nothing for an item of a menu that throws, leave the other items, and draw it again for another object", () => {
    const { MenuItem } = withMenuItemErrorBoundary(
      extension,
      Renderer.K8sApi.menuItemFor(Backup, {
        MenuItem: ({ object }) => <ThrowsFor object={{ broken: object.getName() === "nightly-1" }} />,
      }),
    ).components;
    const menu = (object: Backup) => (
      <ul>
        <li>Edit</li>
        <MenuItem object={object} />
        <li>Delete</li>
      </ul>
    );
    const { rerender } = render(menu(backupObject("nightly-1")));

    expect(screen.getAllByRole("listitem").map((item) => item.textContent)).toEqual(["Edit", "Delete"]);
    expect(screen.queryByText(/cannot be read/)).toBeNull();
    expect(hostLog).toEqual([logged("an object that cannot be read")]);
    rerender(menu(backupObject("nightly-2")));
    expect(screen.getByText("a part drawn")).toBeTruthy();
  });
});
