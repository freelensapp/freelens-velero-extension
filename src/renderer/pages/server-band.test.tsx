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
import type { Failure, GateState, Answer as IpcAnswer, ServerStatusValue, WriteConfirmAnswer } from "../../common/ipc";
import type { ArtifactClient, GateClient, WriteClient } from "../api/ipc";

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

// What stands for the answers about an artifact, which the band of the server never asks for.
const NO_ARTIFACT: Failure = {
  ok: false,
  code: "request-failed",
  stage: "request",
  retry: false,
  text: "The band of the server asks for no artifact.",
};

const RUNNING = "Creating the ServerStatusRequest, then waiting for the server to answer for ten seconds at most.";
const STAYS =
  "The extension deletes no request: the server deletes one when it looks at it again, five minutes after it processed it, and one that no server processes stays until someone removes it.";

// The main process: the gate and the writes, whose runs wait until the test answers them, and whose
// confirmations wait as well once the test holds them.
function mainProcess() {
  let state: GateState = {
    cluster: { id: "cluster-a", name: "local-demo", context: "kind-local-demo" },
    writes: { on: false },
  };
  const asked: string[] = [];
  const runs: ((answer: IpcAnswer<ServerStatusValue>) => void)[] = [];
  const confirmations: ((answer: IpcAnswer<WriteConfirmAnswer>) => void)[] = [];
  let tokens = 0;
  let lost = false;
  let held = false;
  const confirmation = (): IpcAnswer<WriteConfirmAnswer> => {
    tokens += 1;
    return {
      ok: true,
      value: { token: `00000000-0000-4000-8000-${String(tokens).padStart(12, "0")}`, expires: Date.now() + 30_000 },
    };
  };
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
  const writer: WriteClient & ArtifactClient = {
    confirm: (_cluster, namespace, kind, target) => {
      asked.push(`confirm ${namespace} ${kind}${target ? " with a target" : ""}`);
      if (!held) return Promise.resolve(confirmation());
      return new Promise((resolve) => confirmations.push(resolve));
    },
    runServerStatus: (_cluster, namespace) => {
      asked.push(`run ${namespace}`);
      return new Promise((resolve) => runs.push(resolve));
    },
    status: async () => ({ ok: true, value: { step: "waiting" } }),
    cancel: async () => ({ ok: true, value: null }),
    // The band asks nothing of an artifact.
    runDownload: async () => NO_ARTIFACT,
    page: async () => NO_ARTIFACT,
    release: async () => NO_ARTIFACT,
    save: async () => NO_ARTIFACT,
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
    // From now on a confirmation waits until the test lets it go.
    hold: () => {
      held = true;
    },
    confirm: async () => {
      const resolve = confirmations.shift();

      if (!resolve) throw new Error("No confirmation waits");
      await act(async () => {
        resolve(confirmation());
        await new Promise((done) => setTimeout(done, 0));
      });
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

function mount(table = answers(), main = mainProcess(), way = true) {
  const installation = new Installation({
    cluster: { id: "cluster-a", name: "local-demo" },
    read: async (address) => table[address] ?? { status: 404 },
    now: () => Date.now(),
    storage: heldPreferences({ ...emptyPreferences(), selected: { "cluster-a": A } }),
    // Without a way to the main process the views have neither its gate nor its writes.
    ...(way ? { gate: main.gate, writer: main.writer } : {}),
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
    await waitFor(() => expect(part("body").getAttribute("data-step")).toBe("running"));
    expect(part("status").textContent).toBe(RUNNING);
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
    // The answer: the version, which is at the top of the band, and not the command under the plugins.
    await waitFor(() => expect(focused()).toBe("velero-overview-server-version"));
  });

  it("says what it is doing while the main process is asked, in a part that is always there, and gives it the focus", async () => {
    const main = mainProcess();

    mount(answers(), main);
    await opened();
    await writesOn();
    // The part is there before anything is asked, and says nothing: its words change, it does not come
    // with them.
    const status = part("status");

    expect(status.getAttribute("role")).toBe("status");
    expect(status.textContent).toBe("");
    main.hold();
    part("create").focus();
    fireEvent.click(part("create"));
    await waitFor(() => expect(part("body").getAttribute("data-step")).toBe("asking"));
    expect(status.textContent).toBe("Asking the main process for the confirmation of the request.");
    expect(maybe("create")).toBeNull();
    // The command went: the focus is on the words, not on nothing.
    await waitFor(() => expect(focused()).toBe("velero-overview-server-status"));
    await main.confirm();
    await waitFor(() => expect(focused()).toBe("velero-overview-server-confirm"));
    expect(status.textContent).toBe("");
    part("confirm-create").focus();
    fireEvent.click(part("confirm-create"));
    await waitFor(() => expect(part("body").getAttribute("data-step")).toBe("running"));
    expect(status.textContent).toBe(RUNNING);
    await waitFor(() => expect(focused()).toBe("velero-overview-server-status"));
    await main.answer({ ok: true, value: VALUE });
    await waitFor(() => expect(focused()).toBe("velero-overview-server-version"));
    expect(status.textContent).toBe("");
    expect(part("status")).toBe(status);
    expect(part("version").getAttribute("tabindex")).toBe("-1");
  });

  it("leaves the confirmation with Escape, and creates nothing", async () => {
    const { main } = mount();

    await opened();
    await writesOn();
    fireEvent.click(part("create"));
    await waitFor(() => expect(maybe("confirm")).toBeTruthy());
    expect(part("confirm").getAttribute("tabindex")).toBe("-1");
    // Another key is not a way out.
    fireEvent.keyDown(part("confirm-create"), { key: "Enter" });
    expect(maybe("confirm")).toBeTruthy();
    fireEvent.keyDown(part("confirm-create"), { key: "Escape" });
    expect(maybe("confirm")).toBeNull();
    await waitFor(() => expect(focused()).toBe("velero-overview-server-create"));
    expect(main.runs()).toEqual([]);
  });

  it("gives the focus to the command, and not to the version that was read before, when a request fails or is left", async () => {
    const { main } = mount();

    await opened();
    await writesOn();
    await read(main);
    // A request that fails: what is shown of the version is of the read before.
    part("create").focus();
    fireEvent.click(part("create"));
    await waitFor(() => expect(focused()).toBe("velero-overview-server-confirm"));
    part("confirm-create").focus();
    fireEvent.click(part("confirm-create"));
    await waitFor(() => expect(main.runs()).toHaveLength(2));
    await main.answer(DEADLINE);
    await waitFor(() => expect(maybe("failure")).toBeTruthy());
    await waitFor(() => expect(focused()).toBe("velero-overview-server-create"));
    // A confirmation that is left.
    fireEvent.click(part("create"));
    await waitFor(() => expect(focused()).toBe("velero-overview-server-confirm"));
    part("confirm-back").focus();
    fireEvent.click(part("confirm-back"));
    await waitFor(() => expect(focused()).toBe("velero-overview-server-create"));
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

    // The mark of a provider is for who sees: its words say the same.
    expect(
      [...objectStore.querySelectorAll("[data-provider] .Icon")].map((mark) => mark.getAttribute("aria-hidden")),
    ).toEqual(["true", "true"]);
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
    [
      [
        { name: "velero.io/pod", kind: "BackupItemAction" },
        { name: "velero.io/pod", kind: "BackupItemAction" },
      ],
      "1 plugin loaded. The request lists 2 entries: 1 repeats a plugin of the same kind, which is shown once.",
    ],
    [
      [
        { name: "velero.io/pod", kind: "BackupItemAction" },
        { name: "velero.io/pv", kind: "BackupItemAction" },
        { name: "velero.io/pv", kind: "BackupItemAction" },
        { name: "velero.io/pod", kind: "BackupItemAction" },
        { name: "velero.io/pod", kind: "RestoreItemAction" },
      ],
      "3 plugins loaded. The request lists 5 entries: 2 repeat a plugin of the same kind, which is shown once.",
    ],
  ])("counts the plugins the server loaded, each once: %j", async (plugins, count) => {
    const { main } = mount();

    await opened();
    await writesOn();
    await read(main, { ...VALUE, plugins });
    expect(part("plugins-count").textContent).toBe(count);
    // A plugin the request lists twice is one line of its kind.
    for (const row of part("plugins").querySelectorAll("[data-kind]")) {
      const names = [...row.querySelectorAll("[data-plugin]")].map((plugin) => plugin.textContent);

      expect([row.getAttribute("data-kind"), names]).toEqual([row.getAttribute("data-kind"), [...new Set(names)]]);
      expect(row.getAttribute("data-count")).toBe(String(names.length));
    }
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

  it("follows the storage locations as the installation reads them again, under a version that stays", async () => {
    const table = answers({ [path("storageLocations", A)]: { status: 403 } });
    const { main, installation } = mount(table);

    await opened();
    await writesOn();
    await read(main);
    expect(maybe("providers-unknown")).toBeTruthy();
    // The locations are read at the next read of the installation: the band says what they name.
    table[path("storageLocations", A)] = list(location("default", A, "aws"));
    await act(() => installation.refresh());
    await waitFor(() => expect(maybe("providers")).toBeTruthy());
    expect(maybe("providers-unknown")).toBeNull();
    expect(part("plugins").querySelectorAll("[data-provider]")).toHaveLength(1);
    // And a location that comes after the version was read.
    table[path("storageLocations", A)] = list(location("default", A, "aws"), location("cold", A, "gcp"));
    await act(() => installation.refresh());
    await waitFor(() => expect(part("plugins").querySelectorAll("[data-provider]")).toHaveLength(2));
    expect(part("version").textContent).toBe(`Velero ${REVIEWED_RELEASE}`);
    expect(main.runs()).toHaveLength(1);
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
      `The request is a ServerStatusRequest of ${A} whose name begins with freelens-velero-. ${STAYS}`,
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
    ["cancelled", "wait", "created", "The wait was cancelled. The request stays until the server processes it."],
    ["cancelled", "creation", "unknown", "The request was cancelled before the cluster answered its creation."],
    ["submission-unknown", "creation", "unknown", "The creation of the request may have happened: look for it."],
    ["target-changed", "wait", "created", "The cluster or the installation changed while the request was made."],
    ["transport-unreachable", "creation", "none", "The API server of the cluster could not be reached."],
    ["tls-invalid", "creation", "none", "The certificate of the API server of the cluster is not trusted."],
    ["request-failed", "credential", "none", "The credential plugin kubelogin of the context did not give one."],
    ["request-failed", "way", "unknown", "The main process did not answer."],
    ["validation", "answer", "unknown", "The main process answered with what the views do not understand."],
  ] as const)(
    "says the failure %s at the stage %s in the words of the main process, and what it left: %s",
    async (code, stage, left, text) => {
      const { main } = mount();

      await opened();
      await writesOn();
      await fail(main, { ok: false, code, stage, retry: false, text });
      expect(part("failure").getAttribute("data-code")).toBe(code);
      expect(part("failure").getAttribute("data-stage")).toBe(stage);
      expect(part("failure-text").textContent).toBe(text);
      // Where the request is, is said of one that is there, and that it may be there of one that is not known.
      expect(maybe("failure-request") === null).toBe(left === "none");
      expect(maybe("failure-request")?.getAttribute("data-request") ?? "none").toBe(left);
      if (left === "unknown") {
        expect(part("failure-request").textContent).toBe(
          `It is not known whether the request was created: a ServerStatusRequest whose name begins with freelens-velero- may be in ${A}. ${STAYS}`,
        );
      }
      // A request is there already, or may be: the command says that it creates another.
      expect(words(part("create"))).toBe(
        left === "none" ? "Create a ServerStatusRequest" : "Create another ServerStatusRequest",
      );
      expect(part("what").textContent).toBe(
        left === "none"
          ? `Asking the server for them creates a ServerStatusRequest in ${A}, which the server answers.`
          : `Asking again creates another ServerStatusRequest in ${A}.`,
      );
    },
  );

  it("says that writes cannot be turned on when the views have no way to the main process, and leads nowhere", async () => {
    mount(answers(), mainProcess(), false);
    await opened();
    await waitFor(() => expect(screen.getByTestId("velero-writes-failure")).toBeTruthy());
    expect(part("writes-off").textContent).toBe(
      `Asking the server for them creates a ServerStatusRequest in ${A}, which the server answers. The views have no way to the main process of the extension: writes cannot be turned on.`,
    );
    // The target bar offers nothing to turn: the band does not lead to it.
    expect(maybe("to-target")).toBeNull();
    expect(maybe("create")).toBeNull();
  });

  it("keeps saying that a request runs when writes are turned off under it, then says how it ended", async () => {
    const { main } = mount();
    const cancelled: Failure = {
      ok: false,
      code: "cancelled",
      stage: "wait",
      retry: true,
      text: "The wait was cancelled. The request stays until the server processes it.",
    };

    await opened();
    await writesOn();
    await ask(main);
    fireEvent.click(screen.getByTestId("velero-writes-off"));
    await waitFor(() => expect(screen.getByTestId("velero-writes").getAttribute("data-writes")).toBe("off"));
    // The request is not left: the band says that it runs, and offers nothing over it.
    expect(part("status").textContent).toBe(RUNNING);
    expect(maybe("writes-off")).toBeNull();
    expect(maybe("to-target")).toBeNull();
    await main.answer(cancelled);
    await waitFor(() => expect(maybe("failure")).toBeTruthy());
    expect(part("failure-text").textContent).toBe(cancelled.text);
    expect(part("status").textContent).toBe("");
    expect(part("writes-off").textContent).toContain("Writes are off for this installation");
  });

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

  it("leaves a confirmation that is still asked with the page that asked for it", async () => {
    const main = mainProcess();
    const { installation, view } = mount(answers(), main);

    await opened();
    await writesOn();
    main.hold();
    fireEvent.click(part("create"));
    await waitFor(() => expect(part("body").getAttribute("data-step")).toBe("asking"));
    view.unmount();
    // It answers on no page.
    await main.confirm();
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
