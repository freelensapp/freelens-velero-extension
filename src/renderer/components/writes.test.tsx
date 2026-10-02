// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { observer } from "mobx-react";
import React from "react";
import { afterEach, describe, expect, it } from "vitest";
import { confirmDialogs } from "../../../test/host-components";
import { emptyPreferences, heldPreferences, RESOURCES } from "../../common/discovery";
import { CONNECTION_REASON_NAMES } from "../../common/ipc";
import { Installation } from "../state/installation";
import { CONNECTION_REASONS, TargetBar, writesDialogWords } from "./target-bar";

import type { Answer, Family } from "../../common/discovery";
import type { Connection, Failure, GateState } from "../../common/ipc";
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

const LOST: Failure = {
  ok: false,
  code: "request-failed",
  stage: "way",
  retry: true,
  text: "The main process did not answer.",
};

// The main process, as the views see it. The calls named in lost are not answered: what they asked is not
// done, and the answer that arrives is a failure of the way, until the test takes them out.
function gateClient(connection?: Connection, lost = new Set<"state" | "disable">()) {
  let state: GateState = {
    cluster: { id: "cluster-a", name: "local-demo", context: "kind-local-demo" },
    writes: { on: false },
  };
  const client: GateClient = {
    state: async () => (lost.has("state") ? LOST : { ok: true, value: state }),
    enable: async (_cluster, namespace) => {
      if (connection && !connection.supported) {
        state = { ...state, writes: { on: false }, connection };
        return {
          ok: false,
          code: "connection-unsupported",
          stage: "connection",
          retry: false,
          text: CONNECTION_REASONS[connection.reason],
        };
      }
      state = {
        ...state,
        writes: { on: true, namespace, since: 1_700_000_000_000 },
        ...(connection ? { connection } : {}),
      };
      return { ok: true, value: state };
    },
    disable: async () => {
      if (lost.has("disable")) return LOST;
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
    const installation = mount(gateClient(), "");

    // The main process answered: what is not offered is not offered because nothing is selected.
    await waitFor(() => expect(installation.gate).toBeDefined());
    await waitFor(() => expect(installation.api.state).toBe("served"));
    expect(screen.getByTestId("velero-writes-state").textContent).toBe("Off");
    expect(screen.queryByTestId("velero-writes-on")).toBeNull();
    expect(screen.queryByTestId("velero-writes-off")).toBeNull();
    act(() => installation.select("velero-a"));
    await waitFor(() => expect(screen.getByTestId("velero-writes-on")).toBeTruthy());
  });

  it("does not say off when turning writes off was not answered, and asks again on request", async () => {
    const lost = new Set<"state" | "disable">();

    mount(gateClient(undefined, lost));
    await waitFor(() => expect(screen.getByTestId("velero-writes-on")).toBeTruthy());
    fireEvent.click(screen.getByTestId("velero-writes-on"));
    await act(async () => {
      await confirmDialogs[0].ok?.();
    });
    await waitFor(() => expect(screen.getByTestId("velero-writes").getAttribute("data-writes")).toBe("on"));
    lost.add("disable");
    fireEvent.click(screen.getByTestId("velero-writes-off"));
    await waitFor(() => expect(screen.getByTestId("velero-writes").getAttribute("data-writes")).toBe("unknown"));
    expect(screen.getByTestId("velero-writes-state").textContent).toBe("Not known");
    expect(screen.getByTestId("velero-writes-failure").textContent).toBe("The main process did not answer.");
    expect(screen.queryByTestId("velero-writes-on")).toBeNull();
    // The main process still holds writes on: asked again, it says so.
    fireEvent.click(screen.getByTestId("velero-writes-ask"));
    await waitFor(() => expect(screen.getByTestId("velero-writes-state").textContent).toContain("On for velero-a"));
    expect(screen.queryByTestId("velero-writes-failure")).toBeNull();
    // Turning them off again, when the main process answers, says off.
    lost.delete("disable");
    fireEvent.click(screen.getByTestId("velero-writes-off"));
    await waitFor(() => expect(screen.getByTestId("velero-writes-state").textContent).toBe("Off"));
  });

  it("offers to turn writes off again while their state is not known", async () => {
    const lost = new Set<"state" | "disable">();

    mount(gateClient(undefined, lost));
    await waitFor(() => expect(screen.getByTestId("velero-writes-on")).toBeTruthy());
    fireEvent.click(screen.getByTestId("velero-writes-on"));
    await act(async () => {
      await confirmDialogs[0].ok?.();
    });
    await waitFor(() => expect(screen.getByTestId("velero-writes").getAttribute("data-writes")).toBe("on"));
    lost.add("disable");
    fireEvent.click(screen.getByTestId("velero-writes-off"));
    await waitFor(() => expect(screen.getByTestId("velero-writes").getAttribute("data-writes")).toBe("unknown"));
    lost.delete("disable");
    fireEvent.click(screen.getByTestId("velero-writes-off"));
    await waitFor(() => expect(screen.getByTestId("velero-writes-state").textContent).toBe("Off"));
    expect(screen.getByTestId("velero-writes-on")).toBeTruthy();
  });

  it("keeps the control usable when the state could not be asked when the bar opened", async () => {
    const lost = new Set<"state" | "disable">(["state"]);

    mount(gateClient(undefined, lost));
    await waitFor(() =>
      expect(screen.getByTestId("velero-writes-failure").textContent).toBe("The main process did not answer."),
    );
    expect(screen.getByTestId("velero-writes-state").textContent).toBe("Not known");
    lost.delete("state");
    fireEvent.click(screen.getByTestId("velero-writes-ask"));
    await waitFor(() => expect(screen.getByTestId("velero-writes-on")).toBeTruthy());
    expect(screen.getByTestId("velero-writes-state").textContent).toBe("Off");
    expect(screen.queryByTestId("velero-writes-failure")).toBeNull();
  });

  it("says which connection the writes cannot use, when the main process says so", async () => {
    mount(gateClient({ supported: false, reason: "proxy" }));

    await waitFor(() => expect(screen.getByTestId("velero-writes-on")).toBeTruthy());
    fireEvent.click(screen.getByTestId("velero-writes-on"));
    await act(async () => {
      await confirmDialogs[0].ok?.();
    });
    // The main process refused: writes are off, which is known, with the reason, and can be asked again.
    await waitFor(() => expect(screen.getByTestId("velero-writes-failure").textContent).toContain("proxy"));
    expect(screen.getByTestId("velero-writes").getAttribute("data-writes")).toBe("off");
    expect(screen.getByTestId("velero-writes-state").textContent).toBe("Off");
    expect(screen.getByTestId("velero-writes-on")).toBeTruthy();
    expect(screen.queryByTestId("velero-writes-connection")).toBeNull();
  });

  it("says that writes cannot be turned on when the views have no way to the main process", async () => {
    mount(undefined);

    await waitFor(() => expect(screen.getByTestId("velero-writes-failure").textContent).toContain("no way"));
    expect(screen.queryByTestId("velero-writes-on")).toBeNull();
  });

  it("gives words to every reason a connection is refused for", () => {
    const reasons = CONNECTION_REASON_NAMES;

    expect(Object.keys(CONNECTION_REASONS).sort()).toEqual([...reasons].sort());
    for (const reason of reasons) expect(CONNECTION_REASONS[reason].length).toBeGreaterThan(20);
    expect(CONNECTION_REASONS["insecure-tls"]).toContain("never");
  });
});
