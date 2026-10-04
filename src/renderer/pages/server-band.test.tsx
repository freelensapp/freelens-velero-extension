// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { confirmDialogs } from "../../../test/host-components";
import { emptyPreferences, heldPreferences, RESOURCES } from "../../common/discovery";
import { REQUEST_LABELS, REQUEST_PREFIX } from "../../common/ipc";
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

const location = (name: string, namespace: string, provider?: string) => ({
  apiVersion: "velero.io/v1",
  kind: "BackupStorageLocation",
  metadata: { name, namespace, uid: `${namespace}-${name}` },
  spec: { ...(provider === undefined ? {} : { provider }), objectStorage: { bucket: "bucket" } },
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
            ? list(location("default", A, "aws"), location("second", A, "aws"), location("cold", A, "gcp"))
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

const DEADLINE: Failure = {
  ok: false,
  code: "deadline",
  stage: "wait",
  retry: true,
  text: "The server did not answer in ten seconds: it may be stopped, or busy. The request stays until the server processes it.",
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
  let lost = false;
  const gate: GateClient = {
    state: async () =>
      lost
        ? { ok: false, code: "request-failed", stage: "way", retry: true, text: "The main process did not answer." }
        : { ok: true, value: state },
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
    runs: () => asked.filter((call) => call.startsWith("run")),
    // The answers of the main process about the gate are lost from now on.
    lose: () => {
      lost = true;
    },
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

function mount(table = answers(), main = mainProcess()) {
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
const focused = () => document.activeElement?.getAttribute("data-testid");

// The words of a part, without the names of its marks, which the host draws as icons.
function words(element: Element): string {
  const copy = element.cloneNode(true) as Element;

  for (const mark of copy.querySelectorAll(".Icon")) mark.remove();
  return (copy.textContent ?? "").replace(/\s+/g, " ").trim();
}

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

// The two gestures, up to the request that runs.
async function ask(main: ReturnType<typeof mainProcess>) {
  const runs = main.runs().length;

  fireEvent.click(part("create"));
  await waitFor(() => expect(maybe("confirm")).toBeTruthy());
  fireEvent.click(part("confirm-create"));
  await waitFor(() => expect(main.runs()).toHaveLength(runs + 1));
}

async function read(main: ReturnType<typeof mainProcess>, value: ServerStatusValue = VALUE) {
  await ask(main);
  await main.answer({ ok: true, value });
  await waitFor(() => expect(part("body").getAttribute("data-step")).toBe("idle"));
}

async function fail(main: ReturnType<typeof mainProcess>, failure: Failure) {
  await ask(main);
  await main.answer(failure);
  await waitFor(() => expect(maybe("failure")).toBeTruthy());
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
      `Asking the server for them creates a ServerStatusRequest in ${A}, which the server answers. Writes are off for this installation: they are turned on in the target bar.`,
    );
    expect(maybe("create")).toBeNull();
    fireEvent.click(part("to-target"));
    expect(focused()).toBe("velero-writes-on");
    // Nothing was asked of the main process: no confirmation and no request.
    expect(main.asked).toEqual([]);
  });

  it("says that the state of the writes is not known when the main process did not answer, and leads to what asks it again", async () => {
    const main = mainProcess();

    main.lose();
    mount(answers(), main);
    await opened();
    await waitFor(() => expect(screen.getByTestId("velero-writes").getAttribute("data-writes")).toBe("unknown"));
    expect(part("writes-off").textContent).toBe(
      `Asking the server for them creates a ServerStatusRequest in ${A}, which the server answers. Whether writes are on is not known: the target bar asks the main process again.`,
    );
    expect(maybe("create")).toBeNull();
    fireEvent.click(part("to-target"));
    expect(focused()).toBe("velero-writes-ask");
  });

  it("offers the command in the name of the kind when writes are on, says what it does, and asks nothing when the page opens", async () => {
    const { main } = mount();

    await opened();
    await writesOn();
    expect(maybe("writes-off")).toBeNull();
    expect(part("what").textContent).toBe(
      `Asking the server for them creates a ServerStatusRequest in ${A}, which the server answers.`,
    );
    expect(words(part("create"))).toBe("Create a ServerStatusRequest");
    // Every command of the band names what it creates, or leaves it: none loads or reads alone.
    for (const command of band().querySelectorAll("button")) {
      expect(words(command)).toMatch(/ServerStatusRequest|target bar/);
      expect(words(command)).not.toMatch(/\b(load|read|show|get|refresh)\b/i);
    }
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
    expect(part("confirm").getAttribute("aria-label")).toBe("The ServerStatusRequest that will be created");
    const facts = Object.fromEntries(
      [...part("confirm").querySelectorAll("[data-field]")].map((field) => [
        field.getAttribute("data-field"),
        field.querySelector("dd")?.textContent,
      ]),
    );

    expect(facts).toEqual({
      kind: "ServerStatusRequest (velero.io/v1)",
      name: `Generated by the API server, beginning with ${REQUEST_PREFIX}`,
      namespace: A,
      cluster: "local-demo (context kind-local-demo)",
      labels: Object.entries(REQUEST_LABELS)
        .map(([key, value]) => `${key}=${value}`)
        .join(", "),
      spec: "Empty",
      target: "None: the request is of the server, not of an object",
    });
    expect(facts.name).toBe("Generated by the API server, beginning with freelens-velero-");
    expect(facts.labels).toBe("app.kubernetes.io/managed-by=freelens-velero-extension");
    expect(words(part("confirm-create"))).toBe("Create the ServerStatusRequest");
    expect(words(part("confirm-back"))).toBe("Do not create it");
    // The command that asked is not offered beside its confirmation.
    expect(maybe("create")).toBeNull();
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
    expect(part("running").getAttribute("role")).toBe("status");
    expect(maybe("create")).toBeNull();
    expect(maybe("confirm")).toBeNull();
    expect(main.asked).toEqual([`confirm ${A} ServerStatusRequest`, `confirm ${A} ServerStatusRequest`, `run ${A}`]);
  });

  it("gives the focus to what takes the place of the command that was used, and never to the command that creates", async () => {
    const { main } = mount();

    await opened();
    await writesOn();
    part("create").focus();
    fireEvent.click(part("create"));
    await waitFor(() => expect(maybe("confirm")).toBeTruthy());
    // The confirmation itself: the key that asked is not the one that confirms.
    await waitFor(() => expect(focused()).toBe("velero-overview-server-confirm"));
    part("confirm-back").focus();
    fireEvent.click(part("confirm-back"));
    await waitFor(() => expect(focused()).toBe("velero-overview-server-create"));
    fireEvent.click(part("create"));
    await waitFor(() => expect(focused()).toBe("velero-overview-server-confirm"));
    part("confirm-create").focus();
    fireEvent.click(part("confirm-create"));
    await waitFor(() => expect(main.runs()).toHaveLength(1));
    await main.answer({ ok: true, value: VALUE });
    // The answer is under the command that reads again.
    await waitFor(() => expect(focused()).toBe("velero-overview-server-create"));
    expect(part("version").getAttribute("role")).toBe("status");
  });

  it("leaves the focus where the operator moved it while the server was asked", async () => {
    const { main } = mount();

    await opened();
    await writesOn();
    await ask(main);
    screen.getByTestId("velero-refresh").focus();
    await main.answer({ ok: true, value: VALUE });
    await waitFor(() => expect(maybe("version")).toBeTruthy());
    expect(focused()).toBe("velero-refresh");
  });

  it("shows the version with its note, the time the server wrote, the plugins by kind and the providers of the locations", async () => {
    const { main } = mount();

    await opened();
    await writesOn();
    await read(main);
    expect(part("body").getAttribute("data-server")).toBe("read");
    expect(maybe("unread")).toBeNull();
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
    expect(part("plugins").querySelector('[data-kind="Unheard"]')?.textContent).toContain(
      "Not a kind of the reviewed release",
    );
    expect(part("plugins").querySelector('[data-kind="ObjectStore"]')?.textContent).not.toContain("Not a kind");
    expect(part("plugins").querySelector('[data-kind="ItemBlockAction"]')?.textContent).toContain("None loaded");
    // Beside the object store plugins, and nowhere else, the providers of the locations the installation read.
    expect(part("plugins").querySelectorAll("[data-provider]")).toHaveLength(2);
    const objectStore = part("plugins").querySelector('[data-kind="ObjectStore"]') as HTMLElement;
    const providers = [...objectStore.querySelectorAll("[data-provider]")].map((line) => [
      line.getAttribute("data-provider"),
      line.getAttribute("data-loaded"),
      line.querySelector(".Icon")?.textContent,
      words(line),
    ]);

    expect(providers).toEqual([
      [
        "aws",
        "true",
        "check",
        "The provider aws of the storage locations default, second needs the object store plugin velero.io/aws, which is loaded.",
      ],
      [
        "gcp",
        "false",
        "warning_amber",
        "The provider gcp of the storage location cold needs the object store plugin velero.io/gcp, which is not loaded.",
      ],
    ]);
    expect(part("request").textContent).toBe(
      "The server deletes the request freelens-velero-abcde when it looks at it again, five minutes after it processed it.",
    );
    expect(part("what").textContent).toBe(`Asking again creates another ServerStatusRequest in ${A}.`);
    expect(words(part("create"))).toBe("Create another ServerStatusRequest");
  });

  it.each([
    [[], "No plugin loaded."],
    [[{ name: "velero.io/aws", kind: "ObjectStore" }], "1 plugin loaded."],
  ])("counts the plugins the server loaded: %j", async (plugins, count) => {
    const { main } = mount();

    await opened();
    await writesOn();
    await read(main, { ...VALUE, plugins });
    expect(part("plugins-count").textContent).toBe(count);
  });

  it.each([
    [
      "v1.18.4",
      "series",
      "This server runs v1.18.4, of the series v1.18 the extension was reviewed against, in v1.18.2.",
    ],
    ["v1.19.0", "other", "a newer series than the release the extension was reviewed against"],
    ["v1.17.1", "other", "an older series"],
    [
      "v1.18.2-rc.1",
      "series",
      "This server runs v1.18.2-rc.1, of the series v1.18 the extension was reviewed against, in v1.18.2.",
    ],
    ["main-build", "unknown", "it is shown as the server wrote it, with no comparison"],
  ])("says of the version %s how it stands against the reviewed release", async (version, relation, text) => {
    const { main } = mount();

    await opened();
    await writesOn();
    await read(main, { ...VALUE, version });
    expect(part("version").textContent).toBe(`Velero ${version}`);
    expect(part("version").getAttribute("data-relation")).toBe(relation);
    expect(part("note").textContent).toContain(text);
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
    expect(maybe("providers")).toBeNull();
  });

  it("says that no storage location names a provider when none does", async () => {
    const { main } = mount(answers({ [path("storageLocations", A)]: list(location("default", A)) }));

    await opened();
    await writesOn();
    await read(main);
    expect(part("providers-none").textContent).toBe("No storage location of this installation names a provider.");
    expect(maybe("providers")).toBeNull();
    expect(maybe("providers-unknown")).toBeNull();
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
    expect(part("processed").textContent).toContain(new Date("2026-09-30T10:00:00Z").toLocaleString());
    expect(main.runs()).toHaveLength(1);
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
    await waitFor(() => expect(main.runs()).toHaveLength(2));
    expect(part("version").textContent).toBe(`Velero ${REVIEWED_RELEASE}`);
    await main.answer({ ok: true, value: { ...VALUE, version: "v1.18.4" } });
    await waitFor(() => expect(part("version").textContent).toBe("Velero v1.18.4"));
  });

  it("says that the server did not answer, in the words of the main process, and where the request stays", async () => {
    const { main } = mount();

    await opened();
    await writesOn();
    await fail(main, DEADLINE);
    expect(part("failure").getAttribute("data-code")).toBe("deadline");
    expect(part("failure").getAttribute("role")).toBe("alert");
    expect(part("failure-text").textContent).toBe(DEADLINE.text);
    expect(part("failure-request").textContent).toBe(
      `The request is a ServerStatusRequest of ${A} whose name begins with freelens-velero-. The extension deletes no request: the server deletes one when it looks at it again, five minutes after it processed it, and one that no server processes stays until someone removes it.`,
    );
    // Not answered is not a claim that the server is down.
    expect(band().textContent).not.toMatch(/\b(down|dead|broken|crashed)\b/i);
    expect(part("unread")).toBeTruthy();
    expect(part("what").textContent).toBe(`Asking again creates another ServerStatusRequest in ${A}.`);
    expect(words(part("create"))).toBe("Create another ServerStatusRequest");
  });

  it("keeps the version that was read beside a request the server did not answer", async () => {
    const { main } = mount();

    await opened();
    await writesOn();
    await read(main);
    await fail(main, DEADLINE);
    expect(part("version").textContent).toBe(`Velero ${REVIEWED_RELEASE}`);
    expect(part("failure-text").textContent).toBe(DEADLINE.text);
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
    await fail(main, forbidden);
    expect(part("failure").getAttribute("data-code")).toBe("forbidden");
    expect(part("failure").getAttribute("data-stage")).toBe("creation");
    expect(part("failure-text").textContent).toBe(forbidden.text);
    // Nothing was created: there is no request to say where it is.
    expect(maybe("failure-request")).toBeNull();
    expect(screen.getByTestId("velero-writes").getAttribute("data-writes")).toBe("on");
    expect(main.asked).not.toContain("disable");
    expect(part("what").textContent).toBe(
      `Asking the server for them creates a ServerStatusRequest in ${A}, which the server answers.`,
    );
    expect(words(part("create"))).toBe("Create a ServerStatusRequest");
  });

  it.each([
    ["cancelled", "wait", true, "The wait was cancelled. The request stays until the server processes it."],
    ["submission-unknown", "creation", true, "The creation of the request may have happened: look for it."],
    ["target-changed", "wait", true, "The cluster or the installation changed while the request was made."],
    ["transport-unreachable", "creation", false, "The API server of the cluster could not be reached."],
    ["tls-invalid", "creation", false, "The certificate of the API server of the cluster is not trusted."],
    ["request-failed", "credential", false, "The credential plugin kubelogin of the context did not give one."],
  ] as const)(
    "says the failure %s at the stage %s in the words of the main process",
    async (code, stage, another, text) => {
      const { main } = mount();

      await opened();
      await writesOn();
      await fail(main, { ok: false, code, stage, retry: false, text });
      expect(part("failure").getAttribute("data-code")).toBe(code);
      expect(part("failure").getAttribute("data-stage")).toBe(stage);
      expect(part("failure-text").textContent).toBe(text);
      // Where the request is, is said of one that was created, and of no other.
      expect(maybe("failure-request") !== null).toBe(stage === "wait");
      // A request may be there already: the command says that it creates another.
      expect(words(part("create"))).toBe(
        another ? "Create another ServerStatusRequest" : "Create a ServerStatusRequest",
      );
    },
  );

  it("goes back to the state of writes off when they are turned off while the confirmation is shown, and does not show it again", async () => {
    const { main } = mount();

    await opened();
    await writesOn();
    fireEvent.click(part("create"));
    await waitFor(() => expect(maybe("confirm")).toBeTruthy());
    fireEvent.click(screen.getByTestId("velero-writes-off"));
    await waitFor(() => expect(maybe("writes-off")).toBeTruthy());
    expect(maybe("confirm")).toBeNull();
    // On again: the confirmation of before is not the one of these writes.
    await writesOn();
    expect(maybe("confirm")).toBeNull();
    expect(words(part("create"))).toBe("Create a ServerStatusRequest");
    expect(main.runs()).toEqual([]);
  });

  it("leaves a confirmation with the page that shows it", async () => {
    const { main, installation, view } = mount();

    await opened();
    await writesOn();
    fireEvent.click(part("create"));
    await waitFor(() => expect(maybe("confirm")).toBeTruthy());
    view.unmount();
    render(<OverviewPage extension={extension} installation={installation} />);
    await opened();
    expect(maybe("confirm")).toBeNull();
    expect(words(part("create"))).toBe("Create a ServerStatusRequest");
    expect(main.runs()).toEqual([]);
  });

  it("keeps the words of a request that failed through a visit to another page", async () => {
    const { main, installation, view } = mount();

    await opened();
    await writesOn();
    await fail(main, DEADLINE);
    view.unmount();
    render(<OverviewPage extension={extension} installation={installation} />);
    await opened();
    expect(part("failure-text").textContent).toBe(DEADLINE.text);
  });
});
