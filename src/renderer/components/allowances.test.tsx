// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { observer } from "mobx-react";
import React from "react";
import { afterEach, describe, expect, it } from "vitest";
import { withoutAllowance } from "../../common/allowances";
import { emptyPreferences, heldPreferences, RESOURCES } from "../../common/discovery";
import { Installation } from "../state/installation";
import { allowanceWords, TargetBar } from "./target-bar";

import type { Allowance, AllowanceFor } from "../../common/allowances";
import type { Answer, Family, PreferenceStorage } from "../../common/discovery";
import type { Failure } from "../../common/ipc";
import type { AllowanceClient } from "../api/ipc";

const DISCOVERY = "/apis/velero.io/v1";
const LOCATIONS = "/apis/velero.io/v1/backupstoragelocations";
const ORIGIN = "https://storage.example:9000";

function list(...items: unknown[]): Answer {
  return { status: 200, body: { items } };
}

const answers: Record<string, Answer> = {
  [DISCOVERY]: { status: 200, body: { resources: Object.values(RESOURCES).map((name) => ({ name })) } },
  [LOCATIONS]: list({ metadata: { name: "default", namespace: "velero-a", uid: "location-uid" } }),
  ...Object.fromEntries(
    (Object.keys(RESOURCES) as Family[]).map((family) => [
      `/apis/velero.io/v1/namespaces/velero-a/${RESOURCES[family]}`,
      list(),
    ]),
  ),
};

const HELD: Allowance[] = [
  { what: "origin", origin: ORIGIN, location: "velero/default", since: Date.UTC(2026, 9, 4, 10, 0, 0) },
  { what: "private", origin: ORIGIN, since: Date.UTC(2026, 9, 4, 10, 5, 0) },
  { what: "http", origin: "http://minio.storage:9000", since: Date.UTC(2026, 9, 4, 10, 6, 0) },
];

// The main process, as the views see it: it takes an allowance out of the store it keeps, or refuses.
// What it is given to keep is recorded, and not written into the store of this window: the store hears of
// it after the answer, as it does of everything the main process writes.
function allowanceClient(storage: PreferenceStorage, refuse?: Failure) {
  const asked: { cluster: string; allowed: AllowanceFor }[] = [];
  const given: { cluster: string; allowed: AllowanceFor }[] = [];
  const client: AllowanceClient = {
    allow: async (cluster, allowed) => {
      given.push({ cluster, allowed });
      return refuse ?? { ok: true, value: null };
    },
    takeBack: async (cluster, allowed) => {
      asked.push({ cluster, allowed });
      if (refuse) return refuse;
      const kept = storage.read();
      const allowances = withoutAllowance(kept.allowances ?? {}, cluster, allowed);
      const { allowances: _before, ...others } = kept;

      storage.write(Object.keys(allowances).length ? { ...others, allowances } : others);
      return { ok: true, value: null };
    },
  };

  return { client, asked, given };
}

const Bar = observer(({ installation }: { installation: Installation }) => {
  React.useEffect(() => {
    void installation.open();
  }, [installation]);
  return <TargetBar installation={installation} />;
});

function mount(allowances?: Record<string, Allowance[]>, refuse?: Failure) {
  const storage = heldPreferences({
    ...emptyPreferences(),
    selected: { "cluster-a": "velero-a" },
    ...(allowances ? { allowances } : {}),
  });
  const { client, asked, given } = allowanceClient(storage, refuse);
  const installation = new Installation({
    cluster: { id: "cluster-a", name: "local-demo" },
    read: async (path) => answers[path] ?? { status: 404 },
    now: () => Date.UTC(2026, 9, 4, 11, 0, 0),
    storage,
    allowances: client,
  });

  render(<Bar installation={installation} />);
  return { installation, storage, asked, given };
}

afterEach(() => cleanup());

describe("what the operator allowed the downloads to do, in the target bar", () => {
  it("shows nothing of it where nothing was allowed for this cluster", async () => {
    mount({ "cluster-b": HELD });
    await waitFor(() => expect(screen.getByTestId("velero-target-cluster").textContent).toBe("local-demo"));
    expect(screen.queryByTestId("velero-allowances-toggle")).toBeNull();
    expect(screen.queryByTestId("velero-allowances")).toBeNull();
  });

  it("says how many there are, and lists each with its origin, what it allows and since when, behind its command", async () => {
    mount({ "cluster-a": HELD, "cluster-b": [{ what: "private", origin: "https://other.example", since: 1 }] });
    const toggle = await screen.findByTestId("velero-allowances-toggle");

    expect(toggle.textContent).toContain("Allowed for downloads: 3");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByTestId("velero-allowances")).toBeNull();
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    const rows = [...screen.getByTestId("velero-allowances").querySelectorAll("li")].map((row) => row.textContent);

    expect(rows).toEqual(
      HELD.map(
        (allowance) =>
          `${allowance.origin}${allowanceWords(allowance)}since ${new Date(allowance.since).toLocaleString()}Take back`,
      ),
    );
    expect(HELD.map(allowanceWords)).toEqual([
      "Downloads from this origin, for the storage location default of velero",
      "A connection to a private address of this origin",
      "A connection to this origin that is not encrypted, made directly from this machine",
    ]);
    // Nothing of another cluster is shown, and nothing of a URL: an origin has no path and no query.
    expect(screen.getByTestId("velero-allowances").textContent).not.toMatch(/other\.example|[?]|X-Amz/);
  });

  it("takes one back through the main process, for this cluster, and the line goes with it", async () => {
    const { asked, storage } = mount({ "cluster-a": HELD });

    fireEvent.click(await screen.findByTestId("velero-allowances-toggle"));
    fireEvent.click(screen.getByTestId("velero-allowances-take-back-1"));
    await waitFor(() => expect(screen.getByTestId("velero-allowances").querySelectorAll("li")).toHaveLength(2));
    expect(asked).toEqual([{ cluster: "cluster-a", allowed: { what: "private", origin: ORIGIN } }]);
    expect(storage.read().allowances).toEqual({ "cluster-a": [HELD[0], HELD[2]] });
    expect(screen.getByTestId("velero-allowances-toggle").textContent).toContain("Allowed for downloads: 2");
    // The last one taken back leaves nothing to show, and nothing to open.
    fireEvent.click(screen.getByTestId("velero-allowances-take-back-0"));
    await waitFor(() => expect(screen.getByTestId("velero-allowances").querySelectorAll("li")).toHaveLength(1));
    fireEvent.click(screen.getByTestId("velero-allowances-take-back-0"));
    await waitFor(() => expect(screen.queryByTestId("velero-allowances-toggle")).toBeNull());
    expect(screen.queryByTestId("velero-allowances")).toBeNull();
    expect("allowances" in storage.read()).toBe(false);
    // The location goes with an origin that is taken back, and with no other kind.
    expect(asked[1].allowed).toEqual({ what: "origin", origin: ORIGIN, location: "velero/default" });
  });

  it("gives the main process what a download needs, for this cluster, and shows it before the store hears of it", async () => {
    const { installation, given, storage } = mount();

    await waitFor(() => expect(screen.getByTestId("velero-target-cluster").textContent).toBe("local-demo"));
    expect(screen.queryByTestId("velero-allowances-toggle")).toBeNull();
    await expect(installation.allow({ what: "private", origin: ORIGIN })).resolves.toBe(true);
    await expect(installation.allow({ what: "origin", origin: ORIGIN, location: "velero/default" })).resolves.toBe(
      true,
    );
    expect(given).toEqual([
      { cluster: "cluster-a", allowed: { what: "private", origin: ORIGIN } },
      { cluster: "cluster-a", allowed: { what: "origin", origin: ORIGIN, location: "velero/default" } },
    ]);
    // Shown at once, with the moment of this window, and written by the main process alone: this window
    // writes nothing of it into the store.
    const toggle = await screen.findByTestId("velero-allowances-toggle");

    expect(toggle.textContent).toContain("Allowed for downloads: 2");
    expect(installation.allowances).toEqual([
      { what: "private", origin: ORIGIN, since: Date.UTC(2026, 9, 4, 11, 0, 0) },
      { what: "origin", origin: ORIGIN, location: "velero/default", since: Date.UTC(2026, 9, 4, 11, 0, 0) },
    ]);
    expect("allowances" in storage.read()).toBe(false);
    // One that is there already is asked of the main process all the same, which keeps its time, and is
    // shown once.
    await expect(installation.allow({ what: "private", origin: ORIGIN })).resolves.toBe(true);
    expect(given).toHaveLength(3);
    expect(installation.allowances).toHaveLength(2);
  });

  it("says why an allowance could not be given, shows none, and answers that it was not", async () => {
    const { installation } = mount(undefined, {
      ok: false,
      code: "request-failed",
      stage: "allowances",
      retry: false,
      text: "What is allowed cannot be kept: the store is not there.",
    });

    await waitFor(() => expect(screen.getByTestId("velero-target-cluster").textContent).toBe("local-demo"));
    await expect(installation.allow({ what: "http", origin: "http://minio.storage:9000" })).resolves.toBe(false);
    expect(installation.allowances).toEqual([]);
    expect(installation.allowanceFailure).toBe("What is allowed cannot be kept: the store is not there.");
    expect(screen.queryByTestId("velero-allowances-toggle")).toBeNull();
  });

  it("answers that nothing was given where there is no way to the main process", async () => {
    const installation = new Installation({
      cluster: { id: "cluster-a", name: "local-demo" },
      read: async (path) => answers[path] ?? { status: 404 },
      now: () => 1000,
      storage: heldPreferences(emptyPreferences()),
    });

    await expect(installation.allow({ what: "private", origin: ORIGIN })).resolves.toBe(false);
    expect(installation.allowances).toEqual([]);
  });

  it("says why an allowance could not be taken back, and keeps showing it", async () => {
    mount(
      { "cluster-a": HELD },
      { ok: false, code: "request-failed", stage: "way", retry: true, text: "The main process did not answer." },
    );
    fireEvent.click(await screen.findByTestId("velero-allowances-toggle"));
    fireEvent.click(screen.getByTestId("velero-allowances-take-back-0"));
    await waitFor(() =>
      expect(screen.getByTestId("velero-allowances-failure").textContent).toBe("The main process did not answer."),
    );
    expect(screen.getByTestId("velero-allowances").querySelectorAll("li")).toHaveLength(3);
    expect(screen.getByTestId("velero-allowances-failure").getAttribute("role")).toBe("alert");
  });
});
