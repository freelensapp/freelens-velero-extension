// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { observer } from "mobx-react";
import React from "react";
import { afterEach, describe, expect, it } from "vitest";
import { confirmDialogs } from "../../../test/host-components";
import { emptyPreferences, heldPreferences, RESOURCES } from "../../common/discovery";
import { Installation } from "../state/installation";
import { CONNECTION_REASONS, TargetBar, writesDialogWords } from "./target-bar";

import type { Answer, Family } from "../../common/discovery";
import type { Connection, GateState } from "../../common/ipc";
import type { GateClient } from "../api/ipc";

const DISCOVERY = "/apis/velero.io/v1";
const LOCATIONS = "/apis/velero.io/v1/backupstoragelocations";

function object(name: string, namespace: string) {
  return { metadata: { name, namespace, uid: `${namespace}-${name}` } };
}

function list(...items: unknown[]): Answer {
  return { status: 200, body: { items } };
}

function path(family: Family, namespace: string): string {
  return `/apis/velero.io/v1/namespaces/${namespace}/${RESOURCES[family]}`;
}

const answers: Record<string, Answer> = {
  [DISCOVERY]: { status: 200, body: { resources: Object.values(RESOURCES).map((name) => ({ name })) } },
  [LOCATIONS]: list(object("default", "velero-a"), object("default", "velero-b")),
  ...Object.fromEntries(
    ["velero-a", "velero-b"].flatMap((namespace) => [
      [path("backups", namespace), list()],
      [path("restores", namespace), list()],
      [path("schedules", namespace), list()],
      [path("storageLocations", namespace), list(object("default", namespace))],
      [path("snapshotLocations", namespace), list()],
    ]),
  ),
};

function gateClient(connection?: Connection) {
  let state: GateState = {
    cluster: { id: "cluster-a", name: "local-demo", context: "kind-local-demo" },
    writes: { on: false },
  };
  const client: GateClient = {
    state: async () => ({ ok: true, value: state }),
    enable: async (_cluster, namespace) => {
      state = {
        ...state,
        writes: { on: true, namespace, since: 1_700_000_000_000 },
        ...(connection ? { connection } : {}),
      };
      return { ok: true, value: state };
    },
    disable: async () => {
      state = { ...state, writes: { on: false } };
      return { ok: true, value: state };
    },
    onChanged: () => () => undefined,
  };

  return client;
}

const Bar = observer(({ installation }: { installation: Installation }) => {
  React.useEffect(() => {
    void installation.open();
  }, [installation]);
  return <TargetBar installation={installation} />;
});

function mount(gate?: GateClient, selected = "velero-a") {
  const installation = new Installation({
    cluster: { id: "cluster-a", name: "local-demo" },
    read: async (asked) => answers[asked] ?? { status: 404 },
    now: () => 1000,
    storage: heldPreferences({ ...emptyPreferences(), selected: selected ? { "cluster-a": selected } : {} }),
    gate,
  });

  render(<Bar installation={installation} />);
  return installation;
}

afterEach(() => {
  cleanup();
  confirmDialogs.length = 0;
});

describe("the writes in the target bar", () => {
  it("says that writes are off, and turns them on through the dialog of the host that names the installation", async () => {
    const installation = mount(gateClient());

    await waitFor(() => expect(screen.getByTestId("velero-writes-state").textContent).toBe("Off"));
    expect(screen.getByTestId("velero-writes").getAttribute("data-writes")).toBe("off");
    await waitFor(() => expect(screen.getByTestId("velero-writes-on")).toBeTruthy());
    fireEvent.click(screen.getByTestId("velero-writes-on"));
    expect(confirmDialogs).toHaveLength(1);
    const dialog = confirmDialogs[0];
    const words = writesDialogWords("velero-a", "local-demo", "kind-local-demo");

    expect(dialog.labelOk).toBe("Turn writes on");
    expect(dialog.labelCancel).toBe("Keep writes off");
    render(<div data-testid="dialog">{dialog.message}</div>);
    expect(screen.getByTestId("velero-writes-dialog").textContent).toContain(words.first);
    expect(screen.getByTestId("velero-writes-dialog").textContent).toContain(words.second);
    expect(words.first).toContain("velero-a");
    expect(words.first).toContain("local-demo");
    expect(words.first).toContain("kind-local-demo");
    expect(words.second).toContain("DownloadRequest");
    expect(words.second).toContain("ServerStatusRequest");
    // Nothing is on before the dialog is answered.
    expect(installation.writes).toEqual({ on: false });
    await act(async () => {
      await dialog.ok?.();
    });
    await waitFor(() => expect(screen.getByTestId("velero-writes").getAttribute("data-writes")).toBe("on"));
    expect(screen.getByTestId("velero-writes-state").textContent).toContain("On for velero-a since");
    fireEvent.click(screen.getByTestId("velero-writes-off"));
    await waitFor(() => expect(screen.getByTestId("velero-writes-state").textContent).toBe("Off"));
  });

  it("offers no command while no installation is selected", async () => {
    mount(gateClient(), "");

    await waitFor(() => expect(screen.getByTestId("velero-writes-state").textContent).toBe("Off"));
    expect(screen.queryByTestId("velero-writes-on")).toBeNull();
    expect(screen.queryByTestId("velero-writes-off")).toBeNull();
  });

  it("says which connection the writes cannot use, when the main process says so", async () => {
    mount(gateClient({ supported: false, reason: "proxy" }));

    await waitFor(() => expect(screen.getByTestId("velero-writes-on")).toBeTruthy());
    fireEvent.click(screen.getByTestId("velero-writes-on"));
    await act(async () => {
      await confirmDialogs[0].ok?.();
    });
    await waitFor(() => expect(screen.getByTestId("velero-writes-connection").textContent).toContain("proxy"));
  });

  it("says that writes cannot be turned on when the views have no way to the main process", async () => {
    mount(undefined);

    await waitFor(() => expect(screen.getByTestId("velero-writes-failure").textContent).toContain("no way"));
    expect(screen.queryByTestId("velero-writes-on")).toBeNull();
  });

  it("gives words to every reason a connection is refused for", () => {
    const reasons: Exclude<Connection, { supported: true }>["reason"][] = [
      "entry",
      "file",
      "context",
      "auth-provider",
      "proxy",
      "basic",
      "insecure-tls",
      "no-credential",
    ];

    for (const reason of reasons) expect(CONNECTION_REASONS[reason].length).toBeGreaterThan(20);
    expect(CONNECTION_REASONS["insecure-tls"]).toContain("never");
  });
});
