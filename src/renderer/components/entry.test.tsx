// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { observer } from "mobx-react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { emptyPreferences, RESOURCES } from "../../common/discovery";
import { Installation } from "../state/installation";
import { EntryState } from "./entry-state";
import { Coverage, TargetBar } from "./target-bar";

import type { Answer, Family, Preferences } from "../../common/discovery";

const DISCOVERY = "/apis/velero.io/v1";
const LOCATIONS = "/apis/velero.io/v1/backupstoragelocations";
const A = "velero-a";
const B = "velero-b";

type Answers = Record<string, Answer | (() => Promise<Answer>)>;

function path(family: Family, namespace: string): string {
  return `/apis/velero.io/v1/namespaces/${namespace}/${RESOURCES[family]}`;
}

function list(...items: unknown[]): Answer {
  return { status: 200, body: { items } };
}

function object(name: string, namespace: string) {
  return { metadata: { name, namespace, uid: `${namespace}-${name}` } };
}

const served: Answer = { status: 200, body: { resources: Object.values(RESOURCES).map((name) => ({ name })) } };

function answers(more: Answers = {}): Answers {
  return {
    [DISCOVERY]: served,
    [LOCATIONS]: list(object("default", A), object("default", B)),
    [path("backups", A)]: list(object("nightly-1", A), object("nightly-2", A)),
    [path("backups", B)]: list(object("nightly-1", B)),
    ...Object.fromEntries(
      [A, B].flatMap((namespace) => [
        [path("restores", namespace), list()],
        [path("schedules", namespace), list()],
        [path("storageLocations", namespace), list(object("default", namespace))],
        [path("snapshotLocations", namespace), list()],
      ]),
    ),
    ...more,
  };
}

// What every view of the extension is made of before its own content: the target, what is missing of it,
// and the state that stands for the content until an installation is selected.
const Views = observer(({ installation, families }: { installation: Installation; families: Family[] }) => {
  React.useEffect(() => {
    void installation.open();
    return installation.watch();
  }, [installation]);

  return (
    <>
      <TargetBar installation={installation} />
      <Coverage installation={installation} families={families} />
      {installation.entry.state === "ready" ? (
        <div data-testid="content">{installation.namespace}</div>
      ) : (
        <EntryState installation={installation} />
      )}
    </>
  );
});

function mount(table: Answers, preferences: Preferences = emptyPreferences(), families: Family[] = ["backups"]) {
  const asked: string[] = [];
  const written: Preferences[] = [];
  const clock = { now: Date.parse("2026-09-01T12:00:00Z") };
  const installation = new Installation({
    cluster: { id: "cluster-a", name: "local-demo" },
    read: async (address) => {
      asked.push(address);
      const answer = table[address] ?? { status: 404 };

      return typeof answer === "function" ? answer() : answer;
    },
    now: () => clock.now,
    storage: { read: () => preferences, write: (next) => written.push(next) },
  });
  const view = render(<Views installation={installation} families={families} />);

  return { installation, asked, written, clock, table, view };
}

const chosen = (namespace: string): Preferences => ({ selected: { "cluster-a": namespace }, configured: {} });
const names = (installation: Installation, family: Family = "backups") =>
  installation.read(family).items.map((item) => `${item.metadata.namespace}/${item.metadata.name}`);
const notice = (family: string) => screen.queryByTestId(`velero-notice-${family}`)?.textContent ?? "";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("entry of the views", () => {
  it("asks to choose between two installations and takes none, then reads the one that is chosen", async () => {
    const { installation, asked, written } = mount(answers());

    await screen.findByTestId("velero-state-choose");
    expect(screen.getByTestId("velero-target-cluster").textContent).toBe("local-demo");
    expect((screen.getByLabelText("Velero namespace") as HTMLSelectElement).value).toBe("");
    expect(screen.getByTestId(`velero-choice-${A}`)).toBeTruthy();
    expect(screen.getByTestId(`velero-choice-${B}`)).toBeTruthy();
    expect(screen.queryByTestId("content")).toBeNull();
    expect(asked).toEqual([DISCOVERY, LOCATIONS]);
    fireEvent.click(screen.getByTestId(`velero-choice-${B}`));
    await waitFor(() => expect(names(installation)).toEqual([`${B}/nightly-1`]));
    expect(screen.getByTestId("content").textContent).toBe(B);
    expect((screen.getByLabelText("Velero namespace") as HTMLSelectElement).value).toBe(B);
    expect(written).toEqual([chosen(B)]);
    expect(asked.filter((address) => address.includes(`/namespaces/${A}/`))).toEqual([]);
    expect(screen.getByTestId("velero-read-time").textContent).toBe(
      `Read at ${new Date("2026-09-01T12:00:00Z").toLocaleTimeString()}`,
    );
  });

  it("changes the installation from the target bar, and keeps nothing of the one before", async () => {
    const { installation, written } = mount(answers(), chosen(A));

    await waitFor(() => expect(names(installation)).toHaveLength(2));
    fireEvent.change(screen.getByLabelText("Velero namespace"), { target: { value: B } });
    // What was read of the first is gone at once, before the second answers.
    expect(names(installation)).toEqual([]);
    await waitFor(() => expect(names(installation)).toEqual([`${B}/nightly-1`]));
    expect(written).toEqual([chosen(B)]);
  });

  it("keeps a namespace that was chosen when it is not found any more, and does not take the other", async () => {
    const { installation, table, written } = mount(answers(), chosen(A));

    await waitFor(() => expect(names(installation)).toHaveLength(2));
    table[LOCATIONS] = list(object("default", B));
    table[path("backups", A)] = list();
    await act(() => installation.refresh());
    expect(notice("stale-selection")).toContain(`No storage location is in ${A} any more`);
    expect((screen.getByLabelText("Velero namespace") as HTMLSelectElement).value).toBe(A);
    expect(screen.getByText(`${A} (not found)`)).toBeTruthy();
    expect(installation.namespace).toBe(A);
    expect(names(installation)).toEqual([]);
    expect(written).toEqual([]);
  });

  it.each([
    [
      "not installed",
      { [DISCOVERY]: { status: 404 }, [LOCATIONS]: { status: 404 } },
      "velero-state-not-installed",
      "does not serve the API",
    ],
    ["denied", { [DISCOVERY]: { status: 403 }, [LOCATIONS]: { status: 403 } }, "velero-state-restricted", "denied"],
    ["without an answer", { [DISCOVERY]: {}, [LOCATIONS]: {} }, "velero-state-failed", "not known to be absent"],
    ["without a storage location", { [LOCATIONS]: list() }, "velero-state-configure", "no backup storage location"],
    ["with the locations denied", { [LOCATIONS]: { status: 403 } }, "velero-state-configure", "is denied"],
    ["with the locations not answered", { [LOCATIONS]: {} }, "velero-state-configure", "could not be read"],
  ])("says what it knows of a cluster %s", async (_name, more, state, text) => {
    mount(answers(more as Answers));
    expect((await screen.findByTestId(state)).textContent).toContain(text);
    expect(screen.queryByTestId("content")).toBeNull();
    // Only an answer that says so makes Velero absent, and only then no namespace can be named.
    expect(screen.queryByTestId("velero-configure") === null).toBe(state === "velero-state-not-installed");
    expect((screen.getByLabelText("Velero namespace") as HTMLSelectElement).disabled).toBe(true);
  });

  it("reads a namespace that is named where the installations cannot be looked for", async () => {
    const { installation, asked, written } = mount(answers({ [LOCATIONS]: { status: 403 } }));

    await screen.findByTestId("velero-state-configure");
    fireEvent.change(screen.getByTestId("velero-configure-input"), { target: { value: "Not A Namespace" } });
    fireEvent.click(screen.getByTestId("velero-configure-submit"));
    expect(screen.getByTestId("velero-configure-error").textContent).toContain("Not the name of a namespace");
    // What is not a name is refused before it is part of a request.
    expect(asked).toEqual([DISCOVERY, LOCATIONS]);
    fireEvent.change(screen.getByTestId("velero-configure-input"), { target: { value: A } });
    fireEvent.click(screen.getByTestId("velero-configure-submit"));
    await waitFor(() => expect(names(installation)).toHaveLength(2));
    expect(written.at(-1)).toEqual({ selected: { "cluster-a": A }, configured: { "cluster-a": [A] } });
    expect(screen.getByText(`${A} (configured)`)).toBeTruthy();
  });

  it("names another namespace from a view that is shown, and takes it back", async () => {
    const { installation } = mount(answers(), chosen(A));

    await waitFor(() => expect(names(installation)).toHaveLength(2));
    expect(screen.queryByTestId("velero-configure")).toBeNull();
    fireEvent.click(screen.getByTestId("velero-namespaces-toggle"));
    fireEvent.change(screen.getByTestId("velero-configure-input"), { target: { value: "velero-c" } });
    fireEvent.click(screen.getByTestId("velero-configure-submit"));
    await waitFor(() => expect(installation.namespace).toBe("velero-c"));
    expect(screen.queryByTestId("velero-namespaces")).toBeNull();
    fireEvent.click(screen.getByTestId("velero-namespaces-toggle"));
    fireEvent.click(screen.getByTestId("velero-namespaces-forget-velero-c"));
    // Two installations are found and the one that was named is gone: none is taken in its place.
    await screen.findByTestId("velero-state-choose");
    expect(installation.configured).toEqual([]);
  });
});

describe("what is missing of an installation", () => {
  it("says which family is denied and keeps the ones that were read", async () => {
    const { installation } = mount(
      answers({ [path("restores", A)]: { status: 403 }, [path("snapshotLocations", A)]: { status: 500 } }),
      chosen(A),
      ["backups", "restores", "snapshotLocations"],
    );

    await waitFor(() => expect(names(installation)).toHaveLength(2));
    expect(notice("restores")).toBe("warning_amberRestores cannot be read: access is denied.");
    expect(notice("snapshotLocations")).toContain("Volume Snapshot Locations could not be read.");
    expect(notice("backups")).toBe("");
    expect(installation.read("restores")).toMatchObject({ status: "forbidden", items: [] });
    expect(installation.read("restores").lastSuccess).toBeUndefined();
  });

  it("says nothing of a family the view does not need", async () => {
    const { installation } = mount(answers({ [path("restores", A)]: { status: 403 } }), chosen(A), ["backups"]);

    await waitFor(() => expect(names(installation)).toHaveLength(2));
    expect(screen.queryByTestId("velero-coverage")).toBeNull();
  });

  it("names the kinds the cluster does not serve, and does not ask for them", async () => {
    const { installation, asked } = mount(
      answers({ [DISCOVERY]: { status: 200, body: { resources: [{ name: "backups" }, { name: "schedules" }] } } }),
      chosen(A),
      ["backups", "restores"],
    );

    await waitFor(() => expect(names(installation)).toHaveLength(2));
    expect(notice("restores")).toContain("are not served by this cluster");
    expect(asked).not.toContain(path("restores", A));
  });

  it("keeps what was read when the next read fails, and says when it was read", async () => {
    const { installation, table, clock } = mount(answers(), chosen(A));

    await waitFor(() => expect(names(installation)).toHaveLength(2));
    const read = new Date(clock.now).toLocaleTimeString();

    clock.now += 60_000;
    table[path("backups", A)] = { status: 500 };
    await act(() => installation.refresh());
    expect(names(installation)).toHaveLength(2);
    expect(notice("backups")).toContain("could not be read");
    expect(notice("backups")).toContain(`What is shown was read at ${read}`);
    // A failure with no status is not an absence: what was read stays, and Velero is not said absent.
    table[path("backups", A)] = {};
    table[DISCOVERY] = {};
    await act(() => installation.refresh());
    expect(names(installation)).toHaveLength(2);
    expect(screen.queryByTestId("velero-state-not-installed")).toBeNull();
    expect(screen.getByTestId("content").textContent).toBe(A);
  });

  it("reads again when asked, and every so often while a view is open, and stops when it closes", async () => {
    vi.useFakeTimers();
    const { asked, view } = mount(answers(), chosen(A));
    const lists = () => asked.filter((address) => address === path("backups", A)).length;

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(lists()).toBe(1);
    fireEvent.click(screen.getByTestId("velero-refresh"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(lists()).toBe(2);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
    expect(lists()).toBe(3);
    view.unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(120_000);
    });
    expect(lists()).toBe(3);
    expect(vi.getTimerCount()).toBe(0);
  });
});
