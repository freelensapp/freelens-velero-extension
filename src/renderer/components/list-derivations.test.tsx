// @vitest-environment jsdom

// The list of a kind as the host draws it: the host calls what the list gives it from its own derivations,
// the getters of its list read inside its observers (packages/core/src/renderer/components/item-object-list/
// list-layout.tsx lines 178 to 293 at the validation target), and keeps the items of a store of its own in
// one array it changes in place. What the extension gives carries what it needs from the render, and the
// view follows the objects whatever array they come in.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { autorun, runInAction } from "mobx";
import { afterEach, describe, expect, it } from "vitest";
import { listProps } from "../../../test/host-components";
import { emptyPreferences, heldPreferences, RESOURCES } from "../../common/discovery";
import { BackupsPage } from "../pages/backups-page";
import { Installation } from "../state/installation";

import type { Renderer } from "@freelensapp/extensions";

import type { Answer, Family } from "../../common/discovery";

const DISCOVERY = "/apis/velero.io/v1";
const LOCATIONS = "/apis/velero.io/v1/backupstoragelocations";
const A = "velero-a";

function path(family: Family, namespace: string): string {
  return `/apis/velero.io/v1/namespaces/${namespace}/${RESOURCES[family]}`;
}

function list(...items: unknown[]): Answer {
  return { status: 200, body: { items } };
}

function backup(name: string, phase: string, resourceVersion = "1") {
  return {
    apiVersion: "velero.io/v1",
    kind: "Backup",
    metadata: { name, namespace: A, uid: `uid-${name}`, resourceVersion, creationTimestamp: "2026-09-01T10:00:00Z" },
    spec: { storageLocation: "default" },
    status: { phase, startTimestamp: "2026-09-01T10:00:00Z" },
  };
}

function mount() {
  const table: Record<string, Answer> = {
    [DISCOVERY]: { status: 200, body: { resources: Object.values(RESOURCES).map((name) => ({ name })) } },
    [LOCATIONS]: list({ metadata: { name: "default", namespace: A } }),
    [path("backups", A)]: list(backup("nightly-1", "Completed"), backup("nightly-2", "InProgress")),
    [path("restores", A)]: list(),
    [path("schedules", A)]: list(),
    [path("storageLocations", A)]: list({ metadata: { name: "default", namespace: A, uid: "location" } }),
    [path("snapshotLocations", A)]: list(),
  };
  const installation = new Installation({
    cluster: { id: "cluster-a", name: "local-demo" },
    read: async (address) => table[address] ?? { status: 404 },
    now: () => Date.parse("2026-09-01T12:00:00Z"),
    storage: heldPreferences({ ...emptyPreferences(), selected: { "cluster-a": A } }),
  });

  render(<BackupsPage installation={installation} />);
  return { installation, table };
}

type HostObject = Renderer.K8sApi.KubeObject;

// What the list of the host was given, as it was given at the last render.
function given() {
  const props = listProps.get("veleroBackupsTable") as {
    getItems: () => HostObject[];
    customizeHeader: (placeholders: { title?: unknown; info?: unknown; filters?: unknown }) => { info?: unknown };
  };

  return props;
}

const phaseOf = (name: string) =>
  (screen.getByText(name).closest(".TableRow") as HTMLElement)
    .querySelector("[data-phase]")
    ?.getAttribute("data-phase");

afterEach(() => {
  cleanup();
  listProps.clear();
});

describe("what the list gives the host", () => {
  it("is called from a derivation of the host without reading a prop, and follows the objects it gives", async () => {
    const { installation, table } = mount();

    await waitFor(() => expect(screen.getByText("nightly-2")).toBeTruthy());
    const { getItems, customizeHeader } = given();
    const seen: string[][] = [];
    const headers: unknown[] = [];
    // As the getters of the list of the host read them, inside a reaction: nothing of a prop of a component
    // is read there, or mobx-react would throw in the render of the host.
    const stop = autorun(() => {
      seen.push(getItems().map((item) => `${item.getName()} ${item.metadata.resourceVersion}`));
      headers.push(customizeHeader({ info: "2 items" }).info);
    });

    expect(seen).toEqual([["nightly-1 1", "nightly-2 1"]]);
    expect(headers).toEqual(["2 items"]);
    table[path("backups", A)] = list(backup("nightly-1", "Completed"), backup("nightly-2", "Completed", "2"));
    await act(async () => {
      await installation.refresh();
    });
    expect(seen[seen.length - 1]).toEqual(["nightly-1 1", "nightly-2 2"]);
    stop();
  });

  it("follows its objects when the array of the items is the same one, changed in place, as the host changes the items of its stores", async () => {
    const { installation } = mount();

    await waitFor(() => expect(phaseOf("nightly-2")).toBe("In progress"));
    const read = installation.reads.backups;
    const items = read.items;

    // The object changes in the array the views were given, and the read is told again with that array.
    act(() => {
      runInAction(() => {
        items.splice(1, 1, backup("nightly-2", "Failed", "2"));
        installation.reads = { ...installation.reads, backups: { ...read } };
      });
    });
    expect(installation.reads.backups.items).toBe(items);
    expect(phaseOf("nightly-2")).toBe("Failed");
    expect(
      given()
        .getItems()
        .map((item) => item.metadata.resourceVersion),
    ).toEqual(["1", "2"]);
  });
});

describe("the components of the views", () => {
  it("read their props in their render: none is a class that reads this.props, but the boundary, which observes nothing", () => {
    // Under mobx-react 10 the props of an observer class are read in its render only: a derivation that reads
    // them throws in the render of the host. The views are function components, and stay so.
    const root = join(process.cwd(), "src", "renderer");
    const sources = (readdirSync(root, { recursive: true }) as string[])
      .filter((file) => /\.tsx?$/.test(file) && !/\.test\.tsx?$/.test(file))
      .map((file) => [file, readFileSync(join(root, file), "utf8")] as const);
    const classes = sources.filter(([, text]) =>
      /this\.props|extends\s+(React\.)?(Pure)?Component\b|@observer/.test(text),
    );

    expect(sources.length).toBeGreaterThan(40);
    // The one class is the boundary, the one kind of component React lets keep an error: it is no observer and
    // reads no observable, so no derivation reads its props.
    expect(classes.map(([file]) => file)).toEqual([join("components", "error-boundary.tsx")]);
    expect(classes[0][1]).not.toMatch(/from "mobx|\bobserver\(|@observ|@computed|makeObservable/);
  });
});
