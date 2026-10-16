// The create-only adapter on a fake client of the host: every request through the client of the cluster,
// the cluster read in the catalog before anything is sent, every answer read by its status, what a call
// rejects with read by its shape, and the bounds of a request kept by the adapter itself.

import { randomUUID } from "node:crypto";
import { inspect } from "node:util";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  answered,
  fakeHostClient,
  type HostReply,
  type HostRequest,
  JsonApiErrorParsedDouble,
  statusOf,
} from "../../test/host-client";
import { createTlsFixture } from "../../test/tls-fixture";
import { CLUSTER_WORDS, downloadFailure } from "../common/diagnostic-text";
import { DIAGNOSTIC_REQUEST_LABEL } from "../common/ipc";
import {
  DiagnosticKubernetes,
  type DiagnosticObject,
  queryOf,
  REQUEST_BOUNDS,
  rejectionOf,
} from "./diagnostic-kubernetes";
import { DiagnosticError } from "./diagnostic-transport";

import type { CatalogEntry } from "./catalog";

const ENTRY: CatalogEntry = {
  id: "cluster-a",
  name: "demo",
  kubeConfigPath: "/synthetic/kubeconfig-a",
  contextName: "kind-a",
  status: "connected",
};
const API = "/apis/velero.io/v1/namespaces/velero";
const MiB = 1024 ** 2;

let certificates: Awaited<ReturnType<typeof createTlsFixture>>;

beforeAll(async () => {
  certificates = await createTlsFixture();
});

afterAll(async () => {
  await certificates?.dispose();
});

afterEach(() => {
  vi.useRealTimers();
});

function objectOf(name: string, namespace = "velero", more: Record<string, unknown> = {}): DiagnosticObject {
  return { metadata: { name, namespace, uid: `${name}-uid` }, ...more };
}

// What the API server of the tests answers: the object a GET names, an object created with its name or a
// generated one, and the slices of a Service.
function server(request: HostRequest): HostReply {
  if (request.method === "POST") {
    const body = request.body as { metadata: { name?: string; generateName?: string } };
    const name = body.metadata.name ?? `${body.metadata.generateName}generated`;

    return answered(201, { ...body, metadata: { ...body.metadata, name, uid: `${name}-uid` } });
  }
  const name = request.path.split("/").pop() ?? "";

  return answered(200, objectOf(name));
}

// An adapter of the cluster of the tests, on a fake client of the host, with the entry of the catalog the
// test changes.
function fixture(reply: (request: HostRequest) => HostReply | Promise<HostReply> = server) {
  const host = fakeHostClient(reply);
  const catalog: { entry: CatalogEntry | undefined; raises: boolean } = { entry: { ...ENTRY }, raises: false };
  // The clusters a client was asked for.
  const clients: string[] = [];
  const api = new DiagnosticKubernetes(
    ENTRY,
    {
      entry: () => {
        if (catalog.raises) throw new Error("the catalog of the host raised");
        return catalog.entry;
      },
      client: () => {
        clients.push(ENTRY.id);
        return host.forCluster(ENTRY.id);
      },
    },
    { "app.kubernetes.io/managed-by": "freelens-velero-extension" },
  );

  return { api, host, catalog, clients, signal: new AbortController().signal };
}

// What a promise ended with.
const ended = (promise: Promise<unknown>) =>
  promise.then(
    () => undefined,
    (error: unknown) => error,
  );

describe("the create-only adapter, through the client of the host", () => {
  it("has a way to read and a way to create, and none to change or to remove an object", () => {
    // What the adapter can do, by name: a method added to it is looked at here, against the rule that the
    // extension deletes no request.
    expect(Object.getOwnPropertyNames(DiagnosticKubernetes.prototype).sort()).toEqual([
      "assertCurrent",
      "certificate",
      "constructor",
      "createDownload",
      "createGenerated",
      "list",
      "path",
      "read",
      "refusal",
      "send",
    ]);
  });

  it("sends every request through the client of the host for its cluster, with getResponse and nothing else", async () => {
    const { api, host, clients, signal } = fixture();
    const request = randomUUID();

    await api.read("Backup", "velero", "nightly", signal);
    await api.createDownload("velero", "BackupLog", "nightly", `nightly-${request}`, request, signal);
    await api.createGenerated("ServerStatusRequest", "velero", "velero-extension-", signal);
    await api.read("Secret", "velero", "certificate", signal);
    await api.list("EndpointSlice", "velero", "storage", signal).catch(() => undefined);
    expect(host.requests.map((item) => [item.cluster, item.call, item.method, item.path])).toEqual([
      ["cluster-a", "getResponse", "GET", `${API}/backups/nightly`],
      ["cluster-a", "getResponse", "POST", `${API}/downloadrequests`],
      ["cluster-a", "getResponse", "POST", `${API}/serverstatusrequests`],
      ["cluster-a", "getResponse", "GET", "/api/v1/namespaces/velero/secrets/certificate"],
      ["cluster-a", "getResponse", "GET", "/apis/discovery.k8s.io/v1/namespaces/velero/endpointslices"],
    ]);
    expect(clients).toEqual(["cluster-a", "cluster-a", "cluster-a", "cluster-a", "cluster-a"]);
  });

  it("writes every header name in lowercase, sends a creation as JSON, and gives every request a signal of its own", async () => {
    const { api, host, signal } = fixture();
    const request = randomUUID();

    await api.read("Backup", "velero", "nightly", signal);
    await api.createDownload("velero", "BackupLog", "nightly", `nightly-${request}`, request, signal);
    const names = host.requests.flatMap((item) => Object.keys(item.headers));

    expect(names.length).toBeGreaterThan(0);
    expect(names.filter((header) => header !== header.toLowerCase())).toEqual([]);
    expect(host.requests[0].headers).toEqual({ accept: "application/json" });
    expect(host.requests[1].headers).toEqual({ accept: "application/json", "content-type": "application/json" });
    expect(host.requests[1].body).toEqual({
      apiVersion: "velero.io/v1",
      kind: "DownloadRequest",
      metadata: {
        namespace: "velero",
        name: `nightly-${request}`,
        labels: { "app.kubernetes.io/managed-by": "freelens-velero-extension", [DIAGNOSTIC_REQUEST_LABEL]: request },
      },
      spec: { target: { kind: "BackupLog", name: "nightly" } },
    });
    // The signal the client is given is the one of the request, not the one of the operation: the bound of
    // the request stops it alone.
    for (const item of host.requests) {
      expect(item.signal).toBeInstanceOf(AbortSignal);
      expect(item.signal).not.toBe(signal);
    }
  });

  it("sends no query parameter without a value, and no query at all when none has one", async () => {
    expect(queryOf({ labelSelector: "app=velero", limit: undefined, continue: "" })).toEqual({
      labelSelector: "app=velero",
    });
    expect(queryOf({ watch: undefined })).toBeUndefined();
    expect(queryOf()).toBeUndefined();
    const { api, host, signal } = fixture(() => answered(200, { metadata: {}, items: [] }));

    await api.list("EndpointSlice", "velero", "storage", signal);
    await api.read("Backup", "velero", "nightly", signal).catch(() => undefined);
    // The selector is given to the client as its value, which the client writes into the query; a read
    // has no query.
    expect(host.requests[0].query).toEqual({ labelSelector: "kubernetes.io/service-name=storage" });
    expect("query" in host.requests[1]).toBe(false);
  });

  it("refuses a cluster that is not in the catalog, or in a state that is not connected, before anything is sent, with words that say which", async () => {
    const context = { artifact: "BackupLog" as const, name: "nightly", namespace: "velero" };

    for (const [entry, verdict] of [
      [undefined, "absent"],
      [{ ...ENTRY, status: "connecting" }, "disconnected"],
      [{ ...ENTRY, status: "disconnected" }, "disconnected"],
      [{ ...ENTRY, status: "disconnecting" }, "disconnected"],
    ] as const) {
      const { api, host, clients, catalog, signal } = fixture();
      const request = randomUUID();

      catalog.entry = entry;
      const refusals = [
        await ended(api.read("Backup", "velero", "nightly", signal)),
        await ended(api.createDownload("velero", "BackupLog", "nightly", `nightly-${request}`, request, signal)),
        await ended(api.createGenerated("ServerStatusRequest", "velero", "velero-extension-", signal)),
        await ended(api.list("EndpointSlice", "velero", "storage", signal)),
      ];

      expect(() => api.assertCurrent()).toThrow(DiagnosticError);
      for (const refusal of refusals) expect(refusal).toMatchObject({ code: "target-changed", verdict });
      // Nothing was sent, nor was a client asked for.
      expect(host.requests).toEqual([]);
      expect(clients).toEqual([]);
      // The words say which, and that nothing was created at the creation.
      const said = downloadFailure("target-changed", "creation", { ...context, verdict });

      expect(said.text).toBe(`${CLUSTER_WORDS[verdict]} No request was created.`);
    }
    expect(CLUSTER_WORDS.absent).toContain("not in the catalog");
    expect(CLUSTER_WORDS.disconnected).toContain("not connected");
  });

  it("refuses a cluster whose kubeconfig or context changed in the catalog, or a catalog that raises, before anything is sent", async () => {
    for (const change of [
      (catalog: { entry: CatalogEntry | undefined; raises: boolean }) => {
        catalog.entry = { ...ENTRY, kubeConfigPath: "/synthetic/kubeconfig-moved" };
      },
      (catalog: { entry: CatalogEntry | undefined; raises: boolean }) => {
        catalog.entry = { ...ENTRY, contextName: "kind-renamed" };
      },
      (catalog: { entry: CatalogEntry | undefined; raises: boolean }) => {
        catalog.raises = true;
      },
    ]) {
      const { api, host, catalog, signal } = fixture();

      change(catalog);
      const refusal = await ended(api.read("Backup", "velero", "nightly", signal));

      expect(refusal).toBeInstanceOf(DiagnosticError);
      expect(refusal).toMatchObject({ code: "target-changed", verdict: undefined });
      expect(host.requests).toEqual([]);
    }
    // Its name and its state as they are now are not part of what is compared.
    const { api, catalog, signal } = fixture();

    catalog.entry = { ...ENTRY, name: "renamed" };
    await expect(api.read("Backup", "velero", "nightly", signal)).resolves.toMatchObject({
      metadata: { name: "nightly" },
    });
  });

  it("does not use an answer of a cluster that changed while it was asked", async () => {
    let fixed: ReturnType<typeof fixture> | undefined;
    const value = fixture((request) => {
      if (fixed) fixed.catalog.entry = { ...ENTRY, status: "disconnected" };
      return server(request);
    });

    fixed = value;
    // Said as a change while the request was made, which the words of the creation say may have created it.
    await expect(value.api.read("Backup", "velero", "nightly", value.signal)).rejects.toMatchObject({
      code: "target-changed",
      verdict: undefined,
    });
    expect(value.host.requests).toHaveLength(1);
  });

  it("reads every answer by its status, which the client gives whatever it is", async () => {
    const statuses = [401, 403, 404, 409, 422, 500, 503, 302];
    const outcomes: unknown[] = [];

    for (const status of statuses) {
      const { api, signal } = fixture(() => answered(status, statusOf(status, `Status${status}`)));
      const request = randomUUID();

      outcomes.push([
        status,
        await ended(api.read("Backup", "velero", "nightly", signal)),
        await ended(api.createDownload("velero", "BackupLog", "nightly", `nightly-${request}`, request, signal)),
      ]);
    }
    expect(outcomes).toEqual([
      // A credential the cluster does not take, told from a permission it refuses.
      [
        401,
        expect.objectContaining({ code: "forbidden", verdict: "credential" }),
        expect.objectContaining({ code: "forbidden", verdict: "credential" }),
      ],
      [
        403,
        expect.objectContaining({ code: "forbidden", verdict: undefined }),
        expect.objectContaining({ code: "forbidden", verdict: undefined }),
      ],
      [404, expect.objectContaining({ code: "not-found" }), expect.objectContaining({ code: "not-found" })],
      [409, expect.objectContaining({ code: "conflict" }), expect.objectContaining({ code: "conflict" })],
      // A creation the server refused for its content was not made; one it failed may have been.
      [422, expect.objectContaining({ code: "request-failed" }), expect.objectContaining({ code: "request-failed" })],
      [
        500,
        expect.objectContaining({ code: "request-failed" }),
        expect.objectContaining({ code: "submission-unknown" }),
      ],
      [
        503,
        expect.objectContaining({ code: "request-failed" }),
        expect.objectContaining({ code: "submission-unknown" }),
      ],
      [302, expect.objectContaining({ code: "request-failed" }), expect.objectContaining({ code: "request-failed" })],
    ]);
  });

  it("reads what a call of the client rejects with by its shape, and takes only the error of a fetch for an Error", async () => {
    // The shapes, as the calls of the client that parse an answer reject with them.
    const host = fakeHostClient((request) =>
      request.path.endsWith("/text")
        ? answered(403, "forbidden, as a text that is not JSON")
        : answered(Number(request.path.split("/").pop()), statusOf(Number(request.path.split("/").pop()), "Synthetic")),
    );
    const client = host.forCluster("cluster-a");
    const status403 = await ended(client.get("/status/403"));
    const text403 = await ended(client.get("/status/text"));
    const parsed = await Promise.all(
      [403, 404, 409, 422, 500].map(async (code) => [code, await ended(client.post(`/status/${code}`, { data: {} }))]),
    );
    const parsedGets = await Promise.all(
      [404, 409, 422, 500].map(async (code) => [code, await ended(client.get(`/status/${code}`))]),
    );

    // None of them is an Error: a read refused with 403 rejects with the Status body itself, or its text.
    expect(status403).toMatchObject({ kind: "Status", code: 403 });
    expect(status403).not.toBeInstanceOf(Error);
    expect(typeof text403).toBe("string");
    for (const [, error] of [...parsed, ...parsedGets]) {
      expect(error).toBeInstanceOf(JsonApiErrorParsedDouble);
      expect(error).not.toBeInstanceOf(Error);
    }
    expect(rejectionOf(status403, false)).toMatchObject({ code: "forbidden" });
    expect(rejectionOf(text403, false)).toMatchObject({ code: "forbidden" });
    expect(parsed.map(([code, error]) => [code, rejectionOf(error, true).code])).toEqual([
      [403, "forbidden"],
      [404, "not-found"],
      [409, "conflict"],
      [422, "request-failed"],
      [500, "submission-unknown"],
    ]);
    expect(parsedGets.map(([code, error]) => [code, rejectionOf(error, false).code])).toEqual([
      [404, "not-found"],
      [409, "conflict"],
      [422, "request-failed"],
      [500, "request-failed"],
    ]);
    // The error of a fetch that got no answer: a read did not reach the server, a creation may have.
    for (const error of [new TypeError("fetch failed"), new DOMException("aborted", "AbortError"), new Error("x")]) {
      expect(rejectionOf(error, false).code).toBe("transport-unreachable");
      expect(rejectionOf(error, true).code).toBe("submission-unknown");
    }
    // What has none of these shapes says nothing of what happened.
    for (const shapeless of [undefined, null, 42, {}, { error: "a text" }, { kind: "Status" }])
      expect([rejectionOf(shapeless, false).code, rejectionOf(shapeless, true).code]).toEqual([
        "request-failed",
        "submission-unknown",
      ]);
    // The text of a body that is not JSON is the answer of a read refused with 403, and of no creation.
    expect(rejectionOf("a text", true).code).toBe("submission-unknown");
    // The adapter reads them the same way whichever call of the client rejected with them.
    for (const [rejection, code] of [
      [status403, "forbidden"],
      [parsed[1][1], "not-found"],
      [new TypeError("fetch failed"), "transport-unreachable"],
    ] as const) {
      const { api, signal } = fixture(() => ({ reject: rejection }));

      await expect(api.read("Backup", "velero", "nightly", signal)).rejects.toMatchObject({ code });
    }
  });

  it("says of a creation that got no answer that it is not known, to be looked for by its name, and sends it once", async () => {
    const { api, host, signal } = fixture((request) =>
      request.method === "POST" ? { reject: new TypeError("fetch failed") } : server(request),
    );
    const request = randomUUID();

    await expect(
      api.createDownload("velero", "BackupLog", "nightly", `nightly-${request}`, request, signal),
    ).rejects.toMatchObject({ code: "submission-unknown" });
    // The adapter does not send it again: the way reads it by its name.
    const found = await api.read("DownloadRequest", "velero", `nightly-${request}`, signal);

    expect(found.metadata.name).toBe(`nightly-${request}`);
    expect(host.requests.map((item) => item.method)).toEqual(["POST", "GET"]);
    // A read that got no answer did not reach the server.
    const unanswered = fixture(() => ({ reject: new TypeError("fetch failed") }));

    await expect(unanswered.api.read("Backup", "velero", "nightly", unanswered.signal)).rejects.toMatchObject({
      code: "transport-unreachable",
    });
  });

  it("says that a creation whose answer cannot be read is not known, and refuses an object of another namespace", async () => {
    const unreadable = fixture((request) => (request.method === "POST" ? answered(201, "not-json") : server(request)));
    const request = randomUUID();

    await expect(
      unreadable.api.createDownload("velero", "BackupLog", "nightly", `nightly-${request}`, request, unreadable.signal),
    ).rejects.toMatchObject({ code: "submission-unknown" });
    await expect(
      unreadable.api.createGenerated("ServerStatusRequest", "velero", "velero-extension-", unreadable.signal),
    ).rejects.toMatchObject({ code: "submission-unknown" });
    expect(unreadable.host.requests.filter((item) => item.method === "POST")).toHaveLength(2);
    // A read whose answer is not an object is a request that failed.
    const shapeless = fixture(() => answered(200, "[1, 2]"));

    await expect(shapeless.api.read("Backup", "velero", "nightly", shapeless.signal)).rejects.toMatchObject({
      code: "request-failed",
    });
    const elsewhere = fixture(() => answered(200, objectOf("nightly", "other")));

    await expect(elsewhere.api.read("Backup", "velero", "nightly", elsewhere.signal)).rejects.toMatchObject({
      code: "target-changed",
    });
  });

  it("does not ask for a client of a cluster for which the host gives none, and says that nothing was sent", async () => {
    const host = fakeHostClient(server);
    const api = new DiagnosticKubernetes(ENTRY, {
      entry: () => ENTRY,
      client: () => {
        throw new Error("no client of the host");
      },
    });
    const request = randomUUID();
    const signal = new AbortController().signal;

    await expect(api.read("Backup", "velero", "nightly", signal)).rejects.toMatchObject({
      code: "transport-unreachable",
    });
    // Nothing was sent: a creation either.
    await expect(
      api.createDownload("velero", "BackupLog", "nightly", `nightly-${request}`, request, signal),
    ).rejects.toMatchObject({ code: "transport-unreachable" });
    expect(host.requests).toEqual([]);
    // A client that raises at once, and does not reject, is read the same way as one that rejects.
    const raising = new DiagnosticKubernetes(ENTRY, {
      entry: () => ENTRY,
      client: () => ({
        getResponse: () => {
          throw new TypeError("raised at once");
        },
      }),
    });

    await expect(raising.read("Backup", "velero", "nightly", signal)).rejects.toMatchObject({
      code: "transport-unreachable",
    });
    await expect(
      raising.createDownload("velero", "BackupLog", "nightly", `nightly-${request}`, request, signal),
    ).rejects.toMatchObject({ code: "submission-unknown" });
  });

  it("stops a request at ten seconds with a signal of its own: a read as a deadline, a creation as not known", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { api, host, signal } = fixture(() => ({ hang: true }));
    const request = randomUUID();
    const read = ended(api.read("Backup", "velero", "nightly", signal));
    const creation = ended(api.createDownload("velero", "BackupLog", "nightly", `nightly-${request}`, request, signal));

    await vi.advanceTimersByTimeAsync(REQUEST_BOUNDS.timeMs - 1);
    expect(host.requests.map((item) => item.signal?.aborted)).toEqual([false, false]);
    await vi.advanceTimersByTimeAsync(1);
    expect(await read).toMatchObject({ code: "deadline" });
    expect(await creation).toMatchObject({ code: "submission-unknown" });
    // The client was told to stop both.
    expect(host.requests.map((item) => item.signal?.aborted)).toEqual([true, true]);
    expect(REQUEST_BOUNDS.timeMs).toBe(10_000);
  });

  it("stops a request at its bound even when the client does not hear its signal", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    // A client that never answers and never hears the signal.
    const deaf = new DiagnosticKubernetes(ENTRY, {
      entry: () => ENTRY,
      client: () => ({ getResponse: () => new Promise(() => undefined) }),
    });
    const read = ended(deaf.read("Backup", "velero", "nightly", new AbortController().signal));

    await vi.advanceTimersByTimeAsync(REQUEST_BOUNDS.timeMs);
    expect(await read).toMatchObject({ code: "deadline" });
  });

  it("stops at its bound a body that arrives too slowly", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    // The answer comes at once, and its body stops arriving after its first bytes.
    const { api, host, signal } = fixture(() => ({
      status: 200,
      chunks: [new TextEncoder().encode('{"metadata":')],
      stall: true,
    }));
    const read = ended(api.read("Backup", "velero", "nightly", signal));
    const request = randomUUID();
    const creation = ended(api.createDownload("velero", "BackupLog", "nightly", `nightly-${request}`, request, signal));

    await vi.advanceTimersByTimeAsync(REQUEST_BOUNDS.timeMs - 1);
    expect(host.bodies.map((body) => body.pulled)).toEqual([1, 1]);
    await vi.advanceTimersByTimeAsync(1);
    expect(await read).toMatchObject({ code: "deadline" });
    expect(await creation).toMatchObject({ code: "submission-unknown" });
    expect(host.bodies.map((body) => body.aborted)).toEqual([true, true]);
  });

  it("stops an answer beyond 4 MiB as it arrives, and keeps nothing of it", async () => {
    // A body that never ends, a mebibyte at a time.
    const endless = () => ({
      *[Symbol.iterator]() {
        for (;;) yield new Uint8Array(MiB).fill(0x20);
      },
    });
    const { api, host, signal } = fixture(() => ({ status: 200, chunks: endless() }));
    const request = randomUUID();

    await expect(api.read("Backup", "velero", "nightly", signal)).rejects.toMatchObject({ code: "payload-too-large" });
    // The answer of a creation that cannot be read says nothing of the creation.
    await expect(
      api.createDownload("velero", "BackupLog", "nightly", `nightly-${request}`, request, signal),
    ).rejects.toMatchObject({ code: "submission-unknown" });
    // Counted as it arrived: the body was let go after the chunk that went beyond the bound, and the request
    // was stopped.
    for (const body of host.bodies) {
      expect(body.pulled).toBeLessThanOrEqual(REQUEST_BOUNDS.bytes / MiB + 2);
      expect(body.cancelled).toBe(true);
    }
    expect(host.requests.map((item) => item.signal?.aborted)).toEqual([true, true]);
    // An answer of the bound itself is read.
    const padding = REQUEST_BOUNDS.bytes - JSON.stringify(objectOf("nightly", "velero", { padding: "" })).length;
    const whole = fixture(() => answered(200, objectOf("nightly", "velero", { padding: "x".repeat(padding) })));

    await expect(whole.api.read("Backup", "velero", "nightly", whole.signal)).resolves.toMatchObject({
      metadata: { name: "nightly" },
    });
    const over = fixture(() => answered(200, objectOf("nightly", "velero", { padding: "x".repeat(padding + 1) })));

    await expect(over.api.read("Backup", "velero", "nightly", over.signal)).rejects.toMatchObject({
      code: "payload-too-large",
    });
    expect(REQUEST_BOUNDS.bytes).toBe(4 * MiB);
  });

  it("is cancelled with its operation, and stops the request it made", async () => {
    const { api, host } = fixture(() => ({ hang: true }));
    const controller = new AbortController();
    const read = ended(api.read("Backup", "velero", "nightly", controller.signal));

    await vi.waitFor(() => expect(host.requests).toHaveLength(1));
    controller.abort();
    expect(await read).toMatchObject({ code: "cancelled" });
    expect(host.requests[0].signal?.aborted).toBe(true);
    // An operation stopped before asks nothing.
    await expect(api.read("Backup", "velero", "nightly", controller.signal)).rejects.toMatchObject({
      code: "cancelled",
    });
    expect(host.requests).toHaveLength(1);
  });

  it("uses POST for a creation, keeps a generated name, and refuses a collision", async () => {
    const names = new Set<string>();
    const { api, host, signal } = fixture((request) => {
      if (request.method !== "POST") return server(request);
      const body = request.body as { metadata: { name?: string } };

      if (body.metadata.name && names.has(body.metadata.name)) return answered(409, statusOf(409, "AlreadyExists"));
      if (body.metadata.name) names.add(body.metadata.name);
      return server(request);
    });
    const request = randomUUID();

    expect(
      (await api.createDownload("velero", "BackupLog", "nightly", "download", request, signal)).metadata.name,
    ).toBe("download");
    await expect(
      api.createDownload("velero", "BackupLog", "nightly", "download", request, signal),
    ).rejects.toMatchObject({ code: "conflict" });
    const generated = await api.createGenerated("ServerStatusRequest", "velero", "status-", signal);

    expect(generated.metadata.name).toBe("status-generated");
    expect(host.requests.map((item) => item.method)).toEqual(["POST", "POST", "POST"]);
    expect(host.requests[2].body).toMatchObject({ metadata: { generateName: "status-" }, spec: {} });
  });

  it("creates a request for one of the eight artifacts, and sends nothing for any other target", async () => {
    const { api, host, signal } = fixture();

    for (const target of ["BackupContents", "BackupItemOperations", "backuplog", ""])
      expect(() =>
        api.createDownload("velero", target as never, "nightly", `refused-${randomUUID()}`, randomUUID(), signal),
      ).toThrow("validation");
    // An identifier that is not one is refused the same way.
    expect(() => api.createDownload("velero", "BackupLog", "nightly", "refused", "not-an-identifier", signal)).toThrow(
      "validation",
    );
    expect(host.requests).toEqual([]);
  });

  it("labels the deletion of a backup with its name, cut as Velero cuts it beyond 63 characters", async () => {
    const { api, host, signal } = fixture();
    // Each name with the value the release gives the label: a name of 63 characters whole, a longer one as
    // its first 57 characters and the first 6 hexadecimal characters of its SHA-256, computed with shasum.
    const cases = [
      [`${"a".repeat(59)}.b63`, `${"a".repeat(59)}.b63`],
      [`${"a".repeat(60)}.b64`, `${"a".repeat(57)}8665a0`],
      [
        "nightly-cluster-wide-backup-of-every-namespace-2026-10-04-03-00-00.070",
        "nightly-cluster-wide-backup-of-every-namespace-2026-10-04c32264",
      ],
    ];

    for (const [backup] of cases)
      await api.createGenerated("DeleteBackupRequest", "velero", "delete-", signal, {
        name: backup,
        uid: "backup-uid",
      });
    // The request names the backup whole: only the label is cut.
    expect(host.requests.map((item) => item.body)).toMatchObject(
      cases.map(([backup, label]) => ({
        metadata: { labels: { "velero.io/backup-name": label, "velero.io/backup-uid": "backup-uid" } },
        spec: { backupName: backup },
      })),
    );
  });

  it("lists the endpoint slices of a Service by the label that names it, and takes none that is not of it", async () => {
    const slice = (name: string, namespace: string, service: string) => ({
      metadata: { name, namespace, uid: `${name}-uid`, labels: { "kubernetes.io/service-name": service } },
    });
    const lists: Record<string, unknown> = {
      "kubernetes.io/service-name=storage": [
        slice("storage-abcde", "velero", "storage"),
        slice("storage-fghij", "velero", "storage"),
      ],
      "kubernetes.io/service-name=empty": [],
      "kubernetes.io/service-name=elsewhere": [slice("elsewhere-abcde", "another", "elsewhere")],
      "kubernetes.io/service-name=mislabelled": [slice("mislabelled-abcde", "velero", "another")],
      "kubernetes.io/service-name=shapeless": "not-a-list",
    };
    const { api, host, signal } = fixture((request) => {
      const selector = String(request.query?.labelSelector);

      return selector === "kubernetes.io/service-name=refused"
        ? answered(403, statusOf(403, "Forbidden"))
        : answered(200, { kind: "EndpointSliceList", metadata: { resourceVersion: "7" }, items: lists[selector] });
    });

    expect((await api.list("EndpointSlice", "velero", "storage", signal)).map((item) => item.metadata.name)).toEqual([
      "storage-abcde",
      "storage-fghij",
    ]);
    expect(await api.list("EndpointSlice", "velero", "empty", signal)).toEqual([]);
    for (const service of ["elsewhere", "mislabelled", "shapeless"])
      await expect(api.list("EndpointSlice", "velero", service, signal)).rejects.toMatchObject({
        code: "request-failed",
      });
    await expect(api.list("EndpointSlice", "velero", "refused", signal)).rejects.toMatchObject({ code: "forbidden" });
    // No other kind is listed, and a name that is not one of a Service asks nothing.
    const asked = host.requests.length;

    expect(() => api.list("Secret" as never, "velero", "storage", signal)).toThrow("validation");
    expect(() => api.list("EndpointSlice", "velero", "storage,other=1", signal)).toThrow("validation");
    expect(() => api.list("EndpointSlice", "velero", "a".repeat(64), signal)).toThrow("validation");
    expect(host.requests).toHaveLength(asked);
    expect(host.requests.every((item) => item.method === "GET")).toBe(true);
  });

  it("reads only the certificate a location names, takes the reference before the inline value, and does not go around a Secret that is refused", async () => {
    const valid = Buffer.from(certificates.ca).toString("base64");
    // An inline value that is no certificate: taken, it would end as one that is not valid.
    const inline = Buffer.from("not the certificate of the store").toString("base64");
    const { api, host, signal } = fixture((request) =>
      request.path.endsWith("/secrets/denied")
        ? answered(403, statusOf(403, "Forbidden"))
        : answered(
            200,
            objectOf("certificate", "velero", { data: { "ca.crt": valid, credentials: "SYNTHETIC-DO-NOT-RETURN" } }),
          ),
    );

    expect(await api.certificate("velero", { caCert: valid }, signal)).toBe(certificates.ca);
    expect(host.requests).toEqual([]);
    expect(await api.certificate("velero", { caCertRef: { name: "certificate", key: "ca.crt" } }, signal)).toBe(
      certificates.ca,
    );
    expect(
      await api.certificate("velero", { caCert: inline, caCertRef: { name: "certificate", key: "ca.crt" } }, signal),
    ).toBe(certificates.ca);
    expect(host.requests.map((item) => `${item.method} ${item.path}`)).toEqual([
      "GET /api/v1/namespaces/velero/secrets/certificate",
      "GET /api/v1/namespaces/velero/secrets/certificate",
    ]);
    // The reference is the one that counts: a Secret that is refused, and a key that is not in it, are not
    // made up for with the inline value.
    await expect(
      api.certificate("velero", { caCert: valid, caCertRef: { name: "denied", key: "ca.crt" } }, signal),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      api.certificate("velero", { caCert: valid, caCertRef: { name: "certificate", key: "absent.crt" } }, signal),
    ).rejects.toMatchObject({ code: "tls-invalid" });
    await expect(api.certificate("velero", { caCert: inline }, signal)).rejects.toMatchObject({ code: "tls-invalid" });
  });

  it("says nothing of what the client or the server gave in what it raises", async () => {
    const SENTINEL = "PRIVATE-SENTINEL-OF-THE-ANSWER";
    const failures: unknown[] = [];

    for (const reply of [
      () => answered(403, statusOf(403, "Forbidden", SENTINEL)),
      () => ({ reject: statusOf(403, "Forbidden", SENTINEL) }),
      () => ({ reject: new JsonApiErrorParsedDouble(statusOf(500, "Internal", SENTINEL), [SENTINEL]) }),
      () => ({ reject: new TypeError(`fetch failed ${SENTINEL}`) }),
      () => answered(200, `${SENTINEL} not json`),
    ] as (() => HostReply)[]) {
      const { api, signal } = fixture(reply);

      failures.push(await ended(api.read("Backup", "velero", "nightly", signal)));
    }
    expect(failures.every((failure) => failure instanceof DiagnosticError)).toBe(true);
    expect(inspect(failures, { depth: 8, showHidden: true })).not.toContain(SENTINEL);
  });
});
