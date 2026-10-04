// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { confirmDialogs } from "../../../test/host-components";
import { emptyPreferences, heldPreferences, RESOURCES } from "../../common/discovery";
import { REQUEST_LABELS } from "../../common/ipc";
import { REVIEWED_RELEASE } from "../../common/types";
import { closeViews } from "../navigation";
import { Installation } from "../state/installation";
import { OverviewPage } from "./overview-page";

import type { Answer, Family } from "../../common/discovery";
import type { Failure, GateState, Answer as IpcAnswer, ServerStatusValue } from "../../common/ipc";
import type { GateClient, WriteClient } from "../api/ipc";

const DISCOVERY = "/apis/velero.io/v1";
const LOCATIONS = "/apis/velero.io/v1/backupstoragelocations";
const A = "velero-a";
const B = "velero-b";
const extension = { name: "@freelensapp/velero-extension" };

function path(family: Family, namespace: string): string {
  return `/apis/velero.io/v1/namespaces/${namespace}/${RESOURCES[family]}`;
}

function list(...items: unknown[]): Answer {
  return { status: 200, body: { items } };
}

const location = (name: string, namespace: string, provider: string) => ({
  apiVersion: "velero.io/v1",
  kind: "BackupStorageLocation",
  metadata: { name, namespace, uid: `${namespace}-${name}` },
  spec: { provider, objectStorage: { bucket: "bucket" } },
  status: { phase: "Available", lastValidationTime: new Date().toISOString() },
});

function answers(more: Record<string, Answer> = {}): Record<string, Answer> {
  return {
    [DISCOVERY]: { status: 200, body: { resources: Object.values(RESOURCES).map((name) => ({ name })) } },
    [LOCATIONS]: list(location("default", A, "aws"), location("default", B, "aws")),
    ...Object.fromEntries(
      [A, B].flatMap((namespace) => [
        [path("backups", namespace), list()],
        [path("restores", namespace), list()],
        [path("schedules", namespace), list()],
        [
          path("storageLocations", namespace),
          namespace === A
            ? list(location("default", A, "aws"), location("cold", A, "gcp"))
            : list(location("default", B, "aws")),
        ],
        [path("snapshotLocations", namespace), list()],
      ]),
    ),
    ...more,
  };
}

const VALUE: ServerStatusValue = {
  version: REVIEWED_RELEASE,
  processed: "2026-09-30T10:00:00Z",
  // In no order, as the object lists them.
  plugins: [
    { name: "velero.io/pod", kind: "BackupItemAction" },
    { name: "velero.io/aws", kind: "VolumeSnapshotter" },
    { name: "velero.io/aws", kind: "ObjectStore" },
    { name: "velero.io/crd-remap-version", kind: "BackupItemAction" },
    { name: "example.io/odd", kind: "Unheard" },
  ],
  request: { name: "freelens-velero-abcde", uid: "request-uid" },
};

// The main process: the gate and the writes, whose runs wait until the test answers them.
function mainProcess() {
  let state: GateState = {
    cluster: { id: "cluster-a", name: "local-demo", context: "kind-local-demo" },
    writes: { on: false },
  };
  const asked: string[] = [];
  const runs: ((answer: IpcAnswer<ServerStatusValue>) => void)[] = [];
  let tokens = 0;
  const gate: GateClient = {
    state: async () => ({ ok: true, value: state }),
    enable: async (_cluster, namespace) => {
      state = { ...state, writes: { on: true, namespace, since: 1_700_000_000_000 } };
      return { ok: true, value: state };
    },
    disable: async () => {
      asked.push("disable");
      state = { ...state, writes: { on: false } };
      return { ok: true, value: state };
    },
    onChanged: () => () => undefined,
  };
  const writer: WriteClient = {
    confirm: async (_cluster, namespace, kind, target) => {
      asked.push(`confirm ${namespace} ${kind}${target ? " with a target" : ""}`);
      tokens += 1;
      return {
        ok: true,
        value: { token: `00000000-0000-4000-8000-${String(tokens).padStart(12, "0")}`, expires: Date.now() + 30_000 },
      };
    },
    runServerStatus: (_cluster, namespace) => {
      asked.push(`run ${namespace}`);
      return new Promise((resolve) => runs.push(resolve));
    },
    status: async () => ({ ok: true, value: { step: "waiting" } }),
    cancel: async () => ({ ok: true, value: null }),
  };

  return {
    gate,
    writer,
    asked,
    answer: async (answer: IpcAnswer<ServerStatusValue>) => {
      const resolve = runs.shift();

      if (!resolve) throw new Error("No run waits");
      await act(async () => {
        resolve(answer);
        await new Promise((done) => setTimeout(done, 0));
      });
    },
  };
}

function mount(table = answers()) {
  const main = mainProcess();
  const installation = new Installation({
    cluster: { id: "cluster-a", name: "local-demo" },
    read: async (address) => table[address] ?? { status: 404 },
    now: () => Date.now(),
    storage: heldPreferences({ ...emptyPreferences(), selected: { "cluster-a": A } }),
    gate: main.gate,
    writer: main.writer,
  });
  const view = render(<OverviewPage extension={extension} installation={installation} />);

  return { installation, main, view };
}

const band = () => screen.getByTestId("velero-overview-server");
const part = (id: string) => screen.getByTestId(`velero-overview-server-${id}`);
const maybe = (id: string) => screen.queryByTestId(`velero-overview-server-${id}`);

async function opened() {
  await screen.findByTestId("velero-overview");
  await waitFor(() =>
    expect(screen.getByTestId("velero-overview-read-backups").getAttribute("data-read")).toBe("read"),
  );
  await waitFor(() => expect(screen.getByTestId("velero-writes-state").textContent).not.toBe(""));
}

async function writesOn() {
  await waitFor(() => expect(screen.getByTestId("velero-writes-on")).toBeTruthy());
  fireEvent.click(screen.getByTestId("velero-writes-on"));
  await act(async () => {
    await confirmDialogs.at(-1)?.ok?.();
  });
  await waitFor(() => expect(screen.getByTestId("velero-writes").getAttribute("data-writes")).toBe("on"));
}

async function read(main: ReturnType<typeof mainProcess>, value: ServerStatusValue = VALUE) {
  fireEvent.click(part("create"));
  await waitFor(() => expect(maybe("confirm")).toBeTruthy());
  fireEvent.click(part("confirm-create"));
  await waitFor(() => expect(main.asked.at(-1)).toBe(`run ${A}`));
  await main.answer({ ok: true, value });
  await waitFor(() => expect(maybe("version")).toBeTruthy());
}

afterEach(() => {
  act(() => closeViews());
  cleanup();
  confirmDialogs.length = 0;
});

describe("the band of the server", () => {
  it("comes after what was read, says that the version is not read, and with writes off leads to the target bar and creates nothing", async () => {
    const { main } = mount();

    await opened();
    const overview = screen.getByTestId("velero-overview");
    const order = [...overview.querySelectorAll("[data-testid^=velero-overview-]")]
      .map((element) => element.getAttribute("data-testid"))
      .filter(
        (id) => id === "velero-overview-read" || id === "velero-overview-server" || id === "velero-overview-attention",
      );

    expect(order).toEqual(["velero-overview-read", "velero-overview-server", "velero-overview-attention"]);
    expect(within(band()).getByRole("heading").textContent).toBe("Server");
    expect(part("body").getAttribute("data-server")).toBe("unread");
    expect(part("unread").textContent).toBe("The version of the server and its plugins are not read.");
    expect(part("writes-off").textContent).toBe(
      `Reading them creates a ServerStatusRequest in ${A}, which the server answers. Writes are off for this installation: they are turned on in the target bar.`,
    );
    expect(maybe("create")).toBeNull();
    fireEvent.click(part("to-target"));
    expect(document.activeElement?.getAttribute("data-testid")).toBe("velero-writes-on");
    // Nothing was asked of the main process: no confirmation and no request.
    expect(main.asked).toEqual([]);
  });

  it("offers the command in the name of the kind when writes are on, and asks nothing when the page opens", async () => {
    const { main } = mount();

    await opened();
    await writesOn();
    expect(maybe("writes-off")).toBeNull();
    expect(part("create").textContent).toBe("Create a ServerStatusRequest");
    expect(band().textContent).not.toMatch(/\b(load|read again)\b/i);
    expect(main.asked).toEqual([]);
  });

  it("shows inline the object as it will be submitted, and creates it only after the second gesture", async () => {
    const { main } = mount();

    await opened();
    await writesOn();
    fireEvent.click(part("create"));
    await waitFor(() => expect(maybe("confirm")).toBeTruthy());
    expect(main.asked).toEqual([`confirm ${A} ServerStatusRequest`]);
    // Inline, in the band: not a dialog.
    expect(band().contains(part("confirm"))).toBe(true);
    expect(confirmDialogs).toHaveLength(1);
    const facts = Object.fromEntries(
      [...part("confirm").querySelectorAll("[data-field]")].map((field) => [
        field.getAttribute("data-field"),
        field.querySelector("dd")?.textContent,
      ]),
    );

    expect(facts).toEqual({
      kind: "ServerStatusRequest (velero.io/v1)",
      name: "Generated by the API server, beginning with freelens-velero-",
      namespace: A,
      cluster: "local-demo (context kind-local-demo)",
      labels: Object.entries(REQUEST_LABELS)
        .map(([key, value]) => `${key}=${value}`)
        .join(", "),
      spec: "Empty",
      target: "None: the request is of the server, not of an object",
    });
    expect(facts.labels).toBe("app.kubernetes.io/managed-by=freelens-velero-extension");
    expect(part("confirm-create").textContent).toBe("Create the ServerStatusRequest");
    // Leaving the confirmation creates nothing.
    fireEvent.click(part("confirm-back"));
    expect(maybe("confirm")).toBeNull();
    expect(main.asked).toEqual([`confirm ${A} ServerStatusRequest`]);
    fireEvent.click(part("create"));
    await waitFor(() => expect(maybe("confirm")).toBeTruthy());
    fireEvent.click(part("confirm-create"));
    await waitFor(() => expect(maybe("running")).toBeTruthy());
    expect(part("running").textContent).toBe(
      "Creating the ServerStatusRequest and waiting for the server to answer, for ten seconds at most.",
    );
    expect(maybe("create")).toBeNull();
    expect(main.asked).toEqual([`confirm ${A} ServerStatusRequest`, `confirm ${A} ServerStatusRequest`, `run ${A}`]);
  });

  it("shows the version with its note, the time the server wrote, the plugins by kind and the providers of the locations", async () => {
    const { main } = mount();

    await opened();
    await writesOn();
    await read(main);
    expect(part("body").getAttribute("data-server")).toBe("read");
    expect(part("version").textContent).toBe(`Velero ${REVIEWED_RELEASE}`);
    expect(part("version").getAttribute("data-relation")).toBe("same");
    expect(part("note").textContent).toBe("This is the release the extension was reviewed against.");
    expect(part("processed").textContent).toBe(
      `Processed by the server at ${new Date("2026-09-30T10:00:00Z").toLocaleString()}`,
    );
    expect(part("plugins-count").textContent).toBe("5 plugins loaded.");
    const kinds = [...part("plugins").querySelectorAll("[data-kind]")].map((row) => [
      row.getAttribute("data-kind"),
      row.getAttribute("data-count"),
      [...row.querySelectorAll("[data-plugin]")].map((plugin) => plugin.textContent),
    ]);

    expect(kinds).toEqual([
      ["ObjectStore", "1", ["velero.io/aws"]],
      ["VolumeSnapshotter", "1", ["velero.io/aws"]],
      ["BackupItemAction", "2", ["velero.io/crd-remap-version", "velero.io/pod"]],
      ["BackupItemActionV2", "0", []],
      ["RestoreItemAction", "0", []],
      ["RestoreItemActionV2", "0", []],
      ["DeleteItemAction", "0", []],
      ["ItemBlockAction", "0", []],
      ["Unheard", "1", ["example.io/odd"]],
    ]);
    // Beside the object store plugins, the providers of the locations the installation read.
    const objectStore = part("plugins").querySelector('[data-kind="ObjectStore"]') as HTMLElement;
    const providers = [...objectStore.querySelectorAll("[data-provider]")].map((line) => [
      line.getAttribute("data-provider"),
      line.getAttribute("data-loaded"),
      line.textContent,
    ]);

    expect(providers).toEqual([
      ["aws", "true", "aws, of default: needs velero.io/aws, which is loaded"],
      ["gcp", "false", "gcp, of cold: needs velero.io/gcp, which is not loaded"],
    ]);
    expect(part("request").textContent).toBe(
      "The server deletes the request freelens-velero-abcde when it looks at it again, five minutes after it processed it.",
    );
    expect(part("create").textContent).toBe("Create another ServerStatusRequest");
  });

  it.each([
    ["v1.18.4", "series", "This is the series v1.18 the extension was reviewed against"],
    ["v1.19.0", "other", "a newer series than the release the extension was reviewed against"],
    ["v1.17.1", "other", "an older series"],
    ["v1.18.2-rc.1", "series", "runs the patch v1.18.2-rc.1"],
    ["main-build", "unknown", "it is shown as the server wrote it, with no comparison"],
  ])("says of the version %s how it stands against the reviewed release", async (version, relation, words) => {
    const { main } = mount();

    await opened();
    await writesOn();
    await read(main, { ...VALUE, version });
    expect(part("version").textContent).toBe(`Velero ${version}`);
    expect(part("version").getAttribute("data-relation")).toBe(relation);
    expect(part("note").textContent).toContain(words);
  });

  it("shows a time the server wrote that is not one as it is written", async () => {
    const { main } = mount();

    await opened();
    await writesOn();
    await read(main, { ...VALUE, processed: "yesterday" });
    expect(part("processed").textContent).toBe("Processed by the server at yesterday");
  });

  it("says that the providers are not known when the storage locations were not read", async () => {
    const { main } = mount(answers({ [path("storageLocations", A)]: { status: 403 } }));

    await opened();
    await writesOn();
    await read(main);
    expect(part("providers-unknown").textContent).toBe(
      "The providers of the storage locations are not known: the storage locations were not read.",
    );
  });

  it("keeps what was read through a read of the Overview and a visit to another page, and drops it with the installation", async () => {
    const { main, installation, view } = mount();

    await opened();
    await writesOn();
    await read(main);
    await act(() => installation.refresh());
    expect(part("version").textContent).toBe(`Velero ${REVIEWED_RELEASE}`);
    // Another page, then the Overview again.
    view.unmount();
    render(<OverviewPage extension={extension} installation={installation} />);
    await opened();
    expect(part("version").textContent).toBe(`Velero ${REVIEWED_RELEASE}`);
    expect(main.asked.filter((call) => call.startsWith("run"))).toHaveLength(1);
    // Another installation: nothing of the one before.
    act(() => installation.select(B));
    await waitFor(() => expect(part("body").getAttribute("data-server")).toBe("unread"));
    expect(maybe("version")).toBeNull();
  });

  it("reads again as a new request, keeping what was read until it answers", async () => {
    const { main } = mount();

    await opened();
    await writesOn();
    await read(main);
    fireEvent.click(part("create"));
    await waitFor(() => expect(maybe("confirm")).toBeTruthy());
    expect(part("version").textContent).toBe(`Velero ${REVIEWED_RELEASE}`);
    fireEvent.click(part("confirm-create"));
    await waitFor(() => expect(main.asked.filter((call) => call.startsWith("run"))).toHaveLength(2));
    await main.answer({ ok: true, value: { ...VALUE, version: "v1.18.4" } });
    await waitFor(() => expect(part("version").textContent).toBe("Velero v1.18.4"));
  });

  it("says that the server did not answer, in the words of the main process, and that the request stays", async () => {
    const { main } = mount();
    const deadline: Failure = {
      ok: false,
      code: "deadline",
      stage: "wait",
      retry: true,
      text: "The server did not answer in ten seconds: it may be stopped, or busy. The request stays until the server processes it.",
    };

    await opened();
    await writesOn();
    fireEvent.click(part("create"));
    await waitFor(() => expect(maybe("confirm")).toBeTruthy());
    fireEvent.click(part("confirm-create"));
    await waitFor(() => expect(maybe("running")).toBeTruthy());
    await main.answer(deadline);
    await waitFor(() => expect(maybe("failure")).toBeTruthy());
    expect(part("failure").getAttribute("data-code")).toBe("deadline");
    expect(part("failure-text").textContent).toBe(deadline.text);
    expect(part("failure-deletion").textContent).toBe(
      "When the server processes it, it deletes it when it looks at it again, five minutes after.",
    );
    expect(band().textContent).not.toMatch(/\bdown\b/i);
    expect(part("create").textContent).toBe("Create another ServerStatusRequest");
  });

  it("says that the API refused the creation, with its words, and writes stay on", async () => {
    const { main } = mount();
    const forbidden: Failure = {
      ok: false,
      code: "forbidden",
      stage: "creation",
      retry: false,
      text: "The cluster refused the creation of a ServerStatusRequest: the identity needs the verb create on serverstatusrequests of the namespace.",
    };

    await opened();
    await writesOn();
    fireEvent.click(part("create"));
    await waitFor(() => expect(maybe("confirm")).toBeTruthy());
    fireEvent.click(part("confirm-create"));
    await waitFor(() => expect(maybe("running")).toBeTruthy());
    await main.answer(forbidden);
    await waitFor(() => expect(maybe("failure")).toBeTruthy());
    expect(part("failure").getAttribute("data-code")).toBe("forbidden");
    expect(part("failure-text").textContent).toBe(forbidden.text);
    expect(maybe("failure-deletion")).toBeNull();
    expect(screen.getByTestId("velero-writes").getAttribute("data-writes")).toBe("on");
    expect(main.asked).not.toContain("disable");
    expect(part("create")).toBeTruthy();
  });

  it.each([
    ["cancelled", "The wait was cancelled. The request stays until the server processes it."],
    ["submission-unknown", "The creation of the request may have happened: look for it before asking again."],
    ["target-changed", "The cluster or the installation changed while the request was made."],
    ["transport-unreachable", "The API server of the cluster could not be reached."],
    ["tls-invalid", "The certificate of the API server of the cluster is not trusted."],
    ["request-failed", "The request could not be made, for a reason the extension does not name."],
  ] as const)("says the failure %s in the words of its code", async (code, text) => {
    const { main } = mount();

    await opened();
    await writesOn();
    fireEvent.click(part("create"));
    await waitFor(() => expect(maybe("confirm")).toBeTruthy());
    fireEvent.click(part("confirm-create"));
    await waitFor(() => expect(maybe("running")).toBeTruthy());
    await main.answer({ ok: false, code, stage: "wait", retry: false, text });
    await waitFor(() => expect(maybe("failure")).toBeTruthy());
    expect(part("failure").getAttribute("data-code")).toBe(code);
    expect(part("failure-text").textContent).toBe(text);
  });

  it("goes back to the state of writes off when they are turned off while the confirmation is shown", async () => {
    const { main } = mount();

    await opened();
    await writesOn();
    fireEvent.click(part("create"));
    await waitFor(() => expect(maybe("confirm")).toBeTruthy());
    fireEvent.click(screen.getByTestId("velero-writes-off"));
    await waitFor(() => expect(maybe("writes-off")).toBeTruthy());
    expect(maybe("confirm")).toBeNull();
    expect(main.asked.filter((call) => call.startsWith("run"))).toEqual([]);
  });
});
